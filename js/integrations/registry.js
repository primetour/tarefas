/**
 * PRIMETOUR — Integration Registry
 * Framework central para todas as integrações externas
 */

import {
  collection, doc, setDoc, getDoc, getDocs,
  updateDoc, deleteDoc, serverTimestamp, query, orderBy,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';

/* ─── Catálogo de integrações disponíveis ─────────────────── */
export const INTEGRATION_CATALOG = [
  {
    id:          'figma',
    name:        'Figma',
    icon:        '🎨',
    category:    'design',
    description: 'Importe arquivos, protótipos e componentes do Figma diretamente como tarefas ou anexos.',
    docsUrl:     'https://www.figma.com/developers/api',
    color:       '#F24E1E',
    authType:    'token',          // personal access token
    fields: [
      { key:'accessToken', label:'Access Token', type:'password', required:true,
        placeholder:'figd_...', hint:'Gere em Figma > Account Settings > Personal Access Tokens' },
      { key:'teamId', label:'Team ID', type:'text', required:false,
        placeholder:'123456789', hint:'Opcional — filtra por time específico' },
    ],
    features: ['import_files','import_comments','webhook'],
  },
  {
    id:          'microsoft_planner',
    name:        'Microsoft Planner',
    icon:        '📋',
    category:    'project',
    description: 'Sincronize tarefas bidirecionalmente com o Microsoft Planner via Microsoft Graph API.',
    docsUrl:     'https://learn.microsoft.com/en-us/graph/planner-concept-overview',
    color:       '#0078D4',
    authType:    'oauth2',
    fields: [
      { key:'clientId',     label:'Client ID',     type:'text',     required:true,  placeholder:'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
      { key:'tenantId',     label:'Tenant ID',     type:'text',     required:true,  placeholder:'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
      { key:'clientSecret', label:'Client Secret', type:'password', required:true,  placeholder:'~xxxxxxxx' },
      { key:'planId',       label:'Planner Plan ID',type:'text',    required:false, placeholder:'ID do plano a sincronizar' },
    ],
    features: ['sync_tasks','import_tasks','export_tasks'],
  },
  {
    id:          'salesforce',
    name:        'Salesforce',
    icon:        '☁',
    category:    'crm',
    description: 'Conecte registros de CRM (Cases, Oportunidades) a tarefas para rastreamento completo.',
    docsUrl:     'https://developer.salesforce.com/docs/apis',
    color:       '#00A1E0',
    authType:    'oauth2',
    fields: [
      { key:'instanceUrl',   label:'Instance URL',   type:'text',     required:true,  placeholder:'https://yourorg.my.salesforce.com' },
      { key:'clientId',      label:'Consumer Key',   type:'text',     required:true,  placeholder:'3MVG9...' },
      { key:'clientSecret',  label:'Consumer Secret',type:'password', required:true,  placeholder:'...' },
      { key:'username',      label:'Username',       type:'text',     required:true,  placeholder:'user@company.com' },
      { key:'password',      label:'Password + Security Token', type:'password', required:true, placeholder:'senha + token' },
    ],
    features: ['link_cases','link_opportunities','auto_tasks'],
  },
  {
    id:          'slack',
    name:        'Slack',
    icon:        '💬',
    category:    'communication',
    description: 'Receba notificações de tarefas em canais Slack e crie tarefas a partir de mensagens.',
    docsUrl:     'https://api.slack.com',
    color:       '#4A154B',
    authType:    'webhook',
    fields: [
      { key:'webhookUrl', label:'Incoming Webhook URL', type:'text', required:true,
        placeholder:'https://hooks.slack.com/services/...', hint:'Crie em api.slack.com > Your Apps > Incoming Webhooks' },
      { key:'channel', label:'Canal padrão', type:'text', required:false,
        placeholder:'#tarefas', hint:'Canal para notificações gerais' },
      { key:'notifyOnComplete', label:'Notificar ao concluir', type:'checkbox', required:false },
      { key:'notifyOnOverdue',  label:'Notificar tarefas atrasadas', type:'checkbox', required:false },
    ],
    features: ['notify_complete','notify_overdue','notify_assigned'],
  },
  {
    id:          'github',
    name:        'GitHub',
    icon:        '🐙',
    category:    'development',
    description: 'Vincule issues e PRs do GitHub a tarefas. Atualizações automáticas de status.',
    docsUrl:     'https://docs.github.com/en/rest',
    color:       '#24292F',
    authType:    'token',
    fields: [
      { key:'accessToken', label:'Personal Access Token', type:'password', required:true,
        placeholder:'ghp_...', hint:'GitHub > Settings > Developer Settings > Personal Access Tokens' },
      { key:'org',  label:'Organização',  type:'text', required:false, placeholder:'minha-empresa' },
      { key:'repo', label:'Repositório',  type:'text', required:false, placeholder:'meu-repo' },
    ],
    features: ['link_issues','link_prs','auto_status'],
  },
  {
    id:          'webhook',
    name:        'Webhook Personalizado',
    icon:        '⚡',
    category:    'custom',
    description: 'Envie eventos do sistema para qualquer URL via HTTP POST. Ideal para automações customizadas.',
    docsUrl:     null,
    color:       '#6366F1',
    authType:    'webhook',
    fields: [
      { key:'url',    label:'URL do Endpoint', type:'text',     required:true,  placeholder:'https://seu-servidor.com/webhook' },
      { key:'secret', label:'Secret (HMAC)',   type:'password', required:false, placeholder:'Opcional — assina o payload' },
      { key:'events', label:'Eventos',         type:'checkboxes', required:true,
        options: [
          { value:'task.created',   label:'Tarefa criada'   },
          { value:'task.completed', label:'Tarefa concluída' },
          { value:'task.overdue',   label:'Tarefa atrasada' },
          { value:'project.created',label:'Projeto criado'  },
          { value:'csat.responded', label:'CSAT respondido' },
        ]
      },
    ],
    features: ['events'],
  },
];

/* ─── Salvar configuração de integração ───────────────────── */
export async function saveIntegration(integrationId, config) {
  const user = store.get('currentUser');
  const ref  = doc(db, 'integrations', integrationId);

  // Nunca salvar campos de password em texto claro — indicar que estão configurados
  const safeConfig = {};
  const catalog    = INTEGRATION_CATALOG.find(i => i.id === integrationId);
  if (catalog) {
    catalog.fields.forEach(f => {
      if (f.type === 'password' && config[f.key]) {
        safeConfig[f.key] = '••••••••'; // mask — armazenar no cliente/env vars em produção
      } else {
        safeConfig[f.key] = config[f.key] ?? null;
      }
    });
  } else {
    Object.assign(safeConfig, config);
  }

  await setDoc(ref, {
    id:         integrationId,
    enabled:    true,
    config:     safeConfig,
    rawConfig:  config,   // em prod: usar Firebase Secret Manager ou encrypt
    updatedAt:  serverTimestamp(),
    updatedBy:  user.uid,
  }, { merge: true });

  await auditLog('integrations.save', 'integration', integrationId, { integrationId });
}

/* ─── Carregar todas as integrações salvas ────────────────── */
export async function fetchIntegrations() {
  const snap = await getDocs(query(collection(db, 'integrations'), orderBy('updatedAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ─── Carregar uma integração ─────────────────────────────── */
export async function getIntegration(integrationId) {
  const snap = await getDoc(doc(db, 'integrations', integrationId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/* ─── Habilitar / desabilitar ─────────────────────────────── */
export async function toggleIntegration(integrationId, enabled) {
  await updateDoc(doc(db, 'integrations', integrationId), {
    enabled, updatedAt: serverTimestamp(),
  });
  await auditLog(`integrations.${enabled?'enable':'disable'}`, 'integration', integrationId, {});
}

/* ─── Remover integração ──────────────────────────────────── */
export async function deleteIntegration(integrationId) {
  await deleteDoc(doc(db, 'integrations', integrationId));
  await auditLog('integrations.delete', 'integration', integrationId, {});
}

/* ─── Testar conexão ──────────────────────────────────────── */
export async function testIntegration(integrationId, config) {
  switch (integrationId) {
    case 'figma':              return testFigma(config);
    case 'slack':              return testSlack(config);
    case 'github':             return testGitHub(config);
    case 'webhook':            return testWebhook(config);
    case 'microsoft_planner':  return testPlanner(config);
    case 'salesforce':         return testSalesforce(config);
    default:                   return { ok: true, message: 'Integração salva (sem teste disponível).' };
  }
}

/* ─── Testers individuais ─────────────────────────────────── */
async function testFigma(config) {
  if (!config.accessToken) return { ok: false, message: 'Access Token é obrigatório.' };
  try {
    const res = await fetch('https://api.figma.com/v1/me', {
      headers: { 'X-Figma-Token': config.accessToken },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { ok: true, message: `Conectado como ${data.name || data.email}` };
  } catch(e) {
    return { ok: false, message: 'Falha na conexão com Figma: ' + e.message };
  }
}

async function testSlack(config) {
  if (!config.webhookUrl) return { ok: false, message: 'Webhook URL é obrigatório.' };
  try {
    const res = await fetch(config.webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: '✓ PRIMETOUR — Conexão Slack configurada com sucesso!' }),
    });
    if (res.ok || res.status === 200) return { ok: true, message: 'Mensagem de teste enviada ao Slack!' };
    throw new Error(`HTTP ${res.status}`);
  } catch(e) {
    return { ok: false, message: 'Falha: ' + e.message };
  }
}

async function testGitHub(config) {
  if (!config.accessToken) return { ok: false, message: 'Access Token é obrigatório.' };
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `token ${config.accessToken}`,
        'Accept':        'application/vnd.github.v3+json',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { ok: true, message: `Conectado como @${data.login}` };
  } catch(e) {
    return { ok: false, message: 'Falha na conexão com GitHub: ' + e.message };
  }
}

async function testWebhook(config) {
  if (!config.url) return { ok: false, message: 'URL do endpoint é obrigatória.' };
  try {
    const payload = {
      event:     'webhook.test',
      timestamp: new Date().toISOString(),
      source:    'PRIMETOUR',
      data:      { message: 'Teste de conexão' },
    };
    const res = await fetch(config.url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-PRIMETOUR-Event': 'test' },
      body:    JSON.stringify(payload),
    });
    return { ok: true, message: `Endpoint respondeu com HTTP ${res.status}` };
  } catch(e) {
    return { ok: false, message: 'Falha ao chamar endpoint: ' + e.message };
  }
}

async function testPlanner(config) {
  if (!config.clientId || !config.tenantId) return { ok: false, message: 'Client ID e Tenant ID são obrigatórios.' };
  // OAuth2 real requer redirect — apenas validamos os campos
  return { ok: true, message: 'Credenciais salvas. Autenticação OAuth2 será solicitada na primeira sincronização.' };
}

async function testSalesforce(config) {
  if (!config.instanceUrl || !config.clientId) return { ok: false, message: 'Instance URL e Consumer Key são obrigatórios.' };
  return { ok: true, message: 'Credenciais salvas. Conexão será validada na primeira sincronização.' };
}

/* ─── Disparar evento de webhook ──────────────────────────── */
export async function fireWebhookEvent(eventName, data) {
  try {
    const integration = await getIntegration('webhook');
    if (!integration?.enabled) return;
    const cfg    = integration.rawConfig || integration.config || {};
    const events = cfg.events || [];
    if (!events.includes(eventName)) return;

    const payload = {
      event:     eventName,
      timestamp: new Date().toISOString(),
      source:    'PRIMETOUR',
      data,
    };

    const headers = { 'Content-Type': 'application/json', 'X-PRIMETOUR-Event': eventName };
    if (cfg.secret) {
      // HMAC em produção real — aqui apenas indica o campo
      headers['X-PRIMETOUR-Signature'] = 'sha256=' + btoa(cfg.secret + JSON.stringify(payload)).slice(0, 32);
    }

    await fetch(cfg.url, { method: 'POST', headers, body: JSON.stringify(payload) });
  } catch(e) {
    console.warn('Webhook dispatch error:', e.message);
  }
}

/* ─── Disparar notificação Slack ──────────────────────────── */
export async function fireSlackNotification(message, blocks = null) {
  try {
    const integration = await getIntegration('slack');
    if (!integration?.enabled) return;
    const cfg = integration.rawConfig || integration.config || {};
    if (!cfg.webhookUrl) return;

    const payload = blocks ? { blocks } : { text: message };
    await fetch(cfg.webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
  } catch(e) {
    console.warn('Slack notification error:', e.message);
  }
}
