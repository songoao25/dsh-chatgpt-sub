// dsh-chatgpt-sub — SIWC 协议与真实 loopback 流程回归
// 不联系 OpenAI：token/JWKS/models 全部由本地 mock 提供；浏览器回调走真实 127.0.0.1。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeResponsesBody, parseModelList, buildAuthorizeUrl, parseCallbackParams, maskEmail } from '../src/siwc.js'

// ---------- 纯函数 ----------
{
  const body = normalizeResponsesBody({
    model: 'gpt-6.1-sol',
    input: [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      { type: 'reasoning', id: 'rs_1', summary: [] },
    ],
    tools: [{ type: 'function', name: 'Read', description: 'read', parameters: { type: 'object' } }],
    tool_choice: { type: 'function', name: 'Read' },
    temperature: 0.2,
    max_output_tokens: 1024,
    top_p: 0.9,
    store: true,
    stream: false,
    metadata: { a: 1 },
    prompt_cache_retention: '24h',
  })
  assert.equal(body.store, false)
  assert.equal(body.stream, true)
  assert.equal(body.temperature, undefined)
  assert.equal(body.max_output_tokens, undefined)
  assert.equal(body.top_p, undefined)
  assert.equal(body.metadata, undefined)
  assert.equal(body.prompt_cache_retention, undefined)
  assert.equal(body.input.length, 2, 'reasoning items are dropped')
  assert.equal(body.input[0].role, 'developer', 'system becomes developer')
  assert.equal(body.tools.length, 1)
  assert.equal(body.tools[0].type, 'namespace')
  assert.equal(body.tools[0].name, 'dsh')
  assert.equal(body.tools[0].tools[0].name, 'Read')
  assert.equal(body.tool_choice, 'auto')
  console.log('normalizeResponsesBody: PASS')
}

