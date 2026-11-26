/**
 * Lightweight Node tests for bookmark validation / merge (no Chrome APIs).
 * Run: node tests/validate-data.test.js
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// bookmarks.js imports utils.js which references `chrome` only inside functions —
// validateData itself does not need chrome at import time if we avoid calling those.
// utils.js references chrome.runtime in faviconUrl/openExtensionPage/t — not at top level.
// Good.

const bookmarksUrl = pathToFileURL(join(root, 'scripts/bookmarks.js')).href;
const importExportUrl = pathToFileURL(join(root, 'scripts/import-export.js')).href;

const { validateData, normalizeData, addBookmark, addFolder } = await import(bookmarksUrl);
const { mergeImport } = await import(importExportUrl);

function sample() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    folders: [],
    rootBookmarks: []
  };
}

{
  const v = validateData(sample());
  assert.equal(v.ok, true);
}

{
  const bad = sample();
  bad.rootBookmarks.push({ id: 'b1', title: 'x', url: 'not-a-url', sortOrder: 0 });
  const v = validateData(bad);
  assert.equal(v.ok, false);
}

{
  let data = sample();
  addFolder(data, 'root', 'Work');
  addBookmark(data, 'root', { title: 'Google', url: 'https://www.google.com' });
  addBookmark(data, 'root', { title: 'Google again', url: 'https://www.google.com' });
  assert.equal(data.rootBookmarks.length, 2);
  assert.equal(data.folders.length, 1);
}

{
  const { relocateFolder, relocateBookmark } = await import(bookmarksUrl);
  let data = sample();
  const a = addFolder(data, 'root', 'A');
  const b = addFolder(data, 'root', 'B');
  relocateFolder(data, a.id, b.id, null);
  assert.equal(data.folders.length, 1);
  assert.equal(data.folders[0].id, b.id);
  assert.equal(data.folders[0].folders.length, 1);
  assert.equal(data.folders[0].folders[0].id, a.id);

  const b1 = addBookmark(data, 'root', { title: 'One', url: 'https://a.example' });
  const b2 = addBookmark(data, 'root', { title: 'Two', url: 'https://b.example' });
  relocateBookmark(data, b2.id, 'root', b1.id);
  assert.equal(data.rootBookmarks[0].id, b2.id);
  relocateBookmark(data, b2.id, b.id, null);
  assert.equal(data.rootBookmarks.length, 1);
  assert.equal(data.folders[0].bookmarks.some((x) => x.id === b2.id), true);
}

{
  const existing = sample();
  existing.rootBookmarks.push({
    id: 'bookmark_keep',
    title: 'Keep',
    url: 'https://example.com/a',
    sortOrder: 0
  });
  const incoming = sample();
  incoming.rootBookmarks.push(
    {
      id: 'bookmark_keep',
      title: 'Different',
      url: 'https://example.com/b',
      sortOrder: 0
    },
    {
      id: 'bookmark_dup_url',
      title: 'Dup',
      url: 'https://example.com/a',
      sortOrder: 1
    }
  );
  const { data, stats } = mergeImport(existing, incoming);
  // Duplicate URLs are allowed; ID conflict still remaps.
  assert.equal(data.rootBookmarks.length, 3);
  assert.equal(stats.skippedDuplicateUrl, 0);
  assert.equal(stats.addedBookmarks, 2);
  assert.ok(stats.remappedIds >= 1);
}

{
  const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, '120');
  assert.ok(manifest.permissions.includes('bookmarks'));
  assert.ok(!manifest.permissions.includes('history'));
}

console.log('All tests passed.');
