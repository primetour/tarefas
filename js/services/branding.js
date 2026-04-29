/**
 * PRIMETOUR — Branding Service
 *
 * Logos do app são GLOBAIS (mesmo logo pra todos os usuários).
 * Persistidos em Firestore: app_branding/global (collection nova com
 * leitura pública — necessário pra splash/login mostrarem o logo
 * antes do auth completar).
 *
 * Cache em localStorage (`app-logo-light`, `app-logo-dark`) pra render
 * imediato (sem flash).
 *
 * Defaults hardcoded: se nem Firestore nem cache têm logo, usa as
 * URLs PRIMETOUR oficiais (dark/light). Garante que TODA instância
 * inicial veja o logo correto sem precisar configurar nada.
 */
import {
  doc, getDoc, setDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db }    from '../firebase.js';
import { store } from '../store.js';

/* ─── Defaults hardcoded (URLs no R2) ───────────────────────── */
export const DEFAULT_LOGO_LIGHT = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/logos/lazer-1777390896671.webp';
export const DEFAULT_LOGO_DARK  = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/logos/lazer-alt-1777403810065.webp';

const BRANDING_REF = () => doc(db, 'app_branding', 'global');

/* ─── Lê branding do Firestore (com fallback nos defaults) ──── */
export async function getBranding() {
  try {
    const snap = await getDoc(BRANDING_REF());
    if (snap.exists()) {
      const b = snap.data() || {};
      return {
        logoLight: b.logoLight || DEFAULT_LOGO_LIGHT,
        logoDark:  b.logoDark  || DEFAULT_LOGO_DARK,
      };
    }
  } catch(e) {
    // sem auth ou doc não existe — cai no default
  }
  return { logoLight: DEFAULT_LOGO_LIGHT, logoDark: DEFAULT_LOGO_DARK };
}

/* ─── Salva branding (admin/master only) ───────────────────── */
export async function saveBranding({ logoLight, logoDark }) {
  if (!store.isMaster() && !store.can('system_manage_settings')) {
    throw new Error('Permissão negada — apenas administradores podem alterar o logo do sistema.');
  }
  await setDoc(BRANDING_REF(), {
    logoLight: logoLight || '',
    logoDark:  logoDark  || '',
    updatedAt: serverTimestamp(),
    updatedBy: store.get('currentUser')?.uid || null,
  }, { merge: true });
  // Atualiza cache local imediatamente (e o cropped, se aplicável)
  writeCache({ logoLight, logoDark });
  // Pré-cropa as novas imagens em background
  cropAndCache(logoLight, 'app-logo-light-cropped').catch(() => {});
  cropAndCache(logoDark,  'app-logo-dark-cropped').catch(() => {});
}

/* ─── Sincroniza cache local com Firestore + pré-cropa ──────── */
export async function syncBrandingToCache() {
  const fromFs = await getBranding();
  // Sempre atualiza o cache (defaults também devem ir pro localStorage
  // pra splash/login.js poderem ler sincronamente)
  writeCache(fromFs);
  // Pré-cropa em background (não bloqueia)
  cropAndCache(fromFs.logoLight, 'app-logo-light-cropped').catch(() => {});
  cropAndCache(fromFs.logoDark,  'app-logo-dark-cropped').catch(() => {});
  return fromFs;
}

/* ─── Helper: lê cache cropado se houver, senão original ────── */
export function getCachedLogo(kind /* 'light' | 'dark' */) {
  try {
    const cropped = localStorage.getItem(`app-logo-${kind}-cropped`);
    if (cropped) return cropped;
    return localStorage.getItem(`app-logo-${kind}`) || (
      kind === 'light' ? DEFAULT_LOGO_LIGHT : DEFAULT_LOGO_DARK
    );
  } catch {
    return kind === 'light' ? DEFAULT_LOGO_LIGHT : DEFAULT_LOGO_DARK;
  }
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

/* ─── Crop de transparência ─────────────────────────────────────
 * PNG/WebP com fundo transparente tem a área visível menor que a
 * imagem total, fazendo o logo parecer "pequeno" mesmo com max-height
 * grande. Esta função desenha a imagem num canvas, escaneia os pixels
 * pra achar o bounding box do conteúdo (alpha > threshold) e crop
 * exato. Retorna data URL PNG do recorte.
 */
export async function cropTransparent(url, { alphaThreshold = 16, padding = 2 } = {}) {
  if (!url) return null;
  if (typeof Image === 'undefined' || typeof document === 'undefined') return null;
  // Carrega imagem (com CORS — R2 deve servir Access-Control-Allow-Origin)
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('img load failed: ' + url));
    im.src = url;
  });
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return null;

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  let imgData;
  try {
    imgData = ctx.getImageData(0, 0, w, h);
  } catch(e) {
    // CORS — sem permissão de ler pixels (servidor sem CORS)
    console.warn('[branding] crop: CORS blocked, returning original:', e?.message);
    return url;
  }
  const data = imgData.data;

  // Acha bounding box do conteúdo não-transparente
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  // Sem conteúdo (ou tudo transparente) — devolve original
  if (maxX < 0 || maxY < 0) return url;

  // Aplica padding mas respeita os limites
  minX = Math.max(0, minX - padding);
  minY = Math.max(0, minY - padding);
  maxX = Math.min(w - 1, maxX + padding);
  maxY = Math.min(h - 1, maxY + padding);

  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;

  // Se não recortou quase nada (< 5% em ambas dimensões), devolve original
  // pra não desperdiçar processamento e não introduzir conversão WebP→PNG
  // desnecessária
  if (cw > w * 0.95 && ch > h * 0.95) return url;

  const out = document.createElement('canvas');
  out.width = cw; out.height = ch;
  out.getContext('2d').drawImage(canvas, minX, minY, cw, ch, 0, 0, cw, ch);
  return out.toDataURL('image/png');
}

/* ─── Cropa e salva no cache (key passada) ─────────────────── */
async function cropAndCache(url, cacheKey) {
  if (!url) {
    try { localStorage.removeItem(cacheKey); } catch {}
    return null;
  }
  try {
    const cropped = await cropTransparent(url);
    if (cropped) {
      try { localStorage.setItem(cacheKey, cropped); } catch(e) {
        // Quota exceeded — limpa key e segue (vai usar original)
        console.warn('[branding] cache write failed (quota?):', e?.message);
        try { localStorage.removeItem(cacheKey); } catch {}
      }
    }
    return cropped;
  } catch(e) {
    console.warn('[branding] crop failed for', url, e?.message);
    return null;
  }
}
