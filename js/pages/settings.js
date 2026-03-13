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
  if (!store.isAdmin()) {
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

    <div style="display:grid; grid-template-columns:220px 1fr; gap:24px; align-items:flex-start;">
      <!-- Sidebar nav -->
      <div class="card" style="position:sticky; top:80px; padding:8px;">
        ${[
          { id:'general',       icon:'⚙',  label:'Geral' },
          { id:'tasks',         icon:'✓',  label:'Tarefas' },
          { id:'notifications', icon:'🔔', label:'Notificações' },
          { id:'csat-settings', icon:'★',  label:'CSAT' },
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
        data:          renderSectionData,
      };
      const fn = sections[item.dataset.section];
      const el = document.getElementById('settings-content');
      if(fn && el) el.innerHTML = fn(settings);
      bindSectionEvents(settings);
    });
  });
  bindSectionEvents(settings);

  // Save all
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
      <label class="toggle">
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
