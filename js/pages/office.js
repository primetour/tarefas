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
// 4.36.3+ Atividade recente — uids que disparou ação nos últimos 60s
let _recentActivityUids = new Set();
let _activityPollTimer = null;

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
// 4.36.4+ Labels alinhados com os módulos reais do sistema
const ROOMS = [
  { id: 'recepcao',      label: 'Meu Painel',           icon: '🏠', col: 0, row: 0, color: '#64748B', defaultRoute: 'home' },
  { id: 'tarefas',       label: 'Tarefas',              icon: '📋', col: 1, row: 0, color: '#3B82F6', defaultRoute: 'tasks' },
  { id: 'reunioes',      label: 'Squads',               icon: '🤝', col: 2, row: 0, color: '#8B5CF6', defaultRoute: 'workspaces' },
  { id: 'comando',       label: 'Dashboards',           icon: '📊', col: 3, row: 0, color: '#06B6D4', defaultRoute: 'dashboards' },
  { id: 'estudio',       label: 'Portal de Dicas',      icon: '🌍', col: 0, row: 1, color: '#EC4899', defaultRoute: 'portal-tips' },
  { id: 'lousa',         label: 'Calendário de Conteúdo', icon: '📅', col: 1, row: 1, color: '#F59E0B', defaultRoute: 'content-calendar' },
  { id: 'roteiros',      label: 'Roteiros de Viagem',   icon: '✈',  col: 2, row: 1, color: '#10B981', defaultRoute: 'roteiros' },
  { id: 'atendimento',   label: 'CSAT',                 icon: '💬', col: 3, row: 1, color: '#F97316', defaultRoute: 'csat' },
  { id: 'lab-ia',        label: 'IA Hub',               icon: '🤖', col: 0, row: 2, color: '#A78BFA', defaultRoute: 'ai-hub' },
  { id: 'admin',         label: 'Administração',        icon: '⚙',  col: 1, row: 2, color: '#475569', defaultRoute: 'users' },
  { id: 'cafe',          label: 'Perfil',               icon: '👤', col: 2, row: 2, color: '#92400E', defaultRoute: 'profile' },
  // Fora hoje = users com absences ativas (módulo Equipe/Capacidade)
  { id: 'descompressao', label: 'Fora hoje',            icon: '🌴', col: 3, row: 2, color: '#7C3AED', defaultRoute: 'team' },
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
          Veja em tempo real quem está trabalhando em cada módulo do sistema.
          Clique em uma sala para ir até ela. Quem está fora hoje aparece em "Fora hoje".
        </p>
      </div>
      <div class="page-header-actions" style="display:flex;gap:8px;align-items:center;">
        <span id="office-summary" style="font-size:0.8125rem;color:var(--text-muted);"></span>
      </div>
    </div>

    <!-- 4.37.0+ Stage com background dinâmico (day/night cycle) -->
    <div id="office-stage" style="
      position:relative;
      width:100%;
      min-height:720px;
      background:${getTimeOfDayGradient()};
      border:1px solid var(--border-subtle);
      border-radius:14px;
      overflow:hidden;
      padding:12px;
      transition:background 1.5s ease-in-out;
    "></div>

    <!-- 4.37.0+ Activity feed flutuante (toasts narrando ações) -->
    <div id="office-activity-feed" style="
      position:fixed;
      right:24px;
      bottom:24px;
      z-index:50;
      display:flex;
      flex-direction:column;
      gap:8px;
      pointer-events:none;
      max-width:320px;
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

  // 4.36.3+ Polling de audit_logs recentes pra detectar atividade nos últimos 60s
  await pollRecentActivity();
  _activityPollTimer = setInterval(async () => {
    await pollRecentActivity();
    // 4.37.0+ Também busca eventos novos e mostra como toasts flutuantes
    await pollAndShowActivities(container);
    repaint(container);
  }, 20000);

  // 4.37.0+ Atualiza background gradient a cada 10min (day/night cycle)
  setInterval(() => {
    const stage = container.querySelector('#office-stage');
    if (stage) stage.style.background = getTimeOfDayGradient();
  }, 10 * 60 * 1000);

  repaint(container);
}

async function pollRecentActivity() {
  try {
    const { db } = await import('../firebase.js');
    const { collection, query, where, getDocs, Timestamp, limit } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const sinceMs = Date.now() - 60 * 1000;
    const snap = await getDocs(query(
      collection(db, 'audit_logs'),
      where('timestamp', '>=', Timestamp.fromMillis(sinceMs)),
      limit(100),
    ));
    _recentActivityUids = new Set(snap.docs.map(d => d.data().userId).filter(Boolean));
  } catch (e) {
    // Sem permissão pra audit_logs: ignora — recentActivity simplesmente fica vazio
    _recentActivityUids = new Set();
  }
}

