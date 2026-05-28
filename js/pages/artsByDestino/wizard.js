import { MOCK_FORMATOS, MOCK_TEMPLATES, MOCK_LAYOUTS } from './mock-data.js';
import {
  fetchDestinos, buildSlidesForDestino,
  getBancoCuradoForDestino, getBancoCuradoCounts, PICKER_CATEGORIAS,
} from '../../services/artsByDestino.js';

// Cache local — populado em initWizard via fetchDestinos()
let _destinos = [];
const getDestinos = () => _destinos;
const getBancoCurado = () => getBancoCuradoForDestino(state.destino, state.bancoCategoria || 'todas');

// ───── State ─────
const state = {
  view: 'welcome',                       // 'welcome' | 'editor'
  destinoId: null,
  destino: null,                         // doc completo (com _raw)
  formatos: new Set(['carrossel', 'story']),
  templateId: 'classico-teal',
  slides: [],                            // cópia editável dos slides do destino
  activeSlideIdx: 0,
  previewFormato: 'carrossel',
  fotoTab: 'curadas',
  bancoCategoria: 'todas',               // 'todas' | 'location' | 'hotel' | ...
  openSheet: null,                       // 'formato' | 'estilo' | 'texto' | 'foto' | 'baixar' | null
  generated: null,
};

// ───── DOM refs ─────
const $ = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];

// ───── View switching ─────
function setView(name) {
  state.view = name;
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  closeSheet();
}

// ───── Welcome — destinos ─────
function renderDestinos(filter = '') {
  const grid = $('#destinos-grid');
  const norm = filter.trim().toLowerCase();
  grid.innerHTML = getDestinos()
    .filter(d => !norm || d.nome.toLowerCase().includes(norm))
    .map(d => {
      const bg = d.capaUrl
        ? `style="background-image:url('${d.capaUrl}')"`
        : `style="background: linear-gradient(135deg, ${d.paletaFaixa}33, ${d.paletaFaixa}11)"`;
      return `
        <div class="destino-card ${!d.disponivel ? 'disabled' : ''}" data-id="${d.id}">
          <div class="destino-foto" ${bg}></div>
          <div class="destino-info">
            <h3>${escapeHtml(d.nome)}</h3>
            <p>${escapeHtml(d.subtitulo)}</p>
          </div>
          ${!d.disponivel ? '<div class="em-breve">Em breve</div>' : ''}
        </div>`;
    }).join('');
  $$('#destinos-grid .destino-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.id;
      const d = getDestinos().find(x => x.id === id);
      if (!d?.disponivel) return;
      pickDestino(id);
    });
  });
}

async function pickDestino(id) {
  const d = getDestinos().find(x => x.id === id);
  if (!d) return;
  showLoader('Carregando destino...');
  try {
    const slides = await buildSlidesForDestino(d);
    state.destinoId = id;
    state.destino = d;                  // <- guarda destino completo (com _raw)
    state.slides = JSON.parse(JSON.stringify(slides));
    state.activeSlideIdx = 0;
    state.generated = null;
    state.uniformScale = null;
    hideLoader();
    setView('editor');
    renderEditor();
  } catch (err) {
    hideLoader();
    alert('Erro ao carregar destino: ' + err.message);
    console.error(err);
  }
}

// ───── Editor canvas ─────
function renderEditor() {
  $('#editor-title').textContent = getDestinos().find(d => d.id === state.destinoId)?.nome || '—';
  syncCanvasFormatToggle();
  prefitAllSlides().then(() => {
    renderCanvas();
    renderStrip();
    renderLayoutPicker();
    updateNavArrows();
  });
}

// Layout picker — entre canvas e strip. Não aparece em slides do tipo capa.
function renderLayoutPicker() {
  const picker = $('#layout-picker');
  const slide = state.slides[state.activeSlideIdx];
  if (!slide || slide.layoutId === 'capa') { picker.innerHTML = ''; return; }
  picker.innerHTML = `
    <span class="lp-label">Layout</span>
    ${MOCK_LAYOUTS.map(l => `
      <button data-layout="${l.id}" class="${slide.layoutId === l.id ? 'active' : ''}">${l.label}</button>
    `).join('')}
  `;
  picker.querySelectorAll('button[data-layout]').forEach(btn => {
    btn.addEventListener('click', () => {
      slide.layoutId = btn.dataset.layout;
      // Layout muda → precisa re-prefit pra padronização atualizar
      prefitAllSlides().then(() => {
        renderCanvas();
        renderStrip();
        renderLayoutPicker();
      });
    });
  });
}

function updateNavArrows() {
  const prev = $('#nav-prev'), next = $('#nav-next');
  if (!prev || !next) return;
  prev.disabled = state.activeSlideIdx === 0;
  next.disabled = state.activeSlideIdx === state.slides.length - 1;
}

function goToSlide(idx) {
  if (idx < 0 || idx >= state.slides.length) return;
  state.activeSlideIdx = idx;
  renderCanvas();
  renderStrip();
  renderLayoutPicker();
  updateNavArrows();
  // sheets de texto/foto atualizam pro novo slide
  if (state.openSheet === 'texto') renderSheetTexto();
  if (state.openSheet === 'foto')  renderSheetFoto();
}

