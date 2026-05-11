-- Migration : ajout des tables Holiday + UserLeave pour la gestion
-- des disponibilités (jours fériés globaux + congés individuels).
--
-- À exécuter via :
--   psql -U postgres -h localhost -d qa_platform -f prisma/migrations/20260511000000_holidays_leaves/migration.sql
--
-- Puis :  npx prisma generate

-- ─── 1. Table Holiday ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Holiday" (
  "id"        TEXT        NOT NULL,
  "date"      DATE        NOT NULL,
  "label"     TEXT        NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- Une seule entrée par date (éviter les doublons Jour de l'An × 2)
CREATE UNIQUE INDEX IF NOT EXISTS "Holiday_date_key" ON "Holiday" ("date");
CREATE INDEX IF NOT EXISTS "Holiday_date_idx" ON "Holiday" ("date");

-- ─── 2. Table UserLeave ────────────────────────────────────
CREATE TABLE IF NOT EXISTS "UserLeave" (
  "id"        TEXT        NOT NULL,
  "userId"    TEXT        NOT NULL,
  "startDate" DATE        NOT NULL,
  "endDate"   DATE        NOT NULL,
  "label"     TEXT        NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserLeave_pkey" PRIMARY KEY ("id")
);

-- Foreign key cascade : quand on supprime un user, ses congés disparaissent
ALTER TABLE "UserLeave"
  DROP CONSTRAINT IF EXISTS "UserLeave_userId_fkey";
ALTER TABLE "UserLeave"
  ADD CONSTRAINT "UserLeave_userId_fkey"
  FOREIGN KEY ("userId")
  REFERENCES "User" ("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- Contrainte : endDate >= startDate (une plage cohérente)
ALTER TABLE "UserLeave"
  DROP CONSTRAINT IF EXISTS userleave_dates_consistent;
ALTER TABLE "UserLeave"
  ADD CONSTRAINT userleave_dates_consistent
  CHECK ("endDate" >= "startDate");

-- Index pour les requêtes "à telle date, qui est absent ?"
CREATE INDEX IF NOT EXISTS "UserLeave_userId_startDate_idx" ON "UserLeave" ("userId", "startDate");
CREATE INDEX IF NOT EXISTS "UserLeave_userId_endDate_idx"   ON "UserLeave" ("userId", "endDate");

COMMENT ON TABLE "Holiday"   IS 'Jours fériés globaux (applicables à toute l''équipe)';
COMMENT ON TABLE "UserLeave" IS 'Plages de congés individuels par utilisateur';
