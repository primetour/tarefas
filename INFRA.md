# Gestor PRIMETOUR — Infraestrutura

> Atualizado em: 2026-05-05 · v3.1.0
> Mapa completo de todas as peças que compõem o sistema em produção.
> Use este documento para: onboarding, auditoria de custos, planejamento de migração,
> handoff (transferência) do software.
>
> **Esta página é pública** para auditoria por especialistas externos. IDs específicos
> de projeto (Cloud Function tokens, GCP project numbers) foram redatados quando não
> são informações de baixa sensibilidade. Para acesso completo, contatar o DPO.
>
> Documentos relacionados: [`GOVERNANCE.md`](GOVERNANCE.md) · [`SECURITY.md`](SECURITY.md) ·
> [`ACCESS-CONTROL.md`](ACCESS-CONTROL.md) · [`DATA-FLOW.md`](DATA-FLOW.md) ·
> [`MIGRATION-CLOUDFLARE.md`](MIGRATION-CLOUDFLARE.md)

---

## 1. Visão geral

```
┌────────────┐      ┌──────────────┐      ┌───────────────┐
│  Usuário   │─────▶│  Cloudflare  │─────▶│   Firestore   │
│ (browser)  │◀─────│   (hosting   │◀─────│ (real-time +  │
│            │      │ static files)│      │     auth)     │
└────────────┘      └──────────────┘      └───────────────┘
       │                                          ▲   ▲
       │ App Check                                │   │
       │ (reCAPTCHA Ent.)                         │   │ writes
       │                                          │   │ (callable
       ▼                                          │   │  + cron)
┌────────────────┐    callable     ┌──────────────────────────────┐
│ Cloud Functions│◀────────────────│ APIs externas:               │
│ (Node 20, 17   │─── server-side ▶│ • LLMs (Anthropic, OpenAI,   │
│  endpoints)    │   secret pulls  │   Gemini, Groq) via callLLM  │
└────────────────┘                 │ • EmailJS (sendCsatEmail)    │
       │                           │ • Cloudflare R2 (signed URL) │
       │ scheduled                 │ • SharePoint / Microsoft     │
       │ (4 crons)                 └──────────────────────────────┘
       ▼
  pruneOldAuditLogs (90d TTL)
  dailyBackup (03:00 BRT)
  dailySecurityDigest (Slack 09:00 BRT)
  weeklySecretsAudit (domingo)

  ┌───────────────┐
  │ GitHub Actions│─── fetch ───▶ GA4 / Meta Graph / Marketing Cloud
  │ (6 workflows) │
  └───────────────┘
```

> **Painel operacional ao vivo**: Configurações → Integrações mostra status, última sync e
> links pros workflows em tempo real (lê `*_meta/lastSync` de cada integração).

**Fluxo do usuário final**: passa só por Cloudflare e Firestore. GitHub não serve conteúdo pra usuários.

**Fluxo dos syncs**: GitHub Actions roda em horários agendados, puxa dados de APIs externas e grava no Firestore.

---

## 2. Stack de produção (user-facing)

| Componente | Serviço | Função | Portabilidade |
|---|---|---|---|
| **Hospedagem** | GitHub Pages (hoje) / Cloudflare Pages (planejada) | Serve HTML/JS/CSS estáticos | 🟢 Alta — copia pra Vercel/Netlify/S3 em 10 min |
| **Banco de dados** | Firestore | Dados + real-time subscriptions | 🔴 Baixa — schema proprietário, migrar é projeto |
| **Autenticação** | Firebase Auth | Login SSO Microsoft (multi-domínio) + email/senha | 🟡 Média — export de usuários, reimport em outro provider |
| **App Check** | reCAPTCHA Enterprise | Bloqueia uso do SDK Firestore/Auth fora do domínio autorizado; obrigatório no client | 🟡 Média — depende de Firebase, mas concept transfere |
| **Backend leve** | Firebase Cloud Functions (Node 20) | 17 endpoints (callable + scheduled) — proxy LLM, email, backups, audit pruning, security digests | 🟢 Alta — Node puro, portável pra Cloud Run/Lambda |
| **Frontend** | HTML/JS/CSS puro (ES modules) | Interface | 🟢 Alta — zero lock-in |
| **CDN Firebase SDK** | gstatic.com | SDK Firebase carregado via CDN | 🟢 Alta — troca URL |

