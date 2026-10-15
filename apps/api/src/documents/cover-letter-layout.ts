import type { CoverLetterContent, PromptResumeContent } from '@anchorproposal/shared';
import { templateConfigSchema } from '@anchorproposal/shared';
import { usableCoverLetter } from '../deepseek/cover-letter';

export type CoverLetterDocument = CoverLetterContent & { company: string; jobTitle?: string; date?: string; contact?: PromptResumeContent['contact'] };

export function coverLetterContactLines(contact: PromptResumeContent['contact']) {
  return [contact.address, [contact.email, contact.phone].filter(Boolean).join(' · '),
    ...new Set([contact.linkedin, ...(contact.links || []).map(link => link.url)].filter((value): value is string => Boolean(value)))].filter((value): value is string => Boolean(value));
}

export function coverLetterDate(value?: string) {
  const calendar = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = calendar ? new Date(Number(calendar[1]), Number(calendar[2]) - 1, Number(calendar[3]), 12) : value ? new Date(value) : new Date();
  return (Number.isNaN(date.getTime()) ? new Date() : date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function renderCoverLetterHtml(cover: CoverLetterDocument, config: object = {}) {
  const cfg = templateConfigSchema.parse(config);
  const contact = cover.contact || { name: cover.signatureName || 'Applicant' };
  const normalized = usableCoverLetter(cover, contact.name);
  if (!normalized) throw new Error('The cover letter is missing valid content.');
  cover = { ...cover, ...normalized };
  const esc = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const color = (value: string, fallback: string) => /^#(?:[a-f0-9]{3}|[a-f0-9]{6})$/i.test(value) ? value : fallback;
  const primary = color(cfg.colors.primary, '#173a43');
  const body = color(cfg.colors.body, '#334155');
  const font = cfg.typography.bodyFont.replace(/[^a-zA-Z0-9 ,_-]/g, '') || 'Georgia';
  const size = Math.max(9, Math.min(13, cfg.typography.baseFontSize));
  const margin = (value: number) => Math.max(28, Math.min(120, Math.round(value)));
  const padding = [cfg.layout.marginTop, cfg.layout.marginRight, cfg.layout.marginBottom, cfg.layout.marginLeft].map(value => margin(value) + 'px').join(' ');
  const contactLines = coverLetterContactLines(contact).map(line => `<p>${esc(line)}</p>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: ${cfg.layout.pageSize === 'A4' ? 'A4' : 'Letter'}; }
    * { box-sizing: border-box; } html, body { margin: 0; padding: 0; background: #fff; }
    .page { margin: 0 auto; font-family: "${font}", Georgia, serif; font-size: ${size}pt; line-height: 1.5; color: ${body}; overflow-wrap: anywhere; }
    @media screen { .page { width: ${cfg.layout.pageSize === 'A4' ? '210mm' : '8.5in'}; min-height: ${cfg.layout.pageSize === 'A4' ? '297mm' : '11in'}; padding: ${padding}; } }
    @media print { .page { width: auto; padding: 0; } }
    .candidate { margin-bottom: 26px; } h1 { margin: 0 0 5px; color: ${primary}; font-size: 21pt; font-weight: 700; line-height: 1.15; }
    .headline { margin: 0 0 7px; font-size: 11pt; font-weight: 600; }
    .contact { font-size: 9pt; line-height: 1.45; } .contact p { margin: 2px 0; }
    .date { margin: 0 0 18px; } .recipient { margin: 0 0 17px; } .subject { margin: 0 0 18px; font-weight: 600; color: ${primary}; }
    .greeting { margin: 0 0 14px; } .paragraph { margin: 0 0 13px; white-space: pre-line; orphans: 3; widows: 3; }
    .signature { margin-top: 20px; break-inside: avoid; } .signature p { margin: 0; } .name { padding-top: 6px; font-weight: 600; color: ${primary}; }
  </style></head><body><main class="page">
    <header class="candidate"><h1>${esc(contact.name)}</h1>${contact.title && cfg.contact.showJobTitle !== false ? `<p class="headline">${esc(contact.title)}</p>` : ''}<div class="contact">${contactLines}</div></header>
    <p class="date">${esc(coverLetterDate(cover.date))}</p>
    <p class="recipient">Hiring Manager<br>${esc(cover.company)}</p>
    ${cover.jobTitle ? `<p class="subject">Application for ${esc(cover.jobTitle)}</p>` : ''}
    <p class="greeting">${esc(cover.greeting)}</p>${cover.paragraphs.map(paragraph => `<p class="paragraph">${esc(paragraph)}</p>`).join('')}
    <div class="signature"><p>${esc(cover.closing)}</p><p class="name">${esc(contact.name)}</p></div>
  </main></body></html>`;
}
