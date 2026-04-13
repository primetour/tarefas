/**
 * PRIMETOUR — Roteiro Editor: Multi-section Itinerary Editor
 * Two-column layout with sidebar navigation and 11 content sections
 */

import { store }  from '../store.js';
import { toast } from '../components/toast.js';
const showToast = (msg, type = 'info') => toast[type]?.(msg) ?? toast.info(msg);
import { fetchRoteiro, saveRoteiro } from '../services/roteiros.js';
import { generateRoteiroForExport } from '../services/roteiroGenerator.js';
import { fetchDestinations, fetchAreas } from '../services/portal.js';

/* ─── State ───────────────────────────────────────────────── */
let currentRoteiro = null;
let isDirty = false;
let autoSaveTimer = null;
let allDestinations = [];
let allAreas = [];
let activeSection = 0;

/* ─── Helper ──────────────────────────────────────────────── */
const esc = s => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';

function addDaysToDate(dateStr, days) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function diffDays(a, b) {
  if (!a || !b) return 0;
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function formatDateForDay(startDate, dayIndex) {
  if (!startDate) return '';
  const d = new Date(startDate + 'T12:00:00');
  d.setDate(d.getDate() + dayIndex);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ─── Sections definition ─────────────────────────────────── */
const SECTIONS = [
  { icon: '\u{1F464}', label: 'Cliente' },
  { icon: '\u{1F30D}', label: 'Viagem' },
  { icon: '\u{1F4C5}', label: 'Dia a dia' },
  { icon: '\u{1F3E8}', label: 'Hot\u00e9is' },
  { icon: '\u{1F4B0}', label: 'Valores' },
  { icon: '\u2B50',    label: 'Opcionais' },
  { icon: '\u2713',    label: 'Inclui / N\u00e3o inclui' },
  { icon: '\u{1F4B3}', label: 'Pagamento' },
  { icon: '\u274C',    label: 'Cancelamento' },
  { icon: '\u2139',    label: 'Informa\u00e7\u00f5es Importantes' },
  { icon: '\u{1F4C4}', label: 'Preview & Export' },
];

/* ─── Preferences & Restrictions options ──────────────────── */
const PREF_OPTIONS = ['Gastronomia','Cultura','Aventura','Relaxamento','Compras','Natureza'];
const REST_OPTIONS = ['Mobilidade reduzida','Restri\u00e7\u00e3o alimentar','Outro'];

/* ─── Default cancellation presets ────────────────────────── */
const CANCELLATION_PRESETS = [
  { period: 'At\u00e9 60 dias antes', penalty: 'Sem custo' },
  { period: 'Entre 59 e 30 dias',     penalty: '50% do valor total' },
  { period: 'Entre 29 e 15 dias',     penalty: '75% do valor total' },
  { period: 'Menos de 15 dias',       penalty: '100% do valor total (no-show)' },
];

/* ─── Includes/Excludes presets ───────────────────────────── */
const INCLUDES_PRESETS = [
  'Hospedagem conforme descrito',
  'Caf\u00e9 da manh\u00e3',
  'Transfers privativos',
  'Seguro viagem',
  'Passeios mencionados no roteiro',
];
const EXCLUDES_PRESETS = [
  'Passagem a\u00e9rea',
  'Refei\u00e7\u00f5es n\u00e3o mencionadas',
  'Despesas pessoais',
  'Gorjetas',
  'Seguro viagem opcional',
];

/* ─── CSS ─────────────────────────────────────────────────── */
const EDITOR_CSS = `
.re-header {
  display: flex; align-items: center; gap: 12px; padding: 12px 0; margin-bottom: 16px;
  border-bottom: 1px solid var(--border-subtle, #333); flex-wrap: wrap;
}
.re-header-title {
  font-size: 1.25rem; font-weight: 700; color: var(--text-primary); flex: 1; min-width: 200px;
}
.re-header .status-badge {
  padding: 4px 12px; border-radius: 999px; font-size: 0.75rem; font-weight: 600;
  background: var(--bg-surface, #222); color: var(--text-muted);
}
.re-layout {
  display: grid; grid-template-columns: 220px 1fr; gap: 1.5rem;
}
.re-sidebar {
  position: sticky; top: 80px; align-self: start;
}
.re-nav-item {
  display: flex; align-items: center; gap: 8px;
  padding: 0.75rem 1rem; border-radius: 8px; cursor: pointer;
  background: transparent; border-left: 3px solid transparent;
  font-size: 0.875rem; color: var(--text-secondary); transition: all 0.15s;
  margin-bottom: 2px; user-select: none;
}
.re-nav-item:hover { background: var(--bg-hover, rgba(255,255,255,0.05)); }
.re-nav-item.active {
  background: var(--bg-hover, rgba(255,255,255,0.05));
  border-left-color: var(--brand-blue, #3B82F6);
  color: var(--text-primary); font-weight: 600;
}
.re-content {
  min-height: 400px;
}
.re-section-title {
  font-size: 1.1rem; font-weight: 700; color: var(--text-primary); margin-bottom: 16px;
  padding-bottom: 8px; border-bottom: 1px solid var(--border-subtle, #333);
}
.re-form-group {
  margin-bottom: 14px;
}
.re-label {
  font-size: 0.75rem; font-weight: 600; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; display: block;
}
.re-input, .re-select, .re-textarea {
  width: 100%; padding: 0.5rem 0.75rem;
  background: var(--bg-input, var(--bg-card, #1a1a2e));
  border: 1px solid var(--border, #333); border-radius: 6px;
  color: var(--text-primary); font-size: 0.875rem;
  font-family: inherit; box-sizing: border-box;
}
.re-textarea { resize: vertical; min-height: 60px; }
.re-input:focus, .re-select:focus, .re-textarea:focus {
  outline: none; border-color: var(--brand-blue, #3B82F6);
}
.re-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.re-row > .re-form-group { flex: 1; min-width: 180px; margin-bottom: 0; }
.re-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
.re-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 14px; }
.re-checkbox-group { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.re-checkbox-group label {
  display: flex; align-items: center; gap: 5px; font-size: 0.8125rem; color: var(--text-secondary);
  padding: 4px 10px; border: 1px solid var(--border-subtle, #333); border-radius: 999px;
  cursor: pointer; transition: all 0.15s; user-select: none;
}
.re-checkbox-group label:hover { background: var(--bg-surface, #222); }
.re-checkbox-group label.checked {
  background: var(--brand-blue, #3B82F6); color: #fff; border-color: var(--brand-blue, #3B82F6);
}
.re-dyn-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; margin-bottom: 8px; }
.re-dyn-table th {
  text-align: left; padding: 6px 8px; font-weight: 600; color: var(--text-muted);
  border-bottom: 1px solid var(--border-subtle, #333); font-size: 0.75rem;
}
.re-dyn-table td { padding: 4px 6px; }
.re-dyn-table input, .re-dyn-table select, .re-dyn-table textarea {
  width: 100%; padding: 6px 8px; border: 1px solid var(--border-subtle, #333); border-radius: 6px;
  background: var(--bg-card, #1a1a2e); color: var(--text-primary); font-size: 0.8125rem;
  font-family: inherit; box-sizing: border-box;
}
.re-dyn-table textarea { resize: vertical; min-height: 32px; }
.re-add-btn {
  display: inline-flex; align-items: center; gap: 4px; padding: 6px 14px; font-size: 0.8125rem;
  font-weight: 600; color: var(--brand-blue, #3B82F6); background: transparent;
  border: 1px dashed var(--brand-blue, #3B82F6); border-radius: 6px;
  cursor: pointer; margin-top: 8px; transition: all 0.15s;
}
.re-add-btn:hover { background: var(--brand-blue, #3B82F6); color: #fff; }
.re-remove-btn {
  background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1rem;
  padding: 2px 6px; border-radius: 6px; transition: all 0.15s;
}
.re-remove-btn:hover { background: rgba(239,68,68,0.1); color: #EF4444; }
.re-day-card {
  border: 1px solid var(--border-subtle, #333); border-radius: 8px; padding: 16px;
  margin-bottom: 12px; position: relative; background: var(--bg-card, #1a1a2e);
}
.re-day-card .re-day-num {
  position: absolute; top: -1px; left: 16px; background: var(--brand-blue, #3B82F6); color: #fff;
  font-weight: 700; font-size: 0.75rem; padding: 2px 10px; border-radius: 0 0 6px 6px;
}
.re-day-card .re-day-date {
  font-size: 0.75rem; color: var(--text-muted); margin-bottom: 8px; padding-left: 80px;
}
.re-two-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.re-list-col { display: flex; flex-direction: column; gap: 6px; }
.re-list-item { display: flex; align-items: center; gap: 6px; padding: 4px 0; }
.re-list-item input { flex: 1; }
.re-dest-row { display: flex; gap: 8px; align-items: flex-end; margin-bottom: 8px; }
.re-dest-row .re-form-group { margin-bottom: 0; }
.re-activity-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
.re-activity-row input, .re-activity-row select { font-size: 0.8125rem; }
.re-preview-summary {
  background: var(--bg-surface, #222); border-radius: 8px; padding: 16px; margin-bottom: 16px;
  font-size: 0.875rem; color: var(--text-secondary); line-height: 1.6;
}
.re-autosave {
  font-size: 0.75rem; color: var(--text-muted); margin-left: 8px;
}
@media (max-width: 768px) {
  .re-layout { grid-template-columns: 1fr; }
  .re-sidebar { position: static; display: flex; flex-wrap: wrap; gap: 4px; }
  .re-nav-item { padding: 6px 10px; font-size: 0.75rem; border-left: none; border-bottom: 2px solid transparent; }
  .re-nav-item.active { border-bottom-color: var(--brand-blue, #3B82F6); border-left-color: transparent; }
  .re-grid-2, .re-grid-3, .re-two-cols { grid-template-columns: 1fr; }
  .re-row { flex-direction: column; }
}
`;

/* ─── Section renderers ───────────────────────────────────── */

function renderSectionContent(index) {
  switch (index) {
    case 0:  return renderClienteSection();
    case 1:  return renderViagemSection();
    case 2:  return renderDiaDiaSection();
    case 3:  return renderHoteisSection();
    case 4:  return renderValoresSection();
    case 5:  return renderOpcionaisSection();
    case 6:  return renderIncluiSection();
    case 7:  return renderPagamentoSection();
    case 8:  return renderCancelamentoSection();
    case 9:  return renderInfoSection();
    case 10: return renderPreviewSection();
    default: return '';
  }
}

/* ── 0: Cliente ──────────────────────────────────────────── */
function renderClienteSection() {
  const c = currentRoteiro.client;
  const childrenAgesHTML = (c.childrenAges || []).map((age, i) =>
    `<input class="re-input" type="number" min="0" max="17" data-age-idx="${i}" value="${age}" style="width:70px;" />`
  ).join('');

  return `
    <div class="re-section-title">Cliente</div>
    <div class="re-row">
      <div class="re-form-group">
        <label class="re-label">Nome do Cliente</label>
        <input class="re-input" data-field="client.name" value="${esc(c.name)}" placeholder="Nome completo" />
      </div>
      <div class="re-form-group">
        <label class="re-label">Email</label>
        <input class="re-input" type="email" data-field="client.email" value="${esc(c.email)}" placeholder="email@exemplo.com" />
      </div>
      <div class="re-form-group">
        <label class="re-label">Telefone</label>
        <input class="re-input" data-field="client.phone" value="${esc(c.phone)}" placeholder="+55 11 99999-0000" />
      </div>
    </div>
    <div class="re-row">
      <div class="re-form-group">
        <label class="re-label">Tipo</label>
        <select class="re-select" data-field="client.type">
          <option value="individual" ${c.type==='individual'?'selected':''}>Individual</option>
          <option value="couple" ${c.type==='couple'?'selected':''}>Casal</option>
          <option value="family" ${c.type==='family'?'selected':''}>Fam\u00edlia</option>
          <option value="group" ${c.type==='group'?'selected':''}>Grupo</option>
        </select>
      </div>
      <div class="re-form-group">
        <label class="re-label">Adultos</label>
        <input class="re-input" type="number" min="1" data-field="client.adults" value="${c.adults || 2}" />
      </div>
      <div class="re-form-group">
        <label class="re-label">Crian\u00e7as</label>
        <input class="re-input" type="number" min="0" data-field="client.children" value="${c.children || 0}" id="re-children-count" />
      </div>
    </div>
    <div id="re-children-ages" class="re-form-group" style="${c.children > 0 ? '' : 'display:none;'}">
      <label class="re-label">Idades das Crian\u00e7as</label>
      <div class="re-row" id="re-ages-row">${childrenAgesHTML}</div>
    </div>
    <div class="re-form-group">
      <label class="re-label">Prefer\u00eancias</label>
      <div class="re-checkbox-group" id="re-pref-group">
        ${PREF_OPTIONS.map(p => `
          <label class="${(c.preferences||[]).includes(p)?'checked':''}" data-pref="${esc(p)}">
            <input type="checkbox" ${(c.preferences||[]).includes(p)?'checked':''} style="display:none;" /> ${esc(p)}
          </label>
        `).join('')}
      </div>
    </div>
    <div class="re-form-group">
      <label class="re-label">Restri\u00e7\u00f5es</label>
      <div class="re-checkbox-group" id="re-rest-group">
        ${REST_OPTIONS.map(r => `
          <label class="${(c.restrictions||[]).includes(r)?'checked':''}" data-rest="${esc(r)}">
            <input type="checkbox" ${(c.restrictions||[]).includes(r)?'checked':''} style="display:none;" /> ${esc(r)}
          </label>
        `).join('')}
      </div>
    </div>
    <div class="re-form-group">
      <label class="re-label">Perfil Econ\u00f4mico</label>
      <select class="re-select" data-field="client.economicProfile" style="max-width:250px;">
        <option value="standard" ${c.economicProfile==='standard'?'selected':''}>Standard</option>
        <option value="premium" ${c.economicProfile==='premium'?'selected':''}>Premium</option>
        <option value="luxury" ${c.economicProfile==='luxury'?'selected':''}>Luxury</option>
      </select>
    </div>
    <div class="re-form-group">
      <label class="re-label">Observa\u00e7\u00f5es</label>
      <textarea class="re-textarea" data-field="client.notes" rows="3" placeholder="Notas sobre o cliente...">${esc(c.notes)}</textarea>
    </div>
  `;
}

/* ── 1: Viagem ───────────────────────────────────────────── */
function renderViagemSection() {
  const t = currentRoteiro.travel;
  const dests = t.destinations || [];
  const totalNights = dests.reduce((sum, d) => sum + (parseInt(d.nights) || 0), 0);
  const endDate = t.startDate ? addDaysToDate(t.startDate, totalNights) : '';

  return `
    <div class="re-section-title">Viagem</div>
    <div class="re-row">
      <div class="re-form-group">
        <label class="re-label">Data In\u00edcio</label>
        <input class="re-input" type="date" data-field="travel.startDate" value="${t.startDate || ''}" />
      </div>
      <div class="re-form-group">
        <label class="re-label">Data Fim (auto)</label>
        <input class="re-input" type="date" id="re-end-date" value="${endDate}" readonly style="opacity:0.7;" />
      </div>
      <div class="re-form-group" style="flex:0 0 auto;display:flex;align-items:flex-end;">
        <span style="padding:8px 14px;background:var(--bg-surface,#222);border-radius:6px;
          font-weight:700;color:var(--text-primary);font-size:0.875rem;white-space:nowrap;">
          Total: <span id="re-total-nights">${totalNights}</span> noites
        </span>
      </div>
    </div>
    <label class="re-label" style="margin-bottom:8px;">Destinos</label>
    <div id="re-destinations">
      ${dests.map((d, i) => renderDestRow(d, i, dests.length)).join('')}
    </div>
    <button class="re-add-btn" data-action="add-dest">+ Adicionar Destino</button>
  `;
}

function renderDestRow(d, i, total) {
  const destOptions = allDestinations.length
    ? allDestinations.map(dest => {
        const label = `${dest.city || ''}, ${dest.country || ''}`.replace(/^, |, $/g, '');
        const selected = (d.city === dest.city && d.country === dest.country) ? 'selected' : '';
        return `<option value="${esc(dest.city||'')}|${esc(dest.country||'')}" ${selected}>${esc(label)}</option>`;
      }).join('')
    : '';

  return `
    <div class="re-dest-row" data-dest-idx="${i}">
      <div class="re-form-group" style="flex:2;">
        <label class="re-label" style="font-size:0.7rem;">Cidade</label>
        <input class="re-input" data-dest="city" value="${esc(d.city || '')}" placeholder="Cidade" />
      </div>
      <div class="re-form-group" style="flex:2;">
        <label class="re-label" style="font-size:0.7rem;">Pa\u00eds</label>
        <input class="re-input" data-dest="country" value="${esc(d.country || '')}" placeholder="Pa\u00eds" />
      </div>
      <div class="re-form-group" style="flex:0 0 80px;">
        <label class="re-label" style="font-size:0.7rem;">Noites</label>
        <input class="re-input" type="number" min="0" data-dest="nights" value="${d.nights || 1}" />
      </div>
      <div style="display:flex;gap:4px;align-items:flex-end;padding-bottom:2px;">
        ${i > 0 ? `<button class="re-remove-btn" data-action="move-dest-up" data-idx="${i}" title="Mover para cima">\u25B2</button>` : ''}
        ${i < total - 1 ? `<button class="re-remove-btn" data-action="move-dest-down" data-idx="${i}" title="Mover para baixo">\u25BC</button>` : ''}
        <button class="re-remove-btn" data-action="remove-dest" data-idx="${i}" title="Remover">\u2715</button>
      </div>
    </div>
  `;
}

/* ── 2: Dia a dia ────────────────────────────────────────── */
function renderDiaDiaSection() {
  const days = currentRoteiro.days || [];
  if (!days.length) {
    return `
      <div class="re-section-title">Dia a Dia</div>
      <div style="text-align:center;padding:30px;color:var(--text-muted);">
        <p>Nenhum dia gerado ainda.</p>
        <p style="font-size:0.8125rem;">Preencha as datas e destinos na se\u00e7\u00e3o Viagem e clique em "Gerar dias automaticamente".</p>
      </div>
      <button class="re-add-btn" data-action="generate-days" style="margin-top:8px;">Gerar dias automaticamente</button>
      <button class="re-add-btn" data-action="add-day" style="margin-left:8px;">+ Adicionar dia manualmente</button>
    `;
  }

  return `
    <div class="re-section-title">Dia a Dia</div>
    <div style="margin-bottom:12px;">
      <button class="re-add-btn" data-action="generate-days">Gerar dias automaticamente</button>
    </div>
    <div id="re-days-list">
      ${days.map((d, i) => renderDayCard(d, i)).join('')}
    </div>
    <button class="re-add-btn" data-action="add-day">+ Adicionar Dia</button>
  `;
}

function renderDayCard(d, i) {
  const dateLabel = currentRoteiro.travel.startDate
    ? formatDateForDay(currentRoteiro.travel.startDate, i)
    : (d.date || '');
  const activities = d.activities || [];

  return `
    <div class="re-day-card" data-day-idx="${i}">
      <div class="re-day-num">Dia ${d.dayNumber || i + 1}</div>
      <div class="re-day-date">${esc(dateLabel)} ${d.city ? '- ' + esc(d.city) : ''}</div>
      <div class="re-row" style="margin-top:10px;">
        <div class="re-form-group" style="flex:1;">
          <label class="re-label" style="font-size:0.7rem;">T\u00edtulo do Dia</label>
          <input class="re-input" data-day="title" value="${esc(d.title || '')}" placeholder="Ex: Chegada em Paris" />
        </div>
        <div class="re-form-group" style="flex:0 0 160px;">
          <label class="re-label" style="font-size:0.7rem;">Cidade</label>
          <input class="re-input" data-day="city" value="${esc(d.city || '')}" placeholder="Cidade" />
        </div>
      </div>
      <div class="re-form-group">
        <label class="re-label" style="font-size:0.7rem;">Narrativa</label>
        <textarea class="re-textarea" data-day="narrative" rows="4" placeholder="Descreva as atividades e experi\u00eancias do dia...">${esc(d.narrative || '')}</textarea>
      </div>
      <div class="re-form-group">
        <label class="re-label" style="font-size:0.7rem;">Atividades</label>
        <div id="re-activities-${i}">
          ${activities.map((act, ai) => `
            <div class="re-activity-row" data-activity-idx="${ai}">
              <input class="re-input" data-activity="time" value="${esc(act.time || '')}" placeholder="Hor\u00e1rio" style="width:80px;" />
              <input class="re-input" data-activity="description" value="${esc(act.description || '')}" placeholder="Descri\u00e7\u00e3o" style="flex:1;" />
              <select class="re-select" data-activity="type" style="width:120px;">
                <option value="passeio" ${act.type==='passeio'?'selected':''}>Passeio</option>
                <option value="refeicao" ${act.type==='refeicao'?'selected':''}>Refei\u00e7\u00e3o</option>
                <option value="transfer" ${act.type==='transfer'?'selected':''}>Transfer</option>
                <option value="livre" ${act.type==='livre'?'selected':''}>Livre</option>
              </select>
              <button class="re-remove-btn" data-action="remove-activity" data-day="${i}" data-aidx="${ai}">\u2715</button>
            </div>
          `).join('')}
        </div>
        <button class="re-add-btn" data-action="add-activity" data-day="${i}" style="font-size:0.75rem;padding:4px 10px;margin-top:4px;">+ Atividade</button>
      </div>
      <div class="re-row" style="margin-top:4px;">
        <div class="re-form-group" style="flex:0 0 200px;">
          <label class="re-label" style="font-size:0.7rem;">Pernoite</label>
          <input class="re-input" data-day="overnightCity" value="${esc(d.overnightCity || '')}" placeholder="Cidade do pernoite" />
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="re-add-btn" data-action="ai-day" data-idx="${i}" style="font-size:0.75rem;padding:4px 10px;">Gerar com IA</button>
        <button class="re-remove-btn" data-action="remove-day" data-idx="${i}" style="margin-left:auto;">\u2715 Remover</button>
      </div>
    </div>
  `;
}

/* ── 3: Hot\u00e9is ──────────────────────────────────────────── */
function renderHoteisSection() {
  const hotels = currentRoteiro.hotels || [];
  return `
    <div class="re-section-title">Hot\u00e9is</div>
    <table class="re-dyn-table">
      <thead>
        <tr>
          <th>Cidade</th><th>Nome do Hotel</th><th>Categoria Quarto</th><th>Regime</th>
          <th>Check-in</th><th>Check-out</th><th>Noites</th><th></th>
        </tr>
      </thead>
      <tbody id="re-hotels-body">
        ${hotels.map((h, i) => renderHotelRow(h, i)).join('')}
      </tbody>
    </table>
    <button class="re-add-btn" data-action="add-hotel">+ Adicionar Hotel</button>
  `;
}

function renderHotelRow(h, i) {
  const nights = (h.checkIn && h.checkOut) ? diffDays(h.checkIn, h.checkOut) : (h.nights || '');
  return `
    <tr data-hotel-idx="${i}">
      <td><input data-hotel="city" value="${esc(h.city || '')}" placeholder="Cidade" /></td>
      <td><input data-hotel="hotelName" value="${esc(h.hotelName || '')}" placeholder="Nome do hotel" /></td>
      <td><input data-hotel="roomType" value="${esc(h.roomType || '')}" placeholder="Categoria" /></td>
      <td><input data-hotel="regime" value="${esc(h.regime || '')}" placeholder="Regime" /></td>
      <td><input data-hotel="checkIn" type="date" value="${h.checkIn || ''}" /></td>
      <td><input data-hotel="checkOut" type="date" value="${h.checkOut || ''}" /></td>
      <td><input data-hotel="nights" type="number" value="${nights}" readonly style="opacity:0.7;width:55px;" /></td>
      <td><button class="re-remove-btn" data-action="remove-hotel" data-idx="${i}">\u2715</button></td>
    </tr>
  `;
}

/* ── 4: Valores ──────────────────────────────────────────── */
function renderValoresSection() {
  const p = currentRoteiro.pricing;
  const rows = p.customRows || [];
  return `
    <div class="re-section-title">Valores</div>
    <div class="re-row">
      <div class="re-form-group">
        <label class="re-label">Valor por Pessoa</label>
        <input class="re-input" type="number" step="0.01" data-field="pricing.perPerson" value="${p.perPerson || ''}" placeholder="0.00" />
      </div>
      <div class="re-form-group">
        <label class="re-label">Valor por Casal</label>
        <input class="re-input" type="number" step="0.01" data-field="pricing.perCouple" value="${p.perCouple || ''}" placeholder="0.00" />
      </div>
      <div class="re-form-group">
        <label class="re-label">Moeda</label>
        <select class="re-select" data-field="pricing.currency">
          <option value="BRL" ${p.currency==='BRL'?'selected':''}>BRL</option>
          <option value="USD" ${p.currency==='USD'?'selected':''}>USD</option>
          <option value="EUR" ${p.currency==='EUR'?'selected':''}>EUR</option>
        </select>
      </div>
    </div>
    <div class="re-form-group">
      <label class="re-label">Validade</label>
      <input class="re-input" type="date" data-field="pricing.validUntil" value="${p.validUntil || ''}" style="max-width:250px;" />
    </div>
    <div class="re-form-group">
      <label class="re-label">Disclaimer</label>
      <textarea class="re-textarea" data-field="pricing.disclaimer" rows="3">${esc(p.disclaimer || '')}</textarea>
    </div>
    <label class="re-label">Valores Adicionais</label>
    <table class="re-dyn-table">
      <thead><tr><th>Descri\u00e7\u00e3o</th><th>Valor</th><th></th></tr></thead>
      <tbody id="re-pricing-rows">
        ${rows.map((r, i) => `
          <tr data-prow-idx="${i}">
            <td><input data-prow="label" value="${esc(r.label || '')}" placeholder="Descri\u00e7\u00e3o" /></td>
            <td><input data-prow="value" value="${esc(r.value || '')}" placeholder="Valor" /></td>
            <td><button class="re-remove-btn" data-action="remove-prow" data-idx="${i}">\u2715</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <button class="re-add-btn" data-action="add-prow">+ Adicionar Linha</button>
  `;
}

/* ── 5: Opcionais ────────────────────────────────────────── */
function renderOpcionaisSection() {
  const opts = currentRoteiro.optionals || [];
  return `
    <div class="re-section-title">Opcionais</div>
    <table class="re-dyn-table">
      <thead>
        <tr><th>Servi\u00e7o</th><th>Pre\u00e7o Adulto</th><th>Pre\u00e7o Crian\u00e7a</th><th>Observa\u00e7\u00f5es</th><th></th></tr>
      </thead>
      <tbody id="re-optionals-body">
        ${opts.map((o, i) => `
          <tr data-opt-idx="${i}">
            <td><input data-opt="service" value="${esc(o.service || '')}" placeholder="Nome do servi\u00e7o" /></td>
            <td><input data-opt="priceAdult" type="number" step="0.01" value="${o.priceAdult || ''}" placeholder="0.00" /></td>
            <td><input data-opt="priceChild" type="number" step="0.01" value="${o.priceChild || ''}" placeholder="0.00" /></td>
            <td><input data-opt="notes" value="${esc(o.notes || '')}" placeholder="Notas" /></td>
            <td><button class="re-remove-btn" data-action="remove-opt" data-idx="${i}">\u2715</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <button class="re-add-btn" data-action="add-opt">+ Adicionar Opcional</button>
  `;
}

/* ── 6: Inclui / N\u00e3o inclui ─────────────────────────────── */
function renderIncluiSection() {
  const inc = currentRoteiro.includes || [];
  const exc = currentRoteiro.excludes || [];
  return `
    <div class="re-section-title">Inclui / N\u00e3o Inclui</div>
    <div style="margin-bottom:12px;display:flex;gap:8px;">
      <button class="re-add-btn" data-action="preset-includes" style="margin-top:0;">Adicionar padr\u00e3o (Inclui)</button>
      <button class="re-add-btn" data-action="preset-excludes" style="margin-top:0;">Adicionar padr\u00e3o (N\u00e3o Inclui)</button>
    </div>
    <div class="re-two-cols">
      <div>
        <label class="re-label" style="color:var(--brand-blue,#3B82F6);font-weight:700;">Inclui</label>
        <div class="re-list-col" id="re-includes-list">
          ${inc.map((item, i) => `
            <div class="re-list-item" data-inc-idx="${i}">
              <input class="re-input" data-inc="text" value="${esc(item)}" placeholder="Item incluso..." />
              <button class="re-remove-btn" data-action="remove-inc" data-idx="${i}">\u2715</button>
            </div>
          `).join('')}
        </div>
        <button class="re-add-btn" data-action="add-inc">+ Adicionar</button>
      </div>
      <div>
        <label class="re-label" style="color:#EF4444;font-weight:700;">N\u00e3o Inclui</label>
        <div class="re-list-col" id="re-excludes-list">
          ${exc.map((item, i) => `
            <div class="re-list-item" data-exc-idx="${i}">
              <input class="re-input" data-exc="text" value="${esc(item)}" placeholder="Item n\u00e3o incluso..." />
              <button class="re-remove-btn" data-action="remove-exc" data-idx="${i}">\u2715</button>
            </div>
          `).join('')}
        </div>
        <button class="re-add-btn" data-action="add-exc">+ Adicionar</button>
      </div>
    </div>
  `;
}

/* ── 7: Pagamento ────────────────────────────────────────── */
function renderPagamentoSection() {
  const p = currentRoteiro.payment;
  return `
    <div class="re-section-title">Pagamento</div>
    <div class="re-row">
      <div class="re-form-group">
        <label class="re-label">Sinal / Entrada</label>
        <input class="re-input" data-field="payment.deposit" value="${esc(p.deposit || '')}" placeholder="Ex: 30% no ato da reserva" />
      </div>
      <div class="re-form-group">
        <label class="re-label">Parcelas</label>
        <input class="re-input" data-field="payment.installments" value="${esc(p.installments || '')}" placeholder="Ex: Saldo em at\u00e9 3x sem juros" />
      </div>
    </div>
    <div class="re-form-group">
      <label class="re-label">Prazo</label>
      <input class="re-input" data-field="payment.deadline" value="${esc(p.deadline || '')}" placeholder="Ex: At\u00e9 30 dias antes do embarque" style="max-width:400px;" />
    </div>
    <div class="re-form-group">
      <label class="re-label">Observa\u00e7\u00f5es</label>
      <textarea class="re-textarea" data-field="payment.notes" rows="3" placeholder="Informa\u00e7\u00f5es adicionais sobre pagamento...">${esc(p.notes || '')}</textarea>
    </div>
  `;
}

/* ── 8: Cancelamento ─────────────────────────────────────── */
function renderCancelamentoSection() {
  const canc = currentRoteiro.cancellation || [];
  return `
    <div class="re-section-title">Cancelamento</div>
    <table class="re-dyn-table">
      <thead><tr><th>Per\u00edodo</th><th>Penalidade</th><th></th></tr></thead>
      <tbody id="re-canc-body">
        ${canc.map((c, i) => `
          <tr data-canc-idx="${i}">
            <td><input data-canc="period" value="${esc(c.period || '')}" placeholder="Ex: At\u00e9 30 dias antes" /></td>
            <td><input data-canc="penalty" value="${esc(c.penalty || '')}" placeholder="Ex: Sem custo" /></td>
            <td><button class="re-remove-btn" data-action="remove-canc" data-idx="${i}">\u2715</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div style="display:flex;gap:8px;margin-top:8px;">
      <button class="re-add-btn" data-action="add-canc">+ Adicionar Regra</button>
      <button class="re-add-btn" data-action="preset-canc">Adicionar pol\u00edtica padr\u00e3o</button>
    </div>
  `;
}

/* ── 9: Informa\u00e7\u00f5es Importantes ─────────────────────────── */
function renderInfoSection() {
  const info = currentRoteiro.importantInfo;
  const custom = info.customFields || [];
  return `
    <div class="re-section-title">Informa\u00e7\u00f5es Importantes</div>
    <div class="re-grid-2">
      <div class="re-form-group">
        <label class="re-label">Passaporte</label>
        <textarea class="re-textarea" data-field="importantInfo.passport" rows="2" placeholder="Informa\u00e7\u00f5es sobre passaporte...">${esc(info.passport || '')}</textarea>
      </div>
      <div class="re-form-group">
        <label class="re-label">Visto</label>
        <textarea class="re-textarea" data-field="importantInfo.visa" rows="2" placeholder="Informa\u00e7\u00f5es sobre visto...">${esc(info.visa || '')}</textarea>
      </div>
      <div class="re-form-group">
        <label class="re-label">Vacinas</label>
        <textarea class="re-textarea" data-field="importantInfo.vaccines" rows="2" placeholder="Vacinas recomendadas...">${esc(info.vaccines || '')}</textarea>
      </div>
      <div class="re-form-group">
        <label class="re-label">Clima</label>
        <textarea class="re-textarea" data-field="importantInfo.climate" rows="2" placeholder="Informa\u00e7\u00f5es sobre o clima...">${esc(info.climate || '')}</textarea>
      </div>
      <div class="re-form-group">
        <label class="re-label">Bagagem</label>
        <textarea class="re-textarea" data-field="importantInfo.luggage" rows="2" placeholder="Dicas sobre bagagem...">${esc(info.luggage || '')}</textarea>
      </div>
      <div class="re-form-group">
        <label class="re-label">Voos</label>
        <textarea class="re-textarea" data-field="importantInfo.flights" rows="2" placeholder="Informa\u00e7\u00f5es sobre voos...">${esc(info.flights || '')}</textarea>
      </div>
    </div>
    <label class="re-label">Campos Adicionais</label>
    <table class="re-dyn-table" style="margin-top:4px;">
      <thead><tr><th>Campo</th><th>Conte\u00fado</th><th></th></tr></thead>
      <tbody id="re-info-custom-body">
        ${custom.map((f, i) => `
          <tr data-infoc-idx="${i}">
            <td><input data-infoc="label" value="${esc(f.label || '')}" placeholder="Nome do campo" /></td>
            <td><textarea data-infoc="value" rows="2" placeholder="Conte\u00fado">${esc(f.value || '')}</textarea></td>
            <td><button class="re-remove-btn" data-action="remove-infoc" data-idx="${i}">\u2715</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <button class="re-add-btn" data-action="add-infoc">+ Adicionar Campo</button>
  `;
}

/* ── 10: Preview & Export ────────────────────────────────── */
function renderPreviewSection() {
  const areaOptions = allAreas.map(a =>
    `<option value="${esc(a.id)}" ${currentRoteiro.areaId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`
  ).join('');

  const r = currentRoteiro;
  const t = r.travel || {};
  const c = r.client || {};
  const dests = (t.destinations || []).map(d => d.city || d.country).filter(Boolean).join(' \u2192 ');
  const totalNights = (t.destinations || []).reduce((s, d) => s + (parseInt(d.nights) || 0), 0);

  return `
    <div class="re-section-title">Preview & Export</div>
    <div class="re-form-group">
      <label class="re-label">\u00c1rea / BU</label>
      <select class="re-select" data-field="areaId" id="re-area-select" style="max-width:300px;">
        <option value="">Padr\u00e3o</option>
        ${areaOptions}
      </select>
    </div>
    <div class="re-preview-summary">
      <strong>Resumo do Roteiro:</strong><br/>
      <strong>T\u00edtulo:</strong> ${esc(r.title) || '(sem t\u00edtulo)'}<br/>
      <strong>Cliente:</strong> ${esc(c.name) || '(n\u00e3o informado)'}<br/>
      <strong>Destinos:</strong> ${esc(dests) || '(nenhum)'}<br/>
      <strong>Per\u00edodo:</strong> ${t.startDate || '?'} a ${t.endDate || '?'} (${totalNights} noites)<br/>
      <strong>Dias:</strong> ${(r.days || []).length} dia(s) configurado(s)<br/>
      <strong>Hot\u00e9is:</strong> ${(r.hotels || []).length} hotel(\u00e9is)<br/>
      <strong>Status:</strong> ${esc(r.status)}
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button class="re-add-btn" data-action="export-pdf" style="margin-top:0;font-weight:700;">Exportar PDF</button>
      <button class="re-add-btn" data-action="export-pptx" style="margin-top:0;">Exportar PPTX</button>
      <button class="re-add-btn" data-action="gen-link" style="margin-top:0;">Gerar Web Link</button>
    </div>
  `;
}

/* ─── Collect form data from DOM ──────────────────────────── */
function collectFormData() {
  const container = document.getElementById('re-content-area');
  if (!container) return currentRoteiro;

  const data = JSON.parse(JSON.stringify(currentRoteiro));

  // Helper to set nested value
  function setNested(obj, path, val) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }

  // Collect all data-field inputs from the ENTIRE container (parent), not just active section
  const mainContainer = document.getElementById('re-editor-root');
  if (!mainContainer) return data;

  mainContainer.querySelectorAll('[data-field]').forEach(input => {
    const path = input.dataset.field;
    let v;
    if (input.type === 'number') {
      v = input.value === '' ? null : parseFloat(input.value);
    } else {
      v = input.value;
    }
    setNested(data, path, v);
  });

  // Children ages
  const ages = [];
  mainContainer.querySelectorAll('[data-age-idx]').forEach(input => {
    ages.push(parseInt(input.value) || 0);
  });
  if (ages.length) data.client.childrenAges = ages;

  // Preferences
  const prefs = [];
  mainContainer.querySelectorAll('#re-pref-group label.checked').forEach(lbl => {
    prefs.push(lbl.dataset.pref);
  });
  if (mainContainer.querySelector('#re-pref-group')) data.client.preferences = prefs;

  // Restrictions
  const rests = [];
  mainContainer.querySelectorAll('#re-rest-group label.checked').forEach(lbl => {
    rests.push(lbl.dataset.rest);
  });
  if (mainContainer.querySelector('#re-rest-group')) data.client.restrictions = rests;

  // Destinations
  const destRows = mainContainer.querySelectorAll('[data-dest-idx]');
  if (destRows.length || mainContainer.querySelector('#re-destinations')) {
    const dests = [];
    destRows.forEach(row => {
      dests.push({
        city:    row.querySelector('[data-dest="city"]')?.value?.trim() || '',
        country: row.querySelector('[data-dest="country"]')?.value?.trim() || '',
        nights:  parseInt(row.querySelector('[data-dest="nights"]')?.value) || 0,
      });
    });
    data.travel.destinations = dests;
    data.travel.nights = dests.reduce((s, d) => s + (d.nights || 0), 0);
    data.travel.endDate = data.travel.startDate ? addDaysToDate(data.travel.startDate, data.travel.nights) : '';
  }

  // Days
  const dayCards = mainContainer.querySelectorAll('[data-day-idx]');
  if (dayCards.length || mainContainer.querySelector('#re-days-list')) {
    const days = [];
    dayCards.forEach((card, idx) => {
      const existing = (currentRoteiro.days || [])[idx] || {};
      const activities = [];
      card.querySelectorAll('[data-activity-idx]').forEach(actRow => {
        activities.push({
          time:        actRow.querySelector('[data-activity="time"]')?.value?.trim() || '',
          description: actRow.querySelector('[data-activity="description"]')?.value?.trim() || '',
          type:        actRow.querySelector('[data-activity="type"]')?.value || 'passeio',
        });
      });
      days.push({
        dayNumber:     existing.dayNumber || idx + 1,
        date:          existing.date || (data.travel.startDate ? addDaysToDate(data.travel.startDate, idx) : ''),
        city:          card.querySelector('[data-day="city"]')?.value?.trim() || existing.city || '',
        title:         card.querySelector('[data-day="title"]')?.value?.trim() || '',
        narrative:     card.querySelector('[data-day="narrative"]')?.value?.trim() || '',
        overnightCity: card.querySelector('[data-day="overnightCity"]')?.value?.trim() || '',
        activities:    activities,
        imageIds:      existing.imageIds || [],
      });
    });
    data.days = days;
  }

  // Hotels
  const hotelRows = mainContainer.querySelectorAll('[data-hotel-idx]');
  if (hotelRows.length || mainContainer.querySelector('#re-hotels-body')) {
    const hotels = [];
    hotelRows.forEach(row => {
      const checkIn = row.querySelector('[data-hotel="checkIn"]')?.value || '';
      const checkOut = row.querySelector('[data-hotel="checkOut"]')?.value || '';
      const nights = (checkIn && checkOut) ? diffDays(checkIn, checkOut) : 0;
      hotels.push({
        city:      row.querySelector('[data-hotel="city"]')?.value?.trim() || '',
        hotelName: row.querySelector('[data-hotel="hotelName"]')?.value?.trim() || '',
        roomType:  row.querySelector('[data-hotel="roomType"]')?.value?.trim() || '',
        regime:    row.querySelector('[data-hotel="regime"]')?.value?.trim() || '',
        checkIn, checkOut, nights,
      });
    });
    data.hotels = hotels;
  }

  // Pricing custom rows
  const prows = [];
  mainContainer.querySelectorAll('[data-prow-idx]').forEach(row => {
    prows.push({
      label: row.querySelector('[data-prow="label"]')?.value?.trim() || '',
      value: row.querySelector('[data-prow="value"]')?.value?.trim() || '',
    });
  });
  if (mainContainer.querySelector('#re-pricing-rows')) data.pricing.customRows = prows;

  // Optionals
  const optionals = [];
  mainContainer.querySelectorAll('[data-opt-idx]').forEach(row => {
    optionals.push({
      service:    row.querySelector('[data-opt="service"]')?.value?.trim() || '',
      priceAdult: parseFloat(row.querySelector('[data-opt="priceAdult"]')?.value) || null,
      priceChild: parseFloat(row.querySelector('[data-opt="priceChild"]')?.value) || null,
      notes:      row.querySelector('[data-opt="notes"]')?.value?.trim() || '',
    });
  });
  if (mainContainer.querySelector('#re-optionals-body')) data.optionals = optionals;

  // Includes
  const includes = [];
  mainContainer.querySelectorAll('[data-inc-idx] [data-inc="text"]').forEach(input => {
    includes.push(input.value);
  });
  if (mainContainer.querySelector('#re-includes-list')) data.includes = includes;

  // Excludes
  const excludes = [];
  mainContainer.querySelectorAll('[data-exc-idx] [data-exc="text"]').forEach(input => {
    excludes.push(input.value);
  });
  if (mainContainer.querySelector('#re-excludes-list')) data.excludes = excludes;

  // Cancellation
  const canc = [];
  mainContainer.querySelectorAll('[data-canc-idx]').forEach(row => {
    canc.push({
      period:  row.querySelector('[data-canc="period"]')?.value?.trim() || '',
      penalty: row.querySelector('[data-canc="penalty"]')?.value?.trim() || '',
    });
  });
  if (mainContainer.querySelector('#re-canc-body')) data.cancellation = canc;

  // Important info custom fields
  const infoCust = [];
  mainContainer.querySelectorAll('[data-infoc-idx]').forEach(row => {
    infoCust.push({
      label: row.querySelector('[data-infoc="label"]')?.value?.trim() || '',
      value: row.querySelector('[data-infoc="value"]')?.value?.trim() || '',
    });
  });
  if (mainContainer.querySelector('#re-info-custom-body')) data.importantInfo.customFields = infoCust;

  return data;
}

/* ─── Save logic ──────────────────────────────────────────── */
async function handleSave() {
  try {
    currentRoteiro = collectFormData();
    // Clean empty strings from includes/excludes
    currentRoteiro.includes = (currentRoteiro.includes || []).map(s => (s || '').trim()).filter(Boolean);
    currentRoteiro.excludes = (currentRoteiro.excludes || []).map(s => (s || '').trim()).filter(Boolean);

    const indicator = document.getElementById('re-autosave-status');
    if (indicator) indicator.textContent = 'Salvando...';

    const newId = await saveRoteiro(currentRoteiro.id || null, currentRoteiro);
    isDirty = false;

    if (!currentRoteiro.id && newId) {
      currentRoteiro.id = newId;
      const hash = `#roteiro-editor?id=${newId}`;
      history.replaceState(null, '', hash);
    }

    if (indicator) indicator.textContent = 'Salvo';
    showToast('Roteiro salvo com sucesso!', 'success');
  } catch (err) {
    const indicator = document.getElementById('re-autosave-status');
    if (indicator) indicator.textContent = 'Erro ao salvar';
    showToast('Erro ao salvar: ' + err.message, 'error');
  }
}

/* ─── Mark dirty & auto-save ──────────────────────────────── */
function markDirty() {
  isDirty = true;
  const indicator = document.getElementById('re-autosave-status');
  if (indicator) indicator.textContent = 'Altera\u00e7\u00f5es n\u00e3o salvas';
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    if (isDirty) handleSave();
  }, 30000);
}

/* ─── Switch active section ───────────────────────────────── */
function switchSection(index) {
  // Save current section data before switching
  currentRoteiro = collectFormData();

  activeSection = index;

  // Update nav items
  const nav = document.getElementById('re-sidebar-nav');
  if (nav) {
    nav.querySelectorAll('.re-nav-item').forEach((item, i) => {
      item.classList.toggle('active', i === index);
    });
  }

  // Render new section content
  const content = document.getElementById('re-content-area');
  if (content) {
    content.innerHTML = renderSectionContent(index);
  }
}

/* ─── Generate empty days from travel data ────────────────── */
function generateDaysFromTravel() {
  const t = currentRoteiro.travel;
  if (!t.startDate) {
    showToast('Preencha a data de in\u00edcio na se\u00e7\u00e3o Viagem.', 'warning');
    return;
  }
  const dests = t.destinations || [];
  if (!dests.length) {
    showToast('Adicione pelo menos um destino.', 'warning');
    return;
  }
  const days = [];
  let dayNum = 0;
  const start = new Date(t.startDate + 'T12:00:00');
  for (const dest of dests) {
    const nights = parseInt(dest.nights) || 1;
    for (let n = 0; n <= nights; n++) {
      // Last night of last destination = departure day
      if (dest !== dests[dests.length - 1] && n >= nights) break;
      const date = new Date(start);
      date.setDate(date.getDate() + dayNum);
      days.push({
        dayNumber: dayNum + 1,
        date: date.toISOString().split('T')[0],
        title: '',
        city: dest.city || dest.country || '',
        narrative: '',
        activities: [],
        overnightCity: n < nights ? (dest.city || dest.country || '') : '',
        imageIds: [],
      });
      dayNum++;
    }
  }
  currentRoteiro.days = days;
  showToast(`${days.length} dias gerados!`, 'success');
}

/* ─── Event delegation handler ────────────────────────────── */
function handleEditorClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) {
    // Handle checkbox groups
    const cbLabel = e.target.closest('.re-checkbox-group label');
    if (cbLabel) {
      e.preventDefault();
      cbLabel.classList.toggle('checked');
      const cb = cbLabel.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = cbLabel.classList.contains('checked');
      markDirty();
      return;
    }
    // Handle nav items
    const navItem = e.target.closest('.re-nav-item');
    if (navItem && navItem.dataset.sectionIdx !== undefined) {
      switchSection(parseInt(navItem.dataset.sectionIdx));
      return;
    }
    return;
  }

  const action = target.dataset.action;
  const idx = parseInt(target.dataset.idx);

  switch (action) {
    /* ── Save ─────────────────────────────────────────────── */
    case 'save':
      handleSave();
      break;

    case 'back':
      if (isDirty) {
        if (confirm('Voc\u00ea tem altera\u00e7\u00f5es n\u00e3o salvas. Deseja sair sem salvar?')) {
          isDirty = false;
          location.hash = '#roteiros';
        }
      } else {
        location.hash = '#roteiros';
      }
      break;

    /* ── Destinations ─────────────────────────────────────── */
    case 'add-dest':
      currentRoteiro = collectFormData();
      currentRoteiro.travel.destinations.push({ city: '', country: '', nights: 1 });
      switchSection(1);
      markDirty();
      break;

    case 'remove-dest':
      currentRoteiro = collectFormData();
      currentRoteiro.travel.destinations.splice(idx, 1);
      switchSection(1);
      markDirty();
      break;

    case 'move-dest-up':
      currentRoteiro = collectFormData();
      if (idx > 0) {
        const dArr = currentRoteiro.travel.destinations;
        [dArr[idx - 1], dArr[idx]] = [dArr[idx], dArr[idx - 1]];
      }
      switchSection(1);
      markDirty();
      break;

    case 'move-dest-down':
      currentRoteiro = collectFormData();
      const destsDown = currentRoteiro.travel.destinations;
      if (idx < destsDown.length - 1) {
        [destsDown[idx], destsDown[idx + 1]] = [destsDown[idx + 1], destsDown[idx]];
      }
      switchSection(1);
      markDirty();
      break;

    /* ── Days ─────────────────────────────────────────────── */
    case 'generate-days':
      currentRoteiro = collectFormData();
      generateDaysFromTravel();
      switchSection(2);
      break;

    case 'add-day': {
      currentRoteiro = collectFormData();
      const lastDay = currentRoteiro.days[currentRoteiro.days.length - 1];
      const newDate = lastDay?.date ? addDaysToDate(lastDay.date, 1) : '';
      currentRoteiro.days.push({
        dayNumber: currentRoteiro.days.length + 1,
        date: newDate,
        city: '', title: '', narrative: '', overnightCity: '',
        activities: [], imageIds: [],
      });
      switchSection(2);
      markDirty();
      break;
    }

    case 'remove-day':
      currentRoteiro = collectFormData();
      currentRoteiro.days.splice(idx, 1);
      currentRoteiro.days.forEach((d, i) => d.dayNumber = i + 1);
      switchSection(2);
      markDirty();
      break;

    case 'ai-day':
      showToast('Gera\u00e7\u00e3o com IA dispon\u00edvel em breve.', 'info');
      break;

    case 'add-activity': {
      const dayIdx = parseInt(target.dataset.day);
      currentRoteiro = collectFormData();
      if (!currentRoteiro.days[dayIdx]) break;
      if (!currentRoteiro.days[dayIdx].activities) currentRoteiro.days[dayIdx].activities = [];
      currentRoteiro.days[dayIdx].activities.push({ time: '', description: '', type: 'passeio' });
      switchSection(2);
      markDirty();
      break;
    }

    case 'remove-activity': {
      const dIdx = parseInt(target.dataset.day);
      const aIdx = parseInt(target.dataset.aidx);
      currentRoteiro = collectFormData();
      if (currentRoteiro.days[dIdx]?.activities) {
        currentRoteiro.days[dIdx].activities.splice(aIdx, 1);
      }
      switchSection(2);
      markDirty();
      break;
    }

    /* ── Hotels ───────────────────────────────────────────── */
    case 'add-hotel':
      currentRoteiro = collectFormData();
      currentRoteiro.hotels.push({ city: '', hotelName: '', roomType: '', regime: '', checkIn: '', checkOut: '', nights: 0 });
      switchSection(3);
      markDirty();
      break;

    case 'remove-hotel':
      currentRoteiro = collectFormData();
      currentRoteiro.hotels.splice(idx, 1);
      switchSection(3);
      markDirty();
      break;

    /* ── Pricing rows ─────────────────────────────────────── */
    case 'add-prow':
      currentRoteiro = collectFormData();
      currentRoteiro.pricing.customRows.push({ label: '', value: '' });
      switchSection(4);
      markDirty();
      break;

    case 'remove-prow':
      currentRoteiro = collectFormData();
      currentRoteiro.pricing.customRows.splice(idx, 1);
      switchSection(4);
      markDirty();
      break;

    /* ── Optionals ────────────────────────────────────────── */
    case 'add-opt':
      currentRoteiro = collectFormData();
      currentRoteiro.optionals.push({ service: '', priceAdult: null, priceChild: null, notes: '' });
      switchSection(5);
      markDirty();
      break;

    case 'remove-opt':
      currentRoteiro = collectFormData();
      currentRoteiro.optionals.splice(idx, 1);
      switchSection(5);
      markDirty();
      break;

    /* ── Includes / Excludes ──────────────────────────────── */
    case 'add-inc':
      currentRoteiro = collectFormData();
      currentRoteiro.includes.push('');
      switchSection(6);
      markDirty();
      break;

    case 'remove-inc':
      currentRoteiro = collectFormData();
      currentRoteiro.includes.splice(idx, 1);
      switchSection(6);
      markDirty();
      break;

    case 'add-exc':
      currentRoteiro = collectFormData();
      currentRoteiro.excludes.push('');
      switchSection(6);
      markDirty();
      break;

    case 'remove-exc':
      currentRoteiro = collectFormData();
      currentRoteiro.excludes.splice(idx, 1);
      switchSection(6);
      markDirty();
      break;

    case 'preset-includes':
      currentRoteiro = collectFormData();
      INCLUDES_PRESETS.forEach(p => {
        if (!currentRoteiro.includes.includes(p)) currentRoteiro.includes.push(p);
      });
      switchSection(6);
      markDirty();
      showToast('Itens padr\u00e3o adicionados (Inclui).', 'success');
      break;

    case 'preset-excludes':
      currentRoteiro = collectFormData();
      EXCLUDES_PRESETS.forEach(p => {
        if (!currentRoteiro.excludes.includes(p)) currentRoteiro.excludes.push(p);
      });
      switchSection(6);
      markDirty();
      showToast('Itens padr\u00e3o adicionados (N\u00e3o Inclui).', 'success');
      break;

    /* ── Cancellation ─────────────────────────────────────── */
    case 'add-canc':
      currentRoteiro = collectFormData();
      currentRoteiro.cancellation.push({ period: '', penalty: '' });
      switchSection(8);
      markDirty();
      break;

    case 'remove-canc':
      currentRoteiro = collectFormData();
      currentRoteiro.cancellation.splice(idx, 1);
      switchSection(8);
      markDirty();
      break;

    case 'preset-canc':
      currentRoteiro = collectFormData();
      CANCELLATION_PRESETS.forEach(p => {
        const exists = currentRoteiro.cancellation.some(c => c.period === p.period);
        if (!exists) currentRoteiro.cancellation.push({ ...p });
      });
      switchSection(8);
      markDirty();
      showToast('Pol\u00edtica de cancelamento padr\u00e3o adicionada.', 'success');
      break;

    /* ── Important Info custom fields ─────────────────────── */
    case 'add-infoc':
      currentRoteiro = collectFormData();
      currentRoteiro.importantInfo.customFields.push({ label: '', value: '' });
      switchSection(9);
      markDirty();
      break;

    case 'remove-infoc':
      currentRoteiro = collectFormData();
      currentRoteiro.importantInfo.customFields.splice(idx, 1);
      switchSection(9);
      markDirty();
      break;

    /* ── Export ────────────────────────────────────────────── */
    case 'export-pdf': {
      currentRoteiro = collectFormData();
      if (!(currentRoteiro.days || []).length) {
        showToast('Adicione pelo menos um dia antes de exportar.', 'warning');
        break;
      }
      (async () => {
        try {
          // Sempre salvar antes de exportar (garante ID no Firestore)
          if (isDirty || !currentRoteiro.id) await handleSave();
          const areaId = document.getElementById('re-area-select')?.value || '';
          const area = allAreas.find(a => a.id === areaId) || null;
          await generateRoteiroForExport(currentRoteiro, areaId);
          showToast('PDF gerado com sucesso!', 'success');
        } catch (err) {
          showToast('Erro ao gerar PDF: ' + err.message, 'error');
        }
      })();
      break;
    }

    case 'export-pptx':
      showToast('Exporta\u00e7\u00e3o PPTX dispon\u00edvel em breve.', 'info');
      break;

    case 'gen-link':
      showToast('Gera\u00e7\u00e3o de link web dispon\u00edvel em breve.', 'info');
      break;
  }
}

/* ─── Handle input changes for hotel night calc & travel totals ── */
function handleEditorChange(e) {
  markDirty();

  const target = e.target;

  // Auto-calc hotel nights
  if (target.dataset.hotel === 'checkIn' || target.dataset.hotel === 'checkOut') {
    const row = target.closest('[data-hotel-idx]');
    if (row) {
      const ci = row.querySelector('[data-hotel="checkIn"]')?.value;
      const co = row.querySelector('[data-hotel="checkOut"]')?.value;
      const nightsInput = row.querySelector('[data-hotel="nights"]');
      if (ci && co && nightsInput) {
        nightsInput.value = diffDays(ci, co);
      }
    }
  }

  // Recalc travel totals
  if (target.dataset.dest === 'nights' || target.dataset.field === 'travel.startDate') {
    recalcTravelTotals();
  }

  // Children count change
  if (target.id === 're-children-count') {
    const count = parseInt(target.value) || 0;
    const agesDiv = document.getElementById('re-children-ages');
    const agesRow = document.getElementById('re-ages-row');
    if (agesDiv && agesRow) {
      agesDiv.style.display = count > 0 ? '' : 'none';
      const current = document.querySelectorAll('[data-age-idx]');
      const currentAges = Array.from(current).map(inp => parseInt(inp.value) || 0);
      let html = '';
      for (let i = 0; i < count; i++) {
        html += `<input class="re-input" type="number" min="0" max="17" data-age-idx="${i}" value="${currentAges[i] || 0}" style="width:70px;" />`;
      }
      agesRow.innerHTML = html;
    }
  }
}

function recalcTravelTotals() {
  const mainContainer = document.getElementById('re-editor-root');
  if (!mainContainer) return;
  const destRows = mainContainer.querySelectorAll('[data-dest-idx]');
  let totalNights = 0;
  destRows.forEach(row => {
    totalNights += parseInt(row.querySelector('[data-dest="nights"]')?.value) || 0;
  });
  const totalEl = mainContainer.querySelector('#re-total-nights');
  if (totalEl) totalEl.textContent = totalNights;

  const startInput = mainContainer.querySelector('[data-field="travel.startDate"]');
  const endInput = mainContainer.querySelector('#re-end-date');
  if (startInput?.value && endInput) {
    endInput.value = addDaysToDate(startInput.value, totalNights);
  }
}

/* ─── Main render ─────────────────────────────────────────── */
export async function renderRoteiroEditor(container) {
  // Permission check
  if (!store.canCreateRoteiro()) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--text-muted);">
        <div style="font-size:2rem;margin-bottom:12px;">\u{1F512}</div>
        <p style="font-size:1.1rem;font-weight:600;">Acesso Restrito</p>
        <p>Voc\u00ea n\u00e3o tem permiss\u00e3o para criar ou editar roteiros.</p>
      </div>`;
    return;
  }

  // Parse ID from hash
  const idMatch = location.hash.match(/[?&]id=([^&]+)/);
  const roteiroId = idMatch ? idMatch[1] : null;
  const isAiCreate = location.hash.includes('ai=1');

  // Show loading
  container.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-muted);">
    ${isAiCreate ? 'Carregando roteiro gerado por IA...' : 'Carregando editor...'}
  </div>`;

  try {
    // Check for AI-generated data in sessionStorage
    let aiData = null;
    if (isAiCreate) {
      const raw = sessionStorage.getItem('ai_roteiro_data');
      const ts = parseInt(sessionStorage.getItem('ai_roteiro_ts') || '0');
      if (raw && (Date.now() - ts) < 300000) { // 5 min TTL
        try { aiData = JSON.parse(raw); } catch (e) { /* ignore */ }
      }
      sessionStorage.removeItem('ai_roteiro_data');
      sessionStorage.removeItem('ai_roteiro_ts');
    }

    // Load data in parallel
    const [roteiroData, destinations, areas] = await Promise.all([
      roteiroId ? fetchRoteiro(roteiroId) : null,
      fetchDestinations().catch(() => []),
      fetchAreas().catch(() => []),
    ]);

    allDestinations = destinations || [];
    allAreas = areas || [];

    if (roteiroData) {
      currentRoteiro = roteiroData;
    } else if (aiData) {
      // Roteiro gerado pela IA
      currentRoteiro = aiData;
      currentRoteiro.status = 'draft';
      currentRoteiro.consultantId = store.get('user')?.uid || '';
      currentRoteiro.consultantName = store.get('user')?.displayName || '';
    } else {
      currentRoteiro = {
        status: 'draft',
        title: '',
        areaId: '',
        consultantId: store.get('user')?.uid,
        consultantName: store.get('user')?.displayName || '',
        client: {
          name: '', email: '', phone: '', type: 'individual',
          adults: 2, children: 0, childrenAges: [],
          preferences: [], restrictions: [],
          economicProfile: 'premium', notes: '',
        },
        travel: { startDate: '', endDate: '', nights: 0, destinations: [] },
        days: [],
        hotels: [],
        pricing: {
          perPerson: null, perCouple: null, currency: 'BRL',
          validUntil: '', disclaimer: '', customRows: [],
        },
        optionals: [],
        includes: [],
        excludes: [],
        payment: { deposit: '', installments: '', deadline: '', notes: '' },
        cancellation: [],
        importantInfo: {
          passport: '', visa: '', vaccines: '', climate: '',
          luggage: '', flights: '', customFields: [],
        },
      };
    }

    // Ensure all sub-objects
    currentRoteiro.client = currentRoteiro.client || {};
    currentRoteiro.client.childrenAges = currentRoteiro.client.childrenAges || [];
    currentRoteiro.client.preferences = currentRoteiro.client.preferences || [];
    currentRoteiro.client.restrictions = currentRoteiro.client.restrictions || [];
    currentRoteiro.travel = currentRoteiro.travel || {};
    currentRoteiro.travel.destinations = currentRoteiro.travel.destinations || [];
    currentRoteiro.days = currentRoteiro.days || [];
    currentRoteiro.hotels = currentRoteiro.hotels || [];
    currentRoteiro.pricing = currentRoteiro.pricing || {};
    currentRoteiro.pricing.customRows = currentRoteiro.pricing.customRows || [];
    currentRoteiro.optionals = currentRoteiro.optionals || [];
    currentRoteiro.includes = currentRoteiro.includes || [];
    currentRoteiro.excludes = currentRoteiro.excludes || [];
    currentRoteiro.payment = currentRoteiro.payment || {};
    currentRoteiro.cancellation = currentRoteiro.cancellation || [];
    currentRoteiro.importantInfo = currentRoteiro.importantInfo || {};
    currentRoteiro.importantInfo.customFields = currentRoteiro.importantInfo.customFields || [];

    const isAiGenerated = currentRoteiro.aiGenerated === true;
    const pageTitle = roteiroId ? 'Editar Roteiro' : (isAiGenerated ? 'Roteiro Gerado por IA' : 'Novo Roteiro');
    const statusLabel = currentRoteiro.status || 'draft';

    // Inject CSS
    const styleEl = document.createElement('style');
    styleEl.textContent = EDITOR_CSS;
    document.head.appendChild(styleEl);
    container._styleEl = styleEl;

    // Render page
    container.innerHTML = `
      <div id="re-editor-root">
        ${isAiGenerated && !roteiroId ? `
        <!-- AI Banner -->
        <div style="background:#FEF3C720;border:1px solid #F59E0B33;border-radius:10px;
          padding:14px 18px;margin-bottom:16px;display:flex;align-items:flex-start;gap:12px;">
          <span style="font-size:1.25rem;">◈</span>
          <div style="flex:1;">
            <div style="font-size:0.875rem;font-weight:600;color:#F59E0B;margin-bottom:4px;">
              Roteiro gerado por Intelig\u00eancia Artificial
            </div>
            <div style="font-size:0.8125rem;color:var(--text-muted);line-height:1.5;">
              Revise todas as se\u00e7\u00f5es antes de salvar. Verifique nomes de hot\u00e9is, pre\u00e7os,
              hor\u00e1rios e informa\u00e7\u00f5es importantes. A IA pode gerar dados imprecisos.
            </div>
            ${currentRoteiro.aiPrompt ? `
            <details style="margin-top:8px;">
              <summary style="font-size:0.75rem;color:var(--text-muted);cursor:pointer;">Prompt utilizado</summary>
              <p style="font-size:0.75rem;color:var(--text-muted);margin-top:6px;padding:8px;
                background:var(--bg-dark,#0C1926);border-radius:6px;white-space:pre-wrap;">${esc(currentRoteiro.aiPrompt)}</p>
            </details>
            ` : ''}
          </div>
          <button onclick="this.closest('div[style]').remove()" style="background:none;border:none;
            color:var(--text-muted);cursor:pointer;font-size:1.25rem;padding:0 4px;">&times;</button>
        </div>
        ` : ''}

        <!-- Header -->
        <div class="re-header">
          <button class="re-add-btn" data-action="back" style="margin-top:0;padding:6px 14px;font-size:0.8125rem;">\u2190 Voltar</button>
          <span class="re-header-title">${esc(pageTitle)}</span>
          <span class="status-badge">${esc(statusLabel)}</span>
          <span class="re-autosave" id="re-autosave-status">${roteiroId ? 'Carregado' : (isAiGenerated ? 'Gerado por IA — n\u00e3o salvo' : 'Novo roteiro')}</span>
          <button class="re-add-btn" data-action="save" style="margin-top:0;font-weight:700;padding:8px 20px;">Salvar</button>
          <button class="re-add-btn" data-action="export-pdf" style="margin-top:0;padding:8px 16px;">Exportar PDF</button>
        </div>

        <!-- Two-column layout -->
        <div class="re-layout">
          <!-- Sidebar nav -->
          <div class="re-sidebar" id="re-sidebar-nav">
            ${SECTIONS.map((s, i) => `
              <div class="re-nav-item${i === 0 ? ' active' : ''}" data-section-idx="${i}">
                <span>${s.icon}</span>
                <span>${s.label}</span>
              </div>
            `).join('')}
          </div>

          <!-- Content area -->
          <div class="re-content" id="re-content-area">
            ${renderSectionContent(0)}
          </div>
        </div>
      </div>
    `;

    // Event delegation
    container.addEventListener('click', handleEditorClick);
    container.addEventListener('input', handleEditorChange);
    container.addEventListener('change', handleEditorChange);

    // Keyboard shortcut: Ctrl+S / Cmd+S
    const keyHandler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    document.addEventListener('keydown', keyHandler);
    container._keyHandler = keyHandler;
    container._clickHandler = handleEditorClick;
    container._changeHandler = handleEditorChange;

    activeSection = 0;
    isDirty = false;

  } catch (err) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--text-muted);">
        <p style="font-size:1.1rem;font-weight:600;">Erro ao carregar</p>
        <p>${esc(err.message)}</p>
        <button class="re-add-btn" onclick="location.hash='#roteiros'" style="margin-top:16px;">Voltar</button>
      </div>`;
  }
}

/* ─── Destroy ─────────────────────────────────────────────── */
export function destroyRoteiroEditor() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = null;

  // Clean up event listeners
  const container = document.getElementById('re-editor-root')?.parentElement;
  if (container) {
    if (container._keyHandler) {
      document.removeEventListener('keydown', container._keyHandler);
    }
    if (container._clickHandler) {
      container.removeEventListener('click', container._clickHandler);
    }
    if (container._changeHandler) {
      container.removeEventListener('input', container._changeHandler);
      container.removeEventListener('change', container._changeHandler);
    }
    if (container._styleEl) {
      container._styleEl.remove();
    }
  }

  currentRoteiro = null;
  isDirty = false;
  allDestinations = [];
  allAreas = [];
  activeSection = 0;
}
