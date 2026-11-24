// dsh-chatgpt-sub — 失败路径回归（2026-11-24 全量自查 A1–A7）
//
// 这一类问题反复出现过几轮，共同形态是「失败不报告，或者一失败就毁状态」：
//   A1  请求体超限时把 socket 毁了，413 响应永远发不出去；
//   A2  模型目录读不到时吞掉失败、写空路由、假报「已连接」；
//   A3  续期遇网络抖动失败时，没人把仍有效的旧令牌注回去，全线 401；
//   A4  重新绑定中途失败时，把用户原本可用的旧登录一起删掉；
//   A5  定时同步与授权流程并发交错，写回可能覆盖刚保存的新会话；
//   A6  模型列表里一条带 visibility 字段，其余没带的被整批丢弃；
//   A7  若干网络错误码认不出来，只能显示「认不出来的失败」。
// 全部用例走真实路径：真 HTTP 服务器、真代理、真授权回调；网络上游用受控替身。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseModelList } from '../src/siwc.js'
import { classifyNetworkError } from '../src/network.js'
import { startResponsesProxy } from '../src/proxy.js'

process.env.NO_PROXY = '127.0.0.1,localhost'
process.env.no_proxy = '127.0.0.1,localhost'
const originalFetch = globalThis.fetch

function networkError(code, message) {
  const err = new TypeError('fetch failed')
  err.cause = Object.assign(new Error(message || ('connect ' + code)), { code })
  return err
}

async function pollUntil(fn, timeoutMs) {
  const start = Date.now()
  const limit = timeoutMs || 8000
  while (Date.now() - start < limit) {
    const value = await fn()
    if (value) return value
    await new Promise(function (resolve) { setTimeout(resolve, 50) })
  }
  throw new Error('poll timeout')
}

// =====================================================================================
// A6 / A7：纯函数
// =====================================================================================
{
  const mixed = parseModelList({ models: [
    { slug: 'a', display_name: 'A', visibility: 'list' },
    { slug: 'b', display_name: 'B' },
    { slug: 'c', display_name: 'C', visibility: 'hide' },
    { slug: 'd', display_name: 'D', visibility: 'list' },
  ] })
  assert.deepEqual(mixed.map(function (m) { return m.id }), ['a', 'b', 'd'], '没带 visibility 的条目不许被连坐丢弃')
  const plain = parseModelList({ models: [{ slug: 'x' }, { slug: 'y' }] })
  assert.deepEqual(plain.map(function (m) { return m.id }), ['x', 'y'])
  console.log('A6 parseModelList visibility: PASS')
}
{
  assert.deepEqual(classifyNetworkError({ code: 'ECONNABORTED', message: 'socket hang up' }), { reason: 'unreachable' })
  assert.deepEqual(classifyNetworkError({ code: 'UND_ERR_CLOSED', message: 'closed' }), { reason: 'unreachable' })
  assert.deepEqual(classifyNetworkError({ code: 'ERR_SSL_WRONG_VERSION_NUMBER', message: 'write EPROTO ssl wrong version' }), { reason: 'tls' })
  assert.deepEqual(
    classifyNetworkError({ code: 'EPROTO', message: 'write EPROTO 1234:error:0A00010B:SSL routines:ssl3_get_record:wrong version number' }),
    { reason: 'tls' },
  )
  assert.deepEqual(
    classifyNetworkError({ code: 'EPROTO', message: 'write EPROTO unknown protocol' }),
    { reason: 'unknown' },
    'EPROTO 不带 SSL 标记时不许无脑归 tls',
  )
  console.log('A7 network classification additions: PASS')
}

// =====================================================================================
// A1（代理侧）：超限请求必须真收到 413，而不是连接被重置
// =====================================================================================
{
  const proxy = await startResponsesProxy({
    getAccessToken: function () { return 'tok' },
    upstreamOrigin: 'http://upstream.test',
    log: function () {},
  })
  try {
    const big = Buffer.alloc(48 * 1024 * 1024 + 4096, 0x61)
    const res = await originalFetch(proxy.baseUrl + '/responses', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: big,
    })
    assert.equal(res.status, 413, '超限必须回 413，连接被重置会让这里直接抛错')
    const body = await res.json()
    assert.equal(body.error.message, 'Request body is too large')
    const after = await originalFetch(proxy.baseUrl + '/responses', {
      method: 'POST',
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: 'not json',
    })
    assert.equal(after.status, 400, '413 之后代理必须还活着')
    console.log('A1 proxy 413 delivery: PASS')
  } finally {
    proxy.close()
  }
}

