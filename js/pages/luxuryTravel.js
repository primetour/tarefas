/**
 * PRIMETOUR — Revista Luxury Travel (página pública)
 *
 * Lista as edições disponíveis, com:
 *   - Cover + título + subtítulo + páginas + data
 *   - 📖 Ler online (flipbook GH Pages)
 *   - ⬇ PDF PT
 *   - ⬇ PDF EN
 *   - 📱 QR Code (modal com download PNG)
 *   - 🔗 Copiar link
 *
 * Header tem QR da home (link genérico) com download PNG.
 *
 * Admin (canManageLuxuryTravel) vê botão "Administrar" → vai pra
 * #luxury-travel-admin.
 */

import { store } from '../store.js';
import { toast } from '../components/toast.js';
import {
  fetchEditions, fetchSettings, generateQrDataUrl, generateQrPng,
  formatBytes, seedFromGithubEditions,
} from '../services/luxuryTravel.js?v=20260503aaa1';

const esc = s => String(s || '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const fmtDate = ts => {
  if (!ts) return '';
  const d = ts?.toDate?.() || new Date(ts);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
};

export async function renderLuxuryTravel(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">
          <span style="background:linear-gradient(135deg,#b48a4a,#d4a843);
            -webkit-background-clip:text;-webkit-text-fill-color:transparent;
            font-weight:700;">Revista Luxury Travel</span>
        </h1>
        <div style="font-size:0.875rem;color:var(--text-muted);margin-top:4px;">
          Biblioteca bilíngue (PT / EN) das edições by PRIMETOUR
        </div>
      </div>
      <div class="page-header-actions" id="lt-header-actions"></div>
    </div>

    <div id="lt-home-card"></div>
    <div id="lt-editions-grid" style="margin-top:24px;"></div>
  `;

  // Header actions: admin link se permitido
  const actions = container.querySelector('#lt-header-actions');
  if (store.canManageLuxuryTravel()) {
    actions.innerHTML = `
      <a href="#luxury-travel-admin" class="btn btn-secondary btn-sm">
        ⚙ Administrar
      </a>
    `;
  }

  // Carrega settings + edições + faz seed se vazio
  let editions = [];
  let settings = {};
  try {
    [editions, settings] = await Promise.all([
      fetchEditions({ activeOnly: false }),
      fetchSettings(),
    ]);
    // Auto-seed na primeira load se vazio (admin vê acontecer)
    if (editions.length === 0 && store.canManageLuxuryTravel()) {
      const result = await seedFromGithubEditions();
      if (result.created > 0) {
        toast.success(`${result.created} edições importadas do GitHub.`);
        editions = await fetchEditions();
      }
    }
  } catch (e) {
    console.error('[luxuryTravel]', e);
    container.querySelector('#lt-editions-grid').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">Erro ao carregar edições</div>
        <div class="empty-state-message">${esc(e.message)}</div>
      </div>
    `;
    return;
  }

  renderHomeCard(container, settings);
  renderEditionsGrid(container, editions);
}

function renderHomeCard(container, settings) {
  const card = container.querySelector('#lt-home-card');
  if (!card) return;
  card.innerHTML = `
    <div class="card" style="padding:18px 22px;display:flex;align-items:center;gap:18px;flex-wrap:wrap;
      background:linear-gradient(135deg,rgba(180,138,74,0.08),rgba(212,168,67,0.04));
      border:1px solid rgba(212,168,67,0.2);">
      <div style="flex:1;min-width:240px;">
        <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;
          color:var(--brand-gold);margin-bottom:6px;">📚 Hub da revista</div>
        <div style="font-size:1rem;font-weight:600;color:var(--text-primary);margin-bottom:6px;">
          Acesse todas as edições
        </div>
        <div style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.5;">
          ${esc(settings.description || 'Biblioteca bilíngue (PT / EN) das edições da revista LUXURY TRAVEL.')}
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">
          <a href="${esc(settings.homeUrl)}" target="_blank" rel="noopener"
            class="btn btn-primary btn-sm">↗ Abrir hub público</a>
          <button class="btn btn-secondary btn-sm" id="lt-home-qr-btn">📱 QR Code da home</button>
          <button class="btn btn-ghost btn-sm" id="lt-home-copy-btn">🔗 Copiar link</button>
        </div>
      </div>
      ${settings.homeQrUrl ? `
        <div style="flex-shrink:0;">
          <img src="${esc(settings.homeQrUrl)}" alt="QR Code home"
            style="width:120px;height:120px;border-radius:8px;background:#fff;padding:8px;
            border:1px solid var(--border-subtle);" />
        </div>
      ` : ''}
    </div>
  `;

  card.querySelector('#lt-home-qr-btn')?.addEventListener('click', () => {
    openQrModal('Hub da revista', settings.homeUrl, 'luxury-travel-home');
  });
  card.querySelector('#lt-home-copy-btn')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(settings.homeUrl);
      toast.success('Link copiado.');
    } catch { toast.error('Não foi possível copiar.'); }
  });
}

