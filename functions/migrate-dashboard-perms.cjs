/**
 * Migração v4.49.11: renomeia `dashboard_view` → `dashboard_productivity_view`
 * e adiciona 4 perms novas em todos os roles.
 *
 * Defaults novos pras 4 perms (alinhado com SYSTEM_ROLES em rbac.js):
 *   master/admin/manager/coordinator: todas true
 *   member (Analista):                 só dashboard_home_view=true; demais=false
 *   partner:                            todas false
 *
 * Idempotente: se já tem dashboard_productivity_view, mantém o valor existente.
 * Custom roles: copia o valor antigo de dashboard_view pro productivity_view
 *               e seta defaults conservadores pras outras 4 (=false).
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const DEFAULTS_BY_ROLE = {
  master:      { home: true,  productivity: true,  portal: true,  roteiros: true,  csat: true  },
  admin:       { home: true,  productivity: true,  portal: true,  roteiros: true,  csat: true  },
  manager:     { home: true,  productivity: true,  portal: true,  roteiros: true,  csat: true  },
  coordinator: { home: true,  productivity: true,  portal: true,  roteiros: true,  csat: true  },
  member:      { home: true,  productivity: false, portal: false, roteiros: false, csat: false },
  partner:     { home: false, productivity: false, portal: false, roteiros: false, csat: false },
};

(async () => {
  const snap = await db.collection('roles').get();
  const results = [];

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const id = docSnap.id;
    const perms = data.permissions || {};
    const isSystemRole = !!DEFAULTS_BY_ROLE[id];

    // Valor a usar pra productivity:
    //   1. Se já existe dashboard_productivity_view → preserva
    //   2. Senão, se existe dashboard_view (legacy) → copia
    //   3. Senão, usa default do role
    let productivity;
    if ('dashboard_productivity_view' in perms) {
      productivity = perms.dashboard_productivity_view;
    } else if ('dashboard_view' in perms) {
      productivity = perms.dashboard_view;
    } else if (isSystemRole) {
      productivity = DEFAULTS_BY_ROLE[id].productivity;
    } else {
      productivity = false; // custom role sem nada definido → conservador
    }

    // Pras 4 outras perms novas: se já existem, preserva; senão usa default
    const pickDefault = (key) => {
      const fullKey = `dashboard_${key}_view`;
      if (fullKey in perms) return perms[fullKey];
      if (isSystemRole) return DEFAULTS_BY_ROLE[id][key];
      return false;
    };

    const patch = {
      'permissions.dashboard_home_view':         pickDefault('home'),
      'permissions.dashboard_productivity_view': productivity,
      'permissions.dashboard_portal_view':       pickDefault('portal'),
      'permissions.dashboard_roteiros_view':     pickDefault('roteiros'),
      'permissions.dashboard_csat_view':         pickDefault('csat'),
      // Remove a key antiga pra não ficar lixo (FieldValue.delete em path notation)
      'permissions.dashboard_view':              FV.delete(),
      updatedAt: FV.serverTimestamp(),
    };

    await docSnap.ref.update(patch);
    results.push({
      role: data.name || id,
      home: pickDefault('home'),
      productivity,
      portal: pickDefault('portal'),
      roteiros: pickDefault('roteiros'),
      csat: pickDefault('csat'),
    });
  }

  console.log('Migração v4.49.11 — Dashboard perms\n');
  console.log('Role'.padEnd(18) + ' | home  | prod  | portal | roteiros | csat');
  console.log('-'.repeat(70));
  results.forEach(r => {
    const cell = (v) => (v === true ? '  ✓  ' : v === false ? '  ✗  ' : '  ?  ');
    console.log(
      r.role.padEnd(18) + ' |' +
      cell(r.home) + ' |' + cell(r.productivity) + ' |' + cell(r.portal) +
      '  |' + cell(r.roteiros) + '   |' + cell(r.csat)
    );
  });
  console.log(`\nTotal de roles migrados: ${results.length}`);
  process.exit(0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
