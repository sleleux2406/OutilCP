import {
  countBusinessDays,
  isBusinessDay,
  startOfDayUTC,
} from "@/lib/dates/business-days";

/**
 * Calcul de la capacité hebdomadaire d'une équipe en ETP.
 *
 * Règles :
 *   - 1 développeur à temps plein = 1 ETP de base
 *   - On déduit ses absences (congés + jours fériés globaux) sur la semaine
 *   - Pour une semaine de 5 jours ouvrés théoriques :
 *       1 dev sans absence  → 1.0 ETP
 *       1 dev absent 1 jour → 0.8 ETP
 *       1 dev absent 5 jours → 0.0 ETP
 *   - Total équipe = somme des ETP individuels
 *
 * Toutes les dates sont en UTC (jour entier).
 */

export interface DeveloperLeaves {
  userId: string;
  name: string;
  /** Plages de congés [startDate, endDate] inclusives, en UTC */
  leaves: Array<{ startDate: Date; endDate: Date }>;
}

export interface WeekCapacity {
  /** Lundi de la semaine (UTC) */
  weekStart: Date;
  /** Dimanche de la semaine (UTC) — dernier jour théorique */
  weekEnd: Date;
  /** Jours ouvrés dans cette semaine (toujours 5 sauf si fériés) */
  businessDays: number;
  /** Jours fériés dans cette semaine (déjà déduits de businessDays) */
  holidayDays: number;
  /** ETP total de l'équipe pour cette semaine */
  totalEtp: number;
  /** Capacité totale en jours-homme */
  totalDays: number;
  /** Détail par développeur */
  perDeveloper: Array<{
    userId: string;
    name: string;
    /** Jours d'absence (congés) cette semaine */
    leaveDays: number;
    /** ETP individuel = (jours_ouvrés - leaveDays) / 5 */
    etp: number;
    /** Capacité individuelle en jours-homme = etp × 5 */
    days: number;
  }>;
}

/**
 * Retourne le lundi (UTC, à 00:00) qui contient ou précède la date donnée.
 * Si date est un dimanche, on remonte au lundi de la même semaine.
 */
