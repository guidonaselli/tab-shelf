# Contributing

Thanks for helping out. Small, focused changes are the easiest to review.

## Setup

There is nothing to install. Load the folder as an unpacked extension (see the README) and run `npm test`.
You need Node 20 or newer.

## Before you open a pull request

- Open an issue first for anything bigger than a small fix, so we can agree on the approach.
- Keep the diff to one concern. Do not mix cleanup with a feature.
- Add or update a test when you change logic in `src/model.js` or `src/settings.js`.
- If you change something visible, try it in a real browser, in light and dark mode, and attach a screenshot.
- Strings go in `_locales/*/messages.json`. Add both the `en` and `es` keys.
- Use semantic titles: `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`.

## Reporting bugs

Say which browser and version you use, what you did, what you expected and what happened.
Console errors from `chrome://extensions` help a lot.

By contributing you agree that your work is released under the MIT license.
