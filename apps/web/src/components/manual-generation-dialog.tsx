'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, type ManualGenerationPrompt } from '@/lib/api';
import { LoadingSpinner } from '@/components/loading-spinner';

export function ManualGenerationDialog({
  applicationId, jobTitle, company, templateId, onClose, onComplete,
}: {
  applicationId: string;
  jobTitle: string;
  company: string;
  templateId?: string;
  onClose: () => void;
  onComplete: (generationId: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const requestVersion = useRef(0);
  const saveLock = useRef(false);
  const requestKey = useRef('');
  const [prompt, setPrompt] = useState<ManualGenerationPrompt | null>(null);
  const [responseJson, setResponseJson] = useState('');
  const [coverLetterResponseJson, setCoverLetterResponseJson] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadPrompt = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setError('');
    setPrompt(null);
    try {
      const prepared = await api.getManualGenerationPrompt(applicationId, templateId);
      if (version !== requestVersion.current) return;
      requestKey.current = crypto.randomUUID();
      setPrompt(prepared);
    } catch (err) {
      if (version === requestVersion.current) {
        setError(err instanceof Error ? err.message : 'Failed to load the prompt');
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [applicationId, templateId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    void loadPrompt();
    return () => {
      requestVersion.current++;
      dialog?.close();
      previouslyFocused?.focus();
    };
  }, [loadPrompt]);

  const copyPrompt = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt.prompt);
      toast.success('Full prompt copied');
    } catch {
      promptRef.current?.focus();
      promptRef.current?.select();
      toast.info('Prompt selected. Press Ctrl+C or Cmd+C to copy.');
    }
  };

  const save = async () => {
    if (!prompt || !responseJson.trim() || saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setError('');
    try {
      const generation = await api.importManualGeneration(applicationId, {
        responseJson,
        coverLetterResponseJson: prompt.coverLetterPrompt ? coverLetterResponseJson : undefined,
        contextHash: prompt.contextHash,
        templateId: prompt.templateId,
        idempotencyKey: requestKey.current,
      });
      onComplete(generation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the resume');
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="manual-generation-title"
      aria-describedby="manual-generation-description"
      onCancel={(event) => { event.preventDefault(); if (!saveLock.current) onClose(); }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-4xl max-h-[90dvh] overflow-hidden rounded-xl border border-[var(--border)] bg-white p-0 text-slate-800 shadow-xl backdrop:bg-black/50"
    >
      <div className="flex max-h-[90dvh] flex-col">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 id="manual-generation-title" className="text-lg font-semibold">Generate resume manually</h2>
            <p className="mt-1 text-sm text-slate-500">{jobTitle} at {company}</p>
          </div>
          <button type="button" aria-label="Close manual generation" disabled={saving} onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 disabled:opacity-40">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-4">
          <p id="manual-generation-description" className="text-sm text-slate-600">
            Copy the complete prompt into your preferred model. Paste its JSON response below to save the resume and use the usual preview and download options.
          </p>
          <p className="text-xs text-slate-500">For a cover letter, include coverLetter in the same JSON with greeting, paragraphs (an array of paragraph strings), closing, and signatureName. Without it, only the resume is saved. Do not append a separate plain-text letter.</p>
          {prompt?.experienceTitleMode === 'tailored' && <p className="text-xs text-slate-500">Return summary, skills, experiences, educations, and certificates. Include one experience per saved experience, in the same order, with role and bullets. Copy education and certificates from the expanded prompt as flat arrays, using [] when empty. Saved profile facts are preserved.</p>}
          {loading ? (
            <div role="status" className="flex items-center gap-2 py-8 text-sm text-slate-500">
              <LoadingSpinner /> Preparing the full prompt…
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="manual-full-prompt" className="text-sm font-medium">1. Full generation prompt</label>
                <div className="flex gap-2">
                  <button type="button" disabled={saving} onClick={() => void loadPrompt()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-40">
                    <RefreshCw className="h-3.5 w-3.5" /> Reload prompt
                  </button>
                  <button type="button" disabled={!prompt || saving} onClick={() => void copyPrompt()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs hover:bg-slate-50 disabled:opacity-40">
                    <Copy className="h-3.5 w-3.5" /> Copy full prompt
                  </button>
                </div>
              </div>
              {prompt && (
                <>
                  <p className="text-xs text-slate-500">
                    Prompt: {prompt.promptName}
                  </p>
                  <textarea id="manual-full-prompt" ref={promptRef} readOnly value={prompt.prompt} rows={10}
                    className="w-full resize-y rounded-lg border border-slate-300 bg-slate-50 p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </>
              )}
            </>
          )}
          <div className="space-y-2">
            <label htmlFor="manual-json-response" className="block text-sm font-medium">2. JSON response</label>
            <textarea id="manual-json-response" value={responseJson} disabled={saving} maxLength={80000}
              onChange={(event) => setResponseJson(event.target.value)} rows={9} spellCheck={false}
              placeholder={'Paste the complete JSON response from your model here…'}
              className="w-full resize-y rounded-lg border border-slate-300 p-3 font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-slate-50" />
          </div>
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {prompt?.coverLetterPrompt && <section className="space-y-2">
            <h3 className="text-sm font-medium">3. Generate the cover letter in a second request</h3>
            <p className="text-xs text-slate-500">Copy this prompt after pasting the resume response above, then paste the model’s cover-letter JSON below.</p>
            <textarea readOnly value={`ACCEPTED RESUME RESPONSE\n${responseJson}\n\n${prompt.coverLetterPrompt}`} rows={8} className="w-full rounded-lg border p-3 text-xs font-mono" />
            <button disabled={!responseJson.trim() || saving} className="rounded-lg border px-3 py-2 text-sm" onClick={async () => { try { await navigator.clipboard.writeText(`ACCEPTED RESUME RESPONSE\n${responseJson}\n\n${prompt.coverLetterPrompt}`); toast.success('Cover letter prompt copied'); } catch { toast.error('Select the prompt text and copy it.'); } }}>Copy cover letter prompt</button>
            <textarea aria-label="Cover letter JSON response" value={coverLetterResponseJson} disabled={saving} maxLength={80000} onChange={event => setCoverLetterResponseJson(event.target.value)} rows={8} placeholder="Paste cover letter JSON response…" className="w-full rounded-lg border p-3 text-xs font-mono" />
          </section>}
        </div>
        <div className="flex shrink-0 justify-end gap-3 border-t border-slate-100 px-5 py-4">
          <button type="button" disabled={saving} onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-40">Cancel</button>
          <button type="button" disabled={loading || saving || !prompt || !responseJson.trim() || Boolean(prompt.coverLetterPrompt && !coverLetterResponseJson.trim())} onClick={() => void save()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-light disabled:opacity-40">
            {saving && <LoadingSpinner size="sm" />}{saving ? 'Validating and saving…' : 'Save resume'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
