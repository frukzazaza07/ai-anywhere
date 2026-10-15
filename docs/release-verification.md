# Release verification record

Candidate: `1.0.0-beta.1`, proposed tag `v1.0.0-beta.1`. Date: 2026-10-13. This record is preparation, not approval to publish. Complete all gates using the final commit and archive, record exact versions, and repeat checks after changes.

## Automated/local evidence

| Check | Result |
| --- | --- |
| TypeScript build | Passed on Windows with Node 24.21.0 |
| Standard `npm test` | Blocked by this execution environment: piped child processes fail with `EPERM` before tests start |
| P2 security fixes | 77 selected tests passed in process with generated mock CLI scripts and simulated child-process streams/termination; new regressions fail when the guards are removed. Real OS process-tree cleanup remains unverified |
| P3 scanner fix | 7 tests passed, including real Windows directory junctions; 1 actual file-symlink case skipped for missing Windows privileges. Equivalent leaf-link metadata checks and strict test typechecking passed |
| Alternative in-process verification | 88 config/session/schedule/registration/help/init tests and 12 doctor/shutdown tests passed using temporary TypeScript transpilation and Node's `--test-isolation=none`; CLI-spawn tests remain unverified |
| Initial complete alternative run (before two additional regressions) | 96 passed / 32 failed; most failures stem from piped child-process restrictions. Windows fixture cleanup was made resilient with bounded deletion retries; the affected in-process groups now pass |
| `npm audit --json` | Zero reported advisories across 63 dependency entries; snapshot only, repeat at publication |
| Release source scan | Passed for 96 current candidates using `git ls-files --cached --others --exclude-standard` piped to `node scripts/release-check.mjs --stdin`; candidate and package metadata reads now reject symbolic links/junctions and private paths. Ordinary Node→Git pipes are restricted here |
| Credential/runtime exclusion | Git ignores credentials, local configs, schedule storage and their backups; npm source package dry-run contains no detected private runtime files |
| Dependency licenses | All 63 lockfile entries have declarations; native Codex voice and Microsoft runtime notices require separate review (see [inventory](../THIRD_PARTY_NOTICES.md)) |
| Hosted CI | Workflow prepared; Windows/Linux/macOS results pending |
| Clean installation, real Discord/providers, screenshots | Not performed |

`--stdin` accepts a newline-delimited Git file list when the host cannot launch a piped Git subprocess. It performs the same scan; it is not a substitute for reviewing source/history/artifacts. `npm pack --dry-run --ignore-scripts --json` was inspected using a workspace-local npm cache. No archive was published and no private local config was read for the scan.

The latest standard test attempt was blocked before all 23 test files started. Earlier in-process runs in this table are historical evidence, not additive totals or a substitute for the complete suite. The latest fixes and their verification limits are detailed in [the security review](../security-review.md).

## Maintainer publication gates

- [ ] Confirm ownership/contributor rights and approve the MIT grant/copyright notice.
- [ ] Enable GitHub private vulnerability reporting and verify a private report can be submitted. Supply a private alternate channel if hosting elsewhere.
- [ ] Obtain green CI for every claimed supported OS and both Node versions. Run the standard offline test suite outside this restricted environment.
- [ ] Review dependency advisories again, full Git history, final source archive and screenshots. Preserve applicable upstream notices; exclude all local credentials/runtime files. Review every bundled component if changing to a binary distribution.
- [ ] Perform the smoke tests below on a clean installation of each claimed supported configuration. Record exact Node, OS and CLI versions; do not infer results from offline mocks.
- [ ] Sanitize and attach real screenshots, reconcile unresolved compatibility findings, then create the beta tag/release deliberately. No tag or release is created by these changes.

## Live installation record

Copy this table for each platform/provider tested. Use a disposable project with no secrets and a private test guild. Pin documented versions first, then record any newer versions separately.

| Field | Value |
| --- | --- |
| Candidate commit/archive hash | Pending |
| OS/version/architecture | Pending |
| Node/npm versions | Pending |
| Codex version (target 0.162.1) | Pending |
| Claude native version (minimum stable 2.1.248, if enabled) | Pending |
| Gemini version (minimum stable 0.63.0, if enabled) | Pending |
| Provider account authentication type (no identifiers) | Pending |
| Tester/date | Pending |
| Findings and screenshot references | Pending |

## Smoke-test procedure

