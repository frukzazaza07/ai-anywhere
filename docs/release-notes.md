# 1.0.0-beta.1 release candidate

Proposed Git tag: `v1.0.0-beta.1`. This is preparation for a source-distributed, self-hosted beta for trusted users. No tag or public release has been created. The package stays `private: true` to prevent accidental npm publication. [Release gates](release-verification.md) must be satisfied before tagging.

## Install

Follow [the English quickstart](quickstart.md) or [README](../README.md). Use Node.js >=24.17.0, `npm ci`, local CLI login, `npm run doctor`, `npm run build`, `npm test`, `npm run register` and `npm start`. Source archives require compilation before starting; `dist/` and dependencies are not distributed. Copy configuration templates locally rather than including credentials in the release.

## Upgrade

1. Stop the old bot with Ctrl+C/SIGTERM and wait for active work to finish. Older versions without shutdown handling may interrupt tasks; review their project changes.
2. Back up `.env`, `ai.config.json`, `.ai-config-overrides.json`, `.ai-preferences.json`, `.codex-schedules.json` and the `.ai-jobs/` directory privately. Preserve paths, accounts and permissions. Check project changes made by tasks before replacing code.
3. Check out the beta tag once published or extract its source into a new directory, restore the local settings and schedule file, then run `npm ci`, `npm run doctor`, `npm run build` and `npm test`.
4. Run `npm run register` once to expose `/ai config`, model/effort options and `/ai init`, and remove the matching legacy `/codex` command. Use `/ai run provider:codex` or a Codex profile. Start only one bot instance.
5. Verify saved schedules still point at their original aliases/directories and provider/model/effort. Changed or removed targets pause; they never move to a new default. Recreate paused jobs deliberately.

To roll back, stop the bot, restore the previous checkout and its matching private state backup, rebuild and register its command schema. Check for already completed or interrupted jobs before enabling schedules; restoring stale state can repeat work. Sessions and the latest per-session result are not included in backups because they exist only in memory; job history in `.ai-jobs/` is.

## Included behavior

Private `/ai config` dropdowns save provider, model and effort choices per guild/channel/user, with separate settings for each provider and persistence across restart. Omitted prompt options use those choices; explicit options override one request, and named profiles use their own model. Model pagination and CLI-default choices are available. Effort changes preserve model conversation history, and scheduled jobs retain their captured selections.

The picker and `/ai models` load validated model IDs and effort capabilities from the installed Codex, Claude or Gemini CLI. Discovered IDs become selectable alongside locally configured entries. Refresh updates the catalog; failed discovery keeps saved choices. Local `npm run models` supports provider selection and optional metadata discovery. Catalog discovery does not establish account/model access; tasks still check that access when they run.

Private `/ai`, `/ai-admin` and `/help` commands, admin-only `/ai init` first-install configuration alongside manual template copying, locally configured projects and profiles, Codex plus optional Claude/Gemini adapters, one shared worker, durable captured schedules, graceful draining shutdown, local setup diagnostics, cross-platform offline CI and MIT release metadata. Rerun `npm run register` once to expose `/ai init`. See [CHANGELOG.md](../CHANGELOG.md) for feature details.

## Fixes and security

- Restarting with saved project/default-profile overrides pauses older schedules pointing at disabled projects instead of failing startup. Overrides remain saved, and affected jobs retain their original targets until cancelled and recreated.
- Changing a personal model clears inherited effort to CLI default when the new model does not support it. Explicit incompatible effort is rejected before saving.
- Refreshing or paging through `/ai config` preserves the default-profile model for users without saved preferences, keeping displayed effort choices consistent with subsequent tasks.
- Claude/Gemini model discovery checks the same supported versions as task execution: stable Claude Code >=2.1.248 and Gemini CLI >=0.63.0. The version probe has bounded output and shares a deadline with metadata initialization.
- Codex stdout is capped at 2 MB before JSON line buffering; the final answer file remains capped at 1 MB. Overflow returns a sanitized error, cleans temporary output and preserves the previous successful session. Stream overflow terminates the worker.
- Release scanning rejects symbolic links and Windows directory junctions in candidate paths before reading, checks repository containment and private-file exclusions, and verifies opened file identity. Package metadata receives the same checks.

Authorization, private replies, provider restrictions and shared-host limitations are documented in [SECURITY.md](../SECURITY.md). Findings and their resolutions are recorded in [the security review](../security-review.md).

## Verification snapshot — 13 October 2026

- Build passed on Windows with Node `24.21.0`; relevant source and test files passed strict typechecking.
- The P2 checks passed **77 tests** in process with simulated child-process streams and generated mock CLI scripts. The P3 checks passed **7 tests**, including real Windows directory junctions. **1** real file-symlink case was skipped for missing Windows privileges; the equivalent metadata check passed. These runs do not establish real process-tree cleanup or installed CLI behavior.
- The heuristic source scan passed for **96** commit candidates. A fresh dependency audit reported **0 vulnerabilities** in the locked dependency graph; external CLI installations require separate verification.
- Standard `npm test` remains blocked by this environment's `spawn EPERM` before the **23** test files start. Hosted CI, the full offline suite in an unrestricted environment, live Discord/provider smoke tests and release publication gates remain pending.

See [the release verification record](release-verification.md) for publication gates and smoke-test procedures. Recheck the final commit and source archive before tagging.

## Known limitations

- One worker is shared across all providers, projects and users; busy requests are rejected and no task queue exists.
- Conversations, project preferences and saved results disappear on restart; provider histories can remain on disk. A Discord interaction reply can expire after 15 minutes; retrieve a completed result in the same user/channel scope while the bot remains running.
- `/ai cancel` cancels schedules, not active tasks. Shutdown finishes the active task; the default disabled timeout can make shutdown wait indefinitely. Forced termination can leave partial changes.
- Schedule storage is local to one process. Do not run multiple bot instances against it. Interrupted one-off runs fail on restart rather than replaying; repeats skip to a future interval.
- CLI accounts, filesystem access and billing are shared. Provider/session isolation is not tenant security. File tool restrictions for optional providers require compatible versions.
- Doctor checks cannot prove provider model access or Discord connectivity. Gemini authentication remains a local indicator warning.
- Live installation/provider/Discord/platform smoke tests, screenshots, ownership confirmation and full publication review are pending. Windows is the initial beta target; Linux/macOS are candidates with CI coverage, not validated live configurations.

Persistent session/results retention, active cancellation with process-tree cleanup, and a bounded queue remain future design work. They require explicit privacy, retention and partial-change rules before implementation.
