/**
 * Prompts pt-BR pra sugerir/revisar campos do formulário de oferta BTG.
 *
 * Port do `lib/ai-prompts.ts` do BTG Next.js (zero mudança no conteúdo,
 * só sintaxe JS vanilla). Mantém o tom acordado: sofisticado, conciso,
 * inspirador, sem clichês baratos ("incrível", "imperdível", "único").
 *
 * Uso:
 *   import { buildSugerirPrompt, buildRevisarPrompt, AI_FIELDS } from './btg-ai-prompts.js';
 *   const prompt = buildSugerirPrompt('descricao', { tipo_oferta: 'Feriado', destino_rota: 'Bora Bora' });
 */

/** Campos que aceitam "Sugerir com IA". */
export const AI_FIELDS = [
  'nome_da_oferta',
  'descricao',
  'oferta_especial',
  'incluso_no_pacote',
  'beneficios_marca',
  'condicoes_observacoes',
];

const FIELD_BRIEF = {
  nome_da_oferta:
    "Crie um nome curto e atraente para a oferta (até 90 caracteres). Inspire viagem e exclusividade. Sem aspas, sem clichês como 'incrível'.",
  descricao:
    "Escreva uma descrição curta da oferta (2 a 3 frases, máximo 280 caracteres). Tom inspiracional, sofisticado, evita clichês de turismo. Foca na experiência, não em adjetivos vazios.",
  oferta_especial:
    "Crie um selo curtíssimo (até 40 caracteres, maiúsculas opcionais) que evidencie a vantagem principal — ex: 'KIDS FREE', '3ª NOITE FREE', '10% OFF'. Use o gancho mais forte.",
  incluso_no_pacote:
    "Liste de 4 a 7 itens que provavelmente estão inclusos nesta oferta, um por linha, sem bullets ou números. Itens concretos (ex: 'Hospedagem com café da manhã', 'Traslados privativos', 'Excursão em terra').",
  beneficios_marca:
    "Liste de 3 a 5 benefícios da marca (cartões Partners/Ultrablue BTG ou programa Virtuoso para Operadora Primetour) aplicáveis a esta oferta, um por linha. Ex: 'Welcome drink', 'Early check-in & late check-out', 'Massagem 50min', 'Crédito Virtuoso de US$100', 'Upgrade de categoria'.",
  condicoes_observacoes:
    "Liste de 2 a 4 condições importantes para o cliente saber, uma por linha. Ex: 'Válido entre 23/07 e 28/08/2026', 'Antecedência mínima 14 dias', 'Sujeito à disponibilidade'.",
};

/**
 * Gera o prompt completo pra "Sugerir com IA" em um campo específico,
 * usando o contexto disponível do formulário (campos já preenchidos).
 *
 * @param {string} field - chave do campo (precisa estar em AI_FIELDS).
 * @param {Object} context - subset dos valores do formulário relevantes.
 * @returns {string} prompt pronto pra enviar ao LLM.
 */
export function buildSugerirPrompt(field, context = {}) {
  const brief = FIELD_BRIEF[field];
  if (!brief) throw new Error(`Campo "${field}" não suporta IA.`);

  const ctxLines = Object.entries(context)
    .filter(([, v]) => v != null && String(v).trim() !== '')
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n');

  return `Você é redator(a) sênior do BTG Pactual, escrevendo para clientes premium (cartões Partners e Ultrablue) ou para a operadora Primetour. Tom: sofisticado, conciso, inspirador sem ser piegas. Português do Brasil. Evita superlativos baratos ("incrível", "imperdível", "único"). Foco em experiência concreta.

Contexto da oferta:
${ctxLines || '(sem contexto adicional)'}

Tarefa: ${brief}

Retorne APENAS o texto pedido, sem prefácio, sem aspas, sem explicação.`;
}

/** Tipos de revisão suportados. */
export const REVIEW_TYPES = ['ortografia', 'padronizacao', 'completo'];

const REVIEW_BRIEF = {
  ortografia:
    'Corrija apenas erros de ortografia, acentuação e concordância gramatical do português brasileiro. Mantenha o estilo, o tom e a estrutura originais. Não reescreva nem encurte.',
  padronizacao:
    'Padronize o texto para o tom de voz BTG Pactual / Primetour (sofisticado, conciso, inspirador, sem clichês baratos). Corrija apenas o necessário; mantenha o sentido original. Não invente informação.',
  completo:
    'Faça uma revisão completa: ortografia, gramática, concordância E padronização para o tom BTG Pactual / Primetour (sofisticado, conciso, inspirador). Mantenha o sentido original; não invente informação.',
};

/**
 * Gera o prompt pra "Revisar com IA" um texto existente.
 *
 * @param {string} text - texto a revisar (do campo do formulário).
 * @param {'ortografia'|'padronizacao'|'completo'} type
 * @returns {string} prompt pronto pra enviar ao LLM.
 */
export function buildRevisarPrompt(text, type = 'completo') {
  if (!REVIEW_BRIEF[type]) throw new Error(`Tipo de revisão "${type}" inválido.`);

  return `Você é editor(a) sênior do BTG Pactual / Primetour. Português do Brasil. Tom alvo: sofisticado, conciso, inspirador — sem superlativos baratos ("incrível", "imperdível", "único").

Texto original:
"""
${text}
"""

Tarefa: ${REVIEW_BRIEF[type]}

Retorne APENAS o texto revisado, sem prefácio, sem aspas, sem comentários. Se nada precisa ser alterado, retorne o texto exatamente como está.`;
}

/**
 * Extrai o subset de contexto relevante do form-store completo.
 * Inclui só campos que ajudam o LLM a entender a oferta.
 */
export function buildContextFromStore(values) {
  const RELEVANT_KEYS = [
    'tipo_oferta', 'destino_rota', 'nome_da_oferta', 'descricao',
    'duracao_noites', 'tipo_acomodacao', 'configuracao_hospedes',
    'preco', 'moeda', 'data_de_inicio', 'data_final',
    'nome_navio', 'companhia_aerea', 'classe_aerea',
    'local_evento', 'categoria_ingresso', 'nome_feriado',
    'concierge_subtipo', 'estado_pais', 'nacional_internacional',
  ];
  const ctx = {};
  for (const k of RELEVANT_KEYS) {
    if (values[k] != null && String(values[k]).trim() !== '') {
      ctx[k] = values[k];
    }
  }
  return ctx;
}
