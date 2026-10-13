const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

(async () => {
  const origin = process.env.QA_WEB_URL || 'http://127.0.0.1:3100';
  const artifacts = path.resolve(__dirname, '../../../tmp/public-resume-ui');
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, pipe: true, timeout: 120000, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let status = 200, invalidJson = false, offline = false, reads = 0;
  const failures = [];
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(30000);
    await page.setViewport({ width: 1200, height: 900 });
    // Even a visitor with a stale cookie must not need a login session to view a link.
    await page.setCookie({ name: 'qa-session', value: 'stale-session', url: origin });
    await page.setRequestInterception(true);
    page.on('pageerror', error => failures.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/backend/public/resumes/')) {
        reads++;
        if (request.headers().authorization || request.headers().cookie) failures.push('Public API request included session credentials');
        if (offline) return void request.abort('connectionfailed');
        return void request.respond({ status, contentType: 'application/json', body: invalidJson ? 'Not JSON' : JSON.stringify(status === 200
          ? { html: '<html><body><div class="page"><h1>Public Resume QA</h1><p>Shared resume shown without signing in.</p></div></body></html>', pageSize: 'LETTER' }
          : { message: status === 404 ? 'Resume link is invalid or expired' : 'Server error' }) });
      }
      if (url.pathname.startsWith('/backend/')) { failures.push('Unexpected authenticated API request: ' + url.pathname); return void request.abort(); }
      if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return void request.continue();
      return void request.abort();
    });
    const visit = () => page.goto(`${origin}/resume/qa-public-link`, { waitUntil: 'networkidle2' });
    await visit(); await page.waitForSelector('iframe');
    assert.ok((await page.$eval('iframe', frame => frame.srcdoc)).includes('Public Resume QA'));
    assert.equal(await page.evaluate(() => localStorage.getItem('accessToken')), null);
    await page.screenshot({ path: path.join(artifacts, 'anonymous-resume.png'), fullPage: true });
    await page.evaluate(() => { localStorage.setItem('accessToken', 'expired-access'); localStorage.setItem('refreshToken', 'expired-refresh'); });
    await visit(); await page.waitForSelector('iframe');
    assert.ok(page.url().includes('/resume/'));
    assert.equal(await page.evaluate(() => localStorage.getItem('refreshToken')), 'expired-refresh');
    for (status of [401, 403, 500, 502]) {
      await visit(); await page.waitForSelector('[role="alert"]');
      const message = await page.$eval('[role="alert"]', el => el.textContent);
      assert.match(message, /could not load/); assert.doesNotMatch(message, /expired/);
      status = 200; const before = reads;
      await page.click('main button'); await page.waitForSelector('iframe');
      assert.equal(reads, before + 1); assert.equal(await page.$('[role="alert"]'), null);
    }
    for (status of [404, 410]) {
      await visit(); await page.waitForSelector('[role="alert"]');
      assert.match(await page.$eval('[role="alert"]', el => el.textContent), /unavailable or expired/);
    }
    status = 200; invalidJson = true; await visit(); await page.waitForSelector('[role="alert"]');
    assert.match(await page.$eval('[role="alert"]', el => el.textContent), /could not load/);
    invalidJson = false; offline = true; await visit(); await page.waitForSelector('[role="alert"]');
    assert.match(await page.$eval('[role="alert"]', el => el.textContent), /could not load/);
    offline = false; await page.click('main button'); await page.waitForSelector('iframe');
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(artifacts, 'anonymous-resume-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(failures, []);
    console.log('PASS anonymous resume view, no session credentials, error classification, retry recovery, invalid JSON, offline recovery, and mobile layout.');
    console.log(`Screenshots: ${artifacts}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
