/**
 * PRIMETOUR — Login Page
 * Tela de autenticação
 */

import { signIn, resetPassword, getErrorMessage } from '../auth/auth.js';
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
            <div class="auth-brand-icon">✦</div>
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

  // Toggle password visibility
  togglePwBtn.addEventListener('click', () => {
    const isText = passwordInput.type === 'text';
    passwordInput.type = isText ? 'password' : 'text';
    togglePwBtn.textContent = isText ? '👁' : '🙈';
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
