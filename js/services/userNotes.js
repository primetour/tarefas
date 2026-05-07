/**
 * PRIMETOUR — User Notes & Reminders Service (4.24+)
 *
 * Pessoal e privativo do usuário (cada doc tem `userId == currentUser.uid`).
 * Mantido em duas collections separadas pra escalar de forma independente:
 *
 *   - `user_notes`     — anotações livres formato post-it (texto + cor)
 *   - `user_reminders` — lembretes com data + status concluído + opção
 *                        de virar tarefa via taskModal
 *
 * Lembretes podem ser convertidos em tarefas mantendo um link bidirecional
 * (`reminder.taskId` ↔ não setado no task; só guardamos a referência reversa
 * pra evitar acoplamento de schema da `tasks`).
 */

import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  getDocs, query, where, orderBy, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';

const COL_NOTES     = 'user_notes';
const COL_REMINDERS = 'user_reminders';

const uid = () => store.get('currentUser')?.uid;

/* ─── Anotações (post-its) ───────────────────────────────── */

const NOTE_COLORS = [
  '#FEF3C7', // amarelo (default — clássico post-it)
  '#FECACA', // rosa
  '#BFDBFE', // azul claro
  '#BBF7D0', // verde claro
  '#DDD6FE', // roxo claro
  '#FED7AA', // laranja claro
];
export { NOTE_COLORS };

export async function fetchNotes() {
  const u = uid();
  if (!u) return [];
  const q = query(
    collection(db, COL_NOTES),
    where('userId', '==', u),
    orderBy('updatedAt', 'desc'),
  );
  try {
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    // Composite index may not exist; fallback sem orderBy
    if (err?.code === 'failed-precondition' || /index/i.test(err?.message || '')) {
      const snap = await getDocs(query(collection(db, COL_NOTES), where('userId', '==', u)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ta = a.updatedAt?.toMillis?.() || 0;
          const tb = b.updatedAt?.toMillis?.() || 0;
          return tb - ta;
        });
    }
    throw err;
  }
}

export async function createNote({ text = '', color = NOTE_COLORS[0] } = {}) {
  const u = uid();
  if (!u) throw new Error('Não autenticado.');
  const ref = await addDoc(collection(db, COL_NOTES), {
    userId:    u,
    text,
    color,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: ref.id, userId: u, text, color };
}

export async function updateNote(noteId, patch) {
  if (!uid()) throw new Error('Não autenticado.');
  await updateDoc(doc(db, COL_NOTES, noteId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteNote(noteId) {
  if (!uid()) throw new Error('Não autenticado.');
  await deleteDoc(doc(db, COL_NOTES, noteId));
}

/* ─── Lembretes ──────────────────────────────────────────── */

export async function fetchReminders({ includeDone = false } = {}) {
  const u = uid();
  if (!u) return [];
  try {
    const q = query(
      collection(db, COL_REMINDERS),
      where('userId', '==', u),
      orderBy('dueAt', 'asc'),
    );
    const snap = await getDocs(q);
    let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!includeDone) list = list.filter(r => !r.done);
    return list;
  } catch (err) {
    if (err?.code === 'failed-precondition' || /index/i.test(err?.message || '')) {
      const snap = await getDocs(query(collection(db, COL_REMINDERS), where('userId', '==', u)));
      let list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const ta = a.dueAt?.toMillis?.() || (a.dueAt ? new Date(a.dueAt).getTime() : 0);
          const tb = b.dueAt?.toMillis?.() || (b.dueAt ? new Date(b.dueAt).getTime() : 0);
          return ta - tb;
        });
      if (!includeDone) list = list.filter(r => !r.done);
      return list;
    }
    throw err;
  }
}

export async function createReminder({ title = '', dueAt = null, notify = true } = {}) {
  const u = uid();
  if (!u) throw new Error('Não autenticado.');
  if (!title.trim()) throw new Error('Título do lembrete é obrigatório.');
  const ref = await addDoc(collection(db, COL_REMINDERS), {
    userId:    u,
    title:     title.trim(),
    dueAt,     // string ISO yyyy-mm-dd OU Timestamp; ambos suportados
    notify,    // se true, gera notificação local quando vencer (checagem on-load)
    done:      false,
    taskId:    null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return { id: ref.id, userId: u, title: title.trim(), dueAt, notify, done: false };
}

export async function updateReminder(reminderId, patch) {
  if (!uid()) throw new Error('Não autenticado.');
  await updateDoc(doc(db, COL_REMINDERS, reminderId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteReminder(reminderId) {
  if (!uid()) throw new Error('Não autenticado.');
  await deleteDoc(doc(db, COL_REMINDERS, reminderId));
}

/**
 * Verifica lembretes vencidos não notificados e dispara toast info.
 * Chamado on-load do dashboard.
 *
 * Gera uma marca local em `notified:true` no doc após avisar pra evitar
 * spam (não usamos a collection notifications pra reduzir custo).
 */
export async function checkDueReminders() {
  try {
    const list = await fetchReminders({ includeDone: false });
    const now = Date.now();
    const due = list.filter(r => {
      if (!r.dueAt || r.notified) return false;
      const t = r.dueAt?.toMillis?.() || new Date(r.dueAt).getTime();
      return t <= now;
    });
    if (!due.length) return [];
    // Marca como notificado pra não disparar de novo
    await Promise.all(due.map(r =>
      updateReminder(r.id, { notified: true }).catch(() => {})
    ));
    return due;
  } catch (e) {
    console.warn('[reminders] checkDueReminders failed:', e.message);
    return [];
  }
}
