/**
 * arts_content_bank — banco de conteúdos curados pro Gerador de Imagens.
 *
 * Coleção SEPARADA do Portal de Dicas (não cadastra nada novo lá).
 * Read-only do módulo. Write apenas via curadoria interna (Firebase
 * Console hoje; UI dedicada no futuro).
 *
 * Schema de cada documento:
 *   {
 *     destinoId:     'abc123',         // FK portal_destinations
 *     destinoSlug:   'asia/japao/toquio',
 *     topicoKey:     'atracoes',       // chave do segment do Portal
 *     faixaTemplate: 'curto'|'medio'|'longo',
 *     conteudo: {
 *       hand:      'opcional',
 *       titulo:    'CAIXA-ALTA',
 *       descricao: 'corpo do slide',
 *     },
 *     ativo:      true,
 *     prioridade: 1,                   // menor = preferido como default
 *     notas:      '',                  // interno
 *     criadoEm, atualizadoEm, criadoPor,
 *   }
 */

import { collection, getDocs, query, limit } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';

// Cache local — populado em fetchAllVariations()
// key = `${destinoId}:${topicoKey}` → array de variações ordenadas por prioridade
let _variationsByKey = new Map();
// Destinos que têm pelo menos 1 variação cadastrada (pra UI sinalizar)
let _destinosComBanco = new Set();

/**
 * Carrega TODAS as variações ativas em massa (até 500).
 * Indexa em memória pra lookups instantâneos. Roda 1× em fetchDestinos
 * (igual fazemos com portal_tips e portal_images).
 */
export async function fetchAllVariations() {
  let docs = [];
  try {
    const snap = await getDocs(query(collection(db, 'arts_content_bank'), limit(500)));
    docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    // Coleção pode não existir ainda, ou regra Firestore pode estar bloqueando
    console.warn('[artsContentBank] erro ao carregar (esperado se coleção ainda vazia):', err?.message);
    _variationsByKey = new Map();
    _destinosComBanco = new Set();
    return 0;
  }

  _variationsByKey = new Map();
  _destinosComBanco = new Set();
  for (const v of docs) {
    if (v.ativo === false) continue;
    if (!v.destinoId || !v.topicoKey) continue;
    if (!v.conteudo) continue;
    const key = `${v.destinoId}:${v.topicoKey}`;
    if (!_variationsByKey.has(key)) _variationsByKey.set(key, []);
    _variationsByKey.get(key).push(v);
    _destinosComBanco.add(v.destinoId);
  }
  // Ordena por prioridade (menor primeiro)
  for (const arr of _variationsByKey.values()) {
    arr.sort((a, b) => (a.prioridade ?? 999) - (b.prioridade ?? 999));
  }
  console.log('[artsContentBank] variações ativas:', docs.length, '| destinos com banco:', _destinosComBanco.size);
  return docs.length;
}

/**
 * Retorna a MELHOR variação pra (destino, tópico, faixa).
 *  - Faixa exata se houver
 *  - Fallback: faixa "medio" → primeira disponível
 * Retorna null se não há variação cadastrada.
 */
export function pickVariation(destinoId, topicoKey, faixaTemplate = null) {
  const arr = _variationsByKey.get(`${destinoId}:${topicoKey}`);
  if (!arr || !arr.length) return null;
  if (faixaTemplate) {
    const match = arr.find(v => v.faixaTemplate === faixaTemplate);
    if (match) return match;
  }
  return arr.find(v => v.faixaTemplate === 'medio') || arr[0];
}

/**
 * Lista todas as variações pra (destino, tópico) — pra UI "trocar variação".
 */
export function listVariations(destinoId, topicoKey) {
  return _variationsByKey.get(`${destinoId}:${topicoKey}`) || [];
}

/**
 * Quais tópicos têm variação curada pra este destino? Set de keys.
 */
export function getTopicosComBanco(destinoId) {
  const set = new Set();
  for (const [key] of _variationsByKey) {
    const [dId, tKey] = key.split(':');
    if (dId === destinoId) set.add(tKey);
  }
  return set;
}

export function hasBanco(destinoId) {
  return _destinosComBanco.has(destinoId);
}
