# ChatGPT Subscription

**English** | [**中文**](README.zh-CN.md)

[![License: MIT](https://img.shields.io/github/license/SONGOAO25/dsh-chatgpt-sub)](https://github.com/SONGOAO25/dsh-chatgpt-sub/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/SONGOAO25/dsh-chatgpt-sub)](https://github.com/SONGOAO25/dsh-chatgpt-sub/releases)

A DeepSeek Harness plugin that connects your ChatGPT account through OpenAI's sign-in page and lets you use the account's available ChatGPT models inside DSH. You need a plan that includes Codex access and sufficient subscription quota.

## What it does

Sign in from the plugin page, then select a model under the **ChatGPT** provider. The plugin maintains the sign-in and shows account status, expiry, and **Sign in again / Unbind** actions. Available models depend on your account and DSH's model support.

The companion [Bottom Info Bar](https://github.com/songoao25/dsh-bottom-info-bar) displays available quota windows and reset times. Both plugins can be installed independently; ChatGPT quota display needs a valid sign-in.

## Install

Recommended: open **Plugins → Add plugin** in DSH and paste this repository address:

```
https://github.com/SONGOAO25/dsh-chatgpt-sub
```

Prefer the terminal? For a CLI web profile:

```bash
dsh plugin --profile web add https://github.com/SONGOAO25/dsh-chatgpt-sub
```

Then **restart DSH**. Refreshing the page is not enough. In the desktop app, use **Plugins → Add plugin**; its profile is managed by the app and cannot be installed into through the CLI. DSH uses pnpm to install plugins; the repository includes its built files and requires no installation build.

**npm availability:** the public registry returned no package for `dsh-chatgpt-sub` on 2026-10-10. Use the repository address until a successful npm release is verified. After publication, the package-name command will be:

```bash
dsh plugin --profile web add dsh-chatgpt-sub
```

Local installs, Windows guidance, updating and troubleshooting: [docs/INSTALL.md](docs/INSTALL.md).

## Settings

Open **Plugins → ChatGPT Subscription** and choose **Sign in with ChatGPT**. Complete authorization in the browser; when the page shows **Connected**, select a ChatGPT model in the conversation model picker. Allow DSH pop-ups if the authorization page does not open.

**Sign in again** renews the binding. **Unbind** disconnects the account from this plugin. An existing Codex CLI sign-in is not automatically adopted by the plugin.

## Sign-in data and updates

Authorization and model requests communicate with official OpenAI endpoints. Sign-in tokens are saved in the standard local `~/.codex/auth.json` file with owner-only permissions and synchronized into DSH's credential store. Signing in can update that shared file, so it can affect which account Codex CLI uses. Tokens are transmitted to OpenAI for authorized requests; they are not written to plugin logs.

Unbinding and uninstalling preserve `~/.codex/auth.json` and remove the plugin's binding and managed DSH entries. The plugin refreshes sign-in automatically, but **plugin updates are manual**: install the same repository address again and restart DSH. Local checkout installs need a code update and rebuild; see [docs/INSTALL.md](docs/INSTALL.md).

Remove the plugin from the desktop app's **Plugins** page, or use `dsh plugin --profile web remove dsh-chatgpt-sub` for the CLI web profile. Do not include sign-in files, credentials, or account details in bug reports.

## Development

- Build: `npm run build`
- Test: `node tests/run-all.mjs`
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security reports: [SECURITY.md](SECURITY.md)

## License

[MIT](LICENSE) © 2026 SONGOAO25
