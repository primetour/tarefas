const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

(async () => {
  const entry = {
    entryType: 'release',
    releaseVersion: '4.63.48',
    releaseSlug: '20260528-portal-dicas-richtext-mapa-tags',
    title: 'Sprint Portal de Dicas — rich text, mapa interativo, tags, hero auto + 3 auditorias',
    summary: [
      '16 releases (v4.63.33 → v4.63.48) sobre Portal de Dicas em ~3 dias.',
      '',
      'FEATURES novas:',
      '• Rich text leve (markdown B/I/U/link/anchor) — novo richText.js com parseRich/richToHtml/richToPlain. XSS protection em 3 camadas (parser + templateAdapter + portal-view.html). 14 testes Node adversariais (javascript:/data:/vbscript:/file: blocked, email com underscore preservado).',
      '• Subtítulos livres entre itens — type="subtitle" no segments[].items[]. Renderer em DOCX/PDF/PPTX/web.',
      '• Âncoras internas — linkar segmento da própria dica via [texto](#segment-key). Smooth scroll handler em portal-view.html.',
      '• Tags por item — vocabulário fixo (35+ DEFAULT_TIP_TAGS) + custom via portal_tip_tags. Chips UI no editor + autocomplete + addTipTag.',
      '• Mapa interativo (Leaflet + markercluster + Nominatim) — pins ouro nas cidades com dica. Cache _geo em portal_destinations. Real-time onSnapshot. Pré-popular 19/20 destinos via Admin SDK script.',
      '• Cor accent configurável por área (3ª cor: primary/secondary/accent).',
      '• Reordenar segmentos antes do export (▲▼).',
      '• Mover item entre segmentos (⇄).',
      '• Hero auto via heroTasks (gallery primeira foto).',
      '• Auto-photos PDF (enrichGalleryWithAutoPhotos antes do switch — antes só web).',
      '',
      'HOTFIXES:',
      '• Bug crianças misclassified (segment routing).',
      '• Fallback Unsplash não trazia fotos no PDF (fetchImgData proxy decision).',
      '• Subtitle filtered out before render em portal-view.html renderPlaces.',
      '• XSS via href não escaped em templateAdapter._toHtml.',
      '• prompt() native → openExternalLinkModal (CLAUDE.md §11.k).',
      '• Anchor modal listava segmento atual + subtítulos vazios.',
      '• Markdown leakage em card preview (richToPlain).',
      '• PPTX subtitle safety (indexedNoSubs filter).',
      '• Z-index modal manual (baseZ 1000 → 3000).',
      '• snap.exists bug (function, não property) em portal.js × 3 places.',
      '• CSS var(--brand-gold)10 inválido → rgba(212,168,67,0.10).',
      '• Permission rule pra _geo update por qualquer auth user (cache benigno).',
      '',
      'PERF mapa (3x mais rápido):',
      '• fetchTipsAggregated: N getDoc sequenciais → Promise.all (4s → 250ms).',
      '• loadLeaflet() + fetchTipsAggregated() em paralelo (era serial).',
      '• refresh(): geocode paralelo + addLayers batch.',
      '',
      'UX/IDENTIDADE:',
      '• Logos das áreas no estágio 1 (não nome) usando logoUrlAlt (versão colorida pra fundo claro). 6 áreas com logoUrl/logoUrlAlt, 1 sem (ATravel).',
      '• 4 blocos dos passos com border-top dourado 3px + chip número dourado + shadow sutil.',
      '• Fix z-index do mapa cobrindo dropdowns header (isolation:isolate).',
      '• Novos labels: "Escolha a área", "Selecione o destino", "Confira no mapa…".',
      '',
      'AUDITORIAS (3 ciclos):',
      '• Agent E2E pós-v4.63.41 → 10 achados HIGH, fix v4.63.42-43.',
      '• Manual Node parser → B1 (XSS bypass) + B2 (email underscore) fixes.',
      '• Smoke test Admin SDK pós-v4.63.46 → confirmação 20 dicas / 20 destinos / 6 áreas com logo.',
      '',
      'PATRIMÔNIO (scripts no repo):',
      '• functions/smoke-test-v4-63-46.cjs',
      '• functions/prefill-geo-cache.cjs (Nominatim 1/s)',
      '• functions/inspect-area-logos.cjs',
    ].join('\n'),
    bucket: 'large',  // 8-16h base
    multiplierIds: ['investigation', 'security'],  // auditorias + XSS lockdown
    profile: 'feature',
    aiAssistanceMultiplier: 0.50,
    module: 'portal',
    modules: ['portal'],  // CLAUDE.md §12.m: PLURAL array
    hoursByCategory: {
      refinamento:    1.0,  // briefings + audit decisions
      desenvolvimento: 7.0,  // 16 releases, ~3 dias
      testes:          2.5,  // 3 ciclos audit + Node tests + smoke
      documentacao:    1.0,  // CHANGELOG + CLAUDE.md §16
      implantacao:     0.5,  // deploy GH Pages + Firestore rules
    },
    status: 'approved',
    hourlyRate: 150,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: 'system',
    occurredAt: admin.firestore.Timestamp.fromDate(new Date('2026-05-28T18:00:00-03:00')),
  };

  const ref = await db.collection('dev_hours').add(entry);
  console.log(`✓ dev_hours entry criada: ${ref.id}`);
  console.log(`  ${entry.title}`);
  console.log(`  modules: ${JSON.stringify(entry.modules)}  bucket: ${entry.bucket}`);
  console.log(`  hours: ${Object.values(entry.hoursByCategory).reduce((s,v)=>s+v,0)}h total (com AI mult 0.5)`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
