require('reflect-metadata');
const {ConfigModule}=require('@nestjs/config');const {PrismaClient}=require('@prisma/client');
const {randomUUID}=require('node:crypto');const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
 await ConfigModule.forRoot();const db=new PrismaClient();const rollback=new Error('Rollback migration QA');
 try {
  const columns=await db.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name='prompt_versions' AND column_name='documentKind'`;
  if(columns.length){
   const shared=await db.promptVersion.count({where:{ownerId:null,isPublished:true,archivedAt:null}});assert.equal(shared,0);
   const foreignDefaults=await db.$queryRaw`SELECT u.id FROM users u JOIN prompt_versions p ON p.id=u."selectedPromptId" WHERE p."ownerId" IS DISTINCT FROM u.id`;
   const foreignProfiles=await db.$queryRaw`SELECT pref.id FROM profile_generation_preferences pref JOIN prompt_versions p ON p.id=pref."resumePromptId" WHERE p."ownerId" IS DISTINCT FROM pref."userId"`;
   assert.equal(foreignDefaults.length,0);assert.equal(foreignProfiles.length,0);console.log('PASS applied migration: no active shared prompts, foreign defaults, or foreign profile assignments');return;
  }
  try {await db.$transaction(async tx=>{
   const marker=randomUUID();const sharedId=randomUUID();
   const owner=await tx.user.create({data:{email:marker+'@qa.invalid',passwordHash:'not-login-capable',firstName:'QA',lastName:'Owner',role:'ADMIN',generationPromptMode:'profile'}});
   const other=await tx.user.create({data:{email:marker+'-b@qa.invalid',passwordHash:'not-login-capable',firstName:'QA',lastName:'Other',role:'ADMIN',generationPromptMode:'profile'}});
   await tx.$executeRaw`INSERT INTO prompt_versions (id,name,content,version,"isPublished","isInitial","publishedAt","updatedAt") VALUES (${sharedId},'QA shared','Preserve these old instructions',1,true,true,NOW(),NOW())`;
   await tx.user.updateMany({where:{id:{in:[owner.id,other.id]}},data:{selectedPromptId:sharedId,useMasterPrompt:true}});
   const profile=await tx.profile.create({data:{firstName:'QA',lastName:'Profile',promptVersionId:sharedId}});
   const sql=fs.readFileSync('prisma/migrations/20261012160000_private_prompt_workflows/migration.sql','utf8').replace(/--[^\n]*/g,'').replace(/\b(?:BEGIN|COMMIT);/g,'');
   for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await tx.$executeRawUnsafe(statement);
   const a=await tx.user.findUnique({where:{id:owner.id}});const b=await tx.user.findUnique({where:{id:other.id}});
   assert.notEqual(a.selectedPromptId,b.selectedPromptId);assert.equal(a.useMasterPrompt,false);
   for(const user of [a,b]){
    const prompt=await tx.promptVersion.findUnique({where:{id:user.selectedPromptId}});assert.equal(prompt.ownerId,user.id);assert.equal(prompt.content,'Preserve these old instructions');
    const pref=await tx.profileGenerationPreference.findUnique({where:{userId_profileId:{userId:user.id,profileId:profile.id}}});
    assert.equal((await tx.promptVersion.findUnique({where:{id:pref.resumePromptId}})).ownerId,user.id);
   }
   const legacy=await tx.promptVersion.findUnique({where:{id:sharedId}});assert.ok(legacy.archivedAt);assert.equal(legacy.content,'Preserve these old instructions');
   console.log('PASS migration preserves defaults and profile prompts as independent owned copies; shared history retained');
   throw rollback;
  },{timeout:120000});}catch(error){if(error!==rollback)throw error;}
  console.log('Migration QA rolled back successfully');
 }finally{await db.$disconnect();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
