/**
 * PRIMETOUR — Portal de Solicitações (Fase 4)
 * Página pública — sem autenticação
 */

import { initializeApp }  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, collection, addDoc, getDocs,
  query, where, orderBy, limit, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* ─── Config Firebase (duplicada do config.js — portal é standalone) */
const FIREBASE_CONFIG = {
  // Será preenchido automaticamente via config.js no build
  // Por ora, importa dinamicamente
};

/* ─── Bootstrap ───────────────────────────────────────────── */
async function boot() {
  // Importar config do app principal
  const configModule = await import('../config.js').catch(() => null);
  const firebaseConfig = configModule?.firebaseConfig;
  if (!firebaseConfig) {
    showError('Configuração do sistema não encontrada.');
    return;
  }

  const app = initializeApp(firebaseConfig, 'portal');
  const db  = getFirestore(app);

  // Carregar tipos de tarefa disponíveis
  const taskTypes = await loadTaskTypes(db);
  renderForm(db, taskTypes);
}

async function loadTaskTypes(db) {
  try {
    // No orderBy to avoid composite index requirement
    const snap = await getDocs(collection(db, 'task_types'));
    const types = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Sort client-side
    return types.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR'));
  } catch(e) {
    console.warn('loadTaskTypes error:', e.message);
    // Fallback: return newsletter as minimum
    return [{ id: 'newsletter', name: 'Newsletter', icon: '📧', color: '#D4A843',
      sla: { days: 2, label: '2 dias úteis' } }];
  }
}

