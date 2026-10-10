// dsh-chatgpt-sub — host half（静态 bundle 形态）
// 业务：ChatGPT 订阅官方 OAuth 绑定 + 令牌看护 + openai-codex 路由注册
// 独立插件：绑定/令牌管理；dsh-bottom-info-bar 只读令牌显示额度
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { LOCALES } from './locales.js'

const DATA_DIR = process.env.DSH_CHATGPT_DATA_DIR || join(homedir(), '.dsh', 'dsh-chatgpt-sub')
// 一次性迁移：0.3.x 时包名是 dsh-chatgpt-subscription，绑定标记目录随包名升级。
// 默认路径下旧目录存在、新目录不存在时整体搬移（绑定标记跟着走，用户不用重新绑定）；
// 显式指定 DSH_CHATGPT_DATA_DIR 的是开发/测试隔离场景，一律不动。
// 搬移失败就落在新目录从头开始：auth.json 里的令牌不受影响，代价只是重新绑定一次。
const LEGACY_DATA_DIR = join(homedir(), '.dsh', 'dsh-chatgpt-subscription')
if (!process.env.DSH_CHATGPT_DATA_DIR && existsSync(LEGACY_DATA_DIR) && !existsSync(DATA_DIR)) {
  try { renameSync(LEGACY_DATA_DIR, DATA_DIR); } catch { }
}
const CODEX_BIND_FILE = process.env.DSH_CHATGPT_BIND_FILE || join(DATA_DIR, 'codex-bind.json')

const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann' // OpenAI OAuth 公开 client_id（token 续期用，非密钥）
const CODEX_DEFAULT_MODEL = process.env.DSH_CHATGPT_DEFAULT_MODEL || 'gpt-5.6-luna'
const CODEX_AUTH_FILE = process.env.DSH_CHATGPT_AUTH || join(homedir(), '.codex', 'auth.json')
const OAUTH_CALLBACK_TIMEOUT_MS = Number(process.env.DSH_CHATGPT_OAUTH_TIMEOUT_MS) > 0 ? Number(process.env.DSH_CHATGPT_OAUTH_TIMEOUT_MS) : 5 * 60 * 1000
const OAUTH_CALLBACK_PATH = '/auth/callback'

// 纯路由判定便于回归测试：只有已绑定且令牌状态健康、当前默认选择为 ChatGPT，
// 才能进入 ChatGPT 模式；其他情况都回到 DeepSeek 模式。
function routingModeFor(bound, bridgeHealthy, provider) {
  return bound === true && bridgeHealthy === true && provider === 'openai-codex' ? 'chatgpt' : 'deepseek'
}

// DSH 0.1.7 起 settings 服务换成 SettingsForms：get(ns) 被整块移除，只剩
// describe() / update() / replace() / mutate()，描述项形如
//   [{ ns: 'llm-pi-ai', value: { providers: { … } }, revision: 3, … }]
// （value 是 schema 默认 → 组合基线 → 用户层解析后的当前值，且敏感字段已脱敏）。
// 读某一节统一走这里：新宿主优先 describe()，旧宿主退回 get(ns)，都读不到返回 undefined。
// 写回一律用 mutate()——新旧宿主都支持，不需要分支。
// 纯函数，便于回归测试（tests/test-codex-host.js 按名提取后整体求值）。
function readSettingsSection(settings, ns) {
  if (!settings || typeof settings !== 'object') return undefined
  if (typeof settings.describe === 'function') {
    try {
      const described = settings.describe()
      if (Array.isArray(described)) {
        for (const entry of described) {
          if (entry && entry.ns === ns) return entry.value
        }
      }
    } catch (err) { /* describe 不可用时落到旧宿主路径 */ }
  }
  if (typeof settings.get === 'function') {
    try { return settings.get(ns) } catch (err) { return undefined }
  }
  return undefined
}

// 宿主是否具备「能读 + 能写」的 settings 能力：0.1.6 要 get+mutate，0.1.7 要 describe+mutate。
function settingsServiceReady(settings) {
  if (!settings || typeof settings.mutate !== 'function') return false
  return typeof settings.describe === 'function' || typeof settings.get === 'function'
}

const CODEX_JWT_ACCOUNT_CLAIM = 'https://api.openai.com/auth' // access_token JWT payload 里账号声明的命名空间键（wham 账号提取用）
const OAUTH_SCOPE = 'openid profile email offline_access' // 官方授权 scope（与 pi-ai/Codex CLI 一致；offline_access 换 refresh_token）

// ---------- 用户可见文案（集中收口，避免同一语义在同步与授权两条路径上各写一份而漂移） ----------
// 写作原则：不出现术语（令牌/凭据/注入/路由/环境变量/文件路径），每条都要有「发生了什么 + 你现在该做什么」。
const MSG_CREDENTIAL_CONFLICT = 'DSH 里存着另一个 OpenAI 账号的登录信息，不是本插件刚绑定的这个，所以本插件不会动它。\n如果你确实想用刚绑定的账号，请先到 DSH 的凭据设置里删掉那一条，再回来点「重新绑定」。'
const MSG_ROUTE_CONFLICT = 'DSH 里已经有一条同名的 ChatGPT 通道，那是你自己配置的，本插件不会改动它。\n如果想交给本插件管理，请先删除那一条，再点「重新绑定」。'

// ---------- 绑定标记（严格官方模式唯一事实） ----------
// 语义：只有本插件 OAuth 绑定成功写入的标记存在且 bound=true 时，才注入令牌到 DSH 凭据。
// codex CLI 自己的令牌（无标记）绝不被自动使用——彻底废弃旧"读登录态"桥接来源。
// 文件路径可由 DSH_CHATGPT_BIND_FILE 覆盖（测试隔离）。
function readBindFlag(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) filePath = CODEX_BIND_FILE
  let raw = null
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (err) {
    return { ok: false, bound: false }
  }
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, bound: false }
    return {
      ok: true,
      bound: data.bound === true,
      boundAt: typeof data.boundAt === 'string' ? data.boundAt : null,
      routeOwned: data.routeOwned === true,
      defaultModelManaged: data.defaultModelManaged === true,
      previousDefaultModel: data.previousDefaultModel && typeof data.previousDefaultModel === 'object' ? data.previousDefaultModel : null,
      credentialManaged: data.credentialManaged === true,
    }
  } catch (err) {
    return { ok: false, bound: false }
  }
}

// 原子写绑定标记（tmp+rename 防写一半；0600；目录自动创建）；data 可带 plan 等扩展字段
function writeBindFlag(filePath, data) {
  const payload = Object.assign({ bound: true, boundAt: new Date().toISOString() }, data || {})
  const tmp = filePath + '.tmp'
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
  writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, filePath)
  chmodSync(filePath, 0o600)
  return payload
}

// 清绑定标记（删除文件）；文件已缺失视为已清，不抛错
function clearBindFlag(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) filePath = CODEX_BIND_FILE
  try {
    unlinkSync(filePath)
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw err
  }
}

