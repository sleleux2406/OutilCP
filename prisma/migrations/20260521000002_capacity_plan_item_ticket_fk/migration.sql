-- Migration additive : ajoute la contrainte FK CapacityPlanItem.ticketId -> Ticket.id
-- avec CASCADE DELETE (un ticket supprimé nettoie ses allocations).
--
-- Cette FK manquait dans la migration initiale (le ticketId etait juste un String).
-- La relation Prisma a ete ajoutee dans le schema pour permettre le include({ ticket: ... }).
--
-- Idempotente : DROP IF EXISTS + ADD.

ALTER TABLE "CapacityPlanItem"
  DROP CONSTRAINT IF EXISTS "CapacityPlanItem_ticketId_fkey";

ALTER TABLE "CapacityPlanItem"
  ADD CONSTRAINT "CapacityPlanItem_ticketId_fkey"
  FOREIGN KEY ("ticketId")
  REFERENCES "Ticket" ("id")
  ON DELETE CASCADE
  ON UPDATE CASCADE;
