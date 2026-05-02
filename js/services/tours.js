/**
 * PRIMETOUR — Tours Service
 *
 * Definição declarativa dos tours guiados + persistência de quem
 * já completou (em userProfile.toursCompleted, multi-device).
 *
 * Como adicionar novo tour:
 *   - Inclua entry em TOURS abaixo (com id, title, eligibility, steps)
 *   - O auto-trigger por módulo lê TOURS.find(t => t.module === 'xxx')
 */
import { store }   from '../store.js';
import { startTour } from '../components/tour.js';

/* ─── Catálogo de tours ──────────────────────────────────── */
export const TOURS = [
  {
    id: 'welcome',
    title: 'Bem-vindo ao PRIMETOUR',
    icon: '🎉',
    duration: '2 min',
    description: 'Conheça as áreas principais do sistema.',
    auto: true,         // dispara automaticamente no firstLogin
    module: null,       // não é por módulo
    eligibility: () => true,
    welcomeBody: 'Em 2 minutos te mostro o essencial: menu, painel, tarefas, check-in e mais. Pode pular a qualquer momento.',
    steps: [
      {
        selector: '.sidebar', position: 'right',
        title: 'Menu lateral',
        body: 'Aqui ficam todos os módulos do sistema, agrupados por área. Os ícones mostram pra que serve cada um. <strong>Passe o mouse</strong> nos itens pra ver tudo.',
      },
      {
        selector: '[data-route="dashboard"]', position: 'right',
        title: 'Meu Painel',
        body: 'Sua visão personalizada: tarefas atribuídas, parcerias, próxima ausência da equipe e tudo que precisa de atenção hoje.',
      },
      {
        selector: '[data-route="tasks"]', position: 'right',
        title: 'Tarefas',
        body: 'O coração do sistema. Crie, atribua, acompanhe — em modo lista, kanban ou calendário. Tem observadores, parcerias entre setores e SLA automático.',
      },
      {
        selector: '[data-route="check-in"]', position: 'right',
        title: 'Check-in',
        body: 'Reserva de mesa, registro de ponto eletrônico (com banco de horas), espelho de ponto e correções via aprovação do gestor.',
      },
      {
        selector: '[data-route="team"]', position: 'right',
        title: 'Equipe',
        body: 'Disponibilidade da equipe, ausências e <strong>férias</strong> (período aquisitivo CLT, fracionamento, abono pecuniário).',
      },
      {
        selector: '.header, header', position: 'bottom',
        title: 'Header',
        body: 'No topo: notificações, IA assistente, atalhos rápidos e seu avatar (perfil, paleta de cores, sair).',
      },
      {
        selector: '[data-route="about"], [data-route="help"]', position: 'right',
        title: 'Ajuda sempre disponível',
        body: 'Você pode <strong>refazer este tour ou outros tours</strong> a qualquer momento aqui em "Ajuda". Bom trabalho! 👋',
        skipIfMissing: true,
      },
    ],
  },

  {
    id: 'tasks',
    title: 'Tour rápido — Tarefas',
    icon: '✓',
    duration: '1 min',
    description: 'Como criar e acompanhar tarefas.',
    auto: true,
    module: 'tasks',
    eligibility: () => store.can('task_create'),
    welcomeBody: 'Em 1 minuto, te mostro como criar uma tarefa e acompanhar o trabalho.',
    steps: [
      {
        selector: 'button:has-text("Nova"), [class*="new-task"], button[onclick*="task"], .page-header-actions .btn-primary',
        position: 'left',
        title: 'Criar tarefa',
        body: 'Botão "+ Nova tarefa" abre o modal completo (título, setor, núcleo, responsável, SLA, observadores).',
      },
      {
        selector: '.tabs, [class*="view-toggle"], .task-views',
        position: 'bottom',
        title: 'Modos de visualização',
        body: 'Alterne entre <strong>lista</strong>, <strong>kanban</strong> e <strong>calendário</strong>. Cada um tem filtros próprios.',
        skipIfMissing: true,
      },
      {
        selector: '.filter-bar, .filters, [class*="filter"]',
        position: 'bottom',
        title: 'Filtros',
        body: 'Filtre por status, responsável, setor, prioridade, data de entrega ou tags. Os filtros persistem entre sessões.',
        skipIfMissing: true,
      },
    ],
  },

  {
    id: 'checkin',
    title: 'Tour — Check-in e Ponto',
    icon: '⏱',
    duration: '2 min',
    description: 'Reservar mesa, bater ponto e banco de horas.',
    auto: true,
    module: 'check-in',
    eligibility: () => true,
    welcomeBody: 'Aqui você reserva uma estação, bate ponto e acompanha seu banco de horas. Te mostro em 2 minutos.',
    steps: [
      {
        selector: '.checkin-tab-btn[data-tab="map"]', position: 'bottom',
        title: 'Mapa de estações',
        body: 'Veja todas as estações disponíveis hoje (e nas próximas 2 semanas). Clique numa cadeira pra reservar.',
      },
      {
        selector: '.checkin-tab-btn[data-tab="checkin"]', position: 'bottom',
        title: 'Check-in com teste de velocidade',
        body: 'Ao chegar, faça check-in: confirma os equipamentos da estação e roda um <strong>teste de velocidade obrigatório</strong> (Cloudflare).',
      },
      {
        selector: '.checkin-tab-btn[data-tab="clock"]', position: 'bottom',
        title: 'Ponto eletrônico',
        body: 'Bate entrada, almoço (saída/volta) e saída. Aparece um <strong>banner real-time no topo</strong> mostrando horas trabalhadas. Tem banco de horas e jornada padrão de 8h.',
      },
      {
        selector: '#ck-req-correction-new', position: 'left',
        title: 'Esqueceu de bater ponto?',
        body: 'Use "Solicitar correção" pra pedir ao gestor que ajuste. Você vê o status (pendente/aprovado/rejeitado) na mesma aba.',
        skipIfMissing: true,
      },
      {
        selector: '.checkin-tab-btn[data-tab="approvals"]', position: 'bottom',
        title: 'Aprovações (gestor)',
        body: 'Se você é coordenador/gerente/admin, recebe correções pra aprovar aqui. Real-time.',
        skipIfMissing: true,
      },
    ],
  },

  {
    id: 'team',
    title: 'Tour — Equipe e Férias',
    icon: '👥',
    duration: '1 min',
    description: 'Ausências e férias estilo Benner.',
    auto: true,
    module: 'team',
    eligibility: () => true,
    welcomeBody: 'Te mostro como registrar ausências e gerenciar suas férias no estilo Benner RH (período aquisitivo, fracionamento, abono).',
    steps: [
      {
        selector: '.team-tab-btn[data-tab="capacity"]', position: 'bottom',
        title: 'Disponibilidade',
        body: 'Calendário visual da equipe. Você vê quem está ausente, em férias, em treinamento etc. Cores por tipo.',
      },
      {
        selector: '.team-tab-btn[data-tab="mine"]', position: 'bottom',
        title: 'Suas ausências',
        body: 'Histórico do que você registrou (próximas + passadas). Pode editar/excluir as suas a qualquer momento.',
      },
      {
        selector: '.team-tab-btn[data-tab="vacations"]', position: 'bottom',
        title: 'Férias',
        body: 'Saldo CLT calculado a partir da sua admissão: períodos aquisitivos (12m), deadline concessivo (+12m), até 3 fracionamentos (1 ≥14 dias) e abono pecuniário (até 10d).',
      },
      {
        selector: '#new-absence-btn', position: 'left',
        title: 'Registrar ausência',
        body: 'Use pra férias rápidas, licenças, home office, treinamento. Suporta ausência parcial (com horários).',
        skipIfMissing: true,
      },
    ],
  },

  {
    id: 'requests',
    title: 'Tour — Portal de Solicitações',
    icon: '🌐',
    duration: '1 min',
    description: 'Link público sem login para receber demandas.',
    auto: true,
    module: 'requests',
    eligibility: () => store.can('portal_manage') || store.isMaster() || store.can('system_manage_users'),
    welcomeBody: 'O Portal de Solicitações é um link público que sua área compartilha pra receber demandas externas (sem login). Vou te mostrar como funciona.',
    steps: [
      {
        selector: '.page-header', position: 'bottom',
        title: 'Solicitações que entram',
        body: 'Tudo que chega via Portal aparece aqui. Cada uma vira uma tarefa quando aceita. Filtros por status, área, urgência.',
      },
      {
        selector: 'a[href*="solicitar"], button[onclick*="portal"]', position: 'left',
        title: 'Link público',
        body: 'Compartilhe <code>seu-dominio/solicitar.html</code> com clientes/parceiros. Eles preenchem; você aprova ou recusa.',
        skipIfMissing: true,
      },
    ],
  },
];

