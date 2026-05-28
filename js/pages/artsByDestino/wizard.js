import { MOCK_FORMATOS, MOCK_TEMPLATES, MOCK_LAYOUTS } from './mock-data.js';
import {
  fetchDestinos, loadConteudoForDestino, buildSlidesForDestino,
  getBancoCuradoForDestino, getBancoCuradoCounts, getCategoriasParaDestino,
  getEstabelecimentosTipo, PICKER_CATEGORIAS,
} from '../../services/artsByDestino.js';

// Cache local — populado em initWizard via fetchDestinos()
let _destinos = [];
const getDestinos = () => _destinos;

// Lista efetiva pra renderizar — destinos reais ou estabelecimentos sintéticos
// dependendo do filterTipo selecionado.
function getEntradas() {
  const t = state.filterTipo;
  if (!t || t === 'todos' || t === 'location') return _destinos;
  return getEstabelecimentosTipo(t, _destinos);
}
const getBancoCurado = () => getBancoCuradoForDestino(state.destino, state.bancoCategoria || 'todas');

// ───── State ─────
const state = {
  // ─── Navegação (Etapa 2: 4 telas em sequência) ───
  view: 'formato',                       // 'formato' | 'destino' | 'topicos' | 'resultado'
  formato: null,                         // 'story' | 'carrossel' — escolhido na 1ª tela
  destinoId: null,
  destino: null,                         // doc completo (com _raw)
  filterContinent: '',                   // filtro destino
  filterCountry: '',                     // filtro destino
  filterTipo: 'todos',                   // todos | location | hotel | restaurant | train | cruise
  filterSoComConteudo: false,            // só destinos com tip rica/parcial
  searchQuery: '',
  // Compat: formatos (Set) ainda usado por código velho de export. Etapa futura unifica.
  formatos: new Set(['carrossel', 'story']),
  templateId: 'classico-teal',

  // ─── CONTEÚDO (Etapa 1 do refactor — independente de formato) ───
  // ordemTopicos: ['capa', 'informacoes_gerais', 'atracoes', ...]
  // conteudoPorTopico: { 'capa': {nome,titulo,descricao,label}, ... }
  // fotosDisponiveis: [url, url, ...] (pool, IC pode atribuir manualmente depois)
  // topicosSelecionados: Set — quais aparecerão nos slides
  ordemTopicos: [],
  conteudoPorTopico: {},
  fotosDisponiveis: [],
  topicosSelecionados: new Set(),
  conteudoFonte: 'empty',                // 'empty' | 'portal-tip' | 'banco-curado'

  slides: [],                            // CACHE derivado (não fonte de verdade) — populado por recomputeSlides()
  activeSlideIdx: 0,
  previewFormato: 'carrossel',
  fotoTab: 'curadas',
  bancoCategoria: 'todas',               // 'todas' | 'location' | 'hotel' | ...
  openSheet: null,                       // 'formato' | 'estilo' | 'texto' | 'foto' | 'baixar' | null
  generated: null,
  // ─── Canva-style overrides (por slideIdx → field) ───
  // { 0: { hand: { fontFamily, fontSize, color, align, weight }, titulo: {...}, desc: {...} } }
  // fontSize em PX no preview atual (escalado no export).
  slideOverrides: {},
  selectedField: null,                   // 'hand' | 'titulo' | 'desc' | null
  // Altura do retângulo (.solid-primary) por (formato, layout) — padronizada entre slides do grupo
  _solidHeights: null,                   // { story: { 'lateral-esq': 0.42, ... } }
};

// Fontes disponíveis no editor Canva-style (carregadas via Google Fonts no HTML)
const CANVAS_FONTS = [
  { id: 'sans',     label: 'Sans (padrão)',  css: "var(--font-sans)" },
  { id: 'caveat',   label: 'Manuscrita',     css: "'Caveat', cursive" },
  { id: 'playfair', label: 'Playfair (serif)', css: "'Playfair Display', serif" },
  { id: 'roboto-slab', label: 'Slab (forte)', css: "'Roboto Slab', serif" },
  { id: 'montserrat',  label: 'Montserrat',  css: "'Montserrat', sans-serif" },
];

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

// Abas de tipo (filtra destinos que TÊM fotos de cada categoria)
function renderTipos() {
  const wrap = $('#welcome-tipos');
  if (!wrap) return;
  const destinos = getDestinos();

  // Conta destinos que têm pelo menos 1 foto de cada categoria
  const counts = { todos: destinos.length };
  for (const cat of PICKER_CATEGORIAS) {
    if (cat.key === 'todas') continue;
    counts[cat.key] = destinos.filter(d => getCategoriasParaDestino(d).has(cat.key)).length;
  }

  // Mapping pra labels do welcome (singular vs plural diferente do banco curado)
  const TIPO_TABS = [
    { key: 'todos',      label: 'Todos',       icon: '🌍' },
    { key: 'location',   label: 'Destinos',    icon: '📍' },
    { key: 'hotel',      label: 'Hotéis',      icon: '🏨' },
    { key: 'restaurant', label: 'Restaurantes',icon: '🍽' },
    { key: 'train',      label: 'Trens',       icon: '🚄' },
    { key: 'cruise',     label: 'Cruzeiros',   icon: '🚢' },
  ];

  wrap.innerHTML = TIPO_TABS
    .filter(t => t.key === 'todos' || counts[t.key] > 0)
    .map(t => `
      <button class="welcome-tipo ${state.filterTipo === t.key ? 'active' : ''}" data-tipo="${t.key}">
        <span>${t.icon}</span>
        <span>${t.label}</span>
        <span class="welcome-tipo-count">${counts[t.key] || 0}</span>
      </button>
    `).join('');

  wrap.querySelectorAll('.welcome-tipo').forEach(btn => {
    btn.addEventListener('click', () => {
      state.filterTipo = btn.dataset.tipo;
      renderTipos();
      renderDestinos(state.searchQuery);
    });
  });
}

