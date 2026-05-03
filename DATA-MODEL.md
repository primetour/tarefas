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

### `tasks`
- `id` (PK)
- `typeId` (FK → task_types)
- `variationId` (novo)
- `sector` (novo)
- `nucleos[]` (FK → nucleos)
- `status` (`not_started` | `in_progress` | `done` | `cancelled`)
- `assignees[]` (FK → users)
- `workspaceId` (FK → workspaces)
- `dueDate`, `priority`, `description`
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
- `id` (PK)
- `userId` (FK)
- `cliente`
- `destinos[]`

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
