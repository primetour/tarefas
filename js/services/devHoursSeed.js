/**
 * PRIMETOUR — Dev Hours Backfill (4.1.0)
 *
 * Seed script que popula a collection `dev_hours` com:
 *   1. Fases retroativas agregadas (1.x e 2.x — pré-versionamento formal)
 *   2. Releases granulares da fase atual (3.0.0 → 4.0.0)
 *
 * Idempotente: usa `findByVersion()` antes de criar pra não duplicar.
 * Master-only. Chamado pelo botão em Settings.
 *
 * Metodologia das fases retroativas (1.x/2.x):
 *   Sem prompts originais disponíveis — estimativa baseada em:
 *   - Volume de commits (git rev-list)
 *   - Duração calendar (datas dos commits da fase)
 *   - Heurística de produtividade (≈ 0.5h/commit ajustada por complexidade
 *     do tipo de fase: setup ≈ 0.5h, hardening ≈ 0.5h, refactor ≈ 0.5h)
 *   - Confiança "low" — explicitamente sinalizada no UI
 *
 * Para releases granulares (3.x+ e 4.0.0):
 *   - Tenho transcript completo desta sessão
 *   - Confiança "high" — sei exatamente o que fizemos
 */

import { findByVersion, createEntry, calcCost } from './devHours.js';

