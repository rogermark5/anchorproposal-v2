'use client';

import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Briefcase, Search, RefreshCw, Plus, ExternalLink, Settings2, X, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { api, PoolImportBatch, PoolJob, PoolListing, PoolManagement, PoolUpdates } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { jobTimeAgo } from '@/lib/job-time';

const field = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30';
const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const primary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-deep disabled:opacity-50';
const workNames: Record<string, string> = { REMOTE: 'Remote', HYBRID: 'Hybrid', ONSITE: 'On site', UNKNOWN: 'See listing' };
const countryNames: Record<string, string> = { US: 'US', GB: 'UK', IE: 'Ireland' };
const boardExamples: Record<string, string> = { greenhouse:'boards.greenhouse.io/airbnb → airbnb', lever:'jobs.lever.co/spotify → spotify', ashby:'jobs.ashbyhq.com/notion → notion', smartrecruiters:'careers.smartrecruiters.com/ServiceNow → ServiceNow', workable:'apply.workable.com/example → example', recruitee:'example.recruitee.com → example', breezy:'example.breezy.hr → example', pinpoint:'example.pinpointhq.com → example', personio:'example.jobs.personio.de → example', bamboohr:'example.bamboohr.com → example', teamtailor:'example.teamtailor.com → example.teamtailor.com (include the host)', paylocity:'recruiting.paylocity.com/recruiting/jobs/All/company-uuid → company-uuid' };
const when = (date: string | null) => date ? new Date(date).toLocaleString() : 'Never';
const message = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const jobStates = {
  New: { row: 'border-l-sky-400 bg-sky-50 hover:bg-sky-100 focus-within:bg-sky-100', badge: 'bg-sky-100 text-sky-900' },
  Viewed: { row: 'border-l-violet-400 bg-violet-100 hover:bg-violet-200 focus-within:bg-violet-200', badge: 'bg-violet-200 text-violet-950' },
  Applied: { row: 'border-l-emerald-500 bg-emerald-100 hover:bg-emerald-200 focus-within:bg-emerald-200', badge: 'bg-emerald-200 text-emerald-950' },
  Unviewed: { row: 'border-l-stone-200 bg-stone-50 hover:bg-stone-100 focus-within:bg-stone-100', badge: 'bg-stone-200 text-stone-800' },
};
const isNewJob = (job: PoolJob, batch?: PoolImportBatch | null) => !!batch && job.addedBatchId === batch.id;
const jobState = (job: PoolJob, batch?: PoolImportBatch | null): keyof typeof jobStates => job.applied ? 'Applied' : job.viewed ? 'Viewed' : isNewJob(job, batch) ? 'New' : 'Unviewed';
const newerBatch = (previous?: PoolImportBatch | null, incoming?: PoolImportBatch | null) => !previous || (incoming && incoming.startedAt >= previous.startedAt) ? incoming || null : previous;
const companyMatchRow = 'border-l-amber-500 bg-amber-200 hover:bg-amber-300 focus-within:bg-amber-300';

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
  const [q, setQ] = useState(''), [query, setQuery] = useState(''), [site, setSite] = useState('');
  const [country, setCountry] = useState('all');
  const [showImportDetails, setShowImportDetails] = useState(false);
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
  const viewedMarks = useRef(new Map<string, { viewed: true; viewedAt: string }>());
  const viewFlights = useRef(new Map<string, Promise<void>>());
  const activeUser = useRef(user?.id); activeUser.current = user?.id;
  useEffect(() => { viewedMarks.current.clear(); viewFlights.current.clear(); }, [user?.id]);
  const mergeViewed = useCallback((data: PoolListing): PoolListing => ({ ...data, jobs: data.jobs.map(job => ({ ...job, ...viewedMarks.current.get(job.id) })) }), []);
  const markFlight = useRef(false);
  useEffect(() => { const timer = setTimeout(() => setQuery(q.trim()), 350); return () => clearTimeout(timer); }, [q]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const filters = useCallback(() => ({ q: query, site, country, days, status, ...(isMaster && includeHidden ? { includeHidden: 'true' } : {}) }), [query, site, country, days, status, isMaster, includeHidden, user?.id]);
  const load = useCallback(async (quiet = false) => {
    const request = ++requestId.current; moreFlight.current = null; setLoadingMore(false); setMoreError('');
    setUpdates(null);
    setLoading(true); if (!quiet) setListing(null);
    try {
      const data = await api.getJobPool(filters());
      if (request === requestId.current) { loadedAt.current = data.asOf || new Date().toISOString(); setListing(mergeViewed(data)); setError(''); }
    } catch (err) { if (request === requestId.current) setError(message(err)); }
    finally { if (request === requestId.current) setLoading(false); }
  }, [filters, mergeViewed]);
  const latestLoad = useRef(load); latestLoad.current = load;
  const loadMore = useCallback(async () => {
    if (!listing?.nextCursor || loading || moreFlight.current !== null || markFlight.current) return;
    const request = requestId.current; moreFlight.current = request; setLoadingMore(true); setMoreError('');
    try {
      const data = await api.getJobPool({ ...filters(), cursor: listing.nextCursor });
      if (request === requestId.current) setListing(previous => previous ? mergeViewed({ ...data, latestImport: newerBatch(previous.latestImport, data.latestImport), jobs: [...previous.jobs, ...data.jobs.filter(job => !previous.jobs.some(existing => existing.id === job.id))] }) : mergeViewed(data));
    } catch (err) { if (request === requestId.current) setMoreError(message(err)); }
    finally { if (request === requestId.current) { moreFlight.current = null; setLoadingMore(false); } }
  }, [listing?.nextCursor, loading, marking, filters, mergeViewed]);
  useEffect(() => {
    const element = sentinel.current; if (!element || !listing?.nextCursor || moreError || loading || loadingMore) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void loadMore(); }, { rootMargin: '300px' });
    observer.observe(element); return () => observer.disconnect();
  }, [loadMore, listing?.nextCursor, loading, loadingMore, moreError]);
  const loadManagement = useCallback(async () => { if (isMaster) setManagement(await api.getPoolManagement()); }, [isMaster]);
  const loadImportStatus = useCallback(async () => {
    if (!isMaster) return;
    const status = await api.getPoolSummary();
    setManagement(previous => previous ? { ...previous, ...status, sources: previous.sources } : previous);
  }, [isMaster]);
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
        if (active && request === requestId.current && !markFlight.current) {
          setUpdates(data);
          setListing(previous => {
            if (!previous) return previous;
            const latestImport = newerBatch(previous.latestImport, data.latestImport);
            return latestImport?.id === previous.latestImport?.id ? previous : { ...previous, latestImport };
          });
        }
      } catch { /* Keep the list usable during a temporary connection failure. */ }
      finally { inFlight = false; }
    };
    const timer = setInterval(() => { void check(); }, 15_000);
    const focused = () => { void check(); };
    window.addEventListener('focus', focused); document.addEventListener('visibilitychange', focused);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', focused); document.removeEventListener('visibilitychange', focused); };
  }, [hasListing, filters]);
  useEffect(() => { if (isMaster) void loadManagement().catch(err => toast.error(message(err))); }, [isMaster, loadManagement]);
  const importing = management?.sourceStats?.importing ?? (management?.sources.some(source => source.running || source.queued) ?? false);
  useEffect(() => {
    if (!isMaster || (!importing && !management?.settings.enabled)) return;
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      void (showSources ? loadManagement() : loadImportStatus()).catch(() => {}).finally(() => { inFlight = false; });
    }, showSources ? 30_000 : importing ? 4000 : 15_000);
    return () => clearInterval(timer);
  }, [isMaster, importing, management?.settings.enabled, showSources, loadManagement, loadImportStatus]);
  const mutate = async (operation: () => Promise<unknown>, success?: string) => {
    setBusy(true);
    try { await operation(); if (success) toast.success(success); await Promise.all([loadManagement(), load(true)]); }
    catch (err) { toast.error(message(err)); } finally { setBusy(false); }
  };
  const sync = () => void mutate(async () => { const result = await api.syncPoolSources(); toast.message(result.message); });
  const refresh = () => void Promise.all([load(true), loadManagement()]).catch(err => toast.error(message(err)));
  const closeSelected = useCallback(() => { setSelected(null); }, []), closeAdd = useCallback(() => { setAddMode(null); }, []);
  const markViewed = (job: PoolJob): Promise<void> => {
    if (!user?.id || job.viewed || viewedMarks.current.has(job.id)) return Promise.resolve();
    const existing = viewFlights.current.get(job.id); if (existing) return existing;
    const actor = user.id;
    const flight: Promise<void> = api.markPoolJobViewed(job.id).then(result => {
      if (activeUser.current !== actor) return;
      viewedMarks.current.set(job.id, result);
      setListing(previous => previous ? mergeViewed(previous) : previous);
      setSelected(previous => previous?.id === job.id ? { ...previous, ...result } : previous);
    }).catch(err => { if (activeUser.current === actor) toast.error('Could not save viewed status. ' + message(err)); })
      .finally(() => { if (viewFlights.current.get(job.id) === flight) viewFlights.current.delete(job.id); });
    viewFlights.current.set(job.id, flight); return flight;
  };
  const openJob = async (job: PoolJob) => {
    try {
      const [detail, available] = await Promise.all([api.getPoolJob(job.id), canBid ? api.getProfiles() as Promise<Profile[]> : Promise.resolve([])]);
      setSelected({ ...detail, ...viewedMarks.current.get(job.id), companyMatches: detail.companyMatches || job.companyMatches }); setProfiles(available); setProfileId(available.find(profile => profile.isDefault)?.id || available[0]?.id || '');
      void markViewed(job);
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
        if (after && !jobs.some(item => item.id === job.id)) jobs = [...jobs, { ...job, ...result }].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
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
  const totalSources = management?.sourceStats?.totalSources ?? management?.sources.length ?? 0;
  const enabledSources = management?.sourceStats?.enabledSources ?? management?.sources.filter(source => source.enabled && source.configured).length ?? 0;
  const matchingSources = management?.sourceStats?.matchingSources ?? management?.sources.filter(source => source.enabled && source.configured && source.lastCount > 0).length ?? 0;
  const pendingSources = management?.sourceStats?.pendingSources ?? management?.sources.filter(source => source.enabled && source.configured && !source.lastAttemptAt).length ?? 0;
  const checkedSources = management?.sourceStats?.checkedSources ?? management?.sources.filter(source => source.enabled && source.configured && source.lastAttemptAt).length ?? 0;
  const runningSources = management?.sourceStats?.runningSources ?? management?.sources.filter(source => source.running).length ?? 0;
  const retrySources = management?.sourceStats?.retrySources ?? management?.sources.filter(source => source.enabled && source.configured && source.lastError).length ?? 0;
  const provider = management?.providers.find(item => item.id === sourceForm.provider);
  const filteredSources = management?.sources.filter(source => `${source.name} ${source.provider} ${source.boardToken}`.toLowerCase().includes(sourceQuery.trim().toLowerCase())) || [];
  const sourcePages = Math.max(1, Math.ceil(filteredSources.length / 50)), currentSourcePage = Math.min(sourcePage, sourcePages);
  const visibleSources = filteredSources.slice((currentSourcePage - 1) * 50, currentSourcePage * 50);


  return <div className="p-4 sm:p-6 lg:p-8">
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold text-slate-800">Remote Software Jobs</h1><p className="mt-1 text-sm text-slate-500">{isMaster ? 'Find remote software jobs open to US, UK and Ireland applicants using free sources.' : 'Browse remote software jobs open to US, UK and Ireland applicants. Track your applications and find new opportunities.'}</p></div>
      <div className="flex flex-wrap gap-2"><button className={button} onClick={refresh}><RefreshCw size={16} /> Refresh</button>{isMaster && <><button className={button} onClick={() => { setJobForm(emptyJob); setAddMode('job'); }}><Plus size={16} /> Add job</button><button className={primary} disabled={busy || importing || !enabledSources} onClick={sync}><RefreshCw size={16} className={importing ? 'animate-spin' : ''} />{importing ? 'Importing jobs…' : 'Import jobs now'}</button></>}</div>
    </div>

    {isMaster && management && <section className="mb-6 rounded-xl border border-[var(--border)] bg-white p-5" aria-label="Automatic job imports">
      <div className="flex flex-wrap items-center justify-between gap-4"><div><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${management.settings.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`} /><h2 className="font-semibold text-slate-800">Automatic imports {management.settings.enabled ? 'on' : 'paused'}</h2></div><p className="mt-1 text-sm text-slate-500">{enabledSources} enabled sources · Remote software roles · US, UK and Ireland · Duplicate links skipped · No paid APIs or AI calls</p></div>
        <div className="flex flex-wrap items-center gap-2"><label className="text-sm text-slate-600" htmlFor="pool-interval">Refresh every</label><select id="pool-interval" className={field + ' !w-auto'} value={management.settings.intervalHours} disabled={busy} onChange={event => void mutate(() => api.updatePoolSettings({ intervalHours: Number(event.target.value) }))}>{[1, 6, 12, 24].map(hours => <option key={hours} value={hours}>{hours} {hours === 1 ? 'hour' : 'hours'}</option>)}</select>
          <button className={management.settings.enabled ? button : primary} disabled={busy || !enabledSources} onClick={() => void mutate(() => api.updatePoolSettings({ enabled: !management.settings.enabled }), management.settings.enabled ? 'Automatic imports paused.' : 'Automatic imports enabled. Jobs appear as they are imported.')}>{management.settings.enabled ? 'Pause imports' : 'Start automatic imports'}</button></div>
      </div>
      <details className="mt-3" open={showImportDetails} onToggle={event => setShowImportDetails(event.currentTarget.open)}><summary className="cursor-pointer text-sm font-medium text-primary">Import details and manage sources</summary>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Source coverage">
        <div className="rounded-lg bg-slate-50 px-4 py-3"><p className="text-xl font-semibold text-slate-800">{totalSources.toLocaleString()}</p><p className="text-xs text-slate-500">Distinct sources in the library</p><p className="mt-1 text-xs text-slate-500">{(management.sourceTarget || 30000).toLocaleString()} total source target · {totalSources >= (management.sourceTarget || 30000) ? 'Met' : `${((management.sourceTarget || 30000) - totalSources).toLocaleString()} more needed`}</p></div>
        <div className="rounded-lg bg-slate-50 px-4 py-3"><p className="text-xl font-semibold text-slate-800">{checkedSources.toLocaleString()}</p><p className="text-xs text-slate-500">Sources checked at least once</p></div>
        <div className="rounded-lg bg-slate-50 px-4 py-3"><p className="text-xl font-semibold text-slate-800">{matchingSources.toLocaleString()}</p><p className="text-xs text-slate-500">Returned matching jobs in their latest import</p></div>
        <div className="rounded-lg bg-slate-50 px-4 py-3"><p className="text-xl font-semibold text-slate-800">{pendingSources.toLocaleString()}</p><p className="text-xs text-slate-500">Sources waiting for their first check</p></div>
      </div>
      <p className="mt-2 text-xs text-slate-500">Each employer board is a separate source. Some sources have no qualifying remote software openings right now.</p>
      {management.coverage && <div className="mt-4" aria-label="Country source coverage">
        <div className="grid gap-3 md:grid-cols-3">{management.coverage.map(item => <div key={item.country} className="rounded-lg border border-slate-200 p-4" aria-label={`${item.name} coverage`}>
          <h3 className="font-medium text-slate-800">{item.name}</h3>
          <p className="mt-2 text-lg font-semibold text-primary-deep">{item.matchingSources.toLocaleString()} <span className="text-xs font-normal text-slate-500">sources with eligible jobs</span></p>
          <p className="text-xs text-slate-500">{item.target.toLocaleString()} country source target · {item.matchingSources >= item.target ? 'Met' : `${(item.target - item.matchingSources).toLocaleString()} more needed`}</p>
          <dl className="mt-3 space-y-1 text-xs"><div className="flex justify-between gap-2"><dt className="text-slate-500">Sources monitored</dt><dd className="font-medium text-slate-700">{item.monitoredSources.toLocaleString()}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Successfully read</dt><dd className="font-medium text-slate-700">{item.successfullyReadSources.toLocaleString()}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Available jobs</dt><dd className="font-semibold text-primary-deep">{item.availableJobs.toLocaleString()}</dd></div></dl>
        </div>)}</div>
        <p className="mt-2 text-xs text-slate-500">Country targets count distinct sources with currently available remote software jobs eligible in that country. Employer boards are shared and read once; worldwide jobs can qualify in several countries. Sources with no matching openings count only toward the total library.</p>
      </div>}
      <p className="mt-2 text-sm text-slate-600" aria-live="polite">{runningSources ? `${runningSources} sources importing now.` : management.settings.enabled ? 'Waiting for the next import pass.' : 'Automatic imports are paused.'}{retrySources > 0 && ` ${retrySources} sources need a retry; other sources continue importing.`}</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3"><p className="text-xs text-slate-500">Imports continue on the server when this page is closed. Source limits and the minimum one-hour refresh interval are respected.</p><button className="inline-flex items-center gap-2 text-sm font-medium text-primary" aria-expanded={showSources} onClick={() => setShowSources(value => !value)}><Settings2 size={16} />{showSources ? 'Hide sources' : 'Manage sources'}</button></div>
      {showSources && <div className="mt-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-medium text-slate-800">Free job sources</h3><p className="text-xs text-slate-500">Search the source library or add a board from one of the supported recruiting platforms.</p></div><button className={button} onClick={() => setAddMode('source')}><Plus size={16} /> Add source</button></div>
        <label className="mb-3 block text-sm text-slate-600">Search sources<input className={field + ' mt-1'} placeholder="Company or provider…" value={sourceQuery} onChange={event => { setSourceQuery(event.target.value); setSourcePage(1); }} /></label><div className="max-h-96 overflow-auto rounded-lg border border-slate-200"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Enabled</th><th className="p-3">Source</th><th className="p-3">Last import</th><th className="p-3">Status</th></tr></thead><tbody>{visibleSources.map(source => <tr key={source.id} className="border-t border-slate-100">
          <td className="p-3"><input type="checkbox" aria-label={`Enable ${source.name}`} checked={source.enabled} disabled={busy || !source.configured} onChange={event => void mutate(() => api.updatePoolSource(source.id, event.target.checked))} /></td>
          <td className="p-3"><p className="font-medium text-slate-800">{source.name}</p><p className="text-xs text-slate-500">{management.providers.find(item => item.id === source.provider)?.name}{source.boardToken ? ` / ${source.boardToken}` : ''}</p></td>
          <td className="p-3 text-xs text-slate-500">{when(source.lastSyncedAt)}{source.lastSyncedAt && <p>{source.lastCount} matching listings processed</p>}</td>
          <td className="max-w-xs p-3 text-xs">{!source.configured ? <span className="text-amber-700">Requires a free USAJOBS key. Set USAJOBS_API_KEY and USAJOBS_EMAIL on the server, then restart the API.</span> : source.running || source.queued ? <span className="text-primary">{source.running ? 'Importing…' : 'Queued'}</span> : source.lastError ? <span className="text-amber-700">{source.lastError}<br />Next retry: {when(source.nextSyncAt)}</span> : source.lastSyncedAt ? <span className="text-emerald-700">Ready · Next refresh {when(source.nextSyncAt)}</span> : <span className="text-slate-500">Ready for first import</span>}</td>
        </tr>)}</tbody></table></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>{filteredSources.length} matching sources · Page {currentSourcePage} of {sourcePages}</span><div className="flex gap-2"><button className={button} disabled={currentSourcePage <= 1} onClick={() => setSourcePage(value => value - 1)}>Previous sources</button><button className={button} disabled={currentSourcePage >= sourcePages} onClick={() => setSourcePage(value => value + 1)}>Next sources</button></div></div>
        <p className="mt-3 text-xs text-slate-500">USAJOBS is optional and free. <a href="https://developer.usajobs.gov/apirequest/" target="_blank" rel="noopener noreferrer" className="text-primary underline">Request a free key</a>. Other sources need no API key. Imported jobs keep their original source and application link.</p>
        <p className="mt-2 text-xs text-slate-500">Company directory adapted from <a href="https://lastroundai.com/blog/salary-transparency-study-2026" target="_blank" rel="noopener noreferrer" className="text-primary underline">LastRound AI</a> under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" className="text-primary underline">CC BY 4.0</a>. Boards are independently checked for matching openings.</p>
      </div>}
      </details>
    </section>}

    <section className="rounded-xl border border-[var(--border)] bg-white" aria-label="Available jobs">
      {updates && updates.newCount > 0 && <div role="status" className="fixed bottom-5 left-4 right-4 z-40 mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-white px-5 py-3 text-sm text-primary-deep shadow-lg"><span>{updates.newCount.toLocaleString()} new matching {updates.newCount === 1 ? 'job has' : 'jobs have'} been imported.</span><button className={button} onClick={refresh}>Refresh job list</button></div>}
      <div role="search" aria-label="Filter jobs" className={'grid grid-cols-2 items-end gap-3 rounded-t-xl border-b border-slate-200 bg-slate-50/70 px-4 py-3 sm:grid-cols-4 ' + (isMaster ? 'xl:grid-cols-[minmax(200px,2fr)_minmax(110px,0.8fr)_minmax(130px,1fr)_minmax(150px,1fr)_minmax(120px,0.9fr)_auto]' : 'xl:grid-cols-[minmax(200px,2fr)_minmax(110px,0.8fr)_minmax(130px,1fr)_minmax(150px,1fr)_minmax(120px,0.9fr)]')}>
        <label htmlFor="pool-search" className="col-span-2 min-w-0 text-xs font-medium text-slate-600 xl:col-span-1">Search jobs<div className="relative mt-1"><Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input id="pool-search" aria-label="Search jobs" className={field + ' h-10 min-w-0 pl-10'} placeholder="Job title, company, location or skill…" value={q} onChange={event => setQ(event.target.value)} /></div></label>
        <label className="min-w-0 text-xs font-medium text-slate-600">Country<select aria-label="Filter by country" className={field + ' mt-1 block h-10 min-w-0'} value={country} onChange={event => setCountry(event.target.value)}><option value="all">All countries</option><option value="US">United States</option><option value="GB">United Kingdom</option><option value="IE">Ireland</option></select></label>
        <label className="min-w-0 text-xs font-medium text-slate-600">Site<select aria-label="Filter by site" className={field + ' mt-1 block h-10 min-w-0'} value={site} onChange={event => setSite(event.target.value)}><option value="">All sites</option>{listing?.sites?.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
        <label className="min-w-0 text-xs font-medium text-slate-600">Added<select aria-label="Filter by added time" title="Rolling time since first added to the pool" className={field + ' mt-1 block h-10 min-w-0'} value={days} onChange={event => setDays(event.target.value)}><option value="all">All time</option>{[1, 3, 7, 14, 30].map(day => <option key={day} value={day}>{day === 1 ? 'Last 24 hours' : 'Last ' + day + ' days (' + day * 24 + ' hours)'}</option>)}</select></label>
        <label className="min-w-0 text-xs font-medium text-slate-600">My applications<select aria-label="Filter by applied status" className={field + ' mt-1 block h-10 min-w-0'} value={status} onChange={event => setStatus(event.target.value)}><option value="not-applied">Not applied</option><option value="applied">Applied</option><option value="all">All jobs</option></select></label>
        {isMaster && <label className="flex h-10 cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-600 transition-colors hover:border-primary/40 hover:bg-primary/5 focus-within:ring-2 focus-within:ring-primary/30"><input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={includeHidden} onChange={event => { setIncludeHidden(event.target.checked); }} /> Show hidden</label>}
      </div>
      {error && <div role="alert" className="m-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}<button className="ml-3 underline" onClick={() => void load()}>Try again</button></div>}
      {loading && !listing ? <p className="p-12 text-center text-sm text-slate-500">Loading jobs…</p> : <>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs text-slate-600"><span>{(updates?.total ?? listing?.total ?? 0).toLocaleString()} matching remote software jobs{loading && ' · Updating…'}</span><span className="text-slate-600" title={listing?.latestImport ? `Latest additions started ${when(listing.latestImport.startedAt)}; grouped by the ${listing.latestImport.intervalHours}-hour import interval.` : undefined}>New = latest import additions</span><div aria-label="Job status colors" className="flex flex-wrap items-center gap-1.5">{(Object.keys(jobStates) as (keyof typeof jobStates)[]).map(state => <span key={state} className={'rounded px-2 py-1 font-medium ' + jobStates[state].badge}>{state}</span>)}<span className="rounded bg-amber-200 px-2 py-1 font-medium text-amber-950" title="Company matches stay amber; Viewed and Applied are saved separately from the latest import.">Company match</span></div></div>
        {!listing?.jobs.length ? <div className="p-12 text-center"><Briefcase size={48} className="mx-auto mb-3 text-slate-200" /><h3 className="font-medium text-slate-700">No jobs match these filters</h3><p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">{isMaster ? 'Click Import jobs now, start automatic imports, or add a job manually.' : 'Try All jobs or a wider date range, or check back for newly published software roles.'}</p></div> : <div className="divide-y divide-slate-100">{listing.jobs.map(job => <article key={job.id} data-job-id={job.id} data-job-state={jobState(job, listing.latestImport)} data-job-new={isNewJob(job, listing.latestImport)} className={'flex flex-col gap-1.5 border-l-[3px] px-4 py-2 transition-colors duration-150 motion-reduce:transition-none lg:flex-row lg:items-center lg:gap-4 ' + (job.companyMatches?.length ? companyMatchRow : jobStates[jobState(job, listing.latestImport)].row)}>
          <div className="min-w-0 flex-1">
            <button onClick={() => void openJob(job)} title={job.title} className="block max-w-full truncate text-left text-sm font-semibold leading-5 text-primary-deep hover:underline">{job.title}</button>
            <div className="flex min-w-0 items-center gap-2 text-xs leading-5 text-slate-600"><span className="max-w-[35%] truncate font-medium text-slate-700" title={job.company}>{job.company}</span><span aria-hidden="true">·</span><span className="min-w-0 truncate" title={job.location}>{job.location}</span><span className="shrink-0 text-primary-deep">{job.eligibleCountries?.map(code => countryNames[code]).join(' / ')}</span><span className={'shrink-0 rounded px-1.5 text-[11px] font-semibold leading-4 ' + jobStates[jobState(job, listing.latestImport)].badge}>{jobState(job, listing.latestImport)}</span>{isNewJob(job, listing.latestImport) && (job.viewed || job.applied) && <span className={'shrink-0 rounded px-1.5 text-[11px] font-semibold leading-4 ' + jobStates.New.badge}>New</span>}{job.hidden && <span className="text-amber-700">Hidden</span>}</div>
            {!!job.companyMatches?.length && <div className="flex flex-wrap items-center gap-x-2 text-xs leading-5 text-amber-800"><span>Company match: {job.company} ↔</span>{job.companyMatches.slice(0, 2).map(match => <a key={match.id} href={'/applications/' + match.id} onClick={event => { event.preventDefault(); router.push('/applications/' + match.id); }} className="underline" title={'Open my application: ' + match.jobTitle}>{match.company}</a>)}{job.companyMatches.length > 2 && <button className="underline" onClick={() => void openJob(job)}>+{job.companyMatches.length - 2} more</button>}</div>}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs [&>button]:px-2 [&>button]:py-1 [&>button]:text-xs [&>a]:px-2 [&>a]:py-1 [&>a]:text-xs">
            <time dateTime={job.createdAt} title={'Added ' + new Date(job.createdAt).toLocaleString()} className="mr-1 whitespace-nowrap text-xs text-slate-600">Added {jobTimeAgo(job.createdAt, now)}</time>
            <button className={button} disabled={marking !== null} aria-label={(job.applied ? 'Mark not applied' : 'Mark applied') + ': ' + job.title} onClick={() => void markApplied(job)}>{marking === job.id ? 'Saving…' : job.applied ? 'Applied ✓ · Undo' : 'Mark applied'}</button>
            {isMaster && <button className={button} disabled={busy} onClick={() => void mutate(() => api.hidePoolJob(job.id, !job.hidden), job.hidden ? 'Job visible to users.' : 'Job hidden from users.')}><EyeOff size={12} />{job.hidden ? 'Show job' : 'Hide'}</button>}
            <button className={button} onClick={() => void openJob(job)}>View job</button><a className={primary} href={job.jobUrl} onClick={() => void markViewed(job)} onAuxClick={event => { if (event.button === 1) void markViewed(job); }} target="_blank" rel="noopener noreferrer">Apply<ExternalLink size={12} /></a>
          </div>
        </article>)}</div>}
        <div ref={sentinel} data-testid="job-scroll-sentinel" className="flex min-h-20 flex-col items-center justify-center gap-2 border-t border-slate-200 p-4 text-sm text-slate-500" aria-live="polite">
          {moreError && <p role="alert" className="text-red-700">{moreError}</p>}
          {loadingMore ? <span>Loading more jobs…</span> : listing?.nextCursor ? <button className={button} disabled={loading || marking !== null} onClick={() => void loadMore()}>{moreError ? 'Retry loading jobs' : 'Load more jobs'}</button> : !!listing?.jobs.length && <span>You’re all caught up · {listing.jobs.length.toLocaleString()} jobs shown</span>}
        </div>
      </>}
    </section>

    <p className="text-xs text-slate-500">Includes worldwide roles with confirmed eligibility for US, UK or Ireland applicants. Additional listings powered by <a href="https://remotejobs.org" target="_blank" rel="noopener noreferrer" className="text-primary underline">RemoteJobs.org</a>.</p>

    {selected && <Modal title={selected.title} close={closeSelected}><p className="font-medium text-slate-700">{selected.company}</p><p className="mt-1 text-sm text-slate-500">{selected.location} · {workNames[selected.workArrangement]}{selected.employmentType ? ` · ${selected.employmentType}` : ''}</p>{selected.salary && <p className="mt-2 text-sm font-medium text-emerald-700">{selected.salary}</p>}
      {!!selected.companyMatches?.length && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><p>Company match: {selected.company}</p>{selected.companyMatches.map(match => <a key={match.id} className="mt-1 block underline" href={'/applications/' + match.id} onClick={event => {event.preventDefault();router.push('/applications/' + match.id);}}>My application: {match.company} · {match.jobTitle}</a>)}</div>}
      <a href={selected.jobUrl} onClick={() => void markViewed(selected)} onAuxClick={event => { if (event.button === 1) void markViewed(selected); }} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm text-primary underline">Source: {selected.sourceName}<ExternalLink size={13} /></a>
      <div className="my-5 max-h-[40vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-700">{selected.description}</div>
      {canBid && user?.canCreateApplications !== false && <div className="mb-5 rounded-xl border border-primary/20 bg-primary/5 p-4"><h3 className="font-medium text-slate-800">Prepare your application</h3><p className="mt-1 text-sm text-slate-500">Save this job using your profile, then generate and edit your resume and cover letter.</p>{profiles.length ? <div className="mt-3 flex flex-wrap items-end gap-3"><label className="min-w-40 flex-1 text-sm text-slate-600">Your profile<select className={field + ' mt-1'} value={profileId} onChange={event => setProfileId(event.target.value)}>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.firstName} {profile.lastName}</option>)}</select></label><button className={primary} disabled={busy || !profileId} onClick={() => void createApplication()}>{busy ? 'Saving…' : 'Save and prepare resume'}</button></div> : <p className="mt-3 text-sm text-amber-700">You need an assigned profile to prepare a resume. Contact your administrator.</p>}</div>}
      <div className="flex flex-wrap justify-end gap-2"><button className={button} onClick={closeSelected}>Close</button><button className={button} disabled={marking !== null} onClick={() => void markApplied(selected)}>{marking === selected.id ? 'Saving…' : selected.applied ? 'Applied ✓ · Undo' : 'Mark applied'}</button><a href={selected.jobUrl} target="_blank" rel="noopener noreferrer" className={primary}>Apply at {selected.sourceName}<ExternalLink size={14} /></a></div><p className="mt-3 text-xs text-slate-500">Apply on the source website, then click Mark applied to track it for your account. Preparing a resume does not mark the job as applied.</p>
    </Modal>}

    {isMaster && addMode === 'source' && <Modal title="Add a free job source" close={closeAdd}><form onSubmit={saveSource} className="space-y-4"><label className="block text-sm text-slate-600">Source<select className={field + ' mt-1'} value={sourceForm.provider} onChange={event => setSourceForm({ provider: event.target.value, name: '', boardToken: management?.providers.find(item => item.id === event.target.value)?.choices?.[0] || '' })}>{management?.providers.map(item => <option key={item.id} value={item.id}>{item.name}{item.choices ? '' : item.board ? ' · company board' : ' · public feed'}</option>)}</select></label>
      {provider?.choices ? <><label className="block text-sm text-slate-600">{provider.id === 'remotejobs' ? 'Software category' : provider.id === 'jobicy' ? 'Applicant location' : 'Employer recruiting system'}<select required className={field + ' mt-1'} value={sourceForm.boardToken} onChange={event => setSourceForm({ ...sourceForm, boardToken: event.target.value })}>{provider.choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}</select></label><p className="text-sm text-slate-500">Each feed collects jobs from many employers. Feeds import independently, so one unavailable feed does not stop the others.</p></> : provider?.board && <><label className="block text-sm text-slate-600">Company name<input required className={field + ' mt-1'} value={sourceForm.name} placeholder="Example company" onChange={event => setSourceForm({ ...sourceForm, name: event.target.value })} /></label><label className="block text-sm text-slate-600">Company board name<input required pattern="[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}" className={field + ' mt-1'} value={sourceForm.boardToken} placeholder="airbnb" onChange={event => setSourceForm({ ...sourceForm, boardToken: event.target.value })} /></label><p className="text-xs text-slate-500">Use the name from the hosted board URL: {boardExamples[sourceForm.provider] || 'example'}. Paste only the board name.</p></>}
      <p className="text-sm text-slate-500">Only fully remote software jobs eligible in the US, UK or Ireland will be imported. {provider && <a href={provider.docs} target="_blank" rel="noopener noreferrer" className="text-primary underline">Source documentation</a>}</p><div className="flex justify-end gap-2"><button type="button" className={button} onClick={closeAdd}>Cancel</button><button className={primary} disabled={busy}>Add source</button></div></form></Modal>}

    {isMaster && addMode === 'job' && <Modal title="Publish a remote software job" close={closeAdd}><form onSubmit={saveJob} className="space-y-4">{(['title', 'company', 'location', 'jobUrl'] as const).map(key => <label key={key} className="block text-sm text-slate-600">{{ title: 'Job title', company: 'Company', location: 'Eligible location (US, UK or Ireland)', jobUrl: 'Original job URL' }[key]}<input required type={key === 'jobUrl' ? 'url' : 'text'} className={field + ' mt-1'} value={jobForm[key]} onChange={event => setJobForm({ ...jobForm, [key]: event.target.value })} /></label>)}<p className="rounded-lg bg-primary/5 p-3 text-sm text-primary-deep">This Job Pool accepts fully remote software roles open to US, UK or Ireland applicants.</p><label className="block text-sm text-slate-600">Job description<textarea required rows={7} className={field + ' mt-1'} value={jobForm.description} onChange={event => setJobForm({ ...jobForm, description: event.target.value })} /></label><p className="text-xs text-slate-500">Publishing makes this job visible to all users for 30 days. Duplicate job links are rejected.</p><div className="flex justify-end gap-2"><button type="button" className={button} onClick={closeAdd}>Cancel</button><button className={primary} disabled={busy}>Publish job</button></div></form></Modal>}
  </div>;
}
