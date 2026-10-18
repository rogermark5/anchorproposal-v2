const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchJobPage, isUsLocation, plainText, publicJobUrl, readFeed, MIN_SYNC_MS, arrangement } = require('../dist/job-pool/job-providers');
const source = (provider, boardToken = provider === 'jobicy' ? '' : 'example') => ({ provider, boardToken, name: 'Example Co' });

test('all feed imports exclude non-software occupations even at a software company', async () => {
  const { isSoftwareJob } = require('../dist/job-pool/software-jobs');
  const accepted = ['Senior Software Engineer', 'Backend Developer', 'Full-stack Engineer', 'QA Engineer', 'DevOps Engineer', 'SRE', 'Data Engineer', 'Machine Learning Engineer', 'Embedded Software Engineer'];
  const rejected = ['Account Executive', 'Recruiter', 'Software Sales Engineer', 'Civil Engineer', 'Mechanical Engineer', 'Remote Sensing Engineer'];
  for (const title of accepted) assert.equal(isSoftwareJob(title), true, title);
  for (const title of rejected) assert.equal(isSoftwareJob(title), false, title);
  for (const provider of ['jobicy', 'remoteok', 'greenhouse', 'lever', 'ashby']) {
    const rows = [...accepted, ...rejected].map((title, index) => ({ id: index, title, jobTitle: title, position: title, text: title, companyName: 'Software Co', company: 'Software Co', jobGeo: 'USA', location: provider === 'greenhouse' ? { name: 'US Remote' } : 'USA', country: 'US', categories: { location: 'US Remote' }, workplaceType: 'remote', isRemote: true, description: 'Our software engineering team builds products', jobDescription: 'Our software engineering team builds products', content: 'Our software engineering team builds products', descriptionPlain: 'Our software engineering team builds products', url: `https://example.com/jobs/${index}`, jobUrl: `https://example.com/jobs/${index}`, absolute_url: `https://example.com/jobs/${index}`, hostedUrl: `https://example.com/jobs/${index}` }));
    const result = await fetchJobPage(source(provider), null, async () => ['remoteok', 'lever'].includes(provider) ? rows : { jobs: rows });
    assert.deepEqual(result.jobs.map(job => job.title), accepted, provider);
  }
});

