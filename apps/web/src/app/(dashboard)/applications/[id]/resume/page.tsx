'use client';
import { useTimeZone } from '@/components/time-zone-settings';


import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { GenerationPreviewDialog } from '@/components/generation-preview-dialog';
import { ArrowLeft, Download, Copy, Sparkles, RefreshCw } from 'lucide-react';
import { DefaultPromptWarning } from '@/components/default-prompt-warning';
import { TemplatePreviewFrame } from '@/components/template-preview-frame';
import { formatDate } from '@/lib/utils';

export default function ResumePreviewPage() {
  useTimeZone();
  const { id } = useParams<{ id: string }>();
  const [app, setApp] = useState<Record<string, unknown> | null>(null);
  const [selectedGen, setSelectedGen] = useState<Record<string, unknown> | null>(null);
  const [generating, setGenerating] = useState(false);
  const [templates, setTemplates] = useState<{ id: string; name: string; isPublished: boolean }[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [promptWarning, setPromptWarning] = useState<{ profileName: string; promptName: string } | null>(
    null,
  );
  const [previewHtml, setPreviewHtml] = useState('');
  const [coverPreviewHtml, setCoverPreviewHtml] = useState('');
  const [previewPage, setPreviewPage] = useState('LETTER');
  const [showDownloadPreview, setShowDownloadPreview] = useState(false);

  const load = () => {
    return api.getApplication(id).then((data) => {
      setApp(data);
      const gens = (data.generations as Record<string, unknown>[]) || [];
      if (gens.length > 0) setSelectedGen(previous => gens.find(gen => gen.id === previous?.id) || gens[0]);
    });
  };

  useEffect(() => {
    const genId = selectedGen?.id as string | undefined;
    if (!genId || selectedGen?.status !== 'COMPLETED') {
      setPreviewHtml('');
      setCoverPreviewHtml('');
      return;
    }
    let cancelled = false;
    api
      .getGenerationPreview(genId)
      .then((data) => {
        if (cancelled) return;
        setPreviewHtml(data.html);
        setCoverPreviewHtml(data.coverLetterHtml || '');
        setPreviewPage(data.pageSize || 'LETTER');
      })
      .catch(() => {
        if (!cancelled) { setPreviewHtml(''); setCoverPreviewHtml(''); }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedGen?.id, selectedGen?.status]);

  useEffect(() => {
    load();
    api
      .getTemplates()
      .then((data) => {
        const list = (data as { id: string; name: string; isPublished: boolean }[]).filter((t) => t.isPublished);
        setTemplates(list);
        if (list[0]) setTemplateId(list[0].id);
      })
      .catch(() => undefined);
  }, [id]);

  const pollGeneration = async (
    generationId: string,
    maxAttempts = 240,
  ): Promise<{ status: string; errorMessage?: string | null }> => {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const gen = await api.getGeneration(generationId);
        const status = gen.status as string;
        if (status === 'COMPLETED' || status === 'FAILED') {
          return {
            status,
            errorMessage: (gen.errorMessage as string | null | undefined) || null,
          };
        }
      } catch {
        /* keep polling */
      }
    }
    return { status: 'FAILED', errorMessage: 'Generation timed out — check status on this page' };
  };

  const runRegenerate = async () => {
    setPromptWarning(null);
    setGenerating(true);
    try {
      const started = (await api.startGeneration(id, templateId || undefined)) as {
        id: string;
        status: string;
      };
      toast.message('Generation started…');
      const terminal = await pollGeneration(started.id);
      await load();
      if (terminal.status === 'COMPLETED') {
        toast.success('Resume regenerated');
        setSelectedGen(await api.getGeneration(started.id));
        setShowDownloadPreview(true);
      } else if (terminal.status === 'FAILED') {
        toast.error(terminal.errorMessage || 'Generation failed');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = async () => {
    try {
      const preview = await api.previewGenerationPrompt(id);
      if (preview.usedDefault) {
        setPromptWarning({ profileName: preview.profileName, promptName: preview.promptName });
        return;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to check the profile prompt');
      return;
    }
    await runRegenerate();
  };

  const handleDownload = async (fileId: string, filename: string) => {
    try {
      await api.downloadDocument(fileId, filename);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Download failed');
    }
  };

  if (!app) return <div className="p-4 sm:p-6 lg:p-8">Loading...</div>;

  const generations = (app.generations as Record<string, unknown>[]) || [];
  const rawOutput = (selectedGen?.requiresRegeneration ? undefined : selectedGen?.structuredOutputJson) as Record<string, unknown> | undefined;
  const content = (rawOutput?.resume as Record<string, unknown> | undefined) || rawOutput;
  const coverLetter = rawOutput?.coverLetter as Record<string, unknown> | undefined;
  const files = (selectedGen?.files as Record<string, unknown>[]) || [];

  return (
    <div className="p-4 sm:p-6 lg:p-8 min-h-0 flex flex-col h-[calc(100dvh-3.5rem)] md:h-screen">
      {showDownloadPreview && <GenerationPreviewDialog applicationId={id} initialGenerationId={selectedGen?.id as string} onClose={() => setShowDownloadPreview(false)} onSaved={generationId => { void load(); api.getGeneration(generationId).then(setSelectedGen).catch(() => undefined); }} />}
      <Link href={`/applications/${id}`} className="flex items-center gap-2 text-sm text-slate-500 hover:text-primary mb-4 shrink-0">
        <ArrowLeft className="w-4 h-4" /> Back to Application
      </Link>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4 shrink-0">
        <h1 className="text-lg sm:text-xl font-semibold text-slate-800 break-words">
          Resume Preview — {app.jobTitle as string}
        </h1>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm max-w-full"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button onClick={handleRegenerate} disabled={generating || templates.length === 0 || !!promptWarning} className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${generating ? 'animate-spin' : ''}`} /> Regenerate
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row flex-1 gap-4 lg:gap-6 min-h-0">
        <div className="w-full lg:w-56 shrink-0 bg-white border border-[var(--border)] rounded-xl p-4 overflow-y-auto max-h-48 lg:max-h-none">
          <h3 className="text-sm font-medium text-slate-700 mb-3">Resume Versions</h3>
          {generations.length === 0 ? (
            <p className="text-sm text-slate-500">No versions yet</p>
          ) : generations.map((gen) => (
            <button
              key={gen.id as string}
              onClick={() => setSelectedGen(gen)}
              className={`w-full text-left p-3 rounded-lg mb-2 text-sm ${selectedGen?.id === gen.id ? 'bg-primary/10 text-primary border border-primary/20' : 'hover:bg-slate-50'}`}
            >
              <p className="font-medium">Version {gen.version as number}</p>
              <p className="text-xs text-slate-500">{gen.status as string}</p><p className="text-xs text-slate-500">{gen.experienceTitleMode === 'tailored' ? 'Tailored positions' : 'Saved positions'}</p>
              {gen.status === 'FAILED' && gen.errorMessage ? (
                <p className="text-xs text-red-600 mt-1 line-clamp-3">{gen.errorMessage as string}</p>
              ) : null}
              {gen.completedAt ? <p className="text-xs text-slate-400">{formatDate(gen.completedAt as string)}</p> : null}
            </button>
          ))}
        </div>

        <div className="flex-1 bg-white border border-[var(--border)] rounded-xl p-4 sm:p-6 lg:p-8 overflow-y-auto min-h-0">
          {!content ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500">
              <Sparkles className="w-12 h-12 mb-4 text-slate-300" />
              <p>{selectedGen?.requiresRegeneration ? 'This old resume contains conflicting profile information. Generate a new version using the saved profile.' : 'No resume content yet. Generate a resume to see the preview.'}</p>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto">
              {previewHtml ? (
                <TemplatePreviewFrame html={previewHtml} pageSize={previewPage} />
              ) : (
                <p className="text-sm text-slate-500 mb-4">Loading the template preview…</p>
              )}
              {coverPreviewHtml && (
                <div className="mt-10 pt-6 border-t border-[var(--border)]">
                  <h2 className="text-sm font-bold text-slate-800 mb-3">Cover Letter</h2>
                  <TemplatePreviewFrame html={coverPreviewHtml} pageSize={previewPage} />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="w-48 shrink-0 space-y-2">
          <h3 className="text-sm font-medium text-slate-700 mb-3">File Actions</h3>
          {selectedGen?.status === 'COMPLETED' && <button className="w-full rounded-lg bg-primary text-white px-3 py-2 text-sm" onClick={() => setShowDownloadPreview(true)}>Preview, download both and share</button>}
          {selectedGen?.status === 'COMPLETED' &&
            (
              [
                ['RESUME', 'PDF', 'Resume PDF'],
                ['RESUME', 'DOCX', 'Resume DOCX'],
                ['COVER_LETTER', 'PDF', 'Cover PDF'],
                ['COVER_LETTER', 'DOCX', 'Cover DOCX'],
              ] as const
            ).map(([kind, type, label]) => (
              <button
                key={`${selectedGen.id}-${kind}-${type}`}
                onClick={async () => {
                  try {
                    const file = await api.exportGenerationFile(selectedGen.id as string, { kind, type });
                    handleDownload(file.id, file.filename);
                    load();
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : 'Download failed');
                  }
                }}
                className="w-full flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50"
              >
                <Download className="w-4 h-4" />
                {label}
              </button>
            ))}
          {content && (
            <button
              onClick={() => navigator.clipboard.writeText(JSON.stringify(content, null, 2))}
              className="w-full flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50"
            >
              <Copy className="w-4 h-4" /> Copy JSON
            </button>
          )}
        </div>
      </div>

      {promptWarning && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => !generating && setPromptWarning(null)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal
            className="bg-white rounded-xl w-full max-w-md p-6 shadow-xl border border-[var(--border)] space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <DefaultPromptWarning
              profileName={promptWarning.profileName}
              promptName={promptWarning.promptName}
              onCancel={() => setPromptWarning(null)}
              onContinue={runRegenerate}
              continueLabel="Regenerate anyway"
            />
          </div>
        </div>
      )}
    </div>
  );
}
