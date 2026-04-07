/**
 * PRIMETOUR — AI Actions Registry
 *
 * Define as ações que a IA pode executar dentro do sistema.
 * Cada ação tem: nome, descrição, parâmetros esperados e a função executora.
 *
 * Fluxo:
 *  1. O chat envia as ações disponíveis no system prompt
 *  2. A IA responde com blocos <<<ACTION>>> quando quer executar algo
 *  3. O aiPanel parseia e executa via executeAction()
 *
 * Fase 1: Global + Tasks + Kanban + Projects
 * Fase 2: Roteiros, Portal, Feedbacks, Goals, CSAT, Calendar, Dashboard
 * Fase 3: Timeline, Requests, Arts, Users, Settings
 */

import { store }  from '../store.js';
import { router } from '../router.js';

/* Toast — import seguro para evitar erros quando o container não existe */
let toast = { success(){}, error(){}, info(){}, warning(){} };
try {
  const m = await import('../components/toast.js');
  if (m.toast) toast = m.toast;
} catch {}

/**
 * Resolver taskId: se não parecer hash Firestore, busca por título.
 * IDs Firestore: 20 chars alfanuméricos. Se o modelo enviar um título
 * ou ID inventado, tentamos buscar a tarefa real.
 */
async function resolveTaskId(taskId) {
  if (!taskId) return taskId;
  // Hash Firestore válido: 20+ chars alfanuméricos
  if (/^[a-zA-Z0-9]{15,}$/.test(taskId)) return taskId;
  // Parece título ou ID fake — buscar por título
  try {
    const { fetchTasks } = await import('./tasks.js');
    const tasks = await fetchTasks();
    const searchLower = taskId.toLowerCase();
    const found = tasks.find(t =>
      t.title?.toLowerCase().includes(searchLower) ||
      t.title?.toLowerCase() === searchLower
    );
    if (found) return found.id;
  } catch { /* ignore */ }
  return taskId; // retornar original se não encontrar
}

/* Wrapper seguro para evitar perda de `this` */
function showToast(type, message) {
  try { toast[type]?.(message) || toast.info?.(message); } catch {}
}

/* ─── Helper: busca web real ──────────────────────────────── */
async function searchWeb(query, sites) {
  let searchQuery = query;
  if (sites) {
    const siteList = sites.split(',').map(s => `site:${s.trim()}`).join(' OR ');
    searchQuery = `${query} (${siteList})`;
  }

  const results = [];
  const encoded = encodeURIComponent(searchQuery);

  // Helper: extrair URL real de redirect DDG
  function cleanDdgUrl(rawUrl) {
    if (!rawUrl) return '';
    try {
      if (rawUrl.includes('uddg=')) {
        const match = rawUrl.match(/uddg=([^&]+)/);
        if (match) return decodeURIComponent(match[1]);
      }
      if (rawUrl.startsWith('http')) return rawUrl;
      if (rawUrl.startsWith('//')) return 'https:' + rawUrl;
    } catch {}
    return rawUrl;
  }

  // Estratégia 1: SearXNG público (JSON API — CORS-friendly quando disponível)
  const searxInstances = [
    'https://searx.tiekoetter.com',
    'https://search.sapti.me',
    'https://searx.be',
    'https://search.ononoki.org',
  ];
  for (const instance of searxInstances) {
    if (results.length > 0) break;
    try {
      const url = `${instance}/search?q=${encoded}&format=json&language=pt-BR&categories=general,news`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) continue;
      const data = await resp.json();
      (data.results || []).slice(0, 8).forEach(r => {
        if (r.url && r.title) {
          let hostname = '';
          try { hostname = new URL(r.url).hostname.replace('www.', ''); } catch {}
          results.push({
            title: r.title,
            url: r.url,
            snippet: (r.content || '').substring(0, 250),
            source: hostname || r.engine || '',
          });
        }
      });
    } catch (e) {
      console.warn(`[searchWeb] SearXNG ${instance} falhou:`, e.message);
    }
  }

  // Estratégia 2: DuckDuckGo HTML via proxy CORS
  if (results.length === 0) {
    const proxies = [
      url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    ];
    for (const mkProxy of proxies) {
      if (results.length > 0) break;
      try {
        const ddgUrl = `https://html.duckduckgo.com/html/?q=${encoded}&kl=br-pt`;
        const resp = await fetch(mkProxy(ddgUrl), { signal: AbortSignal.timeout(12000) });
        if (!resp.ok) continue;
        const html = await resp.text();
        if (html.length < 500) continue;

        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        doc.querySelectorAll('.result__a, a.result__a').forEach((a, i) => {
          if (results.length >= 8) return;
          const rawUrl = a.getAttribute('href') || '';
          const url = cleanDdgUrl(rawUrl);
          if (!url || url.includes('duckduckgo.com') || url.includes('bing.com/aclick')) return;
          const title = a.textContent?.trim() || '';
          if (!title) return;
          const resultDiv = a.closest('.result');
          const snippet = resultDiv?.querySelector('.result__snippet')?.textContent?.trim()?.substring(0, 250) || '';
          let hostname = '';
          try { hostname = new URL(url).hostname.replace('www.', ''); } catch {}
          results.push({ title, url, snippet, source: hostname });
        });
      } catch (e) {
        console.warn('[searchWeb] DDG proxy falhou:', e.message);
      }
    }
  }

  // Estratégia 3: Se nada funcionou, retornar instrução para busca manual
  if (results.length === 0) {
    return [{
      title: '⚠️ Busca automática indisponível',
      url: `https://www.google.com/search?q=${encoded}&hl=pt-BR`,
      snippet: `Não foi possível realizar a busca automaticamente. Clique no link acima para buscar manualmente ou tente novamente em alguns minutos.`,
      source: 'sistema',
    }];
  }

  // Deduplificar
  const seen = new Set();
  return results.filter(r => {
    const key = r.source + '|' + r.title.substring(0, 40);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 8);
}

/* ─── Helper: captura KPIs/stats do DOM da página visível ── */
function scrapeVisibleStats() {
  const content = document.getElementById('page-content');
  if (!content) return [];
  const stats = [];
  const seen = new Set();

  function add(label, value, source) {
    if (!label || !value) return;
    const key = label.toLowerCase().trim();
    if (seen.has(key)) return;
    seen.add(key);
    stats.push({ label: label.trim(), value: value.trim(), source });
  }

  // 1. Dashboard principal — .kpi-widget (usa .kpi-label + .kpi-value)
  content.querySelectorAll('.kpi-widget').forEach(card => {
    const label = card.querySelector('.kpi-label')?.textContent?.trim() || '';
    const value = card.querySelector('.kpi-value')?.textContent?.trim() || '';
    add(label, value, 'dashboard');
  });

  // 2. GA / Meta / Newsletter — cards com inline styles
  //    Estrutura: .card > div(label uppercase) > div(valor bold) > div(subtexto)
  content.querySelectorAll('#ga-kpis .card, #meta-kpis .card, #nl-kpis .card').forEach(card => {
    const divs = card.querySelectorAll(':scope > div');
    let label = '', value = '', sub = '';
    for (const d of divs) {
      const s = (d.getAttribute('style') || '').toLowerCase();
      const t = d.textContent?.trim() || '';
      if (!t) continue;
      if (s.includes('uppercase') || s.includes('letter-spacing')) {
        // Label — pode conter ícone "i" no final, limpar
        label = t.replace(/\s*i\s*$/, '').trim();
      } else if (s.includes('font-weight') && (s.includes('600') || s.includes('700') || s.includes('bold'))) {
        value = t;
      } else if (s.includes('font-size:1.') || s.includes('font-size: 1.')) {
        value = t;
      } else if (label && value) {
        sub = t;
      }
    }
    // Fallback: se não pegou por style, usar posição dos filhos
    if (!label || !value) {
      const children = Array.from(divs);
      if (children.length >= 2) {
        label = label || children[0]?.textContent?.trim() || '';
        value = value || children[1]?.textContent?.trim() || '';
        if (children.length >= 3) sub = sub || children[2]?.textContent?.trim() || '';
      }
    }
    const section = card.closest('#ga-kpis') ? 'Google Analytics'
                  : card.closest('#meta-kpis') ? 'Meta/Instagram'
                  : 'Newsletter';
    add(label, sub ? `${value} (${sub})` : value, section);
  });

  // 3. stat-card (variante legada)
  content.querySelectorAll('.stat-card').forEach(card => {
    const label = card.querySelector('.stat-card-label, small')?.textContent?.trim() || '';
    const value = card.querySelector('.stat-card-value')?.textContent?.trim() || '';
    add(label, value, 'stat-card');
  });

  // 4. rd-kpi-card (roteiroDashboard)
  content.querySelectorAll('.rd-kpi-card').forEach(card => {
    const label = card.querySelector('.rd-kpi-label')?.textContent?.trim() || '';
    const value = card.querySelector('.rd-kpi-value')?.textContent?.trim() || '';
    add(label, value, 'roteiros');
  });

  // 5. kpi-card genérico (CSAT, outros)
  content.querySelectorAll('.kpi-card').forEach(card => {
    const label = card.querySelector('.kpi-label, small, [class*="label"]')?.textContent?.trim() || '';
    const value = card.querySelector('.kpi-value, [class*="value"]')?.textContent?.trim() || '';
    add(label, value, 'kpi-card');
  });

  // 6. dash-widget sem kpi-widget (caso use outro layout)
  content.querySelectorAll('.dash-widget').forEach(card => {
    if (card.querySelector('.kpi-widget')) return; // já capturado no passo 1
    const label = card.querySelector('.kpi-label, small, [class*="label"]')?.textContent?.trim() || '';
    const value = card.querySelector('.kpi-value, [class*="value"], b, strong')?.textContent?.trim() || '';
    add(label, value, 'dash-widget');
  });

  // 7. Fallback: elementos com metric/stat/kpi no class
  if (!stats.length) {
    content.querySelectorAll('[class*="metric"], [class*="stat-"], [class*="kpi"]').forEach(el => {
      const label = el.querySelector('small, [class*="label"], span')?.textContent?.trim() || '';
      const value = el.querySelector('[class*="value"], [class*="count"], b, strong')?.textContent?.trim() || '';
      add(label, value, 'fallback');
    });
  }

  // 8. Capturar dados tabulares (tabelas de dados na página)
  const tables = content.querySelectorAll('table, .table-container');
  if (tables.length > 0) {
    tables.forEach((table, tIdx) => {
      const headers = [];
      table.querySelectorAll('thead th, tr:first-child th').forEach(th => {
        const h = th.textContent?.trim();
        if (h) headers.push(h);
      });
      const rows = [];
      table.querySelectorAll('tbody tr').forEach((tr, rIdx) => {
        if (rIdx >= 20) return; // max 20 rows
        const cells = [];
        tr.querySelectorAll('td').forEach(td => cells.push(td.textContent?.trim() || '—'));
        if (cells.length > 0) rows.push(cells);
      });
      if (headers.length || rows.length) {
        stats.push({
          label: `Tabela ${tIdx + 1}`,
          value: `${rows.length} linhas`,
          source: 'table',
          headers: headers.join(' | '),
          rows: rows.slice(0, 10).map(r => r.join(' | ')),
        });
      }
    });
  }

  // 9. Capturar listas/cards de itens (ex: dicas, roteiros, solicitações)
  const listItems = content.querySelectorAll('.tip-row, .roteiro-card, .request-row, .task-row, [class*="item-row"]');
  if (listItems.length > 0 && stats.length < 5) {
    const items = [];
    listItems.forEach((item, i) => {
      if (i >= 15) return;
      const title = item.querySelector('.tip-title, .roteiro-title, h3, h4, .title, [class*="title"]')?.textContent?.trim() || '';
      const status = item.querySelector('.badge, [class*="status"], [class*="badge"]')?.textContent?.trim() || '';
      if (title) items.push(status ? `${title} (${status})` : title);
    });
    if (items.length) {
      stats.push({ label: 'Itens listados', value: `${items.length} itens`, source: 'list', items });
    }
  }

  return stats;
}

/* ─── Registry de ações GLOBAIS ────────────────────────────── */

