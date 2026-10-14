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

## Feature: Add projects and directories from Discord

Requested 2026-10-14. Design: [implementation plan](plan.md#extension-add-projects-from-discord).
Implementation and offline verification are complete. Live registration, smoke
checks and screenshots remain pending before release.

### Task 1: Configure safe roots for project additions

**Description:** Add optional locally configured root aliases and a resolver for
immediate child directories named by validated project aliases.

**Acceptance criteria:**
- [x] Existing configs load unchanged; missing roots disable project additions with a sanitized setup message.
- [x] Root mode accepts only configured root aliases and valid names; path-shaped aliases, traversal and canonical symlink/junction escapes are rejected.
- [x] Existing-folder registration requires an accessible directory; duplicate project aliases are rejected without replacing mappings.

**Verification:** Offline temporary-directory tests for valid folders, invalid names, files, missing roots and symlink/junction escapes; `npm run build`.
**Dependencies:** None.
**Files likely touched:** `src/projects.ts`, `src/runtime-config.ts`, `test/projects.test.ts`, `test/runtime-config.test.ts`.
**Estimated scope:** Medium.

### Task 2: Persist and activate project additions

**Description:** Add a runtime operation to register an existing folder or create
a new empty folder, save its alias to `ai.config.json` and activate it immediately.

**Acceptance criteria:**
- [x] Additions survive reload/restart, preserve unrelated base settings and overrides, and require completed initial setup; conflicting local edits are rejected.
- [x] Creation never replaces an existing folder; failed validation/save leaves the runtime unchanged and safely cleans up only an owned empty new directory.
- [x] The shared config/dispatch gate rejects busy workers; defaults, preferences, existing sessions and captured schedule targets remain unchanged.

**Verification:** Offline tests for persistence, write failures, creation collisions, rollback, concurrent requests, local edits, busy handling and unchanged session/schedule targets; `npm run build` and `npm test`.
**Dependencies:** Task 1.
**Files likely touched:** `src/runtime-config.ts`, `test/runtime-config.test.ts`, `test/projects.test.ts`, `test/runtime-scheduler.test.ts`.
**Estimated scope:** Medium.

### Checkpoint: Runtime behavior

- [x] Root containment, durable updates and failure handling pass offline tests; strict build succeeds.

### Task 3: Expose project additions in Discord

**Description:** Add `/ai-admin project-add name:ALIAS [root:ROOT | directory:ABSOLUTE_PATH] [create:true|false]`
with authenticated root autocomplete and route it to the runtime operation.
Omitting `create` registers an existing folder.

**Acceptance criteria:**
- [x] Guild/user/admin checks apply to execution and autocomplete; replies are private, mentions disabled, and responses/errors expose aliases only.
- [x] Newly added projects appear immediately in `/ai projects` and project autocomplete and can be selected for a task without restarting.
- [x] Command tests and help document both existing-folder registration and new-folder creation, including busy/setup/failure messages.

**Verification:** Offline command schema, authorization, autocomplete, help and runtime integration tests; `npm run build` and `npm test`.
**Dependencies:** Task 2.
**Files likely touched:** `src/commands.ts`, `src/bot.ts`, `src/admin-config.ts`, `src/selection.ts`, `src/help.ts`; matching tests.
**Estimated scope:** Split routing and help/test updates into separate changes if needed.

### Task 4: Document setup and verify release

**Description:** Document the one-time local root configuration and project-add
workflow, update the project/runtime specs and record the directory trust boundary.

**Acceptance criteria:**
- [x] README, example config and specs describe root setup, registration versus creation, persistence and existing-config compatibility.
- [x] An ADR records containment, atomic persistence and rollback decisions; operator instructions require one command registration.
- [x] Build and full offline suite pass on Node 24.21.0.
- [ ] Live Discord verification covers denied access, both add modes, private replies, immediate selection and screenshots.

**Verification:** `npm run build`, `npm test`; operator runs `npm run register` and performs live Discord checks without model calls unless explicitly authorized.
**Dependencies:** Task 3.
**Files likely touched:** `README.md`, `ai.config.example.json`, `SPEC-projects.md`, `SPEC-runtime-config.md`, a new ADR under `docs/decisions/`.
**Estimated scope:** Medium.

### Checkpoint: Feature complete

- [x] Offline acceptance criteria and checks pass; documentation matches the implemented behavior.
- [ ] Live registration, Discord smoke checks and screenshots are recorded before release.

Validation: the strict build passed and the full offline suite completed on
Node 24.21.0: 244 tests, 243 passed, 1 skipped, 0 failed.
Project-add tests cover both modes, config/override/catalog persistence, collisions,
authorization, shared busy handling, local edit conflicts, junctions, directory
changes during publication, rollback failures and unchanged session/schedule targets.
The existing Windows leaf-file-symlink test requires privileges unavailable on this
host; real directory junction tests passed. No live Discord registration or model
calls were performed, and private runtime settings were not modified.

## Approved extension: Admin-supplied project directories

The user approved the direct-path exception on 2026-10-14.

- [x] Add optional absolute `directory` input; require exactly one of directory/root and preserve admin authorization before filesystem access.
- [x] Register existing folders outside configured roots using independent aliases; canonicalize and persist paths while worker commands/replies retain aliases.
- [x] Create missing parent directories safely; reject target collisions/links and roll back only owned empty directories, including partial creation/save failures.
- [x] Cover absolute-path validation, spaces/Unicode, Windows path spelling, external directories, restart persistence, denied access, parent moves and cleanup failures in offline tests.
- [x] Update command/help, README, specs, security guidance, AGENTS.md and ADR-010 to record the explicit admin exception.
- [x] Verify the final build and full offline suite for the directory extension.
- [ ] Re-register the schema and smoke test directory mode in Discord, including screenshots before release.

Directory-extension validation: `npm run build` passed on Node 24.21.0;
`npm test` completed with 256 tests, 255 passed, 1 Windows leaf-file-symlink
privilege skip and 0 failures. Native Windows path normalization and reuse of
existing directory/session identity are covered. Private runtime configuration
and live Discord command registration remain untouched.
