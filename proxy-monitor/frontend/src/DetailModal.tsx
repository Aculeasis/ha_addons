import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Chart, type ChartConfigurationCustomTypesPerDataset } from 'chart.js/auto';
import 'chartjs-adapter-date-fns';
import { api } from './api';
import { DateRangePicker } from './DateRangePicker';
import { latency, latencyLevel, rate } from './format';
import { Modal } from './Modal';
import type { ChartPoint, CheckType, GroupBy, ProxyStatus, StatsData } from './types';

function Info({ label, value, className = '', blockClass = '' }: { label: string; value: string; className?: string; blockClass?: string }) {
  return <div class={`detail-info-block ${blockClass}`}><span class="dib-label">{label}</span><span class={`dib-value ${className}`}>{value}</span></div>;
}

function LatencyChart({ series, groupBy, timeFormat, theme, onHour }: {
  series: ChartPoint[]; groupBy: GroupBy; timeFormat: '12h' | '24h'; theme: string; onHour: (ts: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!canvas.current) return;
    const style = getComputedStyle(document.documentElement);
    const color = (name: string) => style.getPropertyValue(name).trim();
    const successes = series.map(point => point.successes);
    const failures = series.map(point => point.failures);
    const latencies = series.map(point => point.avg_latency);
    const config: ChartConfigurationCustomTypesPerDataset<'bar' | 'line'> = {
      data: {
        labels: series.map(point => new Date(point.ts * 1000)),
        datasets: [
          { type: 'bar', label: 'Success', data: successes.map(() => 0), backgroundColor: color('--success'), stack: 'checks', order: 2 },
          { type: 'bar', label: 'Failures', data: failures.map(() => 0), backgroundColor: color('--danger'), stack: 'checks', order: 2 },
          { type: 'line', label: 'Avg latency (ms)', data: latencies.map(() => null), borderColor: color('--chart'),
            backgroundColor: color('--chart'), yAxisID: 'y2', tension: 0.3, pointRadius: 2, spanGaps: false, order: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 400, easing: 'easeOutQuart' },
        scales: {
          x: { type: 'time', stacked: true, offset: true, grid: { color: color('--border') },
            ticks: { color: color('--text2'), maxTicksLimit: 10 },
            time: { unit: groupBy, tooltipFormat: timeFormat === '12h' ? 'dd MMM hh:mm a' : 'dd MMM HH:mm' } },
          y: { stacked: true, beginAtZero: true, grid: { color: color('--border') }, ticks: { color: color('--text2'), precision: 0 },
            title: { display: true, text: 'Checks', color: color('--text2') } },
          y2: { position: 'right', beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { color: color('--chart') },
            title: { display: true, text: 'Latency ms', color: color('--chart') } },
        },
        plugins: { legend: { labels: { color: color('--text2'), boxWidth: 16, boxHeight: 12, padding: 14 } }, tooltip: {
          backgroundColor: color('--bg2'), borderColor: color('--border'), borderWidth: 1,
          titleColor: color('--text'), bodyColor: color('--text2'),
        } },
        onClick: (_event, elements) => {
          const point = elements[0];
          if (groupBy === 'hour' && point && point.datasetIndex < 2) {
            const timestamp = series[point.index]?.ts;
            if (timestamp !== undefined) onHour(timestamp);
          }
        },
      },
    };
    const chart = new Chart(canvas.current, config);
    // Draw an empty baseline first, then update the datasets so the bars grow into view.
    let updateFrame = 0;
    const startFrame = requestAnimationFrame(() => {
      updateFrame = requestAnimationFrame(() => {
        chart.data.datasets[0]!.data = successes;
        chart.data.datasets[1]!.data = failures;
        chart.data.datasets[2]!.data = latencies;
        chart.update();
      });
    });
    return () => { cancelAnimationFrame(startFrame); cancelAnimationFrame(updateFrame); chart.destroy(); };
  }, [series, groupBy, timeFormat, theme, onHour]);
  return <canvas ref={canvas} />;
}

