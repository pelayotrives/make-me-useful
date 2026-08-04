# Changelog

All notable changes to Make me useful are documented in this file.

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