const CODEX_TOKEN_FALLBACK_LIFETIME_SEC = 864000
// 过期前提前量（秒）：JWT 剩余寿命 < 45 分钟才续期（10 天寿命下极少触发，避免窗口内过期）
const CODEX_REFRESH_AHEAD_SEC = 45 * 60
// 桥接同步周期（毫秒）：启动即跑一次 + 每 30 分钟维护（与订阅额度刷新相互独立）
const CODEX_SYNC_INTERVAL_MS = 30 * 60 * 1000

// base64url → UTF-8 字符串（JWT payload 段解码：-/_ 换回 +// 后按标准 base64 解，容忍缺 padding）
function decodeBase64Url(input) {
  if (typeof input !== 'string' || input.length === 0) return null
  try {
    return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  } catch (err) {
    return null
  }
}

// JWT payload 通用解码：标准 JWT 取第 2 段；非 JWT/损坏/非对象 → null。
// 只做只读解码，令牌值始终留在内存，不打印、不落盘、不进日志。
function decodeJwtPayload(token) {
  if (typeof token !== 'string' || token.length === 0) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const raw = decodeBase64Url(parts[1])
  if (raw == null) return null
  try {
    const payload = JSON.parse(raw)
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null
  } catch (err) {
    return null
  }
}

// JWT exp 解码（秒）：标准 JWT 取第 2 段 payload 的 exp；非 JWT/损坏/缺 exp → null（调用方走 last_refresh 兜底）
function decodeJwtExp(token) {
  const payload = decodeJwtPayload(token)
  const exp = payload && payload.exp
  return typeof exp === 'number' && isFinite(exp) && exp > 0 ? exp : null
}

// 归一化令牌过期时刻（秒）：JWT exp 优先；无效 → last_refresh（毫秒）+ 10 天兜底；两者皆无 → null
function codexExpiresAt(expSeconds, lastRefreshMs) {
  if (typeof expSeconds === 'number' && isFinite(expSeconds) && expSeconds > 0) return expSeconds
  if (typeof lastRefreshMs === 'number' && isFinite(lastRefreshMs) && lastRefreshMs > 0) {
    return Math.floor(lastRefreshMs / 1000) + CODEX_TOKEN_FALLBACK_LIFETIME_SEC
  }
  return null
}

// 续期决策（秒精度）：剩余 < 45 分钟或无法判定过期 → true（保守续期，宁多刷不放过期）
function codexNeedsRefresh(expiresAtSeconds, nowSeconds) {
  if (expiresAtSeconds == null) return true
  return expiresAtSeconds - nowSeconds < CODEX_REFRESH_AHEAD_SEC
}

// 读 auth.json：{ ok:true, auth } 或 { ok:false, reason:'missing'|'corrupt' }（缺失/损坏一律不抛异常）
function readCodexAuthFile(filePath) {
  let raw = null
  try {
    raw = readFileSync(filePath, 'utf8')
  } catch (err) {
    return { ok: false, reason: err && err.code === 'ENOENT' ? 'missing' : 'corrupt' }
  }
  let auth = null
  try {
    auth = JSON.parse(raw)
  } catch (err) {
    return { ok: false, reason: 'corrupt' }
  }
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) return { ok: false, reason: 'corrupt' }
  return { ok: true, auth: auth }
}

// 原子写回 auth.json：只更新 access_token/refresh_token/last_refresh，保留完整结构（auth_mode/OPENAI_API_KEY/
// tokens 内 account_id、id_token 等一律不动——绝不弄坏 Codex CLI 登录态）；tmp+rename 防写一半；0600 权限
function writeAuthJson(filePath, currentAuth, accessToken, refreshToken, lastRefreshIso) {
  const updated = {
    ...currentAuth,
    tokens: { ...(currentAuth.tokens && typeof currentAuth.tokens === 'object' ? currentAuth.tokens : {}), access_token: accessToken, refresh_token: refreshToken },
    last_refresh: lastRefreshIso,
  }
  const tmp = filePath + '.tmp'
  writeFileSync(tmp, JSON.stringify(updated, null, 2) + '\n', { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, filePath)
  chmodSync(filePath, 0o600)
  return updated
}

// 用 refresh_token 向官方 OAuth 端点换新令牌对；凭据仅经 HTTPS body 传递（不进子进程，无 shell 注入面）
// 响应缺 access_token（空串/null）→ 返回 null（调用方不得写回）；refresh_token 未轮换 → 返回 null 字段表示沿用旧值
async function refreshCodexTokenPair(refreshToken) {
  try {
    const res = await fetch('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CODEX_OAUTH_CLIENT_ID,
        refresh_token: refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const body = await res.json()
    if (!body || typeof body.access_token !== 'string' || body.access_token.length === 0) return null
    return {
      access_token: body.access_token,
      refresh_token: typeof body.refresh_token === 'string' && body.refresh_token.length > 0 ? body.refresh_token : null,
    }
  } catch (err) {
    return null // 网络/超时等异常 → 调用方按"续期失败"降级（保留旧凭据）
  }
}

// ---------- ChatGPT 订阅官方 OAuth 绑定（v1.2.0）纯逻辑：PKCE / 授权 URL / 回调解析 / 令牌交换 / 写回 ----------
// 安全铁律：verifier/state/令牌仅内存（verifier 用完即弃）；不打印、不进日志、不进仓库；唯一落盘 =
// ~/.codex/auth.json（0600）与 DSH 凭据库（0600）；回调 server 仅 127.0.0.1 + state 校验防 CSRF。

// OAuth 回调端口：生产必须为 1455（redirect_uri 与 OpenAI 注册值固定一致）；DSH_CHATGPT_OAUTH_PORT 仅测试隔离用
function oauthCallbackPort() {
  const v = Number(process.env.DSH_CHATGPT_OAUTH_PORT)
  return Number.isInteger(v) && v > 0 && v < 65536 ? v : 1455
}

// PKCE 对：verifier = 32 字节 base64url；challenge = 对 verifier 做 sha256 哈希后再 base64url 编码（S256）
function createPkcePair() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier: verifier, challenge: challenge }
}

