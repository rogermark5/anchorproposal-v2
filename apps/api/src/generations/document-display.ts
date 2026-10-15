import { templateConfigSchema } from '@anchorproposal/shared';

export type DocumentDisplay = { showJobTitle: boolean };
export const defaultDocumentDisplay: DocumentDisplay = { showJobTitle: true };

export function applyDocumentDisplay(config: object, display: DocumentDisplay) {
  const parsed = templateConfigSchema.parse(config);
  // This is a document-only copy; template records and customizations stay intact.
  return { ...parsed, contact: { ...parsed.contact, showJobTitle: display.showJobTitle } };
}
