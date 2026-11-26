/**
 * Password access control (not encryption).
 * Uses Web Crypto PBKDF2 + random salt.
 */

import { clearPasswordConfig, getConfig, setConfig, UNLOCK_MODES } from './config.js';

const ITERATIONS = 120000;
const HASH_BITS = 256;

function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  bytes.forEach((b) => {
    s += String.fromCharCode(b);
  });
  return btoa(s);
}

function base64ToBuffer(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

async function deriveHash(password, saltBuffer) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    HASH_BITS
  );
  return bufferToBase64(bits);
}

export async function setPassword(password) {
  if (!password || password.length < 4) {
    throw new Error('PASSWORD_TOO_SHORT');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveHash(password, salt.buffer);
  await setConfig({
    passwordEnabled: true,
    passwordSalt: bufferToBase64(salt.buffer),
    passwordHash: hash
  });
}

export async function verifyPassword(password) {
  const cfg = await getConfig(['passwordEnabled', 'passwordSalt', 'passwordHash']);
  if (!cfg.passwordEnabled) return true;
  if (!cfg.passwordSalt || !cfg.passwordHash) return false;
  const hash = await deriveHash(password, base64ToBuffer(cfg.passwordSalt));
  return hash === cfg.passwordHash;
}

export async function changePassword(oldPassword, newPassword) {
  if (!oldPassword) throw new Error('CURRENT_PASSWORD_REQUIRED');
  const ok = await verifyPassword(oldPassword);
  if (!ok) throw new Error('PASSWORD_WRONG');
  await setPassword(newPassword);
}

export async function disablePassword(currentPassword) {
  if (!currentPassword) throw new Error('CURRENT_PASSWORD_REQUIRED');
  const ok = await verifyPassword(currentPassword);
  if (!ok) throw new Error('PASSWORD_WRONG');
  await clearPasswordConfig();
  await lock();
}

/** Reset without old password — intentional access-control weakness. */
export async function resetPassword(newPassword) {
  await clearPasswordConfig();
  if (newPassword) {
    await setPassword(newPassword);
  }
  await lock();
}

export async function isPasswordEnabled() {
  const cfg = await getConfig(['passwordEnabled']);
  return !!cfg.passwordEnabled;
}

export async function getUnlockMode() {
  const cfg = await getConfig(['unlockMode']);
  return cfg.unlockMode || UNLOCK_MODES.BROWSER_SESSION;
}

export async function setUnlockMode(mode) {
  if (!Object.values(UNLOCK_MODES).includes(mode)) {
    throw new Error('INVALID_UNLOCK_MODE');
  }
  await setConfig({ unlockMode: mode });
  // Changing mode should re-lock for safety.
  await lock();
}

const SESSION_UNLOCK_KEY = 'marknest_unlocked';
const LOCAL_UNLOCK_KEY = 'marknest_unlocked_persistent';

export async function unlock() {
  const mode = await getUnlockMode();
  if (mode === UNLOCK_MODES.UNTIL_MANUAL) {
    await chrome.storage.local.set({ [LOCAL_UNLOCK_KEY]: true });
    await chrome.storage.session.set({ [SESSION_UNLOCK_KEY]: true });
  } else if (mode === UNLOCK_MODES.BROWSER_SESSION) {
    await chrome.storage.session.set({ [SESSION_UNLOCK_KEY]: true });
  } else {
    // every_open: session flag only lasts until the next popup open (beginPopupSession)
    // or unload clearEphemeralUnlock.
    await chrome.storage.session.set({ [SESSION_UNLOCK_KEY]: true });
  }
}

export async function lock() {
  await chrome.storage.session.remove([SESSION_UNLOCK_KEY, 'marknest_unlock_once']);
  await chrome.storage.local.remove([LOCAL_UNLOCK_KEY]);
}

export async function isUnlocked() {
  const enabled = await isPasswordEnabled();
  if (!enabled) return true;

  const mode = await getUnlockMode();

  if (mode === UNLOCK_MODES.EVERY_OPEN) {
    const s = await chrome.storage.session.get([SESSION_UNLOCK_KEY]);
    return !!s[SESSION_UNLOCK_KEY];
  }

  if (mode === UNLOCK_MODES.UNTIL_MANUAL) {
    const local = await chrome.storage.local.get([LOCAL_UNLOCK_KEY]);
    return !!local[LOCAL_UNLOCK_KEY];
  }

  // browser_session
  const s = await chrome.storage.session.get([SESSION_UNLOCK_KEY]);
  return !!s[SESSION_UNLOCK_KEY];
}

/**
 * Call once when the popup opens. For every_open, force a fresh lock so the user
 * must enter the password every time the popup is opened (Chrome may skip unload).
 */
export async function beginPopupSession() {
  const mode = await getUnlockMode();
  if (mode === UNLOCK_MODES.EVERY_OPEN) {
    await chrome.storage.session.remove([SESSION_UNLOCK_KEY, 'marknest_unlock_once']);
  }
}

/** Called on browser startup for mode browser_session. */
export async function onBrowserStartup() {
  const mode = await getUnlockMode();
  if (mode === UNLOCK_MODES.BROWSER_SESSION || mode === UNLOCK_MODES.EVERY_OPEN) {
    await chrome.storage.session.remove([SESSION_UNLOCK_KEY, 'marknest_unlock_once']);
  }
  // UNTIL_MANUAL: keep local unlock flag across restarts.
}

/** Popup unload for every_open mode. */
export async function clearEphemeralUnlock() {
  const mode = await getUnlockMode();
  if (mode === UNLOCK_MODES.EVERY_OPEN) {
    await chrome.storage.session.remove([SESSION_UNLOCK_KEY, 'marknest_unlock_once']);
  }
}