**Config Firebase**: `js/config.js` — `firebaseConfig` com `apiKey` pública (segura por design; proteção real fica nas Firestore Rules em `firestore.rules` + App Check + Cloud Functions com Secret Manager).

**Domínios SSO autorizados** (auto-provisioning em `js/auth/auth.js`): `@primetour.com.br`, `@primetravel.tur.br`, `@primetouroperator.com.br`. Qualquer outro domínio é rejeitado mesmo se autenticar via Microsoft.

---

## 2.1 Páginas públicas (sem login do app)

Além do app principal (`index.html`, com login obrigatório), o sistema serve algumas páginas standalone para
audiências externas ou usos específicos:

| Arquivo | Acesso | Função |
|---|---|---|
| `index.html` | Login obrigatório | App principal — todas as páginas internas |
| `solicitar.html` | Login Microsoft (qualquer usuário Primetour) | Portal público de solicitações |
| `portal-view.html` | Sem login | Visualização read-only de portal de dicas |
| `roteiro-view.html` | Sem login | Visualização read-only de roteiro gerado |
| `calendario-conteudo.html` | Login Microsoft | Calendário de conteúdo read-only com filtros real-time |
| `csat-response.html` | Token na URL | Resposta de pesquisa CSAT (sem login) |
| `gerar-apresentacao.html` | Login obrigatório | Editor de apresentações (LP) |
| `lp.html` | Sem login | Landing pages publicadas |

---

## 3. Workflows agendados (GitHub Actions)

Total: **6 workflows**, todos em `.github/workflows/`. Cada um chama um script Node.js em `scripts/`.

### 3.1 GA4 → Firestore Sync

| Campo | Valor |
|---|---|
| **Arquivo** | `.github/workflows/ga-sync.yml` |
| **Script** | `scripts/ga-sync.js` |
| **Schedule** | Diário, 06:00 UTC (03:00 BRT) |
| **Trigger manual** | Sim (`workflow_dispatch`) |
| **Timeout** | 10 min |
| **API externa** | Google Analytics 4 Data API (`@google-analytics/data@4`) |

**Secrets necessários**:
- `GA_PROPERTY_ID` — ex: `properties/123456789`
- `GA_CLIENT_EMAIL` — service account email (GA)
- `GA_PRIVATE_KEY` — private key PEM (GA)
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL` — service account Firebase Admin
- `FIREBASE_PRIVATE_KEY` — private key Firebase Admin

**Escreve em Firestore**:
- `ga_daily` — métricas diárias agregadas (users, sessions, etc.)
- `ga_pages` — top páginas por views
- `ga_sources` — origem/mídia de tráfego
- `ga_devices` — distribuição por dispositivo
- `ga_countries` — distribuição geográfica
- `ga_properties` — propriedades GA configuradas
- `ga_meta` (doc: `lastSync`) — metadados do último sync

**Parâmetros**:
- `SYNC_DAYS` — quantos dias sincronizar (default: 90)

---

### 3.2 Marketing Cloud → Firestore Sync

| Campo | Valor |
|---|---|
| **Arquivo** | `.github/workflows/mc-sync.yml` |
| **Script** | `scripts/mc-sync.js` |
| **Schedule** | Diário, 06:00 UTC (03:00 BRT) |
| **Trigger manual** | Sim (com input `days`) |
| **Timeout** | 15 min |
| **API externa** | Salesforce Marketing Cloud REST + SOAP |

**Secrets necessários**:
- `MC_CLIENT_ID` — OAuth client ID do MC
- `MC_CLIENT_SECRET` — OAuth secret
- `MC_AUTH_URL` — `https://mcdr998fk605k8c51p7t-gc781ly.auth.marketingcloudapis.com`
- `MC_REST_URL` — `https://mcdr998fk605k8c51p7t-gc781ly.rest.marketingcloudapis.com`
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

**Business Units sincronizadas** (5 MIDs):
| ID | Nome | MID |
|---|---|---|
| `primetour` | Primetour | 546014130 |
| `btg-partners` | BTG Partners | 546015816 |
| `btg-ultrablue` | BTG Ultrablue | 546015815 |
| `centurion` | Centurion | 546015818 |
| `pts` | PTS | 546015817 |

**Escreve em Firestore**:
- `mc_performance` — performance dos envios por BU

**Parâmetros**:
- `SYNC_DAYS` — default 90 (configurável no trigger manual)

