/**
 * PRIMETOUR — Geographic Resolver (sprint v4.59 — SSOT geografia)
 *
 * Helper centralizado pra resolver labels arbitrários de continente/país
 * → códigos canônicos ISO 3166-1 + UN M.49. Usa SSOT hardcoded em
 * `js/data/{continents,countries}.js`.
 *
 * **Para que serve**:
 *   - Adapter Envision (envisionAdapter.js) usa `resolveCountry()` pra
 *     escrever `geo.countryCodes[]` em roteiros_bank.
 *   - Backfill scripts (functions/backfill-geo-*.cjs) usam pra adicionar
 *     `countryCode` em portal_destinations, portal_images, portal_tips.
 *   - Filtros de UI usam `resolveCountry()` pra matchear input do user
 *     mesmo quando ele digita variação ortográfica.
 *   - Auto-create de destinos cidade-país a partir do import Envision
 *     usa `resolveOrCreatePendingDestination()`.
 *
 * **Princípio**: este service NUNCA escreve direto em portal_destinations
 * (canônico). Só **propõe** destinos pendentes via collection paralela
 * `portal_destinations` mesmo, com flag `reviewStatus='pending'` +
 * `source='envision-auto'`. Master aprova → flip pra `reviewStatus='approved'`.
 *
 * **Compat retroativa**:
 *   - portal_destinations atual tem `continent` (string) e `country` (string)
 *     SEM countryCode. Os helpers aceitam ambas as formas e priorizam code
 *     quando presente.
 *   - CONTINENTS legado em portal.js tem 11 entries (inclui "Brasil",
 *     "Caribe", "América Central", "Oriente Médio" como pseudo-continentes).
 *     Mapa `LEGACY_CONTINENT_TO_CODE` faz a tradução: "Brasil"→'SA',
 *     "Caribe"→'NA', "Oriente Médio" → null (cai pro continent do país).
 */

import { CONTINENTS, CONTINENTS_BY_CODE, continentCodeFromLabel } from '../data/continents.js';
import {
  COUNTRIES, COUNTRIES_BY_CODE,
  countryCodeFromLabel, countryLabel, countryLabelEn, countryContinent,
} from '../data/countries.js';

/**
 * Mapa labels legados de portal.js CONTINENTS → continentCode SSOT.
 *
 * Os 11 valores em portal.js CONTINENTS são:
 *   'Brasil', 'África', 'América Central', 'Caribe',
 *   'América do Norte', 'América do Sul', 'Ásia',
 *   'Europa', 'Oriente Médio', 'Oceania', 'Antártica'
 *
 * Mapeamento:
 *   'Brasil'          → 'SA' (país, mas tratado como continent legado)
 *   'América Central' → 'NA' (parte de NA pela UN M.49)
 *   'Caribe'          → 'NA' (parte de NA pela UN M.49)
 *   'Oriente Médio'   → null (ambíguo — depende do país: Egito é AF, Israel é AS)
 *
 * Quando legacy_continent='Oriente Médio', NÃO se infere continentCode a
 * partir dele; usa-se o continentCode do `country` (countryContinent).
 */
export const LEGACY_CONTINENT_TO_CODE = Object.freeze({
  'brasil':            'SA',
  'áfrica':            'AF',
  'africa':            'AF',
  'américa central':   'NA',
  'america central':   'NA',
  'caribe':            'NA',
  'américa do norte':  'NA',
  'america do norte':  'NA',
  'américa do sul':    'SA',
  'america do sul':    'SA',
  'ásia':              'AS',
  'asia':              'AS',
  'europa':            'EU',
  'oriente médio':     null,  // ambíguo — usa country.continent
  'oriente medio':     null,
  'oceania':           'OC',
  'antártica':         'AN',
  'antartica':         'AN',
  'antártida':         'AN',
  'antartida':         'AN',
});

/**
 * Resolve um label de continente arbitrário pra code SSOT.
 * Tenta SSOT primeiro, depois mapa legacy, depois null.
 */
