/**
 * PRIMETOUR — Revista Luxury Travel · Administração
 *
 * 3 abas:
 *   1. Edições — CRUD completo (criar/editar/deletar + upload PDFs PT/EN
 *      + extract cover automático + regenerar QR)
 *   2. Fontes — upload OTF/TTF/WOFF/WOFF2 + listar + delete
 *   3. Configurações — URL home + regenerar QR home + descrição
 *
 * Permissão: store.canManageLuxuryTravel() (master OU luxury_travel_manage).
 *
 * Tradução não tem agente IA (decisão: revista 2x/ano, qualidade pixel-perfect
 * é trabalho de designer). Botão "Traduzir com IA externa" abre claude.ai
 * com texto pré-preenchido (zero infra).
 */

import { store } from '../store.js';
import { toast } from '../components/toast.js';
import {
  fetchEditions, createEdition, updateEdition, deleteEdition,
  uploadEditionPdf, uploadEditionCover, regenerateEditionQr,
  fetchFonts, uploadFont, deleteFont,
  fetchSettings, updateSettings, regenerateHomeQr,
  generateQrDataUrl, formatBytes,
  LUXURY_TRAVEL_GH_REPO, LUXURY_TRAVEL_GH_BASE,
} from '../services/luxuryTravel.js?v=20260508r1';

const esc = s => String(s || '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const fmtDate = ts => {
  if (!ts) return '—';
  const d = ts?.toDate?.() || new Date(ts);
  return d.toLocaleDateString('pt-BR');
};

let activeTab = 'editions';

export async function renderLuxuryTravelAdmin(container) {
  if (!store.canManageLuxuryTravel()) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-title">Sem permissão</div>
        <div class="empty-state-message">Você precisa de "Administrar Revista Luxury Travel" no seu perfil.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <a href="#luxury-travel" style="font-size:0.75rem;color:var(--text-muted);text-decoration:none;">
          ← Voltar à página pública
        </a>
        <h1 class="page-title" style="margin-top:4px;">
          Administrar — Revista Luxury Travel
        </h1>
      </div>
    </div>

    <div style="display:flex;gap:0;border-bottom:1px solid var(--border-subtle);margin-bottom:24px;">
      <button class="lt-tab" data-tab="editions" style="padding:10px 20px;border:none;background:none;
        cursor:pointer;font-size:0.875rem;color:var(--text-muted);border-bottom:2px solid transparent;
        font-family:var(--font-ui);">📖 Edições</button>
      <button class="lt-tab" data-tab="fonts" style="padding:10px 20px;border:none;background:none;
        cursor:pointer;font-size:0.875rem;color:var(--text-muted);border-bottom:2px solid transparent;
        font-family:var(--font-ui);">🔤 Fontes</button>
      <button class="lt-tab" data-tab="settings" style="padding:10px 20px;border:none;background:none;
        cursor:pointer;font-size:0.875rem;color:var(--text-muted);border-bottom:2px solid transparent;
        font-family:var(--font-ui);">⚙ Configurações</button>
    </div>

    <div id="lt-admin-body"></div>
  `;

  // Tab handlers
  container.querySelectorAll('.lt-tab').forEach(t => {
    t.addEventListener('click', () => {
      activeTab = t.dataset.tab;
      renderTabs(container);
      renderActiveTab(container);
    });
  });

  renderTabs(container);
  renderActiveTab(container);
}

function renderTabs(container) {
  container.querySelectorAll('.lt-tab').forEach(t => {
    const active = t.dataset.tab === activeTab;
    t.style.color = active ? 'var(--brand-gold)' : 'var(--text-muted)';
    t.style.borderBottomColor = active ? 'var(--brand-gold)' : 'transparent';
    t.style.fontWeight = active ? '600' : '400';
  });
}

async function renderActiveTab(container) {
  const body = container.querySelector('#lt-admin-body');
  body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);">Carregando…</div>';
  try {
    if (activeTab === 'editions') await renderEditionsTab(body);
    else if (activeTab === 'fonts') await renderFontsTab(body);
    else if (activeTab === 'settings') await renderSettingsTab(body);
  } catch (e) {
    body.innerHTML = `<div class="empty-state"><div class="empty-state-title">Erro</div>
      <div class="empty-state-message">${esc(e.message)}</div></div>`;
  }
}

/* ════════════════════════════════════════════════════════════
   TAB 1: EDIÇÕES
   ════════════════════════════════════════════════════════════ */

async function renderEditionsTab(body) {
  const editions = await fetchEditions();

  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <div style="font-size:0.8125rem;color:var(--text-muted);">
        ${editions.length} ${editions.length === 1 ? 'edição cadastrada' : 'edições cadastradas'}
      </div>
      <button class="btn btn-primary btn-sm" id="lt-new-edition">+ Nova edição</button>
    </div>

    <div id="lt-editions-list">
      ${editions.length === 0 ? `
        <div class="empty-state">
          <div class="empty-state-icon">📖</div>
          <div class="empty-state-title">Nenhuma edição cadastrada</div>
          <div class="empty-state-message">Clique em "Nova edição" pra começar.</div>
        </div>
      ` : `
        <div style="display:flex;flex-direction:column;gap:12px;">
          ${editions.map(renderEditionRow).join('')}
        </div>
      `}
    </div>
  `;

  body.querySelector('#lt-new-edition')?.addEventListener('click', () => {
    openEditionForm(body, null);
  });

  editions.forEach(ed => {
    body.querySelector(`[data-act="edit"][data-id="${ed.id}"]`)?.addEventListener('click',
      () => openEditionForm(body, ed));
    body.querySelector(`[data-act="delete"][data-id="${ed.id}"]`)?.addEventListener('click',
      () => handleDeleteEdition(body, ed));
    body.querySelector(`[data-act="qr"][data-id="${ed.id}"]`)?.addEventListener('click',
      () => handleRegenerateQr(body, ed));
  });
}

