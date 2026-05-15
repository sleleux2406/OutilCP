-- Migration : etendre la logique de rollup et de gel aux Bug containers.
--
-- Un Bug est en mode "container" quand il a >= 1 Task enfant CHIFFREE
-- (isEstimated=true). Dans ce mode :
--   - L'estim totale est calculee comme la somme propre + descendants chiffres
--     (logique hybride identique a la Feature)
--   - Si frozenAt est non-null, on utilise frozenSelfMinutes pour figer la part propre
--   - Le RAF propre est calcule comme pour la Feature gelee (max(frozen-logged, 0))
--
-- Si le Bug n'a pas de Task enfant chiffree, il reste en mode "feuille" :
--   - estim = estimatedMinutes propre
--   - RAF = max(estimatedMinutes - loggedMinutes, 0)
--
-- A executer via :
--   psql -U postgres -h localhost -d qa_platform -f prisma/migrations/20260522000000_bug_container_rollup/migration.sql

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
-- NOUVEAU : determine pour chaque root si c'est un container
-- FEATURE : container si elle a >= 1 enfant Task ou Bug (logique historique)
-- BUG : container si il a >= 1 Task enfant CHIFFREE (nouvelle regle Lot C1)
-- Autres types : jamais container
container_status AS (
  SELECT
    ri.root_id,
    CASE
      WHEN ri.root_type = 'FEATURE' THEN
        EXISTS (
          SELECT 1 FROM "Ticket" c
          WHERE c."parentId" = ri.root_id
            AND c.type IN ('TASK', 'BUG')
        )
      WHEN ri.root_type = 'BUG' THEN
        EXISTS (
          SELECT 1 FROM "Ticket" c
          WHERE c."parentId" = ri.root_id
            AND c.type = 'TASK'
            AND c."isEstimated" = true
        )
      ELSE false
    END AS is_container
  FROM root_info ri
),
aggregates AS (
  SELECT
    d.root_id,
    SUM(CASE WHEN d."isEstimated" THEN d."estimatedMinutes" ELSE 0 END) AS sum_estimated_all,
    SUM(CASE WHEN d."isEstimated" THEN d."loggedMinutes"    ELSE 0 END) AS sum_logged,
    SUM(CASE WHEN d."isEstimated" THEN d.effective_remaining ELSE 0 END) AS sum_remaining_all,
    -- RAF des Tasks/Bugs chiffres descendants (exclut le root lui-meme)
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
    -- RAF propre du ticket lui-meme
    CASE
      WHEN ri.root_type = 'EPIC' THEN 0
      WHEN cs.is_container = true AND ri.root_frozen_at IS NOT NULL
        -- Container gele (Feature OU Bug) : on utilise la fraction propre capturee au gel
        THEN GREATEST(
          COALESCE(ri.root_frozen_self, 0) - ri.root_logged_minutes,
          0
        )
      WHEN cs.is_container = true AND ri.root_frozen_at IS NULL
        -- Container non gele : RAF propre = fallback classique sur le ticket racine
        THEN COALESCE(
          ri.root_remaining_minutes,
          GREATEST(ri.root_estimated_minutes - ri.root_logged_minutes, 0)
        )
      ELSE
        -- Mode feuille (US, Task, Bug sans Task chiffree, Feature sans enfants) :
        -- leur RAF propre = leur RAF effectif simple
        COALESCE(
          ri.root_remaining_minutes,
          GREATEST(ri.root_estimated_minutes - ri.root_logged_minutes, 0)
        )
    END AS raf_self,
    -- RAF des enfants (Tasks/Bugs chiffres descendants)
    CASE
      WHEN ri.root_type = 'EPIC' THEN 0
      ELSE a.sum_remaining_children
    END AS raf_children
  FROM root_info ri
  JOIN aggregates a ON a.root_id = ri.root_id
  JOIN container_status cs ON cs.root_id = ri.root_id
)
SELECT
  ri.root_id AS "ticketId",
  -- Estim totale : si container gele, on utilise l'estim figee a la base ;
  -- sinon, somme propre + descendants chiffres (mode hybride par defaut)
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    WHEN cs.is_container = true AND ri.root_frozen_at IS NOT NULL
      THEN ri.root_estimated_minutes
    ELSE a.sum_estimated_all
  END::int AS "totalEstimatedMinutes",
  -- Logged total
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    ELSE a.sum_logged
  END::int AS "totalLoggedMinutes",
  -- RAF propre et RAF enfants separes
  rc.raf_self::int AS "totalRemainingSelfMinutes",
  rc.raf_children::int AS "totalRemainingChildrenMinutes",
  -- RAF total = somme des deux
  (rc.raf_self + rc.raf_children)::int AS "totalRemainingMinutes",
  -- Projection = logged + remaining
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    ELSE a.sum_logged + (rc.raf_self + rc.raf_children)
  END::int AS "totalProjectedMinutes",
  -- Variance = projection - estim
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    WHEN cs.is_container = true AND ri.root_frozen_at IS NOT NULL
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
        WHEN cs.is_container = true AND ri.root_frozen_at IS NOT NULL
          THEN ri.root_estimated_minutes
        ELSE a.sum_estimated_all
      END
    ) = 0 THEN 0
    ELSE ROUND(
      100.0 * a.sum_logged /
      NULLIF(
        CASE
          WHEN cs.is_container = true AND ri.root_frozen_at IS NOT NULL
            THEN ri.root_estimated_minutes
          ELSE a.sum_estimated_all
        END,
        0
      ),
      1
    )
  END AS "progressPercent",
  -- NOUVEAU : expose le mode container pour faciliter la decision cote app
  cs.is_container AS "isContainer"
FROM root_info ri
JOIN aggregates a ON a.root_id = ri.root_id
JOIN remaining_calc rc ON rc.root_id = ri.root_id
JOIN container_status cs ON cs.root_id = ri.root_id;

COMMENT ON VIEW ticket_rollup IS
  'Roll-up : RAF total decompose en RAF propre + RAF enfants. La regle de gel s''applique aux containers (Feature avec Task/Bug, OU Bug avec Task chiffree).';
