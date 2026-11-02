'use client';
import { useEffect, useRef, useState } from 'react';
import { Bot, Check, Copy, Eye, EyeOff, KeyRound, LogIn, Pause, Play, RefreshCw } from 'lucide-react';
import { JobrightSettings, JobrightStatus, jobrightLinkExclusion, normalizeJobrightRules } from '@anchorproposal/shared';
import { api } from '@/lib/api';
import { formatZonedDateTime } from '@/lib/time-zone';
import { useTimeZone } from './time-zone-settings';

const field = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500';
const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50';
const lines = (value: string) => value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
export function JobrightBotSettings() {
  useTimeZone();
  const [status, setStatus] = useState<JobrightStatus | null>(null), [draft, setDraft] = useState<JobrightSettings | null>(null);
  const [domains, setDomains] = useState(''), [words, setWords] = useState(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [key, setKey] = useState(''), [copied, setCopied] = useState(false), [testUrl, setTestUrl] = useState('');
  const [loadError, setLoadError] = useState('');
  const dirty = useRef(false), mounted = useRef(true);
  function adopt(value: JobrightStatus, replace = false) {
    setStatus(value);
    if (!dirty.current || replace) { setDraft(value.settings); setDomains(value.settings.blockedDomains.join('\n')); setWords(value.settings.blockedWords.join('\n')); dirty.current = false; }
  }
  useEffect(() => {
    mounted.current = true;
    const load = () => api.getJobrightBot().then(value => { if (mounted.current) { adopt(value); setLoadError(''); } }).catch(error => { if (mounted.current) setLoadError(error.message || 'Could not load the Jobright bot.'); });
    void load(); const timer = setInterval(() => void load(), 5000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, []);
  async function action(fn: () => Promise<JobrightStatus>, message: string) {
    setBusy(true); setError(''); setNotice('');
    try { adopt(await fn()); setNotice(message); } catch (error) { setError(error instanceof Error ? error.message : 'Could not update the bot.'); } finally { setBusy(false); }
  }
  let preview = '';
  if (testUrl) try { preview = jobrightLinkExclusion(testUrl, normalizeJobrightRules(lines(domains), lines(words))) || 'Allowed by these URL exclusions'; }
  catch { preview = 'Fix the domain rules before testing this URL.'; }
  return <section className="mb-6 rounded-xl border border-[var(--border)] bg-white p-5" aria-label="Jobright browser bot">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 font-semibold text-slate-800"><Bot size={20} />Jobright bot</h2>
      <p className="mt-1 text-sm text-slate-500">Watch for new postings on Ubuntu and import their original application links.</p></div>
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status?.connected ? 'bg-teal-100 text-teal-900' : 'bg-slate-100 text-slate-600'}`}>
        {status ? status.connected ? status.workerStatus.replace(/_/g, ' ') : 'Worker offline' : 'Loading…'}
      </span></header>
    <p className="mt-3 rounded-lg bg-sky-50 p-3 text-sm text-sky-900">Only jobs posted <b>after you press Start watching</b> are accepted. Worker or server restarts keep that cutoff. Stopping and starting a new watch sets a new cutoff.</p>
    {status && <>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4"><div><span className="block text-xs text-slate-500">Watch started</span><b>{status.startedAt ? formatZonedDateTime(status.startedAt) : 'Not started'}</b></div>
        <div><span className="block text-xs text-slate-500">Browser</span><b>{status.browserMode === 'visible' ? 'Visible on Ubuntu' : status.browserMode === 'hidden' ? 'Hidden background browser' : 'Closed'}</b></div>
        <div><span className="block text-xs text-slate-500">Last scan</span><b>{status.lastScanAt ? formatZonedDateTime(status.lastScanAt) : 'Not scanned yet'}</b></div>
        <div><span className="block text-xs text-slate-500">Last saved checkpoint</span>{status.checkpoint ? <><a className="font-semibold text-teal-700 underline" href={status.checkpoint.sourceUrl} target="_blank" rel="noreferrer">{status.checkpoint.company} · {status.checkpoint.title}</a><span className="block text-xs">Posted {formatZonedDateTime(status.checkpoint.publishedAt)}</span></> : <b>No new jobs processed yet</b>}</div></div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy || !status.keyConfigured || status.desired === 'running'} onClick={() => void action(() => api.jobrightBotCommand('start'), 'Watch started. Jobs posted before this cutoff will be skipped.')}><Play size={15} />Start watching</button>
        <button type="button" className={button} disabled={busy || status.desired === 'stopped'} onClick={() => void action(() => api.jobrightBotCommand('stop'), 'Stop requested.')}><Pause size={15} />Stop</button>
        <button type="button" className={button} disabled={busy || !status.keyConfigured || status.browserVisible} onClick={() => void action(() => api.jobrightBotCommand('show-browser'), 'Opening the current Jobright browser on Ubuntu. Collection pauses while you change filters.')}><Eye size={15} />Show browser</button>
        <button type="button" className={button} disabled={busy || !status.keyConfigured || !status.browserVisible} onClick={() => void action(() => api.jobrightBotCommand('hide-browser'), 'Hiding the same browser. Watching resumes with your filters and saved checkpoint.')}><EyeOff size={15} />Hide browser</button>
        <button type="button" className={button} disabled={busy || !status.keyConfigured} onClick={() => void action(() => api.jobrightBotCommand('login'), 'Sign in using the Chrome window on your Ubuntu desktop.')}><LogIn size={15} />Open login on Ubuntu</button>
        {status.desired === 'login' && <button type="button" className={button} disabled={busy} onClick={() => void action(() => api.jobrightBotCommand('finish-login'), 'Login completion requested. Chrome will close and watching can continue hidden.')}><Check size={15} />Finish login &amp; hide</button>}
      </div>
      <p className="mt-2 text-xs text-slate-500">Show browser opens Chrome on your Ubuntu desktop so you can sign in and change Jobright filters. Hide browser minimizes that same window and resumes collection when watching is on. Your watch cutoff and checkpoint stay unchanged.</p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(status.counts).map(([name, count]) => <div key={name} className="rounded-lg bg-slate-50 p-3"><span className="block text-xs capitalize text-slate-500">{name}</span><strong className="text-lg">{count.toLocaleString()}</strong></div>)}</div>
      {status.lastError && <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{status.lastError}</p>}
    </>}
    {draft && <details className="mt-5 border-t border-slate-100 pt-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Link exclusions and scan settings</summary>
      <form className="mt-4 space-y-4" onSubmit={event => { event.preventDefault(); void action(async () => { const value = await api.saveJobrightBot({ ...draft, blockedDomains: lines(domains), blockedWords: lines(words) }); adopt(value, true); return value; }, 'Bot settings saved.'); }}>
        <p className="text-sm text-slate-600">The bot uses Jobright&apos;s Recommended page and selects <b>Most Recent</b> for every scan. Use <b>Show browser</b> to change your other Jobright filters.</p>
        <div className="grid gap-4 md:grid-cols-2"><label className="block text-sm font-medium">Blocked domains<textarea aria-label="Blocked job domains" rows={5} placeholder={'linkedin.com\nexample.com'} value={domains} onChange={event => { dirty.current = true; setDomains(event.target.value); }} className={field} /><span className="mt-1 block text-xs font-normal text-slate-500">One per line. Blocks the domain and its subdomains.</span></label>
          <label className="block text-sm font-medium">Blocked words in job links<textarea aria-label="Blocked words in job links" rows={5} placeholder={'internship\ncontractor'} value={words} onChange={event => { dirty.current = true; setWords(event.target.value); }} className={field} /><span className="mt-1 block text-xs font-normal text-slate-500">Matches text anywhere in the original URL, ignoring case and decoding URL escapes.</span></label></div>
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Check every (minutes)<input aria-label="Bot scan interval" type="number" min={2} max={60} value={draft.intervalMinutes} onChange={event => { dirty.current = true; setDraft({ ...draft, intervalMinutes: Number(event.target.value) }); }} className={field} /></label>
          <label className="text-sm font-medium">Maximum jobs per scan<input aria-label="Maximum jobs per scan" type="number" min={1} max={100} value={draft.maxJobsPerScan} onChange={event => { dirty.current = true; setDraft({ ...draft, maxJobsPerScan: Number(event.target.value) }); }} className={field} /></label></div>
        <label className="block text-sm font-medium">Test a job URL<input aria-label="Test original job URL" type="url" value={testUrl} onChange={event => setTestUrl(event.target.value)} className={field} placeholder="https://careers.example.com/jobs/software-engineer" />{preview && <span role="status" className="mt-1 block text-xs font-normal text-slate-600">{preview}</span>}</label>
        <p className="text-xs text-slate-500">Jobright URLs and jobs with unknown posting times are skipped. Imports follow the job pool's remote software, country and title rules. These exclusions are also enforced by the server.</p>
        <button type="submit" className={button} disabled={busy}>Save bot settings</button>
      </form>
    </details>}
    <details className="mt-4 border-t border-slate-100 pt-4"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Connect the Ubuntu worker</summary>
      <p className="my-3 text-sm text-slate-500">Create a worker key, put it in <code>apps/jobright-bot/.env</code> on Ubuntu, and start <code>apps/jobright-bot/ecosystem.config.cjs</code> with PM2. The key can only control this worker connection and submit jobs. A new key revokes the old one.</p>
      <button type="button" className={button} disabled={busy} onClick={async () => {
        if (status?.keyConfigured && !window.confirm('Replace the worker key? Update the Ubuntu worker .env and restart it afterward.')) return;
        setBusy(true); setError(''); try { const result = await api.generateJobrightBotKey(); adopt(result.status); setKey(result.key); setCopied(false); } catch (error) { setError(error instanceof Error ? error.message : 'Could not generate the key.'); } finally { setBusy(false); }
      }}><KeyRound size={15} />{status?.keyConfigured ? 'Replace worker key' : 'Generate worker key'}</button>
      {key && <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><p className="text-xs text-amber-900">Shown once. Store this in the worker .env, then hide it.</p><code className="mt-2 block break-all text-xs">JOBRIGHT_WORKER_KEY={key}</code>
        <div className="mt-2 flex gap-2"><button type="button" className={button} onClick={async () => { try { await navigator.clipboard.writeText(key); setCopied(true); } catch { setError('Copy the key shown above.'); } }}><Copy size={14} />{copied ? 'Copied' : 'Copy key'}</button><button type="button" className={button} onClick={() => setKey('')}>Hide key</button></div></div>}
    </details>
    {(error || loadError) && <p role="alert" className="mt-3 text-sm text-red-700">{error || loadError}</p>}{notice && <p role="status" className="mt-3 text-sm text-teal-700">{notice}</p>}
    {!status && loadError && <button className={button + ' mt-3'} onClick={() => void action(api.getJobrightBot.bind(api), 'Bot status refreshed.')}><RefreshCw size={15} />Retry</button>}
  </section>;
}
