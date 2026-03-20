/**
 * PRIMETOUR — Seed: Configurações de IA (meta_config + linkedin_config)
 * Cria documentos com submaps no Firestore via Admin SDK
 *
 * Como usar (via GitHub Actions — igual ao portal-seed.js):
 *   1. Vá em github.com/primetour/tarefas → Actions → "Seed AI Settings"
 *   2. Clique em "Run workflow"
 *   3. Preencha os inputs solicitados
 *
 * Ou localmente:
 *   FIREBASE_PROJECT_ID=gestor-de-tarefas-primetour \
 *   FIREBASE_CLIENT_EMAIL=xxx \
 *   FIREBASE_PRIVATE_KEY=xxx \
 *   META_TOKEN=xxx \
 *   IG_ID_PRIMETOUR=xxx \
 *   IG_ID_ICS=xxx \
 *   node scripts/ai-settings-seed.js
 */

const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.cert({
    projectId:   process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
});

const db = admin.firestore();

async function seed() {
  console.log('🔧 Iniciando seed de configurações de IA…\n');

  /* ── meta_config ─────────────────────────────────────────── */
  const metaToken      = process.env.META_TOKEN        || '';
  const igIdPrimetour  = process.env.IG_ID_PRIMETOUR   || '';
  const igIdIcs        = process.env.IG_ID_ICS         || '';

  const metaDoc = {
    defaultToken: metaToken,
    accounts: {
      primetourviagens: {
        igUserId:    igIdPrimetour,
        accessToken: metaToken,
      },
      icsbyprimetour: {
        igUserId:    igIdIcs,
        accessToken: metaToken,
      },
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('ai_settings').doc('meta_config').set(metaDoc, { merge: true });
  console.log('✓ meta_config criado/atualizado');
  console.log(`  └─ @primetourviagens igUserId: ${igIdPrimetour || '(vazio — preencha depois)'}`);
  console.log(`  └─ @icsbyprimetour   igUserId: ${igIdIcs       || '(vazio — preencha depois)'}`);

  /* ── linkedin_config ─────────────────────────────────────── */
  const liOrgId = process.env.LI_ORG_ID || '';

  const liDoc = {
    organizationId: liOrgId ? `urn:li:organization:${liOrgId}` : '',
    accessToken:    '', // preenchido via OAuth flow
    clientId:       '77t7i2nytso78n',
    updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('ai_settings').doc('linkedin_config').set(liDoc, { merge: true });
  console.log('✓ linkedin_config criado/atualizado');
  console.log(`  └─ organizationId: ${liDoc.organizationId || '(vazio — preencha LI_ORG_ID)'}`);
  console.log('  └─ accessToken: (vazio — será preenchido via OAuth)');

  /* ── brand_voice placeholders ────────────────────────────── */
  const BUS = [
    { id: 'pts',                name: 'PTS Bradesco'  },
    { id: 'centurion',          name: 'Centurion'     },
    { id: 'btg-partners',       name: 'BTG Partners'  },
    { id: 'btg-ultrablue',      name: 'BTG Ultrablue' },
    { id: 'primetour-lazer',    name: 'Lazer'         },
    { id: 'primetour-agencias', name: 'Operadora'     },
    { id: 'ics',                name: 'ICs'           },
  ];

  for (const bu of BUS) {
    const ref  = db.collection('ai_settings').doc(`brand_voice_${bu.id}`);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({
        buId:      bu.id,
        buName:    bu.name,
        content:   '',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedBy: 'system',
      });
      console.log(`✓ brand_voice_${bu.id} criado (vazio)`);
    } else {
      console.log(`— brand_voice_${bu.id} já existe, mantido`);
    }
  }

  console.log('\n✅ Seed concluído.');
  console.log('\nPróximos passos:');
  console.log('  1. Abra o Agente de IA no sistema e preencha o Tom de Voz de cada BU');
  console.log('  2. Verifique os igUserId no Meta Business Suite se ficaram vazios');
  console.log('  3. O accessToken do LinkedIn será preenchido após conectar via OAuth');
}

seed().catch(e => { console.error('❌ Erro:', e); process.exit(1); });
