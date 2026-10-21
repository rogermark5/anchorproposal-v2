export function jobTimeAgo(value: string, now = Date.now()): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'Date unavailable';
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'min' : 'mins'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

export function compareSourcePostingTime(a: { publishedAt: string | null; id: string }, b: { publishedAt: string | null; id: string }): number {
  const first = a.publishedAt ? Date.parse(a.publishedAt) : NaN;
  const second = b.publishedAt ? Date.parse(b.publishedAt) : NaN;
  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    if (Number.isFinite(first)) return -1;
    if (Number.isFinite(second)) return 1;
  } else if (first !== second) return second - first;
  return b.id.localeCompare(a.id);
}
