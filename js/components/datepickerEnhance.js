/**
 * PRIMETOUR — Datepicker Enhance
 *
 * Por default, `<input type="date">` só abre o calendário quando o user
 * clica no pequeno ícone do indicator (canto direito do input). Click no
 * corpo do input só permite digitar manualmente — UX confusa, especialmente
 * em mobile / quando o ícone fica muito discreto.
 *
 * Esta função wire-up garante que:
 *   - Click em qualquer parte do input abre o datepicker (via showPicker())
 *   - Funciona em Chrome 99+, Edge 99+, Safari 16+, Firefox 101+
 *   - Em browsers antigos sem showPicker(), cai no comportamento default
 *     (digitação manual + ícone ainda funciona)
 *
 * Uso:
 *   import { enhanceDatepickers } from './components/datepickerEnhance.js';
 *   enhanceDatepickers(modalElement);   // ou document.body
 *
 * Idempotente: pode ser chamado múltiplas vezes no mesmo escopo sem
 * adicionar listeners duplicados (usa flag dataset).
 */

const TYPES = ['date', 'datetime-local', 'month', 'time', 'week'];

export function enhanceDatepickers(scope = document.body) {
  if (!scope) return;
  const inputs = scope.querySelectorAll(TYPES.map(t => `input[type="${t}"]`).join(','));
  inputs.forEach(input => {
    if (input.dataset.dpEnhanced) return;   // já wired
    input.dataset.dpEnhanced = '1';

    input.addEventListener('click', (e) => {
      // Se o user clicou em um botão de incremento (spinner) ou no próprio
      // indicator, não interfira — o browser já cuida disso.
      // Mas se clicou no body do input (campo de texto), abre o picker.
      if (typeof input.showPicker === 'function') {
        try {
          input.showPicker();
          // Só prevent default se o showPicker funcionou — em alguns
          // navegadores móveis o focus já abre o picker, e cancelar
          // o evento bloquearia teclados nativos. Não fazemos preventDefault.
        } catch (_) { /* alguns browsers bloqueiam fora de user gesture */ }
      }
    });

    // Também abre no focus (suporta navegação por TAB)
    input.addEventListener('focus', () => {
      if (typeof input.showPicker === 'function') {
        // Pequeno delay pra evitar conflito com browsers que abrem sozinho
        setTimeout(() => {
          try { input.showPicker(); } catch (_) {}
        }, 0);
      }
    }, { once: false });
  });
}
