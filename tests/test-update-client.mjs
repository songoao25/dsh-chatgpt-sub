// Execute the real update component with deterministic hooks and RPC/timer stubs.
// This checks callbacks and state transitions; it does not claim browser rendering.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/client-bundle.js', import.meta.url), 'utf8')
const start = source.indexOf('    function SubscriptionUpdates() {')
const end = source.indexOf('    // ---------- 插件配置页组件 ----------', start)
assert.ok(start >= 0 && end > start, 'update component must be extractable')
const componentSource = source.slice(start, end)
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
}
const initial = {
  runningVersion: '0.4.0', diskVersion: '0.4.0', latest: '0.4.0',
  autoUpdate: true, available: false, pendingRestart: false,
}

function harness(options = {}) {
  const hooks = [], pendingEffects = [], cleanups = [], timers = new Map(), calls = [], prompts = []
  let cursor = 0, tree, mutations = 0, intervalId = 0
  const handlers = { getUpdateState: () => ({ ...initial }), enterUpdatePage: () => ({}), ...options.handlers }
  const React = {
    useState(value) {
      const index = cursor++
      if (!hooks[index]) hooks[index] = { value }
      return [hooks[index].value, next => {
        hooks[index].value = typeof next === 'function' ? next(hooks[index].value) : next
        mutations++
      }]
    },
    useRef(value) {
      const index = cursor++
      if (!hooks[index]) hooks[index] = { current: value }
      return hooks[index]
    },
    useEffect(effect) {
      const index = cursor++
      if (!hooks[index]) { hooks[index] = true; pendingEffects.push(effect) }
    },
  }
  const h = (tag, props, ...children) => ({ tag, props: props || {}, children })
  const hList = (tag, props, children) => h(tag, props, ...children)
  const rpc = (method, args) => {
    calls.push({ method, args })
    try {
      assert.ok(handlers[method], `unexpected RPC: ${method}`)
      return Promise.resolve(handlers[method](args))
    } catch (error) { return Promise.reject(error) }
  }
  const confirm = message => { prompts.push(message); return options.confirm === true }
  const t = (key, values) => values ? `${key} ${JSON.stringify(values)}` : key
  const setInterval = (callback, ms) => { const id = ++intervalId; timers.set(id, { callback, ms }); return id }
  const clearInterval = id => { assert.ok(timers.delete(id), 'cleanup must remove its interval') }
  const Component = new Function('React', 'h', 'hList', 'cgptButton', 'rpc', 'confirm', 't', 'setInterval', 'clearInterval',
    `${componentSource}\nreturn SubscriptionUpdates;`)(React, h, hList, props => h('button', props, props.children), rpc, confirm, t, setInterval, clearInterval)
  function render() {
    cursor = 0
    tree = Component()
    while (pendingEffects.length) cleanups.push(pendingEffects.shift()())
    return tree
  }
  function nodes(node = tree) {
    if (node == null) return []
    if (Array.isArray(node)) return node.flatMap(nodes)
    if (typeof node !== 'object') return [node]
    return [node, ...node.children.flatMap(nodes)]
  }
  function button(key) {
    const result = nodes().find(node => node.tag === 'button' && node.props.key === key)
    assert.ok(result, `missing button ${key}`)
    return result.props
  }
  return {
    calls, prompts, timers, handlers, render, button,
    text: () => nodes().filter(node => typeof node === 'string').join('\n'),
    mutations: () => mutations,
    count: method => calls.filter(call => call.method === method).length,
    poll: () => { for (const timer of timers.values()) timer.callback() },
    unmount: () => { for (const cleanup of cleanups.splice(0)) cleanup() },
  }
}

async function mounted(options) {
  const app = harness(options)
  app.render()
  await settle()
  app.render()
  assert.equal(app.count('enterUpdatePage'), 1, 'mount records page entry only once')
  assert.equal(app.timers.size, 1, 'mount starts exactly one polling interval')
  assert.equal([...app.timers.values()][0].ms, 15000)
  return app
}

let passed = 0
async function check(name, test) {
  await test()
  passed++
  console.log(`PASS ${name}`)
}
const available = { ...initial, latest: '0.5.0', available: true }

await check('canceling the check confirmation never installs', async () => {
  const app = await mounted({ handlers: { checkUpdate: () => available }, confirm: false })
  app.button('check').onClick()
  await settle(); app.render()
  assert.equal(app.count('checkUpdate'), 1)
  assert.equal(app.prompts.length, 1)
  assert.match(app.prompts[0], /0\.5\.0/)
  assert.equal(app.count('installUpdate'), 0)
  assert.ok(app.button('install'), 'available update remains reviewable after cancel')
  app.unmount()
})

await check('explicit confirmation installs once and shows restart state returned by host', async () => {
  const installed = { ...available, diskVersion: '0.5.0', pendingRestart: true, restartDirection: 'update' }
  const app = await mounted({ handlers: { checkUpdate: () => available, installUpdate: () => installed }, confirm: true })
  app.button('check').onClick()
  await settle(); app.render()
  assert.equal(app.prompts.length, 1)
  assert.equal(app.count('installUpdate'), 1)
  assert.match(app.text(), /ui.updatePendingRestart/)
  assert.match(app.text(), /0\.5\.0/)
  app.unmount()
})

