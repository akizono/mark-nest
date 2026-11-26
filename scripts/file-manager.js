/**
 * File System Access layer with three storage modes:
 * 1) directory — auto read/write bookmarks.json in chosen folder
 * 2) file — bind a single bookmarks.json file handle
 * 3) manual — import/export only (no auto persist)
 *
 * Never uses chrome.storage.local as the bookmark source of truth.
 */

import { idbDelete, idbGet, idbSet } from './idb.js';
import { CONFIG_KEYS, getConfig, setConfig, STORAGE_MODES } from './config.js';
import { createEmptyData, nowIso } from './utils.js';
import { normalizeData, validateData } from './bookmarks.js';

const DIR_HANDLE_KEY = 'directoryHandle';
const FILE_HANDLE_KEY = 'fileHandle';
const BOOKMARKS_FILENAME = 'bookmarks.json';
const TMP_FILENAME = 'bookmarks.json.tmp';
const BAK_FILENAME = 'bookmarks.json.bak';

let writeChain = Promise.resolve();

function enqueueWrite(task) {
  writeChain = writeChain.then(task, task);
  return writeChain;
}

export function detectCapabilities() {
  const hasDir = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  const hasFile =
    typeof window !== 'undefined' &&
    typeof window.showOpenFilePicker === 'function' &&
    typeof window.showSaveFilePicker === 'function';
  return {
    directory: hasDir,
    file: hasFile,
    manual: true
  };
}

async function ensurePermission(handle, mode = 'readwrite') {
  if (!handle) return { ok: false, reason: 'NO_HANDLE' };
  const opts = { mode };
  try {
    let state = await handle.queryPermission(opts);
    if (state === 'granted') return { ok: true, state };
    state = await handle.requestPermission(opts);
    if (state === 'granted') return { ok: true, state };
    return { ok: false, reason: 'PERMISSION_DENIED', state };
  } catch (err) {
    return { ok: false, reason: 'PERMISSION_ERROR', error: err };
  }
}

async function readJsonFromFileHandle(fileHandle) {
  const file = await fileHandle.getFile();
  const text = await file.text();
  if (!text.trim()) {
    return createEmptyData();
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const e = new Error('JSON_CORRUPT');
    e.cause = err;
    e.rawText = text;
    throw e;
  }
  const normalized = normalizeData(parsed);
  const check = validateData(normalized);
  if (!check.ok) {
    const e = new Error('JSON_INVALID');
    e.errors = check.errors;
    throw e;
  }
  return normalized;
}

async function writeAtomicInDirectory(dirHandle, data) {
  const payload = `${JSON.stringify(data, null, 2)}\n`;

  // Best-effort backup of previous content (do not block on verify round-trip).
  try {
    const existing = await dirHandle.getFileHandle(BOOKMARKS_FILENAME);
    const existingFile = await existing.getFile();
    const bak = await dirHandle.getFileHandle(BAK_FILENAME, { create: true });
    const bakWritable = await bak.createWritable();
    await bakWritable.write(await existingFile.text());
    await bakWritable.close();
  } catch {
    // no existing file — ok
  }

  const mainHandle = await dirHandle.getFileHandle(BOOKMARKS_FILENAME, { create: true });
  const mainWritable = await mainHandle.createWritable();
  await mainWritable.write(payload);
  await mainWritable.close();

  // Cleanup leftover temp from older versions
  try {
    await dirHandle.removeEntry(TMP_FILENAME);
  } catch {
    // ignore
  }
}

async function writeFileHandle(fileHandle, data) {
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  const writable = await fileHandle.createWritable();
  await writable.write(payload);
  await writable.close();
}

