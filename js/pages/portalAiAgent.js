/**
 * PRIMETOUR — Agente de IA (E2)
 * Hub central com 4 abas: Tom de Voz · Dicas · Newsletter · Redes Sociais
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import {
  BUS, loadBrandVoice, saveBrandVoice, loadAllBrandVoices,
  generateTravelTip, generateNewsletter, generateSocialPost, analyzeTipExpiry,
  callClaude,
} from '../services/aiService.js';
import {
  fetchTips, fetchDestinations, fetchAreas, saveTip, SEGMENTS,
} from '../services/portal.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let activeTab = 'voice';

/* ─── Entry point ─────────────────────────────────────────── */
export async function renderPortalAiAgent(container) {
  if (!store.canManagePortal()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">◑</div>
      <div class="empty-state-title">Acesso restrito</div>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Agente de IA</h1>
        <p class="page-subtitle">Geração e revisão de conteúdo com tom de voz da marca</p>
      </div>
    </div>

    <!-- Tab bar -->
    <div style="display:flex;gap:0;border-bottom:1px solid var(--border-subtle);
      margin-bottom:24px;overflow-x:auto;">
      ${[
        { id:'voice',     icon:'◈', label:'Tom de Voz'     },
        { id:'tips',      icon:'✈', label:'Dicas'          },
        { id:'newsletter',icon:'◌', label:'Newsletter'     },
        { id:'social',    icon:'◎', label:'Redes Sociais'  },
      ].map(t => `
        <button class="agent-tab" data-tab="${t.id}"
          style="padding:10px 18px;border:none;background:none;cursor:pointer;
          font-size:0.875rem;white-space:nowrap;transition:all .15s;
          border-bottom:2px solid ${activeTab===t.id?'var(--brand-gold)':'transparent'};
          color:${activeTab===t.id?'var(--brand-gold)':'var(--text-muted)'};">
          ${t.icon} ${t.label}
        </button>`).join('')}
    </div>

    <div id="agent-tab-content"></div>
  `;

  container.querySelectorAll('.agent-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      container.querySelectorAll('.agent-tab').forEach(b => {
        b.style.borderBottomColor = b.dataset.tab === activeTab ? 'var(--brand-gold)' : 'transparent';
        b.style.color             = b.dataset.tab === activeTab ? 'var(--brand-gold)' : 'var(--text-muted)';
      });
      renderTab(activeTab, container);
    });
  });

  await renderTab(activeTab, container);
}

async function renderTab(tab, container) {
  const content = document.getElementById('agent-tab-content');
  if (!content) return;
  content.innerHTML = `<div style="text-align:center;padding:40px;color:var(--text-muted);">
    <div class="spinner" style="width:28px;height:28px;border:3px solid var(--border-subtle);
      border-top-color:var(--brand-gold);border-radius:50%;animation:spin .8s linear infinite;
      margin:0 auto 10px;"></div>Carregando…</div>`;
  if (tab === 'voice')      await renderVoiceTab(content);
  if (tab === 'tips')       await renderTipsTab(content);
  if (tab === 'newsletter') await renderNewsletterTab(content);
  if (tab === 'social')     await renderSocialTab(content);
}

/* ═══════════════════════════════════════════════════════════
   TAB 1 — TOM DE VOZ
═══════════════════════════════════════════════════════════ */
async function renderVoiceTab(container) {
  const voices = await loadAllBrandVoices();
  let activeBu = BUS[0].id;

  const render = () => {
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:220px 1fr;gap:20px;min-height:500px;">

        <!-- BU list -->
        <div class="card" style="padding:0;overflow:hidden;align-self:start;">
          ${BUS.map(bu => `
            <button class="voice-bu-btn" data-bu="${bu.id}"
              style="display:block;width:100%;text-align:left;padding:12px 16px;border:none;
              background:${activeBu===bu.id?'var(--brand-gold)15':'transparent'};
              border-left:3px solid ${activeBu===bu.id?'var(--brand-gold)':'transparent'};
              cursor:pointer;font-size:0.875rem;transition:all .15s;
              color:${activeBu===bu.id?'var(--brand-gold)':'var(--text-secondary)'};
              font-weight:${activeBu===bu.id?'600':'400'};">
              ${esc(bu.name)}
              ${voices[bu.id] ? `<span style="float:right;font-size:0.625rem;padding:1px 5px;
                border-radius:10px;background:#22C55E20;color:#22C55E;">✓</span>` : ''}
            </button>`).join('')}
        </div>

        <!-- Editor -->
        <div class="card" style="padding:24px;display:flex;flex-direction:column;gap:16px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="flex:1;">
              <div style="font-size:1rem;font-weight:700;">
                ${BUS.find(b=>b.id===activeBu)?.name}</div>
              <div style="font-size:0.8125rem;color:var(--text-muted);">
                Tom de voz e diretrizes de marca para geração de conteúdo
              </div>
            </div>
            <button id="voice-save-btn" class="btn btn-primary btn-sm">Salvar</button>
          </div>

          <div style="font-size:0.8125rem;color:var(--text-muted);padding:10px 12px;
            background:var(--bg-surface);border-radius:var(--radius-sm);
            border-left:3px solid var(--brand-gold);">
            💡 Cole aqui o guia de marca desta BU. Este texto será injetado automaticamente
            em todas as gerações de conteúdo como diretriz de tom e linguagem.
          </div>

          <textarea id="voice-editor"
            style="flex:1;min-height:380px;padding:14px 16px;
            background:var(--bg-surface);border:1px solid var(--border-subtle);
            border-radius:var(--radius-md);color:var(--text-primary);
            font-size:0.875rem;line-height:1.7;font-family:var(--font-ui);
            resize:vertical;outline:none;transition:border-color .15s;"
            onfocus="this.style.borderColor='var(--brand-gold)'"
            onblur="this.style.borderColor='var(--border-subtle)'"
            placeholder="Cole ou escreva o guia de tom de voz desta BU aqui…

Exemplos do que incluir:
• Persona e tom (ex: sofisticado mas acolhedor, nunca formal em excesso)
• Palavras e expressões que devem/não devem ser usadas
• Estilo de abertura e encerramento de textos
• Tratamento do cliente (você/sr./sra.)
• Emojis: sim ou não?
• Exemplos de bons textos da marca">${esc(voices[activeBu]||'')}</textarea>

          <div style="display:flex;align-items:center;gap:8px;justify-content:space-between;">
            <span id="voice-char-count" style="font-size:0.75rem;color:var(--text-muted);"></span>
            <div style="display:flex;gap:8px;">
              <button id="voice-clear-btn" class="btn btn-ghost btn-sm"
                style="font-size:0.75rem;color:var(--text-muted);">Limpar</button>
              <button id="voice-save-btn2" class="btn btn-primary btn-sm">Salvar tom de voz</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // BU switcher
    container.querySelectorAll('.voice-bu-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        activeBu = btn.dataset.bu;
        render();
      });
    });

    // Char count
    const editor = document.getElementById('voice-editor');
    const updateCount = () => {
      const el = document.getElementById('voice-char-count');
      if (el && editor) el.textContent = `${editor.value.length} caracteres`;
    };
    editor?.addEventListener('input', updateCount);
    updateCount();

    // Save
    const doSave = async () => {
      const text = document.getElementById('voice-editor')?.value || '';
      const btn  = document.getElementById('voice-save-btn2');
      if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando…'; }
      try {
        await saveBrandVoice(activeBu, text);
        voices[activeBu] = text;
        toast.success(`Tom de voz salvo para ${BUS.find(b=>b.id===activeBu)?.name}.`);
        render();
      } catch(e) { toast.error('Erro: ' + e.message); }
      finally { if (btn) { btn.disabled = false; btn.textContent = 'Salvar tom de voz'; } }
    };
    document.getElementById('voice-save-btn')?.addEventListener('click', doSave);
    document.getElementById('voice-save-btn2')?.addEventListener('click', doSave);

    // Clear
    document.getElementById('voice-clear-btn')?.addEventListener('click', () => {
      if (!confirm('Limpar o conteúdo? O texto salvo não será apagado até você salvar novamente.')) return;
      const ed = document.getElementById('voice-editor');
      if (ed) { ed.value = ''; updateCount(); }
    });
  };

  render();
}

/* ═══════════════════════════════════════════════════════════
   TAB 2 — DICAS DE VIAGEM
═══════════════════════════════════════════════════════════ */
async function renderTipsTab(container) {
  const now   = new Date();
  const in60  = new Date(+now + 60 * 86400_000);

  const [tips, dests] = await Promise.all([fetchTips(), fetchDestinations()]);

  // Flagged (expired/expiring)
  const flagged = tips.flatMap(tip => {
    const dest = dests.find(d => d.id === tip.destinationId);
    return SEGMENTS.map(seg => {
      const sd = tip.segments?.[seg.key];
      if (!sd?.hasExpiry || !sd?.expiryDate) return null;
      const exp = new Date(sd.expiryDate);
      const status = exp < now ? 'expired' : exp <= in60 ? 'expiring' : null;
      if (!status) return null;
      return { tip, dest, seg, sd, exp, status };
    }).filter(Boolean);
  });

  // Missing (destinations without tip)
  const tipDestIds  = new Set(tips.map(t => t.destinationId));
  const missingDests = dests.filter(d => !tipDestIds.has(d.id)).slice(0, 20);

  let selectedBu = BUS[0].id;
  let mode       = 'review'; // 'review' | 'demand' | 'generate'

  const render = () => {
    container.innerHTML = `
      <!-- Mode selector -->
      <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;">
        ${[
          { id:'review',   label:'◑ Revisão automática', sub:`${flagged.length} item${flagged.length!==1?'s':''} pendente${flagged.length!==1?'s':''}` },
          { id:'demand',   label:'✎ Sob demanda',        sub:'Reescrever qualquer dica' },
          { id:'generate', label:'+ Gerar do zero',      sub:`${missingDests.length} destino${missingDests.length!==1?'s':''} sem conteúdo` },
        ].map(m => `
          <button class="tips-mode-btn" data-mode="${m.id}"
            style="flex:1;min-width:160px;padding:12px 16px;border-radius:var(--radius-md);
            border:2px solid ${mode===m.id?'var(--brand-gold)':'var(--border-subtle)'};
            background:${mode===m.id?'var(--brand-gold)12':'transparent'};
            cursor:pointer;text-align:left;transition:all .15s;">
            <div style="font-size:0.875rem;font-weight:600;
              color:${mode===m.id?'var(--brand-gold)':'var(--text-primary)'};">${m.label}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">${m.sub}</div>
          </button>`).join('')}
      </div>

      <!-- BU selector -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
        <span style="font-size:0.8125rem;color:var(--text-muted);">Tom de voz:</span>
        <select id="tips-bu-sel" class="filter-select">
          ${BUS.map(b => `<option value="${b.id}" ${selectedBu===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}
        </select>
      </div>

      <!-- Content area -->
      <div id="tips-mode-content"></div>
    `;

    container.querySelectorAll('.tips-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => { mode = btn.dataset.mode; render(); });
    });
    document.getElementById('tips-bu-sel')?.addEventListener('change', e => {
      selectedBu = e.target.value; render();
    });

    const modeContent = document.getElementById('tips-mode-content');
    if (mode === 'review')   renderTipsReview(modeContent, flagged, selectedBu);
    if (mode === 'demand')   renderTipsDemand(modeContent, tips, dests, selectedBu);
    if (mode === 'generate') renderTipsGenerate(modeContent, missingDests, selectedBu);
  };

  render();
}

function renderTipsReview(container, flagged, buId) {
  if (!flagged.length) {
    container.innerHTML = `<div class="card" style="padding:48px;text-align:center;">
      <div style="font-size:2.5rem;margin-bottom:12px;">✓</div>
      <div style="font-size:1rem;font-weight:700;">Tudo em dia!</div>
      <div style="font-size:0.875rem;color:var(--text-muted);margin-top:6px;">
        Nenhuma dica vencida ou próxima do vencimento nos próximos 60 dias.
      </div>
    </div>`;
    return;
  }

  // Group by tip
  const byTip = {};
  flagged.forEach(f => {
    const key = f.tip.id;
    if (!byTip[key]) byTip[key] = { tip: f.tip, dest: f.dest, items: [] };
    byTip[key].items.push(f);
  });

  container.innerHTML = `
    <div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">
      <span style="font-size:0.875rem;color:var(--text-muted);">
        ${flagged.length} segmento${flagged.length!==1?'s':''} em ${Object.keys(byTip).length} dica${Object.keys(byTip).length!==1?'s':''}
      </span>
      <button class="btn btn-secondary btn-sm" id="review-all-btn">◑ Analisar todos</button>
    </div>
    <div id="review-cards" style="display:flex;flex-direction:column;gap:14px;">
      ${Object.entries(byTip).map(([key, group]) => reviewCard(key, group)).join('')}
    </div>
  `;

  container.querySelectorAll('.review-analyze-btn').forEach(btn => {
    btn.addEventListener('click', () => analyzeReviewCard(btn.dataset.key, byTip[btn.dataset.key], buId));
  });

  document.getElementById('review-all-btn')?.addEventListener('click', async () => {
    for (const [key, group] of Object.entries(byTip)) {
      await analyzeReviewCard(key, group, buId);
    }
  });
}

function reviewCard(key, group) {
  const label = [group.dest?.city, group.dest?.country].filter(Boolean).join(', ') || '—';
  return `
    <div class="card review-card" id="rcard-${key}" style="padding:0;overflow:hidden;">
      <div style="padding:14px 18px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);display:flex;align-items:center;gap:12px;">
        <div style="flex:1;">
          <div style="font-weight:700;">${esc(label)}</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:5px;">
            ${group.items.map(i => `
              <span style="font-size:0.6875rem;padding:2px 8px;border-radius:20px;
                ${i.status==='expired'
                  ? 'background:#EF444415;color:#EF4444;border:1px solid #EF444330;'
                  : 'background:#F59E0B15;color:#F59E0B;border:1px solid #F59E0B30;'}">
                ${i.status==='expired'?'⚠':'◷'} ${esc(i.seg.label)} · ${i.exp.toLocaleDateString('pt-BR')}
              </span>`).join('')}
          </div>
        </div>
        <div style="display:flex;gap:6px;">
          <a href="#portal-tip-editor?destId=${esc(group.tip.destinationId)}"
            class="btn btn-ghost btn-sm" style="font-size:0.75rem;text-decoration:none;">✎</a>
          <button class="btn btn-secondary btn-sm review-analyze-btn"
            data-key="${key}" style="font-size:0.8125rem;">◑ Analisar</button>
        </div>
      </div>
      <div id="rsugg-${key}" style="display:none;"></div>
    </div>`;
}

async function analyzeReviewCard(key, group, buId) {
  const btn   = document.querySelector(`.review-analyze-btn[data-key="${key}"]`);
  const suggEl = document.getElementById(`rsugg-${key}`);
  if (!suggEl) return;

  if (btn) { btn.disabled = true; btn.textContent = '⏳ Analisando…'; }
  suggEl.style.display = 'block';
  suggEl.innerHTML = loadingHtml('Consultando IA…');

  const dest    = [group.dest?.city, group.dest?.country, group.dest?.continent].filter(Boolean).join(', ');
  const content = group.items.map(({ seg, sd }) => {
    const items = (sd.items||[]).slice(0,4).map(i =>
      `- ${i.titulo||i.title||''}${i.descricao ? ': '+i.descricao.slice(0,80) : ''}`).join('\n');
    return `### ${seg.label}\n${items || JSON.stringify(sd.info||{}).slice(0,200)}`;
  }).join('\n\n');

  try {
    const text = await analyzeTipExpiry({ destination: dest, segment: group.items.map(i=>i.seg.label).join(', '), currentContent: content });
    suggEl.innerHTML = suggestionBlock(text, null, group.tip.destinationId);

    // Wire approve button after innerHTML set
    suggEl.querySelector('.sugg-approve')?.addEventListener('click', async () => {
      const approveBtn = suggEl.querySelector('.sugg-approve');
      if (approveBtn) { approveBtn.disabled = true; approveBtn.textContent = '⏳ Salvando…'; }
      try {
        const newDate = new Date(+new Date() + 90*86400_000).toISOString().slice(0,10);
        const segs = { ...(group.tip.segments||{}) };
        group.items.forEach(({ seg }) => {
          if (segs[seg.key]) segs[seg.key] = { ...segs[seg.key], expiryDate: newDate };
        });
        await saveTip(group.tip.id, { ...group.tip, segments: segs });
        toast.success('Marcado como revisado. Validade +90 dias.');
        document.getElementById(`rcard-${key}`)?.remove();
      } catch(e) { toast.error('Erro: ' + e.message); }
    });
    if (btn) { btn.disabled = false; btn.textContent = '↺ Reanalisar'; }
  } catch(e) {
    suggEl.innerHTML = `<div style="padding:16px;color:#EF4444;font-size:0.875rem;">Erro: ${esc(e.message)}</div>`;
    if (btn) { btn.disabled = false; btn.textContent = '◑ Analisar'; }
  }
}

function renderTipsDemand(container, tips, dests, buId) {
  let selDestId = '';
  let selSegKey = '';
  let selMode   = 'rewrite';

  const render = () => {
    const dest = dests.find(d => d.id === selDestId);
    const tip  = tips.find(t => t.destinationId === selDestId);
    const segData = tip?.segments?.[selSegKey];
    const currentText = segData
      ? (Array.isArray(segData.items)
          ? segData.items.slice(0,3).map(i=>`${i.titulo||i.title}: ${i.descricao||''}`).join('\n')
          : JSON.stringify(segData.info||{}).slice(0,400))
      : '';

    container.innerHTML = `
      <div class="card" style="padding:24px;margin-bottom:16px;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px;">
          <div>
            <label style="${LBL}">Destino</label>
            <select id="demand-dest" class="filter-select" style="width:100%;">
              <option value="">Selecione um destino</option>
              ${dests.map(d => {
                const label = [d.city, d.country].filter(Boolean).join(', ');
                return `<option value="${d.id}" ${selDestId===d.id?'selected':''}>${esc(label)}</option>`;
              }).join('')}
            </select>
          </div>
          <div>
            <label style="${LBL}">Segmento</label>
            <select id="demand-seg" class="filter-select" style="width:100%;" ${!selDestId?'disabled':''}>
              <option value="">Selecione</option>
              ${SEGMENTS.map(s => `<option value="${s.key}" ${selSegKey===s.key?'selected':''}>${esc(s.label)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="${LBL}">Modo</label>
            <select id="demand-mode" class="filter-select" style="width:100%;">
              <option value="rewrite"  ${selMode==='rewrite' ?'selected':''}>Reescrever com tom de voz</option>
              <option value="enrich"   ${selMode==='enrich'  ?'selected':''}>Enriquecer conteúdo</option>
              <option value="generate" ${selMode==='generate'?'selected':''}>Gerar do zero</option>
            </select>
          </div>
        </div>

        ${currentText ? `
          <div style="margin-bottom:12px;">
            <label style="${LBL}">Conteúdo atual</label>
            <div style="padding:10px 12px;background:var(--bg-surface);border-radius:var(--radius-sm);
              font-size:0.8125rem;color:var(--text-muted);max-height:100px;overflow-y:auto;
              white-space:pre-wrap;">${esc(currentText)}</div>
          </div>` : ''}

        <button id="demand-gen-btn" class="btn btn-primary"
          ${(!selDestId||!selSegKey)?'disabled':''}>
          ◑ Gerar conteúdo
        </button>
      </div>
      <div id="demand-result"></div>
    `;

    document.getElementById('demand-dest')?.addEventListener('change', e => {
      selDestId = e.target.value; selSegKey = ''; render();
    });
    document.getElementById('demand-seg')?.addEventListener('change', e => {
      selSegKey = e.target.value; render();
    });
    document.getElementById('demand-mode')?.addEventListener('change', e => {
      selMode = e.target.value; render();
    });

    document.getElementById('demand-gen-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('demand-gen-btn');
      const res = document.getElementById('demand-result');
      if (!btn || !res) return;
      btn.disabled = true; btn.textContent = '⏳ Gerando…';
      res.innerHTML = loadingHtml('Gerando conteúdo com IA…');

      const destLabel = [dest?.city, dest?.country, dest?.continent].filter(Boolean).join(', ');
      const segLabel  = SEGMENTS.find(s=>s.key===selSegKey)?.label || selSegKey;
      try {
        const text = await generateTravelTip({
          buId, destination: destLabel, segment: segLabel,
          currentContent: currentText, mode: selMode,
        });
        res.innerHTML = `
          <div class="card" style="padding:20px;">
            <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;
              letter-spacing:.07em;color:var(--brand-gold);margin-bottom:12px;">◑ Resultado da IA</div>
            <div style="font-size:0.875rem;line-height:1.7;white-space:pre-wrap;
              color:var(--text-secondary);margin-bottom:16px;">${esc(text)}</div>
            <div style="display:flex;gap:8px;">
              <button class="btn btn-ghost btn-sm" id="demand-copy"
                style="font-size:0.8125rem;">⎘ Copiar</button>
              <a href="#portal-tip-editor?destId=${esc(selDestId)}"
                class="btn btn-secondary btn-sm" style="text-decoration:none;font-size:0.8125rem;">
                ✎ Abrir editor</a>
            </div>
          </div>`;
        document.getElementById('demand-copy')?.addEventListener('click', () => {
          navigator.clipboard.writeText(text).then(() => toast.success('Copiado!'));
        });
      } catch(e) {
        res.innerHTML = `<div style="color:#EF4444;font-size:0.875rem;padding:12px;">Erro: ${esc(e.message)}</div>`;
      } finally { btn.disabled = false; btn.textContent = '◑ Gerar conteúdo'; }
    });
  };

  render();
}

function renderTipsGenerate(container, missingDests, buId) {
  if (!missingDests.length) {
    container.innerHTML = `<div class="card" style="padding:40px;text-align:center;">
      <div style="font-size:1rem;font-weight:700;">Todos os destinos têm dica cadastrada.</div>
    </div>`;
    return;
  }

  let selDest = '';
  let selSeg  = SEGMENTS[0].key;

  const render = () => {
    container.innerHTML = `
      <div class="card" style="padding:24px;">
        <div style="font-size:0.875rem;color:var(--text-muted);margin-bottom:16px;">
          ${missingDests.length} destino${missingDests.length!==1?'s':''} sem conteúdo
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
          <div>
            <label style="${LBL}">Destino</label>
            <select id="gen-dest" class="filter-select" style="width:100%;">
              <option value="">Selecione</option>
              ${missingDests.map(d => {
                const label = [d.city, d.country].filter(Boolean).join(', ');
                return `<option value="${d.id}" data-label="${esc(label)}" ${selDest===d.id?'selected':''}>${esc(label)}</option>`;
              }).join('')}
            </select>
          </div>
          <div>
            <label style="${LBL}">Segmento inicial</label>
            <select id="gen-seg" class="filter-select" style="width:100%;">
              ${SEGMENTS.map(s => `<option value="${s.key}" ${selSeg===s.key?'selected':''}>${esc(s.label)}</option>`).join('')}
            </select>
          </div>
        </div>
        <button id="gen-btn" class="btn btn-primary" ${!selDest?'disabled':''}>
          + Gerar conteúdo inicial
        </button>
      </div>
      <div id="gen-result" style="margin-top:16px;"></div>
    `;

    document.getElementById('gen-dest')?.addEventListener('change', e => { selDest = e.target.value; render(); });
    document.getElementById('gen-seg')?.addEventListener('change',  e => { selSeg  = e.target.value; });

    document.getElementById('gen-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('gen-btn');
      const res = document.getElementById('gen-result');
      btn.disabled = true; btn.textContent = '⏳ Gerando…';
      res.innerHTML = loadingHtml('Gerando sugestão inicial…');

      const opt = document.querySelector(`#gen-dest option[value="${selDest}"]`);
      const destLabel = opt?.dataset.label || selDest;
      const segLabel  = SEGMENTS.find(s=>s.key===selSeg)?.label || selSeg;

      try {
        const text = await generateTravelTip({ buId, destination: destLabel, segment: segLabel, mode: 'generate' });
        res.innerHTML = `
          <div class="card" style="padding:20px;">
            <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;
              letter-spacing:.07em;color:var(--brand-gold);margin-bottom:12px;">◑ Sugestão gerada</div>
            <div style="font-size:0.875rem;line-height:1.7;white-space:pre-wrap;
              color:var(--text-secondary);margin-bottom:16px;">${esc(text)}</div>
            <div style="display:flex;gap:8px;">
              <button class="btn btn-ghost btn-sm" id="gen-copy">⎘ Copiar</button>
              <a href="#portal-tip-editor?destId=${esc(selDest)}"
                class="btn btn-secondary btn-sm" style="text-decoration:none;">✎ Abrir editor</a>
            </div>
          </div>`;
        document.getElementById('gen-copy')?.addEventListener('click', () =>
          navigator.clipboard.writeText(text).then(() => toast.success('Copiado!')));
      } catch(e) {
        res.innerHTML = `<div style="color:#EF4444;padding:12px;font-size:0.875rem;">Erro: ${esc(e.message)}</div>`;
      } finally { btn.disabled = false; btn.textContent = '+ Gerar conteúdo inicial'; }
    });
  };

  render();
}

/* ═══════════════════════════════════════════════════════════
   TAB 3 — NEWSLETTER
═══════════════════════════════════════════════════════════ */
async function renderNewsletterTab(container) {
  let buId    = BUS[0].id;
  let result  = '';
  let history = [];

  const render = () => {
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">

        <!-- Form -->
        <div class="card" style="padding:24px;display:flex;flex-direction:column;gap:14px;">
          <div style="font-weight:700;font-size:1rem;margin-bottom:4px;">Parâmetros</div>

          <div>
            <label style="${LBL}">Business Unit *</label>
            <select id="nl-bu" class="filter-select" style="width:100%;">
              ${BUS.map(b => `<option value="${b.id}" ${buId===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="${LBL}">Tema / assunto principal *</label>
            <input type="text" id="nl-tema" class="portal-field" style="width:100%;"
              placeholder="Ex: Promoção Europa Verão 2026">
          </div>
          <div>
            <label style="${LBL}">Campanha <span style="color:var(--text-muted);font-weight:400;">(opcional)</span></label>
            <input type="text" id="nl-campanha" class="portal-field" style="width:100%;"
              placeholder="Ex: Black Friday, Aniversário PRIMETOUR">
          </div>
          <div>
            <label style="${LBL}">Público-alvo</label>
            <input type="text" id="nl-publico" class="portal-field" style="width:100%;"
              placeholder="Ex: Clientes premium, Portadores Centurion">
          </div>
          <div>
            <label style="${LBL}">Destaque principal *</label>
            <textarea id="nl-destaque" class="portal-field" rows="3" style="width:100%;"
              placeholder="O que deve ser destacado? Ex: Pacote Paris 7 dias com aéreo incluído a partir de R$ 12.900"></textarea>
          </div>
          <div>
            <label style="${LBL}">Seções extras <span style="color:var(--text-muted);font-weight:400;">(opcional, separadas por vírgula)</span></label>
            <input type="text" id="nl-secoes" class="portal-field" style="width:100%;"
              placeholder="Ex: Dica de destino, Curiosidade cultural, Oferta relâmpago">
          </div>

          <button id="nl-gen-btn" class="btn btn-primary" style="margin-top:4px;">
            ◑ Gerar newsletter
          </button>

          ${result ? `
            <button id="nl-refine-btn" class="btn btn-secondary btn-sm">
              ↺ Refinar resultado
            </button>` : ''}
        </div>

        <!-- Result -->
        <div class="card" style="padding:24px;min-height:300px;">
          ${result ? `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
              <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;
                letter-spacing:.07em;color:var(--brand-gold);">◑ Conteúdo gerado</div>
              <div style="display:flex;gap:6px;">
                <button id="nl-copy-all" class="btn btn-ghost btn-sm" style="font-size:0.75rem;">
                  ⎘ Copiar tudo
                </button>
              </div>
            </div>
            <div id="nl-result-blocks" style="display:flex;flex-direction:column;gap:12px;">
              ${parseNewsletterResult(result)}
            </div>` :
            `<div style="display:flex;align-items:center;justify-content:center;
              min-height:200px;color:var(--text-muted);font-size:0.875rem;text-align:center;">
              Preencha os parâmetros e clique em Gerar</div>`}
        </div>
      </div>

      <!-- Refinement chat (shows after first generation) -->
      ${result ? `
        <div class="card" style="padding:20px;margin-top:16px;">
          <div style="font-size:0.8125rem;font-weight:600;margin-bottom:10px;">
            Ajustar com IA</div>
          <div style="display:flex;gap:8px;">
            <input type="text" id="nl-refine-input" class="portal-field" style="flex:1;"
              placeholder="Ex: Deixe o assunto mais urgente, adicione um PS, mude o CTA para…">
            <button id="nl-refine-send" class="btn btn-primary btn-sm">Enviar</button>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;">
            ${['Deixe mais formal', 'Deixe mais descontraído', 'Encurte o corpo',
               'Adicione emojis', 'Crie 2 variações de assunto', 'Adicione urgência'].map(s =>
              `<button class="nl-quick-refine btn btn-ghost btn-sm"
                style="font-size:0.75rem;">${esc(s)}</button>`).join('')}
          </div>
        </div>` : ''}
    `;

    document.getElementById('nl-bu')?.addEventListener('change', e => { buId = e.target.value; });

    document.getElementById('nl-gen-btn')?.addEventListener('click', async () => {
      const btn  = document.getElementById('nl-gen-btn');
      const tema = document.getElementById('nl-tema')?.value.trim();
      const destaque = document.getElementById('nl-destaque')?.value.trim();
      if (!tema || !destaque) { toast.error('Preencha tema e destaque principal.'); return; }

      btn.disabled = true; btn.textContent = '⏳ Gerando…';
      try {
        const secoes = (document.getElementById('nl-secoes')?.value||'')
          .split(',').map(s=>s.trim()).filter(Boolean);
        result = await generateNewsletter({
          buId, tema, destaque,
          campanha: document.getElementById('nl-campanha')?.value.trim(),
          publico:  document.getElementById('nl-publico')?.value.trim(),
          secoes,
        });
        history = [
          { role: 'user', content: `Gere uma newsletter: tema="${tema}", destaque="${destaque}"` },
          { role: 'assistant', content: result },
        ];
        render();
      } catch(e) { toast.error('Erro: ' + e.message); }
      finally { if (btn) { btn.disabled = false; btn.textContent = '◑ Gerar newsletter'; } }
    });

    document.getElementById('nl-copy-all')?.addEventListener('click', () =>
      navigator.clipboard.writeText(result).then(() => toast.success('Conteúdo copiado!')));

    const doRefine = async () => {
      const input = document.getElementById('nl-refine-input');
      const msg   = input?.value.trim();
      if (!msg) return;
      const sendBtn = document.getElementById('nl-refine-send');
      if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '⏳'; }
      try {
        const refined = await callClaude({
          buId, history,
          userPrompt: msg + '\n\nAtualize a newsletter acima conforme solicitado.',
          maxTokens: 2000,
        });
        result = refined;
        history.push({ role: 'user', content: msg }, { role: 'assistant', content: refined });
        if (input) input.value = '';
        render();
      } catch(e) { toast.error('Erro: ' + e.message); }
      finally { if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = 'Enviar'; } }
    };

    document.getElementById('nl-refine-send')?.addEventListener('click', doRefine);
    document.getElementById('nl-refine-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doRefine(); }
    });
    document.querySelectorAll('.nl-quick-refine').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = document.getElementById('nl-refine-input');
        if (inp) { inp.value = btn.textContent; doRefine(); }
      });
    });
  };

  render();
}

