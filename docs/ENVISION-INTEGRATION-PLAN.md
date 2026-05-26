# Plano — Integração Envision (Travel Agent / Trip API) com Banco de Roteiros

> **Status**: rascunho (2026-05-26) · aguardando aprovação Renê + resposta Envision sobre Trip API
>
> **Owner técnico**: Claude + Renê
>
> **Pivot**: hoje os roteiros do `roteiros_bank` são cadastrados manualmente (CRUD + import PDF). A partir desta sprint, a fonte primária passa a ser o **TravelAgent da Envision** (sistema operacional da agência). O cadastro manual continua existindo, mas **só como fallback** (roteiros que ainda não estão na Envision, ou edições editoriais sobre o doc institucional).

---

## 1. Motivação

- **Fonte de verdade**: roteiros, pricing, hoteis e dias-a-dia já existem na Envision (sistema operacional da agência usado diariamente pra cotação/venda). Manter cadastro paralelo manual = duplicação + risco de divergência.
- **Frescor**: roteiros mudam (validade, preços, hotéis substituídos). Sync automatizado garante que o Gerador IA usa o estado atual em vez de PDF estático de 6 meses atrás.
- **Velocidade**: hoje cada novo roteiro = curador colando PDF, IA parseando, revisor validando. Com sync, novos roteiros aparecem no Gerador em minutos.
- **Cobertura editorial**: a Envision tem campos que o curador hoje preenche (`Includes`, `CancellationPolicy`, `FormOfPayment`) já populados pelo operacional.

---

## 2. Achados da auditoria via Chrome MCP (2026-05-26)

### Endpoints da API interna identificados

| Endpoint | Método | Função |
|---|---|---|
| `/Services/SiteService.svc/FindLocations` | POST | Autocomplete de destinos (retorna `LocationId`) |
| `/Services/SiteService.svc/Search` | POST | Lista roteiros por filtro (destino + datas) |
| `/Services/SiteService.svc/GetItineraryDetails` | POST | Detalhe completo de 1 roteiro (~121KB JSON) |
| `/Services/SiteService.svc/CalculateItineraryFareEstimate` | POST | Recalcula preço com base em fare categories |
| `/Services/SiteService.svc/GetExecuteQueriesStatus` | POST | Polling de status (uso interno) |

Stack inferido: ASP.NET WCF service (`.svc`), SignalR pra realtime push, jQuery client-side, sessão Forms Auth (cookie `.ASPXAUTH`).

### Shape do `Itinerary` (resposta de `GetItineraryDetails`)

```
Itinerary {
  Id, Name, Description
  NumberOfDays, NumberOfNights
  Currency, ExchangeRate
  SupplierId, LoginInformationId
  AvailabilityDates[]

  Globalization: {
    Name, Description, ShortDescription
    Includes              ← texto livre "O que está incluído"
    GeneralInfo           ← informações gerais
    CancellationPolicy    ← política de cancelamento
    FormOfPayment         ← formas de pagamento
    Culture
  }

  DayByDay[]: {            ← coração editorial (1 entry por dia)
    Day, Name, Description, NightDescription, Culture
  }

  Images[]: {              ← galeria oficial
    UrlImage, UrlThumbnailImage, Description, FileType
  }

  Products[]: {            ← hotéis + serviços (transfers, passeios, ingressos)
    ProductId, ProductType, ProductName, ProductSupplier
    Day, NumberOfDays, NumberOfNights
    Hotel, HotelChainCode      ← se ProductType = HOTEL
    Service                    ← se ProductType = SERVICE
    Location, LocationId
    Optional, Online, MaxQuantity
    OfflineProductId, AirCiaCode
    ProductFareCategories[]    ← preço por fare
  }

  FareCategories[]: {      ← categorias comerciais (Standard, Premium, ...)
    Id, Name, EstimatedFaresTypes[], FareCategoryDates[]
  }

  ProductFareCategories[]: { ← matriz preço × produto × room
    ItineraryProductId, ItineraryFareCategoryId, ItineraryFareCategoryDateId
    Room, RoomId, RoomTypeDescription
    Name, ServiceFareName
  }
}
```

### Auth atual (limitação crítica)

Cookie `.ASPXAUTH` da sessão Forms Auth do navegador. **Cloud Function não tem cookie** — duas saídas:

