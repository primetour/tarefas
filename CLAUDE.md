# PRIMETOUR — Regras Permanentes pro Claude

> **CRÍTICO**: este arquivo é auto-carregado em TODA sessão. As regras abaixo são **inegociáveis** — o Renê NÃO precisa pedir essas coisas, elas fazem parte do contrato de trabalho.

---

## 1. SEMPRE testar em ambiente real antes de entregar

**Não é opcional. Não é "se der tempo". É obrigatório.**

Antes de dizer "feito" / "entregue" / "pronto" / "testado", para QUALQUER mudança de UI ou comportamento:

1. **Bumpar versão** (`js/version.js` + cache-bust em `index.html`)
2. **Commit + push**
3. **Aguardar GH Pages publicar** (~60-90s, usar `until curl ... | grep "patch: NN"` em background)
4. **Abrir Chrome via MCP** (ferramentas `mcp__Claude_in_Chrome__*`)
5. **Reproduzir o fluxo end-to-end** que o Renê veria — não só inspecionar DOM, mas validar comportamento:
   - Botão visível? Aparece no lugar certo?
   - Click dispara o handler?
   - Erros no console?
   - Estado final coerente?
   - **Se backend (Cloud Function)**: `firebase deploy --only functions` ANTES do GH Pages.

Se o Renê perguntar "testou?", o default deve ser SIM com evidência (logs, screenshots, JSON do estado). Honestidade sobre o que NÃO foi testado é melhor que falsa confiança — mas evite chegar a esse ponto: TESTE.

**Cobertura mínima esperada por release**:
- Caminho feliz (input válido → resultado esperado)
- Pelo menos 1 caminho de erro (input inválido / sem permissão / rede ruim)
- Renderização inicial sem JS errors no console

Browser de uso recorrente: deviceId `0b796249-4342-415b-9697-d0d2d237b945` (Browser 1, macOS local). Já está logado em sessões recentes.

---

## 2. SEMPRE atualizar dev_hours + DEV-HOURS.md a cada release

Após cada release minimamente significativa (qualquer patch que envolva mais de 5 min de trabalho real):

### a) Criar entrada no Firestore `dev_hours`
- Collection: `dev_hours`
- `entryType: 'release'`
- `releaseVersion`: versão SemVer (ex: `4.49.74`)
- `releaseSlug`: build string (ex: `20260521-roteiros-ai-agent-luxo`)
- `title` + `summary` (descrição rica do trabalho)
- `bucket`: `trivial` (0.25-0.5h) · `small` (0.5-1.5h) · `medium` (3-8h) · `large` (8-16h) · `mega` (16-80h)
- `multiplierIds[]`: complicadores aplicados (ver `DEFAULT_MULTIPLIERS` em `js/services/devHours.js`)
- `profile`: `feature` / `bugfix` / `phase` / etc.
- `aiAssistanceMultiplier: 0.50` (4.35+)
- `hoursByCategory`: breakdown (refinamento/desenvolvimento/testes/documentacao/implantacao)
- `status: 'approved'` (se eu tiver confiança) ou `'draft'` (se quiser revisão do Renê)
- `hourlyRate: 150` BRL

Use admin SDK script ou direct Firestore write se necessário — não esperar o Renê abrir UI pra logar.

### b) Atualizar `docs/DEV-HOURS.md`
- O header tem **última atualização** (versão + data + totais) → atualizar
- Se houve mudança estrutural no esquema do `dev_hours` (campos novos, lógica de cálculo, etc.), atualizar a seção §2 "Modelo de dados"
- Backfill notes (linhas com `_Backfill {data}_:`) quando aplicável

### c) Atualizar aba "Foco em Produto" no `dev-hours-view.html`
- Tab switcher em `dev-hours-view.html` linha 218+
- Esta aba **filtra apenas entradas com `module` ligado a produto** (não infra/docs/segurança)
- Se a release nova for "foco em produto" (feature visível ao cliente final / consultor), garantir que aparece nesse filtro
- O filtro é dinâmico via `entryMatchesModules` em `devHours.js` — só revisar se algum módulo novo foi criado

---

## 3. SEMPRE atualizar o doc técnico do sistema

Quando a mudança altera arquitetura, fluxo de dados, contrato externo ou regra de negócio importante:

### Arquivos a manter atualizados:
- **`docs/ARCHITECTURE.md`** — decisões arquiteturais. Mexe quando: cria novo módulo, muda integração, troca infra, redesenha fluxo.
- **`DATA-FLOW.md`** — fluxos de dados (Firestore → UI → APIs externas). Mexe quando: novo agente IA, nova integração, novo pipeline.
- **`DATA-MODEL.md`** — schema Firestore. Mexe quando: collection nova, campo novo, migração.
- **`ACCESS-CONTROL.md`** — RBAC / permissions. Mexe quando: role nova, permission granular, mudança de visibility.
- **`docs/ONBOARDING.md`** — guia de onboarding. Atualizar se fluxo de cadastro/setup mudar.
- **`CHANGELOG.md`** — SEMPRE atualizar a cada release (já é feito, mas confirmar).
- **`FACT_SHEET.md`** — fichas rápidas de módulos/features. Atualizar quando feature nova chega.

### Nunca incluir:
- Horas, valores monetários, custos no doc técnico (vai pra DEV-HOURS.md isolado)
- Decisões pessoais ou nomes (manter institucional)

---

## 4. SEMPRE respeitar o padrão visual existente

**Não invente componente UI antes de auditar o sistema.** O Renê reclamou diretamente: *"se não fica parecendo que tem vários sistemas em um só"*. Erros do passado que NÃO devem se repetir:

- ❌ Criei classes próprias `.re-add-btn` (dashed) no editor de roteiros — sistema usa `.btn .btn-primary/.btn-secondary/.btn-ghost`
- ❌ Inventei gradient roxo (`#7c3aed → #a855f7`) pro botão IA — sistema usa `var(--brand-blue)` ou `var(--brand-gold)`
- ❌ Inventei `border:1px dashed` em containers — sistema usa `border:1px solid var(--border-subtle)`
- ❌ Hardcoded `rgba(124,58,237,0.06)` — sistema usa `var(--bg-surface)`

### Checklist ANTES de criar qualquer UI:

1. **Abrir 2-3 páginas-modelo já existentes**:
   - `js/pages/portalImport.js` (forms + cards)
   - `js/pages/portalDashboard.js` (cards/tables)
   - `js/pages/contentCalendar.js` (page-header + filters)
   - `js/pages/portalDestinations.js` (módulo simples padrão)
