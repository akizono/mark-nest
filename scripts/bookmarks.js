/**
 * In-memory bookmark tree operations.
 * Persistence is handled by file-manager / data-service.
 */

import { createEmptyData, generateId, isValidHttpUrl, nowIso } from './utils.js';

export function validateData(data) {
  const errors = [];
  if (!data || typeof data !== 'object') {
    return { ok: false, errors: ['Root must be an object'] };
  }
  if (data.version !== 1 && data.version !== '1') {
    errors.push(`Unsupported version: ${data.version}`);
  }
  if (!Array.isArray(data.folders)) errors.push('folders must be an array');
  if (!Array.isArray(data.rootBookmarks)) errors.push('rootBookmarks must be an array');

  const ids = new Set();
  const walkFolder = (folder, path) => {
    if (!folder || typeof folder !== 'object') {
      errors.push(`Invalid folder at ${path}`);
      return;
    }
    if (!folder.id || typeof folder.id !== 'string') errors.push(`Missing folder id at ${path}`);
    if (folder.id) {
      if (ids.has(folder.id)) errors.push(`Duplicate id: ${folder.id}`);
      ids.add(folder.id);
    }
    if (typeof folder.name !== 'string' || !folder.name.trim()) {
      errors.push(`Invalid folder name at ${path}`);
    }
    if (!Array.isArray(folder.folders)) errors.push(`folders missing at ${path}`);
    if (!Array.isArray(folder.bookmarks)) errors.push(`bookmarks missing at ${path}`);
    (folder.bookmarks || []).forEach((b, i) => walkBookmark(b, `${path}/bookmarks[${i}]`));
    (folder.folders || []).forEach((f, i) => walkFolder(f, `${path}/folders[${i}]`));
  };

  const walkBookmark = (b, path) => {
    if (!b || typeof b !== 'object') {
      errors.push(`Invalid bookmark at ${path}`);
      return;
    }
    if (!b.id || typeof b.id !== 'string') errors.push(`Missing bookmark id at ${path}`);
    if (b.id) {
      if (ids.has(b.id)) errors.push(`Duplicate id: ${b.id}`);
      ids.add(b.id);
    }
    if (typeof b.title !== 'string') errors.push(`Invalid title at ${path}`);
    if (!isValidHttpUrl(b.url)) errors.push(`Invalid url at ${path}: ${b.url}`);
  };

  (data.folders || []).forEach((f, i) => walkFolder(f, `folders[${i}]`));
  (data.rootBookmarks || []).forEach((b, i) => walkBookmark(b, `rootBookmarks[${i}]`));

  return { ok: errors.length === 0, errors, ids };
}

export function normalizeData(raw) {
  const data = raw && typeof raw === 'object' ? raw : createEmptyData();
  const out = {
    version: 1,
    updatedAt: data.updatedAt || nowIso(),
    folders: Array.isArray(data.folders) ? data.folders : [],
    rootBookmarks: Array.isArray(data.rootBookmarks) ? data.rootBookmarks : []
  };
  return out;
}

function sortByOrder(list) {
  return [...list].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
}

export function findFolder(data, folderId) {
  if (!folderId || folderId === 'root') return null;
  const stack = [...(data.folders || [])];
  while (stack.length) {
    const f = stack.pop();
    if (f.id === folderId) return f;
    (f.folders || []).forEach((c) => stack.push(c));
  }
  return null;
}

