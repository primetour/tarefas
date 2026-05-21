/**
 * Tabs section — equivalente vanilla do TabsSection.tsx do projeto Next.
 * Fundo navy, tabs horizontais com underline animado, bullets com ícones
 * à esquerda, foto grande à direita (alinhada à altura do conteúdo no
 * desktop, aspect-[16/10] no mobile).
 *
 * Uso:
 *   import { renderTabsSection } from '.../btg-tabs-section.js';
 *   renderTabsSection(container, {
 *     eyebrow: 'Concierge Partners',
 *     title: 'Conte com especialistas dedicados...',
 *     description: '...',
 *     theme: { sectionBg: '#05132a', titleColor: '#fff', ... },
 *     tabs: [
 *       { id: 'gastronomia', label: 'Gastronomia', heading: 'Sabores incomparáveis...',
 *         bullets: [{ icon: 'utensils', label: 'Reservas em casas premiadas' }, ...],
 *         imageUrl: '/btg/assets/concierge/gastronomia.jpg'
 *       },
 *       ...
 *     ],
 *   });
 */

import { icon } from './btg-icons.js';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

/**
 * @param {HTMLElement} container
 * @param {Object} cfg
 * @param {string} [cfg.eyebrow]
 * @param {string} cfg.title
 * @param {string} [cfg.description]
 * @param {Array<{id:string, label:string, heading:string, bullets:Array<{icon:string,label:string}>, imageUrl:string}>} cfg.tabs
 * @param {Object} cfg.theme  cores
 */
export function renderTabsSection(container, cfg) {
  const { eyebrow, title, description, tabs, theme } = cfg;
  const id = `tabs-${Math.random().toString(36).slice(2, 9)}`;

  container.innerHTML = `
    <section class="btg-tabs-section" style="background:${theme.sectionBg};" id="${id}">
      <div class="btg-container btg-tabs-section__inner">
        <div class="btg-tabs-section__left">
          ${
            eyebrow
              ? `<p class="btg-tabs-section__eyebrow" style="color:${theme.textMuted};">${esc(eyebrow)}</p>`
              : ''
          }
          <h2 class="btg-tabs-section__title" style="color:${theme.titleColor};">${esc(title)}</h2>
          ${
            description
              ? `<p class="btg-tabs-section__desc" style="color:${theme.textMuted};">${esc(description)}</p>`
              : ''
          }

          <div class="btg-tabs-section__tablist-wrap">
            <div class="btg-tabs-section__tablist" role="tablist">
              ${tabs
                .map(
                  (t, i) => `
                <button type="button" class="btg-tab-btn${i === 0 ? ' is-active' : ''}"
                  role="tab" aria-selected="${i === 0}" data-tab="${t.id}"
                  style="color:${i === 0 ? theme.titleColor : theme.inactiveTab};">
                  <span>${esc(t.label)}</span>
                  <span class="btg-tab-btn__underline" style="background:${theme.activeUnderline};"></span>
                </button>`,
                )
                .join('')}
            </div>
          </div>

          <div class="btg-tabs-section__content" data-content>
            ${tabs.map((t, i) => renderTabContent(t, theme, i === 0)).join('')}
          </div>
        </div>

        <div class="btg-tabs-section__right">
          ${tabs
            .map(
              (t, i) => `
            <div class="btg-tabs-section__img-wrap${i === 0 ? ' is-active' : ''}" data-img="${t.id}">
              <img src="${esc(t.imageUrl)}" alt="${esc(t.heading)}" loading="lazy" />
            </div>`,
            )
            .join('')}
        </div>
      </div>
    </section>
  `;

  wireTabsInteractivity(container, theme);
}

function renderTabContent(tab, theme, isFirst) {
  return `
    <div class="btg-tab-pane${isFirst ? ' is-active' : ''}" data-pane="${tab.id}">
      <h3 class="btg-tab-pane__heading" style="color:${theme.titleColor};">${esc(tab.heading)}</h3>
      <ul class="btg-tab-pane__bullets">
        ${tab.bullets
          .map(
            (b) => `<li>
              <span style="color:${theme.iconColor};">${icon(b.icon, 'icon-md')}</span>
              <span style="color:${theme.titleColor};">${esc(b.label)}</span>
            </li>`,
          )
          .join('')}
      </ul>
    </div>
  `;
}

function wireTabsInteractivity(container, theme) {
  const buttons = container.querySelectorAll('.btg-tab-btn');
  const panes = container.querySelectorAll('.btg-tab-pane');
  const imgs = container.querySelectorAll('.btg-tabs-section__img-wrap');

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tab;

      buttons.forEach((b) => {
        const active = b.dataset.tab === id;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', active);
        b.style.color = active ? theme.titleColor : theme.inactiveTab;
      });

      panes.forEach((p) =>
        p.classList.toggle('is-active', p.dataset.pane === id),
      );
      imgs.forEach((i) =>
        i.classList.toggle('is-active', i.dataset.img === id),
      );
    });
  });
}
