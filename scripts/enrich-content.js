/**
 * Enriquecimento determinístico do mc_performance.extracted, curado por Claude.
 *
 * Por que não API:
 *   - Domínio PRIMETOUR (luxury travel) é conhecido — não precisa LLM genérico.
 *   - User experiente curou aliases comuns ("NY"→Nova York, "Acrópole"→Grécia).
 *   - Custo zero, idempotente, auditável.
 *
 * Estratégia:
 *   1. Dicionário curado: cities (com país-mãe), countries (com aliases),
 *      brands (hotéis/cruzeiros premium), keywords-de-tema, padrões-de-tipo.
 *   2. Pra cada doc: roda matching no subject + name (sem ler HTML pra
 *      evitar custo). Acha entidades novas que a IA passou.
 *   3. MERGE no extracted existente — NÃO sobrescreve. Adiciona o que faltou.
 *      Se city é nova, infere country pelo dicionário.
 *   4. Marca `extractedBy: 'claude-backfill-v4.49.25'` quando enriqueceu.
 *
 * Modos:
 *   --dry      Não escreve, só relata o que mudaria.
 *   (default)  Escreve em batches de 50.
 *
 * Idempotente: roda quantas vezes quiser — só adiciona, nunca remove.
 */
const admin = require('firebase-admin');
// v4.49.34+ Suporte a duas formas de auth:
//   1. GitHub Actions: FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
//   2. Local dev:      Application Default Credentials (gcloud auth)
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
} else {
  admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
}
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const DRY = process.argv.includes('--dry');

/* ─── Normalização ─── */
const norm = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')   // tira acentos
  .replace(/[^\w\s-]/g, ' ')                          // pontuação → espaço
  .replace(/\s+/g, ' ')
  .trim();

/* ─── DICIONÁRIOS ─── */

