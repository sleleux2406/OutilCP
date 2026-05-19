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
 * Extrait le code Epic E<digits> et le titre nettoye d'un texte de heading H1.
 *
 * Reconnait :
 *   - "EPIC E04 : Gestion de la Qualite"  -> code = "E04", title = "Gestion de la Qualite"
 *   - "Epic E04 - Gestion"                -> code = "E04", title = "Gestion"
 *   - "E04 : Gestion"                     -> code = "E04", title = "Gestion"
 *   - "Gestion de la Qualite"             -> code = null, title = "Gestion de la Qualite"
 *
 * Le titre stocke est SANS le prefixe et SANS le code (titre nettoye).
 * Si pas de code detecte, retourne code = null pour que l'appelant fasse
 * un fallback auto-incrementation.
 */
function extractEpicCodeAndTitle(text: string): { code: string | null; title: string } {
  const trimmed = text.trim();

  // Strip prefix "EPIC" / "Epic" optionnel (case-insensitive), avec eventuel separateur
  let remaining = trimmed;
  const epicPrefix = remaining.match(/^EPIC\b\s*[:\-–—]?\s*(.*)$/i);
  if (epicPrefix) {
    remaining = epicPrefix[1].trim();
  }

  // Cherche un code E<digits> au debut
  const codeMatch = remaining.match(/^(E\d+)\s*[:\-–—]?\s*(.*)$/i);
  if (codeMatch) {
    const code = codeMatch[1].toUpperCase();
    const cleanTitle = codeMatch[2].trim();
    // Si le titre est vide apres extraction, on retombe sur le texte original sans le prefix
    return { code, title: cleanTitle.length > 0 ? cleanTitle : remaining };
  }

  // Pas de code detecte, on retourne le texte original (sans le prefix EPIC strip)
  return { code: null, title: remaining };
}

/**
 * Extrait le code Feature F<digits>.<digits> et le titre nettoye d'un texte de heading H2.
 *
 * Reconnait :
 *   - "FEATURE F04.2 : Test Runner"   -> code = "F04.2", title = "Test Runner"
 *   - "Feature F04.2 - Test Runner"   -> code = "F04.2", title = "Test Runner"
 *   - "F04.2 : Test Runner"           -> code = "F04.2", title = "Test Runner"
 *   - "F04.2 Test Runner"             -> code = "F04.2", title = "Test Runner"
 *   - "Test Runner"                   -> code = null, title = "Test Runner"
 *
 * Si pas de code detecte, retourne code = null pour fallback auto.
 */
