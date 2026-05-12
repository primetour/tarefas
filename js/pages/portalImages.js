/**
 * PRIMETOUR — Portal de Dicas: Banco de Imagens (Camadas 2 + 3)
 * Upload → conversão .webp → R2 | Galeria hierárquica | Tags | Edição | Lightbox
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import {
  fetchImages, fetchImagesPage,
  saveImageMeta, updateImageMeta, deleteImageMeta,
  convertToWebp, uploadImageToR2, fetchDestinations,
  R2_PUBLIC_URL, CONTINENTS, ASSET_CATEGORIES,
} from '../services/portal.js';

// 4.35.31+ validações client-side
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;  // 10 MB
const ACCEPTED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const IMAGE_TYPES = [
  {
    key:   'destaque',
    label: 'Destaque',
    desc:  'Foto principal do destino. Usada como hero (capa) nos materiais gerados — link web, PDF e PPTX.',
    icon:  '★',
  },
  {
    key:   'galeria',
    label: 'Galeria',
    desc:  'Fotos gerais do destino. Usadas nos cards de lugares nos materiais. Quanto mais, melhor a cobertura.',
    icon:  '▦',
  },
  {
    key:   'banner',
    label: 'Banner',
    desc:  'Imagem horizontal para cabeçalhos de seção. Fallback para Destaque quando não há foto principal.',
    icon:  '▬',
  },
  {
    key:   'logo_area',
    label: 'Logo de Área',
    desc:  'Logotipo da área (ex: BTG Partners, Centurion). Exibido no header dos materiais e do link web.',
    icon:  '◈',
  },
];

// Tags sugeridas para o Portal de Dicas — aparecem como chips clicáveis no upload
const PORTAL_TAGS = [
  'atrações', 'restaurante', 'hotel', 'compras', 'vida noturna',
  'espetáculos', 'museu', 'parque', 'praia', 'natureza',
  'gastronomia', 'cultura', 'esporte', 'crianças', 'transporte',
  'panorâmica', 'noturna', 'principal', 'destaque', 'bairro',
];

let allImages   = [];
let allDests    = [];
let navContinent = '';
let navCountry   = '';
let navCity      = '';
let viewMode     = 'grid';   // 'grid' | 'list'
let searchStr    = '';
let lightboxIdx  = -1;
// 4.35.32+ Filtros avançados + paginação cursor
let _filterCategory = '';
let _filterType     = '';
let _filterUploader = '';
let _filterDate     = '';   // '' | '7d' | '30d' | '90d' | 'year'
let _pageCursor     = null; // último doc da página anterior (pra cursor)
let _hasMore        = false;

export async function renderPortalImages(container) {
  // 4.35.31+ Hierarquia: usa portal_images_manage (novo) ou portal_manage (legacy).
  // Diretoria/admin: liberado. Demais roles: bloqueado.
  if (!store.canManagePortalImages()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
      <p style="font-size:0.875rem;color:var(--text-muted);max-width:480px;margin:8px auto 0;">
        O Banco de Imagens é restrito à <strong>Diretoria</strong> e administradores.
        Para liberar upload, edição ou exclusão a outros usuários, ative
        <code>portal_images_manage</code> em /users → Permissões.
      </p>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Banco de Imagens</h1>
        <p class="page-subtitle">Imagens convertidas para .webp e armazenadas no Cloudflare R2</p>
      </div>
      <div class="page-header-actions" style="gap:8px;">
        <button class="btn btn-secondary btn-sm" id="img-view-toggle" title="Alternar visualização">▦</button>
        ${/* 4.40.5+ Atalho pro módulo de cadastro de destinos (mesmo padrão
              já existente no Portal de Dicas, agora acessível também daqui) */ ''}
        <button class="btn btn-secondary btn-sm" id="img-dests-shortcut"
          title="Cadastrar destinos (continentes, países, cidades)">
          🌍 Cadastrar destinos
        </button>
        <button class="btn btn-primary btn-sm" id="img-upload-toggle">↑ Upload</button>
      </div>
    </div>

    <!-- Upload panel (collapsed by default) -->
    <div id="img-upload-panel" style="display:none;margin-bottom:20px;">
      ${uploadPanelHtml()}
    </div>

    <!-- 4.35.34+ Navegação primária por categoria (pills com contadores) -->
    <div id="img-category-nav" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px;
      padding-bottom:12px;border-bottom:1px solid var(--border-subtle);"></div>

    <!-- 4.40.5+ Busca + toggle filtros (filtros agora default ABERTO) -->
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
      <div style="position:relative;flex:1;max-width:320px;">
        <input type="text" id="img-search" placeholder="Buscar por nome ou tag…"
          class="portal-field" style="width:100%;padding-left:28px;font-size:0.8125rem;">
        <span style="position:absolute;left:9px;top:50%;transform:translateY(-50%);
          color:var(--text-muted);font-size:0.8125rem;">🔍</span>
      </div>
      <button class="btn btn-ghost btn-sm" id="img-filters-toggle"
        style="font-size:0.75rem;" title="Mostrar/ocultar filtros avançados">
        ⚙ Filtros
      </button>
      <span id="img-count" style="font-size:0.8125rem;color:var(--text-muted);white-space:nowrap;margin-left:auto;"></span>
    </div>

    <!-- 4.35.32+ Barra de filtros (categoria/uploader/data + continente/país/cidade) -->
    <!-- 4.40.5+ Default ABERTO. Localização (continente/país/cidade) movida pra cá. -->
    <div id="img-filters-bar" style="display:block;margin-bottom:16px;padding:12px 16px;
      background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-md);">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="font-size:0.7rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Quem subiu:</span>
          <select id="img-filter-uploader" class="filter-select" style="font-size:0.75rem;min-width:160px;">
            <option value="">Qualquer um</option>
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="font-size:0.7rem;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Data:</span>
          <select id="img-filter-date" class="filter-select" style="font-size:0.75rem;min-width:140px;">
            <option value="">Qualquer</option>
            <option value="7d">Últimos 7 dias</option>
            <option value="30d">Últimos 30 dias</option>
            <option value="90d">Últimos 90 dias</option>
            <option value="year">Este ano</option>
          </select>
        </div>
        <button class="btn btn-ghost btn-sm" id="img-filters-clear"
          style="margin-left:auto;font-size:0.7rem;color:var(--text-muted);">
          ↻ Limpar
        </button>
      </div>
      ${/* 4.40.5+ Drill-down de localização agora vive aqui (antes era breadcrumb solto acima) */ ''}
      <div id="img-loc-filter" style="padding-top:10px;border-top:1px dashed var(--border-subtle);
        display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:0.8125rem;min-height:28px;"></div>
    </div>

    <!-- Gallery -->
    <div id="img-gallery">
      ${skeletonGrid()}
    </div>

    <!-- 4.35.32+ "Carregar mais" footer (aparece quando hasMore=true) -->
    <div id="img-load-more-wrap" style="display:none;text-align:center;margin:24px 0;">
      <button class="btn btn-secondary" id="img-load-more"
        style="font-size:0.8125rem;padding:8px 24px;">
        ↓ Carregar mais imagens
      </button>
    </div>

    <!-- Lightbox (hidden) -->
    <div id="img-lightbox" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.92);
      z-index:3000;align-items:center;justify-content:center;flex-direction:column;">
    </div>
  `;

  // Upload toggle
  document.getElementById('img-upload-toggle')?.addEventListener('click', () => {
    const p = document.getElementById('img-upload-panel');
    if (p) p.style.display = p.style.display === 'none' ? 'block' : 'none';
  });

  // View mode toggle
  document.getElementById('img-view-toggle')?.addEventListener('click', () => {
    viewMode = viewMode === 'grid' ? 'list' : 'grid';
    document.getElementById('img-view-toggle').textContent = viewMode === 'grid' ? '▦' : '☰';
    renderGallery();
  });

  // Search
  document.getElementById('img-search')?.addEventListener('input', e => {
    searchStr = e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    renderGallery();
  });

  // 4.35.32+ Filtros avan\u00e7ados \u2014 4.40.5+ default open, sem categoria/tipo
  // (categoria vem das pills do topo; tipo foi removido \u2014 tratado em /dicas).
  document.getElementById('img-filters-toggle')?.addEventListener('click', () => {
    const bar = document.getElementById('img-filters-bar');
    if (bar) bar.style.display = bar.style.display === 'none' ? 'block' : 'none';
  });
  // 4.40.5+ Removidos handlers de img-filter-category e img-filter-type:
  // - categoria: agora navegada pelas pills do topo (renderCategoryNav)
  // - tipo: campo removido — tratado em /dicas e /roteiros conforme uso
  document.getElementById('img-filter-uploader')?.addEventListener('change', e => {
    _filterUploader = e.target.value; _categoryCounts = null; loadImages({ reset: true });
  });
  document.getElementById('img-filter-date')?.addEventListener('change', e => {
    _filterDate = e.target.value; _categoryCounts = null; loadImages({ reset: true });
  });
  document.getElementById('img-filters-clear')?.addEventListener('click', () => {
    _filterUploader = _filterDate = '';
    navContinent = ''; navCountry = ''; navCity = '';
    _categoryCounts = null;
    ['img-filter-uploader','img-filter-date']
      .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    loadImages({ reset: true });
  });
  // 4.40.5+ Atalho pro módulo de cadastro de destinos
  document.getElementById('img-dests-shortcut')?.addEventListener('click', () => {
    location.hash = 'portal-destinations';
  });

  // 4.35.32+ "Carregar mais"
  document.getElementById('img-load-more')?.addEventListener('click', async () => {
    const btn = document.getElementById('img-load-more');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = '\u23f3 Carregando\u2026';
    try {
      await loadImages({ reset: false });
    } finally {
      btn.disabled = false;
      btn.textContent = '\u2193 Carregar mais imagens';
    }
  });

  // Upload panel wiring
  wireUploadPanel();

  // Keyboard lightbox navigation
  document.addEventListener('keydown', handleLightboxKey);

  allDests = await fetchDestinations();
  await loadImages();
}

/* ── Upload panel ── */
function uploadPanelHtml() {
  // 4.40.6+ overflow:visible em vez de hidden — overflow:hidden no .card cria
  // containing block pra position:sticky, fazendo o action bar SUMIR quando
  // o user scrolla pra baixo (a sticky stops sticking quando o pai sai da view).
  // Visual: corners do card seguem arredondados via border-radius nas crianças.
  return `
    <div class="card" style="padding:0;overflow:visible;border-radius:var(--radius-lg);">

      <!-- Step 1: Drop zone — always visible and large -->
      <div style="padding:24px;border-bottom:1px solid var(--border-subtle);">
        <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.07em;color:var(--text-muted);margin-bottom:14px;">
          1 · Selecione as imagens
        </div>
        <div id="img-dropzone"
          style="border:2px dashed var(--border-subtle);border-radius:var(--radius-md);
          padding:40px 24px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s;">
          <div style="font-size:2.5rem;margin-bottom:12px;">🖼</div>
          <div style="font-size:1rem;font-weight:600;margin-bottom:6px;">
            Arraste quantas imagens quiser aqui</div>
          <div style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:16px;">
            ou clique para selecionar · JPG, PNG, WEBP, HEIC · Máx 10 MB por arquivo
          </div>
          <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 20px;
            background:var(--bg-surface);border:1px solid var(--border-subtle);
            border-radius:var(--radius-sm);font-size:0.8125rem;color:var(--text-secondary);">
            ↑ Selecionar arquivos
          </div>
          <input type="file" id="img-file-input" multiple accept="image/*" style="display:none;">
        </div>
      </div>

      <!-- Step 2: Per-image metadata (appears after drop) -->
      <div id="img-batch-list" style="display:none;">
        ${/* 4.40.5+ Action bar STICKY no topo da viewport ao scroll. Botões
              'Aplicar a todas' e 'Enviar todas' ficam sempre visíveis.
              4.40.7+ top:calc(0px - var(--space-6)) cancela o padding-top
              da .page-content (24px) — antes ficava um gap branco visível
              entre o topo da viewport e a barra ao scrollar. */ ''}
        <div id="img-batch-actions" style="padding:14px 24px;background:var(--bg-surface);
          border-bottom:1px solid var(--border-subtle);
          display:flex;align-items:center;justify-content:space-between;gap:12px;
          position:sticky;top:0;z-index:20;
          box-shadow:0 -24px 0 var(--bg-surface),0 2px 8px rgba(0,0,0,.18);">
          <div style="min-width:0;flex:1;">
            <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;
              letter-spacing:.07em;color:var(--text-muted);">2 · Configure cada imagem</div>
            <div style="font-size:0.8125rem;color:var(--text-muted);margin-top:2px;">
              Campos em branco herdam os valores padrão abaixo.
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">
            <button id="img-apply-defaults" class="btn btn-secondary btn-sm"
              style="white-space:nowrap;font-size:0.75rem;"
              title="Copia os valores padrão pra cada imagem da fila">
              ↓ Aplicar a todas
            </button>
            <button id="img-upload-all-btn" class="btn btn-primary btn-sm" style="white-space:nowrap;">
              ↑ Enviar todas
            </button>
          </div>
        </div>

        <!-- Default values (apply to all that don't have individual values) -->
        <div data-defaults-block style="padding:16px 24px;background:var(--brand-gold)08;
          border-bottom:1px solid var(--border-subtle);">
          <div style="font-size:0.75rem;font-weight:600;color:var(--brand-gold);margin-bottom:10px;">
            ◈ Valores padrão — aplicados a todas as imagens sem preenchimento individual
          </div>

          <!-- 4.35.31+ Categoria do asset (location | logo | hotel | cruise | train | restaurant) -->
          <div style="margin-bottom:12px;">
            <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:4px;">Categoria</label>
            <div id="def-asset-category-group" style="display:flex;gap:6px;flex-wrap:wrap;">
              ${ASSET_CATEGORIES.map((c, i) => `
                <label class="asset-cat-pill" data-cat="${c.key}" style="
                  display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:20px;
                  border:1px solid ${i===0?'var(--brand-gold)':'var(--border-subtle)'};
                  background:${i===0?'var(--brand-gold)15':'transparent'};
                  color:${i===0?'var(--brand-gold)':'var(--text-secondary)'};
                  cursor:pointer;font-size:0.75rem;transition:all .15s;">
                  <input type="radio" name="def-asset-category" value="${c.key}" ${i===0?'checked':''}
                    style="display:none;" />
                  ${c.icon} ${esc(c.label)}
                </label>
              `).join('')}
            </div>
            <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:6px;">
              💡 <strong>Destino</strong> é a categoria-mãe. Hotel/Restaurante/Trem aceitam localização opcional.
            </div>
          </div>

          <div id="def-location-fields" data-loc-wrap
            style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
            <div data-loc-cell>
              <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:4px;">Continente</label>
              <select id="def-continent" data-loc-continent class="filter-select" style="width:100%;">
                <option value="">—</option>
                ${CONTINENTS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
              </select>
            </div>
            <div data-loc-cell>
              <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:4px;">País</label>
              <select id="def-country" data-loc-country class="filter-select" style="width:100%;" disabled>
                <option value="">—</option>
              </select>
            </div>
            <div data-loc-cell>
              <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:4px;">Cidade</label>
              <select id="def-city" data-loc-city class="filter-select" style="width:100%;" disabled>
                <option value="">—</option>
              </select>
            </div>
          </div>

          <!-- 4.35.31+ Direitos autorais padrão (texto livre, aplicado a todas) -->
          <div style="margin-top:12px;">
            <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:4px;">
              Direitos autorais (opcional)
            </label>
            <input type="text" id="def-copyright" class="portal-field" style="width:100%;font-size:0.8125rem;"
              placeholder="Ex: © Unsplash — João Silva · © 2024 Hotel Copacabana Palace">
          </div>
        </div>

        <!-- Per-image rows (injected by JS) -->
        <div id="img-item-rows" style="padding:16px 24px;display:flex;flex-direction:column;gap:12px;"></div>
      </div>

      <!-- Upload progress (appears during upload) -->
      <div id="img-upload-queue" style="display:none;padding:16px 24px;"></div>
    </div>
  `;
}

function wireUploadPanel() {
  const dropzone  = document.getElementById('img-dropzone');
  const fileInput = document.getElementById('img-file-input');
  if (!dropzone) return;

  // Dropzone interactions
  dropzone.addEventListener('click', () => fileInput?.click());
  dropzone.addEventListener('dragover', e => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--brand-gold)';
    dropzone.style.background  = 'var(--brand-gold)06';
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.style.borderColor = 'var(--border-subtle)';
    dropzone.style.background  = '';
  });
  dropzone.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--border-subtle)';
    dropzone.style.background  = '';
    buildBatchList(_validateFiles([...e.dataTransfer.files]));
  });
  fileInput?.addEventListener('change', () => {
    buildBatchList(_validateFiles([...fileInput.files]));
    fileInput.value = '';
  });

  // Default values cascade
  wireCascade('def-continent', 'def-country', 'def-city');

  // 4.35.31+ Categoria do asset (pill radio)
  wireAssetCategoryPills();

  // 4.35.31+ Botão "Aplicar a todas" — propaga def-* pra cada batch row
  document.getElementById('img-apply-defaults')?.addEventListener('click', applyDefaultsToAllRows);

  // Upload all button
  document.getElementById('img-upload-all-btn')?.addEventListener('click', () => uploadBatch());
}

// 4.35.31+ Validação client-side: tamanho + mime type. Avisa o user
// sobre arquivos rejeitados em vez de silenciosamente filtrar.
function _validateFiles(files) {
  const ok = [];
  const rejected = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) { rejected.push([f.name, 'não é imagem']); continue; }
    if (!ACCEPTED_MIMES.has(f.type)) { rejected.push([f.name, `tipo ${f.type} não suportado`]); continue; }
    if (f.size > MAX_FILE_SIZE_BYTES) { rejected.push([f.name, `${(f.size/1024/1024).toFixed(1)} MB > 10 MB`]); continue; }
    ok.push(f);
  }
  if (rejected.length) {
    const lines = rejected.slice(0, 3).map(([n, why]) => `• ${n}: ${why}`).join('\n');
    const more = rejected.length > 3 ? `\n…e mais ${rejected.length - 3}` : '';
    toast.error(`${rejected.length} arquivo(s) rejeitado(s):\n${lines}${more}`);
  }
  return ok;
}

// 4.35.31+ Pills de categoria — ao trocar, esconde/mostra campos de localização.
// 4.40.5+ Agora usa showLocation ('full' | 'continent' | 'none') em vez de
// requiresLocation binário. Hotel/Restaurante mostram TUDO mas opcional;
// Trem mostra só continente; Cruzeiro/Logo escondem tudo.
function _applyLocDisplay(scope, mode) {
  // scope: elemento raiz (defaults block ou batch row). mode: 'full'|'continent'|'none'
  const wrap = scope.querySelector('[data-loc-wrap]') || scope.querySelector('#def-location-fields') || scope.querySelector('.batch-location-fields');
  if (!wrap) return;
  if (mode === 'none') {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'grid';
  // Mostra todos por default, esconde país/cidade se 'continent'
  const country = wrap.querySelector('[data-loc-country]') || wrap.querySelector('#def-country') || wrap.querySelector('.batch-country');
  const city    = wrap.querySelector('[data-loc-city]')    || wrap.querySelector('#def-city')    || wrap.querySelector('.batch-city');
  // Wraps maiores podem ter labels; subimos pro parent direto
  const hideEl = (el, hide) => {
    if (!el) return;
    const cellParent = el.closest('[data-loc-cell]') || el.parentElement;
    if (cellParent) cellParent.style.display = hide ? 'none' : '';
  };
  hideEl(country, mode === 'continent');
  hideEl(city,    mode === 'continent');
  // Ajusta colunas do grid dinamicamente
  wrap.style.gridTemplateColumns = mode === 'continent' ? '1fr' : '1fr 1fr 1fr';
}

function wireAssetCategoryPills() {
  const group = document.getElementById('def-asset-category-group');
  if (!group) return;
  group.querySelectorAll('.asset-cat-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const cat = pill.dataset.cat;
      // Marca radio + atualiza visual
      const input = pill.querySelector('input[type=radio]');
      if (input) input.checked = true;
      group.querySelectorAll('.asset-cat-pill').forEach(p => {
        const active = p.dataset.cat === cat;
        p.style.background = active ? 'var(--brand-gold)15' : 'transparent';
        p.style.borderColor = active ? 'var(--brand-gold)' : 'var(--border-subtle)';
        p.style.color = active ? 'var(--brand-gold)' : 'var(--text-secondary)';
      });
      // Esconde/mostra campos de localização nos defaults
      const defaultsBlock = document.getElementById('def-location-fields')?.closest('[data-defaults-block]') || document;
      _applyLocDisplay(defaultsBlock, _locDisplayFor(cat));
      // Aplica também aos batch rows que já existem (cada row tem sua categoria
      // própria, mas se ainda não foi selecionada individualmente, segue o default)
      document.querySelectorAll('[id^="batch-row-"]').forEach(row => {
        const rowCat = row.querySelector(`input[name^="row-asset-category-"]:checked`)?.value || cat;
        _applyLocDisplay(row, _locDisplayFor(rowCat));
      });
    });
  });
}

// 4.35.31+ Copia valores padrão pra todos os batch rows.
// 4.40.5+ Removido campo 'Tipo' — type agora é 'galeria' default (tratado no
// modal de dicas/roteiros conforme uso). 'def-copyright' segue sendo aplicado.
function applyDefaultsToAllRows() {
  const defContinent = document.getElementById('def-continent')?.value || '';
  const defCountry   = document.getElementById('def-country')?.value || '';
  const defCity      = document.getElementById('def-city')?.value || '';
  const defCopyright = document.getElementById('def-copyright')?.value || '';
  const defCategory  = document.querySelector('input[name="def-asset-category"]:checked')?.value || 'location';

  const rows = document.querySelectorAll('[id^="batch-row-"]');
  if (!rows.length) { toast.info?.('Nenhuma imagem na fila.'); return; }
  let count = 0;
  rows.forEach(row => {
    const id = row.id.replace('batch-row-','');
    const setVal = (sel, val) => {
      const el = row.querySelector(`${sel}[data-id="${id}"]`);
      if (el && val) {
        el.value = val;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    };
    if (defCategory) {
      const catInput = row.querySelector(`input[name="row-asset-category-${id}"][value="${defCategory}"]`);
      catInput?.click();
    }
    setVal('.batch-continent', defContinent);
    // País + cidade só fazem sentido após continente disparar cascade — pequeno timeout
    setTimeout(() => {
      setVal('.batch-country', defCountry);
      setTimeout(() => setVal('.batch-city', defCity), 30);
    }, 30);
    setVal('.batch-copyright', defCopyright);
    count++;
  });
  toast.success(`Valores padrão aplicados a ${count} imagem${count === 1 ? '' : 's'}.`);
}

/* ── Destination cascade helper ── */
function wireCascade(contId, countryId, cityId) {
  document.getElementById(contId)?.addEventListener('change', e => {
    const cont     = e.target.value;
    const countries = [...new Set(allDests.filter(d => !cont || d.continent === cont)
      .map(d => d.country).filter(Boolean))].sort();
    const cSel = document.getElementById(countryId);
    if (!cSel) return;
    cSel.innerHTML = `<option value="">—</option>` +
      countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    cSel.disabled = !cont;
    const citySel = document.getElementById(cityId);
    if (citySel) { citySel.innerHTML = `<option value="">—</option>`; citySel.disabled = true; }
  });
  document.getElementById(countryId)?.addEventListener('change', e => {
    const cont  = document.getElementById(contId)?.value;
    const count = e.target.value;
    const cities = [...new Set(allDests.filter(d =>
      (!cont  || d.continent === cont) &&
      (!count || d.country   === count) && d.city
    ).map(d => d.city))].sort();
    const citySel = document.getElementById(cityId);
    if (!citySel) return;
    citySel.innerHTML = `<option value="">—</option>` +
      cities.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    citySel.disabled = !count;
  });
}

/* ── Build per-image metadata rows ── */
function buildBatchList(files) {
  if (!files.length) return;
  const batchList = document.getElementById('img-batch-list');
  const itemRows  = document.getElementById('img-item-rows');
  if (!batchList || !itemRows) return;

  // Clear previous rows before building a new batch
  itemRows.innerHTML = '';
  batchList.style.display = 'block';
  files.forEach((file, i) => {
    const id  = `item-${Date.now()}-${i}`;
    const row = document.createElement('div');
    row.id    = `batch-row-${id}`;
    row.dataset.file = file.name;
    row.style.cssText = `background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:var(--radius-md);overflow:hidden;`;

    // Preview thumbnail (generated client-side)
    const thumbUrl = URL.createObjectURL(file);

    // Categoria default herdada do select global (mostra batch row em sync com pill ativa)
    const defaultCategory = document.querySelector('input[name="def-asset-category"]:checked')?.value || 'location';
    const defaultCatCfg   = ASSET_CATEGORIES.find(c => c.key === defaultCategory) || ASSET_CATEGORIES[0];

    row.innerHTML = `
      <div style="display:flex;gap:12px;padding:12px 14px;">
        <!-- Thumbnail -->
        <img class="batch-thumb" alt="Preview ${esc(file.name)}"
          style="width:72px;height:54px;object-fit:cover;border-radius:var(--radius-sm);flex-shrink:0;">

        <!-- Fields -->
        <div style="flex:1;display:flex;flex-direction:column;gap:8px;">
          <!-- Row 1: name + remove button -->
          <div style="display:flex;align-items:center;gap:8px;">
            <input type="text" class="portal-field batch-name" data-id="${id}"
              style="flex:1;font-size:0.8125rem;"
              value="${esc(file.name.replace(/\.[^.]+$/,'').replace(/[-_]/g,' '))}"
              placeholder="Nome da imagem">
            <button class="btn btn-ghost btn-sm batch-remove" data-id="${id}"
              style="font-size:0.75rem;color:var(--text-muted);flex-shrink:0;">✕</button>
          </div>

          <!-- 4.35.31+ Row 1b: Categoria do asset (radio inline) -->
          <div class="batch-asset-category-wrap" data-id="${id}" style="display:flex;gap:5px;flex-wrap:wrap;">
            ${ASSET_CATEGORIES.map(c => `
              <label class="batch-cat-pill" data-id="${id}" data-cat="${c.key}" style="
                display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:14px;
                border:1px solid ${c.key===defaultCategory?'var(--brand-gold)':'var(--border-subtle)'};
                background:${c.key===defaultCategory?'var(--brand-gold)15':'transparent'};
                color:${c.key===defaultCategory?'var(--brand-gold)':'var(--text-muted)'};
                cursor:pointer;font-size:0.6875rem;transition:all .15s;">
                <input type="radio" name="row-asset-category-${id}" value="${c.key}"
                  ${c.key===defaultCategory?'checked':''} style="display:none;" />
                ${c.icon} ${esc(c.label)}
              </label>
            `).join('')}
          </div>

          <!-- Row 2: continent / country / city (esconde/ajusta conforme categoria) -->
          <div class="batch-location-fields" data-id="${id}" data-loc-wrap
            style="display:${_locDisplayFor(defaultCategory) === 'none' ? 'none' : 'grid'};
            grid-template-columns:${_locDisplayFor(defaultCategory) === 'continent' ? '1fr' : '1fr 1fr 1fr'};gap:6px;">
            <div data-loc-cell>
              <select class="filter-select batch-continent" data-id="${id}" data-loc-continent style="font-size:0.75rem;width:100%;">
                <option value="">Continente</option>
                ${CONTINENTS.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
              </select>
            </div>
            <div data-loc-cell style="${_locDisplayFor(defaultCategory) === 'continent' ? 'display:none;' : ''}">
              <select class="filter-select batch-country" data-id="${id}" data-loc-country style="font-size:0.75rem;width:100%;" disabled>
                <option value="">País</option>
              </select>
            </div>
            <div data-loc-cell style="${_locDisplayFor(defaultCategory) === 'continent' ? 'display:none;' : ''}">
              <select class="filter-select batch-city" data-id="${id}" data-loc-city style="font-size:0.75rem;width:100%;" disabled>
                <option value="">Cidade</option>
              </select>
            </div>
          </div>

          <!-- 4.40.5+ Row 2b: descrição da foto (era 'Nome do lugar') -->
          <div>
            <input type="text" class="portal-field batch-placename" data-id="${id}"
              style="font-size:0.8125rem;width:100%;"
              placeholder="Descrição da foto — ex: Torre Eiffel ao pôr-do-sol, fachada do Hotel Copacabana Palace…">
            <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:3px;">
              💡 Quando preenchido, o sistema usa esta foto especificamente para este lugar nas dicas geradas.
            </div>
          </div>

          <!-- 4.35.31+ Row 2c: direitos autorais -->
          <div>
            <input type="text" class="portal-field batch-copyright" data-id="${id}"
              style="font-size:0.75rem;width:100%;"
              placeholder="Direitos autorais (opcional): © Fonte · Autor · Ano">
          </div>

          <!-- Row 3: tag chips + free text -->
          <div>
            <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px;">
              ${PORTAL_TAGS.map(tag => `
                <button class="tag-chip batch-tag-chip" data-id="${id}" data-tag="${esc(tag)}"
                  style="padding:2px 8px;border-radius:20px;border:1px solid var(--border-subtle);
                  background:transparent;cursor:pointer;font-size:0.6875rem;
                  color:var(--text-muted);transition:all .15s;">
                  ${esc(tag)}
                </button>`).join('')}
            </div>
            <input type="text" class="portal-field batch-tags-input" data-id="${id}"
              style="font-size:0.75rem;width:100%;"
              placeholder="Tags livres adicionais (separadas por vírgula)">
          </div>

          <!-- Status -->
          <div class="batch-status" data-id="${id}"
            style="font-size:0.75rem;color:var(--text-muted);display:none;"></div>
        </div>
      </div>
    `;

    // Store file reference
    row._file = file;
    itemRows.appendChild(row);

    // Set thumbnail src via JS (avoids inline onload scope issues)
    const thumbImg = row.querySelector('.batch-thumb');
    if (thumbImg) {
      thumbImg.onload = () => URL.revokeObjectURL(thumbImg.src);
      thumbImg.src = thumbUrl;
    }

    // Wire per-row cascade
    wireBatchCascade(row, id);

    // 4.35.31+ Per-row category pill (mostra/esconde campos de localização)
    row.querySelectorAll(`.batch-cat-pill[data-id="${id}"]`).forEach(pill => {
      pill.addEventListener('click', () => {
        const cat = pill.dataset.cat;
        const input = pill.querySelector('input[type=radio]');
        if (input) input.checked = true;
        row.querySelectorAll(`.batch-cat-pill[data-id="${id}"]`).forEach(p => {
          const active = p.dataset.cat === cat;
          p.style.background = active ? 'var(--brand-gold)15' : 'transparent';
          p.style.borderColor = active ? 'var(--brand-gold)' : 'var(--border-subtle)';
          p.style.color = active ? 'var(--brand-gold)' : 'var(--text-muted)';
        });
        // 4.40.5+ usa novo sistema showLocation (full|continent|none)
        _applyLocDisplay(row, _locDisplayFor(cat));
      });
    });

    // Wire tag chips
    row.querySelectorAll('.batch-tag-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        const active = chip.classList.contains('active');
        chip.style.background    = active ? 'var(--brand-gold)18' : 'transparent';
        chip.style.borderColor   = active ? 'var(--brand-gold)'   : 'var(--border-subtle)';
        chip.style.color         = active ? 'var(--brand-gold)'   : 'var(--text-muted)';
      });
    });

    // Wire remove button
    row.querySelector(`.batch-remove[data-id="${id}"]`)?.addEventListener('click', () => {
      row.remove();
      const remaining = document.getElementById('img-item-rows')?.querySelectorAll('[id^="batch-row-"]').length || 0;
      if (!remaining) document.getElementById('img-batch-list').style.display = 'none';
    });
  });
}

function wireBatchCascade(row, id) {
  const contSel    = row.querySelector(`.batch-continent[data-id="${id}"]`);
  const countrySel = row.querySelector(`.batch-country[data-id="${id}"]`);
  const citySel    = row.querySelector(`.batch-city[data-id="${id}"]`);

  contSel?.addEventListener('change', e => {
    const cont = e.target.value;
    const countries = [...new Set(allDests.filter(d => !cont || d.continent === cont)
      .map(d => d.country).filter(Boolean))].sort();
    countrySel.innerHTML = `<option value="">País</option>` +
      countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    countrySel.disabled = !cont;
    citySel.innerHTML = `<option value="">Cidade</option>`; citySel.disabled = true;
  });
  countrySel?.addEventListener('change', e => {
    const cont  = contSel?.value;
    const count = e.target.value;
    const cities = [...new Set(allDests.filter(d =>
      (!cont || d.continent === cont) && (!count || d.country === count) && d.city
    ).map(d => d.city))].sort();
    citySel.innerHTML = `<option value="">Cidade</option>` +
      cities.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    citySel.disabled = !count;
  });
}

/* ── Upload batch ── */
async function uploadBatch() {
  const itemRows = document.getElementById('img-item-rows');
  const rows = itemRows ? [...itemRows.querySelectorAll('[id^="batch-row-"]')] : [];
  if (!rows.length) { toast.error('Nenhuma imagem na fila.'); return; }

  const btn = document.getElementById('img-upload-all-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Enviando…'; }

  // Get defaults
  const defContinent = document.getElementById('def-continent')?.value || '';
  const defCountry   = document.getElementById('def-country')?.value   || '';
  const defCity      = document.getElementById('def-city')?.value      || '';
  // 4.40.5+ Campo 'Tipo' removido do form — fica fixo em 'galeria'.
  const defType      = 'galeria';
  // 4.35.31+ novos defaults: categoria + copyright
  const defCopyright = document.getElementById('def-copyright')?.value || '';
  const defCategory  = document.querySelector('input[name="def-asset-category"]:checked')?.value || 'location';

  let success = 0, failed = 0;

  await Promise.all(rows.map(async row => {
    const id   = row.id.replace('batch-row-','');
    const file = row._file;
    if (!file) return;

    const statusEl = row.querySelector(`.batch-status[data-id="${id}"]`);
    if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Convertendo…'; statusEl.style.color = 'var(--brand-gold)'; }

    // 4.35.31+ Read per-row values, fall back to defaults
    const assetCategory = row.querySelector(`input[name="row-asset-category-${id}"]:checked`)?.value || defCategory;
    const categoryCfg   = ASSET_CATEGORIES.find(c => c.key === assetCategory) || ASSET_CATEGORIES[0];
    const requiresLoc   = categoryCfg.requiresLocation;

    const continent = requiresLoc ? (row.querySelector(`.batch-continent[data-id="${id}"]`)?.value || defContinent) : '';
    const country   = requiresLoc ? (row.querySelector(`.batch-country[data-id="${id}"]`)?.value   || defCountry) : '';
    const city      = requiresLoc ? (row.querySelector(`.batch-city[data-id="${id}"]`)?.value      || defCity) : '';
    // 4.40.5+ Tipo fixo em 'galeria' (campo removido do form — definido no
    // momento de uso em /dicas ou /roteiros conforme a função da foto)
    const type      = defType;
    const name      = row.querySelector(`.batch-name[data-id="${id}"]`)?.value?.trim() || file.name;
    const placeName = row.querySelector(`.batch-placename[data-id="${id}"]`)?.value?.trim() || '';
    const copyright = row.querySelector(`.batch-copyright[data-id="${id}"]`)?.value?.trim() || defCopyright;

    // Active chip tags
    const chipTags = [...row.querySelectorAll(`.batch-tag-chip.active`)].map(c => c.dataset.tag);
    // Free text tags
    const freeTags = (row.querySelector(`.batch-tags-input[data-id="${id}"]`)?.value || '')
      .split(',').map(t => t.trim()).filter(Boolean);
    const tags = [...new Set([...chipTags, ...freeTags])];

    // 4.35.31+ Validação varia por categoria: location exige continente+país; demais não.
    if (requiresLoc && (!continent || !country)) {
      if (statusEl) { statusEl.textContent = '✗ Selecione continente e país'; statusEl.style.color = '#EF4444'; }
      failed++;
      return;
    }

    try {
      const { blob, width, height } = await convertToWebp(file);
      const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
      if (statusEl) statusEl.textContent = `WebP (${sizeMB} MB) — enviando…`;

      const slug = s => s.toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
      // 4.35.31+ path varia por categoria: location → continent/country/city/...;
      // logo/hotel/cruise/train → {prefix}/...
      const pathPrefixParts = categoryCfg.pathPrefix
        ? [categoryCfg.pathPrefix]
        : [continent, country, city].filter(Boolean).map(slug);
      const path = pathPrefixParts.join('/')
        + '/' + Date.now() + '-' + slug(file.name.replace(/\.[^.]+$/,'')) + '.webp';

      const url = await uploadImageToR2(blob, path);
      await saveImageMeta({ assetCategory, continent, country, city, type, tags, name, placeName,
        copyright, url, path,
        originalName: file.name, sizeMB: parseFloat(sizeMB), width, height });

      if (statusEl) { statusEl.textContent = '✓ Enviado'; statusEl.style.color = '#22C55E'; }

      // Mark row as done
      row.style.borderColor = '#22C55E40';
      row.style.background  = '#22C55E06';
      success++;
    } catch(e) {
      if (statusEl) { statusEl.textContent = '✗ ' + e.message.slice(0,50); statusEl.style.color = '#EF4444'; }
      failed++;
    }
  }));

  if (btn) { btn.disabled = false; btn.textContent = '↑ Enviar todas'; }
  toast.success(`${success} enviada${success!==1?'s':''} com sucesso${failed ? ` · ${failed} com erro` : ''}.`);

  if (success > 0) {
    setTimeout(async () => {
      await loadImages();
      if (!failed) {
        // All succeeded — close and reset the upload panel
        const panel    = document.getElementById('img-upload-panel');
        const batchList = document.getElementById('img-batch-list');
        const itemRows  = document.getElementById('img-item-rows');
        if (itemRows)  itemRows.innerHTML = '';
        if (batchList) batchList.style.display = 'none';
        if (panel)     panel.style.display = 'none';
        const toggleBtn = document.getElementById('img-upload-toggle');
        if (toggleBtn) toggleBtn.textContent = '↑ Upload';
        // 4.40.5+ Limpa o campo de direitos autorais default — antes ele
        // persistia entre uploads, fazendo o sistema "auto-preencher" copyright
        // do upload anterior na próxima rodada.
        const copyEl = document.getElementById('def-copyright');
        if (copyEl) copyEl.value = '';
      } else {
        // Some failed — only remove successful rows, keep failed ones
        const ir = document.getElementById('img-item-rows');
        ir?.querySelectorAll('[id^="batch-row-"]').forEach(r => {
          if (r.style.borderColor.includes('22C55E')) r.remove();
        });
      }
    }, 1200);
  }
}



/* ── Data ── */
// 4.35.32+ filters helpers
function _getFiltersForServer() {
  const filters = {};
  if (_filterCategory) filters.assetCategory = _filterCategory;
  if (_filterType)     filters.type          = _filterType;
  if (_filterUploader) filters.uploadedBy    = _filterUploader;
  if (_filterDate) {
    const now = Date.now();
    const days = { '7d': 7, '30d': 30, '90d': 90 }[_filterDate];
    if (days) filters.sinceDate = new Date(now - days * 24 * 3600 * 1000);
    else if (_filterDate === 'year') filters.sinceDate = new Date(new Date().getFullYear(), 0, 1);
  }
  return filters;
}

async function loadImages({ reset = true } = {}) {
  if (reset) {
    _pageCursor = null;
    allImages   = [];
    // 4.40.1+ Invalida cache de contadores das pills sempre que recarregar do zero.
    // Antes: deletar/editar/upload não refrescava os números das categorias
    // (Todas 11, Destino 9, ...) porque _categoryCounts continuava válido.
    _categoryCounts = null;
  }
  const { docs, lastDoc, hasMore } = await fetchImagesPage({
    ..._getFiltersForServer(),
    pageAfter: _pageCursor,
  });
  // Concatena se for load-more, substitui se for reset
  allImages = reset ? docs : [...allImages, ...docs];
  _pageCursor = lastDoc;
  _hasMore    = hasMore;
  // 4.35.34+ renderCategoryNav é async (consulta contadores globais).
  // Não await aqui: queremos a galeria principal pintando rápido. As pills
  // aparecem ~200-500ms depois (sem bloquear UX).
  renderCategoryNav().catch(e => console.warn('[portalImages] renderCategoryNav fail:', e?.message));
  renderBreadcrumb();
  populateUploaderFilter();
  renderGallery();
  // Toggle "Carregar mais"
  const moreEl = document.getElementById('img-load-more-wrap');
  if (moreEl) moreEl.style.display = _hasMore ? 'block' : 'none';
}

/* ── 4.35.34+ Navegação primária por categoria de asset ─────
 * Pills com contadores: 📍 Destinos · ◈ Logos · 🏨 Hotéis · ...
 * Buscar contagem GLOBAL (não filtrada pela página atual): faz query
 * leve sem o filtro de categoria pra calcular totais.
 */
let _categoryCounts = null;  // { all, location, logo, hotel, cruise, train }

async function _fetchCategoryCounts() {
  // Query sem filtro de categoria pra contar todos
  // Reusa fetchImagesPage com pageSize grande mas SEM assetCategory filter
  try {
    const allCatFilters = { ..._getFiltersForServer() };
    delete allCatFilters.assetCategory;
    const { docs } = await fetchImagesPage({ ...allCatFilters, pageSize: 1000 });
    const counts = { all: docs.length, location: 0, logo: 0, hotel: 0, restaurant: 0, cruise: 0, train: 0 };
    docs.forEach(d => {
      const k = d.assetCategory || 'location';
      if (counts[k] !== undefined) counts[k]++;
    });
    _categoryCounts = counts;
  } catch {
    _categoryCounts = { all: allImages.length, location: 0, logo: 0, hotel: 0, restaurant: 0, cruise: 0, train: 0 };
  }
}

// 4.40.5+ Helper que devolve quais campos de localização mostrar pra uma categoria.
// Substitui o flag binário requiresLocation pelo trio { full / continent / none }.
function _locDisplayFor(catKey) {
  const cfg = ASSET_CATEGORIES.find(c => c.key === catKey) || ASSET_CATEGORIES[0];
  if (cfg.showLocation) return cfg.showLocation;
  return cfg.requiresLocation === false ? 'none' : 'full';
}

async function renderCategoryNav() {
  const el = document.getElementById('img-category-nav');
  if (!el) return;
  if (!_categoryCounts) await _fetchCategoryCounts();
  const counts = _categoryCounts || { all: 0, location: 0, logo: 0, hotel: 0, restaurant: 0, cruise: 0, train: 0 };

  // Pills: Todas + 5 categorias
  const pills = [
    { key: '',         label: 'Todas',     icon: '◐', count: counts.all },
    ...ASSET_CATEGORIES.map(c => ({
      key: c.key, label: c.label.replace(' (com localização)', ''), icon: c.icon, count: counts[c.key] || 0,
    })),
  ];

  el.innerHTML = pills.map(p => {
    const active = (_filterCategory || '') === p.key;
    const isEmpty = p.count === 0 && p.key !== '';
    return `<button class="img-cat-nav" data-cat="${esc(p.key)}" style="
      padding:7px 14px;border-radius:20px;border:1px solid ${active?'var(--brand-gold)':'var(--border-subtle)'};
      background:${active?'var(--brand-gold)15':'transparent'};
      color:${active?'var(--brand-gold)':(isEmpty?'var(--text-muted)':'var(--text-secondary)')};
      font-weight:${active?'600':'500'};font-size:0.8125rem;cursor:pointer;
      display:inline-flex;align-items:center;gap:6px;transition:all .15s;
      opacity:${isEmpty?'0.55':'1'};">
      ${esc(p.icon)} ${esc(p.label)}
      <span style="background:${active?'var(--brand-gold)':'var(--bg-elevated)'};
        color:${active?'#fff':'var(--text-muted)'};
        font-size:0.6875rem;font-weight:600;padding:1px 7px;border-radius:10px;">
        ${p.count}
      </span>
    </button>`;
  }).join('');

  el.querySelectorAll('.img-cat-nav').forEach(btn => {
    btn.addEventListener('click', () => {
      _filterCategory = btn.dataset.cat;
      // Reset continent ao trocar de categoria (não faz sentido manter "Brasil" quando vai pra Logos)
      navContinent = ''; navCountry = ''; navCity = '';
      // 4.40.5+ Não há mais select 'img-filter-category' (categoria é só pelas pills)
      loadImages({ reset: true });
    });
  });
}

// 4.35.32+ Popula o dropdown "Quem subiu" com uploaders já no banco
function populateUploaderFilter() {
  const sel = document.getElementById('img-filter-uploader');
  if (!sel) return;
  // Mantém o selecionado
  const cur = sel.value;
  const uploaderIds = [...new Set(allImages.map(i => i.uploadedBy).filter(Boolean))];
  const users = store.get('users') || [];
  const opts = uploaderIds.map(uid => {
    const u = users.find(x => x.id === uid);
    return { uid, name: u?.name || u?.email || `Usuário ${uid.slice(0, 8)}` };
  }).sort((a, b) => a.name.localeCompare(b.name));
  sel.innerHTML = `<option value="">Qualquer um</option>` +
    opts.map(o => `<option value="${esc(o.uid)}" ${o.uid===cur?'selected':''}>${esc(o.name)}</option>`).join('');
}

/* ── Breadcrumb navigation ──
 * 4.35.34+ Continent breadcrumb só aparece em 2 casos:
 *   1. _filterCategory === '' (Todas) — pra usuário poder restringir
 *   2. _filterCategory === 'location' (Destinos)
 * Em categorias non-location (logo/hotel/cruise/train) o breadcrumb fica
 * vazio (continent é '' nesses docs).
 */
function renderBreadcrumb() {
  // 4.40.5+ Target movido pra dentro do filtro bar (#img-loc-filter)
  const el = document.getElementById('img-loc-filter');
  if (!el) return;

  // 4.40.5+ Localização só faz sentido pras categorias que mostram localização
  // (Destino/Hotel/Restaurante/Trem). Logo/Cruzeiro: escondemos o filtro de loc.
  const showsLoc = !_filterCategory || _locDisplayFor(_filterCategory) !== 'none';
  if (!showsLoc) {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }
  el.style.display = 'flex';

  const continents = [...new Set(allImages.map(i => i.continent).filter(Boolean))].sort();

  if (!navContinent) {
    // Top level: show continent chips (só quando categoria=Todas ou Destinos)
    if (!continents.length) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <span style="color:var(--text-muted);font-size:0.8125rem;">📍 Continente:</span>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${continents.map(c => {
          const cnt = allImages.filter(i => i.continent === c).length;
          return `<button class="nav-chip" data-cont="${esc(c)}"
            style="padding:3px 10px;border-radius:20px;border:1px solid var(--border-subtle);
            background:none;cursor:pointer;font-size:0.8125rem;color:var(--text-secondary);
            transition:all .15s;">
            ${esc(c)} <span style="color:var(--text-muted);font-size:0.75rem;">(${cnt})</span>
          </button>`;
        }).join('')}
      </div>`;
    el.querySelectorAll('.nav-chip[data-cont]').forEach(btn => {
      btn.addEventListener('click', () => {
        navContinent = btn.dataset.cont;
        navCountry = ''; navCity = '';
        renderBreadcrumb(); renderGallery();
      });
    });
    return;
  }

  const inCont    = allImages.filter(i => i.continent === navContinent);
  const countries = [...new Set(inCont.map(i => i.country).filter(Boolean))].sort();

  if (!navCountry) {
    el.innerHTML = `
      <button class="bc-btn" data-level="root"
        style="background:none;border:none;cursor:pointer;color:var(--brand-gold);font-size:0.875rem;">
        Todos</button>
      <span style="color:var(--text-muted);">›</span>
      <span style="font-weight:600;font-size:0.875rem;">${esc(navContinent)}</span>
      <span style="color:var(--border-subtle);">›</span>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${countries.map(c => {
          const cnt = inCont.filter(i => i.country === c).length;
          return `<button class="nav-chip" data-country="${esc(c)}"
            style="padding:3px 10px;border-radius:20px;border:1px solid var(--border-subtle);
            background:none;cursor:pointer;font-size:0.8125rem;color:var(--text-secondary);">
            ${esc(c)} <span style="color:var(--text-muted);">(${cnt})</span>
          </button>`;
        }).join('')}
      </div>`;
  } else {
    const inCountry = inCont.filter(i => i.country === navCountry);
    const cities    = [...new Set(inCountry.map(i => i.city).filter(Boolean))].sort();

    el.innerHTML = `
      <button class="bc-btn" data-level="root"
        style="background:none;border:none;cursor:pointer;color:var(--brand-gold);font-size:0.875rem;">
        Todos</button>
      <span style="color:var(--text-muted);">›</span>
      <button class="bc-btn" data-level="continent"
        style="background:none;border:none;cursor:pointer;color:var(--brand-gold);font-size:0.875rem;">
        ${esc(navContinent)}</button>
      <span style="color:var(--text-muted);">›</span>
      <span style="font-weight:600;font-size:0.875rem;">${esc(navCountry)}</span>
      ${cities.length ? `
        <span style="color:var(--border-subtle);">›</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="nav-chip ${!navCity?'active':''}" data-city=""
            style="padding:3px 10px;border-radius:20px;
            border:1px solid ${!navCity?'var(--brand-gold)':'var(--border-subtle)'};
            background:${!navCity?'var(--brand-gold)18':'none'};
            cursor:pointer;font-size:0.8125rem;
            color:${!navCity?'var(--brand-gold)':'var(--text-secondary)'};">
            Todos (${inCountry.length})</button>
          ${cities.map(c => {
            const cnt   = inCountry.filter(i => i.city === c).length;
            const active= navCity === c;
            return `<button class="nav-chip" data-city="${esc(c)}"
              style="padding:3px 10px;border-radius:20px;
              border:1px solid ${active?'var(--brand-gold)':'var(--border-subtle)'};
              background:${active?'var(--brand-gold)18':'none'};
              cursor:pointer;font-size:0.8125rem;
              color:${active?'var(--brand-gold)':'var(--text-secondary)'};">
              ${esc(c)} (${cnt})</button>`;
          }).join('')}
        </div>` : ''}
    `;
  }

  // Breadcrumb back buttons
  el.querySelectorAll('.bc-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.level === 'root')      { navContinent = ''; navCountry = ''; navCity = ''; }
      if (btn.dataset.level === 'continent') { navCountry = ''; navCity = ''; }
      renderBreadcrumb(); renderGallery();
    });
  });

  // Country/city chips
  el.querySelectorAll('.nav-chip[data-country]').forEach(btn => {
    btn.addEventListener('click', () => {
      navCountry = btn.dataset.country; navCity = '';
      renderBreadcrumb(); renderGallery();
    });
  });
  el.querySelectorAll('.nav-chip[data-city]').forEach(btn => {
    btn.addEventListener('click', () => {
      navCity = btn.dataset.city;
      renderBreadcrumb(); renderGallery();
    });
  });
}