// Cities → { country, aliases? }
// Aliases não-acentuadas; o normalize remove acentos automaticamente.
// Cada entry vai gerar regex \b(alias)\b sobre o subject normalizado.
const CITIES = {
  // ── Brasil ──
  // "rio" sozinho é polissêmico (Rio Negro, rio Mekong...) — só "rio de janeiro"
  'Rio de Janeiro':        { country: 'Brasil', aliases: ['rio de janeiro'] },
  // "sp" excluído: muito ambíguo (preposição/sufixo em PT). Só "sao paulo".
  'São Paulo':             { country: 'Brasil', aliases: ['sao paulo'] },
  'Fernando de Noronha':   { country: 'Brasil', aliases: ['fernando de noronha', 'noronha'] },
  'Lençóis Maranhenses':   { country: 'Brasil', aliases: ['lencois maranhenses', 'lencois'] },
  'Cumbuco':               { country: 'Brasil' },
  'Trancoso':              { country: 'Brasil' },
  'Jericoacoara':          { country: 'Brasil', aliases: ['jericoacoara', 'jeri'] },
  'Búzios':                { country: 'Brasil', aliases: ['buzios'] },
  'Paraty':                { country: 'Brasil' },
  'Salvador':              { country: 'Brasil' },
  'Foz do Iguaçu':         { country: 'Brasil', aliases: ['foz do iguacu', 'iguacu'] },
  'Pantanal':              { country: 'Brasil' },
  'Amazônia':              { country: 'Brasil', aliases: ['amazonia', 'amazon'] },
  'Caraíva':               { country: 'Brasil', aliases: ['caraiva'] },
  'Itacaré':               { country: 'Brasil', aliases: ['itacare'] },
  'Maraú':                 { country: 'Brasil', aliases: ['marau'] },
  'Praia do Forte':        { country: 'Brasil' },
  'Comandatuba':           { country: 'Brasil' },

  // ── EUA / Caribe / América do Norte ──
  'Nova York':             { country: 'Estados Unidos', aliases: ['nova york', 'new york', 'ny', 'nyc'] },
  // "la" e "sf" EXCLUÍDOS: ambíguos (la=artigo italiano/espanhol).
  'Los Angeles':           { country: 'Estados Unidos', aliases: ['los angeles'] },
  'San Francisco':         { country: 'Estados Unidos', aliases: ['san francisco'] },
  'Las Vegas':             { country: 'Estados Unidos', aliases: ['las vegas', 'vegas'] },
  'Miami':                 { country: 'Estados Unidos' },
  'Aspen':                 { country: 'Estados Unidos' },
  'Napa Valley':           { country: 'Estados Unidos', aliases: ['napa valley', 'napa'] },
  'Chicago':               { country: 'Estados Unidos' },
  'Hawaii':                { country: 'Estados Unidos', aliases: ['hawaii', 'havai', 'maui', 'oahu', 'kauai'] },
  'Los Cabos':             { country: 'México', aliases: ['los cabos', 'cabo san lucas'] },
  'Cancún':                { country: 'México', aliases: ['cancun'] },
  'Tulum':                 { country: 'México' },
  'Cidade do México':      { country: 'México', aliases: ['cidade do mexico', 'mexico city', 'cdmx'] },
  'Havana':                { country: 'Cuba' },

  // ── América do Sul ──
  'Buenos Aires':          { country: 'Argentina' },
  'Mendoza':               { country: 'Argentina' },
  'Bariloche':             { country: 'Argentina' },
  'El Calafate':           { country: 'Argentina', aliases: ['el calafate', 'calafate'] },
  'Ushuaia':               { country: 'Argentina' },
  'Patagônia':             { country: 'Argentina', aliases: ['patagonia'] }, // pode ser Chile também
  'Santiago':              { country: 'Chile' },
  'Atacama':               { country: 'Chile' },
  'Valparaíso':            { country: 'Chile', aliases: ['valparaiso'] },
  'Punta del Este':        { country: 'Uruguai', aliases: ['punta del este', 'punta'] },
  'Lima':                  { country: 'Peru' },
  'Cusco':                 { country: 'Peru', aliases: ['cusco', 'cuzco'] },
  'Machu Picchu':          { country: 'Peru', aliases: ['machu picchu', 'machupicchu'] },
  'Vale Sagrado':          { country: 'Peru', aliases: ['vale sagrado', 'sacred valley'] },
  'Cartagena':             { country: 'Colômbia' },
  'Galápagos':             { country: 'Equador', aliases: ['galapagos'] },

  // ── Europa: Itália ──
  'Roma':                  { country: 'Itália', aliases: ['roma', 'rome'] },
  'Veneza':                { country: 'Itália', aliases: ['veneza', 'venice'] },
  'Florença':              { country: 'Itália', aliases: ['florenca', 'florence', 'firenze'] },
  'Milão':                 { country: 'Itália', aliases: ['milao', 'milan', 'milano'] },
  'Toscana':               { country: 'Itália', aliases: ['toscana', 'tuscany'] },
  'Sicília':               { country: 'Itália', aliases: ['sicilia', 'sicily'] },
  'Sardenha':              { country: 'Itália', aliases: ['sardenha', 'sardinia', 'sardegna'] },
  'Capri':                 { country: 'Itália' },
  'Amalfi':                { country: 'Itália', aliases: ['amalfi', 'costa amalfitana'] },
  'Cinque Terre':          { country: 'Itália' },
  'Lago di Como':          { country: 'Itália', aliases: ['lago di como', 'lake como', 'lago de como'] },
  'Puglia':                { country: 'Itália', aliases: ['puglia', 'apulia'] },

  // ── Europa: França ──
  'Paris':                 { country: 'França' },
  'Provence':              { country: 'França' },
  'Nice':                  { country: 'França' },
  'Cannes':                { country: 'França' },
  'Saint-Tropez':          { country: 'França', aliases: ['saint-tropez', 'saint tropez', 'st tropez'] },
  'Riviera Francesa':      { country: 'França', aliases: ['riviera francesa', 'cote d azur', 'cote dazur'] },
  'Mônaco':                { country: 'Mônaco', aliases: ['monaco'] },

  // ── Europa: Espanha / Portugal ──
  'Barcelona':             { country: 'Espanha' },
  'Madri':                 { country: 'Espanha', aliases: ['madri', 'madrid'] },
  'Ibiza':                 { country: 'Espanha' },
  'Mallorca':              { country: 'Espanha', aliases: ['mallorca', 'maiorca', 'majorca'] },
  'Sevilha':               { country: 'Espanha', aliases: ['sevilha', 'seville', 'sevilla'] },
  'San Sebastián':         { country: 'Espanha', aliases: ['san sebastian'] },
  'Lisboa':                { country: 'Portugal', aliases: ['lisboa', 'lisbon'] },
  'Porto':                 { country: 'Portugal' },
  'Algarve':               { country: 'Portugal' },
  'Madeira':               { country: 'Portugal' },
  'Açores':                { country: 'Portugal', aliases: ['acores', 'azores'] },

  // ── Europa: Grécia ──
  'Atenas':                { country: 'Grécia', aliases: ['atenas', 'athens'] },
  'Mykonos':               { country: 'Grécia' },
  'Santorini':             { country: 'Grécia' },
  'Creta':                 { country: 'Grécia', aliases: ['creta', 'crete'] },
  'Corfu':                 { country: 'Grécia' },
  'Rodes':                 { country: 'Grécia', aliases: ['rodes', 'rhodes'] },
  'Mar Egeu':              { country: 'Grécia', aliases: ['mar egeu', 'egeu', 'aegean'] },
  'Mar Jônico':            { country: 'Grécia', aliases: ['mar jonico', 'jonico', 'ionian'] },

  // ── Europa: outros ──
  'Dubrovnik':             { country: 'Croácia' },
  'Hvar':                  { country: 'Croácia' },
  'Split':                 { country: 'Croácia' },
  'Istambul':              { country: 'Turquia', aliases: ['istambul', 'istanbul'] },
  'Capadócia':             { country: 'Turquia', aliases: ['capadocia', 'cappadocia'] },
  'Londres':               { country: 'Reino Unido', aliases: ['londres', 'london'] },
  'Edimburgo':             { country: 'Reino Unido', aliases: ['edimburgo', 'edinburgh'] },
  'Dublin':                { country: 'Irlanda' },
  'Reykjavik':             { country: 'Islândia' },
  'Amsterdam':             { country: 'Holanda', aliases: ['amsterdam', 'amsterda'] },
  'Praga':                 { country: 'República Tcheca', aliases: ['praga', 'prague'] },
  'Viena':                 { country: 'Áustria', aliases: ['viena', 'vienna'] },
  'Budapeste':             { country: 'Hungria', aliases: ['budapeste', 'budapest'] },

  // ── África ──
  'Cairo':                 { country: 'Egito' },
  'Luxor':                 { country: 'Egito' },
  'Marrakech':             { country: 'Marrocos', aliases: ['marrakech', 'marrakesh'] },
  'Casablanca':            { country: 'Marrocos' },
  'Fez':                   { country: 'Marrocos' },
  'Cidade do Cabo':        { country: 'África do Sul', aliases: ['cidade do cabo', 'cape town'] },
  'Joanesburgo':           { country: 'África do Sul', aliases: ['joanesburgo', 'johannesburg'] },
  'Kruger':                { country: 'África do Sul' },
  'Serengeti':             { country: 'Tanzânia' },
  'Zanzibar':              { country: 'Tanzânia' },
  'Masai Mara':            { country: 'Quênia', aliases: ['masai mara', 'maasai mara'] },

  // ── Médio Oriente ──
  'Petra':                 { country: 'Jordânia' },
  'Dubai':                 { country: 'Emirados Árabes Unidos' },
  'Abu Dhabi':             { country: 'Emirados Árabes Unidos' },
  'Doha':                  { country: 'Qatar' },
  'Mascate':               { country: 'Omã', aliases: ['mascate', 'muscat'] },

  // ── Ásia ──
  'Tóquio':                { country: 'Japão', aliases: ['toquio', 'tokyo'] },
  'Quioto':                { country: 'Japão', aliases: ['quioto', 'kyoto'] },
  'Osaka':                 { country: 'Japão' },
  'Hokkaido':              { country: 'Japão' },
  'Bali':                  { country: 'Indonésia' },
  'Java':                  { country: 'Indonésia' },
  'Bangkok':               { country: 'Tailândia' },
  'Phuket':                { country: 'Tailândia' },
  'Koh Samui':             { country: 'Tailândia' },
  'Chiang Mai':            { country: 'Tailândia' },
  'Hanói':                 { country: 'Vietnã', aliases: ['hanoi'] },
  'Ho Chi Minh':           { country: 'Vietnã', aliases: ['ho chi minh', 'saigon'] },
  'Hoi An':                { country: 'Vietnã' },
  'Mekong':                { country: 'Vietnã' },           // Delta do Mekong
  'Halong':                { country: 'Vietnã', aliases: ['halong', 'ha long'] },
  'Siem Reap':             { country: 'Camboja' },
  'Angkor':                { country: 'Camboja', aliases: ['angkor', 'angkor wat'] },
  'Singapura':             { country: 'Singapura', aliases: ['singapura', 'singapore'] },
  'Hong Kong':             { country: 'Hong Kong' },
  'Jaipur':                { country: 'Índia' },
  'Agra':                  { country: 'Índia' },
  'Goa':                   { country: 'Índia' },
  'Kerala':                { country: 'Índia' },
  'Colombo':               { country: 'Sri Lanka' },

  // ── Oceania ──
  'Sydney':                { country: 'Austrália' },
  'Melbourne':              { country: 'Austrália' },
  'Bora Bora':             { country: 'Polinésia Francesa' },
  'Taiti':                 { country: 'Polinésia Francesa', aliases: ['taiti', 'tahiti'] },
  'Moorea':                { country: 'Polinésia Francesa' },
  'Maupiti':               { country: 'Polinésia Francesa' },

  // ── Antártida (continente, mas usado como destino) ──
  // tratada como country pra simplicidade

  // ── Ilhas-país (cidade = país) ──
  'Maldivas':              { country: 'Maldivas' },
  'Seychelles':            { country: 'Seychelles' },
  'Maurícios':             { country: 'Maurícios', aliases: ['mauricios', 'mauritius'] },
};