export function resolveContinent(rawLabel) {
  if (!rawLabel || typeof rawLabel !== 'string') return null;
  const ssotCode = continentCodeFromLabel(rawLabel);
  if (ssotCode) return ssotCode;
  const key = rawLabel.toLowerCase().trim();
  return LEGACY_CONTINENT_TO_CODE[key] ?? null;
}

/**
 * Resolve um label de país pra entry completa do SSOT.
 *
 * @param {string} rawLabel
 * @returns {{ code, pt, en, continent } | null}
 */
export function resolveCountry(rawLabel) {
  const code = countryCodeFromLabel(rawLabel);
  if (!code) return null;
  const entry = COUNTRIES_BY_CODE[code];
  return entry ? { ...entry } : null;
}

/**
 * Resolve continent code A PARTIR de um label de país.
 * Útil quando você tem só o país e quer inferir o continente
 * (ex: filtro hierárquico, agrupamento).
 */
export function continentCodeFromCountryLabel(countryLabel_) {
  const country = resolveCountry(countryLabel_);
  return country?.continent || null;
}

/**
 * Resolve uma DUPLA legacy (continent label + country label) pra códigos.
 * Lida com inconsistências (ex: legacy_continent='Brasil' + country='Brasil'
 * vira continentCode='SA' + countryCode='BR').
 *
 * Estratégia:
 *   1. Tenta resolver country → tem continent inferido confiável.
 *   2. Tenta resolver continent (SSOT ou legacy) — usa só se country falhou
 *      OU se legacy não-ambíguo bate.
 *
 * @returns {{ continentCode, countryCode, country: entry | null }}
 */
export function resolveGeoPair(legacyContinent, legacyCountry) {
  const country = resolveCountry(legacyCountry);
  if (country) {
    return {
      continentCode: country.continent,
      countryCode:   country.code,
      country,
    };
  }
  // Sem country resolvido — tenta só continent (fallback fraco).
  const continentCode = resolveContinent(legacyContinent);
  return {
    continentCode: continentCode || null,
    countryCode:   null,
    country:       null,
  };
}

/**
 * Resolve countryCode pra uma lista de labels.
 * Útil pra geo.countries (array de strings) em roteiros_bank.
 * Mantém ordem original, descarta unmatched (loga warn).
 */
export function resolveCountryCodes(labels) {
  if (!Array.isArray(labels)) return [];
  const codes = [];
  for (const label of labels) {
    const code = countryCodeFromLabel(label);
    if (code) {
      if (!codes.includes(code)) codes.push(code);
    } else if (label) {
      console.warn('[geoResolver] countryCode não resolvido pra:', label);
    }
  }
  return codes;
}

/**
 * Resolve continentCodes ÚNICOS a partir de uma lista de countryCodes.
 */
export function continentCodesFromCountryCodes(countryCodes) {
  if (!Array.isArray(countryCodes)) return [];
  const set = new Set();
  for (const code of countryCodes) {
    const cont = countryContinent(code);
    if (cont) set.add(cont);
  }
  return [...set];
}

// ════════════════════════════════════════════════════════════════
// LOOKUP em portal_destinations (canônico)
// ════════════════════════════════════════════════════════════════

