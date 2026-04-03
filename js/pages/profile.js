/**
 * PRIMETOUR — Profile Page (Etapa 3)
 * Edição de perfil do usuário logado
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import { updateUserProfile, changePassword } from '../auth/auth.js';
import { fetchTasks }    from '../services/tasks.js';
import { fetchProjects } from '../services/projects.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const AVATAR_COLORS = [
  '#D4A843','#38BDF8','#22C55E','#A78BFA',
  '#F97316','#EC4899','#06B6D4','#EF4444',
  '#6366F1','#14B8A6','#F59E0B','#84CC16',
  '#8B5CF6','#3B82F6','#10B981','#F43F5E',
];

function getInitials(name) {
  return (name||'?').split(' ').slice(0,2).map(w=>w[0]).join('').toUpperCase();
}

export async function renderProfile(container) {
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
        <div class="profile-avatar-wrapper">
          <div class="avatar" id="profile-avatar-big"
            style="width:80px; height:80px; font-size:1.75rem; background:${profile.avatarColor||'#3B82F6'};">
            ${getInitials(profile.name)}
          </div>
          <div class="profile-avatar-edit" id="avatar-color-btn" title="Trocar cor">✎</div>
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

        <!-- Color palette preference -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">Aparência</div>
            <div class="card-subtitle">Escolha a paleta de cores do sistema</div>
          </div>
          <div class="card-body">
            <div id="palette-chooser" style="display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px;">
              ${[
                { id:'midnight',  label:'Midnight Navy',  desc:'Azul escuro clássico',    colors:['#0A1628','#D4A843','#1E293B','#94A3B8'] },
                { id:'platinum',  label:'Platinum',        desc:'Claro e clean',           colors:['#F8FAFC','#6366F1','#E2E8F0','#334155'] },
                { id:'charcoal',  label:'Charcoal',        desc:'Cinza escuro elegante',   colors:['#1A1A2E','#E94560','#16213E','#A0AEC0'] },
                { id:'ocean',     label:'Ocean Blue',      desc:'Azul oceano profundo',    colors:['#0B1929','#00BCD4','#132F4C','#B0BEC5'] },
                { id:'forest',    label:'Forest Green',    desc:'Verde floresta natural',   colors:['#0D1F0D','#4CAF50','#1B3A1B','#A5D6A7'] },
                { id:'royal',     label:'Royal Purple',    desc:'Roxo real sofisticado',    colors:['#1A0A2E','#9C27B0','#2D1B4E','#CE93D8'] },
                { id:'sunset',    label:'Warm Sunset',     desc:'Laranja quente e acolhedor', colors:['#1A0F0A','#FF6B35','#2D1810','#FFAB91'] },
                { id:'rose',      label:'Rose',            desc:'Rosa vibrante e moderno',  colors:['#1A0A14','#E91E63','#2D1520','#F48FB1'] },
                { id:'sand',      label:'Sand',            desc:'Claro com tons quentes',   colors:['#FAF6F1','#8B6914','#E8E0D4','#5D4E37'] },
              ].map(p => {
                const active = (profile.prefs?.palette || localStorage.getItem('primetour-palette') || 'midnight') === p.id;
                return \`
                  <div class="palette-card \${active ? 'selected' : ''}" data-palette-id="\${p.id}"
                    style="padding:14px; border-radius:var(--radius-md);
                    border:2px solid \${active ? 'var(--brand-gold)' : 'var(--border-subtle)'};
                    background:var(--bg-surface); cursor:pointer; transition:all 0.2s;">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
                      <div style="display:flex; gap:4px;">
                        \${p.colors.map(c => \`<span style="width:18px;height:18px;border-radius:50%;
                          background:\${c};border:1px solid rgba(128,128,128,0.3);display:inline-block;"></span>\`).join('')}
                      </div>
                      \${active ? '<span style="margin-left:auto;color:var(--brand-gold);font-weight:700;">✓</span>' : ''}
                    </div>
                    <div style="font-size:0.875rem; font-weight:600; color:var(--text-primary);">\${p.label}</div>
                    <div style="font-size:0.75rem; color:var(--text-muted); margin-top:2px;">\${p.desc}</div>
                  </div>
                \`;
              }).join('')}
            </div>
            <div style="display:flex; justify-content:flex-end; margin-top:16px;">
              <button class="btn btn-primary btn-sm" id="prefs-save-btn">Salvar preferências</button>
            </div>
          </div>
        </div>
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
  let _selectedPalette = profile.prefs?.palette || localStorage.getItem('primetour-palette') || 'midnight';
  document.querySelectorAll('#palette-chooser .palette-card').forEach(card => {
    card.addEventListener('click', () => {
      _selectedPalette = card.dataset.paletteId;
      // Apply immediately for live preview
      document.documentElement.dataset.palette = _selectedPalette;
      localStorage.setItem('primetour-palette', _selectedPalette);
      // Update selected state
      document.querySelectorAll('#palette-chooser .palette-card').forEach(c => {
        const isActive = c.dataset.paletteId === _selectedPalette;
        c.classList.toggle('selected', isActive);
        c.style.borderColor = isActive ? 'var(--brand-gold)' : 'var(--border-subtle)';
        const check = c.querySelector('span[style*="margin-left:auto"]');
        if (isActive && !check) {
          const firstRow = c.querySelector('div');
          const s = document.createElement('span');
          s.style.cssText = 'margin-left:auto;color:var(--brand-gold);font-weight:700;';
          s.textContent = '✓';
          firstRow.appendChild(s);
        } else if (!isActive && check) {
          check.remove();
        }
      });
    });
  });

  // Save preferences (notifications + palette)
  document.getElementById('prefs-save-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('prefs-save-btn');
    if(btn) { btn.classList.add('loading'); btn.disabled=true; }
    try {
      await updateUserProfile(store.get('currentUser').uid, {
        prefs: {
          notifyAssign:   document.getElementById('pref-notify-assign')?.checked ?? true,
          notifyMention:  document.getElementById('pref-notify-mention')?.checked ?? true,
          notifyDeadline: document.getElementById('pref-notify-deadline')?.checked ?? true,
          notifySound:    document.getElementById('pref-notify-sound')?.checked ?? true,
          palette:        _selectedPalette,
        }
      });
      toast.success('Preferências salvas!');
    } catch(e) { toast.error(e.message); }
    finally { if(btn) { btn.classList.remove('loading'); btn.disabled=false; } }
  });

  // Avatar color picker
  document.getElementById('avatar-color-btn')?.addEventListener('click', () => {
    openColorPicker(profile);
  });
}

/* ─── Color picker modal ─────────────────────────────────── */
function openColorPicker(profile) {
  let selectedColor = profile.avatarColor || '#3B82F6';

  modal.open({
    title: 'Escolher cor do avatar',
    size:  'sm',
    content: `
      <p class="text-sm text-muted mb-4">Escolha uma cor para seu avatar:</p>
      <div class="color-swatch-grid" id="color-swatch-grid">
        ${AVATAR_COLORS.map(c => `
          <div class="color-swatch ${c===selectedColor?'selected':''}"
            data-color="${c}" style="background:${c};"
            title="${c}">
          </div>
        `).join('')}
      </div>
      <div style="margin-top:20px; display:flex; align-items:center; gap:12px;">
        <div id="color-preview" style="
          width:48px; height:48px; border-radius:50%;
          background:${selectedColor};
          display:flex; align-items:center; justify-content:center;
          font-size:1.25rem; font-weight:700; color:white;
        ">${getInitials(profile.name)}</div>
        <span style="font-size:0.875rem; color:var(--text-secondary);">Prévia do avatar</span>
      </div>
    `,
    footer: [
      { label:'Cancelar', class:'btn-secondary', closeOnClick:true },
      {
        label:'Salvar cor', class:'btn-primary', closeOnClick:false,
        onClick: async (_, { close }) => {
          const btn = document.querySelector('.modal-footer .btn-primary');
          if(btn){ btn.classList.add('loading'); btn.disabled=true; }
          try {
            await updateUserProfile(store.get('currentUser').uid, { avatarColor: selectedColor });
            // Update all avatars on screen
            document.querySelectorAll('.avatar[style*="background"]').forEach(el => {
              if (el.textContent.trim() === getInitials(profile.name)) {
                el.style.background = selectedColor;
              }
            });
            document.getElementById('profile-avatar-big').style.background = selectedColor;
            toast.success('Cor do avatar atualizada!');
            close();
          } catch(e) { toast.error(e.message); }
          finally { if(btn){ btn.classList.remove('loading'); btn.disabled=false; } }
        }
      }
    ],
    onOpen: () => {
      setTimeout(() => {
        document.querySelectorAll('#color-swatch-grid [data-color]').forEach(el => {
          el.addEventListener('click', () => {
            selectedColor = el.dataset.color;
            document.querySelectorAll('#color-swatch-grid [data-color]').forEach(e => {
              e.classList.toggle('selected', e.dataset.color === selectedColor);
            });
            const preview = document.getElementById('color-preview');
            if(preview) preview.style.background = selectedColor;
          });
        });
      }, 60);
    },
  });
}
