/**
 * Backfill dev_hours: sprint Portal Wizard 24/05/2026
 * v4.54.0 → v4.57.2 = 17 releases consecutivas refatorando o Portal de
 * Solicitações de form único pra wizard 4 passos + paridade 92%+ vs legacy.
 *
 * Lições novas no CLAUDE.md:
 * - §12.t: dynamic imports com querystring criam instâncias separadas
 *          (bug v4.54.2 → fix via const compartilhada WIZARD_VERSION)
 * - §12.u: Auditoria por Agent em background enquanto fixa bugs
 *          visuais (paralelismo entre planning e execução)
 * - §12.v: Wizard pattern com auto-save em localStorage por user +
 *          AbortController por render + atalhos Enter/Esc + skip auto
 *
 * Renê: "faça tudo e entregue pronto sem perguntar".
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
    releaseVersion: '4.54.0',
    releaseSlug: '20260524-portal-wizard-4-steps',
    title: 'Portal de Solicitações — refator wizard 4 passos (MVP)',
    summary: 'Renê (relato usuários): "portal de solicitações nao seja em forma, e sim um passo a passo tela cheia". ' +
             'Substitui form único de scroll (~620 linhas) por wizard com 4 passos lineares: Setor+Tipo / Quando / ' +
             'Detalhes / Revisão. Novo arquivo js/portal/portalWizard.js (~600 LOC) autossuficiente. portal.js modificado ' +
             'mínimo (substitui bindFormEvents por renderPortalWizard). Backup do form antigo em portalLegacy.js. ' +
             'Features: progresso 4 dots, atalhos Enter/Esc, skip auto se 1 opção, auto-save localStorage por user (7d), ' +
             'Salvar e sair, Enviar+Outra similar mantendo setor+tipo. Zero mudança em schema/rules.',
    bucket: 'large', multiplierIds: ['integration'], profile: 'feature',
    hoursByCategory: { refinamento: 1.5, desenvolvimento: 6.0, testes: 1.5, documentacao: 0.5, implantacao: 0.3 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.54.1',
    releaseSlug: '20260524-portal-wizard-fix-validate-step4',
    title: 'Hotfix wizard — _validateStep4 não definida (ReferenceError)',
    summary: 'E2E imediato pegou: array de validators em _tryAdvance referenciava _validateStep4 que não existia. ' +
             'Quebrava silenciosamente o handler de "Próximo" no Step 1 — wizard preso. Fix: cria _validateStep4 + ' +
             'refatora _validateStep1 com optional chaining em getElementById. Reforço CLAUDE.md §1: node --check NÃO ' +
             'pega ReferenceError em call sites.',
    bucket: 'trivial', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.05, desenvolvimento: 0.1, testes: 0.1, documentacao: 0.05, implantacao: 0.05 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.54.2',
    releaseSlug: '20260524-portal-wizard-newsletter-prefill',
    title: 'Popup newsletter — API prefillWizardData exportada',
    summary: 'Popup "Sim, é newsletter" fechava mas não pré-preenchia o wizard (silenciosamente). Causa: prefillNewsletter ' +
             'tocava IDs p-setor/p-type do form antigo. Cria prefillWizardData export no wizard que escreve state + ' +
             'salta pro Step 2 com sector+typeId completos.',
    bucket: 'trivial', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.05, desenvolvimento: 0.15, testes: 0.08, documentacao: 0.05, implantacao: 0.05 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.54.3',
    releaseSlug: '20260524-portal-wizard-same-module-instance',
    title: 'Fix instância dupla do módulo portalWizard',
    summary: 'Re-teste pós-v4.54.2: popup ainda sem prefill. Console mostrou import com querystrings diferentes ' +
             '(?v=4.54.1 no init vs ?v=4.54.2 no popup) — ES modules cacheiam por URL exata = 2 instâncias com _state ' +
             'separados. prefillWizardData rodava na instância nova (_state=null). Remove qs dos imports. ' +
             'Lição CLAUDE.md §12.t.',
    bucket: 'trivial', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.1, testes: 0.1, documentacao: 0.05, implantacao: 0.05 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.54.4',
    releaseSlug: '20260524-portal-wizard-fase-A-notify-lock-urgency',
    title: 'Wizard Fase A — notifyTeam + lock urgência por deadline',
    summary: '_notifyTeam chamado no submit (POST sendEmailUrl, best-effort). _checkAutoUrgency: hoursUntil ≤24h ou ' +
             'bizDays<SLA → urgency=true + urgencyAutoLocked=true + reason. Step 4 mostra toggle disabled + badge 🔒 ' +
             'automático. _countBusinessDays helper. Persistência no doc Firestore.',
    bucket: 'small', multiplierIds: ['integration'], profile: 'feature',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.2, testes: 0.4, documentacao: 0.2, implantacao: 0.1 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.54.5',
    releaseSlug: '20260524-portal-wizard-fase-A-sla-field-fix',
    title: 'Wizard fix — campo SLA é slaDays (não sla)',
    summary: 'E2E v4.54.4: lock urgência não disparava. Campo no Firestore é variation.slaDays, wizard lia .sla. ' +
             'Aceita slaDays || sla em 4 lugares (dropdown label, hint, summary, _checkAutoUrgency).',
    bucket: 'trivial', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.05, desenvolvimento: 0.1, testes: 0.1, documentacao: 0.05, implantacao: 0.05 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.55.0',
    releaseSlug: '20260524-portal-wizard-fase-B-calendario-visual',
    title: 'Wizard Fase B — calendário visual mensal com slots',
    summary: 'Substitui chips simples por grid 7×N do mês corrente. Slots pré-agendados (weekly/monthly_days/custom) ' +
             'expandidos visualmente com cor e título. Dias futuros vazios clicáveis (forçam OOC=true). Today destacado, ' +
             'selected gold, past disabled. Click slot → desmarca OOC + pre-fill requestingArea. Nav prev/next. ' +
             '_getSlotsForDate + _toISODate helpers (fuso local).',
    bucket: 'medium', multiplierIds: ['integration'], profile: 'feature',
    hoursByCategory: { refinamento: 0.5, desenvolvimento: 2.5, testes: 0.8, documentacao: 0.3, implantacao: 0.2 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.55.1',
    releaseSlug: '20260524-portal-wizard-cache-bust-fix',
    title: 'Wizard fix — cache-bust via const WIZARD_VERSION',
    summary: 'E2E v4.55.0: calendário não renderizava. Removi qs do dynamic import (v4.54.3) pra evitar instância dupla, ' +
             'mas perdeu cache-bust (GH Pages max-age=600). Solução: const WIZARD_VERSION no topo do portal.js + usa ' +
             'mesma string em ambos os imports. Resultado: mesma instância (sem bug v4.54.2) + cache-bust ao bumpar.',
    bucket: 'trivial', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.1, testes: 0.1, documentacao: 0.05, implantacao: 0.05 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.55.2',
    releaseSlug: '20260524-portal-calendar-multi-slot-badge',
    title: 'Calendário — badge "+N" pra múltiplos slots',
    summary: 'Newsletter tem slots em todos os 7 dias da semana (4 marcas × 2-3 dias). Adiciona badge "+N" quando dia ' +
             'tem >1 slot + tooltip lista todos.',
    bucket: 'trivial', multiplierIds: [], profile: 'feature',
    hoursByCategory: { refinamento: 0.05, desenvolvimento: 0.1, testes: 0.05, documentacao: 0.03, implantacao: 0.03 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.55.3',
    releaseSlug: '20260524-portal-wizard-fase-C-edit-existing-request',
    title: 'Wizard Fase C — edição de solicitação enviada + requesterEditFlag',
    summary: 'Renê: "edicao do slot depois da solicitacao enviada (banner no sistema)". Banner "📋 Suas últimas ' +
             'solicitações" no Step 1 (até 5). Click → entra edit mode + pré-popula state. Cancel edit. Submit em edit ' +
             'usa updateDoc + grava requesterEditFlag=true + requesterEditedAt (banner no sistema principal pro ' +
             'assignee). Botão "Salvar alterações" em vez de "Enviar".',
    bucket: 'medium', multiplierIds: ['integration'], profile: 'feature',
    hoursByCategory: { refinamento: 0.4, desenvolvimento: 2.0, testes: 0.6, documentacao: 0.3, implantacao: 0.2 },
    module: 'requests', modules: ['requests', 'portal', 'tasks'],
  },
  {
    releaseVersion: '4.55.4',
    releaseSlug: '20260524-portal-wizard-edit-query-by-email',
    title: 'Wizard fix — query recent requests por email (retrocompat)',
    summary: 'E2E v4.55.3: banner de recentes vazio. Query usava requesterUid mas requests antigas (portalLegacy) só ' +
             'gravavam requesterEmail. byUidCount=0 vs byEmailCount=3. Troca query pra usar email (estável, presente ' +
             'em todas).',
    bucket: 'trivial', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.05, desenvolvimento: 0.1, testes: 0.08, documentacao: 0.03, implantacao: 0.03 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.55.5',
    releaseSlug: '20260524-portal-wizard-fase-C2-batch-envio-lote',
    title: 'Wizard Fase C-2 — envio em lote (batch)',
    summary: '_state.batchQueue + botão "+ Adicionar ao lote" no Step 4 (oculto em edit). Badge "📦 Lote pendente: N" ' +
             'no Step 1 com lista de itens removíveis. Label submit dinâmico ("Enviar lote (N solicitações) →"). ' +
             'Submit do lote: addDoc current + for-loop addDoc dos enfileirados (erro num item não cancela outros). ' +
             'Tela de sucesso pluralizada. _buildRequestDoc extraído pra DRY.',
    bucket: 'medium', multiplierIds: ['integration'], profile: 'feature',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.8, testes: 0.5, documentacao: 0.2, implantacao: 0.2 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.55.6',
    releaseSlug: '20260524-portal-wizard-batch-pill-all-steps',
    title: 'Wizard — pill "Lote pendente: N" em todos os steps',
    summary: 'E2E v4.55.5: badge só no Step 1. Renderiza pill discreto verde no _renderProgress (acima dos dots) ' +
             'visível em todos os steps. Badge completo (lista+remover) continua só no Step 1.',
    bucket: 'trivial', multiplierIds: [], profile: 'feature',
    hoursByCategory: { refinamento: 0.05, desenvolvimento: 0.15, testes: 0.05, documentacao: 0.03, implantacao: 0.03 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.55.7',
    releaseSlug: '20260524-portal-light-mode-default-buttons-overflow',
    title: 'Portal — 3 fixes Renê (modo claro default, botões padrão, calendário overflow)',
    summary: 'Renê reportou 3 problemas + demanda 100% paridade + auditoria de testes. Este commit ataca os 3 visuais: ' +
             '(1) modo claro como default (solicitar.html + portal.js — só usa dark se user explicitamente escolheu); ' +
             '(2) botões "Salvar e sair"/"Cancelar edição"/sucesso usam classes do sistema sem inline conflitante; ' +
             '(3) calendário slot "vazando" pra coluna vizinha: adiciona overflow:hidden + min-width:0 + ' +
             'box-sizing:border-box.',
    bucket: 'small', multiplierIds: [], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.4, testes: 0.15, documentacao: 0.1, implantacao: 0.05 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.55.8',
    releaseSlug: '20260524-portal-wizard-criticos-autoCreate-notify-syncTask',
    title: 'Wizard — 3 CRÍTICOS (autoCreateTask + notifyAdmins + sync task linked)',
    summary: 'Auditoria do agent mapeou 45 gaps. Este commit ataca os 3 críticos que bloqueiam produção: ' +
             '(1) _autoCreateTask: quando type.autoAccept=true, cria task em "tasks" + atualiza request com ' +
             'status="converted" + taskId. dueDate via SLA bizDays. Schema completo idêntico ao legacy. Chamado em ' +
             'submit single E cada item do lote. ' +
             '(2) _notifyAdmins real (substitui stub): query users active=true + filtra admins (isMaster + roleId/role ' +
             'in [master,admin,head]) + notify("request.created") com actorId/actorName explícitos (portal não popula ' +
             'store.currentUser). ' +
             '(3) Sync de task linked em edit: quando user edita request convertida (tem taskId), atualiza task linked ' +
             'com title/desc/priority/dueDate/variation novos + flags requesterEditFlag/requesterEditAt/' +
             'requesterEditChanges. withRetry (3x backoff) pra rede instável. Toast vermelho se falhar.',
    bucket: 'medium', multiplierIds: ['integration', 'security'], profile: 'feature',
    hoursByCategory: { refinamento: 0.5, desenvolvimento: 2.0, testes: 0.6, documentacao: 0.4, implantacao: 0.2 },
    module: 'requests', modules: ['requests', 'portal', 'tasks'],
  },
  {
    releaseVersion: '4.56.0',
    releaseSlug: '20260524-portal-wizard-cal-rico-preview-prefill-banners',
    title: 'Wizard — calendário rico + preview card + pre-fill rico + banners educativos + auto-fill SLA + urgência monotônica',
    summary: '12 features pra 100% paridade vs legacy: ' +
             '(1) Render requests do user no calendar (cor por status, badge "✓ Título"). ' +
             '(2) Render batch local nos cells ("✦ No seu lote"). ' +
             '(3) Preview modal ao clicar request: status badge 8 estados + urgência/OOC badges + metadata grid + ' +
             'descrição scroll + link clicável + botão "✏ Editar" se pending/converted. ' +
             '(4) Pre-fill RICO ao clicar slot: título + área + variação (matching por variationId), antes só date+OOC. ' +
             '(5) Botão "Hoje" no nav. ' +
             '(6) Bloqueio past click com alert nativo. ' +
             '(7) Banner educativo OOC longo ("Atenção: impacto..."). ' +
             '(8) Banner educativo URGÊNCIA longo. ' +
             '(9) Urgência monotônica em edit mode (não pode desmarcar). ' +
             '(10) Auto-fill dueDate pela SLA da variação. ' +
             '(11) Tooltips ricos no calendar. ' +
             '(12) Legenda visual ampliada (5 itens).',
    bucket: 'large', multiplierIds: ['integration'], profile: 'feature',
    hoursByCategory: { refinamento: 0.8, desenvolvimento: 4.0, testes: 1.0, documentacao: 0.4, implantacao: 0.3 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.56.1',
    releaseSlug: '20260524-portal-wizard-validation-inline-tooltips-sanitize',
    title: 'Wizard — info-tip + validação inline + bloqueio past manual + sanitização typeColor',
    summary: 'info-tip ℹ nos labels Setor responsável + Link de conteúdo. Bloqueio data passada via date input manual ' +
             '(alert + revert). ContentLink validação INLINE (form-error div) em vez de alert no submit. Sanitização ' +
             'typeColor: regex /^#[0-9A-Fa-f]{3,8}$/ valida antes de usar como style (evita CSS injection).',
    bucket: 'trivial', multiplierIds: ['security'], profile: 'feature',
    hoursByCategory: { refinamento: 0.05, desenvolvimento: 0.3, testes: 0.1, documentacao: 0.05, implantacao: 0.05 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.57.0',
    releaseSlug: '20260524-portal-wizard-cal-granularidades-week-day',
    title: 'Wizard — calendário 3 granularidades (Mês/Semana/Dia)',
    summary: '_state.calGran + granularity switcher (3 botões). Header dinâmico (mês+ano OU range semana OU "DD MMM ' +
             'YYYY"). Nav prev/next respeita granularidade. Day-of-week labels só em month/week. Grid 7 cols vs 1 col. ' +
             'Reusa mesma lógica de cells (slot/request/batch render) em todas.',
    bucket: 'medium', multiplierIds: ['integration'], profile: 'feature',
    hoursByCategory: { refinamento: 0.3, desenvolvimento: 1.5, testes: 0.4, documentacao: 0.2, implantacao: 0.1 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.57.1',
    releaseSlug: '20260524-portal-wizard-success-dinamica-batchId-consolidado',
    title: 'Wizard — success view dinâmica + batchId metadata + notifyTeam batch consolidado',
    summary: 'Success view 3 variações (Auto-aceito / Urgente / Normal). batchId/batchIndex/batchTotal nos docs do ' +
             'lote (paridade legacy). notifyTeam consolidado pra lote: 1 email com "N solicitações em conjunto" + ' +
             'flag isBatch.',
    bucket: 'small', multiplierIds: [], profile: 'feature',
    hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.5, testes: 0.15, documentacao: 0.1, implantacao: 0.05 },
    module: 'requests', modules: ['requests', 'portal'],
  },
  {
    releaseVersion: '4.57.2',
    releaseSlug: '20260524-portal-wizard-fix-sla-hint-slaDays',
    title: 'Wizard fix — SLA hint usar slaDays (não só sla)',
    summary: 'Bateria E2E executada pelo Claude pegou: refreshSla() no Step 3 ainda lia v.sla diretamente (esquecido ' +
             'em v4.54.5). Aceita slaDays || sla. Bateria completa rodada (40+ cenários): auth/tema, Step 1 (recent ' +
             'banner, info-tip, edit mode), Step 2 (3 granularidades, click past alert, click slot pre-fill, click ' +
             'vazio OOC), Step 3 (variação + SLA hint após fix), Step 4 (summary, urgência+banner, submit dinâmico), ' +
             'edit, batch, pill em todos steps. Todos PASS.',
    bucket: 'small', multiplierIds: ['investigation'], profile: 'bugfix',
    hoursByCategory: { refinamento: 0.1, desenvolvimento: 0.2, testes: 0.6, documentacao: 0.2, implantacao: 0.05 },
    module: 'requests', modules: ['requests', 'portal'],
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
  let totalH = 0;
  for (const e of ENTRIES) {
    const exists = await db.collection(COLLECTION).where('releaseVersion','==',e.releaseVersion).limit(1).get();
    if (!exists.empty) { console.log(`= skip ${e.releaseVersion}`); continue; }
    const finalHours = computeHours(e.hoursByCategory, e.multiplierIds, AI_ASSIST);
    const now = FV.serverTimestamp();
    const doc = {
      entryType: 'release', ...e,
      aiAssistanceMultiplier: AI_ASSIST,
      hourlyRate: HOURLY_RATE,
      totalHours: Math.round(finalHours * 100) / 100,
      totalCost: Math.round(finalHours * HOURLY_RATE * 100) / 100,
      status: 'approved',
      completedAt: now,
      createdAt: now, createdBy: RENE_UID, updatedAt: now,
    };
    const ref = await db.collection(COLLECTION).add(doc);
    totalH += doc.totalHours;
    console.log(`+ ${e.releaseVersion.padEnd(10)} (${doc.totalHours}h R$${doc.totalCost}) → ${ref.id}`);
  }
  console.log(`\n📊 TOTAL: ${Math.round(totalH * 100) / 100}h / R$ ${Math.round(totalH * HOURLY_RATE * 100) / 100}`);
  process.exit(0);
})();
