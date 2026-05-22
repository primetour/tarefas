/**
 * Backfill dev_hours: 4.49.91 → 4.49.98 (sprint 22/05/2026 continuação).
 * Sprint estendida pós-v90: Aéreo no schema + export, datalists, fix saves,
 * ícones SVG, filtros refeitos, auditoria contextual.
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
    releaseVersion: '4.49.91',
    releaseSlug:    '20260522-roteiros-aereo-hoteis-flights-array',
    title:          'Roteiros — Aéreo e Hotéis (flights[] schema + UI + 3 exports)',
    summary:        'Pedido do Renê: "aba Hotéis transformar em Aéreo e Hotéis, adicionando campos para as situações dos voos". Schema (emptyRoteiro): adicionado `flights: []` + migration on-read defensiva. UI: SECTIONS[2] renomeada, ícone ✈, renderHoteisSection com 2 sub-blocos h3 (Voos + Hotéis), renderFlightRow nova (8 cols: cia/voo/origem/destino/saída-data/saída-hora/chegada-data/chegada-hora), empty state. Handlers add-flight/remove-flight usando rerenderCurrentSection. collectFormData lê flights[]. Exports: PDF buildFlightsSection (autoTable AÉREO), PPTX slide AÉREO antes de Hotels, DOCX header Aéreo + Table 100%. Bonus fix: switchSection(10) (export-pdf/docx/pptx/generate-link) → switchSection(12) pra Preview & Export real.',
    profile:        'feature', bucket: 'medium',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-22T14:43:00-03:00'),
    modules:        ['roteiros'],
  },
  {
    releaseVersion: '4.49.92',
    releaseSlug:    '20260522-roteiros-aereo-no-link-publico',
    title:          'Roteiros — Aéreo no link público (roteiro-view.html)',
    summary:        'User-feedback: o canal principal pro cliente final é o link público, não PDF/DOCX/PPTX. Sem este patch, voos cadastrados não apareciam pro cliente. CSS .flights-table (tabela limpa, mobile responsive via data-label). Render extrai r.flights. Nav item "Aéreo" antes de "Hotéis" quando há voos. Section #sec-aereo: 4 cols (Cia/Voo, Rota, Saída, Chegada). fmtDate helper existente reutilizado.',
    profile:        'feature', bucket: 'small',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-22T15:00:00-03:00'),
    modules:        ['roteiros'],
  },
  {
    releaseVersion: '4.49.93',
    releaseSlug:    '20260522-roteiros-bugs-ux-imagens-dicas-auto',
    title:          'Roteiros — fix 21 handlers + Imagens preview + Dicas auto-prefill',
    summary:        'Renê reportou 5 bugs/melhorias: (1) Opcionais + Adicionar não funciona, (2-3) Inclui/Não inclui + Cancelamento botões não funcionam, (4) Imagens não mostra thumb do auto, (5) Dicas devem auto-prefill por destino. Fixes 1-3: 21 handlers migrados de switchSection(N) pra rerenderCurrentSection() (mesmo bug pré-existente do v4.49.87 sobrescrevendo push/splice via collectFormData). Fix 4: populateAutoImagePreviews chama enrichRoteiroImages (mesmo do PDF) async após render, substitui placeholder AUTO pelo <img> real (banco → Unsplash → Wikipedia). Fix 5: scheduleAutoAttachTipsForCountry hooka no handleEditorChange quando muda country, debounce 1.5s, fetchTips + snapshot + push em embeddedTips, dedup por sessão. Bonus: index===12 → ===11 (Avançado pós-v4.49.88).',
    profile:        'bugfix', bucket: 'medium',
    multiplierIds:  ['investigation'],
    completedAt:    new Date('2026-05-22T15:30:00-03:00'),
    modules:        ['roteiros'],
  },
  {
    releaseVersion: '4.49.94',
    releaseSlug:    '20260522-roteiros-dashed-solid-progress-ui',
    title:          'Roteiros — dashed→solid + progress overlay IA + agente v3',
    summary:        'Renê: "ainda vejo botões tracejados nesse módulo" (CLAUDE.md §4). 6 ocorrências de border:1px dashed migradas pra solid. .re-add-btn CSS refeito espelhando .btn-secondary do sistema (sem invenção). Renê: "essa API não está muito lenta? acho que vale um botão de progresso". Progress overlay full-screen pra geração com IA (Sonnet 4.5 leva 60-120s): fixed backdrop blur + card centralizado com ícone pulse, phase rotativo por tempo decorrido (5 stages: 0/20/45/80/120s), barra animada gradient slide, timer elapsed tabular-nums. Agente roteiros-luxo-gen atualizado via admin SDK pra v3: timeoutMs 90s→300s (alinha callLLM), systemPrompt remove refs a campos obsoletos (tipoViagem, orcamentoFaixa pós-v4.49.86), referência client.preferences/restrictions/economicProfile/notes + travelers[], instrução explícita "primeira caractere = {", flights[] declarado vazio (operacional).',
    profile:        'feature', bucket: 'medium',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-22T15:50:00-03:00'),
    modules:        ['roteiros'],
  },
  {
    releaseVersion: '4.49.95',
    releaseSlug:    '20260522-roteiros-fix-consultantid-save',
    title:          'Roteiros — HOTFIX permission-denied no save',
    summary:        'Renê: "não consegui salvar o seu teste". Bug pré-existente em roteiroEditor.js: store.get(\'user\') retornava undefined (key canônico é \'currentUser\'). consultantId ficava string vazia. Firestore rule (firestore.rules:841) exige consultantId == request.auth.uid no create — string vazia ≠ uid → permission-denied silencioso. Detecção: tentativa de save via UI falhou no MCP. Investigação direta via saveRoteiro mostrou Missing or insufficient permissions. Fix: 4 ocorrências migradas store.get(\'user\') → store.get(\'currentUser\'). Os 2 roteiros existentes no banco devem ter sido criados via outro path (script seed/test antigo pré-v4.40.31 hardening).',
    profile:        'bugfix', bucket: 'small',
    multiplierIds:  ['investigation'],
    completedAt:    new Date('2026-05-22T16:00:00-03:00'),
    modules:        ['roteiros'],
  },
  {
    releaseVersion: '4.49.96',
    releaseSlug:    '20260522-roteiros-icones-acao-svg',
    title:          'Roteiros — ícones de ação SVG + tooltip claro',
    summary:        'Renê: "ícones de ação na home do gerador de roteiros são confusos e não possuem explicação". Antes: chars unicode (✎ ⧉ ↓ ⊠ ✕) ambíguos — ⊠ confundia com ✕, ↓ parecia download/scroll, ⧉ obscuro. Agora: SVG inline 15x15 Heroicons-style — Editar (pencil), Duplicar (2 quadrados sobrepostos), Exportar PDF (seta+tray), Arquivar/Restaurar (caixa com tampa / seta circular), Excluir (lixeira). Tooltip via data-tip + CSS ::after dark bg #0A1628 (fade-in 0.15s, mais visível que title nativo). Buttons 30x30px, border-radius 6px, hover com border.',
    profile:        'feature', bucket: 'small',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-22T16:15:00-03:00'),
    modules:        ['roteiros'],
  },
  {
    releaseVersion: '4.49.97',
    releaseSlug:    '20260522-roteiros-fix-icones-overflow-filtros',
    title:          'Roteiros — fix overflow ícones + identidade gold + filtros refeitos',
    summary:        'Regressão do v96: buttons 30x30 invadiam coluna Atualizado. Renê: "a tabela onde ficam os ícones não está legal... eles ficaram em cima da coluna à esquerda". Reduzido pra 26x26, SVG 14x14, gap 2px. Coluna Ações 140→160px, Atualizado 84→110px. Identidade visual: hover dos ícones azul → dourado PRIMETOUR. Excluir mantém vermelho semântico. Filtros (3ª vez que Renê pediu mudança): Período pills dourado quando ativo (antes azul, confundia com status pills), label "PERÍODO" antes do grupo. Filtros avançados: <summary> discreto virou chip-button com ícone + chevron rotativo + badge "N ativos" quando há filtros. Body com bg-surface + border + padding. Botão "Limpar filtros" aparece com filtros ativos.',
    profile:        'feature', bucket: 'small',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-22T16:35:00-03:00'),
    modules:        ['roteiros'],
  },
  {
    releaseVersion: '4.49.98',
    releaseSlug:    '20260522-roteiros-filtros-visiveis-periodo-custom',
    title:          'Roteiros — audit contextual + filtros sempre visíveis + período custom',
    summary:        'Renê: "vc corrige a coluna de ícones e não corrige a coluna de período... percebe como é cansativo vc fazer as coisas sem olhar o contexto ao redor?". Aprendizado registrado em CLAUDE.md §10 (projeto) + ~/.claude/CLAUDE.md §6 (global): "olhar o TODO antes de declarar feito — percorrer header → filtros → tabela → ações → empty". Audit completo (3 fixes em 1 patch): (1) TD coluna Período sem class ellipsis transbordava em Consultor — adicionado em Período/Consultor/Atualizado + title atributo. (2) Filtros avançados sempre visíveis (sem <details>), pill-shaped, label "FILTROS" uppercase, alinhado ao "PERÍODO". (3) Período custom: openDateRangePicker novo helper em uiKit (modal inline com inputs date De/Até, validação from ≤ to). Label do pill vira "DD/MM → DD/MM" dinâmica após aplicar. Cancelar restaura estado anterior via re-render.',
    profile:        'feature', bucket: 'medium',
    multiplierIds:  [],
    completedAt:    new Date('2026-05-22T17:00:00-03:00'),
    modules:        ['roteiros'],
  },
];

async function upsert(entry) {
  const humanHrs = calcHumanHours(entry.bucket, entry.multiplierIds);
  const adjusted = Math.max(0.1, +(humanHrs * AI_ASSIST).toFixed(2));
  const totalCost = +(adjusted * HOURLY_RATE).toFixed(2);
  const breakdown = suggestBreakdown(adjusted, entry.profile);
  // v4.49.95+ field names alinhados ao service devHours.js (totalCost,
  // humanEquivalentHours, totalHours — NÃO usar 'cost' nem 'humanHoursEstimate')
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
    approvedBy: { uid: 'system-backfill', name: 'Backfill v4.49.91-98 — sprint roteiros estendida 22/05' },
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
  console.log(`\n📦 Backfill dev_hours: ${ENTRIES.length} releases (4.49.91-98)\n`);
  let totalH=0, totalC=0;
  for (const entry of ENTRIES) {
    const r = await upsert(entry);
    console.log(`  ${r.action==='created'?'+':'~'} ${entry.releaseVersion.padEnd(8)} ${String(r.hrs).padStart(6)}h · R$ ${r.cost.toFixed(2).padStart(9)} · ${r.action}`);
    totalH += r.hrs; totalC += r.cost;
  }
  console.log(`\n  ─────────────────────────────────────`);
  console.log(`  Total adicionado: ${totalH.toFixed(2)}h · R$ ${totalC.toFixed(2)}\n`);
  // Computa novo grand total
  const allSnap = await db.collection('dev_hours').where('status','==','approved').get();
  let gH=0, gC=0, gN=0;
  allSnap.forEach(d => { const x = d.data(); gH += x.totalHours || 0; gC += x.totalCost || 0; gN++; });
  console.log(`  Grand total agora: ${gN} entries · ${gH.toFixed(2)}h · R$ ${gC.toFixed(2)}\n`);
  process.exit(0);
})();
