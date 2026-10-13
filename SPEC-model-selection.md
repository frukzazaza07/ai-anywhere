# Spec: AI model selection

## Objective and assumptions

Trusted Discord users can list and select operator-approved models without creating
a profile. Operators can list the same choices from a terminal and optionally ask
the installed Codex CLI for its model catalog. Existing profiles keep their meaning.
The feature adds per-request selection and durable personal provider settings;
shared defaults and explicit named profiles keep their existing meaning.

## Personal configuration and effort

- `/ai config [provider:CLI] [model:MODEL] [effort:LEVEL]` shows a private provider,
  model and effort picker, or saves supplied choices immediately. Each allowed user
  has a selected provider plus independent settings for each provider, scoped to
  guild/channel/user, persisted in `.ai-preferences.json`. No admin role is needed
  to change personal settings. Model lists combine configured IDs and CLI-reported IDs and
  paginate beyond Discord's 25-option limit; `CLI default` clears that field.
- Omitted prompt fields use the selected personal provider/model/effort; absent
  preferences retain the existing shared default-profile behavior. Explicit fields
  override only that request. Named profiles override personal choices; effort may
  override a profile for one request. Removed or disabled choices are rejected with
  guidance to reopen config, never silently replaced.
- Every dropdown/save and autocomplete authenticates the guild/user. Components
  bind to their owner, runtime instance and revision, and validate again under the
  runtime dispatch gate. Writes publish preferences only after durable success.
- Codex uses `model_reasoning_effort`; Claude uses `--effort`; Gemini uses model
  configuration overrides in its existing restricted temporary settings. Gemini
  3 pro supports low/high, Gemini 3 flash minimal/low/medium/high, and Gemini 2.5
  low/medium/high map to budgets 1024/8192/24576. Unsupported Gemini models offer
  CLI default only. No permission settings or shell tools change.
- Effort is per-turn and keeps provider/model session history. Status, confirmations
  and schedule retrieval instructions display effort. Schedules capture effort
  durably and never consult subsequent personal preferences.
- Validate provider-specific effort values at configuration, selection, schedule
  loading and CLI entry. Tests cover defaults, per-request overrides, user/channel
  isolation, restart, stale/unauthorized pickers, save failures, pagination,
  revoked models, actual mock CLI arguments/settings and captured scheduled effort.

## Behavior and success criteria

- `/ai models [provider:CLI | profile:NAME]` lists allowed model IDs, the selected
  default, and matching profiles. It works while busy and without a current project.
- Session commands accept optional `model:MODEL` with authenticated autocomplete.
  A model can accompany a provider, or use the default profile's provider. An
  explicit profile conflicts with provider/model options. Typed IDs are revalidated
  against the current provider catalog. The user's CLI-discovery request authorizes
  picker-visible discovered IDs for selection without manually editing JSON.
- Model-specific sessions, reset/status/results and schedules use the resolved
  provider/model tuple. Result instructions include the selected model.
- `npm run models -- [--provider codex|claude|gemini] [--discover] [--json]`
  lists enabled providers without requiring Discord credentials. Codex discovery
  uses initialized app-server `model/list` requests with pagination, timeout/output
  bounds, filtered credentials and no model turns. Claude uses the streaming SDK
  initialization response's model metadata; Gemini uses ACP initialize/session-new
  availableModels. No provider receives a prompt. Failure retains saved/configured
  choices with a sanitized warning.
- Discord `/ai config`, provider switches and `/ai models` load CLI catalogs, with
  a 60-second coalesced cache and an explicit Refresh models from CLI button.
  Autocomplete reads the last published catalog and never starts a slow probe.
  Validated model IDs and optional effort capabilities persist under `catalogs` in
  the private overrides file before publishing a runtime revision. Existing configured
  models remain available. Restart preserves discovered choices and scheduled tuples.
  Discovery cannot add providers, host paths, executable overrides or tool permissions.
  Busy workers use saved catalogs; refresh/retry when idle. Revisions prevent a probe
  from applying metadata to changed local config and prevent stale model-index picks.

## Commands and structure

Build: `npm run build`. Tests: `npm test`. Register: `npm run register`.
`src/models.ts` owns catalog formatting; `src/model-discovery.ts` owns the CLI
protocol; `src/models-cli.ts` is the local entry point. Discord routing remains in
`src/bot.ts`, selection in `src/selection.ts`, and tests in `test/*.test.ts`.

## Code style

Strict TypeScript, two spaces, single quotes, semicolons, `.js` relative imports:
`const selection = selectCommand(config, provider, profile, model);`

## Testing strategy

Use `node:test` and `node:assert/strict`. Mock app-server scripts verify handshake,
pagination, failures, output limits, timeout and credential filtering. Test allowlist
enforcement, unauthorized autocomplete, model-specific sessions, schedule capture,
command schema and complete help. No live Discord/model calls are required.

## Boundaries

- Always preserve authorization, private replies, disabled mentions, canonical
  session isolation and one shared AI worker. Keep existing uncommitted work.
- Ask first for a change to permission policy or publishing to an external service.
- Never accept arbitrary chat IDs that neither local config nor a CLI catalog supplied,
  expose paths/raw CLI output, use a shell, change
  provider tool permissions, or send model prompts for catalog discovery.

## Implementation order

1. Add catalog and selection logic, including regression tests.
2. Add bounded Codex discovery and the local terminal command with mock tests.
3. Wire Discord options/listing and update help, README and release notes.
4. Run the strict build and full offline suite, then review the feature diff.
