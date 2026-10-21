-- Preserve every previous applied mark. Its profile was never recorded, so it
-- stays NULL rather than assigning a profile that may not have been used.
ALTER TABLE "job_pool_applied" ADD COLUMN "id" TEXT;
UPDATE "job_pool_applied" SET "id" = gen_random_uuid()::text;
ALTER TABLE "job_pool_applied" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "job_pool_applied" DROP CONSTRAINT "job_pool_applied_pkey";
ALTER TABLE "job_pool_applied" ADD CONSTRAINT "job_pool_applied_pkey" PRIMARY KEY ("id");
ALTER TABLE "job_pool_applied" ADD COLUMN "profileId" TEXT;
ALTER TABLE "job_pool_applied" ADD CONSTRAINT "job_pool_applied_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "job_pool_applied_userId_jobId_profileId_key" ON "job_pool_applied"("userId", "jobId", "profileId");
CREATE INDEX "job_pool_applied_userId_jobId_idx" ON "job_pool_applied"("userId", "jobId");
CREATE INDEX "job_pool_applied_profileId_idx" ON "job_pool_applied"("profileId");

-- Keep the job and all application/view history, removing excluded titles from
-- the pool using exactly the case-insensitive substring rule used by imports.
UPDATE "job_pool_jobs" SET "isSoftware" = false
WHERE "isSoftware" = true AND "title" ~* 'staff|principal|architect|junior';
