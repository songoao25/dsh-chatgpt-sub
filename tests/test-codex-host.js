// dsh-chatgpt-sub — host 端纯函数与状态机测试（注入式，零真实网络/零真实 auth.json）
// 提取 host.js 模块级常量与纯函数（将「常量 + 纯函数」作为一个共享作用域整体求值，
// 使函数能解析到同模块内的兄弟函数与常量——如 decodeJwtExp 调 decodeBase64Url、buildAuthorizeUrl 用 OAUTH_SCOPE）
import { chmodSync, readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, rmSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { createHash, randomBytes } from 'node:crypto'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const src = readFileSync(join(root, 'src', 'host.js'), 'utf8')
const clientSrc = readFileSync(join(root, 'src', 'client-bundle.js'), 'utf8')

// ---- 简易断言（脱敏：涉及 token/auth/secret 的断言失败时不打印实际值）----
let pass = 0
let fail = 0
const failures = []
function isSensitive(v) {
  return /token|auth|secret|access|refresh|password|sk-/i.test(String(v))
}
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    pass++
  } else {
    // 若 expected 或 actual 触及 token/认证字段，失败详情中隐藏实际值（测试仅用模拟数据，
    // 但仍不让任何疑似敏感串进入日志，避免 code scanning 告警 js/clear-text-logging）。
    const act = (isSensitive(expected) || isSensitive(actual)) ? '[REDACTED]' : JSON.stringify(actual)
    failures.push(`${name}: 期望 ${JSON.stringify(expected)} 实际 ${act}`)
    fail++
  }
}

// ---- 提取「常量 + 纯函数」为一个共享作用域 ----
// 思路：从源码中按出现顺序提取模块级 const 与 function 声明，连同 Node 内置依赖一起
// 拼进一个 new Function 整体求值成一份上下文对象，再读出各具名函数。
function extractModule(nameList, depOverrides) {
  const wantedConstants = new Set([
    'CODEX_OAUTH_CLIENT_ID', 'OAUTH_CALLBACK_PATH', 'CODEX_JWT_ACCOUNT_CLAIM',
    'OAUTH_SCOPE', 'CODEX_TOKEN_FALLBACK_LIFETIME_SEC', 'CODEX_REFRESH_AHEAD_SEC',
    'DESKTOP_APP_ORIGIN',
  ])
  const wantedFns = new Set(nameList)
  const lines = src.split('\n')
  const fragments = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const cm = /^const\s+(\w+)\s*=/.exec(line)
    if (cm && wantedConstants.has(cm[1])) {
      // 常量单行声明（可能带行尾注释）；仅取本行即可（无需跨行，这些常量都不跨行）
      fragments.push(line)
      continue
    }
    const fm = /^function\s+(\w+)\s*\(/.exec(line)
    if (fm && wantedFns.has(fm[1])) {
      let chunk = line
      let depth = (chunk.match(/\{/g) || []).length - (chunk.match(/\}/g) || []).length
      let j = i
      while (depth > 0 && j + 1 < lines.length) { j++; chunk += '\n' + lines[j]; depth += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length }
      fragments.push(chunk)
      i = j
      continue
    }
  }
  // 片段体用裸名引用这些标识符：除了 Node 本身的内建全局（process/Buffer/URL/URLSearchParams/
  // AbortSignal/fetch），fs/crypto/path 是 import（非全局），必须按原裸名注入到 new Function 作用域。
  const params = [
    'createHash', 'randomBytes',
    'readFileSync', 'writeFileSync', 'renameSync', 'mkdirSync', 'unlinkSync', 'chmodSync',
    'createServer', 'homedir', 'dirname',
  ]
  const factory = new Function(
    ...params,
    '"use strict";\n' + fragments.join('\n') + '\nreturn {' + nameList.join(',') + '};'
  )
  const dep = Object.assign({
    createHash, randomBytes,
    readFileSync, writeFileSync, renameSync, mkdirSync, unlinkSync, chmodSync,
    createServer: null, homedir: null, dirname,
  }, depOverrides || {})
  return factory(
    dep.createHash, dep.randomBytes,
    dep.readFileSync, dep.writeFileSync, dep.renameSync, dep.mkdirSync, dep.unlinkSync, dep.chmodSync,
    dep.createServer, dep.homedir, dep.dirname,
  )
}

