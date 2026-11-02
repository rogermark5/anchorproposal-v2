const fs = require('node:fs/promises'), path = require('node:path'), { randomUUID } = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), override: true });
const { BotApi } = require('./api.cjs'), { JobrightBrowser, LoginRequired } = require('./browser.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const root = path.resolve(__dirname, '../.data'); await fs.mkdir(root, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await fs.chmod(root, 0o700);
  const api = new BotApi(process.env.JOBRIGHT_API_URL || 'http://127.0.0.1:3001', process.env.JOBRIGHT_WORKER_KEY);
  const browser = new JobrightBrowser({ profile: path.join(root, 'chrome-profile'), executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, puppeteer: require('puppeteer') });
  const instanceId = randomUUID(), seenFile = path.join(root, 'seen.json');
  let config, configAt = 0, stopping = false, refreshing = false, fatal = null, state = 'starting', authenticated = false;
  let runId = null, scanned = 0, skipped = 0, seen = new Set(), lastScan = 0, needsLogin = false, finishAttempted = false, errorText = null;
  async function heartbeat(extra = {}) {
    if (!config) return;
    const result = await api.call('/heartbeat', { instanceId, runId, status: state, browserMode: browser.mode,
      authenticated, scanned, skipped, error: errorText, ...extra });
    if (config && result.runId === config.runId) config.desired = result.desired;
  }
  async function refresh() {
    if (refreshing || stopping) return; refreshing = true;
    try {
      config = await api.call('?instanceId=' + encodeURIComponent(instanceId)); configAt = Date.now();
      if (config.authenticated && !needsLogin) authenticated = true;
      if (config.runId !== runId) {
        runId = config.runId; scanned = 0; skipped = 0; seen = new Set(); lastScan = 0;
        try { const saved = JSON.parse(await fs.readFile(seenFile, 'utf8')); if (saved.runId === runId) seen = new Set(saved.ids.slice(-20000)); } catch { /* A new run has no receipts yet. */ }
      }
    } catch (error) { if (error.status === 401) fatal = error; if (error.status === 409) config = undefined; errorText = error.message; }
    finally { refreshing = false; }
  }
  const saveSeen = async () => {
    await fs.writeFile(seenFile + '.new', JSON.stringify({ runId, ids: [...seen].slice(-20000) }), { mode: 0o600 });
    await fs.rename(seenFile + '.new', seenFile);
  };
  const shutdown = () => { stopping = true; void browser.close(); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
  let poll, beats;
  try {
    await refresh(); if (fatal) throw fatal;
    poll = setInterval(() => void refresh(), 5000);
    beats = setInterval(() => { void heartbeat().catch(error => { errorText = error.message; if (error.status === 401) fatal = error; if (error.status === 409) config = undefined; }); }, 10000);
    console.log('Jobright worker started. Manage its connection from Job pool > Jobright bot.');
    while (!stopping && !fatal) {
      if (!config || Date.now() - configAt > 45000) { state = 'error'; await browser.close(); await pause(1000); continue; }
      try {
        if (config.desired === 'login') {
          state = 'login_required'; await browser.login(config.settings.searchUrls[0]);
          if (!config.loginFinishRequested) finishAttempted = false;
          // Automatic detection is preferred. Explicit completion handles Jobright SPA sign-ins.
          if (await browser.loginDetected() || (config.loginFinishRequested && !finishAttempted)) {
            finishAttempted = true; authenticated = true; needsLogin = false; errorText = null;
            await browser.close(); state = 'ready'; await heartbeat({ loginCompleted: true }); await refresh();
          }
        } else if (config.desired === 'stopped') {
          await browser.close(); state = authenticated || config.authenticated ? 'ready' : 'stopped'; errorText = null;
        } else if (needsLogin || (!authenticated && !config.authenticated)) {
          state = 'login_required'; errorText = 'Open login, sign in on Ubuntu, then finish login to continue hidden.';
          await browser.close();
        } else if (Date.now() - lastScan >= config.settings.intervalMinutes * 60000) {
          authenticated = true; state = 'scanning'; errorText = null;
          const snapshot = config, snapshotRun = runId, scannedBefore = scanned, skippedBefore = skipped;
          const stop = () => stopping || !!fatal || !config || config.desired !== 'running' || runId !== snapshotRun || Date.now() - configAt > 45000;
          const result = await browser.scan(snapshot, { seen, stop,
            progress: async progress => { if (runId === snapshotRun) { scanned = scannedBefore + progress.scanned; skipped = skippedBefore + progress.skipped; } },
            submit: async jobs => {
              if (stop()) return [];
              const response = await api.call('/jobs', { instanceId, runId: snapshotRun, jobs });
              if (runId === snapshotRun) {
                for (const row of response.results) if (['imported', 'duplicate'].includes(row.status)) seen.add(row.externalId);
                await saveSeen();
              }
              return response.results;
            } });
          if (runId === snapshotRun) { scanned = scannedBefore + result.scanned; skipped = skippedBefore + result.skipped; lastScan = Date.now(); }
          state = 'watching';
          if (result.missingOriginal) errorText = `${result.missingOriginal} jobs had no readable original application link and were skipped. Reopen login if the session expired.`;
          await heartbeat({ scanCompleted: !stop() });
        }
      } catch (error) {
        if (stopping) break;
        if (error instanceof LoginRequired) { needsLogin = true; authenticated = false; state = 'blocked'; errorText = error.message; await browser.close(); }
        else if (error.status === 401 || error.status === 409) { await refresh(); state = 'error'; errorText = error.message; }
        else { state = 'error'; errorText = 'Browser scan failed. Check the Ubuntu worker logs and reopen login if needed.'; console.error('Jobright browser scan failed:', error.name || 'Error'); await browser.close(); lastScan = Date.now(); }
        await heartbeat().catch(() => {});
      }
      await pause(800);
    }
    if (fatal) throw fatal;
  } finally {
    clearInterval(poll); clearInterval(beats); process.off('SIGTERM', shutdown); process.off('SIGINT', shutdown);
    await browser.close(); state = 'stopped'; await heartbeat({ release: true }).catch(() => {});
  }
}
if (require.main === module) run().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