export async function getStorageStatus() {
  const cfg = await getConfig([
    CONFIG_KEYS.storageMode,
    CONFIG_KEYS.storageDisplayName,
    CONFIG_KEYS.initialized,
    CONFIG_KEYS.pendingData
  ]);
  const caps = detectCapabilities();
  let permission = 'n/a';
  let ready = false;
  let needsReauth = false;

  if (cfg.storageMode === STORAGE_MODES.DIRECTORY) {
    const handle = await idbGet(DIR_HANDLE_KEY);
    if (!handle) {
      permission = 'missing_handle';
      needsReauth = true;
    } else {
      try {
        const state = await handle.queryPermission({ mode: 'readwrite' });
        permission = state;
        ready = state === 'granted';
        needsReauth = state !== 'granted';
      } catch {
        permission = 'error';
        needsReauth = true;
      }
    }
  } else if (cfg.storageMode === STORAGE_MODES.FILE) {
    const handle = await idbGet(FILE_HANDLE_KEY);
    if (!handle) {
      permission = 'missing_handle';
      needsReauth = true;
    } else {
      try {
        const state = await handle.queryPermission({ mode: 'readwrite' });
        permission = state;
        ready = state === 'granted';
        needsReauth = state !== 'granted';
      } catch {
        permission = 'error';
        needsReauth = true;
      }
    }
  } else if (cfg.storageMode === STORAGE_MODES.MANUAL) {
    ready = true;
    permission = 'manual';
  }

  return {
    mode: cfg.storageMode || STORAGE_MODES.NONE,
    displayName: cfg.storageDisplayName || '',
    initialized: !!cfg.initialized,
    hasPending: !!cfg.pendingData,
    permission,
    ready,
    needsReauth,
    capabilities: caps
  };
}

export async function pickDirectoryAndInit() {
  if (!detectCapabilities().directory) {
    throw new Error('DIRECTORY_UNSUPPORTED');
  }
  const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  const perm = await ensurePermission(dirHandle, 'readwrite');
  if (!perm.ok) throw new Error('PERMISSION_DENIED');

  let data;
  let created = false;
  try {
    const fileHandle = await dirHandle.getFileHandle(BOOKMARKS_FILENAME);
    data = await readJsonFromFileHandle(fileHandle);
  } catch {
    data = createEmptyData();
    await writeAtomicInDirectory(dirHandle, data);
    created = true;
  }

  await idbSet(DIR_HANDLE_KEY, dirHandle);
  await idbDelete(FILE_HANDLE_KEY);
  await setConfig({
    [CONFIG_KEYS.storageMode]: STORAGE_MODES.DIRECTORY,
    [CONFIG_KEYS.storageDisplayName]: dirHandle.name,
    [CONFIG_KEYS.initialized]: true,
    [CONFIG_KEYS.pendingData]: null
  });

  return { data, created, mode: STORAGE_MODES.DIRECTORY, displayName: dirHandle.name };
}

export async function pickFileAndInit({ createNew = false } = {}) {
  if (!detectCapabilities().file) {
    throw new Error('FILE_UNSUPPORTED');
  }

  let fileHandle;
  if (createNew) {
    fileHandle = await window.showSaveFilePicker({
      suggestedName: BOOKMARKS_FILENAME,
      types: [
        {
          description: 'MarkNest JSON',
          accept: { 'application/json': ['.json'] }
        }
      ]
    });
    const data = createEmptyData();
    await writeFileHandle(fileHandle, data);
    await idbSet(FILE_HANDLE_KEY, fileHandle);
    await idbDelete(DIR_HANDLE_KEY);
    await setConfig({
      [CONFIG_KEYS.storageMode]: STORAGE_MODES.FILE,
      [CONFIG_KEYS.storageDisplayName]: fileHandle.name,
      [CONFIG_KEYS.initialized]: true,
      [CONFIG_KEYS.pendingData]: null
    });
    return { data, created: true, mode: STORAGE_MODES.FILE, displayName: fileHandle.name };
  }

  const [picked] = await window.showOpenFilePicker({
    multiple: false,
    types: [
      {
        description: 'MarkNest JSON',
        accept: { 'application/json': ['.json'] }
      }
    ]
  });
  fileHandle = picked;
  const perm = await ensurePermission(fileHandle, 'readwrite');
  if (!perm.ok) throw new Error('PERMISSION_DENIED');
  const data = await readJsonFromFileHandle(fileHandle);

  await idbSet(FILE_HANDLE_KEY, fileHandle);
  await idbDelete(DIR_HANDLE_KEY);
  await setConfig({
    [CONFIG_KEYS.storageMode]: STORAGE_MODES.FILE,
    [CONFIG_KEYS.storageDisplayName]: fileHandle.name,
    [CONFIG_KEYS.initialized]: true,
    [CONFIG_KEYS.pendingData]: null
  });
  return { data, created: false, mode: STORAGE_MODES.FILE, displayName: fileHandle.name };
}

