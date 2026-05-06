# Changelog — Gestor PRIMETOUR

Todas as mudanças relevantes do sistema. Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/) — segue [SemVer](docs/VERSIONING.md).

> **Sobre a calibragem inicial**: `js/version.js` foi formalizado em 05/05/2026, no commit `722a2ab`. Antes disso, a app passou por meses de desenvolvimento sem versionamento estruturado (~1.161 commits entre 13/03 e 05/05/2026, incluindo migrações de schema, refactors arquiteturais, novos módulos e hardening de segurança em 5 sprints). Os blocos `[1.x]` e `[2.x]` abaixo consolidam esse histórico em fases retrospectivas; granularidade fina segue em `git log`. A partir de `3.0.0`, todo bump é rigoroso (ver [docs/VERSIONING.md](docs/VERSIONING.md)).

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
