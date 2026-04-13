'use strict';

// ─── Settings modal ───────────────────────────────────────────────
async function openSettings() {
  document.getElementById('settings-modal').classList.remove('hidden');
  document.getElementById('settings-body').innerHTML =
    '<div style="text-align:center;padding:40px"><div class="spinner"></div></div>';

  const [cfg, dbInfo] = await Promise.all([
    apiFetch('api/config'),
    apiFetch('api/db-size')
  ]);

  if (!cfg) return;
  state.pendingConfig = JSON.parse(JSON.stringify(cfg));
  state.dbSizeFormatted = dbInfo?.formatted || null;
  document.getElementById('settings-body').innerHTML = buildSettingsHtml(state.pendingConfig);
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
}

function closeSettingsIfBg(e) {
  if (e.target.id === 'settings-modal') closeSettings();
}

function buildSettingsHtml(cfg) {
  const s = cfg.server || {};
  const m = cfg.monitoring || {};
  const st = cfg.storage || {};
  const proxies = cfg.proxies || [];

  const proxyItems = proxies.map((p, i) => `
  <div class="proxy-item" id="proxy-item-${i}">
    <div class="proxy-item-info">
      <div class="proxy-item-name">${esc(p.name)}</div>
      <div class="proxy-item-addr">${esc(p.host)}:${p.port}
        ${p.tcp_check !== false ? '<span class="tag">TCP</span>' : ''}
        ${p.udp_check ? '<span class="tag">UDP</span>' : ''}
      </div>
    </div>
    <div class="proxy-item-actions">
      <button class="btn btn-ghost btn-sm" onclick="editProxy(${i})">Edit</button>
      <button class="btn btn-danger btn-sm" onclick="deleteProxy(${i})">✕</button>
    </div>
  </div>
  <div id="proxy-edit-container-${i}"></div>`).join('');

  return `
  <div class="settings-section">
    <h3>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      Proxies
    </h3>
    <div class="proxy-list" id="proxy-list">${proxyItems}</div>
    <div id="proxy-edit-container-new" style="margin-top:12px"></div>
    <button class="btn btn-ghost btn-sm" style="margin-top:12px" onclick="editProxy(null)">+ Add Proxy</button>
  </div>

  <div class="settings-section">
    <h3>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      Monitoring
    </h3>
    <div class="form-grid">
      <div class="form-group">
        <label>Check interval (sec)</label>
        <input type="number" id="cfg-check-interval" value="${m.check_interval_seconds || 60}" min="5" />
      </div>
      <div class="form-group">
        <label>Timeout (sec)</label>
        <input type="number" id="cfg-timeout" value="${m.check_timeout_seconds || 10}" min="1" />
      </div>
      <div class="form-group">
        <label>Concurrent checks</label>
        <input type="number" id="cfg-concurrent" value="${m.concurrent_checks || 10}" min="1" />
      </div>
      <div class="form-group">
        <label>Dashboard window (min)</label>
        <input type="number" id="cfg-window" value="${m.recent_window_minutes || 5}" min="1" />
      </div>
      <div class="form-group" style="grid-column:1/-1">
        <label>TCP test URL</label>
        <input type="url" id="cfg-test-url" value="${esc(m.tcp_test_url || 'http://httpbin.org/ip')}" />
      </div>
    </div>
  </div>

  <div class="settings-section">
    <h3>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      Server
    </h3>
    <div class="form-grid">
      <div class="form-group">
        <label>Host</label>
        <input type="text" id="cfg-host" value="${esc(s.host || '0.0.0.0')}" ${state.safeguard ? 'disabled' : ''} />
      </div>
      <div class="form-group">
        <label>Port</label>
        <input type="number" id="cfg-port" value="${s.port || 8080}" min="1" max="65535" ${state.safeguard ? 'disabled' : ''} />
      </div>
      <div class="form-group">
        <label>Auth Username</label>
        <input type="text" id="cfg-username" value="${esc(s.username || 'admin')}" placeholder="admin" ${state.safeguard ? 'disabled' : ''} />
      </div>
      <div class="form-group">
        <label>Auth Password (empty = disabled)</label>
        <input type="password" id="cfg-password" value="${esc(s.password || '')}" placeholder="leave empty to disable" ${state.safeguard ? 'disabled' : ''} />
      </div>
      <div class="form-group">
        <label>Time Format</label>
        <select id="cfg-time-format">
          <option value="24h" ${s.time_format !== '12h' ? 'selected' : ''}>24h</option>
          <option value="12h" ${s.time_format === '12h' ? 'selected' : ''}>12h</option>
        </select>
      </div>
      <div class="form-group">
        <label>Log Level</label>
        <select id="cfg-log-level">
          <option value="DEBUG" ${s.log_level === 'DEBUG' ? 'selected' : ''}>DEBUG</option>
          <option value="INFO" ${s.log_level === 'INFO' || !s.log_level ? 'selected' : ''}>INFO</option>
          <option value="WARNING" ${s.log_level === 'WARNING' ? 'selected' : ''}>WARNING</option>
          <option value="ERROR" ${s.log_level === 'ERROR' ? 'selected' : ''}>ERROR</option>
          <option value="CRITICAL" ${s.log_level === 'CRITICAL' ? 'selected' : ''}>CRITICAL</option>
        </select>
      </div>

      <div class="form-group" style="grid-column:1/-1">
        <label>Trusted IPs & Subnets (one per line, CIDR allowed)</label>
        <textarea id="cfg-trusted-ips" rows="3" style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-xs);color:var(--text);padding:8px 12px;font:14px Inter,sans-serif;resize:vertical;outline:none;transition:border-color var(--t)" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'" ${state.safeguard ? 'disabled' : ''}>${(s.trusted_ips || []).join('\n')}</textarea>
      </div>
      <div class="form-group" style="grid-column:1/-1">
        <label>Whitelist IPs & Subnets (one per line, CIDR allowed, empty = disabled)</label>
        <textarea id="cfg-whitelist-ips" rows="3" style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-xs);color:var(--text);padding:8px 12px;font:14px Inter,sans-serif;resize:vertical;outline:none;transition:border-color var(--t)" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'" ${state.safeguard ? 'disabled' : ''}>${(s.whitelist || []).join('\n')}</textarea>
      </div>
    </div>
  </div>

  <div class="settings-section">
    <h3>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
      Storage
    </h3>
    <div class="form-grid">
      <div class="form-group">
        <label>Retention (days)</label>
        <input type="number" id="cfg-retention" value="${st.retention_days || 30}" min="1" />
      </div>
      <div class="form-group">
        <label>Cleanup interval (min)</label>
        <input type="number" id="cfg-cleanup" value="${st.cleanup_interval_minutes || 60}" min="10" />
      </div>
      <div class="form-group">
        <label style="display:flex; justify-content:space-between; align-items:center;">
          <span>DB path</span>
          <div style="display:flex; align-items:center; gap:8px;">
            ${state.dbSizeFormatted ? `<span style="font-size:11px; opacity:0.6; font-weight:normal;">${state.dbSizeFormatted}</span>` : ''}
            <button class="btn btn-ghost btn-xs" onclick="optimizeDb(this)" title="Reclaim unused space and optimize performance">Optimize Now</button>
          </div>
        </label>
        <input type="text" id="cfg-db-path" value="${esc(st.db_path || 'proxy_data.db')}" ${state.safeguard ? 'disabled' : ''} />
      </div>
    </div>
  </div>`;
}

