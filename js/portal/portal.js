/**
 * PRIMETOUR — Portal de Solicitações (Fase 4)
 * Autenticação obrigatória via Firebase Auth
 */

import { initializeApp }  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, collection, addDoc, getDocs, doc, getDoc, updateDoc,
  query, where, orderBy, limit, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  getAuth, signInWithEmailAndPassword, signInWithPopup, signOut, onAuthStateChanged,
  OAuthProvider,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

/* ─── Estado do usuário autenticado ─────────────────────────── */
let portalUser = null; // { uid, name, email, department }

/* ─── Bootstrap ───────────────────────────────────────────── */
async function boot() {
  const configModule = await import('../config.js').catch(() => null);
  const firebaseConfig = configModule?.firebaseConfig;
  if (!firebaseConfig) {
    showError('Configuração do sistema não encontrada.');
    return;
  }

  // Usa a mesma instância nomeada do app principal para compartilhar sessão de auth
  let app;
  try {
    const { getApp } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js');
    app = getApp('primetour-main');
  } catch(e) {
    app = initializeApp(firebaseConfig, 'primetour-main');
  }
  const db   = getFirestore(app);
  const auth = getAuth(app);

  // Verificar sessão ativa ou exibir login
  onAuthStateChanged(auth, async (user) => {
    const root = document.getElementById('portal-root');
    if (!root) return;

    if (user) {
      // Carregar perfil do Firestore
      let profile = {};
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (snap.exists()) profile = snap.data();
      } catch(e) { console.warn('Perfil não encontrado:', e.message); }

      portalUser = {
        uid:        user.uid,
        name:       profile.name || user.displayName || '',
        email:      user.email || '',
        department: profile.department || '',
      };

      const taskTypes = await loadTaskTypes(db);
      await renderForm(db, taskTypes, auth);
      // Post-login: show newsletter quick-start prompt
      showNewsletterPrompt(db, taskTypes);
    } else {
      portalUser = null;
      renderLoginScreen(auth, root);
    }
  });
}

