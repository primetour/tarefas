/**
 * PRIMETOUR — Portal de Dicas: Dashboard (reformulado)
 * Visão geral completa de conteúdo, imagens, gerações e validade
 */
import { store }   from '../store.js';
import {
  fetchAreas, fetchDestinations, fetchTips, SEGMENTS,
} from '../services/portal.js';
import {
  collection, getDocs, query, orderBy, limit, where,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pct = (n, d) => d ? Math.round((n / d) * 100) : 0;
const num = v => (v != null ? Number(v).toLocaleString('pt-BR') : '—');

const SECTION_HEAD = `font-size:0.6875rem;font-weight:700;text-transform:uppercase;
  letter-spacing:.08em;color:var(--text-muted);margin-bottom:12px;`;
const TH = `padding:6px 12px;text-align:left;font-size:0.6875rem;font-weight:700;
  text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);
  border-bottom:1px solid var(--border-subtle);white-space:nowrap;`;

/* ─── State ──────────────────────────────────────────────── */
let filterDays  = '0';     // 0 = all-time
let filterUser  = '';      // '' = all users
let rawAreas    = [];
let rawDests    = [];
let rawTips     = [];
let rawGens     = [];
let rawImages   = [];
let rawLinks    = [];

/* ─── Entry point ────────────────────────────────────────── */
export async function renderPortalDashboard(container) {
  if (!store.canManagePortal()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div><div class="empty-state-title">Acesso restrito</div>
    </div>`;
    return;
  }

  // Load users from Firestore if not in store yet
  let users = (store.get('users') || []).filter(u => u.active !== false);
  if (!users.length) {
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      store.set('users', allUsers);
      users = allUsers.filter(u => u.active !== false);
    } catch { /* ignore */ }
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Dashboard — Portal de Dicas</h1>
        <p class="page-subtitle">Visão geral de conteúdo, imagens, gerações e validade</p>
      </div>
      <div class="page-header-actions" style="gap:8px;flex-wrap:wrap;">
        <button class="btn btn-secondary btn-sm" id="dash-export-xls">⬇ XLS</button>
        <button class="btn btn-secondary btn-sm" id="dash-export-pdf">⬇ PDF</button>
        <button class="btn btn-secondary btn-sm" id="dash-refresh">↺ Atualizar</button>
      </div>
    </div>

    <!-- Filters -->
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;align-items:center;">
      <select class="filter-select" id="pd-period-filter" style="min-width:180px;">
        <option value="0"   selected>Todo o período</option>
        <option value="7">Últimos 7 dias</option>
        <option value="30">Últimos 30 dias</option>
        <option value="60">Últimos 60 dias</option>
        <option value="90">Últimos 90 dias</option>
        <option value="365">Último ano</option>
        <option value="custom">Personalizado…</option>
      </select>
      <div id="pd-custom-dates" style="display:none;gap:6px;align-items:center;">
        <input type="date" class="filter-select" id="pd-date-from" style="min-width:130px;" />
        <span style="color:var(--text-muted);font-size:0.8125rem;">a</span>
        <input type="date" class="filter-select" id="pd-date-to" style="min-width:130px;" />
        <button class="btn btn-ghost btn-sm" id="pd-apply-custom"
          style="font-size:0.75rem;">Aplicar</button>
      </div>
      <select class="filter-select" id="pd-user-filter" style="min-width:200px;">
        <option value="">Todos os usuários</option>
        ${users.map(u => `<option value="${esc(u.id)}">${esc(u.name || u.email)}</option>`).join('')}
      </select>
    </div>

    <div id="dash-body">${skeleton()}</div>`;

  // Event bindings
  document.getElementById('pd-period-filter')?.addEventListener('change', e => {
    const v = e.target.value;
    const custom = document.getElementById('pd-custom-dates');
    if (v === 'custom') {
      if (custom) custom.style.display = 'flex';
      return; // don't reload until Apply
    }
    if (custom) custom.style.display = 'none';
    filterDays = v;
    renderDash();
  });
  document.getElementById('pd-apply-custom')?.addEventListener('click', () => {
    filterDays = 'custom';
    renderDash();
  });
  document.getElementById('pd-user-filter')?.addEventListener('change', e => {
    filterUser = e.target.value;
    renderDash();
  });
  document.getElementById('dash-refresh')?.addEventListener('click', () => loadAll());
  document.getElementById('dash-export-pdf')?.addEventListener('click', () => exportPortalPdf());
  document.getElementById('dash-export-xls')?.addEventListener('click', () => exportPortalXls());

  await loadAll();
}

/* ─── Fetch all data once ────────────────────────────────── */
async function loadAll() {
  const body = document.getElementById('dash-body');
  if (!body) return;
  body.innerHTML = spinner();

  try {
    const [areas, dests, tips, gens, images, links] = await Promise.all([
      fetchAreas(), fetchDestinations(), fetchTips(),
      fetchCol('portal_generations', 2000),
      fetchCol('portal_images', 5000),
      fetchCol('portal_web_links', 200),
    ]);
    rawAreas  = areas;
    rawDests  = dests;
    rawTips   = tips;
    rawGens   = gens;
    rawImages = images;
    rawLinks  = links;
    renderDash();
  } catch(e) {
    body.innerHTML = `<div style="text-align:center;padding:48px;color:var(--text-muted);">
      Erro: ${esc(e.message)}</div>`;
  }
}

/* ─── Date range helpers ─────────────────────────────────── */
function getDateRange() {
  const now = new Date();
  if (filterDays === '0') return { from: null, to: now };
  if (filterDays === 'custom') {
    const f = document.getElementById('pd-date-from')?.value;
    const t = document.getElementById('pd-date-to')?.value;
    return {
      from: f ? new Date(f + 'T00:00:00') : null,
      to:   t ? new Date(t + 'T23:59:59') : now,
    };
  }
  const from = new Date();
  from.setDate(from.getDate() - parseInt(filterDays));
  return { from, to: now };
}

function tsToDate(ts) {
  if (!ts) return null;
  return ts?.toDate ? ts.toDate() : new Date(ts);
}

function inRange(ts, range) {
  if (!range.from) return true; // all-time
  const d = tsToDate(ts);
  if (!d) return true; // no date? include
  return d >= range.from && d <= range.to;
}

function fmtDate(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR').format(d);
}

/* ─── Render dashboard with filters ──────────────────────── */
function renderDash() {
  const body = document.getElementById('dash-body');
  if (!body) return;

  const range = getDateRange();
  const now   = new Date();
  const in30  = new Date(+now + 30 * 86400_000);

  // Filter generations by period + user
  const gens = rawGens.filter(g => {
    if (!inRange(g.generatedAt, range)) return false;
    if (filterUser && g.generatedBy !== filterUser) return false;
    return true;
  });

  // Filter images by period + user (uploadedAt / uploadedBy)
  const images = rawImages.filter(img => {
    if (!inRange(img.uploadedAt, range)) return false;
    if (filterUser && img.uploadedBy !== filterUser) return false;
    return true;
  });

  // Tips: filter by creation date + user (createdBy)
  const tips = rawTips.filter(t => {
    if (!inRange(t.createdAt, range)) return false;
    if (filterUser && t.createdBy !== filterUser) return false;
    return true;
  });

  // For validity analysis we always use ALL tips (not filtered)
  const allTips = rawTips;

  const areas = rawAreas;
  const dests = rawDests;
  const links = rawLinks.filter(l => inRange(l.createdAt, range));

  // ── Computed metrics ──
  const expired  = allTips.filter(t => hasBadSeg(t, now, null));
  const expiring = allTips.filter(t => !hasBadSeg(t,now,null) && hasBadSeg(t,now,in30));
  const healthy  = allTips.filter(t => !hasBadSeg(t,now,null) && !hasBadSeg(t,now,in30));

  const totalFilled = allTips.reduce((a,t) =>
    a + SEGMENTS.filter(s => hasContent(t, s.key)).length, 0);
  const maxFilled   = allTips.length * SEGMENTS.length || 1;

  const priorityTips    = allTips.filter(t => t.priority);
  const priorityExpired = priorityTips.filter(t => hasBadSeg(t, now, null));

  // Tips by continent/country
  const tipsByContinent = {};
  const tipsByCountry   = {};
  allTips.forEach(t => {
    const c = t.continent || 'Sem continente';
    const p = t.country || 'Sem país';
    tipsByContinent[c] = (tipsByContinent[c]||0) + 1;
    tipsByCountry[p]   = (tipsByCountry[p]||0) + 1;
  });

  // Generations by month
  const gensByMonth = {};
  gens.forEach(g => {
    const d = tsToDate(g.generatedAt);
    if (d) {
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      gensByMonth[key] = (gensByMonth[key]||0) + 1;
    }
  });

  // Images by continent and country
  const imgByContinent = {};
  const imgByCountry   = {};
  rawImages.forEach(img => { // use rawImages for totals
    const c = img.continent || 'Sem continente';
    const p = img.country   || 'Sem país';
    imgByContinent[c] = (imgByContinent[c]||0) + 1;
    imgByCountry[p]   = (imgByCountry[p]||0) + 1;
  });

  // Top 10 most generated tips (by destinationIds frequency)
  const destGenCount = {};
  gens.forEach(g => {
    (g.destinationIds || []).forEach(did => {
      destGenCount[did] = (destGenCount[did]||0) + 1;
    });
  });
  const topGenDests = Object.entries(destGenCount)
    .sort(([,a],[,b]) => b - a)
    .slice(0, 10)
    .map(([did, cnt]) => {
      const dest = dests.find(d => d.id === did);
      return { name: dest ? [dest.city, dest.country].filter(Boolean).join(', ') : did, count: cnt };
    });
  const totalDestGens = Object.values(destGenCount).reduce((a,b) => a+b, 0) || 1;

  // Top templates (areas) chosen
  const areaGenCount = {};
  gens.forEach(g => {
    const aId = g.areaId || '_none';
    areaGenCount[aId] = (areaGenCount[aId]||0) + 1;
  });
  const topAreas = Object.entries(areaGenCount)
    .sort(([,a],[,b]) => b - a)
    .map(([aId, cnt]) => {
      const area = areas.find(a => a.id === aId);
      return { name: area?.name || '(sem template)', count: cnt };
    });
  const totalAreaGens = Object.values(areaGenCount).reduce((a,b) => a+b, 0) || 1;

  // Generations by format
  const byFormat = {};
  gens.forEach(g => { byFormat[g.format] = (byFormat[g.format]||0) + 1; });

  // Top segments
  const segGenCount = {};
  gens.forEach(g => {
    (g.segments || []).forEach(sk => {
      segGenCount[sk] = (segGenCount[sk]||0) + 1;
    });
  });
  const topSegments = Object.entries(segGenCount)
    .sort(([,a],[,b]) => b - a)
    .map(([sk, cnt]) => {
      const seg = SEGMENTS.find(s => s.key === sk);
      return { label: seg?.label || sk, count: cnt };
    });
  const totalSegGens = Object.values(segGenCount).reduce((a,b) => a+b, 0) || 1;

  // Last 10 created tips
  const recentTips = [...rawTips]
    .filter(t => t.createdAt)
    .sort((a,b) => {
      const da = tsToDate(a.createdAt)?.getTime() || 0;
      const db_ = tsToDate(b.createdAt)?.getTime() || 0;
      return db_ - da;
    })
    .slice(0, 10);

  // Top 10 destinations with expired tips
  const expiredDetails = [];
  expired.forEach(t => {
    const dest = dests.find(d => d.id === t.destinationId);
    const expiredSegs = SEGMENTS.filter(s => {
      const seg = t.segments?.[s.key];
      if (!seg?.hasExpiry || !seg?.expiryDate) return false;
      return new Date(seg.expiryDate) < now;
    }).map(s => s.label);
    if (expiredSegs.length) {
      expiredDetails.push({
        name: dest ? [dest.city, dest.country].filter(Boolean).join(', ') : t.destinationId,
        segs: expiredSegs,
        priority: !!t.priority,
        tipId: t.id,
      });
    }
  });

  // Segment coverage
  const segCov = SEGMENTS.map(s => ({
    label: s.label,
    covered: allTips.filter(t => hasContent(t, s.key)).length,
  }));

  const tipDestIds = new Set(allTips.map(t => t.destinationId));
  const missingDests = dests.filter(d => !tipDestIds.has(d.id));

  // Period label
  const periodLabel = filterDays === '0' ? 'Todo o período'
    : filterDays === 'custom' ? 'Período personalizado'
    : `Últimos ${filterDays} dias`;
  const userLabel = filterUser
    ? (store.get('users')||[]).find(u => u.id === filterUser)?.name || 'Usuário'
    : 'Todos os usuários';

  body.innerHTML = `
    <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:16px;">
      ${esc(periodLabel)} · ${esc(userLabel)} · ${tips.length} dicas criadas no período · ${gens.length} gerações
    </div>

    <!-- KPIs row 1 -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(145px,1fr));gap:12px;margin-bottom:24px;">
      ${kpi('Dicas Cadastradas',  allTips.length,   '✈', null, '',
            'Total de dicas cadastradas no sistema, independente do filtro de período.')}
      ${kpi('Criadas no Período', tips.length,      '📝', null, '',
            'Quantidade de dicas criadas dentro do período e usuário selecionados nos filtros acima.')}
      ${kpi('Prioritárias',       priorityTips.length, '★', null,
            priorityExpired.length > 0
              ? `<span style="color:#EF4444;font-size:0.6875rem;">${priorityExpired.length} vencida${priorityExpired.length>1?'s':''}</span>`
              : priorityTips.length > 0
                ? `<span style="color:#22C55E;font-size:0.6875rem;">atualizadas</span>` : '',
            'Destinos marcados com estrela (★) como prioritários. Indica os destinos mais importantes que devem ser mantidos sempre atualizados.')}
      ${kpi('Cobertura',          pct(totalFilled,maxFilled)+'%', '📊', null, '',
            'Percentual de preenchimento dos segmentos em todas as dicas. Cada dica tem ' + SEGMENTS.length + ' segmentos possíveis (ex: Informações, Bairros, Atrações, Restaurantes…). Cobertura = (segmentos preenchidos ÷ total possível) × 100.')}
      ${kpi('Vencidas',           expired.length,   '⚠', expired.length > 0 ? '#EF4444' : null, '',
            'Dicas que possuem pelo menos um segmento com data de validade expirada. Esses segmentos precisam ser revisados e atualizados.')}
      ${kpi('Imagens (banco)',    rawImages.length,  '🖼', null, '',
            'Total de imagens cadastradas no banco de imagens do portal, considerando todos os continentes e países.')}
      ${kpi('Gerações',           gens.length,       '⚡', null, '',
            'Quantidade de materiais gerados (Word, PDF, PowerPoint ou Link Web) no período e pelo usuário selecionados.')}
      ${kpi('Links Web',          links.length,      '🔗', null, '',
            'Links web criados para compartilhamento de dicas de viagem com clientes. Cada link é acessível sem login.')}
    </div>

    <!-- Row: Validade + Cobertura por Segmento -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
      <div class="card" style="padding:20px;">
        <div style="${SECTION_HEAD}">Status de Validade</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${vRow('Vencidas',        expired.length,  allTips.length, '#EF4444')}
          ${vRow('Vencendo em 30d', expiring.length, allTips.length, '#F59E0B')}
          ${vRow('Em dia',          healthy.length,  allTips.length, '#22C55E')}
        </div>
      </div>
      <div class="card" style="padding:20px;">
        <div style="${SECTION_HEAD}">Cobertura por Segmento</div>
        <div style="display:flex;flex-direction:column;gap:5px;max-height:240px;overflow-y:auto;">
          ${segCov.map(s => segBar(s.label, s.covered, allTips.length)).join('')}
        </div>
      </div>
    </div>

    <!-- Row: Dicas por Continente/País + Imagens por Continente -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
      <div class="card" style="padding:20px;">
        <div style="${SECTION_HEAD}">Dicas por Continente / País</div>
        <div style="display:flex;flex-direction:column;gap:4px;max-height:280px;overflow-y:auto;">
          ${Object.entries(tipsByContinent).sort(([,a],[,b])=>b-a).map(([cont, cnt]) => {
            const countriesInCont = Object.entries(tipsByCountry)
              .filter(([p]) => allTips.some(t => t.continent === cont && t.country === p))
              .sort(([,a],[,b])=>b-a);
            return `
              <div style="margin-bottom:4px;">
                <div style="display:flex;justify-content:space-between;align-items:center;
                  padding:4px 8px;background:var(--bg-surface);border-radius:var(--radius-sm);">
                  <span style="font-size:0.8125rem;font-weight:600;">${esc(cont)}</span>
                  <span style="font-size:0.75rem;font-weight:700;color:var(--text-muted);">${cnt}</span>
                </div>
                ${countriesInCont.slice(0,5).map(([p, pc]) => `
                  <div style="display:flex;justify-content:space-between;padding:2px 8px 2px 20px;">
                    <span style="font-size:0.75rem;color:var(--text-secondary);">${esc(p)}</span>
                    <span style="font-size:0.75rem;color:var(--text-muted);">${pc}</span>
                  </div>`).join('')}
                ${countriesInCont.length > 5
                  ? `<div style="padding:2px 20px;font-size:0.6875rem;color:var(--text-muted);">
                      +${countriesInCont.length-5} países</div>` : ''}
              </div>`;
          }).join('')}
        </div>
      </div>

      <div class="card" style="padding:20px;">
        <div style="${SECTION_HEAD}">Imagens por Continente</div>
        <div style="display:flex;flex-direction:column;gap:6px;max-height:160px;overflow-y:auto;margin-bottom:16px;">
          ${Object.entries(imgByContinent).sort(([,a],[,b])=>b-a).map(([cont,cnt]) => {
            const p = pct(cnt, rawImages.length);
            return `<div style="display:flex;align-items:center;gap:8px;">
              <span style="font-size:0.75rem;min-width:120px;max-width:120px;overflow:hidden;
                text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary);">${esc(cont)}</span>
              <div style="flex:1;background:var(--bg-surface);border-radius:20px;height:4px;">
                <div style="height:100%;background:#38BDF8;width:${p}%;border-radius:20px;"></div>
              </div>
              <span style="font-size:0.6875rem;color:var(--text-muted);min-width:40px;text-align:right;">
                ${cnt}</span>
            </div>`;
          }).join('')}
        </div>
        <div style="${SECTION_HEAD}">Imagens por País (Top 20)</div>
        <div style="display:flex;flex-direction:column;gap:4px;max-height:200px;overflow-y:auto;">
          ${Object.entries(imgByCountry).sort(([,a],[,b])=>b-a).slice(0,20).map(([p,cnt]) => `
            <div style="display:flex;justify-content:space-between;padding:3px 8px;
              background:var(--bg-surface);border-radius:var(--radius-sm);">
              <span style="font-size:0.75rem;">${esc(p)}</span>
              <span style="font-size:0.75rem;font-weight:600;color:var(--text-muted);">${cnt}</span>
            </div>`).join('')}
        </div>
      </div>
    </div>

    <!-- Row: Gerações Total/Mês + Top 10 dicas mais geradas -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">
      <div class="card" style="padding:20px;">
        <div style="${SECTION_HEAD}">Gerações por Mês
          <span style="font-weight:400;color:var(--text-muted);margin-left:6px;">
            Total: ${gens.length}</span>
        </div>
        ${Object.keys(gensByMonth).length === 0
          ? `<div style="color:var(--text-muted);font-size:0.8125rem;padding:20px 0;text-align:center;">
              Nenhuma geração no período.</div>`
          : `<div style="display:flex;flex-direction:column;gap:4px;max-height:240px;overflow-y:auto;">
            ${Object.entries(gensByMonth).sort(([a],[b])=>b.localeCompare(a)).map(([m,cnt]) => {
              const [y, mo] = m.split('-');
              const label = new Date(Number(y), Number(mo)-1).toLocaleDateString('pt-BR', { month:'short', year:'numeric' });
              const maxM = Math.max(...Object.values(gensByMonth));
              return `<div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:0.75rem;min-width:80px;color:var(--text-secondary);text-transform:capitalize;">${label}</span>
                <div style="flex:1;background:var(--bg-surface);border-radius:20px;height:5px;">
                  <div style="height:100%;background:#A78BFA;width:${pct(cnt,maxM)}%;border-radius:20px;"></div>
                </div>
                <span style="font-size:0.75rem;font-weight:700;min-width:30px;text-align:right;">${cnt}</span>
              </div>`;
            }).join('')}
          </div>`}
      </div>

      <div class="card" style="padding:20px;">
        <div style="${SECTION_HEAD}">Top 10 Dicas Mais Geradas</div>
        ${topGenDests.length === 0
          ? `<div style="color:var(--text-muted);font-size:0.8125rem;padding:20px 0;text-align:center;">
              Nenhuma geração registrada.</div>`
          : `<div style="display:flex;flex-direction:column;gap:4px;max-height:260px;overflow-y:auto;">
            ${topGenDests.map((d,i) => `
              <div style="display:flex;align-items:center;gap:8px;padding:4px 8px;
                background:var(--bg-surface);border-radius:var(--radius-sm);">
                <span style="font-size:0.6875rem;color:var(--text-muted);min-width:18px;">${i+1}.</span>
                <span style="font-size:0.8125rem;flex:1;overflow:hidden;text-overflow:ellipsis;
                  white-space:nowrap;">${esc(d.name)}</span>
                <span style="font-size:0.75rem;font-weight:700;min-width:28px;text-align:right;">${d.count}</span>
                <span style="font-size:0.6875rem;color:var(--text-muted);min-width:36px;text-align:right;">
                  ${pct(d.count, totalDestGens)}%</span>
              </div>`).join('')}
          </div>`}
      </div>
    </div>

    <!-- Row: Templates + Formato + Segmentos -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px;">

      <!-- Top templates -->
      <div class="card" style="padding:20px;">
        <div style="${SECTION_HEAD}">Top Templates Escolhidos</div>
        ${topAreas.length === 0
          ? `<div style="color:var(--text-muted);font-size:0.8125rem;padding:20px 0;text-align:center;">—</div>`
          : `<div style="display:flex;flex-direction:column;gap:6px;">
            ${topAreas.map(a => {
              const p = pct(a.count, totalAreaGens);
              return `<div style="display:flex;align-items:center;gap:8px;font-size:0.8125rem;">
                <span style="flex:1;font-weight:500;">${esc(a.name)}</span>
                <div style="flex:1;background:var(--bg-surface);border-radius:20px;height:5px;">
                  <div style="height:100%;background:var(--brand-gold);width:${p}%;border-radius:20px;"></div>
                </div>
                <span style="font-weight:700;min-width:24px;text-align:right;">${a.count}</span>
                <span style="font-size:0.6875rem;color:var(--text-muted);min-width:30px;text-align:right;">${p}%</span>
              </div>`;
            }).join('')}
          </div>`}
      </div>

      <!-- Gerações por formato -->
      <div class="card" style="padding:20px;">
        <div style="${SECTION_HEAD}">Gerações por Formato</div>
        ${Object.keys(byFormat).length === 0
          ? `<div style="color:var(--text-muted);font-size:0.8125rem;padding:20px 0;text-align:center;">—</div>`
          : `<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
            ${Object.entries(byFormat).sort(([,a],[,b])=>b-a).map(([fmt,cnt]) => {
              const tot = Object.values(byFormat).reduce((a,b)=>a+b,0);
              const ic  = {docx:'📄',pdf:'📕',pptx:'📊',web:'🔗'}[fmt]||'📁';
              return `<div style="display:flex;align-items:center;gap:10px;font-size:0.8125rem;">
                <span>${ic}</span>
                <span style="flex:1;text-transform:uppercase;font-size:0.75rem;font-weight:600;
                  color:var(--text-muted);min-width:40px;">${fmt}</span>
                <div style="flex:2;background:var(--bg-surface);border-radius:20px;height:5px;">
                  <div style="height:100%;background:var(--brand-gold);width:${pct(cnt,tot)}%;
                    border-radius:20px;"></div>
                </div>
                <span style="font-weight:700;min-width:24px;text-align:right;">${cnt}</span>
              </div>`;
            }).join('')}
          </div>`}
      </div>

      <!-- Top segmentos -->
      <div class="card" style="padding:20px;">
        <div style="${SECTION_HEAD}">Top Segmentos Gerados</div>
        ${topSegments.length === 0
          ? `<div style="color:var(--text-muted);font-size:0.8125rem;padding:20px 0;text-align:center;">—</div>`
          : `<div style="display:flex;flex-direction:column;gap:5px;max-height:240px;overflow-y:auto;">
            ${topSegments.map(s => {
              const p = pct(s.count, totalSegGens);
              return `<div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:0.75rem;min-width:130px;max-width:130px;overflow:hidden;
                  text-overflow:ellipsis;white-space:nowrap;color:var(--text-secondary);">${esc(s.label)}</span>
                <div style="flex:1;background:var(--bg-surface);border-radius:20px;height:4px;">
                  <div style="height:100%;background:#22C55E;width:${p}%;border-radius:20px;"></div>
                </div>
                <span style="font-size:0.6875rem;color:var(--text-muted);min-width:24px;text-align:right;">
                  ${s.count}</span>
              </div>`;
            }).join('')}
          </div>`}
      </div>
    </div>

    <!-- Row: Últimas 10 dicas + Top 10 vencidas -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;">

      <!-- Últimas 10 dicas cadastradas -->
      <div class="card" style="padding:20px;">
        <div style="${SECTION_HEAD}">Últimas 10 Dicas Cadastradas</div>
        ${recentTips.length === 0
          ? `<div style="color:var(--text-muted);font-size:0.8125rem;padding:20px 0;text-align:center;">
              Nenhuma dica cadastrada.</div>`
          : `<table style="width:100%;border-collapse:collapse;font-size:0.8125rem;">
            <thead><tr>
              <th style="${TH}">Destino</th>
              <th style="${TH}">Continente</th>
              <th style="${TH}">Criado em</th>
            </tr></thead>
            <tbody>
              ${recentTips.map(t => {
                const dest = rawDests.find(d => d.id === t.destinationId);
                const name = dest ? [dest.city, dest.country].filter(Boolean).join(', ') : '—';
                const user = (store.get('users')||[]).find(u => u.id === t.createdBy);
                return `<tr style="border-bottom:1px solid var(--border-subtle)88;">
                  <td style="padding:6px 12px;">
                    <div>${esc(name)}</div>
                    <div style="font-size:0.6875rem;color:var(--text-muted);">
                      por ${esc(user?.name || '—')}</div>
                  </td>
                  <td style="padding:6px 12px;color:var(--text-muted);font-size:0.75rem;">
                    ${esc(t.continent||'—')}</td>
                  <td style="padding:6px 12px;color:var(--text-muted);font-size:0.75rem;white-space:nowrap;">
                    ${fmtDate(t.createdAt)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>`}
      </div>

      <!-- Top 10 destinos com dicas vencidas -->
      <div class="card" style="padding:20px;">
        <div style="${SECTION_HEAD}">Top 10 Destinos com Dicas Vencidas
          <span style="font-weight:400;color:var(--text-muted);margin-left:6px;">
            ${expiredDetails.length} total</span>
        </div>
        ${expiredDetails.length === 0
          ? `<div style="color:#22C55E;font-size:0.8125rem;padding:20px 0;text-align:center;">
              ✓ Nenhuma dica vencida.</div>`
          : `<div style="display:flex;flex-direction:column;gap:6px;max-height:300px;overflow-y:auto;">
            ${expiredDetails.slice(0,10).map(d => `
              <div style="padding:8px 10px;background:var(--bg-surface);border-radius:var(--radius-sm);
                border-left:3px solid ${d.priority ? 'var(--brand-gold)' : '#EF4444'};">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                  ${d.priority ? '<span style="color:var(--brand-gold);font-size:0.875rem;" title="Prioritário">★</span>' : ''}
                  <span style="font-size:0.8125rem;font-weight:600;">${esc(d.name)}</span>
                </div>
                <div style="font-size:0.6875rem;color:#EF4444;">
                  Vencido: ${d.segs.map(s => esc(s)).join(', ')}
                </div>
              </div>`).join('')}
          </div>`}
      </div>
    </div>

    <!-- Destinos sem dica -->
    ${missingDests.length > 0 ? `
    <div class="card" style="padding:20px;margin-bottom:24px;">
      <div style="${SECTION_HEAD}">Destinos sem Dica
        <span style="font-weight:400;color:var(--text-muted);margin-left:6px;">
          ${missingDests.length} de ${dests.length}</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;max-height:200px;overflow-y:auto;">
        ${missingDests.map(d => `
          <a href="#portal-tip-editor?destId=${esc(d.id)}" style="text-decoration:none;
            display:inline-flex;align-items:center;gap:4px;padding:4px 10px;
            background:var(--bg-surface);border-radius:var(--radius-sm);font-size:0.75rem;
            color:var(--text-secondary);border:1px solid var(--border-subtle);">
            ${esc([d.city, d.country].filter(Boolean).join(', '))}
            <span style="color:var(--brand-gold);font-weight:700;">+</span>
          </a>`).join('')}
      </div>
    </div>` : ''}

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
}

/* ─── Helpers ────────────────────────────────────────────── */
async function fetchCol(col, lim=100) {
  try {
    const snap = await getDocs(query(collection(db, col), limit(lim)));
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

function buildViewUrl(token) {
  const base = window.location.origin + window.location.pathname.replace(/index\.html$/, '');
  return `${base}portal-view.html#${token}`;
}

function kpi(label, value, icon, color, extra, info) {
  return `<div class="card" style="padding:16px;">
    <div style="font-size:1.25rem;margin-bottom:6px;">${icon}</div>
    <div style="font-size:1.625rem;font-weight:800;line-height:1;${color?`color:${color};`:''}">
      ${value}</div>
    <div style="display:flex;align-items:center;gap:4px;font-size:0.75rem;color:var(--text-secondary);margin-top:4px;">
      ${label}
      ${info ? `<span style="display:inline-flex;align-items:center;justify-content:center;
        width:13px;height:13px;border-radius:50%;background:var(--bg-surface);
        border:1px solid var(--border-subtle);font-size:0.5rem;cursor:help;
        font-weight:700;color:var(--text-muted);flex-shrink:0;"
        title="${esc(info)}">i</span>` : ''}
    </div>
    ${extra ? `<div style="margin-top:2px;">${extra}</div>` : ''}
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
  return row(4) + row(4) + row(2) + row(2);
}

function spinner() {
  return `<div style="text-align:center;padding:48px;color:var(--text-muted);">
    <div class="spinner" style="width:32px;height:32px;border:3px solid var(--border-subtle);
      border-top-color:var(--brand-gold);border-radius:50%;animation:spin .8s linear infinite;
      margin:0 auto 12px;"></div>Carregando métricas…</div>`;
}

/* ═══════════════════════════════════════════════════════════════
   PDF Export — Portal de Dicas Dashboard
   ═══════════════════════════════════════════════════════════════ */
async function exportPortalPdf() {
  const btn = document.getElementById('dash-export-pdf');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    if (!window.jspdf) {
      await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'; s.onload=res;s.onerror=rej;document.head.appendChild(s); });
      await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.1/jspdf.plugin.autotable.min.js'; s.onload=res;s.onerror=rej;document.head.appendChild(s); });
    }

    const range = getDateRange();
    const now   = new Date();
    const in30  = new Date(+now + 30 * 86400_000);

    const allTips = rawTips;
    const tips    = rawTips.filter(t => inRange(t.createdAt, range) && (!filterUser || t.createdBy === filterUser));
    const gens    = rawGens.filter(g => inRange(g.generatedAt, range) && (!filterUser || g.generatedBy === filterUser));
    const areas   = rawAreas;
    const dests   = rawDests;

    const expired  = allTips.filter(t => hasBadSeg(t, now, null));
    const expiring = allTips.filter(t => !hasBadSeg(t,now,null) && hasBadSeg(t,now,in30));
    const healthy  = allTips.filter(t => !hasBadSeg(t,now,null) && !hasBadSeg(t,now,in30));

    const totalFilled = allTips.reduce((a,t) => a + SEGMENTS.filter(s => hasContent(t, s.key)).length, 0);
    const maxFilled   = allTips.length * SEGMENTS.length || 1;
    const coveragePct = pct(totalFilled, maxFilled);

    const byFormat = {};
    gens.forEach(g => { byFormat[g.format] = (byFormat[g.format]||0) + 1; });

    const priorityTips = allTips.filter(t => t.priority);
    const tipDestIds   = new Set(allTips.map(t => t.destinationId));
    const missingDests = dests.filter(d => !tipDestIds.has(d.id));

    const segCov = SEGMENTS.map(s => ({
      label: s.label,
      covered: allTips.filter(t => hasContent(t, s.key)).length,
    }));

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const W   = doc.internal.pageSize.getWidth();
    const H   = doc.internal.pageSize.getHeight();
    const date = now.toLocaleDateString('pt-BR');

    const periodLabel = filterDays === '0' ? 'Todo o período'
      : filterDays === 'custom' ? 'Personalizado'
      : `Últimos ${filterDays}d`;

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
    doc.text(`${periodLabel}  ·  ${date}  ·  ${allTips.length} dicas`, W-14, 19, {align:'right'});

    // ── KPIs ──
    let y = 28;
    const kpis = [
      { label:'Dicas',        value:String(allTips.length),     color:[56,189,248]  },
      { label:'Prioritárias', value:String(priorityTips.length), color:[212,168,67] },
      { label:'Cobertura',    value:coveragePct+'%',            color:[96,165,250]  },
      { label:'Vencidas',     value:String(expired.length),     color: expired.length > 0 ? [239,68,68] : [34,197,94] },
      { label:'Imagens',      value:String(rawImages.length),   color:[56,189,248]  },
      { label:'Gerações',     value:String(gens.length),        color:[167,139,250] },
      { label:'Criadas',      value:String(tips.length),        color:[34,197,94]   },
      { label:'S/ Dica',      value:String(missingDests.length), color:[239,68,68]  },
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
    doc.text('Status de Validade', 14, y); y += 6;
    const validityItems = [
      { label:'Vencidas',        count: expired.length,  color:[239,68,68]  },
      { label:'Vencendo em 30d', count: expiring.length, color:[245,158,11] },
      { label:'Em dia',          count: healthy.length,  color:[34,197,94]  },
    ];
    const barW = W - 28;
    validityItems.forEach(v => {
      const p = pct(v.count, allTips.length);
      doc.setFontSize(7); doc.setFont('helvetica','normal'); doc.setTextColor(80,80,80);
      doc.text(`${v.label}: ${v.count} (${p}%)`, 14, y+3);
      doc.setFillColor(235,235,235);
      doc.roundedRect(14, y+5, barW, 4, 1, 1, 'F');
      if (p > 0) {
        doc.setFillColor(...v.color);
        doc.roundedRect(14, y+5, Math.max(barW * p / 100, 2), 4, 1, 1, 'F');
      }
      y += 14;
    });
    y += 4;

    // ── Cobertura por Segmento ──
    doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(36,35,98);
    doc.text('Cobertura por Segmento', 14, y); y += 6;
    segCov.forEach(s => {
      const p = pct(s.covered, allTips.length);
      const c = p >= 75 ? [34,197,94] : p >= 35 ? [245,158,11] : [239,68,68];
      doc.setFontSize(6.5); doc.setFont('helvetica','normal'); doc.setTextColor(80,80,80);
      const lblText = s.label.length > 30 ? s.label.slice(0,28)+'…' : s.label;
      doc.text(lblText, 14, y+3);
      doc.text(`${p}%`, W-14, y+3, {align:'right'});
      doc.setFillColor(235,235,235);
      doc.roundedRect(60, y+0.5, W-80, 3.5, 1, 1, 'F');
      if (p > 0) {
        doc.setFillColor(...c);
        doc.roundedRect(60, y+0.5, Math.max((W-80)*p/100, 1.5), 3.5, 1, 1, 'F');
      }
      y += 7;
      if (y > H - 30) { addFooter(doc, W, H, 'Portal de Dicas'); doc.addPage(); y = 14; }
    });
    y += 6;

    // ── Gerações por Formato ──
    if (Object.keys(byFormat).length > 0) {
      if (y > H - 50) { addFooter(doc, W, H, 'Portal de Dicas'); doc.addPage(); y = 14; }
      doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(36,35,98);
      doc.text('Gerações por Formato', 14, y); y += 6;
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

    // ── Destinos com Dicas Vencidas ──
    const expiredDetails = [];
    expired.forEach(t => {
      const dest = dests.find(d => d.id === t.destinationId);
      const expSegs = SEGMENTS.filter(s => {
        const seg = t.segments?.[s.key];
        if (!seg?.hasExpiry || !seg?.expiryDate) return false;
        return new Date(seg.expiryDate) < now;
      }).map(s => s.label);
      if (expSegs.length) {
        expiredDetails.push({
          name: dest ? [dest.city, dest.country].filter(Boolean).join(', ') : '—',
          segs: expSegs.join(', '),
          priority: t.priority ? '★' : '',
        });
      }
    });
    if (expiredDetails.length > 0) {
      if (y > H - 40) { addFooter(doc, W, H, 'Portal de Dicas'); doc.addPage(); y = 14; }
      doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(36,35,98);
      doc.text(`Destinos com Dicas Vencidas (${expiredDetails.length})`, 14, y); y += 2;
      doc.autoTable({
        startY: y,
        head: [['★','Destino','Campos Vencidos']],
        body: expiredDetails.slice(0,20).map(d => [d.priority, d.name, d.segs]),
        styles: { fontSize:7, cellPadding:2.5 },
        headStyles: { fillColor:[36,35,98], textColor:255, fontStyle:'bold', fontSize:7 },
        alternateRowStyles: { fillColor:[248,247,244] },
        columnStyles: { 0: { cellWidth: 8 } },
      });
      y = doc.lastAutoTable.finalY + 6;
    }

    // ── Footer ──
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) addFooter(doc, W, H, 'Portal de Dicas', i, pageCount);

    doc.save(`primetour_portal_dicas_${new Date().toISOString().slice(0,10)}.pdf`);
    import('../components/toast.js').then(m => m.toast.success(`PDF gerado com ${allTips.length} dicas.`));
  } catch(e) {
    import('../components/toast.js').then(m => m.toast.error('Erro ao gerar PDF: ' + e.message));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ PDF'; }
  }
}

function addFooter(doc, W, H, title, page, total) {
  if (page && total) doc.setPage(page);
  const pH = doc.internal.pageSize.getHeight();
  doc.setFillColor(36,35,98);
  doc.rect(0, pH-7, W, 7, 'F');
  doc.setFontSize(6); doc.setFont('helvetica','normal'); doc.setTextColor(180,180,180);
  doc.text(`PRIMETOUR — ${title}`, 14, pH-2.5);
  if (page && total) doc.text(`Página ${page}/${total}`, W-14, pH-2.5, {align:'right'});
}

/* ═══════════════════════════════════════════════════════════════
   XLS Export — Portal de Dicas Dashboard
   ═══════════════════════════════════════════════════════════════ */
async function exportPortalXls() {
  const btn = document.getElementById('dash-export-xls');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const range = getDateRange();
    const now   = new Date();
    const in30  = new Date(+now + 30*86400_000);

    const allTips = rawTips;
    const tips    = rawTips.filter(t => inRange(t.createdAt, range) && (!filterUser || t.createdBy === filterUser));
    const gens    = rawGens.filter(g => inRange(g.generatedAt, range) && (!filterUser || g.generatedBy === filterUser));
    const areas   = rawAreas;
    const dests   = rawDests;

    const expired  = allTips.filter(t => hasBadSeg(t, now, null));
    const expiring = allTips.filter(t => !hasBadSeg(t,now,null) && hasBadSeg(t,now,in30));
    const healthy  = allTips.filter(t => !hasBadSeg(t,now,null) && !hasBadSeg(t,now,in30));

    const totalFilled = allTips.reduce((a,t) => a + SEGMENTS.filter(s => hasContent(t, s.key)).length, 0);
    const maxFilled   = allTips.length * SEGMENTS.length || 1;

    const segCov = SEGMENTS.map(s => ({
      label: s.label,
      covered: allTips.filter(t => hasContent(t, s.key)).length,
    }));

    const tipDestIds   = new Set(allTips.map(t => t.destinationId));
    const missingDests = dests.filter(d => !tipDestIds.has(d.id));

    // Tips by continent
    const tipsByContinent = {};
    allTips.forEach(t => { tipsByContinent[t.continent||'?'] = (tipsByContinent[t.continent||'?']||0)+1; });

    // Images by continent/country
    const imgByContinent = {};
    const imgByCountry   = {};
    rawImages.forEach(img => {
      imgByContinent[img.continent||'?'] = (imgByContinent[img.continent||'?']||0)+1;
      imgByCountry[img.country||'?'] = (imgByCountry[img.country||'?']||0)+1;
    });

    // Generations by format
    const byFormat = {};
    gens.forEach(g => { byFormat[g.format] = (byFormat[g.format]||0) + 1; });

    // Top destinations
    const destGenCount = {};
    gens.forEach(g => {
      (g.destinationIds||[]).forEach(did => { destGenCount[did] = (destGenCount[did]||0)+1; });
    });
    const topGenDests = Object.entries(destGenCount).sort(([,a],[,b])=>b-a).slice(0,10)
      .map(([did,cnt]) => {
        const d = dests.find(dd=>dd.id===did);
        return { name: d ? [d.city,d.country].filter(Boolean).join(', ') : did, count: cnt };
      });

    const sep = ';';
    const lines = [];
    lines.push('PRIMETOUR — Portal de Dicas Dashboard');
    lines.push(`Gerado em: ${now.toLocaleDateString('pt-BR')}`);
    lines.push('');

    lines.push('INDICADORES');
    lines.push(`Dicas Totais${sep}${allTips.length}`);
    lines.push(`Criadas no Período${sep}${tips.length}`);
    lines.push(`Prioritárias${sep}${allTips.filter(t=>t.priority).length}`);
    lines.push(`Cobertura${sep}${pct(totalFilled, maxFilled)}%`);
    lines.push(`Imagens${sep}${rawImages.length}`);
    lines.push(`Gerações${sep}${gens.length}`);
    lines.push(`Vencidas${sep}${expired.length}`);
    lines.push('');

    lines.push('STATUS DE VALIDADE');
    lines.push(`Status${sep}Quantidade${sep}%`);
    lines.push(`Vencidas${sep}${expired.length}${sep}${pct(expired.length, allTips.length)}%`);
    lines.push(`Vencendo 30d${sep}${expiring.length}${sep}${pct(expiring.length, allTips.length)}%`);
    lines.push(`Em dia${sep}${healthy.length}${sep}${pct(healthy.length, allTips.length)}%`);
    lines.push('');

    lines.push('COBERTURA POR SEGMENTO');
    lines.push(`Segmento${sep}Dicas${sep}%`);
    segCov.forEach(s => lines.push(`${s.label}${sep}${s.covered}${sep}${pct(s.covered, allTips.length)}%`));
    lines.push('');

    lines.push('DICAS POR CONTINENTE');
    lines.push(`Continente${sep}Quantidade`);
    Object.entries(tipsByContinent).sort(([,a],[,b])=>b-a).forEach(([c,n]) => lines.push(`${c}${sep}${n}`));
    lines.push('');

    lines.push('IMAGENS POR CONTINENTE');
    lines.push(`Continente${sep}Quantidade`);
    Object.entries(imgByContinent).sort(([,a],[,b])=>b-a).forEach(([c,n]) => lines.push(`${c}${sep}${n}`));
    lines.push('');

    lines.push('IMAGENS POR PAÍS (TOP 20)');
    lines.push(`País${sep}Quantidade`);
    Object.entries(imgByCountry).sort(([,a],[,b])=>b-a).slice(0,20).forEach(([c,n]) => lines.push(`${c}${sep}${n}`));
    lines.push('');

    lines.push('GERAÇÕES POR FORMATO');
    lines.push(`Formato${sep}Quantidade`);
    Object.entries(byFormat).sort(([,a],[,b])=>b-a).forEach(([f,n]) => lines.push(`${f}${sep}${n}`));
    lines.push('');

    lines.push('TOP 10 DICAS MAIS GERADAS');
    lines.push(`Destino${sep}Gerações${sep}%`);
    const totalDG = Object.values(destGenCount).reduce((a,b)=>a+b,0)||1;
    topGenDests.forEach(d => lines.push(`${d.name}${sep}${d.count}${sep}${pct(d.count,totalDG)}%`));
    lines.push('');

    if (missingDests.length > 0) {
      lines.push('DESTINOS SEM DICA');
      lines.push(`Destino${sep}País`);
      missingDests.forEach(d => lines.push(`${[d.city, d.state].filter(Boolean).join(', ')||'—'}${sep}${d.country||'—'}`));
      lines.push('');
    }

    // Expired details
    if (expired.length > 0) {
      lines.push('DICAS VENCIDAS');
      lines.push(`Destino${sep}Prioritário${sep}Campos Vencidos`);
      expired.forEach(t => {
        const dest = dests.find(d => d.id === t.destinationId);
        const name = dest ? [dest.city, dest.country].filter(Boolean).join(', ') : '—';
        const expSegs = SEGMENTS.filter(s => {
          const seg = t.segments?.[s.key];
          if (!seg?.hasExpiry || !seg?.expiryDate) return false;
          return new Date(seg.expiryDate) < now;
        }).map(s => s.label).join(' | ');
        lines.push(`${name}${sep}${t.priority?'Sim':'Não'}${sep}${expSegs}`);
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