// Countries puros (sem cidades suficientes pra catch via city)
const COUNTRIES = {
  'Brasil':                ['brasil', 'brazil'],
  'Argentina':             ['argentina'],
  'Chile':                 ['chile'],
  'Peru':                  ['peru'],
  'Uruguai':               ['uruguai', 'uruguay'],
  'Bolívia':               ['bolivia'],
  'Colômbia':              ['colombia'],
  'Equador':               ['equador', 'ecuador'],
  'Estados Unidos':        ['estados unidos', 'eua', 'usa', 'united states'],
  'México':                ['mexico'],
  'Cuba':                  ['cuba'],
  'Itália':                ['italia', 'italy'],
  'França':                ['franca', 'france'],
  'Espanha':               ['espanha', 'spain'],
  'Portugal':              ['portugal'],
  'Grécia':                ['grecia', 'greece'],
  'Croácia':               ['croacia', 'croatia'],
  'Turquia':               ['turquia', 'turkey'],
  'Reino Unido':           ['reino unido', 'inglaterra', 'england', 'uk'],
  'Irlanda':               ['irlanda', 'ireland'],
  'Suíça':                 ['suica', 'switzerland'],
  'Áustria':               ['austria'],
  'Alemanha':              ['alemanha', 'germany'],
  'Holanda':               ['holanda', 'netherlands'],
  'Islândia':              ['islandia', 'iceland'],
  'Egito':                 ['egito', 'egypt'],
  'Marrocos':              ['marrocos', 'morocco'],
  'África do Sul':         ['africa do sul', 'south africa'],
  'Quênia':                ['quenia', 'kenya'],
  'Tanzânia':              ['tanzania'],
  'Botswana':              ['botswana', 'botsuana'],
  'Namíbia':               ['namibia'],
  'Japão':                 ['japao', 'japan'],
  'China':                 ['china'],
  'Tailândia':             ['tailandia', 'thailand'],
  'Vietnã':                ['vietna', 'vietnam'],
  'Camboja':               ['camboja', 'cambodia'],
  'Indonésia':             ['indonesia'],
  'Maldivas':              ['maldivas', 'maldives'],
  'Seychelles':            ['seychelles'],
  'Maurícios':             ['mauricios', 'mauritius'],
  'Índia':                 ['india'],
  'Sri Lanka':             ['sri lanka'],
  'Jordânia':              ['jordania', 'jordan'],
  'Emirados Árabes Unidos':['emirados arabes', 'emirates'],
  'Catar':                 ['qatar', 'catar'],
  'Austrália':             ['australia'],
  'Nova Zelândia':         ['nova zelandia', 'new zealand'],
  'Polinésia Francesa':    ['polinesia francesa', 'french polynesia'],
  'Antártida':             ['antartida', 'antarctica'],
  'Mônaco':                ['monaco'],
};