2. **Identificar**:
   - Qual wrapper (`<div class="page-header">`, `<h1 class="page-title">`, `<div class="card">`)
   - Quais classes de botão (`btn btn-primary` / `btn-secondary` / `btn-ghost` / `btn-sm`)
   - Quais classes de form (`form-input`, `form-select`, `form-textarea` — ou no editor, `re-input/.re-select/.re-textarea`)
   - Quais variáveis CSS de cor (`var(--brand-blue)`, `var(--brand-gold)`, `var(--bg-surface)`, `var(--border-subtle)`, `var(--text-secondary)`)
3. **Reusar uiKit centralizado**:
   - `renderPageHeader({ title, subtitle, primary, secondary, export })` de `js/components/uiKit.js`
   - `renderFilterBar({ statusPills, search, selects, periodPills })`
   - `renderExportMenu`, `renderTabs`, `renderPeriodPills`
4. **Antes de inventar uma cor**: usa as variáveis CSS existentes. Se realmente precisa de uma nova, **discutir com o Renê** primeiro — não introduzir hardcoded.

### Anti-padrões visuais (NÃO fazer):

- ❌ `style="background:linear-gradient(...)"` em botão — gradient não é padrão do sistema
- ❌ `style="border:1px dashed"` — dashed não existe no sistema
- ❌ `style="box-shadow:0 4px 14px rgba(...)"` em botão — sistema não usa sombra pesada
- ❌ `class="re-add-btn"` pra um botão de ação primária — usar `class="btn btn-primary"`
- ❌ Cor RGBA hardcoded — usar variável CSS
- ❌ Inventar emoji-only labels (✨, 🎯) sem clareza textual — manter "Gerar com IA" não "✨"
- ❌ Misturar excesso de informação no header (3-4 status strings em uma linha)

### Anti-padrões de texto/UX:

- ❌ Frases redundantes (3 frases dizendo "preencha tudo isso")
- ❌ Placeholders longos parecendo manual (`Ex: Casal 55-60, brasileiros, viajantes experientes (já fizeram Europa 3x). Apreciam vinhos...`) — usar `Ex: Casal cultural` no máximo
- ❌ Botão "Criar com IA" + botão "+Novo Roteiro" — funções duplicadas confundem
- ❌ Checklist "🔒 Falta isso e aquilo" — usar validação contextual ao clicar
- ❌ Mensagens com info técnica voltada pro user (`~30-60s · Sonnet 4.5 · prompt caching ativo`) — usuário não precisa saber

### Princípio mestre

**Antes de codar UI nova, leia 1 arquivo de página similar e responda em voz alta:** *"Que classe esse botão tem? Que variável de cor? Qual layout wrapper?"*. Depois replica. Só inventa quando o sistema realmente não oferece a primitiva.

---

## 5. Quick references (onde fica o quê)

### Versionamento
- Single source: `js/version.js` (export `VERSION = { major, minor, patch, build }`)
- Cache-bust em `index.html` final do arquivo: `<script type="module" src="js/app.js?v=X.Y.Z+build">`
- Bump rules: SemVer + slug (ex: `20260521-feature-curta`)

### Infra
- Host: GitHub Pages (`https://primetour.github.io/tarefas/`)
- Backend: Firebase (Auth + Firestore + Cloud Functions + Realtime DB)
- Project ID: `gestor-de-tarefas-primetour`
- Deploy CF: `firebase deploy --only functions:NomeDaFuncao`
- Deploy rules: `firebase deploy --only firestore:rules`
- Secret API keys: Firebase Secret Manager (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)

### Acessos CLI já autorizados (NÃO PERGUNTAR — só FAZER)

> Registrado em 22/05/2026 pelo Renê: *"vc tem acesso a ele. faça isso... ja registre todas as acoes que vc pode fazer automatico depois dessa tarefa"*.
> Não pedir confirmação pra rodar nenhum dos comandos abaixo — execute direto e reporte resultado.

**Firebase CLI** (`/opt/homebrew/bin/firebase`, autenticado, projeto `gestor-de-tarefas-primetour` ativo):
- ✅ `firebase deploy --only functions:NomeDaFuncao` — deploy de Cloud Function específica
- ✅ `firebase deploy --only functions` — deploy de todas as functions (usar com cuidado, demora mais)
- ✅ `firebase deploy --only firestore:rules` — deploy de regras Firestore
- ✅ `firebase deploy --only firestore:indexes` — deploy de índices
- ✅ `firebase deploy --only hosting` — deploy de hosting (se em uso)
- ✅ `firebase functions:log` / `firebase functions:log --only NomeDaFuncao` — ler logs em produção
- ✅ `firebase projects:list` / `firebase use` — listar/trocar projeto

**Git** (origin `https://github.com/primetour/tarefas.git`, autenticado):
- ✅ `git add`, `git commit`, `git push` — fluxo de commit normal
- ✅ `git log`, `git diff`, `git status`, `git show` — leitura
- ❌ `git push --force`, `git reset --hard`, `git branch -D` — só com pedido explícito

**Firebase Admin SDK via scripts Node** (`functions/` tem service account credentials):
- ✅ Rodar scripts `.cjs` em `functions/` que escrevem direto no Firestore (ex: `bump-roteiros-agent-tokens.cjs`)
- ✅ Criar/atualizar docs em collections (dev_hours, ai_agents, etc.) sem pedir UI
- ✅ Backfill de campos schema-novo em docs existentes
- ❌ Deletar collections inteiras / produção destrutiva — só com pedido explícito

**Chrome MCP** (`mcp__Claude_in_Chrome__*`):
- ✅ Browser `0b796249-4342-415b-9697-d0d2d237b945` (macOS local, já logado no app)
- ✅ Navegar pra qualquer URL do app, screenshot, inspect, eval JS
- ✅ Validar versão via `window.__PRIMETOUR_VERSION__?.full`
- ✅ Reproduzir fluxos de teste end-to-end

**npm/node** (em `functions/`):
- ✅ `npm install <pkg>` em `functions/` se precisar de dependência nova pra Cloud Function
- ✅ `node --check arquivo.js` pra syntax check
- ✅ Rodar scripts ad-hoc com Admin SDK

**Curl/HTTP** pra testes:
- ✅ `curl` contra GH Pages, Cloud Functions endpoints públicos, APIs externas (Anthropic, OpenAI, etc.)
- ✅ Validar deploy via `curl ... | grep "patch: NN"`

### Fluxo de release autônomo (DEFAULT, sem perguntar)

Quando entregar release que toca Cloud Function + rules + client:

1. Bump `js/version.js` + cache-bust em `index.html`
2. Atualizar `CHANGELOG.md`
3. `git add` + `git commit` + `git push`
4. **`firebase deploy --only functions:NomeDaFuncao`** (rodar direto — NÃO pedir)
5. **`firebase deploy --only firestore:rules`** (se rules mudaram — rodar direto)
6. `until curl -s https://primetour.github.io/tarefas/js/version.js | grep "patch: NN"; do sleep 5; done` em background
7. Chrome MCP → testar E2E
8. Reportar com evidência (versão confirmada, logs, screenshot se aplicável)