/* ── Gallery render ── */
function renderGallery() {
  const gallery = document.getElementById('img-gallery');
  const countEl = document.getElementById('img-count');
  if (!gallery) return;

  let imgs = allImages;
  if (navContinent) imgs = imgs.filter(i => i.continent === navContinent);
  if (navCountry)   imgs = imgs.filter(i => i.country   === navCountry);
  if (navCity)      imgs = imgs.filter(i => i.city       === navCity);
  if (searchStr) {
    imgs = imgs.filter(i => {
      const hay = [i.name, i.city, i.country, ...(i.tags||[])]
        .join(' ').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
      return hay.includes(searchStr);
    });
  }

  // 4.35.31+ fix typo "imagemns" → pluralização correta "imagens"
  if (countEl) countEl.textContent = `${imgs.length} ${imgs.length === 1 ? 'imagem' : 'imagens'}`;

  if (!imgs.length) {
    gallery.innerHTML = `<div style="padding:60px;text-align:center;color:var(--text-muted);">
      ${navContinent || searchStr ? 'Nenhuma imagem encontrada.' : 'Nenhuma imagem cadastrada. Faça upload para começar.'}
    </div>`;
    return;
  }

  // Store filtered list for lightbox navigation
  window._galleryImgs = imgs;

  if (viewMode === 'grid') {
    gallery.innerHTML = `<div style="display:grid;
      grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;">
      ${imgs.map((img, idx) => imgCard(img, idx)).join('')}
    </div>`;
  } else {
    gallery.innerHTML = `<div class="card" style="padding:0;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
        <thead><tr style="background:var(--bg-surface);">
          <th style="${TH}">Imagem</th>
          <th style="${TH}">Nome</th>
          <th style="${TH}">Localização</th>
          <th style="${TH}">Tags</th>
          <th style="${TH}">Tipo</th>
          <th style="${TH}">Tamanho</th>
          <th style="${TH}"></th>
        </tr></thead>
        <tbody>
          ${imgs.map((img, idx) => imgRow(img, idx)).join('')}
        </tbody>
      </table>
    </div>`;
  }

  // Bind events
  gallery.querySelectorAll('.img-open-lightbox').forEach(el => {
    el.addEventListener('click', () => openLightbox(Number(el.dataset.idx)));
  });
  gallery.querySelectorAll('.img-edit-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openEditModal(btn.dataset.id);
    });
  });
  gallery.querySelectorAll('.img-download-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const url  = btn.dataset.url;
      const name = (btn.dataset.name || 'imagem').replace(/\s+/g, '-');
      try {
        // Proxy through R2 worker to avoid CORS
        const R2_PROXY = 'https://primetour-images.rene-castro.workers.dev';
        const res  = await fetch(`${R2_PROXY}?url=${encodeURIComponent(url)}`);
        const blob = await res.blob();
        const ext  = blob.type?.split('/')[1]?.replace('jpeg','jpg') || 'jpg';
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `${name}.${ext}`;
        a.click();
        URL.revokeObjectURL(a.href);
      } catch(e) {
        // Fallback: open in new tab
        window.open(url, '_blank');
      }
    });
  });

  gallery.querySelectorAll('.img-copy-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      navigator.clipboard.writeText(btn.dataset.url).then(() => toast.success('URL copiada!'));
    });
  });
  gallery.querySelectorAll('.img-delete-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('Excluir esta imagem do banco e do R2?')) return;
      try {
        await deleteImageMeta(btn.dataset.id);
        toast.success('Imagem excluída.');
        await loadImages();
      } catch(err) { toast.error('Erro: ' + err.message); }
    });
  });
}

