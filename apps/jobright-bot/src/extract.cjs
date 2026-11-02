const { jobrightOriginalUrl, jobrightPostedAt } = require('@anchorproposal/shared');
const text = (value, max = 30000) => typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, max) : '';
function originalFrom(record) {
  if (!record || typeof record !== 'object') return null;
  for (const key of ['originalUrl', 'originalApplyUrl', 'originalApplyLink', 'originalJobUrl', 'originJobUrl', 'applyUrl', 'applyLink', 'jobApplyLink', 'jobApplyUrl', 'jobUrl', 'jobLink', 'job_url', 'job_link', 'apply_link', 'apply_url', 'externalUrl', 'externalJobUrl', 'url']) {
    const valid = jobrightOriginalUrl(record[key]); if (valid) return valid;
  }
  return null;
}
function candidate(row, company = {}) {
  if (!row || typeof row !== 'object') return null;
  if (!company || typeof company !== 'object') company = {};
  const externalId = String(row.jobId || row.identifier?.value || '');
  if (!/^[\w-]{1,100}$/.test(externalId) || !(row.jobTitle || row['@type'] === 'JobPosting')) return null;
  const items = value => Array.isArray(value) ? value.map(item => typeof item === 'string' ? item : item?.description || item?.content || '').filter(Boolean).join('\n') : '';
  const description = [row.jobDescription || row.description || row.jobSummary, items(row.coreResponsibilities), items(row.requirements), items(row.qualifications)].map(value => text(value)).filter(Boolean).join('\n\n').slice(0, 30000);
  const work = text(row.workModel || row.workArrangement || row.jobLocationType).toLowerCase();
  const arrangement = /hybrid/.test(work) ? 'HYBRID' : /onsite|on-site|office/.test(work) ? 'ONSITE' : /remote|telecommute/.test(work) || row.isRemote === true ? 'REMOTE' : 'UNKNOWN';
  const address = row.jobLocation?.address;
  return { externalId, sourceUrl: 'https://jobright.ai/jobs/info/' + externalId,
    originalUrl: originalFrom(row) || '', title: text(row.jobTitle || row.title, 250),
    company: text(company.companyName || company.name || row.companyName || row.hiringOrganization?.name, 250),
    location: text(typeof row.jobLocation === 'string' ? row.jobLocation : address ? [address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(', ') : row.location || (Array.isArray(row.jobLocations) ? row.jobLocations.join('; ') : ''), 1000),
    description, publishedAt: jobrightPostedAt(row.publishTime ?? row.publishedAt ?? row.datePosted) || '',
    workArrangement: arrangement, country: text(row.countryCode || address?.addressCountry, 10),
    salary: text(row.salaryDesc || row.salary, 250), employmentType: text(row.employmentType, 100) };
}
function mergeCandidates(target, rows) {
  for (const row of rows) {
    const previous = target.get(row.externalId); if (!previous) { target.set(row.externalId, row); continue; }
    const combined = { ...previous };
    for (const [key, value] of Object.entries(row)) if (value && value !== 'UNKNOWN') combined[key] = value;
    combined.description = row.description.length > previous.description.length ? row.description : previous.description;
    target.set(row.externalId, combined);
  }
  return target;
}
function fromPayload(payload) {
  const rows = new Map(); let visited = 0;
  function walk(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 12 || ++visited > 12000) return;
    if (Array.isArray(value)) { for (const item of value.slice(0, 500)) walk(item, depth + 1); return; }
    const row = value.jobResult ? candidate(value.jobResult, value.companyResult) : candidate(value);
    if (row) mergeCandidates(rows, [row]);
    for (const [key, child] of Object.entries(value)) if (!['companyResult', 'user', 'profile', 'userProfile', 'resume', 'jobResult'].includes(key)) walk(child, depth + 1);
  }
  walk(payload); return [...rows.values()];
}
function fromHtml(html) {
  const rows = new Map();
  const scripts = [...html.matchAll(/<script\b[^>]*(?:id=["']__NEXT_DATA__["']|type=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi)];
  let authenticated = false;
  for (const script of scripts) try {
    const data = JSON.parse(script[1]); if (data?.props?.pageProps?.logined === true) authenticated = true;
    mergeCandidates(rows, fromPayload(data));
  } catch { /* Unrelated malformed scripts are ignored. */ }
  return { jobs: [...rows.values()], authenticated };
}
module.exports = { fromHtml, fromPayload, candidate, originalFrom, mergeCandidates };
