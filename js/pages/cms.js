/**
 * PRIMETOUR — CMS / Site Oficial
 * Gestão de páginas estáticas e blog com foco em SEO
 */

import { store } from '../store.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function renderCms(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">CMS / Site Oficial</h1>
        <p class="page-subtitle">Gestão de páginas e blog com SEO técnico avançado</p>
      </div>
    </div>

    <div style="max-width:720px;margin:0 auto;padding:40px 0;">

      <div style="display:inline-flex;align-items:center;gap:8px;padding:6px 14px;
        background:var(--brand-gold)12;border:1px solid var(--brand-gold)30;
        border-radius:var(--radius-full);margin-bottom:32px;">
        <span style="width:7px;height:7px;border-radius:50%;background:var(--brand-gold);"></span>
        <span style="font-size:0.75rem;font-weight:600;color:var(--brand-gold);letter-spacing:.05em;">
          Em desenvolvimento — requer decisão arquitetural
        </span>
      </div>

      <!-- Vision -->
      <div class="card" style="padding:28px 32px;margin-bottom:20px;">
        <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.12em;color:var(--brand-gold);margin-bottom:14px;">Visão do módulo</div>
        <p style="font-size:0.9375rem;color:var(--text-secondary);line-height:1.75;margin-bottom:20px;">
          Substitui o WordPress como sistema de gestão do site oficial da PRIMETOUR. 
          Gerencia páginas institucionais, landing pages de destino e blog com foco em 
          performance e SEO técnico — tudo dentro do hub de marketing.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          ${[
            ['◫', 'Páginas estáticas', 'Sobre, Quem Somos, Contato, páginas de destino — editáveis por blocos'],
            ['✍', 'Blog completo', 'Editor rico, categorias, tags, autores, agendamento de publicação'],
            ['🔍', 'SEO técnico', 'Meta tags, Open Graph, Schema.org, sitemap automático, canonical URLs'],
            ['⚡', 'Performance', 'Imagens otimizadas via R2, lazy loading, Core Web Vitals monitorados'],
            ['🤖', 'IA integrada', 'Pesquisa de palavras-chave, sugestão de pautas, otimização de títulos/meta'],
            ['🔄', 'Tempo real', 'Publicação instantânea sem deploy manual — conteúdo via Firestore + CDN'],
          ].map(([icon, title, desc]) => `
            <div style="padding:16px;background:var(--bg-surface);border-radius:var(--radius-md);
              border:1px solid var(--border-subtle);">
              <div style="font-size:1.125rem;margin-bottom:8px;">${icon}</div>
              <div style="font-weight:600;font-size:0.875rem;margin-bottom:4px;">${esc(title)}</div>
              <div style="font-size:0.8125rem;color:var(--text-muted);line-height:1.5;">${esc(desc)}</div>
            </div>`).join('')}
        </div>
      </div>

      <!-- Decision required -->
      <div class="card" style="padding:28px 32px;margin-bottom:20px;
        border-left:3px solid #F59E0B;">
        <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.12em;color:#F59E0B;margin-bottom:14px;">
          ⚠ Decisão arquitetural necessária antes de construir
        </div>
        <p style="font-size:0.875rem;color:var(--text-secondary);line-height:1.7;margin-bottom:16px;">
          Um CMS com atualização em tempo real não pode ser servido pelo GitHub Pages 
          (que é puramente estático). Há duas abordagens viáveis:
        </p>
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div style="padding:16px;background:var(--bg-surface);border-radius:var(--radius-md);
            border:1px solid var(--border-subtle);">
            <div style="font-weight:600;font-size:0.875rem;margin-bottom:6px;color:var(--brand-gold);">
              Opção A — Cloudflare Workers + D1 (recomendado)
            </div>
            <div style="font-size:0.8125rem;color:var(--text-muted);line-height:1.6;">
              O site é servido por um Worker que busca o conteúdo do Firestore/D1 em tempo real. 
              Domínio próprio configurado no Cloudflare. SSR (Server-Side Rendering) para SEO perfeito. 
              Custo: praticamente zero no plano free do Cloudflare.
            </div>
          </div>
          <div style="padding:16px;background:var(--bg-surface);border-radius:var(--radius-md);
            border:1px solid var(--border-subtle);">
            <div style="font-weight:600;font-size:0.875rem;margin-bottom:6px;">
              Opção B — Geração estática com deploy automático
            </div>
            <div style="font-size:0.8125rem;color:var(--text-muted);line-height:1.6;">
              Ao publicar um artigo, um GitHub Action gera o HTML estático e faz deploy. 
              Mais simples, mas publicação demora ~2 minutos e atualizações em tempo real 
              não são possíveis. Adequado para blog com publicação planejada.
            </div>
          </div>
        </div>
      </div>

      <!-- Architecture -->
      <div class="card" style="padding:28px 32px;margin-bottom:20px;">
        <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.12em;color:var(--text-muted);margin-bottom:14px;">Arquitetura planejada</div>
        <div style="font-size:0.8125rem;color:var(--text-muted);line-height:1.9;">
          <div style="margin-bottom:8px;">
            <strong style="color:var(--text-primary);">Coleções Firestore</strong> — 
            <code>cms_pages</code> (páginas), <code>cms_posts</code> (blog), 
            <code>cms_categories</code>, <code>cms_authors</code>, <code>cms_settings</code> (SEO global)
          </div>
          <div style="margin-bottom:8px;">
            <strong style="color:var(--text-primary);">Editor de conteúdo</strong> — 
            Editor rico baseado em blocos (similar ao Gutenberg): texto, imagem, destaque, citação, 
            galeria, embed de vídeo, CTA, bloco de dica do Portal.
          </div>
          <div style="margin-bottom:8px;">
            <strong style="color:var(--text-primary);">SEO por artigo</strong> — 
            Título SEO, meta description, slug customizável, imagem OG, canonical, 
            palavras-chave alvo, score de otimização calculado em tempo real.
          </div>
          <div style="margin-bottom:8px;">
            <strong style="color:var(--text-primary);">IA para SEO</strong> — 
            Pesquisa de volume de busca por palavra-chave, sugestão de pautas por tendência, 
            análise de concorrentes, pontuação de legibilidade e densidade de keywords.
          </div>
          <div>
            <strong style="color:var(--text-primary);">Sitemap + Schema</strong> — 
            Geração automática de <code>sitemap.xml</code> e markup Schema.org para artigos, 
            páginas de destino (TravelDestination), empresa (Organization) e breadcrumbs.
          </div>
        </div>
      </div>

      <div style="padding:20px 24px;background:var(--bg-surface);border-radius:var(--radius-md);
        border-left:3px solid var(--brand-gold)40;">
        <div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);margin-bottom:12px;">
          Para ativar este módulo, informe ao desenvolvedor:
        </div>
        <div style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.8;">
          • Qual opção de arquitetura (A ou B) é preferida
          <br>• Domínio do site oficial da PRIMETOUR
          <br>• Quantidade aproximada de páginas estáticas existentes no WordPress
          <br>• Quantidade de posts no blog atual a migrar
          <br>• Se há formulários de contato/cotação a replicar
        </div>
      </div>

    </div>`;
}
