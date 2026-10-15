'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { desktopBridge } from '@/lib/desktop-bridge';
import { Check, FileText, LockKeyhole, Plus, Pencil, Users, UserRound, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, type DocumentKind, type ExperienceTitleMode, type GenerationWorkflow, type PrivatePrompt } from '@/lib/api';

type Way = GenerationWorkflow['mode'];
const ways = [
  { id: 'user' as const, number: '1', title: 'One prompt for all profiles', detail: 'One request creates both documents.', icon: Users },
  { id: 'profile' as const, number: '2', title: 'One prompt per profile', detail: 'Each profile has its own combined prompt.', icon: UserRound },
  { id: 'separate' as const, number: '3', title: 'Separate resume and cover letter', detail: 'Two requests, with two prompts per profile.', icon: FileText },
];
const instructionsOnly = (content: string) => content.replace(/\n?--- REQUIRED APPLICATION JSON OUTPUT ---[\s\S]*?--- END REQUIRED APPLICATION JSON OUTPUT ---/g, '').trim();
const kindNames: Record<DocumentKind, string> = { combined: 'resume + cover letter', resume: 'resume', 'cover-letter': 'cover letter' };
const starters: Record<DocumentKind, string> = {
  combined: 'Use the selected saved profile and the job description to write a targeted resume and a professional cover letter. Keep all claims grounded in the profile. Use clear, concise wording and relevant experience.',
  resume: 'Use the selected saved profile and the job description to write a targeted professional summary and experience bullet points. Keep all claims grounded in the profile. Use clear, concise wording.',
  'cover-letter': 'Write a professional cover letter for the selected role and company. Use only the saved profile and accepted resume as evidence. Write an opening, relevant examples, and a brief closing paragraph. Keep the tone confident and natural.',
};

function JsonRule({ text }: { text: string }) {
  return <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
    <p>The required JSON format is added automatically to the end of this prompt.</p>
    <details className="mt-2"><summary className="cursor-pointer font-medium text-primary">View the required JSON rule</summary><pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed">{text}</pre></details>
  </div>;
}

type Editor = { prompt?: PrivatePrompt; kind: DocumentKind; target: 'resume' | 'cover'; name: string };
function PromptEditor({ editor, rules, onClose, onSave }: { editor: Editor; rules: string; onClose: () => void; onSave: (name: string, content: string, titleMode: ExperienceTitleMode) => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(editor.prompt?.name || editor.name);
  const [content, setContent] = useState(editor.prompt ? instructionsOnly(editor.prompt.content) : starters[editor.kind]);
  const [titleMode, setTitleMode] = useState<ExperienceTitleMode>(editor.prompt?.experienceTitleMode || 'saved');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const focused = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => { dialog.current?.close(); focused?.focus(); }; }, []);
  return <dialog ref={dialog} aria-labelledby="private-prompt-editor-title" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }} className="m-auto w-[calc(100%_-_2rem)] max-w-3xl max-h-[92dvh] rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-900/50">
    <div className="flex max-h-[92dvh] flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 p-5"><div><h2 id="private-prompt-editor-title" className="text-lg font-semibold">{editor.prompt ? 'Edit' : 'Create'} my {kindNames[editor.kind]} prompt</h2><p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><LockKeyhole className="h-3.5 w-3.5" />Private to your account</p></div><button aria-label="Close prompt editor" disabled={busy} onClick={onClose} className="p-1"><X className="h-5 w-5" /></button></header>
      <div className="space-y-4 overflow-auto p-5">
        <label className="block text-sm font-medium">Prompt name<input aria-label="Prompt name" value={name} onChange={event => setName(event.target.value)} maxLength={200} disabled={busy} className="mt-2 block w-full rounded-lg border border-slate-300 p-3 font-normal" placeholder="A name you can recognize later" /></label>
        <label className="block text-sm font-medium">Your writing instructions<textarea aria-label="Your writing instructions" value={content} onChange={event => setContent(event.target.value)} rows={11} maxLength={80000} disabled={busy} className="mt-2 block w-full rounded-lg border border-slate-300 p-3 font-normal leading-relaxed" /></label>
        {editor.kind !== 'cover-letter' && <details className="text-sm"><summary className="cursor-pointer text-slate-500">Advanced: experience positions</summary><select aria-label="Experience positions" className="mt-2 w-full rounded-lg border p-2" value={titleMode} disabled={busy} onChange={event => setTitleMode(event.target.value as ExperienceTitleMode)}><option value="saved">Keep saved job titles</option><option value="tailored">Tailor job titles to the job description</option></select></details>}
        <JsonRule text={rules} />{error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>
      <footer className="flex justify-end gap-3 border-t border-slate-100 p-5"><button disabled={busy} onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Cancel</button><button disabled={busy || !name.trim() || !content.trim()} onClick={async () => { setBusy(true); setError(''); try { await onSave(name.trim(), content.trim(), titleMode); } catch (error) { setError(error instanceof Error ? error.message : 'Could not save'); } finally { setBusy(false); } }} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Saving…' : editor.prompt ? 'Save my prompt' : 'Create and select prompt'}</button></footer>
    </div>
  </dialog>;
}

