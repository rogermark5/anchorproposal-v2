const {test}=require('node:test'),assert=require('node:assert/strict');
const modules=Promise.all([import('../src/queue.mjs'),import('../src/session.mjs')]);
function store(){const data={};return{get:async key=>({[key]:structuredClone(data[key])}),set:async value=>Object.assign(data,structuredClone(value))};}
const user={id:'owner',role:'BIDDER',canGenerateResumes:true},item={applicationId:'app',title:'Engineer'};
test('submitted generation cancellation reaches the API and survives later polling',async()=>{
 const [{GenerationQueue}]=await modules;const calls=[];let status='QUEUED';const session={ensure:async()=>({user}),request:async(route,method)=>{calls.push([route,method]);if(route.endsWith('/cancel'))status='CANCELLED';return{id:'generation',status};}};
 const queue=new GenerationQueue(store(),session),[task]=await queue.enqueue([item]);await queue.dispatch();await queue.edit(task.id,'cancel');await queue.tick();
 assert.equal((await queue.load(user.id))[0].stage,'cancelled');assert.ok(calls.some(([route,method])=>route==='/generations/generation/cancel'&&method==='POST'));
});
test('cancel during an in-flight submit cancels the returned server generation',async()=>{
 const [{GenerationQueue}]=await modules;let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve),calls=[];
 const session={ensure:async()=>({user}),request:async(route,method)=>{calls.push(route);if(route.includes('/applications/')){entered();await gate;return{id:'generation',status:'QUEUED'};}return{id:'generation',status:'CANCELLED'};}};
 const queue=new GenerationQueue(store(),session),[task]=await queue.enqueue([item]),dispatch=queue.dispatch();await started;await queue.edit(task.id,'cancel');release();await dispatch;
 assert.equal((await queue.load(user.id))[0].stage,'cancelled');assert.ok(calls.includes('/generations/generation/cancel'));
});
test('a late old-token 401 reuses the refreshed session instead of rotating twice',async()=>{
 const [,{Session}]=await modules;const make=initial=>{const data=structuredClone(initial);return{get:async keys=>Object.fromEntries([keys].flat().map(key=>[key,data[key]])),set:async value=>Object.assign(data,value),remove:async()=>{}};};
 let release,entered,refreshes=0;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
 const session=new Session(make({refreshToken:'refresh',accountId:user.id}),make({auth:{user,accessToken:'old'}}),async(url,init)=>{
  if(url.endsWith('/auth/refresh')){refreshes++;return json({accessToken:'new',refreshToken:'rotated'});}
  if(url.endsWith('/auth/me'))return json(user);
  if(init.headers.Authorization==='Bearer old'){if(url.endsWith('/profiles')){entered();await gate;}return json({},401);}return json([]);
 });
 const late=session.request('/profiles');await started;await session.request('/templates');release();await late;assert.equal(refreshes,1);
});
