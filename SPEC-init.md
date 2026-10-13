# Spec: Discord first-install configuration

## Objective
Support two installation paths: start from local environment settings and create `ai.config.json` with `/ai init`, or keep copying/editing `ai.config.example.json` locally. Discord setup offers optional default project/profile autocomplete and a useful next-task example. Existing files are never overwritten.

## Behavior and boundaries
- Require the configured guild and membership in both ALLOWED_USER_IDS and ADMIN_USER_IDS for initialization and its autocomplete. Blank admins disable initialization.
- Credentials, allowlists, permissions, project directories and executable/script locations remain local. With no base file and missing/invalid environment project settings, the bot starts in setup mode using the canonical config directory as the locally fixed `default` candidate. Tasks and schedules are blocked until an admin completes initialization. Invalid existing files, providers and overrides still fail validation; no arbitrary paths/executables are accepted from Discord.
- `/ai init` without options opens a private configuration modal asking for default project/profile aliases, prefilled from the active candidates. The form explains the startup-directory fallback and lists approved choices. Submissions recheck guild/user/admin authorization, revision and allowed targets before saving. Explicit slash options retain direct initialization. Existing files receive guidance without opening the form.
- `/ai init [project:ALIAS] [profile:NAME]` creates a version-1 file from validated environment configuration while preserving existing admin overrides. Defaults must be enabled/usable. Conflicting persisted default overrides require changing those overrides first.
- Save a complete validated file without replacing an existing destination, including files copied concurrently. Publish the new runtime generation only after creation succeeds. Existing file-based installations receive guidance to `/ai-admin` without changes.
- Serialize setup with runtime reload/admin operations and worker dispatch. Reject while busy or shutting down. Preserve captured schedule tuples, session identities, private replies and disabled mentions. Never return JSON with host paths through Discord.
- No new providers, models, arbitrary CLI arguments, credentials or permission changes are introduced by setup.

## Structure and conventions
Use `src/runtime-config.ts` for persistence/validation, `src/init-config.ts` for the authorization and user response boundary, and existing command/help/bot modules for Discord routing. Tests live in `test/init.test.ts`, with command/help/selection tests updated. Keep strict NodeNext TypeScript, `.js` imports, two spaces, single quotes and semicolons.

## Verification
Run `npm run build` and `npm test`. Offline node:test fixtures cover fresh creation/restart, selected defaults, optional providers, existing copy preservation, concurrent creation, unsafe inputs, disabled targets, admin/guild checks, autocomplete privacy, write failure, busy/config serialization and unchanged scheduled targets. Live registration/replies remain an operator smoke test; rerun `npm run register` once for the new subcommand.
