const { test } = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { randomUUID } = require('node:crypto'), puppeteer = require('puppeteer');
const { JobrightBrowser, LoginRequired } = require('../src/browser.cjs');

const seed = 'https://jobright.ai/jobs/recommend?visit=software-engineer-jobs-in-united-states';
const make = id => ({ jobResult: { jobId: id, jobTitle: 'Software Engineer', jobLocation: 'Remote, United States', workModel: 'Remote',
  publishTime: new Date(Date.now() - 1000).toISOString(), jobSummary: 'Build dependable web software.', originalApplyUrl: 'https://careers.example.org/jobs/' + id }, companyResult: { companyName: id + ' Co' } });
const stale = make('recommended-only'), recent = make('recent-only');

async function fixture(t, { ant = false, persisted = false, missing = false, ignoreClick = false, noRefresh = false, detailOnly = false, empty = false, status = 200, hydrateDelay = 0 } = {}) {
  const requests = [], submitted = [], clicks = [], timers = new Set(); let apply = 0;
  const proxy = { launch: async options => {
    const browser = await puppeteer.launch({ ...options, headless: 'shell', pipe: true, timeout: 120000, protocolTimeout: 120000 });
    const newPage = browser.newPage.bind(browser); browser.newPage = async () => {
      const page = await newPage(); await page.setRequestInterception(true); page.on('console', message => { if (message.text().startsWith('sort-click:')) clicks.push(message.text().slice(11)); });
      const mockRequest = request => {
        if (request.isInterceptResolutionHandled()) return; const url = new URL(request.url());
        if (url.hostname !== 'jobright.ai') return void request.abort();
        const respond = data => request.respond(data, 0).catch(() => {});
        if (url.pathname === '/api/job/applied') { apply++; return void respond({ status: 200, body: '{}' }); }
        if (url.pathname === '/api/job/list') {
          const sort = url.searchParams.get('sort'); requests.push(sort);
          const delay = sort === 'recommended' ? 180 : 350;
          return new Promise(resolve => { const timer = setTimeout(async () => { timers.delete(timer); await respond({ status: sort === 'recent' ? status : 200, contentType: 'application/json',
            body: JSON.stringify(detailOnly && sort === 'recent' ? { data: stale } : { data: { jobList: sort === 'recent' ? empty ? [] : [recent] : [stale] } }) }); resolve(); }, delay); timers.add(timer); });
        }
        if (url.pathname.includes('/info/')) return void respond({ status: 200, contentType: 'text/html', body: '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify({ props: { pageProps: { dataSource: recent } } }) + '</script><button onclick="fetch(\'/api/job/applied\')">Apply Now</button>' });
        const controls = missing ? '<p>No sort dropdown</p>' : ant
          ? '<div class="ant-select jobs-recommend-sorter"><div class="ant-select-selector"><input role="combobox" aria-haspopup="listbox" aria-expanded="false" style="opacity:0"><span class="ant-select-selection-item" title="Recommended">Recommended</span></div></div><div class="ant-select-dropdown" hidden></div>'
          : '<select aria-label="Job sort"><option value="recommended">Recommended</option><option value="recent" ' + (persisted ? 'selected' : '') + '>Most Recent</option></select>';
        const script = `
          fetch('/api/job/list?sort=recommended');
          const refresh = value => { console.log('sort-click:' + value); ${noRefresh ? '' : "fetch('/api/job/list?sort=' + value);"} };
          setTimeout(() => {
            const native = document.querySelector('select'); if (native) native.onchange = () => { ${ignoreClick ? "native.value = 'recommended';" : 'refresh(native.value);'} };
            const selector = document.querySelector('.ant-select-selector'), menu = document.querySelector('.ant-select-dropdown');
            if (selector) selector.onmousedown = () => { menu.hidden = false; document.querySelector('[role=combobox]').setAttribute('aria-expanded', 'true');
              menu.innerHTML = ['Recommended','Most Recent'].map(text => '<div class="ant-select-item-option" role="option" title="' + text + '">' + text + '</div>').join('');
              for (const option of menu.children) option.onclick = () => { document.querySelector('.ant-select-selection-item').textContent = option.title; document.querySelector('.ant-select-selection-item').title = option.title;
                document.querySelector('[role=combobox]').setAttribute('aria-expanded', 'false'); menu.hidden = true; refresh(option.title === 'Most Recent' ? 'recent' : 'recommended'); };
            }
          }, ${hydrateDelay});
        `;
        const html = '<!doctype html><a href="/jobs/recommend">Recommended</a><p>Most Recent sorts by posting date.</p>' + controls +
          '<div class="ant-select-item-option" title="Most Recent" style="display:none">Most Recent</div>' +
          '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify({ props: { pageProps: { logined: true, jobList: [stale] } } }) + '</script><script>' + script + '</script>';
        void respond({ status: 200, contentType: 'text/html', body: html });
      };
      // Keep the production request-start receipt ahead of the delayed fixture response.
      const on = page.on.bind(page); let installed = false;
      page.on = (event, handler) => { on(event, handler); if (event === 'response') { if (installed) page.off('request', mockRequest); installed = true; on('request', mockRequest); } return page; };
      return page;
    }; return browser;
  } };
  const bot = new JobrightBrowser({ profile: path.resolve('../../tmp/jobright-qa', 'sort-' + randomUUID()), puppeteer: proxy, pause: async () => {} });
  t.after(async () => { for (const timer of timers) clearTimeout(timer); await bot.close(); });
  const scan = () => bot.scan({ startedAt: new Date(Date.now() - 60000).toISOString(), settings: { searchUrls: [seed], blockedDomains: [], blockedWords: [], maxJobsPerScan: 5 } },
    { submit: async jobs => { submitted.push(...jobs); return jobs.map(job => ({ externalId: job.externalId, status: 'imported' })); } });
  await bot.open(false);
  return { bot, requests, submitted, clicks, scan, applied: () => apply };
}

test('same-URL Most Recent scans discard Recommended HTML and delayed responses on every scan', { timeout: 60000 }, async t => {
  const f = await fixture(t); await f.scan(); await f.scan();
  assert.deepEqual(f.submitted.map(job => job.externalId), ['recent-only', 'recent-only']);
  assert.equal(f.requests.filter(value => value === 'recent').length, 2); assert.deepEqual(f.clicks, ['recent', 'recommended', 'recent']); assert.equal(f.applied(), 0);
  const list = await f.bot.read(seed, null); assert.equal(list.sort, 'most-recent'); assert.deepEqual(list.jobs.map(job => job.externalId), ['recent-only']);
});
test('Jobright Ant Design dropdown handles delayed hydration and portaled options', { timeout: 60000 }, async t => {
  const f = await fixture(t, { ant: true, hydrateDelay: 250 }); const list = await f.bot.read(seed, null);
  assert.deepEqual(f.clicks, ['recent']); assert.equal(list.sort, 'most-recent'); assert.deepEqual(list.jobs.map(job => job.externalId), ['recent-only']);
});
test('persisted Most Recent forces a fresh list without trusting old page payloads', { timeout: 60000 }, async t => {
  const f = await fixture(t, { persisted: true }); const list = await f.bot.read(seed, null);
  assert.deepEqual(f.clicks, ['recommended', 'recent']); assert.deepEqual(list.jobs.map(job => job.externalId), ['recent-only']);
});
test('empty Most Recent results are valid and do not restore Recommended jobs', { timeout: 60000 }, async t => {
  const f = await fixture(t, { empty: true }); const list = await f.bot.read(seed, null); assert.deepEqual(list.jobs, []); assert.equal(list.sort, 'most-recent');
});
test('missing, ignored or unrefreshed sorts and detail responses pause before importing', { timeout: 120000 }, async t => {
  for (const options of [{ missing: true }, { ignoreClick: true }, { noRefresh: true }, { detailOnly: true }, { status: 429 }]) {
    const f = await fixture(t, options); await assert.rejects(f.bot.read(seed, null, { sortTimeoutMs: 650 }), LoginRequired);
    assert.deepEqual(f.submitted, []); await f.bot.close();
  }
});
