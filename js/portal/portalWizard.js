/**
 * PRIMETOUR — Portal de Solicitações · Wizard (v4.54.0)
 *
 * UX: 4 passos em tela cheia em vez de form único de scroll.
 * Renê 24/05: "usuarios estao sugerindo que o portal de solicitacoes
 * nao seja em forma, e sim um passo a passo tela cheia, pra facilitar
 * o UX e ficar mais intuitivo. teria de ter poucos passos".
 *
 * Estrutura:
 *   Passo 1 — Setor responsável + Tipo de demanda
 *   Passo 2 — Quando (calendário/data/squad)
 *   Passo 3 — Detalhes (variação, título, descrição, link)
 *   Passo 4 — Sinalizações (urgência, parceria) + Revisão + Enviar
 *
 * Features:
 *   - Auto-save em localStorage por step (chave: portal-wizard-draft.{uid})
 *   - Atalhos: Enter avança, Esc volta
 *   - Skip auto: se só 1 opção (ex: variação), pre-seleciona e avança
 *   - "Enviar + Adicionar outra similar" preserva setor/tipo no próximo
 *   - Validação por step antes de avançar
 *   - Backup do form antigo em portalLegacy.js (fallback se precisar reverter)
 *
 * Schema do doc no Firestore: idêntico ao form antigo — collection `requests`.
 * Zero migração de dados, zero mudança em rules.
 */

