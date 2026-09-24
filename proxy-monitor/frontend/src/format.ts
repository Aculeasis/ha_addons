import type { CheckCount, ProxyStatus, SparkPoint, Status } from './types';

export const statusLabels: Record<Status, string> = {
  alive: 'Alive', partial: 'Partial', dead: 'Dead', unknown: 'Not checked', stale: 'Stale', disabled: 'Disabled',
};

export function proxyStatus(proxy: ProxyStatus, now: number): Status {
  if (proxy.fresh_until !== null && now > proxy.fresh_until && proxy.status !== 'disabled') return 'stale';
  return proxy.status;
}

export function checkDateTime(timestamp: number | null | undefined, timeFormat: '12h' | '24h'): string {
  if (timestamp == null) return 'Never';
  const date = new Date(timestamp * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${pad(date.getFullYear() % 100)}`;
  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: timeFormat === '12h' }).format(date);
  return `${day}, ${time}`;
}

export function rate(stats?: CheckCount): number {
  return stats?.total ? Math.round(stats.success / stats.total * 100) : 0;
}

export function latency(ms: number | null | undefined): string {
  if (ms == null) return '—';
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function latencyLevel(ms: number | null | undefined): string {
  if (ms == null) return '';
  return ms < 500 ? 'success' : ms < 2000 ? 'warning' : 'danger';
}

export function sparkline(points?: SparkPoint[], recent?: CheckCount): string | undefined {
  if (!points || !recent || recent.total < 2 || points.length < recent.total) return undefined;
  const visible = points.slice(-recent.total);
  if (visible.reduce((sum, point) => sum + point.success, 0) !== recent.success ||
      visible.reduce((sum, point) => sum + point.fail, 0) !== recent.fail) return undefined;
  return visible.map((point, index) => {
    const total = point.success + point.fail;
    const x = index * 300 / (visible.length - 1);
    const y = 37 - (total ? point.success / total : 0) * 34;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}
