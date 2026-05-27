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
| Precisa de secret runtime exposto ao browser (API key LLM via callable) | **Function** (Secret Manager) |
| Cron diário/mensal puxando API externa pesada (GB de dados) | **Action** |
| Cron diário batch que lê Firestore + chama LLM externo + escreve Firestore (ex: `classify-content-ai.js` 4.49.41+) | **Action** (key fica em GitHub Secret, não Secret Manager — é CI, não runtime) |
| One-shot administrativo (cleanup, seed inicial, cutover, rollback) | **Action** (manual dispatch com confirmação literal) |
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

### Cloud Functions agendadas + reactive (sessão maratona maio/2026)

A partir de v4.57.28→52, padrão consolidado: work scheduled/lazy que
dependia de "user logado abrir o app" foi migrado pra Cloud Functions
agendadas (`firebase-functions/v2/scheduler`) + reactive (`onDocumentUpdated`).

**Pseudo-user `users/system` (criado em v4.57.33):**

```js
// users/system doc
{
  id: 'system',
  name: 'Sistema PRIMETOUR',
  isSystem: true,
  active: false,  // não pode logar
  avatarColor: '#6B7280',
}
```

Permite notifs sistêmicas (SLA alerts, daily summary, stale checks) atribuírem
`actorId='system'` em vez do user random que abriu o app primeiro. Renderers
em `notificationPanel.js:250` já fazem fallback pro `actorName` armazenado
quando `actorId==='system'` (sem precisar buscar no store).

**Catálogo de CFs scheduled/reactive (após maratona):**

| CF | Type | Schedule | Module |
|---|---|---|---|
| `csatPeriodicTrigger` | onSchedule | 30 min | CSAT |
| `pruneOldAuditLogs` | onSchedule | 30 6 * * * BRT | infra |
| `dailyBackup` | onSchedule | 0 6 * * * BRT | infra |
| `dailySecurityDigest` | onSchedule | 0 12 * * * BRT | security |
| `weeklySecretsAudit` | onSchedule | 0 12 * * 1 BRT | security |
| `recurringTasksDailyCron` | onSchedule | 0 6 * * * BRT | tasks (v4.57.32) |
| `scheduledNotificationsCron` | onSchedule | 0 7 * * * BRT | tasks (v4.57.33) |
| `roteiroBankValidityCron` | onSchedule | 0 8 * * * BRT | roteiros (v4.57.37) |
| `portalImagesOrphanCleanupCron` | onSchedule | 0 7 * * 1 BRT | images (v4.57.42, REVERTIDO auto-delete em v4.57.44) |
| `portalTipsStaleCheckCron` | onSchedule | 0 8 * * 1 BRT | portal-tips (v4.57.42) |
| `onPortalTipUpdated` | onDocumentUpdated | reactive | portal-tips (v4.57.37) |
| `processRoteiroQueue` | onDocumentCreated | reactive (queue) | roteiros |
| `onSystemFeedbackCreate` | onDocumentCreated | reactive | feedback |
| `onNotificationCreate` | onDocumentCreated | reactive (push) | notifications |
| `deleteR2` | onCall | event | images (v4.57.49 — security I1 fix) |
| `getR2UploadUrl` | onCall | event | images |
| `importRoteiroBankPdf` | onCall | event | roteiros |

**Política comum** dessas CFs:
- TimeZone `America/Sao_Paulo`
- `timeoutSeconds: 540` (9min, máximo onSchedule)
- `memory: 256-512MiB` conforme intensidade
- `retryCount: 1` (safety net)
- Audit log no final com stats agregadas (`{scanned, processed, errors}`)
- Pre-fetch refs (1 query lookup) antes do scan principal

### IA Hub (4.35.23+) — arquitetura server-side

**Princípio**: o browser nunca vê API keys de provedores de IA. Toda chamada LLM
passa pela Cloud Function `callLLM`, que lê a key do Secret Manager.

