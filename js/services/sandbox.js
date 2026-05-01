/**
 * PRIMETOUR — Sandbox / Modo de Teste
 *
 * Permite que diretoria explore funcionalidades sem persistir
 * alterações no Firestore. Lógica:
 *
 * 1. Toggle persistido em localStorage ('primetour_sandbox' = '1' | '0')
 * 2. Disponível apenas para usuários com role master (diretoria)
 * 3. Banner persistente no topo do app quando ativo
 * 4. Wrapper `sandboxGuard()` em cada operação de WRITE crítica:
 *    - Se ativo: bloqueia o write, mostra toast "Em modo teste — não foi salvo"
 *    - Se não: executa normalmente
 * 5. Reads continuam normais (vê os dados reais)
 *
 * Uso esperado:
 *   import { sandboxGuard, isSandboxOn } from './sandbox.js';
 *   if (sandboxGuard('criar tarefa')) return null;
 *   await addDoc(...); // só roda se sandbox off
 */
import { store } from '../store.js';

const STORAGE_KEY = 'primetour_sandbox';

/* ─── Estado ─────────────────────────────────────────────── */
export function isSandboxOn() {
  try { return localStorage.getItem(STORAGE_KEY) === '1'; }
  catch { return false; }
}

export function canUseSandbox() {
  return store.isMaster();
}

/* ─── Toggle (apenas master) ─────────────────────────────── */
export function setSandboxOn(on) {
  if (!canUseSandbox()) return false;
  try {
    if (on) localStorage.setItem(STORAGE_KEY, '1');
    else    localStorage.removeItem(STORAGE_KEY);
    _updateBannerVisibility();
    return true;
  } catch { return false; }
}

/* ─── Guard pra writes ───────────────────────────────────── */
/* Retorna true se o write deve ser BLOQUEADO (sandbox on).
 * Quem chama: `if (sandboxGuard('descrição da ação')) return null;` */
export function sandboxGuard(action = 'esta operação') {
  if (!isSandboxOn()) return false;
  // Lazy import pra evitar circular
  import('../components/toast.js').then(({ toast }) => {
    toast.info(`🧪 Modo teste ativo: "${action}" não foi salvo no banco.`,
      { duration: 4000 });
  }).catch(() => {});
  return true;
}

/* ─── Banner UI ──────────────────────────────────────────── */
export function injectSandboxBanner() {
  if (document.getElementById('sandbox-banner')) return;
  const div = document.createElement('div');
  div.id = 'sandbox-banner';
  div.style.cssText = `
    display: none;
    position: fixed; top: 0; left: 0; right: 0;
    z-index: 99999;
    background: linear-gradient(90deg, #F59E0B, #EF4444);
    color: white;
    padding: 6px 16px;
    font-size: 0.8125rem;
    font-weight: 600;
    text-align: center;
    letter-spacing: 0.04em;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  `;
  div.innerHTML = `
    🧪 MODO TESTE ATIVO — alterações <strong>não são salvas</strong> no banco.
    <button id="sandbox-disable-btn" style="margin-left:12px;background:rgba(0,0,0,0.25);
      border:1px solid rgba(255,255,255,0.4);color:white;padding:2px 10px;
      border-radius:4px;cursor:pointer;font-size:0.75rem;font-weight:600;">
      Desativar
    </button>
  `;
  document.body.appendChild(div);
  document.getElementById('sandbox-disable-btn')?.addEventListener('click', () => {
    setSandboxOn(false);
    location.reload();
  });
  _updateBannerVisibility();
}

function _updateBannerVisibility() {
  const banner = document.getElementById('sandbox-banner');
  if (!banner) return;
  if (isSandboxOn()) {
    banner.style.display = 'block';
    document.body.style.paddingTop = '32px';
  } else {
    banner.style.display = 'none';
    document.body.style.paddingTop = '';
  }
}
