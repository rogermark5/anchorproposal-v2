// Uses the production UI and intercepted APIs; no live applications are changed.
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs/promises'), puppeteer = require('puppeteer');
const { calendarDay, calendarRange, shiftCalendarDay } = require('../../../packages/shared/dist');
(async () => {
  const origin = process.env.QA_WEB_URL || 'http://127.0.0.1:3198', zone = 'America/Los_Angeles';
  const folder = path.resolve('../../tmp/job-pool-qa/all-application-dates'); await fs.mkdir(folder, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, pipe: true, timeout: 120000, protocolTimeout: 120000 });
  const page = await browser.newPage(); page.setDefaultTimeout(30000); await page.setViewport({ width: 1440, height: 1000 });
  const errors = [], queries = []; page.on('pageerror', error => errors.push(error.message));
  const today = calendarDay(new Date(), zone), selected = shiftCalendarDay(today, -2), older = shiftCalendarDay(today, -20);
  const admin = { id: 'admin', role: 'ADMIN', firstName: 'QA', lastName: 'Admin', email: 'qa@qa.invalid' }, bidder = { id: 'bidder', firstName: 'QA', lastName: 'Bidder' };
  const profile = { id: 'profile', firstName: 'Alex', lastName: 'Candidate', profileTitle: 'Engineer' };
  const make = (id, day, owner = admin, status = 'SAVED') => ({ id, jobTitle: id, company: 'Example Co', location: 'US', status,
    createdAt: new Date(calendarRange(day, day, zone).gte.getTime() + 3600000).toISOString(), profile, bidder: owner, warnings: [], _count: { generations: 0 }, latestFiles: {} });
  const applications = [make('Today engineer', today), make('Selected engineer', selected), make('Older engineer', older, admin, 'APPLIED'),
    make('Today bidder engineer', today, bidder), make('Older bidder engineer', older, bidder), ...Array.from({ length: 14 }, (_, i) => make('Historical engineer ' + (i + 1), older))];
  await page.evaluateOnNewDocument(() => { localStorage.setItem('accessToken', 'qa'); localStorage.setItem('refreshToken', 'qa'); });
  await page.setRequestInterception(true); page.on('request', request => {
    const url = new URL(request.url()); if (!url.pathname.startsWith('/backend/')) return void request.continue();
    const route = url.pathname.slice(8); let data = {};
    if (route === '/auth/me') data = admin;
    else if (route === '/settings/time-zone') data = { timeZone: zone };
    else if (route === '/profiles') data = [profile];
    else if (route === '/applications') {
      const query = Object.fromEntries(url.searchParams); queries.push(query);
      data = applications.filter(app => (!query.from || calendarDay(app.createdAt, zone) >= query.from && calendarDay(app.createdAt, zone) <= query.to) &&
        (!query.scope || (query.scope === 'mine' ? app.bidder.id === admin.id : app.bidder.id === bidder.id)) && (!query.status || app.status === query.status));
    }
    void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const wait = text => page.waitForFunction(value => document.body.innerText.includes(value), {}, text);
  const click = text => page.evaluate(value => { const button = [...document.querySelectorAll('button')].find(el => el.innerText.trim() === value); if (!button) throw Error('Missing ' + value); button.click(); }, text);
  const label = day => new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  const body = () => page.$eval('body', el => el.innerText);
  try {
    await page.goto(origin + '/applications', { waitUntil: 'networkidle0' }); await wait('Today engineer'); assert.equal(queries.at(-1).from, today); assert.equal(queries.at(-1).scope, 'mine');
    await page.click('[aria-label="Application creation date range"]');
    const selector = '[aria-label="' + label(selected) + '"]';
    if (!await page.$(selector)) await page.click('[aria-label="Previous month"]');
    await page.click(selector); await page.click(selector); await wait('Selected engineer'); assert.equal(queries.at(-1).from, selected);
    await click('All Applications'); await wait('Showing 1–15 of 19');
    assert.equal(await page.$('[aria-label="Application creation date range"]'), null);
    const allQuery = queries.at(-1); for (const key of ['from', 'to', 'timeZone', 'scope']) assert.equal(allQuery[key], undefined, key);
    for (const title of ['Today engineer', 'Selected engineer', 'Older engineer', 'Older bidder engineer']) assert.ok((await body()).includes(title), title);
    await click('Next'); await wait('Showing 16–19 of 19'); assert.ok((await body()).includes('Historical engineer 14'));
    const search = 'input[placeholder="Search all applications..."]'; await page.type(search, 'Older engineer'); await wait('Showing 1–1 of 1'); assert.ok((await body()).includes('Older engineer'));
    await page.click(search); await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace');
    await click('Applied'); await wait('Showing 1–1 of 1'); assert.equal(queries.at(-1).status, 'APPLIED'); assert.equal(queries.at(-1).from, undefined);
    await page.screenshot({ path: path.join(folder, 'all-dates-applied.png'), fullPage: true });
    await page.evaluate(() => { const chips = [...document.querySelectorAll('button')].filter(el => el.textContent.trim() === 'All'); chips.at(-1).click(); });
    await wait('Showing 1–15 of 19'); await click('My Applications');
    await page.waitForSelector('[aria-label="Application creation date range"]'); await wait('Showing 1–1 of 1'); await wait('Selected engineer');
    assert.equal(queries.filter(query => query.scope === 'mine').at(-1).from, selected);
    assert.ok(await page.$('[aria-label="Application creation date range"]')); assert.ok(!(await body()).includes('Older engineer'));
    await click('Bidder Applications'); await wait('No applications found for this date'); assert.equal(queries.at(-1).from, selected); assert.equal(queries.at(-1).scope, 'team');
    assert.deepEqual(errors, []); console.log('PASS: All Applications ignores retained dates in API requests and client filtering, includes older records across pages, preserves search/status, and restores selected dates in My/Bidder tabs.');
  } catch (error) { await page.screenshot({ path: path.join(folder, 'failure.png'), fullPage: true }); console.error('Browser errors:', errors); throw error; }
  finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
