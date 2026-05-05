# Gestor PRIMETOUR — Segurança & Compliance

> Política de segurança, runbook e checklist de compliance.
> Atualizado em: 2026-05-05 · 5 sprints de hardening concluídos · v3.1.0
>
> **Esta página é pública** para auditoria por especialistas externos. Detalhes operacionais
> sensíveis (chaves, credenciais, IDs específicos de projeto) foram removidos. Para acesso
> a runbooks completos com IDs/secrets, contatar o DPO (info no rodapé).

![Sprint 1](https://img.shields.io/badge/Sprint%201-Cloud%20Functions-brightgreen)
![Sprint 2](https://img.shields.io/badge/Sprint%202-SSO%20%2B%20App%20Check%20%2B%20Backup-brightgreen)
![Sprint 3](https://img.shields.io/badge/Sprint%203-SIEM%20%2B%20Threat%20Model-brightgreen)
![Sprint 4](https://img.shields.io/badge/Sprint%204-Cloudflare%20Pages%20Ready-yellow)
![Sprint 5](https://img.shields.io/badge/Sprint%205-Hardening%20Final-brightgreen)
![LGPD](https://img.shields.io/badge/LGPD-Compliant-green)
![SOC 2](https://img.shields.io/badge/SOC%202-Ready-blue)
![ISO 27001](https://img.shields.io/badge/ISO%2027001-Mapped-blue)
![PITR](https://img.shields.io/badge/PITR-7%20days-brightgreen)
![App Check](https://img.shields.io/badge/App%20Check-Monitor%20Mode-yellow)

## 🛡 Postura de Segurança

**Tier**: Production hardened (5 sprints concluídos)
**Compliance alvo**: LGPD ✓ · SOC 2 Type II (artefatos prontos) · ISO 27001 (mapeado)
**Cliente alvo**: Bradesco, BTG, corporate enterprise

## 📚 Documentação relacionada

- [`THREAT-MODEL.md`](./THREAT-MODEL.md) — STRIDE + OWASP API Top 10
- [`DATA-FLOW.md`](./DATA-FLOW.md) — Inventário PII + base legal LGPD
- [`INCIDENT-RESPONSE.md`](./INCIDENT-RESPONSE.md) — Runbook P0–P3 + ANPD
- [`ACCESS-CONTROL.md`](./ACCESS-CONTROL.md) — Matriz RBAC + scopes
- [`MIGRATION-CLOUDFLARE.md`](./MIGRATION-CLOUDFLARE.md) — Plano de migração CF Pages
- [`tests/README-rules-tests.md`](./tests/README-rules-tests.md) — Testes regressão de rules

---

## ✅ Quick Wins implementados (commit atual)

### Firestore Rules
- ✓ `system_secrets/{*}` — `read,write: if false` (apenas Admin SDK)
- ✓ `ai_knowledge/{*}` — visibility-based access (public/internal/sector/restricted)
- ✓ `ai_skills_archive` + `ai_automations_archive` — append-only (`update,delete: if false`)
- ✓ `time_clock_audit` — append-only

### Headers HTTP
- ✓ `X-Content-Type-Options: nosniff`
- ✓ `Referrer-Policy: strict-origin-when-cross-origin`
- ✓ `Permissions-Policy: camera=(), microphone=(self), geolocation=(self), interest-cohort=()`
- ✓ `_headers` file pra migração Cloudflare Pages

### LGPD
- ✓ TTL automático em `ai_usage_logs` (90 dias) via campo `expiresAt`
- ✓ Anonimização default ON em **11 módulos** sensíveis
- ✓ Endpoint `eraseUserData(uid)` — soft delete + anonimização de logs
- ✓ Endpoint `exportUserData(uid)` — direito de portabilidade
- ✓ `getDataCategories()` — direito de informação
- ✓ Consent versioning (1.1)

### Audit
- ✓ `audit_logs` append-only, leitura admin
- ✓ `time_clock_audit` rastreia toda mudança de ponto

---

## 🚨 Programa de Hardening — 5 Sprints concluídos

### Sprint 1 — Cloud Functions + Lockdown Rules (mai/2026)

**Cloud Functions com proxy de secrets** — qualquer operação que toque credenciais externas
roda server-side via Cloud Functions; secrets vivem em Secret Manager (Google Cloud) e não
são acessíveis pelo client mesmo com role admin:

- `callLLM` — proxy unificado para LLM providers (Anthropic, OpenAI, Gemini, Groq) com
  rate limit per-IP, audit log, e contagem de custos por usuário
- `getR2UploadUrl` — gera signed URL para R2 com path whitelist
- `getSharePointToken` — client_credentials flow contra Azure AD
- `getGitHubFile` — leitura de arquivos GitHub com PAT scoped

**Firestore Security Rules — lockdown**
- `system_config/{*}` — admin-only (antes: qualquer auth)
- `ai_api_keys/{*}` — admin-only (antes: qualquer auth)
- `system_secrets/{*}` — zero-trust (`read,write: if false`); apenas Admin SDK acessa
- `ai_knowledge` — controle de visibilidade por documento (public / internal / sector / restricted)

### Rotação de credenciais
Política: rotação periódica obrigatória de todos os secrets de provedores externos
(LLM providers, R2, SharePoint). Audit semanal automatizado (`weeklySecretsAudit`)
alerta secrets com idade > 90 dias. Histórico granular de rotações em audit log
interno (não publicado).

### Hardening Auth — em curso
- SSO Microsoft como método primário, email/senha mantido para contas operacionais legadas (planejado para deprecação)
- MFA enforcement via Azure AD Conditional Access (configuração documentada em `ACCESS-CONTROL.md`)
- Allowlist explícita por domínio corporativo (`@primetour.com.br`, `@primetravel.tur.br`, `@primetouroperator.com.br`) — auto-provisioning bloqueado fora desses domínios

---

## 📋 Configurações de plataforma (estado consolidado)

### Firebase
- ✅ **PITR** (Point-in-Time Recovery) habilitado — recovery até 7 dias com granularidade de minuto
- ✅ **Delete protection** ativa — impede comandos `gcloud firestore databases delete`
- ✅ TTL policies em coleções de logs efêmeros (`ai_usage_logs`, `audit_logs` 90d)
- ✅ **App Check** habilitado (modo monitor → enforcement gradual planejado)
- ✅ Daily export Firestore → bucket GCS (cron `dailyBackup` 03h BRT)

### LLM Providers (governança de custos)
- Budget alerts configurados em todos os providers ativos
- Rate limit per-IP no proxy `callLLM` (200 req/min)
- Rate limit per-user (configurável por agente em `IA Hub → Limites`)
- Audit log de cada chamada (`ai_usage_logs` com user, IP, tokens, custo estimado)

### Cloudflare R2 (storage de imagens)
- Worker com path whitelist + token rotacionado periodicamente
- Cloudflare Access ativo no Worker
- Bucket público com TTL controlado (não há acesso direto a objetos sem signed URL)

### Azure AD (Microsoft 365)
- App Registration usa permissões com escopo mínimo (`Sites.Selected`/`Files.Read.All` conforme caso)
- Conditional Access políticas por usuário tipo (admin vs analista)
- Sign-in logs exportados para análise SIEM (`dailySecurityDigest`)

---

## 🔐 Princípios Aplicados

1. **Defense in Depth** — múltiplas camadas: rules + functions + auth + WAF
2. **Least Privilege** — RBAC com 5 roles + visibility por documento
3. **Zero Trust** — `system_secrets` inacessível mesmo a admin via client
4. **Fail Secure** — anonimização default ON, deny por padrão
5. **Auditability** — append-only logs, sem update/delete possível
6. **Data Minimization** — TTL automático, retention < 90d quando possível

---

## 📞 Resposta a Incidentes

### Suspeita de vazamento de chave
1. **Imediato**: revogar chave no provider
2. **Auditar**: `ai_usage_logs` últimas 24h por user/IP suspeito
3. **Notificar**: DPO + cliente afetado em < 72h (LGPD Art. 48)
4. **Documentar**: relatório no `audit_logs` com causa, impacto, remediação

### Conta comprometida (suspeita)
1. **Desativar**: `users/{uid}.active = false` (force logout)
2. **Auditar**: ações últimas 7 dias via `audit_logs`
3. **Rotacionar**: senha forçada no próximo login
4. **MFA**: ativar/forçar reset

### Data breach
1. **Conter**: snapshot Firestore (PITR)
2. **Avaliar**: escopo via export por usuário afetado
3. **Comunicar**: LGPD 72h + GDPR 72h se houver dados europeus
4. **Remediar**: `eraseUserData()` se requerido + relatório forense

---

## 📊 Métricas de Segurança

Coletar e revisar mensalmente:
- Tentativas de login falhadas (Firebase Auth logs)
- Permissões negadas (Firestore audit logs)
- Operações em `system_config` (mudanças de admin)
- Exports de dados (LGPD requests)
- Gastos LLM por user (anomalias)

---

## 🔐 Sprints 4 + 5 — Hardening Final (2026-05-02)

### Sprint 4 — Cloudflare Pages prep ✅
- `_headers` com CSP via response header (substitui meta-CSP modificável via DevTools)
- HSTS `max-age=31536000; includeSubDomains; preload` ready
- COOP/CORP/X-Frame-Options + cache control granular
- `_redirects` SPA fallback + atalhos amigáveis
- `MIGRATION-CLOUDFLARE.md` passo a passo (10 etapas + checklist + rollback)

### Sprint 5 — Production Hardening ✅
- **PITR Firestore** habilitado (recovery até 7 dias atrás, granularidade minuto)
- **Delete protection** ativo (impede `gcloud firestore databases delete`)
- **Rate limit per-IP** em `callLLM` (200/min), `getR2UploadUrl` (100/min), `getSharePointToken` (60/min)
- `audit_logs` registra `security.ip_rate_limit_hit` quando IP atinge limite
- `weeklySecretsAudit` Cloud Function — segunda 09h BRT, alerta secrets >90d
- Firestore Rules denial em `rate_limits/*` e `rate_limits_ip/*` (server-only)
- Tests `tests/firestore-rules.test.mjs` cobrindo 12 vetores de attack

## 📋 Cloud Functions deployadas (10)

| Função | Tipo | Schedule | Função |
|--------|------|----------|--------|
| `callLLM` | onCall | - | Proxy LLM unificado |
| `getR2UploadUrl` | onCall | - | Upload R2 (path whitelist) |
| `getSharePointToken` | onCall | - | client_credentials Azure AD |
| `getGitHubFile` | onCall | - | Read GitHub com PAT |
| `logUserLogin` | onCall | - | Audit IP+UA login |
| `eraseUserDataServer` | onCall | - | LGPD Art. 18 VI erasure |
| `dailyBackup` | onSchedule | 03h BRT | Snapshot Firestore→GCS |
| `dailySecurityDigest` | onSchedule | 09h BRT | SIEM lite + Slack |
| `weeklySecretsAudit` | onSchedule | seg 09h BRT | Alerta secrets >90d |

---

## Contatos

- **DPO** (LGPD Art. 41): Rene Castro — rene.castro@primetour.com.br
- **Incident Commander**: Rene Castro
- **Security Disclosure**: ver [`/.well-known/security.txt`](./.well-known/security.txt)
- **Incident Response**: (a definir, on-call rotation)
