import { normalizedJobUrl } from '../applications/job-url';

// Employer job links can have several public presentation URLs. Recognize
// Greenhouse's embedded application and board aliases as the same posting.
export function poolJobIdentity(value: string): string {
  const url = new URL(value);
  if (/^(?:boards|job-boards|boards\.eu|job-boards\.eu)\.greenhouse\.io$/i.test(url.hostname)) {
    const embedded = url.pathname === '/embed/job_app';
    const match = /^\/([^/]+)\/jobs\/(\d+)\/?$/.exec(url.pathname);
    const board = embedded ? url.searchParams.get('for') : match?.[1];
    const id = embedded ? url.searchParams.get('token') : match?.[2];
    if (board && /^[\w.-]{1,100}$/.test(board) && id && /^\d+$/.test(id)) return `greenhouse:${board.toLowerCase()}:${id}`;
  }
  return normalizedJobUrl(value)!;
}
