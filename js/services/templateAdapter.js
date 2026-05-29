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
  // canônico abaixo, MAS se o caller passar `segments` (array de keys),
  // respeita essa ordem — assim a UI portalTips.js controla a ordem do export
  // via reorder (↑/↓).
  const SEGMENT_DEFS = [
    { key: 'informacoes_gerais',  label: 'Informações Gerais', mode: 'special_info' },
    { key: 'bairros',             label: 'Bairros',            mode: 'simple_list' },
    { key: 'atracoes',            label: 'Atrações',           mode: 'place_list' },
    { key: 'atracoes_criancas',   label: 'Atrações para Crianças', mode: 'place_list' },
    { key: 'restaurantes',        label: 'Restaurantes',       mode: 'place_list' },
    { key: 'vida_noturna',        label: 'Vida Noturna',       mode: 'place_list' },
    { key: 'espetaculos',         label: 'Espetáculos & Teatros', mode: 'place_list' },
    { key: 'compras',             label: 'Compras',            mode: 'place_list' },
    { key: 'arredores',           label: 'Arredores',          mode: 'simple_list' },
    { key: 'highlights',          label: 'Highlights',         mode: 'place_list' },
    { key: 'agenda_cultural',     label: 'Agenda Cultural',    mode: 'agenda' },
  ];
  const DEF_BY_KEY = Object.fromEntries(SEGMENT_DEFS.map(d => [d.key, d]));

  // Ordem efetiva: segments passado pelo caller (UI reorder) OU default SSOT.
  // Se caller passou keys que não estão em SEGMENT_DEFS (ex: custom segments
  // do CRUD), faz fallback gracioso construindo def mínima.
  const orderedKeys = Array.isArray(segments) && segments.length
    ? segments
    : SEGMENT_DEFS.map(d => d.key);
  const SEGMENT_ORDER = orderedKeys.map(k =>
    DEF_BY_KEY[k] || { key: k, label: k.replace(/_/g, ' '), mode: 'place_list' }
  );

  for (const entry of byDest.values()) {
    const segs = entry.segments || {};
    entry.segmentos = SEGMENT_ORDER.map(def => {
      const data = segs[def.key];
      if (!data) return null;
      const out = { key: def.key, label: def.label, mode: def.mode };
      if (def.mode === 'special_info' && data.info) {
        const info = data.info;
        const fuso = info.fusoSinal && info.fusoHoras ? `${info.fusoSinal}${info.fusoHoras}h` : '';
        const hasChips = !!(info.populacao || info.moeda || info.lingua || info.religiao || info.voltagem || info.ddd || fuso);
        out.info = {
          descricao: info.descricao || '',
          dica:      info.dica || '',
          populacao: info.populacao || '', moeda: info.moeda || '', lingua: info.lingua || '',
          religiao:  info.religiao || '',  voltagem: info.voltagem || '', ddd: info.ddd || '',
          fuso,
          hasChips,
        };
      }
      if (def.mode === 'simple_list') {
        out.narrative = data.themeDesc || '';
        const rawItems = Array.isArray(data.items) ? data.items : [];
        out.items = rawItems.map(i => typeof i === 'string' ? { name: '', desc: i } : { name: i?.name || '', desc: i?.desc || i?.description || '' });
      }
      if (def.mode === 'place_list') {
        out.narrative = data.themeDesc || '';
        const rawItems = Array.isArray(data.items) ? data.items : [];
        // v4.63.37+ Expor `tags` no shape do template — render HTML pode iterar
        // {{#each tags}} pra exibir chips. Renderer legado ignora silenciosamente.
        // v4.63.39+ Subtítulos preservam type='subtitle' + text para template
        // iterar e renderizar como heading. `name` aliasado pra `text` por compat.
        // v4.63.40+ Rich text: descricao/observacoes podem ter markdown
        // (**bold**, _italic_, __underline__, [link](url)). Convertemos pra
        // HTML safe ANTES de passar pro template (templates usam triple-stash
        // {{{desc}}} pra renderizar HTML sem escape, OU double-stash {{desc}}
        // que mantém escapado e markdown vira texto literal — backward compat).
        // Helper inline pra evitar ciclo de import com richText.js:
        const _esc = (s) => String(s || '').replace(/[&<>"']/g, (c) =>
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
        const _toHtml = (input) => {
          if (!input) return '';
          // Importação dinâmica é overhead — fallback rápido com regex:
          // Strip-safe transform de markdown → HTML básico. Se markdown ausente,
          // retorna texto escapado direto.
          let html = _esc(input);
          // Bold **x** (não-greedy)
          html = html.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
          // Underline __x__
          html = html.replace(/__([^_]+?)__/g, '<u>$1</u>');
          // Italic _x_ (não em volta de underline)
          html = html.replace(/(^|[^_])_([^_]+?)_(?!_)/g, '$1<em>$2</em>');
          // v4.63.45+ B1 fix: reject ANTES de transformações. URL é sempre
          // escapada pra prevenir injection de atributos.
          html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, txt, url) => {
            const cleanUrl = String(url).trim();
            if (cleanUrl.startsWith('#')) {
              return `<a href="#seg-${_esc(cleanUrl.slice(1))}" data-internal-link="1">${txt}</a>`;
            }
            const proto = cleanUrl.match(/^([a-z]+):/i);
            const protoName = proto ? proto[1].toLowerCase() : '';
            if (['javascript', 'data', 'vbscript', 'file', 'about'].includes(protoName)) {
              return txt;  // strip link
            }
            const safe = /^https?:\/\//i.test(cleanUrl) ? cleanUrl : `https://${cleanUrl}`;
            return `<a href="${_esc(safe)}" target="_blank" rel="noopener noreferrer">${txt}</a>`;
          });
          return html;
        };
        out.items = rawItems.map(p => {
          if (p?.type === 'subtitle') {
            return { isSubtitle: true, type: 'subtitle', text: p.text || '', name: p.text || '' };
          }
          const desc = p?.descricao || p?.notes || p?.observation || p?.description || p?.address || '';
          const obs  = p?.observacoes || '';
          return {
            name: p?.titulo || p?.name || p?.title || '',
            desc,             // legado: texto cru pra templates antigos
            descHtml: _toHtml(desc),   // v4.63.40+ HTML pré-renderizado
            categoria: p?.categoria || '',
            tags: Array.isArray(p?.tags) ? p.tags : [],
            observacoes: obs,
            observacoesHtml: _toHtml(obs),
          };
        });
      }
      if (def.mode === 'agenda') {
        out.narrative = data.themeDesc || '';
        const rawItems = Array.isArray(data.events || data.items) ? (data.events || data.items) : [];
        out.items = rawItems.map(e => ({ name: e?.title || e?.name || '', desc: [e?.date, e?.venue, e?.notes].filter(Boolean).join(' · ') }));
      }
      // Skip se segment ficou vazio (sem narrative + sem items + sem info)
      const hasContent = (out.narrative && out.narrative.trim())
        || (Array.isArray(out.items) && out.items.length > 0)
        || (out.info && (out.info.descricao || out.info.dica || out.info.hasChips));
      return hasContent ? out : null;
    }).filter(Boolean);
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
