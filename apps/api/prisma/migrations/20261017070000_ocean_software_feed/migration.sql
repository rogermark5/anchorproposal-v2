-- Public, free employer-job feed. Existing overrides and user data are kept.
INSERT INTO "job_pool_sources" ("id", "provider", "name", "boardToken", "enabled", "updatedAt")
SELECT 'source-ocean', 'ocean', 'Ocean of Jobs', '', true, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "job_pool_sources" WHERE lower("provider") = 'ocean' AND "boardToken" = '')
ON CONFLICT DO NOTHING;
