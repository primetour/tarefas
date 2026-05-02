# Deploy Cloud Functions PRIMETOUR

## Pré-requisitos
- Firebase CLI instalado e logado: `firebase login`
- Plano **Blaze** (Pay as you go) — Cloud Functions exige
- Node 20

## Setup inicial (uma vez)

### 1. Configure os secrets

```bash
cd functions

# LLM API Keys (rotacionar antes!)
firebase functions:secrets:set ANTHROPIC_API_KEY
firebase functions:secrets:set OPENAI_API_KEY
firebase functions:secrets:set GEMINI_API_KEY
firebase functions:secrets:set GROQ_API_KEY

# R2 Worker token (regenerar antes!)
firebase functions:secrets:set R2_UPLOAD_TOKEN

# SharePoint app credentials (Azure AD App Registration)
firebase functions:secrets:set SHAREPOINT_TENANT_ID
firebase functions:secrets:set SHAREPOINT_CLIENT_ID
firebase functions:secrets:set SHAREPOINT_CLIENT_SECRET

# GitHub PAT (apenas se for usar repos privados)
firebase functions:secrets:set GITHUB_PAT
```

Cada comando vai abrir prompt pedindo o valor.

### 2. Verifique secrets configurados

```bash
firebase functions:secrets:access ANTHROPIC_API_KEY  # mostra o valor (só pra confirmar)
firebase functions:secrets:list                       # lista todos
```

### 3. Deploy

```bash
firebase deploy --only functions
```

## Funções disponíveis

| Função | Auth | Rate Limit | Descrição |
|---|---|---|---|
| `callLLM` | required | 60/60s/user | Proxy LLM (Anthropic/OpenAI/Gemini/Groq) |
| `getR2UploadUrl` | required | 30/60s/user | Retorna URL+token de upload R2 |
| `getSharePointToken` | required | 30/60s/user | Token Graph API client_credentials |
| `getGitHubFile` | required | - | Lê arquivo/pasta GitHub com PAT |

## Após deploy

1. **Teste callLLM** via curl ou client:
```js
const fn = httpsCallable(getFunctions(), 'callLLM');
const result = await fn({ provider: 'gemini', userMessage: 'Olá' });
console.log(result.data.text);
```

2. **Migrar client**: Sprint 1 final substitui `chatWithAI` direto por `callLLM` Cloud Function

3. **Lockdown rules**: depois que client não lê mais Firestore direto:
```firestore-rules
match /system_config/ai-config {
  allow read: if isAdmin();  // antes: isAuth()
  allow write: if isAdmin();
}
match /ai_api_keys/{docId} {
  allow read: if isAdmin();   // antes: isAuth()
  allow write: if isAdmin();
}
```

## Custos estimados

- Cold start: ~500ms
- Warm execution: 50-200ms
- Memória: 512MiB
- Free tier: 2M invocações/mês
- Acima: $0.40 / 1M invocações + $0.0000025/GB-s

Cenário ~100 usuários × 10 chamadas IA/dia × 30 dias = 30k invocações/mês = **GRÁTIS**.
Cenário 1000 users × 50 chamadas/dia = 1.5M/mês = ainda free tier.
Cenário 10k users × 100 chamadas/dia = 30M/mês = **~$12/mês**.

## Monitoramento

```bash
firebase functions:log --only callLLM
firebase functions:log --only callLLM | grep ERROR
```

Cloud Console: https://console.cloud.google.com/functions
