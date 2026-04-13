'use strict';

// ─── Theme ────────────────────────────────────────────────────────
const THEME_ICONS = {
  light: '<use href="#icon-theme-light"></use>',
  dark: '<use href="#icon-theme-dark"></use>',
  system: '<use href="#icon-theme-system"></use>'
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
    icon.innerHTML = `<use href="#icon-eye-closed"></use>`;
    if (withToast) toast('info', 'Privacy mode enabled');
  } else {
    icon.innerHTML = `<use href="#icon-eye-open"></use>`;
    if (withToast) toast('info', 'Privacy mode disabled');
  }
}

function initPrivacyMode() {
  applyPrivacyMode(false);
}
