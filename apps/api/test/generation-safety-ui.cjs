// Browser fixtures intercept every data route; this test does not change live accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const {jsonOutputRules,appendJsonRules} = require('../dist/deepseek/json-rules');
const {renderCoverLetterHtml} = require('../dist/documents/cover-letter-layout');
(async () => {
  const origin = process.env.QA_WEB_URL || 'http://127.0.0.1:3100';
  const artifacts = path.resolve(__dirname, '../../../tmp/generation-safety-ui');
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, pipe: true, timeout: 120000, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 1000 }); page.setDefaultTimeout(60000);
    const downloadSession = await page.createCDPSession();
    await downloadSession.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: artifacts });
    const errors = [], exports = [], downloads = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('accessToken', 'qa-token');
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.qaClipboard = value; } } });
    });
    const cover = { greeting: 'Dear Hiring Manager,', paragraphs: ['My Java API development matches your backend services.', 'I would welcome a discussion with your team.'], closing: 'Sincerely,', signatureName: 'Jason Glenn' };
    const gens = [2, 1].map(version => ({ id: `gen-${version}`, status: 'COMPLETED', version, structuredOutputJson: { coverLetter: cover } }));
    const app = { id: 'app', profile: { id: 'profile', firstName: 'Jason', lastName: 'Glenn' }, bidder: { firstName: 'QA', lastName: 'Owner' }, jobTitle: 'Developer', company: 'Hiring Co', status: 'SAVED', createdAt: new Date().toISOString(), warnings: [], latestGenerationId: 'gen-2', latestFiles: {}, _count: { generations: 2 } };
    const html = version => `<!doctype html><html><body><div class="page" style="width:816px;min-height:1056px;padding:36px"><h1>Jason Glenn</h1><p>Version ${version}</p><p>jason@example.com</p></div></body></html>`;
    const prompt = { id: 'prompt', ownerId: 'user', name: 'My combined prompt', content: appendJsonRules('Use database facts.'), version: 1, isPublished: true, experienceTitleMode: 'saved', documentKind: 'combined' };
    let role = 'ADMIN';
    const workflow = { mode: 'profile', defaultPrompt: {...prompt,id:'default'}, prompts:[prompt], profiles:[{id:'profile',name:'Jason Glenn',title:'Software Engineer',resumePromptId:'prompt',coverLetterPromptId:null}],jsonRules:Object.fromEntries(['combined','resume','cover-letter'].map(kind=>[kind,jsonOutputRules(kind)])) };
    const coverHtml = renderCoverLetterHtml({...cover,contact:{name:'Jason Glenn',title:'Software Engineer',email:'jason@example.com',phone:'555-0100',address:'Seattle, WA'},company:'Hiring Co',jobTitle:'Developer',date:'2026-10-12'},{});
    const mutations=[];
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === origin && !url.pathname.startsWith('/backend/')) return request.continue();
      const route = url.pathname.replace(/^\/backend/, '');
      const send = body => request.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type,Authorization,ngrok-skip-browser-warning', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' }, body: JSON.stringify(body) });
      if (request.method() === 'OPTIONS') return send({});
      if (route === '/auth/me') return send({ id: 'user', role, firstName: 'QA', lastName: 'Owner' });
      if (route === '/settings/generation-workflow') return send(workflow);
      if (route === '/settings/my-prompt' && request.method() === 'PATCH') { const body=JSON.parse(request.postData());mutations.push(body);workflow.mode=body.mode;workflow.defaultPrompt.content=appendJsonRules(body.content);return send({}); }
      if (route === '/settings/prompt-mode' && request.method() === 'PATCH') { const body=JSON.parse(request.postData());mutations.push(body);workflow.mode=body.mode;return send(body); }
      if (route === '/settings/prompt-library' && request.method() === 'POST') { const body=JSON.parse(request.postData());const created={...body,id:'new-'+workflow.prompts.length,ownerId:'user',isPublished:true,content:appendJsonRules(body.content,body.documentKind)};workflow.prompts.push(created);mutations.push(created);return send(created); }
      if (route === '/profiles/profile/generation-preference' && request.method() === 'PUT') { const body=JSON.parse(request.postData());mutations.push(body);Object.assign(workflow.profiles[0],body);return send(body); }
      if (route === '/applications') return send([app]);
      if (route === '/applications/app/generations') return send(gens);
      if (/\/generations\/gen-\d\/preview/.test(route)) return send({ html: html(route.includes('gen-1') ? 1 : 2), coverLetterHtml:coverHtml, pageSize: 'LETTER' });
      if (/\/generations\/gen-\d\/export/.test(route)) { const input = JSON.parse(request.postData()); exports.push(input.kind); return send({ id: input.kind, filename: `${input.kind}.pdf` }); }
      if (route.startsWith('/documents/')) { downloads.push(route); return request.respond({ status: 200, contentType: 'application/pdf', headers: { 'Access-Control-Allow-Origin': origin }, body: '%PDF-1.4\nQA fixture' }); }
      if (route.endsWith('/public-link')) return send(request.method() === 'DELETE' ? { success: true } : { path: '/resume/encrypted-test-token', expiresAt: new Date(Date.now() + 10000).toISOString() });
      if (route === '/settings/my-prompt') return send({ role: 'ADMIN', useMasterPrompt: false, assignmentMode: 'profile', effectivePrompt: prompt, myPrompt: prompt, masterPrompt: prompt });
      if (route.startsWith('/settings/prompt-library')) return send([prompt]);
      if (route === '/settings/answer-prompt') return send({ prompt: 'Reply yes.' });
      if (route === '/profiles') return send([{ id: 'profile', firstName: 'Jason', lastName: 'Glenn' }]);
      if (route === '/profiles/profile') return send({ id: 'profile', firstName: 'Jason', lastName: 'Glenn', experiences: [], skills: [], education: [] });
      if (route === '/profiles/profile/generation-preference') return send({ resumePromptId: 'prompt', coverLetterPromptId: 'prompt' });
      if (route === '/templates') return send([]);
      if (route.startsWith('/public/resumes/')) return send({ html: html(2), pageSize: 'LETTER' });
      if (url.port === '3001' || url.pathname.startsWith('/backend/')) return send([]);
      return request.abort();
    });
    const click = async text => { const button = await page.waitForFunction(text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text && !button.disabled), {}, text); await button.asElement().click(); };
    await page.goto(`${origin}/applications`, { waitUntil: 'networkidle2', timeout: 120000 });
    await page.click('[title="Preview resume and cover letter"]'); await page.waitForSelector('dialog[open] iframe');
    assert.equal(await page.$eval('[aria-label="Resume version"]', select => select.options.length), 2);
    await page.select('[aria-label="Resume version"]', 'gen-1');
    await page.waitForFunction(() => document.querySelector('dialog iframe')?.srcdoc.includes('Version 1'));
    await click('Auto download resume + cover letter');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('Auto download') && !button.disabled));
    assert.deepEqual(exports, ['RESUME', 'COVER_LETTER']); assert.equal(downloads.length, 2);
    await click('Create public resume link'); await page.waitForSelector('[aria-label="Public resume URL"]');
    assert.match(await page.$eval('[aria-label="Public resume URL"]', input => input.value), /\/resume\/encrypted-test-token$/);
    await click('Revoke public link');
    await page.screenshot({ path: path.join(artifacts, 'preview-desktop.png'), fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(artifacts, 'preview-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.goto(`${origin}/settings`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('[role="tablist"] [role="tab"]:not([disabled])');
    assert.equal(await page.$$eval('[role="tablist"] [role="tab"]', inputs => inputs.length), 3);
    await page.waitForSelector('[aria-label="Combined resume + cover letter prompt"]');
    assert.equal(await page.$('[aria-label="Cover letter prompt"]'),null);
    await page.click('[role="tablist"] [role="tab"]:nth-child(1)');
    await page.waitForSelector('[aria-label="Your prompt for all profiles"]');
    assert.equal(await page.$('[aria-label="Profile to configure"]'),null);
    await page.focus('[aria-label="Your prompt for all profiles"]');await page.keyboard.press('End');await page.keyboard.type(' Keep the tone concise.');
    await click('Save and use this way');await page.waitForFunction(()=>document.querySelector('[role="tablist"] [role="tab"]:first-child').innerText.includes('Currently used'));
    await page.setViewport({width:1440,height:1000});await page.screenshot({path:path.join(artifacts,'settings-way-1.png'),fullPage:true});
    await page.click('[role="tablist"] [role="tab"]:nth-child(2)');await page.waitForSelector('[aria-label="Combined resume + cover letter prompt"]');
    await page.screenshot({path:path.join(artifacts,'settings-way-2.png'),fullPage:true});
    await page.click('[role="tablist"] [role="tab"]:nth-child(3)');await page.waitForSelector('[aria-label="Resume prompt"]');await page.waitForSelector('[aria-label="Cover letter prompt"]');
    await click('New cover letter prompt');await page.waitForSelector('dialog[open]');
    await page.focus('dialog [aria-label="Prompt name"]');await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.type('My private letter style');
    await click('Create and select prompt');await page.waitForFunction(()=>!document.querySelector('dialog[open]'));
    await click('Save and use this way');await page.waitForFunction(()=>document.querySelector('[role="tablist"] [role="tab"]:nth-child(3)').innerText.includes('Currently used'));
    assert.equal(workflow.mode,'separate');assert.equal(workflow.profiles[0].coverLetterPromptId,'new-1');assert.ok(mutations.some(item=>item.documentKind==='cover-letter'&&item.ownerId==='user'));
    await page.screenshot({path:path.join(artifacts,'settings-way-3.png'),fullPage:true});
    await page.setViewport({width:390,height:844});await page.screenshot({path:path.join(artifacts,'settings-way-3-mobile.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.goto(`${origin}/profiles/profile`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('My generation setup'));
    for(role of ['MASTER','BIDDER']){await page.goto(`${origin}/settings`,{waitUntil:'networkidle2'});await page.waitForSelector('[role="tablist"] [role="tab"]:not([disabled])');assert.equal(await page.$$eval('[role="tablist"] [role="tab"]',items=>items.length),3);}
    await page.goto(`${origin}/resume/encrypted-test-token`, { waitUntil: 'networkidle2' }); await page.waitForSelector('iframe');
    assert.ok((await page.$eval('iframe', frame => frame.srcdoc)).includes('Jason Glenn'));
    assert.deepEqual(errors, []);
    const letterPage=await browser.newPage();await letterPage.setViewport({width:816,height:1056});await letterPage.setContent(coverHtml);await letterPage.screenshot({path:path.join(artifacts,'professional-cover-letter.png'),fullPage:true});
    console.log('PASS version selection, both downloads, share/revoke, three modes, profile prompts, public view, mobile layout, and no browser errors');
    console.log(`Screenshots: ${artifacts}`);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
