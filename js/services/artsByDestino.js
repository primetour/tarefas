/**
 * artsByDestino — adapta as coleções do Portal de Dicas pro wizard de Artes.
 *
 * Estratégia:
 *   - 1 fetch global de portal_images em fetchDestinos() (sem filtro de assetCategory:
 *     pega location, hotel, restaurant, etc — só exclui logo). Cache local indexado
 *     por city E country (fallback se cidade vazia).
 *   - buildSlidesForDestino chama fetchTip() e fatia os segmentos em 7 highlights.
 */

import { DEFAULT_SEGMENTS, fetchDestinations, fetchTip, fetchImages } from './portal.js';

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

// Round-robin por país: cada destino sem foto-cidade pega a PRÓXIMA foto
// do pool do país, ciclando. Garante distribuição estrita e diferente
// para cidades vizinhas mesmo com pool pequeno.
const _paisCursors = new Map();   // country lowercase → next index

function pickCapaUrl(d, imgs) {
  if (!imgs.length) return '';
  // Se as imagens são da CIDADE exata, sempre a 1ª (consistência)
  const isCityMatch = (_imagesByCity.get(normKey(d.city)) || []).length > 0;
  if (isCityMatch) return imgs[0]?.url || '';
  // Fallback de país — round-robin estrito
  const k = normKey(d.country);
  const cur = _paisCursors.get(k) || 0;
  _paisCursors.set(k, cur + 1);
  return imgs[cur % imgs.length]?.url || '';
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
  _paisCursors.clear();
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
      capaUrl: pickCapaUrl(d, imgs),
      disponivel: true,
      paletaFaixa: '#2BA9A7',
      continent: d.continent || '',
      country: d.country || '',
      _raw: d,
    };
  });
}

/* ── Slides: tip real fatiado em highlights ─────────────────
   Usa DEFAULT_SEGMENTS importado de portal.js (mesma source-of-truth
   do Portal de Dicas) + extração POR MODE (special_info / simple_list /
   place_list / agenda) respeitando o schema híbrido title/titulo, description/descricao.
*/

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function pickItemTitle(it) { return it?.title || it?.titulo || ''; }
function pickItemDesc(it)  { return it?.description || it?.descricao || ''; }

// Extrai texto curto pra descrição do highlight, respeitando o `mode` do segmento
// (mesmas regras que o portalGenerator usa internamente).
function segmentToHighlightText(segDef, segData) {
  if (!segData) return '';

  if (segDef.mode === 'special_info') {
    // Informações Gerais: descricao livre é o melhor candidato
    const inf = segData.info || {};
    return inf.descricao || inf.dica || '';
  }

  if (segDef.mode === 'simple_list') {
    // Bairros / Arredores: themeDesc (intro do segmento) OU lista dos primeiros 3
    if (segData.themeDesc && segData.themeDesc.trim()) return segData.themeDesc;
    const titles = (segData.items || []).map(pickItemTitle).filter(Boolean).slice(0, 4);
    if (titles.length === 0) return '';
    if (titles.length === 1) return titles[0];
    return `${titles.slice(0, -1).join(', ')} e ${titles.slice(-1)}.`;
  }

  if (segDef.mode === 'place_list' || segDef.mode === 'agenda') {
    // Atrações / Restaurantes / etc: descrição do 1º item OU lista dos primeiros 3
    const items = (segData.items || []).filter(pickItemTitle);
    if (!items.length) return '';
    const firstWithDesc = items.find(pickItemDesc);
    if (firstWithDesc) return pickItemDesc(firstWithDesc);
    const titles = items.slice(0, 3).map(pickItemTitle);
    return `Lugares como ${titles.join(', ')}.`;
  }

  // Fallback genérico (custom segments)
  if (typeof segData.content === 'string') return segData.content;
  return '';
}

function tipToHighlights(tip) {
  if (!tip?.segments) return [];
  const out = [];
  for (const segDef of DEFAULT_SEGMENTS) {
    const segData = tip.segments[segDef.key];
    const txt = segmentToHighlightText(segDef, segData);
    const clean = stripHtml(txt);
    if (!clean) continue;
    out.push({
      nome: segDef.label,
      titulo: segDef.label.toUpperCase(),
      descricao: clean.length > 180 ? clean.slice(0, 177) + '...' : clean,
    });
  }
  return out;
}

