'use client';

import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { ArrowUp, Check, Copy, MessageSquare, Sparkles, X } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { LoadingSpinner } from '@/components/loading-spinner';
import { ApiRequestError, readableAnswer } from '@anchorproposal/shared';

type AnswerItem = { question: string; answer: string };

function AnswerMessage({ answer }: { answer: string }) {
  answer = readableAnswer(answer);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(answer);
      setCopied(true);
      setCopyError(false);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  };

  return (
    <div className="flex items-start gap-2.5 sm:gap-3" data-chat-role="assistant">
      <span aria-hidden="true" className="mt-5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-teal-50 text-primary">
        <Sparkles className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 max-w-[90%] flex-1 sm:max-w-[85%]">
        <p className="mb-1.5 text-xs font-medium text-slate-500">Assistant</p>
        <div className="rounded-2xl rounded-tl-sm border border-[var(--border)] bg-white px-4 py-3 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {answer}
        </div>
        <button type="button" onClick={() => void copy()} aria-label="Copy answer"
          className="mt-1.5 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-xs text-slate-500 hover:bg-white hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        {copyError && <p role="alert" className="mt-1 text-xs text-red-700">Couldn’t copy automatically. Select the answer to copy it.</p>}
      </div>
    </div>
  );
}

function QuestionMessage({ question }: { question: string }) {
  return (
    <div className="flex justify-end" data-chat-role="user">
      <div className="min-w-0 max-w-[90%] sm:max-w-[80%]">
        <p className="mb-1.5 text-right text-xs font-medium text-slate-500">You</p>
        <div className="rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm leading-relaxed text-white whitespace-pre-wrap [overflow-wrap:anywhere]">{question}</div>
      </div>
    </div>
  );
}