const SEED_DATA = [
  /* ───────── FASES RETROATIVAS (1.x / 2.x) ───────── */
  {
    entryType: 'phase',
    phaseLabel: 'Setup inicial + arquitetura base',
    phaseCommitsCount: 150,
    title: 'Bootstrap do sistema (Firebase + módulos core + auth)',
    summary: 'Infraestrutura inicial: configuração Firebase, autenticação, estrutura de pastas, router custom, store global, design system inicial. Módulos base: tarefas, projetos, kanban, dashboard. Sem versionamento estruturado nesse período — agregado retrospectivamente. Confiança baixa por ausência de prompts originais.',
    completedAt: '2026-03-25',
    bucket: 'mega',
    basePoint: 50,
    multipliers: ['integration'],   // +20%
    profile: 'phase',
    confidenceLevel: 'low',
  },
  {
    entryType: 'phase',
    phaseLabel: 'Hardening de segurança (5 sprints)',
    phaseCommitsCount: 400,
    title: 'Segurança: SOC 2 / ISO 27001 / LGPD compliance',
    summary: 'Cinco sprints focados em endurecer o sistema: roles e permissões granulares, audit trail, multi-fator quando aplicável, sanitização XSS, CSP headers, revisão de regras Firestore, separação por setor/squad, hardening de upload de arquivos. Marco de compliance.',
    completedAt: '2026-04-15',
    bucket: 'mega',
    basePoint: 60,
    multipliers: ['security', 'investigation'],   // +25% +30%
    profile: 'phase',
    confidenceLevel: 'low',
  },
  {
    entryType: 'phase',
    phaseLabel: 'Refactor multi-tenancy + multi-setor',
    phaseCommitsCount: 300,
    title: 'Squads, workspaces, sectors — arquitetura multi-tenant',
    summary: 'Migração da arquitetura single-tenant pra multi-tenant. Schema de squads (workspaces), múltiplos setores por usuário, regras de visibilidade cruzada, ativeWorkspaceIds + visibleSectors. Ajustes em 100% das páginas de listagem. Migração de dados.',
    completedAt: '2026-04-25',
    bucket: 'mega',
    basePoint: 50,
    multipliers: ['migration', 'pure_refactor'],   // +20% -20% = 0%
    profile: 'phase',
    confidenceLevel: 'low',
  },
  {
    entryType: 'phase',
    phaseLabel: 'Polimento + preparação 3.0.0',
    phaseCommitsCount: 250,
    title: 'UX polish + IA Hub + módulos avançados',
    summary: 'Refinamento de UX em todos os módulos, criação do IA Hub (agents/skills), módulos de Metas, Roteiros, Calendário de Conteúdo, Newsletter, Portal de Solicitações, Análise de notícias. Preparação pra formalização de versionamento (3.0.0).',
    completedAt: '2026-05-02',
    bucket: 'mega',
    basePoint: 45,
    multipliers: ['integration'],   // +20%
    profile: 'phase',
    confidenceLevel: 'low',
  },

  /* ───────── RELEASES GRANULARES 3.x ───────── */
  {
    entryType: 'release', releaseVersion: '3.0.0', releaseSlug: 'pickers — calibragem honesta',
    title: 'Versionamento formal + calibragem inicial',
    summary: 'Formalização SemVer + BUILD identifier. js/version.js criado. CHANGELOG estruturado. Pickers customizados padronizados (optionPicker). Marco zero do versionamento rigoroso.',
    completedAt: '2026-05-05',
    bucket: 'medium', basePoint: 3,
    multipliers: [],
    profile: 'feature', confidenceLevel: 'high',
  },
  {
    entryType: 'release', releaseVersion: '3.1.0', releaseSlug: 'docs — docs publicos para auditoria externa',
    title: 'Documentação pública pra auditoria externa',
    summary: 'docs/VERSIONING.md, docs/SECURITY.md, docs/PRIVACY.md, README detalhado. Compliance posture explícita (SOC 2 / ISO 27001 / LGPD + não-aplicabilidades).',
    completedAt: '2026-05-05',
    bucket: 'medium', basePoint: 2.5,
    multipliers: [],
    profile: 'docs', confidenceLevel: 'high',
  },
  {
    entryType: 'release', releaseVersion: '3.2.0', releaseSlug: 'governance — auditoria-ready',
    title: 'Governança e auditoria-ready',
    summary: 'Audit log estruturado, rastreabilidade de mudanças críticas, alinhamento dos eventos com framework de auditoria.',
    completedAt: '2026-05-05',
    bucket: 'medium', basePoint: 3,
    multipliers: ['security'],   // +25%
    profile: 'feature', confidenceLevel: 'high',
  },
  {
    entryType: 'release', releaseVersion: '3.3.0', releaseSlug: 'fix-icones-e-release-script',
    title: 'scripts/release.sh + fix de ícones de projeto',
    summary: 'Automação atômica de bump (version.js + index.html + CHANGELOG placeholder). Fix de ícones que estavam quebrados em alguns projetos.',
    completedAt: '2026-05-05',
    bucket: 'small', basePoint: 1.25,
    multipliers: [],
    profile: 'feature', confidenceLevel: 'high',
  },
  {
    entryType: 'release', releaseVersion: '3.4.0', releaseSlug: 'regras-e-search-docs',
    title: 'RULES-AND-AUTOMATIONS.md + busca em docs',
    summary: 'Documentação consolidada de regras de negócio e automações do sistema. Busca em docs públicos.',
    completedAt: '2026-05-05',
    bucket: 'medium', basePoint: 3,
    multipliers: [],
    profile: 'docs', confidenceLevel: 'high',
  },
  {
    entryType: 'release', releaseVersion: '3.5.0', releaseSlug: 'status-atrasada-datepicker-search-meu-painel',
    title: 'Status virtual "Atrasada" + datepicker showPicker + meu painel',
    summary: 'Coluna virtual "Atrasada" derivada (não persistida) no kanban. enhanceDatepickers() aplicando showPicker() em qualquer click. Refinamento do Meu Painel com novos KPIs.',
    completedAt: '2026-05-05',
    bucket: 'large', basePoint: 5.5,
    multipliers: ['investigation'],   // +30%
    profile: 'feature', confidenceLevel: 'high',
  },
  {
    entryType: 'release', releaseVersion: '3.5.1', releaseSlug: 'sync-pickers-visual',
    title: 'Sincronização visual de pickers com URL hash',
    summary: 'Bug detectado em teste in-browser pós-3.5.0: pickers não refletiam estado da URL. Fix: <option selected> + renderPickerButton com selected calculado.',
    completedAt: '2026-05-05',
    bucket: 'small', basePoint: 1,
    multipliers: ['investigation'],   // +30%
    profile: 'bugfix', confidenceLevel: 'high',
  },
  {
    entryType: 'release', releaseVersion: '3.6.0', releaseSlug: 'refactor-meu-painel',
    title: '"Meu Painel coerente" — 4 bugs distintos corrigidos',
    summary: 'Refactor profundo: cards somavam de bases diferentes (filterAssignee vs visibleTasks); archived não filtrado no painel; status "todo" inexistente em distribuição; Projetos Ativos global virou Meus Projetos. Definição canônica de "minhas tarefas" em RULES-AND-AUTOMATIONS.md.',
    completedAt: '2026-05-05',
    bucket: 'epic', basePoint: 9,
    multipliers: ['investigation'],   // +30%
    profile: 'bugfix', confidenceLevel: 'high',
  },
  {
    entryType: 'release', releaseVersion: '3.6.1', releaseSlug: 'fix-buraco-painel',
    title: 'Fix do "buraco" branco do grid CSS',
    summary: 'Regressão visual: auto-fit grid não colapsava colunas vazias. Fix: flex column outer + grid auto-fit por sub-row independente.',
    completedAt: '2026-05-05',
    bucket: 'medium', basePoint: 2,
    multipliers: ['investigation'],
    profile: 'bugfix', confidenceLevel: 'high',
  },
  {
    entryType: 'release', releaseVersion: '3.7.0', releaseSlug: 'reorganiza-cards-painel',
    title: 'Estrutura canônica 4+4 cards no Meu Painel',
    summary: 'Reorganização em 2 seções simétricas: 🎯 Meu desempenho (Minhas/Atrasadas/Em andamento/Concluídas hoje) + 🏢 Equipe (mesma estrutura). Removidos Observando + Parcerias dos KPIs principais.',
    completedAt: '2026-05-05',
    bucket: 'large', basePoint: 5.5,
    multipliers: [],
    profile: 'refactor', confidenceLevel: 'high',
  },
  {
    entryType: 'release', releaseVersion: '3.7.1', releaseSlug: 'fix-painel-filtros-persistentes',
    title: '2 bugs: filtros persistentes + sector mismatch fetchTasks vs subscribe',
    summary: 'Bug 1 (hipótese certeira do user): "if (urlAssignee)" persistia filtro do click anterior. Fix: assignment incondicional. Bug 2 descoberto investigando 860 vs 1039: subscribeToTasks usava get("visibleSectors") raw em vez de getVisibleSectors() — não-Head não filtrava setor → vazamento cross-sector.',
    completedAt: '2026-05-05',
    bucket: 'medium', basePoint: 3.5,
    multipliers: ['investigation'],   // +30%
    profile: 'bugfix', confidenceLevel: 'high',
  },
  {
    entryType: 'release', releaseVersion: '3.7.2', releaseSlug: 'fix-contador-arquivadas',
    title: 'Contador "(de N)" não conta arquivadas',
    summary: 'Denominador no header da #tasks contava archived que ninguém pode ver. Fix: usar allTasks.filter(!archived).length como teto.',
    completedAt: '2026-05-05',
    bucket: 'small', basePoint: 1,
    multipliers: [],
    profile: 'bugfix', confidenceLevel: 'high',
  },
  {
    entryType: 'release', releaseVersion: '3.8.0', releaseSlug: 'arquivamento-730d-toggle',
    title: 'Auto-archive 30d→730d + toggle "Mostrar arquivadas" + migração retroativa',
    summary: 'Threshold incompatível com escopo de metas. 4 entregas: aumento threshold, toggle UI + URL ?archived=1, badge nos rows, botão de migração idempotente em settings, help text corrigido. 179 docs migrados.',
    completedAt: '2026-05-05',
    bucket: 'epic', basePoint: 10,
    multipliers: ['migration'],   // +20%
    profile: 'feature', confidenceLevel: 'high',
  },

  /* ───────── 4.0.0 — esta entrega ───────── */
  {
    entryType: 'release', releaseVersion: '4.0.0', releaseSlug: 'dev-hours-foundation',
    title: 'MAJOR: foundation do sistema de Horas de Desenvolvimento',
    summary: 'Service layer com 5 categorias + 6 buckets + 6 multiplicadores + estimador + distribuidor automático + explainEntry. Página master-only com cards/filtros/tabela/modais (transparência radical). Workflow draft→approve. Disclaimer ético permanente. Fundação para 4.1.0 (backfill), 4.2.0 (público), 4.3.0 (PDF).',
    completedAt: '2026-05-05',
    bucket: 'large', basePoint: 7,
    multipliers: [],
    profile: 'feature', confidenceLevel: 'high',
  },
];

