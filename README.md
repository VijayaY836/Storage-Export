# Storage Explorer

A browser extension that lets you explore and manage a website's client-side
storage — `localStorage`, `sessionStorage`, and cookies — from one popup.

Demo Video : https://drive.google.com/file/d/1M3cYMXQX_9sCfwTh7GUDSLXbRwUVjYcj/view?usp=sharing

For every stored item it shows:
- **Key**
- **Value**
- **Storage type** (Local / Session / Cookie)
- **Approximate size** (bytes, computed from the UTF-8 byte length of key + value)

You can search across all entries, filter by storage type, delete individual
items, or clear everything currently in view.

## Features

- Reads `localStorage` and `sessionStorage` for the active tab via
  `chrome.scripting.executeScript` (Manifest V3 — content scripts can't read
  page storage directly, so the popup injects a small extraction function).
- Reads cookies for the active tab's URL via `chrome.cookies.getAll`.
- Live search across keys and values, with match highlighting.
- Tabs to filter by storage type, with live counts.
- Per-item delete, and a "Clear all in view" action that respects the active
  tab + search filter.
- Total item count and total size shown in the footer.
- Dark, devtools-inspired UI.

## Project structure

```
storage-explorer/
├── manifest.json     Manifest V3 config, permissions
├── popup.html         Popup markup
├── popup.css          Popup styling
├── popup.js           All popup logic (data loading, render, search, delete)
└── icons/             Extension icons (16/32/48/128)
```

## Install (load unpacked)

1. Open `chrome://extensions` (or `edge://extensions` for Edge, or
   `about:debugging#/runtime/this-firefox` for Firefox — see note below).
2. Enable **Developer mode** (top-right toggle, Chrome/Edge).
3. Click **Load unpacked** and select the `storage-explorer` folder.
4. Pin the extension, navigate to any `http(s)://` site, and click the
   Storage Explorer icon.

> **Firefox note:** Firefox uses `browser.*` namespacing and a slightly
> different manifest key set for MV3. This build targets Chromium-based
> browsers (Chrome, Edge, Brave, Arc) out of the box.

## Permissions used

| Permission | Why |
|---|---|
| `activeTab` | Know which tab's storage to read |
| `scripting` | Inject a read/remove function into the page to access `localStorage`/`sessionStorage` |
| `cookies` | Read and remove cookies for the active tab's URL |
| `host_permissions: <all_urls>` | Required so `cookies` and `scripting` work on any site you visit |

The extension never sends data anywhere — everything happens locally in the
popup and the current tab.

## Why `chrome.scripting.executeScript` instead of a content script?

`localStorage`/`sessionStorage` live in the page's own JS context. A
Manifest V3 popup has no direct access to another tab's storage, so on each
refresh the popup injects a small function into the active tab, reads the
data, and returns it via the executeScript result — no persistent content
script needed, and nothing runs on pages you haven't opened the popup on.

## Demo video

See the linked video for a walkthrough of:
1. Opening a site with existing storage data
2. Viewing localStorage / sessionStorage / cookies in the popup
3. Searching for a specific key/value
4. Deleting an individual entry
5. Clearing all entries in the current filtered view

## License

MIT — do whatever you like with this.
