const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isSoftwareJob, mayBeSoftwareJob } = require('../dist/job-pool/software-jobs');
const { poolJobIdentity } = require('../dist/job-pool/job-identity');

test('Software specialties include common abbreviations while excluding unrelated occupations', () => {
  for (const title of ['SW Engineer', 'Senior SWE', 'ServiceNow Engineer', 'Salesforce Engineer', 'AI/ML Engineer', 'Automation Tester', 'Build Engineer', 'UI Engineer', 'Security Operations Engineer']) assert.equal(isSoftwareJob(title), true, title);
  for (const title of ['Cloud Sales Architect', 'Senior Presales Software Engineer', 'Mechanical Product Engineer', 'Hardware Engineer', 'Manufacturing Architect', 'Clinical Quality Engineer', 'Account Executive']) assert.equal(isSoftwareJob(title, 'Build software and APIs'), false, title);
});

test('Generic engineering titles require evidence that the role builds software', () => {
  for (const title of ['Product Engineer', 'Forward Deployed Engineer', 'Founding Engineer', 'Infrastructure Engineer', 'Distributed Systems Engineer']) {
    assert.equal(mayBeSoftwareJob(title), true, title);
    assert.equal(isSoftwareJob(title), false, title);
    assert.equal(isSoftwareJob(title, 'You will design and develop scalable software and APIs for our platform.'), true, title);
    assert.equal(isSoftwareJob(title, 'Use scheduling software to coordinate production and operate machinery.'), false, title);
  }
  assert.equal(isSoftwareJob('Civil Engineer', 'You will build software and APIs.'), false);
});

test('Alternate Greenhouse application links share an employer posting identity without merging unrelated jobs', () => {
  const links = ['https://boards.greenhouse.io/Example/jobs/123?gh_src=test', 'https://job-boards.greenhouse.io/example/jobs/123', 'https://job-boards.greenhouse.io/embed/job_app?for=example&token=123&utm_source=test'];
  assert.equal(new Set(links.map(poolJobIdentity)).size, 1);
  assert.notEqual(poolJobIdentity(links[0]), poolJobIdentity('https://job-boards.greenhouse.io/another/jobs/123'));
  assert.notEqual(poolJobIdentity(links[0]), poolJobIdentity('https://job-boards.greenhouse.io/example/jobs/124'));
});

