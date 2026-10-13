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
        .cgpt-language { max-width: 100%; min-width: 0; font: inherit; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-background-primary, transparent); border: 1px solid var(--dsw-alias-border-l3); border-radius: 6px; padding: 5px 8px; }
        .cgpt-page { display: flex; flex-direction: column; width: 100%; max-width: 100%; min-width: 0; gap: 12px; color: var(--dsw-alias-label-primary); }
        .cgpt-page, .cgpt-page * { box-sizing: border-box; }
        /* 行 = 原生详情页的 .X_2TxG_row：12px 2px 内边距 + .5px 下边线（末行无线），
           无圆角、无 hover 填充、无负外边距。分隔靠边线，所以列表 gap 为 0。 */
        .cgpt-list { display: flex; flex-direction: column; gap: 0; width: 100%; min-width: 0; }
        .cgpt-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; width: 100%; min-width: 0; margin: 0; padding: 12px 2px; border: 0; border-bottom: 0.5px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.16)); border-radius: 0; }
        .cgpt-row:first-child { padding-top: 0; }
        .cgpt-row:last-child { padding-bottom: 0; border-bottom: 0; }
        .cgpt-rowText { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
        .cgpt-rowTitle { display: flex; align-items: center; gap: 6px; font-size: 13.5px; font-weight: 500; line-height: 20px; color: var(--dsw-alias-label-primary); }
        .cgpt-rowDesc { font-size: 11.5px; line-height: 16px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
        .cgpt-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; margin-left: auto; }
        .cgpt-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: var(--dsw-alias-state-success-primary, #087f5b); }
        .cgpt-dot--error { background: var(--dsw-alias-state-error-primary, #d92d20); }
        /* 状态药丸：与 .cgpt-btn 完全同一套几何（28px 高 / 14px 圆角 / 10px 内边距 / 12px 字），
           只是不可点——保证状态、重新绑定、解绑三个元素同屏等高对齐。 */
        .cgpt-statusPill { display: inline-flex; align-items: center; gap: 6px; height: 28px; border-radius: 14px; padding: 0 10px; font-size: 12px; font-weight: 400; line-height: 18px; white-space: nowrap; }
        .cgpt-statusPill--success { color: var(--dsw-alias-state-success-primary, #087f5b); background: color-mix(in srgb, var(--dsw-alias-state-success-primary, #087f5b) 10%, transparent); }
        .cgpt-statusPill--danger { color: var(--dsw-alias-state-error-primary, #d92d20); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d92d20) 10%, transparent); }
        /* 按钮：宿主有原生 Button 时由其接管；这份只是兜底几何（Button.module.css .sm）。 */
        .cgpt-btn { appearance: none; font: inherit; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 28px; border: 0.5px solid var(--dsw-alias-border-l3); color: var(--dsw-alias-label-primary); background: transparent; border-radius: 14px; padding: 0 10px; font-size: 12px; font-weight: 400; line-height: 18px; transition: background-color 120ms ease, border-color 120ms ease; }
        .cgpt-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08)); }
        .cgpt-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
        .cgpt-btn:disabled { opacity: 0.4; cursor: default; }
        /* 危险按钮照原生 .X_2TxG_danger：错误色文字 + 30% 错误色描边 + 8% 错误色 hover 底。 */
        .cgpt-btn--danger { color: var(--dsw-alias-state-error-primary, #d92d20); border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d92d20) 30%, transparent); }
        .cgpt-btn--danger:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d92d20) 8%, transparent); }
        /* 错误提示：照原生 failure/reason 形态 */
        .cgpt-alerts { display: flex; flex-direction: column; gap: 12px; width: 100%; min-width: 0; padding: 0; }
        .cgpt-alert { width: 100%; min-width: 0; margin: 0; font-size: 12px; line-height: 18px; }
        /* 错误：照原生 .X_2TxG_failure（行内 flex + 错误色 + gap 10）+ .X_2TxG_reason（12/18 可换行）。 */
        .cgpt-alert--error { display: flex; align-items: center; gap: 10px; color: var(--dsw-alias-state-error-primary, #d92d20); overflow-wrap: anywhere; white-space: pre-wrap; }
        .cgpt-alertText { flex: 1 1 auto; min-width: 0; }
        .cgpt-note { width: 100%; margin: 0; padding: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }
        .cgpt-updates { width: 100%; min-width: 0; border-top: 1px solid var(--dsw-alias-border-primary, rgba(128,128,128,0.2)); padding-top: 16px; }
        .cgpt-updateMode { display: flex; flex-wrap: wrap; gap: 4px; }
        .cgpt-btn[aria-checked="true"] { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08)); border-color: var(--dsw-alias-brand-primary); }
        .cgpt-loading { margin: 0; padding: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
        @media (max-width: 600px) { .cgpt-row { align-items: flex-start; } .cgpt-controls { justify-content: flex-start; margin-left: 0; } }
        @media (prefers-reduced-motion: reduce) { .cgpt-btn { transition: none; } }
      `;
      document.head.appendChild(style);
    }
    installStyles();

    // 按钮：优先宿主原生 Button（.sm 与插件详情页的「卸载」同一套几何）
    function cgptButton(props) {
      var className = 'cgpt-btn' + (props.className ? ' ' + props.className : '');
      if (NativeButton) {
        return h(NativeButton, {
          type: 'button',
          variant: props.variant || 'outline',
          size: 'sm',
          className: className,
          role: props.role,
          'aria-checked': props.checked,
          disabled: props.disabled,
          onClick: props.onClick,
          key: props.key,
        }, props.children);
      }
      return h('button', {
        type: 'button',
        className: className,
        role: props.role,
        'aria-checked': props.checked,
        disabled: props.disabled,
        onClick: props.onClick,
        key: props.key,
      }, props.children);
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
      function confirmInstall(version) {
        return typeof version === 'string' && version.length > 0 && confirm(t('ui.updateConfirm', { version: version }));
      }
      function check() {
        action('checkUpdate', null, 'check').then(function (result) {
          if (active.current && result && result.available && !result.pendingRestart && result.holdVersion !== result.latest && confirmInstall(result.latest)) {
            action('installUpdate', null, 'install');
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
      function row(key, title, description, controls) {
        return h('div', { className: 'cgpt-row', key: key },
          h('div', { className: 'cgpt-rowText' },
            title ? h('div', { className: 'cgpt-rowTitle' }, title) : null,
            description ? h('div', { className: 'cgpt-rowDesc' }, description) : null),
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
        if (buttons && state.available && latest && !held && !state.pendingRestart) buttons.push(cgptButton({ key: 'install', disabled: !!phase, onClick: function () { if (confirmInstall(latest)) action('installUpdate', null, 'install'); }, children: t('ui.updateInstallNow', { version: latest }) }));
        content.push(row('state', statusText, state.disabled ? t('ui.updateDisabledWhy') : facts.join(' · '), buttons));
        if (!state.disabled && state.lastError) {
          var errors = { 'incomplete-download': 'ui.updateErrorIncompleteDownload', 'integrity-mismatch': 'ui.updateErrorIntegrityMismatch', 'download-failed': 'ui.updateErrorDownloadFailed', 'too-large': 'ui.updateErrorTooLarge', 'payload-mismatch': 'ui.updateErrorPayloadMismatch', 'payload-unsafe': 'ui.updateErrorPayloadUnsafe', 'check-failed': 'ui.updateErrorCheckFailed' };
          content.push(row('failure', null, t(errors[state.lastErrorKind] || 'ui.updateErrorUnknown')));
        }
        if (!state.disabled) {
          content.push(row('mode', t('ui.autoUpdateTitle'), t(state.autoUpdate === false ? 'ui.updateModeManualDesc' : 'ui.updateModeAutoDesc'), [
            h('div', { className: 'cgpt-updateMode', role: 'radiogroup', 'aria-label': t('ui.autoUpdateTitle'), key: 'modes' },
              ['auto', 'manual'].map(function (mode) { return cgptButton({ key: mode, disabled: !!phase, role: 'radio', checked: (state.autoUpdate === false ? 'manual' : 'auto') === mode, onClick: function () { action('setUpdateAuto', { enabled: mode === 'auto' }, 'mode'); }, children: t(mode === 'auto' ? 'ui.updateModeAuto' : 'ui.updateModeManual') }); }))
          ]));
          // 逃生门只在新版已装好但还没重启（restartKind === 'update'，此时退回最省事）或上次更新失败时出现。
          // 磁盘已经比运行中旧（'rollback' / 'downgrade'）时不再显示：回滚过的那次 pendingVersion 已清空，
          // 外部降级则根本没有可回滚的对象，点了也没意义。
          var rollback = restartKind === 'update' || !!state.lastError;
          if (rollback || held) content.push(row('fallback', null, t(rollback ? 'ui.updateFallbackWhy' : 'ui.updateHoldWhy'), [
            rollback ? cgptButton({ key: 'rollback', disabled: !!phase, onClick: function () { action('rollbackUpdate', null, 'rollback'); }, children: t('ui.updateRollback') }) : null,
            held ? cgptButton({ key: 'force', disabled: !!phase, onClick: function () { if (confirmInstall(state.holdVersion)) action('installUpdate', { force: true }, 'install'); }, children: t('ui.updateAllowHeld', { version: state.holdVersion }) }) : null,
          ]));
        }
      } else content.push(h('p', { className: 'cgpt-loading', key: 'loading' }, t(error ? 'ui.versionUnavailable' : 'ui.loading')));
      if (error) content.push(h('p', { className: 'cgpt-alert cgpt-alert--error', role: 'alert', key: 'error' }, t(error)));
      return h('section', { className: 'cgpt-updates', 'aria-labelledby': 'cgpt-update-title' },
        h('h2', { id: 'cgpt-update-title', className: 'cgpt-rowTitle' }, t('ui.versionAndUpdateTitle')),
        h('p', { className: 'cgpt-rowDesc' }, t('ui.versionAndUpdateDesc')),
        hList('div', { className: 'cgpt-list' }, content));
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
            alert(t('ui.startFailed') + (errorText(res.error) || t('ui.unknownReason')));
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
          alert(t('ui.startError') + e.message);
          setAuthorizing(false);
        });
      }, [authorizing]);

      // 解绑
      var handleUnbind = React.useCallback(function () {
        if (!confirm(t('ui.unbindConfirm'))) return;
        rpc('unbindCodex').then(function (res) {
          if (res.ok) { load(); } else { alert(t('ui.unbindFailed') + (errorText(res.error) || t('ui.retry'))); }
        });
      }, [load]);

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
      var languageRow = h('div', { className: 'cgpt-row', key: 'language' },
        h('div', { className: 'cgpt-rowText' },
          h('label', { className: 'cgpt-rowTitle', htmlFor: 'cgpt-language' }, t('language.title')),
          h('div', { className: 'cgpt-rowDesc' }, t('language.description'))),
        h('div', { className: 'cgpt-controls' },
          h('select', {
            id: 'cgpt-language', value: languageRuntime.preference(), className: 'cgpt-language',
            onChange: function (event) {
              try { languageRuntime.setPreference(event.target.value); languageErrorState[1](null); }
              catch { languageErrorState[1](t('language.saveFailed')); }
            },
          }, h('option', { value: 'auto' }, t('language.auto')),
            languageRuntime.options().map(function (language) { return h('option', { key: language.id, value: language.id }, language.label); }))));


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
          h('span', { className: 'cgpt-statusPill ' + (needsAttention ? 'cgpt-statusPill--danger' : 'cgpt-statusPill--success'), key: 'state' },
            h('span', { className: 'cgpt-dot' + (needsAttention ? ' cgpt-dot--error' : '') }),
            needsAttention ? t('ui.needsAttention') : t('ui.connected')),
          cgptButton({ key: 'reauth', className: '', onClick: handleAuthorize, disabled: authorizing, children: authorizing ? t('ui.openingBrowser') : t('ui.rebind') }),
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

      return hList('div', { className: 'cgpt-page' }, [
        hList('div', { className: 'cgpt-list' }, rows),
        alerts.length > 0 ? hList('div', { className: 'cgpt-alerts' }, alerts) : null,
        languageErrorState[0] ? h('p', { className: 'cgpt-alert cgpt-alert--error', role: 'alert' }, languageErrorState[0]) : null,
        h(SubscriptionUpdates),
        note,
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
