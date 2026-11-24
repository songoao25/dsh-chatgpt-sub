// dsh-chatgpt-sub — Sign in with ChatGPT（SIWC）协议实现
//
// 只依赖 Node 标准库，便于在测试里单独求值：
//   OAuth（PKCE + 动态注册 + host id）、令牌刷新/撤销、ID token 校验、
//   /v1/models 解析、Responses 请求体规范化（工具 namespace、禁用字段）。
//
// 设计约束（来自官方文档 https://developers.openai.com/siwc/token-sharing-open-source）：
//   - 首次授权 client_id=dynamic_agent_client，回调里拿颁发的 oaiapp_…；
//   - 每个安装必须有稳定的 ext_agent_host_id（urn:uuid:…）；
//   - 回调必须是 http://127.0.0.1:<port>/auth/callback，不能用 localhost；
//   - 推理走 https://api.openai.com/v1/responses，store:false + stream:true；
//   - 工具必须放进 namespace，或通过 additional_tools 输入项提供；
//   - system 消息必须改成 developer 消息。

import { classifyHttpFailure, classifyNetworkError } from './network.js'

export const AUTH_ORIGIN = 'https://auth.openai.com'
export const AUTHORIZE_URL = AUTH_ORIGIN + '/api/accounts/authorize'
export const TOKEN_URL = AUTH_ORIGIN + '/api/accounts/oauth/token'
export const OIDC_URL = AUTH_ORIGIN + '/.well-known/openid-configuration'
export const DEFAULT_JWKS_URL = AUTH_ORIGIN + '/.well-known/jwks.json'
export const DEFAULT_REVOKE_URL = AUTH_ORIGIN + '/api/accounts/oauth/revoke'
export const API_ORIGIN = 'https://api.openai.com/v1'
export const RESOURCE = API_ORIGIN
export const DYNAMIC_CLIENT_ID = 'dynamic_agent_client'
export const CALLBACK_PATH = '/auth/callback'
export const APP_NAME_HINT = 'DSH ChatGPT 订阅'
export const PLAN_USAGE_SCOPE = 'chatgpt.tokens.use.direct'
export const OAUTH_SCOPE = 'openid profile email offline_access resource.invoke ' + PLAN_USAGE_SCOPE

// Responses 允许的顶层字段白名单。没列在这里的一律不发：
// SIWC 对 max_output_tokens / temperature / top_p / truncation / metadata /
// prompt_cache_retention 等返回 subscription_sharing_unsupported_capability。
const RESPONSES_ALLOWED_KEYS = [
  'model', 'input', 'instructions', 'tools', 'tool_choice',
  'parallel_tool_calls', 'reasoning', 'stream', 'store', 'prompt_cache_key',
]

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

// ---------- PKCE / state / nonce ----------

export function createPkcePair(randomBytes, createHash) {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier: verifier, challenge: challenge }
}

export function newState(randomBytes) {
  return randomBytes(24).toString('base64url')
}

// ---------- 授权 URL ----------

export function buildAuthorizeUrl(input) {
  const opts = isObject(input) ? input : {}
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', opts.clientId || DYNAMIC_CLIENT_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', opts.redirectUri)
  url.searchParams.set('scope', OAUTH_SCOPE)
  url.searchParams.set('resource', RESOURCE)
  url.searchParams.set('state', opts.state)
  url.searchParams.set('nonce', opts.nonce)
  url.searchParams.set('code_challenge', opts.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  if (isNonEmptyString(opts.hostId)) url.searchParams.set('ext_agent_host_id', opts.hostId)
  // agent_name_hint 只在首次动态注册时出现；用颁发 client_id 重新授权时省略。
  if (opts.clientId === DYNAMIC_CLIENT_ID && isNonEmptyString(opts.agentNameHint)) {
    url.searchParams.set('agent_name_hint', opts.agentNameHint)
  }
  if (isNonEmptyString(opts.idTokenHint)) url.searchParams.set('id_token_hint', opts.idTokenHint)
  if (isNonEmptyString(opts.loginHint)) url.searchParams.set('login_hint', opts.loginHint)
  return url.toString()
}

