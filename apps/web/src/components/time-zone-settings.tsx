'use client';
import { createContext, Fragment, ReactNode, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { setDisplayTimeZone } from '@/lib/time-zone';
import { validTimeZone } from '@anchorproposal/shared';
import { TimeZonePicker } from './time-zone-picker';

const ZoneContext = createContext({ timeZone: 'UTC', change: (_zone: string) => {} });
export const useTimeZone = () => useContext(ZoneContext);
export function TimeZoneProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [timeZone, setZone] = useState('UTC');
  const change = (value: string) => {
    if (!validTimeZone(value)) return;
    setDisplayTimeZone(value); setZone(value);
    if (user) try { localStorage.setItem(`time-zone:${user.id}`, value); } catch { /* Account setting remains stored on the server. */ }
  };
  useEffect(() => {
    let active = true;
    const key = user ? `time-zone:${user.id}` : null;
    let cached: string | null = null;
    try { cached = key ? localStorage.getItem(key) : null; } catch { /* Use the saved server setting when browser storage is unavailable. */ }
    change(validTimeZone(cached) ? cached : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    if (user) void api.getTimeZone().then(data => { if (active && data.timeZone) change(data.timeZone); }).catch(() => {});
    return () => { active = false; };
  }, [user?.id]);
  return <ZoneContext.Provider value={{ timeZone, change }}><Fragment key={user?.id || 'anonymous'}>{children}</Fragment></ZoneContext.Provider>;
}
export function TimeZoneSettings() {
  const { timeZone, change } = useTimeZone();
  const [draft, setDraft] = useState(timeZone), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => setDraft(timeZone), [timeZone]);
  return <section className="rounded-xl border border-[var(--border)] bg-white p-5 space-y-4">
    <div><h2 className="font-semibold text-slate-800">Time zone</h2><p className="mt-1 text-sm text-slate-500">Your account uses this time zone for dates, timestamps, and application date filters on the website, desktop app, and Chrome extension.</p></div>
    <TimeZonePicker value={draft} disabled={busy} onChange={zone => { setDraft(zone); setMessage(''); }} />
    <p className="text-sm text-slate-600">Current time: {new Date().toLocaleString('en-US', { timeZone: draft, timeZoneName: 'short' })}</p>
    <button className="rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-50" disabled={busy} onClick={() => { setBusy(true); void api.setTimeZone(draft).then(result => { change(result.timeZone); setMessage('Time zone saved.'); }).catch(error => setMessage(error.message)).finally(() => setBusy(false)); }}>{busy ? 'Saving…' : 'Save time zone'}</button>
    {message && <p role="status" className={'text-sm ' + (message === 'Time zone saved.' ? 'text-teal-700' : 'text-red-700')}>{message}</p>}
  </section>;
}
