/**
 * BTG Image Picker — modal com 2 abas (Banco curado / Upload novo).
 *
 * - Aba "Banco curado": lê coleção `portal_images_dev` (Firestore staging)
 *   ou `portal_images` (produção, quando migrar). Filtra por país/cidade
 *   e busca por texto livre (nome/placeName/tags).
 * - Aba "Upload novo": em staging fica desabilitada com mensagem
 *   ("Disponível em produção"). Em produção: TODO Fase 5 (Cloud Function
 *   getR2UploadUrl + CORS dos domínios finais).
 *
 * API:
 *   const result = await openImagePicker({ initialUrl?: string });
 *   // result === null  →  user fechou sem escolher
 *   // result === { url, name, placeName, country, city, assetCategory, tags }
 *
 * Uso típico:
 *   import { openImagePicker } from '/btg/shared/btg-image-picker.js';
 *   const img = await openImagePicker();
 *   if (img) store.set('imagem_url', img.url);
 */

import { getBtgFirebase } from './btg-firebase.js';

const COLLECTION = 'portal_images_dev'; // produção: 'portal_images'
const PAGE_LIMIT = 100;
const STAGING = true; // produção: false (libera aba Upload novo)

let cachedImages = null; // cache in-memory (re-fetch só ao fechar/reabrir)

// ─── DOM helpers ────────────────────────────────────────────

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'innerHTML') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ─── Data layer ─────────────────────────────────────────────

async function fetchImages() {
  if (cachedImages) return cachedImages;
  const { db, configured, reason } = await getBtgFirebase();
  if (!configured) {
    console.warn(`[btg-image-picker] firebase não configurado (${reason}). Banco vazio.`);
    cachedImages = [];
    return cachedImages;
  }
  const { collection, getDocs, query, orderBy, limit } = await import(
    'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
  );
  const q = query(
    collection(db, COLLECTION),
    orderBy('uploadedAt', 'desc'),
    limit(PAGE_LIMIT),
  );
  const snap = await getDocs(q);
  cachedImages = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return cachedImages;
}

// ─── Filtros / busca ────────────────────────────────────────

