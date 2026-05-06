# Gestor PRIMETOUR — Regras e Automações

> Mapa completo das regras automáticas que o sistema aplica sem intervenção do
> usuário, atreladas a hierarquia, permissões e lógica de cada módulo.
> Atualizado em: 2026-05-05 · v3.4.0
>
> **Para que serve este documento**: responder de imediato perguntas como
> *"por que esse usuário não vê a tarefa X?"*, *"por que ela ficou com prioridade
> média?"*, *"por que recebi essa notificação?"*. Cada regra documentada vem
> com **racional** explicando o porquê — não só o "o que".
>
> Documentos relacionados: [`ACCESS-CONTROL.md`](ACCESS-CONTROL.md) (matriz RBAC) ·
> [`DATA-FLOW.md`](DATA-FLOW.md) (PII) · [`GOVERNANCE.md`](GOVERNANCE.md).

---

## Sumário

1. [Hierarquia de papéis (roles)](#1-hierarquia-de-papéis-roles)
2. [Permissões por papel](#2-permissões-por-papel-tabela-canônica)
3. [Visibility scopes — quem vê o quê](#3-visibility-scopes--quem-vê-o-quê)
4. [Auto-provisioning de usuários](#4-auto-provisioning-de-usuários-sso)
5. [Defaults automáticos por módulo](#5-defaults-automáticos-por-módulo)
6. [Cascatas e syncs](#6-cascatas-e-syncs)
7. [Notificações automáticas](#7-notificações-automáticas-quem-recebe-quando)
8. [Validações server-side (rules)](#8-validações-server-side-firestore-rules)
9. [Auditoria automática](#9-auditoria-automática-o-que-é-logado-sem-ação-explícita)
10. [Regras por módulo (com racional)](#10-regras-por-módulo-com-racional)

---

## 1. Hierarquia de papéis (roles)

```
master  ⊃  admin  ⊃  manager  ⊃  coordinator  ⊃  member  ⊃  partner
                                                            (paralelo: external/restricted)
```

| Role | Quem | Racional do nível |
|---|---|---|
| **master** | Diretoria PRIMETOUR | Acesso total + zona de perigo (delete em massa, mudança de role de admin, LGPD erasure de terceiros). Mantido para 1–2 pessoas; cada ação master tem audit log destacado. |
| **admin** | Head de área | Operação diária do sistema sem zona de perigo. Cria usuários, configura squads, gerencia API keys. Pode tudo de master EXCETO `danger_zone_delete_all`. |
| **manager** | Gerente | Foco em equipe + projetos. Vê todas tarefas, aprova férias, importa em lote, edita qualquer tarefa, cria projetos. NÃO mexe em users/roles/system. |
| **coordinator** | Coordenador | Coordena dia-a-dia da operação. Vê todas tarefas; cria/edita as próprias; vê feedback como observador (sem criar para terceiros). |
| **member** | Analista | Operação. Vê e edita tarefas onde é assignee/observer; cria tarefas; dá feedback. **Não** vê tarefas alheias por default. |
| **partner** | Parceiro externo | Só portal de dicas (read-only). Sem acesso ao app principal. |

**Por que essa hierarquia?**
A divisão `master / admin / manager / coordinator / member` espelha a estrutura
funcional da PRIMETOUR. Foi calibrada para que **80% das tarefas operacionais**
caibam em `member` ou `coordinator`, deixando `manager` para chefias e
`admin/master` apenas para configuração estrutural. Quanto menos gente em roles
altos, menor a superfície de risco.

---

## 2. Permissões por papel (tabela canônica)

A versão completa fica em [`ACCESS-CONTROL.md`](ACCESS-CONTROL.md#permissions--roles-resumo).
Aqui resumimos as permissões mais usadas e o racional de quem teve concedido cada uma:

| Permission key | Concedida a | Racional |
|---|---|---|
| `task_create` | master / admin / manager / coordinator / member | Toda pessoa interna pode criar tarefas. Partner não, pois opera só portal de dicas. |
| `task_view_all` | master / admin / manager / coordinator | Coordenadores precisam visibilidade plena pra distribuir trabalho. Member não — vê só onde tem skin in the game. |
| `task_edit_any` | master / admin / manager | Edição transversal só pra chefias. Coordinator edita só as próprias e onde é assignee. |
| `task_delete` | master / admin | Delete é destrutivo (audit log fica, mas a tarefa sai da lista). Apenas chefias. |
| `task_override_urgency` | master / admin / manager | Marcar uma tarefa como "urgente" foge do SLA — exige justificativa + audit. Member não pode pra evitar inflação artificial de urgência. |
| `project_create` | master / admin / manager | Projetos são unidades de planejamento; criar exige visão de portfólio. |
| `project_delete` | master / admin | Delete de projeto desvincula tarefas — alto impacto. |
| `system_manage_users` | master / admin | Criar/editar usuários, mudar role, desativar. |
| `system_manage_roles` | master / admin | Editar a definição dos roles em si (raro). |
| `system_manage_settings` | master / admin | Configurações globais do sistema. |
| `system_view_all` | master / admin | Bypass de visibility scopes. Vê tudo. Crítico — uso parcimonioso. |
| `goals_evaluate` | master / admin / manager | Avaliação periódica de metas exige hierarquia. |
| `feedback_create` | master / admin / manager / coordinator / member | Todos podem dar feedback. |
| `feedback_view` | master / admin / manager | Ver feedback de OUTRAS pessoas exige autoridade hierárquica. Member só vê feedbacks que recebeu. |
| `csat_send` | master / admin / manager / coordinator | Disparar pesquisa CSAT exige autoridade gerencial. |
| `csat_manage` | master / admin | Configuração da feature CSAT. |
| `dashboard_view` | master / admin / manager | Dashboards consolidam dados de múltiplos squads — chefia vê. |
| `analytics_view` | master / admin / manager | GA4 / Meta / SFMC — métricas externas. |
| `workspace_create` | master / admin | Squad é estrutural — criação centralizada evita fragmentação. |
| `workspace_invite` | admin do squad / master / admin | Squad admin pode convidar pro próprio squad mesmo sem role admin no app. |

**Lista completa** das ~36 permission keys: ver `js/store.js` (definições) e
`ACCESS-CONTROL.md` (matriz). Edição de papéis e permissões é feita em
**Configurações → Roles e Acesso** (página `#roles`).

---

## 3. Visibility Scopes — quem vê o quê

Mesmo com `task_view_all`, há filtros de **visibilidade de dados** que aplicam
em camadas:

| Scope | Filtro | Aplicado em |
|---|---|---|
| **own** | `userId == auth.uid` | `tasks` (member), `notes`, `drafts`, `ai_chat_history` |
| **sector** | `sector ∈ userDoc.visibleSectors` | `ai_knowledge` (visibility="sector"), tarefas filtradas por setor visível |
| **squad** | `squadId ∈ userDoc.squads` | tarefas com `squadId` setado, dashboards de squad |
| **all** | `system_view_all == true` | bypass de tudo (apenas master/admin) |

### Regra de visibilidade de tarefa para `member`

Member **vê uma tarefa** quando uma das condições abaixo é verdadeira:

1. É um dos `assignees` da tarefa (foi atribuído)
2. É um dos `observers` (foi adicionado como observador)
3. É o `createdBy` (criou)
4. A tarefa pertence a `projectId` cujo `members[]` o inclui
5. A tarefa pertence a `squadId` que está em `userDoc.squads[]`

**Racional**: skin-in-the-game. Member não precisa ver toda tarefa do app —
isso ruidoso e gera overload cognitivo. Se realmente precisa visibilidade,
sobe pra `coordinator` (que ganha `task_view_all`).

### Regra de visibilidade de meta (Goals)

Para `member`/`coordinator`/`manager` (sem `system_view_all`), o filtro hierárquico
considera o **escopo da meta**:

| Escopo da meta | Quem vê |
|---|---|
| `global` | Todos |
| `area` | Quem tem o setor da meta nos seus `visibleSectors` |
| `nucleo` | Quem tem o núcleo em `userProfile.nucleos[]` OU tem o setor nos `visibleSectors` |
| `squad` | Quem é membro do squad |
| `individual` | O próprio responsável da meta, o gestor da meta, ou quem está atribuído à mesma tarefa do responsável, OU coordenador do setor do responsável |

**Racional**: meta de outro setor não é distração — é informação irrelevante
pra quem não pode atuar nela. Coordenador do setor vê metas individuais da
sua equipe pra acompanhar.

---

## 4. Auto-provisioning de usuários (SSO)

Quando alguém faz login pela 1ª vez via Microsoft SSO:

1. **Allowlist de domínio**: email é validado contra `ALLOWED_SSO_DOMAINS` definido em `js/config.js`. Domínios atualmente autorizados: `@primetour.com.br`, `@primetravel.tur.br`, `@primetouroperator.com.br`. Email fora dessa lista → login rejeitado, sem criação de conta.
2. **Verifica pré-cadastro**: se já existe um documento em `users/{pendingId}` com o mesmo email, consolida — copia os dados (role, sector, squads, nucleos pré-definidos pelo admin) pro novo UID e deleta o pending.
3. **Sem pré-cadastro → defaults**:
   - `role: 'member'` (mais restritivo)
   - `sector: ''` (vazio até admin atribuir)
   - `nucleos: []`, `squads: []`
   - `active: true`
4. **Re-vinculação de squads**: se o user tinha `nucleos[]` no pré-cadastro mas estava em squads pelo `pendingId`, sistema re-vincula pro UID novo automaticamente.
5. **Sync `nucleos → squads`**: para cada núcleo do user, se há squad com mesmo nome, adiciona o user como member do squad. Idempotente (se já é member, skip).
6. **Audit log**: `users.sso_auto_provision` registra criação com nome, email, provider, role.
7. **Notificação a masters**: se o user é totalmente novo (sem pré-cadastro), notifica todos os masters via `notify('user.first_login_pending_assignment')` — assim ninguém fica esquecido sem squad/role.

**Racional**: minimiza atrito de onboarding (admin não precisa pré-cadastrar
cada pessoa) sem comprometer segurança (allowlist de domínio + role default
mais restritivo). O passo de notificação evita o anti-padrão de "usuário cria
conta e some" — admin é forçado a ver e atribuir.

**O que NÃO acontece automaticamente**:
- Atribuição de squad/sector específico (admin faz manual)
- Promoção a `admin` ou roles altos (audit log + ato deliberado)
- Habilitação de MFA (configurada no Azure AD, não no app)

---

## 5. Defaults automáticos por módulo

### Tarefas (`createTask`)

| Campo | Default | Racional |
|---|---|---|
| `status` | `'not_started'` | Estado inicial canônico |
| `priority` | `'medium'` | Mediana — força usuário a escolher quando importa |
| `assignees` | `[]` (vazio) | Sistema **não** auto-atribui ao criador. Decisão consciente: tarefa pode ser pedida e ficar pendente de atribuição. |
| `observers` | `[]` | Adicionados manualmente |
| `dueDate` | `null` | Sem prazo até definir; UI mostra "Sem prazo" |
| `createdBy` | `auth.uid` | Auto-preenchido — sempre rastreado |
| `createdAt` | `serverTimestamp()` | Server-side, não client (evita clock skew) |
| `tags` | `[]` | Vazias |
| `metaLinks` | `[]` | Vínculo com metas é deliberado |

### Goals (`createGoal`)

| Campo | Default | Racional |
|---|---|---|
| `status` | `'rascunho'` | Meta nasce não-publicada — admin revisa antes de tornar visível |
| `escopo` | `'individual'` | Mais restritivo; força usuário a escolher se quer abrir pra área/global |
| `pilares` | `[emptyPilar()]` | Esqueleto inicial pra UX (form não nasce vazio) |

### Calendário de Conteúdo (`createSlot`)

| Campo | Default | Racional |
|---|---|---|
| `status` | `'idea'` | Estado inicial canônico do funil idea→draft→review→approved→published |

### Projetos (`createProject`)

| Campo | Default | Racional |
|---|---|---|
| `status` | `'planning'` | Projeto nasce em planejamento |
| `members` | `[createdBy]` | Criador é membro automático |
| `squadId` | derivado do squad ativo no header (se houver) | Permite que cada squad tenha seus projetos sem mistura |

### Feedbacks (`createFeedback`)

| Campo | Default | Racional |
|---|---|---|
| `date` | hoje | Data padrão |
| `gestorId` | `auth.uid` se o user é gestor; senão exige escolha | Quem dá feedback geralmente é o gestor — autoassign acelera |
| `context` | `''` (vazio) | Força escolha — não há "default" semântico aqui |

---

## 6. Cascatas e syncs

### 6.1 `nucleos[] ↔ squads`

Cada núcleo do usuário (legacy) corresponde a um squad (modelo unificado em
**3.0.0**). Sincronização automática:

- **Trigger**: criação de user via SSO, edição de núcleos pelo admin, importação em lote
- **Ação**: para cada núcleo do user, se existe squad com mesmo nome, adiciona o user como member do squad
- **Idempotente**: se já é member, skip (sem rewrite)
- **Não reverso por default**: remover núcleo NÃO remove o user do squad automaticamente (decisão deliberada — squad pode ter sido evolução)

**Racional**: durante a janela de migração de schema (núcleo → squad), os
dois modelos coexistem. A sync garante que a UI mostre coerência sem exigir
que o admin migre cada user manualmente.

### 6.2 Tipo de Tarefa → Variação → SLA

Quando o user escolhe `Tipo de Tarefa`:
- `Variação` é resetada (lista de variações depende do tipo)
- Quando `Variação` é selecionada, `SLA` é calculado a partir do `slaDays` da variação
- Se `dueDate` não foi setada manualmente, é auto-preenchida com `hoje + slaDays` (pulando finais de semana)

**Racional**: SLA é contratual — automatizar evita erro humano de cálculo.
User pode override manualmente, mas o default vem do SLA cadastrado no tipo.

### 6.3 Setor → Tipo (no Portal de Solicitações)

No `solicitar.html`:
- User escolhe `Setor responsável` → carrega lista de tipos cujo `sector === escolhido` OU sem sector (globais)
- User escolhe `Tipo` → carrega `Variações` daquele tipo
- Núcleos do setor são carregados via `loadNucleosBySector`

**Racional**: portal não pode mostrar todos os tipos a todos — usuários se
perderiam. Filtro hierárquico mantém a UX limpa.

### 6.4 Sync de squads em re-bind de UID (SSO consolidation)

Quando user pré-cadastrado faz 1º SSO:
- Detecta UIDs antigos (`pendingId`) com mesmo email
- Re-bind: troca todos `members[oldId]` → `members[newUid]` em coleção `workspaces`
- Mesmo para `adminIds` se for admin do squad
- Apaga doc antigo

**Racional**: usuário é o **mesmo humano**. UID antigo é apenas placeholder
até autenticar de fato. Sem re-bind, a 1ª autenticação criaria UID novo e o
user "perderia" os squads/squads do pré-cadastro.

---

## 7. Notificações automáticas (quem recebe, quando)

O sistema dispara notificações em ~40 eventos. Lista completa em
`js/services/notifications.js` → `NOTIF_TYPE_LABELS`.

### 7.1 Regras de roteamento

| Tipo de notificação | Quem recebe |
|---|---|
| **Pessoal** (ex: `task.assigned`, `task.commented`) | Apenas o `recipientUserId` definido pelo emissor |
| **Squad** (ex: `squad.member_added`) | Membros do squad afetado |
| **Sistêmica de segurança** (`security.*`, `lgpd.*`, em `SYSTEM_SECURITY_TYPES`) | Todos os masters + todos com permissão `security_alerts_receive` |
| **Atribuição pendente** (1º SSO sem squad) | Todos os masters |

### 7.2 Self-suppression

`notify()` automaticamente **NÃO notifica o ator** — quem causou o evento não
recebe notificação por isso (evita "Você atribuiu a tarefa X a você"). Apenas
em casos sistêmicos (digest, backup) o ator pode aparecer como recipient.

### 7.3 Cron schedule (notificações periódicas)

| Cron | Quando | O quê |
|---|---|---|
| `notificationScheduler` | A cada hora | Detecta `task.overdue` (prazo passou) e `task.deadline_approaching` (24h antes) — emite 1 notificação por tarefa por dia (idempotente) |
| `dailySummary` | Manhã (uma vez por dia) | Resumo do dia — tarefas pendentes, prazo do dia, etc. — só pra quem ativou em preferências |
| `dailySecurityDigest` | 09h BRT | Para masters: tentativas de login falhadas, IPs novos, rate limits atingidos no dia anterior |
| `weeklySecretsAudit` | Segunda 09h BRT | Para masters: secrets > 90 dias sem rotação |

**Racional**: notificação demais = ninguém lê, notificação de menos = pessoas
perdem evento crítico. As regras tentam "interromper" só quando há ação útil.

---

## 8. Validações server-side (Firestore Rules)

Mesmo que o client envie `taskId.assignees = [meuUid]` direto pro Firestore,
as **rules** validam server-side:

| Coleção | Validação principal |
|---|---|
| `tasks` | `auth.uid != null`; `system_view_all` ou owner/assignee/observer pra read; create/update se tem `task_create`/`task_edit_any` ou é o próprio criador |
| `goals` | Read filtrado por escopo + role; write apenas com `goals_manage` |
| `users` | Read próprio + `system_manage_users`; write próprio (campos limitados) ou `system_manage_users` |
| `audit_logs` | Append-only — `update,delete: if false` (mesmo admin não pode apagar histórico) |
| `system_secrets` | `read,write: if false` — zero-trust, apenas Admin SDK acessa |
| `ai_api_keys`, `system_config` | Apenas admin |
| `time_clock_audit` | Append-only |

**Racional**: defense-in-depth. UI esconde ações que user não pode fazer
(ex: botão "Deletar"), MAS as rules são a barreira **real**. Mesmo se alguém
hackar o JS e tentar deletar, Firestore rejeita.

Detalhes completos: `firestore.rules` (no repo) + `tests/firestore-rules.test.mjs`
cobrindo 12 vetores de attack.

---

## 9. Auditoria automática (o que é logado sem ação explícita)

Append-only em `audit_logs` (admin pode ler, ninguém pode editar/deletar).

| Evento | Quando | Detalhes capturados |
|---|---|---|
| `users.sso_auto_provision` | 1º SSO de novo user | uid, email, role, provider, consolidação |
| `users.create` | Admin cria user | uid criado, role, sector, createdBy |
| `users.role_change` | Admin muda role | from, to, by, target |
| `task.create` / `task.update` / `task.delete` | Mutação | taskId, payload diff, by |
| `task.urgency_override` | Marcar como urgente fora do SLA | taskId, justificativa, oldDueDate, newDueDate, by |
| `goal.create` / `goal.publish` / `goal.delete` | Mutação | goalId, escopo, by |
| `feedback.create` | Novo feedback | gestorId, collaboratorId, type, by |
| `lgpd.export_data` / `lgpd.erase_data` | Direitos do titular | uid alvo, by, scope |
| `security.ip_rate_limit_hit` | Rate limit per-IP atingido | function, ip, attempts |
| `security.suspicious_login` | Login de IP novo / fora do horário | uid, ip, ua |
| `system_config.change` | Edição de config global | key, oldValue, newValue, by |
| `ai_api_keys.update` | Key rotacionada | provider, by (key não é logado!) |
| `time_clock.adjustment` | Correção de ponto | userId, oldTime, newTime, justificativa, by |

**Racional**: tudo que pode ser questionado depois ("quem mudou X?", "quando
foi alterado?", "quem deletou?") tem rastro server-side imutável. Audit log é
**append-only** mesmo para master — não há como apagar histórico nem em caso
de comprometimento.

---

## 10. Regras por módulo (com racional)

### 10.1 Tarefas

- **Definição canônica de "minhas tarefas"** (3.6.0+):
  - **Estrita** (`?assignee=me`, KPIs do Meu Painel "Meu desempenho"):
    `t.assignees.includes(uid)`. Mesmo critério em painel e em filtro de
    `#tasks` — garante que o número do KPI bate com a lista após click.
  - **Observada** (`?observer=me`, card "Observando"): `t.observers.includes(uid)
    && !t.assignees.includes(uid)`. Excluímos quem é assignee + observer
    pra não inflar o card "Observando" com tarefas que já contam em "Minhas".
  - **Filtro `archived`**: TODAS as views filtram `!t.archived` por padrão.
    A página `#tasks` faz isso em `applyFilters()` linha 755; o Meu Painel
    faz em `baseTasks` na 3.6.0+. Antes da 3.6.0 o painel não filtrava,
    causando divergência (cards mostravam X, lista mostrava X-archived).
  - **Tarefas "da equipe/setor"**: `visibleTasks` = todas tarefas que o user
    enxerga conforme RBAC (sector visibility + squad membership). Mostradas
    em seção "Equipe / Setor" do Meu Painel separada das "Minhas" — evita
    confusão entre KPI pessoal e capacidade do time.
- **Status VIRTUAL "⚠ Atrasada"** (3.5.0+): além dos 6 status persistidos
  (`not_started`, `in_progress`, `review`, `rework`, `done`, `cancelled`), há
  um **status virtual derivado**: tarefa é considerada *atrasada* quando
  `dueDate < hoje && status !== done && status !== cancelled`. Não é um campo
  no Firestore — é calculado em runtime via `isTaskOverdue(t)` em
  `services/tasks.js`.
  - **Onde aparece**:
    - Kanban (groupBy=status): coluna virtual no início do board, **vermelha**, ✕
    - Toolbar `#tasks` filtro de status: opção "⚠ Atrasada"
  - **Comportamento**:
    - Tarefa atrasada **some** da coluna do status real (não duplica). Ex: tarefa `in_progress` com prazo vencido aparece SÓ em "Atrasada", não em "Em Andamento". Drag&drop pra outra coluna ainda funciona — ao soltar em "Em Revisão", o status muda e o flag overdue continua até atualizar `dueDate`.
    - Filtro `?status=overdue` na URL passa pelo filtro virtual.
  - **Por que virtual e não persistido**:
    1. Estado **temporal** — muda sozinho ao passar da meia-noite, sem cron
    2. Idempotente — não há janela de inconsistência onde "tá atrasada mas o campo não foi atualizado"
    3. Não conflita com workflow — tarefa atrasada continua tendo seu status semântico (`in_progress`, etc.)
  - **Limitação conhecida**: não persiste em audit log como "tarefa entrou em atraso em DD/MM". Se for necessário rastrear, ver `notificationScheduler` que dispara `task.overdue` quando o prazo passa.
- **Quick complete (kanban)**: clicar no botão ✓ marca como `done` direto, sem abrir modal. Atalho UX para completar tarefas simples.
  - **Override de urgência**: marcar tarefa como urgente quando o `dueDate < hoje + SLA_minimo` exige justificativa textual + audit. Evita inflação de urgência (quando tudo é urgente, nada é).
- **Override de tarefa concluída**: reabrir tarefa concluída exige confirmação dupla.
- **Recorrência**: tarefas com `recurrence: { pattern, count }` geram instâncias automaticamente via `runDueRecurrenceGeneration` quando user abre a página de Tarefas. Idempotente (não duplica se já gerou).
- **Atribuição cross-squad**: tarefas podem ter `assignees` de qualquer squad — não há restrição. Vai aparecer no `Meu Painel` do assignee independente do squad.
- **Auto-extract de tags**: criação de tarefa via importação Planner extrai hashtags do título e adiciona em `tags[]`.
- **Deep-link da página `#tasks` via query string** (3.5.0+): página aceita filtros via URL hash:
  - `?assignee=me` ou `?assignee=<uid>` — filtra por responsável
  - `?observer=me` ou `?observer=<uid>` — filtra por observador
  - `?status=in_progress` (ou `overdue`) — filtra por status (incluindo virtual)
  - `?open=1` — só não-finalizadas (`status !== done && !== cancelled`)
  - `?completedToday=1` — só `done` com `completedAt` de hoje
  - `?partnership=1` — só tarefas com `isPartnership: true`
  - `?projectId=<id>` — projeto específico
  - `?workspaceId=<id>` — squad específico
  - **Combinação**: parametros são AND-juntos. Ex: `#tasks?assignee=me&open=1` = "minhas tarefas abertas"
  - **Uso no Meu Painel**: cada KPI card linka pra essa URL com filtro adequado, em vez de abrir tudo. Antes de 3.5.0, cards apontavam pra `#tasks` cru e o user via lista completa, perdendo contexto.

### 10.2 Goals (Metas)

- **Status `rascunho` é invisível**: meta em rascunho aparece **só** pra quem criou + master/admin. Member não vê metas inacabadas.
- **Vínculo tarefa → meta**: ao concluir tarefa vinculada a meta(s), pop-up pergunta se quer marcar como evidência. Vínculo é **multi-instance** (mesma tarefa pode evidenciar múltiplas metas, uma por responsável).
- **Auto-popular link de comprovação** (4.4.2+): se a tarefa tem `deliveryLink` preenchido e `linkComprovacao` está vazio, o pop-up de evidência **pré-popula** o input "Link de comprovação" com `deliveryLink`. Hint visual *"💡 Pré-preenchido com o link da entrega"* aparece. Editável — usuário pode trocar/limpar antes de confirmar. Os campos seguem **separados no schema** (propósitos diferentes: `deliveryLink` é o link que a tarefa entregou, `linkComprovacao` é o que comprova a meta — geralmente são iguais, mas não obrigatoriamente).
- **Conceito "concluída com atraso"** (4.4.2+): tarefa com `status === 'done'` e `completedAt > dueDate`. Diferente de **"atrasada"** (`isTaskOverdue`) que é tarefa AINDA aberta após o prazo.
  - Helper: `wasTaskCompletedLate(task)` em `js/services/tasks.js` retorna `{late: boolean, daysLate: number}`. Cálculo: `Math.floor((completedAt - dueDate) / 86400000)` com normalização de timezones.
  - **Onde aparece**: badge laranja "⚠ Atrasada Xd" na lista de Tarefas Vinculadas em `#goals`; banner laranja "⚠ N de M concluídas com atraso (X%)" no formulário de avaliação (`openEvaluationForm`); chip "ATRASADA Xd" no PDF de metas.
  - **Não bloqueia avaliação** — informação contextual pro gestor calibrar a nota com consciência do prazo.
- **Avaliação periódica**: gestor avalia meta em períodos definidos (`period.frequency`); ao avaliar, sistema calcula `progressoCalculado` ponderado por KPI.
- **Form de avaliação — pickers cascata** (4.4.4+): trocar pilar regenera as opções do picker de meta + reseta meta para a primeira do pilar novo + cascateia regeneração do período. Trocar meta regenera apenas opções de período (via `getPendingPeriods(meta, existingEvals)`). Bug pré-4.4.4: usuário ficava preso na meta inicial.
- **Filtro hierárquico**: já documentado em § 3 acima.

### 10.3 Feedbacks

- **Schedule (rotina)**: feedback agendado dispara notificação `feedback.schedule_due` pro gestor X dias antes do prazo. Idempotente por dia.
- **Visibilidade**: collaborator vê só feedbacks que **recebeu**. Manager+ vê todos do squad. Master vê tudo.
- **Áudio → transcrição**: upload de áudio chama Cloud Function que transcreve via Whisper API e auto-preenche `theme`/`description`. Audio em si é descartado após transcrição (não armazenado).

### 10.4 CSAT

- **Tarefa concluída → pop-up**: ao concluir tarefa com `clientEmail` vinculado, sistema sugere envio de pesquisa CSAT.
- **Auto-scan**: feature "Buscar pendentes" varre tarefas concluídas nos últimos N dias sem CSAT enviado e oferece envio em lote.
- **Email via EmailJS**: envio passa por Cloud Function `sendCsatEmail` (não pelo client) — secret do EmailJS fica em Secret Manager.
- **Token único por survey**: cada CSAT tem URL com `token` único. Cliente responde sem login. Token expira em 30 dias.

### 10.5 Calendário de Conteúdo

- **Status canônico**: `idea → draft → review → approved → published`. Validação server-side rejeita transições "ilegais" (ex: published → idea).
- **Conversão idea → tarefa**: botão `Converter em Tarefa` abre modal de tarefa pré-preenchido. Slot original ganha campo `taskId` linkando.
- **Página pública (`calendario-conteudo.html`)**: read-only, real-time via `onSnapshot`. SSO obrigatório mas não exige permissão específica — qualquer user PRIMETOUR vê o calendário.

### 10.5b Newsletter Performance — Enriquecimento por IA (4.5.0+)

- **Auto-extração de entidades**: cada disparo sincronizado de `mc_performance` é enriquecido automaticamente via IA com base no HTML do email. Sem trabalho do time editorial.
- **Pipeline (cron diário em GitHub Action `mc-sync.yml`)**:
  1. SOAP Send → coleta `EmailID` legacy
  2. REST asset query → HTML + description em batch
  3. `htmlHash = sha256(html)` → cache lookup em Firestore
  4. Se cache miss → Claude Haiku 4.5 extrai entidades (countries, cities, hotels, brands, themes, productTypes, targetAudience, activities, pricePoint, priceRange, sellingPoints) em JSON estrito
  5. Persiste em `mc_performance.extracted` + `htmlHash` + `htmlStats` (ctaCount, imageCount, wordCount)
- **Cache de hash**: emails reusados em múltiplos disparos só são extraídos uma vez. Re-extração só se HTML mudar.
- **Fallback gracioso**: ausência de `ANTHROPIC_API_KEY`, falha LLM ou parse JSON quebrado → sync continua, doc fica sem `extracted` (campo opcional).
- **Custo operacional típico**: ~R$ 30/ano com volume atual (~10 emails novos/dia, ~$0.001/extração). Variável `ENRICH_DISABLED=1` desliga sem mexer no secret.
- **Regra de quando re-rodar**: `workflow_dispatch` com `days=N` força re-sync — útil pra backfill após mudanças de prompt ou novo modelo.

### 10.6 IA Hub

- **Cascata automática de API key**: `ref.scope = 'auto'` faz lookup user → núcleo → setor → global. Primeira chave válida é usada. Permite que gestores configurem keys por equipe sem touch global.
- **Rate limit per-IP**: `callLLM` rejeita após 200 req/min do mesmo IP. Audit log + notificação ao master se IP atingir 3× consecutivos.
- **Budget alerts**: quando user passa do budget mensal definido por agente, notificação automática + agente entra em modo "queue" (rejeita novas chamadas, exige unlock manual).
- **Tools auto vs manual**: agente em modo `auto` carrega TODAS as tools do módulo + tools globais. Em `manual`, apenas as marcadas explicitamente.

### 10.7 Auditoria

- **Append-only**: rules + UI ambas barram update/delete. Nem master pode editar.
- **Filtro automático**: query de logs respeita visibility — manager vê só logs do próprio squad/setor; admin/master vê tudo.
- **Retenção**: 90 dias online + export anual pra GCS Cold (compliance LGPD/SOC 2).

### 10.8 Squads

- **Multi-sector flag**: squad com `multiSector: true` aparece em todos os setores; sem flag, fica só no setor primário.
- **Admin de squad**: usuário em `adminIds[]` do squad pode invitar/remover membros mesmo sem role admin no app — autoridade local de squad.
- **Squad sumindo do filtro**: usuário só vê squads onde está em `members[]`. Não há "lista pública de squads" — minimiza ruído.

### 10.9 Time Clock (ponto eletrônico)

- **Audit append-only obrigatório**: cada batida + cada correção fica em `time_clock_audit` por **5 anos** (CLT). Mesmo erasure LGPD do user **não apaga** esses registros (preserva integridade trabalhista).
- **Correção exige justificativa**: editar batida passada exige campo `justificativa` (audit log).

### 10.10 LGPD endpoints

- **`exportUserData(uid)`**: usuário pode baixar próprios dados (JSON). Master/admin pode exportar de outros (audit log).
- **`eraseUserDataServer(uid)`**: hard delete em `ai_chat_history`, `drafts`, `notes`, `csat_responses`, `notifications`. Anonimização em `tasks`, `comments`, `audit_logs` (preserva integridade referencial mas remove PII). `time_clock_audit` é **preservado** (CLT).
- **`getDataCategories()`**: lista categorias de dados que o sistema processa (direito de informação, LGPD Art. 18 I).

---

## Manutenção deste documento

| Versão | Data | Mudança |
|---|---|---|
| **v1.0** | 2026-05-05 | Primeira versão (junto com app v3.4.0) |

**Quando atualizar**:
- Nova permission key adicionada → atualizar § 2 + `ACCESS-CONTROL.md`
- Novo default automático → atualizar § 5
- Nova cascata/sync → atualizar § 6
- Novo tipo de notificação → atualizar § 7
- Nova coleção Firestore → atualizar § 8
- Mudança de comportamento de módulo → atualizar § 10

Owner: Tech Lead. Revisão obrigatória: a cada release MAJOR + revisão sumária a cada MINOR.
