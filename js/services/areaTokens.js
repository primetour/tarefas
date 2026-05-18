/**
 * PRIMETOUR — Area Tokens (4.48.0+ Sprint 6b Phase 3)
 *
 * SSO de IDENTIDADE EDITORIAL pra todos os módulos cliente-facing
 * (Portal de Dicas, Roteiros, + futuros).
 *
 * Por que: até 4.47.x, `portal_areas` armazenava só { name, logoUrl,
 * logoUrlAlt, colors }. Roteiros e Portal renderizam visuais diferentes
 * pra MESMA marca — fontes diferentes, hierarquia diferente. User pediu
 * unificação:
 *
 *     "vamos ter que trabalhar com bastante racional nessa parte,
 *     pra criar uma área de templates de areas que abasteça esses
 *     módulos de forma consistente, editável e escalável"
 *
 * Schema expandido (backward-compatible):
 *
 *   portal_areas/{id} = {
 *     // [legacy — mantido]
 *     name, logoUrl, logoUrlAlt,
 *     colors: { primary, secondary },
 *
 *     // [4.48.0+ Sprint 6b — NOVO]
 *     fonts: {
 *       headline:  'Cormorant Garamond' | 'Playfair Display' | 'Poppins' | 'Inter' | ...,
 *       body:      'Poppins' | 'Inter' | 'Outfit' | ...,
 *       accentScale:'compact' | 'normal' | 'expressive', // tamanho relativo dos títulos
 *     },
 *
 *     editorial: {
 *       voice:        'formal' | 'caloroso' | 'editorial-luxo',
 *       sectionStyle: 'minimalista' | 'revista' | 'documento',
 *       coverStyle:   'fullbleed' | 'centered' | 'side-image',
 *       chromeAccent: 'white' | 'gold-on-dark' | 'primary',  // cor dos overlines/lines no hero
 *     },
 *
 *     modules: {
 *       portal:   { /* overrides específicos pro Portal de Dicas */ },
 *       roteiros: { /* overrides específicos pra Roteiros */ },
 *     },
 *   }
 *
 * Defaults bem pensados — área pode ficar 100% sem essa expansão.
 *
 * Consumers (esperados):
 *   - portal-view.html  → applyAreaTheme()
 *   - roteiro-view.html → applyAreaTheme()
 *   - portalGenerator.js (PDF/PPTX/DOCX) → getAreaFonts() + getAreaTokens()
 *   - roteiroGenerator.js idem
 */

/* ─── Defaults (override do legacy portalTokens.DEFAULT_COLORS) ───── */

export const DEFAULT_AREA_COLORS = {
  primary:   '#475569',  // slate-600
  secondary: '#1F2937',  // gray-800
};

export const DEFAULT_AREA_FONTS = {
  headline:    'Poppins',     // títulos. Igual Portal de Dicas atual.
  body:        'Poppins',     // corpo de texto.
  accentScale: 'normal',
};

export const DEFAULT_AREA_EDITORIAL = {
  voice:        'caloroso',
  sectionStyle: 'revista',
  coverStyle:   'fullbleed',
  // chromeAccent: cor de overlines/lines do hero.
  //   'white'         → texto branco sempre (default — funciona em qualquer hero escuro)
  //   'gold-on-dark'  → usa um amber fixo (#D4A843) independente da marca
  //   'primary'       → usa area.colors.primary (perigoso se primary for dark)
  chromeAccent: 'white',
};

export const DEFAULT_AREA_MODULES = {
  portal:   {},  // Sem overrides — usa defaults globais
  roteiros: {},
};

/* ─── Catálogo de fontes suportadas (UI de edição usa pra dropdown) ── */

export const SUPPORTED_HEADLINE_FONTS = [
  { value: 'Poppins',             label: 'Poppins — sans-serif moderna (default)' },
  { value: 'Inter',               label: 'Inter — sans-serif técnica' },
  { value: 'Cormorant Garamond',  label: 'Cormorant Garamond — serif editorial luxo' },
  { value: 'Playfair Display',    label: 'Playfair Display — serif elegante' },
  { value: 'Outfit',              label: 'Outfit — sans-serif geométrica' },
  { value: 'Montserrat',          label: 'Montserrat — sans-serif urbana' },
];

export const SUPPORTED_BODY_FONTS = [
  { value: 'Poppins',  label: 'Poppins (default)' },
  { value: 'Inter',    label: 'Inter' },
  { value: 'Outfit',   label: 'Outfit' },
  { value: 'Roboto',   label: 'Roboto' },
  { value: 'Lato',     label: 'Lato' },
];

/* ─── Resolvers (uso runtime, sempre safe) ───────────────────────── */

/**
 * Resolve TOKENS COMPLETOS pra uma área, mergeando defaults + module overrides.
 *
 * @param {Object} area - doc da portal_areas (pode estar vazio/parcial)
 * @param {'portal'|'roteiros'|null} moduleKey - se passar, aplica overrides
 * @returns {{colors, fonts, editorial, name, logoUrl, logoUrlAlt}}
 */
