-- Migration : exposer le RAF "propre Feature" et le RAF "enfants" séparément
-- en plus du RAF global.
--
-- Règle métier :
--   - totalRemainingSelfMinutes : RAF de la Feature elle-même (hors enfants)
--     = max(frozenSelfMinutes - loggedPropre, 0) si gelée
--     = ce qui reste à la Feature seule, sans agrégation
--   - totalRemainingChildrenMinutes : Σ RAF effectif des Tasks/Bugs descendantes chiffrées
--   - totalRemainingMinutes : somme des deux (compatibilité existante)
--
-- À exécuter via :
--   psql -U postgres -h localhost -d qa_platform -f prisma/migrations/20260520000000_remaining_split/migration.sql

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
    t."remainingMinutes" AS root_remaining_minutes,
    t."frozenAt" AS root_frozen_at,
    t."frozenSelfMinutes" AS root_frozen_self
  FROM "Ticket" t
),
aggregates AS (
  SELECT
    d.root_id,
    SUM(CASE WHEN d."isEstimated" THEN d."estimatedMinutes" ELSE 0 END) AS sum_estimated_all,
    SUM(CASE WHEN d."isEstimated" THEN d."loggedMinutes"    ELSE 0 END) AS sum_logged,
    SUM(CASE WHEN d."isEstimated" THEN d.effective_remaining ELSE 0 END) AS sum_remaining_all,
    -- RAF des Tasks/Bugs chiffrés descendants (exclut le root lui-même)
    SUM(
      CASE
        WHEN d."isEstimated" AND d.is_root = false AND d.type IN ('TASK', 'BUG')
          THEN d.effective_remaining
        ELSE 0
      END
    ) AS sum_remaining_children,
    COUNT(*) FILTER (WHERE d.type = 'USER_STORY') AS us_count,
    COUNT(*) FILTER (WHERE d.type = 'BUG')        AS bug_count,
    COUNT(*) FILTER (WHERE d.type = 'FEATURE')    AS feature_count,
    COUNT(*) FILTER (WHERE d.type = 'TASK')       AS task_count
  FROM descendants d
  GROUP BY d.root_id
),
remaining_calc AS (
  -- Calcul du RAF propre et RAF enfants pour chaque ticket racine
  SELECT
    ri.root_id,
    -- RAF propre du ticket lui-même
    CASE
      WHEN ri.root_type = 'EPIC' THEN 0
      WHEN ri.root_type = 'FEATURE' AND ri.root_frozen_at IS NOT NULL
        -- Feature gelée : on utilise la fraction propre capturée au gel
        THEN GREATEST(
          COALESCE(ri.root_frozen_self, 0) - ri.root_logged_minutes,
          0
        )
      WHEN ri.root_type = 'FEATURE' AND ri.root_frozen_at IS NULL
        -- Feature non gelée : RAF propre = fallback classique sur la Feature
        THEN COALESCE(
          ri.root_remaining_minutes,
          GREATEST(ri.root_estimated_minutes - ri.root_logged_minutes, 0)
        )
      ELSE
        -- Autres types (US, Task, Bug) : leur RAF propre = leur RAF effectif
        COALESCE(
          ri.root_remaining_minutes,
          GREATEST(ri.root_estimated_minutes - ri.root_logged_minutes, 0)
        )
    END AS raf_self,
    -- RAF des enfants (Tasks/Bugs chiffrés descendants)
    CASE
      WHEN ri.root_type = 'EPIC' THEN 0
      ELSE a.sum_remaining_children
    END AS raf_children
  FROM root_info ri
  JOIN aggregates a ON a.root_id = ri.root_id
)
SELECT
  ri.root_id AS "ticketId",
  -- Estim totale
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
  -- NOUVEAUX CHAMPS : RAF propre et RAF enfants séparés
  rc.raf_self::int AS "totalRemainingSelfMinutes",
  rc.raf_children::int AS "totalRemainingChildrenMinutes",
  -- RAF total = somme des deux (compatibilité)
  (rc.raf_self + rc.raf_children)::int AS "totalRemainingMinutes",
  -- Projection = logged + remaining
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    ELSE a.sum_logged + (rc.raf_self + rc.raf_children)
  END::int AS "totalProjectedMinutes",
  -- Variance = projection - estim
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    WHEN ri.root_type = 'FEATURE' AND ri.root_frozen_at IS NOT NULL
      THEN (a.sum_logged + rc.raf_self + rc.raf_children) - ri.root_estimated_minutes
    ELSE (a.sum_logged + rc.raf_self + rc.raf_children - a.sum_estimated_all)
  END::int AS "varianceMinutes",
  a.us_count      AS "usCount",
  a.bug_count     AS "bugCount",
  a.feature_count AS "featureCount",
  a.task_count    AS "taskCount",
  -- Progression = logged / estim
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
JOIN aggregates a ON a.root_id = ri.root_id
JOIN remaining_calc rc ON rc.root_id = ri.root_id;

COMMENT ON VIEW ticket_rollup IS
  'Roll-up : RAF total décomposé en RAF propre (totalRemainingSelfMinutes) et RAF enfants (totalRemainingChildrenMinutes). totalRemainingMinutes = somme des deux.';
