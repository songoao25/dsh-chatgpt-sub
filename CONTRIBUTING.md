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

Release Please manages versions and release notes; its configuration lives in `release-please-config.json` and `.release-please-manifest.json`. Do not manually change package or manifest version fields outside the established release process — a CI guard enforces it (`tests/test-source-guards.mjs`). The whole chain is **fully automatic** since 2026-10-14: owner PRs, **release PRs included**, auto-merge once the required checks pass, and the tag publishes itself. What used to be the human gate is now those machine guards: they block hand-edited version metadata, and block a release PR that strays outside the four version files or leaves `package.json` and the manifest disagreeing. Tags are created only by the release bot, as `vX.Y.Z` with no component prefix — do not create, move or delete tags by hand. Tags trigger npm publication through npm Trusted Publishing (OIDC); publication success must be checked against the public registry, the `latest` tag and the downloadable archive, because neither a green publish job nor a GitHub Release proves the version is publicly installable — the 0.4.0 attempt and the 2026-10-13 staged-only publish both looked green without a public package.

README.md is the English entry point; README.zh-CN.md mirrors it in Chinese. Keep installation claims aligned with published packages and DSH's actual supported installation paths. Public repository files are for users and contributors; exclude private instructions, session records, account data and internal audits.

## Repository framework status

This repository follows the personal GitHub project standard: one workflow per responsibility
(`ci`, `codeql`, `release-please`, `publish-npm`, `verify-npm-release`, `auto-merge-own`),
a seven-section README with a Chinese mirror, SemVer with tags created only by the release bot
(`vX.Y.Z`, no component prefix), npm publishing through Trusted Publishing (OIDC) with no
long-lived npm token, and a fully automatic release chain — release PRs auto-merge, with the
guards in `tests/test-source-guards.mjs` standing in for human confirmation (standard 0.8.8,
section 3.4, 2026-10-14).

Release secrets (GitHub shows no expiry through its API — read the date on the token page and
record the renewal here):

| Name | Purpose | Referenced by | Expires | Last renewed |
| --- | --- | --- | --- | --- |
| `AUTOMATION_TOKEN` | Let the release bot open release PRs, and let the tag it creates trigger publishing | `release-please.yml`, `auto-merge-own.yml` | see the GitHub token page | 2026-09-24 |

The name stays as it is: repository secrets cannot be renamed, so the standard's rule for an
existing repository is to keep the current name, keep a single token per purpose, and register it
here. It is renamed only if it ever has to be regenerated. The npm secrets `NPM_TOKEN` and
`DSH_CHATGPT_SUB_NPM_TOKEN` were deleted on 2026-10-13; publishing no longer uses any long-lived
key.

Known deviations (checked 2026-10-14):

- `.release-please-manifest.json` was seeded by hand with the released version (`0.5.3`) when this
  repository moved from the action's inline `release-type: node` to a config file, because
  release-please requires a manifest at the tip of the branch before its first run. This is the
  documented bootstrap exception; version changes are bot-only from here on.
- **One-off exception to the "never delete a tag" rule (2026-10-13).** `v0.5.2` was tagged and
  released on GitHub but never reached npm: its provenance check failed on a repository-URL case
  mismatch (fixed in #44). The maintainer had the tag and its GitHub Release removed on 2026-10-13
  so the release list matches what npm actually has — the only time this rule has been waived, with
  the reason recorded here. The `CHANGELOG.md` entry for 0.5.2 is kept, so source history is not
  rewritten. From here on a release that goes wrong is corrected by publishing a new version, never
  by deleting tags; and versions increment one by one (npm has `0.5.1` and `0.5.3`).
- npm still lists an inert `0.0.0-stage` placeholder version, created when the first publish was
  staged on 2026-10-13. Removing it needs an interactive 2FA unpublish by the maintainer; it does
  not affect installs because `latest` points at the current release.
- The read-back sentinel does not repair a stale `latest` dist-tag, because changing a dist-tag
  needs credentials and this repository publishes through OIDC without any. If npm drops `latest`,
  the sentinel fails loudly and a maintainer runs
  `npm dist-tag add dsh-chatgpt-sub@<version> latest` by hand.

Any deviation from the standard belongs in this section with a reason and a date.

## Conduct and license

Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Contributions are licensed under [MIT](LICENSE).
