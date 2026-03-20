# Changelog

All notable changes to SlyCode will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
