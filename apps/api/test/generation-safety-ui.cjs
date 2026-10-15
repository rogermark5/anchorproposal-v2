// Browser fixtures intercept every data route; this test does not change live accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');
const {jsonOutputRules,appendJsonRules} = require('../dist/deepseek/json-rules');
const {renderCoverLetterHtml} = require('../dist/documents/cover-letter-layout');
const {TemplatesService} = require('../dist/templates/templates.service');
const {editedDocument} = require('../dist/generations/document-edits');
(async () => {
  const origin = process.env.QA_WEB_URL || 'http://127.0.0.1:3100';
  const artifacts = path.resolve(__dirname, '../../../tmp/generation-safety-ui');
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, pipe: true, timeout: 120000, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  let page;
  const requests=[];
  try {
    page = await browser.newPage(); await page.setViewport({ width: 1440, height: 1000 }); page.setDefaultTimeout(60000);
    const downloadSession = await page.createCDPSession();
    await downloadSession.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: artifacts });
    const errors = [], exports = [], downloads = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem('accessToken', 'qa-token');
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.qaClipboard = value; } } });
    });
    const cover = { greeting: 'Dear Hiring Manager,', paragraphs: ['My Java API development matches your backend services.', 'I would welcome a discussion with your team.'], closing: 'Sincerely,', signatureName: 'Jason Glenn' };
    const candidate={firstName:'Jason',lastName:'Glenn',email:'jason@example.com',experiences:[{title:'Backend Engineer',company:'Saved Employer',startDate:'2021',endDate:'2025'}],skills:[{category:'Profile',name:'Database-only skill'}],education:[],certifications:[]};
    const gens = [2, 1].map(version => ({ id: `gen-${version}`, creatorId:'user', status: 'COMPLETED', version, structuredOutputJson: { contact:{name:'Jason Glenn',title:'Backend Engineer',email:'jason@example.com'},summary:`Original summary. Version ${version}`,skills:[{Backend:'Response JSON skill'}],experiences:[{title:'Backend Engineer',company:'Saved Employer',dates:'2021 – 2025',bullets:['Built supported APIs.']}],educations:[],certificates:[],coverLetter: cover } }));
    const app = { id: 'app', profile: { id: 'profile', firstName: 'Jason', lastName: 'Glenn' }, bidder: { firstName: 'QA', lastName: 'Owner' }, jobTitle: 'Developer', company: 'Hiring Co', status: 'SAVED', createdAt: new Date().toISOString(), warnings: [], latestGenerationId: 'gen-2', latestFiles: {}, _count: { generations: 2 } };
    const html = version => `<!doctype html><html><body><div class="page" style="width:816px;min-height:1056px;padding:36px"><h1>Jason Glenn</h1><p>Version ${version}</p><p>jason@example.com</p></div></body></html>`;
    const prompt = { id: 'prompt', ownerId: 'user', name: 'My combined prompt', content: appendJsonRules('Use database facts.'), version: 1, isPublished: true, experienceTitleMode: 'saved', documentKind: 'combined' };
    let role = 'ADMIN';
    const workflow = { mode: 'profile', defaultPrompt: {...prompt,id:'default'}, prompts:[prompt], profiles:[{id:'profile',name:'Jason Glenn',title:'Software Engineer',resumePromptId:'prompt',coverLetterPromptId:null}],jsonRules:Object.fromEntries(['combined','resume','cover-letter'].map(kind=>[kind,jsonOutputRules(kind)])) };
    const coverHtml = renderCoverLetterHtml({...cover,contact:{name:'Jason Glenn',title:'Software Engineer',email:'jason@example.com',phone:'555-0100',address:'Seattle, WA'},company:'Hiring Co',jobTitle:'Developer',date:'2026-10-12'},{});
    const mutations=[], applicationWrites=[];
    const templates=new TemplatesService({});const exportVersions=[];let generationRequests=0;
    const documentPreview=(generation,content=generation.structuredOutputJson)=>{const config={contact:{showJobTitle:workflow.documentDisplay?.showJobTitle!==false}};return{html:templates.renderPreviewHtml(content,config),pageSize:'LETTER',canEdit:role!=='MASTER',content,generationId:generation.id,version:generation.version,coverLetterHtml:renderCoverLetterHtml({...content.coverLetter,contact:content.contact,company:'Hiring Co',jobTitle:'Developer',date:'2026-10-15'},config)};};
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === origin && !url.pathname.startsWith('/backend/')) return request.continue();
      const route = url.pathname.replace(/^\/backend/, '');
      requests.push(`${request.method()} ${route}`);
      const send = (body,status=200) => request.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type,Authorization,ngrok-skip-browser-warning', 'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS' }, body: JSON.stringify(body) });
      if (request.method() === 'OPTIONS') return send({});
      if (route === '/auth/me') return send({ id: 'user', role, firstName: 'QA', lastName: 'Owner' });
      if (route === '/settings/generation-workflow') return send(workflow);
      if (route === '/settings/document-display' && request.method()==='PATCH') {workflow.documentDisplay=JSON.parse(request.postData());return send(workflow.documentDisplay);}
      if (route === '/settings/my-prompt' && request.method() === 'PATCH') { const body=JSON.parse(request.postData());mutations.push(body);workflow.mode=body.mode;workflow.defaultPrompt.content=appendJsonRules(body.content);return send({}); }
      if (route === '/settings/prompt-mode' && request.method() === 'PATCH') { const body=JSON.parse(request.postData());mutations.push(body);workflow.mode=body.mode;return send(body); }
      if (route === '/settings/prompt-library' && request.method() === 'POST') { const body=JSON.parse(request.postData());const created={...body,id:'new-'+workflow.prompts.length,ownerId:'user',isPublished:true,content:appendJsonRules(body.content,body.documentKind)};workflow.prompts.push(created);mutations.push(created);return send(created); }
      if (route === '/profiles/profile/generation-preference' && request.method() === 'PUT') { const body=JSON.parse(request.postData());mutations.push(body);Object.assign(workflow.profiles[0],body);return send(body); }
      if (route === '/application-options') return send({locations:[],sources:[]});
      if (route === '/applications' && request.method()==='POST') { const body=JSON.parse(request.postData());applicationWrites.push(body);Object.assign(app,body,{jobUrl:body.jobUrl||null,warnings:[]});return send(app); }
      if (route === '/applications') return send([app]);
      if (route === '/applications/app' && request.method()==='PATCH') { const body=JSON.parse(request.postData());applicationWrites.push(body);Object.assign(app,body,{jobUrl:body.jobUrl||null});return send(app); }
      if (route === '/applications/app') return send({...app,generations:gens});
      if (route === '/applications/app/generation-prompt') return send({usedDefault:false,promptName:'My prompt',profileName:'Jason Glenn'});
      if (route === '/applications/app/generations' && request.method()==='POST') {generationRequests++;return send(gens[0]);}
      if (route === '/applications/app/generations') return send(gens);
      if (/^\/generations\/gen-\d+$/.test(route)) return send(gens.find(gen=>route.endsWith(gen.id)));
      if (/^\/generations\/gen-\d+\/preview$/.test(route)) return send(documentPreview(gens.find(gen=>route.includes('/'+gen.id+'/'))));
      if (/^\/generations\/gen-\d+\/draft-preview$/.test(route)) {try{const original=gens.find(gen=>route.includes('/'+gen.id+'/'));return send(documentPreview(original,editedDocument(original.structuredOutputJson,candidate,JSON.parse(request.postData()))));}catch(error){return send({message:[error.issues?.[0]?.message||error.message]},400);}}
      if (/^\/generations\/gen-\d+\/edits$/.test(route)) {try{const original=gens.find(gen=>route.includes('/'+gen.id+'/'));const content=editedDocument(original.structuredOutputJson,candidate,JSON.parse(request.postData()));const generation={id:'gen-'+(gens.length+1),version:gens.length+1,status:'COMPLETED',structuredOutputJson:content};gens.unshift(generation);app.latestGenerationId=generation.id;app._count.generations=gens.length;return send({generation,preview:documentPreview(generation)});}catch(error){return send({message:[error.issues?.[0]?.message||error.message]},400);}}
      if (/\/generations\/gen-\d+\/export/.test(route)) { const input = JSON.parse(request.postData()); exports.push(input.kind);exportVersions.push(route.split('/')[2]); return send({ id: input.kind, filename: `${input.kind}.pdf` }); }
      if (route.startsWith('/documents/')) { downloads.push(route); return request.respond({ status: 200, contentType: 'application/pdf', headers: { 'Access-Control-Allow-Origin': origin }, body: '%PDF-1.4\nQA fixture' }); }
      if (route.endsWith('/public-link')) return send(request.method() === 'DELETE' ? { success: true } : { path: '/resume/encrypted-test-token', expiresAt: new Date(Date.now() + 10000).toISOString() });
      if (route === '/settings/my-prompt') return send({ role: 'ADMIN', useMasterPrompt: false, assignmentMode: 'profile', effectivePrompt: prompt, myPrompt: prompt, masterPrompt: prompt });
      if (route.startsWith('/settings/prompt-library')) return send([prompt]);
      if (route === '/settings/answer-prompt') return send({ prompt: 'Reply yes.' });
      if (route === '/profiles') return send([{ id: 'profile', firstName: 'Jason', lastName: 'Glenn' }]);
      if (route === '/profiles/profile') return send({ id: 'profile', firstName: 'Jason', lastName: 'Glenn', experiences: [], skills: [], education: [] });
      if (route === '/profiles/profile/generation-preference') return send({ resumePromptId: 'prompt', coverLetterPromptId: 'prompt' });
      if (route === '/templates') return send([{id:'template',name:'Default template',isPublished:true,isDefault:true}]);
      if (route.startsWith('/public/resumes/')) return send(documentPreview(gens[0]));
      if (url.port === '3001' || url.pathname.startsWith('/backend/')) return send([]);
      return request.abort();
    });
    const click = async text => { const button = await page.waitForFunction(text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text && !button.disabled), {}, text); await button.asElement().click(); };
    const fill=async(selector,text)=>{await page.focus(selector);await page.keyboard.down('Control');await page.keyboard.press('A');await page.keyboard.up('Control');await page.keyboard.press('Backspace');await page.keyboard.type(text);};
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
    await page.setViewport({width:1440,height:1000});await click('Edit documents');
    await fill('[aria-label="Edit professional summary"]','');await click('Save and rebuild');await page.waitForSelector('dialog [role="alert"]');assert.equal(gens.length,2);
    await fill('[aria-label="Edit professional summary"]','Edited summary for reliable backend APIs.');
    await fill('[aria-label="Skills 1"]','Fastify, PostgreSQL');await fill('[aria-label="Experience position 1"]','Senior Backend Engineer');
    await fill('[aria-label="Experience bullets 1"]','Edited supported API achievement.');
    await click('+ Add education');await fill('[aria-label="Education degree 1"]','BSc');await fill('[aria-label="Education institution 1"]','User correction');
    await fill('[aria-label="Edit cover letter paragraphs"]','Edited opening for the company.\n\nMy supported API experience matches the role.\n\nI welcome a discussion.\nSincerely,\nWrong person');
    await click('Preview changes');await page.waitForFunction(()=>document.querySelector('dialog iframe')?.srcdoc.includes('Edited summary'));
    assert.equal(gens.length,2);await page.screenshot({path:path.join(artifacts,'document-editor-desktop.png'),fullPage:true});
    await page.setViewport({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(artifacts,'document-editor-mobile.png'),fullPage:true});
    await click('Save and rebuild');await page.waitForFunction(()=>document.querySelector('[aria-label="Resume version"]')?.value==='gen-3'&&!document.querySelector('[aria-label="Document content editor"]'));
    await page.waitForFunction(()=>document.querySelector('dialog iframe')?.srcdoc.includes('Edited summary'));
    assert.deepEqual(gens[0].structuredOutputJson.skills,[{Backend:'Fastify, PostgreSQL'}]);assert.equal(gens[0].structuredOutputJson.contact.name,'Jason Glenn');
    await click('Auto download resume + cover letter');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent.includes('Auto download')&&!button.disabled));assert.deepEqual(exportVersions.slice(-2),['gen-3','gen-3']);
    await page.click('[aria-label="Close preview"]');
    // Create without a link, add one, then remove it through the edit form.
    await page.setViewport({width:1440,height:1000});await page.goto(`${origin}/applications`,{waitUntil:'networkidle2'});await click('New Application');await page.waitForSelector('[role="dialog"] #app-job-url');
    await fill('[role="dialog"] input:not([type])','No link developer');
    await (await page.$$('[role="dialog"] input:not([type])'))[1].type('No link company');await fill('[role="dialog"] textarea','Build supported APIs.');
    await page.click('[role="dialog"] input[type="checkbox"]');
    assert.equal(await page.$eval('#app-job-url',input=>input.value),'');assert.equal(await page.$eval('#app-job-url',input=>input.disabled),true);
    await page.screenshot({path:path.join(artifacts,'no-job-link-create.png'),fullPage:true});
    await click('Create');await page.waitForFunction(()=>document.body.innerText.includes('Generate resume now?'));
    assert.equal(applicationWrites.at(-1).jobUrl,'');await click('Skip');
    await page.click('[title="Edit"]');await page.waitForSelector('[role="dialog"] #app-job-url');
    assert.equal(await page.$eval('[role="dialog"] input[type="checkbox"]',input=>input.checked),true);
    await page.click('[role="dialog"] input[type="checkbox"]');await fill('#app-job-url','https://example.com/jobs/123');await click('Save');
    await page.waitForFunction(()=>!document.querySelector('[role="dialog"] #app-job-url'));assert.equal(applicationWrites.at(-1).jobUrl,'https://example.com/jobs/123');
    await page.click('[title="Edit"]');await page.waitForSelector('[role="dialog"] #app-job-url');await page.click('[role="dialog"] input[type="checkbox"]');await click('Save');
    await page.waitForFunction(()=>!document.querySelector('[role="dialog"] #app-job-url'));assert.equal(applicationWrites.at(-1).jobUrl,'');
    app.jobUrl='https://';await page.click('[title="Edit"]');await page.waitForSelector('[role="dialog"] #app-job-url');
    assert.equal(await page.$eval('#app-job-url',input=>input.disabled&&input.value===''),true);await click('Save');
    await page.waitForFunction(()=>!document.querySelector('[role="dialog"] #app-job-url'));assert.equal(applicationWrites.at(-1).jobUrl,'');
    console.log('PASS no-job-link create/edit, URL entry/removal, and legacy placeholder editing');
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
    await page.select('[aria-label="Header job title visibility"]','hidden');await click('Save appearance');await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Save appearance'&&button.disabled));assert.equal(workflow.documentDisplay.showJobTitle,false);
    await page.goto(`${origin}/applications`,{waitUntil:'networkidle2'});await page.click('[title="Preview resume and cover letter"]');await page.waitForSelector('dialog[open] iframe');await page.waitForFunction(()=>document.querySelector('dialog iframe')?.srcdoc.includes('Edited summary'));
    const hiddenHtml=await page.$eval('dialog iframe',frame=>frame.srcdoc);assert.ok(!hiddenHtml.includes('<div class="headline">'));assert.ok(hiddenHtml.includes('Senior Backend Engineer'));await page.click('[aria-label="Close preview"]');
    app.warnings=[{id:'duplicate-warning',category:'DUPLICATE',matchedText:'Duplicate application: this profile already has this job link. You can continue and generate a resume.',severity:'BLOCK',behavior:'BLOCK'}];
    await page.reload({waitUntil:'networkidle2'});await page.click('[title="Regenerate resume"]');await page.waitForFunction(()=>document.body.innerText.includes('Duplicate application found'));
    assert.equal(generationRequests,0);assert.equal(await page.evaluate(()=>document.body.innerText.includes('Generation is blocked by policy')),false);
    await click('Confirm and generate');await page.waitForSelector('dialog[open] iframe');assert.equal(generationRequests,1);await page.click('[aria-label="Close preview"]');
    await page.goto(`${origin}/profiles/profile`, { waitUntil: 'networkidle2' });
    await page.waitForFunction(() => document.body.innerText.includes('My generation setup'));
    for(role of ['MASTER','BIDDER']){await page.goto(`${origin}/settings`,{waitUntil:'networkidle2'});await page.waitForSelector('[role="tablist"] [role="tab"]:not([disabled])');assert.equal(await page.$$eval('[role="tablist"] [role="tab"]',items=>items.length),3);}
    await page.goto(`${origin}/resume/encrypted-test-token`, { waitUntil: 'networkidle2' }); await page.waitForSelector('iframe');
    assert.ok((await page.$eval('iframe', frame => frame.srcdoc)).includes('Jason Glenn'));
    assert.deepEqual(errors, []);
    const letterPage=await browser.newPage();await letterPage.setViewport({width:816,height:1056});await letterPage.setContent(coverHtml);await letterPage.screenshot({path:path.join(artifacts,'professional-cover-letter.png'),fullPage:true});
    console.log('PASS document editing, validation errors, saved versions, edited downloads, header visibility, duplicate confirmation, three modes, public views and mobile layout with no browser errors');
    console.log(`Screenshots: ${artifacts}`);
  } catch(error) { if(page){await page.screenshot({path:path.join(artifacts,'browser-check-failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(artifacts,'browser-check-failure.txt'),await page.evaluate(()=>document.body.innerText).catch(()=>''));}console.error('Recent fixture requests:',requests.slice(-15));throw error; } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
