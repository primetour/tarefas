# Gestor PRIMETOUR — Modelo de Dados (Firestore)

> Atualizado: 2026-05-03
> Compliance: SOC 2 CC8.1 (Change Management), ISO 27001 A.5.34

## Convenções

- **PK** — chave primária (id do documento)
- **FK** — referência a outra collection (ex: userId aponta pra users/{uid})
- **novo** — campo adicionado durante Sprint 1-5 (hardening de segurança)
- **TTL** — campo `expiresAt` que dispara delete automático do documento

---

## 📦 Operação

### Modelo conceitual: Setor (v4.49.54+)

**Setor** é a única abstração de divisão da empresa. Há 2 campos derivados,
diferenciados apenas pelo CONTEXTO em que o setor aparece:

| Campo técnico | Significado | Contexto |
|---|---|---|
| `task.sector` | Setor proprietário | Quem **executa** a tarefa |
| `task.requestingArea` | Setor solicitante | Quem **pediu** a demanda (entre setores) |

⚠ **Convenção**: `requestingArea` mantém o nome técnico antigo por
back-compat (tarefas históricas com esse campo populado). Na UI o label
é **"Setor solicitante"** (renomeado de "Área solicitante" em v4.49.54).

**Fonte de verdade**: a collection `sectors` (módulo Setores). Tanto o
filtro "Setor" quanto o filtro "Setor solicitante" puxam dela via
`getUserSectorOptions()` em `js/components/filterBar.js`.

`REQUESTING_AREAS` (lista hardcoded em `js/services/tasks.js`) é apenas
**fallback técnico** pra auto-provisioning de tarefas legadas e
back-compat com docs que referenciam nomes não-existentes mais no
módulo (ex: "Concierge Bradesco" foi descontinuado).

### Nomenclatura: Squad (v4.49.54+)

A subdivisão dentro de um setor foi renomeada de **"Núcleo"** para
**"Squad"** em toda a UI. O campo técnico permanece `nucleos[]` no doc
da task e a collection segue chamada `nucleos` (back-compat). Apenas
labels visíveis foram atualizadas.

### `tasks`
- `id` (PK)
- `typeId` (FK → task_types)
- `variationId` (novo)
- `sector` (novo)
- `nucleos[]` (FK → nucleos)
- `status` (`not_started` | `in_progress` | `done` | `cancelled` | `rework`)
- `assignees[]` (FK → users)
- `projectId` (FK → projects)
- `workspaceId` (FK → workspaces)
- `dueDate`, `priority`, `description`
- `clientEmail`, `clientName` (CSAT individual)
- **`isMilestone`** (4.35+) — boolean, marca task como ponto de fechamento de marco no projeto (só vale se `project.csatConfig.trigger='custom_milestones'`)
- **`csatPool`** (4.34.12+) — `pending:periodic:{typeId}:{winId}` ou `sent:...` (controla bolsão de CSAT periódico)
- **`csatFiredAt`** (4.35+) — anti-duplicação de disparo de marco
- `linkComprovacao` — link de evidência da entrega
- `comments[]` (subcollection)

### `task_types`
- `id` (PK)
- `name`, `description`
- `sector` (novo)
- `nucleos[]` (FK)
- `variations[]` (novo) — `{ id, name, slaDays }[]`
- `scheduleSlots[]` (novo)
- `steps[]` — etapas do fluxo
- `deliveryStandard` (novo)
- **`csatConfig`** (4.31+) — `null` ou `{ enabled, mode: 'individual' | 'periodic' | 'milestone', period: 'weekly'|'biweekly'|'monthly', dayOfWeek (0-6), timeOfDay 'HH:mm' (4.34.12+), periodLabel, customMessage, questions[]: [{id, label, type: 'score'|'text'|'yesno', required}] }`
- **Override**: se `task.projectId` aponta pra projeto com `project.csatConfig.enabled=true`, o projeto **substitui** essa config (4.35+).

