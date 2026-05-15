# Guide de déploiement — qa-platform

Déploiement gratuit sur **Vercel** (Next.js) + **Neon** (PostgreSQL).

URL finale : `https://qa-platform-xxx.vercel.app` (ou similaire, attribuée par Vercel).

---

## Étapes (≈ 15 minutes)

### 1. Créer la base PostgreSQL sur Neon

1. Va sur **https://neon.tech** → clique **"Sign up"** → **"Continue with GitHub"** (autoriser).
2. Sur le dashboard, clique **"Create a project"**.
3. Renseigne :
   - **Project name** : `qa-platform`
   - **Postgres version** : `16` (ou la plus récente disponible)
   - **Region** : `Europe (Frankfurt)` (le plus proche pour la France)
4. Clique **"Create project"**.
5. **IMPORTANT** : sur l'écran qui s'affiche, copie la **"Connection string"** (commence par `postgresql://...neon.tech/...`).
   - Format : `postgresql://user:password@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`
   - **Garde-la précieusement**, on en a besoin pour Vercel.
6. **(Optionnel mais recommandé)** : tu peux nommer la branche par défaut "production" pour clarifier.

### 2. Préparer un secret pour les sessions

Sur ton PC ou en Codespaces, génère un secret aléatoire :

```bash
openssl rand -base64 32
```

Tu obtiens quelque chose comme `8KvD5mF3...JqXp/B=` (44 caractères). **Copie-le**, on en a besoin pour Vercel.

Si tu n'as pas `openssl` (Windows), tu peux utiliser **https://generate-secret.vercel.app/32** (ou tout autre générateur de chaîne aléatoire de 32+ caractères).

### 3. Déployer sur Vercel

