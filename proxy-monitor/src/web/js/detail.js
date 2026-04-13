'use strict';

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
  const tcpTotal = tot.tcp ? `${tot.tcp.success}/${tot.tcp.total} (${successRate(tot.tcp)}%)` : '—';
  const udpTotal = tot.udp ? `${tot.udp.success}/${tot.udp.total} (${successRate(tot.udp)}%)` : '—';
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

  const style = getComputedStyle(document.documentElement);
  const colorText = style.getPropertyValue('--text2').trim() || '#9090b8';
  const colorGrid = style.getPropertyValue('--border').trim() || 'rgba(180, 180, 200, 0.1)';
  const colorBg = style.getPropertyValue('--bg2').trim() || '#0d0d1f';
  const colorAccent = style.getPropertyValue('--accent').trim() || '#5b8af5';

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
          borderColor: colorAccent,
          backgroundColor: colorAccent + '1a', // 10% opacity
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
          grid: { color: colorGrid },
          ticks: { color: colorText, maxTicksLimit: 12 },
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
          grid: { color: colorGrid },
          ticks: { color: colorText, precision: 0 },
          title: { display: true, text: 'Checks', color: colorText },
        },
        y2: {
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: colorAccent },
          title: { display: true, text: 'Latency ms', color: colorAccent },
        },
      },
      plugins: {
        legend: {
          labels: { color: colorText, boxWidth: 12, padding: 16 },
        },
        tooltip: {
          backgroundColor: colorBg,
          borderColor: colorGrid,
          borderWidth: 1,
          titleColor: style.getPropertyValue('--text').trim(),
          bodyColor: colorText,
          padding: 10,
        },
      },
    },
  });
}
