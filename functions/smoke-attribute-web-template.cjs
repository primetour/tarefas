// Smoke v4.63.23 — atribui template Web à Lazer + cria web link de teste
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const TPL_ID = 'MavnDRBVf5803rIfU84Y';  // seed v4.63.23

(async () => {
  const mode = process.argv.includes('--cleanup') ? 'cleanup' : 'set';

  // 1) Atribui à Lazer
  const areasSnap = await db.collection('portal_areas').where('name', '==', 'Lazer').limit(1).get();
  if (areasSnap.empty) { console.log('Lazer não encontrado'); process.exit(1); }
  const areaRef = areasSnap.docs[0].ref;
  const cur = areasSnap.docs[0].data().templateRefs || {};
  const newRefs = JSON.parse(JSON.stringify(cur));

  if (mode === 'set') {
    newRefs.portal = newRefs.portal || {};
    newRefs.portal.web = TPL_ID;
    await areaRef.update({ templateRefs: newRefs, updatedAt: FV.serverTimestamp() });
    console.log(`+ Lazer.templateRefs.portal.web = ${TPL_ID}`);
  } else {
    if (newRefs.portal?.web === TPL_ID) {
      delete newRefs.portal.web;
      if (Object.keys(newRefs.portal).length === 0) delete newRefs.portal;
      await areaRef.update({ templateRefs: newRefs, updatedAt: FV.serverTimestamp() });
      console.log(`- Lazer.templateRefs.portal.web removido`);
    }
    process.exit(0);
  }

  // 2) Cria web link de teste apontando pra Lazer com webTemplate metadata
  const token = `smoke-web-${Date.now()}`;
  const tplDoc = await db.collection('templates').doc(TPL_ID).get();
  const tpl = tplDoc.data();

  // Fetch 2-3 tips quaisquer pra encher
  const tipsSnap = await db.collection('portal_tips').limit(3).get();
  const tipData = tipsSnap.docs.map(d => {
    const t = d.data();
    return {
      tip: { id: d.id, ...t },
      dest: { id: t.destinationId || d.id, city: t.city || 'Destino', country: t.country || 'País' },
    };
  });

  // Fetch destinos pra hero images
  const destSnap = await db.collection('portal_destinations').limit(5).get();
  const imagesByDest = {};
  destSnap.docs.forEach(d => {
    imagesByDest[d.id] = { hero: d.data().images?.hero || d.data().heroImage || null };
  });

  await db.collection('portal_web_links').doc(token).set({
    token, format: 'web',
    tipData,
    allTips: tipData.map(({tip, dest}) => ({tipId: tip.id, destId: dest.id})),
    segments: [],
    areaName: 'Lazer',
    areaLogoUrl: areasSnap.docs[0].data().logoUrl || null,
    areaLogoUrlAlt: areasSnap.docs[0].data().logoUrlAlt || null,
    colors: areasSnap.docs[0].data().colors || {},
    fonts: null, editorial: null, modules: null,
    webExports: {
      footerText: 'PRIMETOUR Lazer · cotacoes@primetour.com.br',
      headerText: 'CONFIDENCIAL',
    },
    // v4.63.22+ webTemplate metadata
    webTemplate: {
      templateId: tpl ? TPL_ID : null,
      templateName: tpl?.name || '',
      templateMode: tpl?.templateMode || 'full',
      fileUrl: tpl?.fileUrl || '',
    },
    imagesByDest,
    createdBy: { uid: 'smoke', name: 'Smoke Test', email: '' },
    createdAt: FV.serverTimestamp(),
    views: 0,
  });

  console.log(`+ portal_web_links/${token} criado`);
  console.log(`\nAbra:`);
  console.log(`  https://primetour.github.io/tarefas/portal-view-tpl.html#${token}`);
  console.log(`\nCanônico fallback:`);
  console.log(`  https://primetour.github.io/tarefas/portal-view.html#${token}`);
  console.log(`\nCleanup:`);
  console.log(`  node smoke-attribute-web-template.cjs --cleanup`);
  console.log(`  + remover doc portal_web_links/${token} via console se quiser`);
  process.exit(0);
})();
