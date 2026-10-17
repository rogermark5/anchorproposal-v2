'use client';

import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Briefcase, Search, RefreshCw, Plus, ExternalLink, MapPin, Settings2, X, EyeOff, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { api, PoolJob, PoolListing, PoolManagement, PoolUpdates } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { jobTimeAgo } from '@/lib/job-time';

const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30';
const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const primary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-deep disabled:opacity-50';
const workNames: Record<string, string> = { REMOTE: 'Remote', HYBRID: 'Hybrid', ONSITE: 'On site', UNKNOWN: 'See listing' };
const when = (date: string | null) => date ? new Date(date).toLocaleString() : 'Never';
const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

function Modal({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null; box.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key !== 'Tab') return;
      const items = box.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, textarea, select');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === box.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [close]);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={close}>
    <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()} className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl outline-none sm:p-7">
      <div className="mb-5 flex items-start justify-between gap-4"><h2 className="text-xl font-semibold text-slate-800">{title}</h2><button className="rounded p-1 hover:bg-slate-100" aria-label="Close dialog" onClick={close}><X size={20} /></button></div>
      {children}
    </div>
  </div>;
}

type Profile = { id: string; firstName: string; lastName: string; isDefault?: boolean };
const emptyJob = { title: '', company: '', location: 'United States', jobUrl: '', description: '', workArrangement: 'REMOTE' };

