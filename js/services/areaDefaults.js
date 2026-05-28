/**
 * v4.62.39+ (Fase A.3) — SSOT de defaults de áreas/templates.
 *
 * ÚNICA fonte de verdade pra valores default usados em qualquer generator
 * (PDF/DOCX/PPTX/Web link) de qualquer módulo (Portal de Dicas / Roteiros
 * / Banco de Roteiros / Cotações).
 *
 * ANTES (v4.62.38-):
 *   - portalTokens.DEFAULT_COLORS    = { primary:'#475569', secondary:'#1F2937' }
 *   - areaTokens.DEFAULT_AREA_COLORS = { primary:'#475569', secondary:'#1F2937' }
 *   - roteiroGenerator.js PDF:    primary='#475569', secondary='#0F172A'  ← gray-900
 *   - roteiroGenerator.js DOCX:   primary='#0F172A', secondary='#475569'  ← INVERTIDO (drift D6)
 *   - roteiroGenerator.js PPTX:   primary='#475569', secondary='#0F172A'
 *   - portalGenerator.js DOCX/PDF/PPTX: lê de portalTokens.PORTAL_DEFAULT_COLORS
 *   - 60+ literais `font:'Poppins'` espalhados em portalGenerator + roteiroGenerator
 *
 * AGORA (v4.62.39+):
 *   - ROOT_DEFAULTS é a única fonte. Os outros arquivos importam daqui.
 *   - Mudou um default? Mudou em TODOS os exports de TODOS os módulos.
 *
 * Não dependa de framework — pure exports. Funciona em browser ESM e Node.
 */

/* ═══ COLORS ═══════════════════════════════════════════════════════════
 *
 * SECONDARY normalizado pra gray-800 (#1F2937), que combina com slate-600
 * (#475569) como primary. Antes o roteiroGenerator usava gray-900 (#0F172A)
 * — escuro demais pra alguns layouts. Unificado pro mais conservador.
 *
 * Áreas configuradas (portal_areas.colors.primary/secondary) sobrescrevem
 * esses defaults sempre.
 */
export const DEFAULT_COLORS = {
  primary:   '#475569',  // slate-600 — tom institucional padrão
  secondary: '#1F2937',  // gray-800 — texto/headers escuros
};

/* ═══ FONTS ════════════════════════════════════════════════════════════
 *
 * Default = Poppins (sans-serif moderna, neutra). Áreas premium podem
 * sobrescrever via portal_areas.fonts pra Cormorant Garamond, Playfair etc.
 *
 * IMPORTANTE: até v4.62.39, fonts.headline/body são USADOS APENAS no
 * web link (applyAreaTheme via CSS vars). PDF/DOCX/PPTX continuam Poppins
 * hardcoded — fix em Fase C (carregar TTF dinâmico).
 */
export const DEFAULT_FONTS = {
  headline:    'Poppins',
  body:        'Poppins',
  accentScale: 'normal',  // 'compact' | 'normal' | 'expressive' (futuro consumer)
};

/* ═══ EDITORIAL ════════════════════════════════════════════════════════
 *
 * voice         — tom da IA quando gerar conteúdo (consumer futuro Fase D)
 * sectionStyle  — layout de seções no PDF (consumer futuro Fase E)
 * coverStyle    — estilo da capa (consumer futuro Fase E)
 * chromeAccent  — cor de overlines/lines do hero
 *                 'white'        → branco sempre (default — funciona em qualquer hero escuro)
 *                 'gold-on-dark' → amber fixo (#D4A843) independente da marca
 *                 'primary'      → usa area.colors.primary (perigoso se primary for dark)
 */
export const DEFAULT_EDITORIAL = {
  voice:        'caloroso',     // 'formal' | 'caloroso' | 'editorial-luxo'
  sectionStyle: 'revista',      // 'minimalista' | 'revista' | 'documento'
  coverStyle:   'fullbleed',    // 'fullbleed' | 'centered' | 'side-image'
  chromeAccent: 'white',        // 'white' | 'gold-on-dark' | 'primary'
};

/* ═══ BRAND ════════════════════════════════════════════════════════════
 *
 * externalName — nome exibido pro CLIENTE final em capas de PDF, footer
 * de web link etc. Default 'PRIMETOUR' (marca guarda-chuva).
 *
 * v4.62.40 (Fase B) — quando area.brand.useExternalName = true (toggle
 * na UI por área), o generator usa area.name (ex: "BTG Partners") em vez
 * de "PRIMETOUR". Antes (v4.62.38-): hardcoded 'PRIMETOUR' em
 * roteiroGenerator (l.777) e fallback em portalGenerator.
 */
export const DEFAULT_BRAND = {
  externalName:     'PRIMETOUR',
  useExternalName:  true,   // se false → usa area.name como branding externo
};

