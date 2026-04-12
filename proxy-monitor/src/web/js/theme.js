'use strict';

// ─── Theme ────────────────────────────────────────────────────────
const THEME_ICONS = {
  light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
  dark: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  system: '<rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>'
};

function applyTheme(theme) {
  state.theme = theme;
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  localStorage.setItem('pm_theme', theme);
  
  // Update UI components
  const themeIcon = document.getElementById('theme-icon');
  if (themeIcon) themeIcon.innerHTML = THEME_ICONS[theme] || THEME_ICONS.system;

  document.querySelectorAll('.theme-menu button').forEach(btn => {
    btn.classList.toggle('active', btn.id === `theme-opt-${theme}`);
  });

  // Close menu
  document.getElementById('theme-menu')?.classList.remove('show');

  // Re-render chart if open
  if (state.detailChart && state.detailProxyId) loadDetailChart();
}

function toggleThemeMenu(e) {
  e.stopPropagation();
  document.getElementById('theme-menu')?.classList.toggle('show');
}

// Close dropdowns on outside click
document.addEventListener('click', (e) => {
  if (!e.target.closest('.theme-switcher')) {
    document.getElementById('theme-menu')?.classList.remove('show');
  }
});

function initTheme() {
  applyTheme(state.theme);
  
  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (state.theme === 'system' && state.detailChart && state.detailProxyId) {
      loadDetailChart();
    }
  });
}


// ─── Privacy Mode ──────────────────────────────────────────────────
function togglePrivacyMode() {
  state.privacyMode = !state.privacyMode;
  localStorage.setItem('pm_privacy', state.privacyMode);
  applyPrivacyMode(true);
}

function applyPrivacyMode(withToast = false) {
  const isPrivate = state.privacyMode;
  document.body.classList.toggle('privacy-mode', isPrivate);
  const icon = document.getElementById('eye-icon');
  if (!icon) return;

  if (isPrivate) {
    icon.innerHTML = `<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>`;
    if (withToast) toast('info', 'Privacy mode enabled');
  } else {
    icon.innerHTML = `<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z"/><circle cx="12" cy="12" r="3"/>`;
    if (withToast) toast('info', 'Privacy mode disabled');
  }
}

function initPrivacyMode() {
  applyPrivacyMode(false);
}
