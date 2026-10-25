// Read-only research. No database writes, accounts, API keys or paid requests.
const fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'../../..');
const output=path.join(root,'tmp/job-pool-qa/company-diversity-2026-10-23');
const endpoints={
  oceanSpec:'https://oceanofjobs.com/api/openapi.json',
  oceanJobs:'https://oceanofjobs.com/api/jobs?country=US%2CGB%2CIE&workplace=remote&confidence=verified&department=Software%20Engineering%2CInfrastructure%2CData%20%26%20AI%2CSecurity%2CQA&limit=100&offset=0',
  himalayas:'https://himalayas.app/jobs/api?limit=20&offset=0',
  remotejobs:'https://remotejobs.org/api/v1/jobs?category=programming&limit=50&offset=0',
  jobicy:'https://jobicy.com/api/jobs?count=100&geo=usa',
  arbeitnow:'https://www.arbeitnow.com/api/job-board-api',
  freehirePlans:'https://freehire.me/api/v1/plans',
  freehireStats:'https://freehire.me/api/v1/stats/catalog',
  headcountDocs:'https://headcountlabs.com/docs/',
  headcountSpec:'https://api.headcountlabs.com/openapi',
  headcountJobs:'https://api.headcountlabs.com/v1/jobs?country=US&work_arrangement=remote&limit=1',
  himalayasSearch:'https://himalayas.app/jobs/api/search?q=software&country=US&sort=recent&page=1',
  himalayasSpec:'https://himalayas.app/docs/openapi.json',
};
function brief(value,depth=0){
  if(depth>2)return Array.isArray(value)?`Array(${value.length})`:typeof value;
  if(Array.isArray(value))return{length:value.length,first:value.length?brief(value[0],depth+1):null};
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,40).map(([k,v])=>[k,brief(v,depth+1)]));
  return typeof value==='string'?value.slice(0,140):value;
}
async function request(label,url){
  const started=Date.now();
  try{
    const response=await fetch(url,{signal:AbortSignal.timeout(35000),redirect:'error',headers:{Accept:'application/json,text/html;q=0.5','User-Agent':'AnchorProposal/1.0 (read-only public job API research)'}});
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length>20*1024*1024)throw Error('Response larger than 20 MiB');
    await fs.writeFile(path.join(output,label+'.response'),bytes);
    const text=bytes.toString('utf8');let data;try{data=JSON.parse(text);}catch{}
    const result={label,url,status:response.status,ms:Date.now()-started,bytes:bytes.length,retryAfter:response.headers.get('retry-after'),rateLimit:response.headers.get('x-ratelimit-limit'),summary:data?brief(data):text.match(/<a[^>]+href=["']([^"']+)["'][^>]*>[\s\S]*?<\/a>/g)?.filter(x=>/api|limit|sample|coverage|auth/i.test(x)).slice(-30)};
    await fs.writeFile(path.join(output,label+'.probe.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }catch(error){console.log(JSON.stringify({label,url,error:error.message,cause:error.cause?.code}));}
}
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const registered=new Map();
  for(const dir of await fs.readdir(path.join(root,'apps/api/prisma/migrations'))){try{const sql=await fs.readFile(path.join(root,'apps/api/prisma/migrations',dir,'migration.sql'),'utf8');for(const match of sql.matchAll(/\('source-[^']+', '([^']+)', '((?:[^']|'')*)', '([^']*)'/g)){const row={provider:match[1],name:match[2].replaceAll("''","'"),boardToken:match[3]};registered.set((row.provider+':'+row.boardToken).toLowerCase(),row);}}catch{}}
  const {REMOTEJOBS_CATEGORIES}=require('../dist/job-pool/remotejobs-feed');
  for(const boardToken of REMOTEJOBS_CATEGORIES)registered.set('remotejobs:'+boardToken,{provider:'remotejobs',name:boardToken+' via RemoteJobs.org',boardToken});
  registered.set('ocean:',{provider:'ocean',name:'Ocean of Jobs',boardToken:''});
  registered.set('freehire:',{provider:'freehire',name:'Freehire',boardToken:''});
  let directory;
  try{directory=JSON.parse(await fs.readFile(path.join(root,'tmp/job-pool-qa/openjobs-slugs.txt'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  const inventory={registered:registered.size,registeredByProvider:{},directoryBoardsByProvider:directory?Object.fromEntries(Object.entries(directory.ats).map(([p,rows])=>[p,rows.length])):null,newSupportedCandidates:{}};
  for(const row of registered.values())inventory.registeredByProvider[row.provider]=(inventory.registeredByProvider[row.provider]||0)+1;
  for(const [provider,rows] of Object.entries(directory?.ats||{}))if(inventory.registeredByProvider[provider]&&provider!=='usajobs')inventory.newSupportedCandidates[provider]=rows.filter(token=>!registered.has((provider+':'+token).toLowerCase())).length;
  await fs.writeFile(path.join(output,'inventory.json'),JSON.stringify(inventory,null,2));
  await fs.writeFile(path.join(output,'registered-sources.json'),JSON.stringify([...registered.values()]));
  console.log(JSON.stringify({inventory}));
  const args=process.argv.slice(2),selected=args.length?args:Object.keys(endpoints);
  for(const name of selected)if(!endpoints[name])throw Error('Unknown probe: '+name);
  for(let i=0;i<selected.length;i+=3)await Promise.allSettled(selected.slice(i,i+3).map(label=>request(label,endpoints[label])));
})().catch(error=>{console.error(error.message);process.exitCode=1;});
