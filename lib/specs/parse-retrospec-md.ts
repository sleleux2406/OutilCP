import type {
  ParsedScenario,
  ParsedFeature,
  ParsedEpic,
  ParseResult,
} from "./parse-retrospec";

/**
 * Parseur Markdown pour les retro-specifications.
 *
 * Format attendu :
 *
 *   ---
 *   version: retrospec-2     (optionnel - frontmatter YAML simple)
 *   ---
 *
 *   # EPIC E01 : Titre de l'Epic
 *
 *   ## FEATURE F01.1 : Titre de la Feature
 *
 *   ### Description
 *   Texte libre multiligne...
 *
 *   ### Regles metier
 *   - Regle 1
 *   - Regle 2
 *
 *   ### Scenarios de test
 *   - Scenario 1 (Resultat : attendu 1)
 *   - Scenario 2 (Resultat : attendu 2)
 *
 *   ## FEATURE F01.2 : Autre feature
 *   ...
 *
 *   # EPIC E02 : ...
 *
 * Tolerances :
 *   - Headings ATX (#) ou Setext (===, ---)  -> seulement ATX gere ici
 *   - Variantes orthographiques : "Regles metier", "Règles métier", "Rules"
 *     "Scenarios de test", "Scénarios", "Test scenarios"
 *   - Tirets de liste : - ou *
 *   - Casse libre sur les mots-cles EPIC / FEATURE
 *   - Codes E\d+ et F\d+\.\d+ ou variantes (E1, E01, F1.1, F01.01, etc.)
 */

export interface MarkdownParseResult extends ParseResult {
  /** Version extraite du frontmatter, si presente. Null sinon. */
  detectedVersion: string | null;
}

// ─────────────────────────────────────────────────────────────
// Detection format
// ─────────────────────────────────────────────────────────────

/**
 * Detecte si une chaine ressemble a du Markdown structure (avec headings #).
 * Heuristique simple : presence d'au moins une ligne commencant par "# " ou "## ".
 */
