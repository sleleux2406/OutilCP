/**
 * Parseur de rétro-spécification en texte brut vers une structure Epic/Feature/TestCase.
 *
 * Format attendu (convention du document de référence) :
 *
 *   EPIC E01 : Titre de l'Epic
 *   – FEATURE F01.1 : Titre de la Feature
 *     – Description : Texte libre
 *     – Règles métier & Contraintes : Règle 1; Règle 2; Règle 3
 *     – Scénarios de Test : Titre cas 1 (Résultat : attendu 1); Titre cas 2 (Résultat : attendu 2)
 *   – FEATURE F01.2 : ...
 *   EPIC E02 : ...
 *
 * Tolérances :
 *   - Les tirets de séparation peuvent être – (U+2013), — (U+2014), ou - (ASCII)
 *   - Le texte peut être sur une seule ligne ou multiligne
 *   - Les espaces multiples sont normalisés en un seul
 *   - Chaque section (Description / Règles / Scénarios) est optionnelle
 *
 * La fonction retourne un objet structuré + des warnings non bloquants pour
 * aider l'utilisateur à repérer les anomalies (Feature orpheline, scénario mal
 * formaté, etc.).
 */

export interface ParsedScenario {
  /** Titre du scénario (partie avant le "(Résultat : ...)") */
  title: string;
  /** Résultat attendu (extrait de "(Résultat : ...)") */
  expected: string;
}

export interface ParsedFeature {
  /** Code brut, ex: "F01.1" */
  code: string;
  /** Code Epic parent dérivé, ex: "E01" */
  epicCode: string;
  /** Titre de la Feature (après le ":") */
  title: string;
  /** Contenu de la section Description (ou chaîne vide) */
  description: string;
  /** Règles extraites (liste, séparées par ";") */
  rules: string[];
  /** Scénarios de test structurés */
  scenarios: ParsedScenario[];
}

export interface ParsedEpic {
  /** Code, ex: "E01" */
  code: string;
  /** Titre après le ":" */
  title: string;
  /** Features rattachées à cet Epic */
  features: ParsedFeature[];
}

export interface ParseResult {
  epics: ParsedEpic[];
  /** Features détectées mais sans Epic parent valide (code sans match) */
  orphanFeatures: ParsedFeature[];
  /** Avertissements non bloquants à afficher à l'utilisateur */
  warnings: string[];
  /** Compteurs pour l'UI preview */
  counts: {
    epics: number;
    features: number;
    testCases: number;
  };
}

// ─────────────────────────────────────────────────────────────
// Normalisation préalable du texte
// ─────────────────────────────────────────────────────────────

/**
 * Normalise les séparateurs et espaces pour simplifier le parsing.
 * - Convertit – (U+2013) et — (U+2014) en un marqueur unique "§"
 * - Écrase les séquences d'espaces/sauts de ligne en un seul espace
 * - Trim global
 */
function normalize(input: string): string {
  return input
    .replace(/[\u2013\u2014]/g, "§") // tirets cadratins → marqueur
    .replace(/\s+/g, " ")            // espaces multiples → un seul
    .trim();
}

// ─────────────────────────────────────────────────────────────
// Extraction des blocs Epic / Feature
// ─────────────────────────────────────────────────────────────

const EPIC_REGEX = /\bEPIC\s+(E\d+)\s*:\s*/g;
const FEATURE_REGEX = /\bFEATURE\s+(F\d+(?:\.\d+)+)\s*:\s*/g;

interface Block {
  type: "EPIC" | "FEATURE";
  code: string;
  /** Position de début du bloc (index dans la string normalisée) */
  start: number;
  /** Position du début du contenu (après le ":") */
  contentStart: number;
}

/**
 * Détecte toutes les positions des marqueurs EPIC/FEATURE dans l'ordre
 * d'apparition dans le texte normalisé.
 */
