const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');

// Isolated CLI fixtures under the ignored QA directory. The child process has
// a fake fetch, so these checks never contact a job site or the application DB.
function fixture() {
  const root = path.resolve(__dirname, '../../..');
  const directory = path.join(root, 'tmp/job-pool-qa', `verifier-${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true });
  const input = path.join(directory, 'input.json'), output = path.join(directory, 'output.json');
  const calls = path.join(directory, 'calls.json'), preload = path.join(directory, 'preload.cjs');
  const sources = ['first', 'second', 'third'].map(boardToken => ({ provider: 'ashby', boardToken, name: boardToken }));
  fs.writeFileSync(input, JSON.stringify({ sources }));
  fs.writeFileSync(preload, `const fs=require('fs'); global.fetch=async(url)=>{fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(String(url))+'\\n'); return new Response(JSON.stringify({jobs:[1,2].map(id=>({id,title:'Software Engineer',isListed:true,workplaceType:'Remote',location:'USA',descriptionPlain:'Build software',jobUrl:'https://example.com/'+id}))}));};`);
  const previous = { candidates: 3, completed: 1, available: [{ ...sources[0], remoteUsFirstPage: 1, publishedJobs: 1 }], unavailable: [], rateLimitedHosts: [] };
  fs.writeFileSync(output, JSON.stringify(previous));
  const run = args => spawnSync(process.execPath, ['--require', preload, path.join(root, 'apps/api/scripts/verify-job-sources.cjs'), input, output, ...args], { cwd: root, encoding: 'utf8', timeout: 15_000, windowsHide: true });
  return { input, output, calls, previous, run };
}

test('source verification resumes without requesting boards that already met both targets', () => {
  const f = fixture(), result = f.run(['--resume', '--target=1', '--target-jobs=1']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(f.calls), false);
  const saved = JSON.parse(fs.readFileSync(f.output));
  assert.equal(saved.completed, 1); assert.equal(saved.available.length, 1);
  assert.equal(JSON.parse(result.stdout).targetReached,true);
});

test('source verification keeps looking for jobs after the board-count target is met', () => {
  const f = fixture(), result = f.run(['--resume', '--target=1', '--target-jobs=3', '--concurrency=1']);
  assert.equal(result.status, 0, result.stderr);
  const calls = fs.readFileSync(f.calls, 'utf8').trim().split('\n');
  assert.equal(calls.length, 1); assert.match(calls[0], /second/);
  const saved = JSON.parse(fs.readFileSync(f.output));
  assert.equal(saved.completed, 2); assert.equal(saved.available.length, 2);
  assert.equal(saved.available.reduce((count, source) => count + source.remoteUsFirstPage, 0), 3);
});

test('source verification respects the total candidate budget when resuming', () => {
  const f = fixture(), result = f.run(['--resume', '--target=2', '--max-candidates=1']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(f.calls), false);
  assert.equal(JSON.parse(fs.readFileSync(f.output)).completed, 1);
  assert.equal(JSON.parse(result.stdout).targetReached,false);
});

test('source verification rejects mismatched checkpoints and invalid request concurrency before fetching', () => {
  const f = fixture();
  fs.writeFileSync(f.output, JSON.stringify({ ...f.previous, candidates: 99 }));
  assert.notEqual(f.run(['--resume']).status, 0);
  assert.notEqual(f.run(['--concurrency=13']).status, 0);
  assert.equal(fs.existsSync(f.calls), false);
});

test('source verification retains rate-limit blocks across a resumed pass', () => {
  const f = fixture();
  fs.writeFileSync(f.output, JSON.stringify({ ...f.previous, rateLimitedHosts: ['api.ashbyhq.com'] }));
  const result = f.run(['--resume', '--target=3']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(f.calls), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.output)).rateLimitedHosts, ['api.ashbyhq.com']);
  assert.equal(JSON.parse(fs.readFileSync(f.output)).completed,3);
  assert.equal(f.run(['--resume','--target=3']).status,0);
  assert.equal(JSON.parse(fs.readFileSync(f.output)).completed,3);
});

test('source expansion verifies live software boards while retaining the stricter remote US job count', () => {
  const f = fixture();
  const preload=path.join(path.dirname(f.input),'preload.cjs');
  fs.writeFileSync(preload,`const fs=require('fs');global.fetch=async url=>{fs.appendFileSync(${JSON.stringify(f.calls)},JSON.stringify(String(url))+'\\n');const first=String(url).includes('/first?');return new Response(JSON.stringify({jobs:[{id:'one',title:first?'Recruiter':'Software Engineer',isListed:true,workplaceType:'OnSite',location:'USA',descriptionPlain:'Build software',jobUrl:'https://example.com/one'}]}));};`);
  const result=f.run(['--new-only','--target-software-sources=1','--concurrency=1']);
  assert.equal(result.status,0,result.stderr);
  const saved=JSON.parse(fs.readFileSync(f.output));assert.equal(saved.completed,2);assert.equal(saved.available[0].softwareJobsOnPage,0);assert.equal(saved.available[1].softwareJobsOnPage,1);
  assert.equal(saved.available[1].remoteUsFirstPage,0);assert.equal(JSON.parse(result.stdout).targetReached,true);
});

test('new-source discovery excludes customized sources and every previously registered migration', () => {
  const f=fixture();
  fs.writeFileSync(f.input,JSON.stringify({sources:[{provider:'ashby',boardToken:'first',name:'Excluded custom board'},{provider:'greenhouse',boardToken:'airbnb',name:'Existing original board'},{provider:'smartrecruiters',boardToken:'ZILLIONTECHNOLOGIESINC',name:'Existing recent board'},{provider:'ashby',boardToken:'second',name:'New board'}],excludedSources:[{provider:'ASHBY',boardToken:'FIRST'}]}));
  const result=f.run(['--new-only','--target-software-sources=1','--concurrency=1']);assert.equal(result.status,0,result.stderr);
  const calls=fs.readFileSync(f.calls,'utf8').trim().split('\n');assert.equal(calls.length,1);assert.match(calls[0],/second/);
  assert.equal(JSON.parse(fs.readFileSync(f.output)).candidates,1);
});