function collectConfig() {
  const cfg = state.pendingConfig;
  cfg.server = {
    ...cfg.server,
    host: document.getElementById('cfg-host')?.value || '0.0.0.0',
    port: parseInt(document.getElementById('cfg-port')?.value || '8080'),
    username: document.getElementById('cfg-username')?.value || 'admin',
    password: document.getElementById('cfg-password')?.value || '',
    trusted_ips: (document.getElementById('cfg-trusted-ips')?.value || '')
      .split('\n').map(s => s.trim()).filter(Boolean),
    whitelist: (document.getElementById('cfg-whitelist-ips')?.value || '')
      .split('\n').map(s => s.trim()).filter(Boolean),
    time_format: document.getElementById('cfg-time-format')?.value || '24h',
    log_level: document.getElementById('cfg-log-level')?.value || 'INFO',
  };
  cfg.monitoring = {
    ...cfg.monitoring,
    check_interval_seconds: parseInt(document.getElementById('cfg-check-interval')?.value || '60'),
    check_timeout_seconds: parseInt(document.getElementById('cfg-timeout')?.value || '10'),
    concurrent_checks: parseInt(document.getElementById('cfg-concurrent')?.value || '10'),
    recent_window_minutes: parseInt(document.getElementById('cfg-window')?.value || '5'),
    tcp_test_url: document.getElementById('cfg-test-url')?.value || 'http://httpbin.org/ip',
  };
  cfg.storage = {
    ...cfg.storage,
    retention_days: parseInt(document.getElementById('cfg-retention')?.value || '30'),
    cleanup_interval_minutes: parseInt(document.getElementById('cfg-cleanup')?.value || '60'),
    db_path: document.getElementById('cfg-db-path')?.value || 'proxy_data.db',
  };
  return cfg;
}

