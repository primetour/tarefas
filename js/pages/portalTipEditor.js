/**
 * PRIMETOUR — Portal de Dicas: Editor de Dicas v2
 * Suporta todos os 11 segmentos com seus modos específicos:
 *   special_info → Informações Gerais (formulário estruturado)
 *   simple_list  → Bairros, Arredores (itens de texto)
 *   place_list   → Atrações, Restaurantes etc. (itens com categoria+lugar)
 *   agenda       → Agenda Cultural (place_list + período por item)
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import {
  fetchDestinations, fetchTip, saveTip, fetchCategories, saveCategories,
  SEGMENTS, getSegments, saveCustomSegment, deleteCustomSegment, slugifySegmentKey,
  CONTINENTS, MONTHS,
} from '../services/portal.js';

// 4.40.18+ Segmentos dinâmicos = defaults + custom (carregados do Firestore).
// Antes era const SEGMENTS importada estática. Agora _allSegments é mutável
// e pode crescer quando user cria custom segs via "+ Novo segmento".
let _allSegments = [...SEGMENTS];

const esc = s => String(s||'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const inp = (id, def='') => document.getElementById(id)?.value ?? def;
const chk = (id)          => document.getElementById(id)?.checked ?? false;

/* ─── State ───────────────────────────────────────────────── */
let currentTip      = null;
let currentDestId   = null;
let currentDestInfo = null;
let segmentData     = {};
let activeSegKey    = null;
let isDirty         = false;
let autoSaveTimer   = null;
let categoriesCache = {};