export function resolveAreaTokens(area, moduleKey = null) {
  const base = {
    name:        area?.name || 'PRIMETOUR',
    logoUrl:     area?.logoUrl    || null,
    logoUrlAlt:  area?.logoUrlAlt || null,
    colors: {
      primary:   area?.colors?.primary   || DEFAULT_AREA_COLORS.primary,
      secondary: area?.colors?.secondary || DEFAULT_AREA_COLORS.secondary,
    },
    fonts: {
      headline:    area?.fonts?.headline    || DEFAULT_AREA_FONTS.headline,
      body:        area?.fonts?.body        || DEFAULT_AREA_FONTS.body,
      accentScale: area?.fonts?.accentScale || DEFAULT_AREA_FONTS.accentScale,
    },
    editorial: {
      voice:        area?.editorial?.voice        || DEFAULT_AREA_EDITORIAL.voice,
      sectionStyle: area?.editorial?.sectionStyle || DEFAULT_AREA_EDITORIAL.sectionStyle,
      coverStyle:   area?.editorial?.coverStyle   || DEFAULT_AREA_EDITORIAL.coverStyle,
      chromeAccent: area?.editorial?.chromeAccent || DEFAULT_AREA_EDITORIAL.chromeAccent,
    },
  };

  // Module overrides — só aplica se moduleKey for passado E houver overrides
  if (moduleKey && area?.modules?.[moduleKey]) {
    const ov = area.modules[moduleKey];
    if (ov.fonts) {
      if (ov.fonts.headline)    base.fonts.headline    = ov.fonts.headline;
      if (ov.fonts.body)        base.fonts.body        = ov.fonts.body;
      if (ov.fonts.accentScale) base.fonts.accentScale = ov.fonts.accentScale;
    }
    if (ov.editorial) {
      if (ov.editorial.voice)        base.editorial.voice        = ov.editorial.voice;
      if (ov.editorial.sectionStyle) base.editorial.sectionStyle = ov.editorial.sectionStyle;
      if (ov.editorial.coverStyle)   base.editorial.coverStyle   = ov.editorial.coverStyle;
      if (ov.editorial.chromeAccent) base.editorial.chromeAccent = ov.editorial.chromeAccent;
    }
    if (ov.colors) {
      if (ov.colors.primary)   base.colors.primary   = ov.colors.primary;
      if (ov.colors.secondary) base.colors.secondary = ov.colors.secondary;
    }
  }

  return base;
}

/* ─── Helpers de runtime (DOM-side) ──────────────────────────────── */

/**
 * Aplica TEMA COMPLETO (cores + fontes + chrome accent) no <html> via
 * CSS variables. Chamar uma vez no boot do roteiro-view/portal-view.
 *
 * Cria as vars:
 *   --area-primary, --area-secondary (+ -rgb pra alpha)
 *   --area-font-headline, --area-font-body
 *   --area-chrome-accent (cor pra overlines/lines no hero)
 */
export function applyAreaTheme(area, moduleKey = null) {
  if (typeof document === 'undefined') return;
  const t = resolveAreaTokens(area, moduleKey);
  const root = document.documentElement;

  // Cores
  root.style.setProperty('--area-primary',       t.colors.primary);
  root.style.setProperty('--area-secondary',     t.colors.secondary);
  root.style.setProperty('--area-primary-rgb',   _hexToRgbStr(t.colors.primary));
  root.style.setProperty('--area-secondary-rgb', _hexToRgbStr(t.colors.secondary));

  // Fontes
  const headlineStack = `'${t.fonts.headline}', system-ui, sans-serif`;
  const bodyStack     = `'${t.fonts.body}', system-ui, sans-serif`;
  root.style.setProperty('--area-font-headline', headlineStack);
  root.style.setProperty('--area-font-body',     bodyStack);

  // Chrome accent — cor pra overlines/lines no hero (não a brand color que pode ser escura)
  const chromeColor = (() => {
    switch (t.editorial.chromeAccent) {
      case 'gold-on-dark': return '#D4A843';
      case 'primary':      return t.colors.primary;
      case 'white':
      default:             return '#ffffff';
    }
  })();
  root.style.setProperty('--area-chrome-accent', chromeColor);

  // Compat legacy: também seta --portal-* (Portal de Dicas usa essas)
  root.style.setProperty('--portal-primary',     t.colors.primary);
  root.style.setProperty('--portal-secondary',   t.colors.secondary);
  root.style.setProperty('--portal-primary-rgb', _hexToRgbStr(t.colors.primary));
  root.style.setProperty('--portal-secondary-rgb', _hexToRgbStr(t.colors.secondary));

  // Auto-load da fonte se não estiver já carregada (Google Fonts)
  _ensureFontLoaded(t.fonts.headline);
  _ensureFontLoaded(t.fonts.body);
}

/* ─── Helpers privados ───────────────────────────────────────────── */

function _hexToRgbStr(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return '0,0,0';
  return `${parseInt(h.slice(0,2),16)},${parseInt(h.slice(2,4),16)},${parseInt(h.slice(4,6),16)}`;
}

const _loadedFonts = new Set();
function _ensureFontLoaded(family) {
  if (!family || typeof document === 'undefined') return;
  // Cache em-memória + check de <link> existente no head
  if (_loadedFonts.has(family)) return;
  if (document.querySelector(`link[data-area-font="${family}"]`)) {
    _loadedFonts.add(family); return;
  }
  // Família ↦ URL Google Fonts (com weights padrão pra cobrir 300-700)
  const familyParam = family.replace(/\s+/g, '+');
  const url = `https://fonts.googleapis.com/css2?family=${familyParam}:wght@300;400;500;600;700&display=swap`;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  link.dataset.areaFont = family;
  document.head.appendChild(link);
  _loadedFonts.add(family);
}

/* ─── Compat aliases (deprecate gradualmente) ─────────────────────── */

/** @deprecated use resolveAreaTokens(area).colors */
export function getAreaColors(area) {
  return resolveAreaTokens(area).colors;
}

/** @deprecated use resolveAreaTokens(area).fonts */
export function getAreaFonts(area, moduleKey = null) {
  return resolveAreaTokens(area, moduleKey).fonts;
}
