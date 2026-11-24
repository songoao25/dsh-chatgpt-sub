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
//   http           拿到了响应，但状态码不对
//   empty          请求成功，但内容是空的
//   unknown        认不出来的失败

// OpenAI 用来表达「本地区不可用」的错误码。
const REGION_BLOCK_CODES = ['unsupported_country_region_territory']

function errorCode(error) {
  if (!error) return ''
  const raw = error.code || error.errno || ''
  return typeof raw === 'string' ? raw.toUpperCase() : ''
}

// 把 fetch 抛出的异常归类。网络错误码来自 Node（ENOTFOUND 等），超时来自 AbortSignal.timeout。
export function classifyNetworkError(error) {
  if (!error) return { reason: 'unknown' }
  const name = typeof error.name === 'string' ? error.name : ''
  const code = errorCode(error)
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : ''
  if (name === 'TimeoutError' || name === 'AbortError') return { reason: 'timeout' }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_NODATA') return { reason: 'dns' }
  if (message.includes('getaddrinfo')) return { reason: 'dns' }
  if (code === 'ECONNREFUSED') return { reason: 'refused' }
  if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH' || code === 'ENETDOWN') return { reason: 'unreachable' }
  if (code === 'ECONNRESET' || code === 'EPIPE') return { reason: 'unreachable' }
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
