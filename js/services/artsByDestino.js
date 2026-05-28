/**
 * artsByDestino — adapta Portal de Dicas + Banco de Imagens pro Gerador de Imagens.
 *
 * Guard-rails (Renê escolheu modo "honesto"):
 *   - Calcula qualidade da tip de cada destino (sem ▲ inventar conteúdo).
 *   - Hero determinístico: destaque → banner → galeria (espelha portalGenerator).
 *   - Filtragem por segHasContent (mesma lógica do Portal de Dicas).
 *   - Suporta segments custom (getSegments async, não só DEFAULT_SEGMENTS).
 *   - Schema híbrido title|titulo / description|descricao.
 *
 * NÃO mexe em Portal de Dicas / Banco de Imagens — só lê.
 */

import {
  DEFAULT_SEGMENTS, getSegments,
  fetchDestinations, fetchTips, fetchImages,
} from './portal.js';

// Caches (populados em fetchDestinos)
let _imagesByCity    = new Map();
let _imagesByCountry = new Map();
let _tipsByDestId    = new Map();
let _segmentsAll     = DEFAULT_SEGMENTS;   // builtin + custom (carregado async)

const normKey = s => (s || '').toString().toLowerCase().trim();

/* ── Hero determinístico (espelha portalGenerator.resolveImages) ── */
function pickHeroFromImgs(imgs) {
  if (!imgs.length) return '';
  return (imgs.find(i => i.type === 'destaque')?.url)
      || (imgs.find(i => i.type === 'banner')?.url)
      || (imgs.find(i => i.type === 'galeria')?.url)
      || (imgs[0]?.url || '');
}

// Round-robin no fallback de PAÍS (quando não tem foto da cidade exata)
const _paisCursors = new Map();
function pickCapaUrl(d, imgs) {
  if (!imgs.length) return '';
  const isCityMatch = (_imagesByCity.get(normKey(d.city)) || []).length > 0;
  if (isCityMatch) return pickHeroFromImgs(imgs);
  // Fallback país: round-robin (cada destino sem foto-cidade pega uma diferente)
  const k = normKey(d.country);
  const cur = _paisCursors.get(k) || 0;
  _paisCursors.set(k, cur + 1);
  return imgs[cur % imgs.length]?.url || '';
}

function getImagesForDestino(destino) {
  const raw = destino?._raw || destino || {};
  const byCity = _imagesByCity.get(normKey(raw.city)) || [];
  if (byCity.length) return byCity;
  return _imagesByCountry.get(normKey(raw.country)) || [];
}

/* ── Qualidade da tip (mesma lógica de fetchAvailableSegments do portal.js) ── */
function segHasContent(seg) {
  if (!seg) return false;
  if (seg.info && Object.values(seg.info).some(v => v && String(v).trim())) return true;
  if (typeof seg.content === 'string' && seg.content.trim()) return true;
  if (Array.isArray(seg.items) && seg.items.length > 0) return true;
  return false;
}

function computeAvailableSegmentKeys(tip) {
  if (!tip?.segments) return [];
  return Object.entries(tip.segments)
    .filter(([, seg]) => segHasContent(seg))
    .map(([key]) => key);
}

// Classifica qualidade da tip: rich (5+) / partial (1-4) / empty (0 ou sem tip)
function tipQualidade(availableKeys) {
  if (availableKeys.length >= 5) return 'rich';
  if (availableKeys.length >= 1) return 'partial';
  return 'empty';
}

/* ── Destinos: carrega TUDO em 3 chamadas paralelas, depois enriquece ── */

