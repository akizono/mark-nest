import {
  beginPopupSession,
  clearEphemeralUnlock,
  isPasswordEnabled,
  isUnlocked,
  lock,
  unlock,
  verifyPassword
} from '../scripts/auth.js';
import { CONFIG_KEYS, getConfig, setConfig, STORAGE_MODES } from '../scripts/config.js';
import {
  api,
  getCached,
  getStatus,
  refresh,
  setupDirectory,
  setupFile,
  setupManual
} from '../scripts/data-service.js';
import { findFolder, findFolderParent, getSortedChildren } from '../scripts/bookmarks.js';
import { detectCapabilities, reauthorize } from '../scripts/file-manager.js';
import { mountFolderPicker } from '../scripts/folder-picker.js';
import {
  applyI18n,
  escapeHtml,
  faviconUrl,
  openExtensionPage,
  t,
  truncate
} from '../scripts/utils.js';

const els = {
  gate: document.getElementById('viewGate'),
  unlock: document.getElementById('viewUnlock'),
  main: document.getElementById('viewMain'),
  gateMessage: document.getElementById('gateMessage'),
  unlockPassword: document.getElementById('unlockPassword'),
  unlockError: document.getElementById('unlockError'),
  btnUnlock: document.getElementById('btnUnlock'),
  tree: document.getElementById('tree'),
  searchResults: document.getElementById('searchResults'),
  searchInput: document.getElementById('searchInput'),
  statusText: document.getElementById('statusText'),
  btnLock: document.getElementById('btnLock'),
  btnSettings: document.getElementById('btnSettings'),
  btnAdd: document.getElementById('btnAdd'),
  btnNewFolder: document.getElementById('btnNewFolder'),
  btnRefresh: document.getElementById('btnRefresh'),
  btnBatch: document.getElementById('btnBatch'),
  batchBar: document.getElementById('batchBar'),
  chkSelectAll: document.getElementById('chkSelectAll'),
  batchCount: document.getElementById('batchCount'),
  btnBatchDelete: document.getElementById('btnBatchDelete'),
  btnBatchDone: document.getElementById('btnBatchDone'),
  manualBanner: document.getElementById('manualBanner'),
  dialogRoot: document.getElementById('dialogRoot')
};

const expanded = new Set();
let currentStatus = null;
let ephemeralWatch = false;
let batchMode = false;
let showUrlInList = false;
const selectedBookmarkIds = new Set();
/** @type {{ type: 'folder'|'bookmark', id: string } | null} */
let dragItem = null;
/** @type {{ targetType: 'folder'|'bookmark', targetId: string, parentId: string, mode: 'before'|'after'|'into' } | null} */
let dropHint = null;

function showOnly(view) {
  els.gate.classList.toggle('hidden', view !== 'gate');
  els.unlock.classList.toggle('hidden', view !== 'unlock');
  els.main.classList.toggle('hidden', view !== 'main');
  // Lock button only belongs on the unlocked main view.
  if (view !== 'main') els.btnLock.classList.add('hidden');
}

function toastError(msg) {
  els.statusText.textContent = msg;
  els.statusText.style.color = 'var(--danger)';
  setTimeout(() => {
    els.statusText.style.color = '';
    updateStatusBar();
  }, 3500);
}

function toastOk(msg) {
  els.statusText.textContent = msg;
  els.statusText.style.color = 'var(--ok)';
  setTimeout(() => {
    els.statusText.style.color = '';
    updateStatusBar();
  }, 2500);
}

function updateStatusBar() {
  if (!currentStatus) {
    els.statusText.textContent = '';
    return;
  }
  const modeLabel =
    currentStatus.mode === STORAGE_MODES.DIRECTORY
      ? t('modeDirectory')
      : currentStatus.mode === STORAGE_MODES.FILE
        ? t('modeFile')
        : currentStatus.mode === STORAGE_MODES.MANUAL
          ? t('modeManual')
          : t('statusNone');

  let state = t('statusReady');
  if (currentStatus.needsReauth) state = t('statusNeedsAuth');
  if (currentStatus.mode === STORAGE_MODES.MANUAL) state = t('statusManual');

  const name = currentStatus.displayName ? ` · ${currentStatus.displayName}` : '';
  els.statusText.textContent = `${modeLabel}${name} · ${state}`;
  els.manualBanner.classList.toggle('hidden', currentStatus.mode !== STORAGE_MODES.MANUAL);
}

function openDialog({ title, bodyHtml, actions, onMount }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'dialog-backdrop';
  backdrop.innerHTML = `
    <div class="dialog" role="dialog">
      <h3>${escapeHtml(title)}</h3>
      <div class="dialog-body">${bodyHtml}</div>
      <div class="actions"></div>
    </div>`;
  const actionsEl = backdrop.querySelector('.actions');
  const ctx = {};
  actions.forEach((a) => {
    const btn = document.createElement('button');
    btn.textContent = a.label;
    if (a.primary) btn.classList.add('primary');
    if (a.danger) btn.classList.add('danger');
    btn.addEventListener('click', async () => {
      try {
        await a.onClick?.(backdrop, ctx);
        if (!a.keepOpen) backdrop.remove();
      } catch (err) {
        toastError(mapError(err));
      }
    });
    actionsEl.appendChild(btn);
  });
  els.dialogRoot.replaceChildren(backdrop);
  onMount?.(backdrop, ctx);
  return backdrop;
}

