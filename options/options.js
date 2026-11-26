import {
  changePassword,
  disablePassword,
  getUnlockMode,
  isPasswordEnabled,
  isUnlocked,
  lock,
  resetPassword,
  setPassword,
  setUnlockMode,
  unlock,
  verifyPassword
} from '../scripts/auth.js';
import { CONFIG_KEYS, getConfig, setConfig, STORAGE_MODES, UNLOCK_MODES } from '../scripts/config.js';
import { api, ensureAccess, getStatus, refresh } from '../scripts/data-service.js';
import { detectCapabilities, reauthorize } from '../scripts/file-manager.js';
import { applyI18n, t } from '../scripts/utils.js';

const flash = document.getElementById('flash');
const settingsGate = document.getElementById('settingsGate');
let flashTimer = null;

/** Protected tabs require password when MarkNest password is enabled. */
const PROTECTED_TABS = new Set(['general', 'access', 'data']);

/** Shared unlock for the three protected settings tabs (this options page visit). */
let settingsAccessGranted = false;
let currentTab = 'general';

function showFlash(text, type = 'ok') {
  flash.textContent = text;
  flash.className = `banner ${type === 'ok' ? 'ok' : 'error'}`;
  flash.classList.remove('hidden');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    flash.classList.add('hidden');
    flash.textContent = '';
  }, type === 'error' ? 3200 : 1600);
}

function clearPwdFields() {
  document.getElementById('oldPwd').value = '';
  document.getElementById('newPwd').value = '';
  document.getElementById('newPwd2').value = '';
}

function showPwdError(msg) {
  const el = document.getElementById('pwdFormError');
  if (!msg) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.textContent = msg;
  el.classList.remove('hidden');
}

function mapError(err) {
  if (err?.name === 'AbortError') return t('cancelled');
  const code = err?.message;
  const map = {
    PASSWORD_WRONG: t('passwordWrong'),
    PASSWORD_TOO_SHORT: t('passwordTooShort'),
    CURRENT_PASSWORD_REQUIRED: t('currentPasswordRequired'),
    PERMISSION_DENIED: t('permissionDenied'),
    JSON_CORRUPT: t('corruptJson'),
    JSON_INVALID: t('corruptJson'),
    HANDLE_MISSING: t('handleMissingHint'),
    NOT_INITIALIZED: t('statusNone')
  };
  return map[code] || code || t('errorGeneric');
}

/**
 * Settings unlock follows MarkNest unlock policy:
 * - every_open: always require password when entering protected settings (this page visit).
 * - until_manual / browser_session: skip if MarkNest is already unlocked.
 */
async function resolveSettingsAccess() {
  if (!(await isPasswordEnabled())) {
    settingsAccessGranted = true;
    return true;
  }
  if (settingsAccessGranted) return true;

  const mode = await getUnlockMode();
  if (mode !== UNLOCK_MODES.EVERY_OPEN && (await isUnlocked())) {
    settingsAccessGranted = true;
    return true;
  }
  return false;
}

function setNavActive(tab) {
  document.querySelectorAll('.nav-item').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
}

async function showTab(tab) {
  currentTab = tab;
  setNavActive(tab);

  document.querySelectorAll('.tab').forEach((el) => el.classList.add('hidden'));

  const needsProtect = PROTECTED_TABS.has(tab);
  const allowed = !needsProtect || (await resolveSettingsAccess());

  if (needsProtect && !allowed) {
    settingsGate.classList.remove('hidden');
    document.getElementById('settingsGateError').classList.add('hidden');
    document.getElementById('settingsGatePwd').value = '';
    document.getElementById('gateResetPanel').classList.add('hidden');
    document.getElementById('gateResetPwd1').value = '';
    document.getElementById('gateResetPwd2').value = '';
    return;
  }

  settingsGate.classList.add('hidden');
  document.getElementById(`tab-${tab}`).classList.remove('hidden');

  if (tab === 'general') await refreshGeneral();
  if (tab === 'access') {
    await refreshPassword();
    await refreshUnlock();
  }
  if (tab === 'data') await refreshStats();
}

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    showTab(btn.dataset.tab);
  });
});

