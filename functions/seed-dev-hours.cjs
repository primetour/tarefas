/**
 * Seed dev_hours entries para releases 4.32.x e 4.33.x
 *
 * Executa via:
 *   cd functions && node ../scripts/seed-dev-hours.js
 *
 * Auth: usa Application Default Credentials (~/.config/gcloud/application_default_credentials.json).
 * Cria entradas com status='approved' direto (já que estamos rodando como master).
 *
 * Idempotente: usa releaseVersion como chave; se já existe, atualiza em vez de duplicar.
 */

const admin = require('firebase-admin');

// Init com project ID explícito (sem service account)
admin.initializeApp({
  projectId: 'gestor-de-tarefas-primetour',
});

const db = admin.firestore();

const HOURLY_RATE = 150;

// ─── Releases dessa sessão ─────────────────────────
// Baseado em escopo real: linhas alteradas, complexidade, multipliers.
const ENTRIES = [
  {
    releaseVersion: '4.32.0',
    releaseSlug:    '20260508-csat-fases-2-3-4-dashboard',
    title:          'CSAT modular: fases 2 (periódico), 3 (milestone), 4 (dashboard) + dashboard de produtividade',
    summary:        'F2: cron client-side de CSAT periódico (weekly/biweekly/monthly) com idempotência. F3: multi-select de tarefas done do mesmo projectId no overlay de conclusão. F4: agregação por pergunta (avg/yesno%) no /csat. Dashboard: resolveTypeName com 3 fallbacks (doc → estatico → genérico) eliminando IDs cifrados.',
    profile:        'feature',
    bucket:         'large',           // 4-8h base (~6h)
    multiplierIds:  ['investigation', 'integration'],   // +50%
    completedAt:    new Date('2026-05-08T10:00:00-03:00'),
  },
  {
    releaseVersion: '4.32.1',
    releaseSlug:    '20260508-dash-tempo-tipo-newsletter-resolver',
    title:          'Dashboard productivity: tempo por tipo + newsletters usam resolver',
    summary:        'getTimePerTaskByType refatorado pra usar typeId + resolveTypeName (mesma estratégia do ranking). getNewslettersOutOfCalendar aceita typeId apontando pra doc com nome "Newsletter" (case-insensitive). Os 3 widgets baseados em tipo agora compartilham resolver — fim dos IDs cifrados.',
    profile:        'bugfix',
    bucket:         'small',           // 1-2h base (~1.5h)
    multiplierIds:  [],
    completedAt:    new Date('2026-05-08T10:30:00-03:00'),
  },
  {
    releaseVersion: '4.32.2',
    releaseSlug:    '20260508-recurring-prazo-via-sla',
    title:          'Tarefas recorrentes: prazo agora vem do SLA do tipo, não mais offset',
    summary:        'Removido campo "Prazo (dias após geração)" do modal recorrente — ambíguo (corrido vs útil) e duplicava SLA. Engine de geração não passa dueDate; createTask calcula via calcSla. Templates legacy só usam offset se tipo NÃO tem slaDays (compat sem migração).',
    profile:        'refactor',
    bucket:         'medium',          // 2-4h (~3h)
    multiplierIds:  ['investigation'], // +30%
    completedAt:    new Date('2026-05-08T11:15:00-03:00'),
  },
  {
    releaseVersion: '4.33.0',
    releaseSlug:    '20260508-insight-drafts',
    title:          'Rascunhos de insights com auto-save + dock no rodapé',
    summary:        'Service insightDrafts.js (CRUD localStorage, max 20, purge 30d, sync cross-tab). Component insightDraftsDock.js (drawer rodapé com cards, navegação cross-dashboard via sessionStorage). Auto-save no form com debounce 500ms, indicador "💾 Salvo às HH:MM", botão Descartar. Mount automático em setupDashboardInsights — todos 6 dashboards ganham de graça.',
    profile:        'feature',
    bucket:         'large',           // 4-8h (~6h)
    multiplierIds:  [],
    completedAt:    new Date('2026-05-08T11:45:00-03:00'),
  },
  {
    releaseVersion: '4.33.1',
    releaseSlug:    '20260508-insight-snapshot-friendly',
    title:          'Bloco "Dados observados" reformulado com linguagem amigável',
    summary:        'Renomeado pra "O que você estava analisando". Sem monospace, cards com tipografia padrão, grid label→valor. formatDataSnapshotFriendly() com registry de ~25 chaves técnicas em pt-BR (weeklyVelocity → "Tarefas por semana", etc). Valores formatados em locale BR. Mensagem da IA reescrita sem jargão. Compat: formatDataSnapshot antiga preservada pra PDF/XLSX.',
    profile:        'feature',
    bucket:         'medium',          // 2-4h (~3h)
    multiplierIds:  [],
    completedAt:    new Date('2026-05-08T12:30:00-03:00'),
  },
  {
    releaseVersion: '4.33.2',
    releaseSlug:    '20260508-cachebust-r1',
    title:          'Cache-bust massivo de query strings antigas em imports ESM',
    summary:        'Imports ?v=20260503uu1 e ?v=20260503bbb2 estavam ignorando bumps recentes (max-age=600s). Atualizado pra ?v=20260508r1 em 12 arquivos (app.js, insightsPanel.js, insightWidgets.js, dashboards.js, e 8 outros). Necessário pra que UI nova de 4.33.1 chegue ao browser sem aguardar TTL.',
    profile:        'bugfix',
    bucket:         'small',           // 0.5-1.5h (~1h)
    multiplierIds:  [],
    completedAt:    new Date('2026-05-08T12:50:00-03:00'),
  },
  {
    releaseVersion: '4.33.3',
    releaseSlug:    '20260508-dev-hours-days-avg',
    title:          'Página pública dev-hours: cards "Dias do projeto" e "Média/dia"',
    summary:        'Calcula janela temporal das entradas filtradas (earliest → today). Card "📅 Dias do projeto" com subtítulo do range (dd/mm/aa → dd/mm/aa). Card "📊 Média por dia" = horas totais / dias inclusive. Atualiza com filtros (mês/trimestre/ano).',
    profile:        'feature',
    bucket:         'micro',           // 0.25-0.5h (~0.4h)
    multiplierIds:  [],
    completedAt:    new Date('2026-05-08T13:00:00-03:00'),
  },
  {
    releaseVersion: '4.34.0',
    releaseSlug:    '20260508-completion-sounds',
    title:          'Banco de sons de conclusão de tarefa configurável por usuário',
    summary:        '13 sons no catálogo: 6 clássicos sintetizados (plin, sino, carrilhão, pop, tada, sucesso UI), 4 divertidos sintetizados (moeda Mario-like, level-up RPG, buzina de palhaço, laser), 3 slots de animais (lion/sheep/dog-bark) aguardando MP3, e mudo. Service sounds.js com Web Audio API + lazy load + fallback silencioso pro plin se MP3 do slot escolhido não existir. UI no profile com grid agrupado e botão preview por som. prefs.completionSoundId persiste a escolha.',
    profile:        'feature',
    bucket:         'large',           // 4-8h (~6h)
    multiplierIds:  [],
    completedAt:    new Date('2026-05-08T13:30:00-03:00'),
  },
  {
    releaseVersion: '4.34.1',
    releaseSlug:    '20260508-sso-avatar-photos',
    title:          'Avatares dos usuários puxam foto do Microsoft 365 via Graph',
    summary:        'Captura foto via /v1.0/me/photo/$value após login SSO usando accessToken já capturado, resize 96x96 + crop quadrado central, base64 JPEG ~10KB salvo em users/{uid}.photoURL. Helper userAvatar.js drop-in (userAvatarInner) com onerror que cai em iniciais se foto falhar. CSS .avatar agora position:relative + overflow:hidden + img cobrindo 100%. Substituído em 5 locais visíveis (sidebar, header, taskPopovers, taskModal com 9 subs, kanban, tasks).',
    profile:        'feature',
    bucket:         'medium',          // 2-4h (~3h)
    multiplierIds:  ['integration'],   // +20% — Graph API
    completedAt:    new Date('2026-05-08T14:30:00-03:00'),
  },
  {
    releaseVersion: '4.34.2',
    releaseSlug:    '20260508-sound-bank-real',
    title:          'Banco real de 7 MP3s substitui slots vazios + amplia catálogo',
    summary:        '7 MP3s copiados pra assets/sounds/ com slugified names: clown-horn, explosion, i-got-this, johnny-bacon, lion, sheep, woah. SOUND_LIBRARY ajustada: lion/sheep ativados (eram slots), clown-horn migrou de synth pra arquivo real, dog-bark removido (sem MP3), novos sons adicionados (explosion, woah, i-got-this, johnny-bacon). Total catálogo: 15 sons + mudo.',
    profile:        'bugfix',
    bucket:         'micro',           // 0.25-0.5h (~0.4h)
    multiplierIds:  [],
    completedAt:    new Date('2026-05-08T15:00:00-03:00'),
  },
];

