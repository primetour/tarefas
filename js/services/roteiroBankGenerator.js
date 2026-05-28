/**
 * PRIMETOUR — Banco de Roteiros: gerador de PDF (v4.50.3+)
 *
 * REUSA `generateRoteiroPDF()` do roteiroGenerator.js — mesma capa, mesmo
 * dia-a-dia, mesma identidade visual. Não duplica código.
 *
 * Estratégia: adapta o shape do banco (`roteiros_bank`) pro shape esperado
 * pelo `generateRoteiroPDF(roteiro)`. As diferenças semânticas:
 *
 *   bank.categories[]            → roteiro.hotels[] (flatten) +
 *                                  roteiro.pricing.customRows[] (períodos)
 *   bank.includes.{buckets}      → roteiro.includes[] (flatten com [tag])
 *   bank.payment.{...}           → roteiro.payment.{deposit, installments, deadline, notes}
 *   bank.cancellation[]          → roteiro.cancellation[]
 *   bank.documentation.{...}     → roteiro.importantInfo.{passport, visa, vaccines}
 *   bank.travelNotes[]           → roteiro.importantInfo.customFields[]
 *   bank.geo.cities[]            → roteiro.travel.destinations[]
 *   bank.images.hero             → roteiro.images.hero
 *   bank.shortDescription        → roteiro.client.notes (briefing/intro)
 *
 * Filename: `[Banco] {title}.pdf` pra distinguir de cotações de cliente.
 */

import { generateRoteiroPDF } from './roteiroGenerator.js';

/**
 * Converte um doc de `roteiros_bank` no shape esperado por `generateRoteiroPDF`.
 * Não mutaviva — retorna novo objeto.
 */
