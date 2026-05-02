import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = getFirestore();

const cfg = await db.doc('system_config/ai-config').get();
if (!cfg.exists) { console.log('NO_CONFIG'); process.exit(0); }
const data = cfg.data();
const present = [];
['anthropic','openai','gemini','groq','azure'].forEach(p => {
  const k = data[p+'ApiKey'];
  if (k) present.push({ provider: p, length: k.length, preview: k.slice(0,6)+'...'+k.slice(-4) });
});
const sp = await db.doc('system_config/sharepoint-app').get();
if (sp.exists) present.push({ provider: 'sharepoint', has: 'tenant+client+secret' });
const gh = await db.doc('system_config/github').get();
if (gh.exists) present.push({ provider: 'github', has: gh.data().token ? 'PAT' : 'none' });
console.log(JSON.stringify(present, null, 2));
process.exit(0);