function mapError(err) {
  const code = err?.message || String(err);
  const map = {
    PASSWORD_WRONG: t('passwordWrong'),
    PASSWORD_TOO_SHORT: t('passwordTooShort'),
    INVALID_URL: t('restrictedUrl'),
    PERMISSION_DENIED: t('permissionDenied'),
    JSON_CORRUPT: t('corruptJson'),
    JSON_INVALID: t('corruptJson'),
    HANDLE_MISSING: t('handleMissingHint'),
    INVALID_MOVE: t('invalidMove'),
    INVALID_MOVE_DESCENDANT: t('invalidMove'),
    FOLDER_NOT_FOUND: t('folderNotFound'),
    PARENT_NOT_FOUND: t('folderNotFound'),
    BOOKMARK_NOT_FOUND: t('bookmarkNotFound'),
    NAME_REQUIRED: t('nameRequired'),
    AbortError: t('cancelled')
  };
  if (err?.name === 'AbortError') return t('cancelled');
  return map[code] || code || t('errorGeneric');
}

function expandFolderPath(folderId) {
  const data = getCached();
  if (!data || !folderId || folderId === 'root') return;
  let curId = folderId;
  while (curId && curId !== 'root') {
    expanded.add(curId);
    const parent = findFolderParent(data, curId);
    if (!parent) break;
    curId = parent.id;
  }
}

function handleSaveMeta(saveMeta) {
  if (saveMeta?.needsExport) toastOk(t('needsExport'));
  // Skip success toast for optimistic updates (drag etc.) to avoid laggy feedback noise.
  else if (saveMeta?.saved && !saveMeta?.optimistic) toastOk(t('saved'));
}

function collectAllBookmarkIds(data) {
  const ids = [];
  (data.rootBookmarks || []).forEach((b) => ids.push(b.id));
  const stack = [...(data.folders || [])];
  while (stack.length) {
    const f = stack.pop();
    (f.bookmarks || []).forEach((b) => ids.push(b.id));
    (f.folders || []).forEach((c) => stack.push(c));
  }
  return ids;
}

/** Bookmarks in this folder and all nested subfolders. */
function collectBookmarkIdsInFolder(folder) {
  const ids = [];
  const stack = [folder];
  while (stack.length) {
    const f = stack.pop();
    (f.bookmarks || []).forEach((b) => ids.push(b.id));
    (f.folders || []).forEach((c) => stack.push(c));
  }
  return ids;
}

function folderSelectionState(folder) {
  const ids = collectBookmarkIdsInFolder(folder);
  if (!ids.length) return { checked: false, indeterminate: false, ids };
  const selected = ids.filter((id) => selectedBookmarkIds.has(id)).length;
  return {
    ids,
    checked: selected === ids.length,
    indeterminate: selected > 0 && selected < ids.length
  };
}

function updateBatchCount() {
  els.batchCount.textContent = t('batchSelected', [String(selectedBookmarkIds.size)]);
  const data = getCached();
  const all = data ? collectAllBookmarkIds(data) : [];
  els.chkSelectAll.checked = all.length > 0 && all.every((id) => selectedBookmarkIds.has(id));
  els.chkSelectAll.indeterminate =
    selectedBookmarkIds.size > 0 && !els.chkSelectAll.checked;

  // Sync folder checkboxes without full re-render.
  els.tree.querySelectorAll('.folder-row[data-folder-id]').forEach((row) => {
    const chk = row.querySelector('.batch-folder-check');
    if (!chk) return;
    const folder = findFolder(data, row.dataset.folderId);
    if (!folder) return;
    const state = folderSelectionState(folder);
    chk.checked = state.checked;
    chk.indeterminate = state.indeterminate;
    chk.disabled = state.ids.length === 0;
  });
}

function setBatchMode(on) {
  batchMode = on;
  if (!on) selectedBookmarkIds.clear();
  els.batchBar.classList.toggle('hidden', !on);
  els.btnBatch.classList.toggle('primary', on);
  renderTree();
  if (on) updateBatchCount();
}

