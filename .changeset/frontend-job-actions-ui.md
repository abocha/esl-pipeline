---
'@esl-pipeline/batch-frontend': minor
---

Add minimal UI controls for job actions in the assignment console.

- Expose `rerun_audio` controls (default and advanced payload options).
- Expose `cancel` action controls with optional reason for active jobs.
- Gate action controls by backend `supportedActions` capability metadata.