// Pré-mede os 8 slides em 1080px (invisivelmente), calcula o fator de redução
// necessário pra cada categoria de texto, e salva o MENOR fator por formato.
// Esse fator é aplicado em todos os slides do mesmo formato → padronização visual.
// No story, laterais (esq/dir) usam o MESMO layout visual de foto-cima.
// Função que retorna o "layout efetivo" pra agrupamento de padronização.
function effectiveLayout(layoutId, formato) {
  if (formato === 'story' && (layoutId === 'lateral-esq' || layoutId === 'lateral-dir')) {
    return 'foto-cima';
  }
  return layoutId;
}

async function prefitAllSlides() {
  const template = MOCK_TEMPLATES.find(t => t.id === state.templateId);
  const bay = $('#render-bay');
  bay.innerHTML = '';
  const next = { carrossel: {}, story: {} };

  try {
    for (const formato of ['carrossel', 'story']) {
      // Agrupa slides por layoutId — padronização é POR LAYOUT dentro de cada formato
      // (pra não penalizar capa com fator de foto-cima, etc.)
      const byLayout = {};   // layoutId → [{ node, byCat }]
      const allNodes = [];
      for (let i = 0; i < state.slides.length; i++) {
        const slide = state.slides[i];
        const wrap = document.createElement('div');
        wrap.innerHTML = buildSlideHtml(slide, template, formato, i + 1, state.slides.length);
        const node = wrap.firstElementChild;
        node.style.width = '1080px';
        node.style.aspectRatio = formato === 'story' ? '9 / 16' : '4 / 5';
        bay.appendChild(node);
        const byCat = {};
        ['text-hand','text-titulo','text-desc'].forEach(cat => {
          const el = node.querySelector(`.${cat}`);
          if (el) byCat[cat] = parseFloat(getComputedStyle(el).fontSize);
        });
        const lid = effectiveLayout(slide.layoutId || 'foto-cima', formato);
        (byLayout[lid] ??= []).push({ node, byCat });
        allNodes.push(node);
      }
      await Promise.all(allNodes.map(waitForImages));
      await new Promise(r => requestAnimationFrame(r));
      allNodes.forEach(fitSlideContentRaw);

      // Pra cada layout, calcula minFactor entre slides daquele layout
      for (const lid in byLayout) {
        const group = byLayout[lid];
        next[formato][lid] = {};
        ['text-hand','text-titulo','text-desc'].forEach(cat => {
          let minFactor = 1;
          group.forEach(({ node, byCat }) => {
            const el = node.querySelector(`.${cat}`);
            if (!el || !byCat[cat]) return;
            const fitted = parseFloat(getComputedStyle(el).fontSize);
            const factor = fitted / byCat[cat];
            if (factor < minFactor) minFactor = factor;
          });
          next[formato][lid][cat] = minFactor;
        });
      }

      allNodes.forEach(n => bay.removeChild(n));
    }
    state.uniformScale = next;
  } catch (err) {
    console.warn('[prefitAllSlides] falhou, usando fit individual:', err);
    state.uniformScale = null;
    bay.innerHTML = '';
  }
}

// Toggle Carrossel/Story do canvas deve refletir os formatos selecionados
// no sheet "Formato". Esconde quando só tem 1 formato.
function syncCanvasFormatToggle() {
  const wrap = $('.canvas-format-toggle');
  const buttons = $$('.canvas-format-toggle button');

  // Se o formato sendo visualizado não está mais selecionado, troca pro 1º disponível
  if (!state.formatos.has(state.previewFormato)) {
    state.previewFormato = [...state.formatos][0] || 'carrossel';
  }

  // Esconde o toggle inteiro se só tem 1 formato — não há escolha a fazer
  wrap.style.display = state.formatos.size <= 1 ? 'none' : '';

  // Esconde os botões dos formatos não selecionados
  buttons.forEach(b => {
    b.style.display = state.formatos.has(b.dataset.fmt) ? '' : 'none';
    b.classList.toggle('active', b.dataset.fmt === state.previewFormato);
  });
}

function renderCanvas() {
  const slide = state.slides[state.activeSlideIdx];
  if (!slide) { $('#canvas-preview').innerHTML = ''; return; }
  const template = MOCK_TEMPLATES.find(t => t.id === state.templateId);
  $('#canvas-preview').innerHTML = buildSlideHtml(slide, template, state.previewFormato, state.activeSlideIdx + 1, state.slides.length);
  const slideNode = $('#canvas-preview .slide-render');
  if (slideNode) requestAnimationFrame(() => fitSlideContent(slideNode));
  wireEditInPlace();
}

// ───── Auto-fit ─────
// Aplica uniformScale específico do (formato, layoutId), depois raw como rede de segurança.
function fitSlideContent(slideNode) {
  const formato  = slideNode.classList.contains('story') ? 'story' : 'carrossel';
  const rawLayout = slideNode.getAttribute('data-layout') || 'foto-cima';
  const layoutId = effectiveLayout(rawLayout, formato);
  const scales = state.uniformScale?.[formato]?.[layoutId];
  const hasScales = scales && Object.keys(scales).length > 0;

  // Reset
  slideNode.querySelectorAll('.slot-text').forEach(el => { el.style.fontSize = ''; });

  if (hasScales) {
    Object.entries(scales).forEach(([cat, factor]) => {
      slideNode.querySelectorAll(`.${cat}`).forEach(el => {
        const baseFs = parseFloat(getComputedStyle(el).fontSize);
        el.style.fontSize = (baseFs * factor) + 'px';
      });
    });
  }

  // Raw como rede de seguranca (só reduz se estourar)
  fitSlideContentRawOverlay(slideNode);
}

