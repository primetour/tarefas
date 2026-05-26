/**
 * envisionAdapter — converte Itinerary do Envision (TravelAgent) pro shape
 * do roteiros_bank (PRIMETOUR).
 *
 * v4.58.0+ Sprint #93 Fase 1a.
 *
 * Pure function. Sem dependência de auth/API/Firebase — recebe JSON,
 * retorna shape pronto pra gravar via saveRoteiroBank().
 *
 * INPUT:  resposta de POST /Services/SiteService.svc/GetItineraryDetails
 *         (estrutura: { TravelEngineItineraryDetailsRS: { Itinerary: {...} } })
 * OUTPUT: objeto compatível com emptyRoteiroBank() (mesmo shape do schema atual).
 *
 * Filosofia (CLAUDE.md §11.h):
 *   - Mapeamento direto onde shape bate
 *   - HTML bruto guardado em envisionRaw (fallback, sem parser frágil)
 *   - Curador pode editar/sobrepor depois (overlay editorial em fase futura)
 *
 * Doc completo do mapeamento campo-a-campo: docs/ENVISION-SCHEMA-AUDIT.md §3
 */

/** Strip tags HTML mantendo só texto. Defensivo pra HTML mal-formado. */
function stripHtml(html) {
  if (!html || typeof html !== 'string') return '';
  // Mapa de entidades comuns (acentos pt-BR + HTML básico)
  const entities = {
    '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
    '&quot;': '"', '&#39;': "'", '&apos;': "'",
    // Acentos pt-BR (vistos nos fixtures Envision)
    '&aacute;': 'á', '&Aacute;': 'Á', '&eacute;': 'é', '&Eacute;': 'É',
    '&iacute;': 'í', '&Iacute;': 'Í', '&oacute;': 'ó', '&Oacute;': 'Ó',
    '&uacute;': 'ú', '&Uacute;': 'Ú', '&atilde;': 'ã', '&Atilde;': 'Ã',
    '&otilde;': 'õ', '&Otilde;': 'Õ', '&acirc;': 'â', '&Acirc;': 'Â',
    '&ecirc;': 'ê', '&Ecirc;': 'Ê', '&ocirc;': 'ô', '&Ocirc;': 'Ô',
    '&ccedil;': 'ç', '&Ccedil;': 'Ç', '&agrave;': 'à', '&Agrave;': 'À',
    '&ntilde;': 'ñ', '&Ntilde;': 'Ñ',
  };
  return html
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/&[a-zA-Z]+;|&#?\d+;/g, m => entities[m] !== undefined ? entities[m] : ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normaliza nome de categoria Envision pra slug consistente. */
function normalizeCategory(envisionCategoryName) {
  if (!envisionCategoryName) return 'outro';
  const s = String(envisionCategoryName).toLowerCase().trim();
  // Mapeamento de categorias observadas nos fixtures
  if (s.includes('passeio')) return 'passeio';
  if (s.includes('transfer') || s.includes('translad')) return 'transfer';
  if (s.includes('ingresso') || s.includes('ticket')) return 'ingresso';
  if (s.includes('trem') || s.includes('train')) return 'trem';
  if (s.includes('mini') && s.includes('roteiro')) return 'mini-roteiro';
  if (s.includes('cruzeiro') || s.includes('cruise')) return 'cruzeiro';
  if (s.includes('seguro') || s.includes('insurance')) return 'seguro';
  if (s.includes('refei') || s.includes('meal')) return 'refeicao';
  return 'outro';
}

/** Best-effort: nome em pt-BR > nome inglês > FullName. */
function bestLocationName(loc) {
  if (!loc) return '';
  if (typeof loc === 'string') return loc;
  return loc.NamePortuguese || loc.Name || loc.FullName || '';
}

/**
 * Converte 1 Hotel Envision (Product com ProductType=2) pro shape
 * categories[].hotels[].* enriquecido (v4.58.0+).
 */
function mapHotel(product) {
  const hotel = product.Hotel || {};
  const address = hotel.Address || {};
  const loc = hotel.Location || (typeof product.Location === 'object' ? product.Location : null);

  return {
    // legacy minimal (já existia no schema antigo)
    city:        bestLocationName(loc) || (typeof product.Location === 'string' ? product.Location : ''),
    name:        product.ProductName || hotel.Name || '',
    roomType:    '',                                       // não vem no detail — vem depois via fares
    nights:      product.NumberOfNights || 0,
    supplierUrl: '',                                       // não vem
    notes:       stripHtml(product.Description || '').slice(0, 200),

    // v4.58.0+ enriched
    address: {
      street:     address.Street || '',
      number:     address.Number || '',
      district:   address.District || '',
      postalCode: address.PostalCode || '',
      complement: address.Complement || '',
    },
    phone:    hotel.Phone || '',
    email:    hotel.Email || '',
    chainCode: product.HotelChainCode || hotel.ChainCode || '',
    rating:   typeof hotel.Rating === 'number' ? hotel.Rating : null,
    coords:   {
      lat: address.Latitude  ?? loc?.Latitude  ?? null,
      lng: address.Longitude ?? loc?.Longitude ?? null,
    },
    iata:              loc?.IATA || '',
    locationId:        product.LocationId || loc?.Id || null,
    distanceToCenter:  typeof address.DistanceToCenterCity   === 'number' ? address.DistanceToCenterCity   : null,
    distanceToAirport: typeof address.DistanceToNearestAirport === 'number' ? address.DistanceToNearestAirport : null,
    nearestAirport:    address.NearestAirport || hotel.NearestAirport || '',
    envisionProductId: product.ProductId || null,
    envisionRoomId:    (product.ProductFareCategories || [])[0]?.RoomId || null,
    optional:          !!product.Optional,
  };
}

/**
 * Converte 1 Service Envision (Product com ProductType=1) pro shape
 * services[] (v4.58.0+ ADD).
 */
function mapService(product) {
  const service = product.Service || {};
  const category = service.Category || {};
  const catLabel = category.Name || '';
  // Service name fallback chain: ProductName → Service.Name → 1ª linha do description (sem HTML)
  let name = product.ProductName || service.Name || '';
  if (!name && service.Description) {
    const firstLine = stripHtml(service.Description).split(/[.!?\n]/)[0] || '';
    name = firstLine.slice(0, 80).trim();
  }
  return {
    category:        normalizeCategory(catLabel),
    categoryLabel:   catLabel,
    name,
    descriptionHtml: service.Description || product.Description || '',
    day:             product.Day || null,
    consumableDays:  service.ConsumableDays ?? product.NumberOfDays ?? null,
    optional:        !!product.Optional,
    ageGroups:       Array.isArray(service.AgeGroups) ? service.AgeGroups : [],
    cancellationPolicyHtml: service.CancellationPolicy || '',
    supplier:        product.ProductSupplier || '',
    locationId:      product.LocationId || null,
    locationName:    typeof product.Location === 'string' ? product.Location : bestLocationName(product.Location),
    envisionProductId: product.ProductId || null,
    online:          !!product.Online,
    maxQuantity:     product.MaxQuantity ?? null,
  };
}

/**
 * Agrupa hotéis nas categorias comerciais (Envision FareCategories — "Opção 1/2/3").
 * Usa ProductFareCategories pra mapear: produto → categoria.
 */
function buildCategories(itinerary) {
  const fareCats = itinerary.FareCategories || [];
  const productFareCats = itinerary.ProductFareCategories || [];
  const hotels = (itinerary.Products || []).filter(p => p.ProductType === 2);

  // Index: ProductId → FareCategoryId (1 produto pode estar em N categorias)
  const productToCategories = new Map();
  productFareCats.forEach(pfc => {
    if (!productToCategories.has(pfc.ItineraryProductId)) {
      productToCategories.set(pfc.ItineraryProductId, new Set());
    }
    productToCategories.get(pfc.ItineraryProductId).add(pfc.ItineraryFareCategoryId);
  });

  return fareCats.map((fc, idx) => {
    const catHotels = hotels
      .filter(h => productToCategories.get(h.ProductId)?.has(fc.Id))
      .map(mapHotel);

    return {
      key:     `envision-${fc.Id}`,           // chave única (compatibilidade com legado)
      label:   fc.Name || `Opção ${idx + 1}`,
      hotels:  catHotels,
      pricing: [],                            // Fase 2 — vem de CalculateItineraryFareEstimate
      notes:   '',
      envisionFareCategoryId: fc.Id,
    };
  });
}

/**
 * Geo derivada dos Products + DayByDay.
 * Envision não popula `Locations` no top-level — extraímos de produtos e dias.
 */
function deriveGeo(itinerary) {
  const cities = new Set();
  const countries = new Set();
  const cityList = [];      // [{city, country, continent, nights, locationId}]

  // Extrair de Products
  for (const p of (itinerary.Products || [])) {
    const loc = typeof p.Location === 'object' ? p.Location
              : p.Hotel?.Location || null;
    if (!loc) continue;
    const cityName = bestLocationName(loc);
    if (!cityName) continue;
    const country = loc.Country || '';
    const key = `${cityName}|${country}`;
    if (cities.has(key)) continue;
    cities.add(key);
    if (country) countries.add(country);
    cityList.push({
      city: cityName,
      country,
      continent: '',                            // requer mapping País→Continente (TODO)
      nights: p.NumberOfNights || 0,
      locationId: loc.Id || p.LocationId || null,
      iata: loc.IATA || '',
    });
  }

  // Fallback: extrair de DayByDay se Products vazio
  if (!cityList.length) {
    for (const d of (itinerary.DayByDay || [])) {
      if (d.Name && !cities.has(d.Name)) {
        cities.add(d.Name);
        cityList.push({ city: d.Name, country: '', continent: '', nights: 0, locationId: null, iata: '' });
      }
    }
  }

  return {
    continents: [],                            // requer mapping (TODO)
    countries:  [...countries],
    cities:     cityList,
    destinationIds: [],                        // resolvido em pós-processo (matching portal_destinations)
  };
}

/**
 * Imagens: Envision retorna `UUID.png` (sem URL completa).
 * Adapter recebe `imageBaseUrl` opcional pra construir URL completa.
 * Sem prefix, deixa filename → cliente decide depois.
 */
function mapImages(itinerary, opts = {}) {
  const images = itinerary.Images || [];
  if (!images.length) return { hero: null, gallery: [], overrides: {} };

  const buildUrl = (filename) => {
    if (!filename) return null;
    if (filename.startsWith('http')) return filename;            // já é URL completa
    if (opts.imageBaseUrl) return `${opts.imageBaseUrl.replace(/\/$/, '')}/${filename}`;
    return filename;                                              // só o UUID, app decide
  };

  return {
    hero:    buildUrl(images[0].UrlImage),
    gallery: images.slice(1).map(img => buildUrl(img.UrlImage)).filter(Boolean),
    overrides: {},
  };
}

/**
 * Days do roteiro a partir do Envision DayByDay[].
 */
function mapDays(itinerary) {
  return (itinerary.DayByDay || []).map(d => ({
    dayNumber:     d.Day || null,
    city:          d.Name || '',
    title:         d.Name || '',                                  // pode ser cidade ou tema do dia
    narrative:     d.Description || '',                           // HTML — renderer já lida
    overnightCity: stripHtml(d.NightDescription || ''),           // strip HTML pra texto curto
    flightLeg:     null,                                          // não vem do Envision
  }));
}

/**
 * Validity: Envision tem `AvailabilityDates[]` mas vem vazio nos fixtures.
 * Por ora deixamos vazio — preenchido manualmente OU via Fase 2 (fare estimate).
 */
function mapValidity() {
  return {
    startDate: '',
    endDate:   '',
    notes:     '',
  };
}

/**
 * Converte Envision Itinerary → shape roteiros_bank.
 *
 * @param {object} envisionJson - Resposta completa de GetItineraryDetails
 *                                 (espera {TravelEngineItineraryDetailsRS:{Itinerary:{...}}})
 *                                 OU já o Itinerary direto.
 * @param {object} [opts]
 * @param {string} [opts.imageBaseUrl] - prefix CDN pra UrlImage (ex: 'https://api.travelagent.com.br/Files')
 * @param {string} [opts.importedBy]   - uid do user que disparou import
 * @param {string} [opts.collectionLabel] - default 'Envision' (pode ser sobrescrito)
 * @returns {object} doc compatível com saveRoteiroBank()
 */
export function envisionItineraryToBank(envisionJson, opts = {}) {
  // Aceita resposta completa OU itinerary direto
  const it = envisionJson?.TravelEngineItineraryDetailsRS?.Itinerary
          || envisionJson?.Itinerary
          || envisionJson;
  if (!it || typeof it !== 'object' || !it.Id) {
    throw new Error('envisionItineraryToBank: input inválido — sem Itinerary.Id');
  }

  const g = it.Globalization || {};
  const products = it.Products || [];
  const services = products.filter(p => p.ProductType === 1).map(mapService);

  return {
    // ─── Identidade ───
    title:        it.Name || g.Name || '',
    subtitle:     '',                                             // não vem
    code:         '',                                             // gerado on-save
    slug:         '',                                             // gerado on-save
    collectionLabel: opts.collectionLabel || 'Envision',

    // ─── Status ───
    status:       'review',                                       // novo doc vindo de sync → review p/ curador validar

    // ─── Validade ───
    validity:     mapValidity(),

    // ─── Narrativa ───
    shortDescription: stripHtml(g.ShortDescription || '').slice(0, 300),
    longDescription:  g.Description || it.Description || '',     // HTML

    // ─── Geo (derivado de Products + DayByDay) ───
    geo:          deriveGeo(it),

    // ─── Duração ───
    durationDays:   it.NumberOfDays   || 0,
    durationNights: it.NumberOfNights || 0,

    // ─── Dias ───
    days:         mapDays(it),

    // ─── Categorias + hotéis ───
    categories:   buildCategories(it),

    // ─── Services estruturados ───
    services,

    // ─── Includes / Excludes ───
    // Mantemos vazio por enquanto — Envision tem em HTML único (`Globalization.Includes`)
    // que salvamos em `envisionRaw.includes` (fallback). Curador pode popular o struct
    // posteriormente via UI manual SE precisar do bullet PDF (overlay editorial — Fase 4).
    includes:     {
      hospedagem: [], traslados: [], passeios: [],
      assistencia: [], aereoInterno: [], trem: [], outros: [],
    },
    excludes:     [],

    // ─── Pagamento ───
    // Idem: HTML único em envisionRaw.formOfPayment.
    payment:      {
      terrestrial: '',
      aerial:      '',
      deposit:     { amount: 0, currency: 'USD', perPerson: true, notes: '' },
      settlement:  '',
    },

    // ─── Cancelamento ───
    // Idem: HTML único em envisionRaw.cancellationPolicy.
    cancellation: [],

    // ─── Documentação + travel notes ───
    // Idem: HTML único em envisionRaw.generalInfo. GeneralInfo struct fica vazio
    // — curador preenche conforme caso de uso real (Fase 4).
    documentation: { passport: '', minors: '', visas: [], vaccines: '' },
    generalInfo:   {
      timezone: '', currency: '', climate: '', gratuities: '',
      voltage: '', gastronomy: '', telecom: '', tips: '',
    },
    travelNotes:   [],

    // ─── Imagens ───
    images:       mapImages(it, opts),

    // ─── Source ───
    source: {
      type:         'envision',
      originalFile: '',
      importedAt:   new Date().toISOString(),
      importedBy:   opts.importedBy || '',
      llmTokens:    { input: 0, output: 0 },
    },

    // ─── Curadoria ───
    tags:         [],
    aiUsable:     true,

    // ─── Envision metadata ───
    envision: {
      id:                  it.Id,
      url:                 it.Url || null,
      loginInformationId:  it.LoginInformationId || null,
      supplierId:          it.SupplierId || null,
      syncedAt:            new Date().toISOString(),
    },

    // ─── Envision RAW (HTML fallback — não renderizado por default) ───
    envisionRaw: {
      includes:           g.Includes           || '',
      generalInfo:        g.GeneralInfo        || '',
      cancellationPolicy: g.CancellationPolicy || '',
      formOfPayment:      g.FormOfPayment      || '',
    },

    // Currency top-level (Envision tem 1 só) — adicionado pra debug
    // (não é campo padrão do schema bank, mas guardamos)
    _envisionCurrency: it.Currency || null,

    // Auditoria — preenchido por saveRoteiroBank()
    createdAt: null, createdBy: '',
    updatedAt: null, updatedBy: '',
    approvedAt: null, approvedBy: '',
  };
}

/**
 * Sanity check: dado um doc convertido, retorna lista de warnings (não fatais).
 * Útil pro test runner reportar coverage.
 */
export function validateAdapterOutput(bankDoc) {
  const warnings = [];
  if (!bankDoc.title) warnings.push('Sem title');
  if (!bankDoc.envision?.id) warnings.push('Sem envisionId');
  if (!bankDoc.days?.length) warnings.push('Sem days (DayByDay vazio?)');
  if (!bankDoc.categories?.length) warnings.push('Sem categories (FareCategories vazio?)');
  if (bankDoc.categories && bankDoc.categories.every(c => !c.hotels?.length)) {
    warnings.push('Nenhuma categoria tem hotéis (Products[ProductType=2] vazio ou desassociado)');
  }
  if (!bankDoc.geo?.cities?.length) warnings.push('geo.cities vazio (não conseguiu derivar de Products/DayByDay)');
  if (!bankDoc.images?.hero) warnings.push('Sem hero image');
  return warnings;
}