// 构造授权跳转 URL（auth.openai.com/oauth/authorize；参数与 pi-ai/Codex CLI 一致；不含任何机密）
function buildAuthorizeUrl(state, codeChallenge) {
  const url = new URL('https://auth.openai.com/oauth/authorize')
  url.searchParams.set('client_id', CODEX_OAUTH_CLIENT_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', 'http://localhost:' + oauthCallbackPort() + OAUTH_CALLBACK_PATH)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('scope', OAUTH_SCOPE)
  return url.toString()
}

// 解析回调（完整 URL 的 query/hash、查询串、手贴 'code#state'、裸 code）；缺参返回 null 字段
function parseCallbackUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return { code: null, state: null }
  const raw = url.trim()
  // ① 完整 URL：query 参数优先，hash 参数兜底（兼容 OAuth hash 响应）
  try {
    const u = new URL(raw)
    let code = u.searchParams.get('code')
    let state = u.searchParams.get('state')
    if (u.hash && u.hash.length > 1) {
      const hp = new URLSearchParams(u.hash.slice(1))
      if (code == null) code = hp.get('code')
      if (state == null) state = hp.get('state')
    }
    return { code: code, state: state }
  } catch (err) { /* 非完整 URL → ②/③/④ */ }
  // ② 手贴格式 'code#state'
  if (raw.indexOf('#') >= 0 && raw.indexOf('://') < 0) {
    const parts = raw.split('#')
    const first = parts[0]
    if (first && first.indexOf('=') < 0) {
      const rest = parts.slice(1).join('#')
      const sp = new URLSearchParams(rest)
      return { code: first, state: sp.get('state') != null ? sp.get('state') : rest }
    }
  }
  // ③ 查询串 'code=..&state=..'
  const q = raw.indexOf('?') >= 0 ? raw.slice(raw.indexOf('?') + 1) : raw
  const sp2 = new URLSearchParams(q)
  if (sp2.has('code') || sp2.has('state')) return { code: sp2.get('code'), state: sp2.get('state') }
  // ④ 裸 code（手动粘贴单值）
  if (raw.length > 0 && raw.indexOf('=') < 0 && raw.indexOf('#') < 0) return { code: raw, state: null }
  return { code: null, state: null }
}

// 从 access_token JWT payload 提取 chatgpt_account_id（wham 额度接口所需）；失败 → null
function codexAccountIdFromJwt(token) {
  const payload = decodeJwtPayload(token)
  const auth = payload && payload[CODEX_JWT_ACCOUNT_CLAIM]
  const id = auth && auth.chatgpt_account_id
  return typeof id === 'string' && id.length > 0 ? id : null
}

// 令牌是否已过期（秒精度）：exp 可判定且已过 → true；无法判定（非 JWT / 缺 exp）→ false（不做无根据的否定）
function codexIsTokenExpired(token, nowSeconds) {
  const exp = decodeJwtExp(token)
  if (typeof exp !== 'number') return false
  return exp <= nowSeconds
}

// 判定 DSH 凭据槽里那份 OpenAI 登录信息能否被本插件接管。
//
// 【为什么需要这个函数】v0.1.0 写入的绑定标记只有 { bound, boundAt }，没有「凭据归本插件所有」这一栏。
// 旧判定在这种情况下退化成「槽位非空即视为他人所有」，而槽里躺的恰恰是插件自己早期注入的令牌，
// 于是插件把自己永久锁在门外（2026-08-20 起常驻「检测到用户已有…插件不会覆盖」红字，连重新授权都救不回来）。
// 根治办法不是再加一条特例，而是让归属判定建立在**可自证的证据**上：逐字节同值、同一 ChatGPT 账号，
// 都属于"这份凭据只可能来自同一来源"，无需依赖任何历史记账。
//
// 判据按强度递减，命中即允许接管：
//   owned         进程内已确认是本插件写入的
//   managed       绑定标记记录了「凭据归本插件所有」
//   empty         槽位为空 → 首次注入
//   same-value    槽内令牌与本插件当前令牌逐字节相同 → 同源
//   same-account  两者属于同一 ChatGPT 账号 → 同一来源的新旧版本
//   expired-stale 插件处于已绑定状态、槽内令牌已过期而新令牌有效 → 过期凭据对任何人都没有价值
//   other         其余一律拒绝：真正的他人凭据，绝不覆盖
// 返回 { claim, reason }；reason 仅供测试与排障，不进入任何用户可见文案。
function classifyCodexCredential(existingValue, candidateToken, options) {
  const opts = options && typeof options === 'object' ? options : {}
  if (opts.ownedInProcess === true) return { claim: true, reason: 'owned' }
  if (opts.managed === true) return { claim: true, reason: 'managed' }
  const existing = typeof existingValue === 'string' ? existingValue : ''
  if (existing.length === 0) return { claim: true, reason: 'empty' }
  const candidate = typeof candidateToken === 'string' ? candidateToken : ''
  if (candidate.length === 0) return { claim: false, reason: 'no-candidate' }
  if (existing === candidate) return { claim: true, reason: 'same-value' }
  const existingAccount = codexAccountIdFromJwt(existing)
  const candidateAccount = codexAccountIdFromJwt(candidate)
  if (existingAccount && candidateAccount && existingAccount === candidateAccount) return { claim: true, reason: 'same-account' }
  const nowSec = typeof opts.nowSeconds === 'number' ? opts.nowSeconds : Math.floor(Date.now() / 1000)
  if (opts.boundFlag === true && codexIsTokenExpired(existing, nowSec) && !codexIsTokenExpired(candidate, nowSec)) {
    return { claim: true, reason: 'expired-stale' }
  }
  return { claim: false, reason: 'other' }
}

// 账本迁移：把「这份凭据归本插件所有」补记进绑定标记，并保留既有字段与首次绑定时间。
// 迁移一次即永久自证，之后连同源判定都不再需要 —— 这是防止同类旧标记再次把插件锁死的关键一环。
function withCredentialManaged(flag) {
  const base = flag && typeof flag === 'object' ? flag : {}
  return {
    routeOwned: base.routeOwned === true,
    defaultModelManaged: base.defaultModelManaged === true,
    previousDefaultModel: base.previousDefaultModel && typeof base.previousDefaultModel === 'object' ? base.previousDefaultModel : null,
    credentialManaged: true,
    boundAt: typeof base.boundAt === 'string' && base.boundAt.length > 0 ? base.boundAt : new Date().toISOString(),
  }
}

// 邮箱脱敏（页面展示用）：本地部分最多留前 2 位，域名保留；无法识别 → null。
// 脱敏一律在 host 侧完成 —— 完整邮箱绝不进入前端、日志或错误信息。
function maskEmail(email) {
  if (typeof email !== 'string' || email.length === 0) return null
  const at = email.indexOf('@')
  if (at <= 0 || at === email.length - 1) return null
  const local = email.slice(0, at)
  const head = local.slice(0, local.length > 2 ? 2 : 1)
  return head + '•••' + email.slice(at)
}

// 账号摘要（页面展示用）：id_token 优先、access_token 兜底；解不出 → null 字段（页面显示「暂未读到」）。
function codexAccountSummary(auth) {
  const tokens = auth && typeof auth === 'object' && auth.tokens && typeof auth.tokens === 'object' ? auth.tokens : {}
  const idClaims = decodeJwtPayload(typeof tokens.id_token === 'string' ? tokens.id_token : '')
  const accessClaims = decodeJwtPayload(typeof tokens.access_token === 'string' ? tokens.access_token : '')
  const claims = idClaims || accessClaims || {}
  const authClaim = claims[CODEX_JWT_ACCOUNT_CLAIM] && typeof claims[CODEX_JWT_ACCOUNT_CLAIM] === 'object' ? claims[CODEX_JWT_ACCOUNT_CLAIM] : {}
  const plan = typeof authClaim.chatgpt_plan_type === 'string' && authClaim.chatgpt_plan_type.length > 0 ? authClaim.chatgpt_plan_type : null
  return { email: maskEmail(claims.email), plan: plan }
}

