/**
 * PRIMETOUR — Roteiro Editor: Multi-section Itinerary Editor
 * Two-column layout with sidebar navigation and 11 content sections
 */

import { store }  from '../store.js';
import { toast } from '../components/toast.js';
const showToast = (msg, type = 'info') => toast[type]?.(msg) ?? toast.info(msg);
import { fetchRoteiro, saveRoteiro, snapshotTipForEmbed, isEmbeddedTipStale } from '../services/roteiros.js';
import { generateRoteiroForExport, resolveDestinationImage } from '../services/roteiroGenerator.js';
import { fetchDestinations, fetchAreas, fetchImages, fetchTips } from '../services/portal.js';
import { detectBankContext, showBankGuardModal } from '../services/bankClientGuard.js';

/* ─── State ───────────────────────────────────────────────── */
let currentRoteiro = null;
let isDirty = false;
let autoSaveTimer = null;
let allDestinations = [];
let allAreas = [];
let activeSection = 0;

/* ─── Helper ──────────────────────────────────────────────── */
const esc = s => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';

function addDaysToDate(dateStr, days) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function diffDays(a, b) {
  if (!a || !b) return 0;
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}

function formatDateForDay(startDate, dayIndex) {
  if (!startDate) return '';
  const d = new Date(startDate + 'T12:00:00');
  d.setDate(d.getDate() + dayIndex);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* ─── Sections definition ─────────────────────────────────── */
const SECTIONS = [
  { icon: '\u{1F464}', label: 'Cliente' },
  { icon: '\u{1F30D}', label: 'Viagem' },
  { icon: '\u{1F4C5}', label: 'Dia a dia' },
  { icon: '\u{1F3E8}', label: 'Hot\u00e9is' },
  { icon: '\u{1F4B0}', label: 'Valores' },
  { icon: '\u2B50',    label: 'Opcionais' },
  { icon: '\u2713',    label: 'Inclui / N\u00e3o inclui' },
  { icon: '\u{1F4B3}', label: 'Pagamento' },
  { icon: '\u274C',    label: 'Cancelamento' },
  { icon: '\u2139',    label: 'Informa\u00e7\u00f5es Importantes' },
  { icon: '\u{1F5BC}', label: 'Imagens' },
  { icon: '\u{1F4A1}', label: 'Dicas anexas' },  // 4.42.0+ Sprint 3 \u2014 embed do Portal de Dicas
  { icon: '\u2699',    label: 'Avan\u00e7ado' },        // 4.41.0+ Sprint 2 \u2014 colaboradores, workflow, custo
  { icon: '\u{1F4C4}', label: 'Preview & Export' },
];

/* ─── Preferences & Restrictions options ──────────────────── */
const PREF_OPTIONS = ['Gastronomia','Cultura','Aventura','Relaxamento','Compras','Natureza'];
const REST_OPTIONS = ['Mobilidade reduzida','Restri\u00e7\u00e3o alimentar','Outro'];

/* ─── Default cancellation presets ────────────────────────── */
const CANCELLATION_PRESETS = [
  { period: 'At\u00e9 60 dias antes', penalty: 'Sem custo' },
  { period: 'Entre 59 e 30 dias',     penalty: '50% do valor total' },
  { period: 'Entre 29 e 15 dias',     penalty: '75% do valor total' },
  { period: 'Menos de 15 dias',       penalty: '100% do valor total (no-show)' },
];

/* ─── Includes/Excludes presets ───────────────────────────── */
const INCLUDES_PRESETS = [
  'Hospedagem conforme descrito',
  'Caf\u00e9 da manh\u00e3',
  'Transfers privativos',
  'Seguro viagem',
  'Passeios mencionados no roteiro',
];
const EXCLUDES_PRESETS = [
  'Passagem a\u00e9rea',
  'Refei\u00e7\u00f5es n\u00e3o mencionadas',
  'Despesas pessoais',
  'Gorjetas',
  'Seguro viagem opcional',
];

/* ─── CSS ─────────────────────────────────────────────────── */
const EDITOR_CSS = `
.re-header {
  display: flex; align-items: center; gap: 12px; padding: 12px 0; margin-bottom: 16px;
  border-bottom: 1px solid var(--border-subtle, #333); flex-wrap: wrap;
}
.re-header-title {
  font-size: 1.25rem; font-weight: 700; color: var(--text-primary); flex: 1; min-width: 200px;
}
.re-header .status-badge {
  padding: 4px 12px; border-radius: 999px; font-size: 0.75rem; font-weight: 600;
  background: var(--bg-surface, #222); color: var(--text-muted);
}
.re-layout {
  display: grid; grid-template-columns: 220px 1fr; gap: 1.5rem;
}
.re-sidebar {
  position: sticky; top: 80px; align-self: start;
}
.re-nav-item {
  display: flex; align-items: center; gap: 8px;
  padding: 0.75rem 1rem; border-radius: 8px; cursor: pointer;
  background: transparent; border-left: 3px solid transparent;
  font-size: 0.875rem; color: var(--text-secondary); transition: all 0.15s;
  margin-bottom: 2px; user-select: none;
}
.re-nav-item:hover { background: var(--bg-hover, rgba(255,255,255,0.05)); }
.re-nav-item.active {
  background: var(--bg-hover, rgba(255,255,255,0.05));
  border-left-color: var(--brand-blue, #3B82F6);
  color: var(--text-primary); font-weight: 600;
}
.re-content {
  min-height: 400px;
}
.re-section-title {
  font-size: 1.1rem; font-weight: 700; color: var(--text-primary); margin-bottom: 16px;
  padding-bottom: 8px; border-bottom: 1px solid var(--border-subtle, #333);
}
.re-form-group {
  margin-bottom: 14px;
}
.re-label {
  font-size: 0.75rem; font-weight: 600; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem; display: block;
}
.re-input, .re-select, .re-textarea {
  width: 100%; padding: 0.5rem 0.75rem;
  background: var(--bg-input, var(--bg-card, #1a1a2e));
  border: 1px solid var(--border, #333); border-radius: 6px;
  color: var(--text-primary); font-size: 0.875rem;
  font-family: inherit; box-sizing: border-box;
}
.re-textarea { resize: vertical; min-height: 60px; }
.re-input:focus, .re-select:focus, .re-textarea:focus {
  outline: none; border-color: var(--brand-blue, #3B82F6);
}
.re-row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.re-row > .re-form-group { flex: 1; min-width: 180px; margin-bottom: 0; }
.re-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px; }
.re-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 14px; }
.re-checkbox-group { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
.re-checkbox-group label {
  display: flex; align-items: center; gap: 5px; font-size: 0.8125rem; color: var(--text-secondary);
  padding: 4px 10px; border: 1px solid var(--border-subtle, #333); border-radius: 999px;
  cursor: pointer; transition: all 0.15s; user-select: none;
}
.re-checkbox-group label:hover { background: var(--bg-surface, #222); }
.re-checkbox-group label.checked {
  background: var(--brand-blue, #3B82F6); color: #fff; border-color: var(--brand-blue, #3B82F6);
}
.re-dyn-table { width: 100%; border-collapse: collapse; font-size: 0.8125rem; margin-bottom: 8px; }
.re-dyn-table th {
  text-align: left; padding: 6px 8px; font-weight: 600; color: var(--text-muted);
  border-bottom: 1px solid var(--border-subtle, #333); font-size: 0.75rem;
}
.re-dyn-table td { padding: 4px 6px; }
.re-dyn-table input, .re-dyn-table select, .re-dyn-table textarea {
  width: 100%; padding: 6px 8px; border: 1px solid var(--border-subtle, #333); border-radius: 6px;
  background: var(--bg-card, #1a1a2e); color: var(--text-primary); font-size: 0.8125rem;
  font-family: inherit; box-sizing: border-box;
}
.re-dyn-table textarea { resize: vertical; min-height: 32px; }
.re-add-btn {
  display: inline-flex; align-items: center; gap: 4px; padding: 6px 14px; font-size: 0.8125rem;
  font-weight: 600; color: var(--brand-blue, #3B82F6); background: transparent;
  border: 1px dashed var(--brand-blue, #3B82F6); border-radius: 6px;
  cursor: pointer; margin-top: 8px; transition: all 0.15s;
}
.re-add-btn:hover { background: var(--brand-blue, #3B82F6); color: #fff; }
.re-remove-btn {
  background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1rem;
  padding: 2px 6px; border-radius: 6px; transition: all 0.15s;
}
.re-remove-btn:hover { background: rgba(239,68,68,0.1); color: #EF4444; }
.re-day-card {
  border: 1px solid var(--border-subtle, #333); border-radius: 8px; padding: 16px;
  margin-bottom: 12px; position: relative; background: var(--bg-card, #1a1a2e);
}
.re-day-card .re-day-num {
  position: absolute; top: -1px; left: 16px; background: var(--brand-blue, #3B82F6); color: #fff;
  font-weight: 700; font-size: 0.75rem; padding: 2px 10px; border-radius: 0 0 6px 6px;
}
.re-day-card .re-day-date {
  font-size: 0.75rem; color: var(--text-muted); margin-bottom: 8px; padding-left: 80px;
}
.re-two-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.re-list-col { display: flex; flex-direction: column; gap: 6px; }
.re-list-item { display: flex; align-items: center; gap: 6px; padding: 4px 0; }
.re-list-item input { flex: 1; }
.re-dest-row { display: flex; gap: 8px; align-items: flex-end; margin-bottom: 8px; }
.re-dest-row .re-form-group { margin-bottom: 0; }
.re-activity-row { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; }
.re-activity-row input, .re-activity-row select { font-size: 0.8125rem; }
.re-preview-summary {
  background: var(--bg-surface, #222); border-radius: 8px; padding: 16px; margin-bottom: 16px;
  font-size: 0.875rem; color: var(--text-secondary); line-height: 1.6;
}
.re-autosave {
  font-size: 0.75rem; color: var(--text-muted); margin-left: 8px;
}
/* ─── Imagens section ─────────────────────────────────────── */
.re-img-group { margin-bottom: 22px; }
.re-img-group-title {
  font-size: 0.8125rem; font-weight: 700; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.06em;
  margin: 0 0 8px; padding-bottom: 6px;
  border-bottom: 1px solid var(--border-subtle, #333);
}
.re-img-row {
  display: flex; align-items: center; gap: 14px;
  padding: 10px; border-radius: 8px;
  background: var(--bg-surface, #1a1a1a);
  margin-bottom: 6px;
}
.re-img-thumb {
  width: 88px; height: 56px; border-radius: 6px; overflow: hidden;
  background: var(--bg-dark, #0c1926); flex: 0 0 88px;
  display: flex; align-items: center; justify-content: center;
}
.re-img-thumb img { width: 100%; height: 100%; object-fit: cover; }
.re-img-auto {
  font-size: 0.65rem; font-weight: 700; color: var(--text-muted);
  letter-spacing: 0.08em;
}
.re-img-meta { flex: 1; min-width: 0; }
.re-img-name {
  font-size: 0.875rem; font-weight: 600; color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.re-img-sub { font-size: 0.75rem; color: var(--text-muted); margin-top: 2px; }
.re-img-actions { display: flex; gap: 6px; flex: 0 0 auto; }
.re-img-actions .re-add-btn,
.re-img-actions .re-remove-btn { margin: 0; padding: 6px 12px; font-size: 0.75rem; }
.re-img-empty {
  padding: 14px; text-align: center; font-size: 0.8125rem;
  color: var(--text-muted); background: var(--bg-surface, #1a1a1a);
  border-radius: 8px;
}

/* ─── Modal seletor de imagem ─────────────────────────────── */
.re-img-modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.7);
  display: flex; align-items: center; justify-content: center;
  z-index: 9000; padding: 20px;
}
.re-img-modal {
  background: var(--bg-card, #161e2d); border-radius: 12px;
  width: 100%; max-width: 720px; max-height: 90vh;
  display: flex; flex-direction: column;
  border: 1px solid var(--border-subtle, #333);
}
.re-img-modal-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid var(--border-subtle, #333);
}
.re-img-modal-title { font-size: 0.9375rem; font-weight: 700; color: var(--text-primary); }
.re-img-modal-close {
  background: none; border: none; color: var(--text-muted);
  font-size: 1.5rem; cursor: pointer; padding: 0 6px;
}
.re-img-modal-tabs {
  display: flex; padding: 0 18px; gap: 4px;
  border-bottom: 1px solid var(--border-subtle, #333);
}
.re-img-tab {
  background: none; border: none; color: var(--text-muted);
  padding: 10px 14px; cursor: pointer; font-size: 0.8125rem;
  border-bottom: 2px solid transparent; font-weight: 600;
}
.re-img-tab.active { color: var(--text-primary); border-bottom-color: var(--brand-blue, #3B82F6); }
.re-img-modal-body { padding: 16px 18px; overflow-y: auto; flex: 1; }
.re-img-tab-pane { display: none; }
.re-img-tab-pane.active { display: block; }
.re-img-grid {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 10px;
}
.re-img-card {
  cursor: pointer; border-radius: 6px; overflow: hidden;
  background: var(--bg-dark, #0c1926); transition: transform 0.15s, box-shadow 0.15s;
}
.re-img-card:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.4); }
.re-img-card img { width: 100%; height: 100px; object-fit: cover; display: block; }
.re-img-card-label {
  font-size: 0.6875rem; padding: 4px 6px; color: var(--text-muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

@media (max-width: 768px) {
  .re-layout { grid-template-columns: 1fr; }
  .re-sidebar { position: static; display: flex; flex-wrap: wrap; gap: 4px; }
  .re-nav-item { padding: 6px 10px; font-size: 0.75rem; border-left: none; border-bottom: 2px solid transparent; }
  .re-nav-item.active { border-bottom-color: var(--brand-blue, #3B82F6); border-left-color: transparent; }
  .re-grid-2, .re-grid-3, .re-two-cols { grid-template-columns: 1fr; }
  .re-row { flex-direction: column; }
}
`;

/* ─── Section renderers ───────────────────────────────────── */

function renderSectionContent(index) {
  switch (index) {
    case 0:  return renderClienteSection();
    case 1:  return renderViagemSection();
    case 2:  return renderDiaDiaSection();
    case 3:  return renderHoteisSection();
    case 4:  return renderValoresSection();
    case 5:  return renderOpcionaisSection();
    case 6:  return renderIncluiSection();
    case 7:  return renderPagamentoSection();
    case 8:  return renderCancelamentoSection();
    case 9:  return renderInfoSection();
    case 10: return renderImagensSection();
    case 11: return renderEmbeddedTipsSection();  // 4.42.0+ Sprint 3
    case 12: return renderAdvancedSection();      // 4.41.0+ Sprint 2
    case 13: return renderPreviewSection();
    default: return '';
  }
}

/* ── 11: Dicas anexas (4.42.0+ Sprint 3) ──────────────────
 *
 * Embed de dicas do Portal de Dicas com snapshot. User pode anexar
 * dicas (via picker modal) que vão aparecer no PDF/PPTX/web do roteiro.
 *
 * Cada dica anexada é um SNAPSHOT — modificações posteriores na dica
 * original não afetam o que cliente vê, até user clicar "Re-publicar".
 */
function renderEmbeddedTipsSection() {
  const embedded = Array.isArray(currentRoteiro.embeddedTips) ? currentRoteiro.embeddedTips : [];

  const rowsHTML = embedded.length
    ? embedded.map((e, i) => {
        const segmentsCount = e.content?.segments
          ? Object.values(e.content.segments).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0)
          : 0;
        const snapDate = (() => {
          const d = e.snapshotAt?.toDate ? e.snapshotAt.toDate() : (e.snapshotAt ? new Date(e.snapshotAt) : null);
          return d ? d.toLocaleDateString('pt-BR') : '—';
        })();
        return `
          <div data-embed-idx="${i}" style="border:1px solid var(--border);border-radius:8px;
            padding:14px 16px;margin-bottom:10px;display:flex;align-items:center;gap:14px;
            background:var(--bg-card);">
            <div style="font-size:1.5rem;flex-shrink:0;">💡</div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;font-size:0.9375rem;">${esc(e.title)}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
                ${esc(e.subtitle || 'Sem continente')} ·
                ${segmentsCount} item${segmentsCount !== 1 ? 's' : ''} ·
                snapshot em ${snapDate}
                <span data-embed-stale-${i} style="display:none;margin-left:8px;color:#F59E0B;font-weight:600;">
                  ⚠ versão mais recente disponível
                </span>
              </div>
            </div>
            <button class="re-add-btn" data-action="republish-tip" data-idx="${i}"
              style="margin:0;background:var(--bg-soft);color:var(--text-primary);font-size:0.75rem;padding:6px 12px;">
              ↻ Re-publicar
            </button>
            <button class="re-btn-icon" data-action="remove-tip" data-idx="${i}" title="Remover">✕</button>
          </div>
        `;
      }).join('')
    : `<div style="padding:40px 20px;text-align:center;color:var(--text-muted);
        background:var(--bg-soft);border:1px dashed var(--border);border-radius:8px;">
        <div style="font-size:2.5rem;margin-bottom:8px;">💡</div>
        <div style="font-weight:600;font-size:0.9375rem;color:var(--text-primary);margin-bottom:4px;">
          Nenhuma dica anexada
        </div>
        <div style="font-size:0.8125rem;line-height:1.5;max-width:480px;margin:0 auto;">
          Anexe dicas do Portal de Dicas pra enriquecer o roteiro com recomendações
          locais (restaurantes, atrações, vida noturna etc.).
        </div>
      </div>`;

  return `
    <div class="re-section-title">Dicas anexas</div>

    <div style="background:var(--bg-soft);border-left:3px solid var(--brand-gold);padding:10px 14px;
      border-radius:4px;font-size:0.8125rem;color:var(--text-muted);margin-bottom:16px;line-height:1.5;">
      <strong style="color:var(--text-primary);">Como funciona:</strong>
      Cada dica é um <strong>snapshot</strong> — modificações futuras na dica original
      no Portal NÃO afetam o que o cliente vê. Use <strong>↻ Re-publicar</strong>
      quando quiser puxar a versão atualizada.
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
      <div style="font-size:0.875rem;color:var(--text-secondary);">
        ${embedded.length} ${embedded.length === 1 ? 'dica anexada' : 'dicas anexadas'}
      </div>
      <button class="re-add-btn" data-action="open-tip-picker" style="margin:0;">+ Anexar dica</button>
    </div>

    <div id="re-embedded-tips-list">${rowsHTML}</div>
  `;
}

