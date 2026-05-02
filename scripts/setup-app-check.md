# App Check — Setup (admin manual ~10min)

App Check valida que requests vêm do app oficial PRIMETOUR (não de scripts/Postman/curl).
Mitiga: scraping, abuse de SDKs, denial-of-wallet.

## 1. Criar reCAPTCHA Enterprise key

1. Acesse [console.cloud.google.com/security/recaptcha](https://console.cloud.google.com/security/recaptcha)
2. + Create Key
3. Display name: `PRIMETOUR Web App`
4. Platform: Website
5. Domain list: `primetour.github.io` (e qualquer outro domínio prod)
6. Create
7. **Copia o Site Key** (formato `6L...`)

## 2. Registrar no Firebase

1. [console.firebase.google.com → App Check](https://console.firebase.google.com/project/gestor-de-tarefas-primetour/appcheck)
2. Web app → Register
3. Cole o Site Key copiado
4. TTL: 1 hour
5. Save

## 3. Habilitar enforcement (CUIDADO — pode quebrar)

Antes de ativar enforcement, **monitora** por 7 dias:
- Console → App Check → Apps → Your web app → "Monitor mode"

Após 7 dias, se métricas estão saudáveis (>95% requests com token):
- Toggle "Enforced" para cada serviço:
  - Cloud Firestore: enforced
  - Cloud Functions (callable): enforced
  - Cloud Storage (futuro): enforced

## 4. Habilitar no client

Edite `js/firebase.js`:

```js
async function setupAppCheck() {
  const ENABLED = true;                                          // ← era false
  const SITE_KEY = '6Lc-COLE-O-SEU-SITE-KEY-AQUI';              // ← cole aqui
  ...
}
```

Bump cache + deploy.

## 5. Debug Token (dev only)

Pra rodar no localhost sem reCAPTCHA real:
```js
self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;  // ANTES de initializeApp
```
Console mostra um token UUID — copia + adiciona em Firebase Console → App Check → Manage Debug Tokens.

## Custos

reCAPTCHA Enterprise: 1 milhão de avaliações/mês GRÁTIS. Acima: $1/1000.
Cenário 100 users × 50 requests/dia × 30 = 150k/mês = grátis.

## Como verificar funcionando

```js
// no DevTools depois de habilitar:
const { getToken } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js');
const t = await getToken(appCheckInstance);
console.log(t);  // deve retornar token JWT
```

## Compliance

App Check satisfaz:
- **OWASP API Security Top 10** — API1:2023 (Broken Object Level Authorization mitigation)
- **SOC 2** — CC6.1 Logical Access Security
- **ISO 27001** — A.13.1.1 Network controls