document.getElementById('btnSettingsUnlock').onclick = async () => {
  const errEl = document.getElementById('settingsGateError');
  errEl.classList.add('hidden');
  const pwd = document.getElementById('settingsGatePwd').value;
  if (!pwd) {
    errEl.textContent = t('passwordRequired');
    errEl.classList.remove('hidden');
    return;
  }
  const ok = await verifyPassword(pwd);
  if (!ok) {
    errEl.textContent = t('passwordWrong');
    errEl.classList.remove('hidden');
    return;
  }
  await unlock();
  settingsAccessGranted = true;
  document.getElementById('settingsGatePwd').value = '';
  await showTab(currentTab);
  showFlash(t('done'));
};

document.getElementById('settingsGatePwd').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('btnSettingsUnlock').click();
});

document.getElementById('btnGateForgot').onclick = () => {
  document.getElementById('gateResetPanel').classList.toggle('hidden');
  document.getElementById('settingsGateError').classList.add('hidden');
};

document.getElementById('btnGateReset').onclick = async () => {
  const errEl = document.getElementById('settingsGateError');
  errEl.classList.add('hidden');
  const p1 = document.getElementById('gateResetPwd1').value;
  const p2 = document.getElementById('gateResetPwd2').value;
  if (p1 && p1.length < 4) {
    errEl.textContent = t('passwordTooShort');
    errEl.classList.remove('hidden');
    return;
  }
  if (p1 && p1 !== p2) {
    errEl.textContent = t('passwordMismatch');
    errEl.classList.remove('hidden');
    return;
  }
  const confirmMsg = p1 ? t('resetPasswordConfirmSet') : t('resetPasswordConfirmClear');
  if (!window.confirm(confirmMsg)) return;
  try {
    await resetPassword(p1 || null);
    settingsAccessGranted = !(await isPasswordEnabled());
    document.getElementById('gateResetPwd1').value = '';
    document.getElementById('gateResetPwd2').value = '';
    document.getElementById('gateResetPanel').classList.add('hidden');
    showFlash(t('done'));
    await showTab(currentTab);
  } catch (err) {
    errEl.textContent = mapError(err);
    errEl.classList.remove('hidden');
  }
};

async function refreshGeneral() {
  const status = await getStatus();
  const caps = detectCapabilities();
  const isManual = status.mode === STORAGE_MODES.MANUAL;

  const modeLabel =
    status.mode === STORAGE_MODES.DIRECTORY
      ? t('modeDirectory')
      : status.mode === STORAGE_MODES.FILE
        ? t('modeFile')
        : isManual
          ? t('modeManual')
          : t('statusNone');

  document.getElementById('modeText').textContent = modeLabel;
  document.getElementById('pathText').textContent = status.displayName || '—';

  let state = t('statusReady');
  if (!status.initialized) state = t('statusNone');
  else if (status.needsReauth) state = t('statusNeedsAuth');
  else if (isManual) state = t('statusManual');
  const permLabel =
    status.permission === 'missing_handle'
      ? t('handleMissingHint')
      : status.permission === 'granted'
        ? t('statusReady')
        : t('statusNeedsAuth');
  document.getElementById('statusText').textContent = `${state} · ${permLabel}`;

  document.getElementById('manualWarn').classList.toggle('hidden', !isManual);
  document.getElementById('btnToManual').classList.toggle('hidden', isManual);
  document.getElementById('switchModeLabel').textContent = isManual
    ? t('switchBackToAutoHint')
    : t('switchModeHint');
  document.getElementById('switchModeHelp').textContent = isManual
    ? t('switchBackToAutoHelp')
    : t('setupCapabilities');

  document.getElementById('btnToDir').disabled = !caps.directory;
  document.getElementById('btnToFileNew').disabled = !caps.file;
  document.getElementById('btnToFileOpen').disabled = !caps.file;
  document.getElementById('btnReauth').disabled =
    status.mode !== STORAGE_MODES.DIRECTORY && status.mode !== STORAGE_MODES.FILE;

  const cfg = await getConfig([CONFIG_KEYS.showUrlInList]);
  document.getElementById('chkShowUrl').checked = !!cfg.showUrlInList;
}

async function refreshPassword() {
  const enabled = await isPasswordEnabled();
  document.getElementById('pwdState').textContent = enabled
    ? t('passwordProtectionOn')
    : t('passwordProtectionOff');
  document.getElementById('oldPwdField').classList.toggle('hidden', !enabled);
  document.getElementById('btnChangePwd').classList.toggle('hidden', !enabled);
  document.getElementById('btnDisablePwd').classList.toggle('hidden', !enabled);
  document.getElementById('btnSetPwd').classList.toggle('hidden', enabled);
  showPwdError('');
}

