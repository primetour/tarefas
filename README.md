# Gestor PRIMETOUR

Plataforma interna de gestão de tarefas, projetos e produtividade da PRIMETOUR.

> Vanilla JS + Firebase. Zero build step. Deploy via GitHub Pages.

## Quick start (setup em ~15 min)

### Pré-requisitos
- **Node 20+** (só pra Cloud Functions e tests; o front roda direto no browser)
- **Firebase CLI** 13+: `npm install -g firebase-tools`
- **Git** + acesso ao repo `primetour/tarefas`

### 1. Clonar e configurar
```bash
git clone https://github.com/primetour/tarefas.git
cd tarefas
firebase login
firebase use gestor-de-tarefas-primetour
```

### 2. Rodar o front local
O front é vanilla JS sem build — qualquer servidor estático serve. Recomendado:
```bash
npx http-server . -p 8765 -c-1
# ou
python3 -m http.server 8765
```
Abrir http://localhost:8765 e fazer login (SSO Microsoft).

> **Importante:** App Check com reCAPTCHA pode bloquear localhost. Ver `scripts/setup-app-check.md` pra adicionar debug token.

### 3. Cloud Functions (opcional pra testes locais)
```bash
cd functions
npm install
firebase emulators:start --only functions,firestore
```

### 4. Rodar tests de Firestore Rules
```bash
cd tests
npm install
firebase emulators:exec --only firestore "node firestore-rules.test.mjs"
```

## Estrutura do projeto

```
.
├── index.html              # Entry point (carrega js/app.js)
├── *.html                  # Páginas públicas (login, csat-response, portal-view, ...)
├── js/
│   ├── app.js              # Boot: auth observer + router
│   ├── router.js           # Router client-side
│   ├── store.js            # State management (pub/sub + RBAC)
│   ├── firebase.js         # Init Firebase + cache persistente
│   ├── config.js           # Config Firebase (NÃO secrets — só projectId, etc)
│   │
│   ├── auth/               # Autenticação + audit log
│   │   ├── auth.js         # initAuthObserver, signIn, SSO, auto-provisioning
│   │   └── audit.js        # auditLog(action, entity, entityId, details)
│   │
│   ├── services/           # I/O Firestore + regras de negócio
│   │   ├── tasks.js        # CRUD de tarefas
│   │   ├── workspaces.js   # CRUD squads + members
│   │   ├── users.js        # fetchUsers + cache TTL
│   │   ├── userResolver.js # resolve uid/email → nome (cache + fallback)
│   │   └── ...
│   │
│   ├── components/         # UI reutilizável (sem I/O direto)
│   │   ├── header.js       # Top bar (search + notifs + online users)
│   │   ├── sidebar.js      # Nav lateral
│   │   ├── taskModal.js    # Modal de tarefa
│   │   ├── pageSize.js     # Paginador 10/20/50/100
│   │   └── ...
│   │
│   ├── pages/              # Orquestração: monta UI + chama services
│   │   ├── tasks.js
│   │   ├── audit.js
│   │   ├── users.js
│   │   └── ...
│   │
│   └── util/               # Helpers puros (sem I/O nem state)
│       ├── escape.js       # escHtml, escAttr, safeUrl (XSS protection)
│       └── logger.js       # logger.debug/info/warn/error
│
├── functions/              # Cloud Functions (Node 20)
│   ├── index.js            # ~30 functions: callLLM, sendCsatEmail, ...
│   ├── package.json
│   └── DEPLOY.md           # Setup secrets + deploy
│
├── css/                    # Estilos globais (vanilla CSS)
├── docs/                   # Documentação técnica
│   ├── ARCHITECTURE.md     # Visão arquitetural
│   ├── CONTRIBUTING.md     # Convenções + workflow
│   └── PERFORMANCE.md      # Otimizações + free tier
│
├── tests/                  # Testes manuais (Firestore rules)
├── firestore.rules         # Security rules (auditadas pentest 2026-05-03)
├── firestore.indexes.json  # Composite indexes
├── database.rules.json     # RTDB rules (presence — opt-in)
└── firebase.json           # Config global Firebase
```

## Documentos essenciais

Pra novo dev:
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — visão técnica do sistema
- [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md) — convenções + workflow
- [`docs/PERFORMANCE.md`](./docs/PERFORMANCE.md) — otimizações + custos Firestore

Pra contexto de negócio:
- [`FACT_SHEET.md`](./FACT_SHEET.md) — visão geral comercial + 68 módulos
- [`DATA-MODEL.md`](./DATA-MODEL.md) — schema Firestore (42+ collections)
- [`ACCESS-CONTROL.md`](./ACCESS-CONTROL.md) — 6 roles + 50+ permissions
- [`SECURITY.md`](./SECURITY.md) — threat model + zero-trust
- [`INFRA.md`](./INFRA.md) — produção, Cloudflare/Firestore

## Deploy

**Front (GitHub Pages):**
```bash
git push origin main
# GH Pages reflete em ~60s
```
Bump cache em `index.html` (script tag `?v=...`) pra forçar reload em mudanças críticas.

**Cloud Functions:**
```bash
firebase deploy --only functions
# ou só uma:
firebase deploy --only functions:sendCsatEmail
```

**Firestore Rules:**
```bash
firebase deploy --only firestore:rules
```

**RTDB Rules:**
```bash
firebase deploy --only database
```

## Comandos úteis

```bash
# Testar Firestore rules localmente
firebase emulators:exec --only firestore "node tests/firestore-rules.test.mjs"

# Ver logs de Cloud Function
firebase functions:log --only sendCsatEmail

# Configurar secret (Cloud Function)
firebase functions:secrets:set EMAILJS_SERVICE_ID
firebase functions:secrets:set EMAILJS_TEMPLATE_ID
firebase functions:secrets:set EMAILJS_PUBLIC_KEY

# Listar secrets configurados
firebase functions:secrets:access EMAILJS_SERVICE_ID

# Trocar projeto Firebase ativo
firebase use gestor-de-tarefas-primetour
```

## Stack técnico

| Camada | Tech |
|---|---|
| Front | Vanilla JS (ES modules nativos), CSS |
| Hosting | GitHub Pages |
| Auth | Firebase Auth + Microsoft SSO (Azure AD) |
| Database | Firestore + Realtime Database (presence) |
| Server | Cloud Functions (Node 20) |
| Storage | Cloudflare R2 (imagens) |
| Email | EmailJS (via Cloud Function proxy) |
| LLMs | Anthropic Claude, OpenAI GPT, Google Gemini, Groq |

## Suporte

- Bugs em produção: ver `INCIDENT-RESPONSE.md`
- Arquitetura: `docs/ARCHITECTURE.md`
- Performance/custos: `docs/PERFORMANCE.md`

---

**Plano hoje:** Spark (Free tier) | **Plano em scaling:** Blaze (~$5–60/mês)
**Último audit pentest:** 2026-05-03 (vide SECURITY.md)
