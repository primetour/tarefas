/**
 * Merge duplicatas em portal_destinations (v4.60.1)
 *
 * Estratégia (mais segura):
 *   - Manter ID do doc com mais FKs cross-module (portal_images/tips/roteiros_bank
 *     ainda não usam destinationId nesses docs novos pending, então o "manual" é
 *     sempre o vencedor por preservar FKs históricos).
 *   - Renomear `city` pra grafia pt-BR canônica (definida no MERGE_PLAN abaixo).
 *   - Adicionar grafia antiga em `cityAliases[]` (concat, não substitui).
 *   - Deletar o doc duplicado APÓS verificar que não tem FK cross-module
 *     (portal_images.destinationId === id, portal_tips.destinationId === id).
 *
 * Não-destrutivo se rodar sem --apply. Idempotente.
 *
 * Casos especiais NÃO incluídos no auto-merge (Renê decide):
 *   - "?" como city (3 docs) — junk, mas pode ser dado que Renê quer corrigir
 *   - "Peru"/"Marrocos"/"Chile" como city — roteiros sem cidade específica
 *   - "Lençóis" sozinho (BA Chapada Diamantina?) vs "Lençóis Maranhenses" (MA)
 *
 * Uso:
 *   node merge-destinations-duplicates.cjs           # dry-run
 *   node merge-destinations-duplicates.cjs --apply   # execute
 */

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const APPLY = process.argv.includes('--apply');

console.log(`\n[merge-dups] Modo: ${APPLY ? '🟢 APPLY (write real)' : '🟡 DRY-RUN'}\n`);

/**
 * Plano de merge — cada entry define:
 *   - country (label legacy pt)
 *   - canonical: grafia que VAI FICAR no campo city
 *   - aliases: outras grafias que viram cityAliases[]
 *   - matchAny: TODAS as grafias possíveis (canonical + aliases) — usado pra detectar
 */
const MERGE_PLAN = [
  {
    country: 'África do Sul',
    canonical: 'Cidade do Cabo',
    aliases: ['Cape Town'],
    matchAny: ['cidade do cabo', 'cape town'],
  },
  {
    country: 'Japão',
    canonical: 'Quioto',
    aliases: ['Kyoto'],
    matchAny: ['quioto', 'kyoto'],
  },
  {
    country: 'Marrocos',
    canonical: 'Marrakech',
    aliases: ['Marrakesh', 'Marraquexe'],
    matchAny: ['marrakech', 'marrakesh', 'marraquexe'],
  },
  {
    country: 'Marrocos',
    canonical: 'Fez',
    aliases: ['Fès', 'Fes'],
    matchAny: ['fez', 'fes', 'fès'],
  },
];

// Duplicatas LITERAIS (mesmo nome 2x) — agrupa por (country+city) exato
const LITERAL_DUP_DETECTION = true;

