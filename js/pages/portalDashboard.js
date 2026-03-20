/**
 * PRIMETOUR — Portal de Dicas: Dashboard (E9)
 */
import { store }   from '../store.js';
import {
  fetchAreas, fetchDestinations, fetchTips, SEGMENTS,
} from '../services/portal.js';
import {
  collection, getDocs, query, orderBy, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct = (n, d) => d ? Math.round((n / d) * 100) : 0;
const SECTION_HEAD = `font-size:0.6875rem;font-weight:700;text-transform:uppercase;
  letter-spacing:.08em;color:var(--text-muted);margin-bottom:12px;`;
const TH = `padding:6px 12px;text-align:left;font-size:0.6875rem;font-weight:700;
  text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);`;

export async function renderPortalDashboard(container) {
  if (!store.canManagePortal()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div><div class="empty-state-title">Acesso restrito</div>
    </div>`;
    return;
  }
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Dashboard — Portal de Dicas</h1>
        <p class="page-subtitle">Visão geral de conteúdo, validade e uso</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-secondary btn-sm" id="dash-refresh">↺ Atualizar</button>
      </div>
    </div>
    <div id="dash-body">${skeleton()}</div>`;
  document.getElementById('dash-refresh')?.addEventListener('click', () => load(container));
  await load(container);
}

async function load(container) {
  const body = document.getElementById('dash-body');
  if (!body) return;
  body.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text-muted);">
    <div class="spinner" style="width:32px;height:32px;border:3px solid var(--border-subtle);
      border-top-color:var(--brand-gold);border-radius:50%;animation:spin .8s linear infinite;
      margin:0 auto 12px;"></div>Carregando métricas…</div>`;

  try {
    const [areas, dests, tips, gens, dls, links] = await Promise.all([
      fetchAreas(), fetchDestinations(), fetchTips(),
      fetchCol('portal_generations', 200), fetchCol('portal_downloads', 500), fetchCol('portal_web_links', 100),
    ]);

    const now  = new Date();
    const in30 = new Date(+now + 30 * 86400_000);

    const expired  = tips.filter(t => hasBadSeg(t, now, null));
    const expiring = tips.filter(t => !hasBadSeg(t,now,null) && hasBadSeg(t,now,in30));
    const healthy  = tips.filter(t => !hasBadSeg(t,now,null) && !hasBadSeg(t,now,in30));

    const totalFilled = tips.reduce((a,t) =>
      a + SEGMENTS.filter(s => hasContent(t, s.key)).length, 0);
    const maxFilled   = tips.length * SEGMENTS.length || 1;

    const byFormat = {};
    gens.forEach(g => { byFormat[g.format] = (byFormat[g.format]||0) + 1; });
    const recentGens = gens.filter(g => {
      const d = g.generatedAt?.toDate?.() || new Date(g.generatedAt||0);
      return d >= new Date(+now - 30*86400_000);
    });

    const totalViews = links.reduce((a,l) => a + (l.views||0), 0);
    const tipDestIds = new Set(tips.map(t => t.destinationId));
    const missingDests = dests.filter(d => !tipDestIds.has(d.id));

    const segCov = SEGMENTS.map(s => ({
      label: s.label,
      covered: tips.filter(t => hasContent(t, s.key)).length,
    }));

    body.innerHTML = `
      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:24px;">
        ${kpi('Áreas',       areas.length,          '🗂')}
        ${kpi('Destinos',    dests.length,           '📍')}
        ${kpi('Dicas',       tips.length,            '✈')}
        ${kpi('Cobertura',   pct(totalFilled,maxFilled)+'%','📊')}
        ${kpi('Gerações /30d', recentGens.length,   '⚡')}
        ${kpi('Links web',   links.length,           '🔗')}
        ${kpi('Views links', totalViews,             '👁')}
        ${kpi('Vencidas',    expired.length,         '⚠', expired.length > 0 ? '#EF4444' : null)}
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">

        <!-- Validade -->
        <div class="card" style="padding:20px;">
          <div style="${SECTION_HEAD}">Status de Validade</div>
          <div style="display:flex;flex-direction:column;gap:10px;">
            ${vRow('Vencidas',        expired.length,  tips.length, '#EF4444')}
            ${vRow('Vencendo em 30d', expiring.length, tips.length, '#F59E0B')}
            ${vRow('Em dia',          healthy.length,  tips.length, '#22C55E')}
          </div>
          <div style="margin-top:14px;padding:10px 12px;border-radius:var(--radius-sm);font-size:0.8125rem;
            ${expired.length > 0
              ? 'background:#EF444412;border:1px solid #EF444430;color:#EF4444;'
              : 'background:#22C55E12;border:1px solid #22C55E30;color:#22C55E;'}">
            ${expired.length > 0
              ? `⚠ ${expired.length} dica${expired.length>1?'s':''} vencida${expired.length>1?'s':''}. <a href="#portal-ai-agent" style="color:inherit;font-weight:700;">Agente de IA →</a>`
              : '✓ Todas as dicas estão dentro da validade.'}
          </div>
        </div>

        <!-- Cobertura por segmento -->
        <div class="card" style="padding:20px;">
          <div style="${SECTION_HEAD}">Cobertura por Segmento</div>
          <div style="display:flex;flex-direction:column;gap:5px;max-height:240px;overflow-y:auto;">
            ${segCov.map(s => segBar(s.label, s.covered, tips.length)).join('')}
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">

        <!-- Gerações por formato -->
        <div class="card" style="padding:20px;">
          <div style="${SECTION_HEAD}">Gerações por Formato</div>
          ${Object.keys(byFormat).length === 0
            ? `<div style="color:var(--text-muted);font-size:0.8125rem;padding:20px 0;text-align:center;">
                Nenhuma geração registrada.</div>`
            : `<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
              ${Object.entries(byFormat).sort(([,a],[,b])=>b-a).map(([fmt,cnt]) => {
                const tot = Object.values(byFormat).reduce((a,b)=>a+b,0);
                const ic  = {docx:'📄',pdf:'📕',pptx:'📊',web:'🔗'}[fmt]||'📁';
                return `<div style="display:flex;align-items:center;gap:10px;font-size:0.8125rem;">
                  <span>${ic}</span>
                  <span style="flex:1;text-transform:uppercase;font-size:0.75rem;font-weight:600;
                    color:var(--text-muted);">${fmt}</span>
                  <div style="flex:2;background:var(--bg-surface);border-radius:20px;height:5px;">
                    <div style="height:100%;background:var(--brand-gold);width:${pct(cnt,tot)}%;
                      border-radius:20px;"></div>
                  </div>
                  <span style="font-weight:700;min-width:24px;text-align:right;">${cnt}</span>
                </div>`;
              }).join('')}
            </div>`}
        </div>

        <!-- Destinos sem dica -->
        <div class="card" style="padding:20px;">
          <div style="${SECTION_HEAD}">Destinos sem Dica
            <span style="font-weight:400;color:var(--text-muted);margin-left:6px;">
              ${missingDests.length} de ${dests.length}
            </span>
          </div>
          ${missingDests.length === 0
            ? `<div style="color:#22C55E;font-size:0.8125rem;padding:20px 0;text-align:center;">
                ✓ Todos os destinos têm dica.</div>`
            : `<div style="display:flex;flex-direction:column;gap:4px;max-height:200px;overflow-y:auto;">
                ${missingDests.slice(0,15).map(d => `
                  <div style="display:flex;align-items:center;justify-content:space-between;
                    padding:5px 8px;background:var(--bg-surface);border-radius:var(--radius-sm);">
                    <span style="font-size:0.8125rem;">
                      ${esc([d.city, d.country].filter(Boolean).join(', '))}
                    </span>
                    <a href="#portal-tip-editor?destId=${esc(d.id)}"
                      style="font-size:0.75rem;color:var(--brand-gold);text-decoration:none;">+ Criar</a>
                  </div>`).join('')}
                ${missingDests.length > 15
                  ? `<div style="text-align:center;font-size:0.75rem;color:var(--text-muted);padding:4px;">
                      +${missingDests.length-15} mais</div>` : ''}
              </div>`}
        </div>
      </div>

      <!-- Links web recentes -->
      ${links.length ? `
      <div class="card" style="padding:20px;margin-bottom:24px;">
        <div style="${SECTION_HEAD}">Links Web Recentes</div>
        <table style="width:100%;border-collapse:collapse;font-size:0.8125rem;">
          <thead><tr>
            ${['Token','Área','Destinos','Views','Criado',''].map(h =>
              `<th style="${TH}">${h}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${links.slice(0,8).map(l => `
              <tr style="border-bottom:1px solid var(--border-subtle)88;">
                <td style="padding:8px 12px;font-family:monospace;font-size:0.7rem;
                  color:var(--text-muted);">${esc(l.token?.slice(0,8)||'—')}…</td>
                <td style="padding:8px 12px;">${esc(l.areaName||'—')}</td>
                <td style="padding:8px 12px;color:var(--text-muted);">
                  ${(l.tipData||[]).length} destino${(l.tipData||[]).length!==1?'s':''}</td>
                <td style="padding:8px 12px;font-weight:600;">${l.views||0}</td>
                <td style="padding:8px 12px;color:var(--text-muted);">${fmtDate(l.createdAt)}</td>
                <td style="padding:8px 12px;">
                  <a href="${buildViewUrl(l.token)}" target="_blank"
                    style="font-size:0.75rem;color:var(--brand-gold);text-decoration:none;">↗</a>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : ''}
    `;
  } catch(e) {
    body.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text-muted);">
      Erro: ${esc(e.message)}</div>`;
  }
}

async function fetchCol(col, lim=100) {
  try {
    const snap = await getDocs(query(collection(db, col), orderBy('createdAt','desc').catch ? collection(db,col) : undefined, limit(lim)));
    return snap.docs.map(d => ({ id:d.id, ...d.data() }));
  } catch {
    try {
      const snap = await getDocs(collection(db, col));
      return snap.docs.map(d => ({ id:d.id, ...d.data() }));
    } catch { return []; }
  }
}

function hasContent(tip, key) {
  const seg = tip?.segments?.[key];
  if (!seg) return false;
  if (seg.info && Object.values(seg.info).some(v => v && String(v).trim())) return true;
  return Array.isArray(seg.items) && seg.items.length > 0;
}

function hasBadSeg(tip, from, until) {
  return SEGMENTS.some(s => {
    const seg = tip.segments?.[s.key];
    if (!seg?.hasExpiry || !seg?.expiryDate) return false;
    const d = new Date(seg.expiryDate);
    return until ? (d >= from && d <= until) : d < from;
  });
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR').format(d);
}

function buildViewUrl(token) {
  const base = window.location.origin + window.location.pathname.replace(/index\.html$/, '');
  return `${base}portal-view.html#${token}`;
}

function kpi(label, value, icon, color) {
  return `<div class="card" style="padding:16px;">
    <div style="font-size:1.25rem;margin-bottom:6px;">${icon}</div>
    <div style="font-size:1.625rem;font-weight:800;line-height:1;${color?`color:${color};`:''}">
      ${value}</div>
    <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:4px;">${label}</div>
  </div>`;
}

function vRow(label, count, total, color) {
  return `<div>
    <div style="display:flex;justify-content:space-between;font-size:0.8125rem;margin-bottom:3px;">
      <span style="font-weight:600;color:${color};">${label}</span>
      <span>${count}<span style="color:var(--text-muted);"> / ${total}</span></span>
    </div>
    <div style="background:var(--bg-surface);border-radius:20px;height:5px;">
      <div style="height:100%;background:${color};width:${pct(count,total)}%;border-radius:20px;
        transition:width .4s;"></div>
    </div>
  </div>`;
}

function segBar(label, covered, total) {
  const p = pct(covered, total);
  const c = p >= 75 ? '#22C55E' : p >= 35 ? '#F59E0B' : '#EF4444';
  return `<div style="display:flex;align-items:center;gap:8px;">
    <span style="font-size:0.75rem;min-width:148px;max-width:148px;overflow:hidden;
      text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary);">${esc(label)}</span>
    <div style="flex:1;background:var(--bg-surface);border-radius:20px;height:4px;">
      <div style="height:100%;background:${c};width:${p}%;border-radius:20px;"></div>
    </div>
    <span style="font-size:0.6875rem;color:var(--text-muted);min-width:30px;text-align:right;">
      ${p}%</span>
  </div>`;
}

function skeleton() {
  const row = n => `<div style="display:grid;grid-template-columns:repeat(${n},1fr);gap:12px;margin-bottom:16px;">
    ${Array(n).fill('<div class="skeleton" style="height:80px;border-radius:var(--radius-md);"></div>').join('')}
  </div>`;
  return row(4) + row(2);
}
