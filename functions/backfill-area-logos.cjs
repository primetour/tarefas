/**
 * Backfill: cataloga logos de áreas (já no R2) na collection portal_images
 * Resolve o caso em que /portal-areas subia logos sem criar entry, então o
 * filtro "Logo" do banco de imagens dava 0.
 *
 * Idempotente: pula se já existe portal_image com o mesmo path.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const areasSnap = await db.collection('portal_areas').get();
  console.log(`${areasSnap.size} áreas encontradas`);

  let created = 0, skipped = 0;

  for (const a of areasSnap.docs) {
    const area = a.data();
    const candidates = [
      { url: area.logoUrl,    slot: 'main', label: 'principal' },
      { url: area.logoUrlAlt, slot: 'alt',  label: 'alternativa' },
    ].filter(c => c.url && c.url.includes('r2.dev') && c.url.includes('/logos/'));

    for (const c of candidates) {
      // Extrai path do URL: https://pub-xxx.r2.dev/logos/foo.webp → logos/foo.webp
      const path = c.url.split('.r2.dev/')[1];
      if (!path) continue;

      // Check duplicate
      const existing = await db.collection('portal_images')
        .where('path', '==', path).limit(1).get();
      if (!existing.empty) {
        skipped++;
        continue;
      }

      await db.collection('portal_images').add({
        assetCategory: 'logo',
        type:          'logo_area',
        name:          `Logo ${area.name || area.id} (${c.label})`,
        placeName:     area.name || '',
        tags:          ['logo', (area.name || '').toLowerCase(), c.slot, 'backfill'],
        copyright:     `© ${area.name || 'Primetour'}`,
        url:           c.url,
        path,
        continent:     '',
        country:       '',
        city:          '',
        originalName:  path.split('/').pop(),
        sizeMB:        0,
        width:         0,
        height:        0,
        uploadedAt:    admin.firestore.FieldValue.serverTimestamp(),
        uploadedBy:    'backfill-script',
      });
      console.log(`  + ${path} (${area.name})`);
      created++;
    }
  }

  console.log(`\n✓ ${created} logos catalogados, ${skipped} já existiam.`);
  process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
