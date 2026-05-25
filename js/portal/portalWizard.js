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
 *   Passo 2 — Quando (calendário/data; squad removido em v4.57.8)
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
  collection, addDoc, getDocs, doc as firestoreDoc, updateDoc, query, where, limit, orderBy, serverTimestamp,
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
    // v4.55.3+ Edit mode: quando user clica numa solicitação enviada pra editar
    editMode: false,
    editId: null,
    recentRequests: [],   // populated async
    // v4.55.5+ Batch / envio em lote: user enfileira N solicitações e submete tudo junto
    batchQueue: [],
  };

  // v4.57.3+ NÃO auto-restora silenciosamente — em vez disso, sempre começa no
  // Step 1 e o banner "Você tem um rascunho em andamento" oferece a escolha de
  // continuar ou descartar. Mais explícito (Renê: "vai encontrar essa solicitacao
  // onde? vai ter uma pendencia no portal pra ela seguir?"). O draft fica intacto
  // em localStorage e é lido por _renderDraftResumeBanner.
  _state.step = 1;

  _renderShell(container);
  _bindKeyboard();

  // v4.55.3+ Carrega solicitações recentes do user pra permitir edição inline
  _loadRecentRequests().then(() => {
    // Re-render se ainda estamos no Step 1 e popula banner
    if (_state.step === 1) _renderStep(1);
  }).catch(e => console.warn('[wizard] loadRecentRequests falhou:', e?.message));
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
  // v4.55.6+ Pill discreto mostrando contador do lote em TODOS os steps
  // (badge completo só fica no Step 1, mas user precisa lembrar a qualquer momento)
  const batchCount = _state?.batchQueue?.length || 0;
  const batchPill = batchCount > 0 ? `
    <div style="display:flex;align-items:center;gap:6px;padding:4px 10px;
      background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.4);
      border-radius:14px;font-size:0.6875rem;color:#16A34A;font-weight:600;
      width:fit-content;">
      📦 Lote pendente: ${batchCount}
    </div>` : '';

  // v4.57.3+ Indicador de auto-save (substitui botão "Salvar e sair") —
  // mostra reassurance que o sistema salva sozinho. Discreto, lado direito.
  const autoSavePill = `
    <div style="display:flex;align-items:center;gap:5px;padding:4px 10px;
      background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.25);
      border-radius:14px;font-size:0.6875rem;color:#16A34A;font-weight:500;
      width:fit-content;" title="O sistema salva automaticamente a cada campo preenchido. Você pode fechar o navegador e voltar depois sem perder nada.">
      💾 Salvo automaticamente
    </div>
  `;

  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;
      gap:10px;margin-bottom:10px;flex-wrap:wrap;">
      <div>${batchPill}</div>
      <div>${autoSavePill}</div>
    </div>
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
  // v4.57.3+ Removido "Salvar e sair" — sistema já tem auto-save a cada campo
  // (debounce no _persistDraft). Banner "Rascunho em andamento" no Step 1 cuida
  // de retomar quando o user volta. Footer agora só tem Voltar + Próximo/Enviar.
  el.innerHTML = `
    <div style="max-width:680px;margin:0 auto;display:flex;gap:10px;align-items:center;justify-content:flex-end;">
      ${isFirst ? '' : `
        <button type="button" class="btn btn-secondary" id="pw-back" ${submitting?'disabled':''}>
          ← Voltar
        </button>
      `}
      ${isLast ? `
        ${_state.editMode ? '' : `
          <button type="button" class="btn btn-secondary" id="pw-add-batch" ${submitting?'disabled':''}
            title="Salva esta solicitação na fila e abre o wizard pra próxima. Você envia tudo de uma vez no fim.">
            + Adicionar outra ao lote
          </button>
        `}
        <button type="button" class="btn btn-primary" id="pw-submit" ${submitting?'disabled':''}>
          ${submitting ? '⏳ Salvando…'
            : _state.editMode ? '✏️ Salvar alterações →'
            : _state.batchQueue.length > 0
              ? `Enviar lote (${_state.batchQueue.length + 1} solicitações) →`
              : 'Enviar solicitação →'}
        </button>
      ` : `
        <button type="button" class="btn btn-primary" id="pw-next">
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
  document.getElementById('pw-add-batch')?.addEventListener('click', () => _addToBatch());
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
  const editing = _state.editMode;
  return `
    ${editing ? `
      <div class="portal-card" style="padding:14px 18px;margin-bottom:14px;
        background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.4);">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
          <div style="font-size:0.875rem;color:var(--text-primary);">
            ✏️ <strong>Editando solicitação</strong> já enviada — alterações serão sinalizadas no sistema da equipe.
          </div>
          <button type="button" id="pw-cancel-edit" class="btn btn-secondary btn-sm">
            Cancelar edição
          </button>
        </div>
      </div>
    ` : ''}
    ${_renderBatchBadge()}
    ${editing ? '' : _renderDraftResumeBanner()}
    ${editing ? '' : _renderRecentRequestsBanner()}

    <div class="portal-card" style="padding:24px;">
      <h2 style="margin:0 0 6px;font-size:1.25rem;color:var(--text-primary);">Pra quem é a demanda?</h2>
      <p style="margin:0 0 20px;color:var(--text-muted);font-size:0.875rem;">
        Quem vai receber esta solicitação? E qual é o tipo?
      </p>

      <div class="form-group">
        <label class="form-label">Setor responsável <span class="required">*</span>
          <span title="Setor que vai RECEBER esta demanda. Pode ser diferente do seu setor caso esteja solicitando em nome de outro." style="cursor:help;color:var(--text-muted);font-size:0.75rem;margin-left:4px;">ℹ</span>
        </label>
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
  // v4.55.3+ Cancelar edit mode + Editar request existente
  document.getElementById('pw-cancel-edit')?.addEventListener('click', () => {
    _exitEditMode();
  });
  document.querySelectorAll('.pw-recent-req-card')?.forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.reqId;
      const req = _state.recentRequests.find(r => r.id === id);
      if (req) _enterEditMode(req);
    });
  });
  // v4.55.5+ Remover item do lote pendente
  document.querySelectorAll('.pw-remove-batch')?.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.batchIdx, 10);
      if (Number.isInteger(idx) && idx >= 0 && idx < _state.batchQueue.length) {
        _state.batchQueue.splice(idx, 1);
        _renderShell(document.querySelector('.pw-root')?.parentElement);
      }
    });
  });
  // v4.57.3+ Continuar/Descartar rascunho
  document.getElementById('pw-draft-resume')?.addEventListener('click', () => {
    const draft = _loadDraft();
    if (draft?.data) {
      _state.data = { ..._defaultData(_state.user), ...draft.data };
      _state.step = draft.step || 1;
      _renderShell(document.querySelector('.pw-root')?.parentElement);
    }
  });
  document.getElementById('pw-draft-discard')?.addEventListener('click', () => {
    _clearDraft();
    _state.data = _defaultData(_state.user);
    _state.step = 1;
    _renderShell(document.querySelector('.pw-root')?.parentElement);
  });

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
  // v4.56.1+ Sanitiza cor hex pra evitar style injection (paridade legacy)
  const raw = t?.color || '';
  _state.data.typeColor = /^#[0-9A-Fa-f]{3,8}$/.test(raw) ? raw : '#D4A843';
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

      <!-- v4.57.8: campo "Squad responsável (opcional)" removido. Solicitante
           externo não conhece fluxo interno do setor — coordenadores finalizam
           o assignment depois, no app principal. Compat: _state.data.nucleo
           segue no state como '' (não quebra _buildRequestDoc nem edit de
           requests antigas que tinham squad). -->

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
        <!-- v4.56.0+ Banner educativo OOC (longo, paridade legacy) -->
        ${d.outOfCalendar ? `
          <div style="margin-top:8px;padding:10px 14px;border-radius:6px;
            background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.35);
            font-size:0.75rem;color:var(--text-primary);line-height:1.5;display:flex;gap:8px;">
            <span style="font-size:1rem;flex-shrink:0;">⚠</span>
            <span>
              <strong>Atenção: impacto de operar fora do calendário editorial</strong><br/>
              Demandas fora do calendário prejudicam o planejamento da equipe e podem comprometer
              a <strong>performance de entrega</strong>, <strong>taxa de cliques</strong> e
              <strong>saúde do servidor de disparo</strong> da PRIMETOUR — especialmente para
              newsletters. Envios não planejados aumentam o risco de marcação como spam e reduzem
              o engajamento da base. Use apenas quando estritamente necessário.
            </span>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function _wireStep2() {
  const dateInput = document.getElementById('pw-date');
  const oocCb     = document.getElementById('pw-ooc');

  dateInput?.addEventListener('change', () => {
    // v4.56.1+ Bloqueio data passada com alert nativo (paridade legacy)
    const val = dateInput.value;
    if (val && val < _getMinDate()) {
      alert('⛔ Data passada — escolha uma data a partir de hoje.');
      dateInput.value = _state.data.desiredDate || '';
      return;
    }
    _state.data.desiredDate = val;
    _checkAutoUrgency();
    _persistDraft();
    _refreshCalendarSelection();
  });
  oocCb?.addEventListener('change', () => {
    _state.data.outOfCalendar = oocCb.checked;
    _persistDraft();
  });

  // v4.54.6+ Calendário visual — handlers
  _wireCalendarGrid();

  // v4.57.8: _loadSquadsForSector removido — coordenador atribui squad no app principal.
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
  const gran = _state.calGran || 'month'; // v4.57.0+ month | week | day
  const y = cal.getFullYear();
  const m = cal.getMonth();
  const today = new Date(); today.setHours(0,0,0,0);
  const selected = _state.data.desiredDate || '';

  // v4.57.0+ Determina dias a renderizar conforme granularidade
  let firstDow, daysInMonth, daysToShow;
  if (gran === 'day') {
    firstDow = cal.getDay();
    daysToShow = 1;
    daysInMonth = cal.getDate();
  } else if (gran === 'week') {
    const weekStart = new Date(cal);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    firstDow = weekStart.getDay(); // 0
    daysToShow = 7;
    daysInMonth = weekStart.getDate();
  } else {
    firstDow = new Date(y, m, 1).getDay();
    daysInMonth = new Date(y, m+1, 0).getDate();
    daysToShow = daysInMonth;
  }

  let cells = '';
  // Placeholders só no view de mês
  if (gran === 'month') {
    for (let i = 0; i < firstDow; i++) cells += '<div></div>';
  }

  // Gera array de datas a iterar
  const dates = [];
  if (gran === 'day') {
    dates.push(new Date(y, m, cal.getDate()));
  } else if (gran === 'week') {
    const ws = new Date(cal); ws.setDate(ws.getDate() - ws.getDay());
    for (let i = 0; i < 7; i++) {
      const d = new Date(ws); d.setDate(ws.getDate() + i);
      dates.push(d);
    }
  } else {
    for (let d = 1; d <= daysInMonth; d++) {
      dates.push(new Date(y, m, d));
    }
  }

  for (const date of dates) {
    const d = date.getDate();
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
    const extraSlots = slots.length > 1 ? slots.length - 1 : 0;
    // v4.56.0+ Slot fill detection — prioriza: request do user > batch local > vazio
    const existingReq = (_state.recentRequests || []).find(r => r.desiredDate === iso);
    const batchItem   = (_state.batchQueue || []).find(b => b.desiredDate === iso);
    const filled = !!existingReq || !!batchItem;

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

    // v4.56.0+ Render rico: prefix com ◌ (vazio) ou ✓ (preenchido) e cor de status pra requests
    let displayText = hasSlots ? slotTitle : '';
    let displayColor = hasSlots ? slotColor : '';
    let cellExtraBg = bg;
    let cellExtraBorder = border;
    let cellTitle = hasSlots ? esc(slotTitle) + (isPast?' (passado)':'') : (isPast?'Data passada':'Fora do calendário editorial');
    if (existingReq) {
      const st = existingReq.status || 'pending';
      const statusColor = ({ pending:'#F59E0B', converted:'#16A34A', rejected:'#EF4444', em_andamento:'#0EA5E9' })[st] || '#6B7280';
      displayText = `✓ ${existingReq.title || existingReq.typeName || 'Sua solicitação'}`;
      displayColor = statusColor;
      cellExtraBorder = `2px solid ${statusColor}`;
      cellExtraBg = `${statusColor}15`;
      cellTitle = `Sua solicitação: ${existingReq.title || existingReq.typeName || ''} (${_statusLabel(st)}). Clique pra ver.`;
    } else if (batchItem) {
      displayText = `✦ No seu lote`;
      displayColor = '#16A34A';
      cellExtraBorder = '1px dashed #16A34A';
      cellExtraBg = 'rgba(34,197,94,0.10)';
      cellTitle = `${batchItem.title || '(sem título)'} — pendente no lote local`;
    } else if (hasSlots) {
      displayText = `◌ ${slotTitle}`;
    }
    // Tooltip rico — adiciona contexto extra do tipo + área se houver slot
    if (hasSlots && !existingReq && !batchItem) {
      cellTitle = `Slot: ${esc(slots.map(s=>s.title||'').join(' · '))} | ${esc(type?.name||'')}${isPast?' (passado)':''}`;
    }
    cells += `
      <div class="pw-cal-day" data-date="${iso}" data-has-slot="${hasSlots?'1':'0'}" data-slot-id="${esc(slotId)}"
        data-filled="${filled?'1':'0'}" data-req-id="${esc(existingReq?.id||'')}"
        ${isPast?'data-disabled="1"':''}
        title="${cellTitle}"
        style="
          background:${cellExtraBg};border:${cellExtraBorder};border-radius:6px;
          padding:6px 4px;cursor:${cursor};opacity:${opacity};
          min-height:54px;min-width:0;display:flex;flex-direction:column;
          overflow:hidden;box-sizing:border-box;
          font-size:0.75rem;line-height:1.2;transition:all 0.12s;
          ${isPast?'':'user-select:none;'}">
        <div style="font-weight:${isToday?'700':'500'};color:${isToday?'var(--brand-gold)':'var(--text-primary)'};min-width:0;">
          ${d}
        </div>
        ${displayText ? `
          <div style="font-size:0.625rem;color:${displayColor};font-weight:600;margin-top:auto;line-height:1.1;
            overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;max-width:100%;" title="${esc(slots.map(s=>s.title||'Slot').join(' · '))}">
            ${esc(displayText)}${extraSlots && !existingReq && !batchItem ? ` <span style="background:${slotColor};color:#fff;padding:0 4px;border-radius:8px;font-size:0.5625rem;margin-left:2px;">+${extraSlots}</span>` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  return `
    <div style="border:1px solid var(--border-subtle);border-radius:10px;padding:12px;background:var(--bg-surface);">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;gap:8px;flex-wrap:wrap;">
        <button type="button" id="pw-cal-prev" aria-label="Anterior" class="btn btn-secondary btn-icon btn-sm">‹</button>
        <div style="display:flex;align-items:center;gap:10px;flex:1;justify-content:center;min-width:0;">
          <div style="font-weight:600;font-size:0.9375rem;color:var(--text-primary);white-space:nowrap;">
            ${gran === 'day' ? `${cal.getDate()} ${PT_MONTHS[m]} ${y}`
              : gran === 'week' ? (() => { const ws=new Date(cal); ws.setDate(ws.getDate()-ws.getDay()); const we=new Date(ws); we.setDate(ws.getDate()+6); return `${ws.getDate()}–${we.getDate()} ${PT_MONTHS[we.getMonth()]} ${we.getFullYear()}`; })()
              : `${PT_MONTHS[m]} ${y}`}
          </div>
          <button type="button" id="pw-cal-today" class="btn btn-secondary btn-sm" title="Voltar pra hoje">Hoje</button>
        </div>
        <!-- v4.57.0+ Granularity switcher (v4.57.6: usa .btn-segment do sistema) -->
        <div class="btn-segment">
          ${[['month','Mês'],['week','Semana'],['day','Dia']].map(([g,l]) => `
            <button type="button" class="btn btn-sm pw-gran-btn ${gran===g?'active':''}" data-gran="${g}">${l}</button>
          `).join('')}
        </div>
        <button type="button" id="pw-cal-next" aria-label="Próximo" class="btn btn-secondary btn-icon btn-sm">›</button>
      </div>
      ${gran !== 'day' ? `
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px;">
          ${PT_DAYS_S.map(d => `<div style="text-align:center;font-size:0.6875rem;color:var(--text-muted);font-weight:600;">${d}</div>`).join('')}
        </div>
      ` : ''}
      <div style="display:grid;grid-template-columns:repeat(${gran==='day'?1:7},1fr);gap:4px;">
        ${cells}
      </div>
      <div style="margin-top:10px;display:flex;gap:14px;font-size:0.6875rem;color:var(--text-muted);flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="width:12px;height:12px;border-radius:3px;background:rgba(212,168,67,0.25);border:2px solid var(--brand-gold);display:inline-block;"></span>
          Selecionado
        </div>
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="width:12px;height:12px;border-radius:3px;background:#44d54122;border:1px solid #44d541;display:inline-block;"></span>
          ◌ Slot vazio
        </div>
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="width:12px;height:12px;border-radius:3px;background:#F59E0B15;border:2px solid #F59E0B;display:inline-block;"></span>
          ✓ Sua solicitação
        </div>
        <div style="display:flex;align-items:center;gap:5px;">
          <span style="width:12px;height:12px;border-radius:3px;background:rgba(34,197,94,0.10);border:1px dashed #16A34A;display:inline-block;"></span>
          ✦ No lote
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
  const today = document.getElementById('pw-cal-today');
  // v4.57.0+ Nav prev/next respeita granularidade ativa
  const navStep = (dir) => {
    const gran = _state.calGran || 'month';
    const d = new Date(_state.calDate);
    if (gran === 'day')      d.setDate(d.getDate() + dir);
    else if (gran === 'week') d.setDate(d.getDate() + (dir * 7));
    else                      d.setMonth(d.getMonth() + dir);
    _state.calDate = d;
    _rerenderCalendar();
  };
  prev?.addEventListener('click', () => navStep(-1));
  next?.addEventListener('click', () => navStep(1));
  today?.addEventListener('click', () => {
    _state.calDate = new Date();
    _rerenderCalendar();
  });
  // v4.57.0+ Trocar granularidade
  document.querySelectorAll('.pw-gran-btn')?.forEach(btn => {
    btn.addEventListener('click', () => {
      _state.calGran = btn.dataset.gran;
      _rerenderCalendar();
    });
  });

  document.querySelectorAll('.pw-cal-day')?.forEach(cell => {
    cell.addEventListener('click', () => {
      // v4.56.0+ Bloqueio past com alert (paridade legacy)
      if (cell.dataset.disabled === '1') {
        alert('⛔ Data passada — escolha uma data a partir de hoje.');
        return;
      }
      const iso = cell.dataset.date;
      const hasSlot = cell.dataset.hasSlot === '1';
      const slotId = cell.dataset.slotId;
      const reqId  = cell.dataset.reqId;
      const isFilled = cell.dataset.filled === '1';
      const type = _state.taskTypes.find(t => t.id === _state.data.typeId);

      // v4.56.0+ Click em request existente do user → abrir preview/edit
      if (reqId) {
        const req = _state.recentRequests.find(r => r.id === reqId);
        if (req) {
          _openRequestPreview(req);
          return;
        }
      }

      _state.data.desiredDate = iso;
      const dateInput = document.getElementById('pw-date');
      if (dateInput) dateInput.value = iso;

      if (hasSlot) {
        // Dentro do calendário editorial: desmarca OOC + pre-fill RICO (v4.56.0+)
        _state.data.outOfCalendar = false;
        const slot = (type?.scheduleSlots || []).find(s => s.id === slotId);
        if (slot) {
          // Pre-fill rico (paridade legacy fillFormFromSlot)
          if (slot.requestingArea) _state.data.requestingArea = slot.requestingArea;
          if (slot.title && !_state.data.title) _state.data.title = slot.title;
          // Match variação por slot.variationId ou por título
          if (slot.variationId && type?.variations) {
            const v = type.variations.find(x => x.id === slot.variationId);
            if (v) { _state.data.variationId = v.id; _state.data.variationName = v.name; }
          }
        }
      } else {
        // Dia vazio: força fora do calendário + banner explicativo
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

/* v4.56.0+ Preview modal pra uma request já enviada do user. Versão simplificada:
 * mostra metadata + status + descrição + botão "Editar" que entra em edit mode. */
function _openRequestPreview(req) {
  const status = req.status || 'pending';
  const STATUS_MAP = {
    pending:      { label: 'Pendente',     color: '#F59E0B' },
    converted:    { label: 'Convertida',   color: '#16A34A' },
    rejected:     { label: 'Rejeitada',    color: '#EF4444' },
    em_andamento: { label: 'Em andamento', color: '#0EA5E9' },
    done:         { label: 'Concluída',    color: '#22C55E' },
    archived:     { label: 'Arquivada',    color: '#6B7280' },
  };
  const st = STATUS_MAP[status] || { label: status, color: '#6B7280' };
  const canEdit = ['pending', 'converted'].includes(status);

  // Remove se já existe
  document.getElementById('pw-preview-modal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'pw-preview-modal';
  modal.style.cssText = `
    position:fixed;inset:0;z-index:10000;background:rgba(10,22,40,0.55);
    display:flex;align-items:center;justify-content:center;padding:24px;
    backdrop-filter:blur(2px);font-family:var(--font-ui);
  `;
  modal.innerHTML = `
    <div style="background:var(--bg-card);border-radius:14px;padding:24px;max-width:520px;width:100%;
      box-shadow:0 12px 40px rgba(0,0,0,0.35);max-height:85vh;overflow-y:auto;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:12px;
            background:${st.color}22;color:${st.color};font-size:0.75rem;font-weight:600;">
            ${esc(st.label)}
          </span>
          ${req.urgency ? '<span style="font-size:0.75rem;color:#EF4444;font-weight:600;">🔴 Urgente</span>' : ''}
          ${req.outOfCalendar ? '<span style="font-size:0.75rem;color:#F59E0B;font-weight:600;">⚠ Fora do calendário</span>' : ''}
        </div>
        <button type="button" id="pw-preview-close" aria-label="Fechar"
          style="background:transparent;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-muted);line-height:1;">×</button>
      </div>
      <h3 style="margin:0 0 12px;font-size:1.0625rem;color:var(--text-primary);line-height:1.3;">
        ${esc(req.title || req.typeName || 'Sem título')}
      </h3>
      <div style="display:grid;grid-template-columns:100px 1fr;gap:6px 12px;font-size:0.8125rem;margin-bottom:14px;">
        <div style="color:var(--text-muted);">Data:</div>
        <div>${esc(_fmtDate(req.desiredDate))}</div>
        <div style="color:var(--text-muted);">Tipo:</div>
        <div>${esc(req.typeIcon||'')} ${esc(req.typeName||'?')}</div>
        ${req.variationName ? `<div style="color:var(--text-muted);">Variação:</div><div>${esc(req.variationName)}</div>` : ''}
        <div style="color:var(--text-muted);">Setor:</div>
        <div>${esc(req.sector||'?')}</div>
        ${req.nucleo ? `<div style="color:var(--text-muted);">Squad:</div><div>${esc(req.nucleo)}</div>` : ''}
      </div>
      ${req.description ? `
        <div style="margin-bottom:14px;">
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:4px;">Descrição</div>
          <div style="background:var(--bg-surface);padding:10px 12px;border-radius:6px;font-size:0.8125rem;
            max-height:140px;overflow-y:auto;white-space:pre-wrap;line-height:1.45;">
            ${esc((req.description || '').slice(0, 600))}${req.description?.length > 600 ? '…' : ''}
          </div>
        </div>` : ''}
      ${req.contentLink ? `
        <div style="margin-bottom:14px;font-size:0.8125rem;">
          <span style="color:var(--text-muted);">Link:</span>
          <a href="${esc(req.contentLink)}" target="_blank" rel="noopener" style="color:var(--brand-gold);word-break:break-all;">
            ${esc(req.contentLink)}
          </a>
        </div>` : ''}
      <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:18px;">
        ${canEdit ? `<button type="button" id="pw-preview-edit" class="btn btn-primary btn-sm">✏ Editar solicitação</button>` : ''}
        <button type="button" id="pw-preview-close-btn" class="btn btn-secondary btn-sm">Fechar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.getElementById('pw-preview-close')?.addEventListener('click', close);
  document.getElementById('pw-preview-close-btn')?.addEventListener('click', close);
  document.getElementById('pw-preview-edit')?.addEventListener('click', () => {
    close();
    _enterEditMode(req);
  });
  const esc2 = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); } };
  document.addEventListener('keydown', esc2);
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
        <label class="form-label">Link de conteúdo <span style="color:var(--text-muted);font-weight:400;">(opcional)</span>
          <span title="URL de referência: Notion, Google Drive, Figma, brief etc. Ajuda o time a entender o contexto sem reuniões adicionais." style="cursor:help;color:var(--text-muted);font-size:0.75rem;margin-left:4px;">ℹ</span>
        </label>
        <input type="url" class="form-input" id="pw-link" placeholder="https://… (Notion, Drive, Figma)" value="${esc(d.contentLink)}" />
        <div class="form-error" id="pw-err-link" style="display:none;color:var(--color-danger);font-size:0.75rem;margin-top:4px;">
          Informe uma URL válida (começando com http:// ou https://).
        </div>
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
    const slaVal = v?.slaDays || v?.sla;
    slaHint.textContent = slaVal ? `⏱ SLA de produção: ${slaVal} dia${slaVal>1?'s':''}` : '';
  };
  refreshSla();

  varSel?.addEventListener('change', () => {
    _state.data.variationId = varSel.value;
    const opt = varSel.options[varSel.selectedIndex];
    _state.data.variationName = opt?.text?.split('·')[0]?.trim() || '';
    refreshSla();
    // v4.56.0+ Auto-fill due date pelo SLA da variação (se ainda não tem data) — paridade legacy
    if (!_state.data.desiredDate) {
      const type = _state.taskTypes.find(t => t.id === _state.data.typeId);
      const v = type?.variations?.find(x => x.id === varSel.value);
      const slaDays = parseInt(v?.slaDays || v?.sla, 10);
      if (Number.isFinite(slaDays) && slaDays > 0) {
        const d = new Date();
        let biz = slaDays;
        while (biz > 0) {
          d.setDate(d.getDate() + 1);
          if (d.getDay() !== 0 && d.getDay() !== 6) biz--;
        }
        _state.data.desiredDate = _toISODate(d);
      }
    }
    _checkAutoUrgency();
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
  // v4.56.1+ Valida URL se informada (inline, sem alert)
  const errLink = document.getElementById('pw-err-link');
  if (d.contentLink && !/^https?:\/\//i.test(d.contentLink)) {
    if (errLink) errLink.style.display = 'block';
    ok = false;
  } else if (errLink) {
    errLink.style.display = 'none';
  }
  return ok;
}

/* === Passo 4: Sinalizações + Revisão === */
function _renderStep4() {
  const d = _state.data;
  const type = _state.taskTypes.find(x => x.id === d.typeId);
  const variation = type?.variations?.find(v => v.id === d.variationId);
  const urgencyLocked = !!d.urgencyAutoLocked;
  // v4.56.0+ Urgência monotônica: se em edit mode + request original era urgent → lock
  const origReq = _state.editMode ? _state.recentRequests.find(r => r.id === _state.editId) : null;
  const editLockedUrg = !!(origReq?.urgency);
  // Garante state consistente (não pode unset se locked)
  if (editLockedUrg && !d.urgency) d.urgency = true;
  return `
    <div class="portal-card" style="padding:24px;">
      <h2 style="margin:0 0 6px;font-size:1.25rem;color:var(--text-primary);">Última revisão</h2>
      <p style="margin:0 0 20px;color:var(--text-muted);font-size:0.875rem;">
        Confira os dados e adicione sinalizações finais antes de enviar.
      </p>

      <div class="form-group">
        <label style="display:flex;align-items:flex-start;gap:10px;cursor:${urgencyLocked||editLockedUrg?'not-allowed':'pointer'};padding:12px;
          border:1px solid ${d.urgency?'rgba(239,68,68,0.4)':'var(--border-subtle)'};border-radius:8px;background:var(--bg-surface);
          ${urgencyLocked||editLockedUrg?'opacity:0.85;':''}">
          <input type="checkbox" id="pw-urgency" ${d.urgency?'checked':''} ${urgencyLocked||editLockedUrg?'disabled':''} style="margin-top:3px;" />
          <div>
            <div style="font-weight:500;color:var(--text-primary);">🔴 Marcar como urgente ${urgencyLocked||editLockedUrg?'<span style="color:var(--brand-gold);font-size:0.75rem;font-weight:600;">🔒 automático</span>':''}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
              ${editLockedUrg
                ? '🔒 Esta solicitação já foi marcada como urgente e não pode ser desmarcada — o time já planejou em torno disso.'
                : urgencyLocked
                  ? esc(d.urgencyLockReason || 'Prazo apertado — urgência definida automaticamente pelo sistema.')
                  : 'Só quando há prazo real e inegociável. Urgências injustificadas prejudicam o time.'}
            </div>
          </div>
        </label>
        <!-- v4.56.0+ Banner educativo URGENCY (longo, paridade legacy) -->
        ${d.urgency ? `
          <div style="margin-top:8px;padding:10px 14px;border-radius:6px;
            background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.3);
            font-size:0.75rem;color:var(--text-primary);line-height:1.5;display:flex;gap:8px;">
            <span style="font-size:1rem;flex-shrink:0;">⚠</span>
            <span>
              <strong>Atenção:</strong> Urgências injustificadas prejudicam o planejamento e a
              qualidade das entregas de toda a equipe. Use este campo apenas quando há um prazo
              real e inegociável. Sua solicitação será avaliada pela equipe.
            </span>
          </div>
        ` : ''}
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
    // v4.54.4+ Se está auto-locked OU é edit mode monotônico, ignora
    const origReq = _state.editMode ? _state.recentRequests.find(r => r.id === _state.editId) : null;
    const wasUrgent = !!(origReq?.urgency);
    if (_state.data.urgencyAutoLocked || wasUrgent) { urg.checked = true; return; }
    _state.data.urgency = urg.checked;
    _persistDraft();
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

/* v4.55.5+ Constrói o doc Firestore a partir de uma data (atual ou de batch).
 * Extraído pra ser reusado em submit single + submit batch. */
function _buildRequestDoc(d, user) {
  return {
    requestingArea: d.requestingArea,
    requesterName:  user?.name || '',
    requesterEmail: user?.email || '',
    requesterUid:   user?.uid || null,
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
    source:         'portal-wizard-v4.55.5',
  };
}

/* v4.55.5+ Adiciona solicitação atual ao lote + reinicia wizard mantendo setor+tipo.
 * Validação completa antes de enfileirar. */
function _addToBatch() {
  if (!_validateStep4()) return;
  const d = _state.data;
  _state.batchQueue.push({ ...d });
  // Reinicia mantendo setor+tipo (mesma UX do "Outra similar" do v4.54.0)
  const keep = {
    sector: d.sector, typeId: d.typeId, typeName: d.typeName,
    typeIcon: d.typeIcon, typeColor: d.typeColor, autoAccept: d.autoAccept,
  };
  _state.data = { ..._defaultData(_state.user), ...keep };
  _state.step = 2;  // pula direto pro Quando — setor+tipo já decididos
  _persistDraft();
  _renderShell(document.querySelector('.pw-root')?.parentElement);
}

/* ─── Submit ─── */
async function _onSubmit(submitAnother) {
  if (_state.submitting) return;
  if (!_validateStep4()) return; // valida toggles + tudo anterior implicitamente

  _state.submitting = true;
  _renderFooter();

  try {
    const user = _state.user;
    const currentDoc = _buildRequestDoc(_state.data, user);

    let refId;
    let batchCount = 0;
    if (_state.editMode && _state.editId) {
      // v4.55.3+ Update: mantém status original, marca requesterEditFlag pra banner no sistema
      const { requesterUid, requesterName, requesterEmail, requestingArea, ...editableFields } = currentDoc;
      const editPayload = {
        ...editableFields,
        source: 'portal-wizard-v4.55.8-edit',
        requesterEditFlag: true,
        requesterEditedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await updateDoc(firestoreDoc(_state.db, 'requests', _state.editId), editPayload);
      refId = _state.editId;

      // v4.55.8+ CRÍTICO: se a request já foi convertida em task, sincroniza a task
      // linked com flag de edit + campos alterados. Sem isso, analista que está
      // trabalhando na task não vê que o solicitante mudou a descrição/título.
      const origReq = _state.recentRequests.find(r => r.id === _state.editId);
      if (origReq?.taskId) {
        const dueDateForTask = (() => {
          const ds = currentDoc.desiredDate;
          if (!ds) return null;
          const m = String(ds).match(/^(\d{4})-(\d{2})-(\d{2})/);
          return m ? new Date(+m[1], +m[2]-1, +m[3], 12, 0, 0) : new Date(ds);
        })();
        const taskUpdate = {
          title:           currentDoc.title,
          description:     currentDoc.description,
          priority:        currentDoc.urgency ? 'urgent' : 'medium',
          outOfCalendar:   currentDoc.outOfCalendar,
          variationId:     currentDoc.variationId,
          variationName:   currentDoc.variationName,
          requesterEditFlag:    true,
          requesterEditAt:      serverTimestamp(),
          requesterEditChanges: 'Atualizado pelo solicitante via portal',
          updatedAt:       serverTimestamp(),
        };
        if (dueDateForTask) taskUpdate.dueDate = dueDateForTask;
        try {
          const { withRetry } = await import('../services/retry.js');
          await withRetry(
            () => updateDoc(firestoreDoc(_state.db, 'tasks', origReq.taskId), taskUpdate),
            { label: 'portal.wizard.requesterEdit.syncTask', maxAttempts: 3 },
          );
        } catch (e) {
          console.warn('[wizard] sync task linked falhou após retries:', e?.code, e?.message);
          // Toast de erro inline (não bloqueia o sucesso da request — só avisa)
          _showSyncErrorToast();
        }
      }
    } else {
      // Create current
      const ref = await addDoc(collection(_state.db, 'requests'), {
        ...currentDoc,
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      refId = ref.id;

      // v4.55.8+ Auto-create task se type.autoAccept (paridade c/ portalLegacy)
      const currentType = _state.taskTypes.find(t => t.id === currentDoc.typeId);
      if (currentType?.autoAccept) {
        await _autoCreateTask(refId, currentDoc, currentType);
      }

      // v4.55.5+ Se há lote, submete cada item enfileirado sequencialmente
      // v4.57.1+ Adiciona batchId/batchIndex/batchTotal aos docs do lote (paridade legacy)
      if (_state.batchQueue.length > 0) {
        const batchId = 'b_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        const batchTotal = _state.batchQueue.length + 1; // +1 = current
        // Atualiza current pra ter batchId/batchTotal também (já foi criada acima)
        try {
          await updateDoc(firestoreDoc(_state.db, 'requests', refId), {
            batchId, batchIndex: 1, batchTotal,
          });
        } catch (e) { console.warn('[wizard] backfill batchId em current falhou:', e?.message); }

        for (let i = 0; i < _state.batchQueue.length; i++) {
          const batchData = _state.batchQueue[i];
          try {
            const bDoc = _buildRequestDoc(batchData, user);
            const bRef = await addDoc(collection(_state.db, 'requests'), {
              ...bDoc,
              status: 'pending',
              createdAt: serverTimestamp(),
              batchId,
              batchIndex: i + 2,   // +2 pq current é 1
              batchTotal,
            });
            const bType = _state.taskTypes.find(t => t.id === bDoc.typeId);
            if (bType?.autoAccept) {
              await _autoCreateTask(bRef.id, bDoc, bType);
            }
            _notifyAdmins(batchData, bRef.id).catch(e => console.warn('[wizard] batch notifyAdmins:', e?.message));
            batchCount++;
          } catch (err) {
            console.warn('[wizard] batch item falhou:', err?.message || err);
          }
        }
        _state.batchQueue = [];
      }
    }

    _clearDraft();

    // Notifica time + admins (best-effort). v4.57.1+: se houver batch, manda 1
    // email consolidado com description "N solicitações em conjunto" (paridade legacy).
    if (batchCount > 0) {
      _notifyTeam({
        ...currentDoc,
        id: refId,
        description: `${batchCount + 1} solicitações enviadas em conjunto pelo solicitante.`,
        isBatch: true,
        batchTotal: batchCount + 1,
      }).catch(e => console.warn('[wizard] notifyTeam batch falhou:', e?.message || e));
    } else {
      _notifyTeam({ ...currentDoc, id: refId, isEdit: _state.editMode })
        .catch(e => console.warn('[wizard] notifyTeam falhou:', e?.message || e));
    }
    _notifyAdmins(_state.data, refId)
      .catch(e => console.warn('[wizard] notify admins falhou:', e?.message || e));

    _state.submitting = false;
    if (submitAnother) {
      _renderSuccessAndRestart();
    } else {
      // v4.57.1+ Passa flags pra success view variar a mensagem
      const currentType = _state.taskTypes.find(t => t.id === currentDoc.typeId);
      _renderSuccess(batchCount, {
        autoAccepted: !!currentType?.autoAccept && !_state.editMode,
        urgent: !!currentDoc.urgency,
      });
    }
  } catch (err) {
    console.error('[wizard] submit falhou:', err);
    _state.submitting = false;
    _renderFooter();
    alert('Erro ao enviar: ' + (err?.message || err));
  }
}

/* v4.55.8+ Toast inline (sucesso/erro) — usado pra avisar sobre falha em
 * sync de task linked sem bloquear o fluxo principal da request. */
function _showSyncErrorToast() {
  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:10003;padding:12px 20px;
    border-radius:8px;background:#DC2626;color:#fff;font-size:0.875rem;
    font-weight:600;font-family:var(--font-ui);
    box-shadow:0 4px 20px rgba(0,0,0,0.3);max-width:420px;line-height:1.4;
  `;
  el.textContent = '⚠ Sua edição foi salva, mas a sincronização da tarefa interna falhou. A equipe pode não ver a alteração — entre em contato se necessário.';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 9000);
}

