# ADR-014: Multiple workers with one job per project folder

Status: Accepted. Amends ADR-001/ADR-013's single shared worker at the owner's explicit request.

A team of several users in one channel, each working on a different project,
waited on one another because only one AI job could run at a time.

`AI_MAX_WORKERS` (1–8, default 1) sets how many jobs may run at once. The
default keeps the previous behavior exactly, including resets and project
switches waiting for any active job.

Rules with more than one worker:

- **One job per project folder.** `JobManager` locks the canonical directory;
  a folder inside another counts as the same project. Two jobs therefore never
  edit the same files concurrently, and `/ai changes` before/after snapshots stay
  attributable to one job. `ProjectSessions` also rejects a second task in the
  same directory and enforces the worker count.
- **Queue.** Still bounded at 5 entries. Queued jobs start as soon as a worker is
  free and no running or earlier-queued job uses an overlapping folder, so the
  order is FIFO within each project; unrelated projects may overtake a blocked one.
- **Schedules.** The scheduler claims one due job at a time, then releases its
  dispatch lock while the run continues, so schedules can use other free workers.
  Due jobs whose project is busy are skipped until it is free.
- **Stop.** `/ai stop` without an ID stops the requester's only running job (or,
  for admins, the only running job); otherwise it lists the IDs to choose from.
- **Unchanged gates.** Admin configuration changes, model catalog refresh,
  `/ai init` and host shutdown still require every worker to be idle.

Concurrent jobs share the host account, CLI logins, quota and CPU/memory; the
limit is capped at 8 and documented as a trade-off for operators.
