-- Migration : ajout du champ Ticket.isTechnical (booleen)
--
-- Permet de marquer les Features et Tasks comme "techniques" (refactor,
-- infra, dette technique) pour les distinguer des Features/Tasks
-- fonctionnelles. Le filtre est ensuite applicable sur le Kanban,
-- la vue Pilotage et le Cahier de tests.
--
-- S'applique en pratique uniquement aux types FEATURE et TASK (validation
-- cote app), mais la colonne existe sur tous les Ticket pour simplicite.
--
-- Idempotent : ADD COLUMN IF NOT EXISTS.

ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "isTechnical" BOOLEAN NOT NULL DEFAULT false;

-- Index pour filtrer rapidement (si on a beaucoup de tickets et qu'on filtre frequemment)
CREATE INDEX IF NOT EXISTS "Ticket_isTechnical_idx"
  ON "Ticket"("isTechnical");

COMMENT ON COLUMN "Ticket"."isTechnical" IS
  'Marqueur ticket technique (refactor, infra, dette). S''applique aux types FEATURE et TASK. Defaut false.';
