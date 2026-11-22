// Codex 额度通道：只续期已存在的 Codex 登录文件，不创建、不碰其他结构。
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { keepCodexQuota, readCodexAuth, decodeJwtExp } from '../src/codex-quota.js'

function jwt(exp) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url')
  return header + '.' + payload + '.sig'
}

const dir = mkdtempSync(join(tmpdir(), 'dsh-codex-quota-'))
const file = join(dir, 'auth.json')
const now = Date.now()
const nowSec = Math.floor(now / 1000)

function writeAuth(expSec, extra) {
  writeFileSync(file, JSON.stringify(Object.assign({
    auth_mode: 'oauth',
    OPENAI_API_KEY: null,
    tokens: {
      access_token: jwt(expSec),
      refresh_token: 'refresh-old',
      id_token: 'id',
      account_id: 'acct-1',
    },
    last_refresh: new Date(now).toISOString(),
  }, extra || {})), { mode: 0o600 })
}

try {
  // fresh → no network, no rewrite
  writeAuth(nowSec + 10 * 3600)
  let before = readFileSync(file, 'utf8')
  let calls = 0
  let result = await keepCodexQuota(file, {
    now,
    fetchImpl: async function () { calls++; throw new Error('should not refresh') },
  })
  assert.deepEqual(result, { ok: true, refreshed: false })
  assert.equal(calls, 0)
  assert.equal(readFileSync(file, 'utf8'), before)

  // expiring → refresh, preserve structure, rotate refresh token, 0600
  writeAuth(nowSec + 60)
  result = await keepCodexQuota(file, {
    now,
    fetchImpl: async function (url, options) {
      calls++
      assert.equal(url, 'https://auth.openai.com/oauth/token')
      const form = new URLSearchParams(options.body)
      assert.equal(form.get('grant_type'), 'refresh_token')
      assert.equal(form.get('client_id'), 'app_EMoamEEZ73f0CkXaXp7hrann')
      assert.equal(form.get('refresh_token'), 'refresh-old')
      return new Response(JSON.stringify({ access_token: jwt(nowSec + 3600), refresh_token: 'refresh-new' }), { status: 200 })
    },
  })
  assert.equal(calls, 1)
  assert.deepEqual(result, { ok: true, refreshed: true })
  const after = readCodexAuth(file)
  assert.equal(after.ok, true)
  assert.equal(after.auth.tokens.refresh_token, 'refresh-new')
  assert.equal(after.auth.tokens.account_id, 'acct-1')
  assert.equal(after.auth.auth_mode, 'oauth')
  assert.ok(decodeJwtExp(after.auth.tokens.access_token) > nowSec + 3000)
  assert.equal(statSync(file).mode & 0o777, 0o600)

  // http failure → leave file untouched
  writeAuth(nowSec + 60)
  const beforeFail = readFileSync(file, 'utf8')
  result = await keepCodexQuota(file, {
    now,
    fetchImpl: async function () { return new Response('nope', { status: 401 }) },
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'http')
  assert.equal(readFileSync(file, 'utf8'), beforeFail)

  // missing file → no-op, never creates
  rmSync(file)
  result = await keepCodexQuota(file, { now, fetchImpl: async function () { throw new Error('no') } })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'missing')
  assert.equal(readCodexAuth(file).ok, false)

  // no refresh token → refuse, no network
  writeAuth(nowSec + 60)
  const auth = JSON.parse(readFileSync(file, 'utf8'))
  delete auth.tokens.refresh_token
  writeFileSync(file, JSON.stringify(auth))
  result = await keepCodexQuota(file, { now, fetchImpl: async function () { throw new Error('no') } })
  assert.equal(result.reason, 'no-refresh')

  console.log('Codex quota keeper: PASS')
} finally {
  rmSync(dir, { recursive: true, force: true })
}
