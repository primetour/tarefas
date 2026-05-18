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
// `tenant: 'organizations'` aceita qualquer Azure AD (work/school) e bloqueia
// contas pessoais (consumers). A restrição por domínio (@primetour.com.br,
// @primetravel.tur.br, @primetouroperator.com.br) é feita em auth.js via
// ALLOWED_SSO_DOMAINS — assim qualquer um dos 3 tenants/domínios da Primetour
// consegue logar mesmo quando estão em organizações Azure separadas.
export const microsoftProvider = new OAuthProvider('microsoft.com');
microsoftProvider.setCustomParameters({
  tenant: 'organizations',        // Aceita qualquer tenant corporativo Azure AD
  // 4.40.27 (regressão SSO): `prompt: 'login'` + `login_hint: ''` REMOVIDOS.
  //
  // CONTEXTO: tenants Primetour têm Conditional Access que EXIGE MFA via
  // Microsoft Authenticator. `prompt: 'login'` força re-autenticação completa,
  // mas em interação com a política de MFA do tenant, o popup fechava após
  // o passo de senha SEM disparar o desafio do Authenticator — e o
  // signInWithPopup resolvia com `auth/popup-closed-by-user` (silenciado em
  // login.js), devolvendo o user pra tela de login num loop.
  //
  // `login_hint: ''` (string vazia) é tecnicamente inválido — alguns endpoints
  // MS interpretam como hint "vazio" e abortam.
  //
  // Sem nenhum desses parâmetros, o tenant aplica o fluxo padrão (email →
  // senha → Authenticator), que é o comportamento desejado.
});
microsoftProvider.addScope('user.read');
// IMPORTANTE: scopes Files.Read.All e Sites.Read.All foram REMOVIDOS porque
// exigem "admin consent" no Azure AD (bloqueia login pra usuario comum).
// Se precisar ler SharePoint via IA Hub, fazer via:
//   - Consent admin global em portal.azure.com (uma vez, p/ tenant inteiro)
//   - OU incremental consent (re-auth so quando acessar feature SharePoint)
//   - OU client_credentials flow no Cloud Function (server-side, ja temos
//     getSharePointToken pronto pra isso).

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

/* ─── App Check (mitigação de abuse de SDKs) ────────────────
 * Exige reCAPTCHA Enterprise key configurada no Firebase Console:
 * https://console.firebase.google.com/project/_/appcheck
 *
 * Após admin configurar, descomenta o bloco e seta o site key abaixo.
 * Apps Check valida que o request VEM do app oficial (não de Postman/curl).
 * ALTERNATIVA pra dev: Debug Token (mostrar no console) */
/**
 * App Check ativo via reCAPTCHA Enterprise.
 * Em localhost/dev: ativa debug token automaticamente (printa UUID no console;
 * admin precisa adicionar em Firebase Console → App Check → Manage Debug Tokens).
 * Em prod (primetour.github.io etc): valida via reCAPTCHA real.
 */
export let appCheckInstance = null;
async function setupAppCheck() {
  const ENABLED  = true;
  const SITE_KEY = '6Lc38dUsAAAAAH8i5bE1P_gxOfrudZwHnRFGVUNJ';
  const isLocal  = ['localhost', '127.0.0.1', ''].includes(location.hostname);

  // Em dev, habilita debug token ANTES de initializeAppCheck
  if (isLocal && !self.FIREBASE_APPCHECK_DEBUG_TOKEN) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    console.warn('[App Check] DEBUG mode ativo. Copia o UUID do console e adiciona em Firebase Console → App Check → Manage Debug Tokens.');
  }

  if (!ENABLED) return;
  try {
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } =
      await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js');
    appCheckInstance = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
    console.log('[App Check] enabled (provider=reCAPTCHA Enterprise)');
  } catch (e) {
    console.warn('[App Check] setup failed:', e?.message || e);
  }
}
setupAppCheck();
