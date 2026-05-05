# Arquitetura — Gestor PRIMETOUR

> Documento técnico para devs. Cobre decisões, fluxos e padrões.

## TL;DR

- **Vanilla JS + ES modules nativos**, sem build step (sem webpack/vite/etc)
- **Firebase** como backend (Auth + Firestore + Functions + Realtime DB)
- **GitHub Pages** como host estático (zero infra própria)
- **Pub/sub store** central (`store.js`) pra estado + RBAC
- **CSP estrita** + Firestore rules auditadas
- **Cloud Functions** pra qualquer operação que toque secret (LLM, EmailJS, etc)

## Decisões arquiteturais

### Por que Vanilla JS sem build?

- **Reload instantâneo**: editar um JS e dar F5 — sem watch, sem delay
- **Zero dependência de toolchain**: sem `node_modules` no front, sem versões de webpack pra manter
- **GitHub Pages serve direto**: deploy = git push
- **Trade-off aceito**: sem TypeScript, sem JSX, sem code-splitting automático

Ganho de produtividade > custo de não ter tipos. O codebase mostra que dá pra escalar (~100k linhas de JS organizadas).

### Por que Firebase?

- **Offline-first**: Firestore tem cache IndexedDB persistente embutido
- **Real-time nativo**: `onSnapshot` substitui WebSocket custom
- **Auth Microsoft SSO sem servidor**: 1 linha de código vs OAuth implementado
- **Free tier generoso pra POC** (Spark plan), Blaze a partir de scaling
- **Trade-off**: vendor lock-in (custos de saída altos se um dia migrar)

### Por que `store.js` em vez de Redux/Zustand?

Os ~100 estados que a UI precisa caber em ~10 keys (currentUser, tasks, projects, ...). Pub/sub manual é 50 linhas de código vs 200KB de Redux.

```js
// store.js (resumido)
const _state = {};
const _listeners = new Map();
function set(key, value) {
  _state[key] = value;
  (_listeners.get(key) || []).forEach(cb => cb(value));
}
function subscribe(key, cb) {
  if (!_listeners.has(key)) _listeners.set(key, new Set());
  _listeners.get(key).add(cb);
  return () => _listeners.get(key).delete(cb); // unsub
}
```

### Por que GitHub Actions para syncs em vez de Cloud Functions?

A divisão atual é **deliberada**, não acidental: Cloud Functions hospeda tudo que é **runtime/interativo** (proxy LLM, signed URL R2, SSO, CSAT email, audit pruning, daily backup); GitHub Actions hospeda os **syncs batch externos** (GA4, Marketing Cloud, Meta Instagram, archive de tarefas).

**Trade-offs comparados:**

| Critério | Cloud Functions | GitHub Actions |
|---|---|---|
| Custo p/ workload baixo | $ por invocation + duração + memória | Grátis (free tier 2000 min/mês — sobra muito) |
| Timeout | 9 min (default), 60 min (Gen 2 paid) | 6 horas |
| Cold start | ~1–3s (Node 20) | ~30s init runner |
| Logs | GCP Cloud Logging (interno) | GitHub Actions UI (auditável publicamente) |
| Observabilidade falha | Sentry/Cloud Monitoring | Notification email + Actions tab |
| Trigger real-time | Sim (HTTP, callable, Firestore events) | Não (só cron + manual dispatch) |
| Debug | Difícil sem replay local | Fácil — re-run job, ver step-by-step |
| Memória disponível | 256MB–4GB (Gen 2) | 7GB padrão grátis |

**Critérios de decisão para novos workflows:**

| Cenário | Fica em |
|---|---|
| Precisa responder a evento real-time (Firestore write, HTTP request) | **Function** |
| Precisa de secret runtime (API key LLM, etc) | **Function** (Secret Manager) |
| Cron diário/mensal puxando API externa pesada (GB de dados) | **Action** |
| One-shot administrativo (cleanup, seed inicial) | **Action** (manual dispatch) |
| Job que pode demorar >9 min | **Action** |
| Logs precisam ser auditáveis publicamente | **Action** |
| Volume de invocations alto (>100k/mês) | **Function** (custo por invocation < custo por minuto Action) |

**Quando reconsiderar:**

1. **Free tier de Actions for esgotado** (improvável — usamos ~10 min/mês dos 2000 grátis).
2. **Sync precisa virar real-time** (ex: alguém pediu pra Marketing Cloud sincronizar a cada hora em vez de 1×/dia → vira Function `onSchedule` ou trigger).
3. **Function existente passa a ter timeout problemático** → pode mover pra Action se for batch puro.
4. **Auditoria externa exige logs públicos** de algo que hoje está em Function → pode mover pra Action.

A escolha NÃO é unificar por princípio (Functions ou Actions tudo). É usar a ferramenta certa pro tipo de carga. **Hybrid > monolítico** quando os trade-offs são diferentes.

