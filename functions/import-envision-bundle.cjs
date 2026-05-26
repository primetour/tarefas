/**
 * Importa roteiros do bundle JSON pré-capturado (Chrome MCP).
 *
 * Caminho mais simples pra POC end-to-end:
 *   - Sem dependência de cookie Forms Auth
 *   - Sem chamadas HTTP ao Envision (dados já estão no bundle)
 *   - Idempotente: dedupe por envision.id antes de gravar
 *
 * Rodar: cd functions && node import-envision-bundle.cjs
 *
 * Próxima Fase: import-envision-live.cjs que captura via browser MCP
 * + grava em batch (sem cookie, usa MCP fetch).
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const fs = require('fs');
const path = require('path');

const samplesDir = path.join(__dirname, '..', 'docs', 'envision-samples');
// v4.58.7: prefere full-bundle (236 ativos via Admin) sobre fixtures-bundle (8 sample iniciais)
const bundles = fs.readdirSync(samplesDir)
  .filter(f => /^envision-(full|fixtures)-bundle-.*\.json$/.test(f))
  .map(f => path.join(samplesDir, f))
  .sort((a, b) => {
    // full-bundle tem prioridade
    const aFull = a.includes('full-bundle');
    const bFull = b.includes('full-bundle');
    if (aFull && !bFull) return 1;
    if (!aFull && bFull) return -1;
    return a.localeCompare(b);
  });
const bundlePath = bundles[bundles.length - 1];

// Carrega adapter via CJS hack (mesmo padrão do test runner)
const adapterSrc = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'services', 'envisionAdapter.js'),
  'utf8'
);
const cjsSrc = adapterSrc
  .replace(/^export function/gm, 'function')
  .replace(/^export const/gm, 'const')
  + '\nmodule.exports = { envisionItineraryToBank };';
const Module = require('module');
const m = new Module('envisionAdapter');
m._compile(cjsSrc, 'envisionAdapter.js');
const { envisionItineraryToBank } = m.exports;

/** Slug + autoCode (mirror das funções em roteiroBank.js) */
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/̀-ͯ/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
function autoCode(title, collectionLabel) {
  const pref = (collectionLabel || 'BNK').slice(0, 3).toUpperCase();
  const body = String(title || '')
    .toUpperCase()
    .normalize('NFD').replace(/̀-ͯ/g, '')
    .replace(/[^A-Z0-9 ]/g, '')
    .split(/\s+/).filter(Boolean)
    .slice(0, 3)
    .map(w => w.slice(0, 3))
    .join('');
  return `${pref}-${body || 'NEW'}`;
}

(async () => {
  console.log(`[import] bundle: ${path.basename(bundlePath)}`);
  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  console.log(`[import] ${bundle.fixtures.length} fixtures no bundle\n`);

  let created = 0, updated = 0, skipped = 0, errored = 0;

  for (const f of bundle.fixtures) {
    try {
      // Aplica adapter
      const bankDoc = envisionItineraryToBank(f.json, { importedBy: 'system' });

      // Gera code/slug se não tem
      bankDoc.code = bankDoc.code || autoCode(bankDoc.title, bankDoc.collectionLabel);
      bankDoc.slug = bankDoc.slug || slugify(bankDoc.title);

      // Server timestamps
      const now = FV.serverTimestamp();
      bankDoc.createdAt = now;
      bankDoc.createdBy = 'system';
      bankDoc.updatedAt = now;
      bankDoc.updatedBy = 'system';

      // Remove campos undefined/null que confundem o Firestore (queries por field exists)
      // — Firestore aceita null, mas preferimos limpar pra clareza no console
      Object.keys(bankDoc).forEach(k => { if (bankDoc[k] === undefined) delete bankDoc[k]; });

      // Dedupe por envision.id
      const envisionId = bankDoc.envision?.id;
      if (!envisionId) {
        console.log(`  ⏭️  skip "${bankDoc.title}" — sem envision.id`);
        skipped++;
        continue;
      }

      const existing = await db.collection('roteiros_bank')
        .where('envision.id', '==', envisionId)
        .limit(1)
        .get();

      if (!existing.empty) {
        // Update — preserva createdAt original
        const doc = existing.docs[0];
        const origData = doc.data();
        bankDoc.createdAt = origData.createdAt || now;
        bankDoc.createdBy = origData.createdBy || 'system';
        bankDoc.envision.syncedAt = new Date().toISOString();

        await doc.ref.set(bankDoc);
        console.log(`  ✓ UPDATE  envisionId=${envisionId}  doc=${doc.id}  "${bankDoc.title.slice(0,55)}"`);
        updated++;
      } else {
        // Create
        const ref = await db.collection('roteiros_bank').add(bankDoc);
        console.log(`  ✓ CREATE  envisionId=${envisionId}  doc=${ref.id}  "${bankDoc.title.slice(0,55)}"`);
        created++;
      }

      // Audit log
      await db.collection('audit_logs').add({
        action: existing.empty ? 'roteiros_bank.envision_import_create' : 'roteiros_bank.envision_import_update',
        actorId: 'system',
        actorName: 'Envision Import Batch',
        targetType: 'roteiros_bank',
        targetId: existing.empty ? null : existing.docs[0].id,
        details: { envisionId, title: bankDoc.title, source: 'fixture-bundle' },
        severity: 'info',
        timestamp: FV.serverTimestamp(),
      });
    } catch (e) {
      console.log(`  ❌ ERROR  ${f.envisionId}  "${(f.name||'').slice(0,50)}"  → ${e.message}`);
      errored++;
    }
  }

  console.log(`\n[import] RESULTADO:`);
  console.log(`  ✓ ${created} criados`);
  console.log(`  ↻ ${updated} atualizados`);
  console.log(`  ⏭️  ${skipped} skipped`);
  console.log(`  ❌ ${errored} errored`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
