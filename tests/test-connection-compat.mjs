// 回归：DSH 0.2.3 的 Connection 重构移除了 connection.requestRejection，
// 插件路由 handler 无守卫直调 → TypeError → 全部路由被 catch 转成 500 internal error，
// 设置页整体打不开（与 dsh-bottom-info-bar Issue #313 同根因，本仓此前漏修）。
// 本测试钉死三件事：
//   1) 宿主没有 requestRejection 时（新宿主形态），读/写路由都必须正常 200，绝不 500；
//   2) 宿主仍提供 requestRejection 且返回 401 时（旧宿主），准入行为保持不变；
//   3) 宿主仍提供 requestRejection 且放行时，路由正常 200。
// 数据目录铁律：import 被测模块前先把 env 指向临时目录，绝不触碰真实用户数据。
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const temporary = mkdtempSync(join(tmpdir(), 'chatgpt-sub-conn-compat-'))
const originalFetch = globalThis.fetch
process.env.DSH_HOME = temporary
process.env.DSH_CHATGPT_DATA_DIR = join(temporary, 'data')
process.env.DSH_CHATGPT_AUTH = join(temporary, 'synthetic-auth.json')
writeFileSync(process.env.DSH_CHATGPT_AUTH, '{"fixture":"preserve"}')
process.env.DSH_CHATGPT_SELF_UPDATE = 'off'
// 本测试无真实网络：任何出站都直接失败，路由层不应因此 500。
globalThis.fetch = async () => { throw new Error('network disabled in connection-compat test') }

async function boot(tag, connection) {
  const plugin = (await import('../lib/index.js?conncompat=' + tag)).default
  let route
  plugin.apply({
    effect(fn) { return fn() },
    get: () => undefined,
    credentials: {},
    settings: {},
    interval() {},
    inject(_names, fn) {
      fn({
        effect(fn2) { const dispose = fn2(); return () => dispose && dispose() },
        connection,
        webServer: { register(value) { route = value; return () => {} } },
      })
    },
  })
  assert.ok(route, 'route registered')
  const server = createServer(route.handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = 'http://127.0.0.1:' + server.address().port + route.path + '/'
  const request = async (method, body) => {
    const response = await originalFetch(base + method, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, data: await response.json() }
  }
  return { server, request }
}

try {
  // ---------- 场景 1：DSH 0.2.3 新宿主——connection 没有 requestRejection ----------
  {
    const { server, request } = await boot('new-host', {})
    const read = await request('getUpdateState')
    assert.equal(read.status, 200, 'new host without requestRejection: read route must be 200, got ' + read.status + ' ' + JSON.stringify(read.data))
    const write = await request('setUpdateAuto', { enabled: false })
    assert.equal(write.status, 200, 'new host without requestRejection: mutating route must be 200, got ' + write.status)
    server.close()
  }
  // ---------- 场景 2：旧宿主——requestRejection 返回 401 ----------
  {
    const { server, request } = await boot('old-host-reject', { requestRejection: () => 401 })
    const read = await request('getUpdateState')
    assert.equal(read.status, 401, 'old host rejection must still apply, got ' + read.status)
    assert.equal(read.data.error, 'authentication required')
    server.close()
  }
  // ---------- 场景 3：旧宿主——requestRejection 放行 ----------
  {
    const { server, request } = await boot('old-host-admit', { requestRejection: () => undefined })
    const read = await request('getUpdateState')
    assert.equal(read.status, 200, 'old host admission must still work, got ' + read.status)
    server.close()
  }
  console.log('connection requestRejection compat: PASS')
} finally {
  globalThis.fetch = originalFetch
  rmSync(temporary, { recursive: true, force: true })
}
// 插件 boot 后有常驻句柄（与 test-siwc-flow 同款收尾）：断言全过才走到这里，显式退出。
process.exit(0)