function findBlocks(text: string): Block[] {
  const blocks: Block[] = [];

  // Epics
  EPIC_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EPIC_REGEX.exec(text)) !== null) {
    blocks.push({
      type: "EPIC",
      code: match[1],
      start: match.index,
      contentStart: match.index + match[0].length,
    });
  }

  // Features
  FEATURE_REGEX.lastIndex = 0;
  while ((match = FEATURE_REGEX.exec(text)) !== null) {
    blocks.push({
      type: "FEATURE",
      code: match[1],
      start: match.index,
      contentStart: match.index + match[0].length,
    });
  }

  // Tri par position
  blocks.sort((a, b) => a.start - b.start);

  return blocks;
}

// ─────────────────────────────────────────────────────────────
// Extraction des sections Description / Règles / Scénarios
// ─────────────────────────────────────────────────────────────

/**
 * Dans le contenu d'une Feature, extrait les 3 sections optionnelles.
 * Les tirets (§) sont utilisés comme séparateurs hiérarchiques.
 *
 * Exemple de contenu reçu :
 *   "Gestion de la disponibilité équipe § Description : Texte § Règles métier & Contraintes : r1; r2 § Scénarios de Test : s1 (Résultat : ok); s2 (Résultat : ko)"
 *
 * Retourne { title, description, rules, scenarios }.
 */
function extractFeatureSections(content: string): {
  title: string;
  description: string;
  rules: string[];
  scenarios: ParsedScenario[];
} {
  // Split sur "§" : la première partie est le titre de la Feature,
  // les suivantes sont les sections étiquetées.
  const parts = content.split("§").map((p) => p.trim()).filter((p) => p.length > 0);

  const title = parts[0] ?? "";
  let description = "";
  let rulesRaw = "";
  let scenariosRaw = "";

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (/^Description\s*:/i.test(part)) {
      description = part.replace(/^Description\s*:\s*/i, "").trim();
    } else if (/^R[èe]gles\b/i.test(part)) {
      rulesRaw = part.replace(/^R[èe]gles[^:]*:\s*/i, "").trim();
    } else if (/^Sc[ée]narios\b/i.test(part)) {
      scenariosRaw = part.replace(/^Sc[ée]narios[^:]*:\s*/i, "").trim();
    }
    // Parts non reconnues : ignorées silencieusement (peut-être du bruit)
  }

  const rules = splitAndClean(rulesRaw);
  const scenarios = parseScenarios(scenariosRaw);

  return { title, description, rules, scenarios };
}

/**
 * Coupe sur ";" et nettoie les items vides.
 * Utilisé pour les règles et comme base des scénarios.
 */
