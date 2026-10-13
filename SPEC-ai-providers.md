# Spec: Multiple local AI coding providers

Status: Implemented and verified with offline mock CLIs; CLI-only scope confirmed by the user.

Runtime selection and configuration are extended by [SPEC-runtime-config.md](SPEC-runtime-config.md): profile or legacy provider selection, multiple allowed models, dynamic autocomplete, file/overrides precedence and persistent schedule pauses replace the original single-model/static-choice behavior below.

## Objective
Run local project tasks through Codex, Claude Code, or Gemini CLI from Discord. Use /ai as the single task command and keep the existing security boundaries. API-only chat providers are outside this first implementation.

## User behavior and success criteria
- Configured project selection and project isolation extend this provider design; see [SPEC-projects.md](SPEC-projects.md).
- Add /ai with run, new, status, clear, result, schedules and cancel. Select Codex with provider:codex or a configured Codex profile; /codex is removed.
- run accepts a provider choice (codex, claude, gemini); omitted provider uses an operator-configured default. Other session commands accept the same choice. schedules and cancel operate across the caller's providers.
- Operators enable providers and optionally set one model per provider in local environment configuration. Chat cannot supply executable paths, extra CLI flags, credentials or arbitrary model overrides.
- Conversations and results are isolated by guild, channel, user, provider and configured model. Switching providers never resumes another provider's session. One worker remains active across all providers.
- Follow-ups use explicit provider session IDs, never the most recent global session. new/clear reset only the selected provider's current conversation and saved result; reset is rejected while the worker is busy.
- Scheduled jobs capture provider and configured model. Existing jobs without provider remain Codex jobs. Disabled providers or changed model/settings pause jobs until cancellation and recreation.
- Codex status retains account usage and context reporting. Claude/Gemini status reports local worker/session metadata and clearly marks account quota/context as unavailable; never fabricate equivalent quotas.
- Preserve ephemeral replies, disabled mentions, prompt limits, attachment handling, sanitized errors and guild/user authorization for every command.
- Run all CLIs without a shell; deliver user prompts through stdin. Filter Discord credentials out of every worker environment.
- Codex retains its sandbox. Claude/Gemini use explicit unattended tool permission policies; do not translate to permission bypass flags. Document that tool policies are not equivalent to Codex's OS sandbox. Unsupported requested permission modes fail closed.
- Extra providers reject unsupported CLI versions before prompt delivery (Claude Code >=2.1.248 and Gemini CLI >=0.63.0 stable); version probes share the configured deadline.
- Output is bounded and parsed as provider-specific structured data. Failures, timeouts and oversized/malformed output do not establish a successful session.

## Commands
- Install current dependencies: npm ci
- Build: npm run build
- Test: npm test
- Develop: npm run dev
- Register changed Discord commands (operator action): npm run register
- Start compiled bot: npm start

## Project structure
- src/providers.ts: provider registry, validated selection, adapters and capabilities.
- src/runner.ts: existing Codex worker and reusable process/environment helpers where appropriate.
- src/sessions.ts: provider-neutral session and result management, Codex compatibility.
- src/config.ts: operator-controlled enabled providers, default provider, model and local executable configuration.
- src/commands.ts, src/bot.ts, src/register.ts: Discord command definitions and transport integration.
- src/scheduler.ts: durable provider selection and compatible loading of existing schedules.
- test/*.test.ts: offline mock CLI and behavior tests.
- docs/decisions/: provider architecture decision; README.md and .env.example: setup and usage.

## Stack and style
Keep TypeScript strict mode, Node.js >=24.17.0, ES modules and NodeNext imports. No new runtime dependency is required: extra CLIs are installed and authenticated by the operator. Use two spaces, single quotes, semicolons, camelCase functions and PascalCase types.

Example interface:

```typescript
export type ProviderId = 'codex' | 'claude' | 'gemini';
export interface ProviderSelection {
  provider: ProviderId;
  model?: string;
}
```

## Testing strategy
Use node:test and node:assert/strict with temporary mock CLI scripts. Cover command choices, default/disabled provider validation, stdin delivery, environment filtering, provider-specific output/resume parsing, timeouts, failure handling, model/provider isolation, global busy handling, resets and schedule persistence/migration. Restore environment changes and clean temporary files. Run npm run build and npm test. Real account login and Discord checks remain operator smoke tests.

## Boundaries
- Always: preserve authorization, privacy and the single-worker guard; validate selections and provider outputs; keep sessions separate from Discord; document setup and permission differences.
- Ask first: changes to the agreed provider scope, enabling permission bypass, or adding a runtime dependency.
- Never: publish the repository during this task, expose secrets, change the real .env, invoke paid model calls or Discord registration during automated tests, accept worker paths through chat, or silently fallback to a different provider.

## Scope confirmation
The user confirmed CLI tools only and later requested removal of the redundant /codex alias. Use /ai for all providers; see [ADR-004](docs/decisions/004-remove-codex-command.md).

## References
- Claude CLI: https://code.claude.com/docs/en/cli-reference
- Claude headless: https://code.claude.com/docs/en/headless
- Gemini headless: https://geminicli.com/docs/cli/headless/
- Gemini flags: https://geminicli.com/docs/cli/cli-reference/
