/**
 * PRIMETOUR — GitHub Integration Adapter
 * Vincula issues e PRs a tarefas, sincroniza status
 */

import { getIntegration } from './registry.js';
import { createTask, updateTask } from '../services/tasks.js';
import { store } from '../store.js';

const GH_API = 'https://api.github.com';

async function ghFetch(path, opts = {}) {
  const integration = await getIntegration('github');
  if (!integration?.enabled) throw new Error('Integração GitHub não habilitada.');
  const token = integration.rawConfig?.accessToken || integration.config?.accessToken;
  if (!token || token === '••••••••') throw new Error('Token do GitHub não configurado.');

  const res = await fetch(`${GH_API}${path}`, {
    ...opts,
    headers: {
      'Authorization': `token ${token}`,
      'Accept':        'application/vnd.github.v3+json',
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API HTTP ${res.status}`);
  }
  return res.json();
}

/* ─── Listar issues ───────────────────────────────────────── */
export async function getGitHubIssues(owner, repo, state = 'open') {
  const items = await ghFetch(`/repos/${owner}/${repo}/issues?state=${state}&per_page=50`);
  return items
    .filter(i => !i.pull_request) // excluir PRs da listagem de issues
    .map(mapIssue);
}

/* ─── Listar PRs ──────────────────────────────────────────── */
export async function getGitHubPRs(owner, repo, state = 'open') {
  const items = await ghFetch(`/repos/${owner}/${repo}/pulls?state=${state}&per_page=50`);
  return items.map(mapPR);
}

/* ─── Importar issue como tarefa ──────────────────────────── */
export async function importIssueAsTask(issue, projectId = null) {
  const user     = store.get('currentUser');
  const priority = issue.labels.some(l => ['urgent','critical','blocker'].includes(l)) ? 'urgent' :
                   issue.labels.some(l => ['high','important'].includes(l))            ? 'high'   : 'medium';
  return createTask({
    title:       `[GH #${issue.number}] ${issue.title}`,
    description: issue.body
      ? `Issue GitHub #${issue.number}\nRepositório: ${issue.repoFullName}\n\n${issue.body}`
      : `Issue GitHub #${issue.number} — ${issue.repoFullName}`,
    status:   issue.state === 'closed' ? 'done' : 'todo',
    priority,
    projectId: projectId || null,
    tags:      ['github', ...issue.labels.slice(0, 3)],
    dueDate:   null,
    metadata:  { source: 'github', githubIssueId: issue.id, githubUrl: issue.url, repo: issue.repoFullName },
    createdBy: user.uid,
  });
}

/* ─── Importar PR como tarefa ─────────────────────────────── */
export async function importPRAsTask(pr, projectId = null) {
  const user = store.get('currentUser');
  return createTask({
    title:       `[PR #${pr.number}] ${pr.title}`,
    description: `Pull Request GitHub #${pr.number}\nRepositório: ${pr.repoFullName}\nBranch: ${pr.head} → ${pr.base}\n\n${pr.body || ''}`,
    status:      pr.state === 'closed' ? 'done' : 'in_progress',
    priority:    'high',
    projectId:   projectId || null,
    tags:        ['github', 'pr', 'code-review'],
    metadata:    { source: 'github', githubPRId: pr.id, githubUrl: pr.url, repo: pr.repoFullName },
    createdBy:   user.uid,
  });
}

/* ─── Buscar repo info ────────────────────────────────────── */
export async function getRepoInfo(owner, repo) {
  return ghFetch(`/repos/${owner}/${repo}`);
}

/* ─── Mappers ─────────────────────────────────────────────── */
function mapIssue(i) {
  return {
    id:          i.id,
    number:      i.number,
    title:       i.title,
    body:        i.body,
    state:       i.state,
    url:         i.html_url,
    author:      i.user?.login,
    labels:      i.labels?.map(l => l.name) || [],
    repoFullName: i.repository_url?.split('/').slice(-2).join('/') || '',
    createdAt:   i.created_at,
    closedAt:    i.closed_at,
  };
}

function mapPR(p) {
  return {
    id:          p.id,
    number:      p.number,
    title:       p.title,
    body:        p.body,
    state:       p.state,
    url:         p.html_url,
    author:      p.user?.login,
    head:        p.head?.ref,
    base:        p.base?.ref,
    repoFullName: p.base?.repo?.full_name || '',
    draft:       p.draft,
    createdAt:   p.created_at,
    mergedAt:    p.merged_at,
  };
}
