import type {
  ParsedScenario,
  ParsedFeature,
  ParsedEpic,
  ParseResult,
} from "./parse-retrospec";

/**
 * Parseur de retro-specs au format MARQUEURS.
 *
 * Format :
 *   - [EPIC] Titre de l'epic         -> cree un Epic, code E01/E02/E03... (auto)
 *   - [FEATURE] Titre de la feature  -> cree une Feature, code F<numEpic>.<num> (auto)
 *   - [CAS DE TEST] Titre du cas (Resultat : attendu)  -> cree un test case
 *
 * Caracteristiques :
 *   - Les codes sont AUTO-GENERES par incrementation, jamais extraits du texte.
 *   - Si le titre contient "F01.1 :" ou "E04 :", ces prefixes sont STRIPPES
 *     (l'utilisateur peut les ecrire mais ils ne sont pas utilises comme codes).
 *   - Les marqueurs sont case-insensitive et tolerent les accents.
 *   - Le contenu entre marqueurs (description, regles) peut etre ecrit en
 *     Markdown libre via les sections '### Description', '### Regles metier',
 *     '### Scenarios de test'. Mais les [CAS DE TEST] explicites sont aussi
 *     pris en compte directement.
 *
 * Exemple :
 *
 *   [EPIC] Gestion de la qualite
 *
 *   [FEATURE] F01.1 : Auto-inscription des collaborateurs
 *
 *   ### Description
 *   Permettre aux nouveaux collaborateurs de s'inscrire.
 *
 *   ### Regles metier
 *   - Email professionnel obligatoire
 *   - Validation par le manager
 *
 *   [CAS DE TEST] Inscription reussie (Resultat : compte cree)
 *   [CAS DE TEST] Email invalide (Resultat : message d'erreur)
 *
 *   [FEATURE] Modification du profil
 *
 *   [EPIC] Reporting
 *
 *   [FEATURE] Export PDF
 *
 * Resultat :
 *   - E01 'Gestion de la qualite'
 *     - F01.1 'Auto-inscription des collaborateurs'
 *       - cas 1 : 'Inscription reussie' (resultat : 'compte cree')
 *       - cas 2 : 'Email invalide' (resultat : 'message d''erreur')
 *     - F01.2 'Modification du profil'
 *   - E02 'Reporting'
 *     - F02.1 'Export PDF'
 */

export interface MarkerParseResult extends ParseResult {
  /** Version extraite du frontmatter, si presente. Null sinon. */
  detectedVersion: string | null;
}

// ─────────────────────────────────────────────────────────────
// Detection format marqueurs
// ─────────────────────────────────────────────────────────────

/**
 * Detecte si une chaine utilise le format MARQUEURS [EPIC] / [FEATURE] / [CAS DE TEST].
 * Retourne true si au moins un marqueur est present, peu importe la casse.
 */
export function looksLikeMarkerFormat(input: string): boolean {
  // Detection souple : un marqueur quelque part dans le texte
  return /\[\s*(EPIC|FEATURE|CAS\s+DE\s+TEST)\s*\]/i.test(input);
}

// ─────────────────────────────────────────────────────────────
// Frontmatter YAML simple (cle: valeur)
// Reutilise du format Markdown
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
// Helpers
// ─────────────────────────────────────────────────────────────

/**
 * Pad un nombre sur 2 chiffres minimum (1 -> "01", 12 -> "12").
 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Strippe les prefixes de code optionnels du titre.
 * L'utilisateur peut ecrire "[FEATURE] F01.1 : Mon titre" : le "F01.1 :" est nettoye
 * pour ne stocker que "Mon titre".
 *
 * Aussi : strippe "EPIC E04 : ", "FEATURE F04.2 - ", "E04 : ", etc.
 */
function stripCodePrefix(title: string): string {
  let cleaned = title.trim();

  // Strip EPIC/FEATURE keyword optionnel
  cleaned = cleaned.replace(/^(EPIC|FEATURE)\b\s*[:\-–—]?\s*/i, "");

  // Strip code optionnel (E\d+ ou F\d+\.\d+)
  cleaned = cleaned.replace(/^(E\d+|F\d+\.\d+)\s*[:\-–—]?\s*/i, "");

  return cleaned.trim();
}

/**
 * Pour un cas de test "Titre du cas (Resultat : attendu)", separe titre et expected.
 */
function parseScenarioInline(text: string): ParsedScenario {
  const m = text.match(
    /^(.*?)\s*\((?:R[ée]sultat|Resultat|Expected)\s*:\s*(.+?)\)\s*$/i
  );
  if (m) {
    return {
      title: m[1].trim().slice(0, 200),
      expected: m[2].trim().slice(0, 1000),
    };
  }
  return {
    title: text.trim().slice(0, 200),
    expected: "(résultat attendu non précisé dans la spec)",
  };
}

// ─────────────────────────────────────────────────────────────
// Sections de contenu (description, regles, scenarios)
// ─────────────────────────────────────────────────────────────

