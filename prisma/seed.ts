/**
 * Seed de démonstration.
 *
 * Crée un jeu de données minimal mais réaliste :
 *   - 4 utilisateurs (1 admin, 1 PO, 2 devs, 1 testeuse)
 *   - 1 projet DEMO
 *   - 2 Epics
 *   - 3-4 Features
 *   - 4-5 User Stories
 *   - Quelques tâches et bugs
 *   - Des cas de test sur 2 User Stories
 *   - Quelques time entries pour démontrer le roll-up
 *
 * Exécution : `pnpm db:seed`
 *
 * Sécurité :
 *   - Mots de passe hashés avec bcrypt coût 12 [A02]
 *   - Taux horaires réalistes
 *   - Aucun secret en dur : le seed utilise un mot de passe commun "demo1234"
 *     marqué comme "à changer en production"
 */

import { PrismaClient, TicketStatus, TicketType, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// Mot de passe de démo. Tous les utilisateurs de démo le partagent pour
// simplifier les tests locaux. À ne jamais utiliser en production.
const DEMO_PASSWORD = "demo1234";

async function main() {
  // Garde anti-production : le seed fait un deleteMany() complet,
  // il est catastrophique s'il est exécuté en prod par accident.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "REFUSING TO SEED IN PRODUCTION. Unset NODE_ENV or run in dev/preview only."
    );
  }

  console.log("🌱 Seeding database...");

  // ─── Nettoyage ─────────────────────────────────────────────
  console.log("  Nettoyage des données existantes...");
  await prisma.auditLog.deleteMany();
  await prisma.testExecution.deleteMany();
  await prisma.testRun.deleteMany();
  await prisma.testCase.deleteMany();
  await prisma.timeEntry.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.session.deleteMany();
  await prisma.project.deleteMany();
  await prisma.user.deleteMany();

  // ─── Utilisateurs ──────────────────────────────────────────
  console.log("  Création des utilisateurs...");
  const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, 12);

  const [admin, po, devAlice, devBob, testerCarol] = await Promise.all([
    prisma.user.create({
      data: {
        email: "admin@demo.local",
        name: "Alex Admin",
        role: Role.ADMIN,
        hashedPassword,
        hourlyRateCents: 8000, // 80 €/h
      },
    }),
    prisma.user.create({
      data: {
        email: "po@demo.local",
        name: "Priya Product",
        role: Role.PRODUCT_OWNER,
        hashedPassword,
        hourlyRateCents: 9000,
      },
    }),
    prisma.user.create({
      data: {
        email: "alice@demo.local",
        name: "Alice Dev",
        role: Role.DEVELOPER,
        hashedPassword,
        hourlyRateCents: 6500,
      },
    }),
    prisma.user.create({
      data: {
        email: "bob@demo.local",
        name: "Bob Dev",
        role: Role.DEVELOPER,
        hashedPassword,
        hourlyRateCents: 7000,
      },
    }),
    prisma.user.create({
      data: {
        email: "carol@demo.local",
        name: "Carol Tester",
        role: Role.TESTER,
        hashedPassword,
        hourlyRateCents: 5500,
      },
    }),
  ]);

  // ─── Projet ────────────────────────────────────────────────
  console.log("  Création du projet DEMO...");
  const project = await prisma.project.create({
    data: {
      key: "DEMO",
      name: "Plateforme e-commerce",
      description:
        "Projet de démonstration — module paiement et gestion panier.",
    },
  });

  // ─── Helpers de création ──────────────────────────────────
  let keyCounter = 0;
  const nextKey = () => `${project.key}-${++keyCounter}`;

  const createTicket = async (args: {
    type: TicketType;
    title: string;
    description?: string;
    parentId?: string;
    parentPath?: string;
    status?: TicketStatus;
    priority?: number;
    estimatedMinutes?: number;
    assigneeId?: string;
    creatorId: string;
    boardOrder?: number;
  }) => {
    const path =
      args.parentId && args.parentPath
        ? `${args.parentPath.endsWith("/") ? args.parentPath : args.parentPath + "/"}${args.parentId}/`
        : "/";
    return prisma.ticket.create({
      data: {
        key: nextKey(),
        projectId: project.id,
        type: args.type,
        title: args.title,
        description: args.description ?? null,
        status: args.status ?? TicketStatus.TODO,
        priority: args.priority ?? 3,
        estimatedMinutes: args.estimatedMinutes ?? 0,
        parentId: args.parentId,
        path,
        creatorId: args.creatorId,
        assigneeId: args.assigneeId,
        boardOrder: args.boardOrder ?? keyCounter * 1024,
      },
      select: { id: true, path: true, key: true },
    });
  };

  // ─── Epic 1 : Paiement ────────────────────────────────────
  console.log("  Création de la hiérarchie Epic/Feature/US/Bug...");

  const epicPayment = await createTicket({
    type: TicketType.EPIC,
    title: "Intégration du module de paiement",
    description:
      "Permettre aux clients de payer par carte, PayPal et Apple Pay.",
    status: TicketStatus.IN_PROGRESS,
    priority: 1,
    creatorId: po.id,
  });

  const featureStripe = await createTicket({
    type: TicketType.FEATURE,
    title: "Support Stripe (CB)",
    description: "Intégrer l'API Stripe Checkout v2024.",
    parentId: epicPayment.id,
    parentPath: epicPayment.path,
    status: TicketStatus.IN_PROGRESS,
    priority: 1,
    creatorId: po.id,
    assigneeId: devAlice.id,
  });

  const featurePaypal = await createTicket({
    type: TicketType.FEATURE,
    title: "Support PayPal",
    description: "Bouton PayPal Express Checkout.",
    parentId: epicPayment.id,
    parentPath: epicPayment.path,
    status: TicketStatus.TODO,
    priority: 2,
    creatorId: po.id,
    assigneeId: devBob.id,
  });

  // US sous Stripe
  const usStripeCheckout = await createTicket({
    type: TicketType.USER_STORY,
    title: "En tant que client, je peux payer par CB via Stripe",
    description:
      "Formulaire sécurisé, 3D Secure, redirection de succès/échec.",
    parentId: featureStripe.id,
    parentPath: featureStripe.path,
    status: TicketStatus.IN_TESTING,
    priority: 1,
    estimatedMinutes: 960, // 16h
    creatorId: po.id,
    assigneeId: devAlice.id,
  });

  const usStripeRefund = await createTicket({
    type: TicketType.USER_STORY,
    title: "En tant qu'admin, je peux rembourser une commande",
    description: "Remboursement partiel ou total via API Stripe.",
    parentId: featureStripe.id,
    parentPath: featureStripe.path,
    status: TicketStatus.IN_PROGRESS,
    priority: 2,
    estimatedMinutes: 480, // 8h
    creatorId: po.id,
    assigneeId: devAlice.id,
  });

  // Tâches sous la première US
  await createTicket({
    type: TicketType.TASK,
    title: "Configurer la clé API Stripe",
    parentId: usStripeCheckout.id,
    parentPath: usStripeCheckout.path,
    status: TicketStatus.DONE,
    estimatedMinutes: 60,
    creatorId: devAlice.id,
    assigneeId: devAlice.id,
  });

  await createTicket({
    type: TicketType.TASK,
    title: "Implémenter le webhook de confirmation",
    parentId: usStripeCheckout.id,
    parentPath: usStripeCheckout.path,
    status: TicketStatus.DONE,
    estimatedMinutes: 240,
    creatorId: devAlice.id,
    assigneeId: devAlice.id,
  });

  // Bug déjà existant sous Stripe (pour montrer le cas "bug attaché à Feature")
  await createTicket({
    type: TicketType.BUG,
    title: "Timeout occasionnel sur 3D Secure",
    description:
      "Sur mobile Safari, la popup 3DS disparaît avant validation.",
    parentId: featureStripe.id,
    parentPath: featureStripe.path,
    status: TicketStatus.TODO,
    priority: 2,
    estimatedMinutes: 180,
    creatorId: testerCarol.id,
    assigneeId: devAlice.id,
  });

  // US sous PayPal
  const usPaypalCheckout = await createTicket({
    type: TicketType.USER_STORY,
    title: "En tant que client, je peux payer avec PayPal",
    parentId: featurePaypal.id,
    parentPath: featurePaypal.path,
    status: TicketStatus.TODO,
    priority: 2,
    estimatedMinutes: 720,
    creatorId: po.id,
    assigneeId: devBob.id,
  });

  // ─── Epic 2 : Panier ──────────────────────────────────────
  const epicCart = await createTicket({
    type: TicketType.EPIC,
    title: "Refonte du panier",
    description: "Panier persistant + promotions + livraison calculée.",
    status: TicketStatus.IN_PROGRESS,
    priority: 2,
    creatorId: po.id,
  });

  const featureCartPersist = await createTicket({
    type: TicketType.FEATURE,
    title: "Panier persistant",
    description: "Sauvegarde côté serveur pour les utilisateurs connectés.",
    parentId: epicCart.id,
    parentPath: epicCart.path,
    status: TicketStatus.DONE,
    priority: 2,
    creatorId: po.id,
    assigneeId: devAlice.id,
  });

  const usCartAdd = await createTicket({
    type: TicketType.USER_STORY,
    title: "Ajouter un article au panier",
    parentId: featureCartPersist.id,
    parentPath: featureCartPersist.path,
    status: TicketStatus.DONE,
    priority: 3,
    estimatedMinutes: 240,
    creatorId: po.id,
    assigneeId: devAlice.id,
  });

  const usCartPromo = await createTicket({
    type: TicketType.USER_STORY,
    title: "Appliquer un code promo",
    parentId: featureCartPersist.id,
    parentPath: featureCartPersist.path,
    status: TicketStatus.IN_PROGRESS,
    priority: 3,
    estimatedMinutes: 360,
    creatorId: po.id,
    assigneeId: devBob.id,
  });

  // ─── Cas de test (sur 2 US) ──────────────────────────────
  console.log("  Création des cas de test...");
  await prisma.testCase.createMany({
    data: [
      {
        ticketId: usStripeCheckout.id,
        order: 1,
        title: "Paiement CB simple avec carte test 4242",
        preconditions: "Un produit dans le panier, connecté en tant que client",
        steps:
          "1. Accéder au panier\n2. Cliquer sur 'Payer'\n3. Saisir carte 4242 4242 4242 4242, CVC 123, date future",
        expected: "Confirmation de paiement, email envoyé, commande créée avec statut PAID",
      },
      {
        ticketId: usStripeCheckout.id,
        order: 2,
        title: "Paiement refusé (carte 4000 0000 0000 0002)",
        preconditions: "Panier non vide",
        steps: "1. Saisir la carte refusée 4000 0000 0000 0002",
        expected: "Message d'erreur clair, possibilité de réessayer, aucune commande créée",
      },
      {
        ticketId: usStripeCheckout.id,
        order: 3,
        title: "Paiement avec 3D Secure",
        preconditions: "Carte test 3DS : 4000 0025 0000 3155",
        steps: "1. Saisir la carte 3DS\n2. Valider sur la popup 3DS",
        expected: "Paiement validé après authentification",
      },
      {
        ticketId: usCartAdd.id,
        order: 1,
        title: "Ajout simple d'un article",
        preconditions: "Produit A avec stock > 0",
        steps: "1. Cliquer 'Ajouter au panier' sur produit A",
        expected: "Badge du panier passe à 1, article visible dans le récap",
      },
      {
        ticketId: usCartAdd.id,
        order: 2,
        title: "Ajout d'un article en rupture de stock",
        preconditions: "Produit B avec stock = 0",
        steps: "1. Tenter d'ajouter produit B",
        expected: "Message 'Article indisponible', panier inchangé",
      },
    ],
  });

  // ─── Time entries (pour démontrer le roll-up) ────────────
  console.log("  Création des time entries...");
  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000);

  await prisma.timeEntry.createMany({
    data: [
      // Sur US Stripe checkout (assigné à Alice)
      {
        ticketId: usStripeCheckout.id,
        userId: devAlice.id,
        minutes: 180,
        description: "Setup Stripe + premier test",
        loggedAt: hoursAgo(72),
      },
      {
        ticketId: usStripeCheckout.id,
        userId: devAlice.id,
        minutes: 240,
        description: "Implémentation du flow de paiement",
        loggedAt: hoursAgo(48),
      },
      {
        ticketId: usStripeCheckout.id,
        userId: devAlice.id,
        minutes: 360,
        description: "Gestion des erreurs + 3DS",
        loggedAt: hoursAgo(24),
      },
      // Sur US Stripe refund
      {
        ticketId: usStripeRefund.id,
        userId: devAlice.id,
        minutes: 120,
        description: "API remboursement partiel",
        loggedAt: hoursAgo(16),
      },
      // Sur US Cart Add (Bob)
      {
        ticketId: usCartAdd.id,
        userId: devAlice.id,
        minutes: 180,
        description: "Endpoint + UI ajout panier",
        loggedAt: hoursAgo(240),
      },
      {
        ticketId: usCartAdd.id,
        userId: devBob.id,
        minutes: 120,
        description: "Tests + revue",
        loggedAt: hoursAgo(200),
      },
      // Sur US Cart Promo (Bob — en cours)
      {
        ticketId: usCartPromo.id,
        userId: devBob.id,
        minutes: 300,
        description: "Moteur de règles de remise",
        loggedAt: hoursAgo(8),
      },
    ],
  });

  // Synchroniser les loggedMinutes sur les tickets
  // (normalement fait par l'action logTime, ici on le fait en batch)
  const timeByTicket = await prisma.timeEntry.groupBy({
    by: ["ticketId"],
    _sum: { minutes: true },
  });
  for (const row of timeByTicket) {
    await prisma.ticket.update({
      where: { id: row.ticketId },
      data: { loggedMinutes: row._sum.minutes ?? 0 },
    });
  }

  console.log("✅ Seed terminé.\n");
  console.log("Connectez-vous avec l'un des comptes suivants :");
  console.log("  📧 admin@demo.local      (Admin)");
  console.log("  📧 po@demo.local         (Product Owner)");
  console.log("  📧 alice@demo.local      (Développeur)");
  console.log("  📧 bob@demo.local        (Développeur)");
  console.log("  📧 carol@demo.local      (Testeur)");
  console.log(`\n  🔑 Mot de passe : ${DEMO_PASSWORD}`);
  console.log("     (à changer immédiatement en environnement non-local)");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