export function destroyOffice() {
  if (_unsub)    { _unsub();    _unsub = null; }
  if (_absUnsub) { _absUnsub(); _absUnsub = null; }
  if (_activityPollTimer) { clearInterval(_activityPollTimer); _activityPollTimer = null; }
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
      recentActivity: _recentActivityUids.has(p.uid),
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
  wireInteractions(stageEl);
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
    <g class="office-room" data-room="${room.id}" data-route="${esc(room.defaultRoute || '')}"
       style="transition:filter .2s;${count > 0 ? `filter:drop-shadow(0 0 12px ${room.color}aa);` : ''}">
      <!-- Parede esquerda -->
      <path d="${leftWallPath(cx, cy, WALL_HEIGHT)}" fill="${room.color}${WALL_LEFT_ALPHA}" stroke="${room.color}" stroke-width="1" opacity="0.85" pointer-events="none"/>
      <!-- Parede direita -->
      <path d="${rightWallPath(cx, cy, WALL_HEIGHT)}" fill="${room.color}${WALL_RIGHT_ALPHA}" stroke="${room.color}" stroke-width="1" opacity="0.7" pointer-events="none"/>
      <!-- Chão (clickable) -->
      <polygon class="office-floor" points="${floorPolygon(cx, cy)}"
        fill="${room.color}${FLOOR_ALPHA}" stroke="${room.color}" stroke-width="1.5" stroke-opacity="0.6"
        style="cursor:pointer;"/>
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

/* ─── PRIMITIVOS EXTRAS (4.36.4+) ───────────────────────────
 * Conjunto expandido pra dar contexto a cada sala. Todos
 * desenhados em "vista isométrica fake" — top diamond com 2 sides.
 */

// Tapete (área rug — chão decorado dentro da sala)
function iso_rug(cx, cy, w = 140, d = 80, color = '#92400E') {
  const dx = w/2, dy = d/2;
  return `
    <polygon points="${cx},${cy-dy} ${cx+dx},${cy} ${cx},${cy+dy} ${cx-dx},${cy}"
      fill="${color}" opacity="0.35" stroke="${shade(color, -20)}" stroke-width="0.5" stroke-dasharray="3,3"/>
  `;
}

// Quadro / poster (frame na parede — pequeno, decorativo)
function iso_poster(x, y, w = 22, h = 16, color = '#3B82F6') {
  return `
    <rect x="${x - w/2}" y="${y - h/2}" width="${w}" height="${h}"
      fill="${color}" stroke="${shade(color, -40)}" stroke-width="1" rx="1"/>
    <rect x="${x - w/2 + 2}" y="${y - h/2 + 2}" width="${w - 4}" height="${h - 4}"
      fill="${shade(color, 40)}" opacity="0.6"/>
  `;
}

// Estante / Bookshelf
function iso_bookshelf(x, y) {
  return `
    <rect x="${x-18}" y="${y-22}" width="36" height="28" fill="#5C4033" stroke="#3D2817" stroke-width="0.5"/>
    <line x1="${x-18}" y1="${y-15}" x2="${x+18}" y2="${y-15}" stroke="#3D2817" stroke-width="0.5"/>
    <line x1="${x-18}" y1="${y-7}" x2="${x+18}" y2="${y-7}" stroke="#3D2817" stroke-width="0.5"/>
    <line x1="${x-18}" y1="${y+1}" x2="${x+18}" y2="${y+1}" stroke="#3D2817" stroke-width="0.5"/>
    <!-- livros -->
    <rect x="${x-15}" y="${y-21}" width="3" height="6" fill="#DC2626"/>
    <rect x="${x-11}" y="${y-21}" width="3" height="6" fill="#1E40AF"/>
    <rect x="${x-7}" y="${y-21}" width="3" height="6" fill="#15803D"/>
    <rect x="${x-3}" y="${y-21}" width="3" height="6" fill="#D97706"/>
    <rect x="${x+1}" y="${y-21}" width="3" height="6" fill="#7C2D12"/>
    <rect x="${x+5}" y="${y-21}" width="3" height="6" fill="#1F2937"/>
    <rect x="${x-14}" y="${y-13}" width="3" height="6" fill="#0E7490"/>
    <rect x="${x-10}" y="${y-13}" width="3" height="6" fill="#9A3412"/>
    <rect x="${x+0}" y="${y-13}" width="3" height="6" fill="#1E40AF"/>
    <rect x="${x+4}" y="${y-13}" width="3" height="6" fill="#15803D"/>
  `;
}

// Mapa mundi grande (parede)
function iso_worldmap(x, y) {
  return `
    <rect x="${x-28}" y="${y-20}" width="56" height="32" fill="#0EA5E9" stroke="#0369A1" stroke-width="1" rx="1"/>
    <!-- continentes esquemáticos -->
    <path d="M${x-22},${y-12} L${x-15},${y-10} L${x-13},${y-3} L${x-18},${y+2} L${x-23},${y-2} Z"
      fill="#16A34A" opacity="0.8"/>
    <path d="M${x-10},${y-8} L${x},${y-13} L${x+5},${y-5} L${x+3},${y+5} L${x-8},${y+3} Z"
      fill="#16A34A" opacity="0.8"/>
    <path d="M${x+8},${y-10} L${x+20},${y-8} L${x+22},${y+0} L${x+15},${y+8} L${x+10},${y+3} Z"
      fill="#16A34A" opacity="0.8"/>
    <!-- pinos -->
    <circle cx="${x-15}" cy="${y-5}" r="1.5" fill="#EF4444"/>
    <circle cx="${x+8}" cy="${y-2}" r="1.5" fill="#EF4444"/>
    <circle cx="${x-3}" cy="${y+2}" r="1.5" fill="#EF4444"/>
  `;
}

// Sticky notes (post-its colados)
function iso_sticky_notes(x, y) {
  return `
    <rect x="${x-12}" y="${y-12}" width="11" height="11" fill="#FEF08A" stroke="#CA8A04" stroke-width="0.3" transform="rotate(-5 ${x} ${y})"/>
    <rect x="${x-2}" y="${y-13}" width="11" height="11" fill="#FCA5A5" stroke="#B91C1C" stroke-width="0.3" transform="rotate(3 ${x} ${y})"/>
    <rect x="${x+1}" y="${y-3}" width="11" height="11" fill="#86EFAC" stroke="#15803D" stroke-width="0.3" transform="rotate(-2 ${x} ${y})"/>
    <rect x="${x-11}" y="${y-1}" width="11" height="11" fill="#93C5FD" stroke="#1E40AF" stroke-width="0.3" transform="rotate(6 ${x} ${y})"/>
  `;
}

// Kanban board (parede) — para sala de Tarefas
function iso_kanban_board(x, y) {
  return `
    <rect x="${x-32}" y="${y-22}" width="64" height="32" fill="#1F2937" stroke="#0F172A" stroke-width="1" rx="1"/>
    <!-- 3 colunas To Do / Doing / Done -->
    <rect x="${x-29}" y="${y-19}" width="18" height="26" fill="#374151"/>
    <rect x="${x-10}" y="${y-19}" width="18" height="26" fill="#374151"/>
    <rect x="${x+9}"  y="${y-19}" width="18" height="26" fill="#374151"/>
    <!-- cards -->
    <rect x="${x-27}" y="${y-17}" width="14" height="5" fill="#EF4444" rx="0.5"/>
    <rect x="${x-27}" y="${y-10}" width="14" height="5" fill="#F59E0B" rx="0.5"/>
    <rect x="${x-27}" y="${y-3}"  width="14" height="5" fill="#F59E0B" rx="0.5"/>
    <rect x="${x-8}"  y="${y-17}" width="14" height="5" fill="#3B82F6" rx="0.5"/>
    <rect x="${x-8}"  y="${y-10}" width="14" height="5" fill="#3B82F6" rx="0.5"/>
    <rect x="${x+11}" y="${y-17}" width="14" height="5" fill="#22C55E" rx="0.5"/>
    <rect x="${x+11}" y="${y-10}" width="14" height="5" fill="#22C55E" rx="0.5"/>
    <rect x="${x+11}" y="${y-3}"  width="14" height="5" fill="#22C55E" rx="0.5"/>
    <rect x="${x+11}" y="${y+4}"  width="14" height="5" fill="#22C55E" rx="0.5"/>
  `;
}

// Calendário wall (sala do calendário de conteúdo)
function iso_wall_calendar(x, y) {
  return `
    <rect x="${x-30}" y="${y-24}" width="60" height="36" fill="#FFFFFF" stroke="#D4A843" stroke-width="1.5" rx="2"/>
    <rect x="${x-30}" y="${y-24}" width="60" height="8" fill="#D4A843"/>
    <text x="${x}" y="${y-18}" text-anchor="middle" font-size="6" fill="#fff" font-weight="700">CALENDÁRIO</text>
    <!-- grid 5x4 dias -->
    ${(() => {
      let cells = '';
      for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
        const cx2 = x - 26 + i * 11;
        const cy2 = y - 14 + j * 6.5;
        cells += `<rect x="${cx2}" y="${cy2}" width="10" height="6" fill="${(i+j) % 2 ? '#F8FAFC' : '#E5E7EB'}" stroke="#CBD5E1" stroke-width="0.3"/>`;
      }
      return cells;
    })()}
    <!-- 3 eventos marcados -->
    <rect x="${x-26}" y="${y-14}" width="10" height="6" fill="#3B82F6" opacity="0.6"/>
    <rect x="${x-4}" y="${y-7.5}" width="10" height="6" fill="#EC4899" opacity="0.6"/>
    <rect x="${x+18}" y="${y-1}" width="6" height="6" fill="#22C55E" opacity="0.6"/>
  `;
}

// Tripé com câmera (sala de Calendário/Estúdio)
function iso_camera_tripod(x, y) {
  return `
    <!-- pernas do tripé -->
    <line x1="${x}" y1="${y-4}" x2="${x-7}" y2="${y+8}" stroke="#1F2937" stroke-width="1.5"/>
    <line x1="${x}" y1="${y-4}" x2="${x+7}" y2="${y+8}" stroke="#1F2937" stroke-width="1.5"/>
    <line x1="${x}" y1="${y-4}" x2="${x}" y2="${y+8}" stroke="#1F2937" stroke-width="1.5"/>
    <!-- câmera -->
    <rect x="${x-7}" y="${y-12}" width="14" height="9" fill="#1F2937" rx="1"/>
    <circle cx="${x}" cy="${y-7.5}" r="3" fill="#374151"/>
    <circle cx="${x}" cy="${y-7.5}" r="1.5" fill="#0EA5E9"/>
    <rect x="${x+3}" y="${y-13}" width="2" height="2" fill="#EF4444">
      <animate attributeName="opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite"/>
    </rect>
  `;
}

// Server rack (IA Hub)
function iso_server_rack(x, y) {
  return `
    <rect x="${x-10}" y="${y-20}" width="20" height="26" fill="#0F172A" stroke="#1E293B" stroke-width="0.5" rx="1"/>
    ${(() => {
      let units = '';
      for (let i = 0; i < 5; i++) {
        const ry = y - 18 + i * 5;
        units += `<rect x="${x-8}" y="${ry}" width="16" height="3.5" fill="#1E293B"/>`;
        // LEDs
        units += `<circle cx="${x-5}" cy="${ry + 1.7}" r="0.7" fill="${i % 2 ? '#22C55E' : '#0EA5E9'}">
          <animate attributeName="opacity" values="1;0.3;1" dur="${1 + i * 0.2}s" repeatCount="indefinite"/>
        </circle>`;
        units += `<circle cx="${x-2}" cy="${ry + 1.7}" r="0.7" fill="${i % 2 ? '#0EA5E9' : '#22C55E'}">
          <animate attributeName="opacity" values="0.3;1;0.3" dur="${1.2 + i * 0.15}s" repeatCount="indefinite"/>
        </circle>`;
      }
      return units;
    })()}
  `;
}

// Filing cabinet (Admin)
function iso_filing_cabinet(x, y) {
  return `
    <rect x="${x-10}" y="${y-18}" width="20" height="24" fill="#475569" stroke="#1E293B" stroke-width="0.5" rx="1"/>
    <rect x="${x-9}" y="${y-16}" width="18" height="5" fill="#64748B"/>
    <rect x="${x-9}" y="${y-10}" width="18" height="5" fill="#64748B"/>
    <rect x="${x-9}" y="${y-4}" width="18" height="5" fill="#64748B"/>
    <circle cx="${x}" cy="${y-13.5}" r="1" fill="#D4A843"/>
    <circle cx="${x}" cy="${y-7.5}" r="1" fill="#D4A843"/>
    <circle cx="${x}" cy="${y-1.5}" r="1" fill="#D4A843"/>
  `;
}

// Whiteboard com texto (Squads)
function iso_whiteboard(x, y) {
  return `
    <rect x="${x-26}" y="${y-20}" width="52" height="28" fill="#FFFFFF" stroke="#94A3B8" stroke-width="1.5"/>
    <line x1="${x-22}" y1="${y-15}" x2="${x+18}" y2="${y-15}" stroke="#1F2937" stroke-width="1"/>
    <line x1="${x-22}" y1="${y-10}" x2="${x+10}" y2="${y-10}" stroke="#3B82F6" stroke-width="1"/>
    <line x1="${x-22}" y1="${y-5}"  x2="${x+5}" y2="${y-5}"  stroke="#EF4444" stroke-width="1"/>
    <line x1="${x-22}" y1="${y+0}"  x2="${x+15}" y2="${y+0}" stroke="#22C55E" stroke-width="1"/>
    <line x1="${x-22}" y1="${y+5}"  x2="${x+8}" y2="${y+5}"  stroke="#1F2937" stroke-width="1"/>
  `;
}

// TV de apresentação (Squads)
function iso_tv_screen(x, y) {
  return `
    <rect x="${x-22}" y="${y-16}" width="44" height="28" fill="#0F172A" stroke="#1E293B" stroke-width="1" rx="2"/>
    <rect x="${x-19}" y="${y-13}" width="38" height="22" fill="#1E3A8A"/>
    <!-- gráfico de apresentação fake -->
    <polyline points="${x-17},${y+6} ${x-12},${y+3} ${x-7},${y-2} ${x-2},${y-5} ${x+3},${y-3} ${x+8},${y-7} ${x+13},${y-10}"
      fill="none" stroke="#22C55E" stroke-width="1.2"/>
    <circle cx="${x-12}" cy="${y+3}" r="1" fill="#22C55E"/>
    <circle cx="${x-2}"  cy="${y-5}" r="1" fill="#22C55E"/>
    <circle cx="${x+8}"  cy="${y-7}" r="1" fill="#22C55E"/>
  `;
}

// Dashboard com gráficos (Dashboards/Comando)
function iso_dashboard_screen(x, y, w = 26) {
  return `
    <rect x="${x-w/2}" y="${y-16}" width="${w}" height="22" fill="#0F172A" rx="1.5"/>
    <rect x="${x-w/2+2}" y="${y-14}" width="${w-4}" height="18" fill="#1E293B"/>
    <!-- bars -->
    <rect x="${x-w/2+3}" y="${y-2}" width="3" height="4" fill="#3B82F6"/>
    <rect x="${x-w/2+7}" y="${y-6}" width="3" height="8" fill="#3B82F6"/>
    <rect x="${x-w/2+11}" y="${y-10}" width="3" height="12" fill="#22C55E"/>
    <rect x="${x-w/2+15}" y="${y-4}" width="3" height="6" fill="#3B82F6"/>
    <rect x="${x-w/2+19}" y="${y-8}" width="3" height="10" fill="#F59E0B"/>
    <!-- monitor stand -->
    <rect x="${x-2}" y="${y+6}" width="4" height="3" fill="#475569"/>
    <rect x="${x-5}" y="${y+9}" width="10" height="1.5" fill="#475569"/>
  `;
}

// Star rating board (CSAT)
function iso_star_board(x, y) {
  return `
    <rect x="${x-26}" y="${y-18}" width="52" height="22" fill="#FEF3C7" stroke="#D4A843" stroke-width="1" rx="2"/>
    <text x="${x}" y="${y-12}" text-anchor="middle" font-size="5" fill="#92400E" font-weight="700">SATISFAÇÃO</text>
    ${[0,1,2,3,4].map((i) => `
      <path d="M ${x-19 + i*10},${y-3} l 1.5,-3 l 1,3 l 3,0.3 l -2.3,2 l 0.8,3 l -2.8,-1.6 l -2.8,1.6 l 0.8,-3 l -2.3,-2 z"
        fill="#F59E0B" stroke="#92400E" stroke-width="0.3"/>
    `).join('')}
    <text x="${x}" y="${y+3}" text-anchor="middle" font-size="6" fill="#92400E" font-weight="700">★ 4.8</text>
  `;
}

// Bolinhas de feedback (CSAT)
function iso_feedback_chips(x, y) {
  return `
    <circle cx="${x-10}" cy="${y}" r="6" fill="#22C55E" opacity="0.8"/>
    <text x="${x-10}" y="${y+2}" text-anchor="middle" font-size="6" fill="#fff">😊</text>
    <circle cx="${x}" cy="${y}" r="6" fill="#F59E0B" opacity="0.8"/>
    <text x="${x}" y="${y+2}" text-anchor="middle" font-size="6" fill="#fff">😐</text>
    <circle cx="${x+10}" cy="${y}" r="6" fill="#EF4444" opacity="0.8"/>
    <text x="${x+10}" y="${y+2}" text-anchor="middle" font-size="6" fill="#fff">😞</text>
  `;
}

// Mala / suitcase (Roteiros)
function iso_suitcase(x, y) {
  return `
    <rect x="${x-9}" y="${y-6}" width="18" height="13" fill="#92400E" stroke="#5C2E0A" stroke-width="0.5" rx="1.5"/>
    <rect x="${x-4}" y="${y-9}" width="8" height="4" fill="none" stroke="#5C2E0A" stroke-width="1.2"/>
    <line x1="${x-9}" y1="${y-1}" x2="${x+9}" y2="${y-1}" stroke="#5C2E0A" stroke-width="0.8"/>
    <circle cx="${x-5}" cy="${y+2}" r="0.8" fill="#D4A843"/>
    <circle cx="${x+5}" cy="${y+2}" r="0.8" fill="#D4A843"/>
  `;
}

// Compass (Roteiros)
function iso_compass(x, y) {
  return `
    <circle cx="${x}" cy="${y}" r="7" fill="#FEF3C7" stroke="#92400E" stroke-width="1"/>
    <polygon points="${x},${y-5} ${x+1.5},${y} ${x},${y+5} ${x-1.5},${y}" fill="#EF4444"/>
    <polygon points="${x},${y-5} ${x+1.5},${y}" fill="#1F2937"/>
    <text x="${x}" y="${y-9}" text-anchor="middle" font-size="3" fill="#92400E" font-weight="700">N</text>
  `;
}

// Lounge sofa (Perfil/Fora hoje)
function iso_couch_big(x, y, color = '#7C3AED') {
  return `
    <!-- encosto -->
    <rect x="${x-30}" y="${y-15}" width="60" height="10" fill="${shade(color, -20)}" rx="3"/>
    <!-- assento -->
    <rect x="${x-30}" y="${y-7}" width="60" height="14" rx="3" fill="${color}"/>
    <!-- almofadas -->
    <rect x="${x-26}" y="${y-5}" width="12" height="9" rx="2" fill="${shade(color, 30)}"/>
    <rect x="${x-12}" y="${y-5}" width="12" height="9" rx="2" fill="${shade(color, 25)}"/>
    <rect x="${x+2}"  y="${y-5}" width="12" height="9" rx="2" fill="${shade(color, 30)}"/>
    <rect x="${x+16}" y="${y-5}" width="12" height="9" rx="2" fill="${shade(color, 25)}"/>
    <!-- braços -->
    <rect x="${x-32}" y="${y-8}" width="3" height="16" fill="${shade(color, -25)}" rx="1"/>
    <rect x="${x+29}" y="${y-8}" width="3" height="16" fill="${shade(color, -25)}" rx="1"/>
  `;
}

// Janela com vista (Fora hoje — vista de praia)
function iso_window_view(x, y) {
  return `
    <rect x="${x-32}" y="${y-22}" width="64" height="34" fill="#87CEEB" stroke="#475569" stroke-width="1.5" rx="1"/>
    <!-- céu gradiente -->
    <rect x="${x-30}" y="${y-20}" width="60" height="15" fill="#7DD3FC"/>
    <!-- sol -->
    <circle cx="${x+18}" cy="${y-13}" r="4" fill="#FCD34D"/>
    <!-- mar -->
    <rect x="${x-30}" y="${y-5}" width="60" height="6" fill="#0284C7"/>
    <!-- areia -->
    <rect x="${x-30}" y="${y+1}" width="60" height="9" fill="#FDE68A"/>
    <!-- palmeiras -->
    <line x1="${x-20}" y1="${y+10}" x2="${x-18}" y2="${y-8}" stroke="#5C2E0A" stroke-width="1"/>
    <ellipse cx="${x-19}" cy="${y-10}" rx="6" ry="3" fill="#16A34A"/>
    <line x1="${x+10}" y1="${y+10}" x2="${x+12}" y2="${y-5}" stroke="#5C2E0A" stroke-width="1"/>
    <ellipse cx="${x+11}" cy="${y-7}" rx="5" ry="2.5" fill="#16A34A"/>
    <!-- caixilho da janela -->
    <line x1="${x}" y1="${y-22}" x2="${x}" y2="${y+12}" stroke="#475569" stroke-width="1"/>
    <line x1="${x-32}" y1="${y-5}" x2="${x+32}" y2="${y-5}" stroke="#475569" stroke-width="0.5"/>
  `;
}

// Relógio de parede (Recepção)
function iso_wall_clock(x, y) {
  // Calcula ângulos das horas reais
  const now = new Date();
  const hours = now.getHours() % 12 + now.getMinutes() / 60;
  const minutes = now.getMinutes();
  const hourAngle = (hours / 12) * 360 - 90;
  const minAngle = (minutes / 60) * 360 - 90;
  const hx = x + Math.cos(hourAngle * Math.PI / 180) * 5;
  const hy = y + Math.sin(hourAngle * Math.PI / 180) * 5;
  const mx = x + Math.cos(minAngle * Math.PI / 180) * 7.5;
  const my = y + Math.sin(minAngle * Math.PI / 180) * 7.5;
  return `
    <circle cx="${x}" cy="${y}" r="10" fill="#FFFFFF" stroke="#1F2937" stroke-width="1.5"/>
    <circle cx="${x}" cy="${y}" r="1" fill="#1F2937"/>
    <line x1="${x}" y1="${y}" x2="${hx}" y2="${hy}" stroke="#1F2937" stroke-width="1.5"/>
    <line x1="${x}" y1="${y}" x2="${mx}" y2="${my}" stroke="#1F2937" stroke-width="1"/>
    <text x="${x}" y="${y-6}" text-anchor="middle" font-size="3" fill="#1F2937" font-weight="600">12</text>
    <text x="${x+7}" y="${y+1.5}" text-anchor="middle" font-size="3" fill="#1F2937" font-weight="600">3</text>
    <text x="${x}" y="${y+8}" text-anchor="middle" font-size="3" fill="#1F2937" font-weight="600">6</text>
    <text x="${x-6}" y="${y+1.5}" text-anchor="middle" font-size="3" fill="#1F2937" font-weight="600">9</text>
  `;
}

// Bell / campainha (Recepção)
function iso_bell(x, y) {
  return `
    <rect x="${x-3}" y="${y+2}" width="6" height="2" fill="#92400E" rx="0.5"/>
    <ellipse cx="${x}" cy="${y}" rx="5" ry="3.5" fill="#D4A843"/>
    <ellipse cx="${x}" cy="${y-1}" rx="3" ry="2.5" fill="#FCD34D"/>
    <circle cx="${x}" cy="${y-3}" r="1.2" fill="#92400E"/>
  `;
}

// Lampada de chão / floor lamp
function iso_floor_lamp(x, y) {
  return `
    <line x1="${x}" y1="${y+10}" x2="${x}" y2="${y-12}" stroke="#475569" stroke-width="1.5"/>
    <ellipse cx="${x}" cy="${y+11}" rx="4" ry="1.5" fill="#1F2937"/>
    <path d="M${x-7},${y-12} Q${x},${y-22} ${x+7},${y-12} L${x+5},${y-10} Q${x},${y-16} ${x-5},${y-10} Z"
      fill="#FCD34D" stroke="#92400E" stroke-width="0.5"/>
    <!-- glow effect -->
    <ellipse cx="${x}" cy="${y-8}" rx="14" ry="5" fill="#FEF3C7" opacity="0.4"/>
  `;
}

// Cards / papéis em pilha (Admin)
function iso_papers_stack(x, y) {
  return `
    <rect x="${x-6}" y="${y-1}" width="14" height="9" fill="#F8FAFC" stroke="#94A3B8" stroke-width="0.3" transform="rotate(-3 ${x} ${y})"/>
    <rect x="${x-5}" y="${y-3}" width="14" height="9" fill="#F1F5F9" stroke="#94A3B8" stroke-width="0.3" transform="rotate(2 ${x} ${y})"/>
    <rect x="${x-7}" y="${y-5}" width="14" height="9" fill="#FFFFFF" stroke="#94A3B8" stroke-width="0.5"/>
    <line x1="${x-4}" y1="${y-3}" x2="${x+4}" y2="${y-3}" stroke="#1F2937" stroke-width="0.4"/>
    <line x1="${x-4}" y1="${y-1}" x2="${x+5}" y2="${y-1}" stroke="#1F2937" stroke-width="0.4"/>
    <line x1="${x-4}" y1="${y+1}" x2="${x+3}" y2="${y+1}" stroke="#1F2937" stroke-width="0.4"/>
  `;
}

// Headset (CSAT)
function iso_headset(x, y) {
  return `
    <path d="M${x-7},${y+3} Q${x},${y-10} ${x+7},${y+3}" fill="none" stroke="#1F2937" stroke-width="2"/>
    <ellipse cx="${x-7}" cy="${y+3}" rx="2.5" ry="3.5" fill="#1F2937"/>
    <ellipse cx="${x+7}" cy="${y+3}" rx="2.5" ry="3.5" fill="#1F2937"/>
    <path d="M${x-9},${y+3} Q${x-11},${y+8} ${x-6},${y+10}" fill="none" stroke="#1F2937" stroke-width="1"/>
  `;
}

// Foto enquadrada (Perfil)
function iso_photo_frame(x, y) {
  return `
    <rect x="${x-12}" y="${y-14}" width="24" height="20" fill="#D4A843" stroke="#92400E" stroke-width="0.8" rx="1"/>
    <rect x="${x-10}" y="${y-12}" width="20" height="16" fill="#FED7AA"/>
    <!-- silhueta de pessoa -->
    <circle cx="${x}" cy="${y-6}" r="3" fill="#92400E"/>
    <path d="M${x-5},${y+4} Q${x},${y-2} ${x+5},${y+4} L${x+5},${y+4} L${x-5},${y+4} Z" fill="#92400E"/>
  `;
}

// Mesa redonda pequena (lounge)
function iso_round_table(x, y, color = '#92400E') {
  return `
    <ellipse cx="${x}" cy="${y+5}" rx="12" ry="3" fill="${shade(color, -30)}"/>
    <ellipse cx="${x}" cy="${y}" rx="12" ry="6" fill="${color}" stroke="${shade(color, -30)}" stroke-width="0.5"/>
    <ellipse cx="${x}" cy="${y-1}" rx="11" ry="5" fill="${shade(color, 25)}" opacity="0.5"/>
    <line x1="${x}" y1="${y+5}" x2="${x}" y2="${y+12}" stroke="${shade(color, -30)}" stroke-width="1.5"/>
    <ellipse cx="${x}" cy="${y+12}" rx="5" ry="1.5" fill="${shade(color, -40)}"/>
  `;
}

// Tabuleiro de jogo (Fora hoje)
function iso_chess_board(x, y) {
  let cells = '';
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    cells += `<rect x="${x - 8 + i*4}" y="${y - 8 + j*4}" width="4" height="4"
      fill="${(i+j) % 2 ? '#1F2937' : '#F8FAFC'}"/>`;
  }
  return `
    <rect x="${x-9}" y="${y-9}" width="18" height="18" fill="#5C2E0A"/>
    ${cells}
    <!-- pecinhas -->
    <circle cx="${x-6}" cy="${y-6}" r="1.2" fill="#FFFFFF"/>
    <circle cx="${x+6}" cy="${y+6}" r="1.2" fill="#FFFFFF"/>
    <circle cx="${x+2}" cy="${y-2}" r="1.2" fill="#1F2937"/>
  `;
}