### `requests` (portal público)
- `id` (PK)
- `typeId` (FK)
- `variationId` (novo)
- `sector` (novo)
- `requestingArea`
- `outOfCalendar` (novo)
- `status` (`new` | `triaging` | `converted` | `rejected`)
- `rejectionNote` (novo)

### `nucleos`
- `id` (PK)
- `name`
- `sector` (FK → setores)
- `active`

### `task_categories`
- `id` (PK)
- `name`
- `sector` (novo)
- `color`, `icon`

### `projects` (4.35+ campos novos)
- `id` (PK)
- `name`, `description`, `icon`, `color`
- `status` — `planning` | `active` | `always_on` | `on_hold` | `completed` | `cancelled`
- `members[]` (FK → users)
- `workspaceIds[]` (FK → workspaces, multi-squad B5p+)
- `sector` (FK)
- `startDate`, `endDate`
- **`csatConfig`** (4.35+) — `null` ou `{ enabled, trigger: 'on_close' | 'custom_milestones' | 'manual_only', clientEmail, questionsSource, taskTypeId, questions[], customMessage }`
- **`lastCsatFiredAt`** (4.35+) — controle de janela de CSAT
- `taskCount`, `doneCount`
- `archived`

### `csat_surveys` (4.31-4.35 evolução completa)
- `id` (PK)
- `taskId`, **`taskIds[]`** (4.32+ milestone/periodic agrupado)
- `taskTypeId` (snapshot)
- `projectId`, `projectName`
- `clientEmail`, `clientName`
- **`questions[]`** (4.31+) — snapshot do `csatConfig.questions` no envio
- **`responses{}`** (4.31+) — `{ [questionId]: value }`
- `score` (decimal 1.0-5.0, 4.35+ aceita `4.5` etc; antes era inteiro)
- `comment`
- **`csatMode`** — `individual` | `periodic` | `milestone`
- **`csatTrigger`** (4.35+) — `close` | `milestone` | `manual` (quando vem de projeto)
- **`csatPool`** (4.34.12+) — `pending:periodic:{typeId}:{winId}` ou `sent:...`
- `status` — `pending` | `sent` | `responded` | `expired` | `cancelled`
- `token`, `expiresAt`, `sentAt`, `respondedAt`

### `csat_periodic_runs` (4.34.12+)
- `id` = `{typeId}_{winId}` (lock atômico)
- `typeId`, `winId`, `poolKey`
- `startedAt`, `startedBy{}`, `status` (`processing` | `done` | `empty`)
- `surveysCreated`, `finishedAt`
- **Função**: idempotência do disparo periódico — primeiro processo a criar o doc ganha; outros viram no-op.

### `users`
- `id` (PK)
- `role` / `roleId` (`master` | `admin` | `manager` | `coordinator` | `member` | `partner`)
- `sector` (FK)
- `nucleos[]` (novo)
- `visibleSectors[]` (admin only)
- `privacy{}` (novo) — consent IA, anonimização, etc

---

## 🤖 IA Hub

### `ai_agents`
- `id` (PK)
- `name`
- `provider` (novo) — `anthropic` | `openai` | `gemini` | `groq`
- `model` (novo)
- `systemPrompt`
- `skills[]` (FK → ai_skills)
- `limits.maxCostPerDayUsd` (novo)

### `ai_skills`
- `id` (PK)
- `name`
- `instructions`
- `module` — vinculação a módulo do sistema

### `ai_knowledge`
- `id` (PK)
- `title`
- `source` (novo) — `manual` | `sharepoint` | `github`
- `sector` (FK)
- `visibility` (novo) — `public` | `internal` | `sector` | `restricted`

### `ai_chat_history`
- `id` (PK)
- `userId` (FK)
- `agentId` (FK)
- `messages[]`
- `expiresAt` (TTL — 90 dias)

### `ai_usage_logs`
- `id` (PK)
- `userId` (FK)
- `agentId` (FK)
- `inputTokens`, `outputTokens`
- `totalCostUsd` (novo)
- `expiresAt` (TTL — 90 dias)