// =====================================================================================
// host 级装置：与 test-siwc-flow 同形态（内存凭据/设置 + 真实 RPC 服务器）
// =====================================================================================
const HOST_ID = 'urn:uuid:11111111-1111-4111-8111-111111111111'
let importCounter = 0

async function startPlugin(scenario) {
  const temporary = mkdtempSync(join(tmpdir(), 'dsh-failure-paths-'))
  process.env.DSH_CHATGPT_DATA_DIR = temporary
  process.env.DSH_CHATGPT_SELF_UPDATE = 'off'
  process.env.DSH_CHATGPT_BIND_FILE = join(temporary, 'bind.json')
  process.env.DSH_CHATGPT_OAUTH_TIMEOUT_MS = '5000'
  if (scenario.bindFlag) writeFileSync(process.env.DSH_CHATGPT_BIND_FILE, JSON.stringify(scenario.bindFlag, null, 2) + '\n')

  const records = new Map()
  const values = new Map()
  const sections = { 'llm-pi-ai': { providers: {} } }
  let selection = { provider: 'deepseek-official', model: 'synthetic' }
  if (scenario.session) records.set('chatgpt-sub/session', { kind: 'grant', payload: scenario.session })

  const credentials = {
    async readRecord(key) { return records.get(key) },
    async modifyRecord(key, mutate) {
      const next = await mutate(records.get(key))
      if (next !== undefined) records.set(key, next)
      return records.get(key)
    },
    async deleteRecord(key) { records.delete(key) },
    async set(name, value) { values.set(name, value) },
    async unset(name) { values.delete(name) },
    async resolve(name) { return values.has(name) ? { value: values.get(name), source: 'test' } : undefined },
  }
  const settings = {
    describe() { return Object.entries(sections).map(function ([ns, value]) { return { ns, value } }) },
    async mutate(ns, operations) {
      for (const operation of operations) {
        if (operation.op === 'set') sections[ns].providers[operation.path[1]] = operation.value
        else delete sections[ns].providers[operation.path[1]]
      }
    },
  }
  globalThis.fetch = scenario.fetch

  const intervalCallbacks = []
  let route = null
  const plugin = (await import('../lib/index.js?failurepaths=' + (++importCounter))).default
  plugin.apply({
    shell: { run: async function () { return { exitCode: 0 } } },
    credentials,
    settings,
    get(name) {
      if (name === 'agentDefaultModel') return {
        currentSelection: function () { return selection },
        saveSelection: async function (value) { selection = value },
      }
      return undefined
    },
    interval(fn) { intervalCallbacks.push(fn) },
    effect(fn) { return fn() },
    inject(_names, fn) {
      fn({
        connection: {},
        effect: function (inner) { return inner() },
        webServer: { register(value) { route = value; return function () {} } },
      })
    },
  })
  const rpcServer = createServer(route.handler)
  await new Promise(function (resolve) { rpcServer.listen(0, '127.0.0.1', resolve) })
  const base = 'http://127.0.0.1:' + rpcServer.address().port + route.path + '/'
  return {
    records,
    values,
    sections,
    intervalCallbacks,
    async rpc(method, body) {
      const res = await originalFetch(base + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? '{}' : (typeof body === 'string' ? body : JSON.stringify(body)),
      })
      const text = await res.text()
      return { status: res.status, data: text ? JSON.parse(text) : null }
    },
    async status() {
      const res = await originalFetch(base + 'getCodexBridgeStatus')
      return res.json()
    },
    async cleanup() {
      rpcServer.closeAllConnections()
      await new Promise(function (resolve) { rpcServer.close(resolve) })
      globalThis.fetch = originalFetch
      rmSync(temporary, { recursive: true, force: true })
    },
  }
}

function seedSession(overrides) {
  return Object.assign({
    version: 1,
    clientId: 'oaiapp_a',
    hostId: HOST_ID,
    subject: 'user-a',
    email: 'a@example.com',
    plan: 'plus',
    planExpiresAt: null,
    idToken: 'id-a',
    accessToken: 'access-a1',
    refreshToken: 'refresh-a1',
    expiresAt: Date.now() + 3600_000,
    earliestRefreshAt: null,
    scopes: ['openid', 'chatgpt.tokens.use.direct'],
    savedAt: new Date().toISOString(),
  }, overrides || {})
}