function extractFeatureCodeAndTitle(text: string): { code: string | null; title: string } {
  const trimmed = text.trim();

  let remaining = trimmed;
  const featPrefix = remaining.match(/^FEATURE\b\s*[:\-–—]?\s*(.*)$/i);
  if (featPrefix) {
    remaining = featPrefix[1].trim();
  }

  // Cherche un code F<digits>.<digits> au debut (la partie .digits est requise pour distinguer
  // d'un texte commencant par F suivi d'un chiffre)
  const codeMatch = remaining.match(/^(F\d+\.\d+)\s*[:\-–—]?\s*(.*)$/i);
  if (codeMatch) {
    const code = codeMatch[1].toUpperCase();
    const cleanTitle = codeMatch[2].trim();
    return { code, title: cleanTitle.length > 0 ? cleanTitle : remaining };
  }

  return { code: null, title: remaining };
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
  /** Codes Epic deja vus dans le document (pour detecter les doublons explicites) */
  seenEpicCodes: Set<string>;
  /** Codes Feature deja vus dans le document (pour detecter les doublons explicites) */
  seenFeatureCodes: Set<string>;
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
    seenEpicCodes: new Set(),
    seenFeatureCodes: new Set(),
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

    // Niveau 1 (#) = EPIC.
    // Le code Epic DOIT etre present dans le titre (ex: "EPIC E04 : Foo" ou
    // "E04 : Foo"). Sinon le heading est rejete avec un warning.
    // Aucune auto-generation : on respecte strictement les codes du document.
    if (level === 1) {
      const trimmed = text.trim();
      if (!trimmed) {
        result.warnings.push(`Heading H1 vide ignoré.`);
        continue;
      }

      const { code: extractedCode, title: cleanTitle } = extractEpicCodeAndTitle(trimmed);

      if (!extractedCode) {
        result.warnings.push(
          `Heading H1 sans code Epic detecte, ignore : "${trimmed.slice(0, 80)}". Format attendu : "# EPIC E04 : Titre" ou "# E04 : Titre".`
        );
        // On ferme l'Epic precedent quand meme pour ne pas rattacher des
        // Features suivantes a un Epic obsolete
        flushEpic(state, result);
        state.currentSection = null;
        continue;
      }

      // Detection des doublons explicites (le document ne devrait pas avoir
      // deux fois le meme code)
      if (state.seenEpicCodes.has(extractedCode)) {
        result.warnings.push(
          `Code Epic "${extractedCode}" deja vu dans le document, ce heading est ignore : "${trimmed.slice(0, 80)}".`
        );
        flushEpic(state, result);
        state.currentSection = null;
        continue;
      }

      flushEpic(state, result);
      state.seenEpicCodes.add(extractedCode);

      state.currentEpic = {
        code: extractedCode,
        title: cleanTitle,
        features: [],
      };
      state.currentSection = null;
      continue;
    }

    // Niveau 2 (##) = FEATURE.
    // Le code Feature DOIT etre present dans le titre (ex: "FEATURE F04.2 : Foo"
    // ou "F04.2 : Foo"). Sinon le heading est rejete avec un warning.
    // Aucune auto-generation : on respecte strictement les codes du document.
    if (level === 2) {
      const trimmed = text.trim();
      if (!trimmed) {
        result.warnings.push(`Heading H2 vide ignoré.`);
        continue;
      }

      const { code: extractedCode, title: cleanTitle } =
        extractFeatureCodeAndTitle(trimmed);

      if (!extractedCode) {
        result.warnings.push(
          `Heading H2 sans code Feature detecte, ignore : "${trimmed.slice(0, 80)}". Format attendu : "## FEATURE F04.2 : Titre" ou "## F04.2 : Titre".`
        );
        flushFeature(state);
        state.currentSection = null;
        continue;
      }

      if (state.seenFeatureCodes.has(extractedCode)) {
        result.warnings.push(
          `Code Feature "${extractedCode}" deja vu dans le document, ce heading est ignore : "${trimmed.slice(0, 80)}".`
        );
        flushFeature(state);
        state.currentSection = null;
        continue;
      }

      flushFeature(state);

      // Si pas d'Epic ouvert, on rejette la Feature (pas d'auto-creation d'Epic)
      if (!state.currentEpic) {
        result.warnings.push(
          `Feature ${extractedCode} avant tout Epic : ignoree. Ajoutez d'abord un heading "# EPIC EXX : ...".`
        );
        state.currentSection = null;
        continue;
      }

      state.seenFeatureCodes.add(extractedCode);

      // Derive le code Epic depuis le code Feature pour le champ epicCode
      // (utilise par certains traitements en aval). Si la Feature commence
      // par F04.2 alors epicCode derive = E04. Si l'Epic courant a un autre
      // code, on garde celui de l'Epic courant pour la coherence d'arbre.
      const epicCodeMatch = extractedCode.match(/^F(\d+)/);
      const derivedEpicCode = epicCodeMatch ? `E${epicCodeMatch[1]}` : "";
      const epicCode = state.currentEpic.code;

      // Warning si le code Feature ne semble pas correspondre a l'Epic courant
      if (
        derivedEpicCode &&
        derivedEpicCode !== epicCode &&
        // On compare aussi sans padding : F4.2 -> E4 vs E04 doivent matcher
        derivedEpicCode.replace(/^E0+/, "E") !== epicCode.replace(/^E0+/, "E")
      ) {
        result.warnings.push(
          `Code Feature ${extractedCode} ne correspond pas au code Epic courant ${epicCode}. La Feature est rattachee a ${epicCode}.`
        );
      }

      const newFeature: ParsedFeature = {
        code: extractedCode,
        epicCode,
        title: cleanTitle,
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
