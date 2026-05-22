/**
 * Backfill dev_hours: 4.49.99 → 4.49.103 (sprint 22/05/2026 — continuação UX).
 *
 * Idempotente. Field names alinhados ao service devHours.js (totalCost,
 * humanEquivalentHours, totalHours — NÃO usar 'cost' nem 'humanHoursEstimate').
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
    releaseVersion: '4.49.99',
    releaseSlug:    '20260522-roteiros-periodo-custom-inline',
    title:          'Roteiros — Período custom vira inputs inline (sem popup)',
    summary:        'Renê: "tem que clicar 2x pra sair do popup do botão período... o padrão não é popup... é campo pra preencher sem sair da página". Modal removido do uiKit. Quando periodKey === custom, inputs date inline aparecem embaixo dos pills (card gold leve). Mudança em qualquer input dispara auto-aplicar sem botão "Aplicar". Validação from ≤ to com feedback vermelho 800ms. Outro pill = sai do custom. Helper openDateRangePicker removido, toIsoDate exportado.',
    profile:        'feature', bucket: 'small',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-22T17:30:00-03:00'),
    modules:        ['roteiros'],
  },
  {
    releaseVersion: '4.49.100',
    releaseSlug:    '20260522-roteiros-export-unificado-preview-tab',
    title:          'Roteiros — unificar conceito de export (só na aba Preview & Export)',
    summary:        'Renê: "conceito de exportar pdf ainda está sujo na UI. tem botão na parte superior, mas tem aba mais completa de export, com múltiplos formatos. vamos manter apenas na aba e, como acesso rápido, na coluna ações da home, a gente leva o user pra aba preview & export". Header do editor: removido "Exportar PDF" (só Salvar fica). Listing ícone: data-action="export-pdf" → "goto-export". Tooltip atualizada. Hash inclui &section=preview. Editor.init lê section=preview e dispara switchSection(12) via queueMicrotask.',
    profile:        'refactor', bucket: 'small',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-22T17:50:00-03:00'),
    modules:        ['roteiros'],
  },
  {
    releaseVersion: '4.49.101',
    releaseSlug:    '20260522-roteiros-valores-categorias-supplier',
    title:          'Roteiros — Valores por categoria (5 blocos, supplier, visibility)',
    summary:        'Renê pediu refator completo: "separar valor por serviço (Aéreo/Hotéis/Traslados/Experiências/Serviços adicionais), N itens por categoria, fornecedor por item, consultor escolhe total ou subtotais visíveis ao cliente". Schema novo pricing.services com 5 arrays + displayMode + notesGeral. Item: description, supplier, supplierVisibleToClient, value, notes, visibleToClient. Migration on-read defensiva. UI: 5 blocos (tabela com fornecedor + chk visible cliente), botão +Adicionar por categoria, subtotal gold no header com contador "N/M visíveis", toggle pill-radio "Como o cliente vê", footer com 2 totais (interno x visível) + hint dinâmica. Handlers add-svc/remove-svc.',
    profile:        'feature', bucket: 'medium',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-22T18:20:00-03:00'),
    modules:        ['roteiros'],
  },
  {
    releaseVersion: '4.49.102',
    releaseSlug:    '20260522-roteiros-valores-realtime-exports',
    title:          'Roteiros — Valores real-time + 4 exports respeitando schema',
    summary:        'Renê: "faça atualizar em tempo real e siga para os próximos". (1) recalcValoresTotals() em handleEditorChange recalcula subtotais por categoria + footer (interno x visível) + hint sem rerender — preserva foco do input que consultor edita. (2) Helpers _hasPricingContent + _buildServicesRows respeitam displayMode + visibleToClient. Aplicado em PDF (buildPricingSection), PPTX (slide Pricing), DOCX (Valores block), Web link (pricing-table nova com subtotais + total dourado responsive). Fallback legado em todos. supplier e notes (internos) NUNCA aparecem em export.',
    profile:        'feature', bucket: 'medium',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-22T18:50:00-03:00'),
    modules:        ['roteiros'],
  },
  {
    releaseVersion: '4.49.103',
    releaseSlug:    '20260522-roteiros-autosave-5s-status-workflow',
    title:          'Roteiros — auto-save 5s + status workflow funcional',
    summary:        'Renê: "os estágios rascunho/em revisão/enviado/aprovado/arquivado estão sem função, precisa organizar isso. E mais: roteiro tem de ser salvo automaticamente como rascunho a cada X sec, pra não corrermos o risco do consultor reclamar que algum problema fez ele perder o trabalho". (1) markDirty debounce 30s→5s. handleSave aceita {silent} pra não disparar toast. Retry em erro a cada 10s (5x). Indicador atualiza dinamicamente "Salvo há X seg/min". saveInProgress evita race condition. (2) Status workflow: dropdown no header substitui span estático. 5 status com cores. handleStatusChange salva pending, transita via updateRoteiroStatus (audit log), re-render in-place. Approved triggera maybeOfferTaskGen (Sprint 4). Click-outside fecha menu. Validado E2E: persistência Firestore + auto-save gravando dados + click-outside.',
    profile:        'feature', bucket: 'medium',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-22T19:30:00-03:00'),
    modules:        ['roteiros'],
  },
];

async function upsert(entry) {
  const humanHrs = calcHumanHours(entry.bucket, entry.multiplierIds);
  const adjusted = Math.max(0.1, +(humanHrs * AI_ASSIST).toFixed(2));
  const totalCost = +(adjusted * HOURLY_RATE).toFixed(2);
  const breakdown = suggestBreakdown(adjusted, entry.profile);
  const payload = {
    entryType: 'release',
    releaseVersion: entry.releaseVersion, releaseSlug: entry.releaseSlug,
    phaseLabel: null, title: entry.title, summary: entry.summary,
    bucket: entry.bucket, multiplierIds: entry.multiplierIds || [],
    hourlyRate: HOURLY_RATE,
    aiAssistanceMultiplier: AI_ASSIST,
    humanEquivalentHours: humanHrs,
    totalHours: adjusted,
    totalCost,
    hoursByCategory: breakdown,
    completedAt: entry.completedAt,
    profile: entry.profile, modules: entry.modules || undefined,
    status: 'approved',
    approvedAt: FV.serverTimestamp(),
    approvedBy: { uid: 'system-backfill', name: 'Backfill v4.49.99-103 — sprint UX final 22/05' },
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
    return { action: 'updated', id, hrs: adjusted, cost: totalCost };
  }
  const ref = await db.collection(COLLECTION).add(payload);
  return { action: 'created', id: ref.id, hrs: adjusted, cost: totalCost };
}

(async () => {
  console.log(`\n📦 Backfill dev_hours: ${ENTRIES.length} releases (4.49.99-103)\n`);
  let totalH=0, totalC=0;
  for (const entry of ENTRIES) {
    const r = await upsert(entry);
    console.log(`  ${r.action==='created'?'+':'~'} ${entry.releaseVersion.padEnd(8)} ${String(r.hrs).padStart(6)}h · R$ ${r.cost.toFixed(2).padStart(9)} · ${r.action}`);
    totalH += r.hrs; totalC += r.cost;
  }
  console.log(`\n  ─────────────────────────────────────`);
  console.log(`  Total adicionado: ${totalH.toFixed(2)}h · R$ ${totalC.toFixed(2)}\n`);
  const all = await db.collection('dev_hours').where('status','==','approved').get();
  let gH=0, gC=0, gN=0;
  all.forEach(d => { const x=d.data(); gH += x.totalHours||0; gC += x.totalCost||0; gN++; });
  console.log(`  Grand total: ${gN} entries · ${gH.toFixed(2)}h · R$ ${gC.toFixed(2)}\n`);
  process.exit(0);
})();
