/**
 * PRIMETOUR — Portal de Dicas / City Guides
 * Tokens compartilhados (versão JS, espelha css/portal-tokens.css).
 *
 * Web (link)  → consome via CSS variables (portal-tokens.css)
 * PDF/DOCX    → consome via este módulo (escala em mm pra papel)
 *
 * O segredo é a IDENTIDADE COMPARTILHADA: cores da área e proporções
 * tipográficas ficam coerentes entre canais.
 */

/* ─── Paleta default (sobrescrita pelo area.colors) ─────────── */
export const DEFAULT_COLORS = {
  primary:   '#475569',  // slate-600
  secondary: '#1F2937',  // gray-800
};

/* Resolve cores: aceita area inteiro ou { primary, secondary } */
export function getPortalColors(area) {
  return {
    primary:   area?.colors?.primary   || area?.primary   || DEFAULT_COLORS.primary,
    secondary: area?.colors?.secondary || area?.secondary || DEFAULT_COLORS.secondary,
  };
}

/**
 * Aplica as cores da área no <html> via CSS variables.
 * Chamar uma vez no boot do portal-view.html depois de carregar o link.
 */
export function applyPortalTheme(area) {
  if (typeof document === 'undefined') return;
  const c = getPortalColors(area);
  const root = document.documentElement;
  root.style.setProperty('--portal-primary',   c.primary);
  root.style.setProperty('--portal-secondary', c.secondary);
  // RGB para usos com alpha: rgba(var(--portal-primary-rgb), .5)
  root.style.setProperty('--portal-primary-rgb',   hexToRgbStr(c.primary));
  root.style.setProperty('--portal-secondary-rgb', hexToRgbStr(c.secondary));
}

function hexToRgbStr(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return '0,0,0';
  return `${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)}`;
}

/* ─── Tokens em UNIDADES DE PAPEL (mm) — usado pelo PDF ────────
 * Mapeamento da escala rem (web) pra mm (PDF). 1rem ≈ 4mm em A4.
 * Mantém proporções similares entre os dois canais.
 */
export const PDF_TOKENS = {
  // Tipografia (jsPDF font sizes — pontos)
  fs: {
    xs:    7,
    sm:    8,
    base:  9,
    md:   10,
    lg:   13,
    xl:   16,
    '2xl': 20,
    hero: 28,
  },
  // Espaçamento em mm
  space: {
    1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 8: 8, 10: 10, 12: 12, 16: 16,
  },
  // Margens da página A4
  page: {
    margin:    16,    // mm
    contentW: 178,    // 210 - 16*2
    height:   297,
    width:    210,
  },
  // Radius em mm
  radius: {
    sm: 1, md: 2, lg: 4, pill: 999,
  },
};
