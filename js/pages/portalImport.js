/**
 * PRIMETOUR — Portal de Dicas: Importação em Massa
 * Upload de múltiplos arquivos .xlsx → mapeamento automático → Firestore
 */

import { store } from '../store.js';
import { toast } from '../components/toast.js';
import {
  fetchDestinations, fetchTip, saveTip,
  SEGMENTS, DEFAULT_CATEGORIES, MONTHS,
} from '../services/portal.js';
import { parsePortalPdf } from '../services/portalPdfParser.js';

const esc = s => String(s||'').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export async function renderPortalImport(container) {
  if (!store.canCreateTip()) {
    container.innerHTML = `<div class="empty-state" style="min-height:60vh;">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-title">Acesso restrito</div>
    </div>`;
    return;
  }

  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Importação em Massa</h1>
        <p class="page-subtitle">Importe dicas de múltiplos destinos via planilha Excel</p>
      </div>
      <div class="page-header-actions" style="gap:8px;">
        <button class="btn btn-secondary btn-sm" id="download-template-btn">
          ⬇ Baixar Planilha Modelo
        </button>
        <button class="btn btn-ghost btn-sm" onclick="location.hash='portal-import-manual'"
          style="color:var(--brand-gold);">
          📖 Manual de Importação
        </button>
      </div>
    </div>

    <!-- Upload area -->
    <div class="card" style="padding:24px;margin-bottom:20px;">
      <h3 style="font-size:0.875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
        color:var(--text-muted);margin:0 0 16px;">1 · Selecionar arquivos</h3>

      <div id="import-dropzone"
        style="border:2px dashed var(--border-subtle);border-radius:var(--radius-md);
        padding:40px;text-align:center;cursor:pointer;transition:all .2s;"
        onmouseover="this.style.borderColor='var(--brand-gold)'"
        onmouseout="this.style.borderColor='var(--border-subtle)'">
        <div style="font-size:2.5rem;margin-bottom:10px;">📊</div>
        <div style="font-size:1rem;font-weight:600;margin-bottom:6px;">
          Arraste os arquivos .xlsx ou .pdf aqui ou clique para selecionar
        </div>
        <div style="font-size:0.875rem;color:var(--text-muted);">
          Aceita múltiplos arquivos · .xlsx (planilha modelo) ou .pdf (dica completa)
        </div>
        <input type="file" id="import-file-input" multiple accept=".xlsx,.xls,.pdf" style="display:none;">
      </div>

      <div id="import-file-list" style="margin-top:12px;display:flex;flex-direction:column;gap:6px;"></div>
    </div>

    <!-- Mapping review (shows after parsing) -->
    <div id="import-review" style="display:none;">
      <div class="card" style="padding:24px;margin-bottom:20px;">
        <h3 style="font-size:0.875rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
          color:var(--text-muted);margin:0 0 16px;">2 · Revisar mapeamento</h3>
        <div id="import-mapping-content"></div>
      </div>

      <div style="display:flex;gap:10px;justify-content:flex-end;margin-bottom:20px;">
        <button class="btn btn-secondary" id="import-cancel-btn">Cancelar</button>
        <button class="btn btn-primary" id="import-confirm-btn">
          ✓ Confirmar e Importar
        </button>
      </div>
    </div>

    <!-- Progress -->
    <div id="import-progress" style="display:none;">
      <div class="card" style="padding:24px;">
        <h3 style="font-size:0.875rem;font-weight:700;margin:0 0 16px;">Importando…</h3>
        <div id="import-log" style="font-size:0.8125rem;color:var(--text-secondary);
          font-family:monospace;max-height:300px;overflow-y:auto;
          background:var(--bg-surface);border-radius:var(--radius-sm);padding:12px;
          display:flex;flex-direction:column;gap:4px;"></div>
      </div>
    </div>
  `;

  // Bindings
  const dropzone  = document.getElementById('import-dropzone');
  const fileInput = document.getElementById('import-file-input');

  dropzone?.addEventListener('click', () => fileInput?.click());
  dropzone?.addEventListener('dragover', e => { e.preventDefault(); dropzone.style.borderColor = 'var(--brand-gold)'; });
  dropzone?.addEventListener('dragleave', () => dropzone.style.borderColor = 'var(--border-subtle)');
  dropzone?.addEventListener('drop', e => {
    e.preventDefault();
    dropzone.style.borderColor = 'var(--border-subtle)';
    handleFiles([...e.dataTransfer.files]);
  });
  fileInput?.addEventListener('change', () => handleFiles([...fileInput.files]));

  document.getElementById('download-template-btn')?.addEventListener('click', downloadTemplate);
}

/* ─── File handling ───────────────────────────────────────── */
let parsedImportData = [];

async function handleFiles(files) {
  const accepted = files.filter(f => /\.(xlsx?|pdf)$/i.test(f.name));
  if (!accepted.length) { toast.error('Selecione arquivos .xlsx ou .pdf'); return; }

  const list = document.getElementById('import-file-list');
  if (list) list.innerHTML = accepted.map(f => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;
      background:var(--bg-surface);border-radius:var(--radius-sm);">
      <span style="font-size:1rem;">${/\.pdf$/i.test(f.name) ? '📄' : '📊'}</span>
      <span style="flex:1;font-size:0.875rem;">${esc(f.name)}</span>
      <span style="font-size:0.75rem;color:var(--text-muted);">${(f.size/1024).toFixed(1)} KB</span>
      <span class="file-parse-status" style="font-size:0.75rem;color:var(--brand-gold);">Lendo…</span>
    </div>
  `).join('');

  // Load SheetJS se for preciso
  if (accepted.some(f => /\.xlsx?$/i.test(f.name)) && !window.XLSX) {
    await new Promise((res,rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  parsedImportData = [];
  const statusEls = list?.querySelectorAll('.file-parse-status') || [];

  for (let fi = 0; fi < accepted.length; fi++) {
    const file = accepted[fi];
    try {
      const result = /\.pdf$/i.test(file.name)
        ? await parsePortalPdf(file)
        : await parseXLSX(file);
      parsedImportData.push(...result);
      if (statusEls[fi]) {
        statusEls[fi].textContent = `✓ ${result.length} item(s)`;
        statusEls[fi].style.color = '#22C55E';
      }
    } catch(e) {
      console.error('[portalImport] parse error', e);
      if (statusEls[fi]) {
        statusEls[fi].textContent = `✗ ${e.message.slice(0,40)}`;
        statusEls[fi].style.color = '#EF4444';
      }
    }
  }

  if (parsedImportData.length) showReview();
}

async function parseXLSX(file) {
  const buffer = await file.arrayBuffer();
  const wb     = window.XLSX.read(buffer, { type: 'array', cellDates: true });
  const result = [];

  // Sheet 1: Dicas
  const dicasSheet = wb.SheetNames.find(n => n.toLowerCase().includes('dicas') || n === 'Sheet1' || n === 'Plan1');
  if (dicasSheet) {
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[dicasSheet], { defval: '' });
    for (const row of rows) {
      if (!row['destino_pais'] && !row['Destino País'] && !row['pais']) continue;
      result.push({ type: 'dica', ...normalizeRow(row) });
    }
  }

  // Sheet 2: Informações Gerais
  const infoSheet = wb.SheetNames.find(n => n.toLowerCase().includes('info') || n.toLowerCase().includes('geral'));
  if (infoSheet) {
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[infoSheet], { defval: '' });
    for (const row of rows) {
      if (!row['destino_pais'] && !row['pais']) continue;
      result.push({ type: 'info_geral', ...normalizeInfoRow(row) });
    }
  }

  return result;
}

