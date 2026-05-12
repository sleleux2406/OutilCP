-- Migration : ajout du champ parentProjectId sur Project (relation sous-projet)
-- Permet d'avoir des projets RUN rattachés à un projet parent.
--
-- À exécuter via :
--   psql -U postgres -h localhost -d qa_platform -f prisma/migrations/20260517000000_project_subproject/migration.sql

-- 1. Ajouter la colonne (nullable : tous les projets existants deviennent racines)
ALTER TABLE "Project"
  ADD COLUMN IF NOT EXISTS "parentProjectId" TEXT NULL;

-- 2. Foreign key avec ON DELETE CASCADE : si un projet parent est supprimé,
--    ses sous-projets sont supprimés aussi (cohérent avec la sémantique "sous-projet")
ALTER TABLE "Project"
  DROP CONSTRAINT IF EXISTS "Project_parentProjectId_fkey";

ALTER TABLE "Project"
  ADD CONSTRAINT "Project_parentProjectId_fkey"
  FOREIGN KEY ("parentProjectId")
  REFERENCES "Project" ("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- 3. Contrainte : un projet ne peut pas être son propre parent
ALTER TABLE "Project"
  DROP CONSTRAINT IF EXISTS project_no_self_parent;
ALTER TABLE "Project"
  ADD CONSTRAINT project_no_self_parent
  CHECK ("parentProjectId" IS NULL OR "parentProjectId" <> id);

-- 4. Index pour les requêtes "lister les sous-projets d'un parent"
CREATE INDEX IF NOT EXISTS "Project_parentProjectId_idx" ON "Project" ("parentProjectId");

COMMENT ON COLUMN "Project"."parentProjectId" IS
  'Projet parent : NULL = projet racine, non-null = sous-projet (ex: RUN)';
