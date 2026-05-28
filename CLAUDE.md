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

**⚠ ARMADILHA DE MÓDULO** — IDs de `modules[]` que entram na lista **Foco em Produto** são SOMENTE os definidos em `MODULES` (vide `js/services/devHours.js:87`):

| id | label oficial | é Foco em Produto |
|---|---|---|
| `roteiros` | Gerador de Roteiros | ✅ |
| `portal` | **Portal de DICAS** (NÃO Portal de Solicitações) | ✅ |
| `images` | Banco de Imagens | ✅ |
| `iahub` | IA Hub | ✅ |
| `banco-roteiros` | Banco de Roteiros | ✅ |

Qualquer outro id (`tasks`, `requests`, `notifications`, `csat`, `goals`, `team`, `dashboard`, `infra`, `cloud-functions`, etc.) **NÃO** aparece em Foco em Produto — fica no track "Geral".

**Erros que JÁ aconteceram (cuidar)**:
- ❌ Marcar entry do **Portal de Solicitações** (módulo `requests`) com `modules: ['requests', 'portal']` — o `portal` aqui é Portal de Dicas! Resultado: Portal de Dicas inflado com trabalho que não é dele. Cleanup retroativo aplicado em 2026-05-25 (32 entries de v4.54.0→v4.57.20).
- ✅ Correto: `module: 'requests'`, `modules: ['requests']` (sem `portal`).

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

> **Renê 25/05/2026** (após o N-ésimo bug encontrado em 2 cliques): *"vc nao esta testando todos os cenários de uso. ex: se eu dou esc em um modal de edicao no passo 2, ele não só fecha o modal como volta pro passo 1... perco muito tempo olhando essas coisas. agora vamos fazer assim: vc vai colocar no claude.md que vc sempre tem que trazer todos os possíveis cenários e comportamentos de uso para o modulo q esta mexendo no intuito de cobrir todas as possibilidades e ter certeza de que tudo funciona perfeitamente... boa parte do meu tempo aqui contigo é corrigindo bug... nao consigo avançar em desenvolvimento"*.

### Contrato obrigatório (não negociável)

**Antes de tocar em qualquer arquivo de um módulo**, escrever (mentalmente OU explicitamente em comentário/markdown rascunho) a **MATRIZ DE CENÁRIOS** do módulo. Cobertura mínima:

1. **Estados de dados**: vazio · 1 item · N itens · valor degenerado (0, null, string vazia, emoji, 10k chars)
2. **Estados de usuário**: novo · com rascunho · admin · membro · sem permissão · deslogado
3. **Estados de UI**: primeira render · re-render · após cancelar · após erro · após auto-save · em loading
4. **Interações de teclado**: Tab · Enter · Esc · Cmd/Ctrl+S · Cmd+Z (se aplicável)
5. **Overlays empilhados**: modal sobre modal · popup sobre overlay · Esc em cada camada
6. **Navegação**: voltar (Back) · refresh (F5) · trocar tab/módulo no meio · fechar e reabrir
7. **Edge de timing**: clique duplo rápido · submit durante save · network lento (>5s)
8. **Persistência**: o que grava no Firestore? · o que fica só no state? · auto-save passa por aqui?
9. **Reversibilidade**: tudo o que adiciona, tem caminho pra remover? estado fica coerente?
10. **Acessibilidade**: foco vai onde? leitor de tela anuncia mudança?

### O bug ESC do v4.57.18 — exemplo canônico

Caso real onde eu falhei: implementei `_openCalendarFullscreen` (v4.57.9) com Esc fechando. Adicionei `capture:true + stopPropagation` em v4.57.12. **Mas não testei**: Esc com **OUTRO modal aberto sobre o Step 2** (ex: `_openRequestPreview`). Esse modal fecha mas o `_keyHandler` global do wizard captura o Esc DEPOIS e dispara "voltar step". Renê encontrou em 2 cliques.

**Lição estrutural**: quando um módulo tem um listener global (keydown, click, etc.), ANTES de fazer push, listar TODOS os overlays/modais que aquele módulo abre. Pra cada um, testar a interação com o handler global. Se houver +1 overlay possível, o handler global PRECISA checar se algum overlay está aberto antes de agir (escape hatch).

### Pattern obrigatório pra handlers globais de teclado

```js
function _keyHandler(e) {
  // Guard: se há QUALQUER overlay/modal aberto, não interferir
  const overlayOpen = document.querySelector(
    '#pw-cal-fs-overlay, #pw-preview-modal, [role="dialog"][open], .modal.open, [data-overlay-open="1"]'
  );
  if (overlayOpen) return;  // overlay tem precedência — ele cuida do Esc
  // ... lógica do handler ...
}
```

### Quando chego pra fazer um sprint, primeiro digo:

> "Cenários que vou testar nesse módulo: A, B, C, D, E, F. Vou rodar E2E nos críticos antes de declarar pronto."

Renê pode então adicionar/remover cenários ANTES de eu codar. Isso evita o ciclo "entrego → ele acha bug → eu volto → repita 3×".

### Como testar SEM o Renê

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

### s) Status novo = SINGLE SOURCE OF TRUTH + propagação em N lugares (v4.53.1)

**Sintoma Renê**: "faça double check em tudo, pq bugs e melhorias em tarefas tem muitas camadas... precisamos cobrir todos os cenários pra evitar que o usuario trave".

**Bug latente após v4.53.0** (que introduziu status `validation`): adicionei a `STATUSES` em `js/services/tasks.js` + `DEFAULT_TRANSITIONS` em `workflowEngine.js`, mas tarefas no novo status ficariam **invisíveis em N camadas** porque cada componente tem o seu próprio map/array hardcoded com a lista anterior de status. Auditoria via Explore agent encontrou **11 pontos**:

1. **Queries Firestore `where('status','in', [...])`** — `notificationScheduler.js`, `dailySummary.js`, `slaAlerts.js`. Se não inclui o status novo, query filtra fora silenciosamente.
2. **Maps `STATUS_COLOR/STATUS_ICONS/S/L`** — cada page que renderiza chip de status tem seu próprio map. Faltando key = render quebrado/vazio.
3. **Fallback `getValidTransitions`** — `taskModal.js` linha 50 tem fallback se workflow engine não carrega. Precisa replicar a lista.
4. **Charts/legendas de dashboard** — `dashboard.js` legenda + cores precisam novo status.
5. **System prompts de IA** — `ai.js DEFAULT_MODULE_HINTS` + `aiActions.js` tool schemas listam enums válidos. IA chama tool com status inválido = erro.
6. **Global search header** — `header.js STATUS_ICONS` renderiza chip de status em resultado.

**Princípio**: status (e qualquer enum semântico) tem **uma única fonte canônica** (`STATUSES` em `services/tasks.js`). MAS o JS vanilla não importa esse array em todos os lugares — cada componente duplica por simplicidade/performance. Quando estende STATUSES, **auditoria obrigatória cross-app**:

```bash
# scripts pra rodar antes de declarar status novo "pronto"
grep -rn "where.*status.*in.*\[" js/services js/pages              # queries Firestore
grep -rn "STATUS_COLOR\|STATUS_ICON\|statusIcons\|statusColors" js  # maps de render
grep -rn "getValidTransitions\|DEFAULT_TRANSITIONS" js              # fallback de workflow
grep -rn "not_started.*in_progress.*review" js                      # listas hardcoded
```

Cada hit precisa ser revisado. Se for muito grande, considerar refatorar pra importar STATUSES + map dinâmico (perf cost é negligível pra <20 items).

**Auto-correção futura**: criar helper `js/services/statusMaps.js` que exporta `STATUS_COLORS_MAP`, `STATUS_ICONS_MAP`, `STATUS_LABELS_MAP` gerados a partir de `STATUSES` — assim adicionar status novo só requer mexer no array canônico.

### t) Dynamic imports com querystring criam INSTÂNCIAS SEPARADAS (v4.54.2→v4.55.1)

**Sintoma Renê**: "popup 'Sim newsletter' não preenche o wizard" (mesmo após fix da função `prefillWizardData`).

**Bug**: `portal.js` fazia 2 `import('./portalWizard.js')` com querystrings diferentes (`?v=4.54.1` no `renderForm` + `?v=4.54.2` no `prefillNewsletter`). ES modules cacheiam por **URL exata** (com qs). Querystrings diferentes = **2 instâncias separadas** do módulo, cada uma com seu próprio `_state`. A função `prefillWizardData` rodava na instância nova (`_state=null`), early-returnava silenciosamente, enquanto o wizard rodando continuava com `_state` válido na primeira instância.

**Tentativa errada (v4.54.3)**: remover querystrings dos dynamic imports → resolve instância dupla, MAS perde cache-bust pelo GH Pages (max-age=600 = 10min de stale).