const CODEX_JWT_ACCOUNT_CLAIM = 'https://api.openai.com/auth' // 与 src/host.js 同名常量保持一致（JWT 账号声明命名空间）

// 提取纯函数（同一共享作用域）
const fnNames = [
  'decodeBase64Url', 'decodeJwtExp', 'codexExpiresAt', 'codexNeedsRefresh',
  'readCodexAuthFile', 'writeAuthJson', 'readBindFlag', 'writeBindFlag', 'clearBindFlag',
  'createPkcePair', 'buildAuthorizeUrl', 'parseCallbackUrl', 'oauthCallbackPort',
  'codexAccountIdFromJwt', 'buildOAuthAuthObject', 'routingModeFor',
  'readSettingsSection', 'settingsServiceReady',
  'decodeJwtPayload', 'codexIsTokenExpired', 'classifyCodexCredential',
  'withCredentialManaged', 'maskEmail', 'codexAccountSummary', 'planDisplayName',
]
const mod = extractModule(fnNames)
const {
  decodeBase64Url, decodeJwtExp, codexExpiresAt, codexNeedsRefresh,
  readCodexAuthFile, writeAuthJson, readBindFlag, writeBindFlag, clearBindFlag,
  createPkcePair, buildAuthorizeUrl, parseCallbackUrl, oauthCallbackPort,
  codexAccountIdFromJwt, buildOAuthAuthObject, routingModeFor,
  readSettingsSection, settingsServiceReady,
  decodeJwtPayload, codexIsTokenExpired, classifyCodexCredential,
  withCredentialManaged, maskEmail, codexAccountSummary, planDisplayName,
} = mod

// 环境变量隔离（测试前设置）
process.env.DSH_CHATGPT_AUTH = join(tmpdir(), 'dsh-cgpt-test-auth.json')
process.env.DSH_CHATGPT_BIND_FILE = join(tmpdir(), 'dsh-cgpt-test-bind.json')
process.env.DSH_CHATGPT_OAUTH_PORT = '1456'
process.env.DSH_CHATGPT_DATA_DIR = tmpdir()

// ---- 测试 1：JWT 解码 ----
function makeJwt(claims) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  return b64({ alg: 'none' }) + '.' + b64(claims) + '.sig'
}
{
  const exp = Math.floor(Date.now() / 1000) + 3600
  const jwt = makeJwt({ exp, sub: 'test' })
  check('decodeJwtExp 合法 JWT', decodeJwtExp(jwt), exp)
  check('decodeJwtExp 非 JWT → null', decodeJwtExp('not-a-jwt'), null)
  check('decodeJwtExp 空 → null', decodeJwtExp(''), null)
  check('decodeJwtExp 损坏 → null', decodeJwtExp('a.b'), null)
  const noExp = makeJwt({ sub: 'x' })
  check('decodeJwtExp 缺 exp → null', decodeJwtExp(noExp), null)
  check('decodeBase64Url 标准', decodeBase64Url('aGVsbG8='), 'hello')
}

// ---- 测试 2：过期判定 ----
{
  const now = Math.floor(Date.now() / 1000)
  const lastRefreshMs = Date.now()
  check('codexExpiresAt 用 JWT exp', codexExpiresAt(now + 100, lastRefreshMs), now + 100)
  check('codexExpiresAt exp null 走 last_refresh 兜底', codexExpiresAt(null, lastRefreshMs), Math.floor(lastRefreshMs / 1000) + 864000)
  check('codexNeedsRefresh 临近过期(30min) → true', codexNeedsRefresh(now + 30 * 60, now), true)
  check('codexNeedsRefresh 充足(1d) → false', codexNeedsRefresh(now + 86400, now), false)
}

