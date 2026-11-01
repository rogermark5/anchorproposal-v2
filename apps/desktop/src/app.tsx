import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster, toast } from 'sonner';
import { Anchor, Minus, Square, X, ArrowUpRight, LoaderCircle } from 'lucide-react';
import { Auth, Preferences } from './auth-forms';
import { DesktopAuthContext } from './auth-context';
import { NavigationProvider } from './navigation';
import { api, type User } from '../../web/src/lib/api';
import './desktop.css';
import { TimeZoneProvider } from '../../web/src/components/time-zone-settings';
const Workspace = lazy(() => import('./workspace'));
const QuickApplication = lazy(() => import('./quick-application'));
const quick = new URLSearchParams(location.search).get('view') === 'quick';
const initial: DesktopSettings = { server: '', hotkey: 'Control+Shift+Z', alwaysOnTop: true, launchAtLogin: false, notifications: true };

function App() {
  const [settings, setSettings] = useState(initial); const [user, setUser] = useState<User | null>(null);
  const [version, setVersion] = useState('');
  const [loading, setLoading] = useState(false); const [ready, setReady] = useState(false); const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const restore = useCallback(async () => {
    setLoading(true); setError('');
    try { setUser(await window.anchor.request('/auth/me')); }
    catch (e) { setUser(null); if (!/sign in|expired/i.test((e as Error).message)) setError((e as Error).message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    void window.anchor.bootstrap().then(state => {
      setSettings(state.settings); setVersion(state.version); setReady(true); if (state.shortcutError) setError(state.shortcutError);
      if (state.authenticated) void restore();
    }).catch(e => { setReady(true); setError(e.message); });
    const off = window.anchor.onEvent(event => {
      if (event.type === 'session' || event.type === 'data-changed') api.invalidateCache();
      if (event.type === 'session') { if (event.signedIn) void restore(); else setUser(null); }
      if (event.type === 'settings') setSettings(event.settings);
      if (event.type === 'navigate') location.hash = event.path;
      if (event.type === 'notice') toast(event.message);
    });
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape' && quick && !document.querySelector('[aria-modal="true"], dialog[open], [role="dialog"]')) void window.anchor.window('close'); };
    const links = (event: MouseEvent) => {
      const target = (event.target as Element).closest<HTMLAnchorElement>('a');
      if (!target || event.defaultPrevented || target.getAttribute('href')?.startsWith('#') || target.getAttribute('href')?.startsWith('blob:')) return;
      event.preventDefault(); void window.anchor.external(target.getAttribute('href') || '').catch(e => toast.error(e.message));
    };
    document.addEventListener('click', links); window.addEventListener('keydown', keyboard);
    return () => { off(); document.removeEventListener('click', links); window.removeEventListener('keydown', keyboard); };
  }, [restore]);
  const logout = useCallback(async () => { await window.anchor.logout(); setUser(null); }, []);
  const context = useMemo(() => ({ user, loading, login: async (email: string, password: string) => { await window.anchor.auth('login', { email, password }); await restore(); }, logout, isMaster: user?.role === 'MASTER', isAdmin: user?.role === 'MASTER' || user?.role === 'ADMIN', canBid: user?.role === 'ADMIN' || user?.role === 'BIDDER' }), [user, loading, logout, restore]);
  const preferences = <Preferences settings={settings} user={user} version={version} busy={busy} onError={setError} onSignout={() => void logout()} onSave={value => { setBusy(true); void window.anchor.settings(value).then(setSettings).then(() => toast.success('Desktop preferences saved')).catch(e => setError(e.message)).finally(() => setBusy(false)); }}/>;
  return <DesktopAuthContext.Provider value={context}><TimeZoneProvider><NavigationProvider><div className={`native-shell ${quick ? 'quick-shell' : ''}`}>
    <header className="native-titlebar"><div><Anchor size={17}/><span>AnchorProposal</span><small>{quick ? 'QUICK APPLICATION' : 'DESKTOP'}</small></div><div className="native-window-buttons">{quick && <button aria-label="Open workspace" title="Open full workspace" onClick={() => void window.anchor.window('workspace')}><ArrowUpRight size={16}/></button>}<button aria-label="Minimize" onClick={() => void window.anchor.window('minimize')}><Minus size={15}/></button>{!quick && <button aria-label="Maximize or restore" onClick={() => void window.anchor.window('maximize')}><Square size={13}/></button>}<button aria-label={quick ? "Close application form" : "Close to tray"} className="window-close" onClick={() => void window.anchor.window('close')}><X size={17}/></button></div></header>
    {error && <div role="alert" className="native-error">{error}<button aria-label="Dismiss error" onClick={() => setError('')}><X size={15}/></button></div>}
    {!ready ? <div className="native-starting"><Anchor size={32}/><p>Opening AnchorProposal…</p></div> : loading && !user ? <div className="native-starting"><LoaderCircle className="native-spin"/><h1>Welcome back</h1><p>Connecting to your server…</p><button className="native-secondary" onClick={() => { setLoading(false); }}>Back to sign in</button></div> : !user ? <div className="native-auth"><Auth onLogin={value => { if (value?.id) setUser(value); else void restore(); }} onError={setError}/></div> : <Suspense fallback={<div className="desktop-loading">Opening your workspace…</div>}>{quick ? <QuickApplication/> : <Workspace preferences={preferences} hotkey={settings.hotkey}/>}</Suspense>}
    <Toaster theme="dark" position="bottom-right" richColors closeButton/>
  </div></NavigationProvider></TimeZoneProvider></DesktopAuthContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<App/>);
requestAnimationFrame(() => void window.anchor.ready());
