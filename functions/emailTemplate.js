/**
 * PRIMETOUR — Email Template DSL (4.35.26+)
 *
 * Renderer único pra todos os emails transacionais do sistema.
 * Identidade visual fixa: navy #0F172A + dourado #D4A843 + logo branco.
 * Funciona em LIGHT e DARK mode (sem fundos brancos forçados).
 *
 * Uso:
 *   import { renderEmailTemplate } from './emailTemplate.js';
 *   const html = renderEmailTemplate({
 *     preheader: 'Texto invisível no preview',
 *     overline:  'Tarefa atribuída',          // textinho dourado acima do heading
 *     heading:   'Você foi atribuído a...',
 *     intro:     'Parágrafo curto explicando.',
 *     blocks: [
 *       { type: 'paragraph', text: '...' },
 *       { type: 'list',      items: [...] },
 *       { type: 'data',      rows: [['De', 'João'], ['Página', '/tasks']] },
 *       { type: 'highlight', items: [...] },   // bloco navy destacado (estilo "entregas neste lote")
 *       { type: 'quote',     text: '...' },    // bloco com borda esquerda
 *     ],
 *     cta:      { url: '...', label: 'Ver', emoji: '→' },
 *     footerNote: 'Personalizado',
 *     variant:  'default' | 'success' | 'warning' | 'danger',
 *   });
 *
 * Refs:
 *   - CSAT: function _buildCsatEmailHtml em functions/index.js
 *   - System feedback: _buildSystemFeedbackEmailHtml
 */

const PRIMETOUR_LOGO = 'https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/logos/lazer-alt-1777403810065.webp';

// Paleta principal (espelha css/base.css)
const COLORS = {
  navy:       '#0F172A',
  gold:       '#D4A843',
  goldSoft:   '#E5BD63',
  white:      '#FFFFFF',
};

const VARIANT_ACCENTS = {
  default: COLORS.gold,
  success: '#22C55E',
  warning: '#F59E0B',
  danger:  '#EF4444',
};

/* ─── HTML escape (sem dependência externa) ──────────────── */
export function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

/* ─── Renderer de blocos individuais ──────────────────────── */
function renderBlock(b) {
  if (!b || !b.type) return '';
  switch (b.type) {
    case 'paragraph':
      return `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;">${escHtml(b.text)}</p>`;

    case 'list': {
      const items = Array.isArray(b.items) ? b.items : [];
      if (!items.length) return '';
      return `<ul style="margin:0 0 20px;padding:0 0 0 22px;font-size:15px;line-height:1.7;">
        ${items.map(it => `<li style="margin:0 0 4px;">${escHtml(it)}</li>`).join('')}
      </ul>`;
    }

    case 'data': {
      // Tabela "label: valor"
      const rows = Array.isArray(b.rows) ? b.rows : [];
      if (!rows.length) return '';
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;font-size:14px;">
        ${rows.map(([k, v]) => `<tr>
          <td style="padding:6px 12px 6px 0;opacity:0.7;white-space:nowrap;vertical-align:top;width:30%;">${escHtml(k)}</td>
          <td style="padding:6px 0;line-height:1.55;word-break:break-word;">${escHtml(v)}</td>
        </tr>`).join('')}
      </table>`;
    }

    case 'highlight': {
      // Bloco navy destacado (estilo "entregas neste lote" do CSAT)
      const items = Array.isArray(b.items) ? b.items : [];
      const title = b.title || '';
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.navy}" style="background-color:${COLORS.navy};border-radius:10px;margin:0 0 24px;">
        <tr><td style="padding:18px 20px;">
          ${title ? `<div style="font-size:11px;color:${COLORS.gold};margin-bottom:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;">${escHtml(title)}</div>` : ''}
          ${items.length
            ? `<ul style="margin:0;padding:0 0 0 18px;color:${COLORS.white};font-size:14px;line-height:1.7;">
                 ${items.map(it => `<li style="margin:0 0 4px;color:${COLORS.white};">${escHtml(it)}</li>`).join('')}
               </ul>`
            : ''}
          ${b.text ? `<div style="font-size:15px;color:${COLORS.white};font-weight:500;line-height:1.55;">${escHtml(b.text)}</div>` : ''}
        </td></tr>
      </table>`;
    }

    case 'quote':
      return `<blockquote style="margin:0 0 20px;padding:14px 18px;border-left:4px solid ${COLORS.gold};font-size:15px;line-height:1.6;font-style:italic;">
        ${escHtml(b.text)}
      </blockquote>`;

    case 'divider':
      return `<div style="height:1px;background:rgba(127,127,127,0.2);margin:24px 0;"></div>`;

    default:
      return '';
  }
}

