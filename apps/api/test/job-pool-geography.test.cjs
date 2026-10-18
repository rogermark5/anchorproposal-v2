const { test } = require('node:test');
const assert = require('node:assert/strict');
const { eligibleCountries, poolCountry } = require('../dist/job-pool/job-geography');
const { remotejobsCountries } = require('../dist/job-pool/remotejobs-feed');
const { fetchJobPage, readFeed } = require('../dist/job-pool/job-providers');
const source = provider => ({ provider, boardToken: 'example', name: 'Example' });

test('Country eligibility recognizes the three markets and keeps Northern Ireland in the UK', () => {
  for (const value of ['UK', 'GB', 'GBR', 'United Kingdom']) assert.equal(poolCountry(value), 'GB');
  for (const value of ['IE', 'IRL', 'Republic of Ireland']) assert.equal(poolCountry(value), 'IE');
  assert.deepEqual(eligibleCountries('Remote, Northern Ireland'), ['GB']);
  assert.deepEqual(eligibleCountries('Remote, UK and Ireland'), ['GB', 'IE']);
  assert.deepEqual(eligibleCountries('Remote, Dublin, CA'), ['US']);
  assert.deepEqual(eligibleCountries('Remote, Dublin', 'IE'), ['IE']);
  for (const value of ['Remote', 'Europe', 'EMEA', 'EU', 'London, Ontario, Canada', 'Tbilisi, Georgia']) assert.deepEqual(eligibleCountries(value), [], value);
  assert.deepEqual(eligibleCountries('London', 'CA'), []);
});

test('Worldwide permission stays explicit and exclusions and residence requirements narrow eligibility', () => {
  assert.deepEqual(eligibleCountries('Worldwide'), ['US', 'GB', 'IE']);
  assert.deepEqual(eligibleCountries('Worldwide', undefined, 'US applicants are not eligible.'), ['GB', 'IE']);
  assert.deepEqual(eligibleCountries('Worldwide', undefined, 'Excluding UK applicants.'), ['US', 'IE']);
  assert.deepEqual(eligibleCountries('Worldwide', undefined, 'You must reside in Ireland.'), ['IE']);
  assert.deepEqual(eligibleCountries('Worldwide', undefined, 'You must be based in the UK or Ireland.'), ['GB','IE']);
  assert.deepEqual(eligibleCountries('Worldwide', undefined, 'US applicants only.'), ['US']);
  assert.deepEqual(eligibleCountries('Worldwide', undefined, 'Only hiring candidates in UK or Ireland.'), ['GB','IE']);
  assert.deepEqual(eligibleCountries('Worldwide', undefined, 'You must reside in Germany.'), []);
  assert.deepEqual(eligibleCountries('Remote UK', undefined, 'UK applicants are not eligible.'), []);
  assert.deepEqual(eligibleCountries('Worldwide', 'DE'), []);
  assert.deepEqual(eligibleCountries('Worldwide', 'US'), ['US']);
});

test('RemoteJobs uses confirmed applicant geography for each country and honors exclusions', () => {
  const requirements = {status:'known',work_arrangement:'remote',allowed_countries:['GB','IE'],excluded_countries:[]};
  assert.deepEqual(remotejobsCountries({applicant_location_requirements:requirements}), ['GB','IE']);
  assert.deepEqual(remotejobsCountries({applicant_location_requirements:{...requirements,excluded_countries:['IE']}}), ['GB']);
  assert.deepEqual(remotejobsCountries({applicant_location_requirements:{...requirements,unresolved:['Europe?']}}), []);
  assert.deepEqual(remotejobsCountries({applicant_location_requirements:{...requirements,allowed_countries:[],scope:'worldwide',worldwide_permission_verified:true,excluded_countries:['US']}}), ['GB','IE']);
});

