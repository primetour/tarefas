# Configuração de TTL automático no Firestore

Firestore TTL é configurado **no Firebase Console** (não via rules) ou via gcloud CLI.

## Collections com TTL automático

| Collection | TTL Field | Período | Justificativa |
|---|---|---|---|
| `ai_usage_logs` | `expiresAt` | 90 dias | LGPD — minimização de dados |
| `audit_logs` | `expiresAt` | 180 dias | SOC2 — retenção mínima de 6 meses |
| `time_clock_audit` | `expiresAt` | 5 anos | CLT — guarda obrigatória 5 anos |
| `notifications` | `expiresAt` | 30 dias | UX — limpeza automática |
| `agent-scheduler-runs` | (localStorage) | 1h | Já tem dedup local |

## Setup via Firebase Console

Para CADA collection acima:

1. Acesse [Firebase Console → Firestore → TTL](https://console.firebase.google.com/project/gestor-de-tarefas-primetour/firestore/ttl)
2. Click "+ Create Policy"
3. Collection: `ai_usage_logs`
4. Field: `expiresAt`
5. Save

Repetir pra cada collection da tabela acima.

## Setup via gcloud CLI (mais rápido)

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=ai_usage_logs \
  --enable-ttl

gcloud firestore fields ttls update expiresAt \
  --collection-group=audit_logs \
  --enable-ttl

gcloud firestore fields ttls update expiresAt \
  --collection-group=time_clock_audit \
  --enable-ttl

gcloud firestore fields ttls update expiresAt \
  --collection-group=notifications \
  --enable-ttl
```

## Como o sistema seta `expiresAt`

Os services agora populam o campo automaticamente ao criar:

```js
// js/services/ai.js → logUsage()
const expiresAt = new Date();
expiresAt.setDate(expiresAt.getDate() + 90);
await addDoc(collection(db, 'ai_usage_logs'), {
  ...,
  expiresAt: Timestamp.fromDate(expiresAt),
});
```

## Verificação

```bash
gcloud firestore fields ttls list --format=table
```

## Custos

TTL é **GRÁTIS** no Firestore — só conta como uma operação delete normal.
Estimativa: ~10k deletes/mês = $0.02 (free tier 20k/dia).

## LGPD compliance

- Direito de minimização: ✓ TTL aplicado
- Direito de esquecimento: combinado com `eraseUserData()` (function própria)
- Auditoria de retenção: timestamps automáticos
