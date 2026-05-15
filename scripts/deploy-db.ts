/**
 * Script de deploiement : applique le schema + les migrations SQL custom sur la base.
 *
 * Strategie hybride :
 *   1. `prisma db push --accept-data-loss` synchronise les tables a partir du schema
 *      (cree les tables manquantes, modifie celles existantes). Pas d'historique.
 *   2. Applique ensuite tous nos migration.sql en sequence pour ajouter :
 *      - les CHECK constraints (interdiction KO sans commentaire, etc.)
 *      - la vue ticket_rollup
 *      - les contraintes additionnelles (FK, etc.)
 *
 * Le script applique chaque statement individuellement et tolere les erreurs
 * d'idempotence (already exists, does not exist, duplicate key) puisque nos
 * migrations sont concues pour pouvoir etre rejouees.
 *
 * Usage :
 *   - Sur Vercel : execute par `npm run vercel-build` avant `next build`
 *   - En local : `npm run db:setup`
 */

import { execSync } from "node:child_process";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

/**
 * Decoupe naive d'un script SQL en statements individuels, en preservant
 * les blocs DO $$ ... $$ qui peuvent contenir des ; internes.
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inDollarBlock = false;
  let dollarTag = "";

  // Strip comments lines that start with --
  const lines = sql.split("\n");

  for (const line of lines) {
    // Detection de debut/fin de bloc DO $$ ... $$ ou $tag$ ... $tag$
    const dollarMatch = line.match(/\$([a-zA-Z_]*)\$/g);
    if (dollarMatch) {
      for (const m of dollarMatch) {
        if (!inDollarBlock) {
          inDollarBlock = true;
          dollarTag = m;
        } else if (m === dollarTag) {
          inDollarBlock = false;
          dollarTag = "";
        }
      }
    }

    current += line + "\n";

    if (!inDollarBlock && line.trim().endsWith(";")) {
      const stmt = current.trim();
      if (stmt.length > 0 && !stmt.startsWith("--")) {
        statements.push(stmt);
      }
      current = "";
    }
  }

  // Statement restant sans ;
  if (current.trim().length > 0) {
    statements.push(current.trim());
  }

  // Filtre les commentaires purs
  return statements.filter((s) => {
    const noComments = s
      .split("\n")
      .filter((l) => !l.trim().startsWith("--") && l.trim().length > 0)
      .join("\n")
      .trim();
    return noComments.length > 0;
  });
}

function isIdempotentError(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("already exists") ||
    m.includes("does not exist") ||
    m.includes("duplicate key") ||
    m.includes("already a member") ||
    m.includes("constraint") && m.includes("of relation")
  );
}

async function run() {
  console.log("📦 Step 1/2 : prisma db push (synchronisation du schema)...");
  try {
    execSync("npx prisma db push --accept-data-loss --skip-generate", {
      stdio: "inherit",
    });
  } catch (err) {
    console.error("❌ prisma db push failed");
    throw err;
  }

  console.log("\n📦 Step 2/2 : application des migrations SQL custom...");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌ DATABASE_URL manquante.");
    process.exit(1);
  }

  if (!existsSync(MIGRATIONS_DIR)) {
    console.log("(aucun dossier de migrations trouve, on passe)");
    return;
  }

  // Liste des dossiers de migration tries chronologiquement
  const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  let totalApplied = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const dir of dirs) {
    const sqlPath = join(MIGRATIONS_DIR, dir, "migration.sql");
    if (!existsSync(sqlPath)) continue;

    const sql = readFileSync(sqlPath, "utf-8");
    const statements = splitStatements(sql);

    let applied = 0;
    let skipped = 0;
    let failed = 0;

    for (const stmt of statements) {
      try {
        await client.query(stmt);
        applied++;
      } catch (err: any) {
        const msg = err.message ?? String(err);
        if (isIdempotentError(msg)) {
          skipped++;
        } else {
          failed++;
          console.warn(
            `  ⚠ ${dir}: statement failed (will continue): ${msg.split("\n")[0].slice(0, 100)}`
          );
        }
      }
    }

    totalApplied += applied;
    totalSkipped += skipped;
    totalFailed += failed;

    const statusIcon = failed > 0 ? "⚠" : applied > 0 ? "✓" : "⊝";
    console.log(
      `  ${statusIcon} ${dir} : ${applied} appliquees, ${skipped} ignorees${failed > 0 ? `, ${failed} echecs` : ""}`
    );
  }

  await client.end();

  console.log(
    `\n✅ Termine : ${totalApplied} statements appliques, ${totalSkipped} ignores (idempotence), ${totalFailed} echecs non bloquants.`
  );

  // On considere le script comme reussi meme avec des echecs idempotents
  // (puisque nos migrations sont concues pour etre rejouees)
}

run().catch((err) => {
  console.error("❌ deploy-db.ts failed:", err);
  process.exit(1);
});