// ---- 测试 2b：模式路由判定 ----
{
  check('健康绑定 + ChatGPT → ChatGPT 模式', routingModeFor(true, true, 'openai-codex'), 'chatgpt')
  check('健康绑定 + DeepSeek → DeepSeek 模式', routingModeFor(true, true, 'deepseek-official'), 'deepseek')
  check('令牌失效 + ChatGPT 选择 → DeepSeek 模式', routingModeFor(true, false, 'openai-codex'), 'deepseek')
  check('未绑定 + ChatGPT 选择 → DeepSeek 模式', routingModeFor(false, true, 'openai-codex'), 'deepseek')
}

// ---- 测试 2c：settings 服务跨版本读取（0.1.7 移除 get(ns)，只剩 describe()） ----
// 回归背景：旧代码只认 settings.get，新宿主上没有这个函数 → ensureCodexRoute 直接
// 早退成「settings 服务未就绪，下个周期重试」，绑定 ChatGPT 后路由永远注册不上。
{
  const section = { providers: { 'openai-codex': { apiKeyEnv: 'OPENAI_CODEX_API_KEY' } } }
  // 新宿主：describe() 返回描述数组，按 ns 定位
  const newHost = { describe: () => [{ ns: 'llm-deepseek', value: {} }, { ns: 'llm-pi-ai', value: section }], mutate: () => {} }
  check('新宿主 describe() 能读到 llm-pi-ai', readSettingsSection(newHost, 'llm-pi-ai'), section)
  check('新宿主 describe() 缺该节 → undefined', readSettingsSection(newHost, 'ui-theme'), undefined)
  check('新宿主 readiness = true', settingsServiceReady(newHost), true)
  // 旧宿主：只有 get(ns)
  const oldHost = { get: (ns) => (ns === 'llm-pi-ai' ? section : undefined), mutate: () => {} }
  check('旧宿主 get(ns) 兜底可用', readSettingsSection(oldHost, 'llm-pi-ai'), section)
  check('旧宿主 readiness = true', settingsServiceReady(oldHost), true)
  // describe() 抛错时回落 get(ns)，不崩
  const brokenDescribe = { describe: () => { throw new Error('boom') }, get: () => section, mutate: () => {} }
  check('describe() 抛错 → 回落 get(ns)', readSettingsSection(brokenDescribe, 'llm-pi-ai'), section)
  // describe() 回畸形值时不崩
  check('describe() 回非数组 → undefined（无 get 时）', readSettingsSection({ describe: () => 'nope' }, 'llm-pi-ai'), undefined)
  check('get(ns) 抛错 → undefined', readSettingsSection({ get: () => { throw new Error('boom') } }, 'llm-pi-ai'), undefined)
  // readiness 闸门：能读但不会写 / 什么都不会，都判为未就绪
  check('只有读能力、无 mutate → 未就绪（防止写不进去还宣称成功）', settingsServiceReady({ describe: () => [] }), false)
  check('空对象 → 未就绪', settingsServiceReady({}), false)
  check('null / undefined → 未就绪', [settingsServiceReady(null), settingsServiceReady(undefined)], [false, false])
}

