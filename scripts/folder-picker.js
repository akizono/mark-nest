/**
 * Tree-style folder picker (select one folder / root).
 */

import { findFolder, findFolderParent, getSortedChildren } from './bookmarks.js';
import { escapeHtml, t } from './utils.js';

function expandAncestors(data, folderId, expanded) {
  if (!folderId || folderId === 'root') return;
  let curId = folderId;
  while (curId && curId !== 'root') {
    expanded.add(curId);
    const parent = findFolderParent(data, curId);
    curId = parent ? parent.id : null;
    if (!parent) break;
  }
  expanded.add('root');
}

/**
 * @param {HTMLElement} container
 * @param {object} data
 * @param {{ selectedId?: string, onChange?: (id: string) => void }} options
 */
export function mountFolderPicker(container, data, options = {}) {
  let selectedId = options.selectedId || 'root';
  if (selectedId !== 'root' && !findFolder(data, selectedId)) {
    selectedId = 'root';
  }

  const expanded = new Set(['root']);
  expandAncestors(data, selectedId, expanded);

  const render = () => {
    container.replaceChildren();
    container.classList.add('folder-picker');

    const addRow = (id, name, depth, hasChildren) => {
      const row = document.createElement('div');
      row.className = `folder-picker-row${selectedId === id ? ' selected' : ''}`;
      row.style.paddingLeft = `${6 + depth * 14}px`;
      row.dataset.folderId = id;

      const twist = document.createElement('span');
      twist.className = `folder-picker-twist${hasChildren ? '' : ' empty'}`;
      if (hasChildren) {
        twist.textContent = expanded.has(id) ? '▼' : '▶';
        twist.addEventListener('click', (e) => {
          e.stopPropagation();
          if (expanded.has(id)) expanded.delete(id);
          else expanded.add(id);
          render();
        });
      }

      const label = document.createElement('span');
      label.className = 'folder-picker-label';
      label.textContent = name;

      row.append(twist, label);
      row.addEventListener('click', () => {
        selectedId = id;
        options.onChange?.(id);
        render();
      });
      container.appendChild(row);
    };

    const rootFolders = getSortedChildren('root', data).folders;
    addRow('root', t('root') || '/', 0, rootFolders.length > 0);

    const walk = (folders, depth) => {
      folders.forEach((f) => {
        const childFolders = getSortedChildren(f, null).folders;
        addRow(f.id, f.name, depth, childFolders.length > 0);
        if (expanded.has(f.id) && childFolders.length) {
          walk(childFolders, depth + 1);
        }
      });
    };

    if (expanded.has('root')) {
      walk(rootFolders, 1);
    }
  };

  render();

  return {
    getSelectedId: () => selectedId,
    setSelectedId: (id) => {
      selectedId = id === 'root' || findFolder(data, id) ? id : 'root';
      expandAncestors(data, selectedId, expanded);
      render();
    }
  };
}

export function folderPickerShellHtml() {
  return `<div class="folder-picker" role="listbox" aria-label="${escapeHtml(t('folder'))}"></div>`;
}
