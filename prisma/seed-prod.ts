/**
 * Seed de production / staging.
 *
 * Cree UNIQUEMENT le compte ADMIN initial s'il n'existe pas.
 * Ne supprime rien et ne cree pas de donnees de demo.
 *
 * A executer une seule fois apres le deploiement initial sur Vercel/Neon :
 *   npm run db:seed:prod
 *
 * Variables d'environnement requises :
 *   - DATABASE_URL : URL Postgres
 *   - SEED_ADMIN_EMAIL : email du futur compte admin
 *   - SEED_ADMIN_PASSWORD : mot de passe (8 caracteres minimum)
 *   - SEED_ADMIN_NAME : nom affiche (optionnel, defaut "Administrateur")
 *
 * Securite :
 *   - Mot de passe hashe bcrypt cout 12
 *   - Idempotent : si le compte admin existe deja, ne fait rien
 *   - Refuse de continuer si les variables ne sont pas remplies
 */

import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME ?? "Administrateur";

  // Validation des variables d'env
  if (!email || !password) {
    console.error(
      "❌ Variables manquantes : SEED_ADMIN_EMAIL et SEED_ADMIN_PASSWORD sont requises."
    );
    console.error("   Renseignez-les dans .env (en local) ou dans les Environment Variables Vercel.");
    process.exit(1);
  }

  if (!email.includes("@") || email.length < 5) {
    console.error("❌ SEED_ADMIN_EMAIL invalide :", email);
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("❌ SEED_ADMIN_PASSWORD trop court (minimum 8 caracteres).");
    process.exit(1);
  }

  // Verifie si un user avec cet email existe deja
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, name: true },
  });

  if (existing) {
    console.log(`✅ Compte deja existant : ${email} (role : ${existing.role}, nom : ${existing.name}).`);
    console.log("   Aucune action necessaire.");
    return;
  }

  // Verifie si au moins un ADMIN existe deja (pour eviter de creer un 2eme par accident)
  const adminCount = await prisma.user.count({
    where: { role: Role.ADMIN },
  });
  if (adminCount > 0) {
    console.warn(`⚠️  Il existe deja ${adminCount} compte(s) ADMIN dans la base.`);
    console.warn(`   Le compte ${email} sera cree comme ADMIN supplementaire.`);
  }

  console.log(`🌱 Creation du compte ADMIN ${email}...`);
  const hashedPassword = await bcrypt.hash(password, 12);

  const admin = await prisma.user.create({
    data: {
      email,
      name,
      role: Role.ADMIN,
      hashedPassword,
      hourlyRateCents: 0,
    },
    select: { id: true, email: true, name: true },
  });

  // Audit log : trace la creation
  await prisma.auditLog.create({
    data: {
      userId: admin.id,
      action: "USER.CREATED_BY_SEED",
      entityType: "User",
      entityId: admin.id,
      metadata: {
        email: admin.email,
        role: "ADMIN",
        source: "seed:prod",
      },
    },
  });

  console.log(`✅ Compte ADMIN cree : ${admin.email}`);
  console.log(`   Connectez-vous sur l'app avec ces identifiants.`);
  console.log(`   Vous pourrez ensuite creer d'autres utilisateurs depuis l'interface.`);
}

main()
  .catch((e) => {
    console.error("❌ Seed prod failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
