// dsh-chatgpt-sub — 发布链契约（2026-09-24 全自动化补丁）
// 覆盖：
//   1) release-please / auto-merge 优先使用 AUTOMATION_TOKEN（PAT），未配置时回退
//      GITHUB_TOKEN —— 默认 token 的 push 不触发 workflow、推的发布分支不被
//      pull_request 信任，会让「全自动发布」断成两截
//   2) 发布 PR（同仓 release-please-- 分支）也在 auto-merge 覆盖范围内
//   3) 需要时能手动补跑：release-please / ci 都保留 workflow_dispatch
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
assert.ok(publish.includes('npm whoami >/dev/null 2>&1'), 'authentication errors must be diagnosed without exposing account details');
assert.ok(publish.includes('verify_only'), 'authentication diagnostics must not require publishing');
assert.ok(publish.includes('${GITHUB_REF_NAME#v}'), 'release tag must match package version');
assert.ok(publish.includes('npm publish --access public'), 'published package must be public');
assert.ok(!publish.includes('verify-npm-publication.mjs'), 'publish job must not wait for public registry propagation');
assert.ok(verify.includes('node scripts/verify-npm-publication.mjs'), 'public availability is verified separately');
