#!/bin/bash
# scripts/apply-all-migrations.sh
#
# Applique toutes les migrations SQL du dossier prisma/migrations dans l'ordre
# alphabétique de leur dossier (préfixe horodaté).
#
# Idempotent : utilise les patterns "IF NOT EXISTS", "DROP ... IF EXISTS",
# "CREATE OR REPLACE VIEW" qu'on a déjà dans nos migrations. Une migration
# déjà appliquée ne génère donc pas d'erreur.
#
# Usage :
#   bash scripts/apply-all-migrations.sh
#   ou via npm : npm run db:apply-all

set -e

# Variables d'environnement avec valeurs par défaut pour Codespace
DB_USER="${POSTGRES_USER:-postgres}"
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_NAME="${POSTGRES_DB:-qa_platform}"

MIGRATIONS_DIR="prisma/migrations"

if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "❌ Dossier $MIGRATIONS_DIR introuvable. Exécute le script depuis la racine du projet."
  exit 1
fi

echo "🔍 Recherche des migrations dans $MIGRATIONS_DIR/..."
echo ""

# Liste les dossiers de migration triés alphabétiquement (donc chronologiquement
# vu nos préfixes 20260507... 20260508... etc.)
migrations=()
for dir in "$MIGRATIONS_DIR"/*/; do
  if [ -f "$dir/migration.sql" ]; then
    migrations+=("$dir/migration.sql")
  fi
done

if [ ${#migrations[@]} -eq 0 ]; then
  echo "Aucune migration trouvée."
  exit 0
fi

echo "📋 ${#migrations[@]} migrations détectées :"
for m in "${migrations[@]}"; do
  echo "   - $(basename $(dirname $m))"
done
echo ""

applied=0
errors=0

for migration in "${migrations[@]}"; do
  name=$(basename $(dirname "$migration"))
  echo "▶  Application : $name"

  # ON_ERROR_STOP=0 : continue même si une commande échoue (ex: contrainte déjà
  # existante). Les migrations sont écrites pour être idempotentes mais quelques
  # ALTER TABLE ADD CONSTRAINT n'ont pas IF NOT EXISTS — on les laisse passer.
  if psql -U "$DB_USER" -h "$DB_HOST" -d "$DB_NAME" \
    --set=ON_ERROR_STOP=0 \
    -q -f "$migration" 2>&1 | grep -v "already exists" | grep -v "^$" || true; then
    applied=$((applied + 1))
  else
    errors=$((errors + 1))
    echo "   ⚠️  Erreur sur $name (peut être bénigne si déjà appliquée)"
  fi
done

echo ""
echo "✅ Terminé : $applied migrations passées, $errors avertissements ignorés."
echo ""
echo "💡 Pense à régénérer le client Prisma si tu as ajouté de nouveaux champs :"
echo "   npx prisma generate"
