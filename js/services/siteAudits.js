/**
 * PRIMETOUR — Site Audits Service
 * CRUD de sites auditados e persistência do histórico de runs
 * (Core Web Vitals + SEO) via PageSpeed Insights API.
 *
 * Coleções no Firestore:
 *   audit_sites/{siteId}                 — site cadastrado
 *   audit_sites/{siteId}/runs/{autoId}   — histórico de auditorias
 */

import {
  collection, doc, addDoc, setDoc, getDoc, getDocs, deleteDoc,
  query, orderBy, limit, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }       from '../firebase.js';
import { store }    from '../store.js';
import { auditLog } from '../auth/audit.js';
import { runFullAudit } from './pageSpeed.js';

/* ─── Lê a API key do PageSpeed Insights ─────────────────── */
export async function getPsiApiKey() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'global'));
    if (!snap.exists()) return null;
    const data = snap.data();
    return data.psiApiKey || data.pageSpeedInsightsApiKey || null;
  } catch (_) {
    return null;
  }
}

/* ─── Lista sites cadastrados ────────────────────────────── */
export async function fetchSites() {
  const snap = await getDocs(query(collection(db, 'audit_sites'), orderBy('label'), limit(500)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ─── Cria novo site ─────────────────────────────────────── */
export async function createSite({ url, label }) {
  if (!store.can('site_audit_manage') && !store.isMaster()) {
    throw new Error('Permissão negada.');
  }
  const cleanUrl = normalizeUrl(url);
  if (!cleanUrl) throw new Error('URL inválida.');
  const uid = store.get('currentUser')?.uid;
  const docRef = await addDoc(collection(db, 'audit_sites'), {
    url:       cleanUrl,
    label:     String(label || '').trim() || cleanUrl,
    createdAt: serverTimestamp(),
    createdBy: uid,
    lastRunAt: null,
  });
  await auditLog('site_audits.create_site', 'audit_sites', docRef.id, { url: cleanUrl });
  return docRef.id;
}

/* ─── Remove site (cascata manual dos runs) ──────────────── */
export async function deleteSite(siteId) {
  if (!store.can('site_audit_manage') && !store.isMaster()) {
    throw new Error('Permissão negada.');
  }
  // Remove runs primeiro (Firestore não faz cascade nativo)
  const runsSnap = await getDocs(collection(db, 'audit_sites', siteId, 'runs'));
  await Promise.all(runsSnap.docs.map(d => deleteDoc(d.ref)));
  await deleteDoc(doc(db, 'audit_sites', siteId));
  await auditLog('site_audits.delete_site', 'audit_sites', siteId, {});
}

/* ─── Roda auditoria mobile+desktop e salva run ──────────── */
export async function runAuditAndSave(siteId) {
  if (!store.can('site_audit_manage') && !store.isMaster()) {
    throw new Error('Permissão negada.');
  }
  const siteSnap = await getDoc(doc(db, 'audit_sites', siteId));
  if (!siteSnap.exists()) throw new Error('Site não encontrado.');
  const site   = siteSnap.data();
  const apiKey = await getPsiApiKey();
  if (!apiKey) {
    throw new Error('API key do PageSpeed Insights não configurada. Acesse Configurações → Integrações.');
  }

  const uid = store.get('currentUser')?.uid;
  const { mobile, desktop } = await runFullAudit(site.url, apiKey);

  // Persiste run único com ambas estratégias
  const runDoc = {
    mobile,
    desktop,
    runAt:     serverTimestamp(),
    runBy:     uid,
    url:       site.url,
  };
  const runRef = await addDoc(collection(db, 'audit_sites', siteId, 'runs'), runDoc);

  // Atualiza metadata do site (resumo da última run)
  await setDoc(doc(db, 'audit_sites', siteId), {
    lastRunAt:        serverTimestamp(),
    lastRunId:        runRef.id,
    lastScoresMobile: mobile.scores,
    lastScoresDesktop:desktop.scores,
  }, { merge: true });

  await auditLog('site_audits.run', 'audit_sites', siteId, { runId: runRef.id });
  return { id: runRef.id, mobile, desktop };
}

/* ─── Busca últimas N runs de um site (mais recente primeiro) ── */
export async function fetchLatestRuns(siteId, limitN = 10) {
  const q = query(
    collection(db, 'audit_sites', siteId, 'runs'),
    orderBy('runAt', 'desc'),
    limit(limitN),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ─── Normaliza URL (garante https://) ───────────────────── */
function normalizeUrl(raw) {
  if (!raw) return null;
  let url = String(raw).trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const u = new URL(url);
    // Remove trailing slash do path raiz
    return u.origin + (u.pathname === '/' ? '' : u.pathname);
  } catch {
    return null;
  }
}
