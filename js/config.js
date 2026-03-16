/**
 * PRIMETOUR — Firebase Configuration
 * ============================================================
 * INSTRUÇÕES DE CONFIGURAÇÃO:
 *
 * 1. Acesse https://console.firebase.google.com
 * 2. Crie um projeto (ex: "primetour-tasks")
 * 3. Ative Authentication > Email/Password
 * 4. Ative Firestore Database (modo produção)
 * 5. Vá em Configurações do Projeto > Seus apps > Web
 * 6. Copie as credenciais e substitua os valores abaixo
 * 7. Configure as Regras do Firestore (ver README.md)
 * ============================================================
 */

export const firebaseConfig = {
  apiKey:            "SEU_API_KEY_AQUI",
  authDomain:        "SEU_PROJETO.firebaseapp.com",
  projectId:         "SEU_PROJETO_ID",
  storageBucket:     "SEU_PROJETO.appspot.com",
  messagingSenderId: "SEU_SENDER_ID",
  appId:             "SEU_APP_ID"
};

/**
 * Regras do Firestore (cole no Console do Firebase):
 *
 * rules_version = '2';
 * service cloud.firestore {
 *   match /databases/{database}/documents {
 *
 *     // Função helper: verifica se o usuário está autenticado
 *     function isAuth() {
 *       return request.auth != null;
 *     }
 *
 *     // Função helper: verifica role do usuário
 *     function hasRole(role) {
 *       return isAuth() && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == role;
 *     }
 *
 *     function isAdmin() { return hasRole('admin'); }
 *     function isManager() { return hasRole('manager') || isAdmin(); }
 *
 *     // Usuários: admin vê todos, usuário vê próprio perfil
 *     match /users/{userId} {
 *       allow read: if isAuth();
 *       allow write: if isAdmin() || request.auth.uid == userId;
 *       allow create: if isAdmin();
 *       allow delete: if isAdmin();
 *     }
 *
 *     // Logs de auditoria: somente leitura para admins
 *     match /audit_logs/{logId} {
 *       allow read: if isAdmin();
 *       allow create: if isAuth();
 *       allow update, delete: if false;
 *     }
 *
 *     // Projetos e tarefas serão adicionados nas próximas etapas
 *     match /projects/{projectId} {
 *       allow read: if isAuth();
 *       allow write: if isManager();
 *     }
 *
 *     match /tasks/{taskId} {
 *       allow read: if isAuth();
 *       allow create: if isManager();
 *       allow update: if isAuth();
 *       allow delete: if isManager();
 *     }
 *   }
 * }
 */

export const APP_CONFIG = {
  name:    'Gestor de Tarefas',
  brand:   'PRIMETOUR',
  version: '1.0.0',
  
  // Configurações de usuário
  roles: {
    master:      { label: 'Diretoria',   badge: 'badge-admin',   color: '#EF4444' },
    admin:       { label: 'Head',        badge: 'badge-admin',   color: '#A78BFA' },
    manager:     { label: 'Gerente',     badge: 'badge-manager', color: '#38BDF8' },
    coordinator: { label: 'Coordenador', badge: 'badge-manager', color: '#F97316' },
    member:      { label: 'Analista',    badge: 'badge-member',  color: '#22C55E' },
  },

  // Cores de avatar (geradas ciclicamente)
  avatarColors: [
    '#E8703A', '#3B82F6', '#8B5CF6', '#EC4899',
    '#14B8A6', '#F59E0B', '#EF4444', '#10B981',
    '#6366F1', '#F97316', '#84CC16', '#06B6D4'
  ],

  // Paginação padrão
  itemsPerPage: 15,

  // EmailJS — CSAT (Etapa 4)
  // ─────────────────────────────────────────────────────────
  // 1. Crie conta gratuita em https://www.emailjs.com
  // 2. Conecte um serviço de e-mail (Gmail, Outlook, etc.)
  // 3. Crie 2 templates (veja README para os campos esperados)
  // 4. Substitua os valores abaixo com suas credenciais
  emailjs: {
    publicKey:           'SUA_EMAILJS_PUBLIC_KEY',     // Account > API Keys
    serviceId:           'SEU_EMAILJS_SERVICE_ID',     // Email Services > Service ID
    templateCsat:        'SEU_TEMPLATE_CSAT_ID',       // Template de envio ao cliente
    templateInternal:    'SEU_TEMPLATE_INTERNO_ID',    // Template de notificação interna (opcional)
  },

  // CSAT — configurações gerais
  csat: {
    // Quantas horas após concluir a tarefa enviar o e-mail
    delayHours:         1,
    // Escala de avaliação (1–5)
    scaleMin:           1,
    scaleMax:           5,
    // Cor do botão no e-mail (hex sem #)
    brandColor:         'D4A843',
    // URL base da aplicação (para links de resposta)
    baseUrl:            typeof window !== 'undefined' ? window.location.origin : '',
    // Remetente padrão (sobrescrito por emailjs)
    fromName:           'PRIMETOUR',
    fromEmail:          'noreply@primetour.com',
  },

  // GitHub Actions — redefinição de senha pelo admin
  // ─────────────────────────────────────────────────────────
  // 1. Acesse github.com → Settings → Developer settings
  //    → Personal access tokens → Tokens (classic) → Generate new token
  // 2. Marque APENAS a permissão: repo (ou somente "repo:public_repo" para repo público)
  // 3. Cole o token abaixo
  github: {
    token: 'SEU_GITHUB_PAT_AQUI',   // ghp_xxxxxxxxxxxxxxxxxxxx
    repo:  'primetour/tarefas',
  },
};

// Expõe o token para o modal de reset de senha
if (typeof window !== 'undefined') {
  window.PRIMETOUR_GH_TOKEN = APP_CONFIG.github?.token || '';
}
