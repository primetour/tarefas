/**
 * PRIMETOUR — IA Skills
 * Central de gestão de skills de inteligência artificial
 * Configuração de API, criação e edição de skills por módulo
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { modal }  from '../components/modal.js';
import {
  fetchSkills, createSkill, updateSkill, deleteSkill, getSkill,
  getAIConfig, saveAIConfig,
  fetchKnowledge, createKnowledgeDoc, updateKnowledgeDoc, deleteKnowledgeDoc,
  AI_PROVIDERS, AI_MODELS, MODULE_REGISTRY, OUTPUT_FORMATS, TRIGGER_TYPES,
  getModelsForProvider, runSkill,
} from '../services/ai.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let allSkills = [];
let allKnowledge = [];
let currentTab = 'skills'; // 'skills' | 'config' | 'knowledge' | 'logs'

/* ─── Render ─────────────────────────────────────────────── */
export async function renderAiSkills(container) {
  if (!store.can('system_manage_settings') && !store.isMaster()) {
    container.innerHTML = `<div class="empty-state" style="min-height:50vh;">
      <div class="empty-state-icon">◈</div>
      <div class="empty-state-title">Acesso restrito</div>
      <p class="empty-state-sub">Apenas administradores podem gerenciar skills de IA.</p>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">
          <span style="background:linear-gradient(135deg,var(--brand-gold),#F59E0B);-webkit-background-clip:text;
            -webkit-text-fill-color:transparent;font-weight:700;">◈ IA Skills</span>
        </h1>
        <p class="page-subtitle">Configure inteligência artificial nos módulos do sistema</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary" id="new-skill-btn">+ Nova Skill</button>
      </div>
    </div>

    <!-- Tabs -->
    <div class="ai-tabs" style="display:flex;gap:0;border-bottom:1px solid var(--border-subtle);margin-bottom:24px;">
      <button class="ai-tab active" data-tab="skills" style="padding:10px 20px;background:none;border:none;
        border-bottom:2px solid var(--brand-gold);color:var(--text-primary);font-weight:600;cursor:pointer;
        font-size:0.875rem;">Skills</button>
      <button class="ai-tab" data-tab="config" style="padding:10px 20px;background:none;border:none;
        border-bottom:2px solid transparent;color:var(--text-muted);font-weight:500;cursor:pointer;
        font-size:0.875rem;">Configurar API</button>
      <button class="ai-tab" data-tab="knowledge" style="padding:10px 20px;background:none;border:none;
        border-bottom:2px solid transparent;color:var(--text-muted);font-weight:500;cursor:pointer;
        font-size:0.875rem;">Base de Conhecimento</button>
      <button class="ai-tab" data-tab="logs" style="padding:10px 20px;background:none;border:none;
        border-bottom:2px solid transparent;color:var(--text-muted);font-weight:500;cursor:pointer;
        font-size:0.875rem;">Uso e Logs</button>
    </div>

    <!-- Tab content -->
    <div id="ai-tab-content"></div>
  `;

  // Tab switching
  container.querySelectorAll('.ai-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.ai-tab').forEach(t => {
        t.style.borderBottomColor = 'transparent';
        t.style.color = 'var(--text-muted)';
        t.style.fontWeight = '500';
        t.classList.remove('active');
      });
      btn.style.borderBottomColor = 'var(--brand-gold)';
      btn.style.color = 'var(--text-primary)';
      btn.style.fontWeight = '600';
      btn.classList.add('active');
      currentTab = btn.dataset.tab;
      renderTab();
    });
  });

  document.getElementById('new-skill-btn')?.addEventListener('click', () => openSkillModal());

  await loadAll();
}

async function loadAll() {
  [allSkills, allKnowledge] = await Promise.all([fetchSkills(), fetchKnowledge()]);
  renderTab();
}

function renderTab() {
  const el = document.getElementById('ai-tab-content');
  if (!el) return;
  if (currentTab === 'config')    return renderConfigTab(el);
  if (currentTab === 'knowledge') return renderKnowledgeTab(el);
  if (currentTab === 'logs')      return renderLogsTab(el);
  renderSkillsTab(el);
}

/* ═══════════════════════════════════════════════════════════ *
 *  TAB: Skills list                                          *
 * ═══════════════════════════════════════════════════════════ */
