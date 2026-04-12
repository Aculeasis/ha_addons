/* ================================================================
   app.js – Proxy Monitor frontend
   ================================================================ */

'use strict';

// ─── State ────────────────────────────────────────────────────────
const state = {
  proxies: [],
  summary: { total: 0, alive: 0, dead: 0 },
  lastUpdated: null,
  meta: {},
  wsConnected: false,
  sessionToken: sessionStorage.getItem('pm_token') || '',
  detailProxyId: null,
  detailHours: 24,
  detailGroupBy: 'hour',
  detailCheckType: 'tcp',
  detailChart: null,
  editingProxyIndex: null,
  pendingConfig: null,
};

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

// ─── Toast ────────────────────────────────────────────────────────
const ICONS = { success: '✓', error: '✕', info: 'ℹ' };
function toast(type, text, ms = 3500) {
  const tc = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${ICONS[type] || '•'}</span><span>${text}</span>`;
  tc.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-fade');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ms);
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

// ─── WebSocket ────────────────────────────────────────────────────
let ws = null;
let wsDelay = 1000;
let wsTimer = null;

function connectWebSocket() {
  if (ws && ws.readyState < 2) ws.close();
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = location.pathname.replace(/\/$/, '');
  ws = new WebSocket(`${proto}//${location.host}${path}/ws`);

  ws.onopen = () => {
    state.wsConnected = true; wsDelay = 1000;
    document.getElementById('ws-dot').className = 'ws-dot connected';
    clearTimeout(wsTimer);
    ws.send(JSON.stringify({ type: 'auth', token: state.sessionToken }));
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
    if (ev.code === 4401) {
      state.sessionToken = '';
      sessionStorage.removeItem('pm_token');
      showLogin();
      return;
    }
    wsTimer = setTimeout(() => { wsDelay = Math.min(wsDelay * 2, 30000); connectWebSocket(); }, wsDelay);
  };

  ws.onerror = () => { };

  // keepalive
  setInterval(() => {
    if (ws && ws.readyState === 1) ws.send('ping');
  }, 20000);
}

// ─── Stats update ─────────────────────────────────────────────────
function handleStats(data) {
  state.proxies = data.proxies || [];
  state.summary = data.summary || {};
  state.lastUpdated = data.last_updated;
  state.meta = data.meta || {};
  updateNav();
  renderGrid();
  if (state.detailProxyId) updateDetailStats();
}

function updateNav() {
  const { total, alive, dead } = state.summary;
  document.getElementById('nav-pills').innerHTML = `
    <div class="pill total">Total: ${total}</div>
    <div class="pill alive">🟢 Alive: ${alive}</div>
    <div class="pill dead">🔴 Dead: ${dead}</div>`;
  if (state.lastUpdated) {
    const is12h = state.meta?.time_format === '12h';
    const d = new Date(state.lastUpdated * 1000);
    document.getElementById('last-updated').textContent =
      `Updated ${d.toLocaleTimeString([], { hour12: is12h })}`;
  }
}

// ─── Proxy grid ───────────────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById('proxy-grid');
  const empty = document.getElementById('empty-state');
  if (!state.proxies.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  // Keep existing cards and update them; add new; remove stale
  const existing = new Map(
    [...grid.querySelectorAll('.proxy-card')].map(c => [c.dataset.pid, c])
  );
  const seen = new Set();

  state.proxies.forEach((proxy, idx) => {
    seen.add(proxy.id);
    if (existing.has(proxy.id)) {
      updateCard(existing.get(proxy.id), proxy);
    } else {
      const card = buildCard(proxy, idx);
      grid.appendChild(card);
    }
  });

  existing.forEach((card, pid) => { if (!seen.has(pid)) card.remove(); });
}

function cardStatus(proxy) {
  const hasTcp = !!proxy.tcp_check;
  const hasUdp = !!proxy.udp_check;
  const lc = proxy.stats?.last_checks || {};

  const tcpRes = lc.tcp || {};
  const udpRes = lc.udp || {};

  // A check is "clean" if it is successful AND has no error message
  const tcpClean = !hasTcp || (!!tcpRes.success && !tcpRes.error);
  const udpClean = !hasUdp || (!!udpRes.success && !udpRes.error);

  // proxy.is_alive is already computed by the server as (enabled_tcp_success || enabled_udp_success)
  if (proxy.is_alive && tcpClean && udpClean) return 'alive';
  if (proxy.is_alive) return 'partial';
  return 'dead';
}

