/**
 * Backfill dev_hours: 4.49.105 → 4.50.0 (sprint 22/05/2026 - tarde/noite)
 *
 * Sprint marathon do dia 22/05 que cobriu:
 *  - 4.49.105: Unicode icons → SVG em 6 pages (consistência visual)
 *  - 4.49.106: Defesa back sem confirm em roteiro vazio
 *  - 4.49.107: Fix IA truncamento (bump max_tokens 8k → 16k)
 *  - 4.49.108: Chunking IA + prompt caching pra roteiros 20+ dias
 *  - 4.49.109: Fila assíncrona Cloud Function (30 simultâneos)
 *  - 4.50.0:  Banco de Roteiros (MÓDULO NOVO — curadoria + import PDF Claude)
 *
 * Idempotente: usa releaseVersion como chave única.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const HOURLY_RATE = 150;
const AI_ASSIST   = 0.50;
const COLLECTION  = 'dev_hours';
const RENE_UID    = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRIES = [
  {
    releaseVersion: '4.49.105',
    releaseSlug: '20260522-svg-icons-6-pages',
    title: 'Anti-padrão: ícones unicode → SVG em 6 pages',
    summary: 'Replicou padrão de SVG inline 14-16px stroke-width 1.75 (Heroicons) ' +
             'em 6 pages: taskTypes, team, checkin, portalImages, newsMonitor, ' +
             'contentConfig. Tooltips via data-tip. Resolveu inconsistência visual ' +
             '(chars unicode dependem da fonte do SO + tamanho pequeno). uiKit.js ' +
             'ganhou helper actionIcon(name) exportando SVG strings padronizados.',
    bucket: 'small',
    multiplierIds: ['pure_refactor'],
    profile: 'feature',
    aiAssistanceMultiplier: AI_ASSIST,
    hoursByCategory: {
      refinamento: 0.15, desenvolvimento: 1.0, testes: 0.3, documentacao: 0.05, implantacao: 0.1,
    },
    status: 'approved',
    module: 'system-wide',
  },
  {
    releaseVersion: '4.49.106',
    releaseSlug: '20260522-defesa-back-vazio',
    title: 'Defesa: back sem confirm em roteiro novo vazio',
    summary: 'Roteiro novo realmente vazio (sem briefing, sem cliente, sem nada) ' +
             'voltar pra home não dispara mais confirm() — só pede confirmação se ' +
             'o user efetivamente digitou algo. Resolve looping reportado pelo Renê.',
    bucket: 'trivial',
    multiplierIds: [],
    profile: 'bugfix',
    aiAssistanceMultiplier: AI_ASSIST,
    hoursByCategory: {
      refinamento: 0.05, desenvolvimento: 0.25, testes: 0.1, documentacao: 0.0, implantacao: 0.05,
    },
    status: 'approved',
    module: 'roteiros',
  },
  {
    releaseVersion: '4.49.107',
    releaseSlug: '20260522-fix-ia-truncamento-max-tokens',
    title: 'Fix IA truncamento: bump max_tokens 8k → 16k + error msg',
    summary: 'Bug crítico: agente roteiros-luxo-gen tava com maxTokensPerRun=8000, ' +
             'roteiros ricos truncavam JSON no meio. Bump pra 16000 via Admin SDK ' +
             'script. Error detection melhorada (stopReason="max_tokens" OR rawLen>14k ' +
             '+ SyntaxError → mostra mensagem clara). Renê reportou: "demorou 154sec e deu erro".',
    bucket: 'small',
    multiplierIds: ['investigation'],
    profile: 'bugfix',
    aiAssistanceMultiplier: AI_ASSIST,
    hoursByCategory: {
      refinamento: 0.2, desenvolvimento: 0.4, testes: 0.3, documentacao: 0.1, implantacao: 0.1,
    },
    status: 'approved',
    module: 'roteiros',
  },
  {
    releaseVersion: '4.49.108',
    releaseSlug: '20260522-chunking-ia-20-dias-prompt-caching',
    title: 'Chunking IA + prompt caching pra roteiros 20+ dias',
    summary: 'Roteiros >14 dias OU >5 destinos passam a gerar em FASES: ' +
             'Fase 1 skeleton (sem days), Fases 2+ days em chunks de 10. ' +
             'Aproveita prompt caching ephemeral do system prompt (~60% economia ' +
             'input). Métricas agregadas cross-fases (inputTokens, cacheRead, etc). ' +
             'Progress overlay com phase label dinâmica. Custo 20 dias ~$0.36 (vs ~$0.27 ' +
             'single-shot uncached) mas com garantia de não truncar.',
    bucket: 'medium',
    multiplierIds: ['integration'],
    profile: 'feature',
    aiAssistanceMultiplier: AI_ASSIST,
    hoursByCategory: {
      refinamento: 0.5, desenvolvimento: 2.5, testes: 0.5, documentacao: 0.3, implantacao: 0.2,
    },
    status: 'approved',
    module: 'roteiros',
  },
  {
    releaseVersion: '4.49.109',
    releaseSlug: '20260522-fila-assincrona-cloud-function',
    title: 'Fila assíncrona Cloud Function — 30+ simultâneos sem rate-limit',
    summary: 'Renê: "vai aguentar 30 usuarios simultaneos ou a API vai parar?". ' +
             'Resposta: fila Firestore + Cloud Function background worker. Client cria ' +
             'doc em `roteiro_generations_queue`, escuta via onSnapshot. CF ' +
             '`processRoteiroQueue` (onDocumentCreated, maxInstances=5, concurrency=1) ' +
             'claima via transaction (lease pattern queued→processing), processa chunking ' +
             'server-side, grava resultado. Capacidade ~100 gerações/min steady. ' +
             'Anthropic Tier 1 (50 req/min) sobra. Firestore rules: queue create+read ' +
             'pelo dono, update FALSE (só Admin SDK). E2E testado: 3 dias Paris em 99s ' +
             'com 4 buscas Virtuoso/Amex/LHW.',
    bucket: 'medium',
    multiplierIds: ['integration', 'security'],
    profile: 'feature',
    aiAssistanceMultiplier: AI_ASSIST,
    hoursByCategory: {
      refinamento: 0.6, desenvolvimento: 3.0, testes: 0.7, documentacao: 0.4, implantacao: 0.3,
    },
    status: 'approved',
    module: 'roteiros',
  },
  {
    releaseVersion: '4.50.0',
    releaseSlug: '20260522-banco-roteiros-curadoria',
    title: 'Banco de Roteiros — módulo NOVO de curadoria + import PDF via Claude',
    summary: 'MÓDULO NOVO. Sidebar item próprio (#banco-roteiros). Collection ' +
             'roteiros_bank com schema completo de 14 seções (capa, geo, days, ' +
             'categorias hospedagem+pricing, includes buckets, pagamento, cancelamento ' +
             'escalado, docs+vistos por país, validade). Cloud Function ' +
             'importRoteiroBankPdf usa Claude Sonnet 4.5 MULTIMODAL (content block ' +
             'document) pra parsear PDFs estilo Classic Collection. Auto-vincula a ' +
             'portal_destinations. Editor com auto-save 5s. Seed inicial dos 2 PDFs ' +
             'do Renê (China/Tibete: 4 cidades 3 cats 11d; Peru: 6 cidades 2 cats 11d). ' +
             'Foundation pra IA futura usar como base de conhecimento.',
    bucket: 'large',
    multiplierIds: ['integration', 'pdf', 'investigation'],
    profile: 'feature',
    aiAssistanceMultiplier: AI_ASSIST,
    hoursByCategory: {
      refinamento: 1.2, desenvolvimento: 6.5, testes: 0.8, documentacao: 0.5, implantacao: 0.5,
    },
    status: 'approved',
    module: 'banco-roteiros',
  },
];

function computeHours(buckets, multIds, aiAssist) {
  const total = Object.values(buckets).reduce((a, b) => a + b, 0);
  const mults = (multIds || []).map(id => ({
    investigation: 0.30, migration: 0.20, pdf: 0.15,
    integration: 0.20, security: 0.25, pure_refactor: -0.20,
  })[id] || 0).reduce((a, b) => a + b, 0);
  return total * (1 + mults) * aiAssist;
}

(async () => {
  for (const e of ENTRIES) {
    const exists = await db.collection(COLLECTION).where('releaseVersion','==',e.releaseVersion).limit(1).get();
    if (!exists.empty) {
      console.log(`= skip ${e.releaseVersion} (already exists ${exists.docs[0].id})`);
      continue;
    }
    const finalHours = computeHours(e.hoursByCategory, e.multiplierIds, e.aiAssistanceMultiplier);
    const doc = {
      entryType: 'release',
      ...e,
      hourlyRate: HOURLY_RATE,
      finalHours: Math.round(finalHours * 100) / 100,
      finalCost: Math.round(finalHours * HOURLY_RATE * 100) / 100,
      createdAt: FV.serverTimestamp(),
      createdBy: RENE_UID,
      updatedAt: FV.serverTimestamp(),
    };
    const ref = await db.collection(COLLECTION).add(doc);
    console.log(`+ added ${e.releaseVersion} (${doc.finalHours}h R$${doc.finalCost}) → ${ref.id}`);
  }
  console.log('done.');
  process.exit(0);
})();
