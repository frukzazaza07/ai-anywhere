# Implementation plan: Configured project switching

Model selection extension: see [SPEC-model-selection.md](../SPEC-model-selection.md).
Add catalog/selection logic, bounded Codex discovery and terminal listing, then
Discord schema/routing/help. Verify the strict build and offline regressions.

1. Add allowlisted project configuration and selection state; verify directory validation and per-user/channel selection.
2. Add a project session facade around provider sessions, preserving one shared busy guard and isolating paths.
3. Add project snapshot fields and legacy directory-based schedule migration; verify remapping/removal pauses.
4. Register project choices, switch/list commands and route session/schedule work to captured projects.
5. Update operator setup and architecture docs; run build and the full offline suite.

User confirmed switching between configured projects. No dependencies or external registration/model calls are needed. Project aliases and canonical directory snapshots prevent chat paths or preference changes from redirecting saved work.

## Extension: Add projects from Discord

Status: Implemented on 2026-10-14; build and offline verification passed.
Live Discord registration, smoke checks and screenshots remain release tasks.

Allow an authorized admin to register a new project alias and optionally create
its directory without manually adding each project to `ai.config.json`.
Command: `/ai-admin project-add name:my-app root:workspace create:true`.
Omitting `create` registers an existing directory; `create:true` creates a new
empty directory. Creating a repository or cloning from a URL is outside this task.

For root mode, configure named project roots locally once. The root alias and
validated project name identify an immediate child directory. Admins may instead
supply an absolute directory under the approved extension below; executable
overrides remain local. Canonicalize the
root and candidate directory and reject traversal, symlink/junction escapes and
duplicate aliases. Root configuration is optional so existing installations
continue to work; without a configured root, the command explains the local setup
requirement without exposing paths.

Implement directory validation and durable catalog updates in the runtime config
layer, separate from Discord transport. Persist successful additions to
`ai.config.json` with validated atomic writes that preserve unrelated settings
and relative directory entries. Require initial setup to be complete. Preserve
runtime overrides and reject conflicting local edits rather than overwriting
them. Activate the project only after saving succeeds, through the existing
config/dispatch gate; reject while the shared worker is busy. A failed save must
leave the active snapshot intact. Remove only a newly created, still-empty
directory owned by that operation if rollback is safe; report cleanup failures
through sanitized errors.

Keep defaults and current-project preferences unchanged. New aliases appear in
listing/autocomplete immediately and survive reload/restart. Existing sessions
and schedules retain their captured directories. Require guild, user and admin
authorization; keep replies ephemeral, mentions disabled and errors path-free.

Implementation order and acceptance checks are recorded in
[tasks/todo.md](todo.md). Add the command schema once with `npm run register`;
subsequent project additions need no registration or restart. Validate with
offline temporary-directory/mock-CLI tests, `npm run build` and `npm test`, then
perform a live Discord smoke check and capture screenshots before release.

### Approved extension: Admin-supplied directories

The user explicitly approved direct directory input on 2026-10-14. Implemented
`/ai-admin project-add name:ALIAS directory:ABSOLUTE_PATH [create:true|false]`
as an alternative to `root`. Require exactly one location. No root configuration
is needed for directory mode, and the folder name may differ from the alias.
Use fully absolute paths on the bot host; canonicalize existing ancestors and
reject target symbolic links/junctions. Create missing parents when requested,
tracking owned directory identities for safe deepest-first empty-folder rollback.
Preserve atomic persistence and session/schedule targets. Worker commands and
responses continue to use aliases. [ADR-010](../docs/decisions/010-admin-project-directories.md)
and AGENTS.md record the approved exception to the previous root-only restriction.
