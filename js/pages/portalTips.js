/**
 * PRIMETOUR — Portal de Dicas
 * Página principal: seleção de área, destino e segmentos → geração de material
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import {
  fetchAreas, fetchDestinations, fetchContinentsWithContent,
  fetchTip, fetchAvailableSegments, checkDownloadLimit,
  hasAcceptedTerms, getActiveTerms, acceptTerms,
  recordGeneration, registerDownload,
  SEGMENTS, GENERATION_FORMATS,
} from '../services/portal.js';

const esc = s => String(s||'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function renderPortalTips(container) {
  if (!store.canPortal()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
      <div class="empty-state-subtitle">Você não tem permissão para acessar o Portal de Dicas.</div>
    </div>`;
    return;
  }

  // Check terms acceptance
  const terms = await getActiveTerms();
  if (terms) {
    const accepted = await hasAcceptedTerms(terms.id);
    if (!accepted) {
      renderTermsModal(container, terms, () => renderPortalTips(container));
      return;
    }
  }

  // Check download limit for partners
  const limitInfo = await checkDownloadLimit();

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Portal de Dicas</h1>
        <p class="page-subtitle">Gere materiais personalizados para seus clientes viajantes</p>
      </div>
      ${store.canCreateTip() ? `
        <div class="page-header-actions">
          <button class="btn btn-secondary btn-sm" onclick="location.hash='portal-destinations'">
            ◈ Destinos
          </button>
          <button class="btn btn-secondary btn-sm" onclick="location.hash='portal-areas'">
            ◈ Áreas
          </button>
          <button class="btn btn-primary btn-sm" onclick="location.hash='portal-tip-editor'">
            + Nova Dica
          </button>
        </div>
      ` : ''}
    </div>

    ${store.isPartner() ? `
      <div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--radius-md);
        padding:12px 16px;margin-bottom:20px;display:flex;align-items:center;gap:10px;">
        <span style="font-size:1.125rem;">📥</span>
        <span style="font-size:0.875rem;color:var(--text-secondary);">
          Downloads hoje: <strong style="color:${limitInfo.remaining > 1 ? 'var(--text-primary)' : '#EF4444'};">
            ${limitInfo.count} / ${5}
          </strong>
          ${limitInfo.remaining <= 0 ? ' — Limite diário atingido.' : ` — ${limitInfo.remaining} restante${limitInfo.remaining !== 1 ? 's' : ''}.`}
        </span>
      </div>
    ` : ''}

    <!-- Generation form -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:1100px;">

      <!-- Left: Selection -->
      <div>
        <div class="card" style="padding:24px;margin-bottom:16px;">
          <h3 style="font-size:0.875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
            color:var(--text-muted);margin:0 0 16px;">1 · Área</h3>
          <div id="portal-areas-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">
            <div class="skeleton" style="height:64px;border-radius:var(--radius-md);"></div>
            <div class="skeleton" style="height:64px;border-radius:var(--radius-md);"></div>
            <div class="skeleton" style="height:64px;border-radius:var(--radius-md);"></div>
          </div>
        </div>

        <div class="card" style="padding:24px;margin-bottom:16px;">
          <h3 style="font-size:0.875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
            color:var(--text-muted);margin:0 0 16px;">2 · Destino</h3>
          <div style="display:flex;flex-direction:column;gap:10px;">
            <select class="filter-select" id="portal-continent" style="width:100%;">
              <option value="">Carregando continentes…</option>
            </select>
            <select class="filter-select" id="portal-country" style="width:100%;" disabled>
              <option value="">Selecione o país</option>
            </select>
            <select class="filter-select" id="portal-city" style="width:100%;" disabled>
              <option value="">Cidade/Região (opcional)</option>
            </select>
          </div>

          <!-- Add destination button -->
          <div style="margin-top:12px;display:flex;gap:8px;align-items:center;">
            <button class="btn btn-ghost btn-sm" id="portal-add-dest-btn"
              style="font-size:0.75rem;color:var(--brand-gold);">
              + Combinar outro destino
            </button>
          </div>
          <div id="portal-extra-dests"></div>
        </div>

        <div class="card" style="padding:24px;">
          <h3 style="font-size:0.875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
            color:var(--text-muted);margin:0 0 16px;">3 · Segmentos</h3>
          <div style="display:flex;justify-content:space-between;margin-bottom:10px;">
            <button class="btn btn-ghost btn-sm" id="portal-seg-all" style="font-size:0.75rem;">
              Todos
            </button>
            <button class="btn btn-ghost btn-sm" id="portal-seg-none" style="font-size:0.75rem;">
              Nenhum
            </button>
          </div>
          <div id="portal-segments" style="display:flex;flex-direction:column;gap:6px;">
            <div style="font-size:0.8125rem;color:var(--text-muted);padding:8px 0;text-align:center;">
              Selecione um destino para ver os segmentos disponíveis.
            </div>
          </div>
        </div>
      </div>

      <!-- Right: Preview + Generate -->
      <div>
        <div class="card" style="padding:24px;margin-bottom:16px;">
          <h3 style="font-size:0.875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
            color:var(--text-muted);margin:0 0 16px;">Formato de saída</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            ${GENERATION_FORMATS.map(f => `
              <label style="display:flex;align-items:center;gap:8px;padding:10px 12px;
                border:1px solid var(--border-subtle);border-radius:var(--radius-md);
                cursor:pointer;transition:all .15s;"
                id="fmt-label-${f.key}"
                onmouseover="this.style.borderColor='var(--brand-gold)'"
                onmouseout="document.querySelector('input[value=${f.key}]').checked?null:this.style.borderColor='var(--border-subtle)'">
                <input type="radio" name="format" value="${f.key}" ${f.key === 'pdf' ? 'checked' : ''}
                  style="accent-color:var(--brand-gold);"
                  onchange="document.querySelectorAll('[id^=fmt-label-]').forEach(l=>l.style.borderColor='var(--border-subtle)');this.closest('label').style.borderColor='var(--brand-gold)'">
                <span style="font-size:0.875rem;">${esc(f.label)}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <!-- Tip preview card -->
        <div class="card" id="portal-preview-card" style="padding:24px;margin-bottom:16px;min-height:200px;">
          <div style="color:var(--text-muted);font-size:0.875rem;text-align:center;padding:40px 0;">
            Selecione uma área e um destino para ver a pré-visualização.
          </div>
        </div>

        <!-- Generate button -->
        <button class="btn btn-primary" id="portal-generate-btn"
          style="width:100%;padding:14px;font-size:1rem;font-weight:600;
          ${!limitInfo.allowed && store.isPartner() ? 'opacity:.5;cursor:not-allowed;' : ''}"
          ${!limitInfo.allowed && store.isPartner() ? 'disabled' : ''}>
          ✈ Gerar Material
        </button>

        <p style="font-size:0.75rem;color:var(--text-muted);text-align:center;margin-top:8px;">
          Cada geração cria um link exclusivo e permanente.
        </p>
      </div>
    </div>
  `;

  await initPortalForm();
}

/* ─── Init form logic ─────────────────────────────────────── */
async function initPortalForm() {
  // Load areas
  try {
    const areas = await fetchAreas();
    const grid  = document.getElementById('portal-areas-grid');
    if (grid) {
      if (!areas.length) {
        grid.innerHTML = `<div style="grid-column:1/-1;color:var(--text-muted);font-size:0.8125rem;
          padding:12px 0;">Nenhuma área cadastrada.
          ${store.canManagePortal() ? '<a href="#portal-areas" style="color:var(--brand-gold);">Cadastrar área</a>' : ''}
        </div>`;
      } else {
        grid.innerHTML = areas.map(a => `
          <button class="portal-area-btn" data-id="${a.id}"
            style="display:flex;flex-direction:column;align-items:center;justify-content:center;
            gap:6px;padding:10px 6px;border:2px solid var(--border-subtle);
            border-radius:var(--radius-md);background:transparent;cursor:pointer;
            transition:all .15s;min-height:64px;"
            onmouseover="this.style.borderColor='var(--brand-gold)'"
            onmouseout="this.classList.contains('selected')?null:this.style.borderColor='var(--border-subtle)'">
            ${a.logoUrl
              ? `<img src="${esc(a.logoUrl)}" style="height:28px;object-fit:contain;" alt="${esc(a.name)}">`
              : `<span style="font-size:0.8125rem;font-weight:600;color:var(--text-primary);">${esc(a.name)}</span>`
            }
            <span style="font-size:0.6875rem;color:var(--text-muted);">${esc(a.name)}</span>
          </button>
        `).join('');

        grid.querySelectorAll('.portal-area-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            grid.querySelectorAll('.portal-area-btn').forEach(b => {
              b.classList.remove('selected');
              b.style.borderColor = 'var(--border-subtle)';
              b.style.background  = 'transparent';
            });
            btn.classList.add('selected');
            btn.style.borderColor = 'var(--brand-gold)';
            btn.style.background  = 'var(--brand-gold)18';
            updatePreview();
          });
        });
      }
    }
  } catch(e) { console.warn('fetchAreas:', e.message); }

  // Load continents
  try {
    const continents = await fetchContinentsWithContent();
    const sel = document.getElementById('portal-continent');
    if (sel) {
      sel.innerHTML = `<option value="">Selecione o continente</option>` +
        continents.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      sel.disabled = false;
      sel.addEventListener('change', () => onContinentChange());
    }
  } catch(e) {}

  // Country change
  document.getElementById('portal-country')?.addEventListener('change', () => onCountryChange());
  document.getElementById('portal-city')?.addEventListener('change', async () => {
    const continent = document.getElementById('portal-continent')?.value;
    const country   = document.getElementById('portal-country')?.value;
    const city      = document.getElementById('portal-city')?.value;
    const dests     = await fetchDestinations({ continent, country });
    const dest      = city ? dests.find(d => d.city === city) : dests.find(d => !d.city) || dests[0];
    if (dest) await updateSegments(dest.id);
    updatePreview();
  });

  // Segments
  document.getElementById('portal-seg-all')?.addEventListener('click', () => {
    document.querySelectorAll('input[name=segment]').forEach(i => i.checked = true);
    updatePreview();
  });
  document.getElementById('portal-seg-none')?.addEventListener('click', () => {
    document.querySelectorAll('input[name=segment]').forEach(i => i.checked = false);
    updatePreview();
  });
  document.querySelectorAll('input[name=segment]').forEach(i =>
    i.addEventListener('change', updatePreview));

  // Add destination
  document.getElementById('portal-add-dest-btn')?.addEventListener('click', addExtraDestination);

  // Generate
  document.getElementById('portal-generate-btn')?.addEventListener('click', handleGenerate);
}

