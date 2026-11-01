// Actual production UI with intercepted APIs; no live account changes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer');

(async () => {
  const origin = process.env.QA_WEB_URL || 'http://127.0.0.1:3198';
  const folder = path.resolve('../../tmp/job-pool-qa/profile-browser'); fs.mkdirSync(folder, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, pipe: true, args: ['--no-sandbox'], timeout: 120000, protocolTimeout: 120000 });
  const page = await browser.newPage(); page.setDefaultTimeout(30000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let role = 'MASTER', zone = 'UTC', assignments = []; const writes = [];
  const profiles = [{ id: 'own', firstName: 'Admin', lastName: 'Own', ownerId: 'admin', profileTitle: 'Engineer', updatedAt: new Date().toISOString(), _count: { applications: 0, assignments: 0 } },
    { id: 'legacy', firstName: 'Legacy', lastName: 'Candidate', ownerId: null, profileTitle: 'Developer', updatedAt: new Date().toISOString(), _count: { applications: 0, assignments: 0 } }];
  const target = () => ({ id: 'admin', role: 'ADMIN', firstName: 'QA', lastName: 'Admin', email: 'admin@qa.invalid', status: 'ACTIVE', profileAssignments: assignments, templateAssignments: [] });
  await page.evaluateOnNewDocument(() => { localStorage.setItem('accessToken', 'qa'); localStorage.setItem('refreshToken', 'qa'); });
  await page.setRequestInterception(true);
  page.on('request', request => {
    const url = new URL(request.url()); if (!url.pathname.startsWith('/backend/')) return void request.continue();
    const route = url.pathname.slice(8); let data = {};
    if (route === '/auth/me') data = { id: role === 'MASTER' ? 'master' : 'admin', role, firstName: 'QA', lastName: role, email: 'qa@qa.invalid' };
    else if (route === '/settings/time-zone') { if (request.method() === 'PATCH') zone = JSON.parse(request.postData()).timeZone; data = { timeZone: zone }; }
    else if (route === '/users') data = [target()];
    else if (route === '/users/admins') data = [target()];
    else if (route === '/users/admin/assignments') {
      const body = JSON.parse(request.postData()); writes.push(body);
      assignments = body.assignments.map(row => ({ ...row, grantedByMaster: true, profile: profiles.find(profile => profile.id === row.profileId) })); data = target();
    } else if (route === '/profiles') data = role === 'MASTER' ? profiles : profiles.filter(profile => profile.ownerId === 'admin' || assignments.some(row => row.profileId === profile.id));
    else if (['/templates', '/settings/prompt-library', '/settings/warning-rules', '/audit'].includes(route)) data = [];
    else if (route === '/settings/ai') data = { hasApiKey: false, model: 'deepseek-chat' };
    else if (route === '/settings/answer-prompt') data = { prompt: '' };
    else if (route === '/settings/my-prompt') data = { assignmentMode: 'user', myPrompts: [], assignedPrompts: [], effectivePrompt: { content: 'Write clearly.' } };
    else if (route === '/settings/generation-workflow') data = { mode: 'user', profiles: [], prompts: [], defaultPrompt: { id: 'prompt', content: 'Write grounded documents.' }, jsonRules: { combined: '{}', resume: '{}', 'cover-letter': '{}' } };
    void request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const clickText = async text => { await page.evaluate(value => { const button = Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim() === value); if (!button) throw Error('Missing button ' + value); button.click(); }, text); };
  const waitText = text => page.waitForFunction(value => document.body.innerText.includes(value), {}, text);
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(origin + '/users', { waitUntil: 'networkidle0' });
    await page.waitForSelector('button[title="Assign profiles"]'); await page.click('button[title="Assign profiles"]');
    await waitText('Admins can use profiles they create');
    await page.select('[role="dialog"] select', 'legacy');
    await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="dialog"] p')).some(el => el.textContent === 'Legacy Candidate'));
    assert.deepEqual(writes[0].assignments, [{ profileId: 'legacy', isDefault: true }]);
    await page.screenshot({ path: path.join(folder, 'master-admin-assignment.png'), fullPage: true });
    await clickText('Done'); role = 'ADMIN';
    await page.goto(origin + '/profiles', { waitUntil: 'networkidle0' }); await waitText('Legacy'); await waitText('Own');
    await page.goto(origin + '/settings', { waitUntil: 'networkidle0' }); await clickText('Time zone');
    const trigger = 'button[aria-label="Display time zone"]', search = 'input[aria-label="Search time zones"]';
    await page.waitForSelector(trigger); assert.match(await page.$eval(trigger, el => el.innerText), /GMT\+00:00/);
    await page.click(trigger); await page.type(search, 'GMT+05:45');
    await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length === 1);
    assert.match(await page.$eval('[role="option"]', el => el.innerText), /GMT\+05:45/);
    await page.keyboard.press('Enter'); assert.match(await page.$eval(trigger, el => el.innerText), /GMT\+05:45/);
    assert.equal(await page.$eval(trigger, el => el === document.activeElement), true);
    await page.keyboard.press('ArrowDown'); await page.waitForSelector(search); await page.type(search, 'no-such-city'); await waitText('No matching time zones.');
    await page.keyboard.press('Escape'); assert.equal(await page.$eval(trigger, el => el === document.activeElement), true);
    await page.click(trigger); await page.type(search, 'Los Angeles'); await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length === 1);
    assert.match(await page.$eval('[role="option"]', el => el.innerText), /GMT-0[78]:00/); await page.keyboard.press('Escape');
    await page.setViewport({ width: 430, height: 780 }); await page.click(trigger); await page.type(search, 'Tokyo');
    await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length === 1);
    const bounds = await page.$eval('[role="listbox"]', el => { const b = el.parentElement.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; });
    assert.ok(bounds.left >= 0 && bounds.right <= 430 && bounds.top >= 0 && bounds.bottom <= 780, JSON.stringify(bounds));
    await page.screenshot({ path: path.join(folder, 'searchable-time-zone.png'), fullPage: true });
    await page.keyboard.press('Enter'); await clickText('Save time zone'); await waitText('Time zone saved.'); assert.equal(zone, 'Asia/Tokyo');
    role = 'MASTER'; await page.setViewport({ width: 1440, height: 1000 }); await page.goto(origin + '/users', { waitUntil: 'networkidle0' });
    await page.click('button[title="Assign profiles"]'); await clickText('Remove'); await waitText('No profiles assigned yet.'); assert.deepEqual(writes.at(-1).assignments, []);
    role = 'ADMIN'; await page.goto(origin + '/profiles', { waitUntil: 'networkidle0' }); await waitText('Own'); assert.ok(!(await page.$eval('body', el => el.innerText)).includes('Legacy'));
    assert.deepEqual(errors, []);
    console.log('PASS: Master assigns/revokes admin profiles in UI; searchable time zones support city/GMT offsets, fractional hours, keyboard focus, empty results, narrow viewports and saving. Screenshots: ' + folder);
  } catch (error) { await page.screenshot({ path: path.join(folder, 'failure.png'), fullPage: true }); console.error('Browser errors:', errors); throw error; }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
