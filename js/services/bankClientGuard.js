/**
 * Bank Client Guard
 *
 * Detecta se o nome do cliente refere-se a um banco parceiro
 * (PTS, BTG Partners, BTG UltraBlue, Centurion) e exibe modal
 * de confirmação antes de gerar link público — recomenda PDF
 * por questões contratuais.
 *
 * Uso:
 *   import { detectBankClient, showBankGuardModal } from './services/bankClientGuard.js';
 *
 *   const bank = detectBankClient(clientName);
 *   if (bank && format === 'web') {
 *     showBankGuardModal({
 *       bankName: bank,
 *       clientName,
 *       module: 'Portal de Dicas',
 *       onChoosePdf:  () => generate('pdf'),
 *       onForceLink:  () => generate('web'),
 *       onCancel:     () => {},
 *     });
 *   } else {
 *     generate(format);
 *   }
 */

/**
 * Lista de bancos parceiros que exigem alerta.
 * Patterns são case-insensitive e detectam variações comuns.
 */
const BANK_PATTERNS = [
  { name: 'PTS',           regex: /\bpts\b/i,                                          contractNote: 'Programa Pravaler/PTS exige material em formato fechado (PDF).' },
  { name: 'BTG Partners',  regex: /\bbtg\s*partners?\b/i,                              contractNote: 'BTG Partners exige material em PDF para controle de distribuição.' },
  { name: 'BTG UltraBlue', regex: /\bbtg\s*ultra\s*blue\b|\bultrablue\b|\bultra\s*blue\b/i, contractNote: 'BTG UltraBlue exige PDF para tracking exclusivo do programa.' },
  { name: 'Centurion',     regex: /\bcenturion\b/i,                                    contractNote: 'American Express Centurion exige PDF assinado para clientes Black Card.' },
];

/**
 * Detecta se o nome do cliente é de um banco parceiro.
 * @param {string} name - nome do cliente digitado
 * @returns {{name: string, contractNote: string} | null}
 */
export function detectBankClient(name) {
  if (!name) return null;
  const s = String(name).trim();
  if (!s) return null;
  for (const b of BANK_PATTERNS) {
    if (b.regex.test(s)) return { name: b.name, contractNote: b.contractNote };
  }
  return null;
}

/**
 * Lista de bancos pra UI (autocomplete/datalist).
 */
export function listBankClients() {
  return BANK_PATTERNS.map(b => b.name);
}

/**
 * Detecta se a ÁREA do Portal de Dicas refere-se a um banco parceiro.
 * Use quando o user seleciona uma área (não digita o nome do cliente).
 * Mais confiavel que detectBankClient porque areas tem nomes consistentes.
 *
 * Detecta variacoes: "PTS", "PTS Bradesco", "Bradesco PTS", etc.
 *
 * @param {Object|string} area - { id, name } ou string com o nome
 * @returns {{name: string, contractNote: string} | null}
 */
export function detectBankArea(area) {
  if (!area) return null;
  const name = typeof area === 'string' ? area : (area.name || area.label || area.id || '');
  if (!name) return null;
  // Reusa os mesmos patterns — funciona pra "PTS Bradesco", "BTG Partners",
  // "BTG UltraBlue", "Centurion Black" etc.
  return detectBankClient(name);
}

/**
 * Helper combinado: detecta cliente OU área.
 * Prioriza area se ambos baterem (mais confiavel).
 *
 * @param {Object} ctx - { clientName?: string, area?: Object|string }
 * @returns {{ source: 'area'|'client', name: string, contractNote: string } | null}
 */
export function detectBankContext({ clientName, area }) {
  const byArea = detectBankArea(area);
  if (byArea) return { source: 'area', ...byArea };
  const byClient = detectBankClient(clientName);
  if (byClient) return { source: 'client', ...byClient };
  return null;
}

