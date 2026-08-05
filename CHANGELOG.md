# Changelog

All notable changes to Make me useful are documented in this file.

## [Unreleased]

### Added

- Added a `Block list` / `Allow list` guardrails mode switch so only one domain strategy is active at a time.
- Added comma-separated domain entry support for both blocked and allowed domains.
- Added active-tab enforcement for blocked domains when a study block starts.
- Added tab activation and active-tab reload enforcement so blocked tabs are intercepted when they become active during study.
- Added a local blocked-domain page in `blocked/index.html`.
- Added a long-press reset interaction on the main `Reset` button with visual progress feedback.
- Added a local `ENABLE_TEST_CONTROLS` flag to hide or restore the `TEST` button without removing code.
- Added a maintenance note document describing production/test switches and special UI behaviour.

### Changed

- Renamed `Atomic option` to `Superban`.
- Reworked the popup layout to start directly at the timer card, removing the previous top branding header and ready badge.
- Reworked guardrails copy, placeholders, and field behaviour so examples look like examples instead of prefilled content.
- Switched popup and blocked-page typography to a monospace/code-style font stack.
- Reworked the reset flow from immediate reset to hold-to-reset, increasing the hold time to 45 seconds for production.
- Changed the reset helper copy to live under the main action buttons instead of using a separate reset section.
- Reworked the blocked page spacing and removed the previous empty URL skeleton element.
- Adjusted select styling, spacing, and native-chevron positioning treatment across the popup.
- Updated the popup visual language to use softer red borders instead of hard black outlines.

### Fixed

- Fixed the `X Blocks` preview label so it updates immediately when changing the number of study blocks.
- Fixed guardrail mode switching so stale domains are cleared when changing between block list and allow list.
- Fixed the reset button so it remains usable through the hold interaction without trapping the user in a locked state.
- Fixed reset-button text contrast while the hold progress fills from left to right.
- Fixed blocked-tab behaviour so the active tab is immediately checked at session start and previously opened tabs are checked when focused or reloaded.

## [0.0.1]

### Added

- First MV3 release of Make me useful as a chained focus timer.
- Configurable sessions with one to four study blocks.
- Individual study durations from 20 to 60 minutes in five-minute steps.
- Individual break durations from 5 to 30 minutes in five-minute steps.
- Automatic `study > break` sequencing with a break after every study block, including the final block.
- Local session persistence through `chrome.storage.local`.
- Background phase progression through `chrome.alarms`, including when the popup is closed.
- Domain guardrails for a user-defined list of domains and subdomains.
- Atomic Option for blocking every website during study phases.
- Dynamic declarative network request rules that clear during breaks and after the session completes.
- A compact timer interface showing phase, round, remaining time, progress, and lock status.
- Local privacy policy, README documentation, MV3 manifest, and MIT license.

### Changed

- Replaced the inherited Buttonizer scanning and archive boilerplate with the Make me useful timer architecture.
- Reworked the file structure around `popup/` and the root `service-worker.js`.
- Updated the product name, description, documentation, privacy content, and release notes.
- Applied the Make me useful palette: `#1e1e24`, `#92140c`, and `#fff8f0`.

### Fixed

- Removed Buttonizer-specific terminology and unused scanner, preview, and archive modules from the new extension flow.