- **Opção A — Forms Auth replicado**: CF replica login (`POST /Authenticate/Login` com email/senha), captura cookie, usa em chamadas. Frágil: expira ~30min ocioso, quebra com MFA, exige conta de serviço dedicada, senha rotaciona.
- **Opção B — Trip API dedicada**: produto separado da Envision (`Trip API`) — credencial `itinerary.primetour` (criada 25/03/2021) provavelmente é pra ela. Auth por key/secret, sem expiração curta. **Bloqueado**: precisamos da Envision confirmar URL base + doc + senha da credencial.

**Decisão**: enquanto a Envision não responde, prototipar com Opção A (conta de serviço dedicada, não a do Renê). Quando Trip API chegar, trocar o adapter de auth (1 arquivo isolado).

---

## 3. Arquitetura proposta

### Modelo de sync: **Híbrido**

```
┌──────────────────────────┐                  ┌───────────────────────────┐
│  Envision TravelAgent    │                  │   Firebase Cloud Functions │
│   (fonte de verdade)     │                  │                            │
└──────────────────────────┘                  └───────────────────────────┘
        ▲                                                  ▲
        │ POST /Search (delta por LocationId)              │ HTTPS callable
        │ POST /GetItineraryDetails (on-demand)            │
        │                                                  │
┌─────────────────────┐   ┌──────────────────────────────────────────┐
│  syncEnvisionList   │   │  fetchEnvisionItineraryDetail (callable) │
│  (CF scheduled hr)  │   │  (lazy fetch quando user abre detalhe)   │
└─────────┬───────────┘   └────────────────────────┬─────────────────┘
          │                                        │
          │ writeBatch (upsert)                    │ TTL cache 15-30min
          ▼                                        ▼
┌──────────────────────────────────────────────────────────────────┐
│             Firestore (mirror + cache layers)                    │
├──────────────────────────────────────────────────────────────────┤
│  roteiros_bank                  ← coleção unificada (manual + env) │
│    .source: 'manual'|'envision'                                   │
│    .envisionId: number (FK quando source='envision')              │
│    .syncedAt: Timestamp (último mirror)                           │
│    .editorialOverlay: { ... } (overlay opcional, ver §6)          │
│  roteiros_bank_envision_cache    ← detalhe completo, TTL 30min    │
│    .envisionId, .fullJson, .cachedAt, .expiresAt                  │
│  roteiros_bank_locations         ← cache de Locations (autocomplete)│
└──────────────────────────────────────────────────────────────────┘
          │
          ▼
┌──────────────────────────────────────────────────────────────────┐
│              Cliente Web (Gerador + Banco)                       │
│                                                                  │
│  - Listagem/busca: query Firestore local (rápido, full-text)     │
│  - Abrir detalhe: trigger fetchEnvisionItineraryDetail callable  │
│  - Gerador IA: consome detalhe atualizado pra montar PDF cliente │
└──────────────────────────────────────────────────────────────────┘
```

### Por quê híbrido (e não mirror puro / on-demand puro)

| Modelo | Pros | Contras | Veredito |
|---|---|---|---|
| Mirror puro | rápido, offline-tolerant | storage explode (10-50KB × N roteiros × N edições), risk de price stale | ❌ |
| On-demand puro | sempre fresh | latência cada request, depende API up, sem busca local | ❌ |
| **Híbrido** | metadata local rápido pra busca + detalhe fresh on-demand | complexidade extra, 2 caminhos de leitura, cache invalidation | ✅ |
| Webhook push | near-realtime, sem polling | depende Envision expor (provavelmente não) | 🔵 aspiracional |

Detalhe da divisão:
- **Mirror local** (cron horário): metadata leve por roteiro (~1KB cada) — `id, title, summary, destino, validade, numberOfDays, hero, supplierId`. Suficiente pra listar, filtrar, buscar.
- **Detail on-demand** (callable + cache 30min): `DayByDay`, `Products`, `Images`, `FareCategories`. Buscado quando user clica "abrir" ou Gerador IA solicita.

---

## 4. Schema Firestore

### Mudanças no `roteiros_bank` (collection já existente)

**Reusamos a collection existente** (não criamos `roteiros_bank_envision` separado) — adicionamos campos discriminadores:

