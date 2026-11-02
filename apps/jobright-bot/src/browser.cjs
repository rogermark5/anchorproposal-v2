const fs = require('node:fs/promises'), path = require('node:path');
const { fromHtml, fromPayload, listingFromPayload, originalFrom, mergeCandidates } = require('./extract.cjs');
const { selectMostRecent, sortElement, SortUnavailable } = require('./sort.cjs');
const { formatError } = require('./diagnostics.cjs');
const { JOBRIGHT_JOBS_URL, jobrightHost, jobrightOriginalUrl, jobrightAfterStart, jobrightLinkExclusion, jobrightPublicUrl } = require('@anchorproposal/shared');

class LoginRequired extends Error {}
class BrowserFetchError extends Error { constructor(message, cause) { super(message, { cause }); this.name = 'BrowserFetchError'; this.safeMessage = message; } }
class JobrightBrowser {
  constructor({ profile, executablePath, puppeteer, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    this.profile = profile; this.executablePath = executablePath; this.puppeteer = puppeteer; this.pause = pause; this.mode = 'closed'; this.pages = new Set();
  }
  async open(visible) {
    if (this.browser?.isConnected()) { await this.setVisible(visible); return; }
    await this.close(); await fs.mkdir(this.profile, { recursive: true, mode: 0o700 });
    const env = { ...process.env };
    if (process.platform === 'linux') {
      env.DISPLAY ||= ':0';
      const authority = path.join('/run/user', String(process.getuid()), 'gdm/Xauthority');
      if (!env.XAUTHORITY) try { await fs.access(authority); env.XAUTHORITY = authority; } catch { /* Use the desktop's normal display authentication. */ }
    }
    try { this.browser = await this.puppeteer.launch({ headless: false, userDataDir: this.profile, executablePath: this.executablePath || undefined, env,
      args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', ...(!visible ? ['--start-minimized'] : [])],
      defaultViewport: { width: 1280, height: 900 }, timeout: 45000, protocolTimeout: 45000 }); }
    catch (error) { throw new BrowserFetchError('Could not open Chrome on the Ubuntu desktop. Check DISPLAY, XAUTHORITY and the installed Chrome executable in the worker .env.', error); }
    await this.setVisible(visible);
  }
  async listing() {
    if (!this.listingPage || this.listingPage.isClosed()) this.listingPage = await this.browser.newPage();
    return this.listingPage;
  }
  async setVisible(visible) {
    if (this.mode === (visible ? 'visible' : 'hidden') && this.listingPage && !this.listingPage.isClosed()) return;
    const page = await this.listing(), session = await page.target().createCDPSession();
    try {
      const { windowId } = await session.send('Browser.getWindowForTarget');
      await session.send('Browser.setWindowBounds', { windowId, bounds: { windowState: visible ? 'normal' : 'minimized' } });
      if (visible) await page.bringToFront();
      this.mode = visible ? 'visible' : 'hidden';
    } catch (error) { throw new BrowserFetchError('Chrome could not show or minimize its Ubuntu window. Check the Ubuntu desktop session and DISPLAY/XAUTHORITY.', error); }
    finally { await session.detach().catch(() => {}); }
  }
  async close() {
    if (this.closing) return this.closing;
    const browser = this.browser; this.browser = null; this.mode = 'closed'; this.listingPage = null;
    this.closing = browser ? browser.close().catch(() => {}) : Promise.resolve();
    try { await this.closing; } finally { this.closing = null; }
  }
  async show() {
    await this.open(true); const page = await this.listing();
    if (page.url() === 'about:blank' || !jobrightHost(new URL(page.url()).hostname)) {
      await page.goto(JOBRIGHT_JOBS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
  }
  async hide() { if (this.browser?.isConnected()) await this.setVisible(false); }
  async login() { await this.show(); }
  async loginDetected() {
    if (!this.browser) return false;
    for (const page of await this.browser.pages()) {
      try { if (!jobrightHost(new URL(page.url()).hostname)) continue; if ((await page.evaluate(() => { try { return JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent || '{}').props?.pageProps?.logined; } catch { return false; } })) === true) return true; } catch { /* Navigation can replace a page while signing in. */ }
    }
    return false;
  }
  async read(url, focusId, { scrolls = 0, stop = () => false, sortTimeoutMs = 15000, cutoff = null } = {}) {
    if (stop()) return { jobs: [] };
    const page = focusId ? await this.browser.newPage() : await this.listing(), rows = new Map(), pending = new Set(), inflight = new Set(), requestEpoch = new WeakMap();
    let original = null, epoch = 0, collect = !!focusId, freshList = false, listingError = null, captureOriginal = false, complete = false, lastPageCount = null;
    const response = response => {
      const address = new URL(response.url());
      if (!jobrightHost(address.hostname) || !/job/i.test(address.pathname) || !/application\/json/i.test(response.headers()['content-type'] || '') || Number(response.headers()['content-length'] || 0) > 5_000_000) return;
      const receipt = requestEpoch.get(response.request());
      if (!receipt?.collect || receipt.epoch !== epoch) return;
      if (!response.ok()) {
        listingError = [401, 403, 429].includes(response.status()) ? new LoginRequired('Jobright requires sign-in, a browser check or a rate-limit pause. Show the browser to check the page.') :
          new BrowserFetchError('Jobright returned HTTP ' + response.status() + '. The scan will retry without advancing its checkpoint.'); return;
      }
      const work = response.text().then(text => {
        if (text.length > 5_000_000 || receipt.epoch !== epoch) return;
        const data = JSON.parse(text), jobs = focusId ? fromPayload(data, focusId) : listingFromPayload(data);
        if (jobs === null) return;
        mergeCandidates(rows, jobs); if (!focusId) { freshList = true; lastPageCount = jobs.length; }
        if (focusId && address.href.includes(focusId)) original ||= originalFrom(data?.data) || originalFrom(data);
      }).catch(() => { if (receipt.epoch === epoch) listingError = new BrowserFetchError('Jobright returned an unreadable job response. The scan will retry without advancing its checkpoint.'); }).finally(() => pending.delete(work)); pending.add(work);
    };
    await page.setRequestInterception(true);
    const request = request => {
      requestEpoch.set(request, { epoch, collect });
      const url = new URL(request.url());
      if (collect && jobrightHost(url.hostname) && /job/i.test(url.pathname) && ['xhr', 'fetch'].includes(request.resourceType())) inflight.add(request);
      if (captureOriginal && request.isNavigationRequest()) original ||= jobrightOriginalUrl(url.href);
      if (request.isInterceptResolutionHandled()) return;
      if (['http:', 'https:'].includes(url.protocol) && (!jobrightPublicUrl(url.href) || (request.isNavigationRequest() && !jobrightHost(url.hostname)))) return request.abort().catch(() => {});
      return request.continue({}, 0).catch(() => {});
    };
    page.on('request', request);
    page.on('response', response);
    const finished = request => inflight.delete(request);
    const failedRequest = request => {
      if (inflight.has(request) && requestEpoch.get(request)?.epoch === epoch) listingError = new BrowserFetchError('A Jobright job request failed. The scan will retry without advancing its checkpoint.');
      inflight.delete(request);
    };
    page.on('requestfinished', finished); page.on('requestfailed', failedRequest);
    const settle = async () => {
      const until = Date.now() + sortTimeoutMs;
      while ([...inflight].some(request => requestEpoch.get(request)?.epoch === epoch) && !stop() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100));
      if ([...inflight].some(request => requestEpoch.get(request)?.epoch === epoch) && !stop()) throw new BrowserFetchError('A Jobright job request timed out. The saved checkpoint was kept.');
      await Promise.allSettled([...pending]); if (listingError) throw listingError;
    };
    const popup = target => {
      if (!captureOriginal || target.opener() !== page.target()) return;
      const value = jobrightOriginalUrl(target.url());
      if (value) { original ||= value; void target.page().then(tab => tab?.close()).catch(() => {}); }
    };
    this.browser.on('targetcreated', popup); this.browser.on('targetchanged', popup);
    try {
      let result;
      if (focusId || page.url() !== url) {
        try { result = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
        catch (error) { throw new BrowserFetchError('Jobright page could not load (' + (error.name === 'TimeoutError' ? 'navigation timed out' : 'browser connection failed') + '). The scan will retry without advancing its checkpoint.', error); }
      }
      if (result?.status() === 429) throw new LoginRequired('Jobright rate limited the browser. Pause and retry later.');
      if (focusId && [404, 410].includes(result?.status())) return { jobs: [], unavailable: true };
      if (result && result.status() >= 500) throw new BrowserFetchError('Jobright returned HTTP ' + result.status() + '. The scan will retry without advancing its checkpoint.');
      const html = await page.content();
      const title = await page.title();
      if ([401, 403].includes(result?.status()) || /verify.*human|just a moment|access denied|security verification/i.test(title) || /\/onboarding-v3\/(?:signup|login)/.test(page.url())) throw new LoginRequired('Jobright requires sign-in or a browser check. Open login on Ubuntu to continue.');
      const initial = fromHtml(html, focusId);
      if (focusId) mergeCandidates(rows, initial.jobs);
      else {
        try {
          const verified = await selectMostRecent(page, { timeoutMs: sortTimeoutMs, stop, beforeSelect: label => {
            epoch++; collect = label === 'Most Recent'; rows.clear(); freshList = false; listingError = null; lastPageCount = null;
          } });
          if (stop()) return { jobs: [] };
          if (!verified) throw new SortUnavailable('Jobright Most Recent was not selected. Open login and check the jobs sort dropdown.');
        } catch (error) { if (stop()) return { jobs: [] }; if (error instanceof SortUnavailable) throw new LoginRequired(error.message); throw error; }
        const until = Date.now() + sortTimeoutMs;
        while (!freshList && !listingError && !stop() && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100));
        if (stop()) return { jobs: [] };
        if (listingError) throw listingError;
        if (!freshList) throw new LoginRequired('Jobright Most Recent did not return a fresh job list. Show the browser and check the jobs page.');
      }
      let unchanged = 0;
      const reachedCutoff = () => !!cutoff && [...rows.values()].some(row => row.publishedAt && Date.parse(row.publishedAt) < Date.parse(cutoff));
      for (let step = 0; step < scrolls && !stop(); step++) {
        if (reachedCutoff() || !rows.size) { complete = true; break; }
        const before = rows.size;
        await page.evaluate(() => {
          const list = document.querySelector('[class*="jobs-list-scrollable"]');
          if (list && list.scrollHeight > list.clientHeight) list.scrollBy(0, Math.max(list.clientHeight, 900));
          else window.scrollBy(0, Math.max(innerHeight, 900));
        }); await this.pause(1600); await settle();
        unchanged = rows.size === before ? unchanged + 1 : 0;
        // Short final pages or an older source timestamp confirm the boundary.
        // A full page that failed to scroll must never move the cursor past unseen jobs.
        if (unchanged >= 2) { complete = lastPageCount !== null && lastPageCount < 10; break; }
      }
      await this.pause(focusId ? 1800 : 700); await settle();
      if (focusId) {
        const until = Date.now() + 10000;
        do {
          mergeCandidates(rows, fromHtml(await page.content(), focusId).jobs);
          const detail = rows.get(focusId);
          if (detail?.description && detail.company && detail.publishedAt) break;
          if (stop() || Date.now() >= until) break;
          await new Promise(resolve => setTimeout(resolve, 250));
        } while (true);
      }
      else if (!await page.evaluate(sortElement, 'selected', 'Most Recent')) throw new LoginRequired('Jobright changed its sort while scanning. Show the browser and select Most Recent.');
      if (focusId) {
        const links = await page.$$eval('a[href]', anchors => anchors.filter(anchor => /^(?:original job post|apply(?: now)?|apply at source|view original job|apply on company site)$/i.test(anchor.textContent.trim())).map(anchor => anchor.href));
        const candidates = [...new Set(links.map(jobrightOriginalUrl).filter(Boolean))]; if (!original && candidates.length === 1) original = candidates[0];
        // Original Job Post is safe to open; Apply can alter Jobright application history.
        if (!original && !stop()) {
          const handle = await page.evaluateHandle(() => [...document.querySelectorAll('button,a,[role="button"]')].find(el => /^original job post$/i.test(el.textContent.trim())) || null);
          if (handle.asElement()) {
            // Capture a normal window.open link without fetching the employer site.
            await page.evaluate(() => {
              window.__anchorOriginalPostCapture = { open: window.open, url: null };
              window.open = url => { window.__anchorOriginalPostCapture.url = String(url || ''); return null; };
            });
            try {
              captureOriginal = true; await handle.asElement().click();
              const until = Date.now() + 6000;
              while (!original && !stop() && Date.now() < until) {
                const value = await page.evaluate(() => window.__anchorOriginalPostCapture?.url).catch(() => null);
                original ||= jobrightOriginalUrl(value);
                if (!original) await new Promise(resolve => setTimeout(resolve, 100));
              }
            } finally {
              captureOriginal = false;
              await page.evaluate(() => { if (window.__anchorOriginalPostCapture) { window.open = window.__anchorOriginalPostCapture.open; delete window.__anchorOriginalPostCapture; } }).catch(() => {});
            }
          }
          await handle.dispose();
        }
        const job = rows.get(focusId); if (job && !job.originalUrl && original) job.originalUrl = original;
      }
      const jobs = [...rows.values()]; if (!focusId) jobs.sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
      return { jobs, authenticated: initial.authenticated, ...(!focusId ? { sort: 'most-recent', complete: complete || reachedCutoff() || !rows.size } : {}) };
    } finally {
      page.off('response', response); page.off('request', request); this.browser.off('targetcreated', popup); this.browser.off('targetchanged', popup);
      page.off('requestfinished', finished); page.off('requestfailed', failedRequest);
      await page.setRequestInterception(false).catch(() => {});
      if (focusId) await page.close().catch(() => {});
    }
  }
  async scan(config, { seen = new Set(), checkpoint = config.checkpoint, stop = () => false, progress = async () => {},
    processed = async () => {}, submit = async () => [] } = {}) {
    let scanned = 0, skipped = 0, submitted = 0, missingOriginal = 0, detailsRead = 0, failed = 0, lastError = null;
    if (stop()) return { scanned, skipped, submitted, checkpoint: null };
    await this.open(false);
    const cutoff = checkpoint?.publishedAt || config.startedAt;
    const listing = await this.read(JOBRIGHT_JOBS_URL, null, { scrolls: 20, cutoff, stop });
    const eligible = listing.jobs.filter(row => jobrightAfterStart(row.publishedAt, config.startedAt) &&
      (!checkpoint || Date.parse(row.publishedAt) >= Date.parse(checkpoint.publishedAt)));
    const mark = async row => { if (stop()) return; seen.add(row.externalId); await processed(row.externalId); };
    for (const row of eligible) {
      if (stop()) break;
      if (seen.has(row.externalId) || row.externalId === checkpoint?.externalId) continue;
      if (detailsRead >= config.settings.maxJobsPerScan) break;
      scanned++; await progress({ scanned, skipped });
      if (['HYBRID', 'ONSITE'].includes(row.workArrangement) || row.originalUrl && jobrightLinkExclusion(row.originalUrl, config.settings)) { skipped++; await mark(row); continue; }
      detailsRead++; let detail;
      try { detail = await this.read(row.sourceUrl, row.externalId, { stop }); }
      catch (error) {
        console.error(formatError(error, 'Jobright detail ' + row.externalId));
        if (error instanceof LoginRequired) throw error;
        if (stop()) break;
        failed++; lastError = error instanceof BrowserFetchError ? error.message : 'A Jobright detail page could not be read. It will be retried without advancing the checkpoint.'; continue;
      }
      if (stop()) break;
      if (detail.unavailable) { skipped++; await mark(row); continue; }
      // Details are authoritative. Never save the listing summary when a detail fetch failed.
      const job = detail.jobs.find(job => job.externalId === row.externalId);
      if (!job?.title || !job.company || !job.description || !job.publishedAt) {
        failed++; lastError = 'Jobright did not return complete job details. Those jobs will be retried; the checkpoint was kept.'; continue;
      }
      if (!jobrightAfterStart(job.publishedAt, config.startedAt) || !job.originalUrl || jobrightLinkExclusion(job.originalUrl, config.settings)) {
        if (!job.originalUrl) missingOriginal++; skipped++; await mark(row); continue;
      }
      const results = await submit([job]);
      if (!Array.isArray(results) || !results.some(result => result.externalId === row.externalId && ['imported', 'duplicate', 'skipped'].includes(result.status))) throw new BrowserFetchError('AnchorProposal did not acknowledge the job. It will be retried without advancing the checkpoint.');
      submitted++; await mark(row); await this.pause(1500);
    }
    const finished = !stop() && listing.complete && !failed && eligible.every(row => seen.has(row.externalId) || row.externalId === checkpoint?.externalId);
    if (!listing.complete && !lastError) lastError = 'Jobright has not confirmed the previous job boundary. Loaded new jobs were processed; the saved checkpoint was kept for the next scan.';
    const latest = [...eligible].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))[0];
    const nextCheckpoint = finished && latest ? Object.fromEntries(['externalId', 'sourceUrl', 'publishedAt', 'title', 'company'].map(key => [key, latest[key]])) : null;
    return { scanned, skipped, missingOriginal, submitted, failed, lastError, checkpoint: nextCheckpoint };
  }
}
module.exports = { JobrightBrowser, LoginRequired, BrowserFetchError };