Só perguntar antes se:
- Vai deletar collection inteira / dados em produção
- Push --force em main
- Operação destrutiva irreversível
- Custo financeiro alto não previsto (ex: rodar batch que vai consumir 1M+ tokens Anthropic)

### Chrome MCP
- Browser: `0b796249-4342-415b-9697-d0d2d237b945` (selecionar com `select_browser` antes de tudo)
- Tab principal: já existe no contexto recente — use `tabs_context_mcp` pra listar antes de navegar
- Sempre validar com `window.__PRIMETOUR_VERSION__?.full` que está na versão certa

### Padrões de código
- Vanilla JS + ES modules nativos (sem build step)
- Pub/sub central em `js/store.js` pra estado
- Lazy imports pra evitar circular deps
- Sem TypeScript, sem JSX
- CSP estrita (CDNs precisam estar autorizados em `index.html`)

---

## 6. SEMPRE simular TODOS os cenários antes de dizer "feito"

**Caminho feliz não é teste.** O Renê reclama com razão: *"você não prevê todas as ações possíveis... eu, em dois cliques, acho bug"*.

Antes de dizer "pronto/testado/funcionando":

### Cenários OBRIGATÓRIOS por feature

Pra qualquer formulário/lista/input/picker:

1. **Estado vazio** — sem dados, primeira vez
2. **Estado com 1 item** — degenerado
3. **Estado com N itens** — denso
4. **Estado parcial** — alguns campos preenchidos, outros não
5. **Ordem de preenchimento alternativa** — user pula campo, volta depois
6. **Reversibilidade** — adicionar item → REMOVER item → estado fica coerente?
7. **Pré-população** — se acabei de digitar X, modal/campo relacionado mostra X (não vazio)
8. **Autocomplete/dropdown** — opções estão ORDENADAS? AGRUPADAS? Filtram pelo que já digitei?
9. **Erro inline** — campo obrigatório vazio → erro contextual no campo, não toast genérico
10. **Edição** — abrir item existente, mudar, salvar — mantém o que não mudou?
11. **Cancelar** — fechar modal sem salvar → preserva estado anterior?
12. **Duplicação** — tentar criar item igual ao existente → o que acontece?
13. **Inputs adversários** — copy/paste com lixo, números negativos, strings muito longas, emoji

### Cenários OBRIGATÓRIOS por fluxo

- **Listagem → Editar → Voltar** → lista atualiza?
- **Listagem → Novo → Salvar → Voltar** → novo item aparece no topo?
- **Listagem → Novo → Cancelar** → nada criado?
- **Filtros + busca** → combinam? clearAll funciona?
- **Refresh durante operação** → não perde rascunho?
- **Estado offline/erro de rede** → mensagem clara, retry?

### Como testar SEM o Renê

Antes de pedir validação, **eu mesmo abro Chrome MCP e testo a checklist acima**. Não dá pra cobrir 100%, mas cobrir 0% é o que vem acontecendo.

Se um cenário for inviável de simular automaticamente (ex: drag-drop, upload de arquivo real), **eu digo isso explicitamente**: "testei caminho feliz, não cobri X porque Y — pode validar Z manualmente?" — em vez de generalizar "está OK".

### Anti-padrões de teste (NÃO FAZER)

- ❌ Testar só o caminho feliz ("preencheu, clicou, deu certo")
- ❌ Achar que `node --check` é teste
- ❌ Achar que ver o DOM via JS é teste de UX (precisa ver visualmente também)
- ❌ Dizer "está OK" sem ter feito pelo menos 4-5 cenários
- ❌ Implementar combobox/autocomplete sem testar com lista pequena, vazia e grande
- ❌ Implementar modal sem testar Cancelar e duplicação
- ❌ Implementar "remover" sem testar se o estado realmente reflete a remoção

---

## 7. PARAR e RACIOCINAR antes de implementar feature nova

**Este é o aprendizado mais caro até agora.** Renê me disse: *"não é melhor vc parar, pensar, raciocinar, buscar a excelência e executar com maestria? horas jogadas fora do meu trabalho de ficar corrigindo miudeza com vc"*.

Eu venho fazendo:
- Inventando estruturas de dados sem checar o schema existente
- Criando listas hardcoded (TIPOS_VIAGEM, ORCAMENTO_FAIXAS) sem perguntar
- Empilhando campos novos quando os existentes (client.preferences, client.restrictions, client.economicProfile) já cobririam
- Duplicando responsabilidades (Briefing vs Cliente, Interesses vs Perfil)
- Fazendo decisões UX arbitrárias (accordion fechado, campos sem label, datalist global em vez de contextual)

### Checklist OBRIGATÓRIO antes de codar feature/seção/campo novo:

1. **Schema** — abrir `emptyRoteiro()` / `js/services/<modulo>.js`. Existe campo equivalente já? Se sim, USAR ESSE.
2. **Sobreposição de responsabilidade** — esse campo novo conflita com algum existente? (Ex: "tipo de viagem" + "interesses" + "preferências" = redundante)
3. **Lista hardcoded** — estou criando array de opções no código (tipos, status, faixas)? **Errado**: cria entry no Firestore (`<modulo>_meta_<x>`) com CRUD via Settings, mesmo padrão de `portal_platforms`/`portal_types` que o Calendário usa.
4. **Jornada do usuário** — esse campo faz sentido NESSE momento do fluxo? Ou estou pedindo dado cedo demais? (Ex: "quero sugestão" antes do perfil)
5. **UX defaults** — accordion fechado, campos opcionais escondidos, clique-a-mais. Tudo isso exige justificativa. Default = visível.
6. **Datalist/autocomplete** — É **CONTEXTUAL**? Filtra pelo campo relacionado? (Ex: cidades filtradas pelo país)
7. **Labels e consistência** — todos os campos da mesma seção têm o mesmo padrão de label?

### Quando criar feature nova com dúvida:

- **NÃO codar** sem antes apresentar a proposta com schema + UX em ~5 linhas
- **NÃO inventar lista** sem perguntar se ela deveria ser editável
- **NÃO duplicar campo** que parece "novo" sem revisar todos os existentes
- **PERGUNTAR** quando há ambiguidade — uma pergunta agora poupa um refactor depois

### Sinal de alerta: se você está a ponto de criar um arquivo/seção novo e nenhum dos arquivos-modelo do sistema tem algo parecido, **PARE**. Quase certo que você está reinventando algo que já existe.

---

## 8. Anti-padrões visuais (NÃO FAZER)

