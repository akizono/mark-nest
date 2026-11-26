/**
 * Local configuration (NOT bookmark data).
 * Password hashes, unlock policy, storage mode metadata live here.
 */

const KEYS = {
  initialized: 'initialized',
  passwordEnabled: 'passwordEnabled',
  passwordSalt: 'passwordSalt',
  passwordHash: 'passwordHash',
  unlockMode: 'unlockMode', // every_open | until_manual | browser_session
  storageMode: 'storageMode', // directory | file | manual
  storageDisplayName: 'storageDisplayName',
  pendingData: 'pendingData', // only for unsaved edits in manual mode / mode switch
  lastSelectedFolderId: 'lastSelectedFolderId',
  pendingDiskSync: 'pendingDiskSync', // crash/close safety buffer until JSON write finishes
  showUrlInList: 'showUrlInList', // popup list shows URL when true; default false
  stats: 'stats'
};

export const UNLOCK_MODES = {
  EVERY_OPEN: 'every_open',
  UNTIL_MANUAL: 'until_manual',
  BROWSER_SESSION: 'browser_session'
};

export const STORAGE_MODES = {
  DIRECTORY: 'directory',
  FILE: 'file',
  MANUAL: 'manual',
  NONE: 'none'
};

const DEFAULTS = {
  [KEYS.initialized]: false,
  [KEYS.passwordEnabled]: false,
  [KEYS.passwordSalt]: null,
  [KEYS.passwordHash]: null,
  [KEYS.unlockMode]: UNLOCK_MODES.BROWSER_SESSION,
  [KEYS.storageMode]: STORAGE_MODES.NONE,
  [KEYS.storageDisplayName]: '',
  [KEYS.pendingData]: null,
  [KEYS.lastSelectedFolderId]: 'root',
  [KEYS.pendingDiskSync]: null,
  [KEYS.showUrlInList]: false
};

export async function getConfig(keys = Object.values(KEYS)) {
  const result = await chrome.storage.local.get(keys);
  const out = { ...DEFAULTS };
  for (const k of keys) {
    if (result[k] !== undefined) out[k] = result[k];
  }
  return out;
}

export async function setConfig(partial) {
  await chrome.storage.local.set(partial);
}

export async function clearPasswordConfig() {
  await chrome.storage.local.set({
    [KEYS.passwordEnabled]: false,
    [KEYS.passwordSalt]: null,
    [KEYS.passwordHash]: null
  });
}

export { KEYS as CONFIG_KEYS };
