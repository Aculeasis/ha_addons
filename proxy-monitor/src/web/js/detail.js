'use strict';

// ─── Detail modal ─────────────────────────────────────────────────
// Picker instances stored globally for cleanup
let fromPicker = null;
let toPicker = null;

function openDetail(pid) {
  state.detailProxyId = pid;
  state.detailFromTs = null;  // Reset hour selection on open
  state.detailToTs = null;    // Reset end time on open
  const proxy = state.proxies.find(p => p.id === pid);
  if (!proxy) return;

  // Don't open if both TCP and UDP checks are disabled
  if (!proxy.tcp_check && !proxy.udp_check) return;

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
  state.detailFromTs = null;  // Reset hour selection on close
  state.detailToTs = null;    // Reset end time on close
  if (state.detailChart) { state.detailChart.destroy(); state.detailChart = null; }
  // Clean up picker instances
  fromPicker = null;
  toPicker = null;
}

function closeDetailIfBg(e) {
  if (e.target.id === 'detail-modal') closeDetail();
}

// Get status for currently selected protocol (returns null if no checks enabled)
function getCurrentProtocolStatus(proxy) {
  const hasTcp = !!proxy.tcp_check;
  const hasUdp = !!proxy.udp_check;

  // If no checks enabled, return null
  if (!hasTcp && !hasUdp) return null;

  const checkType = state.detailCheckType;
  const lc = proxy.stats?.last_checks || {};
  const checkRes = lc[checkType] || {};

  const isOnline = !!checkRes.success;
  return {
    protocol: checkType.toUpperCase(),
    status: isOnline ? 'online' : 'offline',
    text: isOnline ? '● Online' : '● Offline',
    className: isOnline ? 'good' : 'bad'
  };
}

// Get error if it occurred within the dashboard window period
function getWindowError(proxy, checkType) {
  const lc = proxy.stats?.last_checks || {};
  const lastCheck = lc[checkType];

  if (!lastCheck || !lastCheck.error || !lastCheck.error_timestamp) {
    return null;
  }

  // Check if error_timestamp is within the dashboard window
  const windowMinutes = state.meta?.window_minutes || 5;
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - windowMinutes * 60;

  // Show error only if error_timestamp is within the window
  if (lastCheck.error_timestamp >= windowStart) {
    return lastCheck.error;
  }

  return null;
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

  const statusInfo = getCurrentProtocolStatus(proxy);
  const primaryError = getWindowError(proxy, state.detailCheckType);

  // Build status block only if there's an active check
  const statusBlock = statusInfo ? `
  <div class="detail-info-block">
    <div class="dib-label">${statusInfo.protocol} Status</div>
    <div class="dib-value ${statusInfo.className}">${statusInfo.text}</div>
  </div>` : '';

  return `
  ${statusBlock}
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
  ${primaryError ? `<div class="detail-info-block" style="border-color:rgba(245,74,74,0.35)">
    <div class="dib-label" style="color:var(--danger)">Last error</div>
    <div class="dib-value" style="font-size:11px;color:var(--danger)">${esc(primaryError)}</div>
  </div>` : ''}`;
}

// Format timestamp for display
function formatTsRange(fromTs, toTs) {
  if (!fromTs) return '';
  const fromDate = new Date(fromTs * 1000);
  const use12h = state.meta?.time_format === '12h';
  
  const formatOpts = { 
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  };
  if (use12h) formatOpts.hour12 = true;
  
  const fromStr = fromDate.toLocaleString(use12h ? 'en-US' : 'en-GB', formatOpts);
  
  if (toTs) {
    const toDate = new Date(toTs * 1000);
    const toStr = toDate.toLocaleString(use12h ? 'en-US' : 'en-GB', formatOpts);
    return `${fromStr} → ${toStr}`;
  }
  return `From: ${fromStr}`;
}

