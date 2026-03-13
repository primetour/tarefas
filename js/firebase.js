/**
 * PRIMETOUR — Firebase Module
 * Inicialização do Firebase App, Auth e Firestore
 */

import { initializeApp }       from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth }             from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore }        from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig }      from './config.js';

// ─── Instância principal ───────────────────────────────────
const app = initializeApp(firebaseConfig, 'primetour-main');

// ─── Instância secundária para criação de usuários ────────
// Permite que o admin crie novos usuários sem fazer logout
const secondaryApp = initializeApp(firebaseConfig, 'primetour-secondary');

// ─── Serviços exportados ───────────────────────────────────
export const auth          = getAuth(app);
export const secondaryAuth = getAuth(secondaryApp);
export const db            = getFirestore(app);

export default app;
