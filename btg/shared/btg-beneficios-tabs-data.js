/**
 * Tabs dos benefícios — diferentes por marca.
 * Partners: 5 tabs (Hotéis, Pontuação, Seguro, Terminal, Salas VIP)
 * Ultrablue: 6 tabs (mesmo + Cashback)
 */

export const PARTNERS_BENEFICIOS_TABS = [
  {
    id: 'hoteis',
    label: 'Hotéis parceiros',
    heading: 'Mais de 2.000 hotéis ao redor do mundo.',
    bullets: [
      { icon: 'hotel', label: 'Reservas em redes como Four Seasons e Rosewood' },
      { icon: 'star', label: 'Vantagens exclusivas em propriedades selecionadas' },
      { icon: 'sparkles', label: 'Early check-in & late check-out' },
      { icon: 'gift', label: 'Welcome drink e mimos personalizados' },
    ],
    imageUrl: 'assets/concierge/banner_concierge.png',
  },
  {
    id: 'pontuacao',
    label: 'Pontuação acelerada',
    heading: 'Acumule pontos em todas as compras.',
    bullets: [
      { icon: 'coins', label: '4 pontos a cada US$ 1 em compras nacionais' },
      { icon: 'coins', label: '7 pontos a cada US$ 1 em compras internacionais' },
      { icon: 'sparkles', label: 'Pontos válidos em programas de fidelidade premium' },
    ],
    imageUrl: 'assets/concierge/banner_mobile-concierge.png',
  },
  {
    id: 'seguro',
    label: 'Seguro viagem',
    heading: 'Cobertura internacional Omint para você e família.',
    bullets: [
      { icon: 'shield-check', label: 'Você e até 4 dependentes cobertos' },
      { icon: 'plane', label: 'Cobertura completa em viagens internacionais' },
      { icon: 'star', label: 'Atendimento 24h em qualquer destino' },
    ],
    imageUrl: 'assets/concierge/banner_concierge.png',
  },
  {
    id: 'terminal',
    label: 'Terminal BTG Pactual',
    heading: 'Uma experiência diferenciada antes mesmo de embarcar.',
    bullets: [
      { icon: 'star', label: '2 acessos gratuitos + 20% OFF nos adicionais' },
      { icon: 'sparkles', label: 'Check-in dedicado e raio-x sem filas' },
      { icon: 'shield-check', label: 'Despacho prioritário de bagagens' },
      { icon: 'crown', label: 'Concierge exclusivo no terminal' },
    ],
    imageUrl: 'assets/concierge/banner_mobile-concierge.png',
  },
  {
    id: 'salas-vip',
    label: 'Salas VIP',
    heading: 'Acessos ilimitados a mais de 1.000 salas pelo mundo.',
    bullets: [
      { icon: 'star', label: 'Rede LoungeKey com presença global' },
      { icon: 'gift', label: 'Bebidas, Wi-Fi e snacks inclusos' },
      { icon: 'users', label: 'Até 12 convidados por ano' },
    ],
    imageUrl: 'assets/concierge/banner_concierge.png',
  },
];

export const ULTRABLUE_BENEFICIOS_TABS = [
  PARTNERS_BENEFICIOS_TABS[0], // Hotéis
  PARTNERS_BENEFICIOS_TABS[1], // Pontuação
  {
    id: 'cashback',
    label: 'Cashback',
    heading: 'Cashback em viagens, com retorno acelerado.',
    bullets: [
      { icon: 'coins', label: 'Devolução percentual em compras de viagem' },
      { icon: 'sparkles', label: 'Aplicação automática no extrato' },
      { icon: 'star', label: 'Benefício exclusivo Ultrablue' },
    ],
    imageUrl: 'assets/concierge/banner_mobile-concierge.png',
  },
  PARTNERS_BENEFICIOS_TABS[2], // Seguro
  PARTNERS_BENEFICIOS_TABS[3], // Terminal
  PARTNERS_BENEFICIOS_TABS[4], // Salas VIP
];
