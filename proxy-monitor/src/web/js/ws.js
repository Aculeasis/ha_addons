'use strict';

// ─── WebSocket ────────────────────────────────────────────────────
let ws = null;
let wsDelay = 1000;
let wsTimer = null;
let keepaliveInterval = null;

function connectWebSocket() {
  // Clean up previous connection
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }
  if (ws && ws.readyState < 2) ws.close();

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = location.pathname.replace(/\/$/, '');
  ws = new WebSocket(`${proto}//${location.host}${path}/ws`);

  ws.onopen = () => {
    state.wsConnected = true; wsDelay = 1000;
    document.getElementById('ws-dot').className = 'ws-dot connected';
    clearTimeout(wsTimer);
    ws.send(JSON.stringify({ type: 'auth', token: state.sessionToken }));

    // Start keepalive interval (clean up previous one first)
    clearInterval(keepaliveInterval);
    keepaliveInterval = setInterval(() => {
      if (ws && ws.readyState === 1) ws.send('ping');
    }, 20000);
  };

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'stats') handleStats(msg.data);
    } catch { /* ignore malformed */ }
  };

  ws.onclose = (ev) => {
    state.wsConnected = false;
    document.getElementById('ws-dot').className = 'ws-dot';

    // Clean up keepalive interval
    if (keepaliveInterval) {
      clearInterval(keepaliveInterval);
      keepaliveInterval = null;
    }

    if (ev.code === 4401) {
      state.sessionToken = '';
      sessionStorage.removeItem('pm_token');
      showLogin();
      return;
    }
    wsTimer = setTimeout(() => { wsDelay = Math.min(wsDelay * 2, 30000); connectWebSocket(); }, wsDelay);
  };

  ws.onerror = () => { };
}
