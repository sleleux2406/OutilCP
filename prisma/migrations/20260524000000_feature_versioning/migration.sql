-- Migration : ajoute les champs de versioning des specs sur Ticket (EPIC E04)
--
-- Module 1.1 - Champs d'audit immuables sur Feature :
--   idFeatureSource : cle fonctionnelle stable (ex: "F02.4")
--   versionCreation : version JSON ayant cree le ticket (immuable)
--   versionSpecsCourante : version actuelle des specs (mise a jour a chaque re-import)
--
-- Module 1.1 - Pour les enfants (Task/Bug/US) sous une Feature :
--   versionSpecsOriginelle : copie de versionSpecsCourante du parent au moment de la creation
--
-- Module 1.3 - Marqueur d'export :
--   lastExportedAtVersion : derniere version exportee
--   lastExportedAt : horodatage
--
-- Idempotent : tous les ADD COLUMN ont IF NOT EXISTS.

ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "idFeatureSource" TEXT;

ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "versionCreation" TEXT;

ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "versionSpecsCourante" TEXT;

ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "versionSpecsOriginelle" TEXT;

ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "lastExportedAtVersion" TEXT;

ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "lastExportedAt" TIMESTAMP(3);

-- Index pour la recherche par cle fonctionnelle (anti-doublon import)
CREATE INDEX IF NOT EXISTS "Ticket_projectId_idFeatureSource_idx"
  ON "Ticket"("projectId", "idFeatureSource");

COMMENT ON COLUMN "Ticket"."idFeatureSource" IS
  'Cle fonctionnelle stable d''une FEATURE (ex: F02.4). Critere de doublon pour les re-imports JSON. Le titre n''est PAS critere.';
COMMENT ON COLUMN "Ticket"."versionCreation" IS
  'Version du JSON ayant cree initialement le ticket. IMMUABLE.';
COMMENT ON COLUMN "Ticket"."versionSpecsCourante" IS
  'Version courante des specs sur ce ticket. Mise a jour a chaque re-import.';
COMMENT ON COLUMN "Ticket"."versionSpecsOriginelle" IS
  'Pour les enfants (Task/Bug/US) sous une Feature : copie de versionSpecsCourante du parent au moment de la creation. IMMUABLE.';
COMMENT ON COLUMN "Ticket"."lastExportedAtVersion" IS
  'Derniere version exportee pour cette Feature. Permet de calculer le compteur "Features en retard d''export".';
