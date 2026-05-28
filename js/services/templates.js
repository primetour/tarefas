/**
 * PRIMETOUR — Biblioteca de Templates (SSOT + service layer)
 *
 * Sprint v4.63.x: Upload de templates real (HTML/DOCX/PPTX).
 *
 * Arquitetura (CLAUDE.md decisões com Renê 28/05/2026):
 * - HTML  → renderiza PDF (Puppeteer) E Web link (mesmo arquivo serve 2 formatos)
 * - DOCX  → docxtemplater (template Word com placeholders Mustache no XML)
 * - PPTX  → pptxtemplater (template PowerPoint idem)
 *
 * Placeholders: Handlebars {{cliente.nome}} consistente nos 3 formatos.
 *
 * Permissão: nova role `templates_manage` (separada de portal_areas_manage).
 * Hard delete: master only (bibliotecas são imutáveis — use archive).
 *
 * Schema Firestore (templates/{templateId}):
 *
 *   {
 *     name:             'BTG Cotação Padrão Q1 2026',     // string user-facing
 *     module:           'cotacoes' | 'portal' | 'banco-roteiros',
 *     format:           'html' | 'docx' | 'pptx',         // HTML serve PDF+Web
 *     fileUrl:          'https://storage.../tpl_xyz.docx',
 *     fileStoragePath:  'templates/cotacoes/tpl_xyz.docx', // pra delete físico futuro
 *     fileSize:         124800,
 *     fileSha256:       'a3f4b9...',                       // integridade + dedup
 *     fileMime:         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 *     previewUrl:       'https://storage.../thumb.png',    // só HTML por enquanto (v1)
 *     placeholders:     ['cliente.nome', 'viagem.dataInicio', 'dias', ...],
 *     ownerType:        'area' | 'global',
 *     ownerId:          'lazer' | null,
 *     isDefault:        false,                              // default da área pra esse module+format
 *     status:           'active' | 'archived',
 *
 *     version:          1,
 *     parentTemplateId: null,                               // doc anterior se update
 *     versionHistory:   [{ version:1, sha:'...', uploadedAt:Timestamp }],
 *     duplicatedFrom:   null,                               // template original se foi duplicado
 *
 *     uploadedAt:       serverTimestamp,
 *     uploadedBy:       uid,
 *     updatedAt:        serverTimestamp,
 *     updatedBy:        uid,
 *   }
 *
 * business_units/{buId}.templateRefs = {
 *   cotacoes: { html: 'tpl_xyz', docx: 'tpl_abc', pptx: 'tpl_def' },
 *   portal:   { ... },
 * }
 */

import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, deleteDoc,
  updateDoc, query, where, orderBy, limit,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from '../firebase.js';
import { store } from '../store.js';
import { auditLog } from '../auth/audit.js';

const COLLECTION = 'templates';

/* ─── Constantes públicas ───────────────────────────────────────────── */

/** Módulos que aceitam templates uploaded. */
export const TEMPLATE_MODULES = [
  { id: 'cotacoes',       label: 'Cotações',          icon: '✈' },
  { id: 'portal',         label: 'Portal de Dicas',   icon: '💡' },
  { id: 'banco-roteiros', label: 'Banco de Roteiros', icon: '📚' },
];

/** Formatos suportados pra upload. HTML serve PDF+Web. */
export const TEMPLATE_FORMATS = [
  { id: 'html', label: 'HTML',  ext: ['html', 'htm'], maxMB: 5,  exports: ['pdf', 'web'],
    mime: 'text/html',
    desc: 'Mesmo arquivo gera PDF (Puppeteer) E Web link.' },
  { id: 'docx', label: 'Word',  ext: ['docx'],        maxMB: 10, exports: ['docx'],
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    desc: 'Template Word com placeholders {{cliente.nome}}.' },
  { id: 'pptx', label: 'PowerPoint', ext: ['pptx'],   maxMB: 15, exports: ['pptx'],
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    desc: 'Template PowerPoint com placeholders {{cliente.nome}}.' },
];

/** Map por id pra lookup O(1). */
export const FORMAT_MAP = Object.fromEntries(TEMPLATE_FORMATS.map(f => [f.id, f]));
export const MODULE_MAP = Object.fromEntries(TEMPLATE_MODULES.map(m => [m.id, m]));

/** Limite global de tamanho de arquivo upload (defensivo). */
export const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Schema de placeholders disponíveis por módulo. Documento mestre pra que
 * designer/comercial sabe quais variáveis pode usar no template.
 * Atualiza este map quando adapter shapeForTemplate ganhar campos novos.
 */
