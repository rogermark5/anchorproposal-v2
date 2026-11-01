-- Existing profile owners cannot be inferred. Master assigns legacy profiles explicitly.
ALTER TABLE "profiles" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "profiles_ownerId_idx" ON "profiles"("ownerId");

-- Old admin assignments were also created by selecting a default; they are not Master grants.
-- Existing bidder assignments keep their existing behavior.
ALTER TABLE "profile_assignments" ADD COLUMN "grantedByMaster" BOOLEAN NOT NULL DEFAULT false;
