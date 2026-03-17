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

  // Avoid duplicate app error on hot reload
  let app;
  try {
    const { getApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    app = getApp('portal');
  } catch(e) {
    app = initializeApp(firebaseConfig, 'portal');
  }
  const db  = getFirestore(app);

  // Carregar tipos de tarefa disponíveis (sempre fresh)
  const taskTypes = await loadTaskTypes(db);
  await renderForm(db, taskTypes);
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

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

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

            <!-- Seção 2: Demanda em cascata -->
            <div class="portal-card">
              <div class="portal-card-title">Detalhes da demanda</div>

              <!-- Passo 1: Setor responsável -->
              <div class="form-group" id="fg-setor">
                <label class="form-label">
                  Setor responsável <span class="required">*</span>
                  <span class="info-tip" title="Selecione o setor que receberá esta demanda. Os tipos de demanda disponíveis serão filtrados por setor.">ℹ</span>
                </label>
                <select class="form-select" id="p-setor">
                  <option value="">— Selecione o setor —</option>
                  ${REQUESTING_AREAS.map(a => `<option value="${a}">${a}</option>`).join('')}
                </select>
                <div class="form-error" id="err-setor">Selecione um setor.</div>
              </div>

              <!-- Passo 2: Tipo de demanda (filtrado pelo setor) -->
              <div class="form-group" id="fg-type" style="display:none;">
                <label class="form-label">
                  Tipo de demanda <span class="required">*</span>
                  <span class="info-tip" title="Tipos disponíveis para o setor selecionado.">ℹ</span>
                </label>
                <select class="form-select" id="p-type">
                  <option value="">— Selecione o tipo —</option>
                </select>
                <div class="form-error" id="err-type">Selecione um tipo.</div>
              </div>

              <!-- Passo 3: Variação do material (filtrada pelo tipo) -->
              <div class="form-group" id="fg-variation" style="display:none;">
                <label class="form-label">
                  Variação do material <span class="required">*</span>
                  <span class="info-tip" title="A variação define o SLA de produção.">ℹ</span>
                </label>
                <select class="form-select" id="p-variation">
                  <option value="">— Selecione a variação —</option>
                </select>
                <!-- SLA badge aparece após selecionar variação -->
                <div class="sla-badge" id="sla-badge" style="margin-top:8px;">
                  <span style="color:var(--brand-gold);">⏱</span>
                  <span>SLA de produção: <strong id="sla-label"></strong></span>
                </div>
              </div>

              <!-- Passo 4: Núcleo (filtrado pelo setor, opcional) -->
              <div class="form-group" id="fg-nucleo" style="display:none;">
                <label class="form-label">
                  Núcleo responsável
                  <span class="info-tip" title="Núcleo específico dentro do setor (opcional).">ℹ</span>
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

              <!-- Fora do calendário -->
              <div class="form-group">
                <label class="urgency-toggle" id="out-of-calendar-toggle">
                  <input type="checkbox" id="p-out-of-calendar" />
                  <div class="urgency-dot" id="out-calendar-dot">✓</div>
                  <div>
                    <div style="font-size:0.9375rem;color:var(--text-primary);font-weight:500;">
                      Fora do calendário
                    </div>
                    <div style="font-size:0.8125rem;color:var(--text-muted);">
                      Marque quando esta demanda não estava prevista no calendário editorial.
                    </div>
                  </div>
                </label>
                <!-- Alerta: impacto de sair do calendário -->
                <div class="alert-banner warning" id="out-calendar-alert" style="display:none;">
                  <span style="font-size:1.125rem;flex-shrink:0;">⚠</span>
                  <span>
                    <strong>Atenção: impacto de operar fora do calendário editorial</strong><br/>
                    Demandas fora do calendário prejudicam o planejamento da equipe e podem comprometer 
                    a <strong>performance de entrega</strong>, <strong>taxa de cliques</strong> e 
                    <strong>saúde do servidor de disparo</strong> da PRIMETOUR — especialmente para newsletters. 
                    Envios não planejados aumentam o risco de marcação como spam e reduzem o engajamento da base.
                    Use este campo apenas quando estritamente necessário.
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
  // Store references for later use by type-change handler
  // MUST be set before any early returns
  window._portalDb         = db;
  window._portalTaskTypes  = taskTypes;

  const today    = new Date(); today.setHours(0,0,0,0);
  const twoWeeks = new Date(today); twoWeeks.setDate(twoWeeks.getDate() + 14);

  // Buscar newsletters do mês para mostrar ocupação
  let newsletterDates = {};
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
  } catch(e) {} // silently ignore — portal is unauthenticated

  const slotsWrap = document.getElementById('slots-week');
  if (!slotsWrap) return; // slots-week hidden until type selected — that's OK, db refs are already stored

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

  // Calendar widget is shown only after type selection (see bindFormEvents)
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

  // Build calendar data — search by both typeId and legacy type field
  const buildCalData = async () => {
    const y = portalCalDate.getFullYear();
    const m = portalCalDate.getMonth();
    let taskMap = {};

    try {
      // Query by typeId (new schema)
      const snap1 = await getDocs(query(
        collection(db,'tasks'),
        where('typeId','==',portalCalTypeId),
        limit(300)
      ));

      // Query by legacy type name (old schema — newsletter stored as type:'newsletter')
      const activeType = (types||[]).find(t=>t.id===portalCalTypeId);
      const typeName   = activeType?.name?.toLowerCase() || portalCalTypeId;
      const snap2 = await getDocs(query(
        collection(db,'tasks'),
        where('type','==',typeName),
        limit(300)
      )).catch(()=>({docs:[]}));

      // Merge, deduplicate by id
      const seen = new Set();
      [...snap1.docs, ...snap2.docs].forEach(d=>{
        if (seen.has(d.id)) return;
        seen.add(d.id);
        const t = d.data();
        if (t.status === 'cancelled') return;
        const df = t.dueDate||t.startDate;
        if (!df) return;
        const dt = df.toDate?df.toDate():new Date(df);
        if (dt.getFullYear()!==y||dt.getMonth()!==m) return;
        const k = dt.getDate();
        if (!taskMap[k]) taskMap[k]=[];
        taskMap[k].push({title:t.title||'',requestingArea:t.requestingArea||'',status:t.status||''});
      });
    } catch(e) { console.warn('portal calendar data error:', e.message); }
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

  // ── Setor → filter types + nucleos ──────────────────────
  document.getElementById('p-setor')?.addEventListener('change', async (e) => {
    const sector    = e.target.value;
    const typeFG    = document.getElementById('fg-type');
    const typeSel   = document.getElementById('p-type');
    const varFG     = document.getElementById('fg-variation');
    const nucleoFG  = document.getElementById('fg-nucleo');
    const nucleoSel = document.getElementById('p-nucleo');
    const slaBadge  = document.getElementById('sla-badge');

    // Reset all downstream
    if (varFG)    varFG.style.display   = 'none';
    if (slaBadge) slaBadge.classList.remove('visible');
    document.getElementById('portal-calendar-widget')?.remove();
    if (typeSel)  typeSel.innerHTML = '<option value="">— Selecione o tipo —</option>';

    if (!sector) {
      if (typeFG)   typeFG.style.display   = 'none';
      if (nucleoFG) nucleoFG.style.display = 'none';
      return;
    }

    // Load nucleos for this sector to know which types to show
    const nucleos = await loadNucleosBySector(db, sector);
    const nucleoNames = nucleos.map(n => n.name);

    // Filter types by sector field (primary) — show types whose sector matches
    // OR types with no sector (global/universal types)
    const sectorTypes = taskTypes.filter(t =>
      !t.sector || t.sector === sector
    );

    if (typeSel) {
      typeSel.innerHTML = '<option value="">— Selecione o tipo —</option>' +
        sectorTypes.map(t => `<option value="${t.id}">${t.icon||''} ${esc(t.name)}</option>`).join('');
    }
    if (typeFG) typeFG.style.display = 'block';

    // Show nucleos for this sector
    if (nucleoSel && nucleos.length) {
      nucleoSel.innerHTML = '<option value="">— Selecione o núcleo —</option>' +
        nucleos.map(n => `<option value="${n.name}">${n.name}</option>`).join('');
      if (nucleoFG) nucleoFG.style.display = 'block';
    } else {
      if (nucleoFG) nucleoFG.style.display = 'none';
    }
  });

  // ── Type → show variations + calendar (NO SLA here) ────
  document.getElementById('p-type')?.addEventListener('change', async (e) => {
    const typeId    = e.target.value;
    const typeData  = taskTypes.find(t => t.id === typeId);
    const varFG     = document.getElementById('fg-variation');
    const varSel    = document.getElementById('p-variation');
    const slaBadge  = document.getElementById('sla-badge');
    const slotsEl   = document.getElementById('slots-container');

    // Always hide SLA on type change — only variation drives it
    if (slaBadge) slaBadge.classList.remove('visible');

    if (!typeId || !typeData) {
      if (varFG) varFG.style.display = 'none';
      document.getElementById('portal-calendar-widget')?.remove();
      return;
    }

    // Show variation dropdown if type has variations
    if (varSel && varFG) {
      if (typeData.variations?.length) {
        varSel.innerHTML = '<option value="">— Selecione a variação —</option>' +
          typeData.variations.map(v =>
            `<option value="${v.id}" data-sla="${v.slaDays}">${esc(v.name)} · ${v.slaDays===0?'mesmo dia':v.slaDays+'d'}</option>`
          ).join('');
        varFG.style.display = 'block';
      } else {
        // Type has no variations — hide the field
        varFG.style.display = 'none';
      }
    }

    if (slotsEl) slotsEl.classList.add('visible');

    // Show calendar widget for this type
    const dbRef  = window._portalDb;
    const types  = window._portalTaskTypes || taskTypes;
    if (dbRef && typeId) {
      portalCalTypeId = typeId;
      await renderPortalCalendar(dbRef, types, null);
    } else {
      document.getElementById('portal-calendar-widget')?.remove();
    }
  });

  // ── Variation → show SLA + auto-fill date ───────────────
  document.getElementById('p-variation')?.addEventListener('change', (e) => {
    const opt      = e.target.selectedOptions[0];
    const days     = parseInt(opt?.dataset?.sla);
    const slaBadge = document.getElementById('sla-badge');
    const slaLabel = document.getElementById('sla-label');
    const dueEl    = document.getElementById('p-date');

    if (opt?.value && !isNaN(days) && slaBadge && slaLabel) {
      slaLabel.textContent = days === 0 ? 'Mesmo dia' : `${days} dia${days!==1?'s':''}`;
      slaBadge.classList.add('visible');
      // Auto-fill due date
      if (dueEl && !dueEl.value) {
        const due = new Date();
        if (days === 0) {
          dueEl.value = due.toISOString().slice(0,10);
        } else {
          let biz = days;
          while (biz > 0) {
            due.setDate(due.getDate() + 1);
            const dow = due.getDay();
            if (dow !== 0 && dow !== 6) biz--;
          }
          dueEl.value = due.toISOString().slice(0,10);
        }
      }
    } else if (slaBadge) {
      slaBadge.classList.remove('visible');
    }
  });

  // Out-of-calendar toggle — same pattern as urgency
  document.getElementById('out-of-calendar-toggle')?.addEventListener('click', () => {
    const cb    = document.getElementById('p-out-of-calendar');
    const toggle= document.getElementById('out-of-calendar-toggle');
    const alert = document.getElementById('out-calendar-alert');
    if (!cb) return;
    cb.checked = !cb.checked;
    toggle?.classList.toggle('active', cb.checked);
    if (alert) alert.style.display = cb.checked ? 'flex' : 'none';
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
    { id: 'p-setor',  errId: 'err-setor',  fgId: 'fg-setor',  check: v => v !== '' },
    // type only required if visible
    ...(document.getElementById('fg-type')?.style.display !== 'none'
      ? [{ id: 'p-type', errId: 'err-type', fgId: 'fg-type', check: v => v !== '' }]
      : []),
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
    const typeId      = document.getElementById('p-type')?.value || '';
    const typeData    = taskTypes.find(t => t.id === typeId);
    const urgency     = document.getElementById('p-urgency')?.checked || false;
    const outOfCal    = document.getElementById('p-out-of-calendar')?.checked || false;
    const variationId = document.getElementById('p-variation')?.value || null;
    const varOpt      = document.querySelector('#p-variation option:checked');
    const variationName = varOpt?.textContent?.split('·')[0]?.trim() || '';
    const sector      = document.getElementById('p-setor')?.value || '';

    // Build request document matching createRequest service schema exactly
    const reqDoc = {
      requesterName:  document.getElementById('p-name')?.value?.trim()             || '',
      requesterEmail: document.getElementById('p-email')?.value?.trim().toLowerCase() || '',
      requestingArea: document.getElementById('p-area')?.value                     || '',
      sector:         sector                                                        || '',
      outOfCalendar:  outOfCal === true,
      variationId:    variationId    || null,
      variationName:  variationName  || '',
      typeId:         typeId         || null,
      typeName:       typeData?.name || typeId || '',
      nucleo:         document.getElementById('p-nucleo')?.value                   || '',
      description:    document.getElementById('p-desc')?.value?.trim()             || '',
      urgency:        urgency === true,
      desiredDate:    document.getElementById('p-date')?.value
        ? new Date(document.getElementById('p-date').value + 'T12:00:00')
        : null,
      status:         'pending',
      taskId:         null,
      workspaceId:    null,
      internalNote:   '',
      rejectionNote:  '',
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

/* ─── Email notification via Firebase Function ───────────── */
async function notifyTeam(reqDoc) {
  try {
    const res = await fetch(
      (await import('../config.js')).APP_CONFIG?.functions?.sendEmailUrl || '',
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ type: 'new_request', to: null, data: {
          requesterName:  reqDoc.requesterName,
          requesterEmail: reqDoc.requesterEmail,
          requestingArea: reqDoc.requestingArea || '',
          sector:         reqDoc.sector         || '',
          typeName:       reqDoc.typeName        || '',
          variationName:  reqDoc.variationName   || '',
          description:    reqDoc.description     || '',
          urgency:        reqDoc.urgency         || false,
          outOfCalendar:  reqDoc.outOfCalendar   || false,
          desiredDate:    reqDoc.desiredDate
            ? new Date(reqDoc.desiredDate).toLocaleDateString('pt-BR') : '',
        }}),
      }
    );
    if (!res.ok) console.warn('notifyTeam failed:', await res.text());
  } catch(e) {
    console.warn('notifyTeam error:', e.message);
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
