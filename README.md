<div align="center">
  <img src="assets/icons/icon128.png" width="96" alt="MarkNest icon">
  <h1>MarkNest</h1>
  <p><strong>A Chrome extension that stores bookmarks in a local JSON file, separate from Chrome’s built-in bookmarks.</strong></p>
  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-1.0.0-0B57D0">
    <img alt="Chrome" src="https://img.shields.io/badge/Chrome-120%2B-4285F4">
    <img alt="Manifest" src="https://img.shields.io/badge/Manifest-V3-34A853">
    <img alt="License" src="https://img.shields.io/badge/license-MIT-2ea44f">
  </p>
  <p>
    <a href="https://github.com/akizono/mark-nest/releases/tag/v1.0.0">Download v1.0.0</a>
    &nbsp;·&nbsp;
    <a href="#install">Install</a>
    &nbsp;·&nbsp;
    <a href="#build--test">Build / test</a>
  </p>
</div>

## Overview

MarkNest keeps your personal bookmark tree in a `bookmarks.json` file you choose on disk. It does not sync with Chrome’s native bookmark store. An optional access password gates the popup and settings; it is access control only, not encryption.

Requires **Chrome 120+**.

## Features

- Nested folders and bookmarks, including bookmarks at the root
- Search by title, URL, and folder name
- Add the current tab from the toolbar menu, page context menu, or popup
- Import selected Chrome bookmark folders/pages into a chosen MarkNest folder
- Three storage modes: folder auto-save, single-file auto-save, or manual export
- Password set / change / disable / reset (reset does not delete bookmarks)
- Unlock policies: every popup open, until manual lock (survives browser restart), or once per browser session
- UI languages: English, Simplified Chinese, Traditional Chinese, Japanese (follows the browser language)

## Download

Prebuilt packages are published on GitHub Releases:

> [github.com/akizono/mark-nest/releases](https://github.com/akizono/mark-nest/releases)

For **v1.0.0**, download `mark-nest-1.0.0.zip`, unpack it, then load the unpacked folder in Chrome (steps below).

Source zipballs from GitHub are also fine if you prefer cloning or downloading the repository.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the unpacked `mark-nest-1.0.0` folder (or this repository root when developing)

### First run

1. Click the MarkNest toolbar icon
2. Complete setup: pick a folder, a single JSON file, or manual mode
3. Optionally set an access password

If you cancel the folder/file picker, MarkNest does not create a storage location.

## Storage modes

| Mode | Source of truth | Auto write |
| --- | --- | --- |
| Directory | `bookmarks.json` inside the chosen folder | Yes |
| File | The bound `bookmarks.json` file | Yes |
| Manual | Your exported JSON file | No — export after edits |

Rules:

- Bookmark data lives in JSON, not as the primary store in `chrome.storage.local`
- If file permission is lost, MarkNest asks you to re-authorize instead of silently switching modes
- Switching modes keeps the current in-memory tree
- Directory writes go through `bookmarks.json.tmp` → validate → `.bak` → final file

## Unlock policies

1. **Every popup open** — closing the popup locks again
2. **Until manual lock** — stays unlocked across browser restarts until you lock (toolbar menu, settings, or popup)
3. **Browser session (default)** — unlock clears when the browser exits (`chrome.storage.session`)

## JSON shape

```json
{
  "version": 1,
  "updatedAt": "2026-11-25T00:00:00.000Z",
  "folders": [
    {
      "id": "folder_…",
      "name": "Private",
      "sortOrder": 0,
      "folders": [],
      "bookmarks": [
        {
          "id": "bookmark_…",
          "title": "Example",
          "url": "https://example.com",
          "sortOrder": 0
        }
      ]
    }
  ],
  "rootBookmarks": []
}
```

Password hashes and unlock state are not written to this file.

## Permissions

`storage` · `contextMenus` · `tabs` · `activeTab` · `bookmarks`

`bookmarks` is only used to import from Chrome’s bookmark tree. Chrome does not allow extensions to add items to the bookmarks-bar context menu; use **Import Chrome bookmarks…** from the extension icon menu or Settings → Data.

Not requested: `history`, `cookies`, `webRequest`, `scripting`.

## Limitations

1. Folder/file handles from the File System Access API can expire; re-authorize with a user gesture when prompted
2. Prefer setup and storage changes in the options/setup pages rather than the short-lived popup
3. In manual mode, edits stay in a working buffer until you export
4. Anyone who can open Settings can reset the password — this is not a vault
5. Favicons use a public icon service; failures fall back to the extension icon
6. Chrome 120 or newer

## Build / test

No bundler. The repository root is the extension root.

```bash
node tests/validate-data.test.js
```

Covers JSON validation, folder/bookmark mutations, merge import (duplicate URLs allowed; conflicting IDs remapped), and basic manifest checks.

### Package a release zip

From the repository root (PowerShell):

```powershell
$version = (Get-Content .\manifest.json -Raw | ConvertFrom-Json).version
$out = Join-Path $env:TEMP "mark-nest-$version"
Remove-Item $out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $out | Out-Null
Copy-Item -Recurse `
  manifest.json,background,popup,options,pages,scripts,assets,_locales,LICENSE,README.md `
  $out
Compress-Archive -Path (Join-Path $out '*') -DestinationPath ".\mark-nest-$version.zip" -Force
```

Upload `mark-nest-<version>.zip` as the Release asset. Do not commit the zip.

## Architecture

- **Bookmarks:** `scripts/bookmarks.js` + `scripts/file-manager.js` (JSON on disk)
- **Handles:** IndexedDB
- **Config / password hash / until-manual unlock:** `chrome.storage.local`
- **Session unlock:** `chrome.storage.session`
- **UI:** vanilla ES modules (popup, options, setup, add-bookmark, import-chrome)

```text
mark-nest/
├── manifest.json
├── background/          service worker (menus, startup unlock)
├── popup/
├── options/
├── pages/               setup, add-bookmark, import-chrome
├── scripts/             auth, storage, bookmarks, import
├── assets/
├── _locales/            en / zh_CN / zh_TW / ja
└── tests/
```

## Contributing

Issues and pull requests are welcome. For larger behavior changes, open an issue first.

When contributing:

- Keep `_locales/en`, `zh_CN`, `zh_TW`, and `ja` in sync when adding UI strings
- Run `node tests/validate-data.test.js` before opening a PR
- Do not commit generated zips, credentials, or local storage dumps

## License

MIT. See [LICENSE](LICENSE).
