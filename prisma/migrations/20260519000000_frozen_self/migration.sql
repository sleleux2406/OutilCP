-- Migration : ajout du champ frozenSelfMinutes sur Ticket
-- + nouvelle formule du RAF Feature gelée qui prend en compte le RAF
--   manuellement ajusté des Tasks enfants.
--
-- Règle métier :
--   RAF Feature gelée = max(frozenSelfMinutes - loggedFeaturePropre, 0)
--                     + Σ RAF effectif des Tasks chiffrées descendantes
--
--   - frozenSelfMinutes : capture au moment du gel = estim propre Feature
--     qui n'est pas couverte par les Tasks chiffrées
--   - loggedFeaturePropre : log directement sur la Feature (pas sur les Tasks)
--   - RAF effectif Task : remainingMinutes manuel si défini, sinon
--     fallback max(estim - logged, 0)
--
-- À exécuter via :
--   psql -U postgres -h localhost -d qa_platform -f prisma/migrations/20260519000000_frozen_self/migration.sql

-- 1. Ajouter le champ frozenSelfMinutes (nullable)
ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "frozenSelfMinutes" INTEGER NULL;

COMMENT ON COLUMN "Ticket"."frozenSelfMinutes" IS
  'Capture au gel d''une Feature : la fraction propre (estim Feature - somme estim Tasks au gel). Permet de calculer le RAF correctement quand le RAF des Tasks est ajusté manuellement.';

-- 2. Recréer la vue ticket_rollup avec la nouvelle formule
DROP VIEW IF EXISTS ticket_rollup;

CREATE VIEW ticket_rollup AS
WITH RECURSIVE descendants AS (
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
    t."isEstimated",
    t."createdAt",
    true AS is_root
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
    c."isEstimated",
    c."createdAt",
    false AS is_root
  FROM descendants d
  JOIN "Ticket" c ON c."parentId" = d.node_id
),
root_info AS (
  SELECT
    t.id AS root_id,
    t.type AS root_type,
    t."estimatedMinutes" AS root_estimated_minutes,
    t."loggedMinutes" AS root_logged_minutes,
    t."frozenAt" AS root_frozen_at,
    t."frozenSelfMinutes" AS root_frozen_self
  FROM "Ticket" t
),
aggregates AS (
  SELECT
    d.root_id,
    -- Somme classique (utilisée pour les non-Features et Features non gelées)
    SUM(CASE WHEN d."isEstimated" THEN d."estimatedMinutes" ELSE 0 END) AS sum_estimated_all,
    SUM(CASE WHEN d."isEstimated" THEN d."loggedMinutes"    ELSE 0 END) AS sum_logged,
    SUM(CASE WHEN d."isEstimated" THEN d.effective_remaining ELSE 0 END) AS sum_remaining,
    -- Somme des RAF effectifs des Tasks chiffrées descendantes (exclut le root lui-même)
    SUM(
      CASE
        WHEN d."isEstimated" AND d.is_root = false AND d.type IN ('TASK', 'BUG')
          THEN d.effective_remaining
        ELSE 0
      END
    ) AS sum_remaining_tasks_only,
    COUNT(*) FILTER (WHERE d.type = 'USER_STORY') AS us_count,
    COUNT(*) FILTER (WHERE d.type = 'BUG')        AS bug_count,
    COUNT(*) FILTER (WHERE d.type = 'FEATURE')    AS feature_count,
    COUNT(*) FILTER (WHERE d.type = 'TASK')       AS task_count
  FROM descendants d
  GROUP BY d.root_id
)
SELECT
  ri.root_id AS "ticketId",
  -- Estim totale : snapshot si Feature gelée, hybride sinon, 0 pour Epics
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    WHEN ri.root_type = 'FEATURE' AND ri.root_frozen_at IS NOT NULL
      THEN ri.root_estimated_minutes
    ELSE a.sum_estimated_all
  END::int AS "totalEstimatedMinutes",
  -- Logged total
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    ELSE a.sum_logged
  END::int AS "totalLoggedMinutes",
  -- RAF total — NOUVELLE FORMULE pour Feature gelée :
  --   RAF = max(frozenSelfMinutes - loggedFeaturePropre, 0)
  --       + Σ RAF effectif Tasks chiffrées descendantes
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    WHEN ri.root_type = 'FEATURE' AND ri.root_frozen_at IS NOT NULL
      THEN GREATEST(
        COALESCE(ri.root_frozen_self, 0) - ri.root_logged_minutes,
        0
      ) + a.sum_remaining_tasks_only
    ELSE a.sum_remaining
  END::int AS "totalRemainingMinutes",
  -- Projection = logged + remaining
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    WHEN ri.root_type = 'FEATURE' AND ri.root_frozen_at IS NOT NULL
      THEN a.sum_logged + (
        GREATEST(
          COALESCE(ri.root_frozen_self, 0) - ri.root_logged_minutes,
          0
        ) + a.sum_remaining_tasks_only
      )
    ELSE (a.sum_logged + a.sum_remaining)
  END::int AS "totalProjectedMinutes",
  -- Variance = projection - estim
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    WHEN ri.root_type = 'FEATURE' AND ri.root_frozen_at IS NOT NULL
      THEN (
        a.sum_logged + (
          GREATEST(
            COALESCE(ri.root_frozen_self, 0) - ri.root_logged_minutes,
            0
          ) + a.sum_remaining_tasks_only
        )
      ) - ri.root_estimated_minutes
    ELSE (a.sum_logged + a.sum_remaining - a.sum_estimated_all)
  END::int AS "varianceMinutes",
  a.us_count      AS "usCount",
  a.bug_count     AS "bugCount",
  a.feature_count AS "featureCount",
  a.task_count    AS "taskCount",
  -- Progression
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    WHEN (
      CASE
        WHEN ri.root_type = 'FEATURE' AND ri.root_frozen_at IS NOT NULL
          THEN ri.root_estimated_minutes
        ELSE a.sum_estimated_all
      END
    ) = 0 THEN 0
    ELSE ROUND(
      100.0 * a.sum_logged /
      NULLIF(
        CASE
          WHEN ri.root_type = 'FEATURE' AND ri.root_frozen_at IS NOT NULL
            THEN ri.root_estimated_minutes
          ELSE a.sum_estimated_all
        END,
        0
      ),
      1
    )
  END AS "progressPercent"
FROM root_info ri
JOIN aggregates a ON a.root_id = ri.root_id;

COMMENT ON VIEW ticket_rollup IS
  'Roll-up : Feature gelée RAF = max(frozenSelf - loggedPropre, 0) + Σ RAF Tasks chiffrées. Prend en compte les RAF ajustés manuellement.';