// ─── Latency hover tooltip ────────────────────────────────────────
const _latTip = (() => {
  const el = document.createElement('div');
  el.id = 'lat-tip';
  Object.assign(el.style, {
    position: 'fixed', zIndex: 9999, pointerEvents: 'none', display: 'none',
    background: 'rgba(8,8,20,0.97)', border: '1px solid rgba(91,138,245,0.35)',
    borderRadius: '10px', padding: '12px 16px', font: "12px 'Inter',sans-serif",
    color: '#e8e8f5', boxShadow: '0 12px 40px rgba(0,0,0,0.6)', minWidth: '190px',
  });
  document.body.appendChild(el);
  return el;
})();

function _tipRow(label, val, color = '') {
  const v = val !== null && val !== undefined && !isNaN(val)
    ? fmtLatency(val) : '—';
  return `<div style="display:flex;justify-content:space-between;gap:24px;line-height:1.9">
    <span style="color:#8888a8">${label}</span>
    <span style="${color ? 'color:' + color : ''}">${v}</span></div>`;
}

function showLatTip(badge, e) {
  const last = parseFloat(badge.dataset.last) || null;
  const avg = parseFloat(badge.dataset.avg) || null;
  const min = parseFloat(badge.dataset.min) || null;
  const max = parseFloat(badge.dataset.max) || null;
  const label = badge.dataset.label || '';
  const wm = state.meta?.window_minutes || 5;
  _latTip.innerHTML = `
    <div style="font-weight:700;color:var(--accent);font-size:13px;margin-bottom:8px">${label} Latency</div>
    ${_tipRow('Last', last)}
    <div style="border-top:1px solid rgba(255,255,255,0.07);margin:5px 0"></div>
    ${_tipRow(`Avg (${wm}m window)`, avg)}
    ${_tipRow('Min', min, '#12d88a')}
    ${_tipRow('Max', max, '#f5a840')}`;
  _latTip.style.display = 'block';
  _positionTip(e);
}
function hideLatTip() { _latTip.style.display = 'none'; }
function _positionTip(e) {
  const tw = _latTip.offsetWidth, th = _latTip.offsetHeight;
  let x = e.clientX - tw / 2;
  let y = e.clientY - th - 12;
  x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
  if (y < 8) y = e.clientY + 16;
  _latTip.style.left = x + 'px';
  _latTip.style.top = y + 'px';
}

function latencyClass(ms) {
  if (!ms) return 'lat-none';
  if (ms < 500) return 'lat-good';
  if (ms < 2000) return 'lat-mid';
  return 'lat-bad';
}

