# Changelog

## Unreleased

- Settings moved to their own view (sliders button next to the search box); new options for the trigger zone size and the open/close speed.
- Turn the edge panel off per site; the panel also stays out of the way in full screen and while the page captures the pointer.
- Close tabs from the panel (`x` button, middle click, `Delete`) and mute tabs that play sound.
- `Shift`+click jumps to a tab's window instead of bringing it; clicking the only tab of another window now jumps instead of closing that window.
- `Alt+Shift+S` toggles the edge panel and focuses the search; `Enter` and arrow keys work in the list.
- Hovering the edge no longer takes keyboard focus from the page.
- The panel closes when search is cleared with the mouse already outside; the panel no longer reinjects on browser updates.
- Requires Chrome 123 (`light-dark()`); disabled in incognito; settings logic shared between the content script and the panel.
- Settings: panel width (narrow to extra wide), opacity (50–100%) and accent color for the edge panel.

## 0.2.0

- Edge panel on the left or right of any page, opened by hovering the edge.
- Clicking a tab from another window brings it to the current one.
- Restyled to match Helium; new transparent icon.
- The panel is injected into already open tabs when the extension is installed or reloaded.
- Fixed: the panel did not close when the mouse left it.
- Fixed: settings failed to load on pages with a strict origin policy (YouTube).

## 0.1.0

- Side panel with tabs from all windows, shared pins, search, drag and drop, English and Spanish.
