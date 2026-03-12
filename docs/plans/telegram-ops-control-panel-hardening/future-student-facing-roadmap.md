# Telegram Bot Future Student-Facing Roadmap (Draft)

## Context

This roadmap captures founder intent from **March 11, 2026** for extending the Telegram bot beyond internal ops-control use.

Current confidence:

- Confirmed: rich student-facing messaging and Telegram-to-website account association.
- Uncertain: direct student conversation mode.

Recent `A2` baseline now in place (2026-03-11):

1. `/links` + `/share` emit student-forwardable cards.
2. Assignment card is a single clickable link with full title (and icon when available).
3. Audio cards are split into separate Telegram messages so each can render its own playable preview.
4. Bot can recover title/icon/audio links from published HTML when job markdown payload is path-only.

Locked naming in this roadmap:

1. `A` = Ops Control Bot
2. `B` = Teacher Workflow Bot
3. `C` = Student Self-Service Bot
4. `0/1/2` = discovery / V1 usable / hardening-scale

## B1 Candidate (Post-Ops Stabilization)

### Scope

1. Teacher-side student messaging through Telegram with rich formatting.
2. Telegram account linking to website account (identity association).
3. Linked-account student list in Telegram.
4. Quick actions per student in Telegram.
5. Payment history summary in Telegram.
6. Lesson schedule summary in Telegram.

### Acceptance Criteria

1. A linked teacher can execute a deterministic account-link flow and see “linked” status in Telegram.
2. A linked teacher can list only their own students (no cross-account visibility).
3. Teacher can send at least 3 templated rich messages to a student (reminder, homework follow-up, payment/balance notice).
4. Payment-history and schedule summaries render with stable formatting and clear timestamps.
5. Every teacher-initiated student action is audit-logged with actor, student, action type, and timestamp.

## B2 Candidate (Expansion After B1 Usage Feedback)

Roadmap label: `B2`

### Scope

1. Broader quick-action set for teachers (beyond baseline reminder/history/schedule).
2. Deeper student timeline cards in Telegram (recent lessons, recent payments, action history).
3. Better delivery/engagement telemetry for outbound student messages.

### Acceptance Criteria

1. At least 5 production-safe teacher quick actions are available and permission-checked.
2. Timeline cards show coherent, ordered events with no duplicate or contradictory status values.
3. Message delivery outcomes (sent/failed) are visible in a teacher-facing status view.
4. Alerting exists for repeated message-delivery failures.

## Needs Product Validation (Do Not Commit Yet)

Roadmap label: `C0`

### Candidate Scope

1. Direct bot conversations with students.
2. Student self-service commands (balance, lessons remaining, schedule status, basic account-learning checks).

### Validation Questions

1. Should student chat be read-only informational first, or allow state-changing actions?
2. What identity proof is required before returning student-specific data in chat?
3. Which student actions are safe without human approval?
4. What escalation path is required when bot responses are ambiguous or sensitive?

### Go/No-Go Exit Criteria

1. Product decision memo approved for student-bot scope and safety boundaries.
2. Privacy and support-risk review completed.
3. Explicit allowlist of student commands and blocked intents documented.
4. Rollback plan defined (feature flag + immediate disable path).

## Suggested Delivery Order

1. Complete `A2` ops-control hardening and production runbook maturity.
2. Ship `B1` teacher-side linking + student views + rich messaging.
3. Collect usage feedback and support incidents for 2-4 weeks.
4. Promote selected `B2` items.
5. Re-evaluate `C0` student direct-conversation go/no-go.

## Immediate Next Backlog (Post-`A2` Foundation)

Roadmap label: `B1-prep`

1. Add teacher-selectable student target in Telegram and emit `/share` cards directly to that student thread/chat.
2. Add templated “share with note” variants (homework push + brief teacher note) with strict audit logging.
3. Add backend DTO support for canonical assignment title/icon/audio fields to remove HTML parsing dependency.
4. Add delivery metrics for share cards (sent/failed/open proxy) and alerting on repeated send failures.
