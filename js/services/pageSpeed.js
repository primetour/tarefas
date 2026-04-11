/**
 * PRIMETOUR — PageSpeed Insights API Wrapper
 * Roda auditorias CWV + SEO via PSI API v5 e retorna um payload
 * condensado pronto para exibição / persistência.
 *
 * Docs: https://developers.google.com/speed/docs/insights/v5/get-started
 */

/* ─── Thresholds oficiais do Google (2024+) ──────────────── */
// https://web.dev/articles/vitals
const CWV_THRESHOLDS = {
  lcp:  { good: 2500,  ni: 4000  },   // ms
  inp:  { good: 200,   ni: 500   },   // ms
  cls:  { good: 0.1,   ni: 0.25  },   // score
  fcp:  { good: 1800,  ni: 3000  },   // ms
  ttfb: { good: 800,   ni: 1800  },   // ms
};

export const CWV_LABELS = {
  lcp:  { label: 'LCP',  full: 'Largest Contentful Paint',  unit: 'ms',
          info: 'Tempo até o maior elemento visível carregar. Mede a percepção de velocidade.' },
  inp:  { label: 'INP',  full: 'Interaction to Next Paint', unit: 'ms',
          info: 'Latência da interação do usuário. Substituiu o FID em março/2024.' },
  cls:  { label: 'CLS',  full: 'Cumulative Layout Shift',   unit: '',
          info: 'Instabilidade visual: quanto o layout se desloca durante o carregamento.' },
  fcp:  { label: 'FCP',  full: 'First Contentful Paint',    unit: 'ms',
          info: 'Tempo até o primeiro conteúdo aparecer na tela.' },
  ttfb: { label: 'TTFB', full: 'Time To First Byte',        unit: 'ms',
          info: 'Tempo até o servidor começar a responder.' },
};

export const CATEGORY_COLORS = {
  FAST:              '#22C55E',
  AVERAGE:           '#F59E0B',
  NEEDS_IMPROVEMENT: '#F59E0B',
  SLOW:              '#EF4444',
};

/* ─── Classifica valor bruto em FAST/NI/SLOW ─────────────── */
function classify(metric, value) {
  if (value == null || Number.isNaN(value)) return 'SLOW';
  const t = CWV_THRESHOLDS[metric];
  if (!t) return 'AVERAGE';
  if (value <= t.good) return 'FAST';
  if (value <= t.ni)   return 'AVERAGE';
  return 'SLOW';
}

/* ─── Parser de field data (CrUX / loadingExperience) ────── */
function parseFieldMetrics(fieldExp) {
  if (!fieldExp?.metrics) return null;
  const m = fieldExp.metrics;
  const pick = (key) => m[key] ? {
    value:    m[key].percentile,
    category: m[key].category,
  } : null;

  // CrUX usa CLS x100 (para caber em int). Dividimos.
  const clsRaw = m['CUMULATIVE_LAYOUT_SHIFT_SCORE'];
  const cls = clsRaw ? {
    value:    clsRaw.percentile / 100,
    category: clsRaw.category,
  } : null;

  return {
    lcp:  pick('LARGEST_CONTENTFUL_PAINT_MS'),
    inp:  pick('INTERACTION_TO_NEXT_PAINT') || pick('INP'),
    cls,
    fcp:  pick('FIRST_CONTENTFUL_PAINT_MS'),
    ttfb: pick('EXPERIMENTAL_TIME_TO_FIRST_BYTE'),
  };
}

/* ─── Parser de lab data (Lighthouse audits) ─────────────── */
function parseLabMetrics(lh) {
  if (!lh?.audits) return null;
  const a = lh.audits;
  const n = (id) => a[id]?.numericValue ?? null;
  return {
    lcp:  n('largest-contentful-paint'),
    // Lighthouse lab não tem INP real — usa TBT (Total Blocking Time) como proxy
    inp:  n('interaction-to-next-paint') ?? n('total-blocking-time'),
    cls:  n('cumulative-layout-shift'),
    fcp:  n('first-contentful-paint'),
    ttfb: n('server-response-time'),
  };
}

/* ─── Combina field + lab priorizando field ──────────────── */
function buildCwv(fieldExp, lh) {
  const field = parseFieldMetrics(fieldExp);
  const lab   = parseLabMetrics(lh);

  // Prefere field quando disponível; senão lab com classificação manual
  const out = {};
  const keys = ['lcp', 'inp', 'cls', 'fcp', 'ttfb'];
  for (const k of keys) {
    if (field && field[k]) {
      out[k] = field[k]; // { value, category } já classificado pelo CrUX
    } else if (lab && lab[k] != null) {
      out[k] = {
        value:    lab[k],
        category: classify(k, lab[k]),
      };
    } else {
      out[k] = { value: null, category: null };
    }
  }
  return {
    metrics: out,
    source:  field ? 'field' : 'lab',
  };
}