### `ai_api_keys`
- `provider` (PK)
- `(somente admin lê — Sprint 2 lockdown)`

---

## 🛡 Segurança & Auditoria

### `audit_logs`
- `id` (PK)
- `action` (novo) — ex: `auth.login`, `security.ip_rate_limit_hit`, `lgpd.erasure`
- `userId` (FK)
- `ip` (novo) — server-side capture
- `userAgent` (novo)
- `severity` (novo) — `info` | `warning` | `critical`
- `expiresAt` (TTL — 180 dias)

**Imutabilidade**: `update`/`delete` deny all (forensics-safe).

### `rate_limits` (per-user)
- `uid__key` (PK) — ex: `abc123__callLLM`
- `calls[]` (novo) — array de timestamps
- (server-only — client deny all)

### `rate_limits_ip` (per-IP, anti-DDoS)
- `ip__key` (PK)
- `calls[]` (novo)
- (server-only)

### `system_secrets`
- `(deny all read — zero-trust)`
- `(server SDK only — bypassa rules)`

### `system_config`
- `id` (PK)
- `(admin only)` — settings globais

### `lgpd_requests`
- `id` (PK)
- `userId` (FK)
- `type` (novo) — `export` | `erasure`
- `status` (novo) — `pending` | `processing` | `fulfilled`
- `fulfilledAt` (novo)

---

## 👥 CLT & Pessoas

### `time_clock`
- `id` (PK)
- `userId` (FK)
- `punches[]` — `{ time, type }[]`
- `date`

### `time_clock_audit`
- `id` (PK)
- `userId` (FK)
- `action`
- `(append-only, retenção 5 anos por exigência CLT)`

### `vacations`
- `id` (PK)
- `userId` (FK)
- `startDate`
- `days`
- `status` — `requested` | `approved` | `taken`

### `absences`
- `id` (PK)
- `userId` (FK)
- `startDate`, `endDate`
- `type`

### `feedbacks`
- `id` (PK)
- `fromUid` (FK)
- `toUid` (FK)
- `kudos | concern`
- **Escopo**: gestão de pessoas (manager → subordinado, 1:1)

### `system_feedback` (4.35.3+)
- `id` (PK)
- `type` — `bug` | `suggestion` | `question` | `praise`
- `message` (≤ 2000 chars)
- `page` — hash da rota onde o user estava
- `appVersion`, `userAgent`
- `authorUid` (FK), `authorName`, `authorEmail`, `authorRole`
- `status` — `new` | `analyzing` | `in_progress` | `resolved` | `rejected`
- `adminResponse` (≤ 1000 chars, anotação interna)
- `resolvedAt`, `createdAt`, `updatedAt`
- **Escopo**: feedback **sobre o sistema** (NÃO confundir com `feedbacks`).
- **Trigger**: `onSystemFeedbackCreate` envia email via Microsoft Graph
  pra `rene.castro@primetour.com.br` no momento da criação.
- **Rules**: auth cria próprio (authorUid bate), admin lê/edita, master deleta.

### `goals`
- `id` (PK)
- `userId` (FK)
- `kpis[]`
- `status`

---

## 📱 Marketing & Conteúdo

### `content_calendar`
- `id` (PK)
- `title`
- `platform` (novo) — `instagram` | `facebook` | etc
- `scheduledDate`
- `description` (novo)
- `status`

### `portal_tips`
- `id` (PK)
- `destino` (FK)
- `format`
- `materials[]`

### `portal_images`
- `id` (PK)
- `url`
- `country` (FK)
- `tags[]`

### `roteiros`

Schema canônico em `js/services/roteiros.js` → `emptyRoteiro()`. Migration on-read em `migrateRoteiroOnRead()` garante shape pra docs antigos.

