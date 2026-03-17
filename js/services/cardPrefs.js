/**
 * PRIMETOUR — Card Preferences Service
 * Preferências globais de visualização de cards por usuário
 * Persiste em users/{uid}.prefs.cardFields
 */

import {
  doc, updateDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';

/* ─── Campos disponíveis ─────────────────────────────────── */
export const CARD_FIELDS = [
  { key: 'requestingArea', label: 'Área solicitante',      icon: '📍', default: true  },
  { key: 'variationName',  label: 'Variação do material',  icon: '🔀', default: true  },
  { key: 'dueDate',        label: 'Prazo de entrega',      icon: '📅', default: true  },
  { key: 'priority',       label: 'Prioridade',            icon: '⚑',  default: false },
  { key: 'assignees',      label: 'Responsáveis',          icon: '👤', default: false },
  { key: 'nucleos',        label: 'Núcleo',                icon: '◈',  default: false },
  { key: 'projectId',      label: 'Projeto',               icon: '◈',  default: false },
  { key: 'currentStep',    label: 'Etapa atual (esteira)', icon: '▶',  default: true  },
  { key: 'status',         label: 'Status',                icon: '◎',  default: false },
  { key: 'sector',         label: 'Setor',                 icon: '🏢', default: false },
  { key: 'tags',           label: 'Tags',                  icon: '🏷',  default: false },
];

export const DEFAULT_CARD_FIELDS = CARD_FIELDS
  .filter(f => f.default)
  .map(f => f.key);

/* ─── Carregar preferências no store ─────────────────────── */
export function loadCardPrefs() {
  const profile = store.get('userProfile');
  const saved   = profile?.prefs?.cardFields;
  const prefs   = Array.isArray(saved) ? saved : DEFAULT_CARD_FIELDS;
  store.set('cardPrefs', prefs);
  return prefs;
}

/* ─── Salvar preferências ────────────────────────────────── */
export async function saveCardPrefs(fields) {
  const uid     = store.get('currentUser')?.uid;
  const profile = store.get('userProfile') || {};
  if (!uid) return;

  store.set('cardPrefs', fields);

  // Merge into existing prefs
  const newPrefs = { ...(profile.prefs || {}), cardFields: fields };
  store.set('userProfile', { ...profile, prefs: newPrefs });

  await updateDoc(doc(db, 'users', uid), {
    'prefs.cardFields': fields,
    updatedAt: serverTimestamp(),
  });
}

/* ─── Helper: verificar se campo está ativo ──────────────── */
export function isCardFieldActive(key) {
  const prefs = store.get('cardPrefs') || DEFAULT_CARD_FIELDS;
  return prefs.includes(key);
}

/* ─── Renderizar campos de um card ───────────────────────── */
export function renderCardFields(task, opts = {}) {
  const prefs    = store.get('cardPrefs') || DEFAULT_CARD_FIELDS;
  const users    = store.get('users') || [];
  const projects = store.get('projects') || [];
  const taskTypes= store.get('taskTypes') || [];
  const nucleos  = store.get('nucleos') || [];

  const { compact = false } = opts;
  const fontSize = compact ? '0.6875rem' : '0.75rem';

  const bits = [];

  prefs.forEach(key => {
    const fieldDef = CARD_FIELDS.find(f => f.key === key);
    if (!fieldDef) return;

    switch(key) {
      case 'requestingArea':
        if (task.requestingArea) bits.push(
          `<span title="Área: ${task.requestingArea}">${fieldDef.icon} ${task.requestingArea}</span>`
        );
        break;

      case 'variationName':
        const varName = task.variationName || task.customFields?.variationName;
        if (varName) bits.push(
          `<span title="Variação: ${varName}">${fieldDef.icon} ${varName}</span>`
        );
        break;

      case 'dueDate':
        if (task.dueDate) {
          const d       = task.dueDate?.toDate ? task.dueDate.toDate() : new Date(task.dueDate);
          const now     = new Date();
          const overdue = d < now && task.status !== 'done';
          const fmt     = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
          bits.push(
            `<span style="color:${overdue?'#EF4444':'inherit'};" title="Prazo: ${fmt}">${fieldDef.icon} ${fmt}</span>`
          );
        }
        break;

      case 'priority': {
        const P = { urgent:'🔴', high:'🟠', medium:'🟡', low:'🟢' };
        const L = { urgent:'Urgente', high:'Alta', medium:'Média', low:'Baixa' };
        if (task.priority && task.priority !== 'medium') bits.push(
          `<span title="Prioridade: ${L[task.priority]||task.priority}">${P[task.priority]||'⚑'} ${L[task.priority]||task.priority}</span>`
        );
        break;
      }

      case 'assignees':
        if (task.assignees?.length) {
          const names = task.assignees.slice(0,2).map(uid => {
            const u = users.find(x=>x.id===uid);
            return u?.name?.split(' ')[0] || '?';
          }).join(', ');
          bits.push(`<span title="Responsáveis: ${names}">${fieldDef.icon} ${names}${task.assignees.length>2?` +${task.assignees.length-2}`:''}</span>`);
        }
        break;

      case 'nucleos':
        if (task.nucleos?.length) {
          const names = task.nucleos.map(nid => {
            const n = nucleos.find(x=>x.id===nid||x.name===nid||x.value===nid);
            return n?.name || nid;
          }).join(', ');
          bits.push(`<span title="Núcleo: ${names}">${fieldDef.icon} ${names}</span>`);
        }
        break;

      case 'projectId':
        if (task.projectId) {
          const p = projects.find(x=>x.id===task.projectId);
          if (p) bits.push(`<span title="Projeto: ${p.name}">${fieldDef.icon} ${p.name}</span>`);
        }
        break;

      case 'currentStep': {
        const stepId  = task.customFields?.currentStep || task.customFields?.newsletterStatus;
        const typeDoc = taskTypes.find(t => t.id === task.typeId);
        const step    = typeDoc?.steps?.find(s => s.id === stepId);
        if (step) bits.push(
          `<span style="color:${step.color||'#6B7280'};" title="Etapa: ${step.label}">${fieldDef.icon} ${step.label}</span>`
        );
        break;
      }

      case 'status': {
        const S = { not_started:'◌', in_progress:'▶', review:'◷', done:'✓', rework:'↩', cancelled:'✕' };
        const L = { not_started:'Não iniciada', in_progress:'Em andamento', review:'Revisão', done:'Concluída', rework:'Retrabalho', cancelled:'Cancelada' };
        if (task.status && task.status !== 'not_started') bits.push(
          `<span title="Status: ${L[task.status]||task.status}">${S[task.status]||'◎'} ${L[task.status]||task.status}</span>`
        );
        break;
      }

      case 'sector':
        if (task.sector) bits.push(`<span title="Setor: ${task.sector}">${fieldDef.icon} ${task.sector}</span>`);
        break;

      case 'tags':
        if (task.tags?.length) bits.push(
          `<span title="Tags: ${task.tags.join(', ')}">${fieldDef.icon} ${task.tags.slice(0,2).join(', ')}</span>`
        );
        break;
    }
  });

  if (!bits.length) return '';

  return `<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:5px;
    font-size:${fontSize};color:var(--text-muted);line-height:1.4;">
    ${bits.join('')}
  </div>`;
}
