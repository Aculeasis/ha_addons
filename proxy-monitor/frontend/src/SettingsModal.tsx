import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from './api';
import { DragHandle } from './DragHandle';
import { Modal } from './Modal';
import type { Config, ProxyConfig } from './types';

const blankProxy = (): ProxyConfig => ({ name: '', host: '', port: 1080, tcp_check: true, udp_check: false, tags: [] });
const lines = (value: string) => value.split('\n').map(item => item.trim()).filter(Boolean);
const validUdpAddress = (value: string) => {
  const parts = value.split(':');
  if (parts.length > 2) return false;
  const octets = parts[0]?.split('.') ?? [];
  if (octets.length !== 4 || !octets.every(n => /^\d{1,3}$/.test(n) && Number(n) <= 255)) return false;
  return parts.length === 1 || /^\d+$/.test(parts[1] ?? '') && Number(parts[1]) >= 1 && Number(parts[1]) <= 65535;
};

function SectionTitle({ title, icon }: { title: string; icon: 'proxies' | 'monitoring' | 'server' | 'storage' }) {
  return <h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {icon === 'proxies' ? <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 5" /></>
      : icon === 'monitoring' ? <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>
      : icon === 'server' ? <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></>
      : <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" /></>}
  </svg>{title}</h3>;
}

function ProxyEditor({ initial, mode, onSave, onCancel }: {
  initial: ProxyConfig; mode: 'add' | 'edit' | 'copy'; onSave: (proxy: ProxyConfig) => string | undefined; onCancel: () => void;
}) {
  const [value, setValue] = useState<ProxyConfig>({ ...initial, tags: [...(initial.tags ?? [])] });
  const [tagText, setTagText] = useState('');
  const tagInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const field = (key: keyof ProxyConfig, next: unknown) => setValue(current => ({ ...current, [key]: next }));
  const addTags = (text: string) => {
    const added = text.split(',').map(tag => tag.trim()).filter(Boolean);
    if (added.length) setValue(current => ({ ...current, tags: [...new Set([...current.tags, ...added])] }));
  };
  const tagInputChanged = (text: string) => {
    if (text.includes(',')) {
      const parts = text.split(',');
      setTagText(parts.pop() ?? '');
      addTags(parts.join(','));
    } else setTagText(text);
  };
  const save = () => {
    if (!value.name.trim() || !value.host.trim() || !Number.isInteger(Number(value.port)) || Number(value.port) < 1 || Number(value.port) > 65535) {
      setError('Name, host and a port from 1 to 65535 are required.');
      return;
    }
    const message = onSave({ ...value, name: value.name.trim(), host: value.host.trim(), port: Number(value.port), tags: [...new Set([...value.tags, ...tagText.split(',')].map(tag => tag.trim()).filter(Boolean))] });
    if (message) setError(message);
  };
  return <div class="proxy-editor">
    <h4>{mode === 'copy' ? 'Copy proxy' : mode === 'edit' ? 'Edit proxy' : 'Add proxy'}</h4>
    <div class="form-grid">
      <label class="field">Name *<input value={value.name} onInput={event => field('name', event.currentTarget.value)} /></label>
      <label class="field">Host *<input value={value.host} onInput={event => field('host', event.currentTarget.value)} /></label>
      <label class="field">Port *<input type="number" min="1" max="65535" value={value.port} onInput={event => field('port', Number(event.currentTarget.value))} /></label>
      <label class="field">Username<input value={value.username ?? ''} onInput={event => field('username', event.currentTarget.value)} /></label>
      <label class="field">Password<input type="password" value={value.password ?? ''} onInput={event => field('password', event.currentTarget.value)} /></label>
      <div class="field field-wide">
        <label for="proxy-tags">Tags</label>
        <div class="tags-input" onClick={() => tagInput.current?.focus()}>
          {value.tags.map(tag => <span class="tag-chip" key={tag} title={tag}><span>{tag}</span><button type="button" aria-label={`Remove tag ${tag}`} onClick={event => { event.stopPropagation(); setValue(current => ({ ...current, tags: current.tags.filter(item => item !== tag) })); }}>×</button></span>)}
          <input id="proxy-tags" ref={tagInput} value={tagText} onInput={event => tagInputChanged(event.currentTarget.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addTags(tagText); setTagText(''); }
              else if (event.key === 'Backspace' && !tagText) setValue(current => ({ ...current, tags: current.tags.slice(0, -1) }));
            }} onBlur={() => { addTags(tagText); setTagText(''); }} placeholder={value.tags.length ? 'Add a tag…' : 'Type a tag and press Enter'} aria-label="Add tag" />
        </div>
      </div>
    </div>
    <div class="check-options">
      <label><input type="checkbox" checked={value.tcp_check} onChange={event => field('tcp_check', event.currentTarget.checked)} /> TCP check</label>
      <label><input type="checkbox" checked={value.udp_check} onChange={event => field('udp_check', event.currentTarget.checked)} /> UDP check</label>
    </div>
    {error && <p class="form-error">{error}</p>}
    <div class="form-actions"><button class="btn btn-primary" onClick={save}>Apply to draft</button><button class="btn btn-ghost" onClick={onCancel}>Cancel</button></div>
  </div>;
}

