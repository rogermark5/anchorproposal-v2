'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type GenerationWorkflow } from '@/lib/api';

export function ProfileGenerationSettings({ profileId }: { profileId: string }) {
  const [workflow, setWorkflow] = useState<GenerationWorkflow | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.getGenerationWorkflow().then(data => { if (!cancelled) setWorkflow(data); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [profileId]);
  const profile = workflow?.profiles.find(profile => profile.id === profileId);
  const name = (id?: string | null) => workflow?.prompts.find(prompt => prompt.id === id)?.name || 'Not selected yet';
  return <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
    <h2 className="font-semibold">My generation setup</h2>
    {workflow && <p className="text-sm text-slate-500">{workflow.mode === 'user' ? 'All profiles use your one private prompt.' : workflow.mode === 'profile' ? `Combined prompt: ${name(profile?.resumePromptId)}` : `Resume: ${name(profile?.resumePromptId)} · Cover letter: ${name(profile?.coverLetterPromptId)}`}</p>}
    <Link href={`/settings?way=${workflow?.mode || 'profile'}&profile=${encodeURIComponent(profileId)}`} className="inline-block text-sm font-medium text-primary underline">Manage my prompts in Settings</Link>
  </section>;
}