test('US eligibility comes from location/country, never remote status or a US company', () => {
  for (const location of ['United States', 'USA', 'Remote - US', 'San Francisco, CA', 'Austin, Texas', 'Seattle', 'New York, NY', 'Albuquerque, New Mexico', 'Ontario, CA', 'Atlanta, Georgia']) assert.ok(isUsLocation(location), location);
  for (const location of ['', 'Remote', 'Worldwide', 'Europe', 'London, UK', 'Toronto, Ontario, Canada', 'Mexico City', 'Bengaluru, India', 'Tbilisi, Georgia']) assert.equal(isUsLocation(location), false, location);
  assert.equal(isUsLocation('San Francisco', 'GB'), false);
  assert.equal(isUsLocation('Remote', 'US'), true);
});
test('feed descriptions are plain text and source links reject embedded credentials and executable URLs', () => {
  assert.equal(plainText('&lt;p&gt;Build &amp; grow&lt;/p&gt;<script>bad()</script>'), 'Build & grow');
  assert.equal(plainText('&#x1F600; &#99999999;'), '😀');
  for (const url of ['javascript:alert(1)', 'file:///tmp/resume', 'https://secret:password@example.com', 'http://127.0.0.1/job', 'http://192.168.1.2/job', 'https://[::1]/job']) assert.equal(publicJobUrl(url), null);
  assert.equal(publicJobUrl('https://example.com/jobs/1'), 'https://example.com/jobs/1');
});
test('Jobicy paginates its free US feed and retains its original job links', async () => {
  const calls = [];
  const result = await fetchJobPage(source('jobicy'), 'cursor/value', async url => { calls.push(url); return { nextCursor: 'page-2', jobs: [
    { id: 1, jobTitle: 'Software Engineer', companyName: 'Company', jobGeo: 'USA', jobDescription: '<p>Build systems</p>', url: 'https://jobicy.com/jobs/1', pubDate: '2026-10-15' },
    { id: 2, jobTitle: 'Software Engineer', companyName: 'Company', jobGeo: 'Europe', jobDescription: 'Work', url: 'https://jobicy.com/jobs/2' },
  ] }; });
  assert.equal(calls[0].searchParams.get('geo'), 'usa'); assert.equal(calls[0].searchParams.get('cursor'), 'cursor/value');
  assert.equal(result.jobs.length, 1); assert.equal(result.jobs[0].sourceName, 'Jobicy'); assert.equal(result.jobs[0].jobUrl, 'https://jobicy.com/jobs/1'); assert.equal(result.complete, false);
});
test('Remote OK ignores metadata, vague remote eligibility and jobs outside the US', async () => {
  const data = [{ legal: 'Attribution required' }, ...['United States', 'Remote', 'Canada', 'United States - Hybrid', 'United States - Onsite'].map((location, i) => ({ id: i, position: 'Software Engineer', company: 'Co', location, description: 'Build', url: `https://remoteok.com/remote-jobs/${i}` }))];
  const result = await fetchJobPage(source('remoteok'), null, async () => data);
  assert.equal(result.jobs.length, 1); assert.equal(result.jobs[0].sourceName, 'Remote OK');
});
test('company boards filter locations, decode HTML and paginate Lever', async () => {
  const greenhouse = await fetchJobPage(source('greenhouse'), null, async url => {
    assert.equal(url.hostname, 'boards-api.greenhouse.io'); assert.equal(url.searchParams.get('content'), 'true');
    return { jobs: [{ id: 1, title: 'Software Engineer', location: { name: 'Boston, MA (Remote)' }, absolute_url: 'https://boards.greenhouse.io/example/jobs/1', content: '&lt;p&gt;Build software&lt;/p&gt;' }] };
  });
  assert.equal(greenhouse.jobs[0].description, 'Build software');
  const lever = await fetchJobPage(source('lever'), null, async () => Array.from({ length: 100 }, (_, i) => ({ id: String(i), text: 'Software Engineer', country: 'US', categories: { location: 'Remote', commitment: 'Full time' }, hostedUrl: `https://jobs.lever.co/example/${i}`, descriptionPlain: 'Main', lists: [{ text: 'Requirements', content: '<li>TypeScript</li>' }], workplaceType: 'remote' })));
  assert.equal(lever.next, '100'); assert.equal(lever.jobs[0].workArrangement, 'REMOTE'); assert.match(lever.jobs[0].description, /TypeScript/);
});
test('Ashby excludes unlisted posts and supports US secondary locations', async () => {
  const row = { title: 'Software Engineer', location: 'London', address: { postalAddress: { addressCountry: 'GB' } }, secondaryLocations: [{ location: 'Seattle', address: { addressCountry: 'US' } }], jobUrl: 'https://jobs.ashbyhq.com/example/1', descriptionPlain: 'Build', isListed: true, isRemote: true };
  const result = await fetchJobPage(source('ashby'), null, async () => ({ jobs: [row, { ...row, isListed: false }] }));
  assert.equal(result.jobs.length, 1); assert.equal(result.jobs[0].location, 'London · Seattle');
  assert.deepEqual(result.jobs[0].eligibleCountries, ['US', 'GB']);
});
test('USAJOBS needs only its free key, filters overseas roles and includes qualifications', async () => {
  const oldKey = process.env.USAJOBS_API_KEY, oldEmail = process.env.USAJOBS_EMAIL;
  try {
    delete process.env.USAJOBS_API_KEY; delete process.env.USAJOBS_EMAIL;
    await assert.rejects(fetchJobPage(source('usajobs'), null, async () => { throw Error('Must not request'); }), /free USAJOBS/);
    process.env.USAJOBS_API_KEY = 'test-free-key'; process.env.USAJOBS_EMAIL = 'test@example.invalid';
    const result = await fetchJobPage(source('usajobs'), null, async (url, headers) => {
      assert.equal(headers['Authorization-Key'], 'test-free-key'); assert.equal(url.hostname, 'data.usajobs.gov'); assert.equal(url.searchParams.get('RemoteIndicator'), 'true');
      return { SearchResult: { SearchResultCountAll: 600, SearchResultItems: ['US', 'DE'].map(country => ({ MatchedObjectId: country, MatchedObjectDescriptor: {
        PositionTitle: 'Software Engineer', OrganizationName: 'Agency', PositionURI: 'https://www.usajobs.gov/job/1', PositionLocation: [{ CountryCode: country, LocationName: 'Office' }], QualificationSummary: 'Required experience', UserArea: { Details: { JobSummary: 'Serve the public', RemoteIndicator: true } }, ApplicationCloseDate: '2099-12-31',
      } })) } };
    });
    assert.equal(result.jobs.length, 1); assert.equal(result.next, '2'); assert.match(result.jobs[0].description, /Required experience/);
  } finally { if (oldKey === undefined) delete process.env.USAJOBS_API_KEY; else process.env.USAJOBS_API_KEY = oldKey; if (oldEmail === undefined) delete process.env.USAJOBS_EMAIL; else process.env.USAJOBS_EMAIL = oldEmail; }
});
test('feed failures and rate limits are explicit; bounded reads reject large or invalid responses', async () => {
  for (const provider of ['greenhouse', 'jobicy', 'ashby', 'remoteok', 'lever', 'smartrecruiters', 'usajobs']) {
    if (provider === 'usajobs') continue;
    await assert.rejects(fetchJobPage(source(provider), null, async () => ({})), /jobs list/);
  }
  const saved = global.fetch;
  try {
    global.fetch = async () => new Response('', { status: 429, headers: { 'retry-after': '7200' } });
    await assert.rejects(readFeed(new URL('https://example.com')), error => error.retryAfterMs === 2 * MIN_SYNC_MS);
    global.fetch = async () => new Response('{}', { headers: { 'content-length': String(30 * 1024 * 1024) } });
    await assert.rejects(readFeed(new URL('https://example.com')), /too large/);
    global.fetch = async () => new Response('<html>error</html>');
    await assert.rejects(readFeed(new URL('https://example.com')), /invalid JSON/);
    global.fetch = async () => new Response(new ReadableStream({start(controller){controller.error(new DOMException('timed out','TimeoutError'));}}));
    await assert.rejects(readFeed(new URL('https://example.com')),error=>error.name==='FeedError'&&/timed out while downloading/.test(error.message));
  } finally { global.fetch = saved; }
});