export async function buildSlidesForDestino(destino) {
  // Destino sintético (hotel/restaurante/etc): usa as fotos do estabelecimento
  // E busca o tip da CIDADE REAL pra ter conteúdo editorial.
  const isSintetico = !!destino._sintetico;
  const imgs = isSintetico ? destino._fotos : getImagesForDestino(destino);
  const tipDestinoId = isSintetico ? destino._destinoReal?.id : destino.id;
  const nome = destino.nome;
  const foto = (idx) => imgs[idx % Math.max(imgs.length, 1)]?.url || '';

  let highlights = [];
  if (tipDestinoId) {
    try {
      const tip = await fetchTip(tipDestinoId);
      highlights = tipToHighlights(tip);
      console.log('[artsByDestino] tip:', tipDestinoId, '| segmentos com conteudo:', highlights.length);
    } catch (e) {
      console.warn('[artsByDestino] erro ao buscar tip:', e);
    }
  } else if (isSintetico) {
    console.info('[artsByDestino] estabelecimento sem destino real correspondente:', destino.nome);
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

// Categorias disponíveis no picker (espelham ASSET_CATEGORIES do portal.js,
// excluindo logo). Cada uma vira uma aba no banco curado.
export const PICKER_CATEGORIAS = [
  { key: 'todas',      label: 'Todas',       icon: '🖼' },
  { key: 'location',   label: 'Destinos',    icon: '📍' },
  { key: 'hotel',      label: 'Hotéis',      icon: '🏨' },
  { key: 'restaurant', label: 'Restaurantes',icon: '🍽' },
  { key: 'train',      label: 'Trens',       icon: '🚄' },
  { key: 'cruise',     label: 'Cruzeiros',   icon: '🚢' },
];

export function getBancoCuradoForDestino(destino, categoria = 'todas') {
  // Sintético: começa com fotos do estabelecimento + fotos da cidade real
  let imgs;
  if (destino?._sintetico) {
    const cidadeImgs = destino._destinoReal ? getImagesForDestino(destino._destinoReal) : [];
    // Fotos do estabelecimento PRIMEIRO, depois resto da cidade (sem duplicar)
    const seen = new Set(destino._fotos.map(f => f.id));
    imgs = [...destino._fotos, ...cidadeImgs.filter(i => !seen.has(i.id))];
  } else {
    imgs = getImagesForDestino(destino);
  }
  if (categoria && categoria !== 'todas') {
    imgs = imgs.filter(img => img.assetCategory === categoria);
  }
  return imgs.map(img => ({
    id: img.id,
    url: img.url,
    nome: img.name || img.assetCategory || 'Foto',
    assetCategory: img.assetCategory,
  }));
}

// Quantas fotos cada categoria tem pra esse destino (pra mostrar badge nas abas)
export function getBancoCuradoCounts(destino) {
  let imgs;
  if (destino?._sintetico) {
    const cidadeImgs = destino._destinoReal ? getImagesForDestino(destino._destinoReal) : [];
    const seen = new Set(destino._fotos.map(f => f.id));
    imgs = [...destino._fotos, ...cidadeImgs.filter(i => !seen.has(i.id))];
  } else {
    imgs = getImagesForDestino(destino);
  }
  const counts = { todas: imgs.length };
  for (const cat of PICKER_CATEGORIAS) {
    if (cat.key === 'todas') continue;
    counts[cat.key] = imgs.filter(img => img.assetCategory === cat.key).length;
  }
  return counts;
}

/**
 * Set das categorias com pelo menos 1 foto disponível pra esse destino.
 * Usado pelos filtros de tipo na tela welcome (mostrar só destinos
 * que têm hotel/restaurante/etc cadastrado).
 */
export function getCategoriasParaDestino(destino) {
  const imgs = getImagesForDestino(destino);
  const set = new Set();
  for (const img of imgs) {
    if (img.assetCategory && img.assetCategory !== 'logo') {
      set.add(img.assetCategory);
    }
  }
  return set;
}

/**
 * Cards sintéticos por estabelecimento (Hotel/Restaurante/etc) — agrupa
 * imagens por `name`, cada nome único vira UM card. Conteúdo dos slides
 * vem do tip da cidade (qualidade editorial mantida); apenas as fotos
 * são do estabelecimento.
 */
export function getEstabelecimentosTipo(tipo, destinosReais) {
  // Coleta todas as imagens dessa categoria do índice geral
  const todas = [];
  for (const arr of _imagesByCity.values()) for (const img of arr) {
    if (img.assetCategory === tipo) todas.push(img);
  }
  // Dedupe (mesma imagem pode estar indexada por city e country)
  const seen = new Set();
  const imgs = todas.filter(img => {
    if (seen.has(img.id)) return false;
    seen.add(img.id);
    return true;
  });

  // Agrupa por name
  const grouped = new Map();
  for (const img of imgs) {
    if (!img.name) continue;
    if (!grouped.has(img.name)) {
      grouped.set(img.name, {
        name: img.name, city: img.city, country: img.country,
        continent: img.continent, fotos: [],
      });
    }
    grouped.get(img.name).fotos.push(img);
  }

  // Vira destino sintético
  return [...grouped.values()].map(g => {
    const destinoReal = destinosReais.find(d =>
      normKey(d._raw?.city || d.city) === normKey(g.city) &&
      normKey(d._raw?.country || d.country) === normKey(g.country)
    );
    return {
      id: `${tipo}:${g.name}`,
      nome: g.name,
      subtitulo: [g.city, g.country].filter(Boolean).join(' · '),
      capaUrl: g.fotos[0]?.url || '',
      disponivel: true,
      paletaFaixa: '#2BA9A7',
      continent: g.continent || '',
      country: g.country || '',
      _sintetico: true,
      _tipo: tipo,
      _destinoReal: destinoReal || null,
      _fotos: g.fotos,
      _raw: { city: g.city, country: g.country, continent: g.continent },
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// API legada (não usada mais — wizard usa getBancoCuradoForDestino direto)
export async function fetchBancoCurado(destinoId) {
  console.warn('[artsByDestino] fetchBancoCurado(id) deprecated; use getBancoCuradoForDestino(destino)');
  return [];
}
