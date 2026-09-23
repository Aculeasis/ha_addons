export type CheckType = 'tcp' | 'udp';
export type GroupBy = 'minute' | 'hour' | 'day';

export interface CheckCount {
  success: number;
  fail: number;
  total: number;
  lat_avg?: number | null;
  lat_min?: number | null;
  lat_max?: number | null;
}

export interface LastCheck {
  success: boolean;
  latency_ms: number | null;
  external_ip: string | null;
  error: string | null;
  timestamp: number | null;
  error_timestamp: number | null;
}

export interface SparkPoint {
  ts: number;
  success: number;
  fail: number;
  avg_latency: number | null;
}

export interface ProxyStats {
  total?: Partial<Record<CheckType, CheckCount>>;
  window?: Partial<Record<CheckType, CheckCount>>;
  last_checks?: Partial<Record<CheckType, LastCheck>>;
  sparkline?: Partial<Record<CheckType, SparkPoint[]>>;
}

export interface ProxyStatus {
  id: string;
  name: string;
  host: string;
  port: number;
  tags: string[];
  tcp_check: boolean;
  udp_check: boolean;
  is_alive: boolean;
  external_ip: string | null;
  stats: ProxyStats;
}

export interface StatsData {
  proxies: ProxyStatus[];
  summary: { total: number; alive: number; partial: number; dead: number };
  last_updated: number;
  meta: { window_minutes: number; check_interval: number; time_format: '12h' | '24h'; retention_days: number };
}

export interface ChartPoint {
  ts: number;
  successes: number;
  failures: number;
  avg_latency: number | null;
  min_latency: number | null;
  max_latency: number | null;
}
export type ChartData = Partial<Record<CheckType, ChartPoint[]>>;

export interface ProxyConfig {
  name: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  tcp_check: boolean;
  udp_check: boolean;
  tags: string[];
}

export interface Config {
  server: {
    host: string; port: number; username: string; password: string;
    trusted_ips: string[]; whitelist: string[]; time_format: '12h' | '24h'; log_level: string;
    [key: string]: unknown;
  };
  monitoring: {
    check_interval_seconds: number; check_timeout_seconds: number; concurrent_checks: number;
    recent_window_minutes: number; tcp_test_url: string; udp_test_ip: string;
    [key: string]: unknown;
  };
  storage: { db_path: string; retention_days: number; cleanup_interval_minutes: number; [key: string]: unknown };
  proxies: ProxyConfig[];
  [key: string]: unknown;
}