/* ─── Entry ───────────────────────────────────────────────── */
export async function renderPortalTipEditor(container) {
  if (!store.canCreateTip()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
    </div>`;
    return;
  }

  const hash   = window.location.hash;
  const params = new URLSearchParams(hash.includes('?') ? hash.split('?')[1] : '');
  // v4.62.9: destId via URL param OU sessionStorage (fallback robusto contra
  // race do boot inicial — query string podia ser perdida quando page carrega
  // direto na URL com `?destId=`, fazia abrir como "Nova dica" mesmo com tip
  // existente). sessionStorage é setado pelo botão Dica em portalDestinations.
  let destId = params.get('destId') || null;
  if (!destId) {
    try {
      const stored = sessionStorage.getItem('tipEditor.pendingDestId');
      if (stored) { destId = stored; sessionStorage.removeItem('tipEditor.pendingDestId'); }
    } catch {/* sessionStorage indisponível em modo privado */}
  } else {
    // Tem na URL — consome sessionStorage se também tiver pra evitar interferência
    try { sessionStorage.removeItem('tipEditor.pendingDestId'); } catch {}
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title" id="editor-title">Editor de Dica</h1>
        <p class="page-subtitle" id="editor-subtitle">Selecione um destino para começar</p>
      </div>
      <div class="page-header-actions" style="gap:8px;flex-wrap:wrap;">
        <span id="editor-save-status" style="font-size:0.75rem;color:var(--text-muted);"></span>
        <button class="btn btn-secondary btn-sm" onclick="location.hash='portal-destinations'">← Destinos</button>
        <button class="btn btn-primary btn-sm" id="editor-save-btn" disabled>Salvar Dica</button>
      </div>
    </div>

    <!-- Destination selector -->
    <div id="editor-dest-selector" class="card" style="padding:24px;margin-bottom:20px;">
      <h3 style="font-size:0.875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
        color:var(--text-muted);margin:0 0 16px;">Destino</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;align-items:end;">
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">Continente *</label>
          <select class="filter-select" id="editor-continent" style="width:100%;">
            <option value="">Selecione</option>
            ${CONTINENTS.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">País *</label>
          <select class="filter-select" id="editor-country" style="width:100%;" disabled>
            <option value="">Selecione o continente</option>
          </select>
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">
            Cidade <span style="font-weight:400;color:var(--text-muted);">(opcional)</span>
          </label>
          <select class="filter-select" id="editor-city" style="width:100%;" disabled>
            <option value="">Nível país</option>
          </select>
        </div>
      </div>
      <div style="margin-top:12px;display:flex;gap:10px;align-items:center;">
        <button class="btn btn-primary btn-sm" id="editor-load-dest-btn" disabled>
          Carregar / Criar Dica
        </button>
        <span id="editor-dest-status" style="font-size:0.8125rem;color:var(--text-muted);"></span>
      </div>
    </div>

    <!-- Priority flag -->
    <div id="editor-priority-bar" style="display:none;margin-bottom:16px;">
      <div class="card" style="padding:14px 20px;display:flex;align-items:center;gap:12px;">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.875rem;
          font-weight:600;user-select:none;">
          <input type="checkbox" id="editor-priority" style="width:18px;height:18px;accent-color:var(--brand-gold);cursor:pointer;">
          <span style="color:var(--brand-gold);">★</span> Destino prioritário
        </label>
        <span style="font-size:0.75rem;color:var(--text-muted);">
          Destinos prioritários são destacados na listagem e no dashboard.
        </span>
      </div>
    </div>

    <!-- 4.49.13+ Campo observação interna (não-exportada).
         Vai pro doc da dica em campo internalNotes mas NUNCA aparece em
         PDF/DOCX/PPTX/web link. Usado pra anotações de contexto pro time
         (ex: "Restaurante bom para casais", "Sempre lotado em alta") e
         futuramente como context window pra geração via IA. -->
    <div id="editor-internal-notes-bar" style="display:none;margin-bottom:16px;">
      <div class="card" style="padding:14px 20px;">
        <label style="display:flex;flex-direction:column;gap:6px;font-size:0.8125rem;
          font-weight:600;user-select:none;">
          <div style="display:flex;align-items:center;gap:8px;color:var(--text-secondary);">
            🔒 <span>Observações internas (não aparecem pro cliente)</span>
          </div>
          <textarea id="editor-internal-notes" class="portal-field" rows="2"
            placeholder="Contexto pro time e pra IA. Ex: &quot;Restaurante bom para casais, lotado em alta temporada&quot;…"
            style="width:100%;resize:vertical;font-size:0.8125rem;"></textarea>
          <span style="font-size:0.6875rem;color:var(--text-muted);font-weight:400;">
            Este texto NÃO aparece em PDFs, DOCX, PPTX ou links web — fica só dentro do sistema.
          </span>
        </label>
      </div>
    </div>

    <!-- Editor layout -->
    <div id="editor-layout" style="display:none;">
      <div style="display:grid;grid-template-columns:220px 1fr;gap:20px;align-items:start;">

        <!-- Segment sidebar -->
        <div style="position:sticky;top:20px;">
          <div class="card" style="padding:0;overflow:hidden;">
            <div style="padding:12px 14px;border-bottom:1px solid var(--border-subtle);
              font-size:0.6875rem;font-weight:700;text-transform:uppercase;
              letter-spacing:.07em;color:var(--text-muted);">Segmentos</div>
            <nav id="segment-nav" style="padding:6px 0;"></nav>
          </div>
          <div class="card" style="padding:14px;margin-top:12px;">
            <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;
              letter-spacing:.07em;color:var(--text-muted);margin-bottom:10px;">Validades</div>
            <div id="expiry-overview" style="display:flex;flex-direction:column;gap:4px;"></div>
          </div>
        </div>

        <!-- Segment editor panel -->
        <div id="segment-editor-panel">
          <div class="card" style="padding:32px;text-align:center;color:var(--text-muted);">
            Selecione um segmento para editar.
          </div>
        </div>
      </div>
    </div>
  `;

  // Bindings
  document.getElementById('editor-continent')?.addEventListener('change', onContinentChange);
  document.getElementById('editor-country')?.addEventListener('change',   onCountryChange);
  document.getElementById('editor-city')?.addEventListener('change', () => {
    document.getElementById('editor-load-dest-btn').disabled = false;
  });
  document.getElementById('editor-load-dest-btn')?.addEventListener('click', loadDestination);
  document.getElementById('editor-save-btn')?.addEventListener('click', saveDraft);
  document.getElementById('editor-priority')?.addEventListener('change', () => markDirty());
  // 4.49.13+ Marca dirty quando user edita observações internas
  document.getElementById('editor-internal-notes')?.addEventListener('input', () => markDirty());

  if (destId) await loadDestinationById(destId);
}

/* ─── Destination loading ─────────────────────────────────── */
async function onContinentChange() {
  const cont     = document.getElementById('editor-continent')?.value;
  const cSel     = document.getElementById('editor-country');
  const citySel  = document.getElementById('editor-city');
  const loadBtn  = document.getElementById('editor-load-dest-btn');
  cSel.innerHTML = '<option value="">Carregando…</option>';
  cSel.disabled  = true;
  citySel.innerHTML = '<option value="">Nível país</option>';
  citySel.disabled  = true;
  if (loadBtn) loadBtn.disabled = true;
  if (!cont) return;
  const dests    = await fetchDestinations({ continent: cont, reviewStatus: 'approved' });
  const countries = [...new Set(dests.map(d => d.country).filter(Boolean))].sort();
  cSel.innerHTML = `<option value="">Selecione o país</option>` +
    countries.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  cSel.disabled = false;
}

async function onCountryChange() {
  const cont    = document.getElementById('editor-continent')?.value;
  const country = document.getElementById('editor-country')?.value;
  const citySel = document.getElementById('editor-city');
  const loadBtn = document.getElementById('editor-load-dest-btn');
  citySel.innerHTML = '<option value="">Nível país (sem cidade)</option>';
  citySel.disabled  = true;
  if (loadBtn) loadBtn.disabled = !country;
  if (!country) return;
  const dests  = await fetchDestinations({ continent: cont, country, reviewStatus: 'approved' });
  const cities = dests.map(d => d.city).filter(Boolean).sort();
  if (cities.length) {
    citySel.innerHTML = `<option value="">Nível país (sem cidade)</option>` +
      cities.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
    citySel.disabled = false;
  }
  if (loadBtn) loadBtn.disabled = false;
}

async function loadDestination() {
  const cont    = document.getElementById('editor-continent')?.value;
  const country = document.getElementById('editor-country')?.value;
  const city    = document.getElementById('editor-city')?.value;
  const status  = document.getElementById('editor-dest-status');
  if (!country) { toast.error('Selecione o país.'); return; }
  if (status) status.textContent = 'Carregando…';
  const dests = await fetchDestinations({ continent: cont, country, reviewStatus: 'approved' });
  const dest  = city ? dests.find(d => d.city === city) : dests.find(d => !d.city) || dests[0];
  if (!dest) { toast.error('Destino não cadastrado. Crie primeiro em Destinos.'); return; }
  await loadDestinationById(dest.id, dest);
}

async function loadDestinationById(destId, destInfo = null) {
  currentDestId = destId;
  if (!destInfo) {
    const all = await fetchDestinations();
    destInfo  = all.find(d => d.id === destId);
  }
  currentDestInfo = destInfo;
  const tip = await fetchTip(destId);
  currentTip = tip;
  // v4.57.40 PD5: marca momento do load pra conflict detection no save
  if (currentTip) {
    currentTip._loadedAt = currentTip.updatedAt?.toMillis?.() ?? Date.now();
  }

  // 4.40.18+ Carrega custom segments do Firestore antes de inicializar
  // segmentData — assim novos segs ficam disponíveis no nav imediatamente.
  try {
    _allSegments = await getSegments({ force: true });
  } catch (e) {
    console.warn('[tipEditor] getSegments failed, fallback to defaults:', e?.message);
  }

  // Init segment data
  segmentData = {};
  for (const seg of _allSegments) {
    segmentData[seg.key] = tip?.segments?.[seg.key] || emptySegData(seg);
  }

  // Preload all categories
  for (const seg of _allSegments) {
    if (seg.mode === 'place_list' || seg.mode === 'agenda') {
      categoriesCache[seg.key] = await fetchCategories(seg.key);
    }
  }

  const label = [destInfo?.city, destInfo?.country, destInfo?.continent].filter(Boolean).join(' · ');
  document.getElementById('editor-title').textContent    = tip ? 'Editando dica' : 'Nova dica';
  document.getElementById('editor-subtitle').textContent = label;
  document.getElementById('editor-save-btn').disabled    = false;
  document.getElementById('editor-layout').style.display = 'block';
  document.getElementById('editor-dest-selector').style.display = 'none';
  const priorityBar = document.getElementById('editor-priority-bar');
  const priorityChk = document.getElementById('editor-priority');
  if (priorityBar) priorityBar.style.display = 'block';
  if (priorityChk) priorityChk.checked = !!tip?.priority;
  // 4.49.13+ Carrega observações internas (não-exportadas)
  const notesBar    = document.getElementById('editor-internal-notes-bar');
  const notesArea   = document.getElementById('editor-internal-notes');
  if (notesBar) notesBar.style.display = 'block';
  if (notesArea) notesArea.value = tip?.internalNotes || '';

  const status = document.getElementById('editor-save-status');
  if (status) status.textContent = tip
    ? `Última edição: ${fmt(tip.updatedAt)}`
    : 'Novo rascunho — não salvo';

  renderSegmentNav();
  renderExpiryOverview();
  activateSegment(_allSegments[0].key);
}

function emptySegData(seg) {
  if (seg.mode === 'special_info') return { info: {}, hasExpiry: false, expiryDate: '' };
  return { themeDesc: '', dica: '', items: [], hasExpiry: false, expiryDate: '',
    ...(seg.mode === 'agenda' ? { periodoAgenda: '' } : {}) };
}

/* ─── Segment nav ─────────────────────────────────────────── */
function renderSegmentNav() {
  const nav = document.getElementById('segment-nav');
  if (!nav) return;
  // 4.49.6+ Usa canManagePortalSegments() (granular) — libera botão "+ Novo
  // segmento" pro analista. Mantém compat com legado canManagePortal/master.
  const canManage = store.canManagePortalSegments?.() || store.canManagePortal?.() || store.isMaster?.();
  // v4.62.38: segmentos custom têm ações de editar/deletar inline (right side
  // do botão). Builtin não — protegidos por design. Só aparece pra quem tem
  // canManagePortalSegments. Ações usam classe própria pra interceptar click
  // ANTES do click do .seg-nav-btn pai.
  nav.innerHTML = _allSegments.map(s => {
    const hasContent = segHasContent(s.key);
    const isExpired  = isExpiredSeg(s.key);
    const isActive   = s.key === activeSegKey;
    const showActions = canManage && !s.builtin;
    return `<div class="seg-nav-wrap" style="display:flex;align-items:stretch;${isActive ? 'background:rgba(212,168,67,0.06);' : ''}border-left:3px solid ${isActive ? 'var(--brand-gold)' : 'transparent'};">
      <button class="seg-nav-btn" data-key="${esc(s.key)}"
        style="flex:1;text-align:left;padding:9px 14px;border:none;background:transparent;
        cursor:pointer;display:flex;align-items:center;gap:8px;font-size:0.8125rem;min-width:0;">
        <span style="flex:1;color:${isActive ? 'var(--brand-gold)' : 'var(--text-primary)'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${esc(s.label)}${!s.builtin ? '<span style="font-size:0.625rem;color:var(--text-muted);margin-left:4px;">·custom</span>' : ''}
        </span>
        <span style="font-size:0.625rem;color:${isExpired?'#EF4444':hasContent?'#22C55E':'var(--text-muted)'};">
          ${isExpired ? '⚠' : hasContent ? '●' : '○'}
        </span>
      </button>
      ${showActions ? `
        <button class="seg-action-btn" data-action="edit-seg" data-key="${esc(s.key)}" data-label="${esc(s.label)}"
          title="Renomear segmento"
          style="background:transparent;border:none;cursor:pointer;padding:0 8px;color:var(--text-muted);font-size:0.85rem;display:flex;align-items:center;">✎</button>
        <button class="seg-action-btn" data-action="del-seg" data-key="${esc(s.key)}" data-label="${esc(s.label)}"
          title="Excluir segmento"
          style="background:transparent;border:none;cursor:pointer;padding:0 8px;color:var(--text-muted);font-size:0.85rem;display:flex;align-items:center;">🗑</button>
      ` : ''}
    </div>`;
  }).join('') + (canManage ? `
    <button id="seg-add-new" style="width:100%;text-align:left;padding:10px 14px;border:none;
      border-top:1px dashed var(--border-subtle);background:transparent;cursor:pointer;
      color:var(--brand-gold);font-weight:600;font-size:0.8125rem;">
      + Novo segmento
    </button>` : '');

  // Hover state pros ícones (entra/sai)
  nav.querySelectorAll('.seg-action-btn').forEach(b => {
    b.addEventListener('mouseenter', () => { b.style.color = 'var(--brand-gold)'; });
    b.addEventListener('mouseleave', () => { b.style.color = 'var(--text-muted)'; });
  });

  nav.querySelectorAll('.seg-nav-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      saveCurrentSegment();
      activateSegment(btn.dataset.key);
    }));

  // v4.62.38: handlers de editar/deletar segmento custom
  nav.querySelectorAll('[data-action="edit-seg"]').forEach(btn =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditSegmentModal(btn.dataset.key, btn.dataset.label);
    }));
  nav.querySelectorAll('[data-action="del-seg"]').forEach(btn =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openDeleteSegmentConfirm(btn.dataset.key, btn.dataset.label);
    }));

  document.getElementById('seg-add-new')?.addEventListener('click', openNewSegmentModal);
}

