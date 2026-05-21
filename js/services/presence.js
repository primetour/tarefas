/**
 * PRIMETOUR — User Presence (Online Users) com detecção de inatividade
 *
 * Mantém registro em tempo real de quem está online — diferenciando
 * "ativo" (interagindo agora) de "ausente" (aba aberta sem interação).
 *
 * IMPLEMENTAÇÃO:
 * - Heartbeat: setInterval escreve presence/{uid} com state ('active'|'idle')
 * - Sinal de atividade: mousemove/mousedown/keydown/scroll/touchstart/wheel
 *   → atualiza `_lastActivityTs`. document.visibilitychange tb dispara.
 * - State derivado: `document.hidden` OU `now - lastActivity > IDLE_AFTER_MS`
 *   → 'idle'. Senão → 'active'.
 * - Heartbeat adaptativo: 2min ativo, 5min idle (menos writes quando ausente).
 * - Threshold do listener: ainda 6min = remove do "online" total. Idle continua
 *   contando como online (apenas marcação visual diferente).
 * - Cleanup: ao logout/beforeunload → deleteDoc presence/{uid}.
 * - Listener: onSnapshot na coleção presence inteira → store.onlineUsers
 *   (active) + store.idleUsers (ausentes).
 */

import {
  collection, doc, setDoc, deleteDoc, onSnapshot, serverTimestamp, increment,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';

// ─── Configuração ──────────────────────────────────────────
// Janelas otimizadas pra Blaze tier:
// - Active heartbeat 2min: 720 writes/user/dia
// - Idle heartbeat 5min: 288 writes/user/dia (40% do active)
// - IDLE_AFTER 5min de inatividade já marca como ausente
// - ONLINE_THRESHOLD 6min: além disso → some do header
const ACTIVE_HEARTBEAT_MS = 2 * 60 * 1000;  // 2 min
const IDLE_HEARTBEAT_MS   = 5 * 60 * 1000;  // 5 min
const IDLE_AFTER_MS       = 5 * 60 * 1000;  // 5 min sem interação → idle
const ONLINE_THRESHOLD_MS = 6 * 60 * 1000;  // doc mais antigo que isso = offline

// Threshold pra considerar uma "sessão contínua" — gaps maiores que isto
// (user offline, abas todas fechadas) NÃO contam como tempo de uso.
const SESSION_GAP_MS = 10 * 60 * 1000; // 10 min

const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'wheel', 'click'];

let _heartbeatTimer = null;
let _presenceUnsub  = null;
let _beforeunloadHandler = null;
let _visibilityHandler = null;
let _activityHandler   = null;
let _hashChangeHandler = null;
let _lastActivityTs = 0;
let _lastWriteTs    = 0;
let _lastWrittenState = null;

/** Calcula o state atual baseado em atividade + visibilidade da aba. */
function computeState() {
  if (typeof document !== 'undefined' && document.hidden) return 'idle';
  if (Date.now() - _lastActivityTs > IDLE_AFTER_MS)        return 'idle';
  return 'active';
}

/**
 * Inicia heartbeat + listeners de atividade. Chamar uma vez no boot, após login.
 */
