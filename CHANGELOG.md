# Changelog — Gestor PRIMETOUR

Todas as mudanças relevantes do sistema. Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/) — segue [SemVer](docs/VERSIONING.md).

> **Sobre a calibragem inicial**: `js/version.js` foi formalizado em 05/05/2026, no commit `722a2ab`. Antes disso, a app passou por meses de desenvolvimento sem versionamento estruturado (~1.161 commits entre 13/03 e 05/05/2026, incluindo migrações de schema, refactors arquiteturais, novos módulos e hardening de segurança em 5 sprints). Os blocos `[1.x]` e `[2.x]` abaixo consolidam esse histórico em fases retrospectivas; granularidade fina segue em `git log`. A partir de `3.0.0`, todo bump é rigoroso (ver [docs/VERSIONING.md](docs/VERSIONING.md)).

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
