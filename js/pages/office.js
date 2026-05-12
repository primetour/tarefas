/**
 * PRIMETOUR — Escritório Virtual (4.36.0+)
 *
 * Visualização isométrica real-time dos usuários no sistema.
 * Cada sala representa um módulo; usuários aparecem como avatares na sala
 * correspondente à rota atual deles (campo presence.currentRoute).
 *
 * Visual:
 *   - SVG isométrico (sem dependências, ~viewBox 1400x900)
 *   - Salas: parallelograms com "paredes" verticais (faked 3D via Y offset)
 *   - Avatares: foto SSO (fallback inicial) em círculos com borda colorida
 *     conforme estado (verde=ativo, amarelo=idle, cinza=offline)
 *   - Animação CSS suave (300ms) quando user troca de sala
 *
 * Dados:
 *   - `presence` collection (subscribe via store.onlineUsers + idleUsers)
 *   - `absences` (quem está fora) — vão pra Sala de Descompressão
 *   - users store pra resolver nome/foto/setor
 */

import { store } from '../store.js';
import { router } from '../router.js';
import { userAvatarInner } from '../components/userAvatar.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let _unsub  = null;
let _absUnsub = null;
let _absences = [];

/* ─── Mapa de rotas → salas ─────────────────────────────────
 * Cada chave do hash maps pra uma sala. O que não bate cai em "recepcao".
 */
const ROUTE_TO_ROOM = {
  '':              'recepcao',
  'home':          'recepcao',
  'dashboards':    'comando',
  'goals':         'comando',
  'team':          'comando',
  'capacity':      'comando',
  'tasks':         'tarefas',
  'kanban':        'tarefas',
  'timeline':      'tarefas',
  'calendar':      'tarefas',
  'requests':      'tarefas',
  'workspaces':    'reunioes',
  'squad':         'reunioes',
  'portal':        'estudio',
  'portal-tips':   'estudio',
  'portal-areas':  'estudio',
  'portal-destinations': 'estudio',
  'portal-images': 'estudio',
  'portal-dashboard': 'estudio',
  'portal-tip-editor': 'estudio',
  'portal-import': 'estudio',
  'landing-pages': 'estudio',
  'cms':           'estudio',
  'arts-editor':   'estudio',
  'content-calendar': 'lousa',
  'luxury-travel': 'lousa',
  'roteiros':      'roteiros',
  'roteiro-editor':'roteiros',
  'csat':          'atendimento',
  'csat-config':   'atendimento',
  'feedbacks':     'atendimento',
  'ai-hub':        'lab-ia',
  'ai-skills':     'lab-ia',
  'users':         'admin',
  'sectors':       'admin',
  'task-types':    'admin',
  'roles':         'admin',
  'audit':         'admin',
  'governance':    'admin',
  'system-feedback':'admin',
  'settings':      'admin',
  'about':         'admin',
  'security':      'admin',
  'lgpd':          'admin',
  'system-config': 'admin',
  'dev-hours':     'admin',
  'office':        'admin',  // próprio user que está olhando o escritório
  'profile':       'cafe',
  'notifications': 'cafe',
  'help':          'cafe',
};

function routeToRoom(route) {
  if (!route) return 'recepcao';
  // pega só o primeiro segmento (antes de /)
  const seg = String(route).split('/')[0].split('?')[0];
  return ROUTE_TO_ROOM[seg] || 'recepcao';
}

/* ─── Salas: layout grid 4 colunas × 3 linhas + Descompressão ──
 * Coordenadas em "grid" (0..3 cols, 0..2 rows). renderRoom converte
 * pra coordenadas isométricas no SVG.
 */
const ROOMS = [
  { id: 'recepcao',    label: 'Recepção',         icon: '🏠', col: 0, row: 0, color: '#64748B' },
  { id: 'tarefas',     label: 'Tarefas',          icon: '📋', col: 1, row: 0, color: '#3B82F6' },
  { id: 'reunioes',    label: 'Reuniões',         icon: '📊', col: 2, row: 0, color: '#8B5CF6' },
  { id: 'comando',     label: 'Comando',          icon: '📈', col: 3, row: 0, color: '#06B6D4' },
  { id: 'estudio',     label: 'Estúdio',          icon: '🎨', col: 0, row: 1, color: '#EC4899' },
  { id: 'lousa',       label: 'Lousa',            icon: '📝', col: 1, row: 1, color: '#F59E0B' },
  { id: 'roteiros',    label: 'Roteiros',         icon: '✈',  col: 2, row: 1, color: '#10B981' },
  { id: 'atendimento', label: 'Atendimento',      icon: '💬', col: 3, row: 1, color: '#F97316' },
  { id: 'lab-ia',      label: 'Lab IA',           icon: '🤖', col: 0, row: 2, color: '#A78BFA' },
  { id: 'admin',       label: 'Admin',            icon: '⚙',  col: 1, row: 2, color: '#475569' },
  { id: 'cafe',        label: 'Café',             icon: '☕', col: 2, row: 2, color: '#92400E' },
  { id: 'descompressao', label: 'Descompressão',  icon: '🛋', col: 3, row: 2, color: '#7C3AED' },
];