function renderDetailHeader(proxy) {
  const ctrlTypes = [];
  if (proxy.tcp_check) ctrlTypes.push('tcp');
  if (proxy.udp_check) ctrlTypes.push('udp');
  const typeButtons = ctrlTypes.map(t =>
    `<button class="ctrl-btn ${state.detailCheckType === t ? 'active' : ''}"
       onclick="setDetailType('${t}')">${t.toUpperCase()}</button>`
  ).join('');

  // Time range constraints
  const now = new Date();
  const retentionDays = state.meta?.retention_days || 30;
  const minDate = new Date(now - retentionDays * 24 * 3600 * 1000);
  
  const hasRange = state.detailFromTs || state.detailToTs;

  // Full build (first open): sets the entire detail-body including chart canvas
  document.getElementById('detail-body').innerHTML = `
  <div class="detail-header-info" id="detail-info-blocks">
    ${buildDetailInfoHtml(proxy)}
  </div>

  <div class="chart-controls">
    ${ctrlTypes.length > 1 ? `<div class="ctrl-group">${typeButtons}</div><span style="color:var(--border);margin:0 4px">|</span>` : ''}
    <div class="ctrl-group" id="hours-ctrl">
      ${[[1, '1h'], [6, '6h'], [24, '24h'], [168, '7d'], [720, '30d']].map(([h, l]) =>
    `<button class="ctrl-btn ${state.detailHours === h && !hasRange ? 'active' : ''}"
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
    <div class="hour-selector-wrapper">
      <div id="from-picker-container"></div>
      <span class="hour-selector-sep">→</span>
      <div id="to-picker-container"></div>
      <button class="ctrl-btn hour-clear-btn ${hasRange ? '' : 'hidden'}" 
              onclick="clearDetailTimeRange()" 
              title="Clear time range">✕</button>
    </div>
  </div>
  ${hasRange ? `<div class="hour-selector-hint">${formatTsRange(state.detailFromTs, state.detailToTs)}</div>` : ''}

  <div class="chart-container" style="height:320px">
    <canvas id="detail-chart-canvas"></canvas>
    <div class="chart-loading" id="chart-loading"><div class="spinner"></div></div>
  </div>`;

  // Initialize custom datetime pickers
  const use24h = state.meta?.time_format !== '12h';
  
  fromPicker = new DatetimePicker({
    container: document.getElementById('from-picker-container'),
    value: state.detailFromTs ? new Date(state.detailFromTs * 1000) : null,
    min: minDate,
    max: state.detailToTs ? new Date(state.detailToTs * 1000) : now,
    placeholder: 'Start',
    title: 'Start time',
    use24h: use24h,
    onChange: (date) => {
      state.detailFromTs = date ? Math.floor(date.getTime() / 1000) : null;
      // Re-render to update hint and clear button visibility
      renderDetailHeader(state.proxies.find(p => p.id === state.detailProxyId) || {});
      loadDetailChart();
    }
  });

  toPicker = new DatetimePicker({
    container: document.getElementById('to-picker-container'),
    value: state.detailToTs ? new Date(state.detailToTs * 1000) : null,
    min: state.detailFromTs ? new Date(state.detailFromTs * 1000) : minDate,
    max: now,
    placeholder: 'End',
    title: 'End time',
    use24h: use24h,
    onChange: (date) => {
      state.detailToTs = date ? Math.floor(date.getTime() / 1000) : null;
      // Re-render to update hint and clear button visibility
      renderDetailHeader(state.proxies.find(p => p.id === state.detailProxyId) || {});
      loadDetailChart();
    }
  });
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

function setDetailType(t) { 
  state.detailCheckType = t; 
  renderDetailHeader(state.proxies.find(p => p.id === state.detailProxyId) || {}); 
  loadDetailChart(); 
}

function setDetailHours(h) { 
  state.detailHours = h; 
  state.detailFromTs = null;  // Clear time range when selecting preset
  state.detailToTs = null;
  renderDetailHeader(state.proxies.find(p => p.id === state.detailProxyId) || {}); 
  loadDetailChart(); 
}

function setDetailGroupBy(g) { 
  state.detailGroupBy = g; 
  renderDetailHeader(state.proxies.find(p => p.id === state.detailProxyId) || {}); 
  loadDetailChart(); 
}

// Clear time range selection
function clearDetailTimeRange() {
  state.detailFromTs = null;
  state.detailToTs = null;
  renderDetailHeader(state.proxies.find(p => p.id === state.detailProxyId) || {}); 
  loadDetailChart();
}

async function loadDetailChart() {
  if (!state.detailProxyId) return;
  document.getElementById('chart-loading')?.classList.remove('hidden');

  const params = new URLSearchParams({
    proxy_id: state.detailProxyId,
    group_by: state.detailGroupBy,
  });
  
  // If time range is specified, use it; otherwise use hours parameter
  if (state.detailFromTs) {
    params.set('from_ts', state.detailFromTs.toString());
    // Only send to_ts if it's set
    if (state.detailToTs) {
      params.set('to_ts', state.detailToTs.toString());
    }
  } else {
    params.set('hours', state.detailHours.toString());
  }
  
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
  const timestamps = series.map(d => d.ts);  // Keep timestamps for click handling
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
      onClick: (event, elements, chart) => {
        // Handle click on chart elements
        if (elements.length === 0) return;
        
        const element = elements[0];
        const datasetIndex = element.datasetIndex;
        
        // Only respond to clicks on bar charts (Success/Failures), not line chart
        if (datasetIndex > 1) return;
        
        const index = element.index;
        const clickedTs = timestamps[index];
        
        // Only enable drill-down when in 'hour' mode
        if (state.detailGroupBy === 'hour') {
          // Calculate the end of the clicked hour (hour bucket + 1 hour)
          const hourStart = clickedTs;
          const hourEnd = clickedTs + 3600;  // +1 hour
          
          // Set time range to exactly 1 hour
          state.detailFromTs = hourStart;
          state.detailToTs = hourEnd;
          // Switch to minute view to see the hour in detail
          state.detailGroupBy = 'minute';
          renderDetailHeader(state.proxies.find(p => p.id === state.detailProxyId) || {});
          loadDetailChart();
        }
      },
      // Make cursor indicate clickable bars when in hour mode
      onHover: (event, elements, chart) => {
        if (state.detailGroupBy === 'hour' && elements.length > 0 && elements[0].datasetIndex <= 1) {
          event.native.target.style.cursor = 'pointer';
        } else {
          event.native.target.style.cursor = 'default';
        }
      },
    },
  });
}