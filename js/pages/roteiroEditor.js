/**
 * PRIMETOUR — Roteiro Editor: Multi-section Itinerary Editor
 * Two-column layout with sidebar navigation and 11 content sections
 */

import { store }  from '../store.js';
import { toast } from '../components/toast.js';
const showToast = (msg, type = 'info') => toast[type]?.(msg) ?? toast.info(msg);
import { fetchRoteiro, saveRoteiro, snapshotTipForEmbed, isEmbeddedTipStale, createWebLink, updateRoteiroStatus } from '../services/roteiros.js';
import { generateRoteiroForExport, resolveDestinationImage } from '../services/roteiroGenerator.js';
import { fetchDestinations, fetchAreas, fetchImages, fetchTips, saveDestination, CONTINENTS } from '../services/portal.js';
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
  // v4.49.86+ "Briefing" e "Cliente" fundidos em um só. O bloco
  // client.{name,email,preferences,restrictions,economicProfile,notes}
  // + travelers[] já cobre todo o briefing — não precisava de schema novo.
  // v4.49.88+ "Viagem" (datas + destinos) absorvida em "Cliente e Briefing"
  // — só tinha 2 campos efetivos (datas + destinos). Tudo num lugar só.
  { icon: '\u{1F464}', label: 'Cliente e Briefing' },
  { icon: '\u{1F4C5}', label: 'Dia a dia' },
  { icon: '\u2708',    label: 'A\u00e9reo e Hot\u00e9is' },
  { icon: '\u{1F4B0}', label: 'Valores' },
  { icon: '\u2B50',    label: 'Opcionais' },
  { icon: '\u2713',    label: 'Inclui / N\u00e3o inclui' },
  { icon: '\u{1F4B3}', label: 'Pagamento' },
  { icon: '\u274C',    label: 'Cancelamento' },
  { icon: '\u2139',    label: 'Informa\u00e7\u00f5es Importantes' },
  { icon: '\u{1F5BC}', label: 'Imagens' },
  { icon: '\u{1F4A1}', label: 'Dicas anexas' },  // 4.42.0+ Sprint 3 \u2014 embed do Portal de Dicas
  // v4.62.16: Aba Avan\u00e7ado oculta (Ren\u00ea: "vamos tratar disso em outro momento").
  // hidden:true filtra do sidebar mas mant\u00e9m \u00edndice 11 pra switch n\u00e3o quebrar.
  { icon: '\u2699',    label: 'Avan\u00e7ado', hidden: true },
  { icon: '\u{1F4C4}', label: 'Preview & Export' },
  { icon: '\u2728',    label: 'Observa\u00e7\u00f5es IA' },  // v4.49.74+ fontes consultadas + notas internas
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
/* v4.62.16: hover/active alinhados com identidade PRIMETOUR (dourado = brand
   color em luxury; brand-blue era genérico). CLAUDE.md §11.f. */
