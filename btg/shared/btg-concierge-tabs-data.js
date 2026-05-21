/**
 * Dados dos 4 sub-tipos de Concierge (Gastronomia, Eventos & Esportes,
 * Shopping & Gifts, Lifestyle & Moda). Mesma estrutura usada no
 * concierge-tabs-data.tsx do Next.
 *
 * As imagens de cada aba são por marca — use getConciergeTabs(brand).
 */

const CONCIERGE_TAB_IMAGES = {
  partners: {
    gastronomia: '/btg/assets/concierge/partners_gastronomia.jpg',
    'eventos-esportes': '/btg/assets/concierge/partners_eventos.jpg',
    'shopping-gifts': '/btg/assets/concierge/partners_shopping.jpg',
    'lifestyle-moda': '/btg/assets/concierge/partners_lifestyle.jpg',
  },
  ultrablue: {
    gastronomia: '/btg/assets/concierge/ultrablue_gastronomia.jpg',
    'eventos-esportes': '/btg/assets/concierge/ultrablue_eventos.jpg',
    'shopping-gifts': '/btg/assets/concierge/ultrablue_shopping.jpg',
    'lifestyle-moda': '/btg/assets/concierge/ultrablue_lifestyle.jpg',
  },
};

const CONCIERGE_TABS_BASE = [
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
  },
];

/**
 * Retorna as 4 abas do Concierge com a imagem correta de cada marca.
 * @param {'partners' | 'ultrablue'} brand
 */
export function getConciergeTabs(brand) {
  const images = CONCIERGE_TAB_IMAGES[brand] || CONCIERGE_TAB_IMAGES.partners;
  return CONCIERGE_TABS_BASE.map((t) => ({ ...t, imageUrl: images[t.id] }));
}

/** Backward-compat — default Partners. */
export const CONCIERGE_TABS = getConciergeTabs('partners');
