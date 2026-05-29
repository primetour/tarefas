const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const ID = process.argv[2] || '4bTybLbDGfarh3Rp5XSd';

(async () => {
  const snap = await db.collection('roteiros').doc(ID).get();
  if (!snap.exists) { console.log('NOT FOUND', ID); process.exit(1); }
  const d = snap.data();
  console.log('=== TOP-LEVEL KEYS ===');
  console.log(Object.keys(d).sort().join(', '));
  console.log('\n=== BASICS ===');
  console.log('title:', d.title || d.titulo);
  console.log('areaId:', d.areaId);
  console.log('days:', (d.days || d.dias || []).length);
  console.log('flights:', (d.flights || d.voos || []).length);
  console.log('hotels:', (d.hotels || d.hoteis || []).length);
  console.log('coverImage:', d.coverImage || d.coverImageUrl || d.heroUrl || '(none)');
  console.log('images keys:', d.images ? Object.keys(d.images).join(',') : '(none)');

  console.log('\n=== PAYMENT/CANCEL/INFO ===');
  console.log('payment:', JSON.stringify(d.payment || d.pagamento || {}).slice(0, 200));
  console.log('cancellation:', JSON.stringify(d.cancellation || d.cancelamento || {}).slice(0, 200));
  console.log('importantInfo:', JSON.stringify(d.importantInfo || d.informacoes || {}).slice(0, 200));

  console.log('\n=== EMBEDDED TIPS ===');
  const tips = d.embeddedTips || [];
  console.log('count:', tips.length);
  tips.forEach((t, i) => {
    console.log(`\n--- tip[${i}] ---`);
    console.log('keys:', Object.keys(t).join(', '));
    console.log('title:', t.title);
    console.log('subtitle:', t.subtitle);
    console.log('tipId:', t.tipId);
    console.log('snapshotAt:', t.snapshotAt && (t.snapshotAt.toDate ? t.snapshotAt.toDate().toISOString() : t.snapshotAt));
    const segs = t.content && t.content.segments;
    if (segs) {
      console.log('segments keys:', Object.keys(segs).join(', '));
      for (const k of Object.keys(segs)) {
        const v = segs[k];
        if (Array.isArray(v)) {
          console.log(`  [${k}] ARRAY len=${v.length}`);
        } else if (v && typeof v === 'object') {
          const items = v.items;
          console.log(`  [${k}] OBJECT items=${Array.isArray(items) ? items.length : '(none)'} otherKeys=${Object.keys(v).filter(x=>x!=='items').join(',')}`);
          if (Array.isArray(items) && items.length) {
            console.log(`     item[0] keys: ${Object.keys(items[0]).join(', ')}`);
            console.log(`     item[0]: ${JSON.stringify(items[0]).slice(0, 240)}`);
          }
        } else {
          console.log(`  [${k}] = ${JSON.stringify(v).slice(0,80)}`);
        }
      }
    } else {
      console.log('content.segments: (none) — content keys:', t.content ? Object.keys(t.content).join(',') : '(no content)');
    }
  });
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
