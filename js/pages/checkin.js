/**
 * PRIMETOUR — Check-in (migração completa de minhamesa + ponto eletrônico)
 *
 * 4 abas:
 *  - Mapa de Estações: cards de setor (capacidade) + grid por área com
 *    baias visuais (2 fileiras frente-a-frente de 6 assentos)
 *  - Check-in: itens da estação + speedtest OBRIGATÓRIO
 *  - Ponto: registro de jornada com timer
 *  - Relatório (admin)
 */
import { store }   from '../store.js';
import { toast }   from '../components/toast.js';
import { modal }   from '../components/modal.js';
import { REQUESTING_AREAS } from '../services/tasks.js';
import {
  DEFAULT_AREAS, DEFAULT_SECTOR_RULES,
  fetchCheckinConfig, saveCheckinConfig,
  fetchReservations, subscribeReservations,
  createReservation, deleteReservation, performCheckin,
  fetchMyTimeClock, fetchTimeClockRange, fetchAllTimeClock, clockEvent, calcWorkedHours,
  declineTimeClock, runSpeedTest,
} from '../services/checkin.js';

const esc = s => String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todayISO = () => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString().slice(0,10); };
const fmtTS = (v) => {
  if (!v) return '—';
  const d = v?.toDate ? v.toDate() : new Date(v);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};
const fmtDate = (s) => {
  if (!s) return '—';
  const [y,m,d] = String(s).split('-');
  return `${d}/${m}/${y}`;
};

const TIPO_LABELS = {
  'desktop-cabo':  '🖥️ Desktop · Cabo',
  'desktop-wifi':  '💻 Desktop · Wi-Fi',
  'celular-wifi':  '📱 Celular · Wi-Fi',
  'celular-dados': '📱 Celular · Dados móveis',
};

let activeTab = 'map';
let _config   = null;
let _reservations = [];
let _selectedDate = todayISO();
let _unsubscribeReservations = null;   // Cleanup do real-time listener