/* ── 12: Avançado (4.41.0+ Sprint 2) ──────────────────────── */
function renderAdvancedSection() {
  const r = currentRoteiro;
  const colabIds = Array.isArray(r.collaboratorIds) ? r.collaboratorIds : [];
  const workflowMode = r.workflowMode === 'offline' ? 'offline' : 'system';
  const canViewCost = store.can?.('roteiro_view_cost') || store.isMaster?.() || false;
  const cp = r.costPricing || { perPerson: null, perCouple: null, currency: 'USD', notes: '', customRows: [] };
  // 4.43.0+ Sprint 4 — tarefas vinculadas
  const linkedTaskIds = Array.isArray(r.linkedTaskIds) ? r.linkedTaskIds : [];
  const tasksGeneratedAt = r.tasksGeneratedAt;

  // Lista de users elegíveis pra colaboradores (todos com roteiro_create — outros consultores)
  const allUsers = (store.get('users') || []).filter(u => u.active !== false && u.id !== r.consultantId);
  const collabOptionsHTML = allUsers.length
    ? allUsers.map(u => {
        const selected = colabIds.includes(u.id);
        const initial = (u.name || '?').trim().charAt(0).toUpperCase();
        const bg = u.avatarColor || '#94A3B8';
        return `
          <button type="button" data-colab-uid="${esc(u.id)}" data-colab-selected="${selected}"
            style="display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:99px;
              border:1px solid ${selected ? 'var(--brand-gold)' : 'var(--border)'};
              background:${selected ? 'var(--brand-gold)15' : 'transparent'};
              color:${selected ? 'var(--brand-gold)' : 'var(--text-secondary)'};
              font-size:0.8125rem;cursor:pointer;font-family:inherit;font-weight:500;">
            <span style="width:22px;height:22px;border-radius:50%;background:${bg};color:white;
              display:inline-flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:600;">${esc(initial)}</span>
            <span>${esc(u.name)}</span>
          </button>
        `;
      }).join('')
    : '<span style="color:var(--text-muted);font-size:0.875rem;">Sem outros usuários ativos pra adicionar.</span>';

  const costRowsHTML = (cp.customRows || []).length
    ? cp.customRows.map((row, i) => `
      <tr data-cprow-idx="${i}">
        <td><input class="re-input" data-cprow="label" value="${esc(row.label||'')}" placeholder="Rubrica (ex: Hospedagem)" /></td>
        <td><input class="re-input" data-cprow="value" value="${esc(row.value||'')}" placeholder="Valor (ex: USD 1200)" /></td>
        <td><button class="re-btn-icon" data-action="remove-cprow" data-idx="${i}" title="Remover">✕</button></td>
      </tr>
    `).join('')
    : '<tr><td colspan="3" style="padding:12px;text-align:center;color:var(--text-muted);font-size:0.8125rem;">Sem linhas de custo. Adicione pra detalhar a margem.</td></tr>';

  return `
    <div class="re-section-title">Avançado</div>

    <!-- ── Colaboradores ── -->
    <div class="re-form-group" style="margin-bottom:32px;">
      <label class="re-label">Colaboradores</label>
      <div style="background:var(--bg-soft);border-left:3px solid var(--brand-gold);padding:8px 12px;
        border-radius:4px;font-size:0.75rem;color:var(--text-muted);margin-bottom:10px;line-height:1.5;">
        Usuários selecionados podem <strong>editar este roteiro</strong> (além do consultor responsável e dos gerentes).
      </div>
      <div id="re-collab-picker" style="display:flex;flex-wrap:wrap;gap:8px;">${collabOptionsHTML}</div>
    </div>

    <!-- ── Workflow Mode ── -->
    <div class="re-form-group" style="margin-bottom:32px;">
      <label class="re-label">Modo de fluxo</label>
      <div style="display:flex;gap:24px;margin-top:8px;">
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;flex:1;padding:12px;
          border:1px solid ${workflowMode==='system'?'var(--brand-gold)':'var(--border)'};border-radius:8px;
          background:${workflowMode==='system'?'var(--brand-gold)08':'transparent'};">
          <input type="radio" name="re-workflow-mode" value="system" ${workflowMode==='system'?'checked':''} style="margin-top:3px;" />
          <div>
            <div style="font-weight:600;font-size:0.875rem;">Via sistema (recomendado)</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:3px;line-height:1.5;">
              Status do roteiro avança no fluxo (Rascunho → Revisão → Enviado → Aprovado).
              Notificações e auditoria automáticas.
            </div>
          </div>
        </label>
        <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer;flex:1;padding:12px;
          border:1px solid ${workflowMode==='offline'?'var(--brand-gold)':'var(--border)'};border-radius:8px;
          background:${workflowMode==='offline'?'var(--brand-gold)08':'transparent'};">
          <input type="radio" name="re-workflow-mode" value="offline" ${workflowMode==='offline'?'checked':''} style="margin-top:3px;" />
          <div>
            <div style="font-weight:600;font-size:0.875rem;">Offline</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:3px;line-height:1.5;">
              Status é apenas informativo. Você gerencia o processo fora do sistema
              (planilhas, email, etc.). Útil pra equipes em transição.
            </div>
          </div>
        </label>
      </div>
    </div>

    <!-- ── Custo Interno (só com permissão) ── -->
    ${canViewCost ? `
      <div class="re-form-group" id="re-cost-section" style="border:1px solid var(--brand-gold)40;border-radius:8px;padding:18px;background:var(--brand-gold)05;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <label class="re-label" style="margin:0;color:var(--brand-gold);">
            💼 Custo interno (margem comercial)
          </label>
          <span style="font-size:0.7rem;color:var(--text-muted);background:var(--bg-soft);padding:3px 8px;border-radius:99px;">
            🔒 INTERNO — nunca aparece em export pra cliente
          </span>
        </div>
        <div style="background:var(--bg-soft);padding:8px 12px;border-radius:4px;font-size:0.75rem;color:var(--text-muted);margin-bottom:14px;line-height:1.5;">
          Custos de fornecedor (hotelaria, transfer, guias). Use pra calcular margem.
          <strong>Garantia técnica:</strong> este campo é filtrado em todos os exports e na página pública.
        </div>
        <div class="re-row">
          <div class="re-form-group">
            <label class="re-label">Custo por pessoa</label>
            <input class="re-input" type="number" step="0.01" min="0" data-field="costPricing.perPerson" value="${cp.perPerson != null ? cp.perPerson : ''}" placeholder="0.00" />
          </div>
          <div class="re-form-group">
            <label class="re-label">Custo por casal</label>
            <input class="re-input" type="number" step="0.01" min="0" data-field="costPricing.perCouple" value="${cp.perCouple != null ? cp.perCouple : ''}" placeholder="0.00" />
          </div>
          <div class="re-form-group" style="max-width:130px;">
            <label class="re-label">Moeda</label>
            <select class="re-select" data-field="costPricing.currency">
              <option value="USD" ${cp.currency==='USD'?'selected':''}>USD</option>
              <option value="BRL" ${cp.currency==='BRL'?'selected':''}>BRL</option>
              <option value="EUR" ${cp.currency==='EUR'?'selected':''}>EUR</option>
              <option value="GBP" ${cp.currency==='GBP'?'selected':''}>GBP</option>
            </select>
          </div>
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px;margin-bottom:6px;">
          <label class="re-label" style="margin:0;font-size:0.8125rem;">Rubricas (opcional)</label>
          <button class="re-add-btn" data-action="add-cprow" style="margin:0;font-size:0.75rem;padding:4px 10px;">+ Adicionar rubrica</button>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <tbody>${costRowsHTML}</tbody>
        </table>
        <div class="re-form-group" style="margin-top:14px;">
          <label class="re-label">Notas internas</label>
          <textarea class="re-textarea" rows="2" data-field="costPricing.notes" placeholder="Ex: cotação válida até XX/YY, fornecedor Z confirmou disponibilidade...">${esc(cp.notes || '')}</textarea>
        </div>
      </div>
    ` : `
      <div style="padding:16px;border:1px dashed var(--border);border-radius:8px;text-align:center;color:var(--text-muted);font-size:0.8125rem;">
        🔒 Você não tem permissão para ver/editar o custo interno deste roteiro.
        <br><span style="font-size:0.7rem;">Solicite ao admin a permissão <code>roteiro_view_cost</code>.</span>
      </div>
    `}

    <!-- 4.43.0+ Sprint 4: Tarefas vinculadas -->
    <div class="re-form-group" style="margin-top:32px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <label class="re-label" style="margin:0;">🔗 Tarefas operacionais vinculadas</label>
        ${linkedTaskIds.length > 0 || tasksGeneratedAt
          ? `<button class="re-add-btn" data-action="regenerate-tasks" style="margin:0;font-size:0.75rem;padding:4px 10px;">↻ Re-sincronizar</button>`
          : (r.status === 'approved' && workflowMode === 'system' && r.id
              ? `<button class="re-add-btn" data-action="generate-tasks" style="margin:0;font-size:0.75rem;padding:4px 10px;">+ Gerar agora</button>`
              : '')}
      </div>
      <div style="background:var(--bg-soft);border-left:3px solid var(--brand-gold);padding:8px 12px;
        border-radius:4px;font-size:0.75rem;color:var(--text-muted);margin-bottom:10px;line-height:1.5;">
        Quando o roteiro é <strong>aprovado</strong> no modo "via sistema", são geradas tarefas operacionais
        automaticamente: reservar voos, confirmar hotéis, transfers, seguro, materiais e vouchers.
        Cada tarefa tem deadline calculada a partir do início da viagem.
      </div>
      ${linkedTaskIds.length
        ? `<div id="re-linked-tasks-list" style="min-height:40px;">
            <div style="padding:20px;text-align:center;color:var(--text-muted);font-size:0.8125rem;">
              Carregando ${linkedTaskIds.length} tarefa(s)...
            </div>
          </div>`
        : `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:0.8125rem;
            background:var(--bg-soft);border:1px dashed var(--border);border-radius:8px;">
            ${r.status === 'approved' && workflowMode === 'system'
              ? 'Nenhuma tarefa gerada ainda. Clique "+ Gerar agora" pra criar as operacionais.'
              : workflowMode === 'offline'
                ? '⚙ Modo offline — sistema não gera tarefas automaticamente.'
                : 'Tarefas serão geradas quando o roteiro for aprovado (em modo "via sistema").'}
          </div>`}
    </div>
  `;
}

/* ── 0: Cliente ──────────────────────────────────────────── */
function renderClienteSection() {
  const c = currentRoteiro.client;
  // 4.41.0+ (Sprint 2) — viajantes substituem adults/children/childrenAges.
  // Dados do RESPONSÁVEL ficam em client.{name,email,phone}; a lista de
  // pessoas vai pra travelers[]. Compat: se vazio, mostra empty state.
  const travelers = Array.isArray(currentRoteiro.travelers) && currentRoteiro.travelers.length
    ? currentRoteiro.travelers
    : [];
  const childrenAgesHTML = (c.childrenAges || []).map((age, i) =>
    `<input class="re-input" type="number" min="0" max="17" data-age-idx="${i}" value="${age}" style="width:70px;" />`
  ).join('');
  const travelerRowsHTML = travelers.length
    ? travelers.map((t, i) => `
      <tr data-trv-idx="${i}">
        <td><input class="re-input" data-trv="name" value="${esc(t.name || '')}" placeholder="Nome completo" /></td>
        <td><input class="re-input" type="number" min="0" max="120" data-trv="age" value="${t.age != null ? t.age : ''}" placeholder="—" style="width:70px;" /></td>
        <td>
          <label style="display:flex;align-items:center;gap:6px;font-size:0.875rem;cursor:pointer;">
            <input type="radio" name="trv-lead" data-trv="isLead" ${t.isLead ? 'checked' : ''} style="margin:0;" />
            <span>Responsável</span>
          </label>
        </td>
        <td><input class="re-input" data-trv="doc" value="${esc(t.doc || '')}" placeholder="CPF / Passaporte" /></td>
        <td><input class="re-input" data-trv="notes" value="${esc(t.notes || '')}" placeholder="Notas" /></td>
        <td><button class="re-btn-icon" data-action="remove-trv" data-idx="${i}" title="Remover">✕</button></td>
      </tr>
    `).join('')
    : `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);font-size:0.875rem;">Nenhum viajante. Clique "+ Adicionar viajante" pra começar.</td></tr>`;

  return `
    <div class="re-section-title">Cliente</div>
    <div class="re-row">
      <div class="re-form-group">
        <label class="re-label">Nome do Cliente</label>
        <input class="re-input" data-field="client.name" value="${esc(c.name)}" placeholder="Nome completo" />
      </div>
      <div class="re-form-group">
        <label class="re-label">Email</label>
        <input class="re-input" type="email" data-field="client.email" value="${esc(c.email)}" placeholder="email@exemplo.com" />
      </div>
      <div class="re-form-group">
        <label class="re-label">Telefone</label>
        <input class="re-input" data-field="client.phone" value="${esc(c.phone)}" placeholder="+55 11 99999-0000" />
      </div>
    </div>
    <div class="re-row">
      <div class="re-form-group">
        <label class="re-label">Tipo</label>
        <select class="re-select" data-field="client.type">
          <option value="individual" ${c.type==='individual'?'selected':''}>Individual</option>
          <option value="couple" ${c.type==='couple'?'selected':''}>Casal</option>
          <option value="family" ${c.type==='family'?'selected':''}>Fam\u00edlia</option>
          <option value="group" ${c.type==='group'?'selected':''}>Grupo</option>
        </select>
      </div>
    </div>
    <!-- 4.41.0+ Tabela de viajantes (substitui adults/children/childrenAges) -->
    <div class="re-form-group" style="margin-top:8px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <label class="re-label" style="margin:0;">Viajantes
          <span style="color:var(--text-muted);font-weight:400;font-size:0.75rem;margin-left:6px;">
            ${travelers.length} ${travelers.length === 1 ? 'pessoa' : 'pessoas'}
          </span>
        </label>
        <button class="re-add-btn" data-action="add-trv" style="margin:0;">+ Adicionar viajante</button>
      </div>
      <div style="background:var(--bg-soft);border-left:3px solid var(--brand-gold);padding:8px 12px;border-radius:4px;font-size:0.75rem;color:var(--text-muted);margin-bottom:10px;line-height:1.5;">
        Marque <strong>1 pessoa como Respons\u00e1vel</strong> (quem fecha o contrato). As demais entram como acompanhantes.
      </div>
      <table id="re-travelers-table" style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:var(--bg-soft);">
            <th style="text-align:left;padding:8px;font-size:0.7rem;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);font-weight:600;">Nome</th>
            <th style="text-align:left;padding:8px;font-size:0.7rem;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);font-weight:600;width:80px;">Idade</th>
            <th style="text-align:left;padding:8px;font-size:0.7rem;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);font-weight:600;width:140px;">Papel</th>
            <th style="text-align:left;padding:8px;font-size:0.7rem;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);font-weight:600;width:160px;">Documento</th>
            <th style="text-align:left;padding:8px;font-size:0.7rem;text-transform:uppercase;letter-spacing:.04em;color:var(--text-muted);font-weight:600;">Notas</th>
            <th style="width:36px;"></th>
          </tr>
        </thead>
        <tbody id="re-travelers-body">${travelerRowsHTML}</tbody>
      </table>
      <!-- DEPRECATED inputs \u2014 escondidos mas mantidos pra compat com collectFormData antigo.
           Removidos no fim do Sprint 2 quando collectFormData usar travelers como fonte prim\u00e1ria. -->
      <input type="hidden" data-field="client.adults" value="${c.adults || 0}" />
      <input type="hidden" data-field="client.children" value="${c.children || 0}" />
      <span id="re-children-ages" style="display:none;">${childrenAgesHTML}</span>
    </div>
    <div class="re-form-group">
      <label class="re-label">Prefer\u00eancias</label>
      <div class="re-checkbox-group" id="re-pref-group">
        ${PREF_OPTIONS.map(p => `
          <label class="${(c.preferences||[]).includes(p)?'checked':''}" data-pref="${esc(p)}">
            <input type="checkbox" ${(c.preferences||[]).includes(p)?'checked':''} style="display:none;" /> ${esc(p)}
          </label>
        `).join('')}
      </div>
    </div>
    <div class="re-form-group">
      <label class="re-label">Restri\u00e7\u00f5es</label>
      <div class="re-checkbox-group" id="re-rest-group">
        ${REST_OPTIONS.map(r => `
          <label class="${(c.restrictions||[]).includes(r)?'checked':''}" data-rest="${esc(r)}">
            <input type="checkbox" ${(c.restrictions||[]).includes(r)?'checked':''} style="display:none;" /> ${esc(r)}
          </label>
        `).join('')}
      </div>
    </div>
    <div class="re-form-group">
      <label class="re-label">Perfil Econ\u00f4mico</label>
      <select class="re-select" data-field="client.economicProfile" style="max-width:250px;">
        <option value="standard" ${c.economicProfile==='standard'?'selected':''}>Standard</option>
        <option value="premium" ${c.economicProfile==='premium'?'selected':''}>Premium</option>
        <option value="luxury" ${c.economicProfile==='luxury'?'selected':''}>Luxury</option>
      </select>
    </div>
    <div class="re-form-group">
      <label class="re-label">Observa\u00e7\u00f5es</label>
      <textarea class="re-textarea" data-field="client.notes" rows="3" placeholder="Notas sobre o cliente...">${esc(c.notes)}</textarea>
    </div>
  `;
}

