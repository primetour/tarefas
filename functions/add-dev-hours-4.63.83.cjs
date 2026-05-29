const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.83',
    releaseSlug: '20260529-cotacoes-html-universal-photo-cover',
    title: 'Cotações: template HTML universal + capa com foto legível + sem títulos órfãos',
    summary: 'Padronização do template default de cotações após Renê testar a extração de TODAS as ' +
             'áreas cadastradas: "títulos no meio do texto, sistema ignorando padrões e colocando texto ' +
             'sem formatação, capa com foto no fundo dificultando a leitura do título... padronizar pra ' +
             'ter mínimo de qualidade de entrega". Decisões dele: motor=Template HTML pra todas as áreas; ' +
             'capa=Foto do destino + véu escuro forte. (1) HTML universal: novo helper ' +
             'fetchDefaultCotacoesTemplate em templates.js resolve dinamicamente o doc isDefault global ' +
             'cotações/html quando a área não tem templateRefs.cotacoes.html; roteiroGenerator usa esse ' +
             'fallback antes de cair pro jsPDF legado (jsPDF vira só fallback em erro de render, mantém ' +
             'safety-net + toast.warning + audit templates.fallback). (2) Capa com foto + scrim duplo ' +
             '(gradiente preto rgba 0.74→0.50→0.80 + cor secundária) + text-shadow → título/logo/datas ' +
             'sempre legíveis; heroUrl→coverImageUrl via templateAdapter + _buildAdapterOpts. (3) CSS do ' +
             'template: section-title-bar break-inside/after:avoid (sem título órfão) + table.gdt thead ' +
             'display:table-header-group (cabeçalho repete por página) + tbody tr break-inside:avoid. ' +
             '(4) SSRF allowlist da CF renderTemplate (functions/index.js): +5 CDNs públicas de imagem ' +
             '(images.unsplash.com, worker primetour-images, upload.wikimedia.org, lh3.googleusercontent, ' +
             'storage.googleapis) — antes a foto da capa era bloqueada server-side e caía pra cor sólida. ' +
             'Validação: render local determinístico (puppeteer-core + Chrome for Testing, opções EXATAS ' +
             'do page.pdf da CF) com dados adversariais (12 dias, 8 voos, 8 hotéis, capa Unsplash ' +
             'brilhante). 9 páginas rasterizadas e inspecionadas: capa legível, zero título órfão, thead ' +
             'repete, fechamento contido. Template re-seedado (R2 + Firestore aziKOrLrxLqexqEVauZZ ' +
             'isDefault, antigo arquivado). CF renderTemplate deployada.',
    bucket: 'small', multiplierIds: ['investigation', 'pdf', 'security', 'integration'], profile: 'feature',
    hoursByCategory: { refinamento: 0.25, desenvolvimento: 0.7, testes: 0.45, documentacao: 0.15, implantacao: 0.2 },
    module: 'roteiros', modules: ['roteiros'],
  },
];

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({ investigation: .3, migration: .2, pdf: .15, integration: .2, security: .25, pure_refactor: -.2 }[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}

(async () => {
  for (const ENTRY of ENTRIES) {
    const ex = await db.collection('dev_hours').where('releaseVersion', '==', ENTRY.releaseVersion).limit(1).get();
    if (!ex.empty) { console.log(`= skip ${ENTRY.releaseVersion}`); continue; }
    const h = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
    const now = FV.serverTimestamp();
    const doc = { entryType: 'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE,
      totalHours: Math.round(h * 100) / 100, totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
      status: 'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
    const ref = await db.collection('dev_hours').add(doc);
    console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  }
  process.exit(0);
})();