await check('late check result after leaving the page cannot prompt, install, or update state', async () => {
  const pending = deferred()
  const app = await mounted({ handlers: { checkUpdate: () => pending.promise }, confirm: true })
  app.button('check').onClick()
  app.unmount()
  const before = app.mutations()
  assert.equal(app.timers.size, 0, 'unmount clears polling')
  pending.resolve(available)
  await settle()
  assert.equal(app.prompts.length, 0)
  assert.equal(app.count('installUpdate'), 0)
  assert.equal(app.mutations(), before, 'unmounted component must not set state')
})

await check('mode selection displays host response rather than an optimistic choice', async () => {
  const app = await mounted({ handlers: { setUpdateAuto: () => ({ ...initial, autoUpdate: true }) } })
  app.button('manual').onClick()
  await settle(); app.render()
  assert.deepEqual(app.calls.find(call => call.method === 'setUpdateAuto').args, { enabled: false })
  assert.equal(app.button('manual').checked, false, 'host still reports automatic mode')
  assert.equal(app.button('auto').checked, true)
  app.handlers.setUpdateAuto = () => ({ ...initial, autoUpdate: false })
  app.button('manual').onClick()
  await settle(); app.render()
  assert.equal(app.button('manual').checked, true, 'confirmed host manual mode is shown')
  assert.match(app.text(), /ui.updateModeManualDesc/)
  app.unmount()
})

await check('busy action rejects duplicate clicks and skips concurrent polling', async () => {
  const pending = deferred()
  const app = await mounted({ handlers: { checkUpdate: () => pending.promise } })
  const click = app.button('check').onClick
  click(); click()
  app.render()
  assert.equal(app.button('check').disabled, true)
  assert.equal(app.button('manual').disabled, true)
  const reads = app.count('getUpdateState')
  app.poll()
  assert.equal(app.count('checkUpdate'), 1)
  assert.equal(app.count('getUpdateState'), reads, 'polling must not race a busy action')
  pending.resolve(initial)
  await settle(); app.render()
  assert.equal(app.button('check').disabled, false)
  app.poll(); await settle()
  assert.equal(app.count('getUpdateState'), reads + 1, 'polling resumes after the action')
  app.unmount()
})

await check('old-host polling failure retains last known mode and version', async () => {
  const app = await mounted({ handlers: { getUpdateState: () => ({ ...initial, autoUpdate: false }) } })
  app.handlers.getUpdateState = () => Promise.reject(new Error('old host RPC unavailable'))
  app.poll(); await settle(); app.render()
  assert.match(app.text(), /ui.updateHostOutdated/)
  assert.match(app.text(), /0\.4\.0/)
  assert.equal(app.button('manual').checked, true, 'last host state survives failed polling')
  app.unmount()
  assert.equal(app.timers.size, 0)
})

await check('old host failing initial state lookup shows version-unavailable guidance', async () => {
  const app = await mounted({ handlers: { getUpdateState: () => Promise.reject(new Error('unknown RPC')) } })
  assert.match(app.text(), /ui.versionUnavailable/)
  assert.match(app.text(), /ui.updateHostOutdated/)
  assert.equal(app.prompts.length, 0)
  assert.equal(app.count('installUpdate'), 0)
  app.unmount()
})

await check('late polling result cannot overwrite a newer mode action', async () => {
  const pending = deferred()
  const app = await mounted({ handlers: { setUpdateAuto: () => ({ ...initial, autoUpdate: false }) } })
  app.handlers.getUpdateState = () => pending.promise
  app.poll()
  app.button('manual').onClick()
  await settle(); app.render()
  assert.equal(app.button('manual').checked, true)
  pending.resolve({ ...initial, autoUpdate: true, latest: '0.3.0' })
  await settle(); app.render()
  assert.equal(app.button('manual').checked, true, 'old poll must not undo the confirmed mode')
  assert.doesNotMatch(app.text(), /0\.3\.0/, 'old version data must not replace action response')
  app.unmount()
})

await check('late polling failure cannot replace a successful action with an old-host alert', async () => {
  const pending = deferred()
  const app = await mounted({ handlers: { setUpdateAuto: () => ({ ...initial, autoUpdate: false }) } })
  app.handlers.getUpdateState = () => pending.promise
  app.poll()
  app.button('manual').onClick()
  await settle(); app.render()
  pending.reject(new Error('obsolete polling failure'))
  await settle(); app.render()
  assert.equal(app.button('manual').checked, true)
  assert.doesNotMatch(app.text(), /ui.updateHostOutdated/)
  app.unmount()
})

await check('unknown latest version never claims the plugin is up to date', async () => {
  const app = await mounted({ handlers: { getUpdateState: () => ({ ...initial, latest: null }) } })
  assert.match(app.text(), /ui.updateErrorCheckFailed/)
  assert.match(app.text(), /ui.versionUnknown/)
  assert.doesNotMatch(app.text(), /ui.updateUpToDate/)
  app.unmount()
})

console.log(`${passed} update component behavior checks passed`)