---

### 3.3 Meta Instagram → Firestore Sync

| Campo | Valor |
|---|---|
| **Arquivo** | `.github/workflows/meta-sync.yml` |
| **Script** | `scripts/meta-sync.js` |
| **Schedule** | Diário, 07:00 UTC (04:00 BRT) |
| **Trigger manual** | Sim (com input `days`) |
| **Timeout** | 15 min |
| **API externa** | Meta Graph API v25.0 |

**Secrets necessários**:
- `META_APP_ID`
- `META_APP_SECRET`
- `META_ACCESS_TOKEN` — token long-lived (60 dias; precisa renovar)
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

**Contas Instagram sincronizadas**:
- `@primetourviagens` (Primetour Viagens)
- `@icsbyprimetour` (ICs by Primetour)

**Escreve em Firestore**:
- `meta_performance` — métricas por post (reach, saved, shares, plays, etc.)
- `meta_accounts` — metadados da conta (followers_count, username, etc.)

**Parâmetros**:
- `SYNC_DAYS` — default 90

**⚠ Nota de manutenção**: `META_ACCESS_TOKEN` expira a cada ~60 dias. Precisa
renovar manualmente no Meta Business Suite e atualizar o secret no GitHub.

---

### 3.4 Portal Seed (manual, one-off)

| Campo | Valor |
|---|---|
| **Arquivo** | `.github/workflows/portal-seed.yml` |
| **Script** | `scripts/portal-seed.js` |
| **Schedule** | Nenhum — só manual (`workflow_dispatch`) |
| **Propósito** | Popular Firestore com Termos de Uso + áreas do Portal de Dicas |

**Secrets**: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`

**Escreve em Firestore**:
- `portal_terms` (doc: `v1_20250730`) — texto dos Termos de Uso
- `portal_areas/{areaId}` — lista de áreas que usam o Portal de Dicas

**Quando rodar**: após mudanças nos Termos de Uso ou cadastro inicial de áreas.
Não roda automaticamente.

---

### 3.5 Archive de tarefas antigas

| Campo | Valor |
|---|---|
| **Arquivo** | `.github/workflows/archive-tasks.yml` |
| **Script** | `scripts/archive-tasks.js` |
| **Schedule** | Dia 1 de cada mês, 03:00 UTC (00:00 BRT) |
| **Trigger manual** | Sim (com inputs `days` e `dry_run`) |
| **Timeout** | 15 min |
| **API externa** | Nenhuma (só Firestore) |

**Secrets necessários**: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`

**O que faz**: move tarefas com `status in [done, cancelled]` e `completedAt`
(ou `updatedAt`) há mais de 365 dias da coleção `tasks` para `tasks_archive`.
Mantém a lista principal leve sem perder histórico.

**Inputs manuais**:
- `days` — N dias de retenção (default 365). Use 730 pra manter 2 anos.
- `dry_run` — `1` só conta, `0` executa.

**Escreve em Firestore**:
- `tasks_archive/{taskId}` — cópia da tarefa + campo `archivedAt`
- `tasks_archive_meta/lastSync` — metadados da última execução
- Apaga da coleção `tasks` no mesmo batch

**Impacto no frontend**:
- Página de Metas (`goals.js`) já lê `tasks` + `tasks_archive` em união
  para preservar histórico anual (via `fetchArchivedTasks()` em
  `services/tasks.js`).
- Demais páginas (kanban, calendário, lista, dashboards) leem só
  `tasks` — é o comportamento desejado pra manter performance.

**⚠ Importante**: se você criar nova funcionalidade que precise de
histórico (ex: relatório de 5 anos), use `fetchArchivedTasks()` em
paralelo com `fetchTasks()` e una os arrays.

---

### 3.6 Seed AI Settings (manual, one-off)

| Campo | Valor |
|---|---|
| **Arquivo** | `.github/workflows/seed-ai-setting.yml` |
| **Script** | `scripts/ai-settings-seed.js` |
| **Schedule** | Nenhum — só manual |
| **Propósito** | Popular config de IA (tokens Meta, IG User IDs, LinkedIn) |

**Inputs manuais** (perguntados ao rodar o workflow):
- `meta_token` — token Meta Instagram
- `ig_id_primetour` — IG User ID de `@primetourviagens`
- `ig_id_ics` — IG User ID de `@icsbyprimetour`
- `li_org_id` — LinkedIn Organization ID

