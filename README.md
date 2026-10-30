# Tab Shelf

[Español](README.es.md)

One tab list for every browser window. Tab Shelf is a Manifest V3 extension for Chromium-based browsers
(built and tested on [Helium](https://github.com/imputnet/helium)) that brings the shared-tabs feel of
Zen Browser to them: see every tab from every window in one place, jump to any of them, and pull one into
the window you are working in.

## Features

- **Tabs from all windows** in one panel, ordered by window position, so multi-monitor setups read left to right.
- **Edge panel.** Hover the left or right edge of any web page and the panel slides over it. It closes when
  the mouse leaves, on `Esc`, or when you click outside. In the settings (the sliders button next to the search box)
  you pick the side, width, opacity and accent color, the size of the trigger zone and how fast it opens and closes,
  or turn it off. You can also turn it off for single sites, for example games or web apps that use the page edge.
- **Click to bring here.** Clicking a tab from another window moves it to the window you are in and activates it.
  `Shift`+click jumps to that tab's own window instead. If it is the only tab of its window, the click always jumps,
  so the window is not closed behind your back.
- **Close and mute.** Close a tab with its `x` button, a middle click or `Delete`. Tabs that play sound show a speaker
  button to mute them.
- **Keyboard.** `Alt+Shift+S` shows or hides the edge panel and puts you in the search box (it falls back to the
  side panel on pages where the edge panel cannot run). Change it at `chrome://extensions/shortcuts`.
  In the search box, `Enter` opens the first result and `↓` moves into the list; `↑` and `↓` walk the rows.
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
- The trigger zone is detected from the mouse position, so ordinary page elements cannot cover it. A cross-origin
  iframe that reaches the screen edge can, because the page never sees the mouse over it.
  The zone does not fire while a mouse button is held, nor in full screen or while the page captures the pointer.
- To bring back a site you disabled, open the side panel (toolbar icon) on that site and use the settings.
- Incognito windows are not supported; the extension cannot be enabled there.
- Needs Chrome 123 or newer.
- If your browser has vertical tabs on the left, the screen edge there is the tab strip, not the page.
  Choose the right side in that case.
- The content script asks for access to all `http(s)` pages. It only draws the panel and reads nothing from the page.
- Pins and settings live in `chrome.storage.local` and never leave your machine. The extension sends no requests of its own;
  the only network traffic is the favicon images of your tabs, which the browser loads from the sites themselves.

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
