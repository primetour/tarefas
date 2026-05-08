/**
 * PRIMETOUR — Insight Drafts Dock
 *
 * Drawer fixo no rodapé das páginas de dashboard, mostrando os rascunhos
 * de insights do usuário. Inspirado no Outlook (drafts panel inferior).
 *
 * Estados:
 *   - Sem rascunhos → não renderiza nada (footprint zero)
 *   - Com rascunhos → barrinha discreta no rodapé "📝 Rascunhos (N) ▲"
 *   - Click → expande lista com tabs/cards
 *   - Click numa tab → abre form pré-preenchido (mesmo dashboard) ou navega
 *     pro dashboard de origem (com pendência via sessionStorage)
 *
 * Cross-tab: re-renderiza ao receber 'insightDrafts:changed' (do service ou
 * via storage event de outras abas).
 *
 * Mount:
 *   import { mountInsightDraftsDock } from '../components/insightDraftsDock.js';
 *   mountInsightDraftsDock({ dashboard: 'produtividade' });
 *
 * O dock é singleton — chamadas repetidas reutilizam o mesmo elemento.
 */

import {
  listDrafts,
  deleteDraft,
} from '../services/insightDrafts.js';

const DOCK_ID    = 'primetour-insight-drafts-dock';
const PENDING_KEY = 'primetour-insight-pending-draft'; // sessionStorage

/* ─── Mapping de dashboards → rota/icone/label ───────
 * Usado pra dois fins:
 *   1. Decidir se um draft é "do dashboard atual" (cross-dash navigation)
 *   2. Mostrar o ícone de origem no card do draft
 */
const DASH_INFO = {
  produtividade: { label: 'Produtividade', icon: '📊', hash: '#dashboards' },
  meta:          { label: 'Meta Ads',      icon: '📱', hash: '#meta-performance' },
  ga:            { label: 'GA4',           icon: '📈', hash: '#ga-performance' },
  nl:            { label: 'Newsletter',    icon: '📧', hash: '#nl-performance' },
  portal:        { label: 'Portal',        icon: '🌐', hash: '#portal-dashboard' },
  roteiro:       { label: 'Roteiro',       icon: '🗺',  hash: '#roteiro-dashboard' },
};

/* ─── Utils ──────────────────────────────────────── */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

function formatAge(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1)   return 'agora';
  if (min < 60)  return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)    return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

function shortTitle(d) {
  const t = (d.title || '').trim();
  if (t) return t.length > 38 ? t.slice(0, 36) + '…' : t;
  const o = (d.observation || '').trim();
  if (o) return (o.length > 38 ? o.slice(0, 36) + '…' : o) + ' (sem título)';
  return '(rascunho vazio)';
}

/* ─── Dock state ─────────────────────────────────── */

let mountedDashboard = null;
let expanded = false;
let listenerBound = false;

/* ─── Render ─────────────────────────────────────── */

function ensureRoot() {
  let root = document.getElementById(DOCK_ID);
  if (!root) {
    root = document.createElement('div');
    root.id = DOCK_ID;
    root.style.cssText = `
      position:fixed;left:0;right:0;bottom:0;z-index:1100;
      pointer-events:none;
    `;
    document.body.appendChild(root);
  }
  return root;
}

function unmount() {
  const root = document.getElementById(DOCK_ID);
  if (root) root.remove();
  mountedDashboard = null;
  expanded = false;
}

