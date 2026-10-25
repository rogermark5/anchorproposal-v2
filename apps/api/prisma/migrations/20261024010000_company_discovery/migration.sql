-- Additive company history. Existing jobs, identifiers and application marks stay intact.
BEGIN;
CREATE TABLE "job_pool_companies" (
  "key" TEXT PRIMARY KEY, "name" TEXT NOT NULL,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "job_pool_companies_firstSeenAt_idx" ON "job_pool_companies"("firstSeenAt");
ALTER TABLE "job_pool_jobs" ADD COLUMN "companyKey" TEXT NOT NULL DEFAULT '', ADD COLUMN "sourceUpdatedAt" TIMESTAMP(3);
-- Match JavaScript whitespace removal, including non-breaking and Unicode spaces.
CREATE FUNCTION pool_company_key(value TEXT) RETURNS TEXT LANGUAGE SQL IMMUTABLE STRICT AS $$
 SELECT lower(translate(value, E' \t\n\r\f' || chr(11) || chr(160) || chr(5760) ||
  chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279), ''))
$$;
UPDATE "job_pool_jobs" SET "companyKey" = pool_company_key("company");
INSERT INTO "job_pool_companies" ("key", "name", "firstSeenAt", "lastSeenAt")
 SELECT "companyKey", min("company"), min("createdAt"), max("lastSeenAt") FROM "job_pool_jobs" GROUP BY "companyKey";
CREATE FUNCTION track_pool_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 NEW."companyKey" := pool_company_key(NEW."company");
 INSERT INTO "job_pool_companies"("key", "name", "firstSeenAt", "lastSeenAt")
 VALUES (NEW."companyKey", NEW."company", NEW."createdAt", NEW."lastSeenAt")
 ON CONFLICT ("key") DO UPDATE SET
  "firstSeenAt" = LEAST("job_pool_companies"."firstSeenAt", EXCLUDED."firstSeenAt"),
  "lastSeenAt" = GREATEST("job_pool_companies"."lastSeenAt", EXCLUDED."lastSeenAt");
 RETURN NEW;
END $$;
CREATE TRIGGER "job_pool_company_history" BEFORE INSERT OR UPDATE OF "company", "lastSeenAt" ON "job_pool_jobs" FOR EACH ROW EXECUTE FUNCTION track_pool_company();
ALTER TABLE "job_pool_jobs" ADD CONSTRAINT "job_pool_jobs_companyKey_fkey" FOREIGN KEY ("companyKey") REFERENCES "job_pool_companies"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "job_pool_jobs_companyKey_publishedAt_idx" ON "job_pool_jobs"("companyKey", "publishedAt");
CREATE TABLE "job_pool_board_candidates" (
 "id" TEXT PRIMARY KEY, "provider" TEXT NOT NULL, "boardToken" TEXT NOT NULL, "name" TEXT NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'pending', "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "checkedAt" TIMESTAMP(3), "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "lockedUntil" TIMESTAMP(3), "lastError" TEXT
);
CREATE UNIQUE INDEX "job_pool_board_candidates_provider_boardToken_key" ON "job_pool_board_candidates"("provider", "boardToken");
CREATE INDEX "job_pool_board_candidates_state_nextCheckAt_idx" ON "job_pool_board_candidates"("state", "nextCheckAt");
-- These are documented filtered feeds, not invented company boards.
INSERT INTO "job_pool_sources" ("id", "provider", "name", "boardToken", "enabled", "queued", "nextSyncAt", "createdAt", "updatedAt")
 SELECT 'source-himalayas-' || country || '-' || replace(query, ' ', '-'), 'himalayas', 'Himalayas · ' || upper(country) || ' · ' || query,
 country || '-' || replace(query, ' ', '-'), true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
 FROM unnest(ARRAY['us','gb','ie']) country CROSS JOIN unnest(ARRAY['software','developer','devops','data engineer','qa engineer','security engineer','machine learning']) query
 ON CONFLICT ("provider", "boardToken") DO NOTHING;
COMMIT;
