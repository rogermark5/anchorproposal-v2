ALTER TABLE "resume_generations"
  ADD COLUMN "promptSnapshot" TEXT,
  ADD COLUMN "coverLetterPromptSnapshot" TEXT,
  ADD COLUMN "templateConfigSnapshotJson" JSONB,
  ADD COLUMN "publicShareNonce" TEXT;
ALTER TABLE "applications" ADD COLUMN "normalizedJobUrl" TEXT;
CREATE UNIQUE INDEX "applications_profileId_normalizedJobUrl_key" ON "applications"("profileId", "normalizedJobUrl");

CREATE TABLE "profile_generation_preferences" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "profileId" TEXT NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "resumePromptId" TEXT,
  "coverLetterPromptId" TEXT,
  CONSTRAINT "profile_generation_preferences_userId_profileId_key" UNIQUE ("userId", "profileId")
);
CREATE TABLE "user_template_customizations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "templateVersionId" TEXT NOT NULL REFERENCES "template_versions"("id") ON DELETE CASCADE,
  "name" TEXT,
  "configJson" JSONB NOT NULL,
  CONSTRAINT "user_template_customizations_userId_templateVersionId_key" UNIQUE ("userId", "templateVersionId")
);
