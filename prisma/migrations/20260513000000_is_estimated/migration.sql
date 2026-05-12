-- Migration : ajout du flag isEstimated sur Ticket
-- + mise à jour de la vue ticket_rollup pour ignorer les tickets non chiffrés
-- dans les sommes (TODO n'impactent pas l'atterrissage du parent).
--
-- À exécuter via :
--   psql -U postgres -h localhost -d qa_platform -f prisma/migrations/20260513000000_is_estimated/migration.sql

-- 1. Ajouter la colonne avec une valeur par défaut = true
ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "isEstimated" BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN "Ticket"."isEstimated" IS
  'Si false : tâche de type TODO, ne compte PAS dans l''agrégation parent';

-- 2. Recréer la vue ticket_rollup avec le filtre
DROP VIEW IF EXISTS ticket_rollup;

CREATE VIEW ticket_rollup AS
WITH RECURSIVE descendants AS (
  -- Cas de base : chaque ticket est son propre descendant (niveau 0)
  -- On conserve le flag isEstimated pour filtrer au moment du SUM
  SELECT
    t.id AS root_id,
    t.id AS node_id,
    t."estimatedMinutes",
    t."loggedMinutes",
    COALESCE(
      t."remainingMinutes",
      GREATEST(t."estimatedMinutes" - t."loggedMinutes", 0)
    ) AS effective_remaining,
    t.type,
    t."isEstimated"
  FROM "Ticket" t

  UNION ALL

  SELECT
    d.root_id,
    c.id,
    c."estimatedMinutes",
    c."loggedMinutes",
    COALESCE(
      c."remainingMinutes",
      GREATEST(c."estimatedMinutes" - c."loggedMinutes", 0)
    ),
    c.type,
    c."isEstimated"
  FROM descendants d
  JOIN "Ticket" c ON c."parentId" = d.node_id
)
SELECT
  d.root_id AS "ticketId",
  -- Les SUM filtrent : seuls les tickets chiffrés contribuent.
  -- Le ticket racine lui-même est toujours inclus (d.node_id = d.root_id)
  -- car isEstimated=true par défaut pour tous les existants.
  SUM(CASE WHEN d."isEstimated" THEN d."estimatedMinutes" ELSE 0 END)::int AS "totalEstimatedMinutes",
  SUM(CASE WHEN d."isEstimated" THEN d."loggedMinutes"    ELSE 0 END)::int AS "totalLoggedMinutes",
  SUM(CASE WHEN d."isEstimated" THEN d.effective_remaining ELSE 0 END)::int AS "totalRemainingMinutes",
  (
    SUM(CASE WHEN d."isEstimated" THEN d."loggedMinutes"    ELSE 0 END)
    + SUM(CASE WHEN d."isEstimated" THEN d.effective_remaining ELSE 0 END)
  )::int AS "totalProjectedMinutes",
  (
    SUM(CASE WHEN d."isEstimated" THEN d."loggedMinutes"    ELSE 0 END)
    + SUM(CASE WHEN d."isEstimated" THEN d.effective_remaining ELSE 0 END)
    - SUM(CASE WHEN d."isEstimated" THEN d."estimatedMinutes" ELSE 0 END)
  )::int AS "varianceMinutes",
  COUNT(*) FILTER (WHERE d.type = 'USER_STORY') AS "usCount",
  COUNT(*) FILTER (WHERE d.type = 'BUG')        AS "bugCount",
  COUNT(*) FILTER (WHERE d.type = 'FEATURE')    AS "featureCount",
  COUNT(*) FILTER (WHERE d.type = 'TASK')       AS "taskCount",
  CASE
    WHEN SUM(CASE WHEN d."isEstimated" THEN d."estimatedMinutes" ELSE 0 END) = 0 THEN 0
    ELSE ROUND(
      100.0 * SUM(CASE WHEN d."isEstimated" THEN d."loggedMinutes" ELSE 0 END)
        / NULLIF(SUM(CASE WHEN d."isEstimated" THEN d."estimatedMinutes" ELSE 0 END), 0),
      1
    )
  END AS "progressPercent"
FROM descendants d
GROUP BY d.root_id;

COMMENT ON VIEW ticket_rollup IS
  'Roll-up récursif filtré : SUM des tickets chiffrés (isEstimated=true) uniquement. Les TODO sont ignorées des totaux mais visibles dans les comptages.';