- ❌ Dizer "testado" sem ter realmente aberto o Chrome
- ❌ Fazer commit sem bumpar versão + cache-bust
- ❌ Deploy de Cloud Function sem testar a função em produção depois
- ❌ Mudar arquitetura sem atualizar `docs/ARCHITECTURE.md`
- ❌ Adicionar nova collection Firestore sem atualizar `DATA-MODEL.md` + `firestore.rules`
- ❌ Adicionar permission granular sem atualizar `ACCESS-CONTROL.md` + auditar 4 níveis (UI gate / service JS / Firestore rule / role doc)
- ❌ Esquecer de atualizar `dev_hours` depois de release
- ❌ Reproduzir a entrega antes de ter validado o caminho de erro

---

## 9. Checklist mental antes de dizer "feito"

```
[ ] Versão bumpada (js/version.js + index.html cache-bust)
[ ] CHANGELOG.md tem entrada da release
[ ] Commit + push feitos
[ ] Cloud Function deployada (se aplicável)
[ ] GH Pages publicou (curl confirmou patch novo)
[ ] Chrome MCP aberto na versão nova
[ ] Caminho feliz testado E2E
[ ] **§6 — Cenários adversários testados** (vazio, 1 item, N itens, edição, cancelar, duplicação, ordem alternativa, reversibilidade)
[ ] Pelo menos 1 caminho de erro testado
[ ] Pré-população de modais relacionados verificada
[ ] Console limpo (sem JS errors)
[ ] dev_hours entrada criada (Firestore)
[ ] DEV-HOURS.md header atualizado
[ ] Doc técnico atualizado (se mudança estrutural)
[ ] Sem TODOs / FIXMEs órfãos no código
```

Se algum item falhar, **diga ao Renê o que ficou pendente** — honestidade > falsa confiança.

---

## 10. SEMPRE olhar o todo — atenção aos detalhes ao redor

**Aprendizado caro do dia 22/05/2026** (Renê: *"vc corrige a coluna de ícones e não corrige a coluna de período... percebe como é cansativo vc fazer as coisas sem olhar o contexto ao redor?"*).

Quando o user reporta **um problema visual ou de UX**, ele está apontando o **sintoma mais visível**, NÃO o escopo do trabalho. Se mexi num componente, eu sou responsável pelo **componente inteiro** — não só pela linha que toquei.

### Auditoria contextual OBRIGATÓRIA antes de declarar "feito":

Toda vez que tocar em UMA célula/coluna/botão/filtro/seção, **ANTES de commitar**, percorrer mentalmente:

1. **Coluna ao lado** — se mudei coluna A, conferir colunas A-1 e A+1 (alinhamento, larguras, ellipsis). Tabela `table-layout:fixed` precisa de `td.ellipsis` por TD, não basta no `th`.
2. **Hover state irmão** — se mudei hover de um botão, conferir hover dos botões adjacentes (consistência).
3. **Filtros relacionados** — se mexi num filtro (período), conferir o conjunto (status, busca, avançados) — eles precisam visualmente conversar.
4. **Estados de empty/erro** — se mudei o estado preenchido, ver como o vazio e o erro renderizam.
5. **Responsivo** — se mudei desktop, conferir mobile (`@media` rules).
6. **Outras páginas que usam o mesmo componente** — uiKit, btn, helpers compartilhados. Editar `renderPeriodPills` no uiKit afeta todas as listagens.

### Anti-padrões a NÃO repetir:

- ❌ Corrigir ícones de uma coluna sem auditar overflow das colunas vizinhas.
- ❌ Mudar estilo de um pill (período) sem checar os pills adjacentes (status, paginação).
- ❌ Adicionar nova classe CSS sem verificar se já existe equivalente no design system.
- ❌ Bumpar `min-width` de uma coluna sem revisar se o total bate com `min-width` da table.
- ❌ Mexer em `<th style="width:...">` sem verificar se o `<td>` correspondente tem ellipsis/overflow tratado.
- ❌ Fazer commit logo após o fix sem **abrir a página inteira no MCP** e olhar visual.

### Auditoria mínima por release tocando UI:

Antes do commit final:

1. Screenshot da página inteira na resolução padrão.
2. Em voz alta, percorrer: **header → filtros → tabela → ações → empty state**.
3. Para cada item, perguntar: *"isso ainda está OK depois da minha mudança?"*
4. Se algo "ainda está OK mas eu tocaria se estivesse fazendo do zero" — **corrigir no mesmo patch**, não num futuro.

Princípio mestre: **o usuário paga uma vez pelo trabalho. Se eu deixo 3 detalhes "pra depois", ele vai ter que voltar 3 vezes me pedindo. Toda visita extra ao mesmo arquivo é falha de excelência.**

---

## 11. Padrões de UI/UX aprendidos com o Renê (sprint 22/05/2026)

Lições concretas de 18 patches em sequência. Aplicar de cabeça nos próximos módulos.

### a) Modais são exceção, não regra

Renê em v99: *"tem que clicar 2x pra sair do popup... o padrão não é popup, é campo pra preencher sem sair da página"*.

- ❌ Não usar `<dialog>`/overlay pra **filtro ou input rápido** (period custom, range de data, etc.). Sempre tem chance de modal ficar órfão, dois cliques pra fechar, perder contexto.
- ✅ Usar inputs **inline** que aparecem condicionalmente embaixo do controle que ativou. Auto-aplicar on `change` (sem botão "Aplicar"). Esconder quando user desativa o controle.
- ✅ Modal só pra: confirmações destrutivas, formulários complexos com 5+ campos, ou workflows multi-step.

### b) Auto-save é OBRIGATÓRIO em qualquer formulário longo

Renê em v103: *"roteiro tem de ser salvo automaticamente como rascunho a cada X sec, pra não corrermos o risco do consultor reclamar que algum problema fez ele perder o trabalho"*.

- Debounce **5s** (não 30s+ — risco de perder muito), retry **10s** em erro (até 5x).
- Indicador **dinâmico**: "Salvando…" → "Salvo agora" → "Salvo há 12 seg" → "Salvo há 3 min". Atualiza via `setInterval` independente do save.
- `silent: true` flag pra **não disparar toast** em auto-save (só em manual click). Erro do auto-save loga no console + atualiza indicador, sem incomodar.
- `saveInProgress` flag pra evitar race condition entre auto-save concorrente e click manual.

### c) Conceito DUPLICADO confunde — só UM caminho canônico

Renê em v100: *"conceito de exportar pdf sujo na UI. tem botão na parte superior, mas tem aba mais completa de export"*.

- ❌ Não ter 2 botões diferentes pra mesma ação (header + aba dedicada).
- ✅ Eleger UMA fonte canônica (aba completa) e fazer os outros lugares apenas **atalhos de navegação** pra essa fonte (ícone na listagem → `&section=preview` → editor abre direto na aba).
- Princípio: cada ação tem **um caminho oficial**. Múltiplas formas só multiplicam pontos de falha + confusão.

### d) Filtros padrão = visíveis. Esconder atrás de expand é anti-padrão

Renê em v98: *"vou falar pela terceira vez: vc não mexeu nos filtros"*. Eu tava entendendo "estilizar" quando ele queria **funcionalidade + visibilidade**.

