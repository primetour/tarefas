/**
 * PRIMETOUR — Google Drive Integration (IA Hub knowledge sources)
 *
 * Usa Google Identity Services (GIS) — biblioteca nova oficial pra OAuth2
 * client-side. Diferente do antigo gapi — não precisa de SDK pesado.
 *
 * Pré-requisitos:
 *   1. Habilitar Google Drive API no projeto Google Cloud
 *   2. Criar OAuth Client ID (Web application) com:
 *      - Authorized JS origins: https://primetour.github.io
 *      - Scope: https://www.googleapis.com/auth/drive.readonly
 *   3. Setar GOOGLE_CLIENT_ID abaixo (constante).
 *
 * Fluxo:
 *   - signInWithGoogle() → popup OAuth → access token
 *   - listDriveFiles(folderId) → Drive API v3
 *   - downloadDriveFile(id) → conteúdo (texto pra Docs/Sheets/MD/TXT)
 *
 * Token vive em store + sessionStorage (sobrevive reload).
 */
import { store } from '../store.js';

// TODO: configurar via Settings ou env. Por agora hardcoded — admin
// substitui após criar OAuth Client no Google Cloud Console.
const GOOGLE_CLIENT_ID = '1083421353313-PLACEHOLDER.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';

let _tokenClient = null;
let _gisLoaded = false;

/* ─── Carrega Google Identity Services (lazy) ──────────── */
function loadGIS() {
  if (_gisLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { _gisLoaded = true; return resolve(); }
    const s = document.createElement('script');
    s.src = GIS_SCRIPT;
    s.async = true;
    s.defer = true;
    s.onload = () => { _gisLoaded = true; resolve(); };
    s.onerror = () => reject(new Error('Falha ao carregar Google Identity Services.'));
    document.head.appendChild(s);
  });
}

/* ─── Token storage ─────────────────────────────────────── */
function saveToken(token, expiresIn = 3600) {
  const expiresAt = Date.now() + (expiresIn - 300) * 1000; // -5min margem
  store.set('googleAccessToken', token);
  store.set('googleAccessTokenExpiresAt', expiresAt);
  try {
    sessionStorage.setItem('google-access-token', token);
    sessionStorage.setItem('google-token-expires', String(expiresAt));
  } catch {}
}

export function getStoredGoogleToken() {
  let t = store.get('googleAccessToken');
  let exp = store.get('googleAccessTokenExpiresAt') || 0;
  if (!t) {
    try {
      t = sessionStorage.getItem('google-access-token');
      exp = parseInt(sessionStorage.getItem('google-token-expires') || '0');
      if (t && exp > Date.now()) {
        store.set('googleAccessToken', t);
        store.set('googleAccessTokenExpiresAt', exp);
      } else if (t) {
        sessionStorage.removeItem('google-access-token');
        sessionStorage.removeItem('google-token-expires');
        return null;
      }
    } catch {}
  }
  return (t && exp > Date.now()) ? t : null;
}

export function clearGoogleToken() {
  store.set('googleAccessToken', null);
  store.set('googleAccessTokenExpiresAt', 0);
  try {
    sessionStorage.removeItem('google-access-token');
    sessionStorage.removeItem('google-token-expires');
  } catch {}
}

/* ─── Sign in (popup) ───────────────────────────────────── */
export async function signInWithGoogle() {
  const clientId = getGoogleClientId();
  if (!clientId || clientId.includes('PLACEHOLDER')) {
    throw new Error('Google Client ID não configurado. Admin precisa setar em IA Hub → Conexões.');
  }
  await loadGIS();
  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (response) => {
        if (response.error) return reject(new Error(response.error_description || response.error));
        saveToken(response.access_token, response.expires_in);
        resolve(response.access_token);
      },
    });
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

/* ─── Helper: garante token (faz login se preciso) ─────── */
async function ensureToken() {
  let t = getStoredGoogleToken();
  if (t) return t;
  return await signInWithGoogle();
}

/* ─── List arquivos numa pasta (ou em raiz) ─────────────── */
export async function listDriveFiles(folderId = 'root', { limit = 50 } = {}) {
  const token = await ensureToken();
  const q = folderId === 'root' || !folderId
    ? "'root' in parents and trashed = false"
    : `'${folderId}' in parents and trashed = false`;
  const fields = 'files(id,name,mimeType,modifiedTime,webViewLink,size)';
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=${limit}&orderBy=modifiedTime desc`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    clearGoogleToken();
    throw new Error('Sessão Google expirada. Reconecte.');
  }
  if (!res.ok) throw new Error(`Drive API ${res.status}`);
  const data = await res.json();
  return data.files || [];
}

/* ─── Busca arquivos por nome ───────────────────────────── */
export async function searchDriveFiles(query, { limit = 25 } = {}) {
  const token = await ensureToken();
  const q = `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name,mimeType,modifiedTime,webViewLink)')}&pageSize=${limit}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive search ${res.status}`);
  return (await res.json()).files || [];
}

/* ─── Download conteúdo textual ─────────────────────────── *
 * Google Docs/Sheets/Slides → export pra texto/csv via API.
 * Outros (md/txt/json) → download direto.
 * PDFs → texto extraído na API v3 nativa (mimeType=application/pdf
 * download direto retorna binário; se PDF puro precisa OCR — fora do escopo).
 */
export async function downloadDriveFileContent(file) {
  const token = await ensureToken();
  const id = typeof file === 'string' ? file : file.id;
  const mime = typeof file === 'object' ? file.mimeType : null;

  let url;
  if (mime === 'application/vnd.google-apps.document') {
    url = `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain`;
  } else if (mime === 'application/vnd.google-apps.spreadsheet') {
    url = `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/csv`;
  } else if (mime === 'application/vnd.google-apps.presentation') {
    url = `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/plain`;
  } else {
    url = `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;
  }

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Drive download ${res.status}`);
  const text = await res.text();
  return text.length > 30000 ? text.slice(0, 30000) + '\n\n[... truncado em 30KB ...]' : text;
}

/* ─── Verifica conexão ──────────────────────────────────── */
export function isGoogleConnected() {
  return !!getStoredGoogleToken();
}

export async function getUserInfo() {
  const token = await ensureToken();
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo',
    { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return await res.json();
}

/* ─── Configuração do Client ID (admin-set) ──────────────── */
export function getGoogleClientId() {
  // Lê de localStorage primeiro (override admin), depois do default
  try {
    const override = localStorage.getItem('google-client-id');
    if (override) return override;
  } catch {}
  return GOOGLE_CLIENT_ID;
}

export function setGoogleClientId(id) {
  if (!id || !id.endsWith('.apps.googleusercontent.com')) {
    throw new Error('Client ID inválido. Deve terminar em .apps.googleusercontent.com');
  }
  try { localStorage.setItem('google-client-id', id); } catch {}
}
