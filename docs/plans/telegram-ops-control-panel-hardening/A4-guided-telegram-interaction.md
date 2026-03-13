# `A4` Guided Telegram Interaction

## Summary

`A4` is the guided-interaction phase for the internal Telegram ops bot.

This phase keeps slash commands as the canonical bot API, but adds:

- inline-keyboard navigation in the configured ops chat
- callback-query handling with immediate acknowledgement
- edit-in-place guided views for common read flows
- confirm-first guided entry points for `Backup` and `Drill`
- recent-ops browsing via a new read-only backend list endpoint

`A4` is intentionally narrow:

- private chat remains onboarding-only
- no deep links
- no Mini Apps
- no localization
- no approval-model changes

## Delivered Behavior

Guided control surface:

- `/help` in the configured ops chat now opens a guided control panel.
- The help panel includes capability-aware inline buttons:
  - `Status`
  - `Finished Jobs`
  - `Recent Operations`
  - `Backup` / `Drill` only when action commands are enabled

Guided read flows:

- `Status` loads the current ops summary in place.
- `Finished Jobs` loads recent succeeded jobs in place, with first-page job buttons.
- `Recent Operations` loads recent ops actions in place from `GET /ops/actions`.
- Job detail and operation detail views support `Refresh`, `Back`, and `Home`.
- Job detail exposes `Links` and `Share`, which reuse the existing multi-message share-card behavior.

Guided action flows:

- `Backup` and `Drill` are confirm-first.
- Guided backup runs the unlabeled backup only.
- Custom labels remain typed-command only via `/backup <label>`.
- In webhook mode, guided action confirmation still generates the existing `/approve <token>` flow.

Transport and degradation behavior:

- Polling now requests `message` and `callback_query` updates.
- Callback queries are answered immediately before rendering.
- Guided views edit the existing message when possible.
- If the source message can no longer be edited, the bot sends a replacement message in the same thread instead of failing silently.

## Interfaces Added

Backend/API:

- `GET /ops/actions?limit=<n>&offset=<n>`
- `OpsActionListResponse`

Bot runtime:

- Telegram callback-query handling
- `answerCallbackQuery`
- `editMessageText`
- inline keyboard send/edit support
- backend client method `listOpsActions(limit, offset?)`

No new environment variables are required for `A4`.

## Follow-On Reservation

`A5` is reserved for later UX expansion, including deep-link entry points only if there is a real launch source or a stronger product need than the current internal ops scope shows.