function fmtLatency(ms) {
  if (!ms) return '—';
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function successRate(stats) {
  if (!stats) return 0;
  const t = stats.total || 0;
  return t ? Math.round((stats.success / t) * 100) : 0;
}

function buildSparklineSvg(data) {
  if (!data || data.length < 2) return '<svg></svg>';
  const W = 300, H = 40, pad = 2;
  const max = Math.max(...data.map(d => d.success + d.fail), 1);
  const rates = data.map(d => {
    const t = d.success + d.fail;
    return t ? d.success / t : 0;
  });
  const step = (W - 2 * pad) / (rates.length - 1);
  const pts = rates.map((r, i) => `${pad + i * step},${H - pad - r * (H - 2 * pad)}`).join(' ');
  const fill = `${pts} ${pad + (rates.length - 1) * step},${H} ${pad},${H}`;
  return `
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs>
      <linearGradient id="sg${data[0]?.ts || 0}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#5b8af5" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#5b8af5" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <polygon points="${fill}" fill="url(#sg${data[0]?.ts || 0})"/>
    <polyline points="${pts}" fill="none" stroke="#5b8af5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function renderStatBlock(label, stats, windowStats) {
  const rate = successRate(stats);
  const total = stats?.total || 0;
  if (!total) return '';

  return `
  <div class="stat-row">
    <div class="stat-label">${label}</div>
    <div class="stat-body">
      <div class="stat-bar-bg"><div class="stat-bar ${rate > 50 ? 'bar-alive' : 'bar-dead'}" style="width:${rate}%"></div></div>
      <div class="stat-nums">
        <span><span class="s">✓ ${stats.success}</span> / <span class="f">✕ ${stats.fail}</span> (all)</span>
        <span class="s">${windowStats ? `${windowStats.success}/${windowStats.total} recent` : ''}</span>
      </div>
    </div>
  </div>`;
}


function buildCard(proxy) {
  const el = document.createElement('div');
  el.className = 'proxy-card';
  el.dataset.pid = proxy.id;
  el.addEventListener('click', () => openDetail(proxy.id));
  updateCard(el, proxy);
  return el;
}

function updateCard(el, proxy) {
  const status = cardStatus(proxy);
  el.className = `proxy-card ${status}-card`;

  const lc = proxy.stats?.last_checks || {};
  const total = proxy.stats?.total || {};
  const win = proxy.stats?.window || {};
  const spark = proxy.stats?.sparkline || {};

  // per-type last latency
  const tcpLat = lc.tcp?.latency_ms ?? null;
  const udpLat = lc.udp?.latency_ms ?? null;

  // Build latency column for card-header top-right
  function latBadgeHtml(label, lat, winStats) {
    const w = winStats || {};
    return `<div class="lat-entry">
      <span class="lat-label">${label}</span>
      <span class="stat-latency ${latencyClass(lat)}"
            onmouseenter="showLatTip(this,event)" onmouseleave="hideLatTip()"
            data-last="${lat ?? ''}" data-avg="${w.lat_avg ?? ''}"
            data-min="${w.lat_min ?? ''}" data-max="${w.lat_max ?? ''}"
            data-label="${label}" style="cursor:default">${fmtLatency(lat)}</span>
    </div>`;
  }
  const latEntries = [];
  if (proxy.tcp_check && tcpLat != null) latEntries.push(latBadgeHtml('TCP', tcpLat, win.tcp));
  if (proxy.udp_check && udpLat != null) latEntries.push(latBadgeHtml('UDP', udpLat, win.udp));
  const latCol = latEntries.length
    ? `<div class="card-lat">${latEntries.join('')}</div>` : '';

  const tags = (proxy.tags || []).map(t => `<span class="tag">${t}</span>`).join('');
  const sparkData = spark.tcp || spark.udp || [];
  const sparkSvg = buildSparklineSvg(sparkData);

  const tcpBlock = proxy.tcp_check ? renderStatBlock('TCP', total.tcp, win.tcp) : '';
  const udpBlock = proxy.udp_check ? renderStatBlock('UDP', total.udp, win.udp) : '';

  const ipRow = proxy.external_ip
    ? `<div class="card-ip"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>${proxy.external_ip}</div>`
    : '';

  el.innerHTML = `
  <div class="card-header">
    <div class="status-col"><div class="status-dot ${status}"></div></div>
    <div class="card-info">
      <div class="card-name truncate">${esc(proxy.name)}</div>
      <div class="card-addr">${esc(proxy.host)}:${proxy.port}</div>
      ${ipRow}
      ${tags ? `<div class="tags">${tags}</div>` : ''}
    </div>
    ${latCol}
  </div>
  <div class="card-stats">${tcpBlock}${udpBlock}</div>
  <div class="sparkline-wrap">${sparkSvg}</div>`;
}


// ─── Escape html ──────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Privacy Mode ──────────────────────────────────────────────────
function togglePrivacyMode() {
  const isPrivate = document.body.classList.toggle('privacy-mode');
  const icon = document.getElementById('eye-icon');
  if (!icon) return;

  if (isPrivate) {
    icon.innerHTML = `<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>`;
    toast('info', 'Privacy mode enabled');
  } else {
    icon.innerHTML = `<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z"/><circle cx="12" cy="12" r="3"/>`;
    toast('info', 'Privacy mode disabled');
  }
}

