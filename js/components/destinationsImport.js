/**
 * PRIMETOUR — Bulk import de destinos (Portal de Dicas / Roteiros)
 *
 * Fluxo:
 *   1. Modal abre com link pra baixar template + dropzone XLSX/CSV
 *   2. Usuário sobe planilha com colunas: Continente, País, Cidade
 *      (também aceita: Continent / Country / City e variações)
 *   3. Componente parseia, valida e exibe preview tabular
 *   4. Botão "Importar N destinos" cria todos via saveDestination()
 *
 * Dedup: usa o mesmo slug que saveDestination gera (continent/country/city
 * normalizados). Dups são marcados visualmente mas NÃO bloqueados — user
 * decide se quer pular ou re-importar (último wins, pq saveDestination usa
 * merge:true quando id existe).
 *
 * Permissão: requer canManageDestinations() (Analista+).
 * 4.49.7+
 */

import { modal } from './modal.js';
import { toast } from './toast.js';
import { store } from '../store.js';
import { saveDestination, fetchDestinations, CONTINENTS } from '../services/portal.js';

const esc = s => String(s||'').replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ─── Slug (mesmo algoritmo de portal.js saveDestination) ─── */
const _slug = parts => parts.filter(Boolean)
  .map(s => String(s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  .join('/');

/* ─── Loader de XLSX via CDN (mesma versão do plannerImport) ─── */
let _xlsxLoading = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  if (_xlsxLoading) return _xlsxLoading;
  _xlsxLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Falha ao carregar XLSX.'));
    document.head.appendChild(s);
  });
  return _xlsxLoading;
}

/* ─── Mapper de colunas (tolerante a variações) ─── */
const COL_ALIASES = {
  continent: ['continente', 'continent'],
  country:   ['país', 'pais', 'country'],
  city:      ['cidade', 'cidade/região', 'cidade-região', 'cidade regiao', 'city', 'região', 'regiao'],
  notes:     ['notas', 'observações', 'observacoes', 'notes', 'obs'],
};
function pickColumn(row, key) {
  const aliases = COL_ALIASES[key];
  for (const k of Object.keys(row)) {
    const norm = k.toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (aliases.some(a => norm === a.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''))) {
      return String(row[k] || '').trim();
    }
  }
  return '';
}

/* ─── Estado do wizard ─── */
let _state = null;

/* ─── Entry-point ─── */
export function openDestinationsImport({ onComplete } = {}) {
  if (!store.canManageDestinations()) {
    toast.error('Sem permissão pra criar destinos.');
    return;
  }
  _state = {
    parsedRows: [],         // [{continent, country, city, notes, _existingId, _dup}]
    existingSlugs: new Map(),  // slug → {id, …}
    onComplete: onComplete || (() => {}),
  };

  const ref = modal.open({
    dedupeKey: 'destinations-import',
    title: '📤 Importar destinos via Excel',
    size: 'lg',
    closeOnEsc: true,
    content: _renderStep1(),
    footer: [
      { label: 'Baixar template Excel', class: 'btn-secondary', closeOnClick: false,
        onClick: () => _downloadTemplate(),
      },
      { label: 'Fechar', class: 'btn-secondary', closeOnClick: true },
    ],
  });
  _state.modalRef = ref;
  _wireStep1();
}

/* ─── Step 1: upload + preview ─── */
function _renderStep1() {
  return `
    <div style="display:flex;flex-direction:column;gap:14px;">
      <div class="pi-infobox" style="padding:12px 14px;background:rgba(212,168,67,0.06);
        border:1px solid rgba(212,168,67,0.2);border-radius:8px;font-size:0.8125rem;">
        <div style="font-weight:600;margin-bottom:4px;">📋 Formato esperado</div>
        <div style="color:var(--text-secondary);">
          Colunas (qualquer ordem): <strong>Continente</strong>, <strong>País</strong>,
          <strong>Cidade</strong> (opcional), <strong>Notas</strong> (opcional).<br>
          Continentes aceitos: ${CONTINENTS.map(c => `<code>${esc(c)}</code>`).join(', ')}.<br>
          Linhas com mesmo Continente+País+Cidade já existentes serão marcadas como duplicadas.
        </div>
      </div>

      <div id="di-drop" style="
        border:2px dashed var(--border-default);border-radius:12px;padding:32px;
        text-align:center;cursor:pointer;transition:border-color 0.15s;">
        <div style="font-size:2.5rem;margin-bottom:8px;opacity:0.5;">📁</div>
        <p style="margin:0 0 4px;font-weight:600;">Arraste o arquivo aqui ou clique pra selecionar</p>
        <p style="margin:0;font-size:0.75rem;color:var(--text-muted);">Aceita .xlsx, .xls e .csv</p>
        <input type="file" id="di-file" accept=".xlsx,.xls,.csv" style="display:none;" />
      </div>

      <div id="di-result"></div>
    </div>
  `;
}