async function onContinentChange() {
  const continent = document.getElementById('portal-continent')?.value;
  const countrySel = document.getElementById('portal-country');
  const citySel    = document.getElementById('portal-city');
  if (!countrySel) return;

  countrySel.innerHTML = '<option value="">Carregando…</option>';
  countrySel.disabled  = true;
  citySel.innerHTML    = '<option value="">Cidade/Região (opcional)</option>';
  citySel.disabled     = true;

  if (!continent) return;
  const dests = await fetchDestinations({ continent });
  const countries = [...new Set(dests.map(d => d.country).filter(Boolean))].sort();
  countrySel.innerHTML = `<option value="">Selecione o país</option>` +
    countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  countrySel.disabled = false;
}

async function onCountryChange() {
  const continent = document.getElementById('portal-continent')?.value;
  const country   = document.getElementById('portal-country')?.value;
  const citySel   = document.getElementById('portal-city');
  if (!citySel) return;

  citySel.innerHTML = '<option value="">Cidade/Região (opcional)</option>';
  citySel.disabled  = !country;
  if (!country) { await updateSegments(null); return; }

  const dests  = await fetchDestinations({ continent, country });
  const cities = dests.map(d => d.city).filter(Boolean).sort();
  if (cities.length) {
    citySel.innerHTML = `<option value="">Qualquer país (sem cidade específica)</option>` +
      cities.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    citySel.disabled = false;
  }
  // Update segments for the country-level destination
  const dest = dests.find(d => !d.city) || dests[0];
  if (dest) await updateSegments(dest.id);
  updatePreview();
}