// ─── Detail modal ─────────────────────────────────────────────────
function openDetail(pid) {
  state.detailProxyId = pid;
  const proxy = state.proxies.find(p => p.id === pid);
  if (!proxy) return;

  // Auto-select the first available check type so UDP-only proxies don't load an empty TCP chart
  if (proxy.tcp_check) state.detailCheckType = 'tcp';
  else if (proxy.udp_check) state.detailCheckType = 'udp';

  document.getElementById('detail-title').textContent = proxy.name;
  document.getElementById('detail-modal').classList.remove('hidden');
  renderDetailHeader(proxy);
  loadDetailChart();
}

function closeDetail() {
  document.getElementById('detail-modal').classList.add('hidden');
  state.detailProxyId = null;
  if (state.detailChart) { state.detailChart.destroy(); state.detailChart = null; }
}

function closeDetailIfBg(e) {
  if (e.target.id === 'detail-modal') closeDetail();
}

// Build only the info-blocks HTML (called both on first render and on live updates)
function buildDetailInfoHtml(proxy) {
  const lc = proxy.stats?.last_checks || {};
  const tot = proxy.stats?.total || {};
  const primaryLc = lc[state.detailCheckType] || lc.tcp || lc.udp;
  const lat = primaryLc?.latency_ms;
  const ipStr = proxy.external_ip || '—';
  const tcpTotal = tot.tcp ? `${tot.tcp.success}/${tot.tcp.total}` : '—';
  const udpTotal = tot.udp ? `${tot.udp.success}/${tot.udp.total}` : '—';
  const checks = proxy.tcp_check && proxy.udp_check ? 'TCP + UDP' : proxy.tcp_check ? 'TCP' : 'UDP';

  return `
  <div class="detail-info-block">
    <div class="dib-label">Status</div>
    <div class="dib-value ${proxy.is_alive ? 'good' : 'bad'}">${proxy.is_alive ? '● Online' : '● Offline'}</div>
  </div>
  <div class="detail-info-block">
    <div class="dib-label">Address</div>
    <div class="dib-value privacy" style="font-size:13px;font-family:monospace">${esc(proxy.host)}:${proxy.port}</div>
  </div>
  <div class="detail-info-block">
    <div class="dib-label">External IP</div>
    <div class="dib-value privacy" style="color:var(--accent)">${esc(ipStr)}</div>
  </div>
  <div class="detail-info-block">
    <div class="dib-label">Latency</div>
    <div class="dib-value ${latencyClass(lat)}">${fmtLatency(lat)}</div>
  </div>
  ${proxy.tcp_check ? `<div class="detail-info-block">
    <div class="dib-label">TCP checks</div>
    <div class="dib-value">${tcpTotal}</div>
  </div>` : ''}
  ${proxy.udp_check ? `<div class="detail-info-block">
    <div class="dib-label">UDP checks</div>
    <div class="dib-value">${udpTotal}</div>
  </div>` : ''}
  <div class="detail-info-block">
    <div class="dib-label">Check types</div>
    <div class="dib-value" style="font-size:13px">${checks}</div>
  </div>
  ${primaryLc?.error ? `<div class="detail-info-block" style="border-color:rgba(245,74,74,0.35)">
    <div class="dib-label" style="color:var(--danger)">Last error</div>
    <div class="dib-value" style="font-size:11px;color:var(--danger)">${esc(primaryLc.error)}</div>
  </div>` : ''}`;
}

function renderDetailHeader(proxy) {
  const ctrlTypes = [];
  if (proxy.tcp_check) ctrlTypes.push('tcp');
  if (proxy.udp_check) ctrlTypes.push('udp');
  const typeButtons = ctrlTypes.map(t =>
    `<button class="ctrl-btn ${state.detailCheckType === t ? 'active' : ''}"
       onclick="setDetailType('${t}')">${t.toUpperCase()}</button>`
  ).join('');

  // Full build (first open): sets the entire detail-body including chart canvas
  document.getElementById('detail-body').innerHTML = `
  <div class="detail-header-info" id="detail-info-blocks">
    ${buildDetailInfoHtml(proxy)}
  </div>

  <div class="chart-controls">
    ${ctrlTypes.length > 1 ? `<div class="ctrl-group">${typeButtons}</div><span style="color:var(--border);margin:0 4px">|</span>` : ''}
    <div class="ctrl-group" id="hours-ctrl">
      ${[[1, '1h'], [6, '6h'], [24, '24h'], [168, '7d'], [720, '30d']].map(([h, l]) =>
    `<button class="ctrl-btn ${state.detailHours === h ? 'active' : ''}"
           onclick="setDetailHours(${h})">${l}</button>`
  ).join('')}
    </div>
    <span style="color:var(--border);margin:0 4px">|</span>
    <div class="ctrl-group" id="group-ctrl">
      ${[['minute', 'Min'], ['hour', 'Hour'], ['day', 'Day']].map(([v, l]) =>
    `<button class="ctrl-btn ${state.detailGroupBy === v ? 'active' : ''}"
           onclick="setDetailGroupBy('${v}')">${l}</button>`
  ).join('')}
    </div>
  </div>

  <div class="chart-container" style="height:320px">
    <canvas id="detail-chart-canvas"></canvas>
    <div class="chart-loading" id="chart-loading"><div class="spinner"></div></div>
  </div>`;
}

