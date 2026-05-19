/**
 * Audit refinado: detecta perms checadas via HELPERS do store
 * (não só store.can() direto). Reduz false-positives.
 *
 * Como funciona:
 *   1. Lê store.js — mapeia HELPER → PERMS que ele wrapa
 *   2. Varre código: store.can(...) direto + chamadas a HELPER()
 *   3. Perm é "usada" se: checada direto OU via helper que wrapa ela
 *   4. Reporta APENAS perms verdadeiramente órfãs
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// 1. Catálogo
const rbacSrc = fs.readFileSync(path.join(ROOT, 'js/services/rbac.js'), 'utf8');
const catalogKeys = [...rbacSrc.matchAll(/{\s*key:\s*'([\w_]+)'/g)].map(m => m[1]);
const catalogSet = new Set(catalogKeys);

// 2. Mapa helper → perms (ex: canPortal → ['portal_access'])
const storeSrc = fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8');
const helperToPerm = {};
// Match function helpers that contain this.can('perm_x')
// Suporta vários this.can() no corpo
const fnRegex = /can(\w+)\s*\(\s*\)\s*\{([^}]+)\}/g;
for (const m of storeSrc.matchAll(fnRegex)) {
  const fnName = 'can' + m[1];
  const body = m[2];
  const perms = [...body.matchAll(/this\.can\(['"]([\w_]+)['"]\)/g)].map(x => x[1]);
  if (perms.length) helperToPerm[fnName] = perms;
}

// 3. Varre código
function walk(d, acc) {
  fs.readdirSync(d).forEach(f => {
    const full = path.join(d, f);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, acc);
    else if (f.endsWith('.js')) acc.push(full);
  });
}
const allFiles = [];
['js/services', 'js/pages', 'js/components', 'js/auth'].forEach(d => walk(path.join(ROOT, d), allFiles));

const directChecks = new Set();
const helperChecks = new Set();
const fileForPerm = {};

allFiles.forEach(f => {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f);
  // store.can() direto
  for (const m of src.matchAll(/store\.can\(['"]([\w_]+)['"]\)/g)) {
    directChecks.add(m[1]);
    (fileForPerm[m[1]] ||= new Set()).add(rel);
  }
  // routeGuard
  for (const m of src.matchAll(/routeGuard\([^,)]+,\s*['"]([\w_]+)['"]/g)) {
    directChecks.add(m[1]);
    (fileForPerm[m[1]] ||= new Set()).add(rel);
  }
  // routeGuard com array
  for (const m of src.matchAll(/routeGuard\([^,)]+,\s*\[([^\]]+)\]/g)) {
    m[1].split(',').forEach(p => {
      const clean = p.trim().replace(/['"]/g, '');
      if (clean) {
        directChecks.add(clean);
        (fileForPerm[clean] ||= new Set()).add(rel);
      }
    });
  }
  // Chamadas a helpers do store: store.canXyz()
  for (const m of src.matchAll(/store\.(can[A-Z]\w*)\(\)/g)) {
    const fn = m[1];
    if (helperToPerm[fn]) {
      helperToPerm[fn].forEach(p => {
        helperChecks.add(p);
        (fileForPerm[p] ||= new Set()).add(rel + ` (via ${fn})`);
      });
    }
  }
  // Chamadas no formato this.X (dentro do próprio store.js, etc)
  for (const m of src.matchAll(/this\.(can[A-Z]\w*)\(\)/g)) {
    const fn = m[1];
    if (helperToPerm[fn]) {
      helperToPerm[fn].forEach(p => helperChecks.add(p));
    }
  }
});

const usedPerms = new Set([...directChecks, ...helperChecks]);

// Perms server-side only (LGPD/security/audit) — não esperamos guards JS
const SERVER_ONLY_PERMS = new Set([
  'lgpd_export_own', 'lgpd_erasure_own',
  'lgpd_export_others', 'lgpd_erasure_others',
  'privacy_consent_manage',
  'audit_logs_view', 'security_digest_view',
  'security_alerts_receive', 'secrets_audit_view',
]);

const realOrphans = catalogKeys.filter(k => !usedPerms.has(k) && !SERVER_ONLY_PERMS.has(k));
const serverOnlyOrphans = catalogKeys.filter(k => SERVER_ONLY_PERMS.has(k));

console.log('═══════════════════════════════════════════════════════');
console.log('AUDIT REFINADO RBAC');
console.log('═══════════════════════════════════════════════════════\n');
console.log(`Catálogo:                  ${catalogKeys.length}`);
console.log(`Helpers do store mapeados: ${Object.keys(helperToPerm).length}`);
console.log(`Checks diretos (store.can): ${directChecks.size} perms`);
console.log(`Checks via helper:           ${helperChecks.size} perms`);
console.log(`Total usadas:                ${usedPerms.size}`);
console.log(`Server-only (esperado órfã): ${serverOnlyOrphans.length}`);
console.log(`Órfãs reais (precisa fix):   ${realOrphans.length}\n`);

console.log('─── HELPERS DETECTADOS ───');
Object.entries(helperToPerm).forEach(([h, ps]) => {
  console.log(`  store.${h}()  →  ${ps.join(', ')}`);
});

console.log('\n─── ÓRFÃS LEGÍTIMAS (server-side LGPD/security) ───');
serverOnlyOrphans.forEach(p => console.log(`  ✓ ${p}  (rules/Cloud Functions)`));

console.log('\n─── ÓRFÃS REAIS (precisam decisão) ───');
if (realOrphans.length === 0) console.log('  🎉 NENHUMA — todas as perms estão wiradas!');
else realOrphans.forEach(p => console.log(`  ✗ ${p}`));
