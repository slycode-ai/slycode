# Changelog

All notable changes to SlyCode will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.21] - 2026-03-29

### Changed
- PTY handler updates
- Messaging service improvements (STT, core)
- Scaffold updates
- Projects API route and card modal updates

## [0.2.20] - 2026-03-25

### Changed
- Bridge claude-utils and PTY handler updates
- CLI update command improvements
- Terminal component updates

## [0.2.19] - 2026-03-25

### Added
- Asset viewer component
- MCP common utilities
- Provider paths utility

### Changed
- CLI assets routes (assistant, store, sync)
- Store scanner and asset scanner updates
- Store view and CLI assets tab improvements
- Kanban CLI updates

## [0.2.18] - 2026-03-23

### Changed
- Web app layout updates

## [0.2.17] - 2026-03-23

### Changed
- PTY handler updates

## [0.2.16] - 2026-03-22

### Changed
- Bridge session manager updates
- Messaging service improvements (bridge-client, telegram, state, types)
- Scheduler updates
- Claude terminal panel updates

## [0.2.15] - 2026-03-22

### Added
- Service detection module

### Changed
- Service management updates for Linux/macOS
- Bridge claude-utils and PTY handler updates
- CLI restart, start, and update command improvements
- Claude terminal panel updates

### Fixed
- Remove stale node_modules from public repo

## [0.2.14] - 2026-03-22

### Changed
- Bridge session manager and types updates
- Terminal and Claude terminal panel improvements
- Kanban CLI script updates

## [0.2.13] - 2026-03-21

### Fixed
- Stop CLI command improvements

### Changed
- Messaging state handling updates

## [0.2.12] - 2026-03-20

### Fixed
- Build pipeline: handle symlinks in Next.js standalone output

### Changed
- Messaging STT and types updates
- Scaffold and transcribe route updates
- Dependency updates

## [0.2.11] - 2026-03-20

### Changed
- Transcribe API route updates
- Voice control bar improvements
- Dependency updates (messaging, web)

## [0.2.10] - 2026-03-20

### Added
- Restart CLI command

### Changed
- Service management updates for Linux/macOS
- Build pipeline: dist/store filtered to manifest skills/actions only

### Fixed
- Voice recorder hook

## [0.1.0] - 2026-02-19

### Added
- slycode CLI: start/stop services, doctor diagnostics, system service install/remove, skills management
- create-slycode scaffolding: npx create-slycode to bootstrap a new workspace
- Web command center: kanban board with drag-and-drop, card modals with document tabs, project views, real-time SSE updates
- Terminal bridge: PTY session management, WebSocket streaming, session persistence
- Messaging service: Telegram channel with voice (TTS/STT), command routing, kanban integration
- Skills system: 7 built-in skills — checkpoint, context-priming, design, feature, implement, kanban, messaging
- Build toolchain: build-package, manifest-driven export, 7-point safety checks
- Platform support: Linux systemd, macOS launchd, Windows service installers
