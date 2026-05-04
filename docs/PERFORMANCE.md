# Performance & Custos — Gestor PRIMETOUR

> Documento técnico-operacional. Para visão de usuário final, ver UI in-app.

## 1. Plano Firebase atual

**Spark (Free Tier)** — limites diários:
- 50.000 reads
- 20.000 writes
- 20.000 deletes
- 1 GiB storage
- 10 GiB transfer/mês

**Migrar pra Blaze quando:**
- Exceder limites 2-3 dias seguidos, ou
- Atingir ~50 usuários ativos diários

Custo Blaze estimado para 50 users ativos: **~$5–15/mês**.
Para 200 users: **~$30–60/mês**.

## 2. Otimizações implementadas

### 2.1 Heartbeat Presence (commit `c9654cb`)

| Antes | Depois |
|---|---|
| 30s = 2.880 writes/user/dia | **2 min = 720 writes/user/dia** |
| Threshold offline 90s | Threshold offline 6 min |

**Trade-off:** delay maior pra detectar offline (tolerável pra UX).
**Plano futuro:** migrar pra Realtime Database (RTDB) com `onDisconnect()` — heartbeat cai pra ~1 write/sessão. Pendente: investigar travamento ocorrido na 1ª tentativa (commit `ff9cecd` revertido).

### 2.2 Cache `fetchUsers` (commit `c9654cb`)

| Antes | Depois |
|---|---|
| TTL 60s | **TTL 5 min** |

Validação: snapshot global em `initAuthObserver` (`onSnapshot('users')`) já mantém `store.users` fresh em tempo real. fetchUsers virou fallback redundante.
**Economia:** ~5× menos reads (1.500 → 300 reads/user/dia).

### 2.3 Paginação configurável (commit `c9654cb`)

`js/components/pageSize.js` — componente reutilizável com:
- Opções: 10, 20, 50, 100
- Persistência em `localStorage` por escopo (ex: `audit`, `tasks`)
- API: `getPageSize`, `setPageSize`, `renderPageSizePicker`, `wirePageSizePicker`

Aplicado em `#audit`. Pode ser estendido pra `#tasks`, `#users`, etc.

### 2.4 TTL audit_logs 90 dias (commit deste iter)

**Cloud Function:** `pruneOldAuditLogs` — scheduled `0 30 6 * * *` BRT.

Apaga audit_logs com `timestamp < now - 90 dias`, em batches de 500.

**Preserva** (mesmo > 90 dias):
- `severity: 'critical'`
- `action` começando com `lgpd.` ou `security.`

**Idempotente.** Roda 1x/dia às 03h30 BRT (30 min depois do `dailyBackup`).

**Para customizar retenção:** editar `RETENTION_DAYS` em `functions/index.js` `pruneOldAuditLogs`.

### 2.5 Audit Sampling (commit deste iter)

`services/tasks.js` — `updateTask` agora skip auditLog em **mudanças triviais**:

| Cenário | Audit |
|---|---|
| Status muda (in_progress → done) | ✅ loga |
| Assignee/observer/dueDate/priority muda | ✅ loga |
| Só descrição (autosave) | ❌ skip |
| Só correção pequena de título (<3 chars diff) | ❌ skip |
| Só `updatedAt`/`updatedBy` (metadata) | ❌ skip |

**Lógica:** `RELEVANT_FIELDS` (sempre logam), `SILENT_FIELDS` (sempre skip), trivial path.

Estimativa de redução: **~40% menos audit writes** em uso ativo.

### 2.6 Lazy Loading: `taskTypes` (commit deste iter)

`loadTaskTypes()` saiu do boot do `initAuthObserver`. Agora carrega **on-demand**:

- `taskModal` (já fazia)
- `pages/tasks.js`, `pages/calendar.js`, `pages/timeline.js` (adicionado)

**Cache em memória:** 1ª chamada faz fetch, próximas retornam imediato.
**Invalidação:** `invalidateTaskTypesCache()` (chamar em CRUD de types).

