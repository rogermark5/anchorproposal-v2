-- Free public API categories. Existing source overrides and user data are kept.
INSERT INTO "job_pool_sources" ("id", "provider", "name", "boardToken", "enabled", "updatedAt")
SELECT 'source-remotejobs-' || category, 'remotejobs', category || ' via RemoteJobs.org', category, true, CURRENT_TIMESTAMP
FROM unnest(ARRAY['programming','devops','data-science','ai-machine-learning','cybersecurity','cyber-security','quality-assurance']) AS category
WHERE NOT EXISTS (SELECT 1 FROM "job_pool_sources" existing WHERE lower(existing."provider")='remotejobs' AND lower(existing."boardToken")=category)
ON CONFLICT DO NOTHING;