function renderEditionsGrid(container, editions) {
  const grid = container.querySelector('#lt-editions-grid');
  if (!grid) return;

  if (editions.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="padding:60px 20px;">
        <div class="empty-state-icon">📖</div>
        <div class="empty-state-title">Nenhuma edição cadastrada ainda</div>
        <div class="empty-state-message">${
          store.canManageLuxuryTravel()
            ? 'Vá em Administrar pra adicionar a primeira edição.'
            : 'Volte em breve.'
        }</div>
      </div>
    `;
    return;
  }

  grid.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px;">
      ${editions.map(renderEditionCard).join('')}
    </div>
  `;

  // Bind buttons
  editions.forEach(ed => {
    grid.querySelector(`[data-act="qr"][data-id="${ed.id}"]`)?.addEventListener('click', () => {
      openQrModal(`${ed.title} · ${ed.subtitle}`, ed.flipbookUrl, ed.slug);
    });
    grid.querySelector(`[data-act="copy"][data-id="${ed.id}"]`)?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(ed.flipbookUrl);
        toast.success('Link copiado.');
      } catch { toast.error('Não foi possível copiar.'); }
    });
  });
}

function renderEditionCard(ed) {
  const cover = ed.pt?.coverUrl || ed.en?.coverUrl || null;
  const inactive = ed.active === false;
  const ptPdf = ed.pt?.pdfUrl;
  const enPdf = ed.en?.pdfUrl;
  const ptSize = ed.pt?.pdfSize ? formatBytes(ed.pt.pdfSize) : '';
  const enSize = ed.en?.pdfSize ? formatBytes(ed.en.pdfSize) : '';

  return `
    <div class="card" style="padding:0;overflow:hidden;display:flex;flex-direction:column;
      ${inactive ? 'opacity:0.5;' : ''}">

      <!-- Cover -->
      <div style="aspect-ratio:3/4;background:var(--bg-elevated);position:relative;overflow:hidden;">
        ${cover ? `
          <img src="${esc(cover)}" alt="Capa ${esc(ed.subtitle)}"
            style="width:100%;height:100%;object-fit:cover;display:block;" />
        ` : `
          <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;
            background:linear-gradient(135deg,#b48a4a,#d4a843);color:#fff;flex-direction:column;gap:8px;">
            <div style="font-size:2rem;">📖</div>
            <div style="font-size:0.875rem;font-weight:600;">${esc(ed.subtitle)}</div>
          </div>
        `}
        ${inactive ? `
          <div style="position:absolute;top:8px;right:8px;background:rgba(0,0,0,.7);color:#fff;
            font-size:0.6875rem;padding:3px 8px;border-radius:var(--radius-full);font-weight:600;">
            Oculta
          </div>
        ` : ''}
      </div>

      <!-- Body -->
      <div style="padding:14px 16px;display:flex;flex-direction:column;flex:1;">
        <div style="font-size:0.6875rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;
          color:var(--brand-gold);margin-bottom:4px;">
          ${esc(ed.title || 'LUXURY TRAVEL')}
        </div>
        <div style="font-size:1rem;font-weight:600;color:var(--text-primary);margin-bottom:6px;">
          ${esc(ed.subtitle || `Edition ${ed.number}`)}
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:12px;">
          ${ed.pages ? `${ed.pages} páginas` : ''}${
            ed.pages && ed.publishedAt ? ' · ' : ''
          }${esc(fmtDate(ed.publishedAt))}
        </div>

        <!-- Actions -->
        <div style="display:flex;flex-direction:column;gap:6px;margin-top:auto;">
          <a href="${esc(ed.flipbookUrl)}" target="_blank" rel="noopener"
            class="btn btn-primary btn-sm" style="text-decoration:none;text-align:center;">
            📖 Ler online
          </a>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            ${ptPdf ? `
              <a href="${esc(ptPdf)}" target="_blank" rel="noopener" download
                class="btn btn-secondary btn-sm" style="text-decoration:none;text-align:center;font-size:0.75rem;"
                title="${ptSize ? 'Tamanho: ' + ptSize : ''}">
                ⬇ PT
              </a>
            ` : `
              <button class="btn btn-ghost btn-sm" disabled style="font-size:0.75rem;opacity:0.5;cursor:not-allowed;">
                ⬇ PT
              </button>
            `}
            ${enPdf ? `
              <a href="${esc(enPdf)}" target="_blank" rel="noopener" download
                class="btn btn-secondary btn-sm" style="text-decoration:none;text-align:center;font-size:0.75rem;"
                title="${enSize ? 'Size: ' + enSize : ''}">
                ⬇ EN
              </a>
            ` : `
              <button class="btn btn-ghost btn-sm" disabled style="font-size:0.75rem;opacity:0.5;cursor:not-allowed;">
                ⬇ EN
              </button>
            `}
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
            <button class="btn btn-ghost btn-sm" data-act="qr" data-id="${esc(ed.id)}"
              style="font-size:0.75rem;">📱 QR</button>
            <button class="btn btn-ghost btn-sm" data-act="copy" data-id="${esc(ed.id)}"
              style="font-size:0.75rem;">🔗 Link</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/** Modal com QR code grande + botão de download. */
async function openQrModal(title, url, slug) {
  const m = document.createElement('div');
  m.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;
  m.innerHTML = `
    <div class="card" style="width:100%;max-width:420px;padding:24px;text-align:center;
      display:flex;flex-direction:column;gap:16px;">
      <div>
        <div style="font-weight:700;font-size:1rem;color:var(--text-primary);margin-bottom:4px;">
          📱 QR Code
        </div>
        <div style="font-size:0.8125rem;color:var(--text-muted);">${esc(title)}</div>
      </div>
      <div id="lt-qr-canvas" style="background:#fff;padding:16px;border-radius:var(--radius-md);
        display:flex;align-items:center;justify-content:center;min-height:280px;">
        <div style="color:#666;font-size:0.8125rem;">Gerando…</div>
      </div>
      <div style="font-size:0.75rem;color:var(--text-muted);word-break:break-all;line-height:1.4;">
        ${esc(url)}
      </div>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-secondary" id="lt-qr-cancel" style="flex:1;">Fechar</button>
        <button class="btn btn-primary" id="lt-qr-download" style="flex:2;font-weight:600;">
          ⬇ Baixar PNG
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  m.querySelector('#lt-qr-cancel').addEventListener('click', () => m.remove());

  // Gera QR
  let qrBlob = null;
  try {
    const dataUrl = await generateQrDataUrl(url, 320);
    m.querySelector('#lt-qr-canvas').innerHTML = `
      <img src="${dataUrl}" alt="QR Code"
        style="width:280px;height:280px;display:block;" />
    `;
    qrBlob = await generateQrPng(url, 1024);
  } catch (e) {
    m.querySelector('#lt-qr-canvas').innerHTML =
      `<div style="color:#c00;font-size:0.8125rem;padding:20px;">Erro: ${esc(e.message)}</div>`;
    return;
  }

  m.querySelector('#lt-qr-download').addEventListener('click', () => {
    if (!qrBlob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(qrBlob);
    a.download = `qr-${slug || 'luxury-travel'}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
}
