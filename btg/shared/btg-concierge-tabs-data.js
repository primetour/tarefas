/**
 * Dados dos 4 sub-tipos de Concierge (Gastronomia, Eventos & Esportes,
 * Shopping & Gifts, Lifestyle & Moda). Mesma estrutura usada no
 * concierge-tabs-data.tsx do Next.
 */

export const CONCIERGE_TABS = [
  {
    id: 'gastronomia',
    label: 'Gastronomia',
    heading: 'Sabores incomparáveis em restaurantes surpreendentes.',
    bullets: [
      { icon: 'star', label: 'Reservas de última hora em casas premiadas' },
      { icon: 'utensils', label: 'Prioridade em restaurantes Michelin' },
      { icon: 'calendar-days', label: 'Curadoria de opções casuais e renomadas' },
      { icon: 'sparkles', label: 'Jantares privativos e experiências cuidadas' },
    ],
    imageUrl: '/btg/assets/concierge/banner_concierge.png',
  },
  {
    id: 'eventos-esportes',
    label: 'Eventos & Esportes',
    heading: 'Acesso a momentos que valem a corrida.',
    bullets: [
      { icon: 'trophy', label: 'Ingressos para esportes premium (F1, tênis, futebol)' },
      { icon: 'sparkles', label: 'Hospitality privativa em camarotes' },
      { icon: 'calendar-days', label: 'Shows e festivais de difícil acesso' },
      { icon: 'star', label: 'Meet & greet com artistas selecionados' },
    ],
    imageUrl: '/btg/assets/concierge/banner_mobile-concierge.png',
  },
  {
    id: 'shopping-gifts',
    label: 'Shopping & Gifts',
    heading: 'Compras pensadas, presentes que entregam.',
    bullets: [
      { icon: 'gift', label: 'Atendimento personalizado em marcas selecionadas' },
      { icon: 'sparkles', label: 'Itens exclusivos sob encomenda' },
      { icon: 'star', label: 'Presentes coordenados pela equipe' },
      { icon: 'shirt', label: 'Personal shopper em destinos internacionais' },
    ],
    imageUrl: '/btg/assets/concierge/banner_concierge.png',
  },
  {
    id: 'lifestyle-moda',
    label: 'Lifestyle & Moda',
    heading: 'Desfiles, moda e experiências de lifestyle ao seu jeito.',
    bullets: [
      { icon: 'shirt', label: 'Acesso a desfiles e eventos fashion' },
      { icon: 'sparkles', label: 'Peças personalizadas e edições limitadas' },
      { icon: 'star', label: 'Experiências privadas com marcas' },
      { icon: 'calendar-days', label: 'Curadoria de lifestyle alinhada ao seu estilo' },
    ],
    imageUrl: '/btg/assets/concierge/banner_mobile-concierge.png',
  },
];