**Solução correta (v4.55.1)**: `const WIZARD_VERSION = '4.55.x'` no topo do arquivo + usar a **mesma string** em todos os imports:

```js
const WIZARD_VERSION = '4.55.x';
// nos 2+ lugares:
import(`./portalWizard.js?v=${WIZARD_VERSION}`)
```

Mesma URL = mesma instância (sem bug v4.54.2). Mudou a const = cache-bust junto. Pattern aplicável pra qualquer dynamic import com versão.

**Princípio**: dynamic imports com versão devem ser CONSISTENTES dentro do mesmo arquivo. Centralize via constante OU omita querystring (e aceite cache stale por TTL).

### u) Auditoria por Agent em background enquanto fixa bugs visuais (v4.55.7+v4.55.8)

**Cenário**: Renê reportou 3 bugs visuais + demandou 100% paridade vs portalLegacy + auditoria de testes. Sozinho seria 1 atrás do outro (bug → 100% → testes).

**Padrão usado**: spawnei Agent (`general-purpose`) com prompt detalhado pra **auditar exaustivamente portalLegacy.js (3588 linhas) vs portalWizard.js (1446 linhas)** em background, enquanto eu corrigia os 3 bugs visuais reportados sequencialmente. Agent rodou ~5 min e retornou:
- Inventário completo de features
- Matriz gap com severidade (45 itens mapeados)
- Estimativa LOC por item
- Plano de testes E2E (160 cenários)

Resultado: paralelizou planning (Agent) com execução de hotfixes (eu). Quando Agent terminou, eu já tinha v4.55.7 entregue + roadmap pronto pra atacar críticos (v4.55.8: autoCreateTask + notifyAdmins + syncTask).

**Quando aplicar**:
- Refactor grande com paridade obrigatória (audit de gap fica em background)
- Reescrita de módulo (mapeia features do original em paralelo)
- Code review de PR longa (Agent revisa enquanto você responde comments óbvios)

**Cuidados**:
- Briefar agent com contexto completo (não tem memória da conversa)
- Pedir output em formato estruturado (matriz, lista numerada) — mais fácil de consumir
- Limitar tamanho do report (até 3000 palavras) — sub-agent transcrito vai pro context

### v) Wizard pattern: auto-save + AbortController + atalhos + skip auto + WIZARD_VERSION (v4.54.0+)

Pattern estabelecido em `js/portal/portalWizard.js` pra refactor de form único pra wizard multi-step. Reusável em qualquer página com fluxo linear.

**Componentes**:
1. **State module-scoped** (`let _state = null`) com `{ step, data, db, taskTypes, user, draftKey, submitting, ... }`. Pode crescer com `batchQueue`, `editMode`, `recentRequests`, `calDate`, `calGran`.
2. **`_renderShell(container)`**: monta layout estável (header progress + content placeholder + footer fixo).
3. **`_renderStep(n)`**: substitui `innerHTML` do content + re-wire events do step. Chamado em mudança de step OU em re-render forçado por mudança visual (ex: lock urgência).
4. **`_renderFooter()`**: re-renderiza botões conforme step (Voltar / Próximo / Enviar / +Lote / Salvar e sair). Labels dinâmicos refletindo estado.
5. **`_renderProgress()`**: dots numerados (✓ feito · ● ativo · ○ pendente) + pills contextuais (ex: "Lote pendente: N") em todos os steps.
6. **Auto-save em localStorage** por user (`portal-wizard-draft.${uid}`, expira em 7d). Chama `_persistDraft()` em cada mudança. `_loadDraft()` restaura no boot.
7. **Validação por step** (`_validateStepN`) com optional chaining em `getElementById` (defensivo — `_validateStep4` pode chamar `_validateStep1` quando DOM do Step 1 não existe mais). Bloqueia `_tryAdvance` se inválido.
8. **Atalhos Enter/Esc** via `_bindKeyboard` (Enter avança, Esc volta). Listener no `document` removido em `destroyXxx`.
9. **Skip auto**: se setor tem 1 tipo OU tipo tem 1 variação, pre-seleciona automaticamente e pode pular pro próximo step.
10. **`WIZARD_VERSION` const** no portal.js pra cache-bust + mesma instância (ver §12.t).

**Errors comuns**:
- Esquecer de criar `_validateStepN` referenciado em array de validators → `ReferenceError` silencioso (v4.54.1).
- Usar querystring inconsistente nos dynamic imports → instâncias separadas (§12.t).
- Não centralizar serialização do doc Firestore → batch + single divergem; usar helper `_buildRequestDoc(data, user)` reusado nos 2 caminhos.
- Edit history sem `requesterEditFlag` no doc Firestore → sistema principal não mostra banner pro assignee. SEMPRE incluir `{requesterEditFlag:true, requesterEditedAt:serverTimestamp()}` em updateDoc de edit mode (e fazer sync da task linked com `withRetry` se request tem `taskId`).

### w) Pages standalone (solicitar.html, login, etc.) NÃO herdam CSS do app (v4.57.6)

**Sintoma Renê**: "os botões seguem fora do padrão de design do sistema. o botão 'hoje' no calendário está na mesma situação" — repetido 3 vezes em sprints distintos (v4.55.7, v4.57.3, v4.57.5). Cada tentativa eu trocava `style="background:linear-gradient..."` → `class="btn btn-secondary btn-sm"`, mas continuava feio.

**Causa raiz** (descoberta v4.57.6): `solicitar.html` carrega APENAS `<link rel="stylesheet" href="css/portal.css">`. As classes `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-sm` vivem em `css/components.css`, que o portal NÃO importa. Resultado: todos os `<button class="btn ...">` renderizavam como botão **default do browser** (cinza outset, fonte 400, 0 padding) — visualmente idênticos a `<button>` sem classe nenhuma.

Sintoma falso-positivo: trocar `style="..."` por `class="btn"` parecia "padronizar", mas era trocar "botão custom feio" por "botão browser feio". Ambos errados visualmente.

**Fix definitivo**:
1. **Portal.css ganha definição PRÓPRIA de `.btn` + variantes**, usando SÓ tokens do portal (`--brand-gold`, `--text-secondary`, `--border-subtle`, `--bg-surface`). Não importa `components.css` (risco de cascata + colisão com `--text-inverse`, dark mode próprio, etc.).
2. Estilo SE INSPIRA no sistema principal mas reproduz com tokens do portal: `.btn-primary` = gold filled (igual `.portal-submit`), `.btn-secondary` = transparent + border-subtle (igual `.portal-submit-alt`).
3. `.btn-segment` pra segmented control (granularity month/week/day).
4. Refator dos botões inline (calendar prev/next/Hoje + granularity) pra usar `.btn .btn-icon .btn-sm` + `.btn-segment` — antes usavam `var(--border-default)` que nem existia no portal.
5. **Aliases defensivos** em `:root` do portal.css: `--border-default`, `--border-accent`, `--bg-hover` pra evitar `var(undefined)` em outros inline styles legados.

**Princípio mestre — quem audita pages standalone**:
- ✅ Antes de usar `class="btn ..."` em qualquer página fora do app principal (`index.html`), CONFIRMAR via `grep "^.btn" css/<page>.css` que a classe existe ali.
- ✅ Se não existe: ou define `.btn` no CSS standalone OU usa o helper inline próprio da página (`.portal-submit`, `.login-btn`, etc.).
- ✅ Ao **adicionar página standalone** (auth.html, public-view.html, etc.), DOCUMENTAR no topo do CSS: `/* CSS isolado — não herda app. Reusable classes definidas aqui: .btn, .form-input, ... */`.

**Anti-padrão a evitar futuramente**: copiar `class="btn btn-primary"` de uma page do app pra uma standalone "porque parece o padrão" — sem auditoria de CSS herdado. Visualmente parece OK no review do código, mas no browser é botão default.

**Pages standalone identificadas no projeto (a auditar individualmente se cresceram com `.btn`)**:
- `solicitar.html` (portal de solicitações) — ✅ corrigido v4.57.6
- `roteiro-view.html` (visualizador público de roteiro) — auditar
- `landing-*.html` (se houver) — auditar
- (Login não é standalone — é parte do `index.html`)

### j) Em qualquer lista exposta no front-end, sempre prever CRUD

Estabelecido em v4.50.1. Categorias, coleções, tipos, status (que sejam editáveis) viram collection Firestore com defaults + CRUD via UI:

- Collection `roteiro_bank_categories`, `roteiro_bank_collections`, `portal_segments`, etc.
- Defaults em `const DEFAULT_X = [...]` no service (seed inicial)
- `fetchX()` lê collection; se vazia, retorna defaults
- UI tem modal "gerenciar X" com edit inline + add + delete (builtin lock 🔒)

**Princípio Renê**: "nao pode ser algo q vc cria e o padrao nao pode ser alterado no front end".

---

