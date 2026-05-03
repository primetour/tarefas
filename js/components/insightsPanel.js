/**
 * PRIMETOUR — Insights Panel Component
 *
 * Painel reutilizável pra qualquer dashboard. Lista insights existentes,
 * permite adicionar/editar/remover, e oferece botão pra IA sugerir.
 *
 * Uso:
 *   import { mountInsightsPanel } from '../components/insightsPanel.js';
 *
 *   mountInsightsPanel({
 *     container,                       // HTMLElement onde renderizar
 *     dashboard: 'produtividade',      // chave do dashboard (ver DASHBOARDS)
 *     periodFrom, periodTo,            // Date instances (do filtro do dash)
 *     filters: {...},                  // snapshot dos filtros aplicados
 *     enableAi: true,                  // mostra botão IA (placeholder por ora)
 *   });
 *
 * Dispara evento custom 'insights:changed' no container quando muda.
 */

import { toast } from './toast.js';
import {
  fetchInsights, createInsight, updateInsight, deleteInsight,
  suggestInsightsViaAi,
  INSIGHT_TYPES, IMPACT_LEVELS, DASHBOARDS,
} from '../services/insights.js';

const esc = s => String(s||'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const fmtDate = ts => {
  if (!ts) return '—';
  const d = ts?.toDate?.() || new Date(ts);
  return d.toLocaleDateString('pt-BR');
};

