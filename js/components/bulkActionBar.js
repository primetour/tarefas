/**
 * PRIMETOUR — Bulk Action Bar (estilo Monday.com)
 *
 * Componente compartilhado entre Lista de Tarefas e Steps (Kanban).
 * Aparece como barra flutuante quando o user seleciona ≥1 tarefa.
 *
 * Ações: Prazo, Prioridade, Status, Responsável, Projeto, Núcleo, Excluir.
 * Cada botão abre um popover; click numa opção dispara batch update.
 *
 * USAGE:
 *   import { mountBulkActionBar } from '../components/bulkActionBar.js';
 *   const bar = mountBulkActionBar({
 *     getSelectedIds: () => [...selectedIds],
 *     getSelectedTasks: () => allTasks.filter(t => selectedIds.has(t.id)),
 *     onClear: () => { selectedIds.clear(); rerender(); },
 *     onAfterUpdate: async () => { await reloadTasks(); rerender(); },
 *     allProjects, allUsers,
 *   });
 *   bar.show();   // mostra
 *   bar.hide();   // esconde
 *   bar.update(); // recalcula contagem após selectedIds mudar
 *   bar.destroy();
 */

import { store } from '../store.js';
import { toast } from './toast.js';
import {
  STATUSES, PRIORITIES, NUCLEOS,
  bulkUpdateTasks, bulkDeleteTasks,
} from '../services/tasks.js';

const esc = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const BAR_ID = 'bulk-action-bar';

/**
 * Monta a action bar e retorna API pra controlar.
 */