function _wireStep1() {
  const body = _state.modalRef?.getBody?.();
  if (!body) return;
  const drop = body.querySelector('#di-drop');
  const input = body.querySelector('#di-file');
  drop?.addEventListener('click', () => input?.click());
  drop?.addEventListener('dragover', e => {
    e.preventDefault();
    drop.style.borderColor = 'var(--brand-gold)';
  });
  drop?.addEventListener('dragleave', () => {
    drop.style.borderColor = 'var(--border-default)';
  });
  drop?.addEventListener('drop', e => {
    e.preventDefault();
    drop.style.borderColor = 'var(--border-default)';
    if (e.dataTransfer.files.length) _handleFile(e.dataTransfer.files[0]);
  });
  input?.addEventListener('change', e => {
    if (e.target.files.length) _handleFile(e.target.files[0]);
  });
}

async function _handleFile(file) {
  const body = _state.modalRef?.getBody?.();
  if (!body) return;
  const result = body.querySelector('#di-result');
  result.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);">
    ⏳ Processando ${esc(file.name)}…</div>`;

  try {
    await loadXLSX();
    const data = await file.arrayBuffer();
    const wb = window.XLSX.read(data, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = window.XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!rows.length) throw new Error('Planilha vazia.');

    // Carrega destinos existentes pra dedup
    const existing = await fetchDestinations();
    const existingMap = new Map();
    existing.forEach(d => {
      const slug = _slug([d.continent, d.country, d.city]);
      existingMap.set(slug, d);
    });
    _state.existingSlugs = existingMap;

    // 4.49.9+ Parse + validate + DUP detection em DOIS níveis:
    //   1. dupFirestore: linha idêntica a destino já cadastrado no banco
    //   2. dupInFile: linha idêntica a outra linha ANTERIOR neste mesmo upload
    //      (evita criar 2 docs idênticos quando o Excel tem repetições)
    // Critério de "idêntico": slug normalizado (lowercase + sem acentos
    // + kebab-case) de continent/country/city.
    const seenInFileFirstRow = new Map(); // slug → primeiro rowNum onde apareceu
    const parsed = rows.map((r, idx) => {
      const continent = pickColumn(r, 'continent');
      const country   = pickColumn(r, 'country');
      const city      = pickColumn(r, 'city');
      const notes     = pickColumn(r, 'notes');
      const errors    = [];
      if (!continent) errors.push('Continente vazio');
      else if (!CONTINENTS.includes(continent)) errors.push(`Continente "${continent}" inválido`);
      if (!country) errors.push('País vazio');
      const slug = (continent && country) ? _slug([continent, country, city]) : '';
      const dupFirestore = slug && existingMap.has(slug);
      // Intra-file: marca a partir da SEGUNDA ocorrência (1ª passa, demais são dup)
      const firstSeenAt = slug ? seenInFileFirstRow.get(slug) : null;
      const dupInFile = !!firstSeenAt;
      if (slug && !firstSeenAt) seenInFileFirstRow.set(slug, idx + 2);

      const dup = dupFirestore || dupInFile;
      return {
        rowNum: idx + 2, // header é linha 1
        continent, country, city, notes,
        errors, slug,
        dupFirestore, dupInFile, dupOriginRow: firstSeenAt || null,
        dup,
        _selected: errors.length === 0 && !dup, // selecionado por default só se válido e ÚNICO
      };
    });
    _state.parsedRows = parsed;
    _renderPreview(result, parsed);
  } catch (e) {
    result.innerHTML = `<div style="padding:12px 16px;background:#FEF2F2;color:#DC2626;
      border-radius:8px;font-size:0.875rem;">❌ Erro: ${esc(e.message)}</div>`;
  }
}

