/**
 * PRIMETOUR — AI Module Hints Service
 *
 * CRUD para prompts customizados por módulo (collection `ai_module_hints`).
 * Cada documento sobrescreve o DEFAULT_MODULE_HINTS correspondente em `ai.js`.
 *
 * Fluxo:
 *   1. chatWithAI() chama getModuleHint(moduleId)
 *   2. Se há override no Firestore → retorna o custom
 *   3. Caso contrário → retorna null (ai.js usa DEFAULT_MODULE_HINTS como fallback)
 *
 * Cache em memória:
 *   - Primeira leitura busca todos os overrides de uma vez (snapshot único)
 *   - Invalidação automática após TTL (5 min) ou on-save via invalidateCache()
 *   - Promise compartilhada evita consultas duplicadas em chamadas concorrentes
 */

import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';
import { DEFAULT_MODULE_HINTS, MODULE_REGISTRY } from './ai.js';

const COL_NAME = 'ai_module_hints';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

let _cache = null;           // { moduleId: hintText, ... }
let _cacheAt = 0;
let _pending = null;         // Promise em andamento (evita consultas duplicadas)

/* ─── Cache helpers ──────────────────────────────────────── */

function isCacheValid() {
  return _cache && (Date.now() - _cacheAt) < CACHE_TTL_MS;
}

export function invalidateCache() {
  _cache = null;
  _cacheAt = 0;
  _pending = null;
}

/** Carrega TODOS os overrides de uma vez (um único getDocs). */
async function loadCache() {
  if (isCacheValid()) return _cache;
  if (_pending) return _pending;

  _pending = (async () => {
    try {
      const snap = await getDocs(collection(db, COL_NAME));
      const map = {};
      snap.forEach(d => {
        const data = d.data() || {};
        if (typeof data.hint === 'string') map[d.id] = data.hint;
      });
      _cache = map;
      _cacheAt = Date.now();
      return _cache;
    } catch (e) {
      console.warn('[aiModuleHints] Falha ao carregar cache:', e?.message || e);
      _cache = {};
      _cacheAt = Date.now();
      return _cache;
    } finally {
      _pending = null;
    }
  })();

  return _pending;
}

/* ─── API pública ────────────────────────────────────────── */

/**
 * Retorna o hint customizado de um módulo (ou null se não há override).
 * O caller deve tratar null como "usar DEFAULT_MODULE_HINTS".
 */
export async function getModuleHint(moduleId) {
  if (!moduleId) return null;
  const cache = await loadCache();
  return cache?.[moduleId] || null;
}

/**
 * Retorna todos os hints (merged: custom sobrescreve default).
 * Usado pela página de edição.
 */
export async function listAllModuleHints() {
  const cache = await loadCache();
  const result = [];
  const allIds = new Set([
    ...Object.keys(MODULE_REGISTRY || {}),
    ...Object.keys(DEFAULT_MODULE_HINTS || {}),
    ...Object.keys(cache || {}),
  ]);

  for (const moduleId of allIds) {
    const reg = MODULE_REGISTRY?.[moduleId] || {};
    const defaultHint = DEFAULT_MODULE_HINTS?.[moduleId] || '';
    const customHint  = cache?.[moduleId] || null;
    result.push({
      moduleId,
      label: reg.label || moduleId,
      icon: reg.icon || '◦',
      defaultHint,
      customHint,
      effectiveHint: customHint || defaultHint,
      isCustom: !!customHint,
      hasDefault: !!defaultHint,
    });
  }

  // Ordenar: módulos com custom primeiro, depois por label
  result.sort((a, b) => {
    if (a.isCustom !== b.isCustom) return a.isCustom ? -1 : 1;
    return (a.label || '').localeCompare(b.label || '', 'pt-BR');
  });

  return result;
}

/**
 * Salva/atualiza um hint customizado para um módulo.
 * Mescla com merge:true para preservar metadados.
 */
