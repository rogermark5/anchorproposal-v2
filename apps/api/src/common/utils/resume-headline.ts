import { plainText } from '@anchorproposal/shared';

/** Resume history is displayed newest first. Match that role without changing history. */
export function resumeHeadline(experiences: Record<string, unknown>[] | undefined, fallback?: unknown): string | undefined {
  const recent = experiences?.[0];
  const role = recent && [recent.title, recent.jobTitle, recent.position, recent.role].map(plainText).find(Boolean);
  return role || plainText(fallback) || undefined;
}