const SECTION_KEYWORDS = {
  description: ["description"],
  rules: [
    "règles métier",
    "regles metier",
    "regles",
    "rules",
    "règles",
    "business rules",
    "règles & contraintes",
    "regles & contraintes",
  ],
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

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const LIST_ITEM_RE = /^[\-\*+]\s+(.+)$/;
const MARKER_RE =
  /^\s*\[\s*(EPIC|FEATURE|CAS\s+DE\s+TEST)\s*\]\s*(.*)$/i;

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
  /** Nombre d'Epics deja crees dans le document (pour incrementer E01, E02...) */
  epicCount: number;
  /** Nombre de Features par Epic (cle = code Epic) pour F<num>.<feat> */
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
      state.currentFeature.description = state.currentFeature.description
        ? `${state.currentFeature.description}\n\n${text}`
        : text;
      break;

    case "rules":
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
      // Items de liste = scenarios
      for (const line of state.sectionBuffer) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const m = trimmed.match(LIST_ITEM_RE);
        if (!m) continue;
        state.currentFeature.scenarios.push(parseScenarioInline(m[1]));
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

function flushEpic(state: ParsingState, result: MarkerParseResult): void {
  flushFeature(state);
  if (state.currentEpic) {
    result.epics.push(state.currentEpic);
  }
  state.currentEpic = null;
}

// ─────────────────────────────────────────────────────────────
// Parser principal
// ─────────────────────────────────────────────────────────────

export function parseRetroSpecMarkers(input: string): MarkerParseResult {
  const result: MarkerParseResult = {
    epics: [],
    orphanFeatures: [],
    warnings: [],
    counts: { epics: 0, features: 0, testCases: 0 },
    detectedVersion: null,
  };

  if (!input || input.trim().length === 0) {
    result.warnings.push("Le document est vide.");
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
    epicCount: 0,
    featureCountByEpic: new Map(),
  };

  for (const line of lines) {
    // 1. Marqueur prioritaire : [EPIC], [FEATURE], [CAS DE TEST]
    const markerMatch = line.match(MARKER_RE);
    if (markerMatch) {
      // Avant de traiter le marqueur, on flushe la section en cours
      if (state.currentSection && state.currentFeature) {
        flushSection(state);
      }

      const markerType = markerMatch[1].toUpperCase().replace(/\s+/g, "_");
      const rawTitle = markerMatch[2] ?? "";
      const cleanedTitle = stripCodePrefix(rawTitle);

      // [EPIC] : nouveau Epic, code E01/E02/E03... auto-incremente
      if (markerType === "EPIC") {
        if (!cleanedTitle) {
          result.warnings.push(
            `[EPIC] sans titre, ignore : "${line.trim().slice(0, 80)}"`
          );
          continue;
        }
        flushEpic(state, result);
        state.epicCount += 1;
        const epicCode = `E${pad2(state.epicCount)}`;
        state.currentEpic = {
          code: epicCode,
          title: cleanedTitle,
          features: [],
        };
        // Reset compteur Feature pour ce nouvel Epic
        state.featureCountByEpic.set(epicCode, 0);
        state.currentSection = null;
        continue;
      }

      // [FEATURE] : nouvelle Feature, code F<numEpic>.<num> auto-incremente
      if (markerType === "FEATURE") {
        if (!cleanedTitle) {
          result.warnings.push(
            `[FEATURE] sans titre, ignore : "${line.trim().slice(0, 80)}"`
          );
          continue;
        }

        flushFeature(state);

        // Si pas d'Epic ouvert, on en cree un par defaut pour ne pas perdre la Feature
        if (!state.currentEpic) {
          state.epicCount += 1;
          const autoEpicCode = `E${pad2(state.epicCount)}`;
          state.currentEpic = {
            code: autoEpicCode,
            title: "(Epic implicite)",
            features: [],
          };
          state.featureCountByEpic.set(autoEpicCode, 0);
          result.warnings.push(
            `[FEATURE] avant tout [EPIC] : Epic implicite ${autoEpicCode} cree.`
          );
        }

        const epicCode = state.currentEpic.code;
        const epicNum = parseInt(epicCode.replace(/^E0*/, ""), 10) || 1;
        const currentFeatCount = state.featureCountByEpic.get(epicCode) ?? 0;
        const nextFeatNum = currentFeatCount + 1;
        state.featureCountByEpic.set(epicCode, nextFeatNum);

        const featureCode = `F${pad2(epicNum)}.${nextFeatNum}`;

        state.currentFeature = {
          code: featureCode,
          epicCode,
          title: cleanedTitle,
          description: "",
          rules: [],
          scenarios: [],
        };
        state.currentSection = null;
        continue;
      }

      // [CAS DE TEST] : nouveau cas de test sur la Feature courante
      if (markerType === "CAS_DE_TEST") {
        if (!cleanedTitle) {
          result.warnings.push(
            `[CAS DE TEST] sans titre, ignore : "${line.trim().slice(0, 80)}"`
          );
          continue;
        }
        if (!state.currentFeature) {
          result.warnings.push(
            `[CAS DE TEST] avant toute [FEATURE] : ignore. Ajoutez d'abord une [FEATURE].`
          );
          continue;
        }
        state.currentFeature.scenarios.push(parseScenarioInline(cleanedTitle));
        continue;
      }
    }

    // 2. Heading Markdown classique pour les sections
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();

      // Avant de changer de section, on flushe la section en cours
      if (state.currentSection && state.currentFeature) {
        flushSection(state);
      }

      // On accepte uniquement les headings >= 3 (### Description, etc.)
      // Les # et ## en mode marqueurs sont ignores : on attend [EPIC] / [FEATURE]
      if (level >= 3) {
        const section = detectSection(headingText);
        if (section && state.currentFeature) {
          state.currentSection = section;
          state.sectionBuffer = [];
        } else {
          state.currentSection = null;
        }
      }
      continue;
    }

    // 3. Ligne de contenu : on l'ajoute au buffer de la section courante
    if (state.currentSection) {
      state.sectionBuffer.push(line);
    }
  }

  // Flush final
  flushEpic(state, result);

  // Compteurs
  result.counts.epics = result.epics.length;
  for (const epic of result.epics) {
    result.counts.features += epic.features.length;
    for (const f of epic.features) {
      result.counts.testCases += f.scenarios.length;
    }
  }

  if (result.epics.length === 0 && result.orphanFeatures.length === 0) {
    result.warnings.push(
      "Aucun [EPIC] / [FEATURE] detecte dans le document."
    );
  }

  return result;
}
