// Production UI with intercepted APIs. No live account or Jobright data changes.
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), puppeteer = require('puppeteer');
(async () => {
  const origin = process.env.QA_WEB_URL || 'http://127.0.0.1:3198', folder = path.resolve('../../tmp/jobright-qa/ui'); await fs.mkdir(folder, { recursive: true });
  const browser = await puppeteer.launch({ headless: 'shell', pipe: true, timeout: 120000, protocolTimeout: 120000 }); const page = await browser.newPage(); page.setDefaultTimeout(30000);
  const errors = [], writes = []; let role = 'MASTER'; page.on('pageerror', error => errors.push(error.message));
  const settings = { blockedDomains: [], blockedWords: [], intervalMinutes: 5, maxJobsPerScan: 40 };
  const status = { settings, desired: 'stopped', runId: null, startedAt: null, authenticated: false, keyConfigured: false, connected: true, workerStatus: 'ready', browserMode: 'closed',
    heartbeatAt: new Date().toISOString(), lastScanAt: null, lastError: null, loginFinishRequested: false, browserVisible: false, checkpoint: null, counts: { scanned: 0, imported: 0, duplicates: 0, skipped: 0 }, recent: [] };
  const key = 'jrbot_' + 'a'.repeat(64); let watchStart;
  await page.evaluateOnNewDocument(() => { localStorage.setItem('accessToken', 'qa'); localStorage.setItem('refreshToken', 'qa-refresh'); });
  await page.setRequestInterception(true); page.on('request', request => {
    const url = new URL(request.url()); if (!url.pathname.startsWith('/backend/')) return void request.continue(); const route = url.pathname.slice(8); let data = {};
    if (route === '/auth/me') data = { id: role.toLowerCase(), role, firstName: 'QA', lastName: role, email: 'qa@qa.invalid' };
    else if (route === '/settings/time-zone') data = { timeZone: 'America/Los_Angeles' };
    else if (route === '/profiles') data = [];
    else if (route === '/job-pool') data = { jobs: [], total: 0, nextCursor: null, sites: [], asOf: new Date().toISOString() };
    else if (route === '/job-pool/updates') data = { total: 0, newCount: 0 };
    else if (route === '/job-pool/manage') data = { settings: { enabled: false, intervalHours: 6, excludedTitleKeywords: ['staff', 'principal'] }, providers: [], sources: [], coverage: [] };
    else if (route === '/job-pool/jobright-bot/key') { status.keyConfigured = true; data = { key, status }; }
    else if (route === '/job-pool/jobright-bot/command') {
      const action = JSON.parse(request.postData()).action; writes.push(action);
      if (action === 'start') { status.desired = 'running'; status.startedAt = watchStart = new Date().toISOString(); status.runId = 'watch'; }
      if (action === 'stop') status.desired = 'stopped';
      if (action === 'show-browser') { status.browserVisible = true; status.browserMode = 'visible'; }
      if (action === 'hide-browser') { status.browserVisible = false; status.browserMode = 'hidden'; }
      if (action === 'login') { status.desired = 'login'; status.browserVisible = true; status.browserMode = 'visible'; }
      if (action === 'finish-login') { status.desired = 'running'; status.authenticated = true; status.browserVisible = false; status.browserMode = 'hidden'; }
      data = status;
    } else if (route === '/job-pool/jobright-bot') {
      if (request.method() === 'PATCH') { Object.assign(settings, JSON.parse(request.postData())); writes.push({ ...settings }); } data = status;
    }
    void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const wait = text => page.waitForFunction(value => document.body.innerText.includes(value), {}, text);
  const click = text => page.evaluate(value => { const button = [...document.querySelectorAll('button,summary')].find(el => el.textContent.trim() === value); if (!button) throw Error('Missing ' + value); button.click(); }, text);
  const replace = async (label, value) => { const input = '[aria-label="' + label + '"]'; await page.click(input); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.type(input, value); };
  try {
    await page.setViewport({ width: 1440, height: 1000 }); await page.goto(origin + '/job-pool', { waitUntil: 'networkidle0' }); await wait('Jobright bot');
    await click('Connect the Ubuntu worker'); await click('Generate worker key'); await wait('Shown once.'); assert.ok((await page.content()).includes(key));
    await click('Hide key'); assert.ok(!(await page.content()).includes(key));
    assert.equal(await page.$('[aria-label="Jobright search pages"]'), null, 'The fixed Recommended page needs no URL field');
    await click('Link exclusions and scan settings'); await replace('Blocked job domains', 'linkedin.com\nindeed.com'); await replace('Blocked words in job links', 'contract');
    await replace('Test original job URL', 'https://uk.linkedin.com/jobs/1'); await wait('Blocked domain');
    await replace('Test original job URL', 'https://careers.example.org/%63ontract/1'); await wait('Blocked word in URL');
    await new Promise(resolve => setTimeout(resolve, 5500)); assert.equal(await page.$eval('[aria-label="Blocked job domains"]', el => el.value), 'linkedin.com\nindeed.com', 'Status polling must not erase edits');
    await click('Save bot settings'); await wait('Bot settings saved.'); assert.deepEqual(settings.blockedDomains, ['linkedin.com', 'indeed.com']); assert.deepEqual(settings.blockedWords, ['contract']);
    await click('Start watching'); await wait('Watch started.'); assert.ok(watchStart);
    await click('Show browser'); await wait('Visible on Ubuntu'); await click('Hide browser'); await wait('Hidden background browser'); assert.equal(status.startedAt, watchStart);
    await click('Open login on Ubuntu'); await wait('Finish login & hide');
    await click('Finish login & hide'); await wait('Hidden background browser'); assert.equal(status.startedAt, watchStart); assert.deepEqual(writes.filter(row => typeof row === 'string'), ['start', 'show-browser', 'hide-browser', 'login', 'finish-login']);
    await page.screenshot({ path: path.join(folder, 'master-jobright-controls.png'), fullPage: true });
    await page.setViewport({ width: 430, height: 840 }); await page.screenshot({ path: path.join(folder, 'narrow-jobright-controls.png'), fullPage: true });
    const bounds = await page.$eval('section[aria-label="Jobright browser bot"]', el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right }; }); assert.ok(bounds.left >= 0 && bounds.right <= 430);
    await click('Stop'); await wait('Stop requested.');
    for (const otherRole of ['ADMIN', 'BIDDER']) {
      role = otherRole; await page.goto(origin + '/job-pool', { waitUntil: 'networkidle0' }); await wait('Remote Software Jobs');
      assert.equal(await page.$('section[aria-label="Jobright browser bot"]'), null, `${role} cannot see bot controls`);
    }
    assert.deepEqual(errors, []); console.log('PASS: Master controls, one-time key visibility, URL previews, polling-safe edits, saved rules, start/login/hide/stop, narrow layout and Admin/Bidder role visibility. Screenshots: ' + folder);
  } catch (error) { await page.screenshot({ path: path.join(folder, 'failure.png'), fullPage: true }); console.error('Browser errors:', errors); throw error; }
  finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
