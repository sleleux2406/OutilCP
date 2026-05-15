import type { WeekCapacity } from "@/lib/capacity/etp";
import { computeAmdahlSpeedup } from "@/lib/capacity/etp";

/**
 * Algorithme de placement des tickets P1 dans la capacité hebdomadaire.
 *
 * Principe :
 *   - Les tickets sont traités dans l'ordre fourni (FIFO par createdAt).
 *   - On remplit la semaine courante jusqu'à épuiser sa capacité, puis on
 *     déborde sur la semaine suivante. Un ticket peut donc être réparti
 *     sur plusieurs semaines.
 *   - L'unité interne est la minute. La capacité hebdo (en jours-homme) est
 *     convertie : 1 jour = 480 minutes (8h).
 *   - Si la capacité totale des semaines fournies n'est pas suffisante,
 *     les minutes restantes sont retournées dans `leftoverMinutes` (le
 *     caller peut alors étendre l'horizon).
 */

export const MINUTES_PER_DAY = 480;

export interface P1Ticket {
  id: string;
  key: string;
  title: string;
  /** Effort à placer, en minutes (TASK/BUG = estimatedMinutes, FEATURE = totalEstimatedMinutes) */
  estimatedMinutes: number;
  type: "TASK" | "BUG" | "FEATURE";
  createdAt: Date;
}

export interface Allocation {
  ticketId: string;
  ticketKey: string;
  /** Lundi UTC de la semaine d'allocation */
  weekStart: Date;
  /** Minutes allouées dans cette semaine pour ce ticket */
  allocatedMinutes: number;
  /** Position dans la semaine (0 = premier ticket placé, 1 = second, ...) */
  position: number;
}

export interface PlacementResult {
  allocations: Allocation[];
  /** Date de fin projetée (= weekEnd de la dernière semaine utilisée), null si rien placé */
  projectedEndDate: Date | null;
  /** Minutes non placées faute de capacité disponible sur l'horizon fourni */
  leftoverMinutes: number;
  /** Tickets entièrement non placés (utile pour l'UI) */
  unplacedTickets: P1Ticket[];
}

/**
 * Place les tickets P1 dans les semaines de capacité disponibles.
 *
 * @param weeks Capacité hebdomadaire ordonnée chronologiquement
 * @param tickets Tickets P1 à placer, dans l'ordre de priorité (FIFO createdAt)
 */
