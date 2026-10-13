# Changelog

## 1.0.0-beta.1 (release candidate; not published)

### Added
- Private `/ai config` dropdowns and direct options save personal provider/model/effort defaults per guild/channel/user, with model pagination and durable preferences. Omitted prompt options use saved choices; explicit prompt options override one request. Effort reaches each provider adapter and is captured by schedules. Re-register commands and restart after upgrading.
- Direct allowed-model selection with autocomplete on `/ai` session commands, private `/ai models` listing, and local `npm run models` with optional bounded Codex CLI discovery. Selection preserves model-specific sessions and scheduled targets; discovery never expands permissions. Re-register slash commands after upgrading.
- Admin-only `/ai init` creates and activates first-install file configuration from locally approved environment settings, with default project/profile autocomplete and a first-task example. Existing copied files and saved overrides are preserved.
- Host-only `npm run doctor` checks configuration, directories, CLI versions and authentication indicators without model requests or raw credential output.
- Graceful SIGINT/SIGTERM shutdown drains accepted tasks/replies, saves schedule outcomes and closes Discord; new work is rejected while stopping.
- Windows/Linux/macOS CI for the minimum Node 24.17.0 and latest Node 24, with install, build, offline tests and release scanning.
- MIT licensing/metadata, English quickstart, contribution/security policies, dependency license inventory, beta upgrade notes and a live release checklist.
- `npm run release:check` scans Git release candidates for likely secrets/private files/paths and checks package metadata and dependency license declarations.
- Private /help command with complete command descriptions, option syntax and examples, plus focused ai/admin guides.
- Dynamic runtime configuration, durable admin overrides and profiles through /ai-admin.
- Authorized autocomplete for projects/providers/profiles, including inventories beyond 25 entries.
- Shared configuration/dispatch gate and permanent schedule pauses when captured targets change.
- Named local projects, private project listing/switching, and per-command project selection on /ai.
- Project-isolated conversations/results and durable scheduled project snapshots with legacy migration.
- Plain non-Git folders and relative/absolute work-directory configuration through AI_PROJECTS or AI_WORKDIR.
- CLI-only support for Claude Code and Gemini CLI alongside Codex through /ai.
- Operator-controlled enabled providers, default provider and per-provider models.
- Provider/model-isolated sessions and results with a shared worker busy guard.
- Provider selection persisted in schedules; legacy Codex schedules remain compatible.
- Restricted file tool execution, local CLI version checks and bounded structured output handling for additional providers.

### Fixed
- Release scanning rejects symbolic links and directory junctions before reading candidate or package metadata files, enforces repository containment and private-file exclusions, and checks the opened file's identity.
- Claude/Gemini model discovery now checks supported CLI versions before protocol initialization, with bounded version output and one timeout budget across the version probe and metadata session.
- Codex stdout is limited to 2 MB before JSON line buffering. Output overflow stops the worker, cleans temporary output and returns a sanitized error while preserving the previous successful session.
- Changing a personal model clears inherited effort when the new model's CLI catalog does not support it. Explicit incompatible effort is still rejected before saving.
- Refreshing or paging through `/ai config` preserves the default-profile model for users without saved preferences, keeping displayed effort choices consistent with the next prompt.

### Changed
- `/ai config`, provider switching and `/ai models` load model IDs from the installed provider CLI (Codex model/list, Claude SDK initialization, Gemini ACP). Returned IDs are selectable without manual JSON edits; CLI effort metadata is used when available. A refresh button, bounded probes, caching and durable catalogs preserve choices on failure and restart.
- Starting without `ai.config.json` and usable environment project settings now opens setup mode instead of failing. `/ai init` without options asks for approved project/profile aliases in a Discord form and creates the active file; tasks and schedules stay blocked until setup completes.
- Rerun `npm run register` once to expose `/ai init`. Both Discord setup from a valid environment bootstrap and copying/editing `ai.config.example.json` remain supported.
- Register /ai-admin and the new autocomplete/profile command schema once on upgrade. Later runtime catalog edits require reload only.
- File configuration is authoritative when present; legacy environment settings remain supported otherwise.
- Remove the redundant /codex command and help topic; use /ai with provider:codex or a Codex profile. Rerun npm run register to delete the old command, then build and restart.
- Status and error replies identify the selected provider; Codex keeps account/context reporting.
