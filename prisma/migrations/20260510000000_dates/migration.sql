-- Migration : ajout des colonnes startDate / endDate sur Ticket pour la planification
-- À exécuter via :
--   psql -U postgres -h localhost -d qa_platform -f prisma/migrations/20260510000000_dates/migration.sql

ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "startDate" DATE NULL;

ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "endDate" DATE NULL;

-- Contrainte : si les deux sont définies, endDate doit être >= startDate
ALTER TABLE "Ticket"
  DROP CONSTRAINT IF EXISTS ticket_dates_consistent;

ALTER TABLE "Ticket"
  ADD CONSTRAINT ticket_dates_consistent
  CHECK (
    "startDate" IS NULL
    OR "endDate" IS NULL
    OR "endDate" >= "startDate"
  );

-- Index pour les requêtes de planning/vue calendrier
CREATE INDEX IF NOT EXISTS "Ticket_startDate_idx" ON "Ticket" ("startDate");
CREATE INDEX IF NOT EXISTS "Ticket_endDate_idx"   ON "Ticket" ("endDate");

COMMENT ON COLUMN "Ticket"."startDate" IS
  'Date de début d''exécution prévue (jours ouvrés)';
COMMENT ON COLUMN "Ticket"."endDate" IS
  'Date de fin calculée = startDate + RAF en jours ouvrés, stockée pour perf';
