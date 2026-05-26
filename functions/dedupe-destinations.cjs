/**
 * Dedupe portal_destinations duplicados (mesmo continent+country+city).
 *
 * Estratégia:
 *  1. Agrupa por chave (continent|country|city).
 *  2. Pra cada grupo com >1 doc: elege "vencedor" (o mais antigo
 *     OU o com menos autoCreated flag — preferir manual).
 *  3. Merge campos não-vazios dos perdedores no vencedor (areaId,
 *     heroImage, etc.).
 *  4. Re-aponta FK em portal_tips.destinationId, portal_images.destinationId,
 *     roteiros_bank.geo.destinationIds, roteiros.embeddedTips[].destinationId.
 *  5. Deleta os perdedores.
 *  6. Audit log de cada merge pra forense.
 *
 * IDEMPOTENTE: rodar de novo sem efeito (sem duplicações restantes).
 * SAFE: dry-run mode via flag DRY_RUN=true (default false).
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const DRY_RUN = process.env.DRY_RUN === 'true';

function key(d) {
  return `${(d.continent||'').trim()}|${(d.country||'').trim()}|${(d.city||'').trim()}`;
}

// Elege vencedor: prefere NÃO autoCreated, depois o mais antigo.
function pickWinner(docs) {
  const sorted = [...docs].sort((a, b) => {
    const aAuto = a.data.autoCreated ? 1 : 0;
    const bAuto = b.data.autoCreated ? 1 : 0;
    if (aAuto !== bAuto) return aAuto - bAuto;  // manual primeiro
    const aTs = a.data.createdAt?.toMillis?.() || Number.MAX_SAFE_INTEGER;
    const bTs = b.data.createdAt?.toMillis?.() || Number.MAX_SAFE_INTEGER;
    return aTs - bTs;  // mais antigo primeiro
  });
  return sorted[0];
}

function mergeFields(winner, losers) {
  const merged = { ...winner.data };
  for (const l of losers) {
    for (const [k, v] of Object.entries(l.data)) {
      // Não sobrescreve se vencedor já tem valor não-vazio
      if (merged[k] != null && merged[k] !== '' && merged[k] !== false) continue;
      if (v != null && v !== '' && v !== false) merged[k] = v;
    }
  }
  // Não inclui autoCreated metadata no merge final (resetar flag)
  delete merged.autoCreated;
  delete merged.autoCreatedSource;
  return merged;
}

async function reapointFKs(loserIds, winnerId) {
  let reapointed = { tips: 0, images: 0, bank: 0, roteiros: 0 };

  // portal_tips.destinationId
  for (const loserId of loserIds) {
    const tipsSnap = await db.collection('portal_tips').where('destinationId', '==', loserId).get();
    if (!tipsSnap.empty) {
      const batch = db.batch();
      tipsSnap.forEach(d => batch.update(d.ref, { destinationId: winnerId, _dedupeReapointedAt: FV.serverTimestamp() }));
      if (!DRY_RUN) await batch.commit();
      reapointed.tips += tipsSnap.size;
    }
  }

  // portal_images.destinationId
  for (const loserId of loserIds) {
    const imgSnap = await db.collection('portal_images').where('destinationId', '==', loserId).get();
    if (!imgSnap.empty) {
      const batch = db.batch();
      imgSnap.forEach(d => batch.update(d.ref, { destinationId: winnerId, _dedupeReapointedAt: FV.serverTimestamp() }));
      if (!DRY_RUN) await batch.commit();
      reapointed.images += imgSnap.size;
    }
  }

  // roteiros_bank.geo.destinationIds (array — array-contains)
  for (const loserId of loserIds) {
    const bankSnap = await db.collection('roteiros_bank').where('geo.destinationIds', 'array-contains', loserId).get();
    if (!bankSnap.empty) {
      const batch = db.batch();
      bankSnap.forEach(d => {
        const arr = d.data().geo?.destinationIds || [];
        const newArr = arr.map(id => id === loserId ? winnerId : id);
        // Dedupe internal (caso winner já estivesse na lista)
        const deduped = [...new Set(newArr)];
        batch.update(d.ref, { 'geo.destinationIds': deduped, _dedupeReapointedAt: FV.serverTimestamp() });
      });
      if (!DRY_RUN) await batch.commit();
      reapointed.bank += bankSnap.size;
    }
  }

  // roteiros.embeddedTips[].destinationId (read-modify-write — array de objetos)
  // Scan cap 500 (tradeoff: produção pequena, OK)
  const rotSnap = await db.collection('roteiros').limit(500).get();
  let dirty = [];
  rotSnap.forEach(d => {
    const tips = Array.isArray(d.data().embeddedTips) ? d.data().embeddedTips : [];
    let changed = false;
    const updated = tips.map(t => {
      if (t?.destinationId && loserIds.includes(t.destinationId)) {
        changed = true;
        return { ...t, destinationId: winnerId };
      }
      return t;
    });
    if (changed) dirty.push({ ref: d.ref, embeddedTips: updated });
  });
  if (dirty.length) {
    const batch = db.batch();
    dirty.forEach(({ ref, embeddedTips }) => batch.update(ref, { embeddedTips, _dedupeReapointedAt: FV.serverTimestamp() }));
    if (!DRY_RUN) await batch.commit();
    reapointed.roteiros = dirty.length;
  }

  return reapointed;
}

(async () => {
  console.log(`=== Dedupe portal_destinations (DRY_RUN=${DRY_RUN}) ===\n`);
  const snap = await db.collection('portal_destinations').get();
  const groups = {};
  snap.forEach(d => {
    const data = d.data();
    const k = key(data);
    if (!groups[k]) groups[k] = [];
    groups[k].push({ id: d.id, ref: d.ref, data });
  });

  const dupes = Object.entries(groups).filter(([_, arr]) => arr.length > 1);
  console.log(`Total docs: ${snap.size}`);
  console.log(`Grupos com duplicação: ${dupes.length}\n`);

  if (dupes.length === 0) {
    console.log('✓ Nenhuma duplicação. Nada a fazer.');
    process.exit(0);
  }

  const summary = [];
  for (const [k, docs] of dupes) {
    const winner = pickWinner(docs);
    const losers = docs.filter(d => d.id !== winner.id);
    console.log(`\nGrupo: ${k}`);
    console.log(`  Vencedor: ${winner.id} (autoCreated=${winner.data.autoCreated || false})`);
    console.log(`  Perdedores (${losers.length}): ${losers.map(l => l.id).join(', ')}`);

    const mergedData = mergeFields(winner, losers);
    if (!DRY_RUN) {
      // Update vencedor com fields mergeados
      await winner.ref.set(mergedData, { merge: true });
    }
    const loserIds = losers.map(l => l.id);
    const reapointed = await reapointFKs(loserIds, winner.id);
    console.log(`  FK re-apointed:`, reapointed);

    if (!DRY_RUN) {
      // Deleta perdedores
      const batch = db.batch();
      losers.forEach(l => batch.delete(l.ref));
      await batch.commit();

      // Audit log
      await db.collection('audit_logs').add({
        action: 'system.portal_destinations_deduped',
        userId: 'system',
        severity: 'info',
        groupKey: k,
        winnerId: winner.id,
        losersIds: loserIds,
        reapointed,
        timestamp: FV.serverTimestamp(),
      });
    }
    summary.push({ group: k, winner: winner.id, losers: loserIds, reapointed });
  }

  console.log(`\n=== Resumo (DRY_RUN=${DRY_RUN}) ===`);
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
})();
