-- Additional free, independent employer feeds; preserve all existing overrides.
INSERT INTO "job_pool_sources" ("id", "provider", "name", "boardToken", "enabled", "updatedAt")
SELECT incoming.* FROM (VALUES
  ('source-freehire-greenhouse', 'freehire', 'greenhouse via Freehire', 'greenhouse', true, CURRENT_TIMESTAMP),
  ('source-freehire-lever', 'freehire', 'lever via Freehire', 'lever', true, CURRENT_TIMESTAMP),
  ('source-freehire-ashby', 'freehire', 'ashby via Freehire', 'ashby', true, CURRENT_TIMESTAMP),
  ('source-freehire-smartrecruiters', 'freehire', 'smartrecruiters via Freehire', 'smartrecruiters', true, CURRENT_TIMESTAMP),
  ('source-freehire-ashbygraphql', 'freehire', 'ashbygraphql via Freehire', 'ashbygraphql', true, CURRENT_TIMESTAMP),
  ('source-freehire-gusto', 'freehire', 'gusto via Freehire', 'gusto', true, CURRENT_TIMESTAMP),
  ('source-freehire-deel', 'freehire', 'deel via Freehire', 'deel', true, CURRENT_TIMESTAMP),
  ('source-freehire-avature', 'freehire', 'avature via Freehire', 'avature', true, CURRENT_TIMESTAMP),
  ('source-freehire-gr8people', 'freehire', 'gr8people via Freehire', 'gr8people', true, CURRENT_TIMESTAMP),
  ('source-freehire-hireology', 'freehire', 'hireology via Freehire', 'hireology', true, CURRENT_TIMESTAMP),
  ('source-freehire-jobylon', 'freehire', 'jobylon via Freehire', 'jobylon', true, CURRENT_TIMESTAMP),
  ('source-freehire-join', 'freehire', 'join via Freehire', 'join', true, CURRENT_TIMESTAMP),
  ('source-freehire-keka', 'freehire', 'keka via Freehire', 'keka', true, CURRENT_TIMESTAMP),
  ('source-freehire-loxo', 'freehire', 'loxo via Freehire', 'loxo', true, CURRENT_TIMESTAMP),
  ('source-freehire-recruiterflow', 'freehire', 'recruiterflow via Freehire', 'recruiterflow', true, CURRENT_TIMESTAMP),
  ('source-freehire-talentlyft', 'freehire', 'talentlyft via Freehire', 'talentlyft', true, CURRENT_TIMESTAMP),
  ('source-freehire-teamtailor', 'freehire', 'teamtailor via Freehire', 'teamtailor', true, CURRENT_TIMESTAMP),
  ('source-freehire-workstream', 'freehire', 'workstream via Freehire', 'workstream', true, CURRENT_TIMESTAMP),
  ('source-freehire-zohorecruit', 'freehire', 'zohorecruit via Freehire', 'zohorecruit', true, CURRENT_TIMESTAMP),
  ('source-freehire-peopleforce', 'freehire', 'peopleforce via Freehire', 'peopleforce', true, CURRENT_TIMESTAMP),
  ('source-freehire-careerspage', 'freehire', 'careerspage via Freehire', 'careerspage', true, CURRENT_TIMESTAMP),
  ('source-freehire-ismartrecruit', 'freehire', 'ismartrecruit via Freehire', 'ismartrecruit', true, CURRENT_TIMESTAMP),
  ('source-freehire-amazon', 'freehire', 'amazon via Freehire', 'amazon', true, CURRENT_TIMESTAMP),
  ('source-freehire-apple', 'freehire', 'apple via Freehire', 'apple', true, CURRENT_TIMESTAMP),
  ('source-freehire-ibm', 'freehire', 'ibm via Freehire', 'ibm', true, CURRENT_TIMESTAMP),
  ('source-freehire-meta', 'freehire', 'meta via Freehire', 'meta', true, CURRENT_TIMESTAMP),
  ('source-freehire-bairesdev', 'freehire', 'bairesdev via Freehire', 'bairesdev', true, CURRENT_TIMESTAMP),
  ('source-freehire-epam', 'freehire', 'epam via Freehire', 'epam', true, CURRENT_TIMESTAMP),
  ('source-freehire-lumenalta', 'freehire', 'lumenalta via Freehire', 'lumenalta', true, CURRENT_TIMESTAMP),
  ('source-freehire-dassault', 'freehire', 'dassault via Freehire', 'dassault', true, CURRENT_TIMESTAMP),
  ('source-freehire-uber', 'freehire', 'uber via Freehire', 'uber', true, CURRENT_TIMESTAMP)
) AS incoming("id", "provider", "name", "boardToken", "enabled", "updatedAt")
WHERE NOT EXISTS (SELECT 1 FROM "job_pool_sources" existing WHERE lower(existing."provider") = lower(incoming."provider") AND lower(existing."boardToken") = lower(incoming."boardToken"))
ON CONFLICT DO NOTHING;

-- Match the importer classification, retaining hidden flags and all job IDs.
UPDATE "job_pool_jobs" SET "isSoftware" =
  ("title" !~* '\y(sales|account executive|recruiter|recruiting|talent acquisition|marketing|customer success|business development|civil|mechanical|electrical|manufacturing|hardware|construction|field service|field engineer|controls engineer|industrial|chemical|aerospace|biomedical|clinical)\y|\ypre[ -]?sales\y' AND ("title" ~* '\y(software|developer|programmer|full[ -]?stack|front[ -]?end|back[ -]?end|devops|devsecops|sre|site reliability|platform engineer|cloud engineer|data engineer|data scientist|machine learning|ml engineer|ai engineer|artificial intelligence|mobile engineer|ios engineer|android engineer|web engineer|application engineer|applications engineer|qa engineer|quality assurance engineer|test automation|automation test|sdet|security engineer|cybersecurity engineer|database engineer|database administrator|technical architect|solutions architect|software architect|engineering manager|engineering director|director of engineering|vp of engineering|head of engineering|cto)\y|\y(swe|sw engineer|cloud architect|cloud infrastructure engineer|cloud platform engineer|cloud security engineer|security operations engineer|information security engineer|infosec engineer|data architect|database architect|ai architect|ml architect|ai\/ml engineer|ai\/ml architect|solution architect|enterprise architect|integration architect|servicenow engineer|salesforce engineer|salesforce administrator|business intelligence (engineer|developer|architect)|automation tester|qa automation|test engineer,? software|software test|release engineer|build engineer|developer experience engineer|developer productivity engineer|ui engineer|ux engineer|api engineer|web application|linux systems engineer|kubernetes engineer)\y' OR
  ("title" ~* '\y(product engineer|forward[ -]deployed engineer|founding engineer|infrastructure engineer|distributed systems engineer|production engineer|systems? engineer|quality engineer|staff engineer|principal engineer|senior engineer)\y' AND "description" ~* '\y(build|building|develop|developing|design|designing|implement|implementing|write|writing|maintain|maintaining)\y[^.!?\n]{0,90}\y(software|microservices|backend|frontend|apis|code|data pipelines|web applications|distributed systems)\y')));
