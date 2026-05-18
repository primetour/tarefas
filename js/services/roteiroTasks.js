/**
 * PRIMETOUR — Roteiros · Geração de tarefas operacionais
 *
 * 4.43.0+ (Sprint 4)
 *
 * Quando um roteiro é APROVADO (status='approved') E está em workflowMode='system',
 * o sistema gera automaticamente um conjunto de tarefas operacionais pra equipe
 * executar (reservar voos, confirmar hotéis, organizar transfers, emitir vouchers,
 * etc.).
 *
 * IDEMPOTÊNCIA: usamos IDs determinísticos por operação
 *   `roteiro-{roteiroId}-{operation}-{suffix?}`
 *
 * Re-rodar a geração não cria duplicatas — createTask com _deterministicId já
 * preserva docs existentes (não sobrescreve). Útil pra:
 *   - User aprovar → desfazer → re-aprovar
 *   - Sincronizar tarefas após editar roteiro
 *   - Mudar from offline → system mid-flight
 *
 * TEMPLATE OPERACIONAL (padrão pra qualquer roteiro):
 *   1. Reservar voos      (deadline: 14d antes do início)
 *   2. Confirmar hotéis   (1 task por hotel, deadline: 14d antes)
 *   3. Transfers          (1 task se travel.destinations > 1)
 *   4. Emitir vouchers    (deadline: 3d antes do início)
 *   5. Seguro viagem      (deadline: 7d antes do início)
 *   6. Enviar materiais   (deadline: 7d antes do início)
 *
 * Tasks são gated por permission `task_create` do consultor. Se falhar,
 * registramos console.warn e seguimos (não bloqueamos aprovação do roteiro).
 */

