# Restart Tomorrow (ADHD-Friendly, ELI5)

## Purpose

Use this when your brain feels scattered and you want to restart without re-reading everything.
This is the "no-thinking required" re-entry path.

## The Only 4 Files You Need

1. `docs/playbooks/RESTART_TOMORROW.md` (this file)
2. `docs/reference/PRESET_V2_SPEC.md` (preset model truth)
3. `docs/reference/V1_IMPLEMENTATION_TRACKER.md` (what to do)
4. `docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md` (how to stay grounded)

If you open only these 4 files, you are back on track.

If you are touching backup operations, also open:

- `docs/operations/postgres-backup-s3.md` (daily/monthly scheduler + restore drill commands)

## 10-Minute Reboot (Do in Order)

1. Run `git status --short` and do not fix everything. Just observe.
2. Open `docs/reference/PRESET_V2_SPEC.md`.
3. Open `docs/reference/V1_IMPLEMENTATION_TRACKER.md`.
4. Find the active workstream and its `Now` task.
5. Pick exactly one micro-task that can fit in 30-90 minutes.
6. Write this sentence in your notes:
   - "Today I only need to finish: ____."

## Session Modes (Choose One, No Guilt)

### Mode 1: Low energy (15-30 min)

- Read tracker for 5 minutes.
- Pick one micro-task.
- Do only one small action:
  - update a TODO checkbox,
  - write one failing test,
  - add one API/type skeleton,
  - or clean one doc section.

Success condition: one concrete improvement exists in the repo.

### Mode 2: Normal energy (60-90 min)

- Complete one micro-task end-to-end.
- Update tracker status/evidence link.
- Add one line to "next first step" before stopping.

Success condition: one shippable unit is done.

### Mode 3: High energy (2-3 hours)

- Complete one full checklist block for active workstream.
- Run relevant tests.
- Update tracker + weekly template.

Success condition: one meaningful roadmap step is closed.

## What to Work on First (Default Priority)

When in doubt, always use this order:

1. WS2A preset plumbing MVP
2. WS2B direct LLM generation (only after WS2A done)
3. WS3 TTS fallback
4. WS5 quota/cost policy
5. WS4 CRM-lite lesson ledger
6. Stabilization

This order protects architecture and avoids rewrites later.

Scope lock reminder:

- In this phase, ship `general-english` preset content only.
- Baseline prompt is `docs/templates/hw_prompt_v4-2_clean.md`.

## Anti-Spiral Rules

1. No "perfect system" work before the next concrete deliverable.
2. No jumping workstreams unless blocked.
3. If stuck for 20 minutes:
   - write a "blocker note",
   - pick a smaller slice,
   - continue.
4. If two or more readiness metrics are red, run reliability-only work next session.

## End-of-Session Rule (2 Minutes)

Before stopping, write:

- What I finished:
- First step for next session:
- Current blocker (if any):

This is mandatory. It is your bridge back in tomorrow.

## Copy-Paste Daily Log Template

```md
## Session YYYY-MM-DD

Mode: low / normal / high
Workstream: WS__
Today's one target:

Done:
- 

Evidence link:
- 

First step next session:
- 

Blocker:
- 
```

## Grounding Reminder

You are not trying to impress anyone with speed.
You are building a reliable tutor tool that saves real time and reduces chaos.
Small, consistent completions beat heroic bursts.

## Related

- `docs/reference/V1_IMPLEMENTATION_TRACKER.md`
- `docs/playbooks/WEEKLY_PRODUCT_REVIEW_TEMPLATE.md`
- `docs/reference/PRODUCT_NORTH_STAR_AND_READINESS.md`
