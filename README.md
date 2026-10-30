# Tab Shelf

[Español](README.es.md)

One tab list for every browser window. Tab Shelf is a Manifest V3 extension for Chromium-based browsers
(built and tested on [Helium](https://github.com/imputnet/helium)) that brings the shared-tabs feel of
Zen Browser to them: see every tab from every window in one place, jump to any of them, and pull one into
the window you are working in.

## Features

- **Tabs from all windows** in one panel, ordered by window position, so multi-monitor setups read left to right.
- **Edge panel.** Hover the left or right edge of any web page and the panel slides over it. It closes when
  the mouse leaves, on `Esc`, or when you click outside. Pick the side, width, opacity and accent color, or turn it off, in the settings.
- **Click to bring here.** Clicking a tab from another window moves it to the window you are in and activates it.
- **Shared pins.** Pin a page once and it is available everywhere. Clicking a pin focuses the open tab or opens a new one.
- **Move and reorder.** Drag tabs between windows, use the move selector on each row, or press `Alt+↑` / `Alt+↓` to reorder.
- **Search**, light and dark themes, English and Spanish UI.
- Also works as a regular side panel (click the toolbar icon).

## Install

Tab Shelf is not on the Chrome Web Store yet. To load it:

1. Clone or download this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the repository folder.

The extension ID is fixed by the `key` in `manifest.json`, so your pins survive moving the folder.

## Good to know

- The edge panel is injected into `http(s)` pages only. It does not appear on `chrome://` pages, the new tab
  page or the web store; the side panel still works there.
- The trigger zone is 32 px wide and detected from the mouse position, so page elements cannot cover it.
  It does not fire while a mouse button is held (dragging, using a scrollbar).
- If your browser has vertical tabs on the left, the screen edge there is the tab strip, not the page.
  Choose the right side in that case.
- The content script asks for access to all `http(s)` pages. It only draws the panel and reads nothing from the page.
- Pins and settings live in `chrome.storage.local`. Nothing leaves your machine.

## Development

No build step and no dependencies.

```sh
npm test    # node --test
```

Pure logic (URL matching, pins, view building) lives in `src/model.js` and is unit tested. The UI is plain
HTML, CSS and JS. Design notes and the history of the project are kept in [`lmd/`](lmd/).

To add a language, copy `_locales/en/messages.json` to `_locales/<code>/messages.json` and translate the values.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
