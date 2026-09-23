import type { CheckCount, ProxyStatus, SparkPoint } from './types';

export type Status = 'alive' | 'partial' | 'dead' | 'disabled';

export function proxyStatus(proxy: ProxyStatus): Status {
  if (!proxy.tcp_check && !proxy.udp_check) return 'disabled';
  const checks = proxy.stats.last_checks ?? {};
  const tcpOk = !proxy.tcp_check || !!checks.tcp?.success;
  const udpOk = !proxy.udp_check || !!checks.udp?.success;
  if (proxy.is_alive && tcpOk && udpOk) return 'alive';
  return proxy.is_alive ? 'partial' : 'dead';
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

export function sparkline(points?: SparkPoint[]): string | undefined {
  if (!points || points.length < 2) return undefined;
  return points.map((point, index) => {
    const total = point.success + point.fail;
    const x = 2 + index * 296 / (points.length - 1);
    const y = 37 - (total ? point.success / total : 0) * 34;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}