function _renderPreview(container, rows) {
  const valid     = rows.filter(r => r.errors.length === 0);
  const dupFsCount  = rows.filter(r => r.dupFirestore && !r.dupInFile).length;
  const dupFileCount = rows.filter(r => r.dupInFile).length;
  const errorCount  = rows.filter(r => r.errors.length).length;
  const newCount    = valid.filter(r => !r.dup).length;

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:0.8125rem;flex-wrap:wrap;">
      <span style="background:#16A34A20;color:#16A34A;padding:4px 10px;border-radius:12px;">
        ✓ ${newCount} novos
      </span>
      ${dupFsCount ? `<span style="background:#F59E0B20;color:#D97706;padding:4px 10px;border-radius:12px;"
        title="Já cadastrados no Portal">⚠ ${dupFsCount} já existem</span>` : ''}
      ${dupFileCount ? `<span style="background:#F5970020;color:#D97706;padding:4px 10px;border-radius:12px;"
        title="Linhas que repetem outras linhas do mesmo Excel">⚠ ${dupFileCount} duplicatas na planilha</span>` : ''}
      ${errorCount ? `<span style="background:#DC262620;color:#DC2626;padding:4px 10px;border-radius:12px;">
        ✗ ${errorCount} com erro</span>` : ''}
      <span style="margin-left:auto;color:var(--text-muted);">Total: ${rows.length} linha(s)</span>
    </div>

    <div style="max-height:360px;overflow:auto;border:1px solid var(--border-subtle);
      border-radius:8px;background:var(--bg-card);">
      <table style="width:100%;border-collapse:collapse;font-size:0.8125rem;">
        <thead style="position:sticky;top:0;background:var(--bg-surface);z-index:1;">
          <tr>
            <th style="padding:8px 10px;text-align:center;border-bottom:1px solid var(--border-subtle);width:40px;">
              <input type="checkbox" id="di-select-all" ${newCount > 0 ? 'checked' : ''} />
            </th>
            <th style="padding:8px 10px;text-align:left;border-bottom:1px solid var(--border-subtle);width:50px;">#</th>
            <th style="padding:8px 10px;text-align:left;border-bottom:1px solid var(--border-subtle);">Continente</th>
            <th style="padding:8px 10px;text-align:left;border-bottom:1px solid var(--border-subtle);">País</th>
            <th style="padding:8px 10px;text-align:left;border-bottom:1px solid var(--border-subtle);">Cidade</th>
            <th style="padding:8px 10px;text-align:left;border-bottom:1px solid var(--border-subtle);">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, idx) => {
            const status = r.errors.length
              ? `<span style="color:#DC2626;">✗ ${esc(r.errors.join('; '))}</span>`
              : r.dupInFile
              ? `<span style="color:#D97706;" title="Repete a linha ${r.dupOriginRow} do mesmo Excel">⚠ duplicata na planilha (linha ${r.dupOriginRow})</span>`
              : r.dupFirestore
              ? `<span style="color:#D97706;">⚠ já existe</span>`
              : `<span style="color:#16A34A;">✓ novo</span>`;
            const disabled = r.errors.length ? 'disabled' : '';
            return `<tr data-idx="${idx}" style="border-bottom:1px solid var(--border-subtle);">
              <td style="padding:6px 10px;text-align:center;">
                <input type="checkbox" class="di-row-check" data-idx="${idx}"
                  ${r._selected ? 'checked' : ''} ${disabled} />
              </td>
              <td style="padding:6px 10px;color:var(--text-muted);">${r.rowNum}</td>
              <td style="padding:6px 10px;">${esc(r.continent || '—')}</td>
              <td style="padding:6px 10px;">${esc(r.country || '—')}</td>
              <td style="padding:6px 10px;">${esc(r.city || '—')}</td>
              <td style="padding:6px 10px;font-size:0.75rem;">${status}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px;">
      <button class="btn btn-primary" id="di-import-btn" ${newCount > 0 ? '' : 'disabled'}>
        Importar selecionados (<span id="di-count-sel">${rows.filter(r => r._selected).length}</span>)
      </button>
    </div>
  `;

  _wirePreview(container);
}

