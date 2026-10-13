# Changelog

## Unreleased

### Added
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

### Changed
- Register /ai-admin and the new autocomplete/profile command schema once on upgrade. Later runtime catalog edits require reload only.
- File configuration is authoritative when present; legacy environment settings remain supported otherwise.
- Remove the redundant /codex command and help topic; use /ai with provider:codex or a Codex profile. Rerun npm run register to delete the old command, then build and restart.
- Status and error replies identify the selected provider; Codex keeps account/context reporting.
