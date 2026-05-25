/**
 * PRIMETOUR — Task Popovers (compartilhados entre bulk-edit e inline-edit)
 *
 * Popovers reutilizáveis para alterar campos de tarefa(s):
 *   - openDueDatePopover  · prazo (date input + remover)
 *   - openStatusPopover   · status (5 opções)
 *   - openAreaPopover     · área (REQUESTING_AREAS)
 *   - openAssigneesPopover · responsável (user search)
 *   - openPriorityPopover · prioridade (4 opções)  [futuro uso]
 *   - openProjectPopover  · projeto (search)       [futuro uso]
 *   - openNucleoPopover   · núcleo (12 opções)     [futuro uso]
 *
 * Cada função recebe (anchor, { onPick }) e abre popover ancorado.
 * onPick(patch) é chamado quando user escolhe — quem chama decide
 * se aplica via bulkUpdateTasks ou updateTask single.
 */

import { store } from '../store.js';
import { getValidTransitions } from '../services/workflowEngine.js';   // v4.57.23: filtro de transições
import { userAvatarInner } from './userAvatar.js';
import {
  STATUSES, PRIORITIES, NUCLEOS, REQUESTING_AREAS,
  TASK_TYPES, NEWSLETTER_STATUSES,
} from '../services/tasks.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ─── Estilos compartilhados (idempotente) ──────────────── */
function ensurePopoverStyles() {
  if (document.getElementById('task-popovers-styles')) return;
  const styleEl = document.createElement('style');
  styleEl.id = 'task-popovers-styles';
  styleEl.textContent = `
    .tp-popover {
      position: fixed; z-index: 9001;
      background: var(--bg-card, #111B27);
      border: 1px solid var(--border-subtle, #1E2D3D);
      border-radius: 10px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.5);
      padding: 8px;
      min-width: 220px; max-width: 320px;
      font-family: var(--font-ui);
      animation: tpFadeIn 0.12s ease-out;
    }
    @keyframes tpFadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .tp-pop-header {
      font-size: 0.6875rem; color: var(--text-muted);
      text-transform: uppercase; letter-spacing: 0.05em;
      font-weight: 600; padding: 6px 10px 8px;
      border-bottom: 1px solid var(--border-subtle);
      margin-bottom: 6px;
    }
    .tp-pop-item {
      display: flex; align-items: center; gap: 8px;
      padding: 8px 10px; border-radius: 6px;
      cursor: pointer; font-size: 0.8125rem;
      color: var(--text-primary);
      transition: background 0.1s;
    }
    .tp-pop-item:hover { background: var(--bg-elevated); }
    .tp-pop-input {
      width: 100%; padding: 6px 10px; font-size: 0.8125rem;
      border: 1px solid var(--border-subtle);
      border-radius: 6px; background: var(--bg-surface);
      color: var(--text-primary); outline: none;
      font-family: inherit; box-sizing: border-box;
    }
    .tp-pop-input:focus { border-color: var(--brand-gold); }
    .tp-pop-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border: 1px solid var(--border-subtle);
      border-radius: 6px; background: var(--bg-elevated);
      color: var(--text-primary); font-size: 0.8125rem; font-weight: 500;
      cursor: pointer; font-family: inherit;
    }
    .tp-pop-btn:hover { background: var(--brand-gold); color: #000; }
  `;
  document.head.appendChild(styleEl);
}

/* ─── Estado interno: 1 popover por vez ─────────────────── */
let _currentPop = null;

export function closeTaskPopover() {
  if (_currentPop) { _currentPop.remove(); _currentPop = null; }
  document.removeEventListener('click', _outsideHandler, true);
  document.removeEventListener('keydown', _escHandler);
}
function _outsideHandler(e) {
  if (!_currentPop) return;
  if (_currentPop.contains(e.target)) return;
  closeTaskPopover();
}
function _escHandler(e) { if (e.key === 'Escape') closeTaskPopover(); }