/* ─── v4.62.38 Editar / Renomear segmento custom ─────────────── */
async function openEditSegmentModal(key, currentLabel) {
  const { modal } = await import('../components/modal.js');
  const seg = _allSegments.find(s => s.key === key);
  if (!seg) return;
  const ref = modal.open({
    dedupeKey: 'seg-edit-modal',
    title: '✎ Renomear segmento',
    size: 'sm',
    closeOnEsc: true,
    content: `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">
            Novo nome
          </label>
          <input type="text" class="portal-field" id="editseg-label" value="${esc(currentLabel)}"
            style="width:100%;" maxlength="60" autofocus>
          <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:4px;">
            O nome aparece no menu lateral. Chave técnica (<code>${esc(key)}</code>) não muda — dicas existentes continuam vinculadas.
          </div>
        </div>
      </div>`,
    footer: [
      { label: 'Cancelar', class: 'btn-secondary', closeOnClick: true },
      { label: 'Salvar', class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          const newLabel = ref.getBody().querySelector('#editseg-label')?.value?.trim();
          if (!newLabel) { toast.warning('Digite um nome.'); return; }
          if (newLabel === currentLabel) { close(); return; }
          try {
            await saveCustomSegment({ key, label: newLabel, mode: seg.mode || 'place_list', order: seg.order ?? 100 });
            _allSegments = await getSegments({ force: true });
            renderSegmentNav();
            toast.success('Segmento renomeado.');
            close();
          } catch (e) { toast.error('Erro: ' + (e.message || e)); }
        }
      },
    ],
  });
}

/* ─── v4.62.38 Excluir segmento custom ──────────────────────── */
async function openDeleteSegmentConfirm(key, label) {
  const { modal } = await import('../components/modal.js');
  // Conta quantas dicas têm conteúdo nesse segmento (aviso de FK soft)
  const hasContentNow = segHasContent(key);
  const warningHTML = hasContentNow
    ? `<div style="padding:12px 14px;background:rgba(245,158,11,0.08);border-left:3px solid #F59E0B;border-radius:6px;font-size:0.8125rem;line-height:1.5;color:var(--text-secondary);margin-bottom:14px;">
        <strong>Atenção:</strong> esta dica TEM conteúdo no segmento "${esc(label)}".
        Se você excluir o segmento, o conteúdo PERMANECE salvo no banco (não some),
        mas o segmento desaparece do menu. Pra acessar/editar de novo, terá que
        recriar o segmento com a mesma chave (<code>${esc(key)}</code>).
      </div>`
    : `<div style="font-size:0.8125rem;color:var(--text-secondary);margin-bottom:14px;line-height:1.5;">
        Esta dica não tem conteúdo neste segmento. Pode excluir sem perder dados desta dica.
      </div>`;
  const ok = await modal.confirm({
    title: '🗑 Excluir segmento custom',
    message: `${warningHTML}
      <div style="font-size:0.8125rem;color:var(--text-primary);">
        Excluir <strong>"${esc(label)}"</strong>?<br>
        <span style="font-size:0.72rem;color:var(--text-muted);">
          Segmento sai do menu lateral em TODAS as dicas do Portal de Dicas.
          Conteúdo já salvo permanece no Firestore (não há cleanup destrutivo).
        </span>
      </div>`,
    confirmText: 'Excluir', cancelText: 'Cancelar',
    danger: true, icon: '🗑️',
  });
  if (!ok) return;
  try {
    await deleteCustomSegment(key);
    _allSegments = await getSegments({ force: true });
    // Se segmento ativo era esse, troca pro primeiro disponível
    if (activeSegKey === key) {
      activeSegKey = _allSegments[0]?.key || '';
      activateSegment(activeSegKey);
    } else {
      renderSegmentNav();
    }
    toast.success('Segmento excluído.');
  } catch (e) { toast.error('Erro: ' + (e.message || e)); }
}

/* ─── 4.40.18+ Modal pra criar novo segmento custom ──────────── */
async function openNewSegmentModal() {
  const { modal } = await import('../components/modal.js');
  const ref = modal.open({
    dedupeKey: 'seg-new-modal',
    title: '+ Novo segmento',
    size: 'sm',
    closeOnEsc: true,
    content: `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div>
          <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">
            Nome do segmento *
          </label>
          <input type="text" class="portal-field" id="newseg-label" placeholder="Ex: Praias, Spas, Mirantes…"
            style="width:100%;" maxlength="60" autofocus>
          <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:4px;">
            Aparece no menu lateral de segmentos. Use plural quando fizer sentido.
          </div>
        </div>
        <div>
          <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">
            Tipo de conteúdo *
          </label>
          <select class="filter-select" id="newseg-mode" style="width:100%;">
            <option value="place_list">📍 Lista de lugares (com categoria, endereço, site, etc.)</option>
            <option value="simple_list">📝 Lista simples (apenas título + descrição)</option>
            <option value="agenda">🗓 Agenda (lugares + período do evento)</option>
          </select>
          <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:4px;">
            <strong>Lista de lugares</strong>: campos categoria, título, descrição, endereço, telefone, site, observações.<br>
            <strong>Lista simples</strong>: só título + descrição (igual Bairros/Arredores).<br>
            <strong>Agenda</strong>: igual lista de lugares + período do evento (igual Agenda Cultural).
          </div>
        </div>
      </div>`,
    footer: [
      { label: 'Cancelar', class: 'btn-secondary', closeOnClick: true },
      { label: 'Criar segmento', class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          const label = ref.getBody().querySelector('#newseg-label')?.value?.trim();
          const mode  = ref.getBody().querySelector('#newseg-mode')?.value || 'place_list';
          if (!label) { toast.warning('Digite um nome.'); return; }
          const key = slugifySegmentKey(label);
          // Evita colisão com defaults ou outros customs
          if (_allSegments.some(s => s.key === key)) {
            toast.error(`Já existe um segmento com nome similar ("${key}"). Use outro nome.`);
            return;
          }
          // Order = maior order atual + 10 (deixa o novo no fim)
          const maxOrder = _allSegments.reduce((m, s) => Math.max(m, s.order ?? 0), 100);
          try {
            await saveCustomSegment({ key, label, mode, order: maxOrder + 10 });
            // Refresh segmentos + segData
            _allSegments = await getSegments({ force: true });
            const newSeg = _allSegments.find(s => s.key === key);
            if (newSeg) {
              segmentData[key] = emptySegData(newSeg);
              if (newSeg.mode === 'place_list' || newSeg.mode === 'agenda') {
                categoriesCache[key] = await fetchCategories(key);
              }
            }
            close();
            toast.success(`Segmento "${label}" criado!`);
            renderSegmentNav();
            activateSegment(key);
            markDirty();
          } catch (err) {
            toast.error(`Erro: ${err.message || err}`);
          }
        }
      },
    ],
  });
}