.re-nav-item:hover { background: var(--bg-hover, rgba(212,168,67,0.06)); }
.re-nav-item.active {
  background: rgba(212,168,67,0.10);
  border-left-color: var(--brand-gold, #D4A843);
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
/* v4.62.16: inputs alinhados com .form-input/.filter-select do sistema:
   - fallbacks light-first (#fff em vez de #1a1a2e dark hardcoded)
   - border-subtle (#e5e7eb), focus dourado consistente com nav active. */
.re-input, .re-select, .re-textarea {
  width: 100%; padding: 0.5rem 0.75rem;
  background: var(--bg-input, #fff);
  border: 1px solid var(--border-subtle, var(--border, #e5e7eb)); border-radius: 6px;
  color: var(--text-primary); font-size: 0.875rem;
  font-family: inherit; box-sizing: border-box;
  transition: border-color 0.12s;
}
.re-textarea { resize: vertical; min-height: 60px; }
.re-input:focus, .re-select:focus, .re-textarea:focus {
  outline: none; border-color: var(--brand-gold, #D4A843);
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
/* v4.49.94+ Alinhado ao .btn-secondary do sistema (CLAUDE.md §4):
   solid border, surface bg, sem dashed. */
.re-add-btn {
  display: inline-flex; align-items: center; gap: 4px; padding: 6px 14px;
  font-size: 0.8125rem; font-weight: 500; font-family: var(--font-ui);
  color: var(--text-primary); background: var(--bg-surface);
  border: 1px solid var(--border-default); border-radius: var(--radius-md, 6px);
  cursor: pointer; margin-top: 8px; transition: all 0.15s;
  line-height: 1;
}
.re-add-btn:hover { background: var(--bg-elevated); border-color: var(--border-accent); }
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

/* ─── v4.49.78+ Briefing (Seção 0) — alinhado ao padrão do editor ─── */
.re-required { color: #EF4444; font-weight: 700; }
.re-briefing-intro {
  margin: 0 0 18px;
  padding: 12px 14px;
  background: var(--bg-surface, #222);
  border-left: 3px solid var(--brand-blue, #3B82F6);
  border-radius: 6px;
  font-size: 0.875rem;
  color: var(--text-secondary);
  line-height: 1.55;
}
.re-briefing-card {
  margin: 18px 0;
  padding: 14px 16px;
  background: var(--bg-surface, #222);
  border: 1px solid var(--border-subtle, #333);
  border-radius: 8px;
}
.re-briefing-card-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 10px; margin-bottom: 12px; flex-wrap: wrap;
}
.re-briefing-card-title {
  font-weight: 600; font-size: 0.9375rem; color: var(--text-primary);
}
.re-briefing-suggest-toggle {
  display: flex; align-items: center; gap: 6px;
  font-size: 0.8125rem; color: var(--text-secondary); cursor: pointer;
  user-select: none;
}
.re-briefing-suggest-toggle input { margin: 0; cursor: pointer; }
.re-briefing-note {
  padding: 10px 12px; border-radius: 6px;
  font-size: 0.8125rem; color: var(--text-secondary); line-height: 1.5;
  margin-bottom: 10px;
}
.re-briefing-note--accent {
  background: var(--bg-card, #1a1a2e);
  border: 1px solid var(--brand-blue, #3B82F6);
}
.re-briefing-dest-list {
  display: flex; flex-direction: column; gap: 8px; margin: 10px 0;
}
.re-briefing-empty {
  padding: 14px; text-align: center;
  color: var(--text-muted); font-size: 0.8125rem;
  border: 1px solid var(--border-subtle, #333); border-radius: 6px;
}
.re-briefing-dest-row {
  display: grid; grid-template-columns: 2fr 2fr 100px 36px; gap: 8px;
  align-items: center; padding: 8px;
  background: var(--bg-card, #1a1a2e);
  border: 1px solid var(--border-subtle, #333); border-radius: 6px;
}
.re-briefing-dest-row .re-input { padding: 6px 10px; font-size: 0.8125rem; }
.re-briefing-card-actions {
  display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px;
}
.re-briefing-hint {
  margin-top: 8px; font-size: 0.75rem;
  color: var(--text-muted); line-height: 1.5;
}
/* v4.49.103+ Status dropdown no header do editor */
.re-status-dropdown { position: relative; }
.re-status-trigger {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 10px; border-radius: 999px;
  background: var(--bg-surface, #f8fafc);
  border: 1px solid var(--border, #e5e7eb);
  cursor: pointer; font-family: inherit;
  font-size: 0.75rem; font-weight: 600; line-height: 1;
  transition: all 0.12s;
}
.re-status-trigger:hover {
  border-color: var(--brand-gold, #D4A843);
  background: rgba(212,168,67,0.06);
}
.re-status-dot {
  display: inline-block; width: 8px; height: 8px; border-radius: 50%;
}
.re-status-chevron {
  font-size: 0.625rem; color: var(--text-muted); margin-left: 2px;
}
.re-status-menu {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: 100;
  min-width: 160px; padding: 4px;
  background: var(--bg-elevated, #fff);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
}
.re-status-option {
  display: flex; align-items: center; gap: 8px;
  width: 100%; padding: 6px 10px; border-radius: 5px;
  background: transparent; border: none; cursor: pointer;
  font-size: 0.8125rem; color: var(--text-primary); font-family: inherit;
  text-align: left; transition: background 0.1s;
}
.re-status-option:hover { background: rgba(212,168,67,0.08); }

/* v4.49.101+ Valores por categoria */
.re-valores-cat {
  margin-top: 24px;
  padding: 16px;
  background: var(--bg-card, #1a1a2e);
  border: 1px solid var(--border-subtle, #333);
  border-radius: 10px;
}
.re-valores-cat-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 12px;
}
.re-valores-cat-title {
  margin: 0; font-size: 0.9375rem; font-weight: 600;
  color: var(--text-primary);
}
.re-valores-cat-subtotal {
  display: inline-flex; align-items: center; gap: 10px;
  font-size: 0.875rem; font-weight: 700;
  color: var(--brand-gold, #D4A843);
}
.re-valores-cat-count {
  padding: 2px 8px; border-radius: 999px;
  background: var(--bg-surface, #222);
  font-size: 0.6875rem; font-weight: 600;
  color: var(--text-muted);
}
.re-valores-table { width: 100%; }
.re-valores-table input[data-svc="value"] { font-variant-numeric: tabular-nums; font-weight: 600; }
.re-valores-empty {
  padding: 14px; text-align: center; color: var(--text-muted);
  font-size: 0.8125rem; background: var(--bg-soft);
  border: 1px solid var(--border-subtle, #333); border-radius: 6px;
}
.re-valores-footer {
  margin-top: 24px; padding: 16px 20px;
  background: linear-gradient(180deg, rgba(212,168,67,0.06), rgba(212,168,67,0.02));
  border: 1px solid rgba(212,168,67,0.30);
  border-radius: 10px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
  align-items: center;
}
.re-valores-footer-label {
  display: block;
  font-size: 0.6875rem; font-weight: 600; color: var(--text-muted);
  text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 4px;
}
.re-valores-footer-value {
  font-size: 1.125rem; font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary);
}
.re-valores-footer-value.gold { color: var(--brand-gold, #D4A843); }
.re-valores-footer-hint {
  grid-column: 1 / -1;
  padding-top: 8px; border-top: 1px solid rgba(212,168,67,0.20);
  font-size: 0.75rem; color: var(--text-muted);
}

/* Pill radio (toggle entre Total único / Subtotais por categoria) */
.re-pill-radio {
  display: inline-flex; align-items: center;
  padding: 6px 14px; border-radius: 999px;
  border: 1px solid var(--border-default, #e5e7eb);
  font-size: 0.75rem; font-weight: 600;
  color: var(--text-muted);
  cursor: pointer; transition: all 0.12s;
  user-select: none;
}
.re-pill-radio:hover { border-color: var(--brand-gold, #D4A843); color: var(--text-primary); }
.re-pill-radio.active {
  background: var(--brand-gold, #D4A843);
  border-color: var(--brand-gold, #D4A843);
  color: #0A1628;
}
.re-pill-radio input[type="radio"] { display: none; }

.re-add-btn--gold {
  color: var(--brand-gold, #D4A843);
  border-color: var(--brand-gold, #D4A843);
}
.re-add-btn--gold:hover {
  background: var(--brand-gold, #D4A843); color: #fff;
}
/* v4.49.83+ Bloco IA simplificado: botao primary padrao + hint discreto
   abaixo quando ha campos faltando. Sem box pesado, sem checklist
   visual gritante, sem info tecnica (Sonnet 4.5, etc.) — tudo isso
   estava poluindo a tela. */
.re-briefing-ai {
  margin-top: 16px; padding: 12px 0;
  display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
}
.re-briefing-ai-hint {
  font-size: 0.8125rem; color: var(--text-muted);
}
/* v4.49.83+ .re-ai-btn removido — usar .btn .btn-primary padrao do sistema. */

@media (max-width: 768px) {
  .re-briefing-dest-row {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto;
  }
  .re-briefing-dest-row .re-remove-btn {
    grid-column: 2; grid-row: 1; justify-self: end;
  }
}

@media (max-width: 768px) {
  .re-layout { grid-template-columns: 1fr; }
  .re-sidebar { position: static; display: flex; flex-wrap: wrap; gap: 4px; }
  .re-nav-item { padding: 6px 10px; font-size: 0.75rem; border-left: none; border-bottom: 2px solid transparent; }
  .re-nav-item.active { border-bottom-color: var(--brand-gold, #D4A843); border-left-color: transparent; }
  .re-grid-2, .re-grid-3, .re-two-cols { grid-template-columns: 1fr; }
  .re-row { flex-direction: column; }
}
`;

/* ─── Section renderers ───────────────────────────────────── */

function renderSectionContent(index) {
  // v4.49.88+ Viagem absorvida em Cliente e Briefing (índices decrementados).
  switch (index) {
    case 0:  return renderClienteSection();        // "Cliente e Briefing" (inclui Viagem)
    case 1:  return renderDiaDiaSection();
    case 2:  return renderHoteisSection();
    case 3:  return renderValoresSection();
    case 4:  return renderOpcionaisSection();
    case 5:  return renderIncluiSection();
    case 6:  return renderPagamentoSection();
    case 7:  return renderCancelamentoSection();
    case 8:  return renderInfoSection();
    case 9:  return renderImagensSection();
    case 10: return renderEmbeddedTipsSection();
    case 11: return renderAdvancedSection();
    case 12: return renderPreviewSection();
    case 13: return renderAiObservationsSection();
    default: return '';
  }
}

/* ── 14: Observações IA (v4.49.74+) ───────────────────────
 *
 * Aba interna pra registrar a "trilha de auditoria" da geração via IA:
 *   - fontes consultadas (URLs do web_search)
 *   - queries usadas pelo agente
 *   - notas livres do consultor sobre essa geração
 *
 * NÃO incluso no PDF/PPT exportado pro cliente. Visível a qualquer
 * consultor logado.
 * ─────────────────────────────────────────────────────────── */
function renderAiObservationsSection() {
  const ai = currentRoteiro?.aiGeneration || {};
  const hasGenerated = !!ai.enabled;
  const sources = Array.isArray(ai.sources) ? ai.sources : [];
  const citations = Array.isArray(ai.citations) ? ai.citations : [];
  const queries = Array.isArray(ai.queries) ? ai.queries : [];
  const agentSources = Array.isArray(ai.aiSourcesFromAgent) ? ai.aiSourcesFromAgent : [];

  if (!hasGenerated) {
    return `
      <div class="re-section">
        <div class="re-section-header">
          <h2 class="re-section-title">✨ Observações IA</h2>
        </div>
        <div style="padding:32px;text-align:center;color:var(--text-muted);
          background:var(--bg-surface);border: 1px solid var(--border-subtle);border-radius:8px;">
          <div style="font-size:2rem;margin-bottom:8px;">🔮</div>
          <div style="font-weight:600;margin-bottom:6px;">Nenhuma geração via IA registrada nesse roteiro.</div>
          <div style="font-size:0.875rem;">
            Clique em <strong>✨ Gerar com IA</strong> no topo pra criar o roteiro automaticamente
            consultando Virtuoso, FHR e LHW. As fontes consultadas aparecerão aqui pra double-check.
          </div>
        </div>
      </div>`;
  }

  const formatDate = iso => {
    try { return new Date(iso).toLocaleString('pt-BR'); }
    catch { return iso || '—'; }
  };

  return `
    <div class="re-section">
      <div class="re-section-header">
        <h2 class="re-section-title">✨ Observações IA</h2>
        <span style="font-size:0.75rem;color:var(--text-muted);">não exportado no PDF/PPT</span>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px;
        padding:14px;background:var(--bg-surface);border-radius:8px;font-size:0.8125rem;">
        <div><strong>Gerado em:</strong><br>${esc(formatDate(ai.generatedAt))}</div>
        <div><strong>Versão do prompt:</strong><br>${esc(ai.promptVersion || '—')}</div>
        <div><strong>Consultas web:</strong><br>${ai.webSearchCount || 0}</div>
        <div><strong>Tokens (in/out):</strong><br>${ai.inputTokens || 0} / ${ai.outputTokens || 0}</div>
      </div>

      <div class="re-field" style="margin-bottom:16px;">
        <label style="font-weight:600;">📝 Notas do consultor sobre essa geração</label>
        <textarea data-field="aiGeneration.consultantNotes" rows="4"
          placeholder="Comentários livres do consultor: o que foi ajustado, ressalvas, próximos passos…"
          style="width:100%;resize:vertical;">${esc(ai.consultantNotes || '')}</textarea>
      </div>

      ${sources.length ? `
        <div style="margin-bottom:16px;">
          <h3 style="font-size:0.9375rem;font-weight:700;margin-bottom:8px;color:var(--text-secondary);">
            🔗 Fontes consultadas pelo agente (web_search)
          </h3>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${sources.map(s => `
              <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer"
                style="display:block;padding:8px 12px;background:var(--bg-surface);
                  border:1px solid var(--border-subtle);border-radius:6px;
                  font-size:0.8125rem;color:var(--brand-gold);text-decoration:none;">
                <strong>${esc(s.title || s.url)}</strong>
                <br><span style="color:var(--text-muted);font-size:0.75rem;">${esc(s.url)}</span>
              </a>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${citations.length ? `
        <div style="margin-bottom:16px;">
          <h3 style="font-size:0.9375rem;font-weight:700;margin-bottom:8px;color:var(--text-secondary);">
            💬 Citações inline (links de fato usados no texto gerado)
          </h3>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${citations.slice(0, 20).map(c => `
              <div style="padding:8px 12px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:6px;font-size:0.8125rem;">
                <a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--brand-gold);font-weight:600;">${esc(c.title || c.url)}</a>
                ${c.citedText ? `<div style="color:var(--text-muted);margin-top:4px;font-style:italic;">"${esc(c.citedText.slice(0, 200))}${c.citedText.length > 200 ? '…' : ''}"</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${agentSources.length ? `
        <div style="margin-bottom:16px;">
          <h3 style="font-size:0.9375rem;font-weight:700;margin-bottom:8px;color:var(--text-secondary);">
            📚 Fontes referenciadas pelo agente no JSON
          </h3>
          <div style="display:flex;flex-direction:column;gap:6px;">
            ${agentSources.map(s => `
              <div style="padding:8px 12px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:6px;font-size:0.8125rem;">
                <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--brand-gold);font-weight:600;">${esc(s.title || s.url)}</a>
                ${s.context ? `<div style="color:var(--text-muted);margin-top:4px;">${esc(s.context)}</div>` : ''}
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${queries.length ? `
        <details style="margin-bottom:16px;">
          <summary style="cursor:pointer;font-size:0.875rem;font-weight:600;color:var(--text-secondary);">
            🔍 Termos de busca usados (${queries.length})
          </summary>
          <ul style="margin:8px 0 0;padding-left:20px;font-size:0.8125rem;color:var(--text-muted);">
            ${queries.map(q => `<li>${esc(q)}</li>`).join('')}
          </ul>
        </details>
      ` : ''}

      ${ai.lastInput ? `
        <details style="margin-bottom:8px;">
          <summary style="cursor:pointer;font-size:0.875rem;font-weight:600;color:var(--text-secondary);">
            🛠 Input enviado ao agente (debug)
          </summary>
          <pre style="margin-top:8px;padding:12px;background:var(--bg-surface);
            border:1px solid var(--border-subtle);border-radius:6px;font-size:0.75rem;
            overflow-x:auto;white-space:pre-wrap;">${esc(ai.lastInput)}</pre>
        </details>
      ` : ''}
    </div>`;
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
                <span data-embed-stale-${i} style="display:none;margin-left:8px;color:var(--color-warning, #F59E0B);font-weight:600;">
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
        background:var(--bg-soft);border: 1px solid var(--border);border-radius:8px;">
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
      <div style="padding:16px;border: 1px solid var(--border);border-radius:8px;text-align:center;color:var(--text-muted);font-size:0.8125rem;">
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
            background:var(--bg-soft);border: 1px solid var(--border);border-radius:8px;">
            ${r.status === 'approved' && workflowMode === 'system'
              ? 'Nenhuma tarefa gerada ainda. Clique "+ Gerar agora" pra criar as operacionais.'
              : workflowMode === 'offline'
                ? '⚙ Modo offline — sistema não gera tarefas automaticamente.'
                : 'Tarefas serão geradas quando o roteiro for aprovado (em modo "via sistema").'}
          </div>`}
    </div>
  `;
}

/* ── 1: Cliente ──────────────────────────────────────────── */
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
    <h2 class="re-section-title">Cliente e Briefing</h2>
    <p class="re-briefing-intro">Quem é o cliente, viajantes, preferências e restrições. O agente de IA usa este bloco como briefing.</p>
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

    <!-- v4.49.88+ Datas + Destinos absorvidos em "Cliente e Briefing".
         Antes era seção "Viagem" à parte com só 2 campos efetivos. -->
    ${renderTravelBlock()}
  `;
}

/* ── Bloco Datas + Destinos + IA (antes era seção "Viagem") ── */
function renderTravelBlock() {
  const t = currentRoteiro.travel;
  const dests = t.destinations || [];
  const totalNights = dests.reduce((sum, d) => sum + (parseInt(d.nights) || 0), 0);
  const endDate = t.startDate ? addDaysToDate(t.startDate, totalNights) : '';

  // v4.49.86+ Diagn\u00f3stico do que falta pra gerar com IA. Bot\u00e3o sempre
  // vis\u00edvel; quando h\u00e1 campos faltando, hint inline aponta o que.
  const c = currentRoteiro.client || {};
  const missingForAi = [];
  if (!c.name?.trim() && !(currentRoteiro.travelers || []).some(tr => tr.name)) {
    missingForAi.push('cliente/viajantes');
  }
  if (!t.startDate || !t.endDate) missingForAi.push('datas');
  if (!dests.some(d => d.city || d.country)) missingForAi.push('destinos');

  return `
    <h3 class="re-subsection-title" style="margin-top:32px;padding-top:20px;border-top:1px solid var(--border-subtle);font-size:1rem;font-weight:600;color:var(--text-primary);">Datas e Destinos</h3>
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
    <datalist id="re-country-list">
      ${[...new Set(allDestinations.map(d => d.country).filter(Boolean))].sort().map(c => `<option value="${esc(c)}">`).join('')}
    </datalist>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
      <button class="btn btn-ghost btn-sm" data-action="add-dest">+ Adicionar Destino</button>
      <button class="btn btn-ghost btn-sm" data-action="cadastrar-novo-destino">+ Cadastrar destino novo no banco</button>
    </div>

    <div class="re-briefing-ai" style="margin-top:24px;">
      <button class="btn btn-primary" data-action="ai-generate-full">Gerar roteiro com IA</button>
      ${missingForAi.length ? `
        <div class="re-briefing-ai-hint">Falta: ${missingForAi.map(m => esc(m)).join(' \u00b7 ')}</div>
      ` : ''}
    </div>
  `;
}

function renderDestRow(d, i, total) {
  // v4.49.89+ Datalists contextuais separadas:
  //   - re-country-list (global, no fim do bloco) lista todos os países.
  //   - re-city-list-${i} (por linha) lista só cidades do país desta linha.
  // Quando user muda país, handleEditorChange repopula o datalist da cidade.
  const citiesForCountry = d.country
    ? allDestinations.filter(dest => dest.country === d.country)
    : allDestinations;
  const cityOptions = citiesForCountry
    .map(dest => `<option value="${esc(dest.city || '')}">`)
    .join('');

  return `
    <div class="re-dest-row" data-dest-idx="${i}">
      <datalist id="re-city-list-${i}">${cityOptions}</datalist>
      <div class="re-form-group" style="flex:2;">
        <label class="re-label" style="font-size:0.7rem;">País</label>
        <input class="re-input" data-dest="country" list="re-country-list" value="${esc(d.country || '')}" placeholder="País" />
      </div>
      <div class="re-form-group" style="flex:2;">
        <label class="re-label" style="font-size:0.7rem;">Cidade</label>
        <input class="re-input" data-dest="city" list="re-city-list-${i}" value="${esc(d.city || '')}" placeholder="Cidade" />
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
        <p style="font-size:0.8125rem;">Preencha as datas e destinos na se\u00e7\u00e3o Cliente e Briefing e clique em "Gerar dias automaticamente".</p>
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
  const flights = currentRoteiro.flights || [];
  const hotels = currentRoteiro.hotels || [];
  return `
    <h2 class="re-section-title">A\u00e9reo e Hot\u00e9is</h2>

    <h3 class="re-subsection-title" style="font-size:1rem;font-weight:600;color:var(--text-primary);margin-bottom:8px;">Voos</h3>
    <table class="re-dyn-table">
      <thead>
        <tr>
          <th>Cia A\u00e9rea</th><th>Voo</th><th>Origem</th><th>Destino</th>
          <th>Sa\u00edda (data)</th><th>Sa\u00edda (hora)</th>
          <th>Chegada (data)</th><th>Chegada (hora)</th><th></th>
        </tr>
      </thead>
      <tbody id="re-flights-body">
        ${flights.length
          ? flights.map((f, i) => renderFlightRow(f, i)).join('')
          : `<tr><td colspan="9" style="text-align:center;padding:14px;color:var(--text-muted);font-size:0.8125rem;">Nenhum voo cadastrado. Clique "+ Adicionar Voo" para incluir.</td></tr>`}
      </tbody>
    </table>
    <button class="re-add-btn" data-action="add-flight" style="margin-bottom:24px;">+ Adicionar Voo</button>

    <h3 class="re-subsection-title" style="font-size:1rem;font-weight:600;color:var(--text-primary);margin-top:32px;padding-top:20px;border-top:1px solid var(--border-subtle);margin-bottom:8px;">Hot\u00e9is</h3>
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

function renderFlightRow(f, i) {
  return `
    <tr data-flight-idx="${i}">
      <td><input data-flight="airline" value="${esc(f.airline || '')}" placeholder="Ex: LATAM" /></td>
      <td><input data-flight="flightNumber" value="${esc(f.flightNumber || '')}" placeholder="Ex: LA8064" style="width:90px;" /></td>
      <td><input data-flight="originCity" value="${esc(f.originCity || '')}" placeholder="Origem" /></td>
      <td><input data-flight="destinationCity" value="${esc(f.destinationCity || '')}" placeholder="Destino" /></td>
      <td><input data-flight="departureDate" type="date" value="${f.departureDate || ''}" /></td>
      <td><input data-flight="departureTime" type="time" value="${f.departureTime || ''}" style="width:95px;" /></td>
      <td><input data-flight="arrivalDate" type="date" value="${f.arrivalDate || ''}" /></td>
      <td><input data-flight="arrivalTime" type="time" value="${f.arrivalTime || ''}" style="width:95px;" /></td>
      <td><button class="re-remove-btn" data-action="remove-flight" data-idx="${i}">\u2715</button></td>
    </tr>
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
/* v4.49.101+ Valores por categoria (5 blocos: A\u00e9reo / Hot\u00e9is / Traslados /
 * Experi\u00eancias / Servi\u00e7os adicionais). Cada item: descri\u00e7\u00e3o, fornecedor
 * (visibilidade opt-in), valor, notas internas, flag de vis\u00edvel ao cliente.
 * displayMode controla o que o cliente v\u00ea: 'total' (somat\u00f3rio s\u00f3) ou
 * 'grouped' (subtotais por categoria). */
const VALORES_CATEGORIAS = [
  { key: 'aereo',              label: 'A\u00e9reo',                 icon: '\u2708' },
  { key: 'hoteis',             label: 'Hot\u00e9is',                icon: '\ud83c\udfe8' },
  { key: 'traslados',          label: 'Traslados',             icon: '\ud83d\ude90' },
  { key: 'experiencias',       label: 'Experi\u00eancias',          icon: '\u2728' },
  { key: 'servicosAdicionais', label: 'Servi\u00e7os adicionais',   icon: '\u2795' },
];

function _fmtBRL(n, currency) {
  const v = parseFloat(n);
  if (!isFinite(v)) return '\u2014';
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency || 'BRL' }).format(v);
  } catch {
    return `${currency || ''} ${v.toFixed(2)}`;
  }
}

function _subtotalCat(items) {
  return (items || []).reduce((sum, it) => sum + (parseFloat(it.value) || 0), 0);
}

function renderValoresSection() {
  const p = currentRoteiro.pricing || {};
  const s = p.services || {};
  const currency = p.currency || 'BRL';
  const displayMode = s.displayMode === 'grouped' ? 'grouped' : 'total';

  // Totais
  let totalInterno = 0, totalCliente = 0;
  VALORES_CATEGORIAS.forEach(cat => {
    const items = s[cat.key] || [];
    items.forEach(it => {
      const v = parseFloat(it.value) || 0;
      totalInterno += v;
      if (it.visibleToClient !== false) totalCliente += v;
    });
  });

  return `
    <h2 class="re-section-title">Valores</h2>
    <p class="re-briefing-intro">Detalhe os valores por categoria. Marque cada item como vis\u00edvel ou n\u00e3o pro cliente. O export final respeita as escolhas.</p>

    <!-- Configura\u00e7\u00e3o geral -->
    <div class="re-row">
      <div class="re-form-group">
        <label class="re-label">Moeda</label>
        <select class="re-select" data-field="pricing.currency" style="max-width:120px;">
          <option value="BRL" ${currency==='BRL'?'selected':''}>BRL</option>
          <option value="USD" ${currency==='USD'?'selected':''}>USD</option>
          <option value="EUR" ${currency==='EUR'?'selected':''}>EUR</option>
        </select>
      </div>
      <div class="re-form-group">
        <label class="re-label">Validade da proposta</label>
        <input class="re-input" type="date" data-field="pricing.validUntil" value="${p.validUntil || ''}" style="max-width:200px;" />
      </div>
      <div class="re-form-group" style="flex:1;min-width:280px;">
        <label class="re-label">Como o cliente v\u00ea os valores</label>
        <div style="display:flex;gap:6px;align-items:center;">
          <label class="re-pill-radio ${displayMode==='total' ? 'active' : ''}">
            <input type="radio" name="pricing-display-mode" value="total" ${displayMode==='total'?'checked':''} data-svc-field="displayMode" />
            <span>Total \u00fanico</span>
          </label>
          <label class="re-pill-radio ${displayMode==='grouped' ? 'active' : ''}">
            <input type="radio" name="pricing-display-mode" value="grouped" ${displayMode==='grouped'?'checked':''} data-svc-field="displayMode" />
            <span>Subtotais por categoria</span>
          </label>
        </div>
      </div>
    </div>

    <!-- 5 blocos por categoria -->
    ${VALORES_CATEGORIAS.map(cat => _renderValoresCategoria(cat, s[cat.key] || [], currency)).join('')}

    <!-- Observa\u00e7\u00f5es gerais -->
    <div class="re-form-group" style="margin-top:24px;">
      <label class="re-label">Observa\u00e7\u00f5es gerais (internas)</label>
      <textarea class="re-textarea" data-svc-field="notesGeral" rows="2" placeholder="Anota\u00e7\u00f5es operacionais sobre a precifica\u00e7\u00e3o...">${esc(s.notesGeral || '')}</textarea>
    </div>

    <div class="re-form-group">
      <label class="re-label">Disclaimer (aparece no PDF/link p\u00fablico)</label>
      <textarea class="re-textarea" data-field="pricing.disclaimer" rows="2">${esc(p.disclaimer || '')}</textarea>
    </div>

    <!-- Footer: totais comparados -->
    <div class="re-valores-footer">
      <div>
        <span class="re-valores-footer-label">Total interno</span>
        <span class="re-valores-footer-value">${esc(_fmtBRL(totalInterno, currency))}</span>
      </div>
      <div>
        <span class="re-valores-footer-label">Vis\u00edvel ao cliente</span>
        <span class="re-valores-footer-value gold">${esc(_fmtBRL(totalCliente, currency))}</span>
      </div>
      <div class="re-valores-footer-hint">
        ${displayMode === 'total'
          ? '<em>Cliente v\u00ea apenas o total \u00fanico acima.</em>'
          : '<em>Cliente v\u00ea os subtotais por categoria.</em>'}
      </div>
    </div>
  `;
}

function _renderValoresCategoria(cat, items, currency) {
  const subtotal = _subtotalCat(items);
  const visibleCount = items.filter(it => it.visibleToClient !== false).length;
  return `
    <div class="re-valores-cat" data-svc-cat="${cat.key}">
      <div class="re-valores-cat-header">
        <h3 class="re-valores-cat-title">${cat.icon} ${esc(cat.label)}</h3>
        <span class="re-valores-cat-subtotal">${esc(_fmtBRL(subtotal, currency))}
          ${items.length ? `<span class="re-valores-cat-count">${visibleCount}/${items.length} ${items.length === 1 ? 'vis\u00edvel' : 'vis\u00edveis'}</span>` : ''}
        </span>
      </div>
      ${items.length ? `
        <table class="re-dyn-table re-valores-table">
          <thead>
            <tr>
              <th style="width:30%;">Descri\u00e7\u00e3o</th>
              <th style="width:22%;">Fornecedor</th>
              <th style="width:14%;">Valor</th>
              <th style="width:24%;">Notas (internas)</th>
              <th style="width:10%;text-align:center;">Cliente v\u00ea</th>
              <th style="width:36px;"></th>
            </tr>
          </thead>
          <tbody>
            ${items.map((it, i) => `
              <tr data-svc-item="${cat.key}" data-svc-idx="${i}">
                <td><input class="re-input" data-svc="description" value="${esc(it.description || '')}" placeholder="Ex: ${esc(cat.label.toLowerCase())}" /></td>
                <td>
                  <input class="re-input" data-svc="supplier" value="${esc(it.supplier || '')}" placeholder="Fornecedor" style="margin-bottom:4px;" />
                  <label style="display:flex;align-items:center;gap:4px;font-size:0.6875rem;color:var(--text-muted);">
                    <input type="checkbox" data-svc="supplierVisibleToClient" ${it.supplierVisibleToClient ? 'checked' : ''} />
                    cliente v\u00ea
                  </label>
                </td>
                <td><input class="re-input" type="number" step="0.01" data-svc="value" value="${esc(String(it.value ?? ''))}" placeholder="0,00" style="text-align:right;" /></td>
                <td><input class="re-input" data-svc="notes" value="${esc(it.notes || '')}" placeholder="\u2014" /></td>
                <td style="text-align:center;">
                  <input type="checkbox" data-svc="visibleToClient" ${it.visibleToClient !== false ? 'checked' : ''} style="width:16px;height:16px;cursor:pointer;" title="${it.visibleToClient !== false ? 'Cliente v\u00ea este item no detalhamento' : 'Item interno \u2014 cliente N\u00c3O v\u00ea'}" />
                </td>
                <td><button class="re-remove-btn" data-action="remove-svc" data-svc-cat="${cat.key}" data-idx="${i}" title="Remover">\u2715</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      ` : `
        <div class="re-valores-empty">Nenhum item de ${esc(cat.label.toLowerCase())} cadastrado.</div>
      `}
      <button class="re-add-btn" data-action="add-svc" data-svc-cat="${cat.key}" style="margin-top:8px;">+ Adicionar ${esc(cat.label.toLowerCase())}</button>
    </div>
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
        <label class="re-label" style="color:var(--color-danger, #EF4444);font-weight:700;">N\u00e3o Inclui</label>
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

/**
 * v4.62.17 Fase B: popula badges de contagem no botão "📚 Imagens" de cada
 * linha. Filtro lazy match — busca imagens do banco cujo campo city/country/
 * placeName/tags bate com a query gerada pro card (mesma lógica que o picker
 * aplica internamente quando user filtra). Badge só aparece quando count > 0.
 */
function _populateBankCountBadges() {
  const all = _bankImagesCache || [];
  if (!all.length) return;
  const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  document.querySelectorAll('[data-bank-badge-key]').forEach(badge => {
    const btn = badge.closest('button[data-img-q]');
    if (!btn) return;
    const q = norm(btn.dataset.imgQ || '');
    if (!q) return;
    const count = all.filter(img => {
      const hay = norm([img.city, img.country, img.continent, img.name, img.placeName, ...(img.tags||[])].filter(Boolean).join(' '));
      return q.split(/\s+/).filter(Boolean).some(w => hay.includes(w));
    }).length;
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = '';
    }
  });
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

  // v4.62.17 Fase B: triggera pré-fetch do banco em paralelo + popula badges
  // após render (sem bloquear o paint inicial). Quando user clicar "Imagens
  // do Banco", o modal abre instantâneo porque cache já está populado.
  queueMicrotask(() => {
    _ensureBankImages().then(() => _populateBankCountBadges()).catch(() => {});
  });

  // v4.62.17: helper de botão alinhado com sistema (.btn .btn-sm).
  // Badge data-bank-badge-key recebe contagem do banco via _populateBankCountBadges.
  const pickBtn = (imgKey, q) =>
    `<button class="btn btn-secondary btn-sm" data-action="img-pick" data-img-key="${esc(imgKey)}" data-img-q="${esc(q)}"
      style="font-size:0.75rem;display:inline-flex;align-items:center;gap:5px;">
      <span>📚 Imagens</span>
      <span data-bank-badge-key="${esc(imgKey)}" style="display:none;background:var(--brand-gold,#D4A843);color:#0A1628;padding:0 6px;border-radius:999px;font-size:0.65rem;font-weight:700;"></span>
    </button>`;
  const clearBtn = (imgKey) =>
    `<button class="btn btn-ghost btn-sm" data-action="img-clear" data-img-key="${esc(imgKey)}"
      style="font-size:0.75rem;color:var(--color-danger,#EF4444);">Limpar</button>`;

  const heroQ = ((currentRoteiro.travel?.destinations?.[0]?.city || '') + ' ' + (currentRoteiro.travel?.destinations?.[0]?.country || '')).trim();
  const heroRow = `
    <div class="re-img-row" data-img-target="hero">
      <div class="re-img-thumb">
        ${heroOverride
          ? `<img src="${esc(heroOverride)}" alt="hero" />`
          : `<span class="re-img-auto">AUTO</span>`}
      </div>
      <div class="re-img-meta">
        <div class="re-img-name">Capa da Cotação</div>
        <div class="re-img-sub">${heroLabel}</div>
      </div>
      <div class="re-img-actions" style="display:flex;gap:6px;align-items:center;">
        ${pickBtn('hero', heroQ)}
        ${heroOverride ? clearBtn('hero') : ''}
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
        <div class="re-img-actions" style="display:flex;gap:6px;align-items:center;">
          ${pickBtn(ovKey, q)}
          ${url ? clearBtn(ovKey) : ''}
        </div>
      </div>`;
  }).join('') : `<div class="re-img-empty">Nenhuma cidade ainda — adicione destinos na seção Cliente e Briefing.</div>`;

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
        <div class="re-img-actions" style="display:flex;gap:6px;align-items:center;">
          ${pickBtn(ovKey, q)}
          ${url ? clearBtn(ovKey) : ''}
        </div>
      </div>`;
  }).join('') : `<div class="re-img-empty">Nenhum hotel adicionado — vá em Aéreo e Hotéis.</div>`;

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
    // v4.53.1+ Inclui validation/approval/review/rework/cancelled pra não cair em undefined
    // quando linkedTasks chegam em qualquer status novo do workflow de tasks.
    const STATUS_COLORS = {
      not_started: { bg: '#94A3B8', text: 'Não iniciada' },
      in_progress: { bg: '#3B82F6', text: 'Em andamento' },
      review:      { bg: '#A78BFA', text: 'Em revisão' },
      approval:    { bg: '#0EA5E9', text: 'Em aprovação' },
      validation:  { bg: '#EAB308', text: 'Aguardando validação' },
      rework:      { bg: '#F97316', text: 'Retrabalho' },
      done:        { bg: '#10B981', text: 'Concluída' },
      cancelled:   { bg: '#EF4444', text: 'Cancelada' },
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
    listEl.innerHTML = `<div style="padding:16px;text-align:center;color:var(--color-danger, #EF4444);font-size:0.8125rem;">
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
      <strong>Resumo da Cotação:</strong><br/>
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
      <button class="re-add-btn" data-action="export-docx" style="margin-top:0;">Exportar DOCX</button>
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
    if (input.type === 'checkbox') {
      v = input.checked === true;          // v4.49.76+ bugfix: era lendo input.value ("on")
    } else if (input.type === 'number') {
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

  // Flights (v4.49.91+)
  const flightRows = mainContainer.querySelectorAll('[data-flight-idx]');
  if (flightRows.length || mainContainer.querySelector('#re-flights-body')) {
    const flights = [];
    flightRows.forEach(row => {
      flights.push({
        airline:         row.querySelector('[data-flight="airline"]')?.value?.trim() || '',
        flightNumber:    row.querySelector('[data-flight="flightNumber"]')?.value?.trim() || '',
        originCity:      row.querySelector('[data-flight="originCity"]')?.value?.trim() || '',
        destinationCity: row.querySelector('[data-flight="destinationCity"]')?.value?.trim() || '',
        departureDate:   row.querySelector('[data-flight="departureDate"]')?.value || '',
        departureTime:   row.querySelector('[data-flight="departureTime"]')?.value || '',
        arrivalDate:     row.querySelector('[data-flight="arrivalDate"]')?.value || '',
        arrivalTime:     row.querySelector('[data-flight="arrivalTime"]')?.value || '',
      });
    });
    data.flights = flights;
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

  // Pricing custom rows (legado)
  const prows = [];
  mainContainer.querySelectorAll('[data-prow-idx]').forEach(row => {
    prows.push({
      label: row.querySelector('[data-prow="label"]')?.value?.trim() || '',
      value: row.querySelector('[data-prow="value"]')?.value?.trim() || '',
    });
  });
  if (mainContainer.querySelector('#re-pricing-rows')) data.pricing.customRows = prows;

  // v4.49.101+ Pricing services (5 categorias com supplier + visibility)
  const svcRows = mainContainer.querySelectorAll('[data-svc-item]');
  if (svcRows.length || mainContainer.querySelector('[data-svc-cat]')) {
    if (!data.pricing.services) {
      data.pricing.services = {
        aereo: [], hoteis: [], traslados: [], experiencias: [], servicosAdicionais: [],
        displayMode: 'total', notesGeral: '',
      };
    }
    // Reset arrays e re-popula da UI
    ['aereo','hoteis','traslados','experiencias','servicosAdicionais'].forEach(cat => {
      data.pricing.services[cat] = [];
    });
    svcRows.forEach(row => {
      const cat = row.dataset.svcItem;
      if (!data.pricing.services[cat]) return;
      data.pricing.services[cat].push({
        description: row.querySelector('[data-svc="description"]')?.value?.trim() || '',
        supplier:    row.querySelector('[data-svc="supplier"]')?.value?.trim() || '',
        supplierVisibleToClient: !!row.querySelector('[data-svc="supplierVisibleToClient"]')?.checked,
        value:       row.querySelector('[data-svc="value"]')?.value || '',
        notes:       row.querySelector('[data-svc="notes"]')?.value?.trim() || '',
        visibleToClient: !!row.querySelector('[data-svc="visibleToClient"]')?.checked,
      });
    });
    // displayMode + notesGeral via data-svc-field
    const modeRadio = mainContainer.querySelector('[data-svc-field="displayMode"]:checked');
    if (modeRadio) data.pricing.services.displayMode = modeRadio.value === 'grouped' ? 'grouped' : 'total';
    const notesEl = mainContainer.querySelector('[data-svc-field="notesGeral"]');
    if (notesEl) data.pricing.services.notesGeral = notesEl.value || '';
  }

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

/* ─── Status workflow (v4.49.103+) ────────────────────────────
 * Pipeline: draft → review → sent → approved → archived
 * Dropdown no header. Cada transição usa updateRoteiroStatus (audit log
 * built-in). Approved dispara maybeOfferTaskGeneration. */
const STATUS_DEFS = {
  draft:    { label: 'Rascunho',   color: '#6B7280', dot: '#9CA3AF' },
  review:   { label: 'Em revisão', color: '#3B82F6', dot: '#3B82F6' },
  sent:     { label: 'Enviado',    color: '#D4A843', dot: '#D4A843' },
  approved: { label: 'Aprovado',   color: '#10B981', dot: '#10B981' },
  archived: { label: 'Arquivado',  color: '#6B7280', dot: '#9CA3AF' },
};

function _renderStatusDropdown(currentStatus) {
  const cur = STATUS_DEFS[currentStatus] || STATUS_DEFS.draft;
  const targets = ['draft','review','sent','approved','archived'].filter(s => s !== currentStatus);
  return `
    <div class="re-status-dropdown" id="re-status-dropdown">
      <button class="re-status-trigger" type="button" data-action="toggle-status-menu" title="Mudar status do roteiro">
        <span class="re-status-dot" style="background:${cur.dot};"></span>
        <span style="color:${cur.color};font-weight:600;">${esc(cur.label)}</span>
        <span class="re-status-chevron">▾</span>
      </button>
      <div class="re-status-menu" id="re-status-menu" style="display:none;">
        ${targets.map(s => {
          const def = STATUS_DEFS[s];
          return `<button type="button" class="re-status-option" data-action="set-status" data-status="${s}">
            <span class="re-status-dot" style="background:${def.dot};"></span>
            <span>${esc(def.label)}</span>
          </button>`;
        }).join('')}
      </div>
    </div>
  `;
}

/* v4.49.103+ Aplica mudança de status — salva primeiro (pra persistir
 * edições pendentes), depois updateRoteiroStatus (audit log embutido),
 * em seguida re-render do header pra refletir o novo status. Approved
 * dispara maybeOfferTaskGeneration (Sprint 4). */
async function handleStatusChange(newStatus) {
  // Fecha o menu
  const menu = document.getElementById('re-status-menu');
  if (menu) menu.style.display = 'none';

  // v4.57.38 R16: confirm() nativo → modal.confirm (CLAUDE.md §11.k).
  // Confirmações pra estados terminais com UX consistente.
  if (newStatus === 'approved') {
    const { default: modal } = await import('../components/modal.js');
    const ok = await modal.confirm({
      title: 'Marcar roteiro como aprovado?',
      message: 'Isso pode disparar geração automática de tarefas operacionais (reservar voos, confirmar hotéis, transfers, etc.).',
      confirmText: 'Sim, aprovar',
      icon: '✓',
    });
    if (!ok) return;
  }
  if (newStatus === 'archived') {
    const { default: modal } = await import('../components/modal.js');
    const ok = await modal.confirm({
      title: 'Arquivar roteiro?',
      message: 'Ele continua acessível mas sai dos filtros padrão. Você pode restaurar depois.',
      confirmText: 'Arquivar',
      danger: true,
      icon: '🗄',
    });
    if (!ok) return;
  }

  // Salva pending changes antes de mudar status
  if (isDirty) await handleSave({ silent: true });

  const prevStatus = currentRoteiro.status;
  await updateRoteiroStatus(currentRoteiro.id, newStatus);
  currentRoteiro.status = newStatus;
  showToast(`Status alterado: ${STATUS_DEFS[prevStatus]?.label || prevStatus} → ${STATUS_DEFS[newStatus].label}`, 'success');

  // Re-render do header (substitui o status dropdown)
  const dropdownEl = document.getElementById('re-status-dropdown');
  if (dropdownEl) {
    const tmp = document.createElement('div');
    tmp.innerHTML = _renderStatusDropdown(newStatus);
    dropdownEl.replaceWith(tmp.firstElementChild);
  }

  // Trigger pra approved (Sprint 4)
  if (newStatus === 'approved' && prevStatus !== 'approved' && currentRoteiro.workflowMode !== 'offline' && !currentRoteiro.tasksGeneratedAt) {
    maybeOfferTaskGeneration(currentRoteiro.id);
  }
}

/* ─── Save logic ──────────────────────────────────────────── */
// v4.49.103+ Track last successful save pra mostrar "Salvo há X seg"
let lastSaveTs = 0;
let autoSaveRetries = 0;
let saveInProgress = false;

async function handleSave({ silent = false } = {}) {
  if (saveInProgress) return;   // Evita race condition entre auto-save e manual
  saveInProgress = true;
  try {
    const prevStatus = currentRoteiro?.status;
    currentRoteiro = collectFormData();
    const sanitized = sanitizeForSave(currentRoteiro);

    _setAutoSaveStatus('Salvando…');

    // v4.57.36 fix R5: passa timestamp do snapshot atual pra saveRoteiro
    // detectar conflito multi-aba. Captura updatedAt do doc carregado.
    const expectedUpdatedAt = currentRoteiro._loadedAt
      || (currentRoteiro.updatedAt?.toMillis?.() ?? null);
    const newId = await saveRoteiro(currentRoteiro.id || null, sanitized, { expectedUpdatedAt });
    isDirty = false;
    autoSaveRetries = 0;
    lastSaveTs = Date.now();

    currentRoteiro = sanitized;
    currentRoteiro._loadedAt = Date.now();  // atualiza marca após save bem-sucedido

    if (!currentRoteiro.id && newId) {
      currentRoteiro.id = newId;
      const hash = `#roteiro-editor?id=${newId}`;
      history.replaceState(null, '', hash);
    }

    _setAutoSaveStatus('Salvo agora');
    if (!silent) showToast('Roteiro salvo com sucesso!', 'success');

    // 4.43.0+ TRIGGER pra 'approved'
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
    // v4.57.36 fix R5: trata CONFLICT distinto de erro genérico.
    // Auto-save em conflito NÃO retry (recarregar perderia silenciosamente
    // edits do user). Manual save em conflito: pergunta via modal.confirm.
    if (err?.code === 'CONFLICT') {
      _setAutoSaveStatus('Conflito — outro user editou');
      if (silent) {
        console.warn('[auto-save] conflito detectado, pausando auto-save até resolução manual');
        // Não re-agenda retry; user precisa intervir
      } else {
        try {
          const { default: modal } = await import('../components/modal.js');
          const reload = await modal.confirm({
            title: 'Roteiro foi modificado',
            message: 'Outro usuário (ou outra aba) salvou este roteiro depois que você abriu. ' +
                     'Suas mudanças locais ainda não foram salvas.<br><br>' +
                     '<strong>Recarregar agora</strong> descarta suas mudanças e mostra a versão atualizada.<br>' +
                     '<strong>Cancelar</strong> mantém suas mudanças (mas o próximo save vai falhar até recarregar manualmente).',
            confirmText: 'Recarregar (descartar mudanças)',
            danger: true, icon: '⚠',
          });
          if (reload) location.reload();
        } catch (_) {
          // fallback se modal não disponível: alert nativo
          if (confirm('Roteiro foi modificado por outro usuário. Recarregar?')) location.reload();
        }
      }
      throw err;  // propaga pro caller
    }
    autoSaveRetries++;
    _setAutoSaveStatus(`Erro ao salvar${autoSaveRetries > 1 ? ` (tentativa ${autoSaveRetries})` : ''}`);
    if (!silent) showToast('Erro ao salvar: ' + err.message, 'error');
    else console.warn('[auto-save] falhou:', err?.message || err);
    // Re-agenda retry em 10s
    if (autoSaveRetries < 5) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(() => { if (isDirty) handleSave({ silent: true }); }, 10000);
    }
    throw err;
  } finally {
    saveInProgress = false;
  }
}

/** v4.49.103+ Atualiza o indicador "Salvo há X seg" dinamicamente.
 *  Roda a cada 5s pra manter texto atualizado. */
function _setAutoSaveStatus(text) {
  const el = document.getElementById('re-autosave-status');
  if (el) el.textContent = text;
}
// Tick que atualiza "Salvo há X seg" sem requerer save
let _autoSaveTickInterval = null;
function _startAutoSaveTick() {
  if (_autoSaveTickInterval) clearInterval(_autoSaveTickInterval);
  _autoSaveTickInterval = setInterval(() => {
    if (isDirty || !lastSaveTs) return;
    const secs = Math.round((Date.now() - lastSaveTs) / 1000);
    const txt = secs < 5 ? 'Salvo agora'
              : secs < 60 ? `Salvo há ${secs} seg`
              : secs < 3600 ? `Salvo há ${Math.round(secs / 60)} min`
              : 'Salvo há mais de 1h';
    _setAutoSaveStatus(txt);
  }, 5000);
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

  // v4.57.38 R16: confirm() nativo → modal.confirm
  const { default: modal } = await import('../components/modal.js');
  const userConfirmed = await modal.confirm({
    title: '🎉 Roteiro aprovado!',
    message: `Quer gerar <strong>${estimated} tarefas operacionais</strong> agora?<br><br>` +
             `<small style="color:var(--text-secondary);">reservar voos · confirmar ${hotels} hotel(éis) · ` +
             `transfers · seguro · materiais · vouchers</small><br><br>` +
             `As datas vão ser calculadas automaticamente a partir do início da viagem.`,
    confirmText: `Gerar ${estimated} tarefas`,
    cancelText: 'Agora não',
    icon: '✓',
  });
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
      if (activeSection === 11) rerenderCurrentSection();
    } catch (_) { /* non-blocking */ }
  } catch (err) {
    showToast('Erro ao gerar tarefas: ' + err.message, 'error');
  }
}

/**
 * v4.49.106+ Detecta se roteiro novo está "efetivamente vazio".
 * Usado pelo handler 'back' pra evitar confirm desnecessário quando user
 * tenta sair de roteiro novo intocado.
 */
function _isRoteiroEffectivelyEmpty(r) {
  if (!r) return true;
  const hasClient = (r.client?.name || r.client?.email || r.client?.phone || r.client?.notes || '').trim();
  const hasTravelers = (r.travelers || []).some(t => t?.name?.trim());
  const hasDests = (r.travel?.destinations || []).some(d => d?.city || d?.country);
  const hasFlights = (r.flights || []).some(f => f?.airline || f?.flightNumber || f?.originCity);
  const hasHotels = (r.hotels || []).some(h => h?.hotelName || h?.city);
  const hasDays = (r.days || []).some(d => d?.title || d?.narrative);
  const hasTitle = (r.title || '').trim();
  const hasDates = (r.travel?.startDate || r.travel?.endDate);
  return !hasClient && !hasTravelers && !hasDests && !hasFlights && !hasHotels && !hasDays && !hasTitle && !hasDates;
}

/* ─── Mark dirty & auto-save ──────────────────────────────── */
function markDirty() {
  // v4.49.103+ Auto-save em 5s (era 30s) + retry silent em erro
  // v4.49.106+ Pula auto-save quando roteiro novo está vazio (não há
  // dado a salvar; evita retry chain inútil que pode parecer "loop").
  isDirty = true;
  if (!currentRoteiro?.id && _isRoteiroEffectivelyEmpty(collectFormData())) {
    _setAutoSaveStatus('Nova cotação');
    return;
  }
  _setAutoSaveStatus('Alterações não salvas');
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    if (isDirty && !saveInProgress) handleSave({ silent: true }).catch(() => {/* loga em handleSave */});
  }, 5000);
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
  // após render da seção Avançado (11 pós v4.49.88). Não-bloqueante.
  if (index === 11 && Array.isArray(currentRoteiro?.linkedTaskIds) && currentRoteiro.linkedTaskIds.length) {
    queueMicrotask(() => populateLinkedTasksList(currentRoteiro.linkedTaskIds));
  }
  // v4.49.93+ Imagens (9) — resolve thumbs automáticas via enrichRoteiroImages.
  if (index === 9) queueMicrotask(() => populateAutoImagePreviews());
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
  if (activeSection === 11 && Array.isArray(currentRoteiro?.linkedTaskIds) && currentRoteiro.linkedTaskIds.length) {
    queueMicrotask(() => populateLinkedTasksList(currentRoteiro.linkedTaskIds));
  }
  // v4.49.93+ Imagens: preview do que o sistema vai colocar automaticamente.
  if (activeSection === 9) queueMicrotask(() => populateAutoImagePreviews());
}

/**
 * v4.49.93+ Resolve imagens automáticas e preenche thumbs (banco → Unsplash).
 * Sem override manual, mostra preview do que será usado no PDF/link.
 */
/**
 * v4.49.93+ Auto-attach dicas do Portal de Dicas pra um país.
 * Debounced — espera 1.5s sem mudança antes de disparar. Skip se país
 * já tem dica anexada. Toast leve só quando adiciona.
 */
let _autoTipsDebounceTimer = null;
const _autoTipsAttempted = new Set(); // dedup por país já tentado nesta sessão
function scheduleAutoAttachTipsForCountry(country) {
  if (!country || country.length < 3) return;
  clearTimeout(_autoTipsDebounceTimer);
  _autoTipsDebounceTimer = setTimeout(() => autoAttachTipsForCountry(country), 1500);
}
async function autoAttachTipsForCountry(country) {
  if (!country) return;
  if (_autoTipsAttempted.has(country)) return;
  _autoTipsAttempted.add(country);
  try {
    const [{ fetchTips }, { snapshotTipForEmbed }] = await Promise.all([
      import('../services/portal.js'),
      import('../services/roteiros.js'),
    ]);
    const tips = await fetchTips({ country });
    if (!tips.length) return;
    if (!Array.isArray(currentRoteiro.embeddedTips)) currentRoteiro.embeddedTips = [];
    const already = new Set(currentRoteiro.embeddedTips.map(e => e.tipId).filter(Boolean));
    const toAttach = tips.filter(t => !already.has(t.id));
    if (!toAttach.length) return;
    let added = 0;
    for (const t of toAttach) {
      try {
        const snapshot = await snapshotTipForEmbed(t.id);
        currentRoteiro.embeddedTips.push(snapshot);
        added++;
      } catch (_) { /* skip falhas pontuais */ }
    }
    if (added) {
      markDirty();
      showToast(`${added} dica${added>1?'s':''} de ${country} anexada${added>1?'s':''} automaticamente.`, 'success');
    }
  } catch (e) {
    console.warn('[roteiroEditor] autoAttachTipsForCountry falhou:', e?.message || e);
  }
}

async function populateAutoImagePreviews() {
  try {
    const { enrichRoteiroImages } = await import('../services/roteiroGenerator.js');
    const enriched = await enrichRoteiroImages(currentRoteiro);
    if (!enriched) return;

    // Hero
    if (enriched.heroUrl) {
      _swapImgThumb('hero', enriched.heroUrl, 'Auto (banco → Unsplash)');
    }
    // Cidades — chave do override é `city_${normKey}` (igual ao map enriched.byCity)
    if (enriched.byCity) {
      Object.entries(enriched.byCity).forEach(([cityKey, url]) => {
        if (url) _swapImgThumb(`city_${cityKey}`, url, 'Auto (banco → Unsplash)');
      });
    }
    // Hotéis — chave do override é `hotel_${idx}`
    if (enriched.byHotel) {
      Object.entries(enriched.byHotel).forEach(([idx, url]) => {
        if (url) _swapImgThumb(`hotel_${idx}`, url, 'Auto (banco → Unsplash)');
      });
    }
  } catch (e) {
    console.warn('[roteiroEditor] populateAutoImagePreviews falhou:', e?.message || e);
  }
}

function _swapImgThumb(imgKey, url, label) {
  const row = document.querySelector(`[data-img-target="${imgKey}"]`);
  if (!row) return;
  const thumb = row.querySelector('.re-img-thumb');
  const sub = row.querySelector('.re-img-sub');
  if (thumb && !thumb.querySelector('img')) {
    thumb.innerHTML = `<img src="${url}" alt="${imgKey}" />`;
  }
  if (sub && label) sub.textContent = label;
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
// 4.43.0+ Sprint 4 — async porque alguns handlers (generate-tasks) usam await.
async function handleEditorClick(e) {
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

    /* ── Status dropdown (v4.49.103+) ──────────────────────── */
    case 'toggle-status-menu': {
      const menu = document.getElementById('re-status-menu');
      if (menu) menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
      break;
    }

    case 'set-status': {
      const newStatus = target.dataset.status;
      if (!newStatus || !STATUS_DEFS[newStatus]) break;
      if (!currentRoteiro.id) {
        showToast('Salve o roteiro pelo menos uma vez antes de mudar status.', 'warning');
        break;
      }
      handleStatusChange(newStatus).catch(err => {
        showToast('Erro ao mudar status: ' + (err?.message || err), 'error');
      });
      break;
    }

    case 'back': {
      // v4.49.106+ Defesa: roteiro NOVO (sem ID) com conte\u00fado vazio sai sem
      // confirm, mesmo se isDirty foi marcado (focus/blur incidental). User
      // reportou loop/popup chato saindo de roteiro novo intocado.
      const isNewAndEmpty = !currentRoteiro?.id && _isRoteiroEffectivelyEmpty(currentRoteiro);
      if (isDirty && !isNewAndEmpty) {
        if (confirm('Voc\u00ea tem altera\u00e7\u00f5es n\u00e3o salvas. Deseja sair sem salvar?')) {
          isDirty = false;
          location.hash = '#roteiros';
        }
      } else {
        isDirty = false;
        location.hash = '#roteiros';
      }
      break;
    }

    /* ── Destinations ─────────────────────────────────────── */
    // v4.49.87+ Os 4 handlers usavam switchSection(1) — que re-coleta o DOM
    // ANTES do re-render, sobrescrevendo o push/splice/swap in-memory. Bug
    // pré-existente. Trocado por rerenderCurrentSection() (comentado no
    // próprio código desde sempre).
    case 'add-dest':
      currentRoteiro = collectFormData();
      currentRoteiro.travel.destinations.push({ city: '', country: '', nights: 1 });
      rerenderCurrentSection();
      markDirty();
      break;

    case 'remove-dest':
      currentRoteiro = collectFormData();
      currentRoteiro.travel.destinations.splice(idx, 1);
      rerenderCurrentSection();
      markDirty();
      break;

    case 'move-dest-up':
      currentRoteiro = collectFormData();
      if (idx > 0) {
        const dArr = currentRoteiro.travel.destinations;
        [dArr[idx - 1], dArr[idx]] = [dArr[idx], dArr[idx - 1]];
      }
      rerenderCurrentSection();
      markDirty();
      break;

    case 'move-dest-down':
      currentRoteiro = collectFormData();
      const destsDown = currentRoteiro.travel.destinations;
      if (idx < destsDown.length - 1) {
        [destsDown[idx], destsDown[idx + 1]] = [destsDown[idx + 1], destsDown[idx]];
      }
      rerenderCurrentSection();
      markDirty();
      break;

    /* ── Days ─────────────────────────────────────────────── */
    case 'generate-days':
      currentRoteiro = collectFormData();
      generateDaysFromTravel();
      rerenderCurrentSection();
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
      rerenderCurrentSection();
      markDirty();
      break;
    }

    case 'remove-day':
      currentRoteiro = collectFormData();
      currentRoteiro.days.splice(idx, 1);
      currentRoteiro.days.forEach((d, i) => d.dayNumber = i + 1);
      rerenderCurrentSection();
      markDirty();
      break;

    case 'ai-day':
      showToast('Gera\u00e7\u00e3o por dia: use "\u2728 Gerar com IA" no topo pra gerar o roteiro completo.', 'info');
      break;

    case 'ai-generate-full': {
      // v4.49.74+ Dispara o agente roteiros-luxo-gen
      currentRoteiro = collectFormData();
      await aiGenerateFullRoteiro();
      break;
    }

    // v4.49.86+ Handlers go-briefing/add-brief-dest/remove-brief-dest
    // removidos — Briefing fundido com Cliente; destinos editados na
    // Seção Viagem via add-dest/remove-dest existentes.

    case 'cadastrar-novo-destino': {
      // v4.49.75+ Abre modal pra cadastrar destino no banco compartilhado
      // (portal_destinations) — mesma collection usada pelo Portal de Dicas
      // e Banco de Imagens.
      // v4.49.85+ Pré-popula com a última linha de destino que tenha dado —
      // antes abria sempre vazio, mesmo se user já tinha digitado país/cidade.
      currentRoteiro = collectFormData();
      const dests = currentRoteiro.travel?.destinations || [];
      const prefill = [...dests].reverse().find(d => d.city || d.country) || {};
      openCadastrarDestinoModal({
        city: prefill.city || '',
        country: prefill.country || '',
      });
      break;
    }

    case 'add-activity': {
      const dayIdx = parseInt(target.dataset.day);
      currentRoteiro = collectFormData();
      if (!currentRoteiro.days[dayIdx]) break;
      if (!currentRoteiro.days[dayIdx].activities) currentRoteiro.days[dayIdx].activities = [];
      currentRoteiro.days[dayIdx].activities.push({ time: '', description: '', type: 'passeio' });
      rerenderCurrentSection();
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
      rerenderCurrentSection();
      markDirty();
      break;
    }

    /* ── Flights (v4.49.91+) ──────────────────────────────── */
    case 'add-flight':
      currentRoteiro = collectFormData();
      if (!Array.isArray(currentRoteiro.flights)) currentRoteiro.flights = [];
      currentRoteiro.flights.push({
        airline: '', flightNumber: '',
        originCity: '', destinationCity: '',
        departureDate: '', departureTime: '',
        arrivalDate: '', arrivalTime: '',
      });
      rerenderCurrentSection();
      markDirty();
      break;

    case 'remove-flight':
      currentRoteiro = collectFormData();
      (currentRoteiro.flights || []).splice(idx, 1);
      rerenderCurrentSection();
      markDirty();
      break;

    /* ── Hotels ───────────────────────────────────────────── */
    // v4.49.91+ trocado switchSection(2) por rerenderCurrentSection()
    // (mesmo bug do add-dest pré-v4.49.87 — collectFormData re-coleta
    // o DOM antigo e sobrescreve o push/splice).
    case 'add-hotel':
      currentRoteiro = collectFormData();
      currentRoteiro.hotels.push({ city: '', hotelName: '', roomType: '', regime: '', checkIn: '', checkOut: '', nights: 0 });
      rerenderCurrentSection();
      markDirty();
      break;

    case 'remove-hotel':
      currentRoteiro = collectFormData();
      currentRoteiro.hotels.splice(idx, 1);
      rerenderCurrentSection();
      markDirty();
      break;

    /* ── Pricing rows (legado v4.49.100-, mantido pra retrocompat) ── */
    case 'add-prow':
      currentRoteiro = collectFormData();
      currentRoteiro.pricing.customRows.push({ label: '', value: '' });
      rerenderCurrentSection();
      markDirty();
      break;

    case 'remove-prow':
      currentRoteiro = collectFormData();
      currentRoteiro.pricing.customRows.splice(idx, 1);
      rerenderCurrentSection();
      markDirty();
      break;

    /* ── Pricing services (v4.49.101+ novo schema por categoria) ── */
    case 'add-svc': {
      currentRoteiro = collectFormData();
      const cat = target.dataset.svcCat;
      if (!cat || !currentRoteiro.pricing?.services?.[cat]) break;
      currentRoteiro.pricing.services[cat].push({
        description: '', supplier: '', supplierVisibleToClient: false,
        value: '', notes: '', visibleToClient: true,
      });
      rerenderCurrentSection();
      markDirty();
      break;
    }

    case 'remove-svc': {
      currentRoteiro = collectFormData();
      const cat = target.dataset.svcCat;
      if (!cat || !Array.isArray(currentRoteiro.pricing?.services?.[cat])) break;
      currentRoteiro.pricing.services[cat].splice(idx, 1);
      rerenderCurrentSection();
      markDirty();
      break;
    }

    /* ── Optionals ────────────────────────────────────────── */
    case 'add-opt':
      currentRoteiro = collectFormData();
      currentRoteiro.optionals.push({ service: '', priceAdult: null, priceChild: null, notes: '' });
      rerenderCurrentSection();
      markDirty();
      break;

    case 'remove-opt':
      currentRoteiro = collectFormData();
      currentRoteiro.optionals.splice(idx, 1);
      rerenderCurrentSection();
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
      rerenderCurrentSection();
      markDirty();
      break;

    case 'remove-inc':
      currentRoteiro = collectFormData();
      currentRoteiro.includes.splice(idx, 1);
      rerenderCurrentSection();
      markDirty();
      break;

    case 'add-exc':
      currentRoteiro = collectFormData();
      currentRoteiro.excludes.push('');
      rerenderCurrentSection();
      markDirty();
      break;

    case 'remove-exc':
      currentRoteiro = collectFormData();
      currentRoteiro.excludes.splice(idx, 1);
      rerenderCurrentSection();
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
      rerenderCurrentSection();
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
      rerenderCurrentSection();
      markDirty();
      showToast('Itens padr\u00e3o adicionados (N\u00e3o Inclui).', 'success');
      break;
    }

    /* ── Cancellation ─────────────────────────────────────── */
    case 'add-canc':
      currentRoteiro = collectFormData();
      currentRoteiro.cancellation.push({ period: '', penalty: '' });
      rerenderCurrentSection();
      markDirty();
      break;

    case 'remove-canc':
      currentRoteiro = collectFormData();
      currentRoteiro.cancellation.splice(idx, 1);
      rerenderCurrentSection();
      markDirty();
      break;

    case 'preset-canc':
      currentRoteiro = collectFormData();
      CANCELLATION_PRESETS.forEach(p => {
        const exists = currentRoteiro.cancellation.some(c => c.period === p.period);
        if (!exists) currentRoteiro.cancellation.push({ ...p });
      });
      rerenderCurrentSection();
      markDirty();
      showToast('Pol\u00edtica de cancelamento padr\u00e3o adicionada.', 'success');
      break;

    /* ── Important Info custom fields ─────────────────────── */
    case 'add-infoc':
      currentRoteiro = collectFormData();
      currentRoteiro.importantInfo.customFields.push({ label: '', value: '' });
      rerenderCurrentSection();
      markDirty();
      break;

    case 'remove-infoc':
      currentRoteiro = collectFormData();
      currentRoteiro.importantInfo.customFields.splice(idx, 1);
      rerenderCurrentSection();
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
      rerenderCurrentSection();
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
          switchSection(12); // Preview & Export
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

    case 'export-docx': {
      // 4.46.0+ (Sprint 5 Phase 3)
      if (!(currentRoteiro?.days || []).length) {
        showToast('Adicione pelo menos um dia antes de exportar.', 'warning');
        break;
      }
      {
        const areaId = document.getElementById('re-area-select')?.value || currentRoteiro.areaId || '';
        if (!areaId) {
          showToast('Selecione uma Área (BU) antes de exportar.', 'warning');
          switchSection(12);
          break;
        }
        (async () => {
          try {
            if (isDirty || !currentRoteiro.id) await handleSave();
            const { generateRoteiro } = await import('../services/roteiroGenerator.js');
            await generateRoteiro({ roteiro: currentRoteiro, areaId, format: 'docx' });
            showToast('DOCX gerado!', 'success');
          } catch (err) {
            showToast('Erro ao gerar DOCX: ' + err.message, 'error');
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
          switchSection(12);
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
          onForceLink:  async () => {
            // 4.45.0+ (Sprint 5 Phase 4) \u2014 bank guard chose link mesmo c/ aviso
            await doGenerateWebLink();
          },
        });
        break;
      }
      // 4.45.0+ (Sprint 5 Phase 4) \u2014 link web ativado (era "em breve")
      await doGenerateWebLink();
      break;
    }
  }
}

/**
 * 4.45.0+ (Sprint 5 Phase 4) \u2014 Gera link web p\u00fablico + modal de
 * compartilhamento. Mesma UX do Portal de Dicas (URL + Abrir + Copiar +
 * Fechar). Internals (custo, workflowMode, linkedTasks) J\u00c1 s\u00e3o stripados
 * em createWebLink (via stripInternalForPublicLink) \u2014 Sprint 2/4 hardening.
 */
async function doGenerateWebLink() {
  if (!currentRoteiro?.id || isDirty) {
    await handleSave();
    if (!currentRoteiro?.id) {
      showToast('Salve o roteiro antes de gerar o link.', 'warning');
      return;
    }
  }

  if (!(currentRoteiro?.days || []).length) {
    showToast('Adicione pelo menos um dia antes de gerar o link.', 'warning');
    return;
  }

  const areaId = document.getElementById('re-area-select')?.value || currentRoteiro.areaId || '';
  if (!areaId) {
    showToast('Selecione uma \u00c1rea (BU) antes de gerar o link.', 'warning');
    switchSection(12);
    return;
  }

  showToast('Gerando link p\u00fablico...', 'info');
  try {
    // Resolve area pra branding (logo + cores) embedados no snapshot
    let area = null;
    if (areaId && Array.isArray(allAreas)) {
      area = allAreas.find(a => a.id === areaId) || null;
    }
    // createWebLink j\u00e1 aplica stripInternalForPublicLink (Sprint 2)
    const token = await createWebLink(currentRoteiro.id, currentRoteiro, area);
    const baseUrl = `${location.protocol}//${location.host}${location.pathname.replace(/\/[^/]*$/, '/')}`;
    const fullUrl = `${baseUrl}roteiro-view.html#${token}`;

    // Modal estilo Portal \u2014 URL + Abrir + Copiar + Fechar
    const modal = document.createElement('div');
    modal.id = 're-link-modal';
    modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:2100;
      display:flex;align-items:center;justify-content:center;padding:20px;`;
    modal.innerHTML = `
      <div style="background:var(--bg-card);max-width:520px;width:100%;padding:32px;
        border-radius:12px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.3);">
        <div style="font-size:2.5rem;margin-bottom:12px;">\ud83d\udd17</div>
        <h2 style="font-size:1.25rem;margin:0 0 6px;font-weight:600;">Link gerado com sucesso!</h2>
        <p style="font-size:0.875rem;color:var(--text-muted);margin:0 0 18px;line-height:1.5;">
          Compartilhe com o cliente. Internals do roteiro (custo, workflow, tarefas
          operacionais) J\u00c1 foram removidos do snapshot p\u00fablico.
        </p>
        <input type="text" value="${esc(fullUrl)}" readonly
          style="width:100%;padding:10px 12px;background:var(--bg-soft);
            border:1px solid var(--border);border-radius:6px;font-size:0.8125rem;
            font-family:monospace;margin-bottom:16px;" onclick="this.select()" />
        <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
          <a href="${esc(fullUrl)}" target="_blank" rel="noopener" class="re-add-btn"
            style="margin:0;text-decoration:none;display:inline-block;">\u2197 Abrir link</a>
          <button class="re-add-btn" id="re-link-copy" style="margin:0;
            background:var(--bg-soft);color:var(--text-primary);">\ud83d\udccb Copiar</button>
          <button class="re-add-btn" id="re-link-close" style="margin:0;
            background:transparent;color:var(--text-muted);border:1px solid var(--border);">Fechar</button>
        </div>
        <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border);
          font-size:0.7rem;color:var(--text-muted);">
          Token: <code style="background:var(--bg-soft);padding:1px 6px;border-radius:3px;">${esc(token)}</code>
          \u00b7 Roteiro: ${esc(currentRoteiro.title || 'Sem t\u00edtulo')}
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#re-link-copy').addEventListener('click', async (e) => {
      try {
        await navigator.clipboard.writeText(fullUrl);
        e.target.textContent = '\u2713 Copiado!';
        setTimeout(() => { e.target.textContent = '\ud83d\udccb Copiar'; }, 2000);
      } catch (_) {
        // Fallback se clipboard bloqueado
        modal.querySelector('input').select();
        document.execCommand('copy');
        e.target.textContent = '\u2713 Copiado!';
      }
    });
    modal.querySelector('#re-link-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    showToast('Link p\u00fablico gerado!', 'success');
  } catch (err) {
    console.error('[Roteiro] Erro ao gerar link web:', err);
    showToast('Erro ao gerar link: ' + (err.message || err), 'error');
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

  // v4.49.102+ Recalc Valores em tempo real (subtotais por categoria + footer)
  // ao mudar valor / visibilidade / displayMode / moeda. Sem rerender — preserva
  // foco do input. Listener escuta input + change events.
  if (target.dataset.svc || target.dataset.svcField || target.dataset.field === 'pricing.currency') {
    recalcValoresTotals();
  }

  // v4.49.89+ Country changed → repopulate this row's city datalist with
  // cities for the new country. Avoids re-rendering (preserves focus).
  if (target.dataset.dest === 'country') {
    const row = target.closest('[data-dest-idx]');
    if (row) {
      const idx = row.dataset.destIdx;
      const dl = document.getElementById(`re-city-list-${idx}`);
      if (dl) {
        const country = target.value.trim();
        const cities = country
          ? allDestinations.filter(d => d.country === country)
          : allDestinations;
        dl.innerHTML = cities.map(d => `<option value="${esc(d.city || '')}">`).join('');
      }
    }
    // v4.49.93+ Auto-attach dicas do Portal pra esse país (debounced 1.5s).
    if (e.type === 'change' || e.type === 'input') {
      scheduleAutoAttachTipsForCountry(target.value.trim());
    }
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

/**
 * v4.49.102+ Recalcula subtotais por categoria + footer (total interno x
 * visível ao cliente) sem rerender — preserva foco no input que o user
 * está editando.
 */
function recalcValoresTotals() {
  const root = document.getElementById('re-content-area');
  if (!root) return;
  const currencyEl = root.querySelector('[data-field="pricing.currency"]');
  const currency = currencyEl?.value || 'BRL';

  let totalInterno = 0, totalCliente = 0;
  ['aereo','hoteis','traslados','experiencias','servicosAdicionais'].forEach(cat => {
    const rows = root.querySelectorAll(`[data-svc-item="${cat}"]`);
    let subtotal = 0, visibleCount = 0;
    rows.forEach(row => {
      const value = parseFloat(row.querySelector('[data-svc="value"]')?.value) || 0;
      const visible = !!row.querySelector('[data-svc="visibleToClient"]')?.checked;
      subtotal += value;
      if (visible) {
        visibleCount++;
        totalCliente += value;
      }
    });
    totalInterno += subtotal;
    // Atualiza header da categoria: "R$ X,XX  N/M visível(eis)"
    const catEl = root.querySelector(`[data-svc-cat="${cat}"] .re-valores-cat-subtotal`);
    if (catEl) {
      catEl.innerHTML = `${esc(_fmtBRL(subtotal, currency))}${
        rows.length ? `<span class="re-valores-cat-count">${visibleCount}/${rows.length} ${rows.length === 1 ? 'visível' : 'visíveis'}</span>` : ''
      }`;
    }
  });
  // Footer
  const valEls = root.querySelectorAll('.re-valores-footer-value');
  if (valEls[0]) valEls[0].textContent = _fmtBRL(totalInterno, currency);
  if (valEls[1]) valEls[1].textContent = _fmtBRL(totalCliente, currency);
  // Hint dinâmica (depende do displayMode)
  const modeRadio = root.querySelector('[data-svc-field="displayMode"]:checked');
  const mode = modeRadio?.value === 'grouped' ? 'grouped' : 'total';
  const hintEl = root.querySelector('.re-valores-footer-hint');
  if (hintEl) {
    hintEl.innerHTML = mode === 'total'
      ? '<em>Cliente vê apenas o total único acima.</em>'
      : '<em>Cliente vê os subtotais por categoria.</em>';
  }
  // Pill-radio visual: classe active no <label> wrapper
  root.querySelectorAll('.re-pill-radio').forEach(lbl => {
    const radio = lbl.querySelector('input[type="radio"]');
    lbl.classList.toggle('active', !!radio?.checked);
  });
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
      // v4.57.36 R5: marca momento do load pra conflict detection no save
      currentRoteiro._loadedAt = roteiroData.updatedAt?.toMillis?.() ?? Date.now();
    } else if (aiData) {
      // Roteiro gerado pela IA
      currentRoteiro = aiData;
      currentRoteiro.status = 'draft';
      // v4.49.95+ bugfix: era store.get('user') (key inexistente) → consultantId
      // ficava string vazia → Firestore rule "create exige consultantId==auth.uid"
      // rejeitava com permission-denied. Key correto: 'currentUser'.
      currentRoteiro.consultantId = store.get('currentUser')?.uid || '';
      currentRoteiro.consultantName = store.get('currentUser')?.displayName || store.get('currentUser')?.name || '';
    } else {
      currentRoteiro = {
        status: 'draft',
        title: '',
        areaId: '',
        consultantId: store.get('currentUser')?.uid || '',
        consultantName: store.get('currentUser')?.displayName || store.get('currentUser')?.name || '',
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
        // v4.49.86+ bloco "briefing" removido — usar client.preferences/
        // restrictions/economicProfile/notes que já existem no schema.
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
    // v4.49.86+ bloco "briefing" removido — campos migrados pra client.*

    const isAiGenerated = currentRoteiro.aiGenerated === true;
    // v4.62.16: renomeado "Roteiro" → "Cotação" (sidebar e módulo passaram a se
    // chamar Gerador de Cotações). Schema, route e código preservam "roteiro".
    const pageTitle = roteiroId ? 'Editar Cotação' : (isAiGenerated ? 'Cotação Gerada por IA' : 'Nova Cotação');
    const statusLabel = currentRoteiro.status || 'draft';

    // v4.57.35 fix integração R14: safety-net pra estado "approved mas tasks
    // não geradas". Pode acontecer se: (a) user aprovou + page crashou antes do
    // generateOperationalTasksForRoteiro completar; (b) user aprovou em offline
    // mode + voltou online; (c) admin restaurou roteiro de archived. Sem isso,
    // tasks ficavam permanentemente não geradas. Ao abrir, oferece geração.
    // Delay pra não competir com render inicial + só se for owner editor.
    if (roteiroId && currentRoteiro.status === 'approved'
        && !currentRoteiro.tasksGeneratedAt
        && currentRoteiro.workflowMode !== 'offline') {
      setTimeout(() => {
        try { maybeOfferTaskGeneration(roteiroId); } catch (_) { /* non-blocking */ }
      }, 1500);
    }

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
            <div style="font-size:0.875rem;font-weight:600;color:var(--color-warning, #F59E0B);margin-bottom:4px;">
              Cota\u00e7\u00e3o gerada por Intelig\u00eancia Artificial
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
        <div class="page-header" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;">
          <button class="btn btn-ghost btn-sm" data-action="back">\u2190 Voltar</button>
          <h1 class="page-title" style="margin:0;font-size:1.25rem;font-weight:700;">${esc(pageTitle)}</h1>
          ${_renderStatusDropdown(statusLabel)}
          <span id="re-autosave-status" style="font-size:0.75rem;color:var(--text-muted);">${roteiroId ? '' : (isAiGenerated ? 'Gerado por IA — n\u00e3o salvo' : 'Nova cotação')}</span>
          <button class="btn btn-primary btn-sm" data-action="save">Salvar</button>
        </div>

        <!-- Two-column layout -->
        <div class="re-layout">
          <!-- Sidebar nav — v4.62.16 filtra sections hidden (Avançado) -->
          <div class="re-sidebar" id="re-sidebar-nav">
            ${SECTIONS.map((s, i) => s.hidden ? '' : `
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

    // v4.49.100+ Suporte a navegação direta pra Preview & Export
    // (vindo do ícone de ação na listagem). Atalho `&section=preview`.
    const sectionParam = location.hash.match(/[?&]section=([^&]+)/)?.[1];
    if (sectionParam === 'preview') {
      activeSection = 12; // Preview & Export (pós-v4.49.88 renumeração)
      // Disparar switchSection pós-render pra ativar nav state + render correto
      queueMicrotask(() => switchSection(12));
    } else {
      activeSection = 0;
    }
    isDirty = false;
    // v4.49.103+ start auto-save status tick (updates "Salvo há X seg")
    lastSaveTs = Date.now();
    _startAutoSaveTick();

    // v4.49.103+ Click-outside fecha o menu de status
    const closeStatusOnOutside = (e) => {
      const dd = document.getElementById('re-status-dropdown');
      const menu = document.getElementById('re-status-menu');
      if (!dd || !menu || menu.style.display === 'none') return;
      if (!dd.contains(e.target)) menu.style.display = 'none';
    };
    document.addEventListener('click', closeStatusOnOutside);
    container._closeStatusOnOutside = closeStatusOnOutside;

  } catch (err) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--text-muted);">
        <p style="font-size:1.1rem;font-weight:600;">Erro ao carregar</p>
        <p>${esc(err.message)}</p>
        <button class="re-add-btn" onclick="location.hash='#roteiros'" style="margin-top:16px;">Voltar</button>
      </div>`;
  }
}

/* ─── v4.49.75+ Modal: Cadastrar destino novo ───────────────
 *
 * Reaproveita a collection portal_destinations (mesma fonte usada
 * por Portal de Dicas e Banco de Imagens). Após cadastrar, re-fetch
 * de allDestinations e re-render do Briefing pra mostrar a opção
 * nova já no datalist.
 * ──────────────────────────────────────────────────────────── */
function openCadastrarDestinoModal(prefill = {}) {
  // v4.49.85+ aceita { city, country, continent } pra pré-popular
  // os campos do modal — antes abria sempre vazio.
  const _city = prefill.city || '';
  const _country = prefill.country || '';
  const _continent = prefill.continent || '';
  // Tenta inferir continente automaticamente se o país já existe no banco
  let inferredContinent = _continent;
  if (!inferredContinent && _country) {
    const match = (allDestinations || []).find(d => d.country === _country);
    if (match?.continent) inferredContinent = match.continent;
  }
  const modal = document.createElement('div');
  modal.dataset.cadDestModal = '1';
  modal.style.cssText = `
    position:fixed;inset:0;z-index:10200;background:rgba(0,0,0,0.65);
    display:flex;align-items:center;justify-content:center;padding:20px;
  `;
  modal.innerHTML = `
    <div style="background:var(--bg-elevated);border:1px solid var(--border-subtle);
      border-radius:12px;padding:24px;max-width:480px;width:100%;
      box-shadow:0 12px 40px rgba(0,0,0,0.4);">
      <h3 style="margin:0 0 6px;font-size:1.0625rem;">Cadastrar novo destino</h3>
      <p style="margin:0 0 18px;font-size:0.8125rem;color:var(--text-muted);">
        Este destino ficará disponível em TODOS os módulos (Roteiros, Portal de Dicas, Banco de Imagens).
      </p>
      <div style="display:flex;flex-direction:column;gap:12px;">
        <label style="display:flex;flex-direction:column;gap:4px;font-size:0.8125rem;color:var(--text-secondary);">
          Continente
          <select id="cad-dest-cont" style="padding:8px 10px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:6px;color:var(--text-primary);">
            <option value="">— selecione —</option>
            ${(CONTINENTS || []).map(c => `<option value="${esc(c)}" ${c === inferredContinent ? 'selected' : ''}>${esc(c)}</option>`).join('')}
          </select>
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:0.8125rem;color:var(--text-secondary);">
          País <span style="color:var(--color-danger, #EF4444);">*</span>
          <input type="text" id="cad-dest-country" value="${esc(_country)}" style="padding:8px 10px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:6px;color:var(--text-primary);" placeholder="Ex: Marrocos" />
        </label>
        <label style="display:flex;flex-direction:column;gap:4px;font-size:0.8125rem;color:var(--text-secondary);">
          Cidade
          <input type="text" id="cad-dest-city" value="${esc(_city)}" style="padding:8px 10px;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:6px;color:var(--text-primary);" placeholder="Ex: Casablanca (deixe vazio se for país inteiro)" />
        </label>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">
        <button class="re-add-btn" id="cad-dest-cancel" style="margin-top:0;padding:6px 14px;background:transparent;border:1px solid var(--border-subtle);">Cancelar</button>
        <button class="re-add-btn" id="cad-dest-save" style="margin-top:0;padding:6px 14px;font-weight:600;">Salvar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#cad-dest-cancel').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  modal.querySelector('#cad-dest-save').addEventListener('click', async () => {
    const continent = modal.querySelector('#cad-dest-cont').value.trim();
    const country = modal.querySelector('#cad-dest-country').value.trim();
    const city = modal.querySelector('#cad-dest-city').value.trim();
    if (!country) { showToast('País é obrigatório.', 'error'); return; }
    const saveBtn = modal.querySelector('#cad-dest-save');
    saveBtn.disabled = true; saveBtn.textContent = 'Salvando…';
    try {
      await saveDestination(null, { continent, country, city });
      showToast(`Destino "${[city, country].filter(Boolean).join(', ')}" cadastrado.`, 'success');
      // Refetch + adiciona ao destinos do briefing
      try {
        allDestinations = await fetchDestinations();
      } catch {}
      // Adiciona automaticamente o destino cadastrado à lista do briefing
      currentRoteiro = collectFormData();
      if (!currentRoteiro.travel.destinations) currentRoteiro.travel.destinations = [];
      currentRoteiro.travel.destinations.push({ city, country, nights: 1 });
      close();
      switchSection(0);
      markDirty();
    } catch (e) {
      console.error('[cad-dest]', e);
      showToast('Falha ao cadastrar: ' + (e?.message || 'erro'), 'error');
      saveBtn.disabled = false; saveBtn.textContent = 'Salvar';
    }
  });
}

/* ─── v4.49.74+ Geração de roteiro com IA ────────────────────
 * Aciona o agente `roteiros-luxo-gen` (Sonnet 4.5, web_search restrito
 * a virtuoso.com/americanexpress.com/lhw.com).
 *
 * Fluxo:
 *   1. Coleta contexto do form (destinos, datas, viajantes, observações)
 *   2. Monta userMessage estruturada
 *   3. Chama runAgent('roteiros-luxo-gen', userMessage)
 *   4. Parse JSON do response
 *   5. Preenche fields do roteiro (title, days[], hotels[], includes/excludes)
 *   6. Grava sources/queries em currentRoteiro.aiGeneration
 *   7. Re-renderiza editor
 * ──────────────────────────────────────────────────────────── */
async function aiGenerateFullRoteiro() {
  if (!currentRoteiro) currentRoteiro = collectFormData();

  // v4.49.86+ Lê de client.* (schema existente) em vez do bloco briefing
  // que era redundante. Se sem destinos, o agente sugere (modo automático,
  // sem toggle "quero sugestão").
  const c = currentRoteiro.client || {};
  const travelers = Array.isArray(currentRoteiro.travelers) ? currentRoteiro.travelers : [];
  const travel = currentRoteiro.travel || {};
  const destinations = Array.isArray(travel.destinations) ? travel.destinations.filter(d => d.city || d.country) : [];
  const querSugestao = destinations.length === 0; // sem destinos → agente sugere

  const missing = [];
  if (!c.name?.trim() && !travelers.some(t => t.name)) missing.push('cliente ou viajantes');
  if (!travel.startDate || !travel.endDate) missing.push('datas');
  // Destinos NÃO é obrigatório — se vazio, vira modo sugestão automaticamente

  if (missing.length) {
    showToast(`Faltam: ${missing.join(', ')}. Abrindo Cliente e Briefing.`, 'error');
    switchSection(0);
    return;
  }

  // Confirmação se o roteiro já tem conteúdo
  const hasContent = (currentRoteiro.days?.length > 0 && currentRoteiro.days.some(d => d.title || d.narrative || (d.activities || []).length > 0))
    || (currentRoteiro.hotels?.length > 0)
    || currentRoteiro.title;
  if (hasContent) {
    const ok = confirm('Este roteiro já tem conteúdo preenchido. Gerar com IA vai SUBSTITUIR esses dados. Continuar?');
    if (!ok) return;
  }

  // v4.49.94+ Progress overlay: barra animada + phase rotativo + timer.
  // API leva 60-120s (web_search 5 hits + ~3k tokens output). Sem feedback
  // visual, o consultor pensa que travou e abandona a página.
  const btn = document.querySelector('[data-action="ai-generate-full"]');
  const originalText = btn?.textContent;
  if (btn) { btn.disabled = true; btn.style.opacity = '0.5'; }
  const progress = _showAiProgress();

  try {
    // v4.49.86+ Contexto vem de client.* (preferences/restrictions/economicProfile/notes)
    // + travelers[]. Não há mais bloco "briefing" duplicado.
    const travelerLines = travelers
      .filter(t => t.name)
      .map(t => `- ${t.name}${t.age ? ` (${t.age} anos)` : ''}${t.isLead ? ' [responsável]' : ''}${t.notes ? ` — ${t.notes}` : ''}`)
      .join('\n');

    const destLines = destinations.length
      ? destinations.map(d => `- ${[d.city, d.country].filter(Boolean).join(', ')}: ${d.nights || 1} noite${(d.nights || 1) > 1 ? 's' : ''}`).join('\n')
      : '(nenhum destino fixado pelo consultor — agente sugere)';

    const prefs = Array.isArray(c.preferences) && c.preferences.length ? c.preferences.join(', ') : '(não especificadas)';
    const rests = Array.isArray(c.restrictions) && c.restrictions.length ? c.restrictions.join(', ') : '(nenhuma)';
    const profLabel = ({
      standard: 'Standard',
      premium: 'Premium',
      luxury: 'Luxury',
    }[c.economicProfile] || c.economicProfile || '—');

    const userMessage = `Você recebeu um briefing de viagem da PRIMETOUR. Crie um roteiro de luxo seguindo TODAS as diretrizes do system prompt.

## CLIENTE

**Nome:** ${c.name || '(não informado)'}
**Tipo:** ${c.type || '—'}
**Perfil econômico:** ${profLabel}

**Preferências:** ${prefs}
**Restrições:** ${rests}

${c.notes?.trim() ? `**Notas do consultor:**\n${c.notes.trim()}\n` : ''}

**Viajantes (${travelers.length}):**
${travelerLines || '(nenhum viajante listado)'}

## VIAGEM

- Período: ${travel.startDate} a ${travel.endDate}
- Total de noites: ${travel.nights || destinations.reduce((s, d) => s + (d.nights || 0), 0) || '—'}

**Destinos:**
${destLines}

${querSugestao ? `
## ⚠️ MODO ESPECIAL: SUGESTÃO DE DESTINOS

O consultor NÃO especificou destinos definitivos. Você deve:

1. Analisar o briefing (tipo de viagem, perfil, interesses, restrições, orçamento).
2. Propor de **2 a 3 opções de combinação de destinos** que façam sentido pra esse perfil (no campo \`destination_suggestions\` do JSON de output, ver schema).
3. Construir o roteiro completo (\`days\`, \`hotels\`, etc.) baseado na **PRIMEIRA opção** que você sugerir (que será a sua recomendação principal).
4. Justificar brevemente cada opção em \`destination_suggestions[].rationale\`.

Lembre-se da logística inteligente: agrupar destinos próximos, respeitar pacing, sazonalidade.
` : ''}

## INSTRUÇÕES FINAIS

Pesquise em **Virtuoso**, **FHR (Amex)** e **LHW** antes de sugerir hotéis. Cite as fontes em \`sources_consulted\`. Retorne APENAS o JSON estruturado, sem markdown fences nem texto extra antes/depois.`;

    // v4.49.109+ FILA ASSÍNCRONA: cliente cria doc em queue, Cloud Function
    // `processRoteiroQueue` processa em background (max 5 paralelos globais).
    // Cliente escuta via onSnapshot, vê fase atual + result quando done.
    // Chunking + prompt caching agora server-side (consistente entre todos
    // os users + zero risco de aba fechar interromper a geração).
    const inputSnapshot = userMessage.slice(0, 2000);
    const totalDias = travel.startDate && travel.endDate
      ? Math.max(1, Math.round((new Date(travel.endDate) - new Date(travel.startDate)) / 86400000) + 1)
      : (destinations.reduce((s, d) => s + (d.nights || 0), 0) || 7);
    const useChunking = totalDias > 14 || destinations.length > 5;

    const result = await _enqueueAndWait({
      userId: store.get('currentUser')?.uid,
      userDisplayName: store.get('currentUser')?.displayName || store.get('currentUser')?.name || '',
      briefingMessage: userMessage,
      totalDias,
      useChunking,
      progress,
      roteiroId: roteiroId || null,  // v4.57.34: rastreabilidade pra cleanup em ai_usage_logs
    });

    // Parse JSON do output
    // v4.49.107+ Tratamento robusto de truncamento (max_tokens estourado):
    // detecta SyntaxError do JSON.parse e mostra mensagem clara.
    let parsed;
    try {
      // Strip markdown fence se vier
      const cleaned = String(result.text || '').replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      // Recorta do primeiro { ao último }
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      if (start < 0 || end < 0) throw new Error('JSON não detectado na resposta');
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    } catch (parseErr) {
      const rawLen = (result.text || '').length;
      const stopReason = result.stopReason || result.stop_reason || '';
      console.error('[ai-roteiro] Parse JSON falhou:', parseErr,
        '\nRaw length:', rawLen,
        '\nStopReason:', stopReason,
        '\nRaw start:', result.text?.slice(0, 500),
        '\nRaw end:', result.text?.slice(-500));
      // Heurística de truncamento: stopReason 'max_tokens' OU resposta > 14kchars + SyntaxError
      const isTruncated = stopReason === 'max_tokens' || stopReason === 'length' || (rawLen > 14000 && parseErr instanceof SyntaxError);
      if (isTruncated) {
        showToast('⚠ Resposta da IA foi truncada (muitos dias/destinos pra um único pedido). Reduza o número de destinos ou tente novamente.', 'error');
      } else {
        showToast('IA retornou resposta inválida. Detalhes no console.', 'error');
      }
      return;
    }

    // Aplica no currentRoteiro
    _applyAiOutputToRoteiro(parsed, result, inputSnapshot);

    // v4.49.79+ Auto-resolve imagens (banco interno → Unsplash → Wikipedia)
    // pra hero + cada cidade + cada hotel do roteiro gerado.
    // Não-bloqueante: se falhar, segue (usuário pode trocar manualmente depois).
    try {
      await _enrichImagesAfterAi();
    } catch (e) {
      console.warn('[ai-roteiro] image enrich falhou (não-bloqueante):', e?.message);
    }

    // Re-render
    switchSection(activeSection);
    markDirty();
    showToast(`✨ Roteiro gerado! ${parsed.days?.length || 0} dia(s), ${result.webSearchCount || 0} consulta(s) web. Revise antes de salvar.`, 'success');
  } catch (e) {
    console.error('[ai-roteiro] Erro:', e);
    showToast('Falha na geração: ' + (e?.message || 'erro desconhecido'), 'error');
  } finally {
    progress?.close?.();
    if (btn) { btn.disabled = false; btn.textContent = originalText; btn.style.opacity = ''; }
  }
}

/**
 * v4.49.94+ Progress overlay pra geração com IA.
 * Mostra: phase rotativo + timer elapsed + barra animada.
 * Não-bloqueante: user pode ver mas operação roda em background.
 * Retorna { close() } pra encerrar o overlay.
 */
function _showAiProgress() {
  const existing = document.getElementById('re-ai-progress');
  if (existing) existing.remove();

  const phases = [
    { at: 0,  icon: '🔍', label: 'Pesquisando hotéis em Virtuoso, FHR e LHW…' },
    { at: 20, icon: '🏨', label: 'Selecionando opções pro perfil do cliente…' },
    { at: 45, icon: '✍️', label: 'Redigindo dias e atividades…' },
    { at: 80, icon: '✨', label: 'Finalizando JSON estruturado…' },
    { at: 120, icon: '⏳', label: 'Demorando mais que o normal — aguarde, vale a pena.' },
  ];

  const overlay = document.createElement('div');
  overlay.id = 're-ai-progress';
  overlay.innerHTML = `
    <style>
      #re-ai-progress {
        position: fixed; inset: 0; background: rgba(10,22,40,0.72);
        display: flex; align-items: center; justify-content: center;
        z-index: 9998; backdrop-filter: blur(2px);
        animation: re-ai-fadein 0.2s ease;
      }
      @keyframes re-ai-fadein { from { opacity: 0; } to { opacity: 1; } }
      #re-ai-progress .re-ai-card {
        background: var(--bg-elevated, #1a1a2e); border: 1px solid var(--border-default, #333);
        border-radius: 12px; padding: 28px 32px; min-width: 380px; max-width: 460px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.4);
      }
      #re-ai-progress .re-ai-icon {
        font-size: 2.5rem; margin-bottom: 10px; text-align: center;
        animation: re-ai-pulse 1.6s ease-in-out infinite;
      }
      @keyframes re-ai-pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.08); opacity: 0.8; }
      }
      #re-ai-progress .re-ai-title {
        font-size: 1.0625rem; font-weight: 600; color: var(--text-primary);
        text-align: center; margin-bottom: 6px;
      }
      #re-ai-progress .re-ai-phase {
        font-size: 0.875rem; color: var(--text-secondary); text-align: center;
        min-height: 1.4em; margin-bottom: 18px;
        transition: opacity 0.4s;
      }
      #re-ai-progress .re-ai-bar-wrap {
        height: 4px; background: var(--bg-surface, #222); border-radius: 999px;
        overflow: hidden; margin-bottom: 14px;
      }
      #re-ai-progress .re-ai-bar {
        height: 100%; background: linear-gradient(90deg,
          var(--brand-gold, #D4A843), var(--brand-gold-dark, #A88332), var(--brand-gold, #D4A843));
        background-size: 200% 100%;
        width: 100%;
        animation: re-ai-bar-slide 1.8s linear infinite;
      }
      @keyframes re-ai-bar-slide { 0% { background-position: 0% 0; } 100% { background-position: -200% 0; } }
      #re-ai-progress .re-ai-meta {
        display: flex; justify-content: space-between; align-items: center;
        font-size: 0.75rem; color: var(--text-muted);
      }
      #re-ai-progress .re-ai-timer { font-variant-numeric: tabular-nums; font-weight: 600; }
      #re-ai-progress .re-ai-hint {
        margin-top: 16px; padding-top: 14px;
        border-top: 1px solid var(--border-subtle, #333);
        font-size: 0.75rem; color: var(--text-muted); line-height: 1.5;
      }
    </style>
    <div class="re-ai-card" role="status" aria-live="polite">
      <div class="re-ai-icon" id="re-ai-icon">🔮</div>
      <div class="re-ai-title">Gerando roteiro com IA</div>
      <div class="re-ai-phase" id="re-ai-phase">Iniciando…</div>
      <div class="re-ai-bar-wrap"><div class="re-ai-bar"></div></div>
      <div class="re-ai-meta">
        <span>Sonnet 4.5 · web_search Virtuoso/FHR/LHW</span>
        <span class="re-ai-timer"><span id="re-ai-elapsed">0</span>s</span>
      </div>
      <div class="re-ai-hint">
        Geração típica leva <strong>60-120s</strong>. A chamada roda em background — não feche essa aba.
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const startMs = Date.now();
  let phaseIdx = 0;
  const tick = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startMs) / 1000);
    const elapsedEl = document.getElementById('re-ai-elapsed');
    if (elapsedEl) elapsedEl.textContent = elapsed;
    // Atualiza phase quando passa do ponto
    const next = phases.findIndex(p => elapsed >= p.at);
    let target = phases.length - 1;
    for (let i = 0; i < phases.length; i++) if (elapsed >= phases[i].at) target = i;
    if (target !== phaseIdx) {
      phaseIdx = target;
      const ph = phases[phaseIdx];
      const iconEl = document.getElementById('re-ai-icon');
      const phaseEl = document.getElementById('re-ai-phase');
      if (iconEl) iconEl.textContent = ph.icon;
      if (phaseEl) {
        phaseEl.style.opacity = '0';
        setTimeout(() => { phaseEl.textContent = ph.label; phaseEl.style.opacity = '1'; }, 200);
      }
    }
  }, 1000);
  // Trigger phase 0 imediatamente
  const phaseEl0 = document.getElementById('re-ai-phase');
  if (phaseEl0) phaseEl0.textContent = phases[0].label;

  return {
    /** v4.49.108+ Permite ao chunking sobrescrever a phase label em fase corrente. */
    setPhase(label) {
      const phaseEl = document.getElementById('re-ai-phase');
      if (phaseEl) {
        phaseEl.style.opacity = '0';
        setTimeout(() => { phaseEl.textContent = label; phaseEl.style.opacity = '1'; }, 200);
      }
      // Pausa o auto-rotate por tempo enquanto está em chunking explícito
      phaseIdx = phases.length; // força ficar na última (sentinel pra não regridir)
    },
    close() {
      clearInterval(tick);
      overlay.style.animation = 're-ai-fadein 0.2s reverse';
      setTimeout(() => overlay.remove(), 180);
    },
  };
}

/**
 * v4.49.109+ Cria doc na fila de geração + aguarda Cloud Function processar
 * via onSnapshot. Resolve com result shape compatível com runAgent (text,
 * tokens, citations, etc.).
 *
 * Vantagens vs runAgent direto:
 * - Cloud Function ProcessRoteiroQueue tem maxInstances=5 + concurrency=1 →
 *   max 5 gerações paralelas globais. Outros users ficam enfileirados sem
 *   hit em rate-limit Anthropic.
 * - Chunking server-side: lógica única, não duplicada.
 * - Geração continua mesmo se user fechar a aba (Cloud Function termina,
 *   user vê result ao reabrir).
 */
async function _enqueueAndWait({ userId, userDisplayName, briefingMessage, totalDias, useChunking, progress, roteiroId = null }) {
  if (!userId) throw new Error('Usuário não autenticado');

  const [{ db }, { collection, addDoc, doc, onSnapshot, deleteDoc, serverTimestamp, query, where, getDocs }] = await Promise.all([
    import('../firebase.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
  ]);

  // 1. Cria doc na fila
  const queueRef = await addDoc(collection(db, 'roteiro_generations_queue'), {
    userId,
    userDisplayName,
    briefingMessage,
    totalDias,
    useChunking,
    roteiroId,  // v4.57.34: rastreabilidade — CF copia pro ai_usage_logs
    status: 'queued',
    createdAt: serverTimestamp(),
    claimedAt: null,
    completedAt: null,
    phase: null,
    progress: null,
    workerId: null,
    result: null,
    error: null,
  });

  // 2. Conta posição na fila (quantos queued antes deste)
  try {
    const queuedSnap = await getDocs(query(
      collection(db, 'roteiro_generations_queue'),
      where('status', '==', 'queued')
    ));
    // Position = quantos têm createdAt menor que o nosso (aprox — Firestore não dá order < self facilmente)
    // Estimativa: contar todos queued antes do nosso ID. Como serverTimestamp ainda não veio, usar count direto.
    const ahead = Math.max(0, queuedSnap.size - 1);
    if (ahead > 0 && progress?.setPhase) {
      progress.setPhase(`Posição ${ahead + 1} na fila · aguardando…`);
    }
  } catch (e) { /* não bloqueia */ }

  // 3. onSnapshot — escuta updates do doc
  return new Promise((resolve, reject) => {
    let unsubscribe = null;
    const timeoutMs = 10 * 60 * 1000; // 10min hard timeout
    const timeoutHandle = setTimeout(() => {
      try { unsubscribe?.(); } catch {}
      reject(new Error('Timeout aguardando geração (10min). A fila pode estar sobrecarregada.'));
    }, timeoutMs);

    unsubscribe = onSnapshot(doc(db, 'roteiro_generations_queue', queueRef.id), (snap) => {
      if (!snap.exists()) {
        clearTimeout(timeoutHandle);
        try { unsubscribe?.(); } catch {}
        reject(new Error('Doc da fila desapareceu'));
        return;
      }
      const data = snap.data();
      // Atualiza UI conforme phase
      if (data.status === 'processing' && data.phase && progress?.setPhase) {
        if (data.phase === 'skeleton') {
          progress.setPhase(`Fase ${data.progress?.current || 1} de ${data.progress?.total || '?'}: estrutura inicial…`);
        } else if (data.phase.startsWith('days_')) {
          const m = data.phase.match(/days_(\d+)_(\d+)/);
          if (m) {
            progress.setPhase(`Fase ${data.progress?.current || '?'} de ${data.progress?.total || '?'}: dias ${m[1]}-${m[2]}…`);
          }
        } else if (data.phase === 'single') {
          progress.setPhase('Gerando roteiro…');
        }
      }
      if (data.status === 'done') {
        clearTimeout(timeoutHandle);
        try { unsubscribe?.(); } catch {}
        resolve({
          text: data.result?.text || '',
          inputTokens: data.result?.inputTokens || 0,
          outputTokens: data.result?.outputTokens || 0,
          cacheReadTokens: data.result?.cacheReadTokens || 0,
          cacheCreationTokens: data.result?.cacheCreationTokens || 0,
          webSearchCount: data.result?.webSearchCount || 0,
          webSearchResults: data.result?.webSearchResults || [],
          webSearchQueries: data.result?.webSearchQueries || [],
          citations: data.result?.citations || [],
          phases: data.result?.phases || 1,
          queueId: queueRef.id,
        });
      } else if (data.status === 'failed') {
        clearTimeout(timeoutHandle);
        try { unsubscribe?.(); } catch {}
        reject(new Error(data.error || 'Geração falhou'));
      }
    }, (err) => {
      clearTimeout(timeoutHandle);
      reject(err);
    });
  });
}

/**
 * v4.49.108+ DEPRECATED em v4.49.109 (movido pra Cloud Function).
 * Mantido temporariamente como fallback se Cloud Function não estiver deployada.
 */
async function _generateChunked(briefingMsg, totalDias, runAgent, progress) {
  const CHUNK_SIZE = 10;
  const totalChunks = Math.ceil(totalDias / CHUNK_SIZE);
  const totalPhases = 1 + totalChunks; // 1 skeleton + N day chunks

  if (progress?.setPhase) progress.setPhase(`Fase 1 de ${totalPhases}: gerando esqueleto…`);

  // PHASE 1 — Skeleton (sem days)
  const skeletonMsg = `${briefingMsg}

## ⚙ MODO CHUNKING — FASE 1 DE ${totalPhases}: ESQUELETO

Este briefing tem ${totalDias} dias / ${'pode ter'} múltiplos destinos. Pra evitar truncamento, vou gerar em fases.

**NESTA FASE, GERE APENAS o JSON com estes campos (OMITA \`days\`):**
- title
- narrative_overview
- destination_suggestions (se modo sugestão)
- destinations
- hotels (lista COMPLETA — todos os hotéis do roteiro)
- includes
- excludes
- consultant_notes
- sources_consulted

**NÃO inclua \`days\` neste output.** Será gerado em fases separadas.

Retorne JSON válido com fechamento \`}\` correto. Sem markdown fences.`;

  const skeletonResult = await runAgent('roteiros-luxo-gen', skeletonMsg, {});
  const skeleton = _parseJSONSafe(skeletonResult.text);
  if (!skeleton) throw new Error('Fase 1 (esqueleto) falhou — JSON inválido.');

  // PHASE 2+ — Days chunks
  const allDays = [];
  let totalInputTokens = skeletonResult.inputTokens || 0;
  let totalOutputTokens = skeletonResult.outputTokens || 0;
  let totalCacheRead = skeletonResult.cacheReadTokens || 0;
  let totalCacheCreation = skeletonResult.cacheCreationTokens || 0;
  let totalWebSearches = skeletonResult.webSearchCount || 0;
  const allCitations = [...(skeletonResult.citations || [])];
  const allWebResults = [...(skeletonResult.webSearchResults || [])];
  const allWebQueries = [...(skeletonResult.webSearchQueries || [])];

  for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
    const startDay = chunkIdx * CHUNK_SIZE + 1;
    const endDay = Math.min(startDay + CHUNK_SIZE - 1, totalDias);

    if (progress?.setPhase) {
      progress.setPhase(`Fase ${chunkIdx + 2} de ${totalPhases}: dias ${startDay}-${endDay}…`);
    }

    // Skeleton compacto (sem hotels.rationale longos) pra reduzir input tokens
    const skeletonRef = {
      title: skeleton.title,
      destinations: skeleton.destinations,
      hotels: (skeleton.hotels || []).map(h => ({
        city: h.city, hotel_name: h.hotel_name, check_in_day: h.check_in_day, check_out_day: h.check_out_day, nights: h.nights,
      })),
    };
    const prevDaysRef = allDays.length
      ? `\n\n**Dias já gerados (pra continuidade):**\n${allDays.map(d => `- Dia ${d.day_number} (${d.city}): ${d.title}`).join('\n')}`
      : '';

    const daysMsg = `${briefingMsg}

## ⚙ MODO CHUNKING — FASE ${chunkIdx + 2} DE ${totalPhases}: DIAS ${startDay}-${endDay}

**Esqueleto do roteiro (referência):**
\`\`\`json
${JSON.stringify(skeletonRef, null, 2)}
\`\`\`${prevDaysRef}

**NESTA FASE, GERE APENAS os dias ${startDay} a ${endDay}** mantendo coerência com o esqueleto.

Retorne JSON com APENAS:
\`\`\`json
{
  "days": [
    { "day_number": ${startDay}, "city": "...", "title": "...", "narrative": "...", "overnight_city": "...", "activities": [...] },
    ...
  ]
}
\`\`\`

Sem markdown fences no output final. JSON válido. Apenas o array \`days\`.`;

    const chunkResult = await runAgent('roteiros-luxo-gen', daysMsg, {});
    const chunkData = _parseJSONSafe(chunkResult.text);
    if (chunkData?.days && Array.isArray(chunkData.days)) {
      allDays.push(...chunkData.days);
    } else {
      console.warn(`[chunking] phase ${chunkIdx + 2} retornou days vazio ou inválido`);
    }

    totalInputTokens += chunkResult.inputTokens || 0;
    totalOutputTokens += chunkResult.outputTokens || 0;
    totalCacheRead += chunkResult.cacheReadTokens || 0;
    totalCacheCreation += chunkResult.cacheCreationTokens || 0;
    totalWebSearches += chunkResult.webSearchCount || 0;
    allCitations.push(...(chunkResult.citations || []));
    allWebResults.push(...(chunkResult.webSearchResults || []));
    allWebQueries.push(...(chunkResult.webSearchQueries || []));
  }

  // Merge final
  const merged = { ...skeleton, days: allDays };
  return {
    text: JSON.stringify(merged),
    model: skeletonResult.model,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    cacheCreationTokens: totalCacheCreation,
    cacheReadTokens: totalCacheRead,
    webSearchCount: totalWebSearches,
    webSearchQueries: allWebQueries,
    webSearchResults: allWebResults,
    citations: allCitations,
    chunked: true,
    phases: totalPhases,
  };
}

function _parseJSONSafe(rawText) {
  try {
    const cleaned = String(rawText || '').replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < 0) return null;
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

function _applyAiOutputToRoteiro(ai, runResult, inputSnapshot) {
  // Título
  if (ai.title) currentRoteiro.title = ai.title;
  if (ai.narrative_overview) currentRoteiro.narrative = ai.narrative_overview;

  // Destinos — preserva nights existentes se IA não trouxe
  if (Array.isArray(ai.destinations) && ai.destinations.length) {
    currentRoteiro.travel.destinations = ai.destinations.map(d => ({
      city: d.city || '', country: d.country || '', nights: parseInt(d.nights) || 1,
    }));
  }

  // Dias
  if (Array.isArray(ai.days)) {
    currentRoteiro.days = ai.days.map((d, i) => ({
      dayNumber: d.day_number || (i + 1),
      date: d.date || '',
      city: d.city || '',
      title: d.title || '',
      narrative: d.narrative || '',
      overnightCity: d.overnight_city || d.city || '',
      activities: Array.isArray(d.activities) ? d.activities.map(a => ({
        time: a.time || '',
        description: [a.name, a.description, a.insider_tip ? `💡 ${a.insider_tip}` : ''].filter(Boolean).join(' — '),
        type: 'passeio',
      })) : [],
      imageIds: [],
    }));
  }

  // Hotéis
  if (Array.isArray(ai.hotels)) {
    currentRoteiro.hotels = ai.hotels.map(h => ({
      city: h.city || '',
      hotelName: h.hotel_name || '',
      roomType: h.room_type || '',
      regime: h.regime || '',
      checkIn: '',
      checkOut: '',
      nights: parseInt(h.nights) || 1,
      notes: [h.program ? `[${h.program}]` : '', h.rationale || ''].filter(Boolean).join(' '),
    }));
  }

  // Inclusos / Não inclusos
  if (Array.isArray(ai.includes)) currentRoteiro.includes = ai.includes.slice();
  if (Array.isArray(ai.excludes)) currentRoteiro.excludes = ai.excludes.slice();

  // v4.49.75+ Sugestões de destino (modo "querSugestaoDestino")
  const destinationSuggestions = Array.isArray(ai.destination_suggestions) ? ai.destination_suggestions : [];

  // Observações internas — fontes consultadas
  currentRoteiro.aiGeneration = {
    enabled: true,
    sources: Array.isArray(runResult.webSearchResults) ? runResult.webSearchResults : [],
    citations: Array.isArray(runResult.citations) ? runResult.citations : [],
    queries: Array.isArray(runResult.webSearchQueries) ? runResult.webSearchQueries : [],
    aiSourcesFromAgent: Array.isArray(ai.sources_consulted) ? ai.sources_consulted : [],
    destinationSuggestions,                  // v4.49.75+ pra modo "sugerir destino"
    promptVersion: 'roteiros-luxo-gen-v2',   // v2 = inclui briefing structurado
    generatedAt: new Date().toISOString(),
    lastInput: inputSnapshot || '',
    consultantNotes: (ai.consultant_notes || '') + (currentRoteiro.aiGeneration?.consultantNotes ? `\n\n--- Anteriores ---\n${currentRoteiro.aiGeneration.consultantNotes}` : ''),
    webSearchCount: runResult.webSearchCount || 0,
    inputTokens: runResult.inputTokens || 0,
    outputTokens: runResult.outputTokens || 0,
  };
}

/* ─── v4.49.79+ Auto-resolve imagens após geração via IA ────
 *
 * Pra cada hero/cidade/hotel do roteiro gerado, busca imagem na
 * cascata padrão (banco interno portal_images → Unsplash → Wikipedia)
 * via `resolveDestinationImage` do roteiroGenerator.
 *
 * Reutiliza exatamente a mesma infra que o picker manual já usa, então
 * imagens auto-resolvidas ficam consistentes com o resto do sistema.
 *
 * Não-bloqueante: se uma cidade falhar, segue pra próxima. Set de
 * excludeUrls garante dedup entre slots (hero != city != hotel).
 * ──────────────────────────────────────────────────────────── */
async function _enrichImagesAfterAi() {
  if (!currentRoteiro) return;

  // Garante estrutura
  if (!currentRoteiro.images) currentRoteiro.images = { hero: null, overrides: {} };
  if (!currentRoteiro.images.overrides) currentRoteiro.images.overrides = {};

  // Banco interno (portal_images) — carrega uma vez, usa pra todos os slots
  let bank = [];
  try { bank = await fetchImages({}); }
  catch (e) { console.warn('[enrichImages] fetchImages falhou:', e?.message); }

  const excludeUrls = new Set();
  const overrides = currentRoteiro.images.overrides;

  // 1. Hero — primeiro destino
  const firstDest = currentRoteiro.travel?.destinations?.[0];
  if (firstDest?.city || firstDest?.country) {
    try {
      const url = await resolveDestinationImage(
        { city: firstDest.city || '', country: firstDest.country || '' },
        null, bank, { excludeUrls },
      );
      if (url) {
        currentRoteiro.images.hero = url;
        overrides.hero = url;
        excludeUrls.add(url);
      }
    } catch (e) { console.warn('[enrichImages] hero falhou:', e?.message); }
  }

  // 2. Pra cada cidade única dos destinos
  const cities = new Map(); // slug → {city, country}
  (currentRoteiro.travel?.destinations || []).forEach(d => {
    if (d.city) cities.set(_normKey(d.city), { city: d.city, country: d.country || '' });
  });
  for (const [slug, dest] of cities) {
    const ovKey = `city_${slug}`;
    if (overrides[ovKey]) continue; // já tem (manual)
    try {
      const url = await resolveDestinationImage(dest, null, bank, { excludeUrls });
      if (url) {
        overrides[ovKey] = url;
        excludeUrls.add(url);
      }
    } catch (e) { console.warn(`[enrichImages] city ${slug} falhou:`, e?.message); }
  }

  // 3. Pra cada hotel (usa city do hotel)
  const hotels = currentRoteiro.hotels || [];
  for (let i = 0; i < hotels.length; i++) {
    const h = hotels[i];
    const ovKey = `hotel_${i}`;
    if (overrides[ovKey]) continue;
    if (!h?.city && !h?.hotelName) continue;
    try {
      const url = await resolveDestinationImage(
        { city: h.city || '', country: '' },
        null, bank, { excludeUrls },
      );
      if (url) {
        overrides[ovKey] = url;
        excludeUrls.add(url);
      }
    } catch (e) { console.warn(`[enrichImages] hotel ${i} falhou:`, e?.message); }
  }

  console.log(`[enrichImages] ${Object.keys(overrides).length} imagens resolvidas (${excludeUrls.size} URLs únicos).`);
}

/* ─── Destroy ─────────────────────────────────────────────── */
export function destroyRoteiroEditor() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
  // v4.49.103+ stop auto-save tick
  if (_autoSaveTickInterval) { clearInterval(_autoSaveTickInterval); _autoSaveTickInterval = null; }

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
    if (container._closeStatusOnOutside) {
      document.removeEventListener('click', container._closeStatusOnOutside);
    }
  }

  currentRoteiro = null;
  isDirty = false;
  allDestinations = [];
  allAreas = [];
  activeSection = 0;
}
