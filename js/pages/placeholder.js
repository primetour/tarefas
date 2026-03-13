/**
 * PRIMETOUR — Placeholder Page
 * Tela para módulos ainda em desenvolvimento
 */

const PAGE_INFO = {
  team:         { icon: '◎', title: 'Equipe',          etapa: 2, desc: 'Visão da carga de trabalho e disponibilidade do time.' },
  csat:         { icon: '★', title: 'CSAT',             etapa: 4, desc: 'Envio e gestão de pesquisas de satisfação por e-mail.' },
  dashboards:   { icon: '◫', title: 'Dashboards',       etapa: 3, desc: 'Dashboards completos e personalizáveis com gráficos avançados.' },
  audit:        { icon: '◌', title: 'Auditoria',        etapa: 3, desc: 'Log completo de todas as ações realizadas no sistema.' },
  settings:     { icon: '⚙', title: 'Configurações',    etapa: 5, desc: 'Configurações gerais do sistema e da empresa.' },
  integrations: { icon: '⟳', title: 'Integrações',      etapa: 5, desc: 'Conexão com Figma, Salesforce, Planner e APIs próprias.' },
  profile:      { icon: '👤', title: 'Meu Perfil',       etapa: 1, desc: 'Gerencie seus dados pessoais e preferências.' },
};

export function renderPlaceholder(container, route) {
  const info = PAGE_INFO[route] || {
    icon: '🔧', title: route, etapa: '?', desc: 'Módulo em desenvolvimento.'
  };

  container.innerHTML = `
    <div style="
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 60vh;
      text-align: center;
      padding: 48px 24px;
    ">
      <div style="
        width: 88px;
        height: 88px;
        background: rgba(212,168,67,0.1);
        border: 2px solid rgba(212,168,67,0.25);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 2.5rem;
        margin-bottom: 24px;
      ">${info.icon}</div>

      <h2 style="font-size:1.5rem; font-weight:600; color:var(--text-primary); margin-bottom:8px;">
        ${info.title}
      </h2>

      <p style="font-size:0.9375rem; color:var(--text-secondary); max-width:420px; line-height:1.7; margin-bottom:24px;">
        ${info.desc}
      </p>

      <span class="badge badge-warning" style="font-size:0.8125rem; padding:6px 14px;">
        ⚙ Disponível na Etapa ${info.etapa}
      </span>

      <div style="
        margin-top: 48px;
        padding: 20px 32px;
        background: var(--bg-surface);
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-lg);
        font-size: 0.875rem;
        color: var(--text-muted);
        max-width: 360px;
      ">
        💡 Este módulo está no roadmap de desenvolvimento.<br>
        <a href="#dashboard" style="color:var(--brand-gold); margin-top:8px; display:inline-block;">
          ← Voltar ao Dashboard
        </a>
      </div>
    </div>
  `;
}
