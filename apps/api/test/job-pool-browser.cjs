// Run against a local web build: JOB_POOL_WEB_URL=http://127.0.0.1:3291 node test/job-pool-browser.cjs
// Every API request is intercepted. This never contacts a real API or job provider.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { spawn } = require('node:child_process');
const base = process.env.JOB_POOL_WEB_URL || 'http://127.0.0.1:3291';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw Error('Use a local web server for Job Pool browser checks.');
const directory = path.resolve(__dirname, '../../../tmp/job-pool-qa');
const jobs = Array.from({ length: 25 }, (_, index) => ({ id: `job-${index}`, title: index === 0 ? 'Senior Software Engineer' : `US Product Engineer ${index}`, company: 'Example Company', location: 'San Francisco, CA, United States', description: 'Build reliable software with TypeScript and Python.\nWork with our engineering team on customer products.', jobUrl: `https://jobicy.com/jobs/${index}`, sourceId: 'source-jobicy', sourceName: 'Jobicy', salary: 'USD 140,000 – 180,000 / year', employmentType: 'Full time', workArrangement: 'REMOTE', publishedAt: new Date(Date.now() - (index ? index * 86400_000 : 3 * 60_000)).toISOString(), postedAt: new Date(Date.now() - (index ? index * 86400_000 : 3 * 60_000)).toISOString(), expiresAt: null, hidden: false, applied: false, appliedAt: null }));
const source = { id: 'source-jobicy', provider: 'jobicy', name: 'Jobicy', boardToken: '', enabled: true, configured: true, queued: false, running: false, lastCount: 25, lastSyncedAt: new Date().toISOString(), nextSyncAt: new Date(Date.now() + 6 * 3600_000).toISOString() };
const management = { settings: { enabled: false, intervalHours: 6 }, sources: [source, ...Array.from({length:4999},(_,index)=>({...source,id:`source-company-${index}`,provider:'greenhouse',name:`Company board ${String(index).padStart(4,'0')}`,boardToken:`company-${index}`}))], providers: [{ id: 'jobicy', name: 'Jobicy', board: false, docs: 'https://github.com/Jobicy/remote-jobs-api', configured: true }, { id: 'greenhouse', name: 'Greenhouse', board: true, docs: 'https://docs.greenhouse.io/job-board.html', configured: true }] };
management.providers.push({ id: 'freehire', name: 'Freehire · employer feeds', board: true, choices: ['workday', 'workable'], configured: true, docs: 'https://freehire.me/docs/api' });

