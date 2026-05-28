/**
 * artsByDestino — adapta as coleções do Portal de Dicas pro wizard de Artes.
 *
 * Estratégia:
 *   - 1 fetch global de portal_images em fetchDestinos() (sem filtro de assetCategory:
 *     pega location, hotel, restaurant, etc — só exclui logo). Cache local indexado
 *     por city E country (fallback se cidade vazia).
 *   - buildSlidesForDestino chama fetchTip() e fatia os segmentos em 7 highlights.
 */

import { fetchDestinations, fetchTip, fetchImages } from './portal.js';

// Caches locais (populados em fetchDestinos)
let _imagesByCity    = new Map();   // city lowercase trim → array de imagens
let _imagesByCountry = new Map();   // country lowercase trim → array

const normKey = s => (s || '').toString().toLowerCase().trim();

function getImagesForDestino(destino) {
  const raw = destino?._raw || destino || {};
  const byCity    = _imagesByCity.get(normKey(raw.city)) || [];
  if (byCity.length) return byCity;
  return _imagesByCountry.get(normKey(raw.country)) || [];
}

/* ── Destinos + indexação global de imagens ───────────────── */

export async function fetchDestinos() {
  const [docs, allImgs] = await Promise.all([
    fetchDestinations(),
    fetchImages({}),    // sem filtros — pega tudo (até 500)
  ]);

  console.log('[artsByDestino] portal_destinations:', docs.length, '| portal_images:', allImgs.length);

  _imagesByCity = new Map();
  _imagesByCountry = new Map();
  for (const img of allImgs) {
    if (img.assetCategory === 'logo') continue;
    if (!img.url) continue;
    if (img.city) {
      const k = normKey(img.city);
      if (!_imagesByCity.has(k)) _imagesByCity.set(k, []);
      _imagesByCity.get(k).push(img);
    }
    if (img.country) {
      const k = normKey(img.country);
      if (!_imagesByCountry.has(k)) _imagesByCountry.set(k, []);
      _imagesByCountry.get(k).push(img);
    }
  }

  return docs.map(d => {
    const imgs = (_imagesByCity.get(normKey(d.city)) || []).length
      ? _imagesByCity.get(normKey(d.city))
      : (_imagesByCountry.get(normKey(d.country)) || []);
    return {
      id: d.id,
      nome: d.city || d.country || '—',
      subtitulo: [d.country, d.continent].filter(Boolean).join(' · ') || ' ',
      capaUrl: imgs[0]?.url || '',
      disponivel: true,
      paletaFaixa: '#2BA9A7',
      _raw: d,
    };
  });
}

/* ── Slides: tip real fatiado em highlights ───────────────── */

// Mapeamento das chaves de segmento pra labels usados no manuscrito do slide
const SEGMENT_LABELS = {
  informacoes_gerais: 'Visão geral',
  bairros:            'Bairros',
  atracoes:           'Atrações',
  atracoes_criancas:  'Pra crianças',
  restaurantes:       'Gastronomia',
  vida_noturna:       'Vida noturna',
  espetaculos:        'Espetáculos',
  compras:            'Compras',
  arredores:          'Arredores',
  highlights:         'Highlights',
  agenda_cultural:    'Agenda cultural',
};

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function segmentToText(seg) {
  if (!seg) return '';
  if (seg.content && typeof seg.content === 'string') {
    return stripHtml(seg.content);
  }
  if (Array.isArray(seg.items) && seg.items.length) {
    return seg.items.slice(0, 3).map(it => it.name || it.title || it.description || '').filter(Boolean).join(', ');
  }
  if (seg.info && typeof seg.info === 'object') {
    return Object.values(seg.info).filter(v => typeof v === 'string' && v.trim()).join(' · ');
  }
  return '';
}

function tipToHighlights(tip) {
  if (!tip?.segments) return [];
  const out = [];
  for (const [key, seg] of Object.entries(tip.segments)) {
    const txt = segmentToText(seg);
    if (!txt) continue;
    const label = SEGMENT_LABELS[key] || key.replace(/_/g, ' ');
    out.push({
      nome: label,
      titulo: label.toUpperCase(),
      descricao: txt.length > 180 ? txt.slice(0, 177) + '...' : txt,
    });
  }
  return out;
}

export async function buildSlidesForDestino(destino) {
  const imgs = getImagesForDestino(destino);
  const nome = destino.nome;
  const foto = (idx) => imgs[idx % Math.max(imgs.length, 1)]?.url || '';

  let highlights = [];
  try {
    const tip = await fetchTip(destino.id);
    highlights = tipToHighlights(tip);
    console.log('[artsByDestino] tip:', destino.id, '| segmentos com conteudo:', highlights.length);
  } catch (e) {
    console.warn('[artsByDestino] erro ao buscar tip:', e);
  }

  // Fallback se destino não tem tip
  if (!highlights.length) {
    highlights = Array.from({ length: 7 }, (_, i) => ({
      nome: `${nome} ${String(i + 2).padStart(2, '0')}`,
      titulo: `PONTO ALTO ${i + 2}`,
      descricao: 'Cadastre conteúdo deste destino no Portal de Dicas pra aparecer aqui.',
    }));
  }

  // Distribui os 7 highlights nos 3 layouts disponíveis (variedade visual)
  const layouts = ['foto-cima', 'lateral-esq', 'foto-cima', 'lateral-dir', 'foto-cima', 'lateral-esq', 'foto-cima'];
  const slides = [
    { id: 'capa', layoutId: 'capa', nome, titulo: 'Tudo sobre', descricao: '', fotoUrl: foto(0) },
  ];
  highlights.slice(0, 7).forEach((h, i) => {
    slides.push({
      id: `h${i + 1}`,
      layoutId: layouts[i],
      nome: h.nome,
      titulo: h.titulo,
      descricao: h.descricao,
      fotoUrl: foto(i + 1),
    });
  });
  return slides;
}

/* ── Banco curado pro picker de fotos (sheet Foto) ────────── */

export function getBancoCuradoForDestino(destino) {
  return getImagesForDestino(destino).map(img => ({
    id: img.id,
    url: img.url,
    nome: img.name || img.assetCategory || 'Foto',
  }));
}

// API legada (não usada mais — wizard usa getBancoCuradoForDestino direto)
export async function fetchBancoCurado(destinoId) {
  console.warn('[artsByDestino] fetchBancoCurado(id) deprecated; use getBancoCuradoForDestino(destino)');
  return [];
}
