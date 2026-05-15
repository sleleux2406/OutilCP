-- Migration additive : enrichit CapacityPlan avec les métadonnées du Lot 2
-- (generatedAt, generatedById, projectedEndDate, leftoverMinutes, weeksCount).
--
-- À exécuter via :
--   psql -U postgres -h localhost -d qa_platform -f prisma/migrations/20260521000001_capacity_plan_metadata/migration.sql
-- Ou plus simplement : npm run db:apply-all (idempotent).

-- 1. Ajout de generatedAt (date de génération du plan)
ALTER TABLE "CapacityPlan"
  ADD COLUMN IF NOT EXISTS "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 2. Renommage createdBy → generatedById (si l'ancienne colonne existe encore)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'CapacityPlan' AND column_name = 'createdBy'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'CapacityPlan' AND column_name = 'generatedById'
  ) THEN
    ALTER TABLE "CapacityPlan" RENAME COLUMN "createdBy" TO "generatedById";
  END IF;
END $$;

-- 2b. Si generatedById n'existe toujours pas (cas où createdBy n'existait pas non plus), on l'ajoute
ALTER TABLE "CapacityPlan"
  ADD COLUMN IF NOT EXISTS "generatedById" TEXT;

-- Backfill : si des plans existent sans generatedById, on met une valeur par défaut
UPDATE "CapacityPlan" SET "generatedById" = 'system' WHERE "generatedById" IS NULL;

-- Puis on rend la colonne NOT NULL
ALTER TABLE "CapacityPlan"
  ALTER COLUMN "generatedById" SET NOT NULL;

-- 3. Renommage endDate → projectedEndDate
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'CapacityPlan' AND column_name = 'endDate'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'CapacityPlan' AND column_name = 'projectedEndDate'
  ) THEN
    ALTER TABLE "CapacityPlan" RENAME COLUMN "endDate" TO "projectedEndDate";
  END IF;
END $$;

ALTER TABLE "CapacityPlan"
  ADD COLUMN IF NOT EXISTS "projectedEndDate" DATE;

-- 4. Suppression de la colonne startWeek (devenue inutile : l'horizon est calculé à la volée)
ALTER TABLE "CapacityPlan"
  DROP COLUMN IF EXISTS "startWeek";

-- 5. Ajout de leftoverMinutes (minutes P1 non placées faute de capacité)
ALTER TABLE "CapacityPlan"
  ADD COLUMN IF NOT EXISTS "leftoverMinutes" INTEGER NOT NULL DEFAULT 0;

-- 6. Ajout de weeksCount (taille de l'horizon utilisé pour ce plan)
ALTER TABLE "CapacityPlan"
  ADD COLUMN IF NOT EXISTS "weeksCount" INTEGER NOT NULL DEFAULT 12;

COMMENT ON COLUMN "CapacityPlan"."generatedAt" IS
  'Date à laquelle le placement automatique a été calculé.';
COMMENT ON COLUMN "CapacityPlan"."generatedById" IS
  'ID de l''utilisateur qui a déclenché le placement.';
COMMENT ON COLUMN "CapacityPlan"."projectedEndDate" IS
  'Date de fin projetée pour absorber tous les P1 placés.';
COMMENT ON COLUMN "CapacityPlan"."leftoverMinutes" IS
  'Minutes P1 non placées car capacité insuffisante sur l''horizon.';
COMMENT ON COLUMN "CapacityPlan"."weeksCount" IS
  'Nombre de semaines projetées lors de la génération.';
