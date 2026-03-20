/**
 * PRIMETOUR — LinkedIn Publishing Service
 * Publica posts na company page via UGC Posts API
 * Client ID/Secret ficam no Cloudflare Worker — token OAuth salvo no Firestore
 */

import { db }   from '../firebase.js';
import {
  doc, getDoc, setDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const LI_API   = 'https://api.linkedin.com/v2';
const LI_MEDIA = 'https://api.linkedin.com/v2/assets?action=registerUpload';

async function getLinkedinConfig() {
  const snap = await getDoc(doc(db, 'ai_settings', 'linkedin_config'));
  if (!snap.exists()) throw new Error('Configuração LinkedIn não encontrada em ai_settings/linkedin_config.');
  const cfg = snap.data();
  if (!cfg.accessToken) throw new Error('Access token LinkedIn não configurado. Complete o OAuth.');
  return cfg;
}

/**
 * Publica um post de texto (com ou sem imagem) na company page
 * @param {object} opts
 * @param {string} opts.text      — corpo do post
 * @param {string=} opts.imageUrl — URL pública da imagem (opcional)
 * @param {string=} opts.title    — título para preview de link (opcional)
 * @param {string=} opts.linkUrl  — URL do link (opcional)
 */
export async function publishLinkedinPost({ text, imageUrl, title, linkUrl }) {
  const cfg       = await getLinkedinConfig();
  const token     = cfg.accessToken;
  const orgId     = cfg.organizationId; // URN: urn:li:organization:XXXXXXX

  if (!orgId) throw new Error('organizationId não configurado em linkedin_config.');

  const body = {
    author:    orgId,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary:    { text },
        shareMediaCategory: imageUrl ? 'IMAGE' : linkUrl ? 'ARTICLE' : 'NONE',
        ...(imageUrl || linkUrl ? {
          media: [{
            status: 'READY',
            ...(imageUrl ? { media: await uploadLinkedinImage(imageUrl, token), title: { text: title || '' } } : {}),
            ...(linkUrl  ? { originalUrl: linkUrl, title: { text: title || '' } } : {}),
          }],
        } : {}),
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };

  const res = await fetch(`${LI_API}/ugcPosts`, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`LinkedIn API: ${data.message || res.status}`);
  return data;
}

async function uploadLinkedinImage(imageUrl, token) {
  // 1 — Register upload
  const regRes = await fetch(LI_MEDIA, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner:   'urn:li:organization:placeholder', // overridden by orgId at post time
        serviceRelationships: [{
          relationshipType: 'OWNER',
          identifier:       'urn:li:userGeneratedContent',
        }],
      },
    }),
  });
  const regData = await regRes.json();
  if (!regRes.ok) throw new Error('LinkedIn: falha ao registrar upload de imagem.');

  const uploadUrl = regData.value?.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;
  const asset     = regData.value?.asset;

  if (!uploadUrl || !asset) throw new Error('LinkedIn: URL de upload não retornada.');

  // 2 — Fetch image and upload
  const imgRes   = await fetch(imageUrl);
  const imgBlob  = await imgRes.blob();
  await fetch(uploadUrl, { method: 'PUT', body: imgBlob, headers: { 'Content-Type': imgBlob.type } });

  return asset;
}
