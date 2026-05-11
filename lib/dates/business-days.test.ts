/**
 * Tests manuels de la lib business-days.
 *
 * Lance-le avec :
 *   npx tsx lib/dates/business-days.test.ts
 *
 * Aucun framework externe pour garder la dépendance minimale.
 */

import {
  computeEndDate,
  countBusinessDays,
  isBusinessDay,
  shiftBusinessDays,
  toNextBusinessDay,
} from "./business-days";

/** Parse "YYYY-MM-DD" en Date UTC (pas locale). */
function d(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

/** Format une Date en "YYYY-MM-DD" UTC. */
function f(date: Date | null): string {
  if (!date) return "null";
  return date.toISOString().slice(0, 10);
}

let passed = 0;
let failed = 0;

function expect(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       expected: ${JSON.stringify(expected)}`);
    console.error(`       actual  : ${JSON.stringify(actual)}`);
  }
}

// ─── isBusinessDay ───────────────────────────────────────────
console.log("\nisBusinessDay");
expect("lundi", isBusinessDay(d("2026-01-05")), true); // lundi
expect("vendredi", isBusinessDay(d("2026-01-09")), true); // vendredi
expect("samedi", isBusinessDay(d("2026-01-10")), false);
expect("dimanche", isBusinessDay(d("2026-01-11")), false);

// ─── toNextBusinessDay ───────────────────────────────────────
console.log("\ntoNextBusinessDay");
expect(
  "lundi inchangé",
  f(toNextBusinessDay(d("2026-01-05"))),
  "2026-01-05"
);
expect(
  "samedi → lundi",
  f(toNextBusinessDay(d("2026-01-10"))),
  "2026-01-12"
);
expect(
  "dimanche → lundi",
  f(toNextBusinessDay(d("2026-01-11"))),
  "2026-01-12"
);

// ─── computeEndDate (cas validé par le métier) ───────────────
console.log("\ncomputeEndDate — exemple métier : jeudi + 3j = lundi");
// Jeudi 8 janvier 2026
expect("0j → même jour", f(computeEndDate(d("2026-01-08"), 0)), "2026-01-08");
expect("1j → même jour (jour inclus)", f(computeEndDate(d("2026-01-08"), 1)), "2026-01-08");
expect("2j → vendredi", f(computeEndDate(d("2026-01-08"), 2)), "2026-01-09");
expect("3j → lundi (exemple métier)", f(computeEndDate(d("2026-01-08"), 3)), "2026-01-12");
expect("4j → mardi", f(computeEndDate(d("2026-01-08"), 4)), "2026-01-13");
expect("5j → mercredi", f(computeEndDate(d("2026-01-08"), 5)), "2026-01-14");

// Fraction : 3.5j = 3 jours entiers (lundi) + demi-journée sur mardi
expect("3.5j → mardi (fraction)", f(computeEndDate(d("2026-01-08"), 3.5)), "2026-01-13");
expect("3.1j → mardi (arrondi sup)", f(computeEndDate(d("2026-01-08"), 3.1)), "2026-01-13");

// Démarrage un samedi → normalisation au lundi
expect(
  "samedi + 3j → mercredi (démarrage lundi)",
  f(computeEndDate(d("2026-01-10"), 3)),
  "2026-01-14"
);

// ─── countBusinessDays ───────────────────────────────────────
console.log("\ncountBusinessDays");
expect("jeudi→lundi = 3", countBusinessDays(d("2026-01-08"), d("2026-01-12")), 3);
expect("lundi→vendredi = 5", countBusinessDays(d("2026-01-05"), d("2026-01-09")), 5);
expect("lundi→mardi suivant = 6", countBusinessDays(d("2026-01-05"), d("2026-01-13")), 7);
expect("même jour = 1", countBusinessDays(d("2026-01-05"), d("2026-01-05")), 1);
expect("fin < début → 0", countBusinessDays(d("2026-01-10"), d("2026-01-05")), 0);

// ─── shiftBusinessDays ───────────────────────────────────────
console.log("\nshiftBusinessDays");
expect("lundi + 4j = vendredi", f(shiftBusinessDays(d("2026-01-05"), 4)), "2026-01-09");
expect("lundi + 5j = lundi suivant", f(shiftBusinessDays(d("2026-01-05"), 5)), "2026-01-12");
expect("vendredi + 1j = lundi", f(shiftBusinessDays(d("2026-01-09"), 1)), "2026-01-12");
expect("lundi - 3j = mercredi précédent", f(shiftBusinessDays(d("2026-01-05"), -3)), "2025-12-31");

console.log(`\n${passed + failed} tests : ${passed} OK, ${failed} KO`);
process.exit(failed > 0 ? 1 : 0);