function updateDetailStats() {
  // Only update the info blocks – never touch the chart canvas/spinner
  const proxy = state.proxies.find(p => p.id === state.detailProxyId);
  if (!proxy) return;
  const infoEl = document.getElementById('detail-info-blocks');
  if (infoEl) {
    infoEl.innerHTML = buildDetailInfoHtml(proxy);
  }
}

function setDetailType(t) { state.detailCheckType = t; renderDetailHeader(state.proxies.find(p => p.id === state.detailProxyId) || {}); loadDetailChart(); }
function setDetailHours(h) { state.detailHours = h; renderDetailHeader(state.proxies.find(p => p.id === state.detailProxyId) || {}); loadDetailChart(); }
function setDetailGroupBy(g) { state.detailGroupBy = g; renderDetailHeader(state.proxies.find(p => p.id === state.detailProxyId) || {}); loadDetailChart(); }

async function loadDetailChart() {
  if (!state.detailProxyId) return;
  document.getElementById('chart-loading')?.classList.remove('hidden');

  const params = new URLSearchParams({
    proxy_id: state.detailProxyId,
    hours: state.detailHours,
    group_by: state.detailGroupBy,
  });
  const data = await apiFetch(`api/proxy/chart?${params}`);
  document.getElementById('chart-loading')?.classList.add('hidden');
  if (!data) return;

  const series = data[state.detailCheckType] || data.tcp || data.udp || [];
  renderDetailChart(series);
}

function renderDetailChart(series) {
  const canvas = document.getElementById('detail-chart-canvas');
  if (!canvas) return;

  if (state.detailChart) { state.detailChart.destroy(); state.detailChart = null; }

  const labels = series.map(d => new Date(d.ts * 1000));
  const successes = series.map(d => d.successes);
  const failures = series.map(d => d.failures);
  const latencies = series.map(d => d.avg_latency);

  const ctx = canvas.getContext('2d');

  state.detailChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Success',
          data: successes,
          backgroundColor: 'rgba(18,216,138,0.7)',
          stack: 'checks',
          order: 2,
        },
        {
          label: 'Failures',
          data: failures,
          backgroundColor: 'rgba(245,74,74,0.7)',
          stack: 'checks',
          order: 2,
        },
        {
          label: 'Avg Latency (ms)',
          data: latencies,
          type: 'line',
          borderColor: '#5b8af5',
          backgroundColor: 'rgba(91,138,245,0.1)',
          borderWidth: 2,
          pointRadius: 2,
          yAxisID: 'y2',
          tension: 0.3,
          order: 1,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      scales: {
        x: {
          type: 'time',
          stacked: true,
          offset: true,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#8888a8', maxTicksLimit: 12 },
          time: {
            unit: state.detailGroupBy,
            tooltipFormat: state.meta?.time_format === '12h' ? 'dd MMM hh:mm a' : 'dd MMM HH:mm',
            displayFormats: {
              minute: state.meta?.time_format === '12h' ? 'hh:mm a' : 'HH:mm',
              hour: state.meta?.time_format === '12h' ? 'dd hh:mm a' : 'dd HH:mm',
              day: 'dd MMM'
            }
          },
        },
        y: {
          stacked: true,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#8888a8', precision: 0 },
          title: { display: true, text: 'Checks', color: '#5555aa' },
        },
        y2: {
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#5b8af5' },
          title: { display: true, text: 'Latency ms', color: '#5b8af5' },
        },
      },
      plugins: {
        legend: {
          labels: { color: '#9090b8', boxWidth: 12, padding: 16 },
        },
        tooltip: {
          backgroundColor: 'rgba(13,13,31,0.95)',
          borderColor: 'rgba(91,138,245,0.3)',
          borderWidth: 1,
          titleColor: '#e8e8f5',
          bodyColor: '#9090b8',
          padding: 10,
        },
      },
    },
  });
}