function parseNewsletterResult(text) {
  const sections = text.split(/===\s*/);
  if (sections.length <= 1) {
    return `<div style="font-size:0.875rem;line-height:1.7;white-space:pre-wrap;
      color:var(--text-secondary);">${esc(text)}</div>`;
  }
  return sections.filter(Boolean).map(sec => {
    const lines = sec.trim().split('\n');
    const title = lines[0].trim();
    const body  = lines.slice(1).join('\n').trim();
    return `
      <div style="background:var(--bg-surface);border-radius:var(--radius-sm);
        padding:12px 14px;border-left:3px solid var(--brand-gold)30;">
        <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.07em;color:var(--brand-gold);margin-bottom:6px;">${esc(title)}</div>
        <div style="font-size:0.875rem;line-height:1.6;color:var(--text-secondary);
          white-space:pre-wrap;">${esc(body)}</div>
        <button class="btn btn-ghost btn-sm nl-copy-block"
          data-text="${esc(body)}"
          style="font-size:0.7rem;margin-top:6px;color:var(--text-muted);">⎘ Copiar bloco</button>
      </div>`;
  }).join('');
}

/* ═══════════════════════════════════════════════════════════
   TAB 4 — REDES SOCIAIS
═══════════════════════════════════════════════════════════ */
async function renderSocialTab(container) {
  let buId      = BUS[0].id;
  let platform  = 'instagram';
  let format    = 'Post';
  let result    = '';

  const FORMATS = {
    instagram: ['Post', 'Reel', 'Carrossel', 'Story'],
    linkedin:  ['Post', 'Artigo'],
  };

  const render = () => {
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">

        <!-- Form -->
        <div class="card" style="padding:24px;display:flex;flex-direction:column;gap:14px;">

          <!-- Platform tabs -->
          <div style="display:flex;gap:0;border-bottom:1px solid var(--border-subtle);
            margin-bottom:4px;">
            ${[{id:'instagram',label:'Instagram'},{id:'linkedin',label:'LinkedIn'}].map(p => `
              <button class="social-platform-btn" data-platform="${p.id}"
                style="padding:8px 16px;border:none;background:none;cursor:pointer;
                font-size:0.875rem;border-bottom:2px solid ${platform===p.id?'var(--brand-gold)':'transparent'};
                color:${platform===p.id?'var(--brand-gold)':'var(--text-muted)'};transition:all .15s;">
                ${p.label}
              </button>`).join('')}
          </div>

          <!-- Format chips -->
          <div>
            <label style="${LBL}">Formato</label>
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              ${(FORMATS[platform]||[]).map(f => `
                <button class="social-fmt-btn" data-fmt="${f}"
                  style="padding:5px 12px;border-radius:20px;border:1px solid
                  ${format===f?'var(--brand-gold)':'var(--border-subtle)'};
                  background:${format===f?'var(--brand-gold)15':'transparent'};
                  cursor:pointer;font-size:0.8125rem;
                  color:${format===f?'var(--brand-gold)':'var(--text-secondary)'};
                  transition:all .15s;">${f}</button>`).join('')}
            </div>
          </div>

          <div>
            <label style="${LBL}">Business Unit (tom de voz)</label>
            <select id="social-bu" class="filter-select" style="width:100%;">
              ${BUS.map(b => `<option value="${b.id}" ${buId===b.id?'selected':''}>${esc(b.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="${LBL}">Tema *</label>
            <input type="text" id="social-tema" class="portal-field" style="width:100%;"
              placeholder="Ex: Roteiro 10 dias pelo Japão">
          </div>
          <div>
            <label style="${LBL}">Contexto adicional</label>
            <textarea id="social-ctx" class="portal-field" rows="3" style="width:100%;"
              placeholder="Informações extras, links, nomes de lugares, datas…"></textarea>
          </div>

          <button id="social-gen-btn" class="btn btn-primary">◑ Gerar conteúdo</button>

          ${result ? `
            <!-- Publish section -->
            <div style="border-top:1px solid var(--border-subtle);padding-top:14px;margin-top:4px;">
              <div style="font-size:0.8125rem;font-weight:600;margin-bottom:10px;">
                Publicar agora</div>
              ${platform === 'instagram' ? instagramPublishForm() : linkedinPublishForm()}
            </div>` : ''}
        </div>

        <!-- Result -->
        <div class="card" style="padding:24px;min-height:300px;">
          ${result ? `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
              <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;
                letter-spacing:.07em;color:var(--brand-gold);">◑ Conteúdo gerado</div>
              <button id="social-copy" class="btn btn-ghost btn-sm" style="font-size:0.75rem;">
                ⎘ Copiar</button>
            </div>
            <div style="font-size:0.875rem;line-height:1.7;white-space:pre-wrap;
              color:var(--text-secondary);">${esc(result)}</div>` :
            `<div style="display:flex;align-items:center;justify-content:center;
              min-height:200px;color:var(--text-muted);font-size:0.875rem;">
              Preencha os parâmetros e clique em Gerar</div>`}
        </div>
      </div>
    `;

    // Platform switch
    container.querySelectorAll('.social-platform-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        platform = btn.dataset.platform;
        format   = FORMATS[platform][0];
        result   = '';
        render();
      });
    });

    // Format switch
    container.querySelectorAll('.social-fmt-btn').forEach(btn => {
      btn.addEventListener('click', () => { format = btn.dataset.fmt; render(); });
    });

    document.getElementById('social-bu')?.addEventListener('change', e => { buId = e.target.value; });

    document.getElementById('social-gen-btn')?.addEventListener('click', async () => {
      const btn  = document.getElementById('social-gen-btn');
      const tema = document.getElementById('social-tema')?.value.trim();
      if (!tema) { toast.error('Preencha o tema.'); return; }
      btn.disabled = true; btn.textContent = '⏳ Gerando…';
      try {
        result = await generateSocialPost({
          buId, plataforma: platform, formato: format, tema,
          contexto: document.getElementById('social-ctx')?.value.trim(),
        });
        render();
      } catch(e) { toast.error('Erro: ' + e.message); }
      finally { if (btn) { btn.disabled = false; btn.textContent = '◑ Gerar conteúdo'; } }
    });

    document.getElementById('social-copy')?.addEventListener('click', () =>
      navigator.clipboard.writeText(result).then(() => toast.success('Copiado!')));

    // Wire publish buttons
    wireInstagramPublish(result);
    wireLinkedinPublish(result);
  };

  render();
}

function instagramPublishForm() {
  return `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div>
        <label style="${LBL}">URL da mídia (imagem/vídeo) *</label>
        <input type="url" id="ig-media-url" class="portal-field" style="width:100%;"
          placeholder="https://… (deve ser URL pública)">
      </div>
      <div>
        <label style="${LBL}">Conta</label>
        <select id="ig-account" class="filter-select" style="width:100%;">
          <option value="primetourviagens">@primetourviagens</option>
          <option value="icsbyprimetour">@icsbyprimetour</option>
        </select>
      </div>
      <button id="ig-publish-btn" class="btn btn-secondary btn-sm">
        ◎ Publicar no Instagram
      </button>
      <div id="ig-publish-status" style="font-size:0.8125rem;"></div>
    </div>`;
}

function linkedinPublishForm() {
  return `
    <div style="display:flex;flex-direction:column;gap:10px;">
      <div style="font-size:0.8125rem;color:var(--text-muted);">
        Publicação na company page PRIMETOUR via API LinkedIn.
      </div>
      <div>
        <label style="${LBL}">URL de imagem <span style="font-weight:400;color:var(--text-muted);">(opcional)</span></label>
        <input type="url" id="li-image-url" class="portal-field" style="width:100%;"
          placeholder="https://…">
      </div>
      <button id="li-publish-btn" class="btn btn-secondary btn-sm">
        ◎ Publicar no LinkedIn
      </button>
      <div id="li-publish-status" style="font-size:0.8125rem;"></div>
    </div>`;
}

function wireInstagramPublish(caption) {
  document.getElementById('ig-publish-btn')?.addEventListener('click', async () => {
    const btn      = document.getElementById('ig-publish-btn');
    const mediaUrl = document.getElementById('ig-media-url')?.value.trim();
    const status   = document.getElementById('ig-publish-status');
    if (!mediaUrl) { toast.error('Informe a URL da mídia.'); return; }
    if (!caption)  { toast.error('Gere o conteúdo antes de publicar.'); return; }

    btn.disabled = true; btn.textContent = '⏳ Publicando…';
    if (status) { status.textContent = 'Enviando para a API da Meta…'; status.style.color = 'var(--brand-gold)'; }

    try {
      const { publishInstagramPost } = await import('../services/metaPublish.js');
      const account = document.getElementById('ig-account')?.value || 'primetourviagens';
      await publishInstagramPost({ caption, mediaUrl, account });
      if (status) { status.textContent = '✓ Publicado com sucesso!'; status.style.color = '#22C55E'; }
      toast.success('Post publicado no Instagram!');
    } catch(e) {
      if (status) { status.textContent = '✗ ' + e.message; status.style.color = '#EF4444'; }
    } finally { btn.disabled = false; btn.textContent = '◎ Publicar no Instagram'; }
  });
}

function wireLinkedinPublish(text) {
  document.getElementById('li-publish-btn')?.addEventListener('click', async () => {
    const btn    = document.getElementById('li-publish-btn');
    const status = document.getElementById('li-publish-status');
    if (!text) { toast.error('Gere o conteúdo antes de publicar.'); return; }

    btn.disabled = true; btn.textContent = '⏳ Publicando…';
    if (status) { status.textContent = 'Enviando para a API do LinkedIn…'; status.style.color = 'var(--brand-gold)'; }

    try {
      const { publishLinkedinPost } = await import('../services/linkedinPublish.js');
      const imageUrl = document.getElementById('li-image-url')?.value.trim() || null;
      await publishLinkedinPost({ text, imageUrl });
      if (status) { status.textContent = '✓ Publicado com sucesso!'; status.style.color = '#22C55E'; }
      toast.success('Post publicado no LinkedIn!');
    } catch(e) {
      if (status) { status.textContent = '✗ ' + e.message; status.style.color = '#EF4444'; }
    } finally { btn.disabled = false; btn.textContent = '◎ Publicar no LinkedIn'; }
  });
}

/* ─── Shared helpers ──────────────────────────────────────── */
const LBL = `font-size:0.8125rem;font-weight:600;display:block;margin-bottom:5px;`;

function loadingHtml(msg = 'Carregando…') {
  return `<div style="text-align:center;padding:32px;color:var(--text-muted);">
    <div class="spinner" style="width:24px;height:24px;border:3px solid var(--border-subtle);
      border-top-color:var(--brand-gold);border-radius:50%;animation:spin .8s linear infinite;
      margin:0 auto 10px;"></div>${esc(msg)}</div>`;
}

function suggestionBlock(text, onApprove, destId) {
  return `
    <div style="padding:20px;">
      <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;
        letter-spacing:.07em;color:var(--brand-gold);margin-bottom:12px;">◑ Análise da IA</div>
      <div style="font-size:0.875rem;line-height:1.7;white-space:pre-wrap;
        color:var(--text-secondary);margin-bottom:14px;">${esc(text)}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="btn btn-primary btn-sm sugg-approve"
          style="font-size:0.8125rem;">✓ Marcar como revisado (+90 dias)</button>
        <a href="#portal-tip-editor?destId=${esc(destId)}"
          class="btn btn-secondary btn-sm" style="text-decoration:none;font-size:0.8125rem;">
          ✎ Abrir editor</a>
      </div>
    </div>`;
}