/* v4.55.8+ Notif IN-APP pros admins do sistema (Renê v4.51.1: "quando chega
 * solicitação não tem notificação no sistema"). Replicado do portalLegacy.
 * - busca users active=true
 * - filtra admins (isMaster OR roleId/role in [master,admin,head])
 * - chama notify('request.created') com actorId/actorName explícitos
 *   (portal não popula store.currentUser → precisa passar override)
 */
async function _notifyAdmins(d, requestId) {
  try {
    const { notify } = await import('../services/notifications.js');
    const usersSnap = await getDocs(query(
      collection(_state.db, 'users'),
      where('active', '==', true)
    ));
    const admins = usersSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(u => u.isMaster || ['master', 'admin', 'head'].includes(u.roleId) || ['master', 'admin', 'head'].includes(u.role))
      .map(u => u.id);
    if (!admins.length) return;
    await notify('request.created', {
      entityType: 'request', entityId: requestId,
      recipientIds: admins,
      title: 'Nova solicitação recebida',
      body: `${_state.user?.name || d.requesterName || 'Solicitante'} — ${d.typeName || 'Solicitação'}${d.urgency ? ' (URGENTE)' : ''}`,
      route: 'requests',
      category: 'request',
      priority: d.urgency ? 'high' : 'normal',
      actorId: _state.user?.uid,
      actorName: _state.user?.name || d.requesterName,
    });
  } catch (e) {
    console.warn('[wizard] notifyAdmins falhou:', e?.message || e);
  }
}

