# Changelog — Gestor PRIMETOUR

Todas as mudanças relevantes do sistema. Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/) — segue [SemVer](docs/VERSIONING.md).

> **Sobre a calibragem inicial**: `js/version.js` foi formalizado em 05/05/2026, no commit `722a2ab`. Antes disso, a app passou por meses de desenvolvimento sem versionamento estruturado (~1.161 commits entre 13/03 e 05/05/2026, incluindo migrações de schema, refactors arquiteturais, novos módulos e hardening de segurança em 5 sprints). Os blocos `[1.x]` e `[2.x]` abaixo consolidam esse histórico em fases retrospectivas; granularidade fina segue em `git log`. A partir de `3.0.0`, todo bump é rigoroso (ver [docs/VERSIONING.md](docs/VERSIONING.md)).

---
































## [4.26.0+20260507-bugs-fix-rename-filter] — 2026-05-07

Release **MINOR** — 4 melhorias do user (3 bug fixes + 1 feature nova).

### 1) Lembretes / Anotações
**Bug**: Modal "Novo lembrete" às vezes recusava o título mesmo quando estava
preenchido.
**Causa**: `document.getElementById('rem-title')` podia retornar input de
um modal residual no DOM (race com double-click ou modal anterior não-fechado),
retornando valor vazio.
**Fix**: capturar refs no escopo do MODAL atual via `modalHandle.getElement()`
+ `querySelector`. Não depende mais de IDs globais. Mesmo tratamento em
`openNoteModal` (texto + cor).

**UX**: cards Lembretes & Anotações migrados pro **TOPO do Meu Painel**
(grid 2-col acima de "Meu Desempenho") — antes ficavam no rodapé direito.
User pediu mais visibilidade.

### 2) Setores legados — permitir renomear
**Pedido**: trocar "Concierge Bradesco" por "Concierge".

**Solução**: cards de setores legados agora têm botão ✎ Renomear que abre
modal com aviso. A função `renameLegacySector(legacy, {newName, color})`:
- Cria doc Firestore com `replacesLegacyName: legacyName` setado
- `getActiveSectors()` agora reconhece esse campo e oculta o nome legado
  da lista (sem deletar — preserva histórico)
- Novo nome aparece em filtros, pickers e na própria página

Tarefas existentes vinculadas ao nome antigo seguem intactas (preservação
de histórico) — UI passa a mostrar o novo nome onde renderiza por nome.

### 3) Tarefas — groupBy + filtro multi-assignee
**Bug**: ao agrupar por responsável e filtrar 2 users no filtro multi,
apareciam grupos extras (de co-responsáveis das mesmas tasks).
**Causa**: `computeGroups('assignee')` iterava por TODOS os assignees
das tasks que passaram pelo filtro, sem checar se cada uid estava no
filtro selecionado. Tasks com 3+ responsáveis criavam grupo pra cada um.
**Fix**: quando `filterAssignee` está setado, restringe os grupos APENAS
aos uids selecionados. Tasks aparecem só nos grupos relevantes.

### 4) Calendário de Conteúdo — filtro fino por tipo de tarefa (NOVO)
**Pedido**: "+ Adicionar tipo de tarefa com exibição opcional".

**Implementação**:
- Novo botão `+ Tipos: todos` ao lado do toggle "Tarefas dos projetos"
  (visível só quando o toggle global está ON)
- Click abre popover com checkboxes dos typeIds usados pelas tasks dos
  projetos ativos (extraídos automaticamente do dataset)
- "Selecionar todos" / "Limpar" / "Aplicar"
- Estado persistido em localStorage `cc-visible-task-types`
  (null = todos visíveis; array = só os listados)
- Aplicado ao filtro: `projectTasksForDate` checa `t.typeId` contra a lista
- Label do botão atualiza dinamicamente: "Tipos: todos" ou "Tipos: N"

### Files
- `js/pages/dashboard.js` (Lembretes/Anotações: refs scoped + reposicionados)
- `js/services/sectors.js` (renameLegacySector + getActiveSectors com replaces)
- `js/pages/sectors.js` (botão renomear + openRenameLegacyModal)
- `js/pages/tasks.js` (computeGroups respeita filterUids em assignee)
- `js/pages/contentCalendar.js` (visibleTaskTypes + popover + filtro)
- `js/version.js`, `index.html`, `CHANGELOG.md`

---

## [4.25.0+20260507-cc-project-task-slots] — 2026-05-07

Release **MINOR** — completa o pacote da v4.24 com a feature deferida.

### Calendário de Conteúdo: slots de tarefa por projeto + flag ocultar
**Pedido**: "Calendário de Conteúdo - incluir os slots de tipo de tarefa
vinculadas aos projetos, com visualização default e ocultar opcional, via flag."

**Implementação**:
- Nova state global `showProjectTasks` persistida em localStorage
  (`cc-show-project-tasks`, default: true)
- `loadProjectTasks()` puxa todas as tasks dos projetos ativos com `dueDate`
  preenchido (executado no boot e ao adicionar/remover projeto)