function renderSkillsTab(el) {
  if (!allSkills.length) {
    el.innerHTML = `<div class="empty-state" style="min-height:35vh;">
      <div class="empty-state-icon">◈</div>
      <div class="empty-state-title">Nenhuma skill cadastrada</div>
      <p class="empty-state-sub">Crie sua primeira skill de IA para começar a usar inteligência artificial nos módulos.</p>
    </div>`;
    return;
  }

  // Group by module
  const grouped = {};
  for (const s of allSkills) {
    const mod = s.module || 'general';
    if (!grouped[mod]) grouped[mod] = [];
    grouped[mod].push(s);
  }

  el.innerHTML = Object.entries(grouped).map(([mod, skills]) => {
    const reg = MODULE_REGISTRY[mod] || { label: mod, icon: '◈' };
    return `
      <div style="margin-bottom:28px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <span style="font-size:1.125rem;">${reg.icon}</span>
          <span style="font-weight:600;color:var(--text-primary);font-size:0.9375rem;">${esc(reg.label)}</span>
          <span style="font-size:0.75rem;color:var(--text-muted);background:var(--bg-surface);
            padding:2px 8px;border-radius:10px;">${skills.length}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;">
          ${skills.map(s => renderSkillCard(s)).join('')}
        </div>
      </div>
    `;
  }).join('');

  // Bind card actions
  el.querySelectorAll('.skill-edit-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const s = await getSkill(btn.dataset.id);
      if (s) openSkillModal(s);
    });
  });
  el.querySelectorAll('.skill-test-btn').forEach(btn => {
    btn.addEventListener('click', () => openTestModal(btn.dataset.id));
  });
  el.querySelectorAll('.skill-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const s = allSkills.find(x => x.id === btn.dataset.id);
      if (!s) return;
      await updateSkill(s.id, { active: !s.active });
      toast.success(s.active ? 'Skill desativada' : 'Skill ativada');
      await loadAll();
    });
  });
  el.querySelectorAll('.skill-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await modal.confirm({ title: 'Excluir skill', message: 'Tem certeza? Esta ação não pode ser desfeita.', danger: true });
      if (!ok) return;
      await deleteSkill(btn.dataset.id);
      toast.success('Skill excluída');
      await loadAll();
    });
  });
}