```
browser  →  aiSecure.callLLMSecure (httpsCallable)
         →  Cloud Function callLLM (requireAuth + rate limit + cost cap)
         →  ANTHROPIC_API_KEY.value()
         →  api.anthropic.com/v1/messages
         →  response (text/citations/usage) → browser
```

Capacidades suportadas no payload:
| Campo | Tipo | Descrição |
|---|---|---|
| `provider` | string | `anthropic` / `gemini` / `openai` / `azure` / `groq` / `local` |
| `model` | string | Ex: `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-haiku-4-5` |
| `systemPrompt`, `userMessage`, `history` | string/array | Conversa |
| `maxTokens`, `temperature` | number | Limites |
| `attachments` | array | **Vision**: image blocks ou data-URIs `data:image/...;base64,...` |
| `webSearch` | bool | **Web search nativo**: ativa tool `web_search_20250305` da Anthropic |
| `agentId`, `agentDailyCapUsd`, `module`, `source` | metadata | Auditoria + cost cap |

Pontos de entrada do browser (todos roteiam pra Cloud Function):
- `chatWithAI(msg, ctx, opts)` em `js/services/ai.js` — chat universal (aiPanel, slash-commands)
- `callLLMSecure({...})` em `js/services/aiSecure.js` — caller direto pra Cloud Function
- `runAgent(agentId, input, ctx)` em `js/services/agents.js` — execução de agente
  configurado (system prompt + KB + tools + few-shots)

KB do agente (`loadAgentKnowledge`) suporta fontes: `url`, `r2`, `sharepoint` (via
Graph), `gdrive` (via Drive API v3), `github`, `webhook`. Cada fonte é fetched no
runtime e injetada no system prompt.

Web search (4.35.23+): quando `agent.allowWebSearch===true` e provider for
`anthropic` ou `gemini`, o pre-fetch Serper é pulado e o modelo decide buscar
sozinho via tool nativo (mais barato + citações automáticas). Demais providers
continuam com Serper-prefetch.

Smoke tests CLI (não logam a key):
- `functions/test-anthropic-smoke.cjs` — text + web_search
- `functions/test-anthropic-vision.cjs` — image block

### IA Hub — Agentes orquestrados pelo módulo (4.49.41+)

**Princípio**: o IA Hub é **registry + governança** (define o agente, prompt,
modelo, kill switch). A **orquestração** (quem chama, quando, sobre que dados,
com que frequência, com que escrita de volta) é **nativa do módulo dono**.

Não existe um `agentScheduler` genérico que varre `ai_agents` e dispara por
`triggers.schedule`. Cada agente tem seu próprio runtime contextual:

| Agente | Orquestrador nativo do módulo |
|---|---|
| `bi-insights-analyst` | UI dentro dos dashboards (Produtividade/NL/GA/Meta/Portal/Roteiro). Botão "Sugerir Insights" por widget. |
| `nl-content-classifier` (4.49.41+) | Script `scripts/classify-content-ai.js` + workflow `classify-content-ai.yml` (cron diário). Dashboard NL → Conteúdo & Temas → bloco shadow mode pra revisão humana. |
| `task-triage` | Botão no header de Tarefas + cron diário via Cloud Function. |
| `roteiro-generator` | UI "Criar com IA" dedicada em Roteiros. |
| `portal-tip-updater` | Script de atualização periódica de dicas vencidas. |
| `content-week-planner` | UI no Calendário de Conteúdo. |
| `content-caption` | UI inline em cada post do Calendário. |

**Vantagens dessa arquitetura**:
- Cada módulo decide a melhor superfície (cron, botão, UI inline, workflow CI)
  conforme sua natureza de dado
- Falhas isoladas — quebra do classificador de NL não derruba o BI Insights
- Custo controlado per-agente via `agent.limits.maxCostPerDayUsd` (enforçado
  tanto na Cloud Function `callLLM` quanto no script de classificação)
- Audit unificado em `ai_usage_logs` (tanto chamadas client via Cloud Function
  quanto scripts em CI gravam no mesmo formato)
