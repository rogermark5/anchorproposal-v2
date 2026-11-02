function redact(value) {
  return String(value || '').replace(/jrbot_[a-z0-9]+/gi, '[worker key hidden]').replace(/Bearer\s+\S+/gi, 'Bearer [hidden]')
    .replace(/https?:\/\/[^\s<>"']+/gi, value => { try { const url = new URL(value); return url.origin + url.pathname; } catch { return '[URL]'; } })
    .replace(/((?:password|access[_-]?token|refresh[_-]?token|api[_-]?key)\s*[=:]\s*)[^\s,;]+/gi, '$1[hidden]');
}
function formatError(error, stage) {
  const lines = [stage + ': ' + (error?.stack || error?.message || error?.name || 'Unknown error')];
  let cause = error?.cause;
  for (let depth = 0; cause && depth < 3; depth++, cause = cause.cause) lines.push('Caused by: ' + (cause.stack || cause.code || cause.message || cause.name || 'Unknown error'));
  return redact(lines.join('\n')).slice(0, 8000);
}
module.exports = { formatError };
