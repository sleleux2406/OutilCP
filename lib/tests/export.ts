import { TestResult } from "@prisma/client";

/**
 * Export du Cahier de tests d'un projet.
 *
 * Genere un texte Markdown ou CSV qui liste pour chaque Feature/US :
 *   - les TestCase associes (titre, preconditions, steps, expected)
 *   - leur derniere execution (statut, date, testeur, commentaire, lien bug si KO)
 *
 * Pour F04.3 - EPIC E04 : reporting de recette par tableau de RUN.
 */

export interface ExportTestCase {
  id: string;
  title: string;
  preconditions: string | null;
  steps: string;
  expected: string;
  order: number;
  lastExecution: {
    result: TestResult;
    executedAt: string; // ISO
    testerName: string;
    comment: string | null;
    generatedBugKey: string | null;
  } | null;
  executionsCount: number;
}

export interface ExportTestParent {
  key: string;
  title: string;
  type: "FEATURE" | "USER_STORY";
  status: string;
  testCases: ExportTestCase[];
}

export interface ExportContext {
  projectKey: string;
  projectName: string;
  isRun: boolean;
  parentProjectKey?: string | null;
  parentProjectName?: string | null;
  generatedAt: Date;
  generatedByName: string;
  generatedByEmail: string;
  parents: ExportTestParent[];
}

const RESULT_LABEL: Record<TestResult | "NOT_EXECUTED", string> = {
  OK: "OK",
  KO: "KO",
  SKIPPED: "Ignore",
  NOT_EXECUTED: "Non execute",
};

const STATUS_LABEL: Record<string, string> = {
  BACKLOG: "Backlog",
  TODO: "A faire",
  IN_PROGRESS: "En cours",
  IN_REVIEW: "En revue",
  IN_TESTING: "En recette",
  DONE: "Termine",
  BLOCKED: "Bloque",
};

function formatDateFr(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Paris",
  });
}

// ─────────────────────────────────────────────────────────────
// Export MARKDOWN
// ─────────────────────────────────────────────────────────────

export function exportTestsAsMarkdown(ctx: ExportContext): string {
  const lines: string[] = [];

  // En-tete
  lines.push(`# Cahier de tests — ${ctx.projectName}`);
  lines.push("");
  lines.push(`**Projet** : \`${ctx.projectKey}\` — ${ctx.projectName}`);
  if (ctx.isRun && ctx.parentProjectKey) {
    lines.push(`**Type** : Sous-projet RUN (parent : \`${ctx.parentProjectKey}\` — ${ctx.parentProjectName})`);
  } else {
    lines.push("**Type** : Projet racine");
  }
  lines.push(`**Genere le** : ${formatDateFr(ctx.generatedAt)} (heure de Paris)`);
  lines.push(`**Par** : ${ctx.generatedByName} (${ctx.generatedByEmail})`);
  lines.push("");

  // Stats globales
  const globalStats = computeGlobalStats(ctx.parents);
  lines.push("## Synthese globale");
  lines.push("");
  lines.push(`| Indicateur | Nombre |`);
  lines.push(`|---|---|`);
  lines.push(`| Total cas de test | ${globalStats.totalCases} |`);
  lines.push(`| Cas executes OK | ${globalStats.ok} |`);
  lines.push(`| Cas en echec KO | ${globalStats.ko} |`);
  lines.push(`| Cas ignores | ${globalStats.skipped} |`);
  lines.push(`| Cas non executes | ${globalStats.notExecuted} |`);
  if (globalStats.totalCases > 0) {
    const passRate = Math.round((globalStats.ok / globalStats.totalCases) * 1000) / 10;
    lines.push(`| Taux de reussite | ${passRate}% |`);
  }
  lines.push("");

  // Detail par Feature/US
  lines.push("## Detail par Feature");
  lines.push("");

  if (ctx.parents.length === 0) {
    lines.push("_Aucun cas de test dans ce projet._");
  } else {
    for (const parent of ctx.parents) {
      const typeLabel = parent.type === "FEATURE" ? "Feature" : "User Story";
      lines.push(`### ${typeLabel} ${parent.key} : ${parent.title}`);
      lines.push("");
      lines.push(`**Statut** : ${STATUS_LABEL[parent.status] ?? parent.status}`);
      lines.push(`**Cas de test** : ${parent.testCases.length}`);
      lines.push("");

      if (parent.testCases.length === 0) {
        lines.push("_Aucun cas de test._");
        lines.push("");
        continue;
      }

      for (const tc of parent.testCases) {
        lines.push(`#### Cas ${tc.order}. ${tc.title}`);
        lines.push("");

        if (tc.preconditions) {
          lines.push(`**Preconditions** :`);
          lines.push("");
          lines.push(indentText(tc.preconditions, "> "));
          lines.push("");
        }

        lines.push(`**Etapes** :`);
        lines.push("");
        lines.push(indentText(tc.steps, "> "));
        lines.push("");

        lines.push(`**Resultat attendu** :`);
        lines.push("");
        lines.push(indentText(tc.expected, "> "));
        lines.push("");

        // Derniere execution
        const last = tc.lastExecution;
        if (!last) {
          lines.push(`**Derniere execution** : _Non execute_`);
          lines.push("");
        } else {
          lines.push(`**Derniere execution** :`);
          lines.push("");
          lines.push(`| Champ | Valeur |`);
          lines.push(`|---|---|`);
          lines.push(`| Resultat | **${RESULT_LABEL[last.result]}** |`);
          lines.push(`| Date | ${formatDateFr(last.executedAt)} |`);
          lines.push(`| Testeur | ${last.testerName} |`);
          if (last.comment) {
            const oneLine = last.comment.replace(/\|/g, "\\|").replace(/\n/g, " / ");
            lines.push(`| Commentaire | ${oneLine} |`);
          }
          if (last.generatedBugKey) {
            lines.push(`| Bug genere | \`${last.generatedBugKey}\` |`);
          }
          lines.push(`| Total executions | ${tc.executionsCount} |`);
          lines.push("");
        }

        lines.push("---");
        lines.push("");
      }
    }
  }

  // Pied de page
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("_Document genere automatiquement par la plateforme QA._");

  return lines.join("\n");
}

