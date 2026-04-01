/**
 * PRIMETOUR — Arts Editor Service v2
 * Templates, categorias, filtros de imagem e geração
 */

import { db } from '../firebase.js';
import { store } from '../store.js';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, where, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const uid = () => store.get('currentUser')?.uid;

/* ─── Canvas sizes ─────────────────────────────────────────── */
export const ART_SIZES = [
  { key: 'feed_square',    label: 'Feed Instagram (1:1)',    w: 1080, h: 1080, category: 'Instagram' },
  { key: 'feed_portrait',  label: 'Feed Instagram (4:5)',    w: 1080, h: 1350, category: 'Instagram' },
  { key: 'stories',        label: 'Stories (9:16)',           w: 1080, h: 1920, category: 'Instagram' },
  { key: 'linkedin',       label: 'LinkedIn (1.91:1)',        w: 1200, h:  628, category: 'LinkedIn'  },
  { key: 'whatsapp',       label: 'WhatsApp (1:1)',           w: 1000, h: 1000, category: 'WhatsApp'  },
  { key: 'whatsapp_long',  label: 'WhatsApp Comunicado',     w: 1200, h:  675, category: 'WhatsApp'  },
  { key: 'email_banner',   label: 'Email Banner',             w: 1200, h:  400, category: 'Email'     },
  { key: 'a4_portrait',    label: 'Cartaz A4',                w: 2480, h: 3508, category: 'Impressão' },
  { key: 'wallpaper',      label: 'Fundo de Tela',            w: 1920, h: 1080, category: 'Outros'    },
];

/* ─── Layer types ──────────────────────────────────────────── */
export const LAYER_TYPES = {
  background_image: { label: 'Imagem de fundo', icon: '🖼', editable: ['image_url','opacity','fit','filter'] },
  image:            { label: 'Imagem',           icon: '📷', editable: ['image_url','x','y','w','h','opacity','border_radius','filter'] },
  text:             { label: 'Texto',            icon: 'T',  editable: ['content','x','y','w','font_family','font_size','font_weight','color','align','line_height','letter_spacing','max_chars','shadow'] },
  rectangle:        { label: 'Retângulo',        icon: '▬', editable: ['x','y','w','h','fill','opacity','border_radius'] },
  logo:             { label: 'Logo da BU',       icon: '◈', editable: ['bu_id','x','y','h','opacity'] },
  overlay:          { label: 'Overlay de cor',   icon: '🎨', editable: ['fill','opacity'] },
};

/* ─── Setores / BUs ────────────────────────────────────────── */
export const SECTORS = [
  'PTS Bradesco', 'Centurion', 'BTG Partners', 'BTG Ultrablue',
  'Lazer', 'Operadora', 'ICs', 'Célula ICs', 'Concierge Bradesco',
  'Marketing', 'Eventos', 'CEP',
];

/* ─── Fontes disponíveis ───────────────────────────────────── */
export const AVAILABLE_FONTS = [
  'Poppins', 'Inter', 'Roboto', 'Montserrat', 'Lato', 'Open Sans',
  'Playfair Display', 'Merriweather', 'Source Sans Pro', 'Raleway',
  'Oswald', 'Nunito', 'Barlow', 'DM Sans', 'Work Sans',
  'Georgia', 'Times New Roman', 'Arial', 'Helvetica',
];

/* ─── Filtros de imagem (estilo Instagram) ─────────────────── */
export const IMAGE_FILTERS = [
  { key: 'none',       label: 'Original',    css: '' },
  { key: 'grayscale',  label: 'P&B',         css: 'grayscale(100%)' },
  { key: 'sepia',      label: 'Sépia',       css: 'sepia(80%)' },
  { key: 'warm',       label: 'Quente',      css: 'saturate(130%) hue-rotate(-10deg) brightness(105%)' },
  { key: 'cool',       label: 'Frio',        css: 'saturate(110%) hue-rotate(15deg) brightness(100%)' },
  { key: 'vintage',    label: 'Vintage',     css: 'sepia(30%) contrast(110%) brightness(95%)' },
  { key: 'dramatic',   label: 'Dramático',   css: 'contrast(140%) brightness(90%) saturate(120%)' },
  { key: 'bright',     label: 'Luminoso',    css: 'brightness(120%) contrast(105%)' },
  { key: 'moody',      label: 'Moody',       css: 'brightness(85%) contrast(120%) saturate(80%)' },
  { key: 'vivid',      label: 'Vívido',      css: 'saturate(160%) contrast(110%)' },
  { key: 'fade',       label: 'Desbotado',   css: 'contrast(80%) brightness(110%) saturate(70%)' },
  { key: 'clarendon',  label: 'Clarendon',   css: 'contrast(120%) saturate(125%)' },
  { key: 'gingham',    label: 'Gingham',     css: 'brightness(105%) hue-rotate(-10deg) saturate(80%)' },
  { key: 'blur_light', label: 'Suavizar',    css: 'blur(1px) brightness(105%)' },
];

