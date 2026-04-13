/**
 * PRIMETOUR — Roteiro Editor: Multi-section Itinerary Editor
 * Accordion-style editor with 11 collapsible sections
 */

import { store }  from '../store.js';
import { router } from '../router.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  fetchRoteiro, saveRoteiro, emptyRoteiro, generateDays,
  ROTEIRO_STATUSES, CLIENT_TYPES, ECONOMIC_PROFILES,
  PREFERENCE_OPTIONS, RESTRICTION_OPTIONS, CURRENCIES,
  INCLUDES_PRESETS, EXCLUDES_PRESETS,
} from '../services/roteiros.js';
import { CONTINENTS, fetchDestinations, fetchTip, fetchTips, fetchAreas, fetchImages } from '../services/portal.js';
import { generateRoteiroPDF, generateRoteiroPPTX } from '../services/roteiroGenerator.js';
import { fetchSkillsForModule, runSkill } from '../services/ai.js';
import { createWebLink, fetchRecentClients } from '../services/roteiros.js';

/* ─── Helpers ─────────────────────────────────────────────── */
const esc = s => (s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function fmtDateBR(d) {
  if (!d) return '';
  const dt = d.toDate ? d.toDate() : new Date(d);
  return dt.toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' });
}

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

/* ─── State ───────────────────────────────────────────────── */
let _container = null;
let _roteiroId = null;
let _data = null;
let _autoSaveTimer = null;
let _dirty = false;

/* ─── CSS ─────────────────────────────────────────────────── */
const EDITOR_CSS = `
.re-topbar {
  display:flex;align-items:center;gap:12px;padding:12px 0;margin-bottom:16px;
  border-bottom:1px solid var(--border-subtle);flex-wrap:wrap;
}
.re-topbar-title {
  font-size:1.25rem;font-weight:700;color:var(--text-primary);flex:1;min-width:200px;
}
.re-topbar .btn { flex-shrink:0; }
.re-autosave {
  font-size:0.75rem;color:var(--text-muted);margin-left:8px;
}
.re-section {
  border:1px solid var(--border-subtle);border-radius:var(--radius-lg);margin-bottom:8px;overflow:hidden;
}
.re-section-header {
  padding:12px 16px;background:var(--bg-surface);cursor:pointer;display:flex;
  align-items:center;justify-content:space-between;font-weight:600;color:var(--text-primary);
}
.re-section-header:hover { background:var(--bg-card); }
.re-section-body { padding:16px 20px;display:none; }
.re-section.open .re-section-body { display:block; }
.re-section-header .chevron { transition:transform 0.2s; }
.re-section.open .re-section-header .chevron { transform:rotate(90deg); }
.re-row { display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px; }
.re-row > .form-group { flex:1;min-width:180px; }
.re-grid-2 { display:grid;grid-template-columns:1fr 1fr;gap:12px; }
.re-grid-3 { display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px; }
.re-checkbox-group { display:flex;flex-wrap:wrap;gap:8px;margin-top:4px; }
.re-checkbox-group label {
  display:flex;align-items:center;gap:5px;font-size:0.8125rem;color:var(--text-secondary);
  padding:4px 10px;border:1px solid var(--border-subtle);border-radius:var(--radius-full);
  cursor:pointer;transition:all 0.15s;user-select:none;
}
.re-checkbox-group label:hover { background:var(--bg-surface); }
.re-checkbox-group label.checked {
  background:var(--brand-gold);color:#000;border-color:var(--brand-gold);
}
.re-dyn-table { width:100%;border-collapse:collapse;font-size:0.8125rem; }
.re-dyn-table th {
  text-align:left;padding:6px 8px;font-weight:600;color:var(--text-muted);
  border-bottom:1px solid var(--border-subtle);font-size:0.75rem;
}
.re-dyn-table td { padding:4px 6px; }
.re-dyn-table input, .re-dyn-table select, .re-dyn-table textarea {
  width:100%;padding:6px 8px;border:1px solid var(--border-subtle);border-radius:var(--radius-md);
  background:var(--bg-card);color:var(--text-primary);font-size:0.8125rem;
}
.re-dyn-table textarea { resize:vertical;min-height:32px; }
.re-add-btn {
  display:inline-flex;align-items:center;gap:4px;padding:6px 14px;font-size:0.8125rem;
  font-weight:600;color:var(--brand-gold);background:transparent;
  border:1px dashed var(--brand-gold);border-radius:var(--radius-md);
  cursor:pointer;margin-top:8px;transition:all 0.15s;
}
.re-add-btn:hover { background:var(--brand-gold);color:#000; }
.re-remove-btn {
  background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1rem;
  padding:2px 6px;border-radius:var(--radius-md);transition:all 0.15s;
}
.re-remove-btn:hover { background:rgba(239,68,68,0.1);color:#EF4444; }
.re-day-card {
  border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:16px;
  margin-bottom:12px;position:relative;background:var(--bg-card);
}
.re-day-card .re-day-num {
  position:absolute;top:-1px;left:16px;background:var(--brand-gold);color:#000;
  font-weight:700;font-size:0.75rem;padding:2px 10px;border-radius:0 0 var(--radius-md) var(--radius-md);
}
.re-day-card .re-day-date {
  font-size:0.75rem;color:var(--text-muted);margin-bottom:8px;padding-left:60px;
}
.re-two-cols { display:grid;grid-template-columns:1fr 1fr;gap:20px; }
.re-list-col { display:flex;flex-direction:column;gap:6px; }
.re-list-item {
  display:flex;align-items:center;gap:6px;padding:4px 0;
}
.re-list-item input { flex:1; }
.re-timeline-line {
  position:absolute;left:28px;top:0;bottom:0;width:2px;background:var(--border-subtle);z-index:0;
}
@media (max-width:768px) {
  .re-grid-2, .re-grid-3, .re-two-cols { grid-template-columns:1fr; }
  .re-row { flex-direction:column; }
}
`;

/* ─── Section builder ─────────────────────────────────────── */
function sectionHTML(id, title, bodyHTML, openByDefault = false) {
  return `
    <div class="re-section${openByDefault ? ' open' : ''}" data-section="${id}">
      <div class="re-section-header" data-toggle="${id}">
        <span>${title}</span>
        <span class="chevron">&#9656;</span>
      </div>
      <div class="re-section-body">${bodyHTML}</div>
    </div>`;
}

/* ─── Section renderers ───────────────────────────────────── */

function renderClientSection() {
  const c = _data.client;
  return `
    <div class="re-row">
      <div class="form-group">
        <label class="form-label">Nome do Cliente</label>
        <input class="form-input" data-field="client.name" value="${esc(c.name)}" placeholder="Nome completo" list="re-recent-clients" />
        <datalist id="re-recent-clients"></datalist>
      </div>
      <div class="form-group">
        <label class="form-label">E-mail</label>
        <input class="form-input" type="email" data-field="client.email" value="${esc(c.email)}" placeholder="email@exemplo.com" />
      </div>
      <div class="form-group">
        <label class="form-label">Telefone</label>
        <input class="form-input" data-field="client.phone" value="${esc(c.phone)}" placeholder="+55 11 99999-0000" />
      </div>
    </div>
    <div class="re-row">
      <div class="form-group">
        <label class="form-label">Tipo de Cliente</label>
        <select class="form-select" data-field="client.type">
          ${CLIENT_TYPES.map(t => `<option value="${t.key}" ${c.type===t.key?'selected':''}>${t.label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Adultos</label>
        <input class="form-input" type="number" min="1" data-field="client.adults" value="${c.adults||2}" />
      </div>
      <div class="form-group">
        <label class="form-label">Criancas</label>
        <input class="form-input" type="number" min="0" data-field="client.children" value="${c.children||0}" />
      </div>
    </div>
    <div id="re-children-ages" style="margin-bottom:12px;${c.children > 0 ? '' : 'display:none;'}">
      <label class="form-label">Idades das Criancas</label>
      <div class="re-row" id="re-ages-row">
        ${(c.childrenAges||[]).map((age, i) => `
          <input class="form-input" type="number" min="0" max="17" data-age-idx="${i}" value="${age}" style="width:70px;" />
        `).join('')}
      </div>
    </div>
    <div class="form-group" style="margin-bottom:12px;">
      <label class="form-label">Preferencias</label>
      <div class="re-checkbox-group" id="re-pref-group">
        ${PREFERENCE_OPTIONS.map(p => `
          <label class="${(c.preferences||[]).includes(p)?'checked':''}" data-pref="${esc(p)}">
            <input type="checkbox" ${(c.preferences||[]).includes(p)?'checked':''} style="display:none;" /> ${esc(p)}
          </label>
        `).join('')}
      </div>
    </div>
    <div class="form-group" style="margin-bottom:12px;">
      <label class="form-label">Restricoes</label>
      <div class="re-checkbox-group" id="re-rest-group">
        ${RESTRICTION_OPTIONS.map(r => `
          <label class="${(c.restrictions||[]).includes(r)?'checked':''}" data-rest="${esc(r)}">
            <input type="checkbox" ${(c.restrictions||[]).includes(r)?'checked':''} style="display:none;" /> ${esc(r)}
          </label>
        `).join('')}
      </div>
    </div>
    <div class="re-row">
      <div class="form-group">
        <label class="form-label">Perfil Economico</label>
        <select class="form-select" data-field="client.economicProfile">
          ${ECONOMIC_PROFILES.map(e => `<option value="${e.key}" ${c.economicProfile===e.key?'selected':''}>${e.label}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Ideia de Viagem / Notas</label>
      <textarea class="form-textarea" data-field="client.notes" rows="3" placeholder="Descreva a ideia de viagem do cliente...">${esc(c.notes)}</textarea>
    </div>
  `;
}

function renderTravelSection() {
  const t = _data.travel;
  const dests = t.destinations || [];
  const totalNights = dests.reduce((sum, d) => sum + (parseInt(d.nights)||0), 0);
  const endDate = t.startDate ? addDaysToDate(t.startDate, totalNights) : '';

  return `
    <div class="re-row">
      <div class="form-group">
        <label class="form-label">Data de Inicio</label>
        <input class="form-input" type="date" data-field="travel.startDate" value="${t.startDate||''}" />
      </div>
      <div class="form-group">
        <label class="form-label">Data de Termino (auto)</label>
        <input class="form-input" type="date" id="re-end-date" value="${endDate}" readonly style="opacity:0.7;" />
      </div>
      <div class="form-group" style="flex:0 0 auto;display:flex;align-items:flex-end;">
        <span style="padding:8px 14px;background:var(--bg-surface);border-radius:var(--radius-md);
          font-weight:700;color:var(--text-primary);font-size:0.875rem;white-space:nowrap;">
          Total: <span id="re-total-nights">${totalNights}</span> noites
        </span>
      </div>
    </div>
    <label class="form-label" style="margin-bottom:8px;">Destinos</label>
    <div id="re-destinations">
      ${dests.map((d, i) => destinationRowHTML(d, i)).join('')}
    </div>
    <button class="re-add-btn" id="re-add-dest">+ Adicionar Destino</button>
    <div style="margin-top:16px;">
      <button class="btn btn-secondary" id="re-gen-days" style="gap:6px;">
        Auto-gerar dias
      </button>
    </div>
  `;
}

function destinationRowHTML(d, i) {
  return `
    <div class="re-row" data-dest-idx="${i}" style="align-items:flex-end;margin-bottom:8px;">
      <div class="form-group" style="flex:2;">
        <label class="form-label" style="font-size:0.75rem;">Cidade</label>
        <input class="form-input" data-dest="city" value="${esc(d.city||'')}" placeholder="Cidade" />
      </div>
      <div class="form-group" style="flex:2;">
        <label class="form-label" style="font-size:0.75rem;">Pais</label>
        <input class="form-input" data-dest="country" value="${esc(d.country||'')}" placeholder="Pais" />
      </div>
      <div class="form-group" style="flex:2;">
        <label class="form-label" style="font-size:0.75rem;">Continente</label>
        <select class="form-select" data-dest="continent">
          <option value="">Selecione...</option>
          ${CONTINENTS.map(c => `<option value="${esc(c)}" ${d.continent===c?'selected':''}>${esc(c)}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="flex:0 0 80px;">
        <label class="form-label" style="font-size:0.75rem;">Noites</label>
        <input class="form-input" type="number" min="0" data-dest="nights" value="${d.nights||1}" />
      </div>
      <button class="re-remove-btn" data-remove-dest="${i}" title="Remover destino">&#10005;</button>
    </div>
  `;
}

function renderDaysSection() {
  const days = _data.days || [];
  if (!days.length) {
    return `
      <div style="text-align:center;padding:30px;color:var(--text-muted);">
        <p>Nenhum dia gerado ainda.</p>
        <p style="font-size:0.8125rem;">Use o botao "Auto-gerar dias" na secao Viagem para criar os dias automaticamente.</p>
      </div>
    `;
  }
  return `
    <div id="re-days-list" style="position:relative;">
      ${days.map((d, i) => dayCardHTML(d, i)).join('')}
    </div>
    <button class="re-add-btn" id="re-add-day">+ Adicionar Dia</button>
  `;
}

function dayCardHTML(d, i) {
  return `
    <div class="re-day-card" data-day-idx="${i}">
      <div class="re-day-num">Dia ${d.dayNumber || i+1}</div>
      <div class="re-day-date">${d.date || ''} ${d.city ? '- ' + esc(d.city) : ''}</div>
      <div class="re-row" style="margin-top:8px;">
        <div class="form-group" style="flex:1;">
          <label class="form-label" style="font-size:0.75rem;">Titulo do Dia</label>
          <input class="form-input" data-day="title" value="${esc(d.title||'')}" placeholder="Ex: Chegada em Paris" />
        </div>
        <div class="form-group" style="flex:0 0 180px;">
          <label class="form-label" style="font-size:0.75rem;">Cidade Pernoite</label>
          <input class="form-input" data-day="overnightCity" value="${esc(d.overnightCity||'')}" placeholder="Cidade" />
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" style="font-size:0.75rem;">Narrativa</label>
        <textarea class="form-textarea" data-day="narrative" rows="4" placeholder="Descreva as atividades e experiencias do dia...">${esc(d.narrative||'')}</textarea>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn btn-secondary" style="font-size:0.75rem;padding:4px 10px;" data-day-ai="${i}">
          Gerar com IA
        </button>
        <button class="re-remove-btn" data-remove-day="${i}" title="Remover dia" style="margin-left:auto;">&#10005; Remover</button>
      </div>
    </div>
  `;
}

function renderHotelsSection() {
  const hotels = _data.hotels || [];
  return `
    <table class="re-dyn-table">
      <thead>
        <tr>
          <th>Cidade</th><th>Hotel</th><th>Tipo de Quarto</th><th>Regime</th>
          <th>Check-in</th><th>Check-out</th><th>Noites</th><th></th>
        </tr>
      </thead>
      <tbody id="re-hotels-body">
        ${hotels.map((h, i) => hotelRowHTML(h, i)).join('')}
      </tbody>
    </table>
    <button class="re-add-btn" id="re-add-hotel">+ Adicionar Hotel</button>
  `;
}

function hotelRowHTML(h, i) {
  const nights = (h.checkIn && h.checkOut) ? diffDays(h.checkIn, h.checkOut) : (h.nights || '');
  return `
    <tr data-hotel-idx="${i}">
      <td><input data-hotel="city" value="${esc(h.city||'')}" placeholder="Cidade" /></td>
      <td><input data-hotel="hotelName" value="${esc(h.hotelName||'')}" placeholder="Nome do hotel" /></td>
      <td><input data-hotel="roomType" value="${esc(h.roomType||'')}" placeholder="Tipo de quarto" /></td>
      <td><input data-hotel="regime" value="${esc(h.regime||'')}" placeholder="Regime" /></td>
      <td><input data-hotel="checkIn" type="date" value="${h.checkIn||''}" /></td>
      <td><input data-hotel="checkOut" type="date" value="${h.checkOut||''}" /></td>
      <td><input data-hotel="nights" type="number" value="${nights}" readonly style="opacity:0.7;width:50px;" /></td>
      <td><button class="re-remove-btn" data-remove-hotel="${i}">&#10005;</button></td>
    </tr>
  `;
}

function renderPricingSection() {
  const p = _data.pricing;
  const rows = p.customRows || [];
  return `
    <div class="re-row">
      <div class="form-group">
        <label class="form-label">Moeda</label>
        <select class="form-select" data-field="pricing.currency">
          ${CURRENCIES.map(c => `<option value="${c}" ${p.currency===c?'selected':''}>${c}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Valor por Pessoa</label>
        <input class="form-input" type="number" step="0.01" data-field="pricing.perPerson" value="${p.perPerson||''}" placeholder="0.00" />
      </div>
      <div class="form-group">
        <label class="form-label">Valor por Casal</label>
        <input class="form-input" type="number" step="0.01" data-field="pricing.perCouple" value="${p.perCouple||''}" placeholder="0.00" />
      </div>
    </div>
    <div class="re-row">
      <div class="form-group">
        <label class="form-label">Valido Ate</label>
        <input class="form-input" type="date" data-field="pricing.validUntil" value="${p.validUntil||''}" />
      </div>
    </div>
    <div class="form-group" style="margin-bottom:12px;">
      <label class="form-label">Disclaimer</label>
      <textarea class="form-textarea" data-field="pricing.disclaimer" rows="3">${esc(p.disclaimer||'')}</textarea>
    </div>
    <label class="form-label">Valores Adicionais</label>
    <table class="re-dyn-table" style="margin-top:4px;">
      <thead><tr><th>Descricao</th><th>Valor</th><th></th></tr></thead>
      <tbody id="re-pricing-rows">
        ${rows.map((r, i) => `
          <tr data-prow-idx="${i}">
            <td><input data-prow="label" value="${esc(r.label||'')}" placeholder="Descricao" /></td>
            <td><input data-prow="value" value="${esc(r.value||'')}" placeholder="Valor" /></td>
            <td><button class="re-remove-btn" data-remove-prow="${i}">&#10005;</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <button class="re-add-btn" id="re-add-prow">+ Adicionar Linha</button>
  `;
}

function renderOptionalsSection() {
  const opts = _data.optionals || [];
  return `
    <table class="re-dyn-table">
      <thead><tr><th>Servico</th><th>Preco Adulto</th><th>Preco Crianca</th><th>Observacoes</th><th></th></tr></thead>
      <tbody id="re-optionals-body">
        ${opts.map((o, i) => `
          <tr data-opt-idx="${i}">
            <td><input data-opt="service" value="${esc(o.service||'')}" placeholder="Nome do servico" /></td>
            <td><input data-opt="priceAdult" type="number" step="0.01" value="${o.priceAdult||''}" placeholder="0.00" /></td>
            <td><input data-opt="priceChild" type="number" step="0.01" value="${o.priceChild||''}" placeholder="0.00" /></td>
            <td><input data-opt="notes" value="${esc(o.notes||'')}" placeholder="Notas" /></td>
            <td><button class="re-remove-btn" data-remove-opt="${i}">&#10005;</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <button class="re-add-btn" id="re-add-opt">+ Adicionar Opcional</button>
  `;
}

function renderIncExcSection() {
  const inc = _data.includes || [];
  const exc = _data.excludes || [];
  return `
    <div style="margin-bottom:12px;">
      <button class="btn btn-secondary" id="re-load-presets" style="font-size:0.8125rem;padding:6px 14px;">
        Carregar Presets
      </button>
    </div>
    <div class="re-two-cols">
      <div>
        <label class="form-label" style="color:var(--brand-gold);font-weight:700;">Inclui</label>
        <div class="re-list-col" id="re-includes-list">
          ${inc.map((item, i) => `
            <div class="re-list-item" data-inc-idx="${i}">
              <input class="form-input" data-inc="text" value="${esc(item)}" />
              <button class="re-remove-btn" data-remove-inc="${i}">&#10005;</button>
            </div>
          `).join('')}
        </div>
        <button class="re-add-btn" id="re-add-inc">+ Adicionar</button>
      </div>
      <div>
        <label class="form-label" style="color:#EF4444;font-weight:700;">Nao Inclui</label>
        <div class="re-list-col" id="re-excludes-list">
          ${exc.map((item, i) => `
            <div class="re-list-item" data-exc-idx="${i}">
              <input class="form-input" data-exc="text" value="${esc(item)}" />
              <button class="re-remove-btn" data-remove-exc="${i}">&#10005;</button>
            </div>
          `).join('')}
        </div>
        <button class="re-add-btn" id="re-add-exc">+ Adicionar</button>
      </div>
    </div>
  `;
}

function renderPaymentSection() {
  const p = _data.payment;
  return `
    <div class="re-row">
      <div class="form-group">
        <label class="form-label">Deposito / Sinal</label>
        <input class="form-input" data-field="payment.deposit" value="${esc(p.deposit||'')}" placeholder="Ex: 30% no ato da reserva" />
      </div>
      <div class="form-group">
        <label class="form-label">Parcelamento</label>
        <input class="form-input" data-field="payment.installments" value="${esc(p.installments||'')}" placeholder="Ex: Saldo em ate 3x sem juros" />
      </div>
    </div>
    <div class="re-row">
      <div class="form-group">
        <label class="form-label">Prazo</label>
        <input class="form-input" data-field="payment.deadline" value="${esc(p.deadline||'')}" placeholder="Ex: Ate 30 dias antes do embarque" />
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Observacoes de Pagamento</label>
      <textarea class="form-textarea" data-field="payment.notes" rows="3" placeholder="Informacoes adicionais sobre pagamento...">${esc(p.notes||'')}</textarea>
    </div>
  `;
}

function renderCancellationSection() {
  const canc = _data.cancellation || [];
  return `
    <table class="re-dyn-table">
      <thead><tr><th>Periodo</th><th>Penalidade</th><th></th></tr></thead>
      <tbody id="re-canc-body">
        ${canc.map((c, i) => `
          <tr data-canc-idx="${i}">
            <td><input data-canc="period" value="${esc(c.period||'')}" placeholder="Ex: Entre 90 e 45 dias" /></td>
            <td><input data-canc="penalty" value="${esc(c.penalty||'')}" placeholder="Ex: 80% do valor total" /></td>
            <td><button class="re-remove-btn" data-remove-canc="${i}">&#10005;</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <button class="re-add-btn" id="re-add-canc">+ Adicionar Regra</button>
  `;
}

function renderImportantInfoSection() {
  const info = _data.importantInfo;
  const custom = info.customFields || [];
  return `
    <div class="re-grid-2" style="margin-bottom:12px;">
      <div class="form-group">
        <label class="form-label">Passaporte</label>
        <textarea class="form-textarea" data-field="importantInfo.passport" rows="2" placeholder="Informacoes sobre passaporte...">${esc(info.passport||'')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Visto</label>
        <textarea class="form-textarea" data-field="importantInfo.visa" rows="2" placeholder="Informacoes sobre visto...">${esc(info.visa||'')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Vacinas</label>
        <textarea class="form-textarea" data-field="importantInfo.vaccines" rows="2" placeholder="Vacinas recomendadas ou obrigatorias...">${esc(info.vaccines||'')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Clima</label>
        <textarea class="form-textarea" data-field="importantInfo.climate" rows="2" placeholder="Informacoes sobre o clima...">${esc(info.climate||'')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Bagagem</label>
        <textarea class="form-textarea" data-field="importantInfo.luggage" rows="2" placeholder="Dicas sobre bagagem...">${esc(info.luggage||'')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Voos</label>
        <textarea class="form-textarea" data-field="importantInfo.flights" rows="2" placeholder="Informacoes sobre voos...">${esc(info.flights||'')}</textarea>
      </div>
    </div>
    <label class="form-label">Campos Adicionais</label>
    <table class="re-dyn-table" style="margin-top:4px;">
      <thead><tr><th>Campo</th><th>Conteudo</th><th></th></tr></thead>
      <tbody id="re-info-custom-body">
        ${custom.map((f, i) => `
          <tr data-infoc-idx="${i}">
            <td><input data-infoc="label" value="${esc(f.label||'')}" placeholder="Nome do campo" /></td>
            <td><textarea data-infoc="value" rows="2" placeholder="Conteudo">${esc(f.value||'')}</textarea></td>
            <td><button class="re-remove-btn" data-remove-infoc="${i}">&#10005;</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <button class="re-add-btn" id="re-add-infoc">+ Adicionar Campo</button>
    <div style="margin-top:16px;">
      <button class="btn btn-secondary" id="re-autofill-portal" style="font-size:0.8125rem;padding:6px 14px;">
        Auto-preencher do Portal
      </button>
    </div>
  `;
}

function renderPreviewSection() {
  return `
    <div class="re-row">
      <div class="form-group" style="flex:2;">
        <label class="form-label">Titulo do Roteiro</label>
        <input class="form-input" data-field="title" value="${esc(_data.title||'')}" placeholder="Ex: Lua de Mel Europa 2026" />
      </div>
      <div class="form-group">
        <label class="form-label">Area / BU (identidade visual)</label>
        <select class="form-select" id="re-area-select" data-field="areaId">
          <option value="">Padrão Primetour</option>
        </select>
        <span id="re-area-loading" style="font-size:0.75rem;color:var(--text-muted);">Carregando áreas...</span>
      </div>
    </div>
    <div class="re-row">
      <div class="form-group">
        <label class="form-label">Status</label>
        <select class="form-select" data-field="status">
          ${ROTEIRO_STATUSES.map(s => `<option value="${s.key}" ${_data.status===s.key?'selected':''}>${s.label}</option>`).join('')}
        </select>
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;">
      <button class="btn btn-primary" id="re-export-pdf" style="gap:6px;">
        Exportar PDF
      </button>
      <button class="btn btn-secondary" id="re-export-pptx" style="gap:6px;">
        Exportar PPTX
      </button>
      <button class="btn btn-secondary" id="re-gen-link" style="gap:6px;">
        Gerar Link Web
      </button>
    </div>
    <div id="re-web-link-result" style="display:none;margin-top:12px;padding:12px;background:var(--bg-surface);border-radius:var(--radius-md);">
    </div>
  `;
}

/* ─── Collect all form data ───────────────────────────────── */
function collectData() {
  const el = (sel) => _container.querySelector(sel);
  const val = (sel) => (el(sel)?.value ?? '').trim();
  const numVal = (sel) => { const v = parseFloat(el(sel)?.value); return isNaN(v) ? null : v; };

  // Simple fields via data-field
  const fieldMap = {};
  _container.querySelectorAll('[data-field]').forEach(input => {
    const path = input.dataset.field;
    const v = input.type === 'number' ? (input.value === '' ? null : parseFloat(input.value)) : input.value;
    fieldMap[path] = v;
  });

  // Build nested object from fieldMap
  function setNested(obj, path, val) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }

  const data = JSON.parse(JSON.stringify(_data));

  for (const [path, v] of Object.entries(fieldMap)) {
    setNested(data, path, v);
  }

  // Client children ages
  const ages = [];
  _container.querySelectorAll('[data-age-idx]').forEach(input => {
    ages.push(parseInt(input.value) || 0);
  });
  data.client.childrenAges = ages;

  // Client preferences
  const prefs = [];
  _container.querySelectorAll('#re-pref-group label.checked').forEach(lbl => {
    prefs.push(lbl.dataset.pref);
  });
  data.client.preferences = prefs;

  // Client restrictions
  const rests = [];
  _container.querySelectorAll('#re-rest-group label.checked').forEach(lbl => {
    rests.push(lbl.dataset.rest);
  });
  data.client.restrictions = rests;

  // Destinations
  const dests = [];
  _container.querySelectorAll('[data-dest-idx]').forEach(row => {
    dests.push({
      city:      row.querySelector('[data-dest="city"]')?.value?.trim() || '',
      country:   row.querySelector('[data-dest="country"]')?.value?.trim() || '',
      continent: row.querySelector('[data-dest="continent"]')?.value || '',
      nights:    parseInt(row.querySelector('[data-dest="nights"]')?.value) || 0,
    });
  });
  data.travel.destinations = dests;
  data.travel.nights = dests.reduce((s, d) => s + (d.nights||0), 0);
  data.travel.endDate = data.travel.startDate ? addDaysToDate(data.travel.startDate, data.travel.nights) : '';

  // Days
  const days = [];
  _container.querySelectorAll('[data-day-idx]').forEach((card, idx) => {
    const existing = (_data.days || [])[idx] || {};
    days.push({
      dayNumber:    existing.dayNumber || idx + 1,
      date:         existing.date || '',
      city:         existing.city || '',
      title:        card.querySelector('[data-day="title"]')?.value?.trim() || '',
      narrative:    card.querySelector('[data-day="narrative"]')?.value?.trim() || '',
      overnightCity:card.querySelector('[data-day="overnightCity"]')?.value?.trim() || '',
      activities:   existing.activities || [],
      imageIds:     existing.imageIds || [],
    });
  });
  data.days = days;

  // Hotels
  const hotels = [];
  _container.querySelectorAll('[data-hotel-idx]').forEach(row => {
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

  // Pricing custom rows
  const prows = [];
  _container.querySelectorAll('[data-prow-idx]').forEach(row => {
    prows.push({
      label: row.querySelector('[data-prow="label"]')?.value?.trim() || '',
      value: row.querySelector('[data-prow="value"]')?.value?.trim() || '',
    });
  });
  data.pricing.customRows = prows;

  // Optionals
  const optionals = [];
  _container.querySelectorAll('[data-opt-idx]').forEach(row => {
    optionals.push({
      service:    row.querySelector('[data-opt="service"]')?.value?.trim() || '',
      priceAdult: parseFloat(row.querySelector('[data-opt="priceAdult"]')?.value) || null,
      priceChild: parseFloat(row.querySelector('[data-opt="priceChild"]')?.value) || null,
      notes:      row.querySelector('[data-opt="notes"]')?.value?.trim() || '',
    });
  });
  data.optionals = optionals;

  // Includes (preserva linhas em branco: a limpeza final é feita no save)
  const includes = [];
  _container.querySelectorAll('[data-inc-idx] [data-inc="text"]').forEach(input => {
    includes.push(input.value);
  });
  data.includes = includes;

  // Excludes (preserva linhas em branco: a limpeza final é feita no save)
  const excludes = [];
  _container.querySelectorAll('[data-exc-idx] [data-exc="text"]').forEach(input => {
    excludes.push(input.value);
  });
  data.excludes = excludes;

  // Cancellation
  const canc = [];
  _container.querySelectorAll('[data-canc-idx]').forEach(row => {
    canc.push({
      period:  row.querySelector('[data-canc="period"]')?.value?.trim() || '',
      penalty: row.querySelector('[data-canc="penalty"]')?.value?.trim() || '',
    });
  });
  data.cancellation = canc;

  // Important info custom fields
  const infoCust = [];
  _container.querySelectorAll('[data-infoc-idx]').forEach(row => {
    infoCust.push({
      label: row.querySelector('[data-infoc="label"]')?.value?.trim() || '',
      value: row.querySelector('[data-infoc="value"]')?.value?.trim() || '',
    });
  });
  data.importantInfo.customFields = infoCust;

  return data;
}

/* ─── Re-render a specific section body ───────────────────── */
/**
 * IMPORTANTE: Não chamar collectData() aqui!
 * Todos os callers já sincronizaram _data antes (ex.: `_data = collectData();
 * _data.travel.destinations.push(...)`). Se chamássemos collectData() de novo,
 * sobrescreveríamos a modificação em memória com o estado do DOM "velho"
 * (que ainda não reflete a modificação), perdendo add/remove de linhas.
 */
function refreshSection(sectionId, rendererFn) {
  const sec = _container.querySelector(`[data-section="${sectionId}"] .re-section-body`);
  if (!sec) return;
  sec.innerHTML = rendererFn();
  bindSectionEvents(sectionId);
}

/* ─── Event bindings (per section) ────────────────────────── */
function bindSectionEvents(sectionId) {
  switch (sectionId) {
    case 'client': bindClientEvents(); break;
    case 'travel': bindTravelEvents(); break;
    case 'days':   bindDaysEvents(); break;
    case 'hotels': bindHotelsEvents(); break;
    case 'pricing': bindPricingEvents(); break;
    case 'optionals': bindOptionalsEvents(); break;
    case 'incexc': bindIncExcEvents(); break;
    case 'payment': break; // no dynamic elements
    case 'cancellation': bindCancellationEvents(); break;
    case 'importantInfo': bindImportantInfoEvents(); break;
    case 'preview': bindPreviewEvents(); break;
  }
}

function bindClientEvents() {
  // Load recent clients autocomplete
  loadRecentClientsAutocomplete();

  // Children count → toggle ages
  const childrenInput = _container.querySelector('[data-field="client.children"]');
  if (childrenInput) {
    childrenInput.addEventListener('change', () => {
      const count = parseInt(childrenInput.value) || 0;
      const agesDiv = _container.querySelector('#re-children-ages');
      const agesRow = _container.querySelector('#re-ages-row');
      if (!agesDiv || !agesRow) return;
      agesDiv.style.display = count > 0 ? '' : 'none';
      // Sync age inputs
      const current = _container.querySelectorAll('[data-age-idx]');
      const currentAges = Array.from(current).map(inp => parseInt(inp.value) || 0);
      let html = '';
      for (let i = 0; i < count; i++) {
        html += `<input class="form-input" type="number" min="0" max="17" data-age-idx="${i}" value="${currentAges[i]||0}" style="width:70px;" />`;
      }
      agesRow.innerHTML = html;
      markDirty();
    });
  }

  // Checkbox groups
  _container.querySelectorAll('#re-pref-group label').forEach(lbl => {
    lbl.addEventListener('click', (e) => {
      e.preventDefault();
      lbl.classList.toggle('checked');
      const cb = lbl.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = lbl.classList.contains('checked');
      markDirty();
    });
  });
  _container.querySelectorAll('#re-rest-group label').forEach(lbl => {
    lbl.addEventListener('click', (e) => {
      e.preventDefault();
      lbl.classList.toggle('checked');
      const cb = lbl.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = lbl.classList.contains('checked');
      markDirty();
    });
  });
}

function bindTravelEvents() {
  // Add destination
  _container.querySelector('#re-add-dest')?.addEventListener('click', () => {
    _data = collectData();
    _data.travel.destinations.push({ city:'', country:'', continent:'', nights:1 });
    refreshSection('travel', renderTravelSection);
  });

  // Remove destination
  _container.querySelectorAll('[data-remove-dest]').forEach(btn => {
    btn.addEventListener('click', () => {
      _data = collectData();
      _data.travel.destinations.splice(parseInt(btn.dataset.removeDest), 1);
      refreshSection('travel', renderTravelSection);
    });
  });

  // Recalc nights on change
  _container.querySelectorAll('[data-dest="nights"]').forEach(input => {
    input.addEventListener('change', () => {
      recalcTravelTotals();
    });
  });

  _container.querySelector('[data-field="travel.startDate"]')?.addEventListener('change', () => {
    recalcTravelTotals();
  });

  // Generate days button
  _container.querySelector('#re-gen-days')?.addEventListener('click', () => {
    _data = collectData();
    const { startDate, destinations } = _data.travel;
    if (!startDate) { toast.warning('Preencha a data de inicio.'); return; }
    if (!destinations.length) { toast.warning('Adicione pelo menos um destino.'); return; }
    _data.days = generateDays(startDate, destinations);
    refreshSection('days', renderDaysSection);
    toast.success(`${_data.days.length} dias gerados!`);
    // Open days section
    const daysSec = _container.querySelector('[data-section="days"]');
    if (daysSec && !daysSec.classList.contains('open')) daysSec.classList.add('open');
    markDirty();
  });
}

function recalcTravelTotals() {
  const destRows = _container.querySelectorAll('[data-dest-idx]');
  let totalNights = 0;
  destRows.forEach(row => {
    totalNights += parseInt(row.querySelector('[data-dest="nights"]')?.value) || 0;
  });
  const totalEl = _container.querySelector('#re-total-nights');
  if (totalEl) totalEl.textContent = totalNights;

  const startInput = _container.querySelector('[data-field="travel.startDate"]');
  const endInput = _container.querySelector('#re-end-date');
  if (startInput?.value && endInput) {
    endInput.value = addDaysToDate(startInput.value, totalNights);
  }
}

/* ─── Recent clients autocomplete ─────────────────────────── */
let _recentClients = null;
async function loadRecentClientsAutocomplete() {
  const datalist = _container?.querySelector('#re-recent-clients');
  if (!datalist) return;
  try {
    _recentClients = await fetchRecentClients(20);
    datalist.innerHTML = _recentClients.map(c =>
      `<option value="${esc(c.name)}" data-email="${esc(c.email||'')}" data-phone="${esc(c.phone||'')}">`
    ).join('');

    // When a name is selected from datalist, fill email/phone/type
    const nameInput = _container?.querySelector('[data-field="client.name"]');
    nameInput?.addEventListener('change', () => {
      const match = _recentClients?.find(c => c.name === nameInput.value);
      if (match) {
        const fill = (field, val) => {
          const el = _container?.querySelector(`[data-field="${field}"]`);
          if (el && !el.value.trim() && val) el.value = val;
        };
        fill('client.email', match.email);
        fill('client.phone', match.phone);
        if (match.type) {
          const sel = _container?.querySelector('[data-field="client.type"]');
          if (sel) sel.value = match.type;
        }
        if (match.economicProfile) {
          const sel = _container?.querySelector('[data-field="client.economicProfile"]');
          if (sel) sel.value = match.economicProfile;
        }
        markDirty();
      }
    });
  } catch (e) { /* non-critical */ }
}

/* ─── AI helpers for day generation ───────────────────────── */
function buildDayContext(idx) {
  const data = collectData();
  const day = data.days[idx] || {};
  const client = data.client || {};
  const dests = data.travel?.destinations || [];

  // Try to find portal tip data for this day's city
  const destInfo = dests.find(d => d.city === day.city || d.country === day.city);

  return {
    dayNumber:     day.dayNumber || idx + 1,
    date:          day.date || '',
    city:          day.city || '',
    country:       destInfo?.country || '',
    destination:   `${day.city || ''}, ${destInfo?.country || ''}`.trim().replace(/^,|,$/g, ''),
    existingTitle: day.title || '',
    overnightCity: day.overnightCity || '',
    clientProfile: `${client.type || 'couple'}, ${client.adults || 2} adultos${client.children ? ', ' + client.children + ' crianças' : ''}, perfil ${client.economicProfile || 'premium'}`,
    preferences:   (client.preferences || []).join(', ') || 'sem preferência específica',
    restrictions:  (client.restrictions || []).join(', ') || 'nenhuma',
    travelIdea:    client.notes || '',
    totalDays:     data.days.length,
    allDestinations: dests.map(d => d.city || d.country).join(' → '),
  };
}

function applyNarrativeResult(idx, result) {
  const text = result?.text || result?.content || result || '';
  if (!text) { toast.error('IA não retornou resultado.'); return; }

  // Find the textarea for this day
  const card = _container.querySelector(`[data-day-idx="${idx}"]`);
  const textarea = card?.querySelector('[data-day="narrative"]');
  if (textarea) {
    textarea.value = text;
    markDirty();
    toast.success(`Narrativa do dia ${idx + 1} gerada!`);
  }
}

function bindDaysEvents() {
  // Add day
  _container.querySelector('#re-add-day')?.addEventListener('click', () => {
    _data = collectData();
    const lastDay = _data.days[_data.days.length - 1];
    const newDate = lastDay?.date ? addDaysToDate(lastDay.date, 1) : '';
    _data.days.push({
      dayNumber: _data.days.length + 1,
      date: newDate,
      city: '',
      title: '',
      narrative: '',
      overnightCity: '',
      activities: [],
      imageIds: [],
    });
    refreshSection('days', renderDaysSection);
    markDirty();
  });

  // Remove day
  _container.querySelectorAll('[data-remove-day]').forEach(btn => {
    btn.addEventListener('click', () => {
      _data = collectData();
      _data.days.splice(parseInt(btn.dataset.removeDay), 1);
      // Renumber
      _data.days.forEach((d, i) => d.dayNumber = i + 1);
      refreshSection('days', renderDaysSection);
      markDirty();
    });
  });

  // AI: generate day narrative
  _container.querySelectorAll('[data-day-ai]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.dataset.dayAi);
      const dayData = (_data.days || [])[idx];
      if (!dayData) return;

      btn.disabled = true;
      btn.textContent = 'Gerando...';

      try {
        // Find AI skills for roteiros module
        const skills = await fetchSkillsForModule('roteiros').catch(() => []);
        const narrativeSkill = skills.find(s =>
          s.name?.toLowerCase().includes('narrat') ||
          s.name?.toLowerCase().includes('dia') ||
          s.name?.toLowerCase().includes('day')
        );

        if (!narrativeSkill) {
          // Fallback: use first available skill for roteiros, or show guidance
          if (skills.length) {
            const skill = skills[0];
            const context = buildDayContext(idx);
            const result = await runSkill(skill.id, context);
            applyNarrativeResult(idx, result);
          } else {
            toast.info('Nenhuma skill de IA configurada para Roteiros. Crie uma em IA Skills → módulo "Roteiros de Viagem".');
          }
          return;
        }

        const context = buildDayContext(idx);
        const result = await runSkill(narrativeSkill.id, context);
        applyNarrativeResult(idx, result);
      } catch (e) {
        toast.error('Erro ao gerar com IA: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Gerar com IA';
      }
    });
  });
}

function bindHotelsEvents() {
  _container.querySelector('#re-add-hotel')?.addEventListener('click', () => {
    _data = collectData();
    _data.hotels.push({ city:'', hotelName:'', roomType:'', regime:'', checkIn:'', checkOut:'', nights:0 });
    refreshSection('hotels', renderHotelsSection);
    markDirty();
  });

  _container.querySelectorAll('[data-remove-hotel]').forEach(btn => {
    btn.addEventListener('click', () => {
      _data = collectData();
      _data.hotels.splice(parseInt(btn.dataset.removeHotel), 1);
      refreshSection('hotels', renderHotelsSection);
      markDirty();
    });
  });

  // Auto-calc nights on date change
  _container.querySelectorAll('[data-hotel="checkIn"], [data-hotel="checkOut"]').forEach(input => {
    input.addEventListener('change', () => {
      const row = input.closest('[data-hotel-idx]');
      if (!row) return;
      const ci = row.querySelector('[data-hotel="checkIn"]')?.value;
      const co = row.querySelector('[data-hotel="checkOut"]')?.value;
      const nightsInput = row.querySelector('[data-hotel="nights"]');
      if (ci && co && nightsInput) {
        nightsInput.value = diffDays(ci, co);
      }
      markDirty();
    });
  });
}

function bindPricingEvents() {
  _container.querySelector('#re-add-prow')?.addEventListener('click', () => {
    _data = collectData();
    _data.pricing.customRows.push({ label:'', value:'' });
    refreshSection('pricing', renderPricingSection);
    markDirty();
  });

  _container.querySelectorAll('[data-remove-prow]').forEach(btn => {
    btn.addEventListener('click', () => {
      _data = collectData();
      _data.pricing.customRows.splice(parseInt(btn.dataset.removeProw), 1);
      refreshSection('pricing', renderPricingSection);
      markDirty();
    });
  });
}

function bindOptionalsEvents() {
  _container.querySelector('#re-add-opt')?.addEventListener('click', () => {
    _data = collectData();
    _data.optionals.push({ service:'', priceAdult:null, priceChild:null, notes:'' });
    refreshSection('optionals', renderOptionalsSection);
    markDirty();
  });

  _container.querySelectorAll('[data-remove-opt]').forEach(btn => {
    btn.addEventListener('click', () => {
      _data = collectData();
      _data.optionals.splice(parseInt(btn.dataset.removeOpt), 1);
      refreshSection('optionals', renderOptionalsSection);
      markDirty();
    });
  });
}

function bindIncExcEvents() {
  // Add includes
  _container.querySelector('#re-add-inc')?.addEventListener('click', () => {
    _data = collectData();
    _data.includes.push('');
    refreshSection('incexc', renderIncExcSection);
    markDirty();
  });

  // Remove includes
  _container.querySelectorAll('[data-remove-inc]').forEach(btn => {
    btn.addEventListener('click', () => {
      _data = collectData();
      _data.includes.splice(parseInt(btn.dataset.removeInc), 1);
      refreshSection('incexc', renderIncExcSection);
      markDirty();
    });
  });

  // Add excludes
  _container.querySelector('#re-add-exc')?.addEventListener('click', () => {
    _data = collectData();
    _data.excludes.push('');
    refreshSection('incexc', renderIncExcSection);
    markDirty();
  });

  // Remove excludes
  _container.querySelectorAll('[data-remove-exc]').forEach(btn => {
    btn.addEventListener('click', () => {
      _data = collectData();
      _data.excludes.splice(parseInt(btn.dataset.removeExc), 1);
      refreshSection('incexc', renderIncExcSection);
      markDirty();
    });
  });

  // Load presets
  _container.querySelector('#re-load-presets')?.addEventListener('click', openPresetsModal);
}

function openPresetsModal() {
  _data = collectData();
  const incSet = new Set(_data.includes);
  const excSet = new Set(_data.excludes);

  modal.open({
    title: 'Carregar Presets',
    size: 'lg',
    content: `
      <div class="re-two-cols" style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div>
          <h4 style="color:var(--text-primary);margin:0 0 8px;font-size:0.875rem;">Inclui</h4>
          ${INCLUDES_PRESETS.map((p, i) => `
            <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;font-size:0.8125rem;color:var(--text-secondary);cursor:pointer;">
              <input type="checkbox" class="preset-inc" data-preset-inc="${i}" ${incSet.has(p)?'checked':''} style="margin-top:2px;" />
              ${esc(p)}
            </label>
          `).join('')}
        </div>
        <div>
          <h4 style="color:var(--text-primary);margin:0 0 8px;font-size:0.875rem;">Nao Inclui</h4>
          ${EXCLUDES_PRESETS.map((p, i) => `
            <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;font-size:0.8125rem;color:var(--text-secondary);cursor:pointer;">
              <input type="checkbox" class="preset-exc" data-preset-exc="${i}" ${excSet.has(p)?'checked':''} style="margin-top:2px;" />
              ${esc(p)}
            </label>
          `).join('')}
        </div>
      </div>
    `,
    footer: [
      { label: 'Cancelar', class: 'btn-secondary' },
      { label: 'Aplicar', class: 'btn-primary', onClick: (e, { close }) => {
        const newInc = new Set(_data.includes);
        const newExc = new Set(_data.excludes);

        document.querySelectorAll('.preset-inc:checked').forEach(cb => {
          newInc.add(INCLUDES_PRESETS[parseInt(cb.dataset.presetInc)]);
        });
        document.querySelectorAll('.preset-inc:not(:checked)').forEach(cb => {
          newInc.delete(INCLUDES_PRESETS[parseInt(cb.dataset.presetInc)]);
        });
        document.querySelectorAll('.preset-exc:checked').forEach(cb => {
          newExc.add(EXCLUDES_PRESETS[parseInt(cb.dataset.presetExc)]);
        });
        document.querySelectorAll('.preset-exc:not(:checked)').forEach(cb => {
          newExc.delete(EXCLUDES_PRESETS[parseInt(cb.dataset.presetExc)]);
        });

        _data.includes = Array.from(newInc);
        _data.excludes = Array.from(newExc);
        refreshSection('incexc', renderIncExcSection);
        markDirty();
        close();
        toast.success('Presets aplicados!');
      }},
    ],
  });
}

function bindCancellationEvents() {
  _container.querySelector('#re-add-canc')?.addEventListener('click', () => {
    _data = collectData();
    _data.cancellation.push({ period:'', penalty:'' });
    refreshSection('cancellation', renderCancellationSection);
    markDirty();
  });

  _container.querySelectorAll('[data-remove-canc]').forEach(btn => {
    btn.addEventListener('click', () => {
      _data = collectData();
      _data.cancellation.splice(parseInt(btn.dataset.removeCanc), 1);
      refreshSection('cancellation', renderCancellationSection);
      markDirty();
    });
  });
}

function bindImportantInfoEvents() {
  _container.querySelector('#re-add-infoc')?.addEventListener('click', () => {
    _data = collectData();
    _data.importantInfo.customFields.push({ label:'', value:'' });
    refreshSection('importantInfo', renderImportantInfoSection);
    markDirty();
  });

  _container.querySelectorAll('[data-remove-infoc]').forEach(btn => {
    btn.addEventListener('click', () => {
      _data = collectData();
      _data.importantInfo.customFields.splice(parseInt(btn.dataset.removeInfoc), 1);
      refreshSection('importantInfo', renderImportantInfoSection);
      markDirty();
    });
  });

  _container.querySelector('#re-autofill-portal')?.addEventListener('click', async () => {
    const data = collectData();
    const dests = data.travel?.destinations || [];
    if (!dests.length) { toast.error('Adicione destinos na seção Viagem primeiro.'); return; }

    const btn = _container.querySelector('#re-autofill-portal');
    btn.disabled = true; btn.textContent = 'Buscando...';

    try {
      // Search portal_tips for matching destinations
      let foundTip = null;
      for (const dest of dests) {
        if (!dest.country && !dest.city) continue;
        const tips = await fetchTips({ country: dest.country }).catch(() => []);
        const match = tips.find(t =>
          (dest.city && t.city?.toLowerCase() === dest.city.toLowerCase()) ||
          (!dest.city && t.country?.toLowerCase() === dest.country.toLowerCase())
        );
        if (match) { foundTip = match; break; }
      }

      if (!foundTip || !foundTip.segments?.informacoes_gerais?.info) {
        toast.info('Nenhuma dica encontrada no Portal para os destinos informados.');
        return;
      }

      const info = foundTip.segments.informacoes_gerais.info;

      // Fill fields that are empty
      const fill = (id, value) => {
        const el = _container.querySelector(`[data-field="importantInfo.${id}"]`);
        if (el && !el.value.trim() && value) { el.value = value; }
      };

      // Climate from portal
      if (info.clima) {
        const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        const climaText = months.map((m, i) => {
          const max = info.clima[`max_${m}`];
          const min = info.clima[`min_${m}`];
          return (max != null && min != null) ? `${m}: ${min}°C a ${max}°C` : null;
        }).filter(Boolean).join(' | ');
        fill('climate', climaText);
      }

      // Visa from portal description
      fill('visa', `${foundTip.country || ''} — consultar requisitos atualizados de visto.`);

      // Voltage / general info
      const extras = [];
      if (info.voltagem) extras.push(`Voltagem: ${info.voltagem}`);
      if (info.moeda) extras.push(`Moeda: ${info.moeda}`);
      if (info.lingua) extras.push(`Idioma: ${info.lingua}`);
      if (info.ddd) extras.push(`DDI: ${info.ddd}`);
      if (info.fusoHoras) extras.push(`Fuso: ${info.fusoSinal || '+'}${info.fusoHoras}h em relação a Brasília`);

      if (extras.length) {
        const existing = _container.querySelector('[data-field="importantInfo.flights"]');
        if (existing && !existing.value.trim()) {
          existing.value = extras.join('\n');
        }
      }

      markDirty();
      toast.success('Informações preenchidas do Portal de Dicas!');
    } catch (e) {
      toast.error('Erro ao buscar do Portal: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Auto-preencher do Portal';
    }
  });
}

function bindPreviewEvents() {
  // Load areas for BU selector
  loadAreaSelector();

  // Export PDF
  _container.querySelector('#re-export-pdf')?.addEventListener('click', async () => {
    const data = collectData();
    if (!data.days?.length) { toast.error('Adicione pelo menos um dia ao roteiro antes de exportar.'); return; }
    const btn = _container.querySelector('#re-export-pdf');
    btn.disabled = true; btn.textContent = 'Gerando PDF...';
    try {
      if (_dirty) { await handleSave(); }
      const area = await getSelectedArea();
      await generateRoteiroPDF({ id: _roteiroId, ...data }, area);
      toast.success('PDF gerado com sucesso!');
    } catch (e) { toast.error('Erro ao gerar PDF: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = 'Exportar PDF'; }
  });

  // Export PPTX
  _container.querySelector('#re-export-pptx')?.addEventListener('click', async () => {
    const data = collectData();
    if (!data.days?.length) { toast.error('Adicione pelo menos um dia ao roteiro antes de exportar.'); return; }
    const btn = _container.querySelector('#re-export-pptx');
    btn.disabled = true; btn.textContent = 'Gerando PPTX...';
    try {
      if (_dirty) { await handleSave(); }
      const area = await getSelectedArea();
      await generateRoteiroPPTX({ id: _roteiroId, ...data }, area);
      toast.success('PPTX gerado com sucesso!');
    } catch (e) { toast.error('Erro ao gerar PPTX: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = 'Exportar PPTX'; }
  });

  // Generate Web Link
  _container.querySelector('#re-gen-link')?.addEventListener('click', async () => {
    const data = collectData();
    if (!data.days?.length) { toast.error('Adicione pelo menos um dia ao roteiro.'); return; }
    const btn = _container.querySelector('#re-gen-link');
    btn.disabled = true; btn.textContent = 'Gerando link...';
    try {
      if (_dirty) { await handleSave(); }
      const area = await getSelectedArea();
      const token = await createWebLink(_roteiroId || 'draft', data, area);
      const url = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}roteiro-view.html#${token}`;
      const resultDiv = _container.querySelector('#re-web-link-result');
      if (resultDiv) {
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = `
          <div style="font-size:0.8125rem;color:var(--text-secondary);margin-bottom:8px;">Link gerado:</div>
          <div style="display:flex;gap:8px;align-items:center;">
            <input class="form-input" value="${esc(url)}" readonly style="flex:1;font-size:0.8125rem;" id="re-web-link-url" />
            <button class="btn btn-primary" id="re-copy-link" style="padding:6px 14px;font-size:0.8125rem;">Copiar</button>
          </div>
        `;
        resultDiv.querySelector('#re-copy-link')?.addEventListener('click', () => {
          navigator.clipboard.writeText(url).then(() => toast.success('Link copiado!'));
        });
      }
      toast.success('Link web gerado!');
    } catch (e) { toast.error('Erro: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = 'Gerar Link Web'; }
  });
}

/* ─── Area selector ──────────────────────────────────────── */
let _cachedAreas = null;
async function loadAreaSelector() {
  const select = _container?.querySelector('#re-area-select');
  const loading = _container?.querySelector('#re-area-loading');
  if (!select) return;
  try {
    _cachedAreas = await fetchAreas();
    _cachedAreas.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.name;
      if (_data.areaId === a.id) opt.selected = true;
      select.appendChild(opt);
    });
  } catch (e) { console.warn('Failed to load areas:', e); }
  if (loading) loading.style.display = 'none';
}

async function getSelectedArea() {
  const areaId = _container?.querySelector('#re-area-select')?.value;
  if (!areaId || !_cachedAreas) return null;
  return _cachedAreas.find(a => a.id === areaId) || null;
}

/* ─── Dirty tracking / auto-save indicator ────────────────── */
function markDirty() {
  _dirty = true;
  updateAutoSaveIndicator('Alteracoes nao salvas');
}

function updateAutoSaveIndicator(text) {
  const el = _container?.querySelector('#re-autosave-status');
  if (el) el.textContent = text;
}

/* ─── Save ────────────────────────────────────────────────── */
async function handleSave() {
  try {
    _data = collectData();
    // Limpa linhas em branco antes de persistir
    _data.includes = (_data.includes || []).map(s => (s || '').trim()).filter(Boolean);
    _data.excludes = (_data.excludes || []).map(s => (s || '').trim()).filter(Boolean);
    updateAutoSaveIndicator('Salvando...');
    const newId = await saveRoteiro(_roteiroId, _data);
    _dirty = false;
    updateAutoSaveIndicator('Salvo');

    if (!_roteiroId && newId) {
      _roteiroId = newId;
      // Update URL without triggering hashchange
      const hash = `#roteiro-editor?id=${newId}`;
      history.replaceState(null, '', hash);
    }

    toast.success('Roteiro salvo com sucesso!');
  } catch (err) {
    toast.error('Erro ao salvar: ' + err.message);
    updateAutoSaveIndicator('Erro ao salvar');
  }
}

/* ─── Main Render ─────────────────────────────────────────── */
export async function renderRoteiroEditor(container) {
  if (!store.canAccessRoteiros()) {
    container.innerHTML = `<div class="empty-state"><span style="font-size:2rem;">🔒</span><p>Acesso restrito</p><p class="text-muted">Você não tem permissão para acessar Roteiros de Viagem.</p></div>`;
    return;
  }
  _container = container;

  // Parse ID from hash
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  _roteiroId = params.get('id') || null;

  // Load or create
  try {
    if (_roteiroId) {
      _data = await fetchRoteiro(_roteiroId);
    } else {
      _data = emptyRoteiro();
    }
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><p>Erro: ${esc(err.message)}</p>
      <button class="btn btn-secondary" id="re-back-err">Voltar</button></div>`;
    container.querySelector('#re-back-err')?.addEventListener('click', () => router.navigate('roteiros'));
    return;
  }

  // Ensure all sub-objects exist
  _data.client        = _data.client        || {};
  _data.travel        = _data.travel        || {};
  _data.travel.destinations = _data.travel.destinations || [];
  _data.days          = _data.days          || [];
  _data.hotels        = _data.hotels        || [];
  _data.pricing       = _data.pricing       || {};
  _data.pricing.customRows = _data.pricing.customRows || [];
  _data.optionals     = _data.optionals     || [];
  _data.includes      = _data.includes      || [];
  _data.excludes      = _data.excludes      || [];
  _data.payment       = _data.payment       || {};
  _data.cancellation  = _data.cancellation  || [];
  _data.importantInfo = _data.importantInfo || {};
  _data.importantInfo.customFields = _data.importantInfo.customFields || [];

  // Inject CSS
  const style = document.createElement('style');
  style.textContent = EDITOR_CSS;

  const pageTitle = _data.title || (_roteiroId ? 'Editar Roteiro' : 'Novo Roteiro');

  container.innerHTML = `
    <div class="re-topbar">
      <button class="btn btn-secondary" id="re-back" style="padding:6px 14px;font-size:0.8125rem;">
        &larr; Voltar
      </button>
      <span class="re-topbar-title">${esc(pageTitle)}</span>
      <span class="re-autosave" id="re-autosave-status"></span>
      <button class="btn btn-primary" id="re-save" style="padding:8px 20px;">
        Salvar
      </button>
    </div>
    <div id="re-sections">
      ${sectionHTML('client',       '1. Cliente',                renderClientSection(),        true)}
      ${sectionHTML('travel',       '2. Viagem',                 renderTravelSection(),        false)}
      ${sectionHTML('days',         '3. Dia a Dia',              renderDaysSection(),          false)}
      ${sectionHTML('hotels',       '4. Hoteis',                 renderHotelsSection(),        false)}
      ${sectionHTML('pricing',      '5. Valores',                renderPricingSection(),       false)}
      ${sectionHTML('optionals',    '6. Opcionais',              renderOptionalsSection(),     false)}
      ${sectionHTML('incexc',       '7. Inclui / Nao Inclui',   renderIncExcSection(),        false)}
      ${sectionHTML('payment',      '8. Pagamento',              renderPaymentSection(),       false)}
      ${sectionHTML('cancellation', '9. Cancelamento',           renderCancellationSection(),  false)}
      ${sectionHTML('importantInfo','10. Informacoes Importantes',renderImportantInfoSection(), false)}
      ${sectionHTML('preview',      '11. Preview & Export',      renderPreviewSection(),       false)}
    </div>
  `;

  container.appendChild(style);

  // ─── Global events ─────────────────────────────────────────

  // Back button
  container.querySelector('#re-back').addEventListener('click', () => {
    if (_dirty) {
      modal.open({
        title: 'Alteracoes nao salvas',
        size: 'sm',
        content: '<p style="color:var(--text-secondary);">Voce tem alteracoes nao salvas. Deseja sair sem salvar?</p>',
        footer: [
          { label: 'Cancelar', class: 'btn-secondary' },
          { label: 'Sair sem salvar', class: 'btn-primary', style:'background:#EF4444;border-color:#EF4444;', onClick: (e, { close }) => {
            close();
            _dirty = false;
            router.navigate('roteiros');
          }},
          { label: 'Salvar e sair', class: 'btn-primary', onClick: async (e, { close }) => {
            await handleSave();
            close();
            router.navigate('roteiros');
          }},
        ],
      });
    } else {
      router.navigate('roteiros');
    }
  });

  // Save button
  container.querySelector('#re-save').addEventListener('click', handleSave);

  // Accordion toggle
  container.querySelectorAll('.re-section-header').forEach(hdr => {
    hdr.addEventListener('click', () => {
      hdr.parentElement.classList.toggle('open');
    });
  });

  // Bind all section events
  ['client','travel','days','hotels','pricing','optionals','incexc','payment','cancellation','importantInfo','preview']
    .forEach(id => bindSectionEvents(id));

  // Global input change → mark dirty
  container.addEventListener('input', () => { markDirty(); });
  container.addEventListener('change', () => { markDirty(); });

  // Keyboard shortcut: Ctrl+S / Cmd+S
  const _keyHandler = (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  };
  document.addEventListener('keydown', _keyHandler);
  container._keyHandler = _keyHandler;

  _dirty = false;
  updateAutoSaveIndicator(_roteiroId ? 'Carregado' : 'Novo roteiro');
}

/* ─── Destroy ─────────────────────────────────────────────── */
export function destroyRoteiroEditor() {
  if (_autoSaveTimer) {
    clearInterval(_autoSaveTimer);
    _autoSaveTimer = null;
  }
  if (_container?._keyHandler) {
    document.removeEventListener('keydown', _container._keyHandler);
  }
  _container = null;
  _roteiroId = null;
  _data = null;
  _dirty = false;
}
