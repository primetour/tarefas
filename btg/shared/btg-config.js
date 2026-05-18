/**
 * BTG — Firebase Configuration (STAGING)
 * ============================================================
 * Aponta as páginas do BTG (Partners / Ultrablue / Operadora)
 * pro projeto Firebase de STAGING dedicado, isoladas do gestor
 * principal (que segue apontando pra `gestor-de-tarefas-primetour`
 * via /js/config.js).
 *
 * Project ID: gestor-btg-lp-builder-staging
 *
 * COMO PREENCHER (1x, owner técnico):
 *   1. Console: https://console.firebase.google.com/project/gestor-btg-lp-builder-staging
 *   2. Settings (ícone de engrenagem) → Configurações do projeto
 *   3. Aba "Geral" → role até "Seus aplicativos"
 *   4. Se não houver app Web, criar: ícone </>, nome "btg-lp-builder"
 *   5. Selecionar SDK setup → Config → copiar bloco `firebaseConfig`
 *   6. Substituir os valores PLACEHOLDER_* abaixo
 *
 * Sobre segurança: apiKey do Firebase Web NÃO é secret (é pública
 * por design). A proteção real é feita pelas Firestore Rules.
 * Pode ser commitada no repo público sem risco.
 * ============================================================
 */

export const btgFirebaseConfig = {
  apiKey: "PLACEHOLDER_API_KEY",
  authDomain: "gestor-btg-lp-builder-staging.firebaseapp.com",
  projectId: "gestor-btg-lp-builder-staging",
  storageBucket: "gestor-btg-lp-builder-staging.firebasestorage.app",
  messagingSenderId: "PLACEHOLDER_SENDER_ID",
  appId: "PLACEHOLDER_APP_ID"
};

export const BTG_COLLECTION = 'btg_ofertas_dev';

export function isBtgConfigReady() {
  return (
    btgFirebaseConfig.apiKey &&
    !btgFirebaseConfig.apiKey.startsWith('PLACEHOLDER_') &&
    btgFirebaseConfig.projectId === 'gestor-btg-lp-builder-staging'
  );
}