import {
  collection, addDoc, getDocs, query, where, limit, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const REQUESTING_AREAS = [
  'BTG','C&P','Célula ICs','Centurion','CEP','Concierge Bradesco',
  'Contabilidade','Diretoria','Eventos','Financeiro','Lazer','Marketing',
  'Operadora','Programa ICs','Projetos','PTS Bradesco','Qualidade','Suppliers','TI',
];

/* ─── Estado interno do wizard ─── */
let _state = null;
let _keyHandler = null;

function _defaultData(user) {
  return {
    // Auto-preenchidos do user logado
    requestingArea: user?.sector || user?.department || '',
    // Step 1
    sector: '',
    typeId: '',
    typeName: '', typeIcon: '', typeColor: '', autoAccept: false,
    // Step 2
    desiredDate: '',
    nucleo: '',
    outOfCalendar: false,
    // Step 3
    variationId: '',
    variationName: '',
    title: '',
    description: '',
    contentLink: '',
    // Step 4
    urgency: false,
    isPartnership: false,
    // v4.54.4+ Lock states (urgency auto-locked quando prazo < SLA)
    urgencyAutoLocked: false,
    urgencyLockReason: '',
  };
}

/* ─── Entry-point ─── */
export function renderPortalWizard(container, opts) {
  const { db, taskTypes, user, onSuccess } = opts;
  _state = {
    step: 1,
    data: _defaultData(user),
    db, taskTypes, user, onSuccess,
    draftKey: `portal-wizard-draft.${user?.uid || 'anon'}`,
    submitting: false,
  };

  // Tenta restaurar rascunho
  const draft = _loadDraft();
  if (draft && _hasDraftContent(draft)) {
    _state.data = { ..._state.data, ...draft.data };
    _state.step = draft.step || 1;
  }

  _renderShell(container);
  _bindKeyboard();
}

/* ─── Pre-preencher campos do wizard externamente (v4.54.2+) ───
 * Usado pelo popup "Solicitação de Newsletter?" no portal.js, que antes
 * preenchia campos `p-setor`/`p-type` do form antigo (não existem mais).
 * Aceita { sector, typeId, date } e atualiza _state.data + re-renderiza o
 * step atual. Se sector+typeId vierem, avança automaticamente pro Step 2.
 */
export function prefillWizardData({ sector, typeId, date } = {}) {
  if (!_state) return false;
  if (sector !== undefined) _state.data.sector = sector;
  if (typeId !== undefined) _captureType(typeId);
  if (date !== undefined) _state.data.desiredDate = date;
  _persistDraft();
  // Se sector+typeId completos, salta pro Step 2 direto (UX do popup é "vai pro calendário")
  if (_state.data.sector && _state.data.typeId && _state.step === 1) {
    _renderStep(2);
  } else {
    _renderStep(_state.step);  // re-render do step atual pra refletir os valores
  }
  return true;
}

/* ─── Cleanup (chamar ao sair) ─── */
export function destroyPortalWizard() {
  if (_keyHandler) {
    document.removeEventListener('keydown', _keyHandler);
    _keyHandler = null;
  }
  _state = null;
}

/* ─── Shell: header progress + content + footer ─── */
function _renderShell(container) {
  container.innerHTML = `
    <div class="pw-root" style="
      max-width:680px;margin:0 auto;padding:24px 16px 120px;
      min-height:calc(100vh - 120px);display:flex;flex-direction:column;">
      <div id="pw-progress"></div>
      <div id="pw-step" style="flex:1;"></div>
      <div id="pw-footer" style="
        position:fixed;bottom:0;left:0;right:0;
        background:var(--bg-card);border-top:1px solid var(--border-subtle);
        padding:14px 16px;z-index:100;
        box-shadow:0 -4px 12px rgba(0,0,0,0.08);"></div>
    </div>
  `;
  _renderStep(_state.step);
}

function _renderProgress() {
  const el = document.getElementById('pw-progress');
  if (!el) return;
  const labels = ['Setor e tipo', 'Quando', 'Detalhes', 'Revisão'];
  const dots = labels.map((label, i) => {
    const n = i + 1;
    const done   = n < _state.step;
    const active = n === _state.step;
    const bg = done ? 'var(--brand-gold)' : active ? 'var(--brand-gold)' : 'var(--border-subtle)';
    const text = done ? '#0A1628' : active ? '#0A1628' : 'var(--text-muted)';
    return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1;">
        <div style="
          width:32px;height:32px;border-radius:50%;background:${bg};color:${text};
          display:flex;align-items:center;justify-content:center;
          font-weight:700;font-size:0.875rem;transition:all 0.2s;">
          ${done ? '✓' : n}
        </div>
        <div style="font-size:0.6875rem;color:${active?'var(--text-primary)':'var(--text-muted)'};
          font-weight:${active?'600':'400'};text-align:center;">
          ${esc(label)}
        </div>
      </div>
    `;
  }).join(`
    <div style="flex:0 0 24px;height:2px;background:var(--border-subtle);margin-top:15px;"></div>
  `);
  el.innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;
      margin-bottom:28px;padding:0 8px;">
      ${dots}
    </div>
  `;
}

function _renderFooter() {
  const el = document.getElementById('pw-footer');
  if (!el) return;
  const isLast = _state.step === 4;
  const isFirst = _state.step === 1;
  const submitting = _state.submitting;
  el.innerHTML = `
    <div style="max-width:680px;margin:0 auto;display:flex;gap:10px;align-items:center;">
      <button class="btn btn-ghost" id="pw-save-exit"
        style="font-size:0.8125rem;color:var(--text-muted);"
        title="Salva rascunho e fecha o navegador. Você pode voltar depois.">
        💾 Salvar e sair
      </button>
      <div style="flex:1;"></div>
      ${isFirst ? '' : `
        <button class="btn btn-secondary" id="pw-back" ${submitting?'disabled':''}>
          ← Voltar
        </button>
      `}
      ${isLast ? `
        <button class="btn btn-ghost" id="pw-submit-another" ${submitting?'disabled':''}
          title="Envia esta solicitação e abre o wizard pra outra similar (mantém setor + tipo)">
          Enviar + Outra similar
        </button>
        <button class="btn btn-primary" id="pw-submit" ${submitting?'disabled':''}>
          ${submitting ? '⏳ Enviando…' : 'Enviar solicitação →'}
        </button>
      ` : `
        <button class="btn btn-primary" id="pw-next">
          Próximo →
        </button>
      `}
    </div>
  `;
  // Wire
  document.getElementById('pw-back')?.addEventListener('click', () => _gotoStep(_state.step - 1));
  document.getElementById('pw-next')?.addEventListener('click', () => _tryAdvance());
  document.getElementById('pw-submit')?.addEventListener('click', () => _onSubmit(false));
  document.getElementById('pw-submit-another')?.addEventListener('click', () => _onSubmit(true));
  document.getElementById('pw-save-exit')?.addEventListener('click', () => {
    _persistDraft();
    alert('Rascunho salvo! Volte quando quiser pra continuar de onde parou.');
  });
}

/* ─── Steps ─── */
function _renderStep(n) {
  _state.step = n;
  _persistDraft();
  _renderProgress();
  const el = document.getElementById('pw-step');
  if (!el) return;
  if (n === 1) { el.innerHTML = _renderStep1(); _wireStep1(); }
  else if (n === 2) { el.innerHTML = _renderStep2(); _wireStep2(); }
  else if (n === 3) { el.innerHTML = _renderStep3(); _wireStep3(); }
  else if (n === 4) { el.innerHTML = _renderStep4(); _wireStep4(); }
  _renderFooter();
  // Foca primeiro campo do step
  setTimeout(() => {
    const first = el.querySelector('input, select, textarea, button:not(.btn-ghost)');
    first?.focus?.();
  }, 50);
}

/* === Passo 1: Setor responsável + Tipo === */
function _renderStep1() {
  const d = _state.data;
  return `
    <div class="portal-card" style="padding:24px;">
      <h2 style="margin:0 0 6px;font-size:1.25rem;color:var(--text-primary);">Pra quem é a demanda?</h2>
      <p style="margin:0 0 20px;color:var(--text-muted);font-size:0.875rem;">
        Quem vai receber esta solicitação? E qual é o tipo?
      </p>

      <div class="form-group">
        <label class="form-label">Setor responsável <span class="required">*</span></label>
        <select class="form-select" id="pw-sector">
          <option value="">— Selecione o setor —</option>
          ${REQUESTING_AREAS.map(a => `<option value="${esc(a)}" ${d.sector===a?'selected':''}>${esc(a)}</option>`).join('')}
        </select>
        <div class="form-error" id="pw-err-sector" style="display:none;color:var(--color-danger);font-size:0.75rem;margin-top:4px;">
          Selecione um setor.
        </div>
      </div>

      <div class="form-group" id="pw-type-wrap" style="margin-top:16px;display:${d.sector?'block':'none'};">
        <label class="form-label">Tipo de demanda <span class="required">*</span></label>
        <select class="form-select" id="pw-type">
          <option value="">— Selecione o tipo —</option>
          ${_typesForSector(d.sector).map(t => `<option value="${esc(t.id)}" ${d.typeId===t.id?'selected':''}>${esc(t.icon||'◈')} ${esc(t.name)}</option>`).join('')}
        </select>
        <div class="form-error" id="pw-err-type" style="display:none;color:var(--color-danger);font-size:0.75rem;margin-top:4px;">
          Selecione o tipo.
        </div>
      </div>
    </div>
  `;
}

function _wireStep1() {
  const sectorSel = document.getElementById('pw-sector');
  const typeWrap  = document.getElementById('pw-type-wrap');
  const typeSel   = document.getElementById('pw-type');

  sectorSel?.addEventListener('change', () => {
    _state.data.sector = sectorSel.value;
    _state.data.typeId = ''; _state.data.typeName = '';
    if (typeWrap) typeWrap.style.display = sectorSel.value ? 'block' : 'none';
    if (typeSel) {
      const types = _typesForSector(sectorSel.value);
      typeSel.innerHTML = `<option value="">— Selecione o tipo —</option>` +
        types.map(t => `<option value="${esc(t.id)}">${esc(t.icon||'◈')} ${esc(t.name)}</option>`).join('');
      // Skip auto: se só 1 tipo, pre-seleciona
      if (types.length === 1) {
        typeSel.value = types[0].id;
        _captureType(types[0].id);
      }
    }
    _persistDraft();
  });

  typeSel?.addEventListener('change', () => {
    _captureType(typeSel.value);
    _persistDraft();
  });
}

function _captureType(typeId) {
  const t = _state.taskTypes.find(x => x.id === typeId);
  _state.data.typeId    = typeId;
  _state.data.typeName  = t?.name || '';
  _state.data.typeIcon  = t?.icon || '';
  _state.data.typeColor = t?.color || '#D4A843';
  _state.data.autoAccept = !!t?.autoAccept;
}

function _validateStep1() {
  // v4.54.1+ Defensive: usa optional chaining em todos os getElementById.
  // _validateStep4 chama _validateStep1 mas os elementos #pw-err-* só
  // existem quando o step 1 está renderizado.
  let ok = true;
  const errSector = document.getElementById('pw-err-sector');
  const errType   = document.getElementById('pw-err-type');
  if (!_state.data.sector) { if (errSector) errSector.style.display = 'block'; ok = false; }
  else                      { if (errSector) errSector.style.display = 'none'; }
  if (!_state.data.typeId) { if (errType) errType.style.display = 'block'; ok = false; }
  else                      { if (errType) errType.style.display = 'none'; }
  return ok;
}

/* === Passo 2: Quando (calendário visual + data + squad + fora-do-cal) === */
function _renderStep2() {
  const d = _state.data;
  const type = _state.taskTypes.find(x => x.id === d.typeId);
  const hasSlots = !!type?.scheduleSlots?.length;
  const minDate = _getMinDate();
  // v4.54.6+ Estado do calendário (mês visualizado) — inicializa se ainda não tem
  if (!_state.calDate) {
    _state.calDate = d.desiredDate ? new Date(d.desiredDate + 'T12:00:00') : new Date();
  }
  return `
    <div class="portal-card" style="padding:24px;">
      <h2 style="margin:0 0 6px;font-size:1.25rem;color:var(--text-primary);">Quando você precisa?</h2>
      <p style="margin:0 0 20px;color:var(--text-muted);font-size:0.875rem;">
        ${hasSlots ? 'Clique em um <strong>slot pré-agendado</strong> (colorido) ou em um <strong>dia vazio</strong>. Slot = dentro do calendário editorial; dia vazio = fora do calendário (impacta performance).' : 'Escolha a data desejada de entrega.'}
      </p>

      <!-- Calendário visual -->
      <div id="pw-calendar-widget">${_renderCalendarGrid(type)}</div>

      <!-- Data selecionada (input pra ajuste fino + fallback) -->
      <div class="form-group" style="margin-top:16px;">
        <label class="form-label">Data selecionada <span class="required">*</span></label>
        <input type="date" class="form-input" id="pw-date" min="${minDate}" value="${esc(d.desiredDate)}" />
        <div class="form-error" id="pw-err-date" style="display:none;color:var(--color-danger);font-size:0.75rem;margin-top:4px;">
          A data não pode ser anterior a hoje.
        </div>
      </div>

      <div class="form-group" id="pw-nucleo-wrap" style="margin-top:16px;">
        <label class="form-label">Squad responsável <span style="color:var(--text-muted);font-weight:400;">(opcional)</span></label>
        <select class="form-select" id="pw-nucleo">
          <option value="">— Sem squad específico —</option>
        </select>
        <small style="display:block;margin-top:4px;color:var(--text-muted);font-size:0.75rem;">
          Carregando squads do setor…
        </small>
      </div>

      <div class="form-group" style="margin-top:16px;">
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:12px;
          border:1px solid var(--border-subtle);border-radius:8px;background:var(--bg-surface);">
          <input type="checkbox" id="pw-ooc" ${d.outOfCalendar?'checked':''} style="margin-top:3px;" />
          <div>
            <div style="font-weight:500;color:var(--text-primary);">Fora do calendário editorial</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
              Marque se esta demanda não estava prevista. Pode impactar performance — use só quando necessário.
            </div>
          </div>
        </label>
      </div>
    </div>
  `;
}

function _wireStep2() {
  const dateInput = document.getElementById('pw-date');
  const oocCb     = document.getElementById('pw-ooc');
  const nucleoSel = document.getElementById('pw-nucleo');

  dateInput?.addEventListener('change', () => {
    _state.data.desiredDate = dateInput.value;
    _checkAutoUrgency();  // v4.54.4+
    _persistDraft();
    _refreshCalendarSelection();
  });
  oocCb?.addEventListener('change', () => {
    _state.data.outOfCalendar = oocCb.checked;
    _persistDraft();
  });
  nucleoSel?.addEventListener('change', () => {
    _state.data.nucleo = nucleoSel.value;
    _persistDraft();
  });

  // v4.54.6+ Calendário visual — handlers
  _wireCalendarGrid();

  // Carrega squads do setor (async)
  _loadSquadsForSector(_state.data.sector, _state.data.nucleo).then(html => {
    if (nucleoSel) nucleoSel.innerHTML = html;
    if (nucleoSel) nucleoSel.value = _state.data.nucleo || '';
    const hint = nucleoSel?.parentElement?.querySelector('small');
    if (hint) hint.textContent = '';
  });
}

function _validateStep2() {
  const ok = !!_state.data.desiredDate;
  const err = document.getElementById('pw-err-date');
  if (err) err.style.display = ok ? 'none' : 'block';
  return ok;
}

function _renderSlotChips(type) {
  // v4.54.6+ Mantido pra retrocompat se algum lugar chamar — não é mais usado no Step 2.
  const slots = type?.scheduleSlots || [];
  if (!slots.length) return '<div style="color:var(--text-muted);font-size:0.75rem;">Nenhum slot pré-agendado.</div>';
  return slots.slice(0, 12).map(s => {
    const variation = type.variations?.find(v => v.id === s.variationId);
    return `
      <button type="button" class="pw-slot-chip" data-date="${esc(s.date)}" data-variation-id="${esc(s.variationId||'')}"
        style="padding:8px;border:1px solid var(--border-subtle);border-radius:6px;
        background:var(--bg-surface);cursor:pointer;text-align:left;font-size:0.75rem;
        transition:background 0.15s;">
        <div style="font-weight:600;color:var(--text-primary);">${esc(_fmtDate(s.date))}</div>
        ${variation ? `<div style="color:var(--text-muted);margin-top:2px;">${esc(variation.name)}</div>` : ''}
      </button>
    `;
  }).join('');
}

/* v4.54.6+ Calendário visual mensal pro Step 2.
 * Mostra slots pré-agendados (recurrence weekly/monthly_days/custom) marcados
 * coloridos; dias vazios clicáveis com "fora do calendário" auto-marcado.
 */
const PT_DAYS_S = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const PT_MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function _getSlotsForDate(type, date) {
  if (!type?.scheduleSlots) return [];
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
  const dow = date.getDay();
  const iso = _toISODate(date);
  return (type.scheduleSlots || []).filter(s => {
    if (s.active === false) return false;
    if (s.recurrence === 'weekly')        return s.weekDay === dow;
    if (s.recurrence === 'monthly_days')  return (s.monthDays || []).includes(d);
    if (s.recurrence === 'custom')        return (s.customDates || []).includes(iso);
    return false;
  });
}

function _toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function _renderCalendarGrid(type) {
  const cal = _state.calDate || new Date();
  const y = cal.getFullYear();
  const m = cal.getMonth();
  const today = new Date(); today.setHours(0,0,0,0);
  const firstDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const selected = _state.data.desiredDate || '';

  let cells = '';
  for (let i = 0; i < firstDow; i++) cells += '<div></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(y, m, d);
    date.setHours(0,0,0,0);
    const iso = _toISODate(date);
    const isPast = date < today;
    const isToday = +date === +today;
    const isSelected = iso === selected;
    const slots = _getSlotsForDate(type, date);
    const hasSlots = slots.length > 0;
    const slotTitle = hasSlots ? slots[0].title || 'Slot' : '';
    const slotColor = hasSlots ? (slots[0].color || 'var(--brand-gold)') : '';
    const slotId = hasSlots ? slots[0].id : '';

    const bg = isSelected ? 'rgba(212,168,67,0.25)'
             : hasSlots   ? `${slotColor}22`
             : isToday    ? 'var(--bg-surface)'
             : 'transparent';
    const border = isSelected ? '2px solid var(--brand-gold)'
                 : hasSlots   ? `1px solid ${slotColor}`
                 : isToday    ? '1px dashed var(--border-default)'
                 : '1px solid var(--border-subtle)';
    const cursor = isPast ? 'not-allowed' : 'pointer';
    const opacity = isPast ? '0.35' : '1';

    cells += `
      <div class="pw-cal-day" data-date="${iso}" data-has-slot="${hasSlots?'1':'0'}" data-slot-id="${esc(slotId)}"
        ${isPast?'data-disabled="1"':''}
        title="${hasSlots ? esc(slotTitle) + (isPast?' (passado)':'') : (isPast?'Data passada':'Fora do calendário editorial')}"
        style="
          background:${bg};border:${border};border-radius:6px;
          padding:6px 4px;cursor:${cursor};opacity:${opacity};
          min-height:54px;display:flex;flex-direction:column;
          font-size:0.75rem;line-height:1.2;transition:all 0.12s;
          ${isPast?'':'user-select:none;'}">
        <div style="font-weight:${isToday?'700':'500'};color:${isToday?'var(--brand-gold)':'var(--text-primary)'};">
          ${d}
        </div>
        ${hasSlots ? `
          <div style="font-size:0.625rem;color:${slotColor};font-weight:600;margin-top:auto;line-height:1.1;
            overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${esc(slotTitle)}
          </div>
        ` : ''}
      </div>
    `;
  }

  return `
    <div style="border:1px solid var(--border-subtle);border-radius:10px;padding:12px;background:var(--bg-surface);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <button type="button" id="pw-cal-prev" aria-label="Mês anterior"
          style="background:transparent;border:1px solid var(--border-default);border-radius:6px;width:30px;height:30px;cursor:pointer;color:var(--text-secondary);">‹</button>
        <div style="font-weight:600;font-size:0.9375rem;color:var(--text-primary);">
          ${PT_MONTHS[m]} ${y}
        </div>
        <button type="button" id="pw-cal-next" aria-label="Próximo mês"
          style="background:transparent;border:1px solid var(--border-default);border-radius:6px;width:30px;height:30px;cursor:pointer;color:var(--text-secondary);">›</button>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px;">
        ${PT_DAYS_S.map(d => `<div style="text-align:center;font-size:0.6875rem;color:var(--text-muted);font-weight:600;">${d}</div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">
        ${cells}
      </div>
      <div style="margin-top:10px;display:flex;gap:14px;font-size:0.6875rem;color:var(--text-muted);flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="width:12px;height:12px;border-radius:3px;background:rgba(212,168,67,0.25);border:2px solid var(--brand-gold);display:inline-block;"></span>
          Selecionado
        </div>
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="width:12px;height:12px;border-radius:3px;background:#44d54122;border:1px solid #44d541;display:inline-block;"></span>
          Slot pré-agendado
        </div>
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="width:12px;height:12px;border-radius:3px;background:transparent;border:1px solid var(--border-subtle);display:inline-block;"></span>
          Dia vazio (= fora do calendário)
        </div>
      </div>
    </div>
  `;
}

function _wireCalendarGrid() {
  const prev = document.getElementById('pw-cal-prev');
  const next = document.getElementById('pw-cal-next');
  prev?.addEventListener('click', () => {
    _state.calDate = new Date(_state.calDate);
    _state.calDate.setMonth(_state.calDate.getMonth() - 1);
    _rerenderCalendar();
  });
  next?.addEventListener('click', () => {
    _state.calDate = new Date(_state.calDate);
    _state.calDate.setMonth(_state.calDate.getMonth() + 1);
    _rerenderCalendar();
  });

  document.querySelectorAll('.pw-cal-day')?.forEach(cell => {
    if (cell.dataset.disabled === '1') return;
    cell.addEventListener('click', () => {
      const iso = cell.dataset.date;
      const hasSlot = cell.dataset.hasSlot === '1';
      const slotId = cell.dataset.slotId;
      const type = _state.taskTypes.find(t => t.id === _state.data.typeId);

      _state.data.desiredDate = iso;
      const dateInput = document.getElementById('pw-date');
      if (dateInput) dateInput.value = iso;

      if (hasSlot) {
        // Dentro do calendário editorial: desmarca OOC
        _state.data.outOfCalendar = false;
        const slot = (type?.scheduleSlots || []).find(s => s.id === slotId);
        // Se slot tem requestingArea, pre-prenche
        if (slot?.requestingArea) _state.data.requestingArea = slot.requestingArea;
      } else {
        // Dia vazio: força fora do calendário
        _state.data.outOfCalendar = true;
      }

      const oocCb = document.getElementById('pw-ooc');
      if (oocCb) oocCb.checked = _state.data.outOfCalendar;

      _checkAutoUrgency();
      _persistDraft();
      _rerenderCalendar();
    });
  });
}

function _rerenderCalendar() {
  const widget = document.getElementById('pw-calendar-widget');
  if (!widget) return;
  const type = _state.taskTypes.find(x => x.id === _state.data.typeId);
  widget.innerHTML = _renderCalendarGrid(type);
  _wireCalendarGrid();
}

function _refreshCalendarSelection() {
  // Quando a data muda via input manual, re-render calendar pra refletir seleção
  // Se a data está em mês diferente, ajusta calDate
  if (_state.data.desiredDate) {
    const d = new Date(_state.data.desiredDate + 'T12:00:00');
    if (d.getMonth() !== _state.calDate?.getMonth() || d.getFullYear() !== _state.calDate?.getFullYear()) {
      _state.calDate = d;
    }
  }
  _rerenderCalendar();
}

/* === Passo 3: Detalhes (variação, título, descrição, link) === */
function _renderStep3() {
  const d = _state.data;
  const type = _state.taskTypes.find(x => x.id === d.typeId);
  const variations = type?.variations || [];
  return `
    <div class="portal-card" style="padding:24px;">
      <h2 style="margin:0 0 6px;font-size:1.25rem;color:var(--text-primary);">Detalhes da demanda</h2>
      <p style="margin:0 0 20px;color:var(--text-muted);font-size:0.875rem;">
        Conte o que precisa. Quanto mais detalhe, melhor o time entrega.
      </p>

      ${variations.length ? `
        <div class="form-group">
          <label class="form-label">Variação do material <span class="required">*</span></label>
          <select class="form-select" id="pw-variation">
            <option value="">— Selecione a variação —</option>
            ${variations.map(v => `<option value="${esc(v.id)}" ${d.variationId===v.id?'selected':''}>${esc(v.name)}${(v.slaDays || v.sla)?` · SLA ${(v.slaDays || v.sla)}d`:''}</option>`).join('')}
          </select>
          <div class="form-error" id="pw-err-variation" style="display:none;color:var(--color-danger);font-size:0.75rem;margin-top:4px;">
            Selecione a variação.
          </div>
          <div id="pw-sla-hint" style="margin-top:6px;font-size:0.75rem;color:var(--brand-gold);"></div>
        </div>
      ` : ''}

      <div class="form-group" style="margin-top:16px;">
        <label class="form-label">Título da demanda <span class="required">*</span></label>
        <input type="text" class="form-input" id="pw-title" maxlength="120"
          placeholder="Ex: Newsletter Maio — Programa ICs" value="${esc(d.title)}" />
        <div class="form-error" id="pw-err-title" style="display:none;color:var(--color-danger);font-size:0.75rem;margin-top:4px;">
          Informe um título.
        </div>
      </div>

      <div class="form-group" style="margin-top:16px;">
        <label class="form-label">Descrição <span class="required">*</span></label>
        <textarea class="form-textarea" id="pw-desc" rows="4"
          placeholder="O que precisa? Inclua contexto, referências e objetivos.">${esc(d.description)}</textarea>
        <div class="form-error" id="pw-err-desc" style="display:none;color:var(--color-danger);font-size:0.75rem;margin-top:4px;">
          Descreva sua demanda.
        </div>
      </div>

      <div class="form-group" style="margin-top:16px;">
        <label class="form-label">Link de conteúdo <span style="color:var(--text-muted);font-weight:400;">(opcional)</span></label>
        <input type="url" class="form-input" id="pw-link" placeholder="https://… (Notion, Drive, Figma)" value="${esc(d.contentLink)}" />
      </div>
    </div>
  `;
}

function _wireStep3() {
  const varSel = document.getElementById('pw-variation');
  const titleI = document.getElementById('pw-title');
  const descT  = document.getElementById('pw-desc');
  const linkI  = document.getElementById('pw-link');
  const slaHint = document.getElementById('pw-sla-hint');

  const refreshSla = () => {
    if (!slaHint) return;
    const type = _state.taskTypes.find(t => t.id === _state.data.typeId);
    const v = type?.variations?.find(x => x.id === _state.data.variationId);
    slaHint.textContent = v?.sla ? `⏱ SLA de produção: ${(v.slaDays || v.sla)} dia${(v.slaDays || v.sla)>1?'s':''}` : '';
  };
  refreshSla();

  varSel?.addEventListener('change', () => {
    _state.data.variationId = varSel.value;
    const opt = varSel.options[varSel.selectedIndex];
    _state.data.variationName = opt?.text?.split('·')[0]?.trim() || '';
    refreshSla();
    _checkAutoUrgency();  // v4.54.4+ Re-checa lock pq SLA pode ter mudado
    _persistDraft();
  });
  titleI?.addEventListener('input', () => { _state.data.title = titleI.value.trim(); _persistDraft(); });
  descT?.addEventListener('input', () => { _state.data.description = descT.value.trim(); _persistDraft(); });
  linkI?.addEventListener('input', () => { _state.data.contentLink = linkI.value.trim(); _persistDraft(); });

  // Skip auto: se só 1 variação, pre-seleciona
  if (varSel && varSel.options.length === 2 && !_state.data.variationId) {
    varSel.selectedIndex = 1;
    varSel.dispatchEvent(new Event('change'));
  }
}

function _validateStep3() {
  const d = _state.data;
  const type = _state.taskTypes.find(x => x.id === d.typeId);
  let ok = true;
  if (type?.variations?.length && !d.variationId) {
    const e = document.getElementById('pw-err-variation'); if (e) e.style.display='block'; ok = false;
  } else {
    const e = document.getElementById('pw-err-variation'); if (e) e.style.display='none';
  }
  if (!d.title) { const e=document.getElementById('pw-err-title'); if(e) e.style.display='block'; ok=false; }
  else          { const e=document.getElementById('pw-err-title'); if(e) e.style.display='none'; }
  if (!d.description) { const e=document.getElementById('pw-err-desc'); if(e) e.style.display='block'; ok=false; }
  else                { const e=document.getElementById('pw-err-desc'); if(e) e.style.display='none'; }
  // Valida URL se informada
  if (d.contentLink && !/^https?:\/\//i.test(d.contentLink)) {
    alert('O link de conteúdo deve começar com http:// ou https://');
    ok = false;
  }
  return ok;
}

/* === Passo 4: Sinalizações + Revisão === */
function _renderStep4() {
  const d = _state.data;
  const type = _state.taskTypes.find(x => x.id === d.typeId);
  const variation = type?.variations?.find(v => v.id === d.variationId);
  const urgencyLocked = !!d.urgencyAutoLocked;
  return `
    <div class="portal-card" style="padding:24px;">
      <h2 style="margin:0 0 6px;font-size:1.25rem;color:var(--text-primary);">Última revisão</h2>
      <p style="margin:0 0 20px;color:var(--text-muted);font-size:0.875rem;">
        Confira os dados e adicione sinalizações finais antes de enviar.
      </p>

      <div class="form-group">
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:${urgencyLocked?'not-allowed':'pointer'};padding:12px;
          border:1px solid ${d.urgency?'rgba(239,68,68,0.4)':'var(--border-subtle)'};border-radius:8px;background:var(--bg-surface);
          ${urgencyLocked?'opacity:0.85;':''}">
          <input type="checkbox" id="pw-urgency" ${d.urgency?'checked':''} ${urgencyLocked?'disabled':''} style="margin-top:3px;" />
          <div>
            <div style="font-weight:500;color:var(--text-primary);">🔴 Marcar como urgente ${urgencyLocked?'<span style="color:var(--brand-gold);font-size:0.75rem;font-weight:600;">🔒 automático</span>':''}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
              ${urgencyLocked
                ? esc(d.urgencyLockReason || 'Prazo apertado — urgência definida automaticamente pelo sistema.')
                : 'Só quando há prazo real e inegociável. Urgências injustificadas prejudicam o time.'}
            </div>
          </div>
        </label>
      </div>

      <div class="form-group" style="margin-top:12px;">
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:12px;
          border:1px solid var(--border-subtle);border-radius:8px;background:var(--bg-surface);">
          <input type="checkbox" id="pw-partnership" ${d.isPartnership?'checked':''} style="margin-top:3px;" />
          <div>
            <div style="font-weight:500;color:var(--text-primary);">🤝 Envolve parceria</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
              Devolutiva de pacote de divulgação vendido para empresa parceira.
            </div>
          </div>
        </label>
      </div>

      <div style="margin-top:24px;padding:16px;border:1px solid var(--border-default);border-radius:10px;background:var(--bg-surface);">
        <div style="font-weight:600;font-size:0.875rem;color:var(--text-primary);margin-bottom:12px;">
          📋 Resumo da solicitação
        </div>
        <div style="display:grid;grid-template-columns:120px 1fr;gap:8px 12px;font-size:0.8125rem;">
          ${_summaryRow('Solicitante', `${esc(_state.user?.name||'')} · ${esc(d.requestingArea)}`)}
          ${_summaryRow('Para o setor', esc(d.sector))}
          ${_summaryRow('Tipo', `${esc(d.typeIcon||'◈')} ${esc(d.typeName)}`)}
          ${_summaryRow('Quando', _fmtDate(d.desiredDate))}
          ${d.nucleo ? _summaryRow('Squad', esc(d.nucleo)) : ''}
          ${variation ? _summaryRow('Variação', esc(variation.name) + ((variation.slaDays || variation.sla)?` (SLA ${variation.slaDays || variation.sla}d)`:'')) : ''}
          ${_summaryRow('Título', esc(d.title))}
          ${_summaryRow('Descrição', `<div style="max-height:80px;overflow:auto;white-space:pre-wrap;">${esc(d.description)}</div>`)}
          ${d.contentLink ? _summaryRow('Link', `<a href="${esc(d.contentLink)}" target="_blank" rel="noopener">${esc(d.contentLink)}</a>`) : ''}
          ${d.outOfCalendar ? _summaryRow('Sinaliz.', '<span style="color:var(--brand-gold);">Fora do calendário editorial</span>') : ''}
        </div>
      </div>
    </div>
  `;
}

function _wireStep4() {
  const urg = document.getElementById('pw-urgency');
  const par = document.getElementById('pw-partnership');
  urg?.addEventListener('change', () => {
    // v4.54.4+ Se está auto-locked, ignora toggle manual (defesa em profundidade)
    if (_state.data.urgencyAutoLocked) { urg.checked = true; return; }
    _state.data.urgency = urg.checked;
    _persistDraft();
    // Re-render pra mudar borda visual
    _renderStep(4);
  });
  par?.addEventListener('change', () => {
    _state.data.isPartnership = par.checked;
    _persistDraft();
  });
}

function _summaryRow(label, value) {
  return `
    <div style="color:var(--text-muted);">${esc(label)}:</div>
    <div style="color:var(--text-primary);">${value}</div>
  `;
}

/* Step 4 não tem campos obrigatórios novos — só toggles opcionais + revisão.
 * Como precaução, valida que os steps anteriores ainda estão íntegros (defensive).
 */
function _validateStep4() {
  return _validateStep1() && _validateStep2() && _validateStep3();
}

/* ─── Navegação ─── */
function _tryAdvance() {
  const validators = [null, _validateStep1, _validateStep2, _validateStep3, _validateStep4];
  const fn = validators[_state.step];
  if (!fn || !fn()) return;
  _gotoStep(_state.step + 1);
}

function _gotoStep(n) {
  if (n < 1 || n > 4) return;
  _renderStep(n);
}

/* ─── Submit ─── */
async function _onSubmit(submitAnother) {
  if (_state.submitting) return;
  if (!_validateStep4()) return; // valida toggles + tudo anterior implicitamente

  _state.submitting = true;
  _renderFooter();

  try {
    const d = _state.data;
    const user = _state.user;
    const doc = {
      // Identificação do solicitante
      requestingArea: d.requestingArea,
      requesterName:  user?.name || '',
      requesterEmail: user?.email || '',
      requesterUid:   user?.uid || null,
      // Demanda
      sector:         d.sector,
      typeId:         d.typeId,
      typeName:       d.typeName,
      typeIcon:       d.typeIcon,
      typeColor:      d.typeColor,
      autoAccept:     d.autoAccept,
      variationId:    d.variationId || null,
      variationName:  d.variationName || '',
      nucleo:         d.nucleo || '',
      title:          d.title,
      description:    d.description,
      contentLink:    d.contentLink || '',
      desiredDate:    d.desiredDate,
      urgency:        d.urgency,
      urgencyAutoLocked: d.urgencyAutoLocked || false,
      urgencyLockReason: d.urgencyLockReason || '',
      isPartnership:  d.isPartnership,
      outOfCalendar:  d.outOfCalendar,
      // Sistema
      status:         'pending',
      createdAt:      serverTimestamp(),
      source:         'portal-wizard-v4.54.4',
    };

    const ref = await addDoc(collection(_state.db, 'requests'), doc);

    // Limpa rascunho
    _clearDraft();

    // Notifica time via email (best-effort, não bloqueia o sucesso) — v4.54.4+
    _notifyTeam({ ...doc, id: ref.id }).catch(e => console.warn('[wizard] notifyTeam falhou:', e?.message || e));
    // Notifica admins via in-app notification (Firestore — também best-effort)
    _notifyAdmins(d, ref.id).catch(e => console.warn('[wizard] notify admins falhou:', e?.message || e));

    _state.submitting = false;
    if (submitAnother) {
      _renderSuccessAndRestart();
    } else {
      _renderSuccess();
    }
  } catch (err) {
    console.error('[wizard] submit falhou:', err);
    _state.submitting = false;
    _renderFooter();
    alert('Erro ao enviar: ' + (err?.message || err));
  }
}

async function _notifyAdmins(d, requestId) {
  // Reutiliza notifyTeam do portal.js antigo se disponível, senão best-effort skip
  if (typeof window.__portalNotifyTeam === 'function') {
    return window.__portalNotifyTeam({ ...d, id: requestId });
  }
}

function _renderSuccess() {
  const root = document.querySelector('.pw-root');
  if (!root) return;
  document.getElementById('pw-footer').innerHTML = '';
  root.innerHTML = `
    <div style="text-align:center;padding:60px 20px;">
      <div style="font-size:4rem;color:var(--brand-gold);margin-bottom:16px;">✓</div>
      <h2 style="margin:0 0 8px;color:var(--text-primary);">Solicitação enviada!</h2>
      <p style="color:var(--text-muted);margin:0 0 32px;">
        Recebemos sua solicitação. Nossa equipe vai analisar e responder em breve.
      </p>
      <button class="btn btn-primary" id="pw-new">Fazer nova solicitação</button>
      <button class="btn btn-secondary" id="pw-call-success" style="margin-left:8px;">Voltar ao início</button>
    </div>
  `;
  document.getElementById('pw-new')?.addEventListener('click', () => {
    _state.data = _defaultData(_state.user);
    _state.step = 1;
    _renderShell(document.querySelector('.pw-root').parentElement);
  });
  document.getElementById('pw-call-success')?.addEventListener('click', () => {
    if (_state.onSuccess) _state.onSuccess();
  });
}

function _renderSuccessAndRestart() {
  const root = document.querySelector('.pw-root');
  if (!root) return;
  // Toast rápido + reinicia wizard mantendo setor + tipo
  const prevSector = _state.data.sector;
  const prevTypeId = _state.data.typeId;
  _state.data = _defaultData(_state.user);
  _state.data.sector = prevSector;
  _state.data.typeId = prevTypeId;
  _captureType(prevTypeId);
  _state.step = 2; // pula direto pro passo 2 (Quando) — setor+tipo já têm
  _renderShell(root.parentElement);
  setTimeout(() => {
    const el = document.createElement('div');
    el.textContent = '✓ Enviada! Pronto pra próxima.';
    el.style.cssText = `
      position:fixed;top:24px;left:50%;transform:translateX(-50%);
      background:var(--brand-gold);color:#0A1628;padding:12px 24px;
      border-radius:8px;font-weight:600;z-index:9999;
      box-shadow:0 4px 16px rgba(0,0,0,0.2);
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }, 100);
}