## 13. Aprendizados sprint maratona v4.57.28→52 (26/05/2026)

Padrões consolidados em 25 releases consecutivas cobrindo Tarefas + Roteiros + Portal de Dicas + Banco de Imagens. Aplicar de cabeça nas próximas auditorias de módulo.

### a) Padrão consolidado de FK cleanup cross-collection

Toda operação `deleteXxx` precisa zerar refs em coleções dependentes — senão filtros quebram silenciosamente. Pattern obrigatório:

```js
export async function deleteXxx(id) {
  // ... permission check + delete principal ...
  await deleteDoc(doc(db, 'xxx', id));

  // Cleanup FK em N coleções dependentes:
  try {
    const snap = await getDocs(query(
      collection(db, 'collection_dependente'),
      where('xxxId', '==', id),
      limit(500),  // batch cap
    ));
    if (!snap.empty) {
      const batch = writeBatch(db);
      snap.forEach(d => {
        batch.update(d.ref, {
          xxxId: null,                          // zera FK
          xxxDeleted: true,                     // flag pra UI
          xxxDeletedAt: serverTimestamp(),      // timestamp
          xxxDeletedLabel: existing?.title,     // preserva metadata útil
        });
      });
      await batch.commit();
    }
  } catch (e) {
    console.warn('[deleteXxx] cleanup collection_dependente falhou:', e?.message);
  }
}
```

**Variações por shape de FK**:
- `where(fk == id)`: simples (a maioria)
- `array-contains id`: `arrayRemove(id)` + flag (workspaces v4.57.30)
- Array de objetos `[{fkId, ...}]`: read-modify-write + filter (goals.metaLinks v4.57.31, roteiros.embeddedTips v4.57.39)
- Aninhado em N níveis (`segments[].items[].image.imageId`): scan + read-modify-write profundo (portal_images deleteImageMeta v4.57.39)

**Catálogo dos 12+ caminhos implementados** (referência rápida):
- `tasks`: requests, content_calendar, projects, workspaces, task_types, goals, csat_surveys, roteiros, attachments Storage
- `requests`: tasks (reverse)
- `portal`: deleteArea→destinations, deleteDestination→tips+images, deleteTip→roteiros.embeddedTips, deleteImageMeta→tips+destinations
- `roteiros`: tasks, ai_usage_logs, roteiro_generations

### b) Padrão CF agendada com pseudo-user 'system'

Work agendado/scheduled que dependia de "qualquer user logado abrir o app" é bug latente — atribui actorId errado e não roda quando ninguém abre o sistema.

**Pattern**: mover pra Cloud Function `onSchedule` (`firebase-functions/v2/scheduler`) com **pseudo-user `users/system`** (criado em v4.57.33: `id='system', name='Sistema PRIMETOUR', isSystem=true, active=false`).

```js
export const xxxCron = onSchedule({
  schedule: '0 7 * * *',           // 7h BRT diário
  timeZone: 'America/Sao_Paulo',
  timeoutSeconds: 540,
  memory: '256MiB',
  retryCount: 1,
}, async () => {
  // ... lógica ...
  await db.collection('notifications').add({
    actorId:     'system',          // pseudo-user
    actorName:   'Sistema PRIMETOUR',
    recipientId: uid,
    type:        'xxx.notification_type',
    // ...
  });
  await db.collection('audit_logs').add({
    action: 'system.xxx_cron',
    severity: stats.errors > 0 ? 'warning' : 'info',
    ...stats,
    timestamp: FieldValue.serverTimestamp(),
  });
});
```

**Renderers já tratam `actorId === 'system'`** (notificationPanel.js:250) — fallback pra `actorName` do doc, sem precisar buscar no store. Rule Firestore permite porque Admin SDK bypassa.

**8 CFs scheduled novas nesta sessão**: recurringTasksDailyCron, scheduledNotificationsCron, roteiroBankValidityCron, onPortalTipUpdated (reactive), portalImagesOrphanCleanupCron, portalTipsStaleCheckCron, processRoteiroQueue (já existia, recebeu generation_complete), deleteR2.

### c) Padrão conflict detection multi-aba/multi-user

Editor com auto-save + multi-user = last-write-wins silencioso = perda de edits. Pattern:

```js
// Editor (boot do load):
currentDoc._loadedAt = doc.updatedAt?.toMillis?.() ?? Date.now();

// handleSave:
const result = await saveXxx(id, sanitized, {
  expectedUpdatedAt: currentDoc._loadedAt,  // passa pro service
});
currentDoc._loadedAt = Date.now();  // atualiza pós save OK

// Service:
export async function saveXxx(id, data, opts = {}) {
  if (id) {
    const existing = await fetchXxx(id);
    if (opts.expectedUpdatedAt && existing?.updatedAt?.toMillis) {
      const serverMs = existing.updatedAt.toMillis();
      const expectedMs = opts.expectedUpdatedAt;
      if (expectedMs && serverMs > expectedMs + 1000) {  // tolerância 1s
        const err = new Error('Doc modificado por outro user. Recarregue.');
        err.code = 'CONFLICT';
        throw err;
      }
    }
  }
  await updateDoc(/*...*/);
}

// handleSave catch:
catch (e) {
  if (e?.code === 'CONFLICT') {
    if (silent) {/* auto-save: pausa retries */}
    else {
      const reload = await modal.confirm({
        title: 'Documento modificado',
        message: 'Outro usuário salvou. Recarregar (descarta) / Cancelar?',
        confirmText: 'Recarregar', danger: true,
      });
      if (reload) location.reload();
    }
    throw e;
  }
}
```

**Implementado em**: roteiros (R5 v4.57.36), portal_tips (PD5 v4.57.40).

### d) Padrão anti-double-submit (race condition)

Click duplo rápido em botão de operação async = 2 chamadas paralelas = duplicação. Pattern:

**Por escopo único** (export de 1 doc, import lock):
```js
let _xInFlight = false;
async function doX() {
  if (_xInFlight) { toast.info('Em andamento — aguarde.'); return; }
  _xInFlight = true;
  try { /* operação */ }
  finally { _xInFlight = false; }
}
```

**Por escopo composto** (export PDF/DOCX/PPTX por doc — permite formatos diferentes paralelos):
```js
const _genInFlight = new Map();  // key=`${docId}::${format}`
async function generate(doc, format) {
  const key = `${doc.id}::${format}`;
  const started = _genInFlight.get(key);
  if (started && (Date.now() - started) < 30_000) {
    throw new Error(`Já existe exportação ${format} em andamento. Aguarde.`);
  }
  _genInFlight.set(key, Date.now());
  try { /* generate */ } finally { _genInFlight.delete(key); }
}
```

**Server-side distributed lock** (CF que retry-prone pelo client):
```js
const lockRef = db.collection('xxx_locks').doc(`x_${fingerprint}`);
await db.runTransaction(async tx => {
  const snap = await tx.get(lockRef);
  if (snap.exists && Date.now() - (snap.data()?.lockedAt?.toMillis?.() || 0) < TTL_MS) {
    throw new HttpsError('already-exists', 'Operação em andamento. Aguarde.');
  }
  tx.set(lockRef, { lockedAt: FieldValue.serverTimestamp(), lockedBy: uid });
});
// ... operação ...
await lockRef.delete();  // libera no final (best-effort, TTL cobre falhas)
```

### e) Padrão errorCode + isRetryable em CFs

CF que pode falhar por N motivos (rate limit transient vs token exhaustion permanente) deve classificar erro pro UI mostrar ação certa ("Tentar de novo" vs "Editar prompt").

```js
catch (err) {
  const errMsg = String(err?.message || err);
  let errorCode = 'unknown';
  let isRetryable = false;
  if (/rate.?limit|429|too many requests/i.test(errMsg)) { errorCode = 'rate_limit'; isRetryable = true; }
  else if (/max.?tokens|token.?limit|context length/i.test(errMsg)) { errorCode = 'token_limit'; isRetryable = false; }
  else if (/timeout|deadline.?exceeded/i.test(errMsg)) { errorCode = 'timeout'; isRetryable = true; }
  else if (/network|fetch failed|ECONN/i.test(errMsg)) { errorCode = 'network'; isRetryable = true; }
  // ... outros ...
  await docRef.update({ status: 'failed', error: errMsg.slice(0,1000), errorCode, isRetryable });
}
```

**Implementado em**: processRoteiroQueue (R3 v4.57.38), portalPdfParser (PD17 v4.57.43).

### f) ⚠ ARMADILHA: `roles.{role}.permissions` é OBJETO `{key:bool}`, NÃO Array

**Descoberto em validação E2E v4.57.49→51** (R2 token security). Cloud Function check de permissão fazia:
```js
const perms = r.data()?.permissions || [];
canDelete = perms.includes('portal_manage');   // ❌ permissions é objeto, includes não existe
```
Master sempre falhava com `permission-denied`.