test('remote-only classification excludes hybrid, office, vague and negated remote labels', async () => {
  for (const label of ['Remote', 'Fully remote', 'Work from home', 'Home-based']) assert.equal(arrangement(label), 'REMOTE');
  for (const label of ['Hybrid - Remote', 'Non-remote', 'Not remote', 'No remote', 'Remote not available', 'Remote / On-site', 'In-office']) assert.notEqual(arrangement(label), 'REMOTE');
  const root = { id: 1, title: 'Software Engineer', location: { name: 'United States' }, absolute_url: 'https://boards.greenhouse.io/example/jobs/1', content: '<p>Our benefits include remote work options.</p>' };
  const greenhouse = await fetchJobPage(source('greenhouse'), null, async () => ({ jobs: [
    { ...root, id: 1, location: { name: 'United States - Remote' } },
    { ...root, id: 2, location: { name: 'US - Remote / Hybrid' } },
    { ...root, id: 3, title: 'Remote Sensing Engineer' },
    { ...root, id: 4, title: 'Software Engineer (Remote - USA)' },
    { ...root, id: 5, location: { name: 'US Remote' }, metadata: [{ name: 'Workplace type', value: 'Hybrid' }] },
    { ...root, id: 6, metadata: [{ name: 'Workplace type', value: 'Remote' }] },
    { ...root, id: 7, location: { name: 'New York, NY' } },
  ] }));
  assert.deepEqual(greenhouse.jobs.map(job => job.externalId), ['1','4','6']);
  const ashby = await fetchJobPage(source('ashby'), null, async () => ({ jobs: ['Remote','Hybrid','OnSite'].map(workplaceType => ({ title:'Software Engineer', location:'USA', workplaceType, isRemote:true, isListed:true, descriptionPlain:'Build', jobUrl:`https://jobs.ashbyhq.com/example/${workplaceType}` })) }));
  assert.equal(ashby.jobs.length,1); assert.equal(ashby.jobs[0].workArrangement,'REMOTE');
  const lever = await fetchJobPage(source('lever'), null, async () => ['remote','hybrid','on-site','unspecified'].map(workplaceType => ({id:workplaceType, text:'Software Engineer', country:'US', categories:{location:'New York, NY'}, workplaceType, descriptionPlain:'Build', hostedUrl:`https://jobs.lever.co/example/${workplaceType}`})));
  assert.deepEqual(lever.jobs.map(job => job.externalId),['remote']);
});

