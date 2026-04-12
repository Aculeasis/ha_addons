'use strict';

// ─── Init ─────────────────────────────────────────────────────────
async function init() {
  // Detect if auth is required
  try {
    const info = await fetch('api/auth-info').then(r => r.json());
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
