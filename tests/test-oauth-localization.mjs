import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { LOCALES } from '../src/locales.js';
const source = readFileSync(new URL('../src/host.js', import.meta.url), 'utf8');
const functions = source.slice(source.indexOf('function startOAuthCallbackServer('), source.indexOf('// ============================================================================', source.indexOf('function respondOAuthPage(')));
const start = new Function('createServer', 'LOCALES', 'OAUTH_CALLBACK_PATH', functions + '\nreturn startOAuthCallbackServer;')(createServer, LOCALES, '/auth/callback');
const handled = [];
// An ephemeral test-only port avoids the production callback and real sign-in data.
const callback = await start('synthetic-state', code => handled.push(code), 0, 'pt-BR');
assert.ok(callback);
const url = 'http://127.0.0.1:' + callback.server.address().port;
try {
  for (const [path, status, key] of [
    ['/other', 404, 'oauth.notFound'],
    ['/auth/callback?state=wrong&code=synthetic-code', 400, 'oauth.invalidState'],
    ['/auth/callback?state=synthetic-state', 400, 'oauth.missingCode'],
    ['/auth/callback?state=synthetic-state&code=synthetic-code', 200, 'oauth.complete'],
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
