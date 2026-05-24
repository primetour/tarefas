# Gestor PRIMETOUR — Access Control Matrix

> Atualizado: 2026-05-05 · v3.1.0
> Compliance: SOC 2 CC6.1/CC6.3, ISO 27001 A.8.2/A.8.3, LGPD Art. 6 (princípio da finalidade)
>
> **Mudança 3.0.0**: núcleos e workspaces unificados em **squads** (ver `CHANGELOG.md`).
> Coleção Firestore `nucleos` segue acessível por back-compat mas não é mais a
> fonte de verdade — `userDoc().squads` é o canônico. Sync automática entre as duas
> coleções é mantida durante a janela de transição.
>
> **Para o "porquê" de cada permissão e suas regras automáticas**, ver
> [`RULES-AND-AUTOMATIONS.md`](RULES-AND-AUTOMATIONS.md) — mapa completo das
> regras automáticas (defaults, cascatas, syncs, notificações, validações
> server-side, auditoria), com **racional** explicando cada decisão.

## Roles

| Role | Descrição | Quem tem |
|------|-----------|----------|
| **master** | Diretoria — acesso total + zona de perigo | 1-2 pessoas |
| **admin** | Head — gerencia users, squads, configurações | 2-3 pessoas |
| **manager** | Gerente — administra squads, importa em lote | 3-5 pessoas |
| **coordinator** | Coordenador — coordena tarefas e times | 5-8 pessoas |
| **member** | Analista — operações em tarefas e roteiros | maioria |
| **partner** | Parceiro — acesso restrito ao portal de dicas | externos |

Hierarquia: master ⊃ admin ⊃ manager ⊃ coordinator ⊃ member ⊃ partner

---

## Permissions × Roles (resumo)

### Tarefas e Projetos
| Permissão | master | admin | manager | coordinator | member | partner |
|-----------|--------|-------|---------|-------------|--------|---------|
| task_create | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| task_view_all | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| task_edit_any | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| task_delete_any | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **task_complete** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| project_create | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| bulk_import | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

> **`task_complete`** controla quem pode finalizar uma tarefa direto pra `done`.
> Quem não tem essa permissão (member/partner) cai no fluxo de **validação obrigatória** — ver §"Fluxo de validação obrigatória (v4.53.0+)" mais abaixo.

### Equipe e CLT
| Permissão | master | admin | manager | coordinator | member | partner |
|-----------|--------|-------|---------|-------------|--------|---------|
| team_view | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| time_clock_view_all | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| time_clock_edit_correction | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| vacation_approve | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| feedback_view | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| feedback_create | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |

### Sistema
| Permissão | master | admin | manager | coordinator | member | partner |
|-----------|--------|-------|---------|-------------|--------|---------|
| user_create | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| user_role_change | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| system_manage_settings | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| system_view_all | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| audit_logs_view | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **danger_zone_delete_all** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **lgpd_erasure_others** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

### IA Hub
| Permissão | master | admin | manager | coordinator | member | partner |
|-----------|--------|-------|---------|-------------|--------|---------|
| ai_chat | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| ai_create_agent | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| ai_manage_keys | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| ai_knowledge_create | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| ai_view_costs | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

### Marketing & Portal
| Permissão | master | admin | manager | coordinator | member | partner |
|-----------|--------|-------|---------|-------------|--------|---------|
| portal_access | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| portal_manage | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| content_calendar_view | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |
| roteiro_access | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ |

---

## Visibility Scopes (data-level access)

Mesmo com permissão `X`, o usuário só vê dados que entram em seu escopo:

| Scope | Filtro | Aplicado em |
|-------|--------|-------------|
| **own** | `userId == request.auth.uid` | tasks (member), notes, drafts, ai_chat_history |
| **sector** | `sector in userDoc().visibleSectors` | ai_knowledge, conteúdo setorial |
| **squad** | `squadId in userDoc().squads` | tarefas de squad |
| **all** | `system_view_all == true` | admin/master only |

Implementação: dupla camada
1. **Client-side** (UX): filtros aplicados em `store.js` antes de renderizar
2. **Server-side** (security): Firestore Security Rules duplicam check em todas reads/writes

Exemplo `firestore.rules`:
```
match /ai_knowledge/{docId} {
  allow read: if isAuth() && (
    !('visibility' in resource.data)
    || resource.data.visibility == 'public'
    || resource.data.visibility == 'internal'
    || isAdmin()
    || (resource.data.visibility == 'sector'
        && resource.data.sector in (userDoc().visibleSectors || []))
  );
}
```

---

## Service Accounts & API Access