function activateSegment(key) {
  activeSegKey = key;
  renderSegmentNav();
  renderSegmentPanel(key);
}

/* ─── Segment panel dispatcher ───────────────────────────── */
function renderSegmentPanel(key) {
  const panel = document.getElementById('segment-editor-panel');
  if (!panel) return;
  const seg  = _allSegments.find(s => s.key === key);
  const data = segmentData[key] || emptySegData(seg);
  if (!seg) return;

  switch (seg.mode) {
    case 'special_info': panel.innerHTML = buildInfoGeneraisPanel(data); bindInfoGenerais(); break;
    case 'simple_list':  panel.innerHTML = buildSimpleListPanel(seg, data); bindSimpleList(key); break;
    case 'place_list':   panel.innerHTML = buildPlaceListPanel(seg, data); bindPlaceList(key); break;
    case 'agenda':       panel.innerHTML = buildAgendaPanel(seg, data); bindPlaceList(key, true); break;
  }

  // Expiry bindings (common to all)
  document.getElementById('seg-has-expiry')?.addEventListener('change', e => {
    document.getElementById('seg-expiry-field').style.display = e.target.checked ? 'flex' : 'none';
    markDirty();
  });
  document.getElementById('seg-expiry-date')?.addEventListener('change', markDirty);

  // ── Botão IA: Atualizar segmento vencido ──
  document.querySelector('.btn-ai-update-seg')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = '◈ Gerando...';
    try {
      const { suggestExpiredUpdate } = await import('../services/portal.js');
      const result = await suggestExpiredUpdate(currentTip?.id, activeSegKey);
      // Mostrar sugestão inline
      _showSegmentAiSuggestion(result);
    } catch (err) {
      if (err.message === 'AI_CONSENT_REQUIRED') {
        const { toast } = await import('../components/toast.js');
        toast.info('Aceite os termos de uso de IA primeiro.');
      } else {
        const { toast } = await import('../components/toast.js');
        toast.error('Erro: ' + err.message);
      }
    }
    btn.disabled = false;
    btn.textContent = '◈ IA: Atualizar';
  });

  // ── Verificar se há sugestão de IA pendente do sessionStorage ──
  _checkPendingAiSuggestion();
}

/* ─── Panel builders ──────────────────────────────────────── */
const CARD_STYLE  = `padding:0;overflow:hidden;`;
const HEAD_STYLE  = `padding:16px 20px;border-bottom:1px solid var(--border-subtle);
  display:flex;align-items:center;justify-content:space-between;gap:16px;background:var(--bg-surface);`;
const BODY_STYLE  = `padding:20px 24px;`;