function addExtraDestination() {
  const container = document.getElementById('portal-extra-dests');
  if (!container) return;
  const idx = container.children.length + 1;
  const div = document.createElement('div');
  div.style.cssText = 'margin-top:10px;padding:12px;border:1px solid var(--border-subtle);border-radius:var(--radius-md);';
  div.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <span style="font-size:0.8125rem;font-weight:600;color:var(--text-muted);">Destino ${idx + 1}</span>
      <button onclick="this.closest('div').remove();updatePreview()" style="border:none;background:none;cursor:pointer;color:var(--text-muted);">✕</button>
    </div>
    <select class="filter-select extra-continent" style="width:100%;margin-bottom:6px;">
      <option value="">Continente</option>
    </select>
    <select class="filter-select extra-country" style="width:100%;margin-bottom:6px;" disabled>
      <option value="">País</option>
    </select>
    <select class="filter-select extra-city" style="width:100%;" disabled>
      <option value="">Cidade (opcional)</option>
    </select>
  `;
  container.appendChild(div);

  // Populate continents for extra dest
  fetchContinentsWithContent().then(continents => {
    const sel = div.querySelector('.extra-continent');
    sel.innerHTML = `<option value="">Continente</option>` +
      continents.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    sel.disabled = false;
    sel.addEventListener('change', async () => {
      const cont = sel.value;
      const countrySel = div.querySelector('.extra-country');
      countrySel.innerHTML = '<option value="">Carregando…</option>';
      const dests = await fetchDestinations({ continent: cont });
      const countries = [...new Set(dests.map(d => d.country).filter(Boolean))].sort();
      countrySel.innerHTML = `<option value="">País</option>` +
        countries.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
      countrySel.disabled = false;
    });
  });
}

async function updateSegments(destinationId) {
  const container = document.getElementById('portal-segments');
  if (!container) return;

  if (!destinationId) {
    container.innerHTML = `<div style="font-size:0.8125rem;color:var(--text-muted);padding:8px 0;text-align:center;">
      Selecione um destino para ver os segmentos disponíveis.
    </div>`;
    return;
  }

  container.innerHTML = `<div style="font-size:0.8125rem;color:var(--text-muted);padding:8px 0;text-align:center;">
    Verificando conteúdo disponível…
  </div>`;

  const available = await fetchAvailableSegments(destinationId);

  if (!available.length) {
    container.innerHTML = `<div style="font-size:0.8125rem;color:var(--text-muted);padding:8px 0;text-align:center;">
      Nenhum segmento com conteúdo cadastrado para este destino.
      ${store.canCreateTip() ? '<br><a href="#portal-tip-editor" style="color:var(--brand-gold);">Criar dica</a>' : ''}
    </div>`;
    return;
  }

  const segsWithContent = SEGMENTS.filter(s => available.includes(s.key));
  container.innerHTML = segsWithContent.map(s => `
    <label style="display:flex;align-items:center;gap:10px;padding:8px 10px;
      border-radius:var(--radius-sm);cursor:pointer;transition:background .1s;"
      onmouseover="this.style.background='var(--bg-surface)'"
      onmouseout="this.style.background=''">
      <input type="checkbox" name="segment" value="${s.key}" checked
        style="width:15px;height:15px;accent-color:var(--brand-gold);cursor:pointer;"
        onchange="updatePreview()">
      <span style="font-size:0.875rem;color:var(--text-primary);">${esc(s.label)}</span>
    </label>
  `).join('');
}

async function updatePreview() {
  const card = document.getElementById('portal-preview-card');
  if (!card) return;

  const areaBtn   = document.querySelector('.portal-area-btn.selected');
  const continent = document.getElementById('portal-continent')?.value;
  const country   = document.getElementById('portal-country')?.value;
  const city      = document.getElementById('portal-city')?.value;
  const segments  = [...document.querySelectorAll('input[name=segment]:checked')].map(i => i.value);

  if (!areaBtn || !country) {
    card.innerHTML = `<div style="color:var(--text-muted);font-size:0.875rem;text-align:center;padding:40px 0;">
      Selecione uma área e um destino para ver a pré-visualização.
    </div>`;
    return;
  }

  card.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.875rem;">
    Carregando pré-visualização…
  </div>`;

  // Find destination
  const dests = await fetchDestinations({ continent, country });
  const dest  = city ? dests.find(d => d.city === city) : dests[0];
  if (!dest) {
    card.innerHTML = `<div style="color:var(--text-muted);font-size:0.875rem;text-align:center;padding:20px;">
      Destino sem dica cadastrada.
      ${store.canCreateTip() ? `<br><a href="#portal-tip-editor?dest=${encodeURIComponent(JSON.stringify({continent,country,city}))}" style="color:var(--brand-gold);">Criar dica</a>` : ''}
    </div>`;
    return;
  }

  const tip = await fetchTip(dest.id);
  if (!tip) {
    card.innerHTML = `<div style="color:var(--text-muted);font-size:0.875rem;text-align:center;padding:20px;">
      Nenhuma dica cadastrada para este destino.
      ${store.canCreateTip() ? `<br><a href="#portal-tip-editor" style="color:var(--brand-gold);">Criar dica</a>` : ''}
    </div>`;
    return;
  }

  const segLabels = SEGMENTS.filter(s => segments.includes(s.key)).map(s => s.label);
  const expiredSegs = SEGMENTS.filter(s => {
    const seg = tip.segments?.[s.key];
    return seg?.hasExpiry && seg?.expiryDate && new Date(seg.expiryDate) < new Date();
  });

  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
      <div>
        <div style="font-size:1rem;font-weight:700;color:var(--text-primary);">
          ${esc(city || country)}${city ? `, ${esc(country)}` : ''}
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);">${esc(continent)}</div>
      </div>
      <div style="font-size:0.6875rem;color:var(--text-muted);text-align:right;">
        Atualizado ${tip.updatedAt?.toDate ? new Intl.DateTimeFormat('pt-BR').format(tip.updatedAt.toDate()) : '—'}
      </div>
    </div>

    ${expiredSegs.length ? `
      <div style="background:#EF444415;border:1px solid #EF444430;border-radius:var(--radius-sm);
        padding:8px 12px;margin-bottom:12px;font-size:0.75rem;color:#EF4444;">
        ⚠ ${expiredSegs.length} segmento${expiredSegs.length !== 1 ? 's' : ''} com validade vencida:
        ${expiredSegs.map(s => s.label).join(', ')}
      </div>
    ` : ''}

    <div style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:8px;">Segmentos selecionados:</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;">
      ${segLabels.map(l => `
        <span style="font-size:0.75rem;padding:3px 8px;background:var(--bg-surface);
          border:1px solid var(--border-subtle);border-radius:var(--radius-full);">
          ${esc(l)}
        </span>`).join('')}
    </div>
  `;
}

async function handleGenerate() {
  const limitInfo = await checkDownloadLimit();
  if (!limitInfo.allowed) {
    toast.error('Limite diário de downloads atingido.');
    return;
  }

  const areaBtn  = document.querySelector('.portal-area-btn.selected');
  const country  = document.getElementById('portal-country')?.value;
  const format   = document.querySelector('input[name=format]:checked')?.value;
  const segments = [...document.querySelectorAll('input[name=segment]:checked')].map(i => i.value);

  if (!areaBtn) { toast.error('Selecione uma área.'); return; }
  if (!country) { toast.error('Selecione um destino.'); return; }
  if (!segments.length) { toast.error('Selecione ao menos um segmento.'); return; }

  const btn = document.getElementById('portal-generate-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Gerando…'; }

  try {
    toast.info('Gerando material… isso pode levar alguns segundos.');
    // Generation logic will be implemented in E5
    // For now, record the generation intent
    await recordGeneration({
      areaId:   areaBtn.dataset.id,
      format,
      segments,
      status:   'pending',
    });
    await registerDownload();
    toast.success('Material gerado com sucesso! (Implementação completa no E5)');
  } catch(e) {
    toast.error('Erro ao gerar: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✈ Gerar Material'; }
  }
}

/* ─── Terms modal ─────────────────────────────────────────── */
function renderTermsModal(container, terms, onAccept) {
  container.innerHTML = `
    <div style="max-width:780px;margin:40px auto;">
      <div class="card" style="padding:40px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
          <span style="font-size:1.5rem;">📋</span>
          <div>
            <h2 style="margin:0;font-size:1.25rem;">Termos de Uso</h2>
            <div style="font-size:0.8125rem;color:var(--text-muted);margin-top:2px;">
              Portal de Dicas PRIMETOUR — Última atualização: ${terms.updatedAt?.toDate
                ? new Intl.DateTimeFormat('pt-BR').format(terms.updatedAt.toDate())
                : '30/07/2025'}
            </div>
          </div>
        </div>

        <div style="max-height:420px;overflow-y:auto;border:1px solid var(--border-subtle);
          border-radius:var(--radius-md);padding:20px;margin-bottom:24px;
          font-size:0.875rem;line-height:1.7;color:var(--text-secondary);
          white-space:pre-wrap;">