/* ─── Tela de login ──────────────────────────────────────── */
function renderLoginScreen(auth, root) {
  const savedTheme = localStorage.getItem('portal-theme') || 'dark';
  if (savedTheme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  root.innerHTML = `
    <div class="portal-wrap">
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
        <div class="portal-container" style="max-width:420px;">
          <div class="portal-card" style="margin-top:40px;">
            <div class="portal-card-title" style="text-align:center;">Acesse sua conta</div>
            <p style="font-size:0.8125rem;color:var(--text-muted);text-align:center;margin-bottom:20px;">
              Faça login com seu e-mail corporativo para enviar solicitações.
            </p>
            <div class="form-group" id="fg-login-email">
              <label class="form-label">E-mail</label>
              <input type="email" class="form-input" id="login-email"
                placeholder="seu@email.com" autocomplete="email" />
            </div>
            <div class="form-group" id="fg-login-pass">
              <label class="form-label">Senha</label>
              <input type="password" class="form-input" id="login-pass"
                placeholder="Sua senha" autocomplete="current-password" />
            </div>
            <div class="alert-banner warning" id="login-error" style="display:none;">
              <span style="font-size:1.125rem;flex-shrink:0;">⚠</span>
              <span id="login-error-msg">Erro ao fazer login.</span>
            </div>
            <button class="portal-submit" id="login-btn" style="margin-top:12px;width:100%;">
              Entrar →
            </button>
            <div style="display:flex;align-items:center;gap:12px;margin:16px 0;">
              <div style="flex:1;height:1px;background:var(--border-subtle);"></div>
              <span style="font-size:0.75rem;color:var(--text-muted);">ou</span>
              <div style="flex:1;height:1px;background:var(--border-subtle);"></div>
            </div>
            <button id="login-sso-btn" style="width:100%;padding:10px 16px;border-radius:6px;
              border:1px solid var(--border-subtle);background:var(--bg-surface);color:var(--text-primary);
              cursor:pointer;font-family:var(--font-ui);font-size:0.875rem;font-weight:500;
              display:flex;align-items:center;justify-content:center;gap:8px;transition:all 0.15s;">
              <svg width="16" height="16" viewBox="0 0 21 21"><rect width="10" height="10" fill="#f25022"/><rect x="11" width="10" height="10" fill="#7fba00"/><rect y="11" width="10" height="10" fill="#00a4ef"/><rect x="11" y="11" width="10" height="10" fill="#ffb900"/></svg>
              Entrar com Microsoft SSO
            </button>
            <div style="text-align:center;margin-top:16px;">
              <a href="index.html" style="font-size:0.8125rem;color:var(--brand-gold);text-decoration:none;">
                ← Ir para o sistema principal
              </a>
            </div>
          </div>
        </div>
      </main>
      <footer class="portal-footer">
        PRIMETOUR &copy; ${new Date().getFullYear()} — Sistema de Gestão de Tarefas
      </footer>
    </div>
  `;

  const btnLogin   = document.getElementById('login-btn');
  const emailInput = document.getElementById('login-email');
  const passInput  = document.getElementById('login-pass');
  const errBanner  = document.getElementById('login-error');
  const errMsg     = document.getElementById('login-error-msg');

  const doLogin = async () => {
    const email = emailInput?.value?.trim();
    const pass  = passInput?.value;
    if (!email || !pass) {
      errBanner.style.display = 'flex';
      errMsg.textContent = 'Preencha e-mail e senha.';
      return;
    }
    btnLogin.disabled = true;
    btnLogin.textContent = 'Entrando...';
    errBanner.style.display = 'none';
    try {
      await signInWithEmailAndPassword(auth, email, pass);
      // onAuthStateChanged will handle the rest
    } catch(e) {
      const msgs = {
        'auth/user-not-found':       'Usuário não encontrado.',
        'auth/wrong-password':       'Senha incorreta.',
        'auth/invalid-credential':   'Credenciais inválidas.',
        'auth/invalid-email':        'E-mail inválido.',
        'auth/too-many-requests':    'Muitas tentativas. Tente novamente mais tarde.',
      };
      errBanner.style.display = 'flex';
      errMsg.textContent = msgs[e.code] || 'Erro ao fazer login: ' + e.message;
      btnLogin.disabled = false;
      btnLogin.textContent = 'Entrar →';
    }
  };

  btnLogin?.addEventListener('click', doLogin);
  passInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  emailInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') passInput?.focus(); });

  // SSO Microsoft login
  const ssoBtn = document.getElementById('login-sso-btn');
  ssoBtn?.addEventListener('click', async () => {
    ssoBtn.disabled = true;
    ssoBtn.textContent = 'Conectando ao Microsoft...';
    errBanner.style.display = 'none';
    try {
      const msProvider = new OAuthProvider('microsoft.com');
      msProvider.setCustomParameters({ tenant: 'primetour.com.br', prompt: 'login', login_hint: '' });
      msProvider.addScope('user.read');
      const result = await signInWithPopup(auth, msProvider);
      const user   = result.user;

      // Validate domain
      if (user.email && !user.email.toLowerCase().endsWith('@primetour.com.br')) {
        await signOut(auth);
        errBanner.style.display = 'flex';
        errMsg.textContent = 'Apenas e-mails @primetour.com.br são aceitos.';
        ssoBtn.disabled = false;
        ssoBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 21 21"><rect width="10" height="10" fill="#f25022"/><rect x="11" width="10" height="10" fill="#7fba00"/><rect y="11" width="10" height="10" fill="#00a4ef"/><rect x="11" y="11" width="10" height="10" fill="#ffb900"/></svg> Entrar com Microsoft SSO';
        return;
      }

      // Auto-provision profile if doesn't exist
      const { doc: docRef, getDoc: getDocFn, setDoc } =
        await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const appDb = getFirestore(auth.app);
      const profileSnap = await getDocFn(docRef(appDb, 'users', user.uid));
      if (!profileSnap.exists()) {
        const displayName = user.displayName || user.email.split('@')[0];
        const nameParts = displayName.replace(/[._]/g, ' ').split(' ').filter(Boolean);
        const formattedName = nameParts.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        await setDoc(docRef(appDb, 'users', user.uid), {
          name: formattedName,
          email: user.email.toLowerCase(),
          role: 'member',
          active: true,
          department: '',
          createdAt: new Date(),
          ssoProvider: 'microsoft',
        });
      }
      // onAuthStateChanged will handle the rest
    } catch(e) {
      console.error('SSO portal error:', e);
      if (e.code !== 'auth/popup-closed-by-user') {
        errBanner.style.display = 'flex';
        errMsg.textContent = 'Erro no login SSO: ' + (e.message || e.code || 'Erro desconhecido');
      }
      ssoBtn.disabled = false;
      ssoBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 21 21"><rect width="10" height="10" fill="#f25022"/><rect x="11" width="10" height="10" fill="#7fba00"/><rect y="11" width="10" height="10" fill="#00a4ef"/><rect x="11" y="11" width="10" height="10" fill="#ffb900"/></svg> Entrar com Microsoft SSO';
    }
  });
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
async function renderForm(db, taskTypes, auth) {
  const root = document.getElementById('portal-root');
  if (!root) return;

  const u = portalUser || {};

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
        <div style="display:flex;align-items:center;gap:10px;margin-left:auto;">
          <span style="font-size:0.8125rem;color:var(--text-secondary);">${esc(u.name || u.email)}</span>
          <button id="portal-theme-btn" title="Alternar tema claro/escuro" style="font-size:1rem;padding:4px 8px;border-radius:4px;
            border:1px solid var(--border-subtle);background:transparent;color:var(--text-muted);
            cursor:pointer;line-height:1;">${document.documentElement.getAttribute('data-theme')==='light'?'🌙':'☀️'}</button>
          <a href="index.html" id="portal-go-system" style="font-size:0.75rem;padding:4px 12px;border-radius:4px;
            border:1px solid var(--brand-gold);background:transparent;color:var(--brand-gold);
            cursor:pointer;text-decoration:none;font-weight:500;">Ir para o sistema</a>
          <button id="portal-logout-btn" style="font-size:0.75rem;padding:4px 12px;border-radius:4px;
            border:1px solid var(--border-subtle);background:transparent;color:var(--text-muted);
            cursor:pointer;">Sair</button>
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
                  <label class="form-label">Nome</label>
                  <input type="text" class="form-input" id="p-name"
                    value="${esc(u.name)}" readonly
                    style="background:var(--bg-surface);opacity:0.7;cursor:not-allowed;" />
                </div>
                <div class="form-group" id="fg-email">
                  <label class="form-label">E-mail</label>
                  <input type="email" class="form-input" id="p-email"
                    value="${esc(u.email)}" readonly
                    style="background:var(--bg-surface);opacity:0.7;cursor:not-allowed;" />
                </div>
              </div>
              <div class="form-grid-2">
                <div class="form-group" id="fg-user-area">
                  <label class="form-label">Sua área</label>
                  <input type="text" class="form-input" id="p-user-area"
                    value="${esc(u.department)}" readonly
                    style="background:var(--bg-surface);opacity:0.7;cursor:not-allowed;" />
                </div>
                <div class="form-group" id="fg-area">
                  <label class="form-label">Área solicitante <span class="required">*</span>
                    <span class="info-tip" title="Pode ser diferente da sua área, caso esteja solicitando em nome de outra.">ℹ</span>
                  </label>
                  <select class="form-select" id="p-area">
                    ${REQUESTING_AREAS.map(a => `<option value="${a}" ${a===u.department?'selected':''}>${a}</option>`).join('')}
                  </select>
                  <div class="form-error" id="err-area">Selecione uma área.</div>
                </div>
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

              <!-- Passo 3: Calendário + Data (aparece após tipo) -->
              <div class="form-group">
                <label class="form-label">
                  Data desejada para entrega
                  <span class="info-tip" title="Selecione uma data no calendário ou defina manualmente. O calendário mostra os slots pré-agendados — clique em um para preencher automaticamente os campos abaixo.">ℹ</span>
                </label>
                <input type="date" class="form-input" id="p-date"
                  min="${getMinDate()}" />

                <!-- Calendar widget inserted here by renderPortalCalendar -->
                <div class="slots-container" id="slots-container"></div>
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
              <div class="form-group" id="fg-out-of-calendar">
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

              <div class="alert-banner info" id="calendar-alert">
                <span style="font-size:1.125rem;flex-shrink:0;">📅</span>
                <span>
                  A data selecionada não está no calendário editorial padrão.
                  O time avaliará a viabilidade de encaixe. Considere selecionar
                  uma das datas sugeridas acima.
                </span>
              </div>

              <!-- Passo 4: Variação do material (pre-preenchida pelo slot) -->
              <div class="form-group" id="fg-variation" style="display:none;">
                <label class="form-label">
                  Variação do material <span class="required">*</span>
                  <span class="info-tip" title="A variação define o SLA de produção. Pode ser preenchida automaticamente ao clicar em um slot do calendário.">ℹ</span>
                </label>
                <select class="form-select" id="p-variation">
                  <option value="">— Selecione a variação —</option>
                </select>
                <div class="sla-badge" id="sla-badge" style="margin-top:8px;">
                  <span style="color:var(--brand-gold);">⏱</span>
                  <span>SLA de produção: <strong id="sla-label"></strong></span>
                </div>
              </div>

              <!-- Passo 5: Núcleo (pre-preenchido pelo slot) -->
              <div class="form-group" id="fg-nucleo" style="display:none;">
                <label class="form-label">
                  Núcleo responsável
                  <span class="info-tip" title="Núcleo específico dentro do setor. Pode ser preenchido automaticamente ao clicar em um slot do calendário.">ℹ</span>
                </label>
                <select class="form-select" id="p-nucleo">
                  <option value="">— Selecione o núcleo —</option>
                </select>
              </div>

              <!-- Passo 6: Título (pre-preenchido pelo slot) -->
              <div class="form-group" id="fg-title">
                <label class="form-label">Título da demanda <span class="required">*</span></label>
                <input type="text" class="form-input" id="p-title"
                  placeholder="Ex: Newsletter Maio — Programa ICs" maxlength="120" />
                <div class="form-error" id="err-title">Informe um título para a demanda.</div>
              </div>

              <!-- Passo 7: Descrição -->
              <div class="form-group" id="fg-desc">
                <label class="form-label">Descrição da demanda <span class="required">*</span></label>
                <textarea class="form-textarea" id="p-desc" rows="4"
                  placeholder="Descreva em detalhes o que você precisa, contexto, referências e objetivos..."></textarea>
                <div class="form-error" id="err-desc">Descreva sua demanda.</div>
              </div>
            </div>

            <!-- Submit buttons -->
            <div style="display:flex;flex-direction:column;gap:8px;">
              <button class="portal-submit" id="portal-add-batch-btn">
                Adicionar ao lote +
              </button>
              <button class="portal-submit portal-submit-alt" id="portal-submit-btn">
                Enviar apenas esta solicitação →
              </button>
            </div>

            <!-- Batch queue panel -->
            <div class="portal-card batch-panel" id="batch-panel" style="display:none;">
              <div class="portal-card-title" style="display:flex;align-items:center;justify-content:space-between;">
                <span>Solicitações em lote</span>
                <span class="batch-count-badge" id="batch-count">0</span>
              </div>
              <div id="batch-list"></div>
              <button class="portal-submit" id="batch-submit-btn" style="margin-top:12px;">
                Enviar todas as solicitações →
              </button>
            </div>
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

  // Theme toggle
  const savedTheme = localStorage.getItem('portal-theme') || 'dark';
  if (savedTheme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  const themeBtn = document.getElementById('portal-theme-btn');
  if (themeBtn) {
    themeBtn.textContent = savedTheme === 'light' ? '🌙' : '☀️';
    themeBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'light' ? '' : 'light';
      if (next) document.documentElement.setAttribute('data-theme', 'light');
      else document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('portal-theme', next || 'dark');
      themeBtn.textContent = next === 'light' ? '🌙' : '☀️';
    });
  }

  // Logout button
  document.getElementById('portal-logout-btn')?.addEventListener('click', async () => {
    if (auth) await signOut(auth);
  });

  // Load calendar slots for next 2 weeks
  await loadCalendarSlots(db, taskTypes);
  bindFormEvents(db, taskTypes);
}

/* ─── Calendar slots + Newsletter mini-calendar ────────────── */
async function loadCalendarSlots(db, taskTypes=[]) {
  // Store references for later use by type-change handler
  window._portalDb         = db;
  window._portalTaskTypes  = taskTypes;
  // Calendar widget is rendered after type selection (see bindFormEvents → renderPortalCalendar)
}

/* ─── Newsletter quick-start prompt ──────────────────────── */
function showNewsletterPrompt(db, taskTypes) {
  const hasNewsletter = taskTypes.some(t => t.id === 'newsletter' || t.name?.toLowerCase() === 'newsletter');
  if (!hasNewsletter) return;

  // Remove any existing prompt before showing a new one
  document.getElementById('nl-quick-prompt')?.remove();

  const prompt = document.createElement('div');
  prompt.id = 'nl-quick-prompt';
  prompt.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:9999;
    background:var(--bg-card);border:1px solid rgba(212,168,67,0.3);
    border-radius:12px;padding:20px;max-width:340px;
    box-shadow:0 8px 32px rgba(0,0,0,0.3);
    animation:slideUp 0.3s ease-out;
    font-family:var(--font-ui);
  `;
  prompt.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:12px;">
      <div style="font-size:1.5rem;flex-shrink:0;">📧</div>
      <div style="flex:1;">
        <div style="font-weight:600;color:var(--text-primary);font-size:0.9375rem;margin-bottom:4px;">
          Solicitação de Newsletter?
        </div>
        <p style="font-size:0.8125rem;color:var(--text-muted);line-height:1.5;margin:0 0 12px 0;">
          Preencha automaticamente os campos para newsletter e vá direto ao calendário editorial.
        </p>
        <div style="display:flex;gap:8px;">
          <button id="nl-quick-yes" style="padding:6px 16px;border-radius:6px;border:none;
            background:var(--brand-gold);color:#000;font-weight:600;cursor:pointer;font-size:0.8125rem;">
            Sim, é newsletter
          </button>
          <button id="nl-quick-no" style="padding:6px 12px;border-radius:6px;border:1px solid var(--border-subtle);
            background:transparent;color:var(--text-muted);cursor:pointer;font-size:0.8125rem;">
            Não
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(prompt);

  document.getElementById('nl-quick-yes')?.addEventListener('click', async () => {
    prompt.remove();
    // Auto-fill for newsletter
    await prefillNewsletter(db, taskTypes);
  });

  document.getElementById('nl-quick-no')?.addEventListener('click', () => {
    prompt.remove();
  });

  // Auto-dismiss after 15 seconds
  setTimeout(() => { prompt.remove(); }, 15000);
}

async function prefillNewsletter(db, taskTypes) {
  // Set setor = Marketing
  const setorEl = document.getElementById('p-setor');
  if (setorEl) {
    setorEl.value = 'Marketing';
    setorEl.dispatchEvent(new Event('change'));
  }

  // Wait for cascade to populate types
  await new Promise(r => setTimeout(r, 400));

  // Set type = newsletter
  const typeEl = document.getElementById('p-type');
  if (typeEl) {
    const nlType = taskTypes.find(t => t.id === 'newsletter' || t.name?.toLowerCase() === 'newsletter');
    if (nlType) {
      typeEl.value = nlType.id;
      typeEl.dispatchEvent(new Event('change'));
    }
  }

  // Wait for calendar to render
  await new Promise(r => setTimeout(r, 500));

  // Scroll to calendar
  document.getElementById('portal-calendar-widget')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ─── Batch queue state ──────────────────────────────────── */
let batchQueue      = [];
let currentEditIndex = -1;

/* ─── Portal calendar widget ────────────────────────────── */
let portalCalGran     = 'month'; // 'month'|'week'|'day'
let portalCalDate     = new Date();
let portalCalTypeId   = 'newsletter';
let portalCalExpanded = false;

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
        taskMap[k].push({
          id:d.id, title:t.title||'', requestingArea:t.requestingArea||'',
          status:t.status||'', description:t.description||'',
          requesterName:t.requesterName||'', typeName:t.typeName||activeType?.name||'',
          sector:t.sector||activeType?.sector||'',
          urgency:t.urgency||false, outOfCalendar:t.outOfCalendar||false,
          dateISO: dt.toISOString().slice(0,10),
        });
      });
    } catch(e) { console.warn('portal calendar data error:', e.message); }
    return taskMap;
  };

  // Build user requests map — shows what user already submitted for each date
  const buildRequestMap = async () => {
    const requestMap = {}; // key=ISO date, value={ status, title, statusLabel, statusColor, statusIcon }
    if (!portalUser?.uid) return requestMap;
    const STATUS_LABELS = {
      pending:   { label: 'Aguardando triagem', color: '#F59E0B', icon: '◌' },
      converted: { label: 'Convertida',         color: '#22C55E', icon: '✓' },
      rejected:  { label: 'Recusada',           color: '#EF4444', icon: '✕' },
    };
    try {
      const snap = await getDocs(query(
        collection(db, 'requests'),
        where('userId', '==', portalUser.uid),
        where('typeId', '==', portalCalTypeId),
        limit(200)
      ));
      snap.docs.forEach(d => {
        const r = d.data();
        const df = r.desiredDate;
        if (!df) return;
        const dt = df.toDate ? df.toDate() : new Date(df);
        const iso = dt.toISOString().slice(0, 10);
        const info = STATUS_LABELS[r.status] || STATUS_LABELS.pending;
        // Keep the most relevant status per date (converted > pending > rejected)
        if (!requestMap[iso] || r.status === 'converted' || (r.status === 'pending' && requestMap[iso].status === 'rejected')) {
          requestMap[iso] = {
            status: r.status, title: r.title || r.typeName || '', ...info,
            id: d.id, description: r.description || '', requesterName: r.requesterName || '',
            requestingArea: r.requestingArea || '', typeName: r.typeName || '',
            urgency: r.urgency || false, outOfCalendar: r.outOfCalendar || false,
            dateISO: iso,
          };
        }
      });
    } catch(e) { /* user may not have requests yet */ }
    return requestMap;
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

  const [taskMap, requestMap] = await Promise.all([buildCalData(), buildRequestMap()]);
  const y = portalCalDate.getFullYear();
  const m = portalCalDate.getMonth();

  // Build batch map — dates that have items in the current batch queue
  const batchMap = {}; // key=ISO date, value=count of batch items
  batchQueue.forEach(item => {
    if (item.desiredDate) {
      batchMap[item.desiredDate] = (batchMap[item.desiredDate] || 0) + 1;
    }
  });

  // Check if a slot is filled — returns { filled, title } with the display title
  const getSlotFillInfo = (slotTitle, dateISO, dayTasks) => {
    const lower = slotTitle.toLowerCase();
    // Check tasks on this day
    const matchedTask = dayTasks?.find(t => t.title?.toLowerCase().includes(lower) || lower.includes(t.title?.toLowerCase()));
    if (matchedTask) return { filled: true, title: matchedTask.title || slotTitle, source: 'task', data: matchedTask };
    // Check requests
    const rq = requestMap[dateISO];
    if (rq) return { filled: true, title: rq.title || rq.typeName || slotTitle, source: 'request', data: rq };
    // Check batch items
    const bc = batchMap[dateISO];
    if (bc) {
      const batchItem = batchQueue.find(item => item.desiredDate === dateISO);
      return { filled: true, title: batchItem?.title || slotTitle, source: 'batch', data: batchItem };
    }
    return { filled: false, title: slotTitle, source: null, data: null };
  };
  // Backward-compat wrapper
  const isSlotFilled = (slotTitle, dateISO, dayTasks) => getSlotFillInfo(slotTitle, dateISO, dayTasks).filled;

  // Build month grid
  const buildMonth = () => {
    const firstDay = new Date(y,m,1).getDay();
    const dim = new Date(y,m+1,0).getDate();
    const today = new Date(); today.setHours(0,0,0,0);
    let cells = '';
    for(let i=firstDay-1;i>=0;i--) cells+=`<div></div>`;
    for(let d=1;d<=dim;d++){
      const tasks  = taskMap[d]||[];
      const slots  = getSlotsForDate(new Date(y,m,d));
      const isToday= d===today.getDate()&&m===today.getMonth()&&y===today.getFullYear();
      const hasTasks= tasks.length>0;
      const hasSlots= slots.length>0;
      const dateISO= `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isPast = new Date(y,m,d) < today;
      const dow    = new Date(y,m,d).getDay();
      const isWeekend = dow===0||dow===6;
      const clickable = !isPast && !isWeekend;
      const cellH = portalCalExpanded ? '120px' : '60px';
      const cellPad = portalCalExpanded ? '8px' : '3px';
      const cellFont = portalCalExpanded ? '0.875rem' : '0.6875rem';
      const slotFont = portalCalExpanded ? '0.8125rem' : '0.5625rem';
      cells+=`<div class="${clickable?'pcal-day-cell':''}" ${clickable?`data-pcal-date="${dateISO}"`:''}
        style="min-height:${cellH};padding:${cellPad};border-radius:4px;cursor:${clickable?'pointer':'default'};
        background:${hasTasks?'rgba(212,168,67,0.08)':hasSlots?'rgba(212,168,67,0.04)':'transparent'};
        border:1px solid ${isToday?'var(--brand-gold)':hasTasks?'rgba(212,168,67,0.3)':hasSlots?'rgba(212,168,67,0.15)':'transparent'};">
        <div style="font-size:${cellFont};font-weight:${isToday?700:400};
          color:${isToday?'var(--brand-gold)':hasTasks?'var(--text-primary)':'var(--text-muted)'};">${d}</div>
        ${slots.map(s=>{const maxChars=portalCalExpanded?40:12;const fillInfo=getSlotFillInfo(s.title,dateISO,tasks);const filled=fillInfo.filled;const displayTitle=filled?fillInfo.title:s.title;return`<div class="${filled?'pcal-filled-click':'pcal-slot-click'}" ${filled?`data-req-date="${dateISO}" data-fill-source="${fillInfo.source}"`:`data-slot-date="${dateISO}"
          data-slot-title="${esc(s.title)}" data-slot-variation="${s.variationId||''}"
          data-slot-area="${esc(s.requestingArea||'')}"`}
          style="font-size:${slotFont};color:${filled?'var(--color-success)':s.color||'var(--brand-gold)'};
          ${filled?`background:rgba(34,197,94,0.1);border-radius:2px;padding:${portalCalExpanded?'1px 3px':'0 2px'};`:`border-bottom:1px dashed ${s.color||'var(--brand-gold)'};padding:${portalCalExpanded?'1px 0':'0'};`}
          margin-bottom:${portalCalExpanded?'2px':'1px'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
          cursor:pointer;"
          title="${filled?'✓ Clique para ver/editar':'Clique para adicionar'}: ${esc(displayTitle)}">${filled?'✓':'◌'} ${displayTitle.slice(0,maxChars)}${displayTitle.length>maxChars?'…':''}</div>`;}).join('')}
        ${(()=>{if(hasSlots)return'';return tasks.map((t,ti)=>{const maxChars=portalCalExpanded?40:12;return`<div class="pcal-task-click" data-task-idx="${ti}" data-task-date="${dateISO}"
          style="font-size:${slotFont};color:var(--brand-gold);cursor:pointer;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:${portalCalExpanded?'1px 0':0};
          border-radius:2px;transition:background 0.1s;"
          title="${t.title}${t.sector?' · 🏢 '+t.sector:''}${t.typeName?' · 📋 '+t.typeName:''}${t.requestingArea?' · 📍 '+t.requestingArea:''}">● ${t.title.slice(0,maxChars)}${t.title.length>maxChars?'…':''}${portalCalExpanded&&t.sector?` <span style="font-size:0.5rem;opacity:0.7;">🏢</span>`:''}</div>`;}).join('');})()}
        ${(()=>{if(hasSlots)return'';const rq=requestMap[dateISO];if(!rq)return'';return`<div class="pcal-req-click" data-req-date="${dateISO}"
          style="font-size:${portalCalExpanded?'0.625rem':'0.5rem'};cursor:pointer;
          padding:1px 3px;border-radius:3px;margin-top:1px;background:${rq.color}18;color:${rq.color};
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;"
          title="${rq.icon} ${rq.label}">${rq.icon} ${portalCalExpanded?rq.label:rq.label.split(' ')[0]}</div>`;})()}
        ${(()=>{if(hasSlots)return'';const bc=batchMap[dateISO];if(!bc)return'';return`<div
          style="font-size:${portalCalExpanded?'0.625rem':'0.5rem'};
          padding:1px 3px;border-radius:3px;margin-top:1px;background:rgba(167,139,250,0.15);color:#A78BFA;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;"
          title="${bc} no lote">✦ ${portalCalExpanded?bc+' no lote':'lote'}</div>`;})()}
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
      const isPast   = dm < today;
      const isWeekend= d.getDay()===0||d.getDay()===6;
      const clickable= !isPast && !isWeekend;
      const dateISO  = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const wkH = portalCalExpanded ? '160px' : '80px';
      const wkFont = portalCalExpanded ? '0.875rem' : '0.6875rem';
      const wkSlotFont = portalCalExpanded ? '0.8125rem' : '0.5625rem';
      const wkMaxChars = portalCalExpanded ? 40 : 14;
      return `<div class="${clickable?'pcal-day-cell':''}" ${clickable?`data-pcal-date="${dateISO}"`:''}
        style="padding:${portalCalExpanded?'6px':'4px'};min-height:${wkH};border-radius:4px;cursor:${clickable?'pointer':'default'};
        border:1px solid ${isToday?'var(--brand-gold)':'var(--border-subtle)'};">
        <div style="font-size:${wkFont};color:${isToday?'var(--brand-gold)':'var(--text-muted)'};
          font-weight:${isToday?700:400};margin-bottom:3px;">${PT_DAYS_S[d.getDay()]} ${d.getDate()}</div>
        ${(()=>{const wkHasSlots=slots.length>0;return slots.map(s=>{const fillInfo=getSlotFillInfo(s.title,dateISO,dayTasks);const filled=fillInfo.filled;const displayTitle=filled?fillInfo.title:s.title;return`<div class="${filled?'pcal-filled-click':'pcal-slot-click'}" ${filled?`data-req-date="${dateISO}" data-fill-source="${fillInfo.source}"`:`data-slot-date="${dateISO}"
          data-slot-title="${esc(s.title)}" data-slot-variation="${s.variationId||''}"
          data-slot-area="${esc(s.requestingArea||'')}"`}
          style="font-size:${wkSlotFont};${filled?`border:1px solid rgba(34,197,94,0.4);background:rgba(34,197,94,0.1);`:`border:1px dashed ${s.color||'var(--brand-gold)'};`}
          color:${filled?'var(--color-success)':s.color||'var(--brand-gold)'};border-radius:2px;padding:${portalCalExpanded?'2px 4px':'1px 3px'};margin-bottom:2px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;"
          title="${filled?'✓ Clique para ver/editar':'Clique para adicionar'}: ${esc(displayTitle)}">
          ${filled?'✓':'◌'} ${displayTitle.slice(0,wkMaxChars)}${displayTitle.length>wkMaxChars?'…':''}</div>`;}).join('')+
          (!wkHasSlots?dayTasks.map((t,ti)=>`<div class="pcal-task-click" data-task-idx="${ti}" data-task-date="${dateISO}"
          style="font-size:${wkSlotFont};background:rgba(212,168,67,0.12);cursor:pointer;
          color:var(--brand-gold);border-radius:2px;padding:${portalCalExpanded?'2px 4px':'1px 3px'};margin-bottom:2px;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
          title="${t.title}${t.sector?' · 🏢 '+t.sector:''}${t.typeName?' · 📋 '+t.typeName:''}">
          ● ${t.title.slice(0,wkMaxChars)}${t.title.length>wkMaxChars?'…':''}${portalCalExpanded&&t.sector?` <span style="font-size:0.5rem;opacity:0.7;">🏢</span>`:''}</div>`).join(''):'')+
          ((!wkHasSlots&&requestMap[dateISO])?(()=>{const rq=requestMap[dateISO];return`<div class="pcal-req-click" data-req-date="${dateISO}"
          style="font-size:${portalCalExpanded?'0.625rem':'0.5rem'};cursor:pointer;
          padding:1px 3px;border-radius:3px;margin-top:1px;background:${rq.color}18;color:${rq.color};
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;"
          title="${rq.icon} ${rq.label}">${rq.icon} ${rq.label}</div>`;})():'')+
          ((!wkHasSlots&&batchMap[dateISO])?(()=>{const bc=batchMap[dateISO];return`<div
          style="font-size:${portalCalExpanded?'0.625rem':'0.5rem'};
          padding:1px 3px;border-radius:3px;margin-top:1px;background:rgba(167,139,250,0.15);color:#A78BFA;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;"
          title="${bc} no lote">✦ ${portalCalExpanded?bc+' no lote':'lote'}</div>`;})():'');})()}
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
    const isPast   = dm < today;
    const isWeekend= d.getDay()===0||d.getDay()===6;
    const clickable= !isPast && !isWeekend;
    const dateISO  = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    return `<div class="${clickable&&!slots.length?'pcal-day-cell':''}" ${clickable&&!slots.length?`data-pcal-date="${dateISO}"`:''}
      style="padding:12px;">
      ${slots.length?`
        <div style="margin-bottom:10px;">
          <div style="font-size:0.75rem;font-weight:600;color:var(--brand-gold);margin-bottom:6px;">◌ Agenda do dia</div>
          ${slots.map(s=>{const fillInfo=getSlotFillInfo(s.title,dateISO,dTasks);const filled=fillInfo.filled;const displayTitle=filled?fillInfo.title:s.title;return`<div class="${filled?'pcal-filled-click':(!filled&&clickable?'pcal-slot-click':'')}" ${filled?`data-req-date="${dateISO}" data-fill-source="${fillInfo.source}"`:(clickable?`data-slot-date="${dateISO}"
            data-slot-title="${esc(s.title)}" data-slot-variation="${s.variationId||''}"
            data-slot-area="${esc(s.requestingArea||'')}"`:'')}
            style="padding:8px 10px;border-radius:4px;margin-bottom:4px;cursor:${filled||clickable?'pointer':'default'};
            ${filled?`border:1.5px solid rgba(34,197,94,0.4);background:rgba(34,197,94,0.08);`:`border:1.5px dashed ${s.color||'var(--brand-gold)'};background:${s.color||'var(--brand-gold)'}08;`}">
            <div style="font-size:0.8125rem;font-weight:500;color:${filled?'var(--color-success)':s.color||'var(--brand-gold)'};">${filled?'✓':'◌'} ${esc(displayTitle)}</div>
            ${s.requestingArea?`<div style="font-size:0.6875rem;color:var(--text-muted);">📍 ${s.requestingArea}</div>`:''}
            ${filled?`<div style="font-size:0.625rem;color:var(--color-success);margin-top:2px;">Clique para ver/editar</div>`
            :clickable?`<div style="font-size:0.625rem;color:var(--text-muted);margin-top:2px;">Clique para adicionar ao formulário</div>`:''
            }
          </div>`;}).join('')}
        </div>
      `:''}
      ${!slots.length&&dTasks.length?`
        <div>
          <div style="font-size:0.75rem;font-weight:600;color:var(--text-primary);margin-bottom:6px;">● Tarefas agendadas</div>
          ${dTasks.map((t,ti)=>`<div class="pcal-task-click" data-task-idx="${ti}" data-task-date="${dateISO}"
            style="padding:8px 10px;border-radius:4px;margin-bottom:4px;cursor:pointer;
            background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.2);transition:background 0.15s;">
            <div style="font-size:0.8125rem;color:var(--text-primary);">${t.title}</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:0.6875rem;color:var(--text-muted);margin-top:2px;">
              ${t.sector?`<span>🏢 ${t.sector}</span>`:''}
              ${t.typeName?`<span>📋 ${t.typeName}</span>`:''}
              ${t.requestingArea?`<span>📍 ${t.requestingArea}</span>`:''}
              <span>📅 ${t.dateISO.split('-').reverse().join('/')}</span>
            </div>
            <div style="font-size:0.5625rem;color:var(--text-muted);margin-top:2px;">Clique para ver detalhes</div>
          </div>`).join('')}
        </div>
      `:''}
      ${(()=>{if(slots.length)return'';const rq=requestMap[dateISO];if(!rq)return'';return`
        <div class="pcal-req-click" data-req-date="${dateISO}"
          style="margin-top:10px;padding:8px 10px;border-radius:4px;cursor:pointer;
          background:${rq.color}12;border:1px solid ${rq.color}30;transition:background 0.15s;">
          <div style="font-size:0.8125rem;font-weight:600;color:${rq.color};">${rq.icon} Sua solicitação: ${rq.label}</div>
          ${rq.title?`<div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">${esc(rq.title)}</div>`:''}
          <div style="font-size:0.5625rem;color:var(--text-muted);margin-top:2px;">Clique para ver detalhes</div>
        </div>`;})()}
      ${(()=>{if(slots.length)return'';const bc=batchMap[dateISO];if(!bc)return'';return`
        <div style="margin-top:10px;padding:8px 10px;border-radius:4px;
          background:rgba(167,139,250,0.1);border:1px solid rgba(167,139,250,0.25);">
          <div style="font-size:0.8125rem;font-weight:600;color:#A78BFA;">✦ ${bc} demanda${bc>1?'s':''} no lote</div>
          <div style="font-size:0.625rem;color:var(--text-muted);margin-top:2px;">Será${bc>1?'ão':''} enviada${bc>1?'s':''} ao submeter o lote</div>
        </div>`;})()}
      ${!slots.length&&!dTasks.length&&!requestMap[dateISO]&&!batchMap[dateISO]?`<div class="${clickable?'pcal-day-cell':''}" ${clickable?`data-pcal-date="${dateISO}"`:''}
        style="font-size:0.875rem;color:var(--text-muted);text-align:center;padding:16px 0;cursor:${clickable?'pointer':'default'};">
        Nenhuma agenda ou tarefa para este dia.${clickable?' Clique para criar demanda fora do calendário.':''}
      </div>`:''}
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
  if (portalCalExpanded) {
    wrap.style.cssText = `
      position:fixed;top:0;left:0;right:0;bottom:0;z-index:10000;
      background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;
      padding:16px;animation:fadeIn 0.2s ease-out;
    `;
  } else {
    wrap.style.cssText = 'margin-top:16px;';
  }
  wrap.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:8px;padding:${portalCalExpanded?'24px':'12px'};font-family:var(--font-ui);
      transition:all 0.2s ease;
      ${portalCalExpanded ? 'width:100%;max-width:1200px;max-height:90vh;overflow-y:auto;box-shadow:0 16px 64px rgba(0,0,0,0.4);' : ''}
    ">

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

        <!-- Fullscreen toggle -->
        <button id="pcal-expand" style="padding:3px 8px;border:1px solid var(--border-subtle);
          border-radius:4px;background:${portalCalExpanded?'var(--brand-gold)':'transparent'};
          color:${portalCalExpanded?'#000':'var(--text-muted)'};cursor:pointer;font-size:0.6875rem;"
          title="${portalCalExpanded?'Sair da tela cheia':'Tela cheia'}">
          ${portalCalExpanded?'✕ Fechar':'⛶ Tela cheia'}
        </button>
      </div>

      <!-- Nav title -->
      <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);margin-bottom:8px;">${navLabel()}</div>

      <!-- Legend -->
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px;font-size:0.6875rem;color:var(--text-muted);">
        <span>◌ Agenda (referência)</span>
        <span>● Tarefa agendada</span>
        <span style="color:#F59E0B;">◌ Aguardando triagem</span>
        <span style="color:#22C55E;">✓ Convertida</span>
      </div>

      <!-- Grid -->
      ${portalCalGran==='month'?`
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:${portalCalExpanded?'4px':'2px'};margin-bottom:4px;">
          ${PT_DAYS_S.map(d=>`<div style="text-align:center;font-size:${portalCalExpanded?'0.6875rem':'0.5625rem'};
            color:var(--text-muted);font-weight:${portalCalExpanded?600:400};">${portalCalExpanded?d:d[0]}</div>`).join('')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:${portalCalExpanded?'4px':'2px'};">${buildMonth()}</div>
      `:portalCalGran==='week'?`
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:${portalCalExpanded?'6px':'4px'};">${buildWeek()}</div>
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
  wrap.querySelector('#pcal-expand')?.addEventListener('click', () => {
    portalCalExpanded = !portalCalExpanded;
    renderPortalCalendar(db, types, null);
  });

  // Fullscreen: close on backdrop click or ESC
  if (portalCalExpanded) {
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap) {
        portalCalExpanded = false;
        renderPortalCalendar(db, types, null);
      }
    });
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        portalCalExpanded = false;
        renderPortalCalendar(db, types, null);
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  // Slot clicks → pre-fill form (or open modal if fullscreen)
  wrap.querySelectorAll('.pcal-slot-click').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const dateISO = el.dataset.slotDate;
      const title   = el.dataset.slotTitle || '';
      const varId   = el.dataset.slotVariation || '';
      const area    = el.dataset.slotArea || '';
      if (portalCalExpanded) {
        openFullscreenFormModal(db, types, {
          dateISO, title, variationId: varId, area, outOfCalendar: false,
        });
      } else {
        fillFormFromSlot(dateISO, title, varId, area);
      }
    });
  });

  // Filled slot clicks → open preview card for editing
  wrap.querySelectorAll('.pcal-filled-click').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const dateISO = el.dataset.reqDate;
      const source = el.dataset.fillSource;
      if (!dateISO) return;
      if (source === 'request') {
        const rq = requestMap[dateISO];
        if (rq) showTaskPreviewCard(db, types, { type: 'request', ...rq, dateISO }, el);
      } else if (source === 'task') {
        const date = new Date(dateISO + 'T12:00:00');
        const dayKey = date.getDate();
        const tasks = taskMap[dayKey] || [];
        if (tasks.length) showTaskPreviewCard(db, types, { type: 'task', ...tasks[0], dateISO }, el);
      } else if (source === 'batch') {
        const batchItem = batchQueue.find(item => item.desiredDate === dateISO);
        if (batchItem) {
          alert(`Este slot está no lote atual:\n\n"${batchItem.title || 'Sem título'}"\n\nRemova do lote para liberar o slot.`);
        }
      }
    });
  });

  // Empty day clicks → out-of-calendar mode (or modal if fullscreen)
  wrap.querySelectorAll('.pcal-day-cell').forEach(cell => {
    cell.addEventListener('click', (e) => {
      if (e.target.closest('.pcal-slot-click') || e.target.closest('.pcal-filled-click')) return;
      const dateISO = cell.dataset.pcalDate;
      if (!dateISO) return;
      const date  = new Date(dateISO + 'T12:00:00');
      const slots = getSlotsForDate(date);
      const dayTasks = taskMap[date.getDate()] || [];
      // Check if all slots are already filled
      const allSlotsFilled = slots.length > 0 && slots.every(s => isSlotFilled(s.title, dateISO, dayTasks));
      if (portalCalExpanded) {
        if (slots.length > 0 && !allSlotsFilled) {
          openFullscreenFormModal(db, types, {
            dateISO, title: '', variationId: '', area: '', outOfCalendar: false,
          });
        } else {
          openFullscreenFormModal(db, types, {
            dateISO, title: '', variationId: '', area: '', outOfCalendar: true,
          });
        }
      } else {
        if (slots.length > 0 && !allSlotsFilled) {
          fillFormFromSlot(dateISO, '', '', '');
        } else {
          fillFormFromEmptyDay(dateISO);
        }
      }
    });
  });

  // Task clicks → preview card
  wrap.querySelectorAll('.pcal-task-click').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const dateISO = el.dataset.taskDate;
      const idx = parseInt(el.dataset.taskIdx);
      // Find the task in taskMap
      const date = new Date(dateISO + 'T12:00:00');
      const dayKey = date.getDate();
      const tasks = taskMap[dayKey] || [];
      const task = tasks[idx];
      if (!task) return;
      showTaskPreviewCard(db, types, {
        type: 'task', ...task, dateISO,
      }, el);
    });
  });

  // Request badge clicks → preview card
  wrap.querySelectorAll('.pcal-req-click').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const dateISO = el.dataset.reqDate;
      const rq = requestMap[dateISO];
      if (!rq) return;
      showTaskPreviewCard(db, types, {
        type: 'request', ...rq, dateISO,
      }, el);
    });
  });
}


