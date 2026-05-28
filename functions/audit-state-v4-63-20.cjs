// Auditoria de estado pós-sessão v4.63.12-20: confere templates seed,
// dev_hours, audit_logs, áreas com refs ativos.
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  console.log('=== AUDITORIA DE ESTADO v4.63.20 ===\n');

  // 1) Templates globais default por módulo
  console.log('## 1) TEMPLATES GLOBAIS DEFAULT POR MÓDULO');
  for (const mod of ['cotacoes', 'portal', 'banco-roteiros']) {
    const snap = await db.collection('templates')
      .where('ownerType', '==', 'global')
      .where('module', '==', mod)
      .where('format', '==', 'html')
      .get();
    const def = snap.docs.filter(d => d.data().isDefault === true);
    const nonDef = snap.docs.filter(d => d.data().isDefault !== true);
    console.log(`  ${mod}: ${snap.size} HTML global (default: ${def.length}, archived/legado: ${nonDef.length})`);
    def.forEach(d => {
      const td = d.data();
      console.log(`    ★ ${d.id} | "${td.name}" | status=${td.status} | placeholders=${(td.placeholders || []).length}`);
    });
    if (def.length > 1) console.log(`    ⚠ ${def.length} defaults simultâneos! Deveria ser 1.`);
    if (def.length === 0) console.log(`    ⚠ Nenhum default — generators caem pro fallback sempre.`);
  }

  // 2) Templates fallback + render audit logs (sem orderBy pra evitar composite index)
  console.log('\n## 2) AUDIT_LOGS templates.fallback (limit 10, sem orderBy)');
  const fallbackSnap = await db.collection('audit_logs')
    .where('action', '==', 'templates.fallback')
    .limit(10).get();
  console.log(`  Total: ${fallbackSnap.size}`);
  fallbackSnap.docs.forEach(d => {
    const data = d.data();
    console.log(`    ${data.details?.module}/${data.details?.format} tplId=${data.details?.templateId?.slice(0,10)}…`);
  });

  console.log('\n## 3) AUDIT_LOGS templates.render (limit 10, via field check)');
  const renderSnap = await db.collection('audit_logs')
    .where('action', '==', 'templates.render')
    .limit(10).get();
  console.log(`  Total: ${renderSnap.size}`);
  let missingVia = 0;
  renderSnap.docs.forEach(d => {
    const data = d.data();
    if (!data.details?.via) missingVia++;
    console.log(`    fmt=${data.details?.format} size=${data.details?.sizeBytes}B via=${data.details?.via || 'MISSING'} tplId=${d.data().entityId?.slice(0,10) || '?'}…`);
  });
  if (missingVia) console.log(`  ⚠ ${missingVia} logs SEM via field — pode ser antes v4.63.16`);

  // 4) Áreas com templateRefs configurados
  console.log('\n## 4) ÁREAS COM templateRefs CONFIGURADOS');
  const areasSnap = await db.collection('portal_areas').get();
  let withRefs = 0;
  areasSnap.docs.forEach(d => {
    const data = d.data();
    const refs = data.templateRefs || {};
    const moduleCount = Object.keys(refs).filter(k => refs[k] && Object.keys(refs[k]).length).length;
    if (moduleCount > 0) {
      withRefs++;
      const summary = Object.entries(refs).map(([m, fmts]) => `${m}=${Object.keys(fmts || {}).length}fmts`).join(' ');
      console.log(`    ${d.id} (${data.name}): ${summary}`);
    }
  });
  if (!withRefs) console.log(`    Nenhuma área com refs ainda — esperado (templates seedados, ainda sem atribuição em produção)`);

  // 5) Module devHours.templates entries
  console.log('\n## 5) dev_hours COM modules:templates');
  const dhSnap = await db.collection('dev_hours')
    .where('modules', 'array-contains', 'templates')
    .get();
  let totalHours = 0;
  let totalCost = 0;
  dhSnap.docs.forEach(d => {
    totalHours += d.data().totalHours || 0;
    totalCost += d.data().totalCost || 0;
  });
  console.log(`  Total docs: ${dhSnap.size}`);
  console.log(`  Total hours: ${totalHours.toFixed(2)}h`);
  console.log(`  Total cost: R$ ${totalCost.toFixed(2)}`);

  // 6) Releases v4.63.12-20 logados?
  console.log('\n## 6) RELEASES v4.63.12-20 LOGADAS EM dev_hours');
  const versions = ['4.63.12', '4.63.13', '4.63.14', '4.63.15', '4.63.16', '4.63.17', '4.63.19', '4.63.20'];
  for (const v of versions) {
    const s = await db.collection('dev_hours').where('releaseVersion', '==', v).limit(1).get();
    if (s.empty) {
      console.log(`    ⚠ ${v}: MISSING`);
    } else {
      const d = s.docs[0].data();
      console.log(`    ✓ ${v}: ${d.totalHours}h R$${d.totalCost} | "${d.title?.slice(0,50)}"`);
    }
  }

  // 7) Detecção de orphan templates (sem ref + sem usage recente)
  console.log('\n## 7) ORPHAN templates (não default, sem refs ativos, archivados ou velhos)');
  const allTplSnap = await db.collection('templates').get();
  const allTpls = allTplSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const refsSet = new Set();
  areasSnap.docs.forEach(d => {
    const refs = d.data().templateRefs || {};
    Object.values(refs).forEach(modMap => Object.values(modMap || {}).forEach(id => id && refsSet.add(id)));
  });
  const orphan = allTpls.filter(t => !t.isDefault && !refsSet.has(t.id) && t.status === 'active');
  console.log(`  Total templates: ${allTpls.length}`);
  console.log(`  Em uso (refs ou default): ${refsSet.size + allTpls.filter(t => t.isDefault).length}`);
  console.log(`  Orphan/test (active, sem ref): ${orphan.length}`);
  orphan.slice(0, 5).forEach(t => console.log(`    ? ${t.id} (${t.module}/${t.format}) "${(t.name || '').slice(0,40)}"`));

  process.exit(0);
})();
