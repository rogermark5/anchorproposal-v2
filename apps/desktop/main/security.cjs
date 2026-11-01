const { URL } = require('node:url');
const DEFAULT_HOTKEY = 'Control+Shift+Z';
const DESKTOP_API_SERVER = 'https://anchorproposal.giize.com/backend';
function restoreSettings(saved, defaults) {
  const settings = { ...defaults, server: DESKTOP_API_SERVER };
  if (!saved || typeof saved !== 'object') return settings;
  if (typeof saved.hotkey === 'string') { try { settings.hotkey = hotkey(saved.hotkey); } catch {} }
  for (const key of ['alwaysOnTop', 'launchAtLogin', 'notifications']) if (typeof saved[key] === 'boolean') settings[key] = saved[key];
  return settings;
}
function hotkey(value) {
  if (typeof value !== 'string') throw new Error('Record a keyboard shortcut.');
  const parts = value.split('+');
  const key = parts.pop();
  if (!parts.length || !parts.some(p => ['Control', 'Alt', 'Super'].includes(p)) ||
      new Set(parts).size !== parts.length || parts.some(p => !['Control', 'Alt', 'Shift', 'Super'].includes(p)) ||
      !/^(?:[A-Z0-9]|Space|F(?:[1-9]|1[0-9]|2[0-4]))$/.test(key || '')) {
    throw new Error('Use Ctrl, Alt, or Windows with a letter, number, Space, or function key.');
  }
  return [...['Control', 'Alt', 'Shift', 'Super'].filter(p => parts.includes(p)), key].join('+');
}
function serverUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a valid server URL.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Use HTTPS for a remote server. HTTP is allowed only on this computer.');
  if (url.username || url.password || url.search || url.hash) throw new Error('Server URL must not contain credentials, a query, or a fragment.');
  return url.toString().replace(/\/+$/, '');
}
function panelBounds(workArea, compact = false) {
  const gap = Math.min(16, Math.floor(workArea.width / 40));
  const width = Math.min(compact ? 480 : 560, workArea.width - gap * 2);
  const height = Math.min(compact ? 390 : 900, workArea.height - gap * 2);
  return { x: workArea.x + workArea.width - width - gap, y: workArea.y + gap, width, height };
}
function apiPath(value) {
  if (typeof value !== 'string' || value.length > 5000 || /[\s#\\]/.test(value) || !/^\/[a-zA-Z0-9/-]+(?:\?[a-zA-Z0-9%=&_,.+-]*)?$/.test(value)) throw new Error('Unsupported desktop request.');
  return value;
}
function safeFilename(value) { return String(value || 'resume.pdf').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 180); }
function apiRequest(route, method = 'GET') {
  apiPath(route);
  const pathname = route.split('?')[0];
  const rules = [
    [/^\/settings\/time-zone$/, ['GET', 'PATCH']],
    [/^\/generations\/[\w-]+\/cancel$/, ['POST']],
    [/^\/generations\/[\w-]+\/answers\/requests(?:\/[\w-]+)?$/, ['GET', 'POST']],
    [/^\/settings\/generation-workflow$/, ['GET']],
    [/^\/settings\/document-display$/, ['PATCH']],
    [/^\/profiles\/[\w-]+\/generation-preference$/, ['GET', 'PUT']],
    [/^\/generations\/[\w-]+\/public-link$/, ['POST', 'DELETE']],
    [/^\/generations\/[\w-]+\/(draft-preview|edits)$/, ['POST']],
    [/^\/auth\/me$/, ['GET']], [/^\/auth\/change-password$/, ['PATCH']],
    [/^\/dashboard\/metrics$/, ['GET']], [/^\/(audit|job-pool)$/, ['GET']],
    [/^\/job-pool$/, ['POST']],
    [/^\/job-pool\/manage$/, ['GET', 'PATCH']],
    [/^\/job-pool\/sources$/, ['POST']],
    [/^\/job-pool\/sources\/[\w-]+$/, ['PATCH']],
    [/^\/job-pool\/sync$/, ['POST']],
    [/^\/job-pool\/updates$/, ['GET']],
    [/^\/job-pool\/jobs\/[\w-]+$/, ['GET', 'PATCH']],
    [/^\/job-pool\/jobs\/[\w-]+\/apply$/, ['POST']],
    [/^\/job-pool\/jobs\/[\w-]+\/applied$/, ['PATCH']],
    [/^\/job-pool\/jobs\/[\w-]+\/viewed$/, ['PATCH']],
    [/^\/applications(?:\/[\w-]+)?$/, ['GET', 'POST', 'PATCH', 'DELETE']],
    [/^\/applications\/[\w-]+\/(status|notes|generation-prompt|manual-generation-prompt|generations(?:\/manual)?)$/, ['GET', 'POST', 'PATCH']],
    [/^\/applications\/warnings\/[\w-]+\/acknowledge$/, ['PATCH']],
    [/^\/application-options(?:\/[\w-]+(?:\/set-default)?)?$/, ['GET', 'POST', 'PATCH', 'DELETE']],
    [/^\/profiles(?:\/[\w-]+(?:\/(archive|set-default|prompt-assignments))?)?$/, ['GET', 'POST', 'PUT', 'PATCH']],
    [/^\/templates(?:\/[\w-]+(?:\/(preview|clone|publish|archive|set-default))?)?$/, ['GET', 'POST', 'PUT', 'PATCH']],
    [/^\/users(?:\/[\w-]+(?:\/(managed-by|assignments|template-assignments|status|permissions|prompt-assignment|prompt-assignments))?)?$/, ['GET', 'POST', 'PATCH', 'DELETE']],
    [/^\/settings\/(ai|my-prompt|prompt-mode|answer-prompt|warning-rules|prompt-library|prompts)(?:\/[\w-]+(?:\/publish)?)?$/, ['GET', 'POST', 'PATCH', 'DELETE']],
    [/^\/generations\/[\w-]+(?:\/(preview|export|answers(?:\/prompt)?))?$/, ['GET', 'POST']],
    [/^\/desktop\/manage\/releases(?:\/[\w-]+(?:\/files\/(setup|portable))?)?$/, ['GET', 'POST', 'PATCH', 'DELETE']],
  ];
  if (rules.some(([pattern, methods]) => pattern.test(pathname) && methods.includes(method))) return;
  throw new Error('Unsupported desktop operation.');
}
module.exports = { serverUrl, panelBounds, apiPath, apiRequest, safeFilename, hotkey, DEFAULT_HOTKEY, DESKTOP_API_SERVER, restoreSettings };