import { db } from '../firebase.js';
// CRÍTICO: versão DEVE casar com firebase.js + portal.js (10.12.2). Mismatch
// silenciosamente falha em collection(db, ...) porque db é instancia 10.12.2
// e collection() do 10.13.2 não reconhece. Bug pegou em E2E v4.61.3 — ensureDestination
// chamava findDestinationByLabel que throw silent e caía pro fallback slugify,
// criando duplicata.
import {
  collection, query, where, limit, getDocs, addDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/**
 * Busca portal_destinations por (country, city) com normalização.
 *
 * Estratégia de matching (em ordem):
 *   1. Match exato por countryCode (se doc tem o campo novo)
 *   2. Match por country label canônico (pt) — após normalização
 *   3. Match por country alias
 *   Pra cidade: case-insensitive, sem acento, trim.
 *
 * @returns {Promise<{id, ...data} | null>}
 */
export async function findDestinationByLabel({ country, city }) {
  if (!country || !city) return null;
  const targetCountryCode = countryCodeFromLabel(country);
  if (!targetCountryCode) return null;
  const normCity = String(city).toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');

  const snap = await getDocs(query(
    collection(db, 'portal_destinations'),
    limit(1000),
  ));
  for (const d of snap.docs) {
    const data = d.data();
    const docCountryCode = data.countryCode || countryCodeFromLabel(data.country);
    if (docCountryCode !== targetCountryCode) continue;
    const docCity = String(data.city || '').toLowerCase().trim()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (docCity === normCity) {
      return { id: d.id, ...data };
    }
    // Match em aliases (campo novo v4.59+)
    const aliases = Array.isArray(data.cityAliases) ? data.cityAliases : [];
    for (const alias of aliases) {
      const a = String(alias).toLowerCase().trim()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (a === normCity) return { id: d.id, ...data };
    }
  }
  return null;
}

/**
 * Cria um destination PENDENTE de revisão (source='envision-auto').
 *
 * Não chama saveDestination (que exige permissão master). Escreve direto
 * com setDoc + rules.firestore liberam create se reviewStatus='pending' +
 * source startsWith 'envision-' OU 'auto-'.
 *
 * @param {{ country: string, city: string, continent?: string, envisionLocationId?: string }} args
 * @param {{ actorId?: string }} opts
 * @returns {Promise<{ id, ...data }>}
 */
export async function createPendingDestination(args, opts = {}) {
  const { country, city, continent: legacyContinent, envisionLocationId } = args || {};
  if (!country || !city) throw new Error('country e city são obrigatórios');

  const countryEntry = resolveCountry(country);
  const countryCode = countryEntry?.code || null;
  const countryPt = countryEntry?.pt || country;
  const continentCode = countryEntry?.continent || resolveContinent(legacyContinent);
  const continentLabel = continentCode ? CONTINENTS_BY_CODE[continentCode]?.pt : (legacyContinent || '');

  const slug = [continentLabel, countryPt, city]
    .filter(Boolean).map(s => String(s).toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    .join('/');

  const docRef = await addDoc(collection(db, 'portal_destinations'), {
    continent:    continentLabel,
    country:      countryPt,
    city:         String(city).trim(),
    continentCode,
    countryCode,
    cityAliases:  [],
    source:       'envision-auto',
    reviewStatus: 'pending',
    envisionLocationId: envisionLocationId || null,
    slug,
    createdAt:    serverTimestamp(),
    createdBy:    opts.actorId || 'system',
    updatedAt:    serverTimestamp(),
    updatedBy:    opts.actorId || 'system',
  });
  return { id: docRef.id, country: countryPt, city, countryCode, continentCode };
}

/**
 * Resolve OU cria destinationId pra par (country, city).
 * Idempotente — chamadas duplicadas retornam o mesmo id.
 *
 * @returns {Promise<string|null>} destinationId ou null se input inválido
 */
export async function resolveOrCreatePendingDestination({ country, city, continent, envisionLocationId, actorId }) {
  if (!country || !city) return null;
  // Tenta achar existente
  const existing = await findDestinationByLabel({ country, city });
  if (existing) return existing.id;
  // Cria pending
  try {
    const created = await createPendingDestination(
      { country, city, continent, envisionLocationId },
      { actorId },
    );
    return created.id;
  } catch (e) {
    console.warn('[geoResolver] createPendingDestination falhou pra', city, '/', country, '—', e?.message);
    return null;
  }
}

/**
 * Helper pra UI: dada uma lista de docs com (country, city), resolve todos
 * em paralelo, retornando { country, city, destinationId, isNew }.
 * Use no editor pra "Vincular destinos automaticamente".
 */
export async function batchResolveDestinations(pairs, opts = {}) {
  const out = [];
  for (const pair of pairs) {
    const existing = await findDestinationByLabel(pair);
    if (existing) {
      out.push({ ...pair, destinationId: existing.id, isNew: false });
    } else if (opts.createPending !== false) {
      const id = await resolveOrCreatePendingDestination({ ...pair, actorId: opts.actorId });
      out.push({ ...pair, destinationId: id, isNew: true });
    } else {
      out.push({ ...pair, destinationId: null, isNew: false });
    }
  }
  return out;
}