test('Workable imports only published remote software roles in supported locations with full descriptions', async () => {
  const job = {shortcode:'123',title:'Software Engineer',url:'https://apply.workable.com/j/123',telecommuting:true,description:'Build production software APIs',locations:[{city:'London',country:'United Kingdom',countryCode:'GB'}]};
  const result = await fetchJobPage(source('workable'), null, async url => {
    assert.equal(url.hostname, 'apply.workable.com'); assert.equal(url.searchParams.get('details'), 'true');
    return {jobs:[job,{...job,telecommuting:false},{...job,workplace_type:'hybrid'},{...job,title:'Sales Manager'},{...job,locations:[{countryCode:'DE'}]}]};
  });
  assert.equal(result.jobs.length, 1); assert.deepEqual(result.jobs[0].eligibleCountries, ['GB']); assert.equal(result.jobs[0].description, job.description);
});

test('Recruitee imports Ireland remote roles and rejects hybrid and unpublished records', async () => {
  const job = {id:1,title:'Backend Developer',careers_url:'https://example.recruitee.com/o/engineer',remote:true,hybrid:false,on_site:false,status:'published',description:'Build software APIs',requirements:'TypeScript',country_code:'IE',location:'Dublin, Ireland'};
  const result = await fetchJobPage(source('recruitee'), null, async url => {
    assert.equal(url.hostname, 'example.recruitee.com');
    return {offers:[job,{...job,hybrid:true},{...job,status:'draft'},{...job,country_code:'DE'}]};
  });
  assert.equal(result.jobs.length, 1); assert.deepEqual(result.jobs[0].eligibleCountries, ['IE']); assert.match(result.jobs[0].description, /TypeScript/);
});

test('Breezy reads public metadata only on the matching employer host and preserves incomplete imports', async () => {
  const job = {id:'one',name:'Software Engineer',url:'https://example.breezy.hr/p/one-engineer',location:{city:'London',country:{id:'GB',name:'United Kingdom'},is_remote:true}};
  const calls = [];
  const result = await fetchJobPage(source('breezy'), null, async url => { calls.push(url); return calls.length === 1 ? [job] : {description:'Build software APIs'}; });
  assert.equal(calls.length, 2); assert.equal(result.jobs.length, 1); assert.deepEqual(result.jobs[0].eligibleCountries, ['GB']);
  const incomplete = await fetchJobPage(source('breezy'), null, async url => url.pathname === '/json' ? [job] : {description:''});
  assert.equal(incomplete.complete, false); assert.equal(incomplete.incomplete, true);
  await assert.rejects(fetchJobPage(source('breezy'), null, async () => [{...job,url:'https://internal.example/p/one-engineer'}]), /Invalid Breezy/);
  for (const provider of ['breezy', 'recruitee', 'workable']) await assert.rejects(fetchJobPage({...source(provider),boardToken:'example.com.evil'}, null, async () => {throw Error('must not fetch');}), /Invalid employer/);
});

test('Breezy HTML is parsed as data and never executes scripts or returns page chrome', async () => {
  const original = global.fetch;
  try {
    global.fetch = async () => new Response('<script>throw Error("not executed")</script><script type="application/ld+json">{"@type":"JobPosting","description":"<p>Build APIs</p>"}</script>');
    assert.deepEqual(await readFeed(new URL('https://example.breezy.hr/p/one')), {description:'<p>Build APIs</p>'});
  } finally { global.fetch = original; }
});

test('Jobicy has separate free UK and Ireland queries and keeps vague regions out', async () => {
  for (const [boardToken,location,code] of [['uk','UK','GB'],['ireland','Ireland','IE']]) {
    const result = await fetchJobPage({provider:'jobicy',name:'Jobicy',boardToken}, null, async url => {
      assert.equal(url.searchParams.get('geo'), boardToken);
      return {jobs:[{id:1,jobTitle:'Software Engineer',companyName:'Example',jobGeo:location,jobDescription:'Build software',url:'https://jobicy.com/jobs/1'}]};
    });
    assert.deepEqual(result.jobs[0].eligibleCountries, [code]);
  }
});