function render() {
  const drafts = listDrafts();
  const root = ensureRoot();

  if (drafts.length === 0) {
    root.innerHTML = '';
    return;
  }

  // Drafts do dashboard atual aparecem primeiro (mais relevantes)
  const sorted = [...drafts].sort((a, b) => {
    const aHere = a.dashboard === mountedDashboard ? 0 : 1;
    const bHere = b.dashboard === mountedDashboard ? 0 : 1;
    if (aHere !== bHere) return aHere - bHere;
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });

  const headerHTML = `
    <div id="ipd-bar" style="pointer-events:auto;
      background:var(--bg-card);
      border-top:1px solid var(--border-subtle);
      box-shadow:0 -8px 24px rgba(0,0,0,.18);
      padding:8px 16px;display:flex;align-items:center;gap:10px;
      cursor:pointer;user-select:none;font-size:0.8125rem;
      transition:background .15s;">
      <span style="font-weight:600;color:var(--text-primary);">📝 Rascunhos (${drafts.length})</span>
      <span style="font-size:0.7rem;color:var(--text-muted);flex:1;">
        ${expanded ? 'Clique para recolher' : 'Insights não publicados — clique para ver'}
      </span>
      <span style="color:var(--text-muted);">${expanded ? '▼' : '▲'}</span>
    </div>
  `;

  const listHTML = expanded ? `
    <div id="ipd-list" style="pointer-events:auto;
      background:var(--bg-surface);border-top:1px solid var(--border-subtle);
      max-height:280px;overflow-y:auto;padding:10px 16px;">
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">
        ${sorted.map(d => renderCard(d)).join('')}
      </div>
    </div>
  ` : '';

  root.innerHTML = listHTML + headerHTML;

  bindEvents(root, sorted);
}

function renderCard(d) {
  const info = DASH_INFO[d.dashboard] || { label: d.dashboard || '?', icon: '◇', hash: '' };
  const isHere = d.dashboard === mountedDashboard;
  const widgetLabel = d.indexLabel || (d.indexKey === 'general' || !d.indexKey ? 'Análise geral' : d.indexKey);

  return `
    <div class="ipd-card" data-draft-id="${esc(d.id)}" style="
      background:var(--bg-card);border:1px solid ${isHere ? 'rgba(212,168,67,.4)' : 'var(--border-subtle)'};
      border-radius:8px;padding:10px 12px;cursor:pointer;
      transition:all .15s;position:relative;">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
        <span style="font-size:0.65rem;color:var(--text-muted);">${info.icon} ${esc(info.label)}</span>
        <span style="font-size:0.65rem;color:var(--text-muted);">·</span>
        <span style="font-size:0.65rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${esc(widgetLabel)}</span>
        <button class="ipd-delete" data-draft-id="${esc(d.id)}" title="Descartar rascunho"
          style="background:none;border:none;cursor:pointer;color:var(--text-muted);
          padding:0 4px;font-size:0.875rem;line-height:1;">✕</button>
      </div>
      <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);
        margin-bottom:4px;line-height:1.3;">${esc(shortTitle(d))}</div>
      <div style="font-size:0.65rem;color:var(--text-muted);">
        ${formatAge(d.updatedAt)}${isHere ? '' : ' · ' + esc(info.label)}
      </div>
    </div>
  `;
}

/* ─── Event binding ──────────────────────────────── */

function bindEvents(root, drafts) {
  const bar = root.querySelector('#ipd-bar');
  if (bar) {
    bar.addEventListener('click', () => {
      expanded = !expanded;
      render();
    });
    bar.addEventListener('mouseenter', () => bar.style.background = 'var(--bg-elevated)');
    bar.addEventListener('mouseleave', () => bar.style.background = 'var(--bg-card)');
  }

  // Cards
  root.querySelectorAll('.ipd-card').forEach(card => {
    card.addEventListener('click', (e) => {
      // Ignora click no botão de delete
      if (e.target.classList.contains('ipd-delete')) return;
      const id = card.dataset.draftId;
      const draft = drafts.find(d => d.id === id);
      if (draft) openDraft(draft);
    });
    card.addEventListener('mouseenter', () => {
      card.style.borderColor = 'var(--accent-primary)';
      card.style.transform = 'translateY(-1px)';
    });
    card.addEventListener('mouseleave', () => {
      card.style.borderColor = '';
      card.style.transform = '';
    });
  });

  // Botões de delete
  root.querySelectorAll('.ipd-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.draftId;
      if (!id) return;
      if (confirm('Descartar este rascunho? Esta ação não pode ser desfeita.')) {
        deleteDraft(id);
        // service emite evento -> render() refresh automático
      }
    });
  });
}

