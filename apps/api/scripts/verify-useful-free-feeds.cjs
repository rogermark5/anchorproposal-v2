// Bounded public-feed verification. Never starts workers or changes the DB.
require('reflect-metadata');
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {ConfigModule}=require('@nestjs/config'),{PrismaClient}=require('@prisma/client');
const {fetchJobPage,readFeed}=require('../dist/job-pool/job-providers');
const {USEFUL_FREE_FEEDS}=require('../dist/job-pool/public-rss-feeds');
const {ADDITIONAL_FREE_IDS}=require('../dist/job-pool/additional-free-feeds');
const {isFreshPoolPosting,poolImportTimeZone}=require('../dist/job-pool/job-freshness');
const {isSoftwareJob,DEFAULT_EXCLUDED_TITLE_KEYWORDS}=require('../dist/job-pool/software-jobs');
const root=path.resolve(__dirname,'../../..'),folder=path.join(root,'tmp/job-pool-qa/free-source-expansion');
const key=value=>String(value||'').toLowerCase().replace(/\s/g,'');
(async()=>{
 await ConfigModule.forRoot();await fs.mkdir(folder,{recursive:true});const db=new PrismaClient();let keywords=DEFAULT_EXCLUDED_TITLE_KEYWORDS,known=new Set();
 try{const settings=await db.systemSetting.findUnique({where:{key:'job_pool_settings'}});keywords=JSON.parse(settings?.value||'{}').excludedTitleKeywords||keywords;known=new Set((await db.jobPoolCompany.findMany({select:{key:true}})).map(row=>row.key));}finally{await db.$disconnect();}
 const report={checkedAt:new Date().toISOString(),timeZone:poolImportTimeZone(),databaseWrites:false,cached:process.argv.includes('--cached'),rule:'Remote software roles eligible for US, UK or Ireland, posted today in the configured timezone; saved title exclusions apply.',sources:[]};
 const all=new Map(),sessionReads=new Map();
 const oldCategories=['software-development','devops','data','cybersecurity','qa','ai'];
 for(const source of USEFUL_FREE_FEEDS.filter(source=>(!process.argv.includes('--new-public')||ADDITIONAL_FREE_IDS.includes(source.provider))&&(!process.argv.includes('--rss-skills')||source.provider==='remotefirst'&&!oldCategories.includes(source.boardToken)))){
  const started=Date.now();const rows=new Map();let complete=false,pages=0,cursor=null;
  try{
   for(let page=0;page<5;page++){
    const result=await fetchJobPage(source,cursor,async(url,headers)=>{
     const cache=path.join(folder,'verified-'+createHash('sha256').update(url.href).digest('hex')+'.json');
     if(process.argv.includes('--cached'))return JSON.parse(await fs.readFile(cache,'utf8'));
     if(!sessionReads.has(url.href))sessionReads.set(url.href,readFeed(url,headers).then(async response=>{await fs.writeFile(cache,JSON.stringify(response));return response;}));
     return sessionReads.get(url.href);
    });pages++;
    for(const job of result.jobs)if(isFreshPoolPosting(job.publishedAt)&&isSoftwareJob(job.title,job.description,keywords)&&(!job.expiresAt||job.expiresAt>new Date()))rows.set(job.jobUrl,job);
    complete=result.complete;if(!result.next)break;cursor=result.next;
   }
   for(const [url,job] of rows)all.set(url,job);
   const names=new Set([...rows.values()].map(job=>key(job.company)));
   const item={provider:source.provider,feed:source.boardToken||'all',pages,complete,todayMatchingJobs:rows.size,companies:names.size,companiesAbsentLocalHistory:[...names].filter(name=>!known.has(name)).length,ms:Date.now()-started};
   report.sources.push(item);console.log(JSON.stringify(item));
  }catch(error){const item={provider:source.provider,feed:source.boardToken||'all',error:error.message,pages,ms:Date.now()-started};report.sources.push(item);console.log(JSON.stringify(item));}
 }
 const companies=new Set([...all.values()].map(job=>key(job.company)));
 report.summary={uniqueSourceUrls:all.size,distinctCompanyNames:companies.size,companiesAbsentLocalHistory:[...companies].filter(name=>!known.has(name)).length,byCountry:Object.fromEntries(['US','GB','IE'].map(code=>[code,[...all.values()].filter(job=>job.eligibleCountries.includes(code)).length])),note:'Snapshot of source URLs, before cross-provider content deduplication. Existing postings can upgrade missing metadata without creating a new job. This is not a guaranteed daily supply.'};
 await fs.writeFile(path.join(root,process.argv.includes('--new-public')?'research/additional-free-public-feeds-2026-10-24.json':process.argv.includes('--rss-skills')?'research/additional-free-rss-results-2026-10-24.json':'research/useful-free-feeds-2026-10-24.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));
})().catch(error=>{console.error(error.message);process.exitCode=1});