// ---- 测试 2d：凭据归属判定（红字死锁的根治点） ----
// 回归背景：v0.1.0 的绑定标记没有「凭据归本插件所有」一栏，旧判定「槽位非空即他人所有」
// 把插件自己早期注入的令牌当成别人的，永久拒绝更新 —— 2026-08-20 起常驻红字。
// 判定必须建立在可自证的证据上，而不是历史记账是否齐全。
{
  const now = Math.floor(Date.now() / 1000)
  const acctA = makeJwt({ exp: now + 86400, [CODEX_JWT_ACCOUNT_CLAIM]: { chatgpt_account_id: 'acct-A' } })
  const acctB = makeJwt({ exp: now + 86400, [CODEX_JWT_ACCOUNT_CLAIM]: { chatgpt_account_id: 'acct-B' } })
  const staleA = makeJwt({ exp: now - 86400, [CODEX_JWT_ACCOUNT_CLAIM]: { chatgpt_account_id: 'acct-A' } })

  check('槽位为空 → 可接管（首次注入）', classifyCodexCredential('', acctA, {}), { claim: true, reason: 'empty' })
  check('进程内已确认归属 → 可接管', classifyCodexCredential(acctB, acctA, { ownedInProcess: true }), { claim: true, reason: 'owned' })
  check('账本记了归属 → 可接管', classifyCodexCredential(acctB, acctA, { managed: true }), { claim: true, reason: 'managed' })
  check('无候选令牌 → 拒绝', classifyCodexCredential(acctB, '', {}), { claim: false, reason: 'no-candidate' })
  check('逐字节同值 → 认定为同源', classifyCodexCredential(acctA, acctA, {}), { claim: true, reason: 'same-value' })
  check('同一 ChatGPT 账号 → 认定为同源', classifyCodexCredential(staleA, acctA, { boundFlag: true, nowSeconds: now }), { claim: true, reason: 'same-account' })
  check('同一账号判定优先于过期判定', classifyCodexCredential(staleA, acctA, { boundFlag: true, nowSeconds: now }).reason, 'same-account')
  check('不同账号 → 拒绝（绝不覆盖他人凭据）', classifyCodexCredential(acctB, acctA, { boundFlag: true, nowSeconds: now }), { claim: false, reason: 'other' })
  check('已绑定 + 槽内过期 + 新的有效 → 可接管', classifyCodexCredential(makeJwt({ exp: now - 10 }), acctA, { boundFlag: true, nowSeconds: now }), { claim: true, reason: 'expired-stale' })
  check('槽内过期但新的也过期 → 拒绝', classifyCodexCredential(makeJwt({ exp: now - 20 }), makeJwt({ exp: now - 10 }), { boundFlag: true, nowSeconds: now }), { claim: false, reason: 'other' })
  check('未绑定时不走过期接管（保守）', classifyCodexCredential(makeJwt({ exp: now - 10 }), acctA, { boundFlag: false, nowSeconds: now }), { claim: false, reason: 'other' })
}

// ---- 测试 2e：账本迁移（旧标记补齐 ownership 一栏） ----
{
  const oldFlag = { ok: true, bound: true, boundAt: '2026-08-20T00:00:00.000Z', routeOwned: true, defaultModelManaged: false, previousDefaultModel: null }
  const migrated = withCredentialManaged(oldFlag)
  check('迁移后标记归属', migrated.credentialManaged, true)
  check('迁移保留路由所有权', migrated.routeOwned, true)
  check('迁移保留首次绑定时间', migrated.boundAt, '2026-08-20T00:00:00.000Z')
  check('迁移对空对象也成立', withCredentialManaged(null).credentialManaged, true)
  check('迁移后 boundAt 非空', typeof withCredentialManaged(null).boundAt, 'string')
}

