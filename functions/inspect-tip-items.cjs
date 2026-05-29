const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

function walk(obj, prefix, depth, out) {
  if (depth > 4) return;
  if (Array.isArray(obj)) {
    out.push(`${prefix} = Array(${obj.length})`);
    if (obj.length && typeof obj[0] === 'object' && obj[0]) {
      out.push(`${prefix}[0] keys: ${Object.keys(obj[0]).join(', ')}`);
    } else if (obj.length) {
      out.push(`${prefix}[0] = ${JSON.stringify(obj[0]).slice(0,80)}`);
    }
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) walk(obj[k], `${prefix}.${k}`, depth+1, out);
    return;
  }
  out.push(`${prefix} = ${JSON.stringify(obj).slice(0,60)}`);
}

(async () => {
  // 1. Source tip
  const snap = await db.collection('portal_tips').doc('NerisIfMXaafNEeX6zKk').get();
  console.log('=== SOURCE TIP NerisIfMXaafNEeX6zKk ===');
  if (snap.exists) {
    const out = [];
    walk(snap.data(), 'tip', 0, out);
    console.log(out.join('\n'));
  } else console.log('NOT FOUND');

  // 2. Cotação embeddedTips snapshot
  console.log('\n=== COTAÇÃO 4bTybLbDGfarh3Rp5XSd embeddedTips ===');
  const c = await db.collection('roteiros').doc('4bTybLbDGfarh3Rp5XSd').get();
  if (c.exists) {
    const et = c.data().embeddedTips || [];
    console.log('embeddedTips.length:', et.length);
    if (et.length) {
      const out = [];
      walk(et[0], 'emb', 0, out);
      console.log(out.join('\n'));
    }
  } else console.log('COTAÇÃO NOT FOUND');
  process.exit(0);
})();
