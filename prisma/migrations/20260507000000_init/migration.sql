-- ─────────────────────────────────────────────────────────────
-- Migration initiale : contraintes d'intégrité + vue rollup
-- ─────────────────────────────────────────────────────────────
-- Note : ce fichier est appliqué APRÈS le SQL généré par Prisma
-- (prisma migrate dev crée automatiquement la partie CREATE TABLE
--  à partir de schema.prisma ; on ajoute ici les éléments non
--  exprimables en Prisma : CHECK constraints + vues SQL).
--
-- Pour une première installation :
--   1. pnpm prisma migrate dev --name init --create-only
--   2. Coller le contenu ci-dessous à la fin de migration.sql
--   3. pnpm prisma migrate dev
-- ─────────────────────────────────────────────────────────────

-- ─── Contraintes d'intégrité ───────────────────────────────────

-- Un KO sans commentaire est interdit (exigence métier + OWASP A04)
ALTER TABLE "TestExecution"
  ADD CONSTRAINT ko_requires_comment
  CHECK (
    result <> 'KO'
    OR (comment IS NOT NULL AND length(trim(comment)) > 0)
  );

-- Priorité bornée entre 1 et 5
ALTER TABLE "Ticket"
  ADD CONSTRAINT ticket_priority_range
  CHECK (priority BETWEEN 1 AND 5);

-- Les minutes ne peuvent pas être négatives
ALTER TABLE "Ticket"
  ADD CONSTRAINT ticket_minutes_non_negative
  CHECK ("estimatedMinutes" >= 0 AND "loggedMinutes" >= 0);

ALTER TABLE "TimeEntry"
  ADD CONSTRAINT time_entry_minutes_positive
  CHECK (minutes > 0 AND minutes <= 1440);  -- max 24h par entrée

-- Taux horaire non négatif
ALTER TABLE "User"
  ADD CONSTRAINT user_hourly_rate_non_negative
  CHECK ("hourlyRateCents" >= 0);

-- Un ticket ne peut pas être son propre parent
ALTER TABLE "Ticket"
  ADD CONSTRAINT ticket_no_self_parent
  CHECK ("parentId" IS NULL OR "parentId" <> id);

-- ─── Vue récursive : Roll-up temps + coût ──────────────────────
-- Pour chaque ticket, agrège :
--   - temps estimé total (lui + tous ses descendants)
--   - temps loggé total
--   - coût loggé total (minutes × taux horaire de l'auteur)
--   - progression %
--   - comptage des types d'enfants (US, Bug, Feature)
--
-- Perf : la récursion exploite l'index ("parentId").
-- Pour un projet > 10k tickets, matérialiser cette vue
-- (MATERIALIZED VIEW + REFRESH périodique ou via trigger).

CREATE OR REPLACE VIEW ticket_rollup AS
WITH RECURSIVE descendants AS (
  -- Cas de base : chaque ticket est son propre descendant (niveau 0)
  SELECT
    t.id AS root_id,
    t.id AS node_id,
    t."estimatedMinutes",
    t."loggedMinutes",
    t.type
  FROM "Ticket" t

  UNION ALL

  -- Récursion : descendre dans la hiérarchie
  SELECT
    d.root_id,
    c.id,
    c."estimatedMinutes",
    c."loggedMinutes",
    c.type
  FROM descendants d
  JOIN "Ticket" c ON c."parentId" = d.node_id
),
logged_cost AS (
  -- Coût réel : minutes × taux horaire de l'auteur du time entry
  SELECT
    d.root_id,
    COALESCE(SUM(te.minutes * u."hourlyRateCents" / 60.0), 0)::bigint AS cost_cents
  FROM descendants d
  JOIN "TimeEntry" te ON te."ticketId" = d.node_id
  JOIN "User" u ON u.id = te."userId"
  GROUP BY d.root_id
)
SELECT
  d.root_id AS "ticketId",
  SUM(d."estimatedMinutes")::int AS "totalEstimatedMinutes",
  SUM(d."loggedMinutes")::int    AS "totalLoggedMinutes",
  COUNT(*) FILTER (WHERE d.type = 'USER_STORY') AS "usCount",
  COUNT(*) FILTER (WHERE d.type = 'BUG')        AS "bugCount",
  COUNT(*) FILTER (WHERE d.type = 'FEATURE')    AS "featureCount",
  COUNT(*) FILTER (WHERE d.type = 'TASK')       AS "taskCount",
  COALESCE(lc.cost_cents, 0) AS "totalCostCents",
  CASE
    WHEN SUM(d."estimatedMinutes") = 0 THEN 0
    ELSE ROUND(
      100.0 * SUM(d."loggedMinutes") / NULLIF(SUM(d."estimatedMinutes"), 0),
      1
    )
  END AS "progressPercent"
FROM descendants d
LEFT JOIN logged_cost lc ON lc.root_id = d.root_id
GROUP BY d.root_id, lc.cost_cents;

COMMENT ON VIEW ticket_rollup IS
  'Roll-up récursif : pour chaque ticket, agrège temps estimé, temps loggé, coût et progression sur lui + tous ses descendants.';

-- ─── Index fonctionnel pour les recherches par path ────────────
-- Permet des requêtes rapides "tous les descendants de ce ticket"
-- via LIKE path || '%'.
CREATE INDEX IF NOT EXISTS "Ticket_path_prefix_idx"
  ON "Ticket" USING btree ("path" text_pattern_ops);
