/**
 * PRIMETOUR — Login Page
 * Tela de autenticação
 */

import { signIn, signInWithMicrosoft, linkMicrosoftToExistingAccount, resetPassword, getErrorMessage } from '../auth/auth.js';
import { toast } from '../components/toast.js';
import { auditLog } from '../auth/audit.js';

export function renderLogin(container) {
  container.innerHTML = `
    <div class="auth-screen">
      <!-- Painel Visual (Esquerda) -->
      <div class="auth-visual">
        <div class="auth-visual-grid"></div>
        
        <div class="auth-brand">
          <div class="auth-brand-logo">
            <img src="assets/mandala-branca.png" alt="PRIMETOUR"
            style="width:36px;height:36px;border-radius:var(--radius-sm);object-fit:contain;" />
            <span class="auth-brand-name">PRIMETOUR</span>
          </div>
          <p class="auth-brand-tagline">Plataforma de Gestão de Tarefas</p>
        </div>

        <div class="auth-visual-content">
          <h2 class="auth-visual-title">
            Organize sua equipe.<br>
            <span>Entregue com excelência.</span>
          </h2>
          <p class="auth-visual-desc">
            Plataforma completa para gestão de projetos e tarefas
            da equipe PRIMETOUR. Dashboards, CSAT, kanban e muito mais.
          </p>
          <div class="auth-features">
            <div class="auth-feature">
              <div class="auth-feature-dot"></div>
              <span>Gestão completa de tarefas e projetos</span>
            </div>
            <div class="auth-feature">
              <div class="auth-feature-dot"></div>
              <span>Dashboards em tempo real</span>
            </div>
            <div class="auth-feature">
              <div class="auth-feature-dot"></div>
              <span>Avaliação CSAT nativa por e-mail</span>
            </div>
            <div class="auth-feature">
              <div class="auth-feature-dot"></div>
              <span>Auditoria e rastreabilidade completa</span>
            </div>
            <div class="auth-feature">
              <div class="auth-feature-dot"></div>
              <span>Integrações com Figma, Salesforce e Planner</span>
            </div>
          </div>
        </div>

        <div style="margin-top:24px;">
          <a href="solicitar.html"
            style="display:inline-flex;align-items:center;gap:8px;padding:10px 20px;
            border-radius:var(--radius-md);border:1px solid rgba(212,168,67,0.4);
            color:var(--brand-gold);font-size:0.875rem;font-weight:500;text-decoration:none;
            background:rgba(212,168,67,0.08);transition:all 0.15s;"
            onmouseover="this.style.background='rgba(212,168,67,0.15)'"
            onmouseout="this.style.background='rgba(212,168,67,0.08)'">
            ✦ Faça seu pedido aqui →
          </a>
        </div>

        <div class="auth-visual-footer">
          © ${new Date().getFullYear()} PRIMETOUR · Todos os direitos reservados
        </div>
      </div>

      <!-- Painel de Formulário (Direita) -->
      <div class="auth-form-panel">
        <div class="auth-form-container">
          <div class="auth-form-header">
            <h1 class="auth-form-title">Bem-vindo de volta</h1>
            <p class="auth-form-subtitle">Entre com suas credenciais para continuar</p>
          </div>

          <!-- Alert de erro/sucesso -->
          <div id="auth-alert" style="display:none;"></div>

          <!-- Formulário de Login -->
          <form id="login-form" novalidate>
            <div class="form-group">
              <label class="form-label" for="login-email">E-mail</label>
              <div class="form-input-wrapper">
                <span class="form-input-icon">✉</span>
                <input
                  type="email"
                  id="login-email"
                  class="form-input has-icon"
                  placeholder="seu@email.com"
                  autocomplete="email"
                  required
                />
              </div>
              <span class="form-error-msg" id="email-error"></span>
            </div>

            <div class="form-group">
              <div class="flex justify-between items-center" style="margin-bottom:8px;">
                <label class="form-label" for="login-password" style="margin-bottom:0;">Senha</label>
                <a href="#" class="auth-forgot-link" id="forgot-link">Esqueceu a senha?</a>
              </div>
              <div class="form-input-wrapper">
                <span class="form-input-icon">🔒</span>
                <input
                  type="password"
                  id="login-password"
                  class="form-input has-icon has-icon-right"
                  placeholder="••••••••"
                  autocomplete="current-password"
                  required
                />
                <button type="button" class="form-input-icon-right" id="toggle-password">👁</button>
              </div>
              <span class="form-error-msg" id="password-error"></span>
            </div>

            <button type="submit" class="btn-auth-submit" id="login-submit">
              Entrar na plataforma
            </button>
          </form>

          <!-- Divider -->
          <div class="auth-divider"><span>ou</span></div>

          <!-- SSO Microsoft -->
          <button type="button" class="btn-auth-microsoft" id="btn-microsoft-sso">
            <svg width="20" height="20" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="1" width="9" height="9" fill="#F25022"/>
              <rect x="11" y="1" width="9" height="9" fill="#7FBA00"/>
              <rect x="1" y="11" width="9" height="9" fill="#00A4EF"/>
              <rect x="11" y="11" width="9" height="9" fill="#FFB900"/>
            </svg>
            Entrar com Microsoft
            <span class="btn-auth-microsoft-domain">@primetour.com.br</span>
          </button>

          <p class="text-center mt-6 text-xs" style="color:var(--text-muted);">
            Não possui acesso? Solicite ao administrador do sistema.
          </p>
        </div>
      </div>
    </div>
  `;

  // ─── Event Listeners ──────────────────────────────────────
  const form         = document.getElementById('login-form');
  const emailInput   = document.getElementById('login-email');
  const passwordInput = document.getElementById('login-password');
  const submitBtn    = document.getElementById('login-submit');
  const alertEl      = document.getElementById('auth-alert');
  const togglePwBtn  = document.getElementById('toggle-password');
  const forgotLink   = document.getElementById('forgot-link');
  const microsoftBtn = document.getElementById('btn-microsoft-sso');

  // Toggle password visibility
  togglePwBtn.addEventListener('click', () => {
    const isText = passwordInput.type === 'text';
    passwordInput.type = isText ? 'password' : 'text';
    togglePwBtn.textContent = isText ? '👁' : '🙈';
  });

  // ─── SSO Microsoft ──────────────────────────────────────
  microsoftBtn.addEventListener('click', async () => {
    microsoftBtn.classList.add('loading');
    microsoftBtn.disabled = true;
    clearAlert();

    try {
      await signInWithMicrosoft();
      // Auth observer cuidará do redirecionamento + auto-provisioning
    } catch (err) {
      // Ignorar cancelamento silencioso
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        // Silencioso — usuário fechou a janela

      // Conta já existe com email/senha → mostrar tela de vinculação
      } else if (err.code === 'auth/account-exists-with-different-credential' && err.pendingCredential) {
        showLinkAccountUI(err.email, err.pendingCredential);

      } else {
        const msg = getErrorMessage(err.code) || err.message || 'Erro ao autenticar via Microsoft.';
        showAlert('error', msg);

        auditLog('auth.sso_failed', 'session', null, {
          provider: 'microsoft.com',
          errorCode: err.code || 'unknown',
          errorMsg:  err.message || '',
        }).catch(() => {});
      }
    } finally {
      microsoftBtn.classList.remove('loading');
      microsoftBtn.disabled = false;
    }
  });

  // Clear errors on input
  emailInput.addEventListener('input', () => clearError('email'));
  passwordInput.addEventListener('input', () => clearError('password'));

  // Forgot password
  forgotLink.addEventListener('click', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) {
      showAlert('info', 'Digite seu e-mail acima e clique em "Esqueceu a senha?" novamente.');
      return;
    }

    const btn = forgotLink;
    btn.style.opacity = '0.5';
    btn.style.pointerEvents = 'none';

    try {
      await resetPassword(email);
      showAlert('success', `E-mail de redefinição enviado para <strong>${email}</strong>. Verifique sua caixa de entrada.`);
    } catch (err) {
      showAlert('error', getErrorMessage(err.code));
    } finally {
      btn.style.opacity = '';
      btn.style.pointerEvents = '';
    }
  });

  // Submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearAlert();

    const email    = emailInput.value.trim();
    const password = passwordInput.value;
    let valid = true;

    if (!email) {
      showError('email', 'E-mail é obrigatório.');
      valid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('email', 'E-mail inválido.');
      valid = false;
    }

    if (!password) {
      showError('password', 'Senha é obrigatória.');
      valid = false;
    }

    if (!valid) return;

    // Loading state
    submitBtn.classList.add('loading');
    emailInput.disabled = true;
    passwordInput.disabled = true;

    try {
      await signIn(email, password);
      // Auth observer cuidará do redirecionamento
    } catch (err) {
      clearAlert();
      showAlert('error', getErrorMessage(err.code));
      
      // Log tentativa falha (sem dados sensíveis)
      await auditLog('auth.login_failed', 'session', null, {
        email: email.toLowerCase(),
        errorCode: err.code
      }).catch(() => {});
    } finally {
      submitBtn.classList.remove('loading');
      emailInput.disabled = false;
      passwordInput.disabled = false;
    }
  });

  // Focus no email
  setTimeout(() => emailInput.focus(), 300);

  // ─── Vincular conta Microsoft a email/senha existente ────
  function showLinkAccountUI(email, pendingCredential) {
    const formContainer = document.querySelector('.auth-form-container');
    if (!formContainer) return;

    // Substituir conteúdo por formulário de vinculação
    formContainer.innerHTML = `
      <div class="auth-form-header">
        <h1 class="auth-form-title">Vincular conta Microsoft</h1>
        <p class="auth-form-subtitle">
          O e-mail <strong>${email}</strong> já possui uma conta com senha.
          Digite sua senha para vincular o login Microsoft.
        </p>
      </div>

      <div id="link-alert" style="display:none;"></div>

      <form id="link-form" novalidate>
        <div class="form-group">
          <label class="form-label" for="link-email">E-mail</label>
          <div class="form-input-wrapper">
            <span class="form-input-icon">✉</span>
            <input type="email" id="link-email" class="form-input has-icon"
              value="${email}" disabled
              style="opacity:0.7;" />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="link-password">Senha atual</label>
          <div class="form-input-wrapper">
            <span class="form-input-icon">🔒</span>
            <input type="password" id="link-password" class="form-input has-icon"
              placeholder="Digite sua senha atual" autocomplete="current-password" required />
          </div>
          <span class="form-error-msg" id="link-password-error"></span>
        </div>

        <button type="submit" class="btn-auth-submit" id="link-submit">
          🔗 Vincular e entrar
        </button>
      </form>

      <button type="button" id="link-cancel" class="btn-auth-microsoft" style="margin-top:12px;">
        ← Voltar ao login
      </button>

      <p class="text-center mt-6 text-xs" style="color:var(--text-muted);">
        Após vincular, você poderá entrar via Microsoft nas próximas vezes sem precisar de senha.
      </p>
    `;

    const linkForm     = document.getElementById('link-form');
    const linkPwInput  = document.getElementById('link-password');
    const linkSubmit   = document.getElementById('link-submit');
    const linkAlert    = document.getElementById('link-alert');
    const linkCancel   = document.getElementById('link-cancel');

    // Voltar ao login normal
    linkCancel.addEventListener('click', () => renderLogin(container));

    // Focus na senha
    setTimeout(() => linkPwInput.focus(), 200);

    // Submit — vincular
    linkForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = linkPwInput.value;

      if (!password) {
        const errEl = document.getElementById('link-password-error');
        if (errEl) errEl.textContent = 'Senha é obrigatória.';
        return;
      }

      linkSubmit.classList.add('loading');
      linkPwInput.disabled = true;

      try {
        await linkMicrosoftToExistingAccount(email, password, pendingCredential);
        // onAuthStateChanged cuida do resto
        toast.success('Conta Microsoft vinculada com sucesso! Nas próximas vezes, basta usar o botão Microsoft.');
      } catch (err) {
        linkAlert.style.display = 'flex';
        linkAlert.className = 'auth-alert error';
        const msg = err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential'
          ? 'Senha incorreta. Tente novamente.'
          : getErrorMessage(err.code) || err.message;
        linkAlert.innerHTML = `<span>✕</span><span>${msg}</span>`;
      } finally {
        linkSubmit.classList.remove('loading');
        linkPwInput.disabled = false;
      }
    });
  }

  // ─── Helpers ──────────────────────────────────────────────
  function showAlert(type, message) {
    alertEl.style.display = 'flex';
    alertEl.className = `auth-alert ${type}`;
    const icons = { error: '✕', success: '✓', info: 'ℹ', warning: '⚠' };
    alertEl.innerHTML = `<span>${icons[type] || 'ℹ'}</span><span>${message}</span>`;
  }

  function clearAlert() {
    alertEl.style.display = 'none';
    alertEl.innerHTML = '';
  }

  function showError(field, message) {
    const input = document.getElementById(`login-${field}`);
    const error = document.getElementById(`${field}-error`);
    if (input) input.classList.add('error');
    if (error) error.textContent = message;
  }

  function clearError(field) {
    const input = document.getElementById(`login-${field}`);
    const error = document.getElementById(`${field}-error`);
    if (input) input.classList.remove('error');
    if (error) error.textContent = '';
  }
}
