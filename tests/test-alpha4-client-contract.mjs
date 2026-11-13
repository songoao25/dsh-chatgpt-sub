import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const patchPath = join(root, pkg.dsh.bundle.patch)
const source = readFileSync(join(root, 'src', 'client-bundle.js'), 'utf8')
const artifact = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

const retiredRuntime = ['@deepseek-ai', 'dsh-client-' + 'runtime'].join('/')
assert.deepEqual(pkg.dsh.client.inject, [], 'plugin-page configuration must not load legacy global-settings modules')
assert.ok(!pkg.dsh.client.inject.includes(retiredRuntime), 'retired client runtime must not be injected')
assert.ok(existsSync(patchPath), 'bundle patch must exist')
assert.ok(existsSync(join(root, pkg.main)), 'host entry must exist')
const patch = readFileSync(patchPath, 'utf8')
assert.match(patch, /- insert:/)
// 行 id ≠ 模块名：DSH 的插件卡片把「行 id」和「模块名」各占一行（只有与标题相同时才省略其中一行），
// 两者取同一个字符串就会在 Components 里显示成重复的两行。
const patchRow = patch.match(/- id:\s*([^\s]+)\s*\n\s*name:\s*'?([^'\n]+)'?/)
assert.ok(patchRow, 'the bundle patch must declare exactly one row with id and name')
assert.notEqual(patchRow[1], patchRow[2], 'the row id must differ from the module name (identical values render as a duplicated line)')