export default function JobPoolPage() {
  const { isMaster, canBid, user } = useAuth(); const router = useRouter();
  const [listing, setListing] = useState<PoolListing | null>(null), [management, setManagement] = useState<PoolManagement | null>(null);
  const [updates, setUpdates] = useState<PoolUpdates | null>(null);
  const loadedAt = useRef(new Date().toISOString());
  const [q, setQ] = useState(''), [query, setQuery] = useState(''), [sourceId, setSourceId] = useState('');
  const [sourceQuery, setSourceQuery] = useState(''), [sourcePage, setSourcePage] = useState(1);
  const [days, setDays] = useState('all'), [status, setStatus] = useState('not-applied'), [includeHidden, setIncludeHidden] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false), [moreError, setMoreError] = useState('');
  const [marking, setMarking] = useState<string | null>(null), [now, setNow] = useState(Date.now());
  const sentinel = useRef<HTMLDivElement>(null), moreFlight = useRef<number | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false), [showSources, setShowSources] = useState(false);
  const [addMode, setAddMode] = useState<'job' | 'source' | null>(null), [jobForm, setJobForm] = useState(emptyJob);
  const [sourceForm, setSourceForm] = useState({ provider: 'greenhouse', name: '', boardToken: '' });
  const [selected, setSelected] = useState<PoolJob | null>(null), [profiles, setProfiles] = useState<Profile[]>([]), [profileId, setProfileId] = useState('');
  const requestId = useRef(0);
  const markFlight = useRef(false);
  useEffect(() => { const timer = setTimeout(() => setQuery(q.trim()), 350); return () => clearTimeout(timer); }, [q]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const filters = useCallback(() => ({ q: query, sourceId, days, status, ...(isMaster && includeHidden ? { includeHidden: 'true' } : {}) }), [query, sourceId, days, status, isMaster, includeHidden]);
  const load = useCallback(async (quiet = false) => {
    const request = ++requestId.current; moreFlight.current = null; setLoadingMore(false); setMoreError('');
    setUpdates(null);
    setLoading(true); if (!quiet) setListing(null);
    try {
      const data = await api.getJobPool(filters());
      if (request === requestId.current) { loadedAt.current = data.asOf || new Date().toISOString(); setListing(data); setError(''); }
    } catch (err) { if (request === requestId.current) setError(message(err)); }
    finally { if (request === requestId.current) setLoading(false); }
  }, [filters]);
  const latestLoad = useRef(load); latestLoad.current = load;
  const loadMore = useCallback(async () => {
    if (!listing?.nextCursor || loading || moreFlight.current !== null || markFlight.current) return;
    const request = requestId.current; moreFlight.current = request; setLoadingMore(true); setMoreError('');
    try {
      const data = await api.getJobPool({ ...filters(), cursor: listing.nextCursor });
      if (request === requestId.current) setListing(previous => previous ? { ...data, jobs: [...previous.jobs, ...data.jobs.filter(job => !previous.jobs.some(existing => existing.id === job.id))] } : data);
    } catch (err) { if (request === requestId.current) setMoreError(message(err)); }
    finally { if (request === requestId.current) { moreFlight.current = null; setLoadingMore(false); } }
  }, [listing?.nextCursor, loading, marking, filters]);
  useEffect(() => {
    const element = sentinel.current; if (!element || !listing?.nextCursor || moreError || loading || loadingMore) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void loadMore(); }, { rootMargin: '300px' });
    observer.observe(element); return () => observer.disconnect();
  }, [loadMore, listing?.nextCursor, loading, loadingMore, moreError]);
  const loadManagement = useCallback(async () => { if (isMaster) setManagement(await api.getPoolManagement()); }, [isMaster]);
  useEffect(() => { void load(); return () => { requestId.current++; }; }, [load]);
  const hasListing = !!listing;
  useEffect(() => {
    if (!hasListing) return;
    let active = true, inFlight = false;
    const check = async () => {
      if (inFlight || document.visibilityState !== 'visible' || markFlight.current) return;
      inFlight = true; const request = requestId.current;
      try {
        const data = await api.getPoolUpdates({ ...filters(), since: loadedAt.current });
        if (active && request === requestId.current && !markFlight.current) setUpdates(previous => previous?.newCount === data.newCount && previous.total === data.total ? previous : data);
      } catch { /* Keep the list usable during a temporary connection failure. */ }
      finally { inFlight = false; }
    };
    const timer = setInterval(() => { void check(); }, 15_000);
    const focused = () => { void check(); };
    window.addEventListener('focus', focused); document.addEventListener('visibilitychange', focused);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', focused); document.removeEventListener('visibilitychange', focused); };
  }, [hasListing, filters]);
  useEffect(() => { if (isMaster) void loadManagement().catch(err => toast.error(message(err))); }, [isMaster, loadManagement]);
  const importing = management?.sources.some(source => source.running || source.queued) ?? false;
  useEffect(() => {
    if (!isMaster || (!importing && !management?.settings.enabled)) return;
    const timer = setInterval(() => { void loadManagement().catch(() => {}); }, importing ? 4000 : 15_000);
    return () => clearInterval(timer);
  }, [isMaster, importing, management?.settings.enabled, loadManagement]);
  const mutate = async (operation: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try { await operation(); if (success) toast.success(success); await Promise.all([loadManagement(), load(true)]); }
    catch (err) { toast.error(message(err)); } finally { setBusy(false); }
  };
  const sync = () => void mutate(async () => { const result = await api.syncPoolSources(); toast.message(result.message); });
  const refresh = () => void Promise.all([load(true), loadManagement()]).catch(err => toast.error(message(err)));
  const closeSelected = useCallback(() => { setSelected(null); }, []), closeAdd = useCallback(() => { setAddMode(null); }, []);
  const openJob = async (job: PoolJob) => {
    try {
      const [detail, available] = await Promise.all([api.getPoolJob(job.id), canBid ? api.getProfiles() as Promise<Profile[]> : Promise.resolve([])]);
      setSelected(detail); setProfiles(available); setProfileId(available.find(profile => profile.isDefault)?.id || available[0]?.id || '');
    } catch (err) { toast.error(message(err)); }
  };
  const createApplication = async () => {
    if (!selected || !profileId) return; setBusy(true);
    try { const application = await api.applyPoolJob(selected.id, profileId); toast.success('Application saved. You can now generate your resume and cover letter.'); router.push(`/applications/${application.id}`); }
    catch (err) { toast.error(message(err)); } finally { setBusy(false); }
  };
  const markApplied = async (job: PoolJob) => {
    if (markFlight.current) return; markFlight.current = true; setMarking(job.id);
    const request = requestId.current;
    try {
      const result = await api.markPoolJobApplied(job.id, !job.applied);
      setUpdates(null);
      // Ignore an older scrolling response that could reinsert the changed row.
      if (request !== requestId.current) await latestLoad.current(true);
      else {
        requestId.current++; moreFlight.current = null; setLoadingMore(false); setLoading(false);
        setListing(previous => {
        if (!previous) return previous;
        const before = status === 'all' || (status === 'applied') === job.applied;
        const after = status === 'all' || (status === 'applied') === result.applied;
        let jobs = previous.jobs.flatMap(item => item.id === job.id ? after ? [{ ...item, ...result }] : [] : [item]);
        if (after && !jobs.some(item => item.id === job.id)) jobs = [...jobs, { ...job, ...result }].sort((a, b) => b.postedAt.localeCompare(a.postedAt) || b.id.localeCompare(a.id));
        return { ...previous, total: Math.max(0, previous.total + Number(after) - Number(before)), jobs };
        });
      }
      setSelected(previous => previous?.id === job.id ? { ...previous, ...result } : previous);
      toast.success(result.applied ? 'Marked as applied for your account.' : 'Marked as not applied for your account.');
    } catch (err) { toast.error(message(err)); } finally { markFlight.current = false; setMarking(null); }
  };
  const saveJob = async (event: FormEvent) => {
    event.preventDefault(); await mutate(async () => { await api.addPoolJob(jobForm); setAddMode(null); setJobForm(emptyJob); }, 'Job published for all users.');
  };
  const saveSource = async (event: FormEvent) => {
    event.preventDefault(); await mutate(async () => { await api.addPoolSource(sourceForm); setAddMode(null); setSourceForm({ provider: 'greenhouse', name: '', boardToken: '' }); }, 'Source added. Import jobs now or start automatic imports.');
  };
  const enabledSources = management?.sources.filter(source => source.enabled && source.configured).length || 0;
  const matchingSources = management?.sources.filter(source => source.enabled && source.configured && source.lastCount > 0).length || 0;
  const pendingSources = management?.sources.filter(source => source.enabled && source.configured && !source.lastAttemptAt).length || 0;
  const checkedSources = management?.sources.filter(source => source.enabled && source.configured && source.lastAttemptAt).length || 0;
  const runningSources = management?.sources.filter(source => source.running).length || 0;
  const retrySources = management?.sources.filter(source => source.enabled && source.configured && source.lastError).length || 0;
  const provider = management?.providers.find(item => item.id === sourceForm.provider);
  const filteredSources = management?.sources.filter(source => `${source.name} ${source.provider} ${source.boardToken}`.toLowerCase().includes(sourceQuery.trim().toLowerCase())) || [];
  const sourcePages = Math.max(1, Math.ceil(filteredSources.length / 50)), currentSourcePage = Math.min(sourcePage, sourcePages);
  const visibleSources = filteredSources.slice((currentSourcePage - 1) * 50, currentSourcePage * 50);

  return <div className="p-4 sm:p-6 lg:p-8">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold text-slate-800">Remote US Software Jobs</h1><p className="mt-1 text-sm text-slate-500">{isMaster ? 'Find remote US software jobs using free sources and publish them for your users.' : 'Browse remote US software jobs. Mark jobs you have applied to and focus on new opportunities.'}</p></div>
      <div className="flex flex-wrap gap-2"><button className={button} onClick={refresh}><RefreshCw size={16} /> Refresh</button>{isMaster && <><button className={button} onClick={() => { setJobForm(emptyJob); setAddMode('job'); }}><Plus size={16} /> Add job</button><button className={primary} disabled={busy || importing || !enabledSources} onClick={sync}><RefreshCw size={16} className={importing ? 'animate-spin' : ''} />{importing ? 'Importing jobs…' : 'Import jobs now'}</button></>}</div>
    </div>

    {isMaster && management && <section className="mb-6 rounded-xl border border-[var(--border)] bg-white p-5" aria-label="Automatic job imports">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${management.settings.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} /><h2 className="font-semibold text-slate-800">Automatic imports {management.settings.enabled ? 'on' : 'paused'}</h2></div><p className="mt-1 text-sm text-slate-500">{enabledSources} enabled sources · Fully remote US software roles only · Duplicate links skipped · No paid APIs or AI calls</p></div>
        <div className="flex flex-wrap items-center gap-2"><label className="text-sm text-slate-600" htmlFor="pool-interval">Refresh every</label><select id="pool-interval" className={field + ' !w-auto'} value={management.settings.intervalHours} disabled={busy} onChange={event => void mutate(() => api.updatePoolSettings({ intervalHours: Number(event.target.value) }))}>{[1, 6, 12, 24].map(hours => <option key={hours} value={hours}>{hours} {hours === 1 ? 'hour' : 'hours'}</option>)}</select>
          <button className={management.settings.enabled ? button : primary} disabled={busy || !enabledSources} onClick={() => void mutate(() => api.updatePoolSettings({ enabled: !management.settings.enabled }), management.settings.enabled ? 'Automatic imports paused.' : 'Automatic imports enabled. Jobs appear as they are imported.')}>{management.settings.enabled ? 'Pause imports' : 'Start automatic imports'}</button></div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Source coverage">
        <div className="rounded-lg bg-slate-50 px-4 py-3"><p className="text-xl font-semibold text-slate-800">{management.sources.length.toLocaleString()}</p><p className="text-xs text-slate-500">Sources in the library</p></div>
        <div className="rounded-lg bg-slate-50 px-4 py-3"><p className="text-xl font-semibold text-slate-800">{checkedSources.toLocaleString()}</p><p className="text-xs text-slate-500">Sources checked at least once</p></div>
        <div className="rounded-lg bg-slate-50 px-4 py-3"><p className="text-xl font-semibold text-slate-800">{matchingSources.toLocaleString()}</p><p className="text-xs text-slate-500">Returned matching jobs in their latest import</p></div>
        <div className="rounded-lg bg-slate-50 px-4 py-3"><p className="text-xl font-semibold text-slate-800">{pendingSources.toLocaleString()}</p><p className="text-xs text-slate-500">Sources waiting for their first check</p></div>
      </div>
      <p className="mt-2 text-xs text-slate-500">Each employer board is a separate source. Some sources have no remote US software openings right now.</p>
      <p className="mt-2 text-sm text-slate-600" aria-live="polite">{runningSources ? `${runningSources} sources importing now.` : management.settings.enabled ? 'Waiting for the next import pass.' : 'Automatic imports are paused.'}{retrySources > 0 && ` ${retrySources} sources need a retry; other sources continue importing.`}</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3"><p className="text-xs text-slate-500">Imports continue on the server when this page is closed. Source limits and the minimum one-hour refresh interval are respected.</p><button className="inline-flex items-center gap-2 text-sm font-medium text-primary" aria-expanded={showSources} onClick={() => setShowSources(value => !value)}><Settings2 size={16} />{showSources ? 'Hide sources' : 'Manage sources'}</button></div>
      {showSources && <div className="mt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-medium text-slate-800">Free job sources</h3><p className="text-xs text-slate-500">Search the source library or add company boards from Greenhouse, Lever, Ashby or SmartRecruiters.</p></div><button className={button} onClick={() => setAddMode('source')}><Plus size={16} /> Add source</button></div>
        <label className="mb-3 block text-sm text-slate-600">Search sources<input className={field + ' mt-1'} placeholder="Company or provider…" value={sourceQuery} onChange={event => { setSourceQuery(event.target.value); setSourcePage(1); }} /></label><div className="max-h-96 overflow-auto rounded-lg border border-slate-200"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Enabled</th><th className="p-3">Source</th><th className="p-3">Last import</th><th className="p-3">Status</th></tr></thead><tbody>{visibleSources.map(source => <tr key={source.id} className="border-t border-slate-100">
          <td className="p-3"><input type="checkbox" aria-label={`Enable ${source.name}`} checked={source.enabled} disabled={busy || !source.configured} onChange={event => void mutate(() => api.updatePoolSource(source.id, event.target.checked))} /></td>
          <td className="p-3"><p className="font-medium text-slate-800">{source.name}</p><p className="text-xs text-slate-500">{management.providers.find(item => item.id === source.provider)?.name}{source.boardToken ? ` / ${source.boardToken}` : ''}</p></td>
          <td className="p-3 text-xs text-slate-500">{when(source.lastSyncedAt)}{source.lastSyncedAt && <p>{source.lastCount} US listings processed</p>}</td>
          <td className="max-w-xs p-3 text-xs">{!source.configured ? <span className="text-amber-700">Requires a free USAJOBS key. Set USAJOBS_API_KEY and USAJOBS_EMAIL on the server, then restart the API.</span> : source.running || source.queued ? <span className="text-primary">{source.running ? 'Importing…' : 'Queued'}</span> : source.lastError ? <span className="text-amber-700">{source.lastError}<br />Next retry: {when(source.nextSyncAt)}</span> : source.lastSyncedAt ? <span className="text-emerald-700">Ready · Next refresh {when(source.nextSyncAt)}</span> : <span className="text-slate-500">Ready for first import</span>}</td>
        </tr>)}</tbody></table></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>{filteredSources.length} matching sources · Page {currentSourcePage} of {sourcePages}</span><div className="flex gap-2"><button className={button} disabled={currentSourcePage <= 1} onClick={() => setSourcePage(value => value - 1)}>Previous sources</button><button className={button} disabled={currentSourcePage >= sourcePages} onClick={() => setSourcePage(value => value + 1)}>Next sources</button></div></div>
        <p className="mt-3 text-xs text-slate-500">USAJOBS is optional and free. <a href="https://developer.usajobs.gov/apirequest/" target="_blank" rel="noopener noreferrer" className="text-primary underline">Request a free key</a>. Other sources need no API key. Imported jobs keep their original source and application link.</p>
        <p className="mt-2 text-xs text-slate-500">Company directory adapted from <a href="https://lastroundai.com/blog/salary-transparency-study-2026" target="_blank" rel="noopener noreferrer" className="text-primary underline">LastRound AI</a> under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" className="text-primary underline">CC BY 4.0</a>. Boards are independently checked for matching openings.</p>
      </div>}
    </section>}

    <section className="rounded-xl border border-[var(--border)] bg-white" aria-label="Available jobs">
      {updates && updates.newCount > 0 && <div role="status" className="fixed bottom-5 left-4 right-4 z-40 mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-white px-5 py-3 text-sm text-primary-deep shadow-lg"><span>{updates.newCount.toLocaleString()} new matching {updates.newCount === 1 ? 'job has' : 'jobs have'} been imported.</span><button className={button} onClick={refresh}>Refresh job list</button></div>}
      <div className="flex flex-wrap gap-3 border-b border-slate-200 p-4"><div className="relative min-w-48 flex-1"><Search size={17} className="absolute left-3 top-2.5 text-slate-400" /><input aria-label="Search jobs" className={field + ' pl-10'} placeholder="Search job title, company, location or skill…" value={q} onChange={event => setQ(event.target.value)} /></div>
        <select aria-label="Filter by source" className={field + ' !w-auto max-w-full'} value={sourceId} onChange={event => { setSourceId(event.target.value); }}><option value="">All sources</option>{listing?.sources.map(source => <option key={source.id} value={source.id}>{source.name} · {source.provider}</option>)}</select>
        <label className="text-xs text-slate-500">Posted<select aria-label="Filter by posting date" className={field + ' mt-1 !w-auto block'} value={days} onChange={event => setDays(event.target.value)}><option value="all">All dates</option>{[1, 3, 7, 14, 30].map(day => <option key={day} value={day}>Within {day} {day === 1 ? 'day' : 'days'}</option>)}</select></label>
        <label className="text-xs text-slate-500">My applications<select aria-label="Filter by applied status" className={field + ' mt-1 !w-auto block'} value={status} onChange={event => setStatus(event.target.value)}><option value="not-applied">Not applied</option><option value="applied">Applied</option><option value="all">All jobs</option></select></label>
        {isMaster && <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={includeHidden} onChange={event => { setIncludeHidden(event.target.checked); }} /> Show hidden</label>}
      </div>
      {error && <div role="alert" className="m-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}<button className="ml-3 underline" onClick={() => void load()}>Try again</button></div>}
      {loading && !listing ? <p className="p-12 text-center text-sm text-slate-500">Loading jobs…</p> : <>
        <div className="flex items-center justify-between px-5 py-3 text-sm text-slate-500"><span>{(updates?.total ?? listing?.total ?? 0).toLocaleString()} matching remote US software jobs</span>{loading && <span>Updating…</span>}</div>
        {!listing?.jobs.length ? <div className="p-12 text-center"><Briefcase size={48} className="mx-auto mb-3 text-slate-200" /><h3 className="font-medium text-slate-700">No jobs match these filters</h3><p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">{isMaster ? 'Click Import jobs now, start automatic imports, or add a job manually.' : 'Try All jobs or a wider date range, or check back for newly published software roles.'}</p></div> : <div className="divide-y divide-slate-100">{listing.jobs.map(job => <article key={job.id} className="p-5 hover:bg-slate-50/60">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><button onClick={() => void openJob(job)} className="text-left text-base font-semibold text-primary hover:underline">{job.title}</button><p className="mt-1 text-sm font-medium text-slate-700">{job.company}</p><p className="mt-1 flex items-center gap-1 text-sm text-slate-500"><MapPin size={14} className="shrink-0" />{job.location}</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{workNames[job.workArrangement]}</span>{job.applied && <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Applied</span>}{job.hidden && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-700">Hidden</span>}</div></div>
          {job.salary && <p className="mt-2 text-sm font-medium text-emerald-700">{job.salary}</p>}<p className="mt-2 line-clamp-2 whitespace-pre-line text-sm text-slate-500">{job.description}</p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-3 text-xs text-slate-500"><a href={job.jobUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">Source: {job.sourceName}<ExternalLink size={12} /></a><time dateTime={job.postedAt} title={(job.publishedAt ? 'Posted ' : 'Added ') + new Date(job.postedAt).toLocaleString()} className="inline-flex items-center gap-1"><Clock size={12} />{job.publishedAt ? '' : 'Added '}{jobTimeAgo(job.postedAt, now)}</time></div><div className="flex flex-wrap gap-2"><button className={button} disabled={marking !== null} aria-label={(job.applied ? 'Mark not applied' : 'Mark applied') + ': ' + job.title} onClick={() => void markApplied(job)}>{marking === job.id ? 'Saving…' : job.applied ? 'Applied ✓ · Undo' : 'Mark applied'}</button>{isMaster && <button className={button} disabled={busy} onClick={() => void mutate(() => api.hidePoolJob(job.id, !job.hidden), job.hidden ? 'Job visible to users.' : 'Job hidden from users.')}><EyeOff size={14} />{job.hidden ? 'Show job' : 'Hide'}</button>}<button className={button} onClick={() => void openJob(job)}>View job{canBid && user?.canCreateApplications !== false ? ' / prepare resume' : ''}</button><a className={primary} href={job.jobUrl} target="_blank" rel="noopener noreferrer">Apply at source<ExternalLink size={14} /></a></div></div>
        </article>)}</div>}
        <div ref={sentinel} data-testid="job-scroll-sentinel" className="flex min-h-20 flex-col items-center justify-center gap-2 border-t border-slate-200 p-4 text-sm text-slate-500" aria-live="polite">
          {moreError && <p role="alert" className="text-red-700">{moreError}</p>}
          {loadingMore ? <span>Loading more jobs…</span> : listing?.nextCursor ? <button className={button} disabled={loading || marking !== null} onClick={() => void loadMore()}>{moreError ? 'Retry loading jobs' : 'Load more jobs'}</button> : !!listing?.jobs.length && <span>You’re all caught up · {listing.jobs.length.toLocaleString()} jobs shown</span>}
        </div>
      </>}
    </section>

    <p className="text-xs text-slate-500">Includes worldwide roles with confirmed US eligibility. Additional listings powered by <a href="https://remotejobs.org" target="_blank" rel="noopener noreferrer" className="text-primary underline">RemoteJobs.org</a>.</p>

    {selected && <Modal title={selected.title} close={closeSelected}><p className="font-medium text-slate-700">{selected.company}</p><p className="mt-1 text-sm text-slate-500">{selected.location} · {workNames[selected.workArrangement]}{selected.employmentType ? ` · ${selected.employmentType}` : ''}</p>{selected.salary && <p className="mt-2 text-sm font-medium text-emerald-700">{selected.salary}</p>}
      <a href={selected.jobUrl} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-primary underline">Source: {selected.sourceName}<ExternalLink size={13} /></a>
      <div className="my-5 max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-700">{selected.description}</div>
      {canBid && user?.canCreateApplications !== false && <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 p-4"><h3 className="font-medium text-slate-800">Prepare your application</h3><p className="mt-1 text-sm text-slate-500">Save this job using your profile, then generate and edit your resume and cover letter.</p>{profiles.length ? <div className="mt-3 flex flex-wrap items-end gap-3"><label className="min-w-40 flex-1 text-sm text-slate-600">Your profile<select className={field + ' mt-1'} value={profileId} onChange={event => setProfileId(event.target.value)}>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.firstName} {profile.lastName}</option>)}</select></label><button className={primary} disabled={busy || !profileId} onClick={() => void createApplication()}>{busy ? 'Saving…' : 'Save and prepare resume'}</button></div> : <p className="mt-3 text-sm text-amber-700">You need an assigned profile to prepare a resume. Contact your administrator.</p>}</div>}
      <div className="flex flex-wrap justify-end gap-2"><button className={button} onClick={closeSelected}>Close</button><button className={button} disabled={marking !== null} onClick={() => void markApplied(selected)}>{marking === selected.id ? 'Saving…' : selected.applied ? 'Applied ✓ · Undo' : 'Mark applied'}</button><a href={selected.jobUrl} target="_blank" rel="noopener noreferrer" className={primary}>Apply at {selected.sourceName}<ExternalLink size={14} /></a></div><p className="mt-3 text-xs text-slate-500">Apply on the source website, then click Mark applied to track it for your account. Preparing a resume does not mark the job as applied.</p>
    </Modal>}

    {isMaster && addMode === 'source' && <Modal title="Add a free job source" close={closeAdd}><form onSubmit={saveSource} className="space-y-4"><label className="block text-sm text-slate-600">Source<select className={field + ' mt-1'} value={sourceForm.provider} onChange={event => setSourceForm({ provider: event.target.value, name: '', boardToken: management?.providers.find(item => item.id === event.target.value)?.choices?.[0] || '' })}>{management?.providers.map(item => <option key={item.id} value={item.id}>{item.name}{item.choices ? '' : item.board ? ' · company board' : ' · public feed'}</option>)}</select></label>
      {provider?.choices ? <><label className="block text-sm text-slate-600">{provider.id === 'remotejobs' ? 'Software category' : 'Employer recruiting system'}<select required className={field + ' mt-1'} value={sourceForm.boardToken} onChange={event => setSourceForm({ ...sourceForm, boardToken: event.target.value })}>{provider.choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}</select></label><p className="text-sm text-slate-500">Each feed collects jobs from many employers. Feeds import independently, so one unavailable feed does not stop the others.</p></> : provider?.board && <><label className="block text-sm text-slate-600">Company name<input required className={field + ' mt-1'} value={sourceForm.name} placeholder="Example company" onChange={event => setSourceForm({ ...sourceForm, name: event.target.value })} /></label><label className="block text-sm text-slate-600">Company board name<input required pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}" className={field + ' mt-1'} value={sourceForm.boardToken} placeholder="airbnb" onChange={event => setSourceForm({ ...sourceForm, boardToken: event.target.value })} /></label><p className="text-xs text-slate-500">Use the name from the hosted board URL: {sourceForm.provider === 'greenhouse' ? 'boards.greenhouse.io/airbnb → airbnb' : sourceForm.provider === 'lever' ? 'jobs.lever.co/spotify → spotify' : sourceForm.provider === 'smartrecruiters' ? 'careers.smartrecruiters.com/ServiceNow → ServiceNow' : 'jobs.ashbyhq.com/notion → notion'}. Paste only the board name.</p></>}
      <p className="text-sm text-slate-500">Only fully remote US software jobs will be imported. {provider && <a href={provider.docs} target="_blank" rel="noopener noreferrer" className="text-primary underline">Source documentation</a>}</p><div className="flex justify-end gap-2"><button type="button" className={button} onClick={closeAdd}>Cancel</button><button className={primary} disabled={busy}>Add source</button></div></form></Modal>}

    {isMaster && addMode === 'job' && <Modal title="Publish a remote US software job" close={closeAdd}><form onSubmit={saveJob} className="space-y-4">{(['title', 'company', 'location', 'jobUrl'] as const).map(key => <label key={key} className="block text-sm text-slate-600">{{ title: 'Job title', company: 'Company', location: 'US location', jobUrl: 'Original job URL' }[key]}<input required type={key === 'jobUrl' ? 'url' : 'text'} className={field + ' mt-1'} value={jobForm[key]} onChange={event => setJobForm({ ...jobForm, [key]: event.target.value })} /></label>)}<p className="rounded-lg bg-primary/5 p-3 text-sm text-primary-deep">This Job Pool accepts fully remote US software roles only.</p><label className="block text-sm text-slate-600">Job description<textarea required rows={7} className={field + ' mt-1'} value={jobForm.description} onChange={event => setJobForm({ ...jobForm, description: event.target.value })} /></label><p className="text-xs text-slate-500">Publishing makes this job visible to all users for 30 days. Duplicate job links are rejected.</p><div className="flex justify-end gap-2"><button type="button" className={button} onClick={closeAdd}>Cancel</button><button className={primary} disabled={busy}>Publish job</button></div></form></Modal>}
  </div>;
}
