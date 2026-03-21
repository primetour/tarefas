/**
 * PRIMETOUR — LinkedIn Analytics + OAuth
 * Métricas da company page e posts publicados via LinkedIn API
 */

import { store }  from '../store.js';
import { toast }  from '../components/toast.js';
import { db }     from '../firebase.js';
import {
  doc, getDoc, setDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { AI_WORKER_URL, AI_WORKER_TOKEN } from '../services/aiService.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = n => (n||0).toLocaleString('pt-BR');
const fmt = ts => {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return new Intl.DateTimeFormat('pt-BR').format(d);
};

const LI_API      = 'https://api.linkedin.com/v2';
const LI_CLIENT_ID = '77t7i2nytso78n';
// OAuth redirect must match exactly what's registered in LinkedIn app
const REDIRECT_URI = 'https://primetour.github.io/tarefas/';

export async function renderLinkedinPerformance(container) {
  if (!store.can('analytics_view') && !store.isAdmin() && !store.isMaster()) {
    container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">◈</div>
      <div class="empty-state-title">Acesso restrito</div></div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">LinkedIn</h1>
        <p class="page-subtitle">Performance da company page PRIMETOUR</p>
      </div>
      <div class="page-header-actions" style="gap:8px;">
        <button class="btn btn-secondary btn-sm" id="li-refresh">↺ Atualizar</button>
        <button class="btn btn-ghost btn-sm" id="li-reconnect"
          style="font-size:0.75rem;color:var(--text-muted);">⚙ Reconectar</button>
      </div>
    </div>
    <div id="li-body">${loadingHtml('Verificando conexão…')}</div>
  `;

  document.getElementById('li-refresh')?.addEventListener('click', () => loadData(container));
  document.getElementById('li-reconnect')?.addEventListener('click', () => startOAuth());

  await loadData(container);
}

async function loadData(container) {
  const body = document.getElementById('li-body');
  if (!body) return;

  const cfg = await getLinkedinConfig();

  if (!cfg?.accessToken) {
    renderConnectPrompt(body);
    return;
  }

  body.innerHTML = loadingHtml('Carregando métricas do LinkedIn…');

  try {
    const [pageStats, posts] = await Promise.all([
      fetchPageStats(cfg),
      fetchPosts(cfg),
    ]);
    renderDashboard(body, pageStats, posts, cfg);
  } catch(e) {
    if (e.message?.includes('401') || e.message?.includes('token')) {
      body.innerHTML = `
        <div class="card" style="padding:40px;text-align:center;">
          <div style="font-size:2rem;margin-bottom:12px;">⚠</div>
          <div style="font-weight:700;margin-bottom:8px;">Token expirado</div>
          <div style="color:var(--text-muted);font-size:0.875rem;margin-bottom:20px;">
            O token do LinkedIn expirou. Reconecte para continuar.
          </div>
          <button class="btn btn-primary btn-sm" onclick="startOAuth()">Reconectar LinkedIn</button>
        </div>`;
    } else {
      body.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-muted);">
        Erro: ${esc(e.message)}</div>`;
    }
  }
}

/* ─── OAuth ───────────────────────────────────────────────── */
function renderConnectPrompt(container) {
  container.innerHTML = `
    <div class="card" style="padding:48px;text-align:center;max-width:480px;margin:0 auto;">
      <div style="font-size:3rem;margin-bottom:16px;">◈</div>
      <div style="font-weight:700;font-size:1.125rem;margin-bottom:8px;">
        Conectar ao LinkedIn</div>
      <div style="color:var(--text-muted);font-size:0.875rem;margin-bottom:24px;line-height:1.6;">
        Autorize o acesso à company page PRIMETOUR para visualizar métricas
        e publicar conteúdo diretamente pelo sistema.
      </div>
      <button id="li-connect-btn" class="btn btn-primary">
        Conectar com LinkedIn
      </button>
      <div style="margin-top:16px;font-size:0.75rem;color:var(--text-muted);">
        Permissões solicitadas: leitura de métricas e publicação na company page
      </div>
    </div>
  `;
  document.getElementById('li-connect-btn')?.addEventListener('click', startOAuth);
}

