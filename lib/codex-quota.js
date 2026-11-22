// 可选的 Codex 额度通道。
//
// 官方 SIWC 的 access token 只被 api.openai.com/v1 接受；ChatGPT/Codex 的用量
// 端点（chatgpt.com/backend-api/wham/usage）拒绝它。因此要显示 5 小时/每周
// 百分比，只能继续使用本机已有的 Codex 登录（~/.codex/auth.json）。
//
// 这个模块只做一件事：文件存在时，在 access token 快过期前用旧版 Codex OAuth
// client 续期并原子写回，保留 Codex CLI 需要的全部结构。它不创建文件、不参与
// 推理；文件不存在就什么都不做。
//
// 续期要克制：refresh token 是轮换制的，本插件和 Codex CLI 共用同一份，抢着
// 续期可能让一边的登录失效。所以只有文件已经一段时间没被改动（说明 Codex CLI
// 近期没在运行、不会自己续期）时才代为续期；用户也可以用环境变量
// DSH_CHATGPT_CODEX_QUOTA_KEEP=off 完全关掉代续期（host 传入 enabled: false）。
import { chmodSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const FALLBACK_LIFETIME_SEC = 864000
const REFRESH_AHEAD_SEC = 45 * 60
// 文件至少这么久没被改动，才认为 Codex CLI 没在管这份登录、可以代为续期。
const DEFAULT_MIN_IDLE_MS = 30 * 60 * 1000

export function decodeJwtExp(token) {
  if (typeof token !== 'string' || token.length === 0) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return payload && typeof payload.exp === 'number' && isFinite(payload.exp) ? payload.exp : null
  } catch (err) {
    return null
  }
}

export function readCodexAuth(file) {
  let raw = null
  try { raw = readFileSync(file, 'utf8') } catch (err) {
    return { ok: false, reason: err && err.code === 'ENOENT' ? 'missing' : 'corrupt' }
  }
  try {
    const auth = JSON.parse(raw)
    if (!auth || typeof auth !== 'object' || Array.isArray(auth)) return { ok: false, reason: 'corrupt' }
    return { ok: true, auth: auth }
  } catch (err) {
    return { ok: false, reason: 'corrupt' }
  }
}

export function codexAccessExpiresAt(auth) {
  const tokens = auth && auth.tokens && typeof auth.tokens === 'object' ? auth.tokens : {}
  const exp = decodeJwtExp(typeof tokens.access_token === 'string' ? tokens.access_token : '')
  if (typeof exp === 'number') return exp
  const lastRefresh = auth && typeof auth.last_refresh === 'string' ? Date.parse(auth.last_refresh) : NaN
  if (isFinite(lastRefresh) && lastRefresh > 0) return Math.floor(lastRefresh / 1000) + FALLBACK_LIFETIME_SEC
  return null
}

export function codexNeedsRefresh(expiresAt, nowSeconds) {
  if (expiresAt == null) return true
  return expiresAt - nowSeconds < REFRESH_AHEAD_SEC
}

async function refreshCodexTokens(refreshToken, fetchImpl, timeoutMs) {
  const response = await fetchImpl('https://auth.openai.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CODEX_OAUTH_CLIENT_ID,
      refresh_token: refreshToken,
    }).toString(),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) return { ok: false, status: response.status }
  const body = await response.json().catch(function () { return null })
  if (!body || typeof body.access_token !== 'string' || body.access_token.length === 0) {
    return { ok: false, status: response.status }
  }
  return {
    ok: true,
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' && body.refresh_token.length > 0 ? body.refresh_token : null,
  }
}

function writeCodexAuth(file, auth, accessToken, refreshToken, nowIso) {
  const tokens = Object.assign({}, auth.tokens && typeof auth.tokens === 'object' ? auth.tokens : {}, {
    access_token: accessToken,
  })
  if (refreshToken) tokens.refresh_token = refreshToken
  const updated = Object.assign({}, auth, { tokens: tokens, last_refresh: nowIso })
  const tmp = file + '.tmp'
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(tmp, JSON.stringify(updated, null, 2) + '\n', { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, file)
  chmodSync(file, 0o600)
  return updated
}

/**
 * Keep an existing Codex login fresh for quota display.
 * Never creates the file; a missing file is a normal no-op.
 * Conservative by design: it only refreshes when the file has been left
 * untouched for a while (Codex CLI not actively managing it), and callers
 * can disable the keep-alive entirely with `enabled: false`.
 * @param {string} file
 * @param {{ fetchImpl?: typeof fetch, now?: number, timeoutMs?: number, log?: (msg: string) => void, enabled?: boolean, minIdleMs?: number }} [options]
 */
export async function keepCodexQuota(file, options) {
  const opts = options && typeof options === 'object' ? options : {}
  if (opts.enabled === false) return { ok: true, refreshed: false, skipped: 'disabled' }
  const nowMs = typeof opts.now === 'number' ? opts.now : Date.now()
  const fetchImpl = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : fetch
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 20000
  const minIdleMs = typeof opts.minIdleMs === 'number' && opts.minIdleMs >= 0 ? opts.minIdleMs : DEFAULT_MIN_IDLE_MS
  const log = typeof opts.log === 'function' ? opts.log : function () {}
  const read = readCodexAuth(file)
  if (!read.ok) return { ok: false, reason: read.reason }
  const tokens = read.auth.tokens && typeof read.auth.tokens === 'object' ? read.auth.tokens : {}
  const access = typeof tokens.access_token === 'string' ? tokens.access_token : ''
  if (!access) return { ok: false, reason: 'no-access' }
  if (!codexNeedsRefresh(codexAccessExpiresAt(read.auth), Math.floor(nowMs / 1000))) {
    return { ok: true, refreshed: false }
  }
  // 轮换制 refresh token 与 Codex CLI 共用：文件刚被改动过，说明 CLI 近期在
  // 运行、会自己续期，本插件这轮不插手，避免两边抢续期把登录弄失效。
  let mtimeMs = null
  try { mtimeMs = statSync(file).mtimeMs } catch (err) { mtimeMs = null }
  if (mtimeMs == null) return { ok: false, reason: 'stat' }
  if (nowMs - mtimeMs < minIdleMs) return { ok: true, refreshed: false, skipped: 'recently-modified' }
  const refresh = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : ''
  if (!refresh) return { ok: false, reason: 'no-refresh' }
  let result = null
  try {
    result = await refreshCodexTokens(refresh, fetchImpl, timeoutMs)
  } catch (err) {
    return { ok: false, reason: 'network' }
  }
  if (!result.ok) {
    log('codex quota token refresh failed with status ' + (result.status || 'unknown'))
    return { ok: false, reason: 'http', status: result.status }
  }
  try {
    writeCodexAuth(file, read.auth, result.accessToken, result.refreshToken, new Date(nowMs).toISOString())
  } catch (err) {
    return { ok: false, reason: 'write' }
  }
  return { ok: true, refreshed: true }
}
