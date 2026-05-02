# PRIMETOUR — Data Flow & PII Inventory

> Atualizado: 2026-05-02
> Compliance: LGPD Art. 37 (registro de operações), SOC 2 CC6.1, ISO 27001 A.5.34

## Categorias de Dados

### 🟢 Dados Públicos (sem restrição)
- Logos da empresa
- Conteúdo do portal de dicas (público)
- Landing pages

### 🟡 Dados Internos (acesso restrito a colaboradores)
- Tarefas, projetos, status, comentários
- Roteiros de viagem, briefings
- Documentos do CMS
- Métricas operacionais

### 🟠 Dados Confidenciais (acesso por role)
- Salários, banco de horas, espelhos de ponto
- Avaliações de desempenho, feedbacks
- Configurações de integração
- Logs de auditoria

### 🔴 Dados Sensíveis / PII (acesso minimizado)
- Email, telefone, endereço de colaborador
- Dados de cliente em roteiros (nome, contato, perfil de viagem)
- IP/UA de login (auth audit)
- CPF/CNPJ (raros, em roteiros corporativos)

---

## Fluxos Principais

### F1. Login do usuário
```
Browser → Microsoft SSO (login.microsoftonline.com)
       → Firebase Auth (identitytoolkit.googleapis.com)
       → Cloud Function logUserLogin (captura IP+UA server-side)
       → Firestore audit_logs (TTL 180d)
```
**PII processado**: email, IP, user agent
**Retenção**: 180 dias (TTL automático)
**Base legal LGPD**: legítimo interesse (segurança)

### F2. Criação de tarefa
```
Browser → Firestore tasks (write direto, validado por rules)
       → audit_logs (op: task.create, severity: info)
```
**PII**: nome do criador, atribuídos
**Retenção**: indefinida (user pode arquivar/deletar)
**Base legal**: execução de contrato de trabalho

### F3. Conversa com IA Hub
```
Browser → aiDataGuard.js (anonimiza PII)
       → Cloud Function callLLM (rate limit + cost cap)
       → LLM API (Anthropic | OpenAI | Gemini | Groq)
       → resposta → Browser
       → ai_usage_logs (uid, agentId, tokens, cost)
       → ai_chat_history (mensagens, TTL 90d se DEFAULT_PRIVACY)
```
**PII**: anonimizado antes de sair
**Retenção logs**: 90 dias (TTL)
**Retenção chats**: 90 dias por default, opt-out via aiDataGuard
**Base legal**: legítimo interesse + consent (chat)

### F4. Knowledge SharePoint
```
Cloud Function getSharePointToken (client_credentials)
       → Microsoft Graph API
       → SharePoint sites/files
       → cache em ai_knowledge (Firestore)
```
**PII**: documentos podem conter dados internos
**Retenção**: enquanto documento existir no SharePoint
**Base legal**: execução de contrato

### F5. LGPD Erasure (Art. 18 VI)
```
User clica "Apagar meus dados" → eraseUserDataServer (Cloud Function)
       → HARD DELETE: ai_chat_history, drafts, notes, csat_responses
       → ANONYMIZE (CLT/SOC2): tasks, comments, audit_logs (substitui userId por hash)
       → audit_logs (op: lgpd.erasure, target: uid)
```
**Retenção mínima preservada**: 5 anos para registros CLT (`time_clock_audit`)
**Comunicação**: usuário recebe email confirmação em 15 dias úteis (LGPD Art. 18 §3)

### F6. Backup automatizado
```
Cloud Scheduler (03h BRT) → Cloud Function dailyBackup
       → Firestore exportDocuments (Admin API)
       → GCS bucket (NEARLINE → COLDLINE 30d → ARCHIVE 90d → DELETE 365d)
       → audit_logs (op: system.daily_backup)
```
**PII**: snapshot completo do Firestore (todos PII inclusos)
**Retenção**: 365 dias
**Acesso**: serviceAccount only, IAM lockdown
**Recovery**: `gcloud firestore import gs://...`

### F7. SIEM Digest
```
Cloud Scheduler (09h BRT) → dailySecurityDigest
       → varre audit_logs + ai_usage_logs (últimas 24h)
       → calcula riskScore + detecta anomalias
       → grava resumo em audit_logs
       → posta em Slack (se SIEM_SLACK_WEBHOOK configurado)
```

---

## Inventário PII por Collection (Firestore)

| Collection | PII? | Categoria | Retenção | Base Legal |
|------------|------|-----------|----------|------------|
| users | sim | confidencial | indefinida (até desligamento + 5y CLT) | contrato |
| tasks | parcial | interna | indefinida | contrato |
| projects | não | interna | indefinida | contrato |
| comments | parcial | interna | indefinida | contrato |
| roteiros | sim | sensível | 5 anos | contrato |
| portal_tips | não | público | indefinida | n/a |
| ai_chat_history | sim | confidencial | 90 dias (TTL) | consent |
| ai_usage_logs | sim (uid) | confidencial | 90 dias (TTL) | legítimo interesse |
| ai_knowledge | parcial | interna | indefinida | contrato |
| audit_logs | sim (uid+IP+UA) | confidencial | 180 dias (TTL) | legítimo interesse |
| time_clock_audit | sim | sensível | 5 anos (CLT obrigatório) | obrigação legal |
| feedbacks | sim | confidencial | 2 anos | legítimo interesse |
| csat_responses | parcial | confidencial | 1 ano | consent |
| notifications | parcial | interna | 30 dias | legítimo interesse |
| settings | não | interna | indefinida | n/a |
| system_config | não | interna | indefinida | n/a |
| ai_api_keys | sensitive | crítica | só admin | n/a |
| system_secrets | sensitive | crítica | rules: deny all | n/a |

---

## Storage Externo

| Sistema | Dados | Acesso | Retenção |
|---------|-------|--------|----------|
| Cloudflare R2 | logos, imagens públicas | público (signed URL pra upload) | indefinida |
| GCS backups | snapshot Firestore | serviceAccount only | 365 dias |
| Azure SharePoint | documentos corporativos | Microsoft tenant primetour.com.br | conforme MS |

---

## Transferência Internacional

| Destino | Provider | Dados | Salvaguarda |
|---------|----------|-------|-------------|
| EUA | Firebase / GCP | Firestore + Functions | DPA assinado, GCP DPA |
| EUA | Anthropic | conteúdo de chat (anonimizado) | DPA, no-train opt |
| EUA | OpenAI | conteúdo de chat (anonimizado) | DPA, no-train opt (gpt-4o) |
| EUA | Cloudflare R2 | imagens | DPA |
| Multi (MS) | Microsoft 365 | SharePoint, SSO | tenant primetour.com.br DPA |

LGPD Art. 33: transferência amparada por (a) cláusulas-padrão Anthropic/OpenAI/Google,
(b) consentimento específico do usuário no opt-in da IA Hub.

---

## Consent Tracking

User consents armazenados em `users.{uid}.privacy`:
```json
{
  "consentVersion": "1.1",
  "ai": { "saveHistory": true, "anonymize": true, "consentedAt": "..." },
  "csat": { "respond": true },
  "marketing": false
}
```

Versão de consent muda quando política muda — força re-confirmation.