/* ── 1: Viagem ───────────────────────────────────────────── */
function renderViagemSection() {
  const t = currentRoteiro.travel;
  const dests = t.destinations || [];
  const totalNights = dests.reduce((sum, d) => sum + (parseInt(d.nights) || 0), 0);
  const endDate = t.startDate ? addDaysToDate(t.startDate, totalNights) : '';

  return `
    <div class="re-section-title">Viagem</div>
    <div class="re-row">
      <div class="re-form-group">
        <label class="re-label">Data In\u00edcio</label>
        <input class="re-input" type="date" data-field="travel.startDate" value="${t.startDate || ''}" />
      </div>
      <div class="re-form-group">
        <label class="re-label">Data Fim (auto)</label>
        <input class="re-input" type="date" id="re-end-date" value="${endDate}" readonly style="opacity:0.7;" />
      </div>
      <div class="re-form-group" style="flex:0 0 auto;display:flex;align-items:flex-end;">
        <span style="padding:8px 14px;background:var(--bg-surface,#222);border-radius:6px;
          font-weight:700;color:var(--text-primary);font-size:0.875rem;white-space:nowrap;">
          Total: <span id="re-total-nights">${totalNights}</span> noites
        </span>
      </div>
    </div>
    <label class="re-label" style="margin-bottom:8px;">Destinos</label>
    <div id="re-destinations">
      ${dests.map((d, i) => renderDestRow(d, i, dests.length)).join('')}
    </div>
    <button class="re-add-btn" data-action="add-dest">+ Adicionar Destino</button>
  `;
}

function renderDestRow(d, i, total) {
  const destOptions = allDestinations.length
    ? allDestinations.map(dest => {
        const label = `${dest.city || ''}, ${dest.country || ''}`.replace(/^, |, $/g, '');
        const selected = (d.city === dest.city && d.country === dest.country) ? 'selected' : '';
        return `<option value="${esc(dest.city||'')}|${esc(dest.country||'')}" ${selected}>${esc(label)}</option>`;
      }).join('')
    : '';

  return `
    <div class="re-dest-row" data-dest-idx="${i}">
      <div class="re-form-group" style="flex:2;">
        <label class="re-label" style="font-size:0.7rem;">Cidade</label>
        <input class="re-input" data-dest="city" value="${esc(d.city || '')}" placeholder="Cidade" />
      </div>
      <div class="re-form-group" style="flex:2;">
        <label class="re-label" style="font-size:0.7rem;">Pa\u00eds</label>
        <input class="re-input" data-dest="country" value="${esc(d.country || '')}" placeholder="Pa\u00eds" />
      </div>
      <div class="re-form-group" style="flex:0 0 80px;">
        <label class="re-label" style="font-size:0.7rem;">Noites</label>
        <input class="re-input" type="number" min="0" data-dest="nights" value="${d.nights || 1}" />
      </div>
      <div style="display:flex;gap:4px;align-items:flex-end;padding-bottom:2px;">
        ${i > 0 ? `<button class="re-remove-btn" data-action="move-dest-up" data-idx="${i}" title="Mover para cima">\u25B2</button>` : ''}
        ${i < total - 1 ? `<button class="re-remove-btn" data-action="move-dest-down" data-idx="${i}" title="Mover para baixo">\u25BC</button>` : ''}
        <button class="re-remove-btn" data-action="remove-dest" data-idx="${i}" title="Remover">\u2715</button>
      </div>
    </div>
  `;
}

/* ── 2: Dia a dia ────────────────────────────────────────── */
function renderDiaDiaSection() {
  const days = currentRoteiro.days || [];
  if (!days.length) {
    return `
      <div class="re-section-title">Dia a Dia</div>
      <div style="text-align:center;padding:30px;color:var(--text-muted);">
        <p>Nenhum dia gerado ainda.</p>
        <p style="font-size:0.8125rem;">Preencha as datas e destinos na se\u00e7\u00e3o Viagem e clique em "Gerar dias automaticamente".</p>
      </div>
      <button class="re-add-btn" data-action="generate-days" style="margin-top:8px;">Gerar dias automaticamente</button>
      <button class="re-add-btn" data-action="add-day" style="margin-left:8px;">+ Adicionar dia manualmente</button>
    `;
  }

  return `
    <div class="re-section-title">Dia a Dia</div>
    <div style="margin-bottom:12px;">
      <button class="re-add-btn" data-action="generate-days">Gerar dias automaticamente</button>
    </div>
    <div id="re-days-list">
      ${days.map((d, i) => renderDayCard(d, i)).join('')}
    </div>
    <button class="re-add-btn" data-action="add-day">+ Adicionar Dia</button>
  `;
}

function renderDayCard(d, i) {
  const dateLabel = currentRoteiro.travel.startDate
    ? formatDateForDay(currentRoteiro.travel.startDate, i)
    : (d.date || '');
  const activities = d.activities || [];

  return `
    <div class="re-day-card" data-day-idx="${i}">
      <div class="re-day-num">Dia ${d.dayNumber || i + 1}</div>
      <div class="re-day-date">${esc(dateLabel)} ${d.city ? '- ' + esc(d.city) : ''}</div>
      <div class="re-row" style="margin-top:10px;">
        <div class="re-form-group" style="flex:1;">
          <label class="re-label" style="font-size:0.7rem;">T\u00edtulo do Dia</label>
          <input class="re-input" data-day="title" value="${esc(d.title || '')}" placeholder="Ex: Chegada em Paris" />
        </div>
        <div class="re-form-group" style="flex:0 0 160px;">
          <label class="re-label" style="font-size:0.7rem;">Cidade</label>
          <input class="re-input" data-day="city" value="${esc(d.city || '')}" placeholder="Cidade" />
        </div>
      </div>
      <div class="re-form-group">
        <label class="re-label" style="font-size:0.7rem;">Narrativa</label>
        <textarea class="re-textarea" data-day="narrative" rows="4" placeholder="Descreva as atividades e experi\u00eancias do dia...">${esc(d.narrative || '')}</textarea>
      </div>
      <div class="re-form-group">
        <label class="re-label" style="font-size:0.7rem;">Atividades</label>
        <div id="re-activities-${i}">
          ${activities.map((act, ai) => `
            <div class="re-activity-row" data-activity-idx="${ai}">
              <input class="re-input" data-activity="time" value="${esc(act.time || '')}" placeholder="Hor\u00e1rio" style="width:80px;" />
              <input class="re-input" data-activity="description" value="${esc(act.description || '')}" placeholder="Descri\u00e7\u00e3o" style="flex:1;" />
              <select class="re-select" data-activity="type" style="width:120px;">
                <option value="passeio" ${act.type==='passeio'?'selected':''}>Passeio</option>
                <option value="refeicao" ${act.type==='refeicao'?'selected':''}>Refei\u00e7\u00e3o</option>
                <option value="transfer" ${act.type==='transfer'?'selected':''}>Transfer</option>
                <option value="livre" ${act.type==='livre'?'selected':''}>Livre</option>
              </select>
              <button class="re-remove-btn" data-action="remove-activity" data-day="${i}" data-aidx="${ai}">\u2715</button>
            </div>
          `).join('')}
        </div>
        <button class="re-add-btn" data-action="add-activity" data-day="${i}" style="font-size:0.75rem;padding:4px 10px;margin-top:4px;">+ Atividade</button>
      </div>
      <div class="re-row" style="margin-top:4px;">
        <div class="re-form-group" style="flex:0 0 200px;">
          <label class="re-label" style="font-size:0.7rem;">Pernoite</label>
          <input class="re-input" data-day="overnightCity" value="${esc(d.overnightCity || '')}" placeholder="Cidade do pernoite" />
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="re-add-btn" data-action="ai-day" data-idx="${i}" style="font-size:0.75rem;padding:4px 10px;">Gerar com IA</button>
        <button class="re-remove-btn" data-action="remove-day" data-idx="${i}" style="margin-left:auto;">\u2715 Remover</button>
      </div>
    </div>
  `;
}

/* ── 3: Hot\u00e9is ──────────────────────────────────────────── */
function renderHoteisSection() {
  const hotels = currentRoteiro.hotels || [];
  return `
    <div class="re-section-title">Hot\u00e9is</div>
    <table class="re-dyn-table">
      <thead>
        <tr>
          <th>Cidade</th><th>Nome do Hotel</th><th>Categoria Quarto</th><th>Regime</th>
          <th>Check-in</th><th>Check-out</th><th>Noites</th><th></th>
        </tr>
      </thead>
      <tbody id="re-hotels-body">
        ${hotels.map((h, i) => renderHotelRow(h, i)).join('')}
      </tbody>
    </table>
    <button class="re-add-btn" data-action="add-hotel">+ Adicionar Hotel</button>
  `;
}

function renderHotelRow(h, i) {
  const nights = (h.checkIn && h.checkOut) ? diffDays(h.checkIn, h.checkOut) : (h.nights || '');
  return `
    <tr data-hotel-idx="${i}">
      <td><input data-hotel="city" value="${esc(h.city || '')}" placeholder="Cidade" /></td>
      <td><input data-hotel="hotelName" value="${esc(h.hotelName || '')}" placeholder="Nome do hotel" /></td>
      <td><input data-hotel="roomType" value="${esc(h.roomType || '')}" placeholder="Categoria" /></td>
      <td><input data-hotel="regime" value="${esc(h.regime || '')}" placeholder="Regime" /></td>
      <td><input data-hotel="checkIn" type="date" value="${h.checkIn || ''}" /></td>
      <td><input data-hotel="checkOut" type="date" value="${h.checkOut || ''}" /></td>
      <td><input data-hotel="nights" type="number" value="${nights}" readonly style="opacity:0.7;width:55px;" /></td>
      <td><button class="re-remove-btn" data-action="remove-hotel" data-idx="${i}">\u2715</button></td>
    </tr>
  `;
}