/* ─── Conversão grid → isométrica ──
 * Origem do "mundo" no centro horizontal, próximo do topo.
 * Cada tile = 280px width × 160px height (vista isométrica).
 * Iso projection: x_iso = (col - row) * (W/2), y_iso = (col + row) * (H/2)
 */
// 4.36.1+ tiles maiores + mais espaço; salas não se sobrepõem mais
const TILE_W = 360;
const TILE_H = 200;
const TILE_GAP = 12;  // espaço entre tiles
const ORIGIN_X = 760;
const ORIGIN_Y = 60;
const WALL_HEIGHT = 24;

function gridToIso(col, row) {
  // 4.36.1+ TILE_GAP adiciona respiro entre salas → não sobreposição visual
  const STEP_W = TILE_W + TILE_GAP;
  const STEP_H = TILE_H + TILE_GAP;
  const x = ORIGIN_X + (col - row) * (STEP_W / 2);
  const y = ORIGIN_Y + (col + row) * (STEP_H / 2);
  return { x, y };
}

/* ── Polígono do "chão" de uma sala (rombus isométrico) ── */
function floorPolygon(cx, cy) {
  const points = [
    [cx,             cy],                       // top
    [cx + TILE_W/2,  cy + TILE_H/2],            // right
    [cx,             cy + TILE_H],              // bottom
    [cx - TILE_W/2,  cy + TILE_H/2],            // left
  ];
  return points.map(p => p.join(',')).join(' ');
}

/* ── Parede esquerda (parallelogram subindo do canto esquerdo) ── */
function leftWallPath(cx, cy, h = 50) {
  const p1 = [cx - TILE_W/2, cy + TILE_H/2];     // base esq
  const p2 = [cx,             cy + TILE_H];      // base meio
  const p3 = [cx,             cy + TILE_H - h];  // topo meio
  const p4 = [cx - TILE_W/2,  cy + TILE_H/2 - h];// topo esq
  return `M${p1[0]},${p1[1]} L${p2[0]},${p2[1]} L${p3[0]},${p3[1]} L${p4[0]},${p4[1]} Z`;
}

/* ── Parede direita ── */
function rightWallPath(cx, cy, h = 50) {
  const p1 = [cx,             cy + TILE_H];      // base meio
  const p2 = [cx + TILE_W/2,  cy + TILE_H/2];    // base direita
  const p3 = [cx + TILE_W/2,  cy + TILE_H/2 - h];// topo direita
  const p4 = [cx,             cy + TILE_H - h];  // topo meio
  return `M${p1[0]},${p1[1]} L${p2[0]},${p2[1]} L${p3[0]},${p3[1]} L${p4[0]},${p4[1]} Z`;
}

/* ─── Estado e render ─────────────────────────────────────── */

