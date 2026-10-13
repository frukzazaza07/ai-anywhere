# Spec: Discord command help

## Scope
Add `/help` explaining every `/ai` and `/ai-admin` subcommand, including required/optional options, descriptions, examples and relevant restrictions. `/help topic:all|ai|admin` selects a guide; omitted topic means all.

## Behavior
- Apply the usual guild/user authorization before serving help. Replies are ephemeral with mentions disabled.
- Help runs before project/provider selection and busy checks, so it remains available while a task runs or a saved selection becomes unavailable. It never launches a CLI or mutates config/session/jobs.
- Return a readable overview in Discord and the full guide as `help.txt` when it exceeds the inline reply size. Focused topics contain the chosen command family's details.
- Document default profile selection, the mutually exclusive profile/provider options, explicit Codex provider selection, per-command project overrides, reset/result behavior, timing options, schedule cancellation and permanent pauses.
- Clearly label admin restrictions. Static documentation is visible to all allowed users; executing admin commands still requires both allowlists. Show example aliases/model names only, without reading runtime paths, credentials or another user's state.

## Integration and verification
Registration adds `/help` alongside existing commands without replacing unrelated commands. Operators run npm run register, build and restart to adopt this schema.

Offline tests check complete coverage of registered leaf commands and options, guide topics, bounded replies/full attachments and disabled mentions. Run npm run build and npm test. Live Discord rendering and screenshots require a connected server/session and remain a release check.
