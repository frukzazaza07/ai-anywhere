# Tasks: Configured projects

Model selection extension:

- [x] Add allowed-model selection, authenticated autocomplete and catalog formatting.
- [x] Add bounded, paginated Codex catalog discovery and the local `models` command.
- [x] Wire Discord model options/listing, result instructions and help/docs.
- [ ] Verify all offline tests on the supported Node runtime with child-process access.

Model validation: the strict build and 30 in-process command/selection/help/schedule
checks passed. Compiled terminal listing, JSON output and discovery-failure fallback
passed with a temporary config. `npm test` is blocked here by Node 20.20.2 (the
project requires >=24.17.0) and sandbox `spawn EPERM`; CLI subprocess regressions
and live Discord registration/screenshots remain unverified.

- [x] Configure and select projects (projects.ts, config.ts, projects tests).
- [x] Isolate sessions by project and preserve global busy handling (project-sessions.ts, projects tests).
- [x] Capture projects in schedules and migrate old jobs (scheduler.ts, schedule tests).
- [x] Route Discord project choices and selection commands (commands/bot/register, command tests).
- [x] Document configuration and registration (README/.env.example/ADR/changelog).
- [x] Verify npm run build and npm test.

Validation: npm run build passed; npm test passed (82 tests). Tests use mock CLIs; no Discord registration, model requests, live environment changes or saved schedule edits were performed.