// Brands curadas (luxury travel) — apenas as que aparecem com frequência
// IMPORTANTE: Evitar palavras-comuns-em-PT como "Como" (hotel) que
// confunde com a palavra interrogativa, "Norman" (nome próprio que
// pode aparecer em outros contextos). Quando precisar dessas, requer
// override manual via UI.
const BRANDS = [
  'Aman', 'Belmond', 'Faena', 'Six Senses', 'Bvlgari', 'Bulgari', 'Cheval Blanc',
  'Four Seasons', 'Ritz-Carlton', 'EDITION', 'Lotte', 'OIÁ', 'Carmel', 'Emiliano',
  'Inkaterra', 'Anantara', 'Mandarin Oriental', 'One&Only', 'Rosewood', 'Park Hyatt',
  'St. Regis', 'Waldorf Astoria', 'Conrad', 'Soneva', 'Auberge', 'Singita',
  'Banyan Tree', 'Capella', 'Borgo Egnazia', 'Hotel du Cap', 'Le Sirenuse', 'Splendido',
  'J.K. Place', 'Sandy Lane', 'Round Hill', 'Jumby Bay', 'GoldenEye',
  // 4.49.26+ Hotéis que aparecem com frequência no htmlText (não no subject)
  'Patina', 'Patina Maldives', 'Patina Mexico City', 'Patina Bali',
  'Aman Tokyo', 'Aman Venice', 'Amangiri', 'Amankora', 'Amanyara', 'Amanwana',
  'Soneva Fushi', 'Soneva Jani', 'Soneva Secret',
  'Cheval Blanc Randheli', 'Cheval Blanc Paris', 'Cheval Blanc St-Tropez',
  'Bulgari Resort', 'Bulgari Hotel', 'Bvlgari Maldives',
  'Le Sirenuse Positano',
  'EDITION Maldives', 'EDITION Sanya', 'EDITION New York',
  'Four Seasons Maldives', 'Four Seasons Bora Bora', 'Four Seasons Mauritius',
  'Six Senses Zighy Bay', 'Six Senses Bhutan', 'Six Senses Crans-Montana',
  'Six Senses Ibiza', 'Six Senses Yao Noi',
  'St. Regis Maldives', 'St. Regis Bora Bora', 'St. Regis Punta Mita',
  'Ritz-Carlton Maldives', 'Ritz-Carlton Reserve',
  'One&Only Reethi Rah', 'One&Only Le Saint Géran', 'One&Only Mandarina',
  'Capella Bangkok', 'Capella Singapore', 'Capella Sydney', 'Capella Ubud',
  'Rosewood Mayakoba', 'Rosewood Bangkok', 'Rosewood Hong Kong',
  'Park Hyatt Tokyo', 'Park Hyatt Niseko', 'Park Hyatt Mendoza',
  // Faena Hotel Miami / Buenos Aires (Faena já no dict)
  // 'Como' e 'Norman' EXCLUÍDOS: muito ambíguos com palavras comuns em PT.
  // Cruzeiros
  'Silversea', 'Aqua Expeditions', 'Aqua Nera', 'Aqua Mekong',
  'Ritz-Carlton Yacht', 'Delfin', 'AmaWaterways', 'Orient Express', 'Hiram Bingham',
  'Crystal Cruises', 'Seabourn', 'Regent Seven Seas', 'Explora Journeys',
  // Trens (importante p/ Centurion / luxo)
  'La Dolce Vita Orient Express', 'Royal Scotsman', 'Belmond Andean Explorer',
  'Belmond British Pullman', 'Belmond Venice Simplon',
];

