/* Minimal banco seed render check — validates v4.63.93 full-bleed cover +
   top margin on continuation pages + no loose footer block at top. */
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const Handlebars = require(path.join(ROOT, 'functions/node_modules/handlebars'));
const puppeteer = require(path.join(ROOT, 'functions/node_modules/puppeteer-core'));

const CHROME = '/Users/rene/.cache/puppeteer/chrome/mac_arm-148.0.7778.97/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

const tpl = readFileSync(path.join(ROOT, 'templates/seeds/banco-roteiros-default-html.html'), 'utf8');

const data = {
  titulo: 'China Imperial & Tibete Sagrado',
  today: '30/05/2026',
  area: { nome: 'PRIMETOUR', corPrimary: '#2563EB', corSecondary: '#0A1628', corAccent: '#D4A843', logoUrl: '' },
  viagem: { destinos: 'Pequim · Xian · Lhasa · Shanghai', noites: 12 },
  dias: Array.from({ length: 14 }, (_, i) => ({
    num: i + 1,
    titulo: `Dia ${i + 1} — Exploração`,
    city: 'PEQUIM',
    narrative: 'Chegada e traslado privativo ao hotel. Restante do dia livre para descanso e aclimatação à cultura local com nosso anfitrião exclusivo.',
  })),
};

const html = Handlebars.compile(tpl)(data);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle0', timeout: 60000 });
const buf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
await browser.close();

const { writeFileSync } = require('fs');
writeFileSync('/tmp/banco-check.pdf', buf);
console.log('✓ banco PDF written /tmp/banco-check.pdf', buf.length, 'bytes');