/* ─── Abrir draft (mesmo dash ou cross-dash) ─────── */

function openDraft(draft) {
  // Mesmo dashboard? Abre form direto.
  if (draft.dashboard === mountedDashboard) {
    const opener = window.__primetourInsightForm?.[draft.dashboard];
    if (typeof opener === 'function') {
      expanded = false;
      render();
      opener(draft);
      return;
    }
    // Fallback: nenhum panel registrado ainda — sinaliza pendência
  }

  // Cross-dashboard: salva pendência e navega
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({
      draftId: draft.id,
      ts: Date.now(),
    }));
  } catch (_) {}

  const info = DASH_INFO[draft.dashboard];
  if (info?.hash) {
    window.location.hash = info.hash;
  }
}

/**
 * Verifica se há draft pendente pra abrir (após navegação cross-dashboard)
 * e aciona a abertura. Chamado pelo dock após mount no novo dashboard.
 *
 * Pendência expira em 30s (proteção contra zumbi).
 */
function consumePendingDraft(dashboard) {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return;
    const pending = JSON.parse(raw);
    if (!pending?.draftId) return sessionStorage.removeItem(PENDING_KEY);
    if (Date.now() - (pending.ts || 0) > 30_000) return sessionStorage.removeItem(PENDING_KEY);

    const drafts = listDrafts();
    const draft = drafts.find(d => d.id === pending.draftId);
    if (!draft) return sessionStorage.removeItem(PENDING_KEY);
    if (draft.dashboard !== dashboard) return; // ainda não chegou no dashboard certo

    // Espera o panel registrar o opener (acontece após mountInsightsPanel)
    let attempts = 0;
    const maxAttempts = 20; // 20 * 250ms = 5s
    const tryOpen = () => {
      const opener = window.__primetourInsightForm?.[dashboard];
      if (typeof opener === 'function') {
        sessionStorage.removeItem(PENDING_KEY);
        opener(draft);
      } else if (++attempts < maxAttempts) {
        setTimeout(tryOpen, 250);
      } else {
        sessionStorage.removeItem(PENDING_KEY);
      }
    };
    setTimeout(tryOpen, 250);
  } catch (_) { /* silent */ }
}

/* ─── API pública ────────────────────────────────── */

/* Lista de hashes que SÃO páginas de dashboard. Em hashchange, se o novo hash
 * NÃO está aqui, o dock se desmonta (evita ficar visível em outras páginas). */
const DASHBOARD_HASHES = new Set(
  Object.values(DASH_INFO).map(i => i.hash)
);

/**
 * Monta o dock no dashboard atual. Idempotente — se já estiver montado pro
 * mesmo dashboard, só re-renderiza. Trocando de dashboard, re-monta.
 */
export function mountInsightDraftsDock({ dashboard }) {
  if (!dashboard) return;
  mountedDashboard = dashboard;

  // Bind único dos listeners (sobrevive entre re-mounts).
  if (!listenerBound) {
    window.addEventListener('insightDrafts:changed', () => {
      if (mountedDashboard) render();
    });
    // Auto-unmount ao sair de uma rota de dashboard. Usa setTimeout porque
    // hashchange dispara antes da nova página re-montar; se a nova rota for
    // outro dashboard, o re-mount sobrescreve mountedDashboard antes do timeout.
    window.addEventListener('hashchange', () => {
      setTimeout(() => {
        const cur = window.location.hash;
        if (!DASHBOARD_HASHES.has(cur)) {
          unmount();
        }
      }, 100);
    });
    listenerBound = true;
  }

  render();
  consumePendingDraft(dashboard);
}

/** Desmonta o dock (chamado por destroyDashboards). */
export function unmountInsightDraftsDock() {
  unmount();
}
