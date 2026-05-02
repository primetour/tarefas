/**
 * PRIMETOUR — Firebase Module
 * Inicialização do Firebase App, Auth e Firestore com cache persistente
 *
 * IMPORTANTE: usamos `initializeFirestore` (em vez de `getFirestore`) para
 * habilitar `persistentLocalCache`. Isso faz o Firestore servir do
 * IndexedDB local quando o documento não mudou desde a última leitura,
 * **sem cobrar leitura nova** — alavanca essencial p/ caber no free tier.
 *   - persistentMultipleTabManager(): coordena cache entre múltiplas abas
 *     (sem isso, abas concorrem pelo lock e o cache é desabilitado).
 *   - cacheSizeBytes: ilimitado (default 40MB). Mantemos em ~100MB p/
 *     comportar histórico de tarefas/notificações sem evicção agressiva.
 */

import { initializeApp }       from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, OAuthProvider } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  CACHE_SIZE_UNLIMITED,
  getFirestore,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig }      from './config.js';

// ─── Instância principal ───────────────────────────────────
const app = initializeApp(firebaseConfig, 'primetour-main');

// ─── Instância secundária para criação de usuários ────────
// Permite que o admin crie novos usuários sem fazer logout
const secondaryApp = initializeApp(firebaseConfig, 'primetour-secondary');

// ─── Microsoft SSO Provider ───────────────────────────────
export const microsoftProvider = new OAuthProvider('microsoft.com');
microsoftProvider.setCustomParameters({
  tenant: 'primetour.com.br',     // Restringe ao tenant Microsoft da Primetour
  prompt: 'login',                // Força login com email/senha (evita PIN do Authenticator)
  login_hint: '',                 // Não sugere conta anterior
});
microsoftProvider.addScope('user.read');
// Scopes adicionais pra IA Hub poder ler conhecimento do SharePoint/OneDrive
microsoftProvider.addScope('Files.Read.All');
microsoftProvider.addScope('Sites.Read.All');

// ─── Serviços exportados ───────────────────────────────────
export const auth          = getAuth(app);
export const secondaryAuth = getAuth(secondaryApp);

/**
 * Firestore com cache IndexedDB persistente.
 * Fallback para getFirestore() se a inicialização do cache persistente
 * falhar (ex.: navegador em modo privado sem IndexedDB).
 */
let _db;
try {
  _db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager:    persistentMultipleTabManager(),
      cacheSizeBytes: CACHE_SIZE_UNLIMITED,
    }),
  });
  console.log('[Firestore] Cache persistente (IndexedDB) habilitado.');
} catch (err) {
  console.warn('[Firestore] Cache persistente indisponível, usando memória:', err?.message || err);
  _db = getFirestore(app);
}
export const db = _db;

export { app };
export default app;
