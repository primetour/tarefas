/**
 * Service de Sites — CRUD dos sites do "Módulo de Sites" (construtor de
 * páginas por blocos). Persiste em localStorage (`btg-sites-dev`) — é o
 * suficiente pra demo funcional; no cutover pra prod isso vira uma
 * coleção Firestore.
 *
 * Modelo:
 *   Site  = { id, name, brand, updatedAt, blocks: [Block] }
 *   Block = { id, type, data: {} }   // type ∈ BLOCK_LIBRARY
 */

const LOCAL_KEY = 'btg-sites-dev';

let _idSeq = Date.now();
function uid(prefix) {
  _idSeq += 1;
  return `${prefix}-${_idSeq.toString(36)}`;
}

/* ─── Seed: os 3 sites BTG já montados em blocos ──────────── */
function seedSites() {
  return [
    {
      id: 'site-operadora',
      name: 'Operadora',
      brand: 'operadora',
      updatedAt: new Date().toISOString(),
      blocks: [
        { id: uid('b'), type: 'hero', data: {
          eyebrow: '', titulo: 'Operadora',
          subtitulo: 'Novidades e oportunidades selecionadas pelo time de especialistas da PRIMETOUR',
          imagem: 'assets/operadora/hero_operadora.jpg' } },
        { id: uid('b'), type: 'intro', data: {
          titulo: 'A curadoria PRIMETOUR, disponível para o seu cliente',
          texto: 'Roteiros, hotéis, cruzeiros e experiências selecionados por especialistas, com benefícios exclusivos e suporte dedicado.' } },
        { id: uid('b'), type: 'ofertas', data: { titulo: 'Ofertas em destaque' } },
        { id: uid('b'), type: 'categorias', data: {
          titulo: 'Viagens e Experiências',
          itens: 'Feriados e Datas Especiais\nDestinos\nHospedagem\nAéreo & Transfers\nCruzeiros' } },
        { id: uid('b'), type: 'closing', data: {
          titulo: 'A próxima oportunidade para surpreender seu cliente começa aqui',
          descricao: 'Conte com nossos especialistas para construir a melhor solução para cada viagem.',
          botao: 'Falar com nosso especialista' } },
        { id: uid('b'), type: 'rodape', data: { texto: 'Copyright © 2026. Todos os direitos reservados.' } },
      ],
    },
    {
      id: 'site-partners',
      name: 'Cartão Partners',
      brand: 'partners',
      updatedAt: new Date().toISOString(),
      blocks: [
        { id: uid('b'), type: 'hero', data: {
          eyebrow: 'Cartão Partners BTG Pactual', titulo: 'O mundo, do seu jeito',
          subtitulo: 'Roteiros personalizados e experiências cuidadosamente selecionadas para cada jornada.',
          imagem: 'assets/partners/banner_desk_partners.png' } },
        { id: uid('b'), type: 'intro', data: {
          titulo: 'Suas viagens ainda mais inesquecíveis',
          texto: 'Com o Partners, você conta com uma curadoria dedicada para criar roteiros personalizados, reservas estratégicas e experiências alinhadas ao seu estilo de vida.' } },
        { id: uid('b'), type: 'ofertas', data: { titulo: 'Experiências selecionadas para você' } },
        { id: uid('b'), type: 'vantagens', data: {
          titulo: 'Cada detalhe, planejado',
          subtitulo: 'O que cuidamos pra você, do briefing à viagem.',
          imagem: 'assets/partners/porque-viajar.png',
          itens: 'Roteiros sob medida\nHospedagens selecionadas\nPassagens aéreas\nTrens e cruzeiros de luxo' } },
        { id: uid('b'), type: 'closing', data: {
          titulo: 'Um mundo de possibilidades, à sua disposição',
          descricao: 'Entre em contato com o seu Concierge Partners. De segunda a segunda, das 8h às 20h.',
          botao: 'Quero falar com meu concierge' } },
        { id: uid('b'), type: 'rodape', data: { texto: 'Copyright © 2026. Todos os direitos reservados.' } },
      ],
    },
    {
      id: 'site-ultrablue',
      name: 'Cartão Ultrablue',
      brand: 'ultrablue',
      updatedAt: new Date().toISOString(),
      blocks: [
        { id: uid('b'), type: 'hero', data: {
          eyebrow: 'Cartão Ultrablue BTG Pactual', titulo: 'Uma jornada desenhada ao seu estilo',
          subtitulo: 'Porque viajar vai além do destino.',
          imagem: 'assets/ultrablue/hero_ultrablue.jpg' } },
        { id: uid('b'), type: 'intro', data: {
          titulo: 'Suas viagens ainda mais inesquecíveis',
          texto: 'Com o Ultrablue, você conta com uma curadoria dedicada para criar roteiros personalizados, reservas estratégicas e experiências alinhadas ao seu estilo de vida.' } },
        { id: uid('b'), type: 'ofertas', data: { titulo: 'Experiências selecionadas para você' } },
        { id: uid('b'), type: 'vantagens', data: {
          titulo: 'Vantagens para aproveitar mais em cada destino',
          subtitulo: 'Vá mais longe em tudo o que imaginar.',
          imagem: 'assets/ultrablue/why_ultrablue.jpg',
          itens: 'Hotéis parceiros\nPontuação acelerada\nCashback\nSeguro viagem\nTerminal BTG Pactual\nSalas VIP LoungeKey' } },
        { id: uid('b'), type: 'closing', data: {
          titulo: 'Um mundo de possibilidades, à sua disposição',
          descricao: 'Entre em contato com o seu Concierge Ultrablue. De segunda a segunda, das 8h às 20h.',
          botao: 'Quero falar com meu concierge' } },
        { id: uid('b'), type: 'rodape', data: { texto: 'Copyright © 2026. Todos os direitos reservados.' } },
      ],
    },
  ];
}

function readAll() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  const seed = seedSites();
  writeAll(seed);
  return seed;
}

function writeAll(sites) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(sites));
  } catch (err) {
    console.error('[btg-sites] erro ao salvar:', err);
  }
}

export function listSites() {
  return readAll();
}

export function getSite(id) {
  return readAll().find((s) => s.id === id) || null;
}

export function createSite({ name, brand }) {
  const sites = readAll();
  const site = {
    id: uid('site'),
    name: (name || 'Novo site').trim(),
    brand: brand || 'partners',
    updatedAt: new Date().toISOString(),
    blocks: [],
  };
  sites.push(site);
  writeAll(sites);
  return site;
}

export function saveSite(site) {
  const sites = readAll();
  const idx = sites.findIndex((s) => s.id === site.id);
  const updated = { ...site, updatedAt: new Date().toISOString() };
  if (idx === -1) sites.push(updated);
  else sites[idx] = updated;
  writeAll(sites);
  return updated;
}

export function deleteSite(id) {
  writeAll(readAll().filter((s) => s.id !== id));
}

/** Reseta os sites pro seed (útil pra demo). */
export function resetSites() {
  const seed = seedSites();
  writeAll(seed);
  return seed;
}

/** Gera um id de bloco novo. */
export function newBlockId() {
  return uid('b');
}
