const{test}=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../src/capture-access.mjs');
const tab={id:12,url:'https://jobs.example.com/roles/software',status:'complete'};
const target={tabId:tab.id,url:tab.url,origin:'https://jobs.example.com',pattern:'https://jobs.example.com/*',hasPermission:false,loading:false};

test('capture asks only for the current HTTP(S) site and rejects browser/store pages',async()=>{
  const{captureSite}=await modulePromise;assert.deepEqual(captureSite('https://jobs.example.com:8443/role?x=1'),{origin:'https://jobs.example.com:8443',pattern:'https://jobs.example.com:8443/*'});
  for(const value of['chrome://newtab/','chrome-extension://ours/index.html','file:///secret','javascript:alert(1)','https://user:secret@jobs.example.com/','https://chromewebstore.google.com/detail/foo','https://chrome.google.com/webstore/detail/foo',null])assert.throws(()=>captureSite(value));
});
test('a newly opened tab prepares a site permission even without a toolbar activeTab grant',async()=>{
  const{captureDescriptor}=await modulePromise,calls=[];
  const prepared=await captureDescriptor(tab,{contains:async value=>{calls.push(value);return false;}});
  assert.deepEqual(prepared,target);assert.deepEqual(calls,[{origins:['https://jobs.example.com/*']}]);
});
test('the native permission request starts synchronously in the Capture click, and the same click captures after approval',async()=>{
  const{captureWithAccess}=await modulePromise,calls=[];let approve;
  const permissions={request:value=>{calls.push({request:value});return new Promise(resolve=>{approve=resolve;});}};
  const pending=captureWithAccess(target,permissions,async value=>{calls.push({capture:value});return{jobTitle:'Engineer'};});
  assert.deepEqual(calls,[{request:{origins:['https://jobs.example.com/*']}}]);approve(true);
  assert.equal((await pending).jobTitle,'Engineer');assert.deepEqual(calls[1],{capture:{expectedTabId:12,expectedOrigin:target.origin,expectedUrl:target.url}});
});
test('declining site access leaves content untouched and the next Capture click can request it again',async()=>{
  const{captureWithAccess}=await modulePromise;let requests=0,captures=0;
  const permissions={request:async()=>++requests>1},capture=async()=>{captures++;return{jobTitle:'Captured'};};
  await assert.rejects(captureWithAccess(target,permissions,capture),/Site access was not allowed/);assert.equal(captures,0);
  assert.equal((await captureWithAccess(target,permissions,capture)).jobTitle,'Captured');assert.equal(requests,2);assert.equal(captures,1);
});
test('a second tab on an approved site captures immediately without another permission prompt',async()=>{
  const{captureWithAccess}=await modulePromise;let requests=0;
  const value=await captureWithAccess({...target,tabId:99,hasPermission:true},{request:()=>{requests++;}},async expected=>expected);
  assert.equal(requests,0);assert.equal(value.expectedTabId,99);
});
test('loading and unsupported pages never request access or read content',async()=>{
  const{captureWithAccess}=await modulePromise;let calls=0;const permissions={request:()=>{calls++;}},capture=()=>{calls++;};
  await assert.rejects(captureWithAccess({...target,loading:true},permissions,capture),/finish loading/);
  await assert.rejects(captureWithAccess({...target,error:'Restricted page'},permissions,capture),/Restricted page/);assert.equal(calls,0);
});
test('capture uses the panel-bound tab and refuses a stale page before executing a script',async()=>{
  const{capturePage}=await modulePromise;let executed=0;
  const browser={scripting:{executeScript:async value=>{executed++;assert.equal(value.target.tabId,12);return[{result:{jobUrl:tab.url,jobTitle:'Current'}}];}},tabs:{get:async()=>tab}};
  for(const expected of[{expectedTabId:13},{expectedOrigin:'https://other.test'},{expectedUrl:'https://jobs.example.com/old'}])await assert.rejects(capturePage(browser,tab,expected),/page changed/);
  assert.equal(executed,0);assert.equal((await capturePage(browser,tab,{expectedTabId:12,expectedOrigin:target.origin,expectedUrl:tab.url})).jobTitle,'Current');
});
test('navigating during capture discards the result rather than overwriting application fields',async()=>{
  const{capturePage}=await modulePromise;
  const browser={scripting:{executeScript:async()=>[{result:{jobUrl:tab.url,jobTitle:'Old job'}}]},tabs:{get:async()=>({...tab,url:'https://jobs.example.com/new-job'})}};
  await assert.rejects(capturePage(browser,tab),/page changed/);
});
