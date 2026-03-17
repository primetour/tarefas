/**
 * PRIMETOUR — Card Preferences Modal
 * Abre via ícone ⚙ no header de Kanban, Esteira, Calendário, Timeline
 */

import { modal }  from './modal.js';
import { toast }  from './toast.js';
import { CARD_FIELDS, saveCardPrefs, loadCardPrefs } from '../services/cardPrefs.js';
import { store }  from '../store.js';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/**
 * openCardPrefsModal(onSave?)
 * Abre o painel de preferências de card.
 * onSave(newPrefs) é chamado após salvar — use para re-renderizar a view.
 */
export function openCardPrefsModal(onSave) {
  const current = store.get('cardPrefs') || loadCardPrefs();

  modal.open({
    title:   '⚙ Personalizar cards',
    size:    'sm',
    content: `
      <p style="font-size:0.875rem;color:var(--text-secondary);margin-bottom:16px;line-height:1.5;">
        Escolha quais informações aparecem nos cards de Kanban, Esteira,
        Calendário e Timeline. Aplica a todos os módulos.
      </p>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${CARD_FIELDS.map(f => {
          const active = current.includes(f.key);
          return `
            <label class="card-pref-item" data-key="${f.key}" style="
              display:flex;align-items:center;gap:12px;padding:10px 14px;
              border-radius:var(--radius-md);cursor:pointer;
              border:1px solid ${active?'var(--brand-gold)':'var(--border-subtle)'};
              background:${active?'rgba(212,168,67,0.07)':'var(--bg-surface)'};
              transition:all 0.15s;user-select:none;">
              <input type="checkbox" class="card-pref-cb" value="${f.key}"
                ${active?'checked':''} style="display:none;" />
              <div style="width:28px;height:28px;border-radius:var(--radius-sm);
                background:${active?'rgba(212,168,67,0.15)':'var(--bg-elevated)'};
                display:flex;align-items:center;justify-content:center;font-size:0.875rem;
                flex-shrink:0;transition:background 0.15s;">
                ${f.icon}
              </div>
              <div style="flex:1;">
                <div style="font-size:0.875rem;font-weight:500;
                  color:${active?'var(--text-primary)':'var(--text-secondary)'};">
                  ${esc(f.label)}
                </div>
              </div>
              <div class="card-pref-check" style="
                width:18px;height:18px;border-radius:50%;flex-shrink:0;
                border:2px solid ${active?'var(--brand-gold)':'var(--border-subtle)'};
                background:${active?'var(--brand-gold)':'transparent'};
                display:flex;align-items:center;justify-content:center;
                font-size:0.625rem;color:#000;transition:all 0.15s;">
                ${active?'✓':''}
              </div>
            </label>
          `;
        }).join('')}
      </div>
    `,
    footer: [
      {
        label: 'Resetar padrão', class: 'btn-secondary btn-sm', closeOnClick: false,
        onClick: async (_, { close }) => {
          const { DEFAULT_CARD_FIELDS } = await import('../services/cardPrefs.js');
          await saveCardPrefs(DEFAULT_CARD_FIELDS);
          toast.success('Preferências resetadas.');
          onSave?.(DEFAULT_CARD_FIELDS);
          close();
        },
      },
      { label: 'Cancelar', class: 'btn-secondary', closeOnClick: true },
      {
        label: 'Salvar', class: 'btn-primary', closeOnClick: false,
        onClick: async (_, { close }) => {
          const selected = Array.from(
            document.querySelectorAll('.card-pref-cb:checked')
          ).map(cb => cb.value);
          const btn = document.querySelector('.modal-footer .btn-primary');
          if(btn){ btn.classList.add('loading'); btn.disabled=true; }
          try {
            await saveCardPrefs(selected);
            toast.success('Preferências salvas!');
            onSave?.(selected);
            close();
          } catch(e) { toast.error(e.message); }
          finally { if(btn){ btn.classList.remove('loading'); btn.disabled=false; } }
        },
      },
    ],
  });

  // Bind chip toggle
  setTimeout(() => {
    document.querySelectorAll('.card-pref-item').forEach(item => {
      item.addEventListener('click', () => {
        const cb    = item.querySelector('.card-pref-cb');
        const check = item.querySelector('.card-pref-check');
        if (!cb) return;
        cb.checked             = !cb.checked;
        item.style.borderColor = cb.checked ? 'var(--brand-gold)' : 'var(--border-subtle)';
        item.style.background  = cb.checked ? 'rgba(212,168,67,0.07)' : 'var(--bg-surface)';
        const iconEl = item.querySelector('div[style*="border-radius:var(--radius-sm)"]');
        if (iconEl) iconEl.style.background = cb.checked ? 'rgba(212,168,67,0.15)' : 'var(--bg-elevated)';
        const labelEl = item.querySelectorAll('div')[2]?.querySelector('div');
        if (labelEl) labelEl.style.color = cb.checked ? 'var(--text-primary)' : 'var(--text-secondary)';
        if (check) {
          check.style.borderColor = cb.checked ? 'var(--brand-gold)' : 'var(--border-subtle)';
          check.style.background  = cb.checked ? 'var(--brand-gold)' : 'transparent';
          check.textContent       = cb.checked ? '✓' : '';
        }
      });
    });
  }, 50);
}