**Padrão correto**:
```js
const u = await db.collection('users').doc(uid).get();
const ud = u.data();
const role = ud?.role || ud?.roleId;
if (ud?.isMaster === true || role === 'master') {
  canDo = true;
} else if (role) {
  const r = await db.collection('roles').doc(role).get();
  if (r.exists) {
    const rd = r.data();
    const perms = rd?.permissions || {};
    canDo = perms.portal_manage === true
         || perms.portal_images_manage === true
         || rd?.isSystem === true;
  }
}
```

**Shape verificado em produção**:
- `users.{uid}.role = 'master'` (string), pode estar SEM flag `isMaster` boolean
- `roles.{role}.permissions = { perm_key: true, ... }` (objeto, não array)
- `roles.{role}.isSystem = true` marca roles de sistema (master, admin)

**Auditar próximas CFs** com mesmo padrão: `grep "perms.includes\|permissions.includes" functions/index.js`. Já há 1 latente em `portalTipsStaleCheckCron` linha 4747 (afeta filtragem de notif, baixa severidade).

### g) ⚠ ARMADILHA: `getFunctions()` SEM app explícito

**Descoberto em validação E2E v4.57.49→50**. `js/firebase.js` inicializa apps NOMEADOS:
```js
const app = initializeApp(firebaseConfig, 'primetour-main');           // não default
const secondaryApp = initializeApp(firebaseConfig, 'primetour-secondary');
```

`getFunctions()` sem argumento busca `[DEFAULT]` app — que NÃO EXISTE. Erro:
```
No Firebase App '[DEFAULT]' has been created - call initializeApp() first
```

**Padrão correto**:
```js
const { app } = await import('../firebase.js');
const fn = httpsCallable(getFunctions(app, 'us-central1'), 'nomeDaCF');
```

**Callsites latentes** (não auditados em escopo do hotfix v4.57.50): `getSharePointToken` em `agents.js:1224`, possivelmente outros. Auditar com `grep "getFunctions()" js/`.

### h) ⚠ ARMADILHA: Sandbox macOS bloqueia subprocess em ~/Downloads (TCC)

**Descoberto na sessão v4.57.45**. Bash subprocess (node, git, firebase) recebe `EPERM` ao ler cwd quando projeto está em `~/Downloads` no macOS Sequoia+ sem Full Disk Access.

**Sintoma**: `fatal: Unable to read current working directory: Operation not permitted` — Read/Write/Edit tools funcionam (sandbox diferente), mas commit/deploy quebra.

**Resolução**:
1. System Settings → Privacy & Security → Full Disk Access → adicionar Terminal + Claude (rápido)
2. Mover projeto pra `~/dev/` ou `~/Documents/` (long-term)

### i) Banco de Imagens é REPOSITÓRIO, não cache

**Decisão Renê 2026-05-25** (após audit Banco de Imagens): "a ideia do banco é ter os arquivos independente da quantidade de uso".

- ❌ Auto-delete imagens órfãs após 30d (foi feito em v4.57.42, **revertido em v4.57.44**)
- ✅ Apenas SINALIZAR via flag `unused:true` + badge UI azul "Não usada"
- ✅ Hard-delete é exclusivamente manual via botão Excluir no card

Princípio mais geral: bibliotecas/repositórios são imutáveis por design — só user decide deletar. CFs apenas detectam e sinalizam, nunca destroem.

### j) Validação E2E via Chrome MCP > deploy + curl

Releases passam syntax check + deploy + curl validation, mas só E2E real via Chrome MCP pega:
- Bugs de runtime no contexto autenticado (ex: shape de `roles.permissions`)
- Cache stale do MCP que mascara fix novo
- Permissions/RLS rules que só falham com user real
- Cascade async (cascade filters race, etc.)

**Pattern** (espelho do v4.57.49 E2E):
1. Deploy + cache-bust + clear MCP service worker
2. Reload com `?nuke=N`
3. Validar `window.__PRIMETOUR_VERSION__` é a esperada
4. Executar operação real via UI ou direct JS no console
5. Verificar Firestore via Admin SDK script (não via UI cache)
6. Verificar logs CF: `firebase functions:log --only <fnName> --lines 5`
7. Verificar fingerprint público: curl direto pra confirmar token zerado, blob 404, etc.

**Antes de dizer "100% funcional"**: cobrir pelo menos 3 dos 7 steps acima. Sintoma de release não-testada: bug descoberto pelo user no mesmo dia.

---

## 14. Aprendizados sprint Geographic SSOT v4.59.x + Banco Envision (26/05/2026)

### a) SSOT geográfico híbrido — hardcoded + Firestore

**Decisão Renê 2026-05-26** (após import Envision deixar 5+ representações da mesma cidade): "não pode ter dados repetidos. não pode ser facil sobreescrever".

Arquitetura adotada:

| Camada | Lugar | Mutabilidade |
|---|---|---|
| Continentes (7) | `js/data/continents.js` hardcoded | Imutável |
| Países (~196 ISO 3166-1) | `js/data/countries.js` hardcoded | Imutável + adições raras |
| Cidades | `portal_destinations` Firestore | Master controla |

Por que NÃO é tudo Firestore:
- Continentes/países mudam < 1×/década. Firestore = overhead sem ganho.
- Hardcoded = type-safe (helpers `countryCodeFromLabel(label) → 'AR'|null`), sem rede, cacheado.
- Cross-module consistency garantida em compile-time.

Por que cidades FICAM em Firestore:
- Cidades novas chegam **toda hora** via import Envision.
- Curador precisa CRUD (adicionar/editar/aprovar).
- Cidade tem metadata rica (heroImage, areaId, descrição) que muda.

**Pattern reusável**: pra qualquer enum semântico que tem cardinalidade <300 + mudança <1×/ano = hardcoded module. Cardinalidade alta + mudança frequente = Firestore.

### b) ISO codes como FK estável + labels canônicos pt-BR

**Por que ISO 3166-1 alpha-2 (`AR`, `BR`, `JP`):**
- Universal (Anthropic, OpenAI, Unsplash, Wikipedia, etc.)
- Estável (não muda com decisão política — `Türkiye` virou alias)
- Curto (FK pequeno em Firestore)
- Unambíguo ("Brasil" pt vs "Brazil" en vs "Brasilien" de → todos `BR`)

**Por que MANTER label pt-BR canônico:**
- UI exibe o label.
- Audit/logs ficam legíveis ("Argentina" > "AR").
- Backwards compat com queries antigas (`where('country', '==', 'Brasil')`) continua rodando enquanto migra readers.

**Pattern**: novo schema sempre tem PAR `{code: 'XX', pt: 'Nome', en: 'Name'}`. Reader prefere code; fallback pra label.

### c) Aliases-aware lookup (matching defensivo)

`countryCodeFromLabel('Tóquio')` → null (cidade, não país). Mas `countryCodeFromLabel('Japan')` → 'JP', `countryCodeFromLabel('Japão')` → 'JP', `countryCodeFromLabel('japao')` → 'JP', `countryCodeFromLabel('JP')` → 'JP'.

Construído com map lazy:
```js
const NAME_TO_CODE = (() => {
  const m = {};
  for (const c of COUNTRIES) {
    const add = label => {
      const key = label.toLowerCase().trim();
      m[key] = c.code;
      const noAccent = key.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (noAccent !== key) m[noAccent] = c.code;
    };
    add(c.pt); add(c.en);
    (c.aliases || []).forEach(add);
  }
  return m;
})();
```

**Lição**: sempre que SSOT é referenciado por label arbitrário (input user, terceiro), inclui aliases visíveis no schema do SSOT. Não força transformação no caller.

### d) Pseudo-continentes legados precisam mapa explícito

Sistema PRIMETOUR tinha CONTINENTS hardcoded com 11 entries (não geográficos puros): "Brasil", "Caribe", "América Central", "Oriente Médio". Quando introduz SSOT com 7 continentes UN M.49, precisa mapa:

```js
const LEGACY_CONTINENT_TO_CODE = {
  'brasil':            'SA',
  'caribe':            'NA',
  'américa central':   'NA',
  'oriente médio':     null,  // AMBÍGUO — usa country.continent
};
```

Cases ambíguos (Oriente Médio = Egito AF + Israel AS) → resolve via continente do país, não do legacy.

**Princípio mais geral**: ao introduzir SSOT, mapa de legacy é OBRIGATÓRIO. Skipping = dados órfãos que filtros perdem silenciosamente.

### e) Backfill cross-modules idempotente com dry-run + apply

Pattern reusável (v4.59.0 `functions/backfill-geo-codes.cjs`):