test('SmartRecruiters reads only public remote US postings, paginates and preserves full job details', async () => {
  const calls = []; const row = { id:'123', name:'Software Engineer', location:{country:'us',city:'Boston',remote:true,hybrid:false}, visibility:'PUBLIC' };
  const result = await fetchJobPage(source('smartrecruiters','Example'), '20', async url => {
    calls.push(url);
    if (url.pathname.endsWith('/postings')) {
      assert.equal(url.searchParams.get('destination'),'PUBLIC'); assert.equal(url.searchParams.has('country'),false); assert.equal(url.searchParams.get('locationType'),'REMOTE'); assert.equal(url.searchParams.get('offset'),'20');
      return { totalFound:100, content:[row,{...row,id:'hybrid',location:{...row.location,hybrid:true}},{...row,id:'foreign',location:{...row.location,country:'de'}},{...row,id:'internal',visibility:'INTERNAL'},{...row,id:'sales',name:'Sales Manager'}] };
    }
    assert.equal(url.hostname,'api.smartrecruiters.com'); assert.ok(url.pathname.endsWith('/123'));
    return {...row,active:true,company:{name:'Actual Company'},postingUrl:'https://jobs.smartrecruiters.com/Example/123-engineer',jobAd:{sections:{jobDescription:{title:'Responsibilities',text:'<p>Build software.</p>'},qualifications:{title:'Qualifications',text:'<li>TypeScript</li>'}}}};
  });
  assert.equal(calls.length,2,'Non-software roles must not trigger detail requests'); assert.equal(result.jobs.length,1); assert.equal(result.next,'25'); assert.match(result.jobs[0].description,/TypeScript/); assert.equal(result.jobs[0].company,'Actual Company'); assert.match(result.jobs[0].sourceName,/SmartRecruiters/);
  await assert.rejects(fetchJobPage(source('smartrecruiters'),null,async()=>({totalFound:4,content:[]})),/incomplete jobs page/);
  await assert.rejects(fetchJobPage(source('smartrecruiters'),null,async url => url.pathname.endsWith('/postings')?{totalFound:1,content:[row]}:{}),/incomplete posting/);
  let requests = 0;
  await assert.rejects(fetchJobPage(source('smartrecruiters'),null,async url => {
    if(url.pathname.endsWith('/postings'))return {totalFound:20,content:Array.from({length:20},(_,index)=>({...row,id:String(index)}))};
    requests++;throw Error('HTTP 429');
  }),/429/);
  assert.ok(requests < 20,'A failed source must stop fetching the rest of the page');
});

