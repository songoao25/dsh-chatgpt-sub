# ChatGPT 订阅

[**English**](README.md) | **中文**

[![License: MIT](https://img.shields.io/github/license/SONGOAO25/dsh-chatgpt-sub)](https://github.com/SONGOAO25/dsh-chatgpt-sub/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/SONGOAO25/dsh-chatgpt-sub)](https://github.com/SONGOAO25/dsh-chatgpt-sub/releases)
[![npm 版本](https://img.shields.io/npm/v/dsh-chatgpt-sub)](https://www.npmjs.com/package/dsh-chatgpt-sub)
[![npm 下载量](https://badgen.net/npm/dt/dsh-chatgpt-sub?label=downloads)](https://www.npmjs.com/package/dsh-chatgpt-sub)
[![npm 月下载量](https://badgen.net/npm/dm/dsh-chatgpt-sub?label=downloads%2Fmonth)](https://www.npmjs.com/package/dsh-chatgpt-sub)
[![GitHub 星标](https://img.shields.io/github/stars/songoao25/dsh-chatgpt-sub)](https://github.com/songoao25/dsh-chatgpt-sub/stargazers)
[![GitHub Fork](https://img.shields.io/github/forks/songoao25/dsh-chatgpt-sub)](https://github.com/songoao25/dsh-chatgpt-sub/forks)

一个 DeepSeek Harness 插件：通过 OpenAI 官方的 **Sign in with ChatGPT**（面向开源客户端的 ChatGPT 套餐额度）连接 ChatGPT 账号，在 DSH 中使用该账号可用的模型。

需要 **ChatGPT Plus 或 Pro** 账号，并在登录时允许本应用使用套餐额度。Free、Team、Enterprise、Edu 不在 OpenAI 当前预览范围内。如果你把本插件放进收费产品或远程托管服务，需要走 OpenAI 的[申请表](https://openai.com/form/sign-in-with-chatgpt-interest/)；开源自建、本机运行走官方文档里的自动流程，见 [OpenAI SIWC 文档](https://developers.openai.com/siwc/token-sharing-open-source)。

## 功能

在插件页登录，再选择提供商 **ChatGPT** 下的模型即可对话。插件自动维护登录状态，并显示账号、有效期以及「重新绑定 / 解绑」操作。

模型列表来自登录账号自己的目录，选择器里就是该套餐实际可用的模型。首次登录会把本机注册成一个名为 **DSH ChatGPT 订阅** 的 agent；可以在 ChatGPT 的 **设置 → 连接** 里查看或断开，在 **设置 → 用量** 里给单个应用设每周上限。

配套的[底部信息栏](https://github.com/songoao25/dsh-bottom-info-bar)读取本插件的账号注册信息；如果本机存在 Codex 登录文件，还会查询 Codex 用量接口，显示 5 小时 / 每周 / 月度窗口。没有 Codex 登录时只显示账号、套餐与有效期，并提供 ChatGPT 用量页入口。按应用的每周限额由用户在 ChatGPT 设置里管理，不由本插件代管。

## 安装

**推荐：在 DSH 里按包名从 npm 安装。** 打开 DSH **插件 → 添加插件**，填 npm 包名：

```
dsh-chatgpt-sub
```

DSH 会去 npm 查这个名字、用 pnpm 装好 —— 不用克隆仓库，也不跑构建。包自 2026-10-13 起在 npm 公开。

使用命令行启动的网页端，也可以执行：

```bash
dsh plugin --profile web add dsh-chatgpt-sub
```

npm 连不上时，改填仓库地址兜底 —— 仓库已包含构建文件，填地址安装同样不需要构建：

```
https://github.com/SONGOAO25/dsh-chatgpt-sub
```

装完**重启 DSH**，只刷新页面不够。桌面客户端请使用 **插件 → 添加插件**；它的配置由客户端管理，不能通过命令行安装。

本地安装、Windows 说明、更新与故障排查见 [docs/INSTALL.md](docs/INSTALL.md)。

## 设置

进入 **插件 → ChatGPT 订阅**，点击「绑定 ChatGPT 账号」，在浏览器中完成授权，并在授权页允许**使用 ChatGPT 套餐额度**。页面显示「已连接」后，在对话的模型选择器中选择 ChatGPT 模型。如果授权页面没有打开，请允许 DSH 的弹窗。

浏览器只会在插件校验登录信息并连接到 DSH 后显示成功。如果拒绝了套餐额度，这次绑定不会保存，请重新绑定并允许；其他失败请返回插件页查看原因，不要分享登录文件或授权网址。

「重新绑定」重新完成账号授权；「解绑」会撤销刷新令牌，并断开该账号与本插件的连接。插件不会自动使用已有的 Codex CLI 登录。

## 登录信息与更新

授权和模型请求与 OpenAI 官方服务通信。登录信息保存在 DSH 凭据库的 `chatgpt-sub/session` 记录里，只有文件所有者可读写；本机标识保存在 `~/.dsh/dsh-chatgpt-sub/host-id`。官方推理**不会使用** `~/.codex/auth.json`。为了显示额度窗口，插件只在文件**已存在**时复用并续期它，保留原有结构；不会创建这个文件，也不会让推理走它。文件不存在时信息栏只显示账号/套餐/有效期，跑一次 `codex login` 即可启用额度窗口。登录信息只会随授权请求发给 OpenAI，不写入插件日志。

关于额度窗口要多说一句：数字窗口是通过 Codex 官方客户端使用的内部用量接口读取的，该接口没有公开文档，OpenAI 未来可能调整或关闭。介意的用户可以不登录 Codex CLI（或删除 `~/.codex/auth.json`），届时信息栏只显示套餐与有效期。插件代为续期 Codex 登录时很克制——只在文件已有一段时间没被改动时才续；也可以设置 `DSH_CHATGPT_CODEX_QUOTA_KEEP=off`，完全关掉代续期。

解绑和卸载会撤销并删除本插件的路由和它管理的凭据；本机保存的账号注册信息（颁发的 client id 与 host id）会保留，方便下次更快登录。插件自动续期登录。**版本与更新**中，自动更新（默认）在 DSH 启动时检查 npm，校验并替换插件文件，重启后生效；手动模式只检查，安装前需要确认。更新失败会恢复旧文件，需要时可在设置中回滚。本地副本和链接安装需要更新代码并重新构建，见 [docs/INSTALL.md](docs/INSTALL.md)。

## 卸载与回退

桌面客户端在 **插件** 页卸载；命令行网页端执行 `dsh plugin --profile web remove dsh-chatgpt-sub`，然后重启 DSH。卸载会清除本插件的路由和它管理的 DSH 条目。想退回上一版而不卸载：更新失败后、或新版正在等待重启时，可在**版本与更新**里回滚。报告问题时，不要附登录文件、凭据或真实账号信息。

## 语言

插件内置简体中文、繁体中文、英语、日语、韩语、西班牙语、葡萄牙语、法语、德语、意大利语、俄语、印地语和印度尼西亚语。默认跟随 DSH 的语言；也可以在本插件设置页的**语言**中单独选择，选择会保存在当前浏览器。墨西哥西班牙语、巴西葡萄牙语等地区变体使用对应的内置语言；不支持的语言显示英语。

## 开发

- 构建：`npm run build`
- 测试：`node tests/run-all.mjs`
- 贡献指南：[CONTRIBUTING.md](CONTRIBUTING.md)
- 安全问题：[SECURITY.md](SECURITY.md)

## 许可证

[MIT](LICENSE) © 2026 SONGOAO25
