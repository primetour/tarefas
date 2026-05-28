const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.63.9',
    releaseSlug: '20260528-templates-duplicate-cf-ui',
    title: 'Duplicação de template entre areas (sprint 10/11)',
    summary: 'Permite duplicar template criado pra Lazer pra BTG Partners ou Global com 1 click. ' +
             'Arquivo R2 copiado pra novo path (não compartilha — Renê 28/05). CF duplicateTemplate ' +
             '512MB 60s: valida source + targetOwnerType + targetOwnerId, _checkTemplatesPermission, ' +
             'rejeita mesmo owner, baixa R2 original + upload novo path templates/{module}/{newId}. ' +
             'Cria doc com duplicatedFrom, placeholders copiados (sem re-extrair), fileSha256 mesmo, ' +
             'audit templates.duplicate. Helper client duplicateTemplate. UI: botao ⎘ Duplicar no ' +
             'card gated, modal com novo nome opcional + select area destino (exclui owner atual, ' +
             'permite global se nao-global) + toggle marcar default. Esc/X/clique fora pra fechar. ' +
             'E2E validado 3s: template Lazer duplicado pra BTG, R2 file acessivel curl 200 com ' +
             'mesmo conteudo, doc Firestore com duplicatedFrom rastreável, placeholders preservados.',
    bucket: 'small', multiplierIds: ['integration'], profile: 'feature',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.5, testes: 0.3, documentacao: 0.3, implantacao: 0.2 },
    module: 'portal', modules: ['portal', 'roteiros', 'banco-roteiros'],
  },
  {
    releaseVersion: '4.63.10',
    releaseSlug: '20260528-templates-area-refs-tab',
    title: 'Tab Templates no editor de areas (sprint 11/11)',
    summary: 'Nova tab 📐 Templates no modal de edicao de area ao lado de Exports. Pane renderiza ' +
             'grid de 3 modulos (cotacoes/portal/banco-roteiros) com select por formato compativel ' +
             '(HTML/DOCX/PPTX filtrados por SUPPORTED_FMTS_TPL). Filtro visibilidade: templates ' +
             'global aparecem pra todas + templates area so pra area dona. Opcao default vazia ' +
             'preserva comportamento atual. Etiquetas 🌐 global · ★ default nos labels. Carregado ' +
             'async via Promise sem bloquear modal. saveArea payload ganha campo templateRefs ' +
             '(null quando vazio), persiste em portal_areas + business_units (mirror v4.62.49). ' +
             'Decisao consciente: integracao nos generators fica pra v4.63.11 (ultima sprint). ' +
             'v4.63.10 só salva ref no doc, generators ignoram. Permite Rene configurar tudo ' +
             'antes da ativacao sem risco de exports quebrarem.',
    bucket: 'small', multiplierIds: ['integration'], profile: 'feature',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.2, testes: 0.2, documentacao: 0.3, implantacao: 0.1 },
    module: 'portal', modules: ['portal', 'roteiros', 'banco-roteiros'],
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
    const doc = {
      entryType: 'release', ...ENTRY,
      aiAssistanceMultiplier: AI_ASSIST,
      hourlyRate: HOURLY_RATE,
      totalHours: Math.round(h * 100) / 100,
      totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
      status: 'approved',
      completedAt: now, createdAt: now,
      createdBy: RENE_UID, updatedAt: now,
    };
    const ref = await db.collection('dev_hours').add(doc);
    console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  }
  process.exit(0);
})();
