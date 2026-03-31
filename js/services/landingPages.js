/**
 * PRIMETOUR — Landing Pages Service
 * CRUD, publishing, slug and token management for landing pages
 */

import { db } from '../firebase.js';
import { auditLog } from '../auth/audit.js';
import { store } from '../store.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, where, serverTimestamp, increment,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const uid = () => store.get('currentUser')?.uid;

/* ─── Layouts ─────────────────────────────────────────────── */
export const LP_LAYOUTS = [
  {
    key:   'default',
    label: 'Padrão',
    desc:  'Layout versátil com hero + seções configuráveis. Ideal para campanhas gerais.',
    sections: ['hero','text','gallery','cta'],
  },
  {
    key:   'destination',
    label: 'Destino Único',
    desc:  'Focado em um destino. Hero fullscreen + highlights + clima + galeria imersiva.',
    sections: ['hero_full','destination_info','highlights','gallery_masonry','cta'],
  },
  {
    key:   'multi_destination',
    label: 'Multi-Destino',
    desc:  'Grade de destinos com cards. Ideal para roteiros e pacotes combinados.',
    sections: ['hero','destinations_grid','text','gallery','cta'],
  },
  {
    key:   'campaign',
    label: 'Campanha Temática',
    desc:  'Ênfase em oferta / data especial. Countdown, benefícios, urgência.',
    sections: ['hero_campaign','countdown','benefits','gallery','cta_strong'],
  },
  {
    key:   'experience',
    label: 'Experiência / Cruzeiro',
    desc:  'Layout narrativo com scroll horizontal. Conta a história da viagem em etapas.',
    sections: ['hero_full','journey_steps','gallery_horizontal','testimonials','cta'],
  },
];

/* ─── Section types ────────────────────────────────────────── */
export const LP_SECTION_TYPES = {
  hero:              { label: 'Hero padrão',        fields: ['title','subtitle','bg_image','cta_text','cta_link'] },
  hero_full:         { label: 'Hero fullscreen',    fields: ['title','subtitle','bg_image','overlay_opacity','cta_text','cta_link'] },
  hero_campaign:     { label: 'Hero campanha',      fields: ['headline','subheadline','badge_text','bg_image','cta_text','cta_link'] },
  text:              { label: 'Bloco de texto',     fields: ['title','body','align'] },
  gallery:           { label: 'Galeria grade',      fields: ['images','caption'] },
  gallery_masonry:   { label: 'Galeria mosaico',    fields: ['images'] },
  gallery_horizontal:{ label: 'Galeria horizontal', fields: ['images','captions'] },
  destination_info:  { label: 'Info do destino',    fields: ['tip_id','show_fields'] },
  destinations_grid: { label: 'Grade de destinos',  fields: ['destinations'] },
  highlights:        { label: 'Highlights',         fields: ['items'] },
  countdown:         { label: 'Countdown',          fields: ['target_date','label'] },
  benefits:          { label: 'Benefícios',         fields: ['items'] },
  journey_steps:     { label: 'Etapas da viagem',   fields: ['steps'] },
  testimonials:      { label: 'Depoimentos',        fields: ['items'] },
  cta:               { label: 'CTA simples',        fields: ['title','button_text','button_link','bg_color'] },
  cta_strong:        { label: 'CTA destaque',       fields: ['title','subtitle','button_text','button_link','urgency_text'] },
};

/* ─── Field labels (PT-BR) ─────────────────────────────────── */
export const FIELD_LABELS = {
  title:           'Título',
  subtitle:        'Subtítulo',
  headline:        'Título principal',
  subheadline:     'Subtítulo principal',
  badge_text:      'Texto do selo',
  body:            'Corpo do texto',
  bg_image:        'Imagem de fundo',
  cta_text:        'Texto do botão',
  cta_link:        'Link do botão',
  button_text:     'Texto do botão',
  button_link:     'Link do botão',
  label:           'Rótulo',
  urgency_text:    'Texto de urgência',
  align:           'Alinhamento',
  overlay_opacity: 'Opacidade da sobreposição',
  bg_color:        'Cor de fundo',
  caption:         'Legenda',
  images:          'Imagens',
  captions:        'Legendas',
  items:           'Itens',
  steps:           'Etapas',
  destinations:    'Destinos',
  tip_id:          'Dica vinculada',
  show_fields:     'Campos exibidos',
  target_date:     'Data-alvo',
};

/* ─── CRUD ─────────────────────────────────────────────────── */
export async function fetchLandingPages() {
  const snap = await getDocs(query(collection(db, 'landing_pages'), orderBy('createdAt','desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchLandingPage(id) {
  const snap = await getDoc(doc(db, 'landing_pages', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveLandingPage(id, data) {
  const ref = id ? doc(db, 'landing_pages', id) : doc(collection(db, 'landing_pages'));
  const isNew = !id;
  const token = isNew ? generateToken() : (data.token || generateToken());
  const slug  = data.slug || slugify(data.name || 'pagina');

  // Clean data: remove transient fields that shouldn't go to Firestore
  const { id: _removeId, ...cleanData } = data;

  await setDoc(ref, {
    ...cleanData,
    token,
    slug,
    updatedAt:  serverTimestamp(),
    updatedBy:  uid(),
    ...(isNew ? { createdAt: serverTimestamp(), createdBy: uid(), views: 0, status: 'draft' } : {}),
  }, { merge: true });

  await auditLog(isNew ? 'lp.create' : 'lp.update', 'landing_pages', ref.id, { name: data.name || '', slug });
  return { id: ref.id, token, slug };
}

export async function publishLandingPage(id) {
  await auditLog('lp.publish', 'landing_pages', id, {});
  await updateDoc(doc(db, 'landing_pages', id), {
    status: 'published',
    publishedAt: serverTimestamp(),
    publishedBy: uid(),
  });
}

export async function unpublishLandingPage(id) {
  await updateDoc(doc(db, 'landing_pages', id), { status: 'draft' });
}

export async function deleteLandingPage(id) {
  await deleteDoc(doc(db, 'landing_pages', id));
  await auditLog('lp.delete', 'landing_pages', id, {});
}

/* ─── View counter (efficient query by token) ──────────────── */
export async function incrementLpViews(token) {
  const snap = await getDocs(query(collection(db, 'landing_pages'), where('token','==',token)));
  if (!snap.empty) await updateDoc(snap.docs[0].ref, { views: increment(1) });
}

/* ─── Check slug uniqueness ────────────────────────────────── */
export async function isSlugAvailable(slug, excludeId) {
  const snap = await getDocs(query(collection(db, 'landing_pages'), where('slug','==',slug)));
  if (snap.empty) return true;
  return snap.docs.every(d => d.id === excludeId);
}

/* ─── Helpers ──────────────────────────────────────────────── */
function generateToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map(b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

export function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // remove accents
    .replace(/[^a-z0-9]+/g, '-')                       // non-alphanumeric → dash
    .replace(/^-+|-+$/g, '')                            // trim dashes
    .slice(0, 80)                                       // max length
    || 'pagina';
}