// 回调参数解析：只接受 code/state/client_id/error/scope/error_description。
export function parseCallbackParams(input) {
  if (!isObject(input)) return { error: null, code: null, state: null, clientId: null }
  return {
    error: isNonEmptyString(input.error) ? input.error : null,
    code: isNonEmptyString(input.code) ? input.code : null,
    state: isNonEmptyString(input.state) ? input.state : null,
    clientId: isNonEmptyString(input.client_id) ? input.client_id : null,
    scope: isNonEmptyString(input.scope) ? input.scope : null,
  }
}

// ---------- 令牌端点 ----------

function formBody(fields) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  }
  return params.toString()
}

// 网络失败不抛异常：调用方要能把「连不上」和「服务端返回 4xx/5xx」分开，
// 所以这里把失败也变成返回值（failure），由调用方决定错误码。
async function postForm(url, fields, signal) {
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: formBody(fields),
      signal: signal || AbortSignal.timeout(20000),
    })
  } catch (err) {
    return { status: null, ok: false, body: null, text: '', failure: classifyNetworkError(err) }
  }
  const text = await response.text().catch(function () { return '' })
  let body = null
  try { body = text.length > 0 ? JSON.parse(text) : null } catch (err) { body = null }
  return { status: response.status, ok: response.ok, body: body, text: text, failure: null }
}

// 授权码换令牌：client_id 必须是回调里颁发的 oaiapp_…；没有 client secret。
export async function exchangeAuthorizationCode(input, signal) {
  const result = await postForm(TOKEN_URL, {
    grant_type: 'authorization_code',
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.verifier,
    redirect_uri: input.redirectUri,
    resource: RESOURCE,
  }, signal)
  if (!result.ok || !isObject(result.body) || !isNonEmptyString(result.body.access_token)) {
    const failure = result.failure || classifyHttpFailure(result.status, result.body)
    return { ok: false, status: result.status, error: result.body && result.body.error, body: result.body, failure: failure }
  }
  return { ok: true, status: result.status, tokens: parseTokenResponse(result.body) }
}

// 刷新：client_id 用颁发的 oaiapp_…（不是 dynamic_agent_client），省略 scope。
export async function refreshTokens(input, signal) {
  const result = await postForm(TOKEN_URL, {
    grant_type: 'refresh_token',
    client_id: input.clientId,
    refresh_token: input.refreshToken,
    resource: RESOURCE,
  }, signal)
  if (!result.ok || !isObject(result.body) || !isNonEmptyString(result.body.access_token)) {
    const failure = result.failure || classifyHttpFailure(result.status, result.body)
    return { ok: false, status: result.status, error: result.body && result.body.error, body: result.body, failure: failure }
  }
  return { ok: true, status: result.status, tokens: parseTokenResponse(result.body) }
}

export function parseTokenResponse(body) {
  const scopes = isNonEmptyString(body.scope) ? body.scope.split(/\s+/).filter(Boolean) : []
  const expiresIn = typeof body.expires_in === 'number' && isFinite(body.expires_in) && body.expires_in > 0
    ? body.expires_in
    : 3600
  return {
    accessToken: body.access_token,
    refreshToken: isNonEmptyString(body.refresh_token) ? body.refresh_token : null,
    idToken: isNonEmptyString(body.id_token) ? body.id_token : null,
    tokenType: isNonEmptyString(body.token_type) ? body.token_type : 'Bearer',
    expiresIn: expiresIn,
    scopes: scopes,
    earliestRefreshAt: parseEarliestRefreshAt(body.earliest_refresh_at),
  }
}

// earliest_refresh_at 官方未定义格式：Unix 秒 / 毫秒 / ISO 都接受；认不出就忽略。
export function parseEarliestRefreshAt(value) {
  if (typeof value === 'number' && isFinite(value) && value > 0) {
    return value < 1e12 ? value * 1000 : value
  }
  if (typeof value === 'string' && value.length > 0) {
    const asNumber = Number(value)
    if (isFinite(asNumber) && asNumber > 0) return asNumber < 1e12 ? asNumber * 1000 : asNumber
    const parsed = Date.parse(value)
    if (isFinite(parsed)) return parsed
  }
  return null
}

