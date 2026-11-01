/** Normalize generated text without changing JSON keys or non-string values. */
export function normalizeAiText<T>(value: T): T {
  if (typeof value === 'string') return value.replace(/\u2014/g, '-') as T;
  if (Array.isArray(value)) return value.map(item => normalizeAiText(item)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeAiText(item)])) as T;
  }
  return value;
}

/** Read common answer envelopes, including legacy fenced/double-encoded replies. */
export function readableAnswer(content: string): string {
  const read = (value: unknown, depth: number): string | null => {
    if (depth > 6) return null;
    if (typeof value === 'string') {
      const text = value.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1').trim();
      if (/^[\[{\"]/.test(text)) {
        try { const nested = read(JSON.parse(text), depth + 1); if (nested !== null) return nested; } catch { /* Ordinary prose. */ }
      }
      return value;
    }
    if (Array.isArray(value)) {
      const items = value.map(item => read(item, depth + 1));
      return items.length && items.every(item => item !== null) ? items.join('\n\n') : null;
    }
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    if (typeof row.answer === 'string') {
      const answer = read(row.answer, depth + 1);
      return typeof row.question === 'string' ? `${row.question}\n\n${answer}` : answer;
    }
    for (const key of ['answers', 'answer', 'response', 'text', 'content', 'message', 'data', 'result']) {
      if (row[key] !== undefined) { const result = read(row[key], depth + 1); if (result !== null) return result; }
    }
    return null;
  };
  return normalizeAiText(read(content, 0) ?? content);
}
