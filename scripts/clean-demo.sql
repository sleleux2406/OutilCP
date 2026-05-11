-- Nettoyage du projet DEMO : supprime tous les tickets et leurs dépendances.
--
-- À exécuter depuis le dossier racine du projet :
--   psql -U postgres -h localhost -d qa_platform -f scripts/clean-demo.sql
--
-- Ce script est idempotent : il peut être relancé sans erreur si certains
-- tickets ont déjà été supprimés. L'ensemble tourne dans une transaction.

BEGIN;

-- 1. TestExecution liées aux TestCase du projet DEMO
DELETE FROM "TestExecution" WHERE "testCaseId" IN (
  SELECT tc.id FROM "TestCase" tc
  JOIN "Ticket" t ON t.id = tc."ticketId"
  JOIN "Project" p ON p.id = t."projectId"
  WHERE p.key = 'DEMO'
);

-- 2. TestExecution restantes liées aux TestRun du projet DEMO
DELETE FROM "TestExecution" WHERE "testRunId" IN (
  SELECT tr.id FROM "TestRun" tr
  JOIN "Ticket" t ON t.id = tr."ticketId"
  JOIN "Project" p ON p.id = t."projectId"
  WHERE p.key = 'DEMO'
);

-- 3. TestRun du projet DEMO
DELETE FROM "TestRun" WHERE "ticketId" IN (
  SELECT t.id FROM "Ticket" t
  JOIN "Project" p ON p.id = t."projectId"
  WHERE p.key = 'DEMO'
);

-- 4. TestCase du projet DEMO
DELETE FROM "TestCase" WHERE "ticketId" IN (
  SELECT t.id FROM "Ticket" t
  JOIN "Project" p ON p.id = t."projectId"
  WHERE p.key = 'DEMO'
);

-- 5. Tous les tickets DEMO (cascade sur TimeEntry, Attachment, children)
DELETE FROM "Ticket" WHERE "projectId" IN (
  SELECT id FROM "Project" WHERE key = 'DEMO'
);

-- Résumé
SELECT
  (SELECT COUNT(*) FROM "Ticket" t JOIN "Project" p ON p.id = t."projectId" WHERE p.key = 'DEMO') AS tickets_restants,
  (SELECT COUNT(*) FROM "Project" WHERE key = 'DEMO') AS projet_DEMO_conserve;

COMMIT;
