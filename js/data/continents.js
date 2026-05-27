/**
 * PRIMETOUR — Continentes (SSOT geográfico)
 *
 * Lista HARDCODED dos 7 continentes do modelo geográfico canônico.
 * Use os `code` (2 letras) como chave estável em todos os módulos
 * (banco de roteiros, banco de imagens, portal de dicas, gerador, destinos).
 *
 * Códigos seguem a convenção UN M.49 / continental codes:
 *   AF  África
 *   AN  Antártida
 *   AS  Ásia
 *   EU  Europa
 *   NA  América do Norte
 *   OC  Oceania
 *   SA  América do Sul
 *
 * Cuidados:
 *   - NÃO ALTERAR códigos (são FK estável em portal_destinations/cidades).
 *   - Renomear `pt` é seguro (label cosmético). Adicionar continente novo
 *     NÃO faz sentido (lista é fechada).
 *   - Para a UI, sempre filtrar/exibir por `code` e renderizar via `pt`.
 *
 * Fonte: criado em 2026-05-26 (sprint v4.59 — Geography SSOT).
 */

export const CONTINENTS = Object.freeze([
  { code: 'AF', pt: 'África',           en: 'Africa' },
  { code: 'AN', pt: 'Antártida',        en: 'Antarctica' },
  { code: 'AS', pt: 'Ásia',             en: 'Asia' },
  { code: 'EU', pt: 'Europa',           en: 'Europe' },
  { code: 'NA', pt: 'América do Norte', en: 'North America' },
  { code: 'OC', pt: 'Oceania',          en: 'Oceania' },
  { code: 'SA', pt: 'América do Sul',   en: 'South America' },
]);

/** Mapa code → entry pra lookup O(1). */
export const CONTINENTS_BY_CODE = Object.freeze(
  Object.fromEntries(CONTINENTS.map(c => [c.code, c]))
);

/**
 * Mapa nome pt-BR (lowercase, sem acento) → code pra normalizar
 * inputs legados (`portal_destinations.continent` que hoje é string pt).
 */
const _ptToCode = {
  'africa': 'AF', 'áfrica': 'AF',
  'antartida': 'AN', 'antártida': 'AN', 'antartica': 'AN', 'antártica': 'AN',
  'asia': 'AS', 'ásia': 'AS',
  'europa': 'EU',
  'america do norte': 'NA', 'américa do norte': 'NA',
  'oceania': 'OC',
  'america do sul': 'SA', 'américa do sul': 'SA',
  // Aliases comuns (en, abreviações):
  'africa ': 'AF',
  'north america': 'NA',
  'south america': 'SA',
  'europe': 'EU',
  'asia ': 'AS',
};

/**
 * Resolve um label arbitrário ("África", "America do Sul", "EU") → code canônico.
 * Retorna null se não bater nada.
 */
export function continentCodeFromLabel(input) {
  if (!input || typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  // Já é code?
  const up = raw.toUpperCase();
  if (CONTINENTS_BY_CODE[up]) return up;
  // Por nome:
  const key = raw.toLowerCase().trim();
  return _ptToCode[key] || null;
}

/** Helper inverso pra UI: code → label pt-BR (ou fallback). */
export function continentLabel(code) {
  return CONTINENTS_BY_CODE[code]?.pt || '';
}