function splitAndClean(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Parse les scénarios au format "Titre (Résultat : attendu)".
 * La regex est non-greedy pour le titre et capture tout ce qui suit "Résultat :"
 * jusqu'à la parenthèse fermante finale.
 */
function parseScenarios(raw: string): ParsedScenario[] {
  if (!raw) return [];
  const chunks = splitAndClean(raw);
  const scenarios: ParsedScenario[] = [];

  const scenarioRegex = /^(.+?)\s*\(\s*R[ée]sultat\s*:\s*(.+?)\s*\)\s*$/i;

  for (const chunk of chunks) {
    const m = scenarioRegex.exec(chunk);
    if (m) {
      scenarios.push({
        title: m[1].trim(),
        expected: m[2].trim(),
      });
    } else {
      // Scénario mal formaté : on le garde comme titre sans expected
      scenarios.push({
        title: chunk,
        expected: "",
      });
    }
  }
  return scenarios;
}

// ─────────────────────────────────────────────────────────────
// Extraction du titre d'un Epic (tout jusqu'au prochain bloc)
// ─────────────────────────────────────────────────────────────

function extractEpicTitle(content: string): string {
  // Le contenu d'un Epic est parfois suivi de "§ FEATURE F01.1 : ..." en
  // réalité les Features sont déjà extraites séparément ; ici on ne garde
  // que le texte situé avant tout "§" ou le contenu complet.
  const firstSep = content.indexOf("§");
  const raw = firstSep >= 0 ? content.slice(0, firstSep) : content;
  return raw.trim();
}

// ─────────────────────────────────────────────────────────────
// Fonction principale
// ─────────────────────────────────────────────────────────────

/**
 * Parse le texte d'une rétro-spec et retourne la structure hiérarchique.
 *
 * @param input Texte brut collé par l'utilisateur
 * @throws Ne throw jamais : toutes les erreurs sont retournées via `warnings`.
 */
export function parseRetroSpec(input: string): ParseResult {
  const warnings: string[] = [];

  if (!input || input.trim().length === 0) {
    return {
      epics: [],
      orphanFeatures: [],
      warnings: ["Le texte fourni est vide."],
      counts: { epics: 0, features: 0, testCases: 0 },
    };
  }

  const normalized = normalize(input);
  const blocks = findBlocks(normalized);

  if (blocks.length === 0) {
    return {
      epics: [],
      orphanFeatures: [],
      warnings: [
        "Aucun marqueur EPIC ou FEATURE détecté. Format attendu : 'EPIC E01 : Titre' et 'FEATURE F01.1 : Titre'.",
      ],
      counts: { epics: 0, features: 0, testCases: 0 },
    };
  }

  // Index par code pour regrouper les Features sous leur Epic
  const epicsByCode = new Map<string, ParsedEpic>();
  const orphanFeatures: ParsedFeature[] = [];

  // Détection de doublons
  const seenEpicCodes = new Set<string>();
  const seenFeatureCodes = new Set<string>();

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const next = blocks[i + 1];
    const contentEnd = next ? next.start : normalized.length;
    const content = normalized.slice(block.contentStart, contentEnd).trim();

    if (block.type === "EPIC") {
      if (seenEpicCodes.has(block.code)) {
        warnings.push(`Epic ${block.code} présent plusieurs fois : seule la première occurrence est conservée.`);
        continue;
      }
      seenEpicCodes.add(block.code);
      const title = extractEpicTitle(content);
      if (!title) {
        warnings.push(`Epic ${block.code} sans titre : ignoré.`);
        continue;
      }
      epicsByCode.set(block.code, {
        code: block.code,
        title,
        features: [],
      });
    } else {
      // FEATURE
      if (seenFeatureCodes.has(block.code)) {
        warnings.push(`Feature ${block.code} présente plusieurs fois : seule la première occurrence est conservée.`);
        continue;
      }
      seenFeatureCodes.add(block.code);

      // Le code Feature est F<NumEpic>.<NumFeature>
      // On déduit le code Epic parent en remplaçant "F" par "E" et gardant
      // la partie avant le premier ".".
      // Ex : F01.1 → E01, F02.3 → E02
      const epicCode = "E" + block.code.slice(1).split(".")[0];

      const { title, description, rules, scenarios } = extractFeatureSections(content);
      if (!title) {
        warnings.push(`Feature ${block.code} sans titre : ignorée.`);
        continue;
      }

      const feature: ParsedFeature = {
        code: block.code,
        epicCode,
        title,
        description,
        rules,
        scenarios,
      };

      const parentEpic = epicsByCode.get(epicCode);
      if (parentEpic) {
        parentEpic.features.push(feature);
      } else {
        warnings.push(
          `Feature ${block.code} n'a pas d'Epic parent ${epicCode} détecté. Elle sera listée comme orpheline.`
        );
        orphanFeatures.push(feature);
      }
    }
  }

  const epics = Array.from(epicsByCode.values());
  const totalFeatures =
    epics.reduce((sum, e) => sum + e.features.length, 0) + orphanFeatures.length;
  const totalTestCases = epics.reduce(
    (sumE, e) => sumE + e.features.reduce((sumF, f) => sumF + f.scenarios.length, 0),
    orphanFeatures.reduce((sum, f) => sum + f.scenarios.length, 0)
  );

  return {
    epics,
    orphanFeatures,
    warnings,
    counts: {
      epics: epics.length,
      features: totalFeatures,
      testCases: totalTestCases,
    },
  };
}
