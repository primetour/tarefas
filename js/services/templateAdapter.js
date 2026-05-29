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

/* ─── Tip segment shaping (compartilhado portal ↔ cotações) ───────────
   v4.63.84: extraído de portalToTemplateData pra ser reusado tb por
   roteiroToTemplateData (dicas embedadas na cotação). Antes a cotação não
   tinha NENHUM mapping de embeddedTips no path HTML → dicas eram dropadas
   silenciosamente (Renê 29/05: "toda a parte das dicas... está muito cru").

   `selection` (opcional) cura o que entra: { [segKey]: true | number[] }
   - ausente/null → inclui TUDO (comportamento legado)
   - segKey ausente OU false → segmento excluído
   - segKey === true → todos os itens do segmento
   - segKey === number[] → só os itens nesses índices (índices do array RAW,
     incluindo subtítulos). Permite o consultor escolher subset (ex: 8 de 64
     restaurantes) sem editar o snapshot. */
const SEGMENT_DEFS = [
  { key: 'informacoes_gerais',  label: 'Informações Gerais',     mode: 'special_info' },
  { key: 'bairros',             label: 'Bairros',                mode: 'simple_list' },
  { key: 'atracoes',            label: 'Atrações',               mode: 'place_list' },
  { key: 'atracoes_criancas',   label: 'Atrações para Crianças', mode: 'place_list' },
  { key: 'restaurantes',        label: 'Restaurantes',           mode: 'place_list' },
  { key: 'vida_noturna',        label: 'Vida Noturna',           mode: 'place_list' },
  { key: 'espetaculos',         label: 'Espetáculos & Teatros',  mode: 'place_list' },
  { key: 'compras',             label: 'Compras',                mode: 'place_list' },
  { key: 'arredores',           label: 'Arredores',              mode: 'simple_list' },
  { key: 'highlights',          label: 'Highlights',             mode: 'place_list' },
  { key: 'agenda_cultural',     label: 'Agenda Cultural',        mode: 'agenda' },
];
const DEF_BY_KEY = Object.fromEntries(SEGMENT_DEFS.map(d => [d.key, d]));

const _escHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Dados vindos do Envision/Portal podem trazer entidades HTML já codificadas
// (&amp; &ccedil; &#225; etc.). Decodificar ANTES de re-escapar evita o
// double-encode (&amp;amp; → "&amp;" literal no PDF). v4.63.84.
const _NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ccedil: 'ç', Ccedil: 'Ç', atilde: 'ã', Atilde: 'Ã', otilde: 'õ', Otilde: 'Õ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
  agrave: 'à', Agrave: 'À', acirc: 'â', ecirc: 'ê', ocirc: 'ô',
  Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô', uuml: 'ü', Uuml: 'Ü',
  ntilde: 'ñ', Ntilde: 'Ñ', ordf: 'ª', ordm: 'º', deg: '°',
  hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', euro: '€', pound: '£', reg: '®', copy: '©', trade: '™',
};
function _decodeEntities(input) {
  if (!input) return '';
  return String(input)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return _; } })
    .replace(/&#(\d+);/g, (_, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return _; } })
    .replace(/&([a-z]+);/gi, (m, n) => (n in _NAMED_ENTITIES ? _NAMED_ENTITIES[n] : m));
}

// Markdown leve (**bold** __underline__ _italic_ [txt](url)) → HTML seguro.
function _mdToHtml(input) {
  if (!input) return '';
  let html = _escHtml(_decodeEntities(input));
  html = html.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+?)__/g, '<u>$1</u>');
  html = html.replace(/(^|[^_])_([^_]+?)_(?!_)/g, '$1<em>$2</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, url) => {
    const cleanUrl = String(url).trim();
    if (cleanUrl.startsWith('#')) {
      return `<a href="#seg-${_escHtml(cleanUrl.slice(1))}" data-internal-link="1">${txt}</a>`;
    }
    const proto = cleanUrl.match(/^([a-z]+):/i);
    const protoName = proto ? proto[1].toLowerCase() : '';
    if (['javascript', 'data', 'vbscript', 'file', 'about'].includes(protoName)) return txt;
    const safe = /^https?:\/\//i.test(cleanUrl) ? cleanUrl : `https://${cleanUrl}`;
    return `<a href="${_escHtml(safe)}" target="_blank" rel="noopener noreferrer">${txt}</a>`;
  });
  return html;
}