/**
 * Modal de confirmação. Usuário escolhe entre PDF (recomendado),
 * gerar link mesmo assim, ou cancelar.
 *
 * @param {Object} opts
 * @param {string} opts.bankName       - nome do banco detectado
 * @param {string} opts.clientName     - nome digitado pelo user
 * @param {string} opts.module         - 'Portal de Dicas' | 'Roteiros'
 * @param {string} opts.contractNote   - razão contratual
 * @param {Function} opts.onChoosePdf  - callback quando user escolhe PDF
 * @param {Function} opts.onForceLink  - callback quando user insiste no link
 * @param {Function} [opts.onCancel]   - callback opcional ao cancelar
 */
export function showBankGuardModal({ bankName, clientName, module, contractNote, onChoosePdf, onForceLink, onCancel }) {
  const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const m = document.createElement('div');
  m.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:3000;
    display:flex;align-items:center;justify-content:center;padding:20px;`;
  m.innerHTML = `
    <div class="card" style="width:100%;max-width:520px;padding:0;overflow:hidden;">
      <div style="padding:20px 22px;background:linear-gradient(135deg, rgba(245,158,11,0.18), rgba(239,68,68,0.10));
        border-bottom:1px solid var(--border-subtle);">
        <div style="display:flex;align-items:center;gap:12px;">
          <div style="font-size:2rem;flex-shrink:0;">⚠</div>
          <div>
            <div style="font-weight:700;font-size:1rem;color:var(--text-primary);margin-bottom:2px;">
              Cliente do banco detectado: <span style="color:#F59E0B;">${esc(bankName)}</span>
            </div>
            <div style="font-size:0.75rem;color:var(--text-muted);">
              Em "${esc(clientName)}" · módulo ${esc(module)}
            </div>
          </div>
        </div>
      </div>

      <div style="padding:20px 22px;">
        <div style="font-size:0.875rem;color:var(--text-secondary);line-height:1.6;margin-bottom:14px;">
          <strong>Recomendamos gerar o PDF</strong> (em vez de link web) para este cliente.
        </div>
        <div style="background:rgba(245,158,11,0.07);border-left:3px solid #F59E0B;
          border-radius:0 6px 6px 0;padding:10px 14px;font-size:0.8125rem;line-height:1.55;
          color:var(--text-secondary);margin-bottom:18px;">
          <strong style="color:#F59E0B;">Razão contratual:</strong> ${esc(contractNote)}
        </div>
        <div style="font-size:0.75rem;color:var(--text-muted);line-height:1.5;margin-bottom:0;">
          Você pode escolher gerar o link mesmo assim — a responsabilidade pelo cumprimento contratual fica com você.
        </div>
      </div>

      <div style="padding:14px 22px;border-top:1px solid var(--border-subtle);
        background:var(--bg-surface);display:flex;flex-direction:column;gap:8px;">
        <!-- Botão primário: PDF (largura total, destaque) -->
        <button class="btn btn-primary" id="bg-pdf"
          style="width:100%;padding:12px;font-weight:600;font-size:0.875rem;">
          📄 Gerar PDF (recomendado)
        </button>
        <!-- Linha secundária: 2 botões lado a lado -->
        <div style="display:flex;gap:8px;">
          <button class="btn btn-secondary btn-sm" id="bg-cancel"
            style="flex:1;padding:8px 14px;font-size:0.8125rem;">
            Cancelar
          </button>
          <button class="btn btn-secondary btn-sm" id="bg-force-link"
            style="flex:2;padding:8px 14px;font-size:0.8125rem;
            color:#F59E0B;border-color:rgba(245,158,11,0.4);">
            ⚠ Gerar link mesmo assim
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) close('cancel'); });

  function close(action) {
    m.remove();
    if (action === 'pdf') onChoosePdf?.();
    else if (action === 'link') onForceLink?.();
    else onCancel?.();
  }

  document.getElementById('bg-cancel')?.addEventListener('click', () => close('cancel'));
  document.getElementById('bg-force-link')?.addEventListener('click', () => {
    if (!confirm(`Confirma geração de LINK WEB para ${bankName}?\nResponsabilidade contratual fica com você.`)) return;
    close('link');
  });
  document.getElementById('bg-pdf')?.addEventListener('click', () => close('pdf'));

  // ESC fecha
  const onKey = (e) => {
    if (e.key === 'Escape') { close('cancel'); window.removeEventListener('keydown', onKey); }
  };
  window.addEventListener('keydown', onKey);
}