export async function saveModuleHint(moduleId, hintText) {
  if (!moduleId) throw new Error('moduleId é obrigatório');
  if (typeof hintText !== 'string') throw new Error('hintText deve ser string');

  const user = store.get('currentUser');
  const reg = MODULE_REGISTRY?.[moduleId] || {};
  await setDoc(doc(db, COL_NAME, moduleId), {
    moduleId,
    label: reg.label || moduleId,
    hint: hintText,
    isCustom: true,
    updatedAt: serverTimestamp(),
    updatedBy: user?.uid || '',
    updatedByName: user?.displayName || user?.email || '',
  }, { merge: true });

  invalidateCache();
}

/**
 * Remove o override de um módulo (volta para o DEFAULT_MODULE_HINTS).
 */
export async function resetModuleHint(moduleId) {
  if (!moduleId) throw new Error('moduleId é obrigatório');
  await deleteDoc(doc(db, COL_NAME, moduleId));
  invalidateCache();
}

/**
 * Importa TODOS os DEFAULT_MODULE_HINTS para o Firestore como ponto de partida.
 * Usado pelo botão "Importar defaults" da UI.
 * Não sobrescreve documentos já customizados (a menos que overwrite=true).
 */
export async function importDefaultHints({ overwrite = false } = {}) {
  const user = store.get('currentUser');
  const cache = await loadCache();
  const results = { imported: 0, skipped: 0, total: 0 };

  for (const [moduleId, defaultHint] of Object.entries(DEFAULT_MODULE_HINTS || {})) {
    results.total++;
    if (!overwrite && cache?.[moduleId]) {
      results.skipped++;
      continue;
    }
    const reg = MODULE_REGISTRY?.[moduleId] || {};
    try {
      await setDoc(doc(db, COL_NAME, moduleId), {
        moduleId,
        label: reg.label || moduleId,
        hint: defaultHint,
        isCustom: true,
        importedFromDefault: true,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || '',
        updatedByName: user?.displayName || user?.email || '',
      }, { merge: true });
      results.imported++;
    } catch (e) {
      console.warn(`[aiModuleHints] Falha ao importar ${moduleId}:`, e?.message || e);
    }
  }

  invalidateCache();
  return results;
}

/**
 * Constrói o system prompt completo que seria enviado à IA para um módulo.
 * Usado pelo botão "Testar prompt" da UI para debugar.
 *
 * NOTA: Replica a lógica de montagem de ai.js → chatWithAI.
 * Se mudar lá, atualizar aqui também.
 */
export async function previewSystemPrompt(moduleId) {
  const reg = MODULE_REGISTRY?.[moduleId] || {};
  const moduleLabel = reg.label || moduleId || 'Sistema';
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const tomorrowStr = new Date(today.getTime() + 86400000).toISOString().split('T')[0];
  const todayBR = today.toLocaleDateString('pt-BR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const parts = [
    `Assistente IA PRIMETOUR — módulo "${moduleLabel}". Hoje: ${todayStr} (${todayBR}). Amanhã: ${tomorrowStr}.`,
    `Responda em pt-BR, conciso (1-2 frases + ação). SEMPRE execute ações, NUNCA diga "eu faria". NUNCA invente IDs — use APENAS IDs do histórico. Se não souber o ID, faça list_ primeiro. NUNCA preencha params opcionais com valores inventados — omita-os. Formato OBRIGATÓRIO: <<<ACTION>>>{"action":"x","params":{}}<<<END_ACTION>>> — SEMPRE feche com <<<END_ACTION>>>.`,
  ];

  const customHint = await getModuleHint(moduleId);
  const effectiveHint = customHint || DEFAULT_MODULE_HINTS?.[moduleId] || '';
  if (effectiveHint) parts.push(effectiveHint);

  // Lista de ações disponíveis
  try {
    const { formatActionsForPrompt } = await import('./aiActions.js');
    const actionsPrompt = formatActionsForPrompt(moduleId || 'general');
    if (actionsPrompt) parts.push(actionsPrompt);
  } catch (_) { /* ignore */ }

  return {
    moduleId,
    moduleLabel,
    isCustom: !!customHint,
    fullPrompt: parts.join('\n'),
    hintSource: customHint ? 'Firestore (customizado)' : (effectiveHint ? 'Default (hardcoded)' : 'Sem hint'),
  };
}
