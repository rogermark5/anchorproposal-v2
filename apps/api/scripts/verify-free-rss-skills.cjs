const fs=require('node:fs'),path=require('node:path'),{XMLParser}=require('fast-xml-parser');
const dir=path.resolve('../../tmp/job-pool-qa/free-source-audit'),parser=new XMLParser({parseTagValue:false,isArray:name=>['url','item'].includes(name)});
const wanted=['python','javascript','typescript','react','java','sql','nodejs','aws','azure','kubernetes','docker','rust','cpp','c-sharp','php','ruby','swift','kotlin','android','ios','golang','data-science','data-engineering','machine-learning','artificial-intelligence','cloud-security','systems-administration','security-engineer','unreal-engine','dotnet','tech','web3','data-processing','business-intelligence-analyst'];
(async()=>{
 fs.mkdirSync(dir,{recursive:true});
 const index=await fetch('https://remotefirstjobs.com/sitemap_skills.xml',{signal:AbortSignal.timeout(25000),redirect:'error',headers:{'User-Agent':'AnchorProposal/1.0 (public RSS verifier)'}});
 if(!index.ok)throw Error('Public skill directory returned HTTP '+index.status);
 const sitemap=parser.parse(await index.text()),available=new Set(sitemap.urlset.url.map(row=>new URL(row.loc).pathname.split('/').filter(Boolean).at(-1)));
 const results=[];
 for(const slug of wanted.filter(slug=>available.has(slug))){
  await new Promise(resolve=>setTimeout(resolve,1200));
  try{const res=await fetch(`https://remotefirstjobs.com/rss/jobs/${slug}.rss`,{signal:AbortSignal.timeout(25000),redirect:'error',headers:{'User-Agent':'AnchorProposal/1.0 (public RSS verifier)'}}),text=await res.text();
   if(!res.ok){results.push({slug,status:res.status});if(res.status===429)break;continue;}
   const data=parser.parse(text),rows=data.rss?.channel?.item||[];if(!data.rss?.channel?.title)throw Error('Not an RSS feed');
   fs.writeFileSync(path.join(dir,'rfj-'+slug+'.rss'),text);results.push({slug,status:res.status,rows:rows.length});
  }catch(error){results.push({slug,error:error.message});}
 }
 fs.writeFileSync(path.resolve('../../research/free-rss-skills-audit-2026-10-24.json'),JSON.stringify({checkedAt:new Date().toISOString(),results},null,2));console.log(JSON.stringify(results));
})().catch(error=>{console.error(error);process.exitCode=1;});