**Secrets** (env vars): `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`

**Escreve em Firestore**:
- `ai_settings/meta_config` — configuração Meta/Instagram
- `ai_settings/linkedin_config` — configuração LinkedIn
- `ai_settings/brand_voice_{buId}` — tom de voz por BU (primetour, btg-partners, etc.)

**Quando rodar**: após rotação de tokens Meta (a cada ~60 dias) ou alteração
de contas sociais.

---

## 4. Secrets — tabela consolidada

Existem **dois cofres separados** de secrets, com responsabilidades distintas:

### 4.1 GitHub Actions Secrets (sincs cron de dados externos)

Local: **GitHub → Settings → Secrets and variables → Actions**.
Não estão no código nem em `.env` local. Usados apenas pelos 6 workflows da §3.

| Secret | Usado por | Origem / como obter |
|---|---|---|
| `FIREBASE_PROJECT_ID` | TODOS | Firebase Console → Project settings |
| `FIREBASE_CLIENT_EMAIL` | TODOS | Firebase → IAM → Service Account → key JSON |
| `FIREBASE_PRIVATE_KEY` | TODOS | Mesmo JSON (campo `private_key`) |
| `GA_PROPERTY_ID` | ga-sync | GA4 Admin → Property details |
| `GA_CLIENT_EMAIL` | ga-sync | GCP IAM — service account com Viewer no GA4 |
| `GA_PRIVATE_KEY` | ga-sync | Service account JSON |
| `MC_CLIENT_ID` | mc-sync | Marketing Cloud → Installed Packages |
| `MC_CLIENT_SECRET` | mc-sync | Mesmo local |
| `MC_AUTH_URL` | mc-sync | URL tenant-specific (já fixada em secret) |
| `MC_REST_URL` | mc-sync | URL tenant-specific (já fixada em secret) |
| `META_APP_ID` | meta-sync | Meta for Developers → App settings |
| `META_APP_SECRET` | meta-sync | Mesmo local |
| `META_ACCESS_TOKEN` | meta-sync | Graph API Explorer — long-lived token (60d) |

### 4.2 Firebase Secret Manager (Cloud Functions)

Local: **Google Cloud Secret Manager** (gerenciado via Firebase CLI). Configurar com:
```bash
firebase functions:secrets:set NOME_DO_SECRET
```

São lidos no código via `defineSecret('NOME')` em `functions/index.js` e injetados em runtime nas Cloud Functions que declaram `secrets: [NOME]`. **Nunca aparecem no client.**

| Secret | Usado por (Cloud Function) | Propósito |
|---|---|---|
| `ANTHROPIC_API_KEY` | `callLLM` | Chamadas Claude (Opus 4.7, Sonnet 4.6) |
| `OPENAI_API_KEY` | `callLLM` | Chamadas GPT-4.1 / GPT-4o |
| `GEMINI_API_KEY` | `callLLM` | Chamadas Gemini 2.5 Flash/Pro |
| `GROQ_API_KEY` | `callLLM` | Chamadas Llama 4 / Qwen via Groq |
| `EMAILJS_SERVICE_ID` | `sendCsatEmail` | EmailJS service identifier |
| `EMAILJS_TEMPLATE_ID` | `sendCsatEmail` | EmailJS template CSAT |
| `EMAILJS_PUBLIC_KEY` | `sendCsatEmail` | EmailJS auth key (proxy server-side, nunca no client) |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | `getR2UploadUrl` | Cloudflare R2 (signed URLs para upload de imagens) |
| `SHAREPOINT_TENANT_ID`, `SHAREPOINT_CLIENT_ID`, `SHAREPOINT_CLIENT_SECRET` | `getSharePointToken` | OAuth Microsoft Graph |
| `GITHUB_PAT` | `getGitHubFile` | Token PAT pra leitura de arquivos do repo |
| `SERPER_API_KEY` | `callLLM` (web search) | Pesquisa web em tempo real |
| `SLACK_WEBHOOK_URL` | `dailySecurityDigest`, `weeklySecretsAudit` | Notificações operacionais |

> **Migração feita em mai/2026**: API keys de LLMs antes ficavam em `ai_settings/providers.*.apiKey` no Firestore (legível pelo client). Foram movidas pro Secret Manager e o client agora chama via `callLLM` (Cloud Function que valida auth + rate limit + audit). Mesmo padrão pra EmailJS (antes era SDK no client com publicKey exposto).