const GLOBAL_ACTIONS = [
  {
    name: 'navigate',
    description: 'Navegar para outra página/módulo do sistema',
    params: { route: 'string — rota destino (ex: tasks, kanban, dashboard, roteiros, portal-tips, feedbacks, goals, projects, csat, calendar, timeline, requests)' },
    execute: async ({ route }) => {
      router.navigate(route);
      return { success: true, message: `Navegando para ${route}` };
    },
  },
  {
    name: 'show_toast',
    description: 'Mostrar uma notificação/mensagem para o usuário',
    params: { message: 'string — texto da mensagem', type: 'string — success, error, info, warning (default: info)' },
    execute: async ({ message, type }) => {
      showToast(type || 'info', message);
      return { success: true };
    },
  },
  {
    name: 'export_page',
    description: 'Exportar os dados da página atual em PDF ou XLS/XLSX. Aciona o botão de export da página.',
    params: {
      format: 'string — "pdf" ou "xls" (obrigatório)',
    },
    execute: async ({ format }) => {
      const fmt = (format || 'pdf').toLowerCase().replace('xlsx', 'xls');

      // Mapa de seletores de botões de export por página
      const exportBtnSelectors = [
        `#tasks-export-${fmt}`,
        `#meta-export-${fmt === 'xls' ? 'xlsx' : fmt}`,
        `#nl-export-${fmt === 'xls' ? 'xlsx' : fmt}`,
        `#ga-export-${fmt === 'xls' ? 'xlsx' : fmt}`,
        `[id*="export"][id*="${fmt}"]`,
        `button[id*="export-${fmt}"]`,
      ];

      for (const sel of exportBtnSelectors) {
        const btn = document.querySelector(sel);
        if (btn) {
          btn.click();
          return { success: true, message: `Export ${fmt.toUpperCase()} iniciado!` };
        }
      }
      return { success: false, message: `Botão de export ${fmt.toUpperCase()} não encontrado nesta página. Navegue para a página com dados antes de exportar.` };
    },
  },
  {
    name: 'export_ai_report',
    description: 'Gerar e baixar PDF com relatório: dados da página + análise da IA. Use APÓS analisar dados.',
    params: {
      title: 'string — título do relatório (ex: "Análise de Performance - Abril 2026")',
      analysis: 'string — texto completo da análise feita pela IA (resumo, destaques, sugestões, alertas). OBRIGATÓRIO e detalhado.',
    },
    execute: async ({ title, analysis }) => {
      if (!analysis || analysis.length < 30) {
        return { success: false, message: 'Análise muito curta. Primeiro analise os dados, depois exporte o relatório com o texto da análise completa.' };
      }

      // Carregar jsPDF
      if (!window.jspdf) {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
          s.onload = res; s.onerror = rej; document.head.appendChild(s);
        });
      }
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const margin = 15;
      const usable = W - margin * 2;
      let y = 0;

      // ─── Cores ───
      const primary = [30, 58, 95];     // azul escuro
      const accent = [212, 175, 55];    // dourado
      const darkBg = [20, 25, 35];      // fundo escuro
      const white = [255, 255, 255];
      const lightGray = [200, 200, 200];
      const textColor = [60, 60, 60];

      // ─── Helper: quebrar texto longo ───
      function addWrappedText(text, x, startY, maxWidth, lineHeight = 6) {
        const lines = doc.splitTextToSize(text, maxWidth);
        let curY = startY;
        for (const line of lines) {
          if (curY > H - 20) {
            doc.addPage();
            curY = margin;
          }
          doc.text(line, x, curY);
          curY += lineHeight;
        }
        return curY;
      }

      // ─── Capa ───
      doc.setFillColor(...darkBg);
      doc.rect(0, 0, W, H, 'F');

      // Linha dourada decorativa
      doc.setDrawColor(...accent);
      doc.setLineWidth(0.8);
      doc.line(margin, 60, W - margin, 60);
      doc.line(margin, 62, W - margin, 62);

      // Logo text
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(...accent);
      doc.text('PRIMETOUR', margin, 50);

      // Título
      doc.setFontSize(28);
      doc.setTextColor(...white);
      const titleLines = doc.splitTextToSize(title || 'Relatório de Análise', usable);
      doc.text(titleLines, margin, 85);

      // Subtítulo
      doc.setFontSize(12);
      doc.setTextColor(...lightGray);
      doc.text('Relatório gerado por Inteligência Artificial', margin, 85 + titleLines.length * 12 + 10);

      const today = new Date();
      doc.setFontSize(10);
      doc.text(`Data: ${today.toLocaleDateString('pt-BR')}`, margin, 85 + titleLines.length * 12 + 20);

      const profile = store.get('currentProfile') || store.get('userProfile') || {};
      const userName = profile.name || profile.displayName || '';
      if (userName) {
        doc.text(`Gerado por: ${userName}`, margin, 85 + titleLines.length * 12 + 28);
      }

      // Rodapé capa
      doc.setFontSize(8);
      doc.setTextColor(...lightGray);
      doc.text('Documento gerado automaticamente pelo Assistente IA PRIMETOUR', margin, H - 15);
      doc.text('Informações confidenciais — uso interno', margin, H - 10);

      // ─── Página de Dados ───
      doc.addPage();
      y = margin;

      // Capturar dados da tela
      const stats = scrapeVisibleStats();
      const kpis = stats.filter(s => s.source !== 'table' && s.source !== 'list');
      const tables = stats.filter(s => s.source === 'table');

      if (kpis.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.setTextColor(...primary);
        doc.text('Indicadores', margin, y);
        y += 10;

        // KPI cards em grid
        const cardW = (usable - 10) / 3;
        const cardH = 20;
        kpis.forEach((kpi, i) => {
          const col = i % 3;
          const row = Math.floor(i / 3);
          const cx = margin + col * (cardW + 5);
          const cy = y + row * (cardH + 5);

          if (cy + cardH > H - 20) {
            doc.addPage();
            y = margin;
          }

          // Card background
          doc.setFillColor(240, 242, 245);
          doc.roundedRect(cx, cy, cardW, cardH, 2, 2, 'F');

          // Label
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7);
          doc.setTextColor(120, 120, 120);
          doc.text((kpi.label || '').toUpperCase(), cx + 3, cy + 6);

          // Value
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(14);
          doc.setTextColor(...primary);
          doc.text(String(kpi.value || '—'), cx + 3, cy + 15);
        });

        y += Math.ceil(kpis.length / 3) * (cardH + 5) + 10;
      }

      // Tabelas
      if (tables.length > 0 && window.jspdf) {
        for (const tbl of tables) {
          if (y > H - 40) { doc.addPage(); y = margin; }
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.setTextColor(...primary);
          doc.text(tbl.label || 'Dados', margin, y);
          y += 8;

          if (tbl.headers && tbl.rows?.length) {
            const headers = tbl.headers.split(' | ');
            const body = tbl.rows.map(r => (typeof r === 'string' ? r.split(' | ') : r));
            try {
              doc.autoTable({
                startY: y,
                head: [headers],
                body,
                margin: { left: margin, right: margin },
                styles: { fontSize: 8, cellPadding: 2 },
                headStyles: { fillColor: primary, textColor: white },
                alternateRowStyles: { fillColor: [245, 247, 250] },
              });
              y = doc.lastAutoTable.finalY + 10;
            } catch {
              y += 5;
            }
          }
        }
      }

      // ─── Página de Análise IA ───
      doc.addPage();
      y = margin;

      // Header
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(...primary);
      doc.text('Análise da Inteligência Artificial', margin, y);
      y += 4;
      doc.setDrawColor(...accent);
      doc.setLineWidth(0.5);
      doc.line(margin, y, W - margin, y);
      y += 10;

      // Processar texto da análise — detectar seções (###, **, números)
      const analysisLines = analysis.split('\n');
      for (const line of analysisLines) {
        const trimmed = line.trim();
        if (!trimmed) { y += 3; continue; }

        if (y > H - 20) {
          doc.addPage();
          y = margin;
        }

        // Título de seção (### ou MAIÚSCULAS ou número seguido de ponto)
        if (/^#{1,3}\s/.test(trimmed) || /^[A-ZÁÉÍÓÚÂÊÔÃÕÇ\s]{5,}:?\s*$/.test(trimmed)) {
          const sectionTitle = trimmed.replace(/^#+\s*/, '').replace(/:$/, '');
          y += 3;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(12);
          doc.setTextColor(...primary);
          doc.text(sectionTitle, margin, y);
          y += 7;
        }
        // Sub-item com negrito (**texto**)
        else if (/^\*\*/.test(trimmed) || /^-\s*\*\*/.test(trimmed)) {
          const clean = trimmed.replace(/\*\*/g, '').replace(/^-\s*/, '');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.setTextColor(40, 40, 40);
          y = addWrappedText(`• ${clean}`, margin + 3, y, usable - 6, 5);
          y += 1;
        }
        // Item numerado
        else if (/^\d+\.\s/.test(trimmed)) {
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(9);
          doc.setTextColor(40, 40, 40);
          const num = trimmed.match(/^(\d+\.)/)[1];
          const rest = trimmed.replace(/^\d+\.\s*/, '').replace(/\*\*/g, '');
          doc.text(num, margin + 2, y);
          doc.setFont('helvetica', 'normal');
          y = addWrappedText(rest, margin + 10, y, usable - 13, 5);
          y += 2;
        }
        // Bullet point
        else if (/^[-•]\s/.test(trimmed)) {
          const clean = trimmed.replace(/^[-•]\s*/, '').replace(/\*\*/g, '');
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.setTextColor(...textColor);
          y = addWrappedText(`• ${clean}`, margin + 5, y, usable - 8, 5);
          y += 1;
        }
        // Sub-item com travessão
        else if (/^\s+-\s/.test(line)) {
          const clean = line.trim().replace(/^-\s*/, '').replace(/\*\*/g, '');
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(80, 80, 80);
          y = addWrappedText(`  ‣ ${clean}`, margin + 10, y, usable - 15, 5);
        }
        // Texto normal
        else {
          const clean = trimmed.replace(/\*\*/g, '');
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(9);
          doc.setTextColor(...textColor);
          y = addWrappedText(clean, margin, y, usable, 5);
          y += 1;
        }
      }

      // ─── Rodapé em todas as páginas ───
      const totalPages = doc.internal.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(150, 150, 150);
        if (p > 1) {
          doc.text('PRIMETOUR — Relatório IA', margin, H - 7);
          doc.text(`Página ${p - 1} de ${totalPages - 1}`, W - margin - 25, H - 7);
        }
      }

      // ─── Download ───
      const dateStr = today.toISOString().split('T')[0];
      const filename = `Relatorio_IA_${(title || 'Analise').replace(/[^a-zA-Z0-9]/g, '_').substring(0, 40)}_${dateStr}.pdf`;
      doc.save(filename);

      return { success: true, message: `Relatório PDF gerado: ${filename}` };
    },
  },
  {
    name: 'get_current_user',
    description: 'Obter informações do usuário logado (nome, email, setor, permissões)',
    params: {},
    execute: async () => {
      const user = store.get('currentUser');
      const profile = store.get('currentProfile') || store.get('userProfile') || {};
      return {
        success: true,
        data: {
          uid: user?.uid,
          email: user?.email,
          name: profile.name || profile.displayName || user?.displayName || '',
          sector: profile.sector || '',
          role: profile.role || '',
          nucleos: profile.nucleos || [],
        },
      };
    },
  },
];

/* ─── Registry de ações por MÓDULO ─────────────────────────── */

