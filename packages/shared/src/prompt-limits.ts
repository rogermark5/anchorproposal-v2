export const MAX_ANSWER_PROMPT_LENGTH = 80_000;

export function answerPromptLengthError(prompt: string): string | null {
  const length = prompt.trim().length;
  return length > MAX_ANSWER_PROMPT_LENGTH
    ? `Answer instructions must be ${MAX_ANSWER_PROMPT_LENGTH.toLocaleString('en-US')} characters or fewer (currently ${length.toLocaleString('en-US')}).`
    : null;
}