// Mug / xícara de café
function iso_mug(x, y, color = '#D4A843') {
  return `
    <rect x="${x-3}" y="${y-4}" width="6" height="6" fill="${color}" stroke="${shade(color, -30)}" stroke-width="0.5" rx="0.5"/>
    <path d="M${x+3},${y-3} Q${x+5.5},${y-2} ${x+3},${y-0.5}" fill="none" stroke="${shade(color, -30)}" stroke-width="0.8"/>
    <ellipse cx="${x}" cy="${y-4}" rx="3" ry="0.8" fill="#5C2E0A"/>
    <!-- vapor sutil -->
    <path d="M${x-1},${y-6} Q${x-2},${y-9} ${x},${y-10}" fill="none" stroke="#94A3B8" stroke-width="0.5" opacity="0.6">
      <animate attributeName="opacity" values="0.6;0.2;0.6" dur="2s" repeatCount="indefinite"/>
    </path>
    <path d="M${x+1},${y-6} Q${x+2},${y-9} ${x},${y-10}" fill="none" stroke="#94A3B8" stroke-width="0.5" opacity="0.5">
      <animate attributeName="opacity" values="0.2;0.6;0.2" dur="2s" repeatCount="indefinite"/>
    </path>
  `;
}

/* ─── Furniture map: cenas detalhadas por sala (4.36.4+) ────
 *
 * Cada sala vira uma micro-cena temática. Ordem: tapete (chão) →
 * decorações de parede (back) → mobília média → itens pequenos (front).
 * Coordenadas relativas ao centro inferior da sala (cx, centerY).
 */
