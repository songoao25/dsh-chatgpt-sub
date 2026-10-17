# ChatGPT 订阅

[**English**](README.md) | **中文**

[![License: MIT](https://img.shields.io/github/license/SONGOAO25/dsh-chatgpt-sub)](https://github.com/SONGOAO25/dsh-chatgpt-sub/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/SONGOAO25/dsh-chatgpt-sub)](https://github.com/SONGOAO25/dsh-chatgpt-sub/releases)
[![npm 版本](https://img.shields.io/npm/v/dsh-chatgpt-sub)](https://www.npmjs.com/package/dsh-chatgpt-sub)

一个 DeepSeek Harness 插件：通过 OpenAI 登录页面连接 ChatGPT 账号，在 DSH 中使用该账号可用的 ChatGPT 模型。需要账号有 Codex 使用权限和足够的额度。插件不会拒绝免费账号，但登录成功不代表能在 DSH 中使用模型；实际可用性取决于 OpenAI 对套餐、客户端和模型的限制，见 [OpenAI 当前套餐说明](https://learn.chatgpt.com/docs/pricing)。

## 功能

在插件页登录，再选择提供商 **ChatGPT** 下的模型即可对话。插件自动维护登录状态，并显示账号、有效期以及「重新绑定 / 解绑」操作。可用模型取决于账号套餐和 DSH 的模型支持。

配套的[底部信息栏](https://github.com/songoao25/dsh-bottom-info-bar)显示可读取的额度窗口与重置时间。两个插件可以分别安装；ChatGPT 额度显示需要有效登录。

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

进入 **插件 → ChatGPT 订阅**，点击「绑定 ChatGPT 账号」，在浏览器中完成授权。页面显示「已连接」后，在对话的模型选择器中选择 ChatGPT 模型。如果授权页面没有打开，请允许 DSH 的弹窗。

浏览器只会在插件保存登录信息并连接到 DSH 后显示成功。失败时请返回插件页查看原因，不要分享登录文件或授权网址。

「重新绑定」重新完成账号授权；「解绑」断开该账号与本插件的连接。插件不会自动使用已有的 Codex CLI 登录。

## 登录信息与更新

授权和模型请求与 OpenAI 官方服务通信。登录信息保存在本机标准位置 `~/.codex/auth.json`，只有文件所有者可读写，并同步到 DSH 的凭据库。绑定会更新这个共用文件，因此可能改变 Codex CLI 使用的账号。登录信息会随授权请求传给 OpenAI，不写入插件日志。

解绑和卸载保留 `~/.codex/auth.json`，清除本插件的绑定和它管理的 DSH 条目。插件自动续期登录。**版本与更新**中，自动更新（默认）在 DSH 启动时检查 npm，校验并替换插件文件，重启后生效；手动模式只检查，安装前需要确认。更新失败会恢复旧文件，需要时可在设置中回滚。登录信息会保留。本地副本和链接安装需要更新代码并重新构建，见 [docs/INSTALL.md](docs/INSTALL.md)。

## 卸载与回退

桌面客户端在 **插件** 页卸载；命令行网页端执行 `dsh plugin --profile web remove dsh-chatgpt-sub`，然后重启 DSH。卸载会保留 `~/.codex/auth.json`（Codex CLI 自己的登录态），清除本插件的绑定和它管理的 DSH 条目。想退回上一版而不卸载：更新失败后、或新版正在等待重启时，可在**版本与更新**里回滚。报告问题时，不要附登录文件、凭据或真实账号信息。

## 语言

插件内置简体中文、繁体中文、英语、日语、韩语、西班牙语、葡萄牙语、法语、德语、意大利语、俄语、印地语和印度尼西亚语。默认跟随 DSH 的语言；也可以在本插件设置页的**语言**中单独选择，选择会保存在当前浏览器。墨西哥西班牙语、巴西葡萄牙语等地区变体使用对应的内置语言；不支持的语言显示英语。

## 开发

- 构建：`npm run build`
- 测试：`node tests/run-all.mjs`
- 贡献指南：[CONTRIBUTING.md](CONTRIBUTING.md)
- 安全问题：[SECURITY.md](SECURITY.md)

## 许可证

[MIT](LICENSE) © 2026 SONGOAO25
