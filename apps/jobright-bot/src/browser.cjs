const fs = require('node:fs/promises'), path = require('node:path');
const { fromHtml, fromPayload, originalFrom, mergeCandidates } = require('./extract.cjs');
const { jobrightHost, jobrightOriginalUrl, jobrightAfterStart, jobrightLinkExclusion, jobrightPublicUrl } = require('@anchorproposal/shared');

class LoginRequired extends Error {}
class JobrightBrowser {
  constructor({ profile, executablePath, puppeteer, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    this.profile = profile; this.executablePath = executablePath; this.puppeteer = puppeteer; this.pause = pause; this.mode = 'closed'; this.pages = new Set();
    this.checked = new Map(); this.scanScope = '';
  }
  async open(visible) {
    if (this.browser?.isConnected() && this.mode === (visible ? 'visible' : 'hidden')) return;
    await this.close(); await fs.mkdir(this.profile, { recursive: true, mode: 0o700 });
    const env = { ...process.env };
    if (visible && process.platform === 'linux') {
      env.DISPLAY ||= ':0';
      const authority = path.join('/run/user', String(process.getuid()), 'gdm/Xauthority');
      if (!env.XAUTHORITY) try { await fs.access(authority); env.XAUTHORITY = authority; } catch { /* Use the desktop's normal display authentication. */ }
    }
    try { this.browser = await this.puppeteer.launch({ headless: !visible, userDataDir: this.profile, executablePath: this.executablePath || undefined, env,
      defaultViewport: { width: 1280, height: 900 }, timeout: 45000, protocolTimeout: 45000 }); }
    catch (error) { if (visible) throw new Error('Could not open Chrome on the Ubuntu desktop. Set DISPLAY and XAUTHORITY in the bot .env from your desktop terminal.'); throw error; }
    this.mode = visible ? 'visible' : 'hidden';
  }
  async close() { const browser = this.browser; this.browser = null; this.mode = 'closed'; this.loginPage = null; if (browser) await browser.close().catch(() => {}); }
  async login(url) { if (this.mode !== 'visible') this.checked.clear(); await this.open(true); if (!this.loginPage || this.loginPage.isClosed()) { this.loginPage = await this.browser.newPage(); await this.loginPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); } }
  async loginDetected() {
    if (!this.browser) return false;
    for (const page of await this.browser.pages()) {
      try { if (!jobrightHost(new URL(page.url()).hostname)) continue; if ((await page.evaluate(() => { try { return JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent || '{}').props?.pageProps?.logined; } catch { return false; } })) === true) return true; } catch { /* Navigation can replace a page while signing in. */ }
    }
    return false;
  }
  async read(url, focusId, { scrolls = 0, stop = () => false } = {}) {
    if (stop()) return { jobs: [] };
    const page = await this.browser.newPage(), rows = new Map(), pending = new Set(); let original = null;
    const response = response => {
      const address = new URL(response.url());
      if (!jobrightHost(address.hostname) || !/job/i.test(address.pathname) || !/application\/json/i.test(response.headers()['content-type'] || '') || Number(response.headers()['content-length'] || 0) > 5_000_000) return;
      const work = response.text().then(text => {
        if (text.length > 5_000_000) return;
        const data = JSON.parse(text); mergeCandidates(rows, fromPayload(data));
        if (focusId && address.href.includes(focusId)) original ||= originalFrom(data?.data) || originalFrom(data);
      }).catch(() => {}).finally(() => pending.delete(work)); pending.add(work);
    };
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.isInterceptResolutionHandled()) return;
      const url = new URL(request.url());
      if (['http:', 'https:'].includes(url.protocol) && (!jobrightPublicUrl(url.href) || (request.isNavigationRequest() && !jobrightHost(url.hostname)))) return void request.abort();
      void request.continue();
    });
    page.on('response', response);
    try {
      const result = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (result?.status() === 429) throw new LoginRequired('Jobright rate limited the browser. Pause and retry later.');
      const html = await page.content();
      const title = await page.title();
      if ([401, 403].includes(result?.status()) || /verify.*human|just a moment|access denied|security verification/i.test(title) || /\/onboarding-v3\/(?:signup|login)/.test(page.url())) throw new LoginRequired('Jobright requires sign-in or a browser check. Open login on Ubuntu to continue.');
      const initial = fromHtml(html); mergeCandidates(rows, initial.jobs);
      for (let step = 0; step < scrolls && !stop(); step++) {
        await page.evaluate(() => window.scrollBy(0, Math.max(innerHeight, 900))); await this.pause(1600);
      }
      await this.pause(focusId ? 1800 : 700); await Promise.allSettled([...pending]);
      mergeCandidates(rows, fromHtml(await page.content()).jobs);
      if (focusId) {
        const links = await page.$$eval('a[href]', anchors => anchors.filter(anchor => /^(?:apply(?: now)?|apply at source|view original job|apply on company site)$/i.test(anchor.textContent.trim())).map(anchor => anchor.href));
        const candidates = [...new Set(links.map(jobrightOriginalUrl).filter(Boolean))]; if (!original && candidates.length === 1) original = candidates[0];
        const job = rows.get(focusId); if (job && !job.originalUrl && original) job.originalUrl = original;
      }
      return { jobs: [...rows.values()], authenticated: initial.authenticated };
    } finally { page.off('response', response); await page.close().catch(() => {}); }
  }
  async scan(config, { seen = new Set(), stop = () => false, progress = async () => {}, submit = async () => [] } = {}) {
    const scope = JSON.stringify([config.startedAt, config.settings]);
    if (scope !== this.scanScope) { this.checked.clear(); this.scanScope = scope; }
    const remember = id => {
      this.checked.set(id, Date.now() + 3600000);
      if (this.checked.size > 20000) this.checked.delete(this.checked.keys().next().value);
    };
    await this.open(false); let scanned = 0, skipped = 0, submitted = 0, missingOriginal = 0, detailsRead = 0;
    for (const url of config.settings.searchUrls) {
      if (stop() || detailsRead >= config.settings.maxJobsPerScan) break;
      const listing = await this.read(url, null, { scrolls: 2, stop });
      for (const row of listing.jobs) {
        if (stop() || detailsRead >= config.settings.maxJobsPerScan) break;
        scanned++; await progress({ scanned, skipped });
        if (seen.has(row.externalId) || !jobrightAfterStart(row.publishedAt, config.startedAt) || ['HYBRID', 'ONSITE'].includes(row.workArrangement) ||
          (this.checked.get(row.externalId) || 0) > Date.now()) { skipped++; continue; }
        let job = row;
        if (row.originalUrl && jobrightLinkExclusion(row.originalUrl, config.settings)) { skipped++; continue; }
        // Read details without clicking Apply: a click can change Jobright's application history.
        detailsRead++; const detail = await this.read(row.sourceUrl, row.externalId, { stop });
        // Unavailable links and rejected details must not keep using every scan slot.
        // Recheck later, or immediately after login/settings changes, without inventing a new posting date.
        const merged = new Map([[row.externalId, row]]); mergeCandidates(merged, detail.jobs); job = merged.get(row.externalId);
        if (!jobrightAfterStart(job.publishedAt, config.startedAt) || !job.originalUrl || jobrightLinkExclusion(job.originalUrl, config.settings)) {
          remember(row.externalId); if (!job.originalUrl) missingOriginal++; skipped++; continue;
        }
        const results = await submit([job]); submitted++;
        if (!stop()) remember(row.externalId);
        for (const result of results) if (['imported', 'duplicate'].includes(result.status)) seen.add(result.externalId);
        await this.pause(1500);
      }
    }
    return { scanned, skipped, missingOriginal, submitted };
  }
}
module.exports = { JobrightBrowser, LoginRequired };
