# English quickstart

This self-hosted beta runs local AI coding CLIs from private Discord commands for trusted users. Use a dedicated host account and disposable project for your first task. Read [SECURITY.md](../SECURITY.md) before granting access.

## Requirements and platform status

| Component | Requirement | Verification |
| --- | --- | --- |
| Node.js | >=24.17.0; Node 24 recommended for the beta | Local build uses Windows / Node 24.21.0 |
| Codex | Bundled npm dependency 0.162.1 | Offline adapters; live account/task verification pending |
| Claude Code (optional) | Native stable CLI >=2.1.248 | Minimum enforced; live verification pending |
| Gemini CLI (optional) | Stable CLI >=0.63.0, local JavaScript entry point | Minimum enforced; live verification pending |
| OS | Windows is the initial beta target; Linux/macOS are candidate targets | CI covers all three, pending hosted results and live smoke tests |

Newer optional CLI versions can change flags or permissions; a version check is not a compatibility guarantee. No OS/provider combination is certified for a stable release yet. Git and a usable provider account are needed. The project directory can be a plain folder or Git repository, including spaces/Unicode.

## Minimal Codex-only setup

1. Clone/download the repository to your host, open a terminal there, and run `npm ci`.
2. Copy `.env.example` to `.env`: PowerShell `Copy-Item .env.example .env`; Linux/macOS `cp .env.example .env`.
3. In the [Discord Developer Portal](https://discord.com/developers/applications), create an application and bot. Set `DISCORD_TOKEN` to its bot token and `DISCORD_CLIENT_ID` to the application ID. Invite it with the `bot` and `applications.commands` scopes. Give it access to the test channel; the bot uses only the Guilds gateway intent and does not require Message Content.
4. Enable Discord Developer Mode to copy your server and user IDs. Set `DISCORD_GUILD_ID` and `ALLOWED_USER_IDS` (comma separated for multiple trusted users). To use Discord setup, put your user ID in `ADMIN_USER_IDS` too. Leave it blank if you prefer only local configuration; admins must also be allowed users.
5. Optionally set `CODEX_WORKDIR` to an existing disposable folder outside this bot checkout. Use forward slashes on Windows. Leave it blank to use the bot startup folder as the setup candidate. Keep `CODEX_SANDBOX=read-only`, `AI_PROVIDERS=codex` and `AI_DEFAULT_PROVIDER=codex`. Keep `CODEX_TIMEOUT_SECONDS=0` for no task deadline, or set a positive number of seconds if you want one.
6. For Discord setup, leave `ai.config.json` absent. The bot can start with only the host credentials, allowlists and default provider settings; missing or invalid project settings put it in setup mode until `/ai init` completes. For manual setup, copy/edit `ai.config.example.json` as before. An existing `ai.config.json` takes precedence over environment projects/providers/models/defaults and is preserved by `/ai init`.
7. As the same OS user that will run the bot, run `npx codex login`, then `npx codex login status`.
8. Run the following:

```sh
npm run doctor
npm run build
npm test
npm run register
npm start
```

On PowerShell systems that block `npm.ps1`, use `npm.cmd`/`npx.cmd` with the same arguments. Keep your token local; never paste it into Discord or an issue. Registration affects the configured guild and removes only the matching legacy `/codex` definition owned by this bot; unrelated commands remain.

## Finish setup in Discord or use a copied file

After the bot starts, run `/ai init` in your configured server as an allowed admin. With no options it opens a configuration form asking for the default project and profile aliases, prefilled with current choices. The form lists approved aliases and labels `default` as the bot startup folder in setup mode. Submit the form to create and activate `ai.config.json`. Alternatively, choose `/ai init project:default profile:codex` with autocomplete to save directly. The private reply confirms creation, shows the active choices and gives a first-task command. No restart is needed. Reopen `/ai init` if the configuration changed while the form was open.

The bot still needs valid local Discord credentials, allowlists, sandbox/timeout settings and provider settings before it can connect. Project settings and `ai.config.json` are optional for startup. When project settings are missing or invalid, tasks stay blocked until an admin approves setup; saved schedules are paused without moving their captured directories. The fallback project is the canonical folder containing the config file, which is the startup folder in the normal launch commands. Configure other folders in `.env` and restart before setup. Invalid existing config files, providers or overrides still fail validation. Install/log in to the selected CLI locally before running tasks. Setup never asks you to post credentials, host paths or executable settings in Discord. After setup, use `/ai-admin profile-set`, `/ai-admin defaults` and the other admin commands for permitted configuration changes. If saved overrides choose different defaults, change them with `/ai-admin defaults` before requesting those choices in `/ai init`.

The existing manual path remains supported: copy `ai.config.example.json` to `ai.config.json`, edit local directories/providers/profiles, and start the bot. If it is already running, use `/ai-admin reload` to validate and activate the copied file. `/ai init` never replaces a copied/existing file, even if it is copied while setup is saving. Rerun `npm run register` once after upgrading to expose the new `init` subcommand.

## First task

In your configured guild/channel, run `/help`, then `/ai run provider:codex prompt:List the top-level files and explain what this project does. Do not modify files.` The bot acknowledges privately and returns text or an attachment. Use `/ai result provider:codex` in the same channel/user scope if the reply expires, and `/ai status provider:codex` for worker/session state. `/ai new` starts a new conversation; `/ai clear` clears its in-memory conversation/result without deleting project files or CLI history.

Only one worker runs across all users, projects and providers. Busy tasks are rejected; there is no queue. Results and sessions disappear on restart. To stop the bot, press Ctrl+C and wait for its active task to finish. A disabled deadline means a stuck task can delay shutdown indefinitely.

## Optional projects and providers

To add projects through Discord, finish initial setup. After upgrading,
build/restart and run `npm run register` once for the updated `project-add`.
Use `/ai-admin project-add name:my-app directory:D:/new-location/my-app create:true`
to create a target folder and missing parents, then persist its alias. Omit
`create` to register an existing directory. The path is absolute on the bot host;
no root configuration is needed and the alias can differ from the folder name.
Alternatively configure `"projectRoots": { "workspace": "D:/projects" }` locally,
reload and use `root:workspace` instead of `directory` to name an immediate child
folder. Choose exactly one location. Then use `/ai project name:my-app`. Additions
activate immediately and survive restart. Only approved admins can supply paths;
worker commands and replies use aliases. Keep credentials outside project folders
and avoid editing config or moving directories while an addition is saving.

Run `/ai config` to open private provider, model and effort dropdowns. Each selection
is saved immediately for your server/channel/user, with separate settings for each
provider, and survives restart. Use the model pagination buttons for longer lists.
You can also save directly with `/ai config provider:codex model:MODEL effort:high`.
The picker loads model choices from the selected provider CLI and combines them with
local configured entries. No manual model-list setup is required. Use **Refresh models
from CLI** after installation/login changes. Validated CLI catalogs persist in the
private overrides file and are cached briefly; failures keep saved choices with a
fixed explanation. Busy workers use saved choices until idle. Catalogs are metadata,
so a task still verifies model/account access.

Then `/ai run prompt:Review this project` uses your saved choices. Explicit `provider`,
`model` or `effort` options override only that request. A named profile uses its own
model and accepts a per-request effort override. `model:__default__` and
`effort:default` select CLI defaults. Users without preferences retain the shared
default-profile behavior. Changes to personal settings preserve existing model
conversation history and do not redirect saved schedules. Personal settings live
in the private `.ai-preferences.json` file. Register the new command/options and
restart after upgrading; subsequent personal changes need no restart.

Use `/ai models [provider:codex]` to see allowed model IDs and profiles. Session
commands offer a `model` autocomplete option: `/ai run provider:codex model:MODEL
prompt:Review the project`. Use the same provider/model/project for `status`,
`result`, `new` and `clear`. Model alone uses the default profile's provider;
an explicit profile cannot be combined with provider/model options.

Operators can run `npm run models` to list local choices or `npm run models --
--provider codex --discover` to inspect the installed CLI catalog without
a model turn. Claude and Gemini also support `--discover` through their metadata
protocols. Add `--json` for structured output. Terminal listing leaves config unchanged;
Discord `/ai config` loads and enables the returned model choices automatically.
After upgrading, build, register and restart to expose these new command options.

Copy `ai.config.example.json` to `ai.config.json` and set existing local directories. Enable only installed providers and configure profiles/defaults. Profiles bind a `project` alias, `provider` and optional `model` (CLI default when omitted). `/ai run profile:review prompt:…`, `/ai status profile:review` and `/ai result profile:review` use that bound project regardless of your current project. For direct selection, use `provider:… model:… project:…`. `/ai projects` and `/ai project name:…` list/switch the current project used by direct selections and legacy profiles without a binding. A conflicting project override on a bound profile is rejected. `/ai-admin reload` applies local config changes for an authorized admin while idle; runtime catalog changes do not require command registration.

Create a bound profile with `/ai-admin profile-add name:review project:web provider:claude model:sonnet`, or bind an existing profile using `profile-set` with the same options. Both require a project alias. After upgrading, build, restart and run `npm run register` once to publish these admin options. Existing profiles without `project` retain their current-project behavior until explicitly updated; captured schedules keep their original directories. Moving or removing a profile project binding pauses affected schedules.

Install/login [Claude Code](https://code.claude.com/docs/en/setup) under the bot's OS account. Use `claude auth login` and `claude auth status`. Set its optional absolute native executable path locally; `.cmd`, `.bat`, `.ps1` and JavaScript wrappers are rejected. Install Gemini CLI with `npm install -g @google/gemini-cli@0.63.0`, launch `gemini` for [authentication](https://geminicli.com/docs/get-started/authentication/), and configure its absolute JavaScript entry point. On PowerShell, find it with `Join-Path (npm root -g) '@google/gemini-cli/dist/index.js'`.

`npm run doctor` checks config, project directories, enabled CLI versions and available auth indicators without prompts/model requests. It prints fixed summaries rather than raw CLI logs or credentials. Exit 1 means a failed check; warnings require operator review. Gemini cached credentials/API keys are indicators only; the command cannot verify their freshness, model access, account quota, or Discord token/server access.

Schedules capture the selected directory/provider/model/profile. Try `/ai run provider:codex prompt:Summarize the project after:1m`, inspect `/ai schedules`, then retrieve `/ai result`. `/ai cancel id:…` removes a schedule; an already running task finishes. Times without a timezone use Bangkok time. See `/help topic:ai` for complete options.

## Screenshots and release status

Live screenshots have not been captured. The [smoke-test record](release-verification.md) specifies the private-reply, registration, profile, schedule and restart captures required before publication. Add screenshots only from a disposable test project after removing account IDs, tokens, paths and private content. [Beta notes](release-notes.md), [contributing](../CONTRIBUTING.md), and [the README](../README.md) provide the remaining details.