async function refreshUnlock() {
  const mode = await getUnlockMode();
  document.querySelectorAll('input[name="unlockMode"]').forEach((el) => {
    el.checked = el.value === mode;
  });
}

async function refreshStats() {
  try {
    const cfg = await getConfig(['initialized']);
    document.getElementById('btnImportChrome').disabled = !cfg.initialized;
    document.getElementById('btnExport').disabled = !cfg.initialized;
    document.getElementById('btnImport').disabled = !cfg.initialized;
    document.getElementById('btnIntegrity').disabled = !cfg.initialized;
    if (!cfg.initialized) {
      document.getElementById('statsText').textContent = t('statusNone');
      return;
    }
    await ensureAccess();
    await refresh();
    const s = api.stats();
    document.getElementById('statsText').textContent =
      `${t('foldersCount', [String(s.folders)])} · ${t('bookmarksCount', [String(s.bookmarks)])}`;
  } catch (err) {
    document.getElementById('statsText').textContent = mapError(err);
  }
}

document.getElementById('btnCheck').onclick = async () => {
  try {
    await refreshGeneral();
    showFlash(t('done'));
  } catch (err) {
    showFlash(mapError(err), 'error');
  }
};

document.getElementById('btnReauth').onclick = async () => {
  try {
    await reauthorize();
    await refreshGeneral();
    showFlash(t('done'));
  } catch (err) {
    showFlash(mapError(err), 'error');
  }
};

document.getElementById('btnLock').onclick = async () => {
  await lock();
  settingsAccessGranted = false;
  showFlash(t('done'));
  await showTab(currentTab);
};

document.getElementById('chkShowUrl').onchange = async (e) => {
  try {
    await setConfig({ [CONFIG_KEYS.showUrlInList]: !!e.target.checked });
    showFlash(t('saved'));
  } catch (err) {
    showFlash(mapError(err), 'error');
  }
};

async function switchMode(mode, options) {
  try {
    const cfg = await getConfig(['initialized']);
    if (!cfg.initialized) {
      showFlash(t('statusNone'), 'error');
      return;
    }
    try {
      await ensureAccess();
    } catch {
      await refresh().catch(() => {});
    }
    await api.changeStorageMode(mode, options);
    await refreshGeneral();
    await refreshStats();
    showFlash(t('saved'));
  } catch (err) {
    showFlash(mapError(err), 'error');
  }
}

document.getElementById('btnToDir').onclick = () => {
  if (!window.confirm(t('switchOverwriteConfirm'))) return;
  switchMode(STORAGE_MODES.DIRECTORY);
};
document.getElementById('btnToFileNew').onclick = () => {
  if (!window.confirm(t('switchOverwriteConfirm'))) return;
  switchMode(STORAGE_MODES.FILE, { createNew: true });
};
document.getElementById('btnToFileOpen').onclick = () => {
  if (!window.confirm(t('switchOverwriteConfirm'))) return;
  switchMode(STORAGE_MODES.FILE, { createNew: false });
};
document.getElementById('btnToManual').onclick = () => {
  if (!window.confirm(t('switchToManualConfirm'))) return;
  switchMode(STORAGE_MODES.MANUAL);
};

document.getElementById('btnSetPwd').onclick = async () => {
  showPwdError('');
  const p1 = document.getElementById('newPwd').value;
  const p2 = document.getElementById('newPwd2').value;
  if (!p1) return showPwdError(t('passwordRequired'));
  if (p1.length < 4) return showPwdError(t('passwordTooShort'));
  if (p1 !== p2) return showPwdError(t('passwordMismatch'));
  try {
    await setPassword(p1);
    await unlock();
    settingsAccessGranted = true;
    clearPwdFields();
    await refreshPassword();
    showFlash(t('saved'));
  } catch (err) {
    showPwdError(mapError(err));
  }
};

