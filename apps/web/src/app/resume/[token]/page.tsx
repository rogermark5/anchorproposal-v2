'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { TemplatePreviewFrame } from '@/components/template-preview-frame';

const API_URL = (process.env.NEXT_PUBLIC_API_URL || '/backend').replace(/\/+$/, '');
const LOAD_ERROR = 'We could not load this resume right now. Please try again or contact the person who shared it.';

export default function PublicResumePage() {
  const { token } = useParams<{ token: string }>();
  const [resume, setResume] = useState<{ html: string; pageSize: string } | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResume(null); setError('');
    // The encrypted link grants read access; never attach a visitor's login session.
    fetch(`${API_URL}/public/resumes/${encodeURIComponent(token)}`, {
      signal: controller.signal, cache: 'no-store', credentials: 'omit',
      headers: { Accept: 'application/json', 'ngrok-skip-browser-warning': 'true' },
    })
      .then(async response => {
        if (response.status === 404 || response.status === 410) throw new Error('This resume link is unavailable or expired.');
        if (!response.ok) throw new Error(LOAD_ERROR);
        const data = await response.json().catch(() => { throw new Error(LOAD_ERROR); });
        if (typeof data?.html !== 'string' || !data.html.trim()) throw new Error(LOAD_ERROR);
        if (!controller.signal.aborted) setResume(data);
      })
      .catch(error => {
        if (!controller.signal.aborted) setError(error instanceof TypeError ? LOAD_ERROR : error.message || LOAD_ERROR);
      });
    return () => controller.abort();
  }, [token, attempt]);
  return <main className="min-h-screen bg-slate-100 p-4 sm:p-8">
    <meta name="robots" content="noindex,nofollow" /><meta name="referrer" content="no-referrer" />
    {error ? <div className="text-center text-slate-600">
      <p role="alert">{error}</p>
      <button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm">Try again</button>
    </div> : resume ?
      <div className="mx-auto max-w-4xl"><TemplatePreviewFrame html={resume.html} pageSize={resume.pageSize} /></div> :
      <p role="status" className="text-center">Loading resume…</p>}
  </main>;
}
