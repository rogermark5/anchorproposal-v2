import {readJobFromPage} from './capture.mjs';

export function captureSite(value){
  let url;try{url=new URL(value);}catch{throw Error('Open a job website before capturing.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hostname==='chromewebstore.google.com'||(url.hostname==='chrome.google.com'&&url.pathname.startsWith('/webstore')))
    throw Error('Chrome does not allow capture on this page. Open the job website or paste its description.');
  return {origin:url.origin,pattern:url.origin+'/*'};
}

export async function captureDescriptor(tab,permissions){
  if(!Number.isInteger(tab?.id))throw Error('Open a job website before capturing.');
  const site=captureSite(tab.url);
  return {tabId:tab.id,url:tab.url,...site,loading:tab.status==='loading',hasPermission:await permissions.contains({origins:[site.pattern]})};
}

// Call directly from the Capture button. Chrome requires the permission request
// in that click's user gesture, before a worker message or other asynchronous work.
export function captureWithAccess(target,permissions,capture){
  if(!target||target.loading)return Promise.reject(Error('Wait for the job page to finish loading, then capture it.'));
  if(target.error)return Promise.reject(Error(target.error));
  let access;
  try{access=target.hasPermission?Promise.resolve(true):permissions.request({origins:[target.pattern]});}
  catch(error){return Promise.reject(error);}
  return Promise.resolve(access).then(granted=>{
    if(!granted)throw Error('Site access was not allowed. Click Capture to allow this job site, or paste the description.');
    return capture({expectedTabId:target.tabId,expectedOrigin:target.origin,expectedUrl:target.url});
  });
}

export async function capturePage(browser,tab,expected={}){
  const site=captureSite(tab.url),changed='The job page changed. Click Capture again to read the current job.';
  if((expected.expectedTabId!==undefined&&expected.expectedTabId!==tab.id)||(expected.expectedOrigin!==undefined&&expected.expectedOrigin!==site.origin)||(expected.expectedUrl!==undefined&&expected.expectedUrl!==tab.url))throw Error(changed);
  let result;
  try{[result]=await browser.scripting.executeScript({target:{tabId:tab.id},func:readJobFromPage});}
  catch{throw Error('Chrome could not read this page. Allow site access for AnchorProposal, then capture again or paste the description.');}
  const current=await browser.tabs.get(tab.id);
  if(current.url!==tab.url||result?.result?.jobUrl!==tab.url)throw Error(changed);
  return result.result;
}
