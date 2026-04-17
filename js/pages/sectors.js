/**
 * PRIMETOUR — Sectors Page
 * Gestão de setores e núcleos (dinâmico)
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import { updateUserProfile } from '../auth/auth.js';
import { db } from '../firebase.js';
import {
  collection, getDocs, query, orderBy,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  fetchNucleos, createNucleo, updateNucleo, deleteNucleo,
  SECTORS, userNucleos, userInNucleo,
} from '../services/sectors.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const NUCLEO_COLORS = [
  '#D4A843','#38BDF8','#22C55E','#A78BFA',
  '#F97316','#EC4899','#06B6D4','#EF4444',
  '#6366F1','#14B8A6','#84CC16','#6B7280',
];

let allNucleos = [];

/* ─── Render ─────────────────────────────────────────────── */
export async function renderSectors(container) {
  if (!store.can('system_manage_users') && !store.isMaster()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div></div>`;
    return;
  }

  // Visible sectors
  const visibleSectors = store.isMaster()
    ? SECTORS
    : (store.get('visibleSectors') || []);

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Setores e Núcleos</h1>
        <p class="page-subtitle">Gerencie a estrutura organizacional da empresa</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary" id="new-nucleo-btn">+ Novo Núcleo</button>
      </div>
    </div>

    <div style="display:flex;align-items:flex-start;gap:12px;
      background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);
      border-radius:var(--radius-md);padding:12px 16px;margin-bottom:24px;
      font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;">
      <span>ℹ</span>
      <span>
        <strong>Setores</strong> são as áreas da empresa (ex: Marketing e Comunicação, C&amp;P, TI).
        <strong>Núcleos</strong> são subgrupos dentro de um setor (ex: Design, Jornalismo, Redes Sociais).
        Usuários cadastrados em um setor só enxergam dados daquele setor.
        Apenas a Diretoria tem visibilidade completa.
      </span>
    </div>

    <div id="sectors-grid">
      ${[0,1].map(()=>'<div class="card skeleton" style="height:180px;margin-bottom:16px;"></div>').join('')}
    </div>
  `;

  document.getElementById('new-nucleo-btn')?.addEventListener('click', () => openNucleoModal());
  await load(visibleSectors);
}

async function load(visibleSectors) {
  try {
    // A página não é visitada pelo app boot — se o usuário abrir direto aqui
    // (aba privativa, link direto, primeira navegação) o store de users vem
    // vazio e a contagem de membros + modal de membros ficam quebrados.
    // Força o load em paralelo com os núcleos.
    const needUsers = !(store.get('users') || []).length;
    const [nuc] = await Promise.all([
      fetchNucleos(),
      needUsers ? reloadUsers() : Promise.resolve(),
    ]);
    allNucleos = nuc;
    render(visibleSectors);
  } catch(e) {
    toast.error('Erro ao carregar núcleos: ' + e.message);
  }
}

function render(visibleSectors) {
  const grid = document.getElementById('sectors-grid');
  if (!grid) return;

  if (!visibleSectors.length && !store.isMaster()) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">◈</div>
      <div class="empty-state-title">Nenhum setor atribuído ao seu perfil.</div></div>`;
    return;
  }

  const sectors = store.isMaster() ? SECTORS : visibleSectors;

  grid.innerHTML = sectors.map(sector => {
    const nucleos = allNucleos.filter(n => n.sector === sector);
    const users   = (store.get('users') || []).filter(u =>
      (u.sector || u.department) === sector && u.active !== false
    );

    return `
      <div class="card" style="margin-bottom:16px;">
        <div class="card-header">
          <div>
            <div class="card-title">${esc(sector)}</div>
            <div class="card-subtitle">${users.length} membro${users.length!==1?'s':''} · ${nucleos.length} núcleo${nucleos.length!==1?'s':''}</div>
          </div>
          <button class="btn btn-ghost btn-sm add-nucleo-btn" data-sector="${esc(sector)}">
            + Núcleo
          </button>
        </div>
        <div class="card-body" style="padding:8px 16px 16px;">
          ${!nucleos.length ? `
            <div style="font-size:0.8125rem;color:var(--text-muted);padding:8px 0;">
              Nenhum núcleo cadastrado neste setor.
            </div>
          ` : `
            <div style="display:flex;flex-wrap:wrap;gap:8px;">
              ${nucleos.map(n => {
                const members = (store.get('users') || []).filter(u =>
                  userInNucleo(u, n.name) && u.active !== false
                );
                return `
                <div style="display:flex;align-items:center;gap:8px;padding:6px 12px;
                  border-radius:var(--radius-full);background:${n.color||'#6B7280'}18;
                  border:1px solid ${n.color||'#6B7280'}44;">
                  <div style="width:8px;height:8px;border-radius:50%;background:${n.color||'#6B7280'};flex-shrink:0;"></div>
                  <span style="font-size:0.875rem;color:var(--text-primary);">${esc(n.name)}</span>
                  <span style="font-size:0.75rem;color:var(--text-muted);">· ${members.length} membro${members.length!==1?'s':''}</span>
                  <div style="display:flex;gap:2px;">
                    <button class="btn btn-ghost btn-icon" style="width:20px;height:20px;font-size:0.875rem;"
                      data-nucleo-members="${n.id}" title="Gerenciar membros">◎</button>
                    <button class="btn btn-ghost btn-icon" style="width:20px;height:20px;font-size:0.75rem;"
                      data-nucleo-edit="${n.id}" title="Editar">✎</button>
                    <button class="btn btn-ghost btn-icon" style="width:20px;height:20px;font-size:0.75rem;color:var(--color-danger);"
                      data-nucleo-del="${n.id}" title="Excluir">✕</button>
                  </div>
                </div>
              `;}).join('')}
            </div>
          `}
          ${users.length ? `
            <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border-subtle);
              display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
              <span style="font-size:0.75rem;color:var(--text-muted);">Membros:</span>
              ${users.slice(0,8).map(u => {
                const initials = u.name.split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
                return `<div class="avatar" style="width:28px;height:28px;font-size:0.625rem;
                  background:${u.avatarColor||'#3B82F6'};" title="${esc(u.name)}">${initials}</div>`;
              }).join('')}
              ${users.length > 8 ? `<span style="font-size:0.75rem;color:var(--text-muted);">+${users.length-8}</span>` : ''}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Events
  grid.querySelectorAll('.add-nucleo-btn').forEach(btn =>
    btn.addEventListener('click', () => openNucleoModal(null, btn.dataset.sector))
  );
  grid.querySelectorAll('[data-nucleo-edit]').forEach(btn =>
    btn.addEventListener('click', () => {
      const n = allNucleos.find(x => x.id === btn.dataset.nucleoEdit);
      if (n) openNucleoModal(n);
    })
  );
  grid.querySelectorAll('[data-nucleo-members]').forEach(btn =>
    btn.addEventListener('click', () => {
      const n = allNucleos.find(x => x.id === btn.dataset.nucleoMembers);
      if (n) openMembersModal(n, visibleSectors);
    })
  );
  grid.querySelectorAll('[data-nucleo-del]').forEach(btn =>
    btn.addEventListener('click', () => confirmDelete(btn.dataset.nucleoDel))
  );
}

