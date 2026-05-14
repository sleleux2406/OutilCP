-- Migration : correction de la formule RAF Feature gelée
--
-- Règle métier correcte :
--   Pour une Feature gelée (frozenAt IS NOT NULL) :
--     totalRemainingMinutes = GREATEST(snapshot + (Σ estim Tasks chiffrées ajoutées APRÈS gel) - loggé_total, 0)
--
--   Raison : toute Task ajoutée après le premier log est du travail non prévu
--   initialement, donc pure dérive. Son estimation vient s'ajouter au scope,
--   et le loggé vient réduire le RAF à mesure qu'il avance.
--
-- À exécuter via :
--   psql -U postgres -h localhost -d qa_platform -f prisma/migrations/20260518000000_feature_raf_fix/migration.sql

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
    t."frozenAt" AS root_frozen_at
  FROM "Ticket" t
),
aggregates AS (
  SELECT
    d.root_id,
    SUM(CASE WHEN d."isEstimated" THEN d."estimatedMinutes" ELSE 0 END) AS sum_estimated_all,
    SUM(CASE WHEN d."isEstimated" THEN d."loggedMinutes"    ELSE 0 END) AS sum_logged,
    SUM(CASE WHEN d."isEstimated" THEN d.effective_remaining ELSE 0 END) AS sum_remaining,
    COUNT(*) FILTER (WHERE d.type = 'USER_STORY') AS us_count,
    COUNT(*) FILTER (WHERE d.type = 'BUG')        AS bug_count,
    COUNT(*) FILTER (WHERE d.type = 'FEATURE')    AS feature_count,
    COUNT(*) FILTER (WHERE d.type = 'TASK')       AS task_count
  FROM descendants d
  GROUP BY d.root_id
),
frozen_extras AS (
  -- Pour chaque Feature gelée, on calcule la somme des estimations des Tasks/Bugs
  -- chiffrés créés APRÈS le gel (ajout de scope non prévu = dérive pure).
  SELECT
    ri.root_id,
    COALESCE(SUM(
      CASE WHEN c."isEstimated" AND c.type IN ('TASK', 'BUG') AND c."createdAt" > ri.root_frozen_at
        THEN c."estimatedMinutes"
        ELSE 0
      END
    ), 0) AS extra_estimated
  FROM root_info ri
  LEFT JOIN "Ticket" c ON c."parentId" = ri.root_id
  WHERE ri.root_type = 'FEATURE' AND ri.root_frozen_at IS NOT NULL
  GROUP BY ri.root_id
)
SELECT
  ri.root_id AS "ticketId",
  -- Estim totale (inchangée : snapshot si Feature gelée, sinon somme hybride)
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
  --   RAF = max(snapshot + extra_estimated - loggé_total, 0)
  --   extra_estimated = somme des estim des Tasks ajoutées après gel (scope non prévu)
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    WHEN ri.root_type = 'FEATURE' AND ri.root_frozen_at IS NOT NULL
      THEN GREATEST(
        ri.root_estimated_minutes + COALESCE(fe.extra_estimated, 0) - a.sum_logged,
        0
      )
    ELSE a.sum_remaining
  END::int AS "totalRemainingMinutes",
  -- Projection = logged + remaining
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    WHEN ri.root_type = 'FEATURE' AND ri.root_frozen_at IS NOT NULL
      THEN a.sum_logged + GREATEST(
        ri.root_estimated_minutes + COALESCE(fe.extra_estimated, 0) - a.sum_logged,
        0
      )
    ELSE (a.sum_logged + a.sum_remaining)
  END::int AS "totalProjectedMinutes",
  -- Variance = projected - estimated
  -- Pour une Feature gelée sans surconsommation : variance = extra_estimated (travail non prévu)
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    WHEN ri.root_type = 'FEATURE' AND ri.root_frozen_at IS NOT NULL
      THEN (
        a.sum_logged + GREATEST(
          ri.root_estimated_minutes + COALESCE(fe.extra_estimated, 0) - a.sum_logged,
          0
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
JOIN aggregates a ON a.root_id = ri.root_id
LEFT JOIN frozen_extras fe ON fe.root_id = ri.root_id;

COMMENT ON VIEW ticket_rollup IS
  'Roll-up corrigé : Feature gelée RAF = max(snapshot + extra_estimated - loggé, 0). Les Tasks ajoutées après gel sont pure dérive de scope.';