/* ─── Mount popover genérico ────────────────────────────── */
function mountPopover(anchor, html) {
  ensurePopoverStyles();
  closeTaskPopover();
  const pop = document.createElement('div');
  pop.className = 'tp-popover';
  pop.innerHTML = html;
  document.body.appendChild(pop);
  _currentPop = pop;

  // Posiciona: tenta abaixo do anchor; se não couber, acima
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left = r.left;
  if (left + pr.width > window.innerWidth - 8) left = window.innerWidth - pr.width - 8;
  if (left < 8) left = 8;
  let top = r.bottom + 6;
  if (top + pr.height > window.innerHeight - 8) top = r.top - pr.height - 6;
  if (top < 8) top = 8;
  pop.style.left = `${left}px`;
  pop.style.top  = `${top}px`;

  setTimeout(() => {
    document.addEventListener('click', _outsideHandler, true);
    document.addEventListener('keydown', _escHandler);
  }, 0);
  return pop;
}

/* ════════════════════════════════════════════════════════════
   POPOVERS POR CAMPO
   ════════════════════════════════════════════════════════════ */

export function openDueDatePopover(anchor, { onPick, currentValue = null } = {}) {
  // currentValue: Date | string | Timestamp | null (pra pré-popular)
  let preIso = '';
  if (currentValue) {
    try {
      const d = currentValue?.toDate?.() ||
                (currentValue instanceof Date ? currentValue : new Date(currentValue));
      if (!isNaN(d?.getTime())) preIso = d.toISOString().slice(0, 10);
    } catch {}
  }
  const pop = mountPopover(anchor, `
    <div class="tp-pop-header">Definir prazo</div>
    <div style="padding:0 10px 10px;">
      <input type="date" id="tp-due-input" class="tp-pop-input" value="${preIso}">
    </div>
    <div style="display:flex;gap:6px;padding:0 10px 10px;">
      <button class="tp-pop-btn" id="tp-due-apply" style="flex:1;">Aplicar</button>
      <button class="tp-pop-btn" id="tp-due-clear" style="background:transparent;">Remover</button>
    </div>
  `);
  pop.querySelector('#tp-due-input')?.focus();
  pop.querySelector('#tp-due-apply').addEventListener('click', () => {
    const v = pop.querySelector('#tp-due-input').value;
    if (!v) return;
    closeTaskPopover();
    onPick?.({ dueDate: new Date(v + 'T12:00:00') }, `prazo: ${v}`);
  });
  pop.querySelector('#tp-due-clear').addEventListener('click', () => {
    closeTaskPopover();
    onPick?.({ dueDate: null }, 'prazo removido');
  });
}

export function openStatusPopover(anchor, { onPick, currentValue = null } = {}) {
  // 4.49.10+ SECURITY: filtra opção 'done' se user não tem task_complete.
  // v4.57.23 fix #4: filtra TAMBÉM por workflowEngine.getValidTransitions —
  // antes oferecia TODAS as 6 opções sem checar transições válidas. User
  // pulava de 'not_started' direto pra 'validation' ou 'rework' (ilegal
  // segundo DEFAULT_TRANSITIONS). Backend NÃO bloqueia (workflowEngine só
  // decora, não enforça). Resultado: estado inconsistente passava.
  const canComplete = store.isMaster?.() || store.can?.('task_complete') || false;
  // getValidTransitions já considera master/admin (retorna todos status)
  const validSet = new Set(getValidTransitions(currentValue));
  const allowedStatuses = STATUSES.filter(s => {
    // Sempre mostra o status ATUAL (marcado como ✓)
    if (s.value === currentValue) return true;
    // Filtra por permissão (done exige task_complete)
    if (s.value === 'done' && !canComplete) return false;
    // Filtra por transição válida do workflowEngine
    if (!validSet.has(s.value)) return false;
    return true;
  });

  const pop = mountPopover(anchor, `
    <div class="tp-pop-header">Alterar status</div>
    ${allowedStatuses.map(s => `
      <div class="tp-pop-item" data-val="${esc(s.value)}"
        ${currentValue === s.value ? 'style="background:var(--bg-elevated);"' : ''}>
        <span style="width:10px;height:10px;border-radius:50%;background:${s.color};"></span>
        <span>${esc(s.label)}</span>
        ${currentValue === s.value ? `<span style="margin-left:auto;color:var(--brand-gold);">✓</span>` : ''}
      </div>
    `).join('')}
    ${!canComplete ? `<div style="padding:6px 12px;font-size:0.6875rem;color:var(--text-muted);
      border-top:1px solid var(--border-subtle);">
      🔒 Apenas coordenadores+ marcam como concluída
    </div>` : ''}
  `);
  pop.querySelectorAll('.tp-pop-item').forEach(item => {
    item.addEventListener('click', () => {
      const v = item.dataset.val;
      const label = STATUSES.find(s => s.value === v)?.label || v;
      const patch = { status: v };
      if (v === 'done') patch.completedAt = new Date();
      closeTaskPopover();
      onPick?.(patch, `status: ${label}`);
    });
  });
}

