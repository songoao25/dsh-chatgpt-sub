import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { LOCALES } from '../src/locales.js';
const source = readFileSync(new URL('../src/host.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function startOAuthCallbackServer('), source.indexOf('// ============================================================================', source.indexOf('function respondOAuthPage(')));
const start = new Function('createServer', 'LOCALES', 'OAUTH_CALLBACK_PATH', functions + '\nreturn startOAuthCallbackServer;')(createServer, LOCALES, '/auth/callback');
const handled = [];
// An ephemeral test-only port avoids the production callback and real sign-in data.
const callback = await start('synthetic-state', code => { handled.push(code); return { ok: true }; }, 0, 'pt-BR');
assert.ok(callback);
const url = 'http://127.0.0.1:' + callback.server.address().port;
try {
  for (const [path, status, key] of [
    ['/other', 404, 'oauth.notFound'],
    ['/auth/callback?state=wrong&code=synthetic-code', 400, 'oauth.invalidState'],
    ['/auth/callback?state=synthetic-state', 400, 'oauth.missingCode'],
    ['/auth/callback?state=synthetic-state&code=synthetic-code', 200, 'oauth.complete'],
    ['/auth/callback?state=synthetic-state&code=synthetic-code', 409, 'oauth.invalidState'],
  ]) {
    const response = await fetch(url + path);
    const html = await response.text();
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(html.includes('lang="pt"'));
    assert.ok(html.includes(LOCALES.pt[key]));
    assert.ok(!html.includes('synthetic-state') && !html.includes('synthetic-code'), 'callback data never enters the page');
  }
  assert.deepEqual(handled, ['synthetic-code'], 'invalid callbacks cannot complete sign-in');
} finally { callback.server.closeAllConnections(); await new Promise(resolve => callback.server.close(resolve)); }
const render = new Function('LOCALES', functions + '\nreturn respondOAuthPage;')(LOCALES);
for (const language of [...Object.keys(LOCALES), 'zh-TW', '<script>']) {
  const res = { setHeader() {}, end(html) { this.html = html; } };
  render(res, 200, 'oauth.complete', language);
  const expected = language === 'zh-TW' ? 'zh-hant' : Object.hasOwn(LOCALES, language) ? language : 'en';
  assert.ok(res.html.includes('lang="' + expected + '"'));
  assert.ok(!res.html.includes('<script>'));
}
console.log('localized OAuth callbacks, state rejection and safe HTML: PASS');

