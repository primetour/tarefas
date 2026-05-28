const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const HOURLY_RATE = 150, AI_ASSIST = 0.50;
const RENE_UID = 'OvnFxqaUXMNm87B6rrewbCSePMl2';

const ENTRY = {
  releaseVersion: '4.63.27',
  releaseSlug: '20260528-templates-edit-unarchive',
  title: 'Features A10 (Editar metadata) + A13 (Desarquivar) na Biblioteca',
  summary: 'Fecha 2 gaps HIGH confirmados pela auditoria UX manual v4.63.26 ' +
           '(Agent matriz + E2E Chrome MCP) — botões "Editar" e "Desarquivar" ' +
           'não existiam na Biblioteca, apenas archive one-way + duplicate. ' +
           'A10 Editar metadata: botão ✎ Editar no card active (canManage) → ' +
           'modal espelha padrão _openDuplicateModal pra consistência UX, ' +
           'edita name + flag isDefault, validação nome obrigatório, ' +
           'sem-mudança fecha sem submit, foco auto+select all no input, ' +
           're-render local pós-save (preserva filtros via _state). ' +
           'A13 Desarquivar: botão ↩ Desarquivar (primary, destaque) só ' +
           'visível na view archived. Service novo unarchiveTemplate em ' +
           'templates.js: status=active + unarchivedAt/By novos (PRESERVA ' +
           'archivedAt/By pra rastro histórico — não revisionismo §11.p). ' +
           'Modal confirm (não-danger) + toast success consistente com ' +
           'archive flow. Audit logs templates.update + templates.unarchive ' +
           '(severity info). ' +
           'E2E Chrome MCP real validou tudo: ✎ Editar abrindo, save com ' +
           'mudança de nome refletindo no card + Firestore + toast, cancel ' +
           'sem-mudança fechando sem submit, archive Banco + filtro Archived ' +
           '+ ↩ Desarquivar + confirm + Banco volta pra Active tab. Firestore ' +
           'confirmou status final active + archivedAt preservado + ' +
           'unarchivedAt novo + 3 audit logs (update + archive + unarchive). ' +
           'Sprint v4.63.22-27 fecha 8 releases com 2 features novas + 3 ' +
           'fixes HIGH + 3 lições CLAUDE.md + cleanup prod crítico Lazer.',
  bucket: 'small', multiplierIds: ['integration'], profile: 'feature',
  hoursByCategory: { refinamento: 0.5, desenvolvimento: 1.5, testes: 1.0, documentacao: 0.3, implantacao: 0.2 },
  module: 'templates', modules: ['templates'],
};

function computeHours(b, mids, ai) {
  const t = Object.values(b).reduce((a, x) => a + x, 0);
  const m = (mids || []).map(id => ({ investigation: .3, migration: .2, pdf: .15, integration: .2, security: .25, pure_refactor: -.2 }[id] || 0)).reduce((a, x) => a + x, 0);
  return t * (1 + m) * ai;
}

(async () => {
  const ex = await db.collection('dev_hours').where('releaseVersion', '==', ENTRY.releaseVersion).limit(1).get();
  if (!ex.empty) { console.log('= skip'); process.exit(0); }
  const h = computeHours(ENTRY.hoursByCategory, ENTRY.multiplierIds, AI_ASSIST);
  const now = FV.serverTimestamp();
  const doc = { entryType: 'release', ...ENTRY, aiAssistanceMultiplier: AI_ASSIST, hourlyRate: HOURLY_RATE,
    totalHours: Math.round(h * 100) / 100, totalCost: Math.round(h * HOURLY_RATE * 100) / 100,
    status: 'approved', completedAt: now, createdAt: now, createdBy: RENE_UID, updatedAt: now };
  const ref = await db.collection('dev_hours').add(doc);
  console.log(`+ ${ENTRY.releaseVersion} (${doc.totalHours}h R$${doc.totalCost}) -> ${ref.id}`);
  process.exit(0);
})();