function seedFlag(overrides) {
  return Object.assign({
    version: 2,
    bound: true,
    boundAt: new Date().toISOString(),
    clientId: 'oaiapp_a',
    hostId: HOST_ID,
    email: 'a@example.com',
    plan: 'plus',
    models: [],
    routeOwned: true,
    credentialManaged: true,
  }, overrides || {})
}

// =====================================================================================
// A1（host 侧）：RPC 请求体超限同样必须真收到 413
// =====================================================================================
{
  const plugin = await startPlugin({
    fetch: async function (url) { throw new Error('unexpected fetch: ' + String(url)) },
  })
  try {
    const res = await plugin.rpc('startCodexOAuth', 'a'.repeat(100 * 1024))
    assert.equal(res.status, 413, 'RPC 超限必须回 413，连接被重置会让 rpc() 直接抛错')
    assert.equal(res.data.error, 'payload too large')
    console.log('A1 host RPC 413 delivery: PASS')
  } finally {
    await plugin.cleanup()
  }
}

// =====================================================================================
// A2：模型目录读不到 → 报 models.* 错误、不写路由、不假报已连接
// =====================================================================================
{
  const plugin = await startPlugin({
    session: seedSession(),
    bindFlag: seedFlag({ models: [] }),
    fetch: async function (url) {
      if (String(url) === 'https://api.openai.com/v1/models') throw networkError('ENOTFOUND', 'getaddrinfo ENOTFOUND api.openai.com')
      throw new Error('unexpected fetch: ' + String(url))
    },
  })
  try {
    const status = await pollUntil(async function () {
      const s = await plugin.status()
      return s.lastSyncAt ? s : null
    })
    assert.equal(status.bound, true)
    assert.equal(status.ok, false, '模型没读到不许报已连接')
    assert.equal(status.error && status.error.code, 'models.dns')
    assert.equal(plugin.sections['llm-pi-ai'].providers['chatgpt-siwc'], undefined, '不许拿空模型列表写路由')
    console.log('A2 models failure surfaces: PASS')
  } finally {
    await plugin.cleanup()
  }
}

