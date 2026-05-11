/**
 * Helpers pour le calcul en jours ouvrés (Lundi-Vendredi).
 *
 * Convention validée par le métier :
 *   - Semaine standard : L M M J V (5 jours). Samedi/dimanche ignorés.
 *   - Jours fériés : non gérés pour l'instant (à ajouter plus tard si besoin).
 *   - Unité : jours-homme.
 *   - Calcul de date de fin : jour de début INCLUS, fraction autorisée en fin.
 *     Exemple : jeudi + 3 jours = lundi soir (jeudi=j1, vendredi=j2, lundi=j3).
 *     Exemple : jeudi + 3.5 jours = mardi midi.
 *
 * Toutes les fonctions opèrent sur des Date JS en UTC pour éviter les
 * surprises de fuseaux horaires. Côté UI on affichera via toLocaleDateString.
 */

export const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

/** Jour de la semaine (0=dimanche, 1=lundi, ..., 6=samedi) en UTC. */
function getDayOfWeekUTC(date: Date): number {
  return date.getUTCDay();
}

/** Est-ce un jour ouvré (lundi à vendredi) ? */
export function isBusinessDay(date: Date): boolean {
  const d = getDayOfWeekUTC(date);
  return d >= 1 && d <= 5;
}

/**
 * Retourne une nouvelle Date avec le temps mis à minuit UTC (00:00:00.000).
 * Utile pour comparer deux dates sans tenir compte de l'heure.
 */
export function startOfDayUTC(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Avance d'UN jour calendaire (sans notion d'ouvré).
 */
function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MILLIS_PER_DAY);
}

/**
 * Ajuste une date au PROCHAIN jour ouvré (elle-même si déjà ouvrée).
 * Utile pour normaliser une date de début saisie un week-end.
 */
export function toNextBusinessDay(date: Date): Date {
  let d = startOfDayUTC(date);
  while (!isBusinessDay(d)) {
    d = addDays(d, 1);
  }
  return d;
}

/**
 * Calcule la date de fin d'un travail qui démarre à `start` et dure
 * `durationDays` jours-homme en jours ouvrés.
 *
 * Règle hybride : jour de début INCLUS, fraction autorisée en fin.
 *
 *   - durationDays = 0 → retourne start (rien à faire)
 *   - durationDays = 1 → retourne start (le jour de début couvre 1 jour-homme)
 *   - durationDays = 2 → retourne le jour ouvré suivant
 *   - durationDays fractionnaire → fin dans la journée : on renvoie la même
 *     date que celle du dernier jour entier, c'est à l'UI d'afficher le
 *     concept de demi-journée si besoin
 *
 * Si `start` tombe un week-end, on le normalise au lundi suivant.
 * Retourne null si durationDays est négatif ou invalide.
 */
export function computeEndDate(start: Date, durationDays: number): Date | null {
  if (!Number.isFinite(durationDays) || durationDays < 0) return null;

  const normalizedStart = toNextBusinessDay(start);

  // Cas trivial : 0 jour → pas de travail, la fin = le début
  if (durationDays === 0) return normalizedStart;

  // On compte combien de jours ouvrés ENTIERS à parcourir depuis le début.
  // Exemple : 3 jours → on veut aller jusqu'au 3e jour ouvré INCLUS
  // (start = j1, puis j2, puis j3 = fin).
  // Donc on avance de Math.ceil(duration) - 1 jours ouvrés.
  const fullDays = Math.ceil(durationDays);
  const stepsToAdvance = fullDays - 1;

  let cursor = normalizedStart;
  let remaining = stepsToAdvance;

  while (remaining > 0) {
    cursor = addDays(cursor, 1);
    if (isBusinessDay(cursor)) {
      remaining -= 1;
    }
  }

  return cursor;
}

/**
 * Compte le nombre de jours ouvrés entre deux dates (bornes incluses).
 * Utile pour l'inverse : savoir combien un intervalle représente.
 *
 *   countBusinessDays(jeudi, lundi) = 3 (jeudi, vendredi, lundi)
 *
 * Retourne 0 si end < start.
 */
export function countBusinessDays(start: Date, end: Date): number {
  const s = startOfDayUTC(start);
  const e = startOfDayUTC(end);
  if (e.getTime() < s.getTime()) return 0;

  let count = 0;
  let cursor = s;
  while (cursor.getTime() <= e.getTime()) {
    if (isBusinessDay(cursor)) count += 1;
    cursor = addDays(cursor, 1);
  }
  return count;
}

/**
 * Décale une date de N jours OUVRÉS (positif = avance, négatif = recule).
 * Si start tombe un week-end, on le normalise au prochain jour ouvré avant de décaler.
 */
export function shiftBusinessDays(date: Date, days: number): Date {
  let cursor = toNextBusinessDay(date);
  if (days === 0) return cursor;

  const direction = days > 0 ? 1 : -1;
  let remaining = Math.abs(days);

  while (remaining > 0) {
    cursor = addDays(cursor, direction);
    if (isBusinessDay(cursor)) {
      remaining -= 1;
    }
  }
  return cursor;
}

/**
 * Convertit minutes (unité BDD) en jours-homme (unité métier).
 * 1 jour = 8 heures = 480 minutes.
 */
export function minutesToWorkDays(minutes: number): number {
  return minutes / 480;
}
