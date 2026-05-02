# PRIMETOUR — Threat Model (STRIDE)

> Atualizado: 2026-05-02
> Owner: Rene Castro (rene.castro@primetour.com.br)
> Padrão: Microsoft STRIDE + OWASP Top 10 / API Top 10

## Sistema

PRIMETOUR é uma plataforma SaaS interna de gestão de tarefas + IA Hub corporativo,
servindo ~30 usuários da Primetour Viagens. Acessa SharePoint corporativo
(Office 365 tenant primetour.com.br), processa dados de clientes (PII),
e roteia chamadas pra LLMs (Anthropic/OpenAI/Gemini/Groq).

### Componentes
- **Frontend**: SPA estática hospedada no GitHub Pages (`primetour.github.io/tarefas`)
- **Backend**: Firebase Cloud Functions Gen 2 (callLLM, getR2UploadUrl, getSharePointToken, logUserLogin, eraseUserDataServer, dailyBackup, dailySecurityDigest)
- **DB**: Cloud Firestore (multi-region nam5, ~50MB)
- **Storage**: Cloudflare R2 (logos, imagens públicas)
- **Auth**: Firebase Auth + Microsoft SSO (tenant primetour.com.br)
- **Backup**: GCS bucket `gestor-de-tarefas-primetour-backups` (NEARLINE→COLDLINE→ARCHIVE→DELETE@365d)

---

## Trust Boundaries

```
[Browser usuário] --HTTPS+CSP+AppCheck--> [GitHub Pages SPA]
                                              |
                                              v
              [Firebase Auth (MS SSO)] --token JWT--> [Cloud Functions]
                                                          |
              +-------+--------+-------------+---------+--+
              |       |        |             |         |
              v       v        v             v         v
        [Firestore] [GCS]  [LLM APIs]  [SharePoint]  [R2]
        rules+IAM   IAM    secrets      OAuth        JWT
```

Limites confiáveis:
- Browser → Pages: TLS + CSP + App Check (reCAPTCHA Enterprise) ✅
- Pages → Functions: HTTPS Callable + Firebase Auth JWT ✅
- Functions → APIs externas: secrets via Secret Manager ✅
- Firestore: rules + role-based ACLs + visibility scopes ✅

---

## STRIDE por componente

### S — Spoofing (impersonação)
| Risco | Mitigação | Status |
|-------|-----------|--------|
| Atacante se passa por usuário Primetour | Firebase Auth + MS SSO obrigatório (tenant=primetour.com.br) | ✅ |
| Bot/script chama Cloud Functions | App Check (reCAPTCHA Enterprise) | ✅ monitor |
| Cookie session hijack | Firebase ID token rotation 1h | ✅ |
| Phishing pra obter SSO | MFA enforced via Azure AD Conditional Access | ⚠ admin manual |

### T — Tampering (modificação)
| Risco | Mitigação | Status |
|-------|-----------|--------|
| User modifica registros de outros | Firestore rules: `request.auth.uid == resource.data.userId` | ✅ |
| User escala privilégio (role admin) | Rules: campo `role` write-only por master | ✅ |
| Modify audit logs | `audit_logs` write-only (sem update/delete) | ✅ |
| Modify CSP via DevTools | meta-CSP é client-side, próximo passo: response header via Cloudflare | ⚠ TODO |

### R — Repudiation (negação)
| Risco | Mitigação | Status |
|-------|-----------|--------|
| User nega ter feito ação | `audit_logs` server-side com IP+UA+timestamp | ✅ |
| Admin nega ter deletado dados | `eraseUserDataServer` log com requesterId | ✅ |
| Tampering em log local | Logs gravados via Cloud Function (não pelo client) | ✅ |

### I — Information Disclosure (vazamento)
| Risco | Mitigação | Status |
|-------|-----------|--------|
| API keys no client | Secret Manager + Cloud Functions proxy | ✅ |
| PII vazado pra LLM | `aiDataGuard.js` anonimiza emails/CPFs/CNPJs | ✅ |
| Cross-tenant via Firestore | Rules: `userDoc().visibleSectors` para filtros | ✅ |
| Dump de prod via export | `system_secrets` collection com `allow read: if false` | ✅ |
| Backups expostos publicamente | GCS bucket privado, IAM serviceAccount only | ✅ |

### D — Denial of Service
| Risco | Mitigação | Status |
|-------|-----------|--------|
| Spam de chamadas LLM (bill bomb) | Rate limit Firestore atomic + cap diário $/user | ✅ |
| Storage R2 abuse | JWT signed URL, expira em 1h | ✅ |
| Firestore connection flood | Cache persistente IndexedDB (reduz reads) | ✅ |
| Cloud Functions DoS | maxInstances:50 por função, App Check enforce (futuro) | ⚠ |

