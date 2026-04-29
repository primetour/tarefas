/**
 * PRIMETOUR — Branding Service
 *
 * Logos do app são GLOBAIS (mesmo logo pra todos os usuários).
 * Persistidos em Firestore: settings/global.branding = { logoLight, logoDark }
 *
 * Cache em localStorage (`app-logo-light`, `app-logo-dark`) pra render
 * imediato (sem flash) — sidebar.js, login.js e o splash em index.html
 * leem direto do localStorage. syncBrandingToCache() roda no app init e
 * atualiza o cache se o Firestore mudou.
 */
import {
  doc, getDoc, setDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';

const SETTINGS_REF = () => doc(db, 'settings', 'global');

/* ─── Lê branding do Firestore ─────────────────────────────── */
export async function getBranding() {
  try {
    const snap = await getDoc(SETTINGS_REF());
    const b = snap.exists() ? (snap.data().branding || {}) : {};
    return {
      logoLight: b.logoLight || '',
      logoDark:  b.logoDark  || '',
    };
  } catch {
    return { logoLight: '', logoDark: '' };
  }
}

/* ─── Salva branding (admin/master only) ───────────────────── */
export async function saveBranding({ logoLight, logoDark }) {
  if (!store.isMaster() && !store.can('system_manage_settings')) {
    throw new Error('Permissão negada — apenas administradores podem alterar o logo do sistema.');
  }
  await setDoc(SETTINGS_REF(), {
    branding: {
      logoLight: logoLight || '',
      logoDark:  logoDark  || '',
      updatedAt: serverTimestamp(),
      updatedBy: store.get('currentUser')?.uid || null,
    },
  }, { merge: true });
  // Atualiza cache local imediatamente
  writeCache({ logoLight, logoDark });
}

/* ─── Sincroniza cache local com Firestore ─────────────────── */
/* Chamado no app init. Se Firestore tem URLs diferentes do cache,
 * atualiza localStorage. Render dos logos usa o cache (sincrono). */
export async function syncBrandingToCache() {
  const fromFs = await getBranding();
  const cur = readCache();
  if (cur.logoLight !== fromFs.logoLight || cur.logoDark !== fromFs.logoDark) {
    writeCache(fromFs);
  }
  return fromFs;
}

function readCache() {
  try {
    return {
      logoLight: localStorage.getItem('app-logo-light') || '',
      logoDark:  localStorage.getItem('app-logo-dark')  || '',
    };
  } catch { return { logoLight: '', logoDark: '' }; }
}

function writeCache({ logoLight, logoDark }) {
  try {
    if (logoLight) localStorage.setItem('app-logo-light', logoLight);
    else localStorage.removeItem('app-logo-light');
    if (logoDark)  localStorage.setItem('app-logo-dark',  logoDark);
    else localStorage.removeItem('app-logo-dark');
  } catch {}
}
