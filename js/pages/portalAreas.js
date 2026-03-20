/**
 * PRIMETOUR — Portal de Dicas: Áreas
 * Cadastro de áreas com logo e templates vinculados
 */
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { fetchAreas, saveArea, deleteArea } from '../services/portal.js';

const esc = s => String(s||'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function renderPortalAreas(container) {
  if (!store.canManagePortal()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Áreas do Portal</h1>
        <p class="page-subtitle">Configure as áreas, logos e templates vinculados ao Portal de Dicas</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary btn-sm" id="area-new-btn">+ Nova Área</button>
      </div>
    </div>
    <div id="areas-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">
      <div class="skeleton" style="height:140px;border-radius:var(--radius-md);"></div>
      <div class="skeleton" style="height:140px;border-radius:var(--radius-md);"></div>
      <div class="skeleton" style="height:140px;border-radius:var(--radius-md);"></div>
    </div>
    <div id="area-modal" style="display:none;"></div>
  `;

  await loadAreas();

  document.getElementById('area-new-btn')?.addEventListener('click', () => showAreaModal(null));
}

async function loadAreas() {
  const grid  = document.getElementById('areas-grid');
  if (!grid) return;
  const areas = await fetchAreas();

  if (!areas.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:48px;text-align:center;color:var(--text-muted);">
      Nenhuma área cadastrada. Crie a primeira área clicando em "Nova Área".
    </div>`;
    return;
  }

  grid.innerHTML = areas.map(a => `
    <div class="card" style="padding:20px;position:relative;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        ${a.logoUrl
          ? `<img src="${esc(a.logoUrl)}" style="height:36px;object-fit:contain;" alt="${esc(a.name)}">`
          : `<div style="width:36px;height:36px;border-radius:var(--radius-md);background:var(--brand-gold)22;
              display:flex;align-items:center;justify-content:center;font-size:1rem;">◈</div>`}
        <div>
          <div style="font-weight:700;font-size:0.9375rem;">${esc(a.name)}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">
            ${(a.templates||[]).length} template${(a.templates||[]).length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>
      ${a.description ? `<p style="font-size:0.8125rem;color:var(--text-secondary);margin:0 0 12px;">${esc(a.description)}</p>` : ''}
      <div style="display:flex;gap:8px;">
        <button class="btn btn-ghost btn-sm" data-edit="${a.id}" style="flex:1;">Editar</button>
        <button class="btn btn-ghost btn-sm" data-delete="${a.id}"
          style="color:#EF4444;">Excluir</button>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('[data-edit]').forEach(btn =>
    btn.addEventListener('click', () => showAreaModal(areas.find(a => a.id === btn.dataset.edit))));
  grid.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => handleDeleteArea(btn.dataset.delete, areas.find(a => a.id === btn.dataset.delete)?.name)));
}

function showAreaModal(area) {
  const modal = document.getElementById('area-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  modal.style.cssText = `display:flex;position:fixed;inset:0;background:rgba(0,0,0,.6);
    z-index:1000;align-items:center;justify-content:center;padding:20px;`;

  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:520px;padding:28px;max-height:90vh;overflow-y:auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h3 style="margin:0;font-size:1rem;">${area ? 'Editar Área' : 'Nova Área'}</h3>
        <button id="area-modal-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>

      <div style="display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">
            Nome da Área *
          </label>
          <input type="text" id="area-name" class="filter-select" style="width:100%;"
            placeholder="Ex: BTG Partners" value="${esc(area?.name || '')}">
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">
            Logo (URL Cloudflare)
          </label>
          <input type="url" id="area-logo" class="filter-select" style="width:100%;"
            placeholder="https://pub-xxx.r2.dev/logos/nome.webp"
            value="${esc(area?.logoUrl || '')}">
          <div id="area-logo-preview" style="margin-top:8px;"></div>
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">
            Paleta de cores
          </label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:4px;">Cor primária</label>
              <input type="color" id="area-color-primary" value="${area?.colors?.primary || '#D4A843'}"
                style="width:100%;height:36px;border-radius:var(--radius-sm);cursor:pointer;">
            </div>
            <div>
              <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:4px;">Cor secundária</label>
              <input type="color" id="area-color-secondary" value="${area?.colors?.secondary || '#1A1A2E'}"
                style="width:100%;height:36px;border-radius:var(--radius-sm);cursor:pointer;">
            </div>
          </div>
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">
            Descrição (opcional)
          </label>
          <textarea id="area-desc" class="filter-select" style="width:100%;height:72px;resize:vertical;"
            placeholder="Breve descrição da área...">${esc(area?.description || '')}</textarea>
        </div>
      </div>

      <div style="display:flex;gap:8px;margin-top:20px;">
        <button class="btn btn-secondary" id="area-modal-cancel" style="flex:1;">Cancelar</button>
        <button class="btn btn-primary" id="area-modal-save" style="flex:2;">
          ${area ? 'Salvar Alterações' : 'Criar Área'}
        </button>
      </div>
    </div>
  `;

  // Logo preview
  document.getElementById('area-logo')?.addEventListener('input', e => {
    const preview = document.getElementById('area-logo-preview');
    if (preview && e.target.value) {
      preview.innerHTML = `<img src="${esc(e.target.value)}" style="max-height:40px;object-fit:contain;"
        onerror="this.style.display='none'">`;
    }
  });

  const close = () => { modal.style.display = 'none'; modal.innerHTML = ''; };
  document.getElementById('area-modal-close')?.addEventListener('click', close);
  document.getElementById('area-modal-cancel')?.addEventListener('click', close);

  document.getElementById('area-modal-save')?.addEventListener('click', async () => {
    const name = document.getElementById('area-name')?.value?.trim();
    if (!name) { toast.error('Nome obrigatório.'); return; }
    const btn = document.getElementById('area-modal-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
    try {
      await saveArea(area?.id || null, {
        name,
        logoUrl:     document.getElementById('area-logo')?.value?.trim() || null,
        description: document.getElementById('area-desc')?.value?.trim() || '',
        colors: {
          primary:   document.getElementById('area-color-primary')?.value,
          secondary: document.getElementById('area-color-secondary')?.value,
        },
      });
      toast.success(`Área "${name}" ${area ? 'atualizada' : 'criada'}.`);
      close();
      await loadAreas();
    } catch(e) {
      toast.error('Erro: ' + e.message);
      if (btn) { btn.disabled = false; btn.textContent = area ? 'Salvar Alterações' : 'Criar Área'; }
    }
  });
}

async function handleDeleteArea(id, name) {
  if (!confirm(`Excluir a área "${name}"? Esta ação não pode ser desfeita.`)) return;
  try {
    await deleteArea(id);
    toast.success('Área excluída.');
    await loadAreas();
  } catch(e) { toast.error('Erro: ' + e.message); }
}