import {
  collection, doc, getDoc, getDocs, updateDoc, query, where,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';
import { store } from '../store.js';
import { createTask, updateTask } from './tasks.js';
import { auditLog } from '../auth/audit.js';

const COL_ROTEIROS = 'roteiros';

/**
 * Calcula data X dias antes do startDate.
 * @param {string} startDate "YYYY-MM-DD"
 * @param {number} daysBefore
 * @returns {string|null} "YYYY-MM-DD" ou null se startDate inválido
 */
function dateMinusDays(startDate, daysBefore) {
  if (!startDate) return null;
  const d = new Date(startDate + 'T12:00:00');
  if (isNaN(d.getTime())) return null;
  d.setDate(d.getDate() - daysBefore);
  return d.toISOString().split('T')[0];
}

/**
 * Constrói lista de operações pra este roteiro.
 * Cada item: { op, suffix, title, description, daysBefore, priority }
 *
 * Por que não hardcode 6 operações: hotéis variam. Lista é dinâmica
 * baseada no conteúdo do roteiro (1 task por hotel, transfer só se
 * multi-destino, etc.).
 */
function buildOperationsTemplate(roteiro) {
  const ops = [];
  const startDate    = roteiro.travel?.startDate || null;
  const destinations = Array.isArray(roteiro.travel?.destinations) ? roteiro.travel.destinations : [];
  const hotels       = Array.isArray(roteiro.hotels) ? roteiro.hotels : [];
  const clientName   = roteiro.client?.name || '(sem nome)';
  const destLabel    = destinations.map(d => d.city || d.country).filter(Boolean).join(' · ') || '(destino)';

  // Prefixo padrão pra identificar visualmente no kanban/lista
  const prefix = `[Roteiro] ${clientName} · ${destLabel}`;

  // 1. Reservar voos
  ops.push({
    op:          'voos',
    suffix:      null,
    title:       `${prefix} — Reservar voos`,
    description: `Reservar voos para o roteiro. Início: ${startDate || 'a definir'}. ${destinations.length} destino(s).`,
    daysBefore:  14,
    priority:    'high',
  });

  // 2. Confirmar hotéis (1 por hotel; usa city/hotelName no título)
  hotels.forEach((h, i) => {
    const hotelLabel = h.hotelName?.trim() || `Hotel ${i + 1}`;
    const cityLabel  = h.city?.trim() ? ` (${h.city})` : '';
    ops.push({
      op:          'hotel',
      suffix:      String(i),  // hotel-0, hotel-1, ...
      title:       `${prefix} — Confirmar hotel: ${hotelLabel}${cityLabel}`,
      description: `Confirmar reserva no ${hotelLabel}${cityLabel}. Check-in: ${h.checkIn || 'a definir'} · Check-out: ${h.checkOut || 'a definir'} · Regime: ${h.regime || 'a definir'} · ${h.roomType || ''}`.trim(),
      daysBefore:  14,
      priority:    'high',
    });
  });

  // 3. Organizar transfers (só se houver múltiplos destinos OU pelo menos 1 hotel)
  if (destinations.length >= 1 || hotels.length >= 1) {
    ops.push({
      op:          'transfers',
      suffix:      null,
      title:       `${prefix} — Organizar transfers`,
      description: `Coordenar transfers de chegada, intercidades e partida. ${destinations.length} destino(s) · ${hotels.length} hotel(éis).`,
      daysBefore:  10,
      priority:    'medium',
    });
  }

  // 4. Seguro viagem
  ops.push({
    op:          'seguro',
    suffix:      null,
    title:       `${prefix} — Contratar seguro viagem`,
    description: `Contratar seguro viagem pra todos os ${(roteiro.travelers?.length || 1)} viajante(s).`,
    daysBefore:  7,
    priority:    'medium',
  });

  // 5. Enviar materiais ao cliente (welcome kit, link, app etc.)
  ops.push({
    op:          'materiais',
    suffix:      null,
    title:       `${prefix} — Enviar materiais ao cliente`,
    description: 'Welcome kit, link do roteiro, app oficial (se aplicável), instruções pré-embarque.',
    daysBefore:  7,
    priority:    'medium',
  });

  // 6. Emitir vouchers (último porque depende dos hotéis confirmados)
  ops.push({
    op:          'vouchers',
    suffix:      null,
    title:       `${prefix} — Emitir vouchers`,
    description: 'Emitir vouchers de hospedagem, transfers e eventos pra o cliente levar na viagem.',
    daysBefore:  3,
    priority:    'high',
  });

  return ops;
}

/**
 * Gera (ou regenera idempotentemente) tarefas operacionais pra um roteiro.
 *
 * @param {string} roteiroId
 * @returns {Promise<{ created: number, skipped: number, taskIds: string[] }>}
 *
 * NÃO BLOQUEIA se workflowMode='offline' — apenas retorna sem fazer nada.
 * Lança erro se permission `task_create` faltar.
 */
export async function generateOperationalTasksForRoteiro(roteiroId) {
  if (!roteiroId) throw new Error('roteiroId obrigatório.');

  // Lê roteiro fresh do Firestore (não confia em cache; user pode estar em outra tab)
  const rSnap = await getDoc(doc(db, COL_ROTEIROS, roteiroId));
  if (!rSnap.exists()) throw new Error('Roteiro não encontrado.');
  const roteiro = { id: rSnap.id, ...rSnap.data() };

  // workflowMode='offline' → sistema NÃO gera tarefas. Decisão do user
  // de gerenciar processo fora do sistema (planilhas/email). Retornamos
  // shape consistente com no-op.
  if (roteiro.workflowMode === 'offline') {
    return { created: 0, skipped: 0, taskIds: [], skippedReason: 'workflow-offline' };
  }

  if (!store.can('task_create')) throw new Error('Sem permissão para criar tarefas.');

  const startDate = roteiro.travel?.startDate || null;
  const ops = buildOperationsTemplate(roteiro);

  // Assignees: consultor + colaboradores. Se não houver consultor, current user.
  const me = store.get('currentUser')?.uid;
  const assignees = [
    ...(roteiro.consultantId ? [roteiro.consultantId] : []),
    ...((roteiro.collaboratorIds || []).filter(id => id && id !== roteiro.consultantId)),
  ];
  if (!assignees.length && me) assignees.push(me);

  // workspaceId opcional — herda do roteiro se houver (mantém scoping de squad)
  const workspaceId = roteiro.workspaceId || null;

  const taskIds = [];
  let created = 0;
  let skipped = 0;

  for (const op of ops) {
    const detId = op.suffix
      ? `roteiro-${roteiroId}-${op.op}-${op.suffix}`
      : `roteiro-${roteiroId}-${op.op}`;
    const dueDate = op.daysBefore != null ? dateMinusDays(startDate, op.daysBefore) : null;
    try {
      // createTask com _deterministicId é IDEMPOTENTE: se já existe, retorna
      // doc existente sem sobrescrever (preserva edits posteriores como
      // status, subtasks, comentários).
      const result = await createTask({
        _deterministicId: detId,
        title:        op.title,
        description:  op.description,
        status:       'not_started',
        priority:     op.priority || 'medium',
        assignees,
        observers:    [],
        dueDate,
        workspaceId,
        // Tags + custom field pra rastrear origem
        tags:         ['roteiro', 'operacional'],
        customFields: {
          roteiroId,
          roteiroOperation: op.op,
        },
      });
      taskIds.push(result.id);
      // Heurística: createTask retorna doc existente quando _deterministicId
      // bate (idempotente). Detectar "criado" vs "já existia" via createdAt
      // recém-feito ou bloco da função. Como API não distingue, contamos como
      // "criado" se nunca apareceu em linkedTaskIds antigo.
      if (!(roteiro.linkedTaskIds || []).includes(result.id)) created++;
      else skipped++;
    } catch (err) {
      console.warn(`[roteiroTasks] Falha em ${op.op}:`, err.message);
    }
  }

  // Atualiza o roteiro com IDs gerados + timestamp da primeira geração
  const patch = {
    linkedTaskIds:   taskIds,
    updatedAt:       serverTimestamp(),
  };
  if (!roteiro.tasksGeneratedAt) patch.tasksGeneratedAt = serverTimestamp();
  await updateDoc(doc(db, COL_ROTEIROS, roteiroId), patch);

  // Audit log
  auditLog('roteiros.tasks_generated', 'roteiro', roteiroId, {
    created, skipped, total: taskIds.length,
  }).catch(() => {});

  return { created, skipped, taskIds };
}

/**
 * Carrega tarefas atualmente vinculadas a um roteiro com seus statuses.
 * Útil pra renderizar progresso na UI do editor.
 *
 * @param {string[]} taskIds - linkedTaskIds do roteiro
 * @returns {Promise<Array<{ id, title, status, dueDate, assignees, priority }>>}
 */
export async function fetchLinkedTasksLite(taskIds) {
  if (!Array.isArray(taskIds) || !taskIds.length) return [];
  // Firestore tem limite de 30 docs por "in" (v10+). Chunked pra cobrir
  // roteiros com muitos hotéis (10+).
  const chunks = [];
  for (let i = 0; i < taskIds.length; i += 30) chunks.push(taskIds.slice(i, i + 30));
  const all = [];
  for (const chunk of chunks) {
    if (!chunk.length) continue;
    try {
      // Como Firestore não tem `where(documentId(), 'in', ...)` direto sem
      // o helper documentId, e a app já usa esse padrão (vide contentCalendar.js
      // linha 176), fazemos via getDoc individual em paralelo — mais simples e
      // bate cache local do Firestore quando há listener ativo na coleção.
      const docs = await Promise.all(
        chunk.map(id => getDoc(doc(db, 'tasks', id)).catch(() => null))
      );
      docs.forEach(snap => {
        if (snap?.exists()) {
          const d = snap.data();
          all.push({
            id:         snap.id,
            title:      d.title || '',
            status:     d.status || 'not_started',
            dueDate:    d.dueDate || null,
            priority:   d.priority || 'medium',
            operation:  d.customFields?.roteiroOperation || null,
          });
        }
      });
    } catch (err) {
      console.warn('[roteiroTasks] fetchLinkedTasksLite chunk falhou:', err.message);
    }
  }
  return all;
}

/**
 * Calcula progresso textual + percentual baseado nos status das tasks.
 * @param {Array} tasks - retorno de fetchLinkedTasksLite
 * @returns {{ done: number, total: number, pct: number, label: string }}
 */
export function calcLinkedTasksProgress(tasks) {
  const total = tasks.length;
  const done  = tasks.filter(t => t.status === 'done').length;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;
  return {
    done, total, pct,
    label: total === 0 ? '—' : `${done}/${total} concluídas`,
  };
}
