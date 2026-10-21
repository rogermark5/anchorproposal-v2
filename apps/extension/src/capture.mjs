// Runs in an isolated content-script world only after the user chooses Capture.
// It reads visible text/JobPosting data, never inputs, cookies or credentials.
export function readJobFromPage() {
  const strip = value => String(value||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').trim();
  let posting=null;let visited=0;
  const visit=value=>{if(++visited>1000||!value||typeof value!=='object')return;if(Array.isArray(value)){value.slice(0,100).forEach(visit);return;}if([value['@type']].flat().includes('JobPosting')){posting||=value;return;}if(value['@graph'])visit(value['@graph']);};
  for(const element of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0,25)){if(element.textContent.length>1000000)continue;try{visit(JSON.parse(element.textContent));}catch{}}
  const selection=window.getSelection()?.toString().trim();
  const main=document.querySelector('[data-testid="job-description"], .job-description, #job-description, [itemprop="description"], main, article');
  const locations=[posting?.jobLocation].flat().filter(Boolean).map(item=>{const a=item.address||{};return [a.addressLocality,a.addressRegion,typeof a.addressCountry==='string'?a.addressCountry:a.addressCountry?.name].filter(Boolean).join(', ');}).filter(Boolean).join(' / ');
  return {jobTitle:strip(posting?.title||document.querySelector('h1')?.textContent||document.title).slice(0,250),company:strip(posting?.hiringOrganization?.name||'').slice(0,250),location:locations.slice(0,1000),jobUrl:location.href,jobDescription:(selection||strip(posting?.description)||main?.innerText||'').slice(0,100000),workArrangement:String(posting?.jobLocationType||'').toUpperCase()==='TELECOMMUTE'?'REMOTE':'UNKNOWN',capturedAt:new Date().toISOString(),siteTitle:document.title.slice(0,250)};
}
