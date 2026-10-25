// Exercises the shared web/desktop/extension Job Pool page against a local API.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..'), workspace = path.resolve(root, '../..');
const web = path.join(workspace, 'apps/web');
const puppeteer = createRequire(path.join(workspace, 'apps/api/package.json'))('puppeteer');
const directory = path.join(workspace, 'tmp/job-pool-qa', 'source-time-ui-' + Date.now());

(async () => {
  await fs.mkdir(directory, { recursive: true });
  let server, browser, page, checks = 0;
  const errors = [], changes = [], listingQueries = [];
  const check = text => { checks++; console.log('PASS ' + text); };
  const settings = { enabled: false, intervalHours: 6, excludedTitleKeywords: ['staff','principal','architect','junior','lead','director'] };
  const now = Date.now();
  const jobs = [3*3600000, 3*86400000, null].map((age,index) => ({
    id: 'source-' + index, title: index === 0 ? 'Software Engineering Manager' : 'Backend Developer ' + index,
    company: 'Source Date Fixture', location: 'Remote, United States', eligibleCountries: ['US'],
    jobUrl: 'https://example.test/job/' + index, sourceName: 'Fixture', site: {id:'greenhouse',name:'Greenhouse'},
    workArrangement:'REMOTE', publishedAt: age === null ? null : new Date(now-age).toISOString(),
    createdAt: new Date(now-(index===0?3*86400000:180000)).toISOString(), postedAt: new Date().toISOString(),
    hidden:false,applied:index===1,appliedAt:null,appliedProfiles:[],viewed:false,companyMatches:[],addedBatchId:null,
  }));
  const entry = `import React from 'react';import{createRoot}from'react-dom/client';
    import JobPool from ${JSON.stringify(path.join(web,'src/app/(dashboard)/job-pool/page.tsx'))};
    import{ExtensionAuthContext}from ${JSON.stringify(path.join(root,'src/auth-context.tsx'))};
    import{NavigationProvider}from ${JSON.stringify(path.join(root,'src/navigation.tsx'))};
    import{api}from ${JSON.stringify(path.join(web,'src/lib/api.ts'))};
    const role=new URLSearchParams(location.search).get('role')||'BIDDER';
    api.setTokens(role,'fixture-only');const user={id:'fixture',role,firstName:'Alex',lastName:'Morgan',email:'qa@example.invalid'};
    createRoot(document.getElementById('root')).render(<NavigationProvider><ExtensionAuthContext.Provider value={{user,loading:false,isMaster:role==='MASTER',isAdmin:role==='MASTER'||role==='ADMIN',canBid:role!=='MASTER',login:async()=>{},logout:async()=>{}}}><JobPool/></ExtensionAuthContext.Provider></NavigationProvider>);`;
  const build = await esbuild.build({ stdin: { contents:entry, loader:'tsx', resolveDir:root }, bundle:true, write:false, format:'esm', jsx:'automatic', minify:true,
    alias:{'@/lib/auth-context':path.join(root,'src/auth-context.tsx'),'@':path.join(web,'src'),'next/navigation':path.join(root,'src/navigation.tsx'),react:path.dirname(require.resolve('react/package.json')),'react-dom':path.dirname(require.resolve('react-dom/package.json'))},
    nodePaths:[path.join(web,'node_modules'),path.join(root,'node_modules')], define:{'process.env.NODE_ENV':'"production"','process.env.NEXT_PUBLIC_API_URL':'"/backend"'} });
  const css = await fs.readFile(path.join(root,'release','v'+require('../package.json').version,'unpacked/styles.css'));
  server = http.createServer(async (req,res) => {
    const url = new URL(req.url,'http://127.0.0.1');
    const json = (data,status=200) => { res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data)); };
    if (url.pathname === '/app.js') { res.writeHead(200,{'Content-Type':'application/javascript'});return res.end(build.outputFiles[0].contents); }
    if (url.pathname === '/styles.css') { res.writeHead(200,{'Content-Type':'text/css'});return res.end(css); }
    if (url.pathname === '/') { res.writeHead(200,{'Content-Type':'text/html'});return res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); }
    if (url.pathname === '/backend/job-pool/manage') {
      if (req.headers.authorization !== 'Bearer MASTER') return json({message:'Only Master'},403);
      if (req.method === 'PATCH') { let body='';for await(const chunk of req)body+=chunk;const patch=JSON.parse(body);changes.push(patch);Object.assign(settings,patch);return json(settings); }
      return json({settings,sources:[],providers:[],coverage:[],sourceStats:{totalSources:0,enabledSources:0,importing:false}});
    }
    if (url.pathname === '/backend/job-pool') {
      listingQueries.push(Object.fromEntries(url.searchParams));
      const days = url.searchParams.get('days') || 'all';
      const field = url.searchParams.get('sort') === 'imported' ? 'createdAt' : 'publishedAt', time=value=>value?Date.parse(value):-Infinity;
      const visible = jobs.filter(job => !settings.excludedTitleKeywords.some(term=>job.title.toLowerCase().includes(term)) && (days==='all'||job.publishedAt&&Date.parse(job.publishedAt)>=Date.now()-Number(days)*86400000))
        .sort((a,b)=>time(b[field])-time(a[field])||(a.id<b.id?1:a.id>b.id?-1:0));
      return json({jobs:visible,total:visible.length,nextCursor:null,latestImport:null,asOf:new Date().toISOString(),sites:[]});
    }
    if (url.pathname === '/backend/job-pool/updates') return json({total:jobs.length,newCount:0,latestImport:null,checkedAt:new Date().toISOString()});
    return json({message:'No fixture for this URL'},404);
  });
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base = 'http://127.0.0.1:'+server.address().port;
    browser = await puppeteer.launch({headless:true,userDataDir:path.join(directory,'chrome-profile'),timeout:60000});
    page = await browser.newPage();page.on('pageerror',error=>errors.push(error.message));
    await page.setViewport({width:1400,height:1000});
    await page.goto(base);await page.waitForSelector('[data-job-id="source-0"]');
    assert.equal(await page.$('[aria-label="Filter by applied status"]'),null);
    assert.equal(await page.$('[role="search"] input[type="checkbox"]'),null);
    assert.equal(await page.evaluate(()=>/One job per company|New companies · last 24 hours/.test(document.body.textContent)),false);
    assert.equal(await page.$eval('[aria-label="Sort jobs"]',el=>el.value),'imported');
    assert.deepEqual(await page.$$eval('[data-job-id]',rows=>rows.map(row=>row.dataset.jobId)),['source-2','source-1','source-0']);
    assert.match(await page.$eval('[data-job-id="source-1"]',el=>el.textContent),/Applied/);
    assert.match(await page.$eval('[data-job-id="source-0"]',el=>el.textContent),/Posted 3 hours ago/);
    assert.equal(await page.$eval('[data-job-id="source-0"] time',el=>el.dateTime),jobs[0].publishedAt);
    assert.match(await page.$eval('[data-job-id="source-2"]',el=>el.textContent),/Posting time unavailable/);
    assert.equal(await page.$$eval('[data-job-id]',rows=>rows.some(row=>/Imported|First imported/.test(row.textContent))),false);
    assert.ok(listingQueries.every(query=>query.status==='all'&&!query.groupByCompany&&!query.newCompanies));
    await page.screenshot({path:path.join(directory,'import-order-wide.png')});
    await page.setViewport({width:420,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);
    await page.screenshot({path:path.join(directory,'import-order-narrow.png')});
    await page.setViewport({width:1400,height:1000});
    await page.select('[aria-label="Sort jobs"]','newest');
    await page.waitForFunction(()=>document.querySelector('[data-job-id]')?.getAttribute('data-job-id')==='source-0');
    check('Both sort orders display source posting dates, preserve unknown dates, and never display import times');
    assert.match(await page.$eval('[data-job-id="source-0"]',el=>el.textContent),/Posted 3 hours ago/);
    assert.match(await page.$eval('[data-job-id="source-1"]',el=>el.textContent),/Posted 3 days ago/);
    assert.match(await page.$eval('[data-job-id="source-2"]',el=>el.textContent),/Posting time unavailable/);
    assert.equal(await page.$('[aria-label="Excluded job title keywords"]'),null);
    await page.select('[aria-label="Filter by source posting time"]','1');
    await page.waitForFunction(()=>document.querySelectorAll('[data-job-id]').length===1);
    assert.ok(await page.$('[data-job-id="source-0"]'));
    check('Bidder rows and rolling time filter use source timestamps with an explicit missing-date label');
    await page.goto(base+'?role=ADMIN');await page.waitForSelector('[data-job-id="source-0"]');
    assert.equal(await page.$('[aria-label="Excluded job title keywords"]'),null);
    check('Admin and Bidder pages both omit Master keyword management');
    await page.goto(base+'?role=MASTER');await page.waitForSelector('[aria-label="Remove keyword lead"]');
    assert.ok(await page.$('[aria-label="Remove keyword director"]'));
    await page.click('[aria-label="Remove keyword lead"]');await page.type('#pool-title-keyword','Manager, MANAGER');
    await page.click('form button[type=submit]');await page.waitForSelector('[aria-label="Remove keyword manager"]');
    assert.equal((await page.$$('[aria-label="Remove keyword manager"]')).length,1);
    await page.select('#pool-interval','12');
    await page.waitForFunction(()=>document.querySelector('#pool-interval')?.value==='12');
    assert.ok(await page.$('[aria-label="Remove keyword manager"]'));
    assert.equal(await page.$('[aria-label="Remove keyword lead"]'),null);
    check('Master can edit normalized keywords and keep unsaved edits when other settings refresh');
    await page.evaluate(()=>[...document.querySelectorAll('button')].find(el=>el.textContent==='Save keywords').click());
    await page.waitForFunction(()=>!document.body.textContent.includes('Unsaved keyword changes'));
    assert.deepEqual(changes.find(patch=>patch.excludedTitleKeywords).excludedTitleKeywords,['staff','principal','architect','junior','director','manager']);
    assert.equal(settings.intervalHours,12);
    await page.waitForFunction(()=>!document.querySelector('[data-job-id="source-0"]'));
    await page.reload();await page.waitForSelector('[aria-label="Remove keyword manager"]');
    assert.equal(await page.$('[aria-label="Remove keyword lead"]'),null);
    check('Saved keywords persist across reloads, keep the import interval, and refresh matching jobs');
    await page.screenshot({path:path.join(directory,'master-keywords-wide.png')});
    await page.setViewport({width:420,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),true);
    await page.screenshot({path:path.join(directory,'master-keywords-narrow.png')});
    assert.deepEqual(errors,[]);
    check('Keyword controls and source times fit narrow screens without JavaScript errors');
    await fs.writeFile(path.join(directory,'result.json'),JSON.stringify({passed:checks,externalRequests:0,changes},null,2));
    console.log(`${checks} Job Pool browser checks passed. Artifacts: ${directory}`);
  } catch(error) {
    if(page) await page.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});
    throw error;
  } finally { if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve)); }
})().catch(error=>{console.error(error);process.exitCode=1;});
