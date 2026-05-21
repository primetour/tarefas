/**
 * Importa destinos do xlsx em /Users/rene/Downloads/destinos.xlsx
 * Aplica MESMA lógica do componente destinationsImport.js v4.49.9:
 *   - Tolerância a aliases de coluna (Continente/Country/Cidade etc)
 *   - Trim + normalize case+acento
 *   - Dedup intra-file (primeira row passa, demais marcadas)
 *   - Dedup vs Firestore (slug match)
 *   - Erro pra continente inválido
 *
 * Diferente do componente UI: roda via firebase-admin (server-side) e
 * importa direto, sem confirmar com o user no meio.
 */
const admin = require('firebase-admin');
const xlsx  = require('./node_modules/xlsx');
const path  = require('path');

admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const CONTINENTS = [
  'Brasil','África','América Central','Caribe','América do Norte','América do Sul',
  'Ásia','Europa','Oriente Médio','Oceania','Antártica',
];

const slugify = (parts) => parts.filter(Boolean)
  .map(s => String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  .join('/');

const COL_ALIASES = {
  continent: ['continente', 'continent'],
  country:   ['país', 'pais', 'country'],
  city:      ['cidade', 'cidade/região', 'cidade-região', 'cidade regiao', 'city', 'região', 'regiao'],
  notes:     ['notas', 'observações', 'observacoes', 'notes', 'obs'],
};

function pickColumn(row, key) {
  const aliases = COL_ALIASES[key];
  for (const k of Object.keys(row)) {
    const norm = k.toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (aliases.some(a => norm === a.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))) {
      return String(row[k] || '').trim();
    }
  }
  return '';
}

(async () => {
  const FILE = '/Users/rene/Downloads/destinos.xlsx';
  console.log(`Lendo ${FILE}...`);
  const wb = xlsx.readFile(FILE);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
  console.log(`${rows.length} linha(s) no xlsx (sheet: "${wb.SheetNames[0]}")`);

  if (rows.length) {
    console.log(`Colunas detectadas: ${Object.keys(rows[0]).join(', ')}`);
  }

  // Carrega destinos existentes pra dedup
  const existingSnap = await db.collection('portal_destinations').get();
  const existing = existingSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const existingMap = new Map();
  existing.forEach(d => {
    const slug = slugify([d.continent, d.country, d.city]);
    if (slug) existingMap.set(slug, d);
  });
  console.log(`${existing.length} destino(s) já no Firestore.\n`);

  // Parse + dedup intra-file
  const seenInFile = new Map();
  const parsed = rows.map((r, idx) => {
    const continent = pickColumn(r, 'continent');
    const country   = pickColumn(r, 'country');
    const city      = pickColumn(r, 'city');
    const notes     = pickColumn(r, 'notes');
    const errors = [];
    if (!continent) errors.push('Continente vazio');
    else if (!CONTINENTS.includes(continent)) errors.push(`Continente "${continent}" inválido`);
    if (!country) errors.push('País vazio');

    const slug = (continent && country) ? slugify([continent, country, city]) : '';
    const dupFs = slug && existingMap.has(slug);
    const firstSeen = slug ? seenInFile.get(slug) : null;
    const dupFile = !!firstSeen;
    if (slug && !firstSeen) seenInFile.set(slug, idx + 2);

    return {
      rowNum: idx + 2,
      continent, country, city, notes,
      slug, errors,
      dupFs, dupFile, dupFileFrom: firstSeen || null,
      action: errors.length ? 'skip-error'
            : dupFs ? 'skip-already-exists'
            : dupFile ? 'skip-intra-dup'
            : 'create',
    };
  });

  // Resumo
  const counts = parsed.reduce((acc, p) => { acc[p.action] = (acc[p.action]||0)+1; return acc; }, {});
  console.log(`Resumo do parse:`);
  console.log(`  create:              ${counts.create || 0}`);
  console.log(`  skip-already-exists: ${counts['skip-already-exists'] || 0}`);
  console.log(`  skip-intra-dup:      ${counts['skip-intra-dup'] || 0}`);
  console.log(`  skip-error:          ${counts['skip-error'] || 0}`);
  console.log('');

  // Mostra erros (se houver)
  const errs = parsed.filter(p => p.action === 'skip-error');
  if (errs.length) {
    console.log(`Linhas com erro (${errs.length}):`);
    errs.forEach(e => console.log(`  L${e.rowNum}: ${e.errors.join('; ')} [${e.continent}/${e.country}/${e.city}]`));
    console.log('');
  }

  // Mostra dups intra-file (se houver)
  const intra = parsed.filter(p => p.action === 'skip-intra-dup');
  if (intra.length) {
    console.log(`Linhas duplicadas dentro do Excel (${intra.length}):`);
    intra.forEach(d => console.log(`  L${d.rowNum} repete L${d.dupFileFrom}: ${d.continent}/${d.country}/${d.city}`));
    console.log('');
  }

  // Mostra dups vs Firestore
  const fsDups = parsed.filter(p => p.action === 'skip-already-exists');
  if (fsDups.length) {
    console.log(`Linhas que já existem no Firestore (${fsDups.length}):`);
    fsDups.forEach(d => console.log(`  L${d.rowNum}: ${d.continent}/${d.country}/${d.city}`));
    console.log('');
  }

  // IMPORTA
  const toCreate = parsed.filter(p => p.action === 'create');
  console.log(`Importando ${toCreate.length} destinos...`);
  let ok = 0, fail = 0;
  for (const r of toCreate) {
    try {
      const docRef = db.collection('portal_destinations').doc();
      await docRef.set({
        continent: r.continent,
        country:   r.country,
        city:      r.city,
        notes:     r.notes,
        slug:      r.slug,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: 'system-bulk-import-' + path.basename(FILE),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: 'system-bulk-import-' + path.basename(FILE),
      });
      ok++;
    } catch (e) {
      fail++;
      console.error(`  FAIL L${r.rowNum} (${r.continent}/${r.country}/${r.city}):`, e.message);
    }
  }
  console.log(`\nResultado:`);
  console.log(`  Criados: ${ok}`);
  console.log(`  Falhas:  ${fail}`);

  // Total novo
  const after = await db.collection('portal_destinations').get();
  console.log(`\nDestinos totais no Firestore: ${after.size} (antes: ${existing.length}; delta: +${after.size - existing.length})`);

  process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
