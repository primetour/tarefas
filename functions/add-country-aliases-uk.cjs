/**
 * Adiciona countryAliases:['Reino Unido'] em destinations dos países UK.
 *
 * Justificativa: Banco de Imagens tem 13 imagens marcadas como country=
 * 'Reino Unido', mas portal_destinations canônico usa 'Inglaterra'
 * (Londres/Liverpool/Stratford). Sem alias, fetchImages({country:'Inglaterra'})
 * não retorna essas 13 imagens.
 *
 * Idempotente: pula docs que já têm o alias.
 * Dry-run default; --apply pra gravar.
 */
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const APPLY = process.argv.includes('--apply');
const UK_COUNTRIES = ['Inglaterra', 'Escócia', 'Escocia', 'País de Gales', 'Pais de Gales', 'Irlanda do Norte', 'Reino Unido'];
const NEW_ALIAS = 'Reino Unido';

(async () => {
  console.log(`\n=== ADD countryAliases:['Reino Unido'] ${APPLY ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('portal_destinations').get();
  let updated = 0, skipped = 0;
  const touched = [];

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    if (!UK_COUNTRIES.includes(data.country)) continue;
    // Não adiciona alias se o próprio canônico já É "Reino Unido"
    if (data.country === NEW_ALIAS) { skipped++; continue; }
    const existing = Array.isArray(data.countryAliases) ? data.countryAliases : [];
    if (existing.includes(NEW_ALIAS)) { skipped++; continue; }
    const next = [...existing, NEW_ALIAS];
    touched.push({ id: docSnap.id, city: data.city, country: data.country, next });
    if (APPLY) {
      await docSnap.ref.update({
        countryAliases: next,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'system-backfill',
      });
    }
    updated++;
  }

  console.log(`[summary]`);
  console.log(`  destinations UK encontrados: ${touched.length + skipped}`);
  console.log(`  ${APPLY ? 'updated' : 'will update'}:   ${updated}`);
  console.log(`  skipped (já tinha):         ${skipped}`);
  console.log('');
  touched.forEach(t => console.log(`  ${APPLY ? '✓' : '·'} ${t.id.padEnd(30)} ${t.city.padEnd(25)} / ${t.country}`));
  console.log(`\n${APPLY ? '✓ APPLY done.' : '✓ DRY-RUN. Run with --apply.'}\n`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
