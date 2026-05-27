/**
 * Audit duplicatas em portal_destinations
 *
 * Detecta cidades duplicadas (mesma cidade, grafias diferentes) DENTRO do
 * mesmo país. Estratégias de detecção:
 *
 *   1. Normalização case+acentos (Quito = QUITO = quito)
 *   2. Mapa de aliases hardcoded conhecidos (Tokyo↔Tóquio, Cape Town↔Cidade do Cabo)
 *   3. Diferença de prefixo "Saint/São/Santa" (St. John = São João)
 *   4. Distância Levenshtein <= 2 (typos: Cuzco/Cusco)
 *
 * Outputs:
 *   - Lista de grupos { country, members: [...docs], suggestedCanonical }
 *   - Conta total de duplicatas
 *   - Não muta nada (read-only)
 */

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

/** Aliases hardcoded — pares en↔pt mais comuns em viagens.
 *  Chave normalizada (lower, sem acento). Valor: nome canônico pt-BR. */
const CITY_ALIASES = {
  // Japão
  'tokyo': 'Tóquio', 'toquio': 'Tóquio',
  'kyoto': 'Quioto', 'quioto': 'Quioto',
  'osaka': 'Osaka',
  'hiroshima': 'Hiroshima',
  // EUA
  'new york': 'Nova Iorque', 'nova york': 'Nova Iorque', 'nova iorque': 'Nova Iorque',
  'los angeles': 'Los Angeles',
  'san francisco': 'São Francisco', 'sao francisco': 'São Francisco',
  'new orleans': 'Nova Orleans', 'nova orleans': 'Nova Orleans',
  // África do Sul
  'cape town': 'Cidade do Cabo', 'cidade do cabo': 'Cidade do Cabo',
  'johannesburg': 'Joanesburgo', 'joanesburgo': 'Joanesburgo',
  // Itália
  'rome': 'Roma', 'roma': 'Roma',
  'florence': 'Florença', 'florenca': 'Florença', 'firenze': 'Florença',
  'venice': 'Veneza', 'venezia': 'Veneza',
  'milan': 'Milão', 'milao': 'Milão', 'milano': 'Milão',
  'naples': 'Nápoles', 'napoli': 'Nápoles', 'napoles': 'Nápoles',
  // Grécia
  'athens': 'Atenas', 'atenas': 'Atenas',
  'santorini': 'Santorini',
  'mykonos': 'Mykonos',
  // Egito
  'cairo': 'Cairo',
  'luxor': 'Luxor',
  'aswan': 'Aswan',
  // Áustria
  'vienna': 'Viena', 'wien': 'Viena', 'viena': 'Viena',
  'salzburg': 'Salzburgo', 'salzburgo': 'Salzburgo',
  // Alemanha
  'munich': 'Munique', 'munchen': 'Munique', 'munique': 'Munique',
  'berlin': 'Berlim', 'berlim': 'Berlim',
  // Rep Tcheca
  'prague': 'Praga', 'praha': 'Praga', 'praga': 'Praga',
  // Hungria
  'budapest': 'Budapeste', 'budapeste': 'Budapeste',
  // Polônia
  'warsaw': 'Varsóvia', 'warszawa': 'Varsóvia', 'varsovia': 'Varsóvia',
  'krakow': 'Cracóvia', 'cracow': 'Cracóvia', 'cracovia': 'Cracóvia',
  // Rússia
  'moscow': 'Moscou', 'moskva': 'Moscou', 'moscou': 'Moscou',
  // Marrocos
  'marrakesh': 'Marraquexe', 'marrakech': 'Marraquexe', 'marraquexe': 'Marraquexe',
  // Peru
  'cusco': 'Cusco', 'cuzco': 'Cusco', 'qosqo': 'Cusco',
  // Argentina
  'buenos aires': 'Buenos Aires',
  'mendoza': 'Mendoza',
  // China
  'beijing': 'Pequim', 'peking': 'Pequim', 'pequim': 'Pequim',
  'shanghai': 'Xangai', 'xangai': 'Xangai',
  // Índia
  'mumbai': 'Mumbai', 'bombay': 'Mumbai', 'bombaim': 'Mumbai',
  'delhi': 'Déli', 'new delhi': 'Nova Délhi', 'nova delhi': 'Nova Délhi', 'deli': 'Déli',
  // Reino Unido
  'london': 'Londres', 'londres': 'Londres',
  'edinburgh': 'Edimburgo', 'edimburgo': 'Edimburgo',
  // Bélgica
  'brussels': 'Bruxelas', 'bruxelas': 'Bruxelas', 'bruxelles': 'Bruxelas',
  // Holanda
  'amsterdam': 'Amsterdã', 'amsterda': 'Amsterdã',
  // Turquia
  'istanbul': 'Istambul', 'istambul': 'Istambul',
  // Quênia
  'nairobi': 'Nairóbi', 'nairobi ': 'Nairóbi', 'nairobi.': 'Nairóbi', 'nairóbi': 'Nairóbi',
  // Espanha
  'seville': 'Sevilha', 'sevilla': 'Sevilha', 'sevilha': 'Sevilha',
};