- ❌ `<details>`/collapse pra filtros que o consultor usa diariamente.
- ✅ Filtros essenciais (área, destino, tipo, consultor) **sempre visíveis** numa linha com label "FILTROS:" uppercase.
- ✅ Quando ativos, mostrar badge contagem + botão "Limpar".
- Reservar collapse pra filtros raríssimos (>4 filtros adicionais ou data range customizado raramente usado).

### e) Quando user reclama 2x+ da mesma coisa, PARAR e PERGUNTAR

Renê em v98: *"acho que estamos com problema de comunicação... coloque aqui no chat o que vc entendeu"*.

- Se na 2ª iteração ele aponta o MESMO problema, é sinal claro de que minha interpretação tá errada.
- ❌ Não tentar de novo no mesmo trilho.
- ✅ Parar de codar, escrever no chat: *"Minha interpretação atual é X — descreve em 2-3 frases o comportamento esperado e me corrige antes de eu refazer"*.
- A pergunta antecipa horas de retrabalho.

### f) Identidade visual = aplicar consistentemente, não cada lugar inventando

Renê em v97: *"trabalhar na identidade do site"*.

- Brand PRIMETOUR: **dourado** (`--brand-gold #D4A843`) como cor primária/active, **azul** secundário, semânticas (vermelho perigo, verde aprovado).
- Pills/buttons ativos: dourado bg + `#0A1628` text (dark navy). Hover: dourado leve `rgba(212,168,67,0.06)` + border dourado.
- ❌ Não usar azul genérico (`--brand-blue`) como cor de active em UI de produto premium — fica genérico, não combina com luxury.

### g) Persistência ≠ UI funcionando

Renê em "testou?": *"validação E2E inclui Firestore, não só DOM"*.

- ❌ Não declarar "validado" só porque a UI mostrou o estado esperado.
- ✅ Validar persistência: `fetchRoteiro(id)` direto do Firestore APÓS a ação, conferir campo no banco.
- Mudança de status, auto-save, transição de pipeline — TODOS precisam ser confirmados via fetch independente.

### h) Schemas legados merecem fallback explícito, não migração silenciosa

Renê pedindo refator de Valores: schema `customRows[]` virou `services{aereo,hoteis,...}`.

- ❌ Não migrar dado antigo automaticamente em código (risco de quebrar).
- ✅ Renderers fazem **fallback**: se `services` vazio, usa `perPerson/perCouple/customRows` legado. Consultor refaz na UI nova ao editar.
- ✅ Migration on-read garante shape mínimo defensivo (arrays vazios pros novos campos), mas nunca tenta interpretar dado antigo pra novo schema.

### i) Real-time recalc sem rerender — preservar foco

Renê em v102: *"faça atualizar em tempo real"*.

- ❌ Não usar rerender completo da seção quando user digita valor — perde foco.
- ✅ Listener no input/change que atualiza **nodes específicos** (subtotal, footer, hint) com `textContent` ou `innerHTML` parcial.
- Pattern: `recalcXyzTotals()` lê valores atuais do DOM, computa, e seta textos sem tocar nos inputs em si.

### j) Cleanup obrigatório em SPA — **só pra listeners GLOBAIS**

**Nuance importante (descoberta em auditoria v4.49.104)**: nem todo `addEventListener` precisa cleanup. Diferenciar:

- **Container-scoped** (`container.querySelector('btn').addEventListener(...)`): listener atrelado a DOM element. Quando container.innerHTML é resetado ao trocar de página, o elemento some + listener é GC automaticamente. **Não vaza.** É o caso dos 50 listeners de `aiHub.js`.
- **Global** (`document.addEventListener(...)`, `window.addEventListener(...)`): listener fica na referência global. Page muda mas listener continua vivo, escutando eventos da próxima página. **Vaza + dispara em contexto errado.** Esse é o problema real.

Regras:

- ✅ Toda page que faz `document.addEventListener` ou `window.addEventListener` PRECISA exportar `destroyXyz()` que remove esses listeners específicos.
- ✅ Salvar reference no container: `container._keyHandler = fn; document.addEventListener('keydown', fn);` — depois `document.removeEventListener('keydown', container._keyHandler)`.
- ✅ Pattern correto já existe em `roteiroEditor.js`: `destroyRoteiroEditor()`. Replicar APENAS em pages com listeners em document/window.
- ⚠️ `setInterval` / `setTimeout` longos também precisam `clearInterval/Timeout` no destroy. Audit achou 6 pages com 4+ `setTimeout` sem nenhum `clear` — investigar caso a caso (se for delay < 30s sem ref persistente, não vaza).

**Antes de commitar "fix memory leak"**: confirmar via `grep -n "document.addEventListener\|window.addEventListener"` que listener é REALMENTE global. Container-scoped é falso positivo.

### k) `confirm()` e `alert()` nativos são UX de 1995

**Auditoria 22/05**: 53 ocorrências de `confirm()` bloqueante + 5 `alert()` em `nlPerformance.js`. Estética quebrada (window default) + bloqueia main thread + não estilizável + screen reader sofre.

- ❌ `if (confirm('Tem certeza?')) ...` — diálogo nativo feio.
- ❌ `alert('Erro: ' + e.message)` — toast já existe em `js/components/toast.js`.
- ✅ Pra **info/sucesso/erro**: `showToast(msg, 'info'|'success'|'error')`.
- ✅ Pra **confirmação destrutiva** (delete, archive irreversível): modal customizado com 2 botões (Cancelar gray + Confirmar danger). Ex: padrão usado em `roteiroEditor.js` `_showAiProgress()`.
- ✅ Pra **ações reversíveis** (arquivar com 5s pra desfazer): toast com link "Desfazer" — não pede confirmação antes.

### l) Cor hardcoded `#xxxxxx` quebra dark mode + brand consistency

**Auditoria 22/05**: 86 ocorrências de `style="background:#XXX"` em pages — `#EF4444`, `#38BDF8`, `#F59E0B`, `#1F2937` etc. Quando o sistema mudar de tema (dark/light), essas cores não respondem.

- ❌ `<div style="background:#EF4444">` ou `color:#FFF`.
- ✅ Usar variáveis CSS já definidas: `var(--brand-gold)`, `var(--brand-blue)`, `var(--color-danger)`, `var(--text-primary)`, `var(--bg-surface)`, `var(--bg-card)`, `var(--border-default)`, `var(--border-subtle)`.
- ✅ Se semântica nova precisa de cor própria, primeiro adicionar em `css/base.css` como `--color-xxx`, depois usar.

### m) Ícones de ação na listagem — SVG, não chars unicode

**Já corrigido em roteiros (v96-97)** mas ainda problema em outras pages: `taskTypes.js`, `team.js`, `checkin.js`, `portalImages.js`, `newsMonitor.js`, `contentConfig.js` usam `✎` em vez de SVG.

