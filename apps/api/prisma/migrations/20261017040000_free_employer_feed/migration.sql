-- Adds a free, keyless feed of additional employer recruiting systems.
-- Existing source overrides, settings and user records are preserved.
INSERT INTO "job_pool_sources" ("id", "provider", "name", "boardToken", "enabled", "updatedAt")
SELECT 'source-freehire', 'freehire', 'Freehire · additional employer feeds', '', true, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "job_pool_sources" WHERE lower("provider") = 'freehire' AND "boardToken" = '')
ON CONFLICT DO NOTHING;