- `projectTasksForDate(date)` retorna as tasks daquele dia
- `renderTaskSlot(task, mode)` renderiza com estilo distinto:
  - Borda esquerda azul (#0EA5E9) — diferencia de slots de conteúdo dourados
  - Ícone do tipo de tarefa (do task type cadastrado) ou 📋 default
  - Tasks done: opacity 0.55 + line-through
  - Modo `compact` (mês) e `detailed` (semana)
- Toggle button no header — 👁 quando ON, 🚫 quando OFF
- Click em task slot → abre `taskModal` em modo edit
- Após save: recarrega tasks e re-renderiza
- View mês: limita a 3 entries no total (slots + tasks); excedente vira
  "+N tarefa(s)" em itálico azul

### Files
- `js/pages/contentCalendar.js` (state + 3 funções novas + render + handlers)
- `js/version.js`, `index.html`, `CHANGELOG.md`

---

## [4.24.0+20260507-reminders-notes-groupby-fixes] — 2026-05-07

Release **MINOR** — 4 melhorias do user (1 deferido p/ próxima).

### 1) Tarefas: agrupar por responsável
Novo `groupBy === 'assignee'` em tasks.js. Tarefas com múltiplos
responsáveis aparecem em CADA grupo (semântica OR). "Sem responsável"
fica no fim. Label do grupo: iniciais + nome completo + cor avatar.

### 2) Bug do tour: skip exigia 3 cliques
**Causa**: `triggerTourFor` disparava várias vezes (re-render da página)
e welcome modals empilhavam — cada click fechava só 1 backdrop.
**Fix em `tour.js showWelcomeModal`**:
- Idempotente: remove TODOS `.tour-welcome-backdrop` no início
- Cleanup global ao fechar (todos backdrops + ESC handler)
- Click no backdrop (fora do modal) também conta como skip (UX padrão)

### 3) Presence trava no hover
**Causa**: `let tip = null` era closure-scoped dentro de `renderOnlineUsers`.
A cada update de presença (~1/min), novo closure rodava sem referência ao tip
antigo, que ficava órfão no DOM.
**Fix em `header.js`**: limpa qualquer `.online-user-tip` órfão no início de
cada render (defesa em profundidade — mouseleave continua funcionando como antes).

### 4) Lembretes & Anotações no Meu Painel (NOVO)
- Novo serviço `services/userNotes.js` (CRUD + checkDueReminders)
- 2 collections privativas Firestore: `user_notes`, `user_reminders`
  (rules: read/write apenas pelo dono via `userId == request.auth.uid`)
- 2 cards no dashboard direito:
  - **Lembretes**: lista com checkbox concluído, badge de prazo (vencido/hoje/amanhã/em N dias),
    botão "→ tarefa" (converte em task pré-preenchida via taskModal),
    botão excluir. Modal de criar com título + data + checkbox notify
  - **Anotações**: post-its 2-col, 6 cores, click pra editar, ✕ pra excluir
- Toast `warning` on-load se houver lembretes vencidos não notificados
  (uma vez por sessão, marca `notified:true` pra não repetir)

### Deferido p/ 4.25
- Calendário de Conteúdo: slots de tipo de tarefa por projeto + flag de ocultar.
  Escopo grande (mexe em service de slots + render de tipo de tarefa) — tratado
  em release dedicada.

### Files
- `js/services/userNotes.js` (novo)
- `js/components/tour.js` (showWelcomeModal idempotente)
- `js/components/header.js` (cleanup `.online-user-tip` órfão)
- `js/pages/tasks.js` (groupBy assignee + option no select)
- `js/pages/dashboard.js` (mountUserPanels + 2 cards + 2 modais auxiliares)
- `firestore.rules` (`user_notes`, `user_reminders`) — deployed
- `js/version.js`, `index.html`

---

## [4.23.2+20260507-sectors-union-rules] — 2026-05-07

PATCH — fix dois bugs descobertos no E2E da v4.23.0/4.23.1.

### #1 Setores: criação ocultava os 19 legados
**Bug**: ao criar 1 setor novo via UI, os 19 hardcoded (BTG, Marketing, etc.)
sumiam dos filtros e da página de Setores. Causa: `getActiveSectors()` retornava
DEFAULT_SECTORS APENAS quando a collection estava vazia — qualquer doc fazia
substituir, não unir.

**Fix**: nova lógica de UNIÃO em `getActiveSectors()` (services/sectors.js)
e nos consumers (filterBar `getUserSectorOptions`/`areaOpts`):
- Dinâmicos ATIVOS entram primeiro (ordem por `order`)
- Legados SEM doc com mesmo nome entram depois (back-compat)
- Doc com `active:false` REMOVE setor da lista (mecanismo pra "ocultar"
  legados criando um doc com mesmo nome desativado)

### #2 Firestore rules sem regra para `sectors`
**Bug**: createSector falhava com `permission-denied`. Causa: collection
`sectors` (nova em v4.23.0) sem regras → bloqueio default.

**Fix**: adicionada regra em `firestore.rules` (mesmo padrão de `nucleos`):
- read público (portal de solicitações usa)
- create/update/delete: `isAdmin()`
- Deployed via `firebase deploy --only firestore:rules`

### Files
- `js/services/sectors.js` (getActiveSectors com união)
- `js/components/filterBar.js` (getUserSectorOptions + areaOpts com união)
- `firestore.rules` (regra `match /sectors/{sectorId}`)

---

## [4.23.1+20260507-fix-audit-fallback] — 2026-05-07

PATCH — fix bug do histórico no card descoberto no E2E.

### Problema
v4.23.0 trouxe a seção "Histórico de alterações" no taskModal, mas todas as
tarefas mostravam "Sem registros". Causa: o fallback do `fetchEntityHistory`
(quando o composite index `(entity, entityId, timestamp DESC)` não existe)
ainda usava `where('entityId', '==', X) + orderBy('timestamp', 'desc')`, que
TAMBÉM exige composite index — ele só pulava o `where('entity')` mas mantinha
um where + orderBy → mesma falha.

### Fix
Fallback agora é REALMENTE index-free: só `orderBy('timestamp', 'desc')` (single
field, sempre indexado pelo Firestore) com filtro client-side por `entity` E
`entityId`. fallbackLimit subiu de 500 → 1500 pra cobrir tarefas com mudanças
mais antigas (~30 dias de auditoria em uma instalação ativa).

### Files
- `js/auth/audit.js` (fallback corrigido)

---

## [4.23.0+20260507-sectors-history-drilldown-notif] — 2026-05-07

Release **MINOR** — quatro melhorias pedidas pelo user numa única release.

### 1) Setores: CRUD completo (criar, editar, excluir)
**Antes**: lista hardcoded em `services/tasks.js` (REQUESTING_AREAS),
sem como editar via UI. Página de Setores só permitia gerenciar núcleos.

**Agora**:
- Nova collection Firestore `sectors` com `{name, color, order, active, createdAt, createdBy}`
- API: `fetchSectors`, `createSector`, `updateSector`, `deleteSector` (soft delete)
- `loadSectors()` no boot (auth.js), popula `store.get('sectors')`
- `getActiveSectors()` helper — retorna lista dinâmica OU fallback p/ DEFAULT_SECTORS
- Sectors page (`pages/sectors.js`):
  - Botão "+ Novo Setor" no header
  - Botões ✎ editar e ✕ excluir em cada card de setor que tem doc Firestore
  - Modal com nome + cor (12 opções) + ordem de exibição
  - Setores legados (sem doc) aparecem com badge "padrão" — criar setor com mesmo nome para tornar editável
  - Confirmação de exclusão alerta núcleos/usuários afetados
- Consumers principais usam lista dinâmica:
  - `filterBar.js`: `getUserSectorOptions()` e `areaOpts()` — filtros refletem setores criados

### 2) Dashboard Produtividade: cards clicáveis (drill-down)
**Antes**: cards eram estáticos, sem navegação.

**Agora**:
- Cards "Total / Em Andamento / Concluídas / Em Atraso" → click abre lista de tarefas pré-filtrada
- Card "Pontualidade" tem 3 sublinks (no prazo · atrasadas · sem prazo) — cada um navega pra cenário exato descrito
- Novos query params em tasks.js: `?completedOnTime=1`, `?completedLate=1`, `?completedNoDueDate=1`
- Filter logic em `applyFilters()`: compara `completedAt` vs `dueDate` no client
- CSS: `.kpi-sublink` com underline pontilhado + hover dourado

### 3) Notificações: bug do nome (sempre Rafaela Gouvêa)
**Causa raiz identificada**: `notify()` lia `store.get('userProfile')?.name` no momento da
criação. Se `userProfile` ficasse desatualizado/cacheado de uma sessão anterior, o nome
gravado era do user errado. Notificações antigas mantinham o nome legado.

**Fix em duas camadas**:
1. **notify()**: agora resolve o nome do actor pelo `store.get('users')` (source of truth
   atualizado por subscriptions) usando o `currentUser.uid`. userProfile vira fallback.
2. **notificationPanel render**: ao exibir cada notificação, re-resolve o nome do actor pelo
   users store (via `actorId`). Notificações ANTIGAS com nome errado também são corrigidas
   no display, sem precisar reescrever os docs.

### 4) Histórico de alterações dentro do card da tarefa
**Antes**: histórico só visível na página global de Auditoria.

**Agora**:
- Nova função `fetchEntityHistory(entity, entityId, max)` em `auth/audit.js`
  - Query server-side por `(entity, entityId, timestamp DESC)`
  - Fallback client-side se composite index não existir
- Seção "Histórico de alterações" no taskModal (lazy-load on click)
- Timeline mostra: ação legível (ACTION_LABELS), campos alterados (`details.fields`
  → labels em português), transição de status (when applicable), quem e quando
- Resolve nome do autor pelo users store atual (mesma estratégia anti-bug do #3)
- `tasks.update` audit já gravava `details.fields` — só precisei consumir

### Files
- `js/services/sectors.js` (CRUD novo + getActiveSectors)
- `js/pages/sectors.js` (UI de setor + modal + delete)
- `js/auth/auth.js` (loadSectors no boot)
- `js/auth/audit.js` (fetchEntityHistory)
- `js/services/notifications.js` (fix actorName)
- `js/components/notificationPanel.js` (resolve actor no render)
- `js/components/filterBar.js` (consumes lista dinâmica)
- `js/components/taskModal.js` (seção histórico)
- `js/pages/dashboards.js` (kpiCard recebe link, sublinks Pontualidade)
- `js/pages/tasks.js` (3 novos url params + filtros)
- `css/dashboards.css` (.kpi-sublink)
- `js/version.js`, `index.html`, `CHANGELOG.md`

---

## [4.22.0+20260507-icons-phase-a-finalize] — 2026-05-07

Release **MINOR** — fechamento da Fase A de padronização de ícones.
Os 3 itens deixados pendentes em v4.20 (escopo deliberado) agora migrados.

### Pedido do user
> "opere o que restou:
> - Bulk action bar categórica (📅 Prazo, 🔥 Prioridade, 🚦 Status, 👤 Responsável, ▸ Área, ◈ Projeto, ◉ Núcleo)
> - H1 emojis hardcoded em pages individuais
> - Botões ✕ próprios de painéis (insightsPanel, notificationPanel, aiPanel, helpPanel)"

### 1) Bulk Action Bar — botões categóricos em SVG
`bulkActionBar.js`:
- 📅 Prazo → `renderIcon('calendar')`
- 🔥 Prioridade → `renderIcon('flame')`
- 🚦 Status → `renderIcon('flag')`
- 👤 Responsável → `renderIcon('user')`
- ▸ Área → `renderIcon('folder')`
- ◈ Projeto → `renderIcon('briefcase')`
- ◉ Núcleo → `renderIcon('target')`

### 2) Painéis ✕ migrados
- `notificationPanel.js`: close `✕` (header) + dismiss `✕` (cada item) → `renderIcon('x')`
- `aiPanel.js`: chat-close `✕` + attach-chip-remove `✕` → SVG
- `insightsPanel.js`: 4 ocorrências (popover-close, formulário-close, edit ✎ e del ✕ em 2 templates) → `edit-pencil` e `x` SVGs
- `filterBar.js`: botão "✕ Limpar filtros" → SVG x

### 3) H1 emojis removidos
Header global já renderiza ícone canônico via `header.js` + `icons.js`. Emojis
duplicados no `<h1 class="page-title">` viraram ruído visual:
- `help.js`: ❓ Ajuda → Ajuda
- `checkin.js`: ⏱ Check-in → Check-in
- `aiHub.js`: ◈ IA Hub → IA Hub
- `aiAutomations.js`: ⚡ Automações IA → Automações IA
- `aiSkills.js`: ◈ IA Skills → IA Skills
- `aiDashboard.js`: ◈ Dashboard IA → Dashboard IA
- `luxuryTravelAdmin.js`: ⚙ Administrar — … → Administrar — …

**Mantido**: `dashboard.js` "Olá, Nome! 👋" (saudação humana, não chrome).

### Novos ícones em `icons.js`
`flame`, `flag`, `user`, `folder`, `briefcase`, `target`, `minus` — outline
lucide-style, viewBox 24×24, currentColor.

### Files
- `js/components/icons.js`
- `js/components/bulkActionBar.js`
- `js/components/notificationPanel.js`
- `js/components/aiPanel.js`
- `js/components/insightsPanel.js`
- `js/components/filterBar.js`
- `js/pages/help.js`, `js/pages/checkin.js`, `js/pages/aiHub.js`,
  `js/pages/aiAutomations.js`, `js/pages/aiSkills.js`,
  `js/pages/aiDashboard.js`, `js/pages/luxuryTravelAdmin.js`
- `js/version.js`, `index.html`

### Status da Fase A
✅ Header (4.19/4.20) · ✅ Toast (4.20) · ✅ Action buttons taskModal (4.20)
✅ Bulk action bar categórica (4.22) · ✅ Painéis ✕ (4.22) · ✅ H1 emojis (4.22)

User content (B1) — emojis editáveis em projetos/squads/tipos/áreas — segue intacto.

---

## [4.21.0+20260507-multi-assignee-recurrence-cards] — 2026-05-07

Release **MINOR** — três pedidos do user num pacote: filtro multi-responsável,
recorrência editável após criação e fix visual no card kanban.

### Pedido do user
> 1. filtros "por responsável" - ter a possibilidade de selecionar mais de um responsável
> 2. em steps, o botão seletor que vai em cada card está sobreposto à informação de projeto, deixando o visual poluído
> 3. tarefa recorrente: as tarefas importadas do planner não trazem a opção de recorrência. Usuário quer ter o poder de decisão depois da criação.

### 1) Filtro multi-select de responsável
Adicionado `openMultiOptionPicker` / `bindMultiOptionPicker` / `renderMultiPickerButton` em
`optionPicker.js` — popover com checkbox, "Selecionar todos", "Limpar", busca e
contador. Não fecha ao clicar item; só ao clicar fora ou Esc.

`filterBar.js`: `assignee` agora é multi-select. State pode ser `null | string (legacy) | string[] (novo)`.
`buildFilterFn`: passa se a tarefa tem AO MENOS UM dos responsáveis selecionados (OR semantics).

`tasks.js`: filtro próprio também migrado pro multi-picker. Deep-link
`?assignee=uid` segue funcionando (single value vira `[uid]` internamente).

### 2) Card kanban — overlap do checkbox bulk
O `<input type=checkbox>` de seleção em massa (top:8 left:8, w:16 h:16) sobrepunha
o início do título e do nome do projeto do card. Fix em `tasks.css`:
- `.kanban-card-title` e `.kanban-card-project`: `padding-left` 6px → **24px**
- `.kanban-bulk-checkbox`: `opacity:0` por padrão; **aparece on hover** ou
  quando o card está `.bulk-selected` (Monday-style — chrome só quando útil)

Resultado: cards limpos no estado normal; checkbox sutil aparece quando o user
passa o mouse, sem nunca sobrepor texto.

### 3) Recorrência editável após criação
Antes: a seção de recorrência só era renderizada em `!isEdit` (criação). Tarefas
do Planner (importadas) ou criadas anteriormente nunca podiam virar recorrentes.

Agora em `taskModal.js`:
- Seção visível em **edição também** (label muda pra "Tornar tarefa recorrente")
- Tarefas vindas de uma série existente (`recurringFromTemplateId` setado) mostram
  só um aviso + link pra Configurações › Tarefas recorrentes
- Em edição: marcar o toggle + salvar = `updateTask` normal (com stale-check)
  + cria template em paralelo via `createTemplate`. Tarefa atual fica intocada;
  novas instâncias são geradas a partir da `startDate` configurada

### Files
- `js/components/optionPicker.js` (+ ~190 linhas: multi-picker)
- `js/components/filterBar.js`
- `js/pages/tasks.js`
- `js/components/taskModal.js`
- `css/tasks.css`
- `js/version.js`, `index.html`

---

## [4.20.0+20260507-ui-chrome-svg-icons] — 2026-05-07

Release **MINOR** — UI chrome universal: header secondary actions, toasts e botões de ação migram pra SVG.

### Pedido do user
> "pensando por esse mesmo raciocínio, o certo era ter a mesma biblioteca de ícones para tudo, não concorda? projetos, squads, tipo de tarefa, áreas… notificações, paleta de cores, ajuda, dashs, IA…"
>
> "fase a - ok, user content - B1"

### Decisão (escopo Fase A)
- **UI chrome (sistema)** → SVG via `icons.js` (single source of truth).
  Inclui: notificações (sino), busca, paleta, ajuda, toasts (success/error/warning/info + close) e botões universais de ação (✎ editar, ↺ desfazer, 🗑 excluir, + adicionar).
- **User content** → mantém **B1**: emojis seguem editáveis em projetos, squads, tipos de tarefa e áreas (campo aberto, customizável pelo user).

### Implementação
1. `js/components/icons.js` — +21 chaves novas (UI chrome):
   `bell`, `search`, `palette`, `plus`, `edit`, `edit-pencil`, `trash`,
   `rotate-ccw`, `check`, `x`, `check-circle`, `x-circle`,
   `alert-triangle`, `info-circle`, `chevron-down`, `chevron-right`,
   `more-vertical`, `external-link`, `download`, `upload`, `filter`.
2. `js/components/header.js` — botões 🔔/🔍/🎨/❓ → `renderIcon('bell'|'search'|'palette'|'help')`.
3. `js/components/toast.js` — glifos Unicode `✓ ✕ ⚠ ℹ` no ícone do toast → `check-circle / x-circle / alert-triangle / info-circle`. Botão de fechar `✕` → `renderIcon('x')`.
4. `js/components/taskModal.js` — footer: `🗑 Excluir` → `renderIcon('trash') + Excluir`; `✓ Concluir tarefa` → `renderIcon('check') + Concluir tarefa`.
5. `js/components/bulkActionBar.js` — botão `🗑 Excluir` e fechamento `✕` migrados pra SVG.

### Não-objetivos (deliberados nesta release)
- Botões categóricos da bulk action bar (📅 Prazo, 🔥 Prioridade, 🚦 Status, 👤 Responsável, ▸ Área, ◈ Projeto, ◉ Núcleo) — adiados.
- H1 emojis em pages individuais (header global já renderiza ícone canônico) — limpeza pendente.
- Painéis (insights, notification, ai, help) com `✕` próprio — pendente.

### Por que importa
Toast quebrava ao tentar usar variável `ICONS` removida (ReferenceError). Esta release fecha o gap entre a padronização v4.19 (sidebar/header) e o resto do chrome do sistema. User content continua livre — só o sistema ganha consistência visual.

### Files
- `js/components/icons.js`
- `js/components/header.js`
- `js/components/toast.js`
- `js/components/taskModal.js`
- `js/components/bulkActionBar.js`
- `js/version.js`, `index.html`

---

## [4.19.0+20260507-icons-single-source-of-truth] — 2026-05-07

Release **MINOR** — Padronização: ícone do header global = ícone do sidebar.

### Pedido do user
> "os ícones exibidos no sidebar devem ser os mesmos dos exibidos nas páginas"

### Diagnóstico (3 fontes inconsistentes)
| Local | Tipo | Cobertura |
|---|---|---|
| Sidebar | SVG (lucide-style) | 40+ rotas |
| Header global | Glifos Unicode (`⊞`, `✓`, `◈`...) | só 14 rotas |
| Page H1 | Emojis hardcoded em cada page | varia |

### Solução: single source of truth

**NOVO `js/components/icons.js`**: exporta `ICONS` map + `renderIcon(key, opts)`. 41 chaves cobrindo todas as rotas.

**Sidebar**: remove cópia local do ICONS (~75 linhas), importa do módulo. Comportamento idêntico ao anterior.

**Header**: remove glifos Unicode do `PAGE_TITLES`. Cobre 41 rotas (era 14). Renderiza SVG inline via `renderIcon(route, { size: 18 })`.

### Resultado
| Antes | Depois |
|---|---|
| Sidebar SVG `▤ kanban` ≠ Header Unicode `▤` | Sidebar SVG = Header SVG (idêntico) |
| Header só com ícone em 14 rotas | Header com ícone em 41 rotas |

### Próximo passo (não nesta versão)
Remover emojis hardcoded dos H1 das pages individuais (ex: "📱 Calendário de Conteúdo" → "Calendário de Conteúdo"). Polish caso a caso.

### Arquivos alterados
- `js/components/icons.js` — NOVO (~140 linhas)
- `js/components/sidebar.js` — remove ICONS local, importa do módulo
- `js/components/header.js` — PAGE_TITLES expandido + usa renderIcon
- `js/version.js` — bump 4.18.1 → 4.19.0
- `index.html`, `CHANGELOG.md`


## [4.18.1+20260507-kanban-col-reorder-rebuild] — 2026-05-07

Release **PATCH** — bugfix da v4.18.0: rebuild board quando ordem das colunas muda.

### Bug
Drag de coluna salvava ordem em localStorage mas DOM continuava igual. A otimização de `shouldRebuild` ignorava reorder em `groupBy='status'`.

### Fix
Condição agora é `renderedKeys !== expectedKeys` para qualquer groupBy. Reorder muda os values no array, expectedKeys muda, board rebuilda.

### Arquivos alterados
- `js/pages/kanban.js` — condicao do shouldRebuild
- `js/version.js`, `index.html`, `CHANGELOG.md`


## [4.18.0+20260507-kanban-col-reorder] — 2026-05-07

Release **MINOR** — Steps: drag-and-drop pra reordenar colunas (preferência do user).

### Pedido do user
> "usuário quer ter liberdade de mover colunas em steps, pra fazer a própria organização visual do kanban (e isso fica gravado nas preferências dele)"

### Implementação

#### Persistência
- Storage: `localStorage[primetour-kanban-col-order]` como JSON `{groupBy: ['col1','col2',...]}`
- Por groupBy: status, priority, area, sector, project, type, assignee — cada um tem sua ordem própria
- Per-browser (não sincroniza entre devices). Promover pra Firestore `users/{uid}/preferences` depois se houver demanda.

#### Helpers (kanban.js)
- `_loadColumnOrder(groupKey)` → `string[]`
- `_saveColumnOrder(groupKey, order)`
- `_applyColumnOrder(groupKey, cols)` → reordena array preservando colunas novas no fim e ignorando colunas que sumiram

#### `getKanbanGroups`
Aplica `_applyColumnOrder` antes de retornar (status + outros groupBy). Pipeline view (custom task type) **não usa** este sistema — pipeline tem ordem fixa pelos `steps[]` do task type.

#### Header como drop zone
```html
<div class="kanban-column-header" draggable="true" data-col-drag-key="...">
  <span class="kanban-col-drag-handle">⋮⋮</span>
  <div class="kanban-col-dot">...</div>
  ...
</div>
```

Handle `⋮⋮` aparece com opacity 0.4 e fica 1.0 no hover. `cursor: grab` no header inteiro pra UX óbvia.

#### `bindColumnReorder()`
Registra dragstart/dragover/dragleave/drop em cada header. Distingue de card-drag pelo prefixo `COL:` no `dataTransfer`.

#### Não-colisão com card-drag
- Card-drag usa apenas `taskId` no dataTransfer (sem prefixo)
- Column-drag usa `COL:<colKey>`
- `bindColumnDrop` (no col-body) ignora drops com prefixo `COL:` pra não tentar mover task fantasma

### CSS
- `.kanban-column-header:hover` — bg sutil + drag handle aparece
- `.col-dragging` — opacity 0.5 + scale 0.99
- `.col-drag-target` — bg dourado claro + box-shadow inset gold

### Lógica de reorder
1. Pega ordem atual do DOM (data-col-status)
2. Splice fromKey, insert na posição de toKey
3. Salva via `_saveColumnOrder(groupBy, novaOrdem)`
4. `renderCards(allTasks)` re-renderiza com nova ordem aplicada via `_applyColumnOrder`

### Edge cases tratados
- ✅ Coluna nova (não na ordem salva) → vai pro fim
- ✅ Coluna que sumiu (sector desativado) → ignorada na ordem salva
- ✅ Trocar groupBy → ordem específica do novo groupBy é aplicada
- ✅ User sem ordem salva → comportamento padrão (igual antes)

### Arquivos alterados
- `js/pages/kanban.js` — helpers + bindColumnReorder + apply em getKanbanGroups (~+90 linhas)
- `css/tasks.css` — drag handle + estados visuais (~+30 linhas)
- `js/version.js` — bump 4.17.2 → 4.18.0
- `index.html`, `CHANGELOG.md`


## [4.17.2+20260507-doc-staging-lab] — 2026-05-07

Release **PATCH** — Documentação técnica do novo ambiente de staging.

### Pedido do user
> "coloquei uma nova pessoa para trabalhar neste projeto e ele fez a versão staging do sistema. identifique isso no github, analise e adicione à documentação técnica."

### Identificação

Investigação revelou repo `primetour/gestor-btg-lp-builder-lab`:
- Privado, criado 2026-05-06 20:25 UTC
- Owner técnico: **Tiago Prado**
- Commit único `be06110 chore: create sanitized lab baseline`
- 266 arquivos (cópia higienizada do gestor)
- Propósito: validar migração BTG Pactual + evolução do LP Builder em blocos

### Diferenças vs PROD
- 8 workflows movidos pra `.github/workflows.disabled/` (nenhum ativo)
- `.firebaserc` placeholder `STAGING_PROJECT` (Firebase staging ainda não criado)
- Tokens R2 inline removidos do client
- Pages desabilitado (sem URL pública)

### Pendências do LAB
- Criar projeto Firebase dedicado
- Conta R2/Cloudflare staging
- Cadência de sync LAB ↔ PROD

### Arquivos adicionados/atualizados
- **NOVO** `STAGING-LAB.md` (raiz) — diff completo, guardrails, riscos+mitigações, comandos
- `RULES-AND-AUTOMATIONS.md` § 12 — topologia ambientes + referência cruzada
- `js/version.js`, `index.html`, `CHANGELOG.md`


## [4.17.1+20260507-cc-sync-fix-taskid-defensive] — 2026-05-07

Release **PATCH** — bugfix do sync da v4.17.0.

### Bug
A sync `task.dueDate → slot.scheduledDate` da v4.17.0 falhava silenciosamente. `subscribeToTasksByIds` quebrava com:
```
Invalid query. When querying with documentId(), you must provide a valid string or a DocumentReference, but it was: a custom Object
```

### Causa
Algum slot tinha `taskId` salvo como **objeto** (referência?) em vez de string. Um valor errado quebrava a query inteira (Firestore `where(documentId(), 'in', [...])` valida strict). Listener nunca chamava callback → `_linkedTasks` ficava vazio → sync nunca disparava.

### Fix defensivo (2 camadas)
- `subscribeToTasksByIds` filtra: `t => typeof t === 'string' && t.trim()`
- `_bindTasksListener` aplica mesmo filtro antes de passar IDs

Slots com `taskId` mal-salvado ficam órfãos do sync (badge não reflete status), mas o sistema todo não trava mais.

### Validação E2E
- Cria task com `dueDate: 2026-05-10` + slot vinculado com mesma data
- `updateTask(taskId, { dueDate: 2026-05-25 })`
- Aguarda 6s pra listener disparar
- ✅ Slot final: `scheduledDate: 2026-05-25` (sync aplicou)

### Arquivos alterados
- `js/services/contentCalendar.js` — filtro defensivo no service
- `js/pages/contentCalendar.js` — filtro defensivo na page
- `js/version.js`, `index.html`, `CHANGELOG.md`


## [4.17.0+20260507-cc-sync-task-date-to-slot] — 2026-05-07

Release **MINOR** — Sync de data unidirecional: tarefa → slot.

### Pedido do user
> "relação entre slot e tarefa, no calendário de conteúdo: se mudar a data na tarefa, precisa refletir no slot"

### Mudança de comportamento

Na v4.16.0 implementei live lookup com decisão deliberada de **não replicar campos** do slot (slot e task podiam ter datas diferentes). Após feedback do user, agora **sincroniza automaticamente**: quando a `task.dueDate` muda, o `slot.scheduledDate` é atualizado pra acompanhar.

### Implementação

`_syncTaskDatesToSlots(taskMap)` no callback do `subscribeToTasksByIds`:

1. Pra cada `[taskId, task]` no Map de tasks vinculadas:
   - Skip se `task.dueDate` é null
   - Encontra o slot com `slot.taskId === taskId`
   - Normaliza `task.dueDate` pra `YYYY-MM-DD` no fuso local (via `parseLocalDate` + `formatDate`)
   - Skip se já são iguais
2. Aplica `updateSlot(id, { scheduledDate: newDate })` em paralelo
3. Atualiza local cache + re-renderiza body

### Por que **unidirecional** (task → slot)?

Evita loop:
- **Slot tem listener próprio** (`subscribeToSlots`) que atualiza UI mas NÃO escreve na task
- **Task tem este listener** que escreve no slot quando `dueDate` diverge
- **Drag-drop no slot** escreve apenas `slot.scheduledDate` (não toca task)

Se fosse bidirecional, drag-drop no slot mudaria task.dueDate, que dispararia este listener, que escreveria de novo no slot → loop.

### Tolerâncias

- Skip se `task.dueDate` é null/undefined
- Skip se as datas (normalizadas) já são iguais (idempotente)
- Falha de `updateSlot` é silenciosa (permissão, network, etc) — só log no console.debug. Próxima execução do listener tenta de novo.

### UI: badge "↺ sincronizado"

No modal do slot, na seção "Tarefa vinculada", o campo "Prazo" agora mostra um pequeno indicador `↺ sincronizado` com tooltip "A data deste slot acompanha automaticamente o prazo da tarefa."

### Arquivos alterados
- `js/pages/contentCalendar.js` — `_syncTaskDatesToSlots()` novo (~+50 linhas) + label "↺ sincronizado" no modal
- `js/version.js` — bump 4.16.2 → 4.17.0
- `index.html`, `CHANGELOG.md`


## [4.16.2+20260507-cc-ux-add-project-btn] — 2026-05-07

Release **PATCH** — UX: ajuste nos botões do calendário de conteúdo.

### Pedido do user
> "tirar o botão '+ novo projeto' da página e deixar o botão '+ adicionar projeto' no padrão de botões (sem tracejado, cor 'cheia', dentro do botão em si)"

### Mudanças

#### "+ Novo projeto" REMOVIDO
- Botão antigo redirecionava pra `/projects`
- User considerou redundante (já existe em `/projects` direto + ainda há "Ver todos os projetos" no empty state)
- Handler `cc-new-project` em `bindHeaderEvents` também removido

#### "+ Adicionar projeto" — RESTILIZADO

| Antes | Depois |
|---|---|
| Border `dashed` dourada | Sem border |
| Background `transparent` | Background `var(--brand-gold)` (cor cheia) |
| Texto cor dourada | Texto branco |
| Font-weight 500 | Font-weight 600 |
| Padding 4×10px | Padding 6×14px |
| — | Hover: opacity 0.85 |

Mais alinhado com o padrão de botões primários do sistema.

### Arquivos alterados
- `js/pages/contentCalendar.js` — remoção do botão + restilização + handler removed
- `js/version.js` — bump 4.16.1 → 4.16.2
- `index.html`, `CHANGELOG.md`


## [4.16.1+20260507-cc-fix-popover-tdz-shadow] — 2026-05-07

Release **PATCH** — bug crítico do popover "+ Adicionar projeto" que não abria.

### Bug
Click no "+ Adicionar projeto" não fazia nada. Sem console error visível ao usuário porque o erro era `ReferenceError` dentro de bloco try silencioso (não havia try). O popover era criado mas a linha `pop.innerHTML = ...` jogava `ReferenceError: Cannot access 'esc' before initialization`.

### Causa raiz: shadowing + TDZ

A função `_openAddProjectPopover` declara no fim:
```js
const esc = (ev) => { if (ev.key === 'Escape') close(); };
```

Esse `esc` (handler de Escape) **shadows** o `esc` global do módulo (linha 21 — escape HTML). Por causa do TDZ (temporal dead zone) de `const`, **qualquer uso de `esc()` na função** — mesmo nas linhas anteriores ao `const esc = ...` — falha com ReferenceError.

A função usava `esc()` no template do `pop.innerHTML` (escape de `p.id`, `p.name`, `p.icon`) que disparava o erro.

### Fix

Renomeado o handler de `esc` → `escHandler`. Adicionado comentário explicando o pegadinha pra futuros devs não repetirem.

```js
// ATENÇÃO: NÃO renomear `escHandler` pra `esc` — `esc` é a função global
// de escape HTML do módulo (linha 21). Shadow + TDZ causam ReferenceError
// em qualquer uso de esc() acima nesta função (bug 4.16.0 fix).
```

### Detecção
Investigação via console.log step-by-step + `try/catch` revelando o ReferenceError. Tempo de debug: ~30 min.

### Arquivos alterados
- `js/pages/contentCalendar.js` — rename `esc` → `escHandler` + comentário
- `js/version.js` — bump 4.16.0 → 4.16.1
- `index.html`, `CHANGELOG.md`


## [4.16.0+20260507-cc-multi-project-task-snapshot] — 2026-05-07

Release **MINOR** — Calendário de Conteúdo: 3 melhorias pedidas pelo user.

### Pedidos do user
> 1. "tem o slot/ slot transformado em tarefa e precisamos, também, de visualização do slot que virou tarefa e essa tarefa foi concluída"
> 2. "quando slot convertido em tarefa, e tarefa é atualizada/editada, isso precisa ser refletido no slot"
> 3. "opção de ver mais de um calendário ao mesmo tempo (usuário seleciona quantos quiser)"

### Decisões alinhadas com o user
- **D**: badge "✓ Concluída" verde + ícone, sem riscar título
- **A**: live lookup (não replica campos do slot — preserva semântica)
- **B**: chips coloridos com ✕ pra remover, "+ Adicionar projeto" via popover

### Implementação

#### Item 1+2 — Visualização tarefa + reflexão live

**Service `subscribeToTasksByIds(taskIds, callback)`** (NOVO):
- Coleta `taskIds` únicos dos slots com `slot.taskId`
- Chunks de 30 (limite Firestore para `where(documentId(), 'in', [...])`)
- Mantém `Map<taskId, task>` consolidado, atualiza em real-time
- Retorna unsubscribe que cancela todos os listeners

**Page**: `_bindTasksListener()` re-vincula sempre que slots mudam (com signature dedup pra evitar re-subscribe se IDs não mudaram).

**Slot card** com 3 estados visuais distintos:
- 📝 Slot só (sem taskId)
- 🔄 Slot + tarefa **em andamento** — badge amarelo "Tarefa"
- ✓ Slot + tarefa **concluída** — badge verde "✓ Concluída"
- ✕ Slot + tarefa **cancelada** — badge cinza riscado
- Mode compact: só ícone (✓ verde / ● amarelo) pra economizar espaço

**Modal "Tarefa vinculada"**:
- Substitui o banner antigo "Convertido em tarefa"
- Snapshot live: título, status, prazo, concluída em, responsáveis (avatars com iniciais)
- Link "Abrir tarefa →" abre o `taskModal` direto com cached data (zero fetch extra)

#### Item 3 — Multi-projeto

**Service**: `fetchSlots`/`subscribeToSlots` aceitam `projectIds: string[]` (mantém `projectId` single pra retrocompat).

**Page**:
- Estado: `activeProjectIds[]` (substitui `activeProjectId` single, mas mantém espelho)
- URL: `?projects=id1,id2,id3` (CSV) ou `?project=id` (single, legado)
- **Chips bar** abaixo do header:
  - Cada chip mostra ícone + nome do projeto + ✕ pra remover
  - Borda colorida com cor do projeto
  - Botão "+ Adicionar projeto" abre popover com lista filtrável
- **Slot card border-left** colorido com cor do projeto (quando >1 projeto ativo)
- **Slot card mostra projeto** abaixo do status (quando >1)

### UX

```
┌─ Calendário · 2 projetos ──────────────────────────────┐
│ Visualizando múltiplos projetos. Cores = cor do projeto│
├────────────────────────────────────────────────────────┤
│ Projetos: [🎨 Black Friday ✕] [🏖 Verão 2026 ✕]       │
│ + Adicionar projeto                                     │
└────────────────────────────────────────────────────────┘
```

### Arquivos alterados
- `js/services/contentCalendar.js` — `subscribeToTasksByIds` novo, `projectIds` em fetch+subscribe
- `js/pages/contentCalendar.js` — estado multi, chips UI, slot card dinâmico, modal snapshot live, popover "+ projeto"
- `js/version.js` — bump 4.15.1 → 4.16.0
- `index.html`, `CHANGELOG.md`


## [4.15.1+20260507-fix-orphan-permission-projects-manage] — 2026-05-07

Release **PATCH** — auditoria de roles + correção de permission órfã + atualização do RULES-AND-AUTOMATIONS.md.

### Auditoria de roles (resultado)

Cruzei todas as `store.can('xxx')` calls no código vs `PERMISSION_CATALOG` em `rbac.js`:

| Métrica | Valor |
|---|---|
| Permissions no catálogo | 63 |
| Usadas via `store.can()` direto | 36 |
| Usadas via helpers | 8 |
| Catalogadas mas órfãs (0 hits) | 3 (`ai_skills_manage`, `requests_manage`, `audit_logs_view`) |
| **Usadas no código mas fora do catálogo** | **1** (`projects_manage`) ← BUG SILENCIOSO |

### Bug corrigido: `projects_manage`

Em `js/pages/tasks.js:484` o check usava `store.can('projects_manage')` mas essa permission **não existia** no `PERMISSION_CATALOG`. Resultado: sempre retornava `false` (exceto pra master via bypass `isMaster()`).

**Fix**: trocado por `store.can('project_edit')` que existe e é semanticamente o equivalente correto (quem edita projetos pode atribuir/remover tarefas órfãs).

### Documentação atualizada

`RULES-AND-AUTOMATIONS.md` ganhou nova seção **§ 11. Features 4.10–4.15** documentando:
- Presence ativo vs ausente (4.10.0)
- Calendário por projeto (4.11.0)
- Tempo de uso do sistema (4.12.0)
- Bulk update de tarefas (4.13.0)
- Edição inline em células (4.14.0–4.14.1)
- Calendário: drag-drop + real-time + bug fixes (4.15.0)
- Auditoria de permissions + roles personalizadas (4.15.1)

### Roles personalizadas (resposta ao user)

Sistema **suporta** roles custom sem breakage. Master cria em `/roles` → escolhe checkboxes do catálogo de 63 perms. Recomendado usar apenas keys já existentes (não inventar nomes que não casem com `store.can('key')` no código).

### Arquivos alterados
- `js/pages/tasks.js` — fix `projects_manage` → `project_edit`
- `RULES-AND-AUTOMATIONS.md` — +130 linhas (§ 11 novo)
- `js/version.js` — bump 4.15.0 → 4.15.1
- `index.html`, `CHANGELOG.md`


## [4.15.0+20260507-cc-bugs-tz-perm-dragdrop] — 2026-05-07

Release **MINOR** — Auditoria criteriosa do Calendário de Conteúdo. Corrige 3 bugs reportados + 3 colaterais + adiciona real-time.

### Bugs reportados pelo user
> "tarefas colocadas no calendário não podem ser alteradas (sistema não registra alteração)"
> "calendário está alterando data (usuário seta dia 8 e sistema registra dia 7)"
> "não há opção de drag and drop"

### Bug 1 — Timezone (dia 8 → dia 7) [CRÍTICO]

**Causa raiz**: `new Date('2026-05-08')` em JS é interpretado como UTC midnight. No fuso UTC-3 (Brasil), vira `2026-05-07T21:00:00`. Display perdia 1 dia.

**Fix**: helper `parseLocalDate(value)` que retorna `Date` no fuso local (constrói com meio-dia pra robustez contra DST). Substituídas TODAS as 8 ocorrências de `new Date(s.scheduledDate)` em `pages/contentCalendar.js`:
- `slotsForDate()` — filter da view mensal
- `renderListView()` — filter + sort
- `renderSlotCard()` — display compact e detalhado
- `openSlotModal()` — pré-população do input date
- `openSuggestWeekModal()` — sugestões IA
- Helpers de export PDF/XLS

### Bug 2 — Edição silenciosa [ALTO]

**Causa raiz dupla**:
1. `updateSlot()` no service só permitia master, `content_calendar_manage` ou owner. **Membro do projeto** não conseguia editar slots criados por colega.
2. Toast catch usava mensagem genérica "Erro ao salvar slot" — escondia "Permissão negada".

**Fix**:
- **Permissão alinhada ao modelo de projetos (v4.11+)**: agora qualquer member do projeto do slot pode editar. Lookup feito no `updateSlot` lendo `projects/{slot.projectId}.members`.
- **Toast usa `e.message` real** em handleSave + handleDelete

### Bug 3 — Drag and drop [FEATURE]

**Implementado**:
- Cards de slot com `draggable="true"` (apenas modo non-compact por enquanto, mas a classe é a mesma)
- `cc-day-cell` com handlers `dragover` / `dragleave` / `drop`
- Drop dispara `updateSlot(id, { scheduledDate: novaData })`
- Visual feedback: card arrastado fica `opacity:.4` + rotação leve; cell destino destaca com bg dourado + box-shadow

CSS injetado idempotentemente via `ensureCalendarStyles()` (não tem css/contentCalendar.css). Classes:
- `.cc-slot-card.cc-dragging`
- `.cc-day-cell.cc-drag-over`

### Bonus — Fase 2: Real-time

Adicionado `subscribeToSlots(callback, filters)` no service. Page agora usa listener `onSnapshot` em vez de fetch único:
- Mudanças de outro user aparecem automaticamente
- Cleanup via `destroyContentCalendar()` exportada para o router
- `setActiveProject()` reinicia listener com novo scope

### Arquivos alterados
- `js/services/contentCalendar.js` — `subscribeToSlots`, `updateSlot` com lookup de projeto, `onSnapshot` import
- `js/pages/contentCalendar.js` — `parseLocalDate` helper, ~10 substituições, drag handlers, listener wiring, CSS injection
- `js/version.js` — bump 4.14.3 → 4.15.0
- `index.html`, `CHANGELOG.md`


## [4.14.3+20260507-kanban-add-btn-top] — 2026-05-07

Release **PATCH** — UX: botão "+ Adicionar tarefa" no Steps movido pro topo da coluna.

### Pedido do user
> "trocar a localização do botão '+ Adicionar tarefa', que hoje está na parte inferior da coluna, para abaixo do título da coluna"

### Mudança

Antes: botão no rodapé da coluna (precisava scrollar coluna inteira pra encontrar).
Depois: botão logo abaixo do header da coluna (sempre visível).

### Implementação

#### `js/pages/kanban.js`
- `renderColumn()` (kanban view) — botão movido pra antes do `kanban-col-body`
- `renderPipelineColumn()` (pipeline/esteira view) — mesma mudança
- Classe adicionada: `.kanban-add-btn-top` pra variante visual
- Mantido `data-add-status` / `data-add-step` / `data-type-id` (sem mudança no handler de click)

#### `css/tasks.css`
- `.kanban-add-btn.kanban-add-btn-top` — margens e padding mais compactos
- `text-align: center` (ao invés de `left`) pro centro
- Hover: bordas sólidas (mais clean)

### Arquivos alterados
- `js/pages/kanban.js` — 2 funções de render alteradas
- `css/tasks.css` — variante `.kanban-add-btn-top`
- `js/version.js`, `index.html`, `CHANGELOG.md`


## [4.14.2+20260507-fix-bulkbar-stack-overflow] — 2026-05-07

Release **PATCH** — corrige bug crítico no bulkActionBar (existia desde v4.13.0).

### Bug
RangeError: Maximum call stack size exceeded — `show()` → `update()` → `show()` em loop infinito.

```js
// ANTES (bugado)
show()   { ...; this.update(); }      // chama update
update() { ...; if (n) this.show(); } // chama show de novo → recursão
```

Sintoma: ao tentar abrir popover de inline edit (incluindo o novo Tipo/Etapa da v4.14.1), o navegador travava silenciosamente. Os testes passavam quando a bulk bar não estava montada (primeira interação), mas qualquer interação subsequente disparava stack overflow.

### Fix
Helper `_setVisible(visible, count)` único que faz o trabalho. `show()`/`hide()`/`update()` apenas chamam ele com flags diferentes, sem recursão.

### Arquivos alterados
- `js/components/bulkActionBar.js` — refator do API público (~+10 linhas, -10)
- `js/version.js` — bump 4.14.1 → 4.14.2
- `index.html`, `CHANGELOG.md`


## [4.14.1+20260507-inline-edit-typestep] — 2026-05-07

Release **PATCH** — Adiciona Tipo/Etapa à edição inline na lista.

### Pedido do user
> "faltou fazer em tipo/etapa"

### Implementação

#### Novo: `openTypeStepPopover(anchor, { onPick, task, allTaskTypes })`

Popover **dual** com 2 seções:
1. **TIPO** — lista todos os tipos disponíveis: built-in (Padrão, Newsletter) + custom types do Firestore
2. **ETAPA** — depende do tipo atual:
   - Newsletter → 9 NEWSLETTER_STATUSES (Pauta, Conteúdo técnico, Redação, Design, Revisão, Tarifa e dispo, Agendado, Disparado, Análise de Dados)
   - Custom types → seu array `steps[]`
   - Padrão (sem tipo) → mensagem "este tipo não tem etapas"

### Lógica de patch

Click numa **Tipo**:
- Se mudou de tipo → patch limpa step antigo (`newsletterStatus: ''` ou `customFields.currentStep: ''`) pra forçar re-escolha consistente
- `task.type` recebe valor built-in ou null
- `task.typeId` recebe id do custom type ou null

Click numa **Etapa**:
- Se tipo é Newsletter → patch `{ newsletterStatus: v }`
- Se tipo é custom → patch `{ customFields: { ..., currentStep: v } }`

### `tasks.js`

- Cell "Tipo/Etapa" virou `class="task-cell-edit" data-edit-field="typeStep"`
- Switch case adicionado em `_openInlineEditPopover` chamando `openTypeStepPopover` com `pageTaskTypes`

### Arquivos alterados
- `js/components/taskPopovers.js` — `openTypeStepPopover` (~+130 linhas)
- `js/pages/tasks.js` — cell clickable + case 'typeStep'
- `js/version.js` — bump 4.14.0 → 4.14.1
- `index.html`, `CHANGELOG.md`


## [4.14.0+20260507-inline-edit-cells] — 2026-05-07

Release **MINOR** — Edição inline em células de tarefa, sem abrir o modal.

### Pedido do user
> "seria interessante mudar o status, area, prazo e responsáveis da tarefa sem ter que abrir ela"

### UX entregue
- **Hover em célula editável** → background dourado + cursor pointer (sinal claro)
- **Click numa célula** → popover ancorado (mesmo estilo dos do bulk)
- **Click numa opção** → updateTask single + toast "Atualizado · X"
- **Não abre o modal** — só o título da tarefa abre modal (comportamento original)

### Campos com inline edit

| View | Campos |
|---|---|
| Lista (Tarefas) | Status, Área, Prazo, Responsáveis |
| Kanban (Steps) | Prazo, Responsáveis (status segue via drag-and-drop) |

> **Por que kanban não tem status inline?** Drag entre colunas já é o método primário pra mudar status — duplicar via popover gera ambiguidade. Bulk select continua disponível pra mudanças em massa.

### Refator: `taskPopovers.js` (NOVO)

Popovers extraídos do `bulkActionBar.js` e centralizados num módulo compartilhado:
- `openDueDatePopover(anchor, { onPick, currentValue })`
- `openStatusPopover(anchor, { onPick, currentValue })`
- `openAreaPopover(anchor, { onPick, currentValue })` — **NOVO** (REQUESTING_AREAS)
- `openAssigneesPopover(anchor, { onPick, currentValue, allUsers, multi })`
- `openPriorityPopover` / `openProjectPopover` / `openNucleoPopover` (também disponíveis)
- `closeTaskPopover()` — utilitário

Cada popover destaca o valor atual com `✓` em cor dourada.

### `bulkActionBar.js` agora delega

Removidas ~280 linhas de implementação duplicada. O bulk bar agora é DRY:
```js
function popDueDate(btn)   { openDueDatePopover(btn,   { onPick: applyPatch }); }
function popStatus(btn)    { openStatusPopover(btn,    { onPick: applyPatch }); }
// ... etc
```

Bonus: bulk bar ganhou botão **▸ Área** (popover já existia, só faltava expor).

### `tasks.js` (Lista)

- 4 cells com `class="task-cell-edit" data-edit-field="..." data-edit-id="..."`
- Click delegate captura `[data-edit-field]` e chama `_openInlineEditPopover(cell, field, task)`
- Helper aplica `updateTask` single + atualiza local cache + re-renderiza sem refetch

### `kanban.js` (Steps)

- 2 cells (due + assignees) com `class="kb-cell-edit"`
- Mesmo flow: handler intercepta antes do `openTaskModal`
- `e.stopPropagation()` evita conflito com drag-and-drop

### CSS

```css
.task-cell-edit:hover, .kb-cell-edit:hover {
  background: rgba(212, 168, 67, 0.10);
  box-shadow: inset 0 0 0 1px rgba(212, 168, 67, 0.35);
}
```

### Arquivos alterados
- `js/components/taskPopovers.js` — NOVO (~370 linhas)
- `js/components/bulkActionBar.js` — refatorado (-280 linhas)
- `js/pages/tasks.js` — cells clickable + handler (~+50 linhas)
- `js/pages/kanban.js` — cells clickable + handler (~+40 linhas)
- `css/tasks.css` — `.task-cell-edit`, `.kb-cell-edit` hover styles
- `js/version.js` — bump 4.13.0 → 4.14.0
- `index.html`, `CHANGELOG.md`


## [4.13.0+20260507-bulk-task-update-monday-style] — 2026-05-07

Release **MINOR** — Atualização em massa de tarefas estilo Monday.com, na lista E no Steps (Kanban).

### Pedido do user
> "atualização em massa, pra alterar prazo, prioridade, status, responsável... de preferência, direto na lista/steps... usuario relata function que existe no app monday"

### Decisões alinhadas
- **Escopo B**: Lista + Steps (Kanban) — mesma versão
- **Sem Undo** (B) — confirmação dupla apenas no delete

### UX implementada
1. Cada linha de tarefa (lista) e cada card (Steps) ganha um **checkbox** sempre visível
2. Ao selecionar ≥1 tarefa, **action bar flutuante** desliza pelo rodapé
3. Action bar mostra **6 ações** + delete:
   - 📅 Prazo · 🔥 Prioridade · 🚦 Status · 👤 Responsável · ◈ Projeto · ◉ Núcleo · 🗑 Excluir
4. Click numa ação abre **popover** com opções (popovers contextualizados por tipo)
5. Click numa opção dispara **batch update** via Firestore writeBatch
6. Toast confirma "N tarefas atualizadas — alteração: X"

### Implementação

#### `js/components/bulkActionBar.js` (NOVO — componente compartilhado)
- `mountBulkActionBar({ getSelectedIds, getSelectedTasks, onClear, onAfterUpdate, allProjects, allUsers })`
- Barra flutuante com `transform` animation (slide-in/out do rodapé)
- Popovers por ação: prazo (date input + remover), prioridade (4 cores), status (5 estados), responsável (multi-select com search), projeto (search), núcleo (12 opções), delete (confirmação dupla)
- Reutilizado em ambas as páginas — DRY total

#### `js/services/tasks.js`
- `bulkUpdateTasks(items, onProgress)` — JÁ EXISTIA, signature `[{id, data}]`. Reuso direto.
- `bulkDeleteTasks(ids, onProgress)` — NOVO. Batches de 400, audit log, invalidate cache

#### `js/pages/tasks.js` (Lista)
- State: `_selectedTaskIds = new Set()` + `_bulkBar`
- `renderTaskRow`: nova primeira coluna com checkbox `.bulk-checkbox`
- `renderListHeader`: master-checkbox que seleciona/desmarca tudo
- Click delegation pra checkbox (toggle individual + master)
- `_refreshBulkUi()` — re-pinta linhas selecionadas (border dourada) + atualiza master + show/hide bar

#### `js/pages/kanban.js` (Steps)
- State idêntico: `_selectedTaskIds` + `_bulkBar`
- `renderKanbanCard`: checkbox no canto superior esquerdo (par com check de done à direita)
- Click handler pro checkbox (com `e.stopPropagation` pra não abrir modal)
- `_refreshKanbanBulkUi()` — pinta cards com `box-shadow: 0 0 0 2px gold` + bar update

#### CSS `css/tasks.css`
- `.task-row` grid-template-columns: nova coluna 28px no início
- `.task-row.bulk-selected` — bg dourado claro + border dourada
- `.task-list-header` grid alinhado
- Mobile breakpoints atualizados (1024px, 640px)

### Performance
- Firestore writeBatch (max 400 ops/batch) — atualiza centenas de tarefas em 1 RTT
- Para >400, função chunca em múltiplos batches sequenciais
- `invalidateTasksCache()` + `onAfterUpdate` re-fetch pra UI atualizar

### Permissões
- `bulkUpdateTasks` confia que página filtrou tarefas que user pode ver
- Firestore rules vão rejeitar tarefas que o user não pode editar (batch atômico — se 1 falha, todo o batch rollback)
- Em produção, recomendado filtrar IDs editáveis client-side antes do submit

### Arquivos alterados
- `js/components/bulkActionBar.js` — NOVO (~340 linhas)
- `js/services/tasks.js` — `bulkDeleteTasks` adicionada
- `js/pages/tasks.js` — checkbox + bulk handler + `_refreshBulkUi` (~+80 linhas)
- `js/pages/kanban.js` — checkbox + bulk handler + `_refreshKanbanBulkUi` (~+60 linhas)
- `css/tasks.css` — grid-template-columns + estilos bulk-selected (~+15 linhas)
- `js/version.js` — bump 4.12.0 → 4.13.0
- `index.html`, `CHANGELOG.md`


## [4.12.0+20260507-presence-daily-usage-widget] — 2026-05-07

Release **MINOR** — Tempo de uso do sistema agora é trackado e exibido no dashboard de produtividade.

### Pedido do user
> "usuarios online/ausente (presence): colocar no dash de produtividade o tempo de uso no sistema (com os mesmos filtros do dash)"

### Implementação

#### Schema novo: `presence_daily`
```
presence_daily/{uid}_{YYYY-MM-DD} {
  uid, userName, email, sector, nucleos[],
  date: 'YYYY-MM-DD',
  activeMs, idleMs, totalMs,
  lastSeen, updatedAt,
}
```

#### `presence.js` — acumulador atomic
Cada heartbeat (a cada 2-5min) calcula o delta desde o último write. Se o gap ≤ 10min (continuidade de sessão), incrementa `totalMs` e `activeMs`/`idleMs` (conforme state anterior) via `FieldValue.increment(delta)`. Gaps > 10min (user offline, abas todas fechadas) NÃO contam — preserva semantics de "tempo realmente usando".

#### `services/presenceUsage.js` (novo)
- `fetchUsageByPeriod({ from, to, userIds, sectors, nucleos })` — busca docs do período + agrega por usuário, retorna breakdown ordenado por totalMs desc
- `summarizeUsage(breakdown)` — totais agregados (users, totalH, activeH, idleH, avgMsPerUser, activePct)
- `formatDuration(ms)` — string amigável "12h 34min" / "45min"

#### Widget `presence-usage-widget` no dashboard de produtividade
Posicionado entre os blocos R3 e Insights:
- **6 KPI cards**: Usuários ativos · Tempo total · Tempo ativo · Tempo ausente · Média/usuário · % Ativo
- **Leaderboard top 10**: avatar + nome + setor + dias ativos + barra de progresso + duração
- Empty state com explicação clara quando não há dados (período antes da feature)

Herda **automaticamente** os filtros do dashboard:
- Período (7d / 30d / 90d / 12m / custom)
- Usuário, Núcleo, Setor

#### Firestore rules
```
match /presence_daily/{docId} {
  allow read:   if isAuth();
  allow write:  if isAuth() && request.resource.data.uid == request.auth.uid;
  allow delete: if isAdmin();
}
```

### Cost analysis
Para 200 users com 30% idle:
- Heartbeats: ~720/dia ativo + 288/dia idle = ~510 writes/user/dia
- Cada heartbeat agora escreve em 2 docs (presence + presence_daily)
- Total: ~204k writes/dia (-15% vs estimativa anterior por skip-when-state-unchanged)
- Storage: 200 docs/dia em presence_daily = 73k docs/ano (manageable)

### Nota importante
Os dados de uso começam a acumular **a partir desta versão**. Períodos passados aparecerão vazios. Em 7-30 dias o dashboard estará populado e útil.

### Arquivos alterados
- `js/services/presence.js` — daily accumulator no writeHeartbeat
- `js/services/presenceUsage.js` — NOVO arquivo (fetch + summarize + format)
- `js/pages/dashboards.js` — widget presence-usage-widget + chamada no flow principal
- `firestore.rules` — collection presence_daily
- `js/version.js` — bump 4.11.1 → 4.12.0
- `index.html` — cache-bust v=


## [4.11.1+20260507-cc-fix-container-id-race] — 2026-05-07

Release **PATCH** — bugfixes encontrados em testes da v4.11.0.

### Bug 1: Container ID errado (Empty state mesmo com projeto selecionado)
`renderContentCalendar()` e `setActiveProject()` faziam fallback pra `document.getElementById('main')`, mas o container correto é `#page-content`. Resultado: a UI re-renderizava num container fantasma; o `#page-content` continuava com o HTML do empty state inicial.

Fix: `document.getElementById('page-content') || document.getElementById('main')` em ambos os pontos.

### Bug 2: Race condition na migration cria projeto "Geral · Conteúdo" duplicado
Duas chamadas concorrentes de `ensureGeneralProjectAndMigrateOrphans()` (provavelmente do hashchange disparando renderContentCalendar 2x) competiam: ambas viam `projSnap.empty=true` e criavam doc Firestore. Resultado: 2 projetos "Geral · Conteúdo" no banco.

Fix em 2 camadas:
1. Set `sessionStorage[migration-flag]='in-progress'` IMEDIATO (síncrono) antes de qualquer await — bloqueia segunda call
2. Quando query encontra múltiplos projetos com mesmo nome, escolhe o **mais antigo** (createdAt menor) como canônico

### Limpeza manual
A duplicata existente em produção foi arquivada manualmente via JS no browser (renomeada com sufixo "(duplicata · arquivado)").

### Arquivos alterados
- `js/services/contentCalendar.js` — defesa contra race condition
- `js/pages/contentCalendar.js` — fix container ID em 2 pontos
- `js/version.js` — bump 4.11.0 → 4.11.1
- `index.html` — cache-bust v= alinhado


## [4.11.0+20260507-content-calendar-by-project] — 2026-05-07

Release **MINOR** — Calendário de Conteúdo agora é organizado por **projeto**, não mais global.

### Pedido do user
> "calendário de conteúdo: separar por projetos, e não ter um global. usuario acessa calendário de interesse via filtro."

### Decisões de design (alinhadas com o user)
1. **Projeto = collection `projects` existente** — reaproveita permissões/squads
2. **Projeto coexiste com `account`** — projeto = "qual campanha/iniciativa?" · conta = "qual handle posta?"
3. **Migração A**: cria projeto "Geral · Conteúdo" e atribui slots órfãos automaticamente
4. **"+ Novo projeto"** redireciona pra `/projects` (não abre modal inline)

### Implementação

#### Schema
- Slot ganha campo `projectId: string` (referência a `projects/{id}`)
- Migration idempotente `ensureGeneralProjectAndMigrateOrphans()`:
  - Procura ou cria projeto "Geral · Conteúdo" (icon 📋, status `always_on`)
  - Atribui slots sem `projectId` ao projeto Geral
  - Idempotência via `sessionStorage[cc-orphan-migration-v1]`

#### Service `contentCalendar.js`
- `fetchSlots({ projectId })` — novo filtro
- Nova função `ensureGeneralProjectAndMigrateOrphans()` exportada

#### Page `contentCalendar.js`
- **State**: `activeProjectId`, `availableProjects[]`
- **URL**: `#content-calendar?project=ABC` (bookmarkable, sincronizado via `history.replaceState` pra não disparar re-route)
- **Header**: seletor de projeto **prominente** (border dourada, primary scope) + botão "+ Novo projeto"
- **Sem projeto selecionado**: empty state com ícone 📂 + CTA "↗ Ver todos os projetos" → `/projects`
- **Com projeto**: header mostra "📱 Calendário · 📦 Nome do Projeto"; calendário mês/semana/lista filtrado
- Conta (`@handle`) continua como filtro secundário **dentro** do projeto

#### Modal de criar/editar slot
- **Banner do projeto** no topo do modal (bg colorido com ícone+nome)
- Link "Trocar de projeto →" leva pra `/projects`
- `getFormData()` injeta `projectId` automaticamente:
  - Editando: mantém `editingSlot.projectId` original
  - Criando: usa `activeProjectId`
- Validação em `handleSave()`: bloqueia criação sem projeto

#### Convert-to-task
- Tarefa gerada herda `projectId` do slot → entra automaticamente no projeto correto

### Backward-compatibility
- Slots existentes sem `projectId` migram pra "Geral · Conteúdo" no primeiro acesso
- URL antiga `#content-calendar` continua válida (mostra empty state em vez de calendário global)
- Função `account` mantida — só muda de scope-principal pra filtro-secundário

### Arquivos alterados
- `js/services/contentCalendar.js` — +85 linhas (migration + filter)
- `js/pages/contentCalendar.js` — +120 linhas (selector, URL state, empty state, modal banner, convert-to-task)
- `js/version.js` — bump 4.10.0 → 4.11.0
- `index.html` — cache-bust v= alinhado


## [4.10.0+20260507-presence-idle-detection] — 2026-05-07

Release **MINOR** — presence agora distingue **ativo** vs **ausente** (inatividade real).

### Problema reportado pelo user
> "se eu abro o sistema, ele me deixa como online, mas o ideal é medir inatividade para entender se user realmente esta on line, né?"

A implementação anterior só validava "aba aberta" (heartbeat a cada 2min). Se o user abria o sistema e ia pegar café 1h, continuava aparecendo como online — gerando ruído na lista de "Usuários on-line".

### Solução

Detecção de inatividade real via 2 sinais:
1. **Eventos de interação** — `mousedown`, `mousemove`, `keydown`, `scroll`, `touchstart`, `wheel`, `click` (capture phase, throttled a 1s)
2. **Visibilidade da aba** — `document.visibilitychange`: aba escondida → idle imediato; visível → reset

State derivado a cada heartbeat:
- `document.hidden === true` → `'idle'`
- `now - lastActivity > 5min` → `'idle'`
- caso contrário → `'active'`

Heartbeat adaptativo:
- Active: 2 min (igual antes)
- Idle: 5 min (-60% writes quando ausente)
- Skip writes redundantes quando state não mudou e dentro da janela
- Transição idle → active força um heartbeat imediato pra UI atualizar rápido

Doc presence agora tem `state: 'active' | 'idle'` + `lastActivityAt` (ms timestamp). Listener separa em `store.onlineUsers` (ativos) e `store.idleUsers` (ausentes).

### Header UI

- Resumo dinâmico: "5 ativos · 2 ausentes" (em vez do antigo "Usuários on-line:")
- Avatares dos ativos com bolinha verde (#22C55E), opacity 1.0
- Avatares dos ausentes com bolinha amarela (#F59E0B), opacity 0.7
- Tooltip mostra o status: "● ativo agora" ou "● ausente há X min"
- Dropdown "+N" agrupa por seção: 🟢 Ativos / 🟡 Ausentes

### Custos

Para 200 users com ~30% idle a qualquer momento:
- Antes: 200 × 720 = 144k writes/dia
- Agora: 140 × 720 + 60 × 288 = ~118k writes/dia (-18%)

### Arquivos alterados
- `js/services/presence.js` — refatoração completa (rewrite, +60 linhas)
- `js/components/header.js` — UI separa active/idle, tooltip + dropdown atualizados
- `js/version.js` — bump 4.9.3 → 4.10.0
- `index.html` — cache-bust v= alinhado


## [4.9.3+20260506-fix-resize-disparos-envios] — 2026-05-06

Release **PATCH** — corrige 2 problemas reportados pelo user nas tabelas:

1. *"a primeira [Disparos] está com colunas em que as palavras aparecem cortadas"* — tabela **Disparos** (aba Performance) agora tem resize-handles em **todas** as colunas, larguras default mais generosas, e botão "↺ Reset colunas".
2. *"a outra [Envios] deixou a coluna C vinculada a B, criando um aspecto estranho, desajeitado"* — bug no resize da tabela **Envios** (aba Conteúdo) corrigido. O drag de uma coluna fazia as colunas vizinhas "se moverem junto" porque o handler usava `getBoundingClientRect().width` para capturar widths de TODAS as colunas no `mouseup` (e o browser distribuía espaço extra entre cols sem width explícita devido a `width:max-content` + `min-width:100%`).

### Bugfix Envios (`renderEnrichedSendsList` + `wireEnviosColResize`)
- `<table style="width:max-content;min-width:100%">` → `<table style="width:${totalW}px">` (largura explícita = soma das cols, scrollada pelo wrapper).
- `wireEnviosColResize` agora mantém um `state[]` de larguras explícitas por coluna. No `mousemove` atualiza só o índice arrastado, no `mouseup` salva esse mesmo array — não captura widths renderizadas via `getBoundingClientRect`.
- Adicionado `document.body.style.cursor = 'col-resize'` durante o drag.

### Resize tabela Disparos (`renderTable`)
- Substituídas as 3 colunas sticky (BU, Data, Nome) + 11 scroll-cols por uma única `<table>` com `<colgroup>` + `table-layout:fixed`.
- Definição declarativa em `DISPAROS_COLS_DEFINITION` (15 cols com defaults entre 40 e 280px e `visibleWhen` para edit/filterBu).
- Persistência por chave em `localStorage[nl-disparos-col-widths-v1]` (objeto `{key: width}` em vez de array — sobrevive a mudanças de visibilidade).
- Botão "↺ Reset colunas" no topo da tabela com `_resetDisparosColWidths()`.
- Helper `_renderDisparosCell(col, r, hidden)` — render baseado em `col.type` (date, name, subject, num, num-bad, pct-good, edit, bu).
- `loadData` atualizado pra usar `nl-table-wrap` direto (sem `nl-tbody`).

### Trade-offs
- Sticky-cols removidas — resize + sticky era complexo (sticky `left` precisa recomputar com cada drag). User prioriza resize, scroll horizontal é a alternativa.
- Resize não preserva `editMode` toggle widths separadamente (compartilha mesma key, recompute na hora).

### Arquivos alterados
- `js/pages/nlPerformance.js` — refactor renderTable + bugfix wireEnviosColResize
- `js/version.js` — bump 4.9.2 → 4.9.3
- `index.html` — cache-bust v= alinhado


## [4.9.2+20260506-modal-chips-resize-cols] — 2026-05-06

Release **PATCH** — atende as 2 últimas observações do user sobre a aba **Conteúdo & Temas**:

1. *"qdo abro o form pra editar a info, ainda tem muita coisa com estilo desenvolvimento. precisamos de coisas prontas para o usuario final"* — modal "✎ Editar análise" totalmente reformulado. Sem JSON exposto, sem textareas. Substituído por:
   - **Chip-inputs** com auto-complete via `<datalist>` para arrays de strings (Países, Cidades, Marcas, Temas, Público-alvo, Atividades, Argumentos de venda).
   - **Object-list editors** (3 inputs por linha + botão remover + botão "+ Adicionar") para Hotéis e Cruzeiros (que têm `name`/`brand`/`category`).
   - Selects amigáveis com labels descritivos para `confiança` ("Alta — IA + manual confirmado").
   - Sugestões pré-curadas (38 países, 38 cidades, 20 marcas tier-1/luxo, 12 temas canônicos, 9 audiências, 12 atividades).
   - Tooltips ⓘ por seção explicando o que entra em cada campo.

2. *"a coluna unidade está cortando as palavras, e a de nome está muito grande para o texto atual. poderia ser interessante o usuario manipular isso"* — tabela de envios agora tem **colunas redimensionáveis pelo usuário**:
   - Cada `<th>` ganha um drag-handle de 6px na borda direita. Mouse-down → arrasta → solta.
   - Larguras persistidas em `localStorage[nl-content-envios-col-widths-v2]` por usuário/browser.
   - Botão "↺ Reset colunas" no topo restaura defaults [88, 260, 160, 200, 160, 70, 60].
   - `table-layout:fixed` + `<colgroup><col>` garantem que widths são respeitados.
   - `title=""` em cada `<td>` mostra o conteúdo completo no hover quando há truncate.

### Implementação

#### Modal (`js/pages/nlPerformance.js`)
- Constante `SUGGEST` com listas pré-curadas (countries, cities, themes, brands, etc.).
- `createChipInput(initial, opts)` — componente genérico de chip-input com Enter/vírgula para adicionar, Backspace para remover último, suporte a `<datalist>`.
- `createObjectListEditor(initial, categories, opts)` — editor de array de `{name, brand, category}` com 3 inputs por linha + botão remover + "+ Adicionar".
- `openExtractedEditor()` totalmente reescrita: layout de cards/seções com tooltips, sem nenhum JSON visível.

#### Resize de colunas (`js/pages/nlPerformance.js`)
- `_loadEnviosColWidths()` / `_saveEnviosColWidths()` para persistência.
- `wireEnviosColResize()` chamado dentro de `wireDrillDowns()`.
- Drag handler com `mousedown` → `mousemove` listener temporário no document → `mouseup` → save.
- Idempotente via `dataset.wiredResize`.

### Arquivos alterados
- `js/pages/nlPerformance.js` — modal completamente reescrito + resize de colunas (~+250 linhas)
- `js/version.js` — bump 4.9.1 → 4.9.2
- `index.html` — cache-bust v= alinhado


## [4.9.1+20260506-nl-content-insights-tooltips] — 2026-05-06

Release **PATCH** — atende 2 observações do user sobre a aba **Newsletter → Conteúdo & Temas**:

1. *"todos os cards tem que ter um 'i' explicando o critério de selecao feito pela IA"* — tooltip "ⓘ" em **todos** os 6 KPIs e nos 9 cards/blocos explicando o critério de extração (dicionário curado de keywords, dedup intra-doc, regex no subject por tipo, triggers por tema, etc.).
2. *"falta implementar insights em todas as abas (acho q só tem em 1)"* — **Insights & Observações** agora também na aba **Conteúdo & Temas** (antes existia só em Performance e Calendário). 10 widgets ancorados (`contentKpis`, `newsletterTypes`, `topCountries`, `topCities`, `topHotels`, `topCruises`, `themes`, `brands`, `contentByBu`, `enrichedSends`) + painel "Análise Geral" com snapshot agregado.

### Implementação

#### Tooltips (`js/pages/nlPerformance.js`)
- Constante `INFO_TIPS` (15 keys) — texto canônico do critério IA por bloco/KPI.
- Helper `blockHeader(title, tooltip, widgetId)` — renderiza header com badge ⓘ + slot de insights opcional.
- Helper `contentKpi(title, value, sub, tooltip)` — adiciona ⓘ flutuando no canto direito do KPI.
- Aplicado em **6 KPIs** (Países, Cidades, Hotéis, Cruzeiros, Marcas, Open rate) e **9 blocos** (Tipo, Top países/cidades/hotéis/cruzeiros, Temas, Marcas, Por BU, Envios).

#### Insights na aba Conteúdo (`js/pages/nlPerformance.js`)
- 8 funções snapshot: `buildNlContentKpisSnapshot`, `buildNlContentTypesSnapshot`, `buildNlContentCountriesSnapshot`, `buildNlContentCitiesSnapshot`, `buildNlContentHotelsSnapshot`, `buildNlContentCruisesSnapshot`, `buildNlContentThemesSnapshot`, `buildNlContentBrandsSnapshot`, `buildNlContentByBuSnapshot`, `buildNlContentSendsSnapshot`.
- `buildNlContentGeneralSnapshot()` — snapshot agregado com totais + top-5 de cada dimensão para o painel geral.
- `setupNlContentInsights(enrichedDocs, agg)` — monta widgets via `setupDashboardInsights({...})`. Chamado dentro de `renderContentTab()` (re-monta a cada render — slots zeram quando `innerHTML` é reescrito).
- Período do `setupDashboardInsights` deriva de `_contentFiltersState.period` (default 180 dias). Filtros propagados: bu/country/city/theme/newsletterType/search.

### Arquivos alterados
- `js/pages/nlPerformance.js` — tooltips + insights setup completo (~+200 linhas)
- `js/version.js` — bump 4.9.0 → 4.9.1
- `index.html` — cache-bust v= alinhado

### Verificação
- Sintaxe JS validada (`node --check`).
- Compatível com `setupDashboardInsights` API (já usada em Performance + Calendar).
- IA Hub não precisa de mudanças — `dashboard='nl'` já cobre as 3 abas via `indexKey`.


## [4.9.0+20260506-schema-cruises-newslettertype-cidades-edit-modal] — 2026-05-06

Release **MINOR** — atende 5 observações cirúrgicas do user sobre a aba de Conteúdo & Temas:
1. *"se um hotel é citado mais de uma vez na mesma newsletter, ele ganha apenas uma citação"* — dedup intra-doc via `Set`
2. *"importante entender qual o critério para temas/posicionamento"* — critérios canônicos documentados em RULES § 10.5b
3. *"saiba diferenciar hotel de cruzeiro (ex: acqua expeditions)"* — schema **separado** `cruises[]` ≠ `hotels[]`, com bloco UI próprio
4. *"ter a opcao de editar a lista que vc fez para termos 100% de efetividade"* — botão **✎ Editar** + modal completo de edição manual
5. *"outro topico importante de analise: tipo da newsletter (se é promocao, áereo, roteiro, hotelaria)"* — novo campo `newsletterType` enum (10 valores) com KPI/filtro/bloco
6. *"ah, faltou ter analise por cidade/regiao... e nao só país"* — novo bloco "Top cidades/regiões" + KPI + filtro + drill-down

### Schema novo (`mc_performance.extracted`)
- **`cruises[]`** — array separado de operadoras marítimas (Aqua Expeditions, Silversea, Ritz-Carlton Yacht, Delfin Amazon). NÃO devem aparecer em `hotels[]`.
- **`newsletterType`** — enum com 10 valores: `promocao | aereo | roteiro | hotelaria | cruzeiro | csat | inspiracional | institucional | show/evento | retreat/wellness`. Documentado com critério canônico em RULES § 10.5b.

### UI atualizada (aba "🌍 Conteúdo & Temas")
- **6 KPIs no topo**: Países · Cidades (NOVO) · Hotéis · Cruzeiros (NOVO) · Marcas · Open Rate Médio
- **7 blocos** (era 4): Tipo de newsletter (NOVO) · Top países · Top cidades/regiões (NOVO) · Top hotéis · Cruzeiros (NOVO) · Temas · Marcas
- **Filtros expandidos** (de 4 pra 7): BU · Período · **Tipo (NOVO)** · País · **Cidade (NOVO)** · Tema · Busca
- **Drill-down por cidade** (era só por país)
- **Coluna "Editar"** na tabela de envios com botão ✎ → modal de edição manual
- **Badge tipo de newsletter** ao lado do nome de cada envio

### Modal de edição manual (`openExtractedEditor`)
- Form com selects (newsletterType, confidence, pricePoint) + textareas (1 entidade por linha) pra todos os 11 campos do schema
- Hotels/Cruises aceitam JSON inline `{"name":"X","brand":"Y","category":"luxo"}` por linha
- Salva direto em Firestore com `extractedBy: 'manual-edit'` + `editedAt`
- Cache invalidado automaticamente após save
- Garantia: master pode corrigir 100% das análises onde IA errou

### Documentação (RULES § 10.5b)
Reescrita completa da seção de Newsletter Performance Enriquecimento:
- Pipeline atual (Vision-first 4.8.0+)
- Schema canônico de `extracted` documentado
- **Tabela de critérios de tipo** (10 categorias com triggers)
- **Tabela de critérios de tema** (13 categorias com triggers)
- Regras de dedup (intra-doc + inter-wave)
- Cruises separados de hotels (regra explícita)
- Quando re-rodar (workflow_dispatch, edição manual, ENRICH_DISABLED)

### Why
Observações cirúrgicas de domínio que IAs gerais não pegam:
- Aqua Expeditions é cruzeiro fluvial (Mekong/Amazônia), não hotel — mas IA classificava como hotel
- Cidades importam tanto quanto países pra curadoria (Atenas vs Grécia, Cumbuco vs Brasil)
- Tipo de newsletter (promo vs hotelaria vs aéreo) é dimensão crítica pra entender o portfolio
- Edição manual é INDISPENSÁVEL quando se cobra de cliente — IA erra, humano corrige
- Critérios documentados evitam que próxima IA invente categorias novas a cada extração

### Verificação
1. ✓ `node --check` passou
2. ⏳ Bulk write (159 campanhas) — pendente browser reconectar
3. ⏳ Validação visual da nova UI

### Próximas releases planejadas
- **4.9.x — Bulk write das 159 campanhas analisadas por Claude Sonnet** (pendente)
- **4.10.0 — PDF + relatórios cruzados** (sazonalidade, top hotéis × performance, alinhamento subject↔body)

---

## [4.8.1+20260505-conteudo-separado-por-bu] — 2026-05-05

### Changed
- (descreva aqui as mudanças deste deploy)

---

## [4.8.0+20260505-vision-first-gemini-extraction] — 2026-05-05

**Pivot fundamental do enrichment.** Reportado: *"NAOOO... descricao fizemos só em alguns casos como exemplo!"* + *"muitas news tem html apenas no header e no footer. vai ter que analisar textos dentro de imagens, né? o miolo esta em img..."*. Diagnóstico anterior estava errado — tanto a ideia de description manual quanto extração via texto stripped (que só pega rodapé legal). Único caminho: **Vision API** lendo as imagens dos emails.

### Changed (arquitetura inteira do extract)
- **Agente IA Hub atualizado**: `provider: 'groq'` → **`'gemini'`**, `model: 'llama-3.3-70b-versatile'` → **`'gemini-2.5-flash'`**. System prompt reescrito pra extração multimodal (imagens + contexto textual). `name`: "Extrator de Conteúdo de Newsletter (Vision)". `maxTokensPerRun: 2000`, `timeoutMs: 60000`.
- **`extractEntitiesViaAgent` refatorada** — assinatura passa a aceitar objeto `{html, text, subject, name}` em vez de só `text`. Detecta `provider === 'gemini' && html` → fluxo Vision.

### Added (pipeline Vision-first)
- **`extractContentImages(html, topN=5)`** — extrai URLs de `<img>` do HTML cru com filtros:
  - Pula tracking pixels (1×1, gif analytics)
  - Pula spacers (<10px)
  - Pula logos (<200×<100)
  - Score por área × bonus de alt-text descritivo
  - Dedup por URL, retorna top N por score
- **`fetchImageAsBase64(url)`** — download HTTP da imagem, valida content-type, limita 5MB, retorna `{mimeType, data: base64}`. User-Agent custom.
- **`callGeminiVision(model, apiKey, sysPrompt, userPrompt, images, ...)`** — endpoint Gemini 2.5 Flash multimodal: `inlineData: {mimeType, data}` por imagem. Up to 5 imgs num único request. `responseMimeType: 'application/json'`.
- **Cache por URL de imagem** em nova collection `mc_image_extractions`:
  - Doc id = `sha256(url)`
  - Fields: `{url, extracted, ts}`
  - Cache hit: usa extracted antigo, não re-baixa imagem nem re-chama Vision
  - Insight: hotéis populares (Faena, Aman) reaparecem em múltiplas campanhas → hit rate alto após poucos runs
- **Prompt enriquecido** combina: contexto textual (subject + name + alt-texts) + cache de imagens já analisadas + imagens novas. Modelo cross-valida contexto vs Vision.

### Why
1. **Description não escala**: usuário confirmou que só foi preenchida em casos isolados como teste. Não é fonte confiável.
2. **HTML stripped só dá rodapé**: template SFMC tem header (logo) + footer (telefone, disclaimer legal) em texto. O conteúdo real (banners de hotel, cards de oferta, preços) está em `<img>` no meio.
3. **Vision via Gemini é cheap**: ~$0.0002/email, ~R$ 7/ano operação anual completa. Cache derruba mais ainda.
4. **Gemini key já configurada**: zero ação do usuário pra ativar (key em `system_config/ai-config.geminiApiKey`).

### Custo recalculado
| Operação | Volume típico | Custo USD | BRL |
|---|---|---|---|
| Backfill 90d (sem cache imgs) | 150 emails × 3-5 imgs avg = 600 calls | ~$0.05 | R$ 0.30 |
| Daily incremental | 10 emails × 3 imgs avg = 30 calls | ~$0.003/dia | R$ 0.02 |
| **1 ano com cache** (hotéis recorrentes) | ~3000 imgs únicas no ano | ~$1.10 | **~R$ 7** |

### Verificação
1. ✓ `node --check` passou
2. ✓ Agente atualizado em `ai_agents/{slug}` com provider gemini + prompt vision
3. ⏳ Workflow_dispatch após deploy: validar logs `🖼 N imgs Vision (M cache img)`
4. ⏳ Inspecionar 1-2 docs `mc_performance` recentes — `extracted.hotels`, `countries`, `cities` populados COM dados reais (não mais empty arrays do Llama)
5. ⏳ Aba Conteúdo & Temas → KPIs e blocos com **dados ricos de verdade**

### Schema novo: `mc_image_extractions`
- `{id (sha256 url), url, extracted, ts}` — collection de cache de extração por imagem
- Útil pra debug: olhar quais imagens foram analisadas e o que cada uma rendeu
- Tamanho médio: ~2kb/doc; pra 3000 imgs únicas/ano = 6MB. Trivial.

### Próximas releases planejadas
- **4.8.x — Tunning de prompt baseado em resultados reais** (após primeiro batch de Vision)
- **4.9.0 — PDF da aba Conteúdo + relatórios cruzados** (sazonalidade, top hotéis × performance)

---

## [4.7.0+20260505-wave-dedup-content-htmltext-dump] — 2026-05-05

Reportado: *"Lembre-se: muitos disparos tem o mesmo codigo (PXXX, por exemplo), pq disparamos em ondas, dividindo o mailing. isso precisa estar no seu racional de analise de termos"* — necessidade crítica de dedup por campanha pra contagem de hotéis/destinos não inflar artificialmente. Também: *"eu gostaria que vc fizesse e analisasse os docs... pq a IA do sistema é muito fraca"* — preparação pra re-extração manual via Claude.

### Added (Wave dedup)
- **`dedupContentByCampaign(docs)`** em `nlPerformance.js` aba Conteúdo: agrupa docs com mesmo `baseCode` (P0209_1/_2/_3 → P0209). Mantém doc canônico (com extracted preenchido) + agrega métricas de performance (totalSent, openRate, clickRate). Critical pra que "Hotel X mencionado em P0209" não vire "3 mentions" só porque o mailing foi dividido.
- **Reusa lógica `baseCode()`** existente no `mergeWaves` (linhas 451-460): strip de sufixos `_N`, `-N`, `_X`. Mesmo critério da aba Performance.
- **Badge `⊞N` na tabela de envios** mostra contagem de ondas se >1.
- **Counter atualizado**: agora mostra "X campanhas (Y disparos) no período" em vez de só "Y disparos" — comunica explicitamente a deduplicação.

### Added (htmlText dump)
- Campo novo `mc_performance.htmlText` (string, até 10k chars do HTML stripped). Salvo automaticamente pelo `mc-sync.js` durante enrichment. Custo: +10kb/doc × ~50 docs = 500kb. Trivial.
- Permite re-extração manual sem refazer fetch SFMC. Útil quando:
  - User quer revisar/auditar o que a IA extraiu vs o conteúdo real
  - Trocar modelo (Llama → Claude Sonnet) e re-rodar extração nos docs antigos
  - Análise manual ad-hoc (Claude no chat lê e extrai melhor que Llama 70B)

### Why
**Wave dedup** corrige ruído na análise — sem ele, qualquer destaque de "Hotel X é o mais mencionado" estaria distorcido pelo número de ondas, não por relevância real do produto.

**htmlText dump** desbloqueia re-análise sem custo de fetch. Fundamental dado que o user vai trocar pra modelo melhor (Claude Sonnet quando adquirir API paga) e queremos re-extrair os ~150 docs históricos sem refazer todo o sync SFMC. Custo de storage é trivial.

### Verificação
1. Rodar workflow_dispatch após este deploy → docs ganham `htmlText` populado
2. `#nl-performance` → aba "🌍 Conteúdo & Temas" → counter mostra "N campanhas (M disparos)" — N < M se houver waves
3. Hotéis citados: cada campanha conta 1 vez (não inflado por waves)
4. Cards de envios mostram badge ⊞N quando aplicável

### Próximas releases planejadas
- **4.7.x — Re-extração manual via Claude (quando user adquirir API paga)**: troca o agente IA Hub `provider: 'groq'` → `'anthropic'`, modelo `'claude-haiku-4-5'` ou `'claude-sonnet-4-6'`. Re-roda extração nos docs com `htmlText` populado. Sem custo SFMC.
- **4.8.0 — PDF da aba Conteúdo + relatórios cruzados** (sazonalidade, hotéis subutilizados).

---

## [4.6.2+20260505-fix-rate-limit-serial-retry] — 2026-05-05

Hotfix do throughput. Após o **breakthrough da 4.6.1** (match Send→Asset por NOME, recuperando 18/18 assets), o Groq tier on-demand retornou 429 em 10 das 18 chamadas LLM por TPM (12k tokens/minuto) excedido.

### Fixed
- **Concorrência reduzida 4 → 1** (serial). HTML de marketing emails tem ~5k tokens, então 4 paralelas estouravam o TPM Groq facilmente.
- **Truncate de input 8000 → 5000 chars** (~1.5k tokens). Marketing emails são repetitivos: as primeiras seções já trazem destinos/hotéis/temas. Reduz token spend em ~38% sem perda significativa de qualidade.
- **Retry inteligente**: parse do `try again in X.XXXs` da resposta Groq pra calcular backoff exato em vez de 2s fixo. Se rate limit pede 25s, espera 25.5s.
- **Retries: 1 → 3**. Permite atravessar múltiplos rate limits seguidos numa única run.

### Why
4 paralelas × 5k tokens = 20k tokens em rajada vs limite 12k/min. Serial leva ~1-2s/email; pra 30-50 emails/dia ainda termina em <2min total. Trade-off aceitável.

### Verificação
- ⏳ Re-trigger workflow_dispatch — esperado: `0 falhas` em vez de `10`

---

## [4.6.1+20260505-fix-asset-query-fields-syntax] — 2026-05-05

Hotfix capturado em primeiro workflow_dispatch após user habilitar permissão `Assets > Read` no SFMC. SFMC aceitou autenticação (saiu de 403 → 400), mas rejeitou o `fields` parameter por dot-notation: `views.html.content is not a valid field argument`.

### Fixed
- **`scripts/mc-sync.js fetchAssetsByLegacyIds`**: removido o array `fields` do POST query. SFMC asset API não aceita dot-notation em `fields` (errorcode 10005). Solução: omitir o parâmetro inteiro — API retorna payload completo. Trade-off aceitável: response maior, mas pra ~10 assets/dia o tráfego é trivial.
- **HTML extraction com fallback**: alguns assets podem ter conteúdo em `views.html.content`, outros em `content` direto, ou ainda `views.text.content` (text-only). Tentamos os 3 em ordem.

### Why
Documentação SFMC asset API é vaga sobre o suporte a dot-notation no `fields`. Tentei conforme exemplos antigos achados online, falhou. Omitir é a abordagem mais robusta — payload extra é desprezível.

### Verificação
- ✓ `node --check` passou
- ⏳ Re-trigger workflow — esperado ver `N assets recuperados` em vez de `0` + `M chamadas LLM`

---

## [4.6.0+20260505-aba-conteudo-temas-newsletter] — 2026-05-05

**Fase 2 do projeto enriquecimento de newsletters.** Entrega a aba **"🌍 Conteúdo & Temas"** no `#nl-performance` consumindo `mc_performance.extracted` (entidades extraídas via IA na Fase 1, releases 4.5.0-4.5.2). Adiantada enquanto o Marketing Cloud está fora do ar — assim que o sync rodar com `Assets > Read` ativo no SFMC, a UI já vai estar pronta consumindo os dados reais.

### Added
- **Nova tab "🌍 Conteúdo & Temas"** em `#nl-performance` (entre Calendário e Performance):
  - **5 KPIs**: países distintos · hotéis citados · marcas · open rate médio · confiança IA (high count)
  - **Bloco "🌍 Top destinos · performance"** — tabela ordenada com país, count de disparos, open rate (color-coded). Clique em linha = drill-down: filtro de país aplicado e re-renderiza tudo.
  - **Bloco "🏨 Hotéis mais mencionados"** — top 10 com bar chart horizontal proporcional.
  - **Bloco "🎯 Temas / posicionamento"** — todas categorias (luxo, romance, família, etc.) com count + open rate por tema. Permite ver quais temas convertem mais.
  - **Bloco "🏷 Marcas hoteleiras"** — pills com count (Belmond, Aman, Four Seasons, etc.).
  - **Tabela "📧 Envios"** — últimos 50 disparos enriquecidos com: data, nome, países, hotéis (top 2 + count), temas (top 3), open rate.
- **Filtros transversais**: BU, período (30/90/180/365/all), país, tema, busca textual. Dropdowns de país e tema **populados dinamicamente** com base nos dados reais.
- **Empty state inteligente** quando nenhum doc tem `extracted`: explica se é falta de dados (sync não rodou) OU permissão SFMC ausente OU agente IA inativo. Links diretos pra GH Actions e IA Hub.
- **Cache em memória** (`_contentDataCache`) — fetch único pra todos os toggles de filtro. Botão "↻ Atualizar" força refetch.

### Changed
- Tab navigation handler atualizado pra suportar 3 tabs: Performance · Calendário · Conteúdo & Temas.
- `loadContentTab()` é lazy-loaded — só carrega Firestore na primeira vez que user clica na tab.

### Why
Sem UI consumindo o `extracted`, o trabalho da Fase 1 ficaria invisível. Mesmo com o MC fora do ar agora (impossibilitando teste end-to-end), entregar a UI pronta significa que basta o sync rodar 1× pra tudo aparecer. Mantém o ritmo de entrega + permite revisar layout antes de ter dados (UX no vácuo é ruim, então fiz com empty states ricos que já são úteis).

### Pendências (independentes desta release)
1. ⏳ SFMC: liberar `Assets > Read` no Installed Package
2. ⏳ Re-trigger workflow_dispatch após (1)
3. ✅ Aba pronta consumindo o que vier

### Próxima release
**4.7.0 — Fase 3**: PDF export da aba Conteúdo + relatórios cruzados (sazonalidade, hotéis subutilizados, alinhamento subject↔body).

### Verificação
1. Acessar `#nl-performance` → ver 3 tabs no topo
2. Click "🌍 Conteúdo & Temas" → empty state aparece (sem dados ainda)
3. Empty state deve dizer "X disparos no período mas 0 enriquecidos" + links pra GH Actions e IA Hub
4. Ao primeiro doc com `extracted` chegar via sync → KPIs + 4 blocos + tabela renderizam automaticamente

---

## [4.5.2+20260505-fix-soap-email-id-nested] — 2026-05-05

Hotfix capturado em teste in-browser do workflow_dispatch da 4.5.1: SOAP do SFMC retornou `Error: The Request Property(s) EmailID do not match with the fields of Send retrieve`. O nome correto da property é `Email.ID` (sub-property aninhada do objeto Send).

### Fixed
- **SOAP property `EmailID` → `Email.ID`** em `scripts/mc-sync.js`. O SFMC SOAP partner API expõe o EmailID como sub-property nested do objeto Send, não como property direta.
- **Parser de XML ajustado**: `Email.ID` retorna como `<Email><ID>37396</ID></Email>` no envelope SOAP. Adicionei extração nested via regex `<Email>...</Email>` → captura `<ID>` interno.

### Why
SFMC SOAP é particular sobre dot-notation em properties. Documentação não é cristalina, eu errei na primeira tentativa. Capturado rapidamente porque o GH Action falhou logo no primeiro fetch (status `0 sends encontrados` com erro explícito) — proteção do `if (!sends.length) continue` evitou que o sync inteiro travasse.

### Verificação
- ✓ `node --check` passou
- ⏳ Re-trigger workflow_dispatch — esperado: `N sends encontrados` em vez de `0`

---

## [4.5.1+20260505-ia-hub-agent-newsletter-extractor] — 2026-05-05

**Pivot arquitetural** sobre a 4.5.0. Reportado: *"o certo nao é usar o IA Hub como modulo parceiro dessa solucao? assim temos o agente registrado, com maior visibilidade e possibilidade de manutencao no front. e mais: podemos escolher o modelo pra trabalhar."* — observação cirúrgica que mata o approach hardcoded da 4.5.0 e amarra o pipeline ao módulo IA Hub que já tem governança (audit, budget, key cascade, UI de gestão).

### Changed
- **`scripts/mc-sync.js` refatorado pra usar agente registrado**:
  - Provider, modelo, prompt e limites lidos de `ai_agents` (Firestore). **Trocar modelo agora é editar campo no agente, sem deploy.**
  - Chave de API resolvida de `system_config/ai-config` (mesmo doc que `js/services/ai.js` lê — single source of truth).
  - Multi-provider implementado: anthropic, groq, openai, gemini.
  - Logs em `ai_usage_logs`: cada extração registra `agentId, provider, model, source: 'mc-sync', tokensIn, tokensOut, success, durationMs`. Visível no dashboard da IA Hub.
  - Falha graceful em 5 níveis: agente ausente / agente inativo / sem chave / sem HTML / parse JSON falhou.
- **Workflow `mc-sync.yml`**: removido `ANTHROPIC_API_KEY` env. Chave vem de Firestore.

### Added
- **Agente "Extrator de Conteúdo de Newsletter"** seedado em `ai_agents`:
  - `slug: 'newsletter-content-extractor'`
  - `provider: 'groq'`, `model: 'llama-3.3-70b-versatile'`
  - `module: 'nl-performance'`
  - `outputFormat: 'json'`, `limits.temperature: 0`
  - `visibility.mode: 'admin'`, `invokedBy: ['mc-sync GitHub Action']`
- **Schema `mc_performance.extracted`** ganha `agentId`, `agentSlug` e `extractedBy: 'groq/llama-3.3-70b-versatile'` (dinâmico vs hardcoded da 4.5.0).

### Why
A 4.5.0 entregou fundação técnica certa mas arquitetura de provider hardcoded — péssima prática num sistema que já tem IA Hub funcional. **Pivot ganha:**
1. Visibilidade: agente aparece no `#ai-hub` junto com outros — admin vê custo, erro, prompt, modelo num só lugar
2. Manutenção sem deploy: trocar modelo (Llama→Sonnet→Gemini) é click; ajustar prompt é editar campo
3. Governança: audit log, budget alert, rate limit, key cascade — tudo já existe na IA Hub
4. Reuso: futuras extrações similares seguem o mesmo padrão

**Por Groq Llama 3.3 70B:** chave já em `system_config` (zero ação user), JSON mode nativo, custo ~R$ 15/ano (vs ~R$ 30 com Haiku), latência ~1-2s. Pode trocar pra qualquer outro provider editando o agente.

### Verificação
1. ✓ Agente criado em `ai_agents` com `slug: 'newsletter-content-extractor'`
2. ✓ `system_config/ai-config.groqApiKey` confirmado (key real, len 56)
3. ✓ `node --check scripts/mc-sync.js` passou
4. ⏳ Trigger workflow_dispatch `days=7`: validar logs `Enriquecimento IA: ✓ ATIVO via agente "Extrator de Conteúdo de Newsletter" (groq/llama-3.3-70b-versatile)`
5. ⏳ Inspecionar `mc_performance` docs recentes — `extracted` + `agentId` + `extractedBy` populados

### Pré-requisito SFMC ainda válido
Permissão `Assets > Read` no Installed Package SFMC. Se 401/403 nos logs, configurar conforme 4.5.0.

### Próxima release
**4.6.0 — Fase 2**: aba "Conteúdo & Temas" no `#nl-performance` consumindo `mc_performance.extracted`.

---

## [4.5.0+20260505-mc-sync-html-ia-extracao] — 2026-05-05

Release **MINOR** — Fase 1 do enriquecimento de newsletters por IA. O sync diário do Marketing Cloud passa a puxar o **HTML completo** de cada disparo (via REST `/asset/v1/content/assets/query`) e extrai entidades via Claude Haiku 4.5: países, cidades, hotéis, marcas, temas, target audience, atividades, faixa de preço, sales points. Tudo persistido em `mc_performance.extracted`. Pipeline com cache por `htmlHash` pra zero re-trabalho.

Esta é a fundação de dados. **Fase 2** entrega a UI (nova aba "Conteúdo & Temas" no `#nl-performance`); **Fase 3** entrega relatórios cruzados e PDF. Ambas dependem desta release rodar em produção.

### Added
- **`scripts/mc-sync.js`** — funções novas:
  - `fetchAssetsByLegacyIds(token, legacyIds)` — POST `/asset/v1/content/assets/query` com filter `data.email.legacyId in [...]`. Retorna `{description, html, assetId, assetName}` por legacyId. Batch de 200 por request.
  - `stripHtml(html)` — regex strip + decode de entidades. Sem dependência externa.
  - `htmlStructuralStats(html)` — conta CTAs (`<a href>`), imagens (`<img>`), palavras, chars. Determinístico, $0.
  - `sha256(s)` — hash do HTML pra cache lookup.
  - `extractEntitiesViaLLM(text, anthropicKey, retries)` — chama Anthropic Messages API com prompt estruturado em PT-BR, exige JSON estrito, temperature 0, max_tokens 1500. Retry exponencial 1× em 429/5xx.
- **EmailID adicionado ao SOAP Send query** — propriedade legacy necessária pra ligar Send → Asset (é o `data.email.legacyId` do Content Builder).
- **Pipeline integrado no `main()`**:
  1. Coleta EmailIDs únicos dos sends do período
  2. Batch fetch assets via REST
  3. Pré-busca docs existentes em Firestore (chunks de 30 — limite do `where in`) pra cache lookup por `htmlHash`
  4. Concorrência limitada (4 paralelas) na extração LLM pra respeitar rate-limit
  5. Cache hit: skip LLM, mantém `extracted` existente via merge
  6. Cache miss: extrai + persiste com `extractedAt` + `extractedBy: 'claude-haiku-4-5'`
- **Logs de operação**: cada run reporta `{enriched, cacheHits, llmCalls}` no resumo final, permitindo monitorar custo de IA em tempo real.

### Changed
- **Schema `mc_performance`** ganha campos opcionais:
  - `emailLegacyId: string`
  - `description: string` (do Content Builder Asset)
  - `htmlHash: string` (sha256)
  - `htmlStats: { ctaCount, imageCount, wordCount, charCount }`
  - `extracted: { countries, cities, hotels[], brands, productTypes, themes, targetAudience, activities, pricePoint, priceRange, travelSeason, sellingPoints, confidence, extractedAt, extractedBy }`
- **`.github/workflows/mc-sync.yml`** — adicionado env `ANTHROPIC_API_KEY` opcional. Workflow continua funcionando sem o secret (extração desativa).
- **`INFRA.md` § 3.2** atualizado com permissão `Assets > Read` necessária + pipeline de enriquecimento documentado.
- **`RULES-AND-AUTOMATIONS.md`** ganhou seção **§ 10.5b — Newsletter Performance — Enriquecimento por IA** com pipeline + regras de cache + custo operacional + condições de re-execução.

### Why
A descrição manual do Content Builder pediria trabalho do time editorial. O HTML completo já existe e contém tudo que precisamos extrair (e mais — preços, sales points, atividades, target audience). Deixar IA fazer leitura estruturada é zero esforço humano + análise mais rica. Custo operacional desprezível (~R$ 30/ano) graças ao cache por htmlHash e modelo barato (Haiku 4.5). Frame [IA vs determinístico documentado em conversa interna] aplicado: cardinalidade infinita (hotéis novos toda semana) + necessidade de inferência contextual (temas, target) ⇒ IA pura ganha.

### REQUERIDO PÓS-DEPLOY (master)
1. **Verificar permissão SFMC**: Setup → Apps → Installed Packages → seu package atual → Components → confirmar que tem **`Assets > Read`** ativado. Se não tiver, adicionar e reativar token. (Sem isso o REST `/asset/v1/content/assets/query` retorna 401/403.)
2. **Adicionar GitHub Secret `ANTHROPIC_API_KEY`** com a key da Anthropic. Sem ele, o sync roda mas pula extração (campos `extracted` ficam ausentes).
3. **Trigger manual de teste**: `Actions → Sync Marketing Cloud → Run workflow → days: 7`. Validar nos logs:
   - `Enriquecimento IA: ✓ ATIVO`
   - `N assets recuperados`
   - `Enriquecimento IA: X novos · Y cache hits · Z chamadas LLM`
4. **Inspecionar Firestore**: 1-2 docs em `mc_performance` da última semana devem ter os novos campos populados.
5. Se OK, próxima release (4.6.0) entrega Fase 2 — aba "Conteúdo & Temas" na UI.

### Custo estimado (operação contínua pós-backfill)
| Operação | Volume diário | Custo USD | Custo BRL |
|---|---|---|---|
| Diario (~10 emails novos) | 40K input + 5K output tokens | $0.015 | R$ 0.09 |
| Backfill 90d (~1.000 emails) | 4M input + 500K output | $1.40 | R$ 8.40 |
| **Anual incremental** | — | ~$5 | **~R$ 30** |

### Verificação técnica
- ✓ `node --check scripts/mc-sync.js` passou
- ✓ Workflow yml válido
- ⏳ Test manual workflow_dispatch — depende user adicionar secret + permissão SFMC

---

## [4.4.5+20260505-typo-saiuram] — 2026-05-05

Patch de correção gramatical exposto durante teste in-browser da 4.4.4 (banner do form de avaliação de meta).

### Fixed
- **Typo "saiuram" → "saíram"** no banner de atraso. Era erro de morfologia: o código tentava pluralizar via `saiu${count>1?'ram':''}` que produzia "saiuram" (não existe em português). Corrigido para `${count>1?'saíram':'saiu'}`.
- Singular: "**saiu** com atraso" (1 tarefa)
- Plural: "**saíram** com atraso" (2+ tarefas)

---

## [4.4.4+20260505-fix-eval-form-regenera-meta-periodo] — 2026-05-05

Patch corrigindo bug pré-existente no form de avaliação descoberto durante teste in-browser do banner reativo da 4.4.3. Sem este fix, o banner de atraso era inacessível na prática (impossível selecionar meta de outro pilar).

### Fixed
- **Trocar pilar não regenerava opções de meta** (`openEvaluationForm`):
  - `<select id="ev-meta">` era populado UMA vez no template
  - Trocar pilar via picker atualizava só o `<select id="ev-pilar">.value`, deixando ev-meta com opções do pilar antigo
  - Usuário ficava preso na meta inicial, sem conseguir avaliar metas de outros pilares
  - **Fix**: novo listener `change` no ev-pilar regenera ev-meta + atualiza picker visual via `refreshPickerButton`
- **Trocar meta não regenerava opções de período** (mesmo padrão): novo listener no ev-meta regenera ev-periodo + cascateia visual.

### Why
A 4.4.2 entregou o banner, a 4.4.3 fez ele reativo. Ambos passaram smoke test isolado mas o fluxo real ficava inutilizável: banner reativo a um picker que UI não deixava operar. Banner correto sem fluxo correto = feature stub.

Bug existia muito antes da 4.4.x — só apareceu agora porque o fix do banner exigiu de fato trocar pilar/meta na UI pra validar.

### Added
- `refreshPickerButton` importado de `optionPicker.js` (já existia, só faltava uso em goals.js).

### Verificação
1. `#goals` → "Avaliação de Metas" → "+ Avaliar" em goal com pilares múltiplos
2. Modal abre em pilar 0 / meta 0 (default)
3. Picker de Pilar → escolher pilar 2 (ex: "Suporte integral sob demanda" da Design)
4. Picker de Meta agora mostra as 6 metas desse pilar (não mais só a do pilar 0)
5. Selecionar meta com atrasos → banner laranja aparece com lista de atrasados

### Estado consolidado pós-4.4.4
| Fix | Status |
|---|---|
| Fix A — `linkComprovacao` pré-popular com `deliveryLink` | ✅ Validado visual |
| Fix B.1 — Badge na lista de tarefas vinculadas | ✅ Validado prod (67 badges) |
| Fix B.2 — Banner laranja reativo no form | ✅ 4.4.3 + 4.4.4 |
| Fix B.3 — Chip "ATRASADA Xd" no PDF | ⏳ Não testado (export real) |

---

## [4.4.3+20260505-fix-banner-atraso-reativo] — 2026-05-05

Patch corrigindo gap detectado **durante teste in-browser da 4.4.2** (resposta à pergunta "testou?" do usuário, que motivou a validação real). O banner de atraso no formulário de avaliação só carregava 1× quando o modal abria — trocar pilar/meta no picker não recarregava o banner.

### Fixed
- **Banner de atraso reativo a mudanças de picker** (`js/pages/goals.js` `openEvaluationForm`):
  - Tasks fetched 1× e cacheadas em `_allTasksCache` (closure local)
  - Função `renderLateBanner(pi, mi)` separada — recebe pillar+meta atual e re-renderiza usando cache
  - Listeners `change` nos `<select id="ev-pilar">` e `<select id="ev-meta">` chamam `renderLateBanner` com índices atualizados
  - Trocar pilar ou meta no picker → banner atualiza instantaneamente

### Why
Bug só apareceu em teste in-browser real. A função `wasTaskCompletedLate()` passou no smoke test (3 casos), o badge na lista de tarefas vinculadas funciona em produção (67 badges renderizados em 822 task blocks). Mas como o picker default é `pilarIdx=0, metaIdx=0` e raramente é a combinação com mais atrasos, sem reatividade o banner ficava invisível pra maioria dos casos reais.

### Estado validação Fix A + Fix B (acumulado 4.4.2 + 4.4.3)
| Fix | Status |
|---|---|
| Fix A — `linkComprovacao` pré-popular com `deliveryLink` | ⏳ Pendente teste in-browser |
| Fix B parte 1 — Badge "⚠ Atrasada Xd" na lista de tarefas vinculadas | ✅ Validado prod (67 badges) |
| Fix B parte 2 — Banner reativo no form de avaliação | ✅ Código fixado na 4.4.3 |
| Fix B parte 3 — Chip "ATRASADA Xd" no PDF | ⏳ Pendente teste (export PDF) |

---

## [4.4.2+20260505-tarefa-meta-evidencia-auto-aviso-atraso] — 2026-05-05

Patch que fecha **2 gaps de produto** detectados durante revisão da integração tarefa↔meta. Reportado: *"Link da entrega na tarefa se torna automaticamente evidência de meta na avaliação? Se a tarefa é concluída com atraso, como fica para a meta? fica um aviso na avaliação?"*. Resposta investigativa: ambos os gaps existiam — `deliveryLink` e `linkComprovacao` eram campos completamente independentes (zero auto-population), e nenhum lugar do módulo de metas comparava `dueDate` com `completedAt`.

### Added (Fix A — Link de entrega → Comprovação)
- **`js/components/taskModal.js`** — overlay `showEvidenceModal` (pós-conclusão) agora pré-popula o campo "Link de comprovação" com `taskData.deliveryLink` quando `linkComprovacao` está vazio. Editável; usuário pode trocar/limpar antes de confirmar.
- **Hint visual** logo abaixo do campo: *"💡 Pré-preenchido com o link da entrega. Edite se quiser usar outro."* (aparece só quando o pré-fill ocorre — não polui se o user já tinha digitado o link de comprovação manualmente antes).
- **Comportamento**: `linkComprovacao` continua sendo gravado como campo separado (não sobrescreve `deliveryLink`). Cada um mantém seu propósito; só o input ganhou inteligência.

### Added (Fix B — Aviso de atraso na avaliação)
- **`js/services/tasks.js`** — nova função utilitária **`wasTaskCompletedLate(t)`** que retorna `{late: boolean, daysLate: number}` para tarefas em status `done` cujo `completedAt > dueDate`. Diferente de `isTaskOverdue()` (que cobre tarefas ainda ABERTAS após prazo) — esta cobre tarefas JÁ FECHADAS mas tardiamente. Cálculo em dias inteiros (`Math.floor((dDone - dDue) / 86400000)`) com normalização de timezones.
- **`js/pages/goals.js` — Lista de "📎 Tarefas vinculadas"**: cada tarefa concluída com atraso ganha badge laranja **"⚠ Atrasada Xd"** ao lado dos badges de status/evidência/período, com tooltip *"Concluída X dias após o prazo"*.
- **`openEvaluationForm`** (formulário onde o gestor registra avaliação): novo banner laranja entre a barra de progresso e os KPIs:
  - *"⚠ N de M tarefas concluídas desta meta saíram com atraso (X%)"*
  - Lista as 5 mais atrasadas (ordenadas por `daysLate` desc)
  - Texto orientativo: *"Considere isso ao definir a nota — a meta pode ter sido atingida, mas a entrega no prazo também é parte da execução."*
  - **Não bloqueia** salvar a avaliação — é informação contextual, decisão fica com o gestor.
  - Banner some completamente quando 0 tarefas atrasadas (não polui visual em metas saudáveis).
- **PDF de metas** (`exportPdf`) — chip laranja **"ATRASADA Xd"** após o chip "EVIDENCIA" quando aplicável, na seção "Tarefas vinculadas". Garante que mesmo o relatório impresso/exportado preserve a informação.

### Why
Antes do Fix A, o usuário **digitava o link 2×** (uma na tarefa, outra na evidência) — fricção que fazia muita gente abandonar o registro de evidência. Os campos seguem **separados no schema** (deliveryLink ≠ linkComprovacao têm propósitos diferentes), mas o input pré-populado elimina o atrito.

Antes do Fix B, o gestor avaliava metas **sem visibilidade do prazo**: 100% das metas batidas viravam "100% de progresso", mesmo quando 80% das tarefas saíram tardiamente. A nota podia ser dada sem o gestor sequer perceber. Agora a informação é exposta de 3 formas (badge na lista, banner no form, chip no PDF) — decisão final continua humana, mas com contexto.

### Verificação
1. Criar tarefa com "Link da entrega" preenchido → marcar como done → overlay aparece com link já no campo "Link de comprovação" + hint 💡.
2. Criar tarefa com `dueDate` no passado → marcar como done → vincular a uma meta → ir em #goals → meta exibe a tarefa com badge "⚠ Atrasada Xd".
3. Como gestor, abrir registro de avaliação dessa meta → banner laranja aparece com X tarefas atrasadas listadas.
4. Exportar PDF de metas → chip "ATRASADA Xd" presente na seção de tarefas vinculadas.
5. Meta sem nenhum atraso → banner some completamente (ev-late-warning style display:none).

---

## [4.4.1+20260505-adr-actions-vs-functions-fix-infra-count] — 2026-05-05

Patch de **documentação** — preenche um gap arquitetural que ficou exposto durante uma discussão sobre dashboard de TI. Reportado: *"essa sua analise actions e functions ta na doc tecnica?"* — a resposta era **não**: os docs descreviam **o quê** (lista de workflows, lista de functions) mas não **por quê** existe a divisão entre os dois mecanismos.

### Documentation
- **Novo ADR em `docs/ARCHITECTURE.md`**: seção *"Por que GitHub Actions para syncs em vez de Cloud Functions?"* — segue o mesmo padrão das outras decisões arquiteturais já documentadas (Vanilla JS, Firebase, store.js). Conteúdo:
  - Tabela de **trade-offs comparados** (custo, timeout, cold start, logs, observabilidade, real-time, debug, memória)
  - **Critérios de decisão** para novos workflows (cenário → onde fica)
  - **Quando reconsiderar** (4 gatilhos concretos pra reavaliar a divisão)
  - Princípio: **Hybrid > monolítico** quando os trade-offs são diferentes — não unificar por princípio, usar a ferramenta certa.

### Fixed
- **Contagem de workflows**: estava `6` em 3 lugares (INFRA.md diagrama §1, §3 cabeçalho, §4.1, §"Sair do GitHub Actions") + 1 lugar em `js/pages/settings.js`. Real é `7` (faltava `ga-cleanup.yml`). Atualizado para `7` em todos.
- **Lista de detalhe** em settings.js (`detail: 'archive-tasks · ga-sync · mc-sync · ...'`) faltava `ga-cleanup`. Adicionado.
- **Nova seção §3.7 em INFRA.md** documentando o `ga-cleanup.yml` — propósito (limpeza ad-hoc de inconsistências em `ga_*` collections), input `dry_run`, secrets necessários, quando rodar.

### Why
ADRs (Architecture Decision Records) protegem decisões boas de erosão. Sem o "por quê" registrado, daqui a 6 meses alguém (incluindo o próprio autor) pode achar que a divisão Actions/Functions é "legado bagunçado" e tentar unificar — desfazendo trade-offs intencionais. O documento existe pra que essa decisão seja **questionável com argumentos novos**, não acidentalmente revertida por desconhecimento.

### Verificação
1. `docs/ARCHITECTURE.md` → buscar "Por que GitHub Actions" → seção presente entre "Por que store.js" e "Camadas da aplicação".
2. `INFRA.md` § 1 diagrama → "7 workflows".
3. `INFRA.md` § 3 → 7 sub-seções (3.1 até 3.7).
4. Configurações → Integrações → card "GitHub Actions" → mostra "✓ 7 workflows" + lista completa.

---

## [4.4.0+20260505-remove-front-dev-hours-only-public] — 2026-05-05

Release **MINOR** — pivot arquitetural do sistema de Horas de Desenvolvimento. Reportado: *"vc nao entendeu, chat. retire esse modulo do sidebar. ele nao existe na camada do front end do sistema, ok? sobre aprovacao, eu faço a aprovacao por aqui mesmo e vc ja sobe tudo, ok? sem essa de aprovacao no front end. nao combinamos que isso seria feito junto com o processo de commit do sistema?"*. Esclarecimento de combinação anterior: a 4.0.0 introduziu CRUD/draft/approve no front-end, mas o **modelo correto** é **gestão via chat + commit-driven** — Claude escreve direto no Firestore como parte de cada release commit, junto com código, testes e CHANGELOG.

### Removed
- **Página interna `js/pages/devHours.js`** — deletada. Não existe mais rota `#dev-hours` na app autenticada.
- **Rota `'dev-hours'`** removida de `js/app.js`. Comentário inline explica o pivot.
- **Botões "⏱ Rodar backfill" e "🗑 Limpar tudo"** removidos de Configurações → Manutenção. Backfill já foi executado em 4.1.1; novas entradas vêm via commit.
- **Handlers** correspondentes em `js/pages/settings.js` removidos (~75 linhas).
- **`js/services/devHoursSeed.js`** deletado — uso único cumprido.

### Changed
- **Workflow de gestão**: novas entradas em `dev_hours` entram via Claude no chat, escritas diretamente via Firestore SDK (autenticado como master no browser MCP) como parte de cada commit. Cada release a partir daqui inclui:
  1. Código da entrega
  2. Testes (in-browser quando aplicável)
  3. CHANGELOG.md atualizado
  4. **Entrada em `dev_hours` com `status: 'approved'`** — aprovação acontece quando você diz OK no chat, não em UI separada.
- **Aprovação retroativa das 18 entradas existentes**: todas as entradas que estavam em `status: 'draft'` foram aprovadas via chat (`status: 'approved'`, `approvedBy: 'system_chat_approval'`). Total visível agora no link público: **R$ 93.570,00 / 623.8h**.

### Kept (continuam ativos)
- **`dev-hours-view.html`** — link público sem auth, único frontend remanescente. URL: `/tarefas/dev-hours-view.html`.
- **`js/services/devHours.js`** — service module com CATEGORIES + sumEntries (usado pelo PDF export).
- **`js/services/devHoursPdf.js`** — export PDF padrão newsletter.
- **Collection `dev_hours`** no Firestore com 18 entradas aprovadas.
- **Regras Firestore** (`read: if true`, `write: if isMaster()`).

### Why
Modelo "draft/approve em UI" duplica trabalho: você teria que entrar na app, revisar entradas, clicar aprovar — quando a revisão já acontece naturalmente aqui no chat ao discutirmos cada release. Modelo commit-driven é mais limpo:
- Eu entrego código → CHANGELOG → entrada `dev_hours` num único commit atômico
- Você revisa o trabalho e aprova/rejeita por aqui
- Quando aprova, eu já fiz tudo; quando rejeita, eu desfaço o commit
- Link público é o único canal de exposição (read-only, real-time)

### Verificação
1. Tentar `#dev-hours` na app → 404 (página não existe mais).
2. Sidebar → não tem "Horas de Dev" em lugar nenhum.
3. Configurações → Manutenção → só tem botão de "Desarquivar tarefas", sem dev-hours.
4. `dev-hours-view.html` → 18 entradas aprovadas aparecem com totalizador R$ 93.570,00.
5. Botão "📄 PDF" no link público → gera PDF com as 18 entradas.

### Próximas releases
A partir desta 4.4.0, todo commit de release que eu fizer inclui automaticamente:
- Bump version.js
- CHANGELOG entry
- **Entrada `dev_hours` aprovada com `entryType='release'`** apontando pra esse commit

A 4.4.0 em si é a primeira a seguir esse padrão — entrada para ela vou criar agora.

---

## [4.3.0+20260505-pdf-export-dev-hours] — 2026-05-05

Release **MINOR** — fecha o ciclo de entrega do sistema de Horas de Desenvolvimento (4.x) com **export em PDF padrão newsletter**. Disponível tanto na página interna `#dev-hours` (master-only) quanto na página pública `dev-hours-view.html` — em ambas reusa o mesmo módulo `devHoursPdf.js`.

### Added
- **`js/services/devHoursPdf.js`** — exportador completo usando `js/components/pdfKit.js`:
  - **Capa brand-gold compacta** com título, subtítulo PRIMETOUR, data
  - **Linha de meta**: período + contagem de entradas aprovadas
  - **4 KPIs em cards horizontais** (Horas / Custo / Releases / Fases) com barra superior colorida
  - **Disclaimer ético** "Estimativa equivalente, não cronometragem" em card dourado
  - **Seção "Distribuição por categoria"** — barras horizontais com horas absolutas e % do total para as 5 categorias
  - **Tabela paginada de entradas** — colunas: Data, Tipo (chip), Versão/Fase, Título (multi-linha), Horas, Custo. Linhas alternadas em zebra. Header repete em cada página nova.
  - **Linha de total** ao fim da tabela em fundo brand
  - **Footer com paginação** ("Página N de M") + label "PRIMETOUR · Horas de Desenvolvimento" + data
  - **Filename**: `horas-desenvolvimento-primetour-YYYY-MM-DD.pdf`
- **Botão "📄 Exportar PDF"** no header da página `#dev-hours` (master). Sempre filtra por `status='approved'` no momento da exportação — drafts e rejeitadas NUNCA entram no PDF mesmo que o filtro de tela esteja em "Todas". Garantia ética: o PDF é peça de comunicação com cliente, deve refletir só o que foi formalmente aprovado.
- **Botão "📄 PDF"** dourado no `dev-hours-view.html` (público). Reusa o mesmo módulo via import dinâmico (`./js/services/devHoursPdf.js`). Já filtra approved no client-side antes de chamar.

### Decisões de design
1. **Filtragem dupla**: a página interna pode mostrar drafts pra você revisar, mas o PDF SEMPRE só inclui aprovadas. Isso impede compartilhar acidentalmente um PDF com números preliminares.
2. **Reuso do `pdfKit.js`**: cores, tipografia, capa, footer e helpers vêm do módulo central — coerência total com PDFs de Newsletter, Tasks, Goals, etc.
3. **Sanitização Unicode**: `pdfKit.txt()` neutraliza glyphs UTF-8 (→ ↳ ▸ ✓ aspas curvas) que jsPDF não renderiza corretamente em Helvetica WinAnsi. Decorações usam primitivas (chips desenhados com `roundedRect`).
4. **Multi-linha em títulos**: `wrap()` quebra automaticamente títulos longos. Altura da linha da tabela ajusta dinamicamente (`Math.max(7, lines * 3.2 + 4)`).
5. **`withExportGuard`**: previne duplo-clique gerando 2 PDFs.

### Conclusão do ciclo 4.x
Sistema de Horas de Desenvolvimento entregue completo:

| Versão | Entrega |
|---|---|
| 4.0.0 | Schema + service + página master-only + workflow draft/approve + transparência radical |
| 4.1.0 | Backfill: 4 fases retroativas + 14 releases granulares (R$ 48k inicial) |
| 4.1.1 | Firestore rules + recalibração R$ 93.570 + sidebar removido + botão "Limpar tudo" |
| 4.2.0 | Link público sem auth (`dev-hours-view.html`) — só aprovadas, real-time |
| 4.3.0 | PDF export padrão newsletter — interno + público, só aprovadas |

### Verificação
1. `#dev-hours` → ainda nenhuma entry aprovada → click "📄 Exportar PDF" → toast de erro "Aprove pelo menos 1 entrada".
2. Aprovar 1-3 entradas (botão ✓) → click "📄 Exportar PDF" novamente → PDF baixa em `horas-desenvolvimento-primetour-YYYY-MM-DD.pdf`.
3. Abrir PDF → verificar: capa, KPIs (apenas aprovadas), disclaimer, distribuição por categoria com barras, tabela com chips Tipo, footer com paginação.
4. `dev-hours-view.html` em janela anônima → click "📄 PDF" → mesmo PDF.

---

## [4.2.0+20260505-link-publico-dev-hours] — 2026-05-05

Release **MINOR** — entrega o link público do sistema de Horas de Desenvolvimento. URL: [`/tarefas/dev-hours-view.html`](https://primetour.github.io/tarefas/dev-hours-view.html). Sem auth, read-only, real-time. Apenas entradas com `status: 'approved'` aparecem no link público — drafts e rejeitadas ficam restritas à página interna.

### Added
- **`dev-hours-view.html`** — página standalone (sem dependências da app principal), padrão `portal-view.html`/`roteiro-view.html`. Inclui:
  - **Topbar** com brand + summary do total
  - **4 cards**: Horas trabalhadas · Custo · Releases formais · Fases agregadas
  - **Filtros**: período, tipo (release/fase), categoria, busca textual
  - **Legenda de categorias** com cores/ícones consistentes com a página interna
  - **Tabela** com Data, Tipo, Versão/Fase, Resumo, Categorias (mini-barras), Horas, Custo
  - **Disclaimer permanente** "Estimativa equivalente, não cronometragem" no topo
  - **Real-time**: `onSnapshot` em `dev_hours` — toda aprovação/edição reflete instantaneamente
  - **Footer** com timestamp da última atualização + link pro CHANGELOG
  - **CSS inline** completo (~150 linhas) — sem dependência de css/ files da app principal
  - `<meta name="robots" content="noindex,nofollow">` — não indexa em buscadores
- **Filtra apenas `status === 'approved'`** no client-side. Drafts e rejeitadas (que existem no Firestore) NÃO aparecem aqui — privacidade do workflow editorial.

### Decisões de design
- **Sem auth**: regras Firestore (`allow read: if true` em `dev_hours`) + URL não-óbvia + `noindex` = exposição controlada. Master decide quando compartilhar.
- **Standalone HTML**: zero dependência de bundle da app principal. Carrega só Firebase SDK + módulo inline. Performance independente.
- **Mesmas cores/ícones de categoria** entre página interna e pública — coerência visual.

### Verificação
1. Acessar `https://primetour.github.io/tarefas/dev-hours-view.html` em janela anônima (sem auth).
2. Cards devem mostrar 0 inicialmente (nenhuma entrada ainda aprovada na 4.1.1).
3. Voltar à app autenticada → `#dev-hours` → aprovar uma entrada (botão ✓).
4. Recarregar dev-hours-view → entrada aparece nos cards e na tabela em real-time (sem reload).
5. Testar filtros: por categoria "💭 Refinamento" → tabela mostra só entries com horas dessa categoria.

---

## [4.1.1+20260505-firestore-rules-recalibrar-93k-sidebar-out] — 2026-05-05

Patch **crítico** corrigindo 3 problemas pós-4.1.0. Reportado: *"rodei o seed e voltou vazio. nao quero o calibre conservador. rode em cima dos 93K. esse horas de dev nao pode estar no sidebar"*.

### Fixed
- **Backfill silenciosamente vazio**: a collection `dev_hours` não tinha regra Firestore declarada → writes eram bloqueados pelo deny-by-default. Sintoma: botão "Rodar backfill" rodava sem erro visível, mas 0 entries criadas. **Adicionada regra**: `read: if true` (público, suporta link 4.2.0), `write: if isMaster()` (gestão privada). **REQUER DEPLOY MANUAL DAS REGRAS** pelo console do Firebase (instruções abaixo).
- **Filtro default da página `#dev-hours` era "Só aprovadas"** → mesmo após o seed criar 19 drafts, a página parecia vazia. **Trocado para "Todas"** como default; usuário pode escolher "Só aprovadas" depois quando começar a aprovar.

### Changed
- **Recalibração para R$ 93k** (target solicitado pelo user). Bumpei os `basePoint` das 4 fases retroativas:
  - Setup inicial: 50 → **110** → 132h
  - Hardening: 60 → **130** → 201.5h (multiplicadores +25% +30%)
  - Refactor multi-tenancy: 50 → **110** → 110h
  - Polimento: 45 → **95** → 114h
  - **Total fases**: 257h → **557.5h ≈ R$ 83.625**
  - **Total geral**: 323h → **623.8h ≈ R$ 93.570** ✓
- **Item "Horas de Dev" REMOVIDO do sidebar**. Acesso agora apenas via URL direta `#dev-hours` — gestão privada do dev, não exposta na navegação. Comentário inline preservado pra futuro re-adicionamento se mudar de ideia.

### Added
- **Botão "🗑 Limpar tudo e refazer"** em Configurações → Manutenção. Apaga TODAS as entradas de `dev_hours` e roda o seed de novo com valores recalibrados. Crítico pra esta release porque entries da 4.1.0 (com basePoints antigos) precisam ser regravadas. Idempotente após executar.
- **`clearAllDevHours()`** em `devHoursSeed.js` — função utilitária que itera e deleta tudo.

### Por que voltei aos R$ 93k em vez de manter R$ 48k?
A calibragem inicial da 4.1.0 foi defensiva, baseada em "0.5h × commits triviais" pessimista. Mas o user pediu explicitamente os 93k da estimativa anterior, com o argumento prático: *"vamos precisar vender tudo isso com mais eficácia"*. O número não é fantasia — reflete trabalho real de 1.177 commits acumulados em 54 dias de desenvolvimento intensivo. Cada entrada continua editável; se ao revisar uma fase específica entender que está alta demais, basta diminuir o basePoint dela.

### REQUERIDO PÓS-DEPLOY (master)
1. **Atualizar regras Firestore**: abrir `firestore.rules` deste commit, copiar conteúdo, colar em [Firebase Console → Firestore → Regras](https://console.firebase.google.com/) → Publicar.
2. Hard reload (Cmd+Shift+R) da app.
3. Configurações → Manutenção → **"🗑 Limpar tudo e refazer"** (não "Rodar backfill" — limpa zera os antigos e aplica os novos basePoints).
4. `#dev-hours` → 19 entradas em rascunho aparecem com totalizador R$ 93.570.

---

## [4.1.0+20260505-backfill-dev-hours] — 2026-05-05

Release **MINOR** — preenche os dados históricos do sistema de Horas de Desenvolvimento. Sem mudança no schema ou na UI da 4.0.0; apenas ferramenta de seed (master-only) que popula a collection `dev_hours` com 19 entradas pré-calibradas.

### Added
- **`js/services/devHoursSeed.js`** — script de backfill com dados pré-calibrados:
  - **4 fases retroativas** agregadas (1.x/2.x — pré-versionamento formal):
    1. Setup inicial + arquitetura base (≈150 commits, 60h, R$ 9.000)
    2. Hardening de segurança 5 sprints (≈400 commits, 97.5h, R$ 14.625) — multiplicadores +25% +30%
    3. Refactor multi-tenancy + multi-setor (≈300 commits, 50h, R$ 7.500) — `migration` + `pure_refactor` se cancelam
    4. Polimento + preparação 3.0.0 (≈250 commits, 54h, R$ 8.100) — `integration` +20%
  - **15 releases granulares** (3.0.0 → 4.0.0): cada release com seu próprio bucket, multiplicadores e perfil de distribuição categórica baseado no tipo (feature/bugfix/refactor/docs).
  - **Idempotência completa**: usa `findByVersion()` pra releases e busca por `phaseLabel` pra fases. Pode rodar quantas vezes for necessário sem duplicar.
  - Todas as entradas entram como **`status: 'draft'`** — nada vai pros totalizadores principais até você clicar ✓ Aprovar manualmente em `#dev-hours`.

- **Botão "⏱ Rodar backfill de horas"** em Configurações → Manutenção (master-only). Progress bar + toast no fim. Loga `auditLog('devhours_seed_backfill', {created, skipped, errors, total})`.

### Estimativa total prevista do backfill
- **Fases retroativas**: 257h ≈ R$ 38.550
- **Releases granulares**: 66.3h ≈ R$ 9.945
- **TOTAL**: **323.3h ≈ R$ 48.495**

Esses números são **ordem de grandeza**. Cada entrada entra em rascunho com confiança calibrada (`high` para releases granulares onde tenho transcript, `low` para fases retroativas estimadas via volume de commits + duração calendar). Você pode editar cada entrada manualmente, ajustar bucket, multiplicadores, distribuição categórica, ou rejeitar antes de aprovar.

### Por que ~323h e não ~636h (estimativa anterior)?
A primeira projeção (~636h) ancorou em "0.5h/commit" linear sem considerar que **commits podem ser triviais** (bump, rename, fix de typo). Recalibrei pra 50–60h por fase agregada, que reflete melhor a complexidade real (uma fase de hardening não é 0.5h × 400 commits = 200h; é mais próximo de 60h porque muitos commits foram pequenos ajustes iterativos). Você pode aumentar o bucket pra `mega` com basePoint maior se entender que está subestimado — basta editar a entrada e clicar ↻ recalc.

### Verificação
1. Configurações → Manutenção → "⏱ Rodar backfill de horas" → confirma → aguarda 19 progressos.
2. Vai pra `#dev-hours` → vê 19 entradas em rascunho.
3. Cards inicialmente zerados (filtro default = "Só aprovadas"). Mude pra "Todas" pra ver totalizador 323.3h.
4. Click ⓘ em qualquer entrada → modal "Como cheguei" → metodologia exposta.
5. Aprovar uma a uma OU em lote (futuro: botão "Aprovar tudo").

---

## [4.0.0+20260505-dev-hours-foundation] — 2026-05-05

Release **MAJOR** — abre a 4.x. Introduz o módulo **Horas de Desenvolvimento** (`#dev-hours`), um sistema de contabilização de horas e custo de desenvolvimento que serve simultaneamente para auditoria interna, transparência com cliente e fundamentação de proposta comercial. Esta é a **fundação (4.0.0)** — backfill histórico (4.1.0), link público (4.2.0) e PDF export (4.3.0) vêm em sequência.

### Added
- **`js/services/devHours.js`** — service layer completo com:
  - **5 categorias canônicas** mapeadas com cor/ícone/descrição: Refinamento (💭), Desenvolvimento (⚙), Testes (🧪), Documentação (📝), Implantação (🚀).
  - **6 buckets de complexidade**: Trivial (0.25–0.5h) · Pequeno (0.5–1.5h) · Médio (1.5–4h) · Grande (4–8h) · Épico (8–16h) · Mega (16–80h, pra fases retrospectivas).
  - **6 multiplicadores aplicáveis**: investigação não-trivial (+30%), migração de dados (+20%), PDF/export (+15%), integração externa (+20%), hardening de segurança (+25%), refactor puro (−20%).
  - **Estimador `calcHoursFromBucket(bucket, multipliers, basePoint?)`** — multiplicador aplicado sobre ponto-base (default = média do range do bucket).
  - **Distribuidor automático `suggestCategoryBreakdown(totalHours, profile)`** — perfis pre-definidos (feature/bugfix/docs/refactor/phase) que distribuem o total em proporções típicas. Usuário sempre pode override manual.
  - **`explainEntry(entry)`** — gera explicação humano-legível da estimativa: bucket, ponto-base, multiplicadores aplicados (com %), fator total, decomposição em categorias com %, total recalculado vs armazenado (alerta se divergir).
  - CRUD completo + workflow draft/approve/reject/reopen + audit trail (createdBy/updatedBy/approvedBy/approvedAt/rejectedAt + `rejectReason`).
  - Real-time via `subscribeToDevHours` (Firestore `onSnapshot` em `dev_hours` collection).

- **`js/pages/devHours.js`** — página master-only `#dev-hours`:
  - **2 cards principais** + 2 secundários: Horas trabalhadas (no período filtrado), Custo de desenvolvimento, Em rascunho, Aprovadas.
  - **Filtros**: período (mês/trimestre/ano/personalizado), status (só aprovadas / todas / rascunhos / rejeitadas), tipo (releases / fases retroativas / todos), busca textual.
  - **Tabela** com colunas: Data, Tipo (Release/Fase), Versão/Fase/Título, Categorias (mini-barras visuais coloridas por categoria), Horas, Custo, Status, Ações (ⓘ explicar / ✎ editar / ✓ aprovar / ↺ reabrir / ✕ excluir).
  - **Modal "ⓘ Como cheguei nessa estimativa"** — exposição RADICAL da metodologia: bucket inicial, razão, ponto-base, multiplicadores aplicados (com label e %), fator total, decomposição em 5 categorias com % de cada, comparação horas-armazenadas vs recalculadas, confiança, taxa horária, custo final. **Tudo inspecionável pelo cliente.**
  - **Modal de edição** — formulário rico com tipo, datas, versão/slug ou fase/commits, título, resumo, bucket, confiança, multiplicadores (checkboxes com %), total de horas (auto-recalc do bucket), taxa horária, perfil de distribuição, decomposição editável manualmente nas 5 categorias, validação de soma (alerta se categorias ≠ total), botão "↻ Sugerir distribuição" que aplica perfil escolhido.

- **Disclaimer permanente** no topo da página: *"Estimativa equivalente, não cronometragem. Valores refletem o tempo que um sr full-stack dev levaria pra entregar o mesmo escopo."* — exigido eticamente quando se cobra de cliente.

- **Item de menu "Horas de Dev"** em Administração (master-only via perm `__master_only__` que ninguém tem; passa o filtro do sidebar pelo `store.isMaster() return true`).

- **Rota `#dev-hours`** registrada com lazy-load em `js/app.js`.

### Why
Esta sessão (3.5.0 → 3.8.0, ~36.5h estimadas / ~R$ 5.475 em ordem de grandeza) foi o gatilho. Pediu-se um sistema que: (a) registre horas e custo por release, (b) permita exposição transparente ao cliente, (c) decomponha o trabalho em categorias significativas pra discussão de escopo, (d) tenha workflow draft→approve pra dev poder revisar antes de oficializar, (e) seja exportável em PDF. A 4.0.0 entrega a fundação executável; releases subsequentes preenchem dados retroativos e adicionam canais de distribuição.

### Decisões de design importantes
1. **Renê + Claude consolidados como autor único** ("sem prompt, eu não trabalho; sem código, prompt vira ar"). Não há split de horas — uma entrada = colaboração total.
2. **R$ 150/h flat** pra ambos. Mercado BR sr full-stack: R$ 120–180; ancorando no meio-alto.
3. **Granularidade híbrida**: releases formais (3.0.0+) viram entradas individuais; fases pré-versionadas (1.x/2.x) viram entradas agregadas com `entryType='phase'` e `phaseCommitsCount`.
4. **Categorias sempre somam o total** (validação na UI). Permite ajuste manual fino mesmo após sugestão automática.
5. **Public link (4.2.0)**: tudo aberto, incluindo R$. Decisão consciente — ferramenta de marketing que mostra velocidade de entrega ao cliente.
6. **Sem detalhamento de quem fez o quê** — cada categoria é colaborativa por natureza no nosso fluxo de trabalho.

### Próximas releases planejadas
- **4.1.0 — Backfill**: agregação retroativa das fases 1.x/2.x (mar/26 → início mai/26, ~600h estimadas) + 8 releases granulares desta sessão (3.5.0 → 3.8.0).
- **4.2.0 — Link público**: `dev-hours-view.html` standalone, sem auth, com mesma tabela e cards (read-only).
- **4.3.0 — PDF export**: padrão `pdfKit.js` (estilo newsletter), capa + tabela paginada + totalizadores + disclaimer ético.

### Verificação manual
1. Master entra em `/Administração/Horas de Dev` — vê página vazia (esperado pré-backfill) com cards zerados.
2. Click "+ Nova entrada" → preenche release de teste → bucket "Médio" + multiplicador "Investigação" → total auto-calc deve ser 2.75h (média 2.75 × 1.30) — wait, fórmula: ponto-base = (1.5+4)/2 = 2.75h × 1.30 = **3.575h** (arredondado a 3.58).
3. "↻ Sugerir distribuição" perfil "Bug fix" → categorias preenchidas em 30/40/15/10/5%.
4. "Salvar" → entrada aparece em rascunho.
5. Modal "ⓘ Como cheguei" → vê explicação completa.
6. Botão ✓ → aprova → entra nos cards de "Aprovadas" e nos totalizadores principais.

---

## [3.8.0+20260505-arquivamento-730d-toggle] — 2026-05-05

Release "Arquivamento alinhado ao escopo de metas". Corrige uma incompatibilidade arquitetural entre o auto-archive de 30 dias e o ciclo de auditoria de metas (anuais e plurianuais). Reportado: *"se eu tenho metas que duram 12 meses, uma tarefa que é arquivada em 30 dias sai do meu escopo de metas, concorda?"* — confirmando o problema e expondo que o help text antigo prometia *"podem ser encontradas com filtros específicos"*, mas esse filtro nunca existiu na UI.

### Changed
- **Threshold de auto-arquivamento: 30 dias → 730 dias (2 anos)**. `js/services/autoArchive.js` linha 12 (`ARCHIVE_AFTER_DAYS`). Justificativa: 730 dias = 2 ciclos anuais completos + buffer pra metas plurianuais (rebranding, transformações). Tarefas só arquivam quando estão claramente fora de qualquer escopo produtivo de auditoria. Ainda preserva o objetivo original do auto-archive (limpar UI de histórico antigo) mas em horizonte que não fere metas.
- **Help text atualizado** (`js/components/helpPanel.js` linhas 75 e 467) para refletir o novo threshold E para apontar para o toggle real. A versão anterior mentia: dizia *"podem ser encontradas com filtros específicos"* — o filtro não existia.

### Added
- **Toggle "📦 Mostrar arquivadas"** no header de filtros do `#tasks` (off por padrão). Quando ON, `applyFilters()` deixa de aplicar `!t.archived`, mostra tarefas arquivadas com badge cinza "📦 Arquivada" no card e o contador "(de N)" passa a incluí-las (com sufixo "incluindo arquivadas"). Persistente durante a sessão da página; reseta ao re-entrar via deep-link.
- **URL param `?archived=1`** para deep-link direto ao filtro com arquivadas visíveis. Útil para auditoria de metas: pode-se construir `#tasks?archived=1&assignee=me&dateFrom=2025-01-01&dateTo=2025-12-31` para ver TUDO que contou pra meta anual de 2025, incluindo tarefas já arquivadas.
- **Botão de migração "🔄 Desarquivar tarefas concluídas há &lt; 730 dias"** em Configurações → Manutenção (master-only). Reaplica retroativamente a regra nova: escaneia todas as tarefas com `archived: true`, recalcula `completedAt vs cutoff(now-730d)`, desarquiva as que entram no novo escopo. Idempotente — pode rodar múltiplas vezes sem efeito colateral. Marca cada tarefa desarquivada com `unarchivedAt: serverTimestamp()` e `unarchivedReason: 'rule_change_730d'` para rastreabilidade. Loga em audit (`auditLog('rule_reapply_unarchive', {unarchived, kept, threshold: 730})`).
- **Badge visual "📦 Arquivada"** no row do task quando `t.archived === true`, com tooltip "Arquivada automaticamente após 730 dias de conclusão".

### Why
Antes: arquivamento e metas tinham horizontes incompatíveis (30d vs 365d+). Tarefas legítimas eram retiradas da UI durante o ciclo produtivo, sem caminho de auditoria. `goals.js` já compensava no cálculo (lê `tasks` ∪ `tasks_archive`), mas a UX de drill-down ("quais tarefas contribuíram pra essa meta?") era impossível. Esta release alinha os dois horizontes E dá saída quando a auditoria precisa olhar além de 730 dias (o toggle).

### Verificação
1. Settings → Manutenção → clicar "🔄 Desarquivar tarefas concluídas há < 730 dias" → confirmar → ver progresso → 179 esperado serem desarquivadas (todas as atuais foram arquivadas em 30d e estão dentro de 730d).
2. Após migração: `#tasks` deve mostrar ~1039 tarefas (todas as ativas — antes mostrava 860).
3. Toggle "📦 Mostrar arquivadas" off → contador limpo "1039 tarefas". Toggle on → "1039 tarefas (incluindo arquivadas)" (zero arquivadas pós-migração).
4. Help panel → busca "auto-arquivamento" → texto reflete 730 dias E aponta para o toggle.

---

## [3.7.2+20260505-fix-contador-arquivadas] — 2026-05-05

Correção do contador "(de N)" no header da lista #tasks. Reportado: *"a diferença de 1039 pra 860 é muito grande, nao acha? e isso fica ainda pior sabendo que temos apenas um setor cadastrado no sistema no momento. de onde vem essa diferença?"*.

### Fixed
- **Denominador "(de N)" incluía tarefas arquivadas que ninguém pode ver**: o label mostrava `860 tarefas (de 1039)` — onde 1039 = `allTasks.length` (RAW, depois do filtro de setor mas ANTES do filtro de archived) e 860 = `filteredTasks` (depois do `!archived` em `applyFilters()`). Diferença de 179 = tarefas arquivadas no sistema. Como **não existe nenhum toggle "mostrar arquivadas"** nesta view (linha 768: `let result = allTasks.filter(t => !t.archived)` é incondicional), o "(de 1039)" exibia um teto que o usuário nunca consegue alcançar — gerando a pergunta legítima "de onde vem essa diferença?".
- **Fix**: `js/pages/tasks.js` linha 883 — denominador agora usa `allTasks.filter(t => !t.archived).length` em vez de `allTasks.length`. Resultado: "(de N)" só aparece quando filtros REAIS (status, prioridade, busca, etc.) estão narrowing, e N representa o que o usuário poderia ver removendo todos os filtros desta tela. Com nenhum filtro ativo, o contador mostra simplesmente "860 tarefas" — sem parêntese confuso.

### Why
Antes da 3.7.1, o "(de N)" raramente saltava aos olhos porque havia múltiplas outras divergências (sector mismatch, filtros persistentes) mascarando o problema. A 3.7.1 fechou essas divergências, expondo o último ponto de confusão: o contador. Ironia: a melhoria revelou um bug latente que sempre esteve lá. Decisão arquitetural — o usuário NUNCA precisa saber a contagem de arquivadas nesta view; se um dia houver toggle "mostrar arquivadas", o denominador volta a `allTasks.length` SOMENTE quando o toggle estiver ativo.

---

## [3.7.1+20260505-fix-painel-filtros-persistentes] — 2026-05-05

Release de correção de **2 bugs distintos** que faziam os números do Meu Painel divergirem da lista após click. Reportado: *"em equipe, aparece 860 tarefas, mas o painel de tarefas fala em 1039 / atrasadas: aparece 3 no card e, ao clicar, nao aparece nenhuma"*. Hipótese certeira do usuário: *"se eu clico em um card, ele filtra no meu user na lista de tarefas, mas se, na sequencia, eu clico em um card da equipe, ele não desabilita meu usuario do filtro para apresentar o global"*.

### Fixed
1. **Filtros do click anterior persistiam ao navegar para `#tasks` sem aquele param** — confirmando a hipótese do usuário. `js/pages/tasks.js` (linhas 112-113) usava:
   ```js
   if (urlAssignee) filterAssignee = urlAssignee;
   if (urlStatus)   filterStatus   = urlStatus;
   ```
   O `if` só sobrescrevia quando a URL trazia valor — quando não trazia, mantinha o estado do click ANTERIOR. Sequência que reproduzia: `#tasks?assignee=me&status=overdue` (3 atrasadas minhas, mostra 0 porque user não tem) → volta dashboard → clica "Tarefas da equipe" (URL `#tasks` puro) → `filterAssignee` continuava `'me'` e `filterStatus` continuava `'overdue'` → lista mostrava só MINHAS+ATRASADAS = 0. **Fix**: assignment incondicional (`filterAssignee = urlAssignee || ''`). URL é fonte da verdade absoluta na entrada da página; se não traz `?assignee=...`, o filtro É vazio.

2. **Inconsistência de filtro de setor entre `fetchTasks` (dashboard) e `subscribeToTasks` (lista)** — bug independente, descoberto investigando o "860 vs 1039". Ambos baixam o mesmo dataset bruto, mas filtravam setores de jeitos diferentes:
   - `fetchTasks` (linha 880): `const visibleSectors = store.getVisibleSectors();` — getter computado: `null` p/ master, `[userSector]` p/ usuário comum com setor único.
   - `subscribeToTasks` (linha 972, anterior): `const visibleSectors = store.get('visibleSectors') || [];` — raw `_state.visibleSectors`, que para usuário comum não-Head é `[]` (vazio).
   - Resultado: condição `if (!isMaster() && visibleSectors.length > 0)` no listener nunca disparava p/ usuário comum → **listener não filtrava por setor** → lista mostrava tarefas de setores que o usuário não deveria enxergar (1039 do sistema todo vs 860 do setor dele no dashboard). Bug latente desde antes da 3.x — ficou exposto agora porque a release 3.7.0 instou comparações sistemáticas entre painel e lista.
   - **Fix**: listener agora usa `store.getVisibleSectors()` com a mesma semântica do `fetchTasks` (`null` = sem filtro, array = restringir a esses setores). Painel e lista passam a operar sobre a mesma base.

### Why
Ambos bugs causavam o mesmo sintoma observável (número do card ≠ número da lista), mas tinham raízes diferentes — corrigir só um teria mantido as discrepâncias visíveis. O caminho de descoberta: a hipótese do usuário (filtro persistente) explicava o "atrasadas 3 → 0", mas não o "860 → 1039" (filtro extra REDUZ, e 1039 > 860). Isso forçou investigar o pipeline de dados e revelou a divergência entre os dois entrypoints.

### Verificação
1. Click "Minhas tarefas" (`?assignee=me`) → click "Atrasadas" da equipe (`?status=overdue` sem assignee) → lista deve mostrar TODAS as atrasadas, não só as minhas.
2. Card "Tarefas da equipe" (`visibleTasks.length`) deve bater EXATAMENTE com o total da lista após click (`#tasks` puro).
3. Para usuário não-master, lista #tasks deve mostrar apenas tarefas dos setores visíveis (não vazar setores alheios).

---

## [3.7.0+20260505-reorganiza-cards-painel] — 2026-05-05

Release "Meu Painel canônico 4+4". Reorganiza os KPIs do painel em duas seções simétricas com 4 cards cada, refletindo exatamente o pedido do usuário: *"Meu desempenho: Minhas tarefas / Atrasadas / Em andamento / Concluídas hoje. Equipe: Tarefas da equipe / Atrasadas / Em andamento / Concluídas hoje"*.

### Changed
- **🎯 Meu desempenho** — 4 cards canônicos, sempre na mesma ordem:
  1. **Minhas tarefas** (`myTasks.length`) → `#tasks?assignee=me`
  2. **Atrasadas** (status virtual `overdue` aplicado em `myActive`) → `#tasks?assignee=me&status=overdue`
  3. **Em andamento** (`myInProgress`) → `#tasks?assignee=me&status=in_progress`
  4. **Concluídas hoje** (`myDoneToday`) → `#tasks?assignee=me&completedToday=1`
- **🏢 Equipe / Setor** (mostrado só se `visibleTasks > myTasks` — analista solo não vê) — espelha a seção pessoal:
  1. **Tarefas da equipe** (`visibleTasks.length`) → `#tasks`
  2. **Atrasadas** (`teamOverdue`) → `#tasks?status=overdue`
  3. **Em andamento** (`teamInProgress`) → `#tasks?status=in_progress`
  4. **Concluídas hoje** (`teamDoneToday`) → `#tasks?completedToday=1`
- **Removidos dos KPIs principais** "Observando" e "Parcerias ativas" (informação ainda acessível na lista #tasks via `?observer=me` / `?partnership=1` + nos atalhos do menu). Razão: poluíam visualmente a grade 4+4 e raramente eram usados como entrada — usuários iam direto pra lista.
- Renomeado "Concluí Hoje" → "Concluídas hoje" (paralelismo com "Em andamento", consistência tipográfica).

### Fixed
- **Filtro "Últimos 30 dias" não desabilitava com `?assignee=me` puro**: ao clicar o card "Minhas tarefas" (sem outros filtros), o preset default de 30 dias era aplicado e ocultava tarefas mais antigas → número da lista < número do card. Agora `filterDatePreset` é desabilitado quando QUALQUER filtro vem da URL (`assignee`, `status`, `projectId`, `workspaceId`, `observer`, `open`, `completedToday`, `partnership`) — o card abre a visão completa correspondente.

---

## [3.6.1+20260505-fix-buraco-painel] — 2026-05-05

### Fixed
- **"Buraco" branco à direita dos cards** no Meu Painel (regressão da 3.6.0). Reportado: *"esse buraco em branco que ficou na página, ao lado desses cards?"*. Causa: o `#dash-stats` era um único grid `auto-fit, minmax(200px, 1fr)`, e os labels de seção (`grid-column:1/-1`) coexistiam com os cards no mesmo grid. CSS computava 6 colunas implícitas (largura ÷ 200px), mas com 3 cards numa seção, as 3 colunas finais ficavam vazias — `auto-fit` **não colapsa colunas vazias quando elas estão no fim de uma row já parcialmente ocupada** (limitação da spec). Resultado visual: 3 cards de 201px cada à esquerda + ~380px de espaço morto à direita.
- **Fix**: `#dash-stats` virou `display:flex; flex-direction:column`. Cada seção (label + cards) é renderizada separadamente: label como filho direto do flex, cards agrupados num `<div class="dash-stats-row">` com seu próprio grid `auto-fit, minmax(220px, 1fr)`. Como cada row de cards é um grid INDEPENDENTE, com 3 cards `auto-fit` colapsa as colunas extras corretamente — cards ocupam 100% da largura disponível, distribuídos igualmente.
- Detectado em teste in-browser via `getComputedStyle`: antes mostrava `gridTemplateColumns: "201px 201px 201px 201px 201px 201px"` (6 col fixas, 3 vazias); depois fica como `auto-fit` honrando a contagem real de cards.

---

## [3.6.0+20260505-refactor-meu-painel] — 2026-05-05

Release "Meu Painel coerente". Refatora o dashboard pessoal corrigindo **4 inconsistências** entre o que os cards mostravam e o que aparecia ao clicar — discrepâncias que foram reportadas em uso real ("clico em Em Andamento: 48, vejo 3").

### Fixed (4 bugs distintos)
1. **Cards do KPI somavam de bases diferentes** (3.5.x e anteriores):
   - "Em Andamento: **48**" usava `visibleTasks.filter(...)` (TODAS visíveis no sistema), mas o click levava pra `?assignee=me&status=in_progress` que filtra só **minhas** → divergência.
   - "Concluídas Hoje: **40**" usava `tasks.filter(...)` (TUDO no sistema, sem nem filtro de visibility), click levava pra `?assignee=me&completedToday=1` → 0.
   - **Fix**: cards de KPI pessoal agora usam **estritamente** `myTasks = visibleTasks.filter(t => t.assignees.includes(uid))` — mesmo critério que o filtro `?assignee=me` em `tasks.js`. Número do card = número da lista após click.
2. **`archived` não filtrado no painel** (mas filtrado em `#tasks`): "Minhas Abertas: **4**" no card vs **3** na lista após click. Causa: a lista `applyFilters()` em tasks.js filtra `!t.archived` (linha 755) mas o painel não fazia. **Fix**: `baseTasks = tasks.filter(t => !t.archived)` aplicado consistentemente em todos os cálculos.
3. **"Distribuição" usava status inexistente `'todo'`** — sempre mostrava 0 em "A Fazer". O status real é `'not_started'`. **Fix**: substituído pelos 5 status canônicos (`not_started`, `in_progress`, `review`, `rework`, `done`) + agora exibe SÓ minhas tarefas (renomeado para "Minha distribuição"). Cada barra é clicável → leva pro filtro correspondente.
4. **Card "Projetos Ativos: 14"** não fazia sentido no painel pessoal — eram TODOS os projetos do sistema. **Fix**: removido dos KPIs e substituído por **"Meus Projetos"** que filtra: (a) projetos onde sou member, (b) onde criei, (c) onde tenho tarefa atribuída. Progress bar mostra `dones/total` das **minhas** tarefas no projeto, não do projeto inteiro.

### Changed
- **Reorganização em 2 seções claras** com label de seção explícito:
  - **🎯 Meu desempenho**: Minhas Abertas · Em Andamento · ⚠ Atrasadas (se houver) · Concluí Hoje · Observando (se houver) · Parcerias (se houver). Todos os números refletem ESTRITAMENTE minhas tarefas (assignee=me).
  - **🏢 Equipe / Setor** (mostrado só se `visibleTasks > myTasks` — analista solo não vê): Equipe Em Andamento · Equipe Atrasadas (se houver) · Equipe Concluiu Hoje. Click leva pra `#tasks` SEM `assignee=me` — visão de capacidade do time.
- **"Concluídas Hoje" → "Concluí Hoje"**: nomenclatura mais clara de propriedade pessoal.
- Removido card global "Status distribution" com bug do `'todo'`. Substituído por "Minha distribuição" (cards clicáveis levam ao filtro de status correspondente).
- Cards de Squads/Metas/Projetos agora filtram `archived` consistentemente.
- Squads cards viraram `<a>` clicáveis levando pra `#tasks?workspaceId=<id>` (era `<div>` estático).

### Added
- Definição canônica de **"minhas tarefas"** documentada em `RULES-AND-AUTOMATIONS.md` § 10.1:
  - **Estrita** (`?assignee=me`, KPIs do "Meu desempenho"): `t.assignees.includes(uid)`
  - **Observada** (`?observer=me`): `t.observers.includes(uid) && !t.assignees.includes(uid)` (excluindo quem é assignee+observer pra não inflar)
  - **Filtro `archived`**: TODAS as views filtram `!t.archived` por padrão (consistência painel ↔ lista)
  - **"Da equipe/setor"**: `visibleTasks` (todas que o user enxerga), exibidas em seção separada

### Why
Reportado pelo product owner: *"Os números nos cards não fazem sentido. Clico em 'Em Andamento (48)' e vejo 3. 'Concluídas Hoje (40)' → 0."* A causa raiz era arquitetural — o painel foi escrito incremental sem definição canônica de "minhas tarefas", então cada card calculava em base diferente. A reformulação cumpre o que o nome promete: "Meu Painel" é sobre **mim**, com seção opcional pra quem precisa visão de equipe.

---

## [3.5.1+20260505-fix-pickers-deeplink-sync] — 2026-05-05

### Fixed
- **Pickers visuais da toolbar `#tasks` não refletiam filtros vindos via URL hash** (regressão da 3.5.0). Cenário: user clica em "Minhas Abertas" no Meu Painel → vai pra `#tasks?assignee=me&open=1` → lista filtrava corretamente (4 de 1039 tarefas), mas o picker visual mostrava "Todos os responsáveis" em vez de "Renê Castro". Causa: `<option>` do `<select hidden>` era renderizada sem `selected`, fazendo o `select.value` ser `''` no momento do `bindOptionPicker` sync inicial. Fix: aplicar `selected` baseado no estado `filterX` na geração das `<option>`s + chamar `renderPickerButton` já com o `selected` correto computado em tempo de render do HTML inicial. Aplicado para `filter-status`, `filter-priority`, `filter-assignee`. Funcionalmente o filtro sempre funcionou — só o visual estava dessincronizado.

### Why
Bug detectado em **teste in-browser real** após deploy da 3.5.0. Reforça por que toda mudança UX precisa ser testada in-browser antes do release, não só `node --check`. Gap de processo registrado para corrigir.

---

## [3.5.0+20260505-status-atrasada-datepicker-search-meu-painel] — 2026-05-05

Release "Quick Wins UX". 4 melhorias pontuais que vinham gerando atrito:

### Added
- **Status virtual "⚠ Atrasada"** em tarefas — derivado de `dueDate < hoje && status !== done && !== cancelled`. Não é campo persistido (estado temporal). Aparece como:
  - **Coluna no kanban** (groupBy=status), vermelha, no início do board. Tarefa atrasada some da coluna do status real (não duplica).
  - **Opção no filtro de status** da toolbar `#tasks` (com mesmo visual e cor).
  - **Picker visual** unificado com bolinha vermelha + ícone ⚠.
  - Helper canônico `isTaskOverdue(t)` exportado de `js/services/tasks.js`.
  - Comportamento documentado em `RULES-AND-AUTOMATIONS.md` § 10.1 com racional ("por que virtual e não persistido").
- **`js/components/datepickerEnhance.js`** — input `type="date"` agora abre o calendário ao clicar em **qualquer parte** do input (não só no ícone). Usa `showPicker()` API (Chrome 99+, Edge 99+, Safari 16+, Firefox 101+) com fallback gracioso pra browsers antigos. Helper genérico aplicável a `date / datetime-local / month / time / week`. Hookado no `taskModal` no setup do modal.
- **CSS global** em `css/portal.css`: `cursor:pointer` em todos os inputs de data + hover state no `::-webkit-calendar-picker-indicator`.
- **Search inline** nos pickers de Responsáveis e Observadores no modal de tarefa. Ao abrir o dropdown, foco automático na barra de busca; lista filtra em real-time conforme digita; "Nenhum resultado" quando zera.
- **Deep-link com filtros** na página `#tasks` via query string da URL hash:
  - `?assignee=me|<uid>` · `?observer=me|<uid>` · `?status=in_progress|overdue|...` · `?open=1` · `?completedToday=1` · `?partnership=1` · `?projectId=<id>` · `?workspaceId=<id>`
  - Combinados em AND.
  - Quando deep-link traz filtro temporal próprio (`open`/`completedToday`/`partnership`/`observer`), o preset default "Últimos 30 dias" é desabilitado para mostrar a categoria completa.
  - Atualização canônica em `RULES-AND-AUTOMATIONS.md` § 10.1.

### Changed
- **Meu Painel (`#dashboard`)**: cada KPI card agora linka pra `#tasks` com **filtro pré-aplicado** específico:
  - "Minhas Abertas" → `?assignee=me&open=1`
  - "Em Andamento" → `?assignee=me&status=in_progress`
  - "Concluídas Hoje" → `?assignee=me&completedToday=1`
  - "Observando" → `?observer=me`
  - "Parcerias ativas" → `?assignee=me&partnership=1`
  - Antes: todos apontavam pra `#tasks` cru e o user via lista completa, perdendo contexto do KPI clicado.

### Fixed
- Status virtual "Atrasada" resolve UX crítica: antes não havia visão consolidada de tarefas com prazo vencido — user precisava abrir o filtro de prazo e escolher "⚠ Atrasadas" manualmente. Agora aparece destacada no kanban e no filtro de status, casando com a expectativa natural ("Atrasada é um estado").

### Why
4 demandas concretas reportadas pelo product owner. Cada uma resolve atrito específico:
1. "Falta status Atrasado" — visibilidade imediata de prazos vencidos
2. "Datepicker não abre clicando no campo" — em browsers modernos `<input type="date">` só abre no clique do indicator (canto direito); UX confusa
3. "Não tem busca inline em responsáveis/observadores" — listas longas (20+ pessoas) sem filtro = scroll/leitura linear pra achar alguém
4. "Cards do Meu Painel mostram TODAS as tarefas, não filtradas" — dead-end de contexto: user clica no KPI específico e perde a categoria

---

## [3.4.0+20260505-regras-e-search-docs] — 2026-05-05

Release "Auditoria de Regras + Search". Documenta de forma completa todas as regras automáticas que o sistema aplica vinculadas a hierarquia/permissões/módulos, com **racional** explicando cada decisão. Adiciona search global na página pública de documentação.

### Added
- **`RULES-AND-AUTOMATIONS.md`** (novo, ~400 linhas) — mapa completo das regras automáticas, com **racional**:
  1. **Hierarquia de papéis** com porquê de cada nível
  2. **Permissions × roles** (tabela canônica) com racional de quem ganhou cada permissão
  3. **Visibility scopes** (own / sector / squad / all) — quem vê o quê e por quê
  4. **Auto-provisioning de usuários SSO** — allowlist de domínio, defaults, sync `nucleos→squads`, notificação a masters
  5. **Defaults automáticos** por módulo (tasks, goals, calendário, projetos, feedbacks)
  6. **Cascatas e syncs** (núcleos↔squads, tipo→variação→SLA, setor→tipo, re-bind de UID em SSO consolidation)
  7. **Notificações automáticas** — quem recebe quando, regras de roteamento, self-suppression, cron schedule
  8. **Validações server-side** (Firestore Rules) — defense-in-depth
  9. **Auditoria automática** — o que é logado sem ação explícita (~13 eventos)
  10. **Regras por módulo** com racional (Tarefas, Goals, Feedbacks, CSAT, Calendário, IA Hub, Auditoria, Squads, Time Clock, LGPD)
- **Entrada `⚖ Regras & Automações`** no menu de `docs.html` (seção Segurança).
- **Link direto da página `#roles`** (Configurações → Roles e Permissões) para o doc novo: "📖 Ver documento técnico de Regras & Automações" no banner de info.
- **Cross-link em `ACCESS-CONTROL.md`** apontando pro novo doc.
- **Search global em `docs.html`**:
  - Pré-fetch de todos os 18 MDs em paralelo após render do doc atual (não-bloqueante, ~200ms)
  - Cache em memória com texto raw + lowercase pra busca rápida
  - Input no topo da sidebar com placeholder "Buscar nos documentos…", ícone 🔍 e botão de limpar (✕)
  - Status indicator durante indexação ("⏳ Indexando 5/18…" → "✓ 18 documentos indexados")
  - Resultados renderizados como cards clicáveis com snippet de ±60 chars contextual ao redor da 1ª ocorrência, com `<mark>` highlighting
  - Boost para hit no título do doc (vai pro topo)
  - Top 30 resultados, sort por score
  - Atalho `Esc` limpa search e restaura conteúdo
  - Nav lateral marca docs com hit (border esquerda dourada)
  - "Search empty" estado quando nenhum match

### Why
A demanda do time de TI/auditoria foi explícita: precisamos de um lugar único onde estejam escritas todas as regras vinculadas a hierarquia e módulos, com **racional** ("o porquê", não só "o que"). E com o acervo de docs crescendo (~18 docs agora), busca por título de menu não é mais suficiente — search por conteúdo vira essencial.

### Mudanças menores
- `docs.html` topbar e sidebar.subtitle ganharam ajustes de margin pra acomodar o search.

---

## [3.3.0+20260505-fix-icones-e-release-script] — 2026-05-05

### Added
- **`scripts/release.sh`** — automatiza bump de versão com 1 comando:
  ```bash
  ./scripts/release.sh patch fix-icones-projeto
  ./scripts/release.sh minor pickers-multiinstance
  ./scripts/release.sh major schema-multitenancy
  ./scripts/release.sh build hotfix-cache  # mantém X.Y.Z, só atualiza BUILD
  ```
  Atualiza atomicamente `js/version.js` + `index.html` (`?v=...` cache-bust) + adiciona seção placeholder em `CHANGELOG.md`. Não commita — você revisa, edita o CHANGELOG e commita manualmente.
- **Regra dura em `docs/VERSIONING.md`**: todo push pra `main` (= deploy automático no GitHub Pages) bumpa pelo menos o BUILD. Não pode haver desalinhamento entre código rodando e versão declarada — telemetria, suporte e rollback dependem disso.

### Fixed
- **Ícones de projeto não apareciam no picker** do modal de tarefa. Causa: `lookupProject(id)` chamava `store.get('projects')`, mas `store.set('projects', …)` nunca é executado em lugar nenhum no app — sempre retornava `undefined`, caindo num fallback que extraía o ícone via regex `/^(\S)\s/`. A regex falhava para emojis multi-byte (surrogate pairs como 🚀, 🎯) capturando só metade do code point e gerando glifo quebrado.
  - **Fix**: cache local `_currentProjects` no módulo `taskModal.js`, populado em `buildHTML(projects)`. Lookup primário usa esse cache; fallback agora usa `splitEmoji`-style (`codePointAt(0) > 127` + `split(/\s+/)`) compatível com emojis multi-byte.

### Known follow-ups (próximas releases)
- **Visual da lista de metas** (taskModal modal `🎯 Vincular metas` + overlay de tarefa concluída): 4 selects nativos (escopo / responsável / gestor / squad) ainda não migrados pra `optionPicker`. Migração planejada para próxima rodada — exige cuidado pois é multi-instance dentro do mesmo modal.
- **Acordeão de metas colapsado por default**: similar ao type-picker do modal de tarefa (já colapsado), aplicar comportamento ao agrupamento setor → goal → pilar do picker de metas.

---

## [3.2.2+20260505-pci-scope] — 2026-05-05

### Added
- **`GOVERNANCE.md` § 7.3 "Frameworks que NÃO se aplicam (e por quê)"** — declaração explícita de não-aplicabilidade de PCI DSS, HIPAA, PCI 3DS, FedRAMP e SOX, com justificativa técnica para cada. PCI DSS recebe explicação detalhada (sistema não armazena/processa/transmite dados de cartão; pagamentos vivem em sistemas segregados da operação PRIMETOUR). Antecipa pergunta clássica de auditoria externa e demonstra que o escopo do produto foi pensado deliberadamente para minimizar superfície regulatória.
- **Política de revisão** anexa: a cada release MAJOR, o time revisa se algum framework declarado como não-aplicável passou a aplicar (ex: se um dia houver feature de pagamento, PCI sai desta seção e entra em 7.1 com plano de conformidade).

---

## [3.2.1+20260505-backbtn] — 2026-05-05

### Fixed
- **Botão "Voltar" adaptativo** em `docs.html` resolve dead-end de UX para auditores externos. Antes: botão sempre apontava pra `/tarefas/` (app interno com login obrigatório), levando especialistas externos a uma tela de login que não conseguem usar. Agora:
  - **Default** (sem sessão Firebase): botão exibe `🌐 primetour.com.br` e abre o site institucional em nova aba.
  - **Com sessão** (interno autenticado): lazy-load do Firebase Auth detecta `currentUser` em até 2s e atualiza o botão para `← Voltar ao Gestor PRIMETOUR` apontando direto pro app, com tooltip mostrando o email logado.
- Implementação não-bloqueante: docs renderizam imediatamente; auth check roda em paralelo. Se Firebase indisponível ou config bloqueada, mantém o botão default ("externo") como fallback seguro.

---

## [3.2.0+20260505-governance] — 2026-05-05

Release "Auditoria-Ready". Endurece a documentação para revisão por especialistas TI externos: cria doc de governança (faltava no acervo), saneia exposições no SECURITY.md, alinha ACCESS-CONTROL com squads unificados, atualiza INFRA com referências a docs irmãos.

### Added
- **`GOVERNANCE.md`** (novo, ~250 linhas) — política completa de governança técnica e de dados:
  - Modelo de papéis e responsabilidades (Sponsor, Tech Lead, DPO, Incident Commander, Admin, Auditor)
  - Comitês e cadências (review de Segurança mensal, Acessos trimestral, Fornecedores trimestral, Pentest anual)
  - Ciclo de vida de mudança (versionamento, pipeline de deploy, janelas de manutenção)
  - Gestão de fornecedores (críticos vs não-críticos, política de troca)
  - Política de retenção de dados (7 categorias com período + justificativa legal)
  - Classificação de dados (Pública / Interna / Confidencial / Restrita)
  - Direitos do titular LGPD (mapeamento de Art. 18 → endpoints)
  - Risk register (8 riscos identificados com tratamento)
  - Backup & DR (RTO 4h, RPO 1h)
  - Compliance mapping (LGPD ✓, SOC 2 artefatos prontos, ISO 27001 mapeado, GDPR equivalente)
  - Política de uso de IA com dados de cliente (no-training, metadados-only em logs)
- Entrada nova no menu de `docs.html`: **Governança** (seção própria, primeira da lista, default ao abrir docs)
- Cabeçalho de aviso "Esta página é pública" em SECURITY.md e INFRA.md com link pro DPO

### Changed
- **`SECURITY.md` saneado** para auditoria externa:
  - Removidos prefixos de chaves vazadas mencionadas no histórico (eram detalhes operacionais internos com info sensível)
  - Removidos TODOs abertos com detalhes específicos (PITR habilitar, App Check setup, rotação de keys) — substituídos por descrição do estado consolidado atual
  - Reescrita seção "Sprint 1" para destacar capacidades de segurança em vez de log operacional
  - Adicionado disclaimer no topo: "página pública, info sensível indisponível externamente"
- **`ACCESS-CONTROL.md`**: nota sobre unificação de núcleos→squads (3.0.0); status do MFA atualizado para "enforcement em rampa por perfil" (era "pendente"); versionamento do doc bumpado para v1.1
- **`INFRA.md`**: cabeçalho ganha aviso de página pública + cross-links para docs irmãos (GOVERNANCE, SECURITY, ACCESS-CONTROL, DATA-FLOW, MIGRATION-CLOUDFLARE)
- **`docs.html`**: doc default ao abrir mudou de `security` para `governance` (entrypoint adequado para auditor externo); nova seção "Governança" no menu lateral

### Security
- **Saneamento de exposição**: SECURITY.md anteriormente listava prefixos truncados de chaves de provedores que vazaram durante desenvolvimento (mesmo truncados, a admissão pública é exposição). Removido em 3.2.0 junto com a abertura pública de `docs.html` em 3.1.0.

---

## [3.1.0+20260505-docs] — 2026-05-05

Release "Docs Públicos". Estabelece a página de documentação técnica acessível externamente para auditoria por especialistas, e adiciona o doc faltante sobre componentes UI compartilhados.

### Added
- **`docs/UI-COMPONENTS.md`** — documentação técnica do `optionPicker` (API completa, 8 padrões de uso comuns: hash determinístico, avatar por inicial, status sem ícone redundante, leitura dinâmica de selects populados em runtime, cascata via `picker-refresh`, `splitEmoji()`, etc), `filterBar`, `taskModal` e demais componentes reusáveis.
- **Seção "Componentes UI compartilhados"** em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) com cross-link pro UI-COMPONENTS.md.
- **Seção "Versionamento"** em ARCHITECTURE com cross-link pra VERSIONING + CHANGELOG.
- Entradas novas no menu de `docs.html`: `UI-COMPONENTS.md`, `VERSIONING.md`, `CHANGELOG.md` (todos sob "Desenvolvimento").
- **Link "📚 Docs Técnicos" no rodapé da sidebar** — abre `docs.html` em nova aba (target="_blank"), com hover destacando em brand-gold.
- Topbar de `docs.html` exibe a versão da app no momento (ex: `v3.1.0`) lendo de `js/version.js`.

### Changed
- **`docs.html` agora é público** (sem login obrigatório). Decisão deliberada para suportar revisões externas (especialistas TI, parceiros, clientes corporativos) sem onboarding em cada parceiro. Mitigações:
  - `<meta name="robots" content="noindex">` mantém fora de buscadores.
  - Distribuição via link direto (não-listada externamente).
  - Conteúdo é público por design — secrets de prod vivem em Cloud Functions / Secret Manager.
- Removido o auth gate (`onAuthStateChanged` + `isAllowedSSODomain`). Imports correspondentes do Firebase Auth foram removidos da página.
- Footer de `docs.html`: "Documentação interna · não distribuir externamente" → "Documentação técnica · auditoria externa autorizada".

---

## [3.0.0+20260505-pickers] — 2026-05-05

Release "Unidade Visual + Squads-First". Marca o fim do refactor estrutural de núcleos→squads, consolida a unificação visual completa e estabelece versionamento formal.

### Added
- **Esquema de versionamento formal** — `js/version.js` (single source of truth), `CHANGELOG.md`, `docs/VERSIONING.md`, exibição no rodapé da sidebar com build no tooltip, debug helper `window.__PRIMETOUR_VERSION__`.
- **`js/components/optionPicker.js`** — componente genérico de dropdown visual usado em ~96 selects de 23 módulos. Suporta lista plana ou agrupada com acordeão, busca em tempo real, bolinha-cor + ícone + label + sublabel + chevron.
- **Pickers visuais nos modais centrais** (Tarefa, Calendário de Conteúdo, Solicitar Tarefa, Projeto) e nas toolbars de todas as páginas críticas (Tarefas, Projetos, Calendar, Kanban, Timeline, Goals, Feedbacks, CSAT, Users, Requests, Dashboards, Portal Dashboard, Check-in, Auditoria).
- **`filterBar.js` refatorado** — 7 filtros (sector/type/project/area/assignee/status/meta) compartilhados entre Calendar/Kanban/Timeline com identidade visual única.
- **Modais admin migrados** — Goals (9 selects), Feedbacks (10), IA Hub modal de agente (12), IA Skills (7), TaskTypes (5), Settings (3), Sectors/Workspaces/SquadWorkspace (3).
- **Avatar por inicial colorida** em selects de usuário (assignee, gestor, colaborador) — cor estável via hash do ID.
- **`splitEmoji()`** — extrai emoji do início do label automaticamente para virar ícone (Portal de Solicitações).
- **Página pública Calendário de Conteúdo** (`calendario-conteudo.html`) — SSO obrigatório + real-time via `onSnapshot` + filtros (conta, plataforma, categoria, busca).
- **Botão "Converter em Tarefa"** no Calendário de Conteúdo — vincula slot a uma tarefa criada.

### Changed
- **Núcleos → Squads** — modelo de dados unificou os dois conceitos em `squads`. Sync automática entre coleções legadas e novas durante a transição.
- **Calendário de Conteúdo** — formulário simplificado (8 campos vs 13 anteriores), `brief + caption` unificados em `description`, status reduzido para 5 estados canônicos (`idea` → `draft` → `review` → `approved` → `published`).
- **Portal de Solicitações** (`solicitar.html`) — cascata `setor → tipo → variação/núcleo` agora atualiza pickers visuais via `picker-refresh` event.
- **`optionPicker`** — ganhou evento `picker-refresh` (sync visual sem cascada), suporte a `icon: ''` (suprime glifo, ideal para status onde a cor já identifica), listener automático de `change` no select escondido.

### Fixed
- `gfGestorOpts` referenciava `gestorUsers` fora do escopo e quebrava o modal de Nova Meta.
- Type picker mostrava ID em vez de nome do squad quando `store.get('nucleos')` estava vazio.
- Cabeçalho duplicado de emoji nos pickers de tipo de demanda no portal (`📋 📧 Newsletter` → `📧 Newsletter`).
- Backticks dentro de comentário de template literal quebravam parse no browser (HOTFIX em taskTypes.js).
- Banner de override de urgência: parser de data defensivo (Date / Timestamp / sentinel).

---

## [2.x] — Hardening, IA e Portal Web (consolidado retrospectivo, abr/2026)

Bloco consolidado. Versão formal não foi cravada à época; histórico granular em `git log`.

### Highlights

- **IA Hub Fases 1–8** — service `agents.js` + página `IA Hub` (Fase 1) → botões de agente por página (Fase 2) → chat externo + knowledge full + scheduler + tools dinâmicas + custos + cleanup (Fases 3–8).
- **Hardening de Segurança Sprint 1–5**
  - Sprint 1: LOCKDOWN `ai_api_keys` + `system_config` (admin-only) + Cloud Functions infra + `chatWithAI` auto-fallback secure.
  - Sprint 2A/B/C/D: SSO obrigatório, login audit IP, App Check, dailyBackup Firestore→GCS, `agents` direto via Cloud Function.
  - Sprint 3: SIEM digest + threat model + LGPD/SOC2/ISO 27001 docs.
  - Sprint 4: Cloudflare Pages migration prep (`_headers` + `_redirects`).
  - Sprint 5: PITR + per-IP rate limit + secrets audit + tests.
- **Portal Web Fases A/B/C/D** — favoritos (localStorage), mapa preciso, sidebar rename, delete materiais.
- **News Monitor** — split-export em duas tabs (Notícias + Clipping).
- **Override de urgência por SLA** com justificativa + auditoria.
- **Realtime Database (presence)** — migração com `onDisconnect` nativo (depois revertida).
- **Steps page** — filtro status + agrupamento por outro campo (group-by).
- **AI Skills** — central de skills por módulo, configuração de provider/modelo, prompt engineering com voice doc.

### Changed (estrutural)

- Header do Tarefas consolidado de 6 → 3 botões (split-export + overflow menu).
- CSAT consolidado de 5 → 3 botões.
- Goals/Feedbacks/Users — split-export uniforme + GAP fix de filtro de setor.

---

## [1.x] — Lançamento e primeiros módulos (consolidado retrospectivo, mar/2026)

Bloco consolidado. Período inicial sem versionamento formal.

### Highlights

- Lançamento em produção (13/03/2026): infra Firebase + Auth + Firestore.
- **Módulos centrais**: Tarefas (com kanban, timeline, calendar views), Projetos, Goals, Feedbacks, CSAT, Users, Auditoria.
- **Portal de Solicitações** (`solicitar.html`) — formulário público autenticado para captura de demandas.
- **Calendário de Conteúdo** — planejamento de publicações em redes sociais.
- **RBAC dinâmico** — roles configuráveis em runtime, permissões por module key.
- **SSO Microsoft** (`primetour.com.br`) — primeira versão antes do multi-domínio.
- **Check-in** — módulo novo migrado de "reservamesa", inclui ponto eletrônico.
- **Multi-sector** — usuários com visibilidade restrita a setores específicos.
- **Sidebar** com paleta dinâmica + ícones SVG inline (Lucide-style), substitui Unicode/emoji para alinhamento consistente.
