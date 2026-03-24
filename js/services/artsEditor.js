/**
 * PRIMETOUR — Arts Editor Service
 * Template management and generation history
 */

import { db } from '../firebase.js';
import { store } from '../store.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const uid = () => store.get('currentUser')?.uid;

/* ─── Canvas sizes ─────────────────────────────────────────── */
export const ART_SIZES = [
  { key: 'feed_square',    label: 'Feed Instagram (1:1)',  w: 1080, h: 1080, category: 'Instagram' },
  { key: 'feed_portrait',  label: 'Feed Instagram (4:5)',  w: 1080, h: 1350, category: 'Instagram' },
  { key: 'stories',        label: 'Stories (9:16)',        w: 1080, h: 1920, category: 'Instagram' },
  { key: 'linkedin',       label: 'LinkedIn (1.91:1)',     w: 1200, h:  628, category: 'LinkedIn'  },
  { key: 'whatsapp',       label: 'WhatsApp (1:1)',        w: 1000, h: 1000, category: 'WhatsApp' },
  { key: 'whatsapp_long',  label: 'WhatsApp Comunicado',  w: 1200, h:  675, category: 'WhatsApp' },
  { key: 'email_banner',   label: 'Email Banner',          w: 1200, h:  400, category: 'Email'    },
  { key: 'a4_portrait',    label: 'Cartaz A4',             w: 2480, h: 3508, category: 'Impressão'},
  { key: 'wallpaper',      label: 'Fundo de Tela',         w: 1920, h: 1080, category: 'Outros'   },
];

/* ─── Layer types ──────────────────────────────────────────── */
export const LAYER_TYPES = {
  background_image: { label: 'Imagem de fundo',  icon: '🖼', editable: ['image_url','opacity','fit'] },
  image:            { label: 'Imagem',            icon: '📷', editable: ['image_url','x','y','w','h','opacity','border_radius'] },
  text:             { label: 'Texto',             icon: 'T',  editable: ['content','x','y','w','font_family','font_size','font_weight','color','align','line_height','letter_spacing','max_chars'] },
  rectangle:        { label: 'Retângulo',         icon: '▬', editable: ['x','y','w','h','fill','opacity','border_radius'] },
  logo:             { label: 'Logo da BU',        icon: '◈', editable: ['bu_id','x','y','h','opacity'] },
  overlay:          { label: 'Overlay de cor',    icon: '🎨', editable: ['fill','opacity'] },
};

/* ─── Templates CRUD ───────────────────────────────────────── */
export async function fetchTemplates() {
  const snap = await getDocs(query(collection(db, 'arts_templates'), orderBy('createdAt','desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchTemplate(id) {
  const snap = await getDoc(doc(db, 'arts_templates', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveTemplate(id, data) {
  const ref = id ? doc(db, 'arts_templates', id) : doc(collection(db, 'arts_templates'));
  await setDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
    ...(id ? {} : { createdAt: serverTimestamp(), createdBy: uid() }),
  }, { merge: true });
  return ref.id;
}

export async function deleteTemplate(id) {
  await deleteDoc(doc(db, 'arts_templates', id));
}

/* ─── Generations ──────────────────────────────────────────── */
export async function recordArtGeneration(data) {
  const ref = doc(collection(db, 'arts_generations'));
  await setDoc(ref, { ...data, generatedBy: uid(), generatedAt: serverTimestamp() });
  return ref.id;
}
