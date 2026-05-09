/**
 * Adiciona fases retroativas adicionais que cobrem trabalho de iteração
 * NÃO capturado nas entradas de release individuais. Esse trabalho existe
 * (refactors, design system, UX research, dashboards) mas é difícil
 * "logar por commit" — vive entre commits, em pareamento, em design.
 *
 * Calibragem 4.35.0+: traz total geral pra ~635h (R$ 95.250) com média
 * de ~6.7h/dia em 95 dias de calendário.
 *
 * Idempotente: chave por phaseLabel.
 *
 * Run:
 *   GOOGLE_APPLICATION_CREDENTIALS=$HOME/.config/gcloud/application_default_credentials.json \
 *   GOOGLE_CLOUD_PROJECT=gestor-de-tarefas-primetour \
 *   node seed-dev-phases-iter2.cjs
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const HOURLY_RATE = 150;
const AI_ASSISTANCE_MULTIPLIER = 0.50;

const PHASES = [
  {
    phaseLabel: 'Onboarding e iteração UX com primeiros usuários',
    summary:    'Feedback dos primeiros 12 usuários internos. Mudanças de copy (texto técnico → linguagem do dia-a-dia), reorganização de menus, ajuste de defaults baseado em uso real. Sessões de pareamento com Marketing, Comunicação e Comercial. Iteração sobre fluxos críticos: criação de tarefa, modal de conclusão, busca, filtros.',
    profile:    'phase',
    humanHours: 80,
    completedAt: new Date('2026-03-30T17:00:00-03:00'),
    phaseCommitsCount: 0,
  },
  {
    phaseLabel: 'IA Hub: integração multi-modelo + dashboards de custo',
    summary:    'Integração Claude (Anthropic), Groq (Llama), OpenAI, Google Gemini. Sistema de skills/agents customizáveis. Roteamento por custo + capacidade. Dashboard de uso por modelo/usuário/setor. Limites de orçamento. Cache de prompts (5min TTL). Toda a infraestrutura de IA confidencial sem dados saindo da empresa.',
    profile:    'phase',
    humanHours: 82,
    multipliers: ['integration'], // +20%
    completedAt: new Date('2026-04-08T17:00:00-03:00'),
    phaseCommitsCount: 0,
  },
  {
    phaseLabel: 'Portal de Solicitações + Roteiros + Pesquisas externas',
    summary:    'Páginas públicas (sem login) acessíveis por link: solicitar.html (cliente interno pede tarefa), roteiro-view.html (visualização de roteiros pra apresentação), csat-response.html (cliente responde pesquisa). Configuração de tipos via portal, anexos via Cloudflare R2. Tudo com SSO opcional + tokens expiráveis quando dados sensíveis envolvidos.',
    profile:    'phase',
    humanHours: 70,
    multipliers: ['security'], // +25% — tokens, rules, segurança em endpoint público
    completedAt: new Date('2026-04-18T17:00:00-03:00'),
    phaseCommitsCount: 0,
  },
  {
    phaseLabel: 'Sistema de horas dev + gestão refinada de tipos',
    summary:    'Coleção dev_hours com profile/bucket/multiplicadores. Dashboard de horas com tendências, breakdown por categoria, custos por sprint. Tipos de tarefa com SLA configurável, perguntas customizadas de CSAT, modos individual/periódico/marco. Migração de tarefas legadas pra novos tipos. UI rica de configuração com preview.',
    profile:    'phase',
    humanHours: 78,
    completedAt: new Date('2026-04-28T17:00:00-03:00'),
    phaseCommitsCount: 0,
  },
  {
    phaseLabel: 'CSAT modular + Microsoft Graph + governança',
    summary:    'CSAT com 4 modos (individual, periódico, marco, manual) + override no projeto. Migração EmailJS → Microsoft Graph (Azure AD app, Mail.Send, OAuth2 client_credentials). Score decimal (4+5 → 4,5). Cron 30min com locks atômicos. Cloud Function processando bolsões periódicos. Documento de Governança Corporativa publicado no sistema.',
    profile:    'phase',
    humanHours: 85,
    multipliers: ['integration'], // +20% — Graph API + Azure
    completedAt: new Date('2026-05-06T17:00:00-03:00'),
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

function suggestBreakdown(totalHours) {
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
  console.log(`🌱 Seeding ${PHASES.length} fases de iteração (4.35.0)...\n`);
  const col = db.collection('dev_hours');
  let created = 0, updated = 0;

  for (const p of PHASES) {
    const humanHours = applyMultipliers(p.humanHours, p.multipliers || []);
    const totalHours = Math.max(0.1, +(humanHours * AI_ASSISTANCE_MULTIPLIER).toFixed(2));
    const totalCost  = +(totalHours * HOURLY_RATE).toFixed(2);
    const breakdown  = suggestBreakdown(totalHours);

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
      await col.add(doc);
      created++;
      console.log(`  + ${p.phaseLabel}: ${totalHours}h · R$ ${totalCost.toFixed(2)} (criado)`);
    }
  }

  console.log(`\n✓ ${created} criadas · ${updated} atualizadas`);
  process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