- `id` (PK auto)
- `consultantId` (FK → `users.uid`) — dono primário do roteiro. **Obrigatório no create** (Firestore rule `firestore.rules:841` exige `request.resource.data.consultantId == request.auth.uid`).
- `consultantName` — denormalizado pra evitar join no listing
- `collaboratorIds[]` — UIDs com permissão de edição (Sprint 1 hardening v4.40.31+)
- `status` — `draft` | `review` | `sent` | `approved` | `archived` (pipeline funcional via UI dropdown no header do editor desde v4.49.103; cada transição usa `updateRoteiroStatus` com audit log embutido).
- `workflowMode` — `system` (gera tasks operacionais auto) | `offline`
- `areaId` (FK → `areas.id`) — BU pro branding do export (PDF/PPTX/DOCX)
- `title` — título do roteiro
- `client{ name, email, phone, type, preferences[], restrictions[], economicProfile, notes }` — bloco unificado **Cliente + Briefing** (fusão v4.49.86 — antes havia bloco `briefing` separado e redundante)
  - `type` — `individual` | `couple` | `family` | `group`
  - `preferences[]` — multi-pill ("Gastronomia", "Cultura", "Aventura", "Relaxamento", "Compras", "Natureza")
  - `restrictions[]` — multi-pill ("Mobilidade reduzida", "Restrição alimentar")
  - `economicProfile` — `standard` | `premium` | `luxury`
- `travelers[]` — lista de viajantes (substituiu `client.adults`/`children`/`childrenAges` na v4.41.0). Cada item: `{ id, name, age, isLead, doc, notes }`. Migration on-read deriva de campos legados se ausente.
- `travel{ startDate, endDate, nights, destinations[] }`
  - `destinations[]` — `{ city, country, nights }`
