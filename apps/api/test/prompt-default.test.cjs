require('reflect-metadata');
const {test}=require('node:test'); const assert=require('node:assert/strict');
const {DEFAULT_PROMPT}=require('@anchorproposal/shared');
const {promptInstructions,JSON_RULE_END}=require('../dist/deepseek/json-rules');
const {fixture}=require('./private-prompt-fixture.cjs');
test('missing defaults become independent owned copies for every role',async()=>{
 const f=fixture(); const identities=[{id:'b1',role:'BIDDER'},{id:'master',role:'MASTER'}];
 const a=await f.service.resolvePromptForUser(identities[0]);const b=await f.service.resolvePromptForUser(identities[1]);
 assert.notEqual(a.id,b.id);assert.equal(a.ownerId,'b1');assert.equal(b.ownerId,'master');
 assert.equal(promptInstructions(a.content),DEFAULT_PROMPT.trim());assert.ok(a.content.endsWith(JSON_RULE_END));
 assert.equal((await f.service.resolvePromptForUser(identities[0])).id,a.id);
});
test('restoring starter instructions makes a personal copy without changing other prompts',async()=>{
 const f=fixture(); const result=await f.service.updateMyPromptSettings(f.actor,{resetToDefault:true,mode:'user'});
 assert.equal(result.effectivePrompt.ownerId,f.actor.id);assert.equal(result.useMasterPrompt,false);
 assert.equal(promptInstructions(result.effectivePrompt.content),DEFAULT_PROMPT.trim());
 assert.equal(result.assignmentMode,'user');assert.equal(f.state.prompts.find(p=>p.id==='private').content,'Private text');
 assert.equal(f.state.prompts.find(p=>p.id==='shared').content,'Old shared text');
});
test('foreign selected prompt is ignored and never becomes a shared fallback',async()=>{
 const f=fixture();f.state.users[1].selectedPromptId='private';
 assert.equal((await f.service.resolvePromptForUser({id:'b1',role:'BIDDER'})).ownerId,'b1');
});
test('failed default creation rolls back user selection and generation mode',async()=>{
 const f=fixture();f.state.failCreate=true;
 await assert.rejects(f.service.updateMyPromptSettings(f.actor,{resetToDefault:true,mode:'user'}),/Database unavailable/);
 assert.equal(f.state.users[0].selectedPromptId,'private');assert.equal(f.state.users[0].generationPromptMode,'profile');
});