// 撤销 refresh token。端点从 OIDC 配置读取，读不到用官方默认值。
export async function revokeRefreshToken(input, signal) {
  let endpoint = DEFAULT_REVOKE_URL
  try {
    const discovery = await fetch(OIDC_URL, { signal: signal || AbortSignal.timeout(8000) })
    if (discovery.ok) {
      const config = await discovery.json()
      if (isObject(config) && isNonEmptyString(config.revocation_endpoint)) endpoint = config.revocation_endpoint
    }
  } catch (err) { /* 用默认端点 */ }
  try {
    const result = await postForm(endpoint, {
      token: input.refreshToken,
      token_type_hint: 'refresh_token',
      client_id: input.clientId,
    }, signal)
    return { ok: result.status === 200 || result.status === 204, status: result.status }
  } catch (err) {
    return { ok: false, status: null }
  }
}

// ---------- JWT / ID token 校验 ----------

export function decodeJwt(token) {
  if (!isNonEmptyString(token)) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'))
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (!isObject(header) || !isObject(payload)) return null
    return { header: header, payload: payload, signingInput: parts[0] + '.' + parts[1], signature: parts[2] }
  } catch (err) {
    return null
  }
}

export function decodeJwtPayload(token) {
  const decoded = decodeJwt(token)
  return decoded ? decoded.payload : null
}

export function jwtExpiresAt(token) {
  const payload = decodeJwtPayload(token)
  return payload && typeof payload.exp === 'number' && isFinite(payload.exp) ? payload.exp * 1000 : null
}

// 抛错时把失败原因挂在 error.failure 上：调用方要能区分「网络没通」和「签名校验不过」，
// 两者给用户的建议完全不同。
async function fetchJwks(url, signal) {
  let response
  try {
    response = await fetch(url, { signal: signal || AbortSignal.timeout(10000), headers: { accept: 'application/json' } })
  } catch (err) {
    throw Object.assign(new Error('JWKS request failed: ' + String((err && err.message) || err)), { failure: classifyNetworkError(err) })
  }
  if (!response.ok) {
    throw Object.assign(new Error('JWKS request failed: ' + response.status), { failure: classifyHttpFailure(response.status, null) })
  }
  const body = await response.json()
  return isObject(body) && Array.isArray(body.keys) ? body.keys : []
}

// 按官方要求验签 + 校验 iss/aud/exp/nonce。任何一步失败都抛错，调用方不得保存凭证。
export async function verifyIdToken(idToken, options, deps) {
  const opts = isObject(options) ? options : {}
  const decoded = decodeJwt(idToken)
  if (!decoded) throw new Error('ID token is not a JWT')
  const alg = decoded.header.alg
  if (alg !== 'RS256') throw new Error('ID token algorithm is not RS256')
  const jwksUrl = isNonEmptyString(opts.jwksUrl) ? opts.jwksUrl : DEFAULT_JWKS_URL
  const keys = await fetchJwks(jwksUrl, opts.signal)
  const jwk = keys.find(function (key) { return isObject(key) && key.kid === decoded.header.kid && key.kty === 'RSA' })
  if (!jwk) throw new Error('ID token signing key was not published')
  const crypto = deps && deps.crypto ? deps.crypto : await import('node:crypto')
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' })
  const valid = crypto.verify('RSA-SHA256', Buffer.from(decoded.signingInput), key, Buffer.from(decoded.signature, 'base64url'))
  if (!valid) throw new Error('ID token signature is invalid')
  const claims = decoded.payload
  if (claims.iss !== AUTH_ORIGIN) throw new Error('ID token issuer is invalid')
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (opts.clientId && !audience.includes(opts.clientId)) throw new Error('ID token audience is invalid')
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) throw new Error('ID token has expired')
  if (opts.nonce && claims.nonce !== opts.nonce) throw new Error('ID token nonce is invalid')
  if (!isNonEmptyString(claims.sub)) throw new Error('ID token has no subject')
  return claims
}

