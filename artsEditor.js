/**
 * PRIMETOUR — Editor de Artes
 * Central de criação de peças para redes sociais e comunicados internos
 */

import { store } from '../store.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function renderArtsEditor(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Editor de Artes</h1>
        <p class="page-subtitle">Templates para redes sociais e comunicados internos</p>
      </div>
    </div>

    <div style="max-width:720px;margin:0 auto;padding:40px 0;">

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
          letter-spacing:.12em;color:var(--brand-gold);margin-bottom:14px;">Visão do módulo</div>
        <p style="font-size:0.9375rem;color:var(--text-secondary);line-height:1.75;margin-bottom:20px;">
          Central de criação de peças visuais com templates profissionais criados pelo time de design. 
          O usuário escolhe o template, preenche os campos de texto e imagem, e baixa o arquivo 
          pronto em PNG/JPG — sem precisar de Canva, Photoshop ou qualquer ferramenta externa.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          ${[
            ['▣', 'Templates por categoria', 'Feed Instagram, Stories, LinkedIn, WhatsApp, comunicado interno, cartaz, email banner'],
            ['🖼', 'Banco de Imagens integrado', 'Acesso direto ao R2 para escolher fotos de destinos como imagem de fundo ou destaque'],
            ['✍', 'Conteúdo das Dicas', 'Importa textos de atrativos, restaurantes e highlights direto do Portal de Dicas'],
            ['🎨', 'Paleta por BU', 'Cada área (BTG, Centurion, Lazer...) tem sua identidade aplicada automaticamente'],
            ['⬇', 'Export PNG/JPG', 'Download em alta resolução pronto para publicar ou enviar'],
            ['📐', 'Zonas editáveis', 'Design cria o template com áreas de texto e imagem definidas — usuário só preenche'],
          ].map(([icon, title, desc]) => `
            <div style="padding:16px;background:var(--bg-surface);border-radius:var(--radius-md);
              border:1px solid var(--border-subtle);">
              <div style="font-size:1.125rem;margin-bottom:8px;">${icon}</div>
              <div style="font-weight:600;font-size:0.875rem;margin-bottom:4px;">${esc(title)}</div>
              <div style="font-size:0.8125rem;color:var(--text-muted);line-height:1.5;">${esc(desc)}</div>
            </div>`).join('')}
        </div>
      </div>

      <!-- Template categories -->
      <div class="card" style="padding:28px 32px;margin-bottom:20px;">
        <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.12em;color:var(--text-muted);margin-bottom:14px;">
          Categorias de templates planejadas
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:8px;">
          ${[
            'Feed Instagram (1:1)', 'Feed Instagram (4:5)', 'Stories (9:16)',
            'LinkedIn (1.91:1)', 'WhatsApp (1:1)', 'WhatsApp Comunicado',
            'Email Banner', 'Cartaz A4', 'Cartaz A3',
            'Fundo de Tela', 'Destaque de Destino', 'Promoção / Oferta',
          ].map(t => `<span style="padding:4px 12px;background:var(--bg-surface);
            border:1px solid var(--border-subtle);border-radius:var(--radius-full);
            font-size:0.75rem;color:var(--text-secondary);">${esc(t)}</span>`).join('')}
        </div>
      </div>

      <!-- Architecture -->
      <div class="card" style="padding:28px 32px;margin-bottom:20px;">
        <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.12em;color:var(--text-muted);margin-bottom:14px;">Arquitetura planejada</div>
        <div style="font-size:0.8125rem;color:var(--text-muted);line-height:1.9;">
          <div style="margin-bottom:8px;">
            <strong style="color:var(--text-primary);">Engine de renderização</strong> — 
            Fabric.js ou Konva.js para composição de layers no canvas do browser. 
            Cada template é um JSON com camadas (imagem de fundo, texto, logo, moldura) 
            e as zonas editáveis marcadas com tipo e restrições.
          </div>
          <div style="margin-bottom:8px;">
            <strong style="color:var(--text-primary);">Cadastro de templates (design)</strong> — 
            Interface separada onde o design faz upload do arquivo base (PNG transparente ou 
            JSON de layers), define zonas de texto (posição, fonte, tamanho máx, cor), 
            zonas de imagem (máscara, proporção) e vincula à BU e categoria.
          </div>
          <div style="margin-bottom:8px;">
            <strong style="color:var(--text-primary);">Fontes customizadas</strong> — 
            Upload de arquivos .woff2/.ttf no Firestore/R2. Carregadas via FontFace API 
            antes da renderização para garantir fidelidade ao template original.
          </div>
          <div style="margin-bottom:8px;">
            <strong style="color:var(--text-primary);">Coleções Firestore</strong> — 
            <code>arts_templates</code> (templates), <code>arts_generations</code> (histórico), 
            <code>arts_fonts</code> (fontes cadastradas).
          </div>
          <div>
            <strong style="color:var(--text-primary);">Export</strong> — 
            <code>canvas.toBlob('image/png')</code> ou <code>image/jpeg</code> com qualidade configurável. 
            Dimensão real (ex: 1080×1080px) independente do tamanho exibido na tela.
          </div>
        </div>
      </div>

      <!-- Design workflow -->
      <div class="card" style="padding:28px 32px;margin-bottom:20px;">
        <div style="font-size:0.625rem;font-weight:700;text-transform:uppercase;
          letter-spacing:.12em;color:var(--text-muted);margin-bottom:14px;">
          Fluxo de trabalho planejado
        </div>
        <div style="display:flex;flex-direction:column;gap:0;">
          ${[
            ['Design cadastra template', 'Upload do arquivo base + definição de zonas editáveis + metadados (BU, categoria, dimensões)'],
            ['Usuário escolhe template', 'Filtra por categoria (Stories, Feed, WhatsApp...) e BU — vê preview com campos em branco'],
            ['Preenche os campos', 'Digita o texto nas zonas, escolhe imagem do Banco de Imagens ou faz upload pontual'],
            ['Ajusta e importa conteúdo', 'Opcional: importa texto de uma Dica Cadastrada (atração, restaurante, highlight)'],
            ['Baixa a arte', 'Export em PNG/JPG em alta resolução — histórico salvo em arts_generations'],
          ].map(([step, desc], i) => `
            <div style="display:flex;gap:14px;padding:14px 0;
              ${i < 4 ? 'border-bottom:1px solid var(--border-subtle)' : ''}">
              <div style="width:24px;height:24px;border-radius:50%;background:var(--brand-gold);
                color:#fff;font-size:0.6875rem;font-weight:700;display:flex;align-items:center;
                justify-content:center;flex-shrink:0;margin-top:1px;">${i+1}</div>
              <div>
                <div style="font-weight:600;font-size:0.875rem;margin-bottom:3px;">${esc(step)}</div>
                <div style="font-size:0.8125rem;color:var(--text-muted);line-height:1.5;">${esc(desc)}</div>
              </div>
            </div>`).join('')}
        </div>
      </div>

      <div style="padding:20px 24px;background:var(--bg-surface);border-radius:var(--radius-md);
        border-left:3px solid var(--brand-gold)40;">
        <div style="font-size:0.75rem;font-weight:600;color:var(--text-muted);margin-bottom:12px;">
          Para ativar este módulo, informe ao desenvolvedor:
        </div>
        <div style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.8;">
          • Quais formatos são prioritários (Stories? Feed? WhatsApp?)
          <br>• Quais fontes são usadas pela identidade visual de cada BU
          <br>• Se o design vai criar os templates em formato de arquivo ou via interface no sistema
          <br>• Se é necessário aprovação antes da arte ser publicada/enviada
          <br>• Estimativa de templates iniciais por categoria
        </div>
      </div>

    </div>`;
}