/* ─── Renderer principal ──────────────────────────────────── */
export function renderEmailTemplate({
  preheader   = '',
  overline    = '',
  heading     = '',
  intro       = '',
  blocks      = [],
  cta         = null,    // { url, label, emoji? }
  footerNote  = 'Email automático do Gestor PRIMETOUR. Não responda diretamente.',
  variant     = 'default',
  productLabel = 'Notificação',
}) {
  const accent = VARIANT_ACCENTS[variant] || COLORS.gold;
  const safeCtaUrl   = cta?.url   ? String(cta.url).replace(/"/g, '%22') : '';
  const safeCtaLabel = cta?.label ? String(cta.label).replace(/[<>]/g, '') : 'Acessar';
  const ctaEmoji     = cta?.emoji ? `${cta.emoji} ` : '';
  const safeHeading  = escHtml(heading);
  const safePreheader = escHtml(preheader || heading);
  const safeOverline = escHtml(overline || productLabel);

  const blocksHtml = (blocks || []).map(renderBlock).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${safeHeading || 'PRIMETOUR'}</title>
  <!--[if mso]><style>body,table,td{font-family:'Segoe UI',Arial,sans-serif!important;}</style><![endif]-->
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;">${safePreheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;border-radius:14px;overflow:hidden;border:1px solid rgba(127,127,127,0.2);">

        <!-- HEADER: navy + logo branco + overline dourada -->
        <tr><td bgcolor="${COLORS.navy}" style="padding:32px;background-color:${COLORS.navy};text-align:center;border-bottom:3px solid ${accent};">
          <img src="${PRIMETOUR_LOGO}" alt="PRIMETOUR" width="200" style="display:inline-block;max-width:200px;height:auto;border:0;outline:none;text-decoration:none;">
          <div style="margin-top:14px;font-size:11px;color:${accent};letter-spacing:0.22em;text-transform:uppercase;font-weight:700;">${safeOverline}</div>
        </td></tr>

        <!-- Conteúdo principal -->
        <tr><td style="padding:36px 32px 28px;">
          ${safeHeading ? `<h1 style="margin:0 0 16px;font-size:22px;font-weight:700;line-height:1.35;letter-spacing:-0.01em;">${safeHeading}</h1>` : ''}
          ${intro ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.65;">${escHtml(intro)}</p>` : ''}
          ${blocksHtml}
          ${safeCtaUrl ? `
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto 0;">
              <tr><td align="center" bgcolor="${COLORS.gold}" style="border-radius:10px;background-color:${COLORS.gold};">
                <a href="${safeCtaUrl}" target="_blank" style="display:inline-block;padding:14px 36px;font-size:16px;font-weight:600;color:${COLORS.white};text-decoration:none;border-radius:10px;letter-spacing:0.01em;">${ctaEmoji}${safeCtaLabel}</a>
              </td></tr>
            </table>
            <p style="margin:14px 0 0;font-size:11px;text-align:center;line-height:1.55;opacity:0.7;">
              Ou copie este link:<br>
              <a href="${safeCtaUrl}" style="word-break:break-all;font-size:11px;color:${COLORS.gold};text-decoration:none;">${safeCtaUrl}</a>
            </p>
          ` : ''}
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:20px 32px 24px;border-top:1px solid rgba(127,127,127,0.15);">
          <p style="margin:0;font-size:12px;line-height:1.6;opacity:0.85;">${escHtml(footerNote)}</p>
          <p style="margin:10px 0 0;font-size:10px;opacity:0.6;letter-spacing:0.02em;">© PRIMETOUR Viagens &amp; Experiências · não responda diretamente</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/* ─── Helper: monta config a partir de uma notification ────── */
const NOTIF_TYPE_META = {
  // type → { overline, productLabel, variant, ctaLabel, footerNote? }
  'task.assigned':            { overline: 'TAREFA ATRIBUÍDA',    productLabel: 'Tarefa', variant: 'default', ctaLabel: 'Ver tarefa' },
  'task.unassigned':          { overline: 'REMOVIDO DA TAREFA',  productLabel: 'Tarefa', variant: 'warning', ctaLabel: 'Ver tarefa' },
  'task.completed':           { overline: 'TAREFA CONCLUÍDA',    productLabel: 'Tarefa', variant: 'success', ctaLabel: 'Ver tarefa' },
  'task.commented':           { overline: 'NOVO COMENTÁRIO',     productLabel: 'Tarefa', variant: 'default', ctaLabel: 'Ver comentário' },
  'task.overdue':             { overline: 'TAREFA ATRASADA',     productLabel: 'Tarefa', variant: 'danger',  ctaLabel: 'Ver tarefa' },
  'task.deadline_approaching':{ overline: 'PRAZO PRÓXIMO',       productLabel: 'Tarefa', variant: 'warning', ctaLabel: 'Ver tarefa' },
  'task.status_changed':      { overline: 'STATUS ALTERADO',     productLabel: 'Tarefa', variant: 'default', ctaLabel: 'Ver tarefa' },
  'task.rework':              { overline: 'TAREFA DEVOLVIDA',    productLabel: 'Tarefa', variant: 'warning', ctaLabel: 'Ver tarefa' },
  'subtask.assigned':         { overline: 'SUBTAREFA ATRIBUÍDA', productLabel: 'Tarefa', variant: 'default', ctaLabel: 'Ver subtarefa' },
  'subtask.unassigned':       { overline: 'REMOVIDO DA SUBTAREFA', productLabel: 'Tarefa', variant: 'warning', ctaLabel: 'Ver subtarefa' },

  'project.updated':          { overline: 'PROJETO ATUALIZADO',  productLabel: 'Projeto', variant: 'default', ctaLabel: 'Ver projeto' },
  'project.member_added':     { overline: 'ADICIONADO AO PROJETO', productLabel: 'Projeto', variant: 'success', ctaLabel: 'Ver projeto' },
  'project.member_removed':   { overline: 'REMOVIDO DO PROJETO',   productLabel: 'Projeto', variant: 'warning', ctaLabel: 'Ver projetos' },

  'squad.member_added':       { overline: 'ADICIONADO AO SQUAD', productLabel: 'Squad', variant: 'success', ctaLabel: 'Ver squad' },
  'squad.member_removed':     { overline: 'REMOVIDO DO SQUAD',   productLabel: 'Squad', variant: 'warning', ctaLabel: 'Ver squads' },
  'squad.admin_granted':      { overline: 'PROMOVIDO A ADMIN',   productLabel: 'Squad', variant: 'success', ctaLabel: 'Ver squad' },
  'squad.admin_revoked':      { overline: 'ADMIN DO SQUAD REMOVIDO', productLabel: 'Squad', variant: 'warning', ctaLabel: 'Ver squad' },

  'request.created':          { overline: 'NOVA SOLICITAÇÃO',    productLabel: 'Solicitação', variant: 'default', ctaLabel: 'Ver solicitação' },
  'request.converted':        { overline: 'SOLICITAÇÃO CONVERTIDA', productLabel: 'Solicitação', variant: 'success', ctaLabel: 'Ver tarefa' },

  'csat.responded':           { overline: 'RESPOSTA CSAT',       productLabel: 'CSAT', variant: 'default', ctaLabel: 'Ver resposta' },
  'csat.low_score':           { overline: 'CSAT CRÍTICO',        productLabel: 'CSAT', variant: 'danger',  ctaLabel: 'Ver resposta' },

  'goal.published':           { overline: 'META PUBLICADA',      productLabel: 'Meta', variant: 'default', ctaLabel: 'Ver meta' },
  'goal.deadline':            { overline: 'PRAZO DE META',       productLabel: 'Meta', variant: 'warning', ctaLabel: 'Ver meta' },

  'portal.tip_created':       { overline: 'NOVA DICA',           productLabel: 'Portal', variant: 'default', ctaLabel: 'Ver dica' },

  'feedback.created':         { overline: 'NOVO FEEDBACK',       productLabel: 'Feedback', variant: 'default', ctaLabel: 'Ver feedback' },
  'feedback.schedule_due':    { overline: 'FEEDBACK PENDENTE',   productLabel: 'Feedback', variant: 'warning', ctaLabel: 'Agendar' },

  'system.mention':           { overline: 'VOCÊ FOI MENCIONADO', productLabel: 'Menção', variant: 'default', ctaLabel: 'Ver mensagem' },

  'roteiro.assigned':         { overline: 'ROTEIRO ATRIBUÍDO',   productLabel: 'Roteiro', variant: 'default', ctaLabel: 'Ver roteiro' },
  'roteiro.status_change':    { overline: 'STATUS DO ROTEIRO',   productLabel: 'Roteiro', variant: 'default', ctaLabel: 'Ver roteiro' },

  'content_calendar.slot_created':  { overline: 'NOVO SLOT',     productLabel: 'Calendário', variant: 'default', ctaLabel: 'Ver slot' },
  'content_calendar.published':     { overline: 'CONTEÚDO PUBLICADO', productLabel: 'Calendário', variant: 'success', ctaLabel: 'Ver calendário' },

  'agent.run_failed':         { overline: 'AGENTE IA FALHOU',    productLabel: 'IA Hub', variant: 'danger',  ctaLabel: 'Ver agente' },

  'security.suspicious_login':{ overline: 'LOGIN SUSPEITO',      productLabel: 'Segurança', variant: 'warning', ctaLabel: 'Ver detalhes' },
  'security.digest_critical': { overline: 'DIGEST CRÍTICO',      productLabel: 'Segurança', variant: 'danger',  ctaLabel: 'Ver digest' },

  'lgpd.export_ready':        { overline: 'EXPORTAÇÃO PRONTA',   productLabel: 'LGPD', variant: 'success', ctaLabel: 'Baixar dados' },
  'lgpd.erasure_completed':   { overline: 'DADOS APAGADOS',      productLabel: 'LGPD', variant: 'default', ctaLabel: 'Confirmar' },
};

export function getNotificationEmailMeta(type) {
  return NOTIF_TYPE_META[type] || {
    overline: type.toUpperCase().replace(/[._]/g, ' '),
    productLabel: 'Notificação',
    variant: 'default',
    ctaLabel: 'Acessar',
  };
}

/**
 * Helper específico pra construir o email de uma notification.
 * Recebe o doc da notif + base URL e retorna { subject, html }.
 */
export function buildNotificationEmail(notif, { appBaseUrl = 'https://primetour.github.io/tarefas/' } = {}) {
  const meta = getNotificationEmailMeta(notif.type);
  const ctaUrl = notif.route
    ? appBaseUrl + (notif.route.startsWith('#') ? notif.route : '#' + notif.route)
    : appBaseUrl;

  const subject = notif.title || meta.overline;
  const blocks = [];

  if (notif.body) {
    blocks.push({ type: 'paragraph', text: notif.body });
  }

  // Metadados úteis (actor, data)
  const dataRows = [];
  if (notif.actorName && notif.actorName !== 'Sistema') {
    dataRows.push(['De', notif.actorName]);
  }
  if (notif.createdAt) {
    const d = notif.createdAt.toDate ? notif.createdAt.toDate() : new Date(notif.createdAt);
    dataRows.push(['Quando', d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })]);
  }
  if (dataRows.length) {
    blocks.push({ type: 'data', rows: dataRows });
  }

  const html = renderEmailTemplate({
    preheader:    notif.body || notif.title || meta.overline,
    overline:     meta.overline,
    heading:      notif.title || meta.overline,
    intro:        '',
    blocks,
    cta:          { url: ctaUrl, label: meta.ctaLabel },
    footerNote:   'Notificação automática do Gestor PRIMETOUR. Você pode ajustar quais avisos receber por email em Configurações → Notificações.',
    variant:      meta.variant,
    productLabel: meta.productLabel,
  });

  return { subject, html };
}
