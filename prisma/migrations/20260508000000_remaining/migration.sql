-- Migration : ajout de remainingMinutes + mise à jour vue ticket_rollup
-- À exécuter dans Codespaces via :
--   psql -U postgres -h localhost -d qa_platform -f prisma/migrations/20260508000000_remaining/migration.sql

-- ─── 1. Ajouter la colonne remainingMinutes ──────────────────
ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "remainingMinutes" INTEGER NULL;

-- Contrainte : si défini, doit être >= 0
ALTER TABLE "Ticket"
  DROP CONSTRAINT IF EXISTS ticket_remaining_non_negative;
ALTER TABLE "Ticket"
  ADD CONSTRAINT ticket_remaining_non_negative
  CHECK ("remainingMinutes" IS NULL OR "remainingMinutes" >= 0);

-- ─── 2. Mettre à jour la vue ticket_rollup ──────────────────
-- La vue expose désormais :
--   totalEstimatedMinutes : estimation initiale (soi + descendants)
--   totalLoggedMinutes    : temps loggé
--   totalRemainingMinutes : reste à faire (si remainingMinutes est NULL, on
--                           utilise max(estimated - logged, 0) pour la feuille)
--   totalProjectedMinutes : loggé + reste → effort total anticipé
--   varianceMinutes       : projected - estimated → positif = dépassement

-- On DROP la vue existante : CREATE OR REPLACE VIEW ne peut pas changer l'ordre
-- des colonnes, et on insère de nouveaux champs au milieu.
DROP VIEW IF EXISTS ticket_rollup;

CREATE VIEW ticket_rollup AS
WITH RECURSIVE descendants AS (
  SELECT
    t.id AS root_id,
    t.id AS node_id,
    t."estimatedMinutes",
    t."loggedMinutes",
    -- Valeur effective du reste : saisie manuelle OU fallback (estimation - loggé, min 0)
    COALESCE(
      t."remainingMinutes",
      GREATEST(t."estimatedMinutes" - t."loggedMinutes", 0)
    ) AS effective_remaining,
    t.type
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
    c.type
  FROM descendants d
  JOIN "Ticket" c ON c."parentId" = d.node_id
)
SELECT
  d.root_id AS "ticketId",
  SUM(d."estimatedMinutes")::int        AS "totalEstimatedMinutes",
  SUM(d."loggedMinutes")::int           AS "totalLoggedMinutes",
  SUM(d.effective_remaining)::int       AS "totalRemainingMinutes",
  (SUM(d."loggedMinutes") + SUM(d.effective_remaining))::int AS "totalProjectedMinutes",
  (SUM(d."loggedMinutes") + SUM(d.effective_remaining) - SUM(d."estimatedMinutes"))::int AS "varianceMinutes",
  COUNT(*) FILTER (WHERE d.type = 'USER_STORY') AS "usCount",
  COUNT(*) FILTER (WHERE d.type = 'BUG')        AS "bugCount",
  COUNT(*) FILTER (WHERE d.type = 'FEATURE')    AS "featureCount",
  COUNT(*) FILTER (WHERE d.type = 'TASK')       AS "taskCount",
  CASE
    WHEN SUM(d."estimatedMinutes") = 0 THEN 0
    ELSE ROUND(
      100.0 * SUM(d."loggedMinutes") / NULLIF(SUM(d."estimatedMinutes"), 0),
      1
    )
  END AS "progressPercent"
FROM descendants d
GROUP BY d.root_id;

COMMENT ON VIEW ticket_rollup IS
  'Roll-up récursif : pour chaque ticket, agrège temps estimé initial, temps loggé, reste à faire (avec fallback), projection totale (loggé+reste) et variance vs estimation initiale. Le coût a été supprimé.';
