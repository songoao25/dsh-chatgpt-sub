// dsh-chatgpt-sub — 安装方式契约（2026-09-24 桌面端客户端发布后新增）
// 覆盖：
//   1) package.json 只保留 prepublishOnly：pnpm 对 git 依赖会执行并拦截 prepare
//      （ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED），留着安装期脚本会让插件页
//      「填 GitHub 地址」安装变成「待批准的构建脚本」卡点
//   2) 仓库根就是插件包：dsh.bundle 指向根目录的 cordis.patch.yml，lib/ 已入库，
//      这样插件页填地址零构建即可安装
//   3) 三处用户文档（README / README.zh-CN / docs/INSTALL）都同时给出
//      「插件页添加插件」与命令行两条路径，且代码块里不出现 --profile desktop
//      （desktop profile 由桌面端客户端独占，CLI 会直接拒绝）
//   4) install.sh / uninstall.sh 对 desktop profile 有明确拒绝与引导，且语法合法
//   5) 本仓库发布 npm（包名 = 仓库名 = dsh-chatgpt-sub）：publish-npm.yml 存在，
//      三处文档都给出按包名安装/更新的入口（与仓库地址入口并列）
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (relative) => readFileSync(join(root, relative), 'utf8')
const pkg = JSON.parse(read('package.json'))

// ---------- 1. 安装期脚本：只允许 prepublishOnly ----------
assert.ok(pkg.scripts.prepublishOnly, 'package.json keeps prepublishOnly as the only lifecycle hook (inert unless someone publishes)')
for (const forbidden of ['prepare', 'prepack', 'postinstall', 'install']) {
  assert.equal(pkg.scripts[forbidden], undefined,
    'package.json must not declare a ' + forbidden + ' script: pnpm runs it for git dependencies, ' +
    'which turns a GitHub-address install into an approval prompt')
}

// ---------- 2. 仓库根就是插件包 ----------
assert.equal(pkg.main, 'lib/index.js', 'the package entry is the committed lib/index.js')
assert.equal(pkg.exports['./client'], './lib/client.js', 'the client half is exported from lib/client.js')
assert.equal(pkg.exports['./cordis.patch.yml'], './cordis.patch.yml', 'the bundle patch must stay importable')
assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml', 'dsh.bundle.patch points at the repository-root patch')
for (const file of ['lib', 'cordis.patch.yml', 'locale/*.json', 'docs/INSTALL.md', 'README.md', 'README.zh-CN.md']) {
  assert.ok(pkg.files.includes(file), 'the installed package must ship ' + file)
}
for (const built of ['lib/index.js', 'lib/client.js']) {
  assert.ok(existsSync(join(root, built)), built + ' must be committed: a GitHub-address install runs no build')
}
const ignoreRules = read('.gitignore').split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'))
const ignoredLib = ignoreRules.filter((line) => !line.startsWith('!') && /^\/?lib\/?$/.test(line))
assert.deepEqual(ignoredLib, [], '.gitignore must not ignore lib/ — the built bundle is committed on purpose')

// 挂载行：行 name 必须是包名，行 id 必须不同（插件卡片会把两者分两行显示）
const patch = read('cordis.patch.yml')
const rowName = patch.match(/^\s*name:\s*'([^']+)'/m)?.[1]
const rowId = patch.match(/^\s*-\s*id:\s*(\S+)/m)?.[1]
assert.equal(rowName, pkg.name, 'the bundle row name must be the package name')
assert.notEqual(rowId, rowName, 'the bundle row id must differ from the package name')