/* ─── Load nucleos from Firestore by sector ─────────────── */
async function loadNucleosBySector(db, sector) {
  try {
    const snap = await getDocs(query(
      collection(db, 'nucleos'),
      where('sector', '==', sector)
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => a.name.localeCompare(b.name,'pt-BR'));
  } catch(e) {
    return [];
  }
}

/* ─── Setores (espelha REQUESTING_AREAS) ────────────────── */
// NUCLEOS agora são carregados do Firestore por setor

const REQUESTING_AREAS = [
  'BTG','C&P','Célula ICs','Centurion','CEP','Concierge Bradesco',
  'Contabilidade','Diretoria','Eventos','Financeiro','Lazer','Marketing',
  'Operadora','Programa ICs','Projetos','PTS Bradesco','Qualidade','Suppliers','TI',
];

/* ─── Render form ─────────────────────────────────────────── */
async function renderForm(db, taskTypes) {
  const root = document.getElementById('portal-root');
  if (!root) return;

  root.innerHTML = `
    <div class="portal-wrap">
      <!-- Header -->
      <header class="portal-header">
        <div class="portal-brand">
          <div class="portal-brand-icon">✦</div>
          <div>
            <div class="portal-brand-name">PRIMETOUR</div>
            <div class="portal-brand-sub">Portal de Solicitações</div>
          </div>
        </div>
      </header>

      <main class="portal-main">
        <div class="portal-container">
          <!-- Form view -->
          <div id="form-view">
            <h1 class="portal-title">Faça sua solicitação</h1>
            <p class="portal-subtitle">
              Preencha o formulário abaixo para enviar uma demanda ao time de produção.
              Nossa equipe irá analisar e entrar em contato em breve.
            </p>

            <!-- Seção 1: Identificação -->
            <div class="portal-card">
              <div class="portal-card-title">Seus dados</div>
              <div class="form-grid-2">
                <div class="form-group" id="fg-name">
                  <label class="form-label">Nome <span class="required">*</span></label>
                  <input type="text" class="form-input" id="p-name"
                    placeholder="Seu nome completo" maxlength="80" autocomplete="name" />
                  <div class="form-error" id="err-name">Campo obrigatório.</div>
                </div>
                <div class="form-group" id="fg-email">
                  <label class="form-label">E-mail <span class="required">*</span></label>
                  <input type="email" class="form-input" id="p-email"
                    placeholder="seu@email.com" autocomplete="email" />
                  <div class="form-error" id="err-email">E-mail inválido.</div>
                </div>
              </div>
              <div class="form-group" id="fg-area">
                <label class="form-label">Área solicitante <span class="required">*</span></label>
                <select class="form-select" id="p-area">
                  <option value="">— Selecione sua área —</option>
                  ${REQUESTING_AREAS.map(a => `<option value="${a}">${a}</option>`).join('')}
                </select>
                <div class="form-error" id="err-area">Selecione uma área.</div>
              </div>
            </div>

            <!-- Seção 2: Demanda -->
            <div class="portal-card">
              <div class="portal-card-title">Detalhes da demanda</div>

              <div class="form-group" id="fg-type">
                <label class="form-label">
                  Tipo de demanda <span class="required">*</span>
                  <span class="info-tip" title="Selecione a categoria que melhor descreve o que você precisa.">ℹ</span>
                </label>
                <select class="form-select" id="p-type">
                  <option value="">— Selecione o tipo —</option>
                  ${taskTypes.length
                    ? taskTypes.map(t => `<option value="${t.id}" data-sla='${JSON.stringify(t.sla||null)}'>${t.icon||''} ${t.name}</option>`).join('')
                    : '<option value="geral">Demanda geral</option>'}
                </select>
                <div class="form-error" id="err-type">Selecione um tipo.</div>
                <!-- SLA badge -->
                <div class="sla-badge" id="sla-badge">
                  <span style="color:var(--brand-gold);">⏱</span>
                  <span>SLA de produção: <strong id="sla-label"></strong></span>
                </div>
              </div>

              <div class="form-group" id="fg-setor">
                <label class="form-label">
                  Setor responsável <span class="required">*</span>
                  <span class="info-tip" title="Selecione o setor que receberá esta demanda.">ℹ</span>
                </label>
                <select class="form-select" id="p-setor">
                  <option value="">— Selecione o setor —</option>
                  ${REQUESTING_AREAS.map(a => `<option value="${a}">${a}</option>`).join('')}
                </select>
                <div class="form-error" id="err-setor">Selecione um setor.</div>
              </div>

              <div class="form-group" id="fg-nucleo" style="display:none;">
                <label class="form-label">
                  Núcleo responsável
                  <span class="info-tip" title="Selecione o núcleo de produção que receberá esta demanda.">ℹ</span>
                </label>
                <select class="form-select" id="p-nucleo">
                  <option value="">— Selecione o núcleo —</option>
                </select>
              </div>

              <div class="form-group" id="fg-desc">
                <label class="form-label">Descrição da demanda <span class="required">*</span></label>
                <textarea class="form-textarea" id="p-desc" rows="4"
                  placeholder="Descreva em detalhes o que você precisa, contexto, referências e objetivos..."></textarea>
                <div class="form-error" id="err-desc">Descreva sua demanda.</div>
              </div>
            </div>

            <!-- Seção 3: Data desejada -->
            <div class="portal-card">
              <div class="portal-card-title">Prazo desejado</div>
              <div class="form-group">
                <label class="form-label">
                  Data desejada para entrega
                  <span class="info-tip" title="Indicativa — o time avaliará a viabilidade conforme o calendário.">ℹ</span>
                </label>
                <input type="date" class="form-input" id="p-date"
                  min="${getMinDate()}" />

                <!-- Calendar slots -->
                <div class="slots-container" id="slots-container">
                  <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:8px;">
                    Próximas datas disponíveis — clique para selecionar:
                  </p>
                  <div class="slots-week" id="slots-week"></div>
                </div>
              </div>

              <!-- Urgency -->
              <div class="form-group">
                <label class="form-label">
                  Prioridade
                  <span class="info-tip" title="Use urgência apenas quando há um prazo real e inegociável.">ℹ</span>
                </label>
                <label class="urgency-toggle" id="urgency-toggle">
                  <input type="checkbox" id="p-urgency" />
                  <div class="urgency-dot" id="urgency-dot">✓</div>
                  <div>
                    <div style="font-size:0.9375rem;color:var(--text-primary);font-weight:500;">
                      Marcar como urgente
                    </div>
                    <div style="font-size:0.8125rem;color:var(--text-muted);">
                      Selecione somente se há um prazo real e inegociável.
                    </div>
                  </div>
                </label>

                <!-- Alerta educativo urgência -->
                <div class="alert-banner warning" id="urgency-alert">
                  <span style="font-size:1.125rem;flex-shrink:0;">⚠</span>
                  <span>
                    <strong>Atenção:</strong> Urgências injustificadas prejudicam o planejamento
                    e a qualidade das entregas de toda a equipe. Use este campo apenas quando há
                    um prazo real e inegociável. Sua solicitação será avaliada pela equipe.
                  </span>
                </div>
              </div>

              <!-- Alerta fora do calendário -->
              <div class="alert-banner info" id="calendar-alert">
                <span style="font-size:1.125rem;flex-shrink:0;">📅</span>
                <span>
                  A data selecionada não está no calendário editorial padrão.
                  O time avaliará a viabilidade de encaixe. Considere selecionar
                  uma das datas sugeridas acima.
                </span>
              </div>
            </div>

            <!-- Submit -->
            <button class="portal-submit" id="portal-submit-btn">
              Enviar solicitação →
            </button>
          </div>

          <!-- Success view -->
          <div class="success-screen" id="success-view">
            <div class="success-icon">✓</div>
            <div class="success-title">Solicitação enviada!</div>
            <p class="success-sub" id="success-msg">
              Recebemos sua solicitação. Nossa equipe irá analisar e entrar
              em contato em breve pelo e-mail informado.
            </p>
            <button class="portal-submit" id="new-request-btn"
              style="margin-top:32px;max-width:280px;">
              Fazer nova solicitação
            </button>
          </div>
        </div>
      </main>

      <footer class="portal-footer">
        PRIMETOUR &copy; ${new Date().getFullYear()} — Sistema de Gestão de Tarefas
      </footer>
    </div>
  `;

  // Load calendar slots for next 2 weeks
  await loadCalendarSlots(db, taskTypes);
  bindFormEvents(db, taskTypes);
}

/* ─── Calendar slots + Newsletter mini-calendar ────────────── */
async function loadCalendarSlots(db, taskTypes=[]) {
  const today    = new Date(); today.setHours(0,0,0,0);
  const twoWeeks = new Date(today); twoWeeks.setDate(twoWeeks.getDate() + 14);

  // Buscar newsletters do mês para mostrar ocupação
  let newsletterDates = {}; // { 'YYYY-MM-DD': [{title, requestingArea}] }
  try {
    const snap = await getDocs(query(
      collection(db, 'tasks'),
      where('type', '==', 'newsletter'),
      limit(200),
    ));
    snap.docs.forEach(d => {
      const t = d.data();
      const dateField = t.dueDate || t.startDate;
      if (!dateField) return;
      const dt  = dateField.toDate ? dateField.toDate() : new Date(dateField);
      const key = dt.toISOString().slice(0,10);
      if (!newsletterDates[key]) newsletterDates[key] = [];
      newsletterDates[key].push({ title: t.title, requestingArea: t.requestingArea || '', status: t.status });
    });
  } catch(e) {}

  const slotsWrap = document.getElementById('slots-week');
  if (!slotsWrap) return;

  const days = [];
  for (let d = new Date(today); d <= twoWeeks; d.setDate(d.getDate()+1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    days.push(new Date(d));
  }

  const DAYS_PT   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const MONTHS_PT = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

  slotsWrap.innerHTML = days.slice(0, 10).map(d => {
    const key      = d.toISOString().slice(0,10);
    const entries  = newsletterDates[key] || [];
    const taken    = entries.length > 0;
    const dow      = d.getDay();
    const tooltip  = taken
      ? entries.map(e => e.title + (e.requestingArea?' ('+e.requestingArea+')':'')).join(', ')
      : 'Disponível';

    return `
      <div class="slot-day ${taken?'slot-taken':''}"
        data-date="${key}" title="${tooltip}">
        <div class="slot-day-name">${DAYS_PT[dow]}</div>
        <div class="slot-day-num">${d.getDate()}</div>
        <div class="slot-day-info">${MONTHS_PT[d.getMonth()]}${taken?' · ocupado':''}</div>
        ${taken && entries[0] ? `
          <div style="font-size:0.5rem;color:#F59E0B;margin-top:2px;overflow:hidden;
            text-overflow:ellipsis;white-space:nowrap;max-width:100%;">
            ${entries[0].title.slice(0,14)}${entries[0].title.length>14?'…':''}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  slotsWrap.querySelectorAll('.slot-day:not(.slot-taken)').forEach(slot => {
    slot.addEventListener('click', () => {
      slotsWrap.querySelectorAll('.slot-day').forEach(s => s.classList.remove('selected'));
      slot.classList.add('selected');
      const dateInput = document.getElementById('p-date');
      if (dateInput) {
        dateInput.value = slot.dataset.date;
        dateInput.dispatchEvent(new Event('change'));
      }
    });
  });

  // Show mini calendar widget
  renderPortalCalendar(db, taskTypes, newsletterDates);
}

/* ─── Portal calendar widget ────────────────────────────── */
let portalCalGran   = 'month'; // 'month'|'week'|'day'
let portalCalDate   = new Date();
let portalCalTypeId = 'newsletter';

async function renderPortalCalendar(db, taskTypes, initialNewsletterDates) {
  const slotsContainer = document.getElementById('slots-container');
  if (!slotsContainer) return;
  document.getElementById('portal-calendar-widget')?.remove();

  // Load all task types if not passed
  let types = taskTypes;
  if (!types) {
    try {
      const snap = await getDocs(collection(db, 'task_types'));
      types = snap.docs.map(d=>({id:d.id,...d.data()}));
    } catch(e) { types = []; }
  }

  // Build calendar data
  const buildCalData = async () => {
    const y = portalCalDate.getFullYear();
    const m = portalCalDate.getMonth();
    // Tasks from Firestore
    let taskMap = {};
    try {
      const snap = await getDocs(query(
        collection(db,'tasks'),
        where('typeId','==',portalCalTypeId),
        limit(300)
      ));
      snap.docs.forEach(d=>{
        const t = d.data();
        const df = t.dueDate||t.startDate;
        if (!df) return;
        const dt = df.toDate?df.toDate():new Date(df);
        if (dt.getFullYear()!==y||dt.getMonth()!==m) return;
        const k = dt.getDate();
        if (!taskMap[k]) taskMap[k]=[];
        taskMap[k].push({title:t.title||'',requestingArea:t.requestingArea||'',status:t.status||''});
      });
    } catch(e) {}
    return taskMap;
  };

  const PT_MONTHS  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const PT_DAYS_S  = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const activeType = types.find(t=>t.id===portalCalTypeId);

  // Get schedule slots for a date
  const getSlotsForDate = (date) => {
    if (!activeType?.scheduleSlots) return [];
    const y=date.getFullYear(), m=date.getMonth(), d=date.getDate();
    const dow=date.getDay();
    const iso=`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    return (activeType.scheduleSlots||[]).filter(s=>{
      if (s.active===false) return false;
      if (s.recurrence==='weekly')       return s.weekDay===dow;
      if (s.recurrence==='monthly_days') return (s.monthDays||[]).includes(d);
      if (s.recurrence==='custom')       return (s.customDates||[]).includes(iso);
      return false;
    });
  };

  const taskMap = await buildCalData();
  const y = portalCalDate.getFullYear();
  const m = portalCalDate.getMonth();

  // Build month grid
  const buildMonth = () => {
    const firstDay = new Date(y,m,1).getDay();
    const dim = new Date(y,m+1,0).getDate();
    const today = new Date();
    let cells = '';
    for(let i=firstDay-1;i>=0;i--) cells+=`<div></div>`;
    for(let d=1;d<=dim;d++){
      const tasks  = taskMap[d]||[];
      const slots  = getSlotsForDate(new Date(y,m,d));
      const isToday= d===today.getDate()&&m===today.getMonth()&&y===today.getFullYear();
      const hasTasks= tasks.length>0;
      const hasSlots= slots.length>0;
      cells+=`<div style="min-height:60px;padding:3px;border-radius:4px;
        background:${hasTasks?'rgba(212,168,67,0.08)':hasSlots?'rgba(212,168,67,0.04)':'transparent'};
        border:1px solid ${isToday?'var(--brand-gold)':hasTasks?'rgba(212,168,67,0.3)':hasSlots?'rgba(212,168,67,0.15)':'transparent'};">
        <div style="font-size:0.6875rem;font-weight:${isToday?700:400};
          color:${isToday?'var(--brand-gold)':hasTasks?'var(--text-primary)':'var(--text-muted)'};">${d}</div>
        ${slots.map(s=>`<div style="font-size:0.5625rem;color:${s.color||'var(--brand-gold)'};
          border-bottom:1px dashed ${s.color||'var(--brand-gold)'};margin-bottom:1px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
          title="Agenda: ${s.title}">◌ ${s.title.slice(0,12)}${s.title.length>12?'…':''}</div>`).join('')}
        ${tasks.map(t=>`<div style="font-size:0.5625rem;color:var(--brand-gold);
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
          title="${t.title}${t.requestingArea?' · '+t.requestingArea:''}">● ${t.title.slice(0,12)}${t.title.length>12?'…':''}</div>`).join('')}
      </div>`;
    }
    return cells;
  };

  // Build week grid
  const buildWeek = () => {
    const base  = new Date(portalCalDate);
    const dow   = base.getDay();
    const mon   = new Date(base); mon.setDate(base.getDate()-(dow===0?6:dow-1));
    const days  = Array.from({length:7},(_,i)=>{ const d=new Date(mon); d.setDate(mon.getDate()+i); return d; });
    const today = new Date(); today.setHours(0,0,0,0);
    return days.map(d=>{
      const dm = new Date(d); dm.setHours(0,0,0,0);
      const isToday = dm.getTime()===today.getTime();
      const dayTasks = (taskMap[d.getDate()]||[]).filter(()=>d.getFullYear()===y&&d.getMonth()===m);
      const slots    = getSlotsForDate(d);
      return `<div style="padding:4px;min-height:80px;border-radius:4px;
        border:1px solid ${isToday?'var(--brand-gold)':'var(--border-subtle)'};">
        <div style="font-size:0.6875rem;color:${isToday?'var(--brand-gold)':'var(--text-muted)'};
          font-weight:${isToday?700:400};margin-bottom:3px;">${PT_DAYS_S[d.getDay()]} ${d.getDate()}</div>
        ${slots.map(s=>`<div style="font-size:0.5625rem;border:1px dashed ${s.color||'var(--brand-gold)'};
          color:${s.color||'var(--brand-gold)'};border-radius:2px;padding:1px 3px;margin-bottom:2px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="Agenda: ${s.title}">
          ◌ ${s.title.slice(0,14)}${s.title.length>14?'…':''}</div>`).join('')}
        ${dayTasks.map(t=>`<div style="font-size:0.5625rem;background:rgba(212,168,67,0.12);
          color:var(--brand-gold);border-radius:2px;padding:1px 3px;margin-bottom:2px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${t.title}">
          ● ${t.title.slice(0,14)}${t.title.length>14?'…':''}</div>`).join('')}
      </div>`;
    }).join('');
  };

  // Build day view
  const buildDay = () => {
    const d     = portalCalDate;
    const slots = getSlotsForDate(d);
    const today = new Date(); today.setHours(0,0,0,0);
    const dm    = new Date(d); dm.setHours(0,0,0,0);
    const dTasks= (taskMap[d.getDate()]||[]);
    return `<div style="padding:12px;">
      ${slots.length?`
        <div style="margin-bottom:10px;">
          <div style="font-size:0.75rem;font-weight:600;color:var(--brand-gold);margin-bottom:6px;">◌ Agenda do dia</div>
          ${slots.map(s=>`<div style="padding:8px 10px;border-radius:4px;margin-bottom:4px;
            border:1.5px dashed ${s.color||'var(--brand-gold)'};background:${s.color||'var(--brand-gold)'}08;">
            <div style="font-size:0.8125rem;font-weight:500;color:${s.color||'var(--brand-gold)'};">◌ ${s.title}</div>
            ${s.requestingArea?`<div style="font-size:0.6875rem;color:var(--text-muted);">📍 ${s.requestingArea}</div>`:''}
          </div>`).join('')}
        </div>
      `:''}
      ${dTasks.length?`
        <div>
          <div style="font-size:0.75rem;font-weight:600;color:var(--text-primary);margin-bottom:6px;">● Tarefas agendadas</div>
          ${dTasks.map(t=>`<div style="padding:8px 10px;border-radius:4px;margin-bottom:4px;
            background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.2);">
            <div style="font-size:0.8125rem;color:var(--text-primary);">${t.title}</div>
            ${t.requestingArea?`<div style="font-size:0.6875rem;color:var(--text-muted);">📍 ${t.requestingArea}</div>`:''}
          </div>`).join('')}
        </div>
      `:''}
      ${!slots.length&&!dTasks.length?`<div style="font-size:0.875rem;color:var(--text-muted);text-align:center;padding:16px 0;">Nenhuma agenda ou tarefa para este dia.</div>`:''}
    </div>`;
  };

  // Nav label
  const navLabel = () => {
    if (portalCalGran==='month') return `${PT_MONTHS[m]} ${y}`;
    if (portalCalGran==='day') {
      const d = portalCalDate;
      return `${d.getDate()} de ${PT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    }
    // week
    const base  = new Date(portalCalDate);
    const dow   = base.getDay();
    const mon   = new Date(base); mon.setDate(base.getDate()-(dow===0?6:dow-1));
    const sun   = new Date(mon); sun.setDate(mon.getDate()+6);
    return `${mon.getDate()} ${PT_MONTHS[mon.getMonth()].slice(0,3)} — ${sun.getDate()} ${PT_MONTHS[sun.getMonth()].slice(0,3)} ${sun.getFullYear()}`;
  };

  const wrap = document.createElement('div');
  wrap.id = 'portal-calendar-widget';
  wrap.style.cssText = 'margin-top:16px;';
  wrap.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:8px;padding:12px;font-family:var(--font-ui);">

      <!-- Header: type selector + gran switcher + nav -->
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px;">
        ${types.length>1?`
          <select id="pcal-type-sel" style="font-size:0.75rem;padding:4px 8px;border-radius:4px;
            border:1px solid var(--border-subtle);background:var(--bg-card);color:var(--text-primary);">
            ${types.map(t=>`<option value="${t.id}" ${portalCalTypeId===t.id?'selected':''}>${t.icon||''} ${t.name}</option>`).join('')}
          </select>
        `:`<span style="font-size:0.8125rem;font-weight:600;color:var(--brand-gold);">📅 ${activeType?.name||'Calendário'}</span>`}

        <!-- Granularity -->
        <div style="display:flex;border:1px solid var(--border-subtle);border-radius:4px;overflow:hidden;margin-left:auto;">
          ${[['month','Mês'],['week','Sem'],['day','Dia']].map(([g,l])=>`
            <button class="pcal-gran" data-gran="${g}" style="padding:3px 10px;border:none;cursor:pointer;
              font-size:0.6875rem;background:${portalCalGran===g?'var(--brand-gold)':'var(--bg-card)'};
              color:${portalCalGran===g?'#000':'var(--text-muted)'};transition:all 0.15s;">${l}</button>
          `).join('')}
        </div>

        <!-- Nav -->
        <div style="display:flex;gap:4px;">
          <button id="pcal-prev" style="padding:3px 8px;border:1px solid var(--border-subtle);
            border-radius:4px;background:transparent;color:var(--text-muted);cursor:pointer;">◀</button>
          <button id="pcal-today" style="padding:3px 8px;border:1px solid var(--border-subtle);
            border-radius:4px;background:transparent;color:var(--text-muted);cursor:pointer;font-size:0.6875rem;">Hoje</button>
          <button id="pcal-next" style="padding:3px 8px;border:1px solid var(--border-subtle);
            border-radius:4px;background:transparent;color:var(--text-muted);cursor:pointer;">▶</button>
        </div>
      </div>

      <!-- Nav title -->
      <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);margin-bottom:8px;">${navLabel()}</div>

      <!-- Legend -->
      <div style="display:flex;gap:10px;margin-bottom:8px;font-size:0.6875rem;color:var(--text-muted);">
        <span>◌ Agenda (referência)</span>
        <span>● Tarefa agendada</span>
      </div>

      <!-- Grid -->
      ${portalCalGran==='month'?`
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px;">
          ${PT_DAYS_S.map(d=>`<div style="text-align:center;font-size:0.5625rem;color:var(--text-muted);">${d[0]}</div>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;">${buildMonth()}</div>
      `:portalCalGran==='week'?`
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;">${buildWeek()}</div>
      `:buildDay()}
    </div>
  `;

  slotsContainer.after(wrap);

  // Bind events
  wrap.querySelectorAll('.pcal-gran').forEach(btn => {
    btn.addEventListener('click', () => {
      portalCalGran = btn.dataset.gran;
      renderPortalCalendar(db, types, null);
    });
  });
  wrap.querySelector('#pcal-type-sel')?.addEventListener('change', e => {
    portalCalTypeId = e.target.value;
    renderPortalCalendar(db, types, null);
  });
  wrap.querySelector('#pcal-prev')?.addEventListener('click', () => {
    if (portalCalGran==='month') portalCalDate = new Date(portalCalDate.getFullYear(), portalCalDate.getMonth()-1, 1);
    else if (portalCalGran==='week') { portalCalDate = new Date(portalCalDate); portalCalDate.setDate(portalCalDate.getDate()-7); }
    else { portalCalDate = new Date(portalCalDate); portalCalDate.setDate(portalCalDate.getDate()-1); }
    renderPortalCalendar(db, types, null);
  });
  wrap.querySelector('#pcal-next')?.addEventListener('click', () => {
    if (portalCalGran==='month') portalCalDate = new Date(portalCalDate.getFullYear(), portalCalDate.getMonth()+1, 1);
    else if (portalCalGran==='week') { portalCalDate = new Date(portalCalDate); portalCalDate.setDate(portalCalDate.getDate()+7); }
    else { portalCalDate = new Date(portalCalDate); portalCalDate.setDate(portalCalDate.getDate()+1); }
    renderPortalCalendar(db, types, null);
  });
  wrap.querySelector('#pcal-today')?.addEventListener('click', () => {
    portalCalDate = new Date();
    renderPortalCalendar(db, types, null);
  });
}


/* ─── Bind events ─────────────────────────────────────────── */
function bindFormEvents(db, taskTypes) {
  // Sector → nucleo cascade
  // Sector → nucleo cascade
  document.getElementById('p-setor')?.addEventListener('change', async (e) => {
    const sector   = e.target.value;
    const nucleoFG = document.getElementById('fg-nucleo');
    const nucleoSel= document.getElementById('p-nucleo');
    if (!sector) {
      if (nucleoFG) nucleoFG.style.display = 'none';
      return;
    }
    // Load nucleos for this sector
    const nucleos = await loadNucleosBySector(db, sector);
    if (!nucleoSel) return;
    if (!nucleos.length) {
      nucleoFG && (nucleoFG.style.display = 'none');
      return;
    }
    nucleoSel.innerHTML = '<option value="">— Selecione o núcleo —</option>' +
      nucleos.map(n => `<option value="${n.name}">${n.name}</option>`).join('');
    nucleoFG && (nucleoFG.style.display = 'block');
  });

  // Show slots when a type is selected
  document.getElementById('p-type')?.addEventListener('change', (e) => {
    const typeId   = e.target.value;
    const typeData = taskTypes.find(t => t.id === typeId);
    const slaBadge = document.getElementById('sla-badge');
    const slaLabel = document.getElementById('sla-label');
    const slotsEl  = document.getElementById('slots-container');

    if (typeData?.sla && slaBadge && slaLabel) {
      slaLabel.textContent = typeData.sla.label;
      slaBadge.classList.add('visible');
    } else if (slaBadge) {
      slaBadge.classList.remove('visible');
    }

    if (slotsEl) slotsEl.classList.add('visible');

    // Show newsletter mini-calendar when newsletter type selected
    const isNewsletter = typeData?.name?.toLowerCase().includes('newsletter') ||
                         typeId === 'newsletter';
    const miniCal = document.getElementById('newsletter-mini-cal');
    if (miniCal) miniCal.style.display = isNewsletter ? 'block' : 'none';
  });

  // Date change → out-of-calendar check
  document.getElementById('p-date')?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (!val) return;
    const d   = new Date(val + 'T12:00:00');
    const dow = d.getDay();
    const calAlert = document.getElementById('calendar-alert');
    // Weekends = out of calendar
    if (dow === 0 || dow === 6) {
      calAlert?.classList.add('visible');
    } else {
      calAlert?.classList.remove('visible');
    }
    // Sync slot selection
    document.querySelectorAll('.slot-day').forEach(s => {
      s.classList.toggle('selected', s.dataset.date === val);
    });
  });

  // Urgency toggle
  document.getElementById('urgency-toggle')?.addEventListener('click', () => {
    const cb      = document.getElementById('p-urgency');
    const toggle  = document.getElementById('urgency-toggle');
    const dot     = document.getElementById('urgency-dot');
    const alert   = document.getElementById('urgency-alert');
    if (!cb) return;
    cb.checked = !cb.checked;
    toggle?.classList.toggle('active', cb.checked);
    if (alert) alert.classList.toggle('visible', cb.checked);
  });

  // Submit
  document.getElementById('portal-submit-btn')?.addEventListener('click', () => handleSubmit(db, taskTypes));
  document.getElementById('new-request-btn')?.addEventListener('click', () => {
    document.getElementById('success-view')?.classList.remove('visible');
    document.getElementById('form-view').style.display = 'block';
    // Reset form
    document.querySelectorAll('.form-input,.form-select,.form-textarea').forEach(el => { el.value = ''; });
    document.getElementById('p-urgency').checked = false;
    document.getElementById('urgency-toggle')?.classList.remove('active');
    document.getElementById('urgency-alert')?.classList.remove('visible');
    document.getElementById('sla-badge')?.classList.remove('visible');
    document.getElementById('slots-container')?.classList.remove('visible');
  });
}

/* ─── Validation ──────────────────────────────────────────── */
function validate() {
  let ok = true;
  const rules = [
    { id: 'p-name',   errId: 'err-name',   fgId: 'fg-name',   check: v => v.trim().length >= 2 },
    { id: 'p-email',  errId: 'err-email',  fgId: 'fg-email',  check: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) },
    { id: 'p-area',   errId: 'err-area',   fgId: 'fg-area',   check: v => v !== '' },
    { id: 'p-type',   errId: 'err-type',   fgId: 'fg-type',   check: v => v !== '' },
    { id: 'p-setor',  errId: 'err-setor',  fgId: 'fg-setor',  check: v => v !== '' },
    { id: 'p-desc',   errId: 'err-desc',   fgId: 'fg-desc',   check: v => v.trim().length >= 10 },
  ];

  rules.forEach(r => {
    const el  = document.getElementById(r.id);
    const fg  = document.getElementById(r.fgId);
    const valid = el && r.check(el.value);
    fg?.classList.toggle('has-error', !valid);
    if (!valid) ok = false;
  });

  return ok;
}