function expiryControls(data) {
  const isExpired = data.hasExpiry && data.expiryDate && new Date(data.expiryDate) < new Date();
  return `
    <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.8125rem;">
        <input type="checkbox" id="seg-has-expiry" ${data.hasExpiry?'checked':''}
          style="accent-color:var(--brand-gold);width:14px;height:14px;">
        Tem validade
      </label>
      <div id="seg-expiry-field" style="display:${data.hasExpiry?'flex':'none'};align-items:center;gap:6px;">
        <input type="date" id="seg-expiry-date" value="${esc(data.expiryDate||'')}"
          class="portal-field" style="padding:5px 8px;font-size:0.8125rem;width:140px;">
        ${isExpired ? `<span style="font-size:0.75rem;color:#EF4444;font-weight:600;">● Vencido</span>
          <button class="btn-ai-update-seg" style="font-size:0.625rem;padding:2px 8px;border-radius:var(--radius-full);
            border:1px solid rgba(212,168,67,0.4);background:rgba(212,168,67,0.08);color:var(--brand-gold,#D4A843);
            cursor:pointer;font-family:inherit;white-space:nowrap;" title="Sugestão de IA para atualizar">
            ◈ IA: Atualizar
          </button>` : ''}
      </div>
    </div>`;
}

/* ── Informações Gerais ─────────────────────────────────── */
function buildInfoGeneraisPanel(data) {
  const inf  = data.info || {};
  const cli  = inf.clima || {};
  const rep  = inf.representacao || {};

  const climaGrid = `
    <div style="overflow-x:auto;margin-top:8px;">
      <table style="border-collapse:collapse;font-size:0.8125rem;min-width:700px;">
        <thead>
          <tr style="background:var(--bg-surface);">
            <th style="padding:6px 10px;text-align:left;font-size:0.6875rem;text-transform:uppercase;
              color:var(--text-muted);border:1px solid var(--border-subtle);width:70px;">°C</th>
            ${MONTHS.map(m=>`<th style="padding:6px 8px;text-align:center;font-size:0.6875rem;
              text-transform:uppercase;color:var(--text-muted);border:1px solid var(--border-subtle);">
              ${m}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${['max','min'].map(type=>`
            <tr>
              <td style="padding:6px 10px;font-weight:600;font-size:0.75rem;
                border:1px solid var(--border-subtle);color:var(--text-muted);">
                ${type === 'max' ? '↑ Máx' : '↓ Mín'}
              </td>
              ${MONTHS.map((m,i)=>`
                <td style="padding:4px;border:1px solid var(--border-subtle);">
                  <div style="display:flex;align-items:center;gap:2px;">
                    <input type="text" class="clima-input" data-type="${type}" data-month="${i}"
                      value="${esc(String(cli[`${type}_${i}`]??''))}"
                      style="width:42px;border:none;background:transparent;text-align:center;
                      font-size:0.8125rem;color:var(--text-primary);outline:none;padding:4px 2px;"
                      placeholder="—">
                    <span style="font-size:0.6875rem;color:var(--text-muted);">°</span>
                  </div>
                </td>
              `).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>`;

  return `<div class="card" style="${CARD_STYLE}">
    <div style="${HEAD_STYLE}">
      <div>
        <h2 style="margin:0;font-size:1rem;font-weight:700;">Informações Gerais</h2>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">Dados gerais do destino</div>
      </div>
      ${expiryControls(data)}
    </div>
    <div style="${BODY_STYLE}">

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        ${field('ig-descricao','Descrição','textarea',inf.descricao,{rows:4})}
        ${field('ig-dica','Dica','textarea',inf.dica,{rows:4})}
        ${field('ig-populacao','População (habitantes)','text',inf.populacao,{placeholder:'Ex: 2.161.000'})}
        ${field('ig-moeda','Moeda','text',inf.moeda,{placeholder:'Ex: Euro (€)'})}
        ${field('ig-lingua','Língua oficial','text',inf.lingua)}
        ${field('ig-religiao','Religião predominante','text',inf.religiao)}
        <div>
          <label style="${LBL}">Fuso horário</label>
          <div style="display:flex;align-items:center;gap:8px;">
            <select id="ig-fuso-sinal" class="filter-select" style="width:70px;">
              <option value="+" ${inf.fusoSinal!=='-'?'selected':''}>+</option>
              <option value="-" ${inf.fusoSinal==='-'?'selected':''}>-</option>
            </select>
            <input type="text" id="ig-fuso-horas" class="portal-field" style="width:60px;"
              value="${esc(String(inf.fusoHoras??''))}" placeholder="0">
            <span style="font-size:0.875rem;color:var(--text-muted);">horas em relação a Brasília</span>
          </div>
        </div>
        <div>
          <label style="${LBL}">Voltagem</label>
          <div style="display:flex;gap:12px;margin-top:8px;">
            ${['110V','220V'].map(v=>`
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.875rem;">
                <input type="radio" name="ig-voltagem" value="${v}" ${inf.voltagem===v?'checked':''}
                  style="accent-color:var(--brand-gold);">
                ${v}
              </label>`).join('')}
          </div>
        </div>
        ${field('ig-ddd','DDD do País','text',inf.ddd,{placeholder:'Ex: +33'})}
      </div>

      <!-- Clima -->
      <div style="margin-bottom:20px;">
        <div style="font-size:0.875rem;font-weight:700;margin-bottom:4px;">Clima — Temperatura Anual (°C)</div>
        <div style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:8px;">
          Preencha as temperaturas máxima e mínima para cada mês.
        </div>
        ${climaGrid}
      </div>

      <!-- Representação Brasileira -->
      <div style="padding:16px;background:var(--bg-surface);border-radius:var(--radius-md);">
        <div style="font-size:0.875rem;font-weight:700;margin-bottom:12px;">Representação Brasileira</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          ${field('rep-nome','Nome','text',rep.nome)}
          ${field('rep-endereco','Endereço','text',rep.endereco)}
          ${field('rep-telefone','Telefone','text',rep.telefone)}
          ${field('rep-link','Link','url',rep.link,{placeholder:'https://'})}
          <div style="grid-column:1/-1;">
            ${field('rep-obs','Observações','textarea',rep.obs,{rows:2})}
          </div>
        </div>
      </div>
    </div>
  </div>`;
}

const LBL = `font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;color:var(--text-secondary);`;

function field(id, label, type, value='', opts={}) {
  const base = `class="portal-field" id="${id}" style="${opts.style||''}"`;
  if (type === 'textarea') return `<div><label style="${LBL}">${label}</label>
    <textarea ${base} rows="${opts.rows||3}" placeholder="${esc(opts.placeholder||'')}">${esc(value||'')}</textarea></div>`;
  return `<div><label style="${LBL}">${label}</label>
    <input type="${type}" ${base} value="${esc(value||'')}" placeholder="${esc(opts.placeholder||'')}"></div>`;
}

function bindInfoGenerais() {
  document.querySelectorAll('.clima-input, [id^=ig-], [id^=rep-], input[name=ig-voltagem]')
    .forEach(el => el.addEventListener('input', markDirty));
}

/* ── Simple list (Bairros, Arredores) ───────────────────── */
function buildSimpleListPanel(seg, data) {
  const items = data.items || [];
  return `<div class="card" style="${CARD_STYLE}">
    <div style="${HEAD_STYLE}">
      <div>
        <h2 style="margin:0;font-size:1rem;font-weight:700;">${esc(seg.label)}</h2>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
          Cada item é um bairro/local. Texto livre.
        </div>
      </div>
      ${expiryControls(data)}
    </div>
    <div style="${BODY_STYLE}">
      <div id="simple-list-container" style="display:flex;flex-direction:column;gap:10px;">
        ${items.map((item, i) => simpleItemRow(item, i)).join('')}
      </div>
      <button id="simple-add-btn" class="btn btn-secondary btn-sm" style="margin-top:14px;">
        + Adicionar item
      </button>
    </div>
  </div>`;
}

function simpleItemRow(item, i) {
  return `<div class="simple-item" data-index="${i}"
    style="display:flex;gap:8px;align-items:flex-start;">
    <div style="flex:1;">
      <input type="text" class="simple-item-title portal-field" data-index="${i}"
        style="width:100%;margin-bottom:6px;font-weight:600;"
        placeholder="Nome do bairro / local" value="${esc(item.title||'')}">
      <textarea class="simple-item-desc portal-field" data-index="${i}"
        style="width:100%;resize:vertical;min-height:60px;" placeholder="Descrição (opcional)"
        rows="2">${esc(item.description||'')}</textarea>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;padding-top:4px;">
      <button class="simple-move-up" data-index="${i}" title="Mover acima"
        style="border:none;background:none;cursor:pointer;color:var(--text-muted);font-size:0.875rem;">↑</button>
      <button class="simple-move-down" data-index="${i}" title="Mover abaixo"
        style="border:none;background:none;cursor:pointer;color:var(--text-muted);font-size:0.875rem;">↓</button>
      <button class="simple-remove" data-index="${i}" title="Remover"
        style="border:none;background:none;cursor:pointer;color:#EF4444;font-size:0.875rem;">✕</button>
    </div>
  </div>`;
}

function bindSimpleList(key) {
  const container = document.getElementById('simple-list-container');
  document.getElementById('simple-add-btn')?.addEventListener('click', () => {
    saveCurrentSegmentData();
    segmentData[key].items.push({ title: '', description: '' });
    renderSegmentPanel(key); markDirty();
  });
  container?.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const idx = parseInt(btn.dataset.index);
    saveCurrentSegmentData();
    const items = segmentData[key].items;
    if (btn.classList.contains('simple-remove')) items.splice(idx, 1);
    else if (btn.classList.contains('simple-move-up') && idx > 0) [items[idx-1],items[idx]]=[items[idx],items[idx-1]];
    else if (btn.classList.contains('simple-move-down') && idx<items.length-1) [items[idx],items[idx+1]]=[items[idx+1],items[idx]];
    renderSegmentPanel(key); markDirty();
  });
  container?.addEventListener('input', markDirty);
}

/* ── Place list (Atrações, Restaurantes etc.) ────────────── */
function buildPlaceListPanel(seg, data) {
  const cats  = categoriesCache[seg.key] || [];
  const items = data.items || [];
  return `<div class="card" style="${CARD_STYLE}">
    <div style="${HEAD_STYLE}">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <h2 style="margin:0;font-size:1rem;font-weight:700;">${esc(seg.label)}</h2>
        <!-- 4.49.13+ Botão dedicado pra gerenciar categorias sem precisar
             adicionar um lugar primeiro. Resolve relato: "não consigo criar
             categoria". Abre modal com lista + criar + remover. -->
        <button type="button" class="btn-manage-cats" data-seg-key="${esc(seg.key)}"
          style="font-size:0.75rem;padding:4px 10px;border-radius:var(--radius-full);
          border:1px solid var(--border-subtle);background:var(--bg-card);cursor:pointer;
          color:var(--text-secondary);font-family:inherit;">
          🏷 Categorias (${cats.length})
        </button>
      </div>
      ${expiryControls(data)}
    </div>
    <div style="${BODY_STYLE}">
      <!-- Theme description -->
      <div style="margin-bottom:16px;">
        <label style="${LBL}">Descrição do tema <span style="font-weight:400;color:var(--text-muted);">(opcional)</span></label>
        <textarea id="place-theme-desc" class="portal-field" style="width:100%;resize:vertical;" rows="2"
          placeholder="Texto introdutório sobre este segmento neste destino…"
        >${esc(data.themeDesc||'')}</textarea>
      </div>
      <!-- Items -->
      <div id="place-list-container" style="display:flex;flex-direction:column;gap:16px;">
        ${items.map((item,i) => placeItemBlock(item, i, cats, seg.mode === 'agenda')).join('')}
      </div>
      <button id="place-add-btn" class="btn btn-secondary btn-sm" style="margin-top:16px;">
        + Adicionar item
      </button>
    </div>
  </div>`;
}

function buildAgendaPanel(seg, data) {
  const cats = categoriesCache[seg.key] || [];
  const items = data.items || [];
  return `<div class="card" style="${CARD_STYLE}">
    <div style="${HEAD_STYLE}">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
        <h2 style="margin:0;font-size:1rem;font-weight:700;">${esc(seg.label)}</h2>
        <button type="button" class="btn-manage-cats" data-seg-key="${esc(seg.key)}"
          style="font-size:0.75rem;padding:4px 10px;border-radius:var(--radius-full);
          border:1px solid var(--border-subtle);background:var(--bg-card);cursor:pointer;
          color:var(--text-secondary);font-family:inherit;">
          🏷 Categorias (${cats.length})
        </button>
      </div>
      ${expiryControls(data)}
    </div>
    <div style="${BODY_STYLE}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div>
          <label style="${LBL}">Período da agenda</label>
          <input type="text" id="agenda-periodo" class="portal-field" style="width:100%;"
            placeholder="Ex: Janeiro a Março 2026" value="${esc(data.periodoAgenda||'')}">
        </div>
        <div>
          ${field('agenda-dica','Dica geral','textarea',data.dica,{rows:2})}
        </div>
        <div style="grid-column:1/-1;">
          <label style="${LBL}">Descrição do tema</label>
          <textarea id="place-theme-desc" class="portal-field" style="width:100%;resize:vertical;" rows="2"
            placeholder="Introdução sobre a agenda cultural do destino…"
          >${esc(data.themeDesc||'')}</textarea>
        </div>
      </div>
      <div id="place-list-container" style="display:flex;flex-direction:column;gap:16px;">
        ${items.map((item,i) => placeItemBlock(item, i, cats, true)).join('')}
      </div>
      <button id="place-add-btn" class="btn btn-secondary btn-sm" style="margin-top:16px;">
        + Adicionar evento
      </button>
    </div>
  </div>`;
}

function placeItemBlock(item, i, cats, isAgenda) {
  return `<div class="place-item" data-index="${i}"
    style="border:1px solid var(--border-subtle);border-radius:var(--radius-md);
    padding:16px;background:var(--bg-card);position:relative;">

    <div style="position:absolute;top:10px;right:10px;display:flex;gap:4px;">
      <button class="place-move-up" data-index="${i}" style="border:none;background:none;cursor:pointer;color:var(--text-muted);padding:3px 6px;">↑</button>
      <button class="place-move-down" data-index="${i}" style="border:none;background:none;cursor:pointer;color:var(--text-muted);padding:3px 6px;">↓</button>
      <button class="place-remove" data-index="${i}" style="border:none;background:none;cursor:pointer;color:#EF4444;padding:3px 6px;">✕</button>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-right:90px;margin-bottom:10px;">
      <div>
        <label style="${LBL}">Categoria</label>
        ${/* 4.40.17+ Última opção "+ Nova categoria…" abre prompt e persiste em
              portal_categories/{segmentKey}. Categoria nova fica disponível
              imediatamente no dropdown E em todos os exports (docx/pdf/pptx/web)
              porque eles leem item.categoria como texto livre. */ ''}
        <select class="place-cat filter-select" data-index="${i}" style="width:100%;">
          <option value="">Selecione</option>
          ${cats.map(c=>`<option value="${esc(c)}" ${item.categoria===c?'selected':''}>${esc(c)}</option>`).join('')}
          <option value="${esc(item.categoria||'')}" ${item.categoria&&!cats.includes(item.categoria)?'selected':''}
            ${!item.categoria||cats.includes(item.categoria)?'style="display:none"':''}>
            ${esc(item.categoria||'')}
          </option>
          <option value="__add_new__" style="color:var(--brand-gold);font-weight:600;">+ Nova categoria…</option>
        </select>
      </div>
      <div>
        <label style="${LBL}">Título / Nome *</label>
        <input type="text" class="place-title portal-field" data-index="${i}"
          style="width:100%;font-weight:600;" placeholder="Nome do local"
          value="${esc(item.titulo||'')}">
      </div>
    </div>

    <div style="margin-bottom:10px;">
      <label style="${LBL}">Descrição</label>
      <textarea class="place-desc portal-field" data-index="${i}"
        style="width:100%;resize:vertical;" rows="3"
        placeholder="Descrição do local…">${esc(item.descricao||'')}</textarea>
    </div>

    ${isAgenda ? `
    <div style="margin-bottom:10px;">
      <label style="${LBL}">Período do evento</label>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="text" class="place-periodo portal-field" data-index="${i}"
          style="flex:1;" placeholder="Ex: 10 a 20 de março de 2026"
          value="${esc(item.periodo||'')}">
        <label style="display:flex;align-items:center;gap:6px;font-size:0.8125rem;white-space:nowrap;">
          <input type="checkbox" class="place-indeterminado" data-index="${i}"
            ${item.periodoIndeterminado?'checked':''}
            style="accent-color:var(--brand-gold);">
          Tempo indeterminado
        </label>
      </div>
    </div>` : ''}

    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
      <div>
        <label style="${LBL}">Endereço</label>
        <input type="text" class="place-endereco portal-field" data-index="${i}"
          style="width:100%;" value="${esc(item.endereco||'')}">
      </div>
      <div>
        <label style="${LBL}">Telefone</label>
        <input type="text" class="place-telefone portal-field" data-index="${i}"
          style="width:100%;" value="${esc(item.telefone||'')}">
      </div>
      <div>
        <label style="${LBL}">Site</label>
        <input type="url" class="place-site portal-field" data-index="${i}"
          style="width:100%;" placeholder="https://" value="${esc(item.site||'')}">
      </div>
      <div style="grid-column:1/-1;">
        <label style="${LBL}">Observações</label>
        <input type="text" class="place-obs portal-field" data-index="${i}"
          style="width:100%;" value="${esc(item.observacoes||'')}">
      </div>
    </div>
  </div>`;
}

function bindPlaceList(key, isAgenda = false) {
  const container = document.getElementById('place-list-container');
  document.getElementById('place-add-btn')?.addEventListener('click', () => {
    saveCurrentSegmentData();
    segmentData[key].items.push({
      categoria:'', titulo:'', descricao:'', endereco:'', telefone:'', site:'', observacoes:'',
      ...(isAgenda ? { periodo:'', periodoIndeterminado: false } : {}),
    });
    renderSegmentPanel(key); markDirty();
  });

  // 4.49.13+ Botão "🏷 Categorias" no header — abre modal gerenciar
  document.querySelector('.btn-manage-cats')?.addEventListener('click', () =>
    openCategoriesModal(key));

  // 4.40.17+ Handler do "+ Nova categoria…" inline. Quando user seleciona,
  // pede nome via prompt, persiste em portal_categories/{key} e re-renderiza
  // o painel com a nova categoria pre-selecionada no item.
  container?.addEventListener('change', async (e) => {
    const sel = e.target.closest('.place-cat');
    if (!sel || sel.value !== '__add_new__') return;
    const idx = parseInt(sel.dataset.index);
    // Reverte seleção visual enquanto pedimos o nome (evita ficar com __add_new__)
    sel.value = segmentData[key]?.items?.[idx]?.categoria || '';

    const seg = _allSegments.find(s => s.key === key);
    const segLabel = seg?.label || key;
    const name = (prompt(`Nova categoria em "${segLabel}":\n\nDigite o nome da categoria (ex: Especiarias, Pet-friendly, …):`) || '').trim();
    if (!name) return;

    // Verifica se já existe (case-insensitive) — evita duplicatas
    const current = categoriesCache[key] || [];
    const dup = current.find(c => c.toLowerCase() === name.toLowerCase());
    if (dup) {
      // Já existe — usa essa
      saveCurrentSegmentData();
      segmentData[key].items[idx].categoria = dup;
      renderSegmentPanel(key); markDirty();
      toast.info(`Categoria "${dup}" já existia — usando essa.`);
      return;
    }

    // Persiste no Firestore + atualiza cache local
    try {
      const updated = [...current, name];
      await saveCategories(key, updated);
      categoriesCache[key] = updated;
      // Pre-seleciona no item
      saveCurrentSegmentData();
      segmentData[key].items[idx].categoria = name;
      renderSegmentPanel(key); markDirty();
      toast.success(`Categoria "${name}" criada em ${segLabel}.`);
    } catch (err) {
      toast.error(`Erro ao criar categoria: ${err.message || err}`);
    }
  });

  container?.addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const idx   = parseInt(btn.dataset.index);
    saveCurrentSegmentData();
    const items = segmentData[key].items;
    if (btn.classList.contains('place-remove')) items.splice(idx, 1);
    else if (btn.classList.contains('place-move-up') && idx>0) [items[idx-1],items[idx]]=[items[idx],items[idx-1]];
    else if (btn.classList.contains('place-move-down') && idx<items.length-1) [items[idx],items[idx+1]]=[items[idx+1],items[idx]];
    renderSegmentPanel(key); markDirty();
  });
  container?.addEventListener('input', markDirty);
  document.getElementById('place-theme-desc')?.addEventListener('input', markDirty);
  if (isAgenda) {
    document.getElementById('agenda-periodo')?.addEventListener('input', markDirty);
    document.getElementById('agenda-dica')?.addEventListener('input', markDirty);
  }
}