export async function mountInsightsPanel(opts) {
  const { container, dashboard, periodFrom, periodTo, filters, enableAi = true } = opts;
  if (!container || !dashboard) {
    console.warn('[insightsPanel] container e dashboard obrigatórios');
    return;
  }

  const dashInfo = DASHBOARDS[dashboard] || { label: dashboard, icon: '📊' };
  let insights = [];

  async function refresh() {
    try {
      insights = await fetchInsights({ dashboard, periodFrom, periodTo, max: 50 });
    } catch (e) {
      console.error('[insightsPanel] fetch failed:', e);
      insights = [];
    }
    render();
  }

  function render() {
    container.innerHTML = `
      <div class="card" style="padding:18px 20px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
          <div>
            <h3 style="margin:0;font-size:1rem;font-weight:600;color:var(--text-primary);">
              💡 Insights & Observações
            </h3>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
              ${insights.length} ${insights.length === 1 ? 'insight registrado' : 'insights registrados'} ·
              ${dashInfo.icon} ${dashInfo.label}
              ${periodFrom ? ' · ' + fmtDate(periodFrom) : ''}${periodTo ? ' → ' + fmtDate(periodTo) : ''}
            </div>
          </div>
          <div style="display:flex;gap:6px;">
            ${enableAi ? `
              <button class="btn btn-secondary btn-sm" id="ip-suggest-ai" title="Pedir IA pra sugerir insights baseado nos dados">
                🤖 Sugerir via IA
              </button>
            ` : ''}
            <button class="btn btn-primary btn-sm" id="ip-add">+ Adicionar insight</button>
          </div>
        </div>

        <div id="ip-list">
          ${renderList()}
        </div>
      </div>
    `;
    bindEvents();
  }

  function renderList() {
    if (!insights.length) {
      return `
        <div style="text-align:center;padding:30px 20px;color:var(--text-muted);
          background:var(--bg-surface);border:1px dashed var(--border-subtle);border-radius:var(--radius-md);">
          <div style="font-size:1.75rem;margin-bottom:8px;opacity:.5;">💡</div>
          <div style="font-size:0.875rem;margin-bottom:4px;">Nenhum insight registrado ainda.</div>
          <div style="font-size:0.75rem;">
            Adicione observações sobre os dados — exportadas em PDF/XLSX junto com as métricas.
          </div>
        </div>
      `;
    }
    return `<div style="display:flex;flex-direction:column;gap:10px;">${insights.map(renderItem).join('')}</div>`;
  }

  function renderItem(ins) {
    const type = INSIGHT_TYPES.find(t => t.key === ins.type) || INSIGHT_TYPES[4];
    const impact = IMPACT_LEVELS.find(x => x.key === ins.impact) || IMPACT_LEVELS[1];
    return `
      <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
        border-left:3px solid ${type.color};border-radius:var(--radius-md);padding:14px 16px;">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">
              <span style="font-size:0.6875rem;font-weight:600;padding:2px 8px;border-radius:var(--radius-full);
                background:${type.color}22;color:${type.color};">
                ${type.icon} ${esc(type.label)}
              </span>
              <span style="font-size:0.6875rem;font-weight:600;padding:2px 8px;border-radius:var(--radius-full);
                background:${impact.color}22;color:${impact.color};">
                Impacto ${esc(impact.label)}
              </span>
              ${ins.source === 'ai-generated' ? `
                <span style="font-size:0.6875rem;font-weight:600;padding:2px 8px;border-radius:var(--radius-full);
                  background:rgba(167,139,250,.15);color:#A78BFA;">🤖 IA</span>
              ` : ''}
            </div>
            <div style="font-size:0.9375rem;font-weight:600;color:var(--text-primary);margin-bottom:6px;">
              ${esc(ins.title)}
            </div>
            ${ins.observation ? `
              <div style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.55;margin-bottom:6px;
                white-space:pre-wrap;">${esc(ins.observation)}</div>
            ` : ''}
            ${ins.recommendation ? `
              <div style="background:rgba(34,197,94,.07);border-left:2px solid #22C55E;
                padding:8px 12px;border-radius:0 4px 4px 0;font-size:0.8125rem;color:var(--text-secondary);
                line-height:1.55;margin-bottom:6px;white-space:pre-wrap;">
                <strong style="color:#22C55E;">Recomendação:</strong> ${esc(ins.recommendation)}
              </div>
            ` : ''}
            <div style="font-size:0.6875rem;color:var(--text-muted);">
              ${esc(ins.createdBy?.name || '—')} · ${fmtDate(ins.createdAt)}
              ${(ins.tags || []).length ? ` · ${ins.tags.map(t => `<span style="background:var(--bg-elevated);padding:1px 6px;border-radius:3px;">${esc(t)}</span>`).join(' ')}` : ''}
            </div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            <button class="btn btn-ghost btn-sm" data-act="ip-edit" data-id="${esc(ins.id)}" title="Editar">✎</button>
            <button class="btn btn-ghost btn-sm" data-act="ip-del" data-id="${esc(ins.id)}" title="Remover" style="color:var(--color-danger);">✕</button>
          </div>
        </div>
      </div>
    `;
  }

  function bindEvents() {
    container.querySelector('#ip-add')?.addEventListener('click', () => openForm());
    container.querySelector('#ip-suggest-ai')?.addEventListener('click', async () => {
      try {
        const suggestions = await suggestInsightsViaAi({ dashboard, periodFrom, periodTo, filters });
        if (!suggestions || !suggestions.length) {
          toast.info('IA de insights ainda não configurada para este dashboard. Adicione manualmente.');
          return;
        }
        toast.success(`${suggestions.length} sugestões geradas pela IA.`);
        await refresh();
        container.dispatchEvent(new CustomEvent('insights:changed'));
      } catch (e) {
        console.error('[insightsPanel] AI suggest failed:', e);
        toast.error('Erro ao chamar IA: ' + (e.message || ''));
      }
    });
    container.querySelectorAll('[data-act="ip-edit"]').forEach(b => {
      b.addEventListener('click', () => {
        const ins = insights.find(x => x.id === b.dataset.id);
        if (ins) openForm(ins);
      });
    });
    container.querySelectorAll('[data-act="ip-del"]').forEach(b => {
      b.addEventListener('click', async () => {
        if (!confirm('Remover este insight?')) return;
        try {
          await deleteInsight(b.dataset.id);
          toast.success('Insight removido.');
          await refresh();
          container.dispatchEvent(new CustomEvent('insights:changed'));
        } catch (e) { toast.error('Erro: ' + (e.message || '')); }
      });
    });
  }

  function openForm(existing = null) {
    const isEdit = !!existing?.id;
    const m = document.createElement('div');
    m.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2000;
      display:flex;align-items:center;justify-content:center;padding:20px;`;
    m.innerHTML = `
      <div class="card" style="width:100%;max-width:560px;max-height:90vh;
        padding:0;overflow:hidden;display:flex;flex-direction:column;">
        <div style="padding:16px 22px;background:var(--bg-surface);
          border-bottom:1px solid var(--border-subtle);
          display:flex;justify-content:space-between;align-items:center;">
          <div style="font-weight:700;font-size:1rem;">
            💡 ${isEdit ? 'Editar' : 'Novo'} insight · ${dashInfo.icon} ${esc(dashInfo.label)}
          </div>
          <button id="ipf-close" style="border:none;background:none;cursor:pointer;font-size:1.25rem;color:var(--text-muted);">✕</button>
        </div>

        <div style="overflow-y:auto;flex:1;padding:18px 22px;display:flex;flex-direction:column;gap:14px;">
          <div>
            <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Título *</label>
            <input id="ipf-title" type="text" class="portal-field" style="width:100%;"
              maxlength="200" placeholder="Ex: SLA caiu 15% no setor Marketing"
              value="${esc(existing?.title || '')}">
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Tipo</label>
              <select id="ipf-type" class="filter-select" style="width:100%;">
                ${INSIGHT_TYPES.map(t => `<option value="${t.key}" ${(existing?.type || 'neutral') === t.key ? 'selected' : ''}>${t.icon} ${esc(t.label)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Impacto</label>
              <select id="ipf-impact" class="filter-select" style="width:100%;">
                ${IMPACT_LEVELS.map(x => `<option value="${x.key}" ${(existing?.impact || 'medium') === x.key ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}
              </select>
            </div>
          </div>

          <div>
            <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Observação (o que aconteceu) *</label>
            <textarea id="ipf-obs" class="portal-field" rows="4" maxlength="4000"
              placeholder="Descreva o achado nos dados..." style="width:100%;resize:vertical;">${esc(existing?.observation || '')}</textarea>
          </div>

          <div>
            <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Recomendação (o que fazer) <span style="font-weight:400;color:var(--text-muted);">opcional</span></label>
            <textarea id="ipf-rec" class="portal-field" rows="3" maxlength="4000"
              placeholder="Ação sugerida para corrigir/explorar este achado..." style="width:100%;resize:vertical;">${esc(existing?.recommendation || '')}</textarea>
          </div>

          <div>
            <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Tags <span style="font-weight:400;color:var(--text-muted);">separadas por vírgula, opcional</span></label>
            <input id="ipf-tags" type="text" class="portal-field" style="width:100%;"
              placeholder="ex: marketing, atraso, urgente"
              value="${esc((existing?.tags || []).join(', '))}">
          </div>
        </div>

        <div style="padding:14px 22px;border-top:1px solid var(--border-subtle);
          background:var(--bg-surface);display:flex;gap:10px;">
          <button class="btn btn-secondary" id="ipf-cancel" style="flex:1;">Cancelar</button>
          <button class="btn btn-primary" id="ipf-save" style="flex:2;font-weight:600;">
            💾 ${isEdit ? 'Salvar alterações' : 'Adicionar insight'}
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });
    document.getElementById('ipf-close')?.addEventListener('click', () => m.remove());
    document.getElementById('ipf-cancel')?.addEventListener('click', () => m.remove());

    document.getElementById('ipf-save')?.addEventListener('click', async () => {
      const title = document.getElementById('ipf-title').value.trim();
      if (!title) { toast.error('Título obrigatório.'); return; }
      const data = {
        dashboard,
        title,
        observation:    document.getElementById('ipf-obs').value.trim(),
        recommendation: document.getElementById('ipf-rec').value.trim(),
        type:           document.getElementById('ipf-type').value,
        impact:         document.getElementById('ipf-impact').value,
        tags:           document.getElementById('ipf-tags').value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 10),
        periodFrom, periodTo, filters,
      };
      try {
        if (isEdit) await updateInsight(existing.id, data);
        else await createInsight(data);
        toast.success(isEdit ? 'Insight atualizado.' : 'Insight adicionado.');
        m.remove();
        await refresh();
        container.dispatchEvent(new CustomEvent('insights:changed'));
      } catch (e) {
        toast.error('Erro: ' + (e.message || ''));
      }
    });
  }

  await refresh();
  // API pública: re-render manual
  return { refresh };
}