document.getElementById('btnChangePwd').onclick = async () => {
  showPwdError('');
  const oldP = document.getElementById('oldPwd').value;
  const p1 = document.getElementById('newPwd').value;
  const p2 = document.getElementById('newPwd2').value;
  if (!oldP) return showPwdError(t('currentPasswordRequired'));
  if (!p1) return showPwdError(t('passwordRequired'));
  if (p1.length < 4) return showPwdError(t('passwordTooShort'));
  if (p1 !== p2) return showPwdError(t('passwordMismatch'));
  try {
    await changePassword(oldP, p1);
    clearPwdFields();
    showFlash(t('saved'));
  } catch (err) {
    showPwdError(mapError(err));
  }
};

document.getElementById('btnDisablePwd').onclick = async () => {
  showPwdError('');
  const oldP = document.getElementById('oldPwd').value;
  if (!oldP) {
    showPwdError(t('currentPasswordRequired'));
    return;
  }
  try {
    await disablePassword(oldP);
    settingsAccessGranted = true;
    clearPwdFields();
    await refreshPassword();
    showFlash(t('saved'));
  } catch (err) {
    showPwdError(mapError(err));
  }
};

document.getElementById('btnResetPwd').onclick = async () => {
  showPwdError('');
  const p1 = document.getElementById('newPwd').value;
  const p2 = document.getElementById('newPwd2').value;
  if (p1 && p1.length < 4) return showPwdError(t('passwordTooShort'));
  if (p1 && p1 !== p2) return showPwdError(t('passwordMismatch'));
  const confirmMsg = p1 ? t('resetPasswordConfirmSet') : t('resetPasswordConfirmClear');
  if (!window.confirm(confirmMsg)) return;
  try {
    await resetPassword(p1 || null);
    // Reset locks MarkNest; require settings unlock again if a password remains.
    settingsAccessGranted = !(await isPasswordEnabled());
    clearPwdFields();
    await refreshPassword();
    showFlash(t('done'));
    await showTab(currentTab);
  } catch (err) {
    showPwdError(mapError(err));
  }
};

document.getElementById('btnSaveUnlock').onclick = async () => {
  const selected = document.querySelector('input[name="unlockMode"]:checked')?.value;
  if (!Object.values(UNLOCK_MODES).includes(selected)) return;
  try {
    await setUnlockMode(selected);
    // setUnlockMode locks; for every_open must re-enter; for others need unlock again.
    settingsAccessGranted = false;
    showFlash(t('saved'));
    await showTab(currentTab);
  } catch (err) {
    showFlash(mapError(err), 'error');
  }
};

document.getElementById('btnExport').onclick = async () => {
  try {
    await ensureAccess();
    await api.exportData();
    showFlash(t('saved'));
  } catch (err) {
    showFlash(mapError(err), 'error');
  }
};

document.getElementById('btnImport').onclick = async () => {
  try {
    await ensureAccess();
    const { stats, saveMeta } = await api.importMerge();
    await refreshStats();
    const detail = `+folders ${stats.addedFolders}, +bookmarks ${stats.addedBookmarks}${
      stats.skippedInvalidUrl ? `, skipInvalid ${stats.skippedInvalidUrl}` : ''
    }, remap ${stats.remappedIds}`;
    showFlash(`${t('importDone')} ${detail}${saveMeta?.needsExport ? ' · ' + t('needsExport') : ''}`);
  } catch (err) {
    showFlash(mapError(err), 'error');
  }
};

document.getElementById('btnImportChrome').onclick = async () => {
  const cfg = await getConfig(['initialized']);
  if (!cfg.initialized) {
    showFlash(t('statusNone'), 'error');
    return;
  }
  chrome.runtime.sendMessage({ type: 'OPEN_IMPORT_CHROME' }).catch(() => {
    const url = chrome.runtime.getURL('pages/import-chrome.html');
    chrome.tabs.create({ url });
  });
};

document.getElementById('btnIntegrity').onclick = async () => {
  try {
    await ensureAccess();
    const result = await api.checkIntegrity();
    const out = document.getElementById('integrityOut');
    out.classList.remove('hidden');
    if (result.ok) {
      out.textContent = t('integrityOk');
      showFlash(t('integrityOk'));
    } else {
      out.textContent = result.errors.join('\n');
      showFlash(t('integrityFail'), 'error');
    }
  } catch (err) {
    showFlash(mapError(err), 'error');
  }
};

applyI18n();
(async () => {
  await showTab('general');
})();