export function openAreaPopover(anchor, { onPick, currentValue = null } = {}) {
  const pop = mountPopover(anchor, `
    <div class="tp-pop-header">Alterar setor solicitante</div>
    <div style="padding:0 10px 8px;">
      <input type="text" class="tp-pop-input" id="tp-area-search" placeholder="Buscar setor…" autofocus>
    </div>
    <div id="tp-area-list" style="max-height:280px;overflow-y:auto;padding:0 4px;">
      ${REQUESTING_AREAS.map(a => `
        <div class="tp-pop-item" data-val="${esc(a)}" data-name="${esc(a.toLowerCase())}"
          ${currentValue === a ? 'style="background:var(--bg-elevated);"' : ''}>
          <span style="color:var(--brand-gold);">▸</span>
          <span>${esc(a)}</span>
          ${currentValue === a ? `<span style="margin-left:auto;color:var(--brand-gold);">✓</span>` : ''}
        </div>
      `).join('')}
    </div>
    <div style="padding:8px 10px;border-top:1px solid var(--border-subtle);margin-top:4px;">
      <button class="tp-pop-btn" id="tp-area-clear" style="width:100%;background:transparent;">
        Remover área
      </button>
    </div>
  `);
  const search = pop.querySelector('#tp-area-search');
  const list = pop.querySelector('#tp-area-list');
  search?.focus();
  search?.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    list.querySelectorAll('.tp-pop-item').forEach(item => {
      item.style.display = item.dataset.name.includes(q) ? '' : 'none';
    });
  });
  list.querySelectorAll('.tp-pop-item').forEach(item => {
    item.addEventListener('click', () => {
      const v = item.dataset.val;
      closeTaskPopover();
      onPick?.({ requestingArea: v }, `área: ${v}`);
    });
  });
  pop.querySelector('#tp-area-clear').addEventListener('click', () => {
    closeTaskPopover();
    onPick?.({ requestingArea: '' }, 'sem área');
  });
}

export function openAssigneesPopover(anchor, {
  onPick, currentValue = [], allUsers = null, multi = true,
} = {}) {
  const users = allUsers || (store.get('users') || []).filter(u => u.active !== false);
  const selected = new Set(Array.isArray(currentValue) ? currentValue : []);

  const pop = mountPopover(anchor, `
    <div class="tp-pop-header">${multi ? 'Definir responsáveis (substitui)' : 'Escolher responsável'}</div>
    <div style="padding:0 10px 8px;">
      <input type="text" class="tp-pop-input" id="tp-asn-search" placeholder="Buscar usuário…" autofocus>
    </div>
    <div id="tp-asn-list" style="max-height:240px;overflow-y:auto;padding:0 4px;">
      ${users.map(u => {
        const isSel = selected.has(u.id);
        return `<div class="tp-pop-item" data-val="${esc(u.id)}" data-name="${esc((u.name||'').toLowerCase())}"
          ${isSel ? 'style="background:var(--bg-elevated);"' : ''}>
          <div class="avatar avatar-sm" style="background:${u.avatarColor||'#3B82F6'};
            width:24px;height:24px;font-size:0.625rem;font-weight:600;color:#fff;">
            ${userAvatarInner(u)}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.8125rem;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(u.name || '—')}</div>
            <div style="font-size:0.6875rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(u.email || '')}</div>
          </div>
          ${isSel ? `<span style="color:var(--brand-gold);">✓</span>` : ''}
        </div>`;
      }).join('')}
    </div>
    ${multi ? `
    <div style="padding:8px 10px;border-top:1px solid var(--border-subtle);margin-top:4px;display:flex;gap:6px;">
      <button class="tp-pop-btn" id="tp-asn-apply" style="flex:1;">Aplicar (${selected.size})</button>
      <button class="tp-pop-btn" id="tp-asn-clear" style="background:transparent;">Limpar</button>
    </div>` : ''}
  `);
  const search = pop.querySelector('#tp-asn-search');
  const list   = pop.querySelector('#tp-asn-list');
  search?.focus();
  search?.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    list.querySelectorAll('.tp-pop-item').forEach(item => {
      item.style.display = item.dataset.name.includes(q) ? '' : 'none';
    });
  });
  list.querySelectorAll('.tp-pop-item').forEach(item => {
    item.addEventListener('click', () => {
      const v = item.dataset.val;
      if (multi) {
        // toggle selection no UI
        if (selected.has(v)) {
          selected.delete(v);
          item.style.background = '';
          item.querySelector('span:last-child[style*="brand-gold"]')?.remove();
        } else {
          selected.add(v);
          item.style.background = 'var(--bg-elevated)';
          if (!item.querySelector('span[style*="brand-gold"]')) {
            const c = document.createElement('span');
            c.style.color = 'var(--brand-gold)';
            c.textContent = '✓';
            item.appendChild(c);
          }
        }
        const applyBtn = pop.querySelector('#tp-asn-apply');
        if (applyBtn) applyBtn.textContent = `Aplicar (${selected.size})`;
      } else {
        const u = users.find(x => x.id === v);
        closeTaskPopover();
        onPick?.({ assignees: [v] }, `responsável: ${u?.name||v}`);
      }
    });
  });
  if (multi) {
    pop.querySelector('#tp-asn-apply').addEventListener('click', () => {
      const arr = [...selected];
      const names = arr.map(id => users.find(u=>u.id===id)?.name).filter(Boolean);
      closeTaskPopover();
      onPick?.({ assignees: arr },
        arr.length ? `responsável: ${names.slice(0,2).join(', ')}${names.length>2?` +${names.length-2}`:''}` : 'sem responsável');
    });
    pop.querySelector('#tp-asn-clear').addEventListener('click', () => {
      closeTaskPopover();
      onPick?.({ assignees: [] }, 'sem responsável');
    });
  }
}

