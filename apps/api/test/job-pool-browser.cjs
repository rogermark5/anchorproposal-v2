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
jobs.forEach(job=>{job.addedBatchId=Number(job.id.split('-')[1])<4?'initial-import':null;job.createdAt=job.postedAt;job.companyMatches=[];job.viewed=false;job.viewedAt=null;});
jobs[0].companyMatches=[{id:'saved-app',company:'E X A M P L E company',jobTitle:'Previous Engineer'}];
for (const [index,job] of jobs.entries()) { const code=['US','GB','IE'][index%3]; job.eligibleCountries=[code]; job.location={US:'Remote, United States',GB:'Remote, United Kingdom',IE:'Remote, Ireland'}[code]; }
jobs[3].eligibleCountries=['US','GB','IE']; jobs[3].location='Worldwide';
const source = { id: 'source-jobicy', provider: 'jobicy', name: 'Jobicy', boardToken: '', enabled: true, configured: true, queued: false, running: false, lastCount: 25, lastSyncedAt: new Date().toISOString(), nextSyncAt: new Date(Date.now() + 6 * 3600_000).toISOString() };
const management = { settings: { enabled: false, intervalHours: 6 }, sourceTarget:30000, sources: [source, ...Array.from({length:29999},(_,index)=>({...source,id:`source-company-${index}`,provider:'greenhouse',name:`Company board ${String(index).padStart(4,'0')}`,boardToken:`company-${index}`}))], providers: [{ id: 'jobicy', name: 'Jobicy', board: false, docs: 'https://github.com/Jobicy/remote-jobs-api', configured: true }, { id: 'greenhouse', name: 'Greenhouse', board: true, docs: 'https://docs.greenhouse.io/job-board.html', configured: true }] };
management.providers.push({ id: 'freehire', name: 'Freehire · employer feeds', board: true, choices: ['workday', 'workable'], configured: true, docs: 'https://freehire.me/docs/api' });
management.coverage=[{country:'US',name:'United States',target:10000,monitoredSources:30000,successfullyReadSources:8500,matchingSources:1200,availableJobs:11200},{country:'GB',name:'United Kingdom',target:10000,monitoredSources:29999,successfullyReadSources:8499,matchingSources:180,availableJobs:900},{country:'IE',name:'Ireland',target:10000,monitoredSources:29999,successfullyReadSources:8499,matchingSources:60,availableJobs:230}];

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
      const context = await browser.createBrowserContext(); const page = await context.newPage(); const errors = [], writes = [], applied = new Set(), viewed = new Map(), arrivals = []; let failCursor = true; let latestImport={id:'initial-import',startedAt:new Date(Date.now()-3600000).toISOString(),endsAt:new Date().toISOString(),intervalHours:1};
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
          else if (route === '/job-pool/updates') result = {total:jobs.length+arrivals.length,newCount:arrivals.length,latestImport,checkedAt:new Date().toISOString()};
          else if (route === '/job-pool' && method === 'POST') { writes.push([route, body]); result = { ...jobs[0], ...body, id: 'manual-job' }; }
          else if (route === '/job-pool') {
            const country = url.searchParams.get('country') || 'all', site = url.searchParams.get('site');
            const q = (url.searchParams.get('q') || '').toLowerCase(), days = url.searchParams.get('days'), status = url.searchParams.get('status') || 'not-applied';
            const filtered = [...arrivals,...jobs].filter(job => (!site || site === 'jobicy') && (country === 'all' || job.eligibleCountries.includes(country)) && (job.title + ' ' + job.company + ' ' + job.description).toLowerCase().includes(q) && (!days || days === 'all' || Date.parse(job.createdAt) >= Date.now() - Number(days) * 86400_000) && (status === 'all' || (status === 'applied') === applied.has(job.id)));
            const offset = Number(url.searchParams.get('cursor') || 0);
            if (offset && failCursor) { failCursor = false; return request.respond({status:503,contentType:'application/json',body:JSON.stringify({message:'Temporary loading issue. Retry.'})}); }
            result = { latestImport, jobs: filtered.slice(offset, offset + 20).map(job => ({...job,viewed:viewed.has(job.id),viewedAt:viewed.get(job.id)||null,applied:applied.has(job.id),appliedAt:applied.has(job.id)?new Date().toISOString():null})), total: filtered.length, nextCursor: filtered.length > offset + 20 ? String(offset + 20) : null, sites: management.providers.map(({id,name})=>({id,name})) };
          } else if (/^\/job-pool\/jobs\/[^/]+\/apply$/.test(route)) { writes.push([route, body]); result = { id: 'saved-app' }; }
          else if (/^\/job-pool\/jobs\/[^/]+\/applied$/.test(route)) { const id=route.split('/')[3]; if(body.applied) applied.add(id); else applied.delete(id); writes.push([route,body]); result={applied:body.applied,appliedAt:body.applied?new Date().toISOString():null}; }
          else if (/^\/job-pool\/jobs\/[^/]+\/viewed$/.test(route)) {const id=route.split('/')[3];if(!viewed.has(id))viewed.set(id,new Date().toISOString());writes.push([route,body]);result={viewed:true,viewedAt:viewed.get(id)};}
          else if (/^\/job-pool\/jobs\//.test(route)) {const job=jobs.find(job=>route.endsWith(job.id))||jobs[0];result={...job,viewed:viewed.has(job.id),viewedAt:viewed.get(job.id)||null,applied:applied.has(job.id),appliedAt:applied.has(job.id)?new Date().toISOString():null};}
          else if (route === '/applications/validate') {
            if(body.jobDescription.includes('slow blocked')) await new Promise(resolve=>setTimeout(resolve,900));
            if(body.jobDescription.includes('unavailable')) return request.respond({status:503,contentType:'application/json',body:JSON.stringify({message:'Validation temporarily unavailable'})});
            const blocked=/blocked/.test(body.jobDescription), confirm=/duplicate/.test(body.jobDescription);
            result={allowed:!blocked,warnings:blocked?[{category:'CLEARANCE',matchedText:'Clearance is required.',severity:'BLOCK',behavior:'BLOCK'}]:confirm?[{category:'DUPLICATE',matchedText:'An application to this company exists.',severity:'CONFIRM',behavior:'CONFIRM'}]:[]};
          }
          else if(route==='/applications') {if(method==='POST'){writes.push([route,body]);result={id:'draft-app',jobTitle:body.jobTitle,company:body.company,warnings:[]};}else result=[];}
          else if(route==='/application-options') result={locations:[],sources:[]};
          else if(route==='/profiles/assigned') result=[{profileId:'my-profile',isDefault:true,profile:{id:'my-profile',firstName:'Jason',lastName:'Glenn'}}];
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
        const fieldLabel = [...root.querySelectorAll('label')].find(element => element.textContent.trim().startsWith(label));
        const target = fieldLabel?.querySelector('input,textarea') || document.getElementById(fieldLabel?.htmlFor || '');
        if (!target) throw Error(`Missing field ${label}`);
        Object.getOwnPropertyDescriptor(target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value').set.call(target, value);
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }, { label, value });
      await page.goto(`${base}/job-pool`, { waitUntil: 'networkidle0' }); await page.waitForSelector('article');
      assert.equal(await page.$$eval('article', elements => elements.length), 20); check(`${role} sees software jobs with 3 mins ago timestamps and defaults to Not applied`);
      assert.match(await page.$eval('article time',element=>element.textContent),/^Added \d+ mins ago$/);
      await page.screenshot({path:path.join(directory,role.toLowerCase()+'-compact.png')});
      assert.equal(await page.$eval('article[data-job-id="job-1"]',el=>el.dataset.jobState),'New');
      await page.click('article[data-job-id="job-1"] button[title]');await page.waitForSelector('[role="dialog"]');
      await page.waitForFunction(()=>document.querySelector('article[data-job-id="job-1"]')?.dataset.jobState==='Viewed');await click('Close');
      await page.select('[aria-label="Filter by applied status"]','all');await page.waitForSelector('article[data-job-id="job-1"]');
      await page.click('button[aria-label="Mark applied: US Product Engineer 1"]');await page.waitForFunction(()=>document.querySelector('article[data-job-id="job-1"]')?.dataset.jobState==='Applied');
      await page.$eval('article[data-job-id="job-3"] a[target="_blank"]',link=>link.addEventListener('click',event=>event.preventDefault(),{capture:true}));
      await page.click('article[data-job-id="job-3"] a[target="_blank"]');await page.waitForFunction(()=>document.querySelector('article[data-job-id="job-3"]')?.dataset.jobState==='Viewed');
      await page.focus('[aria-label="Search jobs"]');await page.mouse.move(0,0);await new Promise(resolve=>setTimeout(resolve,200));
      const colors=await page.$$eval('article',rows=>rows.slice(0,4).map(row=>getComputedStyle(row).backgroundColor));
      assert.equal(new Set(colors).size,4,'Company match, Applied, New and Viewed need distinct colors at rest');
      await page.screenshot({path:path.join(directory,role.toLowerCase()+'-job-status-colors.png')});
      await page.click('article[data-job-id="job-0"] button[title]');await page.waitForSelector('[role="dialog"]');await page.waitForFunction(()=>document.querySelector('article[data-job-id="job-0"]')?.dataset.jobState==='Viewed');await click('Close');
      await page.click('button[aria-label="Mark applied: Senior Software Engineer"]');await page.waitForFunction(()=>document.querySelector('article[data-job-id="job-0"]')?.dataset.jobState==='Applied');
      await page.focus('[aria-label="Search jobs"]');await page.mouse.move(0,0);await new Promise(resolve=>setTimeout(resolve,200));
      assert.equal(await page.$eval('article[data-job-id="job-0"]',row=>getComputedStyle(row).backgroundColor),colors[0],'Company matches retain their background after viewing and applying');
      await page.click('button[aria-label="Mark not applied: Senior Software Engineer"]');await page.waitForFunction(()=>document.querySelector('article[data-job-id="job-0"]')?.dataset.jobState==='Viewed');
      await page.click('button[aria-label="Mark not applied: US Product Engineer 1"]');await page.waitForFunction(()=>document.querySelector('article[data-job-id="job-1"]')?.dataset.jobState==='Viewed');
      await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('article');
      assert.equal(await page.$eval('article[data-job-id="job-1"]',el=>el.dataset.jobState),'Viewed');
      assert.equal(await page.$eval('article[data-job-id="job-3"]',el=>el.dataset.jobState),'Viewed');
      assert.equal(await page.$eval('article[data-job-id="job-2"]',el=>el.dataset.jobState),'New');
      check(`${role} sees persistent viewed history, distinct normal-state colors and amber company matches in every status`);
      const hasManagement = await page.$('[aria-label="Automatic job imports"]'); assert.equal(!!hasManagement, role === 'MASTER');
      if(role==='MASTER') await page.click('summary');
      const coverage=await page.$('[aria-label="Source coverage"]');assert.equal(!!coverage,role==='MASTER');
      if(role==='MASTER')assert.match(await coverage.evaluate(element=>element.innerText),/30,000[\s\S]*Distinct sources in the library[\s\S]*30,000 total source target · Met/);
      const countryCoverage=await page.$('[aria-label="Country source coverage"]');assert.equal(!!countryCoverage,role==='MASTER');
      if(role==='MASTER'){
        assert.match(await countryCoverage.evaluate(element=>element.innerText),/sources with eligible jobs[\s\S]*10,000 country source target · 8,800 more needed/);
        assert.match(await countryCoverage.evaluate(element=>element.innerText),/Country targets count distinct sources/);
        assert.match(await page.$eval('[aria-label="Ireland coverage"]',element=>element.innerText),/60[\s\S]*9,940 more needed[\s\S]*29,999[\s\S]*230/);
        check('Master sees a distinct-source goal and honest country-source shortfalls alongside monitoring and job counts');
      }
      assert.equal(await page.$('[aria-label="Filter by work arrangement"]'),null);
      check(`${role} sees only its permitted controls`);
      assert.equal(await page.$('[aria-label="Find job source"]'),null);
      assert.ok(await page.$$eval('select[aria-label="Filter by site"] option',options=>options.length<30));
      await page.select('select[aria-label="Filter by site"]','greenhouse'); await page.waitForFunction(()=>document.querySelectorAll('article').length===0);
      await page.select('select[aria-label="Filter by site"]',''); await page.waitForFunction(()=>document.querySelectorAll('article').length===20);
      assert.match(await page.$eval('article',el=>el.innerText),/Company match: Example Company/);
      assert.ok(await page.$('article a[href="/applications/saved-app"]'));
      assert.equal(await page.$$eval('article',els=>els.some(el=>el.innerText.includes('Build reliable software')||el.innerText.includes('Source:'))),false);
      assert.ok(await page.$$eval('article',els=>els.slice(0,10).reduce((height,el)=>height+el.getBoundingClientRect().height,0)<=680));
      check(`${role} uses a short site filter, compact rows and direct company-match application links`);
      await page.select('select[aria-label="Filter by country"]','GB'); await page.waitForFunction(()=>document.querySelectorAll('article').length===9);
      assert.ok(await page.$$eval('article',items=>items.every(item=>item.innerText.includes('UK'))));
      await page.screenshot({path:path.join(directory,`${role.toLowerCase()}-country-uk.png`),fullPage:false});
      await page.click('button[aria-label="Mark applied: US Product Engineer 1"]'); await page.waitForFunction(()=>document.querySelectorAll('article').length===8);
      await page.select('select[aria-label="Filter by applied status"]','applied'); await page.waitForFunction(()=>document.querySelectorAll('article').length===1);
      await page.select('select[aria-label="Filter by country"]','IE'); await page.waitForFunction(()=>document.querySelectorAll('article').length===0);
      await page.select('select[aria-label="Filter by country"]','GB'); await page.waitForFunction(()=>document.querySelectorAll('article').length===1);
      await page.click('button[aria-label="Mark not applied: US Product Engineer 1"]'); await page.waitForFunction(()=>document.querySelectorAll('article').length===0);
      await page.select('select[aria-label="Filter by country"]','all'); await page.select('select[aria-label="Filter by applied status"]','not-applied'); await page.waitForFunction(()=>document.querySelectorAll('article').length===20);
      check(`${role} filters UK and Ireland jobs and combines country with per-user applied marks`);
      await page.type('input[aria-label="Search jobs"]', 'Senior Software'); await page.waitForFunction(() => document.querySelectorAll('article').length === 1);
      await page.click('input[aria-label="Search jobs"]', { clickCount: 3 }); await page.keyboard.press('Backspace'); await page.waitForFunction(() => document.querySelectorAll('article').length === 20);
      assert.equal(await page.$eval('select[aria-label="Filter by applied status"]',element=>element.value),'not-applied');
      assert.match(await page.$eval('article time',element=>element.textContent),/^Added \d+ mins ago$/);
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
      for(const [days,count] of [['1',1],['3',3],['7',7],['14',14]]) {await page.select('select[aria-label="Filter by added time"]',days);await page.waitForFunction(count=>document.querySelectorAll('article').length===count,{},count);}
      await page.select('select[aria-label="Filter by added time"]','30');await page.waitForFunction(()=>document.querySelectorAll('article').length===20);
      await page.select('select[aria-label="Filter by applied status"]','all');await page.waitForSelector('article');
      await page.select('select[aria-label="Filter by added time"]','all');await page.waitForSelector('article');
      check(role+' applied marks survive refresh, undo works in preview, and date/status filters work');
      if (role === 'MASTER') {
        await page.$eval('[data-testid="job-scroll-sentinel"]',element=>element.scrollIntoView());await page.waitForFunction(()=>document.querySelectorAll('article').length===25);
        const scrollBeforeImport=await page.evaluate(()=>window.scrollY);
        latestImport={id:'next-import',startedAt:new Date().toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),intervalHours:1};
        arrivals.push({...jobs[0],addedBatchId:latestImport.id,createdAt:new Date().toISOString(),id:'new-import',title:'Newly Imported Software Engineer',jobUrl:'https://example.com/new-import',postedAt:new Date().toISOString()});
        await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
        await page.waitForFunction(()=>document.body.innerText.includes('1 new matching job has been imported.'));
        assert.equal(await page.$$eval('article',items=>items.length),25);assert.equal(await page.evaluate(()=>window.scrollY),scrollBeforeImport);
        await page.waitForFunction(()=>document.querySelector('[data-job-id="job-2"]')?.dataset.jobState==='Unviewed');
        assert.equal(await page.$eval('[data-job-id="job-1"]',el=>el.dataset.jobState),'Viewed');
        assert.equal(await page.$$eval('article[data-job-new="true"]',els=>els.length),0);
        check('A new import group removes old New marks in place and preserves Viewed history, loaded rows and scroll');
        await click('Refresh job list');await page.waitForFunction(()=>document.querySelector('article button')?.textContent==='Newly Imported Software Engineer');
        assert.equal(await page.$eval('[data-job-id="new-import"]',el=>el.dataset.jobNew),'true');
        check('Live import notification updates the total without clearing scrolled jobs, then refreshes the list on request');
        await click('Start automatic imports'); await page.waitForFunction(() => document.body.innerText.includes('Automatic imports on'));
        await click('Pause imports'); await page.waitForFunction(() => document.body.innerText.includes('Automatic imports paused'));
        await click('Import jobs now'); await page.waitForFunction(() => document.body.innerText.includes('1 source queued.'));
        await click('Manage sources'); await page.waitForSelector('input[aria-label="Enable Jobicy"]'); check('Master starts, pauses and manually runs imports');
        assert.equal(await page.$$eval('tbody tr',rows=>rows.length),50);
        await page.evaluate(()=>{document.querySelector('details').open=true;});
        await click('Next sources'); await page.waitForFunction(pages=>document.body.textContent.includes('Page 2 of '+pages),{},Math.ceil(management.sources.length/50));
        await click('Previous sources');
        await page.type('input[placeholder="Company or provider…"]','Company board 4110'); await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===1);
        await page.click('input[placeholder="Company or provider…"]',{clickCount:3});await page.keyboard.press('Backspace');await page.waitForFunction(()=>document.querySelectorAll('tbody tr').length===50);
        check('Master can search and paginate 30,000 sources while rendering 50 table rows');
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
        assert.equal(await page.$eval('[role="dialog"] a[target="_blank"]', element => element.href), jobs[0].jobUrl);
        await page.screenshot({ path: path.join(directory, `${role.toLowerCase()}-application.png`), fullPage: true });
        await click('Save and prepare resume'); await page.waitForFunction(() => location.pathname === '/applications/saved-app');
        assert.ok(writes.some(([route, body]) => route === '/job-pool/jobs/job-0/apply' && body.profileId === 'my-profile')); check(`${role} prepares an application with its selected profile and original job link`);
        await page.setViewport({ width: 390, height: 844 }); await page.goto(`${base}/job-pool`, { waitUntil: 'networkidle0' }); await page.waitForSelector('article');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await page.screenshot({ path: path.join(directory, `${role.toLowerCase()}-mobile.png`), fullPage: true }); check(`${role} layout fits a mobile screen`);
      }
      if(role==='BIDDER') {
        await page.setViewport({width:1440,height:1000});
        await page.click('article a[href="/applications/saved-app"]');await page.waitForFunction(()=>location.pathname==='/applications/saved-app');
        check('Company-match link opens my existing application');
        await page.goto(base+'/applications?new=1',{waitUntil:'networkidle0'});await page.waitForSelector('[role="dialog"] textarea');
        await fill('Job Title','Software Engineer');await fill('Company','Example Company');await fill('Job Description','blocked job description');
        await page.waitForFunction(()=>document.querySelector('[data-testid="jd-validation"]')?.innerText.includes('Clearance is required'));
        const createDisabled=()=>page.evaluate(()=>[...document.querySelectorAll('[role="dialog"] button')].find(b=>b.textContent.trim()==='Create').disabled);
        assert.equal(await createDisabled(),true);assert.equal(writes.filter(([route])=>route==='/applications').length,0);
        await fill('Job Description','slow blocked description');await new Promise(resolve=>setTimeout(resolve,420));await fill('Job Description','Clean remote software role');
        await page.waitForFunction(()=>document.querySelector('[data-testid="jd-validation"]')?.innerText.includes('No warnings found'));
        await new Promise(resolve=>setTimeout(resolve,950));assert.equal(await createDisabled(),false);
        await fill('Job Description','unavailable validation');await page.waitForFunction(()=>document.querySelector('[data-testid="jd-validation"]')?.innerText.includes('Validation temporarily unavailable'));assert.equal(await createDisabled(),true);
        await fill('Job Description','duplicate company');await page.waitForSelector('[data-testid="jd-validation"] input[type="checkbox"]');assert.equal(await createDisabled(),true);
        await page.click('[data-testid="jd-validation"] input[type="checkbox"]');await page.waitForFunction(()=>[...document.querySelectorAll('[role="dialog"] button')].some(b=>b.textContent.trim()==='Create'&&!b.disabled));
        assert.equal(writes.filter(([route])=>route==='/applications').length,0);
        await page.screenshot({path:path.join(directory,'jd-before-create.png')});await click('Create');await page.waitForFunction(()=>document.body.innerText.includes('Generate resume now?'));
        assert.equal(writes.filter(([route])=>route==='/applications').length,1);
        check('Web JD changes validate before saving, reject stale responses, block errors and require review before creating');
      }
      assert.deepEqual(errors, []); await context.close();
    }
    await fs.writeFile(path.join(directory, 'browser-result.json'), JSON.stringify({ passed: checks, realApiCalls: 0, providerCalls: 0 }, null, 2)); console.log(`${checks} browser checks passed.`);
  } finally { if (web) web.kill(); if (browser) await browser.close(); await fs.writeFile(path.join(directory, 'browser-web.log'), log); }
})().catch(error => { console.error(error); process.exitCode = 1; });
