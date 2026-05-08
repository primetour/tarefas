/**
 * PRIMETOUR — Sound Library
 *
 * Banco de sons de conclusão de tarefa. Cada usuário escolhe o seu via
 * `prefs.completionSoundId`. Default: 'plin' (compat com versões anteriores).
 *
 * Tipos:
 *   - synth: gerado via Web Audio API (sem arquivo, zero latência, sempre disponível)
 *   - file:  arquivo MP3 em `assets/sounds/{file}` (lazy load + cache em memória)
 *
 * Adicionar um novo som:
 *   - Synth: implementar função em SYNTH_PLAYERS abaixo
 *   - File:  dropar `assets/sounds/{x}.mp3` no repo (~30-50KB ideal)
 *
 * Tocar um som:
 *   import { playSound } from '../services/sounds.js';
 *   playSound('lion');                    // toca pelo id
 *   playSound(getCurrentCompletionSound()); // toca o atual do user
 */

/* ─── AudioContext singleton + primer ──────────────────────
 * Browsers modernos bloqueiam áudio até o usuário interagir. Primamos
 * o context no primeiro click/keydown da sessão pra ele ficar 'running'
 * permanentemente. Mesma estratégia do tasks.js.
 */
let _ctx = null;
let _primed = false;

function _ensureCtx() {
  if (_ctx) return _ctx;
  try {
    _ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch { /* sem Web Audio */ }
  return _ctx;
}

if (typeof window !== 'undefined' && !_primed) {
  const primer = () => {
    if (_primed) return;
    _primed = true;
    const ctx = _ensureCtx();
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
    window.removeEventListener('click',     primer, true);
    window.removeEventListener('keydown',   primer, true);
    window.removeEventListener('touchstart', primer, true);
  };
  window.addEventListener('click',     primer, true);
  window.addEventListener('keydown',   primer, true);
  window.addEventListener('touchstart', primer, true);
}

/* ─── Catálogo público ─────────────────────────────────── */

export const SOUND_LIBRARY = [
  // ─── Sintéticos clássicos ───
  { id: 'plin',       label: 'Plin',              icon: '✨', category: 'classic', synth: true, default: true,
    description: 'Tríade ascendente C6→E6→G6 (som original do sistema).' },
  { id: 'bell',       label: 'Sino',              icon: '🔔', category: 'classic', synth: true,
    description: 'Sino tradicional com decaimento longo.' },
  { id: 'chime',      label: 'Carrilhão',         icon: '🎐', category: 'classic', synth: true,
    description: 'Quatro notas em cascata, suave e elegante.' },
  { id: 'pop',        label: 'Pop',               icon: '💭', category: 'classic', synth: true,
    description: 'Bolinha estourando — bem curto.' },
  { id: 'tada',       label: 'Tada!',             icon: '🎉', category: 'classic', synth: true,
    description: 'Pequena fanfarra de comemoração.' },
  { id: 'success',    label: 'Sucesso UI',        icon: '✅', category: 'classic', synth: true,
    description: 'Som moderno de UI — sweep ascendente curto.' },

  // ─── Sintéticos divertidos / inspirados em jogos ───
  { id: 'coin',       label: 'Moeda',             icon: '🪙', category: 'fun',     synth: true,
    description: 'Inspirado nas moedas do Mario.' },
  { id: 'level-up',   label: 'Subiu de nível',    icon: '⬆️', category: 'fun',     synth: true,
    description: 'Inspirado em RPG — arpejo ascendente vitorioso.' },
  { id: 'clown-horn', label: 'Buzina de palhaço', icon: '🤡', category: 'fun',     synth: true,
    description: 'Honk-honk descendente. Para humor.' },
  { id: 'laser',      label: 'Laser',             icon: '🔫', category: 'fun',     synth: true,
    description: 'Pew-pew espacial.' },

  // ─── Arquivos (slots — aguardam MP3 em assets/sounds/) ───
  { id: 'lion',       label: 'Leão rugindo',      icon: '🦁', category: 'fun',     file: 'lion.mp3',
    description: 'Rugido de leão — animal real, requer MP3.' },
  { id: 'sheep',      label: 'Ovelha',            icon: '🐑', category: 'fun',     file: 'sheep.mp3',
    description: 'Mééé — animal real, requer MP3.' },
  { id: 'dog-bark',   label: 'Latido',            icon: '🐕', category: 'fun',     file: 'dog-bark.mp3',
    description: 'Au au — animal real, requer MP3.' },

  // ─── Especial ───
  { id: 'mute',       label: 'Mudo',              icon: '🔇', category: 'meta',    mute: true,
    description: 'Sem som ao concluir tarefas.' },
];

/* Index por id para lookup O(1). */
const BY_ID = Object.fromEntries(SOUND_LIBRARY.map(s => [s.id, s]));
export const DEFAULT_SOUND_ID = SOUND_LIBRARY.find(s => s.default)?.id || 'plin';

/* ─── Synth players ───────────────────────────────────── */

function _envelope(gain, t0, attack, peak, decay) {
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + attack + decay);
}

function _tone(ctx, freq, t0, dur, type = 'sine', peak = 0.22) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  _envelope(gain, t0, 0.005, peak, dur);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

