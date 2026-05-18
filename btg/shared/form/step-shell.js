/**
 * Shell de 3 colunas (sidebar + form + preview) — equivalente do
 * StepShell.tsx. Sidebar tem ícone do tipo + título da etapa + stepper
 * vertical + Save & Close. Form principal renderiza campos. Preview à direita.
 */

import { icon } from '../btg-icons.js';

const TIPO_META = {
  Feriado: { icon: 'party-popper', primary: '#d4a017' },
  Destino: { icon: 'compass', primary: '#7c3aed' },
  Cruzeiro: { icon: 'ship', primary: '#0c4a6e' },
  Hospedagem: { icon: 'hotel', primary: '#15803d' },
  'Aéreo & Transfers': { icon: 'plane', primary: '#1d4ed8' },
  Concierge: { icon: 'crown', primary: '#1f2937' },
};

/**
 * @param {HTMLElement} container
 * @param {Object} state
 * @param {Object} handlers
 */
export function renderStepShell(container, state, handlers) {
  const meta = TIPO_META[state.tipo] || TIPO_META.Feriado;
  const current = state.steps[state.currentStepIdx];

  container.innerHTML = `
    <main class="step-shell">
      <div class="step-shell__grid">
        <aside class="step-sidebar">
          <button type="button" class="step-sidebar__brand" data-action="change-type">
            ${icon('chevron-left', 'icon-sm')}
            <span class="step-sidebar__brand-icon" style="background:${meta.primary}1f;color:${meta.primary};">
              ${icon(meta.icon, 'icon-sm')}
            </span>
            <span class="step-sidebar__brand-label">${state.tipo}</span>
          </button>

          <h1 class="step-sidebar__title">${current?.title || ''}</h1>
          <p class="step-sidebar__desc">${current?.description || ''}</p>

          <nav class="step-sidebar__nav">
            ${state.steps
              .map((s, i) => {
                const active = i === state.currentStepIdx;
                const completed = state.completedSteps.has(i);
                return `
                <button type="button" class="step-nav-item${active ? ' is-active' : ''}${completed ? ' is-completed' : ''}"
                  data-action="goto-step" data-step="${i}">
                  <span class="step-nav-item__num">${completed && !active ? icon('shield-check', 'icon-sm') : i + 1}</span>
                  ${s.label}
                </button>
              `;
              })
              .join('')}
          </nav>

          <div class="step-sidebar__actions">
            <button type="button" class="step-sidebar__import" data-action="import">
              ${icon('upload', 'icon-sm')}
              Importar de arquivo
            </button>
            <button type="button" class="step-sidebar__close" data-action="save-close">
              Save &amp; Close
            </button>
          </div>
        </aside>

        <section class="step-form">
          <p class="step-form__label">${current?.label || ''}</p>
          <div id="step-fields" class="step-fields"></div>
          <div class="step-footer">
            <button type="button" class="step-footer__back"
              ${state.currentStepIdx === 0 ? 'disabled' : ''}
              data-action="prev">
              ${icon('arrow-left', 'icon-sm')} Voltar
            </button>
            <div id="step-msg" class="step-footer__msg"></div>
            <button type="button" class="step-footer__next" data-action="next">
              ${state.currentStepIdx === state.steps.length - 1 ? 'Publicar oferta' : 'Avançar'}
              ${icon('arrow-right', 'icon-sm')}
            </button>
          </div>
        </section>

        <aside class="step-preview" id="step-preview"></aside>
      </div>
    </main>
  `;

  // Wire actions
  container.querySelectorAll('[data-action]').forEach((el) => {
    el.addEventListener('click', () => {
      const action = el.dataset.action;
      if (action === 'change-type') handlers.onChangeType?.();
      else if (action === 'save-close') handlers.onSaveAndClose?.();
      else if (action === 'import') handlers.onImport?.();
      else if (action === 'prev') handlers.onPrev?.();
      else if (action === 'next') handlers.onNext?.();
      else if (action === 'goto-step') handlers.onGotoStep?.(parseInt(el.dataset.step, 10));
    });
  });
}

/**
 * Renderiza os campos do step atual no #step-fields.
 */
export function renderStepFields(container, step, questions, store) {
  if (!step || !questions.length) {
    container.innerHTML = `
      <div class="step-empty">
        <p>Revise as informações na prévia ao lado.</p>
        <p class="step-empty__hint">Quando estiver tudo certo, clique em <strong>Publicar oferta</strong>.</p>
      </div>
    `;
    return;
  }

  const values = store.values();
  const visible = questions.filter((q) => !q.visibleWhen || q.visibleWhen(values));

  container.innerHTML = visible
    .map((q) => `
      <section class="step-question" data-question="${q.id}">
        <div class="step-question__head">
          <h3>${q.title}${q.optional ? '<span class="step-question__optional">opcional</span>' : ''}</h3>
          ${q.hint ? `<p>${q.hint}</p>` : ''}
        </div>
        <div class="step-question__input">${q.render(store)}</div>
      </section>
    `)
    .join('');
}

export function setStepMessage(container, message, type = 'error') {
  const el = container.querySelector('#step-msg');
  if (!el) return;
  if (!message) {
    el.innerHTML = '';
    el.dataset.type = '';
    return;
  }
  el.textContent = message;
  el.dataset.type = type;
}
