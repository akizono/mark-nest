/**
 * High-level bookmark data API for UI layers.
 * Mutating ops update memory immediately, then persist in the background.
 */

import {
  addBookmark,
  addFolder,
  countStats,
  deleteBookmark,
  deleteFolder,
  moveBookmark,
  moveFolder,
  relocateBookmark,
  relocateFolder,
  renameFolder,
  searchData,
  updateBookmark,
  validateData
} from './bookmarks.js';
import {
  exportJsonWithPicker,
  getStorageStatus,
  importJsonFromPicker,
  initManualMode,
  loadBookmarks,
  pickDirectoryAndInit,
  pickFileAndInit,
  reauthorize,
  saveBookmarks,
  switchStorageMode
} from './file-manager.js';
import { mergeImport } from './import-export.js';
import { deepClone } from './utils.js';
import { CONFIG_KEYS, setConfig, STORAGE_MODES, getConfig } from './config.js';

let cache = null;
let cachedMode = null;
let persistChain = Promise.resolve();
let queuedPersist = null;
let lastPersistError = null;

async function rememberMode() {
  try {
    const status = await getStorageStatus();
    cachedMode = status.mode;
  } catch {
    // ignore
  }
}

/** Flush pendingDiskSync to the real store without blocking the UI. */
function flushPendingDiskSyncInBackground(buffered, mode) {
  const run = async () => {
    if (mode === STORAGE_MODES.MANUAL) {
      await setConfig({
        [CONFIG_KEYS.pendingData]: buffered,
        [CONFIG_KEYS.pendingDiskSync]: null
      });
      return;
    }
    try {
      await saveBookmarks(buffered);
      await setConfig({ [CONFIG_KEYS.pendingDiskSync]: null });
    } catch {
      // keep pendingDiskSync for a later attempt
    }
  };
  run().catch(() => {});
}

/**
 * Prefer the fast local buffer so popup can show newly added bookmarks immediately.
 * File / pendingData sync happens in the background.
 */
export async function refresh() {
  const cfg = await getConfig([
    CONFIG_KEYS.pendingDiskSync,
    CONFIG_KEYS.storageMode,
    CONFIG_KEYS.pendingData
  ]);
  cachedMode = cfg.storageMode || cachedMode;

  if (cfg.pendingDiskSync) {
    cache = cfg.pendingDiskSync;
    flushPendingDiskSyncInBackground(cfg.pendingDiskSync, cfg.storageMode);
    return deepClone(cache);
  }

  cache = await loadBookmarks();
  await rememberMode();
  return deepClone(cache);
}

export function getCached() {
  return cache ? deepClone(cache) : null;
}

function schedulePersist(snapshot) {
  queuedPersist = snapshot;
  persistChain = persistChain
    .catch(() => {})
    .then(async () => {
      while (queuedPersist) {
        const toSave = queuedPersist;
        queuedPersist = null;
        try {
          const saved = await saveBookmarks(toSave);
          if (!queuedPersist) {
            cache = saved.data;
            await setConfig({ [CONFIG_KEYS.pendingDiskSync]: null });
          }
          lastPersistError = null;
          return saved;
        } catch (err) {
          lastPersistError = err;
          throw err;
        }
      }
      return { saved: true, data: cache };
    });
  return persistChain;
}

/** Wait until background writes finish. */
export function flush() {
  return persistChain;
}

export function getLastPersistError() {
  return lastPersistError;
}

/**
 * Apply mutation to in-memory cache immediately; disk write is async.
 * Callers can await `flushed` when they must confirm durability (e.g. closing a window).
 */
async function mutate(mutator) {
  if (!cache) {
    cache = await loadBookmarks();
    await rememberMode();
  }
  const draft = deepClone(cache);
  const result = mutator(draft);
  cache = draft;

  const needsExport = cachedMode === STORAGE_MODES.MANUAL;
  const snapshot = deepClone(draft);
  // Await only the fast local buffer so callers can close UI immediately without data loss.
  await setConfig({
    [CONFIG_KEYS.pendingDiskSync]: snapshot,
    bookmarksRevision: Date.now()
  });
  const flushed = schedulePersist(snapshot);
  try {
    chrome.runtime.sendMessage({ type: 'BOOKMARKS_CHANGED' }).catch(() => {});
  } catch {
    // no listeners
  }

  return {
    result,
    data: deepClone(cache),
    saveMeta: {
      saved: !needsExport,
      needsExport,
      optimistic: true
    },
    flushed
  };
}

