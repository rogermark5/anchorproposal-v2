// All temporary accounts and prompt rows roll back. Never changes a real user's instructions.
require('reflect-metadata');
const assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
const {ConfigModule}=require('@nestjs/config'),{PrismaClient}=require('@prisma/client');
const {SettingsService}=require('../dist/settings/settings.service');
(async()=>{
 await ConfigModule.forRoot();const db=new PrismaClient(),rollback=new Error('Intentional answer-prompt QA rollback');
 const supplied=process.argv[2]?fs.readFileSync(process.argv[2],'utf8'):'Long answer instructions.\n'.repeat(1600)+'Final instruction.';
 const prompt=supplied.trim();assert.ok(prompt.length>20000&&prompt.length<=80000,'Supply a prompt between 20,001 and 80,000 characters');
 try{
  try{await db.$transaction(async tx=>{
   const service=new SettingsService(tx),marker=randomUUID();
   const owner=await tx.user.create({data:{email:marker+'-answer-owner@qa.invalid',passwordHash:'not-a-login-hash',firstName:'QA',lastName:'Owner',role:'ADMIN'}});
   const other=await tx.user.create({data:{email:marker+'-answer-other@qa.invalid',passwordHash:'not-a-login-hash',firstName:'QA',lastName:'Other',role:'ADMIN'}});
   assert.ok(await service.setAnswerPrompt(prompt,owner.id)===prompt,'Save must retain the entire supplied prompt');
   const reloaded=new SettingsService(tx);assert.ok(await reloaded.getAnswerPrompt(owner.id)===prompt,'Database reload must preserve the full supplied text');
   assert.equal(await reloaded.getAnswerPrompt(other.id),SettingsService.DEFAULT_ANSWER_PROMPT);
   await assert.rejects(service.setAnswerPrompt('x'.repeat(80001),owner.id),error=>error.getStatus()===400);
   assert.ok(await reloaded.getAnswerPrompt(owner.id)===prompt,'Rejected save must not change the supplied prompt');
   console.log('PASS: '+prompt.length+'-character supplied prompt round-trips through PostgreSQL without truncation; ownership and failed-save preservation verified.');
   throw rollback;
  },{timeout:30000});}catch(error){if(error!==rollback)throw error;}
  console.log('PASS: all temporary QA accounts and prompt rows rolled back.');
 }finally{await db.$disconnect();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