function renderFilters() {
  const fc = $('#welcome-filters');
  if (!fc) return;
  const destinos = getDestinos();
  // Continentes únicos
  const continents = [...new Set(destinos.map(d => d.continent).filter(Boolean))].sort();
  // Países do continente selecionado (ou todos se nenhum)
  const countriesPool = state.filterContinent
    ? destinos.filter(d => d.continent === state.filterContinent)
    : destinos;
  const countries = [...new Set(countriesPool.map(d => d.country).filter(Boolean))].sort();

  fc.innerHTML = `
    <div class="welcome-filter-row">
      <select id="filter-continent" class="welcome-select">
        <option value="">Todos continentes</option>
        ${continents.map(c => `<option value="${c}" ${state.filterContinent === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <select id="filter-country" class="welcome-select">
        <option value="">Todos países</option>
        ${countries.map(c => `<option value="${c}" ${state.filterCountry === c ? 'selected' : ''}>${c}</option>`).join('')}
      </select>
      <label class="welcome-only-content">
        <input type="checkbox" id="filter-only-content" ${state.filterSoComConteudo ? 'checked' : ''} />
        <span>Só com dica</span>
      </label>
      ${(state.filterContinent || state.filterCountry || state.searchQuery || state.filterSoComConteudo)
        ? `<button id="filter-clear" class="welcome-clear">Limpar</button>` : ''}
    </div>
  `;
  $('#filter-only-content').addEventListener('change', e => {
    state.filterSoComConteudo = e.target.checked;
    renderFilters();
    renderDestinos(state.searchQuery);
  });
  $('#filter-continent').addEventListener('change', e => {
    state.filterContinent = e.target.value;
    state.filterCountry = '';   // reset país ao mudar continente
    renderFilters();
    renderDestinos(state.searchQuery);
  });
  $('#filter-country').addEventListener('change', e => {
    state.filterCountry = e.target.value;
    renderDestinos(state.searchQuery);
  });
  $('#filter-clear')?.addEventListener('click', () => {
    state.filterContinent = '';
    state.filterCountry = '';
    state.searchQuery = '';
    state.filterSoComConteudo = false;
    $('#search-input').value = '';
    renderFilters();
    renderDestinos('');
  });
}

function renderDestinos(filter = '') {
  state.searchQuery = filter;
  const grid = $('#destinos-grid');
  const norm = filter.trim().toLowerCase();
  // Entradas dependem do tipo: destinos reais OU estabelecimentos sintéticos
  state._entradas = getEntradas();
  grid.innerHTML = state._entradas
    .filter(d => !state.filterContinent || d.continent === state.filterContinent)
    .filter(d => !state.filterCountry   || d.country   === state.filterCountry)
    .filter(d => !state.filterSoComConteudo || d.tipQualidade !== 'empty')
    .filter(d => !norm || d.nome.toLowerCase().includes(norm))
    .map(d => {
      const bg = d.capaUrl
        ? `style="background-image:url('${d.capaUrl}')"`
        : `style="background: linear-gradient(135deg, ${d.paletaFaixa}33, ${d.paletaFaixa}11)"`;
      const badge = d.tipQualidade === 'rich'    ? `<div class="quality-badge rich"    title="Dica completa cadastrada">●</div>`
                  : d.tipQualidade === 'partial' ? `<div class="quality-badge partial" title="Dica parcial cadastrada">◐</div>`
                  : `<div class="quality-badge empty"   title="Sem dica cadastrada — slides ficam vazios">○</div>`;
      return `
        <div class="destino-card ${!d.disponivel ? 'disabled' : ''} qual-${d.tipQualidade}" data-id="${d.id}">
          <div class="destino-foto" ${bg}></div>
          ${badge}
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
  // Procura nas entradas atuais (pode ser destino real ou sintético)
  const d = (state._entradas || _destinos).find(x => x.id === id);
  if (!d) return;
  // Confirma antes de entrar se a tip está vazia (slides ficam com placeholder)
  if (d.tipQualidade === 'empty') {
    const ok = confirm(
      `"${d.nome}" ainda não tem dica cadastrada no Portal de Dicas.\n\n` +
      `Os 7 slides ficarão com mensagem "SEM CONTEÚDO CADASTRADO" — você ` +
      `pode editar manualmente todos.\n\n` +
      `Quer continuar mesmo assim?`
    );
    if (!ok) return;
  }
  showLoader('Carregando destino...');
  try {
    // ─── NOVO (Etapa 1): carrega conteúdo agrupado por tópico (independente de formato) ───
    const { ordemTopicos, conteudoPorTopico, fotosDisponiveis, fonte } = await loadConteudoForDestino(d);

    state.destinoId = id;
    state.destino = d;
    state.ordemTopicos = ordemTopicos;
    state.conteudoPorTopico = conteudoPorTopico;
    state.fotosDisponiveis = fotosDisponiveis;
    state.conteudoFonte = fonte;
    // Default inteligente: marca tópicos com conteúdo decente, até 7 (capa + 7 = 8 slides)
    state.topicosSelecionados = computeDefaultTopicos(ordemTopicos, conteudoPorTopico);

    // Deriva slides a partir do conteúdo + formato atual (cache em state.slides)
    recomputeSlides();

    state.activeSlideIdx = 0;
    state.generated = null;
    state.uniformScale = null;
    state.slideOverrides = {};
    state.selectedField = null;
    hideLoader();
    setView('topicos');
    renderTopicos();
  } catch (err) {
    hideLoader();
    alert('Erro ao carregar destino: ' + err.message);
    console.error(err);
  }
}

// Default inteligente — escolhe tópicos com conteúdo bom, até 7.
// Prioriza descrição >= 40 chars; se ficar abaixo de 3, completa com curtos.
function computeDefaultTopicos(ordem, conteudoPorTopico, max = 7) {
  const candidatos = ordem.filter(k => k !== 'capa');
  // 1ª passada: descrição decente
  const bons = candidatos.filter(k => (conteudoPorTopico[k]?.descricao || '').length >= 40);
  if (bons.length >= max) return new Set(bons.slice(0, max));
  // 2ª passada: completa com curtos pra ter pelo menos 3-4 slides
  const resto = candidatos.filter(k => !bons.includes(k));
  return new Set([...bons, ...resto].slice(0, max));
}

// Atualiza contador no botão "Gerar X slides →" e label "X de Y selecionados"
function updateTopicosCounter() {
  const sel = state.topicosSelecionados?.size || 0;
  const total = (state.ordemTopicos || []).filter(k => k !== 'capa').length;
  const btn = $('#btn-topicos-continuar');
  if (btn) btn.textContent = `Gerar ${sel + 1} slides →`;   // +1 = capa
  const counter = $('#topicos-counter');
  if (counter) counter.textContent = `${sel} de ${total} marcados`;
}

// ─── Tela 3: TÓPICOS — lista do que o destino tem disponível ───
function renderTopicos() {
  const title = $('#topicos-title');
  if (title && state.destino) title.textContent = `Assuntos sobre ${state.destino.nome}`;

  const list = $('#topicos-list');
  if (!list) return;
  const ordem = state.ordemTopicos.filter(k => k !== 'capa');

  if (!ordem.length) {
    list.innerHTML = `
      <div class="topicos-empty">
        <p>Este destino ainda não tem dicas cadastradas no Portal de Dicas.</p>
        <p>Você pode continuar mesmo assim — os slides ficarão com aviso para você editar manualmente.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = ordem.map(key => {
    const c = state.conteudoPorTopico[key] || {};
    const checked = state.topicosSelecionados.has(key);
    return `
      <label class="topico-card ${checked ? 'checked' : ''}">
        <input type="checkbox" data-topico="${key}" ${checked ? 'checked' : ''}>
        <div class="topico-content">
          <div class="topico-label">${escapeHtml(c.label || key)}</div>
          <div class="topico-preview">${escapeHtml((c.descricao || '').slice(0, 90))}${(c.descricao || '').length > 90 ? '…' : ''}</div>
        </div>
        <div class="topico-check"></div>
      </label>
    `;
  }).join('');

  list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', e => {
      const key = e.target.dataset.topico;
      if (e.target.checked) state.topicosSelecionados.add(key);
      else state.topicosSelecionados.delete(key);
      e.target.closest('.topico-card').classList.toggle('checked', e.target.checked);
      updateTopicosCounter();
    });
  });

  updateTopicosCounter();
}

// ─── derivarSlides: função pura. Slides = (conteudoPorTopico × topicosSelecionados × formato) ───
// Importante: re-roda quando IC troca formato (re-encaixa) ou tópicos (re-monta).
function derivarSlides(s = state) {
  const layouts = ['foto-cima', 'lateral-esq', 'foto-cima', 'lateral-dir', 'foto-cima', 'lateral-esq', 'foto-cima'];
  const fotos = s.fotosDisponiveis || [];
  const foto = (idx) => fotos[idx % Math.max(fotos.length, 1)] || '';
  const slides = [];
  // Capa sempre primeiro
  const capa = s.conteudoPorTopico?.capa;
  if (capa) {
    slides.push({
      id: 'capa', layoutId: 'capa',
      nome: capa.nome, titulo: capa.titulo, descricao: capa.descricao,
      fotoUrl: foto(0),
    });
  }
  // Tópicos selecionados (na ordem definida em ordemTopicos)
  let idx = 1;
  for (const topicoKey of s.ordemTopicos || []) {
    if (topicoKey === 'capa') continue;
    if (!s.topicosSelecionados?.has(topicoKey)) continue;
    const c = s.conteudoPorTopico[topicoKey];
    if (!c) continue;
    slides.push({
      id: topicoKey,
      layoutId: layouts[(idx - 1) % layouts.length],
      nome: c.nome, titulo: c.titulo, descricao: c.descricao,
      fotoUrl: foto(idx),
    });
    idx++;
    if (idx > 8) break;  // cap visual: 8 slides max por enquanto
  }
  // Fallback honesto: nenhum tópico com conteúdo
  if (slides.length === 1 && s.conteudoFonte === 'empty') {
    const nome = s.destino?.nome || '';
    for (let i = 0; i < 7; i++) {
      slides.push({
        id: `empty-${i + 1}`,
        layoutId: layouts[i],
        nome: `Slide ${i + 2}`,
        titulo: 'SEM CONTEÚDO CADASTRADO',
        descricao: `Cadastre uma dica de ${nome} no Portal de Dicas para os slides serem preenchidos automaticamente com Atrações, Restaurantes, Bairros, etc.`,
        fotoUrl: foto(i + 1),
      });
    }
  }
  return slides;
}

function recomputeSlides() {
  state.slides = derivarSlides(state);
}

// ───── Editor canvas ─────
function renderEditor() {
  $('#editor-title').textContent = state.destino?.nome || '—';
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

      // Aplica uniformScale em cada node ANTES de medir alturas dos blocks
      for (const lid in byLayout) {
        const scales = next[formato][lid];
        byLayout[lid].forEach(({ node }) => {
          Object.entries(scales).forEach(([cat, factor]) => {
            node.querySelectorAll(`.${cat}`).forEach(el => {
              const baseFs = parseFloat(getComputedStyle(el).fontSize);
              el.style.fontSize = (baseFs * factor) + 'px';
            });
          });
        });
      }

      // Mede altura natural do .slot-text-block após uniform aplicado.
      // Salva em PERCENTUAL da altura do slide. SÓ pra layouts onde
      // faz sentido dimensionar pela altura (foto-cima em ambos formatos —
      // laterais story caem aqui via effectiveLayout).
      await new Promise(r => requestAnimationFrame(r));
      const SOLID_LIMITS = {
        carrossel: { 'foto-cima': { min: 0.28, max: 0.48, padding: 0.10 } },
        story:     { 'foto-cima': { min: 0.22, max: 0.42, padding: 0.10 } },
      };
      for (const lid in byLayout) {
        const limits = SOLID_LIMITS[formato]?.[lid];
        if (!limits) continue;
        let maxRatio = 0;
        byLayout[lid].forEach(({ node }) => {
          const block = node.querySelector('.slot-text-block');
          if (!block) return;
          const slideH = node.getBoundingClientRect().height || 1;
          const blockH = block.scrollHeight;
          const ratio = (blockH / slideH) + limits.padding;
          if (ratio > maxRatio) maxRatio = ratio;
        });
        if (maxRatio > 0) {
          const finalH = Math.max(limits.min, Math.min(limits.max, maxRatio));
          state._solidHeights ??= { carrossel: {}, story: {} };
          state._solidHeights[formato][lid] = finalH;
        }
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
  if (slideNode) {
    requestAnimationFrame(() => {
      fitSlideContent(slideNode);
      applySolidHeight(slideNode);
      applyOverridesToSlide(slideNode, state.activeSlideIdx);
    });
  }
  wireEditInPlace();
  wireCanvasSelection();
  // Deseleciona ao trocar de slide
  deselectElement();
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

// Edit-in-place agora é ATIVADO via botão ✏️ da toolbar ou double-click no texto.
// (Single click só seleciona — drag fica livre.) Listeners ficam no wireCanvasSelection.
function wireEditInPlace() {
  // Listeners de input/keydown/blur são adicionados em enterEditMode (sob demanda)
}

let _reprefitTimer = null;
/* ─── Canva-style: seleção + overrides + toolbar flutuante ─── */

function wireCanvasSelection() {
  $$('#canvas-preview .slot-text').forEach(el => {
    // Single click → seleciona (drag fica disponível via moveable)
    el.addEventListener('mousedown', (e) => {
      // Se já está em modo edit, deixa o cursor agir naturalmente
      if (el.getAttribute('contenteditable') === 'true') return;
      const field = el.dataset.field;
      if (!field) return;
      // Previne text-selection do browser pra moveable conseguir interceptar drag
      e.preventDefault();
      if (state.selectedField !== field) selectElement(field);
    });
    // Double click → entra em modo edit (cursor, digita)
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const field = el.dataset.field;
      if (!field) return;
      if (state.selectedField !== field) selectElement(field);
      enterEditMode();
    });
  });
}

function enterEditMode() {
  const field = state.selectedField;
  if (!field) return;
  const el = $(`#canvas-preview .slot-text[data-field="${field}"]`);
  if (!el) return;
  detachMoveable();          // libera o texto pra cursor de edição
  el.setAttribute('contenteditable', 'true');
  el.spellcheck = false;
  el.focus();
  // Seleciona todo o conteúdo (UX igual Canva — começa digitando substitui)
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {}
  el.addEventListener('input', onSlotEdit);
  el.addEventListener('keydown', _editKeyHandler);
  el.addEventListener('blur', exitEditMode, { once: true });
  $('#float-toolbar')?.classList.add('editing');
}

function exitEditMode() {
  const field = state.selectedField;
  if (!field) return;
  const el = $(`#canvas-preview .slot-text[data-field="${field}"]`);
  if (!el) return;
  el.removeAttribute('contenteditable');
  el.removeEventListener('input', onSlotEdit);
  el.removeEventListener('keydown', _editKeyHandler);
  // Limpa HTML colado do clipboard (mantém texto puro)
  if (el.innerHTML !== el.textContent) el.textContent = el.textContent;
  $('#float-toolbar')?.classList.remove('editing');
  // Reativa drag/resize se o texto ainda está selecionado
  if (state.selectedField === field) attachMoveable(field);
}

function _editKeyHandler(e) {
  // Esc sai do modo edit (não fecha seleção)
  if (e.key === 'Escape') {
    e.preventDefault();
    e.target.blur();
    return;
  }
  // Enter no hand/titulo termina edição (descrição quebra linha normal)
  if (e.key === 'Enter' && !e.target.classList.contains('text-desc')) {
    e.preventDefault();
    e.target.blur();
  }
}

let _moveable = null;   // instância do Moveable.js

function selectElement(field) {
  state.selectedField = field;
  $$('#canvas-preview .slot-text').forEach(x => x.classList.toggle('is-selected', x.dataset.field === field));
  showFloatingToolbar(field);
  attachMoveable(field);
}

function deselectElement() {
  state.selectedField = null;
  $$('#canvas-preview .slot-text').forEach(x => x.classList.remove('is-selected'));
  hideFloatingToolbar();
  detachMoveable();
}

// Cria/atualiza Moveable.js no elemento selecionado — habilita DRAG.
// (Resize entra na Fase 3 — moveable já suporta, só ativar option.)
function attachMoveable(field) {
  if (!window.Moveable) return;
  detachMoveable();
  const el = $(`#canvas-preview .slot-text[data-field="${field}"]`);
  if (!el) return;

  const idx = state.activeSlideIdx;
  const ov = state.slideOverrides[idx]?.[field] || {};
  if (ov.dx != null) el.style.transform = `translate(${ov.dx}px, ${ov.dy || 0}px)`;
  if (ov.width) el.style.width = ov.width + 'px';

  _moveable = new window.Moveable(document.body, {
    target: el,
    draggable: true,
    resizable: true,
    origin: false,
    edge: false,
    throttleDrag: 0,
    throttleResize: 0,
    keepRatio: false,
    container: $('#canvas-preview .slide-render'),
    snappable: true,
    snapThreshold: 5,
    elementSnapDirections: { top: true, bottom: true, left: true, right: true, center: true, middle: true },
    renderDirections: ['e', 'w'],  // só handles horizontais (largura do texto)
  });

  // ── Drag ──
  _moveable.on('dragStart', (e) => {
    e.set([ov.dx || 0, ov.dy || 0]);
  });
  _moveable.on('drag', (e) => {
    el.style.transform = `translate(${e.beforeTranslate[0]}px, ${e.beforeTranslate[1]}px)`;
  });
  _moveable.on('dragEnd', (e) => {
    if (!e.lastEvent) return;
    const [dx, dy] = e.lastEvent.beforeTranslate;
    setOverride(field, { dx, dy });
    showFloatingToolbar(field);
    requestAnimationFrame(() => attachMoveable(field));
  });

  // ── Resize ──
  _moveable.on('resizeStart', (e) => {
    e.setOrigin(['%', '%']);
    e.dragStart && e.dragStart.set([ov.dx || 0, ov.dy || 0]);
  });
  _moveable.on('resize', (e) => {
    el.style.width = e.width + 'px';
    if (e.drag) {
      el.style.transform = `translate(${e.drag.beforeTranslate[0]}px, ${e.drag.beforeTranslate[1]}px)`;
    }
  });
  _moveable.on('resizeEnd', (e) => {
    if (!e.lastEvent) return;
    const width = e.lastEvent.width;
    const next = { width };
    if (e.lastEvent.drag) {
      next.dx = e.lastEvent.drag.beforeTranslate[0];
      next.dy = e.lastEvent.drag.beforeTranslate[1];
    }
    setOverride(field, next);
    showFloatingToolbar(field);
    requestAnimationFrame(() => attachMoveable(field));
  });
}

function detachMoveable() {
  if (_moveable) {
    try { _moveable.destroy(); } catch {}
    _moveable = null;
  }
}

function showFloatingToolbar(field) {
  const el = $(`#canvas-preview .slot-text[data-field="${field}"]`);
  const bar = $('#float-toolbar');
  if (!el || !bar) return;
  const rect = el.getBoundingClientRect();
  // Posiciona acima do elemento (com fallback embaixo se topo da tela)
  bar.classList.add('show');
  bar.style.left = '0px';
  bar.style.top  = '0px';
  // Mede pra centralizar
  const barRect = bar.getBoundingClientRect();
  let top = rect.top - barRect.height - 12;
  let left = rect.left + rect.width / 2 - barRect.width / 2;
  if (top < 12) top = rect.bottom + 12;                       // se não cabe acima, vai pra baixo
  left = Math.max(12, Math.min(left, window.innerWidth - barRect.width - 12));
  bar.style.left = left + 'px';
  bar.style.top  = top + 'px';

  syncToolbarState();
}

// Sincroniza estado visual da toolbar com o elemento selecionado
function syncToolbarState() {
  const field = state.selectedField;
  if (!field) return;
  const el = $(`#canvas-preview .slot-text[data-field="${field}"]`);
  if (!el) return;
  const override = state.slideOverrides[state.activeSlideIdx]?.[field] || {};
  const computed = getComputedStyle(el);
  $('#ft-font').value = override.fontFamily || 'sans';
  $('#ft-size').textContent = Math.round(override.fontSize || parseFloat(computed.fontSize)) + 'px';
  $('#ft-bold')?.classList.toggle('active', parseInt(computed.fontWeight) >= 700);
  $('#ft-italic')?.classList.toggle('active', computed.fontStyle === 'italic');
  const align = override.align || computed.textAlign || 'left';
  $('#ft-align-left')?.classList.toggle('active', align === 'left' || align === 'start');
  $('#ft-align-center')?.classList.toggle('active', align === 'center');
  $('#ft-align-right')?.classList.toggle('active', align === 'right' || align === 'end');
  const color = override.color || rgbToHex(computed.color);
  if ($('#ft-color')) $('#ft-color').value = color;
  if ($('#ft-color-swatch')) $('#ft-color-swatch').style.background = color;
}

function rgbToHex(rgb) {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgb);
  if (!m) return '#ffffff';
  const h = (n) => parseInt(n).toString(16).padStart(2, '0');
  return '#' + h(m[1]) + h(m[2]) + h(m[3]);
}

function hideFloatingToolbar() {
  $('#float-toolbar')?.classList.remove('show');
}

function setOverride(field, props) {
  const idx = state.activeSlideIdx;
  if (!state.slideOverrides[idx]) state.slideOverrides[idx] = {};
  if (!state.slideOverrides[idx][field]) state.slideOverrides[idx][field] = {};
  Object.assign(state.slideOverrides[idx][field], props);
  // Aplica visualmente sem rerender
  const slideNode = $('#canvas-preview .slide-render');
  if (slideNode) applyOverridesToSlide(slideNode, idx);
}

function clearOverride(field) {
  const idx = state.activeSlideIdx;
  if (state.slideOverrides[idx]) delete state.slideOverrides[idx][field];
  // Re-render limpa os styles inline aplicados
  renderCanvas();
  // Reseleciona pro user continuar editando
  requestAnimationFrame(() => selectElement(field));
}

function applyOverridesToSlide(slideNode, slideIdx) {
  applyOverridesToSlideScaled(slideNode, slideIdx, 1);
}

// Aplica altura padronizada do retângulo (calculada em prefitAllSlides).
// Setado como CSS var --solid-h no slide-render (em %).
function applySolidHeight(slideNode) {
  const formato = slideNode.classList.contains('story') ? 'story' : 'carrossel';
  const rawLayout = slideNode.getAttribute('data-layout') || 'foto-cima';
  const layoutId = effectiveLayout(rawLayout, formato);
  const ratio = state._solidHeights?.[formato]?.[layoutId];
  if (ratio) {
    slideNode.style.setProperty('--solid-h', (ratio * 100).toFixed(2) + '%');
  }
}

function applyOverridesToSlideScaled(slideNode, slideIdx, scale = 1) {
  const overrides = state.slideOverrides[slideIdx];
  if (!overrides) return;
  for (const [field, props] of Object.entries(overrides)) {
    const el = slideNode.querySelector(`.text-${field}`);
    if (!el) continue;
    if (props.fontFamily) {
      const f = CANVAS_FONTS.find(x => x.id === props.fontFamily);
      if (f) el.style.fontFamily = f.css;
    }
    if (props.fontSize) el.style.fontSize = (props.fontSize * scale) + 'px';
    if (props.color)    el.style.color = props.color;
    if (props.align)    el.style.textAlign = props.align;
    if (props.weight)   el.style.fontWeight = props.weight;
    if (props.style)    el.style.fontStyle = props.style;
    // Drag/move: translate em px no preview, escalado no export
    if (props.dx != null || props.dy != null) {
      const dx = (props.dx || 0) * scale;
      const dy = (props.dy || 0) * scale;
      el.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    // Resize: largura em px, escalado no export
    if (props.width != null) {
      el.style.width = (props.width * scale) + 'px';
    }
  }
}

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
  const destino = state.destino;
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
    items.forEach(it => applySolidHeight(it.node));

    // Aplica overrides Canva-style escalados pro tamanho do export (1080px)
    const previewSlide = $('#canvas-preview .slide-render');
    const previewWidth = previewSlide ? previewSlide.getBoundingClientRect().width : 360;
    const exportScale = 1080 / previewWidth;
    items.forEach(it => applyOverridesToSlideScaled(it.node, it.i, exportScale));

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
  renderTipos();
  renderFilters();
  renderDestinos();

  if (!_destinos.length) {
    $('#destinos-grid').innerHTML = `
      <div style="grid-column:1/-1;padding:32px;text-align:center;color:var(--ink-soft)">
        <p style="margin:0">Nenhum destino cadastrado no Portal de Dicas ainda.</p>
        <p style="font-size:13px;margin-top:6px">Cadastre destinos em <em>Serviços → Portal de Dicas</em>.</p>
      </div>`;
  }

  $('#search-input').addEventListener('input', e => renderDestinos(e.target.value));
  $('#btn-menu').addEventListener('click', () => alert('Menu (em breve): salvar rascunho, ajuda, sair.'));

  // ─── Etapa 2-3: fluxo das 4 telas ───
  // Tela 1: cards de formato (Story / Carrossel) — se IC já tem destino+tópicos,
  // re-encaixa direto no resultado preservando contexto.
  $$('#view-formato .formato-card').forEach(card => {
    card.addEventListener('click', () => {
      state.formato = card.dataset.formato;
      state.previewFormato = state.formato;
      state.formatos = new Set([state.formato]);
      // Re-encaixe: se já tem destino+tópicos escolhidos, pula direto pro resultado
      const temContexto = state.destino && state.topicosSelecionados?.size > 0;
      if (temContexto) {
        recomputeSlides();
        state.activeSlideIdx = 0;
        state.uniformScale = null;
        setView('resultado');
        renderEditor();
      } else {
        setView('destino');
      }
    });
  });
  // Back buttons de cada tela
  $('#btn-back-formato')?.addEventListener('click', () => setView('formato'));
  $('#btn-back-destino')?.addEventListener('click', () => setView('destino'));
  $('#btn-back-topicos')?.addEventListener('click', () => setView('topicos'));
  // Tela 3: continuar pra resultado
  $('#btn-topicos-continuar')?.addEventListener('click', () => {
    recomputeSlides();
    state.activeSlideIdx = 0;
    state.uniformScale = null;
    state.slideOverrides = {};
    state.selectedField = null;
    setView('resultado');
    renderEditor();
  });

  $$('.tool-btn').forEach(b => {
    b.addEventListener('click', () => {
      const tool = b.dataset.tool;
      if (state.openSheet === tool) closeSheet();
      else openSheet(tool);
    });
  });

  $$('.canvas-format-toggle button').forEach(b => {
    b.addEventListener('click', () => {
      // Atualiza state.formato (SSOT) + previewFormato (compat) e re-encaixa slides
      state.formato = b.dataset.fmt;
      state.previewFormato = state.formato;
      state.formatos = new Set([state.formato]);
      $$('.canvas-format-toggle button').forEach(x => x.classList.toggle('active', x === b));
      // Re-encaixe: como layout de alguns tópicos pode mudar (ex: lateral colapsa
      // pra foto-cima no story via effectiveLayout), recomputa pra refletir.
      recomputeSlides();
      // Limpa uniformScale (vai ser recalculado pelo formato novo no próximo prefit)
      state.uniformScale = null;
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

  // Toolbar flutuante Canva-style
  $('#ft-font')?.addEventListener('change', e => {
    if (!state.selectedField) return;
    setOverride(state.selectedField, { fontFamily: e.target.value });
  });
  $('#ft-size-plus')?.addEventListener('click', () => {
    if (!state.selectedField) return;
    const el = $(`#canvas-preview .slot-text[data-field="${state.selectedField}"]`);
    if (!el) return;
    const cur = parseFloat(getComputedStyle(el).fontSize);
    const novo = Math.min(120, cur + 2);
    setOverride(state.selectedField, { fontSize: novo });
    $('#ft-size').textContent = Math.round(novo) + 'px';
  });
  $('#ft-size-minus')?.addEventListener('click', () => {
    if (!state.selectedField) return;
    const el = $(`#canvas-preview .slot-text[data-field="${state.selectedField}"]`);
    if (!el) return;
    const cur = parseFloat(getComputedStyle(el).fontSize);
    const novo = Math.max(8, cur - 2);
    setOverride(state.selectedField, { fontSize: novo });
    $('#ft-size').textContent = Math.round(novo) + 'px';
  });
  $('#ft-bold')?.addEventListener('click', () => {
    if (!state.selectedField) return;
    const el = $(`#canvas-preview .slot-text[data-field="${state.selectedField}"]`);
    const isBold = getComputedStyle(el).fontWeight >= 700;
    setOverride(state.selectedField, { weight: isBold ? '400' : '800' });
    syncToolbarState();
  });
  $('#ft-italic')?.addEventListener('click', () => {
    if (!state.selectedField) return;
    const el = $(`#canvas-preview .slot-text[data-field="${state.selectedField}"]`);
    const isItalic = getComputedStyle(el).fontStyle === 'italic';
    setOverride(state.selectedField, { style: isItalic ? 'normal' : 'italic' });
    syncToolbarState();
  });
  $('#ft-align-left')?.addEventListener('click', () => {
    if (!state.selectedField) return;
    setOverride(state.selectedField, { align: 'left' });
    syncToolbarState();
  });
  $('#ft-align-center')?.addEventListener('click', () => {
    if (!state.selectedField) return;
    setOverride(state.selectedField, { align: 'center' });
    syncToolbarState();
  });
  $('#ft-align-right')?.addEventListener('click', () => {
    if (!state.selectedField) return;
    setOverride(state.selectedField, { align: 'right' });
    syncToolbarState();
  });
  $('#ft-color')?.addEventListener('input', e => {
    if (!state.selectedField) return;
    setOverride(state.selectedField, { color: e.target.value });
    $('#ft-color-swatch').style.background = e.target.value;
  });
  $('#ft-edit')?.addEventListener('click', () => {
    if (!state.selectedField) return;
    enterEditMode();
  });
  $('#ft-reset')?.addEventListener('click', () => {
    if (!state.selectedField) return;
    clearOverride(state.selectedField);
  });
  $('#ft-reset-all')?.addEventListener('click', () => {
    const ok = confirm('Resetar TODAS as edições visuais (fonte, tamanho, posição, cor, etc.) deste slide?\n\nO conteúdo dos textos não será afetado.');
    if (!ok) return;
    delete state.slideOverrides[state.activeSlideIdx];
    deselectElement();
    renderCanvas();
  });
  $('#ft-close')?.addEventListener('click', deselectElement);

  // Click fora do canvas e fora da toolbar deseleciona
  document.addEventListener('mousedown', (e) => {
    if (!state.selectedField) return;
    const inText = e.target.closest('#canvas-preview .slot-text');
    const inToolbar = e.target.closest('#float-toolbar');
    if (!inText && !inToolbar) deselectElement();
  });
}

// ───── HTML do wizard (injetado no overlay) ─────
const OVERLAY_HTML = `
  <button class="gi-ic-close" type="button" aria-label="Fechar">✕</button>

  <!-- ━━━━━━━━ Tela 1: FORMATO ━━━━━━━━ -->
  <section class="view active" id="view-formato">
    <header class="welcome-header">
      <div class="welcome-title-wrap">
        <h1>Que formato você quer?</h1>
        <p>Escolha onde você vai postar — isso define o tamanho do material.</p>
      </div>
    </header>
    <div class="welcome-content">
      <div class="formato-cards">
        <button class="formato-card" data-formato="story">
          <div class="formato-thumb formato-thumb-story"></div>
          <div class="formato-info">
            <h3>Story</h3>
            <p>9:16 vertical · Instagram Stories</p>
          </div>
        </button>
        <button class="formato-card" data-formato="carrossel">
          <div class="formato-thumb formato-thumb-carrossel"></div>
          <div class="formato-info">
            <h3>Carrossel</h3>
            <p>4:5 · Feed do Instagram</p>
          </div>
        </button>
      </div>
      <p class="formato-hint">WhatsApp e E-mail virão em breve.</p>
    </div>
  </section>

  <!-- ━━━━━━━━ Tela 2: DESTINO ━━━━━━━━ -->
  <section class="view" id="view-destino">
    <header class="welcome-header">
      <button class="btn-icon header-back" id="btn-back-formato" aria-label="Voltar ao formato">←</button>
      <div class="welcome-title-wrap">
        <h1>Qual destino?</h1>
        <p>Escolha sobre qual lugar você vai criar o material.</p>
      </div>
    </header>
    <div class="welcome-content">
      <div class="search-bar">
        <span style="font-size:18px">🔍</span>
        <input id="search-input" placeholder="Busque por destino..." />
      </div>
      <div class="welcome-tipos" id="welcome-tipos"></div>
      <div class="welcome-filters" id="welcome-filters"></div>
      <div class="destinos-grid" id="destinos-grid"></div>
    </div>
  </section>

  <!-- ━━━━━━━━ Tela 3: TÓPICOS ━━━━━━━━ -->
  <section class="view" id="view-topicos">
    <header class="welcome-header">
      <button class="btn-icon header-back" id="btn-back-destino" aria-label="Voltar aos destinos">←</button>
      <div class="welcome-title-wrap">
        <h1 id="topicos-title">Quais assuntos?</h1>
        <p>Cada assunto selecionado vira um slide do material.</p>
      </div>
    </header>
    <div class="welcome-content">
      <div class="topicos-counter" id="topicos-counter"></div>
      <div class="topicos-list" id="topicos-list"></div>
      <div class="topicos-actions">
        <button class="btn-primary topicos-continuar" id="btn-topicos-continuar">Gerar material →</button>
      </div>
    </div>
  </section>

  <!-- ━━━━━━━━ Tela 4: RESULTADO ━━━━━━━━ -->
  <section class="view" id="view-resultado">
    <header class="editor-header">
      <button class="btn-icon" id="btn-back-topicos" aria-label="Voltar aos tópicos">←</button>
      <div class="editor-title" id="editor-title">—</div>
      <button class="btn-icon" id="btn-menu" aria-label="Menu">⋮</button>
    </header>
    <div class="editor-body">
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
    </div>
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

  <!-- Toolbar flutuante Canva-style (aparece ao selecionar texto) -->
  <div class="float-toolbar" id="float-toolbar">
    <select class="ft-font" id="ft-font" title="Fonte">
      ${CANVAS_FONTS.map(f => `<option value="${f.id}">${f.label}</option>`).join('')}
    </select>
    <div class="ft-size-group">
      <button class="ft-btn" id="ft-size-minus" title="Diminuir">−</button>
      <span class="ft-size" id="ft-size">—</span>
      <button class="ft-btn" id="ft-size-plus" title="Aumentar">+</button>
    </div>
    <button class="ft-btn ft-toggle" id="ft-bold" title="Negrito"><b>B</b></button>
    <button class="ft-btn ft-toggle" id="ft-italic" title="Itálico"><i>I</i></button>
    <div class="ft-align-group">
      <button class="ft-btn ft-toggle" id="ft-align-left" title="Esquerda">◧</button>
      <button class="ft-btn ft-toggle" id="ft-align-center" title="Centro">▣</button>
      <button class="ft-btn ft-toggle" id="ft-align-right" title="Direita">◨</button>
    </div>
    <label class="ft-color-wrap" title="Cor do texto">
      <input type="color" id="ft-color" value="#ffffff" />
      <span class="ft-color-swatch" id="ft-color-swatch"></span>
    </label>
    <button class="ft-btn ft-edit" id="ft-edit" title="Editar texto (ou duplo-clique no texto)">✏️</button>
    <button class="ft-btn ft-reset" id="ft-reset" title="Resetar este texto">↺</button>
    <button class="ft-btn ft-reset-all" id="ft-reset-all" title="Resetar TODOS os textos deste slide">⟲</button>
    <button class="ft-btn ft-close" id="ft-close" title="Fechar">✕</button>
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
  loadCssOnce('https://fonts.googleapis.com/css2?family=Caveat:wght@400;700&family=Playfair+Display:wght@400;700;800&family=Roboto+Slab:wght@400;700;800&family=Montserrat:wght@400;600;700;800&display=swap', 'gi-ic-fonts');
  loadCssOnce('js/pages/artsByDestino/wizard.css', 'gi-ic-wizard-css');
  await Promise.all([
    window.html2canvas ? Promise.resolve() : loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'),
    window.JSZip       ? Promise.resolve() : loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'),
    window.Moveable    ? Promise.resolve() : loadScriptOnce('https://cdn.jsdelivr.net/npm/moveable@0.53.0/dist/moveable.min.js'),
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
  state.view = 'formato';
  state.formato = null;
  state.destinoId = null;
  state.destino = null;
  state.ordemTopicos = [];
  state.conteudoPorTopico = {};
  state.fotosDisponiveis = [];
  state.topicosSelecionados = new Set();
  state.conteudoFonte = 'empty';
  state.slides = [];
  state.activeSlideIdx = 0;
  state.openSheet = null;
  state.generated = null;
  state.uniformScale = null;
  state.slideOverrides = {};
  state.selectedField = null;

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
