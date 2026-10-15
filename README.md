# AI Anywhere

Run local Codex, Claude Code, or Gemini CLI tasks from private Discord commands. Codex is included.

**Beta `1.0.0-beta.1` · MIT.** Windows is the initial target; live platform/provider checks are pending. [Release status](docs/release-verification.md).

## Install

Install [Node.js **24.17.0+**](https://nodejs.org/en/download) and [Git](https://git-scm.com/install/). You also need a Discord server you manage and a Codex account. Keep your computer running.

### 1. Download

Open PowerShell or a terminal:

```sh
git clone https://github.com/frukzazaza07/ai-anywhere.git
cd ai-anywhere
npm ci
```

Copy the settings template:

```powershell
Copy-Item .env.example .env
```

On Linux/macOS: `cp .env.example .env`. Open `.env` in a text editor.

### 2. Connect Discord

1. In the [Developer Portal](https://discord.com/developers/applications), create an application. Copy **General Information → Application ID**. Under **Bot → Reset Token**, copy the token.
2. Under **Installation**, enable **Guild Install** with scopes `bot` and `applications.commands`. Open its install link and add the bot to your server. Give it access to your channel. [Discord setup guide](https://docs.discord.com/developers/quick-start/getting-started).
3. In Discord, enable **User Settings → Advanced → Developer Mode**. Right-click your server and yourself to **Copy ID**. [ID guide](https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID).
4. Replace these values in `.env`:

```dotenv
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=your_server_id
ALLOWED_USER_IDS=your_user_id
ADMIN_USER_IDS=your_user_id
CODEX_WORKDIR=D:/projects/my-app
```

Use an **existing folder**; Git is optional. Windows paths use forward slashes. Blank `CODEX_WORKDIR` uses the bot folder.

Use commas for multiple user IDs. Admins must also be allowed users. Keep tokens private. Message Content intent is unnecessary.

### 3. Log in and start

Run as the same computer user that will run the bot:

```sh
npx codex login
npx codex login status
npm run doctor
npm run build
npm run register
npm start
```

Fix doctor failures; an initial-setup warning is expected. Doctor cannot verify Discord/model access. If PowerShell blocks scripts, use `npm.cmd` and `npx.cmd`.

### 4. Finish in Discord

Run `/ai init` in your server and submit the project/profile form. It creates and activates `ai.config.json` without overwriting existing files.

Try:

```text
/ai run prompt:Explain this project without changing files.
```

Keep the terminal open. **Ctrl+C** stops the bot after its active task finishes.

## Daily commands

Type `/` and select options from autocomplete.

| Command | Purpose |
| --- | --- |
| `/help` | All commands and examples; `topic:ai` or `topic:admin` narrows the guide |
| `/ai run prompt:…` | Run a task; its private reply shows the job ID and updates progress every 30 s. Add `queue:true` to wait if the worker is busy |
| `/ai config` | Save your provider, model, and effort using dropdowns |
| `/ai models` | Load available models from the installed CLI |
| `/ai projects` / `/ai project name:…` | List / switch projects |
| `/ai status` / `/ai result` | Check progress / retrieve the latest answer |
| `/ai jobs` / `/ai result id:…` | List your job history / open any saved job, including after restart |
| `/ai stop [id:…]` | Stop a running job or withdraw a queued one (admins: any job); edits are not reverted |
| `/ai changes id:…` | Files and Git diff changed by that job (read-only, paged for mobile) |
| `/ai context` | Show context window usage for the current Claude or Codex session |
| `/ai new` / `/ai clear` | Reset the selected conversation and result |
| `/ai schedules` / `/ai cancel id:…` | List / remove schedules |

Choose just `profile:…` to select its **project + provider + model**, or use `provider:… model:… project:…` directly. Reuse the profile for status, results, and resets:

```text
/ai run profile:review prompt:Review this project.
/ai status profile:review
/ai result profile:review
```

Profiles bind a configured project alias, so switching your current project does not redirect them. A conflicting `project` override is rejected; use direct provider/model/project options to choose another target. Existing profiles without a project keep using your current project until an admin binds them with `profile-set`. Profiles with the same project directory/provider/model share conversation history and the latest result.

Personal settings survive restart; task options override them once. When an admin changes the default profile, earlier personal settings stop applying until saved again with `/ai config`. Profiles may set an effort (`/ai-admin profile-add … effort:high`). Profiles use their own model. `model:__default__` / `effort:default` selects CLI defaults. **Refresh models from CLI** updates choices after installation/login.

## Settings

| File / setting | Purpose |
| --- | --- |
| `.env` | Credentials, access, sandbox, timeout, initial settings |
| `ai.config.json` | Projects, providers, models, profiles, defaults |
| `.ai-config-overrides.json` | Admin changes/model catalogs; overrides base config |
| `.ai-preferences.json` | Saved personal provider/model/effort settings |
| `.codex-schedules.json` | Saved schedules |
| `.ai-jobs/` | Job history: prompts, results and per-job diffs (newest 200 jobs) |
| `CODEX_SANDBOX=read-only` | Read files; use `workspace-write` to allow edits |
| `CODEX_TIMEOUT_SECONDS=0` | No deadline; a positive number sets seconds for every provider |

Keep private settings out of Git and AI-accessible project folders. Run one bot instance.

Manual setup: copy [ai.config.example.json](ai.config.example.json) to `ai.config.json`, edit folders, then start or `/ai-admin reload` while idle. All folders must exist. Relative paths start from the config folder. Aliases: lowercase letter first, then `a-z`, digits, `_`, `-`; maximum 32 characters.

`ai.config.json` replaces `.env` projects/providers/models/defaults. Legacy `.env` setups still work. Restart after changing credentials, access, sandbox, or timeout.

Admin commands: `/ai-admin status`, `reload`, `provider-add`, `profile-add`, `profile-set`, `profile-delete`, `project`, `project-add`, `provider`, `defaults`. Admins can supply an absolute host directory when adding projects; executable settings remain local. Change defaults before disabling their targets. Invalid reloads preserve working settings. Details: `/help topic:admin`.

To add projects from Discord, finish `/ai init`. After upgrading, build, restart
the bot and run `npm run register` once to expose the updated command. An allowed
admin can supply an absolute directory on the bot host:

```text
/ai-admin project-add name:my-app directory:D:/new-location/my-app create:true
/ai project name:my-app
```

This creates the target folder and any missing parent folders, saves the alias to
`ai.config.json` and activates it immediately. No project root configuration is
required. Omit `create` (or use `create:false`) to register an existing directory;
the alias may differ from its folder name. Use an absolute path for the host OS
(including a drive on Windows), not a path on your Discord device. Filesystem
permissions of the bot's OS account still apply. Replies show aliases only.

For the optional root-alias workflow, configure an existing folder locally:

```json
"projectRoots": { "workspace": "D:/projects" }
```

Run `/ai-admin reload`, then `/ai-admin project-add name:my-app root:workspace
create:true`. With `root`, the alias also names an immediate child folder. Choose
exactly one of `root` or `directory`. Future additions need no restart or
registration. Defaults and existing schedules keep their targets. Alias rules
remain as above; target symbolic links/junctions and duplicate aliases are rejected.
Existing parent directories are canonicalized, and `create:true` never replaces
an existing target. `/ai` worker commands continue to accept project aliases only.
Keep credentials and runtime settings outside project folders. Avoid local config
edits and directory moves while an addition saves; detected conflicts require
reload and retry. Failed saves remove only owned, still-empty new directories,
including newly created parents. Inspect any cleanup failure locally before retrying.

### Optional providers

Install/login as the bot's computer user. After `/ai init`, register a supported
provider and create a profile directly in Discord:

```text
/ai-admin provider-add provider:claude models:sonnet,opus default-model:sonnet
/ai-admin profile-add name:writer provider:claude project:web model:sonnet
/ai run profile:writer prompt:Review this project.
```

This supports the existing Codex, Claude Code and Gemini CLI adapters. It does
not install CLIs or add arbitrary API services. `models` approves comma-separated
model IDs; `default-model` is also added to the allowed models. Omit these options
for host/CLI defaults, then use `/ai models provider:claude` to discover models.
Provider additions save to `ai.config.json`; profiles save to local overrides.
Both activate immediately and survive restart. Existing defaults and schedules
keep their targets. Duplicate providers/profiles are rejected: use
`/ai-admin provider` to enable an existing provider or `profile-set` to replace a
profile. `/ai-admin defaults profile:writer` changes the shared default.

`profile-add` and `profile-set` require a project alias; omit model for CLI default. To bind an existing profile, use `/ai-admin profile-set name:review provider:claude project:web model:sonnet`. Local JSON profiles accept `"project": "web"` alongside `provider` and `model`. Build, restart and run `npm run register` once after upgrading for the new admin options. Profile changes that move or remove a captured project binding pause pending schedules; cancel and recreate them.

Build, restart the bot and run `npm run register` once after upgrading to expose
these new commands. Future additions need no restart or registration.

CLI paths and login credentials remain host settings:

| Provider | Requirement / login | Local setting |
| --- | --- | --- |
| Claude | Native stable CLI **≥2.1.248**; `claude auth login` | `providers.claude.executable`: optional absolute native path; otherwise PATH |
| Gemini | `npm install -g @google/gemini-cli@0.63.0`; run `gemini` to log in | `providers.gemini.script`: absolute JavaScript entry path |

Claude rejects script wrappers. Find Gemini's path in PowerShell:

```powershell
Join-Path (npm root -g) '@google/gemini-cli/dist/index.js'
```

For Discord registration, set `GEMINI_CLI_SCRIPT` in the host `.env` to that
absolute entry point before starting the bot. Optionally set `CLAUDE_EXECUTABLE`
to a native executable; otherwise Claude uses PATH. Restart after editing `.env`.
`provider-add` copies only the selected provider's host installation settings;
paths, executable overrides and credentials are never accepted through Discord.

[Optional-provider setup and authentication](docs/quickstart.md#optional-projects-and-providers).

## Schedules

```text
/ai run prompt:Review this project after:10m
/ai run prompt:Review this project every:2 hours
```

Choose one: `after:` (delay), `every:` (repeat, minimum 1 minute), or `at:` (future date). `YYYY-MM-DD HH:mm` uses Bangkok time (UTC+07:00); ISO dates accept timezones.

Schedules survive restart and keep their original targets/settings. Changed/disabled targets pause jobs; cancel and recreate. Jobs wait for the worker and skip missed repeat intervals. Each run is saved as its own job; use `/ai jobs` and `/ai result id:…` for answers; no automatic posts. Cancelling leaves active tasks running; use `/ai stop` to end one.

## Limits and safety

- One shared worker. Immediate requests are rejected while busy unless `queue:true` is set; up to 5 queued jobs then run one at a time in order. Queued jobs are cancelled, not replayed, on restart or shutdown.
- Job history (prompts, results, diffs) is kept in `.ai-jobs/` across restarts; jobs interrupted by a restart are marked failed and never replayed. Conversations, current-project choices and the in-memory latest result disappear on restart. Sessions are isolated by server/channel/user + folder + provider/model.
- Prompts: 4,000 characters. Results: 1 MB; long answers become attachments. Replies expire after 15 minutes; use `/ai result id:…`.
- Accounts, quota, billing, and host access are shared. Allow trusted users only.
- Claude/Gemini use restricted file tools; shell tools are disabled. No Discord approval prompts.
- `/ai changes` needs a Git repository and `workspace-write`; it diffs private snapshots taken before and after the job, so earlier uncommitted edits and other jobs are excluded (hand edits made during the job are not). Likely secrets are hidden.
- Timeouts and `/ai stop` cannot undo edits. Without a deadline, shutdown waits for the active task; use `/ai stop` to end a stalled one.

Read [SECURITY.md](SECURITY.md) before granting access.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| Commands missing | Check IDs/install scopes; run `npm run register` |
| Access denied | Check server/allowed user; admins also need `ADMIN_USER_IDS` |
| Setup incomplete | Run `/ai init` as an allowed admin |
| Worker fails | Run doctor; check CLI login, version, permissions, timeout |
| Reload rejected | Check folders, defaults, and references in both config and overrides |
| Result missing | Match the task's selections and user/channel; restart clears results |

## Development and upgrades

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run TypeScript source |
| `npm run build` | Compile to `dist/` |
| `npm test` | Offline tests using mock CLIs |
| `npm run models -- --provider codex --discover` | Inspect CLI models locally; add `--json` for JSON |
| `npm run register` | Publish commands after command/options change |

Upgrade: stop, back up private settings, update source, run `npm ci`, doctor, build, tests, register, start. Catalog changes need only reload. [Upgrade details](docs/release-notes.md#upgrade).

Source: `src/bot.ts` (Discord), `config.ts`/`runtime-config.ts` (settings), `projects.ts`/`project-sessions.ts`/`sessions.ts` (sessions), `runner.ts`/`agent-runner.ts` (CLIs), `scheduler.ts` (schedules). Edit `src/`; `dist/` is generated. Tests: `test/`.

[Detailed setup](docs/quickstart.md) · [Specs](SPEC-runtime-config.md) · [Design decisions](docs/decisions/) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md) · [Roadmap](TODO.md) · [License](LICENSE)
