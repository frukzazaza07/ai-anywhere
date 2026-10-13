# Spec: Switch between configured projects

Status: Implemented and extended by [SPEC-runtime-config.md](SPEC-runtime-config.md). Dynamic autocomplete replaces static choices and the 25-project limit. Runtime reload replaces registration/restart for catalog changes; disabled preferences require explicit reselection.

Scope: The user selected switching between locally configured projects.

- Configure named existing directories in ai.config.json, or use legacy AI_PROJECTS JSON when that file is absent. AI_DEFAULT_PROJECT selects the legacy startup default. AI_WORKDIR or legacy CODEX_WORKDIR supplies the default alias when no projects map is provided (or adds default to a map).
- Resolve relative paths from the bot launch directory and canonicalize existing directories. Plain folders, spaces, Unicode paths and other accessible drives are supported; Codex uses --skip-git-repo-check without changing sandbox permissions.
- /ai projects lists names and the caller's current project. /ai project name:... switches that user's current channel. Commands with session state accept an optional project alias for a one-command override. Discord accepts only configured aliases, never paths.
- Keep sessions/results separate for each project path, provider, model and guild/channel/user. Switching back resumes that project's history. All projects/providers share one active worker. Project switching and resets reject while busy. Preferences and sessions reset on bot restart.
- Scheduling captures the explicit project alias and directory, not the caller's later preference. Removed/remapped projects pause saved jobs. Legacy schedules without aliases migrate only if their stored directory matches an allowed project. List/cancel remain available across all projects.
- Preserve authorization, ephemeral replies, disabled mentions, stdin prompts, environment filtering and sanitized errors. Real bot environment and saved schedules remain untouched during implementation.

Commands: npm run build; npm test. Registration is an operator action: npm run register.
Files: src/projects.ts, src/project-sessions.ts, config/commands/bot/register/scheduler/runner; test/projects.test.ts and existing command/schedule tests; README/.env.example and ADR.
Style: existing strict TypeScript/NodeNext, two spaces, single quotes and semicolons.
Validation: offline mock CLI tests covering cwd, non-Git fresh/resume, config parsing, aliases, isolation, shared busy state, durable project snapshots, migration and invalid directory failures. No model or Discord calls.
