# ADR-013: Jobs, stop, queue, progress and per-job changes

Status: Accepted. Keeps ADR-001's single shared worker and shell-free CLI launch.

Users on mobile needed to find earlier results after a restart, stop a mistaken
or stalled task, wait for the worker instead of retrying, see what a task is
doing, and review its edits without a terminal.

Every task, including each schedule run, now goes through `JobManager`
(`src/jobs.ts`) and gets an 8-hex-character job ID. The manager sits above
`ProjectSessions`; session isolation and Discord transport are unchanged.

- **History.** One private JSON file per job in `.ai-jobs/` (atomic writes,
  POSIX mode `0600`). Records hold owner IDs, prompt, project alias,
  provider/model/effort/profile, state, created/started/finished times, the
  result or sanitized failure, and the job's changes. Canonical directories are
  not stored. Memory keeps summaries; results and diffs are read on demand. The
  newest 200 jobs are kept. On load, `running` becomes `failed` and `queued`
  becomes `cancelled`; nothing is replayed. Only the owner (same guild and user)
  can list or open a job.
- **Stop.** An `AbortSignal` reaches the runners, which kill the CLI process
  tree (`taskkill /t /f` on Windows, process-group `SIGKILL` on POSIX). The task
  settles only after the kill finished and, on POSIX, the group is gone, so the
  worker is never released while descendants run. Owners stop their own jobs;
  admins may stop any job. Stopping a queued job removes it without running it.
- **Queue.** `queue:true` admits up to 5 waiting jobs in FIFO order. The manager
  claims the worker synchronously and starts the next job in the same tick that
  releases the previous one, so schedules and immediate requests cannot slip in
  and two jobs never run together. Queued jobs are cancelled on shutdown and
  restart rather than resumed, which avoids duplicate runs.
- **Progress.** Runners report output and map Codex JSON events and Gemini
  stream events to a fixed set of labels (for example "Running tests"); commands,
  paths and model text are never shown. Claude's JSON mode reports only at the
  end, so its activity is shown as not reported. Ten minutes without CLI output
  is reported as a possible stall. The `/ai run` reply is edited every 30 seconds
  until it finishes or the interaction token nears expiry.
- **Changes.** With `workspace-write` in a Git project, the job snapshots the
  project before and after the run using `git add --all` and `git write-tree`
  with a temporary `GIT_INDEX_FILE` and `GIT_OBJECT_DIRECTORY` (the repository's
  objects as an alternate). The project's working tree, index, refs and object
  database are never written; no reset, checkout or commit occurs. Diffing the
  two trees excludes earlier uncommitted edits and other jobs, which cannot run
  concurrently. Edits made by hand during the job cannot be distinguished. The
  redacted diff (at most 1 MB) is stored with the job; files whose names suggest
  credentials are hidden, and lines matching common secret patterns are masked.

Command schema changes need `npm run register` once after upgrading. Persisting
CLI session references across restart is not part of this decision.