// Passa raw mas SEM resetar fontes (mantém o que uniform aplicou)
function fitSlideContentRawOverlay(slideNode) {
  const looseTexts = [...slideNode.querySelectorAll('.slot-text')].filter(el => !el.closest('.slot-text-block'));
  looseTexts.forEach(fitTextHorizontal);
  slideNode.querySelectorAll('.slot-text-block').forEach(fitTextBlock);
}

// Fit individual cru — usado pelo prefit pra MEDIR o que cada slide precisa
function fitSlideContentRaw(slideNode) {
  slideNode.querySelectorAll('.slot-text').forEach(el => { el.style.fontSize = ''; });
  const looseTexts = [...slideNode.querySelectorAll('.slot-text')].filter(el => !el.closest('.slot-text-block'));
  looseTexts.forEach(fitTextHorizontal);
  slideNode.querySelectorAll('.slot-text-block').forEach(fitTextBlock);
}

function fitTextHorizontal(el) {
  let fontPx = parseFloat(getComputedStyle(el).fontSize);
  const minPx = fontPx * 0.4;       // limite: 40% do original (acomoda CONSTANTINOPLA)
  let i = 0;
  while (el.scrollWidth > el.clientWidth + 1 && fontPx > minPx && i++ < 80) {
    fontPx -= 1;
    el.style.fontSize = fontPx + 'px';
  }
}

function fitTextBlock(block) {
  const children = [...block.querySelectorAll('.slot-text')];
  if (!children.length) return;
  const originals = children.map(el => parseFloat(getComputedStyle(el).fontSize));

  // Primeiro: reduzir cada texto INDIVIDUAL pra caber horizontalmente
  children.forEach(fitTextHorizontal);

  // Depois: reduzir TODOS proporcionalmente pra caber verticalmente
  let factor = 1;
  let i = 0;
  while (block.scrollHeight > block.clientHeight + 1 && factor > 0.5 && i++ < 30) {
    factor -= 0.04;
    children.forEach((el, idx) => {
      el.style.fontSize = (originals[idx] * factor) + 'px';
    });
    // re-fit horizontal de cada um após shrink
    children.forEach(fitTextHorizontal);
  }
}

// Edit-in-place: clica num texto do slide → digita direto. Sincroniza com state
// e atualiza strip / sheet de texto sem rerender do canvas (não tirar foco).
function wireEditInPlace() {
  $$('#canvas-preview .slot-text').forEach(el => {
    el.setAttribute('contenteditable', 'true');
    el.spellcheck = false;
    el.addEventListener('input', onSlotEdit);
    el.addEventListener('keydown', e => {
      // Enter no titulo/hand = blur em vez de quebrar linha
      if (e.key === 'Enter' && !el.classList.contains('text-desc')) {
        e.preventDefault();
        el.blur();
      }
    });
    el.addEventListener('blur', () => {
      // remove HTML colado (estilo do clipboard) — mantém texto puro
      if (el.innerHTML !== el.textContent) el.textContent = el.textContent;
    });
  });
}

let _reprefitTimer = null;
function onSlotEdit(e) {
  const el = e.currentTarget;
  const slide = state.slides[state.activeSlideIdx];
  if (!slide) return;
  const text = el.textContent;
  const field = el.dataset.field;
  const isCapa = slide.layoutId === 'capa';

  if (field === 'hand')   slide[isCapa ? 'titulo' : 'nome']   = text;
  if (field === 'titulo') slide[isCapa ? 'nome'   : 'titulo'] = text;
  if (field === 'desc')   slide.descricao = text;

  // Re-fit do slide ao vivo (preserva cursor — só altera fontSize)
  const slideNode = $('#canvas-preview .slide-render');
  if (slideNode) fitSlideContent(slideNode);

  // Re-prefit DEBOUNCED: recalcula escala uniforme após 400ms parado
  clearTimeout(_reprefitTimer);
  _reprefitTimer = setTimeout(async () => {
    await prefitAllSlides();
    // Re-aplica no slide atual sem rerender
    const cur = $('#canvas-preview .slide-render');
    if (cur) fitSlideContent(cur);
  }, 400);

  renderStrip();

  // Se sheet texto está aberto, atualiza inputs sem rerender o sheet
  if (state.openSheet === 'texto') {
    const inputHand   = $('#ed-hand');
    const inputTitulo = $('#ed-titulo');
    const inputDesc   = $('#ed-desc');
    if (field === 'hand'   && inputHand   && document.activeElement !== inputHand)   inputHand.value   = text;
    if (field === 'titulo' && inputTitulo && document.activeElement !== inputTitulo) inputTitulo.value = text;
    if (field === 'desc'   && inputDesc   && document.activeElement !== inputDesc)   inputDesc.value   = text;
  }
}

