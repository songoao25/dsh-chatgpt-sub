// dsh-chatgpt-sub — client half：插件详情页的订阅配置
// 文案全部收在内置多语言字典里，注册进 DSH 的 locale 服务后跟随界面语言。
// 铁律：取文案绝不能让渲染抛错——配置页整块消失过一次，根因就是未在 inject 里声明 locale 就访问
// ctx.locale（cordis 对未声明的服务属性直接抛 cannot get property "locale" without inject）。
const LOCALE_NAMESPACE = 'dsh-chatgpt-sub';
const LOCALES = /*__LOCALES__*/{};
/*__LANGUAGE_RUNTIME__*/
module.exports = {
  // slots：配置页槽位；locale：页面文案跟随宿主（不声明就用不了 ctx.locale）
  inject: ['slots', 'locale'],
  async apply(ctx) {
    // slots 服务等待就绪（最多 18s）
    let slots = ctx.slots || ctx.get('slots');
    for (let i = 0; slots === undefined && i < 60; i++) {
      await new Promise(function (resolve) { window.setTimeout(resolve, 300); });
      slots = ctx.slots || ctx.get('slots');
    }
    if (slots === undefined) {
      console.warn('[dsh-chatgpt-sub] slots 服务未就绪，插件配置页未注册');
      return;
    }

    // RPC 封装（webServer HTTP）
    const PREFIX = '/_dsh/dsh-chatgpt-sub';
    // DSH 0.1.7 desktop host enforces POST for state-changing RPCs, even
    // when the call has no JSON arguments. Keep read-only status polling GET.
    const MUTATING_RPC = { startCodexOAuth: true, unbindCodex: true, checkUpdate: true, enterUpdatePage: true, installUpdate: true, runUpdateCheck: true, setUpdateAuto: true, rollbackUpdate: true };
    function rpc(method, args) {
      const url = PREFIX + '/' + method;
      const controller = new AbortController();
      const timeout = window.setTimeout(function () { controller.abort(); }, 15000);
      const mutating = Object.hasOwn(MUTATING_RPC, method);
      return fetch(url, {
        method: mutating ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json' },
        body: mutating ? JSON.stringify(args || {}) : undefined,
        signal: controller.signal,
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (body) {
          if (!r.ok) throw new Error(body.error || ('HTTP ' + r.status));
          return body;
        });
      }).finally(function () { window.clearTimeout(timeout); });
    }

    // React 由 bundle 的 require('react') 提供（seed 模块，与官方 client 包同机制）
    var React = require('react');
    // 宿主原生组件库（与 dsh-bottom-info-bar 同一来源）。取不到时全部退回插件内的等价实现，
    // 任何成员都不允许以 undefined 的身份进入 React.createElement（那会 React #130 白屏）。
    var PRIMITIVES = null;
    try {
      PRIMITIVES = require('@deepseek-ai/dsh-client-ui-primitives') || null;
    } catch (err) { PRIMITIVES = null; }
    function native(name) {
      if (!PRIMITIVES) return null;
      var member = PRIMITIVES[name];
      return typeof member === 'function' || (member && typeof member === 'object') ? member : null;
    }
    var NativeButton = native('Button');
    // 状态标签与状态点：宿主 Tag 自带 success/danger 色调、StateDot 自带 done/error/…
    // 这两种正是状态行要表达的语义，不再自绘（自绘版本见 .cgpt-status--* 兜底）。
    var NativeTag = native('Tag');
    var NativeStateDot = native('StateDot');
    // 自动/手动是「二选一」，宿主对应用 SegmentedControl（tablist + 滑动指示块 + 方向键走位）。
    var NativeSegmentedControl = native('SegmentedControl');
    // 下拉选择：浏览器原生 <select> 是操作系统自带的古老控件（灰色直角框 + 系统菜单），
    // 与 DSH 观感脱节，所以优先用宿主原生 Menu（锚点 = 原生 Button，列表 = 原生菜单卡片），
    // 取不到 Menu 才退回 <select>。同样取自兄弟插件（dsh-bottom-info-bar）时区选择的先例。
    var NativeMenu = native('Menu');
    // 破坏性操作确认走宿主原生 RiskConfirmation（勾选后才可点确认的弹窗），
    // 取不到退回 window.confirm——两条路径都保证「未确认不执行」。
    var NativeRiskConfirmation = native('RiskConfirmation');
    // 结果提示（绑定失败、解绑失败）走宿主原生 Toast，取不到退回 alert。
    var NativeToast = native('Toast');
    // 折叠/下拉箭头取自 primitives；导出名跟着宿主版本变过（Regular/Medium 档位 vs 旧的 14），
    // 都取不到时退回 CSS 画的箭头。绝不把 undefined 交给 React.createElement。
    var NativeChevron = PRIMITIVES
      ? (PRIMITIVES.IconChevronDownOutlineRegular || PRIMITIVES.IconChevronDownOutlineMedium || null)
      : null;
    // h 必须支持多 children（React.createElement 接受可变参数；组件多处传多个子元素）
    function h(tag, props) {
      var args = [tag, props];
      for (var i = 2; i < arguments.length; i++) args.push(arguments[i]);
      return React.createElement.apply(React, args);
    }
    // 同 h，但 children 以数组给出——逐项展开成可变参数，
    // 避免把数组当唯一子节点（那会要求每个元素带 key，且会多套一层隐式 key 警告）。
    function hList(tag, props, children) {
      var args = [tag, props];
      for (var i = 0; i < children.length; i++) {
        if (children[i]) args.push(children[i]);
      }
      return React.createElement.apply(React, args);
    }

    // 文案取值：字典注册进 DSH 的 locale 服务（zh / en 各一份，与 locale/*.json 的 meta 同源），
    // 注册不上就按浏览器语言兜底。整段都包在 try/catch 里——文案取不到是小事，页面渲染挂掉是大事。
    var localeService = null;
    try { localeService = ctx.locale; } catch (err) { localeService = null; }
    if (!localeService && typeof ctx.get === 'function') {
      try { localeService = ctx.get('locale'); } catch (err) { localeService = null; }
    }
    if (localeService && typeof localeService.register === 'function') {
      try {
        var disposeDictionaries = localeService.register(LOCALE_NAMESPACE, LOCALES);
        if (typeof ctx.effect === 'function') ctx.effect(function () { return disposeDictionaries; }, 'dsh-chatgpt-sub: dictionaries');
      } catch (err) { /* 注册失败：退回浏览器语言 */ }
    }
    var languageRuntime = createLanguageRuntime(LOCALE_NAMESPACE, LOCALES, localeService);
    var t = languageRuntime.t;
    if (typeof ctx.effect === 'function') ctx.effect(function () { return function () { languageRuntime.dispose(); }; }, 'dsh-chatgpt-sub: language preference');
    // 宿主错误：带 code 的按字典中英各一条，没有 code 的用宿主原文兜底。
    function errorText(error) {
      if (!error) return '';
      if (error.code) {
        var key = 'error.' + error.code;
        var localized = t(key, error.params);
        if (localized !== key) return localized;
      }
      return error.message || '';
    }

    // ---------- 样式 ----------
    // 排版照宿主**插件详情页**那一套原生度量（dsh-client-ui-plugin-manager 的 X_2TxG_*）：
    //   detailSection  { flex-col; gap:12px }  → .cgpt-page（本页是详情页里的**一个** section，
    //                                            再套 detailSections 的 32px 会凭空多出大段空白）
    //   rows           { flex-col; gap:0 }     → .cgpt-list
    //   row            { padding:12px 2px; border-bottom:.5px solid border-l2 } → .cgpt-row
    //   row:last-child { border-bottom:0 }
    //   rowLine        { align-items:center; gap:16px } → .cgpt-row 的主轴间距
    //   rowId          { 13.5/500/20 }         → .cgpt-rowTitle
    //   failure/reason { 错误色; 12/18; 可换行 }    → .cgpt-alert--error
    // 【横向对齐铁律】宿主的 .X_2TxG_detailSection（配置区挂载点）实测 x=323.2、padding:0，
    // 宿主自己的区块标题文字左边界也是 323.2。所以我们的每个内容块都**不能自带左右内边距**，
    // 否则整体右移、与宿主自己渲染的区块错开——那正是「什么都对不齐」的根因。
    // 行本身用 padding:12px 2px（宿主 .X_2TxG_row 的真实值），内容内缩 2px，与宿主一致。
    // 全部走 --dsw-alias-* 令牌，深色/浅色主题自动跟随。
    function installStyles() {
      var id = 'dsh-chatgpt-sub-page';
      if (document.querySelector('style[data-plugin-css="' + id + '"]') !== null) return;
      var style = document.createElement('style');
      style.dataset.plugin = 'dsh-chatgpt-sub';
      style.dataset.pluginCss = id;
      style.textContent = `
        /* 宽度上限交给宿主：.X_2TxG_page > * 已把内容钉在 min(100%, 960px)，这里再写死 760px 会在宽视口下压窄内容、右侧控件够不到宿主右边界。 */
        /* 语言选择器：宿主原生 Menu 弹层（锚点 = 原生 outline 按钮）。下面这几条只做布局，
           外观（边框/圆角/hover/焦点/禁用）全部由宿主 Button 维护。 */
        .cgpt-selectTrigger { max-width: 100%; }
        .cgpt-selectTrigger--open { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08)); }
        .cgpt-selectLabel { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
        .cgpt-selectValue { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cgpt-selectChevron { flex: none; color: var(--dsw-alias-label-tertiary); }
        .cgpt-selectChevronGlyph { flex: none; width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid currentColor; color: var(--dsw-alias-label-tertiary); }
        /* 兜底（宿主没有 Menu 时）：浏览器 <select>，度量照 settings-form/fields.module.css 的 .input
           （34px / radius md / 0.5px border-l4 / bg-layer-3 / 13px），与设置页里的输入框同高同形。 */
        .cgpt-language { max-width: 100%; min-width: 0; height: 34px; padding: 0 12px; font: inherit; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-3); border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 12px); }
        .cgpt-language:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); }
        /* 区块节奏照宿主：.detailSections{gap:32px} → 区块之间 32px；.detailSection{gap:12px} → 区块内部 12px。
           2026-10-14 与 dsh-bottom-info-bar 统一：两个插件的设置页用同一套行/区块语法。 */
        .cgpt-page { display: flex; flex-direction: column; width: 100%; max-width: 100%; min-width: 0; gap: 32px; color: var(--dsw-alias-label-primary); }
        .cgpt-page, .cgpt-page * { box-sizing: border-box; }
        /* 行 = 原生详情页的 .X_2TxG_row：12px 2px 内边距 + .5px 下边线（末行无线），
           无圆角、无 hover 填充、无负外边距。分隔靠边线，所以列表 gap 为 0。 */
        .cgpt-list { display: flex; flex-direction: column; gap: 0; width: 100%; min-width: 0; }
        /* 行 = 宿主 .row + .rowLine + .rowMain：12px 2px 内边距、行间 .5px 分割线、末行无线。
           控件贴右靠「文字块 flex:1」实现（与 .rowMain 的 flex:1 同一手法），不再用 space-between 硬推；
           也不做 first-child 去内边距之类的自创覆写（宿主只有 :last-child 去线这一条）。 */
        .cgpt-row { display: flex; flex-wrap: wrap; align-items: center; gap: 16px; width: 100%; min-width: 0; margin: 0; padding: 12px 2px; border: 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.16)); border-radius: 0; }
        .cgpt-row:last-child { border-bottom: 0; }
        .cgpt-rowText { display: flex; flex-direction: column; flex: 1; gap: 2px; min-width: 0; }
        .cgpt-rowTitle { display: flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 500; line-height: 20px; color: var(--dsw-alias-label-primary); }
        .cgpt-rowDesc { font-size: 11.5px; line-height: 16px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
        .cgpt-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; }
        /* 状态标签：走宿主原生 Tag（11px 胶囊，tone=success/danger）+ StateDot。
           2026-10-13 改：宿主 Tag 现在自带 success/danger 两点色（10% color-mix），
           正是当年手抄的那套配色，所以自绘药丸与圆点整体删掉，只留一个 gap。 */
        .cgpt-status { gap: 6px; }
        /* 兜底状态点：宿主 StateDot 是 10px 槽 + 6px currentColor 实心核，这里取核的尺寸。 */
        .cgpt-statusDot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
        /* 兜底（宿主没 primitives 时）：几何与配色照抄 Tag.module.css 的 success/danger。 */
        .cgpt-status--success { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 1px 8px; font-size: 11px; line-height: 17px; font-weight: 500; white-space: nowrap; color: var(--dsw-alias-state-success-primary, #087f5b); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #087f5b) 10%, transparent); }
        .cgpt-status--danger { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 1px 8px; font-size: 11px; line-height: 17px; font-weight: 500; white-space: nowrap; color: var(--dsw-alias-state-error-primary, #d92d20); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d92d20) 10%, transparent); }
        /* 按钮兜底几何 = 宿主 primitives Button.module.css 的 .sm + .outline：
           28px 高 / radius-sm / 0 10px / 12·18 / 0.5px border-l3。走原生 Button 时这份不生效。 */
        .cgpt-btn { appearance: none; font: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 28px; border: 0.5px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-primary); background: transparent; border-radius: var(--dsw-radius-sm, 8px); padding: 0 10px; font-size: 12px; font-weight: 400; line-height: 18px; transition: background-color 120ms ease, border-color 120ms ease; }
        .cgpt-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08)); }
        .cgpt-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        /* 危险按钮：宿主 Button 没有 danger 变体（所以这条在原生路径下也保留）。
           配色照原生 .X_2TxG_danger：错误色文字 + 30% 错误色描边 + 8% 错误色 hover 底。 */
        .cgpt-btn--danger { color: var(--dsw-alias-state-error-primary, #d92d20); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d92d20) 30%, transparent); }
        .cgpt-btn--danger:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d92d20) 8%, transparent); }
        /* 错误提示：照原生 failure/reason 形态 */
        .cgpt-alerts { display: flex; flex-direction: column; gap: 12px; width: 100%; min-width: 0; padding: 0; }
        .cgpt-alert { width: 100%; min-width: 0; margin: 0; font-size: 12px; line-height: 18px; }
        /* 错误：照原生 .X_2TxG_failure（行内 flex + 错误色 + gap 10）+ .X_2TxG_reason（12/18 可换行）。 */
        .cgpt-alert--error { display: flex; align-items: center; gap: 10px; color: var(--dsw-alias-state-error-primary, #d92d20); overflow-wrap: anywhere; white-space: pre-wrap; }
        .cgpt-alertText { flex: 1 1 auto; min-width: 0; }
        .cgpt-note { width: 100%; margin: 0; padding: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
        /* 区块之间只用间距，不画线（宿主 .detailSections 就是 gap:32px）。 */
        .cgpt-updates { display: flex; flex-direction: column; gap: 12px; width: 100%; min-width: 0; }
        /* 区块头照宿主 .sectionHead + .sectionTitle：标题 14/500/20，说明 13/18 二级色。 */
        .cgpt-sectionHead { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .cgpt-sectionTitle { margin: 0; font-size: 14px; font-weight: 500; line-height: 20px; color: var(--dsw-alias-label-primary); }
        .cgpt-sectionDesc { margin: 0; font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
        /* 自动 / 手动是「二选一」——用宿主原生 SegmentedControl（tablist + 滑动指示块）。
           .cgpt-mode 只兜底：宿主取不到该原子时退回两个按钮并排，选中态用描边 + hover 底表示。 */
        .cgpt-mode { display: flex; flex-wrap: wrap; gap: 4px; }
        .cgpt-mode .cgpt-btn[aria-checked="true"] { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08)); border-color: var(--dsw-alias-brand-primary); }
        .cgpt-loading { margin: 0; padding: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
        @media (max-width: 600px) { .cgpt-row { align-items: flex-start; } .cgpt-controls { justify-content: flex-start; margin-left: 0; } }
        @media (prefers-reduced-motion: reduce) { .cgpt-btn { transition: none; } }
      `;
      document.head.appendChild(style);
    }
    installStyles();

    // 按钮：优先宿主原生 Button（.sm + .outline，与插件详情页的「卸载」同一套几何）。
    // 【不覆盖原生几何】走原生时只额外加 .cgpt-btn--danger（宿主没有 danger 变体），
    // 绝不把 .cgpt-btn 的兜底几何叠到原生按钮上——那会用 border-radius 14px 顶掉
    // Button.module.css .sm 的 var(--dsw-radius-sm) 8px，同一页里两种圆角。
    function cgptButton(props) {
      var danger = props.className ? props.className : '';
      if (NativeButton) {
        return h(NativeButton, {
          type: 'button',
          variant: props.variant || 'outline',
          size: 'sm',
          className: danger || undefined,
          role: props.role,
          'aria-checked': props.checked,
          'aria-label': props.ariaLabel,
          title: props.title,
          disabled: props.disabled,
          onClick: props.onClick,
          key: props.key,
        }, props.children);
      }
      return h('button', {
        type: 'button',
        className: ('cgpt-btn' + (danger ? ' ' + danger : '')),
        role: props.role,
        'aria-checked': props.checked,
        'aria-label': props.ariaLabel,
        title: props.title,
        disabled: props.disabled,
        onClick: props.onClick,
        key: props.key,
      }, props.children);
    }

    // 状态标签：宿主原生 Tag + StateDot；取不到就退回同几何同配色的 .cgpt-status--*。
    function cgptStatus(props) {
      var dot = props.state
        ? (NativeStateDot
          ? h(NativeStateDot, { state: props.state, key: 'dot' })
          : h('span', { className: 'cgpt-statusDot', key: 'dot' }))
        : null;
      var children = dot === null ? props.children : [dot, props.children];
      if (NativeTag) return h(NativeTag, { tone: props.tone, className: 'cgpt-status', key: props.key }, children);
      return h('span', { className: 'cgpt-status cgpt-status--' + props.tone, key: props.key }, children);
    }

    // 二选一控件：宿主原生 SegmentedControl；取不到就退回一组 role=radio 的按钮
    // （兜底路径同样受 .cgpt-mode 约束，交互语义保持「选中项 = aria-checked=true」）。
    function cgptMode(props) {
      if (NativeSegmentedControl) {
        return h(NativeSegmentedControl, {
          id: props.id,
          value: props.value,
          options: props.options,
          onChange: props.onChange,
          label: props.label,
          disabled: props.disabled,
          key: props.key,
        });
      }
      return hList('div', { className: 'cgpt-mode', role: 'radiogroup', 'aria-label': props.label, key: props.key }, props.options.map(function (option) {
          return cgptButton({
            key: option.value,
            role: 'radio',
            checked: option.value === props.value,
            disabled: props.disabled,
            onClick: function () { props.onChange(option.value); },
            children: option.label,
          });
        }));
    }

    // 下拉选择：宿主原生 Menu 弹层（锚点 = 原生 outline 按钮，列表 = 原生菜单卡片）。
    // 取不到 Menu 时才退回浏览器 <select>——那是操作系统自带控件，只是可用性兜底，不是设计目标。
    function cgptSelect(props) {
      var openPair = React.useState(false), open = openPair[0], setOpen = openPair[1];
      if (!NativeMenu) {
        return h('select', {
          id: props.id,
          className: 'cgpt-language',
          value: props.value,
          'aria-label': props.label,
          onChange: function (event) { props.onChange(event.target.value); },
          key: props.key,
        }, props.options.map(function (option) {
          return h('option', { key: option.value, value: option.value }, option.label);
        }));
      }
      var current = null;
      for (var i = 0; i < props.options.length; i++) {
        if (props.options[i].value === props.value) current = props.options[i];
      }
      var trigger = cgptButton({
        variant: 'outline',
        className: 'cgpt-selectTrigger' + (open ? ' cgpt-selectTrigger--open' : ''),
        ariaLabel: props.label,
        title: props.label,
        onClick: function () { setOpen(!open); },
        children: hList('span', { className: 'cgpt-selectLabel' }, [
          h('span', { className: 'cgpt-selectValue', key: 'v' }, current ? current.label : props.value),
          NativeChevron
            ? h(NativeChevron, { key: 'c', size: 14, className: 'cgpt-selectChevron' })
            : h('span', { key: 'c', className: 'cgpt-selectChevronGlyph', 'aria-hidden': 'true' }),
        ]),
      });
      return h(NativeMenu, {
        open: open,
        anchor: trigger,
        items: props.options.map(function (option) { return { id: option.value, label: option.label }; }),
        selectedId: props.value,
        onSelect: function (id) { setOpen(false); props.onChange(id); },
        onClose: function () { setOpen(false); },
        align: 'start',
        portal: true,
        className: 'cgpt-select',
        key: props.key,
      });
    }

    function SubscriptionUpdates() {
      var statePair = React.useState(null), state = statePair[0], setState = statePair[1];
      var phasePair = React.useState(null), phase = phasePair[0], setPhase = phasePair[1];
      var errorPair = React.useState(null), error = errorPair[0], setError = errorPair[1];
      var active = React.useRef(false);
      var busy = React.useRef(false);
      var requestSequence = React.useRef(0);
      function load() {
        var sequence = ++requestSequence.current;
        return rpc('getUpdateState').then(function (result) {
          if (active.current && sequence === requestSequence.current) { setState(result); setError(null); }
          return result;
        }).catch(function () {
          if (active.current && sequence === requestSequence.current) setError('ui.updateHostOutdated');
          return null;
        });
      }
      React.useEffect(function () {
        active.current = true;
        rpc('enterUpdatePage').catch(function () {});
        load();
        var timer = setInterval(function () { if (!busy.current) load(); }, 15000);
        return function () { active.current = false; clearInterval(timer); };
      }, []);
      function action(method, args, nextPhase) {
        if (!active.current || busy.current) return Promise.resolve(null);
        requestSequence.current++;
        busy.current = true; setPhase(nextPhase); setError(null);
        return rpc(method, args).then(function (result) {
          if (active.current) {
            setState(result);
            if (result.rollback && result.rollback.restored !== true) setError('ui.updateRollbackFailed');
          }
          return result;
        }).catch(function () {
          if (active.current) setError('ui.updateFailed');
          return null;
        }).finally(function () { busy.current = false; if (active.current) setPhase(null); });
      }
      var pendingPair = React.useState(null), pendingInstall = pendingPair[0], setPendingInstall = pendingPair[1];
      var ackPair = React.useState(false), installAck = ackPair[0], setInstallAck = ackPair[1];
      function runInstall(version, force) {
        return action('installUpdate', force ? { force: true } : null, 'install');
      }
      // 安装前确认：宿主有原生 RiskConfirmation 就弹原生弹窗（勾选后才能点确认），
      // 取不到才退回 window.confirm——两条路径都保证「不确认不安装」。
      function confirmInstall(version, force) {
        if (typeof version !== 'string' || version.length === 0) return false;
        if (NativeRiskConfirmation) { setInstallAck(false); setPendingInstall({ version: version, force: !!force }); return false; }
        if (!confirm(t('ui.updateConfirm', { version: version }))) return false;
        runInstall(version, force);
        return true;
      }
      function check() {
        action('checkUpdate', null, 'check').then(function (result) {
          if (active.current && result && result.available && !result.pendingRestart && result.holdVersion !== result.latest) {
            confirmInstall(result.latest, false);
          }
        });
      }
      // 重启方向：优先认 host 给的三分类 restartKind（'update' / 'rollback' / 'downgrade'）。
      // 宿主还是旧版时（包文件已替换、DSH 没重启 —— 正是这块最常出问题的窗口）没有这个字段，
      // 就用回滚记录现场判一次：只做字符串相等，不做版本比较（版本比较的唯一出口在 host）。
      // 拿不到「用户点过回滚」的凭据就只能中性陈述，绝不替用户编一个他没做过的动作。
      function cgptRestartKind(state) {
        if (!state) return null;
        if (state.restartKind === 'update' || state.restartKind === 'rollback' || state.restartKind === 'downgrade') return state.restartKind;
        if (state.restartDirection === 'update') return 'update';
        if (state.restartDirection !== 'rollback') return null;
        return typeof state.holdVersion === 'string' && state.holdVersion.length > 0 && state.holdVersion === state.runningVersion
          ? 'rollback' : 'downgrade';
      }
      var content = [];
      // 行 = 宿主 .rowLine/.rowMain 的等价结构：左侧「标题 + 说明」文字列（flex:1）、右侧控件。
      // descriptionNodes 用于分段控件那种「说明就是 tabpanel」的行——说明仍留在文字列里，
      // 不另起一行，也不留悬空的 aria-controls。
      function row(key, title, description, controls, descriptionNodes) {
        return h('div', { className: 'cgpt-row', key: key },
          hList('div', { className: 'cgpt-rowText' }, [
            title ? h('div', { className: 'cgpt-rowTitle' }, title) : null,
            descriptionNodes || (description ? h('div', { className: 'cgpt-rowDesc' }, description) : null),
          ]),
          controls ? hList('div', { className: 'cgpt-controls' }, controls) : null);
      }
      var shown = function (version) { return version || t('ui.versionUnknown'); };
      if (state) {
        var latest = state.latest;
        var held = state.holdVersion && state.holdVersion === latest;
        // 方向由 host 判定（见 updateStatePayload）：update = 磁盘已是新版待重启；rollback = 用户点过回滚、
        // 磁盘比运行版本旧；downgrade = 磁盘比运行版本旧，但不是用户回滚的（插件被外部装成了旧版）。
        // 三者都只有重启才生效，但说法必须分开：把外部降级说成「已回滚」既冤枉用户又让人看不懂。
        var restartKind = cgptRestartKind(state);
        var statusText = t(latest ? 'ui.updateUpToDate' : 'ui.updateErrorCheckFailed');
        if (state.disabled) statusText = t('ui.updateDisabled');
        else if (phase === 'install') statusText = t('ui.updateInstalling', { version: shown(latest) });
        else if (restartKind === 'update') statusText = t('ui.updatePendingRestart', { version: shown(state.diskVersion) });
        else if (restartKind === 'rollback') statusText = t('ui.updateRolledBack', { version: shown(state.diskVersion) });
        else if (restartKind === 'downgrade') statusText = t('ui.updateDowngradePending', { version: shown(state.diskVersion), running: shown(state.runningVersion) });
        else if (state.lastError) statusText = t('ui.updateFailed');
        else if (held) statusText = t('ui.updateHeld', { version: state.holdVersion });
        else if (state.available && latest) statusText = t('ui.updateAvailableNow', { version: latest });
        var facts = [t('ui.versionRunning', { version: shown(state.runningVersion) }), t('ui.versionLatest', { version: shown(latest) })];
        if (state.lastCheckAt) {
          var minutes = Math.max(0, Math.floor((Date.now() - state.lastCheckAt) / 60000));
          var relative = minutes < 1 ? t('ui.timeJustNow') : minutes < 60 ? t('ui.timeMinutesAgo', { n: minutes }) : minutes < 1440 ? t('ui.timeHoursAgo', { n: Math.floor(minutes / 60) }) : t('ui.timeDaysAgo', { n: Math.floor(minutes / 1440) });
          facts.push(t('ui.versionLastCheck', { time: relative }));
        }
        var buttons = state.disabled ? null : [cgptButton({ key: 'check', disabled: !!phase, onClick: check, children: t(phase === 'check' ? 'ui.updateChecking' : 'ui.updateCheckNow') })];
        if (buttons && state.available && latest && !held && !state.pendingRestart) buttons.push(cgptButton({ key: 'install', disabled: !!phase, onClick: function () { confirmInstall(latest, false); }, children: t('ui.updateInstallNow', { version: latest }) }));
        content.push(row('state', statusText, state.disabled ? t('ui.updateDisabledWhy') : facts.join(' · '), buttons));
        if (!state.disabled && state.lastError) {
          var errors = { 'incomplete-download': 'ui.updateErrorIncompleteDownload', 'integrity-mismatch': 'ui.updateErrorIntegrityMismatch', 'download-failed': 'ui.updateErrorDownloadFailed', 'too-large': 'ui.updateErrorTooLarge', 'payload-mismatch': 'ui.updateErrorPayloadMismatch', 'payload-unsafe': 'ui.updateErrorPayloadUnsafe', 'check-failed': 'ui.updateErrorCheckFailed' };
          content.push(row('failure', null, t(errors[state.lastErrorKind] || 'ui.updateErrorUnknown')));
        }
        if (!state.disabled) {
          // 原生分段控件是 tablist：每个 tab 的 aria-controls 指向 <id>-<value>-panel。
          // 说明本身充当 panel（放在行的文字列里，非选中项 hidden），页面上不留悬空引用。
          var modeValue = state.autoUpdate === false ? 'manual' : 'auto';
          var modePanels = ['auto', 'manual'].map(function (value) {
            return h('div', {
              key: value,
              id: 'cgpt-update-mode-' + value + '-panel',
              role: 'tabpanel',
              'aria-labelledby': 'cgpt-update-mode-' + value,
              className: 'cgpt-rowDesc',
              hidden: value !== modeValue,
            }, t(value === 'manual' ? 'ui.updateModeManualDesc' : 'ui.updateModeAutoDesc'));
          });
          content.push(row('mode', t('ui.autoUpdateTitle'), null, [
            cgptMode({
              key: 'modes',
              id: 'cgpt-update-mode',
              label: t('ui.autoUpdateTitle'),
              value: modeValue,
              disabled: !!phase,
              options: [
                { value: 'auto', label: t('ui.updateModeAuto') },
                { value: 'manual', label: t('ui.updateModeManual') },
              ],
              onChange: function (mode) { action('setUpdateAuto', { enabled: mode === 'auto' }, 'mode'); },
            })
          ], modePanels));
          // 逃生门只在新版已装好但还没重启（restartKind === 'update'，此时退回最省事）或上次更新失败时出现。
          // 磁盘已经比运行中旧（'rollback' / 'downgrade'）时不再显示：回滚过的那次 pendingVersion 已清空，
          // 外部降级则根本没有可回滚的对象，点了也没意义。
          var rollback = restartKind === 'update' || !!state.lastError;
          if (rollback || held) content.push(row('fallback', null, t(rollback ? 'ui.updateFallbackWhy' : 'ui.updateHoldWhy'), [
            rollback ? cgptButton({ key: 'rollback', disabled: !!phase, onClick: function () { action('rollbackUpdate', null, 'rollback'); }, children: t('ui.updateRollback') }) : null,
            held ? cgptButton({ key: 'force', disabled: !!phase, onClick: function () { confirmInstall(state.holdVersion, true); }, children: t('ui.updateAllowHeld', { version: state.holdVersion }) }) : null,
          ]));
        }
      } else content.push(h('p', { className: 'cgpt-loading', key: 'loading' }, t(error ? 'ui.versionUnavailable' : 'ui.loading')));
      if (error) content.push(h('p', { className: 'cgpt-alert cgpt-alert--error', role: 'alert', key: 'error' }, t(error)));
      // 安装确认弹窗：宿主原生 RiskConfirmation（勾选前确认按钮为禁用态）。
      var installDialog = pendingInstall && NativeRiskConfirmation ? h(NativeRiskConfirmation, {
        open: true,
        title: t('ui.updateConfirmTitle'),
        description: t('ui.updateConfirm', { version: pendingInstall.version }),
        acknowledgeLabel: t('ui.acknowledgeLabel'),
        cancelLabel: t('ui.dialogCancel'),
        closeLabel: t('ui.dialogCancel'),
        confirmLabel: t('ui.dialogConfirm'),
        acknowledged: installAck,
        disabled: !!phase,
        onAcknowledgedChange: setInstallAck,
        onCancel: function () { setPendingInstall(null); },
        onConfirm: function () { var requested = pendingInstall; setPendingInstall(null); runInstall(requested.version, requested.force); },
      }) : null;
      return hList('section', { className: 'cgpt-updates', 'aria-labelledby': 'cgpt-update-title' }, [
        hList('div', { className: 'cgpt-sectionHead' }, [
          h('h2', { id: 'cgpt-update-title', className: 'cgpt-sectionTitle' }, t('ui.versionAndUpdateTitle')),
          h('p', { className: 'cgpt-sectionDesc' }, t('ui.versionAndUpdateDesc')),
        ]),
        hList('div', { className: 'cgpt-list' }, content),
        installDialog,
      ]);
    }

    // ---------- 插件配置页组件 ----------
    function SubscriptionPage(props) {
      var _React$useState = React.useState(null),
          status = _React$useState[0],
          setStatus = _React$useState[1];
      var _React$useState2 = React.useState(false),
          authorizing = _React$useState2[0],
          setAuthorizing = _React$useState2[1];
      var pollRef = React.useRef(null);
      var languageState = React.useState(0);
      var languageErrorState = React.useState(null);
      var toastPair = React.useState(null);
      var toast = toastPair[0], setToast = toastPair[1];
      var unbindPair = React.useState(false);
      var unbindOpen = unbindPair[0], setUnbindOpen = unbindPair[1];
      var unbindAckPair = React.useState(false);
      var unbindAck = unbindAckPair[0], setUnbindAck = unbindAckPair[1];
      // 结果提示：宿主原生 Toast（失败文案自带警示图标）；取不到才退回 alert。
      var notify = React.useCallback(function (text) {
        if (NativeToast) setToast({ id: Date.now(), text: text });
        else alert(text);
      }, []);
      React.useEffect(function () {
        return languageRuntime.subscribe(function () { languageState[1](function (value) { return value + 1; }); });
      }, []);


      // 加载状态 + 轮询
      var load = React.useCallback(function () {
        rpc('getCodexBridgeStatus').then(function (s) { setStatus(s); }).catch(function (e) { setStatus({ ok: false, error: { message: t('ui.loadFailed') } }); });
      }, []);

      React.useEffect(function () {
        load();
        var timer = window.setInterval(load, 5000); // 每 5s 刷新一次（授权中时更快感知）
        return function () {
          window.clearInterval(timer);
          if (pollRef.current !== null) {
            window.clearInterval(pollRef.current);
            pollRef.current = null;
          }
        };
      }, [load]);

      // 授权按钮处理
      var handleAuthorize = React.useCallback(function () {
        if (authorizing) return;
        setAuthorizing(true);
        rpc('startCodexOAuth', { language: languageRuntime.locale() }).then(function (res) {
          if (!res.ok) {
            notify(t('ui.startFailed') + (errorText(res.error) || t('ui.unknownReason')));
            setAuthorizing(false);
            return;
          }
          // 打开浏览器授权页（window.open 兜底；host 也会尝试 open shell）
          if (res.authorizeUrl) window.open(res.authorizeUrl, '_blank');
          // 轮询直到完成；组件卸载或授权结束时必须清理定时器
          if (pollRef.current !== null) window.clearInterval(pollRef.current);
          pollRef.current = window.setInterval(function () {
            rpc('getCodexBridgeStatus').then(function (s) {
              setStatus(s);
              if (s.bound || !s.oauthInFlight) {
                window.clearInterval(pollRef.current);
                pollRef.current = null;
                setAuthorizing(false);
              }
            }).catch(function () {
              window.clearInterval(pollRef.current);
              pollRef.current = null;
              setAuthorizing(false);
            });
          }, 2000);
        }).catch(function (e) {
          notify(t('ui.startError') + e.message);
          setAuthorizing(false);
        });
      }, [authorizing, notify]);

      // 解绑：宿主有原生 RiskConfirmation 就先弹原生确认（勾选后才能点确认），
      // 取不到才退回 window.confirm——两条路径都保证「未确认不解绑」。
      var runUnbind = React.useCallback(function () {
        rpc('unbindCodex').then(function (res) {
          if (res.ok) { load(); } else { notify(t('ui.unbindFailed') + (errorText(res.error) || t('ui.retry'))); }
        });
      }, [load, notify]);
      var handleUnbind = React.useCallback(function () {
        if (NativeRiskConfirmation) { setUnbindAck(false); setUnbindOpen(true); return; }
        if (confirm(t('ui.unbindConfirm'))) runUnbind();
      }, [runUnbind]);

      // 格式化时间戳
      function fmtTime(ms) {
        if (!ms) return '—';
        var d = new Date(ms);
        return new Intl.DateTimeFormat(languageRuntime.locale(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
      }
      function fmtCountdown(ms) {
        if (!ms || ms <= 0) return t('ui.expired');
        var totalSec = Math.floor(ms / 1000);
        var h = Math.floor(totalSec / 3600);
        var m = Math.floor((totalSec % 3600) / 60);
        var s = totalSec % 60;
        var p = function (x) { return String(x).padStart(2, '0'); };
        return h > 0 ? h + 'h' + p(m) + 'm' : p(m) + ':' + p(s);
      }

      // 页面内不再放标题：详情页顶部已经写了插件名与描述，复述一遍纯属重复。
      // 页脚只讲页面级事实（隐私）；「绑定会打开登录页」「解绑会删本机登录信息」
      // 各在状态行、确认弹窗里说一次，不重复。
      var note = h('p', { className: 'cgpt-note' }, t('ui.privacyNote'));
      var languageChoices = [{ value: 'auto', label: t('language.auto') }].concat(languageRuntime.options().map(function (language) {
        return { value: language.id, label: language.label };
      }));
      var languageRow = h('div', { className: 'cgpt-row', key: 'language' },
        h('div', { className: 'cgpt-rowText' },
          h('div', { className: 'cgpt-rowTitle' }, t('language.title')),
          h('div', { className: 'cgpt-rowDesc' }, t('language.description'))),
        h('div', { className: 'cgpt-controls' },
          cgptSelect({
            id: 'cgpt-language',
            value: languageRuntime.preference(),
            label: t('language.title'),
            options: languageChoices,
            onChange: function (value) {
              try { languageRuntime.setPreference(value); languageErrorState[1](null); }
              catch { languageErrorState[1](t('language.saveFailed')); }
            },
          })));


      if (!status) {
        return h('div', { className: 'cgpt-page' }, languageRow, h('p', { className: 'cgpt-loading' }, t('ui.loading')));
      }

      var bound = status.bound;
      var errorMsg = errorText(status.error);

      // 三态：未绑定（中性引导）/ 已连接（绿）/ 需要注意（红，绑定还在但状态异常）。
      // 未绑定绝不显示红字——那不是错误，是正常起点。
      var needsAttention = bound && !!errorMsg;
      var bindLabel = authorizing ? t('ui.openingBrowser') : t('ui.bind');

      var accountDesc = null;
      if (bound && status.account) {
        var parts = [];
        if (status.account.email) parts.push(status.account.email);
        if (status.account.plan) parts.push(t('ui.accountPlan', { plan: status.account.plan }));
        accountDesc = parts.length > 0 ? parts.join(' · ') : t('ui.accountUnavailable');
      }

      // 状态行只说状态本身：药丸已经写了「已连接 / 需要注意」，出错时红字提示紧跟其后，
      // 都不再复述——没有新信息就不占一行。
      var statusDesc = !bound
        ? t('ui.statusUnbound')
        : needsAttention
          ? null
          : (status.expiresAt
            ? t('ui.statusExpires', { time: fmtTime(status.expiresAt), left: fmtCountdown(status.expiresAt - Date.now()) })
            : null);

      var statusControls = !bound
        ? [cgptButton({ key: 'auth', onClick: handleAuthorize, disabled: authorizing, children: bindLabel })]
        : [
          cgptStatus({
            key: 'state',
            tone: needsAttention ? 'danger' : 'success',
            state: needsAttention ? 'error' : 'done',
            children: needsAttention ? t('ui.needsAttention') : t('ui.connected'),
          }),
          cgptButton({ key: 'reauth', onClick: handleAuthorize, disabled: authorizing, children: authorizing ? t('ui.openingBrowser') : t('ui.rebind') }),
          cgptButton({ key: 'unbind', className: 'cgpt-btn--danger', onClick: handleUnbind, children: t('ui.unbind') }),
        ];

      var rows = [languageRow];
      if (accountDesc) {
        rows.push(hList('div', { className: 'cgpt-row', key: 'account' }, [
          h('div', { className: 'cgpt-rowText' },
            h('div', { className: 'cgpt-rowTitle' }, t('ui.account')),
            h('div', { className: 'cgpt-rowDesc' }, accountDesc)),
        ]));
      }
      var statusText = [h('div', { className: 'cgpt-rowTitle' }, t('ui.status'))];
      if (statusDesc) statusText.push(h('div', { className: 'cgpt-rowDesc' }, statusDesc));
      rows.push(hList('div', { className: 'cgpt-row', key: 'status' }, [
        hList('div', { className: 'cgpt-rowText' }, statusText),
        hList('div', { className: 'cgpt-controls' }, statusControls),
      ]));

      // 红字只说清楚出了什么事：动手的按钮在紧上面的状态行里，同屏不再放第二个同样的按钮。
      var alerts = [];
      if (needsAttention) {
        alerts.push(h('div', { className: 'cgpt-alert cgpt-alert--error', key: 'err', role: 'alert' },
          h('span', { className: 'cgpt-alertText' }, errorMsg)));
      }

      var unbindDialog = unbindOpen && NativeRiskConfirmation ? h(NativeRiskConfirmation, {
        open: true,
        title: t('ui.unbindConfirmTitle'),
        description: t('ui.unbindConfirm'),
        acknowledgeLabel: t('ui.acknowledgeLabel'),
        cancelLabel: t('ui.dialogCancel'),
        closeLabel: t('ui.dialogCancel'),
        confirmLabel: t('ui.dialogConfirm'),
        acknowledged: unbindAck,
        onAcknowledgedChange: setUnbindAck,
        onCancel: function () { setUnbindOpen(false); },
        onConfirm: function () { setUnbindOpen(false); runUnbind(); },
      }) : null;
      var toastNode = toast && NativeToast ? h(NativeToast, {
        key: toast.id,
        text: toast.text,
        onDone: function () { setToast(null); },
      }) : null;

      return hList('div', { className: 'cgpt-page' }, [
        hList('div', { className: 'cgpt-list' }, rows),
        alerts.length > 0 ? hList('div', { className: 'cgpt-alerts' }, alerts) : null,
        languageErrorState[0] ? h('p', { className: 'cgpt-alert cgpt-alert--error', role: 'alert' }, languageErrorState[0]) : null,
        h(SubscriptionUpdates),
        note,
        unbindDialog,
        toastNode,
      ]);
    }

    // 详情页顶部与插件列表用的描述就是这里的 summary 视图，随 DSH 语言取中/英。
    function SubscriptionBundleConfig(props) {
      if (props && props.view === 'summary') {
        return h('span', { className: 'dshChatGPTBundleSummary' }, t('meta.description'));
      }
      return h(SubscriptionPage, props);
    }

    // 当前 DSH 的插件页是外部 bundle 的唯一配置入口；key 必须等于 bundle 包名。
    var dispose = slots.inject('plugins.bundle.config', function () {
      return slots.register(
        {
          name: 'plugins.bundle.config',
          key: 'dsh-chatgpt-sub',
          label: function () { return t('meta.title'); },
        },
        SubscriptionBundleConfig
      );
    });

    return function () { if (dispose) dispose(); };
  },
};
