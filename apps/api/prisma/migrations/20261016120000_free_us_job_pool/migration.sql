-- Additive migration: existing users, profiles, applications and documents are unchanged.
CREATE TABLE "job_pool_sources" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "boardToken" TEXT NOT NULL DEFAULT '',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "queued" BOOLEAN NOT NULL DEFAULT false,
  "lastAttemptAt" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3),
  "nextSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedUntil" TIMESTAMP(3),
  "lastError" TEXT,
  "lastCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "job_pool_sources_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "job_pool_jobs" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT,
  "externalId" TEXT NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "jobUrl" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "company" TEXT NOT NULL,
  "location" TEXT NOT NULL,
  "workArrangement" "WorkArrangement" NOT NULL DEFAULT 'UNKNOWN',
  "description" TEXT NOT NULL,
  "salary" TEXT,
  "employmentType" TEXT,
  "sourceName" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "job_pool_jobs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "job_pool_sources_provider_boardToken_key" ON "job_pool_sources"("provider", "boardToken");
CREATE INDEX "job_pool_sources_enabled_nextSyncAt_idx" ON "job_pool_sources"("enabled", "nextSyncAt");
CREATE UNIQUE INDEX "job_pool_jobs_canonicalUrl_key" ON "job_pool_jobs"("canonicalUrl");
CREATE INDEX "job_pool_jobs_isActive_hidden_lastSeenAt_idx" ON "job_pool_jobs"("isActive", "hidden", "lastSeenAt");
CREATE INDEX "job_pool_jobs_sourceId_idx" ON "job_pool_jobs"("sourceId");
ALTER TABLE "job_pool_jobs" ADD CONSTRAINT "job_pool_jobs_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "job_pool_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Only Master can start imports. USAJOBS is opt-in and requires its free API key.
INSERT INTO "job_pool_sources" ("id", "provider", "name", "boardToken", "enabled", "updatedAt") VALUES
  ('source-jobicy', 'jobicy', 'Jobicy', '', true, CURRENT_TIMESTAMP),
  ('source-remoteok', 'remoteok', 'Remote OK', '', true, CURRENT_TIMESTAMP),
  ('source-usajobs', 'usajobs', 'USAJOBS', '', false, CURRENT_TIMESTAMP),
  ('source-greenhouse-airbnb', 'greenhouse', 'Airbnb', 'airbnb', true, CURRENT_TIMESTAMP),
  ('source-greenhouse-cloudflare', 'greenhouse', 'Cloudflare', 'cloudflare', true, CURRENT_TIMESTAMP),
  ('source-greenhouse-stripe', 'greenhouse', 'Stripe', 'stripe', true, CURRENT_TIMESTAMP),
  ('source-greenhouse-figma', 'greenhouse', 'Figma', 'figma', true, CURRENT_TIMESTAMP),
  ('source-greenhouse-datadog', 'greenhouse', 'Datadog', 'datadog', true, CURRENT_TIMESTAMP),
  ('source-greenhouse-reddit', 'greenhouse', 'Reddit', 'reddit', true, CURRENT_TIMESTAMP),
  ('source-greenhouse-twilio', 'greenhouse', 'Twilio', 'twilio', true, CURRENT_TIMESTAMP),
  ('source-greenhouse-mongodb', 'greenhouse', 'MongoDB', 'mongodb', true, CURRENT_TIMESTAMP),
  ('source-greenhouse-databricks', 'greenhouse', 'Databricks', 'databricks', true, CURRENT_TIMESTAMP),
  ('source-greenhouse-lyft', 'greenhouse', 'Lyft', 'lyft', true, CURRENT_TIMESTAMP),
  ('source-greenhouse-pinterest', 'greenhouse', 'Pinterest', 'pinterest', true, CURRENT_TIMESTAMP),
  ('source-greenhouse-instacart', 'greenhouse', 'Instacart', 'instacart', true, CURRENT_TIMESTAMP),
  ('source-greenhouse-robinhood', 'greenhouse', 'Robinhood', 'robinhood', true, CURRENT_TIMESTAMP),
  ('source-greenhouse-duolingo', 'greenhouse', 'Duolingo', 'duolingo', true, CURRENT_TIMESTAMP),
  ('source-greenhouse-affirm', 'greenhouse', 'Affirm', 'affirm', true, CURRENT_TIMESTAMP),
  ('source-greenhouse-coinbase', 'greenhouse', 'Coinbase', 'coinbase', true, CURRENT_TIMESTAMP),
  ('source-greenhouse-discord', 'greenhouse', 'Discord', 'discord', true, CURRENT_TIMESTAMP),
  ('source-greenhouse-roblox', 'greenhouse', 'Roblox', 'roblox', true, CURRENT_TIMESTAMP),
  ('source-lever-palantir', 'lever', 'Palantir', 'palantir', true, CURRENT_TIMESTAMP),
  ('source-lever-spotify', 'lever', 'Spotify', 'spotify', true, CURRENT_TIMESTAMP),
  ('source-ashby-notion', 'ashby', 'Notion', 'notion', true, CURRENT_TIMESTAMP),
  ('source-ashby-ramp', 'ashby', 'Ramp', 'ramp', true, CURRENT_TIMESTAMP),
  ('source-ashby-linear', 'ashby', 'Linear', 'linear', true, CURRENT_TIMESTAMP),
  ('source-ashby-openai', 'ashby', 'OpenAI', 'openai', true, CURRENT_TIMESTAMP),
  ('source-ashby-zapier', 'ashby', 'Zapier', 'zapier', true, CURRENT_TIMESTAMP),
  ('source-ashby-Ashby', 'ashby', 'Ashby', 'Ashby', true, CURRENT_TIMESTAMP);
