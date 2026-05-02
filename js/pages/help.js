/**
 * PRIMETOUR — Página de Ajuda
 *
 * Lista de tours guiados disponíveis (com status feito/pendente),
 * atalhos de teclado, FAQ rápido e links úteis.
 */
import { store } from '../store.js';
import { TOURS, hasDoneTour, runTour, resetTour, resetAllTours } from '../services/tours.js?v=20260501qq';

const esc = s => String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function renderHelp(container) {
  paint();

  function paint() {
    const tours = TOURS.filter(t => !t.eligibility || t.eligibility());
    const doneCount = tours.filter(t => hasDoneTour(t.id)).length;

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-left">
          <h1 class="page-title">❓ Ajuda</h1>
          <p class="page-subtitle">Tours guiados, atalhos e dúvidas frequentes</p>
        </div>
        <div class="page-header-actions">
          <button class="btn btn-secondary btn-sm" id="help-reset-all">↺ Refazer todos os tours</button>
        </div>
      </div>

      <!-- TOURS GUIADOS -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <div>
            <div class="card-title">🎯 Tours guiados</div>
            <div class="card-subtitle" style="font-size:0.8125rem;color:var(--text-muted);margin-top:2px;">
              Aprenda na prática. ${doneCount} de ${tours.length} concluídos.
            </div>
          </div>
        </div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;">
            ${tours.map(t => {
              const done = hasDoneTour(t.id);
              return `<div class="card" style="padding:16px;border:1px solid ${done?'rgba(34,197,94,0.4)':'var(--border-subtle)'};
                background:${done?'rgba(34,197,94,0.04)':'var(--bg-card)'};">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                  <div style="font-size:1.5rem;">${t.icon || '◯'}</div>
                  <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;font-size:0.9375rem;color:var(--text-primary);">${esc(t.title)}</div>
                    <div style="font-size:0.6875rem;color:var(--text-muted);">
                      ⏱ ${esc(t.duration||'')} · ${t.steps.length} passos
                    </div>
                  </div>
                  ${done ? `<span style="font-size:0.75rem;color:#22C55E;font-weight:600;">✓ Feito</span>` : ''}
                </div>
                <p style="font-size:0.8125rem;color:var(--text-secondary);line-height:1.5;margin:0 0 12px;">
                  ${esc(t.description||'')}
                </p>
                <div style="display:flex;gap:6px;">
                  <button class="btn btn-${done?'secondary':'primary'} btn-sm" data-tour="${t.id}" data-act="run">
                    ${done?'↺ Refazer':'▶ Iniciar'}
                  </button>
                  ${done ? `<button class="btn btn-ghost btn-sm" data-tour="${t.id}" data-act="reset"
                    title="Marcar como não feito">⨯</button>` : ''}
                </div>
              </div>`;
            }).join('')}
          </div>
        </div>
      </div>

      <!-- ATALHOS DE TECLADO -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <div class="card-title">⌨ Atalhos de teclado</div>
        </div>
        <div class="card-body">
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;">
            ${[
              { keys: ['ESC'],          desc: 'Fecha modal ou tour ativo' },
              { keys: ['←', '→'],       desc: 'Navega entre passos do tour' },
              { keys: ['Cmd', 'K'],     desc: 'Busca global / IA assistente' },
              { keys: ['Cmd', 'B'],     desc: 'Abre/fecha sidebar' },
              { keys: ['?'],            desc: 'Ajuda rápida (esta página)' },
              { keys: ['G', 'D'],       desc: 'Vai pra Dashboard (Meu Painel)' },
              { keys: ['G', 'T'],       desc: 'Vai pra Tarefas' },
              { keys: ['G', 'C'],       desc: 'Vai pra Check-in' },
            ].map(s => `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;
              background:var(--bg-surface);border-radius:6px;font-size:0.8125rem;">
              <div style="display:flex;gap:4px;flex-shrink:0;">
                ${s.keys.map(k => `<kbd style="background:var(--bg-card);
                  border:1px solid var(--border-subtle);border-radius:4px;padding:2px 7px;
                  font-family:var(--font-mono,monospace);font-size:0.75rem;font-weight:600;
                  color:var(--text-primary);">${esc(k)}</kbd>`).join(' + ')}
              </div>
              <span style="color:var(--text-secondary);">${esc(s.desc)}</span>
            </div>`).join('')}
          </div>
        </div>
      </div>

      <!-- FAQ -->
      <div class="card" style="margin-bottom:24px;">
        <div class="card-header">
          <div class="card-title">💬 Dúvidas frequentes</div>
        </div>
        <div class="card-body">
          ${[
            {
              q: 'Esqueci de bater ponto. O que faço?',
              a: 'Vá em <strong>Check-in → Ponto</strong> e clique no ✎ da linha do dia errado (ou em "+ Solicitar correção"). Sua solicitação vai pra fila de aprovação do gestor.',
            },
            {
              q: 'Como pedir férias?',
              a: 'Em <strong>Equipe → Férias</strong>. O sistema calcula seu saldo CLT (períodos aquisitivos de 12 meses). Aceita fracionamento (até 3 períodos, sendo 1 com mín 14 dias) e abono pecuniário (até 10 dias).',
            },
            {
              q: 'Posso ter mais de uma reserva de mesa por dia?',
              a: 'Não. Cada usuário tem 1 reserva ativa por dia. Se precisar trocar, cancele a antiga primeiro.',
            },
            {
              q: 'Onde mudo a paleta de cores?',
              a: 'Header → seu avatar → Perfil → seção "Aparência". Você pode escolher entre Portal, Midnight, Charcoal, Ocean Blue e outras paletas.',
            },
            {
              q: 'Como sou notificado?',
              a: 'Sino no header (com badge de não lidas) e e-mail (se a integração estiver ativa). Configurações em Perfil → Notificações.',
            },
          ].map((f, i) => `<details style="border:1px solid var(--border-subtle);border-radius:6px;
            margin-bottom:8px;padding:0;">
            <summary style="cursor:pointer;padding:12px 14px;font-weight:600;font-size:0.875rem;
              color:var(--text-primary);list-style:none;display:flex;align-items:center;gap:8px;">
              <span style="font-size:0.75rem;color:var(--text-muted);">▸</span> ${esc(f.q)}
            </summary>
            <div style="padding:0 14px 14px 30px;font-size:0.875rem;color:var(--text-secondary);line-height:1.6;">
              ${f.a}
            </div>
          </details>`).join('')}
        </div>
      </div>

      <!-- LINKS ÚTEIS -->
      <div class="card">
        <div class="card-header">
          <div class="card-title">🔗 Links úteis</div>
        </div>
        <div class="card-body">
          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            ${(store.isMaster() || store.can('system_manage_users')) ? `
              <a href="#about" class="btn btn-secondary btn-sm">📚 Sobre o sistema (estrutura)</a>` : ''}
            ${store.can('portal_manage') ? `
              <a href="solicitar.html" target="_blank" class="btn btn-secondary btn-sm">🌐 Portal público de solicitações</a>` : ''}
            <a href="https://github.com/primetour/tarefas" target="_blank" class="btn btn-secondary btn-sm">💻 Repositório no GitHub</a>
          </div>
        </div>
      </div>
    `;

    // Bindings
    container.querySelectorAll('[data-act="run"]').forEach(btn => {
      btn.addEventListener('click', () => runTour(btn.dataset.tour));
    });
    container.querySelectorAll('[data-act="reset"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await resetTour(btn.dataset.tour);
        paint();
      });
    });
    document.getElementById('help-reset-all')?.addEventListener('click', async () => {
      if (!confirm('Marcar TODOS os tours como não feitos?\nIsso fará com que voltem a aparecer automaticamente nas próximas navegações.')) return;
      await resetAllTours();
      paint();
    });
  }
}
