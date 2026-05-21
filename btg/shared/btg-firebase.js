/**
 * Inicialização Firebase específica das páginas BTG.
 *
 * Aponta pro projeto STAGING dedicado (gestor-btg-lp-builder-staging),
 * isolado do gestor principal. Config em ./btg-config.js.
 *
 * Estratégia de fallback:
 *   - Se a config ainda tem placeholders → retorna { db: null, configured: false }
 *     e o caller cai pro localStorage (modo "lab" funcional sem Firestore).
 *   - Se config válida → inicializa app instance separada ('btg-app')
 *     pra não colidir com o app principal do gestor.
 */

import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { btgFirebaseConfig, isBtgConfigReady } from './btg-config.js';

let cached = null;

export async function getBtgFirebase() {
  if (cached) return cached;

  if (!isBtgConfigReady()) {
    console.info(
      '[btg] Firebase config ainda com placeholders — usando localStorage. ' +
      'Preencher btg/shared/btg-config.js com credenciais do projeto staging ' +
      'pra ativar Firestore (ver instruções no topo do arquivo).',
    );
    cached = { db: null, app: null, configured: false, reason: 'placeholders' };
    return cached;
  }

  const existing = getApps().find((a) => a.name === 'btg-app');
  const app = existing || initializeApp(btgFirebaseConfig, 'btg-app');
  const db = getFirestore(app);

  cached = { db, app, configured: true };
  return cached;
}
