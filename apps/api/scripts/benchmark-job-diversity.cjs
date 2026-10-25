// Bounded, read-only public API comparison. Does not modify the Job Pool.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {plainText,publicJobUrl,arrangement,jobDate}=require('../dist/job-pool/job-providers');
const {eligibleCountries,POOL_COUNTRIES,excludedCountries}=require('../dist/job-pool/job-geography');
const {remotejobsCountries}=require('../dist/job-pool/remotejobs-feed');
const {isSoftwareJob,mayBeSoftwareJob,DEFAULT_EXCLUDED_TITLE_KEYWORDS}=require('../dist/job-pool/software-jobs');
const root=path.resolve(__dirname,'../../..'),output=path.join(root,'tmp/job-pool-qa/company-diversity-2026-10-23');
const normalize=value=>String(value||'').toLowerCase().replace(/\s/g,'');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const now=Date.now(),gates=new Map(),blocked=new Set(),log=[];
const cached=process.argv.includes('--cached');
function timezoneOffset(value){
  if(typeof value==='number'&&Number.isFinite(value))return value;
  const match=String(value).match(/^(?:UTC|GMT)?\s*([+-]?\d{1,2})(?::(\d{2}))?$/i);
  return match?Number(match[1])+(Number(match[2]||0)/60)*(match[1].startsWith('-')?-1:1):null;
}
async function read(url,label){
  url=new URL(url);const host=url.hostname;if(blocked.has(host))throw Error('Provider stopped after a rate limit');
  const cacheFile=path.join(output,'response-'+label+'-'+crypto.createHash('sha256').update(url.href).digest('hex').slice(0,12)+'.json');
  if(cached)return JSON.parse(await fs.readFile(cacheFile,'utf8'));
  const wait=host==='remotejobs.org'?19000:host==='freehire.me'?1500:1200;
  const gate=(gates.get(host)||Promise.resolve()).then(()=>delay(wait));gates.set(host,gate);await gate;
  const started=Date.now();const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(35000),headers:{Accept:'application/json','User-Agent':'AnchorProposal/1.0 (read-only employer diversity evaluation)'}});
  log.push({url:url.href,status:response.status,at:new Date().toISOString(),ms:Date.now()-started});
  if(response.status===429){blocked.add(host);await response.body?.cancel();throw Error('HTTP 429; stopped provider and respected Retry-After: '+response.headers.get('retry-after'));}
  if(!response.ok){await response.body?.cancel();throw Error('HTTP '+response.status);}
  if(Number(response.headers.get('content-length'))>20*1024*1024){await response.body?.cancel();throw Error('Response too large');}
  const reader=response.body.getReader(),parts=[];let bytes=0;
  try{while(true){const item=await reader.read();if(item.done)break;bytes+=item.value.length;if(bytes>20*1024*1024){await reader.cancel();throw Error('Response too large');}parts.push(item.value);}}finally{reader.releaseLock();}
  const data=JSON.parse(Buffer.concat(parts).toString('utf8'));
  await fs.writeFile(cacheFile,JSON.stringify(data));return data;
}
function adapt(provider,row){
  let job;
  if(provider==='ocean')job={id:row.id,title:row.title,company:row.company_name||row.company_domain,domain:row.company_domain,location:row.location,description:row.description||'',countries:eligibleCountries(row.location),remote:row.workplace_type==='remote'&&row.confidence==='verified',url:row.url,date:row.posted_at,seen:row.last_seen,closed:row.closed_at,descriptionVerified:!!row.description};
  if(provider==='himalayas'){
    const countries=Array.isArray(row.locationRestrictions)?row.locationRestrictions:null;
    const description=plainText(row.description),excluded=excludedCountries(description);
    const eligible=countries===null?[]:countries.length===0?[...POOL_COUNTRIES]:[...new Set(countries.flatMap(country=>eligibleCountries('',country)))];
    const offsets=(row.timezoneRestrictions||[]).map(timezoneOffset),unknownTimezone=offsets.some(value=>value===null);
    const countryOffsets={US:[-10,-9,-8,-7,-6,-5,-4],GB:[0,1],IE:[0,1]};
    const compatible=country=>!offsets.length||(!unknownTimezone&&countryOffsets[country].some(offset=>offsets.includes(offset)));
    job={id:row.guid,title:row.title,company:row.companyName,companySlug:row.companySlug,location:countries?.join(', ')||'Worldwide',description,countries:eligible.filter(country=>!excluded.includes(country)&&compatible(country)),remote:!!countries&&!['HYBRID','ONSITE'].includes(arrangement(row.title)),url:row.applicationLink,date:row.pubDate,expires:row.expiryDate,descriptionVerified:true,dateMeaning:'last-updated (not original publication)',timezoneRestricted:offsets.length>0&&Object.values(countryOffsets).flat().some(offset=>!offsets.includes(offset)),unknownTimezone};
  }
  if(provider==='remotejobs')job={id:row.id,title:row.title,company:row.company?.name,location:row.location,description:plainText(row.description),countries:remotejobsCountries(row),remote:!['HYBRID','ONSITE'].includes(arrangement(row.location)),url:row.apply_url,date:row.posted_at,descriptionVerified:true};
  if(provider==='jobicy')job={id:String(row.id),title:row.jobTitle,company:row.companyName,location:row.jobGeo,description:plainText(row.jobDescription),countries:eligibleCountries(row.jobGeo),remote:!['HYBRID','ONSITE'].includes(arrangement(row.jobGeo)),url:row.url,date:row.pubDate,descriptionVerified:true};
  if(provider==='remoteok')job={id:String(row.id),title:row.position,company:row.company,location:row.location,description:plainText(row.description),countries:eligibleCountries(row.location),remote:!['HYBRID','ONSITE'].includes(arrangement(row.location)),url:row.url,date:row.date,descriptionVerified:true};
  if(provider==='arbeitnow')job={id:row.slug,title:row.title,company:row.company_name,location:row.location,description:plainText(row.description),countries:eligibleCountries(row.location),remote:row.remote===true,url:row.url,date:row.created_at,descriptionVerified:true};
  if(provider==='freehire')job={id:row.public_slug,title:row.title,company:row.company,location:row.location,description:plainText(row.description),countries:row.countries?.length?[...new Set(row.countries.flatMap(code=>eligibleCountries('',code)))]:eligibleCountries(row.location),remote:row.work_mode==='remote',url:row.url,date:row.posted_at,closed:row.closed_at,descriptionVerified:true};
  return job;
}
function qualifies(job){
  if(!job||!job.id||!job.company||!job.remote||!job.countries.length||job.closed||!publicJobUrl(job.url))return false;
  const expiry=jobDate(job.expires);if(expiry&&expiry.getTime()<=now)return false;
  const seen=jobDate(job.seen);if(job.seen&&(!seen||seen.getTime()<now-7*86400000))return false;
  return job.descriptionVerified?isSoftwareJob(job.title,job.description):mayBeSoftwareJob(job.title);
}
async function benchmark(provider,load){
  const sample=[],seen=new Set();let total=null,complete=false,error=null,pages=0;
  const add=rows=>{for(const row of rows){const job=adapt(provider,row);if(job&&!seen.has(job.id)){seen.add(job.id);sample.push(job);}}};
  try{({total,complete,pages}=await load(add));}catch(reason){error=reason.message;}
  const eligible=sample.filter(qualifies),fresh=eligible.filter(job=>{const date=jobDate(job.date);return date&&date.getTime()>=now-86400000&&date.getTime()<=now;});
  const companies=rows=>new Set(rows.map(job=>normalize(job.company)));
  const histogram={};for(const job of eligible)histogram[normalize(job.company)]=(histogram[normalize(job.company)]||0)+1;
  const known=JSON.parse(await fs.readFile(path.join(output,'registered-sources.json'),'utf8'));
  const catalog=new Set(known.flatMap(row=>[normalize(row.name),normalize(row.boardToken)]));
  const result={provider,checkedAt:new Date().toISOString(),cached,providerReportedTotal:total,complete,pages,rawUniqueJobs:sample.length,rawCompanies:companies(sample).size,eligibleJobs:eligible.length,eligibleCompanies:companies(eligible).size,sourceDateMeaning:provider==='himalayas'?'last updated, not first published':'provider publication timestamp',sourceTimestampWithin24hJobs:fresh.length,sourceTimestampWithin24hCompanies:companies(fresh).size,eligibleCompaniesNotMatchingCatalogNames:companies(eligible.filter(job=>!catalog.has(normalize(job.company)))).size,duplicateCompanyJobRows:eligible.length-companies(eligible).size,descriptionVerifiedJobs:eligible.filter(job=>job.descriptionVerified).length,timezoneRestrictedJobs:eligible.filter(job=>job.timezoneRestricted).length,unknownTimezoneJobs:sample.filter(job=>job.unknownTimezone).length,topFiveCompanies:Object.entries(histogram).sort((a,b)=>b[1]-a[1]).slice(0,5),error};
  await fs.writeFile(path.join(output,provider+'-benchmark.json'),JSON.stringify({result,eligibleJobs:eligible},null,2));console.log(JSON.stringify(result));return result;
}
const tasks={
 ocean:addLoad=>benchmark('ocean',async add=>{let total=null,count=0,pages=0;for(;pages<20;pages++){const url=new URL('https://oceanofjobs.com/api/jobs');url.search=new URLSearchParams({country:'US,GB,IE',workplace:'remote',confidence:'verified',department:'Software Engineering,Infrastructure,Data & AI,Security,QA',limit:'500',offset:String(pages*500)});const data=await read(url,'ocean');if(!Array.isArray(data.jobs)||data.offset!==pages*500)throw Error('Invalid pagination');total=data.total;add(data.jobs);count+=data.jobs.length;if(data.jobs.length<500||count>=total)return{total,complete:true,pages:pages+1};}return{total,complete:false,pages};}),
 himalayas:()=>benchmark('himalayas',async add=>{const totals={};let pages=0;for(const country of ['US','GB','IE'])for(let page=1;page<=15;page++){const data=await read('https://himalayas.app/jobs/api/search?'+new URLSearchParams({q:'software',country,sort:'recent',page:String(page)}),'himalayas');if(!Array.isArray(data.jobs))throw Error('Invalid response');add(data.jobs);totals[country]=data.totalCount;pages++;if(!data.jobs.length||page*20>=data.totalCount)break;}return{total:totals,complete:false,pages};}),
 jobicy:()=>benchmark('jobicy',async add=>{let pages=0;for(const geo of ['usa','uk','ireland','anywhere']){let cursor;for(let page=0;page<3;page++){const url=new URL('https://jobicy.com/api/jobs');url.search=new URLSearchParams({count:'100',geo,...(cursor?{cursor}:{})});const data=await read(url,'jobicy');if(!Array.isArray(data.jobs))throw Error('Invalid response');add(data.jobs);pages++;if(!data.hasMore||!data.nextCursor)break;cursor=data.nextCursor;}}return{total:null,complete:false,pages};}),
 remotejobs:()=>benchmark('remotejobs',async add=>{const totals={};let pages=0;for(const category of ['programming','devops','data-science'])for(let page=0;page<3;page++){const data=await read('https://remotejobs.org/api/v1/jobs?'+new URLSearchParams({category,limit:'50',offset:String(page*50)}),'remotejobs');if(!Array.isArray(data.data))throw Error('Invalid response');add(data.data);totals[category]=data.pagination.total;pages++;if(!data.pagination.has_more)break;}return{total:totals,complete:false,pages};}),
 arbeitnow:()=>benchmark('arbeitnow',async add=>{const data=await read('https://www.arbeitnow.com/api/job-board-api','arbeitnow');add(data.data);return{total:null,complete:!data.links?.next,pages:1};}),
 remoteok:()=>benchmark('remoteok',async add=>{const data=await read('https://remoteok.com/api','remoteok');add(data.filter(row=>row.id));return{total:data.length-1,complete:true,pages:1};}),
 freehire:()=>benchmark('freehire',async add=>{const url=new URL('https://freehire.me/api/v1/agent/jobs/search');url.search=new URLSearchParams({countries:'US,GB,IE',work_mode:'remote',category:'software_engineering,backend,frontend,fullstack,mobile,devops,sre,data_engineering,data_science,ml_ai,qa,security',sort:'posted_at',order:'desc',limit:'100',offset:'0',description_format:'text'});const data=await read(url,'freehire');add(data.data);return{total:data.meta.total,complete:false,pages:1};}),
};
(async()=>{await fs.mkdir(output,{recursive:true});const names=process.argv.slice(2).filter(arg=>arg!=='--cached'),selected=names.length?names:Object.keys(tasks);for(const name of selected)if(!tasks[name])throw Error('Unknown provider: '+name);const results=await Promise.allSettled(selected.map(name=>tasks[name]()));await fs.writeFile(path.join(output,'benchmark-run-'+Date.now()+'.json'),JSON.stringify({startedAt:new Date(now).toISOString(),exclusions:DEFAULT_EXCLUDED_TITLE_KEYWORDS,results,requests:log},null,2));if(results.some(item=>item.status==='rejected'||item.value.error))process.exitCode=1;})().catch(error=>{console.error(error);process.exitCode=1;});
