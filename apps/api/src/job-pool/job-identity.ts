import { normalizedJobUrl } from '../applications/job-url';

// Employer job links can have several public presentation URLs. Recognize
// Employer board aliases and application pages refer to the same posting.
export function poolJobIdentity(value: string): string {
  const url = new URL(value);
  if (url.hostname === 'recruiting.paylocity.com') {
    const posting = /^\/recruiting\/jobs\/(?:details|apply)\/(\d+)(?:\/|$)/i.exec(url.pathname);
    if (posting) return `paylocity:${posting[1]}`;
  }
  const personio = /^([a-z0-9_-]+)\.jobs\.personio\.(?:de|com)$/i.exec(url.hostname);
  if (personio) {
    const posting = /^\/job\/(\d+)(?:\/|$)/.exec(url.pathname);
    if (posting) return `personio:${personio[1].toLowerCase()}:${posting[1]}`;
  }
  const bamboo = /^([a-z0-9_-]+)\.bamboohr\.com$/i.exec(url.hostname);
  if (bamboo) {
    const id = /^\/careers\/(\d+)(?:\/|$)/.exec(url.pathname)?.[1] || (url.pathname === '/jobs/view.php' ? url.searchParams.get('id') : null);
    if (id && /^\d+$/.test(id)) return `bamboohr:${bamboo[1].toLowerCase()}:${id}`;
  }
  if (/^(?:boards|job-boards|boards\.eu|job-boards\.eu)\.greenhouse\.io$/i.test(url.hostname)) {
    const embedded = url.pathname === '/embed/job_app';
    const match = /^\/([^/]+)\/jobs\/(\d+)\/?$/.exec(url.pathname);
    const board = embedded ? url.searchParams.get('for') : match?.[1];
    const id = embedded ? url.searchParams.get('token') : match?.[2];
    if (board && /^[\w.-]{1,100}$/.test(board) && id && /^\d+$/.test(id)) return `greenhouse:${board.toLowerCase()}:${id}`;
  }
  return normalizedJobUrl(value)!;
}
