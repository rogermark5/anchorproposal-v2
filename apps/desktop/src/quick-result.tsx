import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, Download, LoaderCircle } from 'lucide-react';
import { api, type GenerationDocumentPreview } from '../../web/src/lib/api';
import { GetAnswersPanel } from '../../web/src/components/get-answers';
import { TemplatePreviewFrame } from '../../web/src/components/template-preview-frame';
import { GenerationPreviewDialog } from '../../web/src/components/generation-preview-dialog';

const tabs = ['Resume', 'Cover letter', 'Answers'] as const;
type Tab = typeof tabs[number];
type Letter = { greeting?: string; paragraphs?: string[]; closing?: string; signatureName?: string };

export default function QuickResult({ job, onBusyChange }: { job: Job; onBusyChange?: (busy: boolean) => void }) {
  const [generationId, setGenerationId] = useState(job.generationId!);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('Resume');
  const [preview, setPreview] = useState<GenerationDocumentPreview | null>(null);
  const [letter, setLetter] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [answersOpened, setAnswersOpened] = useState(false);
  const exportLock = useRef(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => { onBusyChange?.(saving || dialogOpen); return () => onBusyChange?.(false); }, [saving, dialogOpen, onBusyChange]);

  useEffect(() => {
    let live = true;
    setLoading(true); setLoadError(''); setPreview(null); setLetter('');
    void Promise.allSettled([api.getGenerationPreview(generationId), api.getGeneration(generationId)]).then(([html, generation]) => {
      if (!live) return;
      if (html.status === 'fulfilled') setPreview(html.value);
      if (generation.status === 'fulfilled') {
        const content = generation.value.structuredOutputJson as { coverLetter?: Letter } | undefined;
        const cover = content?.coverLetter;
        setLetter(cover ? [cover.greeting, ...(cover.paragraphs || []), cover.closing, cover.signatureName].filter(Boolean).join('\n\n') : '');
      }
      const failed = [html, generation].find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') setLoadError(failed.reason instanceof Error ? failed.reason.message : 'Could not load the documents.');
      setLoading(false);
    });
    tabRefs.current[0]?.focus({ preventScroll: true });
    return () => { live = false; };
  }, [generationId, revision]);

  const selectTab = useCallback((next: Tab) => {
    setTab(next);
    if (next === 'Answers') setAnswersOpened(true);
    tabRefs.current[tabs.indexOf(next)]?.focus({ preventScroll: true });
  }, []);

  const save = useCallback(async (type: 'PDF' | 'DOCX') => {
    if (exportLock.current || loading || tab === 'Answers' || tab === 'Cover letter' && !letter) return;
    exportLock.current = true; setSaving(true);
    setStatus(`Preparing ${tab.toLowerCase()} ${type}… Choose a location when the save dialog opens.`);
    try {
      const result = await window.anchor.export(generationId, type, tab === 'Cover letter' ? 'COVER_LETTER' : 'RESUME');
      setStatus(result.cancelled ? 'Save cancelled.' : `Saved ${result.filename}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Could not save the document. Please try again.'); }
    finally { exportLock.current = false; setSaving(false); }
  }, [generationId, letter, loading, tab]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (dialogOpen || !event.ctrlKey || event.altKey || event.shiftKey) return;
      if (['1', '2', '3'].includes(event.key)) { event.preventDefault(); selectTab(tabs[Number(event.key) - 1]); }
      if (event.key.toLowerCase() === 's' && tab !== 'Answers') { event.preventDefault(); void save('PDF'); }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [dialogOpen, save, selectTab, tab]);

  return <section className="quick-result" aria-label="Application documents and answers">
    <div className="quick-result-tabs" role="tablist" aria-label="Application documents">
      {tabs.map((name, index) => <button key={name} ref={element => { tabRefs.current[index] = element; }}
        id={`result-tab-${index}`} role="tab" aria-selected={tab === name} aria-controls={`result-panel-${index}`}
        tabIndex={tab === name ? 0 : -1} onClick={() => selectTab(name)}
        onKeyDown={event => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            selectTab(tabs[event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (index + (event.key === 'ArrowRight' ? 1 : 2)) % 3]);
          }
        }}>{name}<kbd>Ctrl {index + 1}</kbd></button>)}
    </div>
    <div className="quick-result-status" role="status">{saving && <LoaderCircle size={15} className="native-spin"/>}{status}</div>
    {tab !== 'Answers' && <div className="quick-result-toolbar">
      <button disabled={saving || loading || tab === 'Cover letter' && !letter} className="native-primary" onClick={() => void save('PDF')}><Download size={15}/>{saving ? 'Saving…' : 'Save PDF'}<kbd>Ctrl S</kbd></button>
      <button disabled={saving || loading || tab === 'Cover letter' && !letter} className="native-secondary" onClick={() => void save('DOCX')}>Word</button>
      <button disabled={saving || loading || !preview} className="native-secondary" onClick={() => setDialogOpen(true)}>Preview and edit documents</button>
      {tab === 'Cover letter' && letter && <button className="native-secondary" onClick={() => void window.anchor.copy(letter).then(() => setStatus('Cover letter copied.')).catch(error => setStatus(error.message))}><Copy size={14}/>Copy</button>}
    </div>}
    {tab !== 'Answers' && loading && <p className="native-hint" role="status"><LoaderCircle className="native-spin" size={15}/>Loading documents…</p>}
    {tab !== 'Answers' && loadError && <div role="alert" className="native-error">{loadError}<button onClick={() => setRevision(value => value + 1)}>Retry</button></div>}
    <div id="result-panel-0" role="tabpanel" aria-labelledby="result-tab-0" hidden={tab !== 'Resume'}>
      {preview && <TemplatePreviewFrame html={preview.html} pageSize={preview.pageSize}/>}
    </div>
    <div id="result-panel-1" role="tabpanel" aria-labelledby="result-tab-1" hidden={tab !== 'Cover letter'}>
      {preview?.coverLetterHtml ? <TemplatePreviewFrame html={preview.coverLetterHtml} pageSize={preview.pageSize}/> : letter ? <div className="quick-letter">{letter}</div> : !loading && <p className="native-hint">No cover letter was included in this response. Generate a new version with a cover letter to save it here.</p>}
    </div>
    <div id="result-panel-2" role="tabpanel" aria-labelledby="result-tab-2" hidden={tab !== 'Answers'}>
      {answersOpened && <GetAnswersPanel generationId={generationId} jobTitle={job.title} className="quick-answers"/>}
    </div>
    {dialogOpen && <GenerationPreviewDialog applicationId={job.applicationId} initialGenerationId={generationId} onClose={() => setDialogOpen(false)} onSaved={id => { setGenerationId(id); setStatus('Saved document version. Downloads use your saved changes.'); }}/>}
  </section>;
}
