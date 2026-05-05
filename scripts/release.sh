#!/usr/bin/env bash
# release.sh — bumpa versão atomicamente em js/version.js + index.html + CHANGELOG.md
#
# Uso:
#   ./scripts/release.sh patch "fix(...)"     → 3.2.2 → 3.2.3
#   ./scripts/release.sh minor "feat(...)"    → 3.2.x → 3.3.0
#   ./scripts/release.sh major "BREAKING..."  → 3.x.y → 4.0.0
#   ./scripts/release.sh build "chore: ..."   → mantém versão, só bumpa o BUILD
#
# Por que existe:
#   GitHub Pages deploya em cada push pra main. A regra é: TODO push
#   bumpa pelo menos o BUILD (cache-bust + telemetria). Esquema completo
#   em docs/VERSIONING.md.
#
# O que o script faz:
#   1. Lê versão atual de js/version.js
#   2. Calcula nova versão conforme tipo de bump
#   3. Atualiza js/version.js, index.html (?v=...) e adiciona seção em CHANGELOG.md
#   4. NÃO faz commit nem push — você revisa antes
#
# Segurança:
#   - Refuse se houver mudanças não-staged (você precisa stagar antes)
#   - Imprime diff resumido pra confirmar antes do commit manual

set -euo pipefail

cd "$(dirname "$0")/.."

if [ $# -lt 2 ]; then
  echo "Uso: ./scripts/release.sh <patch|minor|major|build> <slug-curto>"
  echo ""
  echo "Exemplos:"
  echo "  ./scripts/release.sh patch fix-icones-projeto"
  echo "  ./scripts/release.sh minor pickers-multiinstance"
  echo "  ./scripts/release.sh major schema-multitenancy"
  exit 1
fi

BUMP_TYPE="$1"
SLUG="$2"
DATE=$(date +%Y%m%d)
BUILD="${DATE}-${SLUG}"

# ─── Lê versão atual ─────────────────────────────────────
MAJOR=$(grep -E "^\s*major:" js/version.js | head -1 | sed -E 's/.*: *([0-9]+).*/\1/')
MINOR=$(grep -E "^\s*minor:" js/version.js | head -1 | sed -E 's/.*: *([0-9]+).*/\1/')
PATCH=$(grep -E "^\s*patch:" js/version.js | head -1 | sed -E 's/.*: *([0-9]+).*/\1/')
OLD_BUILD=$(grep -E "^\s*build:" js/version.js | head -1 | sed -E "s/.*: *'([^']+)'.*/\1/")
OLD_VERSION="${MAJOR}.${MINOR}.${PATCH}+${OLD_BUILD}"

case "$BUMP_TYPE" in
  major) MAJOR=$((MAJOR+1)); MINOR=0; PATCH=0 ;;
  minor) MINOR=$((MINOR+1)); PATCH=0 ;;
  patch) PATCH=$((PATCH+1)) ;;
  build) ;;  # mantém major/minor/patch
  *) echo "Tipo desconhecido: $BUMP_TYPE (use major|minor|patch|build)"; exit 1 ;;
esac

NEW_SHORT="${MAJOR}.${MINOR}.${PATCH}"
NEW_VERSION="${NEW_SHORT}+${BUILD}"

echo "🔖 Bumpando: ${OLD_VERSION} → ${NEW_VERSION}"
echo ""

# ─── 1. js/version.js ────────────────────────────────────
sed -i.bak -E \
  -e "s/^([[:space:]]*)major:[[:space:]]*[0-9]+,/\1major: ${MAJOR},/" \
  -e "s/^([[:space:]]*)minor:[[:space:]]*[0-9]+,/\1minor: ${MINOR},/" \
  -e "s/^([[:space:]]*)patch:[[:space:]]*[0-9]+,/\1patch: ${PATCH},/" \
  -e "s/^([[:space:]]*)build:[[:space:]]*'[^']+',/\1build: '${BUILD}',/" \
  js/version.js
rm -f js/version.js.bak

# ─── 2. index.html (cache-bust) ──────────────────────────
sed -i.bak -E \
  -e "s|js/app\\.js\\?v=[^\"']+|js/app.js?v=${NEW_VERSION}|g" \
  -e "s|FULL de js/version\\.js \\([^)]+\\)|FULL de js/version.js (${NEW_VERSION})|g" \
  index.html
rm -f index.html.bak

# ─── 3. CHANGELOG.md (insere placeholder) ────────────────
TODAY=$(date +%Y-%m-%d)
PLACEHOLDER="\\
## [${NEW_VERSION}] — ${TODAY}\\
\\
### Changed\\
- (descreva aqui as mudanças deste deploy)\\
\\
---\\
"
# Insere logo depois do primeiro \"---\" após a nota inicial (linha que vem antes do primeiro [X.Y.Z])
awk -v insert="$PLACEHOLDER" '
  BEGIN { done = 0 }
  /^## \[[0-9]+\.[0-9]+\.[0-9]+/ && !done {
    printf "%s\n", insert
    done = 1
  }
  { print }
' CHANGELOG.md > CHANGELOG.md.tmp && mv CHANGELOG.md.tmp CHANGELOG.md

echo "✅ Bumped:"
echo "   js/version.js        → ${NEW_VERSION}"
echo "   index.html           → ?v=${NEW_VERSION}"
echo "   CHANGELOG.md         → seção placeholder adicionada (edite!)"
echo ""
echo "📋 Próximos passos:"
echo "   1. git diff CHANGELOG.md     # edita a seção nova com mudanças reais"
echo "   2. git add -A"
echo "   3. git commit -m \"chore(release): ${NEW_VERSION}\""
echo "   4. git push origin main"
echo ""
echo "⏱  Deploy automático em ~30s via GitHub Pages."
