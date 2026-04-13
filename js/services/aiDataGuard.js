/**
 * PRIMETOUR — AI Data Guard
 * Camada de proteção LGPD para dados enviados a provedores de IA.
 * - Anonimiza PII antes do envio (emails, telefones, CPFs, passaportes)
 * - Restaura dados reais na resposta
 * - Gerencia consentimento do usuário
 * - Configuração de privacidade centralizada
 */

import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs,
  collection, query, where, orderBy, limit,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';

/* ─── Padrões PII ───────────────────────────────────────────── */
const PII_PATTERNS = [
  { type: 'email',    regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g },
  { type: 'cpf',      regex: /\d{3}\.?\d{3}\.?\d{3}[\-]?\d{2}/g },
  { type: 'phone',    regex: /(?:\+55\s?)?\(?\d{2}\)?\s?\d{4,5}[\-\s]?\d{4}/g },
  { type: 'passport', regex: /[A-Z]{2}\d{6,7}/g },
];

/* Módulos que SEMPRE anonimizam (contêm PII de clientes) */
const SENSITIVE_MODULES = ['roteiros', 'feedbacks', 'csat'];

/* ─── Cache ─────────────────────────────────────────────────── */
let _privacyCache = null;
let _privacyCacheTs = 0;
const CACHE_TTL = 5 * 60_000; // 5 min

/* ─── Config de Privacidade ─────────────────────────────────── */
const PRIVACY_DOC = 'system_config/ai-privacy';

const DEFAULT_PRIVACY = {
  anonymizePii: true,
  anonymizeModules: ['roteiros', 'feedbacks', 'csat'],
  consentRequired: true,
  consentVersion: '1.0',
  dataRetentionDays: 90,
  allowedProviders: ['gemini', 'groq', 'openai', 'anthropic', 'azure', 'local'],
  localPreferred: false,
  showDisclaimer: true,

  providerInfo: {
    gemini:    { gdpr: true,  lgpd: false, region: 'US',     note: 'Free tier pode usar dados para treinamento' },
    groq:      { gdpr: true,  lgpd: false, region: 'US',     note: 'Free tier pode usar dados para treinamento' },
    openai:    { gdpr: true,  lgpd: true,  region: 'US/EU',  note: 'DPA disponível, opt-out de treinamento' },
    anthropic: { gdpr: true,  lgpd: true,  region: 'US',     note: 'Não usa dados para treinamento' },
    azure:     { gdpr: true,  lgpd: true,  region: 'config', note: 'Região Brasil disponível (South Brazil)' },
    local:     { gdpr: true,  lgpd: true,  region: 'local',  note: 'Dados nunca saem do servidor' },
  },
};

/**
 * Carrega config de privacidade (com cache de 5 min)
 */
export async function getPrivacyConfig() {
  if (_privacyCache && Date.now() - _privacyCacheTs < CACHE_TTL) return _privacyCache;
  try {
    const snap = await getDoc(doc(db, 'system_config', 'ai-privacy'));
    _privacyCache = snap.exists() ? { ...DEFAULT_PRIVACY, ...snap.data() } : { ...DEFAULT_PRIVACY };
  } catch {
    _privacyCache = { ...DEFAULT_PRIVACY };
  }
  _privacyCacheTs = Date.now();
  return _privacyCache;
}

/**
 * Salva config de privacidade
 */
export async function savePrivacyConfig(data) {
  await setDoc(doc(db, 'system_config', 'ai-privacy'), {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: store.get('currentUser')?.uid || null,
  }, { merge: true });
  _privacyCache = null;
  _privacyCacheTs = 0;
}

/* ─── Anonimização ──────────────────────────────────────────── */

/**
 * Anonimiza texto substituindo PII por placeholders.
 * @param {string} text
 * @returns {{ anonymized: string, mapping: Object, piiFound: string[] }}
 */
