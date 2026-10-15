-- Repeated job links require confirmation instead of rejecting the application.
DROP INDEX IF EXISTS "applications_profileId_normalizedJobUrl_key";
CREATE INDEX "applications_profileId_normalizedJobUrl_idx" ON "applications"("profileId", "normalizedJobUrl");
UPDATE "application_warnings" SET "severity" = 'CONFIRM', "behavior" = 'CONFIRM' WHERE "category" = 'DUPLICATE';
-- Only explicit, authenticated user edits can change qualification wording.
ALTER TABLE "resume_generations" ADD COLUMN "isUserEdited" BOOLEAN NOT NULL DEFAULT false;