/**
 * Converte um `segments` raw (objeto {key:{items,info,themeDesc,...}}) na lista
 * `segmentos[]` shaped que os templates Handlebars iteram.
 * @param {Object} segs        raw segments do tip
 * @param {Object} [opts]
 * @param {string[]} [opts.orderedKeys] ordem de exibição (default SSOT)
 * @param {Object}   [opts.selection]   curadoria { segKey: true|number[] }
 */
export function shapeTipSegmentos(segs, { orderedKeys, selection } = {}) {
  if (!segs || typeof segs !== 'object') return [];
  const baseOrder = Array.isArray(orderedKeys) && orderedKeys.length
    ? orderedKeys : SEGMENT_DEFS.map(d => d.key);
  // Anexa keys presentes no raw mas fora da ordem (segmentos custom do CRUD).
  const extraKeys = Object.keys(segs).filter(k => !baseOrder.includes(k));
  const allKeys = [...baseOrder, ...extraKeys];
  const hasSel = selection && typeof selection === 'object' && !Array.isArray(selection);

  return allKeys.map(key => {
    const def = DEF_BY_KEY[key] || { key, label: key.replace(/_/g, ' '), mode: 'place_list' };
    const data = segs[key];
    if (!data) return null;

    // Gate de seleção (segmento inteiro)
    let itemFilter = null; // null = todos
    if (hasSel) {
      const sel = selection[key];
      if (sel === undefined || sel === null || sel === false) return null;
      if (Array.isArray(sel)) itemFilter = new Set(sel.map(Number));
      // sel === true → todos os itens
    }
    const _keepIdx = (idx) => itemFilter == null || itemFilter.has(idx);

    const out = { key: def.key, label: def.label, mode: def.mode, isSpecialInfo: def.mode === 'special_info' };

    if (def.mode === 'special_info' && data.info) {
      const info = data.info;
      const fuso = info.fusoSinal && info.fusoHoras ? `${info.fusoSinal}${info.fusoHoras}h` : '';
      const hasChips = !!(info.populacao || info.moeda || info.lingua || info.religiao || info.voltagem || info.ddd || fuso);
      out.info = {
        descricao: _decodeEntities(info.descricao || ''), dica: _decodeEntities(info.dica || ''),
        populacao: _decodeEntities(info.populacao || ''), moeda: _decodeEntities(info.moeda || ''),
        lingua: _decodeEntities(info.lingua || ''), religiao: _decodeEntities(info.religiao || ''),
        voltagem: _decodeEntities(info.voltagem || ''), ddd: _decodeEntities(info.ddd || ''),
        fuso, hasChips,
      };
    }
    if (def.mode === 'simple_list') {
      out.narrative = data.themeDesc || '';
      const rawItems = Array.isArray(data.items) ? data.items : [];
      out.items = rawItems.map((i, idx) => ({ i, idx })).filter(({ idx }) => _keepIdx(idx))
        .map(({ i }) => typeof i === 'string'
          ? { name: '', desc: _decodeEntities(i) }
          : { name: _decodeEntities(i?.name || ''), desc: _decodeEntities(i?.desc || i?.description || '') });
    }
    if (def.mode === 'place_list') {
      out.narrative = data.themeDesc || '';
      const rawItems = Array.isArray(data.items) ? data.items : [];
      out.items = rawItems.map((p, idx) => ({ p, idx })).filter(({ idx }) => _keepIdx(idx)).map(({ p }) => {
        if (p?.type === 'subtitle') {
          const st = _decodeEntities(p.text || '');
          return { isSubtitle: true, type: 'subtitle', text: st, name: st };
        }
        const desc = p?.descricao || p?.notes || p?.observation || p?.description || p?.address || '';
        const obs  = p?.observacoes || '';
        return {
          name: _decodeEntities(p?.titulo || p?.name || p?.title || ''),
          desc: _decodeEntities(desc), descHtml: _mdToHtml(desc),
          categoria: _decodeEntities(p?.categoria || ''),
          tags: (Array.isArray(p?.tags) ? p.tags : []).map(t => _decodeEntities(t)),
          endereco: _decodeEntities(p?.endereco || p?.address || ''),
          telefone: _decodeEntities(p?.telefone || p?.phone || ''),
          site: p?.site || '',
          observacoes: _decodeEntities(obs), observacoesHtml: _mdToHtml(obs),
        };
      });
    }
    if (def.mode === 'agenda') {
      out.narrative = data.themeDesc || '';
      const rawItems = Array.isArray(data.events || data.items) ? (data.events || data.items) : [];
      out.items = rawItems.map((e, idx) => ({ e, idx })).filter(({ idx }) => _keepIdx(idx))
        .map(({ e }) => ({ name: _decodeEntities(e?.title || e?.name || ''), desc: _decodeEntities([e?.date, e?.venue, e?.notes].filter(Boolean).join(' · ')) }));
    }

    const hasContent = (out.narrative && out.narrative.trim())
      || (Array.isArray(out.items) && out.items.length > 0)
      || (out.info && (out.info.descricao || out.info.dica || out.info.hasChips));
    return hasContent ? out : null;
  }).filter(Boolean);
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
export function roteiroToTemplateData(roteiro, area, opts = {}) {
  if (!roteiro) return {};
  const cur = roteiro.pricing?.currency || 'BRL';
  const destinations = (roteiro.travel?.destinations || [])
    .map(d => d.city || d.country).filter(Boolean);
  // v4.63.19+ imagesByCity passado pelo generator pra hero per day
  const imagesByCity = opts?.imagesByCity || {};
  const _normCity = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  // Pricing hasData: true se tem ao menos 1 campo numérico ou customRow
  const _hasPricing = !!(
    roteiro.pricing?.perCouple || roteiro.pricing?.perPerson
    || (Array.isArray(roteiro.pricing?.customRows) && roteiro.pricing.customRows.length)
  );

  // Payment hasData
  const _pay = roteiro.payment || {};
  const _hasPay = !!(_pay.deposit || _pay.installments || _pay.deadline || _pay.notes);

  // ImportantInfo hasData
  const _ii = roteiro.importantInfo || {};
  const _hasIi = !!(_ii.passport || _ii.visa || _ii.vaccines || _ii.climate || _ii.luggage || _ii.flights
                   || (Array.isArray(_ii.customFields) && _ii.customFields.some(c => c?.label || c?.value)));

  return {
    titulo: roteiro.title || '',

    area: {
      nome:        _resolveAreaName(area),
      logoUrl:     area?.logoUrl    || '',
      logoUrlAlt:  area?.logoUrlAlt || '',
      corPrimary:  area?.colors?.primary   || '#D4A843',
      corSecondary: area?.colors?.secondary || '#0F172A',
      corAccent:   area?.colors?.accent || area?.colors?.primary || '#D4A843',
    },

    // v4.63.19+ Footer/Header/hideCover passed by generator via resolveExportTemplate
    customFooterText: opts?.customFooterText || '',
    customHeaderText: opts?.customHeaderText || '',
    hideCover: !!opts?.hideCover,
    // v4.63.83+ Capa com foto do destino + véu escuro forte (decisão Renê
    // 29/05/2026). Mesma hero do jsPDF (buildCoverPage). Template renderiza a
    // imagem full-bleed sob gradiente escuro pra título/logo ficarem legíveis;
    // fallback pra cor sólida var(--secondary) quando vazio.
    coverImageUrl: opts?.coverImageUrl || '',
    contact: roteiro.contact || roteiro.client?.agentEmail || '',
    hasIncExc: (Array.isArray(roteiro.includes) && roteiro.includes.length > 0)
            || (Array.isArray(roteiro.excludes) && roteiro.excludes.length > 0),

    cliente: (() => {
      const a = roteiro.client?.adults || 0;
      const c = roteiro.client?.children || 0;
      return {
        nome:     roteiro.client?.name     || '',
        adults:   a, children: c,
        email:    roteiro.client?.email    || '',
        telefone: roteiro.client?.phone    || '',
        // v4.63.19+ Precomputed labels (Handlebars não tem eq helper builtin)
        adultsLabel:   a > 0 ? `${a} adulto${a > 1 ? 's' : ''}` : '',
        childrenLabel: c > 0 ? `${c} criança${c > 1 ? 's' : ''}` : '',
        paxLabel:      [a > 0 ? `${a} adulto${a > 1 ? 's' : ''}` : '', c > 0 ? `${c} criança${c > 1 ? 's' : ''}` : ''].filter(Boolean).join(' + '),
      };
    })(),

    viagem: (() => {
      const n = roteiro.travel?.nights || 0;
      return {
        dataInicio: _fmtDateBr(roteiro.travel?.startDate),
        dataFim:    _fmtDateBr(roteiro.travel?.endDate),
        noites:     n,
        noitesLabel: n > 0 ? `${n} NOITE${n > 1 ? 'S' : ''}` : '',
        destinos:   destinations.join(' · '),
        destinosLista: (roteiro.travel?.destinations || []).map(d => ({
          cidade: d.city || '',
          pais:   d.country || '',
        })),
      };
    })(),

    dias: (roteiro.days || []).map(d => ({
      numero:    d.dayNumber || '',
      data:      _fmtDateBr(d.date),
      cidade:    d.city || '',
      narrativa: d.narrative || '',
      heroUrl:   imagesByCity[_normCity(d.city)] || '',
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
      validUntil:  _fmtDateBr(roteiro.pricing?.validUntil),
      customRows:  Array.isArray(roteiro.pricing?.customRows) ? roteiro.pricing.customRows.map(r => ({
        label: r?.label || '',
        value: r?.value != null ? _formatCurrency(r.value, r?.currency || cur) : '',
      })) : [],
      hasData:     _hasPricing,
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

    pagamento: { ..._pay, hasData: _hasPay },
    cancelamento: Array.isArray(roteiro.cancellation) ? roteiro.cancellation : [],
    informacoes: { ..._ii, hasData: _hasIi },

    // v4.63.84+ DICAS embedadas (Portal de Dicas anexado à cotação).
    // Antes não havia mapping nenhum no path HTML → dicas eram dropadas
    // silenciosamente (Renê 29/05: "toda a parte das dicas... está muito cru").
    // Cada tip embeda um SNAPSHOT (tip.content.segments). `tip.selection`
    // (opcional) cura o que entra — ver shapeTipSegmentos. Sem selection,
    // inclui tudo (compat). Tips sem segmentos visíveis são filtrados.
    dicas: (() => {
      const tips = Array.isArray(roteiro.embeddedTips) ? roteiro.embeddedTips : [];
      return tips.map(t => {
        const segs = t?.content?.segments || t?.segments || null;
        const segmentos = shapeTipSegmentos(segs, {
          orderedKeys: Array.isArray(t?.segmentOrder) ? t.segmentOrder : undefined,
          selection:   t?.selection || null,
        });
        if (!segmentos.length) return null;
        return {
          titulo:    t?.title || '',
          subtitulo: t?.subtitle || '',
          segmentos,
        };
      }).filter(Boolean);
    })(),

    today: _today(),
  };
}

/* ─── Adapter: portal de dicas ──────────────────────────────────────── */

/**
 * Mapeia allTips (array de {tip, dest}) → data Handlebars pra templates
 * do Portal de Dicas.
 */
export function portalToTemplateData({ allTips, area, segments, areaName, imagesByDest, customFooterText, customHeaderText, hideCover } = {}) {
  // v4.63.12+ Fix HIGH Bug #11 (audit pós-sprint): agrupa tips por destino.
  // Antes (v4.63.11): cada par {tip,dest} virava 1 destino → 2 tips na mesma
  // cidade = destino duplicado, template `{{#each destinos}}` renderizava 2×.
  // Agora consolida por dest.id (ou city_country fallback) — N tips → 1 destino
  // com tips[]. Segments mergeados (último vence pra cada key).
  //
  // v4.63.17+ Expanded shape pra template HTML seed "PRIMETOUR Portal Default":
  // - segmentos[] iterável por destino (em ordem dos DEFAULT_SEGMENTS)
  // - heroUrl extraído de imagesByDest[destId].hero
  // - area.corPrimary/corSecondary pra CSS vars
  // - info gerais com chips planificados (hasChips, populacao, moeda, etc.)
  // - customFooterText/customHeaderText/hideCover (vindos de exports config)
  const byDest = new Map();
  (allTips || []).forEach(({ tip, dest }) => {
    if (!dest) return;
    const key = dest.id || `${dest.city || ''}__${dest.country || ''}`;
    if (!byDest.has(key)) {
      byDest.set(key, {
        id:       dest.id || '',
        cidade:   dest.city || '',
        pais:     dest.country || '',
        label:    [dest.city, dest.country].filter(Boolean).join(', '),
        heroUrl:  imagesByDest?.[dest.id]?.hero || '',
        tips:     [],
        segments: {},   // merged raw
        segmentos: [],  // shaped for template iteration (v4.63.17+)
      });
    }
    const entry = byDest.get(key);
    if (tip) {
      entry.tips.push(tip);
      Object.assign(entry.segments, tip.segments || {});
    }
  });

  // Convert raw segments map → ordered iterable array per dest.
  // v4.63.35+ Renê: "dar a possibilidade de escolher a ordem de exibição dos
  // segmentos nos arquivos antes de exportar". A ordem default vem do SSOT
  // canônico (SEGMENT_DEFS, módulo), MAS se o caller passar `segments` (array
  // de keys), respeita essa ordem — assim a UI portalTips.js controla a ordem
  // do export via reorder (↑/↓).
  // v4.63.84+ shaping extraído pro helper compartilhado shapeTipSegmentos
  // (reusado tb por roteiroToTemplateData/dicas embedadas).
  for (const entry of byDest.values()) {
    entry.segmentos = shapeTipSegmentos(entry.segments || {}, { orderedKeys: segments });
  }

  return {
    area: {
      nome:        areaName || _resolveAreaName(area),
      logoUrl:     area?.logoUrl    || '',
      logoUrlAlt:  area?.logoUrlAlt || '',
      corPrimary:  area?.colors?.primary   || '#D4A843',
      corSecondary: area?.colors?.secondary || '#0F172A',
      // v4.63.33+ accent (3ª cor): substitui hardcoded `#D4A843` em templates HTML.
      // Fallback chain: accent → primary → gold PRIMETOUR.
      corAccent:   area?.colors?.accent || area?.colors?.primary || '#D4A843',
    },
    destinos: Array.from(byDest.values()),
    segments: Array.isArray(segments) ? segments : [],
    customFooterText: customFooterText || '',
    customHeaderText: customHeaderText || '',
    hideCover: !!hideCover,
    today: _today(),
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
      // v4.63.33+ paleta completa (primary + secondary + accent) — pra templates
      // do banco poderem usar as cores configuradas em vez de hardcoded.
      corPrimary:  area?.colors?.primary    || '#D4A843',
      corSecondary: area?.colors?.secondary || '#0F172A',
      corAccent:   area?.colors?.accent     || area?.colors?.primary || '#D4A843',
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