export async function initManualMode(seedData = null) {
  const data = seedData || createEmptyData();
  await idbDelete(DIR_HANDLE_KEY);
  await idbDelete(FILE_HANDLE_KEY);
  await setConfig({
    [CONFIG_KEYS.storageMode]: STORAGE_MODES.MANUAL,
    [CONFIG_KEYS.storageDisplayName]: 'manual',
    [CONFIG_KEYS.initialized]: true,
    [CONFIG_KEYS.pendingData]: data
  });
  return { data, created: true, mode: STORAGE_MODES.MANUAL, displayName: 'manual' };
}

export async function reauthorize() {
  const cfg = await getConfig([CONFIG_KEYS.storageMode]);
  if (cfg.storageMode === STORAGE_MODES.DIRECTORY) {
    const handle = await idbGet(DIR_HANDLE_KEY);
    const perm = await ensurePermission(handle, 'readwrite');
    if (!perm.ok) throw new Error('PERMISSION_DENIED');
    return { ok: true, mode: STORAGE_MODES.DIRECTORY };
  }
  if (cfg.storageMode === STORAGE_MODES.FILE) {
    const handle = await idbGet(FILE_HANDLE_KEY);
    const perm = await ensurePermission(handle, 'readwrite');
    if (!perm.ok) throw new Error('PERMISSION_DENIED');
    return { ok: true, mode: STORAGE_MODES.FILE };
  }
  return { ok: true, mode: STORAGE_MODES.MANUAL };
}

export async function loadBookmarks() {
  const cfg = await getConfig([CONFIG_KEYS.storageMode, CONFIG_KEYS.pendingData]);

  if (cfg.storageMode === STORAGE_MODES.DIRECTORY) {
    const dir = await idbGet(DIR_HANDLE_KEY);
    if (!dir) throw new Error('HANDLE_MISSING');
    const perm = await ensurePermission(dir, 'readwrite');
    if (!perm.ok) throw new Error('PERMISSION_DENIED');
    try {
      const fileHandle = await dir.getFileHandle(BOOKMARKS_FILENAME);
      return await readJsonFromFileHandle(fileHandle);
    } catch (err) {
      if (err?.name === 'NotFoundError') {
        const data = createEmptyData();
        await writeAtomicInDirectory(dir, data);
        return data;
      }
      throw err;
    }
  }

  if (cfg.storageMode === STORAGE_MODES.FILE) {
    const file = await idbGet(FILE_HANDLE_KEY);
    if (!file) throw new Error('HANDLE_MISSING');
    const perm = await ensurePermission(file, 'readwrite');
    if (!perm.ok) throw new Error('PERMISSION_DENIED');
    return await readJsonFromFileHandle(file);
  }

  if (cfg.storageMode === STORAGE_MODES.MANUAL) {
    return normalizeData(cfg.pendingData || createEmptyData());
  }

  throw new Error('NOT_INITIALIZED');
}