```js
const APPLY = process.argv.includes('--apply');
for (const docSnap of snap.docs) {
  if (docSnap.data().countryCode) { skipped++; continue; }  // idempotente
  const code = countryCodeFromLabel(docSnap.data().country);
  if (!code) { unresolved.push(docSnap.id); continue; }
  if (APPLY) batch.update(docSnap.ref, { countryCode: code });
  updated++;
}
console.log(APPLY ? '✓ APPLY done' : '✓ DRY-RUN. Run with --apply.');
```

**Lição**: dry-run + apply flag = SEMPRE em scripts de mass-mutation. Validar log "0 unresolved" ANTES de --apply. Idempotente = pode rodar 10× sem corromper.

### f) Schema extension não-destrutivo (campos NOVOS coexistem com legados)

Quando estende schema cross-module sem quebrar nenhum reader:

1. Adiciona campo NOVO (`countryCode`) — campos antigos (`country`) ficam intactos.
2. Reader prioriza novo se presente (`data.countryCode || countryCodeFromLabel(data.country)`).
3. Writer (saveDestination) preenche AUTOMATICAMENTE o novo a partir do legado.
4. Backfill bulk preenche docs existentes.
5. **Eventualmente** (deprecation cycle de 3-6m): readers migrados → remove legado num release MAJOR.

**Nunca**: deletar campo legado no MESMO release que introduz substituto. Sempre coexistem.

### g) Doc Envision sync no PRÓPRIO módulo + .md no repo

**Decisão Renê**: "como vamos atualizar esse banco via envision? (melhor documentar isso de alguma forma, no modulo, pra nao esquecermos)".

Padrão adotado:
- Botão `secondary` no header do módulo (canEdit): "Como atualizar via Envision".
- Click abre modal com:
  - Resumo dos 4 passos do procedimento
  - Comandos copy-paste
  - Link "Abrir guia no GitHub" → `docs/ENVISION-SYNC-GUIDE.md`
- `.md` no repo é o doc completo (troubleshooting, arquitetura, roadmap).

**Princípio mais geral**: workflow operacional que envolve N comandos manuais + decisões críticas (ex: re-sync banco, restore de backup, rotação de chave) DEVE ter:
1. Botão de hint no próprio módulo (descoberta).
2. Doc `.md` no repo (referência completa).
3. Comandos copy-paste prontos (não "veja na doc").
4. Frequência sugerida explícita.

**Anti-padrão**: doc só no Notion/Confluence ou tribal knowledge. Quem entra no time depois NÃO descobre o procedimento.

### h) Auditoria por subagente paralela enquanto faz fix manual

**Pattern usado v4.59.0**: spawnei agente em background pra auditar módulo Banco completo (gaps + melhorias) ENQUANTO eu fazia foundation files SSOT em foreground.

Agente entregou em ~5min:
- Inventário rápido
- 5 críticos + 8 médios + 8 polish + 10 risk técnico
- Cada item com arquivo:linha + severidade + fix sugerido

Permitiu próxima release (v4.59.1) entrar com fixes prontos sem perder tempo descobrindo. Quando ele terminou eu já tinha v4.59.0 deployado + plan dos próximos.

**Quando aplicar**:
- Início de sprint num módulo que vai receber refactor (audit em paralelo a planning).
- Code review de PR longa (audit em paralelo a comments óbvios).
- Pivot arquitetural (audit do current state em paralelo a desenho do future state).

**Cuidados**:
- Briefar agente com contexto completo (sem memória da conversa).
- Pedir output ESTRUTURADO (matriz, severidade explícita, paths absolutos).
- Limitar tamanho (1500-3000 palavras) — sub-agent transcrito vai pro context.
- Resultado vai pro chat — NÃO duplicar trabalho que ele já fez.

### i) Fluxo Envision SOAP-only (sem API REST pra roteiros)

**Descoberta v4.58**: Envision (TravelAgent) tem Trip API REST com 121 endpoints (api.travelagent.com.br + Swagger), mas NÃO cobre roteiros. Roteiros só via SOAP `.svc` com Forms Auth (cookie `.ASPXAUTH` HttpOnly).

Implicações:
- Servidor externo NÃO consegue chamar (cookie HttpOnly).
- Único caminho: browser autenticado + bulk fetch via DevTools script.
- Re-sync é **assistido**, não automático.
- Sem webhook/push possível.

**Pattern de integração legacy SOAP-only**:
1. Bulk fetch via DevTools no browser autenticado.
2. Salvar bundle como JSON em `docs/envision-samples/`.
3. Adapter pure-function converte pra schema PRIMETOUR.
4. Import script Admin SDK bypassa rules.
5. Cron CF (futuro) detectaria `Envision.UpdatedAt` mas precisaria credencial server-side dedicada (não temos).

**Anti-padrão evitado**: tentar replicar Forms Auth no Node.js (frágil, sessão expira, segredos no servidor).

### j) Comando de paralelização: TodoList + Async Agents + foreground work

Quando Renê manda múltiplas demandas + sai ("vai... mas testa tudo"), priorizar:
1. **Identifica** o que bloqueia o quê.
2. **Spawn em background** auditorias/research/refactors longos (Agent run_in_background).
3. **Foreground** trabalho com dependências sequenciais.
4. **Bumps incrementais** (v4.59.0, v4.59.1, ...) em vez de mega-release.
5. **Cada release com risco bem-delimitado** (foundation isolada → fixes → readers → UI).
6. **Validar via curl** quando MCP cache stubborn — não bloquear sprint inteira esperando MCP.

Resultado em ~1 sessão: 2 releases (v4.59.0 + v4.59.1), 1 auditoria completa, 1 doc operacional, 2 dev_hours entries, sem quebra cross-module.

### k) ⚠ ARMADILHA: drift uiKit vs caller — handler nunca dispara (escape silencioso)

**Descoberto v4.59.4** após Renê reportar: "pesquisa por palavra não funciona no banco de roteiros, filtro por status também não".

**Bug**:
- uiKit `renderFilterBar` gera: `<input type="text" id="uikit-search">` + `<button class="uikit-status-pill" data-filter-status="approved">`
- roteiroBank.js handlers procuravam: `input[name="search"], input[type="search"]` + `[data-status-value]`
- Nenhum dos seletores casava. Handler NUNCA disparava. Filtros visualmente presentes mas inertes.

**Por que escapou da auditoria do agente** (sprint v4.59.0): agente verificou que filtros EXISTEM, classes presentes, applyFilters tem lógica certa. Não testou COMPORTAMENTO ("digito X e a lista filtra?"). Confirmou estática (existência de DOM), não dinâmica (handler dispara).

**Lição structural**: drift entre componente reusável (uiKit) e caller é **silencioso quando handler simplesmente "não dispara"** (não joga erro). E2E de filtros precisa **validar comportamento ponta-a-ponta**:

1. ❌ "Input existe + classe correta" (estática)
2. ❌ "Handler está bound" (estática)
3. ✅ "Digito X → lista vai de N → M itens" (dinâmica)
4. ✅ "Clico pill 'Publicados' → conta no filtro batem com `where status==approved`" (dinâmica)

**Padrão correto** estabelecido em roteiros.js (sibling do banco):
```js
// Search via id customizado
search: { id: 'rt-search', value: searchTerm, placeholder: '...' }
container.addEventListener('input', e => {
  if (e.target.id === 'rt-search') { /* ... */ }
});

// Status pills via classe + dataset.filterStatus
container.addEventListener('click', e => {
  const pill = e.target.closest('.uikit-status-pill');
  if (pill) activeStatus = pill.dataset.filterStatus || '';
});
```

**Auditoria global preventiva**: `grep -rn "data-status-value\|name=\"search\"\]" js/pages/` confirma se mais alguma page tem o mesmo drift. v4.59.4 mostrou: só roteiroBank.js — outras pages usam o padrão correto.

**Princípio mestre**: quando um componente reusável muda atributos (ex: uiKit migrou `data-status-value` → `data-filter-status` em versão antiga), todos os callers DEVEM seguir. Falha = handler inerte. Solução de fundo: uiKit poderia exportar **constantes/selectors** que callers importam:
```js
export const SELECTORS = {
  STATUS_PILL: '.uikit-status-pill',
  STATUS_DATA: 'filterStatus',
};
```
Caller usa `SELECTORS.STATUS_PILL` — se uiKit mudar, callers atualizam automaticamente. **TODO**: refactor futuro do uiKit pra exportar contratos.

### l) ⚠ ARMADILHA: Mismatch de versão Firebase SDK em imports dinâmicos é SILENCIOSO

**Descoberto v4.61.4** após Renê "teste!" forçar E2E real. Eu tinha escrito `geoResolver.js` (novo file v4.59.0) importando:
```js
import { collection, ... } from 'https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js';
```

Mas TODO o resto do sistema usa `10.12.2` (em `firebase.js`, `portal.js`, `roteiroBank.js` e ~47 outros call sites). Resultado runtime:

