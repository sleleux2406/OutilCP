# QA Platform

Plateforme de gestion de projet & QA avec Test Runner intégré, hiérarchie Epic > Feature > US/Bug, roll-up de temps et coûts, et workflow de bug automatique.

## Stack

- **Next.js 15** (App Router, Server Components, Server Actions)
- **React 19** + TypeScript strict
- **PostgreSQL 16** + **Prisma 5**
- **Tailwind CSS** + shadcn/ui + Radix
- **@dnd-kit** (Kanban drag & drop accessible)
- **TanStack Query** (cache client + optimistic updates)
- **Auth.js v5** (authentification + RBAC)
- **Zod** (validation stricte des entrées)

## Fonctionnalités implémentées (schéma BDD)

- Hiérarchie stricte Epic > Feature > (User Story, Bug) > Task/Bug
- Roll-up temps + coût via vue SQL récursive (`ticket_rollup`)
- Test Runner : cas de test, exécutions, captures, commentaires obligatoires sur KO
- Workflow Bug automatique sur KO (création + blocage du ticket testé)
- Bugs libres rattachables à Feature ou User Story
- Audit log complet (OWASP A09)
- Rôles : Admin, Product Owner, Developer, Tester

## Prérequis

- Node.js 20+ (LTS recommandé) — inclut npm
- PostgreSQL 16+ (local, Neon, Supabase, ou Docker)

## Installation

```powershell
# 1. Installer les dépendances
npm install

# 2. Copier le template d'environnement
Copy-Item .env.example .env

# 3. Éditer .env et configurer :
#    - DATABASE_URL (PostgreSQL)
#    - AUTH_SECRET (32 bytes base64 aléatoire)
#    - S3_* (stockage des captures, optionnel en dev)

# 4. Créer la base et appliquer la migration
npm run db:migrate

# 5. Charger des données de démo
npm run db:seed

# 6. (Optionnel) Ouvrir Prisma Studio pour voir les tables
npm run db:studio

# 7. Lancer le serveur de dev
npm run dev
```

Ouvrir http://localhost:3000.

### Comptes de démo (après `npm run db:seed`)

| Email | Rôle | Mot de passe |
|---|---|---|
| `admin@demo.local` | Admin | `demo1234` |
| `po@demo.local` | Product Owner | `demo1234` |
| `alice@demo.local` | Développeuse | `demo1234` |
| `bob@demo.local` | Développeur | `demo1234` |
| `carol@demo.local` | Testeuse | `demo1234` |

## Structure du projet

```
qa-platform/
├── app/                       # Routes Next.js (à créer)
│   ├── projects/[key]/
│   │   ├── board/             # Kanban
│   │   └── overview/          # Dashboard Chef de Projet
│   ├── tickets/[key]/         # Détail ticket + Test Runner
│   └── actions/               # Server Actions
├── components/                # Composants React (à créer)
│   ├── kanban/
│   ├── test-runner/
│   ├── pm/                    # Dashboard pilotage
│   └── bugs/
├── lib/                       # Logique métier (à créer)
│   ├── auth.ts                # RBAC helpers
│   ├── prisma.ts              # Client Prisma singleton
│   ├── time-rollup.ts         # Requêtes vue ticket_rollup
│   ├── bugs/
│   │   ├── create-from-ko.ts  # Workflow KO → Bug
│   │   └── key-generator.ts   # Génération des keys PROJ-123
│   ├── tickets/
│   │   └── hierarchy.ts       # Règles de rattachement
│   └── kanban/
│       ├── types.ts
│       ├── order.ts           # Calcul boardOrder
│       └── useMoveTicket.ts
├── prisma/
│   ├── schema.prisma          # ✅ Schéma complet
│   └── migrations/
│       └── 20260507000000_init/
│           └── migration.sql  # ✅ Contraintes + vue rollup
├── .env.example               # ✅
├── .gitignore                 # ✅
├── next.config.ts             # ✅
├── package.json               # ✅
├── postcss.config.js          # ✅
├── tailwind.config.ts         # ✅
└── tsconfig.json              # ✅
```

## Vue SQL clé : `ticket_rollup`

Pour chaque ticket, agrège récursivement :
- `totalEstimatedMinutes` — temps estimé (soi-même + descendants)
- `totalLoggedMinutes` — temps réellement loggé
- `totalCostCents` — coût réel (minutes × taux horaire)
- `progressPercent` — % d'avancement
- `usCount`, `bugCount`, `featureCount`, `taskCount` — comptage enfants

Utilisation côté TypeScript :

```typescript
const rollup = await prisma.$queryRaw`
  SELECT * FROM ticket_rollup WHERE "ticketId" = ${epicId}
`;
```

## Sécurité intégrée

| Couche | Mesure |
|---|---|
| Passwords | bcrypt avec coût ≥ 12 (schéma impose `hashedPassword`) |
| Sessions | Hash du token (jamais stocké en clair) |
| Injection SQL | Prisma paramétré + Zod sur toute entrée |
| Intégrité KO | Contrainte CHECK SQL `ko_requires_comment` |
| Audit | Table `AuditLog` indexée par entité et action |
| En-têtes HTTP | HSTS, X-Frame-Options DENY, no-sniff, Permissions-Policy (next.config.ts) |
| Uploads | Whitelist de domaines images (next.config.ts) |
| Server Actions | Protection CSRF native Next.js |

## Prochaines étapes

Pour continuer le développement, les composants à créer (dans l'ordre recommandé) :
1. `lib/prisma.ts` + `lib/auth.ts` (fondations)
2. Routes auth + page de connexion
3. `components/kanban/` (board complet)
4. `components/test-runner/` (mode focus)
5. `components/pm/` (dashboard CP)
6. `components/bugs/` (création libre + drawer)

## Commandes utiles

```powershell
npm run dev              # Dev server sur http://localhost:3000
npm run build            # Build production
npm run start            # Démarrer le build de production
npm run typecheck        # Vérification des types TypeScript
npm run lint             # ESLint
npm run db:migrate       # Appliquer migrations
npm run db:seed          # Recharger les données de démo
npm run db:studio        # UI Prisma (navigateur des tables)
npm run db:generate      # Regénérer le client Prisma
npm run retention        # Purger sessions expirées et vieux audit logs
```

## Licence

Privé.
