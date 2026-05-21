/**
 * Construtor de páginas por blocos — o "Elementor próprio" do Gestor.
 * Editor funcional: biblioteca de blocos, adicionar / reordenar / editar
 * / remover, com preview ao vivo. Persiste via btg-sites-service.
 *
 * Uso:
 *   import { mountSiteEditor } from '/btg/shared/btg-site-builder.js';
 *   mountSiteEditor(document.getElementById('root'), { siteId });
 */

import { getSite, saveSite, newBlockId } from './btg-sites-service.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

const nl2 = (s) => String(s ?? '').split(/\n+/).map((x) => x.trim()).filter(Boolean);

/* ─── Biblioteca de blocos ────────────────────────────────
 * Cada bloco: type, label, cor, descrição, defaultData, fields[]
 * (formulário do editor) e render(data) → HTML do preview. */
export const BLOCK_LIBRARY = [
  {
    type: 'hero',
    label: 'Hero',
    cor: '#1a2b4a',
    desc: 'Banner principal — título grande sobre cor de fundo.',
    defaultData: { eyebrow: '', titulo: 'Título do hero', subtitulo: '', cor: '#05132a' },
    fields: [
      { key: 'eyebrow',   label: 'Eyebrow (linha pequena)', type: 'text' },
      { key: 'titulo',    label: 'Título',                  type: 'text' },
      { key: 'subtitulo', label: 'Subtítulo',               type: 'textarea' },
      { key: 'cor',       label: 'Cor de fundo',            type: 'color' },
    ],
    render: (d) => `
      <div class="pv-hero" style="background:${esc(d.cor || '#05132a')};">
        ${d.eyebrow ? `<p class="pv-hero__eyebrow">${esc(d.eyebrow)}</p>` : ''}
        <h1 class="pv-hero__title">${esc(d.titulo || '')}</h1>
        ${d.subtitulo ? `<p class="pv-hero__sub">${esc(d.subtitulo)}</p>` : ''}
      </div>`,
  },
  {
    type: 'intro',
    label: 'Intro',
    cor: '#2E73D4',
    desc: 'Texto de abertura — título à esquerda, parágrafo à direita.',
    defaultData: { titulo: 'Título da seção', texto: '' },
    fields: [
      { key: 'titulo', label: 'Título', type: 'text' },
      { key: 'texto',  label: 'Texto',  type: 'textarea' },
    ],
    render: (d) => `
      <div class="pv-intro">
        <h2 class="pv-intro__title">${esc(d.titulo || '')}</h2>
        <p class="pv-intro__text">${esc(d.texto || '')}</p>
      </div>`,
  },
  {
    type: 'ofertas',
    label: 'Grid de ofertas',
    cor: '#15803d',
    desc: 'Grade de ofertas — puxa as ofertas publicadas dinamicamente.',
    defaultData: { titulo: 'Ofertas em destaque' },
    fields: [
      { key: 'titulo', label: 'Título', type: 'text' },
    ],
    render: (d) => `
      <div class="pv-ofertas">
        <h2 class="pv-sec-title">${esc(d.titulo || '')}</h2>
        <div class="pv-ofertas__grid">
          ${[0,1,2,3].map(() => `<div class="pv-ofertas__card"><div class="pv-ofertas__img"></div><div class="pv-ofertas__line"></div><div class="pv-ofertas__line pv-ofertas__line--short"></div></div>`).join('')}
        </div>
        <p class="pv-hint">conteúdo dinâmico — ofertas publicadas</p>
      </div>`,
  },
  {
    type: 'categorias',
    label: 'Cards de categoria',
    cor: '#d4a017',
    desc: 'Lista de categorias / links — um item por linha.',
    defaultData: { titulo: 'Categorias', itens: 'Categoria A\nCategoria B\nCategoria C' },
    fields: [
      { key: 'titulo', label: 'Título', type: 'text' },
      { key: 'itens',  label: 'Itens (um por linha)', type: 'textarea' },
    ],
    render: (d) => `
      <div class="pv-cats">
        <h2 class="pv-sec-title">${esc(d.titulo || '')}</h2>
        <div class="pv-cats__grid">
          ${nl2(d.itens).map((i) => `<div class="pv-cats__card"><span>${esc(i)}</span><span aria-hidden="true">→</span></div>`).join('')}
        </div>
      </div>`,
  },
  {
    type: 'vantagens',
    label: 'Seção de vantagens',
    cor: '#7c3aed',
    desc: 'Título + subtítulo + lista de vantagens (uma por linha).',
    defaultData: { titulo: 'Vantagens', subtitulo: '', itens: 'Vantagem 1\nVantagem 2\nVantagem 3' },
    fields: [
      { key: 'titulo',    label: 'Título',    type: 'text' },
      { key: 'subtitulo', label: 'Subtítulo', type: 'textarea' },
      { key: 'itens',     label: 'Vantagens (uma por linha)', type: 'textarea' },
    ],
    render: (d) => `
      <div class="pv-vant">
        <h2 class="pv-sec-title">${esc(d.titulo || '')}</h2>
        ${d.subtitulo ? `<p class="pv-vant__sub">${esc(d.subtitulo)}</p>` : ''}
        <div class="pv-vant__grid">
          ${nl2(d.itens).map((i) => `<div class="pv-vant__item"><span class="pv-vant__dot"></span><span>${esc(i)}</span></div>`).join('')}
        </div>
      </div>`,
  },
  {
    type: 'closing',
    label: 'Closing CTA',
    cor: '#0c4a6e',
    desc: 'Faixa de chamada final — título, descrição e botão.',
    defaultData: { titulo: 'Pronto para começar?', descricao: '', botao: 'Fale conosco', cor: '#05132a' },
    fields: [
      { key: 'titulo',    label: 'Título',         type: 'text' },
      { key: 'descricao', label: 'Descrição',      type: 'textarea' },
      { key: 'botao',     label: 'Texto do botão', type: 'text' },
      { key: 'cor',       label: 'Cor de fundo',   type: 'color' },
    ],
    render: (d) => `
      <div class="pv-closing" style="background:${esc(d.cor || '#05132a')};">
        <h2 class="pv-closing__title">${esc(d.titulo || '')}</h2>
        ${d.descricao ? `<p class="pv-closing__desc">${esc(d.descricao)}</p>` : ''}
        ${d.botao ? `<span class="pv-closing__btn">${esc(d.botao)}</span>` : ''}
      </div>`,
  },
  {
    type: 'rodape',
    label: 'Rodapé',
    cor: '#6b7280',
    desc: 'Rodapé fino — linha de copyright.',
    defaultData: { texto: 'Copyright © 2026. Todos os direitos reservados.' },
    fields: [
      { key: 'texto', label: 'Texto', type: 'text' },
    ],
    render: (d) => `<div class="pv-rodape">${esc(d.texto || '')}</div>`,
  },
];

