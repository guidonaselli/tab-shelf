# Security

Please report vulnerabilities privately with the **Report a vulnerability** button on the repository's
Security tab instead of opening a public issue. I will reply as soon as I can.

Only the latest commit on `main` is supported.

For context: the extension requests `tabs`, `sidePanel`, `storage`, `scripting` and access to `http(s)` pages
so it can draw the edge panel. It sends no requests of its own and stores data only in `chrome.storage.local`. The only network traffic is the favicon
images of your tabs, which the browser loads from the sites themselves.