/* ── 4: Valores ──────────────────────────────────────────── */
function renderValoresSection() {
  const p = currentRoteiro.pricing;
  const rows = p.customRows || [];
  return `
    <div class="re-section-title">Valores</div>
    <div class="re-row">
      <div class="re-form-group">
        <label class="re-label">Valor por Pessoa</label>
        <input class="re-input" type="number" step="0.01" data-field="pricing.perPerson" value="${p.perPerson || ''}" placeholder="0.00" />
      </div>
      <div class="re-form-group">
        <label class="re-label">Valor por Casal</label>
        <input class="re-input" type="number" step="0.01" data-field="pricing.perCouple" value="${p.perCouple || ''}" placeholder="0.00" />
      </div>
      <div class="re-form-group">
        <label class="re-label">Moeda</label>
        <select class="re-select" data-field="pricing.currency">
          <option value="BRL" ${p.currency==='BRL'?'selected':''}>BRL</option>
          <option value="USD" ${p.currency==='USD'?'selected':''}>USD</option>
          <option value="EUR" ${p.currency==='EUR'?'selected':''}>EUR</option>
        </select>
      </div>
    </div>
    <div class="re-form-group">
      <label class="re-label">Validade</label>
      <input class="re-input" type="date" data-field="pricing.validUntil" value="${p.validUntil || ''}" style="max-width:250px;" />
    </div>
    <div class="re-form-group">
      <label class="re-label">Disclaimer</label>
      <textarea class="re-textarea" data-field="pricing.disclaimer" rows="3">${esc(p.disclaimer || '')}</textarea>
    </div>
    <label class="re-label">Valores Adicionais</label>
    <table class="re-dyn-table">
      <thead><tr><th>Descri\u00e7\u00e3o</th><th>Valor</th><th></th></tr></thead>
      <tbody id="re-pricing-rows">
        ${rows.map((r, i) => `
          <tr data-prow-idx="${i}">
            <td><input data-prow="label" value="${esc(r.label || '')}" placeholder="Descri\u00e7\u00e3o" /></td>
            <td><input data-prow="value" value="${esc(r.value || '')}" placeholder="Valor" /></td>
            <td><button class="re-remove-btn" data-action="remove-prow" data-idx="${i}">\u2715</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <button class="re-add-btn" data-action="add-prow">+ Adicionar Linha</button>
  `;
}

/* ── 5: Opcionais ────────────────────────────────────────── */
function renderOpcionaisSection() {
  const opts = currentRoteiro.optionals || [];
  return `
    <div class="re-section-title">Opcionais</div>
    <table class="re-dyn-table">
      <thead>
        <tr><th>Servi\u00e7o</th><th>Pre\u00e7o Adulto</th><th>Pre\u00e7o Crian\u00e7a</th><th>Observa\u00e7\u00f5es</th><th></th></tr>
      </thead>
      <tbody id="re-optionals-body">
        ${opts.map((o, i) => `
          <tr data-opt-idx="${i}">
            <td><input data-opt="service" value="${esc(o.service || '')}" placeholder="Nome do servi\u00e7o" /></td>
            <td><input data-opt="priceAdult" type="number" step="0.01" value="${o.priceAdult || ''}" placeholder="0.00" /></td>
            <td><input data-opt="priceChild" type="number" step="0.01" value="${o.priceChild || ''}" placeholder="0.00" /></td>
            <td><input data-opt="notes" value="${esc(o.notes || '')}" placeholder="Notas" /></td>
            <td><button class="re-remove-btn" data-action="remove-opt" data-idx="${i}">\u2715</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <button class="re-add-btn" data-action="add-opt">+ Adicionar Opcional</button>
  `;
}

/* ── 6: Inclui / N\u00e3o inclui ─────────────────────────────── */
function renderIncluiSection() {
  const inc = currentRoteiro.includes || [];
  const exc = currentRoteiro.excludes || [];
  return `
    <div class="re-section-title">Inclui / N\u00e3o Inclui</div>
    <div style="margin-bottom:12px;display:flex;gap:8px;">
      <button class="re-add-btn" data-action="preset-includes" style="margin-top:0;">Adicionar padr\u00e3o (Inclui)</button>
      <button class="re-add-btn" data-action="preset-excludes" style="margin-top:0;">Adicionar padr\u00e3o (N\u00e3o Inclui)</button>
    </div>
    <div class="re-two-cols">
      <div>
        <label class="re-label" style="color:var(--brand-blue,#3B82F6);font-weight:700;">Inclui</label>
        <div class="re-list-col" id="re-includes-list">
          ${inc.map((item, i) => `
            <div class="re-list-item" data-inc-idx="${i}">
              <input class="re-input" data-inc="text" value="${esc(item)}" placeholder="Item incluso..." />
              <button class="re-remove-btn" data-action="remove-inc" data-idx="${i}">\u2715</button>
            </div>
          `).join('')}
        </div>
        <button class="re-add-btn" data-action="add-inc">+ Adicionar</button>
      </div>
      <div>
        <label class="re-label" style="color:#EF4444;font-weight:700;">N\u00e3o Inclui</label>
        <div class="re-list-col" id="re-excludes-list">
          ${exc.map((item, i) => `
            <div class="re-list-item" data-exc-idx="${i}">
              <input class="re-input" data-exc="text" value="${esc(item)}" placeholder="Item n\u00e3o incluso..." />
              <button class="re-remove-btn" data-action="remove-exc" data-idx="${i}">\u2715</button>
            </div>
          `).join('')}
        </div>
        <button class="re-add-btn" data-action="add-exc">+ Adicionar</button>
      </div>
    </div>
  `;
}

/* ── 7: Pagamento ────────────────────────────────────────── */
function renderPagamentoSection() {
  const p = currentRoteiro.payment;
  return `
    <div class="re-section-title">Pagamento</div>
    <div class="re-row">
      <div class="re-form-group">
        <label class="re-label">Sinal / Entrada</label>
        <input class="re-input" data-field="payment.deposit" value="${esc(p.deposit || '')}" placeholder="Ex: 30% no ato da reserva" />
      </div>
      <div class="re-form-group">
        <label class="re-label">Parcelas</label>
        <input class="re-input" data-field="payment.installments" value="${esc(p.installments || '')}" placeholder="Ex: Saldo em at\u00e9 3x sem juros" />
      </div>
    </div>
    <div class="re-form-group">
      <label class="re-label">Prazo</label>
      <input class="re-input" data-field="payment.deadline" value="${esc(p.deadline || '')}" placeholder="Ex: At\u00e9 30 dias antes do embarque" style="max-width:400px;" />
    </div>
    <div class="re-form-group">
      <label class="re-label">Observa\u00e7\u00f5es</label>
      <textarea class="re-textarea" data-field="payment.notes" rows="3" placeholder="Informa\u00e7\u00f5es adicionais sobre pagamento...">${esc(p.notes || '')}</textarea>
    </div>
  `;
}

/* ── 8: Cancelamento ─────────────────────────────────────── */
function renderCancelamentoSection() {
  const canc = currentRoteiro.cancellation || [];
  return `
    <div class="re-section-title">Cancelamento</div>
    <table class="re-dyn-table">
      <thead><tr><th>Per\u00edodo</th><th>Penalidade</th><th></th></tr></thead>
      <tbody id="re-canc-body">
        ${canc.map((c, i) => `
          <tr data-canc-idx="${i}">
            <td><input data-canc="period" value="${esc(c.period || '')}" placeholder="Ex: At\u00e9 30 dias antes" /></td>
            <td><input data-canc="penalty" value="${esc(c.penalty || '')}" placeholder="Ex: Sem custo" /></td>
            <td><button class="re-remove-btn" data-action="remove-canc" data-idx="${i}">\u2715</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <div style="display:flex;gap:8px;margin-top:8px;">
      <button class="re-add-btn" data-action="add-canc">+ Adicionar Regra</button>
      <button class="re-add-btn" data-action="preset-canc">Adicionar pol\u00edtica padr\u00e3o</button>
    </div>
  `;
}

/* ── 9: Informa\u00e7\u00f5es Importantes ─────────────────────────── */
function renderInfoSection() {
  const info = currentRoteiro.importantInfo;
  const custom = info.customFields || [];
  return `
    <div class="re-section-title">Informa\u00e7\u00f5es Importantes</div>
    <div class="re-grid-2">
      <div class="re-form-group">
        <label class="re-label">Passaporte</label>
        <textarea class="re-textarea" data-field="importantInfo.passport" rows="2" placeholder="Informa\u00e7\u00f5es sobre passaporte...">${esc(info.passport || '')}</textarea>
      </div>
      <div class="re-form-group">
        <label class="re-label">Visto</label>
        <textarea class="re-textarea" data-field="importantInfo.visa" rows="2" placeholder="Informa\u00e7\u00f5es sobre visto...">${esc(info.visa || '')}</textarea>
      </div>
      <div class="re-form-group">
        <label class="re-label">Vacinas</label>
        <textarea class="re-textarea" data-field="importantInfo.vaccines" rows="2" placeholder="Vacinas recomendadas...">${esc(info.vaccines || '')}</textarea>
      </div>
      <div class="re-form-group">
        <label class="re-label">Clima</label>
        <textarea class="re-textarea" data-field="importantInfo.climate" rows="2" placeholder="Informa\u00e7\u00f5es sobre o clima...">${esc(info.climate || '')}</textarea>
      </div>
      <div class="re-form-group">
        <label class="re-label">Bagagem</label>
        <textarea class="re-textarea" data-field="importantInfo.luggage" rows="2" placeholder="Dicas sobre bagagem...">${esc(info.luggage || '')}</textarea>
      </div>
      <div class="re-form-group">
        <label class="re-label">Voos</label>
        <textarea class="re-textarea" data-field="importantInfo.flights" rows="2" placeholder="Informa\u00e7\u00f5es sobre voos...">${esc(info.flights || '')}</textarea>
      </div>
    </div>
    <label class="re-label">Campos Adicionais</label>
    <table class="re-dyn-table" style="margin-top:4px;">
      <thead><tr><th>Campo</th><th>Conte\u00fado</th><th></th></tr></thead>
      <tbody id="re-info-custom-body">
        ${custom.map((f, i) => `
          <tr data-infoc-idx="${i}">
            <td><input data-infoc="label" value="${esc(f.label || '')}" placeholder="Nome do campo" /></td>
            <td><textarea data-infoc="value" rows="2" placeholder="Conte\u00fado">${esc(f.value || '')}</textarea></td>
            <td><button class="re-remove-btn" data-action="remove-infoc" data-idx="${i}">\u2715</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <button class="re-add-btn" data-action="add-infoc">+ Adicionar Campo</button>
  `;
}

/* ── 10: Imagens (capa, cidades, hotéis) ─────────────────── */

/** Slug helper — mesma lógica de roteiroGenerator.normKey */
function _normKey(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** Cache de banco de imagens carregado on-demand para o modal */
let _bankImagesCache = null;
async function _ensureBankImages() {
  if (_bankImagesCache) return _bankImagesCache;
  try { _bankImagesCache = await fetchImages({}); }
  catch (e) { _bankImagesCache = []; }
  return _bankImagesCache;
}

/** Extrai cidades únicas (destinations + days) com cidade+país */
function _collectCities() {
  const cities = new Map(); // key: slug, value: {city, country}
  (currentRoteiro?.travel?.destinations || []).forEach(d => {
    if (d.city) cities.set(_normKey(d.city), { city: d.city, country: d.country || '' });
  });
  (currentRoteiro?.days || []).forEach(d => {
    if (d.city && !cities.has(_normKey(d.city))) {
      cities.set(_normKey(d.city), { city: d.city, country: '' });
    }
  });
  return Array.from(cities.entries()).map(([key, v]) => ({ key, ...v }));
}

function renderImagensSection() {
  // Garante estrutura
  if (!currentRoteiro.images) currentRoteiro.images = { hero: null, overrides: {} };
  if (!currentRoteiro.images.overrides) currentRoteiro.images.overrides = {};

  const overrides = currentRoteiro.images.overrides;
  const heroOverride = overrides.hero || currentRoteiro.images.hero || '';
  const cities = _collectCities();
  const hotels = currentRoteiro.hotels || [];

  const heroLabel = heroOverride ? 'Personalizada' : 'Auto (1ª destinação)';

  const heroRow = `
    <div class="re-img-row" data-img-target="hero">
      <div class="re-img-thumb">
        ${heroOverride
          ? `<img src="${esc(heroOverride)}" alt="hero" />`
          : `<span class="re-img-auto">AUTO</span>`}
      </div>
      <div class="re-img-meta">
        <div class="re-img-name">Capa do Roteiro</div>
        <div class="re-img-sub">${heroLabel}</div>
      </div>
      <div class="re-img-actions">
        <button class="re-add-btn" data-action="img-pick" data-img-key="hero" data-img-q="${esc((currentRoteiro.travel?.destinations?.[0]?.city || '') + ' ' + (currentRoteiro.travel?.destinations?.[0]?.country || ''))}">Trocar</button>
        ${heroOverride ? `<button class="re-remove-btn" data-action="img-clear" data-img-key="hero">Limpar</button>` : ''}
      </div>
    </div>`;

  const cityRows = cities.length ? cities.map(c => {
    const ovKey = `city_${c.key}`;
    const url = overrides[ovKey] || '';
    const label = c.country ? `${c.city}, ${c.country}` : c.city;
    const q = `${c.city} ${c.country || ''}`.trim();
    return `
      <div class="re-img-row" data-img-target="${esc(ovKey)}">
        <div class="re-img-thumb">
          ${url
            ? `<img src="${esc(url)}" alt="${esc(c.city)}" />`
            : `<span class="re-img-auto">AUTO</span>`}
        </div>
        <div class="re-img-meta">
          <div class="re-img-name">${esc(label)}</div>
          <div class="re-img-sub">${url ? 'Personalizada' : 'Auto (banco → Unsplash)'}</div>
        </div>
        <div class="re-img-actions">
          <button class="re-add-btn" data-action="img-pick" data-img-key="${esc(ovKey)}" data-img-q="${esc(q)}">Trocar</button>
          ${url ? `<button class="re-remove-btn" data-action="img-clear" data-img-key="${esc(ovKey)}">Limpar</button>` : ''}
        </div>
      </div>`;
  }).join('') : `<div class="re-img-empty">Nenhuma cidade ainda — adicione destinos na seção Viagem.</div>`;

  const hotelRows = hotels.length ? hotels.map((h, i) => {
    const ovKey = `hotel_${i}`;
    const url = overrides[ovKey] || '';
    const label = h.hotelName ? `${h.hotelName}${h.city ? ' — ' + h.city : ''}` : (h.city || `Hotel ${i+1}`);
    const q = h.hotelName ? `${h.hotelName} ${h.city || ''}`.trim() : (h.city || '');
    return `
      <div class="re-img-row" data-img-target="${esc(ovKey)}">
        <div class="re-img-thumb">
          ${url
            ? `<img src="${esc(url)}" alt="${esc(h.hotelName||h.city||'')}" />`
            : `<span class="re-img-auto">AUTO</span>`}
        </div>
        <div class="re-img-meta">
          <div class="re-img-name">${esc(label)}</div>
          <div class="re-img-sub">${url ? 'Personalizada' : 'Auto'}</div>
        </div>
        <div class="re-img-actions">
          <button class="re-add-btn" data-action="img-pick" data-img-key="${esc(ovKey)}" data-img-q="${esc(q)}">Trocar</button>
          ${url ? `<button class="re-remove-btn" data-action="img-clear" data-img-key="${esc(ovKey)}">Limpar</button>` : ''}
        </div>
      </div>`;
  }).join('') : `<div class="re-img-empty">Nenhum hotel adicionado — vá em Hotéis.</div>`;

  return `
    <div class="re-section-title">Imagens</div>
    <p style="font-size:0.8125rem;color:var(--text-muted);margin:-4px 0 14px;line-height:1.5;">
      A geração de PDF/PPTX usa, em ordem: imagem manual → banco do Portal → Unsplash → Wikipedia.
      Marque "Trocar" para escolher manualmente; senão fica automática.
    </p>

    <div class="re-img-group">
      <div class="re-img-group-title">Capa</div>
      ${heroRow}
    </div>

    <div class="re-img-group">
      <div class="re-img-group-title">Cidades do roteiro (${cities.length})</div>
      ${cityRows}
    </div>

    <div class="re-img-group">
      <div class="re-img-group-title">Hotéis (${hotels.length})</div>
      ${hotelRows}
    </div>
  `;
}

/**
 * 4.43.0+ (Sprint 4) — Carrega tarefas vinculadas async e popula a lista
 * na seção Avançado. Chamado via queueMicrotask após render.
 *
 * Mostra: título + status (badge colorida) + dueDate + ícone da operação.
 * Click numa task abre #tasks?focus={taskId} (deep link no módulo de tarefas).
 */
async function populateLinkedTasksList(taskIds) {
  const listEl = document.getElementById('re-linked-tasks-list');
  if (!listEl || !taskIds?.length) return;
  try {
    const { fetchLinkedTasksLite, calcLinkedTasksProgress } = await import('../services/roteiroTasks.js');
    const tasks = await fetchLinkedTasksLite(taskIds);
    if (!tasks.length) {
      listEl.innerHTML = `<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:0.8125rem;">
        Tarefas vinculadas foram excluídas ou são inacessíveis.
      </div>`;
      return;
    }
    const progress = calcLinkedTasksProgress(tasks);
    const STATUS_COLORS = {
      not_started: { bg: '#94A3B8', text: 'Não iniciada' },
      in_progress: { bg: '#3B82F6', text: 'Em andamento' },
      done:        { bg: '#10B981', text: 'Concluída' },
      blocked:     { bg: '#EF4444', text: 'Bloqueada' },
      pending:     { bg: '#F59E0B', text: 'Pendente' },
    };
    const OP_ICONS = {
      voos: '✈',  hotel: '🏨',  transfers: '🚐',
      seguro: '🛡', materiais: '📦', vouchers: '🎟',
    };
    // Sort: done last, others by dueDate asc
    const sorted = [...tasks].sort((a, b) => {
      if (a.status === 'done' && b.status !== 'done') return 1;
      if (b.status === 'done' && a.status !== 'done') return -1;
      return (a.dueDate || '').localeCompare(b.dueDate || '');
    });
    const rowsHTML = sorted.map(t => {
      const status = STATUS_COLORS[t.status] || STATUS_COLORS.not_started;
      const icon = OP_ICONS[t.operation] || '📋';
      const dueLabel = t.dueDate ? new Date(t.dueDate + 'T12:00:00').toLocaleDateString('pt-BR') : '—';
      const isOverdue = t.dueDate && t.status !== 'done' && new Date(t.dueDate + 'T23:59:59') < new Date();
      // Strip prefix "[Roteiro] ..." pra título mais compacto
      const cleanTitle = (t.title || '').replace(/^\[Roteiro\][^—]+ — /, '');
      return `<a href="#tasks?focus=${esc(t.id)}" target="_blank" rel="noopener"
          style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--border);
            border-radius:6px;margin-bottom:6px;background:var(--bg-card);text-decoration:none;color:inherit;
            transition:background .15s;"
          onmouseover="this.style.background='var(--bg-soft)'" onmouseout="this.style.background='var(--bg-card)'">
        <span style="font-size:1.1rem;flex-shrink:0;">${icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.875rem;font-weight:500;${t.status==='done'?'text-decoration:line-through;color:var(--text-muted);':''}">${esc(cleanTitle || t.title)}</div>
          <div style="font-size:0.7rem;color:${isOverdue?'#EF4444':'var(--text-muted)'};margin-top:2px;">
            ${isOverdue?'⚠ ':''}Prazo: ${esc(dueLabel)}
          </div>
        </div>
        <span style="font-size:0.7rem;font-weight:600;background:${status.bg};color:white;
          padding:3px 10px;border-radius:99px;flex-shrink:0;">${status.text}</span>
      </a>`;
    }).join('');
    listEl.innerHTML = `
      <div style="margin-bottom:10px;display:flex;align-items:center;gap:12px;font-size:0.8125rem;color:var(--text-secondary);">
        <span style="font-weight:600;">${progress.label}</span>
        <div style="flex:1;height:6px;background:#F3F4F6;border-radius:99px;overflow:hidden;">
          <div style="width:${progress.pct}%;height:100%;background:var(--brand-gold);transition:width .3s;"></div>
        </div>
        <span style="font-variant-numeric:tabular-nums;color:var(--text-muted);">${progress.pct}%</span>
      </div>
      ${rowsHTML}
    `;
  } catch (err) {
    listEl.innerHTML = `<div style="padding:16px;text-align:center;color:#EF4444;font-size:0.8125rem;">
      Erro ao carregar: ${esc(err.message)}
    </div>`;
  }
}

/**
 * 4.42.0+ (Sprint 3) — Detecta dicas com versão mais recente disponível
 * no Portal e mostra badge "atualizada disponível" pra cada uma. Faz
 * requests paralelos em background, atualiza DOM sem bloquear UX.
 */
async function checkEmbeddedTipsStale(embedded) {
  if (!Array.isArray(embedded) || !embedded.length) return;
  const checks = embedded.map((e, i) =>
    isEmbeddedTipStale(e).then(stale => ({ idx: i, stale })).catch(() => null)
  );
  const results = await Promise.all(checks);
  results.filter(Boolean).forEach(({ idx, stale }) => {
    const badge = document.querySelector(`[data-embed-stale-${idx}]`);
    if (badge) badge.style.display = stale ? 'inline' : 'none';
  });
}

/**
 * 4.42.0+ (Sprint 3) — Modal pra anexar dica do Portal de Dicas.
 *
 * Reusa visual e estrutura do modal de imagens (mesmas classes CSS). Lista
 * dicas com filtros por continent + country + busca textual. Click numa
 * dica → faz snapshot via snapshotTipForEmbed e adiciona ao roteiro.
 *
 * Snapshot é defensivo: se a tip mudar depois, o roteiro mantém versão
 * anexada. User pode re-publicar manualmente quando quiser.
 */
async function openTipPickerModal() {
  const modal = document.createElement('div');
  modal.className = 're-img-modal-overlay';
  modal.innerHTML = `
    <div class="re-img-modal">
      <div class="re-img-modal-header">
        <div class="re-img-modal-title">💡 Anexar dica do Portal</div>
        <button class="re-img-modal-close" type="button" aria-label="Fechar">&times;</button>
      </div>
      <div style="padding:14px 18px;border-bottom:1px solid var(--border);
        display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
        <input id="re-tip-search" class="re-input" placeholder="Buscar por cidade ou país..." style="flex:1;min-width:220px;" />
        <select id="re-tip-continent" class="re-select" style="max-width:200px;">
          <option value="">Todos continentes</option>
        </select>
      </div>
      <div id="re-tip-picker-list" style="padding:18px;overflow:auto;max-height:60vh;">
        <div style="text-align:center;color:var(--text-muted);padding:40px;">Carregando dicas...</div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const closeModal = () => modal.remove();
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  modal.querySelector('.re-img-modal-close').addEventListener('click', closeModal);
  document.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') { closeModal(); document.removeEventListener('keydown', escHandler); }
  });

  // Carrega dicas
  let allTips = [];
  try {
    allTips = await fetchTips();
  } catch (err) {
    modal.querySelector('#re-tip-picker-list').innerHTML = `
      <div style="text-align:center;color:var(--color-danger);padding:40px;">
        Erro ao carregar dicas: ${esc(err.message)}
      </div>`;
    return;
  }

  // IDs já anexadas (pra mostrar status "já anexada")
  const attachedIds = new Set(
    (currentRoteiro.embeddedTips || []).map(e => e.tipId).filter(Boolean)
  );

  // Popula dropdown de continents
  const continents = [...new Set(allTips.map(t => t.continent).filter(Boolean))].sort();
  const contSelect = modal.querySelector('#re-tip-continent');
  continents.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    contSelect.appendChild(opt);
  });

  // Render fn
  const listEl = modal.querySelector('#re-tip-picker-list');
  const renderList = () => {
    const term = (modal.querySelector('#re-tip-search')?.value || '').trim().toLowerCase();
    const cont = contSelect.value;
    const filtered = allTips.filter(t => {
      if (cont && t.continent !== cont) return false;
      if (term) {
        const hay = `${t.city || ''} ${t.country || ''}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    if (!filtered.length) {
      listEl.innerHTML = `<div style="text-align:center;color:var(--text-muted);padding:40px;">
        Nenhuma dica encontrada com esses filtros.
      </div>`;
      return;
    }
    listEl.innerHTML = filtered.map(t => {
      const already = attachedIds.has(t.id);
      const items = t.segments
        ? Object.values(t.segments).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0)
        : 0;
      return `
        <div data-pick-tip-id="${esc(t.id)}" style="display:flex;align-items:center;gap:14px;
          padding:12px 14px;border:1px solid var(--border);border-radius:8px;
          margin-bottom:8px;cursor:${already ? 'default' : 'pointer'};
          background:${already ? 'var(--bg-soft)' : 'var(--bg-card)'};
          opacity:${already ? '0.6' : '1'};transition:background .15s;"
          ${already ? '' : 'onmouseover="this.style.background=\'var(--bg-soft)\'" onmouseout="this.style.background=\'var(--bg-card)\'"'}>
          <div style="font-size:1.5rem;">💡</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:0.9375rem;">
              ${esc(t.city || '')}${t.country ? ', ' + esc(t.country) : ''}
            </div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
              ${esc(t.continent || 'Sem continente')} · ${items} item${items !== 1 ? 's' : ''}
            </div>
          </div>
          ${already
            ? `<span style="font-size:0.7rem;font-weight:600;color:var(--color-success);
                background:rgba(16,185,129,.1);padding:4px 10px;border-radius:99px;">✓ Já anexada</span>`
            : `<span style="font-size:0.75rem;color:var(--brand-gold);font-weight:500;">Anexar →</span>`}
        </div>
      `;
    }).join('');
    // Wire clicks
    listEl.querySelectorAll('[data-pick-tip-id]').forEach(row => {
      const tipId = row.dataset.pickTipId;
      if (attachedIds.has(tipId)) return; // já anexada — sem ação
      row.addEventListener('click', async () => {
        try {
          row.style.opacity = '0.5';
          row.style.pointerEvents = 'none';
          const snapshot = await snapshotTipForEmbed(tipId);
          if (!Array.isArray(currentRoteiro.embeddedTips)) currentRoteiro.embeddedTips = [];
          currentRoteiro.embeddedTips.push(snapshot);
          rerenderCurrentSection();
          markDirty();
          showToast('Dica anexada.', 'success');
          closeModal();
        } catch (err) {
          showToast('Erro ao anexar: ' + err.message, 'error');
          row.style.opacity = '1';
          row.style.pointerEvents = 'auto';
        }
      });
    });
  };

  modal.querySelector('#re-tip-search').addEventListener('input', renderList);
  contSelect.addEventListener('change', renderList);
  renderList();
}

/** Modal de seleção de imagem — 3 abas: Banco / Online / URL */
async function openImagePickerModal({ imgKey, query }) {
  // Garante container modal
  const modal = document.createElement('div');
  modal.className = 're-img-modal-overlay';
  modal.innerHTML = `
    <div class="re-img-modal">
      <div class="re-img-modal-header">
        <div class="re-img-modal-title">Escolher imagem · <span style="color:var(--text-muted);font-weight:400;">${esc(imgKey)}</span></div>
        <button class="re-img-modal-close" type="button" aria-label="Fechar">&times;</button>
      </div>
      <div class="re-img-modal-tabs">
        <button class="re-img-tab active" data-tab="bank">Banco do Portal</button>
        <button class="re-img-tab" data-tab="online">Buscar online</button>
        <button class="re-img-tab" data-tab="url">URL direta</button>
      </div>

      <div class="re-img-modal-body">
        <!-- Tab: Banco -->
        <div class="re-img-tab-pane active" data-pane="bank">
          <input class="re-input" type="text" id="re-img-bank-q" placeholder="Filtrar (cidade, país, tag…)"
            value="${esc(query || '')}" style="margin-bottom:10px;" />
          <div id="re-img-bank-grid" class="re-img-grid">
            <div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:20px;">Carregando banco…</div>
          </div>
        </div>

        <!-- Tab: Online -->
        <div class="re-img-tab-pane" data-pane="online">
          <div style="display:flex;gap:8px;margin-bottom:10px;">
            <input class="re-input" type="text" id="re-img-online-q" placeholder="Ex: Eiffel Tower Paris"
              value="${esc(query || '')}" style="flex:1;" />
            <button class="re-add-btn" type="button" id="re-img-online-fetch" style="margin-top:0;">Buscar</button>
          </div>
          <div id="re-img-online-result" style="text-align:center;color:var(--text-muted);padding:20px;font-size:0.8125rem;">
            Clique em "Buscar" para procurar no Unsplash + Wikipedia.
          </div>
        </div>

        <!-- Tab: URL -->
        <div class="re-img-tab-pane" data-pane="url">
          <label class="re-label">URL pública da imagem (https://…)</label>
          <input class="re-input" type="url" id="re-img-url-input" placeholder="https://…/foto.jpg" />
          <div style="display:flex;gap:8px;margin-top:10px;">
            <button class="re-add-btn" type="button" id="re-img-url-apply" style="margin-top:0;">Aplicar</button>
          </div>
          <div id="re-img-url-preview" style="margin-top:14px;"></div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Helpers internos
  const closeModal = () => modal.remove();
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  modal.querySelector('.re-img-modal-close').addEventListener('click', closeModal);

  // Tabs
  modal.querySelectorAll('.re-img-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelectorAll('.re-img-tab').forEach(b => b.classList.toggle('active', b === btn));
      modal.querySelectorAll('.re-img-tab-pane').forEach(p =>
        p.classList.toggle('active', p.dataset.pane === btn.dataset.tab));
    });
  });

  function applyImage(url) {
    if (!url) return;
    if (!currentRoteiro.images) currentRoteiro.images = { hero: null, overrides: {} };
    if (!currentRoteiro.images.overrides) currentRoteiro.images.overrides = {};
    currentRoteiro.images.overrides[imgKey] = url;
    if (imgKey === 'hero') currentRoteiro.images.hero = url;
    markDirty();
    closeModal();
    // Re-render para refletir thumbnail
    const content = document.getElementById('re-content-area');
    if (content) content.innerHTML = renderImagensSection();
    showToast('Imagem aplicada.', 'success');
  }

  // ── Tab: Banco ─────────────────────────────────────────
  const bankInput = modal.querySelector('#re-img-bank-q');
  const bankGrid  = modal.querySelector('#re-img-bank-grid');
  const renderBankGrid = (filter) => {
    const f = (filter || '').toLowerCase().trim();
    const all = _bankImagesCache || [];
    const matched = !f ? all : all.filter(img => {
      const hay = [img.city, img.country, img.continent, img.name, img.placeName, ...(img.tags||[])]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(f);
    });
    if (!matched.length) {
      bankGrid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:20px;font-size:0.8125rem;">Nenhuma imagem no banco. Suba imagens no Portal de Dicas → Imagens.</div>`;
      return;
    }
    bankGrid.innerHTML = matched.slice(0, 60).map(img => `
      <div class="re-img-card" data-pick-url="${esc(img.url)}">
        <img src="${esc(img.url)}" loading="lazy" alt="${esc(img.placeName || img.city || '')}" />
        <div class="re-img-card-label">${esc(img.placeName || img.city || img.country || '')}</div>
      </div>
    `).join('');
    bankGrid.querySelectorAll('[data-pick-url]').forEach(el => {
      el.addEventListener('click', () => applyImage(el.dataset.pickUrl));
    });
  };

  await _ensureBankImages();
  renderBankGrid(bankInput.value);
  bankInput.addEventListener('input', (e) => renderBankGrid(e.target.value));

  // ── Tab: Online ────────────────────────────────────────
  const onlineQ      = modal.querySelector('#re-img-online-q');
  const onlineFetch  = modal.querySelector('#re-img-online-fetch');
  const onlineResult = modal.querySelector('#re-img-online-result');
  onlineFetch.addEventListener('click', async () => {
    const q = (onlineQ.value || '').trim();
    if (!q) { onlineResult.textContent = 'Digite algo para buscar.'; return; }
    onlineResult.textContent = 'Buscando…';
    try {
      const url = await resolveDestinationImage({ city: q, country: '' }, null, []);
      if (!url) {
        onlineResult.textContent = 'Nada encontrado para essa busca.';
        return;
      }
      onlineResult.innerHTML = `
        <img src="${esc(url)}" alt="" style="max-width:100%;max-height:300px;border-radius:8px;display:block;margin:0 auto 10px;" />
        <button class="re-add-btn" type="button" id="re-img-online-apply" style="margin-top:0;">Usar esta imagem</button>
      `;
      modal.querySelector('#re-img-online-apply').addEventListener('click', () => applyImage(url));
    } catch (e) {
      onlineResult.textContent = 'Erro: ' + (e.message || 'busca falhou');
    }
  });

  // ── Tab: URL ───────────────────────────────────────────
  const urlInput   = modal.querySelector('#re-img-url-input');
  const urlApply   = modal.querySelector('#re-img-url-apply');
  const urlPreview = modal.querySelector('#re-img-url-preview');
  urlInput.addEventListener('input', () => {
    const v = urlInput.value.trim();
    if (/^https?:\/\//.test(v)) {
      urlPreview.innerHTML = `<img src="${esc(v)}" alt="" style="max-width:100%;max-height:260px;border-radius:8px;display:block;" onerror="this.replaceWith(Object.assign(document.createElement('div'),{textContent:'Imagem não pôde ser carregada.',style:'color:var(--text-muted);font-size:0.8125rem;'}))" />`;
    } else {
      urlPreview.innerHTML = '';
    }
  });
  urlApply.addEventListener('click', () => {
    const v = urlInput.value.trim();
    if (!/^https?:\/\//.test(v)) {
      showToast('URL inválida.', 'error');
      return;
    }
    applyImage(v);
  });
}

/* ── 11: Preview & Export ────────────────────────────────── */
function renderPreviewSection() {
  const areaOptions = allAreas.map(a =>
    `<option value="${esc(a.id)}" ${currentRoteiro.areaId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`
  ).join('');

  const r = currentRoteiro;
  const t = r.travel || {};
  const c = r.client || {};
  const dests = (t.destinations || []).map(d => d.city || d.country).filter(Boolean).join(' \u2192 ');
  const totalNights = (t.destinations || []).reduce((s, d) => s + (parseInt(d.nights) || 0), 0);

  return `
    <div class="re-section-title">Preview & Export</div>
    <div class="re-form-group">
      <label class="re-label">\u00c1rea / BU</label>
      <select class="re-select" data-field="areaId" id="re-area-select" style="max-width:300px;">
        <option value="">Padr\u00e3o</option>
        ${areaOptions}
      </select>
    </div>
    <div class="re-preview-summary">
      <strong>Resumo do Roteiro:</strong><br/>
      <strong>T\u00edtulo:</strong> ${esc(r.title) || '(sem t\u00edtulo)'}<br/>
      <strong>Cliente:</strong> ${esc(c.name) || '(n\u00e3o informado)'}<br/>
      <strong>Destinos:</strong> ${esc(dests) || '(nenhum)'}<br/>
      <strong>Per\u00edodo:</strong> ${t.startDate || '?'} a ${t.endDate || '?'} (${totalNights} noites)<br/>
      <strong>Dias:</strong> ${(r.days || []).length} dia(s) configurado(s)<br/>
      <strong>Hot\u00e9is:</strong> ${(r.hotels || []).length} hotel(\u00e9is)<br/>
      <strong>Status:</strong> ${esc(r.status)}
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button class="re-add-btn" data-action="export-pdf" style="margin-top:0;font-weight:700;">Exportar PDF</button>
      <button class="re-add-btn" data-action="export-pptx" style="margin-top:0;">Exportar PPTX</button>
      <button class="re-add-btn" data-action="gen-link" style="margin-top:0;">Gerar Web Link</button>
    </div>
  `;
}

/* ─── Collect form data from DOM ──────────────────────────── */
function collectFormData() {
  const container = document.getElementById('re-content-area');
  if (!container) return currentRoteiro;

  const data = JSON.parse(JSON.stringify(currentRoteiro));

  // Helper to set nested value
  function setNested(obj, path, val) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }

  // Collect all data-field inputs from the ENTIRE container (parent), not just active section
  const mainContainer = document.getElementById('re-editor-root');
  if (!mainContainer) return data;

  mainContainer.querySelectorAll('[data-field]').forEach(input => {
    const path = input.dataset.field;
    let v;
    if (input.type === 'number') {
      v = input.value === '' ? null : parseFloat(input.value);
    } else {
      v = input.value;
    }
    setNested(data, path, v);
  });

  // Children ages (DEPRECATED 4.41.0+ — kept for legacy docs not yet migrated)
  // 4.40.31+ (Sprint 1 B01) — truncar pra `client.children` count.
  const ages = [];
  mainContainer.querySelectorAll('[data-age-idx]').forEach(input => {
    ages.push(parseInt(input.value) || 0);
  });
  const childrenCount = Math.max(0, parseInt(data.client?.children) || 0);
  data.client.childrenAges = ages.slice(0, childrenCount);

  // 4.41.0+ (Sprint 2) Travelers — lê tabela do DOM se presente
  const trvRows = mainContainer.querySelectorAll('[data-trv-idx]');
  if (trvRows.length || mainContainer.querySelector('#re-travelers-body')) {
    const travelers = [];
    trvRows.forEach((row) => {
      const ageRaw = row.querySelector('[data-trv="age"]')?.value;
      const age = ageRaw === '' || ageRaw == null ? null : parseInt(ageRaw);
      travelers.push({
        id:     row.dataset.trvId || ('trv-' + Math.random().toString(36).slice(2, 8)),
        name:   row.querySelector('[data-trv="name"]')?.value?.trim() || '',
        age:    Number.isFinite(age) && age >= 0 ? age : null,
        isLead: !!row.querySelector('[data-trv="isLead"]')?.checked,
        doc:    row.querySelector('[data-trv="doc"]')?.value?.trim() || '',
        notes:  row.querySelector('[data-trv="notes"]')?.value?.trim() || '',
      });
    });
    // Garante exatamente 1 lead (se nenhum marcado, primeiro vira lead)
    if (travelers.length && !travelers.some(t => t.isLead)) {
      travelers[0].isLead = true;
    }
    data.travelers = travelers;

    // Sincroniza legacy adults/children/childrenAges pra retro-compat
    // (PDF antigo, dashboard antigo etc. ainda podem ler isso até migrarmos tudo)
    data.client.adults       = travelers.filter(t => t.age == null || t.age >= 18).length;
    data.client.children     = travelers.filter(t => t.age != null && t.age < 18).length;
    data.client.childrenAges = travelers.filter(t => t.age != null && t.age < 18).map(t => t.age);
  }

  // 4.41.0+ (Sprint 2) Colaboradores — lê chips selecionados
  const colabPicker = mainContainer.querySelector('#re-collab-picker');
  if (colabPicker) {
    const colabIds = Array.from(colabPicker.querySelectorAll('[data-colab-uid]'))
      .filter(el => el.dataset.colabSelected === 'true')
      .map(el => el.dataset.colabUid);
    data.collaboratorIds = colabIds;
  }

  // 4.41.0+ (Sprint 2) Workflow mode
  const wfm = mainContainer.querySelector('input[name="re-workflow-mode"]:checked');
  if (wfm) data.workflowMode = wfm.value;

  // 4.42.0+ (Sprint 3) embeddedTips — gerenciado in-memory, nada a coletar do DOM.
  // Garantir que o array existe pra handlers downstream não quebrarem.
  if (!Array.isArray(data.embeddedTips)) data.embeddedTips = currentRoteiro.embeddedTips || [];

  // Auto-check stale para dicas anexadas (não-bloqueante).
  // Após render, faz requests paralelos e atualiza badges via DOM patching.
  if (Array.isArray(data.embeddedTips) && data.embeddedTips.length) {
    queueMicrotask(() => checkEmbeddedTipsStale(data.embeddedTips));
  }

  // 4.41.0+ (Sprint 2) Cost pricing
  const cpRows = mainContainer.querySelectorAll('[data-cprow-idx]');
  if (mainContainer.querySelector('#re-cost-section')) {
    if (!data.costPricing) data.costPricing = {};
    const pPer = mainContainer.querySelector('[data-field="costPricing.perPerson"]')?.value;
    const pCpl = mainContainer.querySelector('[data-field="costPricing.perCouple"]')?.value;
    data.costPricing.perPerson = pPer === '' ? null : parseFloat(pPer);
    data.costPricing.perCouple = pCpl === '' ? null : parseFloat(pCpl);
    data.costPricing.currency  = mainContainer.querySelector('[data-field="costPricing.currency"]')?.value || 'USD';
    data.costPricing.notes     = mainContainer.querySelector('[data-field="costPricing.notes"]')?.value?.trim() || '';
    data.costPricing.customRows = [];
    cpRows.forEach(row => {
      data.costPricing.customRows.push({
        label: row.querySelector('[data-cprow="label"]')?.value?.trim() || '',
        value: row.querySelector('[data-cprow="value"]')?.value?.trim() || '',
      });
    });
  }

  // Preferences
  const prefs = [];
  mainContainer.querySelectorAll('#re-pref-group label.checked').forEach(lbl => {
    prefs.push(lbl.dataset.pref);
  });
  if (mainContainer.querySelector('#re-pref-group')) data.client.preferences = prefs;

  // Restrictions
  const rests = [];
  mainContainer.querySelectorAll('#re-rest-group label.checked').forEach(lbl => {
    rests.push(lbl.dataset.rest);
  });
  if (mainContainer.querySelector('#re-rest-group')) data.client.restrictions = rests;

  // Destinations
  const destRows = mainContainer.querySelectorAll('[data-dest-idx]');
  if (destRows.length || mainContainer.querySelector('#re-destinations')) {
    const dests = [];
    destRows.forEach(row => {
      dests.push({
        city:    row.querySelector('[data-dest="city"]')?.value?.trim() || '',
        country: row.querySelector('[data-dest="country"]')?.value?.trim() || '',
        nights:  parseInt(row.querySelector('[data-dest="nights"]')?.value) || 0,
      });
    });
    data.travel.destinations = dests;
    data.travel.nights = dests.reduce((s, d) => s + (d.nights || 0), 0);
    data.travel.endDate = data.travel.startDate ? addDaysToDate(data.travel.startDate, data.travel.nights) : '';
  }

  // Days
  const dayCards = mainContainer.querySelectorAll('[data-day-idx]');
  if (dayCards.length || mainContainer.querySelector('#re-days-list')) {
    const days = [];
    dayCards.forEach((card, idx) => {
      const existing = (currentRoteiro.days || [])[idx] || {};
      const activities = [];
      card.querySelectorAll('[data-activity-idx]').forEach(actRow => {
        activities.push({
          time:        actRow.querySelector('[data-activity="time"]')?.value?.trim() || '',
          description: actRow.querySelector('[data-activity="description"]')?.value?.trim() || '',
          type:        actRow.querySelector('[data-activity="type"]')?.value || 'passeio',
        });
      });
      days.push({
        dayNumber:     existing.dayNumber || idx + 1,
        date:          existing.date || (data.travel.startDate ? addDaysToDate(data.travel.startDate, idx) : ''),
        city:          card.querySelector('[data-day="city"]')?.value?.trim() || existing.city || '',
        title:         card.querySelector('[data-day="title"]')?.value?.trim() || '',
        narrative:     card.querySelector('[data-day="narrative"]')?.value?.trim() || '',
        overnightCity: card.querySelector('[data-day="overnightCity"]')?.value?.trim() || '',
        activities:    activities,
        imageIds:      existing.imageIds || [],
      });
    });
    data.days = days;
  }

  // Hotels
  const hotelRows = mainContainer.querySelectorAll('[data-hotel-idx]');
  if (hotelRows.length || mainContainer.querySelector('#re-hotels-body')) {
    const hotels = [];
    hotelRows.forEach(row => {
      const checkIn = row.querySelector('[data-hotel="checkIn"]')?.value || '';
      const checkOut = row.querySelector('[data-hotel="checkOut"]')?.value || '';
      const nights = (checkIn && checkOut) ? diffDays(checkIn, checkOut) : 0;
      hotels.push({
        city:      row.querySelector('[data-hotel="city"]')?.value?.trim() || '',
        hotelName: row.querySelector('[data-hotel="hotelName"]')?.value?.trim() || '',
        roomType:  row.querySelector('[data-hotel="roomType"]')?.value?.trim() || '',
        regime:    row.querySelector('[data-hotel="regime"]')?.value?.trim() || '',
        checkIn, checkOut, nights,
      });
    });
    data.hotels = hotels;
  }

  // Pricing custom rows
  const prows = [];
  mainContainer.querySelectorAll('[data-prow-idx]').forEach(row => {
    prows.push({
      label: row.querySelector('[data-prow="label"]')?.value?.trim() || '',
      value: row.querySelector('[data-prow="value"]')?.value?.trim() || '',
    });
  });
  if (mainContainer.querySelector('#re-pricing-rows')) data.pricing.customRows = prows;

  // Optionals
  const optionals = [];
  mainContainer.querySelectorAll('[data-opt-idx]').forEach(row => {
    optionals.push({
      service:    row.querySelector('[data-opt="service"]')?.value?.trim() || '',
      priceAdult: parseFloat(row.querySelector('[data-opt="priceAdult"]')?.value) || null,
      priceChild: parseFloat(row.querySelector('[data-opt="priceChild"]')?.value) || null,
      notes:      row.querySelector('[data-opt="notes"]')?.value?.trim() || '',
    });
  });
  if (mainContainer.querySelector('#re-optionals-body')) data.optionals = optionals;

  // Includes
  const includes = [];
  mainContainer.querySelectorAll('[data-inc-idx] [data-inc="text"]').forEach(input => {
    includes.push(input.value);
  });
  if (mainContainer.querySelector('#re-includes-list')) data.includes = includes;

  // Excludes
  const excludes = [];
  mainContainer.querySelectorAll('[data-exc-idx] [data-exc="text"]').forEach(input => {
    excludes.push(input.value);
  });
  if (mainContainer.querySelector('#re-excludes-list')) data.excludes = excludes;

  // Cancellation
  const canc = [];
  mainContainer.querySelectorAll('[data-canc-idx]').forEach(row => {
    canc.push({
      period:  row.querySelector('[data-canc="period"]')?.value?.trim() || '',
      penalty: row.querySelector('[data-canc="penalty"]')?.value?.trim() || '',
    });
  });
  if (mainContainer.querySelector('#re-canc-body')) data.cancellation = canc;

  // Important info custom fields
  const infoCust = [];
  mainContainer.querySelectorAll('[data-infoc-idx]').forEach(row => {
    infoCust.push({
      label: row.querySelector('[data-infoc="label"]')?.value?.trim() || '',
      value: row.querySelector('[data-infoc="value"]')?.value?.trim() || '',
    });
  });
  if (mainContainer.querySelector('#re-info-custom-body')) data.importantInfo.customFields = infoCust;

  return data;
}

/* ─── Sanitização pré-save (4.40.31+ Sprint 1) ─────────────
 * Limpa dados inconsistentes antes de gravar no Firestore:
 *   B04: destinos sem cidade (apareceriam em branco no PDF)
 *   B05: preços negativos (input type=number permite digitar -50)
 *   B06: items vazios em arrays editáveis (includes/excludes/optionals/etc)
 *   B07: deduplicação case-insensitive (já preset-* — mas defesa em profundidade)
 *
 * Roda IMEDIATAMENTE antes de saveRoteiro(), sem afetar o que o user vê
 * na UI (collectFormData ainda retorna o estado bruto pra preservar dirty
 * tracking; sanitizeForSave é só pra persistência).
 */
function sanitizeForSave(data) {
  const out = JSON.parse(JSON.stringify(data));

  // ── B04: Destinos sem cidade ────────────────────────────
  if (Array.isArray(out.travel?.destinations)) {
    out.travel.destinations = out.travel.destinations.filter(d => (d?.city || '').trim());
    out.travel.nights = out.travel.destinations.reduce((s, d) => s + (parseInt(d.nights) || 0), 0);
  }

  // ── B05: Preços negativos ───────────────────────────────
  // Clamp a 0 (não null — manter intenção de "preço zero" como possível).
  const clamp0 = (v) => (typeof v === 'number' && v < 0) ? 0 : v;
  if (out.pricing) {
    out.pricing.perPerson = clamp0(out.pricing.perPerson);
    out.pricing.perCouple = clamp0(out.pricing.perCouple);
  }
  if (Array.isArray(out.optionals)) {
    out.optionals.forEach(o => {
      o.priceAdult = clamp0(o.priceAdult);
      o.priceChild = clamp0(o.priceChild);
    });
  }

  // ── B06: Items vazios em arrays editáveis ───────────────
  out.includes  = (out.includes  || []).map(s => (s || '').trim()).filter(Boolean);
  out.excludes  = (out.excludes  || []).map(s => (s || '').trim()).filter(Boolean);
  if (Array.isArray(out.optionals)) {
    out.optionals = out.optionals.filter(o => (o?.service || '').trim());
  }
  if (Array.isArray(out.cancellation)) {
    out.cancellation = out.cancellation.filter(c => (c?.period || '').trim() || (c?.penalty || '').trim());
  }
  if (Array.isArray(out.pricing?.customRows)) {
    out.pricing.customRows = out.pricing.customRows.filter(r => (r?.label || '').trim() || (r?.value || '').trim());
  }
  if (Array.isArray(out.importantInfo?.customFields)) {
    out.importantInfo.customFields = out.importantInfo.customFields.filter(
      f => (f?.label || '').trim() || (f?.value || '').trim()
    );
  }

  // ── B07: Dedup case-insensitive em includes/excludes ────
  // (presets já dedupam ao adicionar; isto cobre caso de cópia manual
  //  do user "Voo internacional" + "voo internacional" via custom).
  const dedupCI = (arr) => {
    const seen = new Set();
    return arr.filter(s => {
      const k = s.trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  out.includes = dedupCI(out.includes);
  out.excludes = dedupCI(out.excludes);

  // ── 4.41.0+ Sprint 2 sanitização ────────────────────────
  // Travelers: filtrar entradas totalmente vazias (sem nome E sem idade E sem doc)
  // — caso user clique "+ Adicionar viajante" sem preencher e salve.
  if (Array.isArray(out.travelers)) {
    out.travelers = out.travelers.filter(t =>
      (t.name || '').trim() || t.age != null || (t.doc || '').trim()
    );
    // Garante exatamente 1 lead se há travelers
    if (out.travelers.length > 0) {
      const leads = out.travelers.filter(t => t.isLead);
      if (leads.length === 0) {
        out.travelers[0].isLead = true;
      } else if (leads.length > 1) {
        // múltiplos lead → primeiro mantém, outros viram false
        let firstLeadFound = false;
        out.travelers.forEach(t => {
          if (t.isLead) {
            if (firstLeadFound) t.isLead = false;
            firstLeadFound = true;
          }
        });
      }
    }
  }

  // costPricing: clamp negativos a 0, filtrar customRows vazias
  if (out.costPricing) {
    out.costPricing.perPerson = clamp0(out.costPricing.perPerson);
    out.costPricing.perCouple = clamp0(out.costPricing.perCouple);
    if (Array.isArray(out.costPricing.customRows)) {
      out.costPricing.customRows = out.costPricing.customRows.filter(
        r => (r?.label || '').trim() || (r?.value || '').trim()
      );
    }
  }

  // collaboratorIds: dedupe + remover self (consultantId não precisa estar em colab)
  if (Array.isArray(out.collaboratorIds)) {
    out.collaboratorIds = [...new Set(out.collaboratorIds.filter(id => id && id !== out.consultantId))];
  }

  return out;
}

/* ─── Save logic ──────────────────────────────────────────── */
async function handleSave() {
  try {
    // 4.43.0+ (Sprint 4) — captura status PRÉVIO pra detectar transição
    // pra 'approved' depois do save (trigger de geração de tarefas).
    const prevStatus = currentRoteiro?.status;

    currentRoteiro = collectFormData();
    // 4.40.31+ Sanitização centralizada (B04-B07).
    const sanitized = sanitizeForSave(currentRoteiro);

    const indicator = document.getElementById('re-autosave-status');
    if (indicator) indicator.textContent = 'Salvando...';

    const newId = await saveRoteiro(currentRoteiro.id || null, sanitized);
    isDirty = false;

    // Sincroniza o estado em memória com o que foi salvo (pra dirty tracking)
    currentRoteiro = sanitized;

    if (!currentRoteiro.id && newId) {
      currentRoteiro.id = newId;
      const hash = `#roteiro-editor?id=${newId}`;
      history.replaceState(null, '', hash);
    }

    if (indicator) indicator.textContent = 'Salvo';
    showToast('Roteiro salvo com sucesso!', 'success');

    // 4.43.0+ (Sprint 4) — TRIGGER: se status virou 'approved' agora E
    // workflowMode='system' E ainda não tem tasks geradas, oferece gerar.
    // Roda DEPOIS do save (não bloqueia) e DEPOIS do toast de sucesso.
    if (
      sanitized.status === 'approved' &&
      prevStatus !== 'approved' &&
      sanitized.workflowMode !== 'offline' &&
      !sanitized.tasksGeneratedAt &&
      currentRoteiro.id
    ) {
      maybeOfferTaskGeneration(currentRoteiro.id);
    }
  } catch (err) {
    const indicator = document.getElementById('re-autosave-status');
    if (indicator) indicator.textContent = 'Erro ao salvar';
    showToast('Erro ao salvar: ' + err.message, 'error');
  }
}

/**
 * 4.43.0+ (Sprint 4) — Oferece gerar tarefas operacionais via confirm().
 * Não-bloqueante: roda async sem await no callsite.
 */
async function maybeOfferTaskGeneration(roteiroId) {
  // Conta quantas tarefas seriam criadas (baseado no template) pra dar
  // ao user uma noção concreta antes de aprovar.
  const hotels = currentRoteiro.hotels?.length || 0;
  // Fixed: voos + transfers + seguro + materiais + vouchers = 5
  // Plus 1 por hotel
  const estimated = 5 + hotels;

  const userConfirmed = confirm(
    `Roteiro aprovado!\n\n` +
    `Quer gerar ${estimated} tarefas operacionais agora?\n` +
    `(reservar voos, confirmar ${hotels} hotel(éis), transfers, seguro, materiais, vouchers)\n\n` +
    `As datas vão ser calculadas automaticamente a partir do início da viagem.`
  );
  if (!userConfirmed) return;

  try {
    const { generateOperationalTasksForRoteiro } = await import('../services/roteiroTasks.js');
    const result = await generateOperationalTasksForRoteiro(roteiroId);
    if (result.skippedReason === 'workflow-offline') {
      showToast('Modo offline — tarefas não foram geradas.', 'info');
      return;
    }
    showToast(`${result.created} tarefa(s) gerada(s) com sucesso.`, 'success');
    // Re-fetch roteiro pra atualizar linkedTaskIds em memória
    try {
      const fresh = await fetchRoteiro(roteiroId);
      currentRoteiro.linkedTaskIds = fresh.linkedTaskIds || [];
      currentRoteiro.tasksGeneratedAt = fresh.tasksGeneratedAt || null;
      // Se user está na seção Avançado, re-renderiza pra mostrar a lista
      if (activeSection === 12) rerenderCurrentSection();
    } catch (_) { /* non-blocking */ }
  } catch (err) {
    showToast('Erro ao gerar tarefas: ' + err.message, 'error');
  }
}

/* ─── Mark dirty & auto-save ──────────────────────────────── */
function markDirty() {
  isDirty = true;
  const indicator = document.getElementById('re-autosave-status');
  if (indicator) indicator.textContent = 'Altera\u00e7\u00f5es n\u00e3o salvas';
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    if (isDirty) handleSave();
  }, 30000);
}

/* ─── Switch active section ───────────────────────────────── */
function switchSection(index) {
  // Save current section data before switching
  currentRoteiro = collectFormData();

  activeSection = index;

  // Update nav items
  const nav = document.getElementById('re-sidebar-nav');
  if (nav) {
    nav.querySelectorAll('.re-nav-item').forEach((item, i) => {
      item.classList.toggle('active', i === index);
    });
  }

  // Render new section content
  const content = document.getElementById('re-content-area');
  if (content) {
    content.innerHTML = renderSectionContent(index);
  }

  // 4.43.0+ (Sprint 4) — popula lista de tarefas vinculadas async
  // após render da seção Avançado (12). Não-bloqueante.
  if (index === 12 && Array.isArray(currentRoteiro?.linkedTaskIds) && currentRoteiro.linkedTaskIds.length) {
    queueMicrotask(() => populateLinkedTasksList(currentRoteiro.linkedTaskIds));
  }
}

/**
 * 4.41.0+ (Sprint 2) — Re-render apenas, SEM re-coletar do DOM.
 *
 * Handlers que modificam currentRoteiro diretamente (ex: add-trv, remove-trv,
 * add-cprow) precisam re-renderizar a UI mas NÃO podem chamar switchSection
 * porque ela invoca collectFormData(), que lê do DOM antigo e sobrescreve as
 * mudanças in-memory. Use isto:
 *
 *   currentRoteiro.travelers.push({...});
 *   rerenderCurrentSection();
 */
function rerenderCurrentSection() {
  const content = document.getElementById('re-content-area');
  if (content) content.innerHTML = renderSectionContent(activeSection);
  // 4.43.0+ (Sprint 4) — também popula tasks list quando re-renderiza Avançado.
  if (activeSection === 12 && Array.isArray(currentRoteiro?.linkedTaskIds) && currentRoteiro.linkedTaskIds.length) {
    queueMicrotask(() => populateLinkedTasksList(currentRoteiro.linkedTaskIds));
  }
}

/* ─── Generate empty days from travel data ────────────────── */
function generateDaysFromTravel() {
  const t = currentRoteiro.travel;
  if (!t.startDate) {
    showToast('Preencha a data de in\u00edcio na se\u00e7\u00e3o Viagem.', 'warning');
    return;
  }
  const dests = t.destinations || [];
  if (!dests.length) {
    showToast('Adicione pelo menos um destino.', 'warning');
    return;
  }
  const days = [];
  let dayNum = 0;
  const start = new Date(t.startDate + 'T12:00:00');
  for (const dest of dests) {
    const nights = parseInt(dest.nights) || 1;
    for (let n = 0; n <= nights; n++) {
      // Last night of last destination = departure day
      if (dest !== dests[dests.length - 1] && n >= nights) break;
      const date = new Date(start);
      date.setDate(date.getDate() + dayNum);
      days.push({
        dayNumber: dayNum + 1,
        date: date.toISOString().split('T')[0],
        title: '',
        city: dest.city || dest.country || '',
        narrative: '',
        activities: [],
        overnightCity: n < nights ? (dest.city || dest.country || '') : '',
        imageIds: [],
      });
      dayNum++;
    }
  }
  currentRoteiro.days = days;
  showToast(`${days.length} dias gerados!`, 'success');
}

/* ─── Event delegation handler ────────────────────────────── */
function handleEditorClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) {
    // 4.41.0+ (Sprint 2) Handle collaborator pills toggle
    const colabBtn = e.target.closest('[data-colab-uid]');
    if (colabBtn) {
      e.preventDefault();
      const wasSelected = colabBtn.dataset.colabSelected === 'true';
      colabBtn.dataset.colabSelected = wasSelected ? 'false' : 'true';
      // Restyle inline
      const selected = !wasSelected;
      colabBtn.style.borderColor = selected ? 'var(--brand-gold)' : 'var(--border)';
      colabBtn.style.background  = selected ? 'var(--brand-gold)15' : 'transparent';
      colabBtn.style.color       = selected ? 'var(--brand-gold)' : 'var(--text-secondary)';
      markDirty();
      return;
    }
    // Handle checkbox groups
    const cbLabel = e.target.closest('.re-checkbox-group label');
    if (cbLabel) {
      e.preventDefault();
      cbLabel.classList.toggle('checked');
      const cb = cbLabel.querySelector('input[type="checkbox"]');
      if (cb) cb.checked = cbLabel.classList.contains('checked');
      markDirty();
      return;
    }
    // Handle nav items
    const navItem = e.target.closest('.re-nav-item');
    if (navItem && navItem.dataset.sectionIdx !== undefined) {
      switchSection(parseInt(navItem.dataset.sectionIdx));
      return;
    }
    return;
  }

  const action = target.dataset.action;
  const idx = parseInt(target.dataset.idx);

  switch (action) {
    /* ── Save ─────────────────────────────────────────────── */
    case 'save':
      handleSave();
      break;

    case 'back':
      if (isDirty) {
        if (confirm('Voc\u00ea tem altera\u00e7\u00f5es n\u00e3o salvas. Deseja sair sem salvar?')) {
          isDirty = false;
          location.hash = '#roteiros';
        }
      } else {
        location.hash = '#roteiros';
      }
      break;

    /* ── Destinations ─────────────────────────────────────── */
    case 'add-dest':
      currentRoteiro = collectFormData();
      currentRoteiro.travel.destinations.push({ city: '', country: '', nights: 1 });
      switchSection(1);
      markDirty();
      break;

    case 'remove-dest':
      currentRoteiro = collectFormData();
      currentRoteiro.travel.destinations.splice(idx, 1);
      switchSection(1);
      markDirty();
      break;

    case 'move-dest-up':
      currentRoteiro = collectFormData();
      if (idx > 0) {
        const dArr = currentRoteiro.travel.destinations;
        [dArr[idx - 1], dArr[idx]] = [dArr[idx], dArr[idx - 1]];
      }
      switchSection(1);
      markDirty();
      break;

    case 'move-dest-down':
      currentRoteiro = collectFormData();
      const destsDown = currentRoteiro.travel.destinations;
      if (idx < destsDown.length - 1) {
        [destsDown[idx], destsDown[idx + 1]] = [destsDown[idx + 1], destsDown[idx]];
      }
      switchSection(1);
      markDirty();
      break;

    /* ── Days ─────────────────────────────────────────────── */
    case 'generate-days':
      currentRoteiro = collectFormData();
      generateDaysFromTravel();
      switchSection(2);
      break;

    case 'add-day': {
      currentRoteiro = collectFormData();
      const lastDay = currentRoteiro.days[currentRoteiro.days.length - 1];
      const newDate = lastDay?.date ? addDaysToDate(lastDay.date, 1) : '';
      currentRoteiro.days.push({
        dayNumber: currentRoteiro.days.length + 1,
        date: newDate,
        city: '', title: '', narrative: '', overnightCity: '',
        activities: [], imageIds: [],
      });
      switchSection(2);
      markDirty();
      break;
    }

    case 'remove-day':
      currentRoteiro = collectFormData();
      currentRoteiro.days.splice(idx, 1);
      currentRoteiro.days.forEach((d, i) => d.dayNumber = i + 1);
      switchSection(2);
      markDirty();
      break;

    case 'ai-day':
      showToast('Gera\u00e7\u00e3o com IA dispon\u00edvel em breve.', 'info');
      break;

    case 'add-activity': {
      const dayIdx = parseInt(target.dataset.day);
      currentRoteiro = collectFormData();
      if (!currentRoteiro.days[dayIdx]) break;
      if (!currentRoteiro.days[dayIdx].activities) currentRoteiro.days[dayIdx].activities = [];
      currentRoteiro.days[dayIdx].activities.push({ time: '', description: '', type: 'passeio' });
      switchSection(2);
      markDirty();
      break;
    }

    case 'remove-activity': {
      const dIdx = parseInt(target.dataset.day);
      const aIdx = parseInt(target.dataset.aidx);
      currentRoteiro = collectFormData();
      if (currentRoteiro.days[dIdx]?.activities) {
        currentRoteiro.days[dIdx].activities.splice(aIdx, 1);
      }
      switchSection(2);
      markDirty();
      break;
    }

    /* ── Hotels ───────────────────────────────────────────── */
    case 'add-hotel':
      currentRoteiro = collectFormData();
      currentRoteiro.hotels.push({ city: '', hotelName: '', roomType: '', regime: '', checkIn: '', checkOut: '', nights: 0 });
      switchSection(3);
      markDirty();
      break;

    case 'remove-hotel':
      currentRoteiro = collectFormData();
      currentRoteiro.hotels.splice(idx, 1);
      switchSection(3);
      markDirty();
      break;

    /* ── Pricing rows ─────────────────────────────────────── */
    case 'add-prow':
      currentRoteiro = collectFormData();
      currentRoteiro.pricing.customRows.push({ label: '', value: '' });
      switchSection(4);
      markDirty();
      break;

    case 'remove-prow':
      currentRoteiro = collectFormData();
      currentRoteiro.pricing.customRows.splice(idx, 1);
      switchSection(4);
      markDirty();
      break;

    /* ── Optionals ────────────────────────────────────────── */
    case 'add-opt':
      currentRoteiro = collectFormData();
      currentRoteiro.optionals.push({ service: '', priceAdult: null, priceChild: null, notes: '' });
      switchSection(5);
      markDirty();
      break;

    case 'remove-opt':
      currentRoteiro = collectFormData();
      currentRoteiro.optionals.splice(idx, 1);
      switchSection(5);
      markDirty();
      break;

    /* ── Linked tasks (4.43.0+ Sprint 4) ──────────────────── */
    case 'generate-tasks':
    case 'regenerate-tasks': {
      if (!currentRoteiro.id) {
        showToast('Salve o roteiro antes de gerar tarefas.', 'warning');
        break;
      }
      if (isDirty) await handleSave();
      showToast('Gerando tarefas operacionais...', 'info');
      try {
        const { generateOperationalTasksForRoteiro } = await import('../services/roteiroTasks.js');
        const result = await generateOperationalTasksForRoteiro(currentRoteiro.id);
        if (result.skippedReason === 'workflow-offline') {
          showToast('Modo offline — tarefas não foram geradas.', 'info');
          break;
        }
        showToast(`${result.created} nova(s) tarefa(s) criada(s). ${result.skipped} já existiam.`, 'success');
        // Re-fetch + re-render
        const fresh = await fetchRoteiro(currentRoteiro.id);
        currentRoteiro.linkedTaskIds = fresh.linkedTaskIds || [];
        currentRoteiro.tasksGeneratedAt = fresh.tasksGeneratedAt || null;
        rerenderCurrentSection();
      } catch (err) {
        showToast('Erro: ' + err.message, 'error');
      }
      break;
    }

    /* ── Embedded tips (4.42.0+ Sprint 3) ─────────────────── */
    case 'open-tip-picker': {
      currentRoteiro = collectFormData();
      openTipPickerModal();
      break;
    }

    case 'republish-tip': {
      currentRoteiro = collectFormData();
      const tip = currentRoteiro.embeddedTips?.[idx];
      if (!tip?.tipId) { showToast('Dica sem referência ao original.', 'error'); break; }
      showToast('Atualizando snapshot...', 'info');
      snapshotTipForEmbed(tip.tipId).then(fresh => {
        // Preserva o ID local (pra estabilidade na UI), mas atualiza
        // título/subtitle/snapshotAt/content com a versão atual.
        currentRoteiro.embeddedTips[idx] = { ...fresh, id: tip.id };
        rerenderCurrentSection();
        markDirty();
        showToast('Snapshot atualizado!', 'success');
      }).catch(err => {
        showToast('Erro ao re-publicar: ' + err.message, 'error');
      });
      break;
    }

    case 'remove-tip': {
      currentRoteiro = collectFormData();
      if (Array.isArray(currentRoteiro.embeddedTips)) {
        currentRoteiro.embeddedTips.splice(idx, 1);
      }
      rerenderCurrentSection();
      markDirty();
      break;
    }

    /* ── Cost pricing rows (4.41.0+ Sprint 2) ─────────────── */
    // IMPORTANTE: usa rerenderCurrentSection() em vez de switchSection() pra
    // não perder o push/splice — switchSection re-coleta do DOM e sobrescreve.
    case 'add-cprow': {
      currentRoteiro = collectFormData();
      if (!currentRoteiro.costPricing) currentRoteiro.costPricing = { customRows: [] };
      if (!Array.isArray(currentRoteiro.costPricing.customRows)) currentRoteiro.costPricing.customRows = [];
      currentRoteiro.costPricing.customRows.push({ label: '', value: '' });
      rerenderCurrentSection();
      markDirty();
      break;
    }

    case 'remove-cprow': {
      currentRoteiro = collectFormData();
      if (currentRoteiro.costPricing?.customRows) {
        currentRoteiro.costPricing.customRows.splice(idx, 1);
      }
      rerenderCurrentSection();
      markDirty();
      break;
    }

    /* ── Travelers (4.41.0+ Sprint 2) ─────────────────────── */
    case 'add-trv': {
      currentRoteiro = collectFormData();
      if (!Array.isArray(currentRoteiro.travelers)) currentRoteiro.travelers = [];
      const isFirst = currentRoteiro.travelers.length === 0;
      currentRoteiro.travelers.push({
        id:     'trv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        name:   '',
        age:    null,
        isLead: isFirst,   // primeiro é responsável por default
        doc:    '',
        notes:  isFirst ? 'Responsável' : '',
      });
      rerenderCurrentSection();
      markDirty();
      break;
    }

    case 'remove-trv': {
      currentRoteiro = collectFormData();
      if (Array.isArray(currentRoteiro.travelers)) {
        const wasLead = currentRoteiro.travelers[idx]?.isLead;
        currentRoteiro.travelers.splice(idx, 1);
        // Se removeu o lead e ainda há viajantes, primeiro vira lead
        if (wasLead && currentRoteiro.travelers.length > 0) {
          currentRoteiro.travelers[0].isLead = true;
        }
      }
      rerenderCurrentSection();
      markDirty();
      break;
    }

    /* ── Includes / Excludes ──────────────────────────────── */
    case 'add-inc':
      currentRoteiro = collectFormData();
      currentRoteiro.includes.push('');
      switchSection(6);
      markDirty();
      break;

    case 'remove-inc':
      currentRoteiro = collectFormData();
      currentRoteiro.includes.splice(idx, 1);
      switchSection(6);
      markDirty();
      break;

    case 'add-exc':
      currentRoteiro = collectFormData();
      currentRoteiro.excludes.push('');
      switchSection(6);
      markDirty();
      break;

    case 'remove-exc':
      currentRoteiro = collectFormData();
      currentRoteiro.excludes.splice(idx, 1);
      switchSection(6);
      markDirty();
      break;

    case 'preset-includes': {
      // 4.40.31+ (Sprint 1 B07) \u2014 dedup case-insensitive + trim.
      // Antes: .includes() exact match \u2192 "Voo" e "voo" coexistiam.
      currentRoteiro = collectFormData();
      const existing = new Set(currentRoteiro.includes.map(s => (s || '').trim().toLowerCase()));
      INCLUDES_PRESETS.forEach(p => {
        if (!existing.has(p.trim().toLowerCase())) {
          currentRoteiro.includes.push(p);
          existing.add(p.trim().toLowerCase());
        }
      });
      switchSection(6);
      markDirty();
      showToast('Itens padr\u00e3o adicionados (Inclui).', 'success');
      break;
    }

    case 'preset-excludes': {
      currentRoteiro = collectFormData();
      const existing = new Set(currentRoteiro.excludes.map(s => (s || '').trim().toLowerCase()));
      EXCLUDES_PRESETS.forEach(p => {
        if (!existing.has(p.trim().toLowerCase())) {
          currentRoteiro.excludes.push(p);
          existing.add(p.trim().toLowerCase());
        }
      });
      switchSection(6);
      markDirty();
      showToast('Itens padr\u00e3o adicionados (N\u00e3o Inclui).', 'success');
      break;
    }

    /* ── Cancellation ─────────────────────────────────────── */
    case 'add-canc':
      currentRoteiro = collectFormData();
      currentRoteiro.cancellation.push({ period: '', penalty: '' });
      switchSection(8);
      markDirty();
      break;

    case 'remove-canc':
      currentRoteiro = collectFormData();
      currentRoteiro.cancellation.splice(idx, 1);
      switchSection(8);
      markDirty();
      break;

    case 'preset-canc':
      currentRoteiro = collectFormData();
      CANCELLATION_PRESETS.forEach(p => {
        const exists = currentRoteiro.cancellation.some(c => c.period === p.period);
        if (!exists) currentRoteiro.cancellation.push({ ...p });
      });
      switchSection(8);
      markDirty();
      showToast('Pol\u00edtica de cancelamento padr\u00e3o adicionada.', 'success');
      break;

    /* ── Important Info custom fields ─────────────────────── */
    case 'add-infoc':
      currentRoteiro = collectFormData();
      currentRoteiro.importantInfo.customFields.push({ label: '', value: '' });
      switchSection(9);
      markDirty();
      break;

    case 'remove-infoc':
      currentRoteiro = collectFormData();
      currentRoteiro.importantInfo.customFields.splice(idx, 1);
      switchSection(9);
      markDirty();
      break;

    /* ── Imagens ─────────────────────────────────────────────── */
    case 'img-pick': {
      const imgKey = target.dataset.imgKey;
      const query  = target.dataset.imgQ || '';
      if (!imgKey) break;
      openImagePickerModal({ imgKey, query }).catch(err =>
        showToast('Erro ao abrir seletor: ' + err.message, 'error'));
      break;
    }

    case 'img-clear': {
      const imgKey = target.dataset.imgKey;
      if (!imgKey) break;
      if (!currentRoteiro.images) currentRoteiro.images = { hero: null, overrides: {} };
      if (!currentRoteiro.images.overrides) currentRoteiro.images.overrides = {};
      delete currentRoteiro.images.overrides[imgKey];
      if (imgKey === 'hero') currentRoteiro.images.hero = null;
      markDirty();
      switchSection(10);
      showToast('Imagem removida (volta para automática).', 'success');
      break;
    }

    /* ── Export ────────────────────────────────────────────── */
    case 'export-pdf': {
      const formData = collectFormData();
      if (formData) currentRoteiro = formData;
      if (!currentRoteiro) {
        showToast('Roteiro n\u00e3o carregado. Recarregue a p\u00e1gina.', 'error');
        break;
      }
      if (!(currentRoteiro.days || []).length) {
        showToast('Adicione pelo menos um dia antes de exportar.', 'warning');
        break;
      }
      // \u00c1rea obrigat\u00f3ria: sem ela o doc sai sem logo, sem cores certas, sem branding.
      {
        const areaId = document.getElementById('re-area-select')?.value || currentRoteiro.areaId || '';
        if (!areaId) {
          showToast('Selecione uma \u00c1rea (BU) antes de exportar.', 'warning');
          switchSection(11); // Preview & Export
          break;
        }
        (async () => {
          try {
            if (isDirty || !currentRoteiro.id) await handleSave();
            await generateRoteiroForExport(currentRoteiro, areaId);
          } catch (err) {
            showToast('Erro ao gerar PDF: ' + err.message, 'error');
          }
        })();
      }
      break;
    }

    case 'export-pptx': {
      const formData = collectFormData();
      if (formData) currentRoteiro = formData;
      if (!(currentRoteiro?.days || []).length) {
        showToast('Adicione pelo menos um dia antes de exportar.', 'warning');
        break;
      }
      {
        const areaId = document.getElementById('re-area-select')?.value || currentRoteiro.areaId || '';
        if (!areaId) {
          showToast('Selecione uma \u00c1rea (BU) antes de exportar.', 'warning');
          switchSection(11);
          break;
        }
        (async () => {
          try {
            if (isDirty || !currentRoteiro.id) await handleSave();
            await generateRoteiroForExport(currentRoteiro, areaId, 'pptx');
          } catch (err) {
            showToast('Erro ao gerar PPTX: ' + err.message, 'error');
          }
        })();
      }
      break;
    }

    case 'gen-link': {
      // Coleta nome do cliente do form atual
      const formData = collectFormData();
      if (formData) currentRoteiro = formData;
      const clientName = currentRoteiro?.client?.name || '';

      // Bank guard \u2014 se cliente \u00e9 de banco parceiro, mostrar alerta antes
      const bank = detectBankContext({ clientName });
      if (bank) {
        showBankGuardModal({
          bankName:     bank.name,
          clientName,
          module:       'Roteiros de Viagem',
          contractNote: bank.contractNote,
          onChoosePdf:  async () => {
            // Aciona o botão Exportar PDF (fluxo já existente)
            const pdfBtn = document.querySelector('[data-action="export-pdf"]');
            if (pdfBtn) pdfBtn.click();
            else showToast('Botão "Exportar PDF" não encontrado. Tente manualmente.', 'warning');
          },
          onForceLink:  () => {
            showToast('Gera\u00e7\u00e3o de link web dispon\u00edvel em breve. (Por ora, use Exportar PDF.)', 'info');
          },
        });
        break;
      }
      showToast('Gera\u00e7\u00e3o de link web dispon\u00edvel em breve.', 'info');
      break;
    }
  }
}

/* ─── Handle input changes for hotel night calc & travel totals ── */
function handleEditorChange(e) {
  markDirty();

  const target = e.target;

  // Auto-calc hotel nights
  if (target.dataset.hotel === 'checkIn' || target.dataset.hotel === 'checkOut') {
    const row = target.closest('[data-hotel-idx]');
    if (row) {
      const ci = row.querySelector('[data-hotel="checkIn"]')?.value;
      const co = row.querySelector('[data-hotel="checkOut"]')?.value;
      const nightsInput = row.querySelector('[data-hotel="nights"]');
      if (ci && co && nightsInput) {
        nightsInput.value = diffDays(ci, co);
      }
    }
  }

  // Recalc travel totals
  if (target.dataset.dest === 'nights' || target.dataset.field === 'travel.startDate') {
    recalcTravelTotals();
  }

  // Children count change
  if (target.id === 're-children-count') {
    const count = parseInt(target.value) || 0;
    const agesDiv = document.getElementById('re-children-ages');
    const agesRow = document.getElementById('re-ages-row');
    if (agesDiv && agesRow) {
      agesDiv.style.display = count > 0 ? '' : 'none';
      const current = document.querySelectorAll('[data-age-idx]');
      const currentAges = Array.from(current).map(inp => parseInt(inp.value) || 0);
      let html = '';
      for (let i = 0; i < count; i++) {
        html += `<input class="re-input" type="number" min="0" max="17" data-age-idx="${i}" value="${currentAges[i] || 0}" style="width:70px;" />`;
      }
      agesRow.innerHTML = html;
    }
  }
}

function recalcTravelTotals() {
  const mainContainer = document.getElementById('re-editor-root');
  if (!mainContainer) return;
  const destRows = mainContainer.querySelectorAll('[data-dest-idx]');
  let totalNights = 0;
  destRows.forEach(row => {
    totalNights += parseInt(row.querySelector('[data-dest="nights"]')?.value) || 0;
  });
  const totalEl = mainContainer.querySelector('#re-total-nights');
  if (totalEl) totalEl.textContent = totalNights;

  const startInput = mainContainer.querySelector('[data-field="travel.startDate"]');
  const endInput = mainContainer.querySelector('#re-end-date');
  if (startInput?.value && endInput) {
    endInput.value = addDaysToDate(startInput.value, totalNights);
  }
}

/* ─── Main render ─────────────────────────────────────────── */
export async function renderRoteiroEditor(container) {
  // Permission check
  if (!store.canCreateRoteiro()) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--text-muted);">
        <div style="font-size:2rem;margin-bottom:12px;">\u{1F512}</div>
        <p style="font-size:1.1rem;font-weight:600;">Acesso Restrito</p>
        <p>Voc\u00ea n\u00e3o tem permiss\u00e3o para criar ou editar roteiros.</p>
      </div>`;
    return;
  }

  // Parse ID from hash. Trata 'undefined'/'null' (strings) como sem ID
  // pra cobrir caso navegação acionada por bug em outra página
  // (ex: handler genérico data-action="edit" navegou pra ?id=undefined).
  const idMatch = location.hash.match(/[?&]id=([^&]+)/);
  let roteiroId = idMatch ? idMatch[1] : null;
  if (roteiroId === 'undefined' || roteiroId === 'null' || roteiroId === '') {
    // Limpa hash inválido + redireciona pra listagem sem mostrar erro
    location.hash = '#roteiros';
    return;
  }
  const isAiCreate = location.hash.includes('ai=1');

  // Show loading
  container.innerHTML = `<div style="text-align:center;padding:60px;color:var(--text-muted);">
    ${isAiCreate ? 'Carregando roteiro gerado por IA...' : 'Carregando editor...'}
  </div>`;

  try {
    // Check for AI-generated data in sessionStorage
    let aiData = null;
    if (isAiCreate) {
      const raw = sessionStorage.getItem('ai_roteiro_data');
      const ts = parseInt(sessionStorage.getItem('ai_roteiro_ts') || '0');
      if (raw && (Date.now() - ts) < 300000) { // 5 min TTL
        try { aiData = JSON.parse(raw); } catch (e) { /* ignore */ }
      }
      sessionStorage.removeItem('ai_roteiro_data');
      sessionStorage.removeItem('ai_roteiro_ts');
    }

    // Load data in parallel
    const [roteiroData, destinations, areas] = await Promise.all([
      roteiroId ? fetchRoteiro(roteiroId) : null,
      fetchDestinations().catch(() => []),
      fetchAreas().catch(() => []),
    ]);

    allDestinations = destinations || [];
    allAreas = areas || [];

    if (roteiroData) {
      currentRoteiro = roteiroData;
    } else if (aiData) {
      // Roteiro gerado pela IA
      currentRoteiro = aiData;
      currentRoteiro.status = 'draft';
      currentRoteiro.consultantId = store.get('user')?.uid || '';
      currentRoteiro.consultantName = store.get('user')?.displayName || '';
    } else {
      currentRoteiro = {
        status: 'draft',
        title: '',
        areaId: '',
        consultantId: store.get('user')?.uid,
        consultantName: store.get('user')?.displayName || '',
        client: {
          name: '', email: '', phone: '', type: 'individual',
          adults: 2, children: 0, childrenAges: [],
          preferences: [], restrictions: [],
          economicProfile: 'premium', notes: '',
        },
        travel: { startDate: '', endDate: '', nights: 0, destinations: [] },
        days: [],
        hotels: [],
        pricing: {
          perPerson: null, perCouple: null, currency: 'BRL',
          validUntil: '', disclaimer: '', customRows: [],
        },
        optionals: [],
        includes: [],
        excludes: [],
        payment: { deposit: '', installments: '', deadline: '', notes: '' },
        cancellation: [],
        importantInfo: {
          passport: '', visa: '', vaccines: '', climate: '',
          luggage: '', flights: '', customFields: [],
        },
      };
    }

    // Ensure all sub-objects
    currentRoteiro.client = currentRoteiro.client || {};
    currentRoteiro.client.childrenAges = currentRoteiro.client.childrenAges || [];
    currentRoteiro.client.preferences = currentRoteiro.client.preferences || [];
    currentRoteiro.client.restrictions = currentRoteiro.client.restrictions || [];
    currentRoteiro.travel = currentRoteiro.travel || {};
    currentRoteiro.travel.destinations = currentRoteiro.travel.destinations || [];
    currentRoteiro.days = currentRoteiro.days || [];
    currentRoteiro.hotels = currentRoteiro.hotels || [];
    currentRoteiro.pricing = currentRoteiro.pricing || {};
    currentRoteiro.pricing.customRows = currentRoteiro.pricing.customRows || [];
    currentRoteiro.optionals = currentRoteiro.optionals || [];
    currentRoteiro.includes = currentRoteiro.includes || [];
    currentRoteiro.excludes = currentRoteiro.excludes || [];
    currentRoteiro.payment = currentRoteiro.payment || {};
    currentRoteiro.cancellation = currentRoteiro.cancellation || [];
    currentRoteiro.importantInfo = currentRoteiro.importantInfo || {};
    currentRoteiro.importantInfo.customFields = currentRoteiro.importantInfo.customFields || [];
    currentRoteiro.images = currentRoteiro.images || { hero: null, overrides: {} };
    currentRoteiro.images.overrides = currentRoteiro.images.overrides || {};

    const isAiGenerated = currentRoteiro.aiGenerated === true;
    const pageTitle = roteiroId ? 'Editar Roteiro' : (isAiGenerated ? 'Roteiro Gerado por IA' : 'Novo Roteiro');
    const statusLabel = currentRoteiro.status || 'draft';

    // Inject CSS
    const styleEl = document.createElement('style');
    styleEl.textContent = EDITOR_CSS;
    document.head.appendChild(styleEl);
    container._styleEl = styleEl;

    // Render page
    container.innerHTML = `
      <div id="re-editor-root">
        ${isAiGenerated && !roteiroId ? `
        <!-- AI Banner -->
        <div style="background:#FEF3C720;border:1px solid #F59E0B33;border-radius:10px;
          padding:14px 18px;margin-bottom:16px;display:flex;align-items:flex-start;gap:12px;">
          <span style="font-size:1.25rem;">◈</span>
          <div style="flex:1;">
            <div style="font-size:0.875rem;font-weight:600;color:#F59E0B;margin-bottom:4px;">
              Roteiro gerado por Intelig\u00eancia Artificial
            </div>
            <div style="font-size:0.8125rem;color:var(--text-muted);line-height:1.5;">
              Revise todas as se\u00e7\u00f5es antes de salvar. Verifique nomes de hot\u00e9is, pre\u00e7os,
              hor\u00e1rios e informa\u00e7\u00f5es importantes. A IA pode gerar dados imprecisos.
            </div>
            ${currentRoteiro.aiPrompt ? `
            <details style="margin-top:8px;">
              <summary style="font-size:0.75rem;color:var(--text-muted);cursor:pointer;">Prompt utilizado</summary>
              <p style="font-size:0.75rem;color:var(--text-muted);margin-top:6px;padding:8px;
                background:var(--bg-dark,#0C1926);border-radius:6px;white-space:pre-wrap;">${esc(currentRoteiro.aiPrompt)}</p>
            </details>
            ` : ''}
          </div>
          <button onclick="this.closest('div[style]').remove()" style="background:none;border:none;
            color:var(--text-muted);cursor:pointer;font-size:1.25rem;padding:0 4px;">&times;</button>
        </div>
        ` : ''}

        <!-- Header -->
        <div class="re-header">
          <button class="re-add-btn" data-action="back" style="margin-top:0;padding:6px 14px;font-size:0.8125rem;">\u2190 Voltar</button>
          <span class="re-header-title">${esc(pageTitle)}</span>
          <span class="status-badge">${esc(statusLabel)}</span>
          <span class="re-autosave" id="re-autosave-status">${roteiroId ? 'Carregado' : (isAiGenerated ? 'Gerado por IA — n\u00e3o salvo' : 'Novo roteiro')}</span>
          <button class="re-add-btn" data-action="save" style="margin-top:0;font-weight:700;padding:8px 20px;">Salvar</button>
          <button class="re-add-btn" data-action="export-pdf" style="margin-top:0;padding:8px 16px;">Exportar PDF</button>
        </div>

        <!-- Two-column layout -->
        <div class="re-layout">
          <!-- Sidebar nav -->
          <div class="re-sidebar" id="re-sidebar-nav">
            ${SECTIONS.map((s, i) => `
              <div class="re-nav-item${i === 0 ? ' active' : ''}" data-section-idx="${i}">
                <span>${s.icon}</span>
                <span>${s.label}</span>
              </div>
            `).join('')}
          </div>

          <!-- Content area -->
          <div class="re-content" id="re-content-area">
            ${renderSectionContent(0)}
          </div>
        </div>
      </div>
    `;

    // Event delegation
    container.addEventListener('click', handleEditorClick);
    container.addEventListener('input', handleEditorChange);
    container.addEventListener('change', handleEditorChange);

    // Keyboard shortcut: Ctrl+S / Cmd+S
    const keyHandler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    document.addEventListener('keydown', keyHandler);
    container._keyHandler = keyHandler;
    container._clickHandler = handleEditorClick;
    container._changeHandler = handleEditorChange;

    activeSection = 0;
    isDirty = false;

  } catch (err) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--text-muted);">
        <p style="font-size:1.1rem;font-weight:600;">Erro ao carregar</p>
        <p>${esc(err.message)}</p>
        <button class="re-add-btn" onclick="location.hash='#roteiros'" style="margin-top:16px;">Voltar</button>
      </div>`;
  }
}

/* ─── Destroy ─────────────────────────────────────────────── */
export function destroyRoteiroEditor() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = null;

  // Clean up event listeners
  const container = document.getElementById('re-editor-root')?.parentElement;
  if (container) {
    if (container._keyHandler) {
      document.removeEventListener('keydown', container._keyHandler);
    }
    if (container._clickHandler) {
      container.removeEventListener('click', container._clickHandler);
    }
    if (container._changeHandler) {
      container.removeEventListener('input', container._changeHandler);
      container.removeEventListener('change', container._changeHandler);
    }
    if (container._styleEl) {
      container._styleEl.remove();
    }
  }

  currentRoteiro = null;
  isDirty = false;
  allDestinations = [];
  allAreas = [];
  activeSection = 0;
}
