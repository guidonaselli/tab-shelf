# Tab Shelf

[Español](README.es.md)

One tab list for every browser window. Tab Shelf is a Manifest V3 extension for Chromium-based browsers
(built and tested on [Helium](https://github.com/imputnet/helium)) that shows tabs from every window in a
single, globally ordered list.

## Features

- **One global tab order** across all windows. Drag tabs or press `Alt+↑` / `Alt+↓` to reorder them across the full list. The order is rebuilt when the browser restarts or the extension reloads.
- **Edge panel.** Hover the left or right edge of any web page and the panel slides over it. It closes when
  the mouse leaves, on `Esc`, or when you click outside. In the settings (the sliders button next to the search box)
  you pick the side, width, opacity and panel background color, the size of the trigger zone and how fast it opens and closes,
  or turn it off. You can also turn it off for single sites, for example games or web apps that use the page edge.
- **Click to bring here.** Clicking a row from another window moves that real browser tab to the current window and
  activates it. `Shift`+click focuses its source window, including for pins. If it was the last tab, Tab Shelf creates
  an auxiliary tab with the panel to keep that window open. Use the explicit move controls to move tabs between windows.
- **Close and mute.** Close a tab with its `x` button, a middle click or `Delete`. Tabs that play sound show a speaker
  button to mute them.
- **Keyboard.** `Alt+Shift+S` shows or hides the edge panel and puts you in the search box (it falls back to the
  side panel on pages where the edge panel cannot run). Change it at `chrome://extensions/shortcuts`.
  In the search box, `Enter` opens the first result and `↓` moves into the list; `↑` and `↓` walk the rows.
- **Shared pins.** A pin remembers its tab during the session, even as you navigate. Closing the tab keeps the pin, which reopens its saved address. After a browser or extension restart, the tab association is restored by URL and may be lost if the tab navigated.
- **Move tabs between windows** with the explicit move controls on each row.
- **Duplicates.** Tabs with the same address are dimmed and one button closes the extras, keeping the active tab and pinned tabs.
- **Shared pins.** Pins and settings are retained across browser restarts and extension reloads. Pins can be reordered by dragging or, while focused, with `Alt+←` / `Alt+→`; a JSON **backup** (export/import of pins and settings) is in the settings. Density can be compact.
- **Search**, light and dark themes, English and Spanish UI.
- Also works as a regular side panel (click the toolbar icon).
- The active tab's URL appears at the top of the panel and can be copied with its button. Panel continuity follows the active tab on `http(s)` pages.

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
