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
    // 2026-11-13 设计体系迁移：排版基线从「宿主插件详情页的扁平行列表」换成
    // DSH 0.2.2 settings-form 的卡片语法（与 dsh-bottom-info-bar 同步）：
    //   rowCard  { fill/stroke + radius-xl + 12px 14px 内衬 }  → .cgpt-card（每个区块一张卡）
    //   rows     { 列向 gap:8px，无分隔线 }                     → .cgpt-page 的卡间节奏
    //   卡内行   { 8px 圆角 + hover interactive-bg-hover + 120ms ease } → .cgpt-row
    //   折叠     { 右「展开/收起」+ 箭头，grid 0fr→1fr }        → .cgpt-cardDisclosure/.cgpt-collapse
    //   状态徽章 { 软底胶囊 16px/7px/999/currentColor 14%/600 } → .cgpt-pill
    //   字段     { 32px / r12 / bg-layer-1 }                    → .cgpt-language（下拉兜底）
    // 【横向对齐铁律】卡内行的 10px 横向内衬只用于 hover 填充外扩，文字一律用负 margin
    // 压回卡面 14px 内衬线——标题与行文字落在同一缩进线上，不再出现碎节奏。
    // 全部走 --dsw-alias-* 令牌，深色/浅色主题自动跟随。
    function installStyles() {
      var id = 'dsh-chatgpt-sub-page';
      if (document.querySelector('style[data-plugin-css="' + id + '"]') !== null) return;
      var style = document.createElement('style');
      style.dataset.plugin = 'dsh-chatgpt-sub';
      style.dataset.pluginCss = id;
      style.textContent = `
        /* ============================================================================
           2026-11-13 设计体系迁移（DSH 0.2.2 settings-form 卡片语法，与 dsh-bottom-info-bar 同步）：
           原生设置表单已卡片化 —— rowCard { .5px settings-card-stroke / settings-card-fill /
           radius-xl(20px) / 12px 14px 内衬 }，卡与卡之间 gap 8px；卡内行与行、节与节之间
           **没有任何分隔线**，分层只靠留白（节间距 24px）。本页整体迁移到该语法，
           废除全部 .5px 发丝线。度量抽成 --cgpt-* 变量，规则只引用变量。
           【行语法】行是可交互面：8px 圆角 + hover 浅填充（--dsw-alias-interactive-bg-hover，
           过渡 120ms ease）；行自带 10px 横向内衬并用负 margin 抵掉 —— 文字仍压在卡面
           14px 内衬线上，hover 填充层比文字宽出内衬量（文字贴线、填充外扩）。
           【宽度铁律】宿主 .X_2TxG_page > * 已把内容钉在 min(100%, 960px)，本页不得再写 px 级 max-width。 */
        .cgpt-page {
          --cgpt-card-fill: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.05)));
          --cgpt-card-stroke: var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l4, rgba(128,128,128,0.22)));
          --cgpt-card-radius: var(--dsw-radius-xl, 20px);
          --cgpt-card-pad-block: 12px; --cgpt-card-pad-inline: 14px;
          --cgpt-card-gap: 8px; --cgpt-section-gap: 24px; --cgpt-inner-gap: 12px;
          --cgpt-control-radius: 8px;
          --cgpt-row-pad-block: 8px; --cgpt-row-pad-inline: 10px;
          --cgpt-row-gap: 16px;
          --cgpt-title-size: 14px; --cgpt-title-weight: 500; --cgpt-title-line: 20px;
          --cgpt-desc-size: 13px; --cgpt-desc-line: 18px;
          --cgpt-row-label-size: 13.5px; --cgpt-row-label-weight: 500; --cgpt-row-label-line: 20px;
          --cgpt-row-hint-size: 11.5px; --cgpt-row-hint-line: 16px;
          --cgpt-input-height: 32px; --cgpt-input-radius: var(--dsw-radius-md, 12px); --cgpt-input-pad-inline: 10px;
          --cgpt-input-bg: var(--dsw-alias-bg-layer-1);
          box-sizing: border-box; display: flex; flex-direction: column; gap: var(--cgpt-card-gap);
          width: 100%; max-width: 100%; min-width: 0; color: var(--dsw-alias-label-primary);
        }
        .cgpt-page, .cgpt-page * { box-sizing: border-box; }
        /* 设置卡：表面/描边/圆角/内衬全部取宿主 rowCard 同款 token。卡内不画任何线。 */
        .cgpt-card { display: flex; flex-direction: column; gap: var(--cgpt-inner-gap); width: 100%; max-width: 100%; min-width: 0; border: 0.5px solid var(--cgpt-card-stroke); background: var(--cgpt-card-fill); border-radius: var(--cgpt-card-radius); padding: var(--cgpt-card-pad-block) var(--cgpt-card-pad-inline); }
        /* 一级卡头（静态）：标题 + 一句话说明（说明可以是动态摘要，如已连接账号）。 */
        .cgpt-cardHead { display: flex; flex-direction: column; gap: 0; width: 100%; min-width: 0; }
        .cgpt-cardTitle { margin: 0; font-size: var(--cgpt-title-size); font-weight: var(--cgpt-title-weight); line-height: var(--cgpt-title-line); color: var(--dsw-alias-label-primary); }
        .cgpt-cardDesc { margin: 0; padding-top: 2px; font-size: var(--cgpt-desc-size); line-height: var(--cgpt-desc-line); color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
        /* 折叠卡头：左「标题 + 说明」文字块、右「展开/收起」+ 箭头；整块是一个可点击面。
           横向内衬只用于 hover 外扩 —— 文字用负 margin 压回卡面 14px 内衬线（与行同一条铁律）。 */
        .cgpt-cardDisclosure { appearance: none; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: var(--cgpt-row-gap); width: 100%; min-width: 0; margin: 0; margin-inline: calc(-1 * var(--cgpt-row-pad-inline)); padding: var(--cgpt-row-pad-block) var(--cgpt-row-pad-inline); border: 0; border-radius: var(--cgpt-control-radius); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; transition: background-color 120ms ease; }
        .cgpt-cardDisclosure:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.06)); }
        .cgpt-cardDisclosure:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
        .cgpt-cardDisclosureText { display: flex; flex-direction: column; gap: 0; min-width: 0; }
        .cgpt-cardAction { display: inline-flex; align-items: center; gap: 4px; flex: none; color: var(--dsw-alias-label-secondary); font-size: 13px; font-weight: 500; line-height: 20px; white-space: nowrap; }
        .cgpt-cardDisclosure:hover .cgpt-cardAction { color: var(--dsw-alias-label-primary); }
        /* 折叠体：grid-template-rows 0fr→1fr 参与过渡（高度本身在动），保持挂载不卸载；
           收合态三件套：0fr（无高度）+ opacity（淡出）+ visibility（不可见且不可聚焦）。 */
        .cgpt-collapse { display: grid; grid-template-rows: 0fr; width: 100%; min-width: 0; overflow: hidden; opacity: 0; visibility: hidden; contain: layout paint; transition: grid-template-rows 150ms cubic-bezier(0.4, 0, 0.2, 1), opacity 120ms ease, visibility 0s linear 150ms; }
        .cgpt-collapse--expanded { grid-template-rows: 1fr; opacity: 1; visibility: visible; transition: grid-template-rows 150ms cubic-bezier(0.4, 0, 0.2, 1), opacity 120ms ease 30ms, visibility 0s linear 0s; }
        .cgpt-collapseInner { min-width: 0; min-height: 0; overflow: visible; }
        /* 卡内正文：节与节之间只靠留白（24px），节内行组没有任何分隔线。 */
        .cgpt-body { display: flex; flex-direction: column; gap: var(--cgpt-section-gap); width: 100%; min-width: 0; }
        .cgpt-rows { display: flex; flex-direction: column; gap: 0; width: 100%; min-width: 0; }
        /* 行 = 设置卡内的标准行：左「标题 + 说明」两行堆叠（文字块 flex:1）、右控件垂直居中
           右对齐；行间只有行自带的 8px 纵向留白（相邻两行 = 16px 呼吸）。 */
        .cgpt-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--cgpt-row-gap); width: 100%; min-width: 0; margin: 0; margin-inline: calc(-1 * var(--cgpt-row-pad-inline)); padding: var(--cgpt-row-pad-block) var(--cgpt-row-pad-inline); border: 0; border-radius: var(--cgpt-control-radius); transition: background-color 120ms ease; }
        .cgpt-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.06)); }
        .cgpt-rowText { display: flex; flex-direction: column; flex: 1; gap: 2px; min-width: 0; }
        .cgpt-rowTitle { display: flex; align-items: center; gap: 6px; font-size: var(--cgpt-row-label-size); font-weight: var(--cgpt-row-label-weight); line-height: var(--cgpt-row-label-line); color: var(--dsw-alias-label-primary); }
        .cgpt-rowDesc { margin: 0; font-size: var(--cgpt-row-hint-size); line-height: var(--cgpt-row-hint-line); color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
        .cgpt-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; }
        /* 状态徽章（已连接 / 需要注意 / 待重启 / 更新失败）：软底胶囊 —— 底色由文字色派生
           （color-mix currentColor 14%），换色只改 color 一处；16px 高与行文字基线对齐。
           禁止实色底与描边色块。 */
        .cgpt-pill { display: inline-flex; align-items: center; flex: none; height: 16px; padding: 0 7px; border: 0; border-radius: 999px; background: color-mix(in srgb, currentColor 14%, transparent); color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 600; line-height: 1; white-space: nowrap; }
        .cgpt-pill--success { color: var(--dsw-alias-state-success-primary, #087f5b); }
        .cgpt-pill--danger { color: var(--dsw-alias-state-error-primary, #d92d20); }
        /* 按钮兜底几何 = 宿主 primitives Button.module.css 的 .sm + .outline（原生路径不生效）。
           走原生时只额外加 .cgpt-btn--danger（宿主没有 danger 变体），绝不叠兜底几何。 */
        .cgpt-btn { appearance: none; font: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 28px; border: 0.5px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-primary); background: transparent; border-radius: var(--dsw-radius-sm, 8px); padding: 0 10px; font-size: 12px; font-weight: 400; line-height: 18px; transition: background-color 120ms ease, border-color 120ms ease; }
        .cgpt-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08)); }
        .cgpt-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        /* 危险按钮配色照原生 .X_2TxG_danger：错误色文字 + 30% 错误色描边 + 8% 错误色 hover 底。 */
        .cgpt-btn--danger { color: var(--dsw-alias-state-error-primary, #d92d20); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d92d20) 30%, transparent); }
        .cgpt-btn--danger:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d92d20) 8%, transparent); }
        /* 语言选择器：宿主原生 Menu 弹层（锚点 = 原生 outline 按钮）。下面这几条只做布局，
           外观（边框/圆角/hover/焦点/禁用）全部由宿主 Button 维护。 */
        .cgpt-selectTrigger { max-width: 100%; }
        .cgpt-selectTrigger--open { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08)); }
        .cgpt-selectLabel { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
        .cgpt-selectValue { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cgpt-selectChevron { flex: none; color: var(--dsw-alias-label-tertiary); }
        .cgpt-selectChevronGlyph { flex: none; width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 5px solid currentColor; color: var(--dsw-alias-label-tertiary); }
        /* 兜底（宿主没有 Menu 时）：浏览器 <select>，度量照宿主 0.2.2 settings-form fields.module.css
           的 .input —— 32px / r12 / bg-layer-1；同一页所有下拉/输入框尺寸一致、右缘对齐。 */
        .cgpt-language { max-width: 100%; min-width: 0; height: var(--cgpt-input-height); padding: 0 var(--cgpt-input-pad-inline); font: inherit; font-size: 14px; line-height: 1.5; color: var(--dsw-alias-label-primary); background: var(--cgpt-input-bg); border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--cgpt-input-radius); }
        .cgpt-language:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); }
        /* disclosure 箭头：宿主图标展开态旋转 SVG 本身；两边都取不到时退回 CSS 画的箭头。
           绝不把 undefined 交给 React.createElement。 */
        .cgpt-chevron { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; flex: none; color: currentColor; pointer-events: none; }
        .cgpt-chevronIcon { display: block; width: 14px; height: 14px; transform-box: fill-box; transform-origin: center; transition: transform 160ms cubic-bezier(0.32, 0.72, 0, 1); }
        .cgpt-chevronIcon--expanded { transform: rotate(180deg); }
        .cgpt-chevronGlyph { display: block; width: 6px; height: 6px; margin-top: -3px; border-right: 1.6px solid currentColor; border-bottom: 1.6px solid currentColor; transform: rotate(45deg); transition: transform 160ms cubic-bezier(0.32, 0.72, 0, 1); }
        .cgpt-chevron[data-expanded="true"] .cgpt-chevronGlyph { transform: rotate(225deg); }
        /* 错误/提示：错误照原生 failure/reason 形态（行内 flex + 错误色 + 可任意换行）。 */
        .cgpt-alert { width: 100%; min-width: 0; margin: 0; font-size: 12px; line-height: 18px; }
        .cgpt-alert--error { display: flex; align-items: center; gap: 10px; color: var(--dsw-alias-state-error-primary, #d92d20); overflow-wrap: anywhere; white-space: pre-wrap; }
        .cgpt-alertText { flex: 1 1 auto; min-width: 0; }
        /* 页面级事实（隐私说明）：以安静的小字跟随账号卡，不独立成区块。 */
        .cgpt-note { width: 100%; margin: 0; padding: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
        .cgpt-loading { margin: 0; padding: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
        /* 更新方式兜底（宿主没有 SegmentedControl 时退回两个 role=radio 按钮）。 */
        .cgpt-mode { display: flex; flex-wrap: wrap; gap: 4px; }
        .cgpt-mode .cgpt-btn[aria-checked="true"] { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08)); border-color: var(--dsw-alias-brand-primary); }
        @media (max-width: 600px) { .cgpt-row { align-items: flex-start; } .cgpt-controls { justify-content: flex-start; margin-left: 0; } }
        @media (prefers-reduced-motion: reduce) { .cgpt-btn, .cgpt-row, .cgpt-cardDisclosure, .cgpt-collapse, .cgpt-chevronIcon, .cgpt-chevronGlyph { transition: none; } }
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

    // 状态徽章：软底胶囊（DSH 0.2.2 状态徽章语法，2026-11-13 与 dsh-bottom-info-bar 同步）。
    // 底色由文字色派生（color-mix currentColor 14%）：tone 只改 color 一处，明暗主题
    // 都不引入新的前景/背景配对。不再走宿主 Tag —— 它的 500 字重 / 10% 底 / 非 16px 高
    // 与本页状态徽章规范不同（规范钦定 600 字重、16px 高、14% 底）。
    function cgptPill(props) {
      return h('span', {
        className: 'cgpt-pill cgpt-pill--' + props.tone,
        key: props.key,
      }, props.children);
    }

    // 折叠卡头的箭头：宿主原生下箭头优先（展开态旋转 SVG 本身，跨宿主版本仍是上下方向）；
    // 导出名跟着宿主版本变过（Regular/Medium 档位 vs 旧的 14），都取不到时退回 CSS 画的箭头。
    // 绝不把 undefined 交给 React.createElement（React #130 整块白屏的教训）。
    function cgptChevron(props) {
      var glyph = NativeChevron
        ? h(NativeChevron, { size: 14, className: 'cgpt-chevronIcon' + (props.expanded ? ' cgpt-chevronIcon--expanded' : '') })
        : h('span', { className: 'cgpt-chevronGlyph', 'aria-hidden': 'true' });
      return h('span', {
        className: 'cgpt-chevron',
        'data-expanded': props.expanded ? 'true' : 'false',
        'aria-hidden': 'true',
      }, glyph);
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
      // 折叠状态：更新卡是 disclosure —— 卡头右侧「展开/收起」+ 箭头，grid 动画过渡；默认展开。
      var openState = React.useState(true), open = openState[0], setOpen = openState[1];
      if (state) {
        var latest = state.latest;
        var held = state.holdVersion && state.holdVersion === latest;
        // 方向由 host 判定（见 updateStatePayload）：update = 磁盘已是新版待重启；rollback = 用户点过回滚、
        // 磁盘比运行版本旧；downgrade = 磁盘比运行版本旧，但不是用户回滚的（插件被外部装成了旧版）。
        // 三者都只有重启才生效，但说法必须分开：把外部降级说成「已回滚」既冤枉用户又让人看不懂。
        var restartKind = cgptRestartKind(state);
        // 卡头摘要 = 状态结论一句话（一级卡头的说明位），正文只补事实与动作，不再重复结论。
        var summary = t(latest ? 'ui.updateUpToDate' : 'ui.updateErrorCheckFailed');
        if (state.disabled) summary = t('ui.updateDisabled');
        else if (phase === 'install') summary = t('ui.updateInstalling', { version: shown(latest) });
        else if (restartKind === 'update') summary = t('ui.updatePendingRestart', { version: shown(state.diskVersion) });
        else if (restartKind === 'rollback') summary = t('ui.updateRolledBack', { version: shown(state.diskVersion) });
        else if (restartKind === 'downgrade') summary = t('ui.updateDowngradePending', { version: shown(state.diskVersion), running: shown(state.runningVersion) });
        else if (state.lastError) summary = t('ui.updateFailed');
        else if (held) summary = t('ui.updateHeld', { version: state.holdVersion });
        else if (state.available && latest) summary = t('ui.updateAvailableNow', { version: latest });
        var facts = [t('ui.versionRunning', { version: shown(state.runningVersion) }), t('ui.versionLatest', { version: shown(latest) })];
        if (state.lastCheckAt) {
          var minutes = Math.max(0, Math.floor((Date.now() - state.lastCheckAt) / 60000));
          var relative = minutes < 1 ? t('ui.timeJustNow') : minutes < 60 ? t('ui.timeMinutesAgo', { n: minutes }) : minutes < 1440 ? t('ui.timeHoursAgo', { n: Math.floor(minutes / 60) }) : t('ui.timeDaysAgo', { n: Math.floor(minutes / 1440) });
          facts.push(t('ui.versionLastCheck', { time: relative }));
        }
        // 提醒以胶囊形式展示在相关行内（不做独立提醒区块）：待重启是可预期流程（中性胶囊），
        // 更新失败才用危险胶囊。底色由文字色派生，tone 只换 color 一处。
        var badges = [];
        if (!state.disabled && state.lastError) badges.push(cgptPill({ key: 'pill-failed', tone: 'danger', children: t('ui.updateFailedBadge') }));
        else if (!state.disabled && state.pendingRestart) badges.push(cgptPill({ key: 'pill-restart', tone: 'neutral', children: t('ui.updateRestartBadge') }));
        var buttons = state.disabled ? null : [cgptButton({ key: 'check', disabled: !!phase, onClick: check, children: t(phase === 'check' ? 'ui.updateChecking' : 'ui.updateCheckNow') })];
        if (buttons && state.available && latest && !held && !state.pendingRestart) buttons.push(cgptButton({ key: 'install', disabled: !!phase, onClick: function () { confirmInstall(latest, false); }, children: t('ui.updateInstallNow', { version: latest }) }));
        // 状态行说明 = 页面级事实（更新不动登录信息）+ 版本事实清单；上次动作失败时
        // 错误详情跟在事实后面（原生 failure/reason 形态），不再单独占一行。
        var stateDescNodes = [];
        if (!state.disabled) stateDescNodes.push(h('div', { className: 'cgpt-rowDesc', key: 'intro' }, t('ui.versionAndUpdateDesc')));
        stateDescNodes.push(h('div', { className: 'cgpt-rowDesc', key: 'facts' }, facts.join(' · ')));
        if (state.disabled) stateDescNodes.push(h('div', { className: 'cgpt-rowDesc', key: 'why' }, t('ui.updateDisabledWhy')));
        if (!state.disabled && state.lastError) {
          var failureKeys = { 'incomplete-download': 'ui.updateErrorIncompleteDownload', 'integrity-mismatch': 'ui.updateErrorIntegrityMismatch', 'download-failed': 'ui.updateErrorDownloadFailed', 'too-large': 'ui.updateErrorTooLarge', 'payload-mismatch': 'ui.updateErrorPayloadMismatch', 'payload-unsafe': 'ui.updateErrorPayloadUnsafe', 'check-failed': 'ui.updateErrorCheckFailed' };
          stateDescNodes.push(h('div', { className: 'cgpt-alert cgpt-alert--error', role: 'alert', key: 'failure' }, h('span', { className: 'cgpt-alertText' }, t(failureKeys[state.lastErrorKind] || 'ui.updateErrorUnknown'))));
        }
        content.push(row('state', t('ui.updateStateTitle'), null, badges.concat(buttons), stateDescNodes));
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
          // 外部降级则根本没有可回滚的对象，点了也没意义。标题位放「为什么」，动作按钮在右。
          var rollback = restartKind === 'update' || !!state.lastError;
          if (rollback || held) content.push(row('fallback', t(rollback ? 'ui.updateFallbackWhy' : 'ui.updateHoldWhy'), null, [
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
      // 更新卡 = 一张设置卡：可折叠一级卡头（标题 + 动态摘要）+ grid 动画折叠体。
      // 收合态三件套：0fr（无高度）+ visibility（不可见且不可聚焦）+ aria-hidden（读屏隐藏）。
      var headDesc = state ? summary : t(error ? 'ui.versionUnavailable' : 'ui.loading');
      return hList('section', { className: 'cgpt-card', 'aria-labelledby': 'cgpt-update-title' }, [
        hList('button', {
          type: 'button',
          className: 'cgpt-cardDisclosure',
          'aria-expanded': open,
          'aria-controls': 'cgpt-updates-content',
          onClick: function () { setOpen(!open); },
          key: 'head',
        }, [
          hList('span', { className: 'cgpt-cardDisclosureText' }, [
            h('span', { id: 'cgpt-update-title', className: 'cgpt-cardTitle', role: 'heading', 'aria-level': 2, key: 'title' }, t('ui.versionAndUpdateTitle')),
            h('span', { className: 'cgpt-cardDesc', key: 'desc' }, headDesc),
          ]),
          hList('span', { className: 'cgpt-cardAction', key: 'action' }, [
            open ? t('ui.collapse') : t('ui.expand'),
            cgptChevron({ expanded: open, key: 'chevron' }),
          ]),
        ]),
        h('div', {
          id: 'cgpt-updates-content',
          className: 'cgpt-collapse' + (open ? ' cgpt-collapse--expanded' : ''),
          'aria-hidden': open ? undefined : 'true',
          key: 'body',
        }, h('div', { className: 'cgpt-collapseInner' }, h('div', { className: 'cgpt-body' }, content))),
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
        rpc('getCodexBridgeStatus').then(function (s) { setStatus(s); }).catch(function (e) { setStatus({ ok: false, loadFailed: true, error: { message: t('ui.loadFailed') } }); });
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
      // 页面 = 三张设置卡（账号与绑定 / 语言 / 版本与更新），卡间 8px；卡内分层只靠留白。
      // 页面级事实（隐私）以安静小字跟随账号卡，不独立成区块。
      var note = h('p', { className: 'cgpt-note' }, t('ui.privacyNote'));
      var languageChoices = [{ value: 'auto', label: t('language.auto') }].concat(languageRuntime.options().map(function (language) {
        return { value: language.id, label: language.label };
      }));
      // 卡 2「语言」：卡头讲清楚跟随策略，行内左「界面语言」、右下拉；保存失败红字
      // 以行内说明展示，不做独立提醒区块。
      var languageCard = hList('section', { className: 'cgpt-card', 'aria-labelledby': 'cgpt-language-title', key: 'language-card' }, [
        hList('div', { className: 'cgpt-cardHead' }, [
          h('span', { id: 'cgpt-language-title', className: 'cgpt-cardTitle', role: 'heading', 'aria-level': 2 }, t('language.title')),
          h('div', { className: 'cgpt-cardDesc' }, t('language.description')),
        ]),
        hList('div', { className: 'cgpt-body' }, [
          hList('div', { className: 'cgpt-rows' }, [
            hList('div', { className: 'cgpt-row' }, [
              hList('div', { className: 'cgpt-rowText' }, [
                h('div', { className: 'cgpt-rowTitle' }, t('ui.interfaceLanguage')),
                languageErrorState[0] ? h('div', { className: 'cgpt-alert cgpt-alert--error', role: 'alert' }, languageErrorState[0]) : null,
              ]),
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
                })),
            ]),
          ]),
        ]),
      ]);

      // 三态：未绑定（中性引导）/ 已连接（绿）/ 需要注意（红，绑定还在但状态异常）。
      // 未绑定绝不显示红字——那不是错误，是正常起点。
      var bound = !!(status && status.bound);
      var errorMsg = status ? errorText(status.error) : '';
      var needsAttention = bound && !!errorMsg;
      var bindLabel = authorizing ? t('ui.openingBrowser') : t('ui.bind');

      var accountDesc = null;
      if (status && bound && status.account) {
        var parts = [];
        if (status.account.email) parts.push(status.account.email);
        if (status.account.plan) parts.push(t('ui.accountPlan', { plan: status.account.plan }));
        accountDesc = parts.length > 0 ? parts.join(' · ') : t('ui.accountUnavailable');
      }

      // 卡 1「账号与绑定」：一级卡头的说明位放动态摘要（当前状态一句话 + 账号信息），
      // 正文行只补细节与动作，绝不复述卡头已经说过的结论。
      // 「读不到状态」是 RPC 失败的合成状态（loadFailed 标记），不是绑定生命周期的一环。
      var bindingHeadDesc = !status
        ? t('ui.loading')
        : status.loadFailed
          ? t('ui.loadFailed')
          : !bound
            ? t('ui.statusUnbound')
            : [needsAttention ? t('ui.needsAttention') : t('ui.connected')].concat(accountDesc ? [accountDesc] : []).join(' · ');

      // 状态胶囊已经写了「已连接 / 需要注意」，出错时红字说明跟在状态行说明位，都不再复述。
      var statusDesc = !bound
        ? null
        : needsAttention
          ? null
          : (status && status.expiresAt
            ? t('ui.statusExpires', { time: fmtTime(status.expiresAt), left: fmtCountdown(status.expiresAt - Date.now()) })
            : null);

      // 状态胶囊跟账号行走（状态属于账号）；使用状态行右侧只放动作按钮，同一屏不重复结论。
      var statusControls = !bound
        ? [cgptButton({ key: 'auth', onClick: handleAuthorize, disabled: authorizing, children: bindLabel })]
        : [
          cgptButton({ key: 'reauth', onClick: handleAuthorize, disabled: authorizing, children: authorizing ? t('ui.openingBrowser') : t('ui.rebind') }),
          cgptButton({ key: 'unbind', className: 'cgpt-btn--danger', onClick: handleUnbind, children: t('ui.unbind') }),
        ];

      var bindingRows = [];
      if (status && accountDesc) {
        bindingRows.push(hList('div', { className: 'cgpt-row', key: 'account' }, [
          hList('div', { className: 'cgpt-rowText' }, [
            h('div', { className: 'cgpt-rowTitle' }, t('ui.account')),
            h('div', { className: 'cgpt-rowDesc' }, accountDesc),
          ]),
          h('div', { className: 'cgpt-controls' }, cgptPill({
            key: 'account-pill',
            tone: needsAttention ? 'danger' : 'success',
            children: needsAttention ? t('ui.needsAttention') : t('ui.connected'),
          })),
        ]));
      }
      // 红字只说清楚出了什么事：动手的按钮在同行右侧，同屏不再放第二个同样的按钮。
      bindingRows.push(hList('div', { className: 'cgpt-row', key: 'status' }, [
        hList('div', { className: 'cgpt-rowText' }, [
          h('div', { className: 'cgpt-rowTitle' }, t('ui.status')),
          needsAttention
            ? h('div', { className: 'cgpt-alert cgpt-alert--error', role: 'alert' }, h('span', { className: 'cgpt-alertText' }, errorMsg))
            : (statusDesc ? h('div', { className: 'cgpt-rowDesc' }, statusDesc) : null),
        ]),
        hList('div', { className: 'cgpt-controls' }, statusControls),
      ]));
      // 加载中时账号卡只渲染卡头（说明位 = 加载中），状态未知就不假装有正文。
      var bindingCard = hList('section', { className: 'cgpt-card', 'aria-labelledby': 'cgpt-binding-title', key: 'binding-card' }, [
        hList('div', { className: 'cgpt-cardHead' }, [
          h('span', { id: 'cgpt-binding-title', className: 'cgpt-cardTitle', role: 'heading', 'aria-level': 2 }, t('ui.bindingCardTitle')),
          h('div', { className: 'cgpt-cardDesc' }, bindingHeadDesc),
        ]),
        status ? hList('div', { className: 'cgpt-body' }, [
          hList('div', { className: 'cgpt-rows' }, bindingRows),
          note,
        ]) : null,
      ]);

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
        bindingCard,
        languageCard,
        h(SubscriptionUpdates),
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