| Conta | Uso | Privilégios |
|-------|-----|-------------|
| `gestor-de-tarefas-primetour@appspot.gserviceaccount.com` | Cloud Functions runtime | datastore.user, secretmanager.secretAccessor, storage.objectAdmin (bucket backups), datastore.importExportAdmin |
| `1083421353313-compute@developer.gserviceaccount.com` | Cloud Build | cloudbuild.builds.builder, secretmanager.secretAccessor (build-time) |
| Azure AD App Registration | SharePoint client_credentials | Microsoft Graph: `Files.Read.All`, `Sites.Read.All` (app-only, admin-consented) |
| GitHub Actions SA (Firestore Admin) | CI scripts (mc-sync, classify-content, classify-content-ai, promote-ai-to-prod, rollback-ai-classification, backfill-image-urls, categorize-no-art) | Firestore Admin SDK via `FIREBASE_*` secrets (bypassa Firestore rules — escrita irrestrita; uso restrito a workflows revisados) |

**Princípio de menor privilégio**: cada SA tem apenas as roles necessárias.
**Auditoria**: `gcloud iam service-accounts get-iam-policy ...`

### Coleções com escrita SOMENTE via Admin SDK (cliente bloqueado)
Padrão "append-only via scripts": ler do dashboard é OK; mutação só
acontece via workflow GitHub Actions com `FIREBASE_PRIVATE_KEY`.

- `mc_performance` — read: auth, write: master (escrita server-side via mc-sync)
- `nl_ai_classifier_runs` (v4.49.41+) — read: auth, create/update/delete: false
- `nl_classifier_promotions` (v4.49.42+) — read: admin, create/update/delete: false
- `nl_classifier_rollbacks` (v4.49.42+) — read: admin, create/update/delete: false

### Gates de UI específicos
Mesmo quando a rule Firestore permite, certos botões/ações são gated
no client por permissão (defesa em profundidade + UX):

- Dashboard NL → Conteúdo & Temas → bloco shadow mode → botões
  "IA certa / regex certo" por divergência: gated por
  `store.isMaster() || store.can('system_manage_settings')` na render
  (`canVoteOnDecisions`) E re-validado no click handler (allowlist
  do eixo/verdict/docId).