- ❌ `<button>✎</button>` (chars unicode são pequenos, baixa legibilidade, dependem da fonte do SO).
- ✅ SVG inline 14-16px stroke-width 1.75 (Heroicons style) + `data-tip` atributo + CSS `::after` tooltip.
- Reference: padrão registrado em `js/pages/roteiros.js` `.rt-actions` (v4.49.96+).

### n) Status workflow é padrão repetível, não exclusivo de roteiros

Implementado em v103 só pra roteiros. Outras entidades têm pipeline implícito mas sem UI:
- CSAT: respostas têm status?
- Requests: aberto/em análise/respondido/arquivado?
- Vacation: pending/approved/rejected (já existe schema).

- ✅ Quando criar novo módulo com pipeline (>3 estados), replicar padrão `STATUS_DEFS` map + `_renderStatusDropdown` + `updateXxxStatus` com audit log.
- Pattern centralizado pode virar componente em `js/components/uiKit.js` futuramente.

### o) Schema legado nunca morre sozinho — campos zumbis acumulam

**Auditoria 22/05**: 39 referências a `perPerson/perCouple` em `js/pages/` + `js/services/` mesmo depois de v101 introduzir `pricing.services`. Renderers usam fallback (OK), mas dados antigos persistem.

- ❌ Não criar schema novo sem plano explícito de deprecation do antigo.
- ✅ Documentar em comentário ao lado do campo legado: `// LEGADO v4.49.100- — manter pra retrocompat até DD/MM/YYYY (mass cleanup script depois)`.
- ✅ Migration script periódica (mensal): converter docs antigos quando consultor abrir o doc na UI nova.
- ⚠️ Se dado legado nunca foi populado em produção (verificável via Firestore admin), pode remover schema na hora — não esperar deprecation cycle.

---

## 12. Armadilhas técnicas recorrentes (sprint 22-23/05/2026)

Bugs reais que pegaram horas e merecem entrar de cabeça nas próximas releases.

### a) `new Date('YYYY-MM-DD')` é UTC midnight — datas voltam 1 dia em pt-BR (v4.50.9)

**Sintoma Renê**: "coloquei validade inicio 01/01/2020 e o sistema deixou no card 31/12/2019".

**Causa**: JavaScript parseia string ISO sem hora como UTC midnight. Browser em UTC-3 chama `toLocaleDateString('pt-BR')` e renderiza 21h do dia anterior.

```js
new Date('2020-01-01').toLocaleDateString('pt-BR');     // ❌ "31/12/2019" em UTC-3
new Date('2020-01-01T12:00:00').toLocaleDateString('pt-BR'); // ✅ "01/01/2020" (T sem Z = local)
```

**Fix definitivo pra qualquer date helper que recebe string ISO**:

```js
function fmtDateBr(val) {
  if (!val) return '';
  if (typeof val === 'string') {
    const m = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;   // parse manual em string, ignora timezone
  }
  const dt = val?.toDate ? val.toDate() : new Date(val);   // Firestore Timestamp ou outros
  return dt.toLocaleDateString('pt-BR', {...});
}
```

**Auditar em todo helper futuro**: se aceita string YYYY-MM-DD, NÃO passa por `new Date()`.

### b) `script.onload` ≠ "prototype está pronto" — race condition em libs UMD

**Sintoma**: `doc.autoTable is not a function` mesmo após `await loadScript('jspdf-autotable')` retornar. (v4.50.5 → v4.50.6).

**Causa**: `onload` dispara quando o navegador termina de baixar+parsear o script, mas o último statement do bundle (`jsPDF.API.autoTable = function(){...}`) pode levar alguns ms a mais em determinados ambientes (especialmente browsers com isolamento heavy como o MCP Chrome).

**Fix defensivo**: polling pós-loadScript verificando a propriedade que importa:

```js
await loadScript(autoTableUrl);
for (let i = 0; i < 40 && !window.jspdf?.jsPDF?.API?.autoTable; i++) {
  await new Promise(r => setTimeout(r, 50));   // até 2s
}
if (!window.jspdf?.jsPDF?.API?.autoTable) throw new Error('plugin não carregou');
```

**Princípio**: sempre que carregar lib UMD que estende protótipo de outra (autoTable estende jsPDF, chartjs-plugin estende Chart, etc.), checar a propriedade-alvo em vez de confiar só em onload.

### c) Guard de cache que volta cedo demais — `if (window.x) return` esquece extensões

**Sintoma**: PDF do Banco falhava com `autoTable is not a function` SE o user tivesse passado pelo Dashboard antes (que carrega jspdf sem autoTable via pdfKit.js).

**Bug**:
```js
async function loadJsPDF() {
  if (window.jspdf) return window.jspdf;   // ❌ jspdf existe, mas SEM autoTable
  await loadScript(jspdf);
  await loadScript(autoTable);
}
```

**Fix**:
```js
async function loadJsPDF() {
  if (!window.jspdf) await loadScript(jspdf);
  if (!window.jspdf?.jsPDF?.API?.autoTable) await loadScript(autoTable);
}
```

**Generalização**: guard sempre checa o ESTADO FINAL desejado, não só a presença de uma flag. Especialmente quando o load envolve N etapas separadas que outros componentes podem ter parcialmente feito.

### d) Campos com nomes parecidos têm semânticas DIFERENTES — não confundir

**Sintoma Renê (v4.50.7→8)**: "coloca data de criação e data de validade no card" → eu coloquei `doc.createdAt` (quando entrou no Firestore) + `doc.validity.endDate`. Errado. O que ele queria era `doc.validity.startDate` + `doc.validity.endDate` (ambos definidos pelo curador, semântica COMERCIAL, não técnica).

**Princípio**: campos que parecem similares mas pertencem a domínios diferentes (sistema vs comercial vs operacional) precisam ser tratados como entidades distintas:

| Domínio | Campo | Significado |
|---|---|---|
| Sistema | `createdAt` | Quando o doc foi criado no Firestore |
| Sistema | `updatedAt` | Última edição técnica |
| Comercial | `validity.startDate` | Quando o pacote começa a ser válido pra venda |
| Comercial | `validity.endDate` | Quando o pacote vence |
| Operacional | `travel.startDate` | Data real da viagem do cliente |

**Antes de usar um campo "data"**: confirma o que ele significa lendo o schema OU perguntando. Confundir essas dimensões é confiscar trabalho do user.

### e) Empty state ≠ "página vazia OK" — botões de empty state precisam funcionar

**Sintoma**: empty state do Banco tinha "+ Novo roteiro" e "↑ Importar PDF". O importar levava o user pro mesmo lugar que criar (não tinha função). Renê pediu pra remover.

