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
  const sources = ['first', 'second', 'third'].map(name => ({ provider: 'ashby', boardToken: `qa-anchor-verifier-${name}`, name }));
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
  fs.writeFileSync(preload,`const fs=require('fs');global.fetch=async url=>{fs.appendFileSync(${JSON.stringify(f.calls)},JSON.stringify(String(url))+'\\n');const first=new URL(url).pathname.endsWith('verifier-first');return new Response(JSON.stringify({jobs:[{id:'one',title:first?'Recruiter':'Software Engineer',isListed:true,workplaceType:'OnSite',location:'USA',descriptionPlain:'Build software',jobUrl:'https://example.com/one'}]}));};`);
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

test('public-board verifier supports Pinpoint and reports distinct eligible job counts for all three countries',()=>{
  const f=fixture();
  fs.writeFileSync(f.input,JSON.stringify({sources:[{provider:'pinpoint',boardToken:'country-cli-fixture',name:'Country fixture'}]}));
  const preload=path.join(path.dirname(f.input),'preload.cjs');
  fs.writeFileSync(preload,`global.fetch=async()=>new Response(JSON.stringify({data:['United States','United Kingdom','Ireland','Worldwide','Germany'].map((name,id)=>({id,title:'Software Engineer',workplace_type:'remote',location:{name},description:'Build reliable software',url:'https://example.pinpointhq.com/en/postings/'+id}))}));`);
  const result=f.run(['--new-only','--concurrency=1']);assert.equal(result.status,0,result.stderr);
  const [source]=JSON.parse(fs.readFileSync(f.output)).available;
  assert.equal(source.provider,'pinpoint');assert.equal(source.softwareJobsOnPage,5);
  assert.equal(source.remoteEligibleFirstPage,4);assert.equal(source.remoteUsFirstPage,2);
  assert.deepEqual(source.jobsByCountry,{US:2,GB:2,IE:2});
});

test('public-board verifier accepts the four new feed formats and records country eligibility after full detail parsing',()=>{
  for(const provider of ['personio','teamtailor','bamboohr','paylocity']){
    const f=fixture(),boardToken=provider==='paylocity'?'00000000-0000-4000-8000-000000000001':provider==='teamtailor'?'qa-anchor-verifier.teamtailor.com':'qa-anchor-verifier';
    fs.writeFileSync(f.input,JSON.stringify({sources:[{provider,boardToken,name:'QA Employer'}]}));
    const script=`const provider=${JSON.stringify(provider)},token=${JSON.stringify(boardToken)};global.fetch=async(value)=>{const u=new URL(value);let body;
      if(provider==='personio')body='<workzag-jobs><position><id>321</id><subcompany>QA Employer</subcompany><name>Software Engineer</name><office>Remote, United Kingdom</office><jobDescriptions><jobDescription><value>Build software APIs</value></jobDescription></jobDescriptions></position></workzag-jobs>';
      else if(provider==='teamtailor')body=JSON.stringify({version:'https://jsonfeed.org/version/1.1',items:[{id:'one',title:'Software Engineer',url:'https://qa-anchor-verifier.teamtailor.com/jobs/321-engineer',content_html:'Build software APIs',_jobposting:{jobLocationType:'TELECOMMUTE',jobLocation:{address:{addressCountry:'IE'}}}}]});
      else if(provider==='bamboohr')body=JSON.stringify(u.pathname.endsWith('/list')?{meta:{totalCount:1},result:[{id:'321',jobOpeningName:'Software Engineer',locationType:'1'}]}:{result:{jobOpening:{jobOpeningName:'Software Engineer',locationType:'1',atsLocation:{country:'US'},description:'Build software APIs'}}});
      else if(u.pathname.toLowerCase().includes('/all/'))body='<script>window.pageData = '+JSON.stringify({ModuleTitle:'QA Employer',Jobs:[{JobId:321,JobTitle:'Software Engineer',IsRemote:true,JobLocation:{Country:'GB'}}]})+';</script>';
      else body='<a class="breadcrumb-link" href="/recruiting/jobs/All/'+token+'">All Jobs</a><h2 id="LayoutLogoName">QA Employer</h2><span class="job-preview-title">Software Engineer</span><div class="preview-location">Fully Remote</div><div class="job-preview-details"><p>Build software APIs</p></div>';
      return new Response(body);};`;
    fs.writeFileSync(path.join(path.dirname(f.input),'preload.cjs'),script);
    const result=f.run(['--new-only','--concurrency=1']);assert.equal(result.status,0,provider+': '+result.stderr);
    const [saved]=JSON.parse(fs.readFileSync(f.output)).available;assert.ok(saved,provider);assert.equal(saved.remoteEligibleFirstPage,1,provider);
    assert.deepEqual(saved.jobsByCountry,provider==='bamboohr'?{US:1,GB:0,IE:0}:provider==='teamtailor'?{US:0,GB:0,IE:1}:{US:0,GB:1,IE:0},provider);
  }
});
