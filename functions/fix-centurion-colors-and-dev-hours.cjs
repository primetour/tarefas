/**
 * v4.63.33 — Hotfix area Centurion + dev_hours entries v4.63.32-33.
 *
 * Centurion estava configurada com `colors.secondary = #ffffff` (branco),
 * o que quebrou TODO o PDF (capa branca, títulos invisíveis sobre branco).
 * Mudamos pra navy escuro (#0F172A slate-900) que é a leitura natural
 * dos generators jsPDF.
 *
 * Accent: mudamos default automático (#000000 do backfill) pra bronze
 * sóbrio (#9F7E2C) que combina com luxury Centurion sem virar PRIMETOUR gold.
 */
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

(async () => {
  // 1. Fix Centurion colors
  console.log('\n[fix-centurion] Atualizando colors da Centurion...');
  const cent = db.collection('portal_areas').doc('centurion');
  const before = (await cent.get()).data();
  console.log('  Antes:', JSON.stringify(before.colors));
  await cent.update({
    'colors.secondary': '#0F172A',  // slate-900 navy (era #ffffff — root cause dos PDFs broken)
    'colors.accent':    '#9F7E2C',  // bronze sóbrio (era #000000 — vibe luxury sem ofuscar)
    updatedAt: FV.serverTimestamp(),
  });
  const after = (await cent.get()).data();
  console.log('  Depois:', JSON.stringify(after.colors));

  // 2. Audit log
  await db.collection('audit_logs').add({
    action: 'area.colors_hotfix',
    severity: 'info',
    targetType: 'portal_area',
    targetId: 'centurion',
    actorId: 'system',
    actorName: 'Hotfix script v4.63.33',
    before: before.colors,
    after: after.colors,
    reason: 'secondary era #ffffff (quebrava PDFs com capa branca + títulos invisíveis); accent default era #000000 (do backfill); ajustado pra paleta luxury coerente',
    timestamp: FV.serverTimestamp(),
  });

  // 3. dev_hours v4.63.32 (luma fix)
  console.log('\n[dev-hours] Criando entry v4.63.32 (luma fix)...');
  await db.collection('dev_hours').add({
    entryType: 'release',
    releaseVersion: '4.63.32',
    releaseSlug: '20260528-portal-pdf-centurion-luma-fix',
    title: 'Hotfix Portal PDF — luma threshold defensive (Centurion #ffffff)',
    summary: 'Bug crítico: PDFs Portal de Dicas saíam com capa em branco + todos os títulos de seção (BAIRROS), bairro (BROOKLYN HEIGHTS, etc.) e labels (Representação Brasileira/Nome/Endereço) invisíveis. Causa raiz: Centurion area configurou colors.secondary=#ffffff. Sistema jsPDF assumia secondary=navy escuro (cor de tinta sobre fundo branco + cor de fundo da capa sobre logo branca). Branco quebrava ambas. Fix defensivo: helper _luma(hex) força navy #0A1628 se luma > 0.85.',
    bucket: 'small',
    multiplierIds: ['legacy-debt', 'cross-module'],
    profile: 'bugfix',
    module: 'portal',
    modules: ['portal'],
    aiAssistanceMultiplier: 0.50,
    hoursByCategory: { refinamento: 0.15, desenvolvimento: 0.30, testes: 0.15, documentacao: 0.10, implantacao: 0.10 },
    status: 'approved',
    hourlyRate: 150,
    createdAt: FV.serverTimestamp(),
    updatedAt: FV.serverTimestamp(),
  });

  // 4. dev_hours v4.63.33 (accent configurável)
  console.log('[dev-hours] Criando entry v4.63.33 (accent configurable)...');
  await db.collection('dev_hours').add({
    entryType: 'release',
    releaseVersion: '4.63.33',
    releaseSlug: '20260528-colors-accent-configuravel',
    title: 'Templates — Cor de destaque (accent) configurável por área',
    summary: 'Schema portal_areas.colors.accent (3ª cor). Antes templates HTML hardcodavam #D4A843 (gold PRIMETOUR). Agora cada área configura. UI Marca tab ganha 3º color picker + hint. Adapter exporta corAccent em portal/roteiros/banco. Generators (PDF/DOCX/PPTX) usam accent na var legada `gold`. 5 templates seed atualizados pra interpolar {{area.corAccent}}. Backfill 7 áreas com accent=primary (compat retroativa). Hotfix Centurion mudou secondary de #ffffff pra navy #0F172A + accent pra bronze #9F7E2C.',
    bucket: 'medium',
    multiplierIds: ['cross-module', 'schema-change'],
    profile: 'feature',
    module: 'portal',
    modules: ['portal', 'roteiros', 'banco-roteiros'],
    aiAssistanceMultiplier: 0.50,
    hoursByCategory: { refinamento: 0.40, desenvolvimento: 1.20, testes: 0.30, documentacao: 0.30, implantacao: 0.20 },
    status: 'approved',
    hourlyRate: 150,
    createdAt: FV.serverTimestamp(),
    updatedAt: FV.serverTimestamp(),
  });

  console.log('\n✓ Done.\n');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