**Princípio**: empty state é a primeira impressão da feature. Cada botão tem que:
1. Ter ação clara e funcional
2. Não duplicar outro botão
3. Não levar pra fluxo inacabado

Quando um caminho ainda não tá implementado, ESCONDE o botão até estar pronto. Nunca deixa botão "stub".

### f) Reuso via adapter, não duplicação — `bankDocToRoteiroShape` (v4.50.3)

**Contexto**: gerar PDF do Banco com mesmo layout do Gerador (1500+ linhas em `generateRoteiroPDF`).

**Opção A (preguiçosa)**: copiar tudo, adaptar onde precisa.
**Opção B (correta)**: escrever `bankDocToRoteiroShape(bankDoc)` que retorna objeto no shape esperado por `generateRoteiroPDF`, e chamar a função existente.

```js
// js/services/roteiroBankGenerator.js
export function bankDocToRoteiroShape(bankDoc) { return { ...adaptado... }; }
export async function generateRoteiroBankPDF(bankDoc) {
  return generateRoteiroPDF(bankDocToRoteiroShape(bankDoc), null);
}
```

Resultado: 100% reuso visual, zero divergência futura. Adaptações semânticas explícitas no adapter (`categories[].hotels[]` → flatten em `hotels[]`, `includes.{buckets}` → flatten com tags, etc.).

**Princípio**: sempre que uma feature nova precisa do "mesmo visual" de uma existente, escreve adapter primeiro. Só duplica se realmente o pipeline divergir em >50%.

### g) Chrome MCP cache stubborn — não confiar 100% no que MCP mostra

**Observação recorrente**: depois de bump de versão + push, MCP Chrome insiste em servir o JS antigo mesmo com `?nuke=`, `caches.delete`, `serviceWorker.unregister`. User REAL pega versão nova ao recarregar normalmente.

**Procedimento E2E**:
1. Validar HTML em produção via `curl` (confirma versão no script tag)
2. Validar JS em produção via `curl` (confirma o fix está no arquivo servido)
3. Tentar MCP — se falhar com versão antiga, NÃO concluir que o fix está errado
4. Reportar honesto: "código publicado tem fix (confirmado via curl), MCP serveu cache antigo, o user real terá versão correta"

**Anti-padrão**: ficar bumping versões em loop tentando burlar cache MCP.

### h) Novos agentes IA precisam gravar em `ai_usage_logs`

Estabelecido em v4.50.1. Qualquer Cloud Function que faz chamada LLM (Anthropic/OpenAI/Gemini) precisa, após sucesso, gravar:

```js
await db.collection('ai_usage_logs').add({
  userId, agentId, agentName, module,                  // identificação
  provider, model,                                     // pra custo
  inputTokens, outputTokens,                           // base
  cacheCreationTokens, cacheReadTokens, tokensSaved,   // cache visibility
  cacheHit: cacheReadTokens > 0,
  webSearchCount,                                      // se aplicável
  timestamp: FieldValue.serverTimestamp(),
  expiresAt,                                           // TTL 90d
  source: 'cf-NomeDaFunction',                         // pra rastrear origem
  ...refs (queueId, bankDocId, etc.),
});
```

IA Hub (`aiHub.js`) tem abas Custos/Logs que filtram por `module` — basta gravar com o módulo certo e aparece auto, sem mudança de UI.

### i) PDF via Anthropic multimodal > pdf-parse server-side

Estabelecido em v4.50.0. Pra extração estrutural de PDFs (roteiros, briefings, faturas), enviar como `content block type='document'` pro Claude Sonnet 4.5 é melhor que pdf-parse:

- Custo: ~20k input + 7k output tokens por PDF (~$0.15)
- Qualidade: Claude lê layout nativo (incluindo tabelas, colunas, etc.)
- Zero deps server-side
- Prompt direto retorna JSON conforme schema esperado

**Não usar**: pdf-parse, pdfjs server-side (deps pesadas, layout perdido, regex frágil pra schemas estruturados).

### k) Listeners delegados em `container` SOBREVIVEM a `innerHTML=` — duplicam toast/save (v4.50.10)

**Sintoma Renê**: "aperto pra salvar e aparece dois banners de sucesso. aconteceu o mesmo na hora de gerar pdf".

**Causa**: padrão SPA do app reusa o mesmo `content` element entre navegações. Render é só `content.innerHTML = ...` + `container.addEventListener('click', ...)`. `innerHTML=` substitui CONTEÚDO (filhos), mas listeners no element pai PERMANECEM. 2ª visita ao mesmo módulo = 2 listeners idênticos = 2x toasts. 3ª = 3x. Etc.

**Fix obrigatório em toda page que usa delegação**:

```js
let state = { abortCtrl: null /*, ...*/ };

export async function renderXyz(container) {
  if (state.abortCtrl) state.abortCtrl.abort();   // mata listeners antigos
  state.abortCtrl = new AbortController();
  const signal = state.abortCtrl.signal;
  // ...
  container.addEventListener('click',  handler1, { signal });
  container.addEventListener('input',  handler2, { signal });
  container.addEventListener('change', handler3, { signal });
}

export function destroyXyz() {
  if (state.abortCtrl) { state.abortCtrl.abort(); state.abortCtrl = null; }
  // ... outros cleanups (timers)
}
```

**Auditar nos próximos sprints**: qualquer page que usa `container.addEventListener` (delegação) precisa de AbortController OU usar elemento criado a cada render (que não persiste). Lista parcial pra revisar: roteiros.js, portalTipsList.js, contentCalendar.js, devHours pages, etc.

**Princípio**: SPA reusing root container + addEventListener = bug latente de duplicação. AbortController é zero-overhead e idempotente.

### l) Toast `.info()` durante operação async + `.success()` no fim = "2 banners de sucesso" pro user

`toast.info('Gerando…')` aparece no canto da tela. Operação leva 5-30s. `toast.success('Feito!')` aparece em cima do .info (que ainda não desapareceu). User vê 2 toasts e interpreta como duplicação.

**Anti-padrão**:
```js
toast.info('Gerando PDF…');
const res = await heavyOp();
toast.success(`Pronto: ${res.filename}`);   // user vê dois banners empilhados
```

**Padrão melhor**: feedback inline no próprio botão (disable + spinner) durante operação, toast só no fim.

```js
btn.disabled = true; btn.innerHTML = '⋯';
try {
  const res = await heavyOp();
  toast.success(`Pronto: ${res.filename}`);
} finally {
  btn.disabled = false; btn.innerHTML = origHTML;
}
```

Se a operação for muito longa (>10s) e precisar de feedback global, usar `toast.info({ persistent: true, id: 'gerando' })` + `toast.dismiss('gerando')` antes do success.

### m) Singular `module` vs plural `modules` — verificar shape antes de escrever (v4.50.11+)

**Sintoma Renê**: "banco de roteiros está zerado... mas fizemos muitas coisas nele".