export function openPriorityPopover(anchor, { onPick, currentValue = null } = {}) {
  const pop = mountPopover(anchor, `
    <div class="tp-pop-header">Alterar prioridade</div>
    ${PRIORITIES.map(p => `
      <div class="tp-pop-item" data-val="${esc(p.value)}"
        ${currentValue === p.value ? 'style="background:var(--bg-elevated);"' : ''}>
        <span style="width:10px;height:10px;border-radius:50%;background:${p.color};"></span>
        <span>${esc(p.label)}</span>
        ${currentValue === p.value ? `<span style="margin-left:auto;color:var(--brand-gold);">✓</span>` : ''}
      </div>
    `).join('')}
  `);
  pop.querySelectorAll('.tp-pop-item').forEach(item => {
    item.addEventListener('click', () => {
      const v = item.dataset.val;
      const label = PRIORITIES.find(p => p.value === v)?.label || v;
      closeTaskPopover();
      onPick?.({ priority: v }, `prioridade: ${label}`);
    });
  });
}

export function openProjectPopover(anchor, { onPick, currentValue = null, allProjects = [] } = {}) {
  const pop = mountPopover(anchor, `
    <div class="tp-pop-header">Mover para projeto</div>
    <div style="padding:0 10px 8px;">
      <input type="text" class="tp-pop-input" id="tp-prj-search" placeholder="Buscar projeto…" autofocus>
    </div>
    <div id="tp-prj-list" style="max-height:280px;overflow-y:auto;padding:0 4px;">
      ${(allProjects||[]).filter(p => !p.archived).map(p => `
        <div class="tp-pop-item" data-val="${esc(p.id)}" data-name="${esc((p.name||'').toLowerCase())}"
          ${currentValue === p.id ? 'style="background:var(--bg-elevated);"' : ''}>
          <span style="font-size:1rem;">${esc(p.icon || '📦')}</span>
          <span style="flex:1;">${esc(p.name || '—')}</span>
          ${currentValue === p.id ? `<span style="color:var(--brand-gold);">✓</span>` : ''}
        </div>
      `).join('')}
    </div>
    <div style="padding:8px 10px;border-top:1px solid var(--border-subtle);margin-top:4px;">
      <button class="tp-pop-btn" id="tp-prj-clear" style="width:100%;background:transparent;">
        Tirar do projeto
      </button>
    </div>
  `);
  const search = pop.querySelector('#tp-prj-search');
  const list = pop.querySelector('#tp-prj-list');
  search?.focus();
  search?.addEventListener('input', () => {
    const q = search.value.toLowerCase();
    list.querySelectorAll('.tp-pop-item').forEach(item => {
      item.style.display = item.dataset.name.includes(q) ? '' : 'none';
    });
  });
  list.querySelectorAll('.tp-pop-item').forEach(item => {
    item.addEventListener('click', () => {
      const v = item.dataset.val;
      const p = allProjects.find(x => x.id === v);
      closeTaskPopover();
      onPick?.({ projectId: v }, `projeto: ${p?.name||v}`);
    });
  });
  pop.querySelector('#tp-prj-clear').addEventListener('click', () => {
    closeTaskPopover();
    onPick?.({ projectId: null }, 'sem projeto');
  });
}

