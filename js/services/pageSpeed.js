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

/* ─── Extrai auditorias SEO que falharam ─────────────────── */
function extractFailedSeoAudits(lh) {
  if (!lh?.audits || !lh?.categories?.seo) return [];
  const refs = lh.categories.seo.auditRefs || [];
  const fails = [];
  for (const ref of refs) {
    const audit = lh.audits[ref.id];
    if (!audit) continue;
    // score === null → informativo (não conta); score < 1 → falhou; score === 1 → ok
    if (audit.score !== null && audit.score < 1) {
      fails.push({
        id:          ref.id,
        title:       audit.title,
        description: audit.description,
        score:       audit.score,
        displayValue:audit.displayValue || '',
      });
    }
  }
  return fails;
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

  let resp;
  try {
    resp = await fetch(endpoint);
  } catch (e) {
    throw new Error(`Falha de rede ao chamar PSI API: ${e.message}`);
  }

  if (!resp.ok) {
    let errMsg = `PSI API retornou HTTP ${resp.status}`;
    try {
      const errBody = await resp.json();
      if (errBody?.error?.message) errMsg += ` — ${errBody.error.message}`;
    } catch (_) {}
    throw new Error(errMsg);
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
    seoFails:     extractFailedSeoAudits(lh),
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