### E — Elevation of Privilege
| Risco | Mitigação | Status |
|-------|-----------|--------|
| User member acessa rota admin | `store.can(perm)` check em todas rotas | ✅ |
| Bypass via direct Firestore call | Security rules duplicam check no servidor | ✅ |
| Account takeover via SSO | Tenant restrito + login_hint vazio | ✅ |
| Privilege escalation via Cloud Function | `isAdmin(uid)` checa server-side | ✅ |

---

## OWASP API Security Top 10 (2023)

| ID | Vulnerabilidade | Status PRIMETOUR |
|----|-----------------|------------------|
| API1 | Broken Object Level Authorization | ✅ Firestore rules + uid checks |
| API2 | Broken Authentication | ✅ Firebase Auth + SSO + MFA (manual) |
| API3 | Broken Object Property Level Authorization | ✅ visibility scopes em ai_knowledge |
| API4 | Unrestricted Resource Consumption | ✅ rate limit + cost cap |
| API5 | Broken Function Level Authorization | ✅ isAdmin() em Cloud Functions sensíveis |
| API6 | Unrestricted Access to Sensitive Business Flows | ✅ delete operations só master + auditadas |
| API7 | Server Side Request Forgery | ✅ allowlist de URLs em getGitHubFile |
| API8 | Security Misconfiguration | ✅ CSP + headers + rules + lockdown system_config |
| API9 | Improper Inventory Management | ⚠ TODO documentar todas envs |
| API10 | Unsafe Consumption of APIs | ✅ todos LLMs via proxy server-side |

---

## Top Risks Identificados

### 1. CSP via meta tag (não response header) — **MEDIUM**
GitHub Pages não permite response headers customizados. CSP atual via `<meta>` é
client-side e pode ser modificada via DevTools. Mitigação: **migrar pra Cloudflare Pages**
no Sprint 4 (custo zero) pra adicionar HSTS + X-Frame-Options + CSP via `_headers`.

### 2. App Check em Monitor mode — **LOW (transitório)**
Ainda não está em Enforced. Após 7 dias de monitoring (target ≥95% requests com token válido),
admin habilita Enforced em Firestore + Functions. Bloqueia 100% scraping/curl.

### 3. SharePoint scopes via consent admin — **LOW**
Acesso ao SharePoint via `getSharePointToken` (client_credentials, server-side).
Funciona sem consent de cada user. Risco: secret rotação manual.
Mitigação futura: managed identity (Azure ADM Premium).

### 4. PITR Firestore — **MEDIUM**
Daily backup snapshot funciona. Mas recovery point granular (até 7 dias atrás)
exige PITR habilitado no console (admin manual ~30s).
**Action**: habilitar em https://console.cloud.google.com/firestore/databases?project=gestor-de-tarefas-primetour → Backups → Enable PITR.

### 5. Key rotation manual — **LOW**
Anthropic/OpenAI/Gemini/Groq keys rotacionam manualmente.
Próximo: setup Cloud Scheduler + Secret Manager rotation API.

---

## Compliance Mapping

| Norma | Cláusula | Status |
|-------|----------|--------|
| LGPD | Art. 6 (boa-fé, finalidade, transparência) | ✅ política + consent IA |
| LGPD | Art. 18 IV/V/VI (acesso, anonimização, eliminação) | ✅ exportUserData + eraseUserDataServer |
| LGPD | Art. 48 (incidente — comunicar ANPD em prazo razoável) | 📄 INCIDENT-RESPONSE.md |
| SOC 2 | CC6.1 (Logical Access) | ✅ MS SSO + RBAC + App Check |
| SOC 2 | CC7.2 (System Monitoring) | ✅ audit_logs + dailySecurityDigest |
| SOC 2 | CC8.1 (Change Management) | ✅ git history + commit signing |
| ISO 27001 | A.5.30 (Backup) | ✅ dailyBackup GCS NEARLINE |
| ISO 27001 | A.8.16 (Monitoring) | ✅ SIEM digest |
| ISO 27001 | A.5.7 (Threat Intelligence) | 📄 este doc |

---

## Action Items Prioritários

| # | Ação | Owner | Prazo | Severidade |
|---|------|-------|-------|------------|
| 1 | Habilitar PITR Firestore | rene | 7d | high |
| 2 | App Check Enforce (após 7d monitor) | rene | 14d | high |
| 3 | MFA enforce Azure AD Conditional Access | rene | 14d | high |
| 4 | Rotacionar Gemini + Groq keys (vazaram em chat) | rene | 7d | high |
| 5 | Migrar pra Cloudflare Pages (HSTS + headers) | rene | 30d | medium |
| 6 | Pentest externo (firma terceira) | gestão | 90d | medium |
| 7 | Treinamento phishing equipe | gestão | 60d | low |

---

## Versionamento

- **v1.0** (2026-05-02): primeira versão pós Sprint 1+2
- Próxima revisão: a cada quarter ou após incidente
