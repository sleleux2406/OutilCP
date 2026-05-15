-- Migration : tables CapacityPlan + CapacityPlanItem pour le placement P1
--
-- À exécuter via :
--   psql -U postgres -h localhost -d qa_platform -f prisma/migrations/20260521000000_capacity_plan/migration.sql

-- 1. Table CapacityPlan : un plan par projet (unique)
CREATE TABLE IF NOT EXISTS "CapacityPlan" (
  "id"        TEXT      NOT NULL,
  "projectId" TEXT      NOT NULL,
  "startWeek" DATE      NOT NULL,
  "endDate"   DATE      NULL,
  "createdBy" TEXT      NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CapacityPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CapacityPlan_projectId_key"
  ON "CapacityPlan" ("projectId");

ALTER TABLE "CapacityPlan"
  DROP CONSTRAINT IF EXISTS "CapacityPlan_projectId_fkey";
ALTER TABLE "CapacityPlan"
  ADD CONSTRAINT "CapacityPlan_projectId_fkey"
  FOREIGN KEY ("projectId")
  REFERENCES "Project" ("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- 2. Table CapacityPlanItem : allocation d'un ticket sur une semaine
CREATE TABLE IF NOT EXISTS "CapacityPlanItem" (
  "id"               TEXT      NOT NULL,
  "planId"           TEXT      NOT NULL,
  "ticketId"         TEXT      NOT NULL,
  "weekStart"        DATE      NOT NULL,
  "allocatedMinutes" INTEGER   NOT NULL,
  "position"         INTEGER   NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CapacityPlanItem_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CapacityPlanItem"
  DROP CONSTRAINT IF EXISTS "CapacityPlanItem_planId_fkey";
ALTER TABLE "CapacityPlanItem"
  ADD CONSTRAINT "CapacityPlanItem_planId_fkey"
  FOREIGN KEY ("planId")
  REFERENCES "CapacityPlan" ("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- Contrainte : minutes allouées positives
ALTER TABLE "CapacityPlanItem"
  DROP CONSTRAINT IF EXISTS capacity_plan_item_minutes_positive;
ALTER TABLE "CapacityPlanItem"
  ADD CONSTRAINT capacity_plan_item_minutes_positive
  CHECK ("allocatedMinutes" > 0);

CREATE INDEX IF NOT EXISTS "CapacityPlanItem_planId_weekStart_idx"
  ON "CapacityPlanItem" ("planId", "weekStart");

CREATE INDEX IF NOT EXISTS "CapacityPlanItem_ticketId_idx"
  ON "CapacityPlanItem" ("ticketId");

COMMENT ON TABLE "CapacityPlan" IS
  'Plan de capacité courant pour un projet : un seul plan actif (écrasé à chaque clic Placement automatique).';
COMMENT ON TABLE "CapacityPlanItem" IS
  'Allocation d''un ticket P1 sur une semaine du plan. Un même ticket peut s''étaler sur plusieurs semaines.';
