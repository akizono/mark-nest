import {
  countSelection,
  getChromeBookmarkTree,
  selectionToMarkNestPayload
} from '../scripts/chrome-bookmarks.js';
import { CONFIG_KEYS, getConfig, setConfig } from '../scripts/config.js';
import { findFolder } from '../scripts/bookmarks.js';
import { api, ensureAccess, getCached, refresh } from '../scripts/data-service.js';
import { mountFolderPicker } from '../scripts/folder-picker.js';
import { applyI18n, escapeHtml, t } from '../scripts/utils.js';

const treeEl = document.getElementById('tree');
const targetPickerEl = document.getElementById('targetPicker');
const msg = document.getElementById('msg');
const selCount = document.getElementById('selCount');
const btnImport = document.getElementById('btnImport');

/** @type {Set<string>} */
const selected = new Set();
/** @type {object[]} */
let tree = [];
const expanded = new Set();
/** @type {{ getSelectedId: () => string } | null} */
let targetPicker = null;
let targetFolderId = 'root';

function showMsg(text, type = 'error') {
  msg.textContent = text;
  msg.className = `banner ${type === 'ok' ? 'ok' : 'error'}`;
  msg.classList.remove('hidden');
}

function mapError(err) {
  if (err?.name === 'AbortError') return t('cancelled');
  const code = err?.message;
  if (code === 'PERMISSION_DENIED') return t('permissionDenied');
  if (code === 'NOT_INITIALIZED') return t('statusNone');
  if (code === 'FOLDER_NOT_FOUND') return t('folderNotFound');
  return code || t('errorGeneric');
}

function collectAllIds(nodes, out = []) {
  for (const n of nodes || []) {
    out.push(n.id);
    if (n.children) collectAllIds(n.children, out);
  }
  return out;
}

function updateCount() {
  const c = countSelection(tree, [...selected]);
  selCount.textContent = `${t('foldersCount', [String(c.folders)])} · ${t('bookmarksCount', [String(c.bookmarks)])}`;
  btnImport.disabled = c.folders + c.bookmarks === 0;
}

function render() {
  treeEl.replaceChildren();
  const addNode = (node, depth) => {
    const row = document.createElement('label');
    row.className = 'chrome-row';
    const isFolder = !node.url;
    const hasKids = isFolder && (node.children || []).length > 0;
    const open = expanded.has(node.id);

    row.innerHTML = `
      <span class="pad" style="width:${depth * 14}px"></span>
      ${
        hasKids
          ? `<button type="button" class="ghost twist" data-twist="${escapeHtml(node.id)}" aria-label="toggle">${open ? '▾' : '▸'}</button>`
          : `<span class="pad" style="width:22px"></span>`
      }
      <input type="checkbox" data-id="${escapeHtml(node.id)}" ${selected.has(node.id) ? 'checked' : ''} />
      <span class="meta">
        <div>${escapeHtml(node.title)}</div>
        ${node.url ? `<div class="url">${escapeHtml(node.url)}</div>` : ''}
      </span>`;

    const cb = row.querySelector('input[type="checkbox"]');
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(node.id);
      else selected.delete(node.id);
      updateCount();
    });

    const twist = row.querySelector('[data-twist]');
    if (twist) {
      twist.addEventListener('click', (e) => {
        e.preventDefault();
        if (expanded.has(node.id)) expanded.delete(node.id);
        else expanded.add(node.id);
        render();
      });
    }

    treeEl.appendChild(row);

    if (isFolder && open) {
      (node.children || []).forEach((c) => addNode(c, depth + 1));
    }
  };

  tree.forEach((n) => addNode(n, 0));
  updateCount();
}

async function mountTargetPicker() {
  await ensureAccess();
  await refresh();
  const data = getCached();
  const cfg = await getConfig([CONFIG_KEYS.lastSelectedFolderId]);
  let selectedId = cfg.lastSelectedFolderId || 'root';
  if (selectedId !== 'root' && !findFolder(data, selectedId)) selectedId = 'root';
  targetFolderId = selectedId;
  targetPicker = mountFolderPicker(targetPickerEl, data, {
    selectedId,
    onChange: (id) => {
      targetFolderId = id;
      setConfig({ [CONFIG_KEYS.lastSelectedFolderId]: id });
    }
  });
}

document.getElementById('btnSelectAll').onclick = () => {
  collectAllIds(tree).forEach((id) => selected.add(id));
  render();
};

document.getElementById('btnClear').onclick = () => {
  selected.clear();
  render();
};

document.getElementById('btnClose').onclick = () => window.close();

document.getElementById('btnImport').onclick = async () => {
  msg.classList.add('hidden');
  btnImport.disabled = true;
  try {
    const cfg = await getConfig(['initialized']);
    if (!cfg.initialized) {
      showMsg(t('statusNone'));
      return;
    }
    await ensureAccess();
    await refresh();
    const payload = selectionToMarkNestPayload(tree, [...selected]);
    if (!payload.folders.length && !payload.rootBookmarks.length) {
      showMsg(t('importChromeEmpty'));
      return;
    }
    const dest = targetPicker?.getSelectedId?.() || targetFolderId || 'root';
    const { stats, saveMeta } = await api.importMergePayload(payload, {
      targetFolderId: dest
    });
    await setConfig({ [CONFIG_KEYS.lastSelectedFolderId]: dest });
    const detail = `+folders ${stats.addedFolders}, +bookmarks ${stats.addedBookmarks}${
      stats.skippedInvalidUrl ? `, skipInvalid ${stats.skippedInvalidUrl}` : ''
    }`;
    showMsg(`${t('importDone')} ${detail}${saveMeta?.needsExport ? ' · ' + t('needsExport') : ''}`, 'ok');
    selected.clear();
    await mountTargetPicker();
    render();
  } catch (err) {
    showMsg(mapError(err));
  } finally {
    updateCount();
  }
};

function findAndFocus(nodes, focusId, parents = []) {
  for (const n of nodes || []) {
    if (n.id === focusId) {
      parents.forEach((id) => expanded.add(id));
      expanded.add(n.id);
      selected.add(n.id);
      return true;
    }
    if (n.children && findAndFocus(n.children, focusId, [...parents, n.id])) return true;
  }
  return false;
}

applyI18n();
(async () => {
  try {
    const cfg = await getConfig(['initialized']);
    if (!cfg.initialized) {
      showMsg(t('statusNone'));
      btnImport.disabled = true;
      return;
    }
    await mountTargetPicker();
    tree = await getChromeBookmarkTree();
    tree.forEach((n) => expanded.add(n.id));
    const focus = new URLSearchParams(location.search).get('focus');
    if (focus) findAndFocus(tree, focus);
    render();
  } catch (err) {
    showMsg(mapError(err));
    btnImport.disabled = true;
  }
})();
