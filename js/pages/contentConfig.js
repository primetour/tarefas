/**
 * PRIMETOUR — Content Config
 *
 * Gestão das taxonomias usadas no Calendário de Conteúdo:
 *   - Plataformas (Instagram, Newsletter, ...)
 *   - Tipos de Conteúdo (Post, Reel, ...)
 *
 * Acesso: admin (system_manage_settings). Delete só master.
 */

import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';
import {
  fetchPlatforms, fetchContents,
  createPlatform, createContent,
  updatePlatform, updateContent,
  deletePlatform, deleteContent,
} from '../services/contentMeta.js';
import { renderEmojiPicker, bindEmojiPicker } from '../components/emojiPicker.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let activeTab = 'platforms';
let allPlatforms = [];
let allContents  = [];

export async function renderContentConfig(container) {
  if (!store.can('system_manage_settings') && !store.isMaster()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
      <p class="text-sm text-muted">Apenas Diretoria e Head têm acesso.</p>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Calendário de Conteúdo — Configuração</h1>
        <p class="page-subtitle">Plataformas e tipos de conteúdo usados nos slots</p>
      </div>
    </div>

    <div style="display:flex;border-bottom:1px solid var(--border-subtle);margin-bottom:20px;">
      <button class="cc-cfg-tab" data-tab="platforms" style="${tabStyle('platforms')}">
        📡 Plataformas
      </button>
      <button class="cc-cfg-tab" data-tab="contents" style="${tabStyle('contents')}">
        🧩 Tipos de Conteúdo
      </button>
    </div>

    <div id="cc-cfg-body"><div class="loading-spinner" style="margin:40px auto;"></div></div>
  `;

  container.querySelectorAll('.cc-cfg-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      renderContentConfig(container);
    });
  });

  await loadData();
  renderTab();
}

function tabStyle(id) {
  const on = activeTab === id;
  return `padding:10px 18px;background:none;border:none;cursor:pointer;
    border-bottom:3px solid ${on ? 'var(--brand-gold)' : 'transparent'};
    color:${on ? 'var(--brand-gold)' : 'var(--text-secondary)'};
    font-size:0.875rem;font-weight:${on ? '600' : '500'};
    margin-bottom:-1px;`;
}

async function loadData() {
  try {
    [allPlatforms, allContents] = await Promise.all([
      fetchPlatforms().catch(() => []),
      fetchContents().catch(() => []),
    ]);
  } catch(e) { console.warn('[content-config] load:', e.message); }
}

function renderTab() {
  const wrap = document.getElementById('cc-cfg-body');
  if (!wrap) return;
  const items = activeTab === 'platforms' ? allPlatforms : allContents;
  const label = activeTab === 'platforms' ? 'plataforma' : 'tipo de conteúdo';
  wrap.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
      <span style="color:var(--text-muted);font-size:0.875rem;">
        ${items.length} ${label}${items.length===1?'':'s'} cadastrado${items.length===1?'':'s'}
      </span>
      <button id="cc-cfg-new" class="btn btn-primary btn-sm">+ Nova ${label}</button>
    </div>
    ${items.length === 0 ? `
      <div class="empty-state" style="padding:40px;">
        <div class="empty-state-icon">🗂</div>
        <div class="empty-state-title">Nenhuma ${label} cadastrada</div>
        <p class="text-sm text-muted">Clique em "+ Nova" pra começar.</p>
      </div>
    ` : `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;">
        ${items.map(it => `
          <div class="card" data-id="${esc(it.id)}" style="padding:14px;display:flex;align-items:center;gap:12px;">
            <span style="width:42px;height:42px;border-radius:10px;
              background:${it.color}22;color:${it.color};
              display:flex;align-items:center;justify-content:center;font-size:1.5rem;flex-shrink:0;">
              ${esc(it.icon || '📋')}
            </span>
            <div style="flex:1;min-width:0;">
              <div style="font-size:0.9375rem;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                ${esc(it.label)}
              </div>
              <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;font-family:ui-monospace,Menlo,monospace;">
                ${esc(it.id)} ${it.active === false ? '· INATIVO' : ''}
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;">
              <button class="btn btn-ghost btn-sm cc-cfg-edit" data-id="${esc(it.id)}" title="Editar"
                style="font-size:0.75rem;">✎</button>
              ${store.isMaster() ? `
                <button class="btn btn-ghost btn-sm cc-cfg-del" data-id="${esc(it.id)}" title="Excluir (master)"
                  style="font-size:0.75rem;color:var(--color-danger);">🗑</button>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;

  document.getElementById('cc-cfg-new')?.addEventListener('click', () => openEditModal(null));
  wrap.querySelectorAll('.cc-cfg-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const it = items.find(x => x.id === btn.dataset.id);
      if (it) openEditModal(it);
    });
  });
  wrap.querySelectorAll('.cc-cfg-del').forEach(btn => {
    btn.addEventListener('click', () => handleDelete(btn.dataset.id));
  });
}

