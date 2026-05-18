/**
 * Agrupa as ~25 perguntas de cada tipo em 7 etapas semânticas.
 * Mantém ordem de questions-by-type, só filtra/agrupa.
 */

import { getQuestionsForType } from './questions-by-type.js';

const STEPS = [
  {
    id: 'tipo-visibilidade',
    label: 'Tipo & Visibilidade',
    title: 'Onde a oferta vai aparecer',
    description: 'Selecione os sites onde a oferta será publicada e se ela entra em destaque na home.',
    questionIds: ['sites', 'concierge_subtipo', 'destaque'],
  },
  {
    id: 'conteudo',
    label: 'Conteúdo',
    title: 'Conteúdo principal da oferta',
    description: 'Nome, destino, descrição e dados específicos do tipo escolhido.',
    questionIds: [
      'destino', 'nome', 'descricao',
      'nome_feriado', 'nome_navio', 'companhia_aerea', 'classe_aerea',
      'local_evento', 'categoria_ingresso', 'selo',
    ],
  },
  {
    id: 'detalhes',
    label: 'Detalhes',
    title: 'Detalhes da estadia',
    description: 'Duração, tipo de acomodação, configuração de hóspedes e localização.',
    questionIds: ['duracao', 'acomodacao', 'hospedes', 'ni', 'estado_pais'],
  },
  {
    id: 'midia',
    label: 'Mídia',
    title: 'Imagens da oferta',
    description: 'Imagem principal e galeria opcional de fotos extras.',
    questionIds: ['imagem', 'alt'],
  },
  {
    id: 'preco-datas',
    label: 'Preço & Datas',
    title: 'Preço, parcelamento e datas',
    description: 'Valor a partir, moeda, parcelamento, contexto, taxas, período da oferta e expiração.',
    questionIds: ['preco_consulta', 'preco_valor', 'preco_contexto', 'taxas', 'datas', 'expiracao'],
  },
  {
    id: 'pacote-condicoes',
    label: 'Pacote & Condições',
    title: 'Pacote, benefícios e condições',
    description: 'O que está incluso, benefícios exclusivos do cartão e observações importantes.',
    questionIds: ['incluso', 'beneficios', 'condicoes'],
  },
  {
    id: 'resumo',
    label: 'Resumo',
    title: 'Confira e publique',
    description: 'Revise os dados na prévia ao lado e publique a oferta.',
    questionIds: [],
  },
];

export function getStepsForType(tipo) {
  const all = getQuestionsForType(tipo);
  const validIds = new Set(all.map((q) => q.id));
  return STEPS.map((s) => ({
    ...s,
    questionIds: s.questionIds.filter((id) => validIds.has(id)),
  })).filter((s) => s.id === 'resumo' || s.questionIds.length > 0);
}

export function getQuestionsForStep(tipo, stepId) {
  const all = getQuestionsForType(tipo);
  const step = STEPS.find((s) => s.id === stepId);
  if (!step) return [];
  const ids = new Set(step.questionIds);
  return all.filter((q) => ids.has(q.id));
}
