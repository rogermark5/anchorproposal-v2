require('reflect-metadata');const {ConfigModule}=require('@nestjs/config');const {PrismaClient}=require('@prisma/client');
const {appendJsonRules}=require('../dist/deepseek/json-rules');
(async()=>{await ConfigModule.forRoot();const db=new PrismaClient();try{await db.$transaction(async tx=>{
 const prompts=await tx.promptVersion.findMany({where:{ownerId:{not:null},archivedAt:null}});let updated=0;
 for(const prompt of prompts){const content=appendJsonRules(prompt.content,prompt.documentKind,prompt.experienceTitleMode);if(content!==prompt.content){await tx.promptVersion.update({where:{id:prompt.id},data:{content}});updated++;}}
 console.log('Required JSON rules added to '+updated+' existing private prompts.');
 },{timeout:120000});}finally{await db.$disconnect();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