function renderBookmarkRow(b, folderId) {
  const row = document.createElement('div');
  row.className = 'tree-item bookmark-row';
  row.dataset.bookmarkId = b.id;

  const checkHtml = batchMode
    ? `<input type="checkbox" class="batch-check" ${selectedBookmarkIds.has(b.id) ? 'checked' : ''} />`
    : '';

  const urlHtml = showUrlInList
    ? `<span class="url">${escapeHtml(truncate(b.url, 28))}</span>`
    : '';
  row.innerHTML = `
    ${checkHtml}
    <img class="fav" alt="" src="${escapeHtml(faviconUrl(b.url))}" />
    <div class="item-meta">
      <div class="title">${escapeHtml(b.title)}</div>
    </div>
    ${urlHtml}
  `;
  row.querySelector('img.fav').addEventListener('error', (e) => {
    e.target.src = chrome.runtime.getURL('assets/icons/icon16.png');
  });

  if (batchMode) {
    const chk = row.querySelector('.batch-check');
    const toggle = () => {
      if (selectedBookmarkIds.has(b.id)) selectedBookmarkIds.delete(b.id);
      else selectedBookmarkIds.add(b.id);
      chk.checked = selectedBookmarkIds.has(b.id);
      updateBatchCount();
    };
    chk.addEventListener('click', (e) => e.stopPropagation());
    chk.addEventListener('change', toggle);
    row.addEventListener('click', (e) => {
      if (e.target === chk) return;
      toggle();
    });
  } else {
    row.addEventListener('click', (e) => {
      if (dragItem) return;
      const openNew = e.ctrlKey || e.metaKey;
      if (openNew) chrome.tabs.create({ url: b.url });
      else chrome.tabs.update({ url: b.url });
    });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showItemMenu(e.clientX, e.clientY, { type: 'bookmark', id: b.id, folderId });
    });
    bindRowDrag(row, { type: 'bookmark', id: b.id, parentId: folderId });
  }
  return row;
}

function clearDropHints() {
  els.tree.querySelectorAll('.drop-before, .drop-after, .drop-into').forEach((el) => {
    el.classList.remove('drop-before', 'drop-after', 'drop-into');
  });
  dropHint = null;
}

function bindRowDrag(el, item) {
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    if (e.target.closest('.more')) {
      e.preventDefault();
      return;
    }
    dragItem = { type: item.type, id: item.id };
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', `${item.type}:${item.id}`);
  });
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging');
    dragItem = null;
    clearDropHints();
  });

  el.addEventListener('dragover', (e) => {
    if (!dragItem) return;
    if (dragItem.type === item.type && dragItem.id === item.id) return;
    // Folder cannot nest into a bookmark
    if (dragItem.type === 'folder' && item.type === 'bookmark') {
      // allow before/after only relative to bookmark's parent folder list — treat as sibling level for folders
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = el.getBoundingClientRect();
    const ratio = (e.clientY - rect.top) / rect.height;
    clearDropHints();
    let mode = 'into';
    if (item.type === 'bookmark') {
      mode = ratio < 0.5 ? 'before' : 'after';
    } else if (ratio < 0.25) mode = 'before';
    else if (ratio > 0.75) mode = 'after';
    // folder→bookmark: only before/after (same parent), not into
    if (dragItem.type === 'folder' && item.type === 'bookmark') {
      mode = ratio < 0.5 ? 'before' : 'after';
    }
    el.classList.add(`drop-${mode}`);
    dropHint = {
      targetType: item.type,
      targetId: item.id,
      parentId: item.parentId,
      mode
    };
  });

  el.addEventListener('dragleave', () => {
    el.classList.remove('drop-before', 'drop-after', 'drop-into');
  });

  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const source = dragItem;
    const hint = dropHint;
    clearDropHints();
    if (!source || !hint) return;
    if (source.type === hint.targetType && source.id === hint.targetId) return;
    try {
      await applyDrop(source, hint);
    } catch (err) {
      toastError(mapError(err));
    }
  });
}

async function applyDrop(source, hint) {
  const data = getCached();

  if (source.type === 'folder') {
    let newParentId;
    let beforeFolderId = null;

    if (hint.targetType === 'folder') {
      const targetParent = findFolderParent(data, hint.targetId);
      const targetParentId = targetParent ? targetParent.id : 'root';
      const siblings =
        targetParentId === 'root'
          ? getSortedChildren('root', data).folders
          : getSortedChildren(findFolder(data, targetParentId), null).folders;
      const targetIndex = siblings.findIndex((f) => f.id === hint.targetId);

      if (hint.mode === 'into') {
        newParentId = hint.targetId;
        beforeFolderId = null;
        expanded.add(hint.targetId);
      } else if (hint.mode === 'before') {
        newParentId = targetParentId;
        beforeFolderId = hint.targetId;
      } else {
        newParentId = targetParentId;
        const next = siblings[targetIndex + 1];
        beforeFolderId = next ? next.id : null;
      }
    } else {
      // drop near bookmark → same parent as bookmark, append among folders
      newParentId = hint.parentId || 'root';
      beforeFolderId = null;
    }

    const { saveMeta } = await api.relocateFolder(source.id, newParentId, beforeFolderId);
    renderTree();
    handleSaveMeta(saveMeta);
    return;
  }

  // bookmark drag
  let newFolderId;
  let beforeBookmarkId = null;

  if (hint.targetType === 'folder') {
    if (hint.mode === 'into') {
      newFolderId = hint.targetId;
      beforeBookmarkId = null;
      expanded.add(hint.targetId);
    } else {
      // before/after folder → bookmark stays in that folder's parent
      newFolderId = hint.parentId || 'root';
      beforeBookmarkId = null;
    }
  } else {
    newFolderId = hint.parentId || 'root';
    const siblings =
      newFolderId === 'root'
        ? getSortedChildren('root', data).bookmarks
        : getSortedChildren(findFolder(data, newFolderId), null).bookmarks;
    const targetIndex = siblings.findIndex((b) => b.id === hint.targetId);
    if (hint.mode === 'before') {
      beforeBookmarkId = hint.targetId;
    } else {
      const next = siblings[targetIndex + 1];
      beforeBookmarkId = next ? next.id : null;
    }
  }

  const { saveMeta } = await api.relocateBookmark(source.id, newFolderId, beforeBookmarkId);
  renderTree();
  handleSaveMeta(saveMeta);
}

