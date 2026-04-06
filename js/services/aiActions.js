/**
 * PRIMETOUR — AI Actions Registry
 *
 * Define as ações que a IA pode executar dentro do sistema.
 * Cada ação tem: nome, descrição, parâmetros esperados e a função executora.
 *
 * Fluxo:
 *  1. O chat envia as ações disponíveis no system prompt
 *  2. A IA responde com blocos <<<ACTION>>> quando quer executar algo
 *  3. O aiPanel parseia e executa via executeAction()
 *
 * Fase 1: Global + Tasks + Kanban + Projects
 * Fase 2: Roteiros, Portal, Feedbacks, Goals, CSAT, Calendar, Dashboard
 * Fase 3: Timeline, Requests, Arts, Users, Settings
 */

import { store }  from '../store.js';
import { router } from '../router.js';

/* Toast — import seguro para evitar erros quando o container não existe */
let toast = { success(){}, error(){}, info(){}, warning(){} };
try {
  const m = await import('../components/toast.js');
  if (m.toast) toast = m.toast;
} catch {}

/* Wrapper seguro para evitar perda de `this` */
function showToast(type, message) {
  try { toast[type]?.(message) || toast.info?.(message); } catch {}
}

/* ─── Helper: captura KPIs/stats do DOM da página visível ── */
function scrapeVisibleStats() {
  const content = document.getElementById('page-content');
  if (!content) return [];
  const stats = [];
  const seen = new Set();

  function add(label, value, source) {
    if (!label || !value) return;
    const key = label.toLowerCase().trim();
    if (seen.has(key)) return;
    seen.add(key);
    stats.push({ label: label.trim(), value: value.trim(), source });
  }

  // 1. Dashboard principal — .kpi-widget (usa .kpi-label + .kpi-value)
  content.querySelectorAll('.kpi-widget').forEach(card => {
    const label = card.querySelector('.kpi-label')?.textContent?.trim() || '';
    const value = card.querySelector('.kpi-value')?.textContent?.trim() || '';
    add(label, value, 'dashboard');
  });

  // 2. GA / Meta / Newsletter — cards com inline styles
  //    Estrutura: .card > div(label uppercase) > div(valor bold) > div(subtexto)
  content.querySelectorAll('#ga-kpis .card, #meta-kpis .card, #nl-kpis .card').forEach(card => {
    const divs = card.querySelectorAll(':scope > div');
    let label = '', value = '', sub = '';
    for (const d of divs) {
      const s = (d.getAttribute('style') || '').toLowerCase();
      const t = d.textContent?.trim() || '';
      if (!t) continue;
      if (s.includes('uppercase') || s.includes('letter-spacing')) {
        // Label — pode conter ícone "i" no final, limpar
        label = t.replace(/\s*i\s*$/, '').trim();
      } else if (s.includes('font-weight') && (s.includes('600') || s.includes('700') || s.includes('bold'))) {
        value = t;
      } else if (s.includes('font-size:1.') || s.includes('font-size: 1.')) {
        value = t;
      } else if (label && value) {
        sub = t;
      }
    }
    // Fallback: se não pegou por style, usar posição dos filhos
    if (!label || !value) {
      const children = Array.from(divs);
      if (children.length >= 2) {
        label = label || children[0]?.textContent?.trim() || '';
        value = value || children[1]?.textContent?.trim() || '';
        if (children.length >= 3) sub = sub || children[2]?.textContent?.trim() || '';
      }
    }
    const section = card.closest('#ga-kpis') ? 'Google Analytics'
                  : card.closest('#meta-kpis') ? 'Meta/Instagram'
                  : 'Newsletter';
    add(label, sub ? `${value} (${sub})` : value, section);
  });

  // 3. stat-card (variante legada)
  content.querySelectorAll('.stat-card').forEach(card => {
    const label = card.querySelector('.stat-card-label, small')?.textContent?.trim() || '';
    const value = card.querySelector('.stat-card-value')?.textContent?.trim() || '';
    add(label, value, 'stat-card');
  });

  // 4. rd-kpi-card (roteiroDashboard)
  content.querySelectorAll('.rd-kpi-card').forEach(card => {
    const label = card.querySelector('.rd-kpi-label')?.textContent?.trim() || '';
    const value = card.querySelector('.rd-kpi-value')?.textContent?.trim() || '';
    add(label, value, 'roteiros');
  });

  // 5. kpi-card genérico (CSAT, outros)
  content.querySelectorAll('.kpi-card').forEach(card => {
    const label = card.querySelector('.kpi-label, small, [class*="label"]')?.textContent?.trim() || '';
    const value = card.querySelector('.kpi-value, [class*="value"]')?.textContent?.trim() || '';
    add(label, value, 'kpi-card');
  });

  // 6. dash-widget sem kpi-widget (caso use outro layout)
  content.querySelectorAll('.dash-widget').forEach(card => {
    if (card.querySelector('.kpi-widget')) return; // já capturado no passo 1
    const label = card.querySelector('.kpi-label, small, [class*="label"]')?.textContent?.trim() || '';
    const value = card.querySelector('.kpi-value, [class*="value"], b, strong')?.textContent?.trim() || '';
    add(label, value, 'dash-widget');
  });

  // 7. Fallback: elementos com metric/stat/kpi no class
  if (!stats.length) {
    content.querySelectorAll('[class*="metric"], [class*="stat-"], [class*="kpi"]').forEach(el => {
      const label = el.querySelector('small, [class*="label"], span')?.textContent?.trim() || '';
      const value = el.querySelector('[class*="value"], [class*="count"], b, strong')?.textContent?.trim() || '';
      add(label, value, 'fallback');
    });
  }

  return stats;
}

/* ─── Registry de ações GLOBAIS ────────────────────────────── */

const GLOBAL_ACTIONS = [
  {
    name: 'navigate',
    description: 'Navegar para outra página/módulo do sistema',
    params: { route: 'string — rota destino (ex: tasks, kanban, dashboard, roteiros, portal-tips, feedbacks, goals, projects, csat, calendar, timeline, requests)' },
    execute: async ({ route }) => {
      router.navigate(route);
      return { success: true, message: `Navegando para ${route}` };
    },
  },
  {
    name: 'show_toast',
    description: 'Mostrar uma notificação/mensagem para o usuário',
    params: { message: 'string — texto da mensagem', type: 'string — success, error, info, warning (default: info)' },
    execute: async ({ message, type }) => {
      showToast(type || 'info', message);
      return { success: true };
    },
  },
  {
    name: 'get_current_user',
    description: 'Obter informações do usuário logado (nome, email, setor, permissões)',
    params: {},
    execute: async () => {
      const user = store.get('currentUser');
      const profile = store.get('currentProfile') || store.get('userProfile') || {};
      return {
        success: true,
        data: {
          uid: user?.uid,
          email: user?.email,
          name: profile.name || profile.displayName || user?.displayName || '',
          sector: profile.sector || '',
          role: profile.role || '',
          nucleos: profile.nucleos || [],
        },
      };
    },
  },
];

/* ─── Registry de ações por MÓDULO ─────────────────────────── */

