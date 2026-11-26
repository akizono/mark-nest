import {
  beginPopupSession,
  isPasswordEnabled,
  isUnlocked,
  unlock,
  verifyPassword
} from '../scripts/auth.js';
import { findFolder } from '../scripts/bookmarks.js';
import { CONFIG_KEYS, getConfig, setConfig } from '../scripts/config.js';
import { api, ensureAccess, getCached, refresh } from '../scripts/data-service.js';
import { mountFolderPicker } from '../scripts/folder-picker.js';
import { applyI18n, isRestrictedUrl, openExtensionPage, t } from '../scripts/utils.js';

const params = new URLSearchParams(location.search);
const gate = document.getElementById('gate');
const form = document.getElementById('form');
const titleInput = document.getElementById('title');
const urlInput = document.getElementById('url');
const folderPickerEl = document.getElementById('folderPicker');
const msg = document.getElementById('msg');

let folderPicker = null;

function showMsg(text, type = 'error') {
  msg.textContent = text;
  msg.className = `banner ${type === 'ok' ? 'ok' : 'error'}`;
  msg.classList.remove('hidden');
}

function mapError(err) {
  const code = err?.message;
  if (code === 'INVALID_URL') return t('restrictedUrl');
  if (code === 'PERMISSION_DENIED') return t('permissionDenied');
  if (err?.name === 'AbortError') return t('cancelled');
  return code || t('errorGeneric');
}

async function requireReady() {
  const cfg = await getConfig(['initialized']);
  if (!cfg.initialized) {
    gate.classList.remove('hidden');
    gate.innerHTML = `<p>${t('statusNone')}</p><button id="goSetup" class="primary">${t('openSetup')}</button>`;
    gate.querySelector('#goSetup').onclick = () => openExtensionPage('pages/setup.html');
    return false;
  }

  if (await isPasswordEnabled()) {
    // every_open: same as popup — force a fresh unlock for this page open
    await beginPopupSession();
    if (!(await isUnlocked())) {
      gate.classList.remove('hidden');
      gate.innerHTML = `
        <h2>${t('unlockTitle')}</h2>
        <div class="field"><label>${t('password')}</label>
          <input id="up" type="password" /></div>
        <p id="ue" class="banner error hidden"></p>
        <button id="ub" class="primary">${t('unlock')}</button>`;
      const tryUnlock = async () => {
        const ue = gate.querySelector('#ue');
        const pwd = gate.querySelector('#up').value;
        if (!pwd) {
          ue.textContent = t('passwordRequired');
          ue.classList.remove('hidden');
          return;
        }
        const ok = await verifyPassword(pwd);
        if (!ok) {
          ue.textContent = t('passwordWrong');
          ue.classList.remove('hidden');
          return;
        }
        await unlock();
        gate.classList.add('hidden');
        await showForm();
      };
      gate.querySelector('#ub').onclick = tryUnlock;
      gate.querySelector('#up').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') tryUnlock();
      });
      return false;
    }
  }
  return true;
}

async function showForm() {
  try {
    await ensureAccess();
  } catch (err) {
    gate.classList.remove('hidden');
    form.classList.add('hidden');
    gate.innerHTML = `<p class="banner error">${mapError(err)}</p>
      <button id="goOpt" class="primary">${t('settings')}</button>`;
    gate.querySelector('#goOpt').onclick = () => openExtensionPage('options/options.html');
    return;
  }

  await refresh();
  const data = getCached();
  const cfg = await getConfig([CONFIG_KEYS.lastSelectedFolderId]);
  let selected = cfg.lastSelectedFolderId || 'root';
  if (selected !== 'root' && !findFolder(data, selected)) {
    selected = 'root';
  }

  folderPicker = mountFolderPicker(folderPickerEl, data, {
    selectedId: selected,
    onChange: (id) => {
      setConfig({ [CONFIG_KEYS.lastSelectedFolderId]: id });
    }
  });

  const title = params.get('title') || '';
  const url = params.get('url') || '';
  titleInput.value = title;
  urlInput.value = url;

  if (isRestrictedUrl(url)) {
    showMsg(t('restrictedUrl'));
    document.getElementById('btnSave').disabled = true;
  }

  form.classList.remove('hidden');
}

document.getElementById('btnCancel').onclick = () => window.close();

document.getElementById('btnSave').onclick = async () => {
  msg.classList.add('hidden');
  const title = titleInput.value.trim();
  const url = urlInput.value.trim();
  const folderId = folderPicker?.getSelectedId() || 'root';
  if (isRestrictedUrl(url)) {
    showMsg(t('restrictedUrl'));
    return;
  }

  const btn = document.getElementById('btnSave');
  btn.disabled = true;
  try {
    const { saveMeta } = await api.createBookmark(folderId, { title, url });
    await setConfig({ [CONFIG_KEYS.lastSelectedFolderId]: folderId });
    try {
      await chrome.runtime.sendMessage({ type: 'BOOKMARKS_CHANGED' });
    } catch {
      // popup may already be closed
    }
    if (saveMeta?.needsExport) {
      showMsg(t('needsExport'), 'ok');
      setTimeout(() => window.close(), 1200);
      return;
    }
    window.close();
  } catch (err) {
    btn.disabled = false;
    showMsg(mapError(err));
  }
};

applyI18n();
(async () => {
  if (await requireReady()) await showForm();
})();