export function DetailModal({ proxy, meta, token, theme, onClose, onError }: {
  proxy: ProxyStatus; meta: StatsData['meta']; token: string; theme: string; onClose: () => void; onError: (error: unknown) => void;
}) {
  const [type, setType] = useState<CheckType>(proxy.tcp_check ? 'tcp' : 'udp');
  const [hours, setHours] = useState(24);
  const [groupBy, setGroupBy] = useState<GroupBy>('hour');
  const [fromTs, setFromTs] = useState<number | undefined>();
  const [toTs, setToTs] = useState<number | undefined>();
  const [series, setSeries] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const last = proxy.stats.last_checks?.[type];
  const total = proxy.stats.total?.[type];
  const otherType: CheckType = type === 'tcp' ? 'udp' : 'tcp';
  const otherEnabled = otherType === 'tcp' ? proxy.tcp_check : proxy.udp_check;
  const otherTotal = proxy.stats.total?.[otherType];
  const checkStatus = last ? (last.success ? '● Online' : '● Offline') : '● No data';
  const checkStatusClass = last ? (last.success ? 'success' : 'danger') : 'muted';
  const recentError = last?.error && last.error_timestamp && last.error_timestamp >= Date.now() / 1000 - meta.window_minutes * 60 ? last.error : null;

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.chart(token, proxy.id, groupBy, hours, fromTs, toTs).then(data => {
      if (active) setSeries(data[type] ?? []);
    }).catch(error => { if (active) onError(error); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, proxy.id, type, groupBy, hours, fromTs, toTs]);

  const setRange = (from?: number, to?: number) => { setFromTs(from); setToTs(to); };
  const drillDown = useCallback((ts: number) => {
    setFromTs(ts); setToTs(ts + 3600); setGroupBy('minute');
  }, []);
  return <Modal title={proxy.name} onClose={onClose} size="large">
    <div class="detail-info-grid">
      <Info label={`${type.toUpperCase()} status`} value={checkStatus} className={checkStatusClass} />
      <Info label="Address" value={`${proxy.host}:${proxy.port}`} className="privacy mono" />
      <Info label="External IP" value={proxy.external_ip ?? '—'} className="privacy" />
      <Info label="Latency" value={latency(last?.latency_ms)} className={latencyLevel(last?.latency_ms)} />
      <Info label={`${type.toUpperCase()} checks`} value={total ? `${total.success}/${total.total} (${rate(total)}%)` : '—'} />
      {otherEnabled && <Info label={`${otherType.toUpperCase()} checks`} value={otherTotal ? `${otherTotal.success}/${otherTotal.total} (${rate(otherTotal)}%)` : '—'} blockClass="secondary-left" />}
      <Info label="Check types" value={[proxy.tcp_check && 'TCP', proxy.udp_check && 'UDP'].filter(Boolean).join(' + ') || 'None'} blockClass={otherEnabled ? 'secondary-right' : 'secondary-full'} />
      {recentError && <Info label="Last error" value={recentError} className="danger" blockClass="secondary-full" />}
    </div>
    <div class="chart-controls">
      {proxy.tcp_check && proxy.udp_check && <div class="chart-control-group"><div class="segmented" role="group" aria-label="Protocol">
        {(['tcp', 'udp'] as const).map(value => <button class={type === value ? 'active' : ''} onClick={() => setType(value)} key={value}>{value.toUpperCase()}</button>)}
      </div></div>}
      <div class="chart-control-group"><div class="segmented" role="group" aria-label="History range">
        {([[1, '1h'], [6, '6h'], [24, '24h'], [168, '7d'], [720, '30d']] as const).map(([value, label]) =>
          <button key={value} class={hours === value && fromTs === undefined ? 'active' : ''} onClick={() => { setHours(value); setRange(); }}>{label}</button>)}
      </div></div>
      <div class="chart-control-group"><div class="segmented" role="group" aria-label="Grouping">
        {(['minute', 'hour', 'day'] as const).map(value => <button key={value} class={groupBy === value ? 'active' : ''} onClick={() => setGroupBy(value)}>{value}</button>)}
      </div></div>
      <div class="chart-control-group"><DateRangePicker fromTs={fromTs} toTs={toTs} hours={hours} retentionDays={meta.retention_days} onChange={(from, to) => setRange(from, to)} /></div>
    </div>
    <div class="chart-container">
      {loading && <div class="chart-loading"><div class="spinner" /></div>}
      {!loading && !series.length && <div class="chart-empty">No history for this range</div>}
      {!loading && series.length > 0 && <LatencyChart series={series} groupBy={groupBy} timeFormat={meta.time_format} theme={theme} onHour={drillDown} />}
    </div>
  </Modal>;
}
