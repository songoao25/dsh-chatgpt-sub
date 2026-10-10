// dsh-chatgpt-sub — 文案双语契约 + 配置页渲染回归
// 覆盖：
//   1) locale/{en,zh}.json（插件列表卡片的 meta）与 package.json 接线
//   2) client half 的 zh/en 字典：键完全对称、中英都齐全、无 AI 腔
//   3) 宿主每个错误 code 都有中英两条文案
//   4) 在「按 inject 授权服务访问」的 ctx 上真实跑 client half（cordis 语义）——
//      曾经的线上事故：inject 少写 locale 就访问 ctx.locale，cordis 直接抛
//      cannot get property "locale" without inject，整个配置页因此消失
//   5) zh / en 两种语言下渲染摘要页、加载态、已连接态、错误态，英文页不得出现中文
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const { LOCALES } = await import('../src/locales.js')
const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const readJson = (relative) => JSON.parse(readFileSync(join(root, relative), 'utf8'))
const source = readFileSync(join(root, 'src', 'client-bundle.js'), 'utf8')
const hostSource = readFileSync(join(root, 'src', 'host.js'), 'utf8')
const artifact = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

// ---------- 1. locale 文件：DSH 内置语言只有 zh / en，两侧必须一一对应 ----------
assert.deepEqual(readdirSync(join(root, 'locale')).sort(), Object.keys(LOCALES).map(language => language + '.json').sort(),
  'locale/ must carry exactly the two DSH built-in languages (zh, en)')
const en = readJson('locale/en.json')
const zh = readJson('locale/zh.json')
assert.deepEqual(Object.keys(en.meta).sort(), Object.keys(zh.meta).sort(), 'en/zh meta must declare the same fields')
assert.deepEqual(Object.keys(en.meta).sort(), ['description', 'title'], 'plugin metadata carries a title and a description')
for (const [lang, meta] of [['en', en.meta], ['zh', zh.meta]]) {
  for (const field of ['title', 'description']) {
    assert.equal(typeof meta[field], 'string', lang + '.' + field + ' must be a string')
    assert.ok(meta[field].trim() !== '', lang + '.' + field + ' must not be blank')
  }
}
assert.notEqual(en.meta.title, zh.meta.title, 'the two languages must not ship the same title')
assert.notEqual(en.meta.description, zh.meta.description, 'the two languages must not ship the same description')

// ---------- 2. package.json 接线：exports 不放行，readPluginMeta 就解析不到 locale 文件 ----------
assert.equal(pkg.exports['./locale/*.json'], './locale/*.json',
  'exports must expose ./locale/*.json (readPluginMeta resolves the dictionary through the exports map)')
assert.ok(pkg.files.includes('locale/*.json'), 'the published tarball must include locale/*.json')
assert.equal(pkg.description, en.meta.description,
  'package.json description is the English fallback and must equal locale/en.json meta.description')

// ---------- 3. client half 的字典 ----------
const zhKeys = Object.keys(LOCALES.zh)
const enKeys = Object.keys(LOCALES.en)
assert.deepEqual(enKeys.filter((key) => !zhKeys.includes(key)), [], 'every English key needs a Chinese one')
assert.deepEqual(zhKeys.filter((key) => !enKeys.includes(key)), [], 'every Chinese key needs an English one')
for (const key of zhKeys) {
  assert.ok(LOCALES.zh[key].trim() !== '' && LOCALES.en[key].trim() !== '', key + ' must be non-empty in both languages')
  assert.notEqual(LOCALES.zh[key], LOCALES.en[key], key + ' must actually be translated')
}
for (const key of ['meta.title', 'meta.description']) {
  assert.ok(zhKeys.includes(key), 'the dictionary carries ' + key + ' for the detail page description')
}
assert.equal(LOCALES.en['meta.title'], en.meta.title, 'the English title must match locale/en.json')
assert.equal(LOCALES.zh['meta.title'], zh.meta.title, 'the Chinese title must match locale/zh.json')
assert.equal(LOCALES.en['meta.description'], en.meta.description, 'the English description must match locale/en.json')
assert.equal(LOCALES.zh['meta.description'], zh.meta.description, 'the Chinese description must match locale/zh.json')

// ---------- 4. 宿主错误 code 必须在字典里有中英两条 ----------
const hostCodes = new Set()
for (const match of hostSource.matchAll(/code:\s*([^,\n]+)/g)) {
  // 宿主里 code 还有别的含义（OAuth 回调的授权码），只认 <组>.<名> 形态的错误码
  for (const literal of match[1].matchAll(/'([a-z][a-z0-9-]*\.[a-z0-9-]+)'/g)) hostCodes.add(literal[1])
}
assert.ok(hostCodes.size >= 30, 'the host must tag its user-visible errors with stable codes')
for (const code of hostCodes) {
  assert.ok(zhKeys.includes('error.' + code), 'missing Chinese copy for host error code ' + code)
  assert.ok(enKeys.includes('error.' + code), 'missing English copy for host error code ' + code)
}

// ---------- 5. 文案去 AI 味 ----------
const AI_SMELL_ZH = /一键|轻松|极致|丝滑|强大|完美|立即|马上|告别/
const AI_SMELL_EN = /seamless|effortless|powerful|unleash|revolutionary|game.?chang|supercharge/i
const AI_SMELL_SHARED = /[—–]|[!！]|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u
for (const lang of ['zh', 'en']) {
  for (const key of Object.keys(LOCALES[lang])) {
    const copy = LOCALES[lang][key]
    assert.doesNotMatch(copy, AI_SMELL_SHARED, lang + ' ' + key + ' must not use dashes dressed as prose, exclamation or emoji')
    assert.doesNotMatch(copy, lang === 'zh' ? AI_SMELL_ZH : AI_SMELL_EN, lang + ' ' + key + ' must stay free of marketing filler')
  }
}
assert.ok(en.meta.description.length <= 90, 'English description must stay one short line')
assert.ok(zh.meta.description.length <= 40, '中文描述保持一行')

// ---------- 6. 在 cordis 语义的 ctx 上真实跑 client half ----------
assert.match(source, /inject:\s*\['slots',\s*'locale'\]/, 'the client half must declare the services it reads')

const documentStub = {
  querySelector: () => null,
  createElement: () => ({ dataset: {}, textContent: '' }),
  head: { appendChild: () => {} },
}
const sandbox = {
  window: { navigator: { languages: ['zh-CN'] }, setTimeout, clearTimeout },
  document: documentStub,
  console,
}
sandbox.window.__ModuleLoader__ = { load: (mod) => { sandbox.loaded = mod } }
vm.createContext(sandbox)
vm.runInContext(artifact, sandbox)
assert.equal(sandbox.loaded.id, 'dsh-chatgpt-sub', 'client module id must stay the bundle name')

const statusBox = { value: null, index: 0 }
const React = {
  createElement: function (tag, props) {
    return { tag, props: props || {}, children: Array.prototype.slice.call(arguments, 2) }
  },
  useState: function (initial) {
    const index = statusBox.index++
    return [index === 0 ? statusBox.value : (typeof initial === 'function' ? initial() : initial), () => {}]
  },
  useCallback: (fn) => fn,
  useEffect: () => {},
  useRef: (value) => ({ current: value }),
}
const requireStub = (name) => {
  if (name === 'react') return React
  throw new Error('unexpected module request: ' + name)
}

// 假 locale 服务：与 DSH 的 locale 服务同形（register 一次收全部语言，bind 读当前语言）
function createLocaleService() {
  const namespaces = new Map()
  let active = 'zh'
  return {
    setActive: (id) => { active = id },
    getSnapshot: () => ({ active }),
    register: (ns, dicts) => { namespaces.set(ns, dicts); return () => namespaces.delete(ns) },
    bind: (ns) => (key) => {
      const dicts = namespaces.get(ns)
      return dicts && dicts[active] && dicts[active][key] ? dicts[active][key] : key
    },
  }
}

/**
 * 按 cordis 的 inject 语义构造 ctx：未在 inject 里声明的服务属性一律抛错
 * （实测 cordis 报 cannot get property "x" without inject），ctx.get / ctx.effect 永远可用。
 */
function cordisLikeContext(declared, services) {
  const allowed = new Set([...declared, 'get', 'effect', 'on', 'once', 'provide'])
  return new Proxy({}, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined
      if (!allowed.has(prop)) {
        if (services[prop] !== undefined) throw new Error('cannot get property "' + prop + '" without inject')
        return undefined
      }
      if (prop === 'get') return (name) => services[name]
      if (prop === 'effect') return (fn) => (typeof fn === 'function' ? fn() : undefined)
      return services[prop]
    },
  })
}

function textsOf(node, sink) {
  const out = sink || []
  if (typeof node === 'string') out.push(node)
  else if (typeof node === 'function') textsOf(node(node.props), out)
  else if (Array.isArray(node)) for (const child of node) textsOf(child, out)
  else if (node && node.tag === 'option' && node.props.value !== 'auto') return out // native-language option labels are intentional
  else if (node && typeof node.tag === 'function') textsOf(node.tag(node.props), out)
  else if (node && node.children) for (const child of node.children) textsOf(child, out)
  return out
}

async function boot(options) {
  const registry = {}
  const localeService = options.locale === false ? null : createLocaleService()
  if (localeService) localeService.setActive(options.locale)
  const services = {
    slots: {
      inject: (name, callback) => { callback(); return () => {} },
      register: (entry, component) => { registry.entry = entry; registry.component = component; return () => {} },
    },
  }
  if (localeService) services.locale = localeService
  const plugin = sandbox.loaded.factory(requireStub)
  await plugin.apply(cordisLikeContext(plugin.inject, services))
  assert.equal(typeof registry.component, 'function', 'configuration entry must register through the slot')
  return {
    label: registry.entry.label(),
    summary: textsOf(registry.component({ view: 'summary' })).join(''),
    render: (status) => {
      statusBox.value = status
      statusBox.index = 0
      const text = textsOf(registry.component({ view: 'page' })).join(' ')
      statusBox.value = null
      statusBox.index = 0
      return text
    },
  }
}

for (const lang of ['zh', 'en']) {
  const app = await boot({ locale: lang })
  assert.equal(app.summary, LOCALES[lang]['meta.description'], lang + ': the detail page must show the ' + lang + ' description')
  assert.equal(app.label, LOCALES[lang]['meta.title'], lang + ': the page title must follow the active language')
  const loading = app.render(null)
  assert.ok(loading.includes(LOCALES[lang]['ui.loading']), lang + ': the loading line must be translated')
  assert.ok(!loading.includes(LOCALES[lang]['meta.title']), lang + ': the page must not restate the title the host already renders')
  const connected = app.render({ bound: true, expiresAt: 4102444800000, account: { email: 'a@b.c', plan: 'plus' } })
  assert.ok(connected.includes(LOCALES[lang]['ui.status']), lang + ': the status row must be translated')
  assert.ok(connected.includes(LOCALES[lang]['ui.unbind']), lang + ': the unbind control must be translated')
  assert.ok(connected.includes('plus'), lang + ': the plan suffix must wrap the plan name')
  const failed = app.render({ bound: true, error: { kind: 'auth', code: 'token.expiring', message: 'HOST FALLBACK' } })
  assert.ok(failed.includes(LOCALES[lang]['error.token.expiring']), lang + ': a coded host error must be translated')
  assert.ok(!failed.includes('HOST FALLBACK'), lang + ': the translated copy replaces the host fallback')
  const unknown = app.render({ bound: true, error: { kind: 'auth', message: 'HOST FALLBACK' } })
  assert.ok(unknown.includes('HOST FALLBACK'), lang + ': a codeless host error keeps its original text')
}

// 英文页面里不允许再出现中文（操作文案也不许漏译）
const english = await boot({ locale: 'en' })
for (const status of [null, { bound: false }, { bound: true, expiresAt: 4102444800000, account: { email: 'a@b.c', plan: 'plus' } }, { bound: true, error: { code: 'oauth.timeout' } }]) {
  const text = english.render(status)
  assert.doesNotMatch(text, /[\u4e00-\u9fa5]/, 'the English page must not fall back to Chinese: ' + text)
}
const chinese = await boot({ locale: 'zh' })
const zhText = chinese.render({ bound: true, expiresAt: 4102444800000, account: { email: 'a@b.c', plan: 'plus' } })
assert.doesNotMatch(zhText.replace(/ChatGPT|OpenAI|DSH|plus|a@b\.c/g, ''), /[A-Za-z]{4,}/, 'the Chinese page must not fall back to English')

// locale 服务缺席时按浏览器语言兜底，最后退英文
sandbox.window.navigator = { languages: ['zh-CN'] }
const noServiceZh = await boot({ locale: false })
assert.equal(noServiceZh.summary, LOCALES.zh['meta.description'], 'zh-CN must fall back to the Chinese copy')
sandbox.window.navigator = { languages: ['en-US', 'en'] }
const noServiceEn = await boot({ locale: false })
assert.equal(noServiceEn.summary, LOCALES.en['meta.description'], 'without the locale service the browser language decides')

// 产物必须已重建（lib 已入库，CI 检查 git diff）
assert.ok(artifact.includes(LOCALES.en['meta.description']) && artifact.includes(LOCALES.zh['meta.description']),
  'built client must carry both descriptions (run npm run build)')
assert.ok(artifact.includes(LOCALES.en['error.token.expiring']), 'built client must carry the translated error copy (run npm run build)')

console.log('bilingual copy contract OK (locale files + dictionaries + host codes + rendered page)')
