/**
 * Merge import / validation helpers.
 */

import { generateId, isValidHttpUrl, nowIso } from './utils.js';
import { findFolder, normalizeData, validateData } from './bookmarks.js';

function remapIds(data) {
  const idMap = new Map();
  const nextId = (oldId, prefix) => {
    const nid = generateId(prefix);
    if (oldId) idMap.set(oldId, nid);
    return nid;
  };

  const mapFolder = (folder) => ({
    id: nextId(folder.id, 'folder'),
    name: folder.name,
    sortOrder: folder.sortOrder ?? 0,
    folders: (folder.folders || []).map(mapFolder),
    bookmarks: (folder.bookmarks || []).map((b) => ({
      id: nextId(b.id, 'bookmark'),
      title: b.title,
      url: b.url,
      sortOrder: b.sortOrder ?? 0
    }))
  });

  return {
    version: 1,
    updatedAt: nowIso(),
    folders: (data.folders || []).map(mapFolder),
    rootBookmarks: (data.rootBookmarks || []).map((b) => ({
      id: nextId(b.id, 'bookmark'),
      title: b.title,
      url: b.url,
      sortOrder: b.sortOrder ?? 0
    })),
    idMap
  };
}

function collectIds(data) {
  const ids = new Set();
  const walk = (folders) => {
    for (const f of folders || []) {
      ids.add(f.id);
      (f.bookmarks || []).forEach((b) => ids.add(b.id));
      walk(f.folders || []);
    }
  };
  walk(data.folders);
  (data.rootBookmarks || []).forEach((b) => ids.add(b.id));
  return ids;
}

function cloneFolderWithIdFix(folder, existingIds, stats) {
  let id = folder.id;
  if (!id || existingIds.has(id)) {
    id = generateId('folder');
    stats.remappedIds += 1;
  }
  existingIds.add(id);

  const bookmarks = [];
  for (const b of folder.bookmarks || []) {
    if (!isValidHttpUrl(b.url)) {
      stats.skippedInvalidUrl += 1;
      continue;
    }
    let bid = b.id;
    if (!bid || existingIds.has(bid)) {
      bid = generateId('bookmark');
      stats.remappedIds += 1;
    }
    existingIds.add(bid);
    bookmarks.push({
      id: bid,
      title: b.title || b.url,
      url: b.url,
      sortOrder: b.sortOrder ?? bookmarks.length
    });
    stats.addedBookmarks += 1;
  }

  const folders = [];
  for (const child of folder.folders || []) {
    folders.push(cloneFolderWithIdFix(child, existingIds, stats));
    stats.addedFolders += 1;
  }

  return {
    id,
    name: folder.name || 'Untitled',
    sortOrder: folder.sortOrder ?? 0,
    folders,
    bookmarks
  };
}

/**
 * Merge import: keep existing, append new folders/bookmarks, no overwrite.
 * @param {object} existingRaw
 * @param {object} incomingRaw
 * @param {{ targetFolderId?: string }} [options] targetFolderId: MarkNest folder id or 'root'
 */
export function mergeImport(existingRaw, incomingRaw, options = {}) {
  const existing = normalizeData(existingRaw);
  const incoming = normalizeData(incomingRaw);
  const targetFolderId = options.targetFolderId || 'root';

  const check = validateData(incoming);
  if (!check.ok) {
    const e = new Error('JSON_INVALID');
    e.errors = check.errors;
    throw e;
  }

  let targetFolder = null;
  let bookmarkList = existing.rootBookmarks;
  let folderList = existing.folders;
  if (targetFolderId && targetFolderId !== 'root') {
    targetFolder = findFolder(existing, targetFolderId);
    if (!targetFolder) throw new Error('FOLDER_NOT_FOUND');
    bookmarkList = targetFolder.bookmarks;
    folderList = targetFolder.folders;
  }

  const existingIds = collectIds(existing);
  const stats = {
    addedFolders: 0,
    addedBookmarks: 0,
    skippedDuplicateUrl: 0,
    skippedInvalidUrl: 0,
    remappedIds: 0
  };

  for (const b of incoming.rootBookmarks || []) {
    if (!isValidHttpUrl(b.url)) {
      stats.skippedInvalidUrl += 1;
      continue;
    }
    // Duplicate URLs are allowed (same as manual create).
    let id = b.id;
    if (!id || existingIds.has(id)) {
      id = generateId('bookmark');
      stats.remappedIds += 1;
    }
    existingIds.add(id);
    bookmarkList.push({
      id,
      title: b.title || b.url,
      url: b.url,
      sortOrder: bookmarkList.length
    });
    stats.addedBookmarks += 1;
  }

  for (const f of incoming.folders || []) {
    folderList.push(cloneFolderWithIdFix(f, existingIds, stats));
    stats.addedFolders += 1;
  }

  existing.updatedAt = nowIso();
  return { data: existing, stats };
}

export function validateImportPayload(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return { ok: false, errors: ['Invalid JSON syntax'] };
    }
  }
  const normalized = normalizeData(parsed);
  return validateData(normalized);
}

/** Full remap — used when forcing unique IDs. */
export function remapAllIds(data) {
  return remapIds(normalizeData(data));
}