// =====================================================================================
// A3：续期遇网络失败 → 仍有效的旧令牌要注回去，错误照样报告
// =====================================================================================
{
  const plugin = await startPlugin({
    session: seedSession({ accessToken: 'access-old', expiresAt: Date.now() + 5 * 60_000 }),
    bindFlag: seedFlag({ models: [{ id: 'model-a', name: 'Model A' }] }),
    fetch: async function (url) {
      if (String(url) === 'https://auth.openai.com/api/accounts/oauth/token') {
        throw networkError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:7890')
      }
      if (String(url) === 'https://api.openai.com/v1/models') {
        return new Response(JSON.stringify({ models: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error('unexpected fetch: ' + String(url))
    },
  })
  try {
    const status = await pollUntil(async function () {
      const s = await plugin.status()
      return s.lastSyncAt && s.error ? s : null
    })
    assert.equal(status.error && status.error.code, 'token.refresh-refused', '续期失败要按原因报告')
    assert.equal(plugin.values.get('CHATGPT_SIWC_TOKEN'), 'access-old', '旧令牌没过期就必须注回去顶着')
    const record = plugin.records.get('chatgpt-sub/session')
    assert.equal(record.payload.accessToken, 'access-old', '会话记录不许被失败续期动掉')
    console.log('A3 refresh failure keeps old token: PASS')
  } finally {
    await plugin.cleanup()
  }
}

// =====================================================================================
// A5：授权进行中，定时同步必须跳过（不许触发续期写回）
// =====================================================================================
{
  let refreshCalls = 0
  const plugin = await startPlugin({
    session: seedSession({ expiresAt: Date.now() + 3600_000 }),
    bindFlag: seedFlag({ models: [{ id: 'model-a', name: 'Model A' }] }),
    fetch: async function (url, options) {
      const target = String(url)
      if (target === 'https://auth.openai.com/api/accounts/oauth/token') {
        const form = new URLSearchParams(options.body)
        if (form.get('grant_type') === 'refresh_token') {
          refreshCalls++
          return new Response(JSON.stringify({
            access_token: 'access-refreshed', refresh_token: 'refresh-a2', token_type: 'Bearer', expires_in: 3600,
            scope: 'openid chatgpt.tokens.use.direct',
          }), { status: 200, headers: { 'content-type': 'application/json' } })
        }
        throw new Error('unexpected token grant: ' + form.get('grant_type'))
      }
      if (target === 'https://api.openai.com/v1/models') {
        return new Response(JSON.stringify({ models: [{ slug: 'model-a', display_name: 'Model A', visibility: 'list' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error('unexpected fetch: ' + target)
    },
  })
  try {
    await pollUntil(async function () {
      const s = await plugin.status()
      return s.ok ? s : null
    })
    // 初始同步已落定。把会话改成「需要续期」，再开一段授权流程挂住，
    // 然后手动触发定时同步的那一轮：授权没结束前，它不许碰续期。
    const record = plugin.records.get('chatgpt-sub/session')
    record.payload.expiresAt = Date.now() + 60_000
    refreshCalls = 0
    const started = await plugin.rpc('startCodexOAuth', { language: 'en' })
    assert.equal(started.data.ok, true)
    assert.equal(plugin.intervalCallbacks.length > 0, true)
    await plugin.intervalCallbacks[0]()
    assert.equal(refreshCalls, 0, '授权进行中，同步不许触发续期写回')
    console.log('A5 sync skips during OAuth: PASS')
  } finally {
    await plugin.cleanup()
  }
}

// =====================================================================================
// A4：重新绑定中途拉模型失败 → 恢复旧会话，而不是把登录删掉
// =====================================================================================
{
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = publicKey.export({ format: 'jwk' })
  const kid = 'test-key-fp'
  const rsaJwk = { ...jwk, kid, alg: 'RS256', use: 'sig' }
  function base64url(value) { return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url') }
  function makeIdToken(claims) {
    const header = base64url({ alg: 'RS256', typ: 'JWT', kid })
    const payload = base64url(claims)
    const signature = sign('RSA-SHA256', Buffer.from(header + '.' + payload), privateKey).toString('base64url')
    return header + '.' + payload + '.' + signature
  }
  let pendingNonce = null
  const plugin = await startPlugin({
    session: seedSession(),
    bindFlag: seedFlag({ models: [] }),
    fetch: async function (url, options) {
      const target = String(url)
      if (target === 'https://auth.openai.com/api/accounts/oauth/token') {
        const idToken = makeIdToken({
          iss: 'https://auth.openai.com', aud: 'oaiapp_a', sub: 'user-a',
          email: 'a@example.com', nonce: pendingNonce, exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        })
        return new Response(JSON.stringify({
          access_token: 'access-a2', refresh_token: 'refresh-a2', id_token: idToken,
          token_type: 'Bearer', expires_in: 3600,
          scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (target === 'https://auth.openai.com/.well-known/jwks.json') {
        return new Response(JSON.stringify({ keys: [rsaJwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (target === 'https://api.openai.com/v1/models') throw networkError('ENOTFOUND', 'getaddrinfo ENOTFOUND api.openai.com')
      throw new Error('unexpected fetch: ' + target)
    },
  })
  try {
    const started = await plugin.rpc('startCodexOAuth', { language: 'en' })
    assert.equal(started.data.ok, true)
    const authorize = new URL(started.data.authorizeUrl)
    assert.equal(authorize.searchParams.get('client_id'), 'oaiapp_a')
    pendingNonce = authorize.searchParams.get('nonce')
    const callback = new URL(authorize.searchParams.get('redirect_uri'))
    callback.searchParams.set('state', authorize.searchParams.get('state'))
    callback.searchParams.set('code', 'synthetic-code')
    callback.searchParams.set('client_id', 'oaiapp_a')
    const page = await originalFetch(callback, { signal: AbortSignal.timeout(4000) })
    assert.equal(page.status, 200)
    const status = await pollUntil(async function () {
      const s = await plugin.status()
      return !s.oauthInFlight && s.error ? s : null
    })
    assert.equal(status.error && status.error.code, 'models.dns')
    const record = plugin.records.get('chatgpt-sub/session')
    assert.ok(record, '重绑失败不许把旧登录删掉')
    assert.equal(record.payload.accessToken, 'access-a1', '旧会话必须原样恢复')
    assert.equal(record.payload.refreshToken, 'refresh-a1')
    console.log('A4 rebind failure restores previous session: PASS')
  } finally {
    await plugin.cleanup()
  }
}

process.exit(0)
