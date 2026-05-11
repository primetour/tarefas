/**
 * Seed inicial das coleções content_platforms e content_contents
 * com os valores hardcoded antes da v4.35.13 (migração one-shot).
 * Idempotente: skip se collection já tem docs.
 */
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'gestor-de-tarefas-primetour' });
const db = admin.firestore();

const PLATFORMS = [
  { id: 'instagram',  label: 'Instagram',  icon: '📷', color: '#E1306C', order: 1 },
  { id: 'facebook',   label: 'Facebook',   icon: '◈',  color: '#1877F2', order: 2 },
  { id: 'linkedin',   label: 'LinkedIn',   icon: '▤',  color: '#0A66C2', order: 3 },
  { id: 'newsletter', label: 'Newsletter', icon: '✉',  color: '#D4A843', order: 4 },
  { id: 'blog',       label: 'Blog',       icon: '✎',  color: '#64748B', order: 5 },
  { id: 'tiktok',     label: 'TikTok',     icon: '▣',  color: '#94A3B8', order: 6 },
];

const CONTENTS = [
  { id: 'post',       label: 'Post',       icon: '📸', color: '#6366F1', order: 1 },
  { id: 'reel',       label: 'Reel',       icon: '🎬', color: '#EC4899', order: 2 },
  { id: 'carrossel',  label: 'Carrossel',  icon: '📑', color: '#8B5CF6', order: 3 },
  { id: 'story',      label: 'Story',      icon: '📱', color: '#F59E0B', order: 4 },
  { id: 'artigo',     label: 'Artigo',     icon: '📰', color: '#0EA5E9', order: 5 },
  { id: 'newsletter', label: 'Newsletter', icon: '✉',  color: '#D4A843', order: 6 },
];

const CATEGORIES = [
  { id: 'destinos',      label: 'Destinos',      icon: '🌍', color: '#0EA5E9', order: 1 },
  { id: 'dicas',         label: 'Dicas',         icon: '💡', color: '#F59E0B', order: 2 },
  { id: 'institucional', label: 'Institucional', icon: '🏛', color: '#6B7280', order: 3 },
  { id: 'lancamento',    label: 'Lançamento',    icon: '🚀', color: '#EC4899', order: 4 },
  { id: 'engajamento',   label: 'Engajamento',   icon: '❤',  color: '#EF4444', order: 5 },
  { id: 'educativo',     label: 'Educativo',     icon: '📚', color: '#8B5CF6', order: 6 },
];

async function seedCollection(name, items) {
  const col = db.collection(name);
  const existing = await col.get();
  if (existing.size > 0) {
    console.log(`  ↻ ${name}: já tem ${existing.size} docs, skip.`);
    return;
  }
  for (const it of items) {
    await col.doc(it.id).set({
      ...it,
      active: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`    + ${name}/${it.id} (${it.label})`);
  }
}

(async () => {
  console.log('🌱 Seeding content meta...');
  await seedCollection('content_platforms', PLATFORMS);
  await seedCollection('content_contents', CONTENTS);
  await seedCollection('content_categories', CATEGORIES);
  console.log('✓ Done.');
  process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