// Exercise the built plugin through real loopback RPC/callback HTTP, without
// launching a browser or contacting OpenAI or reading a user's sign-in files.
const { mkdtempSync, mkdirSync, rmSync, existsSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const originalFetch = globalThis.fetch;
const temporary = mkdtempSync(join(tmpdir(), 'subscription-oauth-'));
const envNames = ['DSH_CHATGPT_DATA_DIR', 'DSH_CHATGPT_AUTH', 'DSH_CHATGPT_BIND_FILE', 'DSH_CHATGPT_SELF_UPDATE', 'DSH_CHATGPT_OAUTH_PORT', 'DSH_CHATGPT_OAUTH_TIMEOUT_MS'];
const oldEnvironment = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
try {
  for (const scenario of ['success', 'exchange-failure', 'write-failure', 'credentials-failure', 'timeout']) {
    const directory = join(temporary, scenario);
    mkdirSync(directory);
    process.env.DSH_CHATGPT_DATA_DIR = directory;
    process.env.DSH_CHATGPT_AUTH = join(directory, 'codex', 'auth.json');
    process.env.DSH_CHATGPT_BIND_FILE = join(directory, 'binding.json');
    process.env.DSH_CHATGPT_SELF_UPDATE = 'off';
    process.env.DSH_CHATGPT_OAUTH_TIMEOUT_MS = scenario === 'timeout' ? '350' : '5000';
    if (scenario === 'write-failure') mkdirSync(process.env.DSH_CHATGPT_AUTH, { recursive: true });
    const portProbe = createServer();
    await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
    process.env.DSH_CHATGPT_OAUTH_PORT = String(portProbe.address().port);
    await new Promise(resolve => portProbe.close(resolve));
    let route;
    let exchangeCount = 0;
    let credential;
    let selection = { provider: 'deepseek-official', model: 'synthetic-model' };
    const sections = { 'llm-pi-ai': { providers: {} } };
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), 'https://auth.openai.com/oauth/token');
      assert.equal(new URLSearchParams(options.body).get('code'), 'synthetic-code');
      exchangeCount++;
      return scenario === 'exchange-failure' ? new Response('{}', { status: 403 }) :
        new Response(JSON.stringify({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh' }));
    };
    const plugin = (await import('../lib/index.js?oauth=' + scenario)).default;
    plugin.apply({
      // Simulate an OS browser command that never reports completion.
      shell: { run: () => new Promise(() => {}) },
      credentials: {
        resolve: async () => undefined,
        set: async (_name, value) => { if (scenario === 'credentials-failure') throw new Error('synthetic'); credential = value; },
        unset: async () => { credential = undefined; },
      },
      settings: {
        describe: () => Object.entries(sections).map(([ns, value]) => ({ ns, value })),
        mutate: async (ns, operations) => {
          for (const operation of operations) {
            if (operation.op === 'set') sections[ns].providers['openai-codex'] = operation.value;
            else delete sections[ns].providers['openai-codex'];
          }
        },
      },
      get: name => name === 'agentDefaultModel' ? {
        currentSelection: () => selection,
        saveSelection: async value => { selection = value; },
      } : undefined,
      interval() {},
      inject(_names, fn) { fn({ connection: { requestRejection() {} }, effect: fn => fn(), webServer: { register(value) { route = value; } } }); },
    });
    const rpcServer = createServer(route.handler);
    await new Promise(resolve => rpcServer.listen(0, '127.0.0.1', resolve));
    const base = 'http://127.0.0.1:' + rpcServer.address().port + route.path + '/';
    try {
      const started = await (await originalFetch(base + 'startCodexOAuth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"language":"en"}' })).json();
      assert.equal(started.ok, true);
      const authorize = new URL(started.authorizeUrl);
      if (scenario !== 'timeout') {
        const callbackUrl = new URL(authorize.searchParams.get('redirect_uri'));
        callbackUrl.hostname = '127.0.0.1';
        callbackUrl.searchParams.set('state', authorize.searchParams.get('state'));
        callbackUrl.searchParams.set('code', 'synthetic-code');
        const response = await originalFetch(callbackUrl, { signal: AbortSignal.timeout(2000) });
        const html = await response.text();
        assert.equal(response.status, scenario === 'success' ? 200 : 500, scenario + ': browser reports final binding result');
        assert.equal(html.includes(LOCALES.en['oauth.complete']), scenario === 'success', scenario + ': no premature success');
        assert.ok(!html.includes('synthetic-code') && !html.includes('synthetic-access'));
      } else {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      const status = await (await originalFetch(base + 'getCodexBridgeStatus')).json();
      assert.equal(status.oauthInFlight, false, scenario + ': flow settles even if browser command hangs');
      assert.equal(status.bound, scenario === 'success', scenario + ': binding persisted');
      if (scenario === 'success') {
        assert.equal(status.ok, true);
        assert.ok(existsSync(process.env.DSH_CHATGPT_AUTH), 'first sign-in creates auth parent');
        assert.equal(credential, 'synthetic-access');
        assert.equal(selection.provider, 'openai-codex');
      } else {
        const expected = { 'exchange-failure': 'oauth.exchange-http', 'write-failure': 'oauth.write-failed', 'credentials-failure': 'oauth.credentials-failed', timeout: 'oauth.timeout' }[scenario];
        assert.equal(status.error.code, expected);
        assert.equal(credential, undefined);
        assert.equal(selection.provider, 'deepseek-official');
        assert.equal(sections['llm-pi-ai'].providers['openai-codex'], undefined);
        if (scenario === 'credentials-failure') assert.equal(existsSync(process.env.DSH_CHATGPT_AUTH), false, 'failed binding rolls back newly saved auth');
      }
      assert.equal(exchangeCount, scenario === 'timeout' ? 0 : 1);
    } finally {
      rpcServer.closeAllConnections();
      await new Promise(resolve => rpcServer.close(resolve));
    }
  }
  console.log('OAuth completion, stalled browser opener, timeout and rollback: PASS');
} finally {
  globalThis.fetch = originalFetch;
  for (const name of envNames) if (oldEnvironment[name] === undefined) delete process.env[name]; else process.env[name] = oldEnvironment[name];
  rmSync(temporary, { recursive: true, force: true });
}