/* ─── Fullscreen calendar → form modal ────────────────────── */
function openFullscreenFormModal(db, taskTypes, opts = {}) {
  // opts: { dateISO, title, variationId, area, outOfCalendar }
  document.getElementById('fs-form-modal')?.remove();

  const types = window._portalTaskTypes || taskTypes || [];
  const activeType = types.find(t => t.id === portalCalTypeId);
  const isSlot = !!opts.title || !!opts.variationId;
  // OOC only applies if the type has calendar slots — otherwise there's no calendar to be "out of"
  const typeHasSlots = activeType?.scheduleSlots?.length > 0;
  const isOOC = typeHasSlots && opts.outOfCalendar === true;

  // Determine pre-fills (same logic as fillFormFromSlot + prefillNewsletter)
  const preSetor = activeType?.sector || '';
  const preTipo  = activeType?.name || '';
  const preNucleo = 'Design'; // default for slot-based requests

  // Build variation options from active type
  const variations = activeType?.variations || [];
  // Match variation by ID first, then fallback to title matching
  let matchedVarId = opts.variationId || '';
  if (!matchedVarId && opts.title) {
    const titleLower = opts.title.trim().toLowerCase();
    const titleMatch = variations.find(v => {
      const vName = (v.name || '').toLowerCase();
      return vName === titleLower || vName.includes(titleLower) || titleLower.includes(vName);
    });
    if (titleMatch) matchedVarId = titleMatch.id;
  }
  const variationOpts = variations.map(v => {
    const sel = v.id === matchedVarId ? 'selected' : '';
    return `<option value="${v.id}" data-sla="${v.slaDays||2}" ${sel}>${v.name}${v.slaDays ? ' · '+v.slaDays+'d' : ''}</option>`;
  }).join('');

  // Format date for display
  const dateParts = opts.dateISO ? opts.dateISO.split('-') : [];
  const dateDisplay = dateParts.length === 3
    ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}`
    : '';

  // SLA display for selected variation
  const selectedVar = variations.find(v => v.id === matchedVarId);
  const slaDisplay = selectedVar?.slaDays != null
    ? (selectedVar.slaDays === 0 ? 'Mesmo dia' : `${selectedVar.slaDays} dia${selectedVar.slaDays!==1?'s':''}`)
    : '';

  // Check urgency: 24h rule OR SLA-based rule
  let isUrgentLocked = false;
  let urgentReason = '';
  if (opts.dateISO) {
    const deadline = new Date(opts.dateISO + 'T23:59:59');
    const hoursUntil = (deadline - new Date()) / 3600000;
    if (hoursUntil <= 24) {
      isUrgentLocked = true;
      urgentReason = 'Prazo inferior a 24h. Urgência definida automaticamente.';
    } else if (selectedVar?.slaDays != null) {
      const bizDays = countBusinessDays(new Date(), new Date(opts.dateISO + 'T23:59:59'));
      if (bizDays < selectedVar.slaDays) {
        isUrgentLocked = true;
        urgentReason = `Prazo (${bizDays} dia${bizDays!==1?'s':''} útil) inferior ao SLA (${selectedVar.slaDays} dia${selectedVar.slaDays!==1?'s':''}). Urgência definida automaticamente.`;
      }
    }
  }

  const overlay = document.createElement('div');
  overlay.id = 'fs-form-modal';
  overlay.style.cssText = `
    position:fixed;top:0;left:0;right:0;bottom:0;z-index:10001;
    display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,0.5);padding:16px;animation:fadeIn 0.15s ease-out;
  `;
  overlay.innerHTML = `
    <div id="fs-form-content" style="background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:12px;padding:24px;width:100%;max-width:560px;max-height:85vh;overflow-y:auto;
      box-shadow:0 20px 60px rgba(0,0,0,0.5);animation:slideUp 0.2s ease-out;font-family:var(--font-ui);">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div>
          <div style="font-size:1rem;font-weight:600;color:var(--text-primary);">
            ${isOOC ? '📝 Nova solicitação' : '📅 Solicitação via calendário'}
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
            ${dateDisplay ? `Data: <strong style="color:var(--brand-gold);">${dateDisplay}</strong>` : ''}
            ${isOOC ? ' · <span style="color:#F59E0B;">Fora do calendário</span>' : ''}
          </div>
        </div>
        <button id="fs-form-close" style="background:none;border:none;font-size:1.25rem;
          color:var(--text-muted);cursor:pointer;padding:4px 8px;border-radius:4px;
          transition:all 0.15s;" title="Fechar">✕</button>
      </div>

      ${isOOC ? `
        <div style="background:#FEF3C720;border:1px solid #F59E0B40;border-radius:8px;padding:10px;
          margin-bottom:16px;font-size:0.75rem;color:#F59E0B;">
          ⚠ <strong>Fora do calendário</strong> — esta data não possui agenda programada.
          Demandas fora do calendário podem impactar o planejamento da equipe.
        </div>
      ` : ''}

      <!-- Pre-filled info (read-only) -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
        <div style="padding:8px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border-subtle);">
          <div style="font-size:0.625rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:2px;">Setor responsável</div>
          <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);">📁 ${esc(preSetor || '—')}</div>
        </div>
        <div style="padding:8px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border-subtle);">
          <div style="font-size:0.625rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:2px;">Tipo de demanda</div>
          <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);">${activeType?.icon||'📋'} ${esc(preTipo || '—')}</div>
        </div>
        <div style="padding:8px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border-subtle);">
          <div style="font-size:0.625rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:2px;">Núcleo responsável</div>
          <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);">🎨 ${esc(preNucleo)}</div>
        </div>
        <div style="padding:8px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border-subtle);">
          <div style="font-size:0.625rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:2px;">Solicitante</div>
          <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);">👤 ${esc(portalUser?.name || portalUser?.email || '')}</div>
        </div>
      </div>

      <!-- Título -->
      <div style="margin-bottom:12px;">
        <label style="font-size:0.75rem;font-weight:500;color:var(--text-secondary);margin-bottom:4px;display:block;">
          Título da demanda <span style="color:#EF4444;">*</span>
        </label>
        <input type="text" id="fs-title" style="width:100%;padding:8px 12px;border-radius:6px;
          border:1px solid var(--border-subtle);background:var(--bg-card);color:var(--text-primary);
          font-size:0.875rem;font-family:var(--font-ui);outline:none;box-sizing:border-box;"
          value="${esc(opts.title || '')}" placeholder="Ex: Newsletter Maio — Programa ICs" maxlength="120" />
        <div id="fs-err-title" style="display:none;font-size:0.6875rem;color:#EF4444;margin-top:4px;">
          Informe um título (mín. 3 caracteres).
        </div>
      </div>

      <!-- Descrição -->
      <div style="margin-bottom:12px;">
        <label style="font-size:0.75rem;font-weight:500;color:var(--text-secondary);margin-bottom:4px;display:block;">
          Descrição <span style="color:#EF4444;">*</span>
        </label>
        <textarea id="fs-desc" rows="3" style="width:100%;padding:8px 12px;border-radius:6px;
          border:1px solid var(--border-subtle);background:var(--bg-card);color:var(--text-primary);
          font-size:0.875rem;font-family:var(--font-ui);resize:vertical;outline:none;box-sizing:border-box;"
          placeholder="Descreva em detalhes o que você precisa..."></textarea>
        <div id="fs-err-desc" style="display:none;font-size:0.6875rem;color:#EF4444;margin-top:4px;">
          Descreva sua demanda (mín. 10 caracteres).
        </div>
      </div>

      ${variations.length ? `
      <!-- Variação -->
      <div style="margin-bottom:12px;">
        <label style="font-size:0.75rem;font-weight:500;color:var(--text-secondary);margin-bottom:4px;display:block;">
          Variação do material
        </label>
        <select id="fs-variation" style="width:100%;padding:8px 12px;border-radius:6px;
          border:1px solid var(--border-subtle);background:var(--bg-card);color:var(--text-primary);
          font-size:0.875rem;font-family:var(--font-ui);outline:none;box-sizing:border-box;">
          <option value="">— Selecione —</option>
          ${variationOpts}
        </select>
        ${slaDisplay ? `<div id="fs-sla" style="font-size:0.6875rem;color:var(--brand-gold);margin-top:4px;">⏱ SLA: <strong>${slaDisplay}</strong></div>` : '<div id="fs-sla" style="display:none;font-size:0.6875rem;color:var(--brand-gold);margin-top:4px;"></div>'}
      </div>
      ` : ''}

      <!-- Urgência toggle -->
      <div style="margin-bottom:16px;">
        <label id="fs-urgency-toggle" style="display:flex;align-items:center;gap:10px;
          ${isUrgentLocked ? 'cursor:not-allowed;opacity:0.85;' : 'cursor:pointer;'}
          padding:8px 12px;border-radius:6px;
          border:1px solid ${isUrgentLocked ? '#EF444440' : 'var(--border-subtle)'};
          background:${isUrgentLocked ? '#EF444410' : 'var(--bg-card)'};transition:all 0.15s;">
          <div id="fs-urgency-dot" style="width:20px;height:20px;border-radius:50%;
            border:2px solid ${isUrgentLocked ? '#EF4444' : 'var(--border-subtle)'};
            background:${isUrgentLocked ? '#EF4444' : 'transparent'};
            display:flex;align-items:center;justify-content:center;
            font-size:0.625rem;color:${isUrgentLocked ? '#fff' : 'transparent'};
            transition:all 0.15s;flex-shrink:0;">✓</div>
          <div>
            <div style="font-size:0.8125rem;font-weight:500;color:var(--text-primary);">
              ${isUrgentLocked ? '🔒 Urgente' : 'Marcar como urgente'}
            </div>
            <div style="font-size:0.6875rem;color:var(--text-muted);">
              ${isUrgentLocked
                ? urgentReason
                : 'Apenas se há prazo real e inegociável.'}
            </div>
          </div>
        </label>
      </div>

      ${activeType?.autoAccept ? `
      <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.25);border-radius:8px;
        padding:10px;margin-bottom:16px;font-size:0.75rem;color:#22C55E;">
        ✓ <strong>Aceite automático</strong> — esta solicitação será convertida em tarefa imediatamente.
      </div>
      ` : ''}

      <!-- Actions -->
      <div style="display:flex;gap:8px;">
        <button id="fs-form-submit" style="flex:1;padding:10px 16px;border-radius:6px;border:none;
          background:var(--brand-gold);color:#000;font-weight:600;font-size:0.875rem;
          cursor:pointer;font-family:var(--font-ui);transition:all 0.15s;">
          Enviar solicitação →
        </button>
        <button id="fs-form-batch" style="padding:10px 16px;border-radius:6px;
          border:1px solid var(--border-subtle);background:transparent;color:var(--text-secondary);
          font-weight:500;font-size:0.8125rem;cursor:pointer;font-family:var(--font-ui);
          transition:all 0.15s;" title="Adicionar ao lote e continuar selecionando">
          + Lote
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // ── Variation → SLA update + urgency re-check ──
  overlay.querySelector('#fs-variation')?.addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    const days = parseInt(opt?.dataset?.sla);
    const slaEl = overlay.querySelector('#fs-sla');
    if (slaEl && opt?.value && !isNaN(days)) {
      slaEl.style.display = 'block';
      slaEl.innerHTML = `⏱ SLA: <strong>${days === 0 ? 'Mesmo dia' : days + ' dia' + (days !== 1 ? 's' : '')}</strong>`;
    } else if (slaEl) {
      slaEl.style.display = 'none';
    }
    // Re-check urgency based on new SLA
    if (opts.dateISO && opt?.value && !isNaN(days)) {
      const deadline = new Date(opts.dateISO + 'T23:59:59');
      const hoursUntil = (deadline - new Date()) / 3600000;
      const bizDays = countBusinessDays(new Date(), deadline);
      const shouldLock = hoursUntil <= 24 || bizDays < days;
      if (shouldLock && !fsUrgent) {
        fsUrgent = true;
        isUrgentLocked = true;
        const reason = hoursUntil <= 24
          ? 'Prazo inferior a 24h. Urgência definida automaticamente.'
          : `Prazo (${bizDays} dia${bizDays!==1?'s':''} útil) inferior ao SLA (${days} dia${days!==1?'s':''}). Urgência definida automaticamente.`;
        urgDot.style.cssText += 'border-color:#EF4444;background:#EF4444;color:#fff;';
        urgToggle.style.borderColor = '#EF444440';
        urgToggle.style.background = '#EF444410';
        urgToggle.style.cursor = 'not-allowed';
        urgToggle.style.opacity = '0.85';
        urgToggle.querySelector('div > div:first-child').textContent = '🔒 Urgente';
        urgToggle.querySelector('div > div:last-child').textContent = reason;
      } else if (!shouldLock && isUrgentLocked) {
        // Was auto-locked but new variation has enough SLA — unlock
        fsUrgent = false;
        isUrgentLocked = false;
        urgDot.style.cssText += 'border-color:var(--border-subtle);background:transparent;color:transparent;';
        urgToggle.style.borderColor = 'var(--border-subtle)';
        urgToggle.style.background = 'var(--bg-card)';
        urgToggle.style.cursor = 'pointer';
        urgToggle.style.opacity = '1';
        urgToggle.querySelector('div > div:first-child').textContent = 'Marcar como urgente';
        urgToggle.querySelector('div > div:last-child').textContent = 'Apenas se há prazo real e inegociável.';
      }
    }
  });

  // ── Urgency toggle ──
  let fsUrgent = isUrgentLocked;
  const urgToggle = overlay.querySelector('#fs-urgency-toggle');
  const urgDot = overlay.querySelector('#fs-urgency-dot');
  if (!isUrgentLocked) {
    urgToggle?.addEventListener('click', () => {
      fsUrgent = !fsUrgent;
      if (fsUrgent) {
        urgDot.style.cssText += 'border-color:#EF4444;background:#EF4444;color:#fff;';
        urgToggle.style.borderColor = '#EF444440';
        urgToggle.style.background = '#EF444410';
      } else {
        urgDot.style.cssText += 'border-color:var(--border-subtle);background:transparent;color:transparent;';
        urgToggle.style.borderColor = 'var(--border-subtle)';
        urgToggle.style.background = 'var(--bg-card)';
      }
    });
  }

  // ── Close ──
  const escFn = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeModal(); } };
  const closeModal = () => { overlay.remove(); document.removeEventListener('keydown', escFn, true); };
  overlay.querySelector('#fs-form-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', escFn, true);

  // ── Validate modal fields ──
  const validateModal = () => {
    let ok = true;
    const titleVal = overlay.querySelector('#fs-title')?.value?.trim() || '';
    const descVal = overlay.querySelector('#fs-desc')?.value?.trim() || '';
    const errTitle = overlay.querySelector('#fs-err-title');
    const errDesc = overlay.querySelector('#fs-err-desc');
    if (titleVal.length < 3) { errTitle.style.display = 'block'; overlay.querySelector('#fs-title').style.borderColor = '#EF4444'; ok = false; }
    else { errTitle.style.display = 'none'; overlay.querySelector('#fs-title').style.borderColor = 'var(--border-subtle)'; }
    if (descVal.length < 10) { errDesc.style.display = 'block'; overlay.querySelector('#fs-desc').style.borderColor = '#EF4444'; ok = false; }
    else { errDesc.style.display = 'none'; overlay.querySelector('#fs-desc').style.borderColor = 'var(--border-subtle)'; }
    return ok;
  };

  // ── Transfer modal data to real form ──
  const transferToForm = () => {
    const titleVal = overlay.querySelector('#fs-title')?.value?.trim() || '';
    const descVal = overlay.querySelector('#fs-desc')?.value?.trim() || '';
    const varVal = overlay.querySelector('#fs-variation')?.value || '';

    // Fill the real form fields (same pre-fill logic as fillFormFromSlot)
    // 1. Date
    const dateEl = document.getElementById('p-date');
    if (dateEl) { dateEl.value = opts.dateISO || ''; }

    // 2. Setor (from active type's sector)
    if (preSetor) {
      const setorEl = document.getElementById('p-setor');
      if (setorEl) {
        setorEl.value = preSetor;
        setorEl.dispatchEvent(new Event('change'));
      }
    }

    // 3. Wait for cascade then set tipo + nucleo + title + variation
    setTimeout(() => {
      // Type
      if (portalCalTypeId) {
        const typeEl = document.getElementById('p-type');
        if (typeEl) typeEl.value = portalCalTypeId;
      }

      // Núcleo = "Design"
      const nucleoSel = document.getElementById('p-nucleo');
      if (nucleoSel) {
        const designOpt = Array.from(nucleoSel.options).find(o =>
          o.value.toLowerCase().includes('design') || o.textContent.toLowerCase().includes('design')
        );
        if (designOpt) nucleoSel.value = designOpt.value;
      }

      // Title from modal
      const titleEl = document.getElementById('p-title');
      if (titleEl) titleEl.value = titleVal;

      // Description from modal
      const descEl = document.getElementById('p-desc');
      if (descEl) descEl.value = descVal;

      // Variation
      if (varVal || opts.variationId) {
        const varEl = document.getElementById('p-variation');
        if (varEl) {
          varEl.value = varVal || opts.variationId;
          varEl.dispatchEvent(new Event('change'));
        }
      }

      // Area (if slot has one)
      if (opts.area) {
        const areaSel = document.getElementById('p-area');
        if (areaSel) {
          for (const opt of areaSel.options) { if (opt.value === opts.area) { areaSel.value = opts.area; break; } }
        }
      }

      // Urgency
      if (fsUrgent) {
        lockToggle('urgency-toggle', 'p-urgency', 'urgency-dot', true);
        document.getElementById('urgency-alert')?.classList.add('visible');
        if (isUrgentLocked) {
          showLockedBanner('locked-urgency-banner', 'urgency-toggle',
            urgentReason || 'Prazo insuficiente. Urgência definida automaticamente.');
        }
      }

      // Out of calendar
      if (isOOC) {
        lockToggle('out-of-calendar-toggle', 'p-out-of-calendar', 'out-calendar-dot', true);
        document.getElementById('out-calendar-alert')?.style && (document.getElementById('out-calendar-alert').style.display = 'flex');
        showLockedBanner('locked-ooc-banner', 'out-of-calendar-toggle',
          'Esta data não está no calendário editorial. "Fora do calendário" foi definido automaticamente.');
      }
    }, 500); // wait for setor cascade
  };

  // ── Submit single ──
  overlay.querySelector('#fs-form-submit').addEventListener('click', async () => {
    if (!validateModal()) return;
    const submitBtn = overlay.querySelector('#fs-form-submit');
    submitBtn.disabled = true; submitBtn.textContent = 'Enviando...';
    transferToForm();
    closeModal();
    // Close fullscreen calendar
    portalCalExpanded = false;
    // Wait for cascade to finish then submit
    setTimeout(async () => {
      await handleSubmit(db, taskTypes);
      // After submit, re-render calendar to show new request visually
      renderPortalCalendar(db, taskTypes, null);
    }, 600);
  });

  // ── Add to batch ──
  overlay.querySelector('#fs-form-batch').addEventListener('click', () => {
    if (!validateModal()) return;
    // Collect directly from modal (bypass main form cascade timing issues)
    const titleVal = overlay.querySelector('#fs-title')?.value?.trim() || '';
    const descVal  = overlay.querySelector('#fs-desc')?.value?.trim() || '';
    const varEl    = overlay.querySelector('#fs-variation');
    const varVal   = varEl?.value || '';
    const varName  = varEl?.selectedOptions?.[0]?.textContent?.split('·')[0]?.trim() || '';
    const item = {
      requestingArea: opts.area || document.getElementById('p-area')?.value || '',
      sector:         preSetor || document.getElementById('p-setor')?.value || '',
      typeId:         portalCalTypeId || '',
      typeName:       activeType?.name || '',
      typeIcon:       activeType?.icon || '',
      typeColor:      activeType?.color || '#D4A843',
      autoAccept:     activeType?.autoAccept || false,
      variationId:    varVal || opts.variationId || null,
      variationName:  varName,
      nucleo:         'Design',
      title:          titleVal || opts.slotTitle || '',
      description:    descVal,
      urgency:        fsUrgent || false,
      outOfCalendar:  isOOC,
      desiredDate:    opts.dateISO || '',
    };
    if (currentEditIndex >= 0) {
      batchQueue[currentEditIndex] = item;
      currentEditIndex = -1;
    } else {
      batchQueue.push(item);
    }
    closeModal();
    renderBatchList(taskTypes);
    renderPortalCalendar(db, taskTypes, null);
  });

  // Focus title
  setTimeout(() => overlay.querySelector('#fs-title')?.focus(), 100);
}

