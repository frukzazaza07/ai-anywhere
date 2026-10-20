# Security policy

## Supported versions

Only the latest `1.0.0-beta` release candidate receives fixes during the self-hosted beta. There is no stable release or support guarantee yet. Upgrade to the latest beta before reporting a reproducible defect. Supported runtime requirements and platform verification status are in [the quickstart](docs/quickstart.md).

## Report privately

Use this repository's **Security → Advisories → Report a vulnerability** form when GitHub private vulnerability reporting is enabled. Include the affected commit/version, OS, Node and CLI versions, reproduction steps using a disposable project, and expected versus observed behavior. Remove tokens, account identifiers, prompts and private project content. Do not put vulnerability details or credentials in public issues, Discord messages or pull requests.

Private reporting must be enabled and tested by the repository owner before publication. If the form is unavailable, keep the details private until the maintainer supplies a private channel; no alternate address has been designated. See [GitHub's private reporting setup](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository).

## Trust boundary

This bot is for trusted, explicitly allowlisted users in one configured guild. It is unsuitable for public or mutually untrusted tenants. All tasks share the host OS account, installed CLI accounts and billing/quota. By default they also share one worker; `AI_MAX_WORKERS` allows up to 8 concurrent CLI processes (one per project folder), multiplying quota use and host load. Project/provider/model session isolation prevents accidental conversation mixing; it does not provide separate OS accounts, containers or filesystem security boundaries.

Workers inherit the host environment with Discord settings and user allowlists removed. Other environment variables, provider credentials and host CLI configuration can remain accessible. Run under a dedicated OS account with only the necessary filesystem and account permissions. Avoid secrets in configured projects. Prompts, file content and responses may be sent to the selected AI provider; ephemeral Discord replies are not end-to-end encrypted.

Codex uses `read-only` or `workspace-write` sandboxing; Codex can use shell tools subject to its own sandbox and host configuration. The bot never enables permission bypass. Claude uses restricted file tools with `dontAsk`, disabled hooks and empty MCP configuration. Gemini uses a narrowed file tool list and disables hooks, extensions, skills, custom tools and MCP. These provider limits depend on compatible CLI versions and are not a universal sandbox against malicious code, prompt injection or host configuration.

Worker commands select configured aliases only; executable overrides remain local settings. Authorization is checked for guild/user and separately for admin operations. Replies are ephemeral with mentions disabled. CLI launches use no shell and receive chat prompts through stdin.

By an explicit operator-approved design exception, admins may supply an absolute
host directory to `/ai-admin project-add` without a preconfigured root. This lets
trusted admins select any folder accessible to the bot's OS account. An optional
`root` alias still restricts additions to immediate child folders of locally
configured `projectRoots`. Exactly one location is required. The command rejects
target symbolic links/junctions and never replaces an existing alias or directory;
existing parents resolve to canonical paths. Saved settings contain the canonical
path, while replies expose aliases only. Failed saves remove only owned empty new
folders, including created parents; cleanup never recursively deletes project
files. Keep admins and config trusted, run one bot instance, and avoid concurrent
config edits or directory moves during additions. This is not an OS sandbox.

Claude/Gemini task execution and model discovery check supported CLI versions before starting their task or metadata protocols. Discovery has a shared deadline for the version probe and metadata session. Codex stdout is capped at 2 MB before JSON line buffering, and its final answer file is capped at 1 MB; exceeding either limit terminates or rejects the task with a sanitized error.

## Local data and shutdown

`.env`, `ai.config.json`, `.ai-config-overrides.json`, `.ai-preferences.json`, `.codex-schedules.json`, `.ai-jobs/` and their backups are ignored by Git. Personal preferences contain guild/channel/user IDs and provider/model/effort choices. Schedule storage contains prompts, owner IDs and canonical directories; protect it and any backups. Job history (`.ai-jobs/`, one file per job) contains owner IDs, prompts, project aliases, results and redacted diffs. It keeps the newest 200 jobs; delete files there to remove history sooner. `/ai clear` does not delete job history. Only the owning user can list or open a job through Discord; admins can only see and stop other users' active job IDs. POSIX runtime writes use mode `0600`; on Windows restrict filesystem ACLs yourself. Provider CLIs may retain their own histories and credential caches independently of this bot.

Sessions and the latest per-session result are in memory and are lost when the bot exits; job history persists. Queued jobs never start after a restart or shutdown. `/ai changes` snapshots the project into a private temporary Git index/object store (deleted after the job) and never writes the project's working tree, index, refs or object database. Diff redaction is pattern-based and cannot catch every secret; keep secrets out of AI-editable projects. Ctrl+C/SIGINT or SIGTERM stops new work and waits for active work to finish, then saves schedules and disconnects. With the default disabled timeout, a stalled task can delay shutdown until it is stopped with `/ai stop`. Force termination and `/ai stop` can leave partial project changes; interrupted one-off schedules fail on restart and are not replayed. Repeating interrupted jobs advance to a future interval. `/ai cancel` removes a schedule and does not terminate an active worker; `/ai stop` terminates the worker process tree and is limited to the task owner or an admin.

## Publication checks

Run `npm run release:check` and `npm audit` against the release candidate. The scan is heuristic and cannot establish that files/history are secret-free. Review Git history, screenshots, artifacts, third-party notices and credential/runtime exclusions manually; rotate any credential that was published. See [release verification](docs/release-verification.md) and [third-party notices](THIRD_PARTY_NOTICES.md).

The release scanner rejects symbolic links and directory junctions in candidate paths before reading contents. It requires regular files within the canonical repository root and applies the same checks to package metadata. Private runtime files and known ignored artifact directories are rejected; Git excludes other ignored untracked files from the normal candidate list. Keep the repository and scanner code trusted and avoid concurrent filesystem changes during scanning.
