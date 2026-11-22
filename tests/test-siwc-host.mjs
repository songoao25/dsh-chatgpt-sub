// 纯 host 逻辑：会话形状、刷新判定、默认模型、设置读写。
import assert from 'node:assert/strict'
import {
  parseSession, pickDefaultModel, planDisplayName, needsRefresh, terminalRefreshError,
  readSettingsSection, settingsServiceReady,
} from '../src/host.js'

const session = parseSession({
  kind: 'grant',
  payload: {
    version: 1, clientId: 'oaiapp_test', hostId: 'urn:uuid:x', subject: 's', email: 'e@x.com',
    idToken: 'id', accessToken: 'access', refreshToken: 'refresh', expiresAt: Date.now() + 3600_000,
    scopes: ['openid', 'chatgpt.tokens.use.direct'], savedAt: new Date().toISOString(),
  },
})
assert.equal(session.clientId, 'oaiapp_test')
assert.equal(session.refreshToken, 'refresh')
assert.equal(parseSession({ kind: 'grant', payload: { version: 2 } }), null)
assert.equal(parseSession({ kind: 'api-key' }), null)
assert.equal(parseSession(undefined), null)

const fresh = { expiresAt: Date.now() + 3600_000, earliestRefreshAt: null }
const soon = { expiresAt: Date.now() + 5 * 60_000, earliestRefreshAt: null }
const expired = { expiresAt: Date.now() - 1, earliestRefreshAt: null }
const hinted = { expiresAt: Date.now() + 5 * 60_000, earliestRefreshAt: Date.now() + 3600_000 }
assert.equal(needsRefresh(fresh), false)
assert.equal(needsRefresh(soon), true)
assert.equal(needsRefresh(expired), true)
assert.equal(needsRefresh(hinted), false)

for (const code of ['invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated', 'refresh_token_reused']) {
  assert.equal(terminalRefreshError(code), true, code)
}
assert.equal(terminalRefreshError('network'), false)
assert.equal(terminalRefreshError(undefined), false)

assert.equal(pickDefaultModel([{ id: 'gpt-5.5' }, { id: 'gpt-6.1-sol' }], null), 'gpt-6.1-sol')
assert.equal(pickDefaultModel([{ id: 'gpt-5.5' }, { id: 'gpt-6.1-sol' }], 'gpt-5.5'), 'gpt-5.5')
assert.equal(pickDefaultModel([{ id: 'custom-model' }], null), 'custom-model')
assert.equal(pickDefaultModel([], null), null)
assert.equal(planDisplayName('plus'), 'Plus')
assert.equal(planDisplayName('weird'), 'weird')
assert.equal(planDisplayName(null), null)

const described = {
  describe() { return [{ ns: 'llm-pi-ai', value: { providers: { x: 1 } } }] },
  mutate() {},
}
assert.deepEqual(readSettingsSection(described, 'llm-pi-ai'), { providers: { x: 1 } })
assert.equal(settingsServiceReady(described), true)
assert.equal(settingsServiceReady({ mutate() {} }), false)
assert.equal(settingsServiceReady(null), false)

console.log('session, refresh decision and settings helpers: PASS')
