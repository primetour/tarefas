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

## 6. Anti-padrões (NÃO FAZER)

- ❌ Dizer "testado" sem ter realmente aberto o Chrome
- ❌ Fazer commit sem bumpar versão + cache-bust
- ❌ Deploy de Cloud Function sem testar a função em produção depois
- ❌ Mudar arquitetura sem atualizar `docs/ARCHITECTURE.md`
- ❌ Adicionar nova collection Firestore sem atualizar `DATA-MODEL.md` + `firestore.rules`
- ❌ Adicionar permission granular sem atualizar `ACCESS-CONTROL.md` + auditar 4 níveis (UI gate / service JS / Firestore rule / role doc)
- ❌ Esquecer de atualizar `dev_hours` depois de release
- ❌ Reproduzir a entrega antes de ter validado o caminho de erro

---

## 7. Checklist mental antes de dizer "feito"

```
[ ] Versão bumpada (js/version.js + index.html cache-bust)
[ ] CHANGELOG.md tem entrada da release
[ ] Commit + push feitos
[ ] Cloud Function deployada (se aplicável)
[ ] GH Pages publicou (curl confirmou patch novo)
[ ] Chrome MCP aberto na versão nova
[ ] Caminho feliz testado E2E
[ ] Pelo menos 1 caminho de erro testado
[ ] Console limpo (sem JS errors)
[ ] dev_hours entrada criada (Firestore)
[ ] DEV-HOURS.md header atualizado
[ ] Doc técnico atualizado (se mudança estrutural)
[ ] Sem TODOs / FIXMEs órfãos no código
```

Se algum item falhar, **diga ao Renê o que ficou pendente** — honestidade > falsa confiança.
