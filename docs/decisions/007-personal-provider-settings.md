# ADR-007: Persist personal provider, model and effort choices

## Status
Accepted. Extends model selection with personal defaults; shared profiles remain unchanged.
The configured-only model inventory is superseded by [ADR-008](008-cli-model-catalogs.md).

## Context
Users want to choose a provider's model and effort once, change those choices later,
and omit them on subsequent prompts. Shared administrative defaults would change
other users' work. Choices must remain inside local provider/model allowlists and
must not redirect scheduled work.

## Decision
Add `/ai config` with private provider/model/effort menus and optional direct slash
options. Store the selected provider and per-provider fields in a versioned private
`.ai-preferences.json`, keyed by guild/channel/user. Publish updates after atomic
writes, serialize them with the runtime gate, and revalidate approved choices on
every prompt. Explicit prompt options override only that request; explicit profiles
retain their own provider/model. CLI-default sentinels allow clearing individual fields.

Menus bind to the user, runtime instance and revision; paginate approved model lists
and preserve IDs longer than menu value limits through revision-bound indices.
Ordinary allowed users manage their own choices. Administrative catalog permissions
and startup requirements remain unchanged. Revoked choices fail with guidance rather
than silently selecting a new provider/model.

Use [Codex's reasoning setting](https://developers.openai.com/codex/config-reference/),
[Claude's effort flag](https://code.claude.com/docs/en/cli-reference), and
[Gemini's model configuration overrides](https://geminicli.com/docs/reference/configuration/).
Gemini thinking choices use known model families; 2.5 uses fixed budgets and 3 uses
thinking levels. Unknown Gemini models retain CLI defaults. CLI/account support can
further restrict advertised provider effort choices.

Effort controls the current turn without splitting provider/model conversation
history. Schedules persist the resolved effort and never consult later personal
preferences. Results and status continue using provider/model identity, and retrieval
commands include explicit model IDs or the CLI-default sentinel so later preferences
cannot redirect them.

## Consequences
Reregister slash commands and restart once after upgrading. Further personal changes
apply immediately, remain private and survive restart. Empty local model allowlists
offer CLI default only; operators still approve additional model IDs locally.