export async function renderCheckin(container) {
  const isAdmin = store.isMaster() || store.can('system_manage_users');
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">⏱ Check In</h1>
        <p class="page-subtitle">Reserva de estação · check-in · registro de ponto</p>
      </div>
    </div>

    <div style="display:flex;gap:0;margin-bottom:24px;border-bottom:1px solid var(--border-subtle);overflow-x:auto;">
      ${[
        { id:'map',     label:'Mapa de Estações', icon:'📋' },
        { id:'checkin', label:'Check-in',         icon:'✅' },
        { id:'clock',   label:'Ponto',            icon:'⏱' },
        ...(isAdmin ? [{ id:'report', label:'Relatório',     icon:'📊' }] : []),
        ...(isAdmin ? [{ id:'admin',  label:'Administração', icon:'⚙'  }] : []),
      ].map(t => `
        <button class="checkin-tab-btn" data-tab="${t.id}" style="padding:8px 18px;border:none;
          background:none;cursor:pointer;font-size:0.875rem;
          color:${activeTab===t.id?'var(--brand-gold)':'var(--text-muted)'};
          border-bottom:2px solid ${activeTab===t.id?'var(--brand-gold)':'transparent'};
          transition:all .15s;white-space:nowrap;">
          ${t.icon} ${t.label}
        </button>
      `).join('')}
    </div>

    <div id="checkin-content">
      <div class="card skeleton" style="height:300px;"></div>
    </div>
  `;

  container.querySelectorAll('.checkin-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      container.querySelectorAll('.checkin-tab-btn').forEach(b => {
        b.style.color       = b.dataset.tab === activeTab ? 'var(--brand-gold)' : 'var(--text-muted)';
        b.style.borderColor = b.dataset.tab === activeTab ? 'var(--brand-gold)' : 'transparent';
      });
      loadTab();
    });
  });

  _config = await fetchCheckinConfig().catch(() => ({ areas: DEFAULT_AREAS, sectorRules: DEFAULT_SECTOR_RULES }));
  loadTab();
}

async function loadTab() {
  const el = document.getElementById('checkin-content');
  if (!el) return;
  // Cleanup do listener anterior (evita updates fantasmas após trocar aba)
  if (_unsubscribeReservations) { _unsubscribeReservations(); _unsubscribeReservations = null; }
  el.innerHTML = '<div class="chart-loading"><div class="chart-loading-spinner"></div></div>';
  try {
    if (activeTab === 'map')         await renderMap(el);
    else if (activeTab === 'checkin') await renderCheckinTab(el);
    else if (activeTab === 'clock')  await renderClockTab(el);
    else if (activeTab === 'report') await renderReportTab(el);
    else if (activeTab === 'admin')  await renderAdminTab(el);
  } catch (e) {
    el.innerHTML = `<p style="color:var(--color-danger);padding:24px;">Erro: ${esc(e.message)}</p>`;
  }
}

/* ═══════════════════════════════════════════════════════════
 * 1. MAPA DE ESTAÇÕES
 * Layout: cards de setor (capacidade/dia + dias permitidos)
 *         seguido do grid de áreas com baias (2 fileiras de 6
 *         frente-a-frente, com gap visual entre baias)
 * ═══════════════════════════════════════════════════════════ */
async function renderMap(container) {
  // Carga inicial — depois subscribe pra real-time
  _reservations = await fetchReservations();
  const today = todayISO();
  if (!_selectedDate || _selectedDate < today) _selectedDate = today;

  const datesAvail = (() => {
    const arr = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      arr.push(d.toISOString().slice(0,10));
    }
    return arr;
  })();

  function dateOpts() {
    return datesAvail.map(d => `<option value="${d}" ${d===_selectedDate?'selected':''}>${fmtDate(d)} · ${weekdayLabel(d)}</option>`).join('');
  }

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
      <label style="font-size:0.875rem;color:var(--text-secondary);">Data:</label>
      <select class="filter-select" id="ck-date-sel">${dateOpts()}</select>
      <span id="ck-occupy-badge" style="font-size:0.75rem;color:var(--text-muted);"></span>
    </div>

    <!-- CARDS DE SETOR (regras + ocupação no dia selecionado) -->
    <div style="margin-bottom:14px;font-size:0.75rem;font-weight:700;text-transform:uppercase;
      letter-spacing:.06em;color:var(--text-muted);">
      Capacidade por setor
    </div>
    <div id="ck-sector-cards" style="display:grid;
      grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:24px;"></div>

    <!-- GRID DE ÁREAS COM BAIAS -->
    <div style="margin-bottom:14px;font-size:0.75rem;font-weight:700;text-transform:uppercase;
      letter-spacing:.06em;color:var(--text-muted);">
      Mapa de assentos
    </div>
    <div id="ck-area-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:24px;"></div>

    <div style="margin-top:16px;font-size:0.6875rem;color:var(--text-muted);
      display:flex;gap:14px;flex-wrap:wrap;align-items:center;">
      <span>Legenda:</span>
      <span style="display:inline-flex;align-items:center;gap:4px;">
        <span style="width:12px;height:12px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:2px;"></span>livre
      </span>
      <span style="display:inline-flex;align-items:center;gap:4px;">
        <span style="width:12px;height:12px;background:#EF444444;border:1px solid #EF4444;border-radius:2px;"></span>ocupado
      </span>
      <span style="display:inline-flex;align-items:center;gap:4px;">
        <span style="width:12px;height:12px;background:#22C55E44;border:1px solid #22C55E;border-radius:2px;"></span>check-in
      </span>
      <span style="display:inline-flex;align-items:center;gap:4px;">
        <span style="width:12px;height:12px;border:2px solid var(--brand-gold);border-radius:2px;"></span>seu
      </span>
    </div>
  `;

  document.getElementById('ck-date-sel').addEventListener('change', (e) => {
    _selectedDate = e.target.value;
    drawAll();
  });

  function drawAll() {
    drawSectorCards();
    drawAreas();
  }

  function drawSectorCards() {
    const dayRes = _reservations.filter(r => r.data === _selectedDate);
    const cards = document.getElementById('ck-sector-cards');
    if (!cards) return;
    const dow = new Date(_selectedDate + 'T12:00:00').getDay();  // 0=dom..6=sab
    cards.innerHTML = (_config.sectorRules || []).map(rule => {
      const used = dayRes.filter(r => r.sector === rule.sector).length;
      const free = Math.max(0, rule.slots - used);
      const pct  = rule.slots ? Math.round((used / rule.slots) * 100) : 0;
      const color = pct >= 100 ? '#EF4444' : pct >= 70 ? '#F59E0B' : '#22C55E';
      const allowedDow = parseAllowedDow(rule.dias);
      const dayAllowed = !allowedDow.length || allowedDow.includes(dow);
      return `<div class="card" style="padding:10px 12px;
        ${!dayAllowed?'opacity:0.55;':''}border-left:3px solid ${color};">
        <div style="font-weight:600;font-size:0.875rem;">${esc(rule.sector)}</div>
        <div style="font-size:1.25rem;font-weight:700;color:${color};margin:4px 0;">
          ${used}/${rule.slots}
        </div>
        <div style="font-size:0.6875rem;color:var(--text-muted);">${free} livre${free!==1?'s':''}</div>
        <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:2px;">📅 ${esc(rule.dias)}</div>
        ${!dayAllowed?'<div style="font-size:0.625rem;color:#F59E0B;margin-top:3px;">⚠ não recomendado neste dia</div>':''}
      </div>`;
    }).join('');
  }

  function drawAreas() {
    const dayRes = _reservations.filter(r => r.data === _selectedDate);
    const myUid  = store.get('currentUser')?.uid;
    const grid   = document.getElementById('ck-area-grid');
    if (!grid) return;
    grid.innerHTML = _config.areas.map(area => {
      const used = dayRes.filter(r => r.area === area.name).length;
      const pct  = Math.round((used / area.capacity) * 100);
      const colorPct = pct >= 90 ? '#EF4444' : pct >= 60 ? '#F59E0B' : '#22C55E';

      // Renderiza N baias, cada baia = 2 fileiras (A frente, B fundo) × 6 assentos
      const baiasHtml = [];
      for (let baia = 1; baia <= area.baias; baia++) {
        const fileirasHtml = ['A', 'B'].map(fileira => {
          const seats = [];
          for (let assento = 1; assento <= area.assentosPorFileira; assento++) {
            const reserva = dayRes.find(r =>
              r.area === area.name && r.baia === baia
              && r.fileira === fileira && r.assento === assento);
            const status = reserva
              ? (reserva.checkinAt ? 'checkedin' : 'occupied')
              : 'available';
            const isMine = reserva && reserva.userId === myUid;
            const bg = status === 'available' ? 'var(--bg-surface)'
                     : status === 'checkedin' ? '#22C55E44' : '#EF444444';
            const color = status === 'available' ? 'var(--text-secondary)'
                        : status === 'checkedin' ? '#22C55E' : '#EF4444';
            const title = reserva
              ? `${reserva.userName} · ${reserva.sector}${reserva.checkinAt?' · ✅ Check-in feito':''}`
              : `Livre — ${area.displayName || area.name} · Baia ${baia} ${fileira}${assento} (clique pra reservar)`;
            seats.push(`<button class="ck-seat" data-area="${esc(area.name)}"
              data-baia="${baia}" data-fileira="${fileira}" data-assento="${assento}"
              data-status="${status}" data-rid="${reserva?.id||''}" data-mine="${isMine?'1':'0'}"
              title="${esc(title)}"
              style="width:32px;height:32px;font-size:0.75rem;border-radius:4px;
                border:1px solid ${color === 'var(--text-secondary)' ? 'var(--border-subtle)' : color};
                background:${bg};color:${color};
                cursor:${status==='available'?'pointer':'help'};
                ${isMine?'box-shadow:0 0 0 2px var(--brand-gold);font-weight:700;':''}
                font-family:var(--font-mono,monospace);">
                ${assento}</button>`);
          }
          return `<div style="display:flex;gap:4px;align-items:center;">
            <div style="font-size:0.6875rem;color:var(--text-muted);width:14px;text-align:right;">
              ${fileira}
            </div>
            <div style="display:flex;gap:4px;">${seats.join('')}</div>
          </div>`;
        }).join('<div style="height:6px;"></div>');
        baiasHtml.push(`<div style="background:rgba(255,255,255,0.02);border:1px dashed var(--border-subtle);
          border-radius:6px;padding:10px 12px;margin-bottom:14px;">
          <div style="font-size:0.6875rem;font-weight:700;color:var(--text-muted);
            text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;">
            Baia ${baia}
          </div>
          ${fileirasHtml}
        </div>`);
      }

      return `<div class="card" style="padding:16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
          <div style="font-weight:700;font-size:1rem;">${esc(area.displayName || area.name)}</div>
          <div style="font-size:0.8125rem;color:${colorPct};font-weight:600;">
            ${used}/${area.capacity} (${pct}%)
          </div>
        </div>
        ${baiasHtml.join('')}
      </div>`;
    }).join('');

    const total = _config.areas.reduce((s,a)=>s+a.capacity, 0);
    const totalPct = total ? Math.round(dayRes.length / total * 100) : 0;
    document.getElementById('ck-occupy-badge').textContent = `${dayRes.length}/${total} ocupação geral (${totalPct}%)`;
  }

  // Click em assento livre
  container.addEventListener('click', (e) => {
    const seat = e.target.closest('.ck-seat[data-status="available"]');
    if (!seat) return;
    openReserveModal(
      seat.dataset.area,
      parseInt(seat.dataset.baia),
      seat.dataset.fileira,
      parseInt(seat.dataset.assento),
      _selectedDate,
    );
  });

  drawAll();

  // ── REAL-TIME: assina mudanças nas reservas ───────────────
  // Toda criação/edição/cancelamento por outro user dispara aqui
  // em < 1s e re-desenha mapa + cards. Anti-corrida por lugares.
  _unsubscribeReservations = subscribeReservations({}, (rows) => {
    _reservations = rows;
    // Só redesenha se a aba Mapa ainda está visível
    if (activeTab === 'map' && document.getElementById('ck-area-grid')) {
      drawAll();
    }
  });
}

