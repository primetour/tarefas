# Changelog — Gestor PRIMETOUR

Todas as mudanças relevantes do sistema. Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/) — segue [SemVer](docs/VERSIONING.md).

---

## [1.2.0+20260505-pickers] — 2026-05-05

Release "Unidade Visual": ~96 selects nativos migrados para o componente compartilhado `optionPicker` em 23 módulos. Esta é a maior consolidação de UX desde o lançamento.

### Added
- **`js/components/optionPicker.js`** — componente genérico de dropdown visual. Bolinha-cor + ícone + label + sublabel + chevron. Suporta lista plana, agrupada com acordeão e busca. Integra hash determinístico para cores estáveis.
- **Pickers visuais nos modais centrais**: Tarefa (5 campos), Calendário de Conteúdo (4), Solicitar Tarefa (5), Projeto (1).
- **Pickers nas toolbars**: Tarefas (status, prioridade, squad, área, responsável), Projetos, Calendar, Kanban, Timeline, Goals, Feedbacks, CSAT, Users, Requests, Dashboards, Portal Dashboard, Check-in, Auditoria.
- **Componente compartilhado `filterBar.js`** refatorado: 7 filtros (sector/type/project/area/assignee/status/meta) usados em 3 páginas com identidade visual única.
- **Modais admin migrados**: Goals (9 selects), Feedbacks (10), IA Hub (modal de agente, 12), IA Skills (7), TaskTypes (5), Settings (3), Sectors/Workspaces/SquadWorkspace (3).
- **Avatar por inicial colorida** em selects de usuário (assignee, gestor, colaborador) — cor estável via hash do ID.
- **`splitEmoji()`** — extrai emoji do início do label automaticamente para virar ícone (Portal de Solicitações).
- **Página pública Calendário de Conteúdo** (`calendario-conteudo.html`): SSO obrigatório + real-time via `onSnapshot` + filtros (conta, plataforma, categoria, busca).
- **Botão "Converter em Tarefa"** no Calendário de Conteúdo — vincula slot a uma tarefa criada.
- **Esquema de versionamento** (`js/version.js`, `CHANGELOG.md`, `docs/VERSIONING.md`) e exibição da versão no rodapé da sidebar.

### Changed
- **Calendário de Conteúdo**: formulário simplificado (8 campos vs 13 anteriores), `brief + caption` unificados em `description`, status reduzido para 5 estados canônicos (`idea` → `draft` → `review` → `approved` → `published`).
- **`optionPicker`**: ganho do evento `picker-refresh` para sincronizar visual sem disparar efeitos colaterais (cascata, re-render). Quando `icon: ''` é passado, suprime o glifo e renderiza só a bolinha-cor (caso típico de status).
- **Portal de Solicitações** (`solicitar.html`): cascata `setor → tipo → variação/núcleo` agora atualiza pickers via `picker-refresh`.

### Fixed
- `gfGestorOpts` referenciava `gestorUsers` fora do escopo e quebrava o modal de Nova Meta.
- Type picker mostrava ID em vez de nome do squad quando `store.get('nucleos')` estava vazio.
- Cabeçalho duplicado de emoji nos pickers de tipo de demanda no portal (`📋 📧 Newsletter` → `📧 Newsletter`).
- Backticks dentro de comentário de template literal quebravam parse no browser.

---

## [1.1.0] — 2026-05-04

### Added
- Modal de Tarefa: 4 campos com `optionPicker` (Variação, Squad, Área, Projeto) — primeiro uso do componente.
- Picker de Tipo de Tarefa agrupado por **Squad** (antes era por Setor) com nomenclatura unificada.
- Squads colapsados por padrão no popover do picker de tipo.
- Etapas de Steps: ✓ cinza por padrão no botão de conclusão.
- Agrupamento de tarefas por squad na lista.

### Changed
- Label "Squad / Workspace" → "Squad" no modal de tarefa (alinhamento de nomenclatura).
- Banner de override de urgência: parser de data defensivo (Date / Timestamp / sentinel).

### Fixed
- Header do picker de tipo mostrava ID em vez de nome do squad quando `store.get('nucleos')` ainda não havia sido populado em `#tasks`.

---

## [1.0.0] — Lançamento inicial

Versão inicial em produção. Histórico granular anterior está apenas em `git log`. Esta versão estabelece a baseline a partir da qual SemVer é aplicado rigorosamente.
