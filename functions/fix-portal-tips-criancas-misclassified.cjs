/**
 * v4.63.36 — Hotfix: mover items de "atrações para crianças" misclassified em "atracoes".
 *
 * BUG: portalPdfParser.js falhou em detectar a transição "ATRAÇÕES PARA CRIANÇAS"
 * em alguns PDFs (provavelmente quebra de página entre o título e a primeira
 * subcategoria). Resultado: items de crianças foram pra atracoes[] com categoria
 * vazia. atracoes_criancas[] ficou vazio.
 *
 * Heurística de detecção (alta confiança):
 *   (A) Item está em atracoes com categoria vazia ('' ou undefined ou '?')
 *   (B) Item vem DEPOIS de pelo menos 1 item com categoria preenchida
 *       (sinal de mudança de seção não-detectada)
 *
 * Plus heurística semântica por keywords no title (independente de A/B):
 *   - PARQUINHO, PLAYGROUND, CHILDREN'S MUSEUM, BRONX ZOO,
 *     BROOKLYN CHILDREN'S MUSEUM, etc.
 *
 * Algorithm:
 *   1. Iterate atracoes[] from end. Quando achar primeiro item com cat preenchida,
 *      tudo DEPOIS dele (até o fim) com cat vazia é candidato a mover.
 *   2. Title matching: items cujo title contém "PARQUINHO|PLAYGROUND|
 *      CHILDREN|CRIANÇAS|KIDS|ZOOLÓGICO|ZOO" em qualquer lugar.
 *
 * Uso:
 *   node fix-portal-tips-criancas-misclassified.cjs           # DRY-RUN
 *   node fix-portal-tips-criancas-misclassified.cjs --apply   # APLICA
 */
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const APPLY = process.argv.includes('--apply');

// Keywords ULTRA-RESTRITIVAS — só items 100% certos de serem pra crianças.
// Items ambíguos (zoo, aquário, museu de ciências) ficam no editor pra triage manual.
const KIDS_KEYWORDS = [
  'PARQUINHO',
  'PLAYGROUND',
  "CHILDREN'S",
  'CHILDREN`S',
  'CHILDRENS',
  'CRIANÇAS',
  'CRIANCAS',
  'KIDS',
  'KID-FRIENDLY',
];

function looksLikeKids(title) {
  if (!title) return null;
  const up = String(title).toUpperCase();
  for (const kw of KIDS_KEYWORDS) {
    if (up.includes(kw)) return kw;
  }
  return null;
}

function findTailWithEmptyCat(items) {
  // Encontra o índice do último item com categoria preenchida.
  // Tudo depois dele com cat vazia é suspeito.
  if (!Array.isArray(items) || items.length === 0) return -1;
  let lastWithCat = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    const cat = (items[i]?.categoria || '').trim();
    if (cat) { lastWithCat = i; break; }
  }
  return lastWithCat;
}

(async () => {
  console.log(`\n[fix-criancas] ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);

  const tipsSnap = await db.collection('portal_tips').get();
  console.log(`Total tips: ${tipsSnap.size}\n`);

  let tipsAffected = 0;
  let itemsMoved = 0;
  const batch = db.batch();

  for (const tipDoc of tipsSnap.docs) {
    const tip = tipDoc.data();
    const segs = tip.segments || {};
    const atracoes = segs.atracoes;
    if (!atracoes || !Array.isArray(atracoes.items) || atracoes.items.length === 0) continue;

    const items = atracoes.items;

    // Heurística A: items da cauda com cat vazia
    const lastWithCat = findTailWithEmptyCat(items);
    const tailEmpty = lastWithCat >= 0 && lastWithCat < items.length - 1;

    // Heurística B: items individuais que casam keywords kids
    const kidsHits = items.map((it, i) => ({
      idx: i,
      kw: looksLikeKids(it?.titulo || it?.title || ''),
    })).filter(x => x.kw);

    if (!tailEmpty && kidsHits.length === 0) continue;

    // Strategy v4.63.36+: ULTRA-CONSERVADOR. Move APENAS items que casam
    // keyword inequívoca (PARQUINHO/PLAYGROUND/CHILDREN'S/CRIANÇAS/KIDS).
    // Items ambíguos (zoo, aquário, museu, etc.) NÃO são movidos
    // automaticamente — Renê faz triage manual via UI no editor de dicas
    // (botão "→ Atrações Crianças" por item, será adicionado em v4.63.36).
    //
    // Por que: heurística "tail-empty" pegou LA RAMBLA (Barcelona), MADAME
    // TUSSAUDS, COMPLEXO ESPORTIVO etc. — falsos positivos catastróficos.
    // Melhor não mover do que mover errado e o consultor descobrir
    // "Eloise at the Plaza" no segmento de crianças.
    const toMove = kidsHits.map(h => ({
      idx: h.idx,
      item: items[h.idx],
      reason: `keyword: ${h.kw}`,
    }));

    if (toMove.length === 0) continue;

    // Show
    const destId = tip.destinationId || 'unknown';
    console.log(`  Tip ${tipDoc.id} (dest ${destId}):`);
    console.log(`    ${toMove.length} items a mover de atracoes → atracoes_criancas`);
    toMove.forEach(({ idx, item, reason }) => {
      console.log(`      [${idx}] ${(item.titulo || item.title || '?').slice(0, 60)}  // ${reason}`);
    });

    if (APPLY) {
      // Build new atracoes (sem os items movidos)
      const moveIdxs = new Set(toMove.map(x => x.idx));
      const newAtracoes = items.filter((_, i) => !moveIdxs.has(i));

      // Build new atracoes_criancas (apenda os items movidos)
      const existingCriancas = segs.atracoes_criancas || {};
      const existingCriancasItems = Array.isArray(existingCriancas.items) ? existingCriancas.items : [];
      const newCriancasItems = [...existingCriancasItems, ...toMove.map(x => ({ ...x.item, categoria: x.item.categoria || '' }))];

      batch.update(tipDoc.ref, {
        'segments.atracoes.items': newAtracoes,
        'segments.atracoes_criancas': {
          ...existingCriancas,
          items: newCriancasItems,
        },
        updatedAt: FV.serverTimestamp(),
      });
      tipsAffected++;
      itemsMoved += toMove.length;
    } else {
      tipsAffected++;
      itemsMoved += toMove.length;
    }
  }

  if (APPLY && tipsAffected > 0) {
    await batch.commit();
    // Audit log
    await db.collection('audit_logs').add({
      action: 'portal.tips_criancas_fix',
      severity: 'info',
      actorId: 'system',
      actorName: 'Hotfix v4.63.36',
      tipsAffected,
      itemsMoved,
      timestamp: FV.serverTimestamp(),
    });
    console.log(`\n✓ APPLY done. ${tipsAffected} tips afetadas, ${itemsMoved} items movidos.\n`);
  } else if (!APPLY) {
    console.log(`\n✓ DRY-RUN. ${tipsAffected} tips serão afetadas, ${itemsMoved} items serão movidos. Run com --apply.\n`);
  } else {
    console.log(`\n✓ Nenhum item suspeito encontrado.\n`);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