function parseAllowedDow(rule) {
  // Converte "Seg a Sex" / "Ter, Qui" / "Sex" pra array de dow (0..6)
  if (!rule) return [];
  const map = { 'Dom':0,'Seg':1,'Ter':2,'Qua':3,'Qui':4,'Sex':5,'Sáb':6,'Sab':6 };
  if (/a/i.test(rule)) {
    // "Seg a Sex" → 1..5
    const m = rule.match(/(\w+)\s+a\s+(\w+)/i);
    if (m) {
      const a = map[m[1].slice(0,3)], b = map[m[2].slice(0,3)];
      const out = [];
      for (let d = a; d <= b; d++) out.push(d);
      return out;
    }
  }
  return rule.split(',').map(s => map[s.trim().slice(0,3)]).filter(v => v != null);
}

function openReserveModal(area, baia, fileira, assento, date) {
  const profile = store.get('userProfile') || {};
  const sectors = (_config?.sectorRules || []).map(r => r.sector);
  const areaCfg = (_config?.areas || []).find(a => a.name === area);
  const areaDisplay = areaCfg?.displayName || area;

  modal.open({
    title: 'Reservar estação',
    size: 'sm',
    dedupeKey: `reserve:${date}:${area}:${baia}:${fileira}:${assento}`,
    content: `
      <div style="display:flex;flex-direction:column;gap:12px;">
        <div style="padding:10px 12px;background:var(--bg-surface);border-radius:6px;font-size:0.875rem;">
          <strong>${esc(areaDisplay)} · Baia ${baia} · Fileira ${fileira} · Assento ${assento}</strong><br>
          <span style="color:var(--text-muted);font-size:0.75rem;">Data: ${fmtDate(date)}</span>
        </div>
        <div class="form-group">
          <label class="form-label">Seu nome / e-mail *</label>
          <input type="text" class="form-input" id="rsv-name"
            value="${esc(profile.email || profile.name || '')}" />
        </div>
        <div class="form-group">
          <label class="form-label">Setor *</label>
          <select class="form-select" id="rsv-sector">
            <option value="">— Selecione —</option>
            ${sectors.map(s => `<option value="${esc(s)}" ${s===profile.sector||s===profile.department?'selected':''}>${esc(s)}</option>`).join('')}
          </select>
        </div>
      </div>
    `,
    footer: [
      { label: 'Cancelar', class: 'btn-secondary', closeOnClick: true },
      {
        label: 'Reservar', class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          const name   = document.getElementById('rsv-name')?.value?.trim();
          const sector = document.getElementById('rsv-sector')?.value;
          if (!name)   return toast.warning('Informe o nome.');
          if (!sector) return toast.warning('Selecione o setor.');
          try {
            await createReservation({ data: date, sector, area, baia, fileira, assento, userName: name });
            toast.success('Reserva confirmada!');
            close();
            const root = document.getElementById('checkin-content');
            if (root) renderMap(root);
          } catch (e) { toast.error(e.message); }
        },
      },
    ],
  });
}