const MODULE_ACTIONS = {

  /* ═══════════════════════════════════════════════════════════
   * TASKS — Gerenciamento de Tarefas
   * ═══════════════════════════════════════════════════════════ */
  tasks: [
    {
      name: 'create_task',
      description: 'Criar uma nova tarefa no sistema com todos os campos disponíveis',
      params: {
        title: 'string — título da tarefa (obrigatório)',
        description: 'string — descrição detalhada (opcional)',
        priority: 'string — urgent, high, medium, low (default: medium)',
        status: 'string — not_started, in_progress, review, rework, done, cancelled (default: not_started)',
        sector: 'string — setor responsável (opcional)',
        dueDate: 'string — data de vencimento YYYY-MM-DD (opcional)',
        startDate: 'string — data de início YYYY-MM-DD (opcional)',
        assignees: 'string[] — array de UIDs dos responsáveis (opcional, default: usuário atual)',
        projectId: 'string — ID do projeto (opcional)',
        tags: 'string[] — array de tags/etiquetas (opcional)',
        nucleos: 'string[] — array de núcleos (opcional)',
        typeId: 'string — ID do tipo de tarefa (opcional, use list_task_types para ver opções)',
        variationId: 'string — ID da variação dentro do tipo (opcional)',
        customFields: 'object — campos personalizados do tipo de tarefa (opcional). Ex: {"outOfCalendar":true,"newsletterStatus":"Pauta"}',
        requestingArea: 'string — área solicitante (opcional)',
      },
      execute: async (params) => {
        const { createTask } = await import('./tasks.js');
        const user = store.get('currentUser');
        const taskData = {
          title: params.title,
          description: params.description || '',
          priority: params.priority || 'medium',
          status: params.status || 'not_started',
          sector: params.sector || store.get('userSector') || '',
          createdBy: user?.uid,
          assignees: params.assignees || (user?.uid ? [user.uid] : []),
        };
        if (params.dueDate) taskData.dueDate = new Date(params.dueDate + 'T12:00:00');
        if (params.startDate) taskData.startDate = new Date(params.startDate + 'T12:00:00');
        if (params.projectId) taskData.projectId = params.projectId;
        if (params.tags) taskData.tags = Array.isArray(params.tags) ? params.tags : [params.tags];
        if (params.nucleos) taskData.nucleos = Array.isArray(params.nucleos) ? params.nucleos : [params.nucleos];
        if (params.typeId) taskData.typeId = params.typeId;
        if (params.variationId) taskData.variationId = params.variationId;
        if (params.customFields) taskData.customFields = params.customFields;
        if (params.requestingArea) taskData.requestingArea = params.requestingArea;
        const task = await createTask(taskData);
        return { success: true, message: `Tarefa "${params.title}" criada com sucesso! ID: ${task?.id}`, taskId: task?.id, data: { taskId: task?.id, title: params.title } };
      },
    },
    {
      name: 'update_task',
      description: 'Atualizar qualquer campo de uma tarefa existente',
      params: {
        taskId: 'string — ID da tarefa (obrigatório)',
        title: 'string — novo título (opcional)',
        description: 'string — nova descrição (opcional)',
        status: 'string — not_started, in_progress, review, rework, done, cancelled (opcional)',
        priority: 'string — urgent, high, medium, low (opcional)',
        dueDate: 'string — nova data de vencimento YYYY-MM-DD (opcional)',
        startDate: 'string — nova data de início YYYY-MM-DD (opcional)',
        assignees: 'string[] — novos responsáveis, array de UIDs (opcional)',
        projectId: 'string — ID do projeto (opcional)',
        tags: 'string[] — tags/etiquetas (opcional)',
        nucleos: 'string[] — núcleos (opcional)',
        typeId: 'string — ID do tipo de tarefa (opcional)',
        variationId: 'string — ID da variação (opcional)',
        customFields: 'object — campos personalizados. Ex: {"outOfCalendar":true,"newsletterStatus":"Redação"} (opcional)',
        requestingArea: 'string — área solicitante (opcional)',
      },
      execute: async (params) => {
        const { updateTask } = await import('./tasks.js');
        const { taskId, ...data } = params;
        // Converter datas
        if (data.dueDate) data.dueDate = new Date(data.dueDate + 'T12:00:00');
        if (data.startDate) data.startDate = new Date(data.startDate + 'T12:00:00');
        // Garantir arrays
        if (data.tags && !Array.isArray(data.tags)) data.tags = [data.tags];
        if (data.nucleos && !Array.isArray(data.nucleos)) data.nucleos = [data.nucleos];
        if (data.assignees && !Array.isArray(data.assignees)) data.assignees = [data.assignees];
        // Remover campos undefined
        Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
        await updateTask(taskId, data);
        return { success: true, message: `Tarefa atualizada com sucesso!` };
      },
    },
    {
      name: 'complete_task',
      description: 'Marcar uma tarefa como concluída',
      params: { taskId: 'string — ID da tarefa' },
      execute: async ({ taskId }) => {
        const { toggleTaskComplete } = await import('./tasks.js');
        await toggleTaskComplete(taskId, true);
        return { success: true, message: 'Tarefa marcada como concluída!' };
      },
    },
    {
      name: 'delete_task',
      description: 'Excluir/apagar uma tarefa permanentemente',
      params: { taskId: 'string — ID da tarefa (obrigatório)' },
      execute: async ({ taskId }) => {
        const { deleteTask } = await import('./tasks.js');
        await deleteTask(taskId);
        return { success: true, message: 'Tarefa excluída com sucesso!' };
      },
    },
    {
      name: 'add_comment',
      description: 'Adicionar um comentário em uma tarefa',
      params: {
        taskId: 'string — ID da tarefa',
        text: 'string — texto do comentário',
      },
      execute: async ({ taskId, text }) => {
        const { addComment } = await import('./tasks.js');
        await addComment(taskId, text);
        return { success: true, message: 'Comentário adicionado!' };
      },
    },
    {
      name: 'list_tasks',
      description: 'Listar tarefas com filtros opcionais. Use para buscar dados/IDs antes de modificar tarefas.',
      params: {
        status: 'string — filtrar por status: not_started, in_progress, review, done (opcional)',
        priority: 'string — filtrar por prioridade: urgent, high, medium, low (opcional)',
        sector: 'string — filtrar por setor (opcional)',
        search: 'string — buscar por título (opcional)',
        limitN: 'number — limitar quantidade de resultados (default: 20)',
      },
      execute: async (params) => {
        const { fetchTasks } = await import('./tasks.js');
        let tasks = await fetchTasks({
          status: params.status,
          priority: params.priority,
          sector: params.sector,
          limitN: params.limitN || 20,
        });
        if (params.search) {
          const s = params.search.toLowerCase();
          tasks = tasks.filter(t => (t.title || '').toLowerCase().includes(s));
        }
        const summary = tasks.map(t => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          sector: t.sector || '',
          assignees: t.assigneeNames || t.assignees,
          dueDate: t.dueDate?.toDate?.()?.toLocaleDateString?.('pt-BR') || t.dueDate || '',
          type: t.type || '',
          variationName: t.variationName || '',
          tags: t.tags || [],
          customFields: t.customFields || {},
          projectId: t.projectId || '',
        }));
        return { success: true, data: summary, message: `${tasks.length} tarefa(s) encontrada(s)` };
      },
    },
    {
      name: 'list_task_types',
      description: 'Listar tipos de tarefas disponíveis no sistema (com suas variações e campos personalizados)',
      params: {},
      execute: async () => {
        try {
          const { collection, getDocs, query, orderBy } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
          const { db } = await import('../firebase.js');
          const snap = await getDocs(query(collection(db, 'task_types'), orderBy('name')));
          const types = snap.docs.map(d => {
            const data = d.data();
            return {
              id: d.id,
              name: data.name || '',
              sector: data.sector || '',
              variations: (data.variations || []).map(v => ({
                id: v.id, name: v.name, slaDays: v.slaDays || null,
              })),
              customFields: (data.fields || []).map(f => ({
                key: f.key, label: f.label, type: f.type,
                options: f.options || [],
                required: f.required || false,
              })),
            };
          });
          return { success: true, data: types, message: `${types.length} tipo(s) de tarefa` };
        } catch (e) {
          return { success: false, message: 'Erro ao buscar tipos: ' + e.message };
        }
      },
    },
    {
      name: 'add_subtask',
      description: 'Adicionar uma subtarefa/checklist item a uma tarefa existente',
      params: {
        taskId: 'string — ID da tarefa pai (obrigatório)',
        title: 'string — título da subtarefa (obrigatório)',
      },
      execute: async ({ taskId, title }) => {
        if (!taskId || !title) return { success: false, message: 'taskId e title são obrigatórios' };
        const { updateTask } = await import('./tasks.js');
        const { arrayUnion } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        const subtask = {
          id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
          title,
          done: false,
          createdAt: new Date().toISOString(),
        };
        await updateTask(taskId, { subtasks: arrayUnion(subtask) });
        return { success: true, message: `Subtarefa "${title}" adicionada!` };
      },
    },
    {
      name: 'filter_view',
      description: 'Aplicar filtros na visualização atual de tarefas na tela',
      params: {
        status: 'string — status para filtrar (ou vazio para limpar)',
        priority: 'string — prioridade para filtrar (ou vazio para limpar)',
      },
      execute: async ({ status, priority }) => {
        if (status) {
          const el = document.getElementById('filter-status');
          if (el) { el.value = status; el.dispatchEvent(new Event('change')); }
        }
        if (priority) {
          const el = document.getElementById('filter-priority');
          if (el) { el.value = priority; el.dispatchEvent(new Event('change')); }
        }
        return { success: true, message: 'Filtros aplicados na tela!' };
      },
    },
    {
      name: 'get_task_summary',
      description: 'Obter um resumo quantitativo das tarefas (total, por status, por prioridade)',
      params: {},
      execute: async () => {
        const { fetchTasks } = await import('./tasks.js');
        const tasks = await fetchTasks({ limitN: 500 });
        const byStatus = {};
        const byPriority = {};
        tasks.forEach(t => {
          byStatus[t.status] = (byStatus[t.status] || 0) + 1;
          byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
        });
        return {
          success: true,
          data: { total: tasks.length, byStatus, byPriority },
          message: `${tasks.length} tarefa(s) no total`,
        };
      },
    },
    {
      name: 'bulk_update_status',
      description: 'Atualizar o status de múltiplas tarefas de uma vez',
      params: {
        taskIds: 'string[] — array de IDs das tarefas',
        newStatus: 'string — novo status: not_started, in_progress, review, done, cancelled',
      },
      execute: async ({ taskIds, newStatus }) => {
        const { updateTask } = await import('./tasks.js');
        const ids = Array.isArray(taskIds) ? taskIds : [taskIds];
        let count = 0;
        for (const id of ids) {
          try { await updateTask(id, { status: newStatus }); count++; } catch {}
        }
        return { success: true, message: `${count} tarefa(s) atualizada(s) para "${newStatus}"` };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * KANBAN — Quadro visual de tarefas
   * ═══════════════════════════════════════════════════════════ */
  kanban: [
    {
      name: 'move_card',
      description: 'Mover um card do Kanban para outro status/coluna',
      params: {
        taskId: 'string — ID da tarefa/card',
        newStatus: 'string — novo status: not_started, in_progress, review, rework, done',
      },
      execute: async ({ taskId, newStatus }) => {
        const { moveTaskKanban } = await import('./tasks.js');
        await moveTaskKanban(taskId, newStatus, 0);
        return { success: true, message: `Card movido para ${newStatus}!` };
      },
    },
    {
      name: 'create_card',
      description: 'Criar um novo card no Kanban',
      params: {
        title: 'string — título do card (obrigatório)',
        status: 'string — coluna: not_started, in_progress, review (default: not_started)',
        priority: 'string — urgent, high, medium, low (default: medium)',
        description: 'string — descrição (opcional)',
        assignees: 'string[] — UIDs dos responsáveis (opcional)',
        dueDate: 'string — data de vencimento YYYY-MM-DD (opcional)',
        projectId: 'string — ID do projeto (opcional)',
      },
      execute: async (params) => {
        const { createTask } = await import('./tasks.js');
        const user = store.get('currentUser');
        const task = await createTask({
          title: params.title,
          description: params.description || '',
          priority: params.priority || 'medium',
          status: params.status || 'not_started',
          assignees: params.assignees || (user?.uid ? [user.uid] : []),
          sector: store.get('userSector') || '',
          createdBy: user?.uid,
          ...(params.dueDate ? { dueDate: new Date(params.dueDate + 'T12:00:00') } : {}),
          ...(params.projectId ? { projectId: params.projectId } : {}),
        });
        showToast('success', `Card "${params.title}" criado!`);
        return { success: true, message: `Card "${params.title}" criado! ID: ${task?.id}`, data: { taskId: task?.id } };
      },
    },
    {
      name: 'update_card',
      description: 'Atualizar campos de um card do Kanban',
      params: {
        taskId: 'string — ID do card (obrigatório)',
        title: 'string — novo título (opcional)',
        description: 'string — nova descrição (opcional)',
        priority: 'string — urgent, high, medium, low (opcional)',
        assignees: 'string[] — novos responsáveis (opcional)',
        dueDate: 'string — nova data YYYY-MM-DD (opcional)',
      },
      execute: async (params) => {
        const { updateTask } = await import('./tasks.js');
        const { taskId, ...data } = params;
        if (data.dueDate) data.dueDate = new Date(data.dueDate + 'T12:00:00');
        if (data.assignees && !Array.isArray(data.assignees)) data.assignees = [data.assignees];
        Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
        await updateTask(taskId, data);
        return { success: true, message: 'Card atualizado!' };
      },
    },
    {
      name: 'list_tasks',
      description: 'Listar todos os cards do board (para análise ou busca)',
      params: {
        status: 'string — filtrar por coluna/status (opcional)',
        search: 'string — buscar por título (opcional)',
        limitN: 'number — limitar resultados (default: 50)',
      },
      execute: async (params) => {
        const { fetchTasks } = await import('./tasks.js');
        let tasks = await fetchTasks({ status: params.status, limitN: params.limitN || 50 });
        if (params.search) {
          const s = params.search.toLowerCase();
          tasks = tasks.filter(t => (t.title || '').toLowerCase().includes(s));
        }
        const summary = tasks.map(t => ({
          id: t.id, title: t.title, status: t.status, priority: t.priority,
          assignees: t.assigneeNames || t.assignees,
          dueDate: t.dueDate?.toDate?.()?.toLocaleDateString?.('pt-BR') || '',
        }));
        return { success: true, data: summary, message: `${tasks.length} card(s)` };
      },
    },
    {
      name: 'get_board_summary',
      description: 'Obter resumo do quadro Kanban (quantidade de cards por coluna)',
      params: {},
      execute: async () => {
        const { fetchTasks } = await import('./tasks.js');
        const tasks = await fetchTasks({ limitN: 500 });
        const columns = { not_started: 0, in_progress: 0, review: 0, rework: 0, done: 0 };
        tasks.forEach(t => { if (columns[t.status] !== undefined) columns[t.status]++; });
        return {
          success: true,
          data: columns,
          message: `Board: ${Object.entries(columns).map(([k,v]) => `${k}=${v}`).join(', ')}`,
        };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * PROJECTS — Gestão de Projetos
   * ═══════════════════════════════════════════════════════════ */
  projects: [
    {
      name: 'create_project',
      description: 'Criar um novo projeto',
      params: {
        name: 'string — nome do projeto (obrigatório)',
        description: 'string — descrição (opcional)',
        color: 'string — cor hex (opcional, default: #3B82F6)',
        icon: 'string — emoji do projeto (opcional, default: 📁)',
        status: 'string — planning, active, on_hold, completed, cancelled (default: active)',
        startDate: 'string — data de início YYYY-MM-DD (opcional)',
        endDate: 'string — data de término YYYY-MM-DD (opcional)',
        members: 'string[] — UIDs dos membros (opcional)',
      },
      execute: async (params) => {
        const { createProject } = await import('./projects.js');
        const data = {
          name: params.name,
          description: params.description || '',
          color: params.color || '#3B82F6',
          icon: params.icon || '📁',
          status: params.status || 'active',
        };
        if (params.startDate) data.startDate = new Date(params.startDate + 'T12:00:00');
        if (params.endDate) data.endDate = new Date(params.endDate + 'T12:00:00');
        if (params.members) data.members = Array.isArray(params.members) ? params.members : [params.members];
        const project = await createProject(data);
        showToast('success', `Projeto "${params.name}" criado!`);
        return { success: true, message: `Projeto "${params.name}" criado!`, data: { projectId: project?.id || '' } };
      },
    },
    {
      name: 'list_projects',
      description: 'Listar projetos do sistema',
      params: {
        status: 'string — filtrar: planning, active, on_hold, completed, cancelled (opcional)',
        search: 'string — buscar por nome (opcional)',
      },
      execute: async (params) => {
        const { fetchProjects } = await import('./projects.js');
        let projects = await fetchProjects({ includeArchived: true });
        if (params?.status) projects = projects.filter(p => p.status === params.status);
        if (params?.search) {
          const s = params.search.toLowerCase();
          projects = projects.filter(p => (p.name || '').toLowerCase().includes(s));
        }
        const summary = projects.map(p => ({
          id: p.id, name: p.name, status: p.status, icon: p.icon || '',
          description: (p.description || '').substring(0, 100),
          taskCount: p.taskCount || 0, doneCount: p.doneCount || 0,
        }));
        return { success: true, data: summary, message: `${projects.length} projeto(s)` };
      },
    },
    {
      name: 'update_project',
      description: 'Atualizar dados de um projeto',
      params: {
        projectId: 'string — ID do projeto (obrigatório)',
        name: 'string — novo nome (opcional)',
        description: 'string — nova descrição (opcional)',
        status: 'string — planning, active, on_hold, completed, cancelled (opcional)',
        color: 'string — nova cor hex (opcional)',
        icon: 'string — novo emoji (opcional)',
        startDate: 'string — data de início YYYY-MM-DD (opcional)',
        endDate: 'string — data de término YYYY-MM-DD (opcional)',
        members: 'string[] — UIDs dos membros (opcional)',
      },
      execute: async (params) => {
        const { updateProject } = await import('./projects.js');
        const { projectId, ...data } = params;
        if (data.startDate) data.startDate = new Date(data.startDate + 'T12:00:00');
        if (data.endDate) data.endDate = new Date(data.endDate + 'T12:00:00');
        if (data.members && !Array.isArray(data.members)) data.members = [data.members];
        Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
        await updateProject(projectId, data);
        return { success: true, message: 'Projeto atualizado!' };
      },
    },
    {
      name: 'delete_project',
      description: 'Excluir um projeto (as tarefas vinculadas não são apagadas)',
      params: { projectId: 'string — ID do projeto (obrigatório)' },
      execute: async ({ projectId }) => {
        const { deleteProject } = await import('./projects.js');
        await deleteProject(projectId);
        showToast('success', 'Projeto excluído!');
        return { success: true, message: 'Projeto excluído!' };
      },
    },
    {
      name: 'get_project_tasks',
      description: 'Listar tarefas vinculadas a um projeto específico',
      params: {
        projectId: 'string — ID do projeto',
        status: 'string — filtrar por status (opcional)',
      },
      execute: async ({ projectId, status }) => {
        const { fetchTasks } = await import('./tasks.js');
        let tasks = await fetchTasks({ projectId, limitN: 50 });
        if (status) tasks = tasks.filter(t => t.status === status);
        const summary = tasks.map(t => ({
          id: t.id, title: t.title, status: t.status, priority: t.priority,
          assignees: t.assigneeNames || t.assignees,
          dueDate: t.dueDate?.toDate?.()?.toLocaleDateString?.('pt-BR') || '',
        }));
        return { success: true, data: summary, message: `${tasks.length} tarefa(s) no projeto` };
      },
    },
    {
      name: 'get_project_progress',
      description: 'Obter progresso de um projeto (% concluído, tarefas por status)',
      params: { projectId: 'string — ID do projeto (obrigatório)' },
      execute: async ({ projectId }) => {
        const { fetchTasks } = await import('./tasks.js');
        const { getProject } = await import('./projects.js');
        const [project, tasks] = await Promise.all([
          getProject(projectId),
          fetchTasks({ projectId, limitN: 500 }),
        ]);
        const byStatus = {};
        tasks.forEach(t => { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });
        const done = byStatus.done || 0;
        const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
        return {
          success: true,
          data: { name: project?.name || '', total: tasks.length, done, pct, byStatus },
          message: `Projeto "${project?.name || projectId}": ${pct}% concluído (${done}/${tasks.length})`,
        };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * ROTEIROS — Roteiros de Viagem
   * ═══════════════════════════════════════════════════════════ */
  roteiros: [
    {
      name: 'list_roteiros',
      description: 'Listar roteiros de viagem cadastrados',
      params: { status: 'string — filtrar por status: draft, review, sent, approved, archived (opcional)' },
      execute: async (params) => {
        const { fetchRoteiros } = await import('./roteiros.js');
        let roteiros = await fetchRoteiros();
        if (params.status) roteiros = roteiros.filter(r => r.status === params.status);
        const summary = roteiros.slice(0, 20).map(r => ({
          id: r.id,
          title: r.title || '',
          clientName: r.clientName || r.client?.name || '',
          destination: r.destination || r.travel?.destinations?.map(d => d.city).join(', ') || '',
          status: r.status,
          consultantName: r.consultantName || '',
          nights: r.travel?.nights || '',
        }));
        return { success: true, data: summary, message: `${roteiros.length} roteiro(s)` };
      },
    },
    {
      name: 'get_roteiro',
      description: 'Obter detalhes de um roteiro específico',
      params: { roteiroId: 'string — ID do roteiro (obrigatório)' },
      execute: async ({ roteiroId }) => {
        const { fetchRoteiro } = await import('./roteiros.js');
        const roteiro = await fetchRoteiro(roteiroId);
        if (!roteiro) return { success: false, message: 'Roteiro não encontrado' };
        return {
          success: true,
          data: {
            id: roteiro.id, title: roteiro.title, status: roteiro.status,
            client: roteiro.client, travel: roteiro.travel,
            daysCount: roteiro.days?.length || 0,
            hotels: roteiro.hotels?.length || 0,
            pricing: roteiro.pricing,
          },
          message: `Roteiro: ${roteiro.title || roteiro.client?.name || roteiroId}`,
        };
      },
    },
    {
      name: 'update_roteiro_status',
      description: 'Alterar o status de um roteiro (ex: draft → review → sent → approved)',
      params: {
        roteiroId: 'string — ID do roteiro (obrigatório)',
        status: 'string — novo status: draft, review, sent, approved, archived (obrigatório)',
      },
      execute: async ({ roteiroId, status }) => {
        const { updateRoteiroStatus } = await import('./roteiros.js');
        await updateRoteiroStatus(roteiroId, status);
        return { success: true, message: `Roteiro atualizado para "${status}"` };
      },
    },
    {
      name: 'duplicate_roteiro',
      description: 'Duplicar um roteiro existente (cria cópia como rascunho)',
      params: { roteiroId: 'string — ID do roteiro a duplicar' },
      execute: async ({ roteiroId }) => {
        const { duplicateRoteiro } = await import('./roteiros.js');
        const newId = await duplicateRoteiro(roteiroId);
        return { success: true, message: `Roteiro duplicado!`, newRoteiroId: newId };
      },
    },
    {
      name: 'get_roteiro_stats',
      description: 'Obter estatísticas gerais dos roteiros (total, por status, destinos mais cotados)',
      params: {},
      execute: async () => {
        const { fetchRoteiroStats } = await import('./roteiros.js');
        const stats = await fetchRoteiroStats();
        return { success: true, data: stats, message: 'Estatísticas de roteiros' };
      },
    },
    {
      name: 'list_recent_clients',
      description: 'Listar clientes recentes de roteiros (para autocompletar)',
      params: {},
      execute: async () => {
        const { fetchRecentClients } = await import('./roteiros.js');
        const clients = await fetchRecentClients();
        return { success: true, data: clients.slice(0, 15), message: `${clients.length} cliente(s) recente(s)` };
      },
    },
    {
      name: 'create_roteiro',
      description: 'Criar um novo roteiro de viagem',
      params: {
        title: 'string — título do roteiro (obrigatório)',
        clientName: 'string — nome do cliente (obrigatório)',
        clientEmail: 'string — email do cliente (opcional)',
        clientType: 'string — individual, couple, family, group (default: individual)',
        destinations: 'string — destinos, separados por vírgula (ex: "Miami, Orlando")',
        startDate: 'string — data de início YYYY-MM-DD (opcional)',
        nights: 'number — total de noites (opcional)',
      },
      execute: async (params) => {
        const { saveRoteiro, emptyRoteiro } = await import('./roteiros.js');
        const roteiro = emptyRoteiro();
        roteiro.title = params.title;
        roteiro.client.name = params.clientName;
        if (params.clientEmail) roteiro.client.email = params.clientEmail;
        if (params.clientType) roteiro.client.type = params.clientType;
        if (params.destinations) {
          roteiro.travel.destinations = params.destinations.split(',').map(d => ({
            city: d.trim(), country: '', nights: 0,
          }));
        }
        if (params.startDate) roteiro.travel.startDate = params.startDate;
        if (params.nights) roteiro.travel.nights = params.nights;
        const id = await saveRoteiro(null, roteiro);
        showToast('success', `Roteiro "${params.title}" criado!`);
        return { success: true, message: `Roteiro "${params.title}" criado! ID: ${id}`, data: { roteiroId: id } };
      },
    },
    {
      name: 'update_roteiro',
      description: 'Atualizar dados de um roteiro existente',
      params: {
        roteiroId: 'string — ID do roteiro (obrigatório)',
        title: 'string — novo título (opcional)',
        clientName: 'string — nome do cliente (opcional)',
        clientEmail: 'string — email (opcional)',
        notes: 'string — observações/notas internas (opcional)',
      },
      execute: async (params) => {
        const { fetchRoteiro, saveRoteiro } = await import('./roteiros.js');
        const roteiro = await fetchRoteiro(params.roteiroId);
        if (!roteiro) return { success: false, message: 'Roteiro não encontrado' };
        if (params.title) roteiro.title = params.title;
        if (params.clientName) roteiro.client = { ...roteiro.client, name: params.clientName };
        if (params.clientEmail) roteiro.client = { ...roteiro.client, email: params.clientEmail };
        if (params.notes) roteiro.notes = params.notes;
        await saveRoteiro(params.roteiroId, roteiro);
        return { success: true, message: 'Roteiro atualizado!' };
      },
    },
    {
      name: 'delete_roteiro',
      description: 'Excluir um roteiro de viagem',
      params: { roteiroId: 'string — ID do roteiro (obrigatório)' },
      execute: async ({ roteiroId }) => {
        const { deleteRoteiro } = await import('./roteiros.js');
        await deleteRoteiro(roteiroId);
        showToast('success', 'Roteiro excluído!');
        return { success: true, message: 'Roteiro excluído!' };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * PORTAL-TIPS — Portal de Dicas de Viagem
   * ═══════════════════════════════════════════════════════════ */
  'portal-tips': [
    {
      name: 'list_destinations',
      description: 'Listar destinos disponíveis no portal de dicas',
      params: {
        continent: 'string — filtrar por continente (opcional)',
        country: 'string — filtrar por país (opcional)',
      },
      execute: async (params) => {
        const { fetchDestinations } = await import('./portal.js');
        let destinations = await fetchDestinations();
        if (params.continent) destinations = destinations.filter(d => d.continent === params.continent);
        if (params.country) destinations = destinations.filter(d => d.country === params.country);
        const summary = destinations.slice(0, 30).map(d => ({
          id: d.id, name: d.name, city: d.city || d.name, country: d.country || '', continent: d.continent || '',
        }));
        return { success: true, data: summary, message: `${destinations.length} destino(s)` };
      },
    },
    {
      name: 'list_tips',
      description: 'Listar dicas de um destino específico',
      params: {
        destinationId: 'string — ID do destino (obrigatório)',
        category: 'string — filtrar por categoria: restaurantes, atracoes, hoteis, informacoes_gerais, etc. (opcional)',
      },
      execute: async ({ destinationId, category }) => {
        const { fetchTips } = await import('./portal.js');
        let tips = await fetchTips(destinationId);
        if (category) tips = tips.filter(t => t.category === category);
        const summary = tips.slice(0, 20).map(t => ({
          id: t.id, title: t.title || t.name || '', category: t.category || '', priority: t.priority || false,
        }));
        return { success: true, data: summary, message: `${tips.length} dica(s)` };
      },
    },
    {
      name: 'get_tip_detail',
      description: 'Obter conteúdo detalhado de uma dica específica',
      params: { tipId: 'string — ID da dica (obrigatório)' },
      execute: async ({ tipId }) => {
        const { fetchTip } = await import('./portal.js');
        const tip = await fetchTip(tipId);
        if (!tip) return { success: false, message: 'Dica não encontrada' };
        return {
          success: true,
          data: { id: tip.id, title: tip.title, category: tip.category, content: (tip.content || '').substring(0, 500) + '...' },
          message: `Dica: ${tip.title || tipId}`,
        };
      },
    },
    {
      name: 'list_areas',
      description: 'Listar áreas/BUs (identidades visuais) do portal',
      params: {},
      execute: async () => {
        const { fetchAreas } = await import('./portal.js');
        const areas = await fetchAreas();
        const summary = areas.map(a => ({ id: a.id, name: a.name, color: a.primaryColor || '' }));
        return { success: true, data: summary, message: `${areas.length} área(s)/BU(s)` };
      },
    },
    {
      name: 'list_images',
      description: 'Listar imagens disponíveis para um destino',
      params: {
        city: 'string — cidade (opcional)',
        country: 'string — país (opcional)',
        destinationId: 'string — ID do destino (opcional)',
      },
      execute: async (params) => {
        const { fetchImages } = await import('./portal.js');
        const images = await fetchImages(params);
        const summary = images.slice(0, 20).map(i => ({
          id: i.id, title: i.title || i.name || '', city: i.city || '', tags: i.tags || [],
        }));
        return { success: true, data: summary, message: `${images.length} imagem(ns)` };
      },
    },
    {
      name: 'toggle_tip_priority',
      description: 'Marcar/desmarcar uma dica como prioritária (destaque)',
      params: {
        tipId: 'string — ID da dica',
        priority: 'boolean — true para destacar, false para remover destaque',
      },
      execute: async ({ tipId, priority }) => {
        const { toggleTipPriority } = await import('./portal.js');
        await toggleTipPriority(tipId, priority);
        return { success: true, message: priority ? 'Dica marcada como prioritária!' : 'Destaque removido da dica' };
      },
    },
    {
      name: 'create_destination',
      description: 'Criar um novo destino no portal de dicas',
      params: {
        name: 'string — nome do destino (ex: "Miami")',
        city: 'string — cidade (ex: "Miami")',
        country: 'string — país (ex: "Estados Unidos")',
        continent: 'string — continente: america_do_norte, america_do_sul, europa, asia, africa, oceania',
        description: 'string — descrição breve do destino (opcional)',
      },
      execute: async (params) => {
        const { saveDestination } = await import('./portal.js');
        const id = await saveDestination(null, {
          name: params.name,
          city: params.city || params.name,
          country: params.country || '',
          continent: params.continent || '',
          description: params.description || '',
        });
        showToast('success', `Destino "${params.name}" criado!`);
        return { success: true, message: `Destino "${params.name}" criado!`, data: { destinationId: id, name: params.name } };
      },
    },
    {
      name: 'create_tip',
      description: 'Criar uma nova dica de viagem para um destino. SEMPRE gere conteúdo detalhado no "content". Avise que o conteúdo é baseado em conhecimento geral e deve ser revisado pela equipe antes de publicar.',
      params: {
        destinationId: 'string — ID do destino (obrigatório). Use list_destinations para encontrar.',
        title: 'string — título da dica (ex: "Melhores restaurantes em Miami")',
        category: 'string — categoria: restaurantes, atracoes, hoteis, informacoes_gerais, compras, vida_noturna, transporte, dicas_praticas',
        content: 'string — conteúdo/texto da dica — OBRIGATÓRIO e detalhado (mín. 200 chars). Escreva informações úteis sobre o destino.',
        priority: 'boolean — true para destacar (opcional, default: false)',
      },
      execute: async (params) => {
        if (!params.destinationId) return { success: false, message: 'destinationId é obrigatório. Use list_destinations para encontrar o ID do destino.' };

        let content = params.content || '';
        let wasGenerated = false;

        // Se conteúdo veio vazio ou muito curto, gerar via IA automaticamente
        if (content.length < 100) {
          try {
            const { chatWithAI } = await import('./ai.js');
            const genResult = await chatWithAI(
              `Gere um texto completo e detalhado (300-500 palavras) para uma dica de viagem.\n`
              + `Título: "${params.title || params.category || 'Dica de viagem'}"\n`
              + `Categoria: ${params.category || 'informacoes_gerais'}\n\n`
              + `REGRAS:\n`
              + `- Escreva APENAS em português do Brasil. NUNCA use outro idioma.\n`
              + `- Inclua informações práticas: endereços famosos, faixas de preço, horários típicos, dicas de como aproveitar.\n`
              + `- Use conhecimento geral e consolidado — NÃO invente nomes de estabelecimentos.\n`
              + `- Se citar locais, use apenas os mais conhecidos e tradicionais do destino.\n`
              + `- Tom profissional mas acessível, como um consultor de viagens experiente.\n`
              + `- NÃO use blocos <<<ACTION>>>. Retorne APENAS o texto da dica, sem formatação markdown.`,
              {},
              { moduleId: 'portal-tips', history: [] }
            );
            let generatedText = genResult?.text || '';
            // Limpar: remover blocos ACTION residuais
            generatedText = generatedText.replace(/<<<[A-Z_]+>>>[\s\S]*?<<<END_[A-Z_]+>>>/g, '').trim();
            // Limpar: remover texto em outros idiomas (chinês, japonês, coreano, etc)
            generatedText = generatedText.replace(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]+[^.]*[.。]?\s*/g, '').trim();
            // Limpar: remover linhas que parecem meta-instruções
            generatedText = generatedText.split('\n').filter(l => !/^(aqui|segue|abaixo|clar[oa]|cert[oa])/i.test(l.trim())).join('\n').trim();
            if (generatedText.length > 50) {
              content = generatedText;
              wasGenerated = true;
            }
          } catch (e) {
            console.warn('[create_tip] Falha ao gerar conteúdo via IA:', e.message);
          }
        }

        const { saveTip } = await import('./portal.js');
        const id = await saveTip(null, {
          destinationId: params.destinationId,
          title: params.title || '',
          category: params.category || 'informacoes_gerais',
          content,
          priority: params.priority || false,
        });

        const hasContent = content.length > 50;
        let msg = `Dica "${params.title}" criada`;
        if (hasContent) {
          msg += ` com ${content.length} caracteres de conteúdo`;
          if (wasGenerated) {
            msg += `.\n\n⚠️ IMPORTANTE: O conteúdo foi gerado com base em conhecimento geral da IA e pode conter informações desatualizadas (preços, horários, estabelecimentos que fecharam). `
              + `Recomendamos que a equipe revise e valide o conteúdo antes de publicar, especialmente informações de restaurantes, atrações e valores.`;
          }
        } else {
          msg += ' (sem conteúdo — edite manualmente)';
        }

        showToast('success', `Dica "${params.title}" criada${hasContent ? ' com conteúdo!' : '!'}`);
        return {
          success: true,
          message: msg + '!',
          data: { tipId: id, title: params.title },
        };
      },
    },
    {
      name: 'update_tip',
      description: 'Atualizar o conteúdo de uma dica existente',
      params: {
        tipId: 'string — ID da dica (obrigatório)',
        title: 'string — novo título (opcional)',
        content: 'string — novo conteúdo (opcional)',
        category: 'string — nova categoria (opcional)',
      },
      execute: async (params) => {
        if (!params.tipId) return { success: false, message: 'tipId é obrigatório' };
        const { saveTip } = await import('./portal.js');
        const { tipId, ...data } = params;
        // Remover campos vazios
        Object.keys(data).forEach(k => { if (!data[k]) delete data[k]; });
        await saveTip(tipId, data);
        showToast('success', 'Dica atualizada!');
        return { success: true, message: 'Dica atualizada com sucesso!' };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * FEEDBACKS — Feedbacks e Pesquisas
   * ═══════════════════════════════════════════════════════════ */
  feedbacks: [
    {
      name: 'list_feedbacks',
      description: 'Listar feedbacks registrados no sistema',
      params: { limitN: 'number — limitar quantidade (default: 20)' },
      execute: async (params) => {
        const { fetchFeedbacks } = await import('./feedbacks.js');
        const feedbacks = await fetchFeedbacks();
        const summary = feedbacks.slice(0, params?.limitN || 20).map(f => ({
          id: f.id,
          title: f.title || f.type || '',
          type: f.type || '',
          status: f.status || '',
          rating: f.rating || '',
          customer: f.customer || f.customerName || '',
          createdAt: f.createdAt?.toDate?.()?.toLocaleDateString?.('pt-BR') || '',
        }));
        return { success: true, data: summary, message: `${feedbacks.length} feedback(s)` };
      },
    },
    {
      name: 'get_feedback',
      description: 'Obter detalhes de um feedback específico',
      params: { feedbackId: 'string — ID do feedback (obrigatório)' },
      execute: async ({ feedbackId }) => {
        const { fetchFeedback } = await import('./feedbacks.js');
        const fb = await fetchFeedback(feedbackId);
        if (!fb) return { success: false, message: 'Feedback não encontrado' };
        return {
          success: true,
          data: {
            id: fb.id, title: fb.title, type: fb.type, status: fb.status,
            rating: fb.rating, customer: fb.customer || fb.customerName,
            text: (fb.feedbackText || fb.description || '').substring(0, 300),
          },
          message: `Feedback: ${fb.title || feedbackId}`,
        };
      },
    },
    {
      name: 'create_feedback',
      description: 'Registrar um novo feedback no sistema',
      params: {
        title: 'string — título do feedback (obrigatório)',
        type: 'string — tipo: elogio, sugestao, reclamacao, outro (default: outro)',
        description: 'string — descrição detalhada (opcional)',
        customer: 'string — nome do cliente (opcional)',
        rating: 'number — nota de 1 a 5 (opcional)',
      },
      execute: async (params) => {
        const { saveFeedback } = await import('./feedbacks.js');
        await saveFeedback(null, {
          title: params.title,
          type: params.type || 'outro',
          description: params.description || '',
          feedbackText: params.description || '',
          customer: params.customer || '',
          customerName: params.customer || '',
          rating: params.rating || null,
          status: 'novo',
        });
        return { success: true, message: `Feedback "${params.title}" registrado!` };
      },
    },
    {
      name: 'update_feedback',
      description: 'Atualizar dados de um feedback existente',
      params: {
        feedbackId: 'string — ID do feedback (obrigatório)',
        title: 'string — novo título (opcional)',
        type: 'string — positive, negative, mixed, development (opcional)',
        description: 'string — nova descrição (opcional)',
        rating: 'number — nova nota 1-5 (opcional)',
        status: 'string — novo status (opcional)',
      },
      execute: async (params) => {
        const { saveFeedback } = await import('./feedbacks.js');
        const { feedbackId, ...data } = params;
        if (data.description) data.feedbackText = data.description;
        Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
        await saveFeedback(feedbackId, data);
        return { success: true, message: 'Feedback atualizado!' };
      },
    },
    {
      name: 'delete_feedback',
      description: 'Excluir um feedback',
      params: { feedbackId: 'string — ID do feedback (obrigatório)' },
      execute: async ({ feedbackId }) => {
        const { deleteFeedback } = await import('./feedbacks.js');
        await deleteFeedback(feedbackId);
        showToast('success', 'Feedback excluído!');
        return { success: true, message: 'Feedback excluído!' };
      },
    },
    {
      name: 'get_feedback_summary',
      description: 'Obter resumo de feedbacks (total, por tipo, rating médio)',
      params: {},
      execute: async () => {
        const { fetchFeedbacks } = await import('./feedbacks.js');
        const feedbacks = await fetchFeedbacks();
        const byType = {};
        let totalRating = 0, ratingCount = 0;
        feedbacks.forEach(f => {
          byType[f.type || 'outro'] = (byType[f.type || 'outro'] || 0) + 1;
          if (f.rating) { totalRating += f.rating; ratingCount++; }
        });
        return {
          success: true,
          data: {
            total: feedbacks.length,
            byType,
            avgRating: ratingCount > 0 ? (totalRating / ratingCount).toFixed(1) : 'N/A',
          },
          message: `${feedbacks.length} feedback(s) no total`,
        };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * GOALS — Metas e OKRs
   * ═══════════════════════════════════════════════════════════ */
  goals: [
    {
      name: 'list_goals',
      description: 'Listar metas/goals cadastradas no sistema',
      params: { status: 'string — filtrar por status (opcional)' },
      execute: async (params) => {
        const { fetchGoals } = await import('./goals.js');
        let goals = await fetchGoals();
        if (params?.status) goals = goals.filter(g => g.status === params.status);
        const summary = goals.slice(0, 20).map(g => ({
          id: g.id,
          title: g.title || g.name || '',
          status: g.status || '',
          period: g.period || '',
          progress: g.progress || 0,
        }));
        return { success: true, data: summary, message: `${goals.length} meta(s)` };
      },
    },
    {
      name: 'get_goal',
      description: 'Obter detalhes de uma meta específica',
      params: { goalId: 'string — ID da meta (obrigatório)' },
      execute: async ({ goalId }) => {
        const { fetchGoal } = await import('./goals.js');
        const goal = await fetchGoal(goalId);
        if (!goal) return { success: false, message: 'Meta não encontrada' };
        return {
          success: true,
          data: {
            id: goal.id, title: goal.title, status: goal.status,
            period: goal.period, progress: goal.progress,
            pilares: goal.pilares?.length || 0,
            kpis: goal.pilares?.reduce((acc, p) => acc + (p.kpis?.length || 0), 0) || 0,
          },
          message: `Meta: ${goal.title || goalId}`,
        };
      },
    },
    {
      name: 'create_goal',
      description: 'Criar uma nova meta/OKR',
      params: {
        title: 'string — título da meta (obrigatório)',
        period: 'string — período (ex: 2026-Q1, 2026-S1, 2026) (opcional)',
        description: 'string — descrição (opcional)',
        scope: 'string — individual, nucleo, area (default: individual)',
      },
      execute: async (params) => {
        const { saveGoal, emptyGoal } = await import('./goals.js');
        const goal = emptyGoal ? emptyGoal() : {};
        goal.title = params.title;
        goal.period = params.period || '';
        goal.description = params.description || '';
        goal.scope = params.scope || 'individual';
        goal.status = 'draft';
        const id = await saveGoal(null, goal);
        showToast('success', `Meta "${params.title}" criada!`);
        return { success: true, message: `Meta "${params.title}" criada!`, data: { goalId: id } };
      },
    },
    {
      name: 'update_goal',
      description: 'Atualizar dados de uma meta existente',
      params: {
        goalId: 'string — ID da meta (obrigatório)',
        title: 'string — novo título (opcional)',
        description: 'string — nova descrição (opcional)',
        period: 'string — novo período (opcional)',
        status: 'string — draft, publicada, encerrada (opcional)',
      },
      execute: async (params) => {
        const { saveGoal } = await import('./goals.js');
        const { goalId, ...data } = params;
        Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
        await saveGoal(goalId, data);
        return { success: true, message: 'Meta atualizada!' };
      },
    },
    {
      name: 'publish_goal',
      description: 'Publicar uma meta (muda status de draft para publicada e notifica responsáveis)',
      params: { goalId: 'string — ID da meta (obrigatório)' },
      execute: async ({ goalId }) => {
        const { publishGoal } = await import('./goals.js');
        await publishGoal(goalId);
        showToast('success', 'Meta publicada!');
        return { success: true, message: 'Meta publicada e responsáveis notificados!' };
      },
    },
    {
      name: 'delete_goal',
      description: 'Excluir uma meta',
      params: { goalId: 'string — ID da meta (obrigatório)' },
      execute: async ({ goalId }) => {
        const { deleteGoal } = await import('./goals.js');
        await deleteGoal(goalId);
        showToast('success', 'Meta excluída!');
        return { success: true, message: 'Meta excluída!' };
      },
    },
    {
      name: 'get_goals_summary',
      description: 'Obter resumo geral das metas (total, por status, progresso médio)',
      params: {},
      execute: async () => {
        const { fetchGoals } = await import('./goals.js');
        const goals = await fetchGoals();
        const byStatus = {};
        let totalProgress = 0;
        goals.forEach(g => {
          byStatus[g.status || 'sem_status'] = (byStatus[g.status || 'sem_status'] || 0) + 1;
          totalProgress += (g.progress || 0);
        });
        return {
          success: true,
          data: {
            total: goals.length,
            byStatus,
            avgProgress: goals.length > 0 ? (totalProgress / goals.length).toFixed(1) + '%' : 'N/A',
          },
          message: `${goals.length} meta(s) cadastrada(s)`,
        };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * CALENDAR — Calendário de Eventos
   * ═══════════════════════════════════════════════════════════ */
  calendar: [
    {
      name: 'list_events',
      description: 'Listar eventos do calendário (captura da tela visível ou store)',
      params: {},
      execute: async () => {
        // Tentar ler do DOM / store
        const events = store.get('calendarEvents') || [];
        if (events.length) {
          const summary = events.slice(0, 30).map(e => ({
            title: e.title || '', start: e.start || '', end: e.end || '', type: e.type || '',
          }));
          return { success: true, data: summary, message: `${events.length} evento(s)` };
        }
        // Fallback: ler do DOM
        const cards = document.querySelectorAll('.fc-event, .calendar-event, [class*="event"]');
        const domEvents = [...cards].slice(0, 20).map(c => ({
          title: c.textContent?.trim()?.substring(0, 60) || '',
        }));
        return { success: true, data: domEvents, message: `${domEvents.length} evento(s) visível(is)` };
      },
    },
    {
      name: 'get_today_agenda',
      description: 'Obter a agenda de hoje (tarefas com vencimento hoje + eventos)',
      params: {},
      execute: async () => {
        const { fetchTasks } = await import('./tasks.js');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const tasks = await fetchTasks({ limitN: 100 });
        const todayTasks = tasks.filter(t => {
          const d = t.dueDate?.toDate?.() || (t.dueDate ? new Date(t.dueDate) : null);
          return d && d >= today && d < tomorrow;
        });

        const summary = todayTasks.map(t => ({
          id: t.id, title: t.title, status: t.status, priority: t.priority,
          dueDate: t.dueDate?.toDate?.()?.toLocaleTimeString?.('pt-BR', { hour: '2-digit', minute: '2-digit' }) || '',
        }));
        return { success: true, data: summary, message: `${todayTasks.length} tarefa(s) para hoje` };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * DASHBOARD — Dashboards Analíticos
   * ═══════════════════════════════════════════════════════════ */
  dashboards: [
    {
      name: 'get_dashboard_summary',
      description: 'Obter resumo dos KPIs visíveis no dashboard atual (captura do DOM)',
      params: {},
      execute: async () => {
        const stats = scrapeVisibleStats();
        return { success: true, data: stats, message: `${stats.length} KPI(s) capturado(s) do dashboard` };
      },
    },
    {
      name: 'get_tasks_overview',
      description: 'Obter visão geral de tarefas para análise no dashboard',
      params: {},
      execute: async () => {
        const { fetchTasks } = await import('./tasks.js');
        const tasks = await fetchTasks({ limitN: 500 });
        const byStatus = {};
        const byPriority = {};
        const bySector = {};
        let overdue = 0;
        const now = new Date();
        tasks.forEach(t => {
          byStatus[t.status] = (byStatus[t.status] || 0) + 1;
          byPriority[t.priority] = (byPriority[t.priority] || 0) + 1;
          if (t.sector) bySector[t.sector] = (bySector[t.sector] || 0) + 1;
          const d = t.dueDate?.toDate?.() || (t.dueDate ? new Date(t.dueDate) : null);
          if (d && d < now && t.status !== 'done' && t.status !== 'cancelled') overdue++;
        });
        return {
          success: true,
          data: { total: tasks.length, byStatus, byPriority, bySector, overdue },
          message: `${tasks.length} tarefa(s), ${overdue} atrasada(s)`,
        };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * REQUESTS — Solicitações
   * ═══════════════════════════════════════════════════════════ */
  requests: [
    {
      name: 'list_requests',
      description: 'Listar solicitações do sistema',
      params: { status: 'string — filtrar por status: pending, approved, rejected, converted (opcional)' },
      execute: async (params) => {
        const { fetchRequests } = await import('./requests.js');
        let requests = await fetchRequests();
        if (params?.status) requests = requests.filter(r => r.status === params.status);
        const summary = requests.slice(0, 20).map(r => ({
          id: r.id,
          title: r.title || r.description?.substring(0, 50) || '',
          type: r.type || '',
          status: r.status || '',
          requester: r.requesterName || r.requester || '',
          createdAt: r.createdAt?.toDate?.()?.toLocaleDateString?.('pt-BR') || '',
        }));
        return { success: true, data: summary, message: `${requests.length} solicitação(ões)` };
      },
    },
    {
      name: 'create_request',
      description: 'Criar uma nova solicitação no sistema',
      params: {
        requesterName: 'string — nome do solicitante (obrigatório)',
        requesterEmail: 'string — email do solicitante (obrigatório)',
        typeName: 'string — tipo da solicitação (opcional)',
        description: 'string — descrição detalhada (obrigatório)',
        urgency: 'boolean — marcar como urgente (default: false)',
        desiredDate: 'string — data desejada YYYY-MM-DD (opcional)',
        nucleo: 'string — núcleo/departamento (opcional)',
        sector: 'string — setor (opcional)',
      },
      execute: async (params) => {
        const { createRequest } = await import('./requests.js');
        const req = await createRequest({
          requesterName: params.requesterName || 'Via Assistente IA',
          requesterEmail: params.requesterEmail || '',
          typeName: params.typeName || '',
          description: params.description || '',
          urgency: params.urgency === true,
          desiredDate: params.desiredDate || null,
          nucleo: params.nucleo || '',
          sector: params.sector || '',
        });
        return { success: true, message: `Solicitação de "${params.requesterName}" criada!`, data: { requestId: req?.id } };
      },
    },
    {
      name: 'approve_request',
      description: 'Aprovar uma solicitação pendente',
      params: {
        requestId: 'string — ID da solicitação (obrigatório)',
        notes: 'string — observações da aprovação (opcional)',
      },
      execute: async ({ requestId, notes }) => {
        const { updateRequestStatus } = await import('./requests.js');
        await updateRequestStatus(requestId, 'approved', notes || '');
        return { success: true, message: 'Solicitação aprovada!' };
      },
    },
    {
      name: 'reject_request',
      description: 'Rejeitar uma solicitação pendente',
      params: {
        requestId: 'string — ID da solicitação (obrigatório)',
        reason: 'string — motivo da rejeição (obrigatório)',
      },
      execute: async ({ requestId, reason }) => {
        const { updateRequestStatus } = await import('./requests.js');
        await updateRequestStatus(requestId, 'rejected', reason || '');
        return { success: true, message: 'Solicitação rejeitada.' };
      },
    },
    {
      name: 'convert_request_to_task',
      description: 'Converter uma solicitação aprovada em tarefa',
      params: { requestId: 'string — ID da solicitação (obrigatório)' },
      execute: async ({ requestId }) => {
        const { convertToTask } = await import('./requests.js');
        const taskId = await convertToTask(requestId);
        return { success: true, message: 'Solicitação convertida em tarefa!', taskId };
      },
    },
    {
      name: 'get_requests_summary',
      description: 'Obter resumo de solicitações (total, por status)',
      params: {},
      execute: async () => {
        const { fetchRequests } = await import('./requests.js');
        const requests = await fetchRequests();
        const byStatus = {};
        requests.forEach(r => {
          byStatus[r.status || 'sem_status'] = (byStatus[r.status || 'sem_status'] || 0) + 1;
        });
        return {
          success: true,
          data: { total: requests.length, byStatus },
          message: `${requests.length} solicitação(ões) no total`,
        };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * CSAT — Pesquisas de Satisfação
   * ═══════════════════════════════════════════════════════════ */
  csat: [
    {
      name: 'list_surveys',
      description: 'Listar pesquisas CSAT',
      params: {
        status: 'string — filtrar: pending, sent, responded, expired, cancelled (opcional)',
        search: 'string — buscar por nome do cliente (opcional)',
      },
      execute: async (params) => {
        const { fetchSurveys } = await import('./csat.js');
        let surveys = await fetchSurveys();
        if (params?.status) surveys = surveys.filter(s => s.status === params.status);
        if (params?.search) {
          const s = params.search.toLowerCase();
          surveys = surveys.filter(sv => ((sv.customerName || sv.customerEmail || '').toLowerCase().includes(s)));
        }
        const summary = surveys.slice(0, 20).map(s => ({
          id: s.id,
          customer: s.customerName || s.customerEmail || '',
          status: s.status || '',
          score: s.score ?? '',
          taskTitle: s.taskTitle || '',
          sentAt: s.sentAt?.toDate?.()?.toLocaleDateString?.('pt-BR') || '',
        }));
        return { success: true, data: summary, message: `${surveys.length} pesquisa(s)` };
      },
    },
    {
      name: 'create_survey',
      description: 'Criar uma pesquisa CSAT para um cliente (vinculada a uma tarefa)',
      params: {
        taskId: 'string — ID da tarefa (obrigatório)',
        taskTitle: 'string — título da tarefa (obrigatório)',
        clientEmail: 'string — email do cliente (obrigatório)',
        clientName: 'string — nome do cliente (opcional)',
        customMessage: 'string — mensagem personalizada (opcional)',
      },
      execute: async (params) => {
        if (!params.taskId || !params.clientEmail) return { success: false, message: 'taskId e clientEmail são obrigatórios' };
        const { createCsatSurvey } = await import('./csat.js');
        const user = store.get('currentUser');
        const survey = await createCsatSurvey({
          taskId: params.taskId,
          taskTitle: params.taskTitle || '',
          clientEmail: params.clientEmail,
          clientName: params.clientName || '',
          assignedTo: user?.uid || '',
          customMessage: params.customMessage || '',
        });
        showToast('success', `Pesquisa CSAT criada para ${params.clientName || params.clientEmail}!`);
        return { success: true, message: `Pesquisa CSAT criada!`, data: { surveyId: survey?.id || '' } };
      },
    },
    {
      name: 'send_survey',
      description: 'Enviar uma pesquisa CSAT por email ao cliente',
      params: { surveyId: 'string — ID da pesquisa (obrigatório)' },
      execute: async ({ surveyId }) => {
        const { sendCsatEmail } = await import('./csat.js');
        await sendCsatEmail(surveyId);
        showToast('success', 'Pesquisa CSAT enviada!');
        return { success: true, message: 'Email de pesquisa enviado ao cliente!' };
      },
    },
    {
      name: 'cancel_survey',
      description: 'Cancelar uma pesquisa CSAT pendente',
      params: { surveyId: 'string — ID da pesquisa (obrigatório)' },
      execute: async ({ surveyId }) => {
        const { cancelSurvey } = await import('./csat.js');
        await cancelSurvey(surveyId);
        return { success: true, message: 'Pesquisa cancelada!' };
      },
    },
    {
      name: 'resend_survey',
      description: 'Reenviar uma pesquisa CSAT (reseta expiry e envia novamente)',
      params: { surveyId: 'string — ID da pesquisa (obrigatório)' },
      execute: async ({ surveyId }) => {
        const { resendSurvey } = await import('./csat.js');
        await resendSurvey(surveyId);
        showToast('success', 'Pesquisa reenviada!');
        return { success: true, message: 'Pesquisa reenviada com nova validade!' };
      },
    },
    {
      name: 'find_tasks_without_csat',
      description: 'Encontrar tarefas concluídas que ainda não têm pesquisa CSAT',
      params: { periodDays: 'number — buscar nos últimos N dias (default: 30)' },
      execute: async (params) => {
        const { findTasksWithoutCsat } = await import('./csat.js');
        const tasks = await findTasksWithoutCsat({ periodDays: params?.periodDays || 30 });
        const summary = tasks.slice(0, 20).map(t => ({
          id: t.id, title: t.title, clientEmail: t.clientEmail || '',
          completedAt: t.completedAt?.toDate?.()?.toLocaleDateString?.('pt-BR') || '',
        }));
        return { success: true, data: summary, message: `${tasks.length} tarefa(s) sem CSAT` };
      },
    },
    {
      name: 'get_csat_metrics',
      description: 'Calcular métricas CSAT (score médio, NPS, taxa de resposta)',
      params: {},
      execute: async () => {
        const { fetchSurveys, calcCsatMetrics } = await import('./csat.js');
        const surveys = await fetchSurveys();
        const metrics = calcCsatMetrics(surveys);
        return {
          success: true,
          data: metrics,
          message: `CSAT: ${metrics.avgScore?.toFixed?.(1) || 'N/A'} | Respondidas: ${metrics.answered || 0}/${metrics.total || 0}`,
        };
      },
    },
    {
      name: 'get_csat_dom_summary',
      description: 'Obter resumo de CSAT/NPS visível na tela atual',
      params: {},
      execute: async () => {
        const stats = scrapeVisibleStats();
        return { success: true, data: stats, message: `${stats.length} métrica(s) CSAT visível(is)` };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * NEWS-MONITOR — Notícias do setor + Clipping da empresa
   * ═══════════════════════════════════════════════════════════ */
  'news-monitor': [
    {
      name: 'list_news',
      description: 'Listar notícias cadastradas no sistema',
      params: {
        category: 'string — filtrar: Hotelaria, Cruzeiros, Destinos, Companhias Aéreas, Mercado, Sistemas, Agências e Operadoras (opcional)',
        subcategory: 'string — filtrar: Notícias, Curiosidades, Dicas, Tendências, Insights, Eventos, Tecnologia, Sustentabilidade, Educação (opcional)',
        search: 'string — busca por texto livre (opcional)',
      },
      execute: async (params) => {
        const { fetchNews } = await import('./newsMonitor.js');
        const items = await fetchNews(params || {});
        const summary = items.slice(0, 20).map(n => ({
          id: n.id,
          title: n.title || '',
          category: n.category || '',
          subcategory: n.subcategory || '',
          source: n.sourceName || n.sourceUrl || '',
          publishedAt: n.publishedAt?.toDate?.()?.toLocaleDateString?.('pt-BR') || '',
        }));
        return { success: true, data: summary, message: `${items.length} notícia(s) encontrada(s)` };
      },
    },
    {
      name: 'create_news',
      description: 'Cadastrar uma nova notícia no monitor. Use para salvar notícias encontradas na web.',
      params: {
        title: 'string — título da notícia (obrigatório)',
        description: 'string — resumo/descrição da notícia',
        sourceUrl: 'string — URL da fonte original',
        sourceName: 'string — nome do veículo/site (ex: Panrotas, Travel3)',
        category: 'string — Hotelaria, Cruzeiros, Destinos, Companhias Aéreas, Mercado, Sistemas, Agências e Operadoras',
        subcategory: 'string — Notícias, Curiosidades, Dicas, Tendências, Insights, Eventos, Tecnologia, Sustentabilidade, Educação',
        publishedAt: 'string — data de publicação YYYY-MM-DD (default: hoje)',
        expiresAt: 'string — data de expiração YYYY-MM-DD (opcional)',
        thumbnail: 'string — URL da imagem/thumbnail (opcional)',
      },
      execute: async (params) => {
        if (!params.title) return { success: false, message: 'Título é obrigatório.' };
        const { saveNewsItem, fetchUrlMetadata } = await import('./newsMonitor.js');
        // Tentar buscar metadados da URL se não informou thumbnail/sourceName
        let meta = {};
        if (params.sourceUrl && (!params.thumbnail || !params.sourceName)) {
          try { meta = await fetchUrlMetadata(params.sourceUrl); } catch {}
        }
        const pubDate = params.publishedAt
          ? new Date(params.publishedAt + 'T12:00:00')
          : new Date();
        const data = {
          title: params.title,
          description: params.description || '',
          sourceUrl: params.sourceUrl || '',
          sourceName: params.sourceName || meta.siteName || '',
          category: params.category || 'Mercado',
          subcategory: params.subcategory || 'Notícias',
          publishedAt: pubDate,
          thumbnail: params.thumbnail || meta.thumbnail || '',
        };
        if (params.expiresAt) data.expiresAt = params.expiresAt;
        const id = await saveNewsItem(null, data);
        showToast('success', `Notícia "${params.title}" cadastrada!`);
        return { success: true, message: `Notícia "${params.title}" cadastrada!`, data: { newsId: id, title: params.title } };
      },
    },
    {
      name: 'update_news',
      description: 'Atualizar uma notícia existente',
      params: {
        newsId: 'string — ID da notícia (obrigatório)',
        title: 'string — novo título (opcional)',
        description: 'string — nova descrição (opcional)',
        category: 'string — nova categoria (opcional)',
        subcategory: 'string — nova subcategoria (opcional)',
      },
      execute: async (params) => {
        if (!params.newsId) return { success: false, message: 'newsId é obrigatório' };
        const { saveNewsItem } = await import('./newsMonitor.js');
        const { newsId, ...data } = params;
        Object.keys(data).forEach(k => { if (!data[k]) delete data[k]; });
        await saveNewsItem(newsId, data);
        showToast('success', 'Notícia atualizada!');
        return { success: true, message: 'Notícia atualizada!' };
      },
    },
    {
      name: 'list_clippings',
      description: 'Listar clippings (citações da PRIMETOUR na mídia)',
      params: {
        sentiment: 'string — filtrar: positive, neutral, negative (opcional)',
      },
      execute: async (params) => {
        const { fetchClippings } = await import('./newsMonitor.js');
        let items = await fetchClippings();
        if (params?.sentiment) items = items.filter(c => c.sentiment === params.sentiment);
        const summary = items.slice(0, 20).map(c => ({
          id: c.id,
          title: c.title || '',
          mediaType: c.mediaType || '',
          contentType: c.contentType || '',
          sentiment: c.sentiment || '',
          sourceName: c.sourceName || '',
          publishedAt: c.publishedAt?.toDate?.()?.toLocaleDateString?.('pt-BR') || '',
        }));
        return { success: true, data: summary, message: `${items.length} clipping(s)` };
      },
    },
    {
      name: 'create_clipping',
      description: 'Cadastrar um novo clipping (citação/menção da PRIMETOUR na mídia). Use para registrar menções encontradas na internet.',
      params: {
        title: 'string — título da matéria/menção (obrigatório)',
        description: 'string — resumo do conteúdo/contexto da citação',
        sourceUrl: 'string — URL da matéria/publicação',
        sourceName: 'string — nome do veículo (ex: Folha de S.Paulo, Panrotas)',
        mediaType: 'string — Digital, Impresso ou Televisivo (default: Digital)',
        contentType: 'string — Negócios, Análises, Tendências, Novidades, Publieditorial, Eventos',
        sentiment: 'string — positive, neutral ou negative',
        publishedAt: 'string — data de publicação YYYY-MM-DD (default: hoje)',
        excerpt: 'string — trecho relevante da citação (opcional)',
      },
      execute: async (params) => {
        if (!params.title) return { success: false, message: 'Título é obrigatório.' };
        const { saveClipping, fetchUrlMetadata } = await import('./newsMonitor.js');
        let meta = {};
        if (params.sourceUrl && !params.sourceName) {
          try { meta = await fetchUrlMetadata(params.sourceUrl); } catch {}
        }
        const pubDate = params.publishedAt
          ? new Date(params.publishedAt + 'T12:00:00')
          : new Date();
        const data = {
          title: params.title,
          description: params.description || '',
          sourceUrl: params.sourceUrl || '',
          sourceName: params.sourceName || meta.siteName || '',
          mediaType: params.mediaType || 'Digital',
          contentType: params.contentType || 'Novidades',
          sentiment: params.sentiment || 'neutral',
          publishedAt: pubDate,
          excerpt: params.excerpt || '',
          thumbnail: meta.thumbnail || '',
        };
        const id = await saveClipping(null, data);
        showToast('success', `Clipping "${params.title}" cadastrado!`);
        return { success: true, message: `Clipping "${params.title}" cadastrado!`, data: { clippingId: id, title: params.title } };
      },
    },
    {
      name: 'search_web_news',
      description: 'Buscar notícias REAIS e recentes na web. Retorna links, títulos e resumos atuais para cadastrar via create_news.',
      params: {
        query: 'string — termo de busca (ex: "novos voos para Miami", "tendências hotelaria 2026") (obrigatório)',
        sites: 'string — limitar a sites específicos (ex: "panrotas.com.br,mercadoeventos.com.br") (opcional)',
      },
      execute: async (params) => {
        if (!params.query) return { success: false, message: 'query é obrigatória' };
        const results = await searchWeb(params.query, params.sites);
        if (!results.length) {
          return { success: true, data: [], message: 'Nenhum resultado encontrado. Tente termos diferentes.' };
        }
        return {
          success: true,
          data: results,
          message: `${results.length} resultado(s) encontrado(s). Avalie os resultados e use create_news para cadastrar os relevantes.`,
        };
      },
    },
    {
      name: 'search_web_clipping',
      description: 'Buscar menções/citações recentes da PRIMETOUR na internet para clipping.',
      params: {
        additionalTerms: 'string — termos extras além de "PRIMETOUR" (ex: "Prime Tour Viagens") (opcional)',
      },
      execute: async (params) => {
        const terms = ['PRIMETOUR turismo', 'Prime Tour Viagens'];
        if (params?.additionalTerms) terms.push(params.additionalTerms);
        const query = terms.join(' OR ');
        const results = await searchWeb(query);
        if (!results.length) {
          return { success: true, data: [], message: 'Nenhuma menção encontrada. Tente termos adicionais.' };
        }
        return {
          success: true,
          data: results,
          message: `${results.length} resultado(s) encontrado(s). Avalie e use create_clipping para cadastrar as menções relevantes.`,
        };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * GENERAL — Módulos administrativos (users, settings, etc.)
   * ═══════════════════════════════════════════════════════════ */
  general: [
    {
      name: 'get_system_overview',
      description: 'Obter visão geral do sistema (KPIs visíveis na tela)',
      params: {},
      execute: async () => {
        const stats = scrapeVisibleStats();
        return { success: true, data: stats, message: `${stats.length} dado(s) capturado(s) da tela` };
      },
    },
    {
      name: 'list_notifications',
      description: 'Listar notificações do usuário',
      params: { onlyUnread: 'boolean — true para mostrar apenas não lidas (default: false)' },
      execute: async () => {
        const notifications = store.get('notifications') || [];
        const unreadCount = store.get('unreadCount') || 0;
        const summary = notifications.slice(0, 15).map(n => ({
          id: n.id, title: n.title || '', message: n.message || n.body || '',
          read: n.read || false, type: n.type || '',
          createdAt: n.createdAt?.toDate?.()?.toLocaleDateString?.('pt-BR') || '',
        }));
        return { success: true, data: summary, message: `${notifications.length} notificação(ões), ${unreadCount} não lida(s)` };
      },
    },
  ],

  /* ═══════════════════════════════════════════════════════════
   * CONTENT — Gestão de Conteúdo (NL, Meta, GA Performance)
   * ═══════════════════════════════════════════════════════════ */
  content: [
    {
      name: 'get_content_metrics',
      description: 'Capturar métricas de performance de conteúdo visíveis na tela',
      params: {},
      execute: async () => {
        const stats = scrapeVisibleStats();
        return { success: true, data: stats, message: `${stats.length} métrica(s) de conteúdo` };
      },
    },
  ],
};

/* ─── Obter ações disponíveis para um módulo ─────────────── */
export function getActionsForModule(moduleId) {
  const moduleActions = MODULE_ACTIONS[moduleId] || [];
  return [...GLOBAL_ACTIONS, ...moduleActions];
}

/* ─── Formatar ações para o system prompt ────────────────── */
export function formatActionsForPrompt(moduleId) {
  const actions = getActionsForModule(moduleId);
  if (!actions.length) return '';

  // Formato compacto para economizar tokens: nome(params) — descrição curta
  const lines = actions.map(a => {
    const paramKeys = Object.keys(a.params || {});
    const required = paramKeys.filter(k => (a.params[k] || '').includes('obrigatório'));
    const optional = paramKeys.filter(k => !(a.params[k] || '').includes('obrigatório'));
    let sig = `• ${a.name}(${required.join(', ')}${optional.length ? ` [,${optional.join(',')}]` : ''})`;
    return sig;
  });

  return `
=== AÇÕES ===
Formato: <<<ACTION>>>{"action":"nome","params":{...}}<<<END_ACTION>>>
Regras: Execute SEMPRE. Seja conciso (1-2 frases + ação). NUNCA invente IDs — use IDs do histórico (>>> ID_CRIADO="xxx" <<<) ou faça list_ primeiro.
Ações:
${lines.join('\n')}
=== FIM ===`;
}

/** Formato detalhado — usado apenas quando explicitamente solicitado ou para documentação */
export function formatActionsForPromptDetailed(moduleId) {
  const actions = getActionsForModule(moduleId);
  if (!actions.length) return '';

  const lines = actions.map(a => {
    const paramEntries = Object.entries(a.params || {});
    const paramDesc = paramEntries
      .map(([k, v]) => `    - ${k}: ${v}`)
      .join('\n');
    return `• ${a.name}: ${a.description}${paramDesc ? '\n  Parâmetros:\n' + paramDesc : ''}`;
  });

  return `
=== AÇÕES DISPONÍVEIS ===
Formato para executar ações:
<<<ACTION>>>
{"action": "nome_da_acao", "params": {"param1": "valor1"}}
<<<END_ACTION>>>

REGRAS OBRIGATÓRIAS:
1. SEMPRE execute a ação. NUNCA diga "eu faria" ou "se eu pudesse" — inclua o bloco <<<ACTION>>> e o sistema executa.
2. Seja CONCISO: 1-2 frases + bloco de ação. Não repita o pedido do usuário.
3. Múltiplas ações na mesma resposta: use vários blocos <<<ACTION>>>. Ex: list_tasks para buscar ID + update_task para modificar.
4. Os blocos <<<ACTION>>> são INVISÍVEIS ao usuário — processados pelo sistema automaticamente.
5. NUNCA INVENTE IDs. IDs do Firestore são hashes como "aB3xK9qW2mNp". Se no histórico houver >>> ID_CRIADO="xxx" <<<, use "xxx" como taskId. Se NÃO encontrar o ID real no histórico, faça list_tasks PRIMEIRO para buscar.
6. Para conteúdos longos (descrições, textos), coloque DENTRO do params da ação (ex: description no update_task), não no texto da resposta.

Ações disponíveis:
${lines.join('\n')}
=== FIM DAS AÇÕES ===`;
}

/* ─── Parser: extrair ações da resposta da IA ────────────── */
export function parseActions(text) {
  const actions = [];
  let match;

  // 1. Regex principal: <<<ACTION>>>...<<<END_ACTION>>> (tolerante a variações de >)
  const regex = /<<<ACTION>>>{0,3}\s*(\{[\s\S]*?\})\s*<<<END_ACTION>>>{0,3}/g;
  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.action) actions.push(parsed);
    } catch (e) { /* JSON inválido, ignorar */ }
  }

  // 2. Fallback A: <<<ACTION>>> sem END_ACTION (modelo esqueceu de fechar)
  if (actions.length === 0) {
    const fallback = /<<<ACTION>>>{0,3}\s*(\{[\s\S]*?"action"\s*:\s*"[^"]+[\s\S]*?\})\s*$/g;
    while ((match = fallback.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.action) actions.push(parsed);
      } catch (e) { /* JSON inválido, ignorar */ }
    }
  }

  // 3. Fallback B: modelo usou tag customizada (ex: <<<CREATE_TASK>>>, <<<SHOW_TOAST>>>)
  //    Alguns modelos (llama3) inventam tags como <<<CREATE_TASK>>> em vez de <<<ACTION>>>
  if (actions.length === 0) {
    const customTag = /<<<[A-Z_]+>>>{0,3}\s*(\{[\s\S]*?"action"\s*:\s*"[^"]+[\s\S]*?\})\s*<<<END_[A-Z_]+>>>{0,3}/g;
    while ((match = customTag.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        if (parsed.action) actions.push(parsed);
      } catch (e) { /* JSON inválido, ignorar */ }
    }
  }

  // 4. Limpar params: remover valores null/undefined que modelos pequenos adicionam
  for (const a of actions) {
    if (a.params) {
      for (const key of Object.keys(a.params)) {
        if (a.params[key] === null || a.params[key] === undefined || a.params[key] === '') {
          delete a.params[key];
        }
      }
    }
  }

  return actions;
}

/* ─── Remover blocos de ação do texto exibido ────────────── */
export function cleanActionBlocks(text) {
  // 1. Remover blocos completos (com END_*)
  let clean = text.replace(/<<<[A-Z_]+>>>{0,3}[\s\S]*?<<<END_[A-Z_]+>>>{0,3}/g, '');
  // 2. Remover blocos incompletos (sem END — modelo esqueceu de fechar)
  clean = clean.replace(/<<<[A-Z_]+>>>{0,3}\s*\{[\s\S]*$/g, '');
  return clean.trim();
}

/* ─── Normalizar parâmetros (modelos pequenos enviam formatos variados) ── */
const PRIORITY_MAP = {
  'urgente': 1, 'crítica': 1, 'critical': 1, 'urgent': 1, 'máxima': 1,
  'alta': 2, 'high': 2,
  'média': 3, 'media': 3, 'medium': 3, 'normal': 3,
  'baixa': 4, 'low': 4,
};

const STATUS_MAP = {
  'pendente': 'not_started', 'pending': 'not_started', 'não iniciado': 'not_started', 'novo': 'not_started',
  'em andamento': 'in_progress', 'em_andamento': 'in_progress', 'in progress': 'in_progress', 'andamento': 'in_progress',
  'revisão': 'review', 'review': 'review', 'em revisão': 'review',
  'concluído': 'done', 'concluída': 'done', 'done': 'done', 'finalizado': 'done', 'completo': 'done',
};

async function normalizeParams(actionName, params) {
  if (!params || typeof params !== 'object') return params;
  const p = { ...params };

  // Resolver taskId se não parecer hash Firestore
  if (p.taskId) {
    p.taskId = await resolveTaskId(p.taskId);
  }

  // Normalizar priority: string → número
  if (p.priority != null) {
    if (typeof p.priority === 'string') {
      const key = p.priority.toLowerCase().trim();
      p.priority = PRIORITY_MAP[key] || 3;
    } else if (typeof p.priority === 'number' && p.priority === 5) {
      p.priority = 1; // Alguns modelos usam 5=máxima
    }
  }

  // Normalizar status: pt-BR → enum interno
  if (p.status != null && typeof p.status === 'string') {
    const key = p.status.toLowerCase().trim();
    p.status = STATUS_MAP[key] || p.status;
  } else if (p.status != null && typeof p.status === 'number') {
    // Modelo enviou número como status — remover
    delete p.status;
  }

  // Remover IDs claramente inventados (numéricos, genéricos)
  for (const idKey of ['taskId', 'assigneeId', 'projectId']) {
    if (p[idKey] != null) {
      const val = String(p[idKey]);
      // IDs Firestore são strings alfanuméricas de 20+ chars
      // Rejeitar: números puros, "user123", "proj456", "ID_CRIADO_xxx"
      if (/^\d+$/.test(val) || /^(user|proj|task|ID_CRIADO)\d*/i.test(val)) {
        if (idKey === 'taskId') {
          // taskId é obrigatório — não podemos remover, vai dar erro na ação
          // O erro será tratado pelo executeAction
        } else {
          delete p[idKey]; // params opcionais: remover silenciosamente
        }
      }
    }
  }

  return p;
}

/* ─── Mapa de aliases para ações (modelos inventam nomes alternativos) ── */
const ACTION_ALIASES = {
  'mark_as_done': 'complete_task',
  'mark_done': 'complete_task',
  'finish_task': 'complete_task',
  'close_task': 'complete_task',
  'remove_task': 'delete_task',
  'destroy_task': 'delete_task',
  'erase_task': 'delete_task',
  'edit_task': 'update_task',
  'modify_task': 'update_task',
  'change_task': 'update_task',
  'new_task': 'create_task',
  'add_task': 'create_task',
  'get_tasks': 'list_tasks',
  'search_tasks': 'list_tasks',
  'find_tasks': 'list_tasks',
  'toast': 'show_toast',
  'notify': 'show_toast',
  'message': 'show_toast',
};

/* ─── Executar uma ação ──────────────────────────────────── */
export async function executeAction(moduleId, actionName, params = {}) {
  // Resolver aliases (modelos pequenos inventam nomes de ação)
  const resolvedName = ACTION_ALIASES[actionName] || actionName;

  let actions = getActionsForModule(moduleId);
  let action = actions.find(a => a.name === resolvedName);

  // Fallback: se não encontrou no módulo atual, procurar em TODOS os módulos
  if (!action) {
    const allModuleKeys = Object.keys(MODULE_ACTIONS);
    for (const key of allModuleKeys) {
      if (key === moduleId) continue;
      const modActions = MODULE_ACTIONS[key] || [];
      action = modActions.find(a => a.name === resolvedName);
      if (action) break;
    }
  }

  if (!action) {
    return { success: false, message: `Ação "${actionName}" não encontrada` };
  }

  // Normalizar parâmetros (modelos pequenos enviam formatos variados)
  params = await normalizeParams(actionName, params);

  try {
    const result = await action.execute(params);
    // Toast de feedback (apenas para ações de escrita, não para leitura/consulta)
    const READ_ACTIONS = [
      'list_tasks','list_projects','list_roteiros','list_feedbacks','list_goals','list_events',
      'list_requests','list_destinations','list_tips','list_areas','list_images','list_surveys',
      'list_recent_clients','list_notifications',
      'get_task_summary','get_board_summary','get_project_tasks','get_dashboard_summary',
      'get_csat_summary','get_csat_dom_summary','get_csat_metrics','get_current_user',
      'get_roteiro','get_roteiro_stats','get_tip_detail','get_feedback','get_feedback_summary',
      'get_goal','get_goals_summary','get_today_agenda','get_tasks_overview',
      'get_system_overview','get_content_metrics','get_requests_summary',
    ];
    if (result.message && !READ_ACTIONS.includes(actionName)) {
      showToast(result.success ? 'success' : 'error', result.message);
    }
    return result;
  } catch (e) {
    const msg = `Erro ao executar "${actionName}": ${e.message}`;
    showToast('error', msg);
    return { success: false, message: msg };
  }
}
