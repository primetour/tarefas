/**
 * PRIMETOUR — Tour Component (onboarding interativo)
 *
 * Spotlight no elemento real + tooltip ao lado, navegação por
 * botões/ESC/setas. Sem dependências externas.
 *
 * Uso:
 *   import { startTour } from '../components/tour.js';
 *   startTour({
 *     id: 'welcome',
 *     title: 'Bem-vindo ao PRIMETOUR',
 *     steps: [
 *       { selector: '.sidebar', title: 'Menu', body: 'Aqui...', position: 'right' },
 *       ...
 *     ],
 *     onComplete: () => {...},
 *     onSkip:     () => {...},
 *   });
 *
 * Cada step:
 *   selector  — CSS seletor do alvo (ou fn que retorna Element)
 *   title     — string curta
 *   body      — string (HTML simples permitido)
 *   position  — 'top'|'bottom'|'left'|'right'|'auto' (default auto)
 *   route     — opcional: navega pra esta rota antes de mostrar (ex: '#tasks')
 *   beforeShow — opcional: fn async chamada antes (ex: clicar uma aba)
 *   skipIfMissing — opcional bool: pula se selector não existir (default true)
 */

const STYLES = `
  .tour-overlay {
    position: fixed; inset: 0; z-index: 99999;
    pointer-events: none;
    transition: opacity 0.2s ease;
  }
  .tour-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.55);
    pointer-events: auto;
    transition: clip-path 0.3s ease;
  }
  .tour-spotlight {
    position: fixed;
    border: 2px solid #60A5FA;
    border-radius: 8px;
    box-shadow: 0 0 0 4px rgba(96,165,250,0.25), 0 0 24px rgba(96,165,250,0.45);
    pointer-events: none;
    transition: top 0.3s ease, left 0.3s ease, width 0.3s ease, height 0.3s ease;
  }
  .tour-tooltip {
    position: fixed;
    background: #FFFFFF;
    color: #1F2937;
    border-radius: 12px;
    box-shadow: 0 12px 48px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.06);
    padding: 18px 20px 14px;
    width: 360px;
    max-width: calc(100vw - 32px);
    pointer-events: auto;
    transition: top 0.3s ease, left 0.3s ease, opacity 0.2s ease;
    font-family: var(--font-sans, system-ui);
    z-index: 100000;
  }
  .tour-tooltip-arrow {
    position: absolute;
    width: 14px; height: 14px;
    background: #FFFFFF;
    transform: rotate(45deg);
    box-shadow: -2px -2px 4px rgba(0,0,0,0.04);
  }
  .tour-tooltip[data-pos="top"]    .tour-tooltip-arrow { bottom: -7px; left: 50%; margin-left: -7px; box-shadow: 2px 2px 4px rgba(0,0,0,0.04); }
  .tour-tooltip[data-pos="bottom"] .tour-tooltip-arrow { top: -7px; left: 50%; margin-left: -7px; }
  .tour-tooltip[data-pos="left"]   .tour-tooltip-arrow { right: -7px; top: 50%; margin-top: -7px; box-shadow: 2px -2px 4px rgba(0,0,0,0.04); }
  .tour-tooltip[data-pos="right"]  .tour-tooltip-arrow { left: -7px;  top: 50%; margin-top: -7px; box-shadow: -2px 2px 4px rgba(0,0,0,0.04); }
  .tour-tooltip-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 6px;
    font-size: 0.6875rem; color: #6B7280; text-transform: uppercase; letter-spacing: 0.06em;
  }
  .tour-tooltip-title {
    font-size: 1.0625rem; font-weight: 700;
    color: #111827; margin: 0 0 6px;
    line-height: 1.3;
  }
  .tour-tooltip-body {
    font-size: 0.875rem; color: #374151;
    line-height: 1.55; margin: 0 0 14px;
  }
  .tour-tooltip-progress {
    height: 3px; background: #E5E7EB; border-radius: 2px; overflow: hidden;
    margin-bottom: 12px;
  }
  .tour-tooltip-progress-fill {
    height: 100%; background: linear-gradient(90deg, #2563EB, #60A5FA);
    transition: width 0.3s ease;
  }
  .tour-tooltip-actions {
    display: flex; justify-content: space-between; align-items: center; gap: 8px;
  }
  .tour-tooltip-actions-right {
    display: flex; gap: 6px; align-items: center;
  }
  .tour-btn {
    border-radius: 6px; padding: 7px 14px;
    font-size: 0.8125rem; font-weight: 600; cursor: pointer;
    border: 1px solid transparent; transition: all 0.15s ease;
    font-family: inherit;
  }
  .tour-btn-skip {
    background: transparent; color: #6B7280; border-color: transparent;
    padding: 7px 6px;
  }
  .tour-btn-skip:hover { color: #374151; }
  .tour-btn-secondary {
    background: #F3F4F6; color: #374151; border-color: #E5E7EB;
  }
  .tour-btn-secondary:hover { background: #E5E7EB; }
  .tour-btn-secondary[disabled] { opacity: 0.4; cursor: not-allowed; }
  .tour-btn-primary {
    background: #2563EB; color: #FFFFFF; border-color: #2563EB;
  }
  .tour-btn-primary:hover { background: #1E40AF; border-color: #1E40AF; }

  /* Welcome modal (antes de iniciar o tour) */
  .tour-welcome-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.55);
    z-index: 99998; display: flex; align-items: center; justify-content: center;
    padding: 16px; animation: tourFadeIn 0.2s ease;
  }
  .tour-welcome-modal {
    background: #FFFFFF; color: #1F2937;
    border-radius: 16px; padding: 32px 28px;
    max-width: 440px; width: 100%; text-align: center;
    box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    font-family: var(--font-sans, system-ui);
    animation: tourSlideUp 0.25s ease;
  }
  .tour-welcome-icon { font-size: 3rem; margin-bottom: 8px; }
  .tour-welcome-title {
    font-size: 1.5rem; font-weight: 700; color: #111827;
    margin: 0 0 8px;
  }
  .tour-welcome-body {
    font-size: 0.9375rem; color: #4B5563; line-height: 1.6;
    margin: 0 0 22px;
  }
  .tour-welcome-actions { display: flex; gap: 8px; justify-content: center; }

  @keyframes tourFadeIn { from { opacity: 0 } to { opacity: 1 } }
  @keyframes tourSlideUp {
    from { opacity: 0; transform: translateY(12px) }
    to   { opacity: 1; transform: translateY(0) }
  }

  /* Quando o tour está ativo, alvo fica acima do backdrop pra ser clicável */
  body.tour-active .tour-target-active {
    position: relative; z-index: 100001;
  }
`;

