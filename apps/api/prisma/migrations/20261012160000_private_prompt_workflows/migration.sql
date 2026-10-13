BEGIN;
ALTER TABLE "prompt_versions" ADD COLUMN "documentKind" TEXT NOT NULL DEFAULT 'combined';
ALTER TABLE "prompt_versions" ADD COLUMN "sourcePromptId" TEXT;
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_documentKind_check"
  CHECK ("documentKind" IN ('combined', 'resume', 'cover-letter'));
CREATE UNIQUE INDEX "prompt_versions_ownerId_sourcePromptId_key" ON "prompt_versions"("ownerId", "sourcePromptId");

-- Preserve each existing user's effective default as an independent owned copy.
CREATE TEMP TABLE private_defaults ON COMMIT DROP AS
SELECT u."id" AS "userId", md5(u."id" || ':private-default-migration')::uuid::text AS "copyId", p."id" AS "sourceId"
FROM "users" u
CROSS JOIN LATERAL (
  SELECT p.* FROM "prompt_versions" p
  WHERE p."isPublished" AND p."archivedAt" IS NULL AND (
    p."id" = u."selectedPromptId" OR
    (u."useMasterPrompt" AND p."ownerId" IS NULL) OR
    (NOT u."useMasterPrompt" AND (p."ownerId" = u."id" OR EXISTS (
      SELECT 1 FROM "prompt_assignments" a WHERE a."userId" = u."id" AND a."promptVersionId" = p."id")))
  )
  ORDER BY (p."id" = u."selectedPromptId") DESC NULLS LAST,
    (u."useMasterPrompt" AND p."ownerId" IS NULL AND p."isInitial") DESC,
    p."isPersonalDefault" DESC, p."publishedAt" DESC NULLS LAST
  LIMIT 1
) p
WHERE NOT EXISTS (SELECT 1 FROM "prompt_versions" own WHERE own."id" = u."selectedPromptId" AND own."ownerId" = u."id" AND own."isPublished" AND own."archivedAt" IS NULL);

INSERT INTO "prompt_versions" ("id", "name", "content", "experienceTitleMode", "version", "isPublished", "isInitial", "isPersonalDefault", "publishedAt", "ownerId", "createdAt", "updatedAt", "sourcePromptId")
SELECT d."copyId", 'My all-profile prompt', p."content", 'saved', 1, true, false, true, NOW(), d."userId", NOW(), NOW(), 'default:' || p."id"
FROM private_defaults d JOIN "prompt_versions" p ON p."id" = d."sourceId";
UPDATE "users" u SET "selectedPromptId" = d."copyId", "useMasterPrompt" = false FROM private_defaults d WHERE u."id" = d."userId";
UPDATE "users" SET "useMasterPrompt" = false WHERE "selectedPromptId" IS NOT NULL;

-- Convert inherited profile prompts to independent copies owned by each recipient.
CREATE TEMP TABLE private_profile_prompts ON COMMIT DROP AS
SELECT u."id" AS "userId", p."id" AS "profileId", source."id" AS "sourceId",
  CASE WHEN source."ownerId" = u."id" THEN source."id" ELSE md5(u."id" || ':private-copy:' || source."id")::uuid::text END AS "copyId"
FROM "users" u CROSS JOIN "profiles" p
LEFT JOIN "profile_generation_preferences" pref ON pref."userId" = u."id" AND pref."profileId" = p."id"
LEFT JOIN "profile_prompt_assignments" a ON a."userId" = u."id" AND a."profileId" = p."id"
JOIN "prompt_versions" source ON source."id" = COALESCE(pref."resumePromptId", a."promptVersionId", p."promptVersionId")
WHERE source."isPublished" AND source."archivedAt" IS NULL
  AND (u."role" IN ('ADMIN', 'MASTER') OR EXISTS (SELECT 1 FROM "profile_assignments" pa WHERE pa."userId" = u."id" AND pa."profileId" = p."id" AND pa."activeTo" IS NULL));

INSERT INTO "prompt_versions" ("id", "name", "content", "experienceTitleMode", "version", "isPublished", "isInitial", "isPersonalDefault", "publishedAt", "ownerId", "createdAt", "updatedAt", "sourcePromptId")
SELECT DISTINCT x."copyId", source."name", source."content", source."experienceTitleMode", 1, true, false, false, NOW(), x."userId", NOW(), NOW(), source."id"
FROM private_profile_prompts x JOIN "prompt_versions" source ON source."id" = x."sourceId"
WHERE x."copyId" <> source."id"
ON CONFLICT ("ownerId", "sourcePromptId") DO NOTHING;
INSERT INTO "profile_generation_preferences" ("id", "userId", "profileId", "resumePromptId")
SELECT md5(x."userId" || ':private-profile:' || x."profileId")::uuid::text, x."userId", x."profileId", x."copyId"
FROM private_profile_prompts x
ON CONFLICT ("userId", "profileId") DO UPDATE SET "resumePromptId" = EXCLUDED."resumePromptId";

-- Existing cover prompts created through personal preferences already belong to the user.
INSERT INTO "prompt_versions" ("id", "name", "content", "experienceTitleMode", "version", "isPublished", "isInitial", "isPersonalDefault", "publishedAt", "ownerId", "createdAt", "updatedAt", "sourcePromptId")
SELECT md5(u."id" || ':private-copy:' || p."id")::uuid::text, p."name", p."content", p."experienceTitleMode", p."version", p."isPublished", false, false, p."publishedAt", u."id", NOW(), NOW(), p."id"
FROM "users" u CROSS JOIN "prompt_versions" p WHERE u."role" = 'MASTER' AND p."ownerId" IS NULL AND p."archivedAt" IS NULL
ON CONFLICT ("ownerId", "sourcePromptId") DO NOTHING;
UPDATE "prompt_versions" p SET "documentKind" = 'cover-letter'
WHERE EXISTS (SELECT 1 FROM "profile_generation_preferences" pref WHERE pref."coverLetterPromptId" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "profile_generation_preferences" pref WHERE pref."resumePromptId" = p."id");
UPDATE "prompt_versions" p SET "documentKind" = 'resume'
WHERE EXISTS (SELECT 1 FROM "profile_generation_preferences" pref JOIN "users" u ON u."id" = pref."userId" WHERE pref."resumePromptId" = p."id" AND u."generationPromptMode" = 'separate')
  AND NOT EXISTS (SELECT 1 FROM "profile_generation_preferences" pref JOIN "users" u ON u."id" = pref."userId" WHERE pref."resumePromptId" = p."id" AND u."generationPromptMode" <> 'separate');

-- Each user's application-answer prompt is also independent.
INSERT INTO "system_settings" ("id", "key", "value", "updatedAt")
SELECT md5(u."id" || ':private-answer-prompt')::uuid::text, 'answer_prompt:' || u."id", s."value", NOW() FROM "users" u CROSS JOIN "system_settings" s WHERE s."key" = 'answer_prompt'
ON CONFLICT ("key") DO NOTHING;
-- Preserve old records for historical generations; they are no longer selectable.
UPDATE "prompt_versions" SET "isPublished" = false, "isInitial" = false, "archivedAt" = COALESCE("archivedAt", NOW()) WHERE "ownerId" IS NULL;
COMMIT;
