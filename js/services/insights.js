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
 *   indexKey       — chave do índice/widget ancorado (ex: 'sla90', 'topPages').
 *                    null/vazio = insight geral do dashboard (não ancorado a widget)
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
 *   aiOriginal     — { title, observation, ... } — payload original da IA (audit trail
 *                    quando humano edita sugestão ai-generated → vira ai-edited)
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

/** Lista insights com filtros opcionais.
 *
 * IMPORTANTE — conceito de histórico:
 * Cada insight tem 2 datas distintas:
 *   - createdAt: quando o insight foi ESCRITO (audit, imutável)
 *   - periodFrom/periodTo: o PERÍODO DE DADOS que o insight analisou
 *
 * Por padrão, traz TODOS os insights do dashboard/widget (histórico completo),
 * ordenados por createdAt desc (mais recente primeiro). Insights antigos sobre
 * o mesmo widget continuam visíveis como contexto histórico.
 *
 * Pra filtrar só os que cobrem um período específico, passe periodOverlap=true
 * junto com periodFrom/periodTo. Filtra por intersecção de períodos cobertos
 * (não por createdAt) — semântica correta de "insights aplicáveis ao período".
 *
 * @param {Object} opts
 * @param {string} opts.dashboard - chave do dashboard
 * @param {string|null} opts.indexKey - 'general' = só gerais; string = só desse índice;
 *   undefined = todos (gerais + por índice)
 * @param {Date} [opts.periodFrom] - usado com periodOverlap=true
 * @param {Date} [opts.periodTo]   - usado com periodOverlap=true
 * @param {boolean} [opts.periodOverlap=false] - quando true, filtra por intersecção
 *   de períodos cobertos (insight.periodFrom..periodTo intersecta com filtro)
 * @param {number} opts.max
 */
export async function fetchInsights({ dashboard, indexKey, periodFrom, periodTo, periodOverlap = false, max = 50 } = {}) {
  let q = query(collection(db, 'dashboard_insights'), orderBy('createdAt', 'desc'), limit(max));
  if (dashboard) q = query(q, where('dashboard', '==', dashboard));
  const snap = await getDocs(q);
  let items = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Filtro client-side por indexKey
  if (indexKey === 'general') {
    items = items.filter(i => !i.indexKey);
  } else if (indexKey) {
    items = items.filter(i => i.indexKey === indexKey);
  }

  // Filtro opcional por intersecção de período coberto (semantica correta).
  // Insight cobre [iFrom..iTo]. Filtro pede [periodFrom..periodTo].
  // Intersecta se: iTo >= periodFrom E iFrom <= periodTo.
  // Insights sem período definido (legacy/manual sem datas) sempre passam.
  if (periodOverlap && (periodFrom || periodTo)) {
    items = items.filter(i => {
      const iFrom = i.periodFrom?.toDate?.() || (i.periodFrom ? new Date(i.periodFrom) : null);
      const iTo   = i.periodTo?.toDate?.()   || (i.periodTo   ? new Date(i.periodTo)   : null);
      if (!iFrom && !iTo) return true; // sem período = sempre relevante
      if (periodFrom && iTo   && iTo   < periodFrom) return false; // insight termina antes do filtro
      if (periodTo   && iFrom && iFrom > periodTo)   return false; // insight começa depois do filtro
      return true;
    });
  }

  return items;
}

/** Determina se um insight cobre o período atual visualizado.
 * Usado pela UI pra marcar insights como "atuais" vs "históricos".
 */
export function insightCoversPeriod(insight, periodFrom, periodTo) {
  const iFrom = insight.periodFrom?.toDate?.() || (insight.periodFrom ? new Date(insight.periodFrom) : null);
  const iTo   = insight.periodTo?.toDate?.()   || (insight.periodTo   ? new Date(insight.periodTo)   : null);
  if (!iFrom && !iTo) return false;
  if (periodFrom && iTo   && iTo   < periodFrom) return false;
  if (periodTo   && iFrom && iFrom > periodTo)   return false;
  return true;
}

/** Formata período coberto pra string legível. */
export function formatInsightPeriod(insight) {
  const iFrom = insight.periodFrom?.toDate?.() || (insight.periodFrom ? new Date(insight.periodFrom) : null);
  const iTo   = insight.periodTo?.toDate?.()   || (insight.periodTo   ? new Date(insight.periodTo)   : null);
  if (!iFrom && !iTo) return null;
  const fmt = d => d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '?';
  if (iFrom && iTo) return `${fmt(iFrom)} → ${fmt(iTo)}`;
  if (iFrom) return `desde ${fmt(iFrom)}`;
  return `até ${fmt(iTo)}`;
}