/* v4.55.8+ Auto-cria tarefa quando type.autoAccept=true. Replicado do
 * portalLegacy. Calcula dueDate via SLA da variação (bizDays), grava task
 * em collection 'tasks' + atualiza request com status='converted' + taskId.
 */
async function _autoCreateTask(reqRef, reqDoc, typeData) {
  try {
    const variation = typeData.variations?.find(v => v.id === reqDoc.variationId);
    const slaDays = variation?.slaDays ?? variation?.sla ?? 2;
    let dueDate = reqDoc.desiredDate || null;
    if (!dueDate) {
      const d = new Date();
      let biz = slaDays;
      while (biz > 0) {
        d.setDate(d.getDate() + 1);
        if (d.getDay() !== 0 && d.getDay() !== 6) biz--;
      }
      dueDate = d;
    } else if (typeof dueDate === 'string') {
      // YYYY-MM-DD → Date local meio-dia (evita timezone bug)
      const m = dueDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) dueDate = new Date(+m[1], +m[2]-1, +m[3], 12, 0, 0);
      else   dueDate = new Date(dueDate);
    }
    const taskDoc = {
      workspaceId:      null,
      sector:           reqDoc.sector || null,
      title:            reqDoc.title || reqDoc.typeName || 'Nova Tarefa',
      description:      reqDoc.description || '',
      status:           'not_started',
      priority:         reqDoc.urgency ? 'urgent' : 'medium',
      projectId:        null,
      assignees:        [],
      tags:             [],
      startDate:        serverTimestamp(),
      dueDate:          dueDate,
      typeId:           reqDoc.typeId || null,
      variationId:      reqDoc.variationId || null,
      variationName:    reqDoc.variationName || '',
      variationSLADays: slaDays,
      customFields:     {},
      type:             reqDoc.typeName?.toLowerCase() || '',
      requestingArea:   reqDoc.requestingArea || '',
      nucleos:          reqDoc.nucleo ? [reqDoc.nucleo] : [],
      outOfCalendar:    reqDoc.outOfCalendar || false,
      subtasks:         [],
      comments:         [],
      attachments:      [],
      order:            Date.now(),
      completedAt:      null,
      createdAt:        serverTimestamp(),
      createdBy:        _state.user?.uid || 'portal',
      updatedAt:        serverTimestamp(),
      updatedBy:        _state.user?.uid || 'portal',
      sourceRequestId:  reqRef,
    };
    const taskRef = await addDoc(collection(_state.db, 'tasks'), taskDoc);
    await updateDoc(firestoreDoc(_state.db, 'requests', reqRef), {
      status: 'converted',
      taskId: taskRef.id,
      updatedAt: serverTimestamp(),
    });
    return taskRef.id;
  } catch (e) {
    console.warn('[wizard] _autoCreateTask falhou:', e?.message || e);
    return null;
  }
}

