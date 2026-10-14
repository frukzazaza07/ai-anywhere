# ADR-010: Let authorized admins supply project directories

## Status

Accepted on 2026-10-14 following the user's explicit approval. Extends ADR-009
and supersedes its requirement that every addition use a locally configured root.

## Context

Requiring local root configuration still makes adding a project at a new location
depend on manual JSON edits. The user requested direct directory paths through
Discord and approved an exception to the existing repository path restriction.
Worker commands must retain alias-based selection, canonical session identity,
one shared worker and captured schedule targets.

## Decision

Add optional `directory` to `/ai-admin project-add`. Require exactly one of
`directory` or the existing `root` option. Directory mode accepts a fully absolute
path on the bot host (including the drive on Windows), independent of the alias
and any configured roots. Paths with spaces and Unicode are supported. No shell
or executable settings are involved. The configured guild and both user/admin
allowlists are checked before filesystem access. Ordinary worker commands still
accept only persisted aliases, and autocomplete never suggests directory paths.

Omitted `create` registers an existing accessible directory. `create:true` creates
the target and any missing parents without replacing existing folders. Canonicalize
existing ancestors and persist the canonical target. Reject target symbolic
links/junctions; a link in an existing parent is resolved to its canonical location.
Track identities of newly created directories and verify them before publication.
Use native canonical paths for direct input on Windows; when the same folder
already has a configured alias, reuse its stored directory string to preserve
existing session and schedule identity across alternate casing or short names.
On failure, remove only owned empty directories, deepest first; never recursively
delete files or remove preexisting parents. Unsafe cleanup leaves directories for
local inspection and returns a sanitized error.

Keep ADR-009's idle config gate, validated atomic base-file save, conflict checks,
immediate activation and preservation of defaults, preferences, sessions and
captured schedules. Responses expose aliases only. Update AGENTS.md to record
this narrow admin exception for future maintenance.

## Alternatives considered

- Keep root-only inputs: does not satisfy adding projects at new host locations
  entirely from Discord.
- Add mutable root-management commands: introduces another management catalog
  instead of accepting the desired project directory directly.
- Accept paths on worker commands: bypasses alias persistence and project-selection
  validation, and is outside the approved exception.

## Consequences

Root configuration is optional. Admins can select any directory permitted by the
bot OS account, so the admin allowlist is a trusted host-management boundary.
Host filesystem permissions still apply; no CLI permissions or sandbox bypasses
change. Re-register the updated schema and restart once after upgrading. Future
additions need no manual config edit, restart or registration. Avoid concurrent
directory moves/config edits during saves; native filesystem operations provide
no atomic transaction spanning directory creation and config publication.
Offline tests cover external directories, nested creation, authorization, links,
collisions, rollback, restart persistence and alias-only worker selection. Live
Discord smoke checks/screenshots remain a release task.
