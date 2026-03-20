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
  fetchDestinations, fetchTip, saveTip, fetchCategories,
  SEGMENTS, CONTINENTS, MONTHS,
} from '../services/portal.js';

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
  const destId = params.get('destId') || null;

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
  const dests    = await fetchDestinations({ continent: cont });
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
  const dests  = await fetchDestinations({ continent: cont, country });
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
  const dests = await fetchDestinations({ continent: cont, country });
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

  // Init segment data
  segmentData = {};
  for (const seg of SEGMENTS) {
    segmentData[seg.key] = tip?.segments?.[seg.key] || emptySegData(seg);
  }

  // Preload all categories
  for (const seg of SEGMENTS) {
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

  const status = document.getElementById('editor-save-status');
  if (status) status.textContent = tip
    ? `Última edição: ${fmt(tip.updatedAt)}`
    : 'Novo rascunho — não salvo';

  renderSegmentNav();
  renderExpiryOverview();
  activateSegment(SEGMENTS[0].key);
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
  nav.innerHTML = SEGMENTS.map(s => {
    const hasContent = segHasContent(s.key);
    const isExpired  = isExpiredSeg(s.key);
    const isActive   = s.key === activeSegKey;
    return `<button class="seg-nav-btn" data-key="${s.key}"
      style="width:100%;text-align:left;padding:9px 14px;border:none;
      background:${isActive ? 'var(--brand-gold)15' : 'transparent'};
      border-left:3px solid ${isActive ? 'var(--brand-gold)' : 'transparent'};
      cursor:pointer;display:flex;align-items:center;gap:8px;font-size:0.8125rem;">
      <span style="flex:1;color:${isActive ? 'var(--brand-gold)' : 'var(--text-primary)'};">
        ${esc(s.label)}
      </span>
      <span style="font-size:0.625rem;color:${isExpired?'#EF4444':hasContent?'#22C55E':'var(--text-muted)'};">
        ${isExpired ? '⚠' : hasContent ? '●' : '○'}
      </span>
    </button>`;
  }).join('');

  nav.querySelectorAll('.seg-nav-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      saveCurrentSegment();
      activateSegment(btn.dataset.key);
    }));
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
  const seg  = SEGMENTS.find(s => s.key === key);
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
          class="filter-select" style="padding:5px 8px;font-size:0.8125rem;width:140px;">
        ${isExpired ? `<span style="font-size:0.75rem;color:#EF4444;font-weight:600;">● Vencido</span>` : ''}
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
                    <input type="number" class="clima-input" data-type="${type}" data-month="${i}"
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
            <input type="number" id="ig-fuso-horas" class="filter-select" style="width:60px;"
              value="${esc(String(inf.fusoHoras??''))}" placeholder="0" min="0" max="14">
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
  const base = `class="filter-select" id="${id}" style="width:100%;${opts.style||''}"`;
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
      <input type="text" class="simple-item-title filter-select" data-index="${i}"
        style="width:100%;margin-bottom:6px;font-weight:600;"
        placeholder="Nome do bairro / local" value="${esc(item.title||'')}">
      <textarea class="simple-item-desc filter-select" data-index="${i}"
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
      <div>
        <h2 style="margin:0;font-size:1rem;font-weight:700;">${esc(seg.label)}</h2>
      </div>
      ${expiryControls(data)}
    </div>
    <div style="${BODY_STYLE}">
      <!-- Theme description -->
      <div style="margin-bottom:16px;">
        <label style="${LBL}">Descrição do tema <span style="font-weight:400;color:var(--text-muted);">(opcional)</span></label>
        <textarea id="place-theme-desc" class="filter-select" style="width:100%;resize:vertical;" rows="2"
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
      <div>
        <h2 style="margin:0;font-size:1rem;font-weight:700;">${esc(seg.label)}</h2>
      </div>
      ${expiryControls(data)}
    </div>
    <div style="${BODY_STYLE}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
        <div>
          <label style="${LBL}">Período da agenda</label>
          <input type="text" id="agenda-periodo" class="filter-select" style="width:100%;"
            placeholder="Ex: Janeiro a Março 2026" value="${esc(data.periodoAgenda||'')}">
        </div>
        <div>
          ${field('agenda-dica','Dica geral','textarea',data.dica,{rows:2})}
        </div>
        <div style="grid-column:1/-1;">
          <label style="${LBL}">Descrição do tema</label>
          <textarea id="place-theme-desc" class="filter-select" style="width:100%;resize:vertical;" rows="2"
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
        <select class="place-cat filter-select" data-index="${i}" style="width:100%;">
          <option value="">Selecione</option>
          ${cats.map(c=>`<option value="${esc(c)}" ${item.categoria===c?'selected':''}>${esc(c)}</option>`).join('')}
          <option value="${esc(item.categoria||'')}" ${item.categoria&&!cats.includes(item.categoria)?'selected':''}
            ${!item.categoria||cats.includes(item.categoria)?'style="display:none"':''}>
            ${esc(item.categoria||'')}
          </option>
        </select>
      </div>
      <div>
        <label style="${LBL}">Título / Nome *</label>
        <input type="text" class="place-title filter-select" data-index="${i}"
          style="width:100%;font-weight:600;" placeholder="Nome do local"
          value="${esc(item.titulo||'')}">
      </div>
    </div>

    <div style="margin-bottom:10px;">
      <label style="${LBL}">Descrição</label>
      <textarea class="place-desc filter-select" data-index="${i}"
        style="width:100%;resize:vertical;" rows="3"
        placeholder="Descrição do local…">${esc(item.descricao||'')}</textarea>
    </div>

    ${isAgenda ? `
    <div style="margin-bottom:10px;">
      <label style="${LBL}">Período do evento</label>
      <div style="display:flex;gap:8px;align-items:center;">
        <input type="text" class="place-periodo filter-select" data-index="${i}"
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
        <input type="text" class="place-endereco filter-select" data-index="${i}"
          style="width:100%;" value="${esc(item.endereco||'')}">
      </div>
      <div>
        <label style="${LBL}">Telefone</label>
        <input type="text" class="place-telefone filter-select" data-index="${i}"
          style="width:100%;" value="${esc(item.telefone||'')}">
      </div>
      <div>
        <label style="${LBL}">Site</label>
        <input type="url" class="place-site filter-select" data-index="${i}"
          style="width:100%;" placeholder="https://" value="${esc(item.site||'')}">
      </div>
      <div style="grid-column:1/-1;">
        <label style="${LBL}">Observações</label>
        <input type="text" class="place-obs filter-select" data-index="${i}"
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
  const seg  = SEGMENTS.find(s => s.key === activeSegKey);
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
  const withExp = SEGMENTS.filter(s => segmentData[s.key]?.hasExpiry && segmentData[s.key]?.expiryDate);
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
    for (const seg of SEGMENTS) {
      const data = segmentData[seg.key];
      if (segHasContent(seg.key) || data?.hasExpiry) segments[seg.key] = data;
    }
    const tipId = await saveTip(currentTip?.id || null, {
      destinationId: currentDestId,
      continent:     currentDestInfo?.continent || '',
      country:       currentDestInfo?.country   || '',
      city:          currentDestInfo?.city       || '',
      segments,
    });
    if (!currentTip) currentTip = { id: tipId };
    isDirty = false;
    const now = new Intl.DateTimeFormat('pt-BR',{ day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date());
    if (status) status.textContent = `Salvo às ${now}`;
    toast.success('Dica salva.');
    renderSegmentNav();
  } catch(e) {
    toast.error('Erro ao salvar: ' + e.message);
    if (status) status.textContent = 'Erro ao salvar.';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar Dica'; }
  }
}

/* ─── Helpers ─────────────────────────────────────────────── */
function segHasContent(key) {
  const d = segmentData[key];
  if (!d) return false;
  if (d.info) return Object.values(d.info).some(v => v && String(v).trim() && v !== '{}');
  if (typeof d.content === 'string' && d.content.trim()) return true;
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
