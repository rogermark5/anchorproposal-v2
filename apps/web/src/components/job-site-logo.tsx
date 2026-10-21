'use client';
import { useState } from 'react';
import { Globe2 } from 'lucide-react';
import { jobSiteIcons } from '@/lib/job-site-icons';

export function JobSiteLogo({ site }: { site?: { id: string; name: string } }) {
  const [failed, setFailed] = useState(false);
  const name = site?.name || 'Company careers';
  return <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5" title={name} aria-label={name + ' site logo'}>
    {!failed && site && jobSiteIcons[site.id] ? <img src={jobSiteIcons[site.id]} width={24} height={24} alt={name} onError={() => setFailed(true)} className="h-6 w-6 object-contain" /> : <Globe2 size={22} className="text-slate-500" />}
  </span>;
}