function normKey(s) {
  return String(s || '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function resolveCanonical(cityName) {
  const k = normKey(cityName);
  return CITY_ALIASES[k] || null;
}

// Levenshtein simples (cap 3 — só pra typos curtos)
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

(async () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  AUDIT DUPLICATAS portal_destinations');
  console.log('═══════════════════════════════════════════════════════\n');

  const snap = await db.collection('portal_destinations').get();
  console.log(`Total docs: ${snap.size}\n`);

  // Agrupa por país (countryCode preferido)
  const byCountry = new Map();
  snap.forEach(d => {
    const data = { id: d.id, ...d.data() };
    const cKey = data.countryCode || normKey(data.country || '');
    if (!cKey) return;
    if (!byCountry.has(cKey)) byCountry.set(cKey, []);
    byCountry.get(cKey).push(data);
  });

  console.log(`Países distintos: ${byCountry.size}\n`);

  const dupGroups = [];   // [{ country, canonical, members }]
  let totalDups = 0;

  for (const [cKey, docs] of byCountry) {
    if (docs.length < 2) continue;

    // Agrupa via 3 estratégias:
    // (a) normKey idêntica
    // (b) alias canônico bate (Tokyo/Tóquio → 'Tóquio')
    // (c) Levenshtein <= 2 e cidades ambas têm cityName
    const buckets = new Map();   // canonicalKey → [docs]

    for (const doc of docs) {
      const city = doc.city || '';
      if (!city) continue;
      const nk = normKey(city);

      // 1. resolveCanonical (alias hardcoded)
      const aliased = resolveCanonical(city);
      const groupKey = aliased ? normKey(aliased) : nk;

      if (!buckets.has(groupKey)) buckets.set(groupKey, []);
      buckets.get(groupKey).push(doc);
    }

    // v2: Levenshtein <=2 era PERIGOSO (Paros/Naxos, Chiang Mai/Chiang Rai
    // são cidades distintas mas Levenshtein bate). Removido. Estratégia agora:
    // SÓ aliases hardcoded + normKey idêntica. Falsos positivos = quase zero.

    for (const [groupKey, members] of buckets) {
      if (members.length < 2) continue;
      // Escolhe canonical: prefere
      //   1. nome resolvido via alias (já tem versão pt canônica)
      //   2. nome com acentos (provavelmente pt-BR)
      //   3. doc approved sobre pending
      //   4. doc mais antigo
      let canonical = null;
      for (const m of members) {
        const aliased = resolveCanonical(m.city);
        if (aliased && m.city === aliased) { canonical = m; break; }
      }
      if (!canonical) {
        canonical = members.find(m => /[áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/.test(m.city || ''))
                || members.find(m => (m.reviewStatus || 'approved') === 'approved')
                || members[0];
      }
      const others = members.filter(m => m.id !== canonical.id);

      dupGroups.push({
        country: canonical.country || cKey,
        countryCode: canonical.countryCode || null,
        canonical: { id: canonical.id, city: canonical.city, source: canonical.source, reviewStatus: canonical.reviewStatus },
        duplicates: others.map(m => ({ id: m.id, city: m.city, source: m.source, reviewStatus: m.reviewStatus })),
      });
      totalDups += others.length;
    }
  }

  // Sort: country, depois city
  dupGroups.sort((a, b) => (a.country || '').localeCompare(b.country || '', 'pt-BR'));

  console.log(`═══ DUPLICATAS DETECTADAS ═══`);
  console.log(`Grupos: ${dupGroups.length}`);
  console.log(`Docs duplicados (vão ser merged): ${totalDups}\n`);

  for (const g of dupGroups) {
    const cTag = `[${g.countryCode || '??'}]`;
    console.log(`  ${cTag} ${g.country} — canônico: "${g.canonical.city}" (${g.canonical.source||'?'}, ${g.canonical.reviewStatus||'approved'})`);
    for (const d of g.duplicates) {
      console.log(`           ↳ alias: "${d.city}" (${d.source||'?'}, ${d.reviewStatus||'approved'}) → vai virar cityAliases`);
    }
  }

  console.log(`\n═══ TOTAIS ═══`);
  console.log(`  Grupos detectados: ${dupGroups.length}`);
  console.log(`  Docs que serão deletados (após move FK): ${totalDups}`);
  console.log(`  portal_destinations: ${snap.size} → ${snap.size - totalDups} (após merge)`);

  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
