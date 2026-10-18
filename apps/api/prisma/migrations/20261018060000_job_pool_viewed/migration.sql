-- Viewed history is private to each user and does not change applied marks.
CREATE TABLE "job_pool_viewed" (
  "userId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "job_pool_viewed_pkey" PRIMARY KEY ("userId", "jobId")
);
CREATE INDEX "job_pool_viewed_jobId_idx" ON "job_pool_viewed"("jobId");
ALTER TABLE "job_pool_viewed" ADD CONSTRAINT "job_pool_viewed_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_pool_viewed" ADD CONSTRAINT "job_pool_viewed_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "job_pool_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
