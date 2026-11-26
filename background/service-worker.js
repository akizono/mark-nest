/**
 * MarkNest service worker — menus, startup unlock policy, messaging.
 */

import { isPasswordEnabled, lock } from '../scripts/auth.js';

const MENU_ADD_ACTION = 'marknest_add_action';
const MENU_ADD_PAGE = 'marknest_add_page';
const MENU_ADD_LINK = 'marknest_add_link';
const MENU_IMPORT_CHROME = 'marknest_import_chrome';
const MENU_LOCK = 'marknest_lock_now';

function createMenu(props) {
  return new Promise((resolve) => {
    chrome.contextMenus.create(props, () => {
      // Ignore duplicate / unsupported context errors (e.g. bookmark on Chrome).
      void chrome.runtime.lastError;
      resolve();
    });
  });
}

async function ensureMenus() {
  try {
    await chrome.contextMenus.removeAll();
  } catch {
    // ignore
  }

  await createMenu({
    id: MENU_ADD_ACTION,
    title: chrome.i18n.getMessage('contextAddTab') || 'Add this tab',
    contexts: ['action']
  });

  const { initialized } = await chrome.storage.local.get(['initialized']);
  await createMenu({
    id: MENU_IMPORT_CHROME,
    title: chrome.i18n.getMessage('importChromeMenu') || 'Import Chrome bookmarks…',
    contexts: ['action'],
    enabled: !!initialized
  });

  const passwordOn = await isPasswordEnabled();
  await createMenu({
    id: MENU_LOCK,
    title: chrome.i18n.getMessage('manualLock') || 'Lock now',
    contexts: ['action'],
    enabled: passwordOn
  });

  await createMenu({
    id: MENU_ADD_PAGE,
    title: chrome.i18n.getMessage('contextAddPage') || 'Add to MarkNest',
    contexts: ['page', 'frame']
  });

  await createMenu({
    id: MENU_ADD_LINK,
    title: chrome.i18n.getMessage('contextAddPage') || 'Add to MarkNest',
    contexts: ['link']
  });

  // Firefox supports "bookmark"; Chrome does not (create fails quietly via lastError).
  await createMenu({
    id: 'marknest_add_chrome_bookmark',
    title: chrome.i18n.getMessage('contextAddPage') || 'Add to MarkNest',
    contexts: ['bookmark']
  });
}

async function refreshLockMenu() {
  try {
    const passwordOn = await isPasswordEnabled();
    await chrome.contextMenus.update(MENU_LOCK, { enabled: passwordOn });
  } catch {
    // menu may not exist yet
  }
}

async function refreshImportChromeMenu() {
  try {
    const { initialized } = await chrome.storage.local.get(['initialized']);
    await chrome.contextMenus.update(MENU_IMPORT_CHROME, { enabled: !!initialized });
  } catch {
    // menu may not exist yet
  }
}

async function isInitialized() {
  const { initialized } = await chrome.storage.local.get(['initialized']);
  return !!initialized;
}

function openAddPage({ title = '', url = '' } = {}) {
  const page = new URL(chrome.runtime.getURL('pages/add-bookmark.html'));
  if (title) page.searchParams.set('title', title);
  if (url) page.searchParams.set('url', url);
  chrome.windows.create({
    url: page.toString(),
    type: 'popup',
    width: 440,
    height: 520
  });
}

async function openImportChrome(focusId = '') {
  if (!(await isInitialized())) return;
  const page = new URL(chrome.runtime.getURL('pages/import-chrome.html'));
  if (focusId) page.searchParams.set('focus', focusId);
  chrome.windows.create({
    url: page.toString(),
    type: 'popup',
    width: 980,
    height: 720
  });
}

async function handleChromeBookmarkNode(bookmarkId) {
  try {
    const nodes = await chrome.bookmarks.get(bookmarkId);
    const node = nodes?.[0];
    if (!node) return;
    if (node.url) {
      openAddPage({ title: node.title || '', url: node.url });
      return;
    }
    // Folder → import UI focused on this folder
    await openImportChrome(node.id);
  } catch {
    await openImportChrome();
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureMenus();
});

chrome.runtime.onStartup.addListener(async () => {
  // Mode: browser_session / every_open → clear session unlock.
  // Mode: until_manual → keep chrome.storage.local unlock flag.
  const { unlockMode } = await chrome.storage.local.get(['unlockMode']);
  const mode = unlockMode || 'browser_session';
  if (mode === 'browser_session' || mode === 'every_open') {
    await chrome.storage.session.remove(['marknest_unlocked', 'marknest_unlock_once']);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (Object.prototype.hasOwnProperty.call(changes, 'passwordEnabled')) {
    refreshLockMenu();
  }
  if (Object.prototype.hasOwnProperty.call(changes, 'initialized')) {
    refreshImportChromeMenu();
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_LOCK) {
    lock().catch(() => {});
    return;
  }
  if (info.menuItemId === MENU_IMPORT_CHROME) {
    openImportChrome().catch(() => {});
    return;
  }
  if (info.menuItemId === 'marknest_add_chrome_bookmark' && info.bookmarkId) {
    handleChromeBookmarkNode(info.bookmarkId);
    return;
  }
  if (info.menuItemId === MENU_ADD_LINK) {
    openAddPage({
      title: tab?.title || '',
      url: info.linkUrl || ''
    });
    return;
  }
  if (info.menuItemId === MENU_ADD_ACTION || info.menuItemId === MENU_ADD_PAGE) {
    openAddPage({ title: tab?.title || '', url: tab?.url || '' });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === 'OPEN_ADD_BOOKMARK') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      openAddPage({ title: tab?.title || '', url: tab?.url || '' });
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'OPEN_IMPORT_CHROME') {
      if (!(await isInitialized())) {
        sendResponse({ ok: false, error: 'NOT_INITIALIZED' });
        return;
      }
      await openImportChrome(message.focusId || '');
      sendResponse({ ok: true });
      return;
    }
    if (message?.type === 'GET_ACTIVE_TAB') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      sendResponse({ ok: true, tab: tab ? { id: tab.id, title: tab.title, url: tab.url } : null });
      return;
    }
    sendResponse({ ok: false, error: 'UNKNOWN' });
  })().catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});

// Recreate menus if SW wakes without onInstalled.
ensureMenus();