function renderSkillCard(s) {
  const reg = MODULE_REGISTRY[s.module] || { label: s.module, icon: '◈' };
  const prov = AI_PROVIDERS.find(p => p.id === s.provider) || AI_PROVIDERS[0];
  const modelList = AI_MODELS[s.provider] || [];
  const modelInfo = modelList.find(m => m.id === s.model);

  return `
    <div class="card" style="padding:16px;position:relative;border-left:3px solid ${s.active ? 'var(--brand-gold)' : 'var(--border-subtle)'};">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
        <div style="font-weight:600;color:var(--text-primary);font-size:0.9375rem;">${esc(s.name)}</div>
        <div style="display:flex;gap:4px;">
          <button class="skill-test-btn" data-id="${s.id}" title="Testar"
            style="background:none;border:none;cursor:pointer;font-size:0.8125rem;color:var(--brand-gold);padding:2px 6px;">▶</button>
          <button class="skill-edit-btn" data-id="${s.id}" title="Editar"
            style="background:none;border:none;cursor:pointer;font-size:0.8125rem;color:var(--text-muted);padding:2px 6px;">✎</button>
          <button class="skill-toggle-btn" data-id="${s.id}" title="${s.active ? 'Desativar' : 'Ativar'}"
            style="background:none;border:none;cursor:pointer;font-size:0.8125rem;color:${s.active ? 'var(--success)' : 'var(--text-muted)'};padding:2px 6px;">●</button>
          <button class="skill-delete-btn" data-id="${s.id}" title="Excluir"
            style="background:none;border:none;cursor:pointer;font-size:0.8125rem;color:var(--text-muted);padding:2px 6px;">✕</button>
        </div>
      </div>
      ${s.description ? `<div style="font-size:0.8125rem;color:var(--text-secondary);margin-bottom:10px;line-height:1.5;">${esc(s.description)}</div>` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:0.75rem;">
        <span style="background:var(--bg-surface);padding:2px 8px;border-radius:4px;color:var(--text-muted);">${esc(prov.label)}</span>
        ${modelInfo ? `<span style="background:var(--bg-surface);padding:2px 8px;border-radius:4px;color:var(--text-muted);">${esc(modelInfo.label)}</span>` : ''}
        <span style="background:var(--bg-surface);padding:2px 8px;border-radius:4px;color:var(--text-muted);">${s.outputFormat || 'text'}</span>
        ${s.voiceTone ? `<span style="background:var(--bg-surface);padding:2px 8px;border-radius:4px;color:var(--text-muted);">🎯 ${esc(s.voiceTone)}</span>` : ''}
        ${!s.active ? `<span style="background:var(--danger-bg,#3a1a1a);padding:2px 8px;border-radius:4px;color:var(--danger,#ef4444);">Inativa</span>` : ''}
      </div>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════ *
 *  TAB: Configurar API                                       *
 * ═══════════════════════════════════════════════════════════ */
async function renderConfigTab(el) {
  el.innerHTML = `<div class="card skeleton" style="height:200px;"></div>`;
  const config = await getAIConfig() || {};

  el.innerHTML = `
    <div style="max-width:720px;">
      <div class="card" style="padding:24px;margin-bottom:20px;">
        <div style="font-weight:600;font-size:1rem;color:var(--text-primary);margin-bottom:4px;">Configuração de Providers</div>
        <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:20px;">
          Configure as API Keys dos providers que deseja usar. Providers gratuitos permitem testar imediatamente.
        </p>

        ${AI_PROVIDERS.map(p => `
          <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:16px;margin-bottom:12px;
            ${config[p.id + 'ApiKey'] ? 'border-left:3px solid var(--success);' : ''}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
              <span style="font-size:1rem;">${p.icon}</span>
              <span style="font-weight:600;color:var(--text-primary);">${esc(p.label)}</span>
              ${p.free ? `<span style="background:var(--success-bg,#1a3a1a);color:var(--success,#22c55e);
                font-size:0.6875rem;padding:2px 8px;border-radius:10px;font-weight:600;">GRÁTIS</span>` : ''}
              ${config[p.id + 'ApiKey'] ? `<span style="color:var(--success);font-size:0.75rem;margin-left:auto;">● Configurada</span>` : ''}
            </div>
            ${p.signupUrl ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:8px;">
              Obtenha sua key gratuita em: <a href="${p.signupUrl}" target="_blank" rel="noopener"
              style="color:var(--brand-gold);text-decoration:underline;">${p.signupUrl}</a>
            </div>` : ''}
            <div class="form-group" style="margin-bottom:${p.id === 'azure' ? '8' : '0'}px;">
              <label class="form-label" style="font-size:0.8125rem;">API Key</label>
              <input type="password" class="form-input ai-cfg-key" data-provider="${p.id}"
                value="${config[p.id + 'ApiKey'] ? '••••••••••••••••' : ''}"
                placeholder="Cole sua API Key aqui"
                style="font-family:monospace;font-size:0.8125rem;" />
            </div>
            ${p.id === 'azure' ? `
              <div class="form-group" style="margin-bottom:0;">
                <label class="form-label" style="font-size:0.8125rem;">Endpoint Azure</label>
                <input type="text" class="form-input" id="ai-cfg-azure-endpoint"
                  value="${esc(config.azureEndpoint || '')}"
                  placeholder="https://seu-recurso.openai.azure.com"
                  style="font-family:monospace;font-size:0.8125rem;" />
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>

      <div class="card" style="padding:24px;margin-bottom:20px;">
        <div style="font-weight:600;font-size:1rem;color:var(--text-primary);margin-bottom:4px;">Padrões globais</div>
        <p style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:16px;">
          Valores padrão usados quando a skill não define explicitamente.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group" style="margin:0;">
            <label class="form-label" style="font-size:0.8125rem;">Provider padrão</label>
            <select class="form-select" id="ai-cfg-provider" style="font-size:0.8125rem;">
              ${AI_PROVIDERS.map(p => `<option value="${p.id}" ${config.provider === p.id ? 'selected' : ''}>${p.label}</option>`).join('')}
            </select>
          </div>
          <div class="form-group" style="margin:0;">
            <label class="form-label" style="font-size:0.8125rem;">Max tokens padrão</label>
            <input type="number" class="form-input" id="ai-cfg-max-tokens"
              value="${config.defaultMaxTokens || 1024}" min="100" max="16000"
              style="font-size:0.8125rem;" />
          </div>
        </div>
      </div>

      <button class="btn btn-primary" id="ai-cfg-save" style="width:100%;">Salvar configurações</button>
    </div>
  `;

  document.getElementById('ai-cfg-save')?.addEventListener('click', async () => {
    const data = {
      provider:         document.getElementById('ai-cfg-provider')?.value || 'gemini',
      defaultMaxTokens: parseInt(document.getElementById('ai-cfg-max-tokens')?.value) || 1024,
      azureEndpoint:    document.getElementById('ai-cfg-azure-endpoint')?.value?.trim() || '',
    };

    // Coletar API keys (só salva se o campo foi alterado — não salvar bullets)
    document.querySelectorAll('.ai-cfg-key').forEach(input => {
      const pid = input.dataset.provider;
      const val = input.value.trim();
      if (val && !val.startsWith('••')) {
        data[pid + 'ApiKey'] = val;
      }
    });

    try {
      await saveAIConfig(data);
      toast.success('Configurações salvas!');
    } catch (e) {
      toast.error('Erro ao salvar: ' + e.message);
    }
  });
}

/* ═══════════════════════════════════════════════════════════ *
 *  TAB: Base de Conhecimento                                  *
 * ═══════════════════════════════════════════════════════════ */
function renderKnowledgeTab(el) {
  const totalChars = allKnowledge.reduce((s, d) => s + (d.charCount || d.content?.length || 0), 0);
  const totalTokensEst = Math.round(totalChars / 4); // ~4 chars per token

  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
      <div>
        <span style="font-size:0.8125rem;color:var(--text-muted);">
          ${allKnowledge.length} documento${allKnowledge.length !== 1 ? 's' : ''} ·
          ~${totalTokensEst.toLocaleString('pt-BR')} tokens estimados
        </span>
      </div>
      <button class="btn btn-primary" id="new-knowledge-btn">+ Novo Documento</button>
    </div>

    ${!allKnowledge.length ? `
      <div class="empty-state" style="min-height:30vh;">
        <div class="empty-state-icon">📚</div>
        <div class="empty-state-title">Nenhum documento na base</div>
        <p class="empty-state-sub">Adicione documentos (manuais, guias, textos) para que as skills de IA possam consultá-los como referência.</p>
      </div>
    ` : `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px;">
        ${allKnowledge.map(d => renderKnowledgeCard(d)).join('')}
      </div>
    `}
  `;

  document.getElementById('new-knowledge-btn')?.addEventListener('click', () => openKnowledgeModal());

  el.querySelectorAll('.kb-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const d = allKnowledge.find(x => x.id === btn.dataset.id);
      if (d) openKnowledgeModal(d);
    });
  });
  el.querySelectorAll('.kb-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ok = await modal.confirm({ title: 'Excluir documento', message: 'Tem certeza? Skills que referenciam este documento perderão o acesso.', danger: true });
      if (!ok) return;
      await deleteKnowledgeDoc(btn.dataset.id);
      toast.success('Documento excluído');
      await loadAll();
    });
  });
}

