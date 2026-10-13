# TODO: Open-source release readiness

Target: a self-hosted beta for trusted users, followed by a stable release after real installation feedback. This checklist tracks release work; completed feature tasks remain in tasks/.

## Before the first public beta

- [ ] **Required — License:** MIT LICENSE and matching package/lockfile metadata added. Confirm ownership and third-party/native notice requirements before publication; see THIRD_PARTY_NOTICES.md.
- [x] **High — CI:** workflow runs npm ci, npm run build, npm test and release:check on pull requests and main, on Windows/Linux/macOS with Node 24.17.0 and latest Node 24. Hosted results remain pending.
- [ ] **High — Live verification:** test a clean installation, command registration and removal of the legacy /codex command, and the documented Codex/Claude/Gemini versions. Verify authorization, private replies, disabled mentions, provider/project isolation, profile changes, scheduling, and restart behavior. Record tested versions/platforms and capture screenshots without private content.
- [ ] **High — Security policy:** SECURITY.md documents support, private GitHub reporting and the trust/permission model. Repository owner must enable and test the private reporting channel before publication.
- [ ] **High — Publication review:** heuristic source/private-path scan and npm package dry-run passed; credential/runtime exclusions checked; npm audit reported zero advisories. License inventory and native notice limitations recorded. Full history/artifact/ownership/platform notice review remains pending.
- [ ] **Medium — Onboarding:** English quickstart added with minimal Codex-only setup, platform/version status, Discord setup and first task. Real sanitized screenshots remain pending.
- [x] **Medium — Contributions:** CONTRIBUTING.md covers setup, offline tests, conventions, bug reports and pull requests.
- [x] **Medium — Beta release notes:** prepared 1.0.0-beta.1 / proposed v1.0.0-beta.1 tag, with installation/upgrades and known limitations in docs/release-notes.md. No release/tag has been published.

## Before a stable release

- [ ] **High — Graceful shutdown:** implemented SIGINT/SIGTERM admission closure, active task/reply draining, durable schedule completion and Discord closure. Offline persistence/gate tests pass; real signal/restart/provider tests on supported platforms remain pending.
- [ ] **High — Validate real usage:** resolve significant defects from beta installation and provider compatibility reports, then repeat the release smoke tests on supported configurations.
- [x] **Medium — Setup diagnostics:** npm run doctor checks configuration/directories, enabled CLI versions and auth indicators with bounded shell-free probes, fixed summaries and no model requests. Gemini credential freshness/model access require operator verification.

## Later improvements

- [ ] Persist session references and saved results across restarts with explicit retention and privacy rules.
- [ ] Add cancellation of active tasks with process-tree cleanup and clear partial-change behavior.
- [ ] Consider a bounded task queue while retaining the single-worker guarantee.

## Current verification baseline

On 2026-10-13 the Node 24.21.0 Windows build passed. Standard npm test was blocked by piped child-process EPERM restrictions in this environment; 88 config/session/schedule/registration/help/init tests and 12 doctor/shutdown tests passed via temporary transpilation and in-process execution. The process-dependent tests still need an unrestricted run. npm audit reported zero advisories; heuristic release scanning and package exclusion checks passed. Live Discord/provider verification (including /ai init), hosted CI, screenshots, ownership/private-reporting activation and full publication review remain outstanding. See docs/release-verification.md for evidence and reproducible smoke tests. Revalidate the final candidate before publication.