---

## 5. Coleções Firestore — quem escreve

Mapa inverso: dada uma coleção, qual script/origem a alimenta.

### Escritas por workflows (cron)

| Coleção | Origem | Frequência |
|---|---|---|
| `ga_daily`, `ga_pages`, `ga_sources`, `ga_devices`, `ga_countries`, `ga_properties`, `ga_meta` | `ga-sync.js` | Diária |
| `mc_performance` | `mc-sync.js` | Diária |
| `meta_performance`, `meta_accounts` | `meta-sync.js` | Diária |
| `portal_terms`, `portal_areas` | `portal-seed.js` | Manual |
| `ai_settings/*` | `ai-settings-seed.js` | Manual |
| `tasks_archive`, `tasks_archive_meta` | `archive-tasks.js` | Mensal (dia 1) |

### Escritas pelo app (frontend via Firestore SDK)

| Coleção | Módulo | Notas |
|---|---|---|
| `tasks` | Tarefas | Coração do sistema — kanban, calendário, lista |
| `tasks_archive` | Arquivamento | Read-only no app; escrito pelo cron |
| `task_types`, `task_categories`, `nucleos`, `sectors` | Configuração de tarefas | Catálogos editáveis por admin. `nucleos[].name` é referenciado por `users.nucleos[]` e `goals.nucleo` |
| `users`, `user_prefs` | Usuários | Auth + preferências. Schema setor/núcleo: ver §5.0 |
| `roles` | Perfis de acesso | RBAC editável |
| `workspaces` | Squads | Squads/projetos colaborativos |
| `projects` | Projetos | Agrupamento de tarefas |
| `requests` | Solicitações | Portal `solicitar.html` + módulo interno |
| `goals` | Metas | OKRs e tracking |
| `news_monitor`, `news_clipping` | Notícias / Clipping | Curadoria + conversão em tarefa |
| `csat_surveys`, `csat_responses` | CSAT | Pesquisas de satisfação |
| `feedbacks` | Feedbacks | 1:1, performance, etc. |
| `roteiros` | Roteiros | Gerador IA de roteiros de viagem |
| `portal_destinations`, `portal_tips`, `portal_images` | Portal de Dicas | CMS interno |
| `content_calendar` | Calendário de Conteúdo | Planejamento de posts redes sociais |
| `landing_pages` | Landing Pages | Editor de LPs |
| `arts` | Artes | Editor de assets gráficos |
| `recurring_tasks` | Tarefas recorrentes | Templates que geram tasks periodicamente |
| `notifications`, `notification_prefs` | Notificações | Sistema interno + agendamento |
| `sla_alerts`, `daily_summary`, `stale_task_nudge` | Alertas/automações | Triggers de IA |
| `audit_logs` | Auditoria | Log append-only com TTL de 90 dias (cron `pruneOldAuditLogs`); preserva `severity:critical`, `lgpd.*` e `security.*` indefinidamente |
| `settings/global` | Configurações | Doc único com config do sistema |
| `meta_posts` | Calendário (lookup) | Cache de posts Meta para sugestões IA |
| `roteiro_view_logs` | Roteiros | Tracking de visualizações públicas |

**Regras de segurança**: `firestore.rules` — controla quem pode ler/escrever
cada coleção. Todos os scripts usam `firebase-admin` (bypass das rules por
design — requer service account).

---

## 5.0 Modelo Setor → Núcleo → Usuário

Hierarquia organizacional usada em Tarefas, Metas, Equipe, Capacidade e
solicitações. **Um setor contém múltiplos núcleos; um usuário pode pertencer
a múltiplos núcleos (desde que todos sejam do mesmo setor).**

### Campos no documento `users/{uid}`

| Campo | Tipo | Descrição |
|---|---|---|
| `sector` | `string` | Setor do usuário (ex.: "Marketing e Comunicação"). Fonte única; `department` é legado/mirror |
| `nucleos` | `string[]` | **Canônico.** Núcleos aos quais o usuário pertence (nomes, não slugs). Ex.: `["Design", "Conteúdo"]` |
| `nucleo` | `string` | **Legado/mirror.** Sempre espelha `nucleos[0]` quando há núcleos. Mantido p/ retrocompat de telas antigas |
| `department` | `string` | **Legado.** Espelha `sector` quando setor é setado. Evitar novos usos |

