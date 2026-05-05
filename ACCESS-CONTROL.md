# Gestor PRIMETOUR — Access Control Matrix

> Atualizado: 2026-05-05 · v3.1.0
> Compliance: SOC 2 CC6.1/CC6.3, ISO 27001 A.8.2/A.8.3, LGPD Art. 6 (princípio da finalidade)
>
> **Mudança 3.0.0**: núcleos e workspaces unificados em **squads** (ver `CHANGELOG.md`).
> Coleção Firestore `nucleos` segue acessível por back-compat mas não é mais a
> fonte de verdade — `userDoc().squads` é o canônico. Sync automática entre as duas
> coleções é mantida durante a janela de transição.

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
| project_create | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| bulk_import | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

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

**Princípio de menor privilégio**: cada SA tem apenas as roles necessárias.
**Auditoria**: `gcloud iam service-accounts get-iam-policy ...`

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
- Owner: Incident Commander (DPO)
- Revisão obrigatória: trimestral OU em qualquer mudança de schema RBAC
