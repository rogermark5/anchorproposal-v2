require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {SettingsService}=require('../dist/settings/settings.service');
const {AnswersService}=require('../dist/generations/answers.service');
const {MAX_ANSWER_PROMPT_LENGTH,answerPromptLengthError}=require('@anchorproposal/shared');

function fixture(){
 const values=new Map(),writes=[];
 const prisma={systemSetting:{findUnique:async({where})=>values.has(where.key)?{value:values.get(where.key)}:null,
  upsert:async args=>{writes.push(args);const value=values.has(args.where.key)?args.update.value:args.create.value;values.set(args.where.key,value);return{value};}}};
 return{settings:new SettingsService(prisma),prisma,values,writes};
}

test('answer instructions longer than the old 20,000-character limit save intact and remain private',async()=>{
 const f=fixture(),prompt='Write a direct, detailed answer in my voice.\n'+('Follow these writing instructions.\n'.repeat(950))+'Keep this final instruction.';
 assert.ok(prompt.length>29574&&prompt.length<MAX_ANSWER_PROMPT_LENGTH);
 assert.equal(await f.settings.setAnswerPrompt(prompt,'owner'),prompt);
 assert.equal(await f.settings.getAnswerPrompt('owner'),prompt);
 assert.equal(await f.settings.getAnswerPrompt('other'),SettingsService.DEFAULT_ANSWER_PROMPT);
 assert.deepEqual([...f.values.keys()],['answer_prompt:owner']);
});

test('the full 80,000-character limit allows multiline and Unicode prompts without truncating',async()=>{
 const f=fixture();assert.equal(MAX_ANSWER_PROMPT_LENGTH,80000);
 for(const prompt of ['a'.repeat(80000),'文'.repeat(80000),'A'+'\n'.repeat(79998)+'B']){
  assert.equal(answerPromptLengthError(prompt),null);
  await f.settings.setAnswerPrompt(prompt,'owner');assert.equal(await f.settings.getAnswerPrompt('owner'),prompt);
 }
 await f.settings.setAnswerPrompt('  Keep my formatting\n\ninside this prompt.  ','owner');
 assert.equal(await f.settings.getAnswerPrompt('owner'),'Keep my formatting\n\ninside this prompt.');
});

test('over-limit requests explain the limit and preserve the existing saved instructions',async()=>{
 const f=fixture();await f.settings.setAnswerPrompt('Existing instructions','owner');
 const prompt='a'.repeat(80001),message=answerPromptLengthError(prompt);
 assert.match(message,/80,000/);assert.match(message,/80,001/);
 await assert.rejects(f.settings.setAnswerPrompt(prompt,'owner'),error=>error.getStatus()===400&&error.message===message);
 assert.equal(await f.settings.getAnswerPrompt('owner'),'Existing instructions');assert.equal(f.writes.length,1);
});

test('non-text answer instructions return a validation error and blank text retains the existing default-reset behavior',async()=>{
 const f=fixture();
 for(const value of [null,undefined,123,true,{},[]])await assert.rejects(f.settings.setAnswerPrompt(value,'owner'),error=>error.getStatus()===400&&/must be text/.test(error.message));
 assert.equal(f.writes.length,0);
 assert.equal(await f.settings.setAnswerPrompt(' \n\t ','owner'),SettingsService.DEFAULT_ANSWER_PROMPT);
});

test('answer generation sends and stores the complete saved long prompt in the existing conversation',async()=>{
 const f=fixture(),prompt='Writing instructions\n'+('Preserve the complete prompt.\n'.repeat(2000))+'Final instruction.',turns=[],calls=[];
 await f.settings.setAnswerPrompt(prompt,'owner');
 const generation={id:'generation',status:'COMPLETED',structuredOutputJson:{summary:'Fixture resume'},profileSnapshotJson:{},application:{jobTitle:'Engineer',company:'Example',jobDescription:'Build APIs.'},tokenUsage:0,costEstimate:0};
 const service=new AnswersService({
  generationTurn:{count:async({where})=>turns.filter(turn=>turn.purpose===where.purpose).length,findMany:async()=>turns.map(turn=>({...turn})),createMany:async({data})=>turns.push(...data)},
  resumeGeneration:{findUnique:async()=>generation,update:async({data})=>Object.assign(generation,data)},
 },f.settings,{completeChat:async messages=>{calls.push(messages);return{content:'yes',tokenUsage:1};}},
 {getAccessibleGeneration:async(id,user)=>{assert.equal(user.id,'owner');return generation;}});
 await service.prime('generation',{id:'owner',role:'BIDDER'});
 assert.equal(calls.length,1);assert.equal(calls[0].at(-1).content,prompt);
 assert.equal(turns.find(turn=>turn.purpose==='answer_prompt').content,prompt);
 await service.prime('generation',{id:'owner',role:'BIDDER'});assert.equal(calls.length,1);
});
