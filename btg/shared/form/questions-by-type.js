/**
 * Definição das perguntas por tipo de oferta — idêntica ao
 * questions-by-type.tsx do projeto Next.
 *
 * Cada pergunta tem:
 * - id, title, hint, optional
 * - fields (chaves do form)
 * - render(store) → HTML
 * - previewTargets[] (quais slots do preview destacar)
 * - visibleWhen(values) → bool (condicional)
 */

import {
  inputText,
  inputTextarea,
  inputTipoCartao,
  inputDestaque,
  inputNacional,
  inputPrecoConsulta,
  inputPrecoValor,
  inputSelect,
  inputDatas,
  inputDataExpiracao,
  inputImagem,
  inputInclusoes,
} from './form-inputs.js';

const TIPO_OFERTA = {
  FERIADO: 'Feriado',
  DESTINO: 'Destino',
  CRUZEIRO: 'Cruzeiro',
  HOSPEDAGEM: 'Hospedagem',
  AEREO_TRANSFER: 'Aéreo & Transfers',
  CONCIERGE: 'Concierge',
};

const SUB_CONCIERGE = ['Gastronomia', 'Eventos & Esportes', 'Shopping & Gifts', 'Lifestyle & Moda'];

// ─── PERGUNTAS REUTILIZÁVEIS ──────────────────────────────

const qSites = {
  id: 'sites',
  title: 'Onde essa oferta deve aparecer?',
  hint: 'Marque um ou mais sites — a mesma oferta aparece em todos os selecionados.',
  fields: ['tipo_cartao'],
  previewTargets: ['marca'],
  render: (s) => inputTipoCartao(s),
};

const qDestaque = {
  id: 'destaque',
  title: 'Destacar na home dos sites?',
  hint: 'Quando "Sim", aparece na vitrine principal.',
  fields: ['oferta_destaque'],
  render: (s) => inputDestaque(s),
};

const qConciergeSubtipo = {
  id: 'concierge_subtipo',
  title: 'Qual área do Concierge?',
  hint: 'Sub-categoria que filtra a oferta dentro do menu Concierge.',
  fields: ['concierge_subtipo'],
  previewTargets: ['marca'],
  render: (s) => inputSelect(s, 'concierge_subtipo', SUB_CONCIERGE),
};

const qDestino = (label) => ({
  id: 'destino',
  title: label,
  hint: 'Sugestões aparecem com base em ofertas anteriores.',
  fields: ['destino_rota'],
  previewTargets: ['destino'],
  render: (s) => inputText(s, 'destino_rota', { placeholder: 'Ex: Patagônia Argentina' }),
});

const qNome = (label, placeholder) => ({
  id: 'nome',
  title: label,
  hint: 'Aparece como título nos cards e na página da oferta.',
  fields: ['nome_da_oferta'],
  previewTargets: ['nome'],
  render: (s) => inputText(s, 'nome_da_oferta', { placeholder, aiField: 'nome_da_oferta' }),
});

const qDescricao = {
  id: 'descricao',
  title: 'Em poucas linhas, sobre o que é essa oferta?',
  hint: '2-3 frases. Aparece como abertura no card e na página.',
  fields: ['descricao'],
  previewTargets: ['descricao'],
  render: (s) => inputTextarea(s, 'descricao', { rows: 4, placeholder: 'Resort à beira-mar com experiências para a família...', aiField: 'descricao' }),
};

const qSelo = {
  id: 'selo',
  title: 'Tem alguma vantagem pra destacar como selo?',
  hint: 'Até 40 caracteres. Ex: "Kids FREE", "3ª noite FREE", "10% OFF".',
  optional: true,
  fields: ['oferta_especial'],
  previewTargets: ['selo'],
  render: (s) => inputText(s, 'oferta_especial', { placeholder: 'Kids FREE', maxLength: 40, aiField: 'oferta_especial' }),
};

const qDuracao = (label, placeholder) => ({
  id: 'duracao',
  title: label,
  optional: true,
  fields: ['duracao_noites'],
  previewTargets: ['duracao'],
  render: (s) => inputText(s, 'duracao_noites', { type: 'number', placeholder }),
});

