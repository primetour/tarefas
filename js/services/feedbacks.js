/**
 * PRIMETOUR — Feedbacks Service
 * CRUD de feedbacks, agendamento de rotina e importação
 */

import { db }       from '../firebase.js';
import { auditLog } from '../auth/audit.js';
import { store }    from '../store.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, where, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const uid = () => store.get('currentUser')?.uid;

/* ─── Constantes ──────────────────────────────────────────── */

export const FB_CONTEXTS = ['Rotina', 'Situação pontual', 'Avaliação'];

export const FB_TYPES = [
  { key: 'positive',    label: 'Positivo',        color: '#22C55E', bg: '#22C55E18', icon: '▲' },
  { key: 'negative',    label: 'Negativo',        color: '#EF4444', bg: '#EF444418', icon: '▼' },
  { key: 'mixed',       label: 'Misto',           color: '#F59E0B', bg: '#F59E0B18', icon: '◆' },
  { key: 'development', label: 'Desenvolvimento', color: '#8B5CF6', bg: '#8B5CF618', icon: '◈' },
];

export const FB_SCHEDULE_FREQUENCIES = [
  { key: 'monthly',     label: 'Mensal',      days: 30  },
  { key: 'bimonthly',   label: 'Bimestral',   days: 60  },
  { key: 'quarterly',   label: 'Trimestral',  days: 90  },
  { key: 'semiannual',  label: 'Semestral',   days: 180 },
  { key: 'annual',      label: 'Anual',       days: 365 },
];

/* ─── CRUD Feedbacks ──────────────────────────────────────── */

export async function fetchFeedbacks() {
  const q = query(collection(db, 'feedbacks'), orderBy('date', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchFeedback(id) {
  const snap = await getDoc(doc(db, 'feedbacks', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveFeedback(id, data) {
  const ref = id ? doc(db, 'feedbacks', id) : doc(collection(db, 'feedbacks'));
  await setDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
    ...(id ? {} : { createdAt: serverTimestamp(), createdBy: uid() }),
  }, { merge: true });
  await auditLog(id ? 'feedback.update' : 'feedback.create', 'feedbacks', ref.id,
    { manager: data.managerId, collaborator: data.collaboratorId, type: data.type });
  return ref.id;
}

export async function deleteFeedback(id) {
  await deleteDoc(doc(db, 'feedbacks', id));
  await auditLog('feedback.delete', 'feedbacks', id, {});
}

/* ─── Feedback Schedules (rotina) ─────────────────────────── */

export async function fetchFeedbackSchedules() {
  const q = query(collection(db, 'feedback_schedules'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveFeedbackSchedule(id, data) {
  const ref = id ? doc(db, 'feedback_schedules', id) : doc(collection(db, 'feedback_schedules'));
  await setDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
    ...(id ? {} : { createdAt: serverTimestamp(), createdBy: uid() }),
  }, { merge: true });
  return ref.id;
}

export async function deleteFeedbackSchedule(id) {
  await deleteDoc(doc(db, 'feedback_schedules', id));
}

/**
 * Check which scheduled feedbacks are due (overdue).
 * Returns array of { schedule, collaboratorName, daysSinceLast }
 */
export async function checkOverdueSchedules() {
  const schedules = await fetchFeedbackSchedules();
  const feedbacks = await fetchFeedbacks();
  const users = store.get('users') || [];
  const now = new Date();
  const overdue = [];

  for (const sch of schedules) {
    if (!sch.active) continue;
    const freq = FB_SCHEDULE_FREQUENCIES.find(f => f.key === sch.frequency);
    if (!freq) continue;

    // For each collaborator in the schedule
    const collabs = sch.collaboratorIds || [];
    for (const collabId of collabs) {
      // Find last feedback for this manager-collaborator pair
      const lastFb = feedbacks.find(fb =>
        fb.managerId === sch.managerId && fb.collaboratorId === collabId
      );
      const lastDate = lastFb?.date
        ? new Date(lastFb.date)
        : (sch.startDate ? new Date(sch.startDate) : new Date(0));
      const daysSince = Math.floor((now - lastDate) / (1000 * 60 * 60 * 24));

      if (daysSince >= freq.days) {
        const user = users.find(u => u.id === collabId);
        overdue.push({
          schedule: sch,
          collaboratorId: collabId,
          collaboratorName: user?.name || collabId,
          daysSinceLast: daysSince,
          frequency: freq,
        });
      }
    }
  }

  return overdue;
}

/* ─── Batch import from XLS ───────────────────────────────── */

export function parseImportRow(row) {
  return {
    managerId:      '',  // Must be resolved by name
    collaboratorId: '',  // Must be resolved by name
    managerName:    (row['Gestor'] || row['gestor'] || '').trim(),
    collaboratorName: (row['Colaborador'] || row['colaborador'] || '').trim(),
    date:           (row['Data'] || row['data'] || '').trim(),
    context:        (row['Contexto'] || row['contexto'] || '').trim(),
    type:           (row['Tipo'] || row['tipo'] || '').trim().toLowerCase(),
    theme:          (row['Tema'] || row['tema'] || '').trim(),
    highlights:     (row['Pontos em destaque'] || row['destaques'] || '').trim(),
    improvements:   (row['Pontos a desenvolver'] || row['melhorias'] || '').trim(),
    actionPlan:     (row['Plano de ação'] || row['plano'] || '').trim(),
    perception:     (row['Percepção do colaborador'] || row['percepção'] || '').trim(),
  };
}

/**
 * Resolve user names → IDs and return validated rows.
 */
export function resolveImportUsers(rows, users) {
  const nameMap = {};
  for (const u of users) {
    const key = (u.name || '').trim().toLowerCase();
    if (key) nameMap[key] = u.id;
  }

  return rows.map(r => {
    const mId = nameMap[(r.managerName || '').toLowerCase()] || '';
    const cId = nameMap[(r.collaboratorName || '').toLowerCase()] || '';
    // Resolve type key
    const typeObj = FB_TYPES.find(t =>
      t.label.toLowerCase() === (r.type || '').toLowerCase()
      || t.key === (r.type || '').toLowerCase()
    );
    return {
      ...r,
      managerId: mId,
      collaboratorId: cId,
      type: typeObj?.key || r.type,
      _valid: !!(mId && cId && r.date && r.theme),
      _errors: [
        !mId ? `Gestor "${r.managerName}" não encontrado` : '',
        !cId ? `Colaborador "${r.collaboratorName}" não encontrado` : '',
        !r.date ? 'Data ausente' : '',
        !r.theme ? 'Tema ausente' : '',
      ].filter(Boolean),
    };
  });
}

export async function batchImportFeedbacks(rows) {
  let imported = 0;
  for (const row of rows) {
    if (!row._valid) continue;
    await saveFeedback(null, {
      managerId:      row.managerId,
      collaboratorId: row.collaboratorId,
      date:           row.date,
      context:        row.context || '',
      type:           row.type || '',
      theme:          row.theme || '',
      highlights:     row.highlights ? row.highlights.split('\n').filter(Boolean) : [],
      improvements:   row.improvements ? row.improvements.split('\n').filter(Boolean) : [],
      actionPlan:     row.actionPlan || '',
      perception:     row.perception || '',
    });
    imported++;
  }
  return imported;
}