/**
 * Distribuição categórica por perfil — usado pelo seed pra preencher
 * hoursByCategory de cada entry. Replica suggestCategoryBreakdown()
 * mas inline pra evitar dependência circular.
 */
const PROFILE_RATIOS = {
  feature:  { refinamento: 0.20, desenvolvimento: 0.50, testes: 0.10, documentacao: 0.15, implantacao: 0.05 },
  bugfix:   { refinamento: 0.30, desenvolvimento: 0.40, testes: 0.15, documentacao: 0.10, implantacao: 0.05 },
  docs:     { refinamento: 0.10, desenvolvimento: 0.05, testes: 0.05, documentacao: 0.75, implantacao: 0.05 },
  refactor: { refinamento: 0.15, desenvolvimento: 0.65, testes: 0.10, documentacao: 0.05, implantacao: 0.05 },
  phase:    { refinamento: 0.15, desenvolvimento: 0.55, testes: 0.10, documentacao: 0.10, implantacao: 0.10 },
};

const MULTIPLIER_VALUES = {
  investigation: 0.30, migration: 0.20, pdf: 0.15,
  integration: 0.20, security: 0.25, pure_refactor: -0.20,
};

function distributeByProfile(totalHours, profile) {
  const ratios = PROFILE_RATIOS[profile] || PROFILE_RATIOS.feature;
  const out = {};
  let sum = 0;
  for (const k of Object.keys(ratios)) {
    out[k] = +(totalHours * ratios[k]).toFixed(2);
    sum += out[k];
  }
  const diff = +(totalHours - sum).toFixed(2);
  if (diff !== 0) out.desenvolvimento = +(out.desenvolvimento + diff).toFixed(2);
  return out;
}