```js
{
  // —— já existe ——
  title, summary, hero, validity, destinations,
  categories, hotels, services, pricing, ...

  // —— novos campos ——
  source: 'manual' | 'envision',                  // discriminador
  envisionId: number | null,                       // FK quando envision
  envisionUrl: string | null,                      // URL no TravelAgent (deep link)
  envisionSupplierId: number | null,
  envisionLoginInformationId: number | null,

  syncedAt: Timestamp | null,                      // último sync bem-sucedido
  syncError: { code, message, ts } | null,         // último erro de sync
  detailCachedAt: Timestamp | null,                // última vez que detalhe foi fetched
  detailCacheExpiresAt: Timestamp | null,

  // —— overlay editorial (§6) ——
  editorialOverlay: {                              // null se nada customizado
    title?: string,                                // se curador renomeou
    summary?: string,
    heroImageUrl?: string,                         // se curador trocou hero
    notes?: string,                                // dicas internas, não-Envision
    pricingNotes?: string,                         // observações sobre preço
    updatedBy?: uid,
    updatedAt?: Timestamp,
  } | null,
}
```

**Migration**: docs antigos (`source` undefined) recebem `source: 'manual'` em script Admin SDK one-shot. Reader trata ambos.

### Nova collection: `roteiros_bank_envision_cache`

```js
{
  envisionId: number,                              // doc ID = String(envisionId)
  fullJson: string,                                // JSON.stringify do detalhe Envision
  fullJsonHash: string,                            // sha256 pra detectar mudança
  cachedAt: Timestamp,
  expiresAt: Timestamp,                            // TTL 30min default
  fetchedBy: uid,                                  // quem disparou
  apiVersion: 'forms-auth' | 'trip-api',           // auth usado
}
```

Indexes: `expiresAt` (pra cleanup CF) + composite `envisionId, expiresAt`.

### Nova collection: `roteiros_bank_locations`

Cache de `FindLocations` (autocomplete de destinos). Evita 1 chamada por keystroke do user.

```js
{
  envisionId: number,                              // doc ID
  name: string,                                    // "Tailândia"
  display: string,                                 // "Tailândia, Tailândia"
  country: string,                                 // "TH"
  parentId: number | null,                         // hierarquia (continente → país → cidade)
  type: number,                                    // tipo Envision
  cachedAt: Timestamp,
}
```

Sync semanal (locations mudam raramente). Inicialização: 1 script seed.

### Integração com `portal_destinations`

Manter o sistema atual de destinos hierárquicos do Portal de Dicas. Mapeamento Envision Location → portal_destination via cidade/país. Quando location nova chegar da Envision e não existir no portal, **flag pra curador revisar** (não auto-cria — evita explosão de destinos lixo).

---

## 5. Cloud Functions

### `syncEnvisionItineraryListCron` (scheduled, hourly)

- Itera lista de "destinos prioritários" (configurável em Firestore: `system_config/envision-sync`).
- Pra cada destino: `POST /Services/SiteService.svc/Search` com janela `BeginDepartureDateTime = today, EndDepartureDateTime = today + 365`.
- Para cada Itinerary retornado:
  - `upsert` em `roteiros_bank` (cria se `envisionId` novo, atualiza metadata se existe).
  - Compara `fullJsonHash` antigo vs novo → se mudou, `bumpEditorVersion()` + audit log.
- Pseudo-user `system` (CLAUDE.md §13.b) pra `createdBy`/`updatedBy` em docs novos.
- Auth: Opção A (Forms Auth replicado) ou B (Trip API) — encapsulado em `envisionAuthGet()`.
- Stats: `audit_logs` com `action: 'system.envision_sync_cron'`, contagem upserted/skipped/errored.

### `fetchEnvisionItineraryDetail` (onCall, lazy)

- Trigger: user clica "abrir roteiro" no Gerador OU agente IA solicita detalhe via `fetchEnvisionItineraryDetail({ envisionId })`.
- Checa `roteiros_bank_envision_cache` — se `expiresAt > now`, retorna cache.
- Caso contrário: `POST /Services/SiteService.svc/GetItineraryDetails`, grava cache, retorna.
- Anti-double-submit: lock `roteiros_bank_envision_locks/{envisionId}` (TTL 60s) pra evitar 5 users abrindo mesmo doc disparem 5 fetches.
- errorCode + isRetryable (CLAUDE.md §13.e).

### `syncEnvisionLocationsCron` (scheduled, weekly)

