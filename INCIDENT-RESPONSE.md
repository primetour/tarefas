# PRIMETOUR — Incident Response Runbook

> Atualizado: 2026-05-02
> Compliance: LGPD Art. 48, SOC 2 CC7.4, ISO 27001 A.5.24/A.5.26

## Contatos

| Papel | Nome | Email | Telefone |
|-------|------|-------|----------|
| **Incident Commander** | Rene Castro | rene.castro@primetour.com.br | (11) ###-#### |
| **DPO (LGPD)** | Rene Castro (acumulado) | rene.castro@primetour.com.br | (11) ###-#### |
| **Diretoria** | Carolina Aliasse | carolina@primetour.com.br | - |

**Comunicação ANPD (LGPD Art. 48)**: comunicacao@anpd.gov.br
**Microsoft 365 Admin**: portal.azure.com → tenant primetour.com.br
**Firebase/GCP Console**: console.firebase.google.com (apenas owners)

---

## Severidade

| Nível | Critério | SLA Resposta | Comunicação |
|-------|----------|--------------|-------------|
| **P0 — Critical** | vazamento PII massivo, sistema down completo, ransomware | 15 min | Diretoria + ANPD em 72h |
| **P1 — High** | bypass auth descoberto, conta admin comprometida, key vazada | 1 h | Diretoria, ANPD se PII |
| **P2 — Medium** | DDoS, custo IA descontrolado, usuário não-autorizado acessou dados | 4 h | Líder de área |
| **P3 — Low** | bug de segurança sem exploit ativo, config drift | 24 h | Backlog |

---

## Detecção

### Fontes ativas
1. **dailySecurityDigest** (Slack diário 09h BRT) — anomalias últimas 24h
2. **audit_logs** com `severity: critical` ou `warning` — Firestore queries ad-hoc
3. **Cloud Functions logs** — `gcloud functions logs read X`
4. **Firebase Auth events** — failed logins, new IPs
5. **GitHub Security Alerts** — Dependabot, secret scanning
6. **Reports externos** — security.txt + email

### Queries úteis (Firestore Console)
```js
// Logins suspeitos últimas 24h
db.collection('audit_logs')
  .where('action', '==', 'auth.suspicious_new_ip')
  .where('timestamp', '>=', Date.now() - 86400000)

// Eventos críticos últimos 7 dias
db.collection('audit_logs')
  .where('severity', '==', 'critical')
  .where('timestamp', '>=', Date.now() - 604800000)
  .orderBy('timestamp', 'desc')

// Top consumidores de IA hoje
db.collection('ai_usage_logs')
  .where('timestamp', '>=', new Date(new Date().setHours(0,0,0,0)))
  .orderBy('totalCostUsd', 'desc').limit(20)
```

---

## Playbook por Tipo

### 🔴 P0: Vazamento PII (LGPD Art. 48)

**Detecção típica**: SIEM alerta "deletes em massa" + report externo

1. **Contenção (15 min)**
   - Revogar credenciais comprometidas: Firebase Auth → Users → "Disable"
   - Bloquear IP atacante via Cloud Armor (Console → Networking)
   - Snapshot Firestore: `gcloud firestore export gs://.../incident-{date}`

2. **Erradicação (1 h)**
   - Identificar vetor: revisar audit_logs, Cloud Functions logs
   - Patch: hotfix → deploy via `firebase deploy --only functions`
   - Rotacionar todas keys afetadas (Secret Manager + remote APIs)

3. **Recovery (4 h)**
   - Restaurar dados do backup pré-incident:
     `gcloud firestore import gs://gestor-de-tarefas-primetour-backups/firestore/{date}`
   - Validar integridade
   - Re-habilitar acesso para usuários afetados

4. **Comunicação (≤72h LGPD)**
   - Diretoria: imediato
   - ANPD: até 72h via formulário em https://www.gov.br/anpd/pt-br
     - Natureza dos dados afetados
     - Titulares (nº aproximado)
     - Medidas técnicas adotadas
     - Plano de mitigação
   - Titulares: comunicação direta se houver risco

5. **Pós-mortem (7 d)**
   - Doc: `docs/postmortems/YYYY-MM-DD-{slug}.md`
   - Inclui: timeline, impacto, causa raiz, ações corretivas
   - Atualizar THREAT-MODEL.md

