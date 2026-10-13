# ADR-008: Populate Discord model pickers from installed CLI metadata

## Status
Accepted. Extends ADR-007 and supersedes its configured-only model inventory.

## Context
A new installation has an empty explicit model list, leaving Discord with only CLI
default. The user requested provider CLI model listing and immediate selection of
returned models without editing JSON. The application already has Codex model/list
discovery but did not expose it in Discord or authorize its returned IDs.

## Decision
Use fixed metadata adapters for all enabled providers. Codex sends initialized
[model/list requests](https://learn.chatgpt.com/docs/app-server#list-models-modellist).
Claude launches its restricted streaming CLI and reads `models` from its
[SDK initialization response](https://code.claude.com/docs/en/agent-sdk/typescript#modelinfo).
Gemini uses ACP initialize and session/new to read
[availableModels](https://github.com/google-gemini/gemini-cli/blob/v0.63.0/packages/cli/src/acp/acpSessionManager.ts).
These probes submit no user message, generation request or model turn. Claude uses
no tools, hooks or MCP servers and disables session persistence. Gemini probes use
an empty temporary directory, restricted settings and disabled automatic memory;
ACP initialization can authenticate and create a local metadata session.

Opening config/models or switching provider loads the catalog. Coalesce duplicate
requests, cache results for 60 seconds, and offer a refresh button. Bound subprocess
time/output, filter Discord credentials, reject unsolicited tool/client requests,
validate IDs and discard display descriptions/account data. Failures show fixed
guidance and retain the previous catalog. Active workers use saved choices until idle.

The user's explicit request authorizes CLI-reported model IDs for selection. Merge
them with configured entries and persist the sanitized catalog/capabilities under
`catalogs` in the existing private overrides file. Write before publishing the new
runtime revision. A successful refresh replaces the previous discovered inventory;
configured entries remain. Selection, admin profiles, autocomplete, workers and
schedules use the same effective catalog. CLI-reported effort limits refine pickers
and validation where supplied. Local provider enablement, executable paths and file
permissions remain authoritative.

## Consequences
No manual model JSON setup is required for CLI-discovered models, including an
environment/setup installation. Restart preserves selected models and captured jobs.
Stale component indices and probes against changed config are rejected by revision.
Catalog refresh can pause jobs whose discovered target is removed; saved profiles
referencing removed discovered models need reconciliation before applying a refresh.
Models listed by a CLI are not account entitlement guarantees. No new dependencies
or model requests are needed; build/restart activates the feature without changing
slash-command definitions.