1. **Clean install:** extract/clone the candidate into a fresh directory with no dependencies/runtime files. Install using `npm ci`, create local settings from templates, log in as the bot OS user, run doctor/build/tests, register and start. Record warnings and installed versions.
2. **Registration:** verify `/ai`, `/ai-admin`, `/help` schemas and autocomplete. If a legacy `/codex` command exists, confirm registration removes the matching old bot definition and preserves an unrelated definition. Rerun registration to check idempotence.
3. **Authorization/privacy:** test an allowed user, disallowed user, wrong guild and allowed non-admin. Admin mutations require both allowlists and the configured guild. Replies/attachments remain private; an `@everyone` prompt/result must not ping users.
4. **Providers/permissions:** run a harmless read-only task for every enabled documented CLI version; test explicit follow-up/new/clear/result/status. Confirm Claude/Gemini cannot use shell/custom integration tools. In a disposable folder, test workspace-write file edits and a denied tool request without enabling permission bypass.
5. **Isolation/shared worker:** use two users/channels, two configured project aliases, providers and models. Confirm follow-ups/results remain in the selected tuple and only one worker runs globally. A concurrent request must get busy rather than launching another CLI. Unknown aliases/paths/executables cannot be selected in chat.
6. **Profiles/config:** change profiles and defaults while idle; verify autocomplete/reload. Changes while busy must fail. Delete/retarget a captured profile or remap its project; its schedules must pause permanently without following a new default. A failed config write must not report success.
   Test `/ai config` with two users/channels: choose provider/model/effort, omit prompt options, override each field for one request and restart to verify personal persistence. Change effort without losing model history. Check pagination, CLI-default choices, empty model lists and stale dropdowns after reload/restart. Confirm revoked models are rejected and saved schedules retain their captured effort. Personal changes may apply during a running task to later prompts.
   First test a clean environment-only installation with `/ai init` as an allowed admin: create a file, select defaults, run the suggested task and restart to check persistence. Reject non-admin/wrong-guild setup and busy setup. Repeat with a manually copied file and verify init preserves it. Credentials and host paths must never appear in its private reply/attachment.
   Configure a disposable `projectRoots` entry locally and reload. As an admin,
   use `project-add` with omitted `create` to register an existing child folder,
   then `create:true` to create an empty new folder. Verify immediate autocomplete,
   project selection and persistence after restart. Reject non-admin/wrong-guild
   access, busy changes, invalid names, junctions and duplicate aliases/folders.
   Confirm defaults, other selections and captured schedules keep their targets.
   Capture private alias-only success and failure replies.
   Also test `project-add directory:ABSOLUTE_PATH` without configured roots, with
   an alias different from the directory name. Verify existing-folder registration,
   nested parent creation, persistence and private responses. Reject supplying both
   root/directory, neither location, relative paths and unauthorized path submissions.
7. **Scheduling:** test one-off/repeating jobs, list/cancel isolation, Bangkok and explicit timezone inputs. Cancel a running repeat and confirm its active task finishes while future runs stop. Results are retrieved in the captured user/channel/project/provider/model tuple.
8. **Shutdown/restart:** Ctrl+C/SIGTERM while idle, during a manual task, while a schedule claim is being saved, and during one-off/repeating tasks. New tasks/schedules must stop; the worker finishes or reaches its configured deadline, replies settle, saved outcomes are accurate and Discord disconnects. Repeated signals must not duplicate cleanup. Restart and check completed one-offs do not replay, repeats retain their next cadence, and sessions/results are absent. On Windows separately record how the chosen service manager stops the process; forced service stops are not graceful signals.
9. **Jobs:** run a task and note its job ID; confirm `/ai jobs`, `/ai result id:…` and autocomplete show only your jobs, and that they survive restart. Run a repeating schedule twice and confirm two separate job records. Start a workspace-write task that spawns a child process (for example a test run) and stop it with `/ai stop id:…`; confirm with the OS process list that the CLI and its children are gone, the worker accepts the next task, a non-owner is denied and an admin succeeds. Queue jobs with `queue:true` while busy; confirm FIFO start, positions, the full-queue reply, withdrawing a queued job, and that queued jobs are cancelled (not started) after restart. Watch the 30-second progress edits for Codex/Gemini activity and Claude's "not reported" state, and confirm they stop after completion. In a Git project with existing uncommitted edits, confirm `/ai changes id:…` shows only the job's files and diff, hides a `.env` change, pages on mobile, and leaves `git status`, the index and HEAD unchanged.
10. **Failure/recovery:** test invalid login, missing CLI, timeout and schedule storage write failure. Replies/logs must hide raw provider diagnostics. Shutdown save failure must exit unsuccessfully. In a disposable test only, force-stop an active schedule, restart and confirm one-offs fail without replay and repeats advance to a future interval. Review partial project changes.

## Screenshot capture checklist

- [ ] `/help` and first successful read-only `/ai run` with a visible private-reply indicator.
- [ ] Registered commands after legacy cleanup.
- [ ] Project/profile selection and busy response.
- [ ] `project-add` existing-folder and creation replies, immediate selection and denied admin access.
- [ ] Schedule listing/cancellation and completed-result retrieval.
- [ ] Restart behavior showing empty in-memory results and retained schedule state.
- [ ] `/ai jobs`, a progress update, `/ai stop`, a queued job and `/ai changes` on a phone.

Use test-only content. Crop/redact names, IDs, project paths, tokens, account data and unrelated chat before adding images to `docs/screenshots/`. Do not fabricate screenshots or use design mockups as verification evidence.

## Stable release and future work

Resolve significant beta installation/provider defects, repeat these smoke tests on supported configurations and document real OS signal/service behavior before a stable tag. Shutdown and doctor implementation are available, but stable/live validation is still pending. Job history (results with retention and owner-only access), process-tree cancellation, a bounded queue, progress updates and per-job change viewing are implemented and covered by offline tests; their live checks are in smoke test 9. Persisting CLI session references across restart remains future work.