let _activeTour = null;

function injectStyles() {
  if (document.getElementById('tour-styles')) return;
  const style = document.createElement('style');
  style.id = 'tour-styles';
  style.textContent = STYLES;
  document.head.appendChild(style);
}

/** Resolve um seletor (string ou função) em Element. */
function resolveTarget(selector) {
  if (!selector) return null;
  if (typeof selector === 'function') return selector();
  try { return document.querySelector(selector); } catch { return null; }
}

/** Calcula posição da tooltip relativa ao retângulo do alvo. */
function computePosition(rect, position, tooltipEl) {
  const tw = tooltipEl.offsetWidth || 360;
  const th = tooltipEl.offsetHeight || 160;
  const margin = 16;
  const vw = window.innerWidth, vh = window.innerHeight;
  let pos = position || 'auto';

  if (pos === 'auto') {
    // Escolhe o lado com mais espaço
    const spaceTop    = rect.top;
    const spaceBottom = vh - rect.bottom;
    const spaceLeft   = rect.left;
    const spaceRight  = vw - rect.right;
    const maxV = Math.max(spaceTop, spaceBottom);
    const maxH = Math.max(spaceLeft, spaceRight);
    if (maxV > maxH) pos = (spaceBottom >= spaceTop) ? 'bottom' : 'top';
    else             pos = (spaceRight  >= spaceLeft) ? 'right'  : 'left';
  }

  let top, left;
  if (pos === 'top')    { top = rect.top - th - margin; left = rect.left + rect.width/2 - tw/2; }
  if (pos === 'bottom') { top = rect.bottom + margin;   left = rect.left + rect.width/2 - tw/2; }
  if (pos === 'left')   { top = rect.top + rect.height/2 - th/2; left = rect.left - tw - margin; }
  if (pos === 'right')  { top = rect.top + rect.height/2 - th/2; left = rect.right + margin; }

  // Clamp dentro do viewport
  top  = Math.max(8, Math.min(top,  vh - th - 8));
  left = Math.max(8, Math.min(left, vw - tw - 8));
  return { top, left, pos };
}