```
FirebaseError: Expected first argument to collection() to be
a CollectionReference, a DocumentReference or FirebaseFirestore
```

O `db` foi inicializado pela versão 10.12.2 (em `firebase.js`). Quando passo pra `collection(db, ...)` do 10.13.2, ele não reconhece o tipo. **MAS** o `try/catch` do `ensureDestination` capturava esse erro e caía pro fallback (slugify simples sem aliases), criando duplicata silenciosa.

**Por que escapou de N camadas de validação**:
- `node --check`: ✓ passa (import URL é só string)
- `curl` pra confirmar deploy: ✓ código no ar
- E2E visual: ✓ UI principal funciona (não passa por geoResolver)
- E2E chamada direta: ✗ **só pegou aqui** (`ensureDestination` no console autenticado)

**Lição estrutural**:
1. **Sempre** verificar versão SDK em imports novos. `grep -rn "firebasejs/[0-9]" js/` confirma uniformidade.
2. **Try/catch em torno de chamadas Firebase** mascara version mismatch. Considerar logar `console.warn(JSON.stringify({err: e.code || e.name, msg: e.message?.slice(0,150)}))` antes de cair no fallback pra ter rastro.
3. **E2E real é mandatório** quando código novo tem caminhos não tocados pela UI principal (helper usado só por adapter/service). `node --check` + curl + UI visual NÃO cobrem.

**Pattern de prevenção**: adicionar `const FB_SDK = 'https://www.gstatic.com/firebasejs/10.12.2'` em um arquivo central tipo `js/firebase.js` exportado, e todos os imports dinâmicos usarem `import(FB_SDK + '/firebase-firestore.js')`. Mudança em 1 lugar propaga.

```js
// js/firebase.js (proposta v4.62+)
export const FB_SDK_BASE = 'https://www.gstatic.com/firebasejs/10.12.2';

// Em qualquer arquivo:
import { FB_SDK_BASE } from '../firebase.js';
const { collection, getDocs } = await import(`${FB_SDK_BASE}/firebase-firestore.js`);
```

Versão central, mismatch impossível.

---

## 15. Aprendizados sprint Editor cotações + GDS + notif safety-net (27/05/2026)

13 releases (v4.62.26 → v4.62.38) cobrindo parser GDS aéreo/hotel/pricing, refator Serviços, fix duplicação confirm, compartilhar tarefa via link, **auditoria completa de notificações com 2 CFs reativas safety-net**, editor segmentos custom Portal de Dicas.

### a) Diagnose-FIRST em auditoria de bug "feature não funciona"

**Caso real v4.62.37**: Renê reportou *"usuários estão sendo marcados como responsáveis ou observadores e não há notificação e banner"*. Tentação imediata: começar a refatorar `js/services/notifications.js`. **NÃO FAÇA**.

Padrão correto antes de qualquer linha de código:

1. **Investigar kill-switches globais primeiro** — em PRIMETOUR, `settings/global.notifyTaskAssigned` é flag boolean que mata TODAS as notifs de assignee se `false`. Custou 1 min rodar `db.collection('settings').doc('global').get()` via script Admin SDK pra eliminar essa hipótese. Se fosse essa, **fix em 5 segundos sem deploy** (só toggle UI).
2. **Só DEPOIS do diagnose**: delegar auditoria estrutural a Agent paralelo com prompt MUITO detalhado (cenários, gaps esperados, formato de output).
3. Scripts diagnósticos viram **patrimônio do repo**: `functions/check-global-notif-settings.cjs` mostra estado de TODAS as flags em <5s. Reusar em qualquer reclamação futura de "notif não chega".

**Princípio**: bug de feature que "deveria funcionar" tem 70% de probabilidade de ser configuração/state (toggle desligado, cache stale, role mal atribuída) e 30% de ser bug de código. Investigar config PRIMEIRO economiza horas.

### b) CF reativa onCreate/onUpdate como safety-net pro padrão §12.n option 3

**Princípio CLAUDE.md §12.n já existente**: quando existem 2+ caminhos pra mesma operação CRUD (service + page direta + admin script + bulk + portal externo), TODA lógica colateral (notif/audit/cache) precisa estar centralizada OU replicada com comentário cross-ref OU **implementada via Cloud Function reativa** (mais robusta).

**Implementação concreta v4.62.37**: 2 CFs novas — `onTaskCreated` + `onTaskUpdated` em `tasks/{taskId}` — que disparam notifs pra `assignees[]` e `observers[]` adicionados. **Idempotência via query**: antes de criar notif, verifica se já existe `(recipientId, entityType, entityId, type, createdAt > 5min atrás)` — se sim, skip. Permite caller UI continuar chamando `notify()` direto (mais rápido) sem dobrar notifs quando CF executar depois.

**Vantagens da CF reativa vs notify por caller**:
- ✅ Cobre **qualquer caller novo** que esqueça notify (portal, integrações, admin scripts, novos services)
- ✅ Admin SDK bypassa Firestore Rules — notif sai mesmo se rule rejeitaria o client
- ✅ Independe de prefs/kill-switch client-side (que demoram 5min de cache pra propagar)
- ✅ `actorId` derivado de `task.createdBy` ou `task.updatedBy` (cada doc deve gravar esse campo)

**Quando NÃO usar CF reativa**:
- Operação requer feedback síncrono (notif "chegou rápido pro ver na UI imediatamente")
- Lógica depende de contexto que só o client tem (URL atual, scroll position, etc.)
- Volume alto (>10k writes/min) onde latência da CF (1-3s) seria gargalo

**Custo**: ~$0.40/milhão de invocações na Cloud Functions Gen 2. Pra um sistema com 5-10 task writes/dia, **insignificante**.

### c) Parser tolerante de input livre precisa de blacklist + campo distintivo obrigatório

**Caso real v4.62.34**: `parsePNR` aceitava 2 letras + dígitos + 2 IATAs como voo válido. Linha `1- USD3874.00 USD2499.20 XT USD6373.20 ADT` virava "voo US 3874 USD→USD" porque cada uma dessas substrings passava o regex permissivo.

**Fix em 3 camadas defensivas** (ordem importa — early reject mais barato):

1. **Reject EARLY por pattern de não-voo**: linha com `USD\d+` (moeda colada em valor) ou `^[\d.\-\s]+[A-Z]{3}\d+` (pricing display) **nunca é PNR** — return null antes de qualquer parse.
2. **Blacklist de códigos não-IATA**: set com ~50 entries (moedas ISO 4217, paxTypes IATA, códigos de taxa comuns YQ/YR/BR/ZR/XT, commands GDS NCB/WPN/TOTAL). Tanto a "cia aérea" quanto as IATAs origem/destino são validadas contra ela.
3. **Campo distintivo OBRIGATÓRIO**: PNR real SEMPRE tem data `DDMMM`. Sem data = não é voo. Linha "1- USD3874" não tem data → rejeitada.
4. **Validação contra dicionário real**: se dict de aeroportos carregado (>100 entries), AMBAS as IATAs precisam existir nele. "USD" não está → rejeitado. (Tolerante se dict offline.)

**Princípio mais geral pra qualquer parser tolerante**: lista de "o que aceita" é frágil; lista de "o que rejeita explicitamente" + "campo que SEMPRE existe" é robusta. Quando o parser produz falso positivo, o fix raramente é tornar o regex mais restritivo (frágil em casos legítimos) — é adicionar guard de rejeição.

### d) 1 botão tolerante > N botões especializados em UX de import

**Caso real v4.62.28 → v4.62.29**: 2 botões separados (`✈ Codificar tarifa GDS` pra PNR voos + `💵 Codificar preços` pra pricing display). Renê: *"junte o codificar a tarifa e o preço em um único botão, pro usuário mandar o texto todo de uma vez e ter as informações... se ele mandar só a tarifa ou só o preço vc aceita também e entrega o que tiver disponível"*.

Resultado: **1 botão `✈ Codificar do GDS`** + modal único + textarea único. Roda os 2 parsers em paralelo on input. Preview dual — cada bloco renderiza só se o parser detectou algo:
- Só PNR → insere voos (preço em branco)
- Só pricing → mostra radios de aplicação
- Os dois → insere voos + radios incluem os recém-criados
- Nada → erro contextual

**Princípio UX**: quando user precisa decidir "qual ferramenta uso pra esse input?" antes de fazer, fricção alta. Quando UI auto-detecta o conteúdo, fricção zero. Vale pra: import de CSV (auto-detect delimiter/encoding), upload de imagem (auto-detect HEIC→JPEG), parse de texto livre (data ISO vs BR vs natural language), etc.

**Anti-padrão correlato**: ter 5 botões pequenos no header (Import CSV / Import XLS / Import JSON / Cole texto / Upload) é PIOR que 1 botão "Importar" que abre modal com auto-detect + opcional "outro formato" se falhar. v4.62.29 segue esse princípio.