function renderStrip() {
  const strip = $('#slide-strip');
  strip.innerHTML = state.slides.map((s, i) => `
    <div class="slide-strip-item ${i === state.activeSlideIdx ? 'active' : ''}"
         data-idx="${i}"
         style="background-image:url('${s.fotoUrl || ''}')"
         title="Slide ${i + 1}: ${escapeHtml(s.nome || '')}">
      <span class="slide-num">${i + 1}</span>
    </div>
  `).join('');
  $$('#slide-strip .slide-strip-item').forEach(el => {
    el.addEventListener('click', () => goToSlide(Number(el.dataset.idx)));
  });
  // scroll pra centralizar o ativo
  const active = $('#slide-strip .slide-strip-item.active');
  if (active) active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

// ───── Slide HTML builder ─────
// Slots: foto, sólidos, e .slot-text-block (flex column com gap padrão).
// O bloco flex evita sobreposições — quando um texto quebra em 2 linhas,
// o próximo desce automaticamente.
// Exceção: capa usa textos soltos (hand atravessa a divisão, título alinhado à base).
function buildSlideHtml(slide, template, formato, slideNum = 1, slideTotal = 8) {
  const cor = template?.cor || '#2BA9A7';
  const layout = slide.layoutId || 'foto-cima';
  const fmtClass = formato === 'story' ? 'story' : '';
  const isCapa = layout === 'capa';

  const hand   = isCapa ? (slide.titulo || 'Tudo sobre') : (slide.nome || '');
  const titulo = isCapa ? (slide.nome || '')             : (slide.titulo || '');
  const desc   = slide.descricao || '';

  const base = `
      <div class="slot-photo" style="background-image:url('${slide.fotoUrl || ''}')"></div>
      <div class="slot-solid solid-primary"></div>
      <div class="slot-solid solid-accent"></div>`;

  if (isCapa) {
    // Capa: hand e titulo são posicionados separadamente (hand atravessa a divisão)
    return `
      <div class="slide-render ${fmtClass}" data-layout="capa" style="--kit-color:${cor}">
        ${base}
        <div class="slot-text text-hand" data-field="hand">${escapeHtml(hand)}</div>
        <div class="slot-text text-titulo" data-field="titulo">${escapeHtml(titulo)}</div>
      </div>`;
  }

  // Demais layouts: textos vão num block flex (gap garante espaçamento uniforme)
  return `
    <div class="slide-render ${fmtClass}" data-layout="${escapeHtml(layout)}" style="--kit-color:${cor}">
      ${base}
      <div class="slot-text-block">
        <div class="slot-text text-hand" data-field="hand">${escapeHtml(hand)}</div>
        <div class="slot-text text-titulo" data-field="titulo">${escapeHtml(titulo)}</div>
        ${desc ? `<div class="slot-text text-desc" data-field="desc">${escapeHtml(desc)}</div>` : ''}
      </div>
    </div>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ───── Bottom sheets ─────
function openSheet(name) {
  closeSheet(); // garante que só 1 aberto
  state.openSheet = name;
  $$('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === name));
  $('#sheet-backdrop').classList.add('show');
  $(`#sheet-${name}`).classList.add('show');
  // popula conteúdo dinâmico
  if (name === 'formato') renderSheetFormato();
  if (name === 'estilo')  renderSheetEstilo();
  if (name === 'texto')   renderSheetTexto();
  if (name === 'foto')    renderSheetFoto();
  if (name === 'baixar')  renderSheetBaixar();
}

function closeSheet() {
  if (!state.openSheet) return;
  $(`#sheet-${state.openSheet}`).classList.remove('show');
  $('#sheet-backdrop').classList.remove('show');
  $$('.tool-btn').forEach(b => b.classList.remove('active'));
  state.openSheet = null;
}

// ──── Sheet: Formato ────
function renderSheetFormato() {
  const body = $('#sheet-formato-body');
  body.innerHTML = `<div class="sheet-list">${
    MOCK_FORMATOS.map(f => `
      <div class="sheet-item ${state.formatos.has(f.id) ? 'selected' : ''} ${!f.disponivel ? 'disabled' : ''}" data-id="${f.id}">
        <div class="sheet-item-content">
          <h4>${escapeHtml(f.label)}</h4>
          <p>${escapeHtml(f.descricao)}</p>
        </div>
        ${f.disponivel ? '<div class="sheet-item-check"></div>' : '<span class="sheet-item-tag">Em breve</span>'}
      </div>
    `).join('')
  }</div>`;
  $$('#sheet-formato-body .sheet-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const f = MOCK_FORMATOS.find(x => x.id === id);
      if (!f?.disponivel) return;
      if (state.formatos.has(id)) state.formatos.delete(id);
      else state.formatos.add(id);
      // ao menos 1 selecionado
      if (state.formatos.size === 0) state.formatos.add(id);
      renderSheetFormato();
      syncCanvasFormatToggle();
      renderCanvas();
    });
  });
}

// ──── Sheet: Estilo ────
function renderSheetEstilo() {
  const body = $('#sheet-estilo-body');
  body.innerHTML = `<div class="sheet-list">${
    MOCK_TEMPLATES.map(t => `
      <div class="sheet-item ${state.templateId === t.id ? 'selected' : ''} ${!t.disponivel ? 'disabled' : ''}" data-id="${t.id}">
        <div class="sheet-item-swatch" style="background:${t.cor}"></div>
        <div class="sheet-item-content">
          <h4>${escapeHtml(t.label)}</h4>
          <p>${escapeHtml(t.descricao)}</p>
        </div>
        ${t.disponivel ? '<div class="sheet-item-check"></div>' : '<span class="sheet-item-tag">Em breve</span>'}
      </div>
    `).join('')
  }</div>`;
  $$('#sheet-estilo-body .sheet-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      const t = MOCK_TEMPLATES.find(x => x.id === id);
      if (!t?.disponivel) return;
      state.templateId = id;
      renderSheetEstilo();
      renderCanvas();
    });
  });
}

// ──── Sheet: Texto ────
// Limites suaves: avisa mas não bloqueia. Acima do limite → contador laranja → vermelho.
const TEXT_LIMITS = { hand: 16, titulo: 30, desc: 200 };

