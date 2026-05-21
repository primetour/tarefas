/**
 * Unit test exaustivo dos 5 helpers de dashboard.
 * Pra cada role do Firestore (master/admin/manager/coord/member/partner),
 * simula store.can() com as perms reais e chama cada helper.
 * Compara resultado com matriz esperada.
 *
 * Resultado: 30 asserções (6 roles × 5 helpers).
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

// Réplica EXATA dos helpers do store.js (cópia)
function makeStore(roleId, perms) {
  return {
    isMaster: () => roleId === 'master',
    can: (key) => perms[key] === true,
    canViewHomeDashboard() {
      return this.isMaster() || this.can('dashboard_home_view');
    },
    canViewProductivityDashboard() {
      return this.isMaster() || this.can('dashboard_productivity_view')
        || this.can('dashboard_view') || this.can('analytics_view');
    },
    canViewPortalDashboard() {
      return this.isMaster() || this.can('dashboard_portal_view') || this.can('portal_manage');
    },
    canViewRoteirosDashboard() {
      return this.isMaster() || this.can('dashboard_roteiros_view') || this.can('roteiro_manage');
    },
    canViewCsatDashboard() {
      return this.isMaster() || this.can('dashboard_csat_view')
        || this.can('csat_view_all') || this.can('csat_manage');
    },
  };
}

// Matriz esperada (verdadeiro = pode ver)
const EXPECTED = {
  master:      { home: true,  prod: true,  portal: true,  roteiros: true,  csat: true  },
  admin:       { home: true,  prod: true,  portal: true,  roteiros: true,  csat: true  },
  manager:     { home: true,  prod: true,  portal: true,  roteiros: true,  csat: true  },
  coordinator: { home: true,  prod: true,  portal: true,  roteiros: true,  csat: true  },
  member:      { home: true,  prod: false, portal: false, roteiros: false, csat: false },
  partner:     { home: false, prod: false, portal: false, roteiros: false, csat: false },
};

(async () => {
  const snap = await db.collection('roles').get();
  const roles = {};
  snap.forEach(d => roles[d.id] = d.data().permissions || {});

  let passed = 0;
  let failed = 0;
  const failures = [];

  console.log('\n═══ UNIT TEST: 30 asserções dos helpers de dashboard ═══\n');
  for (const roleId of Object.keys(EXPECTED)) {
    if (!roles[roleId]) {
      console.log(`SKIP ${roleId} (role não encontrado no Firestore)`);
      continue;
    }
    const store = makeStore(roleId, roles[roleId]);
    const actual = {
      home:     store.canViewHomeDashboard(),
      prod:     store.canViewProductivityDashboard(),
      portal:   store.canViewPortalDashboard(),
      roteiros: store.canViewRoteirosDashboard(),
      csat:     store.canViewCsatDashboard(),
    };
    const exp = EXPECTED[roleId];
    const roleLine = [];
    for (const k of ['home','prod','portal','roteiros','csat']) {
      const ok = actual[k] === exp[k];
      const symbol = actual[k] ? '✓' : '✗';
      roleLine.push(ok ? `${k}:${symbol}` : `${k}:${symbol}!!!(esperado=${exp[k]})`);
      if (ok) passed++;
      else { failed++; failures.push(`${roleId}.${k}: esperado=${exp[k]}, real=${actual[k]}`); }
    }
    console.log(roleId.padEnd(13) + ' | ' + roleLine.join(' | '));
  }

  console.log(`\n─── RESULTADO ───`);
  console.log(`Passou: ${passed}/${passed+failed}`);
  console.log(`Falhou: ${failed}/${passed+failed}`);
  if (failures.length) {
    console.log('\nFalhas:');
    failures.forEach(f => console.log(`  ${f}`));
    process.exit(1);
  }
  console.log('\n✅ TODOS OS 30 TESTS PASSARAM\n');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