**Causa**: criei dev_hours entries com `module: 'banco-roteiros'` (singular string). O detector em `js/services/devHours.js` lê `entry.modules` (PLURAL array). Singular foi ignorado, heurística por título não pegou ("Hotfix Banco" sozinho não casa o regex `\bbanco[-_ ]?de[-_ ]?roteiros?\b` exigente). Aba "Foco em Produto" mostrou Banco zerado.

**Fix definitivo**:
1. Quando criar entry nova: SEMPRE `modules: ['x']` (plural array), não `module: 'x'`
2. Backfill retroativo via script (já rodado em `functions/backfill-modules-array.cjs`)
3. Helper sugerido pro futuro: `setEntryModule(doc, id)` que escreve nos 2 campos pra retrocompat

**Princípio mais geral**: quando um campo tem N forms (singular/plural, array/string, snake/camelCase), o reader DEVE aceitar TODAS as forms. E o writer DEVE escrever na FORMA CANÔNICA documentada. Inconsistência entre reader e writer = bug latente.

**Auditar**: qualquer campo "tipo" que aparece como string E array em lugares diferentes do código.

### n) Dois caminhos pra mesma operação criam side-effects esquecidos (v4.51.1)

**Sintoma Renê**: "quando chega solicitação não tem notificação no sistema".

**Bug**: `js/services/requests.js → createRequest()` dispara `notify('request.created')` pra admins. Mas o portal público (`js/portal/portal.js → handleSubmit()`) **NÃO usa o service** — chama `addDoc(collection(db, 'requests'), reqDoc)` direto, bypassando toda a lógica colateral.

**Princípio**: quando existem 2+ caminhos pra mesma operação CRUD (service + page direta, frontend + admin script, etc.), TODA lógica colateral (notif, audit, cache invalidation) precisa ou:
1. Estar centralizada no service (e os outros caminhos chamam o service) — **preferido**
2. Estar replicada em todos os caminhos com comentário cross-referenciando (`// MIRROR de createRequest() em services/requests.js linha X`)
3. Ser implementada via **Cloud Function `onDocumentCreated`** que roda independente de quem escreveu (mais robusto, à prova de novas pages)

**Auditar**: pra cada `addDoc/setDoc` em página front, ver se há service equivalente com side-effects. Se sim, ou redirecionar pro service ou replicar inline com comentário.

### o) Anti-double-submit DEVE checar flag no INÍCIO da função (v4.51.0)

**Sintoma Renê**: "Internet lenta + usuário ansioso = duas tarefas em cima de uma só solicitação".

**Bug clássico**: `button.disabled = true` setado DENTRO do handler. Em rede lenta, 2 clicks chegam em <100ms, ambos passam pela validação ANTES do disable, ambos chamam `addDoc`.

**Fix definitivo**: flag de módulo verificada no INÍCIO da função, liberada em `finally`:

```js
let _submitInFlight = false;
async function handleSubmit() {
  if (_submitInFlight) return;     // ✓ guard ANTES de qualquer await
  _submitInFlight = true;
  try {
    // ... operação async ...
  } finally {
    _submitInFlight = false;
  }
}
```

Não confiar APENAS em `button.disabled` — em event delegation ou múltiplos triggers do mesmo handler, o disable pode chegar tarde.

### p) Urgência (e flags one-way semelhantes) devem ser MONOTÔNICAS (v4.51.0)

**Sintoma Renê**: "edição de solicitação permite desmarcar a urgência. Não pode!"

**Princípio**: após uma solicitação ser marcada como urgente, o time foi notificado, replanejou agenda, possivelmente cancelou outras coisas. Permitir desmarcar depois = revisionismo histórico que confunde governança.

**Padrão pra qualquer flag one-way** (urgência, "publicado", "aprovado", "arquivado" reversível parcial):
1. **UI**: cursor:not-allowed + tooltip explicativo + info inline ao clicar
2. **Save**: defense-in-depth — `finalValue = wasTrueOriginally ? true : uiValue` (não confia só na UI)
3. **Documentação**: campo no schema tem comentário "MONOTÔNICO — só pode ir false→true"

### q) Service que lê estado global (store) quebra em entry-points alternativos (v4.51.3)

**Sintoma**: `notify()` em `services/notifications.js` lia `store.get('currentUser')?.uid` pra setar `actorId`. Funcionava no app principal. Mas quando o portal público (`js/portal/portal.js`, que NÃO usa o store do app — tem seu próprio `portalUser` global) chamou `notify()`, `actorId = undefined`. Firestore rule `actorId == request.auth.uid` rejeitou batch inteiro com `permission-denied`.

**Princípio**: services que precisam de dados de contexto (user atual, workspace, etc.) devem:
1. **Aceitar override via params** (`actorId`, `workspaceId`, etc.)
2. Cair pro lookup automático no store **só** quando params não vêm
3. **Abortar cedo** com mensagem clara se ambos falham (em vez de continuar e tomar permission-denied silencioso)

```js
async function notify(type, { actorId: actorIdOverride = null, ... } = {}) {
  const actorId = actorIdOverride || store.get('currentUser')?.uid;
  if (!actorId) {
    console.warn('[notify] sem actorId — rule vai bloquear');
    return;
  }
  // ...
}
```

**Auditar**: outros services que leem store implicitamente (`saveX()`, `audit()`, `addTaskActivity()`, etc.) podem ter o mesmo bug quando chamados de scripts/portais/CFs alternativas. Padrão: cada um aceita override do contexto.

### r) Filtros de "é admin" devem aceitar TODAS as formas (v4.51.2)

Sistemas crescem com aliases: `isMaster:true`, `roleId:'master'`, `roleId:'admin'`, `roleId:'head'`, `role:'master'`, etc. Filtros que checam só uma forma vazam users elegíveis.

**Padrão pra "é admin"**:
```js
const ADMIN_ROLES = ['master', 'admin', 'head'];
const isAdmin = u =>
     u.isMaster
  || ADMIN_ROLES.includes(u.roleId)
  || ADMIN_ROLES.includes(u.role);
```

Centralizar em helper `store.isAdminUser(u)` evita drift entre N callers. Esta lição é generalização de §12.m (singular vs plural fields).

### j) Em qualquer lista exposta no front-end, sempre prever CRUD

Estabelecido em v4.50.1. Categorias, coleções, tipos, status (que sejam editáveis) viram collection Firestore com defaults + CRUD via UI:

- Collection `roteiro_bank_categories`, `roteiro_bank_collections`, `portal_segments`, etc.
- Defaults em `const DEFAULT_X = [...]` no service (seed inicial)
- `fetchX()` lê collection; se vazia, retorna defaults
- UI tem modal "gerenciar X" com edit inline + add + delete (builtin lock 🔒)

**Princípio Renê**: "nao pode ser algo q vc cria e o padrao nao pode ser alterado no front end".