function renderFurniture(roomId, cx, cy) {
  const centerY = cy + TILE_H / 2;
  const pieces = {

    /* ─── MEU PAINEL (recepção/home) ───
     * Mesa de boas-vindas + relógio + planta + cadeira lounge
     */
    'recepcao': [
      iso_rug(cx, centerY + 50, 130, 70, '#64748B'),
      iso_wall_clock(cx, centerY - 20),
      iso_poster(cx - 35, centerY - 20, 22, 16, '#D4A843'),  // "Bem-vindo" placeholder
      iso_desk(cx - 20, centerY + 45, 70, 32, '#94A3B8'),
      iso_bell(cx - 30, centerY + 35),
      iso_monitor(cx + 10, centerY + 35),
      iso_chair(cx - 20, centerY + 75, '#475569'),
      iso_plant(cx + 70, centerY + 60),
      iso_plant(cx - 80, centerY + 70),
    ],

    /* ─── TAREFAS ───
     * Bullpen com kanban board + 2 estações de trabalho + sticky notes
     */
    'tarefas': [
      iso_rug(cx, centerY + 50, 150, 80, '#3B82F6'),
      iso_kanban_board(cx, centerY - 16),
      iso_sticky_notes(cx + 60, centerY - 8),
      iso_desk(cx - 50, centerY + 30, 55, 28, '#6B7280'),
      iso_monitor(cx - 50, centerY + 22),
      iso_mug(cx - 30, centerY + 26),
      iso_chair(cx - 50, centerY + 58),
      iso_desk(cx + 50, centerY + 55, 55, 28, '#6B7280'),
      iso_monitor(cx + 50, centerY + 47),
      iso_papers_stack(cx + 70, centerY + 50),
      iso_chair(cx + 50, centerY + 83),
      iso_plant(cx + 90, centerY + 80),
    ],

    /* ─── SQUADS (reuniões/workspaces) ───
     * Sala de reunião formal: mesa grande + TV de apresentação + whiteboard
     */
    'reunioes': [
      iso_rug(cx, centerY + 50, 170, 90, '#8B5CF6'),
      iso_tv_screen(cx - 30, centerY - 18),
      iso_whiteboard(cx + 40, centerY - 14),
      iso_desk(cx, centerY + 50, 120, 50, '#3F4A5C'),
      iso_mug(cx - 35, centerY + 45),
      iso_mug(cx + 35, centerY + 45),
      iso_papers_stack(cx, centerY + 50),
      iso_chair(cx - 55, centerY + 25),
      iso_chair(cx - 55, centerY + 75),
      iso_chair(cx + 55, centerY + 25),
      iso_chair(cx + 55, centerY + 75),
      iso_chair(cx, centerY + 5),
      iso_chair(cx, centerY + 95),
    ],

    /* ─── DASHBOARDS (comando) ───
     * Control room com 3 telas wall-mounted + mesa standing + lampada
     */
    'comando': [
      iso_rug(cx, centerY + 50, 150, 80, '#06B6D4'),
      iso_dashboard_screen(cx - 38, centerY - 18, 26),
      iso_dashboard_screen(cx, centerY - 18, 26),
      iso_dashboard_screen(cx + 38, centerY - 18, 26),
      iso_desk(cx, centerY + 50, 100, 36, '#1E293B'),
      iso_monitor(cx - 25, centerY + 40),
      iso_monitor(cx + 25, centerY + 40),
      iso_papers_stack(cx, centerY + 45),
      iso_chair(cx, centerY + 80),
      iso_floor_lamp(cx + 80, centerY + 65),
      iso_plant(cx - 80, centerY + 75),
    ],

    /* ─── PORTAL DE DICAS (estúdio) ───
     * Atelier criativo: cavalete + bookshelf + 3 posters de cidades + câmera
     */
    'estudio': [
      iso_rug(cx, centerY + 50, 140, 80, '#EC4899'),
      iso_bookshelf(cx - 60, centerY - 4),
      iso_poster(cx + 10, centerY - 22, 22, 16, '#EC4899'),  // poster Paris
      iso_poster(cx + 40, centerY - 22, 22, 16, '#F59E0B'),  // poster Roma
      iso_poster(cx + 70, centerY - 22, 22, 16, '#22C55E'),  // poster Tokyo
      iso_easel(cx - 25, centerY + 40),
      iso_camera_tripod(cx + 60, centerY + 35),
      iso_desk(cx + 25, centerY + 55, 55, 28, '#A07050'),
      iso_monitor(cx + 25, centerY + 45),
      iso_mug(cx + 5, centerY + 50),
      iso_chair(cx + 25, centerY + 82),
      iso_plant(cx + 90, centerY + 75),
    ],

    /* ─── CALENDÁRIO DE CONTEÚDO (lousa) ───
     * Estúdio editorial: calendário wall + câmera + iluminação + computador
     */
    'lousa': [
      iso_rug(cx, centerY + 50, 140, 80, '#F59E0B'),
      iso_wall_calendar(cx, centerY - 18),
      iso_sticky_notes(cx + 55, centerY - 5),
      iso_desk(cx - 25, centerY + 55, 60, 32, '#92400E'),
      iso_monitor(cx - 25, centerY + 45),
      iso_mug(cx - 5, centerY + 50),
      iso_chair(cx - 25, centerY + 85),
      iso_camera_tripod(cx + 50, centerY + 45),
      iso_floor_lamp(cx - 80, centerY + 50),
      iso_plant(cx + 80, centerY + 70),
    ],

    /* ─── ROTEIROS DE VIAGEM ───
     * Sala de planejamento: mapa mundi + globo + bússola + mala + livros
     */
    'roteiros': [
      iso_rug(cx, centerY + 50, 140, 80, '#10B981'),
      iso_worldmap(cx, centerY - 16),
      iso_bookshelf(cx + 65, centerY - 4),
      iso_desk(cx - 15, centerY + 50, 60, 30, '#0F766E'),
      iso_globe(cx - 30, centerY + 40),
      iso_compass(cx + 0, centerY + 48),
      iso_monitor(cx - 15, centerY + 38),
      iso_chair(cx - 15, centerY + 78),
      iso_suitcase(cx + 60, centerY + 65),
      iso_plant(cx - 80, centerY + 70),
    ],

    /* ─── CSAT (atendimento) ───
     * Call center: balcão longo + headsets + star board + chips de feedback
     */
    'atendimento': [
      iso_rug(cx, centerY + 50, 150, 80, '#F97316'),
      iso_star_board(cx - 30, centerY - 16),
      iso_feedback_chips(cx + 40, centerY - 8),
      iso_desk(cx, centerY + 40, 110, 32, '#9A3412'),
      iso_monitor(cx - 30, centerY + 30),
      iso_monitor(cx + 30, centerY + 30),
      iso_headset(cx - 50, centerY + 32),
      iso_headset(cx + 50, centerY + 32),
      iso_mug(cx, centerY + 38),
      iso_chair(cx - 40, centerY + 70),
      iso_chair(cx, centerY + 70),
      iso_chair(cx + 40, centerY + 70),
      iso_plant(cx - 80, centerY + 75),
    ],

    /* ─── IA HUB (lab IA) ───
     * Laboratório de IA: robô + server rack + dashboard com dados + monitor
     */
    'lab-ia': [
      iso_rug(cx, centerY + 50, 140, 80, '#A78BFA'),
      iso_dashboard_screen(cx - 30, centerY - 18, 28),
      iso_dashboard_screen(cx + 25, centerY - 18, 24),
      iso_server_rack(cx + 65, centerY + 8),
      iso_robot(cx - 35, centerY + 50),
      iso_desk(cx + 15, centerY + 55, 60, 32, '#5B21B6'),
      iso_monitor(cx + 15, centerY + 45),
      iso_papers_stack(cx + 38, centerY + 50),
      iso_chair(cx + 15, centerY + 85),
      iso_plant(cx - 80, centerY + 75),
    ],

    /* ─── ADMINISTRAÇÃO ───
     * Escritório corporativo: filing cabinet + mesa executiva + printer + safe
     */
    'admin': [
      iso_rug(cx, centerY + 50, 140, 80, '#475569'),
      iso_filing_cabinet(cx - 60, centerY + 12),
      iso_filing_cabinet(cx - 38, centerY + 22),
      iso_safe(cx + 60, centerY + 30),
      iso_desk(cx + 10, centerY + 55, 70, 32, '#374151'),
      iso_monitor(cx + 10, centerY + 45),
      iso_printer(cx + 45, centerY + 50),
      iso_papers_stack(cx - 12, centerY + 50),
      iso_chair(cx + 10, centerY + 85),
      iso_floor_lamp(cx + 80, centerY + 70),
    ],

    /* ─── PERFIL (café/lounge pessoal) ───
     * Lounge particular: sofá + mesa de centro + foto enquadrada + café
     */
    'cafe': [
      iso_rug(cx, centerY + 50, 140, 80, '#92400E'),
      iso_photo_frame(cx - 30, centerY - 18),
      iso_poster(cx + 20, centerY - 22, 22, 16, '#D4A843'),
      iso_couch_big(cx, centerY + 30, '#92400E'),
      iso_round_table(cx, centerY + 60, '#5C2E0A'),
      iso_mug(cx - 7, centerY + 55),
      iso_books(cx + 5, centerY + 58),
      iso_coffee(cx + 60, centerY + 40),
      iso_plant(cx - 80, centerY + 70),
      iso_plant(cx + 90, centerY + 70),
    ],

    /* ─── FORA HOJE (descompressão / módulo Equipe) ───
     * Sala de relaxamento: janela com vista de praia + 2 sofás + tabuleiro + plantas
     */
    'descompressao': [
      iso_rug(cx, centerY + 50, 150, 80, '#7C3AED'),
      iso_window_view(cx, centerY - 18),
      iso_couch_big(cx - 35, centerY + 40, '#7C3AED'),
      iso_couch_big(cx + 40, centerY + 65, '#A78BFA'),
      iso_round_table(cx, centerY + 55, '#5C2E0A'),
      iso_chess_board(cx, centerY + 52),
      iso_plant(cx - 90, centerY + 50),
      iso_plant(cx - 80, centerY + 80),
      iso_plant(cx + 90, centerY + 35),
      iso_plant(cx + 100, centerY + 75),
    ],
  };
  return (pieces[roomId] || []).join('');
}

