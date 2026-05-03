/**
 * PRIMETOUR — Agent Scheduler
 *
 * Tick a cada 5min: lê agents ativos com triggers.schedule.enabled,
 * decide quais devem rodar AGORA (preset ou cron) e executa.
 * Dedup pra não rodar 2× na mesma janela em abas paralelas.
 */
import { fetchAgents, runAgent } from './agents.js?v=20260501yy';
import { store } from '../store.js';

const CHECK_INTERVAL = 5 * 60 * 1000; // 5min
const DEDUP_WINDOW   = 60 * 60 * 1000; // 1h
let _interval = null;

/* ─── Dedup (localStorage) ──────────────────────────────── */
function getDedupMap() {
  try { return JSON.parse(localStorage.getItem('agent-scheduler-runs') || '{}'); }
  catch { return {}; }
}
function setDedupMap(m) {
  try { localStorage.setItem('agent-scheduler-runs', JSON.stringify(m)); } catch {}
}
function dedupKey(agent) {
  const t = agent.triggers?.schedule || {};
  const slot = (() => {
    const d = new Date();
    if (t.preset === 'hourly') return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}`;
    if (t.preset === 'daily')  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (t.preset === 'weekly') {
      const week = Math.floor(d.getDate() / 7);
      return `${d.getFullYear()}-${d.getMonth()}-w${week}`;
    }
    if (t.preset === 'monthly') return `${d.getFullYear()}-${d.getMonth()}`;
    return d.toISOString().slice(0, 13); // hourly default
  })();
  return `agent:${agent.id}:${slot}`;
}
function wasRunRecently(key) {
  const m = getDedupMap();
  const ts = m[key];
  if (!ts) return false;
  if (Date.now() - ts > DEDUP_WINDOW) {
    delete m[key]; setDedupMap(m); return false;
  }
  return true;
}
function markRun(key) {
  const m = getDedupMap();
  m[key] = Date.now();
  // Limpa entradas antigas
  Object.keys(m).forEach(k => { if (Date.now() - m[k] > DEDUP_WINDOW) delete m[k]; });
  setDedupMap(m);
}

/* ─── Helper: "agora" no timezone do agente ──────────────── */
function getNowInTz(timezone) {
  if (!timezone) return new Date();
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date()).reduce((acc, p) => {
      if (p.type !== 'literal') acc[p.type] = parseInt(p.value);
      return acc;
    }, {});
    return new Date(parts.year, parts.month-1, parts.day, parts.hour, parts.minute, parts.second);
  } catch {
    return new Date();
  }
}

/* ─── Lógica de "deve rodar agora?" ─────────────────────── */
function shouldRun(agent) {
  const s = agent.triggers?.schedule;
  if (!s?.enabled) return false;
  const now = getNowInTz(s.timezone || 'America/Sao_Paulo');
  const hour = now.getHours();
  const minute = now.getMinutes();

  if (s.mode === 'cron') {
    return matchesCron(s.cron, now);  // now já está no TZ do agente
  }

  // Presets
  const targetHour = s.hour ?? 9;
  const targetMin  = s.minute ?? 0;
  if (s.preset === 'hourly') {
    // Roda a cada hora cheia (margem de 5min)
    return minute < 5;
  }
  if (s.preset === 'daily') {
    // Roda quando hora atual >= targetHour e ainda não rodou hoje
    return hour === targetHour && minute >= targetMin && minute < targetMin + 6;
  }
  if (s.preset === 'weekly') {
    // Toda segunda às targetHour (ou s.weekday)
    const weekday = s.weekday ?? 1; // 0=dom..6=sab
    return now.getDay() === weekday && hour === targetHour && minute < targetMin + 6;
  }
  if (s.preset === 'monthly') {
    const dom = s.dayOfMonth ?? 1;
    return now.getDate() === dom && hour === targetHour && minute < targetMin + 6;
  }
  return false;
}

/* ─── Cron simples (5 campos: minuto hora dia mês dow) ──── */
function matchesCron(expr, date) {
  if (!expr || typeof expr !== 'string') return false;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [mn, hr, dom, mo, dow] = parts;
  const fields = [
    [date.getMinutes(),  mn,  0,  59],
    [date.getHours(),    hr,  0,  23],
    [date.getDate(),     dom, 1,  31],
    [date.getMonth()+1,  mo,  1,  12],
    [date.getDay(),      dow, 0,  6],
  ];
  return fields.every(([val, expr, _min, _max]) => cronFieldMatches(val, expr));
}
function cronFieldMatches(val, expr) {
  if (expr === '*') return true;
  // Listas: 1,2,5
  if (expr.includes(',')) return expr.split(',').some(p => cronFieldMatches(val, p));
  // Ranges: 1-5
  if (expr.includes('-')) {
    const [a, b] = expr.split('-').map(Number);
    return val >= a && val <= b;
  }
  // Step: */5 ou 0-30/5
  if (expr.includes('/')) {
    const [base, stepStr] = expr.split('/');
    const step = parseInt(stepStr);
    if (base === '*') return val % step === 0;
    if (base.includes('-')) {
      const [a, b] = base.split('-').map(Number);
      return val >= a && val <= b && (val - a) % step === 0;
    }
    return val % step === 0;
  }
  return parseInt(expr) === val;
}

/* ─── Tick ──────────────────────────────────────────────── */
async function tick() {
  if (!store.get('isAuthenticated')) return;
  let agents = [];
  try { agents = await fetchAgents(); } catch (e) { return; }
  for (const agent of agents) {
    if (!agent.active) continue;
    if (!shouldRun(agent)) continue;
    const key = dedupKey(agent);
    if (wasRunRecently(key)) continue;
    markRun(key);
    try {
      console.log(`[agent-sched] running ${agent.name}`);
      // Input default: descrição ou prompt curto
      await runAgent(agent.id, agent.description || 'Execute conforme programado.');
    } catch (e) {
      console.warn(`[agent-sched] ${agent.name} err:`, e?.message);
    }
  }
}

export function startAgentScheduler() {
  if (_interval) return;
  _interval = setInterval(tick, CHECK_INTERVAL);
  // Roda primeira vez 30s depois (deixa app carregar)
  setTimeout(tick, 30000);
  console.log('[agent-sched] scheduler started (5min tick)');
}

export function stopAgentScheduler() {
  if (_interval) { clearInterval(_interval); _interval = null; }
}