/* ─── Draft (localStorage) ─── */
function _persistDraft() {
  try {
    localStorage.setItem(_state.draftKey, JSON.stringify({
      step: _state.step,
      data: _state.data,
      savedAt: Date.now(),
    }));
  } catch {}
}

function _loadDraft() {
  try {
    const raw = localStorage.getItem(_state.draftKey);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    // Expira em 7 dias
    if (draft.savedAt && Date.now() - draft.savedAt > 7 * 24 * 60 * 60 * 1000) {
      localStorage.removeItem(_state.draftKey);
      return null;
    }
    return draft;
  } catch { return null; }
}

function _clearDraft() {
  try { localStorage.removeItem(_state.draftKey); } catch {}
}

function _hasDraftContent(draft) {
  if (!draft?.data) return false;
  const d = draft.data;
  return !!(d.sector || d.typeId || d.title || d.description);
}

/* ─── Keyboard shortcuts ─── */
function _bindKeyboard() {
  _keyHandler = (e) => {
    if (!_state) return;
    // Ignora se foco está em input/textarea (exceto Esc)
    const tag = (e.target?.tagName || '').toLowerCase();
    const inField = ['input','textarea','select'].includes(tag);

    if (e.key === 'Enter' && !inField) {
      e.preventDefault();
      if (_state.step < 4) _tryAdvance();
      else _onSubmit(false);
    } else if (e.key === 'Enter' && tag === 'input') {
      // Em input simples, Enter também avança (a menos que textarea)
      e.preventDefault();
      if (_state.step < 4) _tryAdvance();
      else _onSubmit(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (_state.step > 1) _gotoStep(_state.step - 1);
    }
  };
  document.addEventListener('keydown', _keyHandler);
}

/* ─── Helpers ─── */
function _typesForSector(sector) {
  if (!sector) return [];
  return (_state.taskTypes || []).filter(t => t.sector === sector || t.requestingSectors?.includes?.(sector));
}

async function _loadSquadsForSector(sector, currentNucleo) {
  if (!sector || !_state.db) return '<option value="">— Sem squad específico —</option>';
  try {
    const q = query(collection(_state.db, 'nucleos'), where('sector', '==', sector), limit(50));
    const snap = await getDocs(q);
    const opts = ['<option value="">— Sem squad específico —</option>'];
    snap.forEach(d => {
      const data = d.data();
      const name = data.name || d.id;
      opts.push(`<option value="${esc(name)}" ${currentNucleo===name?'selected':''}>${esc(name)}</option>`);
    });
    return opts.join('');
  } catch (e) {
    console.warn('[wizard] loadSquads falhou:', e?.message);
    return '<option value="">— Sem squad específico —</option>';
  }
}

function _getMinDate() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function _fmtDate(iso) {
  if (!iso) return '—';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  try { return new Date(iso).toLocaleDateString('pt-BR'); } catch { return iso; }
}

/* v4.54.4+ Conta dias úteis entre duas datas (exclusivo, ignora sáb/dom).
 * Idêntico ao countBusinessDays do portalLegacy. */
function _countBusinessDays(startDate, endDate) {
  let count = 0;
  const cur = new Date(startDate);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

/* v4.54.4+ Lock automático de urgência quando prazo é apertado.
 * Regras:
 *   - Se prazo está a < 24h: força urgência + lock
 *   - Se dias úteis até o prazo < SLA da variação: força urgência + lock
 *   - Senão: desbloqueia (mas mantém escolha manual do user)
 */
function _checkAutoUrgency() {
  if (!_state) return;
  const d = _state.data;
  if (!d.desiredDate) {
    // Reset se ainda não tem data
    if (d.urgencyAutoLocked) {
      d.urgencyAutoLocked = false;
      d.urgencyLockReason = '';
    }
    return;
  }
  const deadline = new Date(d.desiredDate + 'T23:59:59');
  const now = new Date();
  const hoursUntil = (deadline - now) / 3600000;

  // SLA da variação selecionada
  const type = _state.taskTypes.find(t => t.id === d.typeId);
  const variation = type?.variations?.find(v => v.id === d.variationId);
  const slaRaw = variation?.slaDays || variation?.sla;
  const slaDays = slaRaw ? parseInt(slaRaw, 10) : NaN;
  const bizDays = _countBusinessDays(now, deadline);

  let shouldLock = false;
  let reason = '';
  if (hoursUntil <= 24) {
    shouldLock = true;
    reason = 'Prazo inferior a 24h. Urgência definida automaticamente.';
  } else if (!isNaN(slaDays) && bizDays < slaDays) {
    shouldLock = true;
    reason = `Prazo (${bizDays} dia${bizDays!==1?'s':''} útil) inferior ao SLA da variação (${slaDays} dia${slaDays!==1?'s':''}). Urgência definida automaticamente.`;
  }

  if (shouldLock) {
    d.urgency = true;
    d.urgencyAutoLocked = true;
    d.urgencyLockReason = reason;
  } else if (d.urgencyAutoLocked) {
    // Estava locked, agora não precisa mais — desbloqueia mas mantém urgency
    // como false (user pode marcar manualmente se quiser).
    d.urgencyAutoLocked = false;
    d.urgencyLockReason = '';
    d.urgency = false;
  }
}

/* v4.54.4+ Notifica o time via Cloud Function de email após envio bem-sucedido.
 * Best-effort: não bloqueia o fluxo de sucesso se falhar. */
async function _notifyTeam(reqDoc) {
  try {
    const { APP_CONFIG } = await import('../config.js');
    const url = APP_CONFIG?.functions?.sendEmailUrl;
    if (!url) {
      console.warn('[wizard] sendEmailUrl não configurada — skip notifyTeam');
      return;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'new_request',
        to: null,
        data: {
          requesterName:  reqDoc.requesterName,
          requesterEmail: reqDoc.requesterEmail,
          requestingArea: reqDoc.requestingArea || '',
          sector:         reqDoc.sector         || '',
          typeName:       reqDoc.typeName        || '',
          variationName:  reqDoc.variationName   || '',
          description:    reqDoc.description     || '',
          urgency:        reqDoc.urgency         || false,
          outOfCalendar:  reqDoc.outOfCalendar   || false,
          desiredDate:    reqDoc.desiredDate
            ? _fmtDate(reqDoc.desiredDate) : '',
        },
      }),
    });
    if (!res.ok) console.warn('[wizard] notifyTeam HTTP', res.status, await res.text().catch(() => ''));
  } catch (e) {
    console.warn('[wizard] notifyTeam error:', e?.message || e);
  }
}