export const PLACEHOLDERS_SPEC = {
  cotacoes: [
    { key: 'cliente.nome',         desc: 'Nome do cliente' },
    { key: 'cliente.adults',       desc: 'Número de adultos' },
    { key: 'cliente.children',     desc: 'Número de crianças' },
    { key: 'viagem.dataInicio',    desc: 'Data início (DD/MM/YYYY)' },
    { key: 'viagem.dataFim',       desc: 'Data fim (DD/MM/YYYY)' },
    { key: 'viagem.noites',        desc: 'Número de noites' },
    { key: 'viagem.destinos',      desc: 'Lista de destinos (string concat)' },
    { key: 'area.nome',            desc: 'Nome da área/BU (ex: "BTG Partners")' },
    { key: 'area.logoUrl',         desc: 'URL do logo da BU' },
    { key: 'dias',                 desc: 'Array de dias do roteiro (loop {{#each dias}})' },
    { key: 'dias.[i].numero',      desc: 'Número do dia' },
    { key: 'dias.[i].cidade',      desc: 'Cidade do dia' },
    { key: 'dias.[i].narrativa',   desc: 'Narrativa do dia' },
    { key: 'dias.[i].atividades',  desc: 'Array de atividades (loop)' },
    { key: 'hoteis',               desc: 'Array de hotéis' },
    { key: 'voos',                 desc: 'Array de voos' },
    { key: 'precos.totalCasal',    desc: 'Total por casal formatado (R$ X.XXX)' },
    { key: 'precos.porPessoa',     desc: 'Total por pessoa' },
    { key: 'precos.moeda',         desc: 'Sigla moeda (BRL/USD/EUR)' },
    { key: 'inclui',               desc: 'Lista do que inclui' },
    { key: 'naoInclui',            desc: 'Lista do que não inclui' },
    { key: 'today',                desc: 'Data de hoje (DD/MM/YYYY)' },
  ],
  portal: [
    { key: 'area.nome',            desc: 'Nome da área' },
    { key: 'destinos',             desc: 'Array de destinos com tips' },
    { key: 'destinos.[i].cidade',  desc: 'Cidade do destino' },
    { key: 'destinos.[i].pais',    desc: 'País do destino' },
    { key: 'destinos.[i].tips',    desc: 'Array de tips do destino' },
    { key: 'segments',             desc: 'Array de segmentos ativos (gastronomia, hotéis, etc.)' },
    { key: 'today',                desc: 'Data de hoje' },
  ],
  'banco-roteiros': [
    { key: 'titulo',               desc: 'Título do roteiro' },
    { key: 'destinos',             desc: 'Destinos do roteiro' },
    { key: 'noites',               desc: 'Noites' },
    { key: 'dias',                 desc: 'Array de dias' },
    { key: 'area.nome',            desc: 'Nome da BU' },
  ],
};

/* ─── Helpers internos ──────────────────────────────────────────────── */

function uid() { return store.get('currentUser')?.uid || null; }

function canManageTemplates() {
  if (store.isMaster?.()) return true;
  // Tenta múltiplos paths de permissão (store API + role doc)
  return !!(store.can?.('templates_manage') || store.hasPermission?.('templates_manage'));
}

/* ─── CRUD ──────────────────────────────────────────────────────────── */

/**
 * Lista templates com filtros opcionais. Default: só status='active'.
 *
 * @param {Object} opts
 * @param {string} [opts.module]       'cotacoes' | 'portal' | 'banco-roteiros'
 * @param {string} [opts.format]       'html' | 'docx' | 'pptx'
 * @param {string} [opts.ownerId]      area id pra filtrar (ex: 'lazer')
 * @param {'active'|'archived'|'all'} [opts.status='active']
 */
export async function fetchTemplates(opts = {}) {
  const { module, format, ownerId, status = 'active' } = opts;
  // Firestore não permite múltiplos where com inequalities — fetch ampla + filtra client
  // (volume esperado <500 templates, performance OK)
  const snap = await getDocs(query(collection(db, COLLECTION), limit(500)));
  let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (status !== 'all') docs = docs.filter(d => (d.status || 'active') === status);
  if (module)  docs = docs.filter(d => d.module === module);
  if (format)  docs = docs.filter(d => d.format === format);
  if (ownerId) docs = docs.filter(d => d.ownerId === ownerId || d.ownerType === 'global');
  // Ordem: defaults primeiro, depois mais recentes
  return docs.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0);
  });
}

/**
 * Resolve UM template por id (pra render). Retorna null se não existir.
 */
