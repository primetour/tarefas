/* Real-data render harness — fetches the actual Bradesco cotação from Firestore,
   runs it through the ACTUAL adapter (roteiroToTemplateData), renders with the
   ACTUAL seed template via Handlebars + Puppeteer replicating CF page.pdf.
   Validates v4.63.84: darker cover scrim + DICAS section rendering (no longer raw). */
import { createRequire } from 'module';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const admin = require('firebase-admin');
const Handlebars = require(path.join(ROOT, 'functions/node_modules/handlebars'));
const puppeteer = require(path.join(ROOT, 'functions/node_modules/puppeteer-core'));

const CHROME = '/Users/rene/.cache/puppeteer/chrome/mac_arm-148.0.7778.97/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const DOC_ID = process.argv[2] || '4bTybLbDGfarh3Rp5XSd';

admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const { roteiroToTemplateData } = await import(
  'file://' + path.join(ROOT, 'js/services/templateAdapter.js')
);

const seed = readFileSync(path.join(ROOT, 'templates/seeds/cotacoes-default-html.html'), 'utf8');

(async () => {
  const snap = await db.collection('roteiros').doc(DOC_ID).get();
  if (!snap.exists) { console.error('NOT FOUND', DOC_ID); process.exit(1); }
  const roteiro = snap.data();

  // Area lookup (Bradesco → pts-bradesco). Fall back to a default if absent.
  let area = null;
  if (roteiro.areaId) {
    const aSnap = await db.collection('portal_areas').doc(roteiro.areaId).get();
    if (aSnap.exists) area = { id: aSnap.id, ...aSnap.data() };
  }

  // Replicate _buildAdapterOpts cover resolution (hero override = images.hero).
  const opts = { coverImageUrl: roteiro?.images?.hero || '' };
  const data = roteiroToTemplateData(roteiro, area, opts);

  console.log('=== ADAPTER OUTPUT SANITY ===');
  console.log('titulo:', data.titulo);
  console.log('coverImageUrl:', (data.coverImageUrl || '(none)').slice(0, 80));
  console.log('dias:', (data.dias || []).length, '| voos:', (data.voos || []).length, '| hoteis:', (data.hoteis || []).length);
  console.log('dicas count:', (data.dicas || []).length);
  (data.dicas || []).forEach((d, i) => {
    console.log(`  dica[${i}] "${d.titulo}" / "${d.subtitulo}" — segmentos: ${d.segmentos.length}`);
    d.segmentos.forEach(s => {
      const n = s.isSpecialInfo ? `info(${s.info?.hasChips ? 'chips' : 'desc'})` : `${(s.items || []).length} itens`;
      console.log(`      · ${s.label} [${s.mode}] → ${n}`);
    });
  });

  const html = Handlebars.compile(seed, { noEscape: false })(data);
  writeFileSync('/tmp/cotacoes-real-4-63-84.html', html);

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, defaultViewport: { width: 1240, height: 1754 } });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
  const buf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' } });
  await browser.close();
  writeFileSync('/tmp/cotacoes-real-4-63-84.pdf', Buffer.from(buf));
  console.log('\n✓ PDF written /tmp/cotacoes-real-4-63-84.pdf', Buffer.from(buf).length, 'bytes');
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
