# ADR-005: Drain accepted work on shutdown and diagnose setup locally

## Status
Accepted.

## Context
The release checklist requires a deliberate shutdown policy, accurate schedule state and useful setup checks. There is no user-facing active cancellation or durable session/result storage. Abruptly killing a task could leave project changes and misleading schedule outcomes. Diagnostics must not make model requests or print credentials.

## Decision
SIGINT/SIGTERM closes Discord interaction admission, worker admission and scheduler admission synchronously. Stop the scheduler timer, prevent dispatch after queued config gates or schedule claims, and await accepted task/interaction completion. Persist the final schedule state and close Discord even when persistence fails; a save failure sets exit status 1. Repeated signals use the same shutdown promise.

Finish active workers under their existing task timeout rather than terminating them during normal shutdown. The default zero timeout can delay shutdown indefinitely. Forced termination retains the existing interrupted-run recovery on restart and can leave partial project changes. Document this explicitly rather than silently assigning a new task deadline.

Provide a host-only `npm run doctor` command, without new Discord commands or registration. Validate the same runtime config and worker settings, check configured directories and enabled CLI versions, then invoke only status commands for Codex/Claude. Gemini credentials are checked for local indicators and reported as warnings because freshness cannot be established without provider interaction. Bound probe time/output, filter Discord credentials, use shell-free execution, and print fixed summaries rather than raw output.

## Alternatives considered
- Terminate workers immediately: needs a separate cancellation design, process-tree/partial-change guarantees and provider-specific validation.
- Apply an implicit shutdown deadline: changes tasks that currently run without a deadline and can lose work unexpectedly.
- Probe models to test authentication: incurs usage and sends data when the operator only requested setup diagnostics.
- Add diagnostics to Discord: unnecessarily exposes host operational details and changes command registration.

## Consequences
Operators must wait for graceful shutdown before starting another instance. CI can exercise mocked draining, persistence and diagnostics across platforms; real signal behavior and provider compatibility still require live smoke tests. Release metadata uses `1.0.0-beta.1` with source distribution; publication remains gated on ownership, private reporting activation, live evidence and notice review.
