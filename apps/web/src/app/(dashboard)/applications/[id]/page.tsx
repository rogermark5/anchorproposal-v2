'use client';


import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { GenerationPreviewDialog } from '@/components/generation-preview-dialog';
import { ArrowLeft, AlertTriangle, Sparkles } from 'lucide-react';
import { DefaultPromptWarning } from '@/components/default-prompt-warning';
import { GetAnswersPanel } from '@/components/get-answers';
import { STATUS_COLORS, formatStatus, formatDate, hasRealJobUrl, APPLICATION_STATUSES } from '@/lib/utils';

type Tab = 'overview' | 'warnings' | 'files' | 'answers' | 'history' | 'notes' | 'timeline';

interface TemplateOption {
  id: string;
  name: string;
  isPublished: boolean;
  isDefault?: boolean;
}

function AnswersTab({
  generations,
  selectedId,
  onSelect,
}: {
  generations: Record<string, unknown>[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const completed = generations.filter((gen) => gen.status === 'COMPLETED');
  const activeId =
    completed.some((gen) => gen.id === selectedId) ? selectedId : ((completed[0]?.id as string) || '');

  useEffect(() => {
    if (activeId && activeId !== selectedId) onSelect(activeId);
  }, [activeId, selectedId, onSelect]);

  if (!completed.length) {
    return <p className="text-slate-500">Generate a resume first. Answers continue that conversation.</p>;
  }

  return (
    <div className="space-y-4 max-w-3xl">
      {completed.length > 1 && (
        <label className="block rounded-xl border border-[var(--border)] bg-white p-4 text-sm text-slate-700">
          <span className="font-medium">Resume version</span>
          <select
            value={activeId}
            onChange={(e) => onSelect(e.target.value)}
            className="mt-1 w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
          >
            {completed.map((gen) => (
              <option key={gen.id as string} value={gen.id as string}>
                Version {gen.version as number}
              </option>
            ))}
          </select>
        </label>
      )}
      {activeId ? <GetAnswersPanel key={activeId} generationId={activeId} /> : null}
    </div>
  );
}

export default function ApplicationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [app, setApp] = useState<Record<string, unknown> | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [note, setNote] = useState('');
  const [generating, setGenerating] = useState(false);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [promptWarning, setPromptWarning] = useState<{ profileName: string; promptName: string } | null>(
    null,
  );
  const [answerGenerationId, setAnswerGenerationId] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);

  const load = () => api.getApplication(id).then(setApp).catch(console.error);
  useEffect(() => {
    load();
    api
      .getTemplates()
      .then((data) => {
        const list = (data as TemplateOption[]).filter((t) => t.isPublished);
        setTemplates(list);
        const preferred = list.find((t) => t.isDefault) || list[0];
        if (preferred) setTemplateId(preferred.id);
      })
      .catch(() => undefined);
  }, [id]);

  const runGenerate = async () => {
    setPromptWarning(null);
    setGenerating(true);
    try {
      const started = (await api.startGeneration(id, templateId || undefined)) as {
        id: string;
        status: string;
      };
      setTab('history');
      toast.message('Generation started…');

      const terminal = await pollGeneration(started.id);
      await load();

      if (terminal.status === 'COMPLETED') {
        toast.success('Resume and cover letter ready — see Files');
        setTab('files');
        setPreviewId(started.id);
      } else if (terminal.status === 'FAILED') {
        toast.error(terminal.errorMessage || 'Generation failed');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerate = async () => {
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
    await runGenerate();
  };

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
    return { status: 'FAILED', errorMessage: 'Generation timed out — check History for status' };
  };

  const handleAddNote = async () => {
    if (!note.trim()) return;
    await api.addApplicationNote(id, note);
    setNote('');
    load();
  };

  const handleStatusChange = async (status: string) => {
    await api.updateApplicationStatus(id, status);
    load();
  };

  if (!app) return <div className="p-4 sm:p-6 lg:p-8">Loading...</div>;

  const warnings = (app.warnings as Record<string, unknown>[]) || [];
  const notes = (app.notes as Record<string, unknown>[]) || [];
  const statusHistory = (app.statusHistory as Record<string, unknown>[]) || [];
  const generations = (app.generations as Record<string, unknown>[]) || [];
  const profile = app.profile as Record<string, unknown>;

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'warnings', label: `Warnings (${warnings.length})` },
    { key: 'files', label: 'Files' },
    { key: 'answers', label: 'Answers' },
    { key: 'history', label: 'Generation History' },
    { key: 'notes', label: 'Notes' },
    { key: 'timeline', label: 'Timeline' },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {previewId && <GenerationPreviewDialog applicationId={id} initialGenerationId={previewId} onClose={() => setPreviewId(null)} onSaved={() => void load()} />}
      <Link href="/applications" className="flex items-center gap-2 text-sm text-slate-500 hover:text-primary mb-6">
        <ArrowLeft className="w-4 h-4" /> Back to Applications
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-slate-800 break-words">
            {hasRealJobUrl(app.jobUrl as string) ? (
              <a
                href={app.jobUrl as string}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-[var(--primary)] hover:underline"
              >
                {app.jobTitle as string}
              </a>
            ) : (
              (app.jobTitle as string)
            )}
          </h1>
          <p className="text-slate-500 text-sm sm:text-base">{app.company as string} — {app.location as string || 'Remote'}</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${STATUS_COLORS[app.status as string]}`}>
            {formatStatus(app.status as string)}
          </span>
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="px-3 py-2 border border-slate-300 rounded-lg text-sm max-w-full"
            title="Published template"
          >
            {templates.length === 0 ? (
              <option value="">No published templates</option>
            ) : (
              templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.isDefault ? ' (Default)' : ''}
                </option>
              ))
            )}
          </select>
          <button
            onClick={handleGenerate}
            disabled={generating || templates.length === 0}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-light disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" /> {generating ? 'Generating...' : 'Generate Resume & Cover'}
          </button>
          <Link href={`/applications/${id}/resume`} className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-50">
            View Resume
          </Link>
        </div>
      </div>

      <div className="flex gap-1 border-b border-[var(--border)] mb-6 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap shrink-0 ${tab === t.key ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white border border-[var(--border)] rounded-xl p-6 space-y-4">
            <h3 className="font-medium text-slate-800">Application Details</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500 shrink-0">Job URL</dt>
                <dd className="text-right break-all">
                  {hasRealJobUrl(app.jobUrl as string) ? (
                    <a
                      href={app.jobUrl as string}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--primary)] hover:underline"
                    >
                      {app.jobUrl as string}
                    </a>
                  ) : (
                    <span className="text-slate-400">No job link</span>
                  )}
                </dd>
              </div>
              <div className="flex justify-between"><dt className="text-slate-500">Applied On</dt><dd>{formatDate(app.createdAt as string)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Profile</dt><dd>{profile?.firstName as string} {profile?.lastName as string}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Work Arrangement</dt><dd>{app.workArrangement as string}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Source</dt><dd>{(app.source as string) || '—'}</dd></div>
            </dl>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Update Status</label>
              <select
                value={
                  APPLICATION_STATUSES.includes(app.status as (typeof APPLICATION_STATUSES)[number])
                    ? (app.status as string)
                    : app.status === 'READY_TO_APPLY'
                      ? 'SAVED'
                      : app.status === 'RECRUITER_CONTACTED'
                        ? 'APPLIED'
                        : (app.status as string)
                }
                onChange={(e) => handleStatusChange(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
              >
                {APPLICATION_STATUSES.map((s) => (
                  <option key={s} value={s}>{formatStatus(s)}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="bg-white border border-[var(--border)] rounded-xl p-6">
            <h3 className="font-medium text-slate-800 mb-3">Job Description</h3>
            <div className="text-sm text-slate-600 whitespace-pre-wrap max-h-96 overflow-y-auto">{(app.jobDescription as string)?.substring(0, 2000)}</div>
          </div>
        </div>
      )}

      {tab === 'warnings' && (
        <div className="space-y-3">
          {warnings.length === 0 ? (
            <p className="text-slate-500">No warnings detected</p>
          ) : warnings.map((w) => (
            <div key={w.id as string} className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-800">{formatStatus(w.category as string)}</p>
                <p className="text-sm text-amber-700">{w.matchedText as string}</p>
                <p className="text-xs text-amber-600 mt-1">Severity: {w.severity as string} — Behavior: {w.behavior as string}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'files' && (
        <div className="space-y-3">
          {generations.length === 0 ? (
            <p className="text-slate-500">No generated files yet. Click &quot;Generate Resume&quot; to create one.</p>
          ) : generations.map((gen) => (
            <div key={gen.id as string} className="bg-white border border-[var(--border)] rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium">Version {gen.version as number} — {gen.status as string}</span>
                <span className="text-sm text-slate-500">{gen.completedAt ? formatDate(gen.completedAt as string) : 'In progress'}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {gen.status === 'COMPLETED' && <button className="px-3 py-1.5 bg-primary text-white rounded-lg text-sm" onClick={() => setPreviewId(gen.id as string)}>Preview and download both</button>}
                {gen.status === 'COMPLETED'
                  ? (
                      [
                        ['RESUME', 'PDF', 'Resume PDF'],
                        ['RESUME', 'DOCX', 'Resume DOCX'],
                        ['COVER_LETTER', 'PDF', 'Cover PDF'],
                        ['COVER_LETTER', 'DOCX', 'Cover DOCX'],
                      ] as const
                    ).map(([kind, type, label]) => (
                      <button
                        key={`${gen.id}-${kind}-${type}`}
                        type="button"
                        className="px-3 py-1.5 bg-slate-100 rounded-lg text-sm hover:bg-slate-200"
                        onClick={async () => {
                          try {
                            const file = await api.exportGenerationFile(gen.id as string, { kind, type });
                            await api.downloadDocument(file.id, file.filename);
                            await load();
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : 'Download failed');
                          }
                        }}
                      >
                        {label}
                      </button>
                    ))
                  : ((gen.files as Record<string, unknown>[]) || [])
                      .filter((f) => f.type === 'PDF' || f.type === 'DOCX')
                      .map((f) => (
                        <span key={f.id as string} className="text-sm text-slate-500">
                          {(f.kind as string) === 'COVER_LETTER' ? 'Cover' : 'Resume'} {f.type as string}
                        </span>
                      ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'answers' && (
        <AnswersTab
          generations={generations}
          selectedId={answerGenerationId}
          onSelect={setAnswerGenerationId}
        />
      )}

      {tab === 'history' && (
        <div className="space-y-3">
          {generations.map((gen) => (
            <div key={gen.id as string} className="bg-white border border-[var(--border)] rounded-xl p-4 flex justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium">Version {gen.version as number}</p>
                <p className="text-sm text-slate-500">Status: {gen.status as string}</p>
                {gen.tokenUsage ? <p className="text-xs text-slate-400">Tokens: {gen.tokenUsage as number}</p> : null}
                {gen.status === 'FAILED' && gen.errorMessage ? (
                  <p className="text-sm text-red-600 mt-2 break-words">{gen.errorMessage as string}</p>
                ) : null}
              </div>
              <span className="text-sm text-slate-500 shrink-0">{formatDate(gen.createdAt as string)}</span>
            </div>
          ))}
        </div>
      )}

      {tab === 'notes' && (
        <div>
          <div className="flex gap-3 mb-4">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note..." className="flex-1 px-3 py-2 border border-slate-300 rounded-lg" />
            <button onClick={handleAddNote} className="px-4 py-2 bg-primary text-white rounded-lg text-sm">Add Note</button>
          </div>
          <div className="space-y-3">
            {notes.map((n) => (
              <div key={n.id as string} className="bg-white border border-[var(--border)] rounded-xl p-4">
                <p className="text-sm text-slate-700">{n.content as string}</p>
                <p className="text-xs text-slate-400 mt-2">
                  {(n.author as Record<string, string>)?.firstName} {(n.author as Record<string, string>)?.lastName} — {formatDate(n.createdAt as string)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'timeline' && (
        <div className="space-y-0">
          {statusHistory.map((h, i) => (
            <div key={h.id as string} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="w-3 h-3 rounded-full bg-primary" />
                {i < statusHistory.length - 1 && <div className="w-0.5 flex-1 bg-slate-200" />}
              </div>
              <div className="pb-6">
                <p className="font-medium text-sm">{formatStatus(h.toStatus as string)}</p>
                {h.fromStatus ? <p className="text-xs text-slate-500">From {formatStatus(h.fromStatus as string)}</p> : null}
                {h.note ? <p className="text-sm text-slate-600 mt-1">{h.note as string}</p> : null}
                <p className="text-xs text-slate-400 mt-1">
                  {(h.actor as Record<string, string>)?.firstName} — {formatDate(h.createdAt as string)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

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
              onContinue={runGenerate}
            />
          </div>
        </div>
      )}
    </div>
  );
}