const FOLDER_ICON_SVG = `<svg class="folder-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path fill="currentColor" d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.2c.3 0 .6.1.8.3L8.2 3.5H13A1.5 1.5 0 0 1 14.5 5v7A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V3.5z"/></svg>`;

function renderFolderNode(folder, parentId = 'root') {
  const wrap = document.createElement('div');
  const open = expanded.has(folder.id);
  const { folders, bookmarks } = getSortedChildren(folder, null);
  const hasKids = folders.length > 0 || bookmarks.length > 0;
  const folderState = batchMode ? folderSelectionState(folder) : null;

  const head = document.createElement('div');
  head.className = 'tree-item folder-row';
  head.dataset.folderId = folder.id;

  if (batchMode) {
    head.innerHTML = `
      <input type="checkbox" class="batch-check batch-folder-check" title="${escapeHtml(t('selectFolderAll'))}"
        ${folderState.checked ? 'checked' : ''} ${folderState.ids.length === 0 ? 'disabled' : ''} />
      <span class="twist arrow" aria-hidden="true">${hasKids ? (open ? '▼' : '▶') : ''}</span>
      ${FOLDER_ICON_SVG}
      <span class="title">${escapeHtml(folder.name)}</span>
      <span class="muted folder-batch-hint">${escapeHtml(t('selectFolderAll'))}</span>
    `;
    const chk = head.querySelector('.batch-folder-check');
    chk.indeterminate = folderState.indeterminate;
    chk.addEventListener('click', (e) => e.stopPropagation());
    chk.addEventListener('change', () => {
      const ids = collectBookmarkIdsInFolder(folder);
      if (chk.checked) ids.forEach((id) => selectedBookmarkIds.add(id));
      else ids.forEach((id) => selectedBookmarkIds.delete(id));
      renderTree();
      updateBatchCount();
    });
    head.addEventListener('click', (e) => {
      if (e.target.closest('.batch-folder-check')) return;
      if (e.target.closest('.twist')) {
        if (!hasKids) return;
        if (expanded.has(folder.id)) expanded.delete(folder.id);
        else expanded.add(folder.id);
        renderTree();
        return;
      }
      // Click folder row toggles select-all for this folder
      if (!folderState.ids.length) return;
      const next = !folderSelectionState(folder).checked;
      const ids = collectBookmarkIdsInFolder(folder);
      if (next) ids.forEach((id) => selectedBookmarkIds.add(id));
      else ids.forEach((id) => selectedBookmarkIds.delete(id));
      renderTree();
      updateBatchCount();
    });
  } else {
    head.innerHTML = `
      <span class="twist arrow" aria-hidden="true">${hasKids ? (open ? '▼' : '▶') : ''}</span>
      ${FOLDER_ICON_SVG}
      <span class="title">${escapeHtml(folder.name)}</span>
    `;
    head.addEventListener('click', () => {
      if (!hasKids) return;
      if (expanded.has(folder.id)) expanded.delete(folder.id);
      else expanded.add(folder.id);
      renderTree();
    });
    head.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showItemMenu(e.clientX, e.clientY, { type: 'folder', id: folder.id });
    });
    bindRowDrag(head, { type: 'folder', id: folder.id, parentId });
  }
  wrap.appendChild(head);

  if (open && hasKids) {
    const children = document.createElement('div');
    children.className = 'tree-children';
    folders.forEach((f) => children.appendChild(renderFolderNode(f, folder.id)));
    bookmarks.forEach((b) => children.appendChild(renderBookmarkRow(b, folder.id)));
    wrap.appendChild(children);
  }
  return wrap;
}