// 账号展示信息：邮箱与套餐都从 ID token 读；读不到就是 null，不猜。
export function accountFromIdToken(idToken) {
  const claims = decodeJwtPayload(idToken)
  if (!claims) return { subject: null, email: null, plan: null, planExpiresAt: null }
  const auth = isObject(claims['https://api.openai.com/auth']) ? claims['https://api.openai.com/auth'] : {}
  const plan = isNonEmptyString(auth.chatgpt_plan_type) ? auth.chatgpt_plan_type
    : isNonEmptyString(claims.chatgpt_plan_type) ? claims.chatgpt_plan_type : null
  const activeUntil = isNonEmptyString(auth.chatgpt_subscription_active_until) ? auth.chatgpt_subscription_active_until
    : isNonEmptyString(claims.chatgpt_subscription_active_until) ? claims.chatgpt_subscription_active_until : null
  let planExpiresAt = null
  if (activeUntil) {
    const parsed = Date.parse(activeUntil)
    if (isFinite(parsed)) planExpiresAt = parsed
  }
  return {
    subject: isNonEmptyString(claims.sub) ? claims.sub : null,
    email: isNonEmptyString(claims.email) ? claims.email : null,
    plan: plan,
    planExpiresAt: planExpiresAt,
  }
}

// 邮箱脱敏：本地部分最多留前 2 位，域名保留；不把完整邮箱送进前端。
export function maskEmail(email) {
  if (!isNonEmptyString(email)) return null
  const at = email.indexOf('@')
  if (at <= 0 || at === email.length - 1) return null
  const local = email.slice(0, at)
  return local.slice(0, local.length > 2 ? 2 : 1) + '•••' + email.slice(at)
}

export function hasPlanUsage(scopes) {
  return Array.isArray(scopes) && scopes.includes(PLAN_USAGE_SCOPE)
}

// ---------- 模型目录 ----------

// /v1/models 的形状：{ models: [{ slug, display_name, visibility }] }，与 API key 的 data/id 不同。
export function parseModelList(json) {
  if (!isObject(json) || !Array.isArray(json.models)) return []
  const models = []
  for (const entry of json.models) {
    if (!isObject(entry)) continue
    // 只丢「明确标成不可列出」的条目。visibility 是可选字段：某条不带它，
    // 不代表这条不可见；以前只要同批里有一条带 visibility，其余不带的全被丢掉。
    if (typeof entry.visibility === 'string' && entry.visibility !== 'list') continue
    if (!isNonEmptyString(entry.slug)) continue
    models.push({
      id: entry.slug,
      name: isNonEmptyString(entry.display_name) ? entry.display_name : entry.slug,
    })
  }
  return models
}

// ---------- Responses 请求体规范化 ----------

// 把 pi-ai 发来的请求体改成 SIWC 能接受的样子：
//   - 只保留白名单字段；
//   - system 消息改 developer；
//   - 工具整体包进一个 namespace；
//   - 丢掉 reasoning/item_reference 等 store:false 下不该重放的输入项。
// 返回新对象，不修改入参。
export function normalizeResponsesBody(body) {
  if (!isObject(body)) throw new Error('Responses request body must be an object')
  const next = {}
  for (const key of RESPONSES_ALLOWED_KEYS) {
    if (body[key] !== undefined) next[key] = body[key]
  }
  next.store = false
  next.stream = true

  if (typeof next.input === 'string') {
    next.input = [{ role: 'user', content: [{ type: 'input_text', text: next.input }] }]
  }
  if (Array.isArray(next.input)) {
    next.input = next.input
      .filter(function (item) {
        if (!isObject(item)) return false
        if (item.type === 'reasoning' || item.type === 'item_reference') return false
        return true
      })
      .map(function (item) {
        if (item.role === 'system') return Object.assign({}, item, { role: 'developer' })
        return item
      })
  }

  if (Array.isArray(next.tools) && next.tools.length > 0) {
    const alreadyNamespaced = next.tools.some(function (tool) { return isObject(tool) && tool.type === 'namespace' })
    if (!alreadyNamespaced) {
      next.tools = [{
        type: 'namespace',
        name: 'dsh',
        description: 'Tools provided by DeepSeek Harness',
        tools: next.tools,
      }]
    }
    if (isObject(next.tool_choice)) next.tool_choice = 'auto'
  }

  return next
}
