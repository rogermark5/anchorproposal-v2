require('reflect-metadata');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {Module}=require('@nestjs/common'),{NestFactory}=require('@nestjs/core'),{JwtService}=require('@nestjs/jwt');
const {Strategy,ExtractJwt}=require('passport-jwt'),passport=require('passport');
const {SettingsController}=require('../dist/settings/settings.controller');
const {SettingsService}=require('../dist/settings/settings.service');
const {configureJsonBody}=require('../dist/common/json-body');

test('the authenticated settings API accepts long instructions, round-trips full JSON and enforces ownership and bounds',async t=>{
 const values=new Map(),secret='long-answer-prompt-test-secret',jwt=new JwtService({secret});
 const service=new SettingsService({systemSetting:{findUnique:async({where})=>values.has(where.key)?{value:values.get(where.key)}:null,upsert:async args=>{values.set(args.where.key,args.update.value||args.create.value);return{};}}});
 passport.use('jwt',new Strategy({jwtFromRequest:ExtractJwt.fromAuthHeaderAsBearerToken(),secretOrKey:secret},(data,done)=>done(null,{id:data.sub,role:'ADMIN'})));
 class TestModule{};Module({controllers:[SettingsController],providers:[{provide:SettingsService,useValue:service}]})(TestModule);
 const app=await NestFactory.create(TestModule,{logger:false});configureJsonBody(app);await app.listen(0,'127.0.0.1');t.after(()=>app.close());
 const base=await app.getUrl(),request=(id,method='GET',body)=>fetch(base+'/settings/answer-prompt',{method,headers:{'Content-Type':'application/json',...(id?{Authorization:'Bearer '+jwt.sign({sub:id})}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
 for(const prompt of ['Answer in my voice.\n'.repeat(1600)+'Final instruction.','文'.repeat(80000),'A'+'\n'.repeat(79998)+'B']){
  const response=await request('owner','PATCH',{prompt,userId:'another-user'});assert.equal(response.status,200);assert.ok((await response.json()).prompt===prompt,'HTTP response must preserve all instructions');
  const loaded=await request('owner');assert.ok((await loaded.json()).prompt===prompt,'GET must return the complete saved prompt');
 }
 assert.deepEqual([...values.keys()],['answer_prompt:owner']);
 assert.equal((await (await request('other')).json()).prompt,SettingsService.DEFAULT_ANSWER_PROMPT);
 const before=values.get('answer_prompt:owner');
 const invalid=await request('owner','PATCH',{prompt:'x'.repeat(80001)});assert.equal(invalid.status,400);assert.match((await invalid.json()).message,/80,000/);
 assert.equal((await request('owner','PATCH',{prompt:{text:'bad'}})).status,400);
 assert.equal((await request('owner','PATCH',{prompt:'x'.repeat(1024*1024+1)})).status,413);
 assert.equal((await request(null,'PATCH',{prompt:'Not authorized'})).status,401);
 assert.ok(values.get('answer_prompt:owner')===before,'Rejected requests must not overwrite the saved instructions');
});
