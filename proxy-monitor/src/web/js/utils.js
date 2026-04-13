'use strict';

// ─── Toast ────────────────────────────────────────────────────────
const ICONS = { success: '✓', error: '✕', info: 'ℹ' };
function toast(type, text, ms = 3500) {
  const tc = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${ICONS[type] || '•'}</span><span>${esc(text)}</span>`;
  tc.prepend(el);
  setTimeout(() => {
    el.classList.add('toast-fade');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
}


// ─── Escape html ──────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
