# TODO: Open-source release readiness

Target: a self-hosted beta for trusted users, followed by a stable release after real installation feedback. This checklist tracks release work; completed feature tasks remain in tasks/.

## Before the first public beta

- [ ] **Required — License:** choose an open-source license, add LICENSE, and set matching package metadata. Confirm ownership and third-party notice requirements before publication.
- [ ] **High — CI:** run npm ci, npm run build, and npm test on pull requests and the main branch using a supported Node.js version. Cover Windows and each additional OS claimed as supported.
- [ ] **High — Live verification:** test a clean installation, command registration and removal of the legacy /codex command, and the documented Codex/Claude/Gemini versions. Verify authorization, private replies, disabled mentions, provider/project isolation, profile changes, scheduling, and restart behavior. Record tested versions/platforms and capture screenshots without private content.
- [ ] **High — Security policy:** add SECURITY.md with supported versions and a private vulnerability-reporting channel. Explain the trusted-user model, shared CLI accounts, host filesystem access, and provider-specific permission limits.
- [ ] **High — Publication review:** scan the files intended for release for secrets and private paths, verify credentials/runtime files remain excluded, and review dependency advisories and licenses. Resolve findings or document remaining limitations.
- [ ] **Medium — Onboarding:** add a concise English quickstart alongside the Thai guide, with a minimal Codex-only setup, supported OS/Node/CLI versions, Discord setup, first-task example, and screenshots.
- [ ] **Medium — Contributions:** add CONTRIBUTING.md covering local setup, offline tests, coding conventions, bug reports, and pull requests.
- [ ] **Medium — Beta release notes:** choose a beta version/tag and document installation, upgrades, and known limitations. Make clear that one worker is shared, sessions/results are lost on restart, and /ai cancel cancels schedules rather than active tasks.

## Before a stable release

- [ ] **High — Graceful shutdown:** stop accepting tasks and scheduling new work during shutdown; deliberately finish or terminate active worker processes, close Discord, and preserve accurate schedule state. Test shutdown/restart behavior on supported platforms.
- [ ] **High — Validate real usage:** resolve significant defects from beta installation and provider compatibility reports, then repeat the release smoke tests on supported configurations.
- [ ] **Medium — Setup diagnostics:** add a setup/doctor command that checks configuration, project directories, CLI availability/version, and authentication without exposing credentials or making model requests.

## Later improvements

- [ ] Persist session references and saved results across restarts with explicit retention and privacy rules.
- [ ] Add cancellation of active tasks with process-tree cleanup and clear partial-change behavior.
- [ ] Consider a bounded task queue while retaining the single-worker guarantee.

## Current verification baseline

The latest implementation check passed the TypeScript build and all 115 offline tests. Live Discord/provider verification and a full security/dependency audit remain outstanding. Revalidate the release candidate rather than treating this snapshot as release approval.
