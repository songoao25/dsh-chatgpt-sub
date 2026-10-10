window.__ModuleLoader__.load({ id: "dsh-chatgpt-sub", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
// dsh-chatgpt-sub — client half：插件详情页的订阅配置
// 文案全部收在下面这份 zh / en 字典里，注册进 DSH 的 locale 服务后跟随界面语言。
// 铁律：取文案绝不能让渲染抛错——配置页整块消失过一次，根因就是未在 inject 里声明 locale 就访问
// ctx.locale（cordis 对未声明的服务属性直接抛 cannot get property "locale" without inject）。
const LOCALE_NAMESPACE = 'dsh-chatgpt-sub';
const LOCALES = {"zh":{"meta.title":"ChatGPT 订阅","meta.description":"用 ChatGPT 账号登录，在 DSH 里使用 ChatGPT 模型。","ui.loading":"加载中…","ui.loadFailed":"读不到状态，刷新页面重试。","ui.startFailed":"没法开始绑定：","ui.startError":"绑定时出错：","ui.unbindFailed":"解绑失败：","ui.unknownReason":"未知原因","ui.retry":"请重试","ui.bind":"绑定 ChatGPT 账号","ui.openingBrowser":"正在打开浏览器…","ui.rebind":"重新绑定","ui.unbind":"解绑","ui.unbindConfirm":"确定解绑此账号？之后需要在本插件中重新绑定才能继续使用。共用的 Codex 登录文件会保留。","ui.connected":"已连接","ui.needsAttention":"需要注意","ui.account":"绑定账号","ui.accountPlan":"{plan} 套餐","ui.accountUnavailable":"暂时读不到账号信息。","ui.status":"使用状态","ui.statusUnbound":"还没登录。","ui.statusExpires":"有效期到 {time}（还剩 {left}）","ui.expired":"已到期","ui.privacyNote":"登录信息保存在本机，仅随授权和模型请求发送给 OpenAI 官方服务。","error.route.dsh-not-ready":"DSH 还没准备好，稍后会自动再试一次","error.route.occupied":"DSH 里已经有一条同名的 ChatGPT 通道，那是你自己配置的，本插件不会改动它。\n如果想交给本插件管理，请先删除那一条，再点「重新绑定」。","error.route.create-failed":"ChatGPT 通道没建起来，稍后会自动再试一次","error.route.unknown":"ChatGPT 通道暂时建不起来，稍后会自动再试一次","error.default-model.dsh-not-ready":"DSH 还没准备好，暂时没法把默认模型切成 ChatGPT","error.default-model.unknown":"没能切换默认模型，请在「模型」设置里选一次 ChatGPT。","error.sync.exception":"同步时出了点问题，稍后会自动再试一次","error.unbind.route-cleanup":"解绑后没清理干净，稍后会自动再试一次","error.state.unbound":"尚未绑定 ChatGPT 账号。","error.state.unbound-dirty":"尚未绑定，之前留下的登录信息也没清掉。","error.state.stale-route":"绑定已经失效，而且通道没清理干净","error.state.no-login":"找不到登录信息了。","error.state.no-login-dirty":"登录信息不见了，旧信息也没清掉。","error.state.stale-route-failed":"绑定失效且路由清理失败","error.state.incomplete":"登录信息不完整。","error.state.incomplete-dirty":"登录信息不完整，旧信息也没清掉。","error.token.expiring":"登录快到期了，而且没法自动续期。","error.token.refresh-write-failed":"已续期，但没能存到本地。下次可能要重新绑定。","error.token.refresh-failed":"自动续期失败。","error.token.invalid-dirty":"登录信息用不了，旧信息也没清掉。","error.credentials.conflict":"DSH 里存着另一个 OpenAI 账号的登录信息，不是本插件刚绑定的这个，所以本插件不会动它。\n如果你确实想用刚绑定的账号，请先到 DSH 的凭据设置里删掉那一条，再回来点「重新绑定」。","error.credentials.sync-failed":"登录信息同步到 DSH 失败，请重试或重新绑定","error.credentials.sync-failed-dirty":"登录信息同步失败，且旧信息清理也未成功，请重新绑定","error.oauth.timeout":"等了 5 分钟没有结果，已取消。","error.oauth.exchange-http":"授权完成，但没取到登录信息（网络返回 {status}）。请重试。","error.oauth.exchange-network":"授权完成，但没取到登录信息（连不上网络）。请重试。","error.oauth.write-failed":"登录成功，但没能存到本地。","error.oauth.default-model-manual":"绑定成功，但没设为默认模型。请到「模型」设置里选一次 ChatGPT。","error.oauth.flag-write-failed":"绑定成功，但状态没存住。","error.oauth.credentials-failed":"绑定失败：登录信息没能交给 DSH。","error.oauth.exception":"绑定时出了点问题。","error.oauth.in-flight":"正在等浏览器里的授权完成，请稍候。","error.oauth.port-busy":"本机 {port} 端口被别的程序占了。请关掉它（比如正在登录的 Codex 命令行），再重试","error.unbind.in-flight":"授权还在进行中，请先完成或等它超时。","error.unbind.done":"已经解除绑定","error.unbind.exception":"解绑失败。","language.title":"语言","language.description":"跟随 DSH，或在此浏览器中单独选择本插件的语言。","language.auto":"跟随 DSH","language.saveFailed":"语言选择未能保存，请允许本地存储后重试。","oauth.invalidAddress":"授权回调地址无效","oauth.notFound":"回调路径不存在","oauth.invalidState":"授权状态校验失败，请重试。","oauth.missingCode":"缺少授权码","oauth.complete":"授权已完成，可以关闭此页。","oauth.hint":"你可以关闭此页面，返回 DSH 继续。"},"en":{"meta.title":"ChatGPT Subscription","meta.description":"Sign in with your ChatGPT account to use ChatGPT models in DSH.","ui.loading":"Loading…","ui.loadFailed":"Could not read the status. Refresh the page.","ui.startFailed":"Could not start sign-in: ","ui.startError":"Sign-in failed: ","ui.unbindFailed":"Could not unbind: ","ui.unknownReason":"unknown reason","ui.retry":"try again","ui.bind":"Sign in with ChatGPT","ui.openingBrowser":"Opening the browser…","ui.rebind":"Sign in again","ui.unbind":"Unbind","ui.unbindConfirm":"Unbind this account? You will need to sign in through this plugin again. The shared Codex sign-in file is kept.","ui.connected":"Connected","ui.needsAttention":"Needs attention","ui.account":"Account","ui.accountPlan":"{plan} plan","ui.accountUnavailable":"Account details are unavailable right now.","ui.status":"Status","ui.statusUnbound":"Not signed in yet.","ui.statusExpires":"Valid until {time} ({left} left)","ui.expired":"expired","ui.privacyNote":"Sign-in data is stored locally and sent only to official OpenAI services for authorization and model requests.","error.route.dsh-not-ready":"DSH is not ready yet. This will retry automatically.","error.route.occupied":"DSH already has a ChatGPT provider with this name, configured by you. This plugin leaves it alone.\nTo let this plugin manage it, delete that entry first, then click \"Sign in again\".","error.route.create-failed":"The ChatGPT provider could not be created. This will retry automatically.","error.route.unknown":"The ChatGPT provider is not available right now. This will retry automatically.","error.default-model.dsh-not-ready":"DSH is not ready yet, so the default model could not be switched to ChatGPT.","error.default-model.unknown":"The default model was not switched. Pick ChatGPT in the Models settings.","error.sync.exception":"Something went wrong while syncing. This will retry automatically.","error.unbind.route-cleanup":"The provider was not fully cleaned up after unbinding. This will retry automatically.","error.state.unbound":"No ChatGPT account is bound.","error.state.unbound-dirty":"No account is bound, and the sign-in data left behind was not removed.","error.state.stale-route":"The sign-in is no longer valid, and the provider was not fully cleaned up.","error.state.no-login":"The sign-in data is gone.","error.state.no-login-dirty":"The sign-in data is gone, and the old data was not removed.","error.state.stale-route-failed":"The sign-in is invalid and the provider could not be cleaned up.","error.state.incomplete":"The sign-in data is incomplete.","error.state.incomplete-dirty":"The sign-in data is incomplete, and the old data was not removed.","error.token.expiring":"The sign-in is about to expire and cannot be refreshed automatically.","error.token.refresh-write-failed":"Refreshed, but it could not be saved locally. You may need to sign in again.","error.token.refresh-failed":"The automatic refresh failed.","error.token.invalid-dirty":"The sign-in data is unusable, and the old data was not removed.","error.credentials.conflict":"DSH holds sign-in data for a different OpenAI account, not the one just bound, so this plugin leaves it untouched.\nTo use the account you just bound, delete that entry in the DSH credentials settings first, then click \"Sign in again\".","error.credentials.sync-failed":"The sign-in data could not be handed to DSH. Try again or sign in again.","error.credentials.sync-failed-dirty":"The sign-in data could not be synced, and the old data was not cleaned up. Please sign in again.","error.oauth.timeout":"Timed out after 5 minutes.","error.oauth.exchange-http":"Authorization finished, but no sign-in data came back (HTTP {status}). Try again.","error.oauth.exchange-network":"Authorization finished, but no sign-in data came back (no network). Try again.","error.oauth.write-failed":"Signed in, but it could not be saved locally.","error.oauth.default-model-manual":"Bound, but the default model was not switched. Pick ChatGPT in the Models settings.","error.oauth.flag-write-failed":"Bound, but the state could not be saved.","error.oauth.credentials-failed":"Binding failed: the sign-in data could not be handed to DSH.","error.oauth.exception":"Something went wrong while signing in.","error.oauth.in-flight":"Waiting for the browser sign-in to finish.","error.oauth.port-busy":"Port {port} on this machine is taken by another program. Close it (for example a Codex CLI login) and try again.","error.unbind.in-flight":"Sign-in is still in progress. Finish it first, or wait for the timeout.","error.unbind.done":"Unbound.","error.unbind.exception":"Unbinding failed.","language.title":"Language","language.description":"Follow DSH or choose a language for this plugin in this browser.","language.auto":"Follow DSH","language.saveFailed":"Could not save the language preference. Allow local storage and try again.","oauth.invalidAddress":"Invalid authorization callback address","oauth.notFound":"Callback path not found","oauth.invalidState":"Authorization state check failed. Please try again.","oauth.missingCode":"Missing authorization code","oauth.complete":"Authorization complete. You can close this page.","oauth.hint":"You can close this page and return to DSH."}};
function createLanguageRuntime(namespace, dictionaries, service, environment) {
  const env = environment || (typeof window !== 'undefined' ? window : {});
  const storageKey = namespace + ':language';
  const listeners = new Set();
  const labels = {
    zh: '简体中文', 'zh-hant': '繁體中文', en: 'English', ja: '日本語', ko: '한국어',
    es: 'Español', pt: 'Português', fr: 'Français', de: 'Deutsch', it: 'Italiano',
    ru: 'Русский', hi: 'हिन्दी', id: 'Bahasa Indonesia',
  };
  function normalize(tag) {
    const value = String(tag || '').toLowerCase().replace(/_/g, '-');
    if (/^zh-(hant|tw|hk|mo)(-|$)/.test(value)) return dictionaries['zh-hant'] ? 'zh-hant' : 'zh';
    if (dictionaries[value]) return value;
    const base = value.split('-')[0];
    return dictionaries[base] ? base : undefined;
  }
  function readPreference() {
    try {
      const saved = env.localStorage && env.localStorage.getItem(storageKey);
      return saved && Object.hasOwn(dictionaries, saved) ? saved : 'auto';
    } catch { return 'auto'; }
  }
  let preference = readPreference();
  let bound;
  try { bound = service && typeof service.bind === 'function' ? service.bind(namespace) : undefined; } catch { /* fall back to dictionaries */ }
  function hostLanguage() {
    try {
      const snapshot = service && (typeof service.getSnapshot === 'function' ? service.getSnapshot()
        : typeof service.getLocale === 'function' ? service.getLocale() : undefined);
      return snapshot && typeof snapshot.active === 'string' ? snapshot.active : undefined;
    } catch { return undefined; }
  }
  function browserLanguage() {
    const nav = env.navigator || (typeof navigator !== 'undefined' ? navigator : {});
    for (const tag of nav.languages && nav.languages.length ? nav.languages : [nav.language]) {
      const language = normalize(tag);
      if (language) return language;
    }
    return 'en';
  }
  function activeLanguage() {
    if (preference !== 'auto') return preference;
    const host = hostLanguage();
    return host ? normalize(host) || 'en' : browserLanguage();
  }
  function format(template, params) {
    return String(template).replace(/\{(\w+)\}/g, (match, key) =>
      params && Object.hasOwn(params, key) ? String(params[key]) : match);
  }
  function translate(key, params) {
    // Legacy hosts without snapshots still expose their active language through bind().
    if (preference === 'auto' && !hostLanguage() && bound) {
      try {
        const text = bound(key, params);
        if (typeof text === 'string' && text && text !== key) return format(text, params);
      } catch { /* use the local dictionary */ }
    }
    const dictionary = dictionaries[activeLanguage()] || dictionaries.en;
    return format(dictionary[key] ?? dictionaries.en[key] ?? key, params);
  }
  function notify() { listeners.forEach(listener => listener()); }
  function setPreference(value) {
    if (value !== 'auto' && !Object.hasOwn(dictionaries, value)) throw new Error('Unsupported language');
    // A failed write must not look like a saved preference.
    const storage = env.localStorage;
    if (!storage) throw new Error(translate('language.saveFailed'));
    if (value === 'auto') storage.removeItem(storageKey);
    else storage.setItem(storageKey, value);
    preference = value;
    notify();
  }
  function onStorage(event) {
    if (event.key !== storageKey && event.key !== null) return;
    preference = readPreference();
    notify();
  }
  let unsubscribeHost;
  try { if (service && typeof service.subscribe === 'function') unsubscribeHost = service.subscribe(notify); } catch { /* legacy host */ }
  if (typeof env.addEventListener === 'function') env.addEventListener('storage', onStorage);
  return {
    t: translate, locale: activeLanguage, normalize, preference: () => preference,
    options: () => Object.keys(labels).filter(id => dictionaries[id]).map(id => ({ id, label: labels[id] })),
    setPreference,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    dispose() {
      if (typeof unsubscribeHost === 'function') unsubscribeHost();
      if (typeof env.removeEventListener === 'function') env.removeEventListener('storage', onStorage);
      listeners.clear();
    },
  };
}
module.exports = {
  // slots：配置页槽位；locale：页面文案的中英字典（不声明就用不了 ctx.locale）
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
    const MUTATING_RPC = { startCodexOAuth: true, unbindCodex: true };
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
          disabled: props.disabled,
          onClick: props.onClick,
          key: props.key,
        }, props.children);
      }
      return h('button', {
        type: 'button',
        className: className,
        disabled: props.disabled,
        onClick: props.onClick,
        key: props.key,
      }, props.children);
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

return module.exports;
} });