/* ─── Task/Request preview card (calendar click) ────────────── */
function showTaskPreviewCard(db, taskTypes, data, anchorEl) {
  // data: { type: 'task'|'request', id, title, status, requestingArea, dateISO,
  //          requesterName, description, urgency, outOfCalendar, typeName }
  document.getElementById('pcal-preview-card')?.remove();

  const STATUS_MAP = {
    pending:     { label: 'Aguardando triagem', color: '#F59E0B', bg: '#FEF3C7' },
    converted:   { label: 'Convertida em tarefa', color: '#22C55E', bg: '#DCFCE7' },
    rejected:    { label: 'Recusada', color: '#EF4444', bg: '#FEE2E2' },
    completed:   { label: 'Concluída', color: '#22C55E', bg: '#DCFCE7' },
    done:        { label: 'Concluída', color: '#22C55E', bg: '#DCFCE7' },
    in_progress: { label: 'Em andamento', color: '#38BDF8', bg: '#DBEAFE' },
    todo:        { label: 'A fazer', color: '#94A3B8', bg: '#F1F5F9' },
    not_started: { label: 'Não iniciada', color: '#94A3B8', bg: '#F1F5F9' },
  };
  const st = STATUS_MAP[data.status] || STATUS_MAP.pending;

  const dateParts = data.dateISO ? data.dateISO.split('-') : [];
  const dateDisplay = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : '';

  // Editable: only user's own requests, status pending or converted (not rejected)
  const isOwnRequest = data.type === 'request' && data.id;
  const isEditable = isOwnRequest && (data.status === 'pending' || data.status === 'converted');

  const card = document.createElement('div');
  card.id = 'pcal-preview-card';
  card.style.cssText = `
    position:fixed;top:0;left:0;right:0;bottom:0;z-index:10002;
    display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,0.4);padding:16px;animation:fadeIn 0.15s ease-out;
  `;
  card.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:12px;padding:20px;width:100%;max-width:440px;
      box-shadow:0 16px 48px rgba(0,0,0,0.4);animation:slideUp 0.2s ease-out;font-family:var(--font-ui);">

      <!-- Card header -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.625rem;text-transform:uppercase;letter-spacing:0.06em;
            color:var(--text-muted);margin-bottom:4px;">
            ${data.type === 'task' ? '● Tarefa agendada' : '◌ Solicitação'}
          </div>
          <div style="font-size:1rem;font-weight:600;color:var(--text-primary);
            overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${esc(data.title || 'Sem título')}
          </div>
        </div>
        <button id="pcal-preview-close" style="background:none;border:none;font-size:1.125rem;
          color:var(--text-muted);cursor:pointer;padding:2px 6px;margin-left:8px;">✕</button>
      </div>

      <!-- Status badge -->
      <div style="margin-bottom:12px;">
        <span style="display:inline-block;font-size:0.6875rem;font-weight:600;padding:3px 10px;
          border-radius:20px;background:${st.bg};color:${st.color};border:1px solid ${st.color}30;">
          ${st.label}
        </span>
        ${data.urgency ? '<span style="margin-left:6px;font-size:0.6875rem;color:#EF4444;font-weight:600;">🔴 Urgente</span>' : ''}
        ${data.outOfCalendar ? '<span style="margin-left:6px;font-size:0.6875rem;color:#F59E0B;font-weight:600;">⚠ Fora do calendário</span>' : ''}
      </div>

      <!-- Details grid -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;font-size:0.75rem;">
        ${dateDisplay ? `
        <div style="padding:6px 10px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border-subtle);">
          <div style="font-size:0.5625rem;text-transform:uppercase;color:var(--text-muted);margin-bottom:1px;">Data</div>
          <div style="color:var(--text-primary);font-weight:500;">${dateDisplay}</div>
        </div>` : ''}
        ${data.typeName ? `
        <div style="padding:6px 10px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border-subtle);">
          <div style="font-size:0.5625rem;text-transform:uppercase;color:var(--text-muted);margin-bottom:1px;">Tipo</div>
          <div style="color:var(--text-primary);font-weight:500;">${esc(data.typeName)}</div>
        </div>` : ''}
        ${data.requestingArea ? `
        <div style="padding:6px 10px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border-subtle);">
          <div style="font-size:0.5625rem;text-transform:uppercase;color:var(--text-muted);margin-bottom:1px;">Área</div>
          <div style="color:var(--text-primary);font-weight:500;">${esc(data.requestingArea)}</div>
        </div>` : ''}
        ${data.requesterName ? `
        <div style="padding:6px 10px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border-subtle);">
          <div style="font-size:0.5625rem;text-transform:uppercase;color:var(--text-muted);margin-bottom:1px;">Solicitante</div>
          <div style="color:var(--text-primary);font-weight:500;">${esc(data.requesterName)}</div>
        </div>` : ''}
      </div>

      ${data.description ? `
      <div style="padding:10px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border-subtle);
        font-size:0.8125rem;color:var(--text-secondary);line-height:1.5;margin-bottom:12px;
        max-height:120px;overflow-y:auto;">
        ${esc(data.description).slice(0, 300)}${(data.description || '').length > 300 ? '…' : ''}
      </div>` : ''}

      <!-- Edit history (loaded async) -->
      <div id="pcal-preview-history"></div>

      <!-- Actions -->
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        ${isEditable ? `
        <button id="pcal-preview-edit" style="padding:6px 16px;border-radius:6px;border:none;
          background:var(--brand-gold);color:#000;font-size:0.8125rem;font-weight:600;cursor:pointer;
          font-family:var(--font-ui);transition:all 0.15s;">
          ✏ Editar solicitação
        </button>` : ''}
        <button id="pcal-preview-close2" style="padding:6px 16px;border-radius:6px;border:1px solid var(--border-subtle);
          background:transparent;color:var(--text-secondary);font-size:0.8125rem;cursor:pointer;
          font-family:var(--font-ui);">Fechar</button>
      </div>
    </div>
  `;

  document.body.appendChild(card);

  // Load edit history if request has it
  if (data.id && data.type === 'request') {
    getDoc(doc(db, 'requests', data.id)).then(snap => {
      if (!snap.exists()) return;
      const history = snap.data().editHistory || [];
      if (!history.length) return;
      const histEl = card.querySelector('#pcal-preview-history');
      if (!histEl) return;
      histEl.innerHTML = `
        <div style="background:#FEF3C710;border:1px solid #F59E0B30;border-radius:8px;
          padding:10px 12px;margin-bottom:12px;font-size:0.6875rem;">
          <div style="font-weight:600;color:#F59E0B;margin-bottom:6px;">📝 Histórico de alterações (${history.length})</div>
          ${history.slice(-3).reverse().map(h => {
            const dt = h.editedAt?.toDate ? h.editedAt.toDate() : new Date(h.editedAt);
            const fields = Object.keys(h.changes || {}).map(k => {
              const labels = { title:'Título', description:'Descrição', desiredDate:'Data', urgency:'Urgência' };
              return labels[k] || k;
            }).join(', ');
            return `<div style="color:var(--text-muted);margin-bottom:3px;padding-left:8px;border-left:2px solid #F59E0B30;">
              <span style="color:var(--text-secondary);">${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</span>
              — Alterou: ${fields}
            </div>`;
          }).join('')}
          ${history.length > 3 ? `<div style="color:var(--text-muted);margin-top:4px;">+ ${history.length - 3} alteraç${history.length-3===1?'ão':'ões'} anteriores</div>` : ''}
        </div>
      `;
    }).catch(() => {});
  }

  const closeCard = () => card.remove();
  card.querySelector('#pcal-preview-close').addEventListener('click', closeCard);
  card.querySelector('#pcal-preview-close2').addEventListener('click', closeCard);
  card.addEventListener('click', (e) => { if (e.target === card) closeCard(); });
  const escCard = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeCard(); document.removeEventListener('keydown', escCard, true); } };
  document.addEventListener('keydown', escCard, true);

  // Edit button
  card.querySelector('#pcal-preview-edit')?.addEventListener('click', () => {
    closeCard();
    openEditRequestModal(db, taskTypes, data);
  });
}

/* ─── Edit request modal ─────────────────────────────────────── */
async function openEditRequestModal(db, taskTypes, data) {
  // data: { id, title, description, dateISO, urgency, outOfCalendar, status, typeName, ... }
  document.getElementById('fs-edit-modal')?.remove();

  // Load full request from Firestore
  let reqData = {};
  try {
    const snap = await getDoc(doc(db, 'requests', data.id));
    if (snap.exists()) reqData = snap.data();
  } catch(e) { console.warn('Load request error:', e); }

  const dateParts = data.dateISO ? data.dateISO.split('-') : [];
  const dateDisplay = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : '';

  // Resolve tipo de demanda info
  const types = window._portalTaskTypes || taskTypes || [];
  const editTypeId = reqData.typeId || data.typeId || '';
  const editTypeData = types.find(t => t.id === editTypeId);
  const editTypeName = editTypeData?.name || reqData.typeName || data.typeName || '';
  const editTypeIcon = editTypeData?.icon || '';
  const editSector = editTypeData?.sector || reqData.sector || '';
  const editNucleo = reqData.nucleo || '';
  const editVariation = reqData.variationName || '';

  const overlay = document.createElement('div');
  overlay.id = 'fs-edit-modal';
  overlay.style.cssText = `
    position:fixed;top:0;left:0;right:0;bottom:0;z-index:10002;
    display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,0.5);padding:16px;animation:fadeIn 0.15s ease-out;
  `;
  overlay.innerHTML = `
    <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);
      border-radius:12px;padding:24px;width:100%;max-width:520px;max-height:85vh;overflow-y:auto;
      box-shadow:0 20px 60px rgba(0,0,0,0.5);animation:slideUp 0.2s ease-out;font-family:var(--font-ui);">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <div>
          <div style="font-size:1rem;font-weight:600;color:var(--text-primary);">✏ Editar solicitação</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
            Enviada em ${dateDisplay}
          </div>
        </div>
        <button id="fs-edit-close" style="background:none;border:none;font-size:1.25rem;
          color:var(--text-muted);cursor:pointer;padding:4px 8px;">✕</button>
      </div>

      <!-- Request context (read-only) -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;">
        ${editTypeName ? `
        <div style="padding:8px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border-subtle);">
          <div style="font-size:0.5625rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:2px;">Tipo de demanda</div>
          <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);">${editTypeIcon} ${esc(editTypeName)}</div>
        </div>` : ''}
        ${editSector ? `
        <div style="padding:8px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border-subtle);">
          <div style="font-size:0.5625rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:2px;">Setor</div>
          <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);">📁 ${esc(editSector)}</div>
        </div>` : ''}
        ${editNucleo ? `
        <div style="padding:8px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border-subtle);">
          <div style="font-size:0.5625rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:2px;">Núcleo</div>
          <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);">🎨 ${esc(editNucleo)}</div>
        </div>` : ''}
        ${editVariation ? `
        <div style="padding:8px 12px;border-radius:6px;background:var(--bg-card);border:1px solid var(--border-subtle);">
          <div style="font-size:0.5625rem;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:2px;">Variação</div>
          <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);">${esc(editVariation)}</div>
        </div>` : ''}
      </div>

      <!-- Warning -->
      <div style="background:#FEF3C720;border:1px solid #F59E0B40;border-radius:8px;padding:10px;
        margin-bottom:16px;font-size:0.75rem;color:#F59E0B;">
        ⚠ <strong>Atenção:</strong> Alterações serão registradas e notificadas à equipe de produção.
        ${data.status === 'converted' ? 'Esta solicitação já foi convertida em tarefa — a tarefa também será atualizada.' : ''}
      </div>

      <!-- Title -->
      <div style="margin-bottom:12px;">
        <label style="font-size:0.75rem;font-weight:500;color:var(--text-secondary);margin-bottom:4px;display:block;">
          Título da demanda <span style="color:#EF4444;">*</span>
        </label>
        <input type="text" id="fs-edit-title" style="width:100%;padding:8px 12px;border-radius:6px;
          border:1px solid var(--border-subtle);background:var(--bg-card);color:var(--text-primary);
          font-size:0.875rem;font-family:var(--font-ui);outline:none;box-sizing:border-box;"
          value="${esc(reqData.title || data.title || '')}" maxlength="120" />
      </div>

      <!-- Description -->
      <div style="margin-bottom:12px;">
        <label style="font-size:0.75rem;font-weight:500;color:var(--text-secondary);margin-bottom:4px;display:block;">
          Descrição <span style="color:#EF4444;">*</span>
        </label>
        <textarea id="fs-edit-desc" rows="4" style="width:100%;padding:8px 12px;border-radius:6px;
          border:1px solid var(--border-subtle);background:var(--bg-card);color:var(--text-primary);
          font-size:0.875rem;font-family:var(--font-ui);resize:vertical;outline:none;box-sizing:border-box;"
        >${esc(reqData.description || data.description || '')}</textarea>
      </div>

      <!-- Date -->
      <div style="margin-bottom:12px;">
        <label style="font-size:0.75rem;font-weight:500;color:var(--text-secondary);margin-bottom:4px;display:block;">
          Data desejada
        </label>
        <input type="date" id="fs-edit-date" style="width:100%;padding:8px 12px;border-radius:6px;
          border:1px solid var(--border-subtle);background:var(--bg-card);color:var(--text-primary);
          font-size:0.875rem;font-family:var(--font-ui);outline:none;box-sizing:border-box;"
          value="${data.dateISO || ''}" />
      </div>

      <!-- Urgency -->
      <div style="margin-bottom:16px;">
        <label id="fs-edit-urgency-toggle" style="display:flex;align-items:center;gap:10px;cursor:pointer;
          padding:8px 12px;border-radius:6px;border:1px solid ${reqData.urgency?'#EF444440':'var(--border-subtle)'};
          background:${reqData.urgency?'#EF444410':'var(--bg-card)'};transition:all 0.15s;">
          <div id="fs-edit-urgency-dot" style="width:20px;height:20px;border-radius:50%;
            border:2px solid ${reqData.urgency?'#EF4444':'var(--border-subtle)'};
            background:${reqData.urgency?'#EF4444':'transparent'};
            display:flex;align-items:center;justify-content:center;
            font-size:0.625rem;color:${reqData.urgency?'#fff':'transparent'};
            transition:all 0.15s;flex-shrink:0;">✓</div>
          <div>
            <div style="font-size:0.8125rem;font-weight:500;color:var(--text-primary);">Marcar como urgente</div>
          </div>
        </label>
      </div>

      <!-- Actions -->
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="fs-edit-cancel" style="padding:8px 16px;border-radius:6px;border:1px solid var(--border-subtle);
          background:transparent;color:var(--text-secondary);font-size:0.8125rem;cursor:pointer;
          font-family:var(--font-ui);">Cancelar</button>
        <button id="fs-edit-save" style="padding:8px 20px;border-radius:6px;border:none;
          background:var(--brand-gold);color:#000;font-weight:600;font-size:0.875rem;cursor:pointer;
          font-family:var(--font-ui);transition:all 0.15s;">
          Salvar alterações
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Urgency toggle
  let editUrgent = !!(reqData.urgency);
  const urgToggle = overlay.querySelector('#fs-edit-urgency-toggle');
  const urgDot = overlay.querySelector('#fs-edit-urgency-dot');
  urgToggle?.addEventListener('click', () => {
    editUrgent = !editUrgent;
    if (editUrgent) {
      urgDot.style.cssText += 'border-color:#EF4444;background:#EF4444;color:#fff;';
      urgToggle.style.borderColor = '#EF444440';
      urgToggle.style.background = '#EF444410';
    } else {
      urgDot.style.cssText += 'border-color:var(--border-subtle);background:transparent;color:transparent;';
      urgToggle.style.borderColor = 'var(--border-subtle)';
      urgToggle.style.background = 'var(--bg-card)';
    }
  });

  // Auto-check urgency when date changes in edit modal
  overlay.querySelector('#fs-edit-date')?.addEventListener('change', (e) => {
    const newDate = e.target.value;
    if (!newDate) return;
    const deadline = new Date(newDate + 'T23:59:59');
    const hoursUntil = (deadline - new Date()) / 3600000;
    // Get SLA from the request's variation
    const varId = reqData.variationId;
    const varData = editTypeData?.variations?.find(v => v.id === varId);
    const slaDays = varData?.slaDays;
    const bizDays = countBusinessDays(new Date(), deadline);
    let shouldLock = false;
    let reason = '';
    if (hoursUntil <= 24) {
      shouldLock = true;
      reason = 'Prazo inferior a 24h.';
    } else if (slaDays != null && bizDays < slaDays) {
      shouldLock = true;
      reason = `Prazo (${bizDays}d útil) < SLA (${slaDays}d).`;
    }
    if (shouldLock && !editUrgent) {
      editUrgent = true;
      urgDot.style.cssText += 'border-color:#EF4444;background:#EF4444;color:#fff;';
      urgToggle.style.borderColor = '#EF444440';
      urgToggle.style.background = '#EF444410';
      // Show inline message
      let infoEl = overlay.querySelector('#fs-edit-urgency-info');
      if (!infoEl) {
        infoEl = document.createElement('div');
        infoEl.id = 'fs-edit-urgency-info';
        infoEl.style.cssText = 'font-size:0.6875rem;color:#F59E0B;margin-top:6px;padding:4px 8px;background:#FEF3C720;border-radius:4px;';
        urgToggle.parentElement.appendChild(infoEl);
      }
      infoEl.textContent = `🔒 ${reason} Urgência definida automaticamente.`;
    }
  });

  // Close
  const closeEdit = () => overlay.remove();
  overlay.querySelector('#fs-edit-close').addEventListener('click', closeEdit);
  overlay.querySelector('#fs-edit-cancel').addEventListener('click', closeEdit);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeEdit(); });

  // Save
  overlay.querySelector('#fs-edit-save').addEventListener('click', async () => {
    const newTitle = overlay.querySelector('#fs-edit-title')?.value?.trim() || '';
    const newDesc  = overlay.querySelector('#fs-edit-desc')?.value?.trim() || '';
    const newDate  = overlay.querySelector('#fs-edit-date')?.value || '';

    if (newTitle.length < 3) { alert('Título precisa ter ao menos 3 caracteres.'); return; }
    if (newDesc.length < 10) { alert('Descrição precisa ter ao menos 10 caracteres.'); return; }

    const saveBtn = overlay.querySelector('#fs-edit-save');
    saveBtn.disabled = true; saveBtn.textContent = 'Salvando...';

    try {
      // Detect what changed
      const changes = {};
      const oldTitle = reqData.title || '';
      const oldDesc  = reqData.description || '';
      const oldDate  = reqData.desiredDate ? (reqData.desiredDate.toDate ? reqData.desiredDate.toDate().toISOString().slice(0,10) : new Date(reqData.desiredDate).toISOString().slice(0,10)) : '';
      const oldUrgency = !!(reqData.urgency);

      if (newTitle !== oldTitle) changes.title = { from: oldTitle, to: newTitle };
      if (newDesc !== oldDesc) changes.description = { from: oldDesc.slice(0,80)+'…', to: newDesc.slice(0,80)+'…' };
      if (newDate !== oldDate) changes.desiredDate = { from: oldDate, to: newDate };
      if (editUrgent !== oldUrgency) changes.urgency = { from: oldUrgency, to: editUrgent };

      if (!Object.keys(changes).length) {
        closeEdit();
        return; // nothing changed
      }

      // Build edit history entry (use Date instead of serverTimestamp — Firestore forbids serverTimestamp inside arrays)
      const editEntry = {
        editedAt: new Date(),
        editedBy: portalUser?.uid || null,
        editedByName: portalUser?.name || portalUser?.email || '',
        changes,
      };

      // Auto-calculate outOfCalendar when date changes
      const types = window._portalTaskTypes || taskTypes || [];
      const editTypeId = reqData.typeId || '';
      const editTypeData = types.find(t => t.id === editTypeId);
      const typeHasSlots = editTypeData?.scheduleSlots?.length > 0;
      let newOutOfCalendar = reqData.outOfCalendar || false;
      if (typeHasSlots && newDate) {
        const nd = new Date(newDate + 'T12:00:00');
        const dow = nd.getDay();
        const dayOfMonth = nd.getDate();
        const iso = newDate;
        const matchesSlot = (editTypeData.scheduleSlots || []).some(s => {
          if (s.active === false) return false;
          if (s.recurrence === 'weekly') return s.weekDay === dow;
          if (s.recurrence === 'monthly_days') return (s.monthDays || []).includes(dayOfMonth);
          if (s.recurrence === 'custom') return (s.customDates || []).includes(iso);
          return false;
        });
        newOutOfCalendar = !matchesSlot;
        if (newOutOfCalendar !== (reqData.outOfCalendar || false)) {
          changes.outOfCalendar = { from: reqData.outOfCalendar || false, to: newOutOfCalendar };
        }
      } else if (!typeHasSlots) {
        newOutOfCalendar = false;
      }

      // Update request
      const updateData = {
        title: newTitle,
        description: newDesc,
        urgency: editUrgent,
        outOfCalendar: newOutOfCalendar,
        updatedAt: serverTimestamp(),
      };
      if (newDate) updateData.desiredDate = new Date(newDate + 'T12:00:00');

      // Append to editHistory array
      const existingHistory = reqData.editHistory || [];
      updateData.editHistory = [...existingHistory, editEntry];

      await updateDoc(doc(db, 'requests', data.id), updateData);

      // If request has a linked task, update it too
      const taskId = reqData.taskId;
      if (taskId) {
        const taskUpdate = { updatedAt: serverTimestamp() };
        if (changes.title) taskUpdate.title = newTitle;
        if (changes.description) taskUpdate.description = newDesc;
        if (changes.desiredDate && newDate) taskUpdate.dueDate = new Date(newDate + 'T12:00:00');
        if (changes.urgency) taskUpdate.priority = editUrgent ? 'urgent' : 'medium';
        if (changes.outOfCalendar) taskUpdate.outOfCalendar = newOutOfCalendar;
        // Flag: mark task as having been edited by requester
        taskUpdate.requesterEditFlag = true;
        taskUpdate.requesterEditAt = serverTimestamp();
        taskUpdate.requesterEditChanges = Object.keys(changes).join(', ');
        try {
          await updateDoc(doc(db, 'tasks', taskId), taskUpdate);
        } catch(e) { console.warn('Task update error:', e.message); }
      }

      closeEdit();
      // Re-render calendar to reflect changes
      renderPortalCalendar(db, taskTypes, null);

      // Show success toast (simple inline)
      const toast = document.createElement('div');
      toast.style.cssText = `
        position:fixed;bottom:24px;right:24px;z-index:10003;padding:12px 20px;
        border-radius:8px;background:#22C55E;color:#fff;font-size:0.875rem;font-weight:600;
        font-family:var(--font-ui);box-shadow:0 4px 20px rgba(0,0,0,0.3);
        animation:slideUp 0.2s ease-out;
      `;
      toast.textContent = '✓ Solicitação atualizada com sucesso';
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 4000);

    } catch(e) {
      alert('Erro ao salvar: ' + e.message);
      saveBtn.disabled = false; saveBtn.textContent = 'Salvar alterações';
    }
  });
}

