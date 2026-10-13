# ADR-002: Named, locally configured project workspaces

## Status
Accepted. The user chose switching between configured projects on 2026-10-12.

## Context
A single worker directory cannot support independent coding conversations across multiple local projects. Accepting raw paths from Discord conflicts with the operator-controlled worker boundary. Plain folders should work as well as Git repositories.

## Decision
AI_PROJECTS maps stable aliases to existing directories. AI_DEFAULT_PROJECT selects the startup default; AI_WORKDIR and legacy CODEX_WORKDIR supply a default alias for compatibility. Resolve relative paths from the bot launch directory and canonicalize with realpath. Up to 25 aliases fit Discord's fixed choices. Register alias choices and validate them again at runtime. No filesystem paths or executable overrides are accepted from chat.

ProjectPreferences stores each guild/channel/user's choice. /ai project and /codex project switch that choice; session command project options override one request. List/switch management is independent of enabled AI providers. ProjectSessions owns one provider session manager per canonical directory and checks a shared busy guard before dispatch. Project-local metadata and results remain private; the status reports global worker busy state without exposing other users' tasks.

Schedules persist project alias and directory, alongside provider/model and sandbox. Dispatch uses the captured alias instead of preferences. Removed/remapped aliases pause jobs. Older jobs without aliases migrate by exact directory match to the configured allowlist, never to a new default. Listing/cancelling stays owner-scoped across projects.

Codex runs with --skip-git-repo-check for fresh and resumed tasks, retaining the existing sandbox and stdin delivery. Other CLIs already launch with the selected cwd. Configured folders may be anywhere the bot account can access, including the launch folder; operators keep credentials/runtime files outside AI project folders.

## Alternatives considered
- Raw directory paths through Discord: violates the fixed worker boundary.
- One session pool keyed only by user/provider: mixes project history and results.
- A separate bot per project: duplicates credentials and bypasses the single-worker guard.
- Redirect old schedules to the selected/default project: could execute a saved task in the wrong folder.

## Consequences
Changing alias names requires command registration and restart. All authorized users can use all configured projects. Preferences and cached sessions/results remain in memory and reset at restart. Aliases to one canonical folder intentionally share history. Saved jobs require explicit cancellation/recreation after project mapping changes. Offline tests cover selection, cwd, isolation, busy handling and migrations; live Discord/model smoke tests remain operator actions.