// ---- 测试 2f：页面展示脱敏（完整邮箱绝不出 host） ----
{
  check('maskEmail 正常邮箱', maskEmail('songsong@gmail.com'), 'so•••@gmail.com')
  check('maskEmail 短本地部分', maskEmail('a@gmail.com'), 'a•••@gmail.com')
  check('maskEmail 非法 → null', maskEmail('not-an-email'), null)
  check('maskEmail 空 → null', maskEmail(''), null)
  check('maskEmail 非字符串 → null', maskEmail(null), null)
  check('planDisplayName plus', planDisplayName('plus'), 'Plus')
  check('planDisplayName 未知档位原样返回', planDisplayName('ultra'), 'ultra')
  check('planDisplayName 空 → null', planDisplayName(''), null)
  const now = Math.floor(Date.now() / 1000)
  const idTok = makeJwt({
    exp: now + 86400,
    email: 'songsong@gmail.com',
    [CODEX_JWT_ACCOUNT_CLAIM]: { chatgpt_account_id: 'acct-A', chatgpt_plan_type: 'plus' },
  })
  const summary = codexAccountSummary({ tokens: { id_token: idTok, access_token: makeJwt({ exp: now + 86400 }) } })
  check('账号摘要邮箱已脱敏', summary.email, 'so•••@gmail.com')
  check('账号摘要套餐可读', summary.plan, 'plus')
  check('账号摘要不含完整邮箱', JSON.stringify(summary).includes('songsong@gmail.com'), false)
  check('无令牌时摘要不崩', codexAccountSummary({}), { email: null, plan: null })
}

// ---- 测试 3：绑定标记 ----
{
  const file = process.env.DSH_CHATGPT_BIND_FILE
  clearBindFlag(file)
  check('readBindFlag 无文件 → bound false', readBindFlag(file).bound, false)
  writeBindFlag(file, { plan: 'plus' })
  const f = readBindFlag(file)
  check('readBindFlag 写后 → bound true', f.bound, true)
  check('writeBindFlag 权限为 0600', statSync(file).mode & 0o777, 0o600)
  // readBindFlag 契约只返回 { ok, bound }；扩展字段（plan 等）写入文件保留（供外部读取），不参与读回
  const rawFlag = JSON.parse(readFileSync(file, 'utf8'))
  check('readBindFlag 扩展字段写入文件', rawFlag.plan, 'plus')
  clearBindFlag(file)
  check('clearBindFlag 后 → bound false', readBindFlag(file).bound, false)
}

// ---- 测试 4：auth.json 读/写 ----
{
  const file = process.env.DSH_CHATGPT_AUTH
  writeFileSync(file, JSON.stringify({ auth_mode: 'oauth', tokens: { access_token: 'acc1', refresh_token: 'ref1', account_id: 'acc-id' }, last_refresh: '2026-08-14T00:00:00.000Z' }))
  const r = readCodexAuthFile(file)
  check('readCodexAuthFile ok', r.ok, true)
  check('readCodexAuthFile 读 access', r.auth.tokens.access_token, 'acc1')
  const updated = writeAuthJson(file, r.auth, 'acc2', 'ref2', '2026-08-16T00:00:00.000Z')
  const r2 = readCodexAuthFile(file)
  check('writeAuthJson 更新 access', r2.auth.tokens.access_token, 'acc2')
  check('writeAuthJson 更新 refresh', r2.auth.tokens.refresh_token, 'ref2')
  check('writeAuthJson 保留 account_id', r2.auth.tokens.account_id, 'acc-id')
  check('writeAuthJson 保留 auth_mode', r2.auth.auth_mode, 'oauth')
  check('writeAuthJson last_refresh 更新', r2.auth.last_refresh, '2026-08-16T00:00:00.000Z')
  check('writeAuthJson 权限为 0600', statSync(file).mode & 0o777, 0o600)
}

// ---- 测试 5：PKCE / 授权 URL / 回调解析 ----
{
  const pkce = createPkcePair()
  check('PKCE verifier 32 字节', pkce.verifier.length >= 40, true)
  check('PKCE challenge 非空', pkce.challenge.length > 0, true)
  const url = buildAuthorizeUrl('state123', pkce.challenge)
  check('authorizeUrl 含 client_id', url.includes('client_id='), true)
  check('authorizeUrl 含 state', url.includes('state=state123'), true)
  check('authorizeUrl 含 code_challenge', url.includes('code_challenge=' + encodeURIComponent(pkce.challenge)), true)
  check('authorizeUrl 含 redirect_uri', url.includes('redirect_uri='), true)
  const cb = parseCallbackUrl('http://localhost:1456/auth/callback?code=xyz&state=state123')
  check('parseCallbackUrl code', cb.code, 'xyz')
  check('parseCallbackUrl state', cb.state, 'state123')
  const cb2 = parseCallbackUrl('http://localhost:1456/auth/callback#code=hashcode&state=s2')
  check('parseCallbackUrl hash 分支', cb2.code, 'hashcode')
  check('parseCallbackUrl hash state', cb2.state, 's2')
  check('oauthCallbackPort env 覆盖', oauthCallbackPort(), 1456)
}

