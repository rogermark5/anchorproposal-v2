import { coverLetterSchema, type CoverLetterContent } from '@anchorproposal/shared';

export const COVER_LETTER_INSTRUCTIONS = [
  'Include a coverLetter object in the same JSON response: {"greeting":"Dear Hiring Manager,","paragraphs":["Opening tailored to the role and company","Specific candidate evidence linked to the job requirements","Closing tailored to the opportunity"],"closing":"Sincerely,","signatureName":"Candidate name"}.',
  'Write a complete, natural cover letter with 3-4 substantive paragraphs, tailored to this job description and company. Connect at least two relevant, supported skills or contributions from the candidate resume to the advertised responsibilities. Do not invent achievements, metrics, qualifications, personal motivations, or company facts.',
  'Follow the custom prompt cover-letter style instructions within this JSON format. Return no separate plain-text letter or text outside the JSON. Use the saved candidate name for the signature.',
  'Keep paragraphs free of salutations, closings and signatures. Put Sincerely only once in closing. The application supplies the candidate contact header from the saved profile.',
].join(' ');

export const COVER_LETTER_UNAVAILABLE = 'This resume has no tailored cover letter. Regenerate the resume, or import JSON containing coverLetter with greeting, paragraphs, closing, and signatureName. The old default letter is no longer used.';

/** Recognize usable content, excluding the exact legacy placeholder letters. */
export function usableCoverLetter(value: unknown, candidateName?: string): CoverLetterContent | undefined {
  const parsed = coverLetterSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const letter = parsed.data;
  if (!letter.greeting.trim() || !letter.closing.trim() || letter.paragraphs.some(p => !p.trim())) return undefined;
  const signOff = /^(?:sincerely(?:\s+yours)?|yours\s+(?:sincerely|faithfully|truly)|(?:best|kind|warm)\s+regards|regards|respectfully(?:\s+yours)?|best\s+wishes|yours\s+truly)[,!\.\s]*$/i;
  const signature = candidateName?.trim() || letter.signatureName?.trim() || '';
  const paragraphs = letter.paragraphs.flatMap(paragraph => {
    let text = paragraph.trim();
    // Remove a complete pasted sign-off block, including duplicated signatures.
    const lines = text.split(/\r?\n/);
    const closingIndex = lines.findIndex(line => signOff.test(line.trim()));
    if (closingIndex >= 0) text = lines.slice(0, closingIndex).join('\n').trim();
    text = text.replace(/(?:^|\s)(?:Sincerely(?:\s+yours)?|Yours\s+(?:sincerely|faithfully|truly)|(?:Best|Kind|Warm)\s+regards|Regards|Respectfully(?:\s+yours)?|Best\s+wishes)[,!](?:\s|$)[\s\S]*$/i, '').trim();
    text = text.replace(/(?:\s|^)(?:Sincerely(?:\s+yours)?|Best regards|Kind regards|Yours faithfully|Respectfully)[,!\.]*\s*(?:\n[\s\S]*)?$/i, '').trim();
    if (!text || signOff.test(text) || (signature && text.toLowerCase() === signature.toLowerCase())) return [];
    return [text];
  });
  if (!paragraphs.length) return undefined;
  const normalized = paragraphs.map(p => p.replace(/\s+/g, ' ').toLowerCase());
  if (normalized.includes('my experience and skills, as outlined in my resume, align well with what you are looking for, and i would welcome the opportunity to contribute to your team.')) return undefined;
  if (paragraphs.length === 1 && /^i am writing to express my interest in the .+ (role|position) at .+\.$/i.test(paragraphs[0])) return undefined;
  const closingLines = letter.closing.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const closing = closingLines.find(line => signOff.test(line)) || 'Sincerely,';
  return { greeting: letter.greeting.trim(), paragraphs, closing, signatureName: signature || undefined };
}