function startOAuth() {
  const scope = [
    'r_organization_social',
    'w_organization_social',
    'r_basicprofile',
    'rw_organization_admin',
  ].join('%20');

  const authUrl = `https://www.linkedin.com/oauth/v2/authorization`
    + `?response_type=code`
    + `&client_id=${LI_CLIENT_ID}`
    + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
    + `&state=linkedin_oauth`
    + `&scope=${scope}`;

  window.location.href = authUrl;
}

export async function handleLinkedinOAuth(code, container) {
  container.innerHTML = `<div class="page-header">
    <div class="page-header-left">
      <h1 class="page-title">LinkedIn</h1>
    </div>
  </div>
  <div id="li-body">${loadingHtml('Autenticando com LinkedIn…')}</div>`;

  try {
    // Exchange code for token via Cloudflare Worker (keeps client_secret safe)
    const resp = await fetch(`${AI_WORKER_URL}/linkedin-oauth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Token': AI_WORKER_TOKEN },
      body: JSON.stringify({ code, redirectUri: REDIRECT_URI }),
    });

    if (!resp.ok) throw new Error('Falha na troca do código OAuth.');
    const data = await resp.json();

    // Save token to Firestore
    const cfg = await getLinkedinConfig() || {};
    await setDoc(doc(db, 'ai_settings', 'linkedin_config'), {
      ...cfg,
      accessToken:  data.access_token,
      expiresAt:    new Date(Date.now() + (data.expires_in || 5183999) * 1000).toISOString(),
      updatedAt:    serverTimestamp(),
    }, { merge: true });

    toast.success('LinkedIn conectado com sucesso!');
    await loadData(container);
  } catch(e) {
    const body = document.getElementById('li-body');
    if (body) body.innerHTML = `<div style="padding:40px;text-align:center;color:#EF4444;">
      Erro ao autenticar: ${esc(e.message)}</div>`;
  }
}

/* ─── API calls ───────────────────────────────────────────── */
async function getLinkedinConfig() {
  try {
    const snap = await getDoc(doc(db, 'ai_settings', 'linkedin_config'));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
}

async function liGet(path, token) {
  // All LinkedIn API calls go through the Cloudflare Worker to avoid CORS
  const res = await fetch(`${AI_WORKER_URL}/linkedin-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type':   'application/json',
      'X-Worker-Token': AI_WORKER_TOKEN,
    },
    body: JSON.stringify({ path, token }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Worker ${res.status}`);
  }
  return res.json();
}

async function fetchPageStats(cfg) {
  const token = cfg.accessToken;
  const orgId = cfg.organizationId?.replace('urn:li:organization:', '');
  if (!orgId) return null;

  try {
    const [followers, stats] = await Promise.all([
      liGet(`/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(cfg.organizationId)}`, token),
      liGet(`/organizationPageStatistics?q=organization&organization=${encodeURIComponent(cfg.organizationId)}`, token),
    ]);
    return { followers, stats };
  } catch { return null; }
}

async function fetchPosts(cfg) {
  const token = cfg.accessToken;
  if (!cfg.organizationId) return [];
  try {
    const data = await liGet(
      `/ugcPosts?q=authors&authors=List(${encodeURIComponent(cfg.organizationId)})&count=20`,
      token
    );
    return data.elements || [];
  } catch { return []; }
}

/* ─── Render ──────────────────────────────────────────────── */
function renderDashboard(container, pageStats, posts, cfg) {
  const followers = pageStats?.followers?.elements?.[0]?.followerCountsByAssociationType
    ?.find(f => f.associationType === 'FOLLOWER')?.followerCounts?.organicFollowerCount || 0;

  const totalImpressions = posts.reduce((a, p) => {
    return a + (p.specificContent?.['com.linkedin.ugc.ShareContent']?.shareStatistics?.impressionCount || 0);
  }, 0);
  const totalEngagement  = posts.reduce((a, p) => {
    return a + (p.specificContent?.['com.linkedin.ugc.ShareContent']?.shareStatistics?.likeCount || 0)
             + (p.specificContent?.['com.linkedin.ugc.ShareContent']?.shareStatistics?.commentCount || 0);
  }, 0);

  const expiresAt = cfg.expiresAt ? new Date(cfg.expiresAt) : null;
  const daysLeft  = expiresAt ? Math.ceil((expiresAt - Date.now()) / 86400_000) : null;

  container.innerHTML = `
    <!-- Token status -->
    ${daysLeft !== null ? `
      <div style="margin-bottom:16px;padding:10px 14px;border-radius:var(--radius-sm);
        font-size:0.8125rem;
        ${daysLeft < 7
          ? 'background:#EF444412;border:1px solid #EF444330;color:#EF4444;'
          : daysLeft < 30
            ? 'background:#F59E0B12;border:1px solid #F59E0B30;color:#F59E0B;'
            : 'background:#22C55E12;border:1px solid #22C55E30;color:#22C55E;'}">
        ${daysLeft < 7
          ? `⚠ Token expira em ${daysLeft} dia${daysLeft!==1?'s':''} — reconecte em breve`
          : daysLeft < 30
            ? `◷ Token válido por mais ${daysLeft} dias`
            : `✓ Token válido por mais ${daysLeft} dias`}
      </div>` : ''}

    <!-- KPIs -->
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));
      gap:12px;margin-bottom:24px;">
      ${kpi('Seguidores',    num(followers),        '◎')}
      ${kpi('Impressões',    num(totalImpressions), '◷', 'posts recentes')}
      ${kpi('Engajamento',   num(totalEngagement),  '★', 'likes + comentários')}
      ${kpi('Posts',         posts.length,          '◈', 'carregados')}
    </div>

    <!-- Posts table -->
    <div class="card" style="padding:0;overflow:hidden;">
      <div style="padding:16px 20px;border-bottom:1px solid var(--border-subtle);
        font-size:0.875rem;font-weight:700;">Posts recentes</div>
      ${posts.length === 0
        ? `<div style="padding:48px;text-align:center;color:var(--text-muted);">
            Nenhum post encontrado para esta conta.</div>`
        : `<table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
            <thead><tr style="background:var(--bg-surface);">
              ${['Data','Conteúdo','Impressões','Likes','Comentários','Shares'].map(h =>
                `<th style="${TH}">${h}</th>`).join('')}
            </tr></thead>
            <tbody>
              ${posts.map(post => {
                const share  = post.specificContent?.['com.linkedin.ugc.ShareContent'];
                const stats  = share?.shareStatistics || {};
                const text   = share?.shareCommentary?.text || '—';
                const date   = post.created?.time
                  ? new Date(post.created.time).toLocaleDateString('pt-BR') : '—';
                return `<tr style="border-bottom:1px solid var(--border-subtle);
                  transition:background .1s;"
                  onmouseover="this.style.background='var(--bg-surface)'"
                  onmouseout="this.style.background=''">
                  <td style="padding:10px 14px;white-space:nowrap;color:var(--text-muted);
                    font-size:0.8125rem;">${date}</td>
                  <td style="padding:10px 14px;max-width:300px;">
                    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
                      font-size:0.875rem;">${esc(text.slice(0,120))}${text.length>120?'…':''}</div>
                  </td>
                  <td style="padding:10px 14px;text-align:right;font-weight:600;">
                    ${num(stats.impressionCount)}</td>
                  <td style="padding:10px 14px;text-align:right;">
                    ${num(stats.likeCount)}</td>
                  <td style="padding:10px 14px;text-align:right;">
                    ${num(stats.commentCount)}</td>
                  <td style="padding:10px 14px;text-align:right;">
                    ${num(stats.shareCount)}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>`}
    </div>
  `;
}

/* ─── Helpers ─────────────────────────────────────────────── */
const TH = `padding:10px 14px;text-align:left;font-size:0.6875rem;font-weight:700;
  text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted);
  border-bottom:1px solid var(--border-subtle);white-space:nowrap;`;

function kpi(label, value, icon, sub = '') {
  return `<div class="card" style="padding:16px;">
    <div style="font-size:1.25rem;margin-bottom:6px;">${icon}</div>
    <div style="font-size:1.625rem;font-weight:800;line-height:1;">${value}</div>
    <div style="font-size:0.75rem;color:var(--text-secondary);margin-top:4px;">${label}</div>
    ${sub ? `<div style="font-size:0.6875rem;color:var(--text-muted);">${sub}</div>` : ''}
  </div>`;
}

function loadingHtml(msg) {
  return `<div style="text-align:center;padding:48px;color:var(--text-muted);">
    <div class="spinner" style="width:28px;height:28px;border:3px solid var(--border-subtle);
      border-top-color:var(--brand-gold);border-radius:50%;animation:spin .8s linear infinite;
      margin:0 auto 12px;"></div>${esc(msg)}</div>`;
}
