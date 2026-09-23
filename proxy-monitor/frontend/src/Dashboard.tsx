import type { CheckCount, CheckType, ProxyStatus, StatsData } from './types';
import { latency, latencyLevel, proxyStatus, rate, sparkline } from './format';

function CheckRow({ type, total, recent }: {
  type: CheckType; total?: CheckCount; recent?: CheckCount;
}) {
  const sample = recent?.total ? recent : total;
  const percent = rate(sample);
  return <div class="check-row">
    <span class={`protocol protocol-${type}`}>{type.toUpperCase()}</span>
    <div class="check-progress" role="meter" aria-label={`${type.toUpperCase()} success rate`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={sample?.total ? percent : undefined}>
      <div class={`check-progress-fill ${!sample?.total ? '' : percent >= 75 ? 'success' : percent >= 50 ? 'warning' : 'danger'}`} style={{ width: sample?.total ? `${percent}%` : '0%' }} />
    </div>
    <span class="check-total">{total?.total ? <><span class="success">✓ {total.success}</span> / <span class="danger">✕ {total.fail}</span> ({rate(total)}%)</> : 'No checks'}</span>
    <span class={`check-recent ${recent?.total ? percent >= 75 ? 'success' : percent >= 50 ? 'warning' : 'danger' : ''}`}>{recent?.total ? `${recent.success}/${recent.total} recent` : '—'}</span>
  </div>;
}

function LatencyBadge({ type, recent, last }: { type: CheckType; recent?: CheckCount; last?: number | null }) {
  const average = recent?.lat_avg ?? last;
  return <div class="latency-row" tabIndex={0} aria-label={`${type.toUpperCase()} latency: last ${latency(last)}, average ${latency(recent?.lat_avg)}, minimum ${latency(recent?.lat_min)}, maximum ${latency(recent?.lat_max)}`} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <span class={`protocol protocol-${type}`}>{type.toUpperCase()}</span>
    <span class={`latency-value ${latencyLevel(average)}`}>{latency(average)}</span>
    <div class="latency-tooltip" role="tooltip">
      <strong>{type.toUpperCase()} latency</strong>
      <div><span>Last</span><b>{latency(last)}</b></div>
      <div><span>Avg</span><b>{latency(recent?.lat_avg)}</b></div>
      <div><span>Min</span><b class="success">{latency(recent?.lat_min)}</b></div>
      <div><span>Max</span><b class="warning">{latency(recent?.lat_max)}</b></div>
    </div>
  </div>;
}

function Sparkline({ proxy }: { proxy: ProxyStatus }) {
  const tcp = proxy.tcp_check ? sparkline(proxy.stats.sparkline?.tcp) : undefined;
  const udp = proxy.udp_check ? sparkline(proxy.stats.sparkline?.udp) : undefined;
  if (!tcp && !udp) return null;
  const gradientId = `spark-${proxy.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return <div class="sparkline-wrap"><svg viewBox="0 0 300 40" preserveAspectRatio="none" role="img" aria-label="Recent success history">
    <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--chart)" stop-opacity=".45" /><stop offset="1" stop-color="var(--chart)" stop-opacity="0" /></linearGradient></defs>
    {tcp && <><polygon points={`${tcp} 298,40 2,40`} fill={`url(#${gradientId})`} /><polyline points={tcp} fill="none" stroke="var(--chart)" stroke-width="1.6" /></>}
    {udp && <polyline points={udp} fill="none" stroke="var(--chart2)" stroke-width="1.2" />}
  </svg></div>;
}

function ProxyCard({ proxy, onOpen }: { proxy: ProxyStatus; onOpen: () => void }) {
  const status = proxyStatus(proxy);
  const canOpen = proxy.tcp_check || proxy.udp_check;
  const tags = proxy.tags ?? [];
  const visibleTags = tags.length > 2 ? tags.slice(0, 1) : tags;
  const hiddenTagCount = tags.length - visibleTags.length;
  return <article class="proxy-card" role={canOpen ? 'button' : undefined} tabIndex={canOpen ? 0 : undefined}
    onClick={canOpen ? onOpen : undefined}
    onKeyDown={canOpen ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } } : undefined}>
    <div class="card-heading">
      <span class={`status-dot ${status}`} aria-label={status} />
      <div class="card-identity">
        <div class="card-name">{proxy.name}</div>
        <div class="card-address privacy">{proxy.host}:{proxy.port}</div>
        {(proxy.external_ip || tags.length > 0) && <div class="card-meta">
          {proxy.external_ip && <span class="card-ip" title={`External IP: ${proxy.external_ip}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9S14.5 18.5 12 21M12 3C9.5 5.5 8.2 8.5 8.2 12S9.5 18.5 12 21" /></svg>
            <span class="privacy">{proxy.external_ip}</span>
          </span>}
          {tags.length > 0 && <span class={`card-tags ${proxy.external_ip ? 'with-ip' : ''}`} role="group" tabIndex={hiddenTagCount ? 0 : undefined} aria-label={`Tags: ${tags.join(', ')}`} onKeyDown={event => event.stopPropagation()}>
            <span class="tag-preview">
              {visibleTags.map(tag => <span class="tag" title={tag} key={tag}>{tag}</span>)}
              {hiddenTagCount > 0 && <span class="tag tag-more">+{hiddenTagCount}</span>}
            </span>
            {hiddenTagCount > 0 && <span class="tag-popover" role="tooltip">{tags.map(tag => <span class="tag" key={tag}>{tag}</span>)}</span>}
          </span>}
        </div>}
      </div>
      {canOpen && <div class="card-latencies">
        {proxy.tcp_check && <LatencyBadge type="tcp" recent={proxy.stats.window?.tcp} last={proxy.stats.last_checks?.tcp?.latency_ms} />}
        {proxy.udp_check && <LatencyBadge type="udp" recent={proxy.stats.window?.udp} last={proxy.stats.last_checks?.udp?.latency_ms} />}
      </div>}
    </div>
    <div class="card-checks">
      {proxy.tcp_check && <CheckRow type="tcp" total={proxy.stats.total?.tcp} recent={proxy.stats.window?.tcp} />}
      {proxy.udp_check && <CheckRow type="udp" total={proxy.stats.total?.udp} recent={proxy.stats.window?.udp} />}
      {!canOpen && <span class="muted">Checks are disabled</span>}
    </div>
    <Sparkline proxy={proxy} />
  </article>;
}

export function Dashboard({ data, onOpen }: { data: StatsData | null; onOpen: (id: string) => void }) {
  if (!data) return <div class="empty-state"><div class="spinner" /><p>Connecting to monitor…</p></div>;
  if (!data.proxies.length) return <div class="empty-state"><div class="empty-icon">◉</div><h2>No proxies yet</h2><p>Add a proxy in Settings to start monitoring.</p></div>;
  return <div class="proxy-grid">
    {data.proxies.map(proxy => <ProxyCard key={proxy.id} proxy={proxy} onOpen={() => onOpen(proxy.id)} />)}
  </div>;
}
