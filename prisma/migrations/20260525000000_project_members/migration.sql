-- Migration : table ProjectMember pour le multi-projet
--
-- Permet d'affecter explicitement des utilisateurs aux projets.
-- L'ADMIN voit tous les projets par defaut (bypass de cette table).
-- Les autres roles ne voient que les projets ou ils sont membres.
--
-- Idempotent : tous les CREATE ont IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "ProjectMember" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "addedById" TEXT,
  CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- Unicite : un user ne peut pas etre ajoute deux fois au meme projet
CREATE UNIQUE INDEX IF NOT EXISTS "ProjectMember_projectId_userId_key"
  ON "ProjectMember"("projectId", "userId");

-- Index pour les requetes inversees
CREATE INDEX IF NOT EXISTS "ProjectMember_userId_idx"
  ON "ProjectMember"("userId");

CREATE INDEX IF NOT EXISTS "ProjectMember_projectId_idx"
  ON "ProjectMember"("projectId");

-- Foreign keys avec CASCADE pour nettoyer si un projet ou un user est supprime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProjectMember_projectId_fkey'
  ) THEN
    ALTER TABLE "ProjectMember"
      ADD CONSTRAINT "ProjectMember_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ProjectMember_userId_fkey'
  ) THEN
    ALTER TABLE "ProjectMember"
      ADD CONSTRAINT "ProjectMember_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMENT ON TABLE "ProjectMember" IS
  'Affectation User <-> Project pour le multi-projet. ADMIN bypass cette table.';
COMMENT ON COLUMN "ProjectMember"."addedById" IS
  'Utilisateur (typiquement ADMIN ou PO) qui a effectue l''affectation. Null pour les anciennes affectations.';
