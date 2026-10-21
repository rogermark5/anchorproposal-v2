import { Session } from './session.mjs';
import { GenerationQueue, terminal } from './queue.mjs';
import { API_SERVER, WEBSITE, preferences, trustedSender, externalUrl, documentDownloadUrl } from './security.mjs';
import { captureDescriptor, capturePage } from './capture-access.mjs';
import { TabDrafts, tabFromSender } from './tab-drafts.mjs';
import { AutoDownloads, safeDownloadName } from './auto-downloads.mjs';
const local=chrome.storage.local, temporary=chrome.storage.session;
const session=new Session(local,temporary);
const broadcast=()=>chrome.runtime.sendMessage({event:'changed'}).catch(()=>{});
const drafts=new TabDrafts(temporary);
const documents=new AutoDownloads(local,session,chrome.downloads,broadcast);
const queue=new GenerationQueue(local,session,async(userId,tasks)=>{
  const auth=await session.current();if(auth?.user.id===userId){const count=tasks.filter(t=>!terminal(t)).length;await chrome.action.setBadgeText({text:count?String(Math.min(99,count)):''});await broadcast();}
},async(user,task,prefs)=>{
  if((await session.current())?.user.id===user.id&&prefs.notifications && await chrome.permissions.contains({permissions:['notifications']}))await chrome.notifications.create('generation-'+task.id,{type:'basic',iconUrl:'assets/icon.png',title:'Your documents are ready',message:task.title||'Open AnchorProposal to view your documents.'});
});
let ticking;
const tick=()=>ticking||=((async()=>{const {user}=await session.ensure();const tasks=await queue.tick();void documents.process(tasks,undefined,user.id).catch(()=>{});return tasks;})().catch(()=>{}).finally(()=>{ticking=null;}));
const tabOptions=new Map();
function configureTab(tabId){
  if(!Number.isInteger(tabId))return Promise.resolve();
  if(tabOptions.has(tabId))return tabOptions.get(tabId);
  const path='index.html?sidepanel=1&tabId='+tabId;
  const pending=(async()=>{const current=await chrome.sidePanel.getOptions({tabId});if(current.path!==path||current.enabled===false)await chrome.sidePanel.setOptions({tabId,path,enabled:true});})().catch(()=>{tabOptions.delete(tabId);});
  tabOptions.set(tabId,pending);return pending;
}
async function initialize(){if(local.setAccessLevel)await local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});if(temporary.setAccessLevel)await temporary.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});if(!await chrome.alarms.get('generation-queue'))await chrome.alarms.create('generation-queue',{periodInMinutes:.5});await chrome.action.setBadgeBackgroundColor({color:'#0d7377'});await Promise.allSettled((await chrome.tabs.query({})).filter(tab=>Number.isInteger(tab.id)).map(tab=>configureTab(tab.id)));}
const ready=initialize();
chrome.tabs.onCreated.addListener(tab=>{if(Number.isInteger(tab.id))void configureTab(tab.id);});
chrome.tabs.onUpdated.addListener((tabId,change)=>{if(change.status==='complete')void configureTab(tabId);});
chrome.tabs.onActivated.addListener(({tabId})=>void configureTab(tabId));
chrome.tabs.onRemoved.addListener(tabId=>{tabOptions.delete(tabId);void drafts.removeTab(tabId);});
chrome.downloads.onChanged.addListener(delta=>{if(delta.state||delta.error)void tick();});
chrome.runtime.onInstalled.addListener(()=>void ready.then(tick));
chrome.runtime.onStartup.addListener(()=>void ready.then(tick));
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='generation-queue')void ready.then(tick);});
chrome.action.onClicked.addListener(tab=>{
  // Call open in the user gesture, before awaiting storage or network work.
  void configureTab(tab.id);
  void chrome.sidePanel.open({tabId:tab.id}).catch(()=>{});
  if(tab.id && /^https?:/.test(tab.url||''))void temporary.set({sourceTabId:tab.id});
});
chrome.notifications?.onClicked?.addListener(()=>void chrome.tabs.create({url:chrome.runtime.getURL('index.html#/queue')}));
async function context(sender){let tabId=tabFromSender(sender);if(!Number.isInteger(tabId)){const [active]=await chrome.tabs.query({active:true,lastFocusedWindow:true});tabId=active?.id;}if(!Number.isInteger(tabId)||tabId<0)throw Error('Open the extension from a browser tab.');return {tabId,contextId:'tab:'+tabId};}
async function captureTab(sender,focused){
  if(focused)return chrome.tabs.get((await context(sender)).tabId);
  let [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});
  if(!tab||!/^https?:/.test(tab.url||'')){const {sourceTabId}=await temporary.get('sourceTabId');if(Number.isInteger(sourceTabId))tab=await chrome.tabs.get(sourceTabId).catch(()=>null);}
  return tab;
}
const focusFlights=new Map();
async function focusedSubmit(user,sender,message){
  const bound=await context(sender),key=user.id+':'+bound.contextId;
  if(message.accountId!==user.id)throw Error('The account changed. Open the panel again.');
  if(focusFlights.has(key))return focusFlights.get(key);
  const pending=(async()=>{
    const draft=await drafts.get(user.id,bound.contextId),prefs=await queue.prefs(user.id);
    if(prefs.parallel<2){prefs.parallel=3;await local.set({['prefs:'+user.id]:prefs});}
    let app;
    if(draft.applicationId)app=await session.request('/applications/'+draft.applicationId,'GET',undefined,user.id);
    else{
      const form=draft.form;
      if(!form.profileId||!form.jobTitle.trim()||!form.company.trim()||!form.jobDescription.trim()||(!form.noJobLink&&!form.jobUrl.trim()))throw Error('Complete the profile, title, company, job description and link.');
      const body={...form,jobUrl:form.noJobLink?undefined:form.jobUrl};
      const checked=await session.request('/applications/validate','POST',body,user.id);
      if(!checked.allowed||(checked.warnings?.length&&!message.reviewed))throw Error('Review and resolve the job-description warnings before generating.');
      app=await session.request('/applications','POST',body,user.id);
      draft.applicationId=app.id;await drafts.set(user.id,bound.contextId,draft);
    }
    const profile=app.profile||await session.request('/profiles/'+(app.profileId||draft.form.profileId),'GET',undefined,user.id);
    const tasks=await queue.enqueue([{applicationId:app.id,templateId:draft.form.templateId||undefined,title:app.jobTitle,company:app.company,profileName:[profile.firstName,profile.lastName].filter(Boolean).join(' '),contextId:bound.contextId,autoDownload:draft.autoDownload&&user.canDownloadDocuments!==false,downloadFormat:prefs.downloadFormat}]);
    draft.activeTaskId=tasks.find(task=>task.applicationId===app.id&&!terminal(task))?.id||tasks.findLast(task=>task.applicationId===app.id)?.id||null;
    await drafts.set(user.id,bound.contextId,draft);void queue.dispatch().then(()=>tick()).catch(()=>{});
    return {draft,tasks};
  })().finally(async()=>{focusFlights.delete(key);if((await session.current())?.user.id!==user.id)await drafts.removeUser(user.id);else if(!(await chrome.tabs.get(bound.tabId).catch(()=>null)))await drafts.removeTab(bound.tabId);});focusFlights.set(key,pending);return pending;
}
async function handle(message,sender){
  await ready;
  if(message.action==='login'){const user=await session.login(message.email,message.password);await broadcast();void tick();return {user};}
  if(message.action==='logout'){const auth=await session.current();await session.logout();if(auth)await drafts.removeUser(auth.user.id);await chrome.action.setBadgeText({text:''});await broadcast();return {};}
  if(message.action==='bootstrap'){
    let user=null;try{user=(await session.ensure()).user;}catch(error){if(![401,403].includes(error.status))throw error;}
    if(user){const saved=(await local.get('prefs:'+user.id))['prefs:'+user.id];if(saved?.workflowVersion!==2)await local.set({['prefs:'+user.id]:{...preferences(saved),parallel:3}});}
    return {user,server:API_SERVER,version:chrome.runtime.getManifest().version,preferences:user?await queue.prefs(user.id):preferences()};
  }
  if(message.action==='workspace'){await chrome.tabs.create({url:chrome.runtime.getURL('index.html?workspace=1'+(typeof message.path==='string'&&/^\/[\w/-]+$/.test(message.path)?'#'+message.path:''))});return {};}
  if(message.action==='external'){await chrome.tabs.create({url:externalUrl(message.url)});return {};}
  const {user}=await session.ensure();
  if(message.action==='panel-context')return context(sender);
  if(message.action==='draft'){const current=await context(sender);if(message.accountId!==user.id)throw Error('The account changed.');return message.value?drafts.set(user.id,current.contextId,message.value):drafts.get(user.id,current.contextId);}
  if(message.action==='focused-submit')return focusedSubmit(user,sender,message);
  if(message.action==='save-document-edits'){
    const bound=await context(sender),task=(await queue.load(user.id)).find(item=>item.id===message.taskId);
    if(message.accountId!==user.id||!task||(task.contextId&&task.contextId!==bound.contextId))throw Error('Open this application in its original tab and account.');
    const receipts=await documents.state(user.id,message.generationId);
    const folder=task.downloadFolder||receipts.find(item=>item.folder)?.folder;
    const result=await queue.saveDocumentEdits(user.id,task.id,message.generationId,message.edits,folder);
    void tick();return result;
  }
  if(message.action==='document-downloads'){if(typeof message.generationId!=='string'||!/^[\w-]{1,100}$/.test(message.generationId))throw Error('Choose a generation.');return documents.state(user.id,message.generationId);}
  if(message.action==='retry-document-downloads'){const tasks=await queue.load(user.id);if(!tasks.some(task=>task.generationId===message.generationId))throw Error('Generation not in your queue.');await documents.process(tasks,message.generationId,user.id);return documents.state(user.id,message.generationId);}
  if(message.action==='preferences'){
    if(message.value){const value=preferences(message.value);await local.set({['prefs:'+user.id]:value});await broadcast();void tick();return value;}
    return queue.prefs(user.id);
  }
  if(message.action==='request'){
    const method=message.method||'GET';let body=message.body;
    const generation=method==='POST'&&/^\/applications\/[\w-]+\/generations$/.test(message.route);
    if(generation)return queue.submitNow(message.route.split('/')[2],body?.templateId||(await queue.prefs(user.id)).templateId||undefined);
    const result=await session.request(message.route,method,body,user.id);
    if(method!=='GET'&&message.route!=='/applications/validate')await broadcast();
    return result;
  }
  if(message.action==='queue'){return queue.load(user.id);}
  if(message.action==='enqueue'){let items=message.items;if(message.focused){const bound=await context(sender),prefs=await queue.prefs(user.id);if(!Array.isArray(items))throw Error('Choose applications.');items=items.map(item=>({...item,contextId:bound.contextId,autoDownload:prefs.autoDownload&&item.autoDownload!==false,downloadFormat:prefs.downloadFormat}));}const tasks=await queue.enqueue(items);void queue.dispatch().then(()=>tick()).catch(()=>{});return tasks;}
  if(message.action==='queue-edit'){const tasks=await queue.edit(message.id,message.operation);void tick();return tasks;}
  if(message.action==='queue-tick'){await tick();return queue.load(user.id);}
  if(message.action==='capture-target')return captureDescriptor(await captureTab(sender,message.focused),chrome.permissions);
  if(message.action==='capture'){
    return capturePage(chrome,await captureTab(sender,message.focused),message);
  }
  if(message.action==='download'){
    if(!/^[\w-]{1,100}$/.test(message.id))throw Error('Choose a generated file.');
    await session.request('/auth/me','GET',undefined,user.id);
    const auth=await session.ensure();if(auth.user.id!==user.id)throw Error('The account changed.');if(auth.user.canDownloadDocuments===false)throw Error('Document downloads are disabled for this account.');
    // Download permission is also enforced by the server. No tokens are put in
    // URLs, messages to the renderer, job pages, filenames or download history.
    const filename=safeDownloadName(message.filename);
    const id=await chrome.downloads.download({url:documentDownloadUrl(message.id),headers:[{name:'Authorization',value:'Bearer '+auth.accessToken}],filename:'AnchorProposal/'+filename,saveAs:true,conflictAction:'uniquify'});
    return {downloadId:id};
  }
  throw Error('Unsupported extension action.');
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!message?.action)return false;
  if(!trustedSender(sender,chrome.runtime)){respond({ok:false,error:'Only AnchorProposal extension pages can make this request.'});return false;}
  handle(message,sender).then(value=>respond({ok:true,value})).catch(error=>respond({ok:false,error:error.message||'The request failed.',status:error.status||0}));
  return true;
});
