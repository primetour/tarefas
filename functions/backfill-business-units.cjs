// v4.62.44+ Fase F.2 — Backfill: copia portal_areas → business_units.
//
// Não deleta nada. Idempotente: skip se já existe BU com mesmo
// legacyPortalAreaId. Marca usedFor: ['portal', 'roteiros'] (default).
//
// Uso:
//   node backfill-business-units.cjs            # DRY-RUN (só conta o que faria)
//   node backfill-business-units.cjs --apply    # APLICA mesmo

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const APPLY = process.argv.includes('--apply');

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

(async () => {
  const areasSnap = await db.collection('portal_areas').get();
  console.log(`Found ${areasSnap.size} docs em portal_areas`);

  if (!areasSnap.size) {
    console.log('Nada a migrar.');
    process.exit(0);
  }

  // Index existing business_units por legacyPortalAreaId pra idempotência
  let buSnap;
  try { buSnap = await db.collection('business_units').get(); }
  catch (e) { buSnap = { size: 0, docs: [] }; }
  const existingByLegacy = new Map();
  buSnap.docs?.forEach(d => {
    const legId = d.data()?.legacyPortalAreaId;
    if (legId) existingByLegacy.set(legId, d.id);
  });
  console.log(`Found ${buSnap.size || 0} BUs existentes (${existingByLegacy.size} com legacyPortalAreaId)`);

  let migrated = 0, skipped = 0, errors = 0;
  for (const areaDoc of areasSnap.docs) {
    const areaId = areaDoc.id;
    const area = areaDoc.data();

    if (existingByLegacy.has(areaId)) {
      console.log(`= skip ${area.name || areaId} (já existe BU ${existingByLegacy.get(areaId)})`);
      skipped++;
      continue;
    }

    const payload = {
      name:               area.name || `(sem nome)`,
      slug:               slugify(area.name || areaId),
      category:           area.category || '',
      logoUrl:            area.logoUrl || null,
      logoUrlAlt:         area.logoUrlAlt || null,
      colors:             area.colors    || null,
      fonts:              area.fonts     || null,
      editorial:          area.editorial || null,
      brand:              area.brand     || { useExternalName: true },
      modules:            area.modules   || null,
      usedFor:            ['portal', 'roteiros'],  // default — admin pode customizar depois
      legacyPortalAreaId: areaId,
      legacySectorId:     null,
      active:             area.active !== false,
      createdAt:          FV.serverTimestamp(),
      createdBy:          'system-migration',
      migratedFrom:       'portal_areas',
      migratedAt:         FV.serverTimestamp(),
    };

    if (APPLY) {
      try {
        // Usa o MESMO id (areaId) pra fácil cross-reference. Se quiser ids
        // diferentes no futuro, é só remover .doc(areaId) e usar add().
        await db.collection('business_units').doc(areaId).set(payload, { merge: false });
        console.log(`+ migrated ${area.name || areaId}`);
        migrated++;
      } catch (e) {
        console.error(`× fail ${area.name || areaId}: ${e.message}`);
        errors++;
      }
    } else {
      console.log(`DRY-RUN would migrate: ${area.name || areaId} (slug: ${slugify(area.name || areaId)})`);
      migrated++;
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total portal_areas: ${areasSnap.size}`);
  console.log(`Already migrated:   ${skipped}`);
  console.log(`Migrated this run:  ${migrated}`);
  console.log(`Errors:             ${errors}`);
  console.log(`Mode:               ${APPLY ? 'APPLY' : 'DRY-RUN (rode com --apply pra aplicar)'}`);
  process.exit(0);
})();
