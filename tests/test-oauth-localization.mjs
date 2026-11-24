// 授权回调页只渲染字典里的文案，不把回调参数带进 HTML；13 种语言都有新错误码。
import assert from 'node:assert/strict'
import { LOCALES } from '../src/locales.js'
import { respondOAuthPage } from '../src/host.js'

const NEW_KEYS = [
  'error.oauth.declined', 'error.oauth.registration-incomplete', 'error.oauth.registration-mismatch',
  'error.oauth.plan-usage-missing', 'error.oauth.id-token-invalid', 'error.models.empty',
  'error.token.refresh-terminal', 'error.token.plan-usage-missing', 'error.proxy.start-failed',
  'error.route.proxy', 'error.state.migrated',
  'error.oauth.exchange-region-blocked', 'error.oauth.exchange-timeout', 'error.oauth.exchange-dns',
  'error.oauth.exchange-refused', 'error.oauth.exchange-unreachable', 'error.oauth.exchange-proxy-reset',
  'error.oauth.id-token-timeout', 'error.oauth.id-token-network', 'error.oauth.id-token-dns',
  'error.oauth.id-token-refused', 'error.oauth.id-token-unreachable', 'error.oauth.id-token-proxy-reset',
  'error.oauth.id-token-http',
  'error.models.region-blocked', 'error.models.timeout', 'error.models.dns',
  'error.models.refused', 'error.models.unreachable', 'error.models.http',
  'error.models.proxy-reset', 'error.models.network',
  'error.token.refresh-timeout', 'error.token.refresh-dns', 'error.token.refresh-refused',
  'error.token.refresh-unreachable', 'error.token.refresh-proxy-reset', 'error.token.refresh-http',
]
for (const [language, dictionary] of Object.entries(LOCALES)) {
  for (const key of NEW_KEYS) {
    assert.equal(typeof dictionary[key], 'string', language + ' missing ' + key)
    assert.ok(dictionary[key].length > 0, language + ' empty ' + key)
  }
}

function render(language, key = 'oauth.complete') {
  const res = { setHeader() {}, end(html) { this.html = html } }
  respondOAuthPage(res, 200, key, language)
  return res.html
}

for (const language of [...Object.keys(LOCALES), 'zh-TW', '<script>']) {
  const html = render(language)
  const expected = language === 'zh-TW' ? 'zh-hant' : Object.hasOwn(LOCALES, language) ? language : 'en'
  assert.ok(html.includes('lang="' + expected + '"'), language + ' language tag')
  assert.ok(html.includes(LOCALES[expected]['oauth.complete']), language + ' message')
  assert.ok(!html.includes('<script>'), 'unsafe language never enters HTML')
}

const unsafe = render('<script>alert(1)</script>')
assert.ok(!unsafe.includes('<script>alert(1)</script>'))
console.log('localized OAuth callback page + new error keys: PASS')
