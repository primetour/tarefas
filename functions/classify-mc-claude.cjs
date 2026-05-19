/**
 * Classificação dupla das newsletters (mc_performance) — Claude-curado.
 *
 * Eixo Comercial (extracted.commercial):
 *   - 'promocao'      → desconto/oferta/valor especial
 *   - 'sazonal'       → período específico (inverno/férias/datas)
 *   - 'parceiro'      → empresa parceira em destaque
 *   - 'inspiracional' → editorial, sem valor/sazonalidade/parceiro
 *
 *   Prioridade quando converge: sazonal > promocao > parceiro > inspiracional
 *
 * Eixo Turismo (extracted.tourism):
 *   - 'evento'    → shows, esportes, experiências com data/local
 *   - 'aereo'     → voos, passagens, classe executiva, milhas
 *   - 'roteiro'   → multi-destino, dias/noites, day-by-day
 *   - 'servico'   → transfer, alfaiate, concierge
 *   - 'hotelaria' → bloco/foco em hotel
 *   - 'cruzeiro'  → cruzeiro/yacht/river-cruise
 *   - 'produto'   → presentes, flores, revista (itens físicos)
 *   - 'destino'   → editorial sobre destino, sem hotel/aéreo específico
 *   - 'outros'    → trens, experiências únicas
 *
 *   Prioridade: evento > aereo > roteiro > servico > hotelaria >
 *               cruzeiro > produto > destino > outros
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const DRY = process.argv.includes('--dry');

const norm = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\w\s%$/-]/g, ' ')
  .replace(/\s+/g, ' ').trim();

/* ─── Heurísticas Comerciais ─── */

// Keywords / patterns que indicam PROMOÇÃO (valor/oferta no subject ou destaque)
const PROMO_PATTERNS = [
  /\b(oferta|ofertas)\s+especia/i,
  /%\s*off/i,
  /\bdesconto/i,
  /\bnoite\s+(grátis|cortesia|free)/i,    // "3ª noite FREE"
  /\b(3a|3ª|2a|2ª|terceira)\s+noite/i,
  /\bcashback/i,
  /\bcr[eé]dito\s+de\s+(us\$|r\$)/i,      // "crédito de US$ 100"
  /\bbenef[ií]cios?\s+especia/i,
  /\bcondi[çc][õo]es?\s+especia/i,
  /\btarifa\s+especial/i,
  /\bvalor(es)?\s+(especial|exclusiv)/i,
  /\bdi[áa]rias?\s+a\s+partir\s+de/i,     // "diárias a partir de R$"
  /\bvantage[mn]/i,
];

