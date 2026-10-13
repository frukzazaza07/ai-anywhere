# Tasks: Configured projects

- [x] Configure and select projects (projects.ts, config.ts, projects tests).
- [x] Isolate sessions by project and preserve global busy handling (project-sessions.ts, projects tests).
- [x] Capture projects in schedules and migrate old jobs (scheduler.ts, schedule tests).
- [x] Route Discord project choices and selection commands (commands/bot/register, command tests).
- [x] Document configuration and registration (README/.env.example/ADR/changelog).
- [x] Verify npm run build and npm test.

Validation: npm run build passed; npm test passed (82 tests). Tests use mock CLIs; no Discord registration, model requests, live environment changes or saved schedule edits were performed.
