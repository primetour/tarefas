/**
 * extractContentImages — extrai imagens de conteúdo do HTML de uma newsletter.
 *
 * v1 (v4.49.30+): retornava strings (URLs) ordenadas por score (área × alt).
 * v2 (v4.49.57+): retorna OBJETOS { url, alt, link, width, height, position }
 *                 PRESERVANDO A ORDEM DO HTML (sequência narrativa do email).
 *
 * Mudança crítica: a ordenação por score era ótima pra "qual é a foto principal"
 * mas inadequada pra mostrar a newsletter inteira em composição vertical. Com
 * a ordem do HTML, o user vê na sequência real (header → hero → blocos → CTA).
 *
 * O `link` é o href do <a> que envolve o <img> (típico em newsletters: cada
 * bloco vira clicável pra uma landing/campanha). Quando ausente, é null.
 *
 * Schema do objeto retornado:
 *   {
 *     url:      string  — src da imagem (CDN SFMC)
 *     alt:      string  — alt-text (vazio se não declarado)
 *     link:     string|null — href do <a> envolvente (URL de destino real)
 *     width:    number  — declarado no <img> (0 se não declarado)
 *     height:   number  — idem
 *     position: number  — índice na ordem do HTML (0-based, pra debug/audit)
 *   }
 *
 * Filtros mantidos (idênticos à v1):
 *   - Sem data:/javascript: URIs
 *   - Sem trackers GIF (open/track/pixel/beacon/spacer)
 *   - Sem 1×1, sem <10px qualquer dim, sem logos <200×<100
 *   - Dedup por URL
 *
 * NÃO faz mais o sort por score. topN ainda corta no final (top N na ordem
 * natural). Caller pode passar Infinity pra capturar tudo.
 */
function extractContentImages(html, topN = 5) {
  if (!html) return [];
  const imgs = [];

  // Regex de <img> + opcional <a href> envolvente.
  // Ao varrer com /<img/ direto, perdemos o <a> contexto. Estratégia: dupla
  // varredura — extraímos primeiro todos os <a href>...</a> com range, depois
  // procuramos imgs e checamos se caem dentro de algum range.
  const aRanges = []; // [{ start, end, href }]
  const aRe = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
  let am;
  while ((am = aRe.exec(html)) !== null) {
    const href = (am[1].match(/\bhref\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    if (!href) continue;
    // skip mailto:, tel:, javascript:, anchor (#)
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    aRanges.push({ start: am.index, end: am.index + am[0].length, href });
  }
  const findEnclosingHref = (imgIdx) => {
    // Acha o range mais interno (último que começa antes de imgIdx e termina depois)
    let best = null;
    for (const r of aRanges) {
      if (r.start < imgIdx && r.end > imgIdx) {
        if (!best || r.start > best.start) best = r;
      }
    }
    return best ? best.href : null;
  };

  const re = /<img\s+([^>]*?)>/gi;
  let m;
  let position = 0;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const url = (attrs.match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1] || '';
    if (!url) continue;
    // Pula data: URIs e javascript:
    if (/^(data:|javascript:)/i.test(url)) continue;
    // Pula tracking pixels conhecidos (analytics, mailing trackers)
    if (/\.gif(\?|$)/i.test(url) && /(open|track|pixel|beacon|t\.gif|spacer)/i.test(url)) continue;

    const alt = ((attrs.match(/\balt\s*=\s*["']([^"']*)["']/i) || [])[1] || '').trim();
    const width  = parseInt((attrs.match(/\bwidth\s*=\s*["']?(\d+)/i)  || [])[1], 10) || 0;
    const height = parseInt((attrs.match(/\bheight\s*=\s*["']?(\d+)/i) || [])[1], 10) || 0;

    // Filtros de tamanho:
    if ((width === 1 && height >= 0) || (height === 1 && width >= 0)) continue;
    if (width > 0 && width < 10) continue;
    if (height > 0 && height < 10) continue;
    if (width > 0 && width < 200 && height > 0 && height < 100) continue;

    const link = findEnclosingHref(m.index);
    imgs.push({ url, alt, link, width, height, position: position++ });
  }

  // Dedup por URL (preserva a primeira ocorrência → mantém ordem natural).
  const seen = new Set();
  const dedup = [];
  for (const i of imgs) {
    if (seen.has(i.url)) continue;
    seen.add(i.url);
    dedup.push(i);
  }

  // Sem sort por score — mantém ordem do HTML. Slice no topN.
  return dedup.slice(0, topN);
}

module.exports = { extractContentImages };