export function startOfWeekUTC(date: Date): Date {
  const d = startOfDayUTC(date);
  const day = d.getUTCDay(); // 0=dim, 1=lun, ..., 6=sam
  // Si dimanche, on recule de 6 jours pour atteindre lundi précédent.
  // Sinon, on recule de (day - 1) jours.
  const offset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

/**
 * Génère les N premières semaines à partir d'une date de départ.
 * Retourne un tableau de { weekStart, weekEnd } pour 7 jours chacun.
 */
export function generateWeeks(start: Date, count: number): Array<{ weekStart: Date; weekEnd: Date }> {
  const weeks: Array<{ weekStart: Date; weekEnd: Date }> = [];
  const monday = startOfWeekUTC(start);

  for (let i = 0; i < count; i++) {
    const weekStart = new Date(monday);
    weekStart.setUTCDate(weekStart.getUTCDate() + i * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6); // dimanche
    weeks.push({ weekStart, weekEnd });
  }
  return weeks;
}

/**
 * Compte le nombre de jours d'absence d'un développeur DANS une semaine donnée.
 * Une absence couvre tous les jours ouvrés entre startDate et endDate inclus,
 * intersectés avec la semaine.
 */
export function countLeaveDaysInWeek(
  leaves: Array<{ startDate: Date; endDate: Date }>,
  weekStart: Date,
  weekEnd: Date
): number {
  let total = 0;
  for (const leave of leaves) {
    // Intersection [leave.startDate, leave.endDate] ∩ [weekStart, weekEnd]
    const intersectStart = leave.startDate > weekStart ? leave.startDate : weekStart;
    const intersectEnd = leave.endDate < weekEnd ? leave.endDate : weekEnd;
    if (intersectStart > intersectEnd) continue; // pas de chevauchement
    total += countBusinessDays(intersectStart, intersectEnd);
  }
  return total;
}

/**
 * Compte le nombre de jours fériés (dans la liste) qui tombent un jour ouvré
 * de la semaine donnée. Un férié qui tombe un samedi ne compte pas.
 */
export function countHolidaysInWeek(
  holidays: Date[],
  weekStart: Date,
  weekEnd: Date
): number {
  let count = 0;
  for (const h of holidays) {
    const day = startOfDayUTC(h);
    if (
      day.getTime() >= weekStart.getTime() &&
      day.getTime() <= weekEnd.getTime() &&
      isBusinessDay(day)
    ) {
      count += 1;
    }
  }
  return count;
}

/**
 * Capacité d'une seule semaine pour une équipe donnée.
 *
 * @param weekStart Lundi UTC de la semaine
 * @param weekEnd Dimanche UTC de la semaine
 * @param developers Liste des devs avec leurs congés
 * @param holidays Liste des jours fériés globaux (Date UTC)
 */
export function computeWeekCapacity(
  weekStart: Date,
  weekEnd: Date,
  developers: DeveloperLeaves[],
  holidays: Date[]
): WeekCapacity {
  const baseBusinessDays = countBusinessDays(weekStart, weekEnd); // 5 normalement
  const holidayDays = countHolidaysInWeek(holidays, weekStart, weekEnd);
  const businessDaysAfterHolidays = baseBusinessDays - holidayDays;

  // Référence pour calculer l'ETP : on garde 5 comme dénominateur de référence
  // (cohérent avec la spec : 1 jour de congé sur 5 jours = 0.8 ETP, même si
  // un férié tombe dans la semaine, l'ETP "individuel" se base sur 5).
  const ETP_REFERENCE_DAYS = 5;

  const perDeveloper = developers.map((dev) => {
    const leaveDays = countLeaveDaysInWeek(dev.leaves, weekStart, weekEnd);
    // Le développeur perd aussi les jours fériés (qui sont chômés)
    const totalAbsence = leaveDays + holidayDays;
    const availableDays = Math.max(ETP_REFERENCE_DAYS - totalAbsence, 0);
    const etp = availableDays / ETP_REFERENCE_DAYS;
    return {
      userId: dev.userId,
      name: dev.name,
      leaveDays, // congés uniquement (les fériés sont communs à toute l'équipe)
      etp: Math.round(etp * 100) / 100, // arrondi 2 décimales
      days: availableDays,
    };
  });

  const totalEtp = perDeveloper.reduce((sum, d) => sum + d.etp, 0);
  const totalDays = perDeveloper.reduce((sum, d) => sum + d.days, 0);

  return {
    weekStart,
    weekEnd,
    businessDays: businessDaysAfterHolidays,
    holidayDays,
    totalEtp: Math.round(totalEtp * 100) / 100,
    totalDays,
    perDeveloper,
  };
}

/**
 * Capacité sur N semaines consécutives à partir d'une date.
 */
export function computeCapacityForWeeks(
  startDate: Date,
  weeksCount: number,
  developers: DeveloperLeaves[],
  holidays: Date[]
): WeekCapacity[] {
  const weeks = generateWeeks(startDate, weeksCount);
  return weeks.map(({ weekStart, weekEnd }) =>
    computeWeekCapacity(weekStart, weekEnd, developers, holidays)
  );
}

/**
 * Loi d'Amdahl avec dégradation de la fraction parallélisable selon
 * la taille de l'équipe (loi de Brooks : "Adding manpower to a late
 * software project makes it later").
 *
 *   p(N) = max(0.5, 1 - 0.25 * (N - 1))
 *
 * Concrètement :
 *   N=1  → p=1.00 (seul, pas de coordination, parallélisme parfait)
 *   N=2  → p=0.75 (revue + sync notable)
 *   N=3  → p=0.50 (plancher atteint : équipe de 3 = beaucoup de coordination)
 *   N≥3  → p=0.50 (plancher : la coordination plafonne le parallélisme)
 *
 * Puis le speedup est :
 *
 *   speedup(N) = 1 / ((1 - p) + p / N)
 *
 * Exemples (5 jours-homme à absorber) :
 *   N=1 → speedup=1.00 → 5.00j calendaires → vendredi
 *   N=2 → speedup=1.60 → 3.13j calendaires → jeudi
 *   N=3 → speedup=1.71 → 2.92j calendaires → mercredi
 *   N=4 → speedup=1.78 → 2.81j calendaires → mercredi
 *
 * Si N <= 0, retourne 1 (pas de division par zéro, durée = estim).
 */
export function computeAmdahlSpeedup(n: number): number {
  if (n <= 1) return Math.max(n, 1); // 1 dev = 1×, 0 dev = 1× (sécurité)
  const p = Math.max(0.5, 1 - 0.25 * (n - 1));
  const speedup = 1 / (1 - p + p / n);
  return speedup;
}
