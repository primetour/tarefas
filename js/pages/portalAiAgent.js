/**
 * PRIMETOUR — Portal de Dicas: Agente de IA (E10)
 * Identifica dicas vencidas/desatualizadas e sugere atualizações via Claude
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import {
  fetchTips, fetchDestinations, fetchAreas, saveTip, SEGMENTS,
} from '../services/portal.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

export async function renderPortalAiAgent(container) {
  if (!store.canManagePortal()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Agente de IA</h1>
        <p class="page-subtitle">Revisão e atualização assistida de dicas vencidas</p>
      </div>
    </div>
    <div id="agent-body">${loadingHtml('Verificando dicas…')}</div>
  `;

  await loadAgent();
}

async function loadAgent() {
  const body = document.getElementById('agent-body');
  if (!body) return;

  try {
    const [tips, dests] = await Promise.all([fetchTips(), fetchDestinations()]);
    const now  = new Date();
    const in60 = new Date(+now + 60 * 86400_000);

    const flagged = tips.flatMap(tip => {
      const dest = dests.find(d => d.id === tip.destinationId);
      return SEGMENTS
        .map(seg => {
          const sd = tip.segments?.[seg.key];
          if (!sd?.hasExpiry || !sd?.expiryDate) return null;
          const exp = new Date(sd.expiryDate);
          const status = exp < now ? 'expired' : exp <= in60 ? 'expiring' : null;
          if (!status) return null;
          return { tip, dest, seg, sd, exp, status };
        })
        .filter(Boolean);
    });

    if (!flagged.length) {
      body.innerHTML = `
        <div class="card" style="padding:48px;text-align:center;">
          <div style="font-size:3rem;margin-bottom:16px;">✅</div>
          <div style="font-size:1.125rem;font-weight:700;margin-bottom:8px;">Tudo em dia!</div>
          <div style="color:var(--text-muted);font-size:0.9375rem;">
            Nenhuma dica vencida ou próxima do vencimento nos próximos 60 dias.
          </div>
        </div>`;
      return;
    }

    // Group by tip
    const byTip = {};
    flagged.forEach(f => {
      const key = f.tip.id || f.tip.destinationId;
      if (!byTip[key]) byTip[key] = { tip: f.tip, dest: f.dest, items: [] };
      byTip[key].items.push(f);
    });

    body.innerHTML = `
      <!-- Summary banner -->
      <div style="padding:14px 18px;background:#F59E0B12;border:1px solid #F59E0B30;
        border-radius:var(--radius-md);margin-bottom:20px;display:flex;align-items:center;gap:12px;">
        <span style="font-size:1.5rem;">🤖</span>
        <div style="flex:1;">
          <div style="font-weight:700;font-size:0.9375rem;">
            ${flagged.length} segmento${flagged.length>1?'s':''} requer${flagged.length>1?'em':''} atenção
            em ${Object.keys(byTip).length} dica${Object.keys(byTip).length>1?'s':''}
          </div>
          <div style="font-size:0.8125rem;color:var(--text-muted);">
            Use o agente para gerar sugestões de atualização com IA, revise e aprove.
          </div>
        </div>
        <button class="btn btn-primary btn-sm" id="agent-run-all">
          ✨ Analisar todos
        </button>
      </div>

      <!-- Cards por dica -->
      <div id="agent-cards" style="display:flex;flex-direction:column;gap:16px;">
        ${Object.entries(byTip).map(([key, group]) => tipCard(key, group)).join('')}
      </div>
    `;

    // Bind individual analyze buttons
    document.getElementById('agent-cards')?.querySelectorAll('.agent-analyze-btn').forEach(btn => {
      btn.addEventListener('click', () => analyzeOne(btn.dataset.tipKey));
    });

    // Bind "analisar todos"
    document.getElementById('agent-run-all')?.addEventListener('click', async () => {
      const keys = Object.keys(byTip);
      for (const key of keys) {
        await analyzeOne(key);
      }
    });

    // Store in closure for analyzeOne
    window._agentData = byTip;

  } catch(e) {
    body.innerHTML = `<div style="padding:48px;text-align:center;color:var(--text-muted);">
      Erro: ${esc(e.message)}</div>`;
  }
}

function tipCard(key, group) {
  const destLabel = [group.dest?.city, group.dest?.country].filter(Boolean).join(', ') || '—';
  const hasExpired  = group.items.some(i => i.status === 'expired');
  const hasExpiring = group.items.some(i => i.status === 'expiring');

  return `
    <div class="card agent-tip-card" id="card-${key}" style="padding:0;overflow:hidden;">
      <!-- Card header -->
      <div style="padding:16px 20px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;gap:12px;">
        <div style="flex:1;">
          <div style="font-weight:700;font-size:1rem;">${esc(destLabel)}</div>
          <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap;">
            ${group.items.map(i => `
              <span style="font-size:0.6875rem;padding:2px 8px;border-radius:20px;
                ${i.status==='expired'
                  ? 'background:#EF444415;color:#EF4444;border:1px solid #EF444330;'
                  : 'background:#F59E0B15;color:#F59E0B;border:1px solid #F59E0B30;'}">
                ${i.status==='expired'?'⚠':'🕐'} ${esc(i.seg.label)}
                · ${fmtDate(i.exp)}
              </span>`).join('')}
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <a href="#portal-tip-editor?destId=${esc(group.tip.destinationId)}"
            class="btn btn-ghost btn-sm" style="font-size:0.75rem;text-decoration:none;">
            ✎ Editar
          </a>
          <button class="btn btn-secondary btn-sm agent-analyze-btn" data-tip-key="${esc(key)}">
            ✨ Analisar
          </button>
        </div>
      </div>
      <!-- Suggestion area (empty until analyzed) -->
      <div id="suggestion-${key}" style="display:none;"></div>
    </div>
  `;
}

async function analyzeOne(tipKey) {
  const group  = window._agentData?.[tipKey];
  if (!group) return;

  const btn    = document.querySelector(`.agent-analyze-btn[data-tip-key="${tipKey}"]`);
  const sugEl  = document.getElementById(`suggestion-${tipKey}`);
  if (!sugEl) return;

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Analisando…'; }
  sugEl.style.display = 'block';
  sugEl.innerHTML = loadingHtml('Consultando IA…');

  const destLabel  = [group.dest?.city, group.dest?.country, group.dest?.continent]
    .filter(Boolean).join(', ');

  // Build prompt context
  const segSummaries = group.items.map(({ seg, sd, exp, status }) => {
    const content = buildSegmentSummary(sd, seg);
    return `## ${seg.label} (${status === 'expired' ? 'VENCIDO em' : 'vence em'} ${fmtDate(exp)})\n${content}`;
  }).join('\n\n');

  const prompt = `Você é um especialista em turismo e analista de conteúdo para agências de viagem brasileiras.

Destino: ${destLabel}

Os seguintes segmentos de dicas de viagem estão vencidos ou próximos do vencimento:

${segSummaries}

Por favor:
1. Identifique quais informações provavelmente estão desatualizadas (horários, preços, disponibilidade, eventos)
2. Sugira o que deve ser verificado/atualizado em cada segmento
3. Para cada item, informe a prioridade: ALTA (informação crítica), MÉDIA (importante) ou BAIXA (complementar)
4. Forneça dicas específicas sobre onde buscar informações atualizadas (site oficial, Google Maps, redes sociais, etc.)

Responda em português brasileiro, de forma objetiva e estruturada. Use marcadores para facilitar a leitura.`;

  try {
    const resp = await fetch(CLAUDE_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await resp.json();
    const text = data.content?.map(c => c.text || '').join('') || '';

    if (!text) throw new Error('Resposta vazia da IA');

    sugEl.innerHTML = `
      <div style="padding:20px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">
          <span style="font-size:1rem;">🤖</span>
          <span style="font-size:0.75rem;font-weight:700;text-transform:uppercase;
            letter-spacing:.07em;color:var(--brand-gold);">Análise da IA</span>
        </div>
        <div id="ai-text-${tipKey}" style="font-size:0.875rem;line-height:1.7;
          color:var(--text-secondary);white-space:pre-wrap;">${esc(text)}</div>
        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-primary btn-sm agent-mark-reviewed"
            data-tip-key="${esc(tipKey)}"
            style="font-size:0.8125rem;">
            ✓ Marcar como revisado
          </button>
          <button class="btn btn-secondary btn-sm agent-open-editor"
            data-dest-id="${esc(group.tip.destinationId)}"
            style="font-size:0.8125rem;">
            ✎ Abrir editor de dicas
          </button>
          <button class="btn btn-ghost btn-sm agent-reanalyze"
            data-tip-key="${esc(tipKey)}"
            style="font-size:0.75rem;color:var(--text-muted);">
            ↺ Reanalisar
          </button>
        </div>
      </div>
    `;

    // Bind action buttons
    sugEl.querySelector('.agent-mark-reviewed')?.addEventListener('click', async (e) => {
      await markReviewed(tipKey, group, e.currentTarget);
    });
    sugEl.querySelector('.agent-open-editor')?.addEventListener('click', (e) => {
      location.hash = `portal-tip-editor?destId=${e.currentTarget.dataset.destId}`;
    });
    sugEl.querySelector('.agent-reanalyze')?.addEventListener('click', () => {
      if (btn) { btn.disabled = false; btn.textContent = '✨ Analisar'; }
      sugEl.style.display = 'none';
      analyzeOne(tipKey);
    });

    if (btn) { btn.disabled = false; btn.textContent = '✨ Reanalisar'; }

  } catch(e) {
    sugEl.innerHTML = `
      <div style="padding:20px;">
        <div style="font-size:0.875rem;color:#EF4444;margin-bottom:12px;">
          Erro ao consultar IA: ${esc(e.message)}
        </div>
        <button class="btn btn-ghost btn-sm" onclick="this.closest('[id^=suggestion]').style.display='none'">
          Fechar
        </button>
      </div>`;
    if (btn) { btn.disabled = false; btn.textContent = '✨ Analisar'; }
  }
}

async function markReviewed(tipKey, group, btn) {
  btn.disabled = true; btn.textContent = '⏳ Salvando…';
  try {
    // Extend expiry by 90 days for each flagged segment
    const tip      = { ...group.tip };
    const segments = { ...(tip.segments || {}) };
    const now      = new Date();
    const new90    = new Date(+now + 90 * 86400_000);
    const newDate  = new90.toISOString().slice(0, 10);

    group.items.forEach(({ seg }) => {
      if (segments[seg.key]) {
        segments[seg.key] = { ...segments[seg.key], expiryDate: newDate };
      }
    });

    await saveTip(tip.id, { ...tip, segments });
    toast.success('Dica marcada como revisada. Validade estendida por 90 dias.');

    // Remove card from UI
    document.getElementById(`card-${tipKey}`)?.remove();

    // Check if no cards left
    const remaining = document.querySelectorAll('.agent-tip-card').length;
    if (remaining === 0) {
      document.getElementById('agent-cards').innerHTML = `
        <div class="card" style="padding:40px;text-align:center;">
          <div style="font-size:2.5rem;margin-bottom:12px;">✅</div>
          <div style="font-size:1rem;font-weight:700;">Todas as dicas foram revisadas!</div>
        </div>`;
    }
  } catch(e) {
    toast.error('Erro ao salvar: ' + e.message);
    btn.disabled = false; btn.textContent = '✓ Marcar como revisado';
  }
}

/* ── Helpers ── */
function buildSegmentSummary(sd, segDef) {
  if (segDef.mode === 'special_info') {
    const inf = sd.info || {};
    return Object.entries(inf)
      .filter(([,v]) => v && typeof v === 'string')
      .slice(0, 6)
      .map(([k,v]) => `- ${k}: ${String(v).slice(0,120)}`)
      .join('\n') || '(sem conteúdo)';
  }
  const items = (sd.items || []).slice(0, 5);
  if (!items.length) return '(sem itens cadastrados)';
  return items.map(i =>
    `- ${i.titulo || i.title || ''}${i.categoria ? ` [${i.categoria}]` : ''}${i.descricao ? ': ' + i.descricao.slice(0,80) : ''}`
  ).join('\n');
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  return new Intl.DateTimeFormat('pt-BR').format(dt);
}

function loadingHtml(msg) {
  return `<div style="text-align:center;padding:40px;color:var(--text-muted);">
    <div class="spinner" style="width:28px;height:28px;border:3px solid var(--border-subtle);
      border-top-color:var(--brand-gold);border-radius:50%;
      animation:spin .8s linear infinite;margin:0 auto 12px;"></div>
    ${esc(msg)}</div>`;
}
