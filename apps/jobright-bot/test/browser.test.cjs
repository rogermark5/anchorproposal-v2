const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const puppeteer = require('puppeteer');
const { JobrightBrowser, LoginRequired } = require('../src/browser.cjs');

test('real Chrome scans fixtures: new source dates, original links, exclusions, no Apply clicks, stop and challenges', { timeout: 60000 }, async t => {
  const baseline = Date.now() - 120000, date = new Date(baseline + 1000).toISOString(), posted = new Date(baseline - 1000).toISOString();
  const make = (id, changes = {}) => ({ jobResult: { jobId: id, jobTitle: 'Software Engineer', jobLocation: 'Remote, United States', workModel: 'Remote',
    publishTime: date, jobSummary: 'Build reliable web software.', applyLink: 'https://jobright.ai/jobs/info/' + id, ...changes }, companyResult: { companyName: 'Example ' + id } });
  const rows = [make('old', { publishTime: posted }), make('missingdate', { publishTime: null }), make('blocked', { originalUrl: 'https://linkedin.com/jobs/1' }),
    make('word', { originalUrl: 'https://example.org/jobs/CONTRACT' }), make('good'), make('nolink')];
  let applyClicked = false, externalRequests = 0, launches = [];
  const fixturePuppeteer = { launch: async options => {
    launches.push(options); const browser = await puppeteer.launch(options);
    const newPage = browser.newPage.bind(browser);
    browser.newPage = async () => {
      const page = await newPage();
      await page.setRequestInterception(true);
      page.on('request', request => {
        if (request.isInterceptResolutionHandled()) return;
        const url = new URL(request.url());
        if (url.hostname !== 'jobright.ai') { externalRequests++; return void request.abort(); }
        if (url.pathname === '/api/applied') { applyClicked = true; return void request.respond({ status: 200, body: '{}' }); }
        let html;
        if (url.pathname === '/jobs/challenge') html = '<title>Just a moment</title>';
        else if (url.pathname.includes('/info/')) {
          const id = url.pathname.split('/').at(-1), row = rows.find(row => row.jobResult.jobId === id);
          html = '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify({ props: { pageProps: { dataSource: row } } }) + '</script>' +
            (id === 'good' ? '<a href="https://careers.example.org/jobs/engineer" onclick="fetch(\'/api/applied\')">Apply</a>' : '<button onclick="fetch(\'/api/applied\')">Apply</button>');
        } else html = '<script id="__NEXT_DATA__" type="application/json">' + JSON.stringify({ props: { pageProps: { jobList: rows } } }) + '</script>';
        void request.respond({ status: 200, contentType: 'text/html', body: html });
      });
      return page;
    }; return browser;
  } };
  const bot = new JobrightBrowser({ profile: path.resolve('../../tmp/jobright-qa', 'browser-' + randomUUID()), puppeteer: fixturePuppeteer, pause: async () => {} });
  t.after(() => bot.close()); const submitted = [], seen = new Set();
  const config = { startedAt: new Date(baseline).toISOString(), settings: { searchUrls: ['https://jobright.ai/jobs/search'], blockedDomains: ['linkedin.com'], blockedWords: ['contract'], maxJobsPerScan: 10 } };
  const result = await bot.scan(config, { seen, submit: async jobs => { submitted.push(...jobs); return jobs.map(job => ({ externalId: job.externalId, status: 'imported' })); } });
  assert.deepEqual(submitted.map(job => job.externalId), ['good']); assert.equal(submitted[0].originalUrl, 'https://careers.example.org/jobs/engineer');
  assert.equal(result.missingOriginal, 1); assert.equal(externalRequests, 0); assert.equal(applyClicked, false); assert.ok(seen.has('good'));
  assert.equal(bot.mode, 'hidden'); assert.equal(launches[0].headless, true);
  const stopped = await bot.scan(config, { stop: () => true, submit: async () => { throw Error('Saved after stop'); } }); assert.equal(stopped.scanned, 0);
  await assert.rejects(bot.read('https://jobright.ai/jobs/challenge'), LoginRequired);
  await bot.close(); assert.equal(bot.mode, 'closed');
});

test('login browser is visible, then the same private profile reopens headlessly', async () => {
  const launches = []; let closed = 0;
  const puppeteer = { launch: async options => { launches.push(options); return { isConnected: () => true, close: async () => { closed++; } }; } };
  const profile = path.resolve('../../tmp/jobright-qa', 'profile-' + randomUUID()), bot = new JobrightBrowser({ profile, puppeteer });
  await bot.open(true); assert.equal(bot.mode, 'visible'); await bot.open(false); assert.equal(bot.mode, 'hidden');
  assert.equal(closed, 1); assert.deepEqual(launches.map(row => row.headless), [false, true]); assert.equal(launches[0].userDataDir, launches[1].userDataDir); await bot.close();
});

test('missing links do not consume every later scan; failed API submissions remain retryable', async () => {
  const bot = new JobrightBrowser({ profile: 'unused', puppeteer: {} }); bot.open = async () => {};
  const config = { startedAt: new Date(Date.now() - 100000).toISOString(), settings: { searchUrls: ['https://jobright.ai/jobs/search'], blockedDomains: [], blockedWords: [], maxJobsPerScan: 1 } };
  const jobs = ['missing', 'good'].map(externalId => ({ externalId, sourceUrl: 'https://jobright.ai/jobs/info/' + externalId, publishedAt: new Date(Date.now() - 1000).toISOString(), workArrangement: 'REMOTE', originalUrl: externalId === 'good' ? 'https://example.org/jobs/good' : '', description: 'Software job.' }));
  const details = [];
  bot.pause = async () => {};
  bot.read = async (_, focusId) => { if (focusId) details.push(focusId); return { jobs: focusId ? jobs.filter(job => job.externalId === focusId) : jobs }; };
  const options = { submit: async rows => rows.map(row => ({ externalId: row.externalId, status: 'imported' })) };
  assert.equal((await bot.scan(config, options)).missingOriginal, 1);
  await assert.rejects(bot.scan(config, { submit: async () => { throw Error('Temporary API failure'); } }), /Temporary/);
  assert.equal((await bot.scan(config, options)).submitted, 1); assert.deepEqual(details, ['missing', 'good', 'good']);
  const changed = { ...config, settings: { ...config.settings, blockedWords: ['intern'] } }; await bot.scan(changed, options);
  assert.equal(details.at(-1), 'missing', 'Changing filters permits a fresh check of previously skipped jobs');
});
