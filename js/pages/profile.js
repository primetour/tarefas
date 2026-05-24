/**
 * PRIMETOUR — Profile Page (Etapa 3)
 * Edição de perfil do usuário logado
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import { updateUserProfile, changePassword } from '../auth/auth.js';
import { fetchTasks }    from '../services/tasks.js';
import { setupTasksAutoRefresh, teardownTasksAutoRefresh } from '../services/realtimeSync.js';
import { fetchProjects } from '../services/projects.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const PROFILE_PALETTES = [
  { id:'midnight',  label:'Midnight Navy',  desc:'Azul escuro clássico',    colors:['#0A1628','#D4A843','#1E293B','#94A3B8'] },
  { id:'platinum',  label:'Platinum',        desc:'Claro e clean',           colors:['#F8FAFC','#6366F1','#E2E8F0','#334155'] },
  { id:'charcoal',  label:'Charcoal',        desc:'Cinza escuro elegante',   colors:['#1A1A2E','#E94560','#16213E','#A0AEC0'] },
  { id:'ocean',     label:'Ocean Blue',      desc:'Azul oceano profundo',    colors:['#0B1929','#00BCD4','#132F4C','#B0BEC5'] },
  { id:'forest',    label:'Forest Green',    desc:'Verde floresta natural',   colors:['#0D1F0D','#4CAF50','#1B3A1B','#A5D6A7'] },
  { id:'royal',     label:'Royal Purple',    desc:'Roxo real sofisticado',    colors:['#1A0A2E','#9C27B0','#2D1B4E','#CE93D8'] },
  { id:'sunset',    label:'Warm Sunset',     desc:'Laranja quente e acolhedor', colors:['#1A0F0A','#FF6B35','#2D1810','#FFAB91'] },
  { id:'rose',      label:'Rose',            desc:'Rosa vibrante e moderno',  colors:['#1A0A14','#E91E63','#2D1520','#F48FB1'] },
  { id:'sand',      label:'Sand',            desc:'Claro com tons quentes',   colors:['#FAF6F1','#8B6914','#E8E0D4','#5D4E37'] },
  { id:'portal',    label:'Portal',          desc:'Azul royal · branco · cinza (estilo City Guides)', colors:['#1F2937','#2563EB','#FFFFFF','#64748B'] },
];

function _buildPaletteCards(currentPalette) {
  return PROFILE_PALETTES.map(p => {
    const active = currentPalette === p.id;
    const swatches = p.colors.map(c =>
      '<span style="width:18px;height:18px;border-radius:50%;background:' + c +
      ';border:1px solid rgba(128,128,128,0.3);display:inline-block;"></span>'
    ).join('');
    // Check com CLASSE específica `.palette-check` — o seletor antigo
    // (`span[style*="margin-left:auto"]`) falhava em alguns navegadores
    // porque o style normalizado mudava de ordem, fazendo o querySelector
    // não achar o ✓ existente — resultado: ✓ duplicado a cada click.
    return '<div class="palette-card' + (active ? ' selected' : '') + '" data-palette-id="' + p.id + '"' +
      ' style="padding:14px;border-radius:var(--radius-md);border:2px solid ' +
      (active ? 'var(--brand-gold)' : 'var(--border-subtle)') +
      ';background:var(--bg-surface);cursor:pointer;transition:all 0.2s;">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">' +
      '<div style="display:flex;gap:4px;">' + swatches + '</div>' +
      (active ? '<span class="palette-check" style="margin-left:auto;color:var(--brand-gold);font-weight:700;">✓</span>' : '') +
      '</div>' +
      '<div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);">' + esc(p.label) + '</div>' +
      '<div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">' + esc(p.desc) + '</div>' +
      '</div>';
  }).join('');
}

function getInitials(name) {
  return (name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
}

export async function renderProfile(container) {
  // v4.53.4+ Auto-refresh real-time
  setupTasksAutoRefresh('profile', container, renderProfile);

  const user    = store.get('currentUser');
  const profile = store.get('userProfile');

  if (!user || !profile) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👤</div>
      <div class="empty-state-title">Perfil não disponível</div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Meu Perfil</h1>
        <p class="page-subtitle">Gerencie seus dados pessoais</p>
      </div>
    </div>
    <div id="profile-stats-row" style="margin-bottom:24px;">
      <div class="task-empty" style="min-height:60px; padding:12px;">
        <div class="chart-loading-spinner"></div>
      </div>
    </div>
    <div class="profile-layout">
      <!-- Left: avatar card -->
      <div class="profile-card" id="profile-left-card">
        <div class="profile-avatar-wrapper" style="position:relative;">
          <div class="avatar" id="profile-avatar-big"
            style="width:80px; height:80px; font-size:1.75rem; background:${profile.avatarColor||'#3B82F6'};">
            ${profile.photoURL
              ? `<img src="${esc(profile.photoURL)}" alt="${esc(getInitials(profile.name))}"
                  onerror="this.style.display='none';"
                  style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" />${getInitials(profile.name)}`
              : getInitials(profile.name)}
          </div>
          <button id="sync-photo-btn" type="button" title="Sincronizar foto do Microsoft 365"
            style="position:absolute;top:0;right:calc(50% - 50px);background:var(--bg-card);
            border:1px solid var(--border-default);border-radius:50%;width:30px;height:30px;
            display:flex;align-items:center;justify-content:center;cursor:pointer;
            color:var(--text-secondary);font-size:0.875rem;box-shadow:0 2px 6px rgba(0,0,0,0.1);">
            🔄
          </button>
          <!-- 4.35.6+ Upload manual de foto (independe do Outlook 365) -->
          <button id="upload-photo-btn" type="button" title="Fazer upload de foto"
            style="position:absolute;top:36px;right:calc(50% - 50px);background:var(--bg-card);
            border:1px solid var(--border-default);border-radius:50%;width:30px;height:30px;
            display:flex;align-items:center;justify-content:center;cursor:pointer;
            color:var(--text-secondary);font-size:0.875rem;box-shadow:0 2px 6px rgba(0,0,0,0.1);">
            📷
          </button>
          ${profile.photoURL ? `
            <button id="remove-photo-btn" type="button" title="Remover foto"
              style="position:absolute;top:72px;right:calc(50% - 50px);background:var(--bg-card);
              border:1px solid var(--border-default);border-radius:50%;width:30px;height:30px;
              display:flex;align-items:center;justify-content:center;cursor:pointer;
              color:var(--color-danger);font-size:0.75rem;box-shadow:0 2px 6px rgba(0,0,0,0.1);">
              ✕
            </button>
          ` : ''}
          <input type="file" id="photo-file-input" accept="image/*" style="display:none;" />
        </div>
        <div class="profile-name">${esc(profile.name)}</div>
        <div class="profile-email">${esc(profile.email)}</div>
        <span class="badge badge-role-${profile.role}" style="margin-bottom:12px;">
          ${{ admin:'Administrador', manager:'Gerente', member:'Membro' }[profile.role] || profile.role}
        </span>
        <div style="font-size:0.75rem; color:var(--text-muted);">
          Membro desde ${profile.createdAt
            ? new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric'})
                .format(profile.createdAt?.toDate ? profile.createdAt.toDate() : new Date(profile.createdAt))
            : '—'}
        </div>
        <div class="profile-stats" id="profile-stats-boxes">
          <div class="profile-stat-box skeleton" style="height:52px;"></div>
          <div class="profile-stat-box skeleton" style="height:52px;"></div>
          <div class="profile-stat-box skeleton" style="height:52px;"></div>
          <div class="profile-stat-box skeleton" style="height:52px;"></div>
        </div>
      </div>

      <!-- Right: form -->
      <div>
        <!-- Personal info -->
        <div class="card" style="margin-bottom:20px;">
          <div class="card-header">
            <div class="card-title">Informações pessoais</div>
          </div>
          <div class="card-body">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
              <div class="form-group">
                <label class="form-label">Nome completo *</label>
                <input type="text" class="form-input" id="pf-name"
                  value="${esc(profile.name||'')}" maxlength="80" />
                <span class="form-error-msg" id="pf-name-err"></span>
              </div>
              <div class="form-group">
                <label class="form-label">E-mail</label>
                <input type="email" class="form-input" value="${esc(profile.email||'')}"
                  disabled style="opacity:0.6;" title="O e-mail não pode ser alterado" />
              </div>
              <div class="form-group">
                <label class="form-label">Cargo / Função</label>
                <input type="text" class="form-input" id="pf-role-title"
                  value="${esc(profile.jobTitle||'')}" placeholder="Ex: Designer UX, Dev Front-end..."
                  maxlength="60" />
              </div>
              <div class="form-group">
                <label class="form-label">Departamento</label>
                <input type="text" class="form-input" id="pf-dept"
                  value="${esc(profile.department||'')}" placeholder="Ex: Produto, Tecnologia..."
                  maxlength="60" />
              </div>
              <div class="form-group col-span-2" style="grid-column:span 2;">
                <label class="form-label">Bio / Sobre você</label>
                <textarea class="form-textarea" id="pf-bio" rows="3" maxlength="300"
                  placeholder="Conte um pouco sobre você e sua experiência..."
                >${esc(profile.bio||'')}</textarea>
                <span style="font-size:0.75rem; color:var(--text-muted); text-align:right; display:block;" id="bio-counter">
                  ${(profile.bio||'').length}/300
                </span>
              </div>
            </div>

            <div style="display:flex; justify-content:flex-end; gap:12px; margin-top:8px;">
              <button class="btn btn-secondary btn-sm" id="pf-reset-btn">Descartar alterações</button>
              <button class="btn btn-primary" id="pf-save-btn">Salvar alterações</button>
            </div>
          </div>
        </div>

        <!-- Password -->
        <div class="card" style="margin-bottom:20px;">
          <div class="card-header">
            <div class="card-title">Segurança</div>
            <div class="card-subtitle">Altere sua senha de acesso</div>
          </div>
          <div class="card-body">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
              <div class="form-group" style="grid-column:span 2;">
                <label class="form-label">Senha atual *</label>
                <div class="form-input-wrapper">
                  <input type="password" class="form-input" id="pw-current"
                    placeholder="Digite sua senha atual" autocomplete="current-password" />
                  <button class="form-input-toggle" data-target="pw-current" title="Mostrar senha">👁</button>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Nova senha *</label>
                <div class="form-input-wrapper">
                  <input type="password" class="form-input" id="pw-new"
                    placeholder="Mínimo 6 caracteres" autocomplete="new-password" />
                  <button class="form-input-toggle" data-target="pw-new" title="Mostrar senha">👁</button>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Confirmar nova senha *</label>
                <div class="form-input-wrapper">
                  <input type="password" class="form-input" id="pw-confirm"
                    placeholder="Repita a nova senha" autocomplete="new-password" />
                  <button class="form-input-toggle" data-target="pw-confirm" title="Mostrar senha">👁</button>
                </div>
              </div>
            </div>
            <span class="form-error-msg" id="pw-error" style="display:block; margin-bottom:8px;"></span>
            <div class="password-strength" id="pw-strength" style="margin-bottom:12px; display:none;">
              <div class="progress" style="height:4px; margin-bottom:4px;">
                <div class="progress-bar" id="pw-strength-bar" style="width:0%; transition:width 0.3s;"></div>
              </div>
              <span id="pw-strength-label" style="font-size:0.75rem; color:var(--text-muted);"></span>
            </div>
            <div style="display:flex; justify-content:flex-end;">
              <button class="btn btn-primary" id="pw-save-btn">Alterar senha</button>
            </div>
          </div>
        </div>

        <!-- Notifications preferences -->
        <div class="card" style="margin-bottom:20px;">
          <div class="card-header">
            <div class="card-title">Notificações</div>
          </div>
          <div class="card-body">
            <div style="display:flex; flex-direction:column; gap:16px;">
              ${[
                { id:'pref-notify-assign',   label:'Notificações de atribuição', desc:'Alertar quando uma tarefa for atribuída a mim', checked: profile.prefs?.notifyAssign !== false },
                { id:'pref-notify-mention',  label:'Notificações de menção',      desc:'Alertar quando alguém comentar em minhas tarefas', checked: profile.prefs?.notifyMention !== false },
                { id:'pref-notify-deadline', label:'Alertas de prazo',            desc:'Alertar 2 dias antes do prazo de uma tarefa minha', checked: profile.prefs?.notifyDeadline !== false },
                { id:'pref-notify-sound',    label:'Som de notificação',          desc:'Tocar som ao receber novas notificações', checked: profile.prefs?.notifySound !== false },
              ].map(p => `
                <div style="display:flex; align-items:flex-start; gap:12px; justify-content:space-between;">
                  <div>
                    <div style="font-size:0.875rem; font-weight:500; color:var(--text-primary);">${p.label}</div>
                    <div style="font-size:0.8125rem; color:var(--text-muted); margin-top:2px;">${p.desc}</div>
                  </div>
                  <label class="toggle-switch">
                    <input type="checkbox" id="${p.id}" ${p.checked ? 'checked' : ''} />
                    <span class="toggle-slider"></span>
                  </label>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Som de conclusão de tarefa (4.34+) -->
        <div class="card" style="margin-bottom:20px;">
          <div class="card-header">
            <div class="card-title">Som de conclusão de tarefa</div>
            <div class="card-subtitle">Toca quando você marca uma tarefa como concluída</div>
          </div>
          <div class="card-body">
            <div id="sound-chooser-section">
              <!-- preenchido por _renderSoundChooser() após mount -->
              <div style="font-size:0.8125rem;color:var(--text-muted);">Carregando opções...</div>
            </div>
          </div>
        </div>

        <!-- Color palette preference -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">Aparência</div>
            <div class="card-subtitle">Escolha a paleta de cores do sistema</div>
          </div>
          <div class="card-body">
            <div id="palette-chooser" style="display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px;">
              ${_buildPaletteCards(profile.prefs?.palette || localStorage.getItem('primetour-palette') || 'portal')}
            </div>
            <div style="display:flex; justify-content:flex-end; margin-top:16px;">
              <button class="btn btn-primary btn-sm" id="prefs-save-btn">Salvar preferências</button>
            </div>
          </div>
        </div>

        <!-- Logo do sistema (sidebar) — variando por paleta clara/escura -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">Logo do sistema · <span style="font-size:0.7rem;
              padding:2px 8px;background:var(--brand-gold);color:#FFF;border-radius:10px;
              font-weight:600;letter-spacing:.05em;text-transform:uppercase;">global</span></div>
            <div class="card-subtitle">URLs dos logos exibidos na sidebar, login e splash.
              <strong>Aplica para TODOS os usuários do sistema</strong> — somente administradores
              podem alterar. O sistema escolhe automaticamente conforme a paleta (claro/escuro).</div>
          </div>
          <div class="card-body" style="display:flex;flex-direction:column;gap:14px;">
            <div>
              <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">
                Logo claro (pra fundos escuros — sidebar Midnight/Charcoal/Portal)
              </label>
              <input type="url" id="app-logo-light" class="form-input" style="width:100%;"
                placeholder="https://pub-xxx.r2.dev/logos/primetour-branca.webp"
                value="${esc(localStorage.getItem('app-logo-light') || '')}">
              <div style="margin-top:6px;height:48px;display:flex;align-items:center;
                background:#1F2937;border-radius:6px;padding:0 12px;">
                <img id="app-logo-light-preview" alt="" style="height:32px;max-width:140px;object-fit:contain;
                  display:${localStorage.getItem('app-logo-light')?'block':'none'};"
                  src="${esc(localStorage.getItem('app-logo-light') || '')}">
              </div>
            </div>
            <div>
              <label style="font-size:0.8125rem;font-weight:600;display:block;margin-bottom:6px;">
                Logo escuro (pra fundos claros — sidebar Platinum/Sand)
              </label>
              <input type="url" id="app-logo-dark" class="form-input" style="width:100%;"
                placeholder="https://pub-xxx.r2.dev/logos/primetour-azul.webp"
                value="${esc(localStorage.getItem('app-logo-dark') || '')}">
              <div style="margin-top:6px;height:48px;display:flex;align-items:center;
                background:#FFFFFF;border:1px solid var(--border-default);border-radius:6px;padding:0 12px;">
                <img id="app-logo-dark-preview" alt="" style="height:32px;max-width:140px;object-fit:contain;
                  display:${localStorage.getItem('app-logo-dark')?'block':'none'};"
                  src="${esc(localStorage.getItem('app-logo-dark') || '')}">
              </div>
            </div>
            <div style="display:flex;justify-content:flex-end;gap:8px;">
              <button class="btn btn-secondary btn-sm" id="app-logo-clear">Limpar</button>
              <button class="btn btn-primary btn-sm" id="app-logo-save">Salvar logos</button>
            </div>
          </div>
        </div>

        ${store.isMaster() ? `
        <!-- Modo Teste (sandbox) — APENAS PARA DIRETORIA -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">🧪 Modo Teste · <span style="font-size:0.7rem;
              padding:2px 8px;background:#F59E0B;color:#FFF;border-radius:10px;
              font-weight:600;letter-spacing:.05em;text-transform:uppercase;">diretoria</span></div>
            <div class="card-subtitle">
              Permite explorar funcionalidades (criar tarefas, mexer em projetos, etc) <strong>sem
              salvar nada no banco</strong>. Útil pra demos e treinamento. Ao ativar, um banner
              vermelho fica fixo no topo do app indicando que está em modo teste.
            </div>
          </div>
          <div class="card-body">
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;
              padding:10px 12px;background:var(--bg-surface);border-radius:var(--radius-sm);">
              <input type="checkbox" id="sandbox-toggle"
                ${(typeof localStorage !== 'undefined' && localStorage.getItem('primetour_sandbox') === '1') ? 'checked' : ''}
                style="width:18px;height:18px;cursor:pointer;accent-color:#F59E0B;" />
              <span style="flex:1;">
                <div style="font-weight:600;font-size:0.875rem;">Ativar modo teste</div>
                <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
                  As ações de criar/editar/excluir tarefas mostrarão toast "não foi salvo" em vez de gravar.
                </div>
              </span>
            </label>
          </div>
        </div>
        ` : ''}
      </div>
    </div>
  `;

  // Load stats async
  _loadProfileStats(user.uid);
  _bindProfileEvents(profile);
}

/* ─── Load stats ─────────────────────────────────────────── */
async function _loadProfileStats(uid) {
  try {
    const [tasks, projects] = await Promise.all([
      fetchTasks().catch(()=>[]),
      fetchProjects().catch(()=>[]),
    ]);

    const myTasks    = tasks.filter(t => t.assignees?.includes(uid));
    const myDone     = myTasks.filter(t => t.status === 'done');
    const myProjects = projects.filter(p => p.members?.includes(uid));
    const myOverdue  = myTasks.filter(t => {
      if (!t.dueDate || t.status==='done') return false;
      const d = t.dueDate?.toDate ? t.dueDate.toDate() : new Date(t.dueDate);
      return d < new Date();
    });

    const statsRow = document.getElementById('profile-stats-row');
    if (statsRow) statsRow.innerHTML = '';

    const statsBoxes = document.getElementById('profile-stats-boxes');
    if (statsBoxes) {
      statsBoxes.innerHTML = `
        <div class="profile-stat-box">
          <div class="profile-stat-value">${myTasks.length}</div>
          <div class="profile-stat-label">Tarefas</div>
        </div>
        <div class="profile-stat-box">
          <div class="profile-stat-value" style="color:var(--color-success);">${myDone.length}</div>
          <div class="profile-stat-label">Concluídas</div>
        </div>
        <div class="profile-stat-box">
          <div class="profile-stat-value">${myProjects.length}</div>
          <div class="profile-stat-label">Projetos</div>
        </div>
        <div class="profile-stat-box">
          <div class="profile-stat-value" style="color:${myOverdue.length?'var(--color-danger)':'var(--text-primary)'};">${myOverdue.length}</div>
          <div class="profile-stat-label">Atrasadas</div>
        </div>
      `;
    }
  } catch(e) {
    console.warn('Profile stats error:', e);
  }
}

