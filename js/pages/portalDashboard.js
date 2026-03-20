/**
 * PRIMETOUR — Portal de Dicas: Dashboard
 * Métricas de uso, conteúdo e imagens (implementação completa no E9)
 */
import { store } from '../store.js';

export async function renderPortalDashboard(container) {
  if (!store.canManagePortal()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Dashboard — Portal de Dicas</h1>
        <p class="page-subtitle">Análise de uso, conteúdo e banco de imagens</p>
      </div>
    </div>
    <div style="padding:48px;text-align:center;color:var(--text-muted);">
      <div style="font-size:2rem;margin-bottom:12px;">📊</div>
      <div style="font-size:1rem;font-weight:600;margin-bottom:8px;">Dashboard em construção</div>
      <div style="font-size:0.875rem;">Disponível no Estágio E9.</div>
    </div>
  `;
}
