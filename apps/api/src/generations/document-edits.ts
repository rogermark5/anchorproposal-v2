import { documentEditsSchema, type GenerationOutput } from '@anchorproposal/shared';
import { bindProfileOutput } from './profile-output';
import { usableCoverLetter } from '../deepseek/cover-letter';

export { documentEditsSchema } from '@anchorproposal/shared';

export function editedDocument(original: GenerationOutput, snapshot: unknown, input: unknown): GenerationOutput {
  const data = documentEditsSchema.parse(input);
  if (data.experiences.length !== original.experiences.length) throw new Error('Keep one experience for each saved work-history entry. Edit the profile to add or remove employers.');
  const coverLetter = data.coverLetter ? usableCoverLetter(data.coverLetter, original.contact.name) : original.coverLetter;
  if (data.coverLetter && !coverLetter) throw new Error('Enter a complete cover letter with paragraph text and one closing.');
  return bindProfileOutput({ ...original, summary: data.summary, skills: data.skills,
    experiences: original.experiences.map((row, index) => ({ ...row, title: data.experiences[index].title, bullets: data.experiences[index].bullets })),
    educations: data.educations, certificates: data.certificates, coverLetter,
  }, snapshot, true);
}