const BLOCK_BY_TYPE = Object.fromEntries(BLOCK_LIBRARY.map((b) => [b.type, b]));

/* ─── Editor ──────────────────────────────────────────────── */

export function mountSiteEditor(root, { siteId }) {
  const original = getSite(siteId);
  if (!original) {
    root.innerHTML = `<div class="sb-error">Site não encontrado. <a href="/btg/dashboard/sites/">← voltar</a></div>`;
    return;
  }

  const state = {
    site: JSON.parse(JSON.stringify(original)),
    selectedId: original.blocks[0]?.id || null,
    dirty: false,
    libraryOpen: false,
  };

  function blockDef(b) { return BLOCK_BY_TYPE[b.type]; }
  function selectedBlock() { return state.site.blocks.find((b) => b.id === state.selectedId) || null; }

  // ─── Render: shell (1x) ───
  root.innerHTML = `
    <div class="sb-topbar">
      <a class="sb-back" href="/btg/dashboard/sites/">← Sites</a>
      <input class="sb-name" id="sb-name" value="${esc(state.site.name)}" aria-label="Nome do site" />
      <span class="sb-brand sb-brand--${esc(state.site.brand)}">${esc(state.site.brand)}</span>
      <span class="sb-status" id="sb-status"></span>
      <button class="sb-save" id="sb-save">Salvar</button>
    </div>
    <div class="sb-body">
      <aside class="sb-panel sb-left">
        <h3 class="sb-panel__title">Blocos da página</h3>
        <div class="sb-blocklist" id="sb-blocklist"></div>
        <button class="sb-add" id="sb-add">+ Adicionar bloco</button>
        <div class="sb-library" id="sb-library" hidden></div>
      </aside>
      <main class="sb-preview" id="sb-preview"></main>
      <aside class="sb-panel sb-right" id="sb-edit"></aside>
    </div>
  `;

  const elBlocklist = root.querySelector('#sb-blocklist');
  const elLibrary   = root.querySelector('#sb-library');
  const elPreview   = root.querySelector('#sb-preview');
  const elEdit      = root.querySelector('#sb-edit');
  const elStatus    = root.querySelector('#sb-status');

  function markDirty() {
    state.dirty = true;
    elStatus.textContent = 'alterações não salvas';
    elStatus.className = 'sb-status sb-status--dirty';
  }

  // ─── Render: lista de blocos ───
  function renderBlockList() {
    if (state.site.blocks.length === 0) {
      elBlocklist.innerHTML = `<p class="sb-empty">Nenhum bloco ainda. Adicione abaixo.</p>`;
      return;
    }
    elBlocklist.innerHTML = state.site.blocks.map((b, i) => {
      const def = blockDef(b);
      return `
        <div class="sb-block${b.id === state.selectedId ? ' is-selected' : ''}" data-block="${b.id}">
          <span class="sb-block__dot" style="background:${def?.cor || '#999'};"></span>
          <span class="sb-block__label">${esc(def?.label || b.type)}</span>
          <span class="sb-block__moves">
            <button type="button" class="sb-mini" data-move="up" data-block="${b.id}" ${i === 0 ? 'disabled' : ''} aria-label="Mover pra cima">↑</button>
            <button type="button" class="sb-mini" data-move="down" data-block="${b.id}" ${i === state.site.blocks.length - 1 ? 'disabled' : ''} aria-label="Mover pra baixo">↓</button>
            <button type="button" class="sb-mini sb-mini--del" data-remove="${b.id}" aria-label="Remover">×</button>
          </span>
        </div>`;
    }).join('');
  }

  // ─── Render: biblioteca de blocos ───
  function renderLibrary() {
    elLibrary.hidden = !state.libraryOpen;
    if (!state.libraryOpen) return;
    elLibrary.innerHTML = `
      <p class="sb-library__title">Escolha um bloco</p>
      ${BLOCK_LIBRARY.map((def) => `
        <button type="button" class="sb-libitem" data-add-type="${def.type}">
          <span class="sb-block__dot" style="background:${def.cor};"></span>
          <span>
            <strong>${esc(def.label)}</strong>
            <small>${esc(def.desc)}</small>
          </span>
        </button>`).join('')}
    `;
  }

  // ─── Render: preview ao vivo ───
  function renderPreview() {
    if (state.site.blocks.length === 0) {
      elPreview.innerHTML = `<div class="sb-preview__empty">A página está vazia.<br/>Adicione blocos pela coluna da esquerda.</div>`;
      return;
    }
    elPreview.innerHTML = `
      <div class="sb-canvas">
        ${state.site.blocks.map((b) => {
          const def = blockDef(b);
          const inner = def ? def.render(b.data || {}) : `<div class="pv-unknown">${esc(b.type)}</div>`;
          return `<div class="sb-canvasblock${b.id === state.selectedId ? ' is-selected' : ''}" data-block="${b.id}">${inner}</div>`;
        }).join('')}
      </div>`;
  }

  // ─── Render: painel de edição do bloco selecionado ───
  function renderEditPanel() {
    const b = selectedBlock();
    if (!b) {
      elEdit.innerHTML = `<p class="sb-empty">Selecione um bloco pra editar o conteúdo.</p>`;
      return;
    }
    const def = blockDef(b);
    elEdit.innerHTML = `
      <h3 class="sb-panel__title">Editar — ${esc(def?.label || b.type)}</h3>
      <div class="sb-fields">
        ${(def?.fields || []).map((f) => {
          const val = b.data?.[f.key] ?? '';
          if (f.type === 'textarea') {
            return `<label class="sb-field">
              <span>${esc(f.label)}</span>
              <textarea data-field="${f.key}" rows="4">${esc(val)}</textarea>
            </label>`;
          }
          if (f.type === 'color') {
            return `<label class="sb-field sb-field--color">
              <span>${esc(f.label)}</span>
              <input type="color" data-field="${f.key}" value="${esc(val || '#05132a')}" />
            </label>`;
          }
          return `<label class="sb-field">
            <span>${esc(f.label)}</span>
            <input type="text" data-field="${f.key}" value="${esc(val)}" />
          </label>`;
        }).join('')}
      </div>
    `;
  }

  function renderStructural() {
    renderBlockList();
    renderLibrary();
    renderPreview();
    renderEditPanel();
  }

  // ─── Ações ───
  function selectBlock(id) {
    state.selectedId = id;
    renderStructural();
  }

  function addBlock(type) {
    const def = BLOCK_BY_TYPE[type];
    if (!def) return;
    const block = { id: newBlockId(), type, data: JSON.parse(JSON.stringify(def.defaultData)) };
    state.site.blocks.push(block);
    state.selectedId = block.id;
    state.libraryOpen = false;
    markDirty();
    renderStructural();
  }

  function removeBlock(id) {
    const idx = state.site.blocks.findIndex((b) => b.id === id);
    if (idx === -1) return;
    state.site.blocks.splice(idx, 1);
    if (state.selectedId === id) {
      state.selectedId = state.site.blocks[Math.max(0, idx - 1)]?.id || null;
    }
    markDirty();
    renderStructural();
  }

  function moveBlock(id, dir) {
    const idx = state.site.blocks.findIndex((b) => b.id === id);
    const to = dir === 'up' ? idx - 1 : idx + 1;
    if (idx === -1 || to < 0 || to >= state.site.blocks.length) return;
    const [b] = state.site.blocks.splice(idx, 1);
    state.site.blocks.splice(to, 0, b);
    markDirty();
    renderStructural();
  }

  function save() {
    saveSite(state.site);
    state.dirty = false;
    elStatus.textContent = 'salvo ✓';
    elStatus.className = 'sb-status sb-status--saved';
  }

  // ─── Eventos ───
  root.querySelector('#sb-name').addEventListener('input', (e) => {
    state.site.name = e.target.value;
    markDirty();
  });

  root.querySelector('#sb-save').addEventListener('click', save);

  root.querySelector('#sb-add').addEventListener('click', () => {
    state.libraryOpen = !state.libraryOpen;
    renderLibrary();
  });

  // Lista de blocos: selecionar / mover / remover
  elBlocklist.addEventListener('click', (e) => {
    const moveBtn = e.target.closest('[data-move]');
    if (moveBtn) { moveBlock(moveBtn.dataset.block, moveBtn.dataset.move); return; }
    const delBtn = e.target.closest('[data-remove]');
    if (delBtn) { removeBlock(delBtn.dataset.remove); return; }
    const row = e.target.closest('[data-block]');
    if (row) selectBlock(row.dataset.block);
  });

  // Biblioteca: adicionar bloco do tipo escolhido
  elLibrary.addEventListener('click', (e) => {
    const item = e.target.closest('[data-add-type]');
    if (item) addBlock(item.dataset.addType);
  });

  // Preview: clicar num bloco seleciona ele
  elPreview.addEventListener('click', (e) => {
    const cb = e.target.closest('[data-block]');
    if (cb) selectBlock(cb.dataset.block);
  });

  // Painel de edição: digitar atualiza o dado + preview ao vivo
  elEdit.addEventListener('input', (e) => {
    const f = e.target.closest('[data-field]');
    if (!f) return;
    const b = selectedBlock();
    if (!b) return;
    b.data = { ...b.data, [f.dataset.field]: f.value };
    markDirty();
    renderPreview();   // só o preview — não re-renderiza o form (mantém foco)
  });

  // Aviso ao sair com alterações não salvas
  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  renderStructural();
}