function renderEditionRow(ed) {
  const cover = ed.pt?.coverUrl || ed.en?.coverUrl;
  const ptOk = !!ed.pt?.pdfUrl;
  const enOk = !!ed.en?.pdfUrl;
  return `
    <div class="card" style="padding:14px 16px;display:flex;gap:14px;align-items:center;
      ${ed.active === false ? 'opacity:0.6;' : ''}">
      ${cover ? `
        <img src="${esc(cover)}" alt="" style="width:60px;height:80px;object-fit:cover;
          border-radius:4px;flex-shrink:0;background:var(--bg-elevated);" />
      ` : `
        <div style="width:60px;height:80px;background:var(--bg-elevated);border-radius:4px;
          display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:1.5rem;">📖</div>
      `}
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
          <span style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;
            color:var(--brand-gold);">#${esc(String(ed.number || '?'))}</span>
          <span style="font-size:0.9375rem;font-weight:600;color:var(--text-primary);">
            ${esc(ed.title || 'LUXURY TRAVEL')} · ${esc(ed.subtitle || `Edition ${ed.number}`)}
          </span>
          ${ed.active === false ? `<span style="font-size:0.6875rem;background:var(--bg-elevated);
            color:var(--text-muted);padding:2px 8px;border-radius:var(--radius-full);">Oculta</span>` : ''}
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;display:flex;gap:10px;flex-wrap:wrap;">
          <span>${ed.pages || 0} páginas</span>
          <span>·</span>
          <span style="color:${ptOk ? '#22C55E' : '#94A3B8'};">PT ${ptOk ? '✓ ' + formatBytes(ed.pt.pdfSize) : '— sem PDF'}</span>
          <span>·</span>
          <span style="color:${enOk ? '#22C55E' : '#94A3B8'};">EN ${enOk ? '✓ ' + formatBytes(ed.en.pdfSize) : '— sem PDF'}</span>
          ${ed.qrUrl ? '<span>·</span><span style="color:#3B82F6;">QR ✓</span>' : ''}
        </div>
        <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:2px;font-family:monospace;
          word-break:break-all;">${esc(ed.flipbookUrl)}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="btn btn-ghost btn-sm" data-act="qr" data-id="${esc(ed.id)}"
          title="Regenerar QR Code" style="font-size:0.75rem;">📱</button>
        <button class="btn btn-ghost btn-sm" data-act="edit" data-id="${esc(ed.id)}"
          title="Editar" style="font-size:0.75rem;">✎</button>
        <button class="btn btn-ghost btn-sm" data-act="delete" data-id="${esc(ed.id)}"
          title="Remover" style="font-size:0.75rem;color:var(--color-danger);">✕</button>
      </div>
    </div>
  `;
}

async function handleDeleteEdition(body, ed) {
  if (!confirm(`Remover edição "${ed.subtitle}"?\n\nIsso apaga TAMBÉM os PDFs e arquivos no R2.\nNão pode ser desfeito.`)) return;
  try {
    await deleteEdition(ed.id);
    toast.success('Edição removida.');
    await renderEditionsTab(body);
  } catch (e) { toast.error('Erro: ' + e.message); }
}

async function handleRegenerateQr(body, ed) {
  if (!confirm(`Regenerar QR Code da edição "${ed.subtitle}"?\nApontará para: ${ed.flipbookUrl}`)) return;
  const tid = toast.info('Gerando QR…');
  try {
    await regenerateEditionQr(ed.id, ed.slug, ed.flipbookUrl);
    toast.remove(tid);
    toast.success('QR regenerado.');
    await renderEditionsTab(body);
  } catch (e) { toast.remove(tid); toast.error('Erro: ' + e.message); }
}

/* ─── Form de criar/editar edição ──────────────────────────── */
function openEditionForm(parentBody, existing) {
  const isEdit = !!existing?.id;
  const m = document.createElement('div');
  m.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;

  const slugDefault = existing?.slug || '';
  const numberDefault = existing?.number || '';

  m.innerHTML = `
    <div class="card" style="width:100%;max-width:680px;max-height:92vh;
      padding:0;overflow:hidden;display:flex;flex-direction:column;">
      <div style="padding:16px 22px;background:var(--bg-surface);
        border-bottom:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;">
        <div style="font-weight:700;font-size:1rem;">
          📖 ${isEdit ? 'Editar' : 'Nova'} edição
        </div>
        <button id="ltf-close" style="border:none;background:none;cursor:pointer;
          font-size:1.25rem;color:var(--text-muted);">✕</button>
      </div>

      <div style="overflow-y:auto;flex:1;padding:18px 22px;display:flex;flex-direction:column;gap:14px;">

        <!-- Number + active -->
        <div style="display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:end;">
          <div>
            <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Número *</label>
            <input id="ltf-number" type="number" min="1" max="999" class="portal-field"
              value="${esc(String(numberDefault))}" style="width:90px;" placeholder="07">
          </div>
          <div>
            <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Slug (URL)</label>
            <input id="ltf-slug" type="text" class="portal-field" style="width:100%;"
              value="${esc(slugDefault)}" placeholder="luxury-travel-07"
              ${isEdit ? 'disabled style="opacity:0.6;cursor:not-allowed;width:100%;"' : ''}>
          </div>
          <label style="display:flex;align-items:center;gap:6px;font-size:0.75rem;cursor:pointer;
            padding-bottom:8px;">
            <input type="checkbox" id="ltf-active" ${existing?.active !== false ? 'checked' : ''}>
            Visível
          </label>
        </div>

        <!-- Title + Subtitle -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Título</label>
            <input id="ltf-title" type="text" class="portal-field" style="width:100%;"
              value="${esc(existing?.title || 'LUXURY TRAVEL')}" maxlength="100">
          </div>
          <div>
            <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Subtítulo</label>
            <input id="ltf-subtitle" type="text" class="portal-field" style="width:100%;"
              value="${esc(existing?.subtitle || '')}" placeholder="Edition 07" maxlength="100">
          </div>
        </div>

        <!-- Pages + publishedAt -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Páginas</label>
            <input id="ltf-pages" type="number" min="0" max="999" class="portal-field" style="width:100%;"
              value="${esc(String(existing?.pages || ''))}" placeholder="139">
          </div>
          <div>
            <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Publicação</label>
            <input id="ltf-published" type="date" class="portal-field" style="width:100%;"
              value="${existing?.publishedAt
                ? new Date(existing.publishedAt?.toDate?.() || existing.publishedAt).toISOString().slice(0,10)
                : ''}">
          </div>
        </div>

        <!-- Flipbook URL -->
        <div>
          <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">
            URL do Flipbook (GitHub Pages)
          </label>
          <input id="ltf-flipbook" type="url" class="portal-field" style="width:100%;font-family:monospace;font-size:0.75rem;"
            value="${esc(existing?.flipbookUrl || '')}"
            placeholder="https://primetour.github.io/luxury-travel/luxury-travel-07/">
          <div style="font-size:0.65rem;color:var(--text-muted);margin-top:4px;font-style:italic;">
            Auto-preenchido a partir do slug. Edite só se precisa apontar pra outra URL.
          </div>
        </div>

        ${isEdit ? `
          <!-- Upload PDFs (só no edit, depois que tem ID) -->
          <div style="background:var(--bg-surface);padding:14px;border-radius:var(--radius-md);
            border:1px solid var(--border-subtle);">
            <label style="font-size:0.75rem;font-weight:700;display:block;margin-bottom:10px;
              color:var(--text-primary);text-transform:uppercase;letter-spacing:0.06em;">
              📁 PDFs da edição
            </label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div>
                <div style="font-size:0.75rem;font-weight:600;margin-bottom:6px;">Português</div>
                ${existing.pt?.pdfUrl ? `
                  <div style="font-size:0.7rem;color:#22C55E;margin-bottom:6px;">
                    ✓ ${formatBytes(existing.pt.pdfSize)}
                  </div>
                ` : '<div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:6px;">Sem PDF</div>'}
                <input type="file" id="ltf-pdf-pt" accept="application/pdf"
                  style="font-size:0.75rem;width:100%;">
                <div id="ltf-pdf-pt-progress" style="font-size:0.65rem;color:var(--text-muted);margin-top:4px;"></div>
              </div>
              <div>
                <div style="font-size:0.75rem;font-weight:600;margin-bottom:6px;">English</div>
                ${existing.en?.pdfUrl ? `
                  <div style="font-size:0.7rem;color:#22C55E;margin-bottom:6px;">
                    ✓ ${formatBytes(existing.en.pdfSize)}
                  </div>
                ` : '<div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:6px;">No PDF</div>'}
                <input type="file" id="ltf-pdf-en" accept="application/pdf"
                  style="font-size:0.75rem;width:100%;">
                <div id="ltf-pdf-en-progress" style="font-size:0.65rem;color:var(--text-muted);margin-top:4px;"></div>
              </div>
            </div>
            <div style="font-size:0.65rem;color:var(--text-muted);margin-top:8px;font-style:italic;">
              Capa é extraída automaticamente da página 1 do PDF. Max 100MB por PDF.
            </div>
          </div>

          <!-- Translation hint -->
          <div style="background:rgba(167,139,250,0.08);border:1px solid rgba(167,139,250,0.2);
            padding:10px 12px;border-radius:var(--radius-sm);font-size:0.75rem;color:var(--text-secondary);">
            💡 <strong>Tradução:</strong> revista de luxo precisa de tradução pixel-perfect (texto + diagramação).
            Recomendamos fluxo externo (tradutor + designer). Pra acelerar revisão de texto,
            <a href="https://claude.ai/" target="_blank" rel="noopener" style="color:var(--brand-gold);">
              abra o Claude.ai
            </a> e cole o conteúdo.
          </div>
        ` : `
          <div style="background:rgba(212,168,67,0.08);border:1px solid rgba(212,168,67,0.2);
            padding:10px 12px;border-radius:var(--radius-sm);font-size:0.75rem;color:var(--text-secondary);">
            ℹ Após salvar, você poderá fazer upload dos PDFs (PT e EN). A capa será extraída automaticamente.
          </div>
        `}
      </div>

      <div style="padding:14px 22px;border-top:1px solid var(--border-subtle);
        background:var(--bg-surface);display:flex;gap:10px;">
        <button class="btn btn-secondary" id="ltf-cancel" style="flex:1;">Cancelar</button>
        <button class="btn btn-primary" id="ltf-save" style="flex:2;font-weight:600;">
          💾 ${isEdit ? 'Salvar alterações' : 'Criar edição'}
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  m.querySelector('#ltf-close').addEventListener('click', () => m.remove());
  m.querySelector('#ltf-cancel').addEventListener('click', () => m.remove());

  // Auto-suggest slug a partir do número (apenas no create)
  if (!isEdit) {
    m.querySelector('#ltf-number').addEventListener('input', e => {
      const n = parseInt(e.target.value);
      if (!n) return;
      const slugInput = m.querySelector('#ltf-slug');
      const flipInput = m.querySelector('#ltf-flipbook');
      slugInput.value = `luxury-travel-${String(n).padStart(2, '0')}`;
      flipInput.value = `${LUXURY_TRAVEL_GH_BASE}/${slugInput.value}/`;
      const subInput = m.querySelector('#ltf-subtitle');
      if (!subInput.value) subInput.value = `Edition ${String(n).padStart(2, '0')}`;
    });
  }

  // PDF upload handlers (só no edit)
  if (isEdit) {
    ['pt', 'en'].forEach(lang => {
      m.querySelector(`#ltf-pdf-${lang}`)?.addEventListener('change', async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        const progEl = m.querySelector(`#ltf-pdf-${lang}-progress`);
        progEl.textContent = '0%';
        try {
          await uploadEditionPdf(existing.id, file, lang, existing.slug, (loaded, total) => {
            const pct = Math.round((loaded / total) * 100);
            progEl.textContent = `${pct}% — ${formatBytes(loaded)} / ${formatBytes(total)}`;
          });
          progEl.textContent = `✓ Upload concluído`;
          progEl.style.color = '#22C55E';
          toast.success(`PDF ${lang.toUpperCase()} enviado.`);
        } catch (err) {
          progEl.textContent = `Erro: ${err.message}`;
          progEl.style.color = '#EF4444';
          toast.error('Erro: ' + err.message);
        }
      });
    });
  }

  // Save
  m.querySelector('#ltf-save').addEventListener('click', async () => {
    const number = parseInt(m.querySelector('#ltf-number').value);
    if (!number) { toast.error('Número da edição obrigatório.'); return; }
    const data = {
      number,
      slug: m.querySelector('#ltf-slug').value.trim() || `luxury-travel-${String(number).padStart(2,'0')}`,
      title: m.querySelector('#ltf-title').value.trim(),
      subtitle: m.querySelector('#ltf-subtitle').value.trim(),
      pages: parseInt(m.querySelector('#ltf-pages').value) || 0,
      publishedAt: m.querySelector('#ltf-published').value || null,
      flipbookUrl: m.querySelector('#ltf-flipbook').value.trim(),
      active: m.querySelector('#ltf-active').checked,
    };
    try {
      if (isEdit) {
        await updateEdition(existing.id, data);
        toast.success('Edição atualizada.');
      } else {
        await createEdition(data);
        toast.success('Edição criada. Reabra pra fazer upload dos PDFs.');
      }
      m.remove();
      await renderEditionsTab(parentBody);
    } catch (e) { toast.error('Erro: ' + e.message); }
  });
}

