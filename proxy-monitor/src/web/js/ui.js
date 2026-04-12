'use strict';

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
  const { total, alive, partial, dead } = state.summary;

  const names = { alive: [], partial: [], dead: [] };
  state.proxies.forEach(p => {
    const s = cardStatus(p);
    if (names[s]) names[s].push(p.name);
  });

  const listHtml = (type) => {
    if (!names[type].length) return '';
    return `<div class="pill-list">${names[type].map(n => `<div class="pill-list-item">${esc(n)}</div>`).join('')}</div>`;
  };

  document.getElementById('nav-pills').innerHTML = `
    <div class="pill total">Total: ${total}</div>
    <div class="pill alive">🟢 Alive: ${alive}${listHtml('alive')}</div>
    <div class="pill partial">🟡 Partial: ${partial}${listHtml('partial')}</div>
    <div class="pill dead">🔴 Dead: ${dead}${listHtml('dead')}</div>`;

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

function buildSparklineSvg(tcp, udp, pid) {
  const W = 300, H = 40, pad = 2;
  const build = (data) => {
    if (!data || data.length < 2) return null;
    const rates = data.map(d => {
      const t = d.success + d.fail;
      return t ? d.success / t : 0;
    });
    const step = (W - 2 * pad) / (rates.length - 1);
    const pts = rates.map((r, i) => `${pad + i * step},${H - pad - r * (H - 2 * pad)}`).join(' ');
    const fill = `${pts} ${pad + (rates.length - 1) * step},${H} ${pad},${H}`;
    return { pts, fill };
  };

  const t = build(tcp);
  const u = build(udp);
  if (!t && !u) return '<svg></svg>';

  const id = String(pid).replace(/[^a-z0-9]/gi, '');
  return `
  <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs>
      <linearGradient id="gt${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#5b8af5" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="#5b8af5" stop-opacity="0"/>
      </linearGradient>
      <linearGradient id="gu${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#9b5cf5" stop-opacity="0.2"/>
        <stop offset="100%" stop-color="#9b5cf5" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${t ? `<polygon points="${t.fill}" fill="url(#gt${id})"/>` : ''}
    ${u ? `<polygon points="${u.fill}" fill="url(#gu${id})"/>` : ''}
    ${t ? `<polyline points="${t.pts}" fill="none" stroke="#5b8af5" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
    ${u ? `<polyline points="${u.pts}" fill="none" stroke="#9b5cf5" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
  </svg>`;
}

function renderStatBlock(label, stats, windowStats) {
  const rate = successRate(stats);
  const total = stats?.total || 0;
  if (!total) return '';

  const color = label === 'TCP' ? 'var(--accent)' : (label === 'UDP' ? 'var(--accent2)' : 'var(--text3)');

  return `
  <div class="stat-row">
    <div class="stat-label" style="color:${color}">${label}</div>
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
    const color = label === 'TCP' ? 'var(--accent)' : (label === 'UDP' ? 'var(--accent2)' : 'var(--text3)');
    return `<div class="lat-entry">
      <span class="lat-label" style="color:${color}">${label}</span>
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
  const sparkSvg = buildSparklineSvg(spark.tcp, spark.udp, proxy.id);

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
