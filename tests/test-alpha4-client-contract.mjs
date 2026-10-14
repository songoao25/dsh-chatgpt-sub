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

// ---------- 插件配置页风格：与 dsh-bottom-info-bar 的设置面板对齐 DSH 原生插件详情页 ----------
// 约定（锁死回归，取自同页原生的 X_2TxG_sectionHead / X_2TxG_rows / X_2TxG_row / X_2TxG_rowId /
// Button.module.css .sm，2026-09-22 在真机页面逐项量过）：
//   区块间距 32px、区块内部 12px、区块头基线对齐 + 10px 且 **padding 0**；
//   区块标题 14/500/20；行 = padding 12px 2px + .5px 下边线（末行无线）、无圆角、无负外边距；
//   行标题 13.5/500/20；行说明 12/18 三级色；区块说明 13/20 二级色；
//   按钮取宿主原生小号胶囊（h28 / r14 / 12px / 0 10px）。
//   【对齐铁律】配置区挂载点 .X_2TxG_detailSection 实测 x=323.2、padding:0，宿主自己的区块标题
//   也落在 323.2；所以我们的内容块**一律不能自带左右内边距**，否则整体错位 8px。
//   一律走 --dsw-alias-* 令牌，禁止退回内联样式的卡片式（边框 + 圆角 + 深色底）。
assert.match(source, /function installStyles\(\)/, 'client must install a stylesheet instead of inline card styles')
assert.match(source, /style\.dataset\.pluginCss = id/, 'stylesheet injection must be idempotent via data-plugin-css')
assert.match(source, /\.cgpt-page \{[^}]*max-width: 100%;/, 'page width cap must be left to the host (.X_2TxG_page > * already pins min(100%, 960px))')
assert.doesNotMatch(source, /\.cgpt-page \{[^}]*max-width: 760px/, 'page must not hard-cap its width at 760px (it narrows the content against the host and leaves the right edge unreachable)')
// 2026-10-14 复核（安装版 DSH 的 plugin-manager CSS 实测，class 前缀随版本变，当前 ZVcBiW_*）：
//   .detailSections { flex-direction:column; gap:32px; margin-top:32px }  ← 区块之间
//   .detailSection  { flex-direction:column; gap:12px }                   ← 区块内部
// 插件设置页挂在 section.detailSection[data-plugin-config] 里，本页自己由多个区块组成，
// 所以：区块之间 32px（detailSections 节奏）、区块内部 12px（detailSection 节奏）。
// 旧的「整页一律 12px + 用 1px border-top 分区块」是自创做法，宿主里没有这条线。
assert.match(source, /\.cgpt-page \{[^}]*gap: 32px;/, 'page blocks must follow the native detailSections rhythm (32px)')
assert.match(source, /\.cgpt-updates \{[^}]*gap: 12px;/, 'a section keeps the native detailSection rhythm (12px) inside')
assert.doesNotMatch(source, /\.cgpt-updates \{[^}]*border-top: 1px solid/, 'sections must be separated by spacing, not by a 1px rule (the host has none)')
// 文案去重铁律：详情页顶部已经有插件名与描述，页面内不得再复述标题或介绍段
assert.doesNotMatch(source, /cgpt-intro/, 'in-page intro must stay removed (the manifest description already covers it)')
assert.doesNotMatch(source, /cgpt-title|cgpt-intro/, 'the page must not restate the plugin title the host already renders')
// 区块头照宿主 .sectionHead + .sectionTitle：标题 14/500/20，说明 13/18 二级色
assert.match(source, /\.cgpt-sectionHead \{ display: flex; flex-direction: column; gap: 2px;/, 'section head must be a small stacked block like the native sectionHead')
assert.match(source, /\.cgpt-sectionTitle \{[^}]*font-size: 14px; font-weight: 500; line-height: 20px;/, 'section title must match the native sectionTitle (14/500/20)')
assert.match(source, /\.cgpt-sectionDesc \{[^}]*font-size: 13px; line-height: 18px; color: var\(--dsw-alias-label-secondary\)/, 'section description must sit one step below the title (13/18 secondary)')
// 行 = 原生 .X_2TxG_row：12px 2px + .5px 下边线（末行无线），不是插件列表的 card 几何
assert.match(source, /\.cgpt-list \{ display: flex; flex-direction: column; gap: 0;/, 'row list must match the native .rows container (gap 0)')
assert.match(source, /\.cgpt-row \{[^}]*padding: 12px 2px; border: 0; border-bottom: 0\.5px solid var\(--dsw-alias-border-l2/, 'rows must use the native .row geometry (12px 2px + .5px bottom rule)')
// 行内两栏 = 宿主 .rowLine(flex/gap16) + .rowMain(flex:1/column/gap2)：控件靠右由「文字块 flex:1」实现
assert.match(source, /\.cgpt-rowText \{[^}]*flex: 1; gap: 2px; min-width: 0;/, 'the row text block must grow like the native .rowMain (flex: 1)')
assert.doesNotMatch(source, /\.cgpt-row \{[^}]*justify-content: space-between/, 'rows must not push the control right with space-between (the native row uses flex:1 on .rowMain)')
// 宿主只有 :last-child 去线这一条，没有 first-child 去内边距的自创覆写
assert.match(source, /\.cgpt-row:last-child \{ border-bottom: 0; \}/, 'the last row must drop its rule like the native .row:last-child')
assert.doesNotMatch(source, /\.cgpt-row:first-child/, 'no first-child padding override (the host row has none)')
assert.doesNotMatch(source, /\.cgpt-row \{[^}]*margin: 0 -8px/, 'rows must not use the card negative margin (it gets clipped by the collapse container)')
assert.match(source, /\.cgpt-rowTitle \{[^}]*font-size: 13\.5px; font-weight: 500; line-height: 20px;/, 'row title must match the measured native rowId scale (13.5/500/20)')
assert.match(source, /\.cgpt-rowDesc \{[^}]*font-size: 11\.5px; line-height: 16px; color: var\(--dsw-alias-label-tertiary\)/, 'row description must match the native .X_2TxG_rowModule scale (11.5/16 tertiary)')
// 横向对齐铁律：内容块不得自带左右内边距
assert.doesNotMatch(source, /\.cgpt-(?:intro|note|alerts|loading) \{[^}]*padding: 0 8px/, 'content blocks must not add their own 8px horizontal padding (it misaligns everything against the host)')
// 错误照原生 failure / reason 形态，而不是把「错误」单占一行再甩出正文
assert.match(source, /\.cgpt-alert--error \{[^}]*display: flex; align-items: center; gap: 10px; color: var\(--dsw-alias-state-error-primary[^}]*overflow-wrap: anywhere; white-space: pre-wrap;/, 'error must use the native failure/reason form')
// 没有用到的样式一律不留（写死的主按钮/警示条几何是死代码）
assert.doesNotMatch(source, /\.cgpt-(?:btn--primary|alert--warning|alertActions|note--pre|section|sectionCount)\b/, 'unused style rules must be deleted rather than kept as dead code')
assert.doesNotMatch(source, /cgpt-alertActions/, 'the error alert must not carry a second copy of the status row controls')
// 2026-10-13：宿主 primitives 的 .sm 现在是 28px 高 + var(--dsw-radius-sm)=8px 圆角
//（Button.module.css），不再是 14px 胶囊。兜底几何必须跟着走，否则原生按钮的圆角会被顶掉。
assert.match(source, /\.cgpt-btn \{[^}]*display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 28px; border: 0\.5px solid var\(--dsw-alias-border-l3\)[^}]*border-radius: var\(--dsw-radius-sm, 8px\); padding: 0 10px; font-size: 12px; font-weight: 400;/, 'button fallback must copy the host .sm + .outline geometry')
assert.doesNotMatch(source, /\.cgpt-btn \{[^}]*border-radius: 14px/, 'button fallback must not hard-code a 14px pill radius')
// 走原生 Button 时只允许带 danger 变体类，不能把 .cgpt-btn 的兜底几何叠上去（那会覆盖原生圆角）
assert.match(source, /className: danger \|\| undefined,/, 'the native Button must receive only the danger class')
assert.doesNotMatch(source, /className: className,/, 'the native Button must not receive the fallback .cgpt-btn class')
assert.match(source, /@media \(prefers-reduced-motion: reduce\)/, 'motion must respect the reduced-motion preference')
assert.doesNotMatch(source, /cardStyle|btnPrimary|btnSecondary|btnDanger/, 'the inline card style objects must be gone')
assert.doesNotMatch(source, /style:\s*\{/, 'no inline style props may remain in the page component')
// 原生组件接入：宿主 primitives 存在时必须走原生 Button/Tag/StateDot/SegmentedControl，缺成员时降级。
// 2026-10-13 改口：自绘状态药丸（与 28px 按钮等高）当年是权宜之计；宿主 Tag 现在自带
// success/danger 色调、StateDot 自带 done/error，正是状态行要表达的语义，于是改回原生原子。
assert.match(source, /require\('@deepseek-ai\/dsh-client-ui-primitives'\)/, 'client must try to load the host primitives')
assert.match(source, /var NativeButton = native\('Button'\)/, 'native Button must be resolved through a safety-checked accessor')
assert.match(source, /var NativeTag = native\('Tag'\)/, 'status must use the host Tag atom')
assert.match(source, /var NativeStateDot = native\('StateDot'\)/, 'status must use the host StateDot atom')
assert.match(source, /var NativeSegmentedControl = native\('SegmentedControl'\)/, 'the update-mode switch must use the host SegmentedControl atom')
assert.match(source, /function cgptStatus\(props\)/, 'status must be rendered by a native-first helper')
assert.match(source, /function cgptMode\(props\)/, 'the mode switch must be rendered by a native-first helper')
// 兜底（取不到原子时）必须抄宿主 Tag.module.css 的 11px 胶囊几何，而不是还原成 28px 自绘药丸
assert.match(source, /\.cgpt-status--success \{[^}]*border-radius: 999px; padding: 1px 8px; font-size: 11px; line-height: 17px; font-weight: 500;/, 'status fallback must copy the native Tag geometry')
assert.doesNotMatch(source, /cgpt-statusPill|cgpt-dot/, 'the hand-drawn status pill and dot must be gone (host Tag/StateDot supersede them)')
assert.doesNotMatch(source, /cgpt-updateMode/, 'the hand-rolled update-mode button row must be gone (SegmentedControl supersedes it)')
// 原生分段控件是 tablist：tab 的 aria-controls 指向 <id>-<value>-panel，说明自己充当 panel
// （放在行的文字列里，非选中项 hidden）——不留悬空引用，与 dsh-bottom-info-bar 同一做法。
assert.match(source, /id: 'cgpt-update-mode-' \+ value \+ '-panel'/, 'each segmented tab needs its matching tabpanel id')
assert.match(source, /'aria-labelledby': 'cgpt-update-mode-' \+ value/, 'each tabpanel must point back at its tab')
assert.match(source, /hidden: value !== modeValue/, 'only the selected option panel stays visible')
// 语言选择器：宿主原生 Menu 弹层优先，<select> 只作兜底；兜底度量照 settings-form .input
assert.match(source, /var NativeMenu = native\('Menu'\)/, 'the language picker must use the host Menu atom')
assert.match(source, /function cgptSelect\(props\)/, 'the language picker must go through a native-first helper')
assert.match(source, /cgptSelect\(\{\s*\n\s*id: 'cgpt-language',/, 'the language row must render through cgptSelect')
assert.match(source, /\.cgpt-selectTrigger \{ max-width: 100%; \}/, 'the menu trigger may only carry layout, never the fallback appearance')
assert.match(source, /\.cgpt-language \{[^}]*height: 34px; padding: 0 12px;[^}]*border: 0\.5px solid var\(--dsw-alias-border-l4\)[^}]*border-radius: var\(--dsw-radius-md, 12px\);/, 'the fallback select must copy the native settings .input metrics')
// 破坏性确认与结果提示：原生 RiskConfirmation / Toast 优先，window.confirm / alert 只作兜底
assert.match(source, /var NativeRiskConfirmation = native\('RiskConfirmation'\)/, 'destructive actions must use the host RiskConfirmation atom')
assert.match(source, /var NativeToast = native\('Toast'\)/, 'failure notices must use the host Toast atom')
assert.match(source, /if \(NativeRiskConfirmation\) \{ setUnbindAck\(false\); setUnbindOpen\(true\); return; \}/, 'unbind must ask through the native dialog, with window.confirm only as a fallback')
assert.match(source, /if \(NativeRiskConfirmation\) \{ setInstallAck\(false\); setPendingInstall\(/, 'install must ask through the native dialog, with window.confirm only as a fallback')
assert.match(source, /if \(NativeToast\) setToast\(\{ id: Date\.now\(\), text: text \}\);\s*\n\s*else alert\(text\);/, 'failure notices must go through the native Toast, with alert only as a fallback')
assert.equal((source.match(/alert\(/g) || []).length, 1, 'alert must survive only as the Toast fallback')
assert.equal((source.match(/(?:^|[^.\w])confirm\(t\('/g) || []).length, 2, 'confirm() must survive only as the two RiskConfirmation fallbacks')
assert.doesNotMatch(source, /React\.createElement\(PRIMITIVES\./, 'primitives members must never be passed to createElement unguarded (React #130)')
// 部署产物必须包含同一份样式（lib 已入库，构建后不得滞后）
assert.match(artifact, /cgpt-row \{/, 'built client must carry the native row rule')
assert.match(artifact, /cgpt-btn \{/, 'built client must carry the native button rule')

console.log('plugin page style contract OK (native detail-page metrics + host primitives)')