export function SettingsModal({ token, safeguard, viewMode, onViewChange, onClose, onSaved, onError, notify }: {
  token: string; safeguard: boolean; viewMode: 'cards' | 'table'; onViewChange: (view: 'cards' | 'table') => void;
  onClose: () => void; onSaved: () => void;
  onError: (error: unknown) => void; notify: (kind: 'success' | 'info' | 'error', message: string) => void;
}) {
  const [draft, setDraft] = useState<Config | null>(null);
  const original = useRef<Config | null>(null);
  const [size, setSize] = useState('');
  const [draftView, setDraftView] = useState(viewMode);
  const [proxySearch, setProxySearch] = useState('');
  const [newInitial, setNewInitial] = useState<ProxyConfig>(blankProxy());
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [trustedText, setTrustedText] = useState('');
  const [whitelistText, setWhitelistText] = useState('');
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [vacuuming, setVacuuming] = useState(false);
  const [error, setError] = useState('');
  const settingsContent = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || !/^[1-4]$/.test(event.key)) return;
      if (document.querySelectorAll('.modal').length > 1) return;
      const section = settingsContent.current?.querySelectorAll<HTMLElement>(':scope > .settings-section')[Number(event.key) - 1];
      if (!section) return;
      event.preventDefault();
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([api.config(token), api.dbSize(token)]).then(([config, db]) => {
      if (active) {
        original.current = structuredClone({ ...config, server: { ...config.server,
          trusted_ips: config.server.trusted_ips ?? [], whitelist: config.server.whitelist ?? [] } });
        setDraft(structuredClone(config));
        setSize(db.formatted);
        setTrustedText((config.server.trusted_ips ?? []).join('\n'));
        setWhitelistText((config.server.whitelist ?? []).join('\n'));
      }
    }).catch(err => { if (active) onError(err); });
    return () => { active = false; };
  }, [token]);

  const patch = (section: 'server' | 'monitoring' | 'storage', key: string, value: unknown) => {
    setDraft(current => current ? { ...current, [section]: { ...current[section], [key]: value } } as Config : null);
  };
  const updateProxies = (proxies: ProxyConfig[]) => setDraft(current => current ? { ...current, proxies } : null);
  const moveTo = (index: number, to: number) => {
    if (!draft) return;
    if (to < 0 || to >= draft.proxies.length) return;
    const proxies = [...draft.proxies];
    proxies.splice(to, 0, ...proxies.splice(index, 1));
    updateProxies(proxies);
    setEditing(null);
    setDeleting(null);
    setDraggingIndex(null);
    setOverIndex(null);
  };
  const saveProxy = (proxy: ProxyConfig): string | undefined => {
    if (!draft) return;
    if (draft.proxies.some((item, index) => index !== editing && item.host.trim() === proxy.host && item.port === proxy.port)) {
      return 'A proxy with this host and port already exists.';
    }
    const proxies = [...draft.proxies];
    if (editing === 'new') proxies.push(proxy);
    else if (typeof editing === 'number') proxies[editing] = proxy;
    updateProxies(proxies);
    setEditing(null);
    notify('info', `Proxy ${editing === 'new' ? 'added' : 'updated'} in draft. Save settings to apply.`);
  };
  const configForSave = () => draft ? { ...draft, server: { ...draft.server, trusted_ips: lines(trustedText), whitelist: lines(whitelistText) } } : null;
  const configDirty = !!draft && JSON.stringify(configForSave()) !== JSON.stringify(original.current);
  const dirty = configDirty || draftView !== viewMode || editing !== null || deleting !== null;
  const requestClose = () => dirty ? setDiscardConfirm(true) : onClose();
  const save = async () => {
    if (!draft) return;
    const numericFields: Array<[number, number, number]> = [
      [draft.server.port, 1, 65535],
      [draft.monitoring.check_interval_seconds, 5, Infinity],
      [draft.monitoring.check_timeout_seconds, 1, Infinity],
      [draft.monitoring.concurrent_checks, 1, Infinity],
      [draft.monitoring.recent_window_minutes, 1, Infinity],
      [draft.storage.retention_days, 1, Infinity],
      [draft.storage.cleanup_interval_minutes, 10, Infinity],
    ];
    if (numericFields.some(([value, min, max]) => !Number.isInteger(value) || value < min || value > max)) {
      setError('Check numeric settings: one or more values are outside the allowed range.');
      return;
    }
    if (!validUdpAddress((draft.monitoring.udp_test_ip || '1.1.1.1:53').trim())) {
      setError('UDP test address must be an IPv4 address, optionally followed by :port.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (configDirty) {
        await api.saveConfig(token, configForSave()!);
        notify('success', 'Settings saved');
      }
      onViewChange(draftView);
      onSaved();
    } catch (err) { onError(err); }
    finally { setSaving(false); }
  };
  const vacuum = async () => {
    setVacuuming(true);
    try {
      await api.vacuum(token);
      setSize((await api.dbSize(token)).formatted);
      notify('success', 'Database optimized');
    } catch (err) { onError(err); }
    finally { setVacuuming(false); }
  };

  return <><Modal title="Settings" onClose={requestClose} size="medium" footer={<>
    <button class="btn btn-ghost" onClick={requestClose}>Cancel</button>
    <button class="btn btn-primary" disabled={!draft || saving || editing !== null || deleting !== null} onClick={save}
      title={editing !== null || deleting !== null ? 'Finish editing the proxy first' : undefined}>{saving ? 'Saving…' : 'Save'}</button>
  </>}>
    {!draft ? <div class="loading-panel"><div class="spinner" /> Loading settings…</div> : <div class="settings-content" ref={settingsContent}>
      <section class="settings-section proxies-section">
        <div class="section-heading"><SectionTitle title="Proxies" icon="proxies" />
          <input class="settings-proxy-search" type="search" aria-label="Search configured proxies" placeholder="Search proxies" value={proxySearch}
            onInput={event => setProxySearch(event.currentTarget.value)} />
        </div>
        <div class="proxy-list">
          {draft.proxies.map((proxy, index) => ({ proxy, index })).filter(({ proxy }) => !proxySearch.trim() ||
            [proxy.name, proxy.host, ...(proxy.tags ?? [])].some(value => value.toLocaleLowerCase().includes(proxySearch.trim().toLocaleLowerCase())))
            .map(({ proxy, index }) => <div key={`${proxy.host}:${proxy.port}`} onDragOver={event => {
              if (proxySearch || draggingIndex === null || draggingIndex === index) return;
              event.preventDefault(); setOverIndex(index);
            }} onDrop={event => { event.preventDefault(); if (draggingIndex !== null) moveTo(draggingIndex, index); }}>
            <div class={`proxy-item ${overIndex === index ? 'drag-over' : ''}`}>
              <DragHandle label={`Move ${proxy.name}; use arrow keys to reorder`} disabled={!!proxySearch}
                onDragStart={event => { event.dataTransfer?.setData('text/plain', String(index)); setDraggingIndex(index); }}
                onDragEnd={() => { setDraggingIndex(null); setOverIndex(null); }}
                onKeyDown={event => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                  event.preventDefault(); moveTo(index, index + (event.key === 'ArrowUp' ? -1 : 1));
                }} />
              <div class="proxy-item-info"><div class="proxy-item-head"><strong class="privacy">{proxy.name}</strong>
                {proxy.tcp_check && <span class="proxy-type-badge">TCP</span>}
                {proxy.udp_check && <span class="proxy-type-badge">UDP</span>}
              </div><span class="privacy">{proxy.host}:{proxy.port}</span></div>
              <div class="proxy-item-actions">
                <button class="icon-button" aria-label={`Move ${proxy.name} up`} disabled={index === 0} onClick={() => moveTo(index, index - 1)}>↑</button>
                <button class="icon-button" aria-label={`Move ${proxy.name} down`} disabled={index === draft.proxies.length - 1} onClick={() => moveTo(index, index + 1)}>↓</button>
                <button class="btn btn-ghost btn-sm" onClick={() => { setEditing(index); setDeleting(null); }}>Edit</button>
                <button class="btn btn-ghost btn-sm" onClick={() => { setNewInitial({ ...proxy, name: `${proxy.name} copy`, tags: [...proxy.tags] }); setEditing('new'); setDeleting(null); }}>Copy</button>
                <button class="icon-button danger" aria-label={`Delete ${proxy.name}`} onClick={() => { setDeleting(index); setEditing(null); }}>✕</button>
              </div>
            </div>
            {editing === index && <ProxyEditor key={`edit-${index}`} initial={proxy} mode="edit" onSave={saveProxy} onCancel={() => setEditing(null)} />}
            {deleting === index && <div class="confirm-delete">Delete <strong>{proxy.name}</strong> from the draft?
              <button class="btn btn-danger btn-sm" onClick={() => { updateProxies(draft.proxies.filter((_, i) => i !== index)); setDeleting(null); }}>Delete</button>
              <button class="btn btn-ghost btn-sm" onClick={() => setDeleting(null)}>Cancel</button>
            </div>}
          </div>)}
          {!draft.proxies.length && <p class="muted">No proxies configured.</p>}
          {!!draft.proxies.length && !!proxySearch && !draft.proxies.some(proxy =>
            [proxy.name, proxy.host, ...(proxy.tags ?? [])].some(value => value.toLocaleLowerCase().includes(proxySearch.trim().toLocaleLowerCase()))) &&
            <p class="muted">No matching proxies.</p>}
        </div>
        {editing === 'new' && <ProxyEditor key={newInitial.name || 'new'} initial={newInitial} mode={newInitial.name ? 'copy' : 'add'} onSave={saveProxy} onCancel={() => setEditing(null)} />}
        <button class="btn btn-ghost btn-sm add-proxy-button" onClick={() => { setNewInitial(blankProxy()); setEditing('new'); setDeleting(null); }}>+ Add proxy</button>
      </section>

      <section class="settings-section monitoring-section"><SectionTitle title="Monitoring" icon="monitoring" />
        <label class="field dashboard-view-field">Dashboard view<select value={draftView} onChange={event => setDraftView(event.currentTarget.value as 'cards' | 'table')}>
          <option value="cards">Cards</option><option value="table">Compact table</option></select></label>
        <div class="form-grid">
        <label class="field">Check interval (sec)<input type="number" min="5" value={draft.monitoring.check_interval_seconds ?? 60} onInput={e => patch('monitoring', 'check_interval_seconds', Number(e.currentTarget.value))} /></label>
        <label class="field">Timeout (sec)<input type="number" min="1" value={draft.monitoring.check_timeout_seconds ?? 10} onInput={e => patch('monitoring', 'check_timeout_seconds', Number(e.currentTarget.value))} /></label>
        <label class="field">Concurrent checks<input type="number" min="1" value={draft.monitoring.concurrent_checks ?? 10} onInput={e => patch('monitoring', 'concurrent_checks', Number(e.currentTarget.value))} /></label>
        <label class="field">Dashboard window (min)<input type="number" min="1" value={draft.monitoring.recent_window_minutes ?? 5} onInput={e => patch('monitoring', 'recent_window_minutes', Number(e.currentTarget.value))} /></label>
        <label class="field field-wide">TCP test URL<input type="url" value={draft.monitoring.tcp_test_url ?? 'http://httpbin.org/ip'} onInput={e => patch('monitoring', 'tcp_test_url', e.currentTarget.value)} /></label>
        <label class="field field-wide">UDP test IP (IPv4 or IPv4:port)<input value={draft.monitoring.udp_test_ip ?? '1.1.1.1:53'} onInput={e => patch('monitoring', 'udp_test_ip', e.currentTarget.value)} /></label>
      </div></section>

      <section class="settings-section server-section"><SectionTitle title="Server" icon="server" /><div class="form-grid">
        <label class="field">Host<input class="privacy" disabled={safeguard} value={draft.server.host ?? '0.0.0.0'} onInput={e => patch('server', 'host', e.currentTarget.value)} /></label>
        <label class="field">Port<input type="number" min="1" max="65535" disabled={safeguard} value={draft.server.port ?? 8080} onInput={e => patch('server', 'port', Number(e.currentTarget.value))} /></label>
        <label class="field">Auth username<input disabled={safeguard} value={draft.server.username ?? 'admin'} onInput={e => patch('server', 'username', e.currentTarget.value)} /></label>
        <label class="field">Auth password (empty = disabled)<input type="password" disabled={safeguard} value={draft.server.password ?? ''} onInput={e => patch('server', 'password', e.currentTarget.value)} /></label>
        <label class="field">Time format<select value={draft.server.time_format ?? '24h'} onChange={e => patch('server', 'time_format', e.currentTarget.value)}><option value="24h">24h</option><option value="12h">12h</option></select></label>
        <label class="field">Log level<select value={draft.server.log_level ?? 'INFO'} onChange={e => patch('server', 'log_level', e.currentTarget.value)}>{['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'].map(level => <option key={level}>{level}</option>)}</select></label>
        <label class="field field-wide">Trusted IPs & subnets<textarea rows={3} disabled={safeguard} value={trustedText} onInput={e => setTrustedText(e.currentTarget.value)} /></label>
        <label class="field field-wide">Whitelist IPs & subnets<textarea rows={3} disabled={safeguard} value={whitelistText} onInput={e => setWhitelistText(e.currentTarget.value)} /></label>
      </div></section>

      <section class="settings-section storage-section"><SectionTitle title="Storage" icon="storage" /><div class="form-grid">
        <label class="field">Retention (days)<input type="number" min="1" value={draft.storage.retention_days ?? 30} onInput={e => patch('storage', 'retention_days', Number(e.currentTarget.value))} /></label>
        <label class="field">Cleanup interval (min)<input type="number" min="10" value={draft.storage.cleanup_interval_minutes ?? 60} onInput={e => patch('storage', 'cleanup_interval_minutes', Number(e.currentTarget.value))} /></label>
        <div class="field storage-db-field"><div class="storage-field-header"><label for="db-path">DB path</label><div class="storage-actions"><span class="muted">{size}</span><button type="button" class="storage-optimize" disabled={vacuuming} onClick={vacuum}>{vacuuming ? 'Optimizing…' : 'Optimize now'}</button></div></div><input id="db-path" disabled={safeguard} value={draft.storage.db_path ?? 'proxy_data.db'} onInput={e => patch('storage', 'db_path', e.currentTarget.value)} /></div>
      </div></section>
      {error && <p class="form-error">{error}</p>}
    </div>}
  </Modal>
    {discardConfirm && <Modal title="Discard changes?" size="small" onClose={() => setDiscardConfirm(false)} footer={<>
      <button class="btn btn-ghost" onClick={() => setDiscardConfirm(false)}>Keep editing</button>
      <button class="btn btn-danger" onClick={onClose}>Discard changes</button>
    </>}><p>Your unsaved settings will be lost.</p></Modal>}
  </>;
}