function indentText(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((l) => `${prefix}${l}`)
    .join("\n");
}

// ─────────────────────────────────────────────────────────────
// Export CSV
// Format : 1 ligne par cas de test avec sa derniere execution
// Compatible Excel via separateur ; (FR) et BOM UTF-8.
// ─────────────────────────────────────────────────────────────

export function exportTestsAsCsv(ctx: ExportContext): string {
  const sep = ";";
  const lines: string[] = [];

  // BOM UTF-8 pour Excel + en-tete
  const headers = [
    "Projet",
    "Type parent",
    "Cle parent",
    "Titre parent",
    "Statut parent",
    "Cas N",
    "Titre cas",
    "Preconditions",
    "Etapes",
    "Resultat attendu",
    "Dernier resultat",
    "Date derniere execution",
    "Testeur",
    "Commentaire",
    "Bug genere",
    "Nombre executions",
  ];
  lines.push(headers.join(sep));

  for (const parent of ctx.parents) {
    for (const tc of parent.testCases) {
      const last = tc.lastExecution;
      const row = [
        ctx.projectKey,
        parent.type === "FEATURE" ? "Feature" : "User Story",
        parent.key,
        parent.title,
        STATUS_LABEL[parent.status] ?? parent.status,
        String(tc.order),
        tc.title,
        tc.preconditions ?? "",
        tc.steps,
        tc.expected,
        last ? RESULT_LABEL[last.result] : RESULT_LABEL.NOT_EXECUTED,
        last ? formatDateFr(last.executedAt) : "",
        last ? last.testerName : "",
        last?.comment ?? "",
        last?.generatedBugKey ?? "",
        String(tc.executionsCount),
      ];
      lines.push(row.map(csvEscape).join(sep));
    }
  }

  // BOM UTF-8 (\uFEFF) pour qu'Excel detecte l'encodage automatiquement
  return "\uFEFF" + lines.join("\r\n");
}

/**
 * Echappe une valeur pour CSV : double-quote si contient ; , " ou newline.
 * Doublement des doubles quotes existantes.
 */
function csvEscape(value: string): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Si contient le separateur, des quotes ou des sauts de ligne, on entoure de quotes
  if (s.includes(";") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ─────────────────────────────────────────────────────────────
// Helpers stats
// ─────────────────────────────────────────────────────────────

function computeGlobalStats(parents: ExportTestParent[]) {
  const acc = { totalCases: 0, ok: 0, ko: 0, skipped: 0, notExecuted: 0 };
  for (const p of parents) {
    for (const tc of p.testCases) {
      acc.totalCases++;
      if (!tc.lastExecution) acc.notExecuted++;
      else if (tc.lastExecution.result === "OK") acc.ok++;
      else if (tc.lastExecution.result === "KO") acc.ko++;
      else acc.skipped++;
    }
  }
  return acc;
}
