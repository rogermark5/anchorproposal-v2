require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {companyKey,employerBoard}=require('../dist/job-pool/company-discovery');
const {CompanyDiscoveryService}=require('../dist/job-pool/company-discovery.service');
test('company identity follows case and whitespace rules without conflating punctuation or suffixes',()=>{
 assert.equal(companyKey('A C\tM\nE\u00a0\ufeff'),'acme');assert.notEqual(companyKey('Acme Inc.'),companyKey('Acme'));assert.equal(companyKey('constructor'),'constructor');
});
test('manual discovery is honored when an automatic paused check is already in flight',async()=>{
 let release,reads=0;
 const pending=new Promise(resolve=>{release=resolve;});
 const db={systemSetting:{findUnique:async args=>args.where.key==='job_pool_settings'?pending:null,upsert:async()=>({})},jobPoolJob:{findMany:async()=>{reads++;return[];}},jobPoolBoardCandidate:{findMany:async()=>[]}};
 const service=new CompanyDiscoveryService(db);
 const automatic=service.start();service.start(true);release({value:'{"enabled":false}'});await automatic;
 assert.equal(reads,1);
});
test('a failed database lookup does not create a tight manual-discovery retry loop',async()=>{
 let attempts=0;
 const service=new CompanyDiscoveryService({systemSetting:{findUnique:async()=>{attempts++;throw Error('Database unavailable');}}});service.logger.warn=()=>{};
 await service.start(true);await new Promise(resolve=>setImmediate(resolve));assert.equal(attempts,1);await service.onModuleDestroy();
});
test('discovery extracts only explicit supported public employer boards',()=>{
 for(const [url,provider,boardToken] of [
  ['https://jobs.ashbyhq.com/New-Employer/id','ashby','New-Employer'],
  ['https://job-boards.greenhouse.io/acme/jobs/123','greenhouse','acme'],
  ['https://jobs.lever.co/acme/id','lever','acme'],
  ['https://acme.bamboohr.com/careers/123','bamboohr','acme'],
  ['https://acme.teamtailor.com/jobs/123','teamtailor','acme.teamtailor.com'],
 ])assert.deepEqual(employerBoard(url),{provider,boardToken});
 for(const url of ['https://himalayas.app/companies/acme/jobs/id','https://api.ashbyhq.com.evil.example/acme/id','https://jobs.ashbyhq.com:444/acme/id','http://jobs.lever.co/acme/id','https://recruiting.paylocity.com/recruiting/jobs/Details/123'])assert.equal(employerBoard(url),null,url);
});