function renderSheetTexto() {
  const slide = state.slides[state.activeSlideIdx];
  $('#sheet-texto-sub').textContent = `(${state.activeSlideIdx + 1}/${state.slides.length})`;
  if (!slide) { $('#sheet-texto-body').innerHTML = ''; return; }
  const isCapa = slide.layoutId === 'capa';
  const handVal   = isCapa ? (slide.titulo || '') : (slide.nome || '');
  const tituloVal = isCapa ? (slide.nome || '')   : (slide.titulo || '');
  const descVal   = slide.descricao || '';

  $('#sheet-texto-body').innerHTML = `
    <div class="sheet-field">
      <label>${isCapa ? 'Frase manuscrita' : 'Nome (manuscrito)'} ${charCounter(handVal.length, TEXT_LIMITS.hand, 'hand')}</label>
      <input id="ed-hand" value="${escapeHtml(handVal)}" />
    </div>
    <div class="sheet-field">
      <label>${isCapa ? 'Destaque (caixa-alta)' : 'Título (caixa-alta)'} ${charCounter(tituloVal.length, TEXT_LIMITS.titulo, 'titulo')}</label>
      <input id="ed-titulo" value="${escapeHtml(tituloVal)}" />
    </div>
    ${isCapa ? '' : `
      <div class="sheet-field">
        <label>Descrição ${charCounter(descVal.length, TEXT_LIMITS.desc, 'desc')}</label>
        <textarea id="ed-desc">${escapeHtml(descVal)}</textarea>
      </div>
    `}
  `;

  const updateAndRender = () => { renderCanvas(); renderStrip(); };

  $('#ed-hand').addEventListener('input', e => {
    if (isCapa) slide.titulo = e.target.value;
    else slide.nome = e.target.value;
    updateCharCounter('hand', e.target.value.length);
    updateAndRender();
  });
  $('#ed-titulo').addEventListener('input', e => {
    if (isCapa) slide.nome = e.target.value;
    else slide.titulo = e.target.value;
    updateCharCounter('titulo', e.target.value.length);
    updateAndRender();
  });
  if ($('#ed-desc')) $('#ed-desc').addEventListener('input', e => {
    slide.descricao = e.target.value;
    updateCharCounter('desc', e.target.value.length);
    updateAndRender();
  });
}

function charCounter(len, max, key) {
  const cls = len > max * 1.25 ? 'way-over' : (len > max ? 'over' : '');
  return `<span class="char-counter ${cls}" data-counter="${key}" data-max="${max}">${len}/${max}</span>`;
}

function updateCharCounter(key, len) {
  const el = $(`[data-counter="${key}"]`);
  if (!el) return;
  const max = Number(el.dataset.max);
  el.textContent = `${len}/${max}`;
  el.classList.toggle('over', len > max && len <= max * 1.25);
  el.classList.toggle('way-over', len > max * 1.25);
}

// ──── Sheet: Foto ────
function renderSheetFoto() {
  $('#sheet-foto-sub').textContent = `(${state.activeSlideIdx + 1}/${state.slides.length})`;
  const slide = state.slides[state.activeSlideIdx];
  if (!slide) { $('#sheet-foto-body').innerHTML = ''; return; }
  $('#sheet-foto-body').innerHTML = `
    <div class="foto-tabs">
      <button class="foto-tab ${state.fotoTab === 'curadas' ? 'active' : ''}" data-tab="curadas">Banco curado</button>
      <button class="foto-tab ${state.fotoTab === 'upload' ? 'active' : ''}" data-tab="upload">Upload meu</button>
      <button class="foto-tab" data-tab="unsplash" disabled>Unsplash <small>(em breve)</small></button>
    </div>
    <div id="foto-tab-panel"></div>
  `;
  $$('#sheet-foto-body .foto-tab').forEach(btn => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => { state.fotoTab = btn.dataset.tab; renderSheetFoto(); });
  });
  renderFotoTabPanel();
}

function renderFotoTabPanel() {
  const slide = state.slides[state.activeSlideIdx];
  const panel = $('#foto-tab-panel');
  if (state.fotoTab === 'curadas') {
    const counts = getBancoCuradoCounts(state.destino);
    const totalAll = counts.todas || 0;

    if (totalAll === 0) {
      panel.innerHTML = `
        <p style="color:var(--ink-soft);font-size:14px;text-align:center;padding:24px 0">
          Sem fotos curadas pra este destino ainda.
          <br><span style="font-size:12px">Cadastre em <em>Serviços → Banco de Imagens</em>.</span>
        </p>`;
      return;
    }

    // Sub-abas de categoria (Destinos / Hotéis / Restaurantes / Trens / Cruzeiros)
    const catTabsHtml = `
      <div class="banco-cat-tabs">
        ${PICKER_CATEGORIAS
          .filter(c => c.key === 'todas' || counts[c.key] > 0)
          .map(c => `
            <button class="banco-cat-tab ${state.bancoCategoria === c.key ? 'active' : ''}" data-cat="${c.key}">
              <span>${c.icon}</span>
              <span>${c.label}</span>
              <span class="banco-cat-count">${counts[c.key] || 0}</span>
            </button>
          `).join('')}
      </div>
    `;

    const fotos = getBancoCurado();
    const gridHtml = fotos.length
      ? `<div class="curadas-grid">${
          fotos.map(f => `
            <div class="curada-thumb ${slide.fotoUrl === f.url ? 'selected' : ''}" data-url="${f.url}" style="background-image:url('${f.url}')" title="${escapeHtml(f.nome)}"></div>
          `).join('')
        }</div>`
      : `<p style="color:var(--ink-soft);font-size:13px;text-align:center;padding:16px 0">Sem fotos nesta categoria pra este destino.</p>`;

    panel.innerHTML = catTabsHtml + gridHtml;

    // Wire das sub-abas
    panel.querySelectorAll('.banco-cat-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        state.bancoCategoria = btn.dataset.cat;
        renderFotoTabPanel();
      });
    });

    // Wire dos thumbs (já renderizados em catTabsHtml + gridHtml acima)
    panel.querySelectorAll('.curada-thumb').forEach(el => {
      el.addEventListener('click', () => {
        slide.fotoUrl = el.dataset.url;
        renderCanvas(); renderStrip(); renderFotoTabPanel();
      });
    });
  } else if (state.fotoTab === 'upload') {
    panel.innerHTML = `
      <label class="upload-area">
        📷 Toque para escolher uma foto do seu celular
        <input type="file" accept="image/*" id="upload-input" />
      </label>
      <div class="upload-hint">Sua imagem fica só com você — não vai pro banco curado.</div>
    `;
    $('#upload-input').addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file) return;
      slide.fotoUrl = URL.createObjectURL(file);
      renderCanvas(); renderStrip();
    });
  }
}