function renderTree() {
  const data = getCached();
  els.tree.replaceChildren();
  if (!data) return;

  // In batch mode, expand all folders so every bookmark is reachable.
  if (batchMode) {
    const stack = [...(data.folders || [])];
    while (stack.length) {
      const f = stack.pop();
      expanded.add(f.id);
      (f.folders || []).forEach((c) => stack.push(c));
    }
  }

  const { folders, bookmarks } = getSortedChildren('root', data);
  if (!folders.length && !bookmarks.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = t('emptyTree');
    els.tree.appendChild(empty);
    return;
  }
  bookmarks.forEach((b) => els.tree.appendChild(renderBookmarkRow(b, 'root')));
  folders.forEach((f) => els.tree.appendChild(renderFolderNode(f, 'root')));
  if (batchMode) updateBatchCount();
}

function showItemMenu(x, y, item) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const menu = document.createElement('div');
  menu.className = 'menu';
  const left = Math.min(x, window.innerWidth - 160);
  const top = Math.min(y, window.innerHeight - 120);
  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;

  const addBtn = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', async () => {
      menu.remove();
      try {
        await fn();
      } catch (err) {
        toastError(mapError(err));
      }
    });
    menu.appendChild(b);
  };

  if (item.type === 'root') {
    addBtn(t('newFolder'), () => promptNewFolder('root'));
  }
  if (item.type === 'folder') {
    addBtn(t('newFolder'), () => promptNewFolder(item.id));
    addBtn(t('rename'), () => promptRenameFolder(item.id));
    addBtn(t('move'), () => promptMoveFolder(item.id));
    addBtn(t('delete'), () => promptDeleteFolder(item.id));
  }
  if (item.type === 'bookmark') {
    addBtn(t('edit'), () => promptEditBookmark(item.id));
    addBtn(t('move'), () => promptMoveBookmark(item.id));
    addBtn(t('delete'), async () => {
      const { saveMeta } = await api.removeBookmark(item.id);
      renderTree();
      await handleSaveMeta(saveMeta);
    });
  }

  document.body.appendChild(menu);
  const close = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('mousedown', close);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', close), 0);
}

function folderPickerFieldHtml() {
  return `<div class="field"><label>${t('targetFolder')}</label>
    <div id="dlgFolderPicker"></div></div>`;
}

async function promptNewFolder(parentId) {
  openDialog({
    title: t('newFolder'),
    bodyHtml: `<div class="field"><label data-i18n="folderName">${t('folderName')}</label>
      <input id="dlgName" type="text" /></div>`,
    actions: [
      { label: t('cancel') },
      {
        label: t('confirm'),
        primary: true,
        onClick: async (dlg) => {
          const name = dlg.querySelector('#dlgName').value.trim();
          if (!name) throw new Error('NAME_REQUIRED');
          const { saveMeta } = await api.createFolder(parentId, name);
          if (parentId && parentId !== 'root') expanded.add(parentId);
          renderTree();
          await handleSaveMeta(saveMeta);
        }
      }
    ]
  });
}

async function promptRenameFolder(folderId) {
  const data = getCached();
  const folder = findFolder(data, folderId);
  openDialog({
    title: t('rename'),
    bodyHtml: `<div class="field"><label>${t('folderName')}</label>
      <input id="dlgName" type="text" value="${escapeHtml(folder?.name || '')}" /></div>`,
    actions: [
      { label: t('cancel') },
      {
        label: t('save'),
        primary: true,
        onClick: async (dlg) => {
          const name = dlg.querySelector('#dlgName').value.trim();
          if (!name) throw new Error('NAME_REQUIRED');
          const { saveMeta } = await api.renameFolder(folderId, name);
          renderTree();
          await handleSaveMeta(saveMeta);
        }
      }
    ]
  });
}

async function promptDeleteFolder(folderId) {
  const data = getCached();
  const folder = findFolder(data, folderId);
  const hasChildren =
    (folder?.folders?.length || 0) > 0 || (folder?.bookmarks?.length || 0) > 0;

  if (!hasChildren) {
    const { saveMeta } = await api.removeFolder(folderId, 'delete_all');
    renderTree();
    await handleSaveMeta(saveMeta);
    return;
  }

  openDialog({
    title: t('deleteFolderTitle'),
    bodyHtml: `<p>${escapeHtml(t('deleteFolderBody'))}</p>`,
    actions: [
      { label: t('cancel') },
      {
        label: t('promoteChildren'),
        onClick: async () => {
          const { saveMeta } = await api.removeFolder(folderId, 'promote_to_parent');
          renderTree();
          await handleSaveMeta(saveMeta);
        }
      },
      {
        label: t('deleteAll'),
        danger: true,
        onClick: async () => {
          const { saveMeta } = await api.removeFolder(folderId, 'delete_all');
          renderTree();
          await handleSaveMeta(saveMeta);
        }
      }
    ]
  });
}

