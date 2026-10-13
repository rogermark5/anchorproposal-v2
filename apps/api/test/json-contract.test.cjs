require('reflect-metadata');const {test}=require('node:test');const assert=require('node:assert/strict');
const {DeepseekService}=require('../dist/deepseek/deepseek.service');
const {appendJsonRules,promptInstructions,JSON_RULE_END,JSON_RULE_START}=require('../dist/deepseek/json-rules');
const {usableCoverLetter}=require('../dist/deepseek/cover-letter');
const {renderCoverLetterHtml,coverLetterDate}=require('../dist/documents/cover-letter-layout');
const {redactPromptMetadata}=require('../dist/generations/profile-output');
const letter={greeting:'Dear Hiring Manager,',paragraphs:['My Java API development aligns with your role.','I built reliable services with testing and clear documentation.','I welcome a discussion about your team.'],closing:'Sincerely,',signatureName:'Wrong person'};
const profile={firstName:'Jason',lastName:'Glenn',email:'jason@example.com',phone:'555-0100',city:'Seattle',state:'WA',profileTitle:'Software Engineer',experiences:[{title:'Engineer',company:'Saved company',responsibilities:'Built APIs'}],education:[],certifications:[],skills:[]};
const meta={profileSnapshot:profile,profileExperiences:profile.experiences,candidateName:'Jason Glenn',experienceTitleMode:'saved'};
const resume={summary:'Java engineer.',experiences:[{bullets:['Built supported Java APIs.']}],educations:[],certificates:[],coverLetter:letter};
const endsCorrectly=text=>{assert.ok(text.endsWith(JSON_RULE_END));assert.equal(text.split(JSON_RULE_START).length,2);};
test('required contract replaces old rules and is last after profile and job context',()=>{
 const s=new DeepseekService({});for(const kind of ['combined','resume','cover-letter']){
  const raw=appendJsonRules(appendJsonRules('My instructions','combined'),kind,'tailored');endsCorrectly(raw);assert.equal(promptInstructions(raw),'My instructions');
  const prompt=s.buildPrompt(raw,{profileJson:JSON.stringify(profile),company:'Hiring Co',jobTitle:'Developer',jobDescription:'Java APIs',documentKind:kind});
  endsCorrectly(prompt);assert.match(prompt,/Jason/);assert.match(prompt,/Hiring Co/);
 }
});
test('automatic and separate generation require correct JSON in every request',async()=>{
 const s=new DeepseekService({requireApiKey:async()=> 'fixture',getModel:async()=> 'fixture'});const requests=[];
 s.chatJson=async(_a,_b,m)=>{requests.push(m);return{parsed:requests.length===1?resume:{coverLetter:letter},tokenUsage:1};};
 const result=await s.generate('Conflicting output instructions',{...meta,coverLetterPrompt:'Write a letter.'});
 assert.equal(result.content.contact.name,'Jason Glenn');assert.equal(result.content.coverLetter.signatureName,'Jason Glenn');
 assert.equal(requests.length,2);for(const messages of requests){endsCorrectly(messages[0].content);endsCorrectly(messages.at(-1).content);}
});
test('bad structure gets one repair and empty summaries never become saved output',async()=>{
 const s=new DeepseekService({requireApiKey:async()=> 'fixture',getModel:async()=> 'fixture'});let calls=0;
 s.chatJson=async()=>({parsed:++calls===1?{...resume,summary:''}:resume,tokenUsage:1});
 assert.equal((await s.generate('Instructions',meta)).content.summary,'Java engineer.');assert.equal(calls,2);
 calls=0;s.chatJson=async()=>{calls++;return{parsed:{...resume,summary:''},tokenUsage:1};};
 await assert.rejects(s.generate('Instructions',meta),/non-empty summary/);assert.equal(calls,2);
});
test('malformed provider JSON is retried with the same final contract and bounded attempts',async()=>{
 const original=global.fetch;let calls=0;const requests=[];const s=new DeepseekService({});
 global.fetch=async(_url,options)=>{requests.push(JSON.parse(options.body));calls++;return{ok:true,json:async()=>({choices:[{message:{content:calls===1?'broken {':JSON.stringify(resume)}}],usage:{total_tokens:3}})};};
 try{const result=await s.chatJson('fixture','fixture',[{role:'user',content:appendJsonRules('Instructions')}]);assert.equal(calls,2);assert.equal(result.tokenUsage,6);for(const req of requests)endsCorrectly(req.messages.at(-1).content);
 calls=0;global.fetch=async()=>{calls++;return{ok:true,json:async()=>({choices:[{message:{content:'broken {'}}]})};};await assert.rejects(s.chatJson('fixture','fixture',[]),/invalid JSON/);assert.equal(calls,3);
 }finally{global.fetch=original;}
});
test('tailored manual JSON needs only allowed sections and uses database identity',()=>{
 const s=new DeepseekService({});const result=s.parseManualResponse(JSON.stringify({...resume,experiences:[{role:'Backend Engineer',bullets:['Built Java APIs.']}]}),{...meta,experienceTitleMode:'tailored'});
 assert.equal(result.contact.name,'Jason Glenn');assert.equal(result.experiences[0].title,'Backend Engineer');
});
test('cover signoffs in paragraphs, appended signatures and repeated closing lines become one closing',()=>{
 for(const suffix of ['\nSincerely,\nJason Glenn\nSincerely,',' Sincerely, Jason Glenn','\nBest regards,\nWrong person']){
  const cleaned=usableCoverLetter({...letter,paragraphs:[...letter.paragraphs.slice(0,2),letter.paragraphs[2]+suffix,'Sincerely,','Jason Glenn'],closing:'Sincerely,\nSincerely,\nJason Glenn'},'Jason Glenn');
  assert.deepEqual(cleaned.paragraphs,letter.paragraphs);assert.equal(cleaned.closing,'Sincerely,');assert.equal(cleaned.signatureName,'Jason Glenn');
 }
});
test('professional cover preview has saved contact header, recipient, role and one signoff',()=>{
 const content=usableCoverLetter(letter,'Jason Glenn');const html=renderCoverLetterHtml({...content,contact:{name:'Jason Glenn',title:'Software Engineer',email:profile.email,phone:profile.phone,address:'Seattle, WA'},company:'Hiring Co',jobTitle:'Backend Engineer',date:'2026-10-12'},{});
 for(const value of ['Jason Glenn','jason@example.com','555-0100','Seattle, WA','Hiring Co','Backend Engineer'])assert.ok(html.includes(value));
 assert.equal(html.split('Sincerely,').length,2);assert.ok(!html.includes('Wrong person'));assert.ok(!html.includes('border:'));
 assert.ok(html.includes('October 12, 2026'));assert.equal(coverLetterDate('2026-10-12'),'October 12, 2026');
});
test('document metadata excludes private prompt content and related prompt records',()=>{
 const result=redactPromptMetadata({id:'g',promptSnapshot:'secret',coverLetterPromptSnapshot:'private',promptVersion:{content:'secret'},structuredOutputJson:resume});
 const serialized=JSON.stringify(result);assert.ok(!serialized.includes('secret'));assert.ok(!serialized.includes('private'));assert.equal(result.id,'g');
});
