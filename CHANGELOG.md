# Changelog — Gestor PRIMETOUR

Todas as mudanças relevantes do sistema. Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/) — segue [SemVer](docs/VERSIONING.md).

> **Sobre a calibragem inicial**: `js/version.js` foi formalizado em 05/05/2026, no commit `722a2ab`. Antes disso, a app passou por meses de desenvolvimento sem versionamento estruturado (~1.161 commits entre 13/03 e 05/05/2026, incluindo migrações de schema, refactors arquiteturais, novos módulos e hardening de segurança em 5 sprints). Os blocos `[1.x]` e `[2.x]` abaixo consolidam esse histórico em fases retrospectivas; granularidade fina segue em `git log`. A partir de `3.0.0`, todo bump é rigoroso (ver [docs/VERSIONING.md](docs/VERSIONING.md)).

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
