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
  bulkUpdateTasks, bulkDeleteTasks,
} from '../services/tasks.js';
import {
  openDueDatePopover, openStatusPopover, openAreaPopover, openAssigneesPopover,
  openPriorityPopover, openProjectPopover, openNucleoPopover, closeTaskPopover,
} from './taskPopovers.js';

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
    <button data-action="area"      class="bab-btn" title="Alterar área">▸ <span>Área</span></button>
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

  // ─── Handler genérico de batch update ───────────────────
  async function applyPatch(patch, label) {
    const ids = getSelectedIds();
    if (!ids.length) return;
    closeTaskPopover();
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

  // ─── Popovers (delegados ao taskPopovers compartilhado) ─
  const onPick = (patch, label) => applyPatch(patch, label);

  function popDueDate(btn)   { openDueDatePopover(btn,   { onPick }); }
  function popPriority(btn)  { openPriorityPopover(btn,  { onPick }); }
  function popStatus(btn)    { openStatusPopover(btn,    { onPick }); }
  function popArea(btn)      { openAreaPopover(btn,      { onPick }); }
  function popAssignees(btn) { openAssigneesPopover(btn, { onPick, allUsers, multi: true }); }
  function popProject(btn)   { openProjectPopover(btn,   { onPick, allProjects }); }
  function popNucleo(btn)    { openNucleoPopover(btn,    { onPick }); }

  async function handleDelete() {
    const ids = getSelectedIds();
    if (!ids.length) return;
    closeTaskPopover();
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
        case 'area':      popArea(btn);      break;
        case 'assignees': popAssignees(btn); break;
        case 'projectId': popProject(btn);   break;
        case 'nucleos':   popNucleo(btn);    break;
        case 'delete':    handleDelete();    break;
      }
    });
  });

  document.getElementById(`${BAR_ID}-close`).addEventListener('click', () => {
    closeTaskPopover();
    if (typeof onClear === 'function') onClear();
  });

  // ─── API pública ─────────────────────────────────────────
  // Estado interno pra evitar recursão entre show/update.
  // Bug 4.13.0: show() chamava update() que chamava show() = stack overflow.
  function _setVisible(visible, count) {
    el.style.transform = visible
      ? 'translateX(-50%) translateY(0)'
      : 'translateX(-50%) translateY(140%)';
    const countEl = document.getElementById(`${BAR_ID}-count`);
    if (countEl) countEl.textContent = `${count} selecionada${count !== 1 ? 's' : ''}`;
    if (!visible) closeTaskPopover();
  }
  return {
    show() {
      const n = (getSelectedIds() || []).length;
      _setVisible(true, n);
    },
    hide() {
      _setVisible(false, 0);
    },
    update() {
      const n = (getSelectedIds() || []).length;
      _setVisible(n > 0, n);
    },
    destroy() {
      closeTaskPopover();
      el.remove();
    },
  };
}