export function startPresence() {
  const user = store.get('currentUser');
  if (!user?.uid) return;

  // Para ciclo anterior se houver (idempotente em re-login na mesma aba)
  stopPresence();

  // Marca atividade inicial — o user acabou de logar/abrir a aba
  _lastActivityTs = Date.now();
  _lastWriteTs    = 0;
  _lastWrittenState = null;

  // Heartbeat: escreve agora e periodicamente. Skip writes redundantes
  // quando state não mudou e ainda dentro da janela do heartbeat ativo/idle.
  const writeHeartbeat = async (force = false) => {
    try {
      const state = computeState();
      const interval = state === 'active' ? ACTIVE_HEARTBEAT_MS : IDLE_HEARTBEAT_MS;
      const now = Date.now();
      const elapsed  = now - _lastWriteTs;
      const stateChanged = state !== _lastWrittenState;
      // Pula write se: não foi forçado, state não mudou, e dentro da janela
      if (!force && !stateChanged && elapsed < interval) return;

      const profile = store.get('userProfile');
      // 4.36.0+ currentRoute: rota atual do user pra alimentar o /office
      // (Escritório Virtual). Lido via location.hash; usuários podem opt-out
      // via profile.prefs.appearInOffice = false (default true).
      const currentRoute = (typeof location !== 'undefined' ? location.hash.slice(1) : '') || 'home';
      const appearInOffice = profile?.prefs?.appearInOffice !== false;
      // 4.35.27+ inclui photoURL (foto do SSO Microsoft ou upload manual)
      // pra header.js renderizar foto real em vez de cair sempre nas iniciais.
      // Foto pode ser grande (~50-80KB base64) — mesmo assim cabe no doc
      // (limite Firestore 1MB) e o batch de presence rod a a cada 30s.
      await setDoc(doc(db, 'presence', user.uid), {
        uid:      user.uid,
        name:     profile?.name || '',
        email:    profile?.email || '',
        photoURL: profile?.photoURL || null,
        avatarColor: profile?.avatarColor || '#6B7280',
        state,
        lastSeen: serverTimestamp(),
        lastActivityAt: _lastActivityTs,
        // 4.36.0+ Escritório Virtual
        currentRoute: appearInOffice ? currentRoute : null,
        appearInOffice,
      }, { merge: true });

      // ── Acumulador diário de tempo de uso (presence_daily) ─────
      // Adiciona o delta desde o último heartbeat ao contador do dia.
      // Gaps > SESSION_GAP_MS (e.g., user offline) NÃO contam — preserva
      // semantics de "tempo realmente usando o sistema".
      // Atribui o delta ao state ANTERIOR (era o state em vigor durante o gap).
      try {
        if (_lastWriteTs > 0) {
          const delta = now - _lastWriteTs;
          if (delta > 0 && delta <= SESSION_GAP_MS) {
            const prevState = _lastWrittenState || state;
            const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
            const dailyRef = doc(db, 'presence_daily', `${user.uid}_${today}`);
            const dailyUpdate = {
              uid:        user.uid,
              userName:   profile?.name || '',
              email:      profile?.email || '',
              sector:     profile?.sector || profile?.department || '',
              nucleos:    Array.isArray(profile?.nucleos) ? profile.nucleos : [],
              date:       today,
              lastSeen:   serverTimestamp(),
              updatedAt:  serverTimestamp(),
              totalMs:    increment(delta),
              [prevState === 'active' ? 'activeMs' : 'idleMs']: increment(delta),
            };
            await setDoc(dailyRef, dailyUpdate, { merge: true });
          }
        }
      } catch (dailyErr) {
        console.debug('[presence] daily accumulator falhou:', dailyErr?.message);
      }

      _lastWriteTs = now;
      _lastWrittenState = state;
    } catch (e) {
      console.debug('[presence] heartbeat falhou:', e?.message);
    }
  };
  writeHeartbeat(true);
  // Roda a checagem com intervalo curto (1min); cada chamada decide se escreve
  _heartbeatTimer = setInterval(() => writeHeartbeat(false), 60 * 1000);

  // ─── Sinais de atividade ────────────────────────────────
  // Throttle: dispara updates de _lastActivityTs no máximo a cada 1s pra
  // não sobrecarregar com mousemove (~60Hz). Pra reagir rápido na transição
  // idle→active, força um heartbeat se acabou de virar ativo.
  let lastBumpTs = 0;
  const ACTIVITY_THROTTLE_MS = 1000;
  _activityHandler = () => {
    const now = Date.now();
    if (now - lastBumpTs < ACTIVITY_THROTTLE_MS) return;
    lastBumpTs = now;
    const wasIdle = computeState() === 'idle';
    _lastActivityTs = now;
    if (wasIdle) {
      // Transição idle → active: força heartbeat imediato pra atualizar UI
      writeHeartbeat(true);
    }
  };
  ACTIVITY_EVENTS.forEach(ev => {
    window.addEventListener(ev, _activityHandler, { passive: true, capture: true });
  });

  // ─── Visibilidade da aba ────────────────────────────────
  // Aba escondida → idle imediato. Aba visível → reset _lastActivityTs.
  // 4.35.29+ NÃO zeramos _lastActivityTs ao esconder a aba (era a causa do
  // tooltip "ausente" sem tempo). computeState() já força idle quando
  // document.hidden=true; mantemos a timestamp real pra "ausente há X min".
  _visibilityHandler = () => {
    if (document.hidden) {
      writeHeartbeat(true); // grava state=idle mas preserva lastActivityAt
    } else {
      _lastActivityTs = Date.now();
      writeHeartbeat(true);
    }
  };
  document.addEventListener('visibilitychange', _visibilityHandler);

  // 4.36.0+ Heartbeat forçado ao trocar de rota (alimenta o Escritório Virtual)
  _hashChangeHandler = () => writeHeartbeat(true);
  window.addEventListener('hashchange', _hashChangeHandler);

  // ─── Cleanup no fechamento da aba ───────────────────────
  _beforeunloadHandler = () => {
    try { deleteDoc(doc(db, 'presence', user.uid)); } catch {}
  };
  window.addEventListener('beforeunload', _beforeunloadHandler);

  // ─── Listener da coleção presence ───────────────────────
  _presenceUnsub = onSnapshot(
    collection(db, 'presence'),
    (snap) => {
      const now = Date.now();
      const allOnline = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(p => {
          const ts = p.lastSeen?.toMillis?.() || 0;
          return ts && (now - ts) <= ONLINE_THRESHOLD_MS;
        });
      // Separa active vs idle. Mantém store.onlineUsers como o conjunto de
      // ativos pra preservar comportamento legado (avatares no header).
      const active = allOnline.filter(p => p.state !== 'idle');
      const idle   = allOnline.filter(p => p.state === 'idle');
      store.set('onlineUsers', active);
      store.set('idleUsers',   idle);
    },
    // v4.49.61+ Sinaliza connection pra indicador UI mostrar "Reconectando"
    (err) => {
      console.warn('[presence] snapshot err:', err?.message);
      import('./listenerError.js').then(m => m.listenerError('presence')(err)).catch(() => {});
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
  if (_visibilityHandler) {
    try { document.removeEventListener('visibilitychange', _visibilityHandler); } catch {}
    _visibilityHandler = null;
  }
  if (_activityHandler) {
    ACTIVITY_EVENTS.forEach(ev => {
      try { window.removeEventListener(ev, _activityHandler, { capture: true }); } catch {}
    });
    _activityHandler = null;
  }
  if (_hashChangeHandler) {
    try { window.removeEventListener('hashchange', _hashChangeHandler); } catch {}
    _hashChangeHandler = null;
  }
  // Tenta apagar o doc de presence (best-effort)
  const user = store.get('currentUser');
  if (user?.uid) {
    deleteDoc(doc(db, 'presence', user.uid)).catch(() => {});
  }
  store.set('onlineUsers', []);
  store.set('idleUsers',   []);
}