## Camadas da aplicação

```
┌─────────────────────────────────────────┐
│            HTML pages                    │  index.html, login.html, ...
└──────────────┬──────────────────────────┘
               │ <script type="module" src="js/app.js">
┌──────────────▼──────────────────────────┐
│              app.js                      │  boot + auth observer + router
└──────────────┬──────────────────────────┘
               │
       ┌───────┼───────┬─────────┐
       ▼       ▼       ▼         ▼
   ┌──────┐┌──────┐┌──────┐ ┌─────────┐
   │ auth ││pages ││store │ │Firebase │
   └──┬───┘└──┬───┘└──────┘ │ SDKs    │
      │      │              └─────────┘
      ▼      ▼
   ┌────────────┐
   │ services   │  CRUD Firestore + business logic
   └─────┬──────┘
         ▼
   ┌────────────┐
   │components  │  UI reutilizável (taskModal, header, sidebar)
   └────────────┘
```

### Responsabilidades por camada

| Camada | Pode | Não pode |
|---|---|---|
| `pages/` | Orquestrar (services + components), montar UI da rota | I/O direto pro Firestore (chama services) |
| `components/` | Renderizar UI, expor handlers | Fazer fetch/CRUD direto |
| `services/` | I/O Firestore, regras de negócio, cache | Manipular DOM |
| `auth/` | Login, sessão, audit logs | Lógica de domínio (tasks, etc) |
| `util/` | Helpers puros (escape, logger, formatters) | Importar de `services/`, `pages/`, `store` |
| `store.js` | State global | Lógica de domínio (mantém só keys/valores) |

## Fluxo de auth + boot

```
1. Browser carrega index.html
2. <script src="js/app.js?v=..."> roda
3. app.js → initAuthObserver(onReady)
4. Firebase Auth restaura sessão ou aguarda login
5. onAuthStateChanged dispara:
   - se logado: fetch userProfile, load workspaces, install snapshot listener
   - se não logado: render tela de login (renderLogin)
6. onReady() → renderApp(root):
   - se firstLogin: wizard
   - se sem squad (não master): tela "sem workspace"
   - else: monta shell (sidebar + header) + setup router
7. Router resolve rota atual e chama renderXxx(container)
```

Detalhes em `js/auth/auth.js` initAuthObserver e `js/app.js` renderApp.

## Fluxo de uma operação (exemplo: editar task)

```
1. User clica numa task na lista          → pages/tasks.js
2. pages/tasks.js abre taskModal           → components/taskModal.js
3. taskModal preenche form com task atual
4. User edita campos, clica "Salvar"
5. taskModal coleta form data, chama:      → services/tasks.js updateTask(id, data)
6. updateTask:
   - lê snapshot prévio (validação)
   - aplica rules de negócio
   - updateDoc no Firestore
   - chama auditLog (skip se sampling)
   - notifica observers (notify())
7. Firestore propaga via onSnapshot listener (subscribeToTasks)
8. pages/tasks.js re-renderiza lista automaticamente
```

## Padrões importantes

### Snapshot global de users

`auth.js initAuthObserver` instala `onSnapshot(collection 'users')` no login.
- `store.users` SEMPRE tem todos users em tempo real
- Qualquer `users.find(u => u.id === uid)` em qualquer página funciona
- Substitui patches em ~50 lugares que faziam lookup manual

### Cache TTL via `store.getCached/setCache`

```js
const CACHE_KEY = 'usersAll';
const CACHE_TTL = 5 * 60 * 1000; // 5 min
const cached = store.getCached(CACHE_KEY, CACHE_TTL);
if (cached) return cached;
const fresh = await getDocs(...);
store.setCache(CACHE_KEY, fresh);
```

Usado em `services/users.js`, etc. Reduz reads do Firestore.

### Lazy loading via `import()` dinâmico

Páginas pesadas só carregam quando ativadas:

```js
// services/tasks.js
const { syncUserNucleosToSquads } = await import('./workspaces.js');
```

Também aplicado em `taskTypes` (lazy via `loadTaskTypes()` cacheada).

### RBAC

`store.can(permission)` é a fonte de verdade pra UI:
```js
if (store.can('task_delete')) {
  // mostra botão "Excluir"
}
```

Permissões vêm de `userRole.permissions` (Firestore `/roles/{roleId}`).
Master = sempre true (override).

Server side: rules do Firestore validam novamente (defense in depth).

### Cloud Functions com Secret Manager

Padrão para qualquer chamada que envolva secret:

```js
// 1. Define secret
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');

// 2. Função com secret no manifest
export const callLLM = onCall({
  secrets: [ANTHROPIC_API_KEY],
}, async (request) => {
  requireAuth(request);
  await checkRateLimit(auth.uid, 'llm', 100, 3600);
  // usa ANTHROPIC_API_KEY.value()
});

// 3. Setar (1x):
//   firebase functions:secrets:set ANTHROPIC_API_KEY
// 4. Deploy:
//   firebase deploy --only functions:callLLM
```

