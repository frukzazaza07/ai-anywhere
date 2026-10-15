# Spec: Runtime configuration and dynamic profiles

Status: Implemented; offline validation covers configuration, selection, sessions and scheduled jobs. Live Discord smoke test and screenshots remain a release check.

## Scope and sources

The first delivery comprises runtime-config and dynamic-selection. Queueing, cancellation of an active worker and durable session/result storage remain separate work. First-install Discord setup is specified in [SPEC-init.md](SPEC-init.md); host diagnostics and release preparation are documented separately.

`ai.config.json` version 1 is the authoritative runtime source when present. It defines local project aliases/directories, provider installations/allowed models/default models, profiles and default project/profile. Relative directories resolve against the config file's directory and are canonicalized. All configured directories must exist, including disabled projects. Provider installation entries support Claude native executable and Gemini absolute JavaScript script; Codex uses the bundled dependency. Sandbox/timeout and Discord credentials, guild, user and admin allowlists remain environment settings.

Without the file, the previous project/provider/model environment settings generate in-memory profiles named after each enabled provider. The default provider determines the default profile. Runtime fields from environment and file are never merged. `.ai-config-overrides.json` applies above either source and survives restart. Invalid references, including stale deletion tombstones, reject reload without replacing the current snapshot.

Authorized admins can use `/ai init [project:ALIAS] [profile:NAME]` to create the first version-1 base file from validated environment settings. Creation uses the same dispatch/config gate, preserves overrides, never replaces an existing/copied file and activates immediately. Host directories and CLI installations remain local; existing copy/edit/reload workflows continue to work.

## Administrative boundary

`/ai-admin status|reload|provider-add|profile-add|profile-set|profile-delete|project|project-add|provider|defaults` requires the configured guild, ALLOWED_USER_IDS and ADMIN_USER_IDS. Empty admins disable management. Profile creation/replacement can select only a registered provider and an allowed model (or omit model for CLI default). `profile-add` rejects existing names; `profile-set` remains an upsert. Enablement changes reference existing local projects/installations. The optional projectRoots catalog and executables can be changed only on disk; admins can supply an absolute directory to project-add. Defaults must remain usable; deleting a default profile or disabling its provider/default project requires a prior default change.

`provider-add provider:codex|claude|gemini [models:ID1,ID2] [default-model:ID]`
registers a supported adapter after `/ai init`. Only the selected provider's host
installation/model environment settings are consulted: bundled Codex, Claude on
PATH or `CLAUDE_EXECUTABLE`, Gemini's `GEMINI_CLI_SCRIPT`. Paths and credentials
cannot be provided in chat. Admins may approve syntactically validated model IDs;
the selected default model (explicit or host-configured) is included in the allowed
list. Other models can be discovered with `/ai models`. This extends the previous
local-only catalog/installation registration policy; CLI execution restrictions
are unchanged. No CLI installation or login is performed by the command.

Provider registration saves to the base file, preserving unrelated JSON and
overrides. It rejects duplicate providers, invalid host installation settings,
unloaded local edits and save failures. The entire merged candidate is validated
before atomic publication, with files checked again before rename. Success enables
the provider immediately and updates autocomplete without changing defaults,
profiles, preferences or captured schedule targets. `profile-add` then persists
a new profile through the existing override mechanism. Both use the shared busy
gate and schedule-pause listeners. As with project additions, run a single instance
and avoid simultaneous local edits; filesystem checks are not compare-and-swap.

Mutations validate the entire merged candidate before an atomic overrides write and snapshot publication. Failed writes retain the current snapshot. Reload validates base plus overrides before replacing either. Discord sees sanitized codes, aliases and models, never raw filesystem errors, paths or credentials.

`project-add`, like `provider-add`, saves to the base file: it saves a new project
entry to `ai.config.json`, preserving unrelated JSON settings and relative entries.
Optional `projectRoots` maps locally configured aliases to existing canonical roots;
it is never supplied or changed through chat. The command requires file setup,
a valid alias and exactly one of an absolute host `directory` or a `root` alias.
Directory mode needs no preconfigured roots and permits an independent alias;
root mode names an immediate child using the alias. Omitted `create` registers an
existing folder; `create:true` creates missing parents and the target exclusively.
Duplicate aliases, existing-target creation and target links/junctions are rejected.
Existing ancestors resolve canonically. Base/override edits and directory identity are checked
again before atomic publication. Detected conflicts require reload and retry.
Single-instance operation and avoiding concurrent local edits remain operator
requirements; the filesystem provides no atomic compare-and-swap for outside editors.
Failed saves roll back only owned empty folders, including created parents, with sanitized cleanup errors.
Success activates immediately without changing defaults, preferences or schedules.