- Dashboard NL → bloco shadow mode → painel admin (botões "Promover
  IA / Reverter cutover / Disparar classificação"): mesma gate
  (renderiza `''` para não-admin).

---

## Fluxo de validação obrigatória (v4.53.0+)

**Decisão de negócio**: tarefas concluídas por analista júnior precisam de double-check (CSAT + vínculo de metas) por um superior antes de virarem oficialmente `done`. Evita SLA atrasar enquanto o gestor demora pra revisar.

### Quem pode finalizar direto vs quem passa por validação

A vinculação é feita pela permissão **`task_complete`** no role do usuário. **Não é um nível "diretoria sim, gerente não"** — é um flag granular: se um analista específico precisar de autonomia, basta ligar `permissionOverrides.task_complete = true` no perfil dele (UI de Usuários já suporta).

| Role | task_complete? | Ao clicar "Concluir" |
|---|---|---|
| `master` (Diretoria) | ✅ | Vai direto pra `done` → **popup CSAT + metas abre** |
| `admin` (Head) | ✅ | Vai direto pra `done` → **popup CSAT + metas abre** |
| `manager` (Gerente) | ✅ | Vai direto pra `done` → **popup CSAT + metas abre** |
| `coordinator` (Coordenador) | ✅ | Vai direto pra `done` → **popup CSAT + metas abre** |
| `member` (Analista) | ❌ | Vai pra `validation` (SLA congela) → toast "Tarefa enviada pra validação do coordenador." |
| `partner` (Parceiro) | ❌ | Idem analista (raro) |

### Fluxograma

```
[Analista clica "Concluir"]
    │
    ▼
toggleTaskComplete(id, true)
    │
    ├── store.can('task_complete')? ─────────► SIM ─► status = 'done'
    │                                                 ├─ slaFrozenAt = null (limpa freeze)
    │                                                 ├─ completedAt = now
    │                                                 ├─ playCompletionSound()
    │                                                 └─ overlay CSAT/metas (page caller abre)
    │
    └── NÃO + é assignee? ─────────────────────► SIM ─► status = 'validation'
                                                        ├─ slaFrozenAt = now
                                                        ├─ slaFrozenBy = uid
                                                        ├─ notify(managers do setor)
                                                        ├─ playCompletionSound()
                                                        └─ toast "enviada pra validação"
                                                              │
                                                              ▼
                                              [Coordenador abre módulo
                                               Solicitações → aba "🔍
                                               Aguardando validação"]
                                                              │
                              ┌───────────────────────────────┼───────────────────────────────┐
                              ▼                                                                ▼
                  [Botão "Validar (concluir)"]                                  [Botão "Devolver pra retrabalho"]
                              │                                                                │
                              ▼                                                                ▼
              status = 'done', validatedBy, validatedAt                          status = 'rework' + reworkReason
              overlay CSAT/metas abre pro coordenador
```

### Implementação técnica

- **Service único**: `toggleTaskComplete` em `js/services/tasks.js:867` faz o switch baseado em `store.can('task_complete')`. Quem não tem perm + é assignee delega pra `updateTaskStatus(id, 'validation')`.
- **SLA freeze**: `isTaskOverdue(task)` retorna `false` se `task.status === 'validation'` — tarefa não vira "atrasada" enquanto coordenador não validar.
- **Cobertura cross-app (v4.53.2)**: TODOS os callers (`pages/tasks.js`, `pages/kanban.js`, `pages/squadWorkspace.js`, `services/aiActions.js`) leem `fresh.status` após complete e roteiam:
  - `'validation'` → toast informativo (NÃO abre overlay)
  - `'done'` → `openTaskDoneOverlay()` com CSAT/metas
- **Aba de validação**: visível só pra `master | task_complete` em `js/pages/requests.js:223`. Não-gestores não veem badge nem aba.

### Como dar autonomia a um analista específico

UI: **Configurações → Usuários → editar perfil → Permission Overrides → `task_complete: ON`**.
Isso liga só pra esse user, mantendo o role `member` intacto pra todos os outros analistas. Mesma mecânica vale pra REMOVER a permissão de um coordenador que você não quer que finalize direto (`task_complete: OFF`).

### Auditoria de roles

Pra confirmar quais roles têm `task_complete` em produção:

```bash
# script ad-hoc (admin SDK)
roles = await db.collection('roles').get();
roles.forEach(r => console.log(r.id, r.data().permissions?.task_complete));
```

Última auditoria (24/05/2026): master/admin/manager/coordinator = ✅; member/partner = ❌.

---

## Lifecycle de usuário

### Criação
1. Master/Admin acessa Configurações → Usuários → Adicionar
2. Usa `secondaryAuth` para criar conta sem afetar sessão atual
3. Define role + sector + squads
4. Sistema envia convite por email (manual: admin compartilha URL + senha provisória OU usa MS SSO)
5. Audit log: `user.create` com createdBy

### Mudança de role
1. Apenas master/admin pode mudar role
2. Doble-confirmação no UI
3. Audit log: `user.role_change` com from/to/by

### Desligamento (offboarding)
1. **Imediato**: Disable account em Firebase Auth (não deletar)
2. **Imediato**: Revoke refresh tokens (`auth:revoke-refresh-tokens`)
3. **Após 30 dias**: marcar para erasure parcial
4. **Após 5 anos** (CLT compliance): full erasure via `eraseUserDataServer`
5. Audit log de cada etapa

### LGPD self-service erasure
Usuário pode solicitar `eraseUserDataServer({ uid: own })`:
- Hard delete: `ai_chat_history`, `drafts`, `notes`, `csat_responses`, `notifications`
- Anonimização: `tasks`, `comments`, `audit_logs` (preserva integridade referencial mas remove PII)
- Preservado: `time_clock_audit` (5 anos CLT obrigatório)

---

## MFA (Multi-Factor Authentication)

**Status**: enforcement via Azure AD Conditional Access — política aplicada para usuários
admin/master e em rampa progressiva para os demais perfis. Implementação na camada do
provedor de identidade (Microsoft 365), não no app.

**Métodos suportados**: Microsoft Authenticator (push), SMS (fallback), FIDO2 keys (recomendado para roles admin/master).

**Política aplicada**:
- Admin/master: MFA obrigatório, FIDO2 recomendado, bloqueio fora do horário comercial via Conditional Access
- Manager/coordinator: MFA obrigatório
- Member/partner: MFA recomendado (rampa para obrigatório em rollout escalonado)
- Break-glass account: 1 conta isolada com FIDO2 obrigatório, monitorada por dailySecurityDigest

---

## Auditoria periódica

| Frequência | Ação |
|------------|------|
| Mensal | Review de roles via `firestore.users.{role: "admin"}` |
| Trimestral | Review de Service Accounts permissions |
| Trimestral | Review de Conditional Access policies |
| Anual | Penetration test externo |
| Anual | Review completa deste documento |

---

## Versionamento deste documento

- **v1.0** (2026-05-02): primeira versão
- **v1.1** (2026-05-05, alinhado com `app v3.1.0`): unificação de núcleos→squads, atualização do status MFA, alinhamento com cobertura SOC 2 / ISO 27001
- **v1.2** (2026-05-24, alinhado com `app v4.53.2`): adicionada perm `task_complete` na tabela Tarefas + nova seção "Fluxo de validação obrigatória" documentando o roteamento `done` vs `validation` baseado na hierarquia + overrides por user
- Owner: Incident Commander (DPO)
- Revisão obrigatória: trimestral OU em qualquer mudança de schema RBAC
