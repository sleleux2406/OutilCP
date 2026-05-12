-- Migration : exclure les Epics du calcul de temps (estimation, log, RAF, dépassement)
-- Les Epics ne servent qu'à trier la spec fonctionnelle.
--
-- À exécuter via :
--   psql -U postgres -h localhost -d qa_platform -f prisma/migrations/20260515000000_epic_no_time/migration.sql

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
    false AS is_root
  FROM descendants d
  JOIN "Ticket" c ON c."parentId" = d.node_id
),
root_info AS (
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
    SUM(CASE WHEN d."isEstimated" THEN d."estimatedMinutes" ELSE 0 END) AS sum_estimated_all,
    SUM(CASE WHEN d."isEstimated" THEN d."loggedMinutes"    ELSE 0 END) AS sum_logged,
    SUM(CASE WHEN d."isEstimated" THEN d.effective_remaining ELSE 0 END) AS sum_remaining,
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
  -- RÈGLE :
  --   - Epic : 0 (les Epics ne gèrent pas de temps)
  --   - Feature avec log subtree : estimation gelée à la valeur propre
  --   - Autres : somme classique node + descendants chiffrés
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    WHEN ri.root_type = 'FEATURE' AND a.total_logged_subtree > 0
      THEN ri.root_estimated_minutes
    ELSE a.sum_estimated_all
  END::int AS "totalEstimatedMinutes",
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    ELSE a.sum_logged
  END::int AS "totalLoggedMinutes",
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    ELSE a.sum_remaining
  END::int AS "totalRemainingMinutes",
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    ELSE (a.sum_logged + a.sum_remaining)
  END::int AS "totalProjectedMinutes",
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
    ELSE (
      a.sum_logged + a.sum_remaining -
      CASE
        WHEN ri.root_type = 'FEATURE' AND a.total_logged_subtree > 0
          THEN ri.root_estimated_minutes
        ELSE a.sum_estimated_all
      END
    )
  END::int AS "varianceMinutes",
  a.us_count      AS "usCount",
  a.bug_count     AS "bugCount",
  a.feature_count AS "featureCount",
  a.task_count    AS "taskCount",
  CASE
    WHEN ri.root_type = 'EPIC' THEN 0
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
  'Roll-up : Epics retournent 0 partout. Features : gel de l''estimation initiale dès que du log apparaît dans leur sous-arbre. Tâches TODO (isEstimated=false) exclues des sommes.';
