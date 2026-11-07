# Automation engine

> **Design only. Nothing in this document is implemented.** Today, side effects (system timeline entries, audit rows) happen synchronously inside the service transaction.

## Model
`TRIGGER → CONDITIONS → ACTIONS → BRANCHES → APPROVALS → COMPLETION`. A workflow is a versioned, validated graph (`workflows`, `workflow_versions`); a run is an instance (`workflow_runs`) with step records (`workflow_steps`), events (`workflow_events`) and human approvals (`workflow_approvals`). Editing creates a new version; in-flight runs finish on the version they started with.

## Reliable eventing
- **Outbox:** services write domain events (`deal.stage_changed`, `contact.created`, …) to an `outbox` table in the same transaction as the change. A relay publishes them to the queue. A failed notification or integration therefore cannot corrupt, or be lost from, the primary transaction.
- **Queue:** BullMQ on Redis (or a Postgres-backed queue first). Workers are a separate process; no workflow runs inside an HTTP request.
- **Idempotency:** each step has a deterministic idempotency key (`run_id + step_id`); external effects use provider idempotency keys. At-least-once delivery + idempotent steps ⇒ effectively-once.
- **Retries & dead letters:** exponential backoff with jitter, max attempts per step, then dead-letter with alert; nothing fails silently; operators can inspect and replay.
- **Tenant safety:** every job carries `organization_id` and executes inside `withTenant`; a test must prove a job cannot process another tenant's data.

## Triggers / actions (first set)
Triggers: record created/updated, field change, time-based (relative to a date), schedule (cron), inbound webhook. Actions: update record, create task, assign owner, notify, send approved template (respecting consent/unsubscribe), call webhook, AI action (post Phase 4, with approval gates), wait/delay, branch, request approval.

## Safety
Loop detection (a workflow cannot trigger itself indefinitely), per-org execution budgets, simulation/dry-run with a recorded sample event, approval steps executed as the approver's identity, kill switch per workflow, full execution history.

## Testing plan
Engine unit tests (branching, delays), crash-recovery tests (kill worker mid-run, resume once), idempotency under duplicate delivery, retry/dead-letter, versioning, tenant isolation of jobs, load test on queue throughput (target to be defined and measured, not assumed).
