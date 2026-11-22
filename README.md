# ChatGPT Subscription

**English** | [**中文**](README.zh-CN.md)

[![License: MIT](https://img.shields.io/github/license/SONGOAO25/dsh-chatgpt-sub)](https://github.com/SONGOAO25/dsh-chatgpt-sub/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/SONGOAO25/dsh-chatgpt-sub)](https://github.com/SONGOAO25/dsh-chatgpt-sub/releases)
[![npm version](https://img.shields.io/npm/v/dsh-chatgpt-sub)](https://www.npmjs.com/package/dsh-chatgpt-sub)
[![npm downloads](https://badgen.net/npm/dt/dsh-chatgpt-sub?label=downloads)](https://www.npmjs.com/package/dsh-chatgpt-sub)
[![npm monthly downloads](https://badgen.net/npm/dm/dsh-chatgpt-sub?label=downloads%2Fmonth)](https://www.npmjs.com/package/dsh-chatgpt-sub)
[![GitHub stars](https://img.shields.io/github/stars/songoao25/dsh-chatgpt-sub)](https://github.com/songoao25/dsh-chatgpt-sub/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/songoao25/dsh-chatgpt-sub)](https://github.com/songoao25/dsh-chatgpt-sub/forks)

A DeepSeek Harness plugin that connects your ChatGPT account through OpenAI's official **Sign in with ChatGPT** flow (ChatGPT plan usage for open-source clients) and lets you use the models available to that account inside DSH.

You need an eligible **ChatGPT Plus or Pro** account and must allow this app to use your plan during sign-in. Free, Team, Enterprise and Edu plans are not part of OpenAI's current preview. If you distribute this plugin in a paid or remotely hosted product, apply through OpenAI's [interest form](https://openai.com/form/sign-in-with-chatgpt-interest/); open-source and locally hosted use follows the automatic path described in [OpenAI's SIWC documentation](https://developers.openai.com/siwc/token-sharing-open-source).

## What it does

Sign in from the plugin page, then select a model under the **ChatGPT** provider. The plugin keeps the sign-in alive, shows the account and expiry, and offers **Sign in again / Unbind**.

Models come from the signed-in account's own catalog, so the picker reflects what that plan can actually use. The first sign-in registers this installation as an agent named **DSH ChatGPT 订阅**; you can review or revoke it in ChatGPT **Settings → Connections** (or **Settings → Usage** for per-app limits).

The companion [Bottom Info Bar](https://github.com/songoao25/dsh-bottom-info-bar) reads this plugin's account registration and, when a Codex login file exists on the machine, queries the Codex usage endpoint for 5-hour / weekly / monthly windows. If no Codex login exists, it shows the connected account, plan and expiry and links to ChatGPT's usage page. Per-app weekly limits are managed by the user in ChatGPT settings, not by this plugin.

## Install

**Recommended: install from npm through DSH.** Open **Plugins → Add plugin** in DSH and enter the package name:

```
dsh-chatgpt-sub
```

DSH looks the name up on npm and installs it with pnpm — no repository checkout, no build step. The package has been public on npm since 2026-10-13.

For a CLI web profile:

```bash
dsh plugin --profile web add dsh-chatgpt-sub
```

If npm cannot be reached, use the repository address instead — `lib/` is committed, so that path needs no build either:

```
https://github.com/SONGOAO25/dsh-chatgpt-sub
```

Then **restart DSH**. Refreshing the page is not enough. In the desktop app, use **Plugins → Add plugin**; its profile is managed by the app and cannot be installed into through the CLI.

Local installs, Windows guidance, updating and troubleshooting: [docs/INSTALL.md](docs/INSTALL.md).

## Settings

Open **Plugins → ChatGPT Subscription** and choose **Connect ChatGPT account**. Complete authorization in the browser and allow **use ChatGPT plan**; when the page shows **Connected**, select a ChatGPT model in the conversation model picker. Allow DSH pop-ups if the authorization page does not open.

The browser confirms success only after the plugin has validated the sign-in and connected it to DSH. If plan usage is declined, the binding is not saved; run it again and allow it. If that fails, return to the plugin page for the error; do not share sign-in files or authorization URLs.

**Sign in again** renews the binding. **Unbind** revokes the refresh token and disconnects the account from this plugin. An existing Codex CLI sign-in is not adopted by the plugin.

## Sign-in data and updates

Authorization and model requests communicate with official OpenAI endpoints. Tokens are stored in DSH's credential store under `chatgpt-sub/session` with owner-only permissions; the host identifier lives in `~/.dsh/dsh-chatgpt-sub/host-id`. Official inference never uses `~/.codex/auth.json`. For numeric quota windows, the plugin reuses and refreshes an **existing** Codex login file when present, preserving its structure; it never creates that file and never routes inference through it. If the file is absent, the info bar shows account/plan/expiry only, and running `codex login` once enables the windows. Tokens are sent to OpenAI only for authorized requests and are not written to plugin logs.

One caveat about those numeric windows: they are read through an internal usage endpoint used by OpenAI's own Codex client. That endpoint is not publicly documented, and OpenAI may change or close it at any time. If you would rather not rely on it, do not sign in to Codex CLI (or delete `~/.codex/auth.json`) — the info bar will then show plan and expiry only. The plugin refreshes the Codex login conservatively, only when the file has been untouched for a while, and you can turn that keep-alive off entirely with `DSH_CHATGPT_CODEX_QUOTA_KEEP=off`.

Unbinding and uninstalling revoke and remove the plugin's route and managed credentials; the local account registration (issued client id and host id) is kept for a faster next sign-in. The plugin refreshes the sign-in automatically. Under **Version and updates**, automatic updates (default) check npm when DSH starts, verify and replace the plugin files, then take effect after a restart. Manual mode checks without installing; installation asks for confirmation. Failed updates restore the previous files, and settings offer rollback when needed. Local checkout and linked installs require a code update and rebuild; see [docs/INSTALL.md](docs/INSTALL.md).

## Uninstall and roll back

Remove the plugin from the desktop app's **Plugins** page, or use `dsh plugin --profile web remove dsh-chatgpt-sub` for the CLI web profile, then restart DSH. Uninstalling removes this plugin's route and the DSH entries it manages. To go back a version instead of removing the plugin, **Version and updates** offers rollback after a failed update or while a newer build waits for a restart. Do not include sign-in files, credentials, or account details in bug reports.

## Languages

The plugin includes English, Simplified and Traditional Chinese, Japanese, Korean, Spanish, Portuguese, French, German, Italian, Russian, Hindi and Indonesian. It follows DSH’s language by default. Choose **Language** on this plugin’s settings page to use a different language independently; the choice is saved in this browser. Regional variants such as Spanish (Mexico) and Portuguese (Brazil) use the corresponding built-in language. Unsupported languages fall back to English.

## Development

- Build: `npm run build`
- Test: `node tests/run-all.mjs`
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security reports: [SECURITY.md](SECURITY.md)

## License

[MIT](LICENSE) © 2026 SONGOAO25
