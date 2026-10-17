# ChatGPT Subscription

**English** | [**中文**](README.zh-CN.md)

[![License: MIT](https://img.shields.io/github/license/SONGOAO25/dsh-chatgpt-sub)](https://github.com/SONGOAO25/dsh-chatgpt-sub/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/SONGOAO25/dsh-chatgpt-sub)](https://github.com/SONGOAO25/dsh-chatgpt-sub/releases)
[![npm version](https://img.shields.io/npm/v/dsh-chatgpt-sub)](https://www.npmjs.com/package/dsh-chatgpt-sub)

A DeepSeek Harness plugin that connects your ChatGPT account through OpenAI's sign-in page and lets you use the account's available ChatGPT models inside DSH. You need an account with Codex access and sufficient quota. The plugin does not reject Free accounts, but sign-in alone does not establish access to models in DSH; availability depends on OpenAI’s plan, client and model restrictions. See [OpenAI’s current plan information](https://learn.chatgpt.com/docs/pricing).

## What it does

Sign in from the plugin page, then select a model under the **ChatGPT** provider. The plugin maintains the sign-in and shows account status, expiry, and **Sign in again / Unbind** actions. Available models depend on your account and DSH's model support.

The companion [Bottom Info Bar](https://github.com/songoao25/dsh-bottom-info-bar) displays available quota windows and reset times. Both plugins can be installed independently; ChatGPT quota display needs a valid sign-in.

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

Open **Plugins → ChatGPT Subscription** and choose **Sign in with ChatGPT**. Complete authorization in the browser; when the page shows **Connected**, select a ChatGPT model in the conversation model picker. Allow DSH pop-ups if the authorization page does not open.

The browser confirms success only after the plugin has saved the sign-in and connected it to DSH. If that fails, return to the plugin page for the error; do not share sign-in files or authorization URLs.

**Sign in again** renews the binding. **Unbind** disconnects the account from this plugin. An existing Codex CLI sign-in is not automatically adopted by the plugin.

## Sign-in data and updates

Authorization and model requests communicate with official OpenAI endpoints. Sign-in tokens are saved in the standard local `~/.codex/auth.json` file with owner-only permissions and synchronized into DSH's credential store. Signing in can update that shared file, so it can affect which account Codex CLI uses. Tokens are transmitted to OpenAI for authorized requests; they are not written to plugin logs.

Unbinding and uninstalling preserve `~/.codex/auth.json` and remove the plugin's binding and managed DSH entries. The plugin refreshes sign-in automatically. Under **Version and updates**, automatic updates (default) check npm when DSH starts, verify and replace the plugin files, then take effect after a restart. Manual mode checks without installing; installation asks for confirmation. Failed updates restore the previous files, and settings offer rollback when needed. Sign-in data is preserved. Local checkout and linked installs require a code update and rebuild; see [docs/INSTALL.md](docs/INSTALL.md).

## Uninstall and roll back

Remove the plugin from the desktop app's **Plugins** page, or use `dsh plugin --profile web remove dsh-chatgpt-sub` for the CLI web profile, then restart DSH. Uninstalling keeps `~/.codex/auth.json` (the Codex CLI's own sign-in) and removes this plugin's binding and the DSH entries it manages. To go back a version instead of removing the plugin, **Version and updates** offers rollback after a failed update or while a newer build waits for a restart. Do not include sign-in files, credentials, or account details in bug reports.

## Languages

The plugin includes English, Simplified and Traditional Chinese, Japanese, Korean, Spanish, Portuguese, French, German, Italian, Russian, Hindi and Indonesian. It follows DSH’s language by default. Choose **Language** on this plugin’s settings page to use a different language independently; the choice is saved in this browser. Regional variants such as Spanish (Mexico) and Portuguese (Brazil) use the corresponding built-in language. Unsupported languages fall back to English.

## Development

- Build: `npm run build`
- Test: `node tests/run-all.mjs`
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security reports: [SECURITY.md](SECURITY.md)

## License

[MIT](LICENSE) © 2026 SONGOAO25