test('Doubled employer catalog contains distinct new live software boards with matching verification evidence',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const catalog=require('../prisma/job-pool-fourth-sources.json');
  assert.ok(catalog.sources.length>=catalog.target.previousSources);
  assert.ok(catalog.target.minimumTotalSources>=catalog.target.previousSources*2);
  assert.equal(catalog.verification.boardsWithSoftwareOpenings,catalog.sources.length);
  const known=new Set();
  for(const entry of fs.readdirSync(path.resolve(__dirname,'../prisma/migrations'),{withFileTypes:true})){
    if(!entry.isDirectory()||entry.name==='20261017150000_double_verified_employer_boards')continue;
    const sql=fs.readFileSync(path.resolve(__dirname,'../prisma/migrations',entry.name,'migration.sql'),'utf8');
    for(const match of sql.matchAll(/\('source-[^']+', '([^']+)', '(?:[^']|'')*', '([^']*)'/g))known.add(`${match[1]}:${match[2]}`.toLowerCase());
  }
  const evidence=new Map(catalog.verification.boards.map(board=>[`${board.provider}:${board.boardToken}`.toLowerCase(),board]));
  for(const source of catalog.sources){
    const key=`${source.provider}:${source.boardToken}`.toLowerCase();assert.equal(known.has(key),false,key);known.add(key);
    assert.ok(['greenhouse','ashby','lever'].includes(source.provider));assert.match(source.boardToken,/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/);assert.ok(source.name.trim());
    const checked=evidence.get(key);assert.ok(checked?.softwareJobsOnPage>0,key);assert.ok(checked.publishedJobs>=checked.softwareJobsOnPage);assert.ok(Number.isFinite(Date.parse(checked.verifiedAt)));
  }
  assert.ok(catalog.attributions.some(item=>item.license==='CC-BY-4.0'&&item.requiredLink));
});

test('5,000-source expansion contains new live software boards and an additive migration for every entry',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const catalog=require('../prisma/job-pool-5000-sources.json'),migrationName='20261017160000_five_thousand_job_sources';
  assert.equal(catalog.target.minimumTotalSources,5000);
  assert.equal(catalog.target.previousSources+catalog.sources.length,5000);
  assert.equal(catalog.target.newSources,catalog.sources.length);
  assert.equal(catalog.verification.boardsWithSoftwareOpenings,catalog.sources.length);
  const known=new Set();
  for(const entry of fs.readdirSync(path.resolve(__dirname,'../prisma/migrations'),{withFileTypes:true})){
    if(!entry.isDirectory()||entry.name>=migrationName)continue;
    const sql=fs.readFileSync(path.resolve(__dirname,'../prisma/migrations',entry.name,'migration.sql'),'utf8');
    for(const match of sql.matchAll(/\('source-[^']+', '([^']+)', '(?:[^']|'')*', '([^']*)'/g))known.add(`${match[1]}:${match[2]}`.toLowerCase());
  }
  const sql=fs.readFileSync(path.resolve(__dirname,'../prisma/migrations',migrationName,'migration.sql'),'utf8');
  assert.doesNotMatch(sql.replace(/'(?:[^']|'')*'/g,"''").replace(/^--.*$/gm,''),/\b(?:DROP|DELETE|TRUNCATE|UPDATE|ALTER)\b/i);
  assert.match(sql,/WHERE NOT EXISTS/);assert.match(sql,/ON CONFLICT DO NOTHING/);
  const inserted=[...sql.matchAll(/\('source-5000-[^']+', '([^']+)', '(?:[^']|'')*', '([^']*)'/g)].map(m=>`${m[1]}:${m[2]}`.toLowerCase());
  assert.equal(inserted.length,catalog.sources.length);assert.equal(new Set(inserted).size,inserted.length);
  const evidence=new Map(catalog.verification.boards.map(board=>[`${board.provider}:${board.boardToken}`.toLowerCase(),board]));
  const added=new Set();
  for(const source of catalog.sources){
    const key=`${source.provider}:${source.boardToken}`.toLowerCase();assert.equal(known.has(key),false,key);assert.equal(added.has(key),false,key);added.add(key);
    assert.ok(['greenhouse','ashby','lever'].includes(source.provider));assert.match(source.boardToken,/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/);assert.ok(source.name.trim());
    const checked=evidence.get(key);assert.ok(checked?.softwareJobsOnPage>0,key);assert.ok(checked.publishedJobs>=checked.softwareJobsOnPage);assert.ok(Number.isFinite(Date.parse(checked.verifiedAt)));
  }
  assert.deepEqual(new Set(inserted),added);
  assert.equal(catalog.verification.eligibleJobsOnCheckedPages,catalog.verification.boards.reduce((n,b)=>n+b.remoteUsFirstPage,0));
  assert.ok(catalog.attributions.some(item=>item.license==='CC-BY-4.0'&&item.requiredLink));
});

test('10,003-source expansion registers distinct live employer boards with honest software counts and additive SQL', () => {
  const fs = require('node:fs'), path = require('node:path');
  const catalog = require('../prisma/job-pool-10000-sources.json');
  const name = '20261018020000_ten_thousand_job_sources';
  assert.ok(catalog.target.minimumTotalSources >= 10000);
  assert.equal(catalog.target.previousSources + catalog.sources.length + catalog.feeds.length, catalog.target.minimumTotalSources);
  assert.equal(catalog.sources.length, 5000);
  assert.deepEqual(catalog.scope.countries, ['US','GB','IE']);
  const known = new Set(), added = new Set();
  const migrations = path.resolve(__dirname, '../prisma/migrations');
  for (const entry of fs.readdirSync(migrations, {withFileTypes:true})) {
    if (!entry.isDirectory() || entry.name >= name) continue;
    for (const m of fs.readFileSync(path.join(migrations, entry.name, 'migration.sql'), 'utf8').matchAll(/\('source-[^']+', '([^']+)', '(?:[^']|'')*', '([^']*)'/g)) known.add(`${m[1]}:${m[2]}`.toLowerCase());
  }
  const evidence = new Map(catalog.verification.boards.map(s => [`${s.provider}:${s.boardToken}`.toLowerCase(),s]));
  const supported = require('../dist/job-pool/job-providers').JOB_PROVIDERS.map(p=>p.id);
  for (const s of [...catalog.sources, ...catalog.feeds]) {
    const key = `${s.provider}:${s.boardToken}`.toLowerCase();
    assert.equal(known.has(key), false, key); assert.equal(added.has(key), false, key); added.add(key);
    assert.ok(supported.includes(s.provider)); assert.match(s.boardToken,/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/);
    if (s.provider === 'jobicy') continue;
    const verified = evidence.get(key); assert.ok(verified?.publishedJobs > 0); assert.ok(verified.softwareJobsOnPage >= 0 && verified.softwareJobsOnPage <= verified.publishedJobs); assert.ok(Number.isFinite(Date.parse(verified.verifiedAt)));
  }
  assert.equal(catalog.verification.liveBoards, catalog.sources.length);
  assert.equal(catalog.verification.boardsWithSoftwareOpenings, catalog.verification.boards.filter(s=>s.softwareJobsOnPage>0).length);
  assert.equal(catalog.verification.publishedSoftwareJobsOnCheckedPages, catalog.verification.boards.reduce((n,s)=>n+s.softwareJobsOnPage,0));
  const sql = fs.readFileSync(path.join(migrations,name,'migration.sql'),'utf8');
  assert.doesNotMatch(sql.replace(/'(?:[^']|'')*'/g,"''").replace(/^--.*$/gm,''),/\b(?:DROP|DELETE|TRUNCATE|UPDATE|ALTER)\b/i);
  assert.match(sql,/WHERE NOT EXISTS/); assert.match(sql,/ON CONFLICT DO NOTHING/);
  const inserted = [...sql.matchAll(/\('source-10000-[^']+', '([^']+)', '(?:[^']|'')*', '([^']*)'/g)].map(m=>`${m[1]}:${m[2]}`.toLowerCase());
  assert.equal(inserted.length, added.size); assert.deepEqual(new Set(inserted), added);
});

test('Country targets use a shared 13,003-source library with new live boards and separate evidence for software openings',()=>{
  const fs=require('node:fs'),path=require('node:path');
  const catalog=require('../prisma/job-pool-country-target-sources.json'),name='20261018030000_country_source_targets';
  assert.deepEqual(catalog.target.countryMonitoredSources,{US:10000,GB:10000,IE:10000});
  assert.equal(catalog.target.minimumTotalSources,13003);assert.equal(catalog.target.previousSources+catalog.sources.length,13003);assert.equal(catalog.sources.length,3000);
  assert.match(catalog.scope.counting,/shared/);assert.match(catalog.scope.counting,/does not establish current hiring/);
  const migrations=path.resolve(__dirname,'../prisma/migrations'),known=new Set(),added=new Set();
  for(const dir of fs.readdirSync(migrations)){if(dir>=name)continue;const file=path.join(migrations,dir,'migration.sql');if(!fs.existsSync(file))continue;
    for(const m of fs.readFileSync(file,'utf8').matchAll(/\('source-[^']+', '([^']+)', '(?:[^']|'')*', '([^']*)'/g))known.add(`${m[1]}:${m[2]}`.toLowerCase());}
  const evidence=new Map(catalog.verification.boards.map(s=>[`${s.provider}:${s.boardToken}`.toLowerCase(),s]));
  const {sourceCountries,JOB_PROVIDERS}=require('../dist/job-pool/job-providers');
  for(const s of catalog.sources){const key=`${s.provider}:${s.boardToken}`.toLowerCase();assert.equal(known.has(key),false,key);assert.equal(added.has(key),false,key);added.add(key);
    assert.ok(JOB_PROVIDERS.some(p=>p.id===s.provider));assert.match(s.boardToken,/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/);if(['workable','recruitee','breezy','pinpoint'].includes(s.provider))assert.ok(!s.boardToken.includes('.'));
    assert.deepEqual(sourceCountries(s),['US','GB','IE']);const proof=evidence.get(key);assert.ok(proof?.publishedJobs>0);assert.ok(proof.softwareJobsOnPage>=0&&proof.softwareJobsOnPage<=proof.publishedJobs);assert.ok(Number.isFinite(Date.parse(proof.verifiedAt)));}
  assert.equal(catalog.verification.liveBoards,3000);assert.equal(catalog.verification.boardsWithSoftwareOpenings,catalog.verification.boards.filter(s=>s.softwareJobsOnPage>0).length);
  assert.equal(catalog.verification.publishedSoftwareJobsOnCheckedPages,catalog.verification.boards.reduce((n,s)=>n+s.softwareJobsOnPage,0));
  assert.equal(catalog.sources.filter(s=>s.provider==='pinpoint').length,302);
  const sql=fs.readFileSync(path.join(migrations,name,'migration.sql'),'utf8');assert.match(sql,/WHERE NOT EXISTS/);assert.match(sql,/ON CONFLICT DO NOTHING/);
  assert.doesNotMatch(sql.replace(/'(?:[^']|'')*'/g,"''").replace(/^--.*$/gm,''),/\b(?:DROP|DELETE|TRUNCATE|UPDATE|ALTER)\b/i);
  assert.deepEqual(new Set([...sql.matchAll(/\('source-country-[^']+', '([^']+)', '(?:[^']|'')*', '([^']*)'/g)].map(m=>`${m[1]}:${m[2]}`.toLowerCase())),added);
});

test('30,000-source catalog adds distinct live boards without geographic copies, duplicate employer presentations or destructive SQL',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const catalog=require('../prisma/job-pool-30000-sources.json'),name='20261018040000_thirty_thousand_distinct_sources';
 assert.equal(catalog.target.minimumTotalSources,30000);assert.equal(catalog.target.previousSources,13003);assert.equal(catalog.sources.length,16997);
 assert.equal(catalog.target.previousSources+catalog.sources.length,30000);assert.deepEqual(catalog.target.countrySources,{US:10000,GB:10000,IE:10000});
 assert.match(catalog.scope.counting,/shared search capability alone does not meet a country target/);
 const migrations=path.resolve(__dirname,'../prisma/migrations'),known=new Set(),added=new Set(),employers=new Set();
 for(const dir of fs.readdirSync(migrations)){if(dir>=name)continue;const file=path.join(migrations,dir,'migration.sql');if(!fs.existsSync(file))continue;
  for(const m of fs.readFileSync(file,'utf8').matchAll(/\('source-[^']+', '([^']+)', '(?:[^']|'')*', '([^']*)'/g))known.add(`${m[1]}:${m[2]}`.toLowerCase());}
 const {JOB_PROVIDERS}=require('../dist/job-pool/job-providers'),{PUBLIC_CAREER_PROVIDERS,validCareerBoard}=require('../dist/job-pool/public-career-feeds');
 const evidence=new Map(catalog.verification.boards.map(s=>[`${s.provider}:${s.boardToken}`.toLowerCase(),s]));
 for(const s of catalog.sources){const key=`${s.provider}:${s.boardToken}`.toLowerCase();assert.equal(known.has(key),false,key);assert.equal(added.has(key),false,key);added.add(key);
  assert.deepEqual(Object.keys(s).sort(),['boardToken','name','provider']);assert.ok(JOB_PROVIDERS.some(p=>p.id===s.provider));assert.ok(s.name.trim());assert.doesNotMatch(s.name,/^(?:default|test|demo|sample|sandbox)(?:\b|$)/i);
  if(PUBLIC_CAREER_PROVIDERS.includes(s.provider))assert.ok(validCareerBoard(s.provider,s.boardToken));else assert.match(s.boardToken,/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/);
  if(s.provider==='paylocity'){const employer=s.name.trim().toLowerCase().replace(/\s+/g,' ');assert.equal(employers.has(employer),false,employer);employers.add(employer);}
  const proof=evidence.get(key);assert.ok(proof?.publishedJobs>0);assert.ok(proof.softwareJobsOnPage>=0&&proof.softwareJobsOnPage<=proof.publishedJobs);assert.ok(Number.isFinite(Date.parse(proof.verifiedAt)));
 }
 for(const provider of ['teamtailor','personio','bamboohr','paylocity'])assert.ok(catalog.sources.some(s=>s.provider===provider));
 assert.equal(catalog.verification.liveBoards,16997);assert.equal(catalog.verification.boardsWithSoftwareOpenings,catalog.verification.boards.filter(s=>s.softwareJobsOnPage>0).length);
 assert.equal(catalog.verification.publishedSoftwareJobsOnCheckedPages,catalog.verification.boards.reduce((n,s)=>n+s.softwareJobsOnPage,0));
 const sql=fs.readFileSync(path.join(migrations,name,'migration.sql'),'utf8');assert.match(sql,/WHERE NOT EXISTS/);assert.match(sql,/ON CONFLICT DO NOTHING/);assert.match(sql,/INTERVAL '0 milliseconds'/);
 assert.doesNotMatch(sql.replace(/'(?:[^']|'')*'/g,"''").replace(/^--.*$/gm,''),/\b(?:DROP|DELETE|TRUNCATE|UPDATE|ALTER)\b/i);
 assert.deepEqual(new Set([...sql.matchAll(/\('source-30000-[^']+', '([^']+)', '(?:[^']|'')*', '([^']*)'/g)].map(m=>`${m[1]}:${m[2]}`.toLowerCase())),added);
});

test('Excluded seniority/title substrings override software evidence and title shortcuts',()=>{for(const title of ['Staff Software Engineer','PRINCIPAL Backend Developer','Cloud Architect','Data Architect','Database Architect','Junior Frontend Developer','sTaFf Engineer','Principal Engineer','Staffing Software Engineer','Lead Software Engineer','DIRECTOR OF ENGINEERING','Software Team Leader']){assert.equal(mayBeSoftwareJob(title),false,title);assert.equal(isSoftwareJob(title,'Design and develop scalable software APIs.'),false,title);}});