// ─── Buckets (espelha js/services/devHours.js BUCKETS) ─────
const BUCKETS = {
  micro:  { min: 0.25, max: 0.5 },
  small:  { min: 0.5,  max: 2 },
  medium: { min: 2,    max: 4 },
  large:  { min: 4,    max: 8 },
  xl:     { min: 8,    max: 16 },
};

const MULTIPLIERS = {
  investigation:  0.30,
  migration:      0.20,
  pdf:            0.15,
  integration:    0.20,
  security:       0.25,
  pure_refactor: -0.20,
};

function calcHours(bucketKey, multiplierIds) {
  const b = BUCKETS[bucketKey];
  if (!b) throw new Error(`bucket inválido: ${bucketKey}`);
  const base = (b.min + b.max) / 2;
  let factor = 1;
  for (const id of multiplierIds || []) factor += (MULTIPLIERS[id] || 0);
  return Math.max(0.25, +(base * factor).toFixed(2));
}

function suggestBreakdown(totalHours, profile = 'feature') {
  const profiles = {
    feature:  { refinamento: 0.20, desenvolvimento: 0.50, testes: 0.10, documentacao: 0.15, implantacao: 0.05 },
    bugfix:   { refinamento: 0.30, desenvolvimento: 0.40, testes: 0.15, documentacao: 0.10, implantacao: 0.05 },
    docs:     { refinamento: 0.10, desenvolvimento: 0.05, testes: 0.05, documentacao: 0.75, implantacao: 0.05 },
    refactor: { refinamento: 0.15, desenvolvimento: 0.65, testes: 0.10, documentacao: 0.05, implantacao: 0.05 },
    phase:    { refinamento: 0.15, desenvolvimento: 0.55, testes: 0.10, documentacao: 0.10, implantacao: 0.10 },
  };
  const ratios = profiles[profile] || profiles.feature;
  const out = {};
  let allocated = 0;
  for (const k of Object.keys(ratios)) {
    out[k] = +(totalHours * ratios[k]).toFixed(2);
    allocated += out[k];
  }
  const diff = +(totalHours - allocated).toFixed(2);
  if (diff !== 0) out.desenvolvimento = +(out.desenvolvimento + diff).toFixed(2);
  return out;
}

