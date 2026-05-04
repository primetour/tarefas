/**
 * PRIMETOUR — User Presence (Online Users)
 *
 * Implementação via Firebase Realtime Database (RTDB), não Firestore.
 *
 * POR QUE RTDB E NÃO FIRESTORE:
 * - RTDB tem `onDisconnect()` nativo: o servidor Firebase apaga o doc
 *   automaticamente quando a aba/conexão cai. Sem isso (Firestore), user
 *   que fechou navegador sem logout fica "fantasma" online por minutos.
 * - RTDB free tier separado do Firestore: 100 conexões simultâneas,
 *   1GB storage, 10GB transfer/mês. Não consome quota Firestore.
 * - Heartbeat de presence é fire-and-forget — não precisa transação,
 *   índices, ou queries complexas. RTDB é OPTIMIZADO pra esse caso.
 *
 * COMO FUNCIONA:
 * 1. Login → start():
 *    - Cria entry em /presence/{uid} com {name, email, color, lastSeen}
 *    - Configura onDisconnect: quando conexão cair, RTDB apaga o entry
 *    - Listener no /presence path → store.onlineUsers
 * 2. Logout → stop(): remove entry + cancela onDisconnect
 *
 * PERFORMANCE:
 * - 1 conexão WebSocket aberta enquanto user está online (não é polling)
 * - Updates incremento ao invés de re-fetch completo
 * - 100 users simultâneos = bem dentro do free tier
 *
 * SEGURANÇA (rules):
 * - Cada user só escreve em /presence/{seu-uid}
 * - Todos auth users leem /presence (lista pública de online users)
 */

import {
  ref, set, onValue, onDisconnect, serverTimestamp, remove, off,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { rtdb } from '../firebase.js';
import { store } from '../store.js';

const ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // 5 min: tolerância p/ refresh
let _onlineUnsub = null;
let _myRef = null;

/**
 * Inicia tracking de presence. Chamar após login.
 */
export function startPresence() {
  const user = store.get('currentUser');
  if (!user?.uid) return;

  // Para qualquer ciclo anterior (idempotente)
  stopPresence();

  const profile = store.get('userProfile');
  _myRef = ref(rtdb, `presence/${user.uid}`);

  // 1. Configura onDisconnect ANTES de set — garante que se a conexão
  //    cair entre o set() e o onDisconnect(), ainda assim limpa.
  // 2. set() escreve presence/{uid} com dados do user.
  // 3. RTDB mantém WebSocket aberto enquanto a aba estiver viva.
  //    Quando cair (close, network drop, sleep), servidor executa o
  //    onDisconnect remoto e apaga o entry.
  onDisconnect(_myRef).remove().then(() => {
    return set(_myRef, {
      uid:         user.uid,
      name:        profile?.name || '',
      email:       profile?.email || '',
      avatarColor: profile?.avatarColor || '#6B7280',
      lastSeen:    serverTimestamp(),
    });
  }).catch(e => {
    console.warn('[presence] start falhou:', e?.message);
  });

  // Listener: lê /presence inteiro (max ~200 users) e popula store
  const allRef = ref(rtdb, 'presence');
  const handler = (snap) => {
    const data = snap.val() || {};
    const now = Date.now();
    const online = Object.values(data).filter(p => {
      // Filtro defensivo: se lastSeen for recente, considera online.
      // (RTDB com onDisconnect já limpa entries velhos, mas tolerância
      // pra casos onde o cleanup atrasou.)
      const ts = typeof p?.lastSeen === 'number' ? p.lastSeen : 0;
      return ts && (now - ts) <= ONLINE_THRESHOLD_MS;
    });
    store.set('onlineUsers', online);
  };
  onValue(allRef, handler);
  _onlineUnsub = () => off(allRef, 'value', handler);
}

/**
 * Para presence (logout). Remove entry + cancela onDisconnect.
 */
export function stopPresence() {
  if (_onlineUnsub) {
    try { _onlineUnsub(); } catch {}
    _onlineUnsub = null;
  }
  if (_myRef) {
    // Cancela onDisconnect e apaga o entry imediatamente.
    onDisconnect(_myRef).cancel().catch(() => {});
    remove(_myRef).catch(() => {});
    _myRef = null;
  }
  store.set('onlineUsers', []);
}
