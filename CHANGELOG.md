# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - Unreleased (Current Main)

### Added
- **Chat Widget**: Interactive chat overlay with animations, horizontal layouts, badging, custom CSS, user colors, and giant emote support.
- **Commands**: Implementation of interactive chat commands including `!quote`, `!removequote`, `!duel`, and `!shoutout`.
- **Streaks**: Comprehensive tracking for stream streaks, watch streaks, and channel point redemptions.
- **Infrastructure**: Full Docker support (`Dockerfile` and `docker-compose`) and multi-OS auth support (Windows/macOS).
- **Resilience**: WebSocket reconnection logic, exponential subscription backoff, and strict message deduplication for EventSub.

### Changed
- **Architecture**: Migrated codebase to ECMAScript Modules (ESM) for better portability.
- **Refactoring**: Abstracted TES subscription management (`TesManager`) and local data storage (`QuoteHelper`, `FileCacheService`).

### Fixed
- Stabilized the random quote system and quote indexing crashes.
- Fixed stream streak calculation bugs related to stream offline/online detection.
- Addressed matched method name errors during message deletion and timeouts.

## [1.0.0] - Baseline Release
- Initial release featuring core Twitch IRC connection, basic messaging, and `package.json` initialization.
