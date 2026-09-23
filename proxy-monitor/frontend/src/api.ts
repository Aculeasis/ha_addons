import type { ChartData, Config, GroupBy, StatsData } from './types';

// All requests are relative to the dashboard, which HA Ingress hosts under
// a per-installation prefix. Vite's dev server uses the same paths at '/'.
export function appBase(): URL {
  const path = window.location.pathname;
  return new URL(path.endsWith('/') ? path : `${path}/`, window.location.origin);
}

export function appUrl(path: string): URL {
  return new URL(path, appBase());
}

export class UnauthorizedError extends Error {}

async function request<T>(path: string, token = '', init: RequestInit = {}): Promise<T> {
  const response = await fetch(appUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'X-Session-Token': token } : {}),
      ...init.headers,
    },
  });
  if (response.status === 401) throw new UnauthorizedError('Session expired');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export const api = {
  authInfo: () => request<{ auth_required: boolean; safeguard: boolean; username: string | null }>('api/auth-info'),
  login: (username: string, password: string) => request<{ token: string }>('api/login', '', {
    method: 'POST', body: JSON.stringify({ username, password }),
  }),
  stats: (token: string) => request<StatsData>('api/stats', token),
  config: (token: string) => request<Config>('api/config', token),
  saveConfig: (token: string, config: Config) => request<{ status: string }>('api/config', token, {
    method: 'POST', body: JSON.stringify(config),
  }),
  dbSize: (token: string) => request<{ size: number; formatted: string }>('api/db-size', token),
  vacuum: (token: string) => request<{ status: string }>('api/db-vacuum', token, { method: 'POST' }),
  chart: (token: string, proxyId: string, groupBy: GroupBy, hours: number, fromTs?: number, toTs?: number) => {
    const params = new URLSearchParams({ proxy_id: proxyId, group_by: groupBy });
    if (fromTs !== undefined) {
      params.set('from_ts', String(fromTs));
      if (toTs !== undefined) params.set('to_ts', String(toTs));
    } else {
      params.set('hours', String(hours));
    }
    return request<ChartData>(`api/proxy/chart?${params}`, token);
  },
};