// ──── Sheet: Baixar ────
async function renderSheetBaixar() {
  const body = $('#sheet-baixar-body');
  const destino = getDestinos().find(d => d.id === state.destinoId);
  const formatos = [...state.formatos].map(id => MOCK_FORMATOS.find(f => f.id === id).label).join(' + ');
  const total = state.formatos.size * state.slides.length;

  body.innerHTML = `
    <div class="baixar-summary">
      <h4>Resumo</h4>
      <p><strong>${escapeHtml(destino?.nome || '')}</strong> · ${escapeHtml(formatos)} · ${total} imagens</p>
    </div>
    <div class="baixar-actions">
      ${!state.generated ? `<button id="btn-generate" class="btn-primary">Gerar artes (${total})</button>` : `
        <button id="btn-download-all" class="btn-primary">${isMobile() ? '📲 Compartilhar/Salvar tudo' : '⬇ Baixar pack (.zip)'}</button>
        <button id="btn-regen" class="btn-secondary">Gerar novamente</button>
      `}
    </div>
    <div id="thumbs-list"></div>
  `;

  if (state.generated) renderGeneratedThumbs(state.generated);

  $('#btn-generate')?.addEventListener('click', () => generateAllImages());
  $('#btn-regen')?.addEventListener('click', () => { state.generated = null; renderSheetBaixar(); });
  $('#btn-download-all')?.addEventListener('click', downloadAll);
}

