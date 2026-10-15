# Changelog

## 1.0.0-beta.1 (release candidate; not published)

### Added
- Job history: every task (including each schedule run) is a job with an 8-character ID, saved privately in `.ai-jobs/` with owner, prompt, project/provider/model, state, start/finish times and result. `/ai jobs` lists your recent jobs; `/ai result id:…` opens one after restart. Only the owner can view a job. The newest 200 jobs are kept. Jobs interrupted by restart are marked failed and never replayed.
- `/ai stop [id:…]` stops a running job or withdraws a queued one. Owners can stop their own jobs, including scheduled runs; admins can stop any job. The CLI process tree is terminated and confirmed gone before the worker accepts new work. Files already changed are not reverted, and the conversation resumes from the last completed turn. Stopped repeating schedules run again at their next interval.
- `/ai run queue:true` waits in a FIFO queue (at most 5 jobs) when the worker is busy; jobs still run one at a time. Queued jobs show their position and are cancelled, not replayed, on restart or shutdown.
- Job progress: the private `/ai run` reply updates every 30 seconds with state, elapsed time and the latest activity reported by Codex or Gemini (fixed labels such as "Running tests", never raw logs); Claude reports only when finished. Long silence is flagged as a possible stall. `/ai status` shows your active jobs. The final reply includes the total duration.
- `/ai changes id:…` shows the files and Git diff changed by a job, paged for mobile with the full diff attached. Private before/after snapshots exclude earlier uncommitted edits and other jobs. Read-only for the project (no reset/checkout/commit/index writes); likely secrets and sensitive files are hidden.
- Build, restart and re-register commands after upgrading (`/ai run` gained `queue`; `result`/`stop` gained `id`; `jobs` and `changes` are new).
- `/ai context` shows context window usage for the selected session. Claude reports the model, tokens used/remaining and a cache/input/output breakdown read from local Claude Code session history without a model turn; Codex reuses its context estimate. Re-register commands after upgrading.
- Project/provider/model profiles let `/ai run`, `/ai status`, `/ai result` and resets select a target with only `profile`. Admin profile creation/replacement now requires a project alias. Direct provider/model/project options and legacy unbound profiles remain supported; changed project bindings pause captured schedules. Build, restart and re-register commands after upgrading.
- Admin-only `/ai-admin provider-add` registers supported local CLIs and approves optional model IDs directly from Discord; `/ai-admin profile-add` creates profiles without replacing existing names. Changes activate immediately and survive restart. Installation paths and logins remain host settings. Build, restart and re-register commands once after upgrading.
- Admin-only `/ai-admin project-add` accepts an absolute host `directory` or an optional locally configured `root` alias. Register an existing folder or use `create:true` to create the target and missing parents. Additions save to `ai.config.json`, activate immediately and survive restart, preserving defaults, overrides and scheduled targets. Re-register commands and restart after upgrading.
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
- Restarting after saved project/default-profile overrides pauses legacy schedules whose captured project is disabled instead of failing startup. Saved overrides and original job targets are preserved.
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
