# Spec: Runtime configuration and dynamic profiles

Status: Implemented; offline validation covers configuration, selection, sessions and scheduled jobs. Live Discord smoke test and screenshots remain a release check.

## Scope and sources

The first delivery comprises runtime-config and dynamic-selection. Queueing, cancellation of an active worker, durable session/result storage, setup/doctor and publication infrastructure are separate work.

`ai.config.json` version 1 is the authoritative runtime source when present. It defines local project aliases/directories, provider installations/allowed models/default models, profiles and default project/profile. Relative directories resolve against the config file's directory and are canonicalized. All configured directories must exist, including disabled projects. Provider installation entries support Claude native executable and Gemini absolute JavaScript script; Codex uses the bundled dependency. Sandbox/timeout and Discord credentials, guild, user and admin allowlists remain environment settings.

Without the file, the previous project/provider/model environment settings generate in-memory profiles named after each enabled provider. The default provider determines the default profile. Runtime fields from environment and file are never merged. `.ai-config-overrides.json` applies above either source and survives restart. Invalid references, including stale deletion tombstones, reject reload without replacing the current snapshot.

## Administrative boundary

`/ai-admin status|reload|profile-set|profile-delete|project|provider|defaults` requires the configured guild, ALLOWED_USER_IDS and ADMIN_USER_IDS. Empty admins disable management. Profile replacement can select only a locally installed provider and an allowed model (or omit model for CLI default). Enablement changes reference existing local projects/installations. Paths, executables and allowed-model catalogs can be changed only on disk and reloaded. Defaults must remain usable; deleting a default profile or disabling its provider/default project requires a prior default change.

Mutations validate the entire merged candidate before an atomic overrides write and snapshot publication. Failed writes retain the current snapshot. Reload validates base plus overrides before replacing either. Discord sees sanitized codes, aliases and models, never raw filesystem errors, paths or credentials. The original local file is never rewritten by Discord.

A shared exclusive gate serializes config changes, manual worker claims, schedule creation and scheduler durable claims. Scheduler releases the gate after the worker has claimed the busy guard so schedule creation remains available during execution. Mutations reject active workers. The handler checks its captured config revision again under the gate after Discord acknowledgement; changed revisions require retrying the command.

Pausing schedules requires a second durable file write. If it fails after config publication, the response explicitly says config applied and schedule persistence failed. Jobs stay paused in memory, dispatch retries persistence, and a further config mutation must flush those pauses before persisting another generation. This avoids restoring a prior target before the pause becomes durable.

## Selection and session identity

All `/ai` session commands accept `profile` or legacy `provider`, exclusively. Omitted options select the shared default profile; no per-user profile preference exists. Explicit provider uses that provider's defaultModel (CLI default when absent). Select Codex with `/ai provider:codex` or a Codex profile; the redundant `/codex` command is removed. Autocomplete reads the current snapshot, authenticates before returning up to 25 entries and returns aliases only. Admin suggestions include disabled projects/providers/profiles. Typed values are independently validated at execution; total project inventory is unlimited by Discord choices.

Command option/autocomplete limits follow the [Discord application command documentation](https://github.com/discord/discord-api-docs/blob/main/developers/interactions/application-commands.mdx).

Project preferences remain per guild/channel/user. A missing or disabled preferred project produces an explicit reselection error instead of falling back. Listing and job management remain usable. Directory/provider/model/guild/channel/user determine session identity. Different profile names targeting one pair share history; edits to another model choose another session, and switching back recovers the earlier session. Sessions/results remain in memory.

## Scheduled jobs

Jobs capture profile name when selected and provider/model/project/canonical directory/sandbox at creation. Default changes and project preferences never redirect existing jobs. Missing or retargeted profiles, disabled providers, revoked models, and disabled/removed/remapped projects pause pending jobs during the config transition and persist the reason. Paused jobs require cancel/recreate; restoration does not resume them. Legacy jobs lacking profile retain their saved provider/model/directory, with exact-directory project alias migration. Legacy missing provider means Codex.

## Verification

Use offline mock CLIs and node:test for legacy/file precedence, restart overrides, malformed/stale reloads, save failures, authorization, default protection, autocomplete after reload/disable, over-25 inventories, typed input, privacy, tuple/session restoration, shared busy guard, scheduler/config races, legacy migration and permanent pauses. Run npm run build and npm test.

For release, register the command schema once, then use Discord to add/edit profiles and reload a locally added alias while the bot stays running. Verify autocomplete changes without registration/restart, denied admin access, private replies without mentions, result retrieval for the selected profile, and persisted job pauses. Capture screenshots. LICENSE, CONTRIBUTING, SECURITY and CI precede publication; setup/doctor follows as separate work.
