-- Independent free employer feeds preserve cooldowns and all existing jobs.
INSERT INTO "job_pool_sources" ("id", "provider", "name", "boardToken", "enabled", "updatedAt")
SELECT incoming.* FROM (VALUES
  ('source-freehire-workday', 'freehire', 'workday via Freehire', 'workday', true, CURRENT_TIMESTAMP),
  ('source-freehire-workable', 'freehire', 'workable via Freehire', 'workable', true, CURRENT_TIMESTAMP),
  ('source-freehire-icims', 'freehire', 'icims via Freehire', 'icims', true, CURRENT_TIMESTAMP),
  ('source-freehire-oracle', 'freehire', 'oracle via Freehire', 'oracle', true, CURRENT_TIMESTAMP),
  ('source-freehire-breezy', 'freehire', 'breezy via Freehire', 'breezy', true, CURRENT_TIMESTAMP),
  ('source-freehire-bamboohr', 'freehire', 'bamboohr via Freehire', 'bamboohr', true, CURRENT_TIMESTAMP),
  ('source-freehire-rippling', 'freehire', 'rippling via Freehire', 'rippling', true, CURRENT_TIMESTAMP),
  ('source-freehire-jazzhr', 'freehire', 'jazzhr via Freehire', 'jazzhr', true, CURRENT_TIMESTAMP),
  ('source-freehire-dayforce', 'freehire', 'dayforce via Freehire', 'dayforce', true, CURRENT_TIMESTAMP),
  ('source-freehire-pinpoint', 'freehire', 'pinpoint via Freehire', 'pinpoint', true, CURRENT_TIMESTAMP),
  ('source-freehire-gem', 'freehire', 'gem via Freehire', 'gem', true, CURRENT_TIMESTAMP),
  ('source-freehire-jobvite', 'freehire', 'jobvite via Freehire', 'jobvite', true, CURRENT_TIMESTAMP),
  ('source-freehire-adp', 'freehire', 'adp via Freehire', 'adp', true, CURRENT_TIMESTAMP),
  ('source-freehire-adpmyjobs', 'freehire', 'adpmyjobs via Freehire', 'adpmyjobs', true, CURRENT_TIMESTAMP),
  ('source-freehire-ukg', 'freehire', 'ukg via Freehire', 'ukg', true, CURRENT_TIMESTAMP),
  ('source-freehire-ukgready', 'freehire', 'ukgready via Freehire', 'ukgready', true, CURRENT_TIMESTAMP),
  ('source-freehire-paycom', 'freehire', 'paycom via Freehire', 'paycom', true, CURRENT_TIMESTAMP),
  ('source-freehire-paycor', 'freehire', 'paycor via Freehire', 'paycor', true, CURRENT_TIMESTAMP),
  ('source-freehire-paylocity', 'freehire', 'paylocity via Freehire', 'paylocity', true, CURRENT_TIMESTAMP),
  ('source-freehire-successfactors', 'freehire', 'successfactors via Freehire', 'successfactors', true, CURRENT_TIMESTAMP),
  ('source-freehire-taleo', 'freehire', 'taleo via Freehire', 'taleo', true, CURRENT_TIMESTAMP),
  ('source-freehire-hrmdirect', 'freehire', 'hrmdirect via Freehire', 'hrmdirect', true, CURRENT_TIMESTAMP),
  ('source-freehire-phenom', 'freehire', 'phenom via Freehire', 'phenom', true, CURRENT_TIMESTAMP),
  ('source-freehire-radancy', 'freehire', 'radancy via Freehire', 'radancy', true, CURRENT_TIMESTAMP),
  ('source-freehire-jibe', 'freehire', 'jibe via Freehire', 'jibe', true, CURRENT_TIMESTAMP),
  ('source-freehire-eightfold', 'freehire', 'eightfold via Freehire', 'eightfold', true, CURRENT_TIMESTAMP),
  ('source-freehire-cornerstone', 'freehire', 'cornerstone via Freehire', 'cornerstone', true, CURRENT_TIMESTAMP),
  ('source-freehire-applicantpro', 'freehire', 'applicantpro via Freehire', 'applicantpro', true, CURRENT_TIMESTAMP),
  ('source-freehire-catsone', 'freehire', 'catsone via Freehire', 'catsone', true, CURRENT_TIMESTAMP),
  ('source-freehire-hiringthing', 'freehire', 'hiringthing via Freehire', 'hiringthing', true, CURRENT_TIMESTAMP),
  ('source-freehire-freshteam', 'freehire', 'freshteam via Freehire', 'freshteam', true, CURRENT_TIMESTAMP),
  ('source-freehire-manatal', 'freehire', 'manatal via Freehire', 'manatal', true, CURRENT_TIMESTAMP),
  ('source-freehire-comeet', 'freehire', 'comeet via Freehire', 'comeet', true, CURRENT_TIMESTAMP),
  ('source-freehire-hibob', 'freehire', 'hibob via Freehire', 'hibob', true, CURRENT_TIMESTAMP),
  ('source-freehire-trakstar', 'freehire', 'trakstar via Freehire', 'trakstar', true, CURRENT_TIMESTAMP),
  ('source-freehire-recruitee', 'freehire', 'recruitee via Freehire', 'recruitee', true, CURRENT_TIMESTAMP),
  ('source-freehire-jobscore', 'freehire', 'jobscore via Freehire', 'jobscore', true, CURRENT_TIMESTAMP)
) AS incoming("id", "provider", "name", "boardToken", "enabled", "updatedAt")
WHERE NOT EXISTS (SELECT 1 FROM "job_pool_sources" existing WHERE lower(existing."provider") = lower(incoming."provider") AND lower(existing."boardToken") = lower(incoming."boardToken"))
ON CONFLICT DO NOTHING;

-- Carry forward the retry delay for partitions that were already attempted.
UPDATE "job_pool_sources" target
SET "lastAttemptAt" = legacy."lastAttemptAt", "lastSyncedAt" = legacy."lastSyncedAt",
    "nextSyncAt" = GREATEST(target."nextSyncAt", legacy."nextSyncAt"),
    "lastError" = legacy."lastError", "lastCount" = imported.total,
    "updatedAt" = CURRENT_TIMESTAMP
FROM "job_pool_sources" legacy,
  (SELECT "sourceName", count(*)::integer AS total FROM "job_pool_jobs"
   WHERE "sourceId" = 'source-freehire' GROUP BY "sourceName") imported
WHERE legacy."id" = 'source-freehire' AND legacy."lastAttemptAt" IS NOT NULL
  AND target."id" = 'source-freehire-' || target."boardToken" AND target."provider" = 'freehire'
  AND target."lastAttemptAt" IS NULL AND imported."sourceName" = 'Freehire · ' || target."boardToken";

-- Keep job IDs, hidden flags, application marks and original URLs intact.
UPDATE "job_pool_jobs" job SET "sourceId" = target."id"
FROM "job_pool_sources" target
WHERE job."sourceId" = 'source-freehire' AND target."provider" = 'freehire'
  AND target."boardToken" <> '' AND job."sourceName" = 'Freehire · ' || lower(target."boardToken");

-- The replacement feeds handle future imports independently.
UPDATE "job_pool_sources" SET "enabled" = false, "queued" = false, "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'source-freehire' AND "provider" = 'freehire' AND "boardToken" = '';
