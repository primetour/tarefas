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
        <button class="btn btn-secondary btn-sm" id="dash-export-xls">⬇ XLS</button>
        <button class="btn btn-secondary btn-sm" id="dash-export-pdf">⬇ PDF</button>
        <button class="btn btn-secondary btn-sm" id="dash-refresh">↺ Atualizar</button>
      </div>
    </div>
    <div id="dash-body">${skeleton()}</div>`;
  document.getElementById('dash-refresh')?.addEventListener('click', () => load(container));
  document.getElementById('dash-export-pdf')?.addEventListener('click', () => exportPortalPdf());
  document.getElementById('dash-export-xls')?.addEventListener('click', () => exportPortalXls());
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

/* ═══════════════════════════════════════════════════════════════
   PDF Export — Portal de Dicas Dashboard
   ═══════════════════════════════════════════════════════════════ */
async function exportPortalPdf() {
  const btn = document.getElementById('dash-export-pdf');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    // Load jsPDF + autoTable
    if (!window.jspdf) {
      await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'; s.onload=res;s.onerror=rej;document.head.appendChild(s); });
      await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.1/jspdf.plugin.autotable.min.js'; s.onload=res;s.onerror=rej;document.head.appendChild(s); });
    }

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
    const coveragePct = pct(totalFilled, maxFilled);

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

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const W   = doc.internal.pageSize.getWidth();
    const H   = doc.internal.pageSize.getHeight();
    const date = now.toLocaleDateString('pt-BR');

    // ── Header ──
    doc.setFillColor(212,168,67);
    doc.rect(0, 0, W, 3, 'F');
    doc.setFillColor(36,35,98);
    doc.rect(0, 3, W, 20, 'F');
    doc.setFontSize(14); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
    doc.text('PRIMETOUR', 14, 14);
    doc.setFontSize(9); doc.setFont('helvetica','normal'); doc.setTextColor(212,168,67);
    doc.text('Dashboard — Portal de Dicas', 14, 19);
    doc.setTextColor(200,200,200);
    doc.text(`${date}  ·  ${tips.length} dicas  ·  ${dests.length} destinos`, W-14, 19, {align:'right'});

    // ── KPIs (2 rows x 4) ──
    let y = 28;
    const kpis = [
      { label:'Áreas',       value:String(areas.length),     color:[56,189,248]  },
      { label:'Destinos',    value:String(dests.length),      color:[167,139,250] },
      { label:'Dicas',       value:String(tips.length),       color:[34,197,94]   },
      { label:'Cobertura',   value:coveragePct+'%',           color:[212,168,67]  },
      { label:'Gerações /30d', value:String(recentGens.length), color:[96,165,250] },
      { label:'Links web',   value:String(links.length),      color:[167,139,250] },
      { label:'Views links', value:String(totalViews),        color:[56,189,248]  },
      { label:'Vencidas',    value:String(expired.length),    color: expired.length > 0 ? [239,68,68] : [34,197,94] },
    ];
    const cols = 4;
    const kpiW = (W - 28 - (cols-1)*4) / cols;
    kpis.forEach((k,i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = 14 + col*(kpiW+4);
      const ky = y + row * 20;
      doc.setFillColor(...k.color);
      doc.roundedRect(x, ky, kpiW, 16, 2, 2, 'F');
      doc.setFontSize(13); doc.setFont('helvetica','bold'); doc.setTextColor(255,255,255);
      doc.text(k.value, x+kpiW/2, ky+7, {align:'center'});
      doc.setFontSize(6); doc.setFont('helvetica','normal');
      doc.text(k.label, x+kpiW/2, ky+12.5, {align:'center'});
    });
    y += Math.ceil(kpis.length / cols) * 20 + 6;

    // ── Status de Validade ──
    doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(36,35,98);
    doc.text('Status de Validade', 14, y);
    y += 6;

    const validityItems = [
      { label:'Vencidas',        count: expired.length,  color:[239,68,68]  },
      { label:'Vencendo em 30d', count: expiring.length, color:[245,158,11] },
      { label:'Em dia',          count: healthy.length,  color:[34,197,94]  },
    ];
    const barW = W - 28;
    validityItems.forEach(v => {
      const p = pct(v.count, tips.length);
      // Label
      doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(80,80,80);
      doc.text(`${v.label}: ${v.count} (${p}%)`, 14, y+3);
      // Bar background
      doc.setFillColor(235,235,235);
      doc.roundedRect(14, y+5, barW, 4, 1, 1, 'F');
      // Bar fill
      if (p > 0) {
        doc.setFillColor(...v.color);
        doc.roundedRect(14, y+5, Math.max(barW * p / 100, 2), 4, 1, 1, 'F');
      }
      y += 14;
    });
    y += 4;

    // ── Cobertura por Segmento ──
    doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(36,35,98);
    doc.text('Cobertura por Segmento', 14, y);
    y += 6;

    segCov.forEach(s => {
      const p = pct(s.covered, tips.length);
      const c = p >= 75 ? [34,197,94] : p >= 35 ? [245,158,11] : [239,68,68];
      // Label
      doc.setFontSize(6.5); doc.setFont('helvetica','normal'); doc.setTextColor(80,80,80);
      const lblText = s.label.length > 30 ? s.label.slice(0,28)+'…' : s.label;
      doc.text(lblText, 14, y+3);
      doc.text(`${p}%`, W-14, y+3, {align:'right'});
      // Bar
      doc.setFillColor(235,235,235);
      doc.roundedRect(60, y+0.5, W-80, 3.5, 1, 1, 'F');
      if (p > 0) {
        doc.setFillColor(...c);
        doc.roundedRect(60, y+0.5, Math.max((W-80)*p/100, 1.5), 3.5, 1, 1, 'F');
      }
      y += 7;

      // Page break check
      if (y > H - 30) {
        addFooter(doc, W, H, 'Portal de Dicas');
        doc.addPage();
        y = 14;
      }
    });
    y += 6;

    // ── Gerações por Formato ──
    if (Object.keys(byFormat).length > 0) {
      if (y > H - 50) { addFooter(doc, W, H, 'Portal de Dicas'); doc.addPage(); y = 14; }
      doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(36,35,98);
      doc.text('Gerações por Formato', 14, y);
      y += 6;

      const totalGens = Object.values(byFormat).reduce((a,b) => a+b, 0);
      const fmtColors = { docx:[96,165,250], pdf:[239,68,68], pptx:[34,197,94], web:[212,168,67] };
      Object.entries(byFormat).sort(([,a],[,b]) => b-a).forEach(([fmt, cnt]) => {
        const p = pct(cnt, totalGens);
        const c = fmtColors[fmt] || [150,150,150];
        doc.setFontSize(7); doc.setFont('helvetica','bold'); doc.setTextColor(...c);
        doc.text(fmt.toUpperCase(), 14, y+3);
        doc.setFont('helvetica','normal'); doc.setTextColor(80,80,80);
        doc.text(String(cnt), W-14, y+3, {align:'right'});
        doc.setFillColor(235,235,235);
        doc.roundedRect(40, y+0.5, W-62, 3.5, 1, 1, 'F');
        if (p > 0) {
          doc.setFillColor(...c);
          doc.roundedRect(40, y+0.5, Math.max((W-62)*p/100, 1.5), 3.5, 1, 1, 'F');
        }
        y += 9;
      });
      y += 6;
    }

    // ── Destinos sem Dica ──
    if (missingDests.length > 0) {
      if (y > H - 40) { addFooter(doc, W, H, 'Portal de Dicas'); doc.addPage(); y = 14; }
      doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(36,35,98);
      doc.text(`Destinos sem Dica (${missingDests.length} de ${dests.length})`, 14, y);
      y += 2;

      doc.autoTable({
        startY: y,
        head: [['Destino', 'País']],
        body: missingDests.slice(0, 30).map(d => [
          [d.city, d.state].filter(Boolean).join(', ') || '—',
          d.country || '—',
        ]),
        styles: { fontSize:7, cellPadding:2.5 },
        headStyles: { fillColor:[36,35,98], textColor:255, fontStyle:'bold', fontSize:7 },
        alternateRowStyles: { fillColor:[248,247,244] },
      });
      y = doc.lastAutoTable.finalY + 6;
      if (missingDests.length > 30) {
        doc.setFontSize(6); doc.setFont('helvetica','normal'); doc.setTextColor(150,150,150);
        doc.text(`+${missingDests.length - 30} destinos omitidos`, 14, y);
        y += 6;
      }
    }

    // ── Links Web Recentes ──
    if (links.length > 0) {
      if (y > H - 40) { addFooter(doc, W, H, 'Portal de Dicas'); doc.addPage(); y = 14; }
      doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(36,35,98);
      doc.text('Links Web Recentes', 14, y);
      y += 2;

      doc.autoTable({
        startY: y,
        head: [['Token','Área','Destinos','Views','Criado']],
        body: links.slice(0, 20).map(l => [
          (l.token || '—').slice(0, 8) + '…',
          l.areaName || '—',
          String((l.tipData||[]).length),
          String(l.views || 0),
          fmtDate(l.createdAt),
        ]),
        styles: { fontSize:7, cellPadding:2.5 },
        headStyles: { fillColor:[36,35,98], textColor:255, fontStyle:'bold', fontSize:7 },
        alternateRowStyles: { fillColor:[248,247,244] },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 3) {
            const val = Number(data.cell.raw);
            if (val > 0) {
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.textColor = val >= 10 ? [34,197,94] : [212,168,67];
            }
          }
        },
      });
    }

    // ── Footer (all pages) ──
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      addFooter(doc, W, H, 'Portal de Dicas', i, pageCount);
    }

    doc.save(`primetour_portal_dicas_${new Date().toISOString().slice(0,10)}.pdf`);
    import('../components/toast.js').then(m => m.toast.success(`PDF gerado com ${tips.length} dicas.`));
  } catch(e) {
    import('../components/toast.js').then(m => m.toast.error('Erro ao gerar PDF: ' + e.message));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ PDF'; }
  }
}

function addFooter(doc, W, H, title, page, total) {
  if (page && total) {
    doc.setPage(page);
  }
  const pH = doc.internal.pageSize.getHeight();
  doc.setFillColor(36,35,98);
  doc.rect(0, pH-7, W, 7, 'F');
  doc.setFontSize(6); doc.setFont('helvetica','normal'); doc.setTextColor(180,180,180);
  doc.text(`PRIMETOUR — ${title}`, 14, pH-2.5);
  if (page && total) {
    doc.text(`Página ${page}/${total}`, W-14, pH-2.5, {align:'right'});
  }
}

/* ═══════════════════════════════════════════════════════════════
   XLS Export — Portal de Dicas Dashboard
   ═══════════════════════════════════════════════════════════════ */
async function exportPortalXls() {
  const btn = document.getElementById('dash-export-xls');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const [areas, dests, tips, gens, links] = await Promise.all([
      fetchAreas(), fetchDestinations(), fetchTips(),
      fetchCol('portal_generations', 200), fetchCol('portal_web_links', 100),
    ]);

    const now = new Date();
    const in30 = new Date(+now + 30*86400_000);

    const segCov = SEGMENTS.map(s => ({
      label: s.label,
      covered: tips.filter(t => hasContent(t, s.key)).length,
    }));

    const tipDestIds = new Set(tips.map(t => t.destinationId));
    const missingDests = dests.filter(d => !tipDestIds.has(d.id));

    // Build CSV
    const sep = ';';
    const lines = [];
    lines.push('PRIMETOUR — Portal de Dicas Dashboard');
    lines.push(`Gerado em: ${now.toLocaleDateString('pt-BR')}`);
    lines.push('');

    // KPIs
    lines.push('INDICADORES');
    lines.push(`Áreas${sep}${areas.length}`);
    lines.push(`Destinos${sep}${dests.length}`);
    lines.push(`Dicas${sep}${tips.length}`);
    const totalFilled = tips.reduce((a,t) => a + SEGMENTS.filter(s => hasContent(t, s.key)).length, 0);
    const maxFilled = tips.length * SEGMENTS.length || 1;
    lines.push(`Cobertura${sep}${pct(totalFilled, maxFilled)}%`);
    lines.push(`Links web${sep}${links.length}`);
    lines.push(`Views${sep}${links.reduce((a,l)=>a+(l.views||0),0)}`);
    lines.push('');

    // Validade
    const expired = tips.filter(t => hasBadSeg(t, now, null));
    const expiring = tips.filter(t => !hasBadSeg(t,now,null) && hasBadSeg(t,now,in30));
    const healthy = tips.filter(t => !hasBadSeg(t,now,null) && !hasBadSeg(t,now,in30));
    lines.push('STATUS DE VALIDADE');
    lines.push(`Status${sep}Quantidade${sep}%`);
    lines.push(`Vencidas${sep}${expired.length}${sep}${pct(expired.length, tips.length)}%`);
    lines.push(`Vencendo 30d${sep}${expiring.length}${sep}${pct(expiring.length, tips.length)}%`);
    lines.push(`Em dia${sep}${healthy.length}${sep}${pct(healthy.length, tips.length)}%`);
    lines.push('');

    // Cobertura segmentos
    lines.push('COBERTURA POR SEGMENTO');
    lines.push(`Segmento${sep}Dicas${sep}%`);
    segCov.forEach(s => {
      lines.push(`${s.label}${sep}${s.covered}${sep}${pct(s.covered, tips.length)}%`);
    });
    lines.push('');

    // Destinos sem dica
    if (missingDests.length > 0) {
      lines.push('DESTINOS SEM DICA');
      lines.push(`Destino${sep}País`);
      missingDests.forEach(d => {
        lines.push(`${[d.city, d.state].filter(Boolean).join(', ')||'—'}${sep}${d.country||'—'}`);
      });
      lines.push('');
    }

    // Links
    if (links.length > 0) {
      lines.push('LINKS WEB');
      lines.push(`Token${sep}Área${sep}Destinos${sep}Views${sep}Criado`);
      links.forEach(l => {
        lines.push(`${(l.token||'').slice(0,8)}${sep}${l.areaName||'—'}${sep}${(l.tipData||[]).length}${sep}${l.views||0}${sep}${fmtDate(l.createdAt)}`);
      });
    }

    const bom = '\uFEFF';
    const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `primetour_portal_dicas_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    import('../components/toast.js').then(m => m.toast.success('XLS exportado.'));
  } catch(e) {
    import('../components/toast.js').then(m => m.toast.error('Erro ao exportar: ' + e.message));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ XLS'; }
  }
}
