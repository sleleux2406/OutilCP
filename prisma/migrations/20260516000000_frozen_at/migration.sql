-- Migration : utiliser frozenAt pour le calcul du RAF Feature gelée
-- + créer le champ frozenAt s'il n'existe pas encore
--
-- À exécuter via :
--   psql -U postgres -h localhost -d qa_platform -f prisma/migrations/20260516000000_frozen_at/migration.sql

-- 1. Ajouter le champ frozenAt (si pas déjà fait)
ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "frozenAt" TIMESTAMP(3) NULL;

COMMENT ON COLUMN "Ticket"."frozenAt" IS
  'Horodatage du premier log dans le sous-arbre d''une Feature. NULL = pas encore gelée.';

-- 2. Recréer la vue ticket_rollup avec la logique frozenAt
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
  -- Info sur chaque root : type, estim propre, frozenAt propre
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
    -- Sommes classiques (utilisées quand pas de gel)
    SUM(CASE WHEN d."isEstimated" THEN d."estimatedMinutes" ELSE 0 END) AS sum_estimated_all,
    SUM(CASE WHEN d."isEstimated" THEN d."loggedMinutes"    ELSE 0 END) AS sum_logged,
    SUM(CASE WHEN d."isEstimated" THEN d.effective_remaining ELSE 0 END) AS sum_remaining,
    -- Comptages
    COUNT(*) FILTER (WHERE d.type = 'USER_STORY') AS us_count,
    COUNT(*) FILTER (WHERE d.type = 'BUG')        AS bug_count,
    COUNT(*) FILTER (WHERE d.type = 'FEATURE')    AS feature_count,
    COUNT(*) FILTER (WHERE d.type = 'TASK')       AS task_count
  FROM descendants d
  GROUP BY d.root_id
),
frozen_extras AS (
  -- Pour chaque Feature gelée, on calcule la somme des RAF effectifs des
  -- Tasks/Bugs enfants directs chiffrés créés APRÈS le gel (frozenAt).
  -- Ces valeurs ne sont pas incluses dans le snapshot, elles ajoutent du RAF.
  SELECT
    ri.root_id,
    COALESCE(SUM(
      CASE WHEN c."isEstimated" AND c.type IN ('TASK', 'BUG') AND c."createdAt" > ri.root_frozen_at
        THEN COALESCE(c."remainingMinutes", GREATEST(c."estimatedMinutes" - c."loggedMinutes", 0))
        ELSE 0
      END
    ), 0) AS extra_remaining,
    COALESCE(SUM(
      CASE WHEN c."isEstimated" AND c.type IN ('TASK', 'BUG') AND c."createdAt" > ri.root_frozen_at
        THEN c."loggedMinutes"
        ELSE 0
      END
    ), 0) AS extra_logged
  FROM root_info ri
  LEFT JOIN "Ticket" c ON c."parentId" = ri.root_id
  WHERE ri.root_type = 'FEATURE' AND ri.root_frozen_at IS NOT NULL
  GROUP BY ri.root_id
)
SELECT
  ri.root_id AS "ticketId",
  -- Estim totale
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    WHEN ri.root_type = 'FEATURE' AND ri.root_frozen_at IS NOT NULL
      THEN ri.root_estimated_minutes  -- snapshot figé
    ELSE a.sum_estimated_all           -- hybride classique
  END::int AS "totalEstimatedMinutes",
  -- Logged total (toujours somme réelle)
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    ELSE a.sum_logged
  END::int AS "totalLoggedMinutes",
  -- RAF total
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    WHEN ri.root_type = 'FEATURE' AND ri.root_frozen_at IS NOT NULL
      -- Feature gelée : RAF = (estim gelée - loggé du périmètre initial, borné à 0) + RAF des Tasks ajoutées après
      -- Approximation : loggé du périmètre initial ≈ loggé total - loggé extra
      THEN GREATEST(
        ri.root_estimated_minutes - (a.sum_logged - COALESCE(fe.extra_logged, 0)),
        0
      ) + COALESCE(fe.extra_remaining, 0)
    ELSE a.sum_remaining  -- hybride classique
  END::int AS "totalRemainingMinutes",
  -- Projection = logged + remaining (reconstruction)
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    WHEN ri.root_type = 'FEATURE' AND ri.root_frozen_at IS NOT NULL
      THEN a.sum_logged + (
        GREATEST(
          ri.root_estimated_minutes - (a.sum_logged - COALESCE(fe.extra_logged, 0)),
          0
        ) + COALESCE(fe.extra_remaining, 0)
      )
    ELSE (a.sum_logged + a.sum_remaining)
  END::int AS "totalProjectedMinutes",
  -- Variance = projected - estimated
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    WHEN ri.root_type = 'FEATURE' AND ri.root_frozen_at IS NOT NULL
      THEN (
        a.sum_logged + (
          GREATEST(
            ri.root_estimated_minutes - (a.sum_logged - COALESCE(fe.extra_logged, 0)),
            0
          ) + COALESCE(fe.extra_remaining, 0)
        )
      ) - ri.root_estimated_minutes
    ELSE (a.sum_logged + a.sum_remaining - a.sum_estimated_all)
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
LEFT JOIN frozen_extras fe ON fe.root_id = ri.root_id;

COMMENT ON VIEW ticket_rollup IS
  'Roll-up : Epics = 0. Features : gel au premier log (frozenAt). RAF post-gel = max(snapshot - loggé initial, 0) + RAF Tasks ajoutées après. TODO (isEstimated=false) exclues.';
