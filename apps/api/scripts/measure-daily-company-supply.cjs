// Read-only, bounded personal/non-commercial research using Freehire's public API.
// Measures job arrivals and distinct employers; does not start any import worker.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {freehireUrl,FREEHIRE_SOURCES}=require('../dist/job-pool/freehire-feed');
const {plainText,publicJobUrl,jobDate,arrangement}=require('../dist/job-pool/job-providers');
const {eligibleCountries,excludedCountries,unrestrictedWorldwide,poolCountry}=require('../dist/job-pool/job-geography');
const {isSoftwareJob}=require('../dist/job-pool/software-jobs');
const output=path.resolve(__dirname,'../../../tmp/job-pool-qa/company-diversity-2026-10-23');
const normalize=value=>String(value||'').toLowerCase().replace(/\s/g,'');
const hash=value=>crypto.createHash('sha256').update(normalize(value)).digest('hex');
const target=1000;
let now=Date.now(),cutoff=now-86400000;
const cached=process.argv.includes('--cached');
const stateCodes=new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '));
function genericRemoteLabel(location){
 if(/^(?:remote(?:\s*[-/]\s*remote)?|any location\s*[/,-]\s*remote|remote\s*\(any state\)|nationwide remote|remote\s*[/,-]\s*homebased)$/i.test(location))return true;
 const state=/^(?:remote\s*[-/]\s*([a-z]{2})|([a-z]{2})\s*[-/]\s*remote)$/i.exec(location);
 return !!state&&stateCodes.has((state[1]||state[2]).toUpperCase());
}
const companies=rows=>new Set(rows.map(row=>normalize(row.company)));
function qualifies(row){
 const description=plainText(row.description);
 const structured=(row.countries||[]).map(poolCountry).filter(Boolean),located=eligibleCountries(row.location);
 const worldwide=unrestrictedWorldwide(row.location)&&!row.countries?.length;
 const generic=genericRemoteLabel(plainText(row.location,1000));
 const countries=(worldwide?['US','GB','IE']:structured.filter(code=>generic||located.includes(code))).filter(code=>!excludedCountries(description).includes(code));
 const seen=jobDate(row.last_seen_at);
 return FREEHIRE_SOURCES.includes(row.source)&&row.work_mode==='remote'&&!row.closed_at&&countries.length&&seen&&seen.getTime()>=now-7*86400000&&seen.getTime()<=now+86400000&&
  !['HYBRID','ONSITE'].includes(arrangement(row.location))&&publicJobUrl(row.url)&&isSoftwareJob(row.title,description);
}
(async()=>{
 await fs.mkdir(output,{recursive:true});
 if(cached){const previous=JSON.parse(await fs.readFile(path.join(output,'daily-company-supply.json'),'utf8'));now=Date.parse(previous.checkedAt);cutoff=now-86400000;}
 const known=JSON.parse(await fs.readFile(path.join(output,'company-hashes.json'),'utf8'));
 const history=new Set(known.historical),report={checkedAt:new Date(now).toISOString(),analyzedAt:new Date().toISOString(),cached,rolling24hStart:new Date(cutoff).toISOString(),targetNewCompaniesPerDay:target,scope:'Current production Freehire role categories; remote; US/GB/IE or explicit worldwide; supported direct employer ATS sources only; existing excluded titles.',modes:[],limitations:['This is one rolling 24-hour snapshot from one provider, not a market-wide upper bound or a sustained daily rate.','Provider first-seen jobs can be old postings newly discovered by that provider. Source posting dates can be refreshed externally.','New company means a normalized name absent from local stored Job Pool history; user-specific application history was not queried.','Offset pagination is not a frozen snapshot; provider totals can change while paging.'],databaseWrites:false};
 for(const mode of ['posted_within_days','open_within_days']){
  const rows=new Map(),totals=[];let complete=false,pages=0;
  for(let page=0;page<50;page++){
   const url=freehireUrl(null);url.searchParams.delete('source');url.searchParams.set('regions','global');url.searchParams.set(mode,'1');url.searchParams.set('sort',mode==='posted_within_days'?'posted_at':'created_at');url.searchParams.set('offset',String(page*100));
   const cacheFile=path.join(output,'daily-'+mode+'-'+page+'.json');let data;
   if(cached)data=JSON.parse(await fs.readFile(cacheFile,'utf8'));
   else{
    const response=await fetch(url,{headers:{Accept:'application/json','User-Agent':'AnchorProposal/1.0 (personal read-only daily employer supply research)'},signal:AbortSignal.timeout(35000)});
    if(!response.ok){await response.body?.cancel();throw Error('HTTP '+response.status+'; stopped without bypassing limits.');}
    data=await response.json();
   }
   if(!Array.isArray(data.data)||!Number.isSafeInteger(data.meta?.total)||data.meta.offset!==page*100||(data.meta.ignored_params||[]).length)throw Error('Invalid pagination or ignored filter.');
   if(!cached)await fs.writeFile(cacheFile,JSON.stringify(data));
   totals.push(data.meta.total);pages++;
   for(const row of data.data)rows.set(row.public_slug,row);
   if(page===0)console.log(JSON.stringify({mode,providerReportedJobs:data.meta.total}));
   if(page*100+data.data.length>=data.meta.total){complete=true;break;}
   if(data.data.length!==100)throw Error('Incomplete provider page.');
   if(!cached)await new Promise(resolve=>setTimeout(resolve,1600));
  }
  const dateField=mode==='posted_within_days'?'posted_at':'created_at';
  const timed=[...rows.values()].filter(row=>{const date=jobDate(row[dateField]);return date&&date.getTime()>=cutoff&&date.getTime()<=now;});
  const eligible=timed.filter(qualifies),names=companies(eligible),novel=companies(eligible.filter(row=>!history.has(hash(row.company))));
  const result={mode,dateField,complete,pages,providerTotalsObserved:totals,rawUniqueJobs:rows.size,rolling24hJobs:timed.length,rolling24hCompanyNames:companies(timed).size,filteredJobs:eligible.length,filteredCompanyNames:names.size,filteredCompaniesAbsentLocalHistory:novel.size,targetMetInThisSample:novel.size>=target};
  report.modes.push(result);console.log(JSON.stringify(result));
  if(!cached)await new Promise(resolve=>setTimeout(resolve,1600));
 }
 await fs.writeFile(path.join(output,'daily-company-supply.json'),JSON.stringify(report,null,2)+'\n');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