/* ─── Fabric.js filter mapping ─────────────────────────────── */
export function getFabricFilters(filterKey) {
  if (!filterKey || filterKey === 'none' || !window.fabric) return [];
  const F = window.fabric.Image.filters;
  const map = {
    grayscale:  [new F.Grayscale()],
    sepia:      [new F.Sepia()],
    warm:       [new F.Saturation({ saturation: 0.3 }), new F.HueRotation({ rotation: -0.03 }), new F.Brightness({ brightness: 0.05 })],
    cool:       [new F.Saturation({ saturation: 0.1 }), new F.HueRotation({ rotation: 0.04 }), new F.Brightness({ brightness: 0 })],
    vintage:    [new F.Sepia(), new F.Contrast({ contrast: 0.1 }), new F.Brightness({ brightness: -0.05 })],
    dramatic:   [new F.Contrast({ contrast: 0.4 }), new F.Brightness({ brightness: -0.1 }), new F.Saturation({ saturation: 0.2 })],
    bright:     [new F.Brightness({ brightness: 0.2 }), new F.Contrast({ contrast: 0.05 })],
    moody:      [new F.Brightness({ brightness: -0.15 }), new F.Contrast({ contrast: 0.2 }), new F.Saturation({ saturation: -0.2 })],
    vivid:      [new F.Saturation({ saturation: 0.6 }), new F.Contrast({ contrast: 0.1 })],
    fade:       [new F.Contrast({ contrast: -0.2 }), new F.Brightness({ brightness: 0.1 }), new F.Saturation({ saturation: -0.3 })],
    clarendon:  [new F.Contrast({ contrast: 0.2 }), new F.Saturation({ saturation: 0.25 })],
    gingham:    [new F.Brightness({ brightness: 0.05 }), new F.HueRotation({ rotation: -0.03 }), new F.Saturation({ saturation: -0.2 })],
    blur_light: [new F.Blur({ blur: 0.1 }), new F.Brightness({ brightness: 0.05 })],
  };
  return map[filterKey] || [];
}

/* ─── Templates CRUD ───────────────────────────────────────── */
export async function fetchTemplates({ categoryId, sector } = {}) {
  const snap = await getDocs(query(collection(db, 'arts_templates'), orderBy('createdAt', 'desc')));
  let docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  if (categoryId) docs = docs.filter(d => d.categoryId === categoryId);
  if (sector) docs = docs.filter(d => !d.sectors?.length || d.sectors.includes(sector));
  return docs;
}