A shared exclusive gate serializes config changes, manual worker claims, schedule creation and scheduler durable claims. Scheduler releases the gate after the worker has claimed the busy guard so schedule creation remains available during execution. Mutations reject active workers. The handler checks its captured config revision again under the gate after Discord acknowledgement; changed revisions require retrying the command.

Pausing schedules requires a second durable file write. If it fails after config publication, the response explicitly says config applied and schedule persistence failed. Jobs stay paused in memory, dispatch retries persistence, and a further config mutation must flush those pauses before persisting another generation. This avoids restoring a prior target before the pause becomes durable.

## Selection and session identity

All `/ai` session commands accept `profile` or `provider`/`model` options, exclusively. Omitted options select the shared default profile; no per-user profile preference exists. Explicit provider uses that provider's defaultModel (CLI default when absent), unless an allowed model is supplied. Model alone uses the default profile's provider and yields a direct tuple without binding the profile. `/ai models` lists allowed IDs and matching profiles without resolving a project or launching a worker. See [model selection spec](SPEC-model-selection.md) for local CLI discovery. Select Codex with `/ai provider:codex` or a Codex profile; the redundant `/codex` command is removed. Autocomplete reads the current snapshot, authenticates before returning up to 25 entries and returns aliases/model IDs only. Admin suggestions include disabled projects/providers/profiles. Typed values are independently validated at execution; total project inventory is unlimited by Discord choices.

Command option/autocomplete limits follow the [Discord application command documentation](https://github.com/discord/discord-api-docs/blob/main/developers/interactions/application-commands.mdx).

Profiles may bind a configured `project` alias alongside provider/model. `/ai-admin profile-add` and `profile-set` require the alias; version-1 files and overrides without this field retain legacy current-project behavior. Bound profiles resolve the same project for run/status/result/new/clear/context regardless of current-project preferences. An identical explicit project is accepted for compatibility; a conflicting override is rejected with guidance to use direct provider/model/project options. Explicit provider/model selections remain independent of profile project bindings. Disabled bound projects make profiles unavailable in user autocomplete and execution. Default profiles must have an enabled bound project. Config validation rejects unknown aliases and paths, and persistence retains the binding.

Project preferences remain per guild/channel/user for direct selections and legacy unbound profiles. A missing or disabled preferred project produces an explicit reselection error instead of falling back. Bound profiles bypass stale current-project preferences. Listing and job management remain usable. Directory/provider/model/guild/channel/user determine session identity. Different profile names targeting the same directory/provider/model share history; edits to another target choose another session, and switching back recovers the earlier session. Sessions/results remain in memory. The project is optional in the persisted profile schema to avoid silently moving existing profiles and schedules during upgrade.

## Scheduled jobs

Jobs capture profile name when selected and provider/model/project/canonical directory/sandbox at creation. Default changes and project preferences never redirect existing jobs. Missing or retargeted profiles, disabled providers, revoked models, and disabled/removed/remapped projects pause pending jobs during the config transition and persist the reason. Paused jobs require cancel/recreate; restoration does not resume them. Legacy jobs lacking profile retain their saved provider/model/directory, with exact-directory project alias migration. Legacy missing provider means Codex.

Bound-profile jobs also persist `profileProject` so moving or removing that binding pauses pending jobs. Legacy jobs without this field keep their saved project; adding a profile binding to a different project pauses them rather than redirecting them. Result guidance uses only the profile for bound-profile jobs.

## Verification

Use offline mock CLIs and node:test for legacy/file precedence, restart overrides, malformed/stale reloads, save failures, authorization, default protection, autocomplete after reload/disable, over-25 inventories, typed input, privacy, tuple/session restoration, shared busy guard, scheduler/config races, legacy migration and permanent pauses. Run npm run build and npm test.

For release, register the command schema once, then use Discord to add/edit profiles and reload a locally added alias while the bot stays running. Verify autocomplete changes without registration/restart, denied admin access, private replies without mentions, result retrieval for the selected profile, and persisted job pauses. Capture screenshots. LICENSE, CONTRIBUTING, SECURITY and CI precede publication; setup/doctor follows as separate work.
