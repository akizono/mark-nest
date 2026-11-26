<div align="center">
  <img src="assets/icons/icon128.png" width="96" alt="MarkNest icon">
  <h1>MarkNest</h1>
  <p>Your Personal Bookmark Space</p>
  <p><strong>A Chrome MV3 extension for a private bookmark tree stored in a local JSON file, independent of Chrome bookmarks.</strong></p>
  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-1.0.0-0B57D0">
    <img alt="Chrome" src="https://img.shields.io/badge/Chrome-120%2B-4285F4">
    <img alt="Manifest" src="https://img.shields.io/badge/Manifest-V3-34A853">
    <img alt="License" src="https://img.shields.io/badge/license-MIT-2ea44f">
  </p>
  <p>
    <a href="https://github.com/akizono/mark-nest/releases">Download</a>
    &nbsp;·&nbsp;
    <a href="#build-from-source">Build from source</a>
    &nbsp;·&nbsp;
    <a href="README.zh-CN.md">简体中文</a>
  </p>
</div>

## Overview

MarkNest is a personal bookmark manager independent of Chrome's bookmark system. Bookmarks live in a `bookmarks.json` file on disk (for example under a folder you pick). The file can be opened in File Explorer and is not tied to the extension process lifetime.

It is meant for access control on a shared computer: prevent family members or children from casually opening private sites. An optional password locks the popup and settings.

Runs locally with no server or account. Requires Chrome 120+.

## Features

- Nested folders and root-level bookmarks
- Search by title, URL, and folder name
- Add the current tab from the toolbar menu, page context menu, or popup
- Optional import of selected Chrome folders/pages into a MarkNest folder
- Storage modes: directory auto-save, single-file auto-save, or manual export
- Password set / change / disable / reset (reset does not delete bookmarks)
- Unlock policies: every popup open, until manual lock (survives browser restart), or once per browser session
- UI in English, Simplified Chinese, Traditional Chinese, and Japanese (browser language)

## Download

Release zips are on GitHub Releases:

> [github.com/akizono/mark-nest/releases](https://github.com/akizono/mark-nest/releases)

For **v1.0.0**, download `mark-nest-1.0.0.zip` and unpack it.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. Click **Load unpacked**
4. Select the unpacked `mark-nest-1.0.0` folder

On first run, click the MarkNest toolbar icon and finish setup: choose a folder, a single JSON file, or manual export mode, then optionally set a password. Canceling the folder/file picker does not create a storage location.

Loading this repository root works the same way when developing.

## Configuration

`bookmarks.json` is the only source of truth for bookmark data. Password hashes and unlock state are stored separately and are never written into that file.

| Mode | Source of truth | Auto write |
| --- | --- | --- |
| Directory | `bookmarks.json` in the chosen folder | Yes |
| File | The bound `bookmarks.json` | Yes |
| Manual | Your exported JSON | No — export after edits |

Directory writes use a temp file, validation, and a `.bak` backup before replacing the live file. If the JSON is corrupt, MarkNest reports the error and does not overwrite the damaged file.

Unlock policies:

| Policy | Behavior |
| --- | --- |
| Every popup open | Closing the popup locks again |
| Until manual lock | Stays unlocked across browser restarts until you lock |
| Browser session (default) | Cleared when the browser exits (`chrome.storage.session`) |

Example shape:

```json
{
  "version": 1,
  "updatedAt": "2026-11-25T00:00:00.000Z",
  "folders": [
    {
      "id": "folder_001",
      "name": "Private",
      "sortOrder": 0,
      "folders": [],
      "bookmarks": [
        {
          "id": "bookmark_001",
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

Permissions: `storage`, `contextMenus`, `tabs`, `activeTab`, `bookmarks`.  
`bookmarks` is used only for the optional Chrome → MarkNest import. MarkNest does not use Chrome bookmarks as its data store. Chrome also does not allow adding items to the bookmarks-bar context menu; use **Import Chrome bookmarks…** on the extension icon menu or Settings → Data.

## Limitations

- File System Access handles can expire after a browser restart; re-authorize when prompted
- Prefer setup and storage changes in the options/setup pages; the popup is short-lived
- Manual mode keeps edits in a working buffer until you export
- Favicons use a public icon service; failures fall back to the extension icon
- Restricted URLs such as `chrome://` cannot be bookmarked

## Build from source

No bundler. The repository root is the extension root.

Requirements: Node.js (for the test script), Chrome 120+.

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
  manifest.json,background,popup,options,pages,scripts,assets,_locales,LICENSE,README.md,README.zh-CN.md `
  $out
Compress-Archive -Path (Join-Path $out '*') -DestinationPath ".\mark-nest-$version.zip" -Force
```

Upload `mark-nest-<version>.zip` to the Release. Do not commit the zip.

## Architecture

- Entry: `background/service-worker.js` (menus, startup unlock), `popup/`, `options/`, `pages/`
- Bookmark tree: `scripts/bookmarks.js`; disk I/O: `scripts/file-manager.js`
- File/directory handles: IndexedDB
- Config, password hash, until-manual unlock: `chrome.storage.local`
- Session unlock: `chrome.storage.session`
- UI: vanilla ES modules (no React/Vue)

```text
mark-nest/
├── manifest.json
├── background/
├── popup/
├── options/
├── pages/          setup, add-bookmark, import-chrome
├── scripts/        auth, storage, bookmarks, import
├── assets/
├── _locales/       en, zh_CN, zh_TW, ja
└── tests/
```

## Contributing

Open an issue before large behavior changes.

- Keep `_locales/en`, `zh_CN`, `zh_TW`, and `ja` in sync for UI strings
- Run `node tests/validate-data.test.js` before a PR
- Do not commit generated zips, credentials, or local storage dumps

## License

MIT. See [LICENSE](LICENSE).
