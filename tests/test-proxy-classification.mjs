// dsh-chatgpt-sub — 本地 Responses 代理的上游失败分类
//
// 背景：代理以前对上游失败只回一句「Could not reach ChatGPT」，调用方无从判断
// 是 DNS 不通、代理端口没起还是握手被掐断。这里锁住三件事：
//   1) 上游异常 → reason → 502 响应体（调用方拿得到 reason）；
//   2) 响应体里不含原始错误文本（不把内部细节泄给请求方）；
//   3) 令牌不对时代理不放行（不能变成任意本地转发器）。
//
// 用例必须可复现：上游失败用受控的 fetch 替身注入，而不是指望某台机器
// 的 DNS 或代理恰好处于某种状态。
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { startResponsesProxy } from '../src/proxy.js'

// 本机地址一律直连：环境里的代理变量不能影响 127.0.0.1 的往返。
process.env.NO_PROXY = '127.0.0.1,localhost'
process.env.no_proxy = '127.0.0.1,localhost'

const originalFetch = globalThis.fetch

// 让上游请求抛出指定错误，其他请求照常走真实 fetch。
async function withUpstreamError(error, run) {
  globalThis.fetch = async function (input, init) {
    const target = typeof input === 'string' ? input : (input && input.url ? input.url : String(input))
    let hostname = ''
    try { hostname = new URL(target).hostname } catch (err) { hostname = '' }
    if (hostname === 'upstream.test') throw error
    return originalFetch(input, init)
  }
  try {
    await run()
  } finally {
    globalThis.fetch = originalFetch
  }
}

async function callProxy(proxy, pathname, token) {
  // proxy.baseUrl 已经带 /v1 前缀，这里再拼 /v1 会变成 /v1/v1。
  const res = await originalFetch(proxy.baseUrl + pathname, {
    method: pathname === '/responses' ? 'POST' : 'GET',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: pathname === '/responses' ? JSON.stringify({ model: 'gpt-test', input: 'hi' }) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

async function startProxy(options) {
  return startResponsesProxy({
    getAccessToken: function () { return 'test-token' },
    upstreamOrigin: 'http://upstream.test',
    log: function () {},
    ...options,
  })
}

// ---------- 1. 上游拒绝连接：reason = refused ----------
await withUpstreamError(
  Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:7890'), { code: 'ECONNREFUSED' }),
  }),
  async function () {
    const proxy = await startProxy()
    try {
      const res = await callProxy(proxy, '/models', 'test-token')
      assert.equal(res.status, 502)
      assert.equal(res.body.error.type, 'upstream_error')
      assert.equal(res.body.error.reason, 'refused')
      assert.ok(res.body.error.message.length > 0, 'the upstream message must not be empty')
      assert.ok(!res.body.error.message.includes('ECONNREFUSED'), 'the raw error text must not leak into the response')
    } finally {
      proxy.close()
    }
  },
)

// ---------- 2. 上游域名解析失败：reason = dns ----------
await withUpstreamError(
  Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.openai.com'), { code: 'ENOTFOUND' }),
  }),
  async function () {
    const proxy = await startProxy()
    try {
      const res = await callProxy(proxy, '/models', 'test-token')
      assert.equal(res.status, 502)
      assert.equal(res.body.error.reason, 'dns')
      assert.ok(!res.body.error.message.includes('ENOTFOUND'), 'the raw error text must not leak into the response')
    } finally {
      proxy.close()
    }
  },
)

// ---------- 3. 上游在加密握手完成前断开：reason = proxy-reset ----------
await withUpstreamError(
  Object.assign(new TypeError('fetch failed'), {
    cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }),
  }),
  async function () {
    const proxy = await startProxy()
    try {
      const res = await callProxy(proxy, '/models', 'test-token')
      assert.equal(res.status, 502)
      assert.equal(res.body.error.reason, 'proxy-reset')
    } finally {
      proxy.close()
    }
  },
)

// ---------- 4. 上游超时：reason = timeout ----------
await withUpstreamError(
  Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }),
  async function () {
    const proxy = await startProxy()
    try {
      const res = await callProxy(proxy, '/models', 'test-token')
      assert.equal(res.status, 502)
      assert.equal(res.body.error.reason, 'timeout')
    } finally {
      proxy.close()
    }
  },
)

// ---------- 5. 上游正常响应：代理原样转发状态码与正文 ----------
await withUpstreamError(null, async function () {
  globalThis.fetch = async function () {
    return new Response(JSON.stringify({ object: 'list', data: [{ id: 'gpt-test' }] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  }
  const proxy = await startProxy()
  try {
    const res = await callProxy(proxy, '/models', 'test-token')
    assert.equal(res.status, 200)
    assert.equal(res.body.data[0].id, 'gpt-test')
  } finally {
    proxy.close()
  }
})

// ---------- 6. 令牌不对：代理不放行（不能变成任意本地转发器）----------
await withUpstreamError(null, async function () {
  globalThis.fetch = async function () {
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const proxy = await startProxy()
  try {
    const res = await callProxy(proxy, '/models', 'wrong-token')
    assert.equal(res.status, 401)
  } finally {
    proxy.close()
  }
})

// ---------- 7. 请求体超限：必须回 413，而不是把连接一断了事 ----------
// 以前这里先 req.destroy() 再想写 413，socket 已经没了，调用方只看到 ECONNRESET，
// DSH 会把它当成一次网络故障，用户拿到的提示完全指错方向。
await withUpstreamError(null, async function () {
  globalThis.fetch = async function () {
    throw new Error('upstream should not be reached for an oversized body')
  }
  const proxy = await startProxy()
  try {
    const oversized = JSON.stringify({ model: 'gpt-test', input: 'a'.repeat(49 * 1024 * 1024) })
    const res = await originalFetch(proxy.baseUrl + '/responses', {
      method: 'POST',
      headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
      body: oversized,
    })
    assert.equal(res.status, 413)
    const body = await res.json()
    assert.equal(body.error.type, 'invalid_request_error')
    assert.equal(body.error.message, 'Request body is too large')
  } finally {
    proxy.close()
  }
})

console.log('proxy upstream failure classification: PASS')