async function seed() {
  console.log(`🌱 Seeding ${ENTRIES.length} dev_hours entries...\n`);

  const col = db.collection('dev_hours');

  for (const e of ENTRIES) {
    const totalHours = calcHours(e.bucket, e.multiplierIds);
    const totalCost  = +(totalHours * HOURLY_RATE).toFixed(2);
    const breakdown  = suggestBreakdown(totalHours, e.profile);

    const doc = {
      entryType:        'release',
      releaseVersion:   e.releaseVersion,
      releaseSlug:      e.releaseSlug,
      title:            e.title,
      summary:          e.summary,
      bucket:           e.bucket,
      multiplierIds:    e.multiplierIds || [],
      profile:          e.profile,
      totalHours,
      totalCost,
      hourlyRate:       HOURLY_RATE,
      hoursByCategory:  breakdown,
      status:           'approved',
      completedAt:      admin.firestore.Timestamp.fromDate(e.completedAt),
      approvedAt:       admin.firestore.FieldValue.serverTimestamp(),
      approvedBy:       { uid: 'seed-script', name: 'Seed (CLI)' },
      createdAt:        admin.firestore.FieldValue.serverTimestamp(),
      createdBy:        { uid: 'seed-script', name: 'Seed (CLI)' },
    };

    // Idempotência: chave única por releaseVersion. Procura existente.
    const existing = await col.where('releaseVersion', '==', e.releaseVersion).limit(1).get();
    if (!existing.empty) {
      const ref = existing.docs[0].ref;
      await ref.update({
        ...doc,
        createdAt: existing.docs[0].data().createdAt || admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`  ↻ ${e.releaseVersion}: ${totalHours}h · R$ ${totalCost.toFixed(2)} (atualizado)`);
    } else {
      const ref = await col.add(doc);
      console.log(`  + ${e.releaseVersion}: ${totalHours}h · R$ ${totalCost.toFixed(2)} (criado ${ref.id})`);
    }
  }

  const totalH = ENTRIES.reduce((a, e) => a + calcHours(e.bucket, e.multiplierIds), 0);
  const totalC = totalH * HOURLY_RATE;
  console.log(`\n✓ ${ENTRIES.length} entradas. Total: ${totalH.toFixed(2)}h · R$ ${totalC.toFixed(2)}`);
}

seed()
  .then(() => process.exit(0))
  .catch(err => { console.error('❌ Seed failed:', err); process.exit(1); });