export async function fetchTemplate(id) {
  if (!id) return null;
  try {
    const snap = await getDoc(doc(db, COLLECTION, id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  } catch (e) {
    console.warn('[templates] fetch falhou:', e?.message);
    return null;
  }
}

/**
 * Cria entrada de template após upload do arquivo no Storage.
 * NOTA: o upload físico do arquivo é responsabilidade da CF `uploadTemplate`
 * (v4.63.1). Esta função apenas registra o doc no Firestore.
 *
 * @param {Object} data — { name, module, format, fileUrl, fileStoragePath,
 *                          fileSize, fileSha256, fileMime, ownerType, ownerId,
 *                          placeholders[], ... }
 */
export async function createTemplate(data) {
  if (!canManageTemplates()) throw new Error('Permissão negada (templates_manage).');

  const payload = {
    ...data,
    status: 'active',
    version: 1,
    parentTemplateId: null,
    versionHistory: [{
      version: 1,
      sha: data.fileSha256 || null,
      uploadedAt: new Date(), // serverTimestamp não funciona dentro de array
    }],
    isDefault: data.isDefault === true,
    uploadedAt: serverTimestamp(),
    uploadedBy: uid(),
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
  };

  const ref = await addDoc(collection(db, COLLECTION), payload);

  try {
    await auditLog('templates.create', 'templates', ref.id, {
      name: data.name, module: data.module, format: data.format, ownerId: data.ownerId,
    });
  } catch {}

  return ref.id;
}

/**
 * Atualiza metadata de template (nome, isDefault, etc.). NÃO sobe arquivo
 * novo — pra isso, use `createNewVersion()` (v4.63.10).
 */
export async function updateTemplate(id, patch) {
  if (!canManageTemplates()) throw new Error('Permissão negada (templates_manage).');
  if (!id) throw new Error('id obrigatório');

  await updateDoc(doc(db, COLLECTION, id), {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
  });

  try {
    await auditLog('templates.update', 'templates', id, { patchKeys: Object.keys(patch) });
  } catch {}
}

/**
 * Soft-delete: marca status='archived'. Hard delete (Storage file + doc) só
 * via Admin SDK ou Cloud Function `deleteTemplate` (v4.63.10).
 */
export async function archiveTemplate(id) {
  if (!canManageTemplates()) throw new Error('Permissão negada (templates_manage).');
  await updateDoc(doc(db, COLLECTION, id), {
    status: 'archived',
    archivedAt: serverTimestamp(),
    archivedBy: uid(),
    updatedAt: serverTimestamp(),
  });
  try {
    await auditLog('templates.archive', 'templates', id, {}, { severity: 'warning' });
  } catch {}
}

/* ─── Helpers de UI ─────────────────────────────────────────────────── */

/**
 * Formata bytes pra display (1234567 → "1.2 MB").
 */
export function formatFileSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * v4.63.1+ Upload de template via Cloud Function uploadTemplate.
 *
 * Decodifica File pra base64 + chama CF que valida + faz upload pro R2 +
 * cria doc Firestore. Retorna { templateId, fileUrl, fileSha256, sizeBytes }.
 *
 * @param {File} file — File object do <input type="file">
 * @param {Object} meta — { name, module, format, ownerType, ownerId, isDefault }
 */
export async function uploadTemplate(file, meta) {
  if (!canManageTemplates()) throw new Error('Permissão negada (templates_manage).');
  const valid = validateTemplateFile(file, meta.format);
  if (!valid.ok) throw new Error(valid.error);

  // Lê arquivo como base64
  const fileBase64 = await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => {
      // result = "data:<mime>;base64,<data>" → pega só a parte base64
      const dataUrl = fr.result || '';
      const idx = dataUrl.indexOf(',');
      res(idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl);
    };
    fr.onerror = () => rej(fr.error || new Error('FileReader falhou'));
    fr.readAsDataURL(file);
  });

  // Chama CF
  const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js');
  const { app } = await import('../firebase.js');
  const fn = httpsCallable(getFunctions(app, 'us-central1'), 'uploadTemplate');

  const payload = {
    name: meta.name,
    module: meta.module,
    format: meta.format,
    ownerType: meta.ownerType || 'area',
    ownerId: meta.ownerId || null,
    isDefault: !!meta.isDefault,
    originalFilename: file.name || '',
    fileBase64,
  };
  const res = await fn(payload);
  return res.data; // { templateId, fileUrl, fileSha256, sizeBytes }
}

/**
 * Valida arquivo antes de upload (mime + size + extensão).
 * Retorna { ok: bool, error: string|null }.
 */
export function validateTemplateFile(file, format) {
  const fmt = FORMAT_MAP[format];
  if (!fmt) return { ok: false, error: `Formato desconhecido: ${format}` };
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!fmt.ext.includes(ext)) {
    return { ok: false, error: `Extensão .${ext} não aceita pra ${fmt.label}. Esperado: ${fmt.ext.map(e => '.' + e).join(', ')}` };
  }
  if (file.size > fmt.maxMB * 1024 * 1024) {
    return { ok: false, error: `Arquivo ${formatFileSize(file.size)} excede limite de ${fmt.maxMB}MB pra ${fmt.label}` };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, error: `Arquivo excede limite global de ${formatFileSize(MAX_FILE_SIZE_BYTES)}` };
  }
  return { ok: true, error: null };
}
