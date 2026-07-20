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