- **Kill switch soft**: pausar o agente no IA Hub (`active: false`) desliga
  TODOS os orquestradores do agente sem mexer em nenhum cron/workflow

**Shadow mode como padrão de migração** (4.49.41+):
Quando o agente substitui uma feature determinística existente (ex: regex
classifier → LLM classifier), o padrão recomendado é:
1. Agente roda em paralelo, grava em campos `extracted.ai*` separados (não toca
   os de produção)
2. Dashboard mostra concordância vs heurística + divergências top
3. Humano revisa e marca "IA certa / regex certo" em divergências
4. Cutover formal via workflow manual com backup automático em `*Prev`
5. Rollback em 1 comando se algo der errado

Detalhes operacionais em `scripts/SHADOW-MODE-NL-CLASSIFIER.md` e
`RULES-AND-AUTOMATIONS.md` §10.5d.

### Banco de Roteiros (v4.50.0+) — curadoria estática + import IA

**Princípio**: separar **curadoria** (template pronto) de **cotação** (saída de
cliente). O Gerador de Roteiros (`#roteiros`) atende um cliente específico. O
Banco de Roteiros (`#banco-roteiros`) é a biblioteca de templates da empresa.

| Aspecto | Gerador de Roteiros | Banco de Roteiros |
|---|---|---|
| Collection | `roteiros` | `roteiros_bank` |
| Schema | `emptyRoteiro()` (com client/travelers/costPricing) | `emptyRoteiroBank()` (sem cliente; com categories[] e validity) |
| Dono | consultor (`consultantId`) | curadoria (write = `portal_destinations_manage`) |
| Geração | IA via fila assíncrona (`processRoteiroQueue`) | Import PDF via Claude multimodal (`importRoteiroBankPdf`) |
| Visibilidade | privado por consultor + colaboradores | read pra qualquer autenticado |
| Status | draft/review/sent/approved/archived (pipeline cliente) | draft/review/approved/archived (pipeline curadoria) |

**Por que duas collections separadas em vez de campo `isTemplate`**:
1. Read patterns radicalmente diferentes (cliente raramente lê todos os seus
   próprios; banco é lido por todos o tempo todo)
2. Permissões mais simples (rules sem ramificações condicionais)
3. Schemas divergem progressivamente (banco ganha categorias multi-período;
   gerador ganha tasks operacionais)
4. Auditoria limpa (`source.type` no banco distingue manual / pdf_import / api_import)

**Import via Anthropic multimodal**: PDF base64 vai direto pro Claude Sonnet 4.5
como content block `type='document'`. Nenhuma dependência de pdf-parse / pdfjs no
servidor — Claude lê o PDF nativamente (incluindo layout de tabelas de pricing).
Custo ~20k input + 7k output tokens por PDF (~$0.15).

**Alinhamento com Destinos**: `ensureDestination()` no service garante que toda
cidade do banco vira (ou referencia) um doc em `portal_destinations`. Mesmo
princípio que `embeddedTips[]` no Gerador faz com `portal_tips`.

**Export PDF reusa Gerador** (v4.50.3+): em vez de duplicar 1500+ linhas do
`roteiroGenerator.js`, criamos `bankDocToRoteiroShape(bankDoc)` em
`js/services/roteiroBankGenerator.js` que adapta o shape do banco pro shape
esperado por `generateRoteiroPDF(roteiro)`. Adaptações principais:
`categories[].hotels[]` flatten em `hotels[]` (notes guarda label da categoria),
`categories[].pricing[]` vira `pricing.customRows[]` no formato
"Categoria · período · Single/Duplo", `includes.{buckets}` flatten com tags
"[Hospedagem]", "[Passeios]", etc., `documentation.visas[]` consolidado em
`importantInfo.visa`, `cancellation[]` no shape do roteiroPDF.

**Hero auto-resolve** (v4.50.1+): listing chama `ensureBankHero(id, doc)` em
background pra docs sem hero. Lookup: `portal_images` por country+city com
`assetCategory='location'` → fallback CF `fetchDestinationPhoto` (cache 90d em
`photo_cache/{queryKey}`). Mesma cascata usada pelo Gerador.

