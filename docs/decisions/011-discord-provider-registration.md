# ADR-011: Register supported providers and create profiles from Discord

Status: Accepted. Extends ADR-003's local-only provider registration and model catalog policy.

Operators with additional local CLIs should be able to register them without
editing the base JSON. Profile creation already exists through profile-set, but
an explicit add command makes the workflow discoverable and protects existing
profiles from accidental replacement.

Add `/ai-admin provider-add` for the three existing adapters and
`/ai-admin profile-add` for creation only. Keep profile-set as an upsert. Provider
registration accepts validated comma-separated model IDs and an optional default
model. Administrators already control selections and may now approve these IDs
when registering a provider. Worker commands continue to validate models against
the approved catalog. Model discovery can extend it through existing metadata
adapters.

Installation paths come exclusively from selected-provider host settings. Codex
is bundled, Claude uses PATH or CLAUDE_EXECUTABLE, and Gemini uses GEMINI_CLI_SCRIPT.
Chat cannot select executable paths, flags, credentials, shell tools or permission
bypasses. Registration does not install, execute or authenticate a CLI; availability,
version and login are checked by existing diagnostics/discovery/task paths.

Save provider entries atomically to ai.config.json after initial setup. Validate
the full merged candidate and check base/override consistency again before
publication. Preserve unrelated document settings, defaults, profiles and saved
targets. Reject duplicates and keep the previous generation on failure. Use the
existing mutation gate and schedule listeners. Profile additions use persisted
overrides and reject duplicate names. Existing authorization, private replies,
disabled mentions and worker limits apply to both commands.

An override installation catalog would add another installation precedence layer.
Accepting executable paths in Discord would expand the host execution boundary.
Reusing the base file and existing adapters keeps the change within the current
runner model. Additional API services and arbitrary provider names require their
own adapter design.

Build/restart and register the new schema once on upgrade. Later additions activate
immediately and survive restart. Offline tests cover persistence, typed model
validation, authorization, defaults, duplicate rejection, busy handling, save
failures and concurrent local edits. Live Discord verification remains necessary.