function nk(s) {
  return String(s || '').toLowerCase().trim().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

(async () => {
  // 1. Carrega todos os destinos
  const snap = await db.collection('portal_destinations').get();
  const allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`Total docs: ${allDocs.length}\n`);

  // 2. Detecta grupos
  const groups = [];   // { country, members: [...], canonical: doc, aliases: [strings], rename }

  // 2a. MERGE_PLAN (aliases hardcoded — en/pt)
  for (const plan of MERGE_PLAN) {
    const members = allDocs.filter(d =>
      nk(d.country) === nk(plan.country) &&
      plan.matchAny.includes(nk(d.city))
    );
    if (members.length < 2) continue;

    // Escolhe o KEEPER: prefere manual approved (FK cross-module geralmente aponta pra ele)
    const keeper = members.find(m => (m.source === 'manual' || !m.source) && (m.reviewStatus === 'approved' || !m.reviewStatus))
                || members.find(m => m.source === 'manual' || !m.source)
                || members[0];
    const trash = members.filter(m => m.id !== keeper.id);
    const otherCityGrafias = new Set();
    for (const m of trash) {
      if (m.city && nk(m.city) !== nk(plan.canonical)) otherCityGrafias.add(m.city.trim());
    }
    // Adiciona alias mesmo do keeper se city dele ≠ canonical
    if (keeper.city && nk(keeper.city) !== nk(plan.canonical)) {
      otherCityGrafias.add(keeper.city.trim());
    }

    groups.push({
      country: plan.country,
      keeper,
      trash,
      newCity: plan.canonical,
      newAliases: [...otherCityGrafias, ...plan.aliases]
        .filter((v, i, a) => a.indexOf(v) === i && nk(v) !== nk(plan.canonical)),
    });
  }

  // 2b. Duplicatas literais (mesmo country+city exato)
  if (LITERAL_DUP_DETECTION) {
    const seen = new Map();   // key → [docs]
    for (const d of allDocs) {
      if (!d.city || !d.country) continue;
      const key = `${nk(d.country)}|${nk(d.city)}`;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push(d);
    }
    for (const [key, members] of seen) {
      if (members.length < 2) continue;
      // Skip se já está num grupo do MERGE_PLAN
      const alreadyIn = groups.some(g =>
        g.keeper.id === members[0].id ||
        g.trash.some(t => t.id === members[0].id)
      );
      if (alreadyIn) continue;
      const keeper = members.find(m => m.source === 'manual' || !m.source) || members[0];
      const trash = members.filter(m => m.id !== keeper.id);
      groups.push({
        country: keeper.country,
        keeper,
        trash,
        newCity: keeper.city,   // nome já está correto, só dedupe
        newAliases: [],
      });
    }
  }

  console.log(`Grupos detectados: ${groups.length}\n`);

  // 3. Pra cada grupo, faz FK cleanup defensivo + merge
  let mergedCount = 0;
  let deletedCount = 0;
  const fkChecks = { images: 0, tips: 0, bank: 0, redirected: 0 };

  for (const g of groups) {
    console.log(`\n[${g.country}] KEEPER id=${g.keeper.id} city="${g.keeper.city}" → "${g.newCity}"`);
    if (g.newAliases.length) console.log(`   cityAliases: [${g.newAliases.join(', ')}]`);
    for (const t of g.trash) {
      console.log(`   DELETE id=${t.id} city="${t.city}" (${t.source||'?'}, ${t.reviewStatus||'approved'})`);
    }

    if (APPLY) {
      // 3a. Update keeper: novo city + aliases mergeados com existentes
      const existingAliases = Array.isArray(g.keeper.cityAliases) ? g.keeper.cityAliases : [];
      const finalAliases = [...new Set([...existingAliases, ...g.newAliases])]
        .filter(a => nk(a) !== nk(g.newCity));
      const update = {
        city: g.newCity,
        cityAliases: finalAliases,
        mergedAt: FV.serverTimestamp(),
        updatedAt: FV.serverTimestamp(),
        updatedBy:  'system',
      };
      await db.collection('portal_destinations').doc(g.keeper.id).update(update);
      mergedCount++;

      // 3b. FK redirect cross-module — pra cada trash, atualiza refs
      for (const t of g.trash) {
        // portal_images.destinationId
        try {
          const imgSnap = await db.collection('portal_images')
            .where('destinationId', '==', t.id).limit(500).get();
          if (!imgSnap.empty) {
            const batch = db.batch();
            imgSnap.forEach(d => batch.update(d.ref, { destinationId: g.keeper.id }));
            await batch.commit();
            fkChecks.images += imgSnap.size;
            fkChecks.redirected += imgSnap.size;
          }
        } catch (e) { console.warn('  cleanup portal_images falhou:', e?.message); }

        // portal_tips.destinationId
        try {
          const tipSnap = await db.collection('portal_tips')
            .where('destinationId', '==', t.id).limit(500).get();
          if (!tipSnap.empty) {
            const batch = db.batch();
            tipSnap.forEach(d => batch.update(d.ref, { destinationId: g.keeper.id }));
            await batch.commit();
            fkChecks.tips += tipSnap.size;
            fkChecks.redirected += tipSnap.size;
          }
        } catch (e) { console.warn('  cleanup portal_tips falhou:', e?.message); }

        // roteiros_bank.geo.destinationIds[] (array)
        try {
          const bankSnap = await db.collection('roteiros_bank')
            .where('geo.destinationIds', 'array-contains', t.id).limit(500).get();
          if (!bankSnap.empty) {
            const batch = db.batch();
            bankSnap.forEach(d => {
              const data = d.data();
              const ids = (data.geo?.destinationIds || []).map(x => x === t.id ? g.keeper.id : x);
              const uniqIds = [...new Set(ids)];
              batch.update(d.ref, { 'geo.destinationIds': uniqIds });
            });
            await batch.commit();
            fkChecks.bank += bankSnap.size;
            fkChecks.redirected += bankSnap.size;
          }
        } catch (e) { console.warn('  cleanup roteiros_bank falhou:', e?.message); }

        // 3c. DELETE doc trash
        await db.collection('portal_destinations').doc(t.id).delete();
        deletedCount++;
      }
    }
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('  RESUMO');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Grupos processados: ${groups.length}`);
  console.log(`Keepers merged:     ${mergedCount}`);
  console.log(`Trash deletados:    ${deletedCount}`);
  if (APPLY) {
    console.log(`FK redirects:`);
    console.log(`  portal_images: ${fkChecks.images}`);
    console.log(`  portal_tips:   ${fkChecks.tips}`);
    console.log(`  roteiros_bank: ${fkChecks.bank}`);
    console.log(`  TOTAL:         ${fkChecks.redirected}`);
    console.log(`\n✓ portal_destinations: 289 → ${289 - deletedCount} após merge`);
  } else {
    console.log('\n✓ DRY-RUN OK. Re-rode com --apply pra executar.');
  }

  // 4. Junk listing (Renê decide)
  console.log('\n═══ JUNK ENCONTRADO (NÃO auto-tratado) ═══');
  const junk = allDocs.filter(d => {
    const city = (d.city || '').trim();
    return !city
        || city === '?'
        || nk(city) === nk(d.country);   // city === country (Peru, Marrocos, Chile)
  });
  console.log(`Total: ${junk.length}`);
  junk.forEach(j => console.log(`  ⚠ id=${j.id}  city="${j.city||'(vazio)'}" / ${j.country} (${j.source||'?'}, ${j.reviewStatus||'approved'})`));

  process.exit(0);
})().catch(e => { console.error('[merge-dups] ERRO:', e); process.exit(1); });
