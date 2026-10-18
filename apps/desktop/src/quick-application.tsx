import React, { useEffect, useRef, useState } from 'react';
import { ClipboardPaste, Check, LoaderCircle, Plus, Sparkles, AlertTriangle, X } from 'lucide-react';
import { toast } from 'sonner';
import { ApplicationFormFields } from '../../web/src/components/application-form-fields';
import { useApplicationValidation } from '../../web/src/lib/use-application-validation';
import { ManualGenerationDialog } from '../../web/src/components/manual-generation-dialog';
import { api, type ApplicationOption } from '../../web/src/lib/api';
import { useAuth } from './auth-context';
import QuickResult from './quick-result';

const blank = { profileId: '', templateId: '', jobTitle: '', company: '', location: '', workArrangement: 'REMOTE', source: '', jobUrl: '', noJobLink: false, jobDescription: '' };
const active = (job: Job | null) => !!job && ['connecting', 'generating', 'saving'].includes(job.stage);
export default function QuickApplication() {
  const { user, canBid, isAdmin } = useAuth();
  const [form, setForm] = useState(blank);
  const draftValidation = useApplicationValidation(form);
  const [profiles, setProfiles] = useState<any[]>([]); const [templates, setTemplates] = useState<any[]>([]);
  const [options, setOptions] = useState<{ locations: ApplicationOption[]; sources: ApplicationOption[] }>({ locations: [], sources: [] });
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [resultBusy, setResultBusy] = useState(false);
  const resultBusyRef = useRef(false);
  resultBusyRef.current = resultBusy;
  const [syncError, setSyncError] = useState('');
  const [mode, setMode] = useState('automatic'); const [job, setJob] = useState<Job | null>(null);
  const [review, setReview] = useState<{ app: any; warnings: string[]; blocked: boolean } | null>(null); const [manual, setManual] = useState<any>(null);
  const saved = useRef<any>(null); const finishedDraft = useRef(false); const lock = useRef(false); const [elapsed, setElapsed] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const clearDraft = () => { saved.current = null; setForm(f => ({ ...blank, profileId: f.profileId, templateId: f.templateId, location: f.location, source: f.source })); };
  const loadOptions = async () => { const result = await api.getApplicationOptions(); setOptions(result); return result; };
  useEffect(() => {
    let mounted = true;
    let request = 0;
    const refresh = async () => {
      const version = ++request;
      api.invalidateCache();
      const profileRequest = isAdmin ? api.getProfiles() : api.getAssignedProfiles().then(rows => (rows as any[]).map(assignment => ({ ...assignment.profile, id: assignment.profileId, isDefault: assignment.isDefault })));
      const results = await Promise.allSettled([profileRequest, api.getTemplates(), api.getApplicationOptions()]);
      if (!mounted || version !== request) return;
      const [p,t,o] = results;
      if (p.status === 'fulfilled') { const rows = p.value as any[]; setProfiles(rows); setForm(f => ({ ...f, profileId: rows.some(p => p.id === f.profileId) ? f.profileId : rows.find(p => p.isDefault)?.id || rows[0]?.id || '' })); }
      if (t.status === 'fulfilled') { const designs = (t.value as any[]).filter(t => t.isPublished); setTemplates(designs); setForm(f => ({ ...f, templateId: designs.some(t => t.id === f.templateId) ? f.templateId : designs.find(t => t.isDefault)?.id || designs[0]?.id || '' })); }
      if (o.status === 'fulfilled') { setOptions(o.value); setForm(f => ({ ...f, location: f.location || o.value.locations.find(l => l.isDefault)?.value || '', source: f.source || o.value.sources.find(l => l.isDefault)?.value || '' })); }
      const failed = results.find(r => r.status === 'rejected');
      setSyncError(failed?.status === 'rejected' ? failed.reason.message || 'Could not refresh profiles and templates.' : '');
      setLoading(false);
    };
    window.addEventListener('focus', refresh);
    void refresh();
    void window.anchor.bootstrap().then(s => { if (active(s.job)) setJob(s.job); }).catch(e => setError(e.message));
    const off = window.anchor.onEvent(event => {
      if (event.type === 'quick-show' || event.type === 'data-changed' && /^\/(profiles|templates|application-options|users|settings)/.test(event.route)) void refresh();
      if (event.type === 'job') {
        setJob(event.job);
        if (event.job?.stage === 'completed') { finishedDraft.current = true; clearDraft(); }
      }
      if (event.type === 'quick-show' && !active(event.job)) {
        if (resultBusyRef.current) return;
        if (event.showResult && event.job) setJob(event.job);
        else if (finishedDraft.current) fresh();
        else setJob(null);
      }
    });
    return () => { mounted = false; off(); window.removeEventListener('focus', refresh); };
  }, [isAdmin, user?.id]);
  useEffect(() => { if (!job) return; const tick = () => setElapsed(Math.floor(((job.finishedAt || Date.now()) - job.startedAt) / 1000)); tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, [job]);
  useEffect(() => {
    if (!job && !loading && !manual && !review) formRef.current?.querySelector<HTMLInputElement>('input:not([type="checkbox"])')?.focus({ preventScroll: true });
  }, [job, loading, manual, review]);
  const run = async (fn: () => Promise<void>) => { if (lock.current) return; lock.current = true; setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Please try again.'); } finally { lock.current = false; setBusy(false); } };
  const begin = async (application: any) => {
    if ((application.warnings || []).some((warning: any) => warning.category !== 'DUPLICATE' && ['BLOCK', 'ADMIN_REVIEW'].includes(warning.behavior))) throw new Error('Resolve blocked warnings or obtain admin approval before generating.');
    for (const warning of application.warnings || []) if (warning.behavior === 'CONFIRM' && !warning.acknowledgedAt) await window.anchor.request(`/applications/warnings/${warning.id}/acknowledge`, 'PATCH', { reason: 'Reviewed in the desktop application.' });
    if (mode === 'manual') setManual(application);
    else setJob(await window.anchor.generate({ applicationId: application.id, templateId: form.templateId || undefined, title: `${application.jobTitle} · ${application.company}` }));
  };
  const submit = (saveOnly = false) => run(async () => {
    if (!draftValidation.canSave) throw new Error("Review the job description validation before creating an application.");
    if (!form.profileId || !form.jobTitle.trim() || !form.company.trim() || !form.jobDescription.trim()) throw new Error('Profile, job title, company, and job description are required.');
    if (!saveOnly && !form.templateId) throw new Error('Choose a resume template.');
    const { templateId, noJobLink, ...data } = form;
    const payload = { ...data, jobUrl: noJobLink ? '' : data.jobUrl.trim() };
    const application: any = saved.current ? await api.updateApplication(saved.current.id, payload) : await api.createApplication(payload);
    saved.current = application;
    if (saveOnly) { finishedDraft.current = true; clearDraft(); toast.success('Application saved on your server'); await window.anchor.window('hide'); return; }
    const prompt = await api.previewGenerationPrompt(application.id);
    const warnings = (application.warnings || []).map((warning: any) => warning.matchedText || warning.message || warning.context || warning.category);
    if (prompt.usedDefault) warnings.push(`No prompt is assigned to ${prompt.profileName}; your default prompt will be used.`);
    if (warnings.length) setReview({ app: application, warnings, blocked: (application.warnings || []).some((warning: any) => warning.category !== 'DUPLICATE' && ['BLOCK', 'ADMIN_REVIEW'].includes(warning.behavior)) }); else await begin(application);
  });
  const fresh = () => { saved.current = null; finishedDraft.current = false; setJob(null); setReview(null); setManual(null); setError(''); setForm(f => ({ ...blank, profileId: f.profileId, templateId: f.templateId, location: f.location, source: f.source })); void window.anchor.window('expand'); };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'n' && !event.shiftKey && !event.altKey && !busy && !resultBusy && job && !active(job) && !manual && !review) { event.preventDefault(); fresh(); }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [busy, resultBusy, job, manual, review]);
  if (!canBid) return <div className="quick-empty"><h2>New application</h2><p>Sign in as an admin or bidder to create an application. Master manages the platform.</p><button className="native-secondary" onClick={() => void window.anchor.window('workspace')}>Open workspace</button></div>;
  return <div className="quick-application">
    {(error || syncError) && <div role="alert" className="native-error"><AlertTriangle size={16}/>{error || syncError}<button aria-label="Dismiss error" onClick={() => { setError(''); setSyncError(''); }}><X size={15}/></button></div>}
    {job ? <section className="quick-progress" aria-live="polite"><span className={`progress-orb ${active(job) ? 'running' : ''}`}>{active(job) ? <Sparkles/> : job.stage === 'completed' ? <Check/> : <AlertTriangle/>}</span><span className="native-eyebrow">{active(job) ? 'GENERATING ON YOUR SERVER' : 'APPLICATION WORKSPACE'}</span><h1>{job.stage === 'completed' ? 'Your resume is ready' : job.stage === 'failed' ? 'Generation needs attention' : job.stage === 'cancelled' ? 'Generation cancelled' : 'Building your next opportunity'}</h1><p>{job.title}</p>{active(job) ? <><div className="progress-track"><i/></div><div className="progress-info"><span>{job.characters ? `${job.characters.toLocaleString()} characters received` : 'Connecting to the model…'}</span><time>{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</time></div><div className="native-actions"><button onClick={() => void window.anchor.window('hide')}>Hide & keep generating</button><button onClick={() => void window.anchor.cancel()}>Cancel</button></div></> : <><p>{job.message}</p>{['failed', 'cancelled'].includes(job.stage) && <div className="native-actions"><button className="native-primary" disabled={busy} onClick={() => void run(async () => { await begin(await api.getApplication(job.applicationId)); })}>Retry generation</button><button className="native-secondary" disabled={busy} onClick={() => void run(async () => { setManual(await api.getApplication(job.applicationId)); void window.anchor.window('expand'); })}>Import JSON</button></div>}{job.generationId && job.stage === 'completed' && <QuickResult key={job.generationId} job={job} onBusyChange={setResultBusy}/>}<button className="native-text" disabled={resultBusy} onClick={fresh}><Plus size={15}/> New application <kbd>Ctrl N</kbd></button></>}</section> : <>
      <header className="quick-heading"><span className="native-eyebrow">ONE SHORTCUT. YOUR NEXT OPPORTUNITY.</span><h1>New application</h1><p>Capture the role. Put your experience to work.</p></header>
      <form ref={formRef} className="quick-form" onSubmit={e => { e.preventDefault(); void submit(); }} onKeyDown={e => { if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); void submit(); } }}>
        {loading && <p role="status" className="native-hint"><LoaderCircle className="native-spin" size={14}/> Loading your profiles and templates…</p>}
        <button type="button" className="quick-paste" onClick={() => void window.anchor.paste().then(text => setForm(f => ({ ...f, jobDescription: text }))).catch(e => setError(e.message))}><ClipboardPaste size={15}/> Paste job description</button>
        <fieldset disabled={busy || loading}>
          <div className="quick-selections">
            <label htmlFor="quick-profile">Profile<select id="quick-profile" value={form.profileId} onChange={event => setForm(f => ({ ...f, profileId: event.target.value }))}><option value="">Select profile…</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.firstName} {profile.lastName}{profile.profileTitle ? ` — ${profile.profileTitle}` : ''}{profile.isDefault ? ' (Default)' : ''}</option>)}</select></label>
            <label htmlFor="quick-template">Template<select id="quick-template" value={form.templateId} onChange={event => setForm(f => ({ ...f, templateId: event.target.value }))}><option value="">Select template…</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name}{template.isDefault ? ' (Default)' : ''}</option>)}</select></label>
          </div>
          {!loading && profiles.length === 0 && <p className="native-hint">No profiles are available for this account. <button type="button" onClick={() => void window.anchor.openRoute('/profiles')}>Manage profiles</button></p>}
          <ApplicationFormFields form={form} setForm={setForm} profiles={profiles} templates={templates} showProfileSelect={false} locations={options.locations} sources={options.sources} onOptionsChange={loadOptions} validation={draftValidation}/>
        </fieldset>
        <div className="quick-generation-mode"><button type="button" className={mode === 'automatic' ? 'selected' : ''} onClick={() => setMode('automatic')}><Sparkles size={15}/> Automatic</button><button type="button" className={mode === 'manual' ? 'selected' : ''} onClick={() => setMode('manual')}>Manual JSON</button></div>
        <footer className="quick-footer"><button type="button" className="native-secondary" disabled={busy || loading || !draftValidation.canSave || user?.canCreateApplications === false} onClick={() => void submit(true)}>Save only</button><button className="native-primary" disabled={busy || loading || !draftValidation.canSave || user?.canCreateApplications === false || user?.canGenerateResumes === false}>{busy ? <LoaderCircle size={16} className="native-spin"/> : <Sparkles size={16}/>} {mode === 'manual' ? 'Prepare prompt' : 'Create & generate'}<kbd>Ctrl ↵</kbd></button></footer>
      </form>
    </>}
    {review && <div className="quick-overlay"><section role="dialog" aria-modal="true" aria-label="Review warnings" className="quick-dialog"><AlertTriangle className="warning-symbol"/><h2>Review before generating</h2>{review.warnings.map((warning, index) => <p key={index}>{warning}</p>)}{review.blocked && <p role="alert">Resolve blocked warnings or obtain admin approval in the application details before generating.</p>}<div className="native-actions"><button className="native-secondary" onClick={() => setReview(null)}>Cancel</button>{review.blocked ? <button className="native-primary" onClick={() => void window.anchor.openRoute(`/applications/${review.app.id}`)}>Open application</button> : <button className="native-primary" disabled={busy} onClick={() => void run(async () => { const application = review.app; setReview(null); await begin(application); })}>Continue</button>}</div></section></div>}
    {manual && <ManualGenerationDialog applicationId={manual.id} jobTitle={manual.jobTitle} company={manual.company} templateId={form.templateId} onClose={() => setManual(null)} onComplete={(generationId: string) => { const application = manual; finishedDraft.current = true; clearDraft(); setManual(null); void window.anchor.window('expand'); setJob({ id: generationId, generationId, applicationId: application.id, title: `${application.jobTitle} · ${application.company}`, stage: 'completed', startedAt: Date.now(), finishedAt: Date.now(), characters: 0 }); }}/ >}
  </div>;
}
