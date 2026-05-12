-- Migration : vue ticket_rollup avec règle de "gel" de l'estimation initiale
-- sur les Features.
--
-- Règle métier :
--   - Pour une Feature : si du temps a été loggé quelque part dans son
--     sous-arbre (elle-même ou descendants), l'estimation initiale est
--     GELÉE à la valeur propre du node Feature. Les Tasks ajoutées
--     après ne gonflent plus l'estim initial mais impactent le RAF et
--     l'atterrissage, rendant un éventuel dépassement visible.
--   - Pour les autres types (Epic, US, Task, Bug) : comportement classique
--     (somme node + descendants).
--   - Les tickets TODO (isEstimated=false) sont toujours exclus des sommes.
--
-- À exécuter via :
--   psql -U postgres -h localhost -d qa_platform -f prisma/migrations/20260514000000_frozen_feature_estim/migration.sql

DROP VIEW IF EXISTS ticket_rollup;

CREATE VIEW ticket_rollup AS
WITH RECURSIVE descendants AS (
  -- Cas de base : chaque ticket est son propre descendant
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
    -- Flag : ce node est-il le root lui-même ?
    -- (pour récupérer la valeur propre du root dans l'agrégation)
    true AS is_root
  FROM "Ticket" t

  UNION ALL

  -- Récursion : descente dans l'arbre
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
    false AS is_root
  FROM descendants d
  JOIN "Ticket" c ON c."parentId" = d.node_id
),
root_info AS (
  -- Info sur le root uniquement : son type et son estimation propre
  SELECT
    root_id,
    type AS root_type,
    "estimatedMinutes" AS root_estimated_minutes
  FROM descendants
  WHERE is_root = true
),
aggregates AS (
  SELECT
    d.root_id,
    -- Somme classique de tous les descendants chiffrés (utilisée pour les non-Feature)
    SUM(CASE WHEN d."isEstimated" THEN d."estimatedMinutes" ELSE 0 END) AS sum_estimated_all,
    SUM(CASE WHEN d."isEstimated" THEN d."loggedMinutes"    ELSE 0 END) AS sum_logged,
    SUM(CASE WHEN d."isEstimated" THEN d.effective_remaining ELSE 0 END) AS sum_remaining,
    -- Indicateur : y a-t-il du log dans tout le sous-arbre ?
    SUM(d."loggedMinutes") AS total_logged_subtree,
    COUNT(*) FILTER (WHERE d.type = 'USER_STORY') AS us_count,
    COUNT(*) FILTER (WHERE d.type = 'BUG')        AS bug_count,
    COUNT(*) FILTER (WHERE d.type = 'FEATURE')    AS feature_count,
    COUNT(*) FILTER (WHERE d.type = 'TASK')       AS task_count
  FROM descendants d
  GROUP BY d.root_id
)
SELECT
  r.root_id AS "ticketId",
  -- RÈGLE CLÉ : pour une Feature avec du log dans son sous-arbre,
  -- on fige l'estimation à sa valeur propre (l'historique reste intact).
  -- Sinon, comportement classique = somme node + descendants.
  CASE
    WHEN ri.root_type = 'FEATURE' AND a.total_logged_subtree > 0
      THEN ri.root_estimated_minutes
    ELSE a.sum_estimated_all
  END::int AS "totalEstimatedMinutes",
  a.sum_logged::int AS "totalLoggedMinutes",
  a.sum_remaining::int AS "totalRemainingMinutes",
  (a.sum_logged + a.sum_remaining)::int AS "totalProjectedMinutes",
  -- Variance = projection - estimation (après gel éventuel)
  (
    a.sum_logged + a.sum_remaining -
    CASE
      WHEN ri.root_type = 'FEATURE' AND a.total_logged_subtree > 0
        THEN ri.root_estimated_minutes
      ELSE a.sum_estimated_all
    END
  )::int AS "varianceMinutes",
  a.us_count      AS "usCount",
  a.bug_count     AS "bugCount",
  a.feature_count AS "featureCount",
  a.task_count    AS "taskCount",
  CASE
    WHEN (
      CASE
        WHEN ri.root_type = 'FEATURE' AND a.total_logged_subtree > 0
          THEN ri.root_estimated_minutes
        ELSE a.sum_estimated_all
      END
    ) = 0 THEN 0
    ELSE ROUND(
      100.0 * a.sum_logged /
      NULLIF(
        CASE
          WHEN ri.root_type = 'FEATURE' AND a.total_logged_subtree > 0
            THEN ri.root_estimated_minutes
          ELSE a.sum_estimated_all
        END,
        0
      ),
      1
    )
  END AS "progressPercent"
FROM root_info r
JOIN aggregates a ON a.root_id = r.root_id
JOIN root_info ri ON ri.root_id = r.root_id;

COMMENT ON VIEW ticket_rollup IS
  'Roll-up avec gel de l''estimation initiale des Features dès qu''un log apparaît dans leur sous-arbre. Les tâches TODO (isEstimated=false) sont exclues des sommes. Permet de détecter visuellement les dépassements (atterrissage > estim gelée).';
