const fs = require('node:fs/promises'), path = require('node:path'), { randomUUID } = require('node:crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), override: true });
const { BotApi } = require('./api.cjs'), { JobrightBrowser, LoginRequired } = require('./browser.cjs');
const { ProgressStore } = require('./progress.cjs');
const { formatError } = require('./diagnostics.cjs');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const root = path.resolve(__dirname, '../.data'); await fs.mkdir(root, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await fs.chmod(root, 0o700);
  const api = new BotApi(process.env.JOBRIGHT_API_URL || 'http://127.0.0.1:3001', process.env.JOBRIGHT_WORKER_KEY);
  const browser = new JobrightBrowser({ profile: path.join(root, 'chrome-profile'), executablePath: process.env.PUPPETEER_EXECUTABLE_PATH, puppeteer: require('puppeteer') });
  const instanceId = randomUUID(), store = new ProgressStore(path.join(root, 'seen.json'));
  let config, configAt = 0, stopping = false, refreshing = false, fatal = null, state = 'starting', authenticated = false;
  let runId = null, scanned = 0, skipped = 0, lastScan = 0, needsLogin = false, errorText = null, connectionError = null, beating = false;
  async function heartbeat(extra = {}) {
    if (!config) return;
    const result = await api.call('/heartbeat', { instanceId, runId, status: state, browserMode: browser.mode,
      authenticated, scanned, skipped, error: connectionError || errorText, ...extra });
    if (config && result.runId === config.runId) {
      if (config.browserVisible && !result.browserVisible) lastScan = 0;
      config.desired = result.desired; config.browserVisible = result.browserVisible;
    }
  }
  async function refresh() {
    if (refreshing || stopping) return; refreshing = true;
    try {
      const next = await api.call('?instanceId=' + encodeURIComponent(instanceId));
      if (config?.browserVisible && !next.browserVisible) lastScan = 0;
      config = next; configAt = Date.now(); connectionError = null;
      if (config.authenticated && !needsLogin) authenticated = true;
      if (config.runId !== runId) {
        runId = config.runId; scanned = 0; skipped = 0; lastScan = 0;
      }
      await store.load(runId, config.checkpoint);
    } catch (error) { if (error.status === 401) fatal = error; if (error.status === 409) config = undefined; connectionError = error.safeMessage || 'Worker configuration could not be refreshed. Check the worker logs.'; console.error(formatError(error, 'Worker configuration')); }
    finally { refreshing = false; }
  }
  const shutdown = () => { stopping = true; void browser.close(); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
  let poll, beats;
  try {
    await refresh(); if (fatal) throw fatal;
    poll = setInterval(() => void refresh(), 5000);
    beats = setInterval(() => {
      if (beating) return; beating = true;
      void heartbeat().catch(error => { connectionError = error.safeMessage || 'Worker heartbeat failed. Check the worker logs.'; console.error(formatError(error, 'Worker heartbeat')); if (error.status === 401) fatal = error; if (error.status === 409) config = undefined; })
        .finally(() => { beating = false; });
    }, 10000);
    console.log('Jobright worker started. Manage its connection from Job pool > Jobright bot.');
    while (!stopping && !fatal) {
      if (!config || Date.now() - configAt > 45000) { state = 'error'; await pause(1000); continue; }
      try {
        if (config.browserVisible) {
          state = 'browser_open';
          if (browser.mode !== 'visible') await browser.show();
          if (await browser.loginDetected()) { authenticated = true; needsLogin = false; }
        } else if (config.loginFinishRequested) {
          // Hide/Finish is explicit confirmation for sessions whose SPA does not expose login state.
          authenticated = true; needsLogin = false; errorText = null;
          await browser.hide(); state = 'ready'; await heartbeat({ loginCompleted: true }); await refresh(); lastScan = 0;
        } else if (config.desired === 'login') {
          state = 'login_required'; errorText ||= 'Show the browser on Ubuntu, sign in, then hide it to continue.';
        } else if (config.desired === 'stopped') {
          await browser.hide(); state = authenticated || config.authenticated ? 'ready' : 'stopped'; errorText = null;
        } else if (needsLogin || (!authenticated && !config.authenticated)) {
          state = 'login_required'; errorText ||= 'Open login, sign in on Ubuntu, then finish login to continue hidden.';
          await browser.hide();
        } else if (Date.now() - lastScan >= config.settings.intervalMinutes * 60000) {
          authenticated = true; state = 'scanning'; errorText = null;
          const snapshot = config, snapshotRun = runId, scannedBefore = scanned, skippedBefore = skipped;
          const stop = () => stopping || !!fatal || !config || config.browserVisible || config.desired !== 'running' || runId !== snapshotRun || Date.now() - configAt > 45000;
          const result = await browser.scan(snapshot, { seen: store.ids, checkpoint: store.checkpoint, stop,
            progress: async progress => { if (runId === snapshotRun) { scanned = scannedBefore + progress.scanned; skipped = skippedBefore + progress.skipped; } },
            processed: id => store.record(id, snapshotRun),
            submit: async jobs => {
              if (stop()) return [];
              const response = await api.call('/jobs', { instanceId, runId: snapshotRun, jobs });
              return response.results;
            } });
          if (runId === snapshotRun) { scanned = scannedBefore + result.scanned; skipped = skippedBefore + result.skipped; lastScan = Date.now(); }
          state = result.failed ? 'error' : 'watching'; errorText = result.lastError || null;
          if (!errorText && result.missingOriginal) errorText = `${result.missingOriginal} jobs had no readable original job link on their detail pages and were skipped.`;
          await heartbeat({ scanCompleted: !stop(), ...(!stop() && result.checkpoint ? { checkpoint: result.checkpoint } : {}) });
          if (!stop()) await store.advance(result.checkpoint, snapshotRun);
        }
      } catch (error) {
        if (stopping) break;
        console.error(formatError(error, 'Jobright scan'));
        if (error instanceof LoginRequired) { needsLogin = true; authenticated = false; state = 'blocked'; errorText = error.message; await browser.hide().catch(() => {}); }
        else if (error.status === 401 || error.status === 409) { await refresh(); state = 'error'; errorText = error.message; }
        else { state = 'error'; errorText = error.safeMessage || 'The Jobright scan failed. Check the Ubuntu worker logs. The saved checkpoint was kept and the scan will retry.'; lastScan = Date.now(); }
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
if (require.main === module) run().catch(error => { console.error(formatError(error, 'Worker startup/shutdown')); process.exitCode = 1; });
module.exports = { run };
