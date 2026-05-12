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

/* ─── Render de uma sala (parede + chão + label + avatares) ── */
function renderRoom(room, cx, cy, people) {
  const FLOOR_ALPHA = '22';   // hex 22 = ~13% opacity
  const WALL_LEFT_ALPHA = '50';  // mais escuro
  const WALL_RIGHT_ALPHA = '30';

  // Posiciona avatares dentro da sala
  const avatarHtml = people.map((p, i) => {
    const offset = avatarOffsetInRoom(i, people.length);
    const ax = cx + offset.x;
    const ay = cy + offset.y + TILE_H/2;
    return renderAvatar(p, ax, ay);
  }).join('');

  // 4.36.1+ Label posicionado DENTRO da sala (no topo do rombus, atrás dos avatares)
  // — não flutua entre salas, fica claro a que sala pertence
  const labelX = cx;
  const labelY = cy + 22;  // logo abaixo do top point do rombus
  const count = people.length;
  const isEmpty = count === 0;

  return `
    <g class="office-room" data-room="${room.id}">
      <!-- Parede esquerda (mais escura) -->
      <path d="${leftWallPath(cx, cy, WALL_HEIGHT)}" fill="${room.color}${WALL_LEFT_ALPHA}" stroke="${room.color}" stroke-width="1" opacity="0.85"/>
      <!-- Parede direita -->
      <path d="${rightWallPath(cx, cy, WALL_HEIGHT)}" fill="${room.color}${WALL_RIGHT_ALPHA}" stroke="${room.color}" stroke-width="1" opacity="0.7"/>
      <!-- Chão -->
      <polygon points="${floorPolygon(cx, cy)}" fill="${room.color}${FLOOR_ALPHA}" stroke="${room.color}" stroke-width="1.5" stroke-opacity="0.6"/>
      <polygon points="${floorPolygon(cx, cy)}" fill="url(#floorTexture)" pointer-events="none"/>

      <!-- Label DENTRO da sala, no topo -->
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
function renderAvatar(person, x, y) {
  const stateColor = person.state === 'idle'   ? '#F59E0B'
                  : person.state === 'absent'  ? '#7C3AED'
                  : '#22C55E';
  const initials = (person.name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const photoFg  = person.photoURL || '';
  const fg       = person.avatarColor || '#3B82F6';

  // foreignObject permite renderizar HTML dentro do SVG → pra usar <img> de foto
  return `
    <g class="office-avatar" data-uid="${esc(person.uid)}" data-name="${esc(person.name)}"
       data-state="${esc(person.state)}" data-route="${esc(person.currentRoute || '')}"
       data-photo="${esc(photoFg)}"
       data-absence="${esc(person.absenceType || '')}"
       transform="translate(${x}, ${y})"
       style="cursor:pointer;transition:transform 300ms cubic-bezier(.4,.0,.2,1);">
      <!-- Sombra -->
      <ellipse cx="0" cy="10" rx="14" ry="3" fill="rgba(0,0,0,0.25)"/>
      <!-- "Corpo" (foto + borda colorida do estado) -->
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
      ${person.isMe ? `
        <circle cx="0" cy="0" r="17" fill="none" stroke="#D4A843" stroke-width="2" stroke-dasharray="3,2">
          <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="8s" repeatCount="indefinite"/>
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