export async function fetchTemplate(id) {
  const snap = await getDoc(doc(db, 'arts_templates', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveTemplate(id, data) {
  const ref = id ? doc(db, 'arts_templates', id) : doc(collection(db, 'arts_templates'));
  const { id: _removeId, ...cleanData } = data;
  await setDoc(ref, {
    ...cleanData,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
    ...(id ? {} : { createdAt: serverTimestamp(), createdBy: uid() }),
  }, { merge: true });
  return ref.id;
}

export async function deleteTemplate(id) {
  await deleteDoc(doc(db, 'arts_templates', id));
}

/* ─── Categories CRUD ──────────────────────────────────────── */
export async function fetchArtCategories() {
  const snap = await getDocs(query(collection(db, 'arts_categories'), orderBy('order', 'asc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveArtCategory(id, data) {
  const ref = id ? doc(db, 'arts_categories', id) : doc(collection(db, 'arts_categories'));
  await setDoc(ref, {
    ...data,
    updatedAt: serverTimestamp(),
    updatedBy: uid(),
    ...(id ? {} : { createdAt: serverTimestamp(), createdBy: uid(), order: Date.now() }),
  }, { merge: true });
  return ref.id;
}

export async function deleteArtCategory(id) {
  await deleteDoc(doc(db, 'arts_categories', id));
}

/* ─── Generations ──────────────────────────────────────────── */
export async function recordArtGeneration(data) {
  const ref = doc(collection(db, 'arts_generations'));
  await setDoc(ref, { ...data, generatedBy: uid(), generatedAt: serverTimestamp() });
  return ref.id;
}

/* ─── Built-in starter templates ───────────────────────────── */
export const STARTER_TEMPLATES = [
  {
    name: 'Destaque de Destino — Feed',
    category: 'Instagram',
    size_key: 'feed_square',
    sectors: [],
    preview_url: '',
    layers: [
      { type: 'background_image', label: 'Foto do destino', editable: true, image_url: '', opacity: 1, fit: 'cover', filter: 'none' },
      { type: 'overlay', label: 'Overlay escuro', editable: true, fill: 'rgba(0,0,0,0.4)', opacity: 1 },
      { type: 'text', label: 'Destino', editable: true, content: 'NOME DO DESTINO', x: 60, y: 380, w: 960, font_family: 'Montserrat', font_size: 72, font_weight: '700', color: '#ffffff', align: 'left', line_height: 1.1, letter_spacing: 2 },
      { type: 'text', label: 'Subtítulo', editable: true, content: 'Descubra experiências exclusivas', x: 60, y: 480, w: 960, font_family: 'Poppins', font_size: 28, font_weight: '400', color: '#ffffffcc', align: 'left', line_height: 1.4 },
      { type: 'rectangle', label: 'Linha decorativa', editable: true, x: 60, y: 360, w: 80, h: 4, fill: '#D4A843', opacity: 1 },
      { type: 'text', label: 'CTA', editable: true, content: 'SAIBA MAIS', x: 60, y: 920, w: 960, font_family: 'Montserrat', font_size: 16, font_weight: '700', color: '#D4A843', align: 'left', letter_spacing: 4 },
    ],
  },
  {
    name: 'Destaque de Destino — Stories',
    category: 'Instagram',
    size_key: 'stories',
    sectors: [],
    preview_url: '',
    layers: [
      { type: 'background_image', label: 'Foto do destino', editable: true, image_url: '', opacity: 1, fit: 'cover', filter: 'none' },
      { type: 'overlay', label: 'Gradiente', editable: true, fill: 'rgba(0,0,0,0.45)', opacity: 1 },
      { type: 'text', label: 'Destino', editable: true, content: 'DESTINO', x: 60, y: 750, w: 960, font_family: 'Montserrat', font_size: 80, font_weight: '800', color: '#ffffff', align: 'left', line_height: 1.0, letter_spacing: 3 },
      { type: 'text', label: 'Descrição', editable: true, content: 'Uma experiência única para clientes exclusivos.', x: 60, y: 870, w: 900, font_family: 'Poppins', font_size: 26, font_weight: '400', color: '#ffffffbb', align: 'left', line_height: 1.5 },
      { type: 'rectangle', label: 'Barra dourada', editable: true, x: 60, y: 730, w: 60, h: 5, fill: '#D4A843', opacity: 1 },
    ],
  },
  {
    name: 'Comunicado Interno',
    category: 'WhatsApp',
    size_key: 'whatsapp_long',
    sectors: [],
    preview_url: '',
    layers: [
      { type: 'rectangle', label: 'Fundo', editable: false, x: 0, y: 0, w: 1200, h: 675, fill: '#1a1a2e', opacity: 1 },
      { type: 'rectangle', label: 'Barra topo', editable: true, x: 0, y: 0, w: 1200, h: 8, fill: '#D4A843', opacity: 1 },
      { type: 'text', label: 'Título', editable: true, content: 'COMUNICADO', x: 80, y: 60, w: 1040, font_family: 'Montserrat', font_size: 48, font_weight: '800', color: '#D4A843', align: 'left', letter_spacing: 6 },
      { type: 'text', label: 'Corpo', editable: true, content: 'Informamos que...', x: 80, y: 160, w: 1040, font_family: 'Poppins', font_size: 24, font_weight: '400', color: '#ffffffcc', align: 'left', line_height: 1.6 },
      { type: 'text', label: 'Rodapé', editable: true, content: 'Equipe Primetour', x: 80, y: 580, w: 1040, font_family: 'Poppins', font_size: 16, font_weight: '600', color: '#ffffff66', align: 'left' },
    ],
  },
  {
    name: 'Banner de Email',
    category: 'Email',
    size_key: 'email_banner',
    sectors: [],
    preview_url: '',
    layers: [
      { type: 'background_image', label: 'Foto de fundo', editable: true, image_url: '', opacity: 1, fit: 'cover', filter: 'none' },
      { type: 'overlay', label: 'Overlay', editable: true, fill: 'rgba(0,0,0,0.35)', opacity: 1 },
      { type: 'text', label: 'Título', editable: true, content: 'Sua próxima viagem começa aqui', x: 60, y: 120, w: 1080, font_family: 'Playfair Display', font_size: 52, font_weight: '700', color: '#ffffff', align: 'left', line_height: 1.2 },
      { type: 'text', label: 'CTA', editable: true, content: 'CONFIRA →', x: 60, y: 310, w: 400, font_family: 'Montserrat', font_size: 18, font_weight: '700', color: '#D4A843', align: 'left', letter_spacing: 3 },
    ],
  },
  {
    name: 'Post LinkedIn — Destino',
    category: 'LinkedIn',
    size_key: 'linkedin',
    sectors: [],
    preview_url: '',
    layers: [
      { type: 'background_image', label: 'Foto', editable: true, image_url: '', opacity: 1, fit: 'cover', filter: 'none' },
      { type: 'overlay', label: 'Overlay', editable: true, fill: 'rgba(0,0,0,0.3)', opacity: 1 },
      { type: 'text', label: 'Título', editable: true, content: 'Experiências exclusivas', x: 50, y: 200, w: 1100, font_family: 'Montserrat', font_size: 52, font_weight: '700', color: '#ffffff', align: 'left', line_height: 1.2 },
      { type: 'text', label: 'Subtítulo', editable: true, content: 'para clientes que merecem o melhor.', x: 50, y: 290, w: 900, font_family: 'Poppins', font_size: 24, font_weight: '400', color: '#ffffffbb', align: 'left' },
      { type: 'rectangle', label: 'Linha', editable: true, x: 50, y: 185, w: 60, h: 4, fill: '#D4A843', opacity: 1 },
    ],
  },
];

/* ─── Install starter templates if collection is empty ─────── */
export async function installStarterTemplates() {
  const existing = await fetchTemplates();
  if (existing.length > 0) return existing.length;
  let count = 0;
  for (const tmpl of STARTER_TEMPLATES) {
    await saveTemplate(null, tmpl);
    count++;
  }
  return count;
}

/* ─── Best practices guide content ─────────────────────────── */
export const BEST_PRACTICES = [
  { title: 'Imagens', items: [
    'Use fotos com resolução mínima de 1080px no menor lado',
    'Prefira imagens do Banco de Imagens para manter identidade visual',
    'Para fundo, use fotos horizontais em formatos paisagem e verticais em Stories',
    'Formatos aceitos: JPG, PNG e WebP — evite GIF para artes estáticas',
  ]},
  { title: 'Textos', items: [
    'Títulos: máximo 5-7 palavras, sempre em destaque',
    'Use no máximo 2 famílias tipográficas por arte',
    'Contraste mínimo: texto claro sobre fundo escuro (ou vice-versa)',
    'Evite textos muito pequenos — mínimo 16px para corpo, 24px para subtítulo',
  ]},
  { title: 'Cores e marca', items: [
    'Dourado Primetour (#D4A843) para destaques e CTAs',
    'Mantenha consistência com a paleta da BU (setor)',
    'Overlays entre 30-50% de opacidade para legibilidade sobre fotos',
    'Use a linha decorativa dourada para separar título do corpo',
  ]},
  { title: 'Exportação', items: [
    'PNG para artes com transparência ou textos nítidos',
    'JPG para fotos de fundo com arquivo menor',
    'A exportação gera imagens em 3x para máxima qualidade',
    'Confira o preview antes de exportar — zoom no canvas para verificar detalhes',
  ]},
  { title: 'Filtros de imagem', items: [
    'Use filtros com moderação — preferência para "Original" ou ajustes sutis',
    '"Quente" e "Vívido" funcionam bem para destinos tropicais',
    '"Moody" e "Dramático" para destinos urbanos noturnos',
    '"Clarendon" é versátil e funciona para a maioria das fotos',
  ]},
];