/* ─── Normaliza items do details para salvar (top N, campos úteis) ── */
function normalizeAuditItems(details, maxItems = 5) {
  if (!details?.items || !Array.isArray(details.items)) return [];
  return details.items.slice(0, maxItems).map(item => {
    const out = {};
    // Campos comuns em auditorias de performance
    if (item.url)              out.url          = String(item.url).slice(0, 300);
    if (item.source?.url)      out.url          = String(item.source.url).slice(0, 300);
    if (item.totalBytes != null)   out.totalBytes   = item.totalBytes;
    if (item.wastedBytes != null)  out.wastedBytes  = item.wastedBytes;
    if (item.wastedMs != null)     out.wastedMs     = item.wastedMs;
    if (item.wastedPercent != null) out.wastedPercent = Math.round(item.wastedPercent);
    // Campos de a11y/SEO (nó do DOM)
    if (item.node?.snippet)    out.snippet      = String(item.node.snippet).slice(0, 300);
    if (item.node?.selector)   out.selector     = String(item.node.selector).slice(0, 200);
    if (item.node?.nodeLabel)  out.nodeLabel    = String(item.node.nodeLabel).slice(0, 200);
    // Campos de terceiros/rede
    if (item.entity)           out.entity       = String(item.entity).slice(0, 120);
    if (item.transferSize != null) out.transferSize = item.transferSize;
    if (item.mainThreadTime != null) out.mainThreadTime = item.mainThreadTime;
    if (item.blockingTime != null)   out.blockingTime   = item.blockingTime;
    // Tempo genérico
    if (item.duration != null) out.duration     = item.duration;
    if (item.startTime != null) out.startTime   = item.startTime;
    return out;
  });
}

/* ─── Extrai auditorias falhas de uma categoria qualquer ─── */
function extractCategoryFails(lh, categoryKey, opts = {}) {
  const { includeInformative = false, includePassed = false, maxItems = 5 } = opts;
  if (!lh?.audits || !lh?.categories?.[categoryKey]) return [];
  const refs = lh.categories[categoryKey].auditRefs || [];
  const fails = [];
  for (const ref of refs) {
    const audit = lh.audits[ref.id];
    if (!audit) continue;
    // score === null → informativo/diagnóstico
    // score < 1 → falhou
    // score === 1 → passou
    if (audit.score === null) {
      if (!includeInformative) continue;
    } else if (audit.score >= 1) {
      if (!includePassed) continue;
    }
    const numericValue = audit.numericValue ?? null;
    const savingsMs    = audit.details?.overallSavingsMs    ?? audit.metricSavings?.LCP ?? null;
    const savingsBytes = audit.details?.overallSavingsBytes ?? null;

    fails.push({
      id:            ref.id,
      group:         ref.group || null,
      weight:        ref.weight ?? 0,
      title:         audit.title || '',
      description:   audit.description || '',
      displayValue:  audit.displayValue || '',
      score:         audit.score,
      scoreDisplayMode: audit.scoreDisplayMode || '',
      numericValue,
      savingsMs,
      savingsBytes,
      items:         normalizeAuditItems(audit.details, maxItems),
    });
  }
  return fails;
}

/* ─── Extrai oportunidades de performance (opportunity + diagnostic) ── */
function extractOpportunities(lh) {
  if (!lh?.audits || !lh?.categories?.performance) return [];
  const refs = lh.categories.performance.auditRefs || [];
  const opps = [];
  for (const ref of refs) {
    const audit = lh.audits[ref.id];
    if (!audit) continue;
    const mode = audit.scoreDisplayMode;
    // 'numeric' e 'binary' com score < 1 são oportunidades reais
    if (mode !== 'numeric' && mode !== 'binary') continue;
    if (audit.score === null || audit.score >= 0.9) continue;

    const savingsMs    = audit.details?.overallSavingsMs    ?? 0;
    const savingsBytes = audit.details?.overallSavingsBytes ?? 0;

    opps.push({
      id:           ref.id,
      group:        ref.group || 'diagnostic',
      weight:       ref.weight ?? 0,
      title:        audit.title || '',
      description:  audit.description || '',
      displayValue: audit.displayValue || '',
      score:        audit.score,
      savingsMs,
      savingsBytes,
      items:        normalizeAuditItems(audit.details, 5),
    });
  }
  // Ordena por savingsMs desc, depois por (1 - score) desc
  opps.sort((a, b) => (b.savingsMs - a.savingsMs) || ((1 - a.score) - (1 - b.score)));
  return opps;
}

