// Uses an isolated Next build and intercepted APIs. No live account/data changes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),puppeteer=require('puppeteer');
const {calendarDay,calendarRange,shiftCalendarDay}=require('../../../packages/shared/dist');
(async()=>{
 const origin=process.env.QA_WEB_URL||'http://127.0.0.1:3199',folder=path.resolve('../../tmp/job-pool-qa/browser');fs.mkdirSync(folder,{recursive:true});
 const browser=await puppeteer.launch({headless:true,pipe:true,args:['--no-sandbox','--disable-dev-shm-usage'],timeout:120000,protocolTimeout:120000});
 let page;
 try{
  page=await browser.newPage();await page.setViewport({width:1440,height:1000});page.setDefaultTimeout(30000);
  const failures=[];page.on('pageerror',error=>{failures.push(error.message);console.error(error.stack);});await page.evaluateOnNewDocument(()=>{localStorage.setItem('accessToken','qa');localStorage.setItem('refreshToken','qa-refresh');});
  let zone='America/Los_Angeles',cancelled=false,answerSubmitted=false,answerPolls=0;const dateQueries=[],poolQueries=[],answerPosts=[];
  const today=calendarDay(new Date(),zone),earlier=shiftCalendarDay(today,-2),future=shiftCalendarDay(today,2),user={id:'owner',role:'BIDDER',firstName:'QA',lastName:'Owner',email:'qa@qa.invalid',canCreateApplications:true,canGenerateResumes:true,canDownloadDocuments:true};
  const profiles=[{id:'p1',firstName:'Alex',lastName:'One',profileTitle:'Engineer'},{id:'p2',firstName:'Jamie',lastName:'Two',profileTitle:'Engineer'}];
  const make=(id,day)=>({id,jobTitle:id==='today'?'Today Engineer':'Earlier Engineer',company:'QA Co',location:'US',status:'SAVED',createdAt:new Date(calendarRange(day,day,zone).gte.getTime()+3600000).toISOString(),profile:profiles[0],bidder:user,warnings:[],_count:{generations:1},latestGenerationId:'done',latestFiles:{}}),applications=[make('today',today),make('earlier',earlier)];
  const detail=()=>({...applications[0],jobDescription:'Build software.',profileId:'p1',bidderId:'owner',generations:[{id:'running',creatorId:'owner',version:2,status:cancelled?'CANCELLED':'GENERATING',createdAt:new Date().toISOString()},{id:'done',creatorId:'owner',version:1,status:'COMPLETED',createdAt:new Date().toISOString(),files:[]}],notes:[],statusHistory:[]});
  await page.setRequestInterception(true);page.on('request',request=>{
   const url=new URL(request.url());if(!url.pathname.startsWith('/backend/'))return void request.continue();
   const route=url.pathname.slice(8),method=request.method();let data={},status=200;
   if(route==='/auth/me')data=user;
   else if(route==='/settings/time-zone'){if(method==='PATCH')zone=JSON.parse(request.postData()).timeZone;data={timeZone:zone};}
   else if(route==='/profiles')data=profiles;
   else if(route==='/templates')data=[{id:'template',name:'Default template',isPublished:true,isDefault:true}];
   else if(route==='/settings/generation-workflow')data={mode:'user',defaultPrompt:{id:'prompt',content:'Write grounded documents.'},prompts:[],profiles:[],jsonRules:{combined:'{}',resume:'{}','cover-letter':'{}'}};
   else if(route==='/settings/answer-prompt')data={prompt:'Answer clearly.'};
   else if(route==='/application-options')data={locations:[],sources:[]};
   else if(route==='/applications'){
    const from=url.searchParams.get('from'),to=url.searchParams.get('to'),tz=url.searchParams.get('timeZone');dateQueries.push({from,to,tz});
    data=applications.filter(app=>!from||calendarDay(app.createdAt,tz)>=from&&calendarDay(app.createdAt,tz)<=to);
   }else if(route==='/applications/today')data=detail();
   else if(route==='/generations/running/cancel'){cancelled=true;data={id:'running',status:'CANCELLED'};}
   else if(route==='/generations/done/answers')data={primed:true,ack:'yes',items:[{question:'Why?',answer:'{"answers":[{"question":"First?","answer":"My work—matches."},{"question":"Second?","answer":"I reviewed it."}]}'}],...(answerSubmitted?{pending:{id:'request',question:'Why this job?',status:'RUNNING'}}:{})};
   else if(route==='/generations/done/answers/requests'&&method==='POST'){answerSubmitted=true;answerPosts.push(JSON.parse(request.postData()));data={id:'request',status:'QUEUED'};}
   else if(route==='/generations/done/answers/requests/request'){answerPolls++;if(answerPolls===1){status=503;data={message:'QA temporary restart'};}else data=answerPolls<3?{id:'request',status:'RUNNING'}:{id:'request',status:'COMPLETED',view:{primed:true,ack:'yes',items:[{question:'Why this job?',answer:'This role-matches my experience.'}]}};}
   else if(route==='/job-pool') {poolQueries.push(url.searchParams.get('excludeProfileIds'));data={jobs:[],total:0,nextCursor:null,providers:[]};}
   else if(route==='/job-pool/updates')data={total:0,newCount:0};
   void request.respond({status,contentType:'application/json',body:JSON.stringify(data)});
  });
  const waitText=text=>page.waitForFunction(value=>document.body.innerText.includes(value),{},text);
  const clickLabel=async label=>{const found=await page.$(`[aria-label="${label}"]`);assert.ok(found,'Missing '+label);await found.click();};
  const dayLabel=day=>new Date(day+'T12:00:00Z').toLocaleDateString('en-US',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'});
  const range=async(from,to)=>{await clickLabel('Application creation date range');for(const day of[from,to]){let selector=`button[aria-label="${dayLabel(day)}"]`;if(!await page.$(selector))await clickLabel(day<today?'Previous month':'Next month');await clickLabel(dayLabel(day));}};
  await page.goto(origin+'/applications',{waitUntil:'networkidle0'});await waitText('Today Engineer');assert.ok(dateQueries.some(query=>query.from===today&&query.to===today&&query.tz===zone));assert.ok(!(await page.content()).includes('Earlier Engineer'));
  await range(earlier,today);await waitText('Earlier Engineer');await range(future,future);await page.waitForFunction(()=>document.body.innerText.includes('No applications'));assert.ok(!(await page.content()).includes('Today Engineer'));
  await range(earlier,today);await waitText('Today Engineer');await page.screenshot({path:path.join(folder,'application-range.png'),fullPage:true});
  await clickLabel('Application creation date range');const bounds=await page.$eval('[role="dialog"][aria-label="Choose application creation dates"]',element=>{const b=element.getBoundingClientRect();return{left:b.left,right:b.right,top:b.top,bottom:b.bottom};});assert.ok(bounds.left>=0&&bounds.right<=1440&&bounds.top>=0&&bounds.bottom<=1000);await page.keyboard.press('Escape');
  await page.goto(origin+'/applications/today',{waitUntil:'networkidle0'});await waitText('Cancel generation');const cancel=await page.$$('button');for(const button of cancel)if(await button.evaluate(el=>el.textContent==='Cancel generation')){await button.click();break;}for(let attempt=0;!cancelled&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,50));assert.equal(cancelled,true);await waitText('Cancellation requested.');await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='Cancel generation'));
  await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(el=>el.textContent==='Answers')?.click());await waitText('My work-matches.');const assistant=await page.$eval('[data-chat-role="assistant"]',el=>el.innerText);assert.ok(!assistant.includes('"answers"'));assert.ok(assistant.includes('Second?'));assert.ok(!assistant.includes('—'));await page.screenshot({path:path.join(folder,'readable-answers.png'),fullPage:true});
  await page.type('textarea','Why this job?');await page.keyboard.press('Enter');for(let attempt=0;!answerSubmitted&&attempt<100;attempt++)await new Promise(resolve=>setTimeout(resolve,50));assert.equal(answerSubmitted,true);
  await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(el=>el.textContent==='Overview')?.click());await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(el=>el.textContent==='Answers')?.click());await waitText('This role-matches my experience.');assert.equal(answerPosts.length,1);assert.match(answerPosts[0].idempotencyKey,/^[a-f0-9-]{36}$/);assert.ok(answerPolls>=3);
  await page.goto(origin+'/job-pool',{waitUntil:'networkidle0'});await waitText('Exclude');const summary=await page.$('details summary');assert.ok(summary);await summary.click();await page.waitForSelector('input[type="checkbox"]');const checkbox=await page.$('details input[type="checkbox"]');assert.ok(checkbox);await checkbox.click();await page.waitForFunction(()=>document.querySelector('details summary')?.textContent.includes('1'));await new Promise(resolve=>setTimeout(resolve,500));assert.ok(poolQueries.some(value=>value==='p1'));
  await page.goto(origin+'/settings',{waitUntil:'networkidle0'});const tabs=await page.$$('button');for(const button of tabs)if(await button.evaluate(el=>el.textContent==='Time zone')){await button.click();break;}await page.waitForSelector('button[aria-label="Display time zone"]');await page.click('button[aria-label="Display time zone"]');await page.type('input[aria-label="Search time zones"]','Tokyo');await page.waitForFunction(()=>document.querySelectorAll('[role="option"]').length===1);await page.keyboard.press('Enter');await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(el=>el.textContent==='Save time zone')?.click());await page.waitForFunction(()=>document.body.innerText.includes('Time zone saved.'));assert.equal(zone,'Asia/Tokyo');await page.screenshot({path:path.join(folder,'time-zone.png'),fullPage:true});
  assert.deepEqual(failures,[]);console.log('PASS: browser default/range/empty dates, unclipped calendar, server cancellation, readable legacy JSON, profile filtering and saved time zone. Screenshots: '+folder);
 }catch(error){if(page){await page.screenshot({path:path.join(folder,'failure.png'),fullPage:true});console.error((await page.$eval('body',el=>el.innerText)).slice(-4000));}throw error;}finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
