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
 * Extrait un code Epic optionnel (E01, E1, E12...) du debut du texte.
 * Tolere les prefixes "EPIC", "Epic", suivis ou non d'un code.
 *
 * Retourne { code: "E01" | null, title: "..." }
 *
 * Exemples :
 *   "EPIC E03 : Authentification"     -> { code: "E03", title: "Authentification" }
 *   "EPIC : Authentification"         -> { code: null, title: "Authentification" }
 *   "EPIC Authentification"           -> { code: null, title: "Authentification" }
 *   "E03 : Authentification"          -> { code: "E03", title: "Authentification" }
 *   "Authentification"                -> { code: null, title: "Authentification" }
 */
function parseEpicHeading(text: string): { code: string | null; title: string } {
  let remaining = text.trim();

  // 1. Strip prefix "EPIC" / "Epic" optionnel (case-insensitive, avec eventuel ":" apres)
  const epicPrefixMatch = remaining.match(/^EPIC\b\s*[:\-–—]?\s*(.*)$/i);
  if (epicPrefixMatch) {
    remaining = epicPrefixMatch[1].trim();
  }

  // 2. Si on a un code E\d+ au debut, on l'extrait
  const codeMatch = remaining.match(/^(E\d+)\s*[:\-–—]?\s*(.*)$/i);
  if (codeMatch) {
    return {
      code: codeMatch[1].toUpperCase(),
      title: codeMatch[2].trim() || remaining,
    };
  }

  // 3. Sinon le titre = tout le texte restant
  return { code: null, title: remaining };
}

/**
 * Extrait un code Feature optionnel (F01.1, F1.2...) du debut du texte.
 * Meme logique que parseEpicHeading mais pour Feature.
 *
 * Exemples :
 *   "FEATURE F01.1 : Login email"     -> { code: "F01.1", title: "Login email" }
 *   "FEATURE : Login email"           -> { code: null, title: "Login email" }
 *   "F01.1 : Login email"             -> { code: "F01.1", title: "Login email" }
 *   "Login email"                     -> { code: null, title: "Login email" }
 */
function parseFeatureHeading(text: string): { code: string | null; title: string } {
  let remaining = text.trim();

  const featPrefixMatch = remaining.match(/^FEATURE\b\s*[:\-–—]?\s*(.*)$/i);
  if (featPrefixMatch) {
    remaining = featPrefixMatch[1].trim();
  }

  const codeMatch = remaining.match(/^(F\d+(?:\.\d+)?)\s*[:\-–—]?\s*(.*)$/i);
  if (codeMatch) {
    return {
      code: codeMatch[1].toUpperCase(),
      title: codeMatch[2].trim() || remaining,
    };
  }

  return { code: null, title: remaining };
}

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
  /** Set de codes Epic deja utilises pour eviter les collisions auto-genere vs explicite */
  usedEpicCodes: Set<string>;
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
    usedEpicCodes: new Set(),
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
      // Le format est tres permissif : "# EPIC E03 : Foo", "# EPIC : Foo",
      // "# E03 : Foo", "# Foo" ... fonctionnent tous.
      const { code: parsedCode, title: parsedTitle } = parseEpicHeading(text);

      if (!parsedTitle) {
        result.warnings.push(
          `Ligne ignorée : heading H1 sans titre exploitable : "${text.slice(0, 80)}"`
        );
        continue;
      }

      flushEpic(state, result);

      // Resolution du code Epic : utilise le code parse si fourni et libre,
      // sinon auto-genere E01, E02, ... en evitant les collisions.
      let resolvedCode: string;
      if (parsedCode && !state.usedEpicCodes.has(parsedCode)) {
        resolvedCode = parsedCode;
      } else {
        if (parsedCode && state.usedEpicCodes.has(parsedCode)) {
          result.warnings.push(
            `Code Epic "${parsedCode}" deja utilise, auto-numerotation appliquee.`
          );
        }
        // On incremente jusqu'a trouver un code libre
        do {
          state.epicAutoCounter += 1;
        } while (state.usedEpicCodes.has(`E${pad2(state.epicAutoCounter)}`));
        resolvedCode = `E${pad2(state.epicAutoCounter)}`;
      }

      state.usedEpicCodes.add(resolvedCode);

      // Numero d'epic = chiffre du code (E03 -> 3) pour deriver les Features F03.x
      const epicNumMatch = resolvedCode.match(/^E(\d+)$/);
      state.currentEpicNumber = epicNumMatch ? parseInt(epicNumMatch[1], 10) : 0;

      state.currentEpic = {
        code: resolvedCode,
        title: parsedTitle,
        features: [],
      };
      state.currentSection = null;
      continue;
    }

    // Niveau 2 (##) = FEATURE
    if (level === 2) {
      const { code: parsedCode, title: parsedTitle } = parseFeatureHeading(text);

      if (!parsedTitle) {
        result.warnings.push(
          `Ligne ignorée : heading H2 sans titre exploitable : "${text.slice(0, 80)}"`
        );
        continue;
      }

      flushFeature(state);

      // Resolution du code Feature :
      // - Si parsedCode fourni : on l'utilise (sauf si l'epic ne correspond pas)
      // - Sinon : auto-genere F<numEpic>.<numFeatureSuivant>
      let resolvedCode: string;
      const epicCodeForChild = state.currentEpic
        ? state.currentEpic.code
        : `E${pad2(state.currentEpicNumber || 1)}`;

      if (parsedCode) {
        resolvedCode = parsedCode;
      } else {
        // Auto-numerotation : F<epicNum>.<count+1>
        const epicNumForFeature = state.currentEpicNumber || 1;
        const currentCount =
          state.featureCountByEpic.get(epicCodeForChild) ?? 0;
        const nextNum = currentCount + 1;
        resolvedCode = `F${pad2(epicNumForFeature)}.${nextNum}`;
      }

      // Met a jour le compteur pour cet Epic, en se basant sur le numero
      // extrait du code resolu (utile aussi quand l'utilisateur fournit un code F03.5
      // pour que la prochaine Feature auto soit F03.6)
      const featureNumMatch = resolvedCode.match(/^F\d+\.(\d+)$/);
      if (featureNumMatch) {
        const nextNum = parseInt(featureNumMatch[1], 10);
        const currentCount =
          state.featureCountByEpic.get(epicCodeForChild) ?? 0;
        state.featureCountByEpic.set(
          epicCodeForChild,
          Math.max(nextNum, currentCount)
        );
      }

      // Derive le code Epic du code Feature : F01.2 -> E01
      const epicCodeMatch = resolvedCode.match(/^F(\d+)/);
      const epicCode = epicCodeMatch ? `E${epicCodeMatch[1]}` : "";

      const newFeature: ParsedFeature = {
        code: resolvedCode,
        epicCode,
        title: parsedTitle,
        description: "",
        rules: [],
        scenarios: [],
      };
      if (state.currentEpic) {
        state.currentFeature = newFeature;
      } else {
        result.orphanFeatures.push(newFeature);
        result.warnings.push(
          `Feature orpheline (sans Epic parent) : ${resolvedCode} ${parsedTitle.slice(0, 60)}`
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
