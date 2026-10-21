// Development-only native integration checks. Never included in distributed executables.
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { DESKTOP_API_SERVER } = require('./security.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run({ window, auth, settings, safeStorage, globalShortcut, directory, showQuick, getQuickWindow, send }) {
  const checks = [], requests = [], errors = []; const timings = {}; let saved = null, complete = false, role = 'ADMIN', warningBehavior = 'CONFIRM', release = null;
  const account = () => ({ id: 'qa-user', email: 'alex@qa.invalid', firstName: 'Alex', lastName: 'Morgan', role, canCreateApplications: true, canGenerateResumes: true, canDownloadDocuments: true });
  const profile = { id: 'profile-1', firstName: 'Alex', lastName: 'Morgan', email: 'alex@example.test', profileTitle: 'Senior Software Engineer', isDefault: true, experiences: [], educations: [], certificates: [], technicalSkills: [] };
  const profiles = [profile];
  const template = { id: 'template-1', name: 'Modern Executive', preset: 'modern', isDefault: true, isPublished: true, version: 1, configJson: {} };
  const content = { contact: { name: 'Alex Morgan', title: 'Software Engineer', email: profile.email }, summary: 'Software engineer building reliable services.', skills: [{ Languages: 'TypeScript, Python' }], experiences: [], educations: [], certificates: [], coverLetter: { greeting: 'Dear hiring team,', paragraphs: ['I build reliable services and would welcome the opportunity to contribute.'], closing: 'Sincerely,', signatureName: 'Alex Morgan' } };
  const html = '<!doctype html><html><body style="margin:0;background:white;color:#182b3d"><div class="page" style="box-sizing:border-box;width:816px;min-height:1056px;padding:60px;font-family:Arial"><h1>Alex Morgan</h1><h2>Senior Software Engineer</h2><hr><h3>PROFESSIONAL SUMMARY</h3><p>Software engineer building reliable services and thoughtful products.</p></div></body></html>';
  const generations = [{ id: 'gen-1', version: 1, status: 'COMPLETED', structuredOutputJson: content, files: [] }];
  const documentDisplay = { showJobTitle: true };
  let latestImport={id:'native-initial',startedAt:new Date(Date.now()-3600000).toISOString(),endsAt:new Date().toISOString(),intervalHours:1};
  const poolJobs = Array.from({length:5},(_,index)=>({id:`qa-pool-${index}`,addedBatchId:index===4?null:'native-initial',title:`Native Software Engineer ${index}`,company:'Fixture Company',location:'Remote, United States',eligibleCountries:['US'],jobUrl:'https://example.invalid/job',sourceId:null,sourceName:'QA only',site:{id:'greenhouse',name:'Greenhouse'},appliedProfiles:index===2?[{profileId:'profile-1',profileName:'Alex Morgan',appliedAt:new Date().toISOString()}]:[],workArrangement:'REMOTE',description:'Mock-only software job.',createdAt:new Date().toISOString(),postedAt:new Date().toISOString(),publishedAt:null,viewed:index===1,viewedAt:index===1?new Date().toISOString():null,applied:index===2,appliedAt:index===2?new Date().toISOString():null,hidden:false,companyMatches:index===3?[{id:'app-1',company:'Fixture Company',jobTitle:'Existing application',profileId:'profile-1',profileName:'Alex Morgan'}]:[]}));
  const previewFor = generation => ({ html: html.replace('Software engineer building reliable services and thoughtful products.', generation.structuredOutputJson.summary), pageSize: 'LETTER', canEdit: true, content: generation.structuredOutputJson, version: generation.version,
    coverLetterHtml: html.replace('<h3>PROFESSIONAL SUMMARY</h3><p>Software engineer building reliable services and thoughtful products.</p>', `<p>${profile.email}</p><p>Dear hiring team,</p><p>${generation.structuredOutputJson.coverLetter.paragraphs.join('</p><p>')}</p><p>Sincerely,</p><p>Alex Morgan</p>`) });
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const data = raw && req.headers['content-type']?.includes('application/json') ? JSON.parse(raw) : {}; const route = new URL(req.url, 'http://localhost').pathname;
    requests.push({ route, method: req.method });
    const json = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (route === '/auth/login' || route === '/auth/refresh') return json({ user: account(), accessToken: 'qa-access', refreshToken: 'qa-refresh' });
    if (route === '/desktop/release') return json({ available: false, releases: [] });
    if (!req.headers.authorization) return json({ message: 'Unauthorized' }, 401);
    if (route === '/auth/me') return json(account());
    if (route === '/settings/generation-workflow') {
      const prompt = { id: 'prompt-1', name: 'My prompt', content: 'Use the saved profile positions.', documentKind: 'combined', experienceTitleMode: 'saved', version: 1, isPublished: true };
      return json({ mode: 'profile', defaultPrompt: prompt, prompts: [prompt], documentDisplay, profiles: profiles.map(p => ({ id: p.id, name: p.firstName + ' ' + p.lastName, title: p.profileTitle, resumePromptId: 'prompt-1', coverLetterPromptId: null })), jsonRules: { combined: 'Return valid JSON.', resume: 'Return resume JSON.', 'cover-letter': 'Return cover-letter JSON.' } });
    }
    if (route === '/settings/document-display' && req.method === 'PATCH') { Object.assign(documentDisplay, data); return json(documentDisplay); }
    if (route === '/profiles/profile-1/generation-preference') return json({ resumePromptId: 'prompt-1', coverLetterPromptId: null });
    if (route === '/applications/app-1/generations') return json(complete ? generations : []);
    if (/^\/generations\/gen-\d+\/public-link$/.test(route)) return json(req.method === 'DELETE' ? { success: true } : { path: '/resume/qa-public-token', expiresAt: '2026-11-12T00:00:00Z' });
    const document = generations.find(generation => route === `/generations/${generation.id}` || route.startsWith(`/generations/${generation.id}/`));
    if (document && route.endsWith('/preview')) return json(previewFor(document));
    if (document && /\/(draft-preview|edits)$/.test(route)) {
      const { idempotencyKey, ...edits } = data;
      const edited = { id: `gen-${generations.length + 1}`, version: generations.length + 1, status: 'COMPLETED', files: [], structuredOutputJson: { ...document.structuredOutputJson, ...edits } };
      if (route.endsWith('/draft-preview')) return json(previewFor(edited));
      generations.unshift(edited); return json({ generation: edited, preview: previewFor(edited) });
    }
    if (document && route === `/generations/${document.id}`) return json(document);
    if (route === '/auth/logout') return json({ success: true });
    if (route === '/dashboard/metrics') return json({ kpis: { total: 24, applied: 18, readyToApply: 6, interviews: 4, offers: 1, warnings: 2 }, trend: [], recentGenerations: [], byAdmin: [], byBidder: [], filterOptions: { admins: [], bidders: [] } });
    if (route === '/profiles') { if (req.method === 'POST') { const created = { ...profile, ...data, id: 'profile-2', isDefault: false }; profiles.push(created); return json(created); } return json(profiles); }
    if (route === '/profiles/assigned') return json([{ profileId: profile.id, profile, isDefault: true }]);
    if (route === '/profiles/default' || route === '/profiles/profile-1') return json(profile);
    if (route === '/profiles/profile-1/prompt-assignments') return json({ mode: 'profile', profile, prompts: [], bidders: [] });
    if (route === '/templates') return json([template]);
    if (route === '/templates/template-1') return json(template);
    if (route.includes('/preview')) return json({ html, pageSize: 'LETTER' });
    if (route === '/application-options') return json({ locations: [{ id: 'location-1', type: 'LOCATION', value: 'Remote', isDefault: true }], sources: [{ id: 'source-1', type: 'SOURCE', value: 'LinkedIn', isDefault: true }] });
    if (route === '/applications/validate') {
      if (data.jobDescription.includes('stale warning')) { await delay(700); return json({warnings:[{category:'REMOTE_CONFLICT',matchedText:'Stale response must be ignored',behavior:'BLOCK',severity:'BLOCK'}],allowed:false}); }
      const warnings = [{category:'REMOTE_CONFLICT',matchedText:'This role includes hybrid work with two days onsite each week.',behavior:warningBehavior,severity:warningBehavior}];
      return json({warnings,allowed:warningBehavior !== 'BLOCK',requiresConfirmation:warningBehavior === 'CONFIRM'});
    }
    if (route === '/applications' && req.method === 'POST') { saved = { ...data, id: 'app-1', status: 'SAVED', createdAt: new Date().toISOString(), profile, warnings: [{ id: 'warning-1', category: 'REMOTE_CONFLICT', matchedText: 'This role includes hybrid work with two days onsite each week.', behavior: warningBehavior }] }; return json(saved); }
    if (route === '/applications') return json(saved ? [{ ...saved, bidder: account(), _count: { generations: complete ? generations.length : 0 }, latestGenerationId: complete ? generations[0].id : null }] : []);
    if (route === '/applications/app-1') { if (req.method === 'PATCH') saved = { ...saved, ...data }; return json({ ...saved, generations: complete ? generations : [], notes: [], statusHistory: [] }); }
    if (route.endsWith('/generation-prompt')) return json({ usedDefault: false, profileName: 'Alex Morgan' });
    if (route.endsWith('/acknowledge')) return json({ success: true });
    if (route.endsWith('/manual-generation-prompt')) return json({ experienceTitleMode: 'tailored', prompt: 'SYSTEM INSTRUCTIONS\nReturn resume JSON.\nRESUME REQUEST\nAlex Morgan.', contextHash: 'a'.repeat(64), templateId: 'template-1' });
    if (route.endsWith('/generations/manual')) { complete = true; return json({ id: 'gen-1', status: 'COMPLETED' }); }
    if (route.endsWith('/generations/stream')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: {"stage":"generating","generationId":"gen-1","characters":256}\n\n');
      await delay(1600); complete = true; res.end('data: {"stage":"completed","generationId":"gen-1"}\n\n'); return;
    }
    if (route === '/generations/gen-1') return json({ id: 'gen-1', status: 'COMPLETED', structuredOutputJson: content, files: [] });
    if (/^\/generations\/gen-\d+\/export$/.test(route)) { await delay(400); return json({ id: 'document-1', filename: data.kind === 'COVER_LETTER' ? 'Alex_Morgan_Cover_Letter.pdf' : 'Alex_Morgan_Resume.pdf' }); }
    if (route === '/documents/document-1/download') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end('%PDF-1.4\nQA document'); }
    if (route.endsWith('/answers') || route.endsWith('/answers/prompt')) return json({ primed: true, ack: 'yes', items: req.method === 'POST' && data.question ? [{ question: data.question, answer: 'I build reliable backend services and support distributed teams.' }] : [] });
    if (['/users', '/users/admins', '/settings/prompts', '/settings/prompt-library', '/settings/warning-rules', '/audit'].includes(route)) return json([]);
    if (route === '/settings/answer-prompt') return json({ prompt: 'Answer each question using the resume.' });
    if (route === '/settings/prompt-mode') return json({ mode: 'profile' });
    if (route === '/settings/my-prompt') return json({ role, assignmentMode: 'profile', promptSource: 'initial', effectivePrompt: { id: 'prompt-1', content: 'Use the saved profile positions.', version: 1 }, masterPrompt: { id: 'prompt-1', content: 'Use the saved profile positions.', version: 1 }, profilePrompts: [], myPrompts: [], assignedPrompts: [] });
    if (route === '/settings/ai') return role === 'MASTER' ? json({ hasApiKey: false, model: 'test-model' }) : json({ message: 'Master access required' }, 403);
    if (route === '/job-pool') { const status=new URL(req.url,'http://localhost').searchParams.get('status')||'not-applied';const jobs=poolJobs.filter(job=>status==='all'||(status==='applied')===job.applied);return json({ latestImport,asOf:new Date().toISOString(),jobs,total:jobs.length,nextCursor:null,sites:[] }); }
    if (/^\/job-pool\/jobs\/qa-pool-\d+/.test(route)) {const job=poolJobs.find(job=>route===`/job-pool/jobs/${job.id}`||route===`/job-pool/jobs/${job.id}/viewed`);if(!job)return json({message:'Not found'},404);if(route.endsWith('/viewed')){job.viewed=true;job.viewedAt ||= new Date().toISOString();return json({viewed:true,viewedAt:job.viewedAt});}return json(job);}
    if (route === '/job-pool/updates') return json({ latestImport,total:poolJobs.length, newCount:0, checkedAt: new Date().toISOString() });
    if (route.startsWith('/desktop/manage/releases')) {
      if (role !== 'MASTER') return json({ message: 'Master access required' }, 403);
      if (req.method === 'POST' && route === '/desktop/manage/releases') { release = { id: 'release-qa', version: data.version, notes: data.notes, createdAt: new Date().toISOString(), downloads: {}, published: false }; return json(release); }
      if (route.endsWith('/files/portable') && req.method === 'POST') {
        assert.match(req.headers['content-type'], /multipart\/form-data; boundary=/); assert.match(raw, /filename="QA.exe"/); assert.match(raw, /MZ-QA-EXECUTABLE/);
        release.downloads.portable = { bytes: 16, sha256: '0'.repeat(64) }; return json({ success: true });
      }
      if (req.method === 'PATCH') { release.published = data.action === 'publish'; return json(release); }
      return json({ latestId: release?.published ? release.id : null, releases: release ? [release] : [] });
    }
    errors.push(`${req.method} ${route}`); return json({ message: `Unexpected test route ${route}` }, 404);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const originalFetch = auth.fetcher;
  auth.fetcher = (url, options) => {
    assert.ok(url.startsWith(DESKTOP_API_SERVER + '/'), 'All desktop requests must use the fixed production API.');
    return fetch(`http://127.0.0.1:${server.address().port}${url.slice(DESKTOP_API_SERVER.length)}`, options);
  };
  let target = window;
  const evaluate = async expression => { try { return await target.webContents.executeJavaScript(expression, true); } catch (error) { throw new Error(`Renderer action failed: ${expression.slice(0, 350)}\n${error.message}`); } };
  async function waitFor(expression) { const end = Date.now() + 20000; do { if (await evaluate(expression)) return; await delay(70); } while (Date.now() < end); const state = await evaluate('document.body.innerText'); await fs.writeFile(path.join(directory, 'failed-ui.txt'), state); throw new Error(`Timed out: ${expression}\n${state}`); }
  const click = text => evaluate(`(() => { const el = [...document.querySelectorAll('button')].find(el => el.textContent.trim() === ${JSON.stringify(text)} || el.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) throw new Error('Missing button: ' + ${JSON.stringify(text)}); el.click(); })()`);
  const fill = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error('Missing field: ' + ${JSON.stringify(selector)}); const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input',{bubbles:true})); })()`);
  const capture = async name => { await delay(350); const image = await target.webContents.capturePage(undefined, { stayHidden: true }); await fs.writeFile(path.join(directory, `${name}.png`), image.toPNG()); };
  const route = async value => { await evaluate(`location.hash=${JSON.stringify(value)}`); await delay(450); };
  try {
    const prefs = window.webContents.getLastWebPreferences(); assert.ok(prefs.sandbox && prefs.contextIsolation && !prefs.nodeIntegration);
    assert.equal(await evaluate('typeof require'), 'undefined'); assert.ok(globalShortcut.isRegistered('Control+Shift+Z')); assert.ok(safeStorage.isEncryptionAvailable()); checks.push('Isolated native renderer and registered hotkey');
    await waitFor('!!document.querySelector(".auth-view")'); assert.equal(requests.length, 0); await capture('01-sign-in');
    assert.equal(await evaluate('!!document.querySelector(".server-details, input[type=url]")'), false);
    assert.equal(settings.server, DESKTOP_API_SERVER); assert.equal(auth.server, DESKTOP_API_SERVER); assert.equal(auth.refresh, null);
    assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'settings.json'), 'utf8')).server, DESKTOP_API_SERVER);
    await assert.rejects(fs.stat(path.join(directory, 'session.json')), { code: 'ENOENT' });
    assert.match(await evaluate('window.anchor.settings({server:"http://localhost:3001"}).catch(e => e.message)'), /managed by AnchorProposal/);
    checks.push('Fixed production API replaces saved localhost settings, clears the old session, hides URL controls, and rejects server changes');
    await fill('input[autocomplete="username"]', 'alex@qa.invalid'); await fill('input[type=password]', 'qa-password');
    const loginTime = Date.now(); await click('Sign in to your workspace'); await waitFor('!!document.querySelector(".desktop-sidebar")'); timings.loginMs = Date.now() - loginTime;
    const credentials = await fs.readFile(path.join(directory, 'session.json'), 'utf8'); assert.ok(!credentials.includes('qa-access') && !credentials.includes('qa-refresh')); checks.push('Login uses server API and Windows-encrypted session');
    await waitFor('document.body.innerText.includes("Dashboard")'); await capture('02-workspace');
    for (const [value, text] of [['/applications', 'Applications'], ['/profiles', 'Profiles'], ['/profiles/new', 'Profile Create'], ['/profiles/profile-1', 'Alex'], ['/templates/new', 'Template'], ['/templates', 'Templates'], ['/users', 'User Management'], ['/settings', 'Settings'], ['/job-pool', 'Remote Software Jobs'], ['/download', 'Windows'], ['/desktop-settings', 'Global shortcut']]) {
      await route(value); await waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`); if (['/profiles','/templates','/settings','/job-pool'].includes(value)) await capture(`page-${value.slice(1)}`);
    }
    await route('/job-pool'); await waitFor('[...document.querySelectorAll("select")].some(select => select.getAttribute("aria-label") === "Filter by country")');
    assert.deepEqual(await evaluate('Array.from([...document.querySelectorAll("select")].find(select => select.getAttribute("aria-label") === "Filter by country").options).map(option => option.value)'), ['all','US','GB','IE']);
    checks.push('Native job pool includes US, UK and Ireland country filters');
      await fill('[aria-label="Filter by applied status"]','all');await waitFor('document.querySelectorAll("article[data-job-state]").length===5');
      const poolColors=await evaluate('Array.from(document.querySelectorAll("article[data-job-state]"),row=>getComputedStyle(row).backgroundColor)');
      assert.equal(new Set(poolColors).size,1,'Desktop rows must have a neutral background; status colors belong to badges');
      const poolContrast=await evaluate(`Array.from(document.querySelectorAll('article[data-job-state]')).flatMap(row=>{const lum=color=>color.match(/[\\d.]+/g).slice(0,3).map(Number).map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4).reduce((v,c,i)=>v+c*[.2126,.7152,.0722][i],0);const bg=lum(getComputedStyle(row).backgroundColor);return [row.querySelector('button[title]'),row.querySelector('time')].map(el=>{const fg=lum(getComputedStyle(el).color);return (Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05);});})`);
      assert.ok(poolContrast.every(value=>value>=4.5),'Desktop job text must stay readable on neutral rows');await capture('job-status-colors');
      checks.push('Native job rows use neutral backgrounds with readable status badges and profile names');
      await click('Native Software Engineer 0');await waitFor('document.querySelector("[data-job-id=qa-pool-0]")?.dataset.jobState==="Viewed"');await click('Close');
      await route('/dashboard');await route('/job-pool');await waitFor('document.querySelector("[data-job-id=qa-pool-0]")?.dataset.jobState==="Viewed"');
      assert.ok(requests.some(request=>request.route==='/job-pool/jobs/qa-pool-0/viewed'&&request.method==='PATCH'));
      checks.push('Native job preview persists Viewed through the permitted API route without marking Applied');
      latestImport={id:'native-next',startedAt:new Date().toISOString(),endsAt:new Date(Date.now()+3600000).toISOString(),intervalHours:1};
      poolJobs.push({...poolJobs[4],id:'qa-pool-5',title:'Latest Native Software Engineer',addedBatchId:latestImport.id});
      await evaluate('window.dispatchEvent(new Event("focus"))');
      await waitFor('document.querySelector("[data-job-id=qa-pool-0]")?.dataset.jobNew==="false"');
      assert.equal(await evaluate('document.querySelector("[data-job-id=qa-pool-0]").dataset.jobNew'),'false');
      assert.equal(await evaluate('document.querySelector("[data-job-id=qa-pool-0]").dataset.jobState'),'Viewed');
      await route('/dashboard');await route('/job-pool');await waitFor('document.querySelector("[data-job-id=qa-pool-5]")?.dataset.jobNew==="true"');
      checks.push('Native update polling moves New to the next import group while preserving Viewed');
    await route('/desktop-settings'); await waitFor('document.body.innerText.includes("Global shortcut")');
    assert.equal(await evaluate('document.body.innerText.includes("API base URL")'), false);
    assert.ok(await evaluate(`document.body.innerText.includes(${JSON.stringify('AnchorProposal Desktop · ' + require('../package.json').version)})`));
    checks.push('All admin workspace pages, profile detail, template preview, settings and desktop preferences render');
    await route('/templates');
    await waitFor('!!document.querySelector("[data-testid=template-designer] select")');
    const designerColors = await evaluate(`(() => {
      const panel = document.querySelector('[data-testid="template-designer"]');
      const controls = [...panel.querySelectorAll('input:not([type=color]):not([type=checkbox]):not([type=radio]),select')];
      const sample = node => { const style = getComputedStyle(node); return { background: style.backgroundColor, color: style.color }; };
      return { tabs: panel.querySelectorAll('[role=tab]').length, panel: sample(panel), controls: controls.map(sample) };
    })()`);
    const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = value => rgb(value).map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    assert.equal(designerColors.tabs, 12);
    for (const item of [designerColors.panel, ...designerColors.controls]) {
      assert.ok(rgb(item.background).every(channel => channel >= 220), 'Template designer and form controls must remain light in the desktop workspace');
      const values = [luminance(item.background), luminance(item.color)];
      assert.ok((Math.max(...values) + .05) / (Math.min(...values) + .05) >= 4.5, 'Template controls need readable text contrast');
    }
    await evaluate(`document.querySelector('[data-testid="template-designer"]').scrollIntoView({block:'start'})`);
    await capture('page-template-designer');
    await evaluate(`[...document.querySelectorAll('[role=tab]')].find(button => button.textContent.trim() === 'PDF Style').click()`);
    await waitFor(`document.querySelectorAll('[aria-label="Professional Themes"] button').length === 12`);
    for (const [label, count] of [['Professional Themes', 12], ['Header Accent', 16], ['Subtle Watermark', 14], ['Section Style', 16]]) {
      assert.equal(await evaluate(`document.querySelectorAll('[aria-label="${label}"] button').length`), count);
    }
    await capture('page-template-effects');
    checks.push('All reference designer tabs and style galleries render with accessible light controls in the native workspace');
    await route('/applications'); await waitFor('document.body.innerText.includes("Applications")');
    const before = window.isVisible(); const startQuick = Date.now(); await showQuick(); target = getQuickWindow(); await waitFor('!!document.querySelector(".quick-form select") && !document.querySelector(".quick-form fieldset").disabled'); timings.quickOpenMs = Date.now() - startQuick;
    assert.equal(window.isVisible(), before); assert.equal(await evaluate('!!document.querySelector(".desktop-sidebar")'), false); assert.ok(target.getBounds().width <= 560); checks.push('Hotkey opens only the separate application window');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".native-titlebar")).webkitAppRegion'), 'drag');
    const moved = target.getBounds(); target.setPosition(moved.x - 20, moved.y + 20); await showQuick(); assert.equal(target.getBounds().x, moved.x - 20); assert.ok(target.isMovable() && target.isResizable());
    await window.webContents.executeJavaScript('window.anchor.request("/profiles", "POST", { firstName: "New", lastName: "Profile" })', true);
    await waitFor('document.querySelector("#quick-profile").textContent.includes("New Profile")'); checks.push('Profile mutations synchronize to the open quick window; title bar can drag and position persists');
    assert.equal(await evaluate('(() => { const r = document.querySelector(".quick-footer .native-primary").getBoundingClientRect(); return r.top >= 42 && r.bottom <= innerHeight; })()'), true, 'Create action must fit in the visible quick window');
    await fill('.quick-form input', 'Senior Backend Engineer'); await fill('.quick-form .space-y-4 > div:nth-child(2) input', 'Northstar Labs'); await fill('.quick-form textarea', 'Build Java services. This role includes hybrid work with two days onsite each week.'); await capture('03-quick-application');
    await evaluate('document.querySelector(".quick-form input[type=checkbox]").click()');
    assert.equal(await evaluate('document.querySelector("#app-job-url").disabled && document.querySelector("#app-job-url").value === ""'), true);
    await waitFor('!!document.querySelector("[data-testid=jd-validation] input[type=checkbox]")');
    assert.equal(requests.filter(r => r.route === '/applications' && r.method === 'POST').length,0);
    assert.equal(await evaluate('document.querySelector(".quick-footer .native-primary").disabled'),true);
    await evaluate('document.querySelector("[data-testid=jd-validation] input[type=checkbox]").click()');
    checks.push('Changing the JD validates before any application is saved and requires warning review');
    await click('Create & generate'); await waitFor('!!document.querySelector(".quick-dialog")'); assert.ok((await evaluate('document.querySelector(".quick-dialog").textContent')).includes('hybrid')); await capture('04-warning'); await click('Cancel');
    assert.equal(requests.filter(r => r.route.endsWith('/generations/stream')).length, 0); await click('Create & generate'); await waitFor('!!document.querySelector(".quick-dialog")'); await click('Continue');
    await waitFor('!!document.querySelector(".progress-track")'); assert.ok(target.getBounds().height <= 390); assert.equal(requests.filter(r => r.route === '/applications' && r.method === 'POST').length, 1); await capture('05-progress');
    await waitFor('document.body.innerText.includes("Your resume is ready")'); checks.push('Warning confirmation, duplicate-safe save, streaming progress and server completion');
    assert.equal(saved.jobUrl, ''); checks.push('No job link submits an empty URL without a fake placeholder');
    target = window; await waitFor('document.body.innerText.includes("Northstar Labs")'); target = getQuickWindow(); checks.push('Open application list refreshes after quick creation without reloading the window');
    await showQuick(true); await waitFor('document.body.innerText.includes("Your resume is ready")');
    await waitFor('!!document.querySelector(".quick-result iframe")'); assert.ok(target.getBounds().height > 390);
    await click('Cover letter'); await waitFor('document.querySelector("#result-panel-1 iframe")?.srcdoc.includes("alex@example.test")'); await capture('result-cover-letter');
    checks.push('Quick cover letter uses the professional HTML preview with saved profile contact details');
    const { dialog } = require('electron'); const originalSaveDialog = dialog.showSaveDialog;
    const savedLetter = path.join(directory, 'saved-cover-letter.pdf');
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: savedLetter });
    try { await click('Save PDF'); await waitFor('document.body.innerText.includes("Preparing cover letter PDF")'); await waitFor('document.body.innerText.includes("Saved saved-cover-letter.pdf")'); assert.match(await fs.readFile(savedLetter, 'utf8'), /^%PDF/); }
    finally { dialog.showSaveDialog = originalSaveDialog; }
    await click('Preview and edit documents'); await waitFor('!!document.querySelector("dialog[open] iframe")'); await click('Edit documents');
    await fill('[aria-label="Edit professional summary"]', 'Edited desktop summary for reliable services.'); await click('Preview changes');
    await waitFor('document.querySelector("dialog iframe")?.srcdoc.includes("Edited desktop summary")'); assert.equal(generations.length, 1);
    await click('Save and rebuild'); await waitFor('document.querySelector("[aria-label=\\"Resume version\\"]")?.value === "gen-2"');
    await evaluate('document.querySelector("[aria-label=\\"Close preview\\"]").click()');
    await waitFor('!document.querySelector("dialog[open]") && !!document.querySelector("#result-panel-1 iframe")');
    assert.equal(generations.length, 2); assert.equal(generations[1].structuredOutputJson.summary, content.summary);
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(directory, 'edited-cover-letter.pdf') });
    try { await click('Save PDF'); await waitFor('document.body.innerText.includes("Saved edited-cover-letter.pdf")'); assert.ok(requests.some(request => request.route === '/generations/gen-2/export')); }
    finally { dialog.showSaveDialog = originalSaveDialog; }
    await capture('edited-quick-documents'); checks.push('Quick preview edits create a separate saved version and subsequent exports use that version');
    await evaluate('window.dispatchEvent(new KeyboardEvent("keydown", {key:"3",ctrlKey:true,bubbles:true}))');
    await waitFor('!!document.querySelector(".quick-answers textarea") && !document.querySelector(".quick-answers textarea").disabled');
    await fill('.quick-answers textarea', 'Why would I be a good fit?'); await evaluate('document.querySelector(".quick-answers textarea").form.requestSubmit()'); await waitFor('document.body.innerText.includes("I build reliable backend services")');
    assert.equal(window.isVisible(), before); await capture('result-answers'); checks.push('Resume preview, cover letter PDF progress, and answer chat stay in the quick window with keyboard tabs');
    const reopen = Date.now(); await showQuick(); await waitFor('!!document.querySelector(".quick-form input") && document.querySelector(".quick-form input").value === ""'); timings.quickReopenMs = Date.now() - reopen;
    await fill('.quick-form input', 'Platform Engineer'); await fill('.quick-form .space-y-4 > div:nth-child(2) input', 'Example Works'); await fill('.quick-form textarea', 'Build reliable services for distributed teams.'); await click('Manual JSON'); await waitFor('!!document.querySelector("[data-testid=jd-validation] input[type=checkbox]")'); await evaluate('document.querySelector("[data-testid=jd-validation] input[type=checkbox]").click()'); await click('Prepare prompt'); await waitFor('!!document.querySelector(".quick-dialog")'); assert.equal(requests.filter(r => r.route === '/applications' && r.method === 'POST').length, 2); await click('Continue'); await waitFor('!!document.querySelector("dialog[open]")'); await capture('06-manual-json'); checks.push('Repeating the hotkey starts a fresh application after completion without overwriting the previous one');
    await evaluate('window.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}))'); assert.equal(target.isVisible(), true);
    await fill('#manual-json-response', JSON.stringify({ ...content, experiences: [{ role: 'Platform Engineer', bullets: ['Built dependable services.'] }] })); await click('Save resume'); await waitFor('document.body.innerText.includes("Your resume is ready")'); checks.push('Shared manual prompt and validated JSON import saved to server');
    target = window; await route('/applications/app-1'); await waitFor('document.body.innerText.includes("Northstar") || document.body.innerText.includes("Example Works")'); checks.push('Application detail and generation history');
    await click('Files'); await waitFor('[...document.querySelectorAll("button")].some(el => el.textContent === "Preview and download both")');
    await click('Preview and download both'); await waitFor('!!document.querySelector("dialog[open] iframe")');
    await evaluate('navigator.clipboard.writeText = async value => { window.__qaCopiedLink = value; }; true');
    await click('Create public resume link'); await waitFor('!!document.querySelector("dialog[open] footer input")');
    assert.equal(await evaluate('document.querySelector("dialog[open] footer input").value'), 'https://anchorproposal.giize.com/resume/qa-public-token');
    assert.equal(await evaluate('window.__qaCopiedLink'), 'https://anchorproposal.giize.com/resume/qa-public-token');
    await capture('public-resume-link'); await click('Revoke public link'); await waitFor('!document.querySelector("dialog[open] footer input")');
    await evaluate('document.querySelector("[aria-label=\\"Close preview\\"]").click()');
    checks.push('Native public sharing uses the hosted website URL and revocation clears the link');
    assert.ok(requests.some(request => request.route === '/settings/generation-workflow'));
    await evaluate('window.anchor.request("/profiles/profile-1/generation-preference", "PUT", {resumePromptId:"prompt-1",coverLetterPromptId:null})');
    checks.push('Private generation settings and profile preferences use permitted native API routes');
    await route('/settings'); await waitFor('!!document.querySelector("[aria-label=\\"Header job title visibility\\"]")');
    await fill('[aria-label="Header job title visibility"]', 'hidden'); await click('Save appearance');
    await waitFor('[...document.querySelectorAll("button")].some(button => button.textContent === "Save appearance" && button.disabled)');
    assert.equal(documentDisplay.showJobTitle, false); checks.push('Resume header title visibility saves through the native bridge');
    await route('/settings?way=separate&profile=profile-2');
    await waitFor('document.querySelector("#generation-way-panel select")?.value === "profile-2"');
    assert.ok(await evaluate('document.querySelector("#generation-way-panel").innerText.includes("Generate the resume")'));
    checks.push('Profile-specific prompt links select the requested profile and separate generation mode');
    await route('/applications/app-1'); await waitFor('[...document.querySelectorAll("button")].some(el => el.textContent === "Answers")');
    await click('Answers'); await waitFor('!!document.querySelector(".desktop-page textarea") && !document.querySelector(".desktop-page textarea").disabled'); await fill('.desktop-page textarea', 'Why would I be a good fit?'); await waitFor('!!document.querySelector(".desktop-page textarea").form.querySelector("button[type=submit]:not(:disabled)")'); await evaluate('document.querySelector(".desktop-page textarea").form.requestSubmit()'); await waitFor('document.body.innerText.includes("I build reliable backend services")'); await capture('08-answer-chat'); checks.push('Answer chat continues the saved generation conversation');
    target = getQuickWindow(); await showQuick(); await waitFor('!!document.querySelector(".quick-form input") && document.querySelector(".quick-form input").value === ""');
    await fill('.quick-form input', 'Saved without generation'); await fill('.quick-form .space-y-4 > div:nth-child(2) input', 'Example Works'); await fill('.quick-form textarea', 'An application draft.'); await evaluate('window.anchor.window("hide")'); await showQuick(); assert.equal(await evaluate('document.querySelector(".quick-form input").value'), 'Saved without generation');
    await waitFor('!!document.querySelector("[data-testid=jd-validation] input[type=checkbox]")'); await evaluate('document.querySelector("[data-testid=jd-validation] input[type=checkbox]").click()');
    await click('Save only'); await waitFor('!document.querySelector(".quick-form fieldset").disabled'); await showQuick(); await waitFor('document.querySelector(".quick-form input").value === ""'); assert.equal(requests.filter(r => r.route === '/applications' && r.method === 'POST').length, 3); checks.push('Hiding preserves an unfinished draft; Save only clears it on the next hotkey');
    const savesBeforeBlock=requests.filter(r=>r.route==='/applications'&&r.method==='POST').length;
    warningBehavior = 'BLOCK'; await fill('.quick-form input', 'Blocked role'); await fill('.quick-form .space-y-4 > div:nth-child(2) input', 'Example Works'); await fill('.quick-form textarea', 'This role includes hybrid work.');
    await waitFor('document.querySelector("[data-testid=jd-validation]")?.innerText.includes("Resolve blocked warnings")');
    assert.equal(await evaluate('document.querySelector(".quick-footer .native-primary").disabled'),true);
    await evaluate('document.querySelector(".quick-form").requestSubmit()'); await delay(100);
    assert.equal(requests.filter(r=>r.route==='/applications'&&r.method==='POST').length,savesBeforeBlock);
    checks.push('Blocked JD validation prevents saving through both buttons and form submission');
    warningBehavior='CONFIRM';
    await fill('.quick-form textarea','stale warning'); await delay(400); await fill('.quick-form textarea','Current description');
    await waitFor('!!document.querySelector("[data-testid=jd-validation] input[type=checkbox]")'); await delay(500);
    assert.equal(await evaluate('document.querySelector("[data-testid=jd-validation]").innerText.includes("Stale response")'),false);
    checks.push('Slower responses for an old JD cannot replace validation of the current text');
    const closedQuick=target;
    await evaluate('document.querySelector(".window-close").click()');
    for(let attempt=0;attempt<40&&!closedQuick.isDestroyed();attempt++)await delay(50);
    assert.equal(closedQuick.isDestroyed(),true);assert.equal(window.isDestroyed(),false);assert.equal(globalShortcut.isRegistered(settings.hotkey),true);
    await showQuick();target=getQuickWindow();await waitFor('!!document.querySelector(".quick-form input")&&!document.querySelector(".quick-form fieldset").disabled');
    assert.equal(await evaluate('document.querySelector(".quick-form input").value'), '');
    assert.equal(await evaluate('document.querySelector(".quick-form textarea").value'),'');
    checks.push('Closing destroys only the quick form; the hotkey reopens an empty form while the desktop stays running');
    target = window; await route('/settings'); role = 'MASTER'; send({ type: 'session', signedIn: true }); await waitFor('document.body.innerText.includes("AI Provider")'); await click('AI Provider'); await waitFor('document.body.innerText.includes("Not set")'); await click('Desktop app'); await waitFor('document.body.innerText.includes("Desktop releases")');
    await waitFor('!!document.querySelector("input[placeholder=\\"1.2.3\\"]")'); await fill('input[placeholder="1.2.3"]', '0.2.0'); await fill('textarea[placeholder="What changed in this version?"]', 'Native integration test.'); await click('Create draft'); await waitFor('!!document.querySelector("input[type=file]")');
    await evaluate('(() => { const input = document.querySelector("input[aria-label=\\"Upload portable app for 0.2.0\\"]"); const transfer = new DataTransfer(); transfer.items.add(new File(["MZ-QA-EXECUTABLE"], "QA.exe", {type:"application/octet-stream"})); input.files = transfer.files; input.dispatchEvent(new Event("change", {bubbles:true})); })()');
    await waitFor('document.body.innerText.includes("SHA-256 checksum")'); await click('Publish & make latest'); await waitFor('document.body.innerText.includes("Published")'); await capture('07-master-releases'); checks.push('Master API settings, release creation, native file upload and publishing');
    role = 'BIDDER'; send({ type: 'session', signedIn: true }); await route('/dashboard'); await waitFor('![...document.querySelectorAll(".desktop-sidebar a")].some(a => a.getAttribute("href") === "#/users")'); assert.match(await evaluate('window.anchor.request("/settings/ai").catch(e => e.message)'), /Master access/); checks.push('Bidder navigation and server-enforced master permissions');
    target = getQuickWindow(); await showQuick(); await waitFor('!!document.querySelector("#quick-profile") && document.querySelector("#quick-profile").options.length === 2');
    assert.ok(requests.some(request => request.route === '/profiles/assigned')); checks.push('Bidder quick form uses assigned profiles and assignment defaults'); target = window;
    await evaluate('window.anchor.settings({hotkey:"Control+Alt+J"})'); assert.ok(globalShortcut.isRegistered('Control+Alt+J')); await evaluate('window.anchor.settings({hotkey:"Control+Shift+Z"})'); checks.push('Custom hotkey registered without restarting');
    await evaluate('window.anchor.logout()'); await waitFor('!!document.querySelector(".auth-view")'); target = getQuickWindow(); await waitFor('!!document.querySelector(".auth-view")'); assert.equal(auth.refresh, null); checks.push('Logout synchronizes both windows');
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(directory, 'result.json'), JSON.stringify({ passed: checks.length, checks, timings, providerCalls: 0 }, null, 2));
  } finally { auth.fetcher = originalFetch; await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
}
module.exports = { run };