**IA Hub integração** (v4.50.1+): CFs `processRoteiroQueue` (gerador IA) e
`importRoteiroBankPdf` (import banco) gravam em `ai_usage_logs` (mesma collection
que outros agentes) com tokens + cacheRead + webSearchCount. Visualização
automática nas abas Custos/Logs do `aiHub.js` — filtro por `module` ('roteiros'
ou 'banco-roteiros').

**Pivot Envision** (v4.58.0+): a partir desta versão, a fonte canônica dos
roteiros do banco é o sistema **Envision (TravelAgent)** da equipe operacional.
PRIMETOUR consome via SOAP (`.svc` com Forms Auth — Trip API REST não cobre
roteiros). Adapter pure-function `js/services/envisionAdapter.js` converte
Itinerary → shape PRIMETOUR. 236 docs importados em v4.58.7 via script
`functions/import-envision-bundle.cjs` rodado contra bundle capturado por
DevTools no navegador autenticado. Procedimento documentado em
`docs/ENVISION-SYNC-GUIDE.md` (incl. troubleshooting, arquitetura, comandos
copy-paste). UI hint "Como atualizar via Envision" no header banco (v4.59.1).

### Geographic SSOT — modelo cross-module (v4.59.0+)

**Problema atacado**: antes desta sprint, sistema tinha 5+ representações
paralelas da mesma cidade (filtro "Tóquio" no Banco perdia imagem cadastrada
como "Tokyo"; dica "Cidade do Cabo" não cruzava com roteiro "Cape Town").
Match exato Envision → portal_destinations era 5%.

**Arquitetura híbrida** (CLAUDE.md §14.a):

| Camada | Lugar | Mutabilidade | Quem escreve |
|---|---|---|---|
| Continentes (7) | `js/data/continents.js` hardcoded | Imutável | Dev (PR no Git) |
| Países (~196 ISO 3166-1) | `js/data/countries.js` hardcoded | Imutável + adições raras | Dev (PR no Git) |
| Cidades | `portal_destinations` Firestore | Master controla CRUD | UI / Admin SDK |

**Helpers centralizados** (`js/services/geoResolver.js`):
- `resolveCountry(label) → { code, pt, en, continent } | null`
- `continentCodeFromLabel(label) → 'AF'|'SA'|...|null` (inclui mapa legacy "Brasil"→SA, "Caribe"→NA)
- `resolveCountryCodes([labels]) → [codes]` (resolve lista filtrando unmatched)
- `findDestinationByLabel({country, city})` — busca portal_destinations
- `resolveOrCreatePendingDestination(...)` — cria pending se não acha (futuro)

**Schema cross-module** (v4.59.0+, não-destrutivo):

```js
// portal_destinations
{
  continent: 'Ásia',         // legado
  country:   'Japão',        // legado
  city:      'Tóquio',       // legado
  countryCode:   'JP',       // NOVO: FK ISO 3166-1 (preferido)
  continentCode: 'AS',       // NOVO: FK UN M.49
  cityAliases:   ['Tokyo'],  // NOVO: matches alternativos
  source:        'manual',   // NOVO: 'manual' | 'envision-auto' | 'imported'
  reviewStatus:  'approved', // NOVO: 'approved' | 'pending'
  envisionLocationId: null,  // NOVO: FK Envision se conhecido
}

// roteiros_bank.geo
{
  countries: ['Japão'],      // legado
  countryCodes: ['JP'],      // NOVO: preferido nos filtros
  continentCodes: ['AS'],    // NOVO
  cities: [{ city: 'Tóquio', country: 'Japão', countryCode: 'JP', nights: 3 }],
}

// portal_images & portal_tips
{ country: 'Japão', countryCode: 'JP', continentCode: 'AS', ... }
```

