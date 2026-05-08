/**
 * PRIMETOUR — Insight Drafts Service
 *
 * Rascunhos de insights salvos localmente (localStorage). Permite ao usuário
 * pausar a redação, conferir dados em outra parte do dashboard, e voltar
 * sem perder o que escreveu.
 *
 * Por que localStorage e não Firestore?
 *   - Latência zero (auto-save a cada keystroke)
 *   - Funciona offline
 *   - Não polui o backend com lixo de redações abandonadas
 *   - V1: simples e suficiente. V2 futuro pode mover pra Firestore se
 *     houver demanda real de sync entre devices/browsers.
 *
 * Limites:
 *   - Máx 20 rascunhos por usuário (FIFO — descarta o mais velho)
 *   - Auto-purge de rascunhos > 30 dias na primeira leitura
 *   - Cap de tamanho por campo (4000 chars, igual ao save oficial)
 *
 * Schema do draft (em memória e em localStorage):
 *   {
 *     id:           'd_1748341234',          // único por usuário
 *     dashboard:    'produtividade',         // 'produtividade' | 'csat' | ...
 *     indexKey:     'velocity' | 'general',  // widget alvo OU 'general'
 *     indexLabel:   '📈 Criadas vs Concluídas', // p/ exibir na tab
 *     title:        '...',
 *     observation:  '...',
 *     recommendation: '...',
 *     type:         'neutral' | 'positive' | 'negative' | 'warning',
 *     impact:       'low' | 'medium' | 'high',
 *     tags:         ['...'],
 *     periodFrom:   '2026-04-01' | null,    // ISO YYYY-MM-DD
 *     periodTo:     '2026-04-30' | null,
 *     noPeriod:     boolean,
 *     snapshot:     {...} | null,            // congelado na criação
 *     widgetHasCanvas: boolean,
 *     filters:      {...} | null,
 *     createdAt:    'ISO',
 *     updatedAt:    'ISO',
 *   }
 *
 * Eventos (via window):
 *   - 'insightDrafts:changed' — disparado em qualquer save/delete/clear.
 *     Listeners (ex: dock no rodapé) re-renderizam.
 *   - storage event nativo — outras abas reagem automaticamente.
 */

const STORAGE_KEY = 'primetour-insight-drafts';
const MAX_DRAFTS = 20;
const PURGE_AFTER_DAYS = 30;
const MAX_FIELD_CHARS = 4000;

/* ─── Utils ───────────────────────────────────────── */

function now() { return new Date().toISOString(); }

function genId() {
  return 'd_' + Math.random().toString(36).slice(2, 8) + '_' + Date.now().toString(36);
}

function clip(s) {
  return typeof s === 'string' ? s.slice(0, MAX_FIELD_CHARS) : '';
}

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch (_) { return []; }
}

function writeAll(drafts) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  } catch (e) {
    // Quota exceeded — drop oldest até caber
    if (e?.name === 'QuotaExceededError' && drafts.length > 1) {
      writeAll(drafts.slice(1));
    } else {
      console.warn('[insightDrafts] write failed:', e?.message);
    }
  }
}

function emitChange(reason = 'unknown') {
  try {
    window.dispatchEvent(new CustomEvent('insightDrafts:changed', { detail: { reason } }));
  } catch (_) {}
}

/* ─── Auto-purge de drafts antigos ───────────────────
 * Roda automaticamente em qualquer leitura. Idempotente. */
function purgeOld(drafts) {
  const cutoff = Date.now() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000;
  const fresh = drafts.filter(d => {
    const ts = new Date(d.updatedAt || d.createdAt || 0).getTime();
    return Number.isFinite(ts) && ts >= cutoff;
  });
  if (fresh.length !== drafts.length) writeAll(fresh);
  return fresh;
}

/* ─── Heurística de "vale virar rascunho" ─────────────
 * Evita salvar rascunho de input acidental (1 letra digitada por engano).
 * Critério: pelo menos 1 char no título OU 10 chars na observação. */
export function shouldDraft(data) {
  const t = (data?.title || '').trim();
  const o = (data?.observation || '').trim();
  return t.length >= 1 || o.length >= 10;
}

/* ─── API pública ────────────────────────────────── */

/** Lista todos os drafts do usuário, ordenados por updatedAt desc. */
export function listDrafts() {
  const all = purgeOld(readAll());
  return [...all].sort((a, b) => {
    const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return bt - at;
  });
}

/** Lê um draft específico por id. */
export function getDraft(id) {
  if (!id) return null;
  return readAll().find(d => d.id === id) || null;
}

/**
 * Cria ou atualiza um draft. Se `data.id` existir e for válido, atualiza;
 * caso contrário cria um novo. Retorna o draft (com `id` garantido).
 */
export function saveDraft(data) {
  if (!data || typeof data !== 'object') throw new Error('saveDraft: data inválido');
  const all = readAll();
  const ts = now();

  // Update se id já existe
  if (data.id) {
    const idx = all.findIndex(d => d.id === data.id);
    if (idx >= 0) {
      const merged = {
        ...all[idx],
        ...data,
        title:        clip(data.title ?? all[idx].title),
        observation:  clip(data.observation ?? all[idx].observation),
        recommendation: clip(data.recommendation ?? all[idx].recommendation),
        updatedAt:    ts,
      };
      all[idx] = merged;
      writeAll(all);
      emitChange('update');
      return merged;
    }
  }

  // Create
  const draft = {
    id: data.id || genId(),
    dashboard: data.dashboard || null,
    indexKey: data.indexKey || null,
    indexLabel: data.indexLabel || '',
    title: clip(data.title || ''),
    observation: clip(data.observation || ''),
    recommendation: clip(data.recommendation || ''),
    type: data.type || 'neutral',
    impact: data.impact || 'medium',
    tags: Array.isArray(data.tags) ? data.tags.slice(0, 10) : [],
    periodFrom: data.periodFrom || null,
    periodTo: data.periodTo || null,
    noPeriod: data.noPeriod === true,
    snapshot: data.snapshot || null,
    widgetHasCanvas: data.widgetHasCanvas === true,
    filters: data.filters || null,
    createdAt: ts,
    updatedAt: ts,
  };

  all.push(draft);

  // Cap MAX_DRAFTS — drop o(s) mais velho(s)
  while (all.length > MAX_DRAFTS) {
    all.sort((a, b) => new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0));
    all.shift();
  }

  writeAll(all);
  emitChange('create');
  return draft;
}

/** Deleta um draft pelo id. Retorna true se deletou algo. */
export function deleteDraft(id) {
  if (!id) return false;
  const all = readAll();
  const next = all.filter(d => d.id !== id);
  if (next.length === all.length) return false;
  writeAll(next);
  emitChange('delete');
  return true;
}

/** Limpa todos os drafts. Usar com confirmação do usuário. */
export function clearAllDrafts() {
  writeAll([]);
  emitChange('clear');
}

/** Conta drafts (depois de purgar antigos). */
export function countDrafts() {
  return listDrafts().length;
}

/* ─── Sincronização entre abas ──────────────────────
 * storage event dispara quando OUTRA aba muda o localStorage.
 * Re-emite como 'insightDrafts:changed' pra manter o protocolo único. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) emitChange('cross-tab');
  });
}
