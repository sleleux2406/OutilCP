-- Migration : ajout de ON DELETE CASCADE sur TestExecution.testCaseId
-- Ainsi la suppression d'un TestCase supprime ses exécutions.
-- Nécessaire pour pouvoir supprimer des tickets qui ont déjà été testés.
--
-- À exécuter via :
--   psql -U postgres -h localhost -d qa_platform -f prisma/migrations/20260512000000_cascade_testexec/migration.sql

ALTER TABLE "TestExecution"
  DROP CONSTRAINT IF EXISTS "TestExecution_testCaseId_fkey";

ALTER TABLE "TestExecution"
  ADD CONSTRAINT "TestExecution_testCaseId_fkey"
  FOREIGN KEY ("testCaseId")
  REFERENCES "TestCase" ("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