/* ─── Slot/day click helpers ──────────────────────────────── */
function fillFormFromSlot(dateISO, title, variationId, area) {
  const dateEl = document.getElementById('p-date');
  if (dateEl) { dateEl.value = dateISO; dateEl.dispatchEvent(new Event('change')); }

  // Pre-fill requesting area from slot area if available
  if (area) {
    const areaSel = document.getElementById('p-area');
    if (areaSel) {
      for (const opt of areaSel.options) {
        if (opt.value === area) { areaSel.value = area; break; }
      }
    }
  }

  // ── Pre-fill tipo de demanda from the active calendar type ──
  const typeEl = document.getElementById('p-type');
  if (typeEl && portalCalTypeId) {
    typeEl.value = portalCalTypeId;
    // Don't dispatch change (would re-render calendar), just set value
  }

  // ── Pre-fill setor from active type's sector ──
  const types = window._portalTaskTypes || [];
  const activeType = types.find(t => t.id === portalCalTypeId);
  if (activeType?.sector) {
    const setorEl = document.getElementById('p-setor');
    if (setorEl && setorEl.value !== activeType.sector) {
      setorEl.value = activeType.sector;
      // Don't full cascade — just set value, type is already set above
    }
  }

  // ── Pre-fill núcleo = "Design" (default for slot-based requests) ──
  const nucleoSel = document.getElementById('p-nucleo');
  if (nucleoSel) {
    // Try to select "Design" or first available option
    const designOpt = Array.from(nucleoSel.options).find(o =>
      o.value.toLowerCase().includes('design') || o.textContent.toLowerCase().includes('design')
    );
    if (designOpt) {
      nucleoSel.value = designOpt.value;
    }
  }

  // ── Pre-fill título with slot name ──
  if (title) {
    const titleEl = document.getElementById('p-title');
    if (titleEl && !titleEl.value) {
      titleEl.value = title;
    }
  }

  // Select variation — try by id first, then match by title/name
  const varSel = document.getElementById('p-variation');
  if (varSel) {
    let matched = false;
    if (variationId) {
      varSel.value = variationId;
      matched = varSel.value === variationId;
    }
    // Fallback: match variation option by slot title
    if (!matched && title) {
      const titleLower = title.trim().toLowerCase();
      for (const opt of varSel.options) {
        if (!opt.value) continue;
        const optName = opt.textContent.split('·')[0].trim().toLowerCase();
        if (optName === titleLower || optName.includes(titleLower) || titleLower.includes(optName)) {
          varSel.value = opt.value;
          matched = true;
          break;
        }
      }
    }
    if (matched) varSel.dispatchEvent(new Event('change'));
  }

  // Unlock toggles
  unlockToggle('out-of-calendar-toggle', 'p-out-of-calendar', false);
  unlockToggle('urgency-toggle', 'p-urgency', false);
  document.getElementById('locked-urgency-banner')?.remove();
  document.getElementById('locked-ooc-banner')?.remove();
  // Check urgency by deadline
  checkUrgencyByDeadline(dateISO);
  // Scroll to title/description area so user can review pre-filled fields
  const scrollTarget = document.getElementById('fg-title');
  scrollTarget?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function fillFormFromEmptyDay(dateISO) {
  const dateEl = document.getElementById('p-date');
  if (dateEl) { dateEl.value = dateISO; dateEl.dispatchEvent(new Event('change')); }
  // Only flag OOC if the current type has calendar slots
  const types = window._portalTaskTypes || [];
  const curType = types.find(t => t.id === portalCalTypeId);
  const hasSlots = curType?.scheduleSlots?.length > 0;
  if (hasSlots) {
    lockToggle('out-of-calendar-toggle', 'p-out-of-calendar', 'out-calendar-dot', true);
    document.getElementById('out-calendar-alert')?.style && (document.getElementById('out-calendar-alert').style.display = 'flex');
    showLockedBanner('locked-ooc-banner', 'out-of-calendar-toggle',
      'Esta data não está no calendário editorial. "Fora do calendário" foi definido automaticamente.');
  }
  // Check urgency by deadline
  checkUrgencyByDeadline(dateISO);
  // Scroll to description
  document.getElementById('p-desc')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function countBusinessDays(startDate, endDate) {
  let count = 0;
  const cur = new Date(startDate);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function checkUrgencyByDeadline(dateISO) {
  if (!dateISO) return;
  const deadline = new Date(dateISO + 'T23:59:59');
  const now = new Date();
  const hoursUntil = (deadline - now) / 3600000;
  // Check SLA from selected variation
  const varEl = document.getElementById('p-variation');
  const varOpt = varEl?.selectedOptions?.[0];
  const slaDays = parseInt(varOpt?.dataset?.sla);
  const bizDays = countBusinessDays(now, deadline);
  let shouldLock = false;
  let reason = '';
  if (hoursUntil <= 24) {
    shouldLock = true;
    reason = 'Prazo inferior a 24h. Urgência definida automaticamente.';
  } else if (!isNaN(slaDays) && bizDays < slaDays) {
    shouldLock = true;
    reason = `Prazo (${bizDays} dia${bizDays!==1?'s':''} útil) inferior ao SLA (${slaDays} dia${slaDays!==1?'s':''}). Urgência definida automaticamente.`;
  }
  if (shouldLock) {
    lockToggle('urgency-toggle', 'p-urgency', 'urgency-dot', true);
    document.getElementById('urgency-alert')?.classList.add('visible');
    showLockedBanner('locked-urgency-banner', 'urgency-toggle', reason);
  } else {
    unlockToggle('urgency-toggle', 'p-urgency', false);
    document.getElementById('locked-urgency-banner')?.remove();
  }
}

function lockToggle(toggleId, cbId, dotId, checked) {
  const cb = document.getElementById(cbId);
  const toggle = document.getElementById(toggleId);
  if (cb) cb.checked = checked;
  if (toggle) { toggle.classList.toggle('active', checked); toggle.classList.add('locked'); }
}

function unlockToggle(toggleId, cbId, checked) {
  const cb = document.getElementById(cbId);
  const toggle = document.getElementById(toggleId);
  if (cb) cb.checked = checked;
  if (toggle) { toggle.classList.toggle('active', checked); toggle.classList.remove('locked'); }
}

function showLockedBanner(id, afterId, message) {
  document.getElementById(id)?.remove();
  const banner = document.createElement('div');
  banner.id = id;
  banner.className = 'alert-banner info visible';
  banner.style.cssText = 'margin-top:8px;';
  banner.innerHTML = '<span style="font-size:1.125rem;flex-shrink:0;">🔒</span><span>' + message + '</span>';
  document.getElementById(afterId)?.after(banner);
}

/* ─── Batch queue functions ──────────────────────────────── */
function collectFormData(taskTypes) {
  const typeId      = document.getElementById('p-type')?.value || '';
  const typeData    = taskTypes.find(t => t.id === typeId);
  const varOpt      = document.querySelector('#p-variation option:checked');
  const hasSlots    = typeData?.scheduleSlots?.length > 0;
  return {
    requestingArea: document.getElementById('p-area')?.value || '',
    sector:         document.getElementById('p-setor')?.value || '',
    typeId:         typeId,
    typeName:       typeData?.name || '',
    typeIcon:       typeData?.icon || '',
    typeColor:      typeData?.color || '#D4A843',
    autoAccept:     typeData?.autoAccept || false,
    variationId:    document.getElementById('p-variation')?.value || null,
    variationName:  varOpt?.value ? varOpt.textContent.split('·')[0].trim() : '',
    nucleo:         document.getElementById('p-nucleo')?.value || '',
    title:          document.getElementById('p-title')?.value?.trim() || '',
    description:    document.getElementById('p-desc')?.value?.trim() || '',
    urgency:        document.getElementById('p-urgency')?.checked || false,
    outOfCalendar:  hasSlots ? (document.getElementById('p-out-of-calendar')?.checked || false) : false,
    desiredDate:    document.getElementById('p-date')?.value || '',
  };
}

function addToBatch(taskTypes) {
  if (!validate()) {
    document.querySelector('.has-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const item = collectFormData(taskTypes);
  if (currentEditIndex >= 0) {
    batchQueue[currentEditIndex] = item;
    currentEditIndex = -1;
    const btn = document.getElementById('portal-add-batch-btn');
    if (btn) btn.textContent = 'Adicionar ao lote +';
  } else {
    batchQueue.push(item);
  }
  resetFormForNextItem();
  renderBatchList(taskTypes);
  // Re-render calendar immediately so batch items show as filled slots
  renderPortalCalendar(window._portalDb, taskTypes, null);
  document.getElementById('batch-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetFormForNextItem() {
  // Clear per-item fields, keep shared (name, email, area, sector, type)
  const fields = ['p-title', 'p-desc', 'p-date', 'p-nucleo', 'p-variation'];
  fields.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  // Reset toggles
  unlockToggle('urgency-toggle', 'p-urgency', false);
  unlockToggle('out-of-calendar-toggle', 'p-out-of-calendar', false);
  document.getElementById('urgency-alert')?.classList.remove('visible');
  document.getElementById('out-calendar-alert')?.style && (document.getElementById('out-calendar-alert').style.display = 'none');
  document.getElementById('calendar-alert')?.classList.remove('visible');
  document.getElementById('sla-badge')?.classList.remove('visible');
  document.getElementById('locked-urgency-banner')?.remove();
  document.getElementById('locked-ooc-banner')?.remove();
  document.querySelectorAll('.slot-day').forEach(s => s.classList.remove('selected'));
}

function renderBatchList(taskTypes) {
  const panel = document.getElementById('batch-panel');
  const list  = document.getElementById('batch-list');
  const count = document.getElementById('batch-count');
  const submitBtn = document.getElementById('batch-submit-btn');
  if (!panel || !list) return;

  if (!batchQueue.length) {
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'block';
  if (count) count.textContent = batchQueue.length;
  if (submitBtn) submitBtn.textContent = 'Enviar ' + batchQueue.length + ' solicitaç' + (batchQueue.length === 1 ? 'ão' : 'ões') + ' →';

  list.innerHTML = batchQueue.map((item, i) => {
    // Date in DD/MM/YYYY format
    const dateStr = item.desiredDate
      ? (() => { const p = item.desiredDate.split('-'); return p[2]+'/'+p[1]+'/'+p[0]; })()
      : 'Sem data';
    return '<div class="batch-item" style="border-left-color:' + (item.typeColor || 'var(--brand-gold)') + ';">' +
      '<div class="batch-item-body">' +
        '<div class="batch-item-title">' + esc(item.title || 'Sem título') + '</div>' +
        '<div style="font-size:0.6875rem;color:var(--text-muted);margin-bottom:4px;">' +
          (item.typeIcon ? item.typeIcon + ' ' : '') + esc(item.typeName || 'Sem tipo') +
          (item.variationName ? ' — ' + esc(item.variationName) : '') + '</div>' +
        // Detail grid
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:4px;font-size:0.625rem;">' +
          '<div style="padding:3px 6px;border-radius:4px;background:var(--bg-surface);border:1px solid var(--border-subtle);">' +
            '<span style="color:var(--text-muted);">📅</span> ' + dateStr +
          '</div>' +
          (item.sector ? '<div style="padding:3px 6px;border-radius:4px;background:var(--bg-surface);border:1px solid var(--border-subtle);">' +
            '<span style="color:var(--text-muted);">📁</span> ' + esc(item.sector) +
          '</div>' : '') +
          (item.requestingArea ? '<div style="padding:3px 6px;border-radius:4px;background:var(--bg-surface);border:1px solid var(--border-subtle);">' +
            '<span style="color:var(--text-muted);">📍</span> ' + esc(item.requestingArea) +
          '</div>' : '') +
          (item.nucleo ? '<div style="padding:3px 6px;border-radius:4px;background:var(--bg-surface);border:1px solid var(--border-subtle);">' +
            '<span style="color:var(--text-muted);">🎨</span> ' + esc(item.nucleo) +
          '</div>' : '') +
        '</div>' +
        // Badges
        '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:4px;">' +
          (item.urgency ? '<span style="font-size:0.5625rem;background:#EF444420;color:#EF4444;padding:1px 6px;border-radius:8px;font-weight:600;">🔴 URGENTE</span>' : '') +
          (item.outOfCalendar ? '<span style="font-size:0.5625rem;background:#F59E0B20;color:#F59E0B;padding:1px 6px;border-radius:8px;font-weight:600;">⚠ FORA DO CAL.</span>' : '') +
          (item.autoAccept ? '<span style="font-size:0.5625rem;background:#22C55E20;color:#22C55E;padding:1px 6px;border-radius:8px;font-weight:600;">✓ AUTO-ACEITE</span>' : '') +
        '</div>' +
        // Description
        '<div style="font-size:0.6875rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;' +
          'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.4;">' +
          esc((item.description || '').slice(0, 120)) + ((item.description || '').length > 120 ? '…' : '') +
        '</div>' +
      '</div>' +
      '<div class="batch-item-actions">' +
        '<button class="batch-item-btn" data-batch-edit="' + i + '" title="Editar">✎</button>' +
        '<button class="batch-item-btn danger" data-batch-remove="' + i + '" title="Remover">✕</button>' +
      '</div>' +
    '</div>';
  }).join('');

  // Bind edit/remove
  list.querySelectorAll('[data-batch-edit]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.batchEdit);
      editBatchItem(idx, taskTypes);
    });
  });
  list.querySelectorAll('[data-batch-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.batchRemove);
      batchQueue.splice(idx, 1);
      if (currentEditIndex === idx) { currentEditIndex = -1; document.getElementById('portal-add-batch-btn').textContent = 'Adicionar ao lote +'; }
      else if (currentEditIndex > idx) currentEditIndex--;
      renderBatchList(taskTypes);
    });
  });
}

async function editBatchItem(idx, taskTypes) {
  const item = batchQueue[idx];
  if (!item) return;
  currentEditIndex = idx;

  // 1. Set area (no cascade needed)
  const areaEl = document.getElementById('p-area');
  if (areaEl) areaEl.value = item.requestingArea || '';

  // 2. Set sector and trigger cascade (loads types + nucleos)
  const setorEl = document.getElementById('p-setor');
  if (setorEl && item.sector) {
    setorEl.value = item.sector;
    await new Promise(resolve => {
      setorEl.dispatchEvent(new Event('change'));
      // Wait for async cascade (loadNucleosBySector) to complete
      setTimeout(resolve, 300);
    });
  }

  // 3. Set type and trigger cascade (loads variations + calendar)
  const typeEl = document.getElementById('p-type');
  if (typeEl && item.typeId) {
    typeEl.value = item.typeId;
    await new Promise(resolve => {
      typeEl.dispatchEvent(new Event('change'));
      setTimeout(resolve, 300);
    });
  }

  // 4. Set variation (after type cascade populated the options)
  const varEl = document.getElementById('p-variation');
  if (varEl && item.variationId) {
    varEl.value = item.variationId;
    varEl.dispatchEvent(new Event('change'));
  }

  // 5. Set nucleo (after sector cascade populated the options)
  const nucleoEl = document.getElementById('p-nucleo');
  if (nucleoEl && item.nucleo) nucleoEl.value = item.nucleo;

  // 6. Set title, description and date
  const titleEl = document.getElementById('p-title');
  if (titleEl) titleEl.value = item.title || '';
  const descEl = document.getElementById('p-desc');
  if (descEl) descEl.value = item.description || '';
  const dateEl = document.getElementById('p-date');
  if (dateEl && item.desiredDate) {
    dateEl.value = item.desiredDate;
    dateEl.dispatchEvent(new Event('change'));
  }

  // 7. Set toggles
  if (item.urgency) {
    lockToggle('urgency-toggle', 'p-urgency', 'urgency-dot', true);
  } else {
    unlockToggle('urgency-toggle', 'p-urgency', false);
  }
  if (item.outOfCalendar) {
    lockToggle('out-of-calendar-toggle', 'p-out-of-calendar', 'out-calendar-dot', true);
  } else {
    unlockToggle('out-of-calendar-toggle', 'p-out-of-calendar', false);
  }

  // Update button
  const btn = document.getElementById('portal-add-batch-btn');
  if (btn) btn.textContent = 'Atualizar item ✓';
  // Scroll to form
  document.getElementById('fg-desc')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function handleBatchSubmit(db, taskTypes) {
  if (!batchQueue.length) { alert('Nenhuma solicitação no lote.'); return; }
  // Name/email come from authenticated profile
  const name  = portalUser?.name || document.getElementById('p-name')?.value?.trim() || '';
  const email = portalUser?.email || document.getElementById('p-email')?.value?.trim() || '';
  if (!name || !email) { alert('Erro: nome ou e-mail não identificados. Faça login novamente.'); return; }

  const btn = document.getElementById('batch-submit-btn');
  if (btn) { btn.disabled = true; btn.classList.add('loading'); btn.textContent = 'Enviando...'; }

  try {
    const batchId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
    const total   = batchQueue.length;

    for (let i = 0; i < batchQueue.length; i++) {
      const item = batchQueue[i];
      const reqDoc = {
        userId:         portalUser?.uid || null,
        requesterName:  name,
        requesterEmail: email.toLowerCase(),
        userArea:       portalUser?.department || '',
        requestingArea: item.requestingArea || '',
        sector:         item.sector || '',
        typeId:         item.typeId || null,
        typeName:       item.typeName || '',
        variationId:    item.variationId || null,
        variationName:  item.variationName || '',
        nucleo:         item.nucleo || '',
        title:          item.title || '',
        description:    item.description || '',
        urgency:        item.urgency === true,
        outOfCalendar:  item.outOfCalendar === true,
        desiredDate:    item.desiredDate ? new Date(item.desiredDate + 'T12:00:00') : null,
        status:         item.autoAccept ? 'converted' : 'pending',
        taskId:         null,
        workspaceId:    null,
        internalNote:   '',
        rejectionNote:  '',
        batchId:        batchId,
        batchIndex:     i,
        batchTotal:     total,
        createdAt:      serverTimestamp(),
        updatedAt:      serverTimestamp(),
      };
      const reqRef = await addDoc(collection(db, 'requests'), reqDoc);

      // Auto-create task if type has autoAccept
      if (item.autoAccept) {
        const typeData = taskTypes.find(t => t.id === item.typeId);
        if (typeData) await autoCreateTask(db, reqRef, reqDoc, typeData);
      }
    }

    // Send ONE consolidated email
    await notifyTeam({
      requesterName: name, requesterEmail: email,
      requestingArea: batchQueue[0]?.requestingArea || '',
      sector: batchQueue[0]?.sector || '',
      typeName: batchQueue.map(i => i.typeName).filter(Boolean).join(', '),
      description: total + ' solicitaç' + (total === 1 ? 'ão' : 'ões') + ' em lote',
      urgency: batchQueue.some(i => i.urgency),
      outOfCalendar: batchQueue.some(i => i.outOfCalendar),
    }).catch(() => {});

    // Show success
    batchQueue = [];
    currentEditIndex = -1;
    document.getElementById('form-view').style.display = 'none';
    const successView = document.getElementById('success-view');
    successView?.classList.add('visible');
    const msg = document.getElementById('success-msg');
    if (msg) msg.textContent = 'Enviamos ' + total + ' solicitaç' + (total === 1 ? 'ão' : 'ões') +
      '. Nossa equipe irá analisar cada uma e entrará em contato com ' + email + ' em breve.';
  } catch(e) {
    alert('Erro ao enviar solicitações: ' + e.message);
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); btn.textContent = 'Enviar todas as solicitações →'; }
  }
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
    // Only show type field if there are types for this sector
    if (typeFG) typeFG.style.display = sectorTypes.length > 0 ? 'block' : 'none';

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

    // Show/hide out-of-calendar toggle based on whether type has schedule slots
    const oocFG = document.getElementById('fg-out-of-calendar');
    const typeHasSlots = typeData.scheduleSlots?.length > 0;
    if (oocFG) {
      oocFG.style.display = typeHasSlots ? 'block' : 'none';
      if (!typeHasSlots) {
        // Uncheck and unlock if type has no slots
        unlockToggle('out-of-calendar-toggle', 'p-out-of-calendar', false);
        document.getElementById('locked-ooc-banner')?.remove();
        document.getElementById('out-calendar-alert')?.style && (document.getElementById('out-calendar-alert').style.display = 'none');
      }
    }

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
    // Re-check urgency with new SLA
    const dateVal = document.getElementById('p-date')?.value;
    if (dateVal) checkUrgencyByDeadline(dateVal);
  });

  // (urgency, out-of-calendar, and date handlers are defined above with lock support)

  // Date change → check urgency + out-of-calendar
  const dateInput = document.getElementById('p-date');
  dateInput?.addEventListener('change', (e) => {
    const val = e.target.value;
    if (!val) return;
    // Check out-of-calendar via slots
    const dbRef = window._portalDb;
    const types = window._portalTaskTypes || taskTypes;
    const typeId = document.getElementById('p-type')?.value;
    const typeData = types.find(t => t.id === typeId);
    const hasSlots = typeData?.scheduleSlots?.length > 0;
    if (hasSlots) {
      const date = new Date(val + 'T12:00:00');
      const dow = date.getDay();
      const d = date.getDate(), m = date.getMonth(), y = date.getFullYear();
      const iso = val;
      const slots = (typeData.scheduleSlots || []).filter(s => {
        if (s.active === false) return false;
        if (s.recurrence === 'weekly') return s.weekDay === dow;
        if (s.recurrence === 'monthly_days') return (s.monthDays || []).includes(d);
        if (s.recurrence === 'custom') return (s.customDates || []).includes(iso);
        return false;
      });
      if (slots.length === 0) {
        lockToggle('out-of-calendar-toggle', 'p-out-of-calendar', 'out-calendar-dot', true);
        document.getElementById('out-calendar-alert')?.style && (document.getElementById('out-calendar-alert').style.display = 'flex');
        showLockedBanner('locked-ooc-banner', 'out-of-calendar-toggle',
          'Esta data não está no calendário editorial. "Fora do calendário" foi definido automaticamente.');
      } else {
        unlockToggle('out-of-calendar-toggle', 'p-out-of-calendar', false);
        document.getElementById('locked-ooc-banner')?.remove();
        document.getElementById('out-calendar-alert')?.style && (document.getElementById('out-calendar-alert').style.display = 'none');
      }
    } else {
      // Type has no calendar slots — OOC not applicable, hide toggle and unlock
      unlockToggle('out-of-calendar-toggle', 'p-out-of-calendar', false);
      document.getElementById('locked-ooc-banner')?.remove();
      document.getElementById('out-calendar-alert')?.style && (document.getElementById('out-calendar-alert').style.display = 'none');
    }
    checkUrgencyByDeadline(val);
  });

  // Urgency toggle — only allow if not locked
  document.getElementById('urgency-toggle')?.addEventListener('click', () => {
    const toggle = document.getElementById('urgency-toggle');
    if (toggle?.classList.contains('locked')) return;
    const cb = document.getElementById('p-urgency');
    const alert = document.getElementById('urgency-alert');
    if (!cb) return;
    cb.checked = !cb.checked;
    toggle?.classList.toggle('active', cb.checked);
    if (alert) alert.classList.toggle('visible', cb.checked);
  });

  // Out-of-calendar toggle — only allow if not locked
  document.getElementById('out-of-calendar-toggle')?.addEventListener('click', () => {
    const toggle = document.getElementById('out-of-calendar-toggle');
    if (toggle?.classList.contains('locked')) return;
    const cb = document.getElementById('p-out-of-calendar');
    const alert = document.getElementById('out-calendar-alert');
    if (!cb) return;
    cb.checked = !cb.checked;
    toggle?.classList.toggle('active', cb.checked);
    if (alert) alert.style.display = cb.checked ? 'flex' : 'none';
  });

  // Batch: add to batch
  document.getElementById('portal-add-batch-btn')?.addEventListener('click', () => addToBatch(taskTypes));
  // Batch: submit all
  document.getElementById('batch-submit-btn')?.addEventListener('click', () => handleBatchSubmit(db, taskTypes));

  // Single submit
  document.getElementById('portal-submit-btn')?.addEventListener('click', () => handleSubmit(db, taskTypes));
  document.getElementById('new-request-btn')?.addEventListener('click', () => {
    document.getElementById('success-view')?.classList.remove('visible');
    document.getElementById('form-view').style.display = 'block';
    // Reset submit button state
    const submitBtn = document.getElementById('portal-submit-btn');
    if (submitBtn) { submitBtn.disabled = false; submitBtn.classList.remove('loading'); submitBtn.textContent = 'Enviar apenas esta solicitação →'; }
    // Reset form — preserve readonly fields (name, email, user-area)
    const preserve = new Set(['p-name', 'p-email', 'p-user-area']);
    document.querySelectorAll('.form-input,.form-select,.form-textarea').forEach(el => {
      if (!preserve.has(el.id)) el.value = '';
    });
    // Re-fill user data from portalUser (in case values were lost)
    const u = portalUser || {};
    const nameEl = document.getElementById('p-name');
    const emailEl = document.getElementById('p-email');
    const userAreaEl = document.getElementById('p-user-area');
    if (nameEl)     nameEl.value = u.name || '';
    if (emailEl)    emailEl.value = u.email || '';
    if (userAreaEl) userAreaEl.value = u.department || '';
    // Re-select user's area as default in requesting area dropdown
    const areaSel = document.getElementById('p-area');
    if (areaSel && u.department) {
      for (const opt of areaSel.options) { if (opt.value === u.department) { areaSel.value = u.department; break; } }
    }
    document.getElementById('p-urgency').checked = false;
    document.getElementById('p-out-of-calendar').checked = false;
    unlockToggle('urgency-toggle', 'p-urgency', false);
    unlockToggle('out-of-calendar-toggle', 'p-out-of-calendar', false);
    document.getElementById('urgency-alert')?.classList.remove('visible');
    document.getElementById('out-calendar-alert')?.style && (document.getElementById('out-calendar-alert').style.display = 'none');
    document.getElementById('sla-badge')?.classList.remove('visible');
    document.getElementById('slots-container')?.classList.remove('visible');
    document.getElementById('locked-urgency-banner')?.remove();
    document.getElementById('locked-ooc-banner')?.remove();
    document.getElementById('batch-panel')?.style && (document.getElementById('batch-panel').style.display = 'none');
    // Remove calendar widget and hide downstream fields
    document.getElementById('portal-calendar-widget')?.remove();
    document.getElementById('fg-type')?.style && (document.getElementById('fg-type').style.display = 'none');
    document.getElementById('fg-variation')?.style && (document.getElementById('fg-variation').style.display = 'none');
    document.getElementById('fg-nucleo')?.style && (document.getElementById('fg-nucleo').style.display = 'none');
    batchQueue = [];
    currentEditIndex = -1;
    // Re-show newsletter prompt on every form access
    showNewsletterPrompt(db, taskTypes);
  });
}

