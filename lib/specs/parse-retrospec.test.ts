/**
 * Tests manuels du parseur rétro-spec.
 *
 * Lance-le avec :
 *   npx tsx lib/specs/parse-retrospec.test.ts
 */

import { parseRetroSpec } from "./parse-retrospec";

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

// ─── Test 1 : vide ────────────────────────────────────────────
console.log("\nTexte vide");
const empty = parseRetroSpec("");
expect("compte warnings > 0", empty.warnings.length > 0, true);
expect("compte epics = 0", empty.counts.epics, 0);

// ─── Test 2 : format invalide ────────────────────────────────
console.log("\nFormat sans marqueurs");
const invalid = parseRetroSpec("Texte sans aucun marqueur de spec.");
expect("compte epics = 0", invalid.counts.epics, 0);
expect("warnings non vides", invalid.warnings.length > 0, true);

// ─── Test 3 : un Epic + une Feature minimale ─────────────────
console.log("\nEpic + Feature minimaux");
const minimal = parseRetroSpec(
  "EPIC E01 : Mon Epic – FEATURE F01.1 : Ma Feature"
);
expect("1 Epic", minimal.counts.epics, 1);
expect("1 Feature", minimal.counts.features, 1);
expect("Epic code", minimal.epics[0].code, "E01");
expect("Epic title", minimal.epics[0].title, "Mon Epic");
expect("Feature code", minimal.epics[0].features[0].code, "F01.1");
expect("Feature title", minimal.epics[0].features[0].title, "Ma Feature");

// ─── Test 4 : exemple complet (extrait du document réel) ──────
console.log("\nExemple complet (extrait document métier)");
const realSample = `EPIC E01 : Gouvernance & Administration – FEATURE F01.1 : Gestion de la disponibilité équipe – Description : Administration des jours fériés et congés pour le calcul des dates de livraison. – Règles métier & Contraintes : Permissions : ADMIN ou PRODUCT_OWNER uniquement; Contrainte : Chevauchement de congés interdit pour un même utilisateur; Impact : Les dates de fin de tickets excluent ces périodes. – Scénarios de Test : Création d'un congé par un ADMIN (Résultat : Le congé est enregistré et visible dans le calendrier); Tentative de chevauchement de deux congés (Résultat : Le système bloque l'enregistrement et affiche une erreur); Calcul de date de fin sur une période de congé (Résultat : La date de fin est décalée du nombre de jours de congés concernés). – FEATURE F01.2 : Audit & Traçabilité – Description : Journalisation de tous les événements sensibles pour le RUN. – Règles métier & Contraintes : Événements tracés : Login, Création/Suppression de tickets, Changement de statut, Logs de temps; Données : Horodatage, ID Utilisateur, Type d'action, Valeurs avant/après. – Scénarios de Test : Modification d'un statut de ticket (Résultat : Une entrée est créée dans la table AuditLog avec le changement précis); Suppression d'un ticket par un PO (Résultat : L'événement TICKET.DELETED est consigné avec l'identifiant du PO).`;

const real = parseRetroSpec(realSample);
expect("1 Epic (E01)", real.counts.epics, 1);
expect("2 Features", real.counts.features, 2);
expect("5 TestCases (3+2)", real.counts.testCases, 5);
expect("Epic E01 title", real.epics[0].title, "Gouvernance & Administration");
expect("Feature F01.1 title", real.epics[0].features[0].title, "Gestion de la disponibilité équipe");
expect("Feature F01.2 title", real.epics[0].features[1].title, "Audit & Traçabilité");
expect(
  "F01.1 a 3 scénarios",
  real.epics[0].features[0].scenarios.length,
  3
);
expect(
  "F01.1 scenario[0] title",
  real.epics[0].features[0].scenarios[0].title,
  "Création d'un congé par un ADMIN"
);
expect(
  "F01.1 scenario[0] expected",
  real.epics[0].features[0].scenarios[0].expected,
  "Le congé est enregistré et visible dans le calendrier"
);
expect(
  "F01.1 a 3 règles",
  real.epics[0].features[0].rules.length,
  3
);

// ─── Test 5 : exemple avec plusieurs Epics ────────────────────
console.log("\nPlusieurs Epics");
const multi = parseRetroSpec(
  "EPIC E01 : Epic Un – FEATURE F01.1 : Feature 1-1 EPIC E02 : Epic Deux – FEATURE F02.1 : Feature 2-1 – FEATURE F02.2 : Feature 2-2"
);
expect("2 Epics", multi.counts.epics, 2);
expect("3 Features total", multi.counts.features, 3);
expect("Epic 1 a 1 feature", multi.epics[0].features.length, 1);
expect("Epic 2 a 2 features", multi.epics[1].features.length, 2);

// ─── Test 6 : Feature orpheline (code Epic manquant) ──────────
console.log("\nFeature orpheline");
const orphan = parseRetroSpec("FEATURE F99.1 : Feature sans Epic parent");
expect("0 Epic", orphan.counts.epics, 0);
expect("1 Feature orpheline", orphan.orphanFeatures.length, 1);
expect("1 warning", orphan.warnings.length > 0, true);

// ─── Test 7 : doublon d'Epic ──────────────────────────────────
console.log("\nDoublon d'Epic");
const dup = parseRetroSpec("EPIC E01 : Original EPIC E01 : Doublon");
expect("1 Epic conservé", dup.counts.epics, 1);
expect("Titre original conservé", dup.epics[0].title, "Original");
expect("warning de doublon", dup.warnings.some((w) => w.includes("E01")), true);

// ─── Test 8 : scénario mal formaté ────────────────────────────
console.log("\nScénario mal formaté (sans Résultat)");
const badScenario = parseRetroSpec(
  "EPIC E01 : Test – FEATURE F01.1 : F – Scénarios de Test : Cas sans résultat"
);
expect("1 scénario capturé quand même", badScenario.epics[0].features[0].scenarios.length, 1);
expect(
  "expected vide pour scénario mal formaté",
  badScenario.epics[0].features[0].scenarios[0].expected,
  ""
);

// ─── Résumé ───────────────────────────────────────────────────
console.log(`\n${passed + failed} tests : ${passed} OK, ${failed} KO`);
process.exit(failed > 0 ? 1 : 0);
