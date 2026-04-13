/**
 * PRIMETOUR — Portal de Dicas: Manual de Importação
 * Guia completo em tela para uso da importação em massa
 */
import { store } from '../store.js';

export async function renderPortalImportManual(container) {
  if (!store.can('portal_manage') && !store.isMaster()) {
    container.innerHTML = `<div class="empty-state"><span style="font-size:2rem;">🔒</span><p>Acesso restrito</p><p class="text-muted">Você não tem permissão para acessar o Manual de Importação.</p></div>`;
    return;
  }
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Manual de Importação</h1>
        <p class="page-subtitle">Como importar dicas em massa via planilha Excel</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary btn-sm" onclick="location.hash='portal-import'">
          ↑ Ir para Importação
        </button>
      </div>
    </div>

    <div style="max-width:820px;display:flex;flex-direction:column;gap:20px;">

      <!-- Visão geral -->
      <div class="card" style="padding:28px;">
        <h2 style="font-size:1rem;font-weight:700;margin:0 0 12px;display:flex;align-items:center;gap:8px;">
          <span style="background:var(--brand-gold);color:#000;width:24px;height:24px;border-radius:50%;
            display:inline-flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;
            flex-shrink:0;">1</span>
          Visão Geral
        </h2>
        <p style="font-size:0.9375rem;line-height:1.7;color:var(--text-secondary);margin:0 0 12px;">
          A importação em massa permite cadastrar ou atualizar dicas de múltiplos destinos simultaneamente,
          usando arquivos <strong>.xlsx</strong> (Excel). Você pode enviar <strong>vários arquivos de uma vez</strong>.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
          ${['📊 Baixe a planilha modelo', '✏️ Preencha os dados', '⬆ Faça o upload'].map((s,i)=>`
            <div style="padding:14px;background:var(--bg-surface);border-radius:var(--radius-md);
              text-align:center;font-size:0.875rem;font-weight:600;">
              <div style="font-size:1.5rem;margin-bottom:6px;">${s.split(' ')[0]}</div>
              ${s.split(' ').slice(1).join(' ')}
            </div>`).join('')}
        </div>
      </div>

      <!-- Estrutura do arquivo -->
      <div class="card" style="padding:28px;">
        <h2 style="font-size:1rem;font-weight:700;margin:0 0 16px;display:flex;align-items:center;gap:8px;">
          <span style="background:var(--brand-gold);color:#000;width:24px;height:24px;border-radius:50%;
            display:inline-flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;
            flex-shrink:0;">2</span>
          Estrutura da Planilha
        </h2>
        <p style="font-size:0.875rem;color:var(--text-secondary);margin:0 0 16px;line-height:1.6;">
          A planilha modelo contém <strong>3 abas</strong>:
        </p>

        <div style="display:flex;flex-direction:column;gap:14px;">
          ${[
            {
              aba: '📋 Dicas',
              desc: 'Aba principal. Uma linha por item (restaurante, atração, etc.).',
              cols: [
                ['destino_continente','Obrigatório','Europa, Brasil, Ásia…'],
                ['destino_pais','Obrigatório','França, Japão, Brasil…'],
                ['destino_cidade','Opcional','Paris, Kyoto… (vazio = nível país)'],
                ['segmento','Obrigatório','Nome do segmento (ver aba Referência)'],
                ['categoria','Recomendado','Ex: Museus e centros culturais, Cafés e bistrôs'],
                ['titulo','Obrigatório','Nome do local ou item'],
                ['descricao','Opcional','Descrição do item'],
                ['endereco','Opcional','Endereço completo'],
                ['telefone','Opcional','Número com DDD/DDI'],
                ['site','Opcional','URL completa (https://…)'],
                ['observacoes','Opcional','Dicas extras, horários, preços…'],
                ['periodo','Só Agenda Cultural','Ex: 10/04 a 30/08/2026'],
              ],
            },
            {
              aba: '📊 Informações Gerais',
              desc: 'Uma linha por destino. Dados estruturais (população, clima, etc.).',
              cols: [
                ['continente','Obrigatório',''],
                ['pais','Obrigatório',''],
                ['cidade','Opcional',''],
                ['descricao','Opcional','Texto livre sobre o destino'],
                ['populacao','Opcional','Ex: 2.161.000 habitantes'],
                ['moeda','Opcional','Ex: Euro (€)'],
                ['lingua','Opcional',''],
                ['religiao','Opcional',''],
                ['voltagem','Opcional','110V ou 220V'],
                ['ddd','Opcional','Ex: +33'],
                ['clima_max_Jan … clima_min_Dez','Opcional','Temperaturas em °C por mês'],
              ],
            },
            {
              aba: '📖 Referência',
              desc: 'Lista de todos os segmentos e suas categorias. Não edite esta aba.',
              cols: [],
            },
          ].map(tab => `
            <div style="border:1px solid var(--border-subtle);border-radius:var(--radius-md);overflow:hidden;">
              <div style="padding:12px 16px;background:var(--bg-surface);font-weight:700;font-size:0.9375rem;">
                ${tab.aba}
              </div>
              <div style="padding:12px 16px;">
                <p style="font-size:0.875rem;color:var(--text-secondary);margin:0 0 ${tab.cols.length?'12px':'0'};">
                  ${tab.desc}
                </p>
                ${tab.cols.length ? `
                  <table style="width:100%;border-collapse:collapse;font-size:0.8125rem;">
                    ${tab.cols.map(([col,req,ex]) => `
                      <tr style="border-bottom:1px solid var(--border-subtle);">
                        <td style="padding:6px 8px;font-family:monospace;color:var(--brand-gold);white-space:nowrap;">${col}</td>
                        <td style="padding:6px 8px;color:${req==='Obrigatório'?'#EF4444':req==='Recomendado'?'#F59E0B':'var(--text-muted)'};font-size:0.75rem;white-space:nowrap;">${req}</td>
                        <td style="padding:6px 8px;color:var(--text-muted);">${ex}</td>
                      </tr>`).join('')}
                  </table>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Regras importantes -->
      <div class="card" style="padding:28px;">
        <h2 style="font-size:1rem;font-weight:700;margin:0 0 16px;display:flex;align-items:center;gap:8px;">
          <span style="background:var(--brand-gold);color:#000;width:24px;height:24px;border-radius:50%;
            display:inline-flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;
            flex-shrink:0;">3</span>
          Regras e Dicas
        </h2>
        <div style="display:flex;flex-direction:column;gap:10px;">
          ${[
            ['✅','O destino (país/cidade) precisa estar cadastrado no sistema antes da importação. Cadastre em Destinos.'],
            ['✅','Uma linha = um item. Para 20 restaurantes, adicione 20 linhas com segmento = "Restaurantes".'],
            ['✅','Bairros e Arredores: use apenas os campos titulo e descricao. Os outros são ignorados.'],
            ['✅','A importação é aditiva: novos itens são adicionados aos já existentes, sem apagar o que já está cadastrado.'],
            ['⚠️','Nomes de segmentos devem corresponder exatamente à lista na aba Referência (o sistema faz correspondência flexível, mas quanto mais preciso, melhor).'],
            ['⚠️','Sites e links devem incluir https:// para ficarem clicáveis nos documentos gerados.'],
            ['⚠️','Temperaturas de clima: use apenas números (ex: 22, -5). Não inclua o símbolo °C na célula.'],
            ['📌','Você pode enviar vários arquivos de uma vez. Cada arquivo pode conter múltiplos destinos.'],
            ['📌','Após o upload, o sistema mostrará um resumo para revisão antes de confirmar a importação.'],
          ].map(([icon, text]) => `
            <div style="display:flex;gap:10px;align-items:flex-start;font-size:0.875rem;">
              <span style="flex-shrink:0;font-size:1rem;">${icon}</span>
              <span style="color:var(--text-secondary);line-height:1.6;">${text}</span>
            </div>`).join('')}
        </div>
      </div>

      <!-- Passo a passo -->
      <div class="card" style="padding:28px;">
        <h2 style="font-size:1rem;font-weight:700;margin:0 0 16px;display:flex;align-items:center;gap:8px;">
          <span style="background:var(--brand-gold);color:#000;width:24px;height:24px;border-radius:50%;
            display:inline-flex;align-items:center;justify-content:center;font-size:0.75rem;font-weight:700;
            flex-shrink:0;">4</span>
          Passo a Passo
        </h2>
        <ol style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:10px;">
          ${[
            'Certifique-se que os destinos (país/cidade) já estão cadastrados em <strong>Destinos</strong>.',
            'Clique em <strong>Baixar Planilha Modelo</strong> na tela de Importação.',
            'Preencha a aba <strong>Dicas</strong> com os itens de cada segmento. Consulte a aba <strong>Referência</strong> para ver os nomes exatos.',
            'Se quiser importar Informações Gerais, preencha também a aba correspondente.',
            'Salve o arquivo. Para múltiplos destinos, você pode usar um único arquivo ou arquivos separados por destino.',
            'Na tela de Importação, arraste os arquivos ou clique para selecioná-los.',
            'Revise o <strong>resumo de mapeamento</strong> que o sistema apresenta.',
            'Clique em <strong>Confirmar e Importar</strong>.',
            'Acompanhe o log em tempo real. Erros são destacados em vermelho.',
          ].map(step => `<li style="font-size:0.875rem;color:var(--text-secondary);line-height:1.6;">${step}</li>`).join('')}
        </ol>
      </div>

      <div style="text-align:center;padding:8px;">
        <button class="btn btn-primary" onclick="location.hash='portal-import'">
          ✈ Ir para a tela de Importação
        </button>
      </div>

    </div>
  `;
}
