/**
 * PRIMETOUR — Landing Pages
 * Gerador de landing pages de campanha com link público
 */

import { store } from '../store.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function renderLandingPages(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Landing Pages</h1>
        <p class="page-subtitle">Gerador de páginas de campanha com link público</p>
      </div>
    </div>

    <div style="max-width:720px;margin:0 auto;padding:40px 0;">

      <!-- Status badge -->
      <div style="display:inline-flex;align-items:center;gap:8px;padding:6px 14px;
        background:var(--brand-gold)12;border:1px solid var(--brand-gold)30;
        border-radius:var(--radius-full);margin-bottom:32px;">
        <span style="width:7px;height:7px;border-radius:50%;background:var(--brand-gold);"></span>
        <span style="font-size:0.75rem;font-weight:600;color:var(--brand-gold);letter-spacing:.05em;">
          Em desenvolvimento
        </span>
      </div>

      <!-- Vision -->
      <div class="card" style="padding:28px 32px;margin-bottom:20px;">
        <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.12em;color:var(--brand-gold);margin-bottom:14px;">
          Visão do módulo
        </div>
        <p style="font-size:0.9375rem;color:var(--text-secondary);line-height:1.75;margin-bottom:16px;">
          Crie landing pages de campanha com link público compartilhável — sem depender de equipe técnica. 
          Cada página combina seções configuráveis com o conteúdo já cadastrado no sistema.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:20px;">
          ${[
            ['◱', 'Templates de seções', 'Hero, galeria de destinos, depoimentos, formulário de captação, CTA, rodapé'],
            ['◈', 'Fontes de dados', 'Dicas do Portal, Banco de Imagens e conteúdo exclusivo por campanha'],
            ['🔗', 'Link público', 'URL exclusiva por campanha, com analytics de visualizações e cliques'],
            ['✎', 'Editor visual', 'Montagem por blocos com preview em tempo real antes de publicar'],
          ].map(([icon, title, desc]) => `
            <div style="padding:16px;background:var(--bg-surface);border-radius:var(--radius-md);
              border:1px solid var(--border-subtle);">
              <div style="font-size:1.125rem;margin-bottom:8px;">${icon}</div>
              <div style="font-weight:600;font-size:0.875rem;margin-bottom:4px;">${esc(title)}</div>
              <div style="font-size:0.8125rem;color:var(--text-muted);line-height:1.5;">${esc(desc)}</div>
            </div>`).join('')}
        </div>
      </div>

      <!-- Architecture -->
      <div class="card" style="padding:28px 32px;margin-bottom:20px;">
        <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.12em;color:var(--text-muted);margin-bottom:14px;">
          Arquitetura planejada
        </div>
        <div style="font-size:0.8125rem;color:var(--text-muted);line-height:1.8;">
          <div style="margin-bottom:8px;">
            <strong style="color:var(--text-primary);">Armazenamento</strong> — 
            Coleção <code>landing_pages</code> no Firestore com blocos de conteúdo em JSON.
            Imagens via Banco de Imagens (R2). Dicas vinculadas por ID do Portal.
          </div>
          <div style="margin-bottom:8px;">
            <strong style="color:var(--text-primary);">Publicação</strong> — 
            Mesma lógica do <code>portal-view.html</code>: token único → URL pública → 
            renderização client-side a partir do Firestore.
          </div>
          <div style="margin-bottom:8px;">
            <strong style="color:var(--text-primary);">Templates de seção</strong> — 
            Hero com imagem full-width, grade de destinos, carrossel de fotos, 
            bloco de texto rico, depoimentos, formulário de lead, CTA com botão.
          </div>
          <div>
            <strong style="color:var(--text-primary);">Analytics</strong> — 
            Contador de views, rastreamento de cliques em CTAs, exportação de leads captados.
          </div>
        </div>
      </div>

      <!-- Roadmap -->
      <div style="padding:20px 24px;background:var(--bg-surface);border-radius:var(--radius-md);
        border-left:3px solid var(--brand-gold)40;">
        <div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);margin-bottom:12px;">
          Para ativar este módulo, informe ao desenvolvedor:
        </div>
        <div style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.8;">
          • Quais tipos de campanha são mais frequentes (destino único, multi-destino, temática de data)
          <br>• Se é necessário formulário de captação de leads integrado
          <br>• Se as páginas precisam de domínio próprio ou subdomínio da PRIMETOUR
          <br>• Número estimado de landing pages simultâneas ativas
        </div>
      </div>

    </div>`;
}