/* ─── Read DOM → segmentData ──────────────────────────────── */
function saveCurrentSegmentData() {
  if (!activeSegKey) return;
  const seg  = _allSegments.find(s => s.key === activeSegKey);
  const data = segmentData[activeSegKey] || emptySegData(seg);
  data.hasExpiry  = chk('seg-has-expiry');
  data.expiryDate = inp('seg-expiry-date');

  if (seg.mode === 'special_info') {
    const clima = {};
    document.querySelectorAll('.clima-input').forEach(el => {
      clima[`${el.dataset.type}_${el.dataset.month}`] = el.value ? Number(el.value) : null;
    });
    data.info = {
      descricao:  inp('ig-descricao'),
      dica:       inp('ig-dica'),
      populacao:  inp('ig-populacao'),
      moeda:      inp('ig-moeda'),
      lingua:     inp('ig-lingua'),
      religiao:   inp('ig-religiao'),
      fusoSinal:  inp('ig-fuso-sinal','+'),
      fusoHoras:  inp('ig-fuso-horas'),
      voltagem:   document.querySelector('input[name=ig-voltagem]:checked')?.value || '',
      ddd:        inp('ig-ddd'),
      clima,
      representacao: {
        nome:     inp('rep-nome'),
        endereco: inp('rep-endereco'),
        telefone: inp('rep-telefone'),
        link:     inp('rep-link'),
        obs:      inp('rep-obs'),
      },
    };
  } else if (seg.mode === 'simple_list') {
    data.items = [...document.querySelectorAll('.simple-item')].map(el => ({
      title:       el.querySelector('.simple-item-title')?.value || '',
      description: el.querySelector('.simple-item-desc')?.value  || '',
    })).filter(i => i.title || i.description);
  } else {
    data.themeDesc = inp('place-theme-desc');
    if (seg.mode === 'agenda') {
      data.periodoAgenda = inp('agenda-periodo');
      data.dica          = inp('agenda-dica');
    }
    data.items = [...document.querySelectorAll('.place-item')].map(el => {
      const idx = parseInt(el.dataset.index);
      return {
        categoria:          el.querySelector('.place-cat')?.value     || '',
        titulo:             el.querySelector('.place-title')?.value   || '',
        descricao:          el.querySelector('.place-desc')?.value    || '',
        endereco:           el.querySelector('.place-endereco')?.value|| '',
        telefone:           el.querySelector('.place-telefone')?.value|| '',
        site:               el.querySelector('.place-site')?.value    || '',
        observacoes:        el.querySelector('.place-obs')?.value     || '',
        ...(seg.mode === 'agenda' ? {
          periodo:            el.querySelector('.place-periodo')?.value || '',
          periodoIndeterminado: el.querySelector('.place-indeterminado')?.checked || false,
        } : {}),
      };
    }).filter(i => i.titulo);
  }

  segmentData[activeSegKey] = data;
}

