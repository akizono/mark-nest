/**
 * Read Chrome native bookmarks and convert into MarkNest-shaped payloads.
 * Requires the "bookmarks" permission.
 */

import { generateId, isValidHttpUrl, nowIso } from './utils.js';

/** Skip Chrome special roots; import their children as top-level folders/bookmarks. */
const SKIP_ROOT_IDS = new Set(['0']);

/**
 * @returns {Promise<{ id: string, title: string, url?: string, children?: object[] }[]>}
 */
export async function getChromeBookmarkTree() {
  const [root] = await chrome.bookmarks.getTree();
  return (root.children || []).map(simplifyNode);
}

function simplifyNode(node) {
  const out = {
    id: node.id,
    title: node.title || (node.url ? node.url : 'Folder')
  };
  if (node.url) {
    out.url = node.url;
  } else {
    out.children = (node.children || []).map(simplifyNode);
  }
  return out;
}

/**
 * Convert a Chrome folder node (and descendants) into a MarkNest folder object.
 */
export function chromeFolderToMarkNest(node) {
  const folders = [];
  const bookmarks = [];
  for (const child of node.children || []) {
    if (child.url) {
      if (!isValidHttpUrl(child.url)) continue;
      bookmarks.push({
        id: generateId('bookmark'),
        title: child.title || child.url,
        url: child.url,
        sortOrder: bookmarks.length
      });
    } else {
      folders.push(chromeFolderToMarkNest(child));
    }
  }
  return {
    id: generateId('folder'),
    name: (node.title || 'Folder').trim() || 'Folder',
    sortOrder: 0,
    folders,
    bookmarks
  };
}

/**
 * Build a MarkNest data fragment from selected Chrome node ids.
 * - Folder ids → nested MarkNest folders under `folders`
 * - Bookmark ids → `rootBookmarks` (or under parent folder if parent also selected — keep flat: selected folders are wholes; selected bookmarks alone go to rootBookmarks)
 */
export function selectionToMarkNestPayload(tree, selectedIds) {
  const selected = new Set(selectedIds);
  const folders = [];
  const rootBookmarks = [];

  const walk = (nodes, ancestorSelected) => {
    for (const node of nodes || []) {
      if (SKIP_ROOT_IDS.has(node.id)) {
        walk(node.children, false);
        continue;
      }
      if (node.url) {
        if (selected.has(node.id) && !ancestorSelected && isValidHttpUrl(node.url)) {
          rootBookmarks.push({
            id: generateId('bookmark'),
            title: node.title || node.url,
            url: node.url,
            sortOrder: rootBookmarks.length
          });
        }
        continue;
      }
      if (selected.has(node.id)) {
        folders.push(chromeFolderToMarkNest(node));
        // children already included; don't double-add
        continue;
      }
      walk(node.children, false);
    }
  };

  walk(tree, false);

  return {
    version: 1,
    updatedAt: nowIso(),
    folders,
    rootBookmarks
  };
}

export function countSelection(tree, selectedIds) {
  const selected = new Set(selectedIds);
  let folders = 0;
  let bookmarks = 0;

  const walk = (nodes, underSelectedFolder) => {
    for (const node of nodes || []) {
      if (node.url) {
        if (underSelectedFolder || selected.has(node.id)) {
          if (isValidHttpUrl(node.url)) bookmarks += 1;
        }
        continue;
      }
      const take = underSelectedFolder || selected.has(node.id);
      if (selected.has(node.id)) folders += 1;
      walk(node.children, take);
    }
  };
  walk(tree, false);
  return { folders, bookmarks };
}
