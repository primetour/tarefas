/**
 * PRIMETOUR — Banco de Roteiros: Editor (v4.50.0+)
 *
 * Edita um roteiro curado. Suporta:
 *   - Criação manual (URL: #banco-roteiro-editor)
 *   - Edição (URL: #banco-roteiro-editor?id=<docId>)
 *   - Import de PDF (URL: #banco-roteiro-editor?import=1) → abre file picker
 *
 * Seções (espelhando portal_tips + roteiro):
 *   - Capa (título, descrição, validade, status, tags)
 *   - Geografia (continentes/países/cidades com nights)
 *   - Dia a dia (lista de days)
 *   - Hospedagem & Pricing (categorias)
 *   - Inclui / Não inclui
 *   - Pagamento & Cancelamento
 *   - Documentação
 *   - Notas
 *
 * Auto-save 5s após mudança (mesmo padrão do roteiroEditor v4.49.103+).
 */

import { store } from '../store.js';
import { toast } from '../components/toast.js';
import {
  emptyRoteiroBank, fetchRoteiroBank, saveRoteiroBank,
  fetchBankCategories, DEFAULT_CATEGORIES,
  fetchBankCollections, DEFAULT_COLLECTIONS,
  saveBankCategory, deleteBankCategory,
  saveBankCollection, deleteBankCollection,
  ensureDestination,
} from '../services/roteiroBank.js';
import { CONTINENTS } from '../services/portal.js';

const esc = s => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';

let state = {
  id: null,
  doc: null,
  dirty: false,
  saving: false,
  autosaveTimer: null,
  abortCtrl: null,                              // v4.50.10+ controla listeners
  categories: DEFAULT_CATEGORIES,
  collections: DEFAULT_COLLECTIONS,
};

function canEdit() {
  return store.isMaster?.()
      || store.can?.('portal_destinations_manage')
      || store.can?.('portal_manage');
}

function parseQs() {
  const m = (location.hash || '').split('?')[1];
  if (!m) return {};
  const params = new URLSearchParams(m);
  return Object.fromEntries(params.entries());
}

function dirty() {
  state.dirty = true;
  if (state.autosaveTimer) clearTimeout(state.autosaveTimer);
  state.autosaveTimer = setTimeout(() => { autosave(); }, 5000);
  const ind = document.getElementById('rb-save-indicator');
  if (ind) ind.textContent = 'Alterações não salvas…';
}

