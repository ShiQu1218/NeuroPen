# NeuroPen OpenSpec Guide

## What lives here

- `config.yaml`: repo-wide OpenSpec rules for proposals, design docs, and task slicing.
- `specs/`: the source of truth for current product behavior.
- `changes/`: proposal/design/tasks artifacts for non-trivial work.

## Capability map

- `application-shell`: Tauri window model, tray behavior, controller startup, and reusable auxiliary windows.
- `voice-routing`: hotkey capture, STT gating, wake-word detection, and Mode A / B2 / C routing.
- `selection-and-injection`: clipboard preservation, foreground-lock safety, undo, and quick actions.
- `llm-preview-and-screenshot`: preview sessions, direct inject LLM flows, follow-ups, and multimodal screenshot prompts.
- `settings-and-profiles`: persisted settings, secret boundaries, runtime sync, language variants, and app profile merging.
- `local-models-and-tts`: STT/TTS capability discovery, local model lifecycle, and Piper playback.
- `history-and-privacy`: local history persistence, incognito suppression, retention, favorites, search, and delete.

## Architecture snapshot

- Frontend: React 19 + TypeScript + Zustand, with one shared entry that renders by Tauri window label.
- Backend: Rust modules behind Tauri commands plus event-based cross-window synchronization.
- Persistent state: user preferences and app profiles in the frontend store; provider secrets remain in backend-managed storage.
- Runtime-only state: active recording, transient transcripts, preview session state, screenshot attachments, and in-flight LLM output.
- Primary windows: `main`, `settings`, `language-variant-picker`, `preview`, `quick-action`, `recording-indicator`, and `screenshot-overlay`.
- Primary modes:
  - `A`: direct voice input
  - `B1`: quick action on selection
  - `B2`: spoken instruction on selection
  - `C`: assistant query after wake-word routing
- Important cross-window events:
  - `neuropen://settings-saved`
  - `neuropen://preview-session`
  - `neuropen://language-variant-picker-open`
  - `neuropen://language-variant-picker-apply`
  - `stt://final`

## How to prompt AI to use OpenSpec well

1. Tell the AI to read `openspec/config.yaml` first.
2. Name the specific capability specs it must use.
3. Tell it OpenSpec is the source of truth for current behavior.
4. If behavior is changing, tell it to update the relevant specs before or alongside code.
5. If the work is larger than a small bug fix, tell it to create or update artifacts under `openspec/changes/`.

## Prompt templates

### Small bug fix

```text
Read `openspec/config.yaml` and these specs first:
- `openspec/specs/voice-routing/spec.md`
- `openspec/specs/llm-preview-and-screenshot/spec.md`
- `openspec/specs/settings-and-profiles/spec.md`

Treat them as the source of truth. If the current specs are missing behavior needed for this fix, update the relevant specs. Then implement the fix and verify it.
```

### Feature work

```text
Use OpenSpec for this change. Start by reading `openspec/config.yaml` and the relevant specs. If this feature changes product behavior, update the affected specs first. If the scope is non-trivial, create proposal/design/tasks under `openspec/changes/<change-name>/` before implementation.
```

### Architecture or debugging question

```text
Answer this by using `openspec/config.yaml` and the relevant files under `openspec/specs/` first. If the current code disagrees with OpenSpec, call out the mismatch explicitly and suggest which spec should change.
```

## Prompting tips for this repo

- Mention capability names exactly as they appear under `openspec/specs/`.
- For cross-cutting changes, list every affected capability instead of saying "read OpenSpec".
- If the change touches both React and Rust, explicitly ask the AI to describe Tauri commands, emitted events, persistence boundaries, and window interactions.
- If you want implementation plus docs, say so directly: "update OpenSpec and code".
