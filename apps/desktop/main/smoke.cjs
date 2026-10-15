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
  const content = { contact: { name: 'Alex Morgan', title: 'Software Engineer' }, summary: 'Software engineer building reliable services.', skills: [{ Languages: 'TypeScript, Python' }], experiences: [], educations: [], certificates: [], coverLetter: { greeting: 'Dear hiring team,', paragraphs: ['I build reliable services and would welcome the opportunity to contribute.'], closing: 'Sincerely,', signatureName: 'Alex Morgan' } };
  const html = '<!doctype html><html><body style="margin:0;background:white;color:#182b3d"><div class="page" style="box-sizing:border-box;width:816px;min-height:1056px;padding:60px;font-family:Arial"><h1>Alex Morgan</h1><h2>Senior Software Engineer</h2><hr><h3>PROFESSIONAL SUMMARY</h3><p>Software engineer building reliable services and thoughtful products.</p></div></body></html>';
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
      return json({ mode: 'profile', defaultPrompt: prompt, prompts: [prompt], profiles: profiles.map(p => ({ id: p.id, name: p.firstName + ' ' + p.lastName, title: p.profileTitle, resumePromptId: 'prompt-1', coverLetterPromptId: null })), jsonRules: { combined: 'Return valid JSON.', resume: 'Return resume JSON.', 'cover-letter': 'Return cover-letter JSON.' } });
    }
    if (route === '/profiles/profile-1/generation-preference') return json({ resumePromptId: 'prompt-1', coverLetterPromptId: null });
    if (route === '/applications/app-1/generations') return json(complete ? [{ id: 'gen-1', version: 1, status: 'COMPLETED', structuredOutputJson: content, files: [] }] : []);
    if (route === '/generations/gen-1/public-link') return json(req.method === 'DELETE' ? { success: true } : { path: '/resume/qa-public-token', expiresAt: '2026-11-12T00:00:00Z' });
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
    if (route === '/applications' && req.method === 'POST') { saved = { ...data, id: 'app-1', status: 'SAVED', createdAt: new Date().toISOString(), profile, warnings: [{ id: 'warning-1', category: 'REMOTE_CONFLICT', matchedText: 'This role includes hybrid work with two days onsite each week.', behavior: warningBehavior }] }; return json(saved); }
    if (route === '/applications') return json(saved ? [{ ...saved, bidder: account(), _count: { generations: complete ? 1 : 0 }, latestGenerationId: complete ? 'gen-1' : null }] : []);
    if (route === '/applications/app-1') { if (req.method === 'PATCH') saved = { ...saved, ...data }; return json({ ...saved, generations: complete ? [{ id: 'gen-1', version: 1, status: 'COMPLETED', structuredOutputJson: content, files: [] }] : [], notes: [], statusHistory: [] }); }
    if (route.endsWith('/generation-prompt')) return json({ usedDefault: false, profileName: 'Alex Morgan' });
    if (route.endsWith('/acknowledge')) return json({ success: true });
    if (route.endsWith('/manual-generation-prompt')) return json({ experienceTitleMode: 'tailored', prompt: 'SYSTEM INSTRUCTIONS\nReturn resume JSON.\nRESUME REQUEST\nAlex Morgan.', contextHash: 'a'.repeat(64), templateId: 'template-1' });
    if (route.endsWith('/generations/manual')) { complete = true; return json({ id: 'gen-1', status: 'COMPLETED' }); }
    if (route.endsWith('/generations/stream')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: {"stage":"generating","generationId":"gen-1","characters":256}\n\n');
      await delay(1600); complete = true; res.end('data: {"stage":"completed","generationId":"gen-1"}\n\n'); return;
    }
    if (route === '/generations/gen-1') return json({ id: 'gen-1', status: 'COMPLETED', structuredOutputJson: content, files: [] });
    if (route === '/generations/gen-1/export') { await delay(400); return json({ id: 'document-1', filename: data.kind === 'COVER_LETTER' ? 'Alex_Morgan_Cover_Letter.pdf' : 'Alex_Morgan_Resume.pdf' }); }
    if (route === '/documents/document-1/download') { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end('%PDF-1.4\nQA document'); }
    if (route.endsWith('/answers') || route.endsWith('/answers/prompt')) return json({ primed: true, ack: 'yes', items: req.method === 'POST' && data.question ? [{ question: data.question, answer: 'I build reliable backend services and support distributed teams.' }] : [] });
    if (['/users', '/users/admins', '/settings/prompts', '/settings/prompt-library', '/settings/warning-rules', '/audit'].includes(route)) return json([]);
    if (route === '/settings/answer-prompt') return json({ prompt: 'Answer each question using the resume.' });
    if (route === '/settings/prompt-mode') return json({ mode: 'profile' });
    if (route === '/settings/my-prompt') return json({ role, assignmentMode: 'profile', promptSource: 'initial', effectivePrompt: { id: 'prompt-1', content: 'Use the saved profile positions.', version: 1 }, masterPrompt: { id: 'prompt-1', content: 'Use the saved profile positions.', version: 1 }, profilePrompts: [], myPrompts: [], assignedPrompts: [] });
    if (route === '/settings/ai') return role === 'MASTER' ? json({ hasApiKey: false, model: 'test-model' }) : json({ message: 'Master access required' }, 403);
    if (route === '/job-pool') return json({ enabled: false, message: 'Job pool is not enabled.', jobs: [], total: 0 });
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
    for (const [value, text] of [['/applications', 'Applications'], ['/profiles', 'Profiles'], ['/profiles/new', 'Profile Create'], ['/profiles/profile-1', 'Alex'], ['/templates/new', 'Template'], ['/templates', 'Templates'], ['/users', 'User Management'], ['/settings', 'Settings'], ['/job-pool', 'Job Pool'], ['/download', 'Windows'], ['/desktop-settings', 'Global shortcut']]) {
      await route(value); await waitFor(`document.body.innerText.includes(${JSON.stringify(text)})`); if (['/profiles','/templates','/settings'].includes(value)) await capture(`page-${value.slice(1)}`);
    }
    assert.equal(await evaluate('document.body.innerText.includes("API base URL")'), false);
    assert.ok(await evaluate(`document.body.innerText.includes(${JSON.stringify('AnchorProposal Desktop · ' + require('../package.json').version)})`));
    checks.push('All admin workspace pages, profile detail, template preview, settings and desktop preferences render');
    await route('/applications'); await waitFor('document.body.innerText.includes("Applications")');
    const before = window.isVisible(); const startQuick = Date.now(); await showQuick(); target = getQuickWindow(); await waitFor('!!document.querySelector(".quick-form select") && !document.querySelector(".quick-form fieldset").disabled'); timings.quickOpenMs = Date.now() - startQuick;
    assert.equal(window.isVisible(), before); assert.equal(await evaluate('!!document.querySelector(".desktop-sidebar")'), false); assert.ok(target.getBounds().width <= 560); checks.push('Hotkey opens only the separate application window');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".native-titlebar")).webkitAppRegion'), 'drag');
    const moved = target.getBounds(); target.setPosition(moved.x - 20, moved.y + 20); await showQuick(); assert.equal(target.getBounds().x, moved.x - 20); assert.ok(target.isMovable() && target.isResizable());
    await window.webContents.executeJavaScript('window.anchor.request("/profiles", "POST", { firstName: "New", lastName: "Profile" })', true);
    await waitFor('document.querySelector("#quick-profile").textContent.includes("New Profile")'); checks.push('Profile mutations synchronize to the open quick window; title bar can drag and position persists');
    assert.equal(await evaluate('(() => { const r = document.querySelector(".quick-footer .native-primary").getBoundingClientRect(); return r.top >= 42 && r.bottom <= innerHeight; })()'), true, 'Create action must fit in the visible quick window');
    await fill('.quick-form input', 'Senior Backend Engineer'); await fill('.quick-form .space-y-4 > div:nth-child(2) input', 'Northstar Labs'); await fill('.quick-form textarea', 'Build Java services. This role includes hybrid work with two days onsite each week.'); await capture('03-quick-application');
    await click('Create & generate'); await waitFor('!!document.querySelector(".quick-dialog")'); assert.ok((await evaluate('document.querySelector(".quick-dialog").textContent')).includes('hybrid')); await capture('04-warning'); await click('Cancel');
    assert.equal(requests.filter(r => r.route.endsWith('/generations/stream')).length, 0); await click('Create & generate'); await waitFor('!!document.querySelector(".quick-dialog")'); await click('Continue');
    await waitFor('!!document.querySelector(".progress-track")'); assert.ok(target.getBounds().height <= 390); assert.equal(requests.filter(r => r.route === '/applications' && r.method === 'POST').length, 1); await capture('05-progress');
    await waitFor('document.body.innerText.includes("Your resume is ready")'); checks.push('Warning confirmation, duplicate-safe save, streaming progress and server completion');
    target = window; await waitFor('document.body.innerText.includes("Northstar Labs")'); target = getQuickWindow(); checks.push('Open application list refreshes after quick creation without reloading the window');
    await showQuick(true); await waitFor('document.body.innerText.includes("Your resume is ready")');
    await waitFor('!!document.querySelector(".quick-result iframe")'); assert.ok(target.getBounds().height > 390);
    await click('Cover letter'); await waitFor('document.body.innerText.includes("Dear hiring team,")'); await capture('result-cover-letter');
    const { dialog } = require('electron'); const originalSaveDialog = dialog.showSaveDialog;
    const savedLetter = path.join(directory, 'saved-cover-letter.pdf');
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: savedLetter });
    try { await click('Save PDF'); await waitFor('document.body.innerText.includes("Preparing cover letter PDF")'); await waitFor('document.body.innerText.includes("Saved saved-cover-letter.pdf")'); assert.match(await fs.readFile(savedLetter, 'utf8'), /^%PDF/); }
    finally { dialog.showSaveDialog = originalSaveDialog; }
    await evaluate('window.dispatchEvent(new KeyboardEvent("keydown", {key:"3",ctrlKey:true,bubbles:true}))');
    await waitFor('!!document.querySelector(".quick-answers textarea") && !document.querySelector(".quick-answers textarea").disabled');
    await fill('.quick-answers textarea', 'Why would I be a good fit?'); await evaluate('document.querySelector(".quick-answers textarea").form.requestSubmit()'); await waitFor('document.body.innerText.includes("I build reliable backend services")');
    assert.equal(window.isVisible(), before); await capture('result-answers'); checks.push('Resume preview, cover letter PDF progress, and answer chat stay in the quick window with keyboard tabs');
    const reopen = Date.now(); await showQuick(); await waitFor('!!document.querySelector(".quick-form input") && document.querySelector(".quick-form input").value === ""'); timings.quickReopenMs = Date.now() - reopen;
    await fill('.quick-form input', 'Platform Engineer'); await fill('.quick-form .space-y-4 > div:nth-child(2) input', 'Example Works'); await fill('.quick-form textarea', 'Build reliable services for distributed teams.'); await click('Manual JSON'); await click('Prepare prompt'); await waitFor('!!document.querySelector(".quick-dialog")'); assert.equal(requests.filter(r => r.route === '/applications' && r.method === 'POST').length, 2); await click('Continue'); await waitFor('!!document.querySelector("dialog[open]")'); await capture('06-manual-json'); checks.push('Repeating the hotkey starts a fresh application after completion without overwriting the previous one');
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
    await evaluate('document.querySelector("dialog[open] header button").click()');
    checks.push('Native public sharing uses the hosted website URL and revocation clears the link');
    assert.ok(requests.some(request => request.route === '/settings/generation-workflow'));
    await evaluate('window.anchor.request("/profiles/profile-1/generation-preference", "PUT", {resumePromptId:"prompt-1",coverLetterPromptId:null})');
    checks.push('Private generation settings and profile preferences use permitted native API routes');
    await route('/settings?way=separate&profile=profile-2');
    await waitFor('document.querySelector("#generation-way-panel select")?.value === "profile-2"');
    assert.ok(await evaluate('document.querySelector("#generation-way-panel").innerText.includes("Generate the resume")'));
    checks.push('Profile-specific prompt links select the requested profile and separate generation mode');
    await route('/applications/app-1'); await waitFor('[...document.querySelectorAll("button")].some(el => el.textContent === "Answers")');
    await click('Answers'); await waitFor('!!document.querySelector(".desktop-page textarea")'); await fill('.desktop-page textarea', 'Why would I be a good fit?'); await evaluate('document.querySelector(".desktop-page textarea").form.requestSubmit()'); await waitFor('document.body.innerText.includes("I build reliable backend services")'); await capture('08-answer-chat'); checks.push('Answer chat continues the saved generation conversation');
    target = getQuickWindow(); await showQuick(); await waitFor('!!document.querySelector(".quick-form input") && document.querySelector(".quick-form input").value === ""');
    await fill('.quick-form input', 'Saved without generation'); await fill('.quick-form .space-y-4 > div:nth-child(2) input', 'Example Works'); await fill('.quick-form textarea', 'An application draft.'); await evaluate('window.anchor.window("hide")'); await showQuick(); assert.equal(await evaluate('document.querySelector(".quick-form input").value'), 'Saved without generation');
    await click('Save only'); await waitFor('!document.querySelector(".quick-form fieldset").disabled'); await showQuick(); await waitFor('document.querySelector(".quick-form input").value === ""'); assert.equal(requests.filter(r => r.route === '/applications' && r.method === 'POST').length, 3); checks.push('Hiding preserves an unfinished draft; Save only clears it on the next hotkey');
    warningBehavior = 'BLOCK'; await fill('.quick-form input', 'Blocked role'); await fill('.quick-form .space-y-4 > div:nth-child(2) input', 'Example Works'); await fill('.quick-form textarea', 'This role includes hybrid work.'); await click('Prepare prompt'); await waitFor('document.body.innerText.includes("Resolve blocked warnings")'); assert.equal(await evaluate('[...document.querySelectorAll(".quick-dialog button")].some(b => b.textContent === "Continue")'), false); assert.equal(requests.filter(r => r.route.endsWith('/generations/stream')).length, 1); await click('Cancel'); checks.push('Blocked warnings cannot be bypassed in the quick form');
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