export function placeP1Tickets(
  weeks: WeekCapacity[],
  tickets: P1Ticket[]
): PlacementResult {
  const allocations: Allocation[] = [];
  const unplacedTickets: P1Ticket[] = [];

  if (weeks.length === 0) {
    // Aucune capacité fournie : tout est leftover
    const totalLeftover = tickets.reduce((sum, t) => sum + t.estimatedMinutes, 0);
    return {
      allocations: [],
      projectedEndDate: null,
      leftoverMinutes: totalLeftover,
      unplacedTickets: [...tickets],
    };
  }

  // Capacité restante de chaque semaine, en minutes
  const remainingPerWeek: number[] = weeks.map(
    (w) => w.totalDays * MINUTES_PER_DAY
  );
  // Compteur de position par semaine (ordre d'apparition des tickets)
  const positionPerWeek: number[] = weeks.map(() => 0);

  let weekIndex = 0;
  let lastWeekUsed = -1;

  for (const ticket of tickets) {
    let remaining = ticket.estimatedMinutes;
    if (remaining <= 0) continue;

    let placedAtLeastOnce = false;

    // Avancer à la première semaine ayant de la capacité
    while (weekIndex < weeks.length && remainingPerWeek[weekIndex] <= 0) {
      weekIndex += 1;
    }

    // Position de ce ticket : on prend la position de la semaine où il
    // commence (utile pour l'UI : ordre vertical dans la colonne).
    const startWeekIndex = weekIndex;

    while (remaining > 0 && weekIndex < weeks.length) {
      const cap = remainingPerWeek[weekIndex];
      if (cap <= 0) {
        weekIndex += 1;
        continue;
      }
      const take = Math.min(cap, remaining);
      const position = positionPerWeek[weekIndex];

      allocations.push({
        ticketId: ticket.id,
        ticketKey: ticket.key,
        weekStart: weeks[weekIndex].weekStart,
        allocatedMinutes: take,
        position,
      });

      remainingPerWeek[weekIndex] -= take;
      positionPerWeek[weekIndex] += 1;
      remaining -= take;
      placedAtLeastOnce = true;
      lastWeekUsed = Math.max(lastWeekUsed, weekIndex);

      if (remainingPerWeek[weekIndex] <= 0) {
        weekIndex += 1;
      }
    }

    if (remaining > 0) {
      // Plus de capacité sur l'horizon : on garde la trace
      // (on n'ajoute pas d'allocation partielle inutile, mais on
      // signale le ticket comme non entièrement placé).
      unplacedTickets.push(ticket);
    }

    // Réinitialise weekIndex pour le ticket suivant uniquement si on a
    // débordé : sinon on continue dans la même semaine si elle a encore
    // de la capacité.
    if (!placedAtLeastOnce) {
      // Ticket non placé du tout (capacité 0 partout) : on stoppe la boucle
      // pour les suivants car il n'y a plus rien à faire.
      // On garde quand même les autres tickets dans unplacedTickets ci-dessous.
      // (continue pour ajouter chaque ticket à unplacedTickets)
      void startWeekIndex;
    }
  }

  // Si la boucle s'est arrêtée par manque de capacité, les tickets non encore
  // visités sont aussi unplaced.
  // (Dans la boucle ci-dessus, chaque ticket est traité ; ceux qui débordent
  // sont déjà dans unplacedTickets. Si weekIndex >= weeks.length avant la
  // fin des tickets, les suivants ne génèrent aucune allocation et passent
  // directement par le `if (remaining > 0)`.)

  const leftoverMinutes = unplacedTickets.reduce((sum, t) => {
    // Minutes non placées pour ce ticket = total - somme des allocations
    const placedForTicket = allocations
      .filter((a) => a.ticketId === t.id)
      .reduce((s, a) => s + a.allocatedMinutes, 0);
    return sum + (t.estimatedMinutes - placedForTicket);
  }, 0);

  // Calcul de la date de fin projetée (au jour ouvré près) :
  //   1. On identifie le dernier ticket placé (celui qui a une allocation
  //      dans la dernière semaine utilisée).
  //   2. On calcule l'ETP moyen des semaines où ce ticket est alloué.
  //   3. On applique la loi d'Amdahl avec dégradation Brooks :
  //        p(N) = max(0.5, 1 - 0.10 * (N - 1))
  //        speedup = 1 / ((1-p) + p/N)
  //      pour obtenir un coefficient de parallélisation realiste.
  //   4. On calcule la fraction effective de la dernière semaine consommée
  //      par ce ticket : daysAllocatedInLastWeek / speedup.
  //   5. On avance ce nombre de jours OUVRÉS depuis le lundi de la dernière
  //      semaine (saute samedi/dimanche).
  let projectedEndDate: Date | null = null;
  if (lastWeekUsed >= 0) {
    const lastWeek = weeks[lastWeekUsed];

    // Identifie le DERNIER ticket placé : celui qui a la plus grande
    // position dans la dernière semaine utilisée.
    const allocsInLastWeek = allocations
      .filter((a) => a.weekStart.getTime() === lastWeek.weekStart.getTime())
      .sort((a, b) => b.position - a.position);

    if (allocsInLastWeek.length === 0) {
      // Cas dégénéré : aucune allocation dans la dernière semaine
      // (ne devrait pas arriver vu la logique ci-dessus)
      projectedEndDate = new Date(lastWeek.weekStart);
    } else {
      const lastTicketAlloc = allocsInLastWeek[0];
      const lastTicketId = lastTicketAlloc.ticketId;

      // Toutes les allocations de ce dernier ticket (potentiellement réparties
      // sur plusieurs semaines). On en déduit l'ETP moyen.
      const lastTicketAllocations = allocations.filter(
        (a) => a.ticketId === lastTicketId
      );
      const weeksOccupiedByLastTicket = new Set(
        lastTicketAllocations.map((a) => a.weekStart.getTime())
      );
      const etpsForLastTicket = weeks
        .filter((w) => weeksOccupiedByLastTicket.has(w.weekStart.getTime()))
        .map((w) => w.totalEtp);
      const avgEtp =
        etpsForLastTicket.reduce((s, e) => s + e, 0) /
        Math.max(etpsForLastTicket.length, 1);

      // Loi d'Amdahl + Brooks
      const speedup = computeAmdahlSpeedup(avgEtp);

      // Combien de jours-homme sont placés dans la dernière semaine pour
      // CE ticket (et non pour tous les tickets confondus)
      const daysOfLastTicketInLastWeek =
        lastTicketAlloc.allocatedMinutes / MINUTES_PER_DAY;

      // Position du ticket dans la semaine : combien de jours-homme TOTAL
      // (tous tickets) ont été placés AVANT lui dans cette semaine.
      const daysBeforeInWeek = allocations
        .filter(
          (a) =>
            a.weekStart.getTime() === lastWeek.weekStart.getTime() &&
            a.position < lastTicketAlloc.position
        )
        .reduce((s, a) => s + a.allocatedMinutes / MINUTES_PER_DAY, 0);

      // Pour la portion AVANT (autres tickets de la semaine), on utilise
      // l'ETP de la semaine elle-même (parallelisme equipe sur d'autres tickets)
      const speedupOthersInWeek = computeAmdahlSpeedup(lastWeek.totalEtp);
      const calendarDaysBefore =
        speedupOthersInWeek > 0
          ? daysBeforeInWeek / speedupOthersInWeek
          : daysBeforeInWeek;

      // Pour le dernier ticket lui-meme, on utilise speedup base sur l'ETP
      // moyen de toutes les semaines qu'il occupe.
      const calendarDaysForLastTicket =
        speedup > 0 ? daysOfLastTicketInLastWeek / speedup : daysOfLastTicketInLastWeek;

      // Total de jours calendaires consommés DANS la dernière semaine
      // jusqu'à la fin du dernier ticket
      let totalCalendarDaysInLastWeek =
        calendarDaysBefore + calendarDaysForLastTicket;

      // Borné entre 1 et 5 jours ouvrés
      let calendarBusinessDaysNeeded = Math.ceil(totalCalendarDaysInLastWeek);
      calendarBusinessDaysNeeded = Math.min(calendarBusinessDaysNeeded, 5);
      calendarBusinessDaysNeeded = Math.max(calendarBusinessDaysNeeded, 1);

      // Avance depuis le lundi de N-1 jours ouvrés (lundi inclus = j1)
      projectedEndDate = new Date(lastWeek.weekStart);
      let stepsToAdvance = calendarBusinessDaysNeeded - 1;
      while (stepsToAdvance > 0) {
        projectedEndDate.setUTCDate(projectedEndDate.getUTCDate() + 1);
        const dow = projectedEndDate.getUTCDay();
        // Saute samedi (6) et dimanche (0)
        if (dow !== 0 && dow !== 6) {
          stepsToAdvance -= 1;
        }
      }
    }
  }

  return {
    allocations,
    projectedEndDate,
    leftoverMinutes,
    unplacedTickets,
  };
}
