// dsh-chatgpt-sub — 发布链契约（2026-09-24 全自动化补丁）
// 覆盖：
//   1) release-please / auto-merge 优先使用 AUTOMATION_TOKEN（PAT），未配置时回退
//      GITHUB_TOKEN —— 默认 token 的 push 不触发 workflow、推的发布分支不被
//      pull_request 信任，会让「全自动发布」断成两截
//   2) 发布 PR（同仓 release-please-- 分支）也在 auto-merge 覆盖范围内
//   3) 需要时能手动补跑：release-please / ci 都保留 workflow_dispatch
//   4) npm 发布认证走 Trusted Publishing（OIDC）：无长期密钥，job 必须拿到
//      id-token: write。（2026-10-13 从 granular token 换回 OIDC：token 的
//      stage-only 权限会把版本静默放进待审队列，而 npm 已公告 token 直接
//      发布将于 2027-01 移除）
//   5) 框架对齐（2026-10-13）：发版配置的唯一出处是 release-please-config.json，
//      标签格式 vX.Y.Z 不带组件名前缀，清单与 package.json 版本一致，
//      框架记录写在 CONTRIBUTING.md
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (relative) => readFileSync(join(root, relative), 'utf8')

const releasePlease = read('.github/workflows/release-please.yml')
const autoMerge = read('.github/workflows/auto-merge-own.yml')
const ci = read('.github/workflows/ci.yml')

// ---------- 1. PAT 优先、GITHUB_TOKEN 兜底 ----------
assert.ok(releasePlease.includes('secrets.AUTOMATION_TOKEN || github.token'),
  'release-please must run on AUTOMATION_TOKEN, falling back to github.token')
assert.ok(autoMerge.includes('secrets.AUTOMATION_TOKEN || secrets.GITHUB_TOKEN'),
  'auto-merge must merge with AUTOMATION_TOKEN, falling back to GITHUB_TOKEN')

// Release PRs require explicit maintainer confirmation, matching Bottom Info Bar.
assert.ok(autoMerge.includes("!startsWith(github.event.pull_request.head.ref, 'release-please--')"), 'release branches must be excluded from auto-merge');
assert.ok(autoMerge.includes("!contains(join(github.event.pull_request.labels.*.name, ','), 'autorelease')"), 'release labels must be excluded from auto-merge');
assert.ok(autoMerge.includes("!startsWith(github.event.pull_request.title, 'chore(main): release ')"), 'release titles must be excluded from auto-merge');
assert.ok(autoMerge.includes('github.event.pull_request.user.login == github.repository_owner'), 'only owner code PRs auto-merge');

// ---------- 3. 手动补跑入口保留 ----------
for (const [name, text] of [['release-please.yml', releasePlease], ['ci.yml', ci]]) {
  assert.ok(/^\s*workflow_dispatch:/m.test(text), name + ' must keep a workflow_dispatch fallback entry')
}

// ---------- 4. 发布链不碰 npm ----------
assert.ok(!releasePlease.includes('npm publish'), 'release-please must not publish to npm')

console.log('发布链契约测试全部通过')

const publish = read('.github/workflows/publish-npm.yml');
const verify = read('.github/workflows/verify-npm-release.yml');
// 认证走 npm Trusted Publishing（OIDC）：没有长期密钥可以泄漏、过期或被撤销。
assert.ok(/^\s*id-token:\s*write\s*$/m.test(publish), 'publish must request id-token: write for trusted publishing');
assert.ok(!publish.includes('NODE_AUTH_TOKEN'), 'trusted publishing must not read NODE_AUTH_TOKEN');
assert.ok(!publish.includes('DSH_CHATGPT_SUB_NPM_TOKEN'),
  'trusted publishing must not depend on a long-lived npm token');
assert.ok(publish.includes('ACTIONS_ID_TOKEN_REQUEST_URL'), 'missing OIDC must be diagnosed without exposing credentials');
assert.ok(publish.includes('E_STAGE_REQUIRED'),
  'a stage-only trusted publisher must be diagnosed: npm would otherwise stage the version silently');
const nodeVersion = publish.match(/node-version:\s*['"]?(\d+)/);
assert.ok(nodeVersion && Number(nodeVersion[1]) >= 22, 'trusted publishing requires Node >= 22.14 (npm CLI >= 11.5.1)');
assert.ok(publish.includes('verify_only'), 'authentication diagnostics must not require publishing');
assert.ok(publish.includes('${GITHUB_REF_NAME#v}'), 'release tag must match package version');
assert.ok(publish.includes('npm publish --access public'), 'published package must be public');
assert.ok(!publish.includes('verify-npm-publication.mjs'), 'publish job must not wait for public registry propagation');
assert.ok(verify.includes('node scripts/verify-npm-publication.mjs'), 'public availability is verified separately');
assert.ok(/^\s*schedule:/m.test(verify),
  'verify-npm-release must keep a scheduled sentinel: a publish job that reports green without a public package must still be caught');

// ---------- 5. 框架对齐：发版配置唯一出处 + 标签格式 + 框架记录 ----------
const rpConfig = JSON.parse(read('release-please-config.json'));
assert.equal(rpConfig['include-component-in-tag'], false, 'tags must not carry a component prefix');
assert.equal(rpConfig.packages['.'].component, 'dsh-chatgpt-sub', 'the release component is the package name');
assert.equal(rpConfig.packages['.']['include-v-in-tag'], true, 'tags must keep the v prefix');
assert.ok(rpConfig['last-release-sha'], 'moving to a config file must pin last-release-sha so old commits are not re-changelogged');
assert.ok(releasePlease.includes('googleapis/release-please-action@v5'),
  'release-please must use the maintained action');
assert.ok(!releasePlease.includes('release-type:'),
  'release-type belongs in release-please-config.json, not inlined in the workflow');
assert.ok(/^\s*concurrency:/m.test(releasePlease), 'release-please must not run twice for the same ref');

const manifest = JSON.parse(read('.release-please-manifest.json'));
assert.equal(manifest['.'], JSON.parse(read('package.json')).version,
  'the release manifest and package.json must agree on the released version');
assert.ok(verify.includes('.release-please-manifest.json'),
  'the release age must come from the release manifest, which only the release bot rewrites');
assert.ok(read('CONTRIBUTING.md').includes('Repository framework status'),
  'the framework record belongs in CONTRIBUTING.md');
