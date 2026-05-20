/**
 * Renderers de input para o formulário de oferta. Cada função recebe
 * o store, o nome do campo e opções; retorna string HTML.
 * Eventos são delegados via addEventListener no container que monta os inputs.
 */

import { icon } from '../btg-icons.js';
import { openImagePicker } from '../btg-image-picker.js';
import { sugerir as aiSugerir, revisar as aiRevisar, isStaging as aiIsStaging } from '../btg-ai.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

const INPUT_CLASS =
  'btg-input';
const TEXTAREA_CLASS =
  'btg-input btg-input--textarea';

// ─── TEXTO / TEXTAREA ──────────────────────────────────────

// 4.42.0+ (Fase 3 BTG): se opts.aiField passado, wrappa input + barra
// com botões "Sugerir" e "Revisar". Em staging o cliente IA usa mocks
// (callLLM não roda lá); em produção chama o callLLM real do Gestor.
function aiBar(field) {
  return `
    <div class="btg-ai-bar" data-ai-bar="${esc(field)}">
      <button type="button" class="btg-ai-btn" data-ai-action="sugerir" data-ai-field="${esc(field)}">
        <span class="btg-ai-btn__icon">✨</span>
        <span>Sugerir com IA</span>
      </button>
      <button type="button" class="btg-ai-btn btg-ai-btn--ghost" data-ai-action="revisar" data-ai-field="${esc(field)}">
        <span class="btg-ai-btn__icon">📝</span>
        <span>Revisar texto</span>
      </button>
      <span class="btg-ai-status" data-ai-status="${esc(field)}" hidden></span>
    </div>
  `;
}

export function inputText(store, name, opts = {}) {
  const val = store.get(name) ?? '';
  const inputHtml = `<input type="${opts.type || 'text'}"
      class="${INPUT_CLASS}"
      data-field="${name}"
      placeholder="${esc(opts.placeholder || '')}"
      ${opts.maxLength ? `maxlength="${opts.maxLength}"` : ''}
      value="${esc(val)}"
    />`;
  if (opts.aiField) {
    return `<div class="btg-input-wrap">${inputHtml}${aiBar(opts.aiField)}</div>`;
  }
  return inputHtml;
}

export function inputTextarea(store, name, opts = {}) {
  const val = store.get(name) ?? '';
  const taHtml = `<textarea
      class="${TEXTAREA_CLASS}"
      data-field="${name}"
      rows="${opts.rows || 4}"
      placeholder="${esc(opts.placeholder || '')}"
    >${esc(val)}</textarea>`;
  if (opts.aiField) {
    return `<div class="btg-input-wrap">${taHtml}${aiBar(opts.aiField)}</div>`;
  }
  return taHtml;
}

// ─── TIPO DE CARTÃO (multi-select com cards grandes) ──────

const SITES = [
  { value: 'Partners', label: 'Partners', color: '#05132a' },
  { value: 'Ultrablue', label: 'Ultrablue', color: '#10408d' },
  { value: 'Operadora', label: 'Operadora', color: '#1a2b4a' },
];