export async function renderOffice(container) {
  if (!store.isMaster() && !store.can('office_view')) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
      <p style="font-size:0.875rem;color:var(--text-muted);max-width:480px;margin:8px auto 0;">
        O Escritório Virtual é restrito a gestores e diretoria.
      </p>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">🏢 Escritório Virtual</h1>
        <p class="page-subtitle">
          Veja em tempo real quem está em cada módulo. Cada sala é um espaço de trabalho;
          usuários ausentes ficam na sala de descompressão.
        </p>
      </div>
      <div class="page-header-actions" style="display:flex;gap:8px;align-items:center;">
        <span id="office-summary" style="font-size:0.8125rem;color:var(--text-muted);"></span>
      </div>
    </div>

    <div id="office-stage" style="
      position:relative;
      width:100%;
      min-height:720px;
      background:linear-gradient(180deg, var(--bg-base) 0%, var(--bg-surface) 100%);
      border:1px solid var(--border-subtle);
      border-radius:14px;
      overflow:hidden;
      padding:12px;
    "></div>

    <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:14px;font-size:0.75rem;color:var(--text-muted);">
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="width:10px;height:10px;border-radius:50%;background:#22C55E;display:inline-block;"></span> Ativo agora
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="width:10px;height:10px;border-radius:50%;background:#F59E0B;display:inline-block;"></span> Ausente (idle)
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="width:10px;height:10px;border-radius:50%;background:#7C3AED;display:inline-block;"></span> De folga / ausência hoje
      </div>
      <div style="font-size:0.7rem;opacity:0.7;">
        Cada sala = módulo do sistema. Avatares se movem quando os usuários trocam de página.
      </div>
    </div>
  `;

  // Carrega absences de hoje (com cache)
  try {
    const cap = await import('../services/capacity.js');
    _absences = await cap.fetchAllAbsences({ startDate: new Date(), endDate: new Date() });
  } catch { _absences = []; }

  // Subscribe presence (já está sincronizado pelo startPresence) + users
  _unsub = store.subscribe('onlineUsers', () => repaint(container));
  store.subscribe('idleUsers',   () => repaint(container));
  store.subscribe('users',       () => repaint(container));

  repaint(container);
}

export function destroyOffice() {
  if (_unsub)    { _unsub();    _unsub = null; }
  if (_absUnsub) { _absUnsub(); _absUnsub = null; }
}

/* ─── Repaint: chama a cada nova snapshot ────────────────── */
function repaint(container) {
  const stageEl = container.querySelector('#office-stage');
  if (!stageEl) return;
  const summaryEl = container.querySelector('#office-summary');

  const myUid    = store.get('currentUser')?.uid;
  const allUsers = store.get('users') || [];
  const active   = store.get('onlineUsers') || [];
  const idle     = store.get('idleUsers') || [];
  const presenceByUid = new Map();
  [...active, ...idle].forEach(p => presenceByUid.set(p.uid, p));

  // Constroi a lista de "people" pra plotar
  // 1. Usuários online (active + idle) com appearInOffice !== false
  // 2. Usuários ausentes hoje → Descompressão (mesmo offline)
  const peopleByRoom = new Map(ROOMS.map(r => [r.id, []]));

  // Absences first (têm prioridade visual — vão sempre pra descompressão)
  const absentUids = new Set();
  for (const a of _absences) {
    const startMs = a.startDate?.toDate?.()?.getTime?.() || new Date(a.startDate).getTime();
    const endMs   = a.endDate?.toDate?.()?.getTime?.() || new Date(a.endDate).getTime();
    const now = Date.now();
    if (now >= startMs && now <= endMs + 24*3600*1000) {
      const u = allUsers.find(x => x.id === a.userId);
      if (u) {
        absentUids.add(u.id);
        peopleByRoom.get('descompressao').push({
          uid: u.id, name: u.name, photoURL: u.photoURL, avatarColor: u.avatarColor,
          state: 'absent', currentRoute: 'descompressao',
          absenceType: a.type,
        });
      }
    }
  }

  // Online users (que não estão em absence)
  for (const p of [...active, ...idle]) {
    if (absentUids.has(p.uid)) continue;
    if (p.appearInOffice === false) continue;
    const room = routeToRoom(p.currentRoute);
    const u = allUsers.find(x => x.id === p.uid) || {};
    peopleByRoom.get(room).push({
      uid: p.uid,
      name: p.name || u.name || 'Usuário',
      photoURL: p.photoURL || u.photoURL,
      avatarColor: p.avatarColor || u.avatarColor || '#6B7280',
      state: p.state || 'active',
      currentRoute: p.currentRoute || 'home',
      lastActivityAt: p.lastActivityAt,
      isMe: p.uid === myUid,
    });
  }

  // Render SVG
  const totalActive  = active.length;
  const totalIdle    = idle.length;
  const totalAbsent  = absentUids.size;
  if (summaryEl) {
    summaryEl.innerHTML = `
      <strong style="color:#22C55E;">${totalActive}</strong> ativos ·
      <strong style="color:#F59E0B;">${totalIdle}</strong> idle ·
      <strong style="color:#7C3AED;">${totalAbsent}</strong> ausentes hoje
    `;
  }

  stageEl.innerHTML = buildSvg(peopleByRoom);
  wireHover(stageEl);
}

/* ─── Builder principal do SVG ───────────────────────────── */
function buildSvg(peopleByRoom) {
  const rooms = ROOMS.map(r => {
    const { x, y } = gridToIso(r.col, r.row);
    const people = peopleByRoom.get(r.id) || [];
    return renderRoom(r, x, y, people);
  }).join('\n');

  // Calcula viewBox: maior diagonal = (col+row) max
  // viewBox aproximado pra acomodar todas as salas + paredes + avatares
  return `
    <style>
      /* 4.36.2+ Hover destaca a sala inteira (chão + paredes + mobília + label) */
      .office-room:hover { filter: brightness(1.15) saturate(1.2); cursor: pointer; }
      .office-room:hover polygon { stroke-opacity: 1 !important; stroke-width: 2.5 !important; }
      .office-avatar:hover { filter: drop-shadow(0 4px 8px rgba(212,168,67,0.6)); }
    </style>
    <svg viewBox="0 0 1640 1080" xmlns="http://www.w3.org/2000/svg" style="
      width:100%;height:auto;display:block;
      filter:drop-shadow(0 8px 24px rgba(0,0,0,0.15));
    ">
      <defs>
        <!-- Gradiente sutil pra cada chão -->
        <linearGradient id="floorGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%"  stop-color="rgba(255,255,255,0.08)"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0.10)"/>
        </linearGradient>
        <pattern id="floorTexture" width="40" height="20" patternUnits="userSpaceOnUse">
          <rect width="40" height="20" fill="transparent"/>
          <line x1="0" y1="10" x2="40" y2="10" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
        </pattern>
      </defs>
      ${rooms}
    </svg>
  `;
}

/* ─── Render de uma sala (parede + chão + mobília + label + avatares) ── */
function renderRoom(room, cx, cy, people) {
  const FLOOR_ALPHA = '22';
  const WALL_LEFT_ALPHA = '50';
  const WALL_RIGHT_ALPHA = '30';

  // 4.36.2+ Mobília específica da sala (renderizada antes dos avatares)
  const furniture = renderFurniture(room.id, cx, cy);

  const avatarHtml = people.map((p, i) => {
    const offset = avatarOffsetInRoom(i, people.length);
    const ax = cx + offset.x;
    const ay = cy + offset.y + TILE_H/2;
    return renderAvatar(p, ax, ay, i);
  }).join('');

  const labelX = cx;
  const labelY = cy + 22;
  const count = people.length;
  const isEmpty = count === 0;

  return `
    <g class="office-room" data-room="${room.id}" style="transition:filter .2s;">
      <!-- Parede esquerda -->
      <path d="${leftWallPath(cx, cy, WALL_HEIGHT)}" fill="${room.color}${WALL_LEFT_ALPHA}" stroke="${room.color}" stroke-width="1" opacity="0.85"/>
      <!-- Parede direita -->
      <path d="${rightWallPath(cx, cy, WALL_HEIGHT)}" fill="${room.color}${WALL_RIGHT_ALPHA}" stroke="${room.color}" stroke-width="1" opacity="0.7"/>
      <!-- Chão -->
      <polygon points="${floorPolygon(cx, cy)}" fill="${room.color}${FLOOR_ALPHA}" stroke="${room.color}" stroke-width="1.5" stroke-opacity="0.6"/>
      <polygon points="${floorPolygon(cx, cy)}" fill="url(#floorTexture)" pointer-events="none"/>

      <!-- Mobília -->
      <g class="office-furniture" style="pointer-events:none;">${furniture}</g>

      <!-- Label -->
      <g transform="translate(${labelX}, ${labelY})" style="pointer-events:none;">
        <rect x="-78" y="-13" width="156" height="22" rx="11"
          fill="${room.color}" opacity="${isEmpty ? '0.55' : '0.95'}"/>
        <text x="0" y="2" text-anchor="middle"
          style="font-family:-apple-system,sans-serif;font-size:12px;font-weight:600;fill:#fff;letter-spacing:0.01em;">
          ${esc(room.icon)} ${esc(room.label)}${count > 0 ? ` · ${count}` : ''}
        </text>
      </g>

      <!-- Avatares -->
      ${avatarHtml}
    </g>
  `;
}

/* ─── Mobília isométrica por sala (4.36.2+) ──────────────────
 * Helpers básicos: desk, chair, plant, monitor, sofa, board, etc.
 * Cada peça é um conjunto de polígonos com tom escuro nas faces inferiores
 * e tom claro nas faces superiores pra simular 3D.
 */

// Pequena mesa isométrica (vista de cima, parallelograma)
function iso_desk(x, y, w = 60, d = 30, color = '#8B6F47') {
  // top diamond
  const dx = w / 2, dy = d / 2;
  const top = `${x},${y-dy} ${x+dx},${y} ${x},${y+dy} ${x-dx},${y}`;
  // sides
  const leftSide  = `${x-dx},${y} ${x-dx},${y+10} ${x},${y+dy+10} ${x},${y+dy}`;
  const rightSide = `${x+dx},${y} ${x+dx},${y+10} ${x},${y+dy+10} ${x},${y+dy}`;
  return `
    <polygon points="${leftSide}"  fill="${shade(color, -30)}" stroke="${shade(color, -40)}" stroke-width="0.5"/>
    <polygon points="${rightSide}" fill="${shade(color, -15)}" stroke="${shade(color, -40)}" stroke-width="0.5"/>
    <polygon points="${top}"       fill="${color}" stroke="${shade(color, -30)}" stroke-width="0.5"/>
  `;
}

// Cadeira (pequeno cubo + encosto)
function iso_chair(x, y, color = '#475569') {
  const w = 16, d = 8;
  const top = `${x},${y-d/2} ${x+w/2},${y} ${x},${y+d/2} ${x-w/2},${y}`;
  return `
    <polygon points="${top}" fill="${color}" stroke="${shade(color, -30)}" stroke-width="0.5"/>
    <rect x="${x-1}" y="${y-d/2-10}" width="2" height="10" fill="${shade(color, -20)}"/>
  `;
}

// Planta (pote + folhas)
function iso_plant(x, y) {
  return `
    <ellipse cx="${x}" cy="${y+6}" rx="6" ry="2.5" fill="#92400E"/>
    <ellipse cx="${x}" cy="${y-2}" rx="9" ry="6" fill="#10B981"/>
    <ellipse cx="${x-3}" cy="${y-6}" rx="5" ry="4" fill="#16A34A"/>
    <ellipse cx="${x+3}" cy="${y-7}" rx="4" ry="4" fill="#22C55E"/>
  `;
}

// Monitor (tela em pé)
function iso_monitor(x, y, color = '#1F2937') {
  return `
    <rect x="${x-10}" y="${y-12}" width="20" height="14" fill="${color}" stroke="${shade(color, -30)}" stroke-width="0.5" rx="1"/>
    <rect x="${x-7}" y="${y-10}" width="14" height="10" fill="#3B82F6" opacity="0.4"/>
    <rect x="${x-1}" y="${y+2}" width="2" height="3" fill="${color}"/>
  `;
}

// Lousa/quadro
function iso_board(x, y) {
  return `
    <rect x="${x-22}" y="${y-18}" width="44" height="24" fill="#FFFFFF" stroke="#D4A843" stroke-width="1.5" rx="2"/>
    <line x1="${x-18}" y1="${y-12}" x2="${x-2}" y2="${y-12}" stroke="#3B82F6" stroke-width="1"/>
    <line x1="${x-18}" y1="${y-8}"  x2="${x+10}" y2="${y-8}" stroke="#EF4444" stroke-width="1"/>
    <line x1="${x-18}" y1="${y-4}"  x2="${x+4}" y2="${y-4}" stroke="#22C55E" stroke-width="1"/>
  `;
}

// Sofá (rounded rect com almofadas)
function iso_sofa(x, y, color = '#7C3AED') {
  const w = 70, d = 30;
  return `
    <rect x="${x-w/2}" y="${y-d/2}" width="${w}" height="${d}" rx="6" fill="${color}" opacity="0.85"/>
    <rect x="${x-w/2+4}" y="${y-d/2+4}" width="14" height="10" rx="3" fill="${shade(color, 30)}"/>
    <rect x="${x-w/2+22}" y="${y-d/2+4}" width="14" height="10" rx="3" fill="${shade(color, 30)}"/>
    <rect x="${x-w/2+40}" y="${y-d/2+4}" width="14" height="10" rx="3" fill="${shade(color, 30)}"/>
  `;
}

// Máquina de café
function iso_coffee(x, y) {
  return `
    <rect x="${x-8}" y="${y-12}" width="16" height="18" fill="#1F2937" rx="1"/>
    <rect x="${x-6}" y="${y-8}" width="12" height="4" fill="#D4A843"/>
    <rect x="${x-3}" y="${y-2}" width="6" height="5" fill="#92400E"/>
    <circle cx="${x}" cy="${y+4}" r="1" fill="#D4A843"/>
  `;
}

// Impressora
function iso_printer(x, y) {
  return `
    <rect x="${x-12}" y="${y-6}" width="24" height="12" fill="#475569" rx="1"/>
    <rect x="${x-10}" y="${y-2}" width="20" height="6" fill="#F1F5F9"/>
    <rect x="${x-8}" y="${y-10}" width="16" height="4" fill="#1E293B"/>
    <circle cx="${x-6}" cy="${y-4}" r="1" fill="#22C55E"/>
  `;
}

// Mala/globo (roteiros)
function iso_globe(x, y) {
  return `
    <circle cx="${x}" cy="${y-4}" r="10" fill="#3B82F6"/>
    <path d="M ${x-10},${y-4} Q ${x},${y-12} ${x+10},${y-4}" fill="none" stroke="#10B981" stroke-width="1.5"/>
    <path d="M ${x-10},${y-4} Q ${x},${y+4} ${x+10},${y-4}" fill="none" stroke="#10B981" stroke-width="1.5"/>
    <line x1="${x}" y1="${y-14}" x2="${x}" y2="${y+6}" stroke="#1F2937" stroke-width="1"/>
    <line x1="${x-6}" y1="${y+6}" x2="${x+6}" y2="${y+6}" stroke="#1F2937" stroke-width="1.5"/>
  `;
}

// Robô (lab IA)
function iso_robot(x, y) {
  return `
    <rect x="${x-9}" y="${y-12}" width="18" height="14" rx="3" fill="#A78BFA"/>
    <circle cx="${x-4}" cy="${y-7}" r="2" fill="#fff"/>
    <circle cx="${x+4}" cy="${y-7}" r="2" fill="#fff"/>
    <circle cx="${x-4}" cy="${y-7}" r="1" fill="#1F2937"/>
    <circle cx="${x+4}" cy="${y-7}" r="1" fill="#1F2937"/>
    <line x1="${x}" y1="${y-14}" x2="${x}" y2="${y-12}" stroke="#A78BFA" stroke-width="1.5"/>
    <circle cx="${x}" cy="${y-16}" r="2" fill="#D4A843">
      <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite"/>
    </circle>
    <rect x="${x-6}" y="${y+2}" width="12" height="3" fill="#7C3AED"/>
  `;
}

// Cofre/arquivo (admin)
function iso_safe(x, y) {
  return `
    <rect x="${x-12}" y="${y-12}" width="24" height="20" fill="#374151" rx="2"/>
    <rect x="${x-9}" y="${y-9}" width="18" height="14" fill="#1F2937"/>
    <circle cx="${x}" cy="${y-2}" r="3" fill="#D4A843"/>
    <line x1="${x-2}" y1="${y-2}" x2="${x+2}" y2="${y-2}" stroke="#1F2937" stroke-width="1"/>
    <line x1="${x}" y1="${y-4}" x2="${x}" y2="${y}" stroke="#1F2937" stroke-width="1"/>
  `;
}

// Cavalete de design (estúdio)
function iso_easel(x, y) {
  return `
    <line x1="${x-10}" y1="${y+8}" x2="${x-2}" y2="${y-14}" stroke="#92400E" stroke-width="1.5"/>
    <line x1="${x+10}" y1="${y+8}" x2="${x+2}" y2="${y-14}" stroke="#92400E" stroke-width="1.5"/>
    <line x1="${x}" y1="${y+8}" x2="${x}" y2="${y-12}" stroke="#92400E" stroke-width="1.5"/>
    <rect x="${x-12}" y="${y-12}" width="24" height="14" fill="#FFFFFF" stroke="#1F2937" stroke-width="0.5"/>
    <circle cx="${x-4}" cy="${y-7}" r="2" fill="#EC4899"/>
    <rect x="${x+2}" y="${y-9}" width="6" height="4" fill="#10B981"/>
  `;
}

// Helper: aclara/escurece cor hex
function shade(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.min(255, (num >> 16) + percent));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xFF) + percent));
  const b = Math.max(0, Math.min(255, (num & 0xFF) + percent));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

/* ─── Furniture map: por sala, lista de peças a renderizar ── */
function renderFurniture(roomId, cx, cy) {
  const centerY = cy + TILE_H / 2;  // centro vertical do rombus
  // Coordenadas relativas ao centro inferior da sala
  const pieces = {
    'recepcao': [
      iso_sofa(cx - 50, centerY + 50, '#64748B'),
      iso_plant(cx + 80, centerY + 40),
      iso_chair(cx + 40, centerY + 60, '#475569'),
    ],
    'tarefas': [
      iso_desk(cx - 60, centerY + 40, 50, 26),
      iso_monitor(cx - 60, centerY + 30),
      iso_chair(cx - 60, centerY + 65),
      iso_desk(cx + 50, centerY + 60, 50, 26),
      iso_monitor(cx + 50, centerY + 50),
      iso_chair(cx + 50, centerY + 85),
    ],
    'reunioes': [
      iso_desk(cx, centerY + 50, 110, 50, '#3F4A5C'),
      iso_chair(cx - 50, centerY + 30),
      iso_chair(cx - 50, centerY + 75),
      iso_chair(cx + 50, centerY + 30),
      iso_chair(cx + 50, centerY + 75),
      iso_chair(cx, centerY + 10),
      iso_chair(cx, centerY + 95),
    ],
    'comando': [
      iso_desk(cx, centerY + 55, 100, 36, '#1E293B'),
      iso_monitor(cx - 28, centerY + 40),
      iso_monitor(cx, centerY + 40),
      iso_monitor(cx + 28, centerY + 40),
      iso_chair(cx, centerY + 85),
    ],
    'estudio': [
      iso_easel(cx - 30, centerY + 45),
      iso_desk(cx + 30, centerY + 55, 50, 26, '#A07050'),
      iso_chair(cx + 30, centerY + 80),
      iso_plant(cx + 80, centerY + 80),
    ],
    'lousa': [
      iso_board(cx, centerY + 30),
      iso_desk(cx, centerY + 70, 60, 30, '#92400E'),
      iso_chair(cx - 20, centerY + 95),
      iso_chair(cx + 20, centerY + 95),
    ],
    'roteiros': [
      iso_globe(cx - 30, centerY + 50),
      iso_desk(cx + 30, centerY + 55, 50, 26, '#10B981'),
      iso_monitor(cx + 30, centerY + 45),
      iso_chair(cx + 30, centerY + 80),
    ],
    'atendimento': [
      iso_desk(cx, centerY + 40, 100, 30, '#F97316'),
      iso_monitor(cx - 28, centerY + 30),
      iso_monitor(cx + 28, centerY + 30),
      iso_chair(cx, centerY + 75),
      iso_chair(cx + 50, centerY + 75),
      iso_chair(cx - 50, centerY + 75),
    ],
    'lab-ia': [
      iso_robot(cx - 30, centerY + 45),
      iso_desk(cx + 30, centerY + 55, 50, 26, '#7C3AED'),
      iso_monitor(cx + 30, centerY + 45),
      iso_chair(cx + 30, centerY + 80),
    ],
    'admin': [
      iso_safe(cx - 40, centerY + 50),
      iso_desk(cx + 30, centerY + 55, 50, 26, '#475569'),
      iso_printer(cx + 30, centerY + 45),
      iso_chair(cx + 30, centerY + 80),
    ],
    'cafe': [
      iso_coffee(cx - 40, centerY + 45),
      iso_desk(cx + 20, centerY + 60, 60, 26, '#92400E'),
      iso_chair(cx - 5, centerY + 85),
      iso_chair(cx + 45, centerY + 85),
      iso_plant(cx - 70, centerY + 70),
    ],
    'descompressao': [
      iso_sofa(cx - 30, centerY + 50, '#7C3AED'),
      iso_sofa(cx + 50, centerY + 70, '#A78BFA'),
      iso_plant(cx - 80, centerY + 80),
      iso_plant(cx + 90, centerY + 50),
    ],
  };
  return (pieces[roomId] || []).join('');
}

/* ─── Posicionamento dos avatares dentro da sala ──
 * Distribui em padrão "escritório": 2-3 fileiras, max ~6 antes de empilhar.
 * Coordenadas relativas ao centro (cx, cy + TILE_H/2).
 */
function avatarOffsetInRoom(idx, total) {
  // 4.36.1+ Layout em grid 4 cols, distribuídos abaixo do label
  // O label fica em y ≈ +22 (topo do rombus); avatares começam em +50
  const colsPerRow = 4;
  const col = idx % colsPerRow;
  const row = Math.floor(idx / colsPerRow);
  const spacing = 38;
  const startY = 30;  // abaixo do label
  const x = (col - (colsPerRow - 1) / 2) * spacing;
  const y = startY + row * 28;
  return { x, y };
}

/* ─── Render de um avatar ─────────────────────────────────── */
function renderAvatar(person, x, y, idx = 0) {
  const stateColor = person.state === 'idle'   ? '#F59E0B'
                  : person.state === 'absent'  ? '#7C3AED'
                  : '#22C55E';
  const initials = (person.name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const photoFg  = person.photoURL || '';
  const fg       = person.avatarColor || '#3B82F6';

  // 4.36.2+ "Balanço" — cada avatar tem fase única (idx) pra animação não-sincronizada
  // Bobbing sutil de ±1.5px em Y a cada ~2.5s. Pausa quando idle/absent.
  const bobDuration = 2.4 + (idx * 0.15);  // 2.4s..3.0s+, depende do idx
  const bobOffset   = (idx % 4) * 0.3;     // delay diferente por avatar
  const isStill = person.state === 'idle' || person.state === 'absent';

  return `
    <g class="office-avatar" data-uid="${esc(person.uid)}" data-name="${esc(person.name)}"
       data-state="${esc(person.state)}" data-route="${esc(person.currentRoute || '')}"
       data-photo="${esc(photoFg)}"
       data-absence="${esc(person.absenceType || '')}"
       transform="translate(${x}, ${y})"
       style="cursor:pointer;transition:transform 600ms cubic-bezier(.4,.0,.2,1);">
      <!-- Sombra (segue o bob via animação inversa pra parecer que pulsa quando avatar sobe) -->
      <ellipse cx="0" cy="10" rx="14" ry="3" fill="rgba(0,0,0,0.25)">
        ${!isStill ? `<animate attributeName="rx" values="14;12;14" dur="${bobDuration}s" begin="${bobOffset}s" repeatCount="indefinite"/>` : ''}
        ${!isStill ? `<animate attributeName="opacity" values="0.25;0.15;0.25" dur="${bobDuration}s" begin="${bobOffset}s" repeatCount="indefinite"/>` : ''}
      </ellipse>
      <!-- Grupo do corpo (com bob animation) -->
      <g>
        ${!isStill ? `<animateTransform attributeName="transform" type="translate"
          values="0,0;0,-2;0,0;0,-1;0,0" dur="${bobDuration}s" begin="${bobOffset}s" repeatCount="indefinite"/>` : ''}
        <circle cx="0" cy="0" r="14" fill="${fg}" stroke="${stateColor}" stroke-width="2.5"/>
        ${photoFg ? `
          <clipPath id="clip-${person.uid}">
            <circle cx="0" cy="0" r="13"/>
          </clipPath>
          <image href="${esc(photoFg)}" x="-13" y="-13" width="26" height="26"
            clip-path="url(#clip-${person.uid})" preserveAspectRatio="xMidYMid slice"/>
        ` : `
          <text x="0" y="4" text-anchor="middle"
            style="font-family:-apple-system,sans-serif;font-size:11px;font-weight:700;fill:#fff;pointer-events:none;">${esc(initials)}</text>
        `}
      </g>
      ${person.isMe ? `
        <!-- Anel dourado animado pro user logado -->
        <circle cx="0" cy="0" r="17" fill="none" stroke="#D4A843" stroke-width="2" stroke-dasharray="3,2">
          <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="8s" repeatCount="indefinite"/>
        </circle>
      ` : ''}
      ${person.state === 'active' ? `
        <!-- Pulso de "presença" no estado ativo (anel verde fade) -->
        <circle cx="0" cy="0" r="14" fill="none" stroke="${stateColor}" stroke-width="2" opacity="0.6">
          <animate attributeName="r" values="14;22;14" dur="3s" begin="${bobOffset + 0.5}s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.6;0;0.6" dur="3s" begin="${bobOffset + 0.5}s" repeatCount="indefinite"/>
        </circle>
      ` : ''}
    </g>
  `;
}

/* ─── Hover tooltip ──────────────────────────────────────── */
function wireHover(stageEl) {
  let tip = null;
  const removeTip = () => { if (tip) { tip.remove(); tip = null; } };

  stageEl.querySelectorAll('.office-avatar').forEach(av => {
    av.addEventListener('mouseenter', (e) => {
      removeTip();
      const name = av.dataset.name || 'Usuário';
      const state = av.dataset.state;
      const route = av.dataset.route || '—';
      const absence = av.dataset.absence;
      const stateLabel = state === 'idle'   ? '🟡 ausente (idle)'
                      :  state === 'absent' ? `🛋 ${absence || 'ausência'} hoje`
                      :  '🟢 ativo agora';
      tip = document.createElement('div');
      tip.style.cssText = `
        position:fixed;z-index:9999;
        background:var(--bg-card, #1A2332);
        color:var(--text-primary, #E8ECF1);
        border:1px solid var(--border-default, #1E2D3D);
        border-radius:8px;padding:8px 12px;font-size:0.75rem;
        box-shadow:0 4px 12px rgba(0,0,0,0.3);pointer-events:none;
        max-width:240px;line-height:1.5;
      `;
      tip.innerHTML = `
        <div style="font-weight:600;margin-bottom:2px;">${esc(name)}</div>
        <div style="font-size:0.6875rem;opacity:0.85;">${stateLabel}</div>
        ${route !== 'descompressao' ? `<div style="font-size:0.6875rem;color:var(--text-muted);margin-top:2px;">Sala: ${esc(route)}</div>` : ''}
      `;
      document.body.appendChild(tip);
      const rect = av.getBoundingClientRect();
      tip.style.left = (rect.left + rect.width / 2 - tip.offsetWidth / 2) + 'px';
      tip.style.top  = (rect.top - tip.offsetHeight - 8) + 'px';
    });
    av.addEventListener('mouseleave', removeTip);
  });

  stageEl.addEventListener('mouseleave', removeTip);
}