export function openNucleoPopover(anchor, { onPick, currentValue = [] } = {}) {
  const cur = Array.isArray(currentValue) ? currentValue : [];
  const pop = mountPopover(anchor, `
    <div class="tp-pop-header">Alterar squad (substitui)</div>
    ${NUCLEOS.map(n => `
      <div class="tp-pop-item" data-val="${esc(n.value)}"
        ${cur.includes(n.value) ? 'style="background:var(--bg-elevated);"' : ''}>
        <span style="color:var(--brand-gold);">◈</span>
        <span>${esc(n.label)}</span>
        ${cur.includes(n.value) ? `<span style="margin-left:auto;color:var(--brand-gold);">✓</span>` : ''}
      </div>
    `).join('')}
    <div style="padding:8px 10px;border-top:1px solid var(--border-subtle);margin-top:4px;">
      <button class="tp-pop-btn" id="tp-nuc-clear" style="width:100%;background:transparent;">
        Remover squad
      </button>
    </div>
  `);
  pop.querySelectorAll('.tp-pop-item').forEach(item => {
    item.addEventListener('click', () => {
      const v = item.dataset.val;
      const label = NUCLEOS.find(n => n.value === v)?.label || v;
      closeTaskPopover();
      onPick?.({ nucleos: [v] }, `squad: ${label}`);
    });
  });
  pop.querySelector('#tp-nuc-clear').addEventListener('click', () => {
    closeTaskPopover();
    onPick?.({ nucleos: [] }, 'sem squad');
  });
}

/* ─── Tipo + Etapa (combinado) ─────────────────────────────
 * Popover dual: seção TIPO (mostra todos os tipos disponíveis) +
 * seção ETAPA (steps do tipo atual da tarefa).
 *
 * Como funciona:
 * - Click num tipo → muda type/typeId. Se for Newsletter, limpa
 *   newsletterStatus pra forçar o user a re-escolher etapa.
 * - Click numa etapa → muda newsletterStatus (newsletter) ou
 *   customFields.currentStep (custom type).
 *
 * task: { type, typeId, newsletterStatus, customFields }
 * allTaskTypes: array de custom types do Firestore (com .steps[])
 */