- Refresh do `roteiros_bank_locations` (cache de autocomplete).
- Itera lista canônica de destinos comerciais (~200 entries) → fetch + upsert.

### `mirrorEnvisionImagesCron` (scheduled, daily)

- Pra cada `roteiros_bank` doc com `source: 'envision'`, baixa `Images[].UrlImage` → R2 (reusa pipeline existente do Banco de Imagens).
- Por quê: URLs da Envision podem expirar/mudar; queremos imagens estáveis no nosso R2 pra exibir em PDFs gerados (cliente final).
- Reusa adapter atual `bankDocToRoteiroShape` (CLAUDE.md §12.f).

### `cleanupExpiredCacheCron` (scheduled, hourly)

- Delete docs em `roteiros_bank_envision_cache` com `expiresAt < now - 24h`.
- Idempotente, low-priority.

### Endpoint config Firestore

```js
// system_config/envision-sync
{
  enabled: boolean,                                // master kill switch
  authMode: 'forms-auth' | 'trip-api',
  baseUrl: 'https://v2.travelagent.com.br',        // ou api.envisiontecnologia.com.br
  serviceAccount: { email, identifierUuid },       // identifierUuid = "0d1795ce-..."
  // senha NÃO fica aqui — fica em Secret Manager: ENVISION_PASSWORD
  prioritaryLocations: [135, 7, ...],              // LocationIds pra sync
  syncWindowDays: 365,
  detailCacheTtlMinutes: 30,
  syncIntervalMinutes: 60,
}
```

---

## 6. Estratégia de conflito (Envision vs edição local)