/* ─── Validation ──────────────────────────────────────────── */
function validate() {
  let ok = true;
  const rules = [
    // name/email are auto-filled from authenticated profile (readonly)
    { id: 'p-area',   errId: 'err-area',   fgId: 'fg-area',   check: v => v !== '' },
    { id: 'p-setor',  errId: 'err-setor',  fgId: 'fg-setor',  check: v => v !== '' },
    // type only required if visible
    ...(document.getElementById('fg-type')?.style.display !== 'none'
      ? [{ id: 'p-type', errId: 'err-type', fgId: 'fg-type', check: v => v !== '' }]
      : []),
    { id: 'p-title',  errId: 'err-title',  fgId: 'fg-title',  check: v => v.trim().length >= 3 },
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
    const typeHasSlots = typeData?.scheduleSlots?.length > 0;
    const outOfCal    = typeHasSlots ? (document.getElementById('p-out-of-calendar')?.checked || false) : false;
    const variationId = document.getElementById('p-variation')?.value || null;
    const varOpt      = document.querySelector('#p-variation option:checked');
    const variationName = varOpt?.textContent?.split('·')[0]?.trim() || '';
    const sector      = document.getElementById('p-setor')?.value || '';

    // Build request document matching createRequest service schema exactly
    const reqDoc = {
      userId:         portalUser?.uid || null,
      requesterName:  document.getElementById('p-name')?.value?.trim()             || '',
      requesterEmail: document.getElementById('p-email')?.value?.trim().toLowerCase() || '',
      userArea:       portalUser?.department || '',
      requestingArea: document.getElementById('p-area')?.value                     || '',
      sector:         sector                                                        || '',
      outOfCalendar:  outOfCal === true,
      variationId:    variationId    || null,
      variationName:  variationName  || '',
      typeId:         typeId         || null,
      typeName:       typeData?.name || '',
      nucleo:         document.getElementById('p-nucleo')?.value                   || '',
      title:          document.getElementById('p-title')?.value?.trim()            || '',
      description:    document.getElementById('p-desc')?.value?.trim()             || '',
      urgency:        urgency === true,
      desiredDate:    document.getElementById('p-date')?.value
        ? new Date(document.getElementById('p-date').value + 'T12:00:00')
        : null,
      status:         typeData?.autoAccept ? 'converted' : 'pending',
      taskId:         null,
      workspaceId:    null,
      internalNote:   '',
      rejectionNote:  '',
      createdAt:      serverTimestamp(),
      updatedAt:      serverTimestamp(),
    };

    const ref = await addDoc(collection(db, 'requests'), reqDoc);

    // Auto-create task if type has autoAccept
    if (typeData?.autoAccept) {
      await autoCreateTask(db, ref, reqDoc, typeData);
    }

    // Notify team via EmailJS
    await notifyTeam({ ...reqDoc, requestId: ref.id }).catch(() => {});

    // Show success
    document.getElementById('form-view').style.display = 'none';
    const successView = document.getElementById('success-view');
    successView?.classList.add('visible');
    const msg = document.getElementById('success-msg');
    if (msg) {
      msg.textContent = typeData?.autoAccept
        ? `Sua solicitação foi aceita automaticamente e já está na esteira de produção. Acompanhe pelo sistema.`
        : urgency
          ? `Recebemos sua solicitação urgente. Nossa equipe será notificada imediatamente e entrará em contato com ${reqDoc.requesterEmail}.`
          : `Recebemos sua solicitação. Nossa equipe analisará e entrará em contato com ${reqDoc.requesterEmail} em breve.`;
    }
  } catch(e) {
    alert('Erro ao enviar solicitação: ' + e.message);
    if (btn) { btn.disabled = false; btn.classList.remove('loading'); btn.textContent = 'Enviar apenas esta solicitação →'; }
  }
}

