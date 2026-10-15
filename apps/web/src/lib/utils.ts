import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { APPLICATION_STATUS_LABELS, type ApplicationStatus } from '@anchorproposal/shared';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Canonical statuses for dashboard + applications UI (avoids stale shared CJS shadowing). */
export const APPLICATION_STATUSES = [
  'SAVED',
  'APPLIED',
  'ASSESSMENT',
  'INTERVIEW',
  'OFFER',
  'REJECTED',
  'WITHDRAWN',
  'CLOSED',
] as const;

export type ApplicationPipelineStatus = (typeof APPLICATION_STATUSES)[number];

export const STATUS_COLORS: Record<string, string> = {
  SAVED: 'bg-slate-100 text-slate-700',
  READY_TO_APPLY: 'bg-slate-100 text-slate-700',
  APPLIED: 'bg-teal-100 text-teal-800',
  RECRUITER_CONTACTED: 'bg-teal-100 text-teal-800',
  ASSESSMENT: 'bg-cyan-100 text-cyan-800',
  INTERVIEW: 'bg-amber-100 text-amber-800',
  OFFER: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-700',
  WITHDRAWN: 'bg-stone-100 text-stone-600',
  CLOSED: 'bg-slate-100 text-slate-600',
};

export function formatStatus(status: string) {
  const label = APPLICATION_STATUS_LABELS?.[status as ApplicationStatus];
  if (label) return label;
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatDate(date: string) {
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Truncate for table cells; full text should stay in a title/tooltip. */
export function truncateText(value: string, maxChars = 25): string {
  const text = value?.trim() ?? '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}…`;
}

/** Legacy no-link placeholder; new applications save an empty URL. */
export const PLACEHOLDER_JOB_URL = 'https://';

export function hasRealJobUrl(url?: string | null): boolean {
  const v = (url || '').trim();
  if (!v) return false;
  if (v === PLACEHOLDER_JOB_URL || v === 'http://') return false;
  return true;
}