test('expanded catalog contains hundreds of distinct supported public company boards', () => {
  const {sources}=require('../prisma/job-pool-additional-sources.json');
  const {JOB_PROVIDERS}=require('../dist/job-pool/job-providers');
  assert.ok(sources.length>=250);
  const keys=new Set();
  for(const source of sources){
    assert.ok(JOB_PROVIDERS.some(provider=>provider.board&&provider.id===source.provider));
    assert.match(source.boardToken,/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/);assert.ok(source.name.trim());
    const key=`${source.provider}:${source.boardToken.toLowerCase()}`;assert.ok(!keys.has(key));keys.add(key);
  }
});

test('new free catalog adds over 100 independently verified software sources without duplicates', () => {
  const fs = require('node:fs');
  const {sources:previous} = require('../prisma/job-pool-additional-sources.json');
  const catalog = require('../prisma/job-pool-expanded-sources.json');
  const {JOB_PROVIDERS} = require('../dist/job-pool/job-providers');
  const keys = new Set(previous.map(source=>`${source.provider}:${source.boardToken}`.toLowerCase()));
  const original = fs.readFileSync(require.resolve('../prisma/migrations/20261016120000_free_us_job_pool/migration.sql'),'utf8');
  for(const match of original.matchAll(/\('source-[^']+', '([^']+)', '(?:[^']|'')*', '([^']*)'/g)) keys.add(`${match[1]}:${match[2]}`.toLowerCase());
  assert.ok(catalog.sources.length > 100);
  assert.equal(catalog.verification.criteria,'remote-us-software');
  assert.equal(catalog.verification.boardsWithMatches,catalog.sources.length);
  assert.ok(catalog.verification.matchingJobsOnCheckedPages >= catalog.sources.length);
  assert.equal(catalog.attribution.license,'CC-BY-4.0');
  assert.equal(catalog.attribution.requiredLink,'https://lastroundai.com/blog/salary-transparency-study-2026');
  for(const source of catalog.sources) {
    const key=`${source.provider}:${source.boardToken}`.toLowerCase();assert.ok(!keys.has(key),key);keys.add(key);
    assert.ok(JOB_PROVIDERS.some(provider=>provider.board&&provider.id===source.provider));
    assert.match(source.boardToken,/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/);assert.ok(source.name.trim());
    assert.deepEqual(Object.keys(source).sort(),['boardToken','name','provider']);
  }
});

test('double expansion uses new verified boards and records a target of at least twice the job baseline', () => {
  const fs = require('node:fs'), path = require('node:path');
  const catalog = require('../prisma/job-pool-double-sources.json');
  const keys = new Set();
  for(const directory of ['20261016120000_free_us_job_pool','20261016160000_remote_us_source_expansion','20261016210000_more_free_software_job_sources']) {
    const sql = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations', directory, 'migration.sql'),'utf8');
    for(const match of sql.matchAll(/\('source-[^']+', '([^']+)', '(?:[^']|'')*', '([^']*)'/g)) keys.add(`${match[1]}:${match[2]}`.toLowerCase());
  }
  assert.ok(catalog.sources.length >= keys.size);
  assert.equal(catalog.target.previousVisibleJobs,1538);
  assert.ok(catalog.target.minimumVisibleJobs >= catalog.target.previousVisibleJobs*2);
  assert.equal(catalog.verification.boardsWithMatches,catalog.sources.length);
  assert.ok(catalog.verification.matchingJobsOnCheckedPages >= catalog.target.previousVisibleJobs);
  for(const source of catalog.sources) {
    const key=`${source.provider}:${source.boardToken}`.toLowerCase();assert.ok(!keys.has(key),key);keys.add(key);
    assert.ok(['ashby','greenhouse','lever','smartrecruiters'].includes(source.provider));
    assert.match(source.boardToken,/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/);
  }
  assert.ok(catalog.attributions.some(item=>item.license==='CC-BY-4.0'));
});
