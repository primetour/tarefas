/**
 * PRIMETOUR — Meta Links Helper
 *
 * Modelo:
 *   task.metaLinks = [
 *     { userId: 'uid1', goalId: 'g1', metaRef: '0:1' },  // pilarIdx:metaIdx
 *     { userId: 'uid1', goalId: 'g2', metaRef: '0:0' },
 *     { userId: 'uid2', goalId: 'g1', metaRef: '0:1' },
 *   ]
 *
 * Back-compat: campos legados `goalId` + `goalMetaRef` (1:1) são preservados
 * apontando para o PRIMEIRO link válido — assim queries antigas seguem
 * funcionando enquanto o front migra para `metaLinks`.
 *
 * Sem dependência de Firebase: pode ser importado em testes node puros.
 */

/* ─── Normalização ───────────────────────────────────────── */

/**
 * Normaliza um array de metaLinks: filtra inválidos + remove duplicatas.
 * Cada link precisa ter (userId, goalId, metaRef) preenchidos.
 * metaRef segue o formato `${pilarIdx}:${metaIdx}` (ambos números >= 0).
 */
export function normalizeMetaLinks(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out  = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const userId  = String(raw.userId  || '').trim();
    const goalId  = String(raw.goalId  || '').trim();
    const metaRef = String(raw.metaRef || '').trim();
    if (!userId || !goalId || !metaRef) continue;
    if (!/^\d+:\d+$/.test(metaRef)) continue;
    const key = `${userId}::${goalId}::${metaRef}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ userId, goalId, metaRef });
  }
  return out;
}

/**
 * Migra os campos legados (goalId + goalMetaRef) para metaLinks expandido
 * por todos os responsáveis (assignees) — opção (A) escolhida pelo usuário.
 *
 * - Se já há metaLinks, retorna-os normalizados (sem duplicar a meta legada).
 * - Se há legado mas nenhum assignee, retorna [] (não há a quem atribuir).
 */
export function migrateLegacyToMetaLinks(task) {
  if (!task) return [];
  const existing = normalizeMetaLinks(task.metaLinks);
  if (existing.length) return existing;

  const goalId  = task.goalId;
  const metaRef = task.goalMetaRef;
  if (!goalId || !metaRef) return [];

  const assignees = Array.isArray(task.assignees) ? task.assignees.filter(Boolean) : [];
  if (!assignees.length) return [];

  return normalizeMetaLinks(
    assignees.map(uid => ({ userId: uid, goalId, metaRef }))
  );
}

/**
 * Sincroniza os campos legados (goalId/goalMetaRef) com o primeiro link de
 * `metaLinks`. Mutação imutável: retorna NOVO objeto.
 */
export function syncLegacyFields(taskUpdate) {
  const out = { ...(taskUpdate || {}) };
  const links = normalizeMetaLinks(out.metaLinks);
  out.metaLinks = links;
  if (links.length) {
    out.goalId       = links[0].goalId;
    out.goalMetaRef  = links[0].metaRef;
  } else {
    out.goalId       = null;
    out.goalMetaRef  = null;
  }
  return out;
}

/* ─── Filtros / queries auxiliares ───────────────────────── */

/**
 * Tasks vinculadas a uma goal (qualquer meta dela, qualquer responsável).
 * Aceita o formato novo (metaLinks) E o legado (goalId).
 */
export function tasksLinkedToGoal(tasks, goalId) {
  if (!Array.isArray(tasks) || !goalId) return [];
  return tasks.filter(t => {
    if (t?.goalId === goalId) return true;
    if (Array.isArray(t?.metaLinks)) {
      return t.metaLinks.some(l => l && l.goalId === goalId);
    }
    return false;
  });
}

/**
 * Tasks vinculadas a UMA meta específica de UMA goal (qualquer responsável).
 */
export function tasksLinkedToMeta(tasks, goalId, metaRef) {
  if (!Array.isArray(tasks) || !goalId || !metaRef) return [];
  return tasks.filter(t => {
    // Legado
    if (t?.goalId === goalId && t?.goalMetaRef === metaRef) return true;
    // Novo modelo
    if (Array.isArray(t?.metaLinks)) {
      return t.metaLinks.some(l => l && l.goalId === goalId && l.metaRef === metaRef);
    }
    return false;
  });
}

/**
 * Links de meta atribuídos a um determinado responsável dentro de uma task.
 * Útil pro picker (abas por responsável).
 */
export function metaLinksForUser(task, userId) {
  if (!task || !userId) return [];
  const links = normalizeMetaLinks(task.metaLinks);
  return links.filter(l => l.userId === userId);
}

/**
 * Expande as metas de um pilar inteiro em links para um determinado
 * responsável. `pilar` é um item de `goal.pilares`, com `metas: [...]`.
 * Retorna um array pronto pra ser concatenado ao metaLinks atual.
 */
export function expandPilarToLinks({ goalId, pilar, pilarIdx, userId }) {
  if (!goalId || !userId || !pilar || !Array.isArray(pilar.metas)) return [];
  return pilar.metas.map((_, mIdx) => ({
    userId,
    goalId,
    metaRef: `${pilarIdx}:${mIdx}`,
  }));
}

/* ─── Util: agrupamento p/ UI ────────────────────────────── */

/**
 * Agrupa metaLinks por userId. Retorna Map<userId, MetaLink[]>.
 */
export function groupLinksByUser(metaLinks) {
  const out = new Map();
  for (const l of normalizeMetaLinks(metaLinks)) {
    if (!out.has(l.userId)) out.set(l.userId, []);
    out.get(l.userId).push(l);
  }
  return out;
}