// 套餐英文标识 → 页面展示名；未知档位原样返回（不猜、不编）
function planDisplayName(plan) {
  if (typeof plan !== 'string' || plan.length === 0) return null
  const map = { free: 'Free', plus: 'Plus', pro: 'Pro', team: 'Team', business: 'Business', enterprise: 'Enterprise', edu: 'Edu' }
  return map[plan.toLowerCase()] || plan
}

// 构造 OAuth 绑定后的 auth.json 对象：保留既有结构（codex CLI/OpenCode 兼容），仅替换令牌字段 + last_refresh；
// account_id 优先从新 access_token 提取，提取失败保留旧值；全新文件给出标准骨架 {auth_mode:'oauth', ...}
function buildOAuthAuthObject(existing, exchange, nowIso) {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}
  const baseTokens = base.tokens && typeof base.tokens === 'object' && !Array.isArray(base.tokens) ? base.tokens : {}
  const tokens = Object.assign({}, baseTokens)
  tokens.access_token = exchange.access_token
  if (typeof exchange.refresh_token === 'string' && exchange.refresh_token.length > 0) tokens.refresh_token = exchange.refresh_token
  if (typeof exchange.id_token === 'string' && exchange.id_token.length > 0) tokens.id_token = exchange.id_token
  const accountId = codexAccountIdFromJwt(exchange.access_token)
  if (accountId) tokens.account_id = accountId
  return {
    auth_mode: 'oauth',
    OPENAI_API_KEY: typeof base.OPENAI_API_KEY === 'string' && base.OPENAI_API_KEY.length > 0 ? base.OPENAI_API_KEY : null,
    tokens: tokens,
    last_refresh: nowIso,
  }
}

// 解绑：仅清令牌字段并原子写回（保留 auth_mode/OPENAI_API_KEY/account_id 等结构——auth.json 是 codex CLI
// 等工具共用的标准位置，保留骨架更接近"已登出"语义，也便于重新绑定与 CLI 兼容）；tmp+rename 防写一半；0600
function clearCodexAuthTokens(filePath, currentAuth) {
  const base = currentAuth && typeof currentAuth === 'object' && !Array.isArray(currentAuth) ? currentAuth : {}
  const tokens = Object.assign({}, base.tokens && typeof base.tokens === 'object' && !Array.isArray(base.tokens) ? base.tokens : {})
  delete tokens.access_token
  delete tokens.refresh_token
  delete tokens.id_token
  const updated = Object.assign({}, base, { tokens: tokens, last_refresh: null })
  const tmp = filePath + '.tmp'
  writeFileSync(tmp, JSON.stringify(updated, null, 2) + '\n', { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, filePath)
  chmodSync(filePath, 0o600)
  return updated
}

// 用授权码向官方端点换令牌对（PKCE verifier 证明持码者身份）；凭据仅经 HTTPS body 传递（不进子进程）；
// 响应缺 access_token → { ok:false }（调用方不得写回）；网络/超时异常 → { ok:false, status:null }
async function exchangeAuthorizationCode(code, verifier) {
  try {
    const res = await fetch('https://auth.openai.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CODEX_OAUTH_CLIENT_ID,
        code: code,
        code_verifier: verifier,
        redirect_uri: 'http://localhost:' + oauthCallbackPort() + OAUTH_CALLBACK_PATH,
      }).toString(),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return { ok: false, status: res.status }
    const body = await res.json()
    if (!body || typeof body.access_token !== 'string' || body.access_token.length === 0) return { ok: false, status: res.status }
    return {
      ok: true,
      access_token: body.access_token,
      refresh_token: typeof body.refresh_token === 'string' && body.refresh_token.length > 0 ? body.refresh_token : null,
      id_token: typeof body.id_token === 'string' && body.id_token.length > 0 ? body.id_token : null,
    }
  } catch (err) {
    return { ok: false, status: null } // 网络/超时等异常 → 调用方按"交换失败"处理
  }
}

// 本地回调 server：仅监听 127.0.0.1；仅接受 /auth/callback；校验 state（防 CSRF/中间人）；
// 端口占用（EADDRINUSE）等监听失败 → resolve(null)（调用方返回明确错误，不崩溃）
function startOAuthCallbackServer(expectedState, onCode, port, language) {
  return new Promise(function (resolve) {
    let settled = false
    const fail = function () { if (!settled) { settled = true; resolve(null) } }
    const server = createServer(function (req, res) {
      let pathname = '/'
      let params = null
      try {
        const url = new URL(req.url || '/', 'http://localhost')
        pathname = url.pathname
        params = url.searchParams
      } catch (err) {
        respondOAuthPage(res, 400, 'oauth.invalidAddress', language)
        return
      }
      if (pathname !== OAUTH_CALLBACK_PATH) {
        respondOAuthPage(res, 404, 'oauth.notFound', language)
        return
      }
      if (params.get('state') !== expectedState) {
        respondOAuthPage(res, 400, 'oauth.invalidState', language)
        return
      }
      const code = params.get('code')
      if (!code) {
        respondOAuthPage(res, 400, 'oauth.missingCode', language)
        return
      }
      respondOAuthPage(res, 200, 'oauth.complete', language)
      onCode(code)
    })
    server.on('error', fail)
    server.listen(port, '127.0.0.1', function () {
      if (!settled) {
        settled = true
        resolve({
          server: server,
          port: port,
          close: function () { try { server.close() } catch (err) { /* 忽略 */ } },
        })
      }
    })
  })
}