### e) §11.k recidivismo em SPA — listener delegation SEMPRE vaza se sem AbortController

**Caso real v4.62.33**: Renê: *"quando tento deletar uma cotação, o banner de reconfirmação fica aparecendo 5-6×"*. Causa: `js/pages/roteiros.js → renderRoteiros(container)` registrava 5 `container.addEventListener(...)` sem AbortController. SPA reusa o mesmo container entre navegações — cada visita ao módulo acumulava +5 listeners. 6 visitas = 6 `confirm()` em cascata por delete.

**Já documentado em §11.k**: "AbortController é zero-overhead e idempotente". Mas RECIDIVISMO em SPA = bug latente em QUALQUER page que use delegação no container e seja reusada entre navegações.

**Padrão obrigatório pra qualquer page nova**:

```js
let _pageAbortCtrl = null; // module-scope, fora do export

export async function renderPageX(container) {
  if (_pageAbortCtrl) _pageAbortCtrl.abort();
  _pageAbortCtrl = new AbortController();
  const _sig = _pageAbortCtrl.signal;
  // ... resto da render ...
  container.addEventListener('click', handlerA, { signal: _sig });
  container.addEventListener('input', handlerB, { signal: _sig });
  container.addEventListener('change', handlerC, { signal: _sig });
}
```

**Sintoma escalado** que pode passar despercebido sem o user reclamar:
- Filtros: pill click → N re-renders (parece "lento" mas é N execuções)
- Busca: input → N renderTable em cascata
- Sort de coluna, paginação, mudança de status: cada um dispara múltiplas vezes
- Memory leak silencioso (handlers velhos seguem em memória, segurando refs)

**Auditoria pendente** (próxima sessão, low priority): `grep -rn "container.addEventListener" js/pages/ | grep -v AbortController` — revela todos os candidatos. Provavelmente 5-10 pages com esse bug latente. Aplicar fix de 3 linhas em cada uma é trivial. Bug só "aparece" se user navega ida-e-volta mais de 1 vez (testes manuais rápidos não pegam — testes E2E que simulam navegação real pegariam).

**Auto-correção arquitetural futura**: helper `setupPageContainer(container)` em `js/components/uiKit.js` que retorna `{ signal, destroy }` e padroniza o pattern. Pra impedir esquecimento, regra de PR: "qualquer addEventListener em container precisa de `{ signal }`" — pode virar lint rule.

---

## 16. Aprendizados sprint Templates upload v4.63.x + pós-auditoria (28/05/2026)

Sprint **Biblioteca de Templates** (v4.63.0 → v4.63.11) entregou pipeline ponta-a-ponta de upload de templates HTML/DOCX/PPTX por área. Pós-sprint, Agent retornou 30+ achados em 5 categorias (zumbis, security, perf, bugs, recomendações) — 3 releases de hotfix (v4.63.12 → v4.63.14) consolidaram correções. Padrões abaixo são reusáveis em qualquer feature similar.

### a) Pipeline de upload externo precisa de helper `_validateXxxFileUrl()` SEMPRE