${esc(terms.text || TERMS_TEXT)}
        </div>

        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
          <input type="checkbox" id="terms-check" style="width:16px;height:16px;accent-color:var(--brand-gold);">
          <label for="terms-check" style="font-size:0.875rem;cursor:pointer;">
            Li e aceito integralmente os Termos de Uso do Portal de Dicas.
          </label>
        </div>

        <button class="btn btn-primary" id="terms-accept-btn" disabled
          style="width:100%;padding:12px;font-size:0.9375rem;opacity:.5;">
          Aceitar e Continuar
        </button>
      </div>
    </div>
  `;

  document.getElementById('terms-check')?.addEventListener('change', e => {
    const btn = document.getElementById('terms-accept-btn');
    if (btn) { btn.disabled = !e.target.checked; btn.style.opacity = e.target.checked ? '1' : '.5'; }
  });

  document.getElementById('terms-accept-btn')?.addEventListener('click', async () => {
    try {
      await acceptTerms(terms.id);
      toast.success('Termos aceitos. Bem-vindo ao Portal de Dicas!');
      onAccept();
    } catch(e) { toast.error('Erro ao registrar aceite: ' + e.message); }
  });
}

// Default terms text (will be loaded from Firestore in production)
const TERMS_TEXT = `TERMO DE USO DO PORTAL DE DICAS DA PRIMETOUR

Última atualização: 30/07/2025

Este Termo de Uso regula o uso do PORTAL DE DICAS DA PRIMETOUR, criado e desenvolvido por PRIME TOUR AGÊNCIA DE VIAGENS E TURISMO LTDA., empresa com sede na Avenida Paulista, 854 – 8º andar – conjunto 82 – Bela Vista – CEP 01311-100 - São Paulo/SP, inscrita no CNPJ/MF sob o número 55.132.906/0001-51, sendo todos os direitos reservados a esta. Ao acessar ou utilizar o sistema, o usuário declara ter lido, compreendido e aceitado integralmente os termos e condições abaixo.

[Texto completo disponível no documento oficial]`;