async function saveSettings() {
  const cfg = collectConfig();
  const res = await apiFetch('api/config', 'POST', cfg);
  if (res) {
    toast('success', 'Settings saved, monitoring restarted');
    closeSettings();
    state.pendingConfig = null;
  }
}


async function optimizeDb(btn) {
  if (btn.disabled) return;
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner btn-xs" style="width:10px;height:10px;border-width:2px"></div>';
  
  try {
    const res = await apiFetch('api/db-vacuum', 'POST');
    if (res) {
      toast('success', 'Database optimized successfully');
      // Refresh size
      const dbInfo = await apiFetch('api/db-size');
      if (dbInfo?.formatted) {
        state.dbSizeFormatted = dbInfo.formatted;
        // Find the sibling span and update it
        const label = btn.closest('label');
        const span = label?.querySelector('span:nth-child(2)');
        if (span) span.textContent = dbInfo.formatted;
      }
    }
  } catch (err) {
    toast('error', 'Optimization failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}


// ─── Proxy edit form ──────────────────────────────────────────────
function editProxy(index) {
  cancelProxyEdit();
  state.editingProxyIndex = index;
  const proxies = state.pendingConfig?.proxies || [];
  const p = index !== null ? proxies[index] : null;

  const containerId = index !== null ? `proxy-edit-container-${index}` : 'proxy-edit-container-new';
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
  <div class="proxy-edit-form">
    <h4>${p ? 'Edit Proxy' : 'Add Proxy'}</h4>
    <div class="form-grid">
      <div class="form-group">
        <label>Name *</label>
        <input type="text" id="pe-name" value="${esc(p?.name || '')}" placeholder="My Proxy" />
      </div>
      <div class="form-group">
        <label>Host *</label>
        <input type="text" id="pe-host" value="${esc(p?.host || '')}" placeholder="1.2.3.4" />
      </div>
      <div class="form-group">
        <label>Port *</label>
        <input type="number" id="pe-port" value="${p?.port || 1080}" min="1" max="65535" />
      </div>
      <div class="form-group">
        <label>Username</label>
        <input type="text" id="pe-user" value="${esc(p?.username || '')}" placeholder="optional" />
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" id="pe-pass" value="${esc(p?.password || '')}" placeholder="optional" />
      </div>
      <div class="form-group">
        <label>Tags (comma-separated)</label>
        <input type="text" id="pe-tags" value="${(p?.tags || []).join(', ')}" placeholder="prod, us" />
      </div>
    </div>
    <div style="display:flex;gap:20px;margin-top:12px">
      <label class="form-row-check form-group">
        <input type="checkbox" id="pe-tcp" ${p?.tcp_check !== false ? 'checked' : ''} /> TCP check
      </label>
      <label class="form-row-check form-group">
        <input type="checkbox" id="pe-udp" ${p?.udp_check ? 'checked' : ''} /> UDP check
      </label>
    </div>
    <div style="display:flex;gap:8px;margin-top:14px">
      <button class="btn btn-primary btn-sm" onclick="saveProxy()">Save</button>
      <button class="btn btn-ghost btn-sm" onclick="cancelProxyEdit()">Cancel</button>
    </div>
  </div>`;
}

function saveProxy() {
  const name = document.getElementById('pe-name').value.trim();
  const host = document.getElementById('pe-host').value.trim();
  const port = parseInt(document.getElementById('pe-port').value);
  if (!name || !host || isNaN(port)) { toast('error', 'Name, host and port are required'); return; }

  const proxy = {
    name,
    host,
    port,
    username: document.getElementById('pe-user').value || undefined,
    password: document.getElementById('pe-pass').value || undefined,
    tcp_check: document.getElementById('pe-tcp').checked,
    udp_check: document.getElementById('pe-udp').checked,
    tags: document.getElementById('pe-tags').value.split(',').map(s => s.trim()).filter(Boolean),
  };
  // Remove undefined keys
  Object.keys(proxy).forEach(k => proxy[k] === undefined && delete proxy[k]);

  const proxies = state.pendingConfig.proxies || [];
  if (state.editingProxyIndex !== null) {
    proxies[state.editingProxyIndex] = proxy;
  } else {
    proxies.push(proxy);
  }
  state.pendingConfig.proxies = proxies;

  // Re-render settings
  const body = document.getElementById('settings-body');
  if (body) body.innerHTML = buildSettingsHtml(state.pendingConfig);
  toast('info', `Proxy "${name}" ${state.editingProxyIndex !== null ? 'updated' : 'added'} (save to apply)`);
  state.editingProxyIndex = null;
}

function cancelProxyEdit() {
  document.querySelectorAll('[id^="proxy-edit-container-"]').forEach(c => c.innerHTML = '');
  state.editingProxyIndex = null;
}

function deleteProxy(index) {
  if (!state.pendingConfig) return;
  cancelProxyEdit();
  state.editingProxyIndex = index;
  const p = state.pendingConfig.proxies[index];
  if (!p) return;

  const container = document.getElementById(`proxy-edit-container-${index}`);
  if (!container) return;

  container.innerHTML = `
  <div class="proxy-edit-form" style="border-color: rgba(245,74,74,0.35);">
    <h4 style="color: var(--danger);">Confirm Deletion</h4>
    <p style="margin-top: 8px;">Are you sure you want to delete proxy "<strong>${esc(p.name || '')}</strong>"?</p>
    <div style="display:flex;gap:8px;margin-top:14px">
      <button class="btn btn-danger btn-sm" onclick="confirmDeleteProxy()">Delete</button>
      <button class="btn btn-ghost btn-sm" onclick="cancelProxyEdit()">Cancel</button>
    </div>
  </div>`;
}

function confirmDeleteProxy() {
  if (state.editingProxyIndex === null || !state.pendingConfig) return;
  const index = state.editingProxyIndex;
  const name = state.pendingConfig.proxies[index]?.name || index;
  state.pendingConfig.proxies.splice(index, 1);
  state.editingProxyIndex = null;
  const body = document.getElementById('settings-body');
  if (body) body.innerHTML = buildSettingsHtml(state.pendingConfig);
  toast('info', `Proxy "${name}" removed (save to apply)`);
}
