# Contributing to DOVIRA

Thanks for wanting to help. DOVIRA is a small open-source project — every contribution, from a typo fix to a feature, is welcome.

## Getting started

```bash
npm install
npm run fetch-binaries   # engine binaries (git-ignored, pinned versions)
npm run dev              # dev shell (Electron + Vite)
```

See README.md for the full build commands (`build:win`, `build:mac`, `build:linux`).

## Ground rules

- **No DRM work, ever.** Nothing that downloads from DRM-protected sites (Netflix, Prime Video, Disney+) or breaks DRM. PRs in that direction will be closed.
- **No tracking, no ads, no pro-lock.** Features must work for every user, free, with nothing phoning home.
- **Rule-based first.** "Smart" features are local rules by default; an AI model is always optional, off by default, and never bundled.
- **Be honest about limits.** If something only works on the next fresh download (not a resume), or only on one OS, say so in the UI and in the PR description.

## Code style

- TypeScript, strict. `npm run build` runs the typecheck — it must pass with 0 errors.
- ESLint must pass with 0 errors (`npx eslint .`), Prettier must be clean (`npx prettier --check .`).
- **Line endings are LF** in the repo (even on Windows). If your editor writes CRLF, the diff will be noisy — set it to LF.
- New user-facing strings go in **both** `src/renderer/src/i18n/en.json` and `bn.json` (same keys, both languages).
- Keep the main/renderer split clean: renderer talks to main only through the preload bridge (`window.dovira`), never directly.

## Tests

- Add or update the phase test report in `docs/` for user-visible changes (what you ran, what passed, what you could not verify).
- Pure logic (the `src/main/smart/` modules especially) should be unit-testable standalone — no Electron imports in them.
- Before opening a PR, run: `npx tsc --noEmit`, `npx eslint .`, `npx prettier --check .`.

## Pull requests

1. Fork the repo, create a branch from `main` (`feat/...` or `fix/...`).
2. Keep the PR focused — one feature or fix per PR.
3. Describe what changed, how you tested it, and what you could **not** verify.
4. A maintainer will review; be ready for a round or two of review comments.

## Good first issues

Look for issues labelled [`good first issue`](https://github.com/Khalid635/dovira/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) — they are small, well-scoped tasks, and a good way to learn the codebase. If you get stuck, ask in the issue; there are no silly questions.

## Translating DOVIRA

To add a new language, see [`docs/translations.md`](docs/translations.md): one dictionary file (`src/renderer/src/i18n/<code>.json`), one `Language` union code and one `AVAILABLE_LOCALES` line. Human translation only — no machine-translated locales.

## Reporting bugs

Use the bug report template (`.github/ISSUE_TEMPLATE/bug_report.md`): what happened, what you expected, steps to reproduce, your OS + DOVIRA version, and the log file if you can (`%APPDATA%\dovira\dovira.log` on Windows, `~/Library/Logs/dovira/dovira.log` on macOS, `~/.config/dovira/dovira.log` on Linux). Never paste tokens, passwords or cookies into an issue.