const TH = `padding:10px 14px;text-align:left;font-size:0.6875rem;font-weight:700;
  text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);
  border-bottom:1px solid var(--border-subtle);`;

function imgCard(img, idx) {
  const typeBadge = IMAGE_TYPES.find(t => t.key === img.type)?.label || img.type || 'Galeria';
  return `
    <div style="border-radius:var(--radius-md);overflow:hidden;
      border:1px solid var(--border-subtle);background:var(--bg-surface);
      cursor:pointer;transition:transform .15s,box-shadow .15s;"
      onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,.3)'"
      onmouseout="this.style.transform='';this.style.boxShadow=''">
      <div class="img-open-lightbox" data-idx="${idx}"
        style="position:relative;height:150px;overflow:hidden;">
        <img src="${esc(img.url)}" loading="lazy" alt="${esc(img.name)}"
          style="width:100%;height:100%;object-fit:cover;display:block;"
          onerror="this.parentElement.innerHTML='<div style=\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:var(--bg-surface);color:var(--text-muted);font-size:1.5rem;\'>🖼</div>'">
        <div style="position:absolute;top:6px;left:6px;font-size:0.6375rem;padding:2px 7px;
          border-radius:20px;background:rgba(0,0,0,.65);color:white;backdrop-filter:blur(4px);">
          ${esc(typeBadge)}</div>
      </div>
      <div style="padding:10px 12px;">
        <div style="font-size:0.875rem;font-weight:600;white-space:nowrap;overflow:hidden;
          text-overflow:ellipsis;margin-bottom:3px;">${esc(img.name || '—')}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:6px;">
          ${esc([img.city, img.country].filter(Boolean).join(', ') || img.continent || '—')}
        </div>
        ${img.tags?.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px;">
          ${img.tags.slice(0,3).map(t => `
            <span style="font-size:0.625rem;padding:1px 6px;border-radius:20px;
              background:var(--brand-gold)15;border:1px solid var(--brand-gold)30;
              color:var(--brand-gold);">${esc(t)}</span>`).join('')}
          ${img.tags.length > 3 ? `<span style="font-size:0.625rem;color:var(--text-muted);">+${img.tags.length-3}</span>` : ''}
        </div>` : ''}
        <div style="display:flex;gap:5px;">
          <button class="img-edit-btn btn btn-ghost btn-sm" data-id="${img.id}"
            style="font-size:0.7rem;flex:1;">✎ Editar</button>
          <button class="img-copy-btn btn btn-ghost btn-sm" data-url="${esc(img.url)}"
            style="font-size:0.7rem;" title="Copiar URL">⎘</button>
          <button class="img-download-btn btn btn-ghost btn-sm"
            data-url="${esc(img.url)}" data-name="${esc(img.name||'imagem')}"
            style="font-size:0.7rem;color:var(--brand-gold);" title="Baixar">↓</button>
          <button class="img-delete-btn btn btn-ghost btn-sm" data-id="${img.id}"
            style="font-size:0.7rem;color:#EF4444;" title="Excluir">✕</button>
        </div>
      </div>
    </div>`;
}