/* ─── Persistência ───────────────────────────────────────── */
function getDoneSet() {
  // Lê de userProfile.toursCompleted (Firestore via store) + localStorage
  // como fallback pra usuários novos antes do save propagar
  const profile = store.get('userProfile') || {};
  const fromDb  = Array.isArray(profile.toursCompleted) ? profile.toursCompleted : [];
  let fromLocal = [];
  try {
    fromLocal = JSON.parse(localStorage.getItem('primetour-tours-done') || '[]');
  } catch {}
  return new Set([...fromDb, ...fromLocal]);
}

export function hasDoneTour(id) {
  return getDoneSet().has(id);
}

export async function markTourDone(id) {
  const set = getDoneSet();
  set.add(id);
  const arr = [...set];
  // Local primeiro (instantâneo)
  try { localStorage.setItem('primetour-tours-done', JSON.stringify(arr)); } catch {}
  // Persiste no perfil (multi-device)
  const cu = store.get('currentUser');
  if (!cu?.uid) return;
  try {
    const { updateUserProfile } = await import('../auth/auth.js');
    await updateUserProfile(cu.uid, { toursCompleted: arr });
  } catch (e) {
    console.warn('[tours] persist err:', e?.message);
  }
}

export async function resetTour(id) {
  const set = getDoneSet();
  set.delete(id);
  const arr = [...set];
  try { localStorage.setItem('primetour-tours-done', JSON.stringify(arr)); } catch {}
  const cu = store.get('currentUser');
  if (!cu?.uid) return;
  try {
    const { updateUserProfile } = await import('../auth/auth.js');
    await updateUserProfile(cu.uid, { toursCompleted: arr });
  } catch {}
}

