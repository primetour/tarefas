/**
 * PRIMETOUR — Template Adapter (v4.63.11+)
 *
 * Mapeia shapes internos do sistema (roteiro, portal allTips, banco doc)
 * pro schema Handlebars esperado pelos templates uploaded.
 *
 * Mantém sincronia com PLACEHOLDERS_SPEC em js/services/templates.js —
 * quando adicionar campo ali, refletir aqui.
 *
 * Por que adapter centralizado:
 *  - 3 generators × 3 formatos = 9 paths de render. Sem adapter cada um
 *    montaria seu próprio data — drift garantido.
 *  - Mudança no schema interno (ex: roteiro.client → roteiro.cliente)
 *    só requer ajuste aqui, generators não tocam.
 *  - Permite teste isolado do adapter sem rodar CF render.
 */

/* ─── Helpers ─────────────────────────────────────────────────────── */

function _fmtDateBr(val) {
  if (!val) return '';
  if (typeof val === 'string') {
    // YYYY-MM-DD direto (sem timezone — CLAUDE.md §12.a)
    const m = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  try {
    const d = val?.toDate ? val.toDate() : new Date(val);
    return d.toLocaleDateString('pt-BR');
  } catch { return ''; }
}

function _today() {
  return new Date().toLocaleDateString('pt-BR');
}

function _formatCurrency(value, currency = 'BRL') {
  if (value == null || value === '') return '';
  const num = typeof value === 'number' ? value : parseFloat(String(value).replace(/[^\d.,-]/g, '').replace(',', '.'));
  if (isNaN(num)) return String(value);
  try {
    return num.toLocaleString('pt-BR', { style: 'currency', currency });
  } catch {
    return `${currency} ${num.toFixed(2)}`;
  }
}

function _resolveAreaName(area) {
  // brand.useExternalName false → 'PRIMETOUR' (guarda-chuva)
  // true (default) → area.name
  if (area?.brand?.useExternalName === false) return 'PRIMETOUR';
  return area?.name || 'PRIMETOUR';
}

/* ─── Adapter: cotações (roteiroGenerator) ──────────────────────────── */

/**
 * Mapeia roteiro interno → data Handlebars.
 *
 * Roteiro shape (subset):
 *   { title, client: {name, adults, children},
 *     travel: {startDate, endDate, nights, destinations: [{city, country}]},
 *     days: [{dayNumber, date, city, narrative, activities:[{time, description}], overnightCity}],
 *     flights: [{airline, flightNumber, originCity, destinationCity, departureDate, ...}],
 *     hotels:  [{city, hotelName, roomType, regime, nights}],
 *     pricing: {currency, perCouple, perPerson, services:{...}, disclaimer},
 *     includes, excludes, optionals, payment, cancellation, importantInfo, embeddedTips, ... }
 */
export function roteiroToTemplateData(roteiro, area) {
  if (!roteiro) return {};
  const cur = roteiro.pricing?.currency || 'BRL';
  const destinations = (roteiro.travel?.destinations || [])
    .map(d => d.city || d.country).filter(Boolean);

  return {
    titulo: roteiro.title || '',

    area: {
      nome:        _resolveAreaName(area),
      logoUrl:     area?.logoUrl    || '',
      logoUrlAlt:  area?.logoUrlAlt || '',
      corPrimary:  area?.colors?.primary   || '',
      corSecondary: area?.colors?.secondary || '',
    },

    cliente: {
      nome:     roteiro.client?.name     || '',
      adults:   roteiro.client?.adults   || 0,
      children: roteiro.client?.children || 0,
      email:    roteiro.client?.email    || '',
      telefone: roteiro.client?.phone    || '',
    },

    viagem: {
      dataInicio: _fmtDateBr(roteiro.travel?.startDate),
      dataFim:    _fmtDateBr(roteiro.travel?.endDate),
      noites:     roteiro.travel?.nights || 0,
      destinos:   destinations.join(' · '),
      // Array detalhado pra templates que quiserem loop:
      destinosLista: (roteiro.travel?.destinations || []).map(d => ({
        cidade: d.city || '',
        pais:   d.country || '',
      })),
    },

    dias: (roteiro.days || []).map(d => ({
      numero:    d.dayNumber || '',
      data:      _fmtDateBr(d.date),
      cidade:    d.city || '',
      narrativa: d.narrative || '',
      atividades: (d.activities || []).map(a => ({
        hora:      a.time || '',
        descricao: a.description || '',
      })),
      pernoite:  d.overnightCity || '',
    })),

    hoteis: (roteiro.hotels || []).map(h => ({
      cidade:    h.city || '',
      nome:      h.hotelName || '',
      quarto:    h.roomType  || '',
      regime:    h.regime    || '',
      noites:    h.nights    || 0,
      checkIn:   _fmtDateBr(h.checkIn),
      checkOut:  _fmtDateBr(h.checkOut),
    })),

    voos: (roteiro.flights || []).map(f => ({
      cia:           f.airline || '',
      numero:        f.flightNumber || '',
      origem:        f.originCity      || '',
      destino:       f.destinationCity || '',
      rota:          `${f.originCity || ''} → ${f.destinationCity || ''}`,
      dataPartida:   _fmtDateBr(f.departureDate),
      horaPartida:   f.departureTime || '',
      dataChegada:   _fmtDateBr(f.arrivalDate),
      horaChegada:   f.arrivalTime || '',
      classe:        f.class || '',
    })),

    precos: {
      moeda:       cur,
      totalCasal:  _formatCurrency(roteiro.pricing?.perCouple, cur),
      porPessoa:   _formatCurrency(roteiro.pricing?.perPerson, cur),
      disclaimer:  roteiro.pricing?.disclaimer || '',
      // Numérico bruto pra templates que querem fazer cálculo próprio
      _raw: {
        perCouple: roteiro.pricing?.perCouple || 0,
        perPerson: roteiro.pricing?.perPerson || 0,
      },
    },

    inclui:    Array.isArray(roteiro.includes) ? roteiro.includes : [],
    naoInclui: Array.isArray(roteiro.excludes) ? roteiro.excludes : [],

    opcionais: (roteiro.optionals || []).map(o => ({
      servico:      o.service || '',
      precoAdulto:  o.priceAdult != null ? _formatCurrency(o.priceAdult, cur) : '',
      precoCrianca: o.priceChild != null ? _formatCurrency(o.priceChild, cur) : '',
      observacoes:  o.notes || '',
    })),

    pagamento: roteiro.payment || {},
    cancelamento: roteiro.cancellation || [],
    informacoes: roteiro.importantInfo || {},

    today: _today(),
  };
}

/* ─── Adapter: portal de dicas ──────────────────────────────────────── */

/**
 * Mapeia allTips (array de {tip, dest}) → data Handlebars pra templates
 * do Portal de Dicas.
 */
export function portalToTemplateData({ allTips, area, segments, areaName } = {}) {
  return {
    area: {
      nome:       areaName || _resolveAreaName(area),
      logoUrl:    area?.logoUrl    || '',
      logoUrlAlt: area?.logoUrlAlt || '',
    },
    destinos: (allTips || []).map(({ tip, dest }) => ({
      id:     dest?.id || '',
      cidade: dest?.city || '',
      pais:   dest?.country || '',
      label:  [dest?.city, dest?.country].filter(Boolean).join(', '),
      tips:   tip ? [tip] : [],   // adaptar shape quando templates pedirem
      // Preservar segments configurados nesse tip pra templates avançados
      segments: tip?.segments || {},
    })),
    segments: Array.isArray(segments) ? segments : [],
    today:   _today(),
  };
}

/* ─── Adapter: banco de roteiros ────────────────────────────────────── */

/**
 * Mapeia doc do banco de roteiros → data Handlebars.
 * Banco doc tem shape semelhante a roteiro mas com algumas diferenças
 * (categories[].hotels[] em vez de hotels[] direto, etc).
 */
export function bancoToTemplateData(bankDoc, area) {
  if (!bankDoc) return {};

  // Flatten hotels: bank.categories[].hotels[] → hoteis[]
  const hoteis = [];
  (bankDoc.categories || []).forEach(cat => {
    (cat.hotels || []).forEach(h => {
      hoteis.push({
        cidade: h.city || cat.city || '',
        nome:   h.name || h.hotelName || '',
        regime: h.regime || '',
        noites: h.nights || 0,
      });
    });
  });

  return {
    titulo: bankDoc.title || '',

    area: {
      nome:        _resolveAreaName(area),
      logoUrl:     area?.logoUrl    || '',
      logoUrlAlt:  area?.logoUrlAlt || '',
    },

    viagem: {
      noites:   bankDoc.nights || bankDoc.duration?.nights || 0,
      destinos: (bankDoc.destinations || []).map(d => d.city || d.country).filter(Boolean).join(' · '),
    },

    dias: (bankDoc.days || []).map((d, i) => ({
      numero:    d.dayNumber || (i + 1),
      cidade:    d.city || '',
      narrativa: d.narrative || d.description || '',
    })),

    hoteis,

    inclui:    Array.isArray(bankDoc.includes) ? bankDoc.includes : [],
    naoInclui: Array.isArray(bankDoc.excludes) ? bankDoc.excludes : [],

    today: _today(),
  };
}

/* ─── Resolver: pega template ref + format pra um módulo ────────────── */

/**
 * Retorna { templateId, format } pra usar com renderTemplate, ou null
 * se área não tem template configurado pra esse módulo+formato.
 *
 * @param {Object} area
 * @param {'cotacoes'|'portal'|'banco-roteiros'} module
 * @param {'html'|'docx'|'pptx'} format
 */
export function resolveTemplateRef(area, module, format) {
  const id = area?.templateRefs?.[module]?.[format];
  return id ? { templateId: id, format } : null;
}