### Helpers canônicos (`js/services/sectors.js`)

- `userNucleos(u)` → `string[]` — une `u.nucleos` + `u.nucleo` deduplicado. **Use este sempre ao ler.**
- `userInNucleo(u, name)` → `boolean` — verifica pertencimento; tolera schema legado

Consumidores: `goals.js`, `sectors.js`, `team.js`, `users.js`, `capacity.js`.

### Escrita (dual-write por retrocompat)

Em `users.js` (cadastro/edição) e `sectors.js` (modal "Membros do núcleo"):

```js
updateUserProfile(uid, {
  nucleos: ['Design', 'Conteúdo'],
  nucleo:  'Design',   // mirror = nucleos[0] || ''
});
```

`auth.js::updateUserProfile` inclui `nucleos` e `nucleo` no `adminFields`
allowlist. O modal de membros de um núcleo opera por **toggle** — adiciona/
remove apenas aquele núcleo preservando os demais.

### Cascade Setor → Núcleo

O dropdown de núcleo em Usuários e em Metas é filtrado dinamicamente pelo
setor selecionado, consumindo `store.get('nucleos')` (coleção Firestore,
não mais constante hardcoded). Mudar o setor limpa a seleção de núcleo.

### Migração

**Sem migração necessária.** Ao editar um usuário pela primeira vez após a
refatoração, o dual-write preenche `nucleos[]` a partir do `nucleo` legado.
`userNucleos()` lida com ambos os formatos durante a transição.

---

## 5.1 Provedores de IA

Configurados via `js/services/aiDataGuard.js` + Configurações → Privacidade e IA:

| Provedor | SDK / endpoint | Onde a key vive |
|---|---|---|
| Google Gemini | REST `generativelanguage.googleapis.com` | Secret Manager `GEMINI_API_KEY` (acessado via Cloud Function `callLLM`) |
| Groq | REST `api.groq.com` | Secret Manager `GROQ_API_KEY` |
| OpenAI | REST `api.openai.com` | Secret Manager `OPENAI_API_KEY` |
| Anthropic | REST `api.anthropic.com` | Secret Manager `ANTHROPIC_API_KEY` |
| Azure OpenAI | REST custom endpoint | Secret Manager `AZURE_API_KEY` + config em `ai_settings/providers.azure.{endpoint,deployment}` (não-sensível) |
| Local (Ollama) | HTTP local — `localhost:11434` | sem key (instalação local do usuário) |

> **Migração de mai/2026**: keys saíram do Firestore client-side. Hoje o client SEMPRE chama a Cloud Function `callLLM` (que valida auth + rate limit + audit + escolhe provider/model conforme prompt + injeta a key do Secret Manager). O documento `ai_settings/providers.*` ainda existe mas guarda só metadados não-sensíveis (modelos disponíveis, limites de rate, flags de habilitação).

A camada `aiDataGuard` garante:
- Anonimização de PII (e-mails, telefones, CPFs) por módulo, antes de enviar pra qualquer LLM externo.
- Lista de providers permitidos (admin define quais podem ser chamados).
- Consentimento + versão (forçar re-aceite quando muda).
- Retenção configurável dos logs de uso (30/60/90/180/365 dias).
- Modo `localPreferred` — força Ollama em módulos com dados sensíveis.

Configurar em: **Configurações → Privacidade e IA**.

---

## 5.2 Cloud Functions (Firebase)

Código em `functions/index.js` neste mesmo repositório. Deploy: `firebase deploy --only functions`. Hospedadas em `us-central1-gestor-de-tarefas-primetour.cloudfunctions.net`. Total: **17 functions** (callable + scheduled + HTTP). Setup detalhado em `functions/DEPLOY.md`.

### Callable (chamadas pelo client autenticado)

