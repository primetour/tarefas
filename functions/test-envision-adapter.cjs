/**
 * Test runner do envisionAdapter contra os 8 fixtures reais.
 *
 * Rodar: cd functions && node test-envision-adapter.cjs
 *
 * O que faz:
 *   1. Carrega bundle JSON (docs/envision-samples/envision-fixtures-bundle-*.json)
 *   2. Aplica adapter em cada um dos 8 itinerários
 *   3. Reporta coverage (% de campos populados, warnings)
 *   4. Salva output de cada um em docs/envision-samples/adapter-output/{envisionId}-{slug}.json
 *      → curador pode revisar visualmente o resultado.
 */
const fs = require('fs');
const path = require('path');

// Acha o bundle mais recente
const samplesDir = path.join(__dirname, '..', 'docs', 'envision-samples');
const bundles = fs.readdirSync(samplesDir)
  .filter(f => /^envision-fixtures-bundle-.*\.json$/.test(f))
  .map(f => path.join(samplesDir, f))
  .sort();
if (!bundles.length) {
  console.error('[test-adapter] bundle não encontrado em', samplesDir);
  process.exit(1);
}
const bundlePath = bundles[bundles.length - 1];
console.log(`[test-adapter] usando bundle: ${path.basename(bundlePath)}`);

// Carrega adapter via dynamic import (ESM)
(async () => {
  // Hack: o adapter é ESM mas estamos em CJS. Lê arquivo + eval no contexto
  // (alternativa seria converter pra .mjs, mas evita configurar package.json).
  const adapterSrc = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'services', 'envisionAdapter.js'),
    'utf8'
  );
  // Remove export keywords + adiciona module.exports
  const cjsSrc = adapterSrc
    .replace(/^export function/gm, 'function')
    .replace(/^export const/gm, 'const')
    + '\nmodule.exports = { envisionItineraryToBank, validateAdapterOutput };';

  const Module = require('module');
  const m = new Module('envisionAdapter');
  m._compile(cjsSrc, 'envisionAdapter.js');
  const { envisionItineraryToBank, validateAdapterOutput } = m.exports;

  // Carrega bundle
  const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
  console.log(`[test-adapter] ${bundle.fixtures.length} fixtures no bundle`);
  console.log();

  // Output dir
  const outDir = path.join(samplesDir, 'adapter-output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

  const results = [];

  for (const f of bundle.fixtures) {
    const envisionId = f.envisionId;
    const name = f.name;
    try {
      const bankDoc = envisionItineraryToBank(f.json, { importedBy: 'test-runner' });
      const warnings = validateAdapterOutput(bankDoc);

      // Stats
      const stats = {
        envisionId,
        name: name?.slice(0, 70),
        title: bankDoc.title?.slice(0, 60),
        days_count: bankDoc.days?.length || 0,
        categories_count: bankDoc.categories?.length || 0,
        hotels_total: (bankDoc.categories || []).reduce((s, c) => s + (c.hotels?.length || 0), 0),
        services_count: bankDoc.services?.length || 0,
        images_hero: !!bankDoc.images?.hero,
        images_gallery: bankDoc.images?.gallery?.length || 0,
        geo_cities: bankDoc.geo?.cities?.length || 0,
        geo_countries: bankDoc.geo?.countries?.length || 0,
        envisionRaw_has_includes: !!bankDoc.envisionRaw?.includes,
        envisionRaw_has_generalInfo: !!bankDoc.envisionRaw?.generalInfo,
        envisionRaw_has_cancellation: !!bankDoc.envisionRaw?.cancellationPolicy,
        envisionRaw_has_payment: !!bankDoc.envisionRaw?.formOfPayment,
        warnings,
      };
      results.push(stats);

      // Dump pro disco
      const filename = `adapter-${envisionId}-${slug(name)}.json`;
      fs.writeFileSync(
        path.join(outDir, filename),
        JSON.stringify(bankDoc, null, 2),
        'utf8'
      );
    } catch (e) {
      results.push({ envisionId, name, error: e.message });
    }
  }

  // Print table
  console.log('═'.repeat(140));
  console.log(`${'envisionId'.padEnd(10)}${'title'.padEnd(55)}${'days'.padEnd(6)}${'cats'.padEnd(6)}${'hotels'.padEnd(8)}${'svcs'.padEnd(6)}${'hero'.padEnd(6)}${'imgs'.padEnd(6)}${'cities'.padEnd(7)}${'warnings'}`);
  console.log('─'.repeat(140));
  for (const r of results) {
    if (r.error) {
      console.log(`${String(r.envisionId).padEnd(10)}${(r.name||'').slice(0,55).padEnd(55)}ERROR: ${r.error}`);
      continue;
    }
    console.log(
      `${String(r.envisionId).padEnd(10)}${(r.title||'').slice(0,55).padEnd(55)}` +
      `${String(r.days_count).padEnd(6)}${String(r.categories_count).padEnd(6)}` +
      `${String(r.hotels_total).padEnd(8)}${String(r.services_count).padEnd(6)}` +
      `${(r.images_hero ? '✓' : '-').padEnd(6)}${String(r.images_gallery).padEnd(6)}` +
      `${String(r.geo_cities).padEnd(7)}${r.warnings.length ? '⚠ ' + r.warnings.join('; ').slice(0, 60) : 'OK'}`
    );
  }
  console.log('═'.repeat(140));

  // Resumo
  const ok = results.filter(r => !r.error && !r.warnings?.length).length;
  const withWarn = results.filter(r => !r.error && r.warnings?.length).length;
  const errored = results.filter(r => r.error).length;
  console.log();
  console.log(`✅ Adapter OK + sem warnings: ${ok}/${results.length}`);
  console.log(`⚠️  Adapter OK + com warnings:  ${withWarn}/${results.length}`);
  console.log(`❌ Errored:                     ${errored}/${results.length}`);
  console.log();
  console.log(`📁 Outputs salvos em: docs/envision-samples/adapter-output/`);
  console.log(`   Reveja qualquer um pra confirmar mapeamento campo a campo.`);
})().catch(e => { console.error(e); process.exit(1); });
