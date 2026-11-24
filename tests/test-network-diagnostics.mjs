// dsh-chatgpt-sub — 出站网络失败的分类与错误码映射
//
// 背景：宿主没有代理变量时，插件的裸 fetch 会直连 OpenAI，被区域策略拒绝或超时之后，
// 以前只会留下一句「连不上网络」。这里锁住「失败 → reason → 错误码」的映射，
// 并守住每个错误码在 13 种语言里都有文案、占位符一致。
import assert from 'node:assert/strict'
import { LOCALES } from '../src/locales.js'
import { classifyHttpFailure, classifyNetworkError } from '../src/network.js'

// 错误码映射是宿主的职责（宿主是错误码与文案之间的契约方），所以从宿主取。
const hostModule = await import('../src/host.js')
const exchangeFailure = hostModule.exchangeFailure
const modelsFailure = hostModule.modelsFailure
const idTokenFailure = hostModule.idTokenFailure
const refreshFailure = hostModule.refreshFailure

// ---------- 1. 网络异常分类 ----------
assert.deepEqual(classifyNetworkError({ name: 'TimeoutError' }), { reason: 'timeout' })
assert.deepEqual(classifyNetworkError({ name: 'AbortError', message: 'This operation was aborted' }), { reason: 'timeout' })
assert.deepEqual(classifyNetworkError({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND auth.openai.com' }), { reason: 'dns' })
assert.deepEqual(classifyNetworkError({ code: 'EAI_AGAIN' }), { reason: 'dns' })
assert.deepEqual(classifyNetworkError({ code: 'ECONNREFUSED' }), { reason: 'refused' })
assert.deepEqual(classifyNetworkError({ code: 'ENETUNREACH' }), { reason: 'unreachable' })
assert.deepEqual(classifyNetworkError({ code: 'EHOSTUNREACH' }), { reason: 'unreachable' })
assert.deepEqual(classifyNetworkError({ code: 'ECONNRESET' }), { reason: 'unreachable' })
assert.deepEqual(classifyNetworkError(null), { reason: 'unknown' })
assert.deepEqual(classifyNetworkError(new Error('boom')), { reason: 'unknown' })

// undici 的真实形状：顶层是 TypeError('fetch failed')，真码在 cause 上，可能不止一层。
const undiciRefused = new TypeError('fetch failed')
undiciRefused.cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:7890'), { code: 'ECONNREFUSED' })
assert.deepEqual(classifyNetworkError(undiciRefused), { reason: 'refused' })
const undiciDns = new TypeError('fetch failed')
undiciDns.cause = Object.assign(new Error('getaddrinfo ENOTFOUND auth.openai.com'), { code: 'ENOTFOUND' })
assert.deepEqual(classifyNetworkError(undiciDns), { reason: 'dns' })
const undiciDeepReset = new TypeError('fetch failed')
const socketLayer = new Error('socket hang up')
socketLayer.cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
undiciDeepReset.cause = socketLayer
assert.deepEqual(classifyNetworkError(undiciDeepReset), { reason: 'unreachable' })

// 代理在 TLS 握手完成前把连接掐了：这跟「链路断了」不是一回事，多半是代理重启或切了节点。
const proxyReset = new TypeError('fetch failed')
proxyReset.cause = Object.assign(
  new Error('Client network socket disconnected before secure TLS connection was established'),
  { code: 'ECONNRESET' },
)
assert.deepEqual(classifyNetworkError(proxyReset), { reason: 'proxy-reset' })
assert.deepEqual(
  classifyNetworkError({ code: 'ECONNRESET', message: 'other side closed' }),
  { reason: 'proxy-reset' },
)
// undici 的 socket 层错误有时不带系统错误码，只在消息里说明对端关了连接。
assert.deepEqual(
  classifyNetworkError({ code: 'UND_ERR_SOCKET', message: 'other side closed' }),
  { reason: 'proxy-reset' },
)

// ---------- 2. HTTP 失败分类 ----------
assert.deepEqual(
  classifyHttpFailure(403, { error: { code: 'unsupported_country_region_territory' } }),
  { reason: 'region-blocked', status: 403 },
)
assert.deepEqual(
  classifyHttpFailure(403, '{"error":{"code":"unsupported_country_region_territory"}}'),
  { reason: 'region-blocked', status: 403 },
)
assert.deepEqual(classifyHttpFailure(403, { error: { code: 'invalid_api_key' } }), { reason: 'http', status: 403 })
assert.deepEqual(classifyHttpFailure(500, null), { reason: 'http', status: 500 })

// ---------- 3. 错误码映射 ----------
assert.deepEqual(exchangeFailure({ reason: 'region-blocked', status: 403 }), { code: 'oauth.exchange-region-blocked', params: null })
assert.deepEqual(exchangeFailure({ reason: 'timeout' }), { code: 'oauth.exchange-timeout', params: null })
assert.deepEqual(exchangeFailure({ reason: 'dns' }), { code: 'oauth.exchange-dns', params: null })
assert.deepEqual(exchangeFailure({ reason: 'refused' }), { code: 'oauth.exchange-refused', params: null })
assert.deepEqual(exchangeFailure({ reason: 'unreachable' }), { code: 'oauth.exchange-unreachable', params: null })
assert.deepEqual(exchangeFailure({ reason: 'http', status: 500 }), { code: 'oauth.exchange-http', params: { status: 500 } })
assert.deepEqual(exchangeFailure({ reason: 'unknown' }), { code: 'oauth.exchange-network', params: null })
assert.deepEqual(exchangeFailure(null), { code: 'oauth.exchange-network', params: null })

assert.deepEqual(modelsFailure({ reason: 'region-blocked' }), { code: 'models.region-blocked', params: null })
assert.deepEqual(modelsFailure({ reason: 'timeout' }), { code: 'models.timeout', params: null })
assert.deepEqual(modelsFailure({ reason: 'dns' }), { code: 'models.dns', params: null })
assert.deepEqual(modelsFailure({ reason: 'refused' }), { code: 'models.refused', params: null })
assert.deepEqual(modelsFailure({ reason: 'unreachable' }), { code: 'models.unreachable', params: null })
assert.deepEqual(modelsFailure({ reason: 'http', status: 503 }), { code: 'models.http', params: { status: 503 } })
assert.deepEqual(modelsFailure({ reason: 'unknown' }), { code: 'models.network', params: null })
assert.deepEqual(modelsFailure(null), { code: 'models.network', params: null })
assert.deepEqual(modelsFailure({ reason: 'empty', status: 200 }), { code: 'models.empty', params: null })
assert.deepEqual(modelsFailure({ reason: 'proxy-reset' }), { code: 'models.proxy-reset', params: null })
assert.deepEqual(exchangeFailure({ reason: 'proxy-reset' }), { code: 'oauth.exchange-proxy-reset', params: null })

assert.deepEqual(idTokenFailure({ reason: 'timeout' }), { code: 'oauth.id-token-timeout', params: null })
assert.deepEqual(idTokenFailure({ reason: 'http', status: 500 }), { code: 'oauth.id-token-http', params: { status: 500 } })
assert.deepEqual(idTokenFailure({ reason: 'dns' }), { code: 'oauth.id-token-dns', params: null })
assert.deepEqual(idTokenFailure({ reason: 'refused' }), { code: 'oauth.id-token-refused', params: null })
assert.deepEqual(idTokenFailure({ reason: 'unreachable' }), { code: 'oauth.id-token-unreachable', params: null })
assert.deepEqual(idTokenFailure({ reason: 'proxy-reset' }), { code: 'oauth.id-token-proxy-reset', params: null })
assert.deepEqual(idTokenFailure({ reason: 'unknown' }), { code: 'oauth.id-token-network', params: null })
assert.deepEqual(idTokenFailure(null), { code: 'oauth.id-token-invalid', params: null })

// 自动续期失败：网络原因分开命名；认不出来的原因返回 null，宿主退回通用失败。
assert.deepEqual(refreshFailure({ reason: 'timeout' }), { code: 'token.refresh-timeout', params: null })
assert.deepEqual(refreshFailure({ reason: 'dns' }), { code: 'token.refresh-dns', params: null })
assert.deepEqual(refreshFailure({ reason: 'refused' }), { code: 'token.refresh-refused', params: null })
assert.deepEqual(refreshFailure({ reason: 'unreachable' }), { code: 'token.refresh-unreachable', params: null })
assert.deepEqual(refreshFailure({ reason: 'proxy-reset' }), { code: 'token.refresh-proxy-reset', params: null })
assert.deepEqual(refreshFailure({ reason: 'http', status: 503 }), { code: 'token.refresh-http', params: { status: 503 } })
assert.equal(refreshFailure({ reason: 'unknown' }), null)
assert.equal(refreshFailure(null), null)

// ---------- 4. 每个错误码在 13 种语言里都有文案 ----------
const reasons = ['region-blocked', 'timeout', 'dns', 'refused', 'unreachable', 'proxy-reset', 'http', 'unknown']
const codes = []
for (const reason of reasons) codes.push(exchangeFailure({ reason, status: 500 }).code)
for (const reason of reasons) codes.push(modelsFailure({ reason, status: 500 }).code)
codes.push(modelsFailure({ reason: 'empty', status: 200 }).code)
for (const reason of reasons) codes.push(idTokenFailure({ reason, status: 500 }).code)
for (const reason of reasons) codes.push(refreshFailure({ reason, status: 500 }) ? refreshFailure({ reason, status: 500 }).code : 'token.refresh-failed')
codes.push(idTokenFailure(null).code)

const placeholders = (text) => (String(text).match(/\{\w+\}/g) || []).sort().join(',')
for (const [language, dictionary] of Object.entries(LOCALES)) {
  for (const code of codes) {
    const key = 'error.' + code
    assert.equal(typeof dictionary[key], 'string', language + ' missing ' + key)
    assert.ok(dictionary[key].trim().length > 0, language + ' empty ' + key)
    assert.equal(placeholders(dictionary[key]), placeholders(LOCALES.en[key]), language + ' placeholders in ' + key)
  }
}
assert.ok(codes.length >= 12, 'the mapping must cover every failure reason')

// ---------- 5. 协议层把网络失败带出来 ----------
const { exchangeAuthorizationCode } = await import('../src/siwc.js')
const originalFetch = globalThis.fetch
const request = { clientId: 'oaiapp_test', code: 'synthetic-code', verifier: 'v', redirectUri: 'http://127.0.0.1:1/auth/callback' }
try {
  globalThis.fetch = async function () {
    const error = new Error('timed out')
    error.name = 'TimeoutError'
    throw error
  }
  const timedOut = await exchangeAuthorizationCode(request)
  assert.equal(timedOut.ok, false)
  assert.equal(timedOut.status, null)
  assert.deepEqual(timedOut.failure, { reason: 'timeout' })

  globalThis.fetch = async function () {
    return new Response(JSON.stringify({ error: { code: 'unsupported_country_region_territory' } }), {
      status: 403, headers: { 'content-type': 'application/json' },
    })
  }
  const blocked = await exchangeAuthorizationCode(request)
  assert.equal(blocked.ok, false)
  assert.deepEqual(blocked.failure, { reason: 'region-blocked', status: 403 })

  // undici 形状的连接被拒：顶层 TypeError，真码在 cause 上（代理端口没起的典型现场）。
  globalThis.fetch = async function () {
    const error = new TypeError('fetch failed')
    error.cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:7890'), { code: 'ECONNREFUSED' })
    throw error
  }
  const refused = await exchangeAuthorizationCode(request)
  assert.equal(refused.ok, false)
  assert.deepEqual(refused.failure, { reason: 'refused' })
} finally {
  globalThis.fetch = originalFetch
}

console.log('network failure classification + error code mapping: PASS')
