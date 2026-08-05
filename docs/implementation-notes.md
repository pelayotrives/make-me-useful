# Implementation Notes

This document captures the non-obvious behaviour and local switches used in `make-me-useful`.

## Production/Test Switches

- `popup/popup.js`
  The flag `ENABLE_TEST_CONTROLS` controls whether the `TEST` button is visible and wired up.
- Production value:
  `const ENABLE_TEST_CONTROLS = false;`
- To re-enable quick testing:
  change it to `true`, reload the extension in `chrome://extensions`, and reopen the popup.

## Duration Options

- Study durations are production-only values from 20 to 60 minutes in 5-minute steps.
- Break durations are production-only values from 5 to 30 minutes in 5-minute steps.
- The old `1 sec` options were removed for production readiness.

## Guardrails Modes

- The popup supports exactly one domain strategy at a time:
  `Block list` or `Allow list`.
- Switching mode clears the inactive field on purpose so stale values do not silently persist.
- Domain input accepts comma-separated values and also tolerates newline-separated values.

## Superban

- `Superban` is the production name for the old atomic full-web lock.
- During study blocks, it blocks all HTTP/HTTPS destinations.

## Reset Behaviour

- The `Reset` button behaves differently depending on session state.
- When no session is running:
  `Reset` acts immediately.
- When a session is running:
  `Reset` must be held for 45 seconds.
- The button fill is the progress indicator; the helper text under the action row explains the hold requirement.

## Blocked Tabs Behaviour

- On session start, the active tab is checked immediately and blocked if needed.
- Other already-open tabs are not force-blocked in bulk.
- If those tabs later become active, or if the active blocked tab reloads/navigates during a study block, they are checked and blocked then.
- During break phases, blocking rules are removed.
- When the timer automatically returns from a break to the next study block, blocking rules are applied again and the current active tab is checked immediately.

## Blocked Page

- The blocked screen lives in `blocked/index.html`.
- It intentionally uses the same monospace font direction as the popup.
- The previously shown URL box was removed to keep the page cleaner.
- It now reads live extension state and shows the active study block number plus the remaining time at the top when a study block is running.

## Reload Requirements

- After changing `manifest.json` or `service-worker.js`, Chrome requires an extension reload in `chrome://extensions`.
- After changing popup HTML/CSS/JS, it is often enough to close and reopen the popup, but a full extension reload is safer if behaviour looks stale.
