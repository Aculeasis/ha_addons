'use strict';

// ─── State ────────────────────────────────────────────────────────
const state = {
  proxies: [],
  summary: { total: 0, alive: 0, dead: 0 },
  lastUpdated: null,
  meta: {},
  wsConnected: false,
  sessionToken: sessionStorage.getItem('pm_token') || '',
  detailProxyId: null,
  detailHours: 24,
  detailGroupBy: 'hour',
  detailCheckType: 'tcp',
  detailChart: null,
  detailFromTs: null,  // Specific timestamp to start from (null = use last N hours)
  detailToTs: null,    // Specific timestamp to end at (null = use now)
  editingProxyIndex: null,
  pendingConfig: null,
  dbSizeFormatted: null,
  safeguard: false,
  theme: localStorage.getItem('pm_theme') || 'system',
  privacyMode: localStorage.getItem('pm_privacy') === 'true',
};
