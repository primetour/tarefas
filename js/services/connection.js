/**
 * PRIMETOUR — Connection Status Service (v4.49.61+)
 *
 * Centraliza o monitoramento de status de rede + saúde do Firestore.
 * 3 estados expostos:
 *   - 'online'        → navigator.onLine === true E último write OK
 *   - 'reconnecting'  → após erro de network detectado (último write/listener falhou),
 *                       ou após online voltar de offline (grace 5s pra reads sincronizarem)
 *   - 'offline'       → navigator.onLine === false
 *
 * Provides:
 *   getStatus()                          — retorna 'online' | 'reconnecting' | 'offline'
 *   onChange(callback)                   — listener notificado em mudanças (retorna unsub)
 *   markNetworkError(source, error)      — chame quando suspeitar de falha de rede (listener
 *                                          onError, write catch, fetch failure). Coloca status
 *                                          em 'reconnecting'.
 *   markNetworkOk()                      — chame após um write/read bem-sucedido. Restaura 'online'.
 *   isFirestoreError(err)                — heurística: error.code in {unavailable, aborted,
 *                                          deadline-exceeded, cancelled} ou message com 'fetch'/'network'
 *   getRecentErrors(limit=10)            — últimos N erros recentes (admin/debug)
 *
 * Esse service NÃO faz retry diretamente — fornece sinais. retry.js consome.
 *
 * Indicador visual: o componente connectionIndicator.js (junto, mas separado)
 * monta um chip discreto no canto superior direito.
 */

import { store } from '../store.js';

const LS_RECENT_ERRORS = 'primetour-conn-recent-errors';
const ERROR_RING_SIZE = 20;
const RECONNECTING_GRACE_MS = 5000; // tempo de "reconectando" antes de declarar online novamente

let _status = navigator.onLine ? 'online' : 'offline';
let _reconnectTimer = null;
const _listeners = new Set();
let _recentErrors = [];

try {
  const raw = localStorage.getItem(LS_RECENT_ERRORS);
  if (raw) _recentErrors = JSON.parse(raw);
} catch { /* ignore */ }

function _saveRecentErrors() {
  try {
    localStorage.setItem(LS_RECENT_ERRORS, JSON.stringify(_recentErrors.slice(-ERROR_RING_SIZE)));
  } catch { /* full storage? ignore */ }
}

function _setStatus(next) {
  if (next === _status) return;
  const prev = _status;
  _status = next;
  for (const cb of _listeners) {
    try { cb(next, prev); } catch (e) { console.warn('[connection] listener err:', e); }
  }
}

function _clearReconnectTimer() {
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
}

// ── Public API ────────────────────────────────────────────────
export function getStatus() { return _status; }

export function onChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

export function isFirestoreError(err) {
  if (!err) return false;
  const code = String(err.code || '').toLowerCase();
  const msg  = String(err.message || err || '').toLowerCase();
  const networkCodes = ['unavailable', 'aborted', 'deadline-exceeded', 'cancelled', 'internal', 'resource-exhausted'];
  if (networkCodes.includes(code)) return true;
  if (/network|fetch|offline|connection|timeout/i.test(msg)) return true;
  return false;
}

export function markNetworkError(source, err) {
  // Só sinaliza se for de fato erro de rede — outras causas (permission, validation)
  // não devem virar "reconectando".
  if (!isFirestoreError(err)) return;
  _recentErrors.push({
    ts: Date.now(),
    source: String(source || 'unknown'),
    code: err?.code || null,
    msg: String(err?.message || err || '').slice(0, 200),
  });
  if (_recentErrors.length > ERROR_RING_SIZE) {
    _recentErrors = _recentErrors.slice(-ERROR_RING_SIZE);
  }
  _saveRecentErrors();

  // Se já está offline, mantém. Senão entra em 'reconnecting'.
  if (_status === 'offline') return;
  _setStatus('reconnecting');

  // Timer pra voltar a 'online' após RECONNECTING_GRACE_MS sem novos erros.
  _clearReconnectTimer();
  _reconnectTimer = setTimeout(() => {
    if (_status === 'reconnecting' && navigator.onLine) {
      _setStatus('online');
    }
  }, RECONNECTING_GRACE_MS);
}

export function markNetworkOk() {
  // Chamado após write/read bem-sucedido. Se estava reconnecting, sobe pra online.
  if (_status === 'reconnecting' && navigator.onLine) {
    _clearReconnectTimer();
    _setStatus('online');
  }
}

export function getRecentErrors(limit = 10) {
  return _recentErrors.slice(-limit).reverse(); // mais recentes primeiro
}

export function clearRecentErrors() {
  _recentErrors = [];
  _saveRecentErrors();
}

// ── Browser online/offline events ─────────────────────────────
window.addEventListener('online',  () => {
  // Browser detectou que voltou online. Entra em reconnecting temporariamente
  // (Firestore SDK precisa reabrir conexão, alguns reads podem demorar).
  _setStatus('reconnecting');
  _clearReconnectTimer();
  _reconnectTimer = setTimeout(() => {
    if (navigator.onLine) _setStatus('online');
  }, RECONNECTING_GRACE_MS);
});
window.addEventListener('offline', () => {
  _clearReconnectTimer();
  _setStatus('offline');
});

// ── Debug exposure (admin/audit) ───────────────────────────────
if (typeof window !== 'undefined') {
  window.__PRIMETOUR_CONNECTION__ = {
    getStatus, getRecentErrors, clearRecentErrors,
  };
}
