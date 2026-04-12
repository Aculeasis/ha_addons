'use strict';

// ─── API ──────────────────────────────────────────────────────────
async function apiFetch(path, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.sessionToken) headers['X-Session-Token'] = state.sessionToken;
  try {
    const res = await fetch(path, {
      method,
      headers,
      body: body !== null ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      state.sessionToken = '';
      sessionStorage.removeItem('pm_token');
      showLogin();
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch (e) {
    toast('error', `API error: ${e.message}`);
    return null;
  }
}


// ─── Auth / Login ──────────────────────────────────────────────────
function showLogin() {
  document.getElementById('login-modal').classList.remove('hidden');
}
function hideLogin() {
  document.getElementById('login-modal').classList.add('hidden');
}
async function doLogin() {
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  btn.disabled = true; btn.innerHTML = '<div class="spinner" style="width:16px;height:16px"></div>';
  errEl.classList.add('hidden');
  try {
    const res = await fetch('api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
    });
    if (!res.ok) {
      errEl.textContent = 'Invalid credentials';
      errEl.classList.remove('hidden');
      return;
    }
    const data = await res.json();
    state.sessionToken = data.token;
    sessionStorage.setItem('pm_token', data.token);
    hideLogin();
    connectWebSocket();
  } catch {
    errEl.textContent = 'Connection error';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In';
  }
}