function applyFilters(images, { search, country }) {
  let result = images;
  if (country && country !== '__all__') {
    result = result.filter(img => img.country === country);
  }
  if (search?.trim()) {
    const needle = search.trim().toLowerCase();
    result = result.filter(img => {
      const hay = [
        img.name, img.placeName, img.city, img.country, img.continent,
        ...(img.tags || []),
      ].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }
  return result;
}

function uniqueCountries(images) {
  const set = new Set();
  for (const img of images) {
    if (img.country) set.add(img.country);
  }
  return [...set].sort();
}

// ─── Render ─────────────────────────────────────────────────

function renderGrid(images, container, onPick) {
  container.innerHTML = '';
  if (images.length === 0) {
    container.appendChild(el('div', { className: 'btg-picker__empty' },
      'Nenhuma imagem encontrada com esses filtros.'));
    return;
  }
  for (const img of images) {
    const card = el('button', {
      className: 'btg-picker__card',
      type: 'button',
      'data-id': img.id,
      onClick: () => onPick(img),
    },
      el('div', {
        className: 'btg-picker__thumb',
        style: `background-image: url('${esc(img.url)}')`,
      }),
      el('div', { className: 'btg-picker__meta' },
        el('strong', { className: 'btg-picker__name' }, img.name || ''),
        el('span', { className: 'btg-picker__place' }, [img.city, img.country].filter(Boolean).join(', ')),
      ),
    );
    container.appendChild(card);
  }
}

// ─── Entry point ────────────────────────────────────────────

export function openImagePicker(opts = {}) {
  return new Promise(async (resolve) => {
    const { initialUrl } = opts;

    // Backdrop + modal shell
    const backdrop = el('div', { className: 'btg-picker-backdrop' });
    const modal = el('div', { className: 'btg-picker', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'btg-picker-title' });

    const close = (result) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', onKey);

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(null);
    });

    // Header
    const closeBtn = el('button', { className: 'btg-picker__close', type: 'button', 'aria-label': 'Fechar', onClick: () => close(null) }, '×');
    const header = el('header', { className: 'btg-picker__header' },
      el('h2', { id: 'btg-picker-title', className: 'btg-picker__title' }, 'Escolher imagem'),
      closeBtn,
    );

    // Tabs
    const tabCurado = el('button', { className: 'btg-picker__tab is-active', type: 'button', 'data-tab': 'curado' }, '📚 Banco curado');
    const tabUpload = el('button', { className: 'btg-picker__tab', type: 'button', 'data-tab': 'upload' }, '⬆️ Upload novo');
    const tabs = el('nav', { className: 'btg-picker__tabs' }, tabCurado, tabUpload);

    // Curado panel
    const searchInput = el('input', {
      className: 'btg-picker__search', type: 'search', placeholder: 'Buscar por hotel, cidade, tag...',
    });
    const countrySelect = el('select', { className: 'btg-picker__select' });
    const filters = el('div', { className: 'btg-picker__filters' }, searchInput, countrySelect);
    const grid = el('div', { className: 'btg-picker__grid' });
    const loadingEl = el('div', { className: 'btg-picker__loading' }, 'Carregando banco curado...');
    const curadoPanel = el('div', { className: 'btg-picker__panel', 'data-panel': 'curado' }, filters, loadingEl, grid);

    // Upload panel (desabilitado em staging)
    const uploadPanel = el('div', { className: 'btg-picker__panel', 'data-panel': 'upload', hidden: 'hidden' },
      el('div', { className: 'btg-picker__upload-msg' },
        el('div', { className: 'btg-picker__upload-icon' }, 'ⓘ'),
        el('h3', {}, 'Upload de imagem nova — disponível em produção'),
        el('p', {},
          'No ambiente de staging o upload pra Cloudflare R2 está desativado ',
          '(precisa de Cloud Function + plano Blaze). ',
          'Por ora, escolha uma imagem do ',
          el('button', { className: 'btg-picker__link', type: 'button', onClick: () => switchTab('curado') }, 'banco curado'),
          '.'
        ),
      ),
    );

    // Tab switching
    const switchTab = (which) => {
      [tabCurado, tabUpload].forEach(t => t.classList.toggle('is-active', t.dataset.tab === which));
      curadoPanel.hidden = which !== 'curado';
      uploadPanel.hidden = which !== 'upload';
    };
    tabCurado.addEventListener('click', () => switchTab('curado'));
    tabUpload.addEventListener('click', () => switchTab('upload'));

    // Body
    const body = el('div', { className: 'btg-picker__body' }, curadoPanel, uploadPanel);

    modal.appendChild(header);
    modal.appendChild(tabs);
    modal.appendChild(body);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    // Carrega imagens
    const images = await fetchImages();
    loadingEl.remove();

    // Popula select de país
    const countries = uniqueCountries(images);
    countrySelect.appendChild(el('option', { value: '__all__' }, 'Todos os países'));
    for (const c of countries) {
      countrySelect.appendChild(el('option', { value: c }, c));
    }

    const onPick = (img) => {
      close({
        url: img.url,
        name: img.name || '',
        placeName: img.placeName || '',
        country: img.country || '',
        city: img.city || '',
        assetCategory: img.assetCategory || '',
        tags: img.tags || [],
      });
    };

    let state = { search: '', country: '__all__' };
    const refresh = () => {
      const filtered = applyFilters(images, state);
      renderGrid(filtered, grid, onPick);
    };
    refresh();

    searchInput.addEventListener('input', (e) => { state.search = e.target.value; refresh(); });
    countrySelect.addEventListener('change', (e) => { state.country = e.target.value; refresh(); });

    // Foco inicial no search
    setTimeout(() => searchInput.focus(), 50);
  });
}

// Limpa cache (útil se o seed rodou e queremos ver imagens novas)
export function clearImagePickerCache() {
  cachedImages = null;
}
