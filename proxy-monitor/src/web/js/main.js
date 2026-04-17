'use strict';

// ─── Init ─────────────────────────────────────────────────────────
async function init() {
  // Detect if auth is required
  try {
    const info = await fetch('api/auth-info').then(r => r.json());
    state.safeguard = !!info.safeguard;
    if (info.auth_required && !state.sessionToken) {
      showLogin();
      return;
    }
  } catch { /* server not ready yet, try anyway */ }

  initTheme();
  initPrivacyMode();
  connectWebSocket();
}

document.addEventListener('DOMContentLoaded', init);

// ESC key handler for closing modals
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Close detail modal (chart)
    if (!document.getElementById('detail-modal').classList.contains('hidden')) {
      closeDetail();
    }
    // Close settings modal
    else if (!document.getElementById('settings-modal').classList.contains('hidden')) {
      closeSettings();
    }
  }
});
