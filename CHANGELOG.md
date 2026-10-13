# Changelog

This project uses a simple changelog format inspired by Keep a Changelog.

## [Unreleased]

### Added

- Public contributor guidance in `CONTRIBUTING.md`
- Repository conduct expectations in `CODE_OF_CONDUCT.md`
- GitHub issue and pull request templates
- Public roadmap in `ROADMAP.md`

### Changed

- README and `README.zh-TW.md` now surface contribution flow, roadmap, changelog, and maintainer expectations

## [0.3.5] - 2026-10-14

### Added

- Hands-free recording mode: press the recording hotkey once to start and again to finish, selectable under Settings → General → Shortcuts alongside the existing hold-to-speak mode
- Finish and Cancel buttons on the recording indicator; Cancel discards the captured audio without transcription or upload and restores the clipboard

### Changed

- LLM refinement of dictated text now removes filler words and stutters, follows spoken self-corrections, formats explicit lists and email structure, and treats the transcript as content rather than instructions
- The ready status text no longer assumes hold-to-speak, and the new recording strings are translated for all locales

### Removed

- Upload document button from the preview quick-action presets

## [0.3.4] - 2026-10-11

### Added

- OpenAI GPT Transcribe as the default cloud speech-to-text model, with GPT-4o Mini Transcribe as a lower-cost option
- zh-TW introduction video build scripts under `scripts/intro-video/`

### Changed

- Cloud transcription now sends one final request after the recording hotkey is released; existing `whisper-1` settings upgrade to GPT Transcribe automatically
- All locales are synchronized with the Traditional Chinese source strings, and the preference clearing label now states that it deletes data
- Development builds emit less debug output and keep build artifacts inside the project directory

### Fixed

- Quick Actions stay available in fullscreen editors and maximized browsers
- Reduced passive mouse tracking overhead while games are in the foreground
- LLM streaming now handles mid-stream errors and completion markers
- Preview replacement targets are preserved across repeated actions and dialog replacements
- Status messages no longer take focus from the screenshot overlay and cancel the selection
- Hardened clipboard, hotkey, injection, focus locking, history, preference learning, TTS, and undo workflows
- Stabilized state synchronization across the main, preview, and history windows

## [0.3.3] - 2026-07-20

### Added

- Tray menu controls for switching the active LLM provider and model without opening Settings
- OpenRouter as a supported LLM provider
- On-demand local model refresh from the tray for Ollama, llama.cpp, and LM Studio

### Changed

- LLM provider-specific model choices now stay synchronized across the tray, Settings, and active windows
- Selection Quick Action detection now requires a deliberate text-selection gesture and validates visible selection geometry before showing the launcher
- Assistant chat and preview output preserve the model response structure more faithfully

### Fixed

- Stabilized LM Studio requests that use retained document attachments
- Hardened attachment imports and refreshed audited dependencies
- Updated the Windows Whisper build dependency path for improved bindgen compatibility

## [0.2.6] - 2026-03-14

### Notes

- `0.2.6` is the current published application version at the time this changelog was introduced.
- Historical release details before this file existed have not been backfilled yet.