export function GetAnswersPanel({
  generationId, jobTitle, onBusyChange, onClose, className,
}: {
  generationId: string;
  jobTitle?: string;
  onBusyChange?: (busy: boolean) => void;
  onClose?: () => void;
  className?: string;
}) {
  const headingId = useId();
  const composerId = useId();
  const hintId = useId();
  const threadRef = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const threadSize = useRef({ width: 0, height: 0 });
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const requestVersion = useRef(0);
  const sendingRef = useRef(false);
  const submission = useRef<{ question: string; key: string } | null>(null);
  const [pendingRequest, setPendingRequest] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [primed, setPrimed] = useState(false);
  const [items, setItems] = useState<AnswerItem[]>([]);
  const [draft, setDraft] = useState('');
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [sendError, setSendError] = useState('');
  const busy = pendingQuestion !== null;

  useEffect(() => {
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadError('');
    setSendError('');
    setPrimed(false);
    setItems([]);
    setDraft('');
    setPendingQuestion(null);
    setPendingRequest(null);
    sendingRef.current = false;
    api.getGenerationAnswers(generationId)
      .then((data) => {
        if (version !== requestVersion.current) return;
        setPrimed(data.primed);
        setItems(data.items);
        if (data.pending) { setPendingQuestion(data.pending.question); setPendingRequest(data.pending.id); }
      })
      .catch((err) => {
        if (version === requestVersion.current) setLoadError(err instanceof Error ? err.message : 'Could not load the conversation.');
      })
      .finally(() => {
        if (version === requestVersion.current) setLoading(false);
      });
    return () => { requestVersion.current++; };
  }, [generationId, reload]);

  useEffect(() => {
    if (!pendingRequest) return;
    let active = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api.getAnswerRequest(generationId, pendingRequest);
        if (!active) return;
        if (result.status === 'COMPLETED' && result.view) {
          setPrimed(result.view.primed); setItems(result.view.items);
          setPendingRequest(null); setPendingQuestion(null); setSendError(''); submission.current = null;
          return;
        }
        if (result.status === 'FAILED') {
          setDraft(pendingQuestion || ''); setPendingQuestion(null); setPendingRequest(null);
          setSendError(result.errorMessage || 'Could not generate the answer.'); submission.current = null;
          return;
        }
        setSendError('');
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) {
          setDraft(pendingQuestion || ''); setPendingRequest(null); setPendingQuestion(null);
          setSendError(error.message + ' Reopen this application after checking your login.');
          return;
        }
        setSendError((error instanceof Error ? error.message : 'Connection interrupted.') + ' Reconnecting; your question is saved.');
      }
      if (active) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [generationId, pendingRequest]);

  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);

  useEffect(() => {
    const thread = threadRef.current;
    followLatest.current = true;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [items, pendingQuestion, loading]);

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread) return;
    const observer = new ResizeObserver(() => {
      if (followLatest.current) thread.scrollTop = thread.scrollHeight;
      threadSize.current = { width: thread.clientWidth, height: thread.clientHeight };
    });
    observer.observe(thread);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const composer = composerRef.current;
    if (composer) {
      composer.style.height = 'auto';
      composer.style.height = `${Math.min(composer.scrollHeight, 144)}px`;
    }
  }, [draft]);

  useEffect(() => {
    if (!loading && !loadError && !busy) composerRef.current?.focus({ preventScroll: true });
  }, [loading, loadError, busy, onClose]);

  const send = async () => {
    const question = draft.trim();
    if (!question || question.length > 4000 || loading || loadError || sendingRef.current) return;
    const version = requestVersion.current;
    sendingRef.current = true;
    setPendingQuestion(question);
    setDraft('');
    setSendError('');
    try {
      if (submission.current?.question !== question) submission.current = { question, key: crypto.randomUUID() };
      const request = await api.submitAnswer(generationId, question, submission.current.key);
      if (version !== requestVersion.current) return;
      setPendingRequest(request.id);
    } catch (err) {
      if (version !== requestVersion.current) return;
      setDraft(question);
      setPendingQuestion(null);
      setSendError(err instanceof Error ? err.message : 'Could not send your question. Please try again.');
    } finally {
      if (version === requestVersion.current) {
        sendingRef.current = false;
      }
    }
  };

  return (
    <section aria-labelledby={headingId} className={cn('flex h-[min(42rem,85dvh)] min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-white', className)}>
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-primary"><MessageSquare className="h-5 w-5" /></span>
          <div className="min-w-0">
            <h3 id={headingId} className="text-lg font-semibold text-slate-800">Get answers</h3>
            <p className="truncate text-xs text-slate-500 sm:text-sm" title={jobTitle}>{jobTitle || 'Your application conversation'}</p>
          </div>
        </div>
        {onClose && <button type="button" onClick={onClose} aria-label="Close answers chat"
          className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40 disabled:opacity-40"><X className="h-5 w-5" /></button>}
      </header>

      <div ref={threadRef} role="log" aria-label="Answers conversation" aria-live="polite" aria-relevant="additions text" tabIndex={0}
        onScroll={(event) => {
          const thread = event.currentTarget;
          // A layout resize can emit a scroll event before ResizeObserver runs.
          // Keep following the latest reply unless the user actually scrolled away.
          if (thread.clientWidth === threadSize.current.width && thread.clientHeight === threadSize.current.height) {
            followLatest.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 32;
          }
        }}
        className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain bg-[var(--surface-muted)] px-4 py-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600/30 sm:px-6">
        {loading ? (
          <div className="flex h-full min-h-32 items-center justify-center"><LoadingSpinner className="text-primary" label="Loading conversation" /></div>
        ) : loadError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p role="alert" className="text-sm text-red-700">{loadError}</p>
            <button type="button" onClick={() => setReload((value) => value + 1)} className="rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm text-primary">Reload conversation</button>
          </div>
        ) : (
          <>
            {items.length === 0 && !busy && (
              <div className="flex h-full min-h-48 flex-col items-center justify-center text-center">
                <span aria-hidden="true" className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-white text-primary"><Sparkles className="h-6 w-6" /></span>
                <h4 className="text-base font-semibold text-slate-800">Ask your first question</h4>
                <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-500">Get answers based on your resume and this job. Your conversation is saved, so you can continue later.</p>
                <div className="mt-5 flex max-w-sm flex-col gap-2">
                  {['Tell me about yourself.', 'Why are you a good fit for this role?'].map((question) => (
                    <button key={question} type="button" onClick={() => { setDraft(question); composerRef.current?.focus(); }}
                      className="rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm text-slate-600 transition-colors hover:border-teal-600/50 hover:text-primary">{question}</button>
                  ))}
                </div>
              </div>
            )}
            {items.map((item, index) => <Fragment key={index}><QuestionMessage question={item.question} /><AnswerMessage answer={item.answer} /></Fragment>)}
            {pendingQuestion && <>
              <QuestionMessage question={pendingQuestion} />
              <div role="status" aria-label="Assistant is thinking" className="flex items-center gap-2.5 text-sm text-slate-500">
                <span aria-hidden="true" className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-50 text-primary"><Sparkles className="h-3.5 w-3.5" /></span>
                <span className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-[var(--border)] bg-white px-4 py-3" aria-hidden="true">
                  {[0, 1, 2].map((dot) => <span key={dot} className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary opacity-60 motion-reduce:animate-none" style={{ animationDelay: `${dot * 150}ms` }} />)}
                </span>
                <span>{primed ? 'Thinking…' : 'Preparing your conversation…'}</span>
              </div>
            </>}
          </>
        )}
      </div>

      <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="shrink-0 border-t border-[var(--border)] bg-white px-3 pb-3 pt-3 sm:px-5 sm:pb-4">
        {sendError && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{sendError}</p>}
        <div className="flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-white p-2 shadow-sm focus-within:border-teal-600/60 focus-within:ring-2 focus-within:ring-teal-600/10">
          <label htmlFor={composerId} className="sr-only">Your question</label>
          <textarea id={composerId} ref={composerRef} value={draft} rows={1} maxLength={4000} aria-describedby={hintId}
            onChange={(event) => setDraft(event.target.value)} disabled={loading || !!loadError || busy}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                void send();
              }
            }}
            placeholder="Ask a question about this application…"
            className="max-h-36 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm leading-5 text-slate-800 outline-none placeholder:text-slate-400 disabled:opacity-60" />
          <button type="submit" disabled={loading || !!loadError || busy || !draft.trim()} aria-label="Send question" title="Send question"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-white transition-colors hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40 focus-visible:ring-offset-2 disabled:bg-slate-100 disabled:text-slate-400">
            <ArrowUp className="h-5 w-5" />
          </button>
        </div>
        <div id={hintId} className="mt-2 flex justify-between gap-2 px-1 text-[11px] text-slate-400">
          <span>Enter to send · Shift+Enter for a new line</span>
          <span className="shrink-0">{draft.length.toLocaleString()} / 4,000</span>
        </div>
      </form>
    </section>
  );
}

export function GetAnswersDialog({ generationId, jobTitle, onClose }: {
  generationId: string;
  jobTitle: string;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => { dialog?.close(); previouslyFocused?.focus(); };
  }, []);

  return (
    <dialog ref={dialogRef} aria-label="Get answers" aria-modal="true"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
      className="m-auto h-[min(46rem,92dvh)] max-h-[92dvh] w-[calc(100%_-_1.5rem)] max-w-3xl overflow-hidden rounded-2xl border border-[var(--border)] bg-white p-0 text-slate-800 shadow-2xl backdrop:bg-slate-900/50 backdrop:backdrop-blur-sm">
      <GetAnswersPanel key={generationId} generationId={generationId} jobTitle={jobTitle} onBusyChange={setBusy} onClose={onClose} className="h-full rounded-none border-0" />
    </dialog>
  );
}