function openEditModal(existing) {
  const isEdit = !!existing;
  const isContents = activeTab === 'contents';
  const what = isContents ? 'tipo de conteúdo' : 'plataforma';
  modal.open({
    title: isEdit ? `Editar ${what}` : `Nova ${what}`,
    size: 'sm',
    content: `
      <div class="form-group">
        <label class="form-label">Nome *</label>
        <input type="text" class="form-input" id="cfg-label" maxlength="60"
          value="${esc(existing?.label || '')}" placeholder="Ex: ${isContents ? 'Carrossel' : 'Instagram'}" />
      </div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:12px;align-items:start;">
        <div class="form-group" style="min-width:90px;">
          <label class="form-label">Ícone</label>
          <input type="text" class="form-input" id="cfg-icon" maxlength="4"
            value="${esc(existing?.icon || '📋')}" style="text-align:center;font-size:1.5rem;height:48px;" readonly />
        </div>
        <div class="form-group">
          <label class="form-label">Cor</label>
          <input type="color" class="form-input" id="cfg-color"
            value="${esc(existing?.color || '#94A3B8')}" style="height:48px;padding:2px;width:100%;" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" style="font-size:0.75rem;color:var(--text-muted);">
          Escolher emoji (clique pra selecionar)
        </label>
        ${renderEmojiPicker('cfg-icon')}
      </div>
      <div class="form-group">
        <label class="form-label">Ordem (asc)</label>
        <input type="number" class="form-input" id="cfg-order"
          value="${existing?.order ?? 99}" min="0" max="999" />
      </div>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.875rem;">
        <input type="checkbox" id="cfg-active" ${existing?.active !== false ? 'checked' : ''}
          style="accent-color:var(--brand-gold);" />
        <span>Ativo (aparece nos dropdowns do calendário)</span>
      </label>
    `,
    footer: [
      { label: 'Cancelar', class: 'btn-secondary', closeOnClick: true },
      {
        label: isEdit ? 'Salvar' : 'Criar',
        class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          const data = {
            label: document.getElementById('cfg-label')?.value?.trim() || '',
            icon:  document.getElementById('cfg-icon')?.value?.trim() || '📋',
            color: document.getElementById('cfg-color')?.value || '#94A3B8',
            order: +document.getElementById('cfg-order')?.value || 99,
            active: document.getElementById('cfg-active')?.checked,
          };
          if (!data.label) { toast.error('Nome é obrigatório.'); return; }
          try {
            if (isContents) {
              if (isEdit) await updateContent(existing.id, data);
              else        await createContent(data);
            } else {
              if (isEdit) await updatePlatform(existing.id, data);
              else        await createPlatform(data);
            }
            toast.success(isEdit ? 'Atualizado.' : 'Criado.');
            close();
            store.invalidateCache('content_platforms');
            store.invalidateCache('content_contents');
            await loadData();
            renderTab();
          } catch(e) { toast.error(e.message); }
        },
      },
    ],
  });
  // 4.35.15+ Bind do emoji picker
  setTimeout(() => bindEmojiPicker('cfg-icon'), 50);
}

async function handleDelete(id) {
  const isContents = activeTab === 'contents';
  const what = isContents ? 'tipo de conteúdo' : 'plataforma';
  const items = isContents ? allContents : allPlatforms;
  const it = items.find(x => x.id === id);
  if (!it) return;
  const ok = await modal.confirm({
    title: `Excluir ${what}?`,
    message: `Excluir "<strong>${esc(it.label)}</strong>" permanentemente? Slots existentes que usam este valor não serão tocados, mas o item some dos dropdowns.`,
    confirmText: 'Excluir', danger: true,
  });
  if (!ok) return;
  try {
    if (isContents) await deleteContent(id);
    else            await deletePlatform(id);
    toast.success('Excluído.');
    await loadData();
    renderTab();
  } catch(e) { toast.error(e.message); }
}