export async function fetchDestinos() {
  const [docs, allImgs, allTips, segs] = await Promise.all([
    fetchDestinations(),
    fetchImages({}),    // até 500
    fetchTips({}),      // até 500 — tudo de uma vez
    getSegments(),      // builtin + custom
  ]);

  console.log(
    '[artsByDestino] destinos:', docs.length,
    '| imagens:', allImgs.length,
    '| tips:', allTips.length,
    '| segments:', segs.length,
  );

  _segmentsAll = segs.length ? segs : DEFAULT_SEGMENTS;

  // Indexa imagens
  _imagesByCity = new Map();
  _imagesByCountry = new Map();
  _paisCursors.clear();
  for (const img of allImgs) {
    if (img.assetCategory === 'logo' || !img.url) continue;
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

  // Indexa tips por destinationId
  _tipsByDestId = new Map();
  for (const tip of allTips) {
    if (tip.destinationId) _tipsByDestId.set(tip.destinationId, tip);
  }

  return docs.map(d => {
    const imgs = (_imagesByCity.get(normKey(d.city)) || []).length
      ? _imagesByCity.get(normKey(d.city))
      : (_imagesByCountry.get(normKey(d.country)) || []);
    const tip = _tipsByDestId.get(d.id);
    const availableKeys = tip ? computeAvailableSegmentKeys(tip) : [];
    return {
      id: d.id,
      nome: d.city || d.country || '—',
      subtitulo: [d.country, d.continent].filter(Boolean).join(' · ') || ' ',
      capaUrl: pickCapaUrl(d, imgs),
      disponivel: true,
      paletaFaixa: '#2BA9A7',
      continent: d.continent || '',
      country: d.country || '',
      tipQualidade: tipQualidade(availableKeys),  // 'rich' | 'partial' | 'empty'
      availableKeys,
      _raw: d,
    };
  });
}

/* ── Slides: usa o tip já carregado em memória (sem fetchTip extra) ── */

function stripHtml(s) {
  return String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function pickItemTitle(it) { return it?.title || it?.titulo || ''; }
function pickItemDesc(it)  { return it?.description || it?.descricao || ''; }

function segmentToHighlightText(segDef, segData) {
  if (!segData) return '';
  if (segDef.mode === 'special_info') {
    const inf = segData.info || {};
    return inf.descricao || inf.dica || '';
  }
  if (segDef.mode === 'simple_list') {
    if (segData.themeDesc && segData.themeDesc.trim()) return segData.themeDesc;
    const titles = (segData.items || []).map(pickItemTitle).filter(Boolean).slice(0, 4);
    if (!titles.length) return '';
    if (titles.length === 1) return titles[0];
    return `${titles.slice(0, -1).join(', ')} e ${titles.slice(-1)}.`;
  }
  if (segDef.mode === 'place_list' || segDef.mode === 'agenda') {
    const items = (segData.items || []).filter(pickItemTitle);
    if (!items.length) return '';
    const firstWithDesc = items.find(pickItemDesc);
    if (firstWithDesc) return pickItemDesc(firstWithDesc);
    return `Lugares como ${items.slice(0, 3).map(pickItemTitle).join(', ')}.`;
  }
  if (typeof segData.content === 'string') return segData.content;
  return '';
}

function tipToHighlights(tip) {
  if (!tip?.segments) return [];
  const out = [];
  for (const segDef of _segmentsAll) {
    const segData = tip.segments[segDef.key];
    if (!segHasContent(segData)) continue;
    const txt = segmentToHighlightText(segDef, segData);
    const clean = stripHtml(txt);
    if (!clean) continue;
    out.push({
      nome: segDef.label,
      titulo: segDef.label.toUpperCase(),
      descricao: smartTruncate(clean, 250),
    });
  }
  return out;
}

// Trunca texto preferindo fim de frase (. ! ?) ou vírgula próximos do limite.
// Evita corte no meio de palavra — busca pontuação numa janela de 40 chars antes do max.
function smartTruncate(text, max) {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  // Tenta achar ponto/exclamação/interrogação na zona "final aceitável" (75% do max em diante)
  const minOk = Math.floor(max * 0.75);
  const sentenceMatch = slice.slice(minOk).match(/[.!?](?=\s|$)/);
  if (sentenceMatch) {
    const idx = minOk + sentenceMatch.index + 1;
    return text.slice(0, idx);
  }
  // Senão, último ponto-e-vírgula ou vírgula
  const lastComma = Math.max(slice.lastIndexOf(','), slice.lastIndexOf(';'));
  if (lastComma > minOk) return text.slice(0, lastComma) + '.';
  // Senão, último espaço (evita cortar palavra)
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > minOk) return text.slice(0, lastSpace) + '…';
  // Fallback: corte raso mesmo
  return slice + '…';
}

/**
 * Retorna conteúdo do destino agrupado POR TÓPICO (independente de formato).
 * O wizard derivará os slides a partir disso + topicosSelecionados + formato.
 *
 * Estrutura:
 *   {
 *     ordemTopicos: ['capa', 'informacoes_gerais', 'atracoes', ...],
 *     conteudoPorTopico: {
 *       'capa':               { nome, titulo, descricao, label },
 *       'informacoes_gerais': { nome, titulo, descricao, label },
 *       ...
 *     },
 *     fotosDisponiveis: [url, url, ...],   // pool pra atribuir aos slides
 *     fonte: 'portal-tip' | 'empty',       // origem do conteúdo (futuro: 'banco-curado')
 *   }
 */
export async function loadConteudoForDestino(destino) {
  const isSintetico = !!destino._sintetico;
  const imgs = isSintetico ? destino._fotos : getImagesForDestino(destino);
  const tipDestinoId = isSintetico ? destino._destinoReal?.id : destino.id;
  const nome = destino.nome;

  const fotosDisponiveis = imgs.map(i => i.url);

  // Capa sempre presente, primeira posição
  const conteudoPorTopico = {
    capa: { nome, titulo: 'Tudo sobre', descricao: '', label: 'Capa' },
  };
  const ordemTopicos = ['capa'];

  // Demais tópicos vêm do tip (extraídos por segment com conteúdo)
  const tip = tipDestinoId ? _tipsByDestId.get(tipDestinoId) : null;
  let fonte = 'empty';
  if (tip) {
    const highlights = tipToHighlightsByKey(tip);  // dict topicoKey → highlight
    for (const segDef of _segmentsAll) {
      if (!highlights[segDef.key]) continue;
      conteudoPorTopico[segDef.key] = {
        ...highlights[segDef.key],
        label: segDef.label,
        segmentMode: segDef.mode,
      };
      ordemTopicos.push(segDef.key);
    }
    if (ordemTopicos.length > 1) fonte = 'portal-tip';
    console.log('[artsByDestino] loadConteudo:', tipDestinoId, '| tópicos:', ordemTopicos.length - 1);
  }

  // Empty fallback: nenhum tópico além da capa
  return { ordemTopicos, conteudoPorTopico, fotosDisponiveis, fonte };
}

// Variante de tipToHighlights que retorna dict por key (em vez de array ordenado)
function tipToHighlightsByKey(tip) {
  const out = {};
  if (!tip?.segments) return out;
  for (const segDef of _segmentsAll) {
    const segData = tip.segments[segDef.key];
    if (!segHasContent(segData)) continue;
    const txt = segmentToHighlightText(segDef, segData);
    const clean = stripHtml(txt);
    if (!clean) continue;
    out[segDef.key] = {
      nome: segDef.label,
      titulo: segDef.label.toUpperCase(),
      descricao: smartTruncate(clean, 250),
    };
  }
  return out;
}

// Compatibilidade — código velho que ainda chama buildSlidesForDestino.
// Implementação mantida idêntica ao comportamento anterior.
export async function buildSlidesForDestino(destino) {
  const { ordemTopicos, conteudoPorTopico, fotosDisponiveis, fonte } = await loadConteudoForDestino(destino);
  const layouts = ['foto-cima', 'lateral-esq', 'foto-cima', 'lateral-dir', 'foto-cima', 'lateral-esq', 'foto-cima'];
  const foto = (idx) => fotosDisponiveis[idx % Math.max(fotosDisponiveis.length, 1)] || '';
  const nome = destino.nome;

  // Sem tip → fallback honesto (igual antes)
  if (fonte === 'empty') {
    const slides = [
      { id: 'capa', layoutId: 'capa', nome, titulo: 'Tudo sobre', descricao: '', fotoUrl: foto(0) },
    ];
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
    return slides;
  }

  // Com tip → monta a partir do conteúdo carregado (até 7 tópicos + capa)
  const slides = [];
  let idx = 0;
  for (const topicoKey of ordemTopicos.slice(0, 8)) {
    const c = conteudoPorTopico[topicoKey];
    const layoutId = topicoKey === 'capa' ? 'capa' : layouts[idx - 1] || 'foto-cima';
    slides.push({
      id: topicoKey,
      layoutId,
      nome: c.nome,
      titulo: c.titulo,
      descricao: c.descricao,
      fotoUrl: foto(idx),
    });
    idx++;
  }
  return slides;
}

/* ── Banco curado pro picker de fotos ── */

export const PICKER_CATEGORIAS = [
  { key: 'todas',      label: 'Todas',       icon: '🖼' },
  { key: 'location',   label: 'Destinos',    icon: '📍' },
  { key: 'hotel',      label: 'Hotéis',      icon: '🏨' },
  { key: 'restaurant', label: 'Restaurantes',icon: '🍽' },
  { key: 'train',      label: 'Trens',       icon: '🚄' },
  { key: 'cruise',     label: 'Cruzeiros',   icon: '🚢' },
];

function imgsForBancoCurado(destino) {
  if (destino?._sintetico) {
    const cidadeImgs = destino._destinoReal ? getImagesForDestino(destino._destinoReal) : [];
    const seen = new Set(destino._fotos.map(f => f.id));
    return [...destino._fotos, ...cidadeImgs.filter(i => !seen.has(i.id))];
  }
  return getImagesForDestino(destino);
}

export function getBancoCuradoForDestino(destino, categoria = 'todas') {
  let imgs = imgsForBancoCurado(destino);
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

export function getBancoCuradoCounts(destino) {
  const imgs = imgsForBancoCurado(destino);
  const counts = { todas: imgs.length };
  for (const cat of PICKER_CATEGORIAS) {
    if (cat.key === 'todas') continue;
    counts[cat.key] = imgs.filter(img => img.assetCategory === cat.key).length;
  }
  return counts;
}

export function getCategoriasParaDestino(destino) {
  const imgs = getImagesForDestino(destino);
  const set = new Set();
  for (const img of imgs) {
    if (img.assetCategory && img.assetCategory !== 'logo') set.add(img.assetCategory);
  }
  return set;
}

/* ── Estabelecimentos sintéticos (hotel/restaurant/train/cruise) ── */
export function getEstabelecimentosTipo(tipo, destinosReais) {
  const todas = [];
  for (const arr of _imagesByCity.values()) for (const img of arr) {
    if (img.assetCategory === tipo) todas.push(img);
  }
  const seen = new Set();
  const imgs = todas.filter(img => {
    if (seen.has(img.id)) return false;
    seen.add(img.id);
    return true;
  });

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

  return [...grouped.values()].map(g => {
    const destinoReal = destinosReais.find(d =>
      normKey(d._raw?.city || d.city) === normKey(g.city) &&
      normKey(d._raw?.country || d.country) === normKey(g.country)
    );
    // Qualidade da tip do destino real (pra propagar pro sintético)
    const qual = destinoReal?.tipQualidade || 'empty';
    return {
      id: `${tipo}:${g.name}`,
      nome: g.name,
      subtitulo: [g.city, g.country].filter(Boolean).join(' · '),
      capaUrl: g.fotos[0]?.url || '',
      disponivel: true,
      paletaFaixa: '#2BA9A7',
      continent: g.continent || '',
      country: g.country || '',
      tipQualidade: qual,
      _sintetico: true,
      _tipo: tipo,
      _destinoReal: destinoReal || null,
      _fotos: g.fotos,
      _raw: { city: g.city, country: g.country, continent: g.continent },
    };
  }).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

// API legada
export async function fetchBancoCurado() {
  console.warn('[artsByDestino] fetchBancoCurado deprecated; use getBancoCuradoForDestino(destino)');
  return [];
}