export function anonymizeText(text) {
  if (!text || typeof text !== 'string') return { anonymized: text, mapping: {}, piiFound: [] };

  let anonymized = text;
  const mapping = {};
  const piiFound = [];
  const counters = {};

  for (const { type, regex } of PII_PATTERNS) {
    // Reset regex state
    regex.lastIndex = 0;
    const cloned = new RegExp(regex.source, regex.flags);
    let match;
    while ((match = cloned.exec(anonymized)) !== null) {
      const original = match[0];
      // Evitar falsos positivos: CPFs que são números genéricos curtos
      if (type === 'cpf' && original.replace(/\D/g, '').length < 11) continue;
      // Evitar telefones muito curtos
      if (type === 'phone' && original.replace(/\D/g, '').length < 10) continue;

      counters[type] = (counters[type] || 0) + 1;
      const placeholder = `[${type.toUpperCase()}_${counters[type]}]`;

      // Só adicionar se não já mapeado
      if (!Object.values(mapping).includes(original)) {
        mapping[placeholder] = original;
        anonymized = anonymized.replace(original, placeholder);
        if (!piiFound.includes(type)) piiFound.push(type);
      }
    }
  }

  return { anonymized, mapping, piiFound };
}

/**
 * Restaura texto anonimizado com dados reais.
 * @param {string} text — texto com placeholders
 * @param {Object} mapping — { '[EMAIL_1]': 'real@email.com' }
 * @returns {string}
 */
export function restoreText(text, mapping) {
  if (!text || !mapping || !Object.keys(mapping).length) return text;
  let restored = text;
  for (const [placeholder, original] of Object.entries(mapping)) {
    // Escape o placeholder para uso em regex (colchetes)
    const escaped = placeholder.replace(/[[\]]/g, '\\$&');
    restored = restored.replace(new RegExp(escaped, 'g'), original);
  }
  return restored;
}

/**
 * Anonimiza um objeto de contexto recursivamente.
 * @param {Object} context
 * @param {string} moduleId
 * @returns {{ anonymized: Object, mapping: Object, piiFound: string[] }}
 */
export function anonymizeContext(context, moduleId) {
  if (!context || typeof context !== 'object') return { anonymized: context, mapping: {}, piiFound: [] };

  const globalMapping = {};
  const allPiiFound = [];

  function processValue(val) {
    if (typeof val === 'string') {
      const { anonymized, mapping, piiFound } = anonymizeText(val);
      Object.assign(globalMapping, mapping);
      piiFound.forEach(t => { if (!allPiiFound.includes(t)) allPiiFound.push(t); });
      return anonymized;
    }
    if (Array.isArray(val)) return val.map(processValue);
    if (val && typeof val === 'object' && !(val instanceof Date)) {
      const result = {};
      for (const [k, v] of Object.entries(val)) {
        result[k] = processValue(v);
      }
      return result;
    }
    return val;
  }

  const anonymized = processValue(context);
  return { anonymized, mapping: globalMapping, piiFound: allPiiFound };
}

/**
 * Verifica se o módulo deve ter PII anonimizado.
 */
export async function shouldAnonymize(moduleId) {
  const config = await getPrivacyConfig();
  if (!config.anonymizePii) return false;
  // Módulos sensíveis sempre anonimizam
  if (SENSITIVE_MODULES.includes(moduleId)) return true;
  // Módulos configurados pelo admin
  return (config.anonymizeModules || []).includes(moduleId);
}

/* ─── Consentimento ─────────────────────────────────────────── */

/**
 * Verifica se o usuário atual aceitou os termos de IA.
 * @returns {{ consented: boolean, version: string|null, acceptedAt: any }}
 */
export async function checkConsent() {
  const config = await getPrivacyConfig();
  if (!config.consentRequired) return { consented: true, version: config.consentVersion, acceptedAt: null };

  const uid = store.get('currentUser')?.uid;
  if (!uid) return { consented: false, version: null, acceptedAt: null };

  // Master users bypass consent
  if (store.isMaster?.()) return { consented: true, version: config.consentVersion, acceptedAt: null };

  try {
    const userDoc = await getDoc(doc(db, 'users', uid));
    const aiConsent = userDoc.data()?.aiConsent;
    if (aiConsent?.accepted && aiConsent?.version === config.consentVersion) {
      return { consented: true, version: aiConsent.version, acceptedAt: aiConsent.acceptedAt };
    }
  } catch { /* ignore */ }

  return { consented: false, version: null, acceptedAt: null };
}

/**
 * Registra aceitação do consentimento de IA.
 */