/** Cria o overlay (uma vez por tour). */
function createOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'tour-overlay';
  overlay.innerHTML = `
    <div class="tour-backdrop"></div>
    <div class="tour-spotlight" style="display:none;"></div>
    <div class="tour-tooltip" data-pos="bottom" style="opacity:0;">
      <div class="tour-tooltip-arrow"></div>
      <div class="tour-tooltip-header">
        <span class="tour-tooltip-tour-name"></span>
        <span class="tour-tooltip-step-count"></span>
      </div>
      <div class="tour-tooltip-progress">
        <div class="tour-tooltip-progress-fill" style="width:0%;"></div>
      </div>
      <h3 class="tour-tooltip-title"></h3>
      <div class="tour-tooltip-body"></div>
      <div class="tour-tooltip-actions">
        <button class="tour-btn tour-btn-skip" data-act="skip">Pular tour</button>
        <div class="tour-tooltip-actions-right">
          <button class="tour-btn tour-btn-secondary" data-act="back">← Voltar</button>
          <button class="tour-btn tour-btn-primary" data-act="next">Próximo →</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

/** Mostra um step específico (com ou sem alvo). */
async function showStep(state, idx) {
  const step = state.steps[idx];
  if (!step) return endTour(state, true);

  // Navegar pra rota se preciso
  if (step.route && location.hash !== step.route) {
    location.hash = step.route;
    await wait(400);
  }
  // Hook beforeShow
  if (step.beforeShow) {
    try { await step.beforeShow(); } catch (e) { console.warn('[tour] beforeShow err:', e); }
  }
  // Aguarda DOM (caso route trocou)
  await wait(150);

  let target = resolveTarget(step.selector);
  if (!target) {
    // Tenta esperar até 1.5s pelo elemento aparecer
    for (let i = 0; i < 15 && !target; i++) {
      await wait(100);
      target = resolveTarget(step.selector);
    }
  }
  if (!target) {
    if (step.skipIfMissing !== false) {
      console.warn('[tour] selector not found, skipping:', step.selector);
      return showStep(state, idx + 1);
    }
    // Se não pode pular, mostra centralizado (sem spotlight)
  }

  state.currentIdx = idx;
  const overlay = state.overlay;
  const backdrop = overlay.querySelector('.tour-backdrop');
  const spot = overlay.querySelector('.tour-spotlight');
  const tooltip = overlay.querySelector('.tour-tooltip');

  // Limpa target anterior
  if (state.lastTarget) state.lastTarget.classList.remove('tour-target-active');

  // Atualiza tooltip content
  overlay.querySelector('.tour-tooltip-tour-name').textContent = state.title || 'Tour';
  overlay.querySelector('.tour-tooltip-step-count').textContent = `Passo ${idx+1} de ${state.steps.length}`;
  overlay.querySelector('.tour-tooltip-title').textContent = step.title || '';
  overlay.querySelector('.tour-tooltip-body').innerHTML = step.body || '';
  overlay.querySelector('.tour-tooltip-progress-fill').style.width = `${((idx+1)/state.steps.length)*100}%`;
  overlay.querySelector('[data-act="back"]').disabled = (idx === 0);
  overlay.querySelector('[data-act="next"]').textContent =
    (idx === state.steps.length - 1) ? '✓ Concluir' : 'Próximo →';

  if (target) {
    target.classList.add('tour-target-active');
    state.lastTarget = target;
    // Scroll into view
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    await wait(300);
    const rect = target.getBoundingClientRect();
    const padding = 6;
    spot.style.display = 'block';
    spot.style.top    = (rect.top - padding) + 'px';
    spot.style.left   = (rect.left - padding) + 'px';
    spot.style.width  = (rect.width + padding*2) + 'px';
    spot.style.height = (rect.height + padding*2) + 'px';

    // Backdrop com clip recortando o spotlight (cria buraco)
    const r = padding;
    backdrop.style.clipPath = `polygon(
      0 0, 100% 0, 100% 100%, 0 100%, 0 0,
      ${rect.left - r}px ${rect.top - r}px,
      ${rect.left - r}px ${rect.bottom + r}px,
      ${rect.right + r}px ${rect.bottom + r}px,
      ${rect.right + r}px ${rect.top - r}px,
      ${rect.left - r}px ${rect.top - r}px
    )`;

    // Posiciona tooltip
    tooltip.style.opacity = '0';
    tooltip.style.display = 'block';
    await wait(20);
    const { top, left, pos } = computePosition(rect, step.position, tooltip);
    tooltip.style.top  = top + 'px';
    tooltip.style.left = left + 'px';
    tooltip.dataset.pos = pos;
    tooltip.style.opacity = '1';
  } else {
    // Sem alvo — centraliza
    spot.style.display = 'none';
    backdrop.style.clipPath = '';
    tooltip.style.opacity = '0';
    tooltip.style.display = 'block';
    await wait(20);
    tooltip.style.top  = (window.innerHeight/2 - tooltip.offsetHeight/2) + 'px';
    tooltip.style.left = (window.innerWidth/2  - tooltip.offsetWidth/2)  + 'px';
    tooltip.dataset.pos = 'center';
    tooltip.style.opacity = '1';
  }
}

function endTour(state, completed) {
  if (state.lastTarget) state.lastTarget.classList.remove('tour-target-active');
  state.overlay?.remove();
  document.body.classList.remove('tour-active');
  window.removeEventListener('keydown', state.keyHandler);
  window.removeEventListener('resize',  state.resizeHandler);
  if (completed && state.onComplete) state.onComplete();
  if (!completed && state.onSkip)    state.onSkip();
  if (_activeTour === state) _activeTour = null;
  // Mostra tela de parabéns quando concluído (não quando pulou)
  if (completed) showCompletionModal(state);
}

function showCompletionModal(state) {
  // 4.40.14+ Remove backdrops residuais antes de criar novo (mesmo padrão
  // do showWelcomeModal). Previne 'clicar 2-3× pra fechar' quando vários
  // tours fecham em sequência ou se welcome modal ainda estava no DOM.
  document.querySelectorAll('.tour-welcome-backdrop').forEach(el => el.remove());

  const back = document.createElement('div');
  back.className = 'tour-welcome-backdrop';
  back.style.zIndex = '99998';
  back.innerHTML = `
    <div class="tour-welcome-modal" role="dialog" style="border-top:4px solid #22C55E;">
      <div class="tour-welcome-icon" style="font-size:3.5rem;">🎉</div>
      <h2 class="tour-welcome-title" style="color:#22C55E;">Parabéns, tour concluído!</h2>
      <p class="tour-welcome-body">
        Você completou <strong>${state.title}</strong>.
        Lembre que pode refazer este e outros tours a qualquer momento na página
        <strong>Ajuda</strong> (menu lateral).
      </p>
      <div class="tour-welcome-actions">
        <button class="tour-btn tour-btn-primary" data-act="ok">Beleza!</button>
      </div>
    </div>
  `;
  document.body.appendChild(back);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    back.remove();
    window.removeEventListener('keydown', onKey);
  };
  back.querySelector('[data-act="ok"]').addEventListener('click', close);
  back.addEventListener('click', (e) => { if (e.target === back) close(); });
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') close(); };
  window.addEventListener('keydown', onKey);
  // Auto-fechar em 4s caso o user não interaja
  setTimeout(close, 4000);
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ─── API pública ───────────────────────────────────────── */
export function startTour(opts) {
  if (_activeTour) endTour(_activeTour, false);
  injectStyles();
  if (!opts.steps?.length) return;

  // Modal de boas-vindas (a menos que skipWelcome)
  if (opts.welcome !== false) {
    showWelcomeModal({
      title: opts.welcomeTitle || `${opts.title || 'Tour'}`,
      body:  opts.welcomeBody  || 'Posso te guiar rapidinho? Você pode pular a qualquer momento.',
      onAccept: () => _runTour(opts),
      onSkip:   () => { opts.onSkip?.(); },
    });
  } else {
    _runTour(opts);
  }
}

function _runTour(opts) {
  const overlay = createOverlay();
  document.body.classList.add('tour-active');

  const state = {
    id: opts.id, title: opts.title || 'Tour', steps: opts.steps,
    onComplete: opts.onComplete, onSkip: opts.onSkip,
    currentIdx: 0, overlay, lastTarget: null,
  };
  _activeTour = state;

  overlay.querySelector('[data-act="skip"]').addEventListener('click', () => endTour(state, false));
  overlay.querySelector('[data-act="back"]').addEventListener('click', () => {
    if (state.currentIdx > 0) showStep(state, state.currentIdx - 1);
  });
  overlay.querySelector('[data-act="next"]').addEventListener('click', () => {
    if (state.currentIdx === state.steps.length - 1) endTour(state, true);
    else showStep(state, state.currentIdx + 1);
  });

  state.keyHandler = (e) => {
    if (e.key === 'Escape') { endTour(state, false); }
    else if (e.key === 'ArrowRight') {
      if (state.currentIdx < state.steps.length - 1) showStep(state, state.currentIdx + 1);
      else endTour(state, true);
    } else if (e.key === 'ArrowLeft' && state.currentIdx > 0) {
      showStep(state, state.currentIdx - 1);
    }
  };
  window.addEventListener('keydown', state.keyHandler);

  // Reposiciona ao redimensionar
  state.resizeHandler = () => showStep(state, state.currentIdx);
  window.addEventListener('resize', state.resizeHandler);

  showStep(state, 0);
}

function showWelcomeModal({ title, body, onAccept, onSkip }) {
  injectStyles();
  // 4.24+ Bug fix: o user reportou "tem que clicar 3x pra sair".
  // Causa: triggerTourFor disparava múltiplas vezes (re-render da página) e
  // welcome modals empilhavam — cada click fechava apenas UM dos backdrops.
  // Fix: remove TODOS os welcome backdrops antes de criar um novo (idempotente).
  document.querySelectorAll('.tour-welcome-backdrop').forEach(el => el.remove());

  const back = document.createElement('div');
  back.className = 'tour-welcome-backdrop';
  back.innerHTML = `
    <div class="tour-welcome-modal" role="dialog">
      <div class="tour-welcome-icon">🎯</div>
      <h2 class="tour-welcome-title">${title}</h2>
      <p class="tour-welcome-body">${body}</p>
      <div class="tour-welcome-actions">
        <button class="tour-btn tour-btn-secondary" data-act="skip">Agora não</button>
        <button class="tour-btn tour-btn-primary" data-act="ok">Vamos lá! →</button>
      </div>
    </div>
  `;
  document.body.appendChild(back);

  // Cleanup unificado: remove TODOS os backdrops welcome (defesa extra
  // caso outro tour empilhe entre o append e o click) + desbinda o ESC.
  const cleanup = () => {
    document.querySelectorAll('.tour-welcome-backdrop').forEach(el => el.remove());
    window.removeEventListener('keydown', onKey);
  };
  back.querySelector('[data-act="ok"]').addEventListener('click', () => { cleanup(); onAccept?.(); });
  back.querySelector('[data-act="skip"]').addEventListener('click', () => { cleanup(); onSkip?.(); });
  // Click no backdrop (fora do modal) também conta como "skip" — UX padrão
  back.addEventListener('click', (e) => {
    if (e.target === back) { cleanup(); onSkip?.(); }
  });
  // ESC fecha
  const onKey = (e) => { if (e.key === 'Escape') { cleanup(); onSkip?.(); } };
  window.addEventListener('keydown', onKey);
}

export function isTourActive() { return !!_activeTour; }
export function endActiveTour() { if (_activeTour) endTour(_activeTour, false); }