// Stack de livros (helper extra)
function iso_books(x, y) {
  return `
    <rect x="${x-7}" y="${y-2}" width="14" height="3.5" fill="#DC2626" stroke="#7F1D1D" stroke-width="0.3"/>
    <rect x="${x-6}" y="${y-5.5}" width="12" height="3.5" fill="#1E40AF" stroke="#1E3A8A" stroke-width="0.3"/>
    <rect x="${x-7.5}" y="${y-9}" width="15" height="3.5" fill="#15803D" stroke="#14532D" stroke-width="0.3"/>
    <rect x="${x-5}" y="${y-12.5}" width="10" height="3.5" fill="#D97706" stroke="#92400E" stroke-width="0.3"/>
  `;
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

/* ─── Render de um avatar (4.37.0+ COM CORPO) ─────────────── */
function renderAvatar(person, x, y, idx = 0) {
  const stateColor = person.state === 'idle'   ? '#F59E0B'
                  : person.state === 'absent'  ? '#7C3AED'
                  : '#22C55E';
  const initials = (person.name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const photoFg  = person.photoURL || '';
  const fg       = person.avatarColor || '#3B82F6';

  const bobDuration = 2.4 + (idx * 0.15);
  const bobOffset   = (idx % 4) * 0.3;
  const isStill = person.state === 'idle' || person.state === 'absent';
  const walkPath = generateWalkPath(person.uid, idx);
  const walkDur  = 18 + ((idx * 7) % 12);
  const isRecentlyActive = person.recentActivity === true;
  // Cor do "corpo/torso" — usa avatarColor com tom mais saturado, ou fallback cinza
  const bodyColor = fg;
  const bodyDark  = shade(fg, -30);

  return `
    <g class="office-avatar" data-uid="${esc(person.uid)}" data-name="${esc(person.name)}"
       data-state="${esc(person.state)}" data-route="${esc(person.currentRoute || '')}"
       data-photo="${esc(photoFg)}"
       data-absence="${esc(person.absenceType || '')}"
       transform="translate(${x}, ${y})"
       style="cursor:pointer;transition:transform 600ms cubic-bezier(.4,.0,.2,1);">
      <g>
        ${!isStill ? `<animateMotion dur="${walkDur}s" repeatCount="indefinite" rotate="0"
          path="${walkPath}" calcMode="spline"
          keySplines="0.4 0 0.6 1; 0.4 0 0.6 1; 0.4 0 0.6 1; 0.4 0 0.6 1"
          keyTimes="0; 0.25; 0.5; 0.75; 1"/>` : ''}
        <!-- 4.37.0+ Sombra elongada no chão (mais realista) -->
        <ellipse cx="0" cy="12" rx="13" ry="3.5" fill="rgba(0,0,0,0.35)">
          ${!isStill ? `<animate attributeName="rx" values="13;11;13" dur="${bobDuration}s" begin="${bobOffset}s" repeatCount="indefinite"/>` : ''}
          ${!isStill ? `<animate attributeName="opacity" values="0.35;0.25;0.35" dur="${bobDuration}s" begin="${bobOffset}s" repeatCount="indefinite"/>` : ''}
        </ellipse>
        <g>
          ${!isStill ? `<animateTransform attributeName="transform" type="translate"
            values="0,0;0,-2;0,0;0,-1;0,0" dur="${bobDuration}s" begin="${bobOffset}s" repeatCount="indefinite"/>` : ''}
          <!-- 4.37.0+ CORPO (torso): cápsula/elipse com cor do user -->
          <ellipse cx="0" cy="8" rx="9" ry="6" fill="${bodyDark}" />
          <path d="M -9,8 Q -9,0 -7,-2 L 7,-2 Q 9,0 9,8 Z" fill="${bodyColor}" stroke="${bodyDark}" stroke-width="0.5"/>
          <!-- "Gola" -->
          <ellipse cx="0" cy="-2" rx="6" ry="2" fill="${bodyDark}"/>
          <!-- CABEÇA (foto ou iniciais, deslocada pra cima do torso) -->
          <circle cx="0" cy="-8" r="11" fill="${fg}" stroke="${stateColor}" stroke-width="2.5"/>
          ${photoFg ? `
            <clipPath id="clip-${person.uid}">
              <circle cx="0" cy="-8" r="10"/>
            </clipPath>
            <image href="${esc(photoFg)}" x="-10" y="-18" width="20" height="20"
              clip-path="url(#clip-${person.uid})" preserveAspectRatio="xMidYMid slice"/>
          ` : `
            <text x="0" y="-5" text-anchor="middle"
              style="font-family:-apple-system,sans-serif;font-size:9px;font-weight:700;fill:#fff;pointer-events:none;">${esc(initials)}</text>
          `}
        </g>
        ${person.isMe ? `
          <circle cx="0" cy="-8" r="14" fill="none" stroke="#D4A843" stroke-width="2" stroke-dasharray="3,2">
            <animateTransform attributeName="transform" type="rotate" from="0 0 -8" to="360 0 -8" dur="8s" repeatCount="indefinite"/>
          </circle>
        ` : ''}
        ${person.state === 'active' && !isRecentlyActive ? `
          <circle cx="0" cy="-8" r="11" fill="none" stroke="${stateColor}" stroke-width="2" opacity="0.6">
            <animate attributeName="r" values="11;18;11" dur="3s" begin="${bobOffset + 0.5}s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.6;0;0.6" dur="3s" begin="${bobOffset + 0.5}s" repeatCount="indefinite"/>
          </circle>
        ` : ''}
        ${isRecentlyActive ? `
          <text x="0" y="-26" text-anchor="middle" font-size="14" style="pointer-events:none;">
            ⚡
            <animate attributeName="opacity" values="1;0.3;1" dur="0.8s" repeatCount="indefinite"/>
          </text>
        ` : ''}
      </g>
    </g>
  `;
}

/* ─── Gera path de caminhada para o avatar dentro da sala ───
 * 4 waypoints distribuídos em torno da posição base (0,0).
 * Path inclui movimento elíptico (mais largo em X pq isométrico).
 * Cada uid gera path único (deterministic) pra não embaralhar.
 */
function generateWalkPath(uid, idx) {
  // Hash simples da string uid pra seed
  let seed = 0;
  for (let i = 0; i < (uid || '').length; i++) seed = (seed * 31 + uid.charCodeAt(i)) | 0;
  seed = Math.abs(seed + idx * 17) % 1000;
  const rng = (n) => {
    seed = (seed * 9301 + 49297) % 233280;
    return (seed / 233280) * n;
  };
  // Raio em torno do ponto base (avatar fica perambulando)
  const rx = 35 + rng(15);  // 35-50
  const ry = 14 + rng(8);   // 14-22 (achatado pra ficar dentro do rombus)
  // 4 pontos: noroeste, sudeste, nordeste, sudoeste (formato de "infinito")
  const ang0 = rng(Math.PI * 2);
  const pts = [0, 1, 2, 3].map(i => {
    const a = ang0 + (i * Math.PI / 2) + (rng(0.4) - 0.2);  // pequeno jitter
    const r = 0.85 + rng(0.3);
    return [Math.cos(a) * rx * r, Math.sin(a) * ry * r];
  });
  // Inclui retorno ao ponto inicial pra fechar o loop
  return `M ${pts[0][0]},${pts[0][1]} L ${pts[1][0]},${pts[1][1]} L ${pts[2][0]},${pts[2][1]} L ${pts[3][0]},${pts[3][1]} Z`;
}

/* ─── Hover tooltip + click navigation (4.36.3+) ───────────── */
function wireInteractions(stageEl) {
  let tip = null;
  const removeTip = () => { if (tip) { tip.remove(); tip = null; } };

  // 4.36.3+ Click no chão da sala → navega pro módulo correspondente
  stageEl.querySelectorAll('.office-room').forEach(roomEl => {
    const floor = roomEl.querySelector('.office-floor');
    if (!floor) return;
    floor.addEventListener('click', () => {
      const route = roomEl.dataset.route;
      if (route) router.navigate(route);
    });
    // Tooltip sutil no hover da sala (não conflita com o tooltip do avatar)
    floor.addEventListener('mouseenter', () => {
      removeTip();
      const roomId = roomEl.dataset.room;
      const room = ROOMS.find(r => r.id === roomId);
      if (!room) return;
      const route = roomEl.dataset.route;
      tip = document.createElement('div');
      tip.style.cssText = `
        position:fixed;z-index:9999;
        background:var(--bg-card, #1A2332);
        color:var(--text-primary, #E8ECF1);
        border:1px solid ${room.color};
        border-radius:8px;padding:8px 12px;font-size:0.75rem;
        box-shadow:0 4px 12px rgba(0,0,0,0.3);pointer-events:none;
        max-width:240px;line-height:1.5;
      `;
      tip.innerHTML = `
        <div style="font-weight:600;color:${room.color};margin-bottom:2px;">${esc(room.icon)} ${esc(room.label)}</div>
        <div style="font-size:0.6875rem;opacity:0.85;">Clique para entrar nesta sala</div>
        ${route ? `<div style="font-size:0.6875rem;color:var(--text-muted);margin-top:2px;">↗ /${esc(route)}</div>` : ''}
      `;
      document.body.appendChild(tip);
      const rect = floor.getBoundingClientRect();
      tip.style.left = (rect.left + rect.width / 2 - tip.offsetWidth / 2) + 'px';
      tip.style.top  = (rect.top + 8) + 'px';
    });
    floor.addEventListener('mouseleave', removeTip);
  });

  // Tooltip do avatar
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
        ${route !== 'descompressao' ? `<div style="font-size:0.6875rem;color:var(--text-muted);margin-top:2px;">Em: ${esc(route)}</div>` : ''}
      `;
      document.body.appendChild(tip);
      const rect = av.getBoundingClientRect();
      tip.style.left = (rect.left + rect.width / 2 - tip.offsetWidth / 2) + 'px';
      tip.style.top  = (rect.top - tip.offsetHeight - 8) + 'px';
    });
    av.addEventListener('mouseleave', removeTip);
  });

  stageEl.addEventListener('mouseleave', removeTip);

  // 4.37.0+ Easter egg: click no robô do IA Hub → frase aleatória
  const labRoom = stageEl.querySelector('.office-room[data-room="lab-ia"]');
  if (labRoom) {
    const robotEls = labRoom.querySelectorAll('.office-furniture');
    robotEls.forEach(rg => {
      rg.style.pointerEvents = 'auto';
      rg.style.cursor = 'help';
      rg.addEventListener('click', (e) => {
        e.stopPropagation();
        const phrases = [
          'Beep boop. Estou aprendendo agora.',
          'Detectei alta atividade na sala de Tarefas. Boa, equipe!',
          'Anthropic Claude: pronto pra ajudar.',
          'Posso gerar um roteiro pra você?',
          'Pesquisas CSAT processadas: 12 esta semana.',
          'Você sabia? Sou alimentado por Cloud Functions e Secret Manager.',
          'Conecte-me aos seus dados e eu trago insights.',
        ];
        const txt = phrases[Math.floor(Math.random() * phrases.length)];
        showFloatingBubble(rg, txt);
      });
    });
  }
}

/* ─── 4.37.0+ Day/night cycle (background gradient pela hora real) ── */
function getTimeOfDayGradient() {
  const h = new Date().getHours();
  if (h >= 6 && h < 10) {
    // manhã — dourado suave
    return 'linear-gradient(180deg, #FEF3C7 0%, #FDE68A 60%, #FCD34D 100%)';
  } else if (h >= 10 && h < 17) {
    // dia — luz brilhante
    return 'linear-gradient(180deg, #E0F2FE 0%, #BAE6FD 60%, #7DD3FC 100%)';
  } else if (h >= 17 && h < 19) {
    // pôr-do-sol — laranja/rosa
    return 'linear-gradient(180deg, #FED7AA 0%, #FDBA74 40%, #FB923C 100%)';
  } else if (h >= 19 && h < 22) {
    // entardecer — roxo
    return 'linear-gradient(180deg, #C4B5FD 0%, #8B5CF6 60%, #4C1D95 100%)';
  }
  // noite — navy escuro
  return 'linear-gradient(180deg, #1E293B 0%, #0F172A 100%)';
}

function isNightTime() {
  const h = new Date().getHours();
  return h >= 19 || h < 6;
}

/* ─── 4.37.0+ Activity feed: lê audit_logs e mostra toasts ── */
let _lastActivitySeen = Date.now();
let _activityKnownIds = new Set();

async function pollAndShowActivities(container) {
  try {
    const { db } = await import('../firebase.js');
    const { collection, query, where, getDocs, Timestamp, orderBy, limit } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
    const sinceMs = _lastActivitySeen;
    _lastActivitySeen = Date.now();

    const snap = await getDocs(query(
      collection(db, 'audit_logs'),
      where('timestamp', '>=', Timestamp.fromMillis(sinceMs)),
      orderBy('timestamp', 'desc'),
      limit(10),
    ));

    const events = snap.docs
      .filter(d => !_activityKnownIds.has(d.id))
      .map(d => {
        _activityKnownIds.add(d.id);
        return { id: d.id, ...d.data() };
      });

    // Limita memória (evita grow infinito)
    if (_activityKnownIds.size > 500) {
      _activityKnownIds = new Set([..._activityKnownIds].slice(-200));
    }

    events.forEach(e => showActivityToast(container, e));
  } catch (_) {
    // sem permissão pra audit_logs → silencia
  }
}

const ACTION_TEXTS = {
  'task.create':         (e) => `${e.userName} criou uma tarefa`,
  'task.update':         (e) => `${e.userName} atualizou uma tarefa`,
  'task.complete':       (e) => `${e.userName} concluiu uma tarefa`,
  'task.delete':         (e) => `${e.userName} excluiu uma tarefa`,
  'csat.send':           (e) => `${e.userName} enviou uma pesquisa CSAT`,
  'csat.response':       (e) => `Resposta CSAT recebida`,
  'portal_images.upload':(e) => `${e.userName} fez upload no Banco de Imagens`,
  'portal_images.delete':(e) => `${e.userName} removeu uma imagem`,
  'roteiro.create':      (e) => `${e.userName} criou um roteiro`,
  'roteiro.update':      (e) => `${e.userName} editou um roteiro`,
  'project.create':      (e) => `${e.userName} criou um projeto`,
  'workspace.create':    (e) => `${e.userName} criou um squad`,
  'goal.published':      (e) => `${e.userName} publicou uma meta`,
  'feedback.create':     (e) => `${e.userName} registrou um feedback`,
};

function actionToText(event) {
  const fn = ACTION_TEXTS[event.action];
  if (fn) return fn(event);
  // Fallback: humaniza a action key
  const parts = String(event.action || 'algo').split('.');
  return `${event.userName || 'Alguém'} ${parts[1] || 'fez algo'} em ${parts[0] || 'sistema'}`;
}

function showActivityToast(container, event) {
  const feed = document.getElementById('office-activity-feed');
  if (!feed) return;
  const text = actionToText(event);
  const toast = document.createElement('div');
  toast.style.cssText = `
    background:var(--bg-card, #1A2332);
    color:var(--text-primary, #E8ECF1);
    border-left:3px solid #D4A843;
    border-radius:6px;
    padding:8px 14px;
    font-size:0.8125rem;
    box-shadow:0 4px 14px rgba(0,0,0,0.25);
    opacity:0;
    transform:translateX(20px);
    transition:opacity 300ms, transform 300ms;
    pointer-events:auto;
  `;
  toast.innerHTML = `<span style="color:#D4A843;">●</span> ${esc(text)}`;
  feed.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(0)';
  });
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(20px)';
    setTimeout(() => toast.remove(), 400);
  }, 5500);
}

/* ─── Easter egg bubble (4.37.0+) ── */
function showFloatingBubble(targetEl, text) {
  const existing = document.querySelector('.office-bubble');
  if (existing) existing.remove();
  const bubble = document.createElement('div');
  bubble.className = 'office-bubble';
  bubble.style.cssText = `
    position:fixed;z-index:9999;
    background:var(--bg-card, #1A2332);
    color:var(--text-primary, #E8ECF1);
    border:1.5px solid #A78BFA;
    border-radius:14px;
    padding:10px 16px;
    font-size:0.8125rem;
    max-width:240px;line-height:1.45;
    box-shadow:0 6px 20px rgba(167,139,250,0.4);
    pointer-events:none;
    opacity:0;transform:translateY(8px) scale(0.9);
    transition:all 250ms cubic-bezier(.4,0,.2,1);
  `;
  bubble.innerHTML = `<strong style="color:#A78BFA;">🤖</strong> ${esc(text)}`;
  document.body.appendChild(bubble);
  const r = targetEl.getBoundingClientRect();
  bubble.style.left = (r.left + r.width / 2 - 120) + 'px';
  bubble.style.top  = (r.top - bubble.offsetHeight - 14) + 'px';
  requestAnimationFrame(() => {
    bubble.style.opacity = '1';
    bubble.style.transform = 'translateY(0) scale(1)';
  });
  setTimeout(() => {
    bubble.style.opacity = '0';
    bubble.style.transform = 'translateY(-4px) scale(0.92)';
    setTimeout(() => bubble.remove(), 250);
  }, 4500);
}
