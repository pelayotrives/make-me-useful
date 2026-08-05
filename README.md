# Make me useful

Make me useful is a Chrome extension for building deliberate work sessions from chained focus timers.

## What it does

- Configure one to four study blocks.
- Set every study block independently from 20 to 60 minutes in five-minute steps.
- Set every following break independently from 5 to 30 minutes in five-minute steps.
- Run the sequence as `study > break > study > break`, including a final break after the last study block.
- Block selected domains during study blocks.
- Use the Atomic Option to block every website during study blocks.
- Keep the focus lock active until the current study timer ends.
- Continue the session while the popup is closed through the extension service worker and alarms.

## Why install it

Most timers help you count down. Make me useful helps you protect the time around the countdown. You can shape a session around the work in front of you, decide which sites should stay out of reach, and let the sequence carry you from focused work into recovery without repeatedly making the decision to stop.

## Privacy

Make me useful is local-first. Session settings and timer state are stored with `chrome.storage.local`. Domain blocking is enforced locally by Chrome's declarative network request rules. The extension does not require an account, use analytics, send data to a server, or sell or share user data.

Read the full privacy policy here:

- [Privacy policy](https://pelayotrives.github.io/make-me-useful/privacy/)

## Permissions used

- `alarms`: advance timer phases while the popup is closed.
- `declarativeNetRequest`: block selected domains or all web pages during study phases.
- `storage`: persist the session configuration and timer state locally.
- `<all_urls>` host access: allow blocking rules to apply to the domains selected by the user.

## Timer sounds

The timer uses three local MP3 cues from the UI SFX Minimal pack:

- `success.mp3` when a study block ends
- `stop.mp3` when a break ends
- `complete.mp3` when the full session ends

Source: https://github.com/romainsimon/uisfx

The UI SFX audio pack is released under CC0 1.0. The files are bundled locally so playback does not depend on an external website or network access.

## License

MIT. See [LICENSE](LICENSE).
