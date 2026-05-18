/**
 * Store reativo mínimo para o formulário de cadastro de oferta.
 * Substitui o react-hook-form do projeto Next.
 *
 * API:
 *   const store = createFormStore(defaults);
 *   store.get(name)              → valor
 *   store.set(name, value)       → seta + notifica
 *   store.values()               → snapshot completo
 *   store.subscribe(fn)          → observa mudanças (fn recebe nome do campo)
 *   store.reset(values)          → substitui todos os valores
 */

export function createFormStore(initial = {}) {
  let state = { ...initial };
  const listeners = new Set();

  return {
    get(name) {
      return state[name];
    },
    set(name, value) {
      if (state[name] === value) return;
      state[name] = value;
      listeners.forEach((fn) => fn(name, value));
    },
    values() {
      return { ...state };
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    reset(newValues) {
      state = { ...initial, ...newValues };
      listeners.forEach((fn) => fn('*', null));
    },
  };
}

export function defaultFormValues(tipo = '') {
  return {
    tipo_cartao: [],
    tipo_oferta: tipo,
    concierge_subtipo: '',
    oferta_destaque: 'Não',
    destino_rota: '',
    nome_da_oferta: '',
    descricao: '',
    oferta_especial: '',
    duracao_noites: '',
    tipo_acomodacao: '',
    configuracao_hospedes: '',
    beneficios_marca: '',
    condicoes_observacoes: '',
    local_evento: '',
    categoria_ingresso: '',
    companhia_aerea: '',
    classe_aerea: '',
    nome_navio: '',
    preco_sob_consulta: false,
    tem_galeria: false,
    nacional_internacional: '',
    estado_pais: '',
    nome_feriado: '',
    texto_alternativo_alt: '',
    data_de_inicio: '',
    data_final: '',
    data_expiracao: '',
    moeda: 'R$',
    parcelamento: '1',
    preco: '',
    contexto_do_preco: '',
    taxas: '',
    incluso_no_pacote: '',
    imagem_file: null,
    galeria_files: [],
  };
}
