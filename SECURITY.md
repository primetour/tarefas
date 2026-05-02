# PRIMETOUR — Segurança & Compliance

> Política de segurança, runbook e checklist de compliance.
> Atualizado em: 2026-05-02 · Quick Wins fase aplicada.

## 🛡 Postura de Segurança

**Tier**: Beta hardening (Sprint 1 em execução)
**Compliance alvo**: LGPD ✓ · SOC 2 Type II (em construção) · ISO 27001 (planejado)
**Cliente alvo**: Bradesco, BTG, corporate enterprise

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

## 🚨 Sprint 1 — DEPLOYADO em produção (2026-05-02)

### Cloud Functions ✅
- [x] `callLLM()` — proxy provider, keys 100% Secret Manager. Validado live: "ok" em 1.4s, `secured:true`
- [x] `getR2UploadUrl()` — token Secret Manager + path whitelist
- [x] `getSharePointToken()` — client_credentials flow, secret env
- [x] `getGitHubFile()` — PAT env, repos públicos OK sem token

### Lockdown Firestore Rules ✅
- [x] `system_config/{*}` — `read,write: if isAdmin()` (era auth)
- [x] `ai_api_keys/{*}` — `read,write: if isAdmin()` (era auth)
- [x] `system_secrets/{*}` — `if false` (zero-trust)
- [x] `ai_knowledge` — visibility-based (public/internal/sector/restricted)

### Pendentes Sprint 1.5 (rotação)
- [ ] Anthropic: gerar nova key + revogar atual (placeholder atual)
- [ ] OpenAI: idem (placeholder atual)
- [ ] **Gemini**: revogar `AIza...UFrtDM` (vazou no chat) + nova
- [ ] **Groq**: revogar `gsk_...XgE` (vazou no chat) + nova
- [ ] R2 Worker token: regenerar token, atualizar Worker + secret
- [ ] SharePoint: criar app registration + setar 3 secrets

### Hardening Auth (Sprint 2)
- [ ] Forçar SSO Microsoft (desabilitar email/senha)
- [ ] MFA enforcement no Azure AD Conditional Access
- [ ] Allowlist explícita (sem auto-provisioning livre)

---

## 📋 Checklist do Admin (manual)

### Firebase Console
- [ ] Habilitar **PITR** (Point-in-Time Recovery): Firestore → Backups → Enable
- [ ] Configurar TTL policies: ver `scripts/setup-firestore-ttl.md`
- [ ] Habilitar **App Check** (mitiga abuse de SDKs Firebase)
- [ ] Daily export: Firestore → Backups → Schedule daily → bucket GCS

### LLM Providers (rotação + budget)
- [ ] Anthropic: revogar key atual + gerar nova + setar budget alert ($100/mês)
- [ ] OpenAI: idem + Usage Limits → Soft limit $50/mês
- [ ] Google AI Studio: regenerar Gemini key
- [ ] Groq: regenerar key (free tier mas auditável)

### Cloudflare R2
- [ ] Worker `primetour-images.rene-castro.workers.dev`: regenerar `X-Upload-Token`
- [ ] Habilitar **Cloudflare Access** no Worker
- [ ] Bucket: limitar Public Access → trocar por signed URLs

### Azure AD (Microsoft 365)
- [ ] App Registration "PRIMETOUR IA Hub":
  - [ ] API permissions → Sites.Selected (não Sites.Read.All — escopo mínimo)
  - [ ] Conditional Access policy → IP allowlist da Cloud Function
  - [ ] Certificate-based auth (substitui client secret quando possível)
- [ ] User SSO:
  - [ ] Habilitar MFA obrigatório
  - [ ] Conditional Access: bloqueio fora do Brasil + horário comercial
  - [ ] Sign-in logs export → SIEM

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

## Contatos

- **DPO**: (a definir)
- **Security Lead**: (a definir)
- **Incident Response**: (a definir, on-call rotation)