**Princípio**: campos antigos coexistem com novos durante deprecation cycle
(3-6 meses). Reader prioriza `countryCode` quando presente; fallback pra label.
Writer (saveDestination) preenche códigos AUTO via `resolveCountry()` quando
não informados. Eventualmente legados saem em MAJOR.

**Validação** (`functions/audit-geography-ssot.cjs`): 100% match contra prod
em todas as 4 collections (53 países roteiros_bank + 29 destinations + 13
images + 7 tips).

**Backfill** (`functions/backfill-geo-codes.cjs`, idempotente, `--apply` flag):
rodado em v4.59.0, atualizou 61 destinations + 236 bank + 190 images + 9 tips.

## Segurança em camadas

> **Última auditoria completa:** 2026-05-15 (v4.40.21–23). Pré-auditoria
> bancária. 17 findings — 16 resolvidos no código + GCP Console, 1 deferido
> com mitigação. Detalhes em `docs/SECURITY-AUDIT-2026-05-15.md` e
> `docs/SECURITY-FOLLOWUPS.md`.

### Camada 1 — CSP (Content Security Policy)
`index.html` tem CSP em `<meta http-equiv>` (será via headers HTTP após
migração Cloudflare):

- `script-src 'self' 'unsafe-inline'` + CDNs whitelistadas (Firebase, jsDelivr, cdnjs)
- `style-src 'self' 'unsafe-inline'` + Google Fonts + Accounts
- `img-src` **whitelist explícita** (audit 4.40.21+) — R2, Worker, Wikipedia,
  Unsplash, Google avatars, MS Graph, Imgur (substituiu `https:` wildcard)
- `connect-src` **endpoints específicos** do project (audit 4.40.21+) — não usa
  mais `*.googleapis.com`/`*.firebaseio.com` genéricos
- `frame-ancestors 'self'` (anti-clickjacking)
- `form-action 'self' + login.microsoftonline.com` (anti-CSRF via formulário)
- `object-src 'none'`, `base-uri 'self'`

Inline scripts foram migrados pra `js/preload.js` + `js/splash.js` (4.40.21+),
deixando o caminho aberto pra remover `'unsafe-inline'` de `script-src` quando
um build step for adicionado (Vite/esbuild com nonce automático).

### Camada 2 — Firestore Rules
`firestore.rules` audita cada coleção:

- read/write controlados por role + ownership
- **Hardening 4.40.21+**: `/projects` e `/tasks` exigem ownership (createdBy/
  assignees/observers) ou role `isManager()` pra update/delete. `/tasks` read
  pra status `done`/`in_progress` sem auth foi removida (era info-leak vector
  pro portal legacy).
- `/feedbacks` read filtra por gestor/collaborator/managerId/createdBy (não
  é mais "qualquer auth user lê tudo")
- `/users` mantém read aberto pra auth (necessidade operacional, ~100 pontos
  da UI dependem) com nota arquitetural recomendando subcollection
  `users/{uid}/private/{doc}` no futuro pra campos confidenciais
- `/audit_logs` read só isAdmin; create tem regex anti-spoofing de action
- Validação de campos sensíveis (self-update não pode tocar `role`,
  `isMaster`, `roleId`, `visibleSectors`, `permissions`, `active`)

Rules têm helpers: `isAuth()`, `isMaster()`, `isAdmin()`, `isManager()`,
`isPortalManager()`.

### Camada 3 — Cloud Functions
- `requireAuth(request)` — onCall valida ID token
- `isAdmin(uid)` — checa role no Firestore (server-side)
- `checkRateLimit(uid, key, max, window)` — atomic transaction
- `checkRateLimitIP(request, key, max, window)` — limite por IP

**Permissões granulares (4.40.21+):** `getSharePointToken` agora exige
`isAdmin OR permissions.ai_use OR permissions.system_view_all`. Denials
geram audit log de `security.sharepoint_token_denied`.

### Camada 4 — GCP API Key Restrictions (4.40.23+)
Firebase Web API key com `--allowed-referrers`:
- `https://primetour.github.io/*`
- `https://*.primetour.com.br/*`
- `http://localhost:8765/*` (dev)

