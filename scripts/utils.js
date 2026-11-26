/**
 * Shared helpers for MarkNest.
 */

export function generateId(prefix) {
  const rand = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}_${Date.now().toString(36)}_${rand[0].toString(36)}${rand[1].toString(36)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function deepClone(value) {
  return structuredClone(value);
}

export function isRestrictedUrl(url) {
  if (!url || typeof url !== 'string') return true;
  try {
    const u = new URL(url);
    const blocked = ['chrome:', 'chrome-extension:', 'edge:', 'about:', 'devtools:', 'view-source:'];
    return blocked.some((p) => u.protocol === p || url.startsWith(p));
  } catch {
    return true;
  }
}

export function isValidHttpUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function truncate(text, max = 48) {
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function faviconUrl(pageUrl) {
  try {
    const u = new URL(pageUrl);
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=32`;
  } catch {
    return chrome.runtime.getURL('assets/icons/icon16.png');
  }
}

export function debounce(fn, wait = 200) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function createEmptyData() {
  return {
    version: 1,
    updatedAt: nowIso(),
    folders: [],
    rootBookmarks: []
  };
}

export function openExtensionPage(path, query = {}) {
  const url = new URL(chrome.runtime.getURL(path));
  Object.entries(query).forEach(([k, v]) => {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  });
  return chrome.tabs.create({ url: url.toString() });
}

export function t(key, substitutions) {
  try {
    return chrome.i18n.getMessage(key, substitutions) || key;
  } catch {
    return key;
  }
}

function i18nMessage(key, substitutions) {
  try {
    return chrome.i18n.getMessage(key, substitutions) || '';
  } catch {
    return '';
  }
}

export function applyI18n(root = document) {
  // Only replace when a real message exists; keep HTML fallback if locale is stale/missing.
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const msg = i18nMessage(key);
    if (msg) el.textContent = msg;
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    const msg = i18nMessage(key);
    if (msg) el.setAttribute('placeholder', msg);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    const msg = i18nMessage(key);
    if (msg) el.setAttribute('title', msg);
  });
}