/* ─── Bind events ─────────────────────────────────────────── */
function _bindProfileEvents(profile) {
  // Bio counter
  document.getElementById('pf-bio')?.addEventListener('input', (e) => {
    const counter = document.getElementById('bio-counter');
    if (counter) counter.textContent = `${e.target.value.length}/300`;
  });

  // Password toggles
  document.querySelectorAll('.form-input-toggle[data-target]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
        btn.textContent = input.type === 'password' ? '👁' : '🙈';
      }
    });
  });

  // Password strength
  document.getElementById('pw-new')?.addEventListener('input', (e) => {
    const val = e.target.value;
    const strength = document.getElementById('pw-strength');
    const bar      = document.getElementById('pw-strength-bar');
    const label    = document.getElementById('pw-strength-label');
    if (!val) { if(strength) strength.style.display='none'; return; }
    if(strength) strength.style.display='block';
    const score = [/.{8,}/, /[A-Z]/, /[a-z]/, /\d/, /[^A-Za-z0-9]/]
      .filter(r => r.test(val)).length;
    const configs = [
      { w:'20%',  color:'#EF4444', text:'Muito fraca' },
      { w:'40%',  color:'#F97316', text:'Fraca' },
      { w:'60%',  color:'#F59E0B', text:'Razoável' },
      { w:'80%',  color:'#22C55E', text:'Forte' },
      { w:'100%', color:'#16A34A', text:'Muito forte' },
    ];
    const c = configs[score - 1] || configs[0];
    if(bar)   { bar.style.width = c.w; bar.style.background = c.color; }
    if(label) { label.textContent = c.text; label.style.color = c.color; }
  });

  // Reset form
  document.getElementById('pf-reset-btn')?.addEventListener('click', () => {
    document.getElementById('pf-name').value       = profile.name || '';
    document.getElementById('pf-role-title').value = profile.jobTitle || '';
    document.getElementById('pf-dept').value       = profile.department || '';
    document.getElementById('pf-bio').value        = profile.bio || '';
    const counter = document.getElementById('bio-counter');
    if(counter) counter.textContent = `${(profile.bio||'').length}/300`;
    toast.info('Alterações descartadas.');
  });

  // Save profile
  document.getElementById('pf-save-btn')?.addEventListener('click', async () => {
    const name = document.getElementById('pf-name')?.value?.trim();
    const errEl = document.getElementById('pf-name-err');
    if (!name) { if(errEl) errEl.textContent = 'Nome é obrigatório.'; return; }
    if(errEl) errEl.textContent = '';

    const btn = document.getElementById('pf-save-btn');
    if(btn) { btn.classList.add('loading'); btn.disabled=true; }
    try {
      await updateUserProfile(store.get('currentUser').uid, {
        name,
        jobTitle:   document.getElementById('pf-role-title')?.value?.trim() || '',
        department: document.getElementById('pf-dept')?.value?.trim() || '',
        bio:        document.getElementById('pf-bio')?.value?.trim() || '',
      });
      // Update displayed name
      document.querySelector('.profile-name')?.innerText && (document.querySelector('.profile-name').textContent = name);
      toast.success('Perfil atualizado com sucesso!');
    } catch(e) { toast.error(e.message); }
    finally { if(btn) { btn.classList.remove('loading'); btn.disabled=false; } }
  });

  // Save password
  document.getElementById('pw-save-btn')?.addEventListener('click', async () => {
    const current  = document.getElementById('pw-current')?.value;
    const newPw    = document.getElementById('pw-new')?.value;
    const confirm  = document.getElementById('pw-confirm')?.value;
    const errEl    = document.getElementById('pw-error');

    if(!current) { if(errEl) errEl.textContent='Digite a senha atual.'; return; }
    if(!newPw || newPw.length < 6) { if(errEl) errEl.textContent='A nova senha deve ter ao menos 6 caracteres.'; return; }
    if(newPw !== confirm) { if(errEl) errEl.textContent='As senhas não coincidem.'; return; }
    if(errEl) errEl.textContent = '';

    const btn = document.getElementById('pw-save-btn');
    if(btn) { btn.classList.add('loading'); btn.disabled=true; }
    try {
      await changePassword(current, newPw);
      document.getElementById('pw-current').value = '';
      document.getElementById('pw-new').value = '';
      document.getElementById('pw-confirm').value = '';
      document.getElementById('pw-strength').style.display = 'none';
      toast.success('Senha alterada com sucesso!');
    } catch(e) { if(errEl) errEl.textContent = e.message; }
    finally { if(btn) { btn.classList.remove('loading'); btn.disabled=false; } }
  });

  // Palette chooser click events
  let _selectedPalette = profile.prefs?.palette || localStorage.getItem('primetour-palette') || 'portal';
  document.querySelectorAll('#palette-chooser .palette-card').forEach(card => {
    card.addEventListener('click', () => {
      _selectedPalette = card.dataset.paletteId;
      document.documentElement.dataset.palette = _selectedPalette;
      localStorage.setItem('primetour-palette', _selectedPalette);
      // Re-render: limpa TODOS os checks antes (single source of truth) e
      // adiciona apenas no card ativo. Evita ✓ duplicados por clicks repetidos.
      document.querySelectorAll('#palette-chooser .palette-card').forEach(c => {
        const isActive = c.dataset.paletteId === _selectedPalette;
        c.classList.toggle('selected', isActive);
        c.style.borderColor = isActive ? 'var(--brand-gold)' : 'var(--border-subtle)';
        // Remove TODOS os checks dessa card (defensivo contra duplicados existentes)
        c.querySelectorAll('.palette-check').forEach(el => el.remove());
        if (isActive) {
          const firstRow = c.querySelector('div');
          const s = document.createElement('span');
          s.className = 'palette-check';
          s.style.cssText = 'margin-left:auto;color:var(--brand-gold);font-weight:700;';
          s.textContent = '✓';
          firstRow.appendChild(s);
        }
      });
      // Re-renderiza sidebar quando muda paleta (logo claro/escuro pode mudar)
      import('../components/sidebar.js').then(({ renderSidebar }) => {
        const el = document.querySelector('.sidebar');
        if (el && renderSidebar) renderSidebar(el);
      }).catch(()=>{});
    });
  });

  // ─── Sound chooser (4.34+) ───
  // Estado local do som escolhido (sincroniza com prefs e com o save).
  let _selectedSoundId = profile.prefs?.completionSoundId || 'plin';
  (async () => {
    try {
      const { SOUND_LIBRARY, playSound } = await import('../services/sounds.js');
      const section = document.getElementById('sound-chooser-section');
      if (!section) return;

      const renderCards = () => {
        const groups = {
          classic: { label: 'Clássicos',          icon: '🎵', items: [] },
          fun:     { label: 'Divertidos',         icon: '🎈', items: [] },
          meta:    { label: 'Outros',             icon: '⚙',  items: [] },
        };
        for (const s of SOUND_LIBRARY) {
          (groups[s.category] || groups.meta).items.push(s);
        }
        section.innerHTML = Object.entries(groups).filter(([, g]) => g.items.length).map(([key, g]) => `
          <div style="margin-bottom:18px;">
            <div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);
              margin-bottom:8px;letter-spacing:0.04em;text-transform:uppercase;">
              ${g.icon} ${g.label}
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;">
              ${g.items.map(s => {
                const selected = s.id === _selectedSoundId;
                // 4.34.3+ Sub-texto vira descrição amigável do som (antes era
                // hardcoded "Slot aguardando MP3" pra TODO arquivo, mesmo
                // depois do banco real chegar).
                const subtext = s.mute ? 'Sem som' : (s.description || '');
                return `
                  <div class="sound-card" data-sound-id="${s.id}" style="
                    border:2px solid ${selected ? 'var(--brand-gold)' : 'var(--border-subtle)'};
                    background:${selected ? 'rgba(212,168,67,0.08)' : 'var(--bg-card)'};
                    border-radius:8px;padding:12px;cursor:pointer;
                    transition:all 0.15s;display:flex;align-items:center;gap:10px;">
                    <div style="font-size:1.5rem;flex-shrink:0;">${s.icon}</div>
                    <div style="flex:1;min-width:0;">
                      <div style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);">
                        ${s.label}${selected ? ' <span style="color:var(--brand-gold);">✓</span>' : ''}
                      </div>
                      <div style="font-size:0.6875rem;color:var(--text-muted);line-height:1.3;
                        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(subtext)}">
                        ${esc(subtext)}
                      </div>
                    </div>
                    ${!s.mute ? `
                    <button class="sound-preview-btn" data-sound-id="${s.id}" title="Ouvir prévia"
                      style="background:none;border:1px solid var(--border-subtle);border-radius:50%;
                      width:30px;height:30px;display:flex;align-items:center;justify-content:center;
                      cursor:pointer;color:var(--text-secondary);font-size:0.75rem;flex-shrink:0;">
                      ▶
                    </button>` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `).join('');

        // Bind cards: click no card seleciona, click no botão ▶ toca preview
        section.querySelectorAll('.sound-card').forEach(card => {
          card.addEventListener('click', e => {
            if (e.target.closest('.sound-preview-btn')) return;  // delegado abaixo
            _selectedSoundId = card.dataset.soundId;
            renderCards();
          });
        });
        section.querySelectorAll('.sound-preview-btn').forEach(btn => {
          btn.addEventListener('click', e => {
            e.stopPropagation();
            playSound(btn.dataset.soundId);
          });
        });
      };
      renderCards();
    } catch (e) {
      console.warn('[profile] sound chooser falhou:', e?.message);
    }
  })();

  // Save preferences (notifications + palette + som de conclusão)
  // ── 4.34.5+ Botão "Sincronizar foto" no avatar ──
  // Faz fetch da foto do Microsoft 365 via Graph com o accessToken do user
  // (já em sessionStorage). Se token expirou, pede pro user relogar.
  document.getElementById('sync-photo-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('sync-photo-btn');
    btn.style.opacity = '0.5';
    btn.textContent = '⏳';
    try {
      const token = sessionStorage.getItem('ms-access-token');
      const exp = parseInt(sessionStorage.getItem('ms-token-expires') || '0', 10);
      if (!token || exp <= Date.now()) {
        toast.warning('Sessão SSO expirou. Faça logout e login novamente pra atualizar a foto.');
        return;
      }
      const res = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 404) {
        toast.info('Você não tem foto cadastrada no Microsoft 365.');
        return;
      }
      if (!res.ok) throw new Error('Graph ' + res.status);
      const blob = await res.blob();
      // Resize via canvas (mesma fn de auth.js mas inline aqui pra desacoplar)
      const dataUrl = await new Promise(resolve => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = c.height = 96;
          const ctx = c.getContext('2d');
          const ss = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width-ss)/2, (img.height-ss)/2, ss, ss, 0, 0, 96, 96);
          URL.revokeObjectURL(url);
          resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
      });
      if (!dataUrl) throw new Error('falha ao processar imagem');
      await updateUserProfile(store.get('currentUser').uid, { photoURL: dataUrl });
      toast.success('Foto sincronizada! Recarregue a página pra ver em todos os lugares.');
      // Atualiza o avatar grande na hora
      const big = document.getElementById('profile-avatar-big');
      if (big) {
        big.innerHTML = `<img src="${dataUrl}"
          style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" />${getInitials(profile.name)}`;
      }
    } catch (e) {
      toast.error('Falha ao sincronizar: ' + e.message);
    } finally {
      btn.textContent = '🔄';
      btn.style.opacity = '1';
    }
  });

  // 4.35.6+ Upload manual de foto — independe do Outlook 365
  document.getElementById('upload-photo-btn')?.addEventListener('click', () => {
    document.getElementById('photo-file-input')?.click();
  });

  document.getElementById('photo-file-input')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Selecione um arquivo de imagem (PNG, JPG, etc).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Imagem grande demais (máx 5MB). Use um arquivo menor.');
      return;
    }

    const btn = document.getElementById('upload-photo-btn');
    if (btn) { btn.style.opacity = '0.5'; btn.textContent = '⏳'; }

    try {
      // Resize via canvas (mesma lógica do sync: 96x96 quadrado, jpeg 0.85)
      const dataUrl = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = c.height = 96;
          const ctx = c.getContext('2d');
          const ss = Math.min(img.width, img.height);
          ctx.drawImage(img, (img.width - ss) / 2, (img.height - ss) / 2, ss, ss, 0, 0, 96, 96);
          URL.revokeObjectURL(url);
          resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Imagem inválida ou corrompida.')); };
        img.src = url;
      });

      await updateUserProfile(store.get('currentUser').uid, { photoURL: dataUrl });
      toast.success('Foto atualizada! Recarregue a página pra ver em todos os lugares.');

      // Atualiza o avatar grande na hora
      const big = document.getElementById('profile-avatar-big');
      if (big) {
        big.innerHTML = `<img src="${dataUrl}" alt=""
          style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;display:block;" />${getInitials(profile.name)}`;
      }
      // Atualiza store local pra header/sidebar refletir
      const cur = store.get('userProfile');
      if (cur) store.set('userProfile', { ...cur, photoURL: dataUrl });
    } catch (err) {
      toast.error('Falha ao processar imagem: ' + err.message);
    } finally {
      if (btn) { btn.style.opacity = '1'; btn.textContent = '📷'; }
      e.target.value = ''; // limpa input pra permitir re-selecionar mesmo arquivo
    }
  });

  // 4.35.6+ Remover foto (volta pras iniciais)
  document.getElementById('remove-photo-btn')?.addEventListener('click', async () => {
    const ok = await modal.confirm({
      title: 'Remover foto?',
      message: 'Sua foto será removida. Voltamos pra exibir as iniciais.',
      confirmText: 'Remover', danger: true,
    });
    if (!ok) return;
    try {
      await updateUserProfile(store.get('currentUser').uid, { photoURL: null });
      toast.success('Foto removida.');
      const big = document.getElementById('profile-avatar-big');
      if (big) big.innerHTML = getInitials(profile.name);
      const cur = store.get('userProfile');
      if (cur) store.set('userProfile', { ...cur, photoURL: null });
      // Esconde o botão de remover (não tem mais foto)
      const rmBtn = document.getElementById('remove-photo-btn');
      if (rmBtn) rmBtn.style.display = 'none';
    } catch (e) { toast.error('Falha ao remover: ' + e.message); }
  });

  document.getElementById('prefs-save-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('prefs-save-btn');
    if(btn) { btn.classList.add('loading'); btn.disabled=true; }
    try {
      await updateUserProfile(store.get('currentUser').uid, {
        prefs: {
          notifyAssign:        document.getElementById('pref-notify-assign')?.checked ?? true,
          notifyMention:       document.getElementById('pref-notify-mention')?.checked ?? true,
          notifyDeadline:      document.getElementById('pref-notify-deadline')?.checked ?? true,
          notifySound:         document.getElementById('pref-notify-sound')?.checked ?? true,
          completionSoundId:   _selectedSoundId,
          palette:             _selectedPalette,
        }
      });
      toast.success('Preferências salvas!');
    } catch(e) { toast.error(e.message); }
    finally { if(btn) { btn.classList.remove('loading'); btn.disabled=false; } }
  });

  // Logo do sistema (sidebar) — preview em tempo real + save em localStorage.
  // Re-renderiza a sidebar inteira após salvar pra refletir o novo logo.
  ['light','dark'].forEach(kind => {
    const input = document.getElementById(`app-logo-${kind}`);
    const preview = document.getElementById(`app-logo-${kind}-preview`);
    input?.addEventListener('input', () => {
      const url = input.value.trim();
      if (preview) {
        preview.src = url;
        preview.style.display = url ? 'block' : 'none';
      }
    });
  });
  document.getElementById('app-logo-save')?.addEventListener('click', async () => {
    const light = document.getElementById('app-logo-light')?.value?.trim() || '';
    const dark  = document.getElementById('app-logo-dark')?.value?.trim()  || '';
    const btn = document.getElementById('app-logo-save');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
    try {
      // Salva no Firestore (global pra todos os usuários) — service também
      // atualiza o cache em localStorage pra render imediato sem reload
      const { saveBranding } = await import('../services/branding.js');
      await saveBranding({ logoLight: light, logoDark: dark });
      toast.success('Logo salvo globalmente. Todos os usuários verão na próxima carga.');
      // Re-renderiza sidebar local imediatamente
      location.reload();
    } catch(e) {
      toast.error(e?.message || 'Erro ao salvar logo.');
      if (btn) { btn.disabled = false; btn.textContent = 'Salvar Logo'; }
    }
  });
  document.getElementById('app-logo-clear')?.addEventListener('click', async () => {
    if (!confirm('Remover os logos customizados (todos os usuários voltam pro padrão)?')) return;
    try {
      const { saveBranding } = await import('../services/branding.js');
      await saveBranding({ logoLight: '', logoDark: '' });
      location.reload();
    } catch(e) {
      toast.error(e?.message || 'Erro ao remover logo.');
    }
  });

  // Sandbox toggle (apenas master)
  document.getElementById('sandbox-toggle')?.addEventListener('change', async (e) => {
    const { setSandboxOn } = await import('../services/sandbox.js');
    const ok = setSandboxOn(e.target.checked);
    if (!ok) {
      e.target.checked = false;
      toast.error('Apenas diretoria pode ativar o modo teste.');
      return;
    }
    if (e.target.checked) {
      toast.warning('🧪 Modo teste ATIVADO. Banner aparecerá no topo. Recarregue se necessário.');
    } else {
      toast.success('Modo teste desativado.');
    }
  });
}

/* Color picker do avatar removido — cor do avatar agora é fixa
 * (definida pelo perfil/sistema, não mais editável pelo usuário). */


/* v4.53.4+ Cleanup do realtime subscriber ao sair da page */
export function destroyProfile() {
  teardownTasksAutoRefresh('profile');
}
