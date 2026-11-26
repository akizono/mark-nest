import { setPassword, unlock } from '../scripts/auth.js';
import { STORAGE_MODES } from '../scripts/config.js';
import { setupDirectory, setupFile, setupManual } from '../scripts/data-service.js';
import { detectCapabilities } from '../scripts/file-manager.js';
import { applyI18n, openExtensionPage, t } from '../scripts/utils.js';

const stepStorage = document.getElementById('stepStorage');
const stepPassword = document.getElementById('stepPassword');
const stepDone = document.getElementById('stepDone');
const storageActions = document.getElementById('storageActions');
const storageError = document.getElementById('storageError');
const capInfo = document.getElementById('capInfo');
const pwdError = document.getElementById('pwdError');
const doneSummary = document.getElementById('doneSummary');

let chosenMode = null;

function showError(el, msg) {
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

function mapError(err) {
  if (err?.name === 'AbortError') return t('cancelled');
  const code = err?.message;
  if (code === 'PERMISSION_DENIED') return t('permissionDenied');
  if (code === 'DIRECTORY_UNSUPPORTED') return t('modeDirectory') + ' N/A';
  if (code === 'FILE_UNSUPPORTED') return t('modeFile') + ' N/A';
  return code || t('errorGeneric');
}

function renderActions() {
  const caps = detectCapabilities();
  capInfo.textContent = `directory: ${caps.directory ? 'OK' : 'N/A'} · file: ${caps.file ? 'OK' : 'N/A'} · manual: OK`;

  storageActions.replaceChildren();

  if (caps.directory) {
    const b = document.createElement('button');
    b.className = 'primary';
    b.textContent = t('chooseDirectory');
    b.onclick = async () => {
      showError(storageError, '');
      try {
        const r = await setupDirectory();
        chosenMode = r.mode;
        goPassword(r);
      } catch (err) {
        showError(storageError, mapError(err));
      }
    };
    storageActions.appendChild(b);
  }

  if (caps.file) {
    const createBtn = document.createElement('button');
    createBtn.textContent = t('createFile');
    createBtn.onclick = async () => {
      showError(storageError, '');
      try {
        const r = await setupFile(true);
        chosenMode = r.mode;
        goPassword(r);
      } catch (err) {
        showError(storageError, mapError(err));
      }
    };
    storageActions.appendChild(createBtn);

    const openBtn = document.createElement('button');
    openBtn.textContent = t('openFile');
    openBtn.onclick = async () => {
      showError(storageError, '');
      try {
        const r = await setupFile(false);
        chosenMode = r.mode;
        goPassword(r);
      } catch (err) {
        showError(storageError, mapError(err));
      }
    };
    storageActions.appendChild(openBtn);
  }

  const manualBtn = document.createElement('button');
  manualBtn.textContent = t('useManual');
  manualBtn.onclick = async () => {
    showError(storageError, '');
    try {
      const r = await setupManual();
      chosenMode = r.mode;
      goPassword(r);
    } catch (err) {
      showError(storageError, mapError(err));
    }
  };
  storageActions.appendChild(manualBtn);
}

function goPassword(result) {
  stepStorage.classList.add('hidden');
  stepPassword.classList.remove('hidden');
  doneSummary.dataset.displayName = result.displayName || '';
  doneSummary.dataset.mode = result.mode || '';
}

function finish() {
  stepPassword.classList.add('hidden');
  stepDone.classList.remove('hidden');
  const mode =
    chosenMode === STORAGE_MODES.DIRECTORY
      ? t('modeDirectory')
      : chosenMode === STORAGE_MODES.FILE
        ? t('modeFile')
        : t('modeManual');
  doneSummary.textContent = `${mode}${doneSummary.dataset.displayName ? ' · ' + doneSummary.dataset.displayName : ''}`;
  if (chosenMode === STORAGE_MODES.MANUAL) {
    const note = document.createElement('p');
    note.className = 'banner';
    note.textContent = t('manualModeBanner');
    stepDone.appendChild(note);
  }
}

document.getElementById('btnSkipPwd').onclick = async () => {
  await unlock();
  finish();
};

document.getElementById('btnSavePwd').onclick = async () => {
  showError(pwdError, '');
  const p1 = document.getElementById('pwd1').value;
  const p2 = document.getElementById('pwd2').value;
  if (p1.length < 4) {
    showError(pwdError, t('passwordTooShort'));
    return;
  }
  if (p1 !== p2) {
    showError(pwdError, t('passwordMismatch'));
    return;
  }
  try {
    await setPassword(p1);
    await unlock();
    finish();
  } catch (err) {
    showError(pwdError, mapError(err));
  }
};

document.getElementById('btnOpenOptions').onclick = () => openExtensionPage('options/options.html');

applyI18n();
renderActions();