function imgRow(img, idx) {
  const typeBadge = IMAGE_TYPES.find(t => t.key === img.type)?.label || '—';
  return `
    <tr style="border-bottom:1px solid var(--border-subtle);transition:background .1s;"
      onmouseover="this.style.background='var(--bg-surface)'"
      onmouseout="this.style.background=''">
      <td style="padding:8px 14px;">
        <img src="${esc(img.url)}" loading="lazy" alt=""
          class="img-open-lightbox" data-idx="${idx}"
          style="width:48px;height:36px;object-fit:cover;border-radius:var(--radius-sm);cursor:pointer;">
      </td>
      <td style="padding:8px 14px;font-weight:600;max-width:180px;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(img.name||'—')}</td>
      <td style="padding:8px 14px;color:var(--text-muted);font-size:0.8125rem;">
        ${esc([img.city, img.country, img.continent].filter(Boolean).join(' · '))}
      </td>
      <td style="padding:8px 14px;">
        <div style="display:flex;gap:4px;flex-wrap:wrap;">
          ${(img.tags||[]).slice(0,3).map(t => `
            <span style="font-size:0.6875rem;padding:1px 6px;border-radius:20px;
              background:var(--brand-gold)15;border:1px solid var(--brand-gold)30;
              color:var(--brand-gold);">${esc(t)}</span>`).join('')}
        </div>
      </td>
      <td style="padding:8px 14px;font-size:0.8125rem;color:var(--text-muted);">${esc(typeBadge)}</td>
      <td style="padding:8px 14px;font-size:0.8125rem;color:var(--text-muted);">
        ${img.sizeMB ? img.sizeMB + ' MB' : '—'}
      </td>
      <td style="padding:8px 14px;">
        <div style="display:flex;gap:5px;justify-content:flex-end;">
          <button class="img-edit-btn btn btn-ghost btn-sm" data-id="${img.id}"
            style="font-size:0.75rem;">✎</button>
          <button class="img-copy-btn btn btn-ghost btn-sm" data-url="${esc(img.url)}"
            style="font-size:0.75rem;" title="Copiar URL">⎘</button>
          <button class="img-download-btn btn btn-ghost btn-sm"
            data-url="${esc(img.url)}" data-name="${esc(img.name||'imagem')}"
            style="font-size:0.75rem;color:var(--brand-gold);" title="Baixar">↓</button>
          <button class="img-delete-btn btn btn-ghost btn-sm" data-id="${img.id}"
            style="font-size:0.75rem;color:#EF4444;">✕</button>
        </div>
      </td>
    </tr>`;
}

/* ── Edit modal ── */
function openEditModal(imgId) {
  const img = allImages.find(i => i.id === imgId);
  if (!img) return;

  const existing = document.getElementById('img-edit-modal');
  if (existing) existing.remove();

  // 4.40.6+ Injeta CSS pra forçar barra de scroll VISÍVEL no body do modal
  // em macOS (onde scrollbars são auto-hide por padrão). Roda apenas uma vez.
  if (!document.getElementById('img-edit-modal-style')) {
    const st = document.createElement('style');
    st.id = 'img-edit-modal-style';
    st.textContent = `
      .img-edit-modal-body::-webkit-scrollbar { width: 12px; }
      .img-edit-modal-body::-webkit-scrollbar-track {
        background: var(--bg-surface, #16202C); border-radius: 6px;
      }
      .img-edit-modal-body::-webkit-scrollbar-thumb {
        background: var(--border-default, #374151); border-radius: 6px;
        border: 2px solid var(--bg-surface, #16202C);
      }
      .img-edit-modal-body::-webkit-scrollbar-thumb:hover {
        background: var(--brand-gold, #D4A843);
      }
      .img-edit-modal-body { scrollbar-width: thin; scrollbar-color: var(--border-default) var(--bg-surface); }
    `;
    document.head.appendChild(st);
  }

  const modal = document.createElement('div');
  modal.id = 'img-edit-modal';
  // 4.40.5+ Modal agora respeita max-height 90vh + scroll interno. Antes
  // ocupava 100% da altura e usuário ficava sem como fechar (cabeçalho/Footer
  // saíam da viewport em telas menores). Backdrop-click também fecha.
  modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2500;
    display:flex;align-items:center;justify-content:center;padding:20px;`;
  modal.innerHTML = `
    <div class="card" style="width:100%;max-width:480px;max-height:90vh;
      padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:18px 24px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;gap:10px;
        flex-shrink:0;">
        <div style="flex:1;font-weight:700;">Editar imagem</div>
        <button id="edit-img-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>
      ${/* 4.40.6+ overflow-y:scroll (não auto) força barra sempre visível —
            evita estado em que user não percebe que tem conteúdo abaixo. */ ''}
      <div class="img-edit-modal-body"
        style="padding:24px;display:flex;flex-direction:column;gap:14px;
        overflow-y:scroll;flex:1;min-height:0;scrollbar-gutter:stable;">
        <img src="${esc(img.url)}" alt=""
          style="width:100%;height:160px;object-fit:cover;border-radius:var(--radius-sm);flex-shrink:0;">
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:5px;">
            Nome da imagem</label>
          <input type="text" id="edit-img-name" value="${esc(img.name||'')}"
            class="portal-field" style="width:100%;">
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:5px;">
            Descrição da foto
            <span style="font-weight:400;color:var(--text-muted);">(opcional)</span></label>
          <input type="text" id="edit-img-placename" value="${esc(img.placeName||'')}"
            class="portal-field" style="width:100%;"
            placeholder="Ex: Torre Eiffel ao pôr-do-sol, fachada do Hotel Copacabana Palace…">
          <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:4px;">
            Quando preenchido, esta foto é usada especificamente para este lugar nas dicas geradas.
          </div>
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:5px;">
            Tags <span style="font-weight:400;color:var(--text-muted);">(separadas por vírgula)</span></label>
          <input type="text" id="edit-img-tags" value="${esc((img.tags||[]).join(', '))}"
            class="portal-field" style="width:100%;">
        </div>
        ${/* 4.40.5+ Campo 'Tipo' removido — tratado no momento de uso em /dicas e /roteiros */ ''}
        <!-- 4.35.31+ Categoria do asset (read-only — não pode trocar depois do upload pq mudaria o path R2) -->
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:5px;">
            Categoria</label>
          <div style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;
            background:var(--bg-surface);border-radius:var(--radius-sm);font-size:0.8125rem;">
            ${(() => {
              const cat = ASSET_CATEGORIES.find(c => c.key === (img.assetCategory || 'location')) || ASSET_CATEGORIES[0];
              return `${cat.icon} ${esc(cat.label)}`;
            })()}
          </div>
        </div>
        <!-- 4.35.31+ Direitos autorais -->
        <div>
          <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:5px;">
            Direitos autorais <span style="font-weight:400;color:var(--text-muted);">(opcional)</span></label>
          <input type="text" id="edit-img-copyright" value="${esc(img.copyright||'')}"
            class="portal-field" style="width:100%;"
            placeholder="Ex: © Unsplash — João Silva · © 2024 Hotel Copacabana Palace">
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);">
          ${img.width && img.height ? `${img.width} × ${img.height} px · ` : ''}${img.sizeMB || '—'} MB ·
          <a href="${esc(img.url)}" target="_blank" style="color:var(--brand-gold);">Abrir original ↗</a>
        </div>
      </div>
      <div style="padding:14px 24px;border-top:1px solid var(--border-subtle);
        background:var(--bg-surface);display:flex;gap:8px;justify-content:flex-end;flex-shrink:0;">
        <button id="edit-img-cancel" class="btn btn-ghost btn-sm">Cancelar</button>
        <button id="edit-img-save" class="btn btn-primary btn-sm">Salvar</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  const close = () => modal.remove();
  document.getElementById('edit-img-close')?.addEventListener('click', close);
  document.getElementById('edit-img-cancel')?.addEventListener('click', close);
  // 4.40.5+ Backdrop click fecha (UX padrão de modais)
  modal.addEventListener('click', e => { if (e.target === modal) close(); });

  document.getElementById('edit-img-save')?.addEventListener('click', async () => {
    const name      = document.getElementById('edit-img-name')?.value.trim();
    const placeName = document.getElementById('edit-img-placename')?.value.trim() || '';
    const tags = (document.getElementById('edit-img-tags')?.value || '')
      .split(',').map(t => t.trim()).filter(Boolean);
    // 4.40.5+ inclui copyright no patch. Type não é mais editado aqui.
    const copyright = document.getElementById('edit-img-copyright')?.value.trim() || '';
    try {
      await updateImageMeta(imgId, { name, placeName, tags, copyright });
      toast.success('Imagem atualizada.');
      close();
      await loadImages();
    } catch(e) { toast.error('Erro: ' + e.message); }
  });
}

/* ── Lightbox ── */
function openLightbox(idx) {
  lightboxIdx = idx;
  renderLightbox();
  const lb = document.getElementById('img-lightbox');
  if (lb) lb.style.display = 'flex';
}

function renderLightbox() {
  const lb  = document.getElementById('img-lightbox');
  const imgs = window._galleryImgs || [];
  const img  = imgs[lightboxIdx];
  if (!lb || !img) return;

  lb.innerHTML = `
    <div style="position:absolute;top:16px;right:16px;display:flex;gap:8px;z-index:10;">
      <button id="lb-copy" style="border:none;background:rgba(255,255,255,.15);color:white;
        border-radius:var(--radius-sm);padding:6px 12px;cursor:pointer;font-size:0.8125rem;
        backdrop-filter:blur(4px);">⎘ Copiar URL</button>
      <button id="lb-close" style="border:none;background:rgba(255,255,255,.15);color:white;
        border-radius:var(--radius-sm);padding:6px 12px;cursor:pointer;font-size:1rem;
        backdrop-filter:blur(4px);">✕</button>
    </div>
    ${lightboxIdx > 0 ? `<button id="lb-prev" style="position:absolute;left:16px;top:50%;
      transform:translateY(-50%);border:none;background:rgba(255,255,255,.15);color:white;
      border-radius:var(--radius-sm);padding:10px 14px;cursor:pointer;font-size:1.25rem;
      backdrop-filter:blur(4px);">‹</button>` : ''}
    ${lightboxIdx < imgs.length - 1 ? `<button id="lb-next" style="position:absolute;right:16px;
      top:50%;transform:translateY(-50%);border:none;background:rgba(255,255,255,.15);color:white;
      border-radius:var(--radius-sm);padding:10px 14px;cursor:pointer;font-size:1.25rem;
      backdrop-filter:blur(4px);">›</button>` : ''}
    <img src="${esc(img.url)}" alt="${esc(img.name)}"
      style="max-width:90vw;max-height:80vh;object-fit:contain;border-radius:var(--radius-md);
      box-shadow:0 24px 80px rgba(0,0,0,.6);">
    <div style="margin-top:14px;text-align:center;color:white;">
      <div style="font-size:1rem;font-weight:600;margin-bottom:4px;">${esc(img.name||'')}</div>
      <div style="font-size:0.8125rem;color:rgba(255,255,255,.6);">
        ${esc([img.city, img.country, img.continent].filter(Boolean).join(' · '))}
        ${img.width && img.height ? ` · ${img.width}×${img.height}px` : ''}
        ${img.sizeMB ? ` · ${img.sizeMB} MB` : ''}
      </div>
      ${img.tags?.length ? `<div style="display:flex;gap:6px;justify-content:center;margin-top:8px;flex-wrap:wrap;">
        ${img.tags.map(t => `<span style="font-size:0.75rem;padding:2px 8px;border-radius:20px;
          background:rgba(212,168,67,.2);border:1px solid rgba(212,168,67,.4);color:var(--brand-gold);">
          ${esc(t)}</span>`).join('')}
      </div>` : ''}
      <div style="font-size:0.75rem;color:rgba(255,255,255,.4);margin-top:8px;">
        ${lightboxIdx + 1} de ${imgs.length}</div>
    </div>
  `;

  document.getElementById('lb-close')?.addEventListener('click', closeLightbox);
  document.getElementById('lb-prev')?.addEventListener('click', () => { lightboxIdx--; renderLightbox(); });
  document.getElementById('lb-next')?.addEventListener('click', () => { lightboxIdx++; renderLightbox(); });
  document.getElementById('lb-copy')?.addEventListener('click', () => {
    navigator.clipboard.writeText(img.url).then(() => toast.success('URL copiada!'));
  });
  lb.onclick = e => { if (e.target === lb) closeLightbox(); };
}

function closeLightbox() {
  const lb = document.getElementById('img-lightbox');
  if (lb) lb.style.display = 'none';
  lightboxIdx = -1;
}

function handleLightboxKey(e) {
  const lb = document.getElementById('img-lightbox');
  if (!lb || lb.style.display === 'none') return;
  const imgs = window._galleryImgs || [];
  if (e.key === 'Escape')      closeLightbox();
  if (e.key === 'ArrowLeft'  && lightboxIdx > 0)             { lightboxIdx--; renderLightbox(); }
  if (e.key === 'ArrowRight' && lightboxIdx < imgs.length-1) { lightboxIdx++; renderLightbox(); }
}

function skeletonGrid() {
  return `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;">
    ${Array(6).fill(`<div class="skeleton" style="height:220px;border-radius:var(--radius-md);"></div>`).join('')}
  </div>`;
}