export async function acceptAiConsent() {
  const uid = store.get('currentUser')?.uid;
  if (!uid) return;
  const config = await getPrivacyConfig();
  await updateDoc(doc(db, 'users', uid), {
    'aiConsent.accepted': true,
    'aiConsent.acceptedAt': serverTimestamp(),
    'aiConsent.version': config.consentVersion,
  });
}

/**
 * Revoga consentimento de IA.
 */
export async function revokeAiConsent() {
  const uid = store.get('currentUser')?.uid;
  if (!uid) return;
  await updateDoc(doc(db, 'users', uid), {
    'aiConsent.accepted': false,
    'aiConsent.revokedAt': serverTimestamp(),
  });
}

/* ─── Verificação de Provider ───────────────────────────────── */

/**
 * Verifica se um provider está autorizado pela política de privacidade.
 */
export async function isProviderAllowed(provider) {
  const config = await getPrivacyConfig();
  return (config.allowedProviders || []).includes(provider);
}

/**
 * Retorna o provider preferido para dados sensíveis.
 * Se localPreferred=true e provider 'local' está configurado, retorna 'local'.
 */
export async function getPreferredProvider(moduleId) {
  const config = await getPrivacyConfig();
  if (config.localPreferred && SENSITIVE_MODULES.includes(moduleId)) {
    if (config.allowedProviders.includes('local')) return 'local';
  }
  return null; // usar provider padrão
}

/* ─── Retenção de Dados ─────────────────────────────────────── */

/**
 * Limpa logs de uso de IA mais antigos que o período configurado.
 * @returns {number} quantidade de logs removidos
 */
export async function cleanExpiredLogs() {
  const config = await getPrivacyConfig();
  const days = config.dataRetentionDays || 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const snap = await getDocs(query(
    collection(db, 'ai_usage_logs'),
    where('timestamp', '<', cutoff),
    limit(500),
  ));

  let count = 0;
  const batch = [];
  for (const d of snap.docs) {
    batch.push(deleteDoc(doc(db, 'ai_usage_logs', d.id)));
    count++;
  }
  await Promise.all(batch);
  return count;
}

/* ─── Relatório LGPD ────────────────────────────────────────── */

/**
 * Gera dados para relatório LGPD.
 */
export async function generateLgpdReport() {
  const config = await getPrivacyConfig();

  // Contagem de logs por provider (últimos 30 dias)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const logSnap = await getDocs(query(
    collection(db, 'ai_usage_logs'),
    where('timestamp', '>=', thirtyDaysAgo),
    orderBy('timestamp', 'desc'),
    limit(1000),
  ));

  const byProvider = {};
  const byModule = {};
  let totalCalls = 0;
  let totalTokens = 0;
  let anonymizedCalls = 0;

  logSnap.docs.forEach(d => {
    const data = d.data();
    totalCalls++;
    totalTokens += (data.inputTokens || 0) + (data.outputTokens || 0);
    if (data.piiAnonymized) anonymizedCalls++;

    const p = data.provider || 'unknown';
    byProvider[p] = (byProvider[p] || 0) + 1;

    const m = data.module || 'unknown';
    byModule[m] = (byModule[m] || 0) + 1;
  });

  // Status de consentimento dos usuários
  const usersSnap = await getDocs(query(
    collection(db, 'users'),
    where('active', '==', true),
    limit(500),
  ));

  let consented = 0;
  let notConsented = 0;
  usersSnap.docs.forEach(d => {
    const consent = d.data()?.aiConsent;
    if (consent?.accepted && consent?.version === config.consentVersion) consented++;
    else notConsented++;
  });

  return {
    period: '30 dias',
    generatedAt: new Date().toISOString(),
    config: {
      anonymizePii: config.anonymizePii,
      anonymizeModules: config.anonymizeModules,
      consentRequired: config.consentRequired,
      dataRetentionDays: config.dataRetentionDays,
      allowedProviders: config.allowedProviders,
      localPreferred: config.localPreferred,
    },
    usage: {
      totalCalls,
      totalTokens,
      anonymizedCalls,
      anonymizationRate: totalCalls ? Math.round(anonymizedCalls / totalCalls * 100) : 0,
      byProvider,
      byModule,
    },
    consent: {
      version: config.consentVersion,
      consented,
      notConsented,
      total: consented + notConsented,
    },
    providerCompliance: config.providerInfo || DEFAULT_PRIVACY.providerInfo,
  };
}