export async function saveBookmarks(data) {
  const normalized = normalizeData(data);
  normalized.updatedAt = nowIso();
  const check = validateData(normalized);
  if (!check.ok) {
    const e = new Error('JSON_INVALID');
    e.errors = check.errors;
    throw e;
  }

  return enqueueWrite(async () => {
    const cfg = await getConfig([CONFIG_KEYS.storageMode]);

    if (cfg.storageMode === STORAGE_MODES.DIRECTORY) {
      const dir = await idbGet(DIR_HANDLE_KEY);
      if (!dir) throw new Error('HANDLE_MISSING');
      const perm = await ensurePermission(dir, 'readwrite');
      if (!perm.ok) throw new Error('PERMISSION_DENIED');
      await writeAtomicInDirectory(dir, normalized);
      await setConfig({ [CONFIG_KEYS.pendingData]: null });
      return { saved: true, mode: STORAGE_MODES.DIRECTORY, data: normalized };
    }

    if (cfg.storageMode === STORAGE_MODES.FILE) {
      const file = await idbGet(FILE_HANDLE_KEY);
      if (!file) throw new Error('HANDLE_MISSING');
      const perm = await ensurePermission(file, 'readwrite');
      if (!perm.ok) throw new Error('PERMISSION_DENIED');
      await writeFileHandle(file, normalized);
      await setConfig({ [CONFIG_KEYS.pendingData]: null });
      return { saved: true, mode: STORAGE_MODES.FILE, data: normalized };
    }

    if (cfg.storageMode === STORAGE_MODES.MANUAL) {
      // Keep edits in pending until user exports. NOT the primary durable source —
      // user must export. This is only a working buffer for the manual mode UX.
      await setConfig({ [CONFIG_KEYS.pendingData]: normalized });
      return { saved: false, mode: STORAGE_MODES.MANUAL, data: normalized, needsExport: true };
    }

    throw new Error('NOT_INITIALIZED');
  });
}

/**
 * Switch storage mode without losing in-memory/pending data.
 * Caller must pass the latest data snapshot.
 */
export async function switchStorageMode(targetMode, currentData, options = {}) {
  const data = normalizeData(currentData);

  if (targetMode === STORAGE_MODES.DIRECTORY) {
    const result = await pickDirectoryAndInit();
    // Write current data into newly selected directory (don't lose edits)
    await writeAtomicInDirectory(await idbGet(DIR_HANDLE_KEY), data);
    await setConfig({ [CONFIG_KEYS.pendingData]: null });
    return { ...result, data };
  }

  if (targetMode === STORAGE_MODES.FILE) {
    const result = await pickFileAndInit({ createNew: options.createNew !== false });
    await writeFileHandle(await idbGet(FILE_HANDLE_KEY), data);
    await setConfig({ [CONFIG_KEYS.pendingData]: null });
    return { ...result, data };
  }

  if (targetMode === STORAGE_MODES.MANUAL) {
    return initManualMode(data);
  }

  throw new Error('INVALID_MODE');
}

export async function exportJsonWithPicker(data) {
  const normalized = normalizeData(data);
  normalized.updatedAt = nowIso();
  const payload = `${JSON.stringify(normalized, null, 2)}\n`;

  if (detectCapabilities().file) {
    const handle = await window.showSaveFilePicker({
      suggestedName: BOOKMARKS_FILENAME,
      types: [
        {
          description: 'MarkNest JSON',
          accept: { 'application/json': ['.json'] }
        }
      ]
    });
    const writable = await handle.createWritable();
    await writable.write(payload);
    await writable.close();

    // If currently in manual mode, exporting is the durable save.
    const cfg = await getConfig([CONFIG_KEYS.storageMode]);
    if (cfg.storageMode === STORAGE_MODES.MANUAL) {
      await setConfig({ [CONFIG_KEYS.pendingData]: normalized });
    }
    return { ok: true, method: 'picker' };
  }

  // Fallback download
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = BOOKMARKS_FILENAME;
  a.click();
  URL.revokeObjectURL(url);
  return { ok: true, method: 'download' };
}

export async function importJsonFromPicker() {
  if (detectCapabilities().file) {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [
        {
          description: 'MarkNest JSON',
          accept: { 'application/json': ['.json'] }
        }
      ]
    });
    return readJsonFromFileHandle(handle);
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      try {
        const file = input.files?.[0];
        if (!file) return reject(new Error('CANCELLED'));
        const text = await file.text();
        const parsed = JSON.parse(text);
        const normalized = normalizeData(parsed);
        const check = validateData(normalized);
        if (!check.ok) {
          const e = new Error('JSON_INVALID');
          e.errors = check.errors;
          throw e;
        }
        resolve(normalized);
      } catch (err) {
        reject(err);
      }
    };
    input.click();
  });
}
