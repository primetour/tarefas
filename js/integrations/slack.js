/**
 * PRIMETOUR — Slack Integration Adapter
 * Notificações de tarefas em canais Slack
 */

import { getIntegration } from './registry.js';

async function getCfg() {
  const integration = await getIntegration('slack');
  if (!integration?.enabled) throw new Error('Integração Slack não habilitada.');
  const cfg = integration.rawConfig || integration.config || {};
  if (!cfg.webhookUrl) throw new Error('Webhook URL do Slack não configurado.');
  return cfg;
}

async function postToSlack(cfg, payload) {
  const res = await fetch(cfg.webhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
  if (!res.ok && res.status !== 200) throw new Error(`Slack respondeu HTTP ${res.status}`);
}

/* ─── Notificar tarefa concluída ──────────────────────────── */
export async function notifyTaskComplete(task, user) {
  const cfg = await getCfg().catch(() => null);
  if (!cfg?.notifyOnComplete) return;

  await postToSlack(cfg, {
    blocks: [
      { type:'section', text:{ type:'mrkdwn',
        text: `✅ *Tarefa concluída!*\n*${task.title}*` } },
      { type:'context', elements:[
        { type:'mrkdwn', text: `Por *${user?.name || 'alguém'}* · ${new Date().toLocaleString('pt-BR')}` },
        ...(task.projectId ? [{ type:'mrkdwn', text:`Projeto: ${task.projectName || task.projectId}` }] : []),
      ]},
    ],
    channel: cfg.channel || undefined,
  });
}

/* ─── Notificar tarefa atrasada ───────────────────────────── */
export async function notifyTaskOverdue(task) {
  const cfg = await getCfg().catch(() => null);
  if (!cfg?.notifyOnOverdue) return;

  const due = task.dueDate?.toDate ? task.dueDate.toDate() : new Date(task.dueDate);
  await postToSlack(cfg, {
    blocks: [
      { type:'section', text:{ type:'mrkdwn',
        text: `⚠️ *Tarefa atrasada!*\n*${task.title}*` } },
      { type:'context', elements:[
        { type:'mrkdwn', text:`Prazo: *${due.toLocaleDateString('pt-BR')}*` },
      ]},
    ],
    channel: cfg.channel || undefined,
  });
}

/* ─── Notificar atribuição ────────────────────────────────── */
export async function notifyTaskAssigned(task, assigneeName) {
  const cfg = await getCfg().catch(() => null);
  if (!cfg) return;

  await postToSlack(cfg, {
    text: `📌 *${assigneeName}* foi atribuído à tarefa *${task.title}*`,
    channel: cfg.channel || undefined,
  });
}

/* ─── Mensagem customizada ────────────────────────────────── */
export async function sendSlackMessage(text, channel = null) {
  const cfg = await getCfg();
  await postToSlack(cfg, { text, channel: channel || cfg.channel || undefined });
}