/* ─── Auto-create task for autoAccept types ─────────────── */
async function autoCreateTask(db, reqRef, reqDoc, typeData) {
  try {
    const variation = typeData.variations?.find(v => v.id === reqDoc.variationId);
    const slaDays = variation?.slaDays ?? 2;
    // Calculate due date from SLA
    let dueDate = reqDoc.desiredDate || new Date();
    if (!reqDoc.desiredDate) {
      const d = new Date();
      let biz = slaDays;
      while (biz > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) biz--; }
      dueDate = d;
    }

    const taskDoc = {
      workspaceId:      null,
      sector:           reqDoc.sector || null,
      title:            reqDoc.title || reqDoc.typeName || 'Nova Tarefa',
      description:      reqDoc.description || '',
      status:           'not_started',
      priority:         reqDoc.urgency ? 'urgent' : 'medium',
      projectId:        null,
      assignees:        [],
      tags:             [],
      startDate:        serverTimestamp(),
      dueDate:          dueDate,
      typeId:           reqDoc.typeId || null,
      variationId:      reqDoc.variationId || null,
      variationName:    reqDoc.variationName || '',
      variationSLADays: slaDays,
      customFields:     {},
      type:             reqDoc.typeName?.toLowerCase() || '',
      requestingArea:   reqDoc.requestingArea || '',
      nucleos:          reqDoc.nucleo ? [reqDoc.nucleo] : [],
      outOfCalendar:    reqDoc.outOfCalendar || false,
      subtasks:         [],
      comments:         [],
      attachments:      [],
      order:            Date.now(),
      completedAt:      null,
      createdAt:        serverTimestamp(),
      createdBy:        portalUser?.uid || 'portal',
      updatedAt:        serverTimestamp(),
      updatedBy:        portalUser?.uid || 'portal',
      sourceRequestId:  reqRef.id,
    };

    const taskRef = await addDoc(collection(db, 'tasks'), taskDoc);

    // Update request with taskId and converted status
    await updateDoc(doc(db, 'requests', reqRef.id), {
      status: 'converted',
      taskId: taskRef.id,
      updatedAt: serverTimestamp(),
    });

    return taskRef;
  } catch(e) {
    console.warn('autoCreateTask error:', e.message);
    return null;
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
  return new Date().toISOString().slice(0,10);
}

function showError(msg) {
  const root = document.getElementById('portal-root');
  if (root) root.innerHTML = `<div style="color:#EF4444;padding:40px;text-align:center;">${msg}</div>`;
}

// Boot
boot().catch(e => showError('Erro ao inicializar: ' + e.message));
