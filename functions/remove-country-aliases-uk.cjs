/**
 * Remove countryAliases:['Reino Unido'] dos destinations UK.
 *
 * Justificativa: Renê (28/05/2026) editou as 13 imagens "Reino Unido"
 * pra "Europa/Inglaterra/Londres" direto via UI v4.63.51. Banco zerado
 * de country='Reino Unido'. Alias inútil agora — só introduz ambiguidade
 * em uploads futuros (Inglaterra E Escócia matchariam "Reino Unido"
 * sem desambiguação).
 *
 * Se subir uma imagem futura marcada UK, user edita pra país canônico.
 * Idempotente; dry-run default; --apply pra gravar.
 */
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const APPLY = process.argv.includes('--apply');
const REMOVE = 'Reino Unido';

(async () => {
  console.log(`\n=== REMOVE countryAliases:['${REMOVE}'] ${APPLY ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  const snap = await db.collection('portal_destinations').get();
  let touched = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const aliases = Array.isArray(data.countryAliases) ? data.countryAliases : [];
    if (!aliases.includes(REMOVE)) continue;
    const next = aliases.filter(a => a !== REMOVE);
    touched++;
    console.log(`  ${APPLY ? '✓' : '·'} ${doc.id.padEnd(28)} ${data.city.padEnd(25)} / ${data.country}` +
      `   ${JSON.stringify(aliases)} → ${JSON.stringify(next)}`);
    if (APPLY) {
      await doc.ref.update({
        countryAliases: next.length ? next : admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'system-cleanup',
      });
    }
  }
  console.log(`\n${APPLY ? '✓' : '·'} ${touched} destinations ${APPLY ? 'updated' : 'will update'}.`);
  console.log(`${APPLY ? '✓ APPLY done.' : '✓ DRY-RUN. Run with --apply.'}\n`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