function renderKnowledgeCard(d) {
  const chars = d.charCount || d.content?.length || 0;
  const tokens = Math.round(chars / 4);
  const preview = (d.content || '').substring(0, 120).replace(/\n/g, ' ');
  const ts = d.updatedAt?.toDate ? d.updatedAt.toDate() : d.createdAt?.toDate ? d.createdAt.toDate() : null;
  const date = ts ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(ts) : '';

  // Count how many skills reference this doc
  const usedBy = allSkills.filter(s => s.knowledgeIds?.includes(d.id)).length;

  return `
    <div class="card" style="padding:16px;border-left:3px solid var(--brand-gold);">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px;">
        <div style="font-weight:600;color:var(--text-primary);font-size:0.9375rem;">📄 ${esc(d.title)}</div>
        <div style="display:flex;gap:4px;">
          <button class="kb-edit-btn" data-id="${d.id}" title="Editar"
            style="background:none;border:none;cursor:pointer;font-size:0.8125rem;color:var(--text-muted);padding:2px 6px;">✎</button>
          <button class="kb-delete-btn" data-id="${d.id}" title="Excluir"
            style="background:none;border:none;cursor:pointer;font-size:0.8125rem;color:var(--text-muted);padding:2px 6px;">✕</button>
        </div>
      </div>
      ${preview ? `<div style="font-size:0.8125rem;color:var(--text-secondary);margin-bottom:8px;line-height:1.5;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(preview)}...</div>` : ''}
      <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:0.75rem;">
        <span style="background:var(--bg-surface);padding:2px 8px;border-radius:4px;color:var(--text-muted);">
          ${chars.toLocaleString('pt-BR')} chars · ~${tokens.toLocaleString('pt-BR')} tokens
        </span>
        ${d.tags?.length ? d.tags.map(t => `<span style="background:var(--bg-surface);padding:2px 8px;border-radius:4px;color:var(--brand-gold);">${esc(t)}</span>`).join('') : ''}
        ${usedBy > 0 ? `<span style="background:rgba(34,197,94,0.1);padding:2px 8px;border-radius:4px;color:var(--success,#22c55e);">
          Usado por ${usedBy} skill${usedBy > 1 ? 's' : ''}
        </span>` : `<span style="background:var(--bg-surface);padding:2px 8px;border-radius:4px;color:var(--text-muted);">Não vinculado</span>`}
        ${date ? `<span style="background:var(--bg-surface);padding:2px 8px;border-radius:4px;color:var(--text-muted);">${date}</span>` : ''}
      </div>
    </div>
  `;
}

function openKnowledgeModal(doc = null) {
  const isEdit = !!doc;

  modal.open({
    title: isEdit ? 'Editar Documento' : 'Novo Documento de Conhecimento',
    size: 'lg',
    content: `
      <div style="display:flex;flex-direction:column;gap:14px;max-height:70vh;overflow-y:auto;padding:4px;">
        <div class="form-group" style="margin:0;">
          <label class="form-label">Título *</label>
          <input type="text" class="form-input" id="kb-title" value="${esc(doc?.title || '')}"
            placeholder="Ex: Manual de Tom de Voz, Guia de Destinos, FAQ Interno" />
        </div>

        <div class="form-group" style="margin:0;">
          <label class="form-label">Conteúdo *
            <span class="info-tip" title="Cole aqui o texto completo do documento. Pode ser um manual, guia, FAQ, regras, etc. Quanto mais contexto, melhor a IA responde.">ℹ</span>
          </label>
          <textarea class="form-textarea" id="kb-content" rows="14"
            placeholder="Cole aqui o conteúdo do documento...&#10;&#10;Pode ser texto de um manual, guia, FAQ, regras internas, etc.&#10;O conteúdo será usado como referência pelas skills de IA."
            style="font-family:monospace;font-size:0.8125rem;line-height:1.6;">${esc(doc?.content || '')}</textarea>
          <div id="kb-char-count" style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;text-align:right;">
            ${(doc?.content || '').length} caracteres · ~${Math.round((doc?.content || '').length / 4)} tokens
          </div>
        </div>

        <div class="form-group" style="margin:0;">
          <label class="form-label">Tags (separar por vírgula)</label>
          <input type="text" class="form-input" id="kb-tags" value="${esc((doc?.tags || []).join(', '))}"
            placeholder="tom-de-voz, redação, destinos" />
        </div>

        <div class="form-group" style="margin:0;">
          <label class="form-label">URL de referência (opcional)</label>
          <input type="text" class="form-input" id="kb-source-url" value="${esc(doc?.sourceUrl || '')}"
            placeholder="Link para o documento original, se houver" />
        </div>
      </div>
    `,
    footer: [
      { label: 'Cancelar', class: 'btn-secondary' },
      { label: isEdit ? 'Salvar' : 'Criar Documento', class: 'btn-primary', onClick: async (e, { close }) => {
        const title   = document.getElementById('kb-title')?.value?.trim();
        const content = document.getElementById('kb-content')?.value?.trim();
        if (!title) { toast.error('Título é obrigatório'); return; }
        if (!content) { toast.error('Conteúdo é obrigatório'); return; }

        const tags      = (document.getElementById('kb-tags')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
        const sourceUrl = document.getElementById('kb-source-url')?.value?.trim() || '';

        try {
          if (isEdit) {
            await updateKnowledgeDoc(doc.id, { title, content, tags, sourceUrl });
            toast.success('Documento atualizado!');
          } else {
            await createKnowledgeDoc({ title, content, type: 'text', tags, sourceUrl });
            toast.success('Documento criado!');
          }
          close();
          await loadAll();
        } catch (err) {
          toast.error('Erro: ' + err.message);
        }
      }},
    ],
    onOpen: () => {
      // Live char/token counter
      document.getElementById('kb-content')?.addEventListener('input', (e) => {
        const len = e.target.value.length;
        const counter = document.getElementById('kb-char-count');
        if (counter) counter.textContent = `${len.toLocaleString('pt-BR')} caracteres · ~${Math.round(len / 4).toLocaleString('pt-BR')} tokens`;
      });
    },
  });
}

/* ═══════════════════════════════════════════════════════════ *
 *  TAB: Uso e Logs                                           *
 * ═══════════════════════════════════════════════════════════ */
async function renderLogsTab(el) {
  el.innerHTML = `<div class="card skeleton" style="height:200px;"></div>`;

  // Fetch last 50 usage logs
  const { getDocs: gd, query: q, collection: col, orderBy: ob, limit: lim }
    = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  const { db: fbdb } = await import('../firebase.js');

  let logs = [];
  try {
    const snap = await gd(q(col(fbdb, 'ai_usage_logs'), ob('timestamp', 'desc'), lim(50)));
    logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { logs = []; }

  if (!logs.length) {
    el.innerHTML = `<div class="empty-state" style="min-height:30vh;">
      <div class="empty-state-icon">◌</div>
      <div class="empty-state-title">Nenhum uso registrado</div>
      <p class="empty-state-sub">Os logs aparecerão aqui quando skills forem executadas.</p>
    </div>`;
    return;
  }

  // Stats summary
  const totalIn  = logs.reduce((s, l) => s + (l.inputTokens || 0), 0);
  const totalOut = logs.reduce((s, l) => s + (l.outputTokens || 0), 0);

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px;">
      <div class="card" style="padding:16px;text-align:center;">
        <div style="font-size:1.5rem;font-weight:700;color:var(--brand-gold);">${logs.length}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">Chamadas recentes</div>
      </div>
      <div class="card" style="padding:16px;text-align:center;">
        <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">${(totalIn + totalOut).toLocaleString('pt-BR')}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">Tokens totais</div>
      </div>
      <div class="card" style="padding:16px;text-align:center;">
        <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">${totalIn.toLocaleString('pt-BR')}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">Tokens input</div>
      </div>
      <div class="card" style="padding:16px;text-align:center;">
        <div style="font-size:1.5rem;font-weight:700;color:var(--text-primary);">${totalOut.toLocaleString('pt-BR')}</div>
        <div style="font-size:0.75rem;color:var(--text-muted);">Tokens output</div>
      </div>
    </div>

    <div class="card" style="padding:0;overflow:hidden;">
      <table style="width:100%;border-collapse:collapse;font-size:0.8125rem;">
        <thead>
          <tr style="background:var(--bg-surface);color:var(--text-muted);text-align:left;">
            <th style="padding:10px 14px;">Skill</th>
            <th style="padding:10px 14px;">Módulo</th>
            <th style="padding:10px 14px;">Provider</th>
            <th style="padding:10px 14px;">Modelo</th>
            <th style="padding:10px 14px;text-align:right;">Tokens</th>
            <th style="padding:10px 14px;">Data</th>
          </tr>
        </thead>
        <tbody>
          ${logs.map(l => {
            const ts = l.timestamp?.toDate ? l.timestamp.toDate() : null;
            const date = ts ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(ts) : '—';
            const modReg = MODULE_REGISTRY[l.module] || {};
            return `<tr style="border-top:1px solid var(--border-subtle);">
              <td style="padding:8px 14px;color:var(--text-primary);font-weight:500;">${esc(l.skillName || '—')}</td>
              <td style="padding:8px 14px;color:var(--text-secondary);">${modReg.icon || ''} ${esc(modReg.label || l.module || '—')}</td>
              <td style="padding:8px 14px;color:var(--text-secondary);">${esc(l.provider || '—')}</td>
              <td style="padding:8px 14px;color:var(--text-muted);font-family:monospace;font-size:0.75rem;">${esc(l.model || '—')}</td>
              <td style="padding:8px 14px;text-align:right;color:var(--text-secondary);">${((l.inputTokens||0)+(l.outputTokens||0)).toLocaleString('pt-BR')}</td>
              <td style="padding:8px 14px;color:var(--text-muted);">${date}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* ═══════════════════════════════════════════════════════════ *
 *  Modal: Criar / Editar Skill                               *
 * ═══════════════════════════════════════════════════════════ */
function openSkillModal(skill = null) {
  const isEdit = !!skill;
  const provider = skill?.provider || 'gemini';
  const models = getModelsForProvider(provider);

  modal.open({
    title: isEdit ? 'Editar Skill' : 'Nova Skill de IA',
    size: 'lg',
    content: buildSkillForm(skill),
    footer: [
      { label: 'Cancelar', class: 'btn-secondary' },
      { label: isEdit ? 'Salvar' : 'Criar Skill', class: 'btn-primary', onClick: async (e, { close }) => {
        try {
          const data = collectSkillForm();
          if (!data.name) { toast.error('Nome é obrigatório'); return; }
          if (!data.module) { toast.error('Selecione um módulo'); return; }
          if (!data.systemPrompt && !data.userPromptTemplate) { toast.error('Preencha ao menos o System Prompt ou Template do Prompt'); return; }

          if (isEdit) {
            await updateSkill(skill.id, data);
            toast.success('Skill atualizada!');
          } else {
            await createSkill(data);
            toast.success('Skill criada!');
          }
          close();
          await loadAll();
        } catch (err) {
          toast.error('Erro: ' + err.message);
        }
      }},
    ],
    onOpen: () => bindSkillFormEvents(),
  });
}

function buildSkillForm(s = null) {
  const moduleOptions = Object.entries(MODULE_REGISTRY)
    .map(([id, m]) => `<option value="${id}" ${s?.module === id ? 'selected' : ''}>${m.icon} ${m.label}</option>`)
    .join('');

  const providerOptions = AI_PROVIDERS
    .map(p => `<option value="${p.id}" ${(s?.provider || 'gemini') === p.id ? 'selected' : ''}>${p.label}${p.free ? ' (grátis)' : ''}</option>`)
    .join('');

  const currentProvider = s?.provider || 'gemini';
  const modelOptions = getModelsForProvider(currentProvider)
    .map(m => `<option value="${m.id}" ${s?.model === m.id ? 'selected' : ''}>${m.label} — ${m.desc}</option>`)
    .join('');

  const outputOptions = OUTPUT_FORMATS
    .map(f => `<option value="${f.id}" ${(s?.outputFormat || 'text') === f.id ? 'selected' : ''}>${f.label}</option>`)
    .join('');

  const triggerOptions = TRIGGER_TYPES
    .map(t => `<option value="${t.id}" ${(s?.trigger || 'button') === t.id ? 'selected' : ''}>${t.label}</option>`)
    .join('');

  // Context fields for selected module
  const modFields = s?.module ? (MODULE_REGISTRY[s.module]?.contextFields || []) : [];

  return `
    <div style="display:flex;flex-direction:column;gap:16px;max-height:70vh;overflow-y:auto;padding:4px;">
      <!-- Identificação -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group" style="margin:0;">
          <label class="form-label">Nome da Skill *</label>
          <input type="text" class="form-input" id="sk-name" value="${esc(s?.name || '')}"
            placeholder="Ex: Sugerir texto para dica" />
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label">Módulo *</label>
          <select class="form-select" id="sk-module">
            <option value="">Selecione...</option>
            ${moduleOptions}
          </select>
        </div>
      </div>

      <div class="form-group" style="margin:0;">
        <label class="form-label">Descrição</label>
        <input type="text" class="form-input" id="sk-description" value="${esc(s?.description || '')}"
          placeholder="Breve descrição do que esta skill faz" />
      </div>

      <!-- Provider & Model -->
      <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:14px;">
        <div style="font-weight:600;font-size:0.8125rem;color:var(--text-muted);margin-bottom:10px;">PROVIDER E MODELO</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div class="form-group" style="margin:0;">
            <label class="form-label">Provider</label>
            <select class="form-select" id="sk-provider">
              ${providerOptions}
            </select>
          </div>
          <div class="form-group" style="margin:0;">
            <label class="form-label">Modelo</label>
            <select class="form-select" id="sk-model">
              ${modelOptions}
            </select>
          </div>
        </div>
      </div>

      <!-- Prompt Engineering -->
      <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:14px;">
        <div style="font-weight:600;font-size:0.8125rem;color:var(--text-muted);margin-bottom:10px;">ENGENHARIA DE PROMPT</div>

        <div class="form-group" style="margin:0 0 12px 0;">
          <label class="form-label">System Prompt
            <span class="info-tip" title="Instruções gerais para a IA: persona, regras, tom de voz, limites. Este texto é enviado como contexto do sistema.">ℹ</span>
          </label>
          <textarea class="form-textarea" id="sk-system-prompt" rows="5"
            placeholder="Ex: Você é um redator profissional de turismo da Primetour. Escreva textos engajadores, informativos e com tom acolhedor."
            style="font-family:monospace;font-size:0.8125rem;line-height:1.6;">${esc(s?.systemPrompt || '')}</textarea>
        </div>

        <div class="form-group" style="margin:0 0 12px 0;">
          <label class="form-label">Template do Prompt (usuário)
            <span class="info-tip" title="Use {{campo}} para inserir dados do contexto do módulo. Ex: {{title}}, {{body}}, {{description}}">ℹ</span>
          </label>
          <textarea class="form-textarea" id="sk-user-prompt" rows="4"
            placeholder="Ex: Reescreva o texto abaixo mantendo as informações, mas com linguagem mais engajadora:&#10;&#10;{{body}}"
            style="font-family:monospace;font-size:0.8125rem;line-height:1.6;">${esc(s?.userPromptTemplate || '')}</textarea>
        </div>

        <div id="sk-context-hint" style="font-size:0.75rem;color:var(--text-muted);background:var(--bg-surface);
          padding:8px 12px;border-radius:6px;margin-bottom:12px;${modFields.length ? '' : 'display:none;'}">
          Variáveis disponíveis para este módulo: ${modFields.map(f => `<code style="background:var(--bg-dark);padding:1px 4px;border-radius:3px;">{{${f}}}</code>`).join(' ')}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
          <div class="form-group" style="margin:0;">
            <label class="form-label">Tom de voz</label>
            <input type="text" class="form-input" id="sk-voice-tone" value="${esc(s?.voiceTone || '')}"
              placeholder="profissional, acolhedor" />
          </div>
          <div class="form-group" style="margin:0;">
            <label class="form-label">Limite de caracteres</label>
            <input type="number" class="form-input" id="sk-char-limit" value="${s?.charLimit || ''}"
              placeholder="Ex: 500" min="0" />
          </div>
          <div class="form-group" style="margin:0;">
            <label class="form-label">Temperatura</label>
            <input type="number" class="form-input" id="sk-temperature" value="${s?.temperature ?? ''}"
              placeholder="0.0 a 1.0" min="0" max="1" step="0.1" />
          </div>
        </div>
      </div>

      <!-- Comportamento -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
        <div class="form-group" style="margin:0;">
          <label class="form-label">Formato de saída</label>
          <select class="form-select" id="sk-output-format">${outputOptions}</select>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label">Gatilho</label>
          <select class="form-select" id="sk-trigger">${triggerOptions}</select>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label">Max tokens</label>
          <input type="number" class="form-input" id="sk-max-tokens" value="${s?.maxTokens || ''}"
            placeholder="Padrão: 1024" min="100" max="16000" />
        </div>
      </div>

      <!-- Base de Conhecimento -->
      <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:14px;">
        <div style="font-weight:600;font-size:0.8125rem;color:var(--text-muted);margin-bottom:10px;">BASE DE CONHECIMENTO</div>
        <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:10px;">
          Selecione documentos que serão injetados como contexto quando esta skill for executada.
        </p>
        ${allKnowledge.length ? `
          <div id="sk-knowledge-list" style="display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto;">
            ${allKnowledge.map(d => {
              const checked = s?.knowledgeIds?.includes(d.id) ? 'checked' : '';
              const chars = d.charCount || d.content?.length || 0;
              return `<label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;
                cursor:pointer;background:var(--bg-surface);font-size:0.8125rem;">
                <input type="checkbox" class="sk-kb-check" value="${d.id}" ${checked} />
                <span style="flex:1;color:var(--text-primary);">📄 ${esc(d.title)}</span>
                <span style="font-size:0.6875rem;color:var(--text-muted);">~${Math.round(chars/4).toLocaleString('pt-BR')} tokens</span>
              </label>`;
            }).join('')}
          </div>
        ` : `<div style="font-size:0.8125rem;color:var(--text-muted);font-style:italic;">
          Nenhum documento disponível. Crie documentos na aba "Base de Conhecimento".
        </div>`}
      </div>

      <!-- Busca na Web (Gemini Grounding) -->
      <div style="border:1px solid var(--border-subtle);border-radius:8px;padding:14px;">
        <div style="font-weight:600;font-size:0.8125rem;color:var(--text-muted);margin-bottom:10px;">BUSCA NA WEB</div>
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
          <input type="checkbox" id="sk-web-search" ${s?.webSearch ? 'checked' : ''} />
          <div>
            <div style="font-size:0.875rem;color:var(--text-primary);">Habilitar Gemini Grounding</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">A IA pesquisa no Google antes de responder. Funciona apenas com provider Gemini. As fontes são citadas automaticamente.</div>
          </div>
        </label>
      </div>

      <!-- Fontes autorizadas -->
      <div class="form-group" style="margin:0;">
        <label class="form-label">Fontes autorizadas
          <span class="info-tip" title="Lista de fontes que a IA pode referenciar. Deixe vazio para não restringir.">ℹ</span>
        </label>
        <input type="text" class="form-input" id="sk-sources" value="${esc((s?.allowedSources || []).join(', '))}"
          placeholder="site-primetour.com.br, embratur.com.br (separar por vírgula)" />
      </div>

      <!-- Status -->
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;">
        <input type="checkbox" id="sk-active" ${s?.active !== false ? 'checked' : ''} />
        <span style="font-size:0.875rem;color:var(--text-primary);">Skill ativa</span>
      </label>
    </div>
  `;
}

function bindSkillFormEvents() {
  // Provider change → update model list
  document.getElementById('sk-provider')?.addEventListener('change', (e) => {
    const models = getModelsForProvider(e.target.value);
    const modelSelect = document.getElementById('sk-model');
    if (modelSelect) {
      modelSelect.innerHTML = models.map(m =>
        `<option value="${m.id}">${m.label} — ${m.desc}</option>`
      ).join('');
    }
  });

  // Module change → show context fields hint
  document.getElementById('sk-module')?.addEventListener('change', (e) => {
    const hint = document.getElementById('sk-context-hint');
    const fields = MODULE_REGISTRY[e.target.value]?.contextFields || [];
    if (hint) {
      if (fields.length) {
        hint.style.display = '';
        hint.innerHTML = `Variáveis disponíveis: ${fields.map(f =>
          `<code style="background:var(--bg-dark);padding:1px 4px;border-radius:3px;cursor:pointer;"
            onclick="document.getElementById('sk-user-prompt').value+=' {{${f}}}';document.getElementById('sk-user-prompt').focus();">{{${f}}}</code>`
        ).join(' ')}`;
      } else {
        hint.style.display = 'none';
      }
    }
  });
}

function collectSkillForm() {
  const charLimit = parseInt(document.getElementById('sk-char-limit')?.value);
  const temperature = parseFloat(document.getElementById('sk-temperature')?.value);
  const maxTokens = parseInt(document.getElementById('sk-max-tokens')?.value);
  const sources = document.getElementById('sk-sources')?.value?.trim();

  return {
    name:               document.getElementById('sk-name')?.value?.trim() || '',
    module:             document.getElementById('sk-module')?.value || '',
    description:        document.getElementById('sk-description')?.value?.trim() || '',
    provider:           document.getElementById('sk-provider')?.value || 'gemini',
    model:              document.getElementById('sk-model')?.value || '',
    systemPrompt:       document.getElementById('sk-system-prompt')?.value?.trim() || '',
    userPromptTemplate: document.getElementById('sk-user-prompt')?.value?.trim() || '',
    voiceTone:          document.getElementById('sk-voice-tone')?.value?.trim() || '',
    charLimit:          isNaN(charLimit) ? null : charLimit,
    temperature:        isNaN(temperature) ? null : temperature,
    maxTokens:          isNaN(maxTokens) ? null : maxTokens,
    outputFormat:       document.getElementById('sk-output-format')?.value || 'text',
    trigger:            document.getElementById('sk-trigger')?.value || 'button',
    allowedSources:     sources ? sources.split(',').map(s => s.trim()).filter(Boolean) : [],
    knowledgeIds:       [...document.querySelectorAll('.sk-kb-check:checked')].map(cb => cb.value),
    webSearch:          document.getElementById('sk-web-search')?.checked || false,
    active:             document.getElementById('sk-active')?.checked !== false,
  };
}

/* ═══════════════════════════════════════════════════════════ *
 *  Modal: Testar Skill                                       *
 * ═══════════════════════════════════════════════════════════ */
function openTestModal(skillId) {
  const skill = allSkills.find(s => s.id === skillId);
  if (!skill) return;

  const fields = MODULE_REGISTRY[skill.module]?.contextFields || ['input'];

  modal.open({
    title: `Testar: ${skill.name}`,
    size: 'lg',
    content: `
      <div style="display:flex;flex-direction:column;gap:14px;">
        <div style="font-size:0.8125rem;color:var(--text-muted);">
          Preencha os campos de contexto e clique em "Executar" para testar a skill.
        </div>
        ${fields.map(f => `
          <div class="form-group" style="margin:0;">
            <label class="form-label" style="font-size:0.8125rem;">{{${f}}}</label>
            <textarea class="form-textarea sk-test-field" data-field="${f}" rows="2"
              placeholder="Valor para {{${f}}}"
              style="font-size:0.8125rem;"></textarea>
          </div>
        `).join('')}
        <button class="btn btn-primary" id="sk-test-run" style="align-self:flex-start;">
          ▶ Executar skill
        </button>
        <div id="sk-test-result" style="display:none;border:1px solid var(--border-subtle);
          border-radius:8px;padding:16px;background:var(--bg-surface);
          font-size:0.875rem;line-height:1.7;white-space:pre-wrap;max-height:400px;overflow-y:auto;">
        </div>
        <div id="sk-test-meta" style="display:none;font-size:0.75rem;color:var(--text-muted);"></div>
      </div>
    `,
    footer: [{ label: 'Fechar', class: 'btn-secondary' }],
    onOpen: () => {
      document.getElementById('sk-test-run')?.addEventListener('click', async () => {
        const btn = document.getElementById('sk-test-run');
        const resultEl = document.getElementById('sk-test-result');
        const metaEl = document.getElementById('sk-test-meta');
        if (!btn || !resultEl) return;

        // Collect context
        const context = {};
        document.querySelectorAll('.sk-test-field').forEach(el => {
          context[el.dataset.field] = el.value;
        });

        btn.disabled = true;
        btn.textContent = 'Processando...';
        resultEl.style.display = 'block';
        resultEl.textContent = 'Aguardando resposta da IA...';
        resultEl.style.opacity = '0.5';

        try {
          const result = await runSkill(skillId, context);
          resultEl.style.opacity = '1';
          resultEl.textContent = result.text;
          if (metaEl) {
            metaEl.style.display = 'block';
            metaEl.textContent = `${result.isMock ? 'MOCK' : result.provider} · ${result.model} · ${result.inputTokens + result.outputTokens} tokens`;
          }
        } catch (err) {
          resultEl.style.opacity = '1';
          resultEl.style.color = 'var(--danger, #ef4444)';
          resultEl.textContent = 'Erro: ' + err.message;
        }

        btn.disabled = false;
        btn.textContent = '▶ Executar skill';
      });
    },
  });
}

export function destroyAiSkills() { /* cleanup if needed */ }