Comprovado: curl sem referrer → HTTP 403. Mesmo se a key vazar, atacante
não consegue usar de outros domínios.

### Camada 5 — App Check (reCAPTCHA Enterprise)
Valida que requests vêm do app real, não de Postman/curl. JWT renovado
automaticamente.

### Camada 6 — Audit log com PII anonymization (4.40.21+)
Toda ação crítica grava em `audit_logs`:

- **`userEmailHash`** — SHA-256 truncado (`h:<16 hex chars>`) em vez de
  email bruto (LGPD compliance). Mesmo hash = mesmo user (rastreabilidade
  preservada para forensics).
- **`userAgent`** — reduzido a `Browser/OS` (ex: `Chrome/macOS`, 12 chars)
  em vez de fingerprint completo (200 chars). Anti-tracking + LGPD.
- TTL 90 dias (via `pruneOldAuditLogs`)
- Severity `'critical'` / `lgpd.*` / `security.*` preservados indefinidamente

### Camada 7 — Tokens efêmeros + Secrets server-side
- **MS user token** (SSO Microsoft, Graph): sessionStorage + defense-in-depth
  4.40.21+ (`beforeunload` clear + `visibilitychange` 30min hidden auto-clear).
  Para org data (SharePoint via IA agents): usa exclusivamente token app-only
  via Cloud Function `getSharePointToken` + Secret Manager (4.40.23+).
- **R2 upload token**: rate-limited (60/min IP, 20/min user), TTL 60s,
  audit log antes de emit. JWT efêmero planejado pra sprint futuro.
- **Anthropic/OpenAI/Gemini/Groq API keys**: nunca no client. Cloud Function
  `callLLM` é a única porta de entrada. Keys via `defineSecret()` →
  Secret Manager.
- **GitHub PAT**: `config.js` está vazio em prod (4.40.23+). Usar Cloud
  Function com `defineSecret('GITHUB_PAT')` se precisar.
- **FEEDBACK_ADMIN_EMAIL**: `process.env` com fallback (4.40.21+, não é
  credential mas externalizado pra portabilidade).

### Camada 8 — Helpers de segurança defensiva
- `js/util/csvSafe.js` (4.40.21+): `csvCell()`/`csvRow()` prefixam `'` em
  campos começando com `=/+/-/@/|/%/TAB/CR/LF` (anti CSV formula injection
  no Excel/Sheets). Aplicado em exports de `/team`, `/users`, `/checkin`.
- `RFC5322_LITE` regex em `sendCsatEmail` (anti email/CRLF injection)
- `target="_blank"` sempre com `rel="noopener noreferrer"` (anti tabnabbing)

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
| MS token cookie HttpOnly (audit C3) | Média | Sprint dedicado — Cloud Function proxy pra Graph + auth via Firebase ID token cookie. Mitigação atual: defense-in-depth (App Check + TTL + beforeunload + 30min hidden clear + sem fallback em agents) |
| Cloudflare Pages migration (audit C1) | Média | `_headers` file pronto. Quando migrar, HSTS + CSP-headers + COOP/CORP ativam automaticamente |
| SRI em CDN scripts (audit M1) | Média | Incompatível com ES module imports atuais. Resolver junto com build step (Vite/esbuild + plugin SRI) |
| ~30 `console.log` legados | Média | Migrar pra `logger.*` aos poucos |
| Sem CI/CD (deploy manual) | Média | GitHub Actions: lint + rules tests + deploy |
| Sem test coverage automatizado | Média | Vitest pra services + Playwright pra E2E |
| R2 upload token compartilhado | Baixa | JWT efêmero `{path, uid, exp}` assinado por HMAC do Worker secret. Mitigação atual: rate-limit + path whitelist + App Check + audit log de cada token emit |
| `~770` usos de `innerHTML` | Baixa | Auditar via grep + escHtml em hot spots |
| RTDB presence revertido (travou) | Baixa | Investigar causa antes de re-tentar |