export function inputTipoCartao(store) {
  const value = store.get('tipo_cartao') ?? [];
  return `
    <div class="btg-checkbox-grid" data-field="tipo_cartao">
      ${SITES.map((s) => {
        const checked = value.includes(s.value);
        return `
          <button type="button" class="btg-checkbox-card${checked ? ' is-checked' : ''}"
            data-value="${s.value}" data-toggle="tipo_cartao">
            <span style="color:${checked ? s.color : '#1f2937'};">${s.label}</span>
            <span class="btg-checkbox-mark">${checked ? icon('shield-check', 'icon-sm') : ''}</span>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

// ─── SIM / NÃO (oferta_destaque) ───────────────────────────

export function inputDestaque(store) {
  const value = store.get('oferta_destaque') ?? 'Não';
  return `
    <div class="btg-toggle-grid" data-field="oferta_destaque">
      ${['Sim', 'Não'].map((opt) => {
        const active = value === opt;
        return `
          <button type="button" class="btg-toggle-btn${active ? ' is-active is-' + (opt === 'Sim' ? 'yes' : 'no') : ''}"
            data-value="${opt}" data-set="oferta_destaque">
            ${opt}
          </button>
        `;
      }).join('')}
    </div>
  `;
}

// ─── NACIONAL / INTERNACIONAL ──────────────────────────────

export function inputNacional(store) {
  const value = store.get('nacional_internacional') ?? '';
  return `
    <div class="btg-toggle-grid" data-field="nacional_internacional">
      ${['Nacional', 'Internacional'].map((opt) => {
        const active = value === opt;
        return `
          <button type="button" class="btg-toggle-btn${active ? ' is-active' : ''}"
            data-value="${opt}" data-set-toggle="nacional_internacional">
            ${opt}
          </button>
        `;
      }).join('')}
    </div>
  `;
}

// ─── PREÇO SOB CONSULTA ────────────────────────────────────

export function inputPrecoConsulta(store) {
  const sobConsulta = store.get('preco_sob_consulta') ?? false;
  return `
    <div class="btg-toggle-grid" data-field="preco_sob_consulta">
      <button type="button" class="btg-toggle-btn${!sobConsulta ? ' is-active' : ''}"
        data-bool="false" data-set-bool="preco_sob_consulta">
        Tem preço definido
      </button>
      <button type="button" class="btg-toggle-btn${sobConsulta ? ' is-active' : ''}"
        data-bool="true" data-set-bool="preco_sob_consulta">
        Sob consulta
      </button>
    </div>
  `;
}

// ─── PREÇO (moeda + parcelas + valor) ──────────────────────

export function inputPrecoValor(store) {
  const moeda = store.get('moeda') ?? 'R$';
  const parc = store.get('parcelamento') ?? '1';
  const valor = store.get('preco') ?? '';
  return `
    <div class="btg-preco-grid">
      <select class="${INPUT_CLASS}" data-field="moeda">
        <option value="R$"${moeda === 'R$' ? ' selected' : ''}>R$</option>
        <option value="US$"${moeda === 'US$' ? ' selected' : ''}>US$</option>
        <option value="EUR"${moeda === 'EUR' ? ' selected' : ''}>EUR</option>
      </select>
      <select class="${INPUT_CLASS}" data-field="parcelamento">
        ${[1,2,3,4,5,6,7,8,9,10].map((n) => `
          <option value="${n}"${String(parc) === String(n) ? ' selected' : ''}>${n === 1 ? '1x (à vista)' : n + 'x'}</option>
        `).join('')}
      </select>
      <input type="text" class="${INPUT_CLASS}" data-field="preco"
        placeholder="Valor (ex: 4.460,00)" value="${esc(valor)}" />
    </div>
  `;
}

// ─── SELECT GENÉRICO (sub-tipo concierge etc.) ─────────────

export function inputSelect(store, name, options, placeholder = 'Selecione') {
  const val = store.get(name) ?? '';
  return `
    <select class="${INPUT_CLASS}" data-field="${name}">
      <option value="">${esc(placeholder)}</option>
      ${options.map((o) => `<option value="${esc(o)}"${val === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}
    </select>
  `;
}

// ─── DATAS (início + fim) ──────────────────────────────────

export function inputDatas(store) {
  const ini = store.get('data_de_inicio') ?? '';
  const fim = store.get('data_final') ?? '';
  return `
    <div class="btg-datas-grid">
      <label>
        <span class="btg-datas__label">Início</span>
        <input type="date" class="${INPUT_CLASS}" data-field="data_de_inicio" value="${esc(ini)}" />
      </label>
      <label>
        <span class="btg-datas__label">Fim</span>
        <input type="date" class="${INPUT_CLASS}" data-field="data_final" value="${esc(fim)}" />
      </label>
    </div>
  `;
}

export function inputDataExpiracao(store) {
  const v = store.get('data_expiracao') ?? '';
  return `<input type="date" class="${INPUT_CLASS}" data-field="data_expiracao" value="${esc(v)}" />`;
}

// ─── ESCOLHA DE IMAGEM ──────────────────────────────────────
//
// 4.41.0+ (Fase 2.1 BTG migration): substitui o file input direto
// por um botão que abre o ImagePicker (modal com 2 abas: Banco curado
// + Upload novo). Mantém compat: `imagem_file` ainda existe pra retrocompat,
// mas o source-of-truth pra preview/save é `imagem_url`.

export function inputImagem(store) {
  const url = store.get('imagem_url') || '';
  const meta = store.get('imagem_meta');
  const file = store.get('imagem_file');

  if (url) {
    return `
      <div class="btg-dropzone btg-dropzone--filled">
        <div class="btg-dropzone__preview-img" style="background-image:url('${esc(url)}')"></div>
        <div class="btg-dropzone__preview-meta">
          ${meta?.name ? `<strong>${esc(meta.name)}</strong>` : ''}
          ${meta?.city || meta?.country ? `<span>${esc([meta.city, meta.country].filter(Boolean).join(', '))}</span>` : ''}
        </div>
        <button type="button" class="btg-dropzone__change" data-action="open-image-picker">
          Trocar imagem
        </button>
      </div>
    `;
  }

  if (file) {
    return `
      <div class="btg-dropzone btg-dropzone--filled">
        <div class="btg-dropzone__preview">
          <span class="btg-dropzone__filename">${esc(file.name)}</span>
          <span class="btg-dropzone__size">${(file.size / 1024).toFixed(1)} KB</span>
        </div>
        <button type="button" class="btg-dropzone__change" data-action="open-image-picker">
          Trocar imagem
        </button>
      </div>
    `;
  }

  return `
    <button type="button" class="btg-dropzone" data-action="open-image-picker">
      <div class="btg-dropzone__empty">
        ${icon('upload', 'icon-md')}
        <span>Escolher imagem</span>
        <small>Banco curado de hotéis premium · ou upload novo</small>
      </div>
    </button>
  `;
}

// ─── INCLUI NO PACOTE (blocos repetíveis) ──────────────────
//
// Lista estruturada de inclusões. Cada bloco tem subtitulo (opcional,
// destaque em negrito na página), topicos (multi-linha — 1 item por linha,
// bullet auto) e valor (opcional — destaque tipo "A partir de USD 250").
//
// Múltiplos blocos permitem combos (ex: Classic Valentine's + Culinary).
// Compat: quando vazio, oferece estado-empty com botão "Adicionar inclusão".
// Bootstrap em modo edit auto-popula 1 bloco a partir do legado
// `incluso_no_pacote` quando a oferta antiga não tem blocos.

export function inputInclusoes(store) {
  const blocks = store.get('inclusoes') || [];

  if (blocks.length === 0) {
    return `
      <button type="button" class="btg-incluso-empty" data-block-add="inclusoes">
        <span class="btg-incluso-empty__plus">+</span>
        <span>Adicionar inclusão</span>
      </button>
    `;
  }

  return `
    <div class="btg-incluso-list">
      ${blocks.map((b, idx) => `
        <div class="btg-incluso-block">
          <div class="btg-incluso-block__head">
            <p class="btg-incluso-block__label">Inclusão ${idx + 1}</p>
            <button type="button" class="btg-incluso-block__remove"
              data-block-remove="inclusoes" data-block-idx="${idx}">
              Remover
            </button>
          </div>
          <div class="btg-incluso-block__fields">
            <label class="btg-incluso-block__field">
              <span class="btg-incluso-block__field-label">Subtítulo (opcional)</span>
              <input type="text" class="${INPUT_CLASS}"
                placeholder="Ex: Classic Valentine's Experience"
                data-block-path="inclusoes.${idx}.subtitulo"
                value="${esc(b.subtitulo || '')}" />
            </label>
            <label class="btg-incluso-block__field">
              <span class="btg-incluso-block__field-label">Tópicos da inclusão</span>
              <textarea class="${TEXTAREA_CLASS}" rows="5"
                placeholder="Garrafa de vinho no quarto no check-in&#10;Massagem relaxante (50min)&#10;Aula de culinária"
                data-block-path="inclusoes.${idx}.topicos">${esc(b.topicos || '')}</textarea>
              <small class="btg-incluso-block__hint">Um item por linha. O bullet (•) é adicionado automaticamente.</small>
            </label>
            <label class="btg-incluso-block__field">
              <span class="btg-incluso-block__field-label">Valor (opcional)</span>
              <input type="text" class="${INPUT_CLASS}"
                placeholder="Ex: A partir de USD 250 por pessoa"
                data-block-path="inclusoes.${idx}.valor"
                value="${esc(b.valor || '')}" />
            </label>
          </div>
        </div>
      `).join('')}
      <button type="button" class="btg-incluso-add" data-block-add="inclusoes">
        <span class="btg-incluso-add__plus">+</span>
        <span>Adicionar outra inclusão</span>
      </button>
    </div>
  `;
}

// ─── EVENT BINDING ──────────────────────────────────────────

/**
 * Liga os listeners de change/input ao container do form.
 *
 * @param {HTMLElement} container
 * @param {Object} store
 * @param {Object} [opts]
 * @param {() => void} [opts.onButtonChange]  Re-render callback chamado após cliques
 *   em botões (toggle, sim/não, etc.) — necessário pro estado visual atualizar.
 */
export function bindFormEvents(container, store, opts = {}) {
  const triggerRerender = () => {
    if (typeof opts.onButtonChange === 'function') opts.onButtonChange();
  };

  // Inputs de texto / textarea / select (digitação — sem re-render pra não perder foco)
  container.addEventListener('input', (e) => {
    const t = e.target;
    // Inputs aninhados em blocos repetíveis: data-block-path="parent.idx.key"
    if (t.dataset && t.dataset.blockPath) {
      const [parent, idxStr, key] = t.dataset.blockPath.split('.');
      const idx = Number(idxStr);
      const arr = (store.get(parent) || []).slice();
      if (!arr[idx]) arr[idx] = {};
      arr[idx] = { ...arr[idx], [key]: t.value };
      store.set(parent, arr);
      return;
    }
    if (t.dataset && t.dataset.field) {
      store.set(t.dataset.field, t.value);
    }
  });

  container.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.field && (t.tagName === 'SELECT' || t.type === 'date')) {
      store.set(t.dataset.field, t.value);
    }
    // File picker da imagem (legacy — mantido pra compat caso algum lugar
    // ainda use input type="file" direto). 4.41.0+ caminho principal é o
    // botão `data-action="open-image-picker"` que abre o ImagePicker.
    if (t.type === 'file' && t.dataset.imagemInput !== undefined) {
      const f = t.files?.[0];
      if (f) {
        store.set('imagem_file', f);
        store.set('imagem_url', '');  // file local invalida URL anterior
        store.set('imagem_meta', null);
        triggerRerender();
      }
    }
  });

  // Botões — re-render após clique pra UI refletir o estado
  container.addEventListener('click', (e) => {
    // 4.42.0+ BTG IA (Sugerir / Revisar). Botões aparecem só quando
    // o input/textarea foi renderizado com opts.aiField. Em staging
    // o cliente usa mocks; em produção chama callLLM via Functions.
    const aiBtn = e.target.closest('[data-ai-action]');
    if (aiBtn) {
      e.preventDefault();
      const action = aiBtn.dataset.aiAction;
      const field = aiBtn.dataset.aiField;
      const statusEl = container.querySelector(`[data-ai-status="${field}"]`);
      const setBusy = (msg) => {
        if (statusEl) { statusEl.hidden = false; statusEl.textContent = msg; statusEl.className = 'btg-ai-status is-busy'; }
        container.querySelectorAll(`[data-ai-field="${field}"]`).forEach((b) => { b.disabled = true; });
      };
      const setIdle = (msg = '', kind = 'ok') => {
        if (statusEl) {
          if (msg) { statusEl.hidden = false; statusEl.textContent = msg; statusEl.className = `btg-ai-status is-${kind}`; }
          else { statusEl.hidden = true; }
        }
        container.querySelectorAll(`[data-ai-field="${field}"]`).forEach((b) => { b.disabled = false; });
      };

      (async () => {
        try {
          if (action === 'sugerir') {
            setBusy('Gerando sugestão...');
            const res = await aiSugerir({ field, values: store.values() });
            if (!res.text) { setIdle('Vazio.', 'err'); return; }
            const current = store.get(field) || '';
            if (current && !confirm('Já existe texto nesse campo. Substituir pela sugestão?')) {
              setIdle('Cancelado.', 'ok');
              return;
            }
            store.set(field, res.text);
            triggerRerender();
            setIdle(res.mock ? '✓ Sugestão aplicada (mock — staging)' : '✓ Sugestão aplicada', 'ok');
          } else if (action === 'revisar') {
            const text = store.get(field) || '';
            if (!text.trim()) { setIdle('Preencha o campo antes de revisar.', 'err'); return; }
            setBusy('Revisando...');
            const res = await aiRevisar({ text, type: 'completo' });
            if (!res.text || res.text === text) {
              setIdle(res.mock ? '✓ Sem alterações (mock — staging)' : '✓ Nada pra revisar', 'ok');
              return;
            }
            if (!confirm(`Substituir o texto pelo revisado?\n\nNovo:\n"${res.text.slice(0, 240)}${res.text.length > 240 ? '...' : ''}"`)) {
              setIdle('Cancelado.', 'ok');
              return;
            }
            store.set(field, res.text);
            triggerRerender();
            setIdle(res.mock ? '✓ Revisão aplicada (mock — staging)' : '✓ Revisão aplicada', 'ok');
          }
        } catch (err) {
          console.error('[btg-ai]', err);
          setIdle(`Erro: ${err.message}`, 'err');
        }
      })();
      return;
    }

    // 4.41.0+ BTG image picker (modal com banco curado + upload novo).
    // Captura clicks no botão de escolher/trocar imagem, abre o modal,
    // e ao escolher seta imagem_url no store + limpa file local.
    const pickerBtn = e.target.closest('[data-action="open-image-picker"]');
    if (pickerBtn) {
      e.preventDefault();
      openImagePicker({ initialUrl: store.get('imagem_url') || '' }).then((result) => {
        if (!result) return; // usuário cancelou
        store.set('imagem_url', result.url);
        store.set('imagem_meta', {
          name: result.name,
          placeName: result.placeName,
          country: result.country,
          city: result.city,
        });
        store.set('imagem_file', null);
        triggerRerender();
      });
      return;
    }

    // Blocos repetíveis: adicionar novo bloco vazio
    const addBlock = e.target.closest('[data-block-add]');
    if (addBlock) {
      const field = addBlock.dataset.blockAdd;
      const arr = (store.get(field) || []).slice();
      // Shape do bloco depende do campo. Por enquanto só "inclusoes".
      const empty = field === 'inclusoes'
        ? { subtitulo: '', topicos: '', valor: '' }
        : {};
      arr.push(empty);
      store.set(field, arr);
      triggerRerender();
      return;
    }

    // Blocos repetíveis: remover bloco em idx
    const removeBlock = e.target.closest('[data-block-remove]');
    if (removeBlock) {
      const field = removeBlock.dataset.blockRemove;
      const idx = Number(removeBlock.dataset.blockIdx);
      const arr = (store.get(field) || []).slice();
      arr.splice(idx, 1);
      store.set(field, arr);
      triggerRerender();
      return;
    }

    const btn = e.target.closest('[data-toggle]');
    if (btn) {
      const field = btn.dataset.toggle;
      const value = btn.dataset.value;
      const arr = (store.get(field) || []).slice();
      const idx = arr.indexOf(value);
      if (idx >= 0) arr.splice(idx, 1);
      else arr.push(value);
      store.set(field, arr);
      triggerRerender();
      return;
    }
    const setBtn = e.target.closest('[data-set]');
    if (setBtn) {
      store.set(setBtn.dataset.set, setBtn.dataset.value);
      triggerRerender();
      return;
    }
    const setToggleBtn = e.target.closest('[data-set-toggle]');
    if (setToggleBtn) {
      const f = setToggleBtn.dataset.setToggle;
      const v = setToggleBtn.dataset.value;
      store.set(f, store.get(f) === v ? '' : v);
      triggerRerender();
      return;
    }
    const boolBtn = e.target.closest('[data-set-bool]');
    if (boolBtn) {
      store.set(boolBtn.dataset.setBool, boolBtn.dataset.bool === 'true');
      triggerRerender();
      return;
    }
  });
}