NUNCA commitar secrets em git. Sempre via Secret Manager.

## Segurança em camadas

### Camada 1 — CSP (Content Security Policy)
`index.html` tem CSP estrita: bloqueia eval, inline scripts não-autorizados, fontes externas suspeitas.

### Camada 2 — Firestore Rules
`firestore.rules` audita cada coleção:
- read/write controlados por role
- Validação de campos sensíveis (não pode auto-promover a master)
- Rate limit em writes críticos

Rules têm helpers: `isAuth()`, `isMaster()`, `isAdmin()`, `isManager()`.

### Camada 3 — Cloud Functions
- `requireAuth(request)` — onCall valida ID token
- `isAdmin(uid)` — checa role no Firestore
- `checkRateLimit(uid, key, max, window)` — atomic transaction

### Camada 4 — App Check (reCAPTCHA Enterprise)
Valida que requests vêm do app real, não de Postman/curl.

### Camada 5 — Audit log
Toda ação crítica grava em `audit_logs`:
- Ações 90 dias (TTL via `pruneOldAuditLogs`)
- Severity 'critical' / lgpd.* / security.* preservados indefinidamente

## Anti-padrões a evitar

- ❌ `innerHTML` com input de user sem `escHtml()`
- ❌ `console.log` em produção (usar `logger.debug` que silencia em prod)
- ❌ Loop com `await getDoc()` (usar `Promise.all` ou query)
- ❌ Funções > 200 linhas (quebrar em sub-funções)
- ❌ Service tocando DOM (separation of concerns)
- ❌ Duplicar `esc()` em cada arquivo (importar `util/escape.js`)
- ❌ Chamar Firestore rules de fora (usar service que valida + audita)

## Débitos técnicos conhecidos

| Item | Severidade | Plano |
|---|---|---|
| `portal.js renderPortalCalendar()` 586 linhas | Alta | Quebrar em sub-funções (sprint futuro) |
| `services/aiActions.js` 3476 linhas | Alta | Modularizar em `aiActions/{tasks,portal,goals}` |
| ~30 `console.log` legados | Média | Migrar pra `logger.*` aos poucos |
| Sem CI/CD (deploy manual) | Média | GitHub Actions: lint + rules tests + deploy |
| Sem test coverage automatizado | Média | Vitest pra services + Playwright pra E2E |
| `~770` usos de `innerHTML` | Baixa | Auditar via grep + escHtml em hot spots |
| RTDB presence revertido (travou) | Baixa | Investigar causa antes de re-tentar |

Detalhes em `docs/PERFORMANCE.md` (otimizações pendentes).

## Componentes UI compartilhados (3.0.0+)

A partir da release **3.0.0**, a app consolidou unidade visual via componentes reusáveis. O ponto central é o **`optionPicker`** (`js/components/optionPicker.js`), que substituiu **~96 `<select>` nativos** em 23 módulos por um popover padronizado (bolinha colorida + ícone + label + chevron, com busca interna e suporte a agrupamento com acordeão).

Outros componentes do mesmo registro:

| Componente | Função |
|---|---|
| `optionPicker` | Substitui `<select>` nativo |
| `filterBar` | Filtros compartilhados em Calendar/Kanban/Timeline |
| `taskModal` | Modal de criação/edição de tarefa (5 pickers integrados) |
| `modal` | Wrapper de modais com footer customizável |
| `toast` | Notificações não-bloqueantes |
| `uiKit` | Split-button + overflow menu nos headers |
| `cardPrefsModal` | Personalização de campos visíveis em cards |

Documentação detalhada (API, padrões de uso, cor por hash, avatar por inicial, cascata via `picker-refresh`) em [`docs/UI-COMPONENTS.md`](UI-COMPONENTS.md).

## Versionamento

Esquema **SemVer + BUILD** formalizado em `js/version.js`. Versão atual exibida no rodapé da sidebar (`PRIMETOUR · v3.0.0`, hover mostra build completa).

Regras de bump, checklist de release e histórico consolidado em [`docs/VERSIONING.md`](VERSIONING.md) e [`CHANGELOG.md`](../CHANGELOG.md).

## Versão das dependências

- Firebase SDK: `10.12.2` (CDN)
- Cloud Functions: Node 20
- jsPDF, SheetJS, Fabric.js: via CDN (`index.html`)

Bumps de Firebase SDK exigem teste manual completo (auth flow, snapshot, rules) — não há cobertura automatizada ainda.

## Recursos externos

- Firebase Console: https://console.firebase.google.com/project/gestor-de-tarefas-primetour
- GitHub Actions: nenhum ainda (pendente)
- Sentry / Observability: nenhum ainda (pendente)
