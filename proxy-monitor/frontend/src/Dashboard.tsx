import { useRef, useState } from 'preact/hooks';
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
  const tcp = proxy.tcp_check ? sparkline(proxy.stats.sparkline?.tcp, proxy.stats.window?.tcp) : undefined;
  const udp = proxy.udp_check ? sparkline(proxy.stats.sparkline?.udp, proxy.stats.window?.udp) : undefined;
  if (!tcp && !udp) return null;
  const gradientId = `spark-${proxy.id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return <div class="sparkline-wrap"><svg viewBox="0 0 300 40" preserveAspectRatio="none" role="img" aria-label="Recent success history">
    <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--chart)" stop-opacity=".45" /><stop offset="1" stop-color="var(--chart)" stop-opacity="0" /></linearGradient></defs>
    {tcp && <><polygon points={`${tcp} 298,40 2,40`} fill={`url(#${gradientId})`} /><polyline points={tcp} fill="none" stroke="var(--chart)" stroke-width="1.6" /></>}
    {udp && <polyline points={udp} fill="none" stroke="var(--chart2)" stroke-width="1.2" />}
  </svg></div>;
}

function ProxyCard({ proxy, privacy, onOpen, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, dropTarget, dragging, offset }: {
  proxy: ProxyStatus; onOpen: () => void;
  privacy: boolean;
  onPointerDown: (event: PointerEvent) => void; onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void; onPointerCancel: () => void;
  dropTarget: boolean; dragging: boolean; offset: { x: number; y: number };
}) {
  const status = proxyStatus(proxy);
  const canOpen = proxy.tcp_check || proxy.udp_check;
  const tags = proxy.tags ?? [];
  const visibleTags = tags.length > 2 ? tags.slice(0, 1) : tags;
  const hiddenTagCount = tags.length - visibleTags.length;
  return <article class={`proxy-card ${dropTarget ? 'drag-over' : ''} ${dragging ? 'dragging' : ''}`}
    role={canOpen ? 'button' : undefined} tabIndex={canOpen ? 0 : undefined}
    style={dragging ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}
    onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel}
    onClick={canOpen ? onOpen : undefined}
    onKeyDown={canOpen ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); } } : undefined}>
    <div class="card-heading">
      <span class={`status-dot ${status}`} aria-label={status} />
      <div class="card-identity">
        <div class="card-name privacy">{proxy.name}</div>
        <div class="card-address privacy">{proxy.host}:{proxy.port}</div>
        {(proxy.external_ip || tags.length > 0) && <div class="card-meta">
          {proxy.external_ip && <span class="card-ip privacy" title={privacy ? undefined : `External IP: ${proxy.external_ip}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9S14.5 18.5 12 21M12 3C9.5 5.5 8.2 8.5 8.2 12S9.5 18.5 12 21" /></svg>
            <span>{proxy.external_ip}</span>
          </span>}
          {tags.length > 0 && <span class={`card-tags privacy ${proxy.external_ip ? 'with-ip' : ''}`} role="group" tabIndex={hiddenTagCount ? 0 : undefined} aria-label={`Tags: ${tags.join(', ')}`} onKeyDown={event => event.stopPropagation()}>
            <span class="tag-preview">
              {visibleTags.map(tag => <span class="tag" title={privacy ? undefined : tag} key={tag}>{tag}</span>)}
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

export function Dashboard({ data, orderedIds, query, statusFilter, privacy, viewMode, onOpen, onReorder }: {
  data: StatsData | null; orderedIds: string[] | null; query: string; statusFilter: 'all' | 'alive' | 'partial' | 'dead'; privacy: boolean; viewMode: 'cards' | 'table';
  onOpen: (id: string) => void; onReorder: (ids: string[]) => void;
}) {
  const dragId = useRef<string | null>(null);
  const pointerDrag = useRef<{ id: string; pointerId: number; x: number; y: number; active: boolean } | null>(null);
  const pointerOverId = useRef<string | null>(null);
  const suppressClickUntil = useRef(0);
  const [overId, setOverId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  if (!data) return <div class="empty-state"><div class="spinner" /><p>Connecting to monitor…</p></div>;
  if (!data.proxies.length) return <div class="empty-state"><div class="empty-icon">◉</div><h2>No proxies yet</h2><p>Add a proxy in Settings to start monitoring.</p></div>;
  const rank = new Map(orderedIds?.map((id, index) => [id, index]));
  const ordered = [...data.proxies].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  const needle = query.trim().toLocaleLowerCase();
  const visible = ordered.filter(proxy => (statusFilter === 'all' || proxyStatus(proxy) === statusFilter) &&
    (!needle || [proxy.name, proxy.host, proxy.external_ip ?? '', ...(proxy.tags ?? [])]
      .some(value => value.toLocaleLowerCase().includes(needle))));
  if (!visible.length) return <div class="empty-state"><h2>No matching proxies</h2><p>Try another search term.</p></div>;
  const canDrag = !needle;
  const swap = (source: string, target: string) => {
    if (source === target) return;
    const ids = ordered.map(item => item.id);
    const from = ids.indexOf(source);
    const to = ids.indexOf(target);
    if (from < 0 || to < 0) return;
    [ids[from], ids[to]] = [ids[to]!, ids[from]!];
    onReorder(ids);
  };
  const targetAt = (x: number, y: number, source: string) =>
    document.elementsFromPoint(x, y).map(element => element.closest<HTMLElement>('.proxy-card-shell')?.dataset.proxyId)
      .find(id => id && id !== source) ?? null;
  const pointerDown = (proxy: ProxyStatus, event: PointerEvent) => {
    if (!canDrag || event.button !== 0 || event.pointerType === 'touch' ||
        (event.target as HTMLElement).closest('button, input, a, .latency-row, .card-tags')) return;
    pointerDrag.current = { id: proxy.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, active: false };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent) => {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const x = event.clientX - drag.x;
    const y = event.clientY - drag.y;
    if (!drag.active && Math.hypot(x, y) < 6) return;
    if (!drag.active) { drag.active = true; setDraggingId(drag.id); }
    event.preventDefault();
    setDragOffset({ x, y });
    pointerOverId.current = targetAt(event.clientX, event.clientY, drag.id);
    setOverId(pointerOverId.current);
  };
  const pointerUp = (event: PointerEvent) => {
    const drag = pointerDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    if (drag.active) {
      suppressClickUntil.current = Date.now() + 300;
      const target = targetAt(event.clientX, event.clientY, drag.id) ?? pointerOverId.current;
      if (target) swap(drag.id, target);
    }
    pointerDrag.current = null;
    pointerOverId.current = null;
    setDraggingId(null);
    setOverId(null);
    setDragOffset({ x: 0, y: 0 });
  };
  const pointerCancel = () => {
    pointerDrag.current = null;
    pointerOverId.current = null;
    setDraggingId(null);
    setOverId(null);
    setDragOffset({ x: 0, y: 0 });
  };
  const startDrag = (proxy: ProxyStatus, event: DragEvent) => {
    if (!canDrag) { event.preventDefault(); return; }
    dragId.current = proxy.id;
    setDraggingId(proxy.id);
    event.dataTransfer?.setData('text/plain', proxy.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  };
  const endDrag = () => {
    dragId.current = null;
    suppressClickUntil.current = Date.now() + 300;
    setDraggingId(null);
    setOverId(null);
  };
  const dragOver = (id: string, event: DragEvent) => {
    if (!canDrag || !dragId.current) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (dragId.current !== id) setOverId(id);
  };
  const drop = (id: string, event: DragEvent) => {
    event.preventDefault();
    setOverId(null);
    const source = dragId.current || event.dataTransfer?.getData('text/plain');
    if (!source || source === id) return;
    swap(source, id);
    dragId.current = null;
  };
  if (viewMode === 'table') return <div class="proxy-table-wrap"><table class="proxy-table">
    <thead><tr><th>Proxy</th><th>Status</th><th>Address</th><th>TCP</th><th>UDP</th><th>Tags</th></tr></thead>
    <tbody>{visible.map(proxy => <tr key={proxy.id} data-proxy-id={proxy.id} draggable={!needle}
      class={`${overId === proxy.id ? 'drag-over' : ''} ${draggingId === proxy.id ? 'dragging' : ''}`}
      onDragStart={event => startDrag(proxy, event)} onDragEnd={endDrag}
      onDragOver={event => dragOver(proxy.id, event)} onDrop={event => drop(proxy.id, event)}>
      <td><button class="table-proxy-name privacy" onClick={() => onOpen(proxy.id)}>{proxy.name}</button></td>
      <td><span class={`status-dot ${proxyStatus(proxy)}`} /> {proxyStatus(proxy)}</td>
      <td class="privacy mono">{proxy.host}:{proxy.port}</td>
      {(['tcp', 'udp'] as const).map(type => <td key={type}>{proxy[`${type}_check`] ?
        <>{latency(proxy.stats.window?.[type]?.lat_avg ?? proxy.stats.last_checks?.[type]?.latency_ms)} · {rate(proxy.stats.window?.[type])}%</> : '—'}</td>)}
      <td class="privacy">{proxy.tags?.join(', ') || '—'}</td>
    </tr>)}</tbody>
  </table></div>;
  return <div class="proxy-grid">
    {visible.map(proxy => <div class={`proxy-card-shell ${draggingId === proxy.id ? 'dragging' : ''}`} key={proxy.id} data-proxy-id={proxy.id}>
      <ProxyCard proxy={proxy} privacy={privacy} onOpen={() => { if (Date.now() >= suppressClickUntil.current) onOpen(proxy.id); }}
        onPointerDown={event => pointerDown(proxy, event)} onPointerMove={pointerMove}
        onPointerUp={pointerUp} onPointerCancel={pointerCancel}
        dropTarget={overId === proxy.id} dragging={draggingId === proxy.id} offset={dragOffset} />
    </div>)}
  </div>;
}