async function promptMoveFolder(folderId) {
  openDialog({
    title: t('move'),
    bodyHtml: folderPickerFieldHtml(),
    onMount: (dlg, ctx) => {
      ctx.picker = mountFolderPicker(dlg.querySelector('#dlgFolderPicker'), getCached(), {
        selectedId: 'root'
      });
    },
    actions: [
      { label: t('cancel') },
      {
        label: t('confirm'),
        primary: true,
        onClick: async (_dlg, ctx) => {
          const target = ctx.picker?.getSelectedId() || 'root';
          const { saveMeta } = await api.moveFolder(folderId, target);
          if (target !== 'root') expanded.add(target);
          renderTree();
          await handleSaveMeta(saveMeta);
        }
      }
    ]
  });
}

async function promptEditBookmark(bookmarkId) {
  const data = getCached();
  let found = null;
  for (const b of data.rootBookmarks) if (b.id === bookmarkId) found = b;
  if (!found) {
    const stack = [...data.folders];
    while (stack.length) {
      const f = stack.pop();
      for (const b of f.bookmarks || []) if (b.id === bookmarkId) found = b;
      (f.folders || []).forEach((c) => stack.push(c));
    }
  }
  openDialog({
    title: t('edit'),
    bodyHtml: `
      <div class="field"><label>${t('title')}</label><input id="dlgTitle" type="text" value="${escapeHtml(found?.title || '')}" /></div>
      <div class="field" style="margin-top:8px"><label>${t('url')}</label><input id="dlgUrl" type="url" value="${escapeHtml(found?.url || '')}" /></div>`,
    actions: [
      { label: t('cancel') },
      {
        label: t('save'),
        primary: true,
        onClick: async (dlg) => {
          const title = dlg.querySelector('#dlgTitle').value.trim();
          const url = dlg.querySelector('#dlgUrl').value.trim();
          const { saveMeta } = await api.editBookmark(bookmarkId, { title, url });
          renderTree();
          await handleSaveMeta(saveMeta);
        }
      }
    ]
  });
}

async function promptMoveBookmark(bookmarkId) {
  const cfg = await getConfig([CONFIG_KEYS.lastSelectedFolderId]);
  openDialog({
    title: t('move'),
    bodyHtml: folderPickerFieldHtml(),
    onMount: (dlg, ctx) => {
      ctx.picker = mountFolderPicker(dlg.querySelector('#dlgFolderPicker'), getCached(), {
        selectedId: cfg.lastSelectedFolderId || 'root'
      });
    },
    actions: [
      { label: t('cancel') },
      {
        label: t('confirm'),
        primary: true,
        onClick: async (_dlg, ctx) => {
          const target = ctx.picker?.getSelectedId() || 'root';
          const { saveMeta } = await api.moveBookmark(bookmarkId, target);
          await setConfig({ [CONFIG_KEYS.lastSelectedFolderId]: target });
          if (target !== 'root') expanded.add(target);
          renderTree();
          await handleSaveMeta(saveMeta);
        }
      }
    ]
  });
}

function renderSearch(query) {
  if (!query.trim()) {
    els.searchResults.classList.add('hidden');
    els.tree.classList.remove('hidden');
    return;
  }
  const { folders, bookmarks } = api.search(query);
  els.tree.classList.add('hidden');
  els.searchResults.classList.remove('hidden');
  els.searchResults.replaceChildren();

  if (!folders.length && !bookmarks.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = t('noResults');
    els.searchResults.appendChild(p);
    return;
  }

  folders.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'tree-item folder-row';
    row.innerHTML = `${FOLDER_ICON_SVG}<div class="item-meta"><div class="title">${escapeHtml(f.name)}</div>
      <div class="path-tag">${escapeHtml(f.path)}</div></div>`;
    row.addEventListener('click', () => {
      expandFolderPath(f.id);
      els.searchInput.value = '';
      renderSearch('');
      renderTree();
    });
    els.searchResults.appendChild(row);
  });

  bookmarks.forEach((b) => {
    const row = renderBookmarkRow(b, b.folderId);
    const meta = row.querySelector('.item-meta');
    const tag = document.createElement('div');
    tag.className = 'path-tag';
    tag.textContent = b.folderPath || '';
    meta.appendChild(tag);
    els.searchResults.appendChild(row);
  });
}

function showReauthGate(reason = 'permission') {
  showOnly('gate');
  const missing = reason === 'missing_handle' || currentStatus?.permission === 'missing_handle';
  const hint = missing ? t('handleMissingHint') : t('permissionDenied');
  els.gateMessage.innerHTML = `
    <div class="gate-card stack">
      <h2>${escapeHtml(t('statusNeedsAuth'))}</h2>
      <p class="muted">${escapeHtml(hint)}</p>
      ${
        missing
          ? ''
          : `<button id="btnReauth" class="primary">${escapeHtml(t('reauthorize'))}</button>`
      }
      <button id="btnOpenOptions" class="${missing ? 'primary' : ''}">${escapeHtml(t('settings'))}</button>
    </div>`;
  const reauthBtn = els.gateMessage.querySelector('#btnReauth');
  if (reauthBtn) {
    reauthBtn.onclick = async () => {
      try {
        await reauthorize();
        await bootMain();
      } catch (err) {
        toastError(mapError(err));
      }
    };
  }
  els.gateMessage.querySelector('#btnOpenOptions').onclick = () =>
    openExtensionPage('options/options.html');
  updateStatusBar();
}

