/**
 * Splash de seleção de tipo de oferta — 6 cards grandes, cada um
 * com paleta + ícone próprio. Equivalente do TipoSelector.tsx.
 */

import { icon } from '../btg-icons.js';
import { TIPO_OFERTA } from './questions-by-type.js';

const TIPOS = [
  {
    tipo: TIPO_OFERTA.FERIADO,
    label: 'Feriado',
    subtitle: 'Pacotes em datas-chave do calendário',
    icon: 'party-popper',
    primary: '#d4a017',
    secondary: '#fef3c7',
    shortDescription: 'Réveillon, Carnaval, Páscoa, feriados nacionais — agrupados por data.',
  },
  {
    tipo: TIPO_OFERTA.DESTINO,
    label: 'Destino',
    subtitle: 'Roteiros e experiências por localidade',
    icon: 'compass',
    primary: '#7c3aed',
    secondary: '#ede9fe',
    shortDescription: 'Inspiração por localidade — Toscana, Patagônia, Japão.',
  },
  {
    tipo: TIPO_OFERTA.CRUZEIRO,
    label: 'Cruzeiro',
    subtitle: 'Marítimos e fluviais ao redor do mundo',
    icon: 'ship',
    primary: '#0c4a6e',
    secondary: '#e0f2fe',
    shortDescription: 'Navios de luxo, jornadas fluviais, expedições.',
  },
  {
    tipo: TIPO_OFERTA.HOSPEDAGEM,
    label: 'Hospedagem',
    subtitle: 'Hotéis com condições especiais',
    icon: 'hotel',
    primary: '#15803d',
    secondary: '#dcfce7',
    shortDescription: 'Condições pontuais em hotéis fora de feriado.',
  },
  {
    tipo: TIPO_OFERTA.AEREO_TRANSFER,
    label: 'Aéreo & Transfers',
    subtitle: 'Passagens, transfers e locomoção',
    icon: 'plane',
    primary: '#1d4ed8',
    secondary: '#dbeafe',
    shortDescription: 'Bilhetes aéreos, transfers de luxo, aluguel de veículos.',
  },
  {
    tipo: TIPO_OFERTA.CONCIERGE,
    label: 'Concierge',
    subtitle: 'Eventos, gastronomia, shopping, lifestyle',
    icon: 'crown',
    primary: '#1f2937',
    secondary: '#f2b541',
    shortDescription: 'Serviços e experiências exclusivas com curadoria.',
  },
];

/**
 * @param {HTMLElement} container
 * @param {(tipo: string) => void} onSelect
 * @param {() => void} [onImportClick]
 */
export function renderTipoSelector(container, onSelect, onImportClick) {
  container.innerHTML = `
    <main class="tipo-selector">
      <div class="tipo-selector__inner">
        <header class="tipo-selector__head">
          <p class="tipo-selector__eyebrow">Nova oferta</p>
          <h1 class="tipo-selector__title">Que tipo de oferta você vai cadastrar?</h1>
          <p class="tipo-selector__sub">
            Selecione abaixo para começar. Cada categoria tem um fluxo próprio de cadastro adaptado ao tipo de oferta.
          </p>
          ${onImportClick ? `
            <button type="button" class="tipo-selector__import-btn" data-import>
              ${icon('upload', 'icon-sm')}
              Importar oferta de arquivo (Excel / Word)
            </button>
          ` : ''}
        </header>

        <div class="tipo-selector__grid">
          ${TIPOS.map((t, i) => `
            <button type="button" class="tipo-card" data-tipo="${t.tipo}" style="animation-delay:${100 + i * 60}ms;">
              <div class="tipo-card__bg" style="background:linear-gradient(135deg, ${t.secondary}66 0%, transparent 60%);"></div>
              <div class="tipo-card__content">
                <div class="tipo-card__icon" style="background:${t.primary}15;color:${t.primary};">
                  ${icon(t.icon, 'icon-lg')}
                </div>
                <h2 class="tipo-card__label" style="color:${t.primary};">${t.label}</h2>
                <p class="tipo-card__subtitle">${t.subtitle}</p>
                <p class="tipo-card__desc">${t.shortDescription}</p>
                <div class="tipo-card__cta" style="color:${t.primary};">
                  Começar cadastro
                  ${icon('arrow-right', 'icon-sm')}
                </div>
              </div>
            </button>
          `).join('')}
        </div>

        <p class="tipo-selector__foot">
          Cada tipo apresenta apenas os campos relevantes — sem perguntas desnecessárias.
        </p>
      </div>
    </main>
  `;

  container.querySelectorAll('[data-tipo]').forEach((btn) => {
    btn.addEventListener('click', () => onSelect(btn.dataset.tipo));
  });

  if (onImportClick) {
    container.querySelector('[data-import]')?.addEventListener('click', onImportClick);
  }
}
