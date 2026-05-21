/**
 * Corrige os 2 destinos que falharam no import anterior:
 *  - L26: "América Central e Caribe / Bahamas / Bahamas"
 *    → "Caribe / Bahamas / Bahamas" (Bahamas é ilha no Caribe)
 *  - L39: "Europa/Ásia / Turquia / Istambul"
 *    → "Europa / Turquia / Istambul" (Istambul é cidade na parte europeia)
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const slugify = (parts) => parts.filter(Boolean)
  .map(s => String(s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  .join('/');

const FIXES = [
  { continent: 'Caribe', country: 'Bahamas', city: 'Bahamas', notes: 'Reclassificado de "América Central e Caribe" → Caribe' },
  { continent: 'Europa', country: 'Turquia', city: 'Istambul', notes: 'Reclassificado de "Europa/Ásia" → Europa (Istambul é cidade europeia)' },
];

(async () => {
  for (const r of FIXES) {
    const slug = slugify([r.continent, r.country, r.city]);
    // Skip se já existe
    const dup = await db.collection('portal_destinations').where('slug','==',slug).limit(1).get();
    if (!dup.empty) {
      console.log(`SKIP ${r.continent}/${r.country}/${r.city} (já existe id=${dup.docs[0].id})`);
      continue;
    }
    const ref = db.collection('portal_destinations').doc();
    await ref.set({
      continent: r.continent, country: r.country, city: r.city, notes: r.notes,
      slug,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: 'system-bulk-import-destinos.xlsx-fix',
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: 'system-bulk-import-destinos.xlsx-fix',
    });
    console.log(`OK   ${r.continent}/${r.country}/${r.city}  (id=${ref.id})`);
  }
  const after = await db.collection('portal_destinations').get();
  console.log(`\nTotal de destinos agora: ${after.size}`);
  process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