// ---- 测试 5b：account_id 提取 / auth 对象构造 ----
{
  // 构造含官方账号声明的 JWT
  const accountClaim = 'https://api.openai.com/auth'
  const jwt = makeJwt({ [accountClaim]: { chatgpt_account_id: 'acc-123' } })
  check('codexAccountIdFromJwt 提取成功', codexAccountIdFromJwt(jwt), 'acc-123')
  check('codexAccountIdFromJwt 非 JWT → null', codexAccountIdFromJwt('x.y.z'), null)
  check('codexAccountIdFromJwt 空 → null', codexAccountIdFromJwt(''), null)
  check('codexAccountIdFromJwt 缺声明 → null', codexAccountIdFromJwt(makeJwt({ sub: 'x' })), null)

  const nowIso = '2026-08-16T00:00:00.000Z'
  const exchange = { access_token: jwt, refresh_token: 'ref-new', id_token: 'id-new' }
  const built = buildOAuthAuthObject(null, exchange, nowIso)
  check('buildOAuthAuthObject 全新骨架 auth_mode', built.auth_mode, 'oauth')
  check('buildOAuthAuthObject access_token', built.tokens.access_token, jwt)
  check('buildOAuthAuthObject refresh_token', built.tokens.refresh_token, 'ref-new')
  check('buildOAuthAuthObject id_token', built.tokens.id_token, 'id-new')
  check('buildOAuthAuthObject account_id 提取', built.tokens.account_id, 'acc-123')
  check('buildOAuthAuthObject last_refresh', built.last_refresh, nowIso)

  // 已有结构保留 + refresh 缺失不覆盖旧值
  const existing = { auth_mode: 'oauth', OPENAI_API_KEY: 'fake-openai-key', tokens: { account_id: 'acc-old', refresh_token: 'ref-old' }, last_refresh: '2026-08-01T00:00:00.000Z' }
  const built2 = buildOAuthAuthObject(existing, { access_token: jwt, refresh_token: null, id_token: null }, nowIso)
  check('buildOAuthAuthObject 保留 OPENAI_API_KEY', built2.OPENAI_API_KEY, 'fake-openai-key')
  check('buildOAuthAuthObject refresh 缺失保留旧值', built2.tokens.refresh_token, 'ref-old')
  check('buildOAuthAuthObject account_id 更新为新', built2.tokens.account_id, 'acc-123')
}