const qAcomodacao = {
  id: 'acomodacao',
  title: 'Tipo de acomodação',
  hint: 'Ex: Suíte Superior, Apartamento Standard.',
  fields: ['tipo_acomodacao'],
  previewTargets: ['acomodacao'],
  render: (s) => inputText(s, 'tipo_acomodacao', { placeholder: 'Ex: Suíte Superior' }),
};

const qHospedes = {
  id: 'hospedes',
  title: 'Configuração de hóspedes',
  hint: 'Ex: "2 adultos + 1 criança até 12 anos".',
  optional: true,
  fields: ['configuracao_hospedes'],
  previewTargets: ['hospedes'],
  render: (s) => inputText(s, 'configuracao_hospedes', { placeholder: '2 adultos + 1 criança até 12 anos' }),
};

const qLocalEvento = {
  id: 'local_evento',
  title: 'Onde acontece o evento?',
  hint: 'Estádio, sala, venue.',
  fields: ['local_evento'],
  previewTargets: ['local_evento'],
  render: (s) => inputText(s, 'local_evento', { placeholder: 'Ex: Estádio MorumBIS' }),
};

const qCategoriaIngresso = {
  id: 'categoria_ingresso',
  title: 'Categoria do ingresso',
  hint: 'Ex: Zone 2, Categoria 3, Les Mezzanines.',
  optional: true,
  fields: ['categoria_ingresso'],
  previewTargets: ['categoria_ingresso'],
  render: (s) => inputText(s, 'categoria_ingresso', { placeholder: 'Categoria 3' }),
};

const qNomeNavio = {
  id: 'nome_navio',
  title: 'Qual o nome do navio?',
  hint: 'Embarcação que opera o cruzeiro.',
  optional: true,
  fields: ['nome_navio'],
  previewTargets: ['nome_navio'],
  render: (s) => inputText(s, 'nome_navio', { placeholder: 'Ex: Silver Whisper' }),
};

const qCompanhia = {
  id: 'companhia_aerea',
  title: 'Qual a companhia aérea?',
  fields: ['companhia_aerea'],
  previewTargets: ['companhia_aerea'],
  render: (s) => inputText(s, 'companhia_aerea', { placeholder: 'Ex: TAP Air Portugal' }),
};

const qClasse = {
  id: 'classe_aerea',
  title: 'Qual a classe do voo?',
  hint: 'Ex: Executiva, Primeira Classe, Econômica Premium.',
  optional: true,
  fields: ['classe_aerea'],
  previewTargets: ['classe_aerea'],
  render: (s) => inputText(s, 'classe_aerea', { placeholder: 'Executiva' }),
};

const qNi = (label) => ({
  id: 'ni',
  title: label,
  optional: true,
  fields: ['nacional_internacional'],
  previewTargets: ['ni_estado'],
  render: (s) => inputNacional(s),
});

const qEstadoPais = {
  id: 'estado_pais',
  title: 'Qual estado ou país?',
  optional: true,
  fields: ['estado_pais'],
  previewTargets: ['ni_estado'],
  visibleWhen: (v) => v.nacional_internacional !== '',
  render: (s) => inputText(s, 'estado_pais', { placeholder: 'Ex: Bahia / França' }),
};

const qNomeFeriado = {
  id: 'nome_feriado',
  title: 'Qual feriado?',
  hint: 'Agrupa as ofertas. Ex: Réveillon 2026.',
  fields: ['nome_feriado'],
  previewTargets: ['nome_feriado'],
  render: (s) => inputText(s, 'nome_feriado', { placeholder: 'Réveillon 2026' }),
};

const qImagem = {
  id: 'imagem',
  title: 'Envie a imagem principal',
  hint: 'Escolha do banco curado ou faça upload. 16:9 recomendado.',
  // 4.41.0+ valida imagem_url (setado pelo image picker). imagem_file legacy
  // só serve de buffer interno — não persiste em Firestore.
  fields: ['imagem_url'],
  previewTargets: ['imagem'],
  render: (s) => inputImagem(s),
};

const qAlt = {
  id: 'alt',
  title: 'Texto alternativo da imagem',
  hint: 'Útil para leitores de tela. Opcional (site não é indexável).',
  optional: true,
  fields: ['texto_alternativo_alt'],
  previewTargets: ['imagem'],
  render: (s) => inputText(s, 'texto_alternativo_alt', { placeholder: 'Ex: Resort à beira-mar ao entardecer' }),
};

