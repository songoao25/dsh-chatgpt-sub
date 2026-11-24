# 安装 / 卸载 / 故障恢复

## 前置条件

- 已安装 DeepSeek Harness —— **桌面端客户端**，或命令行启动的 CLI profile（`dsh web`）
- 已安装 [pnpm](https://pnpm.io/)（`dsh plugin` 与插件页的安装框都依赖它）
- ChatGPT Plus 或 Pro 账号，并在登录时允许本应用使用套餐额度。Free、Team、Enterprise、Edu 不在 OpenAI 当前预览范围内；收费或托管分发需走 OpenAI 的申请流程，见 [SIWC 文档](https://developers.openai.com/siwc/token-sharing-open-source)。

## 安装

### 方式一：在 DSH 插件页添加（推荐；桌面端唯一方式）

打开 DSH 的 **插件 → 添加插件**，在「包名或地址」里填包名（推荐）：

```
dsh-chatgpt-sub
```

npm 上的 `dsh-chatgpt-sub` 自 2026-10-13（0.5.1）起公开可装；填包名时 DSH 会去 npm 解析这个名字、用 pnpm 装进 profile 目录。也可以填仓库地址，安装的是仓库根（`lib/` 已入库，所以填地址安装**不跑构建、不会弹「待批准的构建脚本」**）。同一个框也接受：

- 本仓库工作副本的绝对路径 —— 用于开发（会产生 `link:` 安装）。

**桌面端客户端只能用这条**：DSH 的 `desktop` profile 由客户端自己管理，命令行 `dsh plugin --profile desktop ...` 会被直接拒绝（`profile "desktop" is managed exclusively by the Electron application`）。

### 方式二：命令行 `dsh plugin`

用你实际启动的 profile（`dsh web` 启动的是 `web`）：

```bash
# 按包名（推荐；0.5.1 起已在 npm 公开）
dsh plugin --profile web add dsh-chatgpt-sub

# 或仓库默认分支（不跑构建，lib/ 已入库）
dsh plugin --profile web add https://github.com/SONGOAO25/dsh-chatgpt-sub
```

`desktop` 被保留给桌面端客户端——CLI 会直接拒绝这个 profile，不会替你安装。

### 方式三：一键脚本（产生 `link:` 安装）

```bash
git clone https://github.com/SONGOAO25/dsh-chatgpt-sub.git
cd dsh-chatgpt-sub
./install.sh
# 默认安装到 web profile；其他 profile：
./install.sh --profile <profile名>
```

脚本会先重建一次 `lib/`（`lib/` 已入库，这一步只是保证跑起来的代码与 `src/` 一致），再执行 `dsh plugin --profile <name> add <仓库根>`。`link:` 安装跟随你的工作副本而不是 npm。

### 安装原理

`dsh plugin add`（以及插件页的安装框）会：

1. 用 pnpm 把插件包安装到 profile 目录（`~/.dsh/profiles/<name>/`）；
2. 检测到包声明了 `dsh.bundle`（仓库根的 `cordis.patch.yml`），自动把包名加入 profile 的 bundle 层列表（`dsh.profile.bundles`）；
3. 下次启动 `dsh` 时，插件随 profile 自动加载——host 注册 OAuth 流程与 RPC、client 在插件详情页提供「ChatGPT 订阅」配置。

**注意：安装后需要重启 DSH 才会生效**——宿主进程在启动时组合插件。刷新页面不足以加载 host 端。

**为什么 git 地址安装不需要构建**：`lib/` 是入库的构建产物，仓库根就是一个开箱即用的插件包。

pnpm 对 git 依赖会执行包里的 `prepare` 脚本，且默认拦下要求批准（`ERR_PNPM_GIT_DEP_PREPARE_NOT_ALLOWED`）。本包不声明 `prepare` / `prepack`（`package.json` 里只有 `prepublishOnly`，仅在本仓库自己执行发布时才跑），所以填 GitHub 地址是**零构建、零授权**的。

### 验证安装成功

```bash
dsh --profile web --dump-config | grep dsh-chatgpt-sub
# 应看到 dsh-chatgpt-sub 行（bundle 层已生效）
```

重启后，在 DSH **插件** 页能看到 **ChatGPT 订阅** 即安装成功。（桌面端客户端没有可用的 `dsh --profile` 命令，直接在插件页确认即可。）

## 绑定 ChatGPT 订阅

1. 打开 DSH **插件** 页 → 进入 **ChatGPT 订阅**。
2. 点「**绑定 ChatGPT 账号**」→ 浏览器打开 OpenAI 官方授权页。
3. 用 ChatGPT 账号登录，并允许**使用 ChatGPT 套餐额度**；插件页显示「已连接」即完成。拒绝套餐额度时这次绑定不会保存。
4. 新建对话，在模型切换器选择提供商 **ChatGPT** 的模型（如 `gpt-5.6-terra`）对话。

> 若浏览器未自动打开，请允许 DSH 弹窗（页面会以 `window.open` 兜底）。
> 绑定后模型切换器出现 ChatGPT 提供商；对话消耗订阅额度。

## 更新

在插件页的**版本与更新**里选择自动更新（默认）或手动更新。自动更新在 DSH 启动时检查 npm、校验并替换插件文件，重启后生效；手动检查只查询版本，安装前会弹出确认。更新失败自动恢复旧文件，需要时可以回滚；登录和绑定信息保留。设置页会显示运行版本、最新版本、上次检查时间以及是否需要重启。

更新状态、日志和备份保存在本端 `DSH_HOME` 下的 `dsh-chatgpt-sub/`（默认 `~/.dsh/dsh-chatgpt-sub/`；`DSH_CHATGPT_DATA_DIR` 可覆盖）。本机标识保存在 `~/.dsh/dsh-chatgpt-sub/host-id`。官方推理不使用 `~/.codex/auth.json`；但为了信息栏的额度窗口，文件已存在时插件会续期它（不创建、不改结构、不用于推理）。源码和链接安装不自动替换文件，仍按下面的方法更新；自动/手动更新都依赖 npm 上的公开版本（`dsh-chatgpt-sub` 自 0.5.1 起已公开）。

### 手动更新本地副本或迁移安装

| 你的安装方式 | 更新命令 |
|---|---|
| 包名 `dsh-chatgpt-sub`（插件页或命令行） | 使用插件页的「版本与更新」，更新后重启 DSH |
| 仓库地址（插件页或命令行） | 使用插件页的「版本与更新」；旧版本无更新入口时，在插件页移除后重新添加仓库地址，然后重启 DSH |
| `link:`（一键脚本或本地代码） | 见下方三步 |

`link:` 安装更新时要**三步一起做**：拉代码 → 切到默认分支 → 重新构建：

```bash
cd dsh-chatgpt-sub
git fetch origin && git checkout main && git merge --ff-only origin/main
node scripts/build.mjs
# 重启 DSH
```

- **别只用 `git pull`**：本地开发分支从没推到远端时它会直接失败（`no such ref was fetched`）；而且 `link:` 安装加载的是构建产物 `lib/`，只拉代码不重建，重启后跑的还是旧代码。
- 三条命令都是 `--ff-only` / 非破坏性的：工作区不干净或分支上有本地提交时，git 会拒绝执行，而不是覆盖你的改动。
- **本地副本不自动替换文件**：源码和 `link:` 安装需要手动拉取并构建。普通安装按插件页选择的自动或手动更新方式执行。

## 卸载

桌面端客户端：在 **插件** 页里卸载。命令行：

```bash
cd dsh-chatgpt-sub
./uninstall.sh
# 或手动：
dsh plugin --profile web remove dsh-chatgpt-sub
```

卸载会清理：profile 插件条目、`llm-pi-ai.providers.chatgpt-siwc` 路由配置、`CHATGPT_SIWC_TOKEN` 凭据、会话记录。`~/.dsh/dsh-chatgpt-sub/` 里的 host id 与账号注册信息会保留，下次登录更快；删掉它等同于全新安装。重启后模型切换器的 ChatGPT 提供商自动消失。

## 与联网搜索的关系

插件**不管理联网搜索**：不会把 ChatGPT 订阅令牌当作搜索服务凭据，也不会读取、删除、记录或改写任何搜索配置（如 `DEEPSEEK_API_KEY`、`EXA_API_KEY`）。

搜索商（`searchProvider`，如 `deepseek-official` / `exa`）完全由用户在 DSH 的 profile 配置层自行指定；本插件无论绑定与否、处于哪个模型模式，都不触碰搜索设置。若未配置任何可用搜索商，`web_search` 会按 DSH 自身的规则明确失败，这与本插件无关。

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| 插件详情里没有配置页 | ① 没重启：需重启 DSH；② 装错 profile：确认启动用的 profile 与安装目标一致；③ `dsh --profile web --dump-config` 里没有 dsh-chatgpt-sub：重新执行安装 |
| 插件页或命令行报「未找到相关插件」 | 先检查包名拼写；包名解析不到时改用仓库地址安装 |
| 装到的版本比 npm 上的最新版旧 | pnpm 11 默认有「发布冷却期」（`minimumReleaseAge`）：刚发布不久的版本会被跳过，自动退到更早的一个版本（实测：pnpm 11.21.0 下，某版本发布约 1 小时后填包名装到的是上一版）。命令行可临时关掉：`pnpm add dsh-chatgpt-sub --config.minimumReleaseAge=0`；插件页的安装框不能加参数，等冷却期过去再重装即可。装好后插件页的「版本与更新」直接读 npm 上的最新版本，不受这条限制 |
| 插件页报「这个包没有声明组合包」 | 装到的是一个「仓库根不是包」的仓库。本仓库根目录一直是包；请确认填的是本仓库，并用包含最新提交的地址 |
| 插件页提示「有依赖的安装脚本需要你允许」/「待批准的构建脚本」 | 装到的清单里声明了 `prepare` / `prepack`（本仓库当前清单没有，只有 `prepublishOnly`）。用最新提交的仓库地址重装；确实需要放行时，按提示把 pnpm 打印的那一行加进 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 再重试 |
| 命令行报 `profile "desktop" is managed exclusively by the Electron application` | 桌面端客户端的 profile 不能用 CLI 改：请在客户端 **插件 → 添加插件** 里安装/卸载 |
| 浏览器授权后仍未连接 | 更新插件并由你自行重启 DSH 后重试。浏览器的成功提示只在 DSH 连接完成后出现；若失败，返回插件页记录错误文字，并提供 DSH 版本、插件运行版本及 Windows 版本。不要上传登录文件、完整授权网址或账号资料 |
| 点绑定没反应/浏览器没打开 | ① 检查是否允许 DSH 弹窗；② 重启 DSH 后再试 |
| 提示「本地 ChatGPT 通道没起来」 | 插件启动时本地规范化代理没有监听成功，重启 DSH 后再试；仍失败请附 DSH 版本与插件版本反馈 |
| 授权超时（5 分钟） | 重新点「绑定 ChatGPT 账号」再试；确认浏览器完成了授权 |
| 绑定后模型切换器无 ChatGPT | 确认绑定成功（插件页显示「已连接」）；重启 DSH 让路由注册生效 |
| 对话报错/模型不可用 | 模型列表来自登录账号；报 `subscription_sharing_*` 时说明套餐或该应用的每周额度不包含它，见 ChatGPT 设置 → 用量 |
| 信息栏不显示 5 小时/每周百分比 | 额度窗口需要本机 `~/.codex/auth.json`；跑一次 `codex login` 后重启 DSH。只有官方 SIWC 登录时，信息栏只显示账号/套餐/有效期 |
| 安装报 `pnpm not found` / 「没有找到 pnpm」 | 安装 pnpm：`npm i -g pnpm` 或 `corepack enable` |
| 想彻底移除插件影响 | 卸载 + 重启 DSH |
| 绑定时报「OpenAI 拒绝了本次登录，当前所在地区不在支持范围内」 | 授权接口按地区拒绝了这次请求。在 `~/.dsh/.env` 里设置 `HTTPS_PROXY`（代理需要时一并设置 `HTTP_PROXY` 与 `ALL_PROXY`），然后**完整重启 DSH** 再重新绑定。代理变量在 DSH 启动时读取，只刷新页面不生效 |
| 绑定时报「连接 OpenAI 超时」 | 请求在超时前没有拿到响应。检查本机网络与代理是否可用，重启 DSH 后重试 |
| 绑定时报「OpenAI 域名解析失败」 | 域名没有解析到地址，通常是 DNS 不可用或被污染。检查 DNS 或代理设置后重试 |
| 绑定时报「连接被拒绝，通常是本地代理没有启动」 | 目标端口拒绝了连接。配置了代理时先确认代理进程在运行，再重新绑定 |
| 绑定时报「到 OpenAI 的网络不可达」 | 网络层不可达。检查网络与代理设置后重试 |
| 绑定时报「代理在建立加密连接前断开了」 | 代理在加密握手完成前把连接掐断了，多半是代理刚重启、刚切节点或链路被中间设备打断。确认代理稳定或换一个节点后重试 |
| 绑定成功但提示「登录成功了，但没读到这个账号可用的模型」 | 绑定流程读取模型列表时的失败，按上面对应的原因处理后重新绑定 |
| 绑定成功但提示「读取模型列表时没能连上 OpenAI」 | 模型列表这一请求本身没成功（原因还认不出来）。检查网络与代理后重新绑定 |
| 插件页显示「自动续期失败」 | 令牌到期后自动续期没成功，通常是网络或代理在那时不可用。检查代理是否在运行、网络是否可达；DSH 会自动重试，必要时重启 DSH |
| 插件页显示「自动续期时连接被拒绝，通常是本地代理没有启动」 | 续期那一刻代理端口没在监听。启动代理后等下一次自动续期，或重启 DSH 立刻生效 |
| 插件页显示「自动续期时 OpenAI 域名解析失败」 | 续期那一刻 DNS 解析不了。检查 DNS 或代理设置后重试 |
| 插件页显示「自动续期时到 OpenAI 的网络不可达」 | 续期那一刻网络层不可达。检查网络与代理设置后重试 |
| 插件页显示「自动续期时 OpenAI 返回 HTTP {status}」 | 服务端返回了错误状态码，通常是临时的服务端问题。稍后重试；若持续出现，更新插件并重启 DSH |

## 与其他插件的关系

- **[Bottom Info Bar](https://github.com/SONGOAO25/dsh-bottom-info-bar)**：信息栏插件读取本插件保存的账号注册信息，显示已连接账号、套餐与有效期，并提供 ChatGPT 用量页入口。按应用的每周额度由 ChatGPT 设置管理；两者可独立安装，信息栏的 ChatGPT 区域需要本插件先绑定。
