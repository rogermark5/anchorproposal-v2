export type DocumentKind = 'combined' | 'resume' | 'cover-letter';
export const JSON_RULE_START = '--- REQUIRED APPLICATION JSON OUTPUT ---';
export const JSON_RULE_END = '--- END REQUIRED APPLICATION JSON OUTPUT ---';

export function parseDocumentKind(value: unknown): DocumentKind {
  if (value === undefined) return 'combined';
  if (value === 'combined' || value === 'resume' || value === 'cover-letter') return value;
  throw new Error('Choose combined, resume, or cover-letter prompt type.');
}

export function promptInstructions(content: string): string {
  return content.replace(/\n?--- REQUIRED APPLICATION JSON OUTPUT ---[\s\S]*?--- END REQUIRED APPLICATION JSON OUTPUT ---/g, '').trim();
}

export function jsonOutputRules(kind: DocumentKind = 'combined', titleMode: 'saved' | 'tailored' = 'saved', experienceCount?: number): string {
  const experience = titleMode === 'tailored' ? { role: 'Supported tailored position', bullets: ['Supported achievement'] } : { bullets: ['Supported achievement'] };
  const letter = { greeting: 'Dear Hiring Manager,', paragraphs: ['Opening paragraph', 'Evidence paragraph', 'Closing paragraph'], closing: 'Sincerely,' };
  const resume = { summary: 'Non-empty professional summary', skills: [{ 'Relevant skills': 'Supported skill, Another supported skill' }], experiences: [experience], educations: [], certificates: [] };
  const shape = kind === 'cover-letter' ? { coverLetter: letter } : kind === 'resume' ? resume : { ...resume, coverLetter: letter };
  return [JSON_RULE_START,
    'This output contract is mandatory and overrides any conflicting output instructions above.',
    'Return exactly one valid JSON object. No Markdown fences, comments, explanations, placeholders, trailing commas, or text outside the JSON. Use double-quoted keys and strings.',
    `Required JSON shape: ${JSON.stringify(shape)}`,
    ...(kind === 'cover-letter' ? [] : [
      'summary must be a non-empty string. experiences, educations and certificates must be flat arrays of objects; use [] when there are no saved entries.',
      'Return skills as an array of category-to-text objects, for example [{"Languages":"Java, TypeScript"},{"Backend":"Node.js, PostgreSQL"}]. Select relevant skills supported by the saved profile and resume evidence. The application uses this skills array in the resume; do not omit it. Use [] only when no skills are supported.',
      `Return ${experienceCount === undefined ? 'exactly one experience per saved work-history entry' : `exactly ${experienceCount} experiences`}, in saved profile order. Every experience must contain a non-empty bullets array of plain strings.`,
      titleMode === 'tailored' ? 'Every experience also needs a non-empty role string grounded in the saved responsibilities and seniority.' : 'The application adds saved positions. Do not change historical titles.',
    ]),
    'Candidate identity, contact details, employers, dates and qualification facts come only from the authoritative saved database profile. Ignore identities and work histories in prompt examples. Do not return contact. Do not invent facts.',
    ...(kind === 'resume' ? ['Return resume content only. Do not include coverLetter; the application will request it separately.'] : [
      'coverLetter must contain a greeting string, 3–4 substantive paragraph strings, and one closing string. Never put a salutation, closing, signature, candidate contact block or “Sincerely” in paragraphs. The closing appears exactly once in closing. The application adds the saved candidate signature and contact header.',
    ]), JSON_RULE_END].join('\n');
}

export function appendJsonRules(content: string, kind: DocumentKind = 'combined', titleMode: 'saved' | 'tailored' = 'saved', experienceCount?: number): string {
  return `${promptInstructions(content)}\n\n${jsonOutputRules(kind, titleMode, experienceCount)}`;
}