function renderGeneratedThumbs(generated) {
  $('#thumbs-list').innerHTML = `
    <h4 style="margin:18px 0 8px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-soft)">Suas artes</h4>
    <div class="thumbs-grid">
      ${generated.map(g => `
        <div class="thumb-download ${g.formato === 'story' ? 'story' : ''}">
          <img src="${g.dataUrl}" alt="${g.filename}" />
          <div class="thumb-meta">
            <span>${g.filename.split('_').slice(-1)[0].replace('.png','')}</span>
            <a href="${g.dataUrl}" download="${g.filename}">Baixar</a>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

async function generateAllImages() {
  showLoader('Gerando artes... isso leva alguns segundos.');
  const template = MOCK_TEMPLATES.find(t => t.id === state.templateId);
  const bay = $('#render-bay');
  bay.innerHTML = '';
  const generated = [];

  try {
    // ─── Fase 1: criar todos os nodes, esperar imagens, auto-fit individual ───
    const items = [];   // { node, slide, i, formato }
    for (const formato of state.formatos) {
      for (let i = 0; i < state.slides.length; i++) {
        const slide = state.slides[i];
        const wrap = document.createElement('div');
        wrap.innerHTML = buildSlideHtml(slide, template, formato, i + 1, state.slides.length);
        const node = wrap.firstElementChild;
        node.style.width = '1080px';
        node.style.aspectRatio = formato === 'story' ? '9 / 16' : '4 / 5';
        bay.appendChild(node);
        items.push({ node, slide, i, formato });
      }
    }
    await Promise.all(items.map(it => waitForImages(it.node)));
    await new Promise(r => requestAnimationFrame(r));

    // Garante que uniformScale está atualizado (caso textos tenham mudado desde renderEditor)
    await prefitAllSlides();

    // Re-cria os items porque prefitAllSlides limpa a bay
    bay.innerHTML = '';
    items.length = 0;
    for (const formato of state.formatos) {
      for (let i = 0; i < state.slides.length; i++) {
        const slide = state.slides[i];
        const wrap = document.createElement('div');
        wrap.innerHTML = buildSlideHtml(slide, template, formato, i + 1, state.slides.length);
        const node = wrap.firstElementChild;
        node.style.width = '1080px';
        node.style.aspectRatio = formato === 'story' ? '9 / 16' : '4 / 5';
        bay.appendChild(node);
        items.push({ node, slide, i, formato });
      }
    }
    await Promise.all(items.map(it => waitForImages(it.node)));
    await new Promise(r => requestAnimationFrame(r));
    items.forEach(it => fitSlideContent(it.node));

    // ─── Fase 3: html2canvas → PNG ───
    for (const it of items) {
      const canvas = await html2canvas(it.node, { useCORS: true, scale: 1, backgroundColor: null });
      const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      generated.push({
        blob,
        filename: `${state.destinoId}_${it.formato}_${String(it.i + 1).padStart(2, '0')}.png`,
        dataUrl: canvas.toDataURL('image/png'),
        formato: it.formato,
      });
      bay.removeChild(it.node);
    }

    state.generated = generated;
    hideLoader();
    renderSheetBaixar();
  } catch (err) {
    hideLoader();
    alert('Erro ao gerar artes: ' + err.message);
    console.error(err);
  }
}

// (fitAllUniformly removido — uniformScale calculada em prefitAllSlides
//  já é aplicada pelo fitSlideContent, então não precisa de 2ª passagem.)

async function downloadAll() {
  if (!state.generated?.length) return;
  if (isMobile()) return shareOnMobile();

  showLoader('Empacotando arquivos...');
  const zip = new JSZip();
  for (const g of state.generated) zip.file(g.filename, g.blob);
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `artes-${state.destinoId}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  hideLoader();
}

async function shareOnMobile() {
  const files = state.generated.map(g => new File([g.blob], g.filename, { type: 'image/png' }));
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files, title: `Artes ${state.destinoId}` }); }
    catch (e) { if (e.name !== 'AbortError') alert('Não foi possível compartilhar: ' + e.message); }
  } else {
    alert('Seu dispositivo não suporta compartilhar todas de uma vez. Use o botão "Baixar" em cada imagem abaixo.');
  }
}

function isMobile() { return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent); }

function waitForImages(node) {
  const bgs = [...node.querySelectorAll('[style*="background-image"]')]
    .map(el => {
      const m = el.style.backgroundImage.match(/url\(["']?(.+?)["']?\)/);
      return m ? m[1] : null;
    }).filter(Boolean);
  // Timeout 4s por imagem — se picsum demora, segue sem travar o prefit
  return Promise.all(bgs.map(url => new Promise(res => {
    const img = new Image();
    const t = setTimeout(res, 4000);
    img.onload = img.onerror = () => { clearTimeout(t); res(); };
    img.src = url;
  })));
}

function showLoader(text) { $('#loader-text').textContent = text || 'Carregando...'; $('#loader').classList.add('show'); }
function hideLoader() { $('#loader').classList.remove('show'); }

// ───── Init wizard (substitui o DOMContentLoaded standalone) ─────
let _onCloseCb = null;
let _keydownHandler = null;

async function initWizard() {
  // Carrega destinos do Portal de Dicas antes de renderizar a tela welcome
  showLoader('Carregando destinos do Portal de Dicas...');
  try {
    _destinos = await fetchDestinos();
  } catch (err) {
    console.error('[artsByDestino] erro ao carregar destinos:', err);
    _destinos = [];
  }
  hideLoader();
  renderDestinos();

  if (!_destinos.length) {
    $('#destinos-grid').innerHTML = `
      <div style="grid-column:1/-1;padding:32px;text-align:center;color:var(--ink-soft)">
        <p style="margin:0">Nenhum destino cadastrado no Portal de Dicas ainda.</p>
        <p style="font-size:13px;margin-top:6px">Cadastre destinos em <em>Serviços → Portal de Dicas</em>.</p>
      </div>`;
  }

  $('#search-input').addEventListener('input', e => renderDestinos(e.target.value));
  $('#btn-back-welcome').addEventListener('click', () => setView('welcome'));
  $('#btn-menu').addEventListener('click', () => alert('Menu (em breve): salvar rascunho, ajuda, sair.'));

  $$('.tool-btn').forEach(b => {
    b.addEventListener('click', () => {
      const tool = b.dataset.tool;
      if (state.openSheet === tool) closeSheet();
      else openSheet(tool);
    });
  });

  $$('.canvas-format-toggle button').forEach(b => {
    b.addEventListener('click', () => {
      state.previewFormato = b.dataset.fmt;
      $$('.canvas-format-toggle button').forEach(x => x.classList.toggle('active', x === b));
      renderCanvas();
    });
  });

  $('#nav-prev')?.addEventListener('click', () => goToSlide(state.activeSlideIdx - 1));
  $('#nav-next')?.addEventListener('click', () => goToSlide(state.activeSlideIdx + 1));

  // Keydown: setas + Esc — guardar handler pra remover no close
  _keydownHandler = (e) => {
    if (e.key === 'Escape') {
      if (state.openSheet) return closeSheet();
      return closeArtsByDestino();
    }
    if (state.view !== 'editor' || state.openSheet) return;
    if (e.target.matches('input, textarea, [contenteditable="true"]')) return;
    if (e.key === 'ArrowLeft')  goToSlide(state.activeSlideIdx - 1);
    if (e.key === 'ArrowRight') goToSlide(state.activeSlideIdx + 1);
  };
  document.addEventListener('keydown', _keydownHandler);

  $('#sheet-backdrop').addEventListener('click', closeSheet);
  $$('.sheet-close').forEach(b => b.addEventListener('click', closeSheet));
}

// ───── HTML do wizard (injetado no overlay) ─────
const OVERLAY_HTML = `
  <button class="gi-ic-close" type="button" aria-label="Fechar">✕</button>

  <section class="view active" id="view-welcome">
    <header class="welcome-header">
      <div class="welcome-title-wrap">
        <h1>Crie suas artes</h1>
        <p>Escolha o destino que você vai divulgar.</p>
      </div>
    </header>
    <div class="welcome-content">
      <div class="search-bar">
        <span style="font-size:18px">🔍</span>
        <input id="search-input" placeholder="Busque por destino..." />
      </div>
      <div class="destinos-grid" id="destinos-grid"></div>
    </div>
  </section>

  <section class="view" id="view-editor">
    <header class="editor-header">
      <button class="btn-icon" id="btn-back-welcome" aria-label="Trocar destino">←</button>
      <div class="editor-title" id="editor-title">—</div>
      <button class="btn-icon" id="btn-menu" aria-label="Menu">⋮</button>
    </header>
    <main class="editor-canvas">
      <div class="canvas-stage">
        <div class="canvas-format-toggle">
          <button data-fmt="carrossel" class="active">Carrossel</button>
          <button data-fmt="story">Story</button>
        </div>
        <button class="nav-arrow nav-prev" id="nav-prev" aria-label="Slide anterior">←</button>
        <div id="canvas-preview"></div>
        <button class="nav-arrow nav-next" id="nav-next" aria-label="Próximo slide">→</button>
      </div>
      <div class="layout-picker" id="layout-picker"></div>
      <div class="slide-strip-wrap"><div class="slide-strip" id="slide-strip"></div></div>
    </main>
    <nav class="editor-toolbar">
      <button data-tool="formato" class="tool-btn"><span class="tool-ico">◫</span><span class="tool-lbl">Formato</span></button>
      <button data-tool="estilo"  class="tool-btn"><span class="tool-ico">🎨</span><span class="tool-lbl">Estilo</span></button>
      <button data-tool="texto"   class="tool-btn"><span class="tool-ico">✏️</span><span class="tool-lbl">Texto</span></button>
      <button data-tool="foto"    class="tool-btn"><span class="tool-ico">📷</span><span class="tool-lbl">Foto</span></button>
      <button data-tool="baixar"  class="tool-btn tool-cta"><span class="tool-ico">⬇</span><span class="tool-lbl">Baixar</span></button>
    </nav>
  </section>

  <div class="sheet-backdrop" id="sheet-backdrop"></div>
  <div class="bottom-sheet" id="sheet-formato">
    <div class="sheet-handle"></div>
    <div class="sheet-header"><h3>Formatos para gerar</h3><button class="btn-icon sheet-close">✕</button></div>
    <div class="sheet-body" id="sheet-formato-body"></div>
  </div>
  <div class="bottom-sheet" id="sheet-estilo">
    <div class="sheet-handle"></div>
    <div class="sheet-header"><h3>Estilo visual</h3><button class="btn-icon sheet-close">✕</button></div>
    <div class="sheet-body" id="sheet-estilo-body"></div>
  </div>
  <div class="bottom-sheet" id="sheet-texto">
    <div class="sheet-handle"></div>
    <div class="sheet-header"><h3>Texto do slide <span class="sheet-sub" id="sheet-texto-sub"></span></h3><button class="btn-icon sheet-close">✕</button></div>
    <div class="sheet-body" id="sheet-texto-body"></div>
  </div>
  <div class="bottom-sheet" id="sheet-foto">
    <div class="sheet-handle"></div>
    <div class="sheet-header"><h3>Foto do slide <span class="sheet-sub" id="sheet-foto-sub"></span></h3><button class="btn-icon sheet-close">✕</button></div>
    <div class="sheet-body" id="sheet-foto-body"></div>
  </div>
  <div class="bottom-sheet bottom-sheet-tall" id="sheet-baixar">
    <div class="sheet-handle"></div>
    <div class="sheet-header"><h3>Baixar artes</h3><button class="btn-icon sheet-close">✕</button></div>
    <div class="sheet-body" id="sheet-baixar-body"></div>
  </div>

  <div class="loader-overlay" id="loader">
    <div class="spinner"></div>
    <div class="loader-text" id="loader-text">Carregando...</div>
  </div>
  <div class="render-bay" id="render-bay" aria-hidden="true"></div>
`;

// ───── Dependências externas (html2canvas + JSZip + Caveat font) ─────
function loadScriptOnce(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}
function loadCssOnce(href, id) {
  if (id && document.getElementById(id)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href; if (id) l.id = id;
  document.head.appendChild(l);
}
async function loadDeps() {
  loadCssOnce('https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&display=swap', 'gi-ic-caveat');
  loadCssOnce('js/pages/artsByDestino/wizard.css', 'gi-ic-wizard-css');
  await Promise.all([
    window.html2canvas ? Promise.resolve() : loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'),
    window.JSZip       ? Promise.resolve() : loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'),
  ]);
}

// ───── API pública ─────
let _overlayEl = null;

export async function renderArtsByDestino(_parentContainer, { onClose } = {}) {
  closeArtsByDestino();
  _onCloseCb = onClose || null;

  await loadDeps();

  _overlayEl = document.createElement('div');
  _overlayEl.className = 'gi-ic-overlay';
  _overlayEl.innerHTML = OVERLAY_HTML;
  document.body.appendChild(_overlayEl);

  // Botão fechar
  _overlayEl.querySelector('.gi-ic-close').addEventListener('click', closeArtsByDestino);

  // Reset state pra abrir limpo
  state.view = 'welcome';
  state.destinoId = null;
  state.slides = [];
  state.activeSlideIdx = 0;
  state.openSheet = null;
  state.generated = null;
  state.uniformScale = null;

  initWizard();   // async — não bloqueia o append
}

export function closeArtsByDestino() {
  if (_keydownHandler) {
    document.removeEventListener('keydown', _keydownHandler);
    _keydownHandler = null;
  }
  if (_overlayEl) {
    _overlayEl.remove();
    _overlayEl = null;
  }
  if (_onCloseCb) { _onCloseCb(); _onCloseCb = null; }
}