// ---------- 3. 用户文档三条路径齐全 ----------
// 用正则匹配完整地址，而不是对 URL 做 substring 断言（CodeQL js/incomplete-url-substring-sanitization）
const REPO_ADDRESS = /https:\/\/github\.com\/SONGOAO25\/dsh-chatgpt-sub(?![\w.-])/
const docs = {
  'README.md': read('README.md'),
  'README.zh-CN.md': read('README.zh-CN.md'),
  'docs/INSTALL.md': read('docs/INSTALL.md'),
}
for (const [name, text] of Object.entries(docs)) {
  assert.ok(REPO_ADDRESS.test(text), name + ' must give the repository address users paste into the plugin page')
  assert.ok(/添加插件|Add plugin/.test(text), name + ' must document the plugin page install box')
  assert.ok(text.includes('dsh plugin --profile'), name + ' must document the CLI install path')
}
assert.ok(/Add plugin/.test(docs['README.md']) && /添加插件/.test(docs['README.zh-CN.md']),
  'each README must name the install box in its own language')
assert.ok(docs['docs/INSTALL.md'].includes('desktop'), 'docs/INSTALL.md must explain the desktop profile constraint')
assert.ok(/拒绝|refused|managed exclusively/.test(docs['docs/INSTALL.md']),
  'docs/INSTALL.md must say the CLI refuses the desktop profile')

// 文档里的代码块不得把 --profile desktop 当成可用命令
for (const [name, text] of Object.entries(docs)) {
  const blocks = text.match(/```[\s\S]*?```/g) ?? []
  for (const block of blocks) {
    assert.ok(!block.includes('--profile desktop'), name + ' must not present --profile desktop as a runnable command')
  }
}

// ---------- 4. 一键脚本：desktop 明确拒绝 ----------
for (const script of ['install.sh', 'uninstall.sh']) {
  const text = read(script)
  assert.ok(text.includes('desktop'), script + ' must handle the desktop profile')
  const syntax = spawnSync('bash', ['-n', join(root, script)], { encoding: 'utf8' })
  assert.equal(syntax.status, 0, script + ' must be valid bash: ' + syntax.stderr)
}
assert.ok(read('install.sh').includes('添加插件'), 'install.sh must route desktop users to the plugin page')
assert.ok(read('uninstall.sh').includes('插件'), 'uninstall.sh must route desktop users to the plugin page')
// 真的跑一次：install.sh 必须在 desktop 上拒绝，并给出插件页地址（在 dsh 未安装的机器上也一样）
const desktopRun = spawnSync('bash', [join(root, 'install.sh'), '--profile', 'desktop'], { encoding: 'utf8' })
assert.notEqual(desktopRun.status, 0, 'install.sh --profile desktop must fail instead of forwarding to the CLI')
assert.ok(/desktop/.test(desktopRun.stdout + desktopRun.stderr), 'install.sh must name the refused profile')
assert.ok(/添加插件/.test(desktopRun.stdout + desktopRun.stderr), 'install.sh must send desktop users to the plugin page')

// ---------- 5. 发布 npm：包名与仓库地址是并列的两个安装入口 ----------
assert.ok(existsSync(join(root, '.github/workflows/publish-npm.yml')),
  'the package is published to npm — keep .github/workflows/publish-npm.yml present')
assert.equal(pkg.name, 'dsh-chatgpt-sub', 'the published npm package name is fixed: dsh-chatgpt-sub')
const PKG_NAME_INSTALL = /add dsh-chatgpt-sub(\s|$)/m
for (const [name, text] of Object.entries(docs)) {
  assert.ok(PKG_NAME_INSTALL.test(text),
    name + ' must present the bare package-name install command (the package is on npm)')
  assert.ok(!/dsh-chatgpt-sub@latest/.test(text),
    name + ' must not hand users an npm @latest install command (DSH takes a plain package name)')
  // 发布工作流存在不等于包已上架；文档须提供当前仓库地址和发布后的包名入口。
  assert.ok(!/Yes — the package name|有，包名/.test(text),
    name + ' must not assert npm availability without a verified publication')
}
assert.ok(/dsh-chatgpt-sub/.test(docs['docs/INSTALL.md']),
  'docs/INSTALL.md must name the npm package for the plugin-page install box')

// locale 字典是插件页显示的元信息来源，安装契约测试顺手钉住它没被删
assert.deepEqual(readdirSync(join(root, 'locale')).sort(), ['en.json', 'zh.json'], 'locale/ must keep the two DSH languages')

console.log('安装方式契约测试全部通过')