- `days[]` — dia a dia. Cada item: `{ dayNumber, date, city, title, narrative, overnightCity, activities[], imageIds[] }`
- `flights[]` (v4.49.91+) — voos da viagem. Cada item: `{ airline, flightNumber, originCity, destinationCity, departureDate, departureTime, arrivalDate, arrivalTime }`. **Operacional** — não é populado pela IA (agent prompt v3 instrui a deixar vazio). Renderizado em PDF (AÉREO section), PPTX (slide AÉREO), DOCX (Aéreo header) e link público (`roteiro-view.html` section #sec-aereo).
- `hotels[]` — `{ city, hotelName, roomType, regime, checkIn, checkOut, nights, notes }`
- `pricing` — refatorado em v4.49.101+ pra suportar valores por categoria com visibilidade granular. Shape atual:
  - `currency`, `validUntil`, `disclaimer` (públicos, no PDF/link)
  - `perPerson`, `perCouple`, `customRows[]` — **legado** pré-v101, preservado pra retrocompat. Renderers fazem fallback se `services` vazio.
  - `services` (novo, v4.49.101+):
    - 5 arrays por categoria: `aereo`, `hoteis`, `traslados`, `experiencias`, `servicosAdicionais`
    - Cada item: `{ description, supplier, supplierVisibleToClient, value, notes, visibleToClient }`
    - `displayMode` — `'total'` (cliente vê só o somatório dos visíveis) | `'grouped'` (cliente vê subtotais por categoria)
    - `notesGeral` — observação interna geral
  - **Garantia LGPD/comercial**: `supplier`, `notes`, e items com `visibleToClient=false` **NUNCA** aparecem em PDF/DOCX/PPTX/link público. Helpers compartilhados `_hasPricingContent` + `_buildServicesRows` em `js/services/roteiroGenerator.js` centralizam essa regra (v4.49.102+).
- `costPricing{ perPerson, perCouple, currency, notes, customRows[] }` — **interno** (custo real), strip via `stripInternalFields()` antes de export pro cliente. Só visíveis com permission `roteiro_view_cost` ou master.
- `optionals[]`, `includes[]`, `excludes[]`
- `payment{ deposit, installments, deadline, notes }`
- `cancellation[]` — `{ period, penalty }`
- `importantInfo{ passport, visa, vaccines, climate, luggage, flights, customFields[] }` — info pro cliente (ressalvas regulatórias). NOTA: `importantInfo.flights` é **regulatório** (regras de bagagem, peso etc.), não confundir com o array `flights[]` (voos reais cadastrados).
- `embeddedTips[]` — snapshots de dicas do Portal de Dicas (anexadas auto via `scheduleAutoAttachTipsForCountry` em v4.49.93 quando user digita country no destino).
- `images{ hero, overrides{} }` — overrides manuais (override.hero, override.city_${normKey}, override.hotel_${idx}). Sem override, geração resolve via cascata banco → Unsplash → Wikipedia. Preview thumb em editor implementado v4.49.93.
- `enrichedImages{ heroUrl, byCity{}, byHotel{}, usedUrls[] }` — cache resolvido pelo `enrichRoteiroImages()` quando gera link público (Sprint 6a Phase 2).
- `aiGeneration{ enabled, sources[], citations[], queries[], aiSourcesFromAgent[], destinationSuggestions[], promptVersion, generatedAt, lastInput, consultantNotes, webSearchCount, inputTokens, outputTokens }` — trilha de auditoria da geração via agente Claude (`roteiros-luxo-gen`, Sonnet 4.5 com web_search restrito a Virtuoso/FHR/LHW).
- `linkedTaskIds[]` + `tasksGeneratedAt` (v4.43.0+ Sprint 4) — IDs de tasks operacionais geradas a partir do roteiro aprovado.
- `createdAt`, `createdBy`, `updatedAt`, `updatedBy`

### `roteiro_generations_queue` (v4.49.109+)

Fila assíncrona pra geração de roteiros via IA. Client cria doc com `status='queued'`,
Cloud Function `processRoteiroQueue` (onDocumentCreated, maxInstances=5, concurrency=1)
claima via lease transaction, executa chunking ou single-shot, grava `result`. Client
escuta via `onSnapshot`.

- `id` (PK auto)
- `userId` (FK → `users.uid`) — dono. Rule: create/read/delete só dono; update FALSE.
- `briefingMessage`, `totalDias`, `useChunking`
- `status` — `queued` | `processing` | `done` | `failed`
- `phase`, `phaseLabel`, `progress { current, total }`
- `claimedAt`, `workerId` — lease pattern (idempotência)
- `result { text, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, webSearchCount, webSearchResults[], webSearchQueries[], citations[], phases }`
- `error`, `createdAt`, `completedAt`

### `roteiros_bank` (v4.50.0+) — Banco de Roteiros (curadoria)

**Módulo novo**. Roteiros curados da empresa (estilo "Classic Collection"). Schema
em `js/services/roteiroBank.js` → `emptyRoteiroBank()` + `migrateRoteiroBank()`.
Distinto de `roteiros` (que são cotações de cliente). Futuro v4.51+: IA usa como base
de conhecimento (`aiUsable` flag).

- `id` (PK auto)
- `title`, `subtitle`, `code` (auto), `slug` (auto), `collectionLabel`
- `status` — `draft` | `review` | `approved` | `archived`
- `validity { startDate, endDate, notes }` — controle de equipe; expira badge "Expirado"
- `shortDescription`, `longDescription`
- `geo { continents[], countries[], cities[], destinationIds[] }` — cities = `[{ city, country, continent, nights }]`. Auto-vinculado a `portal_destinations` via `ensureDestination()` no save.
- `durationDays`, `durationNights`
- `days[]` — `[{ dayNumber, city, title, narrative, overnightCity, flightLeg }]`
- `categories[]` — categorias de hospedagem (Sugestão Prime / Luxo / Standard / Moderado). Cada item: `{ key, label, notes, hotels: [{ city, name, roomType, nights, supplierUrl }], pricing: [{ period: { start, end }, single, double, currency }] }`
- `includes { hospedagem[], traslados[], passeios[], assistencia[], aereoInterno[], trem[], outros[] }`
- `excludes[]`
- `payment { terrestrial, aerial, deposit{ amount, currency, perPerson, notes }, settlement }`
- `cancellation[]` — `[{ fromDays, multaPercent, notes }]`
- `documentation { passport, minors, visas[], vaccines }` — visas = `[{ country, required, notes }]`
- `travelNotes[]`
- `images { hero, gallery[], overrides{} }`
- `source { type, originalFile, importedAt, importedBy, llmTokens{ input, output } }` — type: `manual` | `pdf_import` | `pdf_import_seed` | `api_import`
- `tags[]`, `aiUsable`
- `createdAt`, `createdBy`, `updatedAt`, `updatedBy`, `approvedAt`, `approvedBy`

**Permissões**: read pra qualquer `isAuth()`; write requer `portal_destinations_manage` / `portal_manage` / master. Apenas master pode deletar (hard); demais usam `archiveRoteiroBank()`.

### `roteiro_bank_categories` (v4.50.0+)

Categorias de hospedagem do Banco (CRUD via modal inline no editor desde v4.50.1).
Defaults em `DEFAULT_CATEGORIES` (Sugestão Prime, Luxo, Luxo Standard, Luxo Moderado).

- `id` (== `key`, slug)
- `label`, `order`, `color`, `builtin` (boolean — defaults bloqueados com 🔒 no modal)

### `roteiro_bank_collections` (v4.50.1+)

Coleções (marca curatorial) do Banco — Classic / Exclusive / Corporate. CRUD via
modal inline no editor (mesma UX das categorias). Defaults em
`DEFAULT_COLLECTIONS`.

- `id` (== `key`, slug)
- `label`, `order`, `color`, `builtin`

### `landing_pages`
- `id` (PK)
- `slug`
- `sections[]`
- `publishedAt`

### `cms_pages`
- `id` (PK)
- `path`
- `html`
- `seo`

---

## 📨 Newsletters (Salesforce Marketing Cloud sync)

### `mc_performance`
Performance + conteúdo dos disparos sincronizados das 5 BUs do SFMC
(Primetour, BTG Partners, BTG Ultrablue, Centurion, PTS).

- `id` = `<buId>__<jobId>` (PK composite)
- `jobId` — ID original do SFMC
- `buId` — `primetour` | `btg-partners` | `btg-ultrablue` | `centurion` | `pts`
- `buName` — label da BU
- `name` — código interno (ex: `P0224`, `U0225`)
- `subject` — assunto do email
- `sentDate` — timestamp do disparo
- `totalSent`, `openUnique`, `clickUnique`, `optOut` — métricas crus
- `openRate`, `clickRate`, `deliveryRate` — taxas derivadas (%)
- `hardBounce`, `softBounce`, `blockBounce` — bounces
- `htmlText` — texto extraído do HTML (até 30k chars; truncado nos uses)
- `imageUrls[]` — top 5 imagens extraídas via regex no HTML
- `noArtReason` — `csat` | `warmup` | `test` | `pending` (categorização dos sem-arte)
- `extracted{}` — enriquecimento (ver subschema abaixo)

#### `extracted` subschema (populado por `enrich-content.js` + classifiers)

**Enriquecimento determinístico** (`enrich-content.js`):
- `cities[]`, `countries[]`, `hotels[]`, `brands[]`, `cruises[]`, `themes[]`
- `targetAudience[]`, `newsletterType`
- `confidence` — `high` | `medium` | `low`

**Classificação dupla** (`classify-content.js`, regex determinístico):
- `commercial` — `sazonal` | `promocao` | `parceiro` | `inspiracional`
- `tourism` — `evento` | `aereo` | `roteiro` | `servico` | `hotelaria`
  | `cruzeiro` | `produto` | `destino` | `outros`

**Shadow mode IA** (v4.49.41+, `classify-content-ai.js` — campos paralelos
NÃO sobrescrevem os de produção):
- `aiCommercial`, `aiTourism` — mesma taxonomia, output do LLM
- `aiConfidence` — `high` | `medium` | `low`
- `aiReasoning` — string ≤400 chars com gatilho que decidiu
- `aiModel` — ex: `claude-haiku-4-5`
- `aiAgentVersion` — hash sha1(model+systemPrompt), 12 chars
- `aiClassifiedAt` — ISO timestamp
- `aiAgreesCommercial`, `aiAgreesTourism` — bool (vs regex de prod)
- `aiCostUsd` — custo estimado da chamada

**Decisão humana** (v4.49.42+, click em "IA certa / regex certo" no dashboard):
- `humanDecisionCommercial`, `humanDecisionTourism` — `ai-correct` | `regex-correct`
- `humanDecisionCommercialAt`, `humanDecisionTourismAt` — ISO timestamp
- `humanDecisionCommercialBy`, `humanDecisionTourismBy` — uid ou email

**Cutover backup** (v4.49.42+, populado por `promote-ai-to-prod.js`):
- `commercialPrev`, `tourismPrev` — valor antigo do regex (pra rollback)
- `commercialPromotedAt` — ISO timestamp
- `promotedFromConfidence` — confiança usada no cutover
- `commercialSource` — ex: `ai-<aiAgentVersion>`

### `nl_ai_classifier_runs` (v4.49.41+) — append-only via Admin SDK
Resumo de cada execução do `scripts/classify-content-ai.js`.

- `runAt` — serverTimestamp
- `agentId`, `agentVersion`, `model`
- `classified`, `errors`, `elapsedMs`
- `inputTokens`, `cacheReadTokens`, `outputTokens`, `costUsd`
- `agreesCommercial`, `agreesTourism`, `agreesBoth` — counts
- `concordanceCommercialPct`, `concordanceTourismPct`, `concordanceBothPct`
- `commercialDist{}`, `tourismDist{}`, `confDist{}` — histogramas
- `disagreementsCommercialSample[]`, `disagreementsTourismSample[]` — top 10
- `triggeredBy` — `github-actions:<runId>` | `local`

### `nl_classifier_promotions` (v4.49.42+) — append-only via Admin SDK
Audit de cada cutover (`scripts/promote-ai-to-prod.js`).

- `promotedAt` — serverTimestamp
- `total`, `changedCommercial`, `changedTourism`, `bothSame`
- `minConfidence`, `eixo`
- `triggeredBy`, `samples[]` (até 15 mudanças exemplo)

### `nl_classifier_rollbacks` (v4.49.42+) — append-only via Admin SDK
Audit de cada reversão (`scripts/rollback-ai-classification.js`).

- `rolledBackAt` — serverTimestamp
- `total`, `errors`, `missingBackup`
- `sinceFilter` (ISO opcional)
- `triggeredBy`, `samples[]`

### Outras collections SFMC

- `mc_image_extractions` — cache de extração de imagens via Vision API

---

## TTL Policy (auto-delete)

| Collection | Retenção | Configurada via |
|------------|----------|-----------------|
| `audit_logs` | 180 dias | TTL field `expiresAt` |
| `ai_chat_history` | 90 dias | TTL field `expiresAt` |
| `ai_usage_logs` | 90 dias | TTL field `expiresAt` |
| `notifications` | 30 dias | TTL field `expiresAt` |
| `time_clock_audit` | **5 anos** | manual (CLT obrigação) |

Ver `scripts/setup-firestore-ttl.md` pra comandos `gcloud firestore fields ttls update`.

---

## Index Composites

Definidos em `firestore.indexes.json`. Principais:

- `absences(userId, startDate)`
- `csat_surveys(taskId, createdAt DESC)`
- `nucleos(sector, name)`
- `projects(workspaceId, status, dueDate)`
- `ai_usage_logs(agentId, timestamp)` ← Sprint 5 (corrige bug callLLM)
- `audit_logs(userId, timestamp DESC)`

---

## Versionamento

- **v1.0** (2026-05-03): primeira versão, extraída do tab "Modelo de dados" do Sobre o Sistema.
- Owner: Rene Castro
