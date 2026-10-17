-- Additive: existing jobs and application data remain intact.
ALTER TABLE "job_pool_jobs" ADD COLUMN "isSoftware" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "job_pool_jobs" SET "postedAt" = COALESCE("publishedAt", "createdAt"),
"isSoftware" = ("title" ~* '\y(software|developer|programmer|full[ -]?stack|front[ -]?end|back[ -]?end|devops|devsecops|sre|site reliability|platform engineer|cloud engineer|data engineer|data scientist|machine learning|ml engineer|ai engineer|artificial intelligence|mobile engineer|ios engineer|android engineer|web engineer|application engineer|applications engineer|qa engineer|quality assurance engineer|test automation|automation test|sdet|security engineer|cybersecurity engineer|database engineer|database administrator|technical architect|solutions architect|software architect|engineering manager|engineering director|director of engineering|vp of engineering|head of engineering|cto)\y' AND "title" !~* '\y(sales|account executive|recruiter|recruiting|talent acquisition|marketing|customer success|business development|civil|mechanical|electrical|manufacturing|hardware|construction|field service|field engineer|controls engineer|industrial|chemical|aerospace|biomedical|clinical)\y');
CREATE INDEX "job_pool_jobs_isSoftware_workArrangement_postedAt_id_idx" ON "job_pool_jobs"("isSoftware", "workArrangement", "postedAt", "id");
CREATE TABLE "job_pool_applied" (
  "userId" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "job_pool_applied_pkey" PRIMARY KEY ("userId", "jobId"),
  CONSTRAINT "job_pool_applied_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "job_pool_applied_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "job_pool_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "job_pool_applied_jobId_idx" ON "job_pool_applied"("jobId");