(async () => {
  await fs.mkdir(directory, { recursive: true });
  let web, browser, log = ''; let checks = 0;
  const check = label => { checks++; console.log(`PASS ${label}`); };
  try {
    if (process.env.JOB_POOL_START_WEB === '1') {
      const webDirectory = path.resolve(__dirname, '../../web');
      web = spawn(process.execPath, [path.join(webDirectory, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', new URL(base).port], { cwd: webDirectory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      web.stdout.on('data', data => { log += data; }); web.stderr.on('data', data => { log += data; });
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        if (web.exitCode !== null) throw Error(`Local web server failed: ${log}`);
        try { ready = (await fetch(base + '/job-pool', { signal: AbortSignal.timeout(2000) })).ok; } catch {}
        if (ready) break; await new Promise(resolve => setTimeout(resolve, 300));
      }
      if (!ready) throw Error(`Local web server did not start: ${log}`);
    }
    browser = await puppeteer.launch({ headless: 'shell', userDataDir: path.join(directory, 'chrome-profile'), timeout: 45_000 });
    for (const role of ['MASTER', 'BIDDER', 'ADMIN']) {
      const context = await browser.createBrowserContext(); const page = await context.newPage(); const errors = [], writes = [], applied = new Set(), arrivals = []; let failCursor = true;
      page.on('pageerror', error => errors.push(error.message)); await page.setViewport({ width: 1440, height: 1000 });
      await page.evaluateOnNewDocument(() => { localStorage.setItem('accessToken', 'qa-access'); localStorage.setItem('refreshToken', 'qa-refresh'); });
      await page.setRequestInterception(true);
      page.on('request', async request => {
        try {
          const url = new URL(request.url()); const route = url.pathname.replace(/^\/backend/, '');
          if (request.isNavigationRequest() && url.origin === base) return request.continue();
          if (request.method() === 'OPTIONS') return request.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type,ngrok-skip-browser-warning' } });
          const method = request.method(); let result; const body = request.postData() ? JSON.parse(request.postData()) : {};
          if (route === '/auth/me') result = { id: 'user', role, firstName: 'QA', lastName: role, email: 'qa@example.invalid', canCreateApplications: true };
          else if (route === '/job-pool/manage') { if (method === 'PATCH') { Object.assign(management.settings, body); writes.push([route, body]); } result = management; }
          else if (route === '/job-pool/sync') { writes.push([route, body]); result = { queued: 1, message: '1 source queued.' }; }
          else if (route === '/job-pool/sources') { writes.push([route, body]); result = {}; }
          else if (route === '/job-pool/updates') result = {total:jobs.length+arrivals.length,newCount:arrivals.length,checkedAt:new Date().toISOString()};
          else if (route === '/job-pool' && method === 'POST') { writes.push([route, body]); result = { ...jobs[0], ...body, id: 'manual-job' }; }
          else if (route === '/job-pool') {
            const q = (url.searchParams.get('q') || '').toLowerCase(), days = url.searchParams.get('days'), status = url.searchParams.get('status') || 'not-applied';
            const filtered = [...arrivals,...jobs].filter(job => (job.title + ' ' + job.company + ' ' + job.description).toLowerCase().includes(q) && (!days || days === 'all' || Date.parse(job.postedAt) >= Date.now() - Number(days) * 86400_000) && (status === 'all' || (status === 'applied') === applied.has(job.id)));
            const offset = Number(url.searchParams.get('cursor') || 0);
            if (offset && failCursor) { failCursor = false; return request.respond({status:503,contentType:'application/json',body:JSON.stringify({message:'Temporary loading issue. Retry.'})}); }
            result = { jobs: filtered.slice(offset, offset + 20).map(job => ({...job,applied:applied.has(job.id),appliedAt:applied.has(job.id)?new Date().toISOString():null})), total: filtered.length, nextCursor: filtered.length > offset + 20 ? String(offset + 20) : null, sources: management.sources.map(({id,name,provider})=>({id,name,provider})) };
          } else if (/^\/job-pool\/jobs\/[^/]+\/apply$/.test(route)) { writes.push([route, body]); result = { id: 'saved-app' }; }
          else if (/^\/job-pool\/jobs\/[^/]+\/applied$/.test(route)) { const id=route.split('/')[3]; if(body.applied) applied.add(id); else applied.delete(id); writes.push([route,body]); result={applied:body.applied,appliedAt:body.applied?new Date().toISOString():null}; }
          else if (/^\/job-pool\/jobs\//.test(route)) {const job=jobs.find(job=>route.endsWith(job.id))||jobs[0];result={...job,applied:applied.has(job.id),appliedAt:applied.has(job.id)?new Date().toISOString():null};}
          else if (route === '/profiles') result = [{ id: 'my-profile', firstName: 'Jason', lastName: 'Glenn', isDefault: true }];
          else if (route === '/templates') result = [];
          else if (route === '/applications/saved-app') result = { id: 'saved-app', jobTitle: jobs[0].title, company: jobs[0].company, location: jobs[0].location, jobUrl: jobs[0].jobUrl, jobDescription: jobs[0].description, status: 'SAVED', profile: { id: 'my-profile', firstName: 'Jason', lastName: 'Glenn' }, bidder: { firstName: 'QA', lastName: role }, warnings: [], generations: [], notes: [], statusHistory: [], createdAt: new Date().toISOString() };
          if (result !== undefined) return request.respond({ status: method === 'POST' ? 201 : 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(result) });
          if (url.origin !== base) return request.abort();
          return request.continue();
        } catch (error) { errors.push(`Interception: ${error.message}`); await request.abort().catch(() => {}); }
      });
      const click = async text => { await page.waitForFunction(text => [...(document.querySelector('[role="dialog"]') || document).querySelectorAll('button')].some(button => button.textContent.trim() === text), {}, text); await page.evaluate(text => [...(document.querySelector('[role="dialog"]') || document).querySelectorAll('button')].find(button => button.textContent.trim() === text).click(), text); };
      const fill = async (label, value) => page.evaluate(({ label, value }) => {
        const root = document.querySelector('[role="dialog"]') || document;
        const target = [...root.querySelectorAll('label')].find(element => element.textContent.trim().startsWith(label))?.querySelector('input,textarea');
        if (!target) throw Error(`Missing field ${label}`);
        Object.getOwnPropertyDescriptor(target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(target, value);
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }, { label, value });
      await page.goto(`${base}/job-pool`, { waitUntil: 'networkidle0' }); await page.waitForSelector('article');
      assert.equal(await page.$$eval('article', elements => elements.length), 20); check(`${role} sees software jobs with 3 mins ago timestamps and defaults to Not applied`);
      const hasManagement = await page.$('[aria-label="Automatic job imports"]'); assert.equal(!!hasManagement, role === 'MASTER');
      const coverage=await page.$('[aria-label="Source coverage"]');assert.equal(!!coverage,role==='MASTER');
      if(role==='MASTER')assert.match(await coverage.evaluate(element=>element.innerText),/5,000[\s\S]*Sources in the library/);
      assert.equal(await page.$('[aria-label="Filter by work arrangement"]'),null);
      check(`${role} sees only its permitted controls`);
      await page.type('input[aria-label="Search jobs"]', 'Senior Software'); await page.waitForFunction(() => document.querySelectorAll('article').length === 1);
      await page.click('input[aria-label="Search jobs"]', { clickCount: 3 }); await page.keyboard.press('Backspace'); await page.waitForFunction(() => document.querySelectorAll('article').length === 20);
      assert.equal(await page.$eval('select[aria-label="Filter by applied status"]',element=>element.value),'not-applied');
      assert.equal(await page.$eval('article time',element=>element.textContent),'3 mins ago');
      await page.$eval('[data-testid="job-scroll-sentinel"]',element=>element.scrollIntoView());
      await page.waitForFunction(()=>document.body.innerText.includes('Temporary loading issue. Retry.'));
      assert.equal(await page.$$eval('article',elements=>elements.length),20);
      await click('Retry loading jobs'); await page.waitForFunction(()=>document.querySelectorAll('article').length===25);
      assert.equal(await page.$$eval('article',elements=>new Set(elements.map(element=>element.querySelector('button').textContent)).size),25);
      check(role+' scrolling appends unique jobs and recovers a failed page without losing earlier jobs');
      await page.click('button[aria-label="Mark applied: Senior Software Engineer"]');await page.waitForFunction(()=>document.querySelectorAll('article').length===24);
      await page.select('select[aria-label="Filter by applied status"]','applied');await page.waitForFunction(()=>document.querySelectorAll('article').length===1);
      assert.equal(await page.$eval('article button',element=>element.textContent),'Senior Software Engineer');
      await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('article');
      assert.equal(await page.$('button[aria-label="Mark applied: Senior Software Engineer"]'),null);
      await page.select('select[aria-label="Filter by applied status"]','applied');await page.waitForFunction(()=>document.querySelectorAll('article').length===1);
      await click('Senior Software Engineer');await page.waitForSelector('[role="dialog"]');await click('Applied ✓ · Undo');await page.waitForFunction(()=>document.querySelectorAll('article').length===0);
      await click('Mark applied');await page.waitForFunction(()=>document.querySelectorAll('article').length===1);await click('Applied ✓ · Undo');await click('Close');
      await page.select('select[aria-label="Filter by applied status"]','not-applied');await page.waitForSelector('article');
      for(const [days,count] of [['1',1],['3',3],['7',7],['14',14]]) {await page.select('select[aria-label="Filter by posting date"]',days);await page.waitForFunction(count=>document.querySelectorAll('article').length===count,{},count);}
      await page.select('select[aria-label="Filter by posting date"]','30');await page.waitForFunction(()=>document.querySelectorAll('article').length===20);
      await page.select('select[aria-label="Filter by applied status"]','all');await page.waitForSelector('article');
      await page.select('select[aria-label="Filter by posting date"]','all');await page.waitForSelector('article');
      check(role+' applied marks survive refresh, undo works in preview, and date/status filters work');
      if (role === 'MASTER') {
        await page.$eval('[data-testid="job-scroll-sentinel"]',element=>element.scrollIntoView());await page.waitForFunction(()=>document.querySelectorAll('article').length===25);
        const scrollBeforeImport=await page.evaluate(()=>window.scrollY);
        arrivals.push({...jobs[0],id:'new-import',title:'Newly Imported Software Engineer',jobUrl:'https://example.com/new-import',postedAt:new Date().toISOString()});
        await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
        await page.waitForFunction(()=>document.body.innerText.includes('1 new matching job has been imported.'));
        assert.equal(await page.$$eval('article',items=>items.length),25);assert.equal(await page.evaluate(()=>window.scrollY),scrollBeforeImport);
        await click('Refresh job list');await page.waitForFunction(()=>document.querySelector('article button')?.textContent==='Newly Imported Software Engineer');
        check('Live import notification updates the total without clearing scrolled jobs, then refreshes the list on request');
        await click('Start automatic imports'); await page.waitForFunction(() => document.body.innerText.includes('Automatic imports on'));
        await click('Pause imports'); await page.waitForFunction(() => document.body.innerText.includes('Automatic imports paused'));
        await click('Import jobs now'); await page.waitForFunction(() => document.body.innerText.includes('1 source queued.'));
        await click('Manage sources'); await page.waitForSelector('input[aria-label="Enable Jobicy"]'); check('Master starts, pauses and manually runs imports');
        assert.equal(await page.$$eval('tbody tr',rows=>rows.length),50);
        await click('Next sources'); await page.waitForFunction(()=>document.body.innerText.includes('Page 2 of 100'));
        await click('Previous sources');
        await page.type('input[placeholder="Company or provider…"]','Company board 4110'); await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===1);
        await page.click('input[placeholder="Company or provider…"]',{clickCount:3});await page.keyboard.press('Backspace');await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===50);
        check('Master can search and paginate 5,000 sources while rendering 50 table rows');
        await page.screenshot({ path: path.join(directory, 'master.png'), fullPage: true });
        await click('Add source'); await fill('Company name', 'Example company'); await fill('Company board name', 'example'); await click('Add source'); await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
        assert.ok(writes.some(([route, body]) => route === '/job-pool/sources' && body.boardToken === 'example')); check('Master can add another free company source');
        await click('Add source'); await page.select('[role="dialog"] select', 'freehire');
        await page.waitForFunction(() => document.body.innerText.includes('Employer recruiting system'));
        const selects = await page.$$('[role="dialog"] select'); await selects[1].select('workable');
        assert.equal(await page.$$eval('[role="dialog"] input', inputs => inputs.length), 0);
        await click('Add source'); await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
        assert.ok(writes.some(([route, body]) => route === '/job-pool/sources' && body.provider === 'freehire' && body.boardToken === 'workable'));
        check('Master chooses a free employer feed without guessing a company board name');
        await click('Add job'); for (const [label, value] of [['Job title', 'QA Software Engineer'], ['Company', 'QA Company'], ['Original job URL', 'https://example.com/job/qa'], ['Job description', 'Build software with TypeScript.']]) await fill(label, value);
        await click('Publish job'); await page.waitForFunction(() => !document.querySelector('[role="dialog"]')); assert.ok(writes.some(([route, body]) => route === '/job-pool' && body.title === 'QA Software Engineer')); check('Master can publish a manual job');
      } else {
        await click('Senior Software Engineer'); await page.waitForSelector('[role="dialog"]');
        const selection = await page.$eval('[role="dialog"] select', element => element.value); assert.equal(selection, 'my-profile');
        assert.equal(await page.$eval('[role="dialog"] a', element => element.href), jobs[0].jobUrl);
        await page.screenshot({ path: path.join(directory, `${role.toLowerCase()}-application.png`), fullPage: true });
        await click('Save and prepare resume'); await page.waitForFunction(() => location.pathname === '/applications/saved-app');
        assert.ok(writes.some(([route, body]) => route === '/job-pool/jobs/job-0/apply' && body.profileId === 'my-profile')); check(`${role} prepares an application with its selected profile and original job link`);
        await page.setViewport({ width: 390, height: 844 }); await page.goto(`${base}/job-pool`, { waitUntil: 'networkidle0' }); await page.waitForSelector('article');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: path.join(directory, `${role.toLowerCase()}-mobile.png`), fullPage: true }); check(`${role} layout fits a mobile screen`);
      }
      assert.deepEqual(errors, []); await context.close();
    }
    await fs.writeFile(path.join(directory, 'browser-result.json'), JSON.stringify({ passed: checks, realApiCalls: 0, providerCalls: 0 }, null, 2)); console.log(`${checks} browser checks passed.`);
  } finally { if (web) web.kill(); if (browser) await browser.close(); await fs.writeFile(path.join(directory, 'browser-web.log'), log); }
})().catch(error => { console.error(error); process.exitCode = 1; });