/* ─── Submit ──────────────────────────────────────────────── */
async function handleSubmit(db, taskTypes) {
  if (!validate()) {
    // Scroll to first error
    document.querySelector('.has-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const btn = document.getElementById('portal-submit-btn');
  if (btn) { btn.disabled = true; btn.classList.add('loading'); btn.textContent = 'Enviando...'; }

  try {
    const typeId   = document.getElementById('p-type')?.value || '';
    const typeData = taskTypes.find(t => t.id === typeId);
    const urgency  = document.getElementById('p-urgency')?.checked || false;

    const reqDoc = {
      requesterName:  document.getElementById('p-name')?.value?.trim() || '',
      requesterEmail: document.getElementById('p-email')?.value?.trim().toLowerCase() || '',
      requestingArea: document.getElementById('p-area')?.value || '',
      sector:         document.getElementById('p-setor')?.value  || '',
      typeId,
      typeName:       typeData?.name || typeId,
      nucleo:         document.getElementById('p-nucleo')?.value || '',
      requestingSetor: document.getElementById('p-setor')?.value   || '',
      description:    document.getElementById('p-desc')?.value?.trim() || '',
      urgency,
      desiredDate:    document.getElementById('p-date')?.value
        ? new Date(document.getElementById('p-date').value + 'T12:00:00')
        : null,
      status:         'pending',
      taskId:         null,
      workspaceId:    null,
      createdAt:      serverTimestamp(),
      updatedAt:      serverTimestamp(),
    };

    const ref = await addDoc(collection(db, 'requests'), reqDoc);

    // Notify team via EmailJS
    await notifyTeam({ ...reqDoc, requestId: ref.id }).catch(() => {});

    // Show success
    document.getElementById('form-view').style.display = 'none';
    const successView = document.getElementById('success-view');
    successView?.classList.add('visible');
    const msg = document.getElementById('success-msg');
    if (msg) {
      msg.textContent = urgency
        ? `Recebemos sua solicitação urgente. Nossa equipe será notificada imediatamente e entrará em contato com ${reqDoc.requesterEmail}.`
        : `Recebemos sua solicitação. Nossa equipe analisará e entrará em contato com ${reqDoc.requesterEmail} em breve.`;
    }
  } catch(e) {
    alert('Erro ao enviar solicitação: ' + e.message);
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); btn.textContent = 'Enviar solicitação →'; }
  }
}

