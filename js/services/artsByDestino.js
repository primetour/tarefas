/**
 * artsByDestino — adapta as coleções do Portal de Dicas
 * (portal_destinations, portal_tips, portal_images) pro wizard de Artes por Destino.
 *
 * Estratégia de carregamento:
 *   - 1 fetch global de portal_images (assetCategory: 'location') em fetchDestinos()
 *   - cache local _imagesByLocation indexado por city+country
 *   - todas as buscas posteriores (capa, slides, banco curado) usam o cache
 *
 * Etapa B (futura): plugar fetchTip + callLLM pra gerar highlights reais.
 */

import { fetchDestinations, fetchTip, fetchImages } from './portal.js';

// Cache local — populado em fetchDestinos(), usado em fetchBancoCurado/buildSlides
let _imagesByLocation = new Map();  // key = "city|country" → array de imagens

function keyFor(city, country) {
  return `${(city || '').toLowerCase()}|${(country || '').toLowerCase()}`;
}

function getImagesForDestino(destino) {
  const raw = destino._raw || destino;
  return _imagesByLocation.get(keyFor(raw.city, raw.country)) || [];
}

/**
 * Lista destinos do Portal de Dicas + carrega banco de imagens em paralelo.
 * Adiciona `capaUrl` (1ª foto da cidade) em cada destino.
 */
export async function fetchDestinos() {
  const [docs, allImgs] = await Promise.all([
    fetchDestinations(),
    fetchImages({ assetCategory: 'location' }),
  ]);

  // Indexa imagens por city+country
  _imagesByLocation = new Map();
  for (const img of allImgs) {
    const k = keyFor(img.city, img.country);
    if (!_imagesByLocation.has(k)) _imagesByLocation.set(k, []);
    _imagesByLocation.get(k).push(img);
  }

  return docs.map(d => {
    const imgs = _imagesByLocation.get(keyFor(d.city, d.country)) || [];
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

/**
 * Constrói 8 slides pro destino selecionado, usando fotos do banco curado real.
 * Slides 2-8 ainda com placeholders de texto (etapa B trará tips reais).
 */
export async function buildSlidesForDestino(destino) {
  const imgs = getImagesForDestino(destino);
  const nome = destino.nome;
  // Pra cada slide, escolhe foto do banco (cíclico se acabar)
  const foto = (idx) => imgs[idx % Math.max(imgs.length, 1)]?.url || '';

  // TODO Etapa B: const tip = await fetchTip(destino.id); fatiar em 7 highlights via callLLM
  console.info('[artsByDestino] TODO etapa B: tip real de', destino.id, '— usando placeholders');

  return [
    { id: 'capa',  layoutId: 'capa',         nome, titulo: 'Tudo sobre',  descricao: '',
      fotoUrl: foto(0) },
    { id: 'intro', layoutId: 'foto-cima',    nome, titulo: 'VISÃO GERAL',
      descricao: `Conheça os destaques de ${nome} para inspirar sua próxima viagem.`,
      fotoUrl: foto(1) },
    { id: 'h2',    layoutId: 'lateral-esq',  nome: `${nome} 02`, titulo: 'PONTO ALTO 2',
      descricao: 'Em breve: dica real do Portal de Dicas (etapa B).',
      fotoUrl: foto(2) },
    { id: 'h3',    layoutId: 'foto-cima',    nome: `${nome} 03`, titulo: 'PONTO ALTO 3',
      descricao: 'Em breve: dica real do Portal de Dicas (etapa B).',
      fotoUrl: foto(3) },
    { id: 'h4',    layoutId: 'lateral-dir',  nome: `${nome} 04`, titulo: 'PONTO ALTO 4',
      descricao: 'Em breve: dica real do Portal de Dicas (etapa B).',
      fotoUrl: foto(4) },
    { id: 'h5',    layoutId: 'foto-cima',    nome: `${nome} 05`, titulo: 'PONTO ALTO 5',
      descricao: 'Em breve: dica real do Portal de Dicas (etapa B).',
      fotoUrl: foto(5) },
    { id: 'h6',    layoutId: 'lateral-esq',  nome: `${nome} 06`, titulo: 'PONTO ALTO 6',
      descricao: 'Em breve: dica real do Portal de Dicas (etapa B).',
      fotoUrl: foto(6) },
    { id: 'h7',    layoutId: 'foto-cima',    nome: `${nome} 07`, titulo: 'PONTO ALTO 7',
      descricao: 'Em breve: dica real do Portal de Dicas (etapa B).',
      fotoUrl: foto(7) },
  ];
}

/**
 * Banco curado pro picker de fotos (sheet Foto).
 * Lê do cache populado em fetchDestinos() — sem ida extra ao Firestore.
 */
export async function fetchBancoCurado(destinoId) {
  // Como o cache é indexado por city+country e aqui só temos id, varremos
  // pra achar (rápido em memória). Em produção poderíamos manter um destinos cache também.
  for (const [, imgs] of _imagesByLocation) {
    if (imgs.some(img => img.destinoId === destinoId)) {
      return imgs.map(toBancoItem);
    }
  }
  // Fallback: tenta usar o destino atual via raw lookup — passamos o destino completo
  // (chamador atualizado pra passar destino, não só id, ou guardamos no state)
  console.warn('[artsByDestino] fetchBancoCurado: destino não encontrado no cache:', destinoId);
  return [];
}

/**
 * Versão alternativa: recebe o destino completo (com _raw) pra pegar imgs do cache.
 */
export function getBancoCuradoForDestino(destino) {
  return getImagesForDestino(destino).map(toBancoItem);
}

function toBancoItem(img) {
  return {
    id: img.id,
    url: img.url,
    nome: img.name || img.assetCategory || 'Foto',
  };
}