/* ════════════════════════════════════════════════════════════
   TAB 2: FONTES
   ════════════════════════════════════════════════════════════ */

async function renderFontsTab(body) {
  const fonts = await fetchFonts();
  body.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <div style="font-size:0.8125rem;color:var(--text-muted);">
        ${fonts.length} ${fonts.length === 1 ? 'fonte cadastrada' : 'fontes cadastradas'}
      </div>
      <label class="btn btn-primary btn-sm" style="cursor:pointer;">
        + Upload de fonte
        <input type="file" id="lt-font-upload" accept=".otf,.ttf,.woff,.woff2"
          style="display:none;">
      </label>
    </div>

    ${fonts.length === 0 ? `
      <div class="empty-state">
        <div class="empty-state-icon">🔤</div>
        <div class="empty-state-title">Nenhuma fonte cadastrada</div>
        <div class="empty-state-message">As fontes ficam disponíveis pra usar em futuras edições da revista.</div>
      </div>
    ` : `
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${fonts.map(f => `
          <div class="card" style="padding:10px 14px;display:flex;align-items:center;gap:12px;">
            <div style="width:32px;height:32px;background:var(--bg-elevated);border-radius:6px;
              display:flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;
              color:var(--text-muted);flex-shrink:0;">${esc(f.format?.toUpperCase() || '?')}</div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:0.875rem;color:var(--text-primary);">
                ${esc(f.family)}
                <span style="font-weight:400;color:var(--text-muted);font-size:0.75rem;">
                  · weight ${f.weight} · ${esc(f.style)}
                </span>
              </div>
              <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;font-family:monospace;">
                ${esc(f.filename)} · ${formatBytes(f.size)} · enviado por ${esc(f.uploadedBy?.name || '—')} em ${fmtDate(f.uploadedAt)}
              </div>
            </div>
            <a href="${esc(f.url)}" download target="_blank" rel="noopener"
              class="btn btn-ghost btn-sm" style="font-size:0.75rem;text-decoration:none;">⬇</a>
            <button class="btn btn-ghost btn-sm" data-act="del-font" data-id="${esc(f.id)}"
              style="font-size:0.75rem;color:var(--color-danger);">✕</button>
          </div>
        `).join('')}
      </div>
    `}
  `;

  body.querySelector('#lt-font-upload')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    const tid = toast.info(`Enviando ${file.name}…`);
    try {
      await uploadFont(file);
      toast.remove(tid);
      toast.success('Fonte enviada.');
      await renderFontsTab(body);
    } catch (err) {
      toast.remove(tid);
      toast.error('Erro: ' + err.message);
    }
  });

  fonts.forEach(f => {
    body.querySelector(`[data-act="del-font"][data-id="${f.id}"]`)?.addEventListener('click', async () => {
      if (!confirm(`Remover fonte "${f.family}"?\nO arquivo será apagado do R2.`)) return;
      try {
        await deleteFont(f.id);
        toast.success('Fonte removida.');
        await renderFontsTab(body);
      } catch (err) { toast.error('Erro: ' + err.message); }
    });
  });
}

/* ════════════════════════════════════════════════════════════
   TAB 3: CONFIGURAÇÕES
   ════════════════════════════════════════════════════════════ */

async function renderSettingsTab(body) {
  const settings = await fetchSettings();
  body.innerHTML = `
    <div style="max-width:680px;display:flex;flex-direction:column;gap:20px;">

      <div class="card" style="padding:18px 22px;">
        <h3 style="margin:0 0 14px;font-size:0.9375rem;font-weight:600;">🌐 Hub público</h3>

        <div style="margin-bottom:14px;">
          <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">URL do Hub</label>
          <input id="lts-home-url" type="url" class="portal-field" style="width:100%;font-family:monospace;font-size:0.75rem;"
            value="${esc(settings.homeUrl || '')}">
        </div>

        <div style="margin-bottom:14px;">
          <label style="font-size:0.75rem;font-weight:600;display:block;margin-bottom:5px;">Descrição</label>
          <textarea id="lts-description" class="portal-field" style="width:100%;resize:vertical;" rows="3"
            maxlength="500">${esc(settings.description || '')}</textarea>
        </div>

        <div style="display:flex;gap:10px;align-items:center;">
          <button class="btn btn-primary btn-sm" id="lts-save">💾 Salvar configurações</button>
          <button class="btn btn-secondary btn-sm" id="lts-regen-qr">🔄 Regenerar QR da home</button>
        </div>

        ${settings.homeQrUrl ? `
          <div style="margin-top:16px;padding:12px;background:var(--bg-elevated);border-radius:var(--radius-md);
            display:flex;gap:14px;align-items:center;">
            <img src="${esc(settings.homeQrUrl)}" alt="QR home"
              style="width:90px;height:90px;background:#fff;padding:6px;border-radius:6px;flex-shrink:0;" />
            <div style="flex:1;font-size:0.75rem;color:var(--text-muted);">
              QR Code atual da home. Aponta para: <strong>${esc(settings.homeUrl)}</strong>
              <br>
              <a href="${esc(settings.homeQrUrl)}" download="qr-luxury-travel-home.png" target="_blank" rel="noopener"
                class="btn btn-ghost btn-sm" style="margin-top:6px;text-decoration:none;font-size:0.7rem;">
                ⬇ Baixar PNG
              </a>
            </div>
          </div>
        ` : `
          <div style="margin-top:12px;font-size:0.7rem;color:var(--text-muted);font-style:italic;">
            Ainda não há QR Code da home. Clique em "Regenerar" pra criar.
          </div>
        `}
      </div>

      <div class="card" style="padding:18px 22px;">
        <h3 style="margin:0 0 14px;font-size:0.9375rem;font-weight:600;">📦 Repositório técnico</h3>
        <div style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.6;">
          O flipbook em si (HTML+JS+imagens) está hospedado em GitHub Pages no repo
          <a href="https://github.com/${esc(settings.ghRepo)}" target="_blank" rel="noopener"
            style="color:var(--brand-gold);font-family:monospace;">${esc(settings.ghRepo)}</a>.
          O sistema apenas cataloga as edições, gera QR codes e gerencia uploads.
        </div>
      </div>
    </div>
  `;

  body.querySelector('#lts-save')?.addEventListener('click', async () => {
    try {
      await updateSettings({
        homeUrl: body.querySelector('#lts-home-url').value.trim(),
        description: body.querySelector('#lts-description').value.trim(),
      });
      toast.success('Configurações salvas.');
      await renderSettingsTab(body);
    } catch (e) { toast.error('Erro: ' + e.message); }
  });

  body.querySelector('#lts-regen-qr')?.addEventListener('click', async () => {
    if (!confirm('Regenerar QR Code da home?')) return;
    const tid = toast.info('Gerando QR…');
    try {
      await regenerateHomeQr();
      toast.remove(tid);
      toast.success('QR regenerado.');
      await renderSettingsTab(body);
    } catch (e) { toast.remove(tid); toast.error('Erro: ' + e.message); }
  });
}