function saveCurrentSegment() {
  saveCurrentSegmentData();
  renderExpiryOverview();
}

/* ─── Expiry overview ─────────────────────────────────────── */
function renderExpiryOverview() {
  const el = document.getElementById('expiry-overview');
  if (!el) return;
  const withExp = _allSegments.filter(s => segmentData[s.key]?.hasExpiry && segmentData[s.key]?.expiryDate);
  if (!withExp.length) {
    el.innerHTML = `<div style="font-size:0.75rem;color:var(--text-muted);">Nenhuma validade definida.</div>`;
    return;
  }
  el.innerHTML = withExp.map(s => {
    const d       = segmentData[s.key];
    const exp     = new Date(d.expiryDate);
    const expired = exp < new Date();
    const days    = Math.ceil((exp - new Date()) / 86400000);
    return `<div style="display:flex;justify-content:space-between;font-size:0.75rem;">
      <span style="color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px;">${esc(s.label)}</span>
      <span style="color:${expired?'#EF4444':days<=30?'#F59E0B':'#22C55E'};font-weight:600;flex-shrink:0;">
        ${expired ? '✕ Vencido' : days+'d'}
      </span>
    </div>`;
  }).join('');
}

/* ─── Save ────────────────────────────────────────────────── */
async function saveDraft() {
  if (!currentDestId) { toast.error('Nenhum destino selecionado.'); return; }
  saveCurrentSegment();
  const btn    = document.getElementById('editor-save-btn');
  const status = document.getElementById('editor-save-status');
  if (btn)    { btn.disabled = true; btn.textContent = 'Salvando…'; }
  if (status) status.textContent = 'Salvando…';
  try {
    const segments = {};
    for (const seg of _allSegments) {
      const data = segmentData[seg.key];
      if (segHasContent(seg.key) || data?.hasExpiry) segments[seg.key] = data;
    }
    const priority = document.getElementById('editor-priority')?.checked || false;
    // 4.49.13+ Inclui observações internas no save (campo separado, não-exportável)
    const internalNotes = document.getElementById('editor-internal-notes')?.value?.trim() || '';
    const tipId = await saveTip(currentTip?.id || null, {
      destinationId: currentDestId,
      continent:     currentDestInfo?.continent || '',
      country:       currentDestInfo?.country   || '',
      city:          currentDestInfo?.city       || '',
      priority,
      internalNotes,
      segments,
    }, {
      // v4.57.40 PD5: conflict detection — passa timestamp do snapshot atual
      // pra saveTip detectar se outro user salvou no meio do caminho.
      expectedUpdatedAt: currentTip?._loadedAt || null,
    });
    if (!currentTip) currentTip = { id: tipId };
    currentTip._loadedAt = Date.now();  // atualiza marca após save bem-sucedido
    isDirty = false;
    const now = new Intl.DateTimeFormat('pt-BR',{ day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date());
    if (status) status.textContent = `Salvo às ${now}`;
    toast.success('Dica salva.');
    renderSegmentNav();
  } catch(e) {
    // v4.57.40 PD5: trata CONFLICT distinto de erro genérico.
    if (e?.code === 'CONFLICT') {
      if (status) status.textContent = 'Conflito — outro user editou';
      try {
        const { default: modal } = await import('../components/modal.js');
        const reload = await modal.confirm({
          title: 'Dica foi modificada',
          message: 'Outro usuário (ou outra aba) salvou esta dica depois que você abriu. ' +
                   'Suas mudanças locais ainda não foram salvas.<br><br>' +
                   '<strong>Recarregar</strong> descarta suas mudanças e mostra a versão atualizada.<br>' +
                   '<strong>Cancelar</strong> mantém suas mudanças (próximo save vai falhar até recarregar).',
          confirmText: 'Recarregar (descartar mudanças)',
          danger: true, icon: '⚠',
        });
        if (reload) location.reload();
      } catch (_) {
        if (confirm('Dica foi modificada por outro usuário. Recarregar?')) location.reload();
      }
    } else {
      toast.error('Erro ao salvar: ' + e.message);
      if (status) status.textContent = 'Erro ao salvar.';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar Dica'; }
  }
}

/* ─── 4.49.13+ Modal "Gerenciar categorias" ─────────────────
 * Resolve relato: "não consigo criar categoria". Antes, criar categoria
 * só era possível via dropdown DENTRO de um lugar já adicionado. Agora:
 * botão dedicado no header do segmento que abre modal com lista + criar
 * + remover, sem precisar criar um lugar primeiro.
 */
async function openCategoriesModal(segKey) {
  const seg = _allSegments.find(s => s.key === segKey);
  if (!seg) return;
  const { modal } = await import('../components/modal.js');
  const refresh = () => categoriesCache[segKey] || [];

  const render = () => {
    const cats = refresh();
    return `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="font-size:0.8125rem;color:var(--text-secondary);">
          Categorias usadas em <strong>${esc(seg.label)}</strong>.
          São compartilhadas entre todas as dicas que usam este segmento.
        </div>
        <div id="cats-list" style="display:flex;flex-direction:column;gap:6px;
          max-height:300px;overflow-y:auto;padding:4px;
          border:1px solid var(--border-subtle);border-radius:8px;">
          ${cats.length === 0
            ? `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:0.8125rem;">
                Nenhuma categoria ainda. Crie a primeira abaixo.
              </div>`
            : cats.map(c => `
              <div style="display:flex;align-items:center;justify-content:space-between;
                padding:8px 12px;background:var(--bg-surface);border-radius:6px;font-size:0.875rem;">
                <span>🏷 ${esc(c)}</span>
                <button class="cat-remove-btn" data-cat="${esc(c)}" type="button"
                  style="background:none;border:none;color:var(--color-danger);
                  cursor:pointer;padding:2px 8px;font-size:0.75rem;font-family:inherit;">
                  Remover
                </button>
              </div>
            `).join('')}
        </div>
        <div style="display:flex;gap:8px;align-items:stretch;">
          <input type="text" id="cat-new-name" class="portal-field"
            placeholder="Nome da nova categoria (ex: Vegetariano, Romântico…)"
            style="flex:1;" maxlength="50">
          <button id="cat-add-btn" type="button" class="btn btn-primary btn-sm">
            + Criar
          </button>
        </div>
      </div>`;
  };

  const ref = modal.open({
    dedupeKey: 'cats-mgr-' + segKey,
    title: `🏷 Gerenciar categorias — ${seg.label}`,
    size: 'md',
    closeOnEsc: true,
    content: render(),
    footer: [{ label: 'Fechar', class: 'btn-secondary', closeOnClick: true }],
  });

  const body = ref.getBody();
  const rerender = () => { body.innerHTML = render(); wire(); };

  function wire() {
    const newInput = body.querySelector('#cat-new-name');
    const addBtn   = body.querySelector('#cat-add-btn');
    addBtn?.addEventListener('click', async () => {
      const name = (newInput?.value || '').trim();
      if (!name) { toast.warning('Digite um nome.'); return; }
      const current = refresh();
      if (current.some(c => c.toLowerCase() === name.toLowerCase())) {
        toast.info(`"${name}" já existe.`); return;
      }
      addBtn.disabled = true; addBtn.textContent = '…';
      try {
        const updated = [...current, name];
        await saveCategories(segKey, updated);
        categoriesCache[segKey] = updated;
        toast.success(`Categoria "${name}" criada.`);
        rerender();
        // Atualiza o painel principal pra refletir nova contagem
        if (activeSegKey === segKey) renderSegmentPanel(segKey);
      } catch (err) {
        toast.error('Erro: ' + (err.message || err));
        addBtn.disabled = false; addBtn.textContent = '+ Criar';
      }
    });
    newInput?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addBtn?.click(); }
    });
    body.querySelectorAll('.cat-remove-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const cat = btn.dataset.cat;
        if (!confirm(`Remover categoria "${cat}"?\n\nItens que usam essa categoria perdem o vínculo (texto livre permanece).`)) return;
        try {
          const updated = refresh().filter(c => c !== cat);
          await saveCategories(segKey, updated);
          categoriesCache[segKey] = updated;
          toast.success(`Categoria "${cat}" removida.`);
          rerender();
          if (activeSegKey === segKey) renderSegmentPanel(segKey);
        } catch (err) {
          toast.error('Erro: ' + (err.message || err));
        }
      });
    });
  }
  wire();
}