**Caso real v4.63.13 (Security #5)**: CFs `extractPlaceholders`, `renderTemplate`, `duplicateTemplate` faziam `fetch(tpl.fileUrl)` server-side. Sem guard, admin malicioso (ou Firestore rule frouxa) podia editar `templates.{id}.fileUrl` pra `http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token` → CF leakaria token GCP via render PDF (SSRF).

Pattern obrigatório pra qualquer schema com `fileUrl` populado por upload externo:

```js
const STORAGE_ORIGIN = 'https://pub-XXX.r2.dev/';
function _validateStorageFileUrl(url) {
  if (typeof url !== 'string') return false;
  if (!url.startsWith(STORAGE_ORIGIN)) return false;
  // Bloquear path traversal + auth embebido
  if (url.includes('..') || url.includes('@')) return false;
  return true;
}
// Aplicar em TODA CF que faz fetch desse fileUrl
if (!_validateStorageFileUrl(doc.fileUrl)) {
  throw new HttpsError('failed-precondition', 'fileUrl inválido (não-allowlist).');
}
```

**Princípio**: dados schema-validáveis (URL, email, telefone, ISO date) devem ter helper centralizado em vez de regex inline em cada caller. Reader que recebe input externo (UI, importer, terceiro) precisa validar SEMPRE antes de usar.

### b) Puppeteer SSRF protection — `setRequestInterception(true)` + allowlist

**Caso real v4.63.13 (Security #2)**: HTML templates são arbitrários do uploader (com perm `templates_manage`). Sem intercepção, `<iframe src="http://internal-svc/secrets">` ou `<img src="http://169.254.169.254/.../token">` rodam dentro do CF e exfiltram via render PDF.

Pattern pra QUALQUER browser headless renderizando conteúdo de terceiro:

```js
const ALLOWED_FETCH_ORIGINS = [
  STORAGE_PUBLIC_ORIGIN,        // teu bucket R2/GCS público
  'https://fonts.googleapis.com',
  'https://fonts.gstatic.com',
];
await page.setRequestInterception(true);
page.on('request', req => {
  const url = req.url();
  if (url.startsWith('data:') || url.startsWith('about:')) {
    req.continue(); return;
  }
  const allowed = ALLOWED_FETCH_ORIGINS.some(o => url.startsWith(o + '/') || url === o);
  if (allowed) { req.continue(); return; }
  console.warn(`[SSRF block] ${req.resourceType()} ${url.slice(0,120)}`);
  req.abort('blockedbyresponse');
});
await page.setContent(htmlRendered, { waitUntil: 'networkidle0', timeout: 60_000 });
```

**Notas**:
- `data:` URIs sempre OK (inline images/fonts embedded base64)
- `about:` é Chromium internal — permitir
- `networkidle0` continua funcionando porque requests abortadas contam como concluídas
- Log warn ajuda forense (quem tentou o quê) sem dropar a render

**Princípio**: qualquer engine que executa código de N usuários diferentes (HTML, sandbox JS, formula spreadsheet) precisa de allowlist de fetches externos + audit log de bloqueios.

### c) Fallback graceful precisa AVISAR — não silenciar

**Caso real v4.63.12 (Bugs #7/#8/#9)**: generators tinham try/catch ao redor do template render. Se falhasse (template arquivado, ref deletada, erro de parsing), caía pro pipeline jsPDF/docx.js antigo silenciosamente. User configurava template, voltava semana depois e gerava PDF "errado" achando que estava com a marca aplicada. Renê: *"achei que minha marca tava aplicada, mas saiu o padrão"*.

Pattern obrigatório:

```js
try {
  const result = await renderViaCustomTemplate(...);
  return result;
} catch (e) {
  console.warn(`[generator] template falhou, fallback antigo:`, e?.message || e);
  // ✅ NOVO: avisa user + audit log
  try {
    toast.warning(`Template falhou (${e?.message?.slice(0,80) || 'erro'}). Gerando com padrão do sistema. Verifique no Editor.`);
  } catch {}
  try {
    const { logAction } = await import('../auth/audit.js');
    await logAction('templates.fallback', { module, format, templateId, areaId, reason: String(e?.message || e).slice(0, 200) });
  } catch {}
  // Pipeline antigo continua abaixo (fallback ainda graceful)
}
// ... pipeline antigo ...
```

**Princípio**: fallback é defesa em profundidade (mantém o sistema funcionando), MAS quando o caminho "feliz" do user falha, ele precisa saber. Audit log permite Renê/admin reconfigurar antes que vire reclamação. Toast warn é UX honesta.

### d) Orphan ref detection em UI de configuração

**Caso real v4.63.14 (Bug #8/#9)**: editor de áreas mostrava dropdown de templates com base em `fetchTemplates({ status: 'active' })`. Se `area.templateRefs[mod][fmt]` apontava pra template arquivado/deletado, o select sumia a referência silenciosamente. User configurava algo, voltava e a config "evaporava" sem aviso.

Pattern pra qualquer dropdown de ref que pode apontar pra item filtrado:

```js
// 1. Coleta refs configuradas que NÃO estão na lista filtrada
const refIds = [];
for (const modKey of Object.keys(currentRefs || {})) {
  for (const fmtKey of Object.keys(currentRefs[modKey] || {})) {
    const id = currentRefs[modKey][fmtKey];
    if (id && !activeItems.some(t => t.id === id)) refIds.push(id);
  }
}
// 2. Fetch individual pra mostrar reason
const orphanFetched = new Map();
await Promise.all(refIds.map(async id => {
  try { const t = await fetchSingle(id); if (t) orphanFetched.set(id, t); }
  catch {}
}));
// 3. No render do dropdown
const orphanTpl = orphanRef ? (allItems.find(t => t.id === currentVal) || orphanFetched.get(currentVal)) : null;
const orphanReason = orphanTpl
  ? (orphanTpl.status === 'archived' ? `Item "${orphanTpl.name}" está arquivado`
     : `Item "${orphanTpl.name}" mudou de owner ou formato`)
  : `Item ${currentVal.slice(0,12)}… não existe (excluído)`;
// 4. Render warning option + frase abaixo
<option value="X" selected style="color:var(--color-warning);">⚠ ${reason}</option>
<p style="color:var(--color-warning);font-size:0.7rem;">⚠ Geração vai cair pro padrão. Selecione novo ou — Usar padrão —.</p>
```

**Princípio**: dropdown que filtra (active only, perm-gated, role-scoped) precisa detectar refs já configuradas que ficaram fora do filtro. Evapora silencioso = bug latente que só user descobre meses depois.

### e) Progress indicator dinâmico via `toast.update(id, msg)` é obrigatório em ops >5s

**Caso real v4.63.14 (Perf #1)**: gerar PDF via template = ~10s (Puppeteer cold start + render + download). Antes: botão com spinner mudo. Renê não sabia se travou. CLAUDE.md §11.b já dizia "indicador dinâmico" mas estava sendo violado.

Pattern via novo `toast.update(id, message, title?)`:

```js
let _progressId = null;
try { _progressId = toast.info('Carregando template…', 'Gerando PDF', 90_000); } catch {}
try {
  const data = await loadStuff();
  try { if (_progressId) toast.update(_progressId, 'Renderizando (Puppeteer ~5-10s)…'); } catch {}
  const result = await renderViaCF(...);
  try { if (_progressId) toast.update(_progressId, 'Baixando arquivo…'); } catch {}
  downloadBlob(result.blob, result.filename);
  try { if (_progressId) toast.remove(_progressId); } catch {}
  return result;
} catch (e) {
  try { if (_progressId) toast.remove(_progressId); } catch {}
  // fallback warn + retry
}
```

**Regra**: TODA operação que demora >5s precisa de step-by-step. Toast persistent (`duration = 90_000ms`) + `toast.update` + `toast.remove` ao concluir é o padrão. Try/catch ao redor do update/remove evita que falha no toast quebre a operação.

### f) Drift entre PLACEHOLDERS_SPEC declarado e adapter implementado

**Caso real v4.63.x (Audit Bug #11)**: `PLACEHOLDERS_SPEC.portal[].key` listava `destinos.[i].tips` (singular = array de N tips), mas `portalToTemplateData` mapeava `[{tip,dest}]` 1:1 → cada par virava 1 entrada em destinos com `tips: [tip]` (1 tip por destino). 2 tips na mesma cidade = 2 destinos duplicados no template `{{#each destinos}}`. Adapter quebrava a semântica documentada.

Pattern de fix:

```js
// ❌ Bug: 1:1 mapping
destinos: (allTips || []).map(({ tip, dest }) => ({
  cidade: dest?.city, tips: tip ? [tip] : [],
}))

// ✅ Fix: agrupa por dest.id (ou fallback city_country)
const byDest = new Map();
(allTips || []).forEach(({ tip, dest }) => {
  if (!dest) return;
  const key = dest.id || `${dest.city || ''}__${dest.country || ''}`;
  if (!byDest.has(key)) byDest.set(key, { cidade: dest.city, tips: [], segments: {} });
  const entry = byDest.get(key);
  if (tip) {
    entry.tips.push(tip);
    Object.assign(entry.segments, tip.segments || {});
  }
});
destinos: Array.from(byDest.values())
```

**Princípio**: adapter SEMPRE deve respeitar a semântica do PLACEHOLDERS_SPEC. Quando estende SPEC (adicionar campo), refletir no adapter ANTES de marcar feature done. Sub-agent audit pega isso lendo os 2 arquivos cruzados — vale gastar 1 min.

### g) Auditoria pós-sprint via Agent paralelo entrega ROI consistente

**Pattern repetido com sucesso em 3 sprints** (Templates Áreas v4.62.39-44, Editor v4.62.16-22, Templates upload v4.63.0-11):

1. Após última release da sprint, spawnar Agent (`general-purpose`) com prompt detalhado:
   - Lista de arquivos novos + modificados
   - Pipeline construído (ASCII flow)
   - Pedido específico: zumbis (variáveis órfãs, comentários enganosos), race conditions, security holes, fallback UX, performance, edge cases
   - Output ESTRUTURADO (matriz com severidade HIGH/MEDIUM/LOW, paths absolutos, linha exata)
2. Enquanto Agent roda em background (~5 min), dev continua com outras tarefas (E2E, dev_hours, docs).
3. Agent retorna inventário acionável.
4. Triagem: HIGH viram v4.X+1 hotfix imediato, MEDIUM viram próximas releases (v4.X+2/+3), LOW backlog.

**ROI medido** (Sprint v4.63 pós-audit):
- 5 achados HIGH atacados em 3 releases (~5h dev total)
- 2 SECURITY HIGH fechados (SSRF Puppeteer + fileUrl)
- 3 UX HIGH corrigidos (toast warn fallback + progress indicator + orphan detection)
- 1 ZUMBI HIGH limpo (createNewVersion phantom)
- Custo: zero context burning (Agent roda paralelo)

**Critério pra usar Agent paralelo**:
- Sprint com 5+ releases
- Múltiplos arquivos novos (>3) + alterações cross-module
- Security surface nova (CF + uploads + render)
- Quando não fazer: hotfix isolado, refactor pontual, feature com 1 arquivo só.

### h) Re-audit imediato pega zumbis residuais (lição v4.62.50→51)

**Padrão**: depois de aplicar fixes do Agent, rodar **segunda auditoria** focada APENAS nos arquivos tocados pelo fix. Pega zumbis que o fix introduziu (ex: comentário desatualizado, alias remanescente, função morta que sobrou).

Caso v4.62.51: Sprint Templates Áreas Audit 1 entregou 8 zumbis. Apliquei fixes em v4.62.50 (rename canônico cotacoes). Audit 2 (após rename) achou +4 zumbis residuais nos arquivos tocados, virando v4.62.51 hotfix. Sem Audit 2, esses 4 ficariam latentes por meses.

**Quando aplicar**: refactor que toca nomes/aliases/schemas em N pontos. Custo: 1 prompt + ~3 min. Benefício: pega 100% dos drifts.

### i) ⚠ ARMADILHA: Bucket pub-r2.dev NÃO tem CORS — fetch cross-origin do browser falha (v4.63.23→24)

**Sintoma** (descoberto E2E v4.63.23): `portal-view-tpl.html` fazia `fetch(template.fileUrl)` (URL `https://pub-XXX.r2.dev/templates/.../web-default.html`). curl direto retornava 200 + HTML. Mas `fetch` em browser falhava com `TypeError: Failed to fetch` — bucket público R2 (dev URL) NÃO envia `Access-Control-Allow-Origin`, e Cloudflare R2 não permite configurar headers em dev URLs.

**Tentativa errada inicial**: tentar habilitar CORS no R2 (impossível em `pub-…r2.dev`). Tentativa secundária: usar worker `primetour-images.rene-castro.workers.dev` (tem CORS mas exige `X-Upload-Token`, não pode ir client).

**Fix definitivo (v4.63.24)**: nova CF `getTemplateHtml` (`onRequest`, `cors:true`, cache 5min CDN) atuando como proxy:
- GET `?tplId=XXX`
- Valida regex tplId (anti-injection)
- Busca `templates/{tplId}`, exige `status=active`
- Re-valida `fileUrl` com `_validateR2FileUrl` (anti-SSRF — mesmo helper §16.a)
- Fetch R2 server-side (sem barreira CORS)
- Retorna HTML com `Access-Control-Allow-Origin: *` + `Cache-Control: public, max-age=300, s-maxage=300`

**Princípio mestre — auditoria preventiva pra próximas integrações**: qualquer URL pública `pub-XXX.r2.dev`, `s3.amazonaws.com/...`, ou similar lida pelo browser via `fetch` precisa OU:
1. **CORS habilitado no bucket** (configurável em R2 custom domain / S3 bucket policy, NÃO em URLs dev)
2. **Proxy server-side** (CF / worker autenticado / endpoint próprio) que re-emite com `Allow-Origin`

**Sinais que pegariam mais cedo**:
- ❌ `node --check`, `curl` direto, syntax check — passam todos (não simulam browser CORS).
- ✅ Chrome MCP com origin real (GH Pages) — único que pega.
- ✅ Headers `vary: Origin` / `access-control-*` no response — checar via curl `-I -H "Origin: ..."`.

**Anti-padrão correlato**: assumir que "URL pública = qualquer um lê" sem confirmar CORS. Buckets públicos servem GETs anônimos, mas browsers cross-origin precisam dos headers. Tested in curl ≠ tested in browser.