const qPrecoConsulta = {
  id: 'preco_consulta',
  title: 'O preço é público ou sob consulta?',
  hint: 'Sob consulta é comum em eventos sem preço público.',
  fields: ['preco_sob_consulta'],
  previewTargets: ['preco'],
  render: (s) => inputPrecoConsulta(s),
};

const qPrecoValor = {
  id: 'preco_valor',
  title: 'Qual o valor a partir?',
  hint: 'Escolha moeda, parcelas e digite o valor.',
  fields: ['preco', 'moeda', 'parcelamento'],
  previewTargets: ['preco'],
  visibleWhen: (v) => !v.preco_sob_consulta,
  render: (s) => inputPrecoValor(s),
};

const qPrecoContexto = {
  id: 'preco_contexto',
  title: 'Em qual contexto esse preço se aplica?',
  hint: 'Ex: "Por pessoa em apto duplo".',
  optional: true,
  fields: ['contexto_do_preco'],
  visibleWhen: (v) => !v.preco_sob_consulta,
  render: (s) => inputText(s, 'contexto_do_preco', { placeholder: 'Por pessoa em apto duplo' }),
};

const qTaxas = {
  id: 'taxas',
  title: 'E as taxas?',
  optional: true,
  fields: ['taxas'],
  visibleWhen: (v) => !v.preco_sob_consulta,
  render: (s) => inputText(s, 'taxas', { placeholder: 'Ex: Taxas inclusas' }),
};

const qDatas = (label, hint) => ({
  id: 'datas',
  title: label,
  hint,
  optional: true,
  fields: ['data_de_inicio', 'data_final'],
  previewTargets: ['datas'],
  render: (s) => inputDatas(s),
});

const qExpiracao = {
  id: 'expiracao',
  title: 'Quando essa oferta expira?',
  hint: 'Após essa data, ela some das vitrines.',
  optional: true,
  fields: ['data_expiracao'],
  render: (s) => inputDataExpiracao(s),
};

// 4.43.0+ (BTG migration Fase F): substitui textarea livre por blocos
// estruturados (subtitulo + topicos + valor). Os parâmetros `label` e
// `placeholder` ficam só pro título da pergunta (placeholder dos tópicos
// é embutido em inputInclusoes). Backward compat: `incluso_no_pacote`
// continua sendo derivado em btg-ofertas-service.js no save.
const qIncluso = (label, _placeholder) => ({
  id: 'incluso',
  title: label,
  hint: 'Cada bloco vira uma seção na página. Use múltiplos blocos pra combos (ex: Classic + Culinary).',
  optional: true,
  fields: ['inclusoes'],
  previewTargets: ['incluso'],
  render: (s) => inputInclusoes(s),
});

const qBeneficios = {
  id: 'beneficios',
  title: 'Benefícios exclusivos do cartão',
  hint: 'Diferenciais Partners/Ultrablue. Um por linha.',
  optional: true,
  fields: ['beneficios_marca'],
  previewTargets: ['beneficios'],
  render: (s) => inputTextarea(s, 'beneficios_marca', { rows: 5, placeholder: 'Welcome drink\nEarly check-in & late check-out\nMassagem 50min', aiField: 'beneficios_marca' }),
};

const qCondicoes = {
  id: 'condicoes',
  title: 'Condições e observações',
  hint: 'Validade, blackout, antecedência. Um item por linha.',
  optional: true,
  fields: ['condicoes_observacoes'],
  previewTargets: ['condicoes'],
  render: (s) => inputTextarea(s, 'condicoes_observacoes', { rows: 4, placeholder: 'Válido entre 23/07 e 28/08/2026\nAntecedência mínima 14 dias', aiField: 'condicoes_observacoes' }),
};

// ─── FLUXOS POR TIPO ─────────────────────────────────────

