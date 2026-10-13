# ADR-001: Local CLI provider adapters

## Status
Accepted. The user selected CLI tools only on 2026-10-12.

## Context
The Discord bot runs coding tasks in an operator-selected local project. Adding chat APIs would require a separate file/tool execution layer and separate billing/configuration flows. Codex behavior and privacy boundaries must remain compatible.

## Decision
Add a typed registry for Codex, Claude Code and Gemini CLI. Operators enable providers and choose a model per provider. /ai selects from fixed provider choices; /codex always selects Codex. All execution goes through one AiSessions manager with a shared busy guard. Identity is guild/channel/user/provider/configured model. Legacy CodexSessions remains an export alias.

Use native Claude and operator-installed Gemini's JavaScript entry point. Do not add mandatory dependencies or expose paths/flags through Discord. Launch without a shell, deliver prompts via stdin and filter Discord credentials. Validate local versions and structured success/session output before updating conversations. Resume only explicit UUIDs, never global latest sessions.

Claude restricted mode and a fixed file tool list provide unattended file operations. Gemini receives temporary restrictive system settings with existing system restrictions retained, a file tool allowlist, and disabled hooks/MCP/extensions. Version minimums are Claude >=2.1.248 and Gemini >=0.63.0 stable. These modes are tool permissions rather than equivalent OS sandbox implementations. Codex retains its sandbox. Extra providers do not execute shell tools.

Schedules store provider/model selection; absent provider means Codex. They pause if an enabled provider or configured model no longer matches. Changing the default never redirects a saved task. System-managed Gemini installations with JSON comments or malformed settings are rejected rather than replacing unreadable policy.

## Alternatives considered
- Direct APIs: excluded by the user; would not provide the existing local coding workflow without a new tool layer.
- Run arbitrary executables/flags from Discord: incompatible with operator-controlled execution.
- Use each CLI's latest conversation: would mix user/channel/provider histories.
- Permission bypass or generic auto-approval of shell tools: exceeds the shared project modes.

## Consequences
Extra CLIs are installed and authenticated by operators. Provider-specific quota/context reporting remains Codex-only. Local version probes add startup time to a task but prevent older CLIs silently ignoring restrictions. Missing executables, incompatible versions and malformed output return sanitized failures. Blank models use CLI defaults; the bot cannot track changes made inside another CLI's configuration. Mock tests run without model or Discord calls; live account smoke tests are still required.

## References
- https://code.claude.com/docs/en/cli-reference
- https://geminicli.com/docs/cli/headless/
- https://github.com/google-gemini/gemini-cli/blob/v0.63.0/packages/cli/src/config/settingsSchema.ts
