# Spec: Switch between configured projects

Status: Implemented and extended by [SPEC-runtime-config.md](SPEC-runtime-config.md). Dynamic autocomplete replaces static choices and the 25-project limit. Runtime reload replaces registration/restart for catalog changes; disabled preferences require explicit reselection.

Discord project additions: `/ai-admin project-add name:ALIAS [directory:ABSOLUTE_PATH | root:ROOT] [create:true|false]`
requires exactly one location. Admins may register an existing absolute host
directory without preconfiguring roots; its folder name can differ from the alias.
`create:true` creates the target and any missing parent directories. Optional
`projectRoots` maps root aliases to existing local directories in `ai.config.json`;
`root` mode names an immediate child folder using the alias. Project aliases follow
the existing rules. Relative directory paths, target symbolic links/junctions,
duplicate aliases and creation collisions are rejected. Existing parents are
canonicalized. Initial file setup must be complete.
Additions use the shared idle config gate, validate the merged candidate, atomically
save the base file preserving existing entries/overrides and activate immediately.
Detected conflicting local edits require reload and retry. Failed saves retain the
active snapshot; rollback removes only owned empty directories, including created parents. Defaults,
preferences, existing sessions and captured schedule targets remain unchanged.
See [ADR-009](docs/decisions/009-discord-project-additions.md) and its admin-directory
extension [ADR-010](docs/decisions/010-admin-project-directories.md).

Scope: The user selected switching between locally configured projects.

- Configure named existing directories in ai.config.json, or use legacy AI_PROJECTS JSON when that file is absent. AI_DEFAULT_PROJECT selects the legacy startup default. AI_WORKDIR or legacy CODEX_WORKDIR supplies the default alias when no projects map is provided (or adds default to a map).
- Resolve relative paths from the bot launch directory and canonicalize existing directories. Plain folders, spaces, Unicode paths and other accessible drives are supported; Codex uses --skip-git-repo-check without changing sandbox permissions.
- /ai projects lists names and the caller's current project. /ai project name:... switches that user's current channel. Commands with session state accept an optional project alias for a one-command override. Worker commands accept aliases only; the admin project-add command is the explicit directory-path exception.
- Keep sessions/results separate for each project path, provider, model and guild/channel/user. Switching back resumes that project's history. All projects/providers share one active worker. Project switching and resets reject while busy. Preferences and sessions reset on bot restart.
- Scheduling captures the explicit project alias and directory, not the caller's later preference. Removed/remapped projects pause saved jobs. Legacy schedules without aliases migrate only if their stored directory matches an allowed project. List/cancel remain available across all projects.
- Preserve authorization, ephemeral replies, disabled mentions, stdin prompts, environment filtering and sanitized errors. Real bot environment and saved schedules remain untouched during implementation.

Commands: npm run build; npm test. Registration is an operator action: npm run register.
Files: src/projects.ts, src/project-sessions.ts, config/commands/bot/register/scheduler/runner; test/projects.test.ts and existing command/schedule tests; README/.env.example and ADR.
Style: existing strict TypeScript/NodeNext, two spaces, single quotes and semicolons.
Validation: offline mock CLI tests covering cwd, non-Git fresh/resume, config parsing, aliases, isolation, shared busy state, durable project snapshots, migration and invalid directory failures. No model or Discord calls.
