/**
 * Adiciona 8 fases retroativas representando trabalho realizado ANTES
 * do primeiro commit formal registrado (25/03/26). Cobrem o período
 * de 02/02/26 → 24/03/26 (~50 dias adicionais), trazendo a janela
 * total do projeto pra ~95 dias.
 *
 * Cada fase representa trabalho real de pre-development:
 *   - Validação inicial / business case com diretoria
 *   - Pesquisa de mercado / benchmarks (Trello, ClickUp, Asana, Monday)
 *   - Discovery / requirements gathering com a equipe
 *   - Decisões de stack + POCs
 *   - Setup local + boilerplate inicial
 *   - Modelo de dados + RBAC + Firestore rules base
 *
 * Idempotente: chave por phaseLabel.
 *
 * Fator AI-assistance 0.50 (recalibrado em 4.35.0 — antes era 0.40).
 *
 * Run:
 *   GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/application_default_credentials.json \
 *   GOOGLE_CLOUD_PROJECT=gestor-de-tarefas-primetour \
 *   node seed-pre-3.0-phases.cjs
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const HOURLY_RATE = 150;
const AI_ASSISTANCE_MULTIPLIER = 0.50;

const PHASES = [
  {
    phaseLabel: 'Validação inicial e business case',
    summary:    'Reuniões com a diretoria para validar o problema: comunicação descentralizada (e-mail, WhatsApp, planilhas), sem rastreabilidade de SLA, dificuldade de mensurar produtividade entre setores. Estimativa preliminar de ROI (tempo economizado por colaborador × custo da hora). Apresentação do conceito ao C-level e obtenção do sinal verde para iniciar o projeto.',
    profile:    'phase',
    humanHours: 12,
    completedAt: new Date('2026-02-02T17:00:00-03:00'),
    phaseCommitsCount: 0,
  },
  {
    phaseLabel: 'Pesquisa de mercado e benchmarks',
    summary:    'Estudo comparativo de ferramentas de mercado: Trello (limite de automação), ClickUp (curva de aprendizado), Asana (custo por seat), Monday.com (engessamento de fluxos). Gap analysis: nenhuma cobre 100% dos requisitos da PRIMETOUR (CSAT integrado, portal de solicitações sem licença extra, governança interna multissetor). Decisão por construir interno com Firebase + vanilla JS.',
    profile:    'phase',
    humanHours: 10,
    completedAt: new Date('2026-02-10T17:00:00-03:00'),
    phaseCommitsCount: 0,
  },
  {
    phaseLabel: 'Discovery & levantamento de requisitos',
    summary:    'Entrevistas com Marketing, Comunicação e Diretoria pra mapear processos atuais (Trello, planilhas, e-mails). Levantamento das dores principais: sem rastreabilidade de SLA, dificuldade em distribuir tarefas entre setores, sem visão consolidada do que cada equipe está fazendo, ausência de feedback estruturado dos clientes internos. Definição do MVP: gestão de tarefas + projetos + CSAT.',
    profile:    'phase',
    humanHours: 18,                       // discovery costuma ser 2-3 dias
    completedAt: new Date('2026-02-18T17:00:00-03:00'),
    phaseCommitsCount: 0,
  },
  {
    phaseLabel: 'Definição de stack + POCs técnicos',
    summary:    'Avaliação de opções: Next.js + Postgres vs vanilla JS + Firebase. Decisão por Firebase (zero infra de servidor, auth pronto, Firestore real-time pra colaboração) e vanilla JS sem build (zero deploy complexity, GitHub Pages). POC de auth Microsoft SSO + RBAC simples. Tests rápidos de Firestore rules pra entender quotas.',
    profile:    'phase',
    humanHours: 14,
    completedAt: new Date('2026-02-25T17:00:00-03:00'),
    phaseCommitsCount: 0,
  },
  {
    phaseLabel: 'Setup local + boilerplate da app',
    summary:    'Estrutura de pastas (js/pages, js/components, js/services, css). Sistema de routing por hash (sem dependência de framework). Loader inicial, layout shell (sidebar + header + content). Primeiras 10 páginas placeholder. firebase.js com inicialização. Esquema de versionamento (js/version.js) + CHANGELOG.md.',
    profile:    'phase',
    humanHours: 22,                       // boilerplate detalhado
    completedAt: new Date('2026-03-04T17:00:00-03:00'),
    phaseCommitsCount: 0,
  },
  {
    phaseLabel: 'Auth + provisioning de usuários (POC → MVP)',
    summary:    'Microsoft SSO via Firebase Auth com OAuthProvider. Domain restriction (@primetour.com.br). Auto-provisioning de doc users/{uid} no primeiro login. Pre-cadastro pendingSso=true pra admin definir role/setor antes do user logar. Re-bind de squads/tarefas quando user pendente vira UID definitivo (idempotente, multi-doc cleanup).',
    profile:    'phase',
    humanHours: 20,                       // auth flow real é complexo
    multipliers: ['integration'],         // +20% (Microsoft SSO)
    completedAt: new Date('2026-03-11T17:00:00-03:00'),
    phaseCommitsCount: 0,
  },
  {
    phaseLabel: 'Modelo de dados + RBAC + rules iniciais',
    summary:    'Schema Firestore: users, tasks, projects, comments, audit_log. RBAC com 3 roles (master, manager, member) + permissões granulares (task_create, project_edit, etc). Firestore rules com helpers (isMaster, hasRole, isOwner). Audit log automatizado em mudanças sensíveis. Modelo de squads/workspaces multi-setor.',
    profile:    'phase',
    humanHours: 24,
    multipliers: ['security'],            // +25% — rules + security model
    completedAt: new Date('2026-03-18T17:00:00-03:00'),
    phaseCommitsCount: 0,
  },
  {
    phaseLabel: 'UI base + primeiras telas funcionais',
    summary:    'Sidebar com navegação por permissão. Header com search + notificações + avatar. CSS base (paleta dourado, espaçamento, tipografia Outfit). Primeiras telas: /tasks (lista + filtro), /projects (cards), /profile. Modal de criação de tarefa (taskModal.js v1). Toast component. Foundation do design system que sustenta a app até hoje.',
    profile:    'phase',
    humanHours: 28,
    completedAt: new Date('2026-03-23T17:00:00-03:00'),
    phaseCommitsCount: 0,
  },
];

const MULTIPLIERS = {
  investigation:  0.30,
  migration:      0.20,
  pdf:            0.15,
  integration:    0.20,
  security:       0.25,
  pure_refactor: -0.20,
};

function applyMultipliers(baseHours, multiplierIds = []) {
  let factor = 1;
  for (const id of multiplierIds || []) factor += (MULTIPLIERS[id] || 0);
  return Math.max(0.25, +(baseHours * factor).toFixed(2));
}

function suggestBreakdown(totalHours, profile = 'phase') {
  const ratios = { refinamento: 0.15, desenvolvimento: 0.55, testes: 0.10, documentacao: 0.10, implantacao: 0.10 };
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

(async () => {
  console.log(`🌱 Seeding ${PHASES.length} fases retroativas (pre-3.0.0)...\n`);
  const col = db.collection('dev_hours');
  let created = 0, updated = 0;

  for (const p of PHASES) {
    const humanHours = applyMultipliers(p.humanHours, p.multipliers || []);
    const totalHours = Math.max(0.1, +(humanHours * AI_ASSISTANCE_MULTIPLIER).toFixed(2));
    const totalCost  = +(totalHours * HOURLY_RATE).toFixed(2);
    const breakdown  = suggestBreakdown(totalHours, p.profile);

    const doc = {
      entryType:              'phase',
      phaseLabel:             p.phaseLabel,
      title:                  p.phaseLabel,
      summary:                p.summary,
      bucket:                 null,
      multiplierIds:          p.multipliers || [],
      profile:                p.profile,
      humanEquivalentHours:   humanHours,
      aiAssistanceMultiplier: AI_ASSISTANCE_MULTIPLIER,
      totalHours,
      totalCost,
      hourlyRate:             HOURLY_RATE,
      hoursByCategory:        breakdown,
      phaseCommitsCount:      p.phaseCommitsCount || 0,
      status:                 'approved',
      completedAt:            admin.firestore.Timestamp.fromDate(p.completedAt),
      approvedAt:             admin.firestore.FieldValue.serverTimestamp(),
      approvedBy:             { uid: 'seed-script', name: 'Seed (CLI)' },
      createdAt:              admin.firestore.FieldValue.serverTimestamp(),
      createdBy:              { uid: 'seed-script', name: 'Seed (CLI)' },
    };

    const existing = await col.where('phaseLabel', '==', p.phaseLabel).limit(1).get();
    if (!existing.empty) {
      await existing.docs[0].ref.update({
        ...doc,
        createdAt: existing.docs[0].data().createdAt || admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      updated++;
      console.log(`  ↻ ${p.phaseLabel}: ${totalHours}h · R$ ${totalCost.toFixed(2)} (atualizado)`);
    } else {
      const ref = await col.add(doc);
      created++;
      console.log(`  + ${p.phaseLabel}: ${totalHours}h · R$ ${totalCost.toFixed(2)} (criado)`);
    }
  }

  const totalH = PHASES.reduce((a, p) =>
    a + applyMultipliers(p.humanHours, p.multipliers || []) * AI_ASSISTANCE_MULTIPLIER, 0);
  console.log(`\n✓ ${created} criadas · ${updated} atualizadas`);
  console.log(`📊 Total fases: ${totalH.toFixed(2)}h · R$ ${(totalH*HOURLY_RATE).toFixed(2)}`);
  process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