/* ═══════════════════════════════════════════════════════════
 * 2. CHECK-IN
 * ═══════════════════════════════════════════════════════════ */
async function renderCheckinTab(container) {
  const today = todayISO();
  if (!_reservations.length) _reservations = await fetchReservations();

  const todayRes = _reservations.filter(r => r.data === today);
  const myUid    = store.get('currentUser')?.uid;
  const myProf   = store.get('userProfile') || {};
  const mineToday = todayRes.filter(r => r.userId === myUid
    || (myProf.email && (r.userName||'').toLowerCase() === myProf.email.toLowerCase()));

  if (!todayRes.length) {
    container.innerHTML = `<div class="empty-state" style="padding:40px;">
      <div class="empty-state-icon">📋</div>
      <div class="empty-state-title">Nenhuma reserva para hoje</div>
      <div class="empty-state-subtitle">Vá na aba "Mapa de Estações" pra reservar.</div>
    </div>`;
    return;
  }

  const renderItem = (r) => {
    const done = !!r.checkinAt;
    const isMine = r.userId === myUid || (myProf.email && (r.userName||'').toLowerCase() === myProf.email.toLowerCase());
    return `<div class="card" style="padding:12px 14px;display:flex;align-items:center;gap:12px;
      ${done ? 'opacity:0.6;' : ''}${isMine?'border-color:var(--brand-gold);':''}">
      <div style="font-size:1.25rem;">${done ? '✅' : '◌'}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:0.9375rem;">${esc(r.userName)}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">
          ${esc(r.sector)} · ${esc(r.area)} · Baia ${r.baia} · ${r.fileira}${r.assento}
        </div>
      </div>
      ${done
        ? `<span style="font-size:0.6875rem;padding:3px 10px;border-radius:10px;background:#22C55E22;color:#22C55E;">${fmtTS(r.checkinAt)}</span>`
        : `<button class="btn btn-primary btn-sm ck-do-checkin" data-rid="${r.id}">Fazer check-in</button>`}
    </div>`;
  };

  container.innerHTML = `
    <div style="margin-bottom:12px;font-size:0.875rem;color:var(--text-muted);">
      ${todayRes.length} reserva${todayRes.length!==1?'s':''} para hoje (${fmtDate(today)})
    </div>
    ${mineToday.length ? `
      <div style="margin-bottom:14px;font-size:0.75rem;font-weight:700;
        text-transform:uppercase;letter-spacing:.06em;color:var(--brand-gold);">Suas reservas</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:24px;">
        ${mineToday.map(renderItem).join('')}
      </div>` : ''}
    <div style="margin-bottom:14px;font-size:0.75rem;font-weight:700;
      text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);">Todas de hoje</div>
    <div style="display:flex;flex-direction:column;gap:8px;">
      ${todayRes.filter(r => !mineToday.includes(r)).map(renderItem).join('')}
    </div>
  `;

  container.querySelectorAll('.ck-do-checkin').forEach(btn => {
    btn.addEventListener('click', () => openCheckinFormModal(btn.dataset.rid));
  });
}