export function PrivateGenerationSettings() {
  const [workflow, setWorkflow] = useState<GenerationWorkflow | null>(null);
  const [way, setWay] = useState<Way>('user');
  const [defaultText, setDefaultText] = useState('');
  const [profileId, setProfileId] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { resumePromptId: string; coverLetterPromptId: string }>>({});
  const [editor, setEditor] = useState<Editor | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [answerText, setAnswerText] = useState('');
  const [savingAnswer, setSavingAnswer] = useState(false);
  const [showJobTitle, setShowJobTitle] = useState(true);
  const [savingDisplay, setSavingDisplay] = useState(false);
  const loaded = useRef(false);

  const applyWorkflow = (data: GenerationWorkflow) => {
    setWorkflow(data); setDefaultText(instructionsOnly(data.defaultPrompt.content));
    setShowJobTitle(data.documentDisplay?.showJobTitle !== false);
    setDrafts(Object.fromEntries(data.profiles.map(profile => [profile.id, { resumePromptId: profile.resumePromptId || '', coverLetterPromptId: profile.coverLetterPromptId || '' }])));
    if (!loaded.current) {
      const params = new URLSearchParams(desktopBridge() ? window.location.hash.split('?')[1] || '' : window.location.search); const requested = params.get('way');
      setWay(requested === 'user' || requested === 'profile' || requested === 'separate' ? requested : data.mode);
      const requestedProfile = params.get('profile');
      setProfileId(data.profiles.some(profile => profile.id === requestedProfile) ? requestedProfile! : data.profiles[0]?.id || '');
      loaded.current = true;
    }
  };
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.getGenerationWorkflow(), api.getAnswerPrompt()]).then(([data, answer]) => { if (!cancelled) { applyWorkflow(data); setAnswerText(answer.prompt); } }).catch(error => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, []);
  const profile = workflow?.profiles.find(profile => profile.id === profileId);
  const selected = drafts[profileId] || { resumePromptId: '', coverLetterPromptId: '' };
  const prompts = workflow?.prompts || [];
  const ruleKind: DocumentKind = way === 'separate' ? 'resume' : 'combined';
  const ready = way === 'user' ? Boolean(defaultText.trim()) : Boolean(profileId && selected.resumePromptId && (way !== 'separate' || selected.coverLetterPromptId));
  const dirty = workflow && (way !== workflow.mode || (way === 'user' ? defaultText.trim() !== instructionsOnly(workflow.defaultPrompt.content).trim() : selected.resumePromptId !== (profile?.resumePromptId || '') || (way === 'separate' && selected.coverLetterPromptId !== (profile?.coverLetterPromptId || ''))));
  const changeSelection = (target: 'resume' | 'cover', value: string) => setDrafts(previous => ({ ...previous, [profileId]: { ...(previous[profileId] || selected), [target === 'resume' ? 'resumePromptId' : 'coverLetterPromptId']: value } }));
  const newPrompt = (target: 'resume' | 'cover') => { const kind = target === 'cover' ? 'cover-letter' : ruleKind; setEditor({ kind, target, name: `${profile?.name || 'My'} ${kindNames[kind]} prompt` }); };
  const saveWay = async () => {
    if (!workflow || busy || !ready) return;
    setBusy(true); setError('');
    try {
      if (way === 'user') await api.updateMyPrompt({ mode: way, content: defaultText });
      else { await api.saveProfileGenerationPreference(profileId, { resumePromptId: selected.resumePromptId || null, coverLetterPromptId: selected.coverLetterPromptId || null }); await api.updatePromptMode(way); }
      applyWorkflow(await api.getGenerationWorkflow()); toast.success('Saved. Future generations will use this way.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save'); }
    finally { setBusy(false); }
  };
  const promptField = (target: 'resume' | 'cover') => {
    const isCover = target === 'cover'; const value = isCover ? selected.coverLetterPromptId : selected.resumePromptId;
    const current = prompts.find(prompt => prompt.id === value);
    const options = prompts.filter(prompt => isCover ? prompt.documentKind === 'cover-letter' || prompt.id === value : way === 'profile' ? prompt.documentKind === 'combined' || prompt.id === value : prompt.documentKind !== 'cover-letter' || prompt.id === value);
    const label = isCover ? 'Cover letter prompt' : way === 'profile' ? 'Combined resume + cover letter prompt' : 'Resume prompt';
    return <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5"><label className="block text-sm font-semibold">{label}<select aria-label={label} value={value} disabled={busy} onChange={event => changeSelection(target, event.target.value)} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white p-3 font-normal"><option value="">Choose one of your prompts</option>{options.map(prompt => <option key={prompt.id} value={prompt.id}>{prompt.name}</option>)}</select></label>
      <div className="flex flex-wrap gap-3"><button disabled={busy} onClick={() => newPrompt(target)} className="inline-flex items-center gap-1.5 text-sm font-medium text-primary"><Plus className="h-4 w-4" />New {isCover ? 'cover letter' : way === 'profile' ? 'combined' : 'resume'} prompt</button>{current && <button disabled={busy} onClick={() => setEditor({ prompt: current, kind: current.documentKind, target, name: current.name })} className="inline-flex items-center gap-1.5 text-sm text-slate-600"><Pencil className="h-3.5 w-3.5" />Edit selected prompt</button>}</div>
      {current && <p className="text-xs text-slate-500">{instructionsOnly(current.content).slice(0, 160)}{instructionsOnly(current.content).length > 160 ? '…' : ''}</p>}
    </div>;
  };
  return <div className="max-w-5xl space-y-6">
    <div><h2 className="text-xl font-semibold text-slate-800">Choose how to generate your documents</h2><p className="mt-2 text-sm text-slate-500">Pick one way, set up its prompts, then save. Each prompt belongs only to your account.</p></div>
    <div role="tablist" aria-label="Generation ways" className="grid gap-3 lg:grid-cols-3">{ways.map(option => { const Icon = option.icon; const active = way === option.id; return <button key={option.id} role="tab" aria-selected={active} aria-controls="generation-way-panel" disabled={busy || !workflow} onClick={() => { setWay(option.id); setError(''); }} className={`relative rounded-xl border-2 p-4 text-left transition-colors ${active ? 'border-primary bg-primary/5' : 'border-slate-200 bg-white hover:border-slate-300'} disabled:opacity-60`}><div className="mb-3 flex items-center justify-between"><span className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${active ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600'}`}>{option.number}</span><Icon className="h-5 w-5 text-slate-500" /></div><span className="block text-sm font-semibold text-slate-800">{option.title}</span><span className="mt-2 block text-xs leading-relaxed text-slate-500">{option.detail}</span>{workflow?.mode === option.id && <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary"><Check className="h-3.5 w-3.5" />Currently used</span>}</button>; })}</div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {!workflow ? <p role="status" className="text-sm text-slate-500">Loading your private prompts…</p> : <section id="generation-way-panel" role="tabpanel" className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">{ways.find(option => option.id === way)?.title}</h3><p className="mt-1 text-sm text-slate-500">{way === 'user' ? 'Write one prompt. It will create both documents for whichever profile you choose.' : way === 'profile' ? 'Choose a profile and assign one combined prompt. Repeat for your other profiles.' : 'Choose a profile, then assign its resume prompt and cover letter prompt.'}</p></div><span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-3 py-1.5 text-xs text-slate-500"><LockKeyhole className="h-3.5 w-3.5" />Only you</span></div>
      {way === 'user' ? <><label className="block text-sm font-semibold">Your prompt for all profiles<textarea aria-label="Your prompt for all profiles" rows={12} disabled={busy} value={defaultText} onChange={event => setDefaultText(event.target.value)} maxLength={80000} className="mt-2 block w-full rounded-xl border border-slate-300 p-4 font-normal leading-relaxed" /></label><JsonRule text={workflow.jsonRules.combined} /></> : !workflow.profiles.length ? <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No profiles are available yet. <Link href="/profiles" className="font-medium text-primary underline">Open Profiles</Link> to get started.</p> : <>
        <label className="block text-sm font-semibold">Profile<select aria-label="Profile to configure" value={profileId} disabled={busy} onChange={event => setProfileId(event.target.value)} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white p-3 font-normal">{workflow.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}{profile.title ? ` — ${profile.title}` : ''}</option>)}</select></label>
        {way === 'separate' && <p className="rounded-lg bg-primary/5 p-3 text-sm text-primary">1. Generate the resume → 2. Use that resume to generate the cover letter.</p>}
        <div className={way === 'separate' ? 'grid gap-4 md:grid-cols-2' : ''}>{promptField('resume')}{way === 'separate' && promptField('cover')}</div>
        <details className="rounded-lg bg-slate-50 p-3 text-sm"><summary className="cursor-pointer font-medium">Check assignments for all profiles</summary><ul className="mt-3 space-y-2">{workflow.profiles.map(profile => { const ready = Boolean(profile.resumePromptId && (way !== 'separate' || profile.coverLetterPromptId)); return <li key={profile.id} className="flex items-center justify-between gap-3"><span>{profile.name}</span><span className={ready ? 'text-primary' : 'text-amber-700'}>{ready ? 'Assigned' : 'Needs a prompt'}</span></li>; })}</ul></details>
      </>}
      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5"><button disabled={busy || !ready || !dirty} onClick={() => void saveWay()} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{busy ? 'Saving…' : workflow.mode === way ? way === 'user' ? 'Save my prompt' : 'Save profile prompts' : 'Save and use this way'}</button><p className="text-xs text-slate-500">{!ready ? 'Complete the required prompt selection above.' : dirty ? 'Your changes are not saved yet.' : 'Saved. This setup is ready to use.'}</p></div>
    </section>}
    {workflow && <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-5">
      <h3 className="font-semibold text-slate-800">Resume appearance</h3>
      <label className="block text-sm font-medium">Job title below your name<select aria-label="Header job title visibility" value={showJobTitle ? 'visible' : 'hidden'} disabled={savingDisplay} onChange={event => setShowJobTitle(event.target.value === 'visible')} className="mt-2 block w-full max-w-sm rounded-lg border border-slate-300 bg-white p-3"><option value="visible">Visible</option><option value="hidden">Hidden</option></select></label>
      <p className="text-xs text-slate-500">Applies to the header in your previews, downloads and public resume links. Job titles in your work history stay visible. Skills come from the generated JSON response and can be edited in the document preview.</p>
      <button disabled={savingDisplay || showJobTitle === (workflow.documentDisplay?.showJobTitle !== false)} onClick={async () => { setSavingDisplay(true); try { const display = await api.updateDocumentDisplay({ showJobTitle }); setWorkflow(previous => previous ? { ...previous, documentDisplay: display } : previous); toast.success('Resume appearance saved'); } catch (error) { toast.error(error instanceof Error ? error.message : 'Save failed'); } finally { setSavingDisplay(false); } }} className="rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-50">{savingDisplay ? 'Saving…' : 'Save appearance'}</button>
    </section>}
    {workflow && <details className="rounded-xl border border-slate-200 bg-white p-5"><summary className="cursor-pointer text-sm font-medium text-slate-600">Optional: my application-answer instructions</summary><p className="mt-3 text-xs text-slate-500">Used when you ask application questions after generating a resume. These instructions are private to your account.</p><textarea aria-label="My application-answer instructions" value={answerText} onChange={event => setAnswerText(event.target.value)} rows={5} disabled={savingAnswer} className="mt-3 block w-full rounded-lg border p-3 text-sm" /><button disabled={savingAnswer} onClick={async () => { setSavingAnswer(true); try { await api.updateAnswerPrompt(answerText); toast.success('Your answer instructions were saved'); } catch (error) { toast.error(error instanceof Error ? error.message : 'Save failed'); } finally { setSavingAnswer(false); } }} className="mt-3 rounded-lg border px-4 py-2 text-sm">{savingAnswer ? 'Saving…' : 'Save my answer instructions'}</button></details>}
    {editor && workflow && <PromptEditor editor={editor} rules={workflow.jsonRules[editor.kind]} onClose={() => setEditor(null)} onSave={async (name, content, experienceTitleMode) => {
      const prompt = editor.prompt ? await api.updateLibraryPrompt(editor.prompt.id, { name, content, experienceTitleMode, documentKind: editor.kind }) : await api.createLibraryPrompt({ name, content, experienceTitleMode, documentKind: editor.kind });
      setWorkflow(previous => previous ? { ...previous, prompts: editor.prompt ? previous.prompts.map(existing => existing.id === prompt.id ? prompt : existing) : [...previous.prompts, prompt] } : previous);
      changeSelection(editor.target, prompt.id); setEditor(null); toast.success('Your private prompt was saved. Save the profile setup to use it.');
    }} />}
  </div>;
}
