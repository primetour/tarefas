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

/* === Passo 2: Quando (data + squad + fora-do-cal) === */
function _renderStep2() {
  const d = _state.data;
  const type = _state.taskTypes.find(x => x.id === d.typeId);
  const hasSlots = !!type?.scheduleSlots?.length;
  const minDate = _getMinDate();
  return `
    <div class="portal-card" style="padding:24px;">
      <h2 style="margin:0 0 6px;font-size:1.25rem;color:var(--text-primary);">Quando você precisa?</h2>
      <p style="margin:0 0 20px;color:var(--text-muted);font-size:0.875rem;">
        ${hasSlots ? 'Escolha uma data ou clique num slot pré-agendado abaixo.' : 'Defina a data desejada de entrega.'}
      </p>

      <div class="form-group">
        <label class="form-label">Data desejada de entrega <span class="required">*</span></label>
        <input type="date" class="form-input" id="pw-date" min="${minDate}" value="${esc(d.desiredDate)}" />
        <div class="form-error" id="pw-err-date" style="display:none;color:var(--color-danger);font-size:0.75rem;margin-top:4px;">
          A data não pode ser anterior a hoje.
        </div>
      </div>

      ${hasSlots ? `
        <div class="form-group" style="margin-top:16px;">
          <label class="form-label" style="font-size:0.8125rem;color:var(--text-muted);">Slots pré-agendados (opcional)</label>
          <div id="pw-slots" style="
            display:grid;grid-template-columns:repeat(auto-fill, minmax(140px, 1fr));
            gap:8px;margin-top:6px;">
            ${_renderSlotChips(type)}
          </div>
        </div>
      ` : ''}

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
    _persistDraft();
  });
  oocCb?.addEventListener('change', () => {
    _state.data.outOfCalendar = oocCb.checked;
    _persistDraft();
  });
  nucleoSel?.addEventListener('change', () => {
    _state.data.nucleo = nucleoSel.value;
    _persistDraft();
  });

  // Slots: clique pré-preenche data + variação
  document.querySelectorAll('.pw-slot-chip')?.forEach(chip => {
    chip.addEventListener('click', () => {
      const date = chip.dataset.date;
      const variationId = chip.dataset.variationId;
      _state.data.desiredDate = date;
      _state.data.variationId = variationId;
      const type = _state.taskTypes.find(t => t.id === _state.data.typeId);
      const variation = type?.variations?.find(v => v.id === variationId);
      _state.data.variationName = variation?.name || '';
      if (dateInput) dateInput.value = date;
      document.querySelectorAll('.pw-slot-chip').forEach(c => c.style.background = 'var(--bg-surface)');
      chip.style.background = 'rgba(212,168,67,0.2)';
      _persistDraft();
    });
  });

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
            ${variations.map(v => `<option value="${esc(v.id)}" ${d.variationId===v.id?'selected':''}>${esc(v.name)}${v.sla?` · SLA ${v.sla}d`:''}</option>`).join('')}
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
    slaHint.textContent = v?.sla ? `⏱ SLA de produção: ${v.sla} dia${v.sla>1?'s':''}` : '';
  };
  refreshSla();

  varSel?.addEventListener('change', () => {
    _state.data.variationId = varSel.value;
    const opt = varSel.options[varSel.selectedIndex];
    _state.data.variationName = opt?.text?.split('·')[0]?.trim() || '';
    refreshSla();
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
  return `
    <div class="portal-card" style="padding:24px;">
      <h2 style="margin:0 0 6px;font-size:1.25rem;color:var(--text-primary);">Última revisão</h2>
      <p style="margin:0 0 20px;color:var(--text-muted);font-size:0.875rem;">
        Confira os dados e adicione sinalizações finais antes de enviar.
      </p>

      <div class="form-group">
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:12px;
          border:1px solid ${d.urgency?'rgba(239,68,68,0.4)':'var(--border-subtle)'};border-radius:8px;background:var(--bg-surface);">
          <input type="checkbox" id="pw-urgency" ${d.urgency?'checked':''} style="margin-top:3px;" />
          <div>
            <div style="font-weight:500;color:var(--text-primary);">🔴 Marcar como urgente</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
              Só quando há prazo real e inegociável. Urgências injustificadas prejudicam o time.
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
          ${variation ? _summaryRow('Variação', esc(variation.name) + (variation.sla?` (SLA ${variation.sla}d)`:'')) : ''}
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
      isPartnership:  d.isPartnership,
      outOfCalendar:  d.outOfCalendar,
      // Sistema
      status:         'pending',
      createdAt:      serverTimestamp(),
      source:         'portal-wizard-v4.54.0',
    };

    const ref = await addDoc(collection(_state.db, 'requests'), doc);

    // Limpa rascunho
    _clearDraft();

    // Notifica admins do setor responsável (best-effort, não bloqueia)
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