/* ─── Email notification ──────────────────────────────────── */
async function notifyTeam({ requesterName, requesterEmail, typeName, nucleo, urgency, requestId }) {
  try {
    const configModule = await import('../config.js').catch(() => null);
    const cfg = configModule?.APP_CONFIG?.emailjs;
    if (!cfg?.publicKey || cfg.publicKey === 'SUA_EMAILJS_PUBLIC_KEY') return;

    if (!window.emailjs) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@3/dist/email.min.js';
        s.onload = () => { window.emailjs.init(cfg.publicKey); res(); };
        s.onerror = rej;
        document.head.appendChild(s);
      });
    }

    await window.emailjs.send(cfg.serviceId, cfg.templateInternal, {
      to_email:        cfg.fromEmail,
      subject:         `${urgency ? '🔴 URGENTE — ' : ''}Nova solicitação: ${typeName}`,
      requester_name:  requesterName,
      requester_email: requesterEmail,
      type_name:       typeName,
      nucleo,
      urgency:         urgency ? 'Sim — urgente' : 'Não',
      request_url:     `${window.location.origin}/tarefas/#requests?id=${requestId}`,
    });
  } catch(e) {
    console.warn('Email notification skipped:', e.message);
  }
}

/* ─── Helpers ─────────────────────────────────────────────── */
function getMinDate() {
  const d = new Date(); d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0,10);
}

function showError(msg) {
  const root = document.getElementById('portal-root');
  if (root) root.innerHTML = `<div style="color:#EF4444;padding:40px;text-align:center;">${msg}</div>`;
}

// Boot
boot().catch(e => showError('Erro ao inicializar: ' + e.message));
