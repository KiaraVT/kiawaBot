# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Fork pull request support for Euler quality review and Foucault security review gated by the `safe-to-review` label and `fork-review` GitHub environment approval before decrypting `OLLAMA_API_KEY`.

### Changed
- Configured CI workflow to trigger validation on `pull_request` labeled events when tagged with `safe-to-review`, preserving in-progress validation runs across label events.
- Review workflows fetch current pull request labels, fail closed when label lookup fails, and populate all output parameters across exit paths.
- Review jobs support both `OLLAMA_API_KEY` and `MODEL_API_KEY` environment secret names.
- Annotation runs only after the review job for the resolved repository type succeeds.

## [2.3.0] - 2026-10-08

### Added
- Automated unit test suites for `AuthDataHelper`, `IncentiveHelper`, `QuoteHelper`, and webserver endpoints.
- Continuous integration pipelines running secret detection, dependency audit gating, ESLint, and policy drift verification.
- Comprehensive repository documentation (`README.md` and `AGENTS.md`).

### Changed
- Upgraded web framework from Express 4.21 to Express 5.2.
- Updated Twitch chat integration documentation to reflect EventSub WebSocket (`tesjs`) and Helix REST API.

### Fixed
- Fixed unreachable default file creation conditional branch in `getStreamInfo()`.
- Fixed `ReferenceError` on undeclared `replacementSub` in `TesManager.#repairSubscriptions()`.
- Fixed early-return control flow bug in `.forEach()` loops across `AuthDataHelper` and `IncentiveHelper` by migrating to `for...of` loops.
- Fixed redundant duplicate message dispatch in `updateStreaks()`.

### Removed
- Removed unused `tmi.js` (Twitch IRC) dependency and `IRC_OAUTH` environment variable.
- Deleted orphaned dead file `FileCacheService.js` and removed unreferenced `constructorIncentive()` method.

## [2.2.0] - 2026-08-08

### Security
- Bound web server listeners explicitly to local loopback interface (`127.0.0.1`).
- Enforced input validation and numeric bounds on incentive and quote parameters.
- Sanitized HTML dashboard output and restricted CORS headers to prevent cross-site scripting (XSS).
- Added duel queue length bounds and transitioned coin flips to cryptographically secure PRNG (`crypto.randomInt`).

## [2.1.0] - 2026-06-27

### Added
- Broadcaster-only `!removequote` chat command.
- Streamer shoutout command (`!so`).
- Animated and horizontal overlay layouts for the OBS Studio browser widget.
- Atomic sync file writing (`writeAtomicSync`) for stream streak persistence.

## [2.0.0] - 2026-01-16

### Changed
- Migrated codebase architecture from CommonJS (`require`) to ECMAScript Modules (ESM `import`).
- Replaced `dotenv` dependency with Node.js native `--env-file` configuration loading.
- Relocated OBS chat overlay asset to `webserver/www/chatwidget.html`.
- Added Docker containerization and Docker Compose supervisor configurations.

## [1.0.0] - 2025-05-06

### Added
- Initial KiaraBot release featuring Twitch chat interactivity and OBS browser source overlay.
- Quote management system (`!quote`, `!addquote`, `!editquote`).
- Viewer attendance stream streak tracking (`streaks.json`).
- Live stream donation goal incentive tracking (`!addincentive`, `!updateincentive`).
- Twitch EventSub WebSocket integration (`tesjs`) and OAuth authorization flow.