const SYNTH_PLAYERS = {
  plin(ctx) {
    const now = ctx.currentTime;
    [1047, 1319, 1568].forEach((freq, i) => _tone(ctx, freq, now + i * 0.1, 0.35, 'sine', 0.22));
  },

  bell(ctx) {
    // Bell: fundamental + harmônicos com decaimento longo
    const now = ctx.currentTime;
    const f = 880; // A5
    [1, 2.76, 5.4].forEach((mult, i) => {
      const peak = [0.35, 0.18, 0.08][i];
      _tone(ctx, f * mult, now, 1.2, 'sine', peak);
    });
  },

  chime(ctx) {
    // Carrilhão: 4 notas em cascata, FM-like via triangle
    const now = ctx.currentTime;
    [1175, 1397, 1760, 2349].forEach((freq, i) => {
      _tone(ctx, freq, now + i * 0.08, 0.5, 'triangle', 0.15);
    });
  },

  pop(ctx) {
    // Curto burst de noise filtrado
    const now = ctx.currentTime;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / data.length * 4);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 800;
    filter.Q.value = 8;
    const gain = ctx.createGain();
    gain.gain.value = 0.4;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(now);
  },

  tada(ctx) {
    // Pequena fanfarra: 2 notas curtas + acorde sustentado
    const now = ctx.currentTime;
    _tone(ctx, 784,  now,         0.10, 'square', 0.18);   // G5 staccato
    _tone(ctx, 784,  now + 0.13,  0.10, 'square', 0.18);   // G5 staccato
    // Acorde C maior (C5+E5+G5) sustentado
    [523, 659, 784].forEach(f => _tone(ctx, f, now + 0.28, 0.55, 'square', 0.14));
  },

  success(ctx) {
    // Sweep ascendente UI moderno
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523, now);
    osc.frequency.exponentialRampToValueAtTime(1568, now + 0.18);
    _envelope(gain, now, 0.005, 0.25, 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  },

  coin(ctx) {
    // Coin Mario-like: 2 notas square wave (B5 → E6)
    const now = ctx.currentTime;
    _tone(ctx, 988,  now,        0.08, 'square', 0.18);  // B5
    _tone(ctx, 1319, now + 0.09, 0.40, 'square', 0.18);  // E6
  },

  'level-up'(ctx) {
    // Arpejo ascendente vitorioso (Zelda-ish)
    const now = ctx.currentTime;
    [523, 659, 784, 1047, 1319].forEach((freq, i) => {
      _tone(ctx, freq, now + i * 0.07, 0.25, 'triangle', 0.20);
    });
    // Acorde final
    [1047, 1319, 1568].forEach(f => _tone(ctx, f, now + 0.45, 0.6, 'triangle', 0.18));
  },

  'clown-horn'(ctx) {
    // Honk-honk descendente
    const now = ctx.currentTime;
    [392, 330].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      _envelope(gain, now + i * 0.18, 0.01, 0.22, 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.2);
    });
  },

  laser(ctx) {
    // Pew descendente rápido
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(2000, now);
    osc.frequency.exponentialRampToValueAtTime(200, now + 0.18);
    _envelope(gain, now, 0.002, 0.20, 0.15);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.25);
  },
};

/* ─── File player com cache ───────────────────────────── */

const _fileCache = new Map();    // id → AudioBuffer
const _fileFailed = new Set();   // ids que já falharam (não reintenta)

async function _loadFile(meta) {
  if (_fileCache.has(meta.id)) return _fileCache.get(meta.id);
  if (_fileFailed.has(meta.id)) return null;
  try {
    const ctx = _ensureCtx();
    if (!ctx) return null;
    const url = `assets/sounds/${meta.file}`;
    const res = await fetch(url);
    if (!res.ok) {
      // 404 esperado pra slots ainda sem MP3 — silencioso
      _fileFailed.add(meta.id);
      return null;
    }
    const arr = await res.arrayBuffer();
    const buf = await ctx.decodeAudioData(arr);
    _fileCache.set(meta.id, buf);
    return buf;
  } catch (e) {
    _fileFailed.add(meta.id);
    console.warn(`[sounds] falhou pra carregar ${meta.id}:`, e.message);
    return null;
  }
}

function _playBuffer(ctx, buf) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const gain = ctx.createGain();
  gain.gain.value = 0.7;
  src.connect(gain).connect(ctx.destination);
  src.start();
}

/* ─── API pública ─────────────────────────────────────── */

/** Verifica se um som está disponível agora (synth sempre OK; file só se carregado/possível). */
export function isSoundAvailable(id) {
  const meta = BY_ID[id];
  if (!meta) return false;
  if (meta.mute) return true;
  if (meta.synth) return true;
  if (meta.file) return !_fileFailed.has(id);
  return false;
}

/**
 * Toca o som pelo id. Se o som requer arquivo e o arquivo ainda não foi
 * carregado, baixa e cacheia. Se falhar (slot ainda sem MP3), faz fallback
 * silencioso pro 'plin' default.
 */
export async function playSound(id) {
  const meta = BY_ID[id] || BY_ID[DEFAULT_SOUND_ID];
  if (!meta || meta.mute) return;

  const ctx = _ensureCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch (_) { return; }
  }

  if (meta.synth) {
    try { SYNTH_PLAYERS[meta.id]?.(ctx); }
    catch (e) { console.warn(`[sounds] synth ${meta.id} falhou:`, e.message); }
    return;
  }

  if (meta.file) {
    const buf = await _loadFile(meta);
    if (buf) {
      _playBuffer(ctx, buf);
    } else {
      // Fallback silencioso pro default — nunca deixa o user "sem som"
      // se o slot dele não tem MP3 (ex: escolheu lion mas ninguém subiu)
      if (id !== DEFAULT_SOUND_ID) {
        try { SYNTH_PLAYERS[DEFAULT_SOUND_ID]?.(ctx); } catch (_) {}
      }
    }
  }
}

/**
 * Pré-carrega arquivos em background (chamado no profile quando user passa
 * o mouse num card de file, por ex). Idempotente.
 */
export function preloadSound(id) {
  const meta = BY_ID[id];
  if (meta?.file) _loadFile(meta).catch(() => {});
}
