-- Existing jobs keep their history and stay unmarked until genuinely new jobs arrive.
ALTER TABLE "job_pool_jobs" ADD COLUMN "addedBatchId" TEXT;
