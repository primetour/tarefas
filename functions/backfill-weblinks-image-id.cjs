/**
 * Backfill imageId em portal_web_links.imagesByDest._overrides.
 *
 * Auditoria (v4.63.49) achou 7 web_links com 21 URLs R2 e 0% rastreabilidade
 * (sem imageId). Quando admin deletar uma dessas imagens no Banco, URL fica
 * 404 sem que cleanup possa detectar.
 *
 * Estratégia: lookup reverso URL → imageId via Map de portal_images.url.
 * Idempotente: pula overrides que já têm imageId.
 *
 * Dry-run default; --apply pra gravar.
 */
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const APPLY = process.argv.includes('--apply');

(async () => {
  console.log(`\n=== BACKFILL imageId em portal_web_links ${APPLY ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  // 1. Mapa URL → imageId
  const imgs = await db.collection('portal_images').get();
  const urlToImageId = new Map();
  imgs.forEach(d => {
    const url = d.data().url;
    if (url) urlToImageId.set(url, d.id);
  });
  console.log(`[1] portal_images: ${imgs.size} docs, ${urlToImageId.size} URLs únicas mapeadas`);

  // 2. Scan portal_web_links
  const links = await db.collection('portal_web_links').get();
  let docsUpdated = 0;
  let overridesUpdated = 0;
  let overridesSkippedAlreadyHasId = 0;
  let overridesNoMatch = 0;

  for (const linkDoc of links.docs) {
    const data = linkDoc.data();
    const ibd  = data.imagesByDest || {};
    let touched = false;
    const newIbd = JSON.parse(JSON.stringify(ibd));  // deep clone

    for (const destKey of Object.keys(newIbd)) {
      const ov = newIbd[destKey]?._overrides || {};
      for (const segKey of Object.keys(ov)) {
        const seg = ov[segKey] || {};
        for (const idx of Object.keys(seg)) {
          const it = seg[idx];
          if (!it || !it.url) continue;
          if (it.imageId) { overridesSkippedAlreadyHasId++; continue; }
          const imageId = urlToImageId.get(it.url);
          if (imageId) {
            seg[idx] = { ...it, imageId };
            overridesUpdated++;
            touched = true;
          } else {
            overridesNoMatch++;
          }
        }
      }
    }

    if (touched) {
      docsUpdated++;
      if (APPLY) {
        await linkDoc.ref.update({
          imagesByDest: newIbd,
          backfillImageIdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      console.log(`  ${APPLY ? '✓' : '·'} ${linkDoc.id}: ${touched ? '+imageId em overrides' : 'no-op'}`);
    }
  }

  console.log(`\n[summary]`);
  console.log(`  web_links scanned:           ${links.size}`);
  console.log(`  docs com overrides updated:  ${docsUpdated}`);
  console.log(`  overrides com imageId added: ${overridesUpdated}`);
  console.log(`  overrides já tinham imageId: ${overridesSkippedAlreadyHasId}`);
  console.log(`  overrides URL sem match:     ${overridesNoMatch}` +
    `  (imagem provavelmente já foi deletada ou é de fonte externa)`);
  console.log(`\n${APPLY ? '✓ APPLY concluído.' : '✓ DRY-RUN. Rode com --apply pra gravar.'}\n`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
