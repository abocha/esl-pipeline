---
'@esl-pipeline/batch-backend': minor
'@esl-pipeline/orchestrator': minor
'@esl-pipeline/contracts': patch
---

Implement actionable rerun/cancel job controls across orchestrator and batch backend.

- Add orchestrator rerun CLI ergonomics (`--audio`, `--voice-id`) and fix rerun flag forwarding.
- Implement backend `rerun_audio` queue path end-to-end.
- Implement backend `cancel` action (queued removal + running best-effort cancellation semantics).
- Update job action metadata/docs to reflect implemented capabilities.
