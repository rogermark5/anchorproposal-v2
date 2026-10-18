'use client';
import { useEffect, useState } from 'react';
import { api, type ApplicationValidation } from './api';

type Draft = { profileId: string; jobTitle: string; company: string; location: string; workArrangement: string; jobDescription: string; jobUrl: string; noJobLink: boolean };
export function useApplicationValidation(form: Draft, enabled = true) {
  const payload = { profileId: form.profileId, jobTitle: form.jobTitle, company: form.company, location: form.location, workArrangement: form.workArrangement, jobDescription: form.jobDescription, jobUrl: form.noJobLink ? '' : form.jobUrl };
  const key = JSON.stringify(payload);
  const [state, setState] = useState<{ key: string; result?: ApplicationValidation; error?: string }>({ key: '' });
  const [reviewed, setReviewed] = useState('');
  const ready = enabled && !!form.profileId && !!form.jobDescription.trim();
  useEffect(() => {
    if (!ready) { setState({key: ''}); setReviewed(''); return; }
    setReviewed('');
    let current = true;
    const timer = setTimeout(() => {
      void api.validateApplication(JSON.parse(key)).then(result => {
        if (current) setState({key, result});
      }).catch(error => { if (current) setState({key, error: error instanceof Error ? error.message : 'Could not validate the description.'}); });
    }, 350);
    return () => { current = false; clearTimeout(timer); };
  }, [key, ready]);
  const result = state.key === key && ready ? state.result : undefined;
  const error = state.key === key && ready ? state.error : undefined;
  const pending = ready && !result && !error;
  return { result, error, pending, needsProfile: enabled && !!form.jobDescription.trim() && !form.profileId,
    reviewed: reviewed === key, setReviewed: (value: boolean) => setReviewed(value ? key : ''),
    canSave: !!result && result.allowed && (!result.warnings.length || reviewed === key) };
}
export type DraftValidation = ReturnType<typeof useApplicationValidation>;
