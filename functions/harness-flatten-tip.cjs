// Harness: valida flattenTipSegment (copiado verbatim de roteiroGenerator.js v4.63.77)
// contra o snapshot REAL da cotação 4bTybLbDGfarh3Rp5XSd (Quioto, 94 items).
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

function _tipStripHtml(s) {
  if (!s || typeof s !== 'string') return '';
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function flattenTipSegment(segKey, segVal) {
  const lines = [];
  if (segKey === 'informacoes_gerais') {
    const info = (segVal && segVal.info) || {};
    const desc = _tipStripHtml(info.descricao);
    if (desc) lines.push({ text: desc });
    const pairs = [
      ['Moeda', info.moeda], ['Língua', info.lingua], ['Religião', info.religiao],
      ['População', info.populacao], ['Voltagem', info.voltagem], ['DDD', info.ddd],
    ].filter(([, v]) => v);
    for (const [k, v] of pairs) lines.push({ text: `${k}: ${v}` });
    const dica = _tipStripHtml(info.dica);
    if (dica) lines.push({ text: `Dica: ${dica}` });
    return lines;
  }
  const items = Array.isArray(segVal?.items) ? segVal.items
              : Array.isArray(segVal) ? segVal : [];
  for (const item of items) {
    if (typeof item === 'string') { const t = _tipStripHtml(item); if (t) lines.push({ text: t }); continue; }
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'subtitle') {
      const h = item.titulo || item.title || '';
      if (h) lines.push({ heading: true, text: h });
      continue;
    }
    const name = item.titulo || item.title || item.name || '';
    const addr = item.endereco || item.address || item.location || '';
    const desc = _tipStripHtml(item.descricao || item.description || item.note || '');
    const obs  = _tipStripHtml(item.observacoes || '');
    const detail = [addr, desc, obs].filter(Boolean).join(' — ');
    const text = [name, detail].filter(Boolean).join(' — ');
    if (text) lines.push({ text });
  }
  return lines;
}

(async () => {
  const c = await db.collection('roteiros').doc('4bTybLbDGfarh3Rp5XSd').get();
  const emb = (c.data().embeddedTips || [])[0];
  const segments = emb.content.segments;
  let total = 0, fail = 0;
  console.log(`\n=== flattenTipSegment vs snapshot "${emb.title}" ===`);
  for (const [k, v] of Object.entries(segments)) {
    const lines = flattenTipSegment(k, v);
    const rawCount = Array.isArray(v?.items) ? v.items.length : (k === 'informacoes_gerais' ? Object.keys(v?.info || {}).length : 0);
    total += lines.length;
    console.log(`  [${k}] raw=${rawCount} → ${lines.length} renderable lines`);
    if (lines[0]) console.log(`        e.g. "${lines[0].text.slice(0, 70)}"`);
    // sanity: segments with items must yield >=1 line
    if (rawCount > 0 && lines.length === 0) { fail++; console.log(`        ❌ FAIL: ${rawCount} raw but 0 lines`); }
  }
  console.log(`\nTOTAL renderable lines: ${total}`);
  console.log(fail === 0 ? '✅ PASS — todos os segments não-vazios renderam linhas' : `❌ ${fail} segment(s) FALHARAM`);
  process.exit(fail === 0 ? 0 : 1);
})();