assert.match(source, /inject:\s*\['slots',\s*'locale'\]/, 'client must declare the slots and locale services it reads')
assert.doesNotMatch(source, /slots\.inject\('settings\.section'/, 'global settings section must not be registered')
assert.match(source, /slots\.inject\('plugins\.bundle\.config'/, 'plugin configuration slot must remain registered')
assert.match(source, /key:\s*'dsh-chatgpt-sub'/, 'plugin configuration key must match bundle name')
assert.match(source, /require\('react'\)/, 'React must stay an external client module')
assert.match(artifact, /window\.__ModuleLoader__\.load/, 'built client must use the DSH module loader')
assert.match(artifact, /require\('react'\)/, 'built client must retain external React loading')

console.log('alpha.4 client contract OK (plugin configuration + React)')

// ---------- 插件配置页风格：DSH 0.2.2 settings-form 卡片语法（2026-11-13 设计体系迁移）----------
// 约定（与 dsh-bottom-info-bar 同步迁移，锁死回归）：
//   每个设置区块是一张 settings-card：fill/stroke 取 --dsw-alias-settings-card-fill /
//   settings-card-stroke，圆角 var(--dsw-radius-xl)=20px，内衬 12px 14px，卡与卡 gap 8px。
//   卡内禁止一切分隔线（border-bottom / hr）——区块内部分层级只靠留白（节间距 24px）。
//   每张卡必须有同一个层级的一级卡头：标题 + 一句话说明（说明可以是动态摘要）。
//   行语法：8px 圆角 + hover 时 --dsw-alias-interactive-bg-hover 填充、过渡 120ms ease；
//   行内左「标题 + 说明」两行堆叠、右控件垂直居中右对齐；行用负水平 margin 让文字落在
//   卡头同一缩进线上（文字贴线、填充外扩）。
//   分组折叠统一 disclosure：右侧「展开/收起」文字 + 箭头，grid 动画过渡。
//   状态徽章用软底胶囊：inline-flex、高 16px、左右 padding 7px、圆角 999px、
//   背景 currentColor 14% 透明度混合、字重 600；禁止实色底、禁止描边色块。
//   select/input 走 DSH 原生样式（背景 bg-layer-1，高 32px），同页尺寸一致、右缘对齐。
assert.match(source, /function installStyles\(\)/, 'client must install a stylesheet instead of inline card styles')
assert.match(source, /style\.dataset\.pluginCss = id/, 'stylesheet injection must be idempotent via data-plugin-css')
// 宽度铁律：宽度上限交给宿主（.X_2TxG_page > * 已把内容钉在 min(100%, 960px)）
assert.match(source, /\.cgpt-page \{[^}]*max-width: 100%;/, 'page width cap must be left to the host (.X_2TxG_page > * already pins min(100%, 960px))')
assert.doesNotMatch(source, /\.cgpt-page \{[^}]*max-width: 760px/, 'page must not hard-cap its width at 760px')
// 卡片语法：token 层定义 + 设置卡表面
assert.match(source, /--cgpt-card-gap: 8px;/, 'cards are separated by an 8px gap (native settings rows rhythm)')
assert.match(source, /--cgpt-section-gap: 24px;/, 'sections inside a card separate by whitespace only (24px)')
assert.match(source, /--cgpt-card-fill: var\(--dsw-alias-settings-card-fill/, 'card fill must come from the DSH settings-card token')
assert.match(source, /--cgpt-card-stroke: var\(--dsw-alias-settings-card-stroke/, 'card stroke must come from the DSH settings-card token')
assert.match(source, /--cgpt-card-radius: var\(--dsw-radius-xl, 20px\);/, 'card radius must follow radius-xl (20px)')
assert.match(source, /--cgpt-card-pad-block: 12px; --cgpt-card-pad-inline: 14px;/, 'card padding must follow the native rowCard inset (12px 14px)')
assert.match(source, /\.cgpt-card \{[^}]*border: 0\.5px solid var\(--cgpt-card-stroke\); background: var\(--cgpt-card-fill\); border-radius: var\(--cgpt-card-radius\); padding: var\(--cgpt-card-pad-block\) var\(--cgpt-card-pad-inline\);/, 'a settings card carries fill + stroke + radius-xl + 12px 14px inset')
// 一级卡头：每张卡的标题 + 说明都在同一层级
assert.match(source, /\.cgpt-cardHead \{ display: flex; flex-direction: column;/, 'every card opens with a level-1 card head')
assert.match(source, /\.cgpt-cardTitle \{ margin: 0; font-size: var\(--cgpt-title-size\); font-weight: var\(--cgpt-title-weight\); line-height: var\(--cgpt-title-line\);/, 'card title inherits the 14/500/20 native scale')
assert.match(source, /'cgpt-binding-title'[\s\S]{0,600}?t\('ui\.bindingCardTitle'\)[\s\S]{0,600}?bindingHeadDesc/, 'the binding card head carries a title plus a dynamic summary')
// 分隔线禁令：卡内不许有任何 border-bottom / hr
assert.doesNotMatch(source, /\.cgpt-row \{[^}]*border-bottom/, 'rows must not draw any separator rule (whitespace only)')
assert.doesNotMatch(source, /<hr|border-top: 1px/, 'no hr or 1px top rules anywhere in the page')
assert.doesNotMatch(source, /cgpt-list|cgpt-sectionHead|cgpt-sectionTitle|cgpt-sectionDesc|cgpt-updates \{/, 'the retired flat-list classes must be gone, not kept as dead code')
// 行语法：8px 圆角 + hover 填充 120ms ease + 负 margin 贴线 + 文字块 flex:1
assert.match(source, /--cgpt-control-radius: 8px;/, 'row hover surfaces use the 8px shape')
assert.match(source, /\.cgpt-row \{[^}]*border-radius: var\(--cgpt-control-radius\); transition: background-color 120ms ease; \}/, 'rows transition their hover fill in 120ms ease')
assert.match(source, /\.cgpt-row:hover \{ background: var\(--dsw-alias-interactive-bg-hover/, 'hover fill must use the host interactive token')
assert.match(source, /\.cgpt-row \{[^}]*margin-inline: calc\(-1 \* var\(--cgpt-row-pad-inline\)\);/, 'rows use a negative horizontal margin so text sits on the card inset line')
assert.match(source, /\.cgpt-rowText \{[^}]*flex: 1; gap: 2px; min-width: 0;/, 'the row text block must grow (title + description stacked)')
assert.doesNotMatch(source, /\.cgpt-row \{[^}]*justify-content: space-between/, 'rows must not push controls with space-between')
// 折叠统一 disclosure：右「展开/收起」+ 箭头，grid 动画
assert.match(source, /className: 'cgpt-cardDisclosure',\s*\n\s*'aria-expanded': open,\s*\n\s*'aria-controls': 'cgpt-updates-content',/, 'the update card head is a disclosure button wired with aria-expanded/aria-controls')
assert.match(source, /open \? t\('ui\.collapse'\) : t\('ui\.expand'\)/, 'the disclosure action reads Expand/Collapse, not a bare arrow')
assert.match(source, /cgptChevron\(\{ expanded: open/, 'the disclosure carries a rotating chevron')
assert.match(source, /\.cgpt-collapse \{ display: grid; grid-template-rows: 0fr;/, 'collapsing animates grid-template-rows 0fr→1fr (height itself participates)')
assert.match(source, /grid-template-rows: 1fr; opacity: 1; visibility: visible;/, 'the expanded state restores height, opacity and visibility')
assert.doesNotMatch(source, /max-height:\s*\d{3,}px/, 'collapsing must not use the max-height megaval trick')
// 状态徽章：软底胶囊，禁止实色底与描边色块
assert.match(source, /\.cgpt-pill \{ display: inline-flex; align-items: center; flex: none; height: 16px; padding: 0 7px; border: 0; border-radius: 999px; background: color-mix\(in srgb, currentColor 14%, transparent\); color: var\(--dsw-alias-label-secondary\); font-size: 11px; font-weight: 600;/, 'status badges are soft pills: 16px tall, 7px inline padding, currentColor 14% fill, weight 600')
assert.match(source, /function cgptPill\(props\)/, 'status badges must be rendered by the pill helper')
assert.doesNotMatch(source, /var NativeTag|var NativeStateDot|cgpt-status/, 'host Tag/StateDot superseded by the soft-pill language (no 10%/500 residue)')
// 控件：原生优先 + 兜底走同一度量（32px / bg-layer-1）
assert.match(source, /require\('@deepseek-ai\/dsh-client-ui-primitives'\)/, 'client must try to load the host primitives')
assert.match(source, /var NativeButton = native\('Button'\)/, 'native Button must be resolved through a safety-checked accessor')
assert.match(source, /var NativeMenu = native\('Menu'\)/, 'the language picker must use the host Menu atom')
assert.match(source, /var NativeSegmentedControl = native\('SegmentedControl'\)/, 'the update-mode switch must use the host SegmentedControl atom')
assert.match(source, /function cgptPill\(props\)[\s\S]{0,400}function cgptChevron\(props\)/, 'pill and chevron helpers live beside the other native-first controls')
assert.match(source, /\.cgpt-language \{[^}]*height: var\(--cgpt-input-height\);[^}]*background: var\(--cgpt-input-bg\);/, 'the fallback select must use the unified 32px input metrics')
assert.match(source, /--cgpt-input-bg: var\(--dsw-alias-bg-layer-1\);/, 'inputs and selects sit on bg-layer-1 like the native settings form')
assert.match(source, /cgptSelect\(\{\s*\n\s*id: 'cgpt-language',/, 'the language row must render through cgptSelect')
// 破坏性确认与结果提示：原生 RiskConfirmation / Toast 优先，window.confirm / alert 只作兜底
assert.match(source, /var NativeRiskConfirmation = native\('RiskConfirmation'\)/, 'destructive actions must use the host RiskConfirmation atom')
assert.match(source, /var NativeToast = native\('Toast'\)/, 'failure notices must use the host Toast atom')
assert.match(source, /if \(NativeRiskConfirmation\) \{ setUnbindAck\(false\); setUnbindOpen\(true\); return; \}/, 'unbind must ask through the native dialog, with window.confirm only as a fallback')
assert.match(source, /if \(NativeRiskConfirmation\) \{ setInstallAck\(false\); setPendingInstall\(/, 'install must ask through the native dialog, with window.confirm only as a fallback')
assert.match(source, /if \(NativeToast\) setToast\(\{ id: Date\.now\(\), text: text \}\);\s*\n\s*else alert\(text\);/, 'failure notices must go through the native Toast, with alert only as a fallback')
assert.equal((source.match(/alert\(/g) || []).length, 1, 'alert must survive only as the Toast fallback')
assert.equal((source.match(/(?:^|[^.\w])confirm\(t\('/g) || []).length, 2, 'confirm() must survive only as the two RiskConfirmation fallbacks')
// 没有用到的样式一律不留；不许内联样式对象
assert.doesNotMatch(source, /cardStyle|btnPrimary|btnSecondary|btnDanger/, 'the inline card style objects must be gone')
assert.doesNotMatch(source, /style:\s*\{/, 'no inline style props may remain in the page component')
assert.doesNotMatch(source, /React\.createElement\(PRIMITIVES\./, 'primitives members must never be passed to createElement unguarded (React #130)')
assert.match(source, /@media \(prefers-reduced-motion: reduce\)/, 'motion must respect the reduced-motion preference')
// 原生 Button 只带 danger 变体类，不叠兜底几何
assert.match(source, /className: danger \|\| undefined,/, 'the native Button must receive only the danger class')
assert.doesNotMatch(source, /className: className,/, 'the native Button must not receive the fallback .cgpt-btn class')
// 分段控件 tablist 结构保留
assert.match(source, /id: 'cgpt-update-mode-' \+ value \+ '-panel'/, 'each segmented tab needs its matching tabpanel id')
assert.match(source, /'aria-labelledby': 'cgpt-update-mode-' \+ value/, 'each tabpanel must point back at its tab')
assert.match(source, /hidden: value !== modeValue/, 'only the selected option panel stays visible')
// 部署产物必须包含同一份样式（lib 已入库，构建后不得滞后）
assert.match(artifact, /cgpt-card \{/, 'built client must carry the settings-card rule')
assert.match(artifact, /cgpt-pill \{/, 'built client must carry the soft-pill rule')

console.log('plugin page style contract OK (native detail-page metrics + host primitives)')