async function loadDisplayPrefs() {
  const cfg = await getConfig([CONFIG_KEYS.showUrlInList]);
  showUrlInList = !!cfg.showUrlInList;
}

async function loadMain() {
  try {
    currentStatus = await getStatus().catch(() => currentStatus);
    if (currentStatus?.permission === 'missing_handle') {
      updateStatusBar();
      showReauthGate('missing_handle');
      return;
    }

    // Paint latest bookmarks first (pendingDiskSync is instant), then check permission.
    await Promise.all([refresh(), loadDisplayPrefs()]);
    showOnly('main');
    renderTree();

    currentStatus = await getStatus();
    updateStatusBar();
    if (currentStatus.needsReauth) {
      showReauthGate(
        currentStatus.permission === 'missing_handle' ? 'missing_handle' : 'permission'
      );
      return;
    }

    const enabled = await isPasswordEnabled();
    els.btnLock.classList.toggle('hidden', !enabled);
  } catch (err) {
    if (err?.message === 'JSON_CORRUPT' || err?.message === 'JSON_INVALID') {
      showOnly('gate');
      els.gateMessage.innerHTML = `<div class="gate-card"><h2>${escapeHtml(t('corruptJson'))}</h2>
        <button id="btnOpenOptions" class="primary">${escapeHtml(t('settings'))}</button></div>`;
      els.gateMessage.querySelector('#btnOpenOptions').onclick = () =>
        openExtensionPage('options/options.html');
      return;
    }
    if (err?.message === 'PERMISSION_DENIED' || err?.message === 'HANDLE_MISSING') {
      try {
        currentStatus = await getStatus();
      } catch {
        // keep previous
      }
      updateStatusBar();
      showReauthGate(err.message === 'HANDLE_MISSING' ? 'missing_handle' : 'permission');
      return;
    }
    toastError(mapError(err));
  }
}

async function bootMain() {
  await refresh();
  await loadMain();
}

async function afterSetupSuccess() {
  // Password can be set later in Settings / full setup page.
  await unlock();
  await loadMain();
}

async function initGate() {
  const cfg = await getConfig(['initialized']);
  if (!cfg.initialized) {
    const caps = detectCapabilities();
    showOnly('gate');
    els.gateMessage.innerHTML = `
      <div class="gate-card stack">
        <h2>${escapeHtml(t('welcomeTitle'))}</h2>
        <p class="muted">${escapeHtml(t('welcomeBody'))}</p>
        <p class="muted">${escapeHtml(t('setupCapabilities'))}</p>
        <div id="setupActions" class="stack"></div>
        <p id="setupErr" class="banner error hidden"></p>
        <button id="btnSetupPage">${escapeHtml(t('openSetup'))}</button>
      </div>`;

    const actions = els.gateMessage.querySelector('#setupActions');
    const errEl = els.gateMessage.querySelector('#setupErr');
    const showSetupErr = (err) => {
      errEl.textContent = mapError(err);
      errEl.classList.remove('hidden');
      // Fallback to full page when popup gesture/API fails.
      if (err?.name === 'AbortError' || err?.message === 'DIRECTORY_UNSUPPORTED' || err?.message === 'FILE_UNSUPPORTED') {
        // user cancelled or unsupported — keep options visible
      } else {
        openExtensionPage('pages/setup.html');
      }
    };

    if (caps.directory) {
      const b = document.createElement('button');
      b.className = 'primary';
      b.textContent = t('chooseDirectory');
      b.onclick = async () => {
        errEl.classList.add('hidden');
        try {
          await setupDirectory();
          await afterSetupSuccess();
        } catch (err) {
          showSetupErr(err);
        }
      };
      actions.appendChild(b);
    }
    if (caps.file) {
      const b1 = document.createElement('button');
      b1.textContent = t('createFile');
      b1.onclick = async () => {
        errEl.classList.add('hidden');
        try {
          await setupFile(true);
          await afterSetupSuccess();
        } catch (err) {
          showSetupErr(err);
        }
      };
      actions.appendChild(b1);
      const b2 = document.createElement('button');
      b2.textContent = t('openFile');
      b2.onclick = async () => {
        errEl.classList.add('hidden');
        try {
          await setupFile(false);
          await afterSetupSuccess();
        } catch (err) {
          showSetupErr(err);
        }
      };
      actions.appendChild(b2);
    }
    const manual = document.createElement('button');
    manual.textContent = t('useManual');
    manual.onclick = async () => {
      errEl.classList.add('hidden');
      try {
        await setupManual();
        await afterSetupSuccess();
      } catch (err) {
        showSetupErr(err);
      }
    };
    actions.appendChild(manual);

    els.gateMessage.querySelector('#btnSetupPage').onclick = () =>
      openExtensionPage('pages/setup.html');
    currentStatus = await getStatus();
    updateStatusBar();
    return false;
  }
  return true;
}