{
  const models = parseModelList({ models: [
    { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' },
    { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' },
  ] })
  assert.deepEqual(models, [{ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' }])
  // visibility 是可选字段：同批里有一条带它，不代表其余条目不可见。
  // 以前只要出现一个 visibility，不带该字段的条目就被整条丢掉（模型直接消失）。
  const mixed = parseModelList({ models: [
    { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' },
    { slug: 'gpt-6.1-mini', display_name: 'GPT-6.1 Mini' },
    { slug: 'hidden', display_name: 'Hidden', visibility: 'hide' },
  ] })
  assert.deepEqual(mixed, [
    { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
    { id: 'gpt-6.1-mini', name: 'GPT-6.1 Mini' },
  ], 'entries without a visibility field stay visible')
  const url = new URL(buildAuthorizeUrl({
    clientId: 'dynamic_agent_client', hostId: 'urn:uuid:00000000-0000-4000-8000-000000000000',
    redirectUri: 'http://127.0.0.1:12345/auth/callback', state: 'st', nonce: 'no',
    codeChallenge: 'cc', agentNameHint: 'DSH ChatGPT 订阅',
  }))
  assert.equal(url.origin + url.pathname, 'https://auth.openai.com/api/accounts/authorize')
  assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client')
  assert.equal(url.searchParams.get('ext_agent_host_id'), 'urn:uuid:00000000-0000-4000-8000-000000000000')
  assert.equal(url.searchParams.get('agent_name_hint'), 'DSH ChatGPT 订阅')
  assert.equal(url.searchParams.get('resource'), 'https://api.openai.com/v1')
  assert.ok(url.searchParams.get('scope').includes('chatgpt.tokens.use.direct'))
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  const reauth = new URL(buildAuthorizeUrl({
    clientId: 'oaiapp_test', hostId: 'urn:uuid:x', redirectUri: 'http://127.0.0.1:1/auth/callback',
    state: 's', nonce: 'n', codeChallenge: 'c', agentNameHint: 'ignored',
  }))
  assert.equal(reauth.searchParams.get('agent_name_hint'), null, 'no name hint on reauth')
  const cb = parseCallbackParams({ code: 'c', state: 's', client_id: 'oaiapp_test', scope: 'openid' })
  assert.deepEqual(cb, { error: null, code: 'c', state: 's', clientId: 'oaiapp_test', scope: 'openid' })
  assert.equal(maskEmail('alice@example.com'), 'al•••@example.com')
  assert.equal(maskEmail('a@example.com'), 'a•••@example.com')
  console.log('authorize/model/callback helpers: PASS')
}

// ---------- 真实 loopback 流程 ----------
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = publicKey.export({ format: 'jwk' })
const kid = 'test-key-1'
const rsaJwk = { ...jwk, kid, alg: 'RS256', use: 'sig' }

function base64url(value) {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url')
}

function makeIdToken(claims) {
  const header = base64url({ alg: 'RS256', typ: 'JWT', kid })
  const payload = base64url(claims)
  const signature = sign('RSA-SHA256', Buffer.from(header + '.' + payload), privateKey).toString('base64url')
  return header + '.' + payload + '.' + signature
}

const temporary = mkdtempSync(join(tmpdir(), 'dsh-siwc-'))
const originalFetch = globalThis.fetch
const envNames = ['DSH_CHATGPT_DATA_DIR', 'DSH_CHATGPT_SELF_UPDATE', 'DSH_CHATGPT_BIND_FILE', 'DSH_CHATGPT_OAUTH_TIMEOUT_MS']
const oldEnvironment = Object.fromEntries(envNames.map(function (name) { return [name, process.env[name]] }))

process.env.DSH_CHATGPT_DATA_DIR = temporary
process.env.DSH_CHATGPT_SELF_UPDATE = 'off'
process.env.DSH_CHATGPT_BIND_FILE = join(temporary, 'bind.json')
process.env.DSH_CHATGPT_OAUTH_TIMEOUT_MS = '5000'

const records = new Map()
const values = new Map()
const sections = { 'llm-pi-ai': { providers: {} } }
let selection = { provider: 'deepseek-official', model: 'synthetic' }
let nonceSeen = null
let tokenCalls = 0

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

globalThis.fetch = async function (url, options) {
  const target = String(url)
  if (target === 'https://auth.openai.com/api/accounts/oauth/token') {
    tokenCalls++
    const form = new URLSearchParams(options.body)
    assert.equal(form.get('grant_type'), 'authorization_code')
    assert.equal(form.get('client_id'), 'oaiapp_test')
    assert.equal(form.get('code'), 'synthetic-code')
    assert.equal(form.get('resource'), 'https://api.openai.com/v1')
    assert.ok(form.get('code_verifier'))
    nonceSeen = form.get('code_verifier')
    const idToken = makeIdToken({
      iss: 'https://auth.openai.com', aud: 'oaiapp_test', sub: 'user-1',
      email: 'alice@example.com', nonce: pendingNonce, exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    })
    return new Response(JSON.stringify({
      access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', id_token: idToken,
      token_type: 'Bearer', expires_in: 3600,
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target === 'https://auth.openai.com/.well-known/jwks.json') {
    return new Response(JSON.stringify({ keys: [rsaJwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target === 'https://api.openai.com/v1/models') {
    return new Response(JSON.stringify({ models: [
      { slug: 'gpt-6.1-sol', display_name: 'GPT-6.1 Sol', visibility: 'list' },
      { slug: 'gpt-5.6-sol', display_name: 'GPT-5.6 Sol', visibility: 'list' },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  throw new Error('unexpected fetch: ' + target)
}

let pendingNonce = null
let route = null
const plugin = (await import('../lib/index.js?siwcflow=1')).default
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
  interval() {},
  effect(fn) { return fn() },
  inject(_names, fn) {
    fn({
      connection: { requestRejection() {} },
      effect: function (inner) { return inner() },
      webServer: { register(value) { route = value } },
    })
  },
})

const rpcServer = createServer(route.handler)
await new Promise(function (resolve) { rpcServer.listen(0, '127.0.0.1', resolve) })
const base = 'http://127.0.0.1:' + rpcServer.address().port + route.path + '/'

try {
  const started = await (await originalFetch(base + 'startCodexOAuth', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"language":"en"}',
  })).json()
  assert.equal(started.ok, true)
  const authorize = new URL(started.authorizeUrl)
  assert.equal(authorize.searchParams.get('client_id'), 'dynamic_agent_client')
  pendingNonce = authorize.searchParams.get('nonce')

  const callback = new URL(authorize.searchParams.get('redirect_uri'))
  callback.searchParams.set('state', authorize.searchParams.get('state'))
  callback.searchParams.set('code', 'synthetic-code')
  callback.searchParams.set('client_id', 'oaiapp_test')
  const page = await originalFetch(callback, { signal: AbortSignal.timeout(4000) })
  assert.equal(page.status, 200)

  let status = null
  for (let attempt = 0; attempt < 50; attempt++) {
    status = await (await originalFetch(base + 'getCodexBridgeStatus')).json()
    if (!status.oauthInFlight) break
    await new Promise(function (resolve) { setTimeout(resolve, 50) })
  }
  assert.equal(status.oauthInFlight, false)
  assert.equal(status.bound, true, 'binding persisted: ' + JSON.stringify(status))
  assert.equal(status.ok, true)
  assert.equal(status.account.email, 'al•••@example.com')
  assert.equal(selection.provider, 'chatgpt-siwc')
  assert.equal(selection.model, 'gpt-6.1-sol')
  assert.equal(values.get('CHATGPT_SIWC_TOKEN'), 'synthetic-access')
  const routeConfig = sections['llm-pi-ai'].providers['chatgpt-siwc']
  assert.ok(routeConfig, 'route written')
  assert.equal(routeConfig.api, 'openai-responses')
  assert.equal(routeConfig.apiKeyEnv, 'CHATGPT_SIWC_TOKEN')
  assert.ok(routeConfig.baseURL.startsWith('http://127.0.0.1:'))
  assert.deepEqual(routeConfig.models.map(function (m) { return m.id }), ['gpt-6.1-sol', 'gpt-5.6-sol'])
  assert.ok(records.get('chatgpt-sub/session'), 'session record written')
  assert.equal(tokenCalls, 1)
  assert.ok(nonceSeen)
  assert.ok(existsSync(process.env.DSH_CHATGPT_BIND_FILE))
  console.log('SIWC OAuth loopback + route + session: PASS')

  const unbound = await (await originalFetch(base + 'unbindCodex', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()
  assert.equal(unbound.ok, true)
  assert.equal(sections['llm-pi-ai'].providers['chatgpt-siwc'], undefined)
  assert.equal(records.get('chatgpt-sub/session'), undefined)
  assert.equal(values.get('CHATGPT_SIWC_TOKEN'), undefined)
  console.log('unbind cleanup: PASS')
} finally {
  rpcServer.closeAllConnections()
  await new Promise(function (resolve) { rpcServer.close(resolve) })
  globalThis.fetch = originalFetch
  for (const name of envNames) {
    if (oldEnvironment[name] === undefined) delete process.env[name]
    else process.env[name] = oldEnvironment[name]
  }
  rmSync(temporary, { recursive: true, force: true })
}

process.exit(0)
