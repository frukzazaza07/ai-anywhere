# ADR-004: Use /ai as the single task command

## Status
Accepted. Supersedes the /codex command compatibility portions of ADR-001 and ADR-002.

## Context
/ai supports every task and session operation previously exposed by /codex. The user requested removal of the duplicate command to simplify the Discord interface.

## Decision
Register and route only /ai, /ai-admin and /help. Select Codex through /ai provider:codex or a configured Codex profile. Remove the codex help topic and use /ai in all task, result, quota and scheduling hints.

Registration deletes the old /codex command only when its name and description match this bot's previous definition. Keep the existing standalone legacy cleanup and preserve unrelated command definitions.

## Alternatives considered
- Retain /codex as a compatibility alias: duplicates the same operations and conflicts with the requested interface simplification.

## Consequences
Operators rerun npm run register, build and restart. Existing sessions, provider/model identities and captured schedule targets remain unchanged. Keep the legacy schedule filename and loading behavior so saved jobs are not lost. Use explicit provider/profile selections when retrieving results rather than relying on a potentially different default.