// ─── Settings modal ───────────────────────────────────────────────
async function openSettings() {
  document.getElementById('settings-modal').classList.remove('hidden');
  document.getElementById('settings-body').innerHTML =
    '<div style="text-align:center;padding:40px"><div class="spinner"></div></div>';
  const cfg = await apiFetch('api/config');
  if (!cfg) return;
  state.pendingConfig = JSON.parse(JSON.stringify(cfg));
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
  </div>`).join('');

  return `
  <div class="settings-section">
    <h3>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      Proxies
    </h3>
    <div class="proxy-list" id="proxy-list">${proxyItems}</div>
    <div id="proxy-edit-container" style="margin-top:12px"></div>
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
        <input type="text" id="cfg-host" value="${esc(s.host || '0.0.0.0')}" />
      </div>
      <div class="form-group">
        <label>Port</label>
        <input type="number" id="cfg-port" value="${s.port || 8080}" min="1" max="65535" />
      </div>
      <div class="form-group">
        <label>Auth Username</label>
        <input type="text" id="cfg-username" value="${esc(s.username || 'admin')}" placeholder="admin" />
      </div>
      <div class="form-group">
        <label>Auth Password (empty = disabled)</label>
        <input type="password" id="cfg-password" value="${esc(s.password || '')}" placeholder="leave empty to disable" />
      </div>
      <div class="form-group">
        <label>Time Format</label>
        <select id="cfg-time-format">
          <option value="24h" ${s.time_format !== '12h' ? 'selected' : ''}>24h</option>
          <option value="12h" ${s.time_format === '12h' ? 'selected' : ''}>12h</option>
        </select>
      </div>
      <div class="form-group" style="grid-column:1/-1">
        <label>Trusted IPs & Subnets (one per line, CIDR allowed)</label>
        <textarea id="cfg-trusted-ips" rows="3" style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-xs);color:var(--text);padding:8px 12px;font:14px Inter,sans-serif;resize:vertical;outline:none;transition:border-color var(--t)" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">${(s.trusted_ips || []).join('\n')}</textarea>
      </div>
      <div class="form-group" style="grid-column:1/-1">
        <label>Whitelist IPs & Subnets (one per line, CIDR allowed, empty = disabled)</label>
        <textarea id="cfg-whitelist-ips" rows="3" style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-xs);color:var(--text);padding:8px 12px;font:14px Inter,sans-serif;resize:vertical;outline:none;transition:border-color var(--t)" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">${(s.whitelist || []).join('\n')}</textarea>
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
        <label>DB path</label>
        <input type="text" id="cfg-db-path" value="${esc(st.db_path || 'proxy_data.db')}" />
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

// ─── Proxy edit form ──────────────────────────────────────────────
function editProxy(index) {
  state.editingProxyIndex = index;
  const proxies = state.pendingConfig?.proxies || [];
  const p = index !== null ? proxies[index] : null;

  const container = document.getElementById('proxy-edit-container');
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
  document.getElementById('proxy-edit-container').innerHTML = '';
  toast('info', `Proxy "${name}" ${state.editingProxyIndex !== null ? 'updated' : 'added'} (save to apply)`);
  state.editingProxyIndex = null;
}

function cancelProxyEdit() {
  const c = document.getElementById('proxy-edit-container');
  if (c) c.innerHTML = '';
  state.editingProxyIndex = null;
}

function deleteProxy(index) {
  if (!state.pendingConfig) return;
  state.editingProxyIndex = index;
  const p = state.pendingConfig.proxies[index];
  if (!p) return;

  const container = document.getElementById('proxy-edit-container');
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

  connectWebSocket();
}

document.addEventListener('DOMContentLoaded', init);