function normalizeRow(row) {
  // Accept multiple column name variations (case-insensitive, with/without accents)
  const g = (...keys) => {
    for (const k of keys) {
      const found = Object.keys(row).find(rk => rk.toLowerCase().replace(/[_\s]/g,'') === k.toLowerCase().replace(/[_\s]/g,''));
      if (found && row[found] !== '' && row[found] !== undefined) return String(row[found]).trim();
    }
    return '';
  };
  return {
    continente: g('destino_continente','continente','continent'),
    pais:       g('destino_pais','pais','país','country'),
    cidade:     g('destino_cidade','cidade','city'),
    segmento:   g('segmento','segment'),
    categoria:  g('categoria','category'),
    titulo:     g('titulo','título','title','nome','name'),
    descricao:  g('descricao','descrição','description'),
    endereco:   g('endereco','endereço','address'),
    telefone:   g('telefone','phone'),
    site:       g('site','website','url'),
    observacoes:g('observacoes','observações','notes'),
    periodo:    g('periodo','período','period'),
  };
}

function normalizeInfoRow(row) {
  const g = (...keys) => {
    for (const k of keys) {
      const found = Object.keys(row).find(rk => rk.toLowerCase().replace(/[_\s]/g,'') === k.toLowerCase().replace(/[_\s]/g,''));
      if (found && row[found] !== '' && row[found] !== undefined) return String(row[found]).trim();
    }
    return '';
  };
  return {
    continente: g('continente','continent'),
    pais:       g('pais','país','country'),
    cidade:     g('cidade','city'),
    descricao:  g('descricao','descrição'),
    populacao:  g('populacao','população'),
    moeda:      g('moeda','currency'),
    lingua:     g('lingua','língua','language'),
    religiao:   g('religiao','religião','religion'),
    fuso:       g('fuso','timezone'),
    voltagem:   g('voltagem','voltage'),
    ddd:        g('ddd'),
  };
}

