/**
 * artsByDestino — service que adapta as coleções do Portal de Dicas
 * (portal_destinations, portal_tips, portal_images) pro wizard de Artes por Destino.
 *
 * Etapa A (atual): só lista destinos via fetchDestinations().
 * Etapa B (próxima): puxar tips reais e fatiar em highlights.
 * Etapa C (próxima): banco curado real via fetchImagesPage.
 */

import { fetchDestinations, fetchTip, fetchImages } from './portal.js';

const PIC = (seed, w = 1080, h = 1350) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

/**
 * Lista todos os destinos do Portal de Dicas, formatados pro wizard.
 * Sem `slides` por enquanto (são gerados on-demand em buildSlidesForDestino).
 */
export async function fetchDestinos() {
  const docs = await fetchDestinations();
  return docs.map(d => ({
    id: d.id,
    nome: d.city || d.country || '—',
    subtitulo: [d.country, d.continent].filter(Boolean).join(' · ') || ' ',
    capaUrl: d.coverImage || d.fotoCapa || '',
    disponivel: true,
    paletaFaixa: '#2BA9A7',
    // Dados crus pra próximas etapas
    _raw: d,
  }));
}

/**
 * Constrói os 8 slides pro destino selecionado.
 * Etapa A: usa o nome do destino + placeholders. Avisa no console que falta plugar tips reais.
 */
export async function buildSlidesForDestino(destino) {
  // TODO Etapa B: const tip = await fetchTip(destino.id); fatiar em 7 highlights via callLLM
  console.info('[artsByDestino] TODO etapa B: puxar tip real de', destino.id);

  const nome = destino.nome;
  const capaUrl = destino.capaUrl || PIC(`${destino.id}-cover`);

  return [
    { id: 'capa',  layoutId: 'capa',        nome, titulo: 'Tudo sobre', descricao: '',
      fotoUrl: capaUrl },
    { id: 'intro', layoutId: 'foto-cima',   nome, titulo: 'VISÃO GERAL',
      descricao: `Conheça os destaques de ${nome} para inspirar sua próxima viagem.`,
      fotoUrl: PIC(`${destino.id}-1`) },
    { id: 'h2', layoutId: 'lateral-esq',    nome: `${nome} 02`, titulo: 'PONTO ALTO 2',
      descricao: 'Em breve: dica real puxada do Portal de Dicas.',
      fotoUrl: PIC(`${destino.id}-2`) },
    { id: 'h3', layoutId: 'foto-cima',      nome: `${nome} 03`, titulo: 'PONTO ALTO 3',
      descricao: 'Em breve: dica real puxada do Portal de Dicas.',
      fotoUrl: PIC(`${destino.id}-3`) },
    { id: 'h4', layoutId: 'lateral-dir',    nome: `${nome} 04`, titulo: 'PONTO ALTO 4',
      descricao: 'Em breve: dica real puxada do Portal de Dicas.',
      fotoUrl: PIC(`${destino.id}-4`) },
    { id: 'h5', layoutId: 'foto-cima',      nome: `${nome} 05`, titulo: 'PONTO ALTO 5',
      descricao: 'Em breve: dica real puxada do Portal de Dicas.',
      fotoUrl: PIC(`${destino.id}-5`) },
    { id: 'h6', layoutId: 'lateral-esq',    nome: `${nome} 06`, titulo: 'PONTO ALTO 6',
      descricao: 'Em breve: dica real puxada do Portal de Dicas.',
      fotoUrl: PIC(`${destino.id}-6`) },
    { id: 'h7', layoutId: 'foto-cima',      nome: `${nome} 07`, titulo: 'PONTO ALTO 7',
      descricao: 'Em breve: dica real puxada do Portal de Dicas.',
      fotoUrl: PIC(`${destino.id}-7`) },
  ];
}

/**
 * Etapa C: banco curado real. Por enquanto, devolve placeholders Picsum.
 */
export async function fetchBancoCurado(destinoId) {
  console.info('[artsByDestino] TODO etapa C: usar fetchImagesPage real pra', destinoId);
  return Array.from({ length: 16 }, (_, i) => ({
    id: `${destinoId}-${i + 1}`,
    url: PIC(`${destinoId}-banco-${i + 1}`, 600, 750),
    nome: `Foto ${i + 1}`,
  }));
}