async function autosave() {
  if (!state.dirty || state.saving) return;
  state.saving = true;
  const ind = document.getElementById('rb-save-indicator');
  if (ind) ind.textContent = 'Salvando…';
  try {
    const id = await saveRoteiroBank(state.id, state.doc);
    if (!state.id) {
      state.id = id;
      // Atualiza URL pra refletir o id
      const newHash = `#banco-roteiro-editor?id=${id}`;
      history.replaceState(null, '', newHash);
    }
    state.dirty = false;
    if (ind) ind.textContent = `Salvo ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    // v4.57.52 task #60: dispara sync inline com portal_destinations.
    // UI promete em linha 184 ("cidades novas viram destinos auto-criados
    // ao salvar") mas comportamento nunca foi wired. Agora honra a promessa.
    // Não bloqueia auto-save: roda em background, toast só quando algo mudou.
    _syncDestinationsBackground();
  } catch (e) {
    console.error('[roteiroBankEditor] autosave falhou:', e);
    if (ind) ind.textContent = '⚠ Falha ao salvar';
    toast.error('Auto-save falhou: ' + (e.message || e));
  } finally {
    state.saving = false;
  }
}

/**
 * v4.57.52 task #60: quick-add destinos do banco no portal_destinations.
 * Itera state.doc.geo.cities[] e chama ensureDestination pra cada. Coleta
 * IDs e mantém state.doc.geo.destinationIds sincronizado.
 *
 * Idempotente: cidades que já têm destino vinculado são pass-through
 * (ensureDestination retorna existing). Cidades vazias (sem city+country+
 * continent) são puladas.
 *
 * Roda em background pós autosave — NÃO refaz o save grande. Apenas
 * updateDoc pontual em geo.destinationIds se mudou.
 *
 * Flag _syncing evita re-entrada (autosave dispara sync, sync poderia
 * triggar setDirty, novo autosave... loop).
 */
async function _syncDestinationsBackground() {
  if (!state.id || state._destSyncing) return;
  const cities = Array.isArray(state.doc?.geo?.cities) ? state.doc.geo.cities : [];
  if (!cities.length) return;

  state._destSyncing = true;
  try {
    const newIds = [];
    let createdCount = 0;
    let linkedCount  = 0;
    for (const c of cities) {
      if (!c.city || !c.country || !c.continent) continue;
      try {
        const { destinationId, created } = await ensureDestination({
          city: c.city, country: c.country, continent: c.continent,
        });
        if (destinationId) {
          newIds.push(destinationId);
          linkedCount++;
          if (created) createdCount++;
        }
      } catch (e) {
        console.warn('[_syncDestinationsBackground] cidade falhou:', c.city, e?.message);
      }
    }
    // Diff: só atualiza se mudou
    const prev = Array.isArray(state.doc.geo.destinationIds) ? state.doc.geo.destinationIds : [];
    const changed = newIds.length !== prev.length || newIds.some((id, i) => prev[i] !== id);
    if (changed) {
      state.doc.geo.destinationIds = newIds;
      // Update pontual no Firestore (sem passar pelo state.dirty/autosave)
      const { db } = await import('../firebase.js');
      const { doc, updateDoc, serverTimestamp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      await updateDoc(doc(db, 'roteiros_bank', state.id), {
        'geo.destinationIds': newIds,
        updatedAt: serverTimestamp(),
      });
    }
    if (createdCount > 0) {
      toast.success(`✓ ${createdCount} novo(s) destino(s) criado(s) em portal_destinations.`);
    }
    console.info(`[bank-editor] sync destinos: ${linkedCount} vinculadas, ${createdCount} criadas.`);
  } catch (e) {
    console.warn('[_syncDestinationsBackground] falhou:', e?.message);
  } finally {
    state._destSyncing = false;
  }
}

/* ───────────────────────── Renderers ───────────────────────── */

function renderCapa() {
  const d = state.doc;
  return `
    <section class="rb-section" data-section="capa">
      <h2 class="rb-section-title">Capa & Identidade</h2>
      <div class="form-row">
        <label class="form-label">Título *</label>
        <input class="form-input" type="text" data-bind="title" value="${esc(d.title)}" placeholder="Ex: Classic Collection: China e Tibete">
      </div>
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label class="form-label">
            Coleção
            ${canEdit() ? `<button type="button" data-action="manage-collections" style="margin-left:6px;font-size:0.7rem;background:transparent;border:none;color:var(--brand-blue);cursor:pointer;text-decoration:underline;">gerenciar</button>` : ''}
          </label>
          <select class="form-select" data-bind="collectionLabel">
            <option value="">— selecione —</option>
            ${state.collections.map(co => `<option value="${esc(co.label)}" ${d.collectionLabel===co.label?'selected':''}>${esc(co.label)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="form-label">Código (auto se vazio)</label>
          <input class="form-input" type="text" data-bind="code" value="${esc(d.code)}" placeholder="CLA-CHN-TBT">
        </div>
      </div>
      <div class="form-row">
        <label class="form-label">Descrição curta (capa)</label>
        <textarea class="form-textarea" rows="3" data-bind="shortDescription" placeholder="Narrativa de capa, 1-2 parágrafos">${esc(d.shortDescription)}</textarea>
      </div>
      <div class="form-row">
        <label class="form-label">Descrição completa (opcional)</label>
        <textarea class="form-textarea" rows="4" data-bind="longDescription" placeholder="Versão expandida da descrição">${esc(d.longDescription)}</textarea>
      </div>
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
        <div>
          <label class="form-label">Status</label>
          <select class="form-select" data-bind="status">
            <option value="draft"    ${d.status==='draft'?'selected':''}>Rascunho</option>
            <option value="review"   ${d.status==='review'?'selected':''}>Em revisão</option>
            <option value="approved" ${d.status==='approved'?'selected':''}>Publicado</option>
            <option value="archived" ${d.status==='archived'?'selected':''}>Arquivado</option>
          </select>
        </div>
        <div>
          <label class="form-label">Validade início</label>
          <input class="form-input" type="date" data-bind="validity.startDate" value="${esc(d.validity?.startDate)}">
        </div>
        <div>
          <label class="form-label">Validade fim</label>
          <input class="form-input" type="date" data-bind="validity.endDate" value="${esc(d.validity?.endDate)}">
        </div>
      </div>
      <div class="form-row">
        <label class="form-label">Notas de validade (interno)</label>
        <input class="form-input" type="text" data-bind="validity.notes" value="${esc(d.validity?.notes)}" placeholder="Ex: Revisar valores em abril">
      </div>
      <div class="form-row">
        <label class="form-label">Tags (separadas por vírgula)</label>
        <input class="form-input" type="text" data-bind-tags value="${esc((d.tags||[]).join(', '))}" placeholder="cultural, espiritual, asia, unesco">
      </div>
      <div class="form-row">
        <label class="form-label">URL da imagem de capa (R2 ou Unsplash)</label>
        <input class="form-input" type="url" data-bind="images.hero" value="${esc(d.images?.hero||'')}" placeholder="https://...">
      </div>
    </section>
  `;
}

function renderGeo() {
  const d = state.doc;
  return `
    <section class="rb-section" data-section="geo">
      <h2 class="rb-section-title">Geografia</h2>
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div>
          <label class="form-label">Duração (dias)</label>
          <input class="form-input" type="number" min="0" data-bind="durationDays" value="${d.durationDays||0}">
        </div>
        <div>
          <label class="form-label">Duração (noites)</label>
          <input class="form-input" type="number" min="0" data-bind="durationNights" value="${d.durationNights||0}">
        </div>
      </div>

      <label class="form-label" style="margin-top:8px;">Cidades do roteiro (na ordem da viagem)</label>
      <div id="rb-cities-list" style="display:flex;flex-direction:column;gap:8px;">
        ${(d.geo?.cities||[]).map((c,i)=>cityRowHTML(c,i)).join('')}
      </div>
      <button class="btn btn-secondary btn-sm" data-action="add-city" style="margin-top:8px;">+ Adicionar cidade</button>
      <p style="color:var(--text-muted);font-size:0.78rem;margin-top:8px;">
        Cidades novas viram destinos auto-criados em <strong>portal_destinations</strong> ao salvar (se você tiver permissão).
      </p>
    </section>
  `;
}

function cityRowHTML(c, i) {
  return `
    <div class="rb-city-row" data-city-idx="${i}" style="display:grid;grid-template-columns:1fr 1fr 1fr 80px auto;gap:8px;align-items:end;">
      <div><label class="form-label" style="font-size:0.7rem;">Cidade</label>
        <input class="form-input" data-city-bind="city" data-city-idx="${i}" value="${esc(c.city)}" placeholder="Pequim"></div>
      <div><label class="form-label" style="font-size:0.7rem;">País</label>
        <input class="form-input" data-city-bind="country" data-city-idx="${i}" value="${esc(c.country)}" placeholder="China"></div>
      <div><label class="form-label" style="font-size:0.7rem;">Continente</label>
        <select class="form-select" data-city-bind="continent" data-city-idx="${i}">
          <option value="">—</option>
          ${CONTINENTS.map(co=>`<option value="${esc(co)}" ${c.continent===co?'selected':''}>${esc(co)}</option>`).join('')}
        </select></div>
      <div><label class="form-label" style="font-size:0.7rem;">Noites</label>
        <input class="form-input" type="number" min="0" data-city-bind="nights" data-city-idx="${i}" value="${c.nights||0}"></div>
      <button class="btn btn-ghost btn-sm" data-action="remove-city" data-city-idx="${i}" title="Remover" style="color:#dc2626;">✕</button>
    </div>
  `;
}

function renderDays() {
  const d = state.doc;
  return `
    <section class="rb-section" data-section="days">
      <h2 class="rb-section-title">Dia a dia sugerido</h2>
      <div id="rb-days-list" style="display:flex;flex-direction:column;gap:12px;">
        ${(d.days||[]).map((day,i)=>dayRowHTML(day,i)).join('') || '<div style="color:var(--text-muted);font-style:italic;">Nenhum dia cadastrado. Adicione abaixo.</div>'}
      </div>
      <button class="btn btn-secondary btn-sm" data-action="add-day" style="margin-top:8px;">+ Adicionar dia</button>
    </section>
  `;
}

function dayRowHTML(day, i) {
  return `
    <div class="rb-day-row" data-day-idx="${i}" style="border:1px solid var(--border-subtle);border-radius:8px;padding:12px;background:var(--bg-surface);">
      <div style="display:grid;grid-template-columns:80px 1fr 1fr auto;gap:8px;align-items:end;margin-bottom:8px;">
        <div><label class="form-label" style="font-size:0.7rem;">Dia</label>
          <input class="form-input" type="number" min="1" data-day-bind="dayNumber" data-day-idx="${i}" value="${day.dayNumber||(i+1)}"></div>
        <div><label class="form-label" style="font-size:0.7rem;">Cidade do dia</label>
          <input class="form-input" data-day-bind="city" data-day-idx="${i}" value="${esc(day.city)}" placeholder="Pequim"></div>
        <div><label class="form-label" style="font-size:0.7rem;">Pernoite</label>
          <input class="form-input" data-day-bind="overnightCity" data-day-idx="${i}" value="${esc(day.overnightCity)}" placeholder="Pequim"></div>
        <button class="btn btn-ghost btn-sm" data-action="remove-day" data-day-idx="${i}" title="Remover" style="color:#dc2626;">✕</button>
      </div>
      <div>
        <label class="form-label" style="font-size:0.7rem;">Título do dia</label>
        <input class="form-input" data-day-bind="title" data-day-idx="${i}" value="${esc(day.title)}" placeholder="Chegada e Primeira Noite na Rive Gauche">
      </div>
      <div style="margin-top:8px;">
        <label class="form-label" style="font-size:0.7rem;">Narrativa</label>
        <textarea class="form-textarea" rows="3" data-day-bind="narrative" data-day-idx="${i}" placeholder="Descrição completa do dia...">${esc(day.narrative)}</textarea>
      </div>
    </div>
  `;
}

function renderCategories() {
  const d = state.doc;
  return `
    <section class="rb-section" data-section="categories">
      <h2 class="rb-section-title">Hospedagem & Pricing</h2>
      <p style="color:var(--text-muted);font-size:0.82rem;margin-top:-4px;margin-bottom:10px;">
        Categorias estilo Classic Collection (Sugestão Prime, Luxo, Standard, Moderado).
        Cada categoria tem hotéis por cidade + tabela de preços por período.
      </p>
      <div id="rb-cats-list" style="display:flex;flex-direction:column;gap:14px;">
        ${(d.categories||[]).map((c,i)=>catBlockHTML(c,i)).join('') || '<div style="color:var(--text-muted);font-style:italic;">Nenhuma categoria. Adicione abaixo.</div>'}
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center;">
        ${state.categories.map(cat => `
          <button class="btn btn-secondary btn-sm" data-action="add-category" data-cat-key="${esc(cat.key)}" data-cat-label="${esc(cat.label)}">+ ${esc(cat.label)}</button>
        `).join('')}
        ${canEdit() ? `<button class="btn btn-ghost btn-sm" data-action="manage-categories" style="font-size:0.78rem;color:var(--brand-blue);">⚙ gerenciar categorias</button>` : ''}
      </div>
    </section>
  `;
}

function catBlockHTML(c, i) {
  return `
    <div class="rb-cat-block" data-cat-idx="${i}" style="border:1px solid var(--border-subtle);border-radius:8px;padding:12px;background:var(--bg-card);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <h3 style="margin:0;font-size:1rem;font-weight:700;color:var(--brand-gold);">${esc(c.label)}</h3>
        <button class="btn btn-ghost btn-sm" data-action="remove-category" data-cat-idx="${i}" style="color:#dc2626;">Remover categoria</button>
      </div>

      <details ${i===0?'open':''} style="margin-bottom:8px;">
        <summary style="cursor:pointer;font-weight:600;color:var(--text-secondary);font-size:0.85rem;">Hotéis (${(c.hotels||[]).length})</summary>
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;">
          ${(c.hotels||[]).map((h,hi)=>hotelRowHTML(i,hi,h)).join('')}
          <button class="btn btn-secondary btn-sm" data-action="add-hotel" data-cat-idx="${i}" style="align-self:flex-start;">+ Hotel</button>
        </div>
      </details>

      <details style="margin-bottom:8px;">
        <summary style="cursor:pointer;font-weight:600;color:var(--text-secondary);font-size:0.85rem;">Pricing (${(c.pricing||[]).length} períodos)</summary>
        <div style="margin-top:8px;display:flex;flex-direction:column;gap:6px;">
          ${(c.pricing||[]).map((p,pi)=>pricingRowHTML(i,pi,p)).join('')}
          <button class="btn btn-secondary btn-sm" data-action="add-pricing" data-cat-idx="${i}" style="align-self:flex-start;">+ Período</button>
        </div>
      </details>

      <div>
        <label class="form-label" style="font-size:0.7rem;">Notas da categoria</label>
        <input class="form-input" data-cat-bind="notes" data-cat-idx="${i}" value="${esc(c.notes)}" placeholder="Observações específicas...">
      </div>
    </div>
  `;
}

function hotelRowHTML(ci, hi, h) {
  return `
    <div class="rb-hotel-row" data-cat-idx="${ci}" data-hotel-idx="${hi}" style="display:grid;grid-template-columns:1fr 1.5fr 1fr 70px auto;gap:6px;align-items:end;">
      <input class="form-input" data-hotel-bind="city"     data-cat-idx="${ci}" data-hotel-idx="${hi}" value="${esc(h.city)}"     placeholder="Cidade">
      <input class="form-input" data-hotel-bind="name"     data-cat-idx="${ci}" data-hotel-idx="${hi}" value="${esc(h.name)}"     placeholder="Hotel">
      <input class="form-input" data-hotel-bind="roomType" data-cat-idx="${ci}" data-hotel-idx="${hi}" value="${esc(h.roomType)}" placeholder="Tipo apto">
      <input class="form-input" type="number" min="0" data-hotel-bind="nights" data-cat-idx="${ci}" data-hotel-idx="${hi}" value="${h.nights||0}">
      <button class="btn btn-ghost btn-sm" data-action="remove-hotel" data-cat-idx="${ci}" data-hotel-idx="${hi}" style="color:#dc2626;">✕</button>
    </div>
  `;
}

function pricingRowHTML(ci, pi, p) {
  const period = p.period || {};
  return `
    <div class="rb-pricing-row" data-cat-idx="${ci}" data-pricing-idx="${pi}" style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr 80px auto;gap:6px;align-items:end;">
      <div><label class="form-label" style="font-size:0.65rem;">Início</label>
        <input class="form-input" type="date" data-pricing-bind="period.start" data-cat-idx="${ci}" data-pricing-idx="${pi}" value="${esc(period.start)}"></div>
      <div><label class="form-label" style="font-size:0.65rem;">Fim</label>
        <input class="form-input" type="date" data-pricing-bind="period.end" data-cat-idx="${ci}" data-pricing-idx="${pi}" value="${esc(period.end)}"></div>
      <div><label class="form-label" style="font-size:0.65rem;">Single (por pessoa)</label>
        <input class="form-input" type="number" step="0.01" data-pricing-bind="single" data-cat-idx="${ci}" data-pricing-idx="${pi}" value="${p.single||0}"></div>
      <div><label class="form-label" style="font-size:0.65rem;">Duplo (por pessoa)</label>
        <input class="form-input" type="number" step="0.01" data-pricing-bind="double" data-cat-idx="${ci}" data-pricing-idx="${pi}" value="${p.double||0}"></div>
      <div><label class="form-label" style="font-size:0.65rem;">Moeda</label>
        <select class="form-select" data-pricing-bind="currency" data-cat-idx="${ci}" data-pricing-idx="${pi}">
          ${['USD','BRL','EUR'].map(m=>`<option value="${m}" ${p.currency===m?'selected':''}>${m}</option>`).join('')}
        </select></div>
      <button class="btn btn-ghost btn-sm" data-action="remove-pricing" data-cat-idx="${ci}" data-pricing-idx="${pi}" style="color:#dc2626;">✕</button>
    </div>
  `;
}

function renderIncludes() {
  const d = state.doc;
  const buckets = [
    { key: 'hospedagem',   label: 'Hospedagem' },
    { key: 'traslados',    label: 'Traslados privativos' },
    { key: 'passeios',     label: 'Passeios' },
    { key: 'assistencia',  label: 'Assistência no aeroporto' },
    { key: 'aereoInterno', label: 'Aéreo interno' },
    { key: 'trem',         label: 'Trem' },
    { key: 'outros',       label: 'Outros' },
  ];
  return `
    <section class="rb-section" data-section="includes">
      <h2 class="rb-section-title">Inclui</h2>
      ${buckets.map(b => `
        <details ${(d.includes?.[b.key]||[]).length ? 'open' : ''} style="margin-bottom:8px;">
          <summary style="cursor:pointer;font-weight:600;color:var(--text-secondary);">${esc(b.label)} (${(d.includes?.[b.key]||[]).length})</summary>
          <textarea class="form-textarea" rows="3" data-inc-bind="${b.key}" placeholder="Um item por linha">${esc((d.includes?.[b.key]||[]).join('\n'))}</textarea>
        </details>
      `).join('')}

      <h2 class="rb-section-title" style="margin-top:16px;">Não inclui</h2>
      <textarea class="form-textarea" rows="5" data-bind-multiline="excludes" placeholder="Um item por linha">${esc((d.excludes||[]).join('\n'))}</textarea>
    </section>
  `;
}

function renderPayment() {
  const d = state.doc;
  return `
    <section class="rb-section" data-section="payment">
      <h2 class="rb-section-title">Pagamento</h2>
      <div class="form-row">
        <label class="form-label">Forma de pagamento — parte terrestre</label>
        <textarea class="form-textarea" rows="2" data-bind="payment.terrestrial" placeholder="Ex: À vista ou 40% entrada + 2x cartão">${esc(d.payment?.terrestrial)}</textarea>
      </div>
      <div class="form-row">
        <label class="form-label">Forma de pagamento — parte aérea</label>
        <textarea class="form-textarea" rows="2" data-bind="payment.aerial">${esc(d.payment?.aerial)}</textarea>
      </div>
      <div class="form-row" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
        <div>
          <label class="form-label">Sinal — valor</label>
          <input class="form-input" type="number" step="0.01" data-bind="payment.deposit.amount" value="${d.payment?.deposit?.amount||0}">
        </div>
        <div>
          <label class="form-label">Moeda</label>
          <select class="form-select" data-bind="payment.deposit.currency">
            ${['USD','BRL','EUR'].map(m=>`<option value="${m}" ${d.payment?.deposit?.currency===m?'selected':''}>${m}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="form-label">Por pessoa?</label>
          <select class="form-select" data-bind="payment.deposit.perPerson">
            <option value="true"  ${d.payment?.deposit?.perPerson?'selected':''}>Sim</option>
            <option value="false" ${!d.payment?.deposit?.perPerson?'selected':''}>Não</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <label class="form-label">Sinal — notas</label>
        <input class="form-input" data-bind="payment.deposit.notes" value="${esc(d.payment?.deposit?.notes)}">
      </div>
      <div class="form-row">
        <label class="form-label">Prazo de pagamento (saldo)</label>
        <textarea class="form-textarea" rows="2" data-bind="payment.settlement" placeholder="Ex: 48h após confirmação da reserva">${esc(d.payment?.settlement)}</textarea>
      </div>

      <h2 class="rb-section-title" style="margin-top:16px;">Cancelamento</h2>
      <div id="rb-cancel-list" style="display:flex;flex-direction:column;gap:6px;">
        ${(d.cancellation||[]).map((c,i)=>cancelRowHTML(c,i)).join('')}
      </div>
      <button class="btn btn-secondary btn-sm" data-action="add-cancel" style="margin-top:8px;">+ Adicionar faixa</button>
    </section>
  `;
}

function cancelRowHTML(c, i) {
  return `
    <div class="rb-cancel-row" data-cancel-idx="${i}" style="display:grid;grid-template-columns:1fr 1fr 2fr auto;gap:6px;align-items:end;">
      <div><label class="form-label" style="font-size:0.7rem;">Até X dias antes</label>
        <input class="form-input" type="number" min="0" data-cancel-bind="fromDays" data-cancel-idx="${i}" value="${c.fromDays||0}"></div>
      <div><label class="form-label" style="font-size:0.7rem;">Multa %</label>
        <input class="form-input" type="number" min="0" max="100" data-cancel-bind="multaPercent" data-cancel-idx="${i}" value="${c.multaPercent||0}"></div>
      <div><label class="form-label" style="font-size:0.7rem;">Notas</label>
        <input class="form-input" data-cancel-bind="notes" data-cancel-idx="${i}" value="${esc(c.notes)}"></div>
      <button class="btn btn-ghost btn-sm" data-action="remove-cancel" data-cancel-idx="${i}" style="color:#dc2626;">✕</button>
    </div>
  `;
}

function renderDocs() {
  const d = state.doc;
  return `
    <section class="rb-section" data-section="docs">
      <h2 class="rb-section-title">Documentação</h2>
      <div class="form-row">
        <label class="form-label">Passaporte</label>
        <textarea class="form-textarea" rows="3" data-bind="documentation.passport">${esc(d.documentation?.passport)}</textarea>
      </div>
      <div class="form-row">
        <label class="form-label">Menores de idade</label>
        <textarea class="form-textarea" rows="2" data-bind="documentation.minors">${esc(d.documentation?.minors)}</textarea>
      </div>
      <div class="form-row">
        <label class="form-label">Vacinas</label>
        <textarea class="form-textarea" rows="3" data-bind="documentation.vaccines">${esc(d.documentation?.vaccines)}</textarea>
      </div>

      <label class="form-label" style="margin-top:8px;">Vistos por país</label>
      <div id="rb-visas-list" style="display:flex;flex-direction:column;gap:6px;">
        ${(d.documentation?.visas||[]).map((v,i)=>visaRowHTML(v,i)).join('')}
      </div>
      <button class="btn btn-secondary btn-sm" data-action="add-visa" style="margin-top:8px;">+ Adicionar país</button>

      <h2 class="rb-section-title" style="margin-top:16px;">Notas de viagem</h2>
      <textarea class="form-textarea" rows="5" data-bind-multiline="travelNotes" placeholder="Um item por linha (clima, altitude, festas locais...)">${esc((d.travelNotes||[]).join('\n'))}</textarea>
    </section>
  `;
}

function visaRowHTML(v, i) {
  return `
    <div class="rb-visa-row" data-visa-idx="${i}" style="display:grid;grid-template-columns:1fr 100px 2fr auto;gap:6px;align-items:end;">
      <div><label class="form-label" style="font-size:0.7rem;">País</label>
        <input class="form-input" data-visa-bind="country" data-visa-idx="${i}" value="${esc(v.country)}" placeholder="China"></div>
      <div><label class="form-label" style="font-size:0.7rem;">Exige visto?</label>
        <select class="form-select" data-visa-bind="required" data-visa-idx="${i}">
          <option value="true"  ${v.required?'selected':''}>Sim</option>
          <option value="false" ${!v.required?'selected':''}>Não</option>
        </select></div>
      <div><label class="form-label" style="font-size:0.7rem;">Notas</label>
        <input class="form-input" data-visa-bind="notes" data-visa-idx="${i}" value="${esc(v.notes)}"></div>
      <button class="btn btn-ghost btn-sm" data-action="remove-visa" data-visa-idx="${i}" style="color:#dc2626;">✕</button>
    </div>
  `;
}

/* ───────────────────────── Helpers (binding) ───────────────────────── */

function setDeep(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function getDeep(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function coerce(value, type) {
  if (type === 'number') return value === '' ? 0 : Number(value);
  if (type === 'bool')   return value === 'true' || value === true;
  return value;
}

/* ───────────────────────── Main render ───────────────────────── */

export async function renderRoteiroBankEditor(container) {
  // v4.50.10+ Aborta listeners de invocações anteriores (mesma rota re-aberta).
  // Antes: cada navegação pra #banco-roteiro-editor adicionava +1 listener no
  // container, causando 2x/3x/Nx toasts em qualquer ação delegada.
  if (state.abortCtrl) state.abortCtrl.abort();
  state.abortCtrl = new AbortController();
  const signal = state.abortCtrl.signal;

  const qs = parseQs();
  state.id = qs.id || null;
  state.doc = emptyRoteiroBank();

  if (state.id) {
    try {
      const d = await fetchRoteiroBank(state.id);
      if (d) state.doc = d;
      else { toast.warning('Roteiro não encontrado — abrindo novo.'); state.id = null; }
    } catch (e) {
      console.error(e); toast.error('Falha ao carregar: ' + e.message);
    }
  }

  // Categorias + coleções dinâmicas (defaults + custom)
  try { state.categories = await fetchBankCategories(); } catch {}
  try { state.collections = await fetchBankCollections(); } catch {}

  if (!canEdit() && !state.id) {
    container.innerHTML = `
      <div class="page-container" style="padding:40px;text-align:center;">
        <h2>Sem permissão pra criar</h2>
        <p>Solicite ao administrador a permission <code>portal_destinations_manage</code>.</p>
        <a href="#banco-roteiros" class="btn btn-secondary" style="margin-top:8px;">← Voltar ao banco</a>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-container" style="padding:20px;max-width:1100px;margin:0 auto;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <div>
          <a href="#banco-roteiros" style="color:var(--text-muted);text-decoration:none;font-size:0.85rem;">← Banco de Roteiros</a>
          <h1 style="margin:6px 0 0;font-size:1.5rem;font-weight:700;">${esc(state.doc.title) || 'Novo roteiro'}</h1>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span id="rb-save-indicator" style="color:var(--text-muted);font-size:0.8rem;">Carregado</span>
          ${canEdit() ? `<button class="btn btn-primary" data-action="save-now">Salvar agora</button>` : ''}
        </div>
      </div>

      ${renderCapa()}
      ${renderGeo()}
      ${renderDays()}
      ${renderCategories()}
      ${renderIncludes()}
      ${renderPayment()}
      ${renderDocs()}

      <div style="margin-top:24px;padding-top:16px;border-top:1px solid var(--border-subtle);text-align:right;">
        ${canEdit() ? `<button class="btn btn-primary" data-action="save-now">Salvar agora</button>` : ''}
        <a href="#banco-roteiros" class="btn btn-secondary" style="margin-left:8px;">Voltar</a>
      </div>
    </div>

    <style>
      .rb-section { background:var(--bg-card); border:1px solid var(--border-subtle); border-radius:12px; padding:16px 20px; margin-bottom:16px; }
      .rb-section-title { font-size:1.05rem; font-weight:700; color:var(--text-primary); margin:0 0 12px; padding-bottom:8px; border-bottom:1px solid var(--border-subtle); }
      .form-row { margin-bottom:10px; }
      .form-label { display:block; font-size:0.78rem; font-weight:600; color:var(--text-secondary); margin-bottom:4px; }
      .form-input, .form-select, .form-textarea { width:100%; padding:8px 10px; border:1px solid var(--border-default); border-radius:6px; font-size:0.875rem; font-family:inherit; background:var(--bg-input,#fff); color:var(--text-primary); }
      .form-input:focus, .form-select:focus, .form-textarea:focus { outline:none; border-color:var(--brand-blue); box-shadow:0 0 0 3px rgba(59,130,246,0.1); }
    </style>
  `;

  /* ───────────────────────── Event delegation ───────────────────────── */

  container.addEventListener('input', (e) => {
    const t = e.target;
    // Top-level binding
    if (t.matches('[data-bind]')) {
      const path = t.dataset.bind;
      let val = t.value;
      if (t.type === 'number') val = val === '' ? 0 : Number(val);
      if (path.endsWith('perPerson')) val = (val === 'true' || val === true);
      setDeep(state.doc, path, val);
      dirty();
      return;
    }
    if (t.matches('[data-bind-tags]')) {
      state.doc.tags = t.value.split(',').map(s => s.trim()).filter(Boolean);
      dirty();
      return;
    }
    if (t.matches('[data-bind-multiline]')) {
      const path = t.dataset.bindMultiline;
      setDeep(state.doc, path, t.value.split('\n').map(s => s.trim()).filter(Boolean));
      dirty();
      return;
    }
    if (t.matches('[data-inc-bind]')) {
      const k = t.dataset.incBind;
      if (!state.doc.includes) state.doc.includes = {};
      state.doc.includes[k] = t.value.split('\n').map(s => s.trim()).filter(Boolean);
      dirty();
      return;
    }
    // City
    if (t.matches('[data-city-bind]')) {
      const i = +t.dataset.cityIdx; const k = t.dataset.cityBind;
      if (!state.doc.geo.cities[i]) state.doc.geo.cities[i] = {};
      state.doc.geo.cities[i][k] = t.type === 'number' ? Number(t.value || 0) : t.value;
      dirty();
      return;
    }
    // Day
    if (t.matches('[data-day-bind]')) {
      const i = +t.dataset.dayIdx; const k = t.dataset.dayBind;
      if (!state.doc.days[i]) state.doc.days[i] = {};
      state.doc.days[i][k] = t.type === 'number' ? Number(t.value || 0) : t.value;
      dirty();
      return;
    }
    // Category notes
    if (t.matches('[data-cat-bind]')) {
      const i = +t.dataset.catIdx; const k = t.dataset.catBind;
      state.doc.categories[i][k] = t.value;
      dirty();
      return;
    }
    // Hotel
    if (t.matches('[data-hotel-bind]')) {
      const ci = +t.dataset.catIdx; const hi = +t.dataset.hotelIdx; const k = t.dataset.hotelBind;
      if (!state.doc.categories[ci].hotels) state.doc.categories[ci].hotels = [];
      if (!state.doc.categories[ci].hotels[hi]) state.doc.categories[ci].hotels[hi] = {};
      state.doc.categories[ci].hotels[hi][k] = t.type === 'number' ? Number(t.value || 0) : t.value;
      dirty();
      return;
    }
    // Pricing
    if (t.matches('[data-pricing-bind]')) {
      const ci = +t.dataset.catIdx; const pi = +t.dataset.pricingIdx; const path = t.dataset.pricingBind;
      if (!state.doc.categories[ci].pricing) state.doc.categories[ci].pricing = [];
      if (!state.doc.categories[ci].pricing[pi]) state.doc.categories[ci].pricing[pi] = {};
      let val = t.value;
      if (t.type === 'number') val = val === '' ? 0 : Number(val);
      setDeep(state.doc.categories[ci].pricing[pi], path, val);
      dirty();
      return;
    }
    // Cancel
    if (t.matches('[data-cancel-bind]')) {
      const i = +t.dataset.cancelIdx; const k = t.dataset.cancelBind;
      if (!state.doc.cancellation[i]) state.doc.cancellation[i] = {};
      state.doc.cancellation[i][k] = t.type === 'number' ? Number(t.value || 0) : t.value;
      dirty();
      return;
    }
    // Visa
    if (t.matches('[data-visa-bind]')) {
      const i = +t.dataset.visaIdx; const k = t.dataset.visaBind;
      if (!state.doc.documentation.visas[i]) state.doc.documentation.visas[i] = {};
      let val = t.value;
      if (k === 'required') val = (val === 'true' || val === true);
      state.doc.documentation.visas[i][k] = val;
      dirty();
      return;
    }
  }, { signal });

  container.addEventListener('change', (e) => {
    if (e.target.matches('select[data-bind], select[data-city-bind], select[data-pricing-bind], select[data-visa-bind]')) {
      // Reusa o handler de input
      container.dispatchEvent(new Event('input', { bubbles: false }));
      // Mas precisa propagar o evento ao mesmo target:
      const ev = new Event('input', { bubbles: true });
      e.target.dispatchEvent(ev);
    }
  }, { signal });

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'save-now') {
      if (state.autosaveTimer) clearTimeout(state.autosaveTimer);
      state.dirty = true;
      await autosave();
      toast.success('Salvo.');
      return;
    }

    // v4.50.1+ CRUD modais
    if (action === 'manage-categories') {
      await openMetaModal({
        title: 'Gerenciar categorias de hospedagem',
        items: state.categories,
        kind: 'categoria',
        save: saveBankCategory,
        del: deleteBankCategory,
        onChange: async () => { state.categories = await fetchBankCategories(); rerenderCategories(container); },
      });
      return;
    }
    if (action === 'manage-collections') {
      await openMetaModal({
        title: 'Gerenciar coleções',
        items: state.collections,
        kind: 'coleção',
        save: saveBankCollection,
        del: deleteBankCollection,
        onChange: async () => { state.collections = await fetchBankCollections(); rerenderCapa(container); },
      });
      return;
    }

    // Cidade
    if (action === 'add-city') {
      state.doc.geo.cities.push({ city: '', country: '', continent: '', nights: 0 });
      const wrap = container.querySelector('#rb-cities-list');
      if (wrap) wrap.insertAdjacentHTML('beforeend', cityRowHTML(state.doc.geo.cities[state.doc.geo.cities.length-1], state.doc.geo.cities.length-1));
      dirty(); return;
    }
    if (action === 'remove-city') {
      const i = +btn.dataset.cityIdx;
      state.doc.geo.cities.splice(i, 1);
      const wrap = container.querySelector('#rb-cities-list');
      if (wrap) wrap.innerHTML = state.doc.geo.cities.map((c,i)=>cityRowHTML(c,i)).join('');
      dirty(); return;
    }

    // Dia
    if (action === 'add-day') {
      const next = (state.doc.days[state.doc.days.length-1]?.dayNumber || state.doc.days.length) + 1;
      state.doc.days.push({ dayNumber: next, city: '', title: '', narrative: '', overnightCity: '', flightLeg: false });
      const wrap = container.querySelector('#rb-days-list');
      if (wrap) wrap.insertAdjacentHTML('beforeend', dayRowHTML(state.doc.days[state.doc.days.length-1], state.doc.days.length-1));
      dirty(); return;
    }
    if (action === 'remove-day') {
      const i = +btn.dataset.dayIdx;
      state.doc.days.splice(i, 1);
      const wrap = container.querySelector('#rb-days-list');
      if (wrap) wrap.innerHTML = state.doc.days.map((d,i)=>dayRowHTML(d,i)).join('');
      dirty(); return;
    }

    // Categorias
    if (action === 'add-category') {
      const key = btn.dataset.catKey; const label = btn.dataset.catLabel;
      if (state.doc.categories.some(c => c.key === key)) {
        toast.warning('Essa categoria já existe.');
        return;
      }
      state.doc.categories.push({ key, label, hotels: [], pricing: [], notes: '' });
      const wrap = container.querySelector('#rb-cats-list');
      if (wrap) wrap.innerHTML = state.doc.categories.map((c,i)=>catBlockHTML(c,i)).join('');
      dirty(); return;
    }
    if (action === 'remove-category') {
      if (!confirm('Remover esta categoria?')) return;
      const i = +btn.dataset.catIdx;
      state.doc.categories.splice(i, 1);
      const wrap = container.querySelector('#rb-cats-list');
      if (wrap) wrap.innerHTML = state.doc.categories.map((c,i)=>catBlockHTML(c,i)).join('');
      dirty(); return;
    }
    if (action === 'add-hotel') {
      const ci = +btn.dataset.catIdx;
      if (!state.doc.categories[ci].hotels) state.doc.categories[ci].hotels = [];
      state.doc.categories[ci].hotels.push({ city: '', name: '', roomType: '', nights: 0, supplierUrl: '' });
      const wrap = container.querySelector('#rb-cats-list');
      if (wrap) wrap.innerHTML = state.doc.categories.map((c,i)=>catBlockHTML(c,i)).join('');
      dirty(); return;
    }
    if (action === 'remove-hotel') {
      const ci = +btn.dataset.catIdx; const hi = +btn.dataset.hotelIdx;
      state.doc.categories[ci].hotels.splice(hi, 1);
      const wrap = container.querySelector('#rb-cats-list');
      if (wrap) wrap.innerHTML = state.doc.categories.map((c,i)=>catBlockHTML(c,i)).join('');
      dirty(); return;
    }
    if (action === 'add-pricing') {
      const ci = +btn.dataset.catIdx;
      if (!state.doc.categories[ci].pricing) state.doc.categories[ci].pricing = [];
      state.doc.categories[ci].pricing.push({ period: { start: '', end: '' }, single: 0, double: 0, currency: 'USD' });
      const wrap = container.querySelector('#rb-cats-list');
      if (wrap) wrap.innerHTML = state.doc.categories.map((c,i)=>catBlockHTML(c,i)).join('');
      dirty(); return;
    }
    if (action === 'remove-pricing') {
      const ci = +btn.dataset.catIdx; const pi = +btn.dataset.pricingIdx;
      state.doc.categories[ci].pricing.splice(pi, 1);
      const wrap = container.querySelector('#rb-cats-list');
      if (wrap) wrap.innerHTML = state.doc.categories.map((c,i)=>catBlockHTML(c,i)).join('');
      dirty(); return;
    }

    // Cancelamento
    if (action === 'add-cancel') {
      state.doc.cancellation.push({ fromDays: 0, multaPercent: 0, notes: '' });
      const wrap = container.querySelector('#rb-cancel-list');
      if (wrap) wrap.innerHTML = state.doc.cancellation.map((c,i)=>cancelRowHTML(c,i)).join('');
      dirty(); return;
    }
    if (action === 'remove-cancel') {
      const i = +btn.dataset.cancelIdx;
      state.doc.cancellation.splice(i, 1);
      const wrap = container.querySelector('#rb-cancel-list');
      if (wrap) wrap.innerHTML = state.doc.cancellation.map((c,i)=>cancelRowHTML(c,i)).join('');
      dirty(); return;
    }

    // Vistos
    if (action === 'add-visa') {
      if (!state.doc.documentation.visas) state.doc.documentation.visas = [];
      state.doc.documentation.visas.push({ country: '', required: true, notes: '' });
      const wrap = container.querySelector('#rb-visas-list');
      if (wrap) wrap.innerHTML = state.doc.documentation.visas.map((v,i)=>visaRowHTML(v,i)).join('');
      dirty(); return;
    }
    if (action === 'remove-visa') {
      const i = +btn.dataset.visaIdx;
      state.doc.documentation.visas.splice(i, 1);
      const wrap = container.querySelector('#rb-visas-list');
      if (wrap) wrap.innerHTML = state.doc.documentation.visas.map((v,i)=>visaRowHTML(v,i)).join('');
      dirty(); return;
    }
  }, { signal });
}

/* ─── v4.50.1+ Modal CRUD genérico pra categorias/coleções ─── */

function slugify(s) {
  return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function rerenderCapa(container) {
  const sec = container.querySelector('[data-section="capa"]');
  if (sec) sec.outerHTML = renderCapa();
}
function rerenderCategories(container) {
  const sec = container.querySelector('[data-section="categories"]');
  if (sec) sec.outerHTML = renderCategories();
}

/**
 * Modal de CRUD pra qualquer lista key/label (categorias, coleções, etc).
 * Não usa confirm() nativo — Tudo inline.
 */
async function openMetaModal({ title, items, kind, save, del, onChange }) {
  const overlay = document.createElement('div');
  overlay.className = 'rb-meta-modal-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(10,22,40,0.55);z-index:9000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;
  overlay.innerHTML = `
    <div class="rb-meta-modal" style="background:var(--bg-card);border-radius:12px;
      max-width:560px;width:100%;max-height:85vh;display:flex;flex-direction:column;
      box-shadow:0 12px 32px rgba(0,0,0,0.25);">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;">
        <h3 style="margin:0;font-size:1.05rem;font-weight:700;">${esc(title)}</h3>
        <button class="rb-meta-close" style="background:transparent;border:none;font-size:1.4rem;cursor:pointer;color:var(--text-muted);">×</button>
      </div>
      <div class="rb-meta-list" style="overflow-y:auto;padding:12px 20px;flex:1;">
        ${renderMetaList(items)}
      </div>
      <div style="padding:14px 20px;border-top:1px solid var(--border-subtle);display:flex;gap:8px;align-items:end;flex-wrap:wrap;">
        <div style="flex:1;min-width:140px;">
          <label class="form-label" style="font-size:0.7rem;">Label (novo)</label>
          <input class="form-input rb-meta-new-label" type="text" placeholder="Ex: Premium Boutique">
        </div>
        <div style="width:90px;">
          <label class="form-label" style="font-size:0.7rem;">Cor</label>
          <input class="form-input rb-meta-new-color" type="color" value="#3B82F6">
        </div>
        <button class="btn btn-primary btn-sm rb-meta-add" style="height:38px;">+ Adicionar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  function renderMetaList(arr) {
    if (!arr.length) return '<div style="color:var(--text-muted);text-align:center;padding:24px;">Nenhum item.</div>';
    return `<div style="display:flex;flex-direction:column;gap:6px;">${arr.map(it => `
      <div class="rb-meta-row" data-key="${esc(it.key)}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border-subtle);border-radius:8px;">
        <span style="width:14px;height:14px;border-radius:4px;background:${esc(it.color || '#888')};display:inline-block;flex-shrink:0;"></span>
        <input class="form-input rb-meta-label" data-key="${esc(it.key)}" value="${esc(it.label)}" style="flex:1;font-size:0.85rem;">
        <input class="form-input rb-meta-color" type="color" data-key="${esc(it.key)}" value="${esc(it.color || '#888888')}" style="width:50px;padding:2px;">
        <input class="form-input rb-meta-order" type="number" data-key="${esc(it.key)}" value="${it.order || 0}" style="width:60px;font-size:0.78rem;" title="Ordem">
        ${it.builtin ? '<span title="Default do sistema — não pode deletar" style="color:var(--text-muted);font-size:0.7rem;">🔒</span>' : `<button class="btn btn-ghost btn-sm rb-meta-del" data-key="${esc(it.key)}" style="color:#dc2626;">✕</button>`}
      </div>
    `).join('')}</div>`;
  }

  // Fechar
  const close = () => overlay.remove();
  overlay.querySelector('.rb-meta-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  // Add novo
  overlay.querySelector('.rb-meta-add').addEventListener('click', async () => {
    const label = overlay.querySelector('.rb-meta-new-label').value.trim();
    if (!label) { toast.warning(`Preencha o label do ${kind}.`); return; }
    const key = slugify(label);
    if (items.some(i => i.key === key)) { toast.warning('Já existe item com esse label.'); return; }
    try {
      await save(key, {
        label,
        color: overlay.querySelector('.rb-meta-new-color').value || '#3B82F6',
        order: (items[items.length-1]?.order || 0) + 1,
        builtin: false,
      });
      toast.success(`${kind} criada.`);
      await onChange();
      // Refresh modal list
      const newItems = (await (kind === 'categoria' ? fetchBankCategories : fetchBankCollections)());
      overlay.querySelector('.rb-meta-list').innerHTML = renderMetaList(newItems);
      attachRowHandlers();
      overlay.querySelector('.rb-meta-new-label').value = '';
    } catch (e) { toast.error(e.message); }
  });

  // Inline edit + delete
  function attachRowHandlers() {
    overlay.querySelectorAll('.rb-meta-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.key;
        if (!confirm('Remover este item? Roteiros que já usam continuam funcionando.')) return;
        try {
          await del(key);
          toast.success('Removido.');
          await onChange();
          const newItems = (await (kind === 'categoria' ? fetchBankCategories : fetchBankCollections)());
          overlay.querySelector('.rb-meta-list').innerHTML = renderMetaList(newItems);
          attachRowHandlers();
        } catch (e) { toast.error(e.message); }
      });
    });
    overlay.querySelectorAll('.rb-meta-label, .rb-meta-color, .rb-meta-order').forEach(inp => {
      inp.addEventListener('change', async () => {
        const key = inp.dataset.key;
        const row = overlay.querySelector(`.rb-meta-row[data-key="${key}"]`);
        const label = row.querySelector('.rb-meta-label').value.trim();
        const color = row.querySelector('.rb-meta-color').value;
        const order = +row.querySelector('.rb-meta-order').value;
        try {
          await save(key, { label, color, order });
          await onChange();
        } catch (e) { toast.error(e.message); }
      });
    });
  }
  attachRowHandlers();
}

export function destroyRoteiroBankEditor() {
  if (state.autosaveTimer) { clearTimeout(state.autosaveTimer); state.autosaveTimer = null; }
  if (state.abortCtrl)    { state.abortCtrl.abort(); state.abortCtrl = null; }
  state = { id: null, doc: null, dirty: false, saving: false, autosaveTimer: null, abortCtrl: null, categories: DEFAULT_CATEGORIES, collections: DEFAULT_COLLECTIONS };
}
