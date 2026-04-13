/**
 * PRIMETOUR — Settings Page (Etapa 5)
 * Configurações gerais do sistema
 */

import { store }       from '../store.js';
import { toast }       from '../components/toast.js';
import { APP_CONFIG }  from '../config.js';
import {
  collection, doc, getDoc, setDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }          from '../firebase.js';
import { auditLog }    from '../auth/audit.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function renderSettings(container) {
  if (!store.can('system_manage_settings')) {
    container.innerHTML = `
      <div class="empty-state" style="min-height:60vh;">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-title">Acesso restrito</div>
        <p class="text-sm text-muted">Somente administradores podem acessar as configurações.</p>
      </div>
    `;
    return;
  }

  // Load saved settings
  let settings = {};
  try {
    const snap = await getDoc(doc(db, 'settings', 'global'));
    if (snap.exists()) settings = snap.data();
  } catch(e) {}

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Configurações</h1>
        <p class="page-subtitle">Configurações gerais do sistema</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary" id="settings-save-btn">Salvar todas</button>
      </div>
    </div>

    ${store.isMaster() ? `
      <div class="card" style="margin-bottom:24px;border:1px solid rgba(245,158,11,.3);">
        <div class="card-header"><div class="card-title">🔧 Migração de dados</div></div>
        <div class="card-body">
          <p style="font-size:0.875rem;color:var(--text-secondary);margin-bottom:16px;line-height:1.6;">
            Preenche o campo <strong>setor</strong> e migra <strong>núcleos</strong> de nomes para IDs nas tarefas existentes.
            Execute uma vez após definir os setores nos tipos de tarefa.
          </p>
          <div id="mig-progress" style="display:none;margin-bottom:12px;">
            <div id="mig-label" style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:6px;">Aguardando...</div>
            <div style="height:6px;background:var(--bg-elevated);border-radius:3px;overflow:hidden;">
              <div id="mig-bar" style="height:100%;background:var(--brand-gold);width:0%;transition:width .3s;border-radius:3px;"></div>
            </div>
          </div>
          <button class="btn btn-secondary" id="run-migration-btn">▶ Executar migração de setor e núcleos</button>
        </div>
      </div>
    ` : ''}

    <div style="display:grid; grid-template-columns:220px 1fr; gap:24px; align-items:flex-start;">
      <!-- Sidebar nav -->
      <div class="card" style="position:sticky; top:80px; padding:8px;">
        ${[
          { id:'general',       icon:'⚙',  label:'Geral' },
          { id:'tasks',         icon:'✓',  label:'Tarefas' },
          { id:'notifications', icon:'🔔', label:'Notificações' },
          { id:'csat-settings', icon:'★',  label:'CSAT' },
          { id:'integrations',  icon:'🔌', label:'Integrações' },
          { id:'privacy',       icon:'🔐', label:'Privacidade e IA' },
          { id:'data',          icon:'💾', label:'Dados' },
        ].map((s,i) => `
          <div class="settings-nav-item ${i===0?'active':''}" data-section="${s.id}"
            style="display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:var(--radius-md);
              cursor:pointer; color:var(--text-secondary); font-size:0.875rem; font-weight:500;
              transition:all var(--transition-fast); margin-bottom:2px;">
            <span>${s.icon}</span>${s.label}
          </div>
        `).join('')}
      </div>

      <!-- Content -->
      <div id="settings-content">
        ${renderSectionGeneral(settings)}
      </div>
    </div>
  `;

  // Nav
  document.querySelectorAll('.settings-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.settings-nav-item').forEach(i => {
        i.classList.remove('active');
        i.style.background = '';
        i.style.color = '';
      });
      item.classList.add('active');
      item.style.background = 'rgba(212,168,67,0.1)';
      item.style.color = 'var(--brand-gold)';

      const sections = {
        general:       renderSectionGeneral,
        tasks:         renderSectionTasks,
        notifications: renderSectionNotifications,
        'csat-settings': renderSectionCsat,
        integrations:  renderSectionIntegrations,
        privacy:       renderSectionPrivacy,
        data:          renderSectionData,
      };
      const fn = sections[item.dataset.section];
      const el = document.getElementById('settings-content');
      if(fn && el) el.innerHTML = fn(settings);
      bindSectionEvents(settings);
      // Carregar seções assíncronas
      if (item.dataset.section === 'privacy') loadPrivacySection();
    });
  });
  bindSectionEvents(settings);

  // Save all
  // Sector migration
  document.getElementById('run-migration-btn')?.addEventListener('click', async () => {
    const btn   = document.getElementById('run-migration-btn');
    const prog  = document.getElementById('mig-progress');
    const label = document.getElementById('mig-label');
    const bar   = document.getElementById('mig-bar');
    if (btn)  { btn.disabled = true; btn.classList.add('loading'); }
    if (prog) prog.style.display = 'block';
    try {
      const result = await runSectorMigration((done, total) => {
        if (label) label.textContent = `Migrando… ${done} / ${total} tarefas`;
        if (bar && total) bar.style.width = `${Math.round(done/total*100)}%`;
      });
      toast.success(`Migração concluída: ${result.migrated} tarefa${result.migrated!==1?'s':''} atualizadas.`);
      if (label) label.textContent = `✓ ${result.migrated} de ${result.total} tarefas atualizadas.`;
      if (bar)   bar.style.width = '100%';
    } catch(e) {
      toast.error('Erro: ' + e.message);
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('loading'); }
    }
  });

  document.getElementById('settings-save-btn')?.addEventListener('click', async () => {
    await saveAllSettings();
  });
}

/* ─── Sections ────────────────────────────────────────────── */
function renderSectionGeneral(s) {
  return `
    <div class="card" style="margin-bottom:20px;">
      <div class="card-header"><div class="card-title">⚙ Informações do sistema</div></div>
      <div class="card-body">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
          <div class="form-group">
            <label class="form-label">Nome da empresa</label>
            <input type="text" class="form-input" id="s-company-name"
              value="${esc(s.companyName||'PRIMETOUR')}" maxlength="80" />
          </div>
          <div class="form-group">
            <label class="form-label">Fuso horário</label>
            <select class="form-select" id="s-timezone">
              ${[
                'America/Sao_Paulo','America/Manaus','America/Belem',
                'America/Fortaleza','America/Recife','America/Campo_Grande',
                'UTC','Europe/Lisbon','Europe/London',
              ].map(tz => `<option value="${tz}" ${(s.timezone||'America/Sao_Paulo')===tz?'selected':''}>${tz}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Idioma padrão</label>
            <select class="form-select" id="s-language">
              <option value="pt-BR" ${(s.language||'pt-BR')==='pt-BR'?'selected':''}>Português (Brasil)</option>
              <option value="en-US" ${s.language==='en-US'?'selected':''}>English (US)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Itens por página</label>
            <select class="form-select" id="s-page-size">
              ${[10,15,20,25,50].map(n => `<option value="${n}" ${(s.pageSize||15)===n?'selected':''}>${n}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="card-header"><div class="card-title">🎨 Aparência</div></div>
      <div class="card-body">
        <div class="form-group">
          <label class="form-label">Cor de destaque</label>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            ${[
              { color:'#D4A843', label:'Gold (padrão)' },
              { color:'#38BDF8', label:'Azul' },
              { color:'#22C55E', label:'Verde' },
              { color:'#A78BFA', label:'Roxo' },
              { color:'#F97316', label:'Laranja' },
              { color:'#EC4899', label:'Rosa' },
            ].map(c => `
              <div style="display:flex; flex-direction:column; align-items:center; gap:4px; cursor:pointer;"
                data-accent="${c.color}" class="accent-swatch-btn">
                <div style="width:32px; height:32px; border-radius:50%; background:${c.color};
                  border:3px solid ${(s.accentColor||'#D4A843')===c.color?'white':'transparent'};
                  box-shadow:${(s.accentColor||'#D4A843')===c.color?'0 0 0 2px '+c.color:'none'};
                  transition:all 0.2s;"></div>
                <span style="font-size:0.625rem; color:var(--text-muted);">${c.label}</span>
              </div>
            `).join('')}
          </div>
        </div>
        <input type="hidden" id="s-accent-color" value="${esc(s.accentColor||'#D4A843')}" />
      </div>
    </div>
  `;
}

function renderSectionTasks(s) {
  return `
    <div class="card" style="margin-bottom:20px;">
      <div class="card-header"><div class="card-title">✓ Configurações de tarefas</div></div>
      <div class="card-body">
        ${settingToggle('s-allow-member-create',  'Membros podem criar tarefas', 'Se desabilitado, apenas gerentes e admins criam tarefas', s.allowMemberCreate !== false)}
        ${settingToggle('s-allow-member-delete',  'Membros podem excluir suas tarefas', '', s.allowMemberDelete === true)}
        ${settingToggle('s-auto-assign-creator',  'Atribuir automaticamente ao criador', 'Tarefa recém-criada é atribuída a quem a criou', s.autoAssignCreator !== false)}
        ${settingToggle('s-require-due-date',     'Exigir prazo ao criar tarefa', '', s.requireDueDate === true)}
        ${settingToggle('s-require-project',      'Exigir projeto ao criar tarefa', '', s.requireProject === true)}

        <div style="margin-top:16px; padding-top:16px; border-top:1px solid var(--border-subtle);">
          <div class="form-group">
            <label class="form-label">Limite de subtarefas por tarefa</label>
            <input type="number" class="form-input" id="s-max-subtasks"
              value="${s.maxSubtasks||20}" min="1" max="100" style="max-width:120px;" />
          </div>
          <div class="form-group" style="margin-top:12px;">
            <label class="form-label">Dias de antecedência para alertas de prazo</label>
            <input type="number" class="form-input" id="s-deadline-alert-days"
              value="${s.deadlineAlertDays||3}" min="1" max="30" style="max-width:120px;" />
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderSectionNotifications(s) {
  return `
    <div class="card">
      <div class="card-header"><div class="card-title">🔔 Notificações</div></div>
      <div class="card-body">
        <p style="font-size:0.875rem; color:var(--text-muted); margin-bottom:16px;">
          Configure quais eventos geram notificações para os membros da equipe.
        </p>
        ${settingToggle('s-notify-task-assigned',  'Tarefa atribuída', 'Notificar ao ser atribuído a uma tarefa', s.notifyTaskAssigned !== false)}
        ${settingToggle('s-notify-task-complete',  'Tarefa concluída', 'Notificar ao concluir tarefa', s.notifyTaskComplete !== false)}
        ${settingToggle('s-notify-task-comment',   'Novo comentário', 'Notificar ao receber comentário', s.notifyTaskComment !== false)}
        ${settingToggle('s-notify-overdue',        'Tarefa atrasada', 'Notificar ao passar do prazo', s.notifyOverdue !== false)}
        ${settingToggle('s-notify-project-update', 'Atualização de projeto', '', s.notifyProjectUpdate === true)}
      </div>
    </div>
  `;
}

function renderSectionCsat(s) {
  return `
    <div class="card">
      <div class="card-header"><div class="card-title">★ Configurações de CSAT</div></div>
      <div class="card-body">
        ${settingToggle('s-csat-auto-trigger', 'Oferecer pesquisa ao concluir tarefa', 'Exibe o prompt de CSAT ao marcar tarefa como concluída', s.csatAutoTrigger !== false)}
        ${settingToggle('s-csat-require-email', 'Exigir e-mail do cliente em tarefas', 'Mostra campo obrigatório de e-mail no formulário de tarefa', s.csatRequireEmail === true)}

        <div style="margin-top:16px; padding-top:16px; border-top:1px solid var(--border-subtle);">
          <div class="form-group">
            <label class="form-label">Expiração do link (dias)</label>
            <input type="number" class="form-input" id="s-csat-expiry"
              value="${s.csatExpiryDays||7}" min="1" max="30" style="max-width:120px;" />
          </div>
          <div class="form-group" style="margin-top:12px;">
            <label class="form-label">Mensagem padrão do e-mail CSAT</label>
            <textarea class="form-textarea" id="s-csat-default-msg" rows="3" maxlength="500"
            >${esc(s.csatDefaultMessage||'Sua tarefa foi concluída! Gostaríamos de saber sua opinião sobre nosso trabalho.')}</textarea>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderSectionIntegrations(s) {
  const psiKey = s.psiApiKey || '';
  const masked = psiKey ? psiKey.slice(0, 6) + '…' + psiKey.slice(-4) : '';
  return `
    <div class="card" style="margin-bottom:20px;">
      <div class="card-header">
        <div class="card-title">⚡ PageSpeed Insights API</div>
      </div>
      <div class="card-body">
        <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:14px;">
          Usada pela aba <strong>Core Web Vitals + SEO</strong> dentro de <em>Google Analytics</em>
          para auditar sites cadastrados. Crie uma key em
          <a href="https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com" target="_blank" rel="noopener"
             style="color:var(--brand-gold);text-decoration:underline;">Google Cloud Console → PageSpeed Insights API</a>.
        </p>
        <div class="form-group">
          <label class="form-label">API key</label>
          <input type="password" class="form-input" id="s-psi-api-key"
            value="${esc(psiKey)}" autocomplete="off"
            placeholder="AIzaSy…" maxlength="200" />
          ${psiKey ? `<div style="font-size:0.6875rem;color:#22C55E;margin-top:4px;">
            ✓ Key configurada (${esc(masked)})
          </div>` : `<div style="font-size:0.6875rem;color:var(--text-muted);margin-top:4px;">
            Nenhuma key salva. Sem ela, as auditorias não funcionam.
          </div>`}
          <button type="button" class="btn btn-ghost btn-sm" id="s-psi-test"
            style="margin-top:10px;">🧪 Testar conexão com PSI</button>
          <div id="s-psi-test-result" style="margin-top:8px;font-size:0.75rem;"></div>
        </div>
        <div style="font-size:0.6875rem;color:var(--text-muted);line-height:1.5;padding:10px 12px;
          background:var(--bg-surface);border-radius:var(--radius-md);">
          <strong>Segurança:</strong> a key é lida do browser para chamar a PSI API diretamente. Restrinja-a por
          <em>HTTP referrer</em> no Google Cloud Console com os domínios do sistema para evitar uso indevido.
          Limite gratuito: 25.000 requests/dia.
        </div>
      </div>
    </div>
  `;
}

function renderSectionPrivacy() {
  return `
    <div class="card" style="margin-bottom:20px;">
      <div class="card-header">
        <div class="card-title">🔐 Privacidade e IA — LGPD</div>
        <div class="card-subtitle" style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
          Configurações de proteção de dados para uso de inteligência artificial
        </div>
      </div>
      <div class="card-body" id="privacy-content" style="padding:16px;">
        <div style="text-align:center;padding:20px;color:var(--text-muted);">Carregando configurações...</div>
      </div>
    </div>
  `;
}

async function loadPrivacySection() {
  const el = document.getElementById('privacy-content');
  if (!el) return;

  let config;
  try {
    const { getPrivacyConfig } = await import('../services/aiDataGuard.js');
    config = await getPrivacyConfig();
  } catch {
    el.innerHTML = '<div style="color:var(--text-muted);padding:16px;">Erro ao carregar configurações de privacidade.</div>';
    return;
  }

  const modules = [
    { key: 'roteiros',  label: 'Roteiros' },
    { key: 'feedbacks', label: 'Feedbacks' },
    { key: 'csat',      label: 'CSAT' },
    { key: 'tasks',     label: 'Tarefas' },
    { key: 'portal-tips', label: 'Portal de Dicas' },
    { key: 'content-calendar', label: 'Calendário Conteúdo' },
  ];

  const providers = [
    { key: 'gemini',    label: 'Google Gemini' },
    { key: 'groq',      label: 'Groq' },
    { key: 'openai',    label: 'OpenAI' },
    { key: 'anthropic', label: 'Anthropic' },
    { key: 'azure',     label: 'Azure OpenAI' },
    { key: 'local',     label: 'Local (Ollama)' },
  ];

  const provInfo = config.providerInfo || {};
  const anonModules = config.anonymizeModules || [];
  const allowedProviders = config.allowedProviders || [];

  el.innerHTML = \`
    <!-- Anonimização -->
    <div style="margin-bottom:24px;">
      <h4 style="font-size:0.875rem;font-weight:600;margin-bottom:10px;color:var(--text-primary);">
        Anonimização de Dados Pessoais
      </h4>
      <label style="display:flex;align-items:center;gap:10px;margin-bottom:12px;cursor:pointer;font-size:0.8125rem;">
        <input type="checkbox" id="priv-anonymize" \${config.anonymizePii ? 'checked' : ''}
          style="accent-color:var(--brand-gold);width:16px;height:16px;">
        Anonimizar PII (e-mails, telefones, CPFs) antes de enviar para provedores de IA
      </label>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-left:26px;" id="priv-modules">
        \${modules.map(m => \`
          <label style="display:flex;align-items:center;gap:6px;padding:4px 10px;border-radius:6px;
            border:1px solid var(--border-subtle);font-size:0.75rem;cursor:pointer;">
            <input type="checkbox" class="priv-module-cb" data-module="\${m.key}"
              \${anonModules.includes(m.key) ? 'checked' : ''}
              style="accent-color:var(--brand-gold);width:14px;height:14px;">
            \${m.label}
          </label>
        \`).join('')}
      </div>
    </div>

    <!-- Consentimento -->
    <div style="margin-bottom:24px;">
      <h4 style="font-size:0.875rem;font-weight:600;margin-bottom:10px;color:var(--text-primary);">
        Consentimento
      </h4>
      <label style="display:flex;align-items:center;gap:10px;margin-bottom:8px;cursor:pointer;font-size:0.8125rem;">
        <input type="checkbox" id="priv-consent" \${config.consentRequired ? 'checked' : ''}
          style="accent-color:var(--brand-gold);width:16px;height:16px;">
        Exigir consentimento do usuário antes do primeiro uso de IA
      </label>
      <div style="margin-left:26px;font-size:0.75rem;color:var(--text-muted);">
        Versão atual: <strong>\${config.consentVersion || '1.0'}</strong>
        — alterar a versão força todos os usuários a aceitar novamente.
      </div>
    </div>

    <!-- Retenção -->
    <div style="margin-bottom:24px;">
      <h4 style="font-size:0.875rem;font-weight:600;margin-bottom:10px;color:var(--text-primary);">
        Retenção de Logs
      </h4>
      <div style="display:flex;align-items:center;gap:12px;">
        <label style="font-size:0.8125rem;">Manter logs de uso por:</label>
        <select id="priv-retention" style="padding:6px 10px;border-radius:6px;border:1px solid var(--border-subtle);
          background:var(--bg-surface);color:var(--text-primary);font-size:0.8125rem;">
          <option value="30" \${config.dataRetentionDays == 30 ? 'selected' : ''}>30 dias</option>
          <option value="60" \${config.dataRetentionDays == 60 ? 'selected' : ''}>60 dias</option>
          <option value="90" \${config.dataRetentionDays == 90 ? 'selected' : ''}>90 dias</option>
          <option value="180" \${config.dataRetentionDays == 180 ? 'selected' : ''}>180 dias</option>
          <option value="365" \${config.dataRetentionDays == 365 ? 'selected' : ''}>1 ano</option>
        </select>
        <button id="priv-clean-logs" style="padding:6px 14px;border-radius:6px;border:1px solid var(--danger,#EF4444);
          background:transparent;color:var(--danger,#EF4444);font-size:0.75rem;cursor:pointer;font-family:inherit;">
          Limpar logs antigos
        </button>
      </div>
    </div>

    <!-- Provedores permitidos -->
    <div style="margin-bottom:24px;">
      <h4 style="font-size:0.875rem;font-weight:600;margin-bottom:10px;color:var(--text-primary);">
        Provedores Permitidos
      </h4>
      <div style="display:flex;flex-wrap:wrap;gap:8px;" id="priv-providers">
        \${providers.map(p => \`
          <label style="display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:6px;
            border:1px solid var(--border-subtle);font-size:0.8125rem;cursor:pointer;">
            <input type="checkbox" class="priv-provider-cb" data-provider="\${p.key}"
              \${allowedProviders.includes(p.key) ? 'checked' : ''}
              style="accent-color:var(--brand-gold);width:14px;height:14px;">
            \${p.label}
          </label>
        \`).join('')}
      </div>
      <label style="display:flex;align-items:center;gap:10px;margin-top:10px;cursor:pointer;font-size:0.8125rem;">
        <input type="checkbox" id="priv-local-preferred" \${config.localPreferred ? 'checked' : ''}
          style="accent-color:var(--brand-gold);width:16px;height:16px;">
        Preferir servidor local (Ollama) para módulos com dados sensíveis
      </label>
    </div>

    <!-- Tabela de Compliance -->
    <div style="margin-bottom:24px;">
      <h4 style="font-size:0.875rem;font-weight:600;margin-bottom:10px;color:var(--text-primary);">
        Compliance dos Provedores
      </h4>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:0.75rem;">
          <thead>
            <tr style="border-bottom:1px solid var(--border-subtle);">
              <th style="text-align:left;padding:8px;color:var(--text-muted);">Provedor</th>
              <th style="text-align:center;padding:8px;color:var(--text-muted);">GDPR</th>
              <th style="text-align:center;padding:8px;color:var(--text-muted);">LGPD</th>
              <th style="text-align:center;padding:8px;color:var(--text-muted);">Região</th>
              <th style="text-align:left;padding:8px;color:var(--text-muted);">Observação</th>
            </tr>
          </thead>
          <tbody>
            \${providers.map(p => {
              const info = provInfo[p.key] || {};
              return \`<tr style="border-bottom:1px solid var(--border-subtle,#1E2D3D);">
                <td style="padding:8px;font-weight:500;">\${p.label}</td>
                <td style="padding:8px;text-align:center;">\${info.gdpr ? '<span style="color:#22C55E;">✓</span>' : '<span style="color:#EF4444;">✕</span>'}</td>
                <td style="padding:8px;text-align:center;">\${info.lgpd ? '<span style="color:#22C55E;">✓</span>' : '<span style="color:#F59E0B;">—</span>'}</td>
                <td style="padding:8px;text-align:center;color:var(--text-muted);">\${info.region || '—'}</td>
                <td style="padding:8px;color:var(--text-muted);font-size:0.6875rem;">\${info.note || ''}</td>
              </tr>\`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Relatório LGPD -->
    <div style="margin-bottom:16px;">
      <h4 style="font-size:0.875rem;font-weight:600;margin-bottom:10px;color:var(--text-primary);">
        Relatório LGPD
      </h4>
      <button id="priv-lgpd-report" style="padding:8px 18px;border-radius:8px;border:none;cursor:pointer;
        background:linear-gradient(135deg,#D4A843,#B8922F);color:#0C1926;font-weight:600;font-size:0.8125rem;font-family:inherit;">
        Gerar Relatório LGPD (30 dias)
      </button>
      <div id="priv-lgpd-result" style="margin-top:12px;"></div>
    </div>

    <!-- Botão salvar -->
    <div style="border-top:1px solid var(--border-subtle);padding-top:16px;display:flex;justify-content:flex-end;">
      <button id="priv-save" style="padding:10px 28px;border-radius:8px;border:none;cursor:pointer;
        background:linear-gradient(135deg,#D4A843,#B8922F);color:#0C1926;font-weight:600;font-size:0.875rem;font-family:inherit;">
        Salvar Configurações
      </button>
    </div>
  \`;

  // Bind events
  document.getElementById('priv-save')?.addEventListener('click', async () => {
    try {
      const { savePrivacyConfig } = await import('../services/aiDataGuard.js');
      const newModules = Array.from(document.querySelectorAll('.priv-module-cb:checked')).map(cb => cb.dataset.module);
      const newProviders = Array.from(document.querySelectorAll('.priv-provider-cb:checked')).map(cb => cb.dataset.provider);

      await savePrivacyConfig({
        anonymizePii: document.getElementById('priv-anonymize')?.checked ?? true,
        anonymizeModules: newModules,
        consentRequired: document.getElementById('priv-consent')?.checked ?? true,
        consentVersion: config.consentVersion || '1.0',
        dataRetentionDays: parseInt(document.getElementById('priv-retention')?.value || '90'),
        allowedProviders: newProviders,
        localPreferred: document.getElementById('priv-local-preferred')?.checked ?? false,
        showDisclaimer: true,
        providerInfo: config.providerInfo,
      });
      const { toast } = await import('../components/toast.js');
      toast.success('Configurações de privacidade salvas.');
    } catch (e) {
      const { toast } = await import('../components/toast.js');
      toast.error('Erro ao salvar: ' + e.message);
    }
  });

  document.getElementById('priv-clean-logs')?.addEventListener('click', async () => {
    try {
      const { cleanExpiredLogs } = await import('../services/aiDataGuard.js');
      const count = await cleanExpiredLogs();
      const { toast } = await import('../components/toast.js');
      toast.success(\`\${count} log(s) removido(s).\`);
    } catch (e) {
      const { toast } = await import('../components/toast.js');
      toast.error('Erro: ' + e.message);
    }
  });

  document.getElementById('priv-lgpd-report')?.addEventListener('click', async () => {
    const resultEl = document.getElementById('priv-lgpd-result');
    if (!resultEl) return;
    resultEl.innerHTML = '<div style="color:var(--text-muted);">Gerando relatório...</div>';
    try {
      const { generateLgpdReport } = await import('../services/aiDataGuard.js');
      const report = await generateLgpdReport();
      resultEl.innerHTML = \`
        <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:8px;padding:16px;font-size:0.75rem;">
          <div style="font-weight:600;margin-bottom:12px;">Relatório LGPD — Últimos \${report.period}</div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px;">
            <div style="text-align:center;">
              <div style="font-size:1.25rem;font-weight:700;color:var(--brand-gold);">\${report.usage.totalCalls}</div>
              <div style="color:var(--text-muted);">Chamadas IA</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:1.25rem;font-weight:700;color:var(--brand-gold);">\${report.usage.totalTokens.toLocaleString()}</div>
              <div style="color:var(--text-muted);">Tokens processados</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:1.25rem;font-weight:700;color:\${report.usage.anonymizationRate >= 80 ? '#22C55E' : '#F59E0B'};">\${report.usage.anonymizationRate}%</div>
              <div style="color:var(--text-muted);">Taxa de anonimização</div>
            </div>
            <div style="text-align:center;">
              <div style="font-size:1.25rem;font-weight:700;color:var(--brand-gold);">\${report.consent.consented}/\${report.consent.total}</div>
              <div style="color:var(--text-muted);">Consentimentos ativos</div>
            </div>
          </div>
          <div style="margin-bottom:12px;">
            <strong>Por provedor:</strong>
            \${Object.entries(report.usage.byProvider).map(([p,c]) => \`<span style="margin-left:8px;">\${p}: \${c}</span>\`).join(' |')}
          </div>
          <div>
            <strong>Por módulo:</strong>
            \${Object.entries(report.usage.byModule).map(([m,c]) => \`<span style="margin-left:8px;">\${m}: \${c}</span>\`).join(' |')}
          </div>
          <div style="margin-top:12px;color:var(--text-muted);font-size:0.6875rem;">
            Gerado em: \${new Date(report.generatedAt).toLocaleString('pt-BR')}
          </div>
        </div>
      \`;
    } catch (e) {
      resultEl.innerHTML = \`<div style="color:var(--danger);">Erro ao gerar relatório: \${e.message}</div>\`;
    }
  });
}

function renderSectionData(s) {
  return `
    <div class="card" style="margin-bottom:20px;">
      <div class="card-header">
        <div class="card-title">💾 Backup e exportação</div>
      </div>
      <div class="card-body">
        <p style="font-size:0.875rem; color:var(--text-secondary); margin-bottom:16px; line-height:1.6;">
          Exporte todos os dados do sistema para backup ou migração.
          Os arquivos gerados estão em formato CSV e são compatíveis com Excel e Sheets.
        </p>
        <div class="export-options">
          <div class="export-card" id="export-tasks-btn">
            <div class="export-card-icon">📋</div>
            <div class="export-card-label">Tarefas</div>
            <div class="export-card-desc">Todas as tarefas com subtarefas</div>
          </div>
          <div class="export-card" id="export-projects-btn">
            <div class="export-card-icon">📦</div>
            <div class="export-card-label">Projetos</div>
            <div class="export-card-desc">Projetos e estatísticas</div>
          </div>
          <div class="export-card" id="export-users-btn">
            <div class="export-card-icon">👥</div>
            <div class="export-card-label">Usuários</div>
            <div class="export-card-desc">Lista de membros da equipe</div>
          </div>
          <div class="export-card" id="export-audit-btn">
            <div class="export-card-icon">📝</div>
            <div class="export-card-label">Auditoria</div>
            <div class="export-card-desc">Log completo de atividades</div>
          </div>
        </div>
      </div>
    </div>

    <div class="card" style="border-color:rgba(239,68,68,0.2);">
      <div class="card-header">
        <div class="card-title" style="color:var(--color-danger);">⚠ Zona perigosa</div>
      </div>
      <div class="card-body">
        <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 0; border-bottom:1px solid var(--border-subtle);">
          <div>
            <div style="font-size:0.875rem; font-weight:500; color:var(--text-primary);">Limpar cache do sistema</div>
            <div style="font-size:0.8125rem; color:var(--text-muted);">Remove dados temporários e força recarga</div>
          </div>
          <button class="btn btn-secondary btn-sm" id="clear-cache-btn">Limpar cache</button>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; padding:12px 0;">
          <div>
            <div style="font-size:0.875rem; font-weight:500; color:var(--color-danger);">Redefinir configurações</div>
            <div style="font-size:0.8125rem; color:var(--text-muted);">Restaura todas as configurações para os valores padrão</div>
          </div>
          <button class="btn btn-secondary btn-sm" id="reset-settings-btn"
            style="border-color:rgba(239,68,68,0.3); color:var(--color-danger);">
            Redefinir
          </button>
        </div>
      </div>
    </div>
  `;
}

/* ─── Helpers ─────────────────────────────────────────────── */
function settingToggle(id, label, desc, checked) {
  return `
    <div class="integration-toggle-row">
      <div>
        <div style="font-size:0.875rem; font-weight:500; color:var(--text-primary);">${label}</div>
        ${desc ? `<div style="font-size:0.8125rem; color:var(--text-muted); margin-top:2px;">${desc}</div>` : ''}
      </div>
      <label class="toggle-switch">
        <input type="checkbox" id="${id}" ${checked?'checked':''} />
        <span class="toggle-slider"></span>
      </label>
    </div>
  `;
}

/* ─── Bind section events ─────────────────────────────────── */
function bindSectionEvents(settings) {
  // Accent color swatches
  document.querySelectorAll('.accent-swatch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('s-accent-color').value = btn.dataset.accent;
      document.querySelectorAll('.accent-swatch-btn > div').forEach(d => {
        d.style.borderColor = 'transparent';
        d.style.boxShadow   = 'none';
      });
      const swatch = btn.querySelector('div');
      if(swatch) {
        swatch.style.borderColor = 'white';
        swatch.style.boxShadow   = `0 0 0 2px ${btn.dataset.accent}`;
      }
    });
  });

  // Export buttons
  document.getElementById('export-tasks-btn')?.addEventListener('click',    () => exportData('tasks'));
  document.getElementById('export-projects-btn')?.addEventListener('click', () => exportData('projects'));
  document.getElementById('export-users-btn')?.addEventListener('click',    () => exportData('users'));
  document.getElementById('export-audit-btn')?.addEventListener('click',    () => exportData('audit'));

  document.getElementById('clear-cache-btn')?.addEventListener('click', () => {
    localStorage.clear();
    sessionStorage.clear();
    toast.success('Cache limpo! A página será recarregada.');
    setTimeout(() => location.reload(), 1000);
  });

  // Testar key do PageSpeed Insights
  document.getElementById('s-psi-test')?.addEventListener('click', async () => {
    const btn = document.getElementById('s-psi-test');
    const out = document.getElementById('s-psi-test-result');
    if (!out) return;
    const key = document.getElementById('s-psi-api-key')?.value?.trim();
    if (!key) {
      out.innerHTML = '<span style="color:#EF4444;">⚠ Digite a key no campo acima antes de testar.</span>';
      return;
    }
    btn.disabled = true;
    out.innerHTML = '<span style="color:var(--text-muted);">Testando…</span>';
    try {
      // Chamada mínima: só categoria performance, URL leve (google.com)
      const ep = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'
        + '?url=https%3A%2F%2Fwww.google.com'
        + '&strategy=mobile'
        + '&category=performance'
        + '&key=' + encodeURIComponent(key);
      const resp = await fetch(ep);
      if (resp.ok) {
        const j = await resp.json();
        const score = Math.round((j?.lighthouseResult?.categories?.performance?.score ?? 0) * 100);
        out.innerHTML = `<span style="color:#22C55E;">✓ Conexão OK — resposta do Google recebida (score de teste: ${score}).
          Pode salvar a key e executar auditorias.</span>`;
      } else {
        const err = await resp.json().catch(() => ({}));
        const gmsg = err?.error?.message || 'Erro desconhecido';
        let diag = '';
        if (resp.status === 400) {
          diag = '<br><strong>Possível causa:</strong> API não habilitada no projeto Google Cloud, key inválida, ou restrição de referrer. Vá em <em>APIs & Services → Library</em> e habilite <strong>PageSpeed Insights API</strong>.';
        } else if (resp.status === 403) {
          diag = '<br><strong>Possível causa:</strong> sem permissão. Verifique se a key tem acesso ao PSI.';
        } else if (resp.status === 429) {
          diag = '<br><strong>Possível causa:</strong> quota excedida.';
        }
        out.innerHTML = `<span style="color:#EF4444;">✗ HTTP ${resp.status} — ${gmsg}${diag}</span>`;
      }
    } catch (e) {
      out.innerHTML = `<span style="color:#EF4444;">✗ Falha de rede: ${e.message}</span>`;
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('reset-settings-btn')?.addEventListener('click', async () => {
    const { modal: m } = await import('../components/modal.js');
    const ok = await m.confirm({
      title:'Redefinir configurações',
      message:'Restaurar <strong>todas as configurações</strong> para os valores padrão?',
      confirmText:'Redefinir', danger:true, icon:'⚠',
    });
    if(ok) {
      await setDoc(doc(db,'settings','global'), {
        resetAt: serverTimestamp(), resetBy: store.get('currentUser').uid,
      });
      toast.success('Configurações redefinidas.');
    }
  });
}

/* ─── Save settings ───────────────────────────────────────── */
async function saveAllSettings() {
  const btn = document.getElementById('settings-save-btn');
  if(btn){ btn.classList.add('loading'); btn.disabled=true; }
  try {
    const data = {
      companyName:        document.getElementById('s-company-name')?.value?.trim()  || 'PRIMETOUR',
      timezone:           document.getElementById('s-timezone')?.value             || 'America/Sao_Paulo',
      language:           document.getElementById('s-language')?.value             || 'pt-BR',
      pageSize:           parseInt(document.getElementById('s-page-size')?.value)  || 15,
      accentColor:        document.getElementById('s-accent-color')?.value         || '#D4A843',
      allowMemberCreate:  document.getElementById('s-allow-member-create')?.checked ?? true,
      allowMemberDelete:  document.getElementById('s-allow-member-delete')?.checked ?? false,
      autoAssignCreator:  document.getElementById('s-auto-assign-creator')?.checked ?? true,
      requireDueDate:     document.getElementById('s-require-due-date')?.checked   ?? false,
      requireProject:     document.getElementById('s-require-project')?.checked    ?? false,
      maxSubtasks:        parseInt(document.getElementById('s-max-subtasks')?.value) || 20,
      deadlineAlertDays:  parseInt(document.getElementById('s-deadline-alert-days')?.value) || 3,
      notifyTaskAssigned: document.getElementById('s-notify-task-assigned')?.checked ?? true,
      notifyTaskComplete: document.getElementById('s-notify-task-complete')?.checked ?? true,
      notifyTaskComment:  document.getElementById('s-notify-task-comment')?.checked ?? true,
      notifyOverdue:      document.getElementById('s-notify-overdue')?.checked     ?? true,
      notifyProjectUpdate:document.getElementById('s-notify-project-update')?.checked ?? false,
      csatAutoTrigger:    document.getElementById('s-csat-auto-trigger')?.checked  ?? true,
      csatRequireEmail:   document.getElementById('s-csat-require-email')?.checked ?? false,
      csatExpiryDays:     parseInt(document.getElementById('s-csat-expiry')?.value) || 7,
      csatDefaultMessage: document.getElementById('s-csat-default-msg')?.value?.trim() || '',
      updatedAt:          serverTimestamp(),
      updatedBy:          store.get('currentUser').uid,
    };

    // psiApiKey: só salva se a seção Integrações estiver aberta (senão preserva valor)
    const psiEl = document.getElementById('s-psi-api-key');
    if (psiEl) data.psiApiKey = psiEl.value?.trim() || '';

    // Remove nulls
    Object.keys(data).forEach(k => { if(data[k] === null || data[k] === undefined) delete data[k]; });

    await setDoc(doc(db, 'settings', 'global'), data, { merge: true });
    await auditLog('settings.update', 'settings', 'global', {});

    // Apply accent color immediately
    if (data.accentColor) {
      document.documentElement.style.setProperty('--brand-gold', data.accentColor);
    }
    toast.success('Configurações salvas com sucesso!');
  } catch(e) {
    toast.error('Erro ao salvar: ' + e.message);
  } finally {
    if(btn){ btn.classList.remove('loading'); btn.disabled=false; }
  }
}

/* ─── Data export ─────────────────────────────────────────── */
async function exportData(type) {
  toast.info('Preparando exportação...');
  try {
    let rows = [], headers = [];

    if (type === 'tasks') {
      const { fetchTasks } = await import('../services/tasks.js');
      const tasks = await fetchTasks();
      headers = ['ID','Título','Status','Prioridade','Projeto','Responsáveis','Prazo','Criado em','Concluído em'];
      rows = tasks.map(t => [
        t.id, t.title, t.status, t.priority, t.projectId||'',
        (t.assignees||[]).join(';'),
        t.dueDate ? fmtDate(t.dueDate) : '',
        t.createdAt ? fmtDate(t.createdAt) : '',
        t.completedAt ? fmtDate(t.completedAt) : '',
      ]);
    } else if (type === 'projects') {
      const { fetchProjects } = await import('../services/projects.js');
      const projects = await fetchProjects();
      headers = ['ID','Nome','Status','Tarefas','Concluídas','Início','Fim'];
      rows = projects.map(p => [
        p.id, p.name, p.status, p.taskCount||0, p.doneCount||0,
        p.startDate ? fmtDate(p.startDate) : '',
        p.endDate   ? fmtDate(p.endDate)   : '',
      ]);
    } else if (type === 'users') {
      const users = store.get('users') || [];
      headers = ['ID','Nome','E-mail','Papel','Cargo','Ativo','Criado em'];
      rows = users.map(u => [
        u.id, u.name, u.email, u.role, u.jobTitle||'', u.active!==false?'Sim':'Não',
        u.createdAt ? fmtDate(u.createdAt) : '',
      ]);
    } else if (type === 'audit') {
      const { fetchAuditLogs } = await import('../auth/audit.js');
      const result = await fetchAuditLogs({ pageSize:500 });
      const logs   = result.logs || result;
      headers = ['Data','Ação','Usuário','E-mail','Tipo','ID do recurso'];
      rows = logs.map(l => [
        l.timestamp ? fmtDate(l.timestamp) : '',
        l.action||'', l.userName||'', l.userEmail||'',
        l.entityType||'', l.entityId||'',
      ]);
    }

    const csv = [headers, ...rows]
      .map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','))
      .join('\n');

    const a = Object.assign(document.createElement('a'), {
      href:     URL.createObjectURL(new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8;'})),
      download: `primetour_${type}_${new Date().toISOString().slice(0,10)}.csv`,
    });
    a.click();
    toast.success(`${rows.length} registros exportados!`);
  } catch(e) {
    toast.error('Erro ao exportar: ' + e.message);
  }
}

function fmtDate(ts) {
  if (!ts) return '';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR').format(d);
}

/* ─── Migration: add sector to tasks without it ─────────── */
export async function runSectorMigration(onProgress) {
  const {
    collection, getDocs, doc, updateDoc, query, where, limit,
  } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  const { db }         = await import('../firebase.js');
  const { fetchTaskTypes } = await import('../services/taskTypes.js');

  // Load task types to map typeId → sector
  const types    = await fetchTaskTypes().catch(() => []);
  const typeMap  = Object.fromEntries(types.map(t => [t.id, t.sector || null]));

  // Also clean variation names in task_types (strip legacy '· Nd' suffix)
  const typesSnap = await getDocs(collection(db, 'task_types'));
  for (const td of typesSnap.docs) {
    const data = td.data();
    if (!data.variations?.length) continue;
    const cleaned = data.variations.map(v => ({
      ...v,
      name: v.name?.replace(/\s*·\s*\d+d\s*$|\s*·\s*mesmo dia\s*$/i, '').trim() || v.name,
    }));
    const changed = cleaned.some((v,i) => v.name !== data.variations[i].name);
    if (changed) {
      await updateDoc(doc(db, 'task_types', td.id), { variations: cleaned }).catch(()=>{});
    }
  }

  // Also clean variationName on existing tasks
  const tasksWithDotSla = await getDocs(query(collection(db, 'tasks'), limit(2000)));
  for (const td of tasksWithDotSla.docs) {
    const data = td.data();
    if (!data.variationName) continue;
    const cleaned = data.variationName.replace(/\s*·\s*\d+d\s*$|\s*·\s*mesmo dia\s*$/i, '').trim();
    if (cleaned !== data.variationName) {
      await updateDoc(doc(db, 'tasks', td.id), { variationName: cleaned }).catch(()=>{});
    }
  }

  // Load nucleos to build name→id map
  const nucleosSnap = await getDocs(collection(db, 'nucleos')).catch(()=>({docs:[]}));
  const nucleosByName = {};
  nucleosSnap.docs.forEach(d => {
    const n = d.data();
    nucleosByName[n.name?.toLowerCase()] = d.id;
  });

  // Map legacy slugs to canonical names for lookup
  const SLUG_TO_NAME = {
    'design':        'Design',
    'comunicacao':   'Comunicação',
    'redes_sociais': 'Redes Sociais',
    'dados':         'Dados',
    'web':           'Web',
    'sistemas':      'Sistemas',
    'ia':            'IA',
  };

  const snap = await getDocs(query(collection(db, 'tasks'), limit(2000)));
  const toMigrate = snap.docs.filter(d => {
    const data = d.data();
    const needsSector = !data.sector && data.typeId && typeMap[data.typeId];
    const needsNucleos = (data.nucleos||[]).some(n => typeof n === 'string' && !n.match(/^[A-Za-z0-9]{20}$/));
    return needsSector || needsNucleos;
  });

  let done = 0;
  const total = toMigrate.length;
  onProgress?.(0, total);

  for (const d of toMigrate) {
    const data   = d.data();
    const update = {};

    // Migrate sector
    if (!data.sector && data.typeId && typeMap[data.typeId]) {
      update.sector = typeMap[data.typeId];
    }

    // Migrate nucleos: names → Firestore IDs
    if ((data.nucleos||[]).length) {
      const migratedNucleos = data.nucleos.map(n => {
        if (typeof n !== 'string') return n;
        // Already an ID (20-char Firestore ID) — keep it
        if (n.match(/^[A-Za-z0-9]{20}$/)) return n;
        // Try slug→canonical name→Firestore ID
        const canonicalName = SLUG_TO_NAME[n.toLowerCase()];
        if (canonicalName) {
          const byCanonical = nucleosByName[canonicalName.toLowerCase()];
          if (byCanonical) return byCanonical;
        }
        // Try direct name match
        const byName = nucleosByName[n.toLowerCase()];
        if (byName) return byName;
        // Keep as-is (unknown slug — not in Firestore)
        return n;
      });
      if (JSON.stringify(migratedNucleos) !== JSON.stringify(data.nucleos)) {
        update.nucleos = migratedNucleos;
      }
    }

    if (Object.keys(update).length) {
      await updateDoc(doc(db, 'tasks', d.id), update).catch(() => {});
    }
    done++;
    onProgress?.(done, total);
  }

  return { migrated: done, total };
}