| Function | Propósito | Secrets injetados |
|---|---|---|
| `callLLM` | Proxy unificado de LLM (Anthropic, OpenAI, Gemini, Groq). Valida auth + rate limit + Data Guard + audit. Suporta web search (Serper). | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `SERPER_API_KEY` |
| `sendCsatEmail` | Envia pesquisa CSAT via EmailJS REST API server-side (substitui SDK client). Rate limit 10/5min. | `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID`, `EMAILJS_PUBLIC_KEY` |
| `getR2UploadUrl` | Gera signed URL pra upload direto em Cloudflare R2 (imagens). | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` |
| `getSharePointToken` | OAuth Microsoft Graph pra acesso a SharePoint (consulta de docs internos). | `SHAREPOINT_*` |
| `logUserLogin` | Server-side audit de login (registra IP, user-agent, timestamp). Detecta novo IP e dispara alerta. | — |
| `migrateUserToSso` | Admin-only: migra user email/senha legado pra SSO Microsoft preservando uid. | — |
| `migrateUserUidGlobal` | Admin-only: realinha uid de user que mudou domínio. | — |
| `auditAndMigrateAllSso` | Admin-only: audita todos users e propõe migrações em batch. | — |
| `repairOrphanSquadMembers` | Admin-only: detecta members em workspaces que não existem mais em `users` e remove. | — |
| `eraseUserDataServer` | LGPD Art. 18 — apaga (ou anonimiza) todos os dados do user em todas as collections. Audit log preservado com PII removida. | — |
| `getGitHubFile` | Lê arquivo do repo (read-only) — usado pra renderizar markdown em `docs.html`. | `GITHUB_PAT` |
| `fetchDestinationPhoto` | Busca foto de destino via Wikipedia/Unsplash com cache em Firestore. | — |

### Scheduled (cron via Cloud Scheduler)

| Function | Schedule | Propósito |
|---|---|---|
| `pruneOldAuditLogs` | `0 30 6 * * *` BRT (03:30 BRT) | Apaga `audit_logs` com `timestamp < now - 90 dias`, em batches de 500. Preserva `severity:critical`, `action` começando com `lgpd.` ou `security.`. Roda 30 min depois do `dailyBackup`. |
| `dailyBackup` | `0 0 6 * * *` BRT (03:00 BRT) | Export completo de Firestore para Cloud Storage. Retenção 30 dias. |
| `dailySecurityDigest` | `0 0 12 * * *` BRT (09:00 BRT) | Agrega anomalias das últimas 24h (logins suspeitos, eventos `severity:critical`, picos de custo IA) e envia via Slack webhook. |
| `weeklySecretsAudit` | `0 0 12 * * 0` BRT (domingo 09:00 BRT) | Verifica idade dos secrets no Secret Manager + tokens externos (Meta access token, MC client_secret) e alerta sobre rotação iminente. |

### HTTP (sem auth, com rate limit)

| Function | Propósito |
|---|---|
| `previewLink` | Renderiza preview Open Graph de uma URL (SSR mínimo) — usado nos cards de notícia/clipping. Cache 24h. |

### Padrões de implementação

Todas as Cloud Functions seguem:
1. **Auth**: `requireAuth(request)` valida ID token e role
2. **Rate limit**: `checkRateLimit(uid, key, max, window)` em ações que escalam
3. **Validação de input**: `if (!param) throw new HttpsError('invalid-argument', '...')`
4. **Audit log server-side** em ações críticas (LGPD, migration, erasure)
5. **Secrets via `defineSecret('XXX')`** + `secrets: [XXX]` no manifest da função
6. **CORS explícito**: `cors: ['https://primetour.github.io', 'http://localhost:5000']`
7. **Tracing**: cada function tem prefixo de log `[functionName]` pra grep em `firebase functions:log`

---

## 6. Notas de migração

Se no futuro você quiser sair de qualquer peça do stack:

### Sair do GitHub Actions (cron dos 6 workflows)

**Dificuldade**: 🟢 Baixa.
Os scripts em `scripts/*.js` são Node.js puro. Rodam em qualquer lugar.

Alternativas:
- **Firebase Cloud Functions + Scheduler** — integração máxima com Firestore.
  Custo: ~R$ 5-20/mês neste volume. Converter cada script num HTTP function
  agendado via Cloud Scheduler.
- **Cloudflare Workers + Cron Triggers** — você já usa Cloudflare.
  Tier grátis generoso. Restrição: Workers não rodam Node nativamente
  (runtime V8 isolado); precisa adaptar.
- **Google Cloud Run + Cloud Scheduler** — serverless Node.js tradicional.
  Secrets via Google Secret Manager.
- **VPS + cron** — se quiser tradicional (DigitalOcean, EC2 pequeno).

### Sair do Firestore

**Dificuldade**: 🔴 Alta. Principal lock-in do sistema.

Ingredientes:
1. Export completo via `gcloud firestore export gs://bucket/path`
2. Converter subscriptions real-time (`onSnapshot`) em WebSocket ou polling
3. Refatorar toda a camada `js/services/*` que hoje chama Firestore SDK
4. Migrar Firestore Rules pra lógica backend
5. Re-registrar usuários (migração de auth separada)

Estimativa: **projeto de semanas**, não dias.

### Sair do Cloudflare (hosting)

**Dificuldade**: 🟢 Baixa. 10 minutos.

Todo o site é estático. Copia pra Vercel, Netlify, S3+CloudFront, GitHub Pages,
ou qualquer host de arquivos estáticos. Zero alteração no código.

### Sair do GitHub (repositório)

**Dificuldade**: 🟢 Baixa. 5 minutos.

`git remote set-url origin <nova_url>` + push. Só lembre-se de recriar os
workflows no novo provedor (GitLab CI, Bitbucket Pipelines, etc.) com os
mesmos secrets.

---

## 7. Execução local dos scripts (debug / teste)

Todos os scripts rodam localmente desde que as env vars estejam setadas:

```bash
cd scripts
npm install firebase-admin@12 @google-analytics/data@4 node-fetch

FIREBASE_PROJECT_ID=gestor-de-tarefas-primetour \
FIREBASE_CLIENT_EMAIL="firebase-adminsdk-xxx@...iam.gserviceaccount.com" \
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n" \
GA_PROPERTY_ID="properties/xxxxxxxxx" \
GA_CLIENT_EMAIL="..." \
GA_PRIVATE_KEY="..." \
SYNC_DAYS=7 \
node ga-sync.js
```

**Dica**: crie um `.env.local` (já está no `.gitignore`) e use `dotenv` para
não ter que exportar variáveis toda vez.

---

## 8. Custos mensais estimados

Volume atual em produção (uso interno):

| Serviço | Plano atual | Custo estimado |
|---|---|---|
| Firestore | Spark (free tier) — migração pra Blaze prevista quando ultrapassar limites 2-3 dias seguidos | R$ 0 (free tier cobre uso atual) |
| Firebase Auth | Incluído | R$ 0 (até 50k MAU) |
| Firebase Cloud Functions | Spark — invocations limitadas | R$ 0-50/mês quando migrar pra Blaze (callLLM domina; resto é cron) |
| Firebase App Check (reCAPTCHA Enterprise) | Free quota até 10k assessments/mês | R$ 0 |
| Firebase Secret Manager | Cobrado por versão ativa de secret | R$ 5-15/mês (~13 secrets ativos) |
| GitHub Pages | Free tier | R$ 0 |
| GitHub Actions | Free tier (2.000 min/mês) | R$ 0 (uso atual ~30 min/mês) |
| Cloudflare R2 (storage de imagens) | Free tier 10 GB | R$ 0 |
| Google Analytics 4 | Free | R$ 0 |
| Meta Graph API | Free | R$ 0 |
| LLM API (Anthropic/OpenAI/Gemini/Groq) | Pay-as-you-go (Gemini/Groq tem free tier) | R$ 50-300/mês (uso real, depende de volume IA) |
| **TOTAL** | | **R$ 50-365/mês** (majoritariamente LLM) |

> **Trigger pra migrar Firestore Spark → Blaze**: ~50 usuários ativos diários OU exceder limites (50k reads / 20k writes / 20k deletes / dia) por 2 dias seguidos. Custo estimado pós-migração: ~$5-15/mês (50 users) → ~$30-60/mês (200 users). Detalhes em `docs/PERFORMANCE.md`.

---

## 9. Contatos / ownership

- **Dono do sistema**: PRIME TOUR AGÊNCIA DE VIAGENS E TURISMO LTDA
- **CNPJ**: 55.132.906/0001-51
- **Desenvolvimento**: Rene (`rene@primetour.com.br`)
- **Repositório**: https://github.com/primetour/tarefas
- **Firebase Project**: `gestor-de-tarefas-primetour`

---

_Última atualização: 2026-05-04 — incluiu hardening de mai/2026 (App Check, Secret Manager para LLM keys e EmailJS, audit_logs TTL 90d, scheduled Cloud Functions: pruneOldAuditLogs/dailyBackup/dailySecurityDigest/weeklySecretsAudit, multi-domínio SSO, página pública `calendario-conteudo.html`)._
