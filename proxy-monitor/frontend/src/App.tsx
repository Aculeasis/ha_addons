import { useEffect, useRef, useState } from 'preact/hooks';
import { api, UnauthorizedError } from './api';
import { Dashboard } from './Dashboard';
import { DetailModal } from './DetailModal';
import { Modal } from './Modal';
import { connectStats } from './realtime';
import { SettingsModal } from './SettingsModal';
import { proxyStatus } from './format';
import type { StatsData } from './types';

type Theme = 'system' | 'light' | 'dark';
type Toast = { id: number; kind: 'success' | 'info' | 'error'; message: string };

function ThemeIcon({ theme }: { theme: Theme }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {theme === 'dark' ? <path d="M20.4 15.2A8.5 8.5 0 0 1 8.8 3.6 8.5 8.5 0 1 0 20.4 15.2Z" />
      : theme === 'light' ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
      : <><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 22h8m-4-4v4" /></>}
  </svg>;
}

function PrivacyIcon({ hidden }: { hidden: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z" />
    <circle cx="12" cy="12" r="3" />
    {hidden && <path d="M3 3l18 18" />}
  </svg>;
}

function Login({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try { await onLogin(username.trim(), password); }
    catch { setError('Invalid credentials or connection error'); }
    finally { setBusy(false); }
  };
  return <Modal title="Sign in" onClose={() => {}} size="small" dismissible={false}>
    <form class="login-form" onSubmit={submit}>
      <div class="login-mark">◉</div>
      <label class="field">Username<input autoComplete="username" value={username} onInput={event => setUsername(event.currentTarget.value)} /></label>
      <label class="field">Password<input type="password" autoComplete="current-password" value={password} onInput={event => setPassword(event.currentTarget.value)} /></label>
      {error && <p class="form-error">{error}</p>}
      <button class="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </Modal>;
}

export function App() {
  const [token, setToken] = useState(() => sessionStorage.getItem('pm_token') ?? '');
  const [authRequired, setAuthRequired] = useState<boolean | null>(null);
  const [safeguard, setSafeguard] = useState(false);
  const [data, setData] = useState<StatsData | null>(null);
  const [connected, setConnected] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('pm_theme');
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  });
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const [privacy, setPrivacy] = useState(() => localStorage.getItem('pm_privacy') === 'true');
  const [themeMenu, setThemeMenu] = useState(false);
  const themeControl = useRef<HTMLDivElement>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = (kind: Toast['kind'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts(current => [...current, { id, kind, message }]);
    window.setTimeout(() => setToasts(current => current.filter(item => item.id !== id)), 4500);
  };
  const logout = () => { sessionStorage.removeItem('pm_token'); setToken(''); setAuthRequired(true); setData(null); };
  const handleError = (error: unknown) => {
    if (error instanceof UnauthorizedError) logout();
    else notify('error', error instanceof Error ? error.message : 'Request failed');
  };

  useEffect(() => {
    api.authInfo().then(info => { setAuthRequired(info.auth_required); setSafeguard(info.safeguard); })
      .catch(() => setAuthRequired(false));
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
      setResolvedTheme(resolved);
    };
    apply();
    media.addEventListener('change', apply);
    localStorage.setItem('pm_theme', theme);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    document.body.classList.toggle('privacy-mode', privacy);
    localStorage.setItem('pm_privacy', String(privacy));
  }, [privacy]);

  useEffect(() => {
    if (authRequired === null || (authRequired && !token)) return;
    api.stats(token).then(setData).catch(handleError);
    return connectStats(token, { onStats: setData, onConnection: setConnected, onUnauthorized: logout });
  }, [authRequired, token]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (detailId) setDetailId(null);
        else if (settingsOpen) setSettingsOpen(false);
        else setThemeMenu(false);
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [detailId, settingsOpen]);

  useEffect(() => {
    if (!themeMenu) return;
    const closeOutside = (event: PointerEvent) => {
      if (!themeControl.current?.contains(event.target as Node)) setThemeMenu(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [themeMenu]);

  const login = async (username: string, password: string) => {
    const result = await api.login(username, password);
    sessionStorage.setItem('pm_token', result.token);
    setToken(result.token);
  };
  const proxy = data?.proxies.find(item => item.id === detailId);
  const summary = data?.summary;
  const names = (status: 'alive' | 'partial' | 'dead') => data?.proxies.filter(item => proxyStatus(item) === status).map(item => item.name).join('\n') ?? '';

  return <>
    <header class="app-bar">
      <div class="app-title"><span class="app-logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" /></svg></span><span>Proxy Monitor</span></div>
      <div class="status-summary" aria-label="Proxy summary">
        <span class="summary-pill total">Total: <strong>{summary?.total ?? '—'}</strong></span>
        <span class="summary-pill alive" title={names('alive')}><span class="summary-indicator" />Alive: <strong>{summary?.alive ?? '—'}</strong></span>
        <span class="summary-pill partial" title={names('partial')}><span class="summary-indicator" />Partial: <strong>{summary?.partial ?? '—'}</strong></span>
        <span class="summary-pill dead" title={names('dead')}><span class="summary-indicator" />Dead: <strong>{summary?.dead ?? '—'}</strong></span>
      </div>
      <div class="app-actions">
        <span class={`connection-dot ${connected ? 'connected' : ''}`} title={connected ? 'Live connection active' : 'Reconnecting'} />
        <span class="updated-at">{data ? `Updated ${new Date(data.last_updated * 1000).toLocaleTimeString([], { hour12: data.meta.time_format === '12h' })}` : 'Connecting…'}</span>
        <div class="theme-control" ref={themeControl}>
          <button class="icon-button toolbar-icon" title={`Theme: ${theme}`} aria-label="Theme" aria-expanded={themeMenu} onClick={() => setThemeMenu(!themeMenu)}><ThemeIcon theme={theme} /></button>
          {themeMenu && <div class="theme-menu">
            {(['system', 'light', 'dark'] as const).map(value => <button key={value} class={theme === value ? 'selected' : ''} onClick={() => { setTheme(value); setThemeMenu(false); }}><ThemeIcon theme={value} />{value}</button>)}
          </div>}
        </div>
        <button class="icon-button toolbar-icon" title={privacy ? 'Disable privacy mode' : 'Enable privacy mode'} aria-label={privacy ? 'Disable privacy mode' : 'Enable privacy mode'} aria-pressed={privacy} onClick={() => setPrivacy(!privacy)}><PrivacyIcon hidden={privacy} /></button>
        <button class="btn btn-ghost settings-button" onClick={() => setSettingsOpen(true)} aria-label="Settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg><span>Settings</span></button>
      </div>
    </header>
    <main class="page-content"><Dashboard data={data} onOpen={setDetailId} /></main>
    {proxy && data && <DetailModal key={proxy.id} proxy={proxy} meta={data.meta} token={token} theme={resolvedTheme} onClose={() => setDetailId(null)} onError={handleError} />}
    {settingsOpen && <SettingsModal token={token} safeguard={safeguard} onClose={() => setSettingsOpen(false)} onSaved={() => setSettingsOpen(false)} onError={handleError} notify={notify} />}
    {authRequired && !token && <Login onLogin={login} />}
    <div class="toast-stack" aria-live="polite">{toasts.map(item => <div class={`toast ${item.kind}`} key={item.id}>{item.message}</div>)}</div>
  </>;
}
