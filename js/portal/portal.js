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
  const configModule = await import('./config.js').catch(() => null);
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
    const snap = await getDocs(query(
      collection(db, 'task_types'),
      orderBy('createdAt', 'asc'),
      limit(50),
    ));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) {
    return [];
  }
}

/* ─── Núcleos fixos (espelha NUCLEOS do tasks.js) ────────── */
const NUCLEOS = [
  { value: 'design',        label: 'Design'        },
  { value: 'comunicacao',   label: 'Comunicação'   },
  { value: 'redes_sociais', label: 'Redes Sociais' },
  { value: 'dados',         label: 'Dados'         },
  { value: 'web',           label: 'Web'           },
  { value: 'sistemas',      label: 'Sistemas'      },
  { value: 'ia',            label: 'IA'            },
];

const REQUESTING_AREAS = [
  'BTG','C&P','Célula ICs','Centurion','CEP','Concierge Bradesco',
  'Contabilidade','Diretoria','Eventos','Financeiro','Lazer','Marketing',
  'Operadora','Programa ICs','Projetos','PTS Bradesco','Qualidade','Suppliers','TI',
];

/* ─── Render form ─────────────────────────────────────────── */
function renderForm(db, taskTypes) {
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

              <div class="form-group" id="fg-nucleo">
                <label class="form-label">
                  Núcleo responsável <span class="required">*</span>
                  <span class="info-tip" title="Selecione o núcleo de produção que receberá esta demanda.">ℹ</span>
                </label>
                <select class="form-select" id="p-nucleo">
                  <option value="">— Selecione o núcleo —</option>
                  ${NUCLEOS.map(n => `<option value="${n.value}">${n.label}</option>`).join('')}
                </select>
                <div class="form-error" id="err-nucleo">Selecione um núcleo.</div>
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
  loadCalendarSlots(db);
  bindFormEvents(db, taskTypes);
}

/* ─── Calendar slots ──────────────────────────────────────── */
async function loadCalendarSlots(db) {
  const today    = new Date(); today.setHours(0,0,0,0);
  const twoWeeks = new Date(today); twoWeeks.setDate(twoWeeks.getDate() + 14);

  // Buscar tarefas no período para mostrar ocupação
  let existingDates = {};
  try {
    const snap = await getDocs(query(
      collection(db, 'tasks'),
      where('startDate', '>=', today),
      where('startDate', '<=', twoWeeks),
      limit(200),
    ));
    snap.docs.forEach(d => {
      const t = d.data();
      if (t.startDate) {
        const dt  = t.startDate.toDate ? t.startDate.toDate() : new Date(t.startDate);
        const key = dt.toISOString().slice(0,10);
        existingDates[key] = (existingDates[key] || 0) + 1;
      }
    });
  } catch(e) {}

  const slotsWrap = document.getElementById('slots-week');
  if (!slotsWrap) return;

  const days = [];
  for (let d = new Date(today); d <= twoWeeks; d.setDate(d.getDate()+1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // skip weekends
    days.push(new Date(d));
  }

  const DAYS_PT = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
  const MONTHS_PT = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

  slotsWrap.innerHTML = days.slice(0, 10).map(d => {
    const key     = d.toISOString().slice(0,10);
    const count   = existingDates[key] || 0;
    const taken   = count >= 3; // 3+ tarefas = "ocupado"
    const dow     = d.getDay();
    return `
      <div class="slot-day ${taken?'slot-taken':''}"
        data-date="${key}" title="${taken?'Data com muitas tarefas':'Disponível'}">
        <div class="slot-day-name">${DAYS_PT[dow]}</div>
        <div class="slot-day-num">${d.getDate()}</div>
        <div class="slot-day-info">${MONTHS_PT[d.getMonth()]}${taken?' · ocupado':''}</div>
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
}

/* ─── Bind events ─────────────────────────────────────────── */
function bindFormEvents(db, taskTypes) {
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
    { id: 'p-nucleo', errId: 'err-nucleo', fgId: 'fg-nucleo', check: v => v !== '' },
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
      typeId,
      typeName:       typeData?.name || typeId,
      nucleo:         document.getElementById('p-nucleo')?.value || '',
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
    const configModule = await import('./config.js').catch(() => null);
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