export async function getStatus() {
  return getStorageStatus();
}

export async function setupDirectory() {
  const r = await pickDirectoryAndInit();
  cache = r.data;
  cachedMode = STORAGE_MODES.DIRECTORY;
  return r;
}

export async function setupFile(createNew = true) {
  const r = await pickFileAndInit({ createNew });
  cache = r.data;
  cachedMode = STORAGE_MODES.FILE;
  return r;
}

export async function setupManual() {
  const r = await initManualMode();
  cache = r.data;
  cachedMode = STORAGE_MODES.MANUAL;
  return r;
}

export async function ensureAccess() {
  const status = await getStorageStatus();
  if (status.needsReauth) {
    await reauthorize();
  }
  return refresh();
}

export const api = {
  async createFolder(parentId, name) {
    return mutate((d) => addFolder(d, parentId, name));
  },
  async renameFolder(folderId, name) {
    return mutate((d) => renameFolder(d, folderId, name));
  },
  async removeFolder(folderId, strategy) {
    return mutate((d) => deleteFolder(d, folderId, strategy));
  },
  async moveFolder(folderId, newParentId) {
    return mutate((d) => moveFolder(d, folderId, newParentId));
  },
  async relocateFolder(folderId, newParentId, beforeFolderId = null) {
    return mutate((d) => relocateFolder(d, folderId, newParentId, beforeFolderId));
  },
  async createBookmark(folderId, payload) {
    return mutate((d) => addBookmark(d, folderId, payload));
  },
  async editBookmark(bookmarkId, payload) {
    return mutate((d) => updateBookmark(d, bookmarkId, payload));
  },
  async removeBookmark(bookmarkId) {
    return mutate((d) => deleteBookmark(d, bookmarkId));
  },
  async removeBookmarks(bookmarkIds) {
    const ids = [...new Set(bookmarkIds || [])];
    return mutate((d) => {
      ids.forEach((id) => {
        try {
          deleteBookmark(d, id);
        } catch {
          // skip missing
        }
      });
      return ids.length;
    });
  },
  async moveBookmark(bookmarkId, folderId) {
    return mutate((d) => moveBookmark(d, bookmarkId, folderId));
  },
  async relocateBookmark(bookmarkId, folderId, beforeBookmarkId = null) {
    return mutate((d) => relocateBookmark(d, bookmarkId, folderId, beforeBookmarkId));
  },
  search(query) {
    if (!cache) return { folders: [], bookmarks: [] };
    return searchData(cache, query);
  },
  stats() {
    if (!cache) return { folders: 0, bookmarks: 0 };
    return countStats(cache);
  },
  async exportData() {
    await flush();
    if (!cache) await refresh();
    return exportJsonWithPicker(cache);
  },
  async importMerge() {
    const incoming = await importJsonFromPicker();
    return this.importMergePayload(incoming);
  },
  async importMergePayload(incoming, options = {}) {
    if (!cache) await refresh();
    const { data, stats } = mergeImport(cache, incoming, options);
    cache = data;
    const saved = await saveBookmarks(data);
    cache = saved.data;
    try {
      chrome.runtime.sendMessage({ type: 'BOOKMARKS_CHANGED' }).catch(() => {});
    } catch {
      // ignore
    }
    return { stats, data: deepClone(cache), saveMeta: saved };
  },
  async checkIntegrity() {
    await flush();
    if (!cache) await refresh();
    return validateData(cache);
  },
  async changeStorageMode(mode, options) {
    await flush();
    if (!cache) await refresh();
    const r = await switchStorageMode(mode, cache, options);
    cache = r.data;
    cachedMode = mode;
    return r;
  },
  flush
};

export { STORAGE_MODES };
