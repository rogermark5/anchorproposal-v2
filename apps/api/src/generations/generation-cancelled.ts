export const ACTIVE_GENERATION_STATUSES = ['QUEUED', 'VALIDATING', 'GENERATING', 'RENDERING', 'UPLOADING'] as const;
export class GenerationCancelled extends Error {
  constructor() { super('Generation cancelled.'); this.name = 'GenerationCancelled'; }
}