async function initUnlock() {
  const enabled = await isPasswordEnabled();
  if (!enabled) return true;
  // every_open: wipe any leftover session unlock from settings / last popup
  await beginPopupSession();
  const unlocked = await isUnlocked();
  if (unlocked) return true;
  showOnly('unlock');
  els.unlockPassword.value = '';
  els.unlockError.classList.add('hidden');
  els.unlockPassword.focus();
  return false;
}

async function start() {
  applyI18n();
  const ready = await initGate();
  if (!ready) return;
  const unlocked = await initUnlock();
  if (!unlocked) return;
  await loadMain();

  // every_open: clear unlock when popup closes (best-effort; beginPopupSession is the guarantee)
  ephemeralWatch = true;
  window.addEventListener('pagehide', () => {
    if (ephemeralWatch) clearEphemeralUnlock();
  });
  window.addEventListener('unload', () => {
    if (ephemeralWatch) clearEphemeralUnlock();
  });
}

els.btnUnlock.addEventListener('click', async () => {
  els.unlockError.classList.add('hidden');
  const pwd = els.unlockPassword.value;
  if (!pwd) {
    els.unlockError.textContent = t('passwordRequired');
    els.unlockError.classList.remove('hidden');
    return;
  }
  const ok = await verifyPassword(pwd);
  if (!ok) {
    els.unlockError.textContent = t('passwordWrong');
    els.unlockError.classList.remove('hidden');
    return;
  }
  await unlock();
  els.unlockPassword.value = '';
  await loadMain();
});

els.unlockPassword.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.btnUnlock.click();
});

els.btnLock.addEventListener('click', async () => {
  await lock();
  await initUnlock();
});

els.btnSettings.addEventListener('click', () => openExtensionPage('options/options.html'));

els.btnAdd.addEventListener('click', async () => {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'OPEN_ADD_BOOKMARK' });
    if (!res?.ok) toastError(t('errorGeneric'));
  } catch (err) {
    toastError(mapError(err));
  }
});

els.btnNewFolder.addEventListener('click', () => promptNewFolder('root'));

els.btnBatch.addEventListener('click', () => setBatchMode(!batchMode));
els.btnBatchDone.addEventListener('click', () => setBatchMode(false));

els.chkSelectAll.addEventListener('change', () => {
  const data = getCached();
  if (!data) return;
  const all = collectAllBookmarkIds(data);
  if (els.chkSelectAll.checked) all.forEach((id) => selectedBookmarkIds.add(id));
  else selectedBookmarkIds.clear();
  renderTree();
  updateBatchCount();
});

els.btnBatchDelete.addEventListener('click', async () => {
  if (!selectedBookmarkIds.size) return;
  if (!window.confirm(t('batchDeleteConfirm'))) return;
  try {
    const ids = [...selectedBookmarkIds];
    const { saveMeta } = await api.removeBookmarks(ids);
    selectedBookmarkIds.clear();
    renderTree();
    updateBatchCount();
    handleSaveMeta(saveMeta);
  } catch (err) {
    toastError(mapError(err));
  }
});

function onTreeContextMenu(e) {
  if (e.target.closest('.menu')) return;
  // Folder / bookmark rows handle their own contextmenu and stopPropagation.
  e.preventDefault();
  showItemMenu(e.clientX, e.clientY, { type: 'root' });
}

els.tree.addEventListener('contextmenu', onTreeContextMenu);
els.main.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.tree-item, .menu, input, button, .search-row, .toolbar')) return;
  e.preventDefault();
  showItemMenu(e.clientX, e.clientY, { type: 'root' });
});

els.btnRefresh.addEventListener('click', async () => {
  try {
    await bootMain();
    toastOk(t('done'));
  } catch (err) {
    toastError(mapError(err));
  }
});

els.searchInput.addEventListener('input', () => renderSearch(els.searchInput.value));

async function softRefreshTree() {
  if (els.main.classList.contains('hidden')) return;
  try {
    await refresh();
    renderTree();
    if (els.searchInput.value.trim()) renderSearch(els.searchInput.value);
    getStatus()
      .then((s) => {
        currentStatus = s;
        updateStatusBar();
      })
      .catch(() => {});
  } catch {
    // ignore background refresh errors
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'BOOKMARKS_CHANGED') {
    softRefreshTree();
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.showUrlInList) {
    showUrlInList = !!changes.showUrlInList.newValue;
    if (!els.main.classList.contains('hidden')) renderTree();
  }
  if (changes.pendingDiskSync || changes.bookmarksRevision || changes.pendingData) {
    softRefreshTree();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') softRefreshTree();
});

window.addEventListener('focus', () => softRefreshTree());

start().catch((err) => {
  console.error(err);
  toastError(mapError(err));
});
