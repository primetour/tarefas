/**
 * PRIMETOUR — Clock Timer Header
 *
 * Componente que aparece no topo do app quando o user (analista)
 * já bateu entrada e ainda não bateu saída. Mostra:
 *   - Tempo trabalhado real-time (h:m:s)
 *   - Botões de atalho: pausa pra almoço / volta / saída
 *
 * Pop-up de início (só pra analista): ao logar, se NÃO há registro
 * de ponto hoje, abre modal "Bom dia! Vamos começar?". Se recusar,
 * grava a recusa via declineTimeClock (vira info no relatório).
 */
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { modal } from '../components/modal.js';
import {
  fetchMyTimeClock, clockEvent, calcWorkedHours, declineTimeClock,
} from '../services/checkin.js';

let _tickInterval = null;
let _currentRec   = null;

/* ─── Verifica se deve mostrar pop-up de início ─────────────
 * Critérios:
 *  - usuário tem role 'member' (analista)
 *  - NÃO está em fim de semana
 *  - NÃO há registro de ponto hoje (nem in, nem declined)
 *  - É a primeira vez nesta sessão (sessionStorage flag) */
export async function maybeShowClockStartPrompt() {
  try {
    const profile = store.get('userProfile');
    const role    = profile?.roleId || profile?.role;
    if (role !== 'member') return;
    // Já mostrou nesta sessão?
    if (sessionStorage.getItem('ck_clock_prompt_shown') === '1') return;

    // Fim de semana? Pula.
    const dow = new Date().getDay();
    if (dow === 0 || dow === 6) return;

    const today = await fetchMyTimeClock();
    if (today?.in || today?.declined) return; // já decidiu

    sessionStorage.setItem('ck_clock_prompt_shown', '1');

    modal.open({
      title: '⏱ Iniciar registro de ponto?',
      size: 'sm',
      dedupeKey: 'clock-start-prompt',
      content: `
        <div style="text-align:center;padding:8px 0;">
          <div style="font-size:3rem;margin-bottom:8px;">🌅</div>
          <div style="font-size:1rem;font-weight:600;color:var(--text-primary);margin-bottom:6px;">
            ${greetingFor(profile?.name)}!
          </div>
          <div style="font-size:0.875rem;color:var(--text-secondary);line-height:1.5;margin-bottom:16px;">
            Detectamos que você ainda não registrou o início do expediente hoje.
            Quer registrar a entrada agora?
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted);
            padding:10px;background:var(--bg-surface);border-radius:6px;line-height:1.5;">
            <strong>Importante:</strong> se recusar, fica registrado no relatório como decisão
            consciente de não bater ponto hoje.
          </div>
        </div>
      `,
      footer: [
        {
          label: 'Não vou registrar hoje', class: 'btn-secondary', closeOnClick: false,
          onClick: async (_, { close }) => {
            const reason = prompt('Motivo (opcional):') || '';
            try {
              await declineTimeClock(reason);
              toast.info('Decisão registrada. Bom trabalho! ☕');
              close();
            } catch (e) { toast.error(e.message); }
          },
        },
        {
          label: '✅ Registrar entrada', class: 'btn-primary', closeOnClick: false,
          onClick: async (_, { close }) => {
            try {
              await clockEvent('in');
              toast.success('Entrada registrada! ⏱');
              close();
              startClockTimer();
            } catch (e) { toast.error(e.message); }
          },
        },
      ],
    });
  } catch (e) {
    console.warn('[ClockTimer] prompt error:', e?.message);
  }
}

function greetingFor(name) {
  const h = new Date().getHours();
  const greet = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const first = (name || '').split(' ')[0] || '';
  return first ? `${greet}, ${first}` : greet;
}