const FLOWS = {
  [TIPO_OFERTA.FERIADO]: [
    qSites, qDestaque, qNomeFeriado,
    qDestino('Onde será o feriado?'),
    qNome('Nome da oferta', 'Réveillon Pedras do Patacho — 5 noites'),
    qDescricao, qSelo,
    qDuracao('Quantas noites?', '5'),
    qAcomodacao, qHospedes,
    qNi('Nacional ou Internacional?'), qEstadoPais,
    qImagem, qAlt,
    qPrecoConsulta, qPrecoValor, qPrecoContexto, qTaxas,
    qDatas('Período do feriado', 'Data de início e fim da estadia.'),
    qExpiracao,
    qIncluso('O que está incluso no pacote?', 'Hospedagem com café da manhã\nTraslados\nSeguro viagem'),
    qBeneficios, qCondicoes,
  ],
  [TIPO_OFERTA.DESTINO]: [
    qSites, qDestaque,
    qDestino('Qual é o destino?'),
    qNome('Nome da oferta', '10 dias na Toscana — vinícolas e villas'),
    qDescricao, qSelo,
    qDuracao('Duração do roteiro (dias)', '10'),
    qNi('Esse destino é nacional ou internacional?'), qEstadoPais,
    qImagem, qAlt,
    qPrecoConsulta, qPrecoValor, qPrecoContexto, qTaxas,
    qDatas('Período sugerido', 'Quando a oferta é válida.'),
    qExpiracao,
    qIncluso('O que o roteiro inclui?', 'Hospedagem com café da manhã\nGuia particular\nTraslados privativos'),
    qBeneficios, qCondicoes,
  ],
  [TIPO_OFERTA.CRUZEIRO]: [
    qSites, qDestaque,
    qDestino('Qual a rota/região do cruzeiro?'),
    qNome('Nome da oferta', 'Cruzeiro Mediterrâneo — 7 noites'),
    qDescricao, qNomeNavio, qSelo,
    qDuracao('Quantas noites a bordo?', '7'),
    qNi('É um cruzeiro internacional ou nacional?'), qEstadoPais,
    qImagem, qAlt,
    qPrecoConsulta, qPrecoValor, qPrecoContexto, qTaxas,
    qDatas('Datas de embarque e desembarque'),
    qExpiracao,
    qIncluso('O que está incluso a bordo?', 'Pensão completa\nBebidas premium\nExcursões em terra'),
    qBeneficios, qCondicoes,
  ],
  [TIPO_OFERTA.HOSPEDAGEM]: [
    qSites, qDestaque,
    qDestino('Em qual cidade/região fica o hotel?'),
    qNome('Qual o nome do hotel?', 'Carmel Cumbuco Resort'),
    qDescricao, qSelo,
    qDuracao('Quantas noites de hospedagem?', '5'),
    qAcomodacao, qHospedes,
    qNi('Hotel nacional ou internacional?'), qEstadoPais,
    qImagem, qAlt,
    qPrecoConsulta, qPrecoValor, qPrecoContexto, qTaxas,
    qDatas('Período da estadia'),
    qExpiracao,
    qIncluso('O que está incluso?', 'Hospedagem com café da manhã\nTraslados\nUpgrade de quarto'),
    qBeneficios, qCondicoes,
  ],
  [TIPO_OFERTA.AEREO_TRANSFER]: [
    qSites, qDestaque,
    qDestino('Qual a rota?'),
    qNome('Nome da oferta', 'TAP Air São Paulo → Paris classe executiva'),
    qDescricao, qSelo,
    qCompanhia, qClasse,
    qNi('Voo nacional ou internacional?'), qEstadoPais,
    qImagem, qAlt,
    qPrecoConsulta, qPrecoValor, qPrecoContexto, qTaxas,
    qDatas('Janela de validade dos voos', 'Período em que se pode viajar.'),
    qExpiracao,
    qIncluso('Benefícios da tarifa', 'Acesso ao lounge\nPrioridade no embarque\n2 bagagens de 32kg'),
    qBeneficios, qCondicoes,
  ],
  [TIPO_OFERTA.CONCIERGE]: [
    qSites, qConciergeSubtipo, qDestaque,
    qDestino('Cidade ou local do serviço/evento'),
    qNome('Nome da oferta', 'BTS World Tour Arirang — São Paulo'),
    qDescricao,
    qLocalEvento, qCategoriaIngresso, qSelo,
    qImagem, qAlt,
    qPrecoConsulta, qPrecoValor, qPrecoContexto, qTaxas,
    qDatas('Datas do evento ou serviço'),
    qExpiracao,
    qIncluso('O que está incluso?', 'Ingresso categoria VIP\nHospitalidade no estádio\nMeet & greet'),
    qCondicoes,
  ],
};

export function getQuestionsForType(tipo) {
  return FLOWS[tipo] || FLOWS[TIPO_OFERTA.FERIADO];
}

export { TIPO_OFERTA };