export function findFolderParent(data, folderId) {
  const walk = (folders, parent) => {
    for (const f of folders) {
      if (f.id === folderId) return parent;
      const hit = walk(f.folders || [], f);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
  const hit = walk(data.folders || [], null);
  return hit === undefined ? null : hit;
}

export function findBookmark(data, bookmarkId) {
  for (const b of data.rootBookmarks || []) {
    if (b.id === bookmarkId) return { bookmark: b, folder: null, list: data.rootBookmarks };
  }
  const stack = [...(data.folders || [])];
  while (stack.length) {
    const f = stack.pop();
    for (const b of f.bookmarks || []) {
      if (b.id === bookmarkId) return { bookmark: b, folder: f, list: f.bookmarks };
    }
    (f.folders || []).forEach((c) => stack.push(c));
  }
  return null;
}

export function collectAllUrls(data) {
  const urls = new Set();
  (data.rootBookmarks || []).forEach((b) => urls.add(b.url));
  const stack = [...(data.folders || [])];
  while (stack.length) {
    const f = stack.pop();
    (f.bookmarks || []).forEach((b) => urls.add(b.url));
    (f.folders || []).forEach((c) => stack.push(c));
  }
  return urls;
}

export function collectFolderOptions(data, rootLabel = '/') {
  const options = [{ id: 'root', name: rootLabel, path: rootLabel }];
  const walk = (folders, path) => {
    sortByOrder(folders).forEach((f) => {
      const p = path === rootLabel ? f.name : `${path} / ${f.name}`;
      options.push({ id: f.id, name: f.name, path: p });
      walk(f.folders || [], p);
    });
  };
  walk(data.folders || [], rootLabel);
  return options;
}

export function addFolder(data, parentId, name) {
  const folder = {
    id: generateId('folder'),
    name: name.trim(),
    sortOrder: 0,
    folders: [],
    bookmarks: []
  };
  if (!parentId || parentId === 'root') {
    folder.sortOrder = data.folders.length;
    data.folders.push(folder);
  } else {
    const parent = findFolder(data, parentId);
    if (!parent) throw new Error('PARENT_NOT_FOUND');
    folder.sortOrder = parent.folders.length;
    parent.folders.push(folder);
  }
  data.updatedAt = nowIso();
  return folder;
}

export function renameFolder(data, folderId, name) {
  const folder = findFolder(data, folderId);
  if (!folder) throw new Error('FOLDER_NOT_FOUND');
  folder.name = name.trim();
  data.updatedAt = nowIso();
  return folder;
}

export function deleteFolder(data, folderId, strategy = 'delete_all') {
  // strategy: delete_all | promote_to_parent
  const parent = findFolderParent(data, folderId);
  const list = parent ? parent.folders : data.folders;
  const idx = list.findIndex((f) => f.id === folderId);
  if (idx < 0) throw new Error('FOLDER_NOT_FOUND');
  const [removed] = list.splice(idx, 1);

  if (strategy === 'promote_to_parent') {
    const targetFolders = parent ? parent.folders : data.folders;
    const targetBookmarks = parent ? parent.bookmarks : data.rootBookmarks;
    (removed.folders || []).forEach((f) => {
      f.sortOrder = targetFolders.length;
      targetFolders.push(f);
    });
    (removed.bookmarks || []).forEach((b) => {
      b.sortOrder = targetBookmarks.length;
      targetBookmarks.push(b);
    });
  }

  data.updatedAt = nowIso();
  return removed;
}

export function moveFolder(data, folderId, newParentId) {
  if (folderId === newParentId) throw new Error('INVALID_MOVE');
  const folder = findFolder(data, folderId);
  if (!folder) throw new Error('FOLDER_NOT_FOUND');

  // Prevent moving into descendant
  if (newParentId && newParentId !== 'root') {
    let cur = findFolder(data, newParentId);
    while (cur) {
      if (cur.id === folderId) throw new Error('INVALID_MOVE_DESCENDANT');
      const p = findFolderParent(data, cur.id);
      cur = p;
    }
  }

  const oldParent = findFolderParent(data, folderId);
  const oldList = oldParent ? oldParent.folders : data.folders;
  const idx = oldList.findIndex((f) => f.id === folderId);
  const [moved] = oldList.splice(idx, 1);

  if (!newParentId || newParentId === 'root') {
    moved.sortOrder = data.folders.length;
    data.folders.push(moved);
  } else {
    const parent = findFolder(data, newParentId);
    if (!parent) throw new Error('PARENT_NOT_FOUND');
    moved.sortOrder = parent.folders.length;
    parent.folders.push(moved);
  }
  data.updatedAt = nowIso();
  return moved;
}

export function addBookmark(data, folderId, { title, url }) {
  if (!isValidHttpUrl(url)) throw new Error('INVALID_URL');

  const bookmark = {
    id: generateId('bookmark'),
    title: (title || url).trim(),
    url,
    sortOrder: 0
  };

  if (!folderId || folderId === 'root') {
    bookmark.sortOrder = data.rootBookmarks.length;
    data.rootBookmarks.push(bookmark);
  } else {
    const folder = findFolder(data, folderId);
    if (!folder) throw new Error('FOLDER_NOT_FOUND');
    bookmark.sortOrder = folder.bookmarks.length;
    folder.bookmarks.push(bookmark);
  }
  data.updatedAt = nowIso();
  return bookmark;
}

export function updateBookmark(data, bookmarkId, { title, url }) {
  const found = findBookmark(data, bookmarkId);
  if (!found) throw new Error('BOOKMARK_NOT_FOUND');
  if (url && url !== found.bookmark.url) {
    if (!isValidHttpUrl(url)) throw new Error('INVALID_URL');
    found.bookmark.url = url;
  }
  if (title != null) found.bookmark.title = title.trim();
  data.updatedAt = nowIso();
  return found.bookmark;
}

/**
 * Move folder to a new parent and optional sibling position.
 * @param beforeFolderId insert before this sibling id; null = append
 */
export function relocateFolder(data, folderId, newParentId, beforeFolderId = null) {
  if (!folderId || folderId === 'root') throw new Error('INVALID_MOVE');
  if (folderId === newParentId || folderId === beforeFolderId) throw new Error('INVALID_MOVE');

  if (newParentId && newParentId !== 'root') {
    let cur = findFolder(data, newParentId);
    while (cur) {
      if (cur.id === folderId) throw new Error('INVALID_MOVE_DESCENDANT');
      cur = findFolderParent(data, cur.id);
    }
  }

  const oldParent = findFolderParent(data, folderId);
  const oldList = oldParent ? oldParent.folders : data.folders;
  const fromIdx = oldList.findIndex((f) => f.id === folderId);
  if (fromIdx < 0) throw new Error('FOLDER_NOT_FOUND');
  const [moved] = oldList.splice(fromIdx, 1);

  const targetParent =
    !newParentId || newParentId === 'root' ? null : findFolder(data, newParentId);
  if (newParentId && newParentId !== 'root' && !targetParent) {
    throw new Error('PARENT_NOT_FOUND');
  }
  const targetList = targetParent ? targetParent.folders : data.folders;

  let insertAt = targetList.length;
  if (beforeFolderId) {
    const bi = targetList.findIndex((f) => f.id === beforeFolderId);
    if (bi >= 0) insertAt = bi;
  }
  targetList.splice(insertAt, 0, moved);
  targetList.forEach((f, i) => {
    f.sortOrder = i;
  });
  data.updatedAt = nowIso();
  return moved;
}

export function deleteBookmark(data, bookmarkId) {
  const found = findBookmark(data, bookmarkId);
  if (!found) throw new Error('BOOKMARK_NOT_FOUND');
  const idx = found.list.findIndex((b) => b.id === bookmarkId);
  found.list.splice(idx, 1);
  data.updatedAt = nowIso();
  return found.bookmark;
}

export function moveBookmark(data, bookmarkId, newFolderId) {
  return relocateBookmark(data, bookmarkId, newFolderId, null);
}

/**
 * Move bookmark to a folder and optional sibling position among bookmarks.
 * @param beforeBookmarkId insert before this id; null = append
 */
export function relocateBookmark(data, bookmarkId, newFolderId, beforeBookmarkId = null) {
  const found = findBookmark(data, bookmarkId);
  if (!found) throw new Error('BOOKMARK_NOT_FOUND');
  if (bookmarkId === beforeBookmarkId) throw new Error('INVALID_MOVE');

  const idx = found.list.findIndex((b) => b.id === bookmarkId);
  const [moved] = found.list.splice(idx, 1);

  let targetList;
  if (!newFolderId || newFolderId === 'root') {
    targetList = data.rootBookmarks;
  } else {
    const folder = findFolder(data, newFolderId);
    if (!folder) throw new Error('FOLDER_NOT_FOUND');
    targetList = folder.bookmarks;
  }

  let insertAt = targetList.length;
  if (beforeBookmarkId) {
    const bi = targetList.findIndex((b) => b.id === beforeBookmarkId);
    if (bi >= 0) insertAt = bi;
  }
  targetList.splice(insertAt, 0, moved);
  targetList.forEach((b, i) => {
    b.sortOrder = i;
  });
  data.updatedAt = nowIso();
  return moved;
}

export function reorderInList(list, orderedIds) {
  const map = new Map(list.map((item) => [item.id, item]));
  const next = [];
  orderedIds.forEach((id, i) => {
    const item = map.get(id);
    if (item) {
      item.sortOrder = i;
      next.push(item);
      map.delete(id);
    }
  });
  map.forEach((item) => {
    item.sortOrder = next.length;
    next.push(item);
  });
  list.splice(0, list.length, ...next);
}

export function searchData(data, query) {
  const q = query.trim().toLowerCase();
  if (!q) return { folders: [], bookmarks: [] };

  const folders = [];
  const bookmarks = [];

  const walk = (folderList, path) => {
    sortByOrder(folderList).forEach((f) => {
      const p = path ? `${path} / ${f.name}` : f.name;
      if (f.name.toLowerCase().includes(q)) {
        folders.push({ id: f.id, name: f.name, path: p });
      }
      sortByOrder(f.bookmarks || []).forEach((b) => {
        if (b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)) {
          bookmarks.push({ ...b, folderPath: p, folderId: f.id });
        }
      });
      walk(f.folders || [], p);
    });
  };

  sortByOrder(data.rootBookmarks || []).forEach((b) => {
    if (b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)) {
      bookmarks.push({ ...b, folderPath: '/', folderId: 'root' });
    }
  });
  walk(data.folders || [], '');

  return { folders, bookmarks };
}

export function countStats(data) {
  let folders = 0;
  let bookmarks = (data.rootBookmarks || []).length;
  const stack = [...(data.folders || [])];
  while (stack.length) {
    const f = stack.pop();
    folders += 1;
    bookmarks += (f.bookmarks || []).length;
    (f.folders || []).forEach((c) => stack.push(c));
  }
  return { folders, bookmarks };
}

export function getSortedChildren(folderOrRoot, data) {
  if (!folderOrRoot || folderOrRoot === 'root') {
    return {
      folders: sortByOrder(data.folders || []),
      bookmarks: sortByOrder(data.rootBookmarks || [])
    };
  }
  return {
    folders: sortByOrder(folderOrRoot.folders || []),
    bookmarks: sortByOrder(folderOrRoot.bookmarks || [])
  };
}