function calcHours(basePoint, multiplierIds) {
  let factor = 1;
  for (const id of multiplierIds || []) factor += MULTIPLIER_VALUES[id] || 0;
  return Math.max(0.25, +(basePoint * factor).toFixed(2));
}

/**
 * Roda o backfill. Idempotente: pula entries que já existem (por releaseVersion
 * ou pela combinação entryType+phaseLabel).
 *
 * @param {function} progressCb (current, total, label) — callback de progresso
 * @returns {Promise<{created: number, skipped: number, errors: any[]}>}
 */
export async function seedBackfill(progressCb = () => {}) {
  let created = 0;
  let skipped = 0;
  const errors = [];

  const total = SEED_DATA.length;

  for (let i = 0; i < SEED_DATA.length; i++) {
    const item = SEED_DATA[i];
    const label = item.releaseVersion || item.phaseLabel || 'sem-id';
    progressCb(i + 1, total, label);

    try {
      // Idempotência por versão (releases) ou phaseLabel (phases)
      if (item.entryType === 'release') {
        const existing = await findByVersion(item.releaseVersion);
        if (existing) { skipped++; continue; }
      }
      // Para fases não temos findByVersion — usamos um marker separado ou
      // simplesmente regravar é OK porque são poucas. Preferimos skip por
      // phaseLabel: o user pode deletar manualmente se quiser refazer.
      if (item.entryType === 'phase') {
        // Procura por phaseLabel já existente
        const { fetchDevHours } = await import('./devHours.js');
        const all = await fetchDevHours();
        if (all.some(e => e.entryType === 'phase' && e.phaseLabel === item.phaseLabel)) {
          skipped++; continue;
        }
      }

      const totalHours = calcHours(item.basePoint, item.multipliers);
      const totalCost = calcCost(totalHours, 150);
      const hoursByCategory = distributeByProfile(totalHours, item.profile);

      await createEntry({
        entryType:        item.entryType,
        releaseVersion:   item.releaseVersion || null,
        releaseSlug:      item.releaseSlug || null,
        phaseLabel:       item.phaseLabel || null,
        phaseCommitsCount: item.phaseCommitsCount || null,
        title:            item.title,
        summary:          item.summary,
        completedAt:      new Date(item.completedAt + 'T18:00:00'),
        bucket:           item.bucket,
        basePoint:        item.basePoint,
        multipliers:      item.multipliers || [],
        totalHours,
        hourlyRate:       150,
        totalCost,
        hoursByCategory,
        notes:            item.summary,
        confidenceLevel:  item.confidenceLevel,
        profile:          item.profile,
        status:           'draft',
      });
      created++;
    } catch (e) {
      console.error('[seed]', label, e);
      errors.push({ label, error: e.message });
    }
  }

  return { created, skipped, errors, total };
}
