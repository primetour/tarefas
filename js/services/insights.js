/**
 * PRIMETOUR — Dashboard Insights Service
 *
 * Insights são observações estruturadas em qualquer dashboard analítico:
 * - Manuais (analista digita)
 * - IA-gerados (agente IA Hub sugere — opcional)
 *
 * Best-practice BI:
 * - Estrutura: TÍTULO + OBSERVAÇÃO + RECOMENDAÇÃO + IMPACTO + TIPO
 * - Vinculados a um período (snapshot)
 * - Audit trail (autor, edits)
 * - Exportáveis em PDF/XLSX/PPT junto com os dados
 *
 * Schema collection `dashboard_insights/{id}`:
 *   dashboard      — chave do dashboard (produtividade, ga, nl, meta, portal, roteiro)
 *   title          — headline curto (max ~80 chars)
 *   observation    — o achado (texto livre)
 *   recommendation — ação proposta (opcional)
 *   type           — positive | negative | neutral | warning | opportunity
 *   impact         — low | medium | high
 *   periodFrom     — Date inicio do período coberto
 *   periodTo       — Date fim do período
 *   filters        — snapshot dos filtros (opcional)
 *   tags           — string[]
 *   source         — manual | ai-generated | ai-edited
 *   createdBy      — uid + name
 *   createdAt      — Timestamp
 *   updatedAt      — Timestamp
 */

import { db } from '../firebase.js';
import { store } from '../store.js';
import { auditLog } from '../auth/audit.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, where, limit, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const uid = () => store.get('currentUser')?.uid;
const userName = () => store.get('userProfile')?.name || store.get('currentUser')?.email || 'Usuário';

/* ─── Catálogo de dashboards conhecidos ─────────────────── */
export const DASHBOARDS = {
  'produtividade':    { label: 'Produtividade',           icon: '📊' },
  'ga':               { label: 'Google Analytics',        icon: '📈' },
  'nl':               { label: 'Newsletters',             icon: '📧' },
  'meta':             { label: 'Instagram (Meta)',        icon: '📷' },
  'portal':           { label: 'Portal de Dicas',         icon: '🌍' },
  'roteiro':          { label: 'Roteiros',                icon: '✈' },
  'painel-pessoal':   { label: 'Meu Painel',              icon: '🏠' },
  'csat':             { label: 'CSAT',                    icon: '★' },
  'ai-hub':           { label: 'IA Hub',                  icon: '🤖' },
  'site-audit':       { label: 'Auditoria de Sites',      icon: '🌐' },
};

export const INSIGHT_TYPES = [
  { key: 'positive',    label: 'Positivo',    color: '#22C55E', icon: '✅' },
  { key: 'negative',    label: 'Negativo',    color: '#EF4444', icon: '❌' },
  { key: 'warning',     label: 'Atenção',     color: '#F59E0B', icon: '⚠' },
  { key: 'opportunity', label: 'Oportunidade',color: '#3B82F6', icon: '💡' },
  { key: 'neutral',     label: 'Observação',  color: '#94A3B8', icon: '◯' },
];

export const IMPACT_LEVELS = [
  { key: 'high',   label: 'Alto',   color: '#EF4444' },
  { key: 'medium', label: 'Médio',  color: '#F59E0B' },
  { key: 'low',    label: 'Baixo',  color: '#94A3B8' },
];

/* ════════════════════════════════════════════════════════════
   CRUD
   ════════════════════════════════════════════════════════════ */

/** Lista insights com filtros opcionais. */
export async function fetchInsights({ dashboard, periodFrom, periodTo, max = 50 } = {}) {
  let q = query(collection(db, 'dashboard_insights'), orderBy('createdAt', 'desc'), limit(max));
  if (dashboard) q = query(q, where('dashboard', '==', dashboard));
  const snap = await getDocs(q);
  let items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // Filtro client-side por período (Firestore composite index seria overkill)
  if (periodFrom) items = items.filter(i => {
    const t = i.createdAt?.toDate?.() || new Date(0);
    return t >= periodFrom;
  });
  if (periodTo) items = items.filter(i => {
    const t = i.createdAt?.toDate?.() || new Date(0);
    return t <= periodTo;
  });
  return items;
}

/** Cria insight. Retorna id. */
export async function createInsight(data) {
  if (!data?.title?.trim()) throw new Error('Título obrigatório.');
  if (!data?.dashboard) throw new Error('Dashboard obrigatório.');
  const ref = doc(collection(db, 'dashboard_insights'));
  const payload = {
    dashboard:      data.dashboard,
    title:          String(data.title).trim().slice(0, 200),
    observation:    String(data.observation || '').trim().slice(0, 4000),
    recommendation: String(data.recommendation || '').trim().slice(0, 4000),
    type:           data.type || 'neutral',
    impact:         data.impact || 'medium',
    periodFrom:     data.periodFrom ? new Date(data.periodFrom) : null,
    periodTo:       data.periodTo   ? new Date(data.periodTo)   : null,
    filters:        data.filters || null,
    tags:           Array.isArray(data.tags) ? data.tags.slice(0, 10) : [],
    source:         data.source || 'manual',
    createdBy:      { uid: uid(), name: userName() },
    createdAt:      serverTimestamp(),
    updatedAt:      serverTimestamp(),
  };
  await setDoc(ref, payload);
  await auditLog('insight.create', 'dashboard_insights', ref.id, { dashboard: data.dashboard, title: payload.title });
  return ref.id;
}