Adotamos **Read-only com Overlay** (recomendação:

- **Envision = source of truth** dos campos institucionais (`title`, `description`, `dias`, `produtos`, `preços`, `cancellationPolicy`).
- **Local pode SOBREPOR via `editorialOverlay`** campos editoriais (renomear título, trocar hero, adicionar `notes` internas, `pricingNotes`).
- Reader sempre faz merge: `editorialOverlay.title ?? envisionData.title`.
- Mirror cron sobrescreve campos base mas **nunca toca `editorialOverlay`**.

UI no editor:
- Banner "Roteiro sincronizado da Envision (última atualização: X min atrás)"
- Campo de detalhe (descrição, dia) tem ícone `📌` (overlay) se curador editou
- Botão "Restaurar do Envision" reverte overlay daquele campo

Benefícios:
- Sem merge conflicts complexos.
- Curador mantém poder editorial sem virar batalha "sobrescreveu meu trabalho".
- Audit log explícito (`audit_logs` com `action: 'roteiros_bank.editorial_overlay'`).

---

## 7. Mudanças na UI

### Banco de Roteiros (`js/pages/banco-roteiros.js`)

- Header: badge "Sincronizado com Envision" (verde = ok, amarelo = stale > 2h, vermelho = erro)
- Card de cada roteiro:
  - Ícone `🔗 Envision` ou `✍ Manual` no canto
  - Botão "Sync agora" (apenas master/admin)
- Filtros: adiciona `Fonte: [todos | Envision | Manual]`

### Gerador de Roteiros

- Sem mudança visível pro consultor — listagem continua funcionando igual.
- Diferença interna: ao clicar "candidato Y" → trigger `fetchEnvisionItineraryDetail` em vez de ler full doc local.
- Banner discreto durante fetch on-demand: "Buscando detalhes atualizados…" (esconde após 800ms se ok).

### Settings (`js/pages/settings.js` ou novo)

- Painel "Integração Envision":
  - Status: connected/disconnected
  - Última sync OK
  - Próxima sync em
  - Stats: N roteiros sincronizados, N com overlay editorial
  - Lista de "destinos prioritários" CRUD (LocationIds)
  - Botão "Forçar sync agora"

### Editor do roteiro

- Banner topo: "Roteiro Envision · sincronizado há 12 min · ID: 78342"
- Campos com overlay: badge `📌 Editorial` + tooltip "Editado localmente · clique pra restaurar do Envision"
- Toggle: "Modo overlay" (ON = edições viram overlay; OFF = edição direta dispara erro porque é read-only do Envision)

---

## 8. Migração — o que acontece com roteiros manuais já cadastrados

1. **Não deleta nada**. Roteiros manuais existentes (~10 docs hoje) continuam funcionando.
2. Script one-shot (`functions/migrate-bank-source-flag.cjs`):
   - Itera `roteiros_bank` collection
   - Atribui `source: 'manual'` em docs sem o campo
3. Pra cada roteiro manual, curador decide:
   - **(a)** Existe equivalente na Envision? → marcar como "deprecated, substituído por envisionId=X"
   - **(b)** Único, manual continua canônico → não mexer
   - **(c)** Manual era stub experimental → arquivar (`status: 'archived'`)
4. Cadastro manual continua na UI mas **avisos**: "Considere cadastrar diretamente no TravelAgent — economiza esforço de sincronização."

---

## 9. Fases / Timeline

### Fase 0 — Desbloqueio (semana atual)

- [ ] **CRÍTICO** Email pra Envision pedindo Trip API + senha da credencial `itinerary.primetour` (modelo já escrito)
- [ ] Definir conta de serviço dedicada (não a do Renê) pra Forms Auth fallback
- [ ] Decisão final: começar com Forms Auth OU esperar Trip API?

### Fase 1 — POC adapter (1-2 releases, ~3h)

- [ ] Script Admin SDK `functions/poc-envision-import.cjs` — login Forms Auth + 1 search + 1 detail, grava 1 doc em `roteiros_bank` com `source: 'envision'`
- [ ] Adapter `js/services/envisionAdapter.js` → `envisionItineraryToBank(envisionJson)`
- [ ] Migration script `functions/migrate-bank-source-flag.cjs`
- [ ] Renê valida resultado visualmente no Banco de Roteiros

### Fase 2 — Schema + cache (1 release, ~2h)

- [ ] Schema migration: novos campos em `roteiros_bank`
- [ ] Collections novas: `roteiros_bank_envision_cache`, `roteiros_bank_locations`, `roteiros_bank_envision_locks`
- [ ] Firestore rules atualizadas
- [ ] Indexes deployados

### Fase 3 — Cloud Functions (2-3 releases, ~6h)

- [ ] `envisionAuth.js` — encapsula auth (Forms Auth → Trip API later)
- [ ] `syncEnvisionItineraryListCron` (scheduled hourly)
- [ ] `fetchEnvisionItineraryDetail` (onCall)
- [ ] `cleanupExpiredCacheCron`
- [ ] `mirrorEnvisionImagesCron` (depois — opcional)
- [ ] Testes E2E em sandbox

### Fase 4 — UI no Banco + Gerador (2 releases, ~4h)

- [ ] Badge "fonte" nos cards
- [ ] Filtro "Fonte" na listagem
- [ ] Loading state on-demand no detalhe
- [ ] Banner sync status no editor
- [ ] Overlay editorial (campos com 📌)

### Fase 5 — Settings + observability (1 release, ~2h)

- [ ] Painel "Integração Envision"
- [ ] Botão "Forçar sync"
- [ ] CRUD de destinos prioritários
- [ ] Dashboard com stats (N sincronizados, N erros, latência média)

### Fase 6 — Migration + cutover (1 release, ~1h)

- [ ] Script migration
- [ ] Curador revisa 10 roteiros manuais existentes
- [ ] Anúncio interno: "novos roteiros entram via Envision"
- [ ] Doc atualizado

**Total estimado**: ~18h de desenvolvimento (sem contar tempo aguardando Envision responder)

---

## 10. Decisões pendentes (bloqueios)

| # | Decisão | Bloqueia | Quem decide |
|---|---|---|---|
| D1 | Forms Auth (frágil) ou esperar Trip API (correto)? | Fase 1 | Renê |
| D2 | Senha da credencial `itinerary.primetour` ou conta de serviço nova? | Fase 0 | Renê + Envision |
| D3 | URL base real da Trip API se for o caso | Fase 0 | Envision |
| D4 | Lista de "destinos prioritários" iniciais | Fase 5 | Renê |
| D5 | Política de retenção do cache (30min é OK?) | Fase 2 | Renê |
| D6 | Comportamento da UI manual: esconder cadastro novo ou só avisar? | Fase 6 | Renê |
| D7 | Mirror das imagens da Envision pro R2 (custo storage) — sim ou só URLs externas? | Fase 3 | Renê |

---

## 11. Riscos

| Risco | Severidade | Mitigação |
|---|---|---|
| Envision não tem Trip API real (apenas web app) | 🔴 Alta | Forms Auth fallback. Latente: senha rotaciona, MFA quebra. |
| Sessão Forms Auth expira em horário ruim (8h) | 🟡 Média | CF detecta 401 → re-login automático → retry 1× |
| Envision rate-limit não documentado | 🟡 Média | Throttle 1 req/seg, log warning em 429, exponential backoff |
| Mudança de shape no JSON Envision quebra adapter | 🟡 Média | Adapter defensivo (optional chaining), errorCode `envision_shape_changed` |
| Curador edita roteiro Envision → mirror sobrescreve sem overlay | 🟢 Baixa | Sistema de overlay (§6) — projeto previne |
| Custo: 100 roteiros × detalhe 120KB × N fetches/dia | 🟢 Baixa | Cache 30min reduz drasticamente. Estimar após 1 semana real. |
| Senha em código (vazamento) | 🔴 Crítica | **NUNCA** em código — Firebase Secret Manager (`ENVISION_PASSWORD`). Igual `ANTHROPIC_API_KEY`. |
| Cookie sessão exposto em logs | 🔴 Crítica | Audit log redact, console.log sanitize, `.ASPXAUTH` nunca em response.body de CF |

---

## 12. Plano de testes

### Unit / adapter

- `envisionAdapter.test.js`: 5 fixtures de roteiros Envision diferentes (Tailândia simples, Europa multi-cidade, cruzeiro, pacote sem hotel, edge `DayByDay` vazio) → asserta shape correto pro `roteiros_bank`
- Defensive: input com campos faltando → adapter retorna shape válido sem throw

### Integration / CF

- Sandbox: credencial dedicada de teste, ambiente staging Envision (se houver)
- `syncEnvisionItineraryListCron` rodado manualmente → verifica:
  - Roteiros upserted (Admin SDK script confere Firestore)
  - Stats em `audit_logs`
  - Pseudo-user `system` como `createdBy`
- `fetchEnvisionItineraryDetail` callable → testa:
  - 1ª chamada bate API → grava cache
  - 2ª chamada dentro de 30min retorna cache (sem hit Envision)
  - Forço expiry → 3ª chamada bate API novamente
  - Anti-double-submit: 5 chamadas paralelas resultam em 1 fetch externo

### E2E via Chrome MCP

- Renê logado → Banco de Roteiros → filtra "Envision" → vê N cards com badge
- Clica em 1 card → loading "buscando detalhe…" → renderiza
- Edita título (vira overlay) → reload → overlay persiste
- Botão "Restaurar do Envision" → volta título original
- Gerador IA → solicita roteiro Tailândia → roteiro Envision aparece como candidato → PDF final tem dados Envision

### Failure modes

- Envision API DOWN → mirror falha graceful, listagem ainda funciona com docs cached
- Auth expira mid-sync → CF detecta, re-login, retry
- Shape do JSON Envision muda inesperadamente → errorCode `envision_shape_changed`, alerta no Sentry/Slack
- Roteiro Envision deletado → mirror próxima sync detecta ausência → marca local como `status: 'deprecated'` (NÃO deleta, preserva histórico de uso)

---

## 13. Observabilidade

- `audit_logs`: `system.envision_sync_cron`, `roteiros_bank.envision_upserted`, `roteiros_bank.editorial_overlay`, `roteiros_bank.detail_fetched`
- `ai_usage_logs`: se o Gerador IA usar detalhe Envision, grava `envisionId` no log pra rastreabilidade
- Dashboard Analytics (aba "Integrações"): N roteiros, N syncs/dia, erros/dia, latência avg detalhe, % cache hit

---

## 14. Próximo passo imediato

**Aguardando decisões D1, D2, D3** (Renê + Envision).

Em paralelo, Claude pode adiantar:
- Migration script `migrate-bank-source-flag.cjs` (idempotente, baixo risco)
- Adapter `envisionAdapter.js` (puro, sem dependência de auth/API real — usa o fixture JSON capturado da MCP como input de teste)
- Doc técnico atualizado em `docs/ARCHITECTURE.md` (seção nova "Integração Envision")

Quando D1-D3 destravarem, **Fase 1 (POC) leva ~2h** pra ter o primeiro roteiro real importado.

---

_Doc gerado em 2026-05-26. Revisar/aprovar antes de iniciar Fase 1._
