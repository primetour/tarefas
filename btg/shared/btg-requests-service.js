/**
 * Service de solicitações BTG — cria "solicitações de conteúdo e
 * newsletter" pro setor de Marketing a partir de ofertas selecionadas
 * na lista de ofertas do dashboard BTG.
 *
 * Staging: escreve em `btg_requests_dev` (projeto gestor-btg-lp-builder-
 * staging). O shape do doc é IGUAL ao da coleção `requests` real do
 * Gestor (js/services/requests.js → createRequest) — então no cutover
 * pra produção é só apontar a COLLECTION pra `requests` e a solicitação
 * cai direto no módulo de Tarefas & Solicitações, no setor Marketing.
 *
 * Fallback localStorage quando o Firebase não está configurado (mesma
 * estratégia do btg-ofertas-service.js).
 */

import { getBtgFirebase } from './btg-firebase.js';

const COLLECTION = 'btg_requests_dev';
const LOCAL_KEY = 'btg-requests-dev';

/**
 * Cria uma solicitação de conteúdo + newsletter pro Marketing a partir
 * de 1 a 5 ofertas selecionadas.
 *
 * @param {Object} opts
 * @param {Array<Object>} opts.ofertas  Ofertas selecionadas (docs do Firestore).
 * @param {string} [opts.requesterName] Nome do consultor solicitante.
 * @returns {Promise<{id: string, source: 'firestore' | 'local'}>}
 */
export async function createContentRequest({ ofertas, requesterName }) {
  if (!Array.isArray(ofertas) || ofertas.length === 0) {
    throw new Error('Selecione ao menos 1 oferta.');
  }
  if (ofertas.length > 5) {
    throw new Error('Selecione no máximo 5 ofertas por solicitação.');
  }

  const lista = ofertas
    .map((o) => {
      const marcas = Array.isArray(o.tipo_cartao) ? o.tipo_cartao.join(', ') : '';
      return `• ${o.nome_da_oferta || '(sem nome)'}`
        + (marcas ? ` [${marcas}]` : '')
        + (o.slug ? ` — slug: ${o.slug}` : '');
    })
    .join('\n');

  const description =
    `Solicitação de conteúdo e newsletter para ${ofertas.length} oferta(s) BTG:\n\n`
    + `${lista}\n\n`
    + `Gerada a partir da lista de ofertas do dashboard BTG.`;

  const now = new Date().toISOString();
  const reqDoc = {
    requesterName:  (requesterName || 'Consultor BTG').trim(),
    requesterEmail: '',
    typeId:         null,
    typeName:       'Conteúdo e newsletter — Ofertas BTG',
    nucleo:         '',
    requestingArea: 'BTG Pactual',
    sector:         'Marketing e Comunicação',
    variationId:    null,
    variationName:  '',
    outOfCalendar:  false,
    isPartnership:  false,
    description,
    urgency:        false,
    desiredDate:    null,
    status:         'pending',
    taskId:         null,
    workspaceId:    null,
    assignedTo:     null,
    internalNote:   '',
    rejectionNote:  '',
    // Campos extra (além do schema base de `requests`): referência
    // estruturada das ofertas e a origem da solicitação.
    btgOfertas:     ofertas.map((o) => ({
      id:   o.id,
      nome: o.nome_da_oferta || '',
      slug: o.slug || '',
    })),
    origem:         'btg-dashboard-ofertas',
    createdAt:      now,
    updatedAt:      now,
  };

  const { db, configured } = await getBtgFirebase();
  if (configured && db) {
    const { addDoc, collection } = await import(
      'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'
    );
    const ref = await addDoc(collection(db, COLLECTION), reqDoc);
    return { id: ref.id, source: 'firestore' };
  }

  // Fallback local (sem Firebase configurado)
  const list = readLocal();
  const id = `local-${Date.now()}`;
  list.push({ id, ...reqDoc });
  writeLocal(list);
  return { id, source: 'local' };
}

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeLocal(list) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch (err) {
    console.error('[btg-requests] erro ao salvar local:', err);
  }
}
