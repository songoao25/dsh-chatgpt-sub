# Contributing

Report reproducible bugs in [Issues](https://github.com/songoao25/dsh-chatgpt-sub/issues). Include DSH and plugin versions, operating system, installation method, steps, expected behavior and actual behavior. Discuss substantial features before implementing them.

For security vulnerabilities, follow [SECURITY.md](SECURITY.md) rather than opening a public issue. Never attach credentials, sign-in files, conversation content or personal account data.

## Structure

- `src/host.js`: account binding, sign-in maintenance, provider registration and RPC.
- `src/client-bundle.js`: the plugin configuration page.
- `scripts/build.mjs`: generates the host and client bundles in `lib/`.
- `locale/`: plugin display-name and description dictionaries.
- `tests/`: behavior and packaging checks.
- `docs/INSTALL.md`: installation, updates and troubleshooting.

The repository root is the installable package. Generated `lib/` files are committed so a repository-address installation requires no build approval. Edit source files and rebuild; do not edit generated files directly.

## Checks

```bash
npm run build
node tests/run-all.mjs
git diff --check
npm pack --dry-run
```

Use existing dependencies. Keep tests isolated from real accounts, credentials and user files. Declare host services through injection before reading them; unavailable services must not make the configuration page disappear. Keep `prepublishOnly` as the publishing hook; do not add installation lifecycle scripts such as `prepare`, `prepack` or `postinstall`.

Account tokens belong only in the local sign-in file and DSH credential store. Binding must complete through the plugin's authorization flow; do not silently adopt another application's login. Keep existing user-managed providers and credentials intact. Unbinding and uninstalling preserve the shared Codex login file.

## Pull requests and releases

Use a focused branch and [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). Describe the user-visible change, checks performed and remaining verification gaps. External contributions need maintainer review.

Release Please manages versions and release notes. Do not manually change package or manifest version fields outside the established release process. Owner code PRs may auto-merge after required checks; release PRs are excluded and require maintainer confirmation. Tags trigger npm publication; publication success must be checked against the public registry and downloadable archive. The 0.4.0 npm publishing attempt failed, so a GitHub Release alone does not establish npm availability.

README.md is the English entry point; README.zh-CN.md mirrors it in Chinese. Keep installation claims aligned with published packages and DSH's actual supported installation paths. Public repository files are for users and contributors; exclude private instructions, session records, account data and internal audits.

## Conduct and license

Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Contributions are licensed under [MIT](LICENSE).