export function mountBulkActionBar({
  getSelectedIds,        // () => string[]
  getSelectedTasks,      // () => Task[] — pra exibir info contextual
  onClear,               // () => void — chamado quando user clica em ✕ ou após delete
  onAfterUpdate,         // () => Promise<void> — chamado após cada batch update
  allProjects = [],
  allUsers = null,       // se não passado, lê do store
}) {
  // Idempotente: se já existe, retorna a mesma
  let el = document.getElementById(BAR_ID);
  if (el) el.remove();

  el = document.createElement('div');
  el.id = BAR_ID;
  el.style.cssText = `
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%) translateY(140%);
    z-index: 9000;
    background: var(--bg-card, #111B27);
    border: 1px solid var(--brand-gold, #D4A843);
    border-radius: 12px;
    padding: 10px 14px;
    box-shadow: 0 16px 48px rgba(0,0,0,0.55);
    display: flex; align-items: center; gap: 12px;
    flex-wrap: wrap; max-width: calc(100vw - 32px);
    transition: transform 0.25s cubic-bezier(.34,1.56,.64,1);
    font-family: var(--font-ui);
  `;
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;
      padding-right:10px;border-right:1px solid var(--border-subtle);">
      <span id="${BAR_ID}-count" style="font-size:0.875rem;font-weight:700;
        color:var(--brand-gold);">0 selecionada${''}</span>
    </div>
    <button data-action="dueDate"   class="bab-btn" title="Alterar prazo">📅 <span>Prazo</span></button>
    <button data-action="priority"  class="bab-btn" title="Alterar prioridade">🔥 <span>Prioridade</span></button>
    <button data-action="status"    class="bab-btn" title="Alterar status">🚦 <span>Status</span></button>
    <button data-action="assignees" class="bab-btn" title="Alterar responsáveis">👤 <span>Responsável</span></button>
    <button data-action="projectId" class="bab-btn" title="Alterar projeto">◈ <span>Projeto</span></button>
    <button data-action="nucleos"   class="bab-btn" title="Alterar núcleo">◉ <span>Núcleo</span></button>
    <button data-action="delete"    class="bab-btn bab-danger" title="Excluir">🗑 <span>Excluir</span></button>
    <button id="${BAR_ID}-close" title="Limpar seleção"
      style="background:none;border:none;color:var(--text-muted);cursor:pointer;
      font-size:1rem;padding:4px 8px;margin-left:4px;">✕</button>
  `;
  document.body.appendChild(el);

  // Estilo dos botões via inline tag pra não depender de css externo
  if (!document.getElementById('bab-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'bab-styles';
    styleEl.textContent = `
      .bab-btn {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 6px 12px; border: 1px solid var(--border-subtle);
        border-radius: 8px; background: var(--bg-elevated);
        color: var(--text-primary); font-size: 0.8125rem; font-weight: 500;
        cursor: pointer; transition: all 0.15s;
        font-family: inherit;
      }
      .bab-btn:hover {
        background: var(--brand-gold);
        color: #000;
        border-color: var(--brand-gold);
      }
      .bab-btn.bab-danger:hover {
        background: var(--color-danger, #EF4444);
        color: #fff;
        border-color: var(--color-danger, #EF4444);
      }
      .bab-popover {
        position: fixed; z-index: 9001;
        background: var(--bg-card, #111B27);
        border: 1px solid var(--border-subtle, #1E2D3D);
        border-radius: 10px;
        box-shadow: 0 12px 40px rgba(0,0,0,0.5);
        padding: 8px;
        min-width: 220px; max-width: 320px;
        font-family: var(--font-ui);
      }
      .bab-pop-header {
        font-size: 0.6875rem; color: var(--text-muted);
        text-transform: uppercase; letter-spacing: 0.05em;
        font-weight: 600; padding: 6px 10px 8px;
        border-bottom: 1px solid var(--border-subtle);
        margin-bottom: 6px;
      }
      .bab-pop-item {
        display: flex; align-items: center; gap: 8px;
        padding: 8px 10px; border-radius: 6px;
        cursor: pointer; font-size: 0.8125rem;
        color: var(--text-primary);
        transition: background 0.1s;
      }
      .bab-pop-item:hover { background: var(--bg-elevated); }
      .bab-pop-input {
        width: 100%; padding: 6px 10px; font-size: 0.8125rem;
        border: 1px solid var(--border-subtle);
        border-radius: 6px; background: var(--bg-surface);
        color: var(--text-primary); outline: none;
        font-family: inherit; box-sizing: border-box;
      }
      .bab-pop-input:focus { border-color: var(--brand-gold); }
    `;
    document.head.appendChild(styleEl);
  }

  // ─── Renderiza popover genérico ─────────────────────────
  let popover = null;
  const closePopover = () => {
    if (popover) { popover.remove(); popover = null; }
    document.removeEventListener('click', _outsideHandler, true);
    document.removeEventListener('keydown', _escHandler);
  };
  const _outsideHandler = (e) => {
    if (!popover) return;
    if (popover.contains(e.target) || e.target.closest('.bab-btn')) return;
    closePopover();
  };
  const _escHandler = (e) => { if (e.key === 'Escape') closePopover(); };

  function openPopover(anchor, html) {
    closePopover();
    popover = document.createElement('div');
    popover.className = 'bab-popover';
    popover.innerHTML = html;
    document.body.appendChild(popover);

    // Posiciona acima do botão (já que a barra está no rodapé)
    const r = anchor.getBoundingClientRect();
    const pr = popover.getBoundingClientRect();
    let left = r.left + r.width / 2 - pr.width / 2;
    if (left < 8) left = 8;
    if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
    let top = r.top - pr.height - 8;
    if (top < 8) top = r.bottom + 8;
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;

    setTimeout(() => {
      document.addEventListener('click', _outsideHandler, true);
      document.addEventListener('keydown', _escHandler);
    }, 0);
  }

  // ─── Handler genérico de batch update ───────────────────
  async function applyPatch(patch, label) {
    const ids = getSelectedIds();
    if (!ids.length) return;
    closePopover();
    const items = ids.map(id => ({ id, data: patch }));
    try {
      const result = await bulkUpdateTasks(items);
      const msg = result.failed > 0
        ? `${result.updated} tarefa(s) atualizada(s) · ${result.failed} falha(s)`
        : `${result.updated} tarefa(s) atualizada(s)${label ? ' — ' + label : ''}`;
      toast.success(msg);
    } catch (e) {
      toast.error('Falha ao atualizar: ' + (e.message || 'erro desconhecido'));
    }
    if (typeof onAfterUpdate === 'function') await onAfterUpdate();
  }

  // ─── Popovers individuais por ação ──────────────────────
  function popDueDate(btn) {
    openPopover(btn, `
      <div class="bab-pop-header">Definir prazo</div>
      <div style="padding:0 10px 10px;">
        <input type="date" id="bab-due-input" class="bab-pop-input">
      </div>
      <div style="display:flex;gap:6px;padding:0 10px 10px;">
        <button class="bab-btn" id="bab-due-apply" style="flex:1;">Aplicar</button>
        <button class="bab-btn" id="bab-due-clear" style="background:transparent;border-color:var(--border-subtle);">Remover prazo</button>
      </div>
    `);
    document.getElementById('bab-due-apply').addEventListener('click', () => {
      const v = document.getElementById('bab-due-input').value;
      if (!v) { toast.error('Selecione uma data ou clique em Remover prazo.'); return; }
      // Salva como Date (Firestore serializa pra Timestamp)
      applyPatch({ dueDate: new Date(v + 'T12:00:00') }, `prazo: ${v}`);
    });
    document.getElementById('bab-due-clear').addEventListener('click', () => {
      applyPatch({ dueDate: null }, 'prazo removido');
    });
  }

  function popPriority(btn) {
    openPopover(btn, `
      <div class="bab-pop-header">Alterar prioridade</div>
      ${PRIORITIES.map(p => `
        <div class="bab-pop-item" data-val="${esc(p.value)}">
          <span style="width:10px;height:10px;border-radius:50%;background:${p.color};"></span>
          <span>${esc(p.label)}</span>
        </div>
      `).join('')}
    `);
    popover.querySelectorAll('.bab-pop-item').forEach(item => {
      item.addEventListener('click', () => {
        const v = item.dataset.val;
        const label = PRIORITIES.find(p => p.value === v)?.label || v;
        applyPatch({ priority: v }, `prioridade: ${label}`);
      });
    });
  }

  function popStatus(btn) {
    openPopover(btn, `
      <div class="bab-pop-header">Alterar status</div>
      ${STATUSES.map(s => `
        <div class="bab-pop-item" data-val="${esc(s.value)}">
          <span style="width:10px;height:10px;border-radius:50%;background:${s.color};"></span>
          <span>${esc(s.label)}</span>
        </div>
      `).join('')}
    `);
    popover.querySelectorAll('.bab-pop-item').forEach(item => {
      item.addEventListener('click', () => {
        const v = item.dataset.val;
        const label = STATUSES.find(s => s.value === v)?.label || v;
        const patch = { status: v };
        // Quando marca como concluído, registra completedAt
        if (v === 'done') patch.completedAt = new Date();
        applyPatch(patch, `status: ${label}`);
      });
    });
  }

  function popAssignees(btn) {
    const users = allUsers || (store.get('users') || []).filter(u => u.active !== false);
    openPopover(btn, `
      <div class="bab-pop-header">Definir responsável (substitui)</div>
      <div style="padding:0 10px 8px;">
        <input type="text" class="bab-pop-input" id="bab-assignee-search" placeholder="Buscar usuário…">
      </div>
      <div id="bab-assignee-list" style="max-height:240px;overflow-y:auto;padding:0 4px;">
        ${users.map(u => `
          <div class="bab-pop-item" data-val="${esc(u.id)}" data-name="${esc(u.name||'')}">
            <div class="avatar avatar-sm" style="background:${u.avatarColor||'#3B82F6'};
              width:24px;height:24px;font-size:0.625rem;font-weight:600;color:#fff;
              display:flex;align-items:center;justify-content:center;border-radius:50%;">
              ${(u.name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase()}
            </div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.8125rem;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(u.name || '—')}</div>
              <div style="font-size:0.6875rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(u.email || '')}</div>
            </div>
          </div>
        `).join('')}
      </div>
      <div style="padding:8px 10px;border-top:1px solid var(--border-subtle);margin-top:4px;">
        <button class="bab-btn" id="bab-assignee-clear" style="width:100%;background:transparent;border-color:var(--border-subtle);">
          Remover todos os responsáveis
        </button>
      </div>
    `);
    const search = document.getElementById('bab-assignee-search');
    const list = document.getElementById('bab-assignee-list');
    search?.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      list.querySelectorAll('.bab-pop-item').forEach(item => {
        const n = (item.dataset.name || '').toLowerCase();
        item.style.display = n.includes(q) ? '' : 'none';
      });
    });
    list.querySelectorAll('.bab-pop-item').forEach(item => {
      item.addEventListener('click', () => {
        const v = item.dataset.val;
        applyPatch({ assignees: [v] }, `responsável: ${item.dataset.name}`);
      });
    });
    document.getElementById('bab-assignee-clear').addEventListener('click', () => {
      applyPatch({ assignees: [] }, 'sem responsável');
    });
  }

  function popProject(btn) {
    openPopover(btn, `
      <div class="bab-pop-header">Mover para projeto</div>
      <div style="padding:0 10px 8px;">
        <input type="text" class="bab-pop-input" id="bab-proj-search" placeholder="Buscar projeto…">
      </div>
      <div id="bab-proj-list" style="max-height:280px;overflow-y:auto;padding:0 4px;">
        ${(allProjects||[]).filter(p => !p.archived).map(p => `
          <div class="bab-pop-item" data-val="${esc(p.id)}" data-name="${esc(p.name||'')}">
            <span style="font-size:1rem;">${esc(p.icon || '📦')}</span>
            <span style="flex:1;color:var(--text-primary);">${esc(p.name || '—')}</span>
          </div>
        `).join('')}
      </div>
      <div style="padding:8px 10px;border-top:1px solid var(--border-subtle);margin-top:4px;">
        <button class="bab-btn" id="bab-proj-clear" style="width:100%;background:transparent;border-color:var(--border-subtle);">
          Tirar do projeto
        </button>
      </div>
    `);
    const search = document.getElementById('bab-proj-search');
    const list = document.getElementById('bab-proj-list');
    search?.addEventListener('input', () => {
      const q = search.value.toLowerCase();
      list.querySelectorAll('.bab-pop-item').forEach(item => {
        const n = (item.dataset.name || '').toLowerCase();
        item.style.display = n.includes(q) ? '' : 'none';
      });
    });
    list.querySelectorAll('.bab-pop-item').forEach(item => {
      item.addEventListener('click', () => {
        applyPatch({ projectId: item.dataset.val }, `projeto: ${item.dataset.name}`);
      });
    });
    document.getElementById('bab-proj-clear').addEventListener('click', () => {
      applyPatch({ projectId: null }, 'sem projeto');
    });
  }

  function popNucleo(btn) {
    openPopover(btn, `
      <div class="bab-pop-header">Alterar núcleo (substitui)</div>
      ${NUCLEOS.map(n => `
        <div class="bab-pop-item" data-val="${esc(n.value)}">
          <span style="color:var(--brand-gold);">◈</span>
          <span>${esc(n.label)}</span>
        </div>
      `).join('')}
      <div style="padding:8px 10px;border-top:1px solid var(--border-subtle);margin-top:4px;">
        <button class="bab-btn" id="bab-nuc-clear" style="width:100%;background:transparent;border-color:var(--border-subtle);">
          Remover núcleo
        </button>
      </div>
    `);
    popover.querySelectorAll('.bab-pop-item').forEach(item => {
      item.addEventListener('click', () => {
        const v = item.dataset.val;
        const label = NUCLEOS.find(n => n.value === v)?.label || v;
        applyPatch({ nucleos: [v] }, `núcleo: ${label}`);
      });
    });
    document.getElementById('bab-nuc-clear').addEventListener('click', () => {
      applyPatch({ nucleos: [] }, 'sem núcleo');
    });
  }

  async function handleDelete() {
    const ids = getSelectedIds();
    if (!ids.length) return;
    closePopover();
    const ok = confirm(`Excluir ${ids.length} tarefa${ids.length!==1?'s':''} permanentemente?\n\nEsta ação NÃO pode ser desfeita.`);
    if (!ok) return;
    const ok2 = confirm(`⚠ CONFIRMAÇÃO FINAL: ${ids.length} tarefa(s) serão apagadas. Continuar?`);
    if (!ok2) return;
    try {
      const res = await bulkDeleteTasks(ids);
      toast.success(`${res.deleted} tarefa(s) excluída(s)${res.failed ? ` · ${res.failed} falha(s)` : ''}`);
    } catch (e) {
      toast.error('Falha ao excluir: ' + (e.message || ''));
    }
    if (typeof onClear === 'function') onClear();
    if (typeof onAfterUpdate === 'function') await onAfterUpdate();
  }

  // ─── Wire dos botões ─────────────────────────────────────
  el.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      switch (action) {
        case 'dueDate':   popDueDate(btn);   break;
        case 'priority':  popPriority(btn);  break;
        case 'status':    popStatus(btn);    break;
        case 'assignees': popAssignees(btn); break;
        case 'projectId': popProject(btn);   break;
        case 'nucleos':   popNucleo(btn);    break;
        case 'delete':    handleDelete();    break;
      }
    });
  });

  document.getElementById(`${BAR_ID}-close`).addEventListener('click', () => {
    closePopover();
    if (typeof onClear === 'function') onClear();
  });

  // ─── API pública ─────────────────────────────────────────
  return {
    show() {
      el.style.transform = 'translateX(-50%) translateY(0)';
      this.update();
    },
    hide() {
      closePopover();
      el.style.transform = 'translateX(-50%) translateY(140%)';
    },
    update() {
      const n = (getSelectedIds() || []).length;
      const countEl = document.getElementById(`${BAR_ID}-count`);
      if (countEl) countEl.textContent = `${n} selecionada${n !== 1 ? 's' : ''}`;
      if (n === 0) this.hide();
      else this.show();
    },
    destroy() {
      closePopover();
      el.remove();
    },
  };
}