export function bankDocToRoteiroShape(bankDoc) {
  if (!bankDoc) throw new Error('bankDoc obrigatório');

  // ─── Hotels (flatten das categorias, com label da categoria nas notes) ───
  const hotels = (bankDoc.categories || []).flatMap(cat =>
    (cat.hotels || []).map(h => ({
      city: h.city || '',
      hotelName: h.name || '',
      roomType: h.roomType || '',
      regime: '',
      checkIn: '',
      checkOut: '',
      nights: h.nights || 0,
      notes: cat.label ? `Categoria: ${cat.label}` : '',
    }))
  );

  // ─── Pricing: cada categoria × cada período × {single, double} vira customRow ───
  const customRows = (bankDoc.categories || []).flatMap(cat => {
    const out = [];
    (cat.pricing || []).forEach(p => {
      const period = `${p.period?.start || '?'} a ${p.period?.end || '?'}`;
      if (p.single) {
        out.push({
          label: `${cat.label} · ${period} · Single (por pessoa)`,
          value: p.single,
          currency: p.currency || 'USD',
        });
      }
      if (p.double) {
        out.push({
          label: `${cat.label} · ${period} · Duplo (por pessoa)`,
          value: p.double,
          currency: p.currency || 'USD',
        });
      }
    });
    return out;
  });

  // ─── Includes flatten com tag pra preservar bucket ───
  const inc = bankDoc.includes || {};
  const includes = [
    ...(inc.hospedagem    || []).map(s => `[Hospedagem] ${s}`),
    ...(inc.traslados     || []).map(s => `[Traslados] ${s}`),
    ...(inc.passeios      || []).map(s => `[Passeios] ${s}`),
    ...(inc.assistencia   || []).map(s => `[Assistência] ${s}`),
    ...(inc.aereoInterno  || []).map(s => `[Aéreo interno] ${s}`),
    ...(inc.trem          || []).map(s => `[Trem] ${s}`),
    ...(inc.outros        || []),
  ];

  // ─── Vistos consolidados em texto único ───
  const visasText = (bankDoc.documentation?.visas || []).map(v =>
    `${v.country}${v.required ? ' — visto obrigatório' : ' — dispensado'}${v.notes ? `\n${v.notes}` : ''}`
  ).join('\n\n');

  // ─── Cancellation no shape do roteiroPDF ───
  const cancellation = (bankDoc.cancellation || []).map(c => ({
    period: `Até ${c.fromDays} dias antes da viagem`,
    penalty: `${c.multaPercent}% do valor total${c.notes ? ` — ${c.notes}` : ''}`,
  }));

  // ─── Payment no shape do roteiroPDF ───
  const dep = bankDoc.payment?.deposit;
  const depositText = dep && dep.amount
    ? `${dep.currency || 'USD'} ${dep.amount}${dep.perPerson ? ' por pessoa' : ''}${dep.notes ? ` · ${dep.notes}` : ''}`
    : '';
  const payment = {
    deposit: depositText,
    installments: bankDoc.payment?.terrestrial || '',
    deadline: bankDoc.payment?.settlement || '',
    notes: bankDoc.payment?.aerial ? `Parte aérea: ${bankDoc.payment.aerial}` : '',
  };

  // ─── Custom fields = travelNotes (clima, altitude, festas) ───
  const customFields = (bankDoc.travelNotes || []).map(n => ({
    label: 'Nota de viagem',
    value: n,
  }));

  return {
    title: bankDoc.title || 'Roteiro PRIMETOUR',
    // Header secundário "by Coleção X" — vai como consultantName que o PDF mostra
    consultantName: bankDoc.collectionLabel ? `Coleção ${bankDoc.collectionLabel}` : '',
    client: {
      name: '',
      type: 'individual',
      preferences: [],
      restrictions: [],
      economicProfile: 'premium',
      notes: bankDoc.shortDescription || '',
    },
    travelers: [],
    travel: {
      startDate: '',
      endDate: '',
      nights: bankDoc.durationNights || 0,
      destinations: (bankDoc.geo?.cities || []).map(c => ({
        city: c.city || '',
        country: c.country || '',
        nights: c.nights || 0,
      })),
    },
    days: (bankDoc.days || []).map(d => ({
      dayNumber: d.dayNumber || 0,
      date: '',
      city: d.city || '',
      title: d.title || '',
      narrative: d.narrative || '',
      overnightCity: d.overnightCity || '',
      activities: [],
      imageIds: [],
    })),
    flights: [],
    hotels,
    pricing: {
      currency: customRows[0]?.currency || 'USD',
      validUntil: bankDoc.validity?.endDate || '',
      disclaimer: 'Valores por pessoa, sujeitos a confirmação e disponibilidade no momento da reserva.',
      customRows,
      services: {
        aereo: [], hoteis: [], traslados: [], experiencias: [], servicosAdicionais: [],
        displayMode: 'grouped',
        notesGeral: '',
      },
      perPerson: null,
      perCouple: null,
    },
    optionals: [],
    includes,
    excludes: bankDoc.excludes || [],
    payment,
    cancellation,
    importantInfo: {
      passport: bankDoc.documentation?.passport || '',
      visa: visasText,
      vaccines: bankDoc.documentation?.vaccines || '',
      climate: '',
      luggage: '',
      flights: '',
      customFields,
    },
    images: {
      hero: bankDoc.images?.hero || null,
      overrides: bankDoc.images?.overrides || {},
    },
    embeddedTips: [],
    // Marcadores pra rastreio em logs
    _source: 'roteiros_bank',
    _bankId: bankDoc.id,
    _collectionLabel: bankDoc.collectionLabel || '',
  };
}

/**
 * Gera PDF de um roteiro_bank usando o mesmo pipeline visual do roteiroPDF.
 * Salva o arquivo via jsPDF (download automático no browser).
 *
 * @param {object} bankDoc — doc completo do roteiros_bank
 * @param {object|null} area — v4.62.40 Fase B.2 (D4): aceita area pra branding.
 *                              Antes (até v4.62.39): sempre null → PDF saía genérico
 *                              cinza, sem logo nem cor da BU. Agora caller (roteiroBank.js)
 *                              pode passar a área escolhida no dropdown.
 * @returns {Promise<{filename:string, blob:Blob}>}
 */
export async function generateRoteiroBankPDF(bankDoc, area = null) {
  const shape = bankDocToRoteiroShape(bankDoc);
  // Filename custom: prefixo [Banco] + título
  const cleanTitle = String(bankDoc.title || 'roteiro')
    .replace(/[^\w\sÀ-ÿ-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60);
  shape._exportFilename = `Banco-${cleanTitle}.pdf`;
  // v4.62.51+ Fix HIGH Zumbi #2 (audit pos-sprint): força roteiroGenerator
  // a resolver template via 'banco-roteiros' em vez de 'roteiros'. Sem
  // isso, Banco lia templates de Cotações silenciosamente.
  shape._exportModuleKey = 'banco-roteiros';
  return generateRoteiroPDF(shape, area);
}