export function openTypeStepPopover(anchor, { onPick, task, allTaskTypes = [] } = {}) {
  const t = task || {};

  // Identifica o tipo CORRENTE da task
  // - Se tem typeId, é custom type (id no Firestore)
  // - Senão, usa task.type (vazio = Padrão, 'newsletter' = Newsletter built-in)
  const currentTypeKey = t.typeId
    ? `custom:${t.typeId}`
    : (t.type ? `builtin:${t.type}` : 'builtin:');

  // Catálogo unificado de tipos: built-in + custom
  // [{ key, label, kind: 'builtin'|'custom', value, id, steps[]? }]
  const builtinList = TASK_TYPES.map(tt => ({
    key:   `builtin:${tt.value}`,
    label: tt.label,
    kind:  'builtin',
    value: tt.value,                 // '' (Padrão) ou 'newsletter'
    steps: tt.value === 'newsletter' ? NEWSLETTER_STATUSES : [],
  }));
  const customList = (allTaskTypes || []).map(ct => ({
    key:   `custom:${ct.id}`,
    label: `${ct.icon || '◈'} ${ct.name}`,
    kind:  'custom',
    id:    ct.id,
    steps: (ct.steps || []).map(s => ({ value: s.id, label: s.label || s.name })),
  }));
  const allTypes = [...builtinList, ...customList];
  const currentType = allTypes.find(tt => tt.key === currentTypeKey) || allTypes[0];
  // Etapa corrente
  const currentStepValue = t.type === 'newsletter'
    ? t.newsletterStatus
    : (t.customFields?.currentStep || '');

  const pop = mountPopover(anchor, `
    <div class="tp-pop-header">Tipo e etapa</div>

    <!-- Seção TIPO -->
    <div style="padding:0 6px 4px;">
      <div style="font-size:0.625rem;color:var(--text-muted);font-weight:600;
        text-transform:uppercase;letter-spacing:0.04em;padding:4px 6px 2px;">Tipo</div>
      <div id="tp-type-list" style="max-height:160px;overflow-y:auto;">
        ${allTypes.map(tt => `
          <div class="tp-pop-item" data-type-key="${esc(tt.key)}"
            ${tt.key === currentTypeKey ? 'style="background:var(--bg-elevated);"' : ''}>
            <span style="font-size:0.875rem;">${esc(tt.label)}</span>
            ${tt.key === currentTypeKey ? `<span style="margin-left:auto;color:var(--brand-gold);">✓</span>` : ''}
          </div>
        `).join('')}
      </div>
    </div>

    ${currentType.steps?.length ? `
    <!-- Seção ETAPA (depende do tipo atual) -->
    <div style="padding:6px 6px 4px;border-top:1px solid var(--border-subtle);margin-top:6px;">
      <div style="font-size:0.625rem;color:var(--text-muted);font-weight:600;
        text-transform:uppercase;letter-spacing:0.04em;padding:4px 6px 2px;">Etapa de ${esc(currentType.label)}</div>
      <div id="tp-step-list" style="max-height:200px;overflow-y:auto;">
        ${currentType.steps.map(s => `
          <div class="tp-pop-item" data-step-value="${esc(s.value)}"
            ${s.value === currentStepValue ? 'style="background:var(--bg-elevated);"' : ''}>
            <span style="color:var(--brand-gold);">↳</span>
            <span>${esc(s.label)}</span>
            ${s.value === currentStepValue ? `<span style="margin-left:auto;color:var(--brand-gold);">✓</span>` : ''}
          </div>
        `).join('')}
        <div class="tp-pop-item" data-step-value=""
          style="opacity:.7;font-style:italic;">
          <span>—</span><span>Sem etapa</span>
        </div>
      </div>
    </div>
    ` : `
    <div style="padding:8px 12px;border-top:1px solid var(--border-subtle);margin-top:6px;
      font-size:0.6875rem;color:var(--text-muted);font-style:italic;">
      Este tipo não tem etapas definidas.
    </div>
    `}
  `);

  // ── Click em TIPO ──────────────────────────────────────
  pop.querySelectorAll('#tp-type-list .tp-pop-item').forEach(item => {
    item.addEventListener('click', () => {
      const key = item.dataset.typeKey;
      const tt = allTypes.find(x => x.key === key);
      if (!tt) return;
      // Patch: limpa typeId/type/newsletterStatus/currentStep e seta o novo
      const patch = {
        type:    tt.kind === 'builtin' ? tt.value : null,
        typeId:  tt.kind === 'custom'  ? tt.id    : null,
      };
      // Limpa step antigo se trocou de tipo (incompatível)
      if (currentTypeKey !== tt.key) {
        if (tt.kind === 'builtin' && tt.value === 'newsletter') {
          patch.newsletterStatus = '';
        } else if (tt.kind === 'custom') {
          patch.customFields = { ...(t.customFields || {}), currentStep: '' };
        } else {
          // Padrão: limpa ambos por segurança
          patch.newsletterStatus = '';
          if (t.customFields?.currentStep) {
            patch.customFields = { ...(t.customFields || {}), currentStep: '' };
          }
        }
      }
      closeTaskPopover();
      onPick?.(patch, `tipo: ${tt.label.replace(/^[^\s]+\s/, '')}`);
    });
  });

  // ── Click em ETAPA ─────────────────────────────────────
  pop.querySelectorAll('#tp-step-list .tp-pop-item').forEach(item => {
    item.addEventListener('click', () => {
      const v = item.dataset.stepValue;
      let patch;
      let label;
      if (currentType.kind === 'builtin' && currentType.value === 'newsletter') {
        patch = { newsletterStatus: v };
        label = NEWSLETTER_STATUSES.find(s => s.value === v)?.label || (v ? v : 'sem etapa');
      } else if (currentType.kind === 'custom') {
        patch = { customFields: { ...(t.customFields || {}), currentStep: v } };
        label = currentType.steps.find(s => s.value === v)?.label || (v ? v : 'sem etapa');
      } else {
        return;
      }
      closeTaskPopover();
      onPick?.(patch, `etapa: ${label}`);
    });
  });
}
