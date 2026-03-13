/**
 * PRIMETOUR — Figma Integration Adapter
 * Importa arquivos, projetos e comentários do Figma como tarefas
 */

import { getIntegration } from './registry.js';
import { createTask }     from '../services/tasks.js';
import { store }          from '../store.js';

const FIGMA_API = 'https://api.figma.com/v1';

async function getToken() {
  const integration = await getIntegration('figma');
  if (!integration?.enabled) throw new Error('Integração Figma não está habilitada.');
  const token = integration.rawConfig?.accessToken || integration.config?.accessToken;
  if (!token || token === '••••••••') throw new Error('Token do Figma não configurado.');
  return token;
}

async function figmaFetch(path) {
  const token = await getToken();
  const res   = await fetch(`${FIGMA_API}${path}`, {
    headers: { 'X-Figma-Token': token },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `Figma API HTTP ${res.status}`);
  }
  return res.json();
}

/* ─── Listar projetos do time ─────────────────────────────── */
export async function getFigmaProjects(teamId) {
  const data = await figmaFetch(`/teams/${teamId}/projects`);
  return (data.projects || []).map(p => ({
    id:   p.id,
    name: p.name,
    type: 'project',
  }));
}

/* ─── Listar arquivos de um projeto ───────────────────────── */
export async function getFigmaFiles(projectId) {
  const data = await figmaFetch(`/projects/${projectId}/files`);
  return (data.files || []).map(f => ({
    id:          f.key,
    name:        f.name,
    thumbnail:   f.thumbnail_url,
    lastModified:f.last_modified,
    url:         `https://www.figma.com/file/${f.key}`,
  }));
}

/* ─── Listar comentários de um arquivo ───────────────────── */
export async function getFigmaComments(fileKey) {
  const data = await figmaFetch(`/files/${fileKey}/comments`);
  return (data.comments || []).map(c => ({
    id:        c.id,
    message:   c.message,
    author:    c.user?.handle,
    createdAt: c.created_at,
    resolved:  c.resolved_at !== null,
  }));
}

/* ─── Importar arquivo como tarefa ───────────────────────── */
export async function importFigmaFileAsTask(file, projectId = null) {
  const user = store.get('currentUser');
  return createTask({
    title:       `[Figma] ${file.name}`,
    description: `Arquivo Figma importado.\n\nURL: ${file.url}\nÚltima modificação: ${file.lastModified ? new Date(file.lastModified).toLocaleDateString('pt-BR') : '—'}`,
    status:      'todo',
    priority:    'medium',
    projectId:   projectId || null,
    tags:        ['figma', 'design'],
    metadata:    { source: 'figma', figmaFileKey: file.id, figmaUrl: file.url },
    createdBy:   user.uid,
  });
}

/* ─── Importar comentários como tarefas ───────────────────── */
export async function importFigmaCommentsAsTasks(fileKey, fileName, projectId = null) {
  const comments = await getFigmaComments(fileKey);
  const user     = store.get('currentUser');
  const unresolved = comments.filter(c => !c.resolved);
  const tasks    = [];

  for (const comment of unresolved.slice(0, 20)) { // max 20 por vez
    const task = await createTask({
      title:       `[Figma] Comentário: ${comment.message.slice(0, 80)}`,
      description: `Comentário do Figma em "${fileName}".\n\nAutor: @${comment.author || 'desconhecido'}\n\nMensagem completa:\n${comment.message}`,
      status:      'todo',
      priority:    'low',
      projectId:   projectId || null,
      tags:        ['figma', 'feedback'],
      metadata:    { source: 'figma', figmaCommentId: comment.id, figmaFileKey: fileKey },
      createdBy:   user.uid,
    });
    tasks.push(task);
  }
  return tasks;
}
