# ADR-003: Validated runtime snapshots and dynamic profiles

## Status
Accepted. Supersedes the static command choices and restart/registration requirements of ADR-002 and the single-model selection of ADR-001.

## Context
Self-hosted operators need to change allowed selections through Discord without rebuilding command definitions. Project paths, executable installation and model catalogs must remain machine-controlled. Session histories and saved schedules must not drift when defaults or profiles change.

## Decision
Introduce RuntimeConfig with versioned, fully validated snapshots, a local base JSON file and separate atomic overrides. The environment remains a backward-compatible source only when the base file is absent. Discord administrators must pass both ordinary and admin allowlists. Expose profile CRUD, enablement and defaults, while filesystem/executable/catalog editing remains local.

Use autocomplete for all project/provider/profile options. Suggestions authenticate before reading the catalog and never include paths. Execution revalidates typed values and the captured generation. Session identity remains canonical directory plus provider/model and guild/channel/user; profile names are selection metadata, so equivalent profiles share a conversation.

Use one shared configuration gate around mutations and durable scheduler claims/manual worker starts. Reject changes during active work. Release the scheduler gate once the session claims its shared worker so schedule creation does not wait for long tasks. Persist profile and selected tuple in new jobs; pause invalidated jobs during publication and never auto-resume a paused job. Preserve legacy saved tuples and exact-directory migration.

## Alternatives considered
- Static Discord choices: requires registration on catalog changes and limits inventory to 25.
- Editing the base JSON from Discord: blurs local trust boundaries and makes deployments overwrite operator changes.
- Per-user profile defaults: adds preference precedence and migration complexity beyond this delivery.
- Session identity by profile name: duplicates equivalent histories and resumes the wrong pair after edits.
- Re-resolving jobs from defaults at dispatch: can run a saved prompt in another workspace/model.

## Consequences
Register once when upgrading the command schema. Catalog changes afterward require reload, not registration/restart. Invalid or stale overrides fail closed and must be reconciled locally. Two-file config/job persistence is explicit: after config succeeds, a job-save failure preserves pauses in memory and blocks later mutations until those pauses are durable. Atomic writes do not provide a cross-file transaction or multi-instance coordination; run one bot instance. Sessions and results are still lost at restart. Publication infrastructure and live Discord smoke/screenshots remain separate release work.