function openCheckinFormModal(reservationId) {
  const r = _reservations.find(x => x.id === reservationId);
  if (!r) return;

  const items = [
    { key: 'caboRede',    label: '🔌 Cabo de Rede' },
    { key: 'caboMonitor', label: '🖥 Cabo do Monitor' },
    { key: 'cadeira',     label: '🪑 Cadeira' },
  ];

  // State local do modal pra speedtest (obrigatório)
  let speedDone = false;
  let speedData = { download: null, upload: null, tipo: null };

  modal.open({
    title: 'Confirmar check-in',
    size: 'md',
    dedupeKey: `checkin:${reservationId}`,
    content: `
      <div style="display:flex;flex-direction:column;gap:16px;">
        <div style="padding:10px 12px;background:var(--bg-surface);border-radius:6px;font-size:0.8125rem;">
          <strong>${esc(r.userName)}</strong> · ${esc(r.sector)}<br>
          ${esc(r.area)} · Baia ${r.baia} · Fileira ${r.fileira} · Assento ${r.assento}
        </div>

        <!-- Itens da estação -->
        <div>
          <div style="font-weight:600;font-size:0.875rem;margin-bottom:8px;">
            ① Itens da estação
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            ${items.map(i => `
              <div style="border:1px solid var(--border-subtle);border-radius:6px;padding:10px;
                background:var(--bg-elevated);">
                <div style="font-size:0.875rem;margin-bottom:6px;">${i.label}</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                  <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:0.8125rem;">
                    <input type="radio" name="ck-${i.key}" value="ok" /> ✅ Funcionando
                  </label>
                  <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:0.8125rem;">
                    <input type="radio" name="ck-${i.key}" value="fail" /> ❌ Com defeito
                  </label>
                </div>
                <textarea id="ck-${i.key}-note" placeholder="Descreva o defeito..." class="form-input"
                  style="display:none;margin-top:6px;font-size:0.8125rem;min-height:50px;"></textarea>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Speedtest OBRIGATÓRIO -->
        <div>
          <div style="font-weight:600;font-size:0.875rem;margin-bottom:8px;">
            ② Análise da internet
            <span style="font-size:0.75rem;color:var(--color-danger);font-weight:400;">(obrigatório)</span>
          </div>
          <div style="border:1px solid var(--border-subtle);border-radius:6px;padding:12px;
            background:var(--bg-elevated);">
            <button class="btn btn-primary" id="ck-speedtest-btn" style="width:100%;margin-bottom:10px;">
              🚀 Iniciar teste de velocidade
            </button>
            <div id="ck-speedtest-results" style="display:none;">
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
                <div style="text-align:center;padding:8px;background:var(--bg-surface);border-radius:4px;">
                  <div style="font-size:0.6875rem;color:var(--text-muted);">⬇ Download</div>
                  <div style="font-size:1.125rem;font-weight:700;color:var(--brand-gold);" id="ck-st-dl">—</div>
                  <div style="font-size:0.625rem;color:var(--text-muted);">Mbps</div>
                </div>
                <div style="text-align:center;padding:8px;background:var(--bg-surface);border-radius:4px;">
                  <div style="font-size:0.6875rem;color:var(--text-muted);">⬆ Upload</div>
                  <div style="font-size:1.125rem;font-weight:700;color:var(--brand-gold);" id="ck-st-ul">—</div>
                  <div style="font-size:0.625rem;color:var(--text-muted);">Mbps</div>
                </div>
              </div>
              <label style="font-size:0.75rem;color:var(--text-muted);">Tipo de conexão (auto-detectado, ajuste se necessário)</label>
              <select class="form-select" id="ck-st-tipo" style="margin-top:4px;">
                <option value="desktop-cabo">🖥️ Desktop · Cabo de Rede</option>
                <option value="desktop-wifi">💻 Desktop · Wi-Fi</option>
                <option value="celular-wifi">📱 Celular · Wi-Fi</option>
                <option value="celular-dados">📱 Celular · Dados móveis</option>
              </select>
            </div>
          </div>
        </div>
      </div>
    `,
    footer: [
      { label: 'Cancelar', class: 'btn-secondary', closeOnClick: true },
      {
        label: '✅ Confirmar check-in', class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          // Validação 1: itens
          const itemsData = {};
          for (const i of items) {
            const v = document.querySelector(`input[name="ck-${i.key}"]:checked`)?.value;
            if (!v) return toast.warning('Marque o status de todos os itens.');
            itemsData[i.key] = {
              status: v,
              defeito: v === 'fail' ? document.getElementById(`ck-${i.key}-note`)?.value?.trim() || '' : '',
            };
          }
          // Validação 2: speedtest obrigatório
          if (!speedDone) {
            return toast.warning('Rode o teste de velocidade antes de confirmar.');
          }
          const tipo = document.getElementById('ck-st-tipo')?.value;
          const speedtest = {
            download: speedData.download,
            upload:   speedData.upload,
            tipo:     TIPO_LABELS[tipo] || tipo,
          };
          try {
            await performCheckin(reservationId, { items: itemsData, speedtest });
            toast.success('Check-in realizado! ✅');
            close();
            const root = document.getElementById('checkin-content');
            if (root) renderCheckinTab(root);
          } catch (e) { toast.error(e.message); }
        },
      },
    ],
  });

  setTimeout(() => {
    // Defeito toggle
    items.forEach(i => {
      document.querySelectorAll(`input[name="ck-${i.key}"]`).forEach(input => {
        input.addEventListener('change', () => {
          const note = document.getElementById(`ck-${i.key}-note`);
          if (note) note.style.display = input.value === 'fail' && input.checked ? 'block' : 'none';
        });
      });
    });
    // Speedtest button
    document.getElementById('ck-speedtest-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('ck-speedtest-btn');
      btn.disabled = true;
      btn.textContent = '⏳ Testando download...';
      try {
        // Roda em duas fases pra mostrar progresso
        const r = await runSpeedTest();
        speedData = { download: r.download, upload: r.upload, tipo: r.tipo };
        document.getElementById('ck-st-dl').textContent = r.download;
        document.getElementById('ck-st-ul').textContent = r.upload;
        const tipoSel = document.getElementById('ck-st-tipo');
        if (tipoSel) tipoSel.value = r.tipo;
        document.getElementById('ck-speedtest-results').style.display = 'block';
        btn.textContent = '✅ Teste concluído (rodar de novo)';
        btn.disabled = false;
        speedDone = true;
      } catch (e) {
        btn.textContent = '⚠ Erro — tentar de novo';
        btn.disabled = false;
        toast.error('Erro no teste: ' + e.message);
      }
    });
  }, 100);
}

/* ═══════════════════════════════════════════════════════════
 * 3. PONTO
 * ═══════════════════════════════════════════════════════════ */
async function renderClockTab(container) {
  const today  = todayISO();
  const my     = await fetchMyTimeClock(today);
  const recent = await fetchTimeClockRange({ from: weekAgo(), to: today });

  const events = [
    { key: 'in',       label: 'Entrada',         icon: '🌅', desc: 'início do expediente' },
    { key: 'lunchOut', label: 'Saída p/ almoço', icon: '🍽',  desc: 'pausa pra refeição' },
    { key: 'lunchIn',  label: 'Volta do almoço', icon: '↩️', desc: 'fim da pausa' },
    { key: 'out',      label: 'Saída',           icon: '🌇', desc: 'fim do expediente' },
  ];

  const declined = my?.declined && !my?.in;

  const cardOf = (ev) => {
    const has = my && my[ev.key];
    return `<div class="card" style="padding:14px;display:flex;align-items:center;gap:12px;
      ${has?'border-color:#22C55E;background:rgba(34,197,94,0.05);':''}">
      <div style="font-size:1.5rem;">${ev.icon}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:0.9375rem;">${ev.label}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">${ev.desc}</div>
      </div>
      ${has
        ? `<span style="font-weight:700;color:#22C55E;font-size:1rem;">${fmtTS(my[ev.key])}</span>`
        : declined
          ? `<span style="font-size:0.6875rem;color:#F59E0B;">não registra hoje</span>`
          : `<button class="btn btn-primary btn-sm ck-clock-btn" data-evt="${ev.key}">Registrar</button>`}
    </div>`;
  };

  const worked = my && !declined ? calcWorkedHours(my).toFixed(2) : '0.00';

  container.innerHTML = `
    ${declined ? `<div class="card" style="padding:12px 16px;margin-bottom:14px;
      background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.4);">
      <div style="font-weight:600;color:#F59E0B;">⚠ Você optou por não registrar ponto hoje</div>
      ${my.declineReason ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:3px;">"${esc(my.declineReason)}"</div>` : ''}
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:6px;">
        Esta decisão fica registrada no relatório.
      </div>
    </div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;margin-bottom:24px;">
      ${events.map(cardOf).join('')}
    </div>
    <div class="card" style="padding:14px 16px;margin-bottom:24px;
      background:rgba(212,168,67,0.06);border:1px solid rgba(212,168,67,0.25);">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:0.875rem;color:var(--text-secondary);">Horas trabalhadas hoje</span>
        <span style="font-size:1.5rem;font-weight:700;color:var(--brand-gold);">${worked}h</span>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <div class="card-title">Últimos 7 dias</div>
      </div>
      <div class="card-body" style="padding:0;">
        ${recent.length ? `<table class="data-table" style="width:100%;">
          <thead><tr><th>Data</th><th>Entrada</th><th>Almoço (saída)</th><th>Almoço (volta)</th><th>Saída</th><th>Horas</th></tr></thead>
          <tbody>${recent.map(r => {
            if (r.declined && !r.in) {
              return `<tr style="opacity:0.55;">
                <td>${fmtDate(r.date)}</td>
                <td colspan="4" style="font-style:italic;color:#F59E0B;">⚠ Optou por não registrar</td>
                <td>—</td>
              </tr>`;
            }
            return `<tr>
              <td>${fmtDate(r.date)}</td>
              <td>${fmtTS(r.in)}</td>
              <td>${fmtTS(r.lunchOut)}</td>
              <td>${fmtTS(r.lunchIn)}</td>
              <td>${fmtTS(r.out)}</td>
              <td><strong>${calcWorkedHours(r).toFixed(2)}h</strong></td>
            </tr>`;
          }).join('')}</tbody>
        </table>` : `<div class="empty-state" style="padding:24px;">
          <div class="empty-state-title" style="font-size:0.875rem;">Sem registros nos últimos 7 dias.</div>
        </div>`}
      </div>
    </div>
  `;

  container.querySelectorAll('.ck-clock-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = '⏳';
      try {
        await clockEvent(btn.dataset.evt);
        toast.success('Registrado!');
        renderClockTab(container);
        // Atualiza header timer
        if (window.__updateClockTimer) window.__updateClockTimer();
      } catch (e) {
        toast.error(e.message);
        btn.disabled = false; btn.textContent = 'Registrar';
      }
    });
  });
}

function weekAgo() {
  const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0,0,0,0);
  return d.toISOString().slice(0,10);
}

/* ═══════════════════════════════════════════════════════════
 * 4. RELATÓRIO
 * ═══════════════════════════════════════════════════════════ */
async function renderReportTab(container) {
  const monthAgo = (() => { const d = new Date(); d.setDate(d.getDate()-30); return d.toISOString().slice(0,10); })();
  const all = await fetchAllTimeClock({ from: monthAgo, to: todayISO() });

  const byUser = {};
  let totalDeclined = 0;
  all.forEach(r => {
    const k = r.userId;
    if (!byUser[k]) byUser[k] = { name: r.userName, sector: r.sector, days: 0, totalHours: 0, complete: 0, declined: 0 };
    if (r.declined && !r.in) {
      byUser[k].declined += 1;
      totalDeclined += 1;
      return;
    }
    byUser[k].days += 1;
    byUser[k].totalHours += calcWorkedHours(r);
    if (r.in && r.out) byUser[k].complete += 1;
  });
  const rows = Object.entries(byUser).map(([uid, d]) => ({
    uid, ...d,
    avgHours: d.days ? d.totalHours / d.days : 0,
    completion: d.days ? Math.round(d.complete / d.days * 100) : 0,
  })).sort((a,b) => b.totalHours - a.totalHours);

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;font-size:0.875rem;color:var(--text-muted);">
      <span>Período: últimos 30 dias</span>
      <span>·</span>
      <span>${all.length} registros</span>
      <span>·</span>
      <span>${rows.length} colaboradores</span>
      ${totalDeclined ? `<span>·</span><span style="color:#F59E0B;">⚠ ${totalDeclined} recusas de ponto</span>` : ''}
    </div>
    <div class="card">
      <div class="card-header">
        <div class="card-title">📊 Resumo de ponto por colaborador</div>
        <button class="btn btn-secondary btn-sm" id="ck-export-csv">↓ Exportar CSV</button>
      </div>
      <div class="card-body" style="padding:0;">
        ${rows.length ? `<table class="data-table" style="width:100%;">
          <thead><tr>
            <th>Colaborador</th><th>Setor</th>
            <th style="text-align:right;">Dias</th>
            <th style="text-align:right;">Total horas</th>
            <th style="text-align:right;">Média/dia</th>
            <th style="text-align:right;">Completos</th>
            <th style="text-align:right;">Recusas</th>
          </tr></thead>
          <tbody>${rows.map(r => `<tr>
            <td><strong>${esc(r.name)}</strong></td>
            <td>${esc(r.sector)}</td>
            <td style="text-align:right;">${r.days}</td>
            <td style="text-align:right;color:var(--brand-gold);font-weight:600;">${r.totalHours.toFixed(1)}h</td>
            <td style="text-align:right;">${r.avgHours.toFixed(2)}h</td>
            <td style="text-align:right;">${r.completion}%</td>
            <td style="text-align:right;${r.declined>0?'color:#F59E0B;font-weight:600;':''}">${r.declined||'—'}</td>
          </tr>`).join('')}</tbody>
        </table>` : `<div class="empty-state" style="padding:32px;">
          <div class="empty-state-title">Nenhum registro de ponto no período.</div>
        </div>`}
      </div>
    </div>
  `;

  document.getElementById('ck-export-csv')?.addEventListener('click', () => {
    const csv = [
      'colaborador;setor;dias;total_horas;media_horas_dia;dias_completos_pct;recusas',
      ...rows.map(r => `${r.name};${r.sector};${r.days};${r.totalHours.toFixed(2)};${r.avgHours.toFixed(2)};${r.completion}%;${r.declined||0}`),
    ].join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `ponto_${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function weekdayLabel(iso) {
  const d = new Date(iso + 'T12:00:00');
  return ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][d.getDay()];
}

/* ═══════════════════════════════════════════════════════════
 * 5. ADMINISTRAÇÃO (admin/master only)
 * Editar áreas (capacidade, baias, assentos) + regras por setor
 * ═══════════════════════════════════════════════════════════ */
async function renderAdminTab(container) {
  // Estado local da edição (clones do _config, salvos no botão final)
  const draftAreas   = JSON.parse(JSON.stringify(_config.areas || []));
  const draftSectors = JSON.parse(JSON.stringify(_config.sectorRules || []));

  function render() {
    container.innerHTML = `
      <div style="margin-bottom:16px;font-size:0.875rem;color:var(--text-muted);">
        Configure áreas físicas (Aquário/Salão/...) e regras de capacidade por setor.
        Mudanças afetam imediatamente todos os usuários (real-time).
      </div>

      <!-- ÁREAS FÍSICAS -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <div>
            <div class="card-title">🗺 Áreas físicas</div>
            <div class="card-subtitle">Cada área tem N baias × 2 fileiras (frente/fundo) × 6 assentos.</div>
          </div>
          <button class="btn btn-secondary btn-sm" id="adm-add-area">+ Nova área</button>
        </div>
        <div class="card-body" style="padding:0;">
          <table class="data-table" style="width:100%;">
            <thead><tr>
              <th>Chave (DB)</th><th>Nome (UI)</th>
              <th style="text-align:right;">Baias</th>
              <th style="text-align:right;">Assentos/fileira</th>
              <th style="text-align:right;">Capacidade</th>
              <th></th>
            </tr></thead>
            <tbody id="adm-areas-tbody">
              ${draftAreas.map((a, i) => `<tr>
                <td><input type="text" class="form-input adm-a-name" data-i="${i}"
                  value="${esc(a.name)}" style="font-family:var(--font-mono,monospace);font-size:0.8125rem;" /></td>
                <td><input type="text" class="form-input adm-a-disp" data-i="${i}"
                  value="${esc(a.displayName || a.name)}" style="font-size:0.8125rem;" /></td>
                <td style="text-align:right;width:80px;">
                  <input type="number" class="form-input adm-a-baias" data-i="${i}" min="1" max="20"
                    value="${a.baias}" style="text-align:right;width:60px;" />
                </td>
                <td style="text-align:right;width:120px;">
                  <input type="number" class="form-input adm-a-spf" data-i="${i}" min="1" max="20"
                    value="${a.assentosPorFileira}" style="text-align:right;width:60px;" />
                </td>
                <td style="text-align:right;width:80px;font-weight:600;color:var(--brand-gold);">
                  ${(a.baias || 0) * 2 * (a.assentosPorFileira || 0)}
                </td>
                <td><button class="btn btn-ghost btn-icon btn-sm adm-a-del" data-i="${i}" title="Excluir">✕</button></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- REGRAS DE SETOR -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <div>
            <div class="card-title">🏢 Regras por setor</div>
            <div class="card-subtitle">
              Capacidade máxima de reservas por dia + dias permitidos.
              <strong>Setor</strong> vem dos cadastros do sistema (não é texto livre).
            </div>
          </div>
          <button class="btn btn-secondary btn-sm" id="adm-add-sector">+ Novo setor</button>
        </div>
        <div class="card-body" style="padding:0;">
          <table class="data-table" style="width:100%;">
            <thead><tr>
              <th>Setor</th>
              <th style="text-align:right;">Slots/dia</th>
              <th>Dias permitidos</th>
              <th></th>
            </tr></thead>
            <tbody id="adm-sectors-tbody">
              ${draftSectors.map((s, i) => {
                // Setor inválido (não está mais nos cadastros): mantém a chave mas marca
                const isOrphan = !REQUESTING_AREAS.includes(s.sector);
                // Outros setores já usados (pra desabilitar duplicatas no select)
                const usedElsewhere = draftSectors
                  .filter((_, j) => j !== i)
                  .map(x => x.sector);
                return `<tr>
                  <td>
                    <select class="form-select adm-s-name" data-i="${i}" style="font-size:0.8125rem;">
                      ${REQUESTING_AREAS.map(area => `
                        <option value="${esc(area)}"
                          ${area === s.sector ? 'selected' : ''}
                          ${usedElsewhere.includes(area) ? 'disabled' : ''}>
                          ${esc(area)}${usedElsewhere.includes(area) ? ' (já usado)' : ''}
                        </option>`).join('')}
                      ${isOrphan ? `<option value="${esc(s.sector)}" selected>⚠ ${esc(s.sector)} (fora do cadastro)</option>` : ''}
                    </select>
                  </td>
                  <td style="text-align:right;width:120px;">
                    <input type="number" class="form-input adm-s-slots" data-i="${i}" min="0" max="200"
                      value="${s.slots}" style="text-align:right;width:80px;" />
                  </td>
                  <td>
                    <select class="form-select adm-s-dias-quick" data-i="${i}" style="font-size:0.8125rem;width:auto;display:inline-block;margin-right:6px;">
                      <option value="">— preset —</option>
                      <option value="Seg a Sex">Seg a Sex (semana toda)</option>
                      <option value="Seg, Ter, Qua, Qui, Sex">Cada dia da semana</option>
                      <option value="Seg, Qua, Sex">Alternados (Seg/Qua/Sex)</option>
                      <option value="Ter, Qui">Apenas Ter, Qui</option>
                      <option value="Sex">Apenas Sex</option>
                    </select>
                    <input type="text" class="form-input adm-s-dias" data-i="${i}"
                      value="${esc(s.dias)}" style="font-size:0.8125rem;width:calc(100% - 130px);display:inline-block;"
                      placeholder='Ex: "Seg a Sex" / "Ter, Qui"' />
                  </td>
                  <td><button class="btn btn-ghost btn-icon btn-sm adm-s-del" data-i="${i}" title="Excluir">✕</button></td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button class="btn btn-secondary" id="adm-reset">Restaurar padrão</button>
        <button class="btn btn-primary" id="adm-save">💾 Salvar configuração</button>
      </div>
    `;

    // Bindings
    container.querySelectorAll('.adm-a-name, .adm-a-disp, .adm-a-baias, .adm-a-spf')
      .forEach(inp => inp.addEventListener('change', (e) => {
        const i = parseInt(e.target.dataset.i);
        if (e.target.classList.contains('adm-a-name'))  draftAreas[i].name = e.target.value.trim();
        if (e.target.classList.contains('adm-a-disp'))  draftAreas[i].displayName = e.target.value.trim();
        if (e.target.classList.contains('adm-a-baias')) draftAreas[i].baias = parseInt(e.target.value) || 0;
        if (e.target.classList.contains('adm-a-spf'))   draftAreas[i].assentosPorFileira = parseInt(e.target.value) || 0;
        // Recalc capacity
        draftAreas[i].capacity = (draftAreas[i].baias || 0) * 2 * (draftAreas[i].assentosPorFileira || 0);
        render();
      }));
    container.querySelectorAll('.adm-a-del').forEach(btn =>
      btn.addEventListener('click', () => {
        if (!confirm('Excluir esta área? Reservas existentes não serão afetadas.')) return;
        draftAreas.splice(parseInt(btn.dataset.i), 1);
        render();
      }));
    container.querySelector('#adm-add-area')?.addEventListener('click', () => {
      draftAreas.push({ name: 'NovaArea', displayName: 'Nova Área', baias: 1, assentosPorFileira: 6, capacity: 12 });
      render();
    });
    container.querySelectorAll('.adm-s-name, .adm-s-slots, .adm-s-dias')
      .forEach(inp => inp.addEventListener('change', (e) => {
        const i = parseInt(e.target.dataset.i);
        if (e.target.classList.contains('adm-s-name')) {
          draftSectors[i].sector = e.target.value.trim();
          render(); // re-render pra atualizar disabled dos outros selects
          return;
        }
        if (e.target.classList.contains('adm-s-slots')) draftSectors[i].slots  = parseInt(e.target.value) || 0;
        if (e.target.classList.contains('adm-s-dias'))  draftSectors[i].dias   = e.target.value.trim();
      }));
    // Preset de dias: ao escolher, copia pro input texto
    container.querySelectorAll('.adm-s-dias-quick').forEach(sel =>
      sel.addEventListener('change', (e) => {
        const i = parseInt(e.target.dataset.i);
        const v = e.target.value;
        if (!v) return;
        draftSectors[i].dias = v;
        render();
      }));
    container.querySelectorAll('.adm-s-del').forEach(btn =>
      btn.addEventListener('click', () => {
        if (!confirm('Excluir este setor?')) return;
        draftSectors.splice(parseInt(btn.dataset.i), 1);
        render();
      }));
    container.querySelector('#adm-add-sector')?.addEventListener('click', () => {
      // Pega primeiro setor cadastrado que ainda não está em uso
      const used = draftSectors.map(s => s.sector);
      const available = REQUESTING_AREAS.find(a => !used.includes(a));
      if (!available) {
        toast.warning('Todos os setores cadastrados já estão configurados.');
        return;
      }
      draftSectors.push({ sector: available, slots: 5, dias: 'Seg a Sex' });
      render();
    });
    container.querySelector('#adm-reset')?.addEventListener('click', () => {
      if (!confirm('Restaurar configuração padrão? Suas alterações em rascunho serão perdidas.')) return;
      draftAreas.length   = 0; DEFAULT_AREAS.forEach(a => draftAreas.push({...a}));
      draftSectors.length = 0; DEFAULT_SECTOR_RULES.forEach(s => draftSectors.push({...s}));
      render();
    });
    container.querySelector('#adm-save')?.addEventListener('click', async () => {
      const btn = container.querySelector('#adm-save');
      btn.disabled = true; btn.textContent = '💾 Salvando...';
      try {
        // Recalc capacity em todas
        draftAreas.forEach(a => {
          a.capacity = (a.baias || 0) * 2 * (a.assentosPorFileira || 0);
        });
        await saveCheckinConfig({ areas: draftAreas, sectorRules: draftSectors });
        _config = { areas: draftAreas, sectorRules: draftSectors };
        toast.success('Configuração salva! Mudanças refletem em todos os usuários em real-time.');
        btn.disabled = false; btn.textContent = '💾 Salvar configuração';
      } catch (e) {
        toast.error(e.message);
        btn.disabled = false; btn.textContent = '💾 Salvar configuração';
      }
    });
  }

  render();
}
