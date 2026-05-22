/**
 * Backfill dev_hours: 4.49.86 → 4.49.90 (sprint 22/05/2026)
 *
 * Sprint focado em UX do Gerador de Roteiros — auditoria pesada do
 * Renê resultou em 4 mudanças estruturais + 1 hotfix.
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

const BUCKETS = {
  trivial: [0.25, 0.5], small: [0.5, 1.5], medium: [1.5, 4],
  large: [4, 8], epic: [8, 16], mega: [16, 80],
};
const MULTIPLIERS = {
  investigation: 0.30, migration: 0.20, pdf: 0.15,
  integration: 0.20, security: 0.25, pure_refactor: -0.20,
};

function calcHumanHours(bucket, multIds = []) {
  const [mn, mx] = BUCKETS[bucket];
  const base = (mn + mx) / 2;
  let factor = 1;
  for (const id of multIds) factor += (MULTIPLIERS[id] || 0);
  return Math.max(0.25, +(base * factor).toFixed(2));
}
function suggestBreakdown(totalHours, profile) {
  const RATIOS = {
    feature:  [0.15, 0.55, 0.15, 0.10, 0.05],
    bugfix:   [0.10, 0.50, 0.25, 0.05, 0.10],
    refactor: [0.15, 0.55, 0.15, 0.10, 0.05],
    security: [0.20, 0.40, 0.20, 0.10, 0.10],
    docs:     [0.05, 0.05, 0.05, 0.80, 0.05],
  };
  const r = RATIOS[profile] || RATIOS.feature;
  const r1 = +(totalHours * r[0]).toFixed(2);
  const r2 = +(totalHours * r[1]).toFixed(2);
  const r3 = +(totalHours * r[2]).toFixed(2);
  const r4 = +(totalHours * r[3]).toFixed(2);
  const r5 = +(totalHours - r1 - r2 - r3 - r4).toFixed(2);
  return { refinamento: r1, desenvolvimento: r2, testes: r3, documentacao: r4, implantacao: r5 };
}

const ENTRIES = [
  {
    releaseVersion: '4.49.86',
    releaseSlug:    '20260522-cliente-briefing-fundidos-schema-real',
    title:          'Roteiros — Briefing absorvido em Cliente (schema cleanup)',
    summary:        'Resposta ao Renê: "pq vc colocou ele [briefing] antes de cliente? não é melhor os dois módulos se fundirem? perfil dos viajantes não conflita com tipo de viagem? interesses não é melhor concentrar em perfil do viajante? pra que separar?". Aprendizado documentado no CLAUDE.md §7 (commit 9fc533f): ANTES de criar feature/seção/campo, VERIFICAR schema existente. Schema (emptyRoteiro): removido bloco briefing{tipoViagem, perfilViajantes, interesses, restricoes, orcamentoFaixa, contextoLivre, querSugestaoDestino} inteiro (~164 linhas). Mantido client.{preferences, restrictions, economicProfile, notes} que sempre existiu. SECTIONS[0] virou "Cliente e Briefing" (label novo), renderBriefingSection() deletada, constantes TIPOS_VIAGEM/ORCAMENTO_FAIXAS removidas. Switch renumerado.',
    profile:        'refactor', bucket: 'medium',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-22T11:00:00-03:00'),
    modules:        ['roteiros'],
  },
  {
    releaseVersion: '4.49.87',
    releaseSlug:    '20260522-roteiros-add-dest-rerender-fix',
    title:          'Roteiros — fix add-dest/move/remove na seção Viagem',
    summary:        'Bug pré-existente detectado durante E2E do v4.49.86 no Chrome MCP: clique em "Adicionar Destino" deixava destCount=0 após o handler. Causa raiz: os 4 handlers (add-dest, remove-dest, move-dest-up, move-dest-down) chamavam switchSection(1), que executa collectFormData() ANTES do re-render — sobrescrevia push/splice/swap in-memory com estado do DOM antigo (sem o destino recém-pushado). Mesma causa do fix v4.49.85 para add-brief-dest/remove-brief-dest. Trocados por rerenderCurrentSection() (re-render sem re-coletar). Validado E2E: add ×3, move-up, remove[0], move-down, preservação de input ao re-renderizar.',
    profile:        'bugfix', bucket: 'small',
    multiplierIds:  ['investigation'],
    completedAt:    new Date('2026-05-22T12:00:00-03:00'),
    modules:        ['roteiros'],
  },
  {
    releaseVersion: '4.49.88',
    releaseSlug:    '20260522-roteiros-viagem-absorvida-em-cliente',
    title:          'Roteiros — Viagem absorvida em Cliente e Briefing',
    summary:        'Resposta ao Renê: "junte a aba Viagem à aba Cliente e Briefing — Viagem só tem 2 campos, dá pra ficar em um lugar só tudo isso". Datas + Destinos + botão IA movidos pra subseção "Datas e Destinos" (h3 com top border) no fim de Cliente e Briefing. renderViagemSection() renomeada pra renderTravelBlock() (helper inline). SECTIONS: 15→14. renderSectionContent switch renumerado (cases 0-13). 30 switchSection(N>=2) decrementados em -1 pra apontar pra nova posição. 2 activeSection===12 → ===11 (Avançado). Help text em Dia a Dia atualizado: "seção Viagem" → "seção Cliente e Briefing". Out-of-scope flagrado (chip spawnado): handlers de export PDF/DOCX/PPTX têm switchSection(10) com comentário stale "// Preview & Export" — pré-existente, separado.',
    profile:        'refactor', bucket: 'medium',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-22T12:30:00-03:00'),
    modules:        ['roteiros'],
  },
  {
    releaseVersion: '4.49.89',
    releaseSlug:    '20260522-roteiros-datalist-contextual-cidades',
    title:          'Roteiros — datalist contextual cidades-por-país (BROKEN)',
    summary:        'Crítica do Renê (auditoria UX): "em destinos vc coloca cidade, depois país — quando clica abre uma lista com cidade de pais toda confusa, sem organização". Datalists separadas: re-country-list global (países únicos, ordenado) + re-city-list-${i} por linha (cidades filtradas pelo país daquela linha). handleEditorChange detecta dataset.dest===country e repopula a datalist da cidade in-place — sem re-render, preserva foco. Ordem invertida: País → Cidade (antes era Cidade → País). RELEASE QUEBROU EM PRODUÇÃO: ver v4.49.90.',
    profile:        'feature', bucket: 'small',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-22T12:50:00-03:00'),
    modules:        ['roteiros'],
  },
  {
    releaseVersion: '4.49.90',
    releaseSlug:    '20260522-roteiros-datalist-fix-template-i',
    title:          'Roteiros — hotfix v89: ${i} em comentário HTML',
    summary:        'Self-inflicted bug: renderTravelBlock continha comentário HTML <!-- ... re-city-list-${i} ... --> DENTRO do template literal. JS interpretou ${i} como template expression. Como `i` só existe no escopo da .map() de renderDestRow (não em renderTravelBlock), throw ReferenceError: i is not defined. Editor renderizava só "Erro ao carregar — i is not defined". Detectado em E2E no MCP. Fix: comentário inteiro removido (datalists do v89 permanecem funcionais). Aprendizado documentado: nunca colocar ${expr} em comentários HTML dentro de template literals.',
    profile:        'bugfix', bucket: 'trivial',
    multiplierIds:  ['investigation'],
    completedAt:    new Date('2026-05-22T13:00:00-03:00'),
    modules:        ['roteiros'],
  },
];

async function upsert(entry) {
  const humanHrs = calcHumanHours(entry.bucket, entry.multiplierIds);
  const adjusted = Math.max(0.1, +(humanHrs * AI_ASSIST).toFixed(2));
  const cost     = +(adjusted * HOURLY_RATE).toFixed(2);
  const breakdown = suggestBreakdown(adjusted, entry.profile);
  const payload = {
    entryType: 'release',
    releaseVersion: entry.releaseVersion, releaseSlug: entry.releaseSlug,
    phaseLabel: null, title: entry.title, summary: entry.summary,
    bucket: entry.bucket, multiplierIds: entry.multiplierIds || [],
    hourlyRate: HOURLY_RATE,
    aiAssistanceMultiplier: AI_ASSIST,
    humanHoursEstimate: humanHrs,
    adjustedHours: adjusted, totalHours: adjusted,
    cost,
    hoursByCategory: breakdown,
    completedAt: entry.completedAt,
    profile: entry.profile, modules: entry.modules || undefined,
    status: 'approved',
    approvedAt: FV.serverTimestamp(),
    approvedBy: { uid: 'system-backfill', name: 'Backfill v4.49.86-90 — sprint roteiros 22/05' },
    rejectedAt: null, rejectedBy: null,
    createdAt: FV.serverTimestamp(), createdBy: 'system-backfill',
    updatedAt: FV.serverTimestamp(), updatedBy: 'system-backfill',
  };
  Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
  const snap = await db.collection(COLLECTION)
    .where('releaseVersion', '==', entry.releaseVersion)
    .where('entryType', '==', 'release').limit(1).get();
  if (!snap.empty) {
    const id = snap.docs[0].id;
    await db.collection(COLLECTION).doc(id).set(payload, { merge: false });
    return { action: 'updated', id, hrs: adjusted, cost };
  }
  const ref = await db.collection(COLLECTION).add(payload);
  return { action: 'created', id: ref.id, hrs: adjusted, cost };
}

(async () => {
  console.log(`\n📦 Backfill dev_hours: ${ENTRIES.length} releases (4.49.86-90)\n`);
  let totalH=0, totalC=0;
  for (const entry of ENTRIES) {
    const r = await upsert(entry);
    console.log(`  ${r.action==='created'?'+':'~'} ${entry.releaseVersion.padEnd(8)} ${String(r.hrs).padStart(6)}h · R$ ${r.cost.toFixed(2).padStart(9)} · ${r.action}`);
    totalH += r.hrs; totalC += r.cost;
  }
  console.log(`\n  ─────────────────────────────────────`);
  console.log(`  Total adicionado: ${totalH.toFixed(2)}h · R$ ${totalC.toFixed(2)}\n`);
  process.exit(0);
})();