1. Va sur **https://vercel.com** → clique **"Sign Up"** → **"Continue with GitHub"** (autoriser).
2. Une fois connectée, clique **"Add New..."** → **"Project"**.
3. Vercel liste tes repos GitHub. Trouve **`OutilCP`** et clique **"Import"**.
4. Configure le projet :
   - **Project Name** : `qa-platform` (ou ce que tu veux — ça donnera l'URL finale)
   - **Framework Preset** : Next.js (détecté automatiquement)
   - **Root Directory** : laisser tel quel
   - **Build Command** : laisser auto-détecter (Vercel utilisera `npm run vercel-build` automatiquement grâce au `package.json`)
5. Déplie **"Environment Variables"** et ajoute :

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | la connection string Neon (étape 1.5) |
   | `AUTH_SECRET` | le secret généré (étape 2) |
   | `SEED_ADMIN_EMAIL` | ton email (ex: `manager@tonentreprise.fr`) |
   | `SEED_ADMIN_PASSWORD` | un mot de passe **fort** (8 caractères minimum) |
   | `SEED_ADMIN_NAME` | ton nom (ex: `Sandra Leleux`) |

6. Clique **"Deploy"**.
7. Vercel lance le build. Cela prend **2-5 minutes** :
   - Installation des dépendances
   - `prisma migrate deploy` applique toutes les migrations sur Neon
   - `next build` compile l'app
8. Quand le build est ✅ vert, clique **"Visit"** → tu obtiens ton URL `https://qa-platform-xxx.vercel.app`.

### 4. Créer ton compte ADMIN initial

Le déploiement a créé la structure de la base, mais il n'y a **encore aucun utilisateur**. Il faut lancer le seed une fois.

#### Option A — Depuis ton PC local (recommandé)

1. Ouvre un terminal dans le projet `C:/Projets/qa-platform/`
2. Crée un fichier `.env.production.local` (ne sera **pas** commité, c'est dans le `.gitignore`) :
   ```env
   DATABASE_URL="postgresql://...la connection string Neon..."
   SEED_ADMIN_EMAIL="ton@email.com"
   SEED_ADMIN_PASSWORD="ton mot de passe"
   SEED_ADMIN_NAME="Ton Nom"
   ```
3. Lance le seed :
   ```bash
   npx dotenv -e .env.production.local -- npm run db:seed:prod
   ```

   Si tu n'as pas `dotenv-cli`, installe-le : `npm install -g dotenv-cli`.

   Sortie attendue :
   ```
   🌱 Creation du compte ADMIN ton@email.com...
   ✅ Compte ADMIN cree : ton@email.com
      Connectez-vous sur l'app avec ces identifiants.
   ```

#### Option B — Depuis le terminal Vercel (si tu n'as pas Node sur ton PC local)

1. Sur le dashboard Vercel de ton projet, va dans l'onglet **"Logs"** ou **"Storage"** → tu peux ouvrir un terminal Vercel CLI.
2. Plus simple : utilise **Neon SQL Editor** (https://console.neon.tech → ton projet → "SQL Editor") et lance manuellement :
   ```sql
   -- Génère un hash bcrypt de ton mot de passe avec https://bcrypt-generator.com (cost 12)
   INSERT INTO "User" (id, email, "hashedPassword", name, role, "hourlyRateCents", "createdAt", "updatedAt")
   VALUES (
     gen_random_uuid()::text,
     'ton@email.com',
     '$2a$12$...le_hash_bcrypt...',
     'Ton Nom',
     'ADMIN',
     0,
     NOW(),
     NOW()
   );
   ```

### 5. Tester

1. Ouvre ton URL Vercel : `https://qa-platform-xxx.vercel.app`
2. Tu devrais arriver sur la page de **login**.
3. Connecte-toi avec **`SEED_ADMIN_EMAIL`** et **`SEED_ADMIN_PASSWORD`**.
4. Tu arrives sur la liste des projets — vide pour l'instant.
5. Clique **"Nouveau projet"** pour créer ton premier projet en prod.

### 6. Inviter d'autres testeurs

Une fois connectée en ADMIN, tu peux créer d'autres utilisateurs :

1. Va sur la page d'admin (à venir : `/admin/users`) ou crée-les directement via Neon SQL Editor :
   ```sql
   INSERT INTO "User" (id, email, "hashedPassword", name, role, "hourlyRateCents", "createdAt", "updatedAt")
   VALUES (
     gen_random_uuid()::text,
     'collegue@boite.fr',
     '$2a$12$...hash_bcrypt_du_mot_de_passe...',
     'Nom Collegue',
     'PRODUCT_OWNER',  -- ou DEVELOPER, TESTER
     0,
     NOW(),
     NOW()
   );
   ```
2. Communique l'URL et les identifiants à tes testeurs.

---

## Mise à jour de l'app

À chaque `git push origin main`, Vercel redéploie automatiquement.

Si tu ajoutes une nouvelle migration Prisma, elle sera appliquée à Neon automatiquement par `npm run vercel-build` (qui lance `prisma migrate deploy`).

---

## Coûts et limites

### Vercel Free Hobby
- 100 GB-heures de compute / mois (largement suffisant pour ~10-20 utilisateurs actifs)
- Bandwidth illimité
- Builds illimités
- Domaine `.vercel.app` à vie

### Neon Free
- 0.5 GB de stockage (≈ 100 000 tickets, suffisant pour test)
- Compute auto-pause après 5 min d'inactivité (réveil ~1 sec au prochain login)
- 1 base de données par projet
- Pas d'expiration

### À surveiller
- **Quota Neon dépassé** : si tu remplis 0.5 Go (peu probable), upgrade vers le plan payant ($19/mois) ou nettoie les vieilles données.
- **Activité Vercel** : si l'app est très utilisée, surveille le compteur GB-heures sur le dashboard Vercel.

---

## Dépannage

### "Database connection error"
- Vérifie `DATABASE_URL` dans Vercel Environment Variables (rebuild après changement).
- Vérifie que la base Neon n'est pas en pause (visite l'app pour la réveiller).

### "Invalid AUTH_SECRET"
- Vérifie que `AUTH_SECRET` fait au moins 32 caractères dans Vercel.

### "Migrations failed"
- Va dans Vercel "Logs" du dernier déploiement, lis l'erreur.
- Si une migration custom plante, tu peux la lancer manuellement via Neon SQL Editor.

### "User not found" au login
- Tu n'as pas encore lancé `db:seed:prod`. Voir étape 4.

### Server Action error "Invalid Server Actions request"
- Cela peut arriver si l'URL Vercel change. Le `next.config.js` lit automatiquement `VERCEL_URL` à chaque build, donc un redeploy résout normalement le problème.
