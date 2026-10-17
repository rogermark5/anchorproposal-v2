import { plainText, type GenerationOutput } from '@anchorproposal/shared';
import { usableCoverLetter } from '../deepseek/cover-letter';
import { resumeHeadline } from '../common/utils/resume-headline';

/** Document viewers never receive the creator's private prompt text. */
export function redactPromptMetadata<T extends object>(generation: T): Omit<T, 'promptSnapshot' | 'coverLetterPromptSnapshot' | 'promptVersion'> {
  const result = { ...generation } as T & Record<string, unknown>;
  delete result.promptSnapshot; delete result.coverLetterPromptSnapshot; delete result.promptVersion;
  return result;
}

export function hasProfileIdentityConflict(output: GenerationOutput, snapshot: unknown): boolean {
  if (!output || typeof output !== 'object') return true;
  const profile = snapshot as Record<string, any> | null;
  const name = [profile?.firstName, profile?.lastName].map(plainText).filter(Boolean).join(' ');
  if (!name) return true;
  if (output.contact?.name && output.contact.name.trim() !== name) return true;
  if (!Array.isArray(profile?.experiences)) return false;
  if (output.experiences?.length !== profile.experiences.length) return true;
  return output.experiences.some((row, index) => {
    const company = plainText(row.company || row.companyName).toLowerCase();
    return Boolean(company && company !== plainText(profile.experiences[index]?.company).toLowerCase());
  });
}

/** Identity stays bound to the saved profile; generated skills come from the response. */
export function bindProfileOutput(output: GenerationOutput, snapshot: unknown, userEdited = false): GenerationOutput {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('The saved profile snapshot is missing. Regenerate using a saved profile.');
  const profile = snapshot as Record<string, any>;
  const name = [profile.firstName, profile.lastName].map(plainText).filter(Boolean).join(' ');
  if (!name) throw new Error('The saved profile name is missing. Regenerate using a saved profile.');
  const links = Array.isArray(profile.links) ? profile.links : [];
  return {
    ...output,
    contact: {
      name,
      title: resumeHeadline(output.experiences, plainText(profile.profileTitle) || plainText(profile.experiences?.[0]?.title)),
      email: plainText(profile.email) || undefined,
      phone: plainText(profile.phone) || undefined,
      address: plainText(profile.address) || [profile.city, profile.state, profile.country].map(plainText).filter(Boolean).join(', ') || undefined,
      linkedin: plainText(profile.linkedin) || plainText(links.find((link: any) => /linkedin/i.test(`${link.type || link.label || ''} ${link.url || ''}`))?.url) || undefined,
      links: links.map((link: any) => ({ type: plainText(link.type || link.label), url: plainText(link.url) })).filter((link: any) => /^https?:\/\//i.test(link.url)),
    },
    skills: output.skills || [],
    projects:userEdited?output.projects:undefined,
    headline:userEdited?output.headline:undefined,
    coreExpertise:userEdited?output.coreExpertise:undefined,
    // A model may improve section wording, but cannot add another person's qualifications.
    educations: userEdited ? output.educations : Array.isArray(profile.education || profile.educations) ? (profile.education || profile.educations).map((row: any, index: number) => ({
      ...(output.educations?.[index] || {}), ...row,
      institution: plainText(row.institution || row.school || row.university), degree: plainText(row.degree || row.major),
      dates: plainText(row.dates) || [row.startDate, row.endDate].map(plainText).filter(Boolean).join(' – '),
    })) : [],
    certificates: userEdited ? output.certificates : Array.isArray(profile.certifications || profile.certificates) ? (profile.certifications || profile.certificates).map((row: any, index: number) => ({
      ...(output.certificates?.[index] || {}), ...row,
      name: plainText(row.name || row.title), issuer: plainText(row.issuer || row.organization), date: plainText(row.issueDate || row.date),
    })) : [],
    coverLetter: usableCoverLetter(output.coverLetter, name),
  };
}
