# Contributing to NeuroPen

Thanks for considering a contribution. NeuroPen is a Windows-first Tauri application with a React/TypeScript frontend and a Rust backend, so the fastest way to keep reviews efficient is to keep changes scoped and explicit.

## Before You Start

- Read `openspec/config.yaml` first.
- Treat `openspec/specs/*` as the source of truth for product behavior.
- If your change modifies behavior, update the affected spec before changing code.
- For larger features, architecture changes, or cross-window workflows, open an issue before writing a large PR.

## Good First Contributions

These are usually the easiest places to start:

- Documentation fixes and translation consistency
- UI copy and i18n improvements
- Small React component or settings-page refinements
- Isolated Rust command fixes with a clear reproduction
- Tests for existing helpers, commands, or regression cases

## Local Setup

1. Install the pinned toolchain:
   - Node.js `24.14.0`
   - npm `11.9.0`
   - Rust `1.93.1`
   - Windows 10/11
2. Run:

```powershell
npm run doctor
npm ci
```

3. Start the desktop app:

```powershell
npm run tauri dev
```

4. Run validation before opening a PR:

```powershell
npm run check
```

If you are touching GPU-enabled local STT flows, also verify:

```powershell
npm run doctor:gpu
```

## OpenSpec Workflow

Use the capability folders under `openspec/specs/` when describing your change. Examples include:

- `application-shell`
- `history-and-privacy`
- `llm-preview-and-screenshot`
- `local-models-and-tts`
- `selection-and-injection`
- `settings-and-profiles`
- `voice-routing`

When behavior changes, your PR should make it easy to answer:

- Which capability spec changed?
- What requirement changed?
- How was the change validated?

## Pull Request Guidelines

- Keep each PR focused on one problem.
- Prefer English for commit messages, PR titles, and code review discussion.
- Update docs when the developer workflow, release process, or public behavior changes.
- Add or update tests when fixing regressions or changing non-trivial logic.
- Call out Windows-only assumptions, privacy implications, and Tauri command changes when relevant.

## Validation Expectations

Pick the smallest useful validation set for the files you changed:

- `npm run build` for frontend-facing changes
- `npm run test` for Rust/backend logic changes
- `npm run check` before opening or updating a PR

If you cannot run one of these commands, state that clearly in the PR description.

## Review Expectations

- Small fixes and docs PRs are preferred over broad refactors.
- Reviewers may ask for spec updates before code review if behavior changed.
- Maintainers aim to triage new issues and PRs within about one week when the project is actively monitored, but response time is not guaranteed.

## Code of Conduct

By participating, you agree to follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