/* ─── Header timer (banner fixo no topo) ─────────────────── */
export function injectClockTimer() {
  if (document.getElementById('clock-timer-bar')) return;
  const div = document.createElement('div');
  div.id = 'clock-timer-bar';
  div.style.cssText = `
    display: none;
    position: fixed; top: 0; left: 0; right: 0; z-index: 99998;
    background: linear-gradient(90deg, #22C55E, #16A34A);
    color: white;
    padding: 6px 16px;
    font-size: 0.8125rem;
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    display: none;
    align-items: center;
    justify-content: center;
    gap: 16px;
    flex-wrap: wrap;
  `;
  div.innerHTML = `
    <span>⏱ <span id="clock-timer-elapsed">00:00:00</span></span>
    <span style="opacity:0.8;font-weight:400;font-size:0.75rem;" id="clock-timer-label">Trabalhando</span>
    <div style="display:flex;gap:6px;">
      <button id="clock-timer-lunch" style="background:rgba(0,0,0,0.25);color:white;
        border:1px solid rgba(255,255,255,0.4);padding:3px 10px;border-radius:4px;cursor:pointer;
        font-size:0.75rem;font-weight:600;">🍽 Almoço</button>
      <button id="clock-timer-back" style="background:rgba(0,0,0,0.25);color:white;
        border:1px solid rgba(255,255,255,0.4);padding:3px 10px;border-radius:4px;cursor:pointer;
        font-size:0.75rem;font-weight:600;display:none;">↩️ Voltei</button>
      <button id="clock-timer-out" style="background:rgba(0,0,0,0.4);color:white;
        border:1px solid rgba(255,255,255,0.6);padding:3px 10px;border-radius:4px;cursor:pointer;
        font-size:0.75rem;font-weight:700;">🌇 Saída</button>
    </div>
  `;
  document.body.appendChild(div);

  div.querySelector('#clock-timer-lunch')?.addEventListener('click', () => clockShortcut('lunchOut'));
  div.querySelector('#clock-timer-back')?.addEventListener('click', () => clockShortcut('lunchIn'));
  div.querySelector('#clock-timer-out')?.addEventListener('click', () => clockShortcut('out'));

  // Disponibiliza globalmente pra checkin.js poder forçar update
  window.__updateClockTimer = startClockTimer;

  // Inicia (se já tem registro)
  startClockTimer();
}

async function clockShortcut(eventType) {
  try {
    await clockEvent(eventType);
    const map = { lunchOut: 'pausa', lunchIn: 'volta', out: 'saída' };
    toast.success(`✅ Registrado: ${map[eventType] || eventType}`);
    startClockTimer(); // re-fetch
    // Se foi saída, esconde timer
    if (eventType === 'out') hideClockTimer();
  } catch (e) {
    toast.error(e.message);
  }
}

export async function startClockTimer() {
  const bar = document.getElementById('clock-timer-bar');
  if (!bar) return;
  const me = await fetchMyTimeClock();
  _currentRec = me;
  if (!me?.in || me?.out) {
    hideClockTimer();
    return;
  }
  bar.style.display = 'flex';
  document.body.style.paddingTop = '32px';

  // Atualiza UI dos botões conforme estado
  const lunchBtn = bar.querySelector('#clock-timer-lunch');
  const backBtn  = bar.querySelector('#clock-timer-back');
  const label    = bar.querySelector('#clock-timer-label');

  const inLunch = me?.lunchOut && !me?.lunchIn;
  if (inLunch) {
    lunchBtn.style.display = 'none';
    backBtn.style.display  = 'inline-block';
    label.textContent = 'Em pausa de almoço';
    bar.style.background = 'linear-gradient(90deg, #F59E0B, #D97706)';
  } else {
    lunchBtn.style.display = me?.lunchOut ? 'none' : 'inline-block';
    backBtn.style.display  = 'none';
    label.textContent = 'Trabalhando';
    bar.style.background = 'linear-gradient(90deg, #22C55E, #16A34A)';
  }

  // Tick a cada 1s
  if (_tickInterval) clearInterval(_tickInterval);
  _tickInterval = setInterval(() => {
    if (!_currentRec) return;
    const elapsed = elapsedSinceIn(_currentRec);
    const span = document.getElementById('clock-timer-elapsed');
    if (span) span.textContent = formatHMS(elapsed);
  }, 1000);
  // Roda uma vez imediato
  const elapsed = elapsedSinceIn(me);
  const span = document.getElementById('clock-timer-elapsed');
  if (span) span.textContent = formatHMS(elapsed);
}

function elapsedSinceIn(rec) {
  // Tempo trabalhado em segundos: from `in` to now, descontando lunch se completo
  const tsToDate = (v) => v?.toDate ? v.toDate() : (v ? new Date(v) : null);
  const tIn  = tsToDate(rec.in);
  const tOut = tsToDate(rec.out);
  const tLO  = tsToDate(rec.lunchOut);
  const tLI  = tsToDate(rec.lunchIn);
  if (!tIn) return 0;
  const end = tOut || new Date();
  let ms = end - tIn;
  if (tLO && tLI) ms -= (tLI - tLO);
  else if (tLO && !tLI) ms -= (new Date() - tLO);
  return Math.max(0, Math.floor(ms / 1000));
}

function formatHMS(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

export function hideClockTimer() {
  const bar = document.getElementById('clock-timer-bar');
  if (bar) bar.style.display = 'none';
  if (document.body.style.paddingTop === '32px') document.body.style.paddingTop = '';
  if (_tickInterval) { clearInterval(_tickInterval); _tickInterval = null; }
}
