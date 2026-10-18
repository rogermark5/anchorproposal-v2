const { app, BrowserWindow, ipcMain, protocol, net, session: electronSession, screen, globalShortcut, Tray, Menu, nativeImage, safeStorage, clipboard, dialog, Notification, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DesktopSession } = require('./session.cjs');
const { GenerationRunner } = require('./generation.cjs');
const { panelBounds, apiRequest, safeFilename, hotkey, DEFAULT_HOTKEY, DESKTOP_API_SERVER, restoreSettings } = require('./security.cjs');
const startedAt = Date.now();
protocol.registerSchemesAsPrivileged([{ scheme: 'anchor', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const smokePath = !app.isPackaged && process.env.ANCHOR_DESKTOP_SMOKE_DIR;
const probeArg = process.argv.find(value => value.startsWith('--startup-probe='));
const probePath = probeArg ? path.resolve(probeArg.slice('--startup-probe='.length)) : null;
if (smokePath || probePath) { app.setPath('userData', path.resolve(smokePath || probePath)); app.disableHardwareAcceleration(); }
let window, quickWindow, tray, auth, runner, settings, quitting = false, compact = false, shortcutError = '', quickLoading;
const defaults = { server: DESKTOP_API_SERVER, hotkey: DEFAULT_HOTKEY, alwaysOnTop: true, launchAtLogin: false, notifications: true };
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const windows = () => [window, quickWindow].filter(win => win && !win.isDestroyed());
const send = value => windows().forEach(win => win.webContents.send('anchor:event', value));
function position(initial = false) {
  if (!quickWindow || quickWindow.isDestroyed()) return;
  const current = quickWindow.getBounds();
  const area = (initial ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) : screen.getDisplayMatching(current)).workArea;
  const bounds = panelBounds(area, compact);
  if (!initial) {
    bounds.x = Math.max(area.x, Math.min(current.x, area.x + area.width - bounds.width));
    bounds.y = Math.max(area.y, Math.min(current.y, area.y + area.height - bounds.height));
  }
  quickWindow.setBounds(bounds);
}
function showWorkspace(route) {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
  if (route) window.webContents.send('anchor:event', { type: 'navigate', path: route });
}
async function showQuick(showResult = false) {
  if (!quickWindow || quickWindow.isDestroyed()) {
    quickWindow = makeWindow(true); compact = Boolean(runner?.active); position(true);
    quickLoading = quickWindow.loadURL('anchor://app/index.html?view=quick');
  }
  await quickLoading;
  const nextCompact = Boolean(runner?.active);
  if (nextCompact !== compact) { compact = nextCompact; position(); }
  if (quickWindow.isMinimized()) quickWindow.restore();
  quickWindow.show(); quickWindow.focus();
  quickWindow.webContents.send('anchor:event', { type: 'quick-show', job: runner?.job || null, showResult });
}
function registerShortcut(value) {
  const accelerator = hotkey(value);
  if (accelerator === settings.hotkey && globalShortcut.isRegistered(accelerator)) return accelerator;
  if (!globalShortcut.register(accelerator, () => void showQuick())) throw new Error('That shortcut is already used by another app. Choose another shortcut.');
  if (settings.hotkey !== accelerator) globalShortcut.unregister(settings.hotkey);
  return accelerator;
}
function trustedWindow(event) {
  const win = windows().find(win => win.webContents === event.sender);
  if (!win || event.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted desktop request.');
  const url = new URL(event.senderFrame.url);
  if (url.protocol !== 'anchor:' || url.hostname !== 'app' || url.pathname !== '/index.html') throw new Error('Untrusted desktop request.');
  return win;
}
function handle(name, fn) {
  ipcMain.handle(`anchor:${name}`, async (event, ...args) => {
    try { return { ok: true, value: await fn(trustedWindow(event), ...args) }; }
    catch (error) { return { ok: false, error: error.message || 'Unable to complete this action.' }; }
  });
}
async function saveSettings(_win, input) {
  if (!input || typeof input !== 'object') throw new Error('Invalid settings.');
  if (input.server !== undefined && input.server !== DESKTOP_API_SERVER) throw new Error('The server connection is managed by AnchorProposal.');
  const next = { ...settings };
  if (input.hotkey !== undefined) next.hotkey = hotkey(input.hotkey);
  for (const key of ['alwaysOnTop', 'launchAtLogin', 'notifications']) if (typeof input[key] === 'boolean') next[key] = input[key];
  registerShortcut(next.hotkey);
  settings = next; shortcutError = '';
  quickWindow?.setAlwaysOnTop(settings.alwaysOnTop);
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, args: ['--background'] });
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify(settings));
  send({ type: 'settings', settings }); return settings;
}
async function download(win, id, fallback = 'document.pdf') {
  if (!/^[\w-]{1,80}$/.test(id)) throw new Error('Invalid document.');
  const response = await auth.request(`/documents/${id}/download`, { binary: true, signal: AbortSignal.timeout(120000) });
  if (!response.ok) await auth.parse(response);
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  let filename = disposition.match(/filename="([^"]+)"/i)?.[1] || fallback;
  if (encoded) { try { filename = decodeURIComponent(encoded); } catch {} }
  filename = safeFilename(filename);
  const type = filename.toLowerCase().endsWith('.docx') ? 'docx' : 'pdf';
  const choice = await dialog.showSaveDialog(win, { title: 'Save your document', defaultPath: filename, filters: [{ name: type.toUpperCase(), extensions: [type] }] });
  if (choice.canceled || !choice.filePath) { await response.body?.cancel(); return { cancelled: true }; }
  if (Number(response.headers.get('content-length')) > 50 * 1024 * 1024) throw new Error('Document exceeds the download limit.');
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length > 50 * 1024 * 1024) throw new Error('Document exceeds the download limit.');
  await fs.writeFile(choice.filePath, data);
  return { filename: path.basename(choice.filePath) };
}
function installHandlers() {
  handle('bootstrap', async () => ({ settings, shortcutError, job: runner.job, version: app.getVersion(), authenticated: Boolean(auth.access || auth.refresh) }));
  const routes = { login: '/auth/login', signup: '/auth/register/request-otp', verify: '/auth/register/verify', forgot: '/auth/forgot-password', reset: '/auth/reset-password' };
  handle('auth', async (_win, action, data) => {
    if (!routes[action] || !data || JSON.stringify(data).length > 20000) throw new Error('Invalid sign-in request.');
    const result = await auth.authenticate(routes[action], data);
    if (action === 'login') send({ type: 'session', signedIn: true });
    return result;
  });
  handle('logout', async () => {
    runner.cancel(); await runner.promise?.catch(() => {});
    try { if (auth.access) await auth.request('/auth/logout', { method: 'POST', signal: AbortSignal.timeout(5000) }); } catch {}
    await auth.clear(); runner.job = null; compact = false; position(); send({ type: 'session', signedIn: false }); return true;
  });
  handle('request', async (_win, route, method = 'GET', body) => {
    apiRequest(route, method);
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    if (serialized?.length > 1000000) throw new Error('This request is too large.');
    const result = await auth.request(route, { method, body: serialized, signal: AbortSignal.timeout(/answers|export/.test(route) ? 180000 : 30000) });
    if (method !== 'GET' && route !== '/applications/validate') send({ type: 'data-changed', route });
    return result;
  });
  handle('publicRequest', async (_win, route) => {
    if (route !== '/desktop/release') throw new Error('Unsupported public request.');
    return auth.parse(await auth.raw(route, { signal: AbortSignal.timeout(15000) }));
  });
  handle('upload', async (_win, route, file) => {
    if (!/^\/desktop\/manage\/releases\/[\w-]+\/files\/(setup|portable)$/.test(route) || !file || !/\.exe$/i.test(file.name) || !(file.bytes instanceof ArrayBuffer) || file.bytes.byteLength > 512 * 1024 * 1024) throw new Error('Choose a Windows executable up to 512 MB.');
    const form = new FormData(); form.append('file', new Blob([file.bytes], { type: 'application/octet-stream' }), safeFilename(file.name));
    return auth.request(route, { method: 'POST', body: form, signal: AbortSignal.timeout(15 * 60_000) });
  });
  handle('settings', saveSettings);
  handle('window', async (win, action) => {
    if (action === 'hide') win.hide();
    else if (action === 'close') { if (win === quickWindow) setImmediate(() => { if (!win.isDestroyed()) win.close(); }); else win.hide(); }
    else if (action === 'minimize') win.minimize();
    else if (action === 'maximize' && win === window) win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'new') await showQuick();
    else if (action === 'workspace') showWorkspace();
    else if (action === 'compact' || action === 'expand') { compact = action === 'compact'; position(); }
    else if (action === 'quit') { if (runner.active) throw new Error('Cancel generation before quitting.'); quitting = true; app.quit(); }
    else throw new Error('Unsupported window action.');
  });
  handle('openRoute', (_win, route) => {
    if (typeof route !== 'string' || !/^\/(dashboard|applications|profiles|templates|settings|users|job-pool|download)(?:[/?][\w/?=&%.-]*)?$/.test(route)) throw new Error('Unsupported page.');
    showWorkspace(route);
  });
  handle('external', async (_win, value) => {
    if (typeof value !== 'string' || value.length > 5000) throw new Error('Invalid link.');
    let address = value;
    if (/^(?:\/backend)?\/desktop\//.test(address)) address = settings.server + address.replace(/^\/backend/, '');
    const url = new URL(address);
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported link.');
    await shell.openExternal(url.toString());
  });
  handle('paste', () => clipboard.readText().slice(0, 100000));
  handle('copy', (_win, text) => { if (typeof text !== 'string' || text.length > 160000) throw new Error('Invalid text.'); clipboard.writeText(text); });
  handle('generate', (_win, input) => runner.start(input));
  handle('cancel', () => runner.cancel());
  handle('download', download);
  handle('export', async (win, id, type, kind = 'RESUME') => {
    if (!/^[\w-]{1,80}$/.test(id) || !['PDF', 'DOCX'].includes(type) || !['RESUME', 'COVER_LETTER'].includes(kind)) throw new Error('Invalid document.');
    const file = await auth.request(`/generations/${id}/export`, { method: 'POST', body: JSON.stringify({ kind, type }), signal: AbortSignal.timeout(120000) });
    return download(win, file.id, file.filename);
  });
  handle('ready', async win => {
    if (probePath && win === window) {
      await fs.mkdir(probePath, { recursive: true });
      await fs.writeFile(path.join(probePath, 'startup.json'), JSON.stringify({ mainToPaintMs: Date.now() - startedAt, launchToPaintMs: process.env.ANCHOR_LAUNCHER_STARTED_AT ? Date.now() - Number(process.env.ANCHOR_LAUNCHER_STARTED_AT) : null, extractionMs: Number(process.env.ANCHOR_EXTRACT_MS || 0) }));
      quitting = true; app.quit();
    }
  });
}
function makeWindow(quick) {
  const area = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({ ...(quick ? panelBounds(area) : { width: Math.min(1420, area.width - 48), height: Math.min(960, area.height - 48), minWidth: 860, minHeight: 600 }),
    show: false, frame: false, resizable: true, movable: true, ...(quick ? { minWidth: Math.min(420, area.width), minHeight: Math.min(320, area.height) } : {}), backgroundColor: '#0b1019', title: quick ? 'New application — AnchorProposal' : 'AnchorProposal', alwaysOnTop: quick && settings.alwaysOnTop, skipTaskbar: quick,
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true, backgroundThrottling: false, devTools: !app.isPackaged, offscreen: Boolean(smokePath || probePath) },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('close', event => { if (!quick && !quitting) { event.preventDefault(); win.hide(); } });
  if (quick) win.on('closed', () => { quickWindow = null; quickLoading = undefined; });
  return win;
}
async function boot() {
  app.setAppUserModelId('biz.anchorproposal.desktop'); settings = { ...defaults };
  let savedSettings;
  try { savedSettings = JSON.parse(await fs.readFile(settingsFile(), 'utf8')); settings = restoreSettings(savedSettings, defaults); } catch {}
  auth = new DesktopSession({ directory: app.getPath('userData'), secureStorage: safeStorage });
  await auth.load(DESKTOP_API_SERVER);
  if (savedSettings && savedSettings.server !== DESKTOP_API_SERVER) {
    // Credentials are bound to their original server; old local/custom sessions require a new sign-in.
    if (!auth.refresh) await auth.clear();
    await fs.writeFile(settingsFile(), JSON.stringify(settings));
  }
  const dist = path.resolve(__dirname, '../dist');
  protocol.handle('anchor', request => {
    const url = new URL(request.url);
    const name = decodeURIComponent(url.pathname).slice(1);
    if (url.host !== 'app' || !/^[a-zA-Z0-9_./-]+\.(?:html|js|css|woff2|png|webp|svg)$/.test(name) || name.split('/').includes('..')) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(dist, name)).toString());
  });
  electronSession.defaultSession.setPermissionRequestHandler((_, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
  electronSession.defaultSession.setPermissionCheckHandler((_, permission) => permission === 'clipboard-sanitized-write');
  window = makeWindow(false);
  runner = new GenerationRunner(auth, job => {
    send({ type: 'job', job });
    if (job.stage === 'connecting') { compact = true; position(); }
    if (job.stage === 'completed' && !job.finishedAt) { compact = false; position(); }
    if (['completed', 'failed'].includes(job.stage) && !job.finishedAt && settings.notifications && Notification.isSupported() && !smokePath && !probePath) {
      const notice = new Notification({ title: job.stage === 'completed' ? 'Your resume is ready' : 'Generation needs attention', body: job.title, silent: true });
      notice.on('click', () => void showQuick(true)); notice.show();
    }
  });
  installHandlers();
  try { registerShortcut(settings.hotkey); } catch (error) { shortcutError = error.message; }
  if (!probePath) {
    tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '../assets/tray.png')));
    tray.setToolTip('AnchorProposal');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'New application', click: () => void showQuick() }, { label: 'Open workspace', click: () => showWorkspace() }, { label: 'Quit', click: () => { if (runner.active) { void showQuick(); send({ type: 'notice', message: 'Cancel generation before quitting.' }); return; } quitting = true; app.quit(); } }]));
    tray.on('click', () => void showQuick()); tray.on('double-click', () => showWorkspace());
  }
  screen.on('display-metrics-changed', () => { if (quickWindow?.isVisible()) position(); });
  window.once('ready-to-show', () => { if (!smokePath && !probePath && !process.argv.includes('--background')) showWorkspace(); });
  await window.loadURL('anchor://app/index.html');
  if (smokePath) {
    await require('./smoke.cjs').run({ app, window, auth, settings, safeStorage, globalShortcut, directory: smokePath, showQuick, getQuickWindow: () => quickWindow, send });
    quitting = true; app.quit();
  }
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) void showQuick(); });
  app.on('activate', () => showWorkspace());
  app.on('before-quit', () => { quitting = true; runner?.cancel(); });
  app.on('will-quit', () => globalShortcut.unregisterAll());
  app.whenReady().then(boot).catch(async error => {
    if (smokePath || probePath) { await fs.mkdir(smokePath || probePath, { recursive: true }); await fs.writeFile(path.join(smokePath || probePath, 'error.txt'), error.stack || error.message); }
    else dialog.showErrorBox('AnchorProposal could not start', error.message);
    app.exit(1);
  });
}