export function looksLikeMarkdown(input: string): boolean {
  const lines = input.split("\n");
  return lines.some((l) => /^#{1,3}\s+/.test(l));
}

// ─────────────────────────────────────────────────────────────
// Frontmatter YAML simple (cle: valeur)
// ─────────────────────────────────────────────────────────────

interface Frontmatter {
  version?: string;
  body: string;
}

function extractFrontmatter(input: string): Frontmatter {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith("---")) {
    return { body: input };
  }

  // On cherche le second "---" sur sa propre ligne
  const lines = trimmed.split("\n");
  if (lines[0].trim() !== "---") return { body: input };

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return { body: input };

  const fmLines = lines.slice(1, endIdx);
  const result: Frontmatter = { body: lines.slice(endIdx + 1).join("\n") };

  for (const l of fmLines) {
    const m = l.match(/^\s*([a-zA-Z_-][a-zA-Z0-9_-]*)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const [, key, value] = m;
    const cleanValue = value.replace(/^["']|["']$/g, "").trim();
    if (key.toLowerCase() === "version") {
      result.version = cleanValue;
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// Parser principal
// ─────────────────────────────────────────────────────────────

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const EPIC_TITLE_RE = /^EPIC\s+(E\d+)\s*[:\-–—]\s*(.+)$/i;
const FEATURE_TITLE_RE = /^FEATURE\s+(F\d+(?:\.\d+)?)\s*[:\-–—]\s*(.+)$/i;
const LIST_ITEM_RE = /^[\-\*+]\s+(.+)$/;
const SCENARIO_EXPECTED_RE = /^(.*?)\s*\((?:R[ée]sultat|Resultat|Expected)\s*:\s*(.+?)\)\s*$/i;

const SECTION_KEYWORDS = {
  description: ["description"],
  rules: ["règles métier", "regles metier", "regles", "rules", "règles", "business rules"],
  scenarios: [
    "scénarios de test",
    "scenarios de test",
    "scénarios",
    "scenarios",
    "test scenarios",
    "tests",
    "cas de test",
    "test cases",
  ],
} as const;

type SectionType = keyof typeof SECTION_KEYWORDS;

function detectSection(headingText: string): SectionType | null {
  const lowered = headingText.toLowerCase().trim();
  for (const [section, keywords] of Object.entries(SECTION_KEYWORDS)) {
    if (keywords.some((k) => lowered === k || lowered.startsWith(k))) {
      return section as SectionType;
    }
  }
  return null;
}

interface ParsingState {
  currentEpic: ParsedEpic | null;
  currentFeature: ParsedFeature | null;
  currentSection: SectionType | null;
  /** Buffer de lignes pour la section en cours */
  sectionBuffer: string[];
}

function flushSection(state: ParsingState): void {
  if (!state.currentFeature || !state.currentSection) return;

  const text = state.sectionBuffer.join("\n").trim();
  if (text.length === 0) {
    state.sectionBuffer = [];
    return;
  }

  switch (state.currentSection) {
    case "description":
      // Concatene si plusieurs sections Description (improbable, mais propre)
      state.currentFeature.description = state.currentFeature.description
        ? `${state.currentFeature.description}\n\n${text}`
        : text;
      break;

    case "rules":
      // Extrait les items de liste, fallback sur les lignes
      for (const line of state.sectionBuffer) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const m = trimmed.match(LIST_ITEM_RE);
        const value = m ? m[1].trim() : trimmed;
        if (value.length > 0 && value.length <= 2000) {
          state.currentFeature.rules.push(value);
        }
      }
      break;

    case "scenarios":
      // Chaque item de liste = un scenario
      for (const line of state.sectionBuffer) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const m = trimmed.match(LIST_ITEM_RE);
        if (!m) continue;
        const itemText = m[1].trim();
        const scenarioMatch = itemText.match(SCENARIO_EXPECTED_RE);
        if (scenarioMatch) {
          state.currentFeature.scenarios.push({
            title: scenarioMatch[1].trim().slice(0, 200),
            expected: scenarioMatch[2].trim().slice(0, 1000),
          });
        } else {
          // Pas de "(Resultat : ...)" : on prend le titre seul
          state.currentFeature.scenarios.push({
            title: itemText.slice(0, 200),
            expected: "(résultat attendu non précisé dans la spec)",
          });
        }
      }
      break;
  }

  state.sectionBuffer = [];
}

function flushFeature(state: ParsingState): void {
  flushSection(state);
  if (state.currentFeature && state.currentEpic) {
    state.currentEpic.features.push(state.currentFeature);
  }
  state.currentFeature = null;
  state.currentSection = null;
}

function flushEpic(state: ParsingState, result: MarkdownParseResult): void {
  flushFeature(state);
  if (state.currentEpic) {
    result.epics.push(state.currentEpic);
  }
  state.currentEpic = null;
}

export function parseRetroSpecMarkdown(input: string): MarkdownParseResult {
  const result: MarkdownParseResult = {
    epics: [],
    orphanFeatures: [],
    warnings: [],
    counts: { epics: 0, features: 0, testCases: 0 },
    detectedVersion: null,
  };

  if (!input || input.trim().length === 0) {
    result.warnings.push("Le document Markdown est vide.");
    return result;
  }

  const { version, body } = extractFrontmatter(input);
  if (version) result.detectedVersion = version;

  const lines = body.split("\n");
  const state: ParsingState = {
    currentEpic: null,
    currentFeature: null,
    currentSection: null,
    sectionBuffer: [],
  };

  for (const line of lines) {
    const headingMatch = line.match(HEADING_RE);
    if (!headingMatch) {
      // Ligne de contenu, on l'ajoute au buffer de section courante
      if (state.currentSection) {
        state.sectionBuffer.push(line);
      }
      continue;
    }

    const level = headingMatch[1].length;
    const text = headingMatch[2].trim();

    // Avant de traiter le nouveau heading, on flush le buffer de la section en cours
    if (state.currentSection && state.currentFeature) {
      flushSection(state);
    }

    // Niveau 1 (#) = EPIC
    if (level === 1) {
      const epicMatch = text.match(EPIC_TITLE_RE);
      if (!epicMatch) {
        result.warnings.push(
          `Ligne ignorée : heading H1 sans format "EPIC EXX : Titre" : "${text.slice(0, 80)}"`
        );
        continue;
      }
      flushEpic(state, result);
      state.currentEpic = {
        code: epicMatch[1].toUpperCase(),
        title: epicMatch[2].trim(),
        features: [],
      };
      state.currentSection = null;
      continue;
    }

    // Niveau 2 (##) = FEATURE
    if (level === 2) {
      const featureMatch = text.match(FEATURE_TITLE_RE);
      if (!featureMatch) {
        result.warnings.push(
          `Ligne ignorée : heading H2 sans format "FEATURE FXX.Y : Titre" : "${text.slice(0, 80)}"`
        );
        continue;
      }
      flushFeature(state);
      const code = featureMatch[1].toUpperCase();
      // Derive le code Epic du code Feature : F01.2 -> E01 (ou E1 si format court)
      const epicCodeMatch = code.match(/^F(\d+)/);
      const epicCode = epicCodeMatch ? `E${epicCodeMatch[1]}` : "";
      const newFeature: ParsedFeature = {
        code,
        epicCode,
        title: featureMatch[2].trim(),
        description: "",
        rules: [],
        scenarios: [],
      };
      if (state.currentEpic) {
        state.currentFeature = newFeature;
      } else {
        // Feature orpheline (pas de Epic ouvert)
        result.orphanFeatures.push(newFeature);
        result.warnings.push(
          `Feature orpheline (sans Epic parent) : ${code} ${featureMatch[2].trim().slice(0, 60)}`
        );
      }
      state.currentSection = null;
      continue;
    }

    // Niveau 3+ (###...) = section dans une Feature
    if (level >= 3) {
      const section = detectSection(text);
      if (section && state.currentFeature) {
        state.currentSection = section;
        state.sectionBuffer = [];
      } else if (section && !state.currentFeature) {
        result.warnings.push(
          `Section "${text}" hors d'une FEATURE : ignoree`
        );
        state.currentSection = null;
      } else {
        // Section inconnue (pas Description / Regles / Scenarios)
        // On ferme la section courante mais on n'ouvre pas de buffer specifique
        state.currentSection = null;
      }
      continue;
    }
  }

  // Flush final
  flushEpic(state, result);

  // Calcul des compteurs
  result.counts.epics = result.epics.length;
  for (const epic of result.epics) {
    result.counts.features += epic.features.length;
    for (const f of epic.features) {
      result.counts.testCases += f.scenarios.length;
    }
  }

  // Doublon Epic codes
  const epicCodes = result.epics.map((e) => e.code);
  const epicDupes = epicCodes.filter((c, i) => epicCodes.indexOf(c) !== i);
  for (const dup of new Set(epicDupes)) {
    result.warnings.push(`Code Epic en doublon : ${dup}`);
  }

  if (result.epics.length === 0 && result.orphanFeatures.length === 0) {
    result.warnings.push(
      "Aucun EPIC ni FEATURE detecte. Verifiez le format du document (headings # EPIC EXX, ## FEATURE FXX.Y)."
    );
  }

  return result;
}