export async function resetAllTours() {
  try { localStorage.removeItem('primetour-tours-done'); } catch {}
  const cu = store.get('currentUser');
  if (!cu?.uid) return;
  try {
    const { updateUserProfile } = await import('../auth/auth.js');
    await updateUserProfile(cu.uid, { toursCompleted: [] });
  } catch {}
}

/* ─── Triggers ───────────────────────────────────────────── */
export function maybeStartWelcomeTour() {
  const profile = store.get('userProfile');
  if (!profile) return;
  // Dispara só na 1ª sessão (ou se nunca completou e firstLogin true)
  if (hasDoneTour('welcome')) return;
  const tour = TOURS.find(t => t.id === 'welcome');
  if (!tour) return;
  // Pequeno delay pra garantir que sidebar e header já renderizaram
  setTimeout(() => runTour('welcome'), 1500);
}

export function maybeStartModuleTour(module) {
  if (!module) return;
  const tour = TOURS.find(t => t.module === module && t.auto);
  if (!tour) return;
  if (hasDoneTour(tour.id)) return;
  if (tour.eligibility && !tour.eligibility()) return;
  // Aguarda a página renderizar
  setTimeout(() => runTour(tour.id), 1200);
}

export function runTour(id) {
  const tour = TOURS.find(t => t.id === id);
  if (!tour) return;
  if (tour.eligibility && !tour.eligibility()) return;
  startTour({
    id: tour.id,
    title: tour.title,
    welcomeBody: tour.welcomeBody,
    steps: tour.steps,
    onComplete: () => markTourDone(tour.id),
    onSkip:     () => markTourDone(tour.id),  // skip também marca, evita re-trigger automático
  });
}