/* ─── Matching ─── */

function buildRegexes() {
  const cityRegexes = [];
  for (const [name, def] of Object.entries(CITIES)) {
    const aliases = def.aliases || [name];
    for (const a of aliases) {
      cityRegexes.push({ regex: new RegExp(`\\b${escapeRe(norm(a))}\\b`, 'i'), city: name, country: def.country });
    }
  }
  const countryRegexes = [];
  for (const [name, aliases] of Object.entries(COUNTRIES)) {
    for (const a of aliases) {
      countryRegexes.push({ regex: new RegExp(`\\b${escapeRe(norm(a))}\\b`, 'i'), country: name });
    }
  }
  const brandRegexes = BRANDS.map(b => ({
    regex: new RegExp(`\\b${escapeRe(norm(b).replace(/&/g, ' '))}\\b`, 'i'),
    brand: b,
  }));
  return { cityRegexes, countryRegexes, brandRegexes };
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

/**
 * Extrai entidades com 2 fontes distintas:
 *   - strong (subject + name): 1 match basta — é texto curto e específico
 *   - weak (htmlText): exige 2+ menções pra evitar boilerplate
 *
 * 4.49.26+ Bug fix: htmlText do BTG Partners tem boilerplate
 * ("Cartão Partners BTG — Hospedagens na Tailândia") mesmo em emails
 * que não são sobre Tailândia. Single-mention é ruído. 2+ é genuíno
 * porque o conteúdo real menciona a entidade no header/título E no
 * detalhe (parágrafo/oferta).
 */
function countMatches(haystack, regex) {
  // Regex tem flag global removida — quero re-criar com /g
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  const m = haystack.match(re);
  return m ? m.length : 0;
}

function extractEntities({ subject, name, htmlText }, { cityRegexes, countryRegexes, brandRegexes }) {
  const strongHay = norm(`${subject}\n${name}`);
  const weakHay   = norm(htmlText || '');
  const cities = new Set();
  const countries = new Set();
  const brands = new Set();

  for (const { regex, city, country } of cityRegexes) {
    if (regex.test(strongHay) || countMatches(weakHay, regex) >= 2) {
      cities.add(city);
      if (country) countries.add(country);
    }
  }
  for (const { regex, country } of countryRegexes) {
    if (regex.test(strongHay) || countMatches(weakHay, regex) >= 2) {
      countries.add(country);
    }
  }
  for (const { regex, brand } of brandRegexes) {
    if (regex.test(strongHay) || countMatches(weakHay, regex) >= 2) {
      brands.add(brand);
    }
  }
  return {
    cities: [...cities],
    countries: [...countries],
    brands: [...brands],
  };
}

/* ─── Merge sem sobrescrever ─── */
function mergeUnique(existing, additions) {
  const set = new Set((existing || []).filter(Boolean).map(s =>
    typeof s === 'string' ? s.trim() : (s?.name || '').trim()
  ).filter(Boolean));
  const before = set.size;
  for (const a of additions) set.add(a);
  return { merged: [...set], added: set.size - before };
}

/* ─── Main ─── */
(async () => {
  console.log(`${DRY ? '🔍 DRY-RUN' : '✏  ESCREVENDO'} · Backfill mc_performance · Claude-curated keywords v4.49.25\n`);

  const regexes = buildRegexes();
  console.log(`📚 Dicionário: ${Object.keys(CITIES).length} cidades, ${Object.keys(COUNTRIES).length} países, ${BRANDS.length} marcas\n`);

  const snap = await db.collection('mc_performance').get();
  console.log(`📊 ${snap.size} docs lidos\n`);

  let touched = 0, skipped = 0;
  let addedCities = 0, addedCountries = 0, addedBrands = 0;
  const buStats = {};
  const sampleChanges = [];

  let batch = db.batch();
  let batchN = 0;

  for (const docSnap of snap.docs) {
    const d = docSnap.data();
    const subject = d.subject || '';
    const name    = d.name    || '';
    const ex      = d.extracted || {};
    // 4.49.26+ Inclui htmlText (texto extraído do body, sem tags).
    // User: "ler o html é fundamental. subject entrega muito pouco".
    //
    // ARMADILHAS encontradas no DRY-RUN:
    //   1. Header repetido entre emails (BTG Partners reusa título de outro
    //      doc num email novo — "Cartão Partners BTG — Hospedagens na
    //      Tailândia" vira boilerplate em emails sobre São Paulo).
    //   2. Footer com 800-1000c de regulamentos, atendimento etc.
    //
    // Mitigação: stripa primeiros 200c (header reusado) + últimos 800c
    // (footer regulatório). E exige 2+ menções no body remanescente
    // pra evitar mention única em texto colado.
    const htmlRaw = (d.htmlText || '');
    const htmlBody = htmlRaw.length > 1200
      ? htmlRaw.slice(200, Math.min(8000, htmlRaw.length - 800))
      : ''; // doc muito curto → só boilerplate, descarta

    // Passa as 3 fontes separadamente — extractEntities aplica regra
    // diferente: subject/name = 1 match basta, htmlText = exige 2+
    const found = extractEntities({ subject, name, htmlText: htmlBody }, regexes);

    // Merge — só adiciona, nunca remove
    const cityMerge    = mergeUnique(ex.cities,    found.cities);
    const countryMerge = mergeUnique(ex.countries, found.countries);
    const brandMerge   = mergeUnique(ex.brands,    found.brands);

    const totalAdded = cityMerge.added + countryMerge.added + brandMerge.added;
    if (totalAdded === 0) { skipped++; continue; }

    touched++;
    addedCities    += cityMerge.added;
    addedCountries += countryMerge.added;
    addedBrands    += brandMerge.added;

    const bu = d.buId || d.buName || 'sem-bu';
    if (!buStats[bu]) buStats[bu] = { docs: 0, cities: 0, countries: 0, brands: 0 };
    buStats[bu].docs++;
    buStats[bu].cities    += cityMerge.added;
    buStats[bu].countries += countryMerge.added;
    buStats[bu].brands    += brandMerge.added;

    if (sampleChanges.length < 15) {
      sampleChanges.push({
        id: docSnap.id,
        bu,
        subject: subject.slice(0, 60),
        newCities:    found.cities.filter(c => !(ex.cities || []).includes(c)),
        newCountries: found.countries.filter(c => !(ex.countries || []).includes(c)),
        newBrands:    found.brands.filter(b => !(ex.brands || []).includes(b)),
      });
    }

    if (!DRY) {
      const patch = {
        'extracted.cities':    cityMerge.merged,
        'extracted.countries': countryMerge.merged,
        'extracted.brands':    brandMerge.merged,
        'extracted.extractedBy':
          (ex.extractedBy && !ex.extractedBy.includes('claude-backfill'))
            ? `${ex.extractedBy} + claude-backfill-v4.49.25`
            : 'claude-backfill-v4.49.25',
        // Bump confidence pra medium se era low e ganhou conteúdo
        ...(ex.confidence === 'low' && totalAdded >= 2
          ? { 'extracted.confidence': 'medium' }
          : {}),
        'extracted.backfillTouchedAt': FV.serverTimestamp(),
      };
      batch.update(docSnap.ref, patch);
      batchN++;
      if (batchN >= 100) {
        await batch.commit();
        batch = db.batch();
        batchN = 0;
      }
    }
  }

  if (!DRY && batchN > 0) await batch.commit();

  console.log(`${'━'.repeat(60)}`);
  console.log(`📈 Resumo:`);
  console.log(`   Docs enriquecidos: ${touched}`);
  console.log(`   Docs sem mudança: ${skipped}`);
  console.log(`   Cidades adicionadas: ${addedCities}`);
  console.log(`   Países adicionados:  ${addedCountries}`);
  console.log(`   Marcas adicionadas:  ${addedBrands}`);
  console.log(`\n📊 Por BU (apenas docs tocados):`);
  for (const [bu, s] of Object.entries(buStats).sort((a, b) => b[1].docs - a[1].docs)) {
    console.log(`   ${bu.padEnd(20)} ${s.docs.toString().padStart(3)} docs · +${s.cities} cities · +${s.countries} countries · +${s.brands} brands`);
  }

  console.log(`\n🔍 Amostra de mudanças (primeiros 15):`);
  sampleChanges.forEach(s => {
    console.log(`\n  [${s.bu}] ${s.subject}…`);
    if (s.newCities.length)    console.log(`     + cidades: ${s.newCities.join(', ')}`);
    if (s.newCountries.length) console.log(`     + países:  ${s.newCountries.join(', ')}`);
    if (s.newBrands.length)    console.log(`     + marcas:  ${s.newBrands.join(', ')}`);
  });

  console.log(`\n${DRY ? '⚠  DRY-RUN — nada foi escrito. Rode sem --dry pra aplicar.' : '✅ Escrita concluída.'}`);
  process.exit(0);
})();