// ---- 测试 6：安全静态断言 ----
{
  check('host 源码无 token 打印', /console\.(log|warn|error)[^;]*(token|access_token|refresh_token|Authorization|Bearer)/.test(src), false)
  check('host 源码无 eyJ 字面量', src.includes('eyJ'), false)
  check('host 无个人路径', src.includes(['/Users', 'probe'].join('/')), false)
  check('host env 前缀 DSH_CHATGPT', src.includes('DSH_CHATGPT'), true)
  check('host 不读取或删除 DeepSeek 密钥值', src.includes('ctx.credentials.resolve(\'DEEPSEEK_API_KEY\')'), false)
  check('host 不管理搜索配置', !src.includes('SEARCH_SETTINGS_NAMESPACE') && !src.includes('setSearchMode'), true)
  check('host 包含单飞保护', src.includes('syncInFlight'), true)
  check('host 包含默认模型回滚保护', src.includes('restoreDefaultModel'), true)
  check('host 拒绝自定义同名路由覆盖', src.includes("existing.apiKeyEnv !== 'OPENAI_CODEX_API_KEY'") && src.includes('MSG_ROUTE_CONFLICT'), true)
  check('host 解绑移除自有路由', src.includes("path: ['providers', 'openai-codex'] }]"), true)
  check('host 不删除用户已有 Codex 路由', src.includes('同名用户路由只读不删不改'), true)
  check('host 只清理自有 Codex 凭据', src.includes('codexCredentialOwned') && src.includes('credentialManaged'), true)
  check('host 覆盖前检查已有 Codex 凭据', src.includes('classifyCodexCredentialSlot') && src.includes('credentials-conflict'), true)
  // 回归：归属判定不能退化成「槽位非空即他人所有」，否则插件会把自己早期注入的令牌锁在门外
  check('host 归属判定基于可自证证据', src.includes('classifyCodexCredential'), true)
  check('host 接管后补记账本（防复发）', src.includes('withCredentialManaged(flag)'), true)
  check('host 不再残留旧的空槽即放行判定', src.includes('canClaimCodexCredential('), false)
  check('host 失效状态清理 Codex 凭据', (src.match(/clearInjectedCodexCredential\(flag\)/g) || []).length >= 4, true)
  check('OAuth 启动 RPC 仍要求 POST', src.includes('MUTATING = { startCodexOAuth: true') && src.includes("req.method !== 'POST'"), true)
  check('插件路由使用官方 connection 认证边界', src.includes("ctx.inject(['connection', 'webServer']") && src.includes('webCtx.connection.requestRejection(req)'), true)
  check('不再用桌面端转发时会被移除的 Origin 请求头做鉴权', !src.includes('DESKTOP_APP_ORIGIN') && !src.includes('function sameOrigin(req)'), true)
  check('ChatGPT 默认模型使用明确配置', src.includes('CODEX_DEFAULT_MODEL'), true)
  check('客户端 RPC 检查 HTTP 状态', clientSrc.includes("if (!r.ok) throw new Error"), true)
  check('客户端对 OAuth 启动和解绑使用 POST', /const MUTATING_RPC = \{[^}]*startCodexOAuth: true,[^}]*unbindCodex: true/.test(clientSrc) && clientSrc.includes("method: mutating ? 'POST' : 'GET'"), true)
  check('客户端卸载清理授权轮询', clientSrc.includes('pollRef.current'), true)
  check('未绑定启动不主动注册 ChatGPT 路由', !src.includes('    ensureCodexRoute();\n    syncCodexToken();'), true)
  check('host 读 llm-pi-ai 一律经 readSettingsSection（0.1.7 起 settings.get 已被移除）',
    src.includes("readSettingsSection(settings, 'llm-pi-ai')") && !src.includes("settings.get('llm-pi-ai')"), true)
  check('host 的 settings 就绪判定兼容两代宿主（describe 或 get）',
    src.includes('function settingsServiceReady(settings)') && src.includes('return typeof settings.describe'), true)
}

// ---- 测试 N：源码可解析（2026-09-22 回归：括号错位只炸运行时 import，函数级抽取测试测不到） ----
{
  const { spawnSync } = await import('node:child_process')
  for (const f of ['src/host.js', 'src/client-bundle.js']) {
    const r = spawnSync(process.execPath, ['--check', join(root, f)], { encoding: 'utf8' })
    check(`源码可解析 ${f}`, r.status, 0)
  }
}

// 清理临时文件
try { rmSync(process.env.DSH_CHATGPT_AUTH, { force: true }); rmSync(process.env.DSH_CHATGPT_BIND_FILE, { force: true }); } catch (e) {}

// ---- 结果 ----
console.log(`test-codex-host: ${pass} PASS / ${fail} FAIL`)
if (failures.length > 0) { console.log(failures.join('\n')); }
process.exit(fail > 0 ? 1 : 0)
