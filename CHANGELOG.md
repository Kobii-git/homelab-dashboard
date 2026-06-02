# Changelog

All notable changes are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-06-02

Initial release.

### Added

**Core**
- Dashboard with grouped resource cards, collapsible sections, and configurable widgets
- Health checks: HTTP, TCP, and ping monitors with configurable intervals and failure thresholds
- Incident management: auto-open on check failure, acknowledge, resolve, and mute
- Maintenance windows to suppress incident noise during planned downtime
- Alert channels (webhook, email) with rules, cooldowns, and delivery tracking
- AES-256-GCM credential vault with folder and tag organisation
- Browser-based SSH and RDP sessions via Apache Guacamole `guacd` tunnel
- Session history and audit log
- Freeform notes, pinned and per-resource
- Command palette (Ctrl K / `/`) with global search
- Single-admin cookie-based authentication

**UI**
- Dark theme, responsive sidebar, sticky top bar
- Favorites section on Dashboard showing starred resources
- Explicit Details button on resource tiles (replaces hidden double-click)
- Incident History panel showing all incidents with status badges
- Recent Sessions strip in the Access rail
- Active nav item accent indicator
- Spinning icon on refresh indicator
- Correct icon for Resolve action

**Infrastructure**
- Docker image published to `ghcr.io/kobii-git/homelab-dashboard`
- `SEED_DEMO=true` environment variable loads demo resources, checks, credentials, incidents, and notes on first start
- GitHub Actions workflow builds and pushes image on every push to `main` and on version tags
- `docker-compose.yml` (pull image) and `docker-compose.build.yml` (build locally)