/* ─── Review ──────────────────────────────────────────────── */
function showReview() {
  const review = document.getElementById('import-review');
  if (review) review.style.display = 'block';

  // Group by destination
  const byDest = {};
  for (const row of parsedImportData) {
    const key = `${row.continente}|${row.pais}|${row.cidade}`;
    if (!byDest[key]) byDest[key] = { continente: row.continente, pais: row.pais, cidade: row.cidade, items: [] };
    byDest[key].items.push(row);
  }

  const content = document.getElementById('import-mapping-content');
  if (!content) return;

  content.innerHTML = `
    <div style="margin-bottom:12px;font-size:0.875rem;color:var(--text-secondary);">
      <strong>${Object.keys(byDest).length}</strong> destino(s) identificado(s) ·
      <strong>${parsedImportData.length}</strong> item(s) total.
      Verifique os dados antes de confirmar.
    </div>
    <div style="display:flex;flex-direction:column;gap:10px;max-height:400px;overflow-y:auto;">
      ${Object.entries(byDest).map(([key, dest]) => `
        <div style="border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:14px;">
          <div style="font-weight:700;font-size:0.9375rem;margin-bottom:8px;">
            ✈ ${esc([dest.cidade, dest.pais, dest.continente].filter(Boolean).join(', '))}
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;">
            ${[...new Set(dest.items.map(i => i.segmento).filter(Boolean))].map(s =>
              `<span style="font-size:0.75rem;padding:2px 8px;background:var(--bg-surface);
                border-radius:var(--radius-full);border:1px solid var(--border-subtle);">
                ${esc(s)} (${dest.items.filter(i=>i.segmento===s).length})
              </span>`).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('import-confirm-btn')?.addEventListener('click', () => runImport(byDest));
  document.getElementById('import-cancel-btn')?.addEventListener('click', () => {
    if (review) review.style.display = 'none';
    parsedImportData = [];
    document.getElementById('import-file-list').innerHTML = '';
  });
}

/* ─── Import ──────────────────────────────────────────────── */
async function runImport(byDest) {
  document.getElementById('import-review').style.display   = 'none';
  document.getElementById('import-progress').style.display = 'block';
  const log = document.getElementById('import-log');
  const addLog = (msg, color='var(--text-secondary)') => {
    if (!log) return;
    const el = document.createElement('div');
    el.style.color = color;
    el.textContent = msg;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  };

  addLog('Iniciando importação…');
  let imported = 0, errors = 0;

  const allDests = await fetchDestinations();

  for (const [, dest] of Object.entries(byDest)) {
    const label = [dest.cidade, dest.pais, dest.continente].filter(Boolean).join(', ');
    addLog(`\n📍 ${label}`);

    // Find destination in Firestore
    let destDoc = allDests.find(d =>
      d.country === dest.pais &&
      (!dest.continente || d.continent === dest.continente) &&
      (!dest.cidade || d.city === dest.cidade)
    );

    if (!destDoc) {
      addLog(`  ⚠ Destino não encontrado no sistema — pulando. Cadastre primeiro em Destinos.`, '#F59E0B');
      errors++;
      continue;
    }

    // Load existing tip or start fresh
    let tip      = await fetchTip(destDoc.id);
    let segments = tip?.segments ? { ...tip.segments } : {};

    // Group items by segment
    const bySegment = {};
    for (const row of dest.items) {
      const segKey = findSegmentKey(row.segmento);
      if (!segKey) {
        addLog(`  ⚠ Segmento não reconhecido: "${row.segmento}" — item ignorado.`, '#F59E0B');
        continue;
      }
      if (!bySegment[segKey]) bySegment[segKey] = [];
      bySegment[segKey].push(row);
    }

    for (const [segKey, rows] of Object.entries(bySegment)) {
      const seg = SEGMENTS.find(s => s.key === segKey);
      if (!seg) continue;

      if (!segments[segKey]) segments[segKey] = { items: [], themeDesc: '', hasExpiry: false, expiryDate: '' };

      if (seg.mode === 'simple_list') {
        for (const row of rows) {
          segments[segKey].items.push({ title: row.titulo, description: row.descricao });
        }
      } else if (seg.mode === 'place_list' || seg.mode === 'agenda') {
        for (const row of rows) {
          segments[segKey].items.push({
            categoria: row.categoria, titulo: row.titulo, descricao: row.descricao,
            endereco: row.endereco, telefone: row.telefone, site: row.site,
            observacoes: row.observacoes,
            ...(seg.mode === 'agenda' ? { periodo: row.periodo } : {}),
          });
        }
      }

      addLog(`  ✓ ${esc(seg.label)}: ${rows.length} item(s) adicionado(s)`, '#22C55E');
    }

    // Handle info_geral rows
    const infoRows = dest.items.filter(r => r.type === 'info_geral');
    if (infoRows.length > 0) {
      const ir = infoRows[0];
      if (!segments['informacoes_gerais']) segments['informacoes_gerais'] = { info: {}, hasExpiry: false };
      Object.assign(segments['informacoes_gerais'].info, {
        descricao: ir.descricao, populacao: ir.populacao, moeda: ir.moeda,
        lingua: ir.lingua, religiao: ir.religiao, ddd: ir.ddd, voltagem: ir.voltagem,
      });
      addLog(`  ✓ Informações Gerais atualizadas`, '#22C55E');
    }

    try {
      await saveTip(tip?.id || null, {
        destinationId: destDoc.id,
        continent:     destDoc.continent,
        country:       destDoc.country,
        city:          destDoc.city || '',
        segments,
      });
      addLog(`  ✅ Dica salva com sucesso`, '#22C55E');
      imported++;
    } catch(e) {
      addLog(`  ✗ Erro ao salvar: ${e.message}`, '#EF4444');
      errors++;
    }

    await new Promise(r => setTimeout(r, 300)); // rate limit
  }

  addLog(`\n─────────────────────────────────`);
  addLog(`✅ ${imported} destino(s) importado(s) com sucesso.${errors ? ` ⚠ ${errors} com erro(s).` : ''}`,
    errors > 0 ? '#F59E0B' : '#22C55E');

  toast.success(`Importação concluída: ${imported} destino(s).`);
}

function findSegmentKey(label) {
  if (!label) return null;
  const norm = label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  return SEGMENTS.find(s =>
    s.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(norm) ||
    norm.includes(s.key.replace(/_/g,' '))
  )?.key || null;
}

/* ─── Download template ───────────────────────────────────── */
async function downloadTemplate() {
  const btn = document.getElementById('download-template-btn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    if (!window.XLSX) {
      await new Promise((res,rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }

    const wb = window.XLSX.utils.book_new();

    // ── Sheet 1: Dicas ────────────────────────────────────────
    const dicasHeaders = [
      'destino_continente','destino_pais','destino_cidade',
      'segmento','categoria',
      'titulo','descricao','endereco','telefone','site','observacoes','periodo',
    ];

    // Example rows — one per segment type
    const dicasRows = [
      dicasHeaders,
      // Instructions row (gray comment)
      ['[Obrigatório]','[Obrigatório]','[Opcional]',
       '[Ver lista abaixo]','[Ver lista abaixo]',
       '[Obrigatório]','[Texto livre]','[Texto livre]','[Texto livre]','[URL]','[Texto livre]','[Apenas Agenda Cultural]'],
      // Divider
      ['---','---','---','---','---','---','---','---','---','---','---','---'],
      // Example: Atracoes
      ['Europa','França','Paris','Atrações','Museus e centros culturais',
       'Museu do Louvre','O maior museu de arte do mundo...','Rue de Rivoli, 75001 Paris','+33 1 40 20 53 17',
       'https://www.louvre.fr','',''],
      // Example: Restaurantes
      ['Europa','França','Paris','Restaurantes','Cafés e bistrôs',
       'Café de Flore','Famoso bistrô parisiense...','172 Bd Saint-Germain, 75006',
       '+33 1 45 48 55 26','https://cafedeflore.fr','Reserva recomendada',''],
      // Example: Agenda
      ['Europa','França','Paris','Agenda Cultural','Exposições',
       'Monet: Séries','Exposição especial com obras do período...','Musée d\'Orsay',
       '','https://musee-orsay.fr','Ingressos limitados','15/04/2026 a 30/08/2026'],
      // Example: Bairros
      ['Europa','França','Paris','Bairros','',
       'Marais','Bairro histórico com arquitetura medieval...','','','','',''],
    ];

    const dicasWs = window.XLSX.utils.aoa_to_sheet(dicasRows);
    // Column widths
    dicasWs['!cols'] = [
      {wch:18},{wch:16},{wch:16},{wch:28},{wch:28},
      {wch:30},{wch:40},{wch:30},{wch:18},{wch:30},{wch:25},{wch:28},
    ];
    window.XLSX.utils.book_append_sheet(wb, dicasWs, 'Dicas');

    // ── Sheet 2: Informações Gerais ───────────────────────────
    const infoHeaders = [
      'continente','pais','cidade',
      'descricao','populacao','moeda','lingua','religiao',
      'fuso_sinal','fuso_horas','voltagem','ddd',
      'representacao_nome','representacao_endereco','representacao_telefone',
      'representacao_link','representacao_obs',
      ...MONTHS.map(m=>`clima_max_${m}`),
      ...MONTHS.map(m=>`clima_min_${m}`),
    ];

    const infoRows = [
      infoHeaders,
      ['[Obrigatório]','[Obrigatório]','[Opcional]',
       '[Texto]','[Ex: 2.161.000 hab.]','[Ex: Euro (€)]','[Texto]','[Texto]',
       '[+ ou -]','[número]','[110V ou 220V]','[Ex: +33]',
       '[Texto]','[Texto]','[Texto]','[URL]','[Texto]',
       ...MONTHS.map(()=>'°C máx'), ...MONTHS.map(()=>'°C mín')],
      ['---','---','---','---','---','---','---','---','---','---','---','---',
       '---','---','---','---','---',
       ...MONTHS.map(()=>'---'), ...MONTHS.map(()=>'---')],
      ['Europa','França','Paris',
       'A Cidade Luz, capital mundial da moda e cultura...',
       '2.161.000 habitantes','Euro (€)','Francês','Catolicismo',
       '-','4','220V','+33',
       'Embaixada do Brasil em Paris',
       '34 Cours Albert 1er, 75008 Paris','+33 1 45 61 63 00',
       'https://paris.itamaraty.gov.br','',
       22,24,18,16,14,19,22,22,19,15,10,19, // max
       5,6,4,6,9,13,15,15,13,9,6,4,         // min
      ],
    ];

    const infoWs = window.XLSX.utils.aoa_to_sheet(infoRows);
    infoWs['!cols'] = infoHeaders.map((_,i) => ({ wch: i < 4 ? 20 : 14 }));
    window.XLSX.utils.book_append_sheet(wb, infoWs, 'Informações Gerais');

    // ── Sheet 3: Referência de segmentos e categorias ─────────
    const refRows = [
      ['SEGMENTOS DISPONÍVEIS','','CATEGORIAS'],
      ['','',''],
    ];
    for (const seg of SEGMENTS) {
      const cats = DEFAULT_CATEGORIES[seg.key] || [];
      refRows.push([seg.label, seg.key, cats.join(' / ')]);
    }
    refRows.push(['','','']);
    refRows.push(['NOTAS','','']);
    refRows.push(['• Uma linha = um item (restaurante, atração, etc.)','','']);
    refRows.push(['• destino_pais é obrigatório em todas as linhas','','']);
    refRows.push(['• Bairros e Arredores: apenas titulo e descricao são usados','','']);
    refRows.push(['• Agenda Cultural: use o campo periodo para data do evento','','']);

    const refWs = window.XLSX.utils.aoa_to_sheet(refRows);
    refWs['!cols'] = [{wch:35},{wch:22},{wch:80}];
    window.XLSX.utils.book_append_sheet(wb, refWs, 'Referência');

    window.XLSX.writeFile(wb, 'primetour_portal_modelo.xlsx');
    toast.success('Planilha modelo baixada.');
  } catch(e) {
    toast.error('Erro: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '⬇ Baixar Planilha Modelo'; }
  }
}
