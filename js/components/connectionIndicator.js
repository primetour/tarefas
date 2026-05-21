/**
 * Connection Indicator (v4.49.61+)
 *
 * Chip discreto no canto superior direito do header mostrando status:
 *   🟢 online        → chip oculto (não polui UI quando tudo OK)
 *   🟡 reconectando  → chip amarelo, dica "Reconectando — algumas ações podem demorar"
 *   🔴 offline       → chip vermelho, dica "Sem conexão — alterações ficam pendentes"
 *
 * Click no chip abre painel de debug (últimos erros agregados — admin only).
 */
import { getStatus, onChange, getRecentErrors } from '../services/connection.js';
import { store } from '../store.js';

const ID = 'pt-conn-indicator';

function _ensureStyles() {
  if (document.getElementById(ID + '-styles')) return;
  const s = document.createElement('style');
  s.id = ID + '-styles';
  s.textContent = `
    #${ID} {
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 10100;
      display: none;
      align-items: center;
      gap: 6px;
      padding: 5px 10px 5px 9px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 600;
      font-family: var(--font-ui, system-ui);
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      user-select: none;
      transition: opacity 0.2s, transform 0.2s;
    }
    #${ID}.visible { display: inline-flex; }
    #${ID}.state-reconnecting {
      background: #FEF3C7;
      color: #92400E;
      border: 1px solid #F59E0B;
      animation: pt-conn-pulse 1.5s ease-in-out infinite;
    }
    #${ID}.state-offline {
      background: #FEE2E2;
      color: #991B1B;
      border: 1px solid #DC2626;
    }
    #${ID}:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
    #${ID} .dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: currentColor;
      display: inline-block;
    }
    #${ID}.state-reconnecting .dot { animation: pt-conn-blink 1s ease-in-out infinite; }
    @keyframes pt-conn-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    @keyframes pt-conn-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.3; }
    }
    /* Painel de debug expandido */
    #${ID}-panel {
      position: fixed;
      top: 50px;
      right: 12px;
      z-index: 10099;
      background: var(--bg-card, #fff);
      border: 1px solid var(--border-subtle, #e5e7eb);
      border-radius: 10px;
      padding: 14px 16px;
      max-width: 380px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.2);
      font-family: var(--font-ui, system-ui);
      font-size: 0.8125rem;
      display: none;
    }
    #${ID}-panel.visible { display: block; }
    #${ID}-panel h4 {
      margin: 0 0 8px;
      font-size: 0.875rem;
      color: var(--text-primary, #111);
    }
    #${ID}-panel .err {
      padding: 6px 8px;
      background: var(--bg-elevated, #f5f5f5);
      border-radius: 6px;
      margin-bottom: 4px;
      font-size: 0.6875rem;
      color: var(--text-secondary, #555);
    }
    #${ID}-panel .err .code { color: #DC2626; font-weight: 600; }
    #${ID}-panel .err .source { color: var(--brand-gold, #D4A843); }
  `;
  document.head.appendChild(s);
}

function _render() {
  const status = getStatus();
  const el = document.getElementById(ID);
  if (!el) return;
  el.classList.remove('visible', 'state-online', 'state-reconnecting', 'state-offline');
  if (status === 'online') {
    // Esconde — não polui UI quando tudo OK
    el.classList.remove('visible');
    _hidePanel();
    return;
  }
  el.classList.add('visible', `state-${status}`);
  if (status === 'reconnecting') {
    el.innerHTML = `<span class="dot"></span><span>Reconectando…</span>`;
    el.title = 'Conexão instável — algumas ações podem demorar a sincronizar.';
  } else if (status === 'offline') {
    el.innerHTML = `<span class="dot"></span><span>Sem conexão</span>`;
    el.title = 'Sem internet — alterações ficam pendentes. Reconecte pra enviar.';
  }
}

function _renderPanel() {
  let panel = document.getElementById(ID + '-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = ID + '-panel';
    document.body.appendChild(panel);
  }
  const errors = getRecentErrors(8);
  const isAdmin = store.isMaster() || store.can?.('system_manage_settings');
  panel.innerHTML = `
    <h4>Status: ${getStatus()}</h4>
    <div style="color: var(--text-muted, #666); margin-bottom: 8px;">
      Navegador: ${navigator.onLine ? '🟢 online' : '🔴 offline'}
    </div>
    ${isAdmin && errors.length ? `
      <div style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 6px;">
        Últimos erros de rede:
      </div>
      ${errors.map(e => {
        const t = new Date(e.ts).toLocaleTimeString('pt-BR');
        return `<div class="err">
          <span class="source">${e.source}</span>
          ${e.code ? `<span class="code"> [${e.code}]</span>` : ''}
          <div>${t} — ${e.msg.replace(/</g, '&lt;')}</div>
        </div>`;
      }).join('')}
    ` : !errors.length ? `
      <div style="color: var(--text-muted, #666); font-size: 0.75rem;">
        Nenhum erro recente registrado.
      </div>
    ` : ''}
  `;
}

function _togglePanel() {
  const panel = document.getElementById(ID + '-panel');
  if (panel?.classList.contains('visible')) {
    panel.classList.remove('visible');
  } else {
    _renderPanel();
    document.getElementById(ID + '-panel')?.classList.add('visible');
  }
}

function _hidePanel() {
  document.getElementById(ID + '-panel')?.classList.remove('visible');
}

export function mountConnectionIndicator() {
  if (document.getElementById(ID)) return; // idempotente
  _ensureStyles();
  const el = document.createElement('div');
  el.id = ID;
  el.addEventListener('click', _togglePanel);
  document.body.appendChild(el);

  // Fecha painel ao clicar fora
  document.addEventListener('click', (e) => {
    if (e.target.closest('#' + ID) || e.target.closest('#' + ID + '-panel')) return;
    _hidePanel();
  });

  _render();
  onChange(_render);
}
