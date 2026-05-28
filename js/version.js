/**
 * PRIMETOUR — Versionamento (single source of truth)
 *
 * Esquema: SemVer (MAJOR.MINOR.PATCH) + BUILD opcional
 *
 *   MAJOR  → mudança incompatível (quebra contratos públicos / Firestore schema)
 *   MINOR  → adição de funcionalidade compatível com versão anterior
 *   PATCH  → bugfix compatível
 *   BUILD  → identificador de deploy (yyyymmdd-slug). Usado tb pra cache-bust.
 *
 * Regras de bump (rápidas):
 *   - Mexeu em estrutura do Firestore que exige migração? → MAJOR
 *   - Adicionou tela/componente novo? → MINOR
 *   - Corrigiu bug, polish visual, refactor interno? → PATCH
 *
 * Como atualizar:
 *   1. Edite { major, minor, patch } abaixo.
 *   2. Atualize `build` com a data + slug curto da feature (ex: "20260505-pickers").
 *   3. Atualize CHANGELOG.md.
 *   4. Bumpa o ?v=... no index.html pra `${full}` (apertar cache).
 *
 * Doc completa: docs/VERSIONING.md
 */

export const VERSION = {
  major: 4,
  minor: 62,
  patch: 49,
  build: '20260528-bu-sync-bidirectional-cotacoes-alias',
};

/** "1.2.0" */
export const SHORT  = `${VERSION.major}.${VERSION.minor}.${VERSION.patch}`;

/** "1.2.0+20260505-pickers" — usado como cache-bust e exibido no rodapé */
export const FULL   = `${SHORT}+${VERSION.build}`;

/** "v1.2.0" — pra exibir compacto no rodapé */
export const LABEL  = `v${SHORT}`;

/** Marcação pra ferramentas de debug acharem rapidinho a versão no DOM. */
if (typeof window !== 'undefined') {
  window.__PRIMETOUR_VERSION__ = { ...VERSION, full: FULL, label: LABEL };
}