// Sazonal — período específico (estação, feriado, data comemorativa)
const SAZONAL_PATTERNS = [
  // Estações
  /\bver[ãa]o/i, /\binverno/i, /\boutono/i, /\bprimavera/i,
  // Datas comemorativas
  /\bnatal/i, /\bano novo/i, /\br[eé]veillon/i, /\bp[áa]scoa/i,
  /\bdia\s+das?\s+m[ãa]es?/i, /\bdia\s+dos?\s+pais?/i,
  /\bdia\s+dos?\s+namorad/i, /\bvalentine/i,
  /\bblack\s+friday/i, /\bcyber\s+monday/i,
  /\bcarnaval/i, /\bf[eé]rias\b/i,
  /\bferiad/i,
  // Mês específico mencionado como período
  /\b(janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+\d{4}/i,
];

// Parceiro — marca/empresa parceira destacada
const PARCEIRO_PATTERNS = [
  // Cartões e programas de fidelidade
  /\bcart[ãa]o\s+(partners?|black|platinum|infinite)/i,
  /\blatam\s+pass/i,
  /\bsmiles?\b/i,
  /\btudoazul/i,
  // BTG / Centurion específicos como parceria-âncora
  /\bbtg\s+(partners?|ultrablue)/i,
  /\bcenturion[®]?\s+card/i,
  /\bamex/i,
  // Marcas-parceiras conhecidas (não-hoteleiras)
  /\btag\s+heuer/i, /\bcartier/i, /\bbreitling/i, /\brolex/i,
  /\bferrari/i, /\bporsche/i, /\bmercedes/i, /\bbmw/i,
  /\bvogue/i, /\bharper'?s\s+bazaar/i,
  // Celebridades em parceria
  /\b(andrea\s+)?bocelli/i, /\bfrank\s+sinatra/i,
];

function classifyCommercial(strong, weak, buId) {
  // Concatena strong (subject+name) e weak (body) com pesos diferentes
  // Stronger signal = subject/name. Body conta mas com threshold maior.
  const sHay = strong;
  const wHay = weak || '';
  const matchAny = (patterns) =>
    patterns.some(p => p.test(sHay)) ||
    patterns.filter(p => p.test(wHay)).length >= 1;
  // Sazonal precisa de match limpo (não confundir com palavras isoladas)
  // Promoção é o mais comum — match no subject ou 2+ no body
  const matchPromo = () =>
    PROMO_PATTERNS.some(p => p.test(sHay)) ||
    PROMO_PATTERNS.filter(p => p.test(wHay)).length >= 2;
  const matchSazonal = () =>
    SAZONAL_PATTERNS.some(p => p.test(sHay)) ||
    SAZONAL_PATTERNS.filter(p => p.test(wHay)).length >= 2;
  const matchParceiro = () => {
    // BUs que são intrinsecamente parceria (BTG/Centurion): só conta se
    // mencionar um SUB-PARCEIRO específico (celeb, marca não-PRIMETOUR).
    // Senão default vai pra outro eixo.
    if (PARCEIRO_PATTERNS.some(p => p.test(sHay))) return true;
    return PARCEIRO_PATTERNS.filter(p => p.test(wHay)).length >= 1;
  };

  // Aplica prioridade: sazonal > promo > parceiro > inspiracional
  if (matchSazonal())  return 'sazonal';
  if (matchPromo())    return 'promocao';
  if (matchParceiro()) return 'parceiro';
  return 'inspiracional';
}

/* ─── Heurísticas Turismo ─── */

const EVENTO_PATTERNS = [
  /\bshow\b/i, /\bconcert/i, /\bbocelli/i,
  /\b(formula\s*1|f1|gp\s+do)/i, /\bcorrida\s+/i,
  /\bwimbledon/i, /\broland\s+garros/i, /\bus\s+open/i, /\baustralian\s+open/i,
  /\bsuper\s*bowl/i, /\bolimp[íi]ad/i,
  /\bfestival/i, /\bcarnaval/i, /\bcamarote/i,
  /\bevento\s+(esportiv|cultural|exclusivo)/i,
  /\b(retiro|retreat)\s+/i, /\bwellness\s+retreat/i,
];
const AEREO_PATTERNS = [
  /\bv[oô]o/i, /\bpassage[mn]/i, /\baerea/i, /\baéreo/i,
  /\bclasse\s+executiva/i, /\bbusiness\s+class/i, /\bfirst\s+class/i,
  /\bmilha/i, /\blatam\s+pass/i, /\btudoazul/i,
  /\bcompanhia\s+a[eé]rea/i, /\bjato\s+privado/i, /\bjet\s+/i,
  /\bemirates/i, /\bqatar\s+airways/i, /\bsingapore\s+airlines/i,
];
const ROTEIRO_PATTERNS = [
  /\bpacote\s+/i, /\broteiro\s+/i,
  /\b\d+\s+(noites?|dias?|dia[s]?\s+e\s+\d+\s+noites?)/i,    // "7 noites" / "10 dias e 9 noites"
  /\bday\s*by\s*day/i, /\bdia\s+a\s+dia/i,
  /\bmulti[\s-]?destino/i, /\bcombinad[oa]/i,
  /\bpre[çc]o\s+fechado/i, /\bpre[çc]o\s+por\s+pessoa/i,
];
const SERVICO_PATTERNS = [
  /\btransfer\b/i, /\bcheck[\s-]?in/i, /\bcheck[\s-]?out/i,
  /\balfaiate/i, /\bpersonal\s+shopper/i, /\bconcierge/i,
  /\blifestyle\s+manager/i, /\bservi[çc]o\s+(exclusivo|de\s+compras|de\s+entrega)/i,
];
const HOTELARIA_PATTERNS = [
  /\bhospedage/i, /\bhot[eé][il]/i, /\bresort\b/i, /\bvilla\b/i,
  /\bsu[ií]te\b/i, /\bdi[áa]ria/i, /\bnoite\s+(em|no|na)\s+/i,
  /\bpousada/i, /\binn\b/i, /\blodge/i, /\bcasa\s+colonial/i,
];
const CRUZEIRO_PATTERNS = [
  /\bcruzeiro/i, /\byacht\b/i, /\bnavio\b/i, /\bbordo\s+do?/i,
  /\bsilversea/i, /\baqua\s+(expeditions|nera|mekong)/i,
  /\britz[\s-]?carlton\s+yacht/i, /\bregent\s+seven\s+seas/i,
  /\bseabourn/i, /\bexplora\s+journeys/i, /\bdelfin/i,
  /\bamawaterways/i, /\briver\s+cruise/i,
];
const PRODUTO_PATTERNS = [
  /\bflores\b/i, /\bbuqu[eê]/i,
  /\bpresente\s+(exclusivo|especial|de\s+luxo)/i,
  /\bentrega\s+de\s+revista/i, /\brevista\s+primetour/i,
  // 4.49.27 v2: removido 'vinho' — pegava destinos gastronômicos (ex:
  // "Portugal imperdível para amantes de vinho" é destino, não produto).
  // 'champagne' também removido (rodapé de hotéis menciona champagne).
];
// CSAT / pesquisa de satisfação — NÃO é newsletter de marketing
const CSAT_PATTERNS = [
  /\bavalie\s+(nosso|sua)/i, /\bopini[ãa]o\s+a\s+respeito/i,
  /\bcomo\s+(foi|você)\s+(sua\s+viagem|avalia)/i,
  /\bprobabilidade\s+de\s+(você\s+)?recomendar/i,
  /\bpesquisa\s+de\s+(satisfa[çc][ãa]o|opini[ãa]o)/i,
  /\bnps\b/i, /\bcsat\b/i,
];
const OUTROS_PATTERNS = [
  /\btre[mn]\b/i, /\borient\s+express/i, /\bla\s+dolce\s+vita/i,
  /\bpullman\b/i, /\bandean\s+explorer/i, /\broyal\s+scotsman/i,
  /\bsimplon/i,
];
const DESTINO_PATTERNS = [
  // Detecção fraca — usada como FALLBACK quando outros eixos não
  // encontram nada (todo subject viajando geralmente menciona destino)
  /\bdestin[oa]/i, /\bexperi[eê]ncia/i, /\bdescubr|conhe[çc]a/i,
  /\bcultura\s+/i, /\bgastronom/i, /\bnatureza\s+/i,
];

function classifyTourism(strong, weak, extracted, buId) {
  const sHay = strong;
  const wHay = weak || '';

  // Hit-rule: 1 match no subject OU 2+ no body
  const hit = (patterns) =>
    patterns.some(p => p.test(sHay)) ||
    patterns.filter(p => p.test(wHay)).length >= 2;

  // 4.49.27 v2: CSAT bypass — surveys de satisfação não são "marketing"
  // mas precisam de bucket. Marcamos como 'outros' (não confundir com
  // editorial inspiracional).
  if (CSAT_PATTERNS.some(p => p.test(sHay))) return 'outros';

  // Aplica prioridade do user: evento > aereo > roteiro > servico >
  // hotelaria > cruzeiro > produto > destino > outros
  if (hit(EVENTO_PATTERNS))   return 'evento';
  if (hit(AEREO_PATTERNS))    return 'aereo';
  if (hit(ROTEIRO_PATTERNS))  return 'roteiro';
  if (hit(SERVICO_PATTERNS))  return 'servico';
  if (hit(HOTELARIA_PATTERNS))return 'hotelaria';
  if (hit(CRUZEIRO_PATTERNS)) return 'cruzeiro';
  if (hit(PRODUTO_PATTERNS))  return 'produto';
  // Outros antes de Destino — trens são raros mas distintivos
  if (hit(OUTROS_PATTERNS))   return 'outros';
  // Destino: fallback se tem cidade/país extraído (já estava na cobertura)
  if ((extracted?.cities || []).length > 0 || (extracted?.countries || []).length > 0) {
    return 'destino';
  }
  return 'outros';
}

/* ─── Main ─── */
(async () => {
  console.log(`${DRY ? '🔍 DRY-RUN' : '✏  ESCREVENDO'} · Classificação dupla v4.49.27 (Comercial + Turismo)\n`);

  const snap = await db.collection('mc_performance').get();
  console.log(`📊 ${snap.size} docs lidos\n`);

  const stats = {
    commercial: { promocao: 0, sazonal: 0, parceiro: 0, inspiracional: 0 },
    tourism:    { evento: 0, aereo: 0, roteiro: 0, servico: 0, hotelaria: 0, cruzeiro: 0, produto: 0, destino: 0, outros: 0 },
    byBu:       {},
  };
  const samples = { commercial: {}, tourism: {} };

  let batch = db.batch();
  let batchN = 0;
  let touched = 0;

  for (const docSnap of snap.docs) {
    const d = docSnap.data();
    const ex = d.extracted || {};
    const subject = d.subject || '';
    const name    = d.name    || '';
    const htmlRaw = (d.htmlText || '');
    const htmlBody = htmlRaw.length > 1200
      ? htmlRaw.slice(200, Math.min(8000, htmlRaw.length - 800))
      : '';

    const strong = norm(`${subject}\n${name}`);
    const weak   = norm(htmlBody);
    const buId   = d.buId || 'sem-bu';

    const commercial = classifyCommercial(strong, weak, buId);
    const tourism    = classifyTourism(strong, weak, ex, buId);

    stats.commercial[commercial]++;
    stats.tourism[tourism]++;
    if (!stats.byBu[buId]) stats.byBu[buId] = { commercial: {}, tourism: {}, total: 0 };
    stats.byBu[buId].total++;
    stats.byBu[buId].commercial[commercial] = (stats.byBu[buId].commercial[commercial] || 0) + 1;
    stats.byBu[buId].tourism[tourism] = (stats.byBu[buId].tourism[tourism] || 0) + 1;

    // Sample 3 docs por (commercial, tourism)
    const keyC = `${commercial}`;
    const keyT = `${tourism}`;
    samples.commercial[keyC] = samples.commercial[keyC] || [];
    samples.tourism[keyT]    = samples.tourism[keyT]    || [];
    if (samples.commercial[keyC].length < 3) samples.commercial[keyC].push(subject.slice(0,60));
    if (samples.tourism[keyT].length < 3)    samples.tourism[keyT].push(subject.slice(0,60));

    touched++;
    if (!DRY) {
      batch.update(docSnap.ref, {
        'extracted.commercial': commercial,
        'extracted.tourism':    tourism,
        'extracted.classifiedBy': 'claude-classify-v4.49.27',
        'extracted.classifiedAt': FV.serverTimestamp(),
      });
      batchN++;
      if (batchN >= 100) { await batch.commit(); batch = db.batch(); batchN = 0; }
    }
  }
  if (!DRY && batchN > 0) await batch.commit();

  console.log(`${'━'.repeat(60)}`);
  console.log(`📈 Distribuição COMERCIAL:`);
  for (const [k, v] of Object.entries(stats.commercial).sort((a,b) => b[1]-a[1])) {
    console.log(`   ${k.padEnd(15)} ${v.toString().padStart(4)} (${(v/touched*100).toFixed(0)}%)`);
  }
  console.log(`\n📈 Distribuição TURISMO:`);
  for (const [k, v] of Object.entries(stats.tourism).sort((a,b) => b[1]-a[1])) {
    console.log(`   ${k.padEnd(15)} ${v.toString().padStart(4)} (${(v/touched*100).toFixed(0)}%)`);
  }

  console.log(`\n📊 Comercial por BU:`);
  for (const [bu, s] of Object.entries(stats.byBu).sort((a,b) => b[1].total-a[1].total)) {
    const parts = Object.entries(s.commercial).map(([k,v]) => `${k}=${v}`).join(' · ');
    console.log(`   ${bu.padEnd(20)} ${parts}`);
  }
  console.log(`\n📊 Turismo por BU:`);
  for (const [bu, s] of Object.entries(stats.byBu).sort((a,b) => b[1].total-a[1].total)) {
    const parts = Object.entries(s.tourism).filter(([,v])=>v>0).map(([k,v]) => `${k}=${v}`).join(' · ');
    console.log(`   ${bu.padEnd(20)} ${parts}`);
  }

  console.log(`\n🔍 Amostras Comercial:`);
  for (const [k, sub] of Object.entries(samples.commercial)) {
    console.log(`   [${k}]`);
    sub.forEach(s => console.log(`     · ${s}`));
  }
  console.log(`\n🔍 Amostras Turismo:`);
  for (const [k, sub] of Object.entries(samples.tourism)) {
    console.log(`   [${k}]`);
    sub.forEach(s => console.log(`     · ${s}`));
  }

  console.log(`\n${DRY ? '⚠  DRY-RUN' : '✅ Aplicado'} · ${touched} docs processados`);
  process.exit(0);
})();