/* ─── Extrai diagnósticos-chave (elementos LCP, CLS, third-party) ── */
function extractDiagnostics(lh) {
  if (!lh?.audits) return {};
  const a = lh.audits;
  const pick = (id, maxItems = 8) => {
    const au = a[id];
    if (!au) return null;
    return {
      title:        au.title || '',
      displayValue: au.displayValue || '',
      items:        normalizeAuditItems(au.details, maxItems),
    };
  };
  return {
    lcpElement:        pick('largest-contentful-paint-element', 1),
    layoutShiftEls:    pick('layout-shift-elements', 5),
    longTasks:         pick('long-tasks', 5),
    mainthreadBreakdown: pick('mainthread-work-breakdown', 5),
    bootupTime:        pick('bootup-time', 5),
    thirdParty:        pick('third-party-summary', 8),
    networkRtt:        pick('network-rtt', 1),
    networkServerLatency: pick('network-server-latency', 1),
  };
}

/* ─── Extrai scores das 4 categorias ─────────────────────── */
function extractScores(lh) {
  if (!lh?.categories) return { performance: null, accessibility: null, bestPractices: null, seo: null };
  const c = lh.categories;
  const toPct = (v) => (v == null ? null : Math.round(v * 100));
  return {
    performance:   toPct(c['performance']?.score),
    accessibility: toPct(c['accessibility']?.score),
    bestPractices: toPct(c['best-practices']?.score),
    seo:           toPct(c['seo']?.score),
  };
}

/* ─── Chama a PSI API e retorna payload condensado ───────── */
export async function runPageSpeedAudit(url, strategy, apiKey) {
  if (!url)      throw new Error('URL obrigatória.');
  if (!strategy) strategy = 'mobile';
  if (!apiKey)   throw new Error('API key do PageSpeed Insights não configurada. Acesse Configurações → Integrações.');
  if (!['mobile', 'desktop'].includes(strategy)) {
    throw new Error(`Strategy inválida: ${strategy}`);
  }

  const params = new URLSearchParams({
    url,
    strategy,
    key: apiKey,
  });
  // category param aceita repetição — não dá pra usar URLSearchParams direto pra isso
  const categoryParams = ['performance', 'accessibility', 'best-practices', 'seo']
    .map(c => `category=${c}`).join('&');

  const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}&${categoryParams}`;
  // Log sem a key (para debug sem vazar credencial)
  const safeEndpoint = endpoint.replace(/key=[^&]+/, 'key=***');
  console.log('[PSI] request →', safeEndpoint);

  let resp;
  try {
    resp = await fetch(endpoint);
  } catch (e) {
    console.error('[PSI] network error', e);
    throw new Error(`Falha de rede ao chamar PSI API: ${e.message}`);
  }

  if (!resp.ok) {
    let errBody = null;
    try { errBody = await resp.json(); } catch (_) {}
    console.error('[PSI] HTTP', resp.status, errBody);

    const gmsg = errBody?.error?.message || '';
    let hint = '';
    if (resp.status === 400) {
      if (/API key not valid/i.test(gmsg)) {
        hint = ' — Verifique: (1) a key está correta; (2) a API "PageSpeed Insights API" está HABILITADA no projeto do Google Cloud; (3) restrições HTTP referrer incluem este domínio.';
      } else if (/referer/i.test(gmsg) || /restricted/i.test(gmsg)) {
        hint = ` — Origem bloqueada. Adicione "${location.origin}/*" nas restrições HTTP referrer da key no Google Cloud Console.`;
      }
    } else if (resp.status === 403) {
      hint = ' — API não habilitada ou key sem acesso. No Google Cloud: APIs & Services → Library → habilitar "PageSpeed Insights API".';
    } else if (resp.status === 429) {
      hint = ' — Quota excedida (limite gratuito: 25.000/dia, 240/min).';
    }
    throw new Error(`PSI HTTP ${resp.status}${gmsg ? ' — ' + gmsg : ''}${hint}`);
  }

  const json = await resp.json();
  const lh   = json.lighthouseResult;
  const fieldExp = json.loadingExperience;

  const cwv = buildCwv(fieldExp, lh);
  return {
    url:          json.id || url,
    strategy,
    runAtClient:  new Date().toISOString(),
    scores:       extractScores(lh),
    cwv:          cwv.metrics,
    cwvSource:    cwv.source,
    // Oportunidades e diagnósticos de performance
    opportunities: extractOpportunities(lh),
    diagnostics:   extractDiagnostics(lh),
    // Falhas das outras categorias
    seoFails:      extractCategoryFails(lh, 'seo',            { maxItems: 5 }),
    a11yFails:     extractCategoryFails(lh, 'accessibility',  { maxItems: 5 }),
    bpFails:       extractCategoryFails(lh, 'best-practices', { maxItems: 5 }),
    lhVersion:    lh?.lighthouseVersion || null,
    fetchTime:    lh?.fetchTime || null,
    finalUrl:     lh?.finalUrl || url,
  };
}

/* ─── Helper: roda mobile e desktop em paralelo ──────────── */
export async function runFullAudit(url, apiKey) {
  const [mobile, desktop] = await Promise.all([
    runPageSpeedAudit(url, 'mobile',  apiKey),
    runPageSpeedAudit(url, 'desktop', apiKey),
  ]);
  return { mobile, desktop };
}
