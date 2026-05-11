-- Migration : élargir la limite de logging de temps par entrée (1440 → 14400 min = 30 jours)
-- À exécuter via :
--   psql -U postgres -h localhost -d qa_platform -f prisma/migrations/20260509000000_log_limit/migration.sql

-- Remplacer la contrainte : on DROP puis on recrée avec la nouvelle limite.
ALTER TABLE "TimeEntry"
  DROP CONSTRAINT IF EXISTS time_entry_minutes_positive;

ALTER TABLE "TimeEntry"
  ADD CONSTRAINT time_entry_minutes_positive
  CHECK (minutes > 0 AND minutes <= 14400);

COMMENT ON CONSTRAINT time_entry_minutes_positive ON "TimeEntry" IS
  'Limite de saisie : > 0 minute et <= 30 jours (14400 min) par entrée';
