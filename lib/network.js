// dsh-chatgpt-sub — 出站网络失败的分类
//
// 为什么需要这一层：插件的所有出站请求都是裸 fetch()，走宿主进程的全局网络栈。
// 宿主启动时若没有代理变量，请求会直连 OpenAI；被区域策略拒绝、或者解析/连接失败之后，
// 宿主拿到的只是一个 fetch 抛出的 Error。以前插件把它一律显示成「连不上网络」，
// 用户分不出是地区限制、DNS 解析失败、代理端口没起，还是单纯超时，于是无从下手。
//
// 这里只做一件事：把「一次失败」归到一个稳定的 reason 上。
// 纯函数：不发请求、不读环境变量、不依赖宿主，方便单测。
// reason → 错误码的映射放在宿主里（src/host.js）：错误码是宿主与用户可见文案之间的契约，
// 宿主才是它的唯一持有者。
//
// reason 取值：
//   region-blocked  OpenAI 明确拒绝（403 + unsupported_country_region_territory）
//   timeout        超时或被中止
//   dns            域名解析失败
//   refused        连接被拒绝（代理端口没起最常见）
//   unreachable    网络不可达
//   proxy-reset    加密握手完成前连接被断开（代理重启、切节点、链路被掐）
//   tls            证书校验失败（代理拦截 HTTPS 时最常见）
//   http           拿到了响应，但状态码不对
//   empty          请求成功，但内容是空的
//   unknown        认不出来的失败

// OpenAI 用来表达「本地区不可用」的错误码。
const REGION_BLOCK_CODES = ['unsupported_country_region_territory']

// undici 在 TLS 握手完成之前断开连接时的原话。它和「读响应时被对端重置」不同：
// 前者几乎都是代理侧的问题（代理刚重启、刚切节点、或链路被中间设备掐断），
// 后者是对端或链路上的普通重置。两者给用户的处置完全不同，必须分开。
const PROXY_RESET_MARKERS = [
  'before secure tls connection was established',
  'other side closed',
]

// 超时不只来自 AbortSignal：宿主没给信号时，undici 自己有连接/响应头/响应体
// 三档超时码，系统层还有 ETIMEDOUT。只认 TimeoutError/AbortError 名字会把
// 这类超时漏成 unknown，用户就分不出「慢」和「断」。
const TIMEOUT_CODES = ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']

// 证书校验失败：Node 与 undici 抛出的证书类错误码。这个插件的用户大量走
// 本地代理，代理拦截 HTTPS 时用的自签 CA 不被信任是真实高频现场；归成
// unknown 只会让用户看到一句「认不出来的失败」，无从下手。
const TLS_CODES = [
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'UNABLE_TO_GET_ISSUER_CERT',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]

function errorCode(error) {
  if (!error) return ''
  const raw = error.code || error.errno || ''
  return typeof raw === 'string' ? raw.toUpperCase() : ''
}

// undici 的 fetch 失败时抛的是 TypeError('fetch failed')，真正的错误码不在顶层，
// 而在 error.cause 上（底层 socket 错误还可能再套一层）。沿 cause 链逐层收集信号，
// 任一层命中即可归类；宿主若直接抛系统错误（顶层带 code），第一层就是它本身。
function errorChain(error) {
  const chain = []
  let current = error
  while (current && chain.length < 5) {
    chain.push(current)
    current = current.cause
  }
  return chain
}

// 把 fetch 抛出的异常归类。网络错误码来自 Node（ENOTFOUND 等），超时来自 AbortSignal.timeout。
export function classifyNetworkError(error) {
  if (!error) return { reason: 'unknown' }
  const chain = errorChain(error)
  for (const item of chain) {
    if (item && (item.name === 'TimeoutError' || item.name === 'AbortError')) return { reason: 'timeout' }
  }
  const codes = chain.map(errorCode)
  const messages = chain.map(function (item) {
    return item && typeof item.message === 'string' ? item.message.toLowerCase() : ''
  })
  if (codes.some(function (code) { return TIMEOUT_CODES.includes(code) })) return { reason: 'timeout' }
  if (codes.some(function (code) { return TLS_CODES.includes(code) })) return { reason: 'tls' }
  // EAI_NONAME 是 musl（Alpine）解析器的「解析失败」码，与 glibc 的
  // ENOTFOUND/EAI_NODATA 同义；漏了它，Alpine 容器里的 DNS 失败会掉进 unknown。
  if (codes.some(function (code) { return code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_NODATA' || code === 'EAI_NONAME' })) return { reason: 'dns' }
  if (messages.some(function (message) { return message.includes('getaddrinfo') })) return { reason: 'dns' }
  if (codes.some(function (code) { return code === 'ECONNREFUSED' })) return { reason: 'refused' }
  if (codes.some(function (code) { return code === 'ENETUNREACH' || code === 'EHOSTUNREACH' || code === 'ENETDOWN' })) return { reason: 'unreachable' }
  if (codes.some(function (code) { return code === 'ECONNRESET' || code === 'EPIPE' || code === 'UND_ERR_SOCKET' })) {
    // 握手前断开：先看是不是代理侧的问题，再退回普通重置。
    if (messages.some(function (message) {
      return PROXY_RESET_MARKERS.some(function (marker) { return message.includes(marker) })
    })) return { reason: 'proxy-reset' }
    return { reason: 'unreachable' }
  }
  // undici 的 socket 层错误码（UND_ERR_SOCKET 等）有时不带上面这些系统码，
  // 只在消息里说明「对端把连接关了」。这类几乎都是代理或链路半路掐断。
  if (messages.some(function (message) {
    return PROXY_RESET_MARKERS.some(function (marker) { return message.includes(marker) })
  })) return { reason: 'proxy-reset' }
  return { reason: 'unknown' }
}

// 把「拿到了响应但状态码不对」归类。body 可能已经是解析过的 JSON，也可能是原始文本。
export function classifyHttpFailure(status, body) {
  const httpStatus = typeof status === 'number' ? status : null
  let marker = ''
  if (body && typeof body === 'object' && body.error && typeof body.error.code === 'string') {
    marker = body.error.code
  } else if (body && typeof body === 'object' && typeof body.error === 'string') {
    marker = body.error
  } else if (typeof body === 'string') {
    marker = body
  }
  if (httpStatus === 403 && REGION_BLOCK_CODES.some(function (code) { return marker.includes(code) })) {
    return { reason: 'region-blocked', status: httpStatus }
  }
  return { reason: 'http', status: httpStatus }
}
