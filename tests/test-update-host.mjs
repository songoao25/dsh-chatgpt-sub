import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const temporary = mkdtempSync(join(tmpdir(), 'subscription-update-test-'));
const packageDir = join(temporary, 'profiles', 'web', 'node_modules', 'dsh-chatgpt-sub');
const dataDir = join(temporary, 'update-data');
const originalFetch = globalThis.fetch;
const names = ['DSH_HOME', 'DSH_CHATGPT_DATA_DIR', 'DSH_CHATGPT_AUTH', 'DSH_CHATGPT_SELF_UPDATE'];
const oldEnvironment = Object.fromEntries(names.map(name => [name, process.env[name]]));
const disposers = [];
let remoteVersion = '0.4.0';
let downloadCount = 0;
let authorized = true;
let route;
let server;
try {
  mkdirSync(packageDir, { recursive: true });
  cpSync(new URL('../lib/', import.meta.url), join(packageDir, 'lib'), { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: 'dsh-chatgpt-sub', type: 'module', version: '0.4.0' }));
  process.env.DSH_HOME = temporary;
  process.env.DSH_CHATGPT_DATA_DIR = dataDir;
  process.env.DSH_CHATGPT_AUTH = join(temporary, 'synthetic-auth.json');
  writeFileSync(process.env.DSH_CHATGPT_AUTH, '{"fixture":"preserve"}');
  delete process.env.DSH_CHATGPT_SELF_UPDATE;
  globalThis.fetch = async url => {
    assert.equal(new URL(url).origin, 'https://registry.npmjs.org');
    if (new URL(url).pathname === '/dsh-chatgpt-sub/latest') return new Response(JSON.stringify({ version: remoteVersion, name: 'dsh-chatgpt-sub', dist: { integrity: 'sha512-' + 'A' * 88, tarball: 'https://registry.npmjs.org/dsh-chatgpt-sub/-/dsh-chatgpt-sub-' + remoteVersion + '.tgz' } }));
    downloadCount++;
    throw new Error('unexpected download in read-only test');
  };
  const effect = fn => { const dispose = fn(); if (typeof dispose === 'function') disposers.push(dispose); };
  const plugin = (await import(pathToFileURL(join(packageDir, 'lib/index.js')))).default;
  plugin.apply({
    effect, get: () => undefined, credentials: {}, settings: {}, interval() {},
    inject(_names, fn) { fn({ effect, connection: { requestRejection: () => authorized ? undefined : 401 }, webServer: { register(value) { route = value; return () => {}; } } }); },
  });
  assert.ok(route);
  server = createServer(route.handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + route.path + '/';
  const request = async (method, body) => {
    const response = await originalFetch(base + method, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
  const initial = await request('getUpdateState');
  assert.equal(initial.data.disabled, undefined, 'real installed fixture enables updates');
  assert.equal(initial.data.runningVersion, '0.4.0');
  assert.equal(initial.data.autoUpdate, true);
  for (const method of ['checkUpdate', 'enterUpdatePage', 'installUpdate', 'setUpdateAuto', 'rollbackUpdate', 'runUpdateCheck']) assert.equal((await request(method)).status, 405, method + ' requires POST');
  authorized = false;
  assert.equal((await request('installUpdate', {})).status, 401, 'official authentication boundary applies to updates');
  authorized = true;
  assert.equal((await request('enterUpdatePage', {})).data.deferredUntilRestart, true);
  remoteVersion = '0.5.0';
  const checked = await request('checkUpdate', {});
  assert.equal(checked.data.latest, '0.5.0');
  assert.equal(checked.data.available, true);
  assert.equal(downloadCount, 0, 'checking cannot download or install');
  assert.equal(JSON.parse(readFileSync(join(packageDir, 'package.json'))).version, '0.4.0');
  assert.equal((await request('setUpdateAuto', { enabled: false })).data.autoUpdate, false);
  assert.equal((await request('getUpdateState')).data.autoUpdate, false);
  assert.equal((await request('rollbackUpdate', {})).data.rollback.restored, false, 'missing backup is reported');
  assert.equal(readFileSync(process.env.DSH_CHATGPT_AUTH, 'utf8'), '{"fixture":"preserve"}', 'update actions preserve sign-in data');
  const client = readFileSync(new URL('../src/client-bundle.js', import.meta.url), 'utf8');
  const rpcSource = client.slice(client.indexOf('    const MUTATING_RPC ='), client.indexOf('    // React 由'));
  const sent = [];
  const clientRpc = new Function('fetch', 'window', 'AbortController', "const PREFIX = '/test';\n" + rpcSource + '\nreturn rpc;')(
    async (url, options) => { sent.push({ url, options }); return new Response('{}'); },
    { setTimeout: () => 1, clearTimeout() {} }, AbortController);
  for (const method of ['startCodexOAuth', 'unbindCodex', 'checkUpdate', 'enterUpdatePage', 'installUpdate', 'setUpdateAuto', 'rollbackUpdate', 'runUpdateCheck']) {
    await clientRpc(method, { enabled: false });
    assert.equal(sent.at(-1).options.method, 'POST', 'client transport must match host: ' + method);
    assert.deepEqual(JSON.parse(sent.at(-1).options.body), { enabled: false });
  }
  await clientRpc('getUpdateState');
  assert.equal(sent.at(-1).options.method, 'GET');
  assert.equal(sent.at(-1).options.body, undefined);
  console.log('installed-package update RPC, authentication, check-only behavior and data isolation: PASS');
} finally {
  for (const dispose of disposers.reverse()) dispose();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  globalThis.fetch = originalFetch;
  for (const name of names) if (oldEnvironment[name] === undefined) delete process.env[name]; else process.env[name] = oldEnvironment[name];
  rmSync(temporary, { recursive: true, force: true });
}
