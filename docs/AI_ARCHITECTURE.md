# AI architecture

> **Design only. No AI feature exists in this build.** There is no provider integration, no model call, and no AI output anywhere in the product. The only "intelligence" today is the deterministic, explainable lead score (ADR-010).

## Principles
- AI is an *actor with a restricted identity*, not a privileged backdoor. It runs through the same services, `AuthContext`, tenant transaction, RLS and audit as a human.
- The LLM never touches the database or a connection string. It can only call **tools**; each tool is a typed wrapper around an existing service method.
- Retrieved content (emails, tickets, web pages, customer messages, documents) is untrusted data, never instructions.

## Components (planned)
1. **AI gateway** — provider-independent interface (`generate`, `stream`, `embed`) with configurable providers/models, retries, fallbacks, timeouts, per-org rate limits, budgets, usage + cost tracking (`ai_usage`), and request tracing (`ai_traces`). Business code depends only on this interface.
2. **Tool registry** — name, zod input schema, required permission, risk class (read / write / sensitive), side-effect description, idempotency key. Tools are allow-listed per agent.
3. **Agent runtime** — bounded loop (max steps, tokens, wall time), organization context, stop/revoke ("kill switch"), full trace persisted.
4. **Approval service** — `ai_action_approvals`: proposed action + diff + sources, approve/reject by a user who is themselves authorized for that action.
5. **Retrieval** — permission-aware: candidate documents are filtered by the *requesting user's* access (query-time ACL filter, not index-time trust); citations with source ids; pgvector when justified.

## Permission ladder per agent/tool
`OBSERVE → RECOMMEND → PREPARE → APPROVAL REQUIRED → BOUNDED AUTONOMY`
An agent starts at OBSERVE. Promotion is an explicit admin setting per tool, bounded by the intersection of the *agent's* grants and the *initiating user's* permissions. Autonomy is limited by counts/amounts/time windows and always auditable and revocable.

## Prompt-injection defence (required before launch)
Separate system instructions from untrusted content with explicit delimiters and role separation; strip or neutralise instruction-like content in tool results; never allow untrusted content to choose tools or parameters unseen; require approval for any write derived from untrusted input; output validation against tool schemas; per-tool allow-lists; red-team test suite in CI (e.g. an email that says "delete all deals").

## Output honesty
Predictions show uncertainty and supporting data; AI text is labelled; "verified" (from authorized sources, cited) is distinguished from "uncertain"; escalation to a human when confidence is low. Estimates are never presented as facts.

## Testing plan
Tool-authorization matrix tests (agent cannot exceed its grants or the user's), tenant isolation in retrieval, injection corpus, cost-limit enforcement, kill-switch test, trace completeness.

## Prerequisites
Provider account/keys (not available now), the Phase 3 job + event + approval infrastructure, and the notification centre.