const MODULE_ACTIONS = {

  /* ═══════════════════════════════════════════════════════════
   * TASKS — Gerenciamento de Tarefas
   * ═══════════════════════════════════════════════════════════ */
  tasks: [
    {
      name: 'create_task',
      description: 'Criar uma nova tarefa no sistema',
      params: {
        title: 'string — título da tarefa (obrigatório)',
        description: 'string — descrição detalhada (opcional)',
        priority: 'string — urgent, high, medium, low (default: medium)',
        status: 'string — not_started, in_progress, review, done (default: not_started)',
        sector: 'string — setor responsável (opcional)',
        dueDate: 'string — data de vencimento YYYY-MM-DD (opcional)',
      },
      execute: async (params) => {
        const { createTask } = await import('./tasks.js');
        const user = store.get('currentUser');
        const task = await createTask({
          title: params.title,
          description: params.description || '',
          priority: params.priority || 'medium',
          status: params.status || 'not_started',
          sector: params.sector || store.get('userSector') || '',
          createdBy: user?.uid,
          assignees: user?.uid ? [user.uid] : [],
          ...(params.dueDate ? { dueDate: new Date(params.dueDate + 'T12:00:00') } : {}),
        });
        return { success: true, message: `Tarefa "${params.title}" criada com sucesso! ID: ${task?.id}`, taskId: task?.id, data: { taskId: task?.id, title: params.title } };
      },
    },
    {
      name: 'update_task',
      description: 'Atualizar uma tarefa existente (mudar status, prioridade, descrição, etc.)',
      params: {
        taskId: 'string — ID da tarefa (obrigatório)',
        title: 'string — novo título (opcional)',
        description: 'string — nova descrição (opcional)',
        status: 'string — not_started, in_progress, review, done, cancelled (opcional)',
        priority: 'string — urgent, high, medium, low (opcional)',
      },
      execute: async (params) => {
        const { updateTask } = await import('./tasks.js');
        const { taskId, ...data } = params;
        Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
        await updateTask(taskId, data);
        return { success: true, message: `Tarefa atualizada com sucesso!` };
      },
    },
    {
      name: 'complete_task',
      description: 'Marcar uma tarefa como concluída',
      params: { taskId: 'string — ID da tarefa' },
      execute: async ({ taskId }) => {
        const { toggleTaskComplete } = await import('./tasks.js');
        await toggleTaskComplete(taskId, true);
        return { success: true, message: 'Tarefa marcada como concluída!' };
      },
    },
    {
      name: 'add_comment',
      description: 'Adicionar um comentário em uma tarefa',
      params: {
        taskId: 'string — ID da tarefa',
        text: 'string — texto do comentário',
      },
      execute: async ({ taskId, text }) => {
        const { addComment } = await import('./tasks.js');
        await addComment(taskId, text);
        return { success: true, message: 'Comentário adicionado!' };
      },
    },
    {
      name: 'list_tasks',
      description: 'Listar tarefas com filtros opcionais. Use para buscar dados antes de responder perguntas sobre tarefas.',
      params: {
        status: 'string — filtrar por status: not_started, in_progress, review, done (opcional)',
        priority: 'string — filtrar por prioridade: urgent, high, medium, low (opcional)',
        sector: 'string — filtrar por setor (opcional)',
        limitN: 'number — limitar quantidade de resultados (default: 20)',
      },
      execute: async (params) => {
        const { fetchTasks } = await import('./tasks.js');
        const tasks = await fetchTasks({
          status: params.status,
          priority: params.priority,
          sector: params.sector,
          limitN: params.limitN || 20,
        });
        const summary = tasks.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          sector: t.sector || '',
          assignees: t.assigneeNames || t.assignees,
          dueDate: t.dueDate?.toDate?.()?.toLocaleDateString?.('pt-BR') || t.dueDate || '',
          createdAt: t.createdAt?.toDate?.()?.toLocaleDateString?.('pt-BR') || '',
        }));
        return { success: true, data: summary, message: `${tasks.length} tarefa(s) encontrada(s)` };
      },
    },
    {
      name: 'filter_view',
      description: 'Aplicar filtros na visualização atual de tarefas na tela',
      params: {
        status: 'string — status para filtrar (ou vazio para limpar)',
        priority: 'string — prioridade para filtrar (ou vazio para limpar)',
      },
      execute: async ({ status, priority }) => {
        if (status) {
          const el = document.getElementById('filter-status');
          if (el) { el.value = status; el.dispatchEvent(new Event('change')); }
        }
        if (priority) {
          const el = document.getElementById('filter-priority');
          if (el) { el.value = priority; el.dispatchEvent(new Event('change')); }
        }
        return { success: true, message: 'Filtros aplicados na tela!' };
      },
    },
    {
      name: 'get_task_summary',
      description: 'Obter um resumo quantitativo das tarefas (total, por status, por prioridade)',
      params: {},
      execute: async () => {
        const { fetchTasks } = await import('./tasks.js');
        const tasks = await fetchTasks({ limitN: 500 });
        const byStatus = {};
        const byPriority = {};
        tasks.forEach(t => {
          byStatus[t.status] = (byStatus[t.status] || 0) + 1;
          byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
        });
        return {
          success: true,
          data: { total: tasks.length, byStatus, byPriority },
          message: `${tasks.length} tarefa(s) no total`,
        };
      },
    },
    {
      name: 'bulk_update_status',
      description: 'Atualizar o status de múltiplas tarefas de uma vez',
      params: {
        taskIds: 'string[] — array de IDs das tarefas',
        newStatus: 'string — novo status: not_started, in_progress, review, done, cancelled',
      },
      execute: async ({ taskIds, newStatus }) => {
        const { updateTask } = await import('./tasks.js');
        const ids = Array.isArray(taskIds) ? taskIds : [taskIds];
        let count = 0;
        for (const id of ids) {
          try { await updateTask(id, { status: newStatus }); count++; } catch {}
        }
        return { success: true, message: `${count} tarefa(s) atualizada(s) para "${newStatus}"` };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * KANBAN — Quadro visual de tarefas
   * ═══════════════════════════════════════════════════════════ */
  kanban: [
    {
      name: 'move_card',
      description: 'Mover um card do Kanban para outro status/coluna',
      params: {
        taskId: 'string — ID da tarefa/card',
        newStatus: 'string — novo status: not_started, in_progress, review, done',
      },
      execute: async ({ taskId, newStatus }) => {
        const { moveTaskKanban } = await import('./tasks.js');
        await moveTaskKanban(taskId, newStatus, 0);
        return { success: true, message: `Card movido para ${newStatus}!` };
      },
    },
    {
      name: 'list_tasks',
      description: 'Listar todas as tarefas do board (para análise ou busca)',
      params: {
        status: 'string — filtrar por coluna/status (opcional)',
        limitN: 'number — limitar resultados (default: 50)',
      },
      execute: async (params) => {
        const { fetchTasks } = await import('./tasks.js');
        const tasks = await fetchTasks({ status: params.status, limitN: params.limitN || 50 });
        const summary = tasks.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          assignees: t.assigneeNames || t.assignees,
        }));
        return { success: true, data: summary, message: `${tasks.length} card(s) encontrado(s)` };
      },
    },
    {
      name: 'get_board_summary',
      description: 'Obter resumo do quadro Kanban (quantidade de cards por coluna)',
      params: {},
      execute: async () => {
        const { fetchTasks } = await import('./tasks.js');
        const tasks = await fetchTasks({ limitN: 500 });
        const columns = { not_started: 0, in_progress: 0, review: 0, done: 0 };
        tasks.forEach(t => { if (columns[t.status] !== undefined) columns[t.status]++; });
        return {
          success: true,
          data: columns,
          message: `Board: ${Object.entries(columns).map(([k,v]) => `${k}=${v}`).join(', ')}`,
        };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * PROJECTS — Gestão de Projetos
   * ═══════════════════════════════════════════════════════════ */
  projects: [
    {
      name: 'create_project',
      description: 'Criar um novo projeto',
      params: {
        name: 'string — nome do projeto (obrigatório)',
        description: 'string — descrição (opcional)',
        color: 'string — cor hex (opcional, default: #3B82F6)',
        icon: 'string — emoji do projeto (opcional, default: 📁)',
      },
      execute: async (params) => {
        const { createProject } = await import('./projects.js');
        await createProject({
          name: params.name,
          description: params.description || '',
          color: params.color || '#3B82F6',
          icon: params.icon || '📁',
          status: 'active',
        });
        return { success: true, message: `Projeto "${params.name}" criado!` };
      },
    },
    {
      name: 'list_projects',
      description: 'Listar projetos ativos',
      params: { status: 'string — filtrar por status: active, archived (opcional, default: todos)' },
      execute: async (params) => {
        const { fetchProjects } = await import('./projects.js');
        let projects = await fetchProjects();
        if (params?.status) projects = projects.filter(p => p.status === params.status);
        const summary = projects.map(p => ({ id: p.id, name: p.name, status: p.status, icon: p.icon, description: p.description || '' }));
        return { success: true, data: summary, message: `${projects.length} projeto(s)` };
      },
    },
    {
      name: 'update_project',
      description: 'Atualizar dados de um projeto (nome, descrição, status)',
      params: {
        projectId: 'string — ID do projeto (obrigatório)',
        name: 'string — novo nome (opcional)',
        description: 'string — nova descrição (opcional)',
        status: 'string — active, archived (opcional)',
      },
      execute: async (params) => {
        const { updateProject } = await import('./projects.js');
        const { projectId, ...data } = params;
        Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
        await updateProject(projectId, data);
        return { success: true, message: `Projeto atualizado!` };
      },
    },
    {
      name: 'get_project_tasks',
      description: 'Listar tarefas vinculadas a um projeto específico',
      params: {
        projectId: 'string — ID do projeto',
        status: 'string — filtrar por status (opcional)',
      },
      execute: async ({ projectId, status }) => {
        const { fetchTasks } = await import('./tasks.js');
        let tasks = await fetchTasks({ projectId, limitN: 50 });
        if (status) tasks = tasks.filter(t => t.status === status);
        const summary = tasks.map(t => ({ id: t.id, title: t.title, status: t.status, priority: t.priority }));
        return { success: true, data: summary, message: `${tasks.length} tarefa(s) no projeto` };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * ROTEIROS — Roteiros de Viagem
   * ═══════════════════════════════════════════════════════════ */
  roteiros: [
    {
      name: 'list_roteiros',
      description: 'Listar roteiros de viagem cadastrados',
      params: { status: 'string — filtrar por status: draft, review, sent, approved, archived (opcional)' },
      execute: async (params) => {
        const { fetchRoteiros } = await import('./roteiros.js');
        let roteiros = await fetchRoteiros();
        if (params.status) roteiros = roteiros.filter(r => r.status === params.status);
        const summary = roteiros.slice(0, 20).map(r => ({
          id: r.id,
          title: r.title || '',
          clientName: r.clientName || r.client?.name || '',
          destination: r.destination || r.travel?.destinations?.map(d => d.city).join(', ') || '',
          status: r.status,
          consultantName: r.consultantName || '',
          nights: r.travel?.nights || '',
        }));
        return { success: true, data: summary, message: `${roteiros.length} roteiro(s)` };
      },
    },
    {
      name: 'get_roteiro',
      description: 'Obter detalhes de um roteiro específico',
      params: { roteiroId: 'string — ID do roteiro (obrigatório)' },
      execute: async ({ roteiroId }) => {
        const { fetchRoteiro } = await import('./roteiros.js');
        const roteiro = await fetchRoteiro(roteiroId);
        if (!roteiro) return { success: false, message: 'Roteiro não encontrado' };
        return {
          success: true,
          data: {
            id: roteiro.id, title: roteiro.title, status: roteiro.status,
            client: roteiro.client, travel: roteiro.travel,
            daysCount: roteiro.days?.length || 0,
            hotels: roteiro.hotels?.length || 0,
            pricing: roteiro.pricing,
          },
          message: `Roteiro: ${roteiro.title || roteiro.client?.name || roteiroId}`,
        };
      },
    },
    {
      name: 'update_roteiro_status',
      description: 'Alterar o status de um roteiro (ex: draft → review → sent → approved)',
      params: {
        roteiroId: 'string — ID do roteiro (obrigatório)',
        status: 'string — novo status: draft, review, sent, approved, archived (obrigatório)',
      },
      execute: async ({ roteiroId, status }) => {
        const { updateRoteiroStatus } = await import('./roteiros.js');
        await updateRoteiroStatus(roteiroId, status);
        return { success: true, message: `Roteiro atualizado para "${status}"` };
      },
    },
    {
      name: 'duplicate_roteiro',
      description: 'Duplicar um roteiro existente (cria cópia como rascunho)',
      params: { roteiroId: 'string — ID do roteiro a duplicar' },
      execute: async ({ roteiroId }) => {
        const { duplicateRoteiro } = await import('./roteiros.js');
        const newId = await duplicateRoteiro(roteiroId);
        return { success: true, message: `Roteiro duplicado!`, newRoteiroId: newId };
      },
    },
    {
      name: 'get_roteiro_stats',
      description: 'Obter estatísticas gerais dos roteiros (total, por status, destinos mais cotados)',
      params: {},
      execute: async () => {
        const { fetchRoteiroStats } = await import('./roteiros.js');
        const stats = await fetchRoteiroStats();
        return { success: true, data: stats, message: 'Estatísticas de roteiros' };
      },
    },
    {
      name: 'list_recent_clients',
      description: 'Listar clientes recentes de roteiros (para autocompletar)',
      params: {},
      execute: async () => {
        const { fetchRecentClients } = await import('./roteiros.js');
        const clients = await fetchRecentClients();
        return { success: true, data: clients.slice(0, 15), message: `${clients.length} cliente(s) recente(s)` };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * PORTAL-TIPS — Portal de Dicas de Viagem
   * ═══════════════════════════════════════════════════════════ */
  'portal-tips': [
    {
      name: 'list_destinations',
      description: 'Listar destinos disponíveis no portal de dicas',
      params: {
        continent: 'string — filtrar por continente (opcional)',
        country: 'string — filtrar por país (opcional)',
      },
      execute: async (params) => {
        const { fetchDestinations } = await import('./portal.js');
        let destinations = await fetchDestinations();
        if (params.continent) destinations = destinations.filter(d => d.continent === params.continent);
        if (params.country) destinations = destinations.filter(d => d.country === params.country);
        const summary = destinations.slice(0, 30).map(d => ({
          id: d.id, name: d.name, city: d.city || d.name, country: d.country || '', continent: d.continent || '',
        }));
        return { success: true, data: summary, message: `${destinations.length} destino(s)` };
      },
    },
    {
      name: 'list_tips',
      description: 'Listar dicas de um destino específico',
      params: {
        destinationId: 'string — ID do destino (obrigatório)',
        category: 'string — filtrar por categoria: restaurantes, atracoes, hoteis, informacoes_gerais, etc. (opcional)',
      },
      execute: async ({ destinationId, category }) => {
        const { fetchTips } = await import('./portal.js');
        let tips = await fetchTips(destinationId);
        if (category) tips = tips.filter(t => t.category === category);
        const summary = tips.slice(0, 20).map(t => ({
          id: t.id, title: t.title || t.name || '', category: t.category || '', priority: t.priority || false,
        }));
        return { success: true, data: summary, message: `${tips.length} dica(s)` };
      },
    },
    {
      name: 'get_tip_detail',
      description: 'Obter conteúdo detalhado de uma dica específica',
      params: { tipId: 'string — ID da dica (obrigatório)' },
      execute: async ({ tipId }) => {
        const { fetchTip } = await import('./portal.js');
        const tip = await fetchTip(tipId);
        if (!tip) return { success: false, message: 'Dica não encontrada' };
        return {
          success: true,
          data: { id: tip.id, title: tip.title, category: tip.category, content: (tip.content || '').substring(0, 500) + '...' },
          message: `Dica: ${tip.title || tipId}`,
        };
      },
    },
    {
      name: 'list_areas',
      description: 'Listar áreas/BUs (identidades visuais) do portal',
      params: {},
      execute: async () => {
        const { fetchAreas } = await import('./portal.js');
        const areas = await fetchAreas();
        const summary = areas.map(a => ({ id: a.id, name: a.name, color: a.primaryColor || '' }));
        return { success: true, data: summary, message: `${areas.length} área(s)/BU(s)` };
      },
    },
    {
      name: 'list_images',
      description: 'Listar imagens disponíveis para um destino',
      params: {
        city: 'string — cidade (opcional)',
        country: 'string — país (opcional)',
        destinationId: 'string — ID do destino (opcional)',
      },
      execute: async (params) => {
        const { fetchImages } = await import('./portal.js');
        const images = await fetchImages(params);
        const summary = images.slice(0, 20).map(i => ({
          id: i.id, title: i.title || i.name || '', city: i.city || '', tags: i.tags || [],
        }));
        return { success: true, data: summary, message: `${images.length} imagem(ns)` };
      },
    },
    {
      name: 'toggle_tip_priority',
      description: 'Marcar/desmarcar uma dica como prioritária (destaque)',
      params: {
        tipId: 'string — ID da dica',
        priority: 'boolean — true para destacar, false para remover destaque',
      },
      execute: async ({ tipId, priority }) => {
        const { toggleTipPriority } = await import('./portal.js');
        await toggleTipPriority(tipId, priority);
        return { success: true, message: priority ? 'Dica marcada como prioritária!' : 'Destaque removido da dica' };
      },
    },
    {
      name: 'create_destination',
      description: 'Criar um novo destino no portal de dicas',
      params: {
        name: 'string — nome do destino (ex: "Miami")',
        city: 'string — cidade (ex: "Miami")',
        country: 'string — país (ex: "Estados Unidos")',
        continent: 'string — continente: america_do_norte, america_do_sul, europa, asia, africa, oceania',
        description: 'string — descrição breve do destino (opcional)',
      },
      execute: async (params) => {
        const { saveDestination } = await import('./portal.js');
        const id = await saveDestination(null, {
          name: params.name,
          city: params.city || params.name,
          country: params.country || '',
          continent: params.continent || '',
          description: params.description || '',
        });
        showToast('success', `Destino "${params.name}" criado!`);
        return { success: true, message: `Destino "${params.name}" criado!`, data: { destinationId: id, name: params.name } };
      },
    },
    {
      name: 'create_tip',
      description: 'Criar uma nova dica de viagem para um destino',
      params: {
        destinationId: 'string — ID do destino (obrigatório). Use list_destinations para encontrar.',
        title: 'string — título da dica (ex: "Melhores restaurantes em Miami")',
        category: 'string — categoria: restaurantes, atracoes, hoteis, informacoes_gerais, compras, vida_noturna, transporte, dicas_praticas',
        content: 'string — conteúdo/texto da dica (pode ser longo)',
        priority: 'boolean — true para destacar (opcional, default: false)',
      },
      execute: async (params) => {
        if (!params.destinationId) return { success: false, message: 'destinationId é obrigatório. Use list_destinations para encontrar o ID do destino.' };
        const { saveTip } = await import('./portal.js');
        const id = await saveTip(null, {
          destinationId: params.destinationId,
          title: params.title || '',
          category: params.category || 'informacoes_gerais',
          content: params.content || '',
          priority: params.priority || false,
        });
        showToast('success', `Dica "${params.title}" criada!`);
        return { success: true, message: `Dica "${params.title}" criada!`, data: { tipId: id, title: params.title } };
      },
    },
    {
      name: 'update_tip',
      description: 'Atualizar o conteúdo de uma dica existente',
      params: {
        tipId: 'string — ID da dica (obrigatório)',
        title: 'string — novo título (opcional)',
        content: 'string — novo conteúdo (opcional)',
        category: 'string — nova categoria (opcional)',
      },
      execute: async (params) => {
        if (!params.tipId) return { success: false, message: 'tipId é obrigatório' };
        const { saveTip } = await import('./portal.js');
        const { tipId, ...data } = params;
        // Remover campos vazios
        Object.keys(data).forEach(k => { if (!data[k]) delete data[k]; });
        await saveTip(tipId, data);
        showToast('success', 'Dica atualizada!');
        return { success: true, message: 'Dica atualizada com sucesso!' };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * FEEDBACKS — Feedbacks e Pesquisas
   * ═══════════════════════════════════════════════════════════ */
  feedbacks: [
    {
      name: 'list_feedbacks',
      description: 'Listar feedbacks registrados no sistema',
      params: { limitN: 'number — limitar quantidade (default: 20)' },
      execute: async (params) => {
        const { fetchFeedbacks } = await import('./feedbacks.js');
        const feedbacks = await fetchFeedbacks();
        const summary = feedbacks.slice(0, params?.limitN || 20).map(f => ({
          id: f.id,
          title: f.title || f.type || '',
          type: f.type || '',
          status: f.status || '',
          rating: f.rating || '',
          customer: f.customer || f.customerName || '',
          createdAt: f.createdAt?.toDate?.()?.toLocaleDateString?.('pt-BR') || '',
        }));
        return { success: true, data: summary, message: `${feedbacks.length} feedback(s)` };
      },
    },
    {
      name: 'get_feedback',
      description: 'Obter detalhes de um feedback específico',
      params: { feedbackId: 'string — ID do feedback (obrigatório)' },
      execute: async ({ feedbackId }) => {
        const { fetchFeedback } = await import('./feedbacks.js');
        const fb = await fetchFeedback(feedbackId);
        if (!fb) return { success: false, message: 'Feedback não encontrado' };
        return {
          success: true,
          data: {
            id: fb.id, title: fb.title, type: fb.type, status: fb.status,
            rating: fb.rating, customer: fb.customer || fb.customerName,
            text: (fb.feedbackText || fb.description || '').substring(0, 300),
          },
          message: `Feedback: ${fb.title || feedbackId}`,
        };
      },
    },
    {
      name: 'create_feedback',
      description: 'Registrar um novo feedback no sistema',
      params: {
        title: 'string — título do feedback (obrigatório)',
        type: 'string — tipo: elogio, sugestao, reclamacao, outro (default: outro)',
        description: 'string — descrição detalhada (opcional)',
        customer: 'string — nome do cliente (opcional)',
        rating: 'number — nota de 1 a 5 (opcional)',
      },
      execute: async (params) => {
        const { saveFeedback } = await import('./feedbacks.js');
        await saveFeedback({
          title: params.title,
          type: params.type || 'outro',
          description: params.description || '',
          feedbackText: params.description || '',
          customer: params.customer || '',
          customerName: params.customer || '',
          rating: params.rating || null,
          status: 'novo',
        });
        return { success: true, message: `Feedback "${params.title}" registrado!` };
      },
    },
    {
      name: 'get_feedback_summary',
      description: 'Obter resumo de feedbacks (total, por tipo, rating médio)',
      params: {},
      execute: async () => {
        const { fetchFeedbacks } = await import('./feedbacks.js');
        const feedbacks = await fetchFeedbacks();
        const byType = {};
        let totalRating = 0, ratingCount = 0;
        feedbacks.forEach(f => {
          byType[f.type || 'outro'] = (byType[f.type || 'outro'] || 0) + 1;
          if (f.rating) { totalRating += f.rating; ratingCount++; }
        });
        return {
          success: true,
          data: {
            total: feedbacks.length,
            byType,
            avgRating: ratingCount > 0 ? (totalRating / ratingCount).toFixed(1) : 'N/A',
          },
          message: `${feedbacks.length} feedback(s) no total`,
        };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * GOALS — Metas e OKRs
   * ═══════════════════════════════════════════════════════════ */
  goals: [
    {
      name: 'list_goals',
      description: 'Listar metas/goals cadastradas no sistema',
      params: { status: 'string — filtrar por status (opcional)' },
      execute: async (params) => {
        const { fetchGoals } = await import('./goals.js');
        let goals = await fetchGoals();
        if (params?.status) goals = goals.filter(g => g.status === params.status);
        const summary = goals.slice(0, 20).map(g => ({
          id: g.id,
          title: g.title || g.name || '',
          status: g.status || '',
          period: g.period || '',
          progress: g.progress || 0,
        }));
        return { success: true, data: summary, message: `${goals.length} meta(s)` };
      },
    },
    {
      name: 'get_goal',
      description: 'Obter detalhes de uma meta específica',
      params: { goalId: 'string — ID da meta (obrigatório)' },
      execute: async ({ goalId }) => {
        const { fetchGoal } = await import('./goals.js');
        const goal = await fetchGoal(goalId);
        if (!goal) return { success: false, message: 'Meta não encontrada' };
        return {
          success: true,
          data: {
            id: goal.id, title: goal.title, status: goal.status,
            period: goal.period, progress: goal.progress,
            pilares: goal.pilares?.length || 0,
            kpis: goal.pilares?.reduce((acc, p) => acc + (p.kpis?.length || 0), 0) || 0,
          },
          message: `Meta: ${goal.title || goalId}`,
        };
      },
    },
    {
      name: 'create_goal',
      description: 'Criar uma nova meta',
      params: {
        title: 'string — título da meta (obrigatório)',
        period: 'string — período (ex: 2026-Q1, 2026-S1, 2026) (opcional)',
        description: 'string — descrição (opcional)',
      },
      execute: async (params) => {
        const { createGoal } = await import('./goals.js');
        await createGoal({
          title: params.title,
          period: params.period || '',
          description: params.description || '',
          status: 'draft',
        });
        return { success: true, message: `Meta "${params.title}" criada!` };
      },
    },
    {
      name: 'get_goals_summary',
      description: 'Obter resumo geral das metas (total, por status, progresso médio)',
      params: {},
      execute: async () => {
        const { fetchGoals } = await import('./goals.js');
        const goals = await fetchGoals();
        const byStatus = {};
        let totalProgress = 0;
        goals.forEach(g => {
          byStatus[g.status || 'sem_status'] = (byStatus[g.status || 'sem_status'] || 0) + 1;
          totalProgress += (g.progress || 0);
        });
        return {
          success: true,
          data: {
            total: goals.length,
            byStatus,
            avgProgress: goals.length > 0 ? (totalProgress / goals.length).toFixed(1) + '%' : 'N/A',
          },
          message: `${goals.length} meta(s) cadastrada(s)`,
        };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * CALENDAR — Calendário de Eventos
   * ═══════════════════════════════════════════════════════════ */
  calendar: [
    {
      name: 'list_events',
      description: 'Listar eventos do calendário (captura da tela visível ou store)',
      params: {},
      execute: async () => {
        // Tentar ler do DOM / store
        const events = store.get('calendarEvents') || [];
        if (events.length) {
          const summary = events.slice(0, 30).map(e => ({
            title: e.title || '', start: e.start || '', end: e.end || '', type: e.type || '',
          }));
          return { success: true, data: summary, message: `${events.length} evento(s)` };
        }
        // Fallback: ler do DOM
        const cards = document.querySelectorAll('.fc-event, .calendar-event, [class*="event"]');
        const domEvents = [...cards].slice(0, 20).map(c => ({
          title: c.textContent?.trim()?.substring(0, 60) || '',
        }));
        return { success: true, data: domEvents, message: `${domEvents.length} evento(s) visível(is)` };
      },
    },
    {
      name: 'get_today_agenda',
      description: 'Obter a agenda de hoje (tarefas com vencimento hoje + eventos)',
      params: {},
      execute: async () => {
        const { fetchTasks } = await import('./tasks.js');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const tasks = await fetchTasks({ limitN: 100 });
        const todayTasks = tasks.filter(t => {
          const d = t.dueDate?.toDate?.() || (t.dueDate ? new Date(t.dueDate) : null);
          return d && d >= today && d < tomorrow;
        });

        const summary = todayTasks.map(t => ({
          id: t.id, title: t.title, status: t.status, priority: t.priority,
          dueDate: t.dueDate?.toDate?.()?.toLocaleTimeString?.('pt-BR', { hour: '2-digit', minute: '2-digit' }) || '',
        }));
        return { success: true, data: summary, message: `${todayTasks.length} tarefa(s) para hoje` };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * DASHBOARD — Dashboards Analíticos
   * ═══════════════════════════════════════════════════════════ */
  dashboards: [
    {
      name: 'get_dashboard_summary',
      description: 'Obter resumo dos KPIs visíveis no dashboard atual (captura do DOM)',
      params: {},
      execute: async () => {
        const stats = scrapeVisibleStats();
        return { success: true, data: stats, message: `${stats.length} KPI(s) capturado(s) do dashboard` };
      },
    },
    {
      name: 'get_tasks_overview',
      description: 'Obter visão geral de tarefas para análise no dashboard',
      params: {},
      execute: async () => {
        const { fetchTasks } = await import('./tasks.js');
        const tasks = await fetchTasks({ limitN: 500 });
        const byStatus = {};
        const byPriority = {};
        const bySector = {};
        let overdue = 0;
        const now = new Date();
        tasks.forEach(t => {
          byStatus[t.status] = (byStatus[t.status] || 0) + 1;
          byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
          if (t.sector) bySector[t.sector] = (bySector[t.sector] || 0) + 1;
          const d = t.dueDate?.toDate?.() || (t.dueDate ? new Date(t.dueDate) : null);
          if (d && d < now && t.status !== 'done' && t.status !== 'cancelled') overdue++;
        });
        return {
          success: true,
          data: { total: tasks.length, byStatus, byPriority, bySector, overdue },
          message: `${tasks.length} tarefa(s), ${overdue} atrasada(s)`,
        };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * REQUESTS — Solicitações
   * ═══════════════════════════════════════════════════════════ */
  requests: [
    {
      name: 'list_requests',
      description: 'Listar solicitações do sistema',
      params: { status: 'string — filtrar por status: pending, approved, rejected, converted (opcional)' },
      execute: async (params) => {
        const { fetchRequests } = await import('./requests.js');
        let requests = await fetchRequests();
        if (params?.status) requests = requests.filter(r => r.status === params.status);
        const summary = requests.slice(0, 20).map(r => ({
          id: r.id,
          title: r.title || r.description?.substring(0, 50) || '',
          type: r.type || '',
          status: r.status || '',
          requester: r.requesterName || r.requester || '',
          createdAt: r.createdAt?.toDate?.()?.toLocaleDateString?.('pt-BR') || '',
        }));
        return { success: true, data: summary, message: `${requests.length} solicitação(ões)` };
      },
    },
    {
      name: 'create_request',
      description: 'Criar uma nova solicitação',
      params: {
        title: 'string — título da solicitação (obrigatório)',
        type: 'string — tipo da solicitação (opcional)',
        description: 'string — descrição detalhada (opcional)',
        priority: 'string — urgent, high, medium, low (default: medium)',
      },
      execute: async (params) => {
        const { createRequest } = await import('./requests.js');
        await createRequest({
          title: params.title,
          type: params.type || '',
          description: params.description || '',
          priority: params.priority || 'medium',
          status: 'pending',
        });
        return { success: true, message: `Solicitação "${params.title}" criada!` };
      },
    },
    {
      name: 'approve_request',
      description: 'Aprovar uma solicitação pendente',
      params: {
        requestId: 'string — ID da solicitação (obrigatório)',
        notes: 'string — observações da aprovação (opcional)',
      },
      execute: async ({ requestId, notes }) => {
        const { updateRequestStatus } = await import('./requests.js');
        await updateRequestStatus(requestId, 'approved', notes || '');
        return { success: true, message: 'Solicitação aprovada!' };
      },
    },
    {
      name: 'reject_request',
      description: 'Rejeitar uma solicitação pendente',
      params: {
        requestId: 'string — ID da solicitação (obrigatório)',
        reason: 'string — motivo da rejeição (obrigatório)',
      },
      execute: async ({ requestId, reason }) => {
        const { updateRequestStatus } = await import('./requests.js');
        await updateRequestStatus(requestId, 'rejected', reason || '');
        return { success: true, message: 'Solicitação rejeitada.' };
      },
    },
    {
      name: 'convert_request_to_task',
      description: 'Converter uma solicitação aprovada em tarefa',
      params: { requestId: 'string — ID da solicitação (obrigatório)' },
      execute: async ({ requestId }) => {
        const { convertToTask } = await import('./requests.js');
        const taskId = await convertToTask(requestId);
        return { success: true, message: 'Solicitação convertida em tarefa!', taskId };
      },
    },
    {
      name: 'get_requests_summary',
      description: 'Obter resumo de solicitações (total, por status)',
      params: {},
      execute: async () => {
        const { fetchRequests } = await import('./requests.js');
        const requests = await fetchRequests();
        const byStatus = {};
        requests.forEach(r => {
          byStatus[r.status || 'sem_status'] = (byStatus[r.status || 'sem_status'] || 0) + 1;
        });
        return {
          success: true,
          data: { total: requests.length, byStatus },
          message: `${requests.length} solicitação(ões) no total`,
        };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * CSAT — Pesquisas de Satisfação
   * ═══════════════════════════════════════════════════════════ */
  csat: [
    {
      name: 'list_surveys',
      description: 'Listar pesquisas CSAT enviadas',
      params: { status: 'string — filtrar por status: pending, answered, expired, cancelled (opcional)' },
      execute: async (params) => {
        const { fetchSurveys } = await import('./csat.js');
        let surveys = await fetchSurveys();
        if (params?.status) surveys = surveys.filter(s => s.status === params.status);
        const summary = surveys.slice(0, 20).map(s => ({
          id: s.id,
          customer: s.customerName || s.customerEmail || '',
          status: s.status || '',
          score: s.score ?? '',
          sentAt: s.sentAt?.toDate?.()?.toLocaleDateString?.('pt-BR') || '',
        }));
        return { success: true, data: summary, message: `${surveys.length} pesquisa(s)` };
      },
    },
    {
      name: 'get_csat_metrics',
      description: 'Calcular métricas CSAT (score médio, NPS, taxa de resposta)',
      params: {},
      execute: async () => {
        const { fetchSurveys, calcCsatMetrics } = await import('./csat.js');
        const surveys = await fetchSurveys();
        const metrics = calcCsatMetrics(surveys);
        return {
          success: true,
          data: metrics,
          message: `CSAT: ${metrics.avgScore?.toFixed?.(1) || 'N/A'} | Respondidas: ${metrics.answered || 0}/${metrics.total || 0}`,
        };
      },
    },
    {
      name: 'get_csat_dom_summary',
      description: 'Obter resumo de CSAT/NPS visível na tela atual',
      params: {},
      execute: async () => {
        const stats = scrapeVisibleStats();
        return { success: true, data: stats, message: `${stats.length} métrica(s) CSAT visível(is)` };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * NEWS-MONITOR — Notícias do setor + Clipping da empresa
   * ═══════════════════════════════════════════════════════════ */
  'news-monitor': [
    {
      name: 'list_news',
      description: 'Listar notícias cadastradas no sistema',
      params: {
        category: 'string — filtrar: Hotelaria, Cruzeiros, Destinos, Companhias Aéreas, Mercado, Sistemas, Agências e Operadoras (opcional)',
        subcategory: 'string — filtrar: Notícias, Curiosidades, Dicas, Tendências, Insights, Eventos, Tecnologia, Sustentabilidade, Educação (opcional)',
        search: 'string — busca por texto livre (opcional)',
      },
      execute: async (params) => {
        const { fetchNews } = await import('./newsMonitor.js');
        const items = await fetchNews(params || {});
        const summary = items.slice(0, 20).map(n => ({
          id: n.id,
          title: n.title || '',
          category: n.category || '',
          subcategory: n.subcategory || '',
          source: n.sourceName || n.sourceUrl || '',
          publishedAt: n.publishedAt?.toDate?.()?.toLocaleDateString?.('pt-BR') || '',
        }));
        return { success: true, data: summary, message: `${items.length} notícia(s) encontrada(s)` };
      },
    },
    {
      name: 'create_news',
      description: 'Cadastrar uma nova notícia no monitor. Use para salvar notícias encontradas na web.',
      params: {
        title: 'string — título da notícia (obrigatório)',
        description: 'string — resumo/descrição da notícia',
        sourceUrl: 'string — URL da fonte original',
        sourceName: 'string — nome do veículo/site (ex: Panrotas, Travel3)',
        category: 'string — Hotelaria, Cruzeiros, Destinos, Companhias Aéreas, Mercado, Sistemas, Agências e Operadoras',
        subcategory: 'string — Notícias, Curiosidades, Dicas, Tendências, Insights, Eventos, Tecnologia, Sustentabilidade, Educação',
        publishedAt: 'string — data de publicação YYYY-MM-DD (default: hoje)',
        expiresAt: 'string — data de expiração YYYY-MM-DD (opcional)',
        thumbnail: 'string — URL da imagem/thumbnail (opcional)',
      },
      execute: async (params) => {
        if (!params.title) return { success: false, message: 'Título é obrigatório.' };
        const { saveNewsItem, fetchUrlMetadata } = await import('./newsMonitor.js');
        // Tentar buscar metadados da URL se não informou thumbnail/sourceName
        let meta = {};
        if (params.sourceUrl && (!params.thumbnail || !params.sourceName)) {
          try { meta = await fetchUrlMetadata(params.sourceUrl); } catch {}
        }
        const pubDate = params.publishedAt
          ? new Date(params.publishedAt + 'T12:00:00')
          : new Date();
        const data = {
          title: params.title,
          description: params.description || '',
          sourceUrl: params.sourceUrl || '',
          sourceName: params.sourceName || meta.siteName || '',
          category: params.category || 'Mercado',
          subcategory: params.subcategory || 'Notícias',
          publishedAt: pubDate,
          thumbnail: params.thumbnail || meta.thumbnail || '',
        };
        if (params.expiresAt) data.expiresAt = params.expiresAt;
        const id = await saveNewsItem(null, data);
        showToast('success', `Notícia "${params.title}" cadastrada!`);
        return { success: true, message: `Notícia "${params.title}" cadastrada!`, data: { newsId: id, title: params.title } };
      },
    },
    {
      name: 'update_news',
      description: 'Atualizar uma notícia existente',
      params: {
        newsId: 'string — ID da notícia (obrigatório)',
        title: 'string — novo título (opcional)',
        description: 'string — nova descrição (opcional)',
        category: 'string — nova categoria (opcional)',
        subcategory: 'string — nova subcategoria (opcional)',
      },
      execute: async (params) => {
        if (!params.newsId) return { success: false, message: 'newsId é obrigatório' };
        const { saveNewsItem } = await import('./newsMonitor.js');
        const { newsId, ...data } = params;
        Object.keys(data).forEach(k => { if (!data[k]) delete data[k]; });
        await saveNewsItem(newsId, data);
        showToast('success', 'Notícia atualizada!');
        return { success: true, message: 'Notícia atualizada!' };
      },
    },
    {
      name: 'list_clippings',
      description: 'Listar clippings (citações da PRIMETOUR na mídia)',
      params: {
        sentiment: 'string — filtrar: positive, neutral, negative (opcional)',
      },
      execute: async (params) => {
        const { fetchClippings } = await import('./newsMonitor.js');
        let items = await fetchClippings();
        if (params?.sentiment) items = items.filter(c => c.sentiment === params.sentiment);
        const summary = items.slice(0, 20).map(c => ({
          id: c.id,
          title: c.title || '',
          mediaType: c.mediaType || '',
          contentType: c.contentType || '',
          sentiment: c.sentiment || '',
          sourceName: c.sourceName || '',
          publishedAt: c.publishedAt?.toDate?.()?.toLocaleDateString?.('pt-BR') || '',
        }));
        return { success: true, data: summary, message: `${items.length} clipping(s)` };
      },
    },
    {
      name: 'create_clipping',
      description: 'Cadastrar um novo clipping (citação/menção da PRIMETOUR na mídia). Use para registrar menções encontradas na internet.',
      params: {
        title: 'string — título da matéria/menção (obrigatório)',
        description: 'string — resumo do conteúdo/contexto da citação',
        sourceUrl: 'string — URL da matéria/publicação',
        sourceName: 'string — nome do veículo (ex: Folha de S.Paulo, Panrotas)',
        mediaType: 'string — Digital, Impresso ou Televisivo (default: Digital)',
        contentType: 'string — Negócios, Análises, Tendências, Novidades, Publieditorial, Eventos',
        sentiment: 'string — positive, neutral ou negative',
        publishedAt: 'string — data de publicação YYYY-MM-DD (default: hoje)',
        excerpt: 'string — trecho relevante da citação (opcional)',
      },
      execute: async (params) => {
        if (!params.title) return { success: false, message: 'Título é obrigatório.' };
        const { saveClipping, fetchUrlMetadata } = await import('./newsMonitor.js');
        let meta = {};
        if (params.sourceUrl && !params.sourceName) {
          try { meta = await fetchUrlMetadata(params.sourceUrl); } catch {}
        }
        const pubDate = params.publishedAt
          ? new Date(params.publishedAt + 'T12:00:00')
          : new Date();
        const data = {
          title: params.title,
          description: params.description || '',
          sourceUrl: params.sourceUrl || '',
          sourceName: params.sourceName || meta.siteName || '',
          mediaType: params.mediaType || 'Digital',
          contentType: params.contentType || 'Novidades',
          sentiment: params.sentiment || 'neutral',
          publishedAt: pubDate,
          excerpt: params.excerpt || '',
          thumbnail: meta.thumbnail || '',
        };
        const id = await saveClipping(null, data);
        showToast('success', `Clipping "${params.title}" cadastrado!`);
        return { success: true, message: `Clipping "${params.title}" cadastrado!`, data: { clippingId: id, title: params.title } };
      },
    },
    {
      name: 'search_web_news',
      description: 'Buscar notícias recentes na web sobre um tema do turismo. Retorna resultados para você avaliar e cadastrar via create_news.',
      params: {
        query: 'string — termo de busca (ex: "novos voos para Miami", "tendências hotelaria 2026")',
        sites: 'string — limitar a sites específicos separados por vírgula (ex: "panrotas.com.br,mercadoeventos.com.br") (opcional)',
      },
      execute: async (params) => {
        if (!params.query) return { success: false, message: 'query é obrigatória' };
        // Usa a API do microlink para buscar metadados de URLs encontradas
        // A busca real será feita pelo LLM via web search no prompt
        return {
          success: true,
          message: 'Para buscar notícias na web, use seu conhecimento atualizado e/ou web search. Quando encontrar notícias relevantes, use create_news para cadastrar cada uma no sistema.',
          data: {
            instruction: 'Use web search para buscar sobre: ' + params.query + (params.sites ? '. Sites preferidos: ' + params.sites : ''),
            tip: 'Após encontrar, cadastre cada notícia com create_news incluindo título, resumo, URL, fonte e categoria.',
          },
        };
      },
    },
    {
      name: 'search_web_clipping',
      description: 'Buscar menções/citações recentes da PRIMETOUR na internet. Retorna instrução para buscar e cadastrar via create_clipping.',
      params: {
        additionalTerms: 'string — termos extras além de "PRIMETOUR" (ex: "Prime Tour Viagens") (opcional)',
      },
      execute: async (params) => {
        const terms = ['PRIMETOUR', 'Prime Tour Viagens', 'primetour.com.br'];
        if (params?.additionalTerms) terms.push(params.additionalTerms);
        return {
          success: true,
          message: 'Para buscar clippings, use web search com os termos abaixo. Cadastre cada menção encontrada com create_clipping.',
          data: {
            searchTerms: terms,
            tip: 'Busque cada termo na web. Para cada citação da PRIMETOUR encontrada, use create_clipping com título, resumo, URL, veículo, sentimento (positive/neutral/negative) e trecho relevante.',
          },
        };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * GENERAL — Módulos administrativos (users, settings, etc.)
   * ═══════════════════════════════════════════════════════════ */
  general: [
    {
      name: 'get_system_overview',
      description: 'Obter visão geral do sistema (KPIs visíveis na tela)',
      params: {},
      execute: async () => {
        const stats = scrapeVisibleStats();
        return { success: true, data: stats, message: `${stats.length} dado(s) capturado(s) da tela` };
      },
    },
    {
      name: 'list_notifications',
      description: 'Listar notificações do usuário',
      params: { onlyUnread: 'boolean — true para mostrar apenas não lidas (default: false)' },
      execute: async () => {
        const notifications = store.get('notifications') || [];
        const unreadCount = store.get('unreadCount') || 0;
        const summary = notifications.slice(0, 15).map(n => ({
          id: n.id, title: n.title || '', message: n.message || n.body || '',
          read: n.read || false, type: n.type || '',
          createdAt: n.createdAt?.toDate?.()?.toLocaleDateString?.('pt-BR') || '',
        }));
        return { success: true, data: summary, message: `${notifications.length} notificação(ões), ${unreadCount} não lida(s)` };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * CONTENT — Gestão de Conteúdo (NL, Meta, GA Performance)
   * ═══════════════════════════════════════════════════════════ */
  content: [
    {
      name: 'get_content_metrics',
      description: 'Capturar métricas de performance de conteúdo visíveis na tela',
      params: {},
      execute: async () => {
        const stats = scrapeVisibleStats();
        return { success: true, data: stats, message: `${stats.length} métrica(s) de conteúdo` };
      },
    },
  ],
};

/* ─── Obter ações disponíveis para um módulo ─────────────── */
export function getActionsForModule(moduleId) {
  const moduleActions = MODULE_ACTIONS[moduleId] || [];
  return [...GLOBAL_ACTIONS, ...moduleActions];
}

/* ─── Formatar ações para o system prompt ────────────────── */
export function formatActionsForPrompt(moduleId) {
  const actions = getActionsForModule(moduleId);
  if (!actions.length) return '';

  const lines = actions.map(a => {
    const paramEntries = Object.entries(a.params || {});
    const paramDesc = paramEntries
      .map(([k, v]) => `    - ${k}: ${v}`)
      .join('\n');
    return `• ${a.name}: ${a.description}${paramDesc ? '\n  Parâmetros:\n' + paramDesc : ''}`;
  });

  return `
=== AÇÕES DISPONÍVEIS ===
Formato para executar ações:
<<<ACTION>>>
{"action": "nome_da_acao", "params": {"param1": "valor1"}}
<<<END_ACTION>>>

REGRAS OBRIGATÓRIAS:
1. SEMPRE execute a ação. NUNCA diga "eu faria" ou "se eu pudesse" — inclua o bloco <<<ACTION>>> e o sistema executa.
2. Seja CONCISO: 1-2 frases + bloco de ação. Não repita o pedido do usuário.
3. Múltiplas ações na mesma resposta: use vários blocos <<<ACTION>>>. Ex: list_tasks para buscar ID + update_task para modificar.
4. Os blocos <<<ACTION>>> são INVISÍVEIS ao usuário — processados pelo sistema automaticamente.
5. NUNCA INVENTE IDs. IDs do Firestore são hashes como "aB3xK9qW2mNp". Se no histórico houver >>> ID_CRIADO="xxx" <<<, use "xxx" como taskId. Se NÃO encontrar o ID real no histórico, faça list_tasks PRIMEIRO para buscar.
6. Para conteúdos longos (descrições, textos), coloque DENTRO do params da ação (ex: description no update_task), não no texto da resposta.

Ações disponíveis:
${lines.join('\n')}
=== FIM DAS AÇÕES ===`;
}

/* ─── Parser: extrair ações da resposta da IA ────────────── */
export function parseActions(text) {
  const actions = [];
  const regex = /<<<ACTION>>>\s*(\{[\s\S]*?\})\s*<<<END_ACTION>>>/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.action) actions.push(parsed);
    } catch (e) { /* JSON inválido, ignorar */ }
  }
  return actions;
}

/* ─── Remover blocos de ação do texto exibido ────────────── */
export function cleanActionBlocks(text) {
  return text.replace(/<<<ACTION>>>[\s\S]*?<<<END_ACTION>>>/g, '').trim();
}

/* ─── Executar uma ação ──────────────────────────────────── */
export async function executeAction(moduleId, actionName, params = {}) {
  const actions = getActionsForModule(moduleId);
  const action = actions.find(a => a.name === actionName);

  if (!action) {
    return { success: false, message: `Ação "${actionName}" não encontrada` };
  }

  try {
    const result = await action.execute(params);
    // Toast de feedback (apenas para ações de escrita, não para leitura/consulta)
    const READ_ACTIONS = [
      'list_tasks','list_projects','list_roteiros','list_feedbacks','list_goals','list_events',
      'list_requests','list_destinations','list_tips','list_areas','list_images','list_surveys',
      'list_recent_clients','list_notifications',
      'get_task_summary','get_board_summary','get_project_tasks','get_dashboard_summary',
      'get_csat_summary','get_csat_dom_summary','get_csat_metrics','get_current_user',
      'get_roteiro','get_roteiro_stats','get_tip_detail','get_feedback','get_feedback_summary',
      'get_goal','get_goals_summary','get_today_agenda','get_tasks_overview',
      'get_system_overview','get_content_metrics','get_requests_summary',
    ];
    if (result.message && !READ_ACTIONS.includes(actionName)) {
      showToast(result.success ? 'success' : 'error', result.message);
    }
    return result;
  } catch (e) {
    const msg = `Erro ao executar "${actionName}": ${e.message}`;
    showToast('error', msg);
    return { success: false, message: msg };
  }
}
