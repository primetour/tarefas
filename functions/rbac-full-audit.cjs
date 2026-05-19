/**
 * Audit estático completo do RBAC.
 * 1. Lê PERMISSION_CATALOG + SYSTEM_ROLES do rbac.js
 * 2. Varre js/services/ + js/pages/ + js/components/ atrás de:
 *    - store.can('perm_x')
 *    - canX() helpers no store
 *    - routeGuard('perm_x')
 * 3. Mapeia: endpoint → perm checada
 * 4. Pra cada role, simula resposta esperada (allow/deny)
 * 5. Identifica:
 *    - Perms checadas no código que NÃO existem no catálogo (órfãs reversas)
 *    - Perms do catálogo NUNCA checadas (órfãs)
 *    - Roles que receberiam erro inesperado
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ──────────────────────────────────────────────────────────────────
// 1. Lê rbac.js
// ──────────────────────────────────────────────────────────────────
const rbacSrc = fs.readFileSync(path.join(ROOT, 'js/services/rbac.js'), 'utf8');

// Parse PERMISSION_CATALOG keys
const catalogKeys = [...rbacSrc.matchAll(/{\s*key:\s*'([\w_]+)'/g)].map(m => m[1]);
const catalogSet = new Set(catalogKeys);

// Parse SYSTEM_ROLES — cada role com seu mapa de perms
// Procura por id: 'xxx' seguido de permissions: { ... }
const ROLE_IDS = ['master', 'admin', 'manager', 'coordinator', 'partner', 'member'];
const roles = {};
ROLE_IDS.forEach(id => {
  const match = rbacSrc.match(new RegExp(`id:\\s*'${id}'[\\s\\S]*?permissions:\\s*({[\\s\\S]*?\\n\\s{0,6}})`, 'm'));
  if (!match) { roles[id] = { _err: 'block not found' }; return; }
  const block = match[1];
  // Master é gerado dinamicamente — assume todas true
  if (id === 'master') { roles[id] = Object.fromEntries(catalogKeys.map(k => [k, true])); return; }
  const perms = {};
  for (const m of block.matchAll(/([\w_]+):\s*(true|false)/g)) {
    perms[m[1]] = m[2] === 'true';
  }
  roles[id] = perms;
});

// ──────────────────────────────────────────────────────────────────
// 2. Varre código atrás de checagens de perm
// ──────────────────────────────────────────────────────────────────
const dirs = ['js/services', 'js/pages', 'js/components', 'js/auth'];
const allFiles = [];
function walk(d) {
  fs.readdirSync(d).forEach(f => {
    const full = path.join(d, f);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full);
    else if (f.endsWith('.js')) allFiles.push(full);
  });
}
dirs.forEach(d => walk(path.join(ROOT, d)));

const checks = []; // { file, line, perm, fn }
const STORE_CAN_RE   = /store\.can\(['"]([\w_]+)['"]\)/g;
const ROUTE_GUARD_RE = /routeGuard\([^,)]+,\s*['"]([\w_]+)['"]/g;
const ROUTE_GUARD_ARR_RE = /routeGuard\([^,)]+,\s*\[([^\]]+)\]/g;

allFiles.forEach(f => {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f);
  for (const m of src.matchAll(STORE_CAN_RE)) {
    const lineNum = src.slice(0, m.index).split('\n').length;
    checks.push({ file: rel, line: lineNum, perm: m[1], how: 'store.can' });
  }
  for (const m of src.matchAll(ROUTE_GUARD_RE)) {
    const lineNum = src.slice(0, m.index).split('\n').length;
    checks.push({ file: rel, line: lineNum, perm: m[1], how: 'routeGuard' });
  }
  for (const m of src.matchAll(ROUTE_GUARD_ARR_RE)) {
    const lineNum = src.slice(0, m.index).split('\n').length;
    const perms = m[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
    perms.forEach(p => checks.push({ file: rel, line: lineNum, perm: p, how: 'routeGuard[]' }));
  }
});

// Helpers especiais no store.js (canManageX → checa perm_y)
const storeSrc = fs.readFileSync(path.join(ROOT, 'js/store.js'), 'utf8');
const helperMap = {};
for (const m of storeSrc.matchAll(/can(\w+)\(\)\s*{\s*[^}]*?can\('([\w_]+)'\)/g)) {
  helperMap['can' + m[1]] = m[2];
}

// ──────────────────────────────────────────────────────────────────
// 3. Compila matriz
// ──────────────────────────────────────────────────────────────────
const permsUsed = new Set(checks.map(c => c.perm));
const orphansInCatalog  = catalogKeys.filter(k => !permsUsed.has(k));
const orphansInChecks   = [...permsUsed].filter(p => !catalogSet.has(p));

// Endpoints por perm
const endpointsByPerm = {};
checks.forEach(c => {
  (endpointsByPerm[c.perm] ||= []).push(`${c.file}:${c.line} (${c.how})`);
});

// ──────────────────────────────────────────────────────────────────
// 4. Matriz role × perm
// ──────────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════════');
console.log('RBAC FULL AUDIT — v4.49.10');
console.log('═══════════════════════════════════════════════════════════════════\n');
console.log(`Catálogo:         ${catalogKeys.length} permissions`);
console.log(`Roles do sistema: ${ROLE_IDS.length}`);
console.log(`Files varridos:   ${allFiles.length}`);
console.log(`Guard checks:     ${checks.length}\n`);

console.log('─── ÓRFÃS NO CATÁLOGO (definidas mas NUNCA checadas no código) ───');
if (orphansInCatalog.length) {
  orphansInCatalog.forEach(p => console.log(`  ✗ ${p}`));
} else { console.log('  (nenhuma)'); }
console.log('');

console.log('─── ÓRFÃS NOS CHECKS (checadas mas NÃO no catálogo — typo?) ───');
if (orphansInChecks.length) {
  orphansInChecks.forEach(p => console.log(`  ✗ ${p}  → endpoints: ${endpointsByPerm[p].slice(0,2).join('; ')}`));
} else { console.log('  (nenhuma)'); }
console.log('');

console.log('─── MATRIZ ROLE × PERM (mostra apenas perms checadas no código) ───\n');
const permsActive = [...permsUsed].filter(p => catalogSet.has(p)).sort();
// Cabeçalho
const header = ['Perm'.padEnd(34), ...ROLE_IDS.map(r => r.slice(0,5).padStart(6))].join(' | ');
console.log(header);
console.log('-'.repeat(header.length));
permsActive.forEach(p => {
  const cells = ROLE_IDS.map(r => {
    const v = roles[r][p];
    if (v === true)  return '   ✓  ';
    if (v === false) return '   ✗  ';
    return '   ?  '; // não definido = falsy por design
  });
  console.log([p.padEnd(34), ...cells].join(' | '));
});

console.log('\n─── ENDPOINTS POR PERM (top 15 com mais usos) ───');
const sorted = permsActive.map(p => ({ p, n: endpointsByPerm[p].length }))
  .sort((a,b) => b.n - a.n).slice(0, 15);
sorted.forEach(({ p, n }) => {
  console.log(`  ${p.padEnd(34)} → ${n} check(s)`);
  endpointsByPerm[p].slice(0, 3).forEach(e => console.log(`      ${e}`));
});

// ──────────────────────────────────────────────────────────────────
// 5. Simulação por role: o que cada role consegue/não consegue
// ──────────────────────────────────────────────────────────────────
console.log('\n─── SIMULAÇÃO POR ROLE: o que cada um CONSEGUE/NÃO CONSEGUE ───\n');
ROLE_IDS.forEach(r => {
  const can = [];
  const cannot = [];
  permsActive.forEach(p => {
    if (roles[r][p] === true) can.push(p);
    else cannot.push(p);
  });
  console.log(`${r.toUpperCase()} (${roles[r].name || ''})`);
  console.log(`  PODE (${can.length}): ${can.slice(0, 8).join(', ')}${can.length > 8 ? '…' : ''}`);
  console.log(`  NÃO PODE (${cannot.length}): ${cannot.slice(0, 6).join(', ')}${cannot.length > 6 ? '…' : ''}`);
  console.log('');
});

// ──────────────────────────────────────────────────────────────────
// 6. Helpers do store
// ──────────────────────────────────────────────────────────────────
console.log('─── HELPERS DO STORE (canX → checa perm_y) ───');
Object.entries(helperMap).forEach(([h, p]) => {
  console.log(`  ${h}() → ${p}`);
});

console.log('\n═══════════════════════════════════════════════════════════════════');
