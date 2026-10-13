'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { TemplatePreviewFrame } from './template-preview-frame';

type Generation = { id: string; version: number; status: string; requiresRegeneration?: boolean; structuredOutputJson?: { coverLetter?: { greeting: string; paragraphs: string[]; closing: string; signatureName?: string } } };

export function GenerationPreviewDialog({ applicationId, initialGenerationId, onClose }: { applicationId: string; initialGenerationId?: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [selectedId, setSelectedId] = useState(initialGenerationId || '');
  const [preview, setPreview] = useState<{ html: string; pageSize: string; coverLetterHtml?: string | null } | null>(null);
  const [type, setType] = useState<'PDF' | 'DOCX'>('PDF');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [share, setShare] = useState('');
  const busyRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const focused = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    api.getGenerations(applicationId).then(value => {
      if (cancelled) return;
      const completed = (value as Generation[]).filter(gen => gen.status === 'COMPLETED');
      setGenerations(completed);
      setSelectedId(previous => completed.some(gen => gen.id === previous) ? previous : completed[0]?.id || '');
      if (!completed.length) setError('This application has no completed resumes yet.');
    }).catch(error => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; dialog.current?.close(); focused?.focus(); };
  }, [applicationId]);
  useEffect(() => {
    let cancelled = false;
    setShare(''); setPreview(null); setError('');
    if (selectedId) api.getGenerationPreview(selectedId).then(value => { if (!cancelled) setPreview(value); }).catch(error => { if (!cancelled) setError(error.message); });
    return () => { cancelled = true; };
  }, [selectedId]);
  const selected = generations.find(gen => gen.id === selectedId);
  const cover = !selected?.requiresRegeneration ? selected?.structuredOutputJson?.coverLetter : undefined;
  const downloadBoth = async () => {
    if (busyRef.current || !selectedId) return;
    busyRef.current = true; setBusy(true);
    try {
      const kinds = cover ? ['RESUME', 'COVER_LETTER'] as const : ['RESUME'] as const;
      for (const kind of kinds) {
        const file = await api.exportGenerationFile(selectedId, { kind, type });
        await api.downloadDocument(file.id, file.filename);
      }
      toast.success(cover ? 'Resume and cover letter downloaded' : 'Resume downloaded');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Download failed'); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return <dialog ref={dialog} aria-labelledby="generation-preview-title" onCancel={event => { if (busyRef.current) event.preventDefault(); else onClose(); }} className="m-auto w-[calc(100%_-_2rem)] max-w-6xl max-h-[95dvh] rounded-xl bg-white p-0 shadow-xl backdrop:bg-black/50">
    <div className="flex flex-col max-h-[95dvh]">
      <header className="p-4 border-b border-slate-200 flex flex-wrap items-center gap-3">
        <h2 id="generation-preview-title" className="font-semibold mr-auto">Resume and cover letter preview</h2>
        <label className="text-sm">Resume version <select aria-label="Resume version" value={selectedId} disabled={busy} onChange={event => setSelectedId(event.target.value)} className="border rounded-lg p-2 ml-2">{generations.map(gen => <option key={gen.id} value={gen.id}>Version {gen.version}</option>)}</select></label>
        <button disabled={busy} aria-label="Close preview" onClick={onClose} className="p-2">✕</button>
      </header>
      <div className="overflow-y-auto bg-slate-100 p-4 flex-1 min-h-0">
        {error && <p role="alert" className="text-red-600 mb-4">{error}</p>}
        {preview ? <TemplatePreviewFrame html={preview.html} pageSize={preview.pageSize} /> : !error && <p role="status">Loading preview…</p>}
        {preview?.coverLetterHtml && <section className="mt-6"><h3 className="font-semibold mb-3">Cover letter</h3><TemplatePreviewFrame html={preview.coverLetterHtml} pageSize={preview.pageSize} /></section>}
      </div>
      <footer className="p-4 flex flex-wrap items-center gap-3 border-t border-slate-200">
        <select aria-label="Download format" value={type} onChange={event => setType(event.target.value as 'PDF' | 'DOCX')} className="border rounded-lg p-2"><option>PDF</option><option>DOCX</option></select>
        <button disabled={busy || !preview || !selectedId || selected?.requiresRegeneration} onClick={() => void downloadBoth()} className="rounded-lg bg-primary text-white px-4 py-2 disabled:opacity-50">{busy ? 'Preparing downloads…' : cover ? 'Auto download resume + cover letter' : 'Download resume'}</button>
        <button disabled={busy || !selectedId} className="rounded-lg border px-3 py-2 text-sm" onClick={async () => {
          try { const link = await api.createResumePublicLink(selectedId); const url = `${window.location.origin}${link.path}`; setShare(url); await navigator.clipboard.writeText(url); toast.success('Public resume link copied. It expires in 30 days.'); } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not create link'); }
        }}>Create public resume link</button>
        <button disabled={busy || !selectedId} className="rounded-lg border px-3 py-2 text-sm" onClick={async () => { try { await api.revokeResumePublicLink(selectedId); setShare(''); toast.success('Public link revoked'); } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not revoke link'); } }}>Revoke public link</button>
        {share && <input aria-label="Public resume URL" readOnly value={share} className="w-full text-xs border rounded p-2" />}
      </footer>
    </div>
  </dialog>;
}
