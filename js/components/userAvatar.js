/**
 * PRIMETOUR — User Avatar Helper (4.34+)
 *
 * Avatares dos usuários: foto (de SSO Microsoft Graph) com fallback automático
 * pra bolinha colorida com iniciais. Substitui o padrão antigo que era SEMPRE
 * sigla. Capture da foto acontece no `auth.js signInWithMicrosoft()` →
 * salva como base64 dataURL em `users/{uid}.photoURL`.
 *
 * Uso típico:
 *
 *   import { userAvatarHTML, getInitials } from '../components/userAvatar.js';
 *
 *   <div class="${classNames}">${userAvatarHTML(user, { size: 'sm' })}</div>
 *
 *   // Ou direto com html string substituindo o que existia:
 *   `<div class="avatar avatar-sm" style="background:${u.avatarColor};">
 *      ${userAvatarHTML(u, { size: 'sm', includeWrapper: false })}
 *    </div>`
 *
 * Comportamento:
 *   - Se `user.photoURL` está definido → renderiza <img>. Se a img falhar
 *     (data corrompida, etc), `onerror` cai no fallback de iniciais via JS.
 *   - Sem photoURL → bolinha colorida com 2 iniciais.
 *
 * O wrapper `<div class="avatar">` tem `position:relative` e `<img>` tem
 * `position:absolute; inset:0; object-fit:cover` (definido em assets/style.css
 * ou inline) — assim a foto cobre completamente, incluindo o background color
 * que serve só como fallback enquanto a foto carrega.
 */

const SIZE_CLASSES = {
  xs: { width: '20px', height: '20px', fontSize: '0.5rem' },
  sm: { width: '32px', height: '32px', fontSize: '0.75rem' },
  md: { width: '40px', height: '40px', fontSize: '0.875rem' },
  lg: { width: '56px', height: '56px', fontSize: '1.125rem' },
};

/** Pega 2 iniciais do nome (compatível com getInitials antigo). */
export function getInitials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() || '')
    .join('') || '?';
}

const escAttr = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));

/**
 * Retorna HTML do CONTEÚDO interno do avatar — assume que o wrapper
 * `<div class="avatar avatar-{size}" style="background:..">` já existe
 * por fora. Isso minimiza mudança nos call sites: trocam só o conteúdo
 * interno (initials → este helper) sem mexer no estilo do wrapper.
 *
 * @param {Object} user — { id?, name?, photoURL?, avatarColor? }
 * @param {Object} opts — { withTitle?: boolean }  // adiciona title="Nome" no img
 */
export function userAvatarInner(user, opts = {}) {
  if (!user) return '?';
  const initials = getInitials(user.name);
  const photo = user.photoURL;
  if (photo) {
    const title = opts.withTitle ? `title="${escAttr(user.name || '')}" ` : '';
    // onerror remove o img e o initials abaixo aparece (fallback hard)
    return `<img src="${escAttr(photo)}" alt="${escAttr(initials)}" ${title}
      onerror="this.style.display='none';"
      style="position:absolute;inset:0;width:100%;height:100%;
      object-fit:cover;border-radius:50%;display:block;" />${initials}`;
  }
  return initials;
}

/**
 * Helper completo que retorna o `<div class="avatar avatar-{size}">` inteiro
 * com styling + conteúdo. Use em sites NOVOS; em call sites existentes
 * prefira `userAvatarInner` pra manter classes/estilos consistentes.
 *
 * @param {Object} user — { name, photoURL, avatarColor }
 * @param {Object} opts — { size, extraStyle, withTitle }
 */
export function userAvatarHTML(user, opts = {}) {
  const size = opts.size || 'sm';
  const dim = SIZE_CLASSES[size] || SIZE_CLASSES.sm;
  const bg = user?.avatarColor || '#6B7280';
  const extra = opts.extraStyle || '';
  const tooltip = opts.withTitle && user?.name ? `title="${escAttr(user.name)}"` : '';
  return `
    <div class="avatar avatar-${size}" ${tooltip}
      style="background:${bg};width:${dim.width};height:${dim.height};
      font-size:${dim.fontSize};position:relative;${extra}">
      ${userAvatarInner(user, opts)}
    </div>
  `;
}