function _renderSuccess(batchCount = 0, opts = {}) {
  const root = document.querySelector('.pw-root');
  if (!root) return;
  document.getElementById('pw-footer').innerHTML = '';
  // v4.55.5+ Mensagem dinâmica pra lote + v4.57.1+ pra auto-aceito + urgência
  const totalSent = 1 + (batchCount || 0);
  const { autoAccepted = false, urgent = false } = opts || {};
  let title, subtitle;
  if (totalSent > 1) {
    title = `${totalSent} solicitações enviadas!`;
    subtitle = `Recebemos ${totalSent} solicitações do seu lote. Equipe vai analisar e responder em breve.`;
  } else if (autoAccepted) {
    title = '✓ Tarefa criada automaticamente!';
    subtitle = 'Sua solicitação foi aceita automaticamente e já virou uma tarefa pro time. Você vai receber updates do progresso.';
  } else if (urgent) {
    title = '🔴 Solicitação URGENTE enviada!';
    subtitle = 'Recebemos sua solicitação marcada como urgente. O time vai priorizar a análise.';
  } else {
    title = 'Solicitação enviada!';
    subtitle = 'Recebemos sua solicitação. Nossa equipe vai analisar e responder em breve.';
  }
  root.innerHTML = `
    <div style="text-align:center;padding:60px 20px;">
      <div style="font-size:4rem;color:var(--brand-gold);margin-bottom:16px;">✓</div>
      <h2 style="margin:0 0 8px;color:var(--text-primary);">${esc(title)}</h2>
      <p style="color:var(--text-muted);margin:0 0 32px;">${esc(subtitle)}</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
        <button class="btn btn-primary" id="pw-new">Fazer nova solicitação</button>
        <button class="btn btn-secondary" id="pw-call-success">Voltar ao início</button>
      </div>
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
  // v4.57.5+ NÃO sobrescreve draft com state vazio. Caso contrário, o
  // _renderStep(1) chamado no init/reload limpa o draft real do user.
  // Só persiste quando há conteúdo útil — mesmo critério de hasDraftContent.
  const d = _state.data;
  const hasContent = !!(d.sector || d.typeId || d.title || d.description || d.desiredDate || d.nucleo);
  if (!hasContent) return;
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

/* v4.55.3+ Carrega últimas solicitações do user atual (até 5) pra permitir
 * edição inline a partir do banner do Step 1. */
async function _loadRecentRequests() {
  if (!_state?.user?.email || !_state?.db) return;
  try {
    // v4.55.4+ Filtra por EMAIL (não uid) — requests antigas (portalLegacy.js)
    // não gravavam requesterUid, só requesterEmail. Email é estável e robusto.
    const q = query(
      collection(_state.db, 'requests'),
      where('requesterEmail', '==', _state.user.email),
      limit(20)
    );
    const snap = await getDocs(q);
    const list = [];
    snap.forEach(d => list.push({ id: d.id, ...d.data() }));
    // Filtra editáveis (status pending) e ordena por createdAt desc client-side
    const editable = list.filter(r => {
      const st = r.status || 'pending';
      return ['pending', 'em_andamento'].includes(st);
    });
    editable.sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() || a.createdAt?.seconds * 1000 || 0;
      const tb = b.createdAt?.toMillis?.() || b.createdAt?.seconds * 1000 || 0;
      return tb - ta;
    });
    _state.recentRequests = editable.slice(0, 5);
  } catch (e) {
    console.warn('[wizard] _loadRecentRequests error:', e?.message || e);
    _state.recentRequests = [];
  }
}

function _renderRecentRequestsBanner() {
  const list = _state?.recentRequests || [];
  if (!list.length) return '';
  return `
    <div class="portal-card" style="padding:14px 18px;margin-bottom:14px;background:var(--bg-surface);">
      <div style="font-size:0.8125rem;color:var(--text-secondary);font-weight:600;margin-bottom:8px;">
        📋 Suas últimas solicitações <span style="color:var(--text-muted);font-weight:400;font-size:0.75rem;">(clique pra editar)</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${list.map(r => `
          <div class="pw-recent-req-card" data-req-id="${esc(r.id)}"
            style="display:flex;align-items:center;justify-content:space-between;gap:10px;
              padding:8px 12px;border:1px solid var(--border-subtle);border-radius:6px;
              cursor:pointer;background:var(--bg-card);transition:background 0.12s;"
            onmouseover="this.style.background='rgba(212,168,67,0.08)'"
            onmouseout="this.style.background='var(--bg-card)'">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:500;font-size:0.8125rem;color:var(--text-primary);
                white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${esc(r.title || r.typeName || 'Sem título')}
              </div>
              <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:1px;">
                ${esc(r.sector || '?')} · ${esc(_fmtDate(r.desiredDate))} · ${esc(_statusLabel(r.status))}
              </div>
            </div>
            <span style="font-size:0.75rem;color:var(--brand-gold);">Editar →</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

/* v4.57.3+ Banner "Você tem um rascunho em andamento" no Step 1 — só aparece
 * quando há draft persistido com conteúdo significativo (step > 1 OU campos
 * preenchidos). Mostra timestamp do último save + 2 botões:
 * - "Continuar de onde parei" → pula direto pro último step salvo
 * - "Descartar e começar do zero" → clearDraft + reset
 *
 * O draft é persistido AUTOMATICAMENTE em localStorage a cada mudança de
 * campo (auto-save), por isso não precisa mais do botão "Salvar e sair".
 * Renê: "o ideal é a pessoa fazer e o sistema ja salvar a cada campo
 * preenchido. se a pessoa sai, vai encontrar essa solicitacao onde?".
 */
function _renderDraftResumeBanner() {
  if (!_state) return '';
  // v4.57.3+ Só mostra no Step 1 (cabeçalho de retomada) E quando há draft com
  // conteúdo significativo (step > 1 OU campos importantes preenchidos).
  if (_state.step !== 1) return '';
  // Se o user já clicou "Continuar" e está editando, suprime (state.sector pode
  // ter mudado em relação ao draft).
  if (_state.data.sector || _state.data.title) return '';
  const draft = _loadDraft();
  if (!draft || !draft.data) return '';
  const hasContent = draft.step > 1
    || (draft.data.sector && draft.data.typeId)
    || (draft.data.title && draft.data.title.length > 3);
  if (!hasContent) return '';

  const savedAt = draft.savedAt;
  let savedLabel = '';
  if (savedAt) {
    const ago = Date.now() - savedAt;
    if (ago < 60000) savedLabel = 'há menos de 1 minuto';
    else if (ago < 3600000) savedLabel = `há ${Math.round(ago/60000)} min`;
    else if (ago < 86400000) savedLabel = `há ${Math.round(ago/3600000)} h`;
    else savedLabel = `há ${Math.round(ago/86400000)} dia(s)`;
  }
  const stepLabels = ['', 'Setor e tipo', 'Quando', 'Detalhes', 'Revisão'];
  const lastStep = stepLabels[draft.step] || '?';
  const title = draft.data.title || draft.data.typeName || '(sem título)';

  return `
    <div class="portal-card" style="padding:14px 18px;margin-bottom:14px;
      background:rgba(212,168,67,0.10);border:1px solid rgba(212,168,67,0.45);">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
        <span style="font-size:1.125rem;">📝</span>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:600;font-size:0.875rem;color:var(--text-primary);">
            Você tem um rascunho em andamento
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
            Último salvo automático ${esc(savedLabel)} · Parou em <strong>"${esc(lastStep)}"</strong>
            ${title && title !== '(sem título)' ? ` · Título: <em>"${esc(title.slice(0,60))}${title.length>60?'…':''}"</em>` : ''}
          </div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button type="button" id="pw-draft-resume" class="btn btn-primary btn-sm">
          Continuar de onde parei →
        </button>
        <button type="button" id="pw-draft-discard" class="btn btn-secondary btn-sm">
          Descartar e começar do zero
        </button>
      </div>
    </div>
  `;
}

/* v4.55.5+ Badge de lote pendente no Step 1 — mostra quantas solicitações já
 * foram enfileiradas e permite remover qualquer item antes do envio final. */
function _renderBatchBadge() {
  const list = _state?.batchQueue || [];
  if (!list.length) return '';
  return `
    <div class="portal-card" style="padding:12px 16px;margin-bottom:14px;
      background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.35);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;">
        <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);">
          📦 Lote pendente: ${list.length} solicitação${list.length>1?'ões':''}
        </div>
        <span style="font-size:0.6875rem;color:var(--text-muted);">
          Será enviado junto com a próxima
        </span>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;">
        ${list.map((item, i) => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;
            padding:6px 10px;border:1px solid rgba(34,197,94,0.25);border-radius:5px;
            background:var(--bg-card);font-size:0.75rem;">
            <div style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
              <strong>${esc(item.title || '(sem título)')}</strong>
              <span style="color:var(--text-muted);"> · ${esc(item.sector||'?')} · ${esc(_fmtDate(item.desiredDate))}</span>
            </div>
            <button type="button" class="pw-remove-batch" data-batch-idx="${i}"
              style="background:transparent;border:none;color:var(--color-danger);cursor:pointer;font-size:0.875rem;padding:0 4px;"
              title="Remover do lote">×</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function _statusLabel(st) {
  return ({
    pending:       'Pendente',
    em_andamento:  'Em andamento',
    converted:     'Convertida',
    rejected:      'Rejeitada',
    archived:      'Arquivada',
  })[st || 'pending'] || st;
}

function _enterEditMode(req) {
  _state.editMode = true;
  _state.editId = req.id;
  // Pré-popula state.data com tudo da request
  _state.data = {
    ..._defaultData(_state.user),
    requestingArea: req.requestingArea || _state.data.requestingArea,
    sector:         req.sector || '',
    typeId:         req.typeId || '',
    typeName:       req.typeName || '',
    typeIcon:       req.typeIcon || '',
    typeColor:      req.typeColor || '',
    autoAccept:     req.autoAccept || false,
    desiredDate:    req.desiredDate || '',
    nucleo:         req.nucleo || '',
    outOfCalendar:  req.outOfCalendar || false,
    variationId:    req.variationId || '',
    variationName:  req.variationName || '',
    title:          req.title || '',
    description:    req.description || '',
    contentLink:    req.contentLink || '',
    urgency:        req.urgency || false,
    isPartnership:  req.isPartnership || false,
    urgencyAutoLocked: req.urgencyAutoLocked || false,
    urgencyLockReason: req.urgencyLockReason || '',
  };
  _state.step = 1;
  _persistDraft();
  _renderShell(document.querySelector('.pw-root')?.parentElement);
}

function _exitEditMode() {
  _state.editMode = false;
  _state.editId = null;
  _state.data = _defaultData(_state.user);
  _state.step = 1;
  _clearDraft();
  _renderShell(document.querySelector('.pw-root')?.parentElement);
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
