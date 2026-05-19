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
const LIST_ITEM_RE = /^[\-\*+]\s+(.+)$/;
const SCENARIO_EXPECTED_RE = /^(.*?)\s*\((?:R[ée]sultat|Resultat|Expected)\s*:\s*(.+?)\)\s*$/i;

/**
 * Pad un nombre sur 2 chiffres minimum (1 -> "01", 12 -> "12").
 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

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
  /** Compteur auto pour les Epics sans code explicite */
  epicAutoCounter: number;
  /** Numero d'epic du courant (1-indexed) - sert a deriver F<num>.<x> */
  currentEpicNumber: number;
  /** Compteur de features par Epic (cle = code Epic) pour auto-numerotation des Features */
  featureCountByEpic: Map<string, number>;
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
    epicAutoCounter: 0,
    currentEpicNumber: 0,
    featureCountByEpic: new Map(),
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

    // Niveau 1 (#) = EPIC (toujours, peu importe le contenu du titre)
    // Le titre est pris tel quel : si l'utilisateur ecrit "# EPIC E03 : Foo",
    // le titre devient "EPIC E03 : Foo". Le code est TOUJOURS auto-genere.
    if (level === 1) {
      if (!text.trim()) {
        result.warnings.push(
          `Heading H1 vide ignoré.`
        );
        continue;
      }

      flushEpic(state, result);

      // Auto-numerotation stricte : chaque H1 incremente le compteur
      state.epicAutoCounter += 1;
      const resolvedCode = `E${pad2(state.epicAutoCounter)}`;
      state.currentEpicNumber = state.epicAutoCounter;

      state.currentEpic = {
        code: resolvedCode,
        title: text.trim(),
        features: [],
      };
      // Reset du compteur Feature pour ce nouvel Epic
      state.featureCountByEpic.set(resolvedCode, 0);
      state.currentSection = null;
      continue;
    }

    // Niveau 2 (##) = FEATURE (toujours, peu importe le contenu du titre)
    // Le titre est pris tel quel. Le code est TOUJOURS auto-genere
    // au format F<numEpic>.<numFeature>.
    if (level === 2) {
      if (!text.trim()) {
        result.warnings.push(
          `Heading H2 vide ignoré.`
        );
        continue;
      }

      flushFeature(state);

      // Si pas d'Epic ouvert, on cree un Epic auto pour rattacher la Feature
      // (evite les Features orphelines).
      if (!state.currentEpic) {
        state.epicAutoCounter += 1;
        const autoEpicCode = `E${pad2(state.epicAutoCounter)}`;
        state.currentEpicNumber = state.epicAutoCounter;
        state.currentEpic = {
          code: autoEpicCode,
          title: "(Epic auto-genere)",
          features: [],
        };
        state.featureCountByEpic.set(autoEpicCode, 0);
        result.warnings.push(
          `Feature avant tout Epic : Epic ${autoEpicCode} cree automatiquement.`
        );
      }

      const epicCode = state.currentEpic.code;
      const currentCount = state.featureCountByEpic.get(epicCode) ?? 0;
      const nextNum = currentCount + 1;
      state.featureCountByEpic.set(epicCode, nextNum);

      const resolvedCode = `F${pad2(state.currentEpicNumber)}.${nextNum}`;

      const newFeature: ParsedFeature = {
        code: resolvedCode,
        epicCode,
        title: text.trim(),
        description: "",
        rules: [],
        scenarios: [],
      };
      state.currentFeature = newFeature;
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

  if (result.epics.length === 0 && result.orphanFeatures.length === 0) {
    result.warnings.push(
      "Aucun heading detecte. Verifiez que le document utilise '# Titre Epic' et '## Titre Feature'."
    );
  }

  return result;
}
