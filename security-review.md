# Pre-commit security review

Reviewed: 13 October 2026. Package: `1.0.0-beta.1`.

No likely live secrets were found in the 93 existing Git commit candidates or the three reachable commits. Nothing was staged at review time. This finding covers the reviewed snapshot, not future staging changes, unreachable Git objects, remote branches that have not been fetched, or ignored local credentials.

The original code review found two P2 runtime issues and one P3 scanner hardening issue. All three were subsequently fixed at the user's request. The original review findings below retain the evidence from before the fixes.

## Findings

### Resolved P2: Model discovery did not enforce supported CLI versions

Locations: [src/provider-discovery.ts:36](src/provider-discovery.ts#L36), [src/provider-discovery.ts:53](src/provider-discovery.ts#L53), [src/provider-discovery.ts:123](src/provider-discovery.ts#L123). Compare the task execution guard at [src/agent-runner.ts:186](src/agent-runner.ts#L186).

Opening or refreshing the model picker starts Claude/Gemini metadata protocols without the bounded compatibility check applied to task execution. An unsupported installed CLI can therefore reach initialization, including Gemini `session/new`, even though task execution would reject its version. This leaves the bot relying on security settings that unsupported versions may not implement.

An in-process synthetic child-process fixture confirmed that Gemini discovery launched the protocol and sent `initialize` followed by `session/new`, without any `--version` invocation. The existing task guard rejects the fixture's designated version `0.1.0`. No real CLI, model request, hook, or extension was executed. Actual hook execution or remote code execution on an older CLI was not demonstrated.

Fix: apply the same bounded version validation before Claude/Gemini protocol startup and reject unsupported versions with sanitized diagnostics. Add regression tests proving incompatible versions never reach protocol initialization.

External CLI versions matter independently of `npm audit`: Claude and Gemini are configured host installations, outside this repository's lockfile. Google's [Gemini trust-model advisory](https://github.com/google-github-actions/run-gemini-cli/security/advisories/GHSA-wpqr-6v78-jr5g) documents earlier headless trust and tool-allowlisting defects. That advisory provides context; this review does not establish that this bot reproduces those exploits.

### Resolved P2: Codex stdout was buffered without a size limit

Location: [src/runner.ts:77](src/runner.ts#L77). The final answer-file limit at [src/runner.ts:108](src/runner.ts#L108) does not limit the stdout stream.

`readline` buffers an incomplete line until a newline or stream end. A stalled or malfunctioning CLI emitting an arbitrarily long line can grow the bot's memory while it holds the shared worker. The disabled-by-default task deadline increases the availability impact. Large JSON events can also reach parsing without a stream byte limit.

A synthetic in-process child emitted 2,000,100 stdout bytes without a newline and a small answer file. `runCodex()` completed successfully with zero termination calls, confirming that the answer-file limit does not enforce a stdout limit. The fixture did not deliberately exhaust memory or launch a real process.

Fix: count stdout bytes before handing them to `readline`, terminate the worker on overflow, and return a sanitized output-limit error. Test newline-free floods, oversized event lines, cleanup, and preservation of the previous successful session.

### Resolved P3: Release scanner followed symbolic links

Location: [scripts/release-check.mjs:25](scripts/release-check.mjs#L25).

The scanner checks a candidate's spelling, then `readFileSync()` follows its symbolic-link target. A candidate such as `docs/local.md` pointing to an ignored credential file can cause that file to be read through the alias. Symbolic-link directories can cause the same problem. This conflicts with the scanner's stated exclusion of ignored credentials and runtime state; large files or special-file targets can also make scanning unreliable.

No symbolic links were present in the reviewed candidates, so this did not affect the current secret scan. This is a conditional hardening issue, not evidence that credentials are currently staged or that scanner output reveals credential values. Git normally stores a symbolic link's target text rather than the target file's contents. The example was reviewed statically and was not executed against a credential file.

Fix: define a policy for symbolic links, reject file and ancestor link traversal before opening candidate content, and ensure resolved paths remain within the repository and respect private/ignored-file exclusions.

## Checks completed

- Reviewed tracked modifications and untracked additions, including Discord authorization, configuration components, initialization, session isolation, schedule ownership/dispatch, CLI launches, diagnostic replies, and CI permissions. Independent reviewers inspected authorization/state management and CLI/scanner boundaries.
- `scripts/release-check.mjs --stdin` passed for all 93 existing candidates. Git supplied the candidate list because the sandbox blocks Node subprocess spawning. The scanner checked common token/private-key patterns, credential assignments, private filenames, personal home paths, and package/lockfile consistency.
- An additional scan read all 93 candidate files and found no AWS access-key, Slack-token, Stripe-key, credential-URL, quoted credential-assignment, or private-key patterns. No binary candidates or symbolic links were found. Findings would have reported filenames and line numbers only, never matched values.
- Scanned all three reachable commits for common Discord, OpenAI, Google, GitHub, Slack, AWS, and private-key patterns. Historical file inventories contained no private runtime/credential filenames matching the reviewed exclusions.
- `git check-ignore` confirmed exclusions for `.env`, `ai.config.json`, `.ai-config-overrides.json`, `.ai-preferences.json`, `.codex-schedules.json`, portable Node, and temporary verification artifacts. `.env.example` contains placeholders.
- A fresh `npm audit --json --ignore-scripts` completed successfully and reported **0 vulnerabilities** for the locked dependency graph. This does not cover configured external CLIs or unknown advisories.
- The CI workflow requests read-only repository contents and disables checkout credential persistence.
- Build and the 31 relevant in-process tests passed in the preceding implementation check. The standard 22-file `npm test` suite remains blocked by sandbox `spawn EPERM`; actual Discord/CLI behavior and cross-platform CI were not verified here.

Ignored `.env`, provider credentials, runtime configuration/state, and private logs were not inspected by the review. Synthetic reproductions used generated data and restored modified environment settings. An external cross-model CLI review was not run.

## Deployment boundary

The supported environment is a trusted-user, self-hosted bot sharing one OS account and provider accounts. Guild/user/admin checks, private replies, disabled mentions, prompt delivery through stdin, fixed executable selection, and restricted Claude/Gemini tools were preserved in the inspected paths. No actionable authorization bypass was found within that declared boundary.

Environment filtering alone does not prevent workers from reading credentials stored in project files. In particular, initial setup can choose the bot startup directory, which may contain `.env` and private runtime state. Keep credential-bearing bot state outside AI project directories and use host filesystem/account isolation where necessary. This is a deployment limitation of the shared-host design, not a claim that `.env` is tracked or was read during this review.

Committing the reviewed source is not equivalent to certifying the bot for deployment. Run the full offline suite in a subprocess-capable environment and perform the documented Discord/CLI release checks before a stable release. Recheck the exact staged snapshot before committing, especially if additional files are added after this review.

## P2 resolution — 13 October 2026

- Claude/Gemini discovery now uses the task runner's bounded CLI executor and compatibility validator before protocol initialization. The version probe and metadata session share one deadline; incompatible, malformed, failed, stalled, and oversized version responses cannot start a metadata session.
- Codex stdout passes through a 2 MB byte limit before `readline`. Overflow terminates the worker and rejects with `AI_OUTPUT_LIMIT`, even when the final answer file is small. The existing 1 MB final-answer limit uses the same sanitized error. Temporary output is removed before the rejected task returns, and the previous successful session remains active.
- Added regression cases to [test/provider-discovery.test.ts](test/provider-discovery.test.ts) and [test/runner.test.ts](test/runner.test.ts), including version-probe failures, newline-free output floods, oversized JSON events, aggregate event output, large answer files, temporary-file cleanup, and worker/session recovery.
- Build and strict typechecking of the seven selected test files passed with Node `24.21.0`. **77 tests passed** in process, using an ignored local fixture that executes generated mock CLI scripts with simulated child-process streams and termination. Removing the two guards in an ignored verification copy caused the new regressions to fail, confirming they detect the original issues.
- `npm test` remains blocked by sandbox `spawn EPERM` before any of the 22 test files starts. The simulated CLI checks do not establish real OS process-tree termination, installed CLI compatibility, or live Discord behavior; those checks remain required outside this sandbox.

## P3 resolution — 13 October 2026

- The scanner now checks each candidate path component with `lstat` before opening content, rejects file symlinks and directory links/junctions, accepts only regular files within the canonical repository root, and rejects private runtime files, their backups, and known ignored artifact directories. Git still supplies the candidate inventory and excludes other ignored untracked files.
- Reads use a checked file descriptor, no-follow/nonblocking flags where the platform supplies them, and file identity/path checks before reading. `package.json` and `package-lock.json` use the same checks even when omitted from a supplied candidate list. Filesystem failures produce sanitized diagnostics.
- Added [test/release-files.test.ts](test/release-files.test.ts) covering permitted source/template files, private exclusions, traversal and absolute paths, alternate streams, real Windows directory junctions to ignored/external folders, leaf-link metadata, non-file candidates, and replacement during opening. Fixtures contain generated text only, and assertions verify rejected paths are never opened.
- Build, strict typechecking of the new test, and scanning all **96** commit candidates passed with Node `24.21.0`. The focused in-process suite passed **7 tests**; **1** actual file-symlink test was skipped because this Windows environment lacks file-symlink privileges. The equivalent leaf-link metadata check passed, and real directory-junction tests ran successfully. The same regression suite failed when run against an ignored copy of the former unchecked reader.
- Standard `npm test` remains blocked with `spawn EPERM` before the now **23** test files start. Real file-symlink coverage remains part of the cross-platform CI checks. The path checks assume the repository root and scanner code are trusted; they do not provide an OS sandbox against an actor continuously replacing ancestor directories.
