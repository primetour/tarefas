/**
 * PRIMETOUR — Meta Instagram Publishing Service
 * Publica posts, Reels, Carrosseis e Stories via Content Publishing API
 * Token e IGs ficam no Firestore (ai_settings/meta_config) — nunca no código
 */

import { db }   from '../firebase.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const GRAPH = 'https://graph.facebook.com/v19.0';

async function getMetaConfig() {
  const snap = await getDoc(doc(db, 'ai_settings', 'meta_config'));
  if (!snap.exists()) throw new Error('Configuração Meta não encontrada em ai_settings/meta_config.');
  return snap.data();
}

/**
 * Publica um post (imagem, carrossel ou reel) no Instagram
 * @param {object} opts
 * @param {string} opts.caption    — legenda completa com hashtags
 * @param {string} opts.mediaUrl   — URL pública da mídia (imagem ou vídeo)
 * @param {string} opts.account    — 'primetourviagens' | 'icsbyprimetour'
 * @param {string} opts.mediaType  — 'IMAGE' | 'REELS' (default: IMAGE)
 * @param {string[]} opts.carouselUrls — para carrossel, array de URLs
 */
export async function publishInstagramPost({ caption, mediaUrl, account, mediaType = 'IMAGE', carouselUrls = [] }) {
  const cfg     = await getMetaConfig();
  const igId    = cfg.accounts?.[account]?.igUserId;
  const token   = cfg.accounts?.[account]?.accessToken || cfg.defaultToken;

  if (!igId || !token) {
    throw new Error(`IDs/token do Instagram não configurados para @${account}.`);
  }

  // Carrossel
  if (carouselUrls.length > 1) {
    const childIds = await Promise.all(carouselUrls.map(async url => {
      const r = await graphPost(`/${igId}/media`, { image_url: url, is_carousel_item: true, access_token: token });
      return r.id;
    }));
    const containerR = await graphPost(`/${igId}/media`, {
      media_type: 'CAROUSEL', children: childIds.join(','), caption, access_token: token,
    });
    return publishContainer(igId, containerR.id, token);
  }

  // Reel
  if (mediaType === 'REELS') {
    const containerR = await graphPost(`/${igId}/media`, {
      media_type: 'REELS', video_url: mediaUrl, caption, access_token: token,
    });
    return publishContainer(igId, containerR.id, token);
  }

  // Imagem simples
  const containerR = await graphPost(`/${igId}/media`, {
    image_url: mediaUrl, caption, access_token: token,
  });
  return publishContainer(igId, containerR.id, token);
}

async function publishContainer(igId, containerId, token) {
  // Instagram requer aguardar processamento (~2s para imagem, mais para vídeo)
  await sleep(3000);
  return graphPost(`/${igId}/media_publish`, {
    creation_id: containerId, access_token: token,
  });
}

/**
 * Publica um Story no Instagram
 */
export async function publishInstagramStory({ mediaUrl, account, mediaType = 'IMAGE' }) {
  const cfg   = await getMetaConfig();
  const igId  = cfg.accounts?.[account]?.igUserId;
  const token = cfg.accounts?.[account]?.accessToken || cfg.defaultToken;
  if (!igId || !token) throw new Error(`Config não encontrada para @${account}.`);

  const containerR = await graphPost(`/${igId}/media`, {
    [mediaType === 'VIDEO' ? 'video_url' : 'image_url']: mediaUrl,
    media_type: mediaType === 'VIDEO' ? 'STORIES' : 'STORIES_IMAGE',
    access_token: token,
  });
  return publishContainer(igId, containerR.id, token);
}

async function graphPost(path, body) {
  const res = await fetch(`${GRAPH}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Meta API: ${data.error.message}`);
  return data;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