### 🟠 P1: Conta admin comprometida

1. Disable user: `firebase auth:disable-users {uid}`
2. Forçar logout global: `firebase auth:revoke-refresh-tokens {uid}`
3. Auditar `audit_logs` últimos 90 dias filtrando por `userId == {uid}`
4. Reverter mudanças não-autorizadas (Firestore version history se PITR ativo)
5. Reset MFA: usuário recria via Azure AD self-service
6. Comunicar diretoria

### 🟠 P1: Key/Secret vazada

1. **Imediato**: revogar no provider (Anthropic console, GitHub → Settings → Tokens, etc.)
2. Set new secret: `firebase functions:secrets:set {SECRET}`
3. Re-deploy função afetada: `firebase deploy --only functions:{name}`
4. Verificar billing do provider pra abuse durante exposure window
5. Audit logs: `git log -p` no commit que vazou + verificar se foi pushed
6. Se em git público: usar `git filter-repo` pra purgar (e force-push) + abrir incident interno

### 🟡 P2: DDoS / Cost bomb IA

1. Verificar `ai_usage_logs` ordenado por custo
2. Identificar uid culpado (ou IP via Cloud Functions logs)
3. Disable user temporário OU baixar `agentDailyCapUsd` no Firestore
4. Se IP externo: Cloud Armor rule
5. Investigar se foi exploração ou bug em prompt loop

### 🟡 P2: Bypass de Firestore Rules

1. Reproduzir o bypass localmente
2. Patch nas rules: `firestore.rules`
3. Deploy: `firebase deploy --only firestore:rules`
4. Audit logs: queries `WHERE collection IN ['affected1', 'affected2']` 90d
5. Notificar usuários afetados se PII foi acessado

### 🟢 P3: Bug de segurança sem exploit

1. Criar issue privada no repo (não público)
2. Atribuir ao Incident Commander
3. Roadmap: corrigir em até 30 dias
4. Atualizar THREAT-MODEL.md

---

## Comunicação ANPD (LGPD Art. 48 §3)

**Conteúdo obrigatório**:
1. Descrição da natureza dos dados afetados
2. Informações sobre os titulares envolvidos
3. Medidas técnicas e de segurança utilizadas para proteção
4. Riscos relacionados ao incidente
5. Motivos da demora (se aplicável) — tornou-se evidente apenas em ...
6. Medidas que foram ou serão adotadas para reverter ou mitigar

**Canal**: https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento

---

## Backup & Recovery

### Backup atual
- **Daily snapshot** Firestore → GCS NEARLINE (03h BRT)
- **Retenção**: 365 dias com lifecycle (NEARLINE→COLDLINE@30→ARCHIVE@90→DELETE@365)
- **Localização**: `gs://gestor-de-tarefas-primetour-backups/firestore/{YYYY-MM-DD}/`

### Recovery quick reference
```bash
# Listar backups disponíveis
gsutil ls gs://gestor-de-tarefas-primetour-backups/firestore/

# Restore de um dia específico (CUIDADO: sobrescreve dados atuais)
gcloud firestore import gs://gestor-de-tarefas-primetour-backups/firestore/2026-05-02 \
  --project=gestor-de-tarefas-primetour

# Restore parcial (apenas algumas collections)
gcloud firestore import gs://.../firestore/2026-05-02 \
  --collection-ids=tasks,users \
  --project=gestor-de-tarefas-primetour
```

### PITR (Point-in-Time Recovery)
**Status**: pendente habilitação manual em
https://console.cloud.google.com/firestore/databases?project=gestor-de-tarefas-primetour
→ default → Backups → Enable PITR (até 7 dias para trás, granularidade minuto)

**Quando usado**: incidentes que aconteceram entre snapshots diários
(ex: bulk delete às 14h — daily backup capturou estado de 03h, queremos recuperar 13:59).

---

## Manutenção do Runbook

- **Tabletop exercise**: a cada 6 meses simular um P1 para treinar a equipe
- **Atualizar**: a cada incident real (lições aprendidas)
- **Owner**: Incident Commander
- **Versão**: v1.0 (2026-05-02)
