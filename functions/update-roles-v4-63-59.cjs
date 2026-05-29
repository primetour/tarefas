/**
 * Update de roles pós-auditoria v4.63.59.
 * Renê: "atualizar roles deve estar desatualizado".
 *
 * Decisões:
 * - member (Analista): nada mudar.
 * - manager (Gerente): +portal_images_manage, +templates_manage
 * - coordinator (Coordenador): +portal_images_manage, +portal_areas_manage, +templates_manage
 *
 * Idempotente. Audit log incluso.
 */
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const APPLY = process.argv.includes('--apply');

const PLAN = {
  manager:     ['portal_images_manage', 'templates_manage'],
  coordinator: ['portal_images_manage', 'portal_areas_manage', 'templates_manage'],
};

(async () => {
  console.log(`\n=== UPDATE ROLES ${APPLY ? '(APPLY)' : '(DRY-RUN)'} ===\n`);

  for (const [roleId, addPerms] of Object.entries(PLAN)) {
    const ref  = db.collection('roles').doc(roleId);
    const snap = await ref.get();
    if (!snap.exists) { console.log(`✗ role ${roleId} não existe — pulado.`); continue; }
    const data = snap.data();
    const cur  = data.permissions || {};
    const toAdd = addPerms.filter(p => cur[p] !== true);
    if (!toAdd.length) {
      console.log(`· ${roleId}: já tem todas as perms (${addPerms.join(', ')}) — skip`);
      continue;
    }
    const next = { ...cur };
    toAdd.forEach(p => { next[p] = true; });
    console.log(`${APPLY ? '✓' : '·'} ${roleId} (${data.label || data.name || roleId})`);
    console.log(`     +${toAdd.join(', +')}`);
    if (APPLY) {
      await ref.update({
        permissions: next,
        updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
        updatedBy:   'system-rules-audit-v4.63.59',
      });
      await db.collection('audit_logs').add({
        action:    'role.permission_added',
        userId:    'system',
        entity:    'role',
        entityId:  roleId,
        severity:  'info',
        details:   { added: toAdd, source: 'v4.63.59 audit hotfix' },
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  console.log(`\n${APPLY ? '✓ APPLY done.' : '✓ DRY-RUN. Run with --apply.'}\n`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