/* ═══ EXPORTS por formato (Fase E — v4.62.43) ═════════════════════════
 *
 * Templates editáveis por formato e por módulo. Cada formato tem overrides
 * próprios. Persistidos em area.modules[moduleKey].exports[format] e
 * acessados via resolveExportTemplate(area, moduleKey, format).
 *
 * Campos suportados (todos opcionais — fallback pros defaults daqui):
 *   footerText   string  — texto rodapé. Suporta {placeholders}: {areaName},
 *                          {today}, {clientName}, {title}. Multi-linha (\n).
 *   headerText   string  — texto adicional no header (small print).
 *   hideCover    boolean — desliga a capa do PDF/PPTX (export compacto).
 *   coverStyle   string  — 'fullbleed' | 'centered' | 'minimal' (futuro)
 *   pageMargins  number  — margens em mm (PDF — futuro)
 *
 * Defaults vazios = generator usa o que sempre usou (texto hardcoded
 * antigo). Backward-compat 100%.
 */
export const DEFAULT_EXPORTS = {
  pdf:  { footerText: '', headerText: '', hideCover: false },
  docx: { footerText: '', headerText: '', hideCover: false },
  pptx: { footerText: '', headerText: '', hideCover: false },
  web:  { footerText: '', headerText: '', hideCover: false },
};

/**
 * Resolve overrides do template de export pra um (area, módulo, formato).
 *
 * Ordem de precedência (mais específico vence):
 *   1. area.modules[moduleKey].exports[format].field
 *   2. DEFAULT_EXPORTS[format].field
 *
 * Suporta placeholders no footerText/headerText via formatExportText().
 *
 * Use sempre antes de renderizar rodapé/header — generators NÃO devem
 * acessar area.modules diretamente, pra evitar drift.
 */
export function resolveExportTemplate(area, moduleKey, format) {
  const fmt = (area?.modules?.[moduleKey]?.exports?.[format]) || {};
  return {
    ...(DEFAULT_EXPORTS[format] || {}),
    ...fmt,
  };
}

/**
 * Substitui placeholders {areaName}, {today}, {clientName}, {title} no texto.
 * Aceita Date object ou string ISO em today; default = data de hoje.
 * Retorna '' se text vazio.
 */
export function formatExportText(text, ctx = {}) {
  if (!text) return '';
  const today = ctx.today instanceof Date
    ? ctx.today.toLocaleDateString('pt-BR', { year:'numeric', month:'long', day:'numeric' })
    : (ctx.today || new Date().toLocaleDateString('pt-BR', { year:'numeric', month:'long', day:'numeric' }));
  return String(text)
    .replace(/\{areaName\}/g,   ctx.areaName   || '')
    .replace(/\{today\}/g,      today)
    .replace(/\{clientName\}/g, ctx.clientName || '')
    .replace(/\{title\}/g,      ctx.title      || '');
}

/* ═══════════════════════════════════════════════════════════════════════
 * Helper: deep-merge defaults com overrides da área (e do módulo).
 *
 * Ordem de precedência (mais específico vence):
 *   1. area.modules[moduleKey].colors/fonts/editorial
 *   2. area.colors/fonts/editorial
 *   3. ROOT defaults daqui
 *
 * Use sempre que precisar resolver tokens — evita ler campos individuais
 * com optional chaining espalhado pelo code.
 * ═══════════════════════════════════════════════════════════════════════ */
export function resolveAreaDefaults(area, moduleKey = null) {
  const a = area || {};
  const m = (moduleKey && a.modules?.[moduleKey]) || {};
  return {
    colors: {
      ...DEFAULT_COLORS,
      ...(a.colors || {}),
      ...(m.colors || {}),
    },
    fonts: {
      ...DEFAULT_FONTS,
      ...(a.fonts || {}),
      ...(m.fonts || {}),
    },
    editorial: {
      ...DEFAULT_EDITORIAL,
      ...(a.editorial || {}),
      ...(m.editorial || {}),
    },
    brand: {
      ...DEFAULT_BRAND,
      ...(a.brand || {}),
    },
    logo: {
      dark: a.logoUrl    || null,
      alt:  a.logoUrlAlt || null,
    },
    name: a.name || DEFAULT_BRAND.externalName,
  };
}

/**
 * Helper: retorna o nome a exibir externamente (cliente) considerando
 * o toggle area.brand.useExternalName.
 *
 *   useExternalName = false → 'PRIMETOUR' (guarda-chuva)
 *   useExternalName = true  → area.name (ex: 'BTG Partners')
 *   sem área                → 'PRIMETOUR'
 *
 * Default = true (mostra nome da área) pra ser consistente com Portal
 * de Dicas que sempre mostrou. Cotações antigamente forçavam 'PRIMETOUR'
 * — agora respeita o toggle.
 */
export function resolveExternalBrandName(area) {
  const resolved = resolveAreaDefaults(area);
  if (resolved.brand.useExternalName === false) return DEFAULT_BRAND.externalName;
  return area?.name || DEFAULT_BRAND.externalName;
}
