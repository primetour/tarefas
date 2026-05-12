/**
 * PRIMETOUR — Email Notification Preferences (4.35.26+)
 *
 * Gerencia o opt-in/opt-out por tipo de notificação por email.
 * Persiste em users/{uid}.prefs.emailNotifications.
 *
 * Schema:
 *   prefs.emailNotifications = {
 *     enabled: true,                  // master switch
 *     types: {                        // por tipo
 *       'task.assigned': true,
 *       'task.overdue':  true,
 *       'system.mention': true,
 *       'csat.responded': true,
 *       // demais default false
 *     },
 *     updatedAt: serverTimestamp,
 *   }
 */

import { db } from '../firebase.js';
import { store } from '../store.js';
import { doc, getDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* ─── Defaults conservadores ──────────────────────────────── */
export const DEFAULT_EMAIL_TYPES = {
  'task.assigned':            true,
  'task.overdue':              true,
  'system.mention':            true,
  'csat.responded':            true,
  'csat.low_score':            true,
  // Os outros começam false. User habilita explicitamente.
};

/* ─── Agrupamento por categoria (pra UI) ──────────────────── */
export const EMAIL_TYPE_GROUPS = [
  {
    key: 'tasks',
    label: 'Tarefas',
    icon: '📋',
    types: [
      { id: 'task.assigned',             label: 'Atribuído a você',     hint: 'Quando alguém te atribui uma tarefa' },
      { id: 'task.unassigned',           label: 'Removido de tarefa',   hint: 'Quando você é removido de uma tarefa' },
      { id: 'task.commented',            label: 'Novo comentário',      hint: 'Comentário em tarefa onde você participa' },
      { id: 'task.completed',            label: 'Concluída',            hint: 'Tarefa que você criou ou participa foi finalizada' },
      { id: 'task.overdue',              label: 'Atrasada',             hint: 'Tarefa sua passou da data de entrega' },
      { id: 'task.deadline_approaching', label: 'Prazo próximo',        hint: 'Prazo nas próximas 24h' },
      { id: 'task.rework',               label: 'Devolvida (rework)',   hint: 'Tarefa rejeitada e devolvida pra você' },
      { id: 'subtask.assigned',          label: 'Subtarefa atribuída',  hint: 'Subtarefa atribuída a você' },
    ],
  },
  {
    key: 'projects',
    label: 'Projetos & Squads',
    icon: '📊',
    types: [
      { id: 'project.updated',         label: 'Projeto atualizado',     hint: 'Mudanças em projetos que você participa' },
      { id: 'project.member_added',    label: 'Adicionado a projeto',   hint: 'Você foi adicionado a um projeto' },
      { id: 'project.member_removed',  label: 'Removido de projeto',    hint: 'Você foi removido de um projeto' },
      { id: 'squad.member_added',      label: 'Adicionado a squad',     hint: 'Você foi adicionado a um squad' },
      { id: 'squad.member_removed',    label: 'Removido de squad',      hint: 'Você foi removido de um squad' },
      { id: 'squad.admin_granted',     label: 'Promovido a admin',      hint: 'Você virou admin de um squad' },
      { id: 'squad.admin_revoked',     label: 'Admin removido',         hint: 'Você deixou de ser admin de um squad' },
    ],
  },
  {
    key: 'csat',
    label: 'CSAT',
    icon: '💬',
    types: [
      { id: 'csat.responded',  label: 'Resposta recebida',  hint: 'Cliente respondeu uma pesquisa que você disparou' },
      { id: 'csat.low_score',  label: 'Score crítico',      hint: 'Cliente avaliou abaixo de 3 estrelas — atenção' },
    ],
  },
  {
    key: 'goals',
    label: 'Metas',
    icon: '🎯',
    types: [
      { id: 'goal.published', label: 'Meta publicada',  hint: 'Nova meta atribuída a você' },
      { id: 'goal.deadline',  label: 'Prazo de meta',   hint: 'Meta sua tem prazo próximo' },
    ],
  },
  {
    key: 'requests',
    label: 'Solicitações',
    icon: '📩',
    types: [
      { id: 'request.created',   label: 'Nova solicitação',     hint: 'Solicitação criada no seu setor' },
      { id: 'request.converted', label: 'Convertida em tarefa', hint: 'Sua solicitação virou tarefa' },
    ],
  },
  {
    key: 'mentions',
    label: 'Menções',
    icon: '@',
    types: [
      { id: 'system.mention', label: 'Você foi mencionado',  hint: 'Alguém te mencionou com @ em algum lugar do sistema' },
    ],
  },
  {
    key: 'feedback',
    label: 'Feedbacks',
    icon: '✎',
    types: [
      { id: 'feedback.created',      label: 'Novo feedback',       hint: 'Feedback de gestão registrado pra você' },
      { id: 'feedback.schedule_due', label: 'Feedback pendente',   hint: 'Hora de dar feedback a um subordinado' },
    ],
  },
  {
    key: 'content',
    label: 'Conteúdo & Roteiros',
    icon: '✈',
    types: [
      { id: 'roteiro.assigned',                  label: 'Roteiro atribuído',     hint: 'Novo roteiro pra trabalhar' },
      { id: 'roteiro.status_change',             label: 'Status do roteiro',     hint: 'Roteiro mudou de etapa' },
      { id: 'content_calendar.slot_created',     label: 'Novo slot de conteúdo', hint: 'Slot criado no calendário do seu setor' },
      { id: 'content_calendar.published',        label: 'Conteúdo publicado',    hint: 'Slot foi publicado' },
    ],
  },
  {
    key: 'system',
    label: 'Sistema & IA',
    icon: '⚙',
    types: [
      { id: 'agent.run_failed',         label: 'Agente IA falhou',     hint: 'Falha na execução de um agente' },
      { id: 'security.suspicious_login',label: 'Login suspeito',       hint: 'Novo IP detectado no seu acesso' },
      { id: 'security.digest_critical', label: 'Digest crítico',       hint: 'Alerta de segurança CRÍTICO (master/admin)' },
      { id: 'lgpd.export_ready',        label: 'Export LGPD pronto',   hint: 'Sua exportação de dados está disponível' },
    ],
  },
];

/* ─── Acesso/persistência ─────────────────────────────────── */

/**
 * Lê prefs.emailNotifications do user logado.
 * Se nunca configurou, retorna defaults conservadores.
 */
export async function getEmailPrefs() {
  const uid = store.get('currentUser')?.uid;
  if (!uid) return { enabled: false, types: {} };

  try {
    const snap = await getDoc(doc(db, 'users', uid));
    if (!snap.exists()) return { enabled: false, types: {} };
    const data = snap.data();
    const ep = data.prefs?.emailNotifications;
    if (!ep) {
      // Primeira vez: defaults — habilitado com conjunto conservador
      return { enabled: true, types: { ...DEFAULT_EMAIL_TYPES } };
    }
    return {
      enabled: ep.enabled !== false,
      types: ep.types || {},
    };
  } catch (e) {
    console.warn('[emailPrefs] erro lendo:', e?.message);
    return { enabled: false, types: {} };
  }
}

/**
 * Grava prefs.emailNotifications.
 */
export async function saveEmailPrefs({ enabled, types }) {
  const uid = store.get('currentUser')?.uid;
  if (!uid) throw new Error('Não autenticado.');
  await updateDoc(doc(db, 'users', uid), {
    'prefs.emailNotifications': {
      enabled: !!enabled,
      types:   types || {},
      updatedAt: serverTimestamp(),
    },
  });
}

/**
 * Restaura defaults conservadores (sem mexer no enabled).
 */
export async function resetEmailPrefsToDefault() {
  await saveEmailPrefs({ enabled: true, types: { ...DEFAULT_EMAIL_TYPES } });
}