Detalhes em `docs/PERFORMANCE.md` (otimizações pendentes) e
`docs/SECURITY-FOLLOWUPS.md` (itens da auditoria 2026-05-15).

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
| `insightsPanel` | Insights & observações por widget de dashboard |
| `insightDraftsDock` | Drawer rodapé com rascunhos de insights (4.33.0+) |

Documentação detalhada (API, padrões de uso, cor por hash, avatar por inicial, cascata via `picker-refresh`) em [`docs/UI-COMPONENTS.md`](UI-COMPONENTS.md).

## Padrões de "single source of truth"

Conforme a app cresceu, várias camadas adicionaram lógica paralela ao mesmo conceito. Releases recentes consolidaram fontes únicas:

### SLA de tarefa = SLA do tipo (4.32.2+)

Antes existiam **dois sistemas** calculando `dueDate`:
- `slaDays` na variação do tipo de tarefa (`taskTypes.js calcSla`) — **dias úteis**
- `dueOffsetDays` no template de tarefa recorrente — **dias corridos**

Resultado: tarefas recorrentes **ignoravam silenciosamente** o SLA do tipo. Mesmo conceito, duas verdades, em unidades diferentes.

A partir de **4.32.2**, a engine de geração recorrente não passa mais `dueDate` — `createTask()` calcula via `calcSla(typeId, occDate, variationId)` (mesma lógica das tarefas pontuais). Templates legacy com `dueOffsetDays > 0` só usam o offset se o tipo NÃO tem `slaDays` configurado (compat sem migração).

**Regra**: para qualquer tarefa nova ou gerada, prazo vem do tipo. Customizar prazo individual é responsabilidade do usuário (campo manual no form), não default do sistema.

### Resolver de tipo de tarefa (4.32.0/4.32.1)

Widgets de dashboard que mostravam "tipo da tarefa" usavam estratégias diferentes (legacy `t.type`, lookup direto, hardcoded labels). Resultado: IDs cifrados aparecendo em produção quando typeId não correspondia a doc Firestore.

A partir de **4.32.0**, `analytics.js` define um único `resolveTypeName(typeId)` com 3 fallbacks:
1. Doc no `store.get('taskTypes')` (Firestore)
2. `STATIC_FALLBACKS` (chaves legacy: `newsletter`, etc)
3. Genérico `"Outros tipos"` (em vez de mostrar ID cifrado)

Usado em `getProductivityByType`, `getTimePerTaskByType`, `getNewslettersOutOfCalendar`. Tipos órfãos são merged em "Outros tipos" pra não poluir rankings.

### CSAT modular por tipo (4.31.x — 4.32.0)

CSAT antes era universal: todas as tarefas done com cliente → 1 pergunta padrão. Não escalava: newsletter precisa avaliar conteúdo + design separadamente; outras entregas tem perguntas próprias.

A partir de **4.31.0**, cada tipo de tarefa pode ter `csatConfig` com:
- **Perguntas customizadas** (texto livre, score 1-5, sim/não)
- **Modo de envio**: `individual` (uma survey por tarefa, default), `periodic` (uma survey por período cobrindo várias tarefas), `milestone` (survey de tarefa-pai abrangendo entregas relacionadas)
- **Snapshot pattern**: ao criar a survey, as perguntas são **copiadas** do tipo pra dentro do doc da survey — assim, mesmo se o admin mudar as perguntas depois, surveys antigas mantêm o que foi enviado

Score derivado = `round(avg(scores))`. Comentário derivado = concat de campos texto com `[label]` prefix.

`runPeriodicCsatTrigger()` em `csat.js` é cron client-side com idempotência via `localStorage` (`csat-periodic-runs`). Chave: `<typeId>:<periodWindowId>` onde periodWindowId é `YYYY-WNN` (weekly), `YYYY-MM-a/b` (biweekly), `YYYY-MM` (monthly).

Em produção robusta, próxima fase F2.1 deveria mover o trigger pra Cloud Function cron — pra não depender de alguém abrir o app no dia certo.

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
