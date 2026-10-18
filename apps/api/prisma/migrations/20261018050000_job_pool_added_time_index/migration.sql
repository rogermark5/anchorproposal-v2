-- Support rolling added-time filters and stable newest-added pagination.
CREATE INDEX IF NOT EXISTS "job_pool_added_idx"
ON "job_pool_jobs" ("isSoftware", "workArrangement", "createdAt", "id");
