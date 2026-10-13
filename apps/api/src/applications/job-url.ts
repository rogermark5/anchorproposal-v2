import { BadRequestException } from '@nestjs/common';

/** Preserve job identifiers, discard fragments and advertising attribution. */
export function normalizedJobUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw new BadRequestException('Job link must be a valid HTTP or HTTPS URL.');
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_.+|fbclid|gclid|ref|referrer|source|trk|trackingId)$/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return `${url.host.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '') || '/'}${url.search}`;
  } catch { throw new BadRequestException('Job link must be a valid HTTP or HTTPS URL.'); }
}