**Economia:** ~50 reads/login (~250 reads/dia pra 5 users; ~10k/dia pra 200 users).

## 3. Listeners contínuos (custos recorrentes)

Listeners `onSnapshot` ativos por sessão de user:

| Recurso | Reads inicial | Updates contínuos |
|---|---|---|
| `users` (snapshot global) | 16 docs | 1 por edit em qualquer user |
| `users/{currentUid}` (próprio profile) | 1 doc | 1 por edit no próprio |
| `tasks` (subscribeToTasks) | varia | 1 por task editada |
| `notifications` (próprias) | varia | 1 por notif nova |
| `presence` (5 users) | 5 docs | 1 por heartbeat (2 min/user) |

**Total estimado por user/dia:** ~300 reads (de listeners) + ~500 reads (boot, page loads) = **~800 reads/user/dia**.

## 4. Estimativas de uso

| Volume | Reads/dia | Writes/dia | Free tier |
|---|---|---|---|
| 5 users testando | ~4.000 | ~3.700 | OK (8% / 18%) |
| 20 users diários | ~16.000 | ~14.800 | OK (32% / 74%) |
| **50 users ativos** | **~40.000** | **~37.000** | ⚠ Reads OK, writes **estoura** |
| 100 users | ~80.000 | ~74.000 | ❌ Migrar pra Blaze |
| 200 users | ~160.000 | ~148.000 | ❌ Blaze ~$30-60/mês |

**Trigger pra migrar Blaze:** ~50 users ativos diários OU exceder limites 2 dias seguidos.

## 5. Próximas otimizações (não implementadas)

### 5.1 Lazy loading mais agressivo
Hoje no boot: `loadUserWorkspaces`, `loadNucleos`, `loadCategories`, `initSystemTaskTypes`. Pode ser movido pra páginas específicas. **Risco:** quebra deps em código que assume store populado. **Ganho:** ~30 reads/login.

### 5.2 RTDB pra Presence
`onDisconnect()` nativo, free tier separado, ~1 write/sessão em vez de 720/dia.
**Bloqueio atual:** travamento na primeira tentativa (commit `ff9cecd` revertido). Hipóteses:
- App Check bloqueando WebSocket RTDB
- `databaseURL` errado
- Listener loop com `serverTimestamp`

### 5.3 Pagination nas listas grandes
Aplicar `pageSize.js` em `#tasks` (~1000 docs), `#users`, `#projects`. Hoje carrega tudo de uma vez.

### 5.4 Export de audit_logs antes de TTL
TTL atualmente apaga sem export. Pra compliance LGPD/SOX rigoroso, antes de apagar, exportar pra Cloud Storage. Implementar como segunda Cloud Function scheduled.

## 6. Como monitorar consumo

Firebase Console → Firestore → **Usage** tab:
- Reads/Writes/Deletes diários
- Storage atual

Alerta automático: setar threshold em **80%** do limite no Cloud Monitoring.

## 7. Tabela de comandos pra admin

| Quando | Ação |
|---|---|
| Limites exceder 2 dias | Migrar pra Blaze (1 click no Console) |
| Audit_logs > 50k docs | Verificar se `pruneOldAuditLogs` está rodando (Console → Functions → Logs) |
| Sistema lento | Verificar listeners ativos (DevTools → Network → WS) |
| User reporta dados desatualizados | Hard reload (cache 5min) |

---

## 8. Vide também

- [docs/ARCHITECTURE.md](./ARCHITECTURE.md) — visão técnica do sistema
- [docs/CONTRIBUTING.md](./CONTRIBUTING.md) — convenções de código + workflow
- [README.md](../README.md) — quickstart pra dev novo
- [INFRA.md](../INFRA.md) — infraestrutura produção
- [SECURITY.md](../SECURITY.md) — threat model + auditoria pentest

---

**Última revisão:** 2026-05-04
**Responsável técnico:** time PRIMETOUR