/* ─── Modal: gerenciar membros do núcleo ─────────────────── */
function openMembersModal(nucleo, visibleSectors) {
  const users = (store.get('users') || [])
    .filter(u => u.active !== false)
    .filter(u => (u.sector || u.department) === nucleo.sector)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Set mutável de UIDs que queremos deixar NESTE núcleo após salvar.
  // Semântica multi: marcar adiciona o núcleo na lista do usuário;
  // desmarcar remove SÓ este núcleo (não mexe nos outros que ele tem).
  const selected = new Set(users.filter(u => userInNucleo(u, nucleo.name)).map(u => u.id));

  if (!users.length) {
    modal.open({
      title: `Membros — ${nucleo.name}`,
      size: 'sm',
      content: `<div class="empty-state" style="min-height:160px;padding:24px;">
        <div class="empty-state-icon">◈</div>
        <div class="empty-state-title">Nenhum usuário ativo no setor "${esc(nucleo.sector)}".</div>
        <div class="empty-state-text" style="margin-top:8px;font-size:0.8125rem;color:var(--text-muted);">
          Cadastre usuários no setor em Configurações → Usuários antes de atribuí-los ao núcleo.
        </div>
      </div>`,
      footer: [ { label: 'Fechar', class: 'btn-secondary', closeOnClick: true } ],
    });
    return;
  }

  const chipHtml = (u) => {
    const inNuc     = selected.has(u.id);
    const allNucs   = userNucleos(u);
    const otherNucs = allNucs.filter(n => n !== nucleo.name);
    const initials  = (u.name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
    return `
      <label class="nc-member-row" data-uid="${u.id}" style="
        display:flex;align-items:center;gap:10px;padding:8px 12px;
        border:1px solid ${inNuc ? nucleo.color||'#6B7280' : 'var(--border-subtle)'};
        background:${inNuc ? (nucleo.color||'#6B7280')+'14' : 'var(--bg-surface)'};
        border-radius:var(--radius-md);cursor:pointer;transition:all 0.15s;">
        <input type="checkbox" ${inNuc ? 'checked' : ''} data-uid="${u.id}"
          style="accent-color:${nucleo.color||'#6B7280'};" />
        <div class="avatar" style="width:28px;height:28px;font-size:0.625rem;
          background:${u.avatarColor||'#3B82F6'};flex-shrink:0;">${initials}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.8125rem;color:var(--text-primary);
            white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(u.name)}</div>
          ${otherNucs.length ? `<div style="font-size:0.6875rem;color:var(--text-muted);">
            Também em: ${esc(otherNucs.join(', '))}</div>` : ''}
        </div>
      </label>
    `;
  };

  modal.open({
    title:   `Membros — ${nucleo.name}`,
    content: `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="display:flex;align-items:flex-start;gap:10px;
          background:rgba(56,189,248,0.08);border:1px solid rgba(56,189,248,0.25);
          border-radius:var(--radius-md);padding:10px 14px;
          font-size:0.75rem;color:var(--text-secondary);line-height:1.5;">
          <span>ℹ</span>
          <span>Um usuário pode participar de vários núcleos.
            Marcar aqui <strong>adiciona este núcleo</strong> à lista dele;
            desmarcar <strong>remove apenas este</strong> sem afetar os outros.
            Só usuários do setor <strong>${esc(nucleo.sector)}</strong> aparecem.</span>
        </div>
        <input type="search" class="form-input" id="nc-members-search"
          placeholder="Buscar usuário..." style="margin:0;" />
        <div id="nc-members-list" style="display:flex;flex-direction:column;gap:6px;
          max-height:360px;overflow-y:auto;padding-right:4px;">
          ${users.map(chipHtml).join('')}
        </div>
        <div id="nc-members-count" style="font-size:0.75rem;color:var(--text-muted);text-align:right;">
          ${selected.size} selecionado${selected.size!==1?'s':''}
        </div>
      </div>
    `,
    footer: [
      { label: 'Cancelar', class: 'btn-secondary', closeOnClick: true },
      {
        label: 'Salvar', class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          const btn = document.querySelector('.modal-footer .btn-primary');
          if (btn) { btn.classList.add('loading'); btn.disabled = true; }
          try {
            await saveMembers(nucleo, users, selected);
            toast.success('Membros atualizados!');
            close();
            // Recarrega usuários e re-renderiza
            await reloadUsers();
            render(visibleSectors);
          } catch(e) {
            toast.error('Erro ao salvar: ' + e.message);
          } finally {
            if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
          }
        },
      },
    ],
  });

  // Wire checkbox + search após DOM existir
  setTimeout(() => {
    const list  = document.getElementById('nc-members-list');
    const count = document.getElementById('nc-members-count');
    const search = document.getElementById('nc-members-search');
    if (!list) return;

    list.querySelectorAll('.nc-member-row').forEach(row => {
      row.addEventListener('click', (ev) => {
        // Se clicou no próprio checkbox, o change dispara normalmente. Aqui tratamos
        // click na label/linha; evita loop prevenindo default de clicks no input.
        if (ev.target.tagName === 'INPUT') return;
        const cb = row.querySelector('input[type="checkbox"]');
        if (!cb) return;
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const cb = row.querySelector('input[type="checkbox"]');
      cb?.addEventListener('change', () => {
        const uid = cb.dataset.uid;
        if (cb.checked) selected.add(uid); else selected.delete(uid);
        row.style.borderColor = cb.checked ? (nucleo.color || '#6B7280') : 'var(--border-subtle)';
        row.style.background  = cb.checked ? (nucleo.color || '#6B7280') + '14' : 'var(--bg-surface)';
        if (count) count.textContent =
          `${selected.size} selecionado${selected.size!==1?'s':''}`;
      });
    });

    search?.addEventListener('input', () => {
      const term = search.value.trim().toLowerCase();
      list.querySelectorAll('.nc-member-row').forEach(row => {
        const name = (users.find(u => u.id === row.dataset.uid)?.name || '').toLowerCase();
        row.style.display = !term || name.includes(term) ? '' : 'none';
      });
    });
  }, 30);
}

async function saveMembers(nucleo, users, selectedSet) {
  // Semântica multi: toggle do núcleo atual DENTRO da lista u.nucleos do
  // usuário, sem apagar os outros núcleos dele. Back-compat: mantém
  // u.nucleo = nucleos[0] pra consumidores antigos que leem o escalar.
  const ops = [];
  for (const u of users) {
    const wasIn = userInNucleo(u, nucleo.name);
    const nowIn = selectedSet.has(u.id);
    if (wasIn === nowIn) continue; // sem mudança
    const current = userNucleos(u);
    const next = nowIn
      ? (current.includes(nucleo.name) ? current : [...current, nucleo.name])
      : current.filter(n => n !== nucleo.name);
    ops.push(updateUserProfile(u.id, {
      nucleos: next,
      nucleo:  next[0] || '', // back-compat (campo escalar)
    }));
  }
  if (!ops.length) return;
  await Promise.all(ops);
}

async function reloadUsers() {
  try {
    const snap = await getDocs(query(collection(db, 'users'), orderBy('name', 'asc')));
    store.set('users', snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch(e) { console.warn('reloadUsers falhou:', e.message); }
}

/* ─── Modal criar / editar núcleo ────────────────────────── */
function openNucleoModal(nucleo = null, presetSector = '') {
  const isEdit = !!nucleo;
  const visibleSectors = store.isMaster() ? SECTORS : (store.get('visibleSectors') || []);

  modal.open({
    title:   isEdit ? `Editar — ${nucleo.name}` : 'Novo Núcleo',
    size:    'sm',
    content: `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div class="form-group">
          <label class="form-label">Setor *</label>
          <select class="form-select" id="nc-sector">
            <option value="">— Selecione o setor —</option>
            ${visibleSectors.map(s =>
              `<option value="${esc(s)}" ${(nucleo?.sector||presetSector)===s?'selected':''}>${esc(s)}</option>`
            ).join('')}
          </select>
          <span class="form-error-msg" id="nc-sector-error"></span>
        </div>
        <div class="form-group">
          <label class="form-label">Nome do núcleo *</label>
          <input type="text" class="form-input" id="nc-name"
            value="${esc(nucleo?.name||'')}" maxlength="60"
            placeholder="Ex: Design, Jornalismo, Redes Sociais..." />
          <span class="form-error-msg" id="nc-name-error"></span>
        </div>
        <div class="form-group">
          <label class="form-label">Descrição</label>
          <input type="text" class="form-input" id="nc-desc"
            value="${esc(nucleo?.description||'')}" maxlength="120"
            placeholder="Descreva o papel deste núcleo..." />
        </div>
        <div class="form-group">
          <label class="form-label">Cor de identificação</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${NUCLEO_COLORS.map(c => `
              <div class="nc-color-btn" data-color="${c}" style="
                width:28px;height:28px;border-radius:50%;background:${c};cursor:pointer;
                border:3px solid ${(nucleo?.color||NUCLEO_COLORS[0])===c?'white':'transparent'};
                box-shadow:${(nucleo?.color||NUCLEO_COLORS[0])===c?'0 0 0 2px '+c:'none'};
                transition:all 0.15s;"></div>
            `).join('')}
          </div>
          <input type="hidden" id="nc-color" value="${esc(nucleo?.color||NUCLEO_COLORS[0])}" />
        </div>
      </div>
    `,
    footer: [
      { label:'Cancelar', class:'btn-secondary', closeOnClick:true },
      {
        label: isEdit ? 'Salvar' : 'Criar núcleo',
        class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          const name   = document.getElementById('nc-name')?.value?.trim();
          const sector = document.getElementById('nc-sector')?.value;
          const errN   = document.getElementById('nc-name-error');
          const errS   = document.getElementById('nc-sector-error');
          if (!name)   { if(errN) errN.textContent='Nome obrigatório.';  return; }
          if (!sector) { if(errS) errS.textContent='Setor obrigatório.'; return; }
          if(errN) errN.textContent=''; if(errS) errS.textContent='';

          const data = {
            name, sector,
            description: document.getElementById('nc-desc')?.value?.trim() || '',
            color:       document.getElementById('nc-color')?.value || NUCLEO_COLORS[0],
          };

          const btn = document.querySelector('.modal-footer .btn-primary');
          if(btn){ btn.classList.add('loading'); btn.disabled=true; }
          try {
            if (isEdit) { await updateNucleo(nucleo.id, data); toast.success('Núcleo atualizado!'); }
            else        { await createNucleo(data);             toast.success('Núcleo criado!'); }
            close();
            // Reload nucleos in store
            const { loadNucleos } = await import('../services/sectors.js');
            await loadNucleos();
            const visibleSectors = store.isMaster() ? SECTORS : (store.get('visibleSectors') || []);
            await load(visibleSectors);
          } catch(e) { toast.error(e.message); }
          finally { if(btn){ btn.classList.remove('loading'); btn.disabled=false; } }
        },
      },
    ],
  });

  setTimeout(() => {
    document.querySelectorAll('.nc-color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('nc-color').value = btn.dataset.color;
        document.querySelectorAll('.nc-color-btn').forEach(b => {
          b.style.borderColor = 'transparent'; b.style.boxShadow='none';
        });
        btn.style.borderColor = 'white';
        btn.style.boxShadow   = `0 0 0 2px ${btn.dataset.color}`;
      });
    });
  }, 50);
}

async function confirmDelete(nucleoId) {
  const n = allNucleos.find(x => x.id === nucleoId);
  if (!n) return;
  const ok = await modal.confirm({
    title:`Excluir núcleo "${n.name}"`,
    message:`Usuários vinculados a este núcleo não serão afetados, mas perderão o vínculo com este núcleo.`,
    confirmText:'Excluir', danger:true, icon:'✕',
  });
  if (!ok) return;
  try {
    await deleteNucleo(nucleoId);
    toast.success('Núcleo excluído.');
    const { loadNucleos } = await import('../services/sectors.js');
    await loadNucleos();
    const visibleSectors = store.isMaster() ? SECTORS : (store.get('visibleSectors') || []);
    await load(visibleSectors);
  } catch(e) { toast.error(e.message); }
}
