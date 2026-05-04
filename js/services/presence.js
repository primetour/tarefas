/**
 * PRIMETOUR — User Presence (Online Users)
 *
 * Mantém registro em tempo real de quem está online no sistema.
 * Cada user logado escreve heartbeat em `presence/{uid}` a cada 30s.
 * Listener do header lê presence onde lastSeen > now - 90s e mostra
 * avatares dos online users.
 *
 * IMPLEMENTAÇÃO:
 * - Heartbeat: setInterval a cada 30s → updateDoc presence/{uid}
 * - Threshold: user é "online" se lastSeen >= now - 90s (3 heartbeats
 *   missed = offline). Tolerância pra slow networks.
 * - Cleanup: ao logout/beforeunload → deleteDoc presence/{uid}
 * - Listener: onSnapshot na coleção presence inteira (max 200 docs OK)
 */

import {
  collection, doc, setDoc, deleteDoc, onSnapshot, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';

// Intervalos otimizados pra free tier:
// - Heartbeat 2min = 720 writes/user/dia (vs 2880 em 30s = 4x menos)
// - Threshold 6min = 3 heartbeats missed = offline
// Custo pra 200 users: ~144k writes/dia. Ainda alto mas viável no Blaze.
// Plano definitivo: migrar pra Firebase Realtime Database (RTDB), que tem
// onDisconnect() nativo e não consome quota Firestore. Requer habilitar
// RTDB no Firebase Console (1 click). Ver TODO no commit message.
const HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;  // 2 min
const ONLINE_THRESHOLD_MS   = 6 * 60 * 1000;  // 6 min

let _heartbeatTimer = null;
let _presenceUnsub  = null;
let _beforeunloadHandler = null;

/**
 * Inicia o heartbeat + listener. Chamar uma vez no boot, após login.
 */
export function startPresence() {
  const user = store.get('currentUser');
  if (!user?.uid) return;

  // Para ciclo anterior se houver (idempotente em re-login na mesma aba)
  stopPresence();

  // Heartbeat: escreve agora + a cada 30s
  const writeHeartbeat = async () => {
    try {
      const profile = store.get('userProfile');
      await setDoc(doc(db, 'presence', user.uid), {
        uid:      user.uid,
        name:     profile?.name || '',
        email:    profile?.email || '',
        avatarColor: profile?.avatarColor || '#6B7280',
        lastSeen: serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      // Silencioso: se rules bloqueiam ou rede caiu, não tem o que fazer
      console.debug('[presence] heartbeat falhou:', e?.message);
    }
  };
  writeHeartbeat();
  _heartbeatTimer = setInterval(writeHeartbeat, HEARTBEAT_INTERVAL_MS);

  // Cleanup no fechamento da aba (best-effort — beacon é mais robusto
  // mas requer endpoint server; deleteDoc client funciona bem na maioria)
  _beforeunloadHandler = () => {
    try { deleteDoc(doc(db, 'presence', user.uid)); } catch {}
  };
  window.addEventListener('beforeunload', _beforeunloadHandler);

  // Listener: monitora coleção presence inteira → store.onlineUsers
  // (ID do user, name, lastSeen). UI lê do store.
  _presenceUnsub = onSnapshot(
    collection(db, 'presence'),
    (snap) => {
      const now = Date.now();
      const online = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(p => {
          const ts = p.lastSeen?.toMillis?.() || 0;
          return ts && (now - ts) <= ONLINE_THRESHOLD_MS;
        });
      store.set('onlineUsers', online);
    },
    (err) => {
      console.warn('[presence] snapshot err:', err?.message);
    }
  );
}

/**
 * Para o heartbeat e remove presence. Chamar no logout.
 */
export function stopPresence() {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }
  if (_presenceUnsub) {
    try { _presenceUnsub(); } catch {}
    _presenceUnsub = null;
  }
  if (_beforeunloadHandler) {
    try { window.removeEventListener('beforeunload', _beforeunloadHandler); } catch {}
    _beforeunloadHandler = null;
  }
  // Tenta apagar o doc de presence (best-effort)
  const user = store.get('currentUser');
  if (user?.uid) {
    deleteDoc(doc(db, 'presence', user.uid)).catch(() => {});
  }
  store.set('onlineUsers', []);
}
