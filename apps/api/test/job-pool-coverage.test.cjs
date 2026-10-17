const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isSoftwareJob, mayBeSoftwareJob } = require('../dist/job-pool/software-jobs');
const { poolJobIdentity } = require('../dist/job-pool/job-identity');

test('Software specialties include common abbreviations and architecture roles while excluding unrelated occupations', () => {
  for (const title of ['SW Engineer', 'Senior SWE', 'Cloud Architect', 'Data Architect', 'Database Architect', 'ServiceNow Engineer', 'Salesforce Engineer', 'AI/ML Engineer', 'Automation Tester', 'Build Engineer', 'UI Engineer', 'Security Operations Engineer']) assert.equal(isSoftwareJob(title), true, title);
  for (const title of ['Cloud Sales Architect', 'Senior Presales Software Engineer', 'Mechanical Product Engineer', 'Hardware Engineer', 'Manufacturing Architect', 'Clinical Quality Engineer', 'Account Executive']) assert.equal(isSoftwareJob(title, 'Build software and APIs'), false, title);
});

test('Generic engineering titles require evidence that the role builds software', () => {
  for (const title of ['Product Engineer', 'Forward Deployed Engineer', 'Founding Engineer', 'Infrastructure Engineer', 'Distributed Systems Engineer', 'Staff Engineer']) {
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
