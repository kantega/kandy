# Contributing to Kandy

Kandy is an internal Kantega tool, forked from
[Handy](https://github.com/cjpais/Handy) (MIT). No external contributions.
Upstream is the `upstream` remote if you need to pull fixes.

## Setup

See [BUILD.md](BUILD.md). Short version:

```bash
bun install
bun run tauri dev
```

Architecture and conventions live in [AGENTS.md](AGENTS.md).

## Before you push

```bash
bun run lint:fix
bun run format
bunx tsc --noEmit
bun run check:translations
cd src-tauri && cargo clippy && cargo test
```

Then run the app and confirm recording and transcription still work on
your platform.

## Code style

- **Rust:** explicit errors with `anyhow` context, no `unwrap` on
  reachable paths, doc comments on public items.
- **TypeScript:** strict, no `any`, functional components, Tailwind,
  `@/` alias. Every user-facing string goes through i18next; ESLint
  enforces it.
- No history comments in code. What used to be there belongs in git.

## Translations

Two locales, `en` (source) and `nb`. Add every key to both
`src/i18n/locales/en/translation.json` and `nb/translation.json`, then run
`bun run check:translations`. The `tray.*` keys are also a build input:
`src-tauri/build.rs` generates the Rust tray strings from them. Delete keys
from both files when the code that used them goes.

## Branches, commits, PRs

- `feature/<name>` or `bugfix/<name>`, one change per PR.
- Conventional prefixes: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`.
  Say why, not what.
- Fill in [the PR template](.github/PULL_REQUEST_TEMPLATE.md), including
  the AI assistance disclosure.

## Versioning

Nothing bumps the version for you. Before a release, set the same number in
`package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`
(then run `cargo check` so `Cargo.lock` follows). The release workflow reads the version from
`tauri.conf.json` and tags `v<version>`. Minor bump when features change,
patch for fixes only.

## Bugs

Kantega Slack for quick things, a
[GitHub issue](https://github.com/kantega/kandy/issues) for anything that
needs tracking. Include version, OS, hardware, steps, and the log from the
directory shown under **Om**.

## License

MIT. Original copyright CJ Pais; Kantega changes under the same license.
