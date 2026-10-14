# ADR-009: Add project folders through configured roots

## Status

Accepted on 2026-10-14. Extends ADR-002 and ADR-003 for project additions;
project selection continues to use configured aliases.

The root-only input restriction is superseded by
[ADR-010](010-admin-project-directories.md), which adds an explicitly approved
admin directory option and creation of missing parent folders.

## Context

Adding each project required creating a folder and editing the base config on the
host. The user needs to register projects and create directories from Discord.
Arbitrary paths from chat conflict with the operator-controlled worker boundary,
and existing sessions and schedules must retain their captured targets.

## Decision

Optional `projectRoots` in version-1 `ai.config.json` maps validated aliases to
existing directories. Roots resolve relative to the config folder and are
canonicalized. Only local edits can configure roots. No roots means additions
are disabled; existing configs and workflows remain valid.

`/ai-admin project-add name:ALIAS root:ROOT [create:true|false]` requires the
configured guild and both user/admin allowlists. The alias names an immediate
child directory of the selected root. Omitted `create` registers an existing
folder; true uses exclusive nonrecursive creation. Raw paths, invalid aliases,
symbolic links/junctions, duplicate aliases and existing-folder creation fail.
Replies and autocomplete expose aliases only, privately with mentions disabled.

Runtime configuration owns filesystem operations and durable catalog publication.
The shared config gate rejects active workers and excludes dispatch during saves.
Initial file setup is required. Validate the whole candidate with existing
overrides, then atomically replace `ai.config.json`, preserving unrelated settings
and relative entries. Check the loaded base/overrides and directory identity before
publication. Only publish the new runtime snapshot after a successful save.

Failed saves remove only a newly created, still-empty directory after validating
its location and identity. Never recursively remove files. Unsafe or failed cleanup
returns a sanitized error and leaves the folder for local inspection. Existing
folders are never removed. Defaults, preferences, sessions and schedules keep
their targets; the new alias appears immediately and survives reload/restart.

## Alternatives considered

- Arbitrary chat paths: grants directory selection beyond locally approved roots.
- Require manual edits for every alias: does not satisfy the requested workflow.
- Put directories in admin overrides: blurs the host-controlled root catalog and
  changes the existing boolean project-override schema.
- Replace existing directories or aliases: risks destroying files or redirecting
  sessions and schedules.

## Consequences

Operators configure roots once and register the command once after upgrading.
Future additions need no restart or registration. Creation produces an empty
folder; Git initialization and repository cloning remain separate operations.
Single-instance operation is required. Avoid concurrent local config edits or
directory moves while adding projects: detected changes abort, but filesystem
rename has no compare-and-swap guarantee against external editors in the final
check-to-rename interval. Offline tests cover persistence, authorization, links,
failures, collisions, concurrency, sessions and schedules. Live Discord checks and
screenshots remain a release verification step.
