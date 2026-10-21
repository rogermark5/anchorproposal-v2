// Titles establish the occupation; a software company's description alone is
// never evidence that its sales, recruiting or operations jobs are software jobs.
// Historical classification is updated by additive migrations; never rewrite
// the checksum of an already-applied migration.
export const SOFTWARE_TITLE = String.raw`\b(software|developer|programmer|full[ -]?stack|front[ -]?end|back[ -]?end|devops|devsecops|sre|site reliability|platform engineer|cloud engineer|data engineer|data scientist|machine learning|ml engineer|ai engineer|artificial intelligence|mobile engineer|ios engineer|android engineer|web engineer|application engineer|applications engineer|qa engineer|quality assurance engineer|test automation|automation test|sdet|security engineer|cybersecurity engineer|database engineer|database administrator|technical architect|solutions architect|software architect|engineering manager|engineering director|director of engineering|vp of engineering|head of engineering|cto)\b`;
export const EXCLUDED_TITLE = String.raw`\b(sales|account executive|recruiter|recruiting|talent acquisition|marketing|customer success|business development|civil|mechanical|electrical|manufacturing|hardware|construction|field service|field engineer|controls engineer|industrial|chemical|aerospace|biomedical|clinical)\b`;
export const SOFTWARE_SPECIALTIES = String.raw`\b(swe|sw engineer|cloud architect|cloud infrastructure engineer|cloud platform engineer|cloud security engineer|security operations engineer|information security engineer|infosec engineer|data architect|database architect|ai architect|ml architect|ai\/ml engineer|ai\/ml architect|solution architect|enterprise architect|integration architect|servicenow engineer|salesforce engineer|salesforce administrator|business intelligence (engineer|developer|architect)|automation tester|qa automation|test engineer,? software|software test|release engineer|build engineer|developer experience engineer|developer productivity engineer|ui engineer|ux engineer|api engineer|web application|linux systems engineer|kubernetes engineer)\b`;
export const SOFTWARE_CANDIDATE = String.raw`\b(product engineer|forward[ -]deployed engineer|founding engineer|infrastructure engineer|distributed systems engineer|production engineer|systems? engineer|quality engineer|staff engineer|principal engineer|senior engineer)\b`;
export const SOFTWARE_EVIDENCE = String.raw`\b(build|building|develop|developing|design|designing|implement|implementing|write|writing|maintain|maintaining)\b[^.!?\n]{0,90}\b(software|microservices|backend|frontend|apis|code|data pipelines|web applications|distributed systems)\b`;
const software = new RegExp(`${SOFTWARE_TITLE}|${SOFTWARE_SPECIALTIES}`, 'i'), excluded = new RegExp(`${EXCLUDED_TITLE}|\\bpre[ -]?sales\\b`, 'i');
const candidate = new RegExp(SOFTWARE_CANDIDATE, 'i'), evidence = new RegExp(SOFTWARE_EVIDENCE, 'i');
export const DEFAULT_EXCLUDED_TITLE_KEYWORDS = ['staff', 'principal', 'architect', 'junior', 'lead', 'director'];
export function normalizeTitleKeywords(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Enter up to 100 excluded title keywords.');
  const keywords = value.map(term => {
    if (typeof term !== 'string') throw new Error('Each title keyword must be text.');
    const keyword = term.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!keyword || keyword.length > 80 || !/^[\p{L}\p{N}][\p{L}\p{N} +#./-]*$/u.test(keyword)) throw new Error('Use title words or phrases of 1–80 characters, without wildcards.');
    return keyword;
  });
  return [...new Set(keywords)];
}
export function isBlockedPoolTitle(title: string, keywords = DEFAULT_EXCLUDED_TITLE_KEYWORDS): boolean {
  const normalized = title.toLowerCase();
  return keywords.some(keyword => normalized.includes(keyword));
}
// Provider parsing checks the occupation only. The importer applies the saved
// Master keywords so removing a keyword also works for provider detail requests.
export function mayBeSoftwareOccupation(title: string): boolean { return !excluded.test(title) && (software.test(title) || candidate.test(title)); }
export function isSoftwareOccupation(title: string, description = ''): boolean {
  return !excluded.test(title) && (software.test(title) || (candidate.test(title) && evidence.test(description)));
}
export function mayBeSoftwareJob(title: string, keywords = DEFAULT_EXCLUDED_TITLE_KEYWORDS): boolean { return !isBlockedPoolTitle(title, keywords) && mayBeSoftwareOccupation(title); }
export function isSoftwareJob(title: string, description = '', keywords = DEFAULT_EXCLUDED_TITLE_KEYWORDS): boolean {
  return !isBlockedPoolTitle(title, keywords) && isSoftwareOccupation(title, description);
}