// Render only dictionary-owned text; callback input never enters the HTML.
function respondOAuthPage(res, status, key, language) {
  const tag = typeof language === 'string' ? language.toLowerCase().replace(/_/g, '-') : 'en';
  const selected = /^zh-(hant|tw|hk|mo)(-|$)/.test(tag) ? 'zh-hant' : tag;
  const id = Object.hasOwn(LOCALES, selected) ? selected : Object.hasOwn(LOCALES, selected.split('-')[0]) ? selected.split('-')[0] : 'en';
  const dictionary = LOCALES[id];
  const escapeHtml = function (value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  const html = '<!DOCTYPE html><html lang="' + escapeHtml(id) + '"><head><meta charset="utf-8"><title>ChatGPT</title></head>' +
    '<body style="font-family:system-ui,sans-serif;padding:3rem 2rem;text-align:center;background:#f7f7f8">' +
    '<h2 style="color:#0d0d0d">' + escapeHtml(dictionary[key] || LOCALES.en[key] || key) + '</h2>' +
    '<p style="color:#555">' + escapeHtml(dictionary['oauth.hint']) + '</p></body></html>';
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(html);
}

// ============================================================================
// apply：ChatGPT 订阅官方 OAuth 绑定 + 令牌看护 + openai-codex 路由注册
// ============================================================================
export default {
  inject: ['credentials', 'settings', 'timer', 'shell'],
  apply(ctx) {
    mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
    chmodSync(DATA_DIR, 0o700)
    // ---------- 状态 ----------
    let codexBridgeState = { ok: false, lastSyncAt: null, expiresAt: null, error: null, routeConfigured: false };
    let codexInjectedToken = null; // 最近成功注入 DSH 凭据的令牌（仅内存比对，防同值重复写盘）
    let oauthInFlight = false; // OAuth 授权进行中（防并发：绝不同时存在两个回调 server/state）
    let oauthLastError = null; // 最近一次 OAuth 流程错误（状态 RPC 透出；令牌值永不进入）
    let syncInFlight = null; // 周期同步与 OAuth 后同步共享单飞锁，避免交叉读写凭据
    let codexRouteOwned = false; // 进程内保留所有权，绑定标记缺失时仍可安全清理插件路由
    let codexCredentialOwned = false; // 只清理插件自己注入的凭据，绝不碰用户已有同名凭据

    // ---------- 路由注册（仅绑定时启用；用户同名路由绝不覆盖） ----------
    async function ensureCodexRoute(flag) {
      const settings = ctx.settings || ctx.get('settings');
      if (!settingsServiceReady(settings)) {
        return { ok: false, owned: false, code: 'route.dsh-not-ready', message: 'DSH 还没准备好，稍后会自动再试一次' };
      }
      try {
        const cur = readSettingsSection(settings, 'llm-pi-ai');
        const providers = cur && typeof cur === 'object' && cur.providers && typeof cur.providers === 'object' ? cur.providers : {};
        const existing = providers['openai-codex'];
        if (existing && existing.apiKeyEnv !== 'OPENAI_CODEX_API_KEY') {
          return { ok: false, owned: false, code: 'route.occupied', message: MSG_ROUTE_CONFLICT };
        }
        if (existing) {
          // 只有绑定标记证明是插件旧版本创建的路由时才升级；同名用户路由只读不删不改。
          if (flag && flag.routeOwned === true) {
            const patch = {};
            if (existing.displayName === 'Codex') patch.displayName = 'ChatGPT';
            if (existing.transport !== 'sse') patch.transport = 'sse';
            if (Object.keys(patch).length > 0) await settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'openai-codex'], value: Object.assign({}, existing, patch) }]);
          }
          return { ok: true, owned: Boolean(flag && flag.routeOwned === true) };
        }
        await settings.mutate('llm-pi-ai', [{ op: 'set', path: ['providers', 'openai-codex'], value: { apiKeyEnv: 'OPENAI_CODEX_API_KEY', displayName: 'ChatGPT', transport: 'sse' } }]);
        return { ok: true, owned: true };
      } catch (err) {
        return { ok: false, owned: false, code: 'route.create-failed', message: 'ChatGPT 通道没建起来，稍后会自动再试一次' };
      }
    }

    async function removeOwnedCodexRoute(flag) {
      if (!flag.routeOwned && !codexRouteOwned) return;
      const settings = ctx.settings || ctx.get('settings');
      if (!settingsServiceReady(settings)) return;
      const cur = readSettingsSection(settings, 'llm-pi-ai');
      const route = cur && cur.providers && cur.providers['openai-codex'];
      if (route && route.apiKeyEnv === 'OPENAI_CODEX_API_KEY') {
        await settings.mutate('llm-pi-ai', [{ op: 'unset', path: ['providers', 'openai-codex'] }]);
      }
    }

    async function configureDefaultModel() {
      const service = ctx.get('agentDefaultModel');
      if (!service || typeof service.currentSelection !== 'function' || typeof service.saveSelection !== 'function') return { ok: false, previous: null, code: 'default-model.dsh-not-ready', message: 'DSH 还没准备好，暂时没法把默认模型切成 ChatGPT' };
      const current = service.currentSelection();
      if (!current || current.provider === 'openai-codex') return { ok: true, previous: null };
      await service.saveSelection({ provider: 'openai-codex', model: CODEX_DEFAULT_MODEL, reasoningEffort: current.reasoningEffort });
      return { ok: true, previous: current };
    }

    async function restoreDefaultModel(flag) {
      if (!flag.defaultModelManaged || !flag.previousDefaultModel) return;
      const service = ctx.get('agentDefaultModel');
      if (!service || typeof service.currentSelection !== 'function' || typeof service.saveSelection !== 'function') return;
      const current = service.currentSelection();
      if (current && current.provider === 'openai-codex') await service.saveSelection(flag.previousDefaultModel);
    }

    // ---------- 令牌看护（严格官方模式：绑定标记唯一事实） ----------
    // 判定的不是「槽里有没有东西」，而是「槽里那东西是不是本插件的」。
    // 旧实现只判空，导致插件把自己早期注入的令牌当成别人的，永久拒绝更新 —— 红字死锁的根因。
    async function classifyCodexCredentialSlot(flag, candidateToken) {
      if (codexCredentialOwned) return { claim: true, reason: 'owned' };
      if (flag && flag.credentialManaged === true) return { claim: true, reason: 'managed' };
      if (typeof ctx.credentials.resolve !== 'function') return { claim: false, reason: 'no-credentials-service' };
      const existing = await ctx.credentials.resolve('OPENAI_CODEX_API_KEY');
      return classifyCodexCredential(
        existing && typeof existing === 'object' ? existing.value : '',
        candidateToken,
        { boundFlag: Boolean(flag && flag.bound), nowSeconds: Math.floor(Date.now() / 1000) }
      );
    }

    async function clearInjectedCodexCredential(flag) {
      if (!codexCredentialOwned && !(flag && flag.credentialManaged === true)) return true;
      try {
        await ctx.credentials.unset('OPENAI_CODEX_API_KEY');
        codexInjectedToken = null;
        codexCredentialOwned = false;
        return true;
      } catch (err) {
        codexInjectedToken = null;
        return false;
      }
    }

    async function syncCodexToken() {
      if (syncInFlight) return syncInFlight;
      syncInFlight = syncCodexTokenOnce().catch(function () {
        codexBridgeState = { ok: false, lastSyncAt: Date.now(), expiresAt: null, error: { kind: 'exception', code: 'sync.exception', message: '同步时出了点问题，稍后会自动再试一次' }, routeConfigured: codexBridgeState.routeConfigured };
      }).finally(function () { syncInFlight = null; });
      return syncInFlight;
    }

    async function syncCodexTokenOnce() {
      const nowMs = Date.now();
      const nowSec = Math.floor(nowMs / 1000);
      const flag = readBindFlag(CODEX_BIND_FILE);
      if (!flag.bound) {
        const cleared = await clearInjectedCodexCredential(flag);
        try { await removeOwnedCodexRoute(flag); codexRouteOwned = false; } catch (err) {
          codexBridgeState = { ok: false, lastSyncAt: nowMs, expiresAt: null, error: { kind: 'route-cleanup', code: 'unbind.route-cleanup', message: '解绑后没清理干净，稍后会自动再试一次' }, routeConfigured: true };
          return;
        }
        codexBridgeState = { ok: false, lastSyncAt: nowMs, expiresAt: null, error: cleared ? { kind: 'unbound', code: 'state.unbound', message: '还没有绑定 ChatGPT 账号' } : { kind: 'credentials-cleanup', code: 'state.unbound-dirty', message: '还没有绑定，而且之前留下的登录信息也没清掉' }, routeConfigured: false };
        return;
      }
      if (!codexBridgeState.routeConfigured) {
        const route = await ensureCodexRoute(flag);
        if (!route.ok) {
          codexBridgeState = { ok: false, lastSyncAt: nowMs, expiresAt: null, error: { kind: 'route-conflict', code: route.code || 'route.unknown', message: route.message }, routeConfigured: false };
          return;
        }
        codexRouteOwned = route.owned;
        codexBridgeState.routeConfigured = true;
      }
      const read = readCodexAuthFile(CODEX_AUTH_FILE);
      if (!read.ok) {
        const cleared = await clearInjectedCodexCredential(flag);
        let routeRemoved = true;
        try { await removeOwnedCodexRoute(flag); codexRouteOwned = false; } catch (err) { routeRemoved = false; }
        const error = !routeRemoved ? { kind: 'route-cleanup', code: 'state.stale-route', message: '绑定已经失效，而且通道没清理干净' } : cleared ? { kind: 'no-login', code: 'state.no-login', message: '找不到登录信息了，请重新绑定' } : { kind: 'credentials-cleanup', code: 'state.no-login-dirty', message: '登录信息不见了，旧信息也没清掉，请重新绑定' };
        codexBridgeState = { ok: false, lastSyncAt: nowMs, expiresAt: null, error: error, routeConfigured: !routeRemoved };
        return;
      }
      const auth = read.auth;
      const tokens = auth.tokens && typeof auth.tokens === 'object' ? auth.tokens : {};
      const access = typeof tokens.access_token === 'string' ? tokens.access_token : '';
      const refresh = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : '';
      const lastRefreshMs = Date.parse(auth.last_refresh);
      if (!access) {
        const cleared = await clearInjectedCodexCredential(flag);
        let routeRemoved = true;
        try { await removeOwnedCodexRoute(flag); codexRouteOwned = false; } catch (err) { routeRemoved = false; }
        const error = !routeRemoved ? { kind: 'route-cleanup', code: 'state.stale-route-failed', message: '绑定失效且路由清理失败' } : cleared ? { kind: 'no-key', code: 'state.incomplete', message: '登录信息不完整，请重新绑定' } : { kind: 'credentials-cleanup', code: 'state.incomplete-dirty', message: '登录信息不完整，旧信息也没清掉，请重新绑定' };
        codexBridgeState = { ok: false, lastSyncAt: nowMs, expiresAt: null, error: error, routeConfigured: !routeRemoved };
        return;
      }
      let expiresAtSec = codexExpiresAt(decodeJwtExp(access), lastRefreshMs);
      let token = null;
      let error = null;

      if (codexNeedsRefresh(expiresAtSec, nowSec)) {
        if (!refresh) {
          error = { kind: 'auth', code: 'token.expiring', message: '登录快到期了，而且没法自动续期，请重新绑定' };
        } else {
          const pair = await refreshCodexTokenPair(refresh);
          if (pair) {
            try {
              const nextRefresh = pair.refresh_token || refresh;
              const updated = writeAuthJson(CODEX_AUTH_FILE, auth, pair.access_token, nextRefresh, new Date().toISOString());
              token = pair.access_token;
              expiresAtSec = codexExpiresAt(decodeJwtExp(pair.access_token), Date.parse(updated.last_refresh));
            } catch (err) {
              token = pair.access_token;
              expiresAtSec = codexExpiresAt(decodeJwtExp(pair.access_token), nowMs);
              error = { kind: 'write', code: 'token.refresh-write-failed', message: '续期成功，但没能存到本地，下次可能还要重新绑定' };
            }
          } else {
            const reRead = readCodexAuthFile(CODEX_AUTH_FILE);
            const reAuth = reRead.ok ? reRead.auth : null;
            const reTokens = reAuth && reAuth.tokens && typeof reAuth.tokens === 'object' ? reAuth.tokens : {};
            const reAccess = typeof reTokens.access_token === 'string' ? reTokens.access_token : '';
            const reRefreshMs = reAuth && typeof reAuth.last_refresh === 'string' ? Date.parse(reAuth.last_refresh) : NaN;
            if (reAuth && reAccess && !isNaN(reRefreshMs) && (isNaN(lastRefreshMs) || reRefreshMs > lastRefreshMs)) {
              token = reAccess;
              expiresAtSec = codexExpiresAt(decodeJwtExp(reAccess), reRefreshMs);
            } else {
              error = { kind: 'auth', code: 'token.refresh-failed', message: '自动续期失败，请重新绑定' };
            }
          }
        }
      } else {
        token = access;
      }

      if (!token && error) {
        const cleared = await clearInjectedCodexCredential(flag);
        if (!cleared) error = { kind: 'credentials-cleanup', code: 'token.invalid-dirty', message: '登录信息用不了，旧信息也没清掉，请重新绑定' };
      }
      if (token && token !== codexInjectedToken) {
        const claim = await classifyCodexCredentialSlot(flag, token);
        if (!claim.claim) {
          error = { kind: 'credentials-conflict', code: 'credentials.conflict', message: MSG_CREDENTIAL_CONFLICT };
        } else try {
          await ctx.credentials.set('OPENAI_CODEX_API_KEY', token);
          codexInjectedToken = token;
          codexCredentialOwned = true;
          // 账本迁移：老版本绑定标记缺「凭据归本插件所有」一栏，成功接管后立即补记，
          // 之后每次同步都能一步自证，不必再依赖同源判定 —— 防复发。
          if (!(flag && flag.credentialManaged === true)) {
            try { writeBindFlag(CODEX_BIND_FILE, withCredentialManaged(flag)); } catch (migErr) { /* 记账失败不影响本次可用，下周期再补 */ }
          }
        } catch (err) {
          const cleared = await clearInjectedCodexCredential(flag);
          error = cleared ? { kind: 'credentials', code: 'credentials.sync-failed', message: '登录信息同步到 DSH 失败，请重试或重新绑定' } : { kind: 'credentials-cleanup', code: 'credentials.sync-failed-dirty', message: '登录信息同步失败，且旧信息清理也未成功，请重新绑定' };
        }
      }
      codexBridgeState = { ok: !error, lastSyncAt: nowMs, expiresAt: expiresAtSec != null ? expiresAtSec * 1000 : null, error: error, routeConfigured: codexBridgeState.routeConfigured };
    }

    // ---------- OAuth 官方绑定（PKCE + state + 本地回调 127.0.0.1） ----------
    function deferred() {
      let resolve = null;
      const promise = new Promise(function (res) { resolve = res; });
      return { promise: promise, resolve: resolve };
    }

    async function openOAuthBrowser(authorizeUrl) {
      const shell = (ctx && ctx.shell) || ctx.get('shell');
      if (!shell || typeof shell.run !== 'function') return false;
      const platform = typeof process !== 'undefined' && process.platform ? process.platform : '';
      const openCmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd /c start ""' : 'xdg-open';
      const safeUrl = String(authorizeUrl).replace(/["$`\\]/g, '\\$&');
      const request = { command: openCmd + ' "' + safeUrl + '"' };
      try {
        const result = await shell.run(typeof shell.resolve === 'function' ? shell.resolve(request) : request);
        return !result || result.exitCode === 0 || result.exitCode === undefined;
      } catch (err) {
        return false;
      }
    }

    async function rollbackBindingSetup(route, defaultModel, previousAuth, newAccessToken) {
      if (previousAuth !== undefined && typeof newAccessToken === 'string') {
        try {
          const current = readCodexAuthFile(CODEX_AUTH_FILE);
          const currentTokens = current.ok && current.auth.tokens && typeof current.auth.tokens === 'object' ? current.auth.tokens : {};
          if (current.ok && currentTokens.access_token === newAccessToken) {
            if (previousAuth === null) unlinkSync(CODEX_AUTH_FILE);
            else {
              const previousTokens = previousAuth.tokens && typeof previousAuth.tokens === 'object' ? previousAuth.tokens : {};
              writeAuthJson(CODEX_AUTH_FILE, previousAuth, typeof previousTokens.access_token === 'string' ? previousTokens.access_token : '', typeof previousTokens.refresh_token === 'string' ? previousTokens.refresh_token : null, previousAuth.last_refresh || null);
            }
          }
        } catch (err) {}
      }
      if (defaultModel && defaultModel.previous) {
        try { await restoreDefaultModel({ defaultModelManaged: true, previousDefaultModel: defaultModel.previous }); } catch (err) {}
      }
      if (route && route.ok) {
        try { await removeOwnedCodexRoute({ routeOwned: route.owned }); } catch (err) {}
      }
      codexRouteOwned = false;
    }

    async function runCodexOAuthFlow(pkce, state, serverHandle, authorizeUrl, waitCode) {
      let timer = null;
      let route = null;
      let defaultModel = null;
      let previousAuth = undefined;
      let newAccessToken = null;
      try {
        await openOAuthBrowser(authorizeUrl);
        const code = await Promise.race([
          waitCode.promise,
          new Promise(function (resolve) { timer = setTimeout(function () { resolve(null); }, OAUTH_CALLBACK_TIMEOUT_MS); }),
        ]);
        if (!code) { oauthLastError = { kind: 'timeout', code: 'oauth.timeout', message: '等了 5 分钟没等到授权结果，已取消。请再点一次「绑定 ChatGPT 账号」' }; return; }
        const exchanged = await exchangeAuthorizationCode(code, pkce.verifier);
        if (!exchanged.ok) {
          oauthLastError = { kind: 'exchange', code: exchanged.status != null ? 'oauth.exchange-http' : 'oauth.exchange-network', params: exchanged.status != null ? { status: exchanged.status } : null, message: '授权完成了，但没取到登录信息（' + (exchanged.status != null ? '网络返回 ' + exchanged.status : '连不上网络') + '）。请重试' };
          return;
        }
        const nowIso = new Date().toISOString();
        const read = readCodexAuthFile(CODEX_AUTH_FILE);
        previousAuth = read.ok ? read.auth : null;
        newAccessToken = exchanged.access_token;
        const authToWrite = buildOAuthAuthObject(read.ok ? read.auth : null, exchanged, nowIso);
        try {
          writeAuthJson(CODEX_AUTH_FILE, authToWrite, exchanged.access_token, authToWrite.tokens.refresh_token != null ? authToWrite.tokens.refresh_token : null, nowIso);
        } catch (err) {
          oauthLastError = { kind: 'write', code: 'oauth.write-failed', message: '登录成功了，但没能存到本地。请重新绑定' };
          return;
        }
        const priorFlag = readBindFlag(CODEX_BIND_FILE);
        route = await ensureCodexRoute(priorFlag);
        if (!route.ok) {
          await rollbackBindingSetup(route, defaultModel, previousAuth, newAccessToken);
          oauthLastError = { kind: 'route-conflict', code: route.code || 'route.unknown', message: route.message };
          return;
        }
        codexRouteOwned = route.owned;
        try {
          defaultModel = await configureDefaultModel();
          if (!defaultModel.previous && priorFlag.defaultModelManaged) defaultModel.previous = priorFlag.previousDefaultModel;
        } catch (err) {
          await rollbackBindingSetup(route, defaultModel, previousAuth, newAccessToken);
          oauthLastError = { kind: 'default-model', code: 'oauth.default-model-manual', message: '绑定成功了，但没能自动设为默认模型。请到「模型」设置里手动选一次 ChatGPT' };
          return;
        }
        if (!defaultModel.ok) {
          await rollbackBindingSetup(route, defaultModel, previousAuth, newAccessToken);
          oauthLastError = { kind: 'default-model', code: defaultModel.code || 'default-model.unknown', message: defaultModel.message };
          return;
        }
        const claim = await classifyCodexCredentialSlot(priorFlag, exchanged.access_token);
        if (!claim.claim) {
          await rollbackBindingSetup(route, defaultModel, previousAuth, newAccessToken);
          oauthLastError = { kind: 'credentials-conflict', code: 'credentials.conflict', message: MSG_CREDENTIAL_CONFLICT };
          return;
        }
        try {
          writeBindFlag(CODEX_BIND_FILE, Object.assign(withCredentialManaged(priorFlag), {
            routeOwned: route.owned,
            defaultModelManaged: Boolean(defaultModel.previous),
            previousDefaultModel: defaultModel.previous,
          }, { boundAt: nowIso }));
        } catch (err) {
          await rollbackBindingSetup(route, defaultModel, previousAuth, newAccessToken);
          oauthLastError = { kind: 'write', code: 'oauth.flag-write-failed', message: '绑定成功了，但状态没存住。请重新绑定' };
          return;
        }
        try {
          await ctx.credentials.set('OPENAI_CODEX_API_KEY', exchanged.access_token);          codexInjectedToken = exchanged.access_token;
          codexCredentialOwned = true;
        } catch (err) {
          try { clearBindFlag(CODEX_BIND_FILE); } catch (clearErr) { /* 状态仍保持失败，下一次同步会继续清理 */ }
          await rollbackBindingSetup(route, defaultModel, previousAuth, newAccessToken);
          oauthLastError = { kind: 'credentials', code: 'oauth.credentials-failed', message: '绑定失败：登录信息没能交给 DSH。请重试' };
          codexBridgeState = { ok: false, lastSyncAt: Date.now(), expiresAt: null, error: oauthLastError, routeConfigured: route.ok };
          return;
        }
        const expiresAtSec = codexExpiresAt(decodeJwtExp(exchanged.access_token), Date.parse(nowIso));
        codexBridgeState = { ok: true, lastSyncAt: Date.now(), expiresAt: expiresAtSec != null ? expiresAtSec * 1000 : null, error: null, routeConfigured: route.ok };
      } catch (err) {
        await rollbackBindingSetup(route, defaultModel, previousAuth, newAccessToken);
        oauthLastError = { kind: 'exception', code: 'oauth.exception', message: '绑定时出了点问题，请重试' };
      } finally {
        if (timer) clearTimeout(timer);
        try { serverHandle.close(); } catch (err) { /* 忽略 */ }
        oauthInFlight = false;
      }
    }

    async function startCodexOAuthRpc(args) {
      if (oauthInFlight) return { ok: false, oauthInFlight: true, error: { kind: 'in-flight', code: 'oauth.in-flight', message: '正在等你在浏览器里完成授权，请稍候' } };
      oauthInFlight = true;
      oauthLastError = null;
      const pkce = createPkcePair();
      const state = randomBytes(16).toString('hex');
      const port = oauthCallbackPort();
      const waitCode = deferred();
      const serverHandle = await startOAuthCallbackServer(state, function (code) { waitCode.resolve(code); }, port, args && args.language);
      if (!serverHandle) {
        oauthInFlight = false;
        return { ok: false, oauthInFlight: false, error: { kind: 'port-busy', code: 'oauth.port-busy', params: { port: port }, message: '本机 ' + port + ' 端口被别的程序占了。请关掉它（比如正在登录的 Codex 命令行），再重试' } };
      }
      const authorizeUrl = buildAuthorizeUrl(state, pkce.challenge);
      runCodexOAuthFlow(pkce, state, serverHandle, authorizeUrl, waitCode).catch(function () {
        oauthLastError = { kind: 'exception', code: 'oauth.exception', message: '绑定时出了点问题，请重试' };
      });
      return { ok: true, authorizeUrl: authorizeUrl, oauthInFlight: true };
    }

    async function unbindCodexRpc() {
      if (oauthInFlight) return { ok: false, error: { kind: 'in-flight', code: 'unbind.in-flight', message: '正在等你在浏览器里完成授权，请先把它做完，或等它超时' } };
      try {
        const flag = readBindFlag(CODEX_BIND_FILE);
        await removeOwnedCodexRoute(flag);
        codexRouteOwned = false;
        await restoreDefaultModel(flag);
        const cleared = await clearInjectedCodexCredential(flag);
        if (!cleared) throw new Error('credentials cleanup failed');
        clearBindFlag(CODEX_BIND_FILE);
        codexBridgeState = { ok: false, lastSyncAt: Date.now(), expiresAt: null, error: { kind: 'unbound', code: 'unbind.done', message: '已经解除绑定' }, routeConfigured: false };
        return { ok: true, bound: false };
      } catch (err) {
        return { ok: false, error: { kind: 'exception', code: 'unbind.exception', message: '解绑失败，请重试' } };
      }
    }

    function getCodexBridgeStatusRpc() {
      const flag = readBindFlag(CODEX_BIND_FILE);
      // 账号摘要只在已绑定时读一次本地登录文件；邮箱已在 host 侧脱敏，完整值不跨进程传输。
      const read = flag.bound ? readCodexAuthFile(CODEX_AUTH_FILE) : { ok: false };
      const summary = read.ok ? codexAccountSummary(read.auth) : null;
      return {
        ok: codexBridgeState.ok,
        bound: flag.bound,          // 绑定标记是唯一事实
        oauthInFlight: oauthInFlight,
        expiresAt: codexBridgeState.expiresAt,
        lastSyncAt: codexBridgeState.lastSyncAt,
        error: oauthLastError || codexBridgeState.error,
        routeConfigured: codexBridgeState.routeConfigured,
        account: summary ? { email: summary.email, plan: planDisplayName(summary.plan) } : null,
      };
    }

    // ---------- RPC 路由（webServer HTTP，JSON 进出，使用宿主认证边界） ----------
    const ROUTE_PREFIX = '/_dsh/dsh-chatgpt-sub';
    const ROUTES = {
      getCodexBridgeStatus: function () { return getCodexBridgeStatusRpc(); },
      startCodexOAuth: function (args) { return startCodexOAuthRpc(args); },
      unbindCodex: function () { return unbindCodexRpc(); },
    };
    const MUTATING = { startCodexOAuth: true, unbindCodex: true };

    function readBody(req, maxBytes) {
      return new Promise(function (resolve, reject) {
        let size = 0;
        const chunks = [];
        req.on('data', function (c) { size += c.length; if (size > maxBytes) { reject(Object.assign(new Error('payload too large'), { status: 413 })); req.destroy(); return; } chunks.push(c); });
        req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
        req.on('error', reject);
      });
    }

    function respond(res, status, payload) {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
    }

    // Do not reproduce this check from Origin headers here. The Desktop shell
    // validates dsh-app://app, then deliberately removes renderer headers and
    // injects its private Host cookie while forwarding to this local server.
    // `connection.requestRejection()` is the official, shared trust boundary:
    // Host/Origin anti-rebinding protection plus browser/desktop authentication.
    ctx.inject(['connection', 'webServer'], function (webCtx) {
      webCtx.effect(function () {
        try {
          const dispose = webCtx.webServer.register({
            kind: 'prefix',
            path: ROUTE_PREFIX,
            handler: async function (req, res) {
              try {
                const rejection = webCtx.connection.requestRejection(req);
                if (rejection !== undefined) {
                  respond(res, rejection, { error: rejection === 401 ? 'authentication required' : 'request rejected' });
                  return;
                }
                // handler 只收 (req, res) 两参；pathname 须从 req.url 自行解析（官方 webServer 契约）
                const url = new URL(req.url || '/', 'http://localhost');
                const path = url.pathname;
                if (!path.startsWith(ROUTE_PREFIX + '/')) { respond(res, 404, { error: 'not found' }); return; }
                const method = decodeURIComponent(path.slice(ROUTE_PREFIX.length + 1));
                if (!Object.hasOwn(ROUTES, method)) { respond(res, 404, { error: 'unknown method: ' + method }); return; }
                if (Object.hasOwn(MUTATING, method)) {
                  if (req.method !== 'POST') { respond(res, 405, { error: 'mutating methods require POST' }); return; }
                }
                let args = null;
                if (req.method === 'POST') {
                  const raw = await readBody(req, 64 * 1024);
                  if (raw.length > 0) { try { args = JSON.parse(raw); } catch (e) { respond(res, 400, { error: 'invalid JSON body' }); return; } }
                }
                const result = await ROUTES[method](args);
                respond(res, 200, result);
              } catch (err) {
                const status = (err && err.status) || 500;
                respond(res, status, { error: status === 500 ? 'internal error' : String((err && err.message) || err) });
              }
            },
          });
          return function () { dispose(); };
        } catch (err) {
          console.warn('[dsh-chatgpt-sub] webServer 路由注册失败', String((err && err.message) || err));
        }
      }, 'dsh-chatgpt-sub: Web routes');
    }, 'dsh-chatgpt-sub: Web routes');

    // ---------- 启动即刷 + 30min 令牌看护 ----------
    // 只有绑定标记存在时，syncCodexToken 才注册 ChatGPT 路由；未绑定状态绝不触碰用户配置。
    syncCodexToken();
    ctx.interval(syncCodexToken, CODEX_SYNC_INTERVAL_MS);
  },
};