/* ─── Helpers ─────────────────────────────────────────────── */
function segHasContent(key) {
  const d = segmentData[key];
  if (!d) return false;
  if (d.info) return Object.values(d.info).some(v => v && String(v).trim() && v !== '{}');
  if (typeof d.content === 'string' && d.content.trim()) return true;
  // 4.49.13+ Bug fix: themeDesc (texto introdutório do segmento) E periodoAgenda
  // contam como conteúdo. Antes: segmento com APENAS texto contextual (sem items)
  // era descartado no save — user reportou que "alguns segmentos são apenas texto
  // sem atração/categoria e sistema não considera".
  if (typeof d.themeDesc === 'string' && d.themeDesc.trim()) return true;
  if (typeof d.periodoAgenda === 'string' && d.periodoAgenda.trim()) return true;
  if (Array.isArray(d.items) && d.items.length > 0) return true;
  return false;
}

function isExpiredSeg(key) {
  const d = segmentData[key];
  return d?.hasExpiry && d?.expiryDate && new Date(d.expiryDate) < new Date();
}

function markDirty() {
  isDirty = true;
  const status = document.getElementById('editor-save-status');
  if (status && !status.textContent.includes('…')) status.textContent = 'Alterações não salvas';
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => { if (isDirty && currentDestId) saveDraft(); }, 4000);
}

function fmt(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR').format(d);
}

/* ─── IA: Sugestão para segmentos vencidos ────────────────── */

function _showSegmentAiSuggestion(result) {
  // Remove container anterior
  document.getElementById('ai-seg-suggestion')?.remove();

  const escHtml = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const container = document.createElement('div');
  container.id = 'ai-seg-suggestion';
  container.style.cssText = `margin:16px 0;border:1px solid rgba(212,168,67,0.3);border-radius:10px;
    background:rgba(212,168,67,0.04);overflow:hidden;`;

  const sourcesHtml = result.sources?.length
    ? result.sources.slice(0, 3).map(s =>
      `<a href="${escHtml(s.url)}" target="_blank" rel="noopener" style="color:var(--brand-gold);font-size:0.6875rem;text-decoration:none;">
        ${escHtml(s.source)}</a>`
    ).join(' · ')
    : '';

  container.innerHTML = `
    <div style="padding:10px 14px;background:rgba(212,168,67,0.08);border-bottom:1px solid rgba(212,168,67,0.2);
      display:flex;align-items:center;gap:8px;">
      <span>◈</span>
      <span style="font-size:0.8125rem;font-weight:600;flex:1;">Sugestão de IA — ${escHtml(result.segmentLabel)}</span>
      <span style="font-size:0.625rem;color:var(--text-muted);">${escHtml(result.provider)}/${escHtml(result.model)}</span>
      <button class="ai-seg-close" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:0.875rem;">✕</button>
    </div>
    <div style="padding:14px;">
      <pre style="white-space:pre-wrap;word-wrap:break-word;font-family:inherit;font-size:0.8125rem;
        line-height:1.6;color:var(--text-primary);margin:0;">${escHtml(result.suggestion)}</pre>

      <div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:6px;padding:8px 10px;
        margin-top:10px;font-size:0.6875rem;color:#92400E;">
        ⚠ <strong>Conteúdo gerado por IA</strong> — verifique antes de publicar.
        ${sourcesHtml ? `<br>Fontes: ${sourcesHtml}` : ''}
      </div>
    </div>
  `;

  // Inserir no topo do painel do segmento
  const segPanel = document.getElementById('segment-editor-panel');
  if (segPanel) {
    segPanel.insertBefore(container, segPanel.firstChild);
  } else {
    document.getElementById('editor-main')?.prepend(container);
  }

  container.querySelector('.ai-seg-close')?.addEventListener('click', () => container.remove());
}

function _checkPendingAiSuggestion() {
  try {
    const raw = sessionStorage.getItem('ai-suggestion');
    if (!raw) return;
    const data = JSON.parse(raw);
    // Verificar se é para este tip
    if (data.tipId !== currentTip?.id) return;
    // Verificar se o segmento corresponde
    if (data.segmentKey && data.segmentKey !== activeSegKey) return;
    // Verificar se não é muito antigo (mais de 5 min)
    if (Date.now() - new Date(data.appliedAt).getTime() > 300_000) {
      sessionStorage.removeItem('ai-suggestion');
      return;
    }

    // Mostrar sugestão
    _showSegmentAiSuggestion({
      suggestion: data.suggestion,
      sources: [],
      segmentLabel: _allSegments.find(s => s.key === data.segmentKey)?.label || data.segmentKey,
      provider: 'cache',
      model: 'sessão anterior',
    });

    sessionStorage.removeItem('ai-suggestion');
  } catch { /* ignore */ }
}