/** Atualiza insight existente. */
export async function updateInsight(id, patch) {
  if (!id) throw new Error('id obrigatório');
  const allowed = ['title','observation','recommendation','type','impact','tags','source'];
  const updates = { updatedAt: serverTimestamp() };
  for (const k of allowed) if (patch[k] !== undefined) updates[k] = patch[k];
  if (typeof updates.title === 'string')          updates.title = updates.title.trim().slice(0, 200);
  if (typeof updates.observation === 'string')    updates.observation = updates.observation.trim().slice(0, 4000);
  if (typeof updates.recommendation === 'string') updates.recommendation = updates.recommendation.trim().slice(0, 4000);
  await updateDoc(doc(db, 'dashboard_insights', id), updates);
  await auditLog('insight.update', 'dashboard_insights', id, {});
}

/** Remove insight (apenas autor ou admin). Rule valida. */
export async function deleteInsight(id) {
  await deleteDoc(doc(db, 'dashboard_insights', id));
  await auditLog('insight.delete', 'dashboard_insights', id, {});
}

/* ════════════════════════════════════════════════════════════
   IA Hook (conectável — não implementa lógica IA, só estrutura)
   ════════════════════════════════════════════════════════════ */

/**
 * Sugere insights via IA baseado no contexto do dashboard.
 *
 * Hoje retorna null (não implementado). Quando agente IA Hub
 * for criado e mapeado em ai_skills, este método chamará
 * callLLMSecure com agentId='dashboard-insights-{dashboard}'
 * e parseará a resposta em estrutura {title, observation, ...}.
 *
 * Por agora, estrutura está pronta — UI mostra botão "Sugerir via IA"
 * que aciona este método. Se retornar null, mostra mensagem
 * "IA não configurada". Quando habilitado, sugestões viram
 * insights com source='ai-generated'.
 *
 * @param {Object} ctx - { dashboard, periodFrom, periodTo, filters, snapshot }
 *   snapshot: dados resumidos do dashboard (ex: { totalTasks: 250, sla90: 87 })
 * @returns {Array<insight>|null}
 */
export async function suggestInsightsViaAi(ctx) {
  // PLACEHOLDER — não implementa IA por enquanto.
  // Quando ativar:
  //   const { callLLMSecure } = await import('./aiSecure.js');
  //   const prompt = buildPromptFromContext(ctx);
  //   const r = await callLLMSecure({
  //     agentId: `dashboard-insights-${ctx.dashboard}`,
  //     systemPrompt: 'Você analisa dashboards e gera insights estruturados em JSON...',
  //     userMessage: prompt,
  //     module: 'insights', source: 'dashboard-insights',
  //   });
  //   return parseInsightsFromAiResponse(r.text);
  return null;
}

/* ════════════════════════════════════════════════════════════
   Helpers de exportação (chamados pelos exportPDF/XLSX dos dashboards)
   ════════════════════════════════════════════════════════════ */

/** Formata insights pra texto em PDF (linhas legíveis). */
export function insightsToPdfRows(insights) {
  if (!insights?.length) return [];
  const rows = [];
  insights.forEach((ins, i) => {
    const type = INSIGHT_TYPES.find(t => t.key === ins.type) || INSIGHT_TYPES[4];
    rows.push({
      label: `${i + 1}. ${type.icon} ${ins.title}`,
      value: '',
      isHeader: true,
    });
    if (ins.observation) rows.push({ label: '   Observação', value: ins.observation });
    if (ins.recommendation) rows.push({ label: '   Recomendação', value: ins.recommendation });
    rows.push({ label: '   Impacto', value: (IMPACT_LEVELS.find(x => x.key === ins.impact)?.label || '—') });
    rows.push({ label: '   Por', value: `${ins.createdBy?.name || '—'} · ${formatDate(ins.createdAt)}` });
  });
  return rows;
}

/** Formata insights pra linhas de XLSX. */
export function insightsToXlsxRows(insights) {
  if (!insights?.length) return [];
  return insights.map(ins => ({
    'Tipo':           INSIGHT_TYPES.find(t => t.key === ins.type)?.label || '—',
    'Impacto':        IMPACT_LEVELS.find(x => x.key === ins.impact)?.label || '—',
    'Título':         ins.title,
    'Observação':     ins.observation || '',
    'Recomendação':   ins.recommendation || '',
    'Tags':           (ins.tags || []).join(', '),
    'Origem':         ins.source === 'manual' ? 'Manual' : 'IA',
    'Autor':          ins.createdBy?.name || '—',
    'Data':           formatDate(ins.createdAt),
  }));
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate?.() || new Date(ts);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