/** Cria insight. Retorna id. */
export async function createInsight(data) {
  if (!data?.title?.trim()) throw new Error('Título obrigatório.');
  if (!data?.dashboard) throw new Error('Dashboard obrigatório.');
  const ref = doc(collection(db, 'dashboard_insights'));
  const payload = {
    dashboard:      data.dashboard,
    indexKey:       data.indexKey || null,  // ancorado a widget específico ou null = geral
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
    aiOriginal:     data.aiOriginal || null,  // payload original quando vem da IA (audit trail)
    createdBy:      { uid: uid(), name: userName() },
    createdAt:      serverTimestamp(),
    updatedAt:      serverTimestamp(),
  };
  await setDoc(ref, payload);
  await auditLog('insight.create', 'dashboard_insights', ref.id, { dashboard: data.dashboard, title: payload.title });
  return ref.id;
}

/** Atualiza insight existente.
 * Quando user edita insight com source='ai-generated', o caller deve setar
 * source: 'ai-edited' e aiOriginal: <payload original> pra preservar audit trail.
 */
export async function updateInsight(id, patch) {
  if (!id) throw new Error('id obrigatório');
  const allowed = ['title','observation','recommendation','type','impact','tags','source','indexKey','aiOriginal'];
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
 * Sugere insights via IA chamando o agente bi-insights-analyst do IA Hub.
 *
 * Fluxo:
 * 1. Localiza o agente registrado em ai_agents (seedId='bi-insights-analyst')
 * 2. Monta payload JSON estruturado: { dashboard, scope, indexKey, period, snapshot, filters }
 * 3. Chama runAgent(agentId, jsonPayload) — usa system prompt cacheado do agente
 * 4. Parseia a resposta JSON e devolve array de insights NÃO PERSISTIDOS
 *    (caller decide salvar via createInsight com source='ai-generated')
 *
 * Se o agente não foi seedado ainda (Hub vazio), retorna null e UI
 * mostra "Agente bi-insights-analyst não configurado. Vá em IA Hub → Seed".
 *
 * @param {Object} ctx
 * @param {string} ctx.dashboard           — chave do dashboard (obrigatório)
 * @param {string|null} ctx.indexKey       — chave do widget; null = análise geral
 * @param {string} ctx.scope               — 'widget' | 'dashboard' | 'cross-dashboard'
 * @param {Date}   ctx.periodFrom
 * @param {Date}   ctx.periodTo
 * @param {string} ctx.periodLabel         — ex: "Últimos 30 dias"
 * @param {Object} ctx.snapshot            — dados resumidos do dashboard/widget
 * @param {Object} ctx.filters             — snapshot dos filtros aplicados
 * @param {Object} [ctx.previousPeriod]    — opcional, comparação
 * @returns {Promise<Array<insight>|null>}
 */
export async function suggestInsightsViaAi(ctx) {
  if (!ctx?.dashboard) throw new Error('dashboard obrigatório');
  const scope = ctx.scope || (ctx.indexKey ? 'widget' : 'dashboard');

  // 1) Localiza o agente seedado
  const { fetchAgents } = await import('./agents.js');
  const agents = await fetchAgents();
  const agent = agents.find(a =>
    a.migratedFrom?.systemSeed === 'bi-insights-analyst' && a.active
  );
  if (!agent) {
    console.warn('[insights] Agente bi-insights-analyst não encontrado. Rode seed em IA Hub.');
    return null;
  }

  // 2) Monta payload
  const payload = {
    dashboard: ctx.dashboard,
    scope,
    indexKey: ctx.indexKey || null,
    period: {
      from:  ctx.periodFrom?.toISOString?.() || null,
      to:    ctx.periodTo?.toISOString?.()   || null,
      label: ctx.periodLabel || null,
    },
    snapshot: ctx.snapshot || {},
    filters:  ctx.filters  || {},
    ...(ctx.previousPeriod ? { previousPeriod: ctx.previousPeriod } : {}),
  };

  // 3) Chama runAgent (usa Cloud Function callLLM, que tem cache + audit + rate limit)
  let raw;
  try {
    const { runAgent } = await import('./agents.js');
    const result = await runAgent(agent.id, JSON.stringify(payload, null, 2), {
      moduleId: 'insights',
      source: `dashboard-insights-${ctx.dashboard}`,
    });
    raw = result?.text || result?.content || '';
  } catch (e) {
    console.error('[insights] runAgent falhou:', e.message);
    throw new Error(`IA falhou: ${e.message}`);
  }

  // 4) Parseia resposta (espera array JSON; tolera fences ```json se LLM escapar)
  let suggestions = [];
  try {
    const cleaned = String(raw)
      .replace(/```json\s*/gi, '')
      .replace(/```\s*$/g, '')
      .trim();
    suggestions = JSON.parse(cleaned);
    if (!Array.isArray(suggestions)) suggestions = [];
  } catch (e) {
    console.warn('[insights] Resposta IA não é JSON válido:', raw.slice(0, 200));
    return [];
  }

  // 5) Sanitiza cada sugestão pra estrutura esperada
  return suggestions.map(s => ({
    title:          String(s.title || '').slice(0, 200),
    observation:    String(s.observation || '').slice(0, 4000),
    recommendation: String(s.recommendation || '').slice(0, 4000),
    type:           ['positive','negative','warning','opportunity','neutral'].includes(s.type) ? s.type : 'neutral',
    impact:         ['high','medium','low'].includes(s.impact) ? s.impact : 'medium',
    indexKey:       s.indexKey || ctx.indexKey || null,
    source:         'ai-generated',
    // Guarda payload original pra audit trail caso humano edite depois
    aiOriginal:     {
      title:          s.title || '',
      observation:    s.observation || '',
      recommendation: s.recommendation || '',
      type:           s.type || 'neutral',
      impact:         s.impact || 'medium',
      generatedAt:    new Date().toISOString(),
      agentId:        agent.id,
      agentName:      agent.name,
    },
  })).filter(s => s.title); // descarta sugestões sem título
}

/* ════════════════════════════════════════════════════════════
   Helpers de exportação (chamados pelos exportPDF/XLSX dos dashboards)
   ════════════════════════════════════════════════════════════ */

/** Agrupa insights por indexKey (gerais primeiro, depois por widget).
 * Retorna [{ groupKey, groupLabel, items }]
 */
export function groupInsightsByIndex(insights, widgetLabels = {}) {
  const groups = new Map();
  insights.forEach(ins => {
    const key = ins.indexKey || '__general__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ins);
  });
  // Ordena: gerais primeiro, depois por label do widget alfabético
  const ordered = [];
  if (groups.has('__general__')) {
    ordered.push({
      groupKey: 'general',
      groupLabel: 'Análise Geral do Dashboard',
      items: groups.get('__general__'),
    });
    groups.delete('__general__');
  }
  const widgetGroups = Array.from(groups.entries()).map(([key, items]) => ({
    groupKey: key,
    groupLabel: widgetLabels[key] || `Widget: ${key}`,
    items,
  }));
  widgetGroups.sort((a, b) => a.groupLabel.localeCompare(b.groupLabel));
  return ordered.concat(widgetGroups);
}

/** Formata insights pra texto em PDF (linhas legíveis), agrupados por widget.
 * @param {Array} insights
 * @param {Object} widgetLabels - mapa indexKey -> label legível (ex: { sla90: 'SLA 90%' })
 */
export function insightsToPdfRows(insights, widgetLabels = {}) {
  if (!insights?.length) return [];
  const groups = groupInsightsByIndex(insights, widgetLabels);
  const rows = [];
  let n = 0;
  groups.forEach((group, gi) => {
    rows.push({
      label: (gi > 0 ? '\n' : '') + `▸ ${group.groupLabel} (${group.items.length})`,
      value: '',
      isGroupHeader: true,
    });
    group.items.forEach(ins => {
      n++;
      const type = INSIGHT_TYPES.find(t => t.key === ins.type) || INSIGHT_TYPES[4];
      const sourceLabel = ins.source === 'ai-generated' ? '🤖 IA'
        : ins.source === 'ai-edited' ? '🤖✎ IA editada'
        : '👤 Manual';
      rows.push({
        label: `${n}. ${type.icon} ${ins.title}`,
        value: '',
        isHeader: true,
      });
      if (ins.observation) rows.push({ label: '   Observação', value: ins.observation });
      if (ins.recommendation) rows.push({ label: '   Recomendação', value: ins.recommendation });
      rows.push({ label: '   Impacto', value: IMPACT_LEVELS.find(x => x.key === ins.impact)?.label || '—' });
      const periodCovered = formatInsightPeriod(ins);
      if (periodCovered) rows.push({ label: '   Período coberto', value: periodCovered });
      rows.push({ label: '   Origem', value: sourceLabel });
      rows.push({ label: '   Escrito por', value: `${ins.createdBy?.name || '—'} em ${formatDate(ins.createdAt)}` });
    });
  });
  return rows;
}

/** Formata insights pra linhas de XLSX, com colunas Widget + Período Coberto + Source.
 * @param {Array} insights
 * @param {Object} widgetLabels - mapa indexKey -> label legível
 */
export function insightsToXlsxRows(insights, widgetLabels = {}) {
  if (!insights?.length) return [];
  const sourceLabel = (s) => s === 'ai-generated' ? 'IA' : s === 'ai-edited' ? 'IA editada' : 'Manual';
  return insights.map(ins => ({
    'Widget':           ins.indexKey ? (widgetLabels[ins.indexKey] || ins.indexKey) : '— Geral —',
    'Tipo':             INSIGHT_TYPES.find(t => t.key === ins.type)?.label || '—',
    'Impacto':          IMPACT_LEVELS.find(x => x.key === ins.impact)?.label || '—',
    'Título':           ins.title,
    'Observação':       ins.observation || '',
    'Recomendação':     ins.recommendation || '',
    'Tags':             (ins.tags || []).join(', '),
    'Origem':           sourceLabel(ins.source),
    'Período coberto':  formatInsightPeriod(ins) || '—',
    'Autor':            ins.createdBy?.name || '—',
    'Escrito em':       formatDate(ins.createdAt),
  }));
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate?.() || new Date(ts);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
