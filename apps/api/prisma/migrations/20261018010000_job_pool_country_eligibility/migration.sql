-- Preserve all existing jobs and per-user application marks. Previously the
-- pool admitted US-eligible jobs only. Other countries are added on reimport
-- after their eligibility is checked against the original posting.
ALTER TABLE "job_pool_jobs" ADD COLUMN "eligibleCountries" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
UPDATE "job_pool_jobs" SET "eligibleCountries" = ARRAY['US']::TEXT[];
CREATE INDEX "job_pool_jobs_eligibleCountries_idx" ON "job_pool_jobs" USING GIN ("eligibleCountries");
