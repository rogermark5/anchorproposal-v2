export const API_SERVER = typeof __API_SERVER__ === 'undefined' ? 'https://anchorproposal.giize.com/backend' : __API_SERVER__;
export const WEBSITE = new URL(API_SERVER).origin;
export function documentDownloadUrl(fileId){
  if(typeof fileId!=='string'||!/^[\w-]{1,100}$/.test(fileId))throw Error('Choose a generated file.');
  return API_SERVER+'/documents/'+fileId+'/download';
}
const routes = [
  [/^\/generations\/[\w-]+\/answers\/requests(?:\/[\w-]+)?$/, ['GET','POST']],
  [/^\/settings\/time-zone$/, ['GET','PATCH']],
  [/^\/generations\/[\w-]+\/cancel$/, ['POST']],
  [/^\/application-options(?:\/[\w-]+(?:\/set-default)?)?$/, ['GET','POST','PATCH','DELETE']],
  [/^\/auth\/(me|logout)$/, ['GET','POST']],
  [/^\/auth\/change-password$/, ['PATCH']],
  [/^\/job-pool$/, ['GET','POST']], [/^\/job-pool\/updates$/, ['GET']],
  [/^\/job-pool\/manage$/, ['GET','PATCH']], [/^\/job-pool\/sync$/, ['POST']],
  [/^\/job-pool\/sources$/, ['POST']], [/^\/job-pool\/sources\/[\w-]+$/, ['PATCH']],
  [/^\/job-pool\/jobs\/[\w-]+$/, ['GET','PATCH']],
  [/^\/job-pool\/jobs\/[\w-]+\/apply$/, ['POST']], [/^\/job-pool\/jobs\/[\w-]+\/(applied|viewed)$/, ['PATCH']],
  [/^\/applications(?:\/[\w-]+)?$/, ['GET','POST','PATCH','DELETE']],
  [/^\/applications\/validate$/, ['POST']],
  [/^\/applications\/warnings\/[\w-]+\/acknowledge$/, ['PATCH']],
  [/^\/applications\/[\w-]+\/(status|notes)$/, ['PATCH','POST']],
  [/^\/applications\/[\w-]+\/(generation-prompt|manual-generation-prompt)$/, ['GET']],
  [/^\/applications\/[\w-]+\/generations$/, ['GET','POST']],
  [/^\/applications\/[\w-]+\/generations\/manual$/, ['POST']],
  [/^\/generations\/[\w-]+(?:\/preview)?$/, ['GET']],
  [/^\/generations\/[\w-]+\/(edits|draft-preview|export)$/, ['POST']],
  [/^\/generations\/[\w-]+\/public-link$/, ['POST','DELETE']],
  [/^\/generations\/[\w-]+\/answers$/, ['GET','POST']], [/^\/generations\/[\w-]+\/answers\/prompt$/, ['POST']],
  [/^\/profiles(?:\/[\w-]+)?$/, ['GET','POST','PUT']],
  [/^\/profiles\/[\w-]+\/(archive|set-default)$/, ['PATCH']],
  [/^\/profiles\/[\w-]+\/generation-preference$/, ['GET','PUT']],
  [/^\/templates(?:\/[\w-]+)?$/, ['GET','POST','PUT']],
  [/^\/templates\/[\w-]+\/(preview|clone|publish|archive|set-default)$/, ['GET','POST','PATCH']],
  [/^\/settings\/(generation-workflow|document-display|prompt-mode|prompts|my-prompt)$/, ['GET']],
  [/^\/dashboard\/metrics$/, ['GET']],
];
export function apiRoute(route, method = 'GET') {
  if (typeof route !== 'string' || route.length > 5000 || !/^\/[a-zA-Z0-9/-]+(?:\?[a-zA-Z0-9%=&_,.+-]*)?$/.test(route)) throw Error('Unsupported extension request.');
  if (!routes.some(([pattern,methods])=>pattern.test(route.split('?')[0]) && methods.includes(method))) throw Error('Unsupported extension operation.');
  return route;
}
export function externalUrl(value) {
  if (typeof value !== 'string' || value.length > 5000) throw Error('Invalid link.');
  const url = new URL(value);
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password) throw Error('Open an HTTP or HTTPS link.');
  return url.href;
}
export const defaults = { profileId:'', templateId:'', location:'', source:'', country:'all', days:'all', applied:'not-applied', parallel:3, notifications:false, startPage:'/new', queuePaused:false, autoDownload:true, downloadFormat:'PDF', workflowVersion:2 };
export function preferences(input = {}) {
  const result = { ...defaults };
  for (const key of ['profileId','templateId','location','source']) if (typeof input[key] === 'string') result[key] = input[key].slice(0,key.endsWith('Id')?100:250);
  if (['all','US','GB','IE'].includes(input.country)) result.country=input.country;
  if (['all','1','3','7','14','30'].includes(input.days)) result.days=input.days;
  if (['not-applied','applied','all'].includes(input.applied)) result.applied=input.applied;
  if ([1,2,3].includes(input.parallel)) result.parallel=input.parallel;
  if (['/dashboard','/job-pool','/applications','/new','/queue'].includes(input.startPage)) result.startPage=input.startPage;
  result.notifications=input.notifications===true; result.queuePaused=input.queuePaused===true;
  result.autoDownload=input.autoDownload!==false;
  result.downloadFormat=input.downloadFormat==='DOCX'?'DOCX':'PDF';
  return result;
}
export function trustedSender(sender, runtime) {
  if (sender?.id !== runtime.id || typeof sender.url !== 'string') return false;
  try { const url=new URL(sender.url),base=new URL(runtime.getURL('index.html')); return url.protocol===base.protocol && url.hostname===base.hostname && url.pathname===base.pathname; } catch { return false; }
}
