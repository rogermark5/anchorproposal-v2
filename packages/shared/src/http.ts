export class ApiRequestError extends Error {
  constructor(message: string, public status = 0, public requestId?: string, public retryAfter = 0) { super(message); this.name = 'ApiRequestError'; }
}
export function retryDelay(response: Response): number {
  const value = response.headers.get('retry-after');
  return value ? Math.max(0, /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now()) : 0;
}
/** Retry only reads and explicitly idempotent operations; never replay arbitrary writes. */
export async function fetchWithRecovery(url: string, init: RequestInit = {}, options: { timeoutMs?: number; idempotent?: boolean; fetcher?: typeof fetch; wait?: (ms: number) => Promise<void> } = {}): Promise<Response> {
  const attempts = options.idempotent || ['GET', 'HEAD'].includes(init.method || 'GET') ? 3 : 1;
  const fetcher = options.fetcher || fetch, wait = options.wait || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < attempts; attempt++) {
    init.signal?.throwIfAborted();
    try {
      const signal = AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(options.timeoutMs || 30_000)]);
      const response = await fetcher(url, { ...init, signal });
      const delay = retryDelay(response);
      if ([408, 429, 502, 503, 504].includes(response.status) && attempt + 1 < attempts && delay <= 10_000) {
        await response.body?.cancel(); await wait(Math.max(delay, 400 * 2 ** attempt)); continue;
      }
      return response;
    } catch (error) {
      init.signal?.throwIfAborted();
      if (attempt + 1 < attempts) { await wait(400 * 2 ** attempt); continue; }
      throw new ApiRequestError((error as Error)?.name === 'TimeoutError' ? 'The server took too long to respond. Your saved work is kept; try again shortly.' : 'Could not connect to the server. Check your connection and try again. Your saved work is kept.');
    }
  }
  throw new ApiRequestError('The server is temporarily unavailable. Please try again shortly.');
}
export async function responseJson<T>(response: Response): Promise<T> {
  let text: string;
  try { text = await response.text(); }
  catch { throw new ApiRequestError('The connection was interrupted while reading the server response. Your saved work is kept; please try again shortly.', response.status); }
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { /* Do not expose HTML proxy pages. */ }
  if (!response.ok) {
    const fallback: Record<number, string> = { 401: 'Your session has expired. Please sign in again.', 403: 'You do not have permission for this action.', 413: 'This request is too large.', 429: 'Too many requests. Please wait and try again.', 502: 'The API is temporarily unavailable. Please try again shortly.', 503: 'The server is busy or restarting. Please try again shortly.', 504: 'The server timed out. Check the application before starting another generation.' };
    const message = Array.isArray(data?.message) ? data.message.join(' ') : data?.message;
    const requestId = data?.requestId || response.headers.get('x-request-id') || undefined;
    throw new ApiRequestError((typeof message === 'string' ? message.slice(0, 1000) : fallback[response.status] || `The server could not complete this request (HTTP ${response.status}).`) + (requestId ? ` Reference: ${String(requestId).slice(0, 100)}.` : ''), response.status, requestId, retryDelay(response) / 1000);
  }
  if (data === undefined) throw new ApiRequestError('The server returned an unexpected response. Please reload and try again.', response.status);
  return data as T;
}
