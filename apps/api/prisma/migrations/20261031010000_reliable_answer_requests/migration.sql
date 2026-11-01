ALTER TABLE "generation_turns" ADD COLUMN "requestId" TEXT;
CREATE UNIQUE INDEX "generation_turns_requestId_role_key" ON "generation_turns"("requestId", "role");
CREATE TABLE "generation_answer_requests" (
  "id" TEXT NOT NULL,
  "generationId" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "generation_answer_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "generation_answer_requests_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "resume_generations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "generation_answer_requests_requestKey_key" ON "generation_answer_requests"("requestKey");
CREATE INDEX "generation_answer_requests_generationId_creatorId_createdAt_idx" ON "generation_answer_requests"("generationId", "creatorId", "createdAt");
