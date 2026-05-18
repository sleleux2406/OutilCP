-- Migration : ajoute soft delete sur User (deletedAt)
--
-- Permet de desactiver un compte sans perdre l'historique de ses tickets,
-- time entries, audit logs, etc. Un user avec deletedAt non-null ne peut
-- plus se connecter mais reste reference dans les autres tables.
--
-- Idempotent : ADD COLUMN IF NOT EXISTS + index conditionnel.

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "User_deletedAt_idx" ON "User"("deletedAt");

COMMENT ON COLUMN "User"."deletedAt" IS
  'Soft delete : non-null = compte desactive (ne peut plus se connecter, mais ses tickets/audits sont preserves).';
