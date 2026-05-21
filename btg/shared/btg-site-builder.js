/**
 * Construtor de páginas por blocos — o "Elementor próprio" do Gestor.
 * Editor 3 colunas: lista de blocos · preview ao vivo · edição de campos.
 *
 * O preview roda num <iframe> que carrega o CSS real dos sites e usa
 * renderBlock() (btg-blocks.js) — então cada bloco aparece IDÊNTICO ao
 * site publicado. O que você monta aqui é o que vai pro ar.
 *
 * Uso:
 *   import { mountSiteEditor } from '/btg/shared/btg-site-builder.js';
 *   mountSiteEditor(document.getElementById('root'), { siteId });
 */

import { getSite, saveSite, newBlockId } from './btg-sites-service.js';
import { renderBlock, SITE_CSS } from './btg-blocks.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

/* ─── Biblioteca de blocos ────────────────────────────────
 * Metadados + campos do formulário do editor. O render fiel da seção
 * é o renderBlock() de btg-blocks.js (markup + CSS reais). */
export const BLOCK_LIBRARY = [
  {
    type: 'hero', label: 'Hero', cor: '#1a2b4a',
    desc: 'Banner principal da página.',
    defaultData: { eyebrow: '', titulo: 'Título do hero', subtitulo: '', imagem: '' },
    fields: [
      { key: 'eyebrow',   label: 'Eyebrow (linha pequena)', type: 'text' },
      { key: 'titulo',    label: 'Título',                  type: 'text' },
      { key: 'subtitulo', label: 'Subtítulo',               type: 'textarea' },
      { key: 'imagem',    label: 'Imagem de fundo (URL)',   type: 'text' },
    ],
  },
  {
    type: 'intro', label: 'Intro', cor: '#2E73D4',
    desc: 'Texto de abertura em 2 colunas.',
    defaultData: { titulo: 'Título da seção', texto: '', experiencias: '' },
    fields: [
      { key: 'titulo',       label: 'Título',                     type: 'text' },
      { key: 'texto',        label: 'Parágrafos (um por linha)',  type: 'textarea' },
      { key: 'experiencias', label: 'Subtítulo abaixo (opcional)', type: 'text' },
    ],
  },
  {
    type: 'ofertas', label: 'Grid de ofertas', cor: '#15803d',
    desc: 'Grade de ofertas em destaque (conteúdo dinâmico).',
    defaultData: { titulo: 'Ofertas em destaque' },
    fields: [
      { key: 'titulo', label: 'Título', type: 'text' },
    ],
  },
  {
    type: 'categorias', label: 'Cards de categoria', cor: '#d4a017',
    desc: 'Listas de categorias / links da página.',
    defaultData: { titulo: '', itens: 'Feriados e Datas Especiais\nDestinos\nHospedagem\nAéreo & Transfers\nCruzeiros' },
    fields: [
      { key: 'titulo', label: 'Título (opcional)',  type: 'text' },
      { key: 'itens',  label: 'Itens (um por linha)', type: 'textarea' },
    ],
  },
  {
    type: 'vantagens', label: 'Seção de vantagens', cor: '#7c3aed',
    desc: 'Título + subtítulo + imagem + lista de vantagens.',
    defaultData: { titulo: 'Vantagens', subtitulo: '', imagem: '', itens: 'Vantagem 1\nVantagem 2\nVantagem 3' },
    fields: [
      { key: 'titulo',    label: 'Título',    type: 'text' },
      { key: 'subtitulo', label: 'Subtítulo', type: 'textarea' },
      { key: 'imagem',    label: 'Imagem (URL)', type: 'text' },
      { key: 'itens',     label: 'Vantagens (uma por linha)', type: 'textarea' },
    ],
  },
  {
    type: 'closing', label: 'Closing CTA', cor: '#0c4a6e',
    desc: 'Faixa de chamada final — título, descrição e botão.',
    defaultData: { titulo: 'Pronto para começar?', descricao: '', botao: 'Fale conosco' },
    fields: [
      { key: 'titulo',    label: 'Título',         type: 'text' },
      { key: 'descricao', label: 'Descrição',      type: 'textarea' },
      { key: 'botao',     label: 'Texto do botão', type: 'text' },
    ],
  },
  {
    type: 'rodape', label: 'Rodapé', cor: '#6b7280',
    desc: 'Rodapé fino com a linha de copyright.',
    defaultData: { texto: 'Copyright © 2026. Todos os direitos reservados.' },
    fields: [
      { key: 'texto', label: 'Texto', type: 'text' },
    ],
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

  const blockDef = (b) => BLOCK_BY_TYPE[b.type];
  const selectedBlock = () => state.site.blocks.find((b) => b.id === state.selectedId) || null;

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
      <main class="sb-preview">
        <iframe id="sb-frame" class="sb-frame" title="Preview do site"></iframe>
      </main>
      <aside class="sb-panel sb-right" id="sb-edit"></aside>
    </div>
  `;

  const elBlocklist = root.querySelector('#sb-blocklist');
  const elLibrary   = root.querySelector('#sb-library');
  const elFrame     = root.querySelector('#sb-frame');
  const elEdit      = root.querySelector('#sb-edit');
  const elStatus    = root.querySelector('#sb-status');

  function markDirty() {
    state.dirty = true;
    elStatus.textContent = 'alterações não salvas';
    elStatus.className = 'sb-status sb-status--dirty';
  }

  // ─── Lista de blocos ───
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

  // ─── Biblioteca de blocos ───
  function renderLibrary() {
    elLibrary.hidden = !state.libraryOpen;
    if (!state.libraryOpen) return;
    elLibrary.innerHTML = `
      <p class="sb-library__title">Escolha um bloco</p>
      ${BLOCK_LIBRARY.map((def) => `
        <button type="button" class="sb-libitem" data-add-type="${def.type}">
          <span class="sb-block__dot" style="background:${def.cor};"></span>
          <span><strong>${esc(def.label)}</strong><small>${esc(def.desc)}</small></span>
        </button>`).join('')}
    `;
  }

  // ─── Preview (iframe com CSS real) ───
  function buildPreviewDoc() {
    const css = SITE_CSS.map((h) => `<link rel="stylesheet" href="${h}" />`).join('');
    const body = state.site.blocks.length === 0
      ? `<div style="padding:80px 24px;text-align:center;color:#9ca3af;font-family:sans-serif;">Página vazia — adicione blocos na coluna da esquerda.</div>`
      : state.site.blocks.map((b) =>
          `<div data-sb-block="${b.id}" class="sb-fr-block${b.id === state.selectedId ? ' is-sel' : ''}">${renderBlock(b.type, b.data, state.site.brand)}</div>`
        ).join('');
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8" />${css}
      <style>
        body { margin: 0; }
        .sb-fr-block { position: relative; cursor: pointer; }
        .sb-fr-block:hover { outline: 2px solid #bfdbfe; outline-offset: -2px; }
        .sb-fr-block.is-sel { outline: 3px solid #2E73D4; outline-offset: -3px; }
      </style></head>
      <body data-brand="${esc(state.site.brand)}">
        ${body}
        <script>
          document.addEventListener('click', function (e) {
            var el = e.target.closest('[data-sb-block]');
            if (el) parent.postMessage({ sbSelect: el.getAttribute('data-sb-block') }, '*');
          });
        <\/script>
      </body></html>`;
  }

  function renderPreview() {
    elFrame.srcdoc = buildPreviewDoc();
  }

  // Atualiza só 1 bloco dentro do iframe (sem recarregar — preserva scroll/foco).
  function updateBlockInFrame(id) {
    const doc = elFrame.contentDocument;
    const wrap = doc && doc.querySelector(`[data-sb-block="${id}"]`);
    if (!wrap) { renderPreview(); return; }
    const b = state.site.blocks.find((x) => x.id === id);
    if (b) wrap.innerHTML = renderBlock(b.type, b.data, state.site.brand);
  }

  // ─── Painel de edição ───
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
            return `<label class="sb-field"><span>${esc(f.label)}</span>
              <textarea data-field="${f.key}" rows="4">${esc(val)}</textarea></label>`;
          }
          return `<label class="sb-field"><span>${esc(f.label)}</span>
            <input type="text" data-field="${f.key}" value="${esc(val)}" /></label>`;
        }).join('')}
      </div>`;
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

  elBlocklist.addEventListener('click', (e) => {
    const moveBtn = e.target.closest('[data-move]');
    if (moveBtn) { moveBlock(moveBtn.dataset.block, moveBtn.dataset.move); return; }
    const delBtn = e.target.closest('[data-remove]');
    if (delBtn) { removeBlock(delBtn.dataset.remove); return; }
    const row = e.target.closest('[data-block]');
    if (row) selectBlock(row.dataset.block);
  });

  elLibrary.addEventListener('click', (e) => {
    const item = e.target.closest('[data-add-type]');
    if (item) addBlock(item.dataset.addType);
  });

  // Clique num bloco dentro do iframe → seleciona (via postMessage)
  window.addEventListener('message', (e) => {
    if (e.data && e.data.sbSelect) selectBlock(e.data.sbSelect);
  });

  // Edição de campo → atualiza o dado + só o bloco no preview (sem reload)
  elEdit.addEventListener('input', (e) => {
    const f = e.target.closest('[data-field]');
    if (!f) return;
    const b = selectedBlock();
    if (!b) return;
    b.data = { ...b.data, [f.dataset.field]: f.value };
    markDirty();
    updateBlockInFrame(b.id);
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  renderStructural();
}
