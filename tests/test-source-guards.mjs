// 源码守卫（Source guards）：把「发版事故」的教训从文档约定变成 CI 拦得住的硬约束。
//
// 背景：2026-09-11 本系列仓库出过一次 v2.0.0 误发 —— 有人手工 bump 了版本号，
// Release Please 因此失去「上次发布」的基准，把全部历史当成未发布内容，算出错误的
// 大版本；而当时的发版 PR 是自动合并的，于是直接发了出去。
//
// 2026-10-14 用户拍板：发布链改成全自动（自动审核 / 自动批准 / 自动合并 / 自动发版），
// 发版 PR 也自动合并。人工闸门撤掉之后，误发的根因必须由 CI 拦住，所以这里两条守卫：
//   守卫 1（普通 PR）：不得手工修改版本元数据 —— v2.0.0 的根因。
//   守卫 2（发版 PR）：只允许改那四个版本文件，且 manifest 与 package.json 的新版本一致。
// 这些检查依赖 CI 提供的 git 上下文（GITHUB_BASE_REF）；本地直接跑会跳过。
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
let failures = 0
function check(name, condition, detail) {
  if (condition) console.log('PASS  ' + name)
  else { failures += 1; console.log('FAIL  ' + name + (detail !== undefined ? '\n      ' + detail : '')) }
}

const baseRef = process.env.GITHUB_BASE_REF || ''
const headRef = process.env.GITHUB_HEAD_REF || ''

if (!baseRef) {
  console.log('SKIP  发布元数据守卫：非 PR 场景（无 GITHUB_BASE_REF），跳过')
} else {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  let changed = null
  try {
    git(['fetch', '--no-tags', '--quiet', 'origin', baseRef])
    changed = git(['diff', '--name-only', 'origin/' + baseRef + '...HEAD']).split('\n').filter(Boolean)
  } catch (err) {
    console.log('WARN  无法取得基线（' + String(err && err.message).split('\n')[0] + '），跳过发布元数据守卫')
  }

  if (changed) {
    if (headRef.startsWith('release-please--')) {
      // ---------- 守卫 2：发版 PR 只准改版本文件，且两处版本必须一致 ----------
      const ALLOWED = new Set(['package.json', 'package-lock.json', 'CHANGELOG.md', '.release-please-manifest.json'])
      const unexpected = changed.filter((f) => !ALLOWED.has(f))
      check(
        '守卫 2a：发版 PR 只改版本元数据四个文件',
        unexpected.length === 0,
        unexpected.length === 0 ? undefined
          : '多改了：' + unexpected.join(', ') +
            '\n      发版 PR 由 Release Please 生成，只应含 package.json / package-lock.json / CHANGELOG.md / .release-please-manifest.json。' +
            '\n      其它改动请另开代码 PR —— 塞进发版提交等于绕过评审直接发布。'
      )

      let pkgVersion = null
      let manifestVersion = null
      try { pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version } catch (err) { /* 交给下面的断言报失败 */ }
      try { manifestVersion = JSON.parse(readFileSync(join(root, '.release-please-manifest.json'), 'utf8'))['.'] } catch (err) { /* 同上 */ }
      check(
        '守卫 2b：发版 PR 里 package.json 与 manifest 的新版本一致',
        Boolean(pkgVersion) && pkgVersion === manifestVersion,
        'package.json = ' + pkgVersion + '，.release-please-manifest.json = ' + manifestVersion +
          '\n      两者不一致会让 Release Please 的发布基准错位，可能重演 v2.0.0 误发。'
      )
    } else {
      // ---------- 守卫 1：普通 PR 不得手工改版本元数据 ----------
      const GUARDED = ['.release-please-manifest.json', 'CHANGELOG.md']
      const touched = changed.filter((f) => GUARDED.includes(f))
      if (changed.includes('package.json')) {
        // package.json 只锁 version 字段：description / keywords 等正常改动不该被拦。
        let versionTouched = null
        try {
          const pkgDiff = git(['diff', 'origin/' + baseRef + '...HEAD', '--', 'package.json'])
          versionTouched = pkgDiff.split('\n').some((l) => /^[+-]\s*"version"\s*:/.test(l))
        } catch (err) { /* 取不到 diff 就当作动过版本号，宁可拦住 */ }
        if (versionTouched !== false) touched.push('package.json（version 字段）')
      }
      // 逃生舱：Release Please 万一自己把元数据弄坏，必须还有人工抢修的路
      //（main 开了 enforce_admins，没有这条就永久卡死）。
      let override = false
      try {
        override = git(['log', 'origin/' + baseRef + '..HEAD', '--format=%B']).includes('[release-metadata-override]')
      } catch (err) { /* 取不到提交信息就当作没有授权，宁可拦住 */ }
      check(
        '守卫 1：普通 PR 不得手工修改版本元数据（版本号由 Release Please 独占）',
        touched.length === 0 || override,
        touched.length === 0 ? undefined
          : '被修改：' + touched.join(', ') +
            (override ? '\n      （已检测到 [release-metadata-override]，本次放行）' : '') +
            '\n      版本号 / CHANGELOG / manifest 由 Release Please 维护，手工改会破坏它的发布基准。' +
            '\n      发版 PR 现在也是自动合并的，没有人再帮你看一眼，所以这道守卫必须拦住。' +
            '\n      确有抢修需要时：在提交信息里写 [release-metadata-override]，并在 PR 描述里说明原因。'
      )
    }
  }
}

if (failures > 0) {
  console.log('\n源码守卫：' + failures + ' 项失败')
  process.exit(1)
}
console.log('\n源码守卫通过（非 PR 场景会跳过依赖 git 上下文的检查）')