function _wirePreview(container) {
  const selectAll = container.querySelector('#di-select-all');
  const checks    = container.querySelectorAll('.di-row-check');
  const countSel  = container.querySelector('#di-count-sel');
  const importBtn = container.querySelector('#di-import-btn');

  const updateCount = () => {
    const n = [..._state.parsedRows].filter(r => r._selected).length;
    if (countSel) countSel.textContent = n;
    if (importBtn) importBtn.disabled = n === 0;
  };

  selectAll?.addEventListener('change', () => {
    const v = selectAll.checked;
    checks.forEach(c => { if (!c.disabled) { c.checked = v; _state.parsedRows[+c.dataset.idx]._selected = v; } });
    updateCount();
  });

  checks.forEach(c => c.addEventListener('change', () => {
    _state.parsedRows[+c.dataset.idx]._selected = c.checked;
    updateCount();
  }));

  importBtn?.addEventListener('click', _doImport);
}

async function _doImport() {
  const body = _state.modalRef?.getBody?.();
  const importBtn = body?.querySelector('#di-import-btn');
  if (importBtn) { importBtn.disabled = true; importBtn.textContent = 'Importando…'; }

  const toImport = _state.parsedRows.filter(r => r._selected);
  let ok = 0, fail = 0, mergedInBatch = 0, skippedDup = 0;
  const errors = [];

  // 4.49.9+ Rede de segurança: mesmo se user forçar 2 linhas iguais como
  // selected (override do desmarcado automático), o existingSlugs é atualizado
  // a cada saveDestination — então a 2ª linha pega o id da 1ª e faz update
  // (merge) em vez de criar doc novo. Garante "1 destino = 1 doc" sempre.
  // v4.61.3: trata DUPLICATE (v4.60.2) como skip-with-link em vez de falha.
  for (const r of toImport) {
    try {
      const existing = _state.existingSlugs.get(r.slug);
      const isUpdate = !!existing?.id;
      const newId = await saveDestination(existing?.id || null, {
        continent: r.continent,
        country:   r.country,
        city:      r.city,
        notes:     r.notes,
      });
      _state.existingSlugs.set(r.slug, { id: newId || existing?.id, ...r });
      if (isUpdate) mergedInBatch++;
      ok++;
    } catch (e) {
      // v4.61.3: DUPLICATE = lugar JÁ existe canônico em outro slug (ex: planilha
      // tinha "Cape Town" e canônico era "Cidade do Cabo" com alias). Não é erro.
      if (e?.code === 'DUPLICATE' && e.mergeTargetId) {
        skippedDup++;
        _state.existingSlugs.set(r.slug, { id: e.mergeTargetId, ...r });
        continue;
      }
      fail++;
      errors.push(`Linha ${r.rowNum}: ${e.message}`);
    }
  }

  if (fail === 0) {
    const dupNote = skippedDup ? ` · ${skippedDup} já existia (canônico)` : '';
    toast.success(`✓ ${ok} importado(s)${dupNote}`);
  } else {
    toast.warning(`Importação parcial: ${ok} ok, ${fail} falharam${skippedDup ? `, ${skippedDup} já existiam` : ''}.`);
    console.warn('[DestImport] errors:', errors);
  }

  _state.onComplete();
  _state.modalRef?.close?.();
}

/* ─── Download de template Excel modelo ─── */
async function _downloadTemplate() {
  try {
    await loadXLSX();
    const sample = [
      { Continente: 'Europa',      'País': 'França',  Cidade: 'Paris',          Notas: '' },
      { Continente: 'Europa',      'País': 'Itália',  Cidade: 'Roma',           Notas: 'Capital' },
      { Continente: 'Ásia',        'País': 'Japão',   Cidade: 'Tóquio',         Notas: '' },
      { Continente: 'América do Sul', 'País': 'Brasil', Cidade: 'Rio de Janeiro', Notas: '' },
    ];
    const ws = window.XLSX.utils.json_to_sheet(sample);
    // Larguras de coluna
    ws['!cols'] = [{ wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 28 }];
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Destinos');
    window.XLSX.writeFile(wb, 'modelo-destinos-primetour.xlsx');
    toast.success('Template baixado.');
  } catch (e) {
    toast.error('Erro ao gerar template: ' + e.message);
  }
}
