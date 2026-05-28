# Guia de Autoria de Templates — PRIMETOUR

> **Versão**: v4.63.20+ · **Audiência**: designers, autores de conteúdo, devs/IA que constroem templates HTML/DOCX/PPTX pra Biblioteca de Templates.
>
> Este doc é a **fonte da verdade** pra quem vai criar um template uploaded e atribuir a uma área. Cobre **3 formatos**, **3 módulos** e **toda a parte visual fina** (dimensões A4, fontes, cores brand, page-breaks, headers/footers, SSRF allowlist).
>
> Se este guia desatualizar do código, abrir issue ou PR. Sempre que `js/services/templates.js PLACEHOLDERS_SPEC` ou `js/services/templateAdapter.js` mudarem, este doc precisa refletir.

---

## Sumário

1. [Como funciona o pipeline](#1-como-funciona-o-pipeline)
2. [Engines de render por formato](#2-engines-de-render-por-formato)
3. [HTML+CSS Handlebars — dimensões, fontes, cores](#3-htmlcss-handlebars--dimensões-fontes-cores)
4. [SSRF allowlist (imagens externas)](#4-ssrf-allowlist-imagens-externas)
5. [Handlebars syntax suportada](#5-handlebars-syntax-suportada)
6. [DOCX (Word) — passo a passo](#6-docx-word--passo-a-passo)
7. [PPTX (PowerPoint) — passo a passo](#7-pptx-powerpoint--passo-a-passo)
8. [Dicionário de placeholders — Cotações](#8-dicionário-de-placeholders--cotações)
9. [Dicionário de placeholders — Portal de Dicas](#9-dicionário-de-placeholders--portal-de-dicas)
10. [Dicionário de placeholders — Banco de Roteiros](#10-dicionário-de-placeholders--banco-de-roteiros)
11. [Patterns visuais legados (replicar nos seus templates)](#11-patterns-visuais-legados-replicar-nos-seus-templates)
12. [Checklist final antes de subir](#12-checklist-final-antes-de-subir)
13. [Anti-padrões — NÃO fazer](#13-anti-padrões--não-fazer)
14. [Templates de Web Link (v4.63.22+)](#14-templates-de-web-link-v46322)

---

## 1. Como funciona o pipeline

```
1. Você cria arquivo .html/.docx/.pptx com placeholders {{var}}
2. Upload via UI Biblioteca de Templates → R2 + Firestore doc
3. CF extractPlaceholders (trigger onCreate) scaneia e popula placeholders[]
4. Admin atribui template à área (Editor de Áreas → tab 📐 Templates)
5. User gera material (PDF/DOCX/PPTX/Web)
6. Generator detecta area.templateRefs[modulo][formato] → chama CF renderTemplate
7. CF: interpolação Handlebars (HTML) ou Mustache (DOCX/PPTX)
   - HTML → Puppeteer headless Chrome → PDF
   - DOCX/PPTX → docxtemplater + pizzip → arquivo Office
8. Output ≤5MB → base64 inline; >5MB → R2 fallback download URL
9. Client recebe blob, downloadBlob() dispara save no browser
```

**Falha graceful**: se render falhar (placeholder typo, asset SSRF blocked, etc.), o sistema cai pro pipeline antigo (jsPDF/docx.js/pptxgenjs) e avisa via `toast.warning` + grava `audit_logs.templates.fallback`. Seu PDF vai sair com o padrão do sistema em vez do seu template — verifique.

---

## 2. Engines de render por formato

| Formato | Engine | Lib | Syntax |
|---|---|---|---|
| **HTML → PDF** | Puppeteer headless Chrome + Handlebars | `puppeteer-core@25+ + @sparticuz/chromium + handlebars` | Handlebars completo (`{{var}}`, `{{#if}}`, `{{#each}}`, `{{#unless}}`) |
| **HTML → Web link** | Não passa por template uploaded | `portal-view.html`/`roteiro-view.html` estáticos | — |
| **DOCX** | docxtemplater + pizzip | `docxtemplater@3+` | Mustache subset (`{{var}}`, `{{#var}}…{{/var}}`, `{{^var}}…{{/var}}`) |
| **PPTX** | docxtemplater + pizzip | mesmo | Mesma Mustache (DOCX e PPTX são ZIPs de XML, mesmo engine) |

**Implicações práticas**:
- HTML aceita 100% do Handlebars (loops, condicionais, helpers customizados). Cuidado: `(eq X 1)` **NÃO existe** por default — use labels precomputados no adapter.
- DOCX/PPTX usam **Mustache**, que é mais limitado (sem `(eq)`, sem helpers). Loops via `{{#array}}…{{/array}}`. Condições negadas via `{{^var}}…{{/var}}`. Sem `if/else if`.
- Se precisar de lógica complexa em DOCX/PPTX, calcule no adapter (`templateAdapter.js`) e passe o resultado pronto.

---

## 3. HTML+CSS Handlebars — dimensões, fontes, cores

### Página A4

```css
@page { size: A4; margin: 0; }     /* 210mm × 297mm, sem margem CSS default */
```

**Dimensões úteis**:
- Largura: **210mm**
- Altura: **297mm**
- Margem padrão PRIMETOUR: **16mm** (todos os lados)
- Área de conteúdo: **178mm × 265mm**

### Footer/Header running (repete em todas as páginas)

```css
.footer-area { position: running(footer); /* …*/ }
.header-area { position: running(header); /* …*/ }
@page {
  @bottom-center { content: element(footer); }
  @top-right     { content: element(header); }
  margin-top: 14mm;
  margin-bottom: 16mm;
}
```

```html
<div class="footer-area">…</div>
<div class="header-area">…</div>
```

Estes elementos são renderizados em **toda página** automaticamente pelo Chromium. Os valores `customFooterText` / `customHeaderText` vêm dos placeholders.

### Fontes

**Use Google Fonts Poppins** — é a fonte oficial PRIMETOUR e já está no allowlist SSRF do Puppeteer:

```html
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
```

**NÃO use** outras fontes externas (não vão carregar — SSRF lockdown bloqueia tudo fora do allowlist). Pesos disponíveis: 300, 400, 500, 600, 700, 800.

**Fallback CSS**:
```css
body { font-family: 'Poppins', -apple-system, BlinkMacSystemFont, sans-serif; }
```

### Cores brand (CSS vars dinâmicas)

```css
:root {
  --primary:   {{area.corPrimary}};    /* gold/brand main */
  --secondary: {{area.corSecondary}};  /* dark navy */
  --accent:    {{area.corAccent}};     /* destino/dia title */
  --gold:      #D4A843;                /* override só se PRIMETOUR fixo */
}
```

**Defaults se area não tiver cor**: `--primary: #D4A843` (gold) · `--secondary: #0F172A` (navy) · `--accent: #D4A843`.

**Cores recorrentes do design system**:
- Texto principal: `#1F2937`
- Texto muted: `#6B7280`
- Border leve: `#E5E7EB`
- Background alt-row (tabelas): `#F5F5F5`
- Background callout: `#FAF6EC`
- Check verde: `#228B22`
- X vermelho: `#C83C3C`

### Tamanhos de fonte (referencial pro look-and-feel legado)

| Elemento | Tamanho | Peso |
|---|---|---|
| Capa: brand name | 22pt | 700 |
| Capa: destinos uppercase | 18pt | 700 |
| Capa: subtitle (ROTEIRO DE VIAGEM) | 13pt | 700 |
| Capa: cliente nome | 11pt | 700 |
| Capa: pax | 10pt | 400 |
| Section title | 12pt | 700 |
| Heading H2 destino | 22pt | 700 |
| Heading H3 segment | 11pt | 700 |
| Body text | 10pt | 400 |
| Table cell | 8pt | 400 |
| Footer | 7pt | 400 |
| Header running | 6pt | 400 |
| Chip/badge | 7-8pt | 600 |

### Page breaks

```css
.day, .segment, .info-callout, .hotel-thumb {
  page-break-inside: avoid;
}
.closing, .destination, .section-cover {
  page-break-before: always;
}
.cover {
  page-break-after: always;
}
```

**Regra de ouro**: blocos visuais coerentes (1 dia, 1 segmento, 1 callout) **nunca devem cortar** entre páginas. Use `page-break-inside: avoid`.

---

## 4. SSRF allowlist (imagens externas)

Por segurança (audit pós-sprint v4.63.x #2), o Puppeteer **bloqueia toda request externa** durante o render exceto:

✅ **Permitidos**:
- `data:` URIs (imagens inline base64, fontes embeddeds)
- `about:` (internal Chromium)
- `https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev/...` (R2 bucket público PRIMETOUR)
- `https://fonts.googleapis.com/...`
- `https://fonts.gstatic.com/...`

❌ **Bloqueados** (todos os outros):
- CDNs de terceiros (Cloudinary, AWS S3 não-nosso, Unsplash direct, etc.)
- Sites externos
- Metadata servers

**Implicação prática**: se você quer usar uma imagem custom no seu template, **suba ela primeiro pra R2** ou embed como `data:image/png;base64,…`.

**Logos da área** (`{{area.logoUrl}}`) já estão no R2 — funcionam direto.

**Hero images dos destinos** (`{{heroUrl}}`) vêm do Banco de Imagens (R2) ou Unsplash via proxy R2 — funcionam direto.

**Imagens custom no seu template** (que NÃO vêm via placeholder): converta pra `data:` URI ou suba pro R2 e copie a URL.

---

## 5. Handlebars syntax suportada

### Built-in (Handlebars vanilla — HTML only)

```handlebars
{{var}}                          {{!-- Interpolação simples --}}
{{var.path.nested}}              {{!-- Path acesso --}}
{{#if cond}}…{{/if}}             {{!-- Condicional --}}
{{#unless cond}}…{{/unless}}     {{!-- Negação --}}
{{#each array}}{{this}}{{/each}} {{!-- Loop --}}
{{#each array}}{{@index}} {{@first}} {{@last}} {{/each}}
{{> partial}}                    {{!-- Partial (não usamos) --}}
{{!-- Comentário (não vai pro render) --}}
```

**NÃO suportado por default** (NÃO use):
- `(eq X Y)`, `(gt X Y)`, `(lt X Y)`, `(neq X Y)`
- `{{lookup}}`, `{{with}}` complexos
- Helpers customizados (a menos que registrados na CF)

**Workaround pra comparações**: calcule no `templateAdapter.js` (ou seed-side) e passe label/flag pronto:
```js
// No adapter:
viagem.noitesLabel = n > 0 ? `${n} NOITE${n > 1 ? 'S' : ''}` : '';
```
```handlebars
{{!-- No template: --}}
<div class="badge">{{viagem.noitesLabel}}</div>
```

### Mustache (DOCX/PPTX)

Subset mais restrito:
```mustache
{{var}}                {{!-- Interpolação --}}
{{#var}}…{{/var}}      {{!-- Loop OU condicional truthy --}}
{{^var}}…{{/var}}      {{!-- Negação (falsy) --}}
```

**Diferença crítica vs Handlebars**: `{{#var}}` faz **loop se var é array, OR condicional truthy se var é objeto/string**. Mesma sintaxe pra ambos.

---

## 6. DOCX (Word) — passo a passo

**Tooling**: Microsoft Word, LibreOffice Writer, Google Docs (com export DOCX), Pages.

### Passo 1: criar arquivo base
Abra Word, crie documento A4 com a estrutura visual desejada. Use estilos nativos (Heading 1, Heading 2, body) ou format manual.

### Passo 2: inserir placeholders
Digite `{{cliente.nome}}` (chaves duplas + path) onde quer o valor. **NÃO insira como campo de mala direta** — digite literal mesmo, docxtemplater interpreta como texto.

**Exemplos**:
```
Cliente: {{cliente.nome}}
Adultos: {{cliente.adults}}  Crianças: {{cliente.children}}
Início: {{viagem.dataInicio}}
```

### Passo 3: loops com tabelas
Pra renderizar lista de hotéis em tabela:

1. Crie tabela com colunas: Cidade | Hotel | Noites
2. Na **primeira linha de dados** (não no header), digite:
   - Coluna 1: `{{#hoteis}}{{cidade}}`
   - Coluna 2: `{{nome}}`
   - Coluna 3: `{{noites}}{{/hoteis}}`
3. docxtemplater vai expandir essa linha em N linhas (uma por item de `hoteis`).

### Passo 4: loops fora de tabela (parágrafos)
Pra lista de inclui:
```
{{#inclui}}
✓ {{this}}
{{/inclui}}
```
Word converte `{{#inclui}}` e `{{/inclui}}` em parágrafos separados — fica feio em rascunho mas docxtemplater remove ao renderizar.

### Passo 5: condicionais
```
{{#cliente.email}}E-mail: {{cliente.email}}{{/cliente.email}}
```
Só renderiza se `cliente.email` for truthy.

### Passo 6: imagens
**docxtemplater NÃO suporta imagens dinâmicas por default**. Pra inserir logo da área, há 2 paths:
1. **Imagem fixa no template**: insira logo PRIMETOUR direto no Word (vira parte do binário). Funciona só pra logo único.
2. **Plugin docxtemplater-image-module-free**: requer code change na CF. **Não habilitado ainda** (TODO v4.64+).

**Por enquanto**: textos dinâmicos sim, imagens dinâmicas não. Pode incluir logo PRIMETOUR fixo no Word.

### Passo 7: validar
1. Subir via Biblioteca → Upload
2. Modal de upload mostra **placeholders detectados** automaticamente (CF extractPlaceholders parseou)
3. Conferir lista — se faltar placeholder seu, talvez você digitou `{{ var }}` (com espaço) ou `{var}` (chave única). Use `{{var}}` exato.
4. Clicar "Testar" no card do template — vai renderizar com sample data e baixar.

### Detalhes finos pra Word

- **Estilos nativos Word** (Heading 1, etc.) são preservados no render
- **Cores de texto/fundo** são preservadas
- **Tabelas com bordas customizadas** funcionam — desenhe como quiser
- **Page breaks manuais** (Ctrl+Enter) funcionam
- **Headers/footers nativos do Word** funcionam — coloque `{{customFooterText}}` no footer nativo
- **Numeração de página** nativa Word funciona (campo PAGE)
- **Fontes**: use fontes que o Office sabe abrir (Poppins precisa estar instalada no Word — se não, usa fallback). Recomendado: Calibri, Arial, Times se for genérico.

---

## 7. PPTX (PowerPoint) — passo a passo

Mesma engine docxtemplater + Mustache. Diferenças:

### Passo 1: criar deck base
Abra PowerPoint, escolha tamanho de slide (Widescreen 16:9 ou Standard 4:3). Crie slides com layout desejado.

### Passo 2: placeholders em text boxes
Em cada text box que quer dado dinâmico, digite `{{var}}`:
- Title: `{{titulo}}`
- Subtitle: `{{cliente.nome}}`
- Footer: `{{area.nome}} · {{today}}`

### Passo 3: loops em slides
**Não é trivial**. PowerPoint não tem "tabela linha-loop" como Word. Pra gerar N slides (um por destino), precisa criar 1 slide modelo e repetir manualmente. Ou usar `{{#destinos}}…{{/destinos}}` em UM text box dentro do slide — vai concatenar todos os destinos em um único bloco.

**Padrão recomendado**: 1 slide com summary geral + N slides duplicados (1 por destino preenchido manualmente). Limitação do formato.

### Passo 4: imagens dinâmicas
Mesmo limitação do DOCX — não funciona por default. Insira imagens fixas (logo PRIMETOUR) no slide modelo.

### Detalhes finos pra PowerPoint

- **Tema visual**: defina cores, fontes, layout no Slide Master → vão aparecer em todos os slides
- **Transições/animações**: não interferem no render (são preservadas no .pptx final, mas só funcionam quando user reproduz a apresentação)
- **Slide notes**: funcionam — pode incluir `{{customFooterText}}` lá

---

## 8. Dicionário de placeholders — Cotações

> Adapter: `js/services/templateAdapter.js → roteiroToTemplateData(roteiro, area, opts)`
>
> Atualize aqui quando adicionar campo no adapter ou no schema do roteiro.

### Root

| Path | Tipo | Required | Exemplo | Descrição |
|---|---|---|---|---|
| `titulo` | string | opcional | "Lua de mel — Itália" | Título da cotação |
| `today` | string | sempre | "28/05/2026" | Data de hoje, formato DD/MM/YYYY |
| `contact` | string | opcional | "cotacoes@primetour.com.br" | Contato pro rodapé/closing |
| `customFooterText` | string | opcional | "PRIMETOUR Lazer · cotacoes@…" | Texto custom rodapé (área Exports config, máx 3 linhas) |
| `customHeaderText` | string | opcional | "CONFIDENCIAL — uso interno" | Texto canto sup. direito |
| `hideCover` | bool | opcional | `false` | Se `true`, pular capa + closing page |
| `hasIncExc` | bool | computed | `true` | Flag de visibilidade pra seção Inclui/Exclui |

### area

Branding da área (BU) que está gerando.

| Path | Tipo | Exemplo | Descrição |
|---|---|---|---|
| `area.nome` | string | "Lazer" | Nome da área (ou "PRIMETOUR" se `brand.useExternalName=false`) |
| `area.logoUrl` | string (URL R2) | "https://pub-…r2.dev/logos/lazer.webp" | Logo principal |
| `area.logoUrlAlt` | string (URL R2) | … | Logo alt (fundo claro) |
| `area.corPrimary` | string hex | "#D4A843" | Cor gold/brand principal |
| `area.corSecondary` | string hex | "#0F172A" | Cor navy escura (fundo capa) |
| `area.corAccent` | string hex | "#D4A843" | Cor accent (titles dia/destino) |

### cliente

| Path | Tipo | Exemplo | Descrição |
|---|---|---|---|
| `cliente.nome` | string | "João e Maria Silva" | Nome do cliente |
| `cliente.adults` | number | 2 | Número de adultos |
| `cliente.children` | number | 0 | Número de crianças |
| `cliente.email` | string | "joao@…" | Email |
| `cliente.telefone` | string | "+55 11 …" | Phone |
| `cliente.adultsLabel` | string precomputed | "2 adultos" | Label "N adulto(s)" (sem precisar de eq helper) |
| `cliente.childrenLabel` | string precomputed | "" ou "1 criança" | Label "N criança(s)" |
| `cliente.paxLabel` | string precomputed | "2 adultos + 1 criança" | Label combinado |

### viagem

| Path | Tipo | Exemplo | Descrição |
|---|---|---|---|
| `viagem.dataInicio` | string DD/MM/YYYY | "01/10/2026" | Início (formatado sem timezone shift) |
| `viagem.dataFim` | string DD/MM/YYYY | "12/10/2026" | Fim |
| `viagem.noites` | number | 11 | Quantidade de noites |
| `viagem.noitesLabel` | string precomputed | "11 NOITES" | Label uppercase |
| `viagem.destinos` | string concat | "Roma · Florença · Veneza" | Lista joined por " · " |
| `viagem.destinosLista[]` | array | `[{cidade, pais}]` | Array detalhado pra loop |
| `viagem.destinosLista[].cidade` | string | "Roma" | |
| `viagem.destinosLista[].pais` | string | "Itália" | |

### dias[]

Array de dias. Loop: `{{#each dias}}…{{/each}}`.

| Path | Tipo | Exemplo | Descrição |
|---|---|---|---|
| `dias[].numero` | number | 1 | Dia (1, 2, 3…) |
| `dias[].data` | string DD/MM/YYYY | "01/10/2026" | Data do dia |
| `dias[].cidade` | string | "Roma" | Cidade do dia |
| `dias[].narrativa` | string longa | "Chegada em Roma…" | Texto descritivo do dia |
| `dias[].heroUrl` | string URL R2 | "https://pub-…/images/roma-hero.webp" | Hero image (do banco_imagens via cidade) |
| `dias[].atividades[]` | array | `[{hora, descricao}]` | Atividades planejadas |
| `dias[].atividades[].hora` | string | "14:00" | Hora HH:MM |
| `dias[].atividades[].descricao` | string | "Check-in Hotel de Russie" | Descrição |
| `dias[].pernoite` | string | "Roma" | Cidade pernoite |

### hoteis[]

| Path | Tipo | Exemplo | Descrição |
|---|---|---|---|
| `hoteis[].cidade` | string | "Roma" | |
| `hoteis[].nome` | string | "Hotel de Russie" | |
| `hoteis[].quarto` | string | "Junior Suite" | Tipo de quarto |
| `hoteis[].regime` | string | "Café da manhã" | Plano de pensão |
| `hoteis[].noites` | number | 3 | |
| `hoteis[].checkIn` | string DD/MM/YYYY | "01/10/2026" | |
| `hoteis[].checkOut` | string DD/MM/YYYY | "04/10/2026" | |

### voos[]

| Path | Tipo | Exemplo | Descrição |
|---|---|---|---|
| `voos[].cia` | string | "LATAM" | Airline |
| `voos[].numero` | string | "LA8084" | Número do voo |
| `voos[].origem` | string | "GRU" / "São Paulo" | Cidade/aeroporto origem |
| `voos[].destino` | string | "FCO" / "Roma" | Cidade/aeroporto destino |
| `voos[].rota` | string precomputed | "GRU → FCO" | Origin → Dest formatado |
| `voos[].dataPartida` | string DD/MM/YYYY | "30/09/2026" | |
| `voos[].horaPartida` | string | "20:45" | |
| `voos[].dataChegada` | string DD/MM/YYYY | "01/10/2026" | |
| `voos[].horaChegada` | string | "14:30" | |
| `voos[].classe` | string | "Business" | |

### precos

| Path | Tipo | Exemplo | Descrição |
|---|---|---|---|
| `precos.hasData` | bool | `true` | Flag de visibilidade |
| `precos.moeda` | string | "BRL" | ISO 4217 |
| `precos.totalCasal` | string formatted | "R$ 124.500,00" | Por casal formatado pt-BR |
| `precos.porPessoa` | string formatted | "R$ 62.250,00" | Por pessoa formatado |
| `precos.customRows[]` | array | `[{label, value}]` | Linhas extras (taxas, etc.) |
| `precos.customRows[].label` | string | "Taxa de embarque" | |
| `precos.customRows[].value` | string formatted | "R$ 1.200,00" | |
| `precos.validUntil` | string DD/MM/YYYY | "15/06/2026" | Validade da cotação |
| `precos.disclaimer` | string | "Valores sujeitos…" | Disclaimer custom |
| `precos._raw.perCouple` | number | 124500 | Valor numérico bruto (pra calcular) |
| `precos._raw.perPerson` | number | 62250 | |

### inclui / naoInclui

Arrays de strings. Loop simples:
```handlebars
{{#each inclui}}<li>✓ {{this}}</li>{{/each}}
{{#each naoInclui}}<li>✗ {{this}}</li>{{/each}}
```

### opcionais[]

| Path | Tipo | Exemplo |
|---|---|---|
| `opcionais[].servico` | string | "Aulas culinária Florença" |
| `opcionais[].precoAdulto` | string formatted | "R$ 850,00" |
| `opcionais[].precoCrianca` | string formatted | "—" |
| `opcionais[].observacoes` | string | "Inclui mercado + jantar" |

### pagamento

| Path | Tipo | Descrição |
|---|---|---|
| `pagamento.hasData` | bool | Flag visibilidade |
| `pagamento.deposit` | string | Sinal/entrada |
| `pagamento.installments` | string | Parcelamento |
| `pagamento.deadline` | string | Prazo |
| `pagamento.notes` | string | Observações |

### cancelamento[]

| Path | Tipo | Exemplo |
|---|---|---|
| `cancelamento[].period` | string | "Até 60 dias antes" |
| `cancelamento[].penalty` | string | "Multa de 10%" |

### informacoes

| Path | Tipo | Descrição |
|---|---|---|
| `informacoes.hasData` | bool | Flag visibilidade |
| `informacoes.passport` | string | Validade/regras passaporte |
| `informacoes.visa` | string | Vistos necessários |
| `informacoes.vaccines` | string | Vacinas |
| `informacoes.climate` | string | Clima esperado |
| `informacoes.luggage` | string | Regras bagagem |
| `informacoes.flights` | string | Detalhes voos |
| `informacoes.customFields[]` | array | `[{label, value}]` custom |

---

## 9. Dicionário de placeholders — Portal de Dicas

> Adapter: `templateAdapter.js → portalToTemplateData({ allTips, area, segments, areaName, imagesByDest, customFooterText, customHeaderText, hideCover })`

### Root

| Path | Tipo | Descrição |
|---|---|---|
| `today` | string | Data hoje DD/MM/YYYY |
| `customFooterText` | string | Vide Cotações |
| `customHeaderText` | string | Vide Cotações |
| `hideCover` | bool | Vide Cotações |
| `segments[]` | array | Lista de keys de segments custom da área (raro usar direto no template) |

### area

Mesmo formato de Cotações (`area.nome`, `area.logoUrl`, `area.corPrimary`, `area.corSecondary`). Sem `corAccent` (Portal usa primary como accent).

### destinos[]

Array de destinos agrupados por dest.id (N tips na mesma cidade = 1 destino com `tips[]` array).

| Path | Tipo | Exemplo | Descrição |
|---|---|---|---|
| `destinos[].id` | string | "paris" | ID do dest |
| `destinos[].cidade` | string | "Paris" | |
| `destinos[].pais` | string | "França" | |
| `destinos[].label` | string concat | "Paris, França" | Cidade + país joined |
| `destinos[].heroUrl` | string URL R2 | "https://pub-…/paris-hero.webp" | Hero image (via imagesByDest[destId].hero) |
| `destinos[].tips[]` | array | tip objects raw | Tips originais (pra acesso avançado) |
| `destinos[].segments` | object map | `{informacoes_gerais: {…}, restaurantes: {…}}` | Map raw merged dos segments |
| `destinos[].segmentos[]` | array shaped | Vide abaixo | **Use esse pra loop principal** |

### destinos[].segmentos[]

Array iterável em **ordem dos DEFAULT_SEGMENTS**, só com segments que têm conteúdo.

| Path | Tipo | Descrição |
|---|---|---|
| `segmentos[].key` | string | Slug: "informacoes_gerais", "restaurantes", etc. |
| `segmentos[].label` | string | "Informações Gerais", "Restaurantes", etc. |
| `segmentos[].mode` | string | "special_info" \| "simple_list" \| "place_list" \| "agenda" |
| `segmentos[].narrative` | string | Texto descritivo do segment (`themeDesc`) |
| `segmentos[].items[]` | array `[{name, desc}]` | Lista (place_list/simple_list/agenda) |
| `segmentos[].info` | object | Info gerais (só se mode='special_info') |

### segmentos[].info (mode='special_info')

| Path | Tipo | Descrição |
|---|---|---|
| `info.descricao` | string | Descrição cidade |
| `info.dica` | string | Dica callout |
| `info.populacao` | string | "2.1M" |
| `info.moeda` | string | "EUR" |
| `info.lingua` | string | "Francês" |
| `info.religiao` | string | "Católica" |
| `info.voltagem` | string | "230V" |
| `info.ddd` | string | "+33" |
| `info.fuso` | string precomputed | "+1h" |
| `info.hasChips` | bool | Flag pra renderizar grid de chips |

---

## 10. Dicionário de placeholders — Banco de Roteiros

> Adapter: `templateAdapter.js → bancoToTemplateData(bankDoc, area)`

### Root

| Path | Tipo | Descrição |
|---|---|---|
| `titulo` | string | Título do roteiro do banco |
| `today` | string | DD/MM/YYYY |

### area
Mesmo formato (`area.nome`, `area.logoUrl`, `area.logoUrlAlt`).

### viagem

| Path | Tipo | Descrição |
|---|---|---|
| `viagem.noites` | number | Total de noites do roteiro modelo |
| `viagem.destinos` | string concat | Lista joined " · " |

### dias[]

| Path | Tipo | Descrição |
|---|---|---|
| `dias[].numero` | number | Dia 1, 2… |
| `dias[].cidade` | string | |
| `dias[].narrativa` | string | Descrição do dia (banco) |

### hoteis[]

Flattened de `bankDoc.categories[].hotels[]`.

| Path | Tipo |
|---|---|
| `hoteis[].cidade` | string |
| `hoteis[].nome` | string |
| `hoteis[].regime` | string |
| `hoteis[].noites` | number |

### inclui / naoInclui
Arrays de strings (de `bankDoc.includes` / `bankDoc.excludes`).

---

## 11. Patterns visuais legados (replicar nos seus templates)

Pra ficar **irretocável** seguindo o padrão PRIMETOUR luxury travel:

### Capa
- Fundo `--secondary` (navy escuro) full-bleed
- Logo central grande (130mm × 80mm cap), composited com fundo escuro pra resolver PNG transparente
- Destinos em **MAIÚSCULAS com letter-spacing 3px**, joined por " · "
- Badge "N NOITES" com border branco, padding 4mm × 16mm
- Linhas decorativas brancas (0.6mm height) no topo (y=40mm) e fundo (y=237mm) horizontais
- Cliente nome bold 11pt + pax label 10pt regular

### Section headers
- **Barra colorida** 6mm × 4mm (`--primary`) à esquerda
- Título 12pt 700, **letter-spacing 3px**, uppercase, `--secondary`
- Linha 0.3mm separator embaixo `--border-light`

### Dia-a-dia
- **Número em círculo** 10mm diâmetro, fundo `--primary`, número branco 700 10pt
- Hero image **28mm altura** cover-crop, border 0.3mm subtle
- Narrative 10pt, line-height 1.7
- Atividades: **hora bold primary** (14mm width) + descrição (flex 1)
- Pernoite italic 9pt `--primary`

### Tabelas
- Header: bg `--secondary`, texto branco 8pt 700, padding 3mm × 2.5mm
- Body: 8pt regular, padding 2.5mm × 2.5mm
- **Alternating rows**: `bg #F5F5F5` em nth-child(odd)
- Border bottom 0.2mm `--border-light` por row
- Header cells `text-align: left` por default, `.center` quando precisa centralizar

### Inclui/Exclui
- Check ✓ verde `#228B22` 700 — width 4mm
- X ✗ vermelho `#C83C3C` 700 — width 4mm
- Texto regular 10pt

### Cards / Calouts
- `page-break-inside: avoid`
- Background `--bg-callout` (#FAF6EC) opcional
- Border-left 3px solid `--gold`
- Padding 4mm × 6mm

### Footer running
- Texto centralizado 7pt color #999
- Linha 0.3mm `#ddd` em cima
- Custom footer text abaixo, 6pt color #aaa
- Logo opcional centralizado (composited fundo branco)

### Closing page
- Fundo `--secondary` full-bleed
- Logo centralizado (90mm × 40mm cap)
- "Boa viagem!" italic 14pt branco
- Tagline 10pt regular branco rgba(255,255,255,0.9)
- Contato 9pt regular branco rgba(255,255,255,0.85)
- Linhas brancas horizontais em y=142mm e y=182mm

---

## 12. Checklist final antes de subir

```
[ ] Arquivo extensão correta (.html, .docx, .pptx)
[ ] Tamanho < 15MB (limite Storage)
[ ] HTML: tem <html><head><body> completos
[ ] HTML: charset UTF-8 declarado
[ ] HTML: @page A4 declarado
[ ] HTML: Poppins Google Fonts linkado
[ ] HTML: CSS vars --primary/--secondary usam {{area.corPrimary}}/{{area.corSecondary}}
[ ] HTML: imagens externas SÓ em allowlist (R2, Google Fonts, data:)
[ ] HTML: page-break-inside: avoid em blocos coerentes
[ ] HTML: footer running com {{customFooterText}}
[ ] HTML: header running com {{customHeaderText}}
[ ] HTML: hideCover respeitado ({{#unless hideCover}}…{{/unless}})
[ ] Handlebars: sem (eq) (gt) (lt) custom helpers — só built-in
[ ] Placeholders: usar EXATAMENTE os paths do dicionário (case-sensitive)
[ ] Placeholders: paths existem no adapter (verificar PLACEHOLDERS_SPEC)
[ ] DOCX/PPTX: Mustache syntax {{#var}}…{{/var}} (não Handlebars)
[ ] DOCX: tabelas usam #loop dentro da primeira row de dados
[ ] Validar: subir como template "test" + clicar Testar com sample data
[ ] Validar: abrir PDF e conferir visual
[ ] Validar: rendered placeholders[] vs spec (modal upload mostra detectados)
[ ] Validar: fallback graceful — se renderizar com generator legado em vez do seu, algo falhou
[ ] Atribuir à área de teste (Editor de Áreas → tab Templates)
[ ] Gerar via produção (Gerador de Cotações / Portal / Banco) e conferir
```

---

## 13. Anti-padrões — NÃO fazer

❌ **Imagens externas fora do allowlist** — vai bloquear em runtime e o PDF sai sem a imagem (com hole). Suba pra R2 ou embed data:.

❌ **Helpers Handlebars customizados** — vai dar erro `Missing helper: eq`. Use labels precomputados.

❌ **Fontes além de Poppins/Google Fonts** — não carrega. Use Poppins ou system fallback.

❌ **`@page` sem A4** — pode dar tamanho errado de página.

❌ **HTML sem `<!DOCTYPE html>` ou sem `<head><body>`** — Puppeteer tolera mas Chromium pode renderizar quirks mode.

❌ **CSS vars que dependem de `{{var}}`** sem fallback — se area não tem cor, vira inválido. Use:
```css
:root { --primary: {{area.corPrimary}}; }   /* ✅ adapter retorna default se vazio */
```

❌ **`page-break-after: always` no body** — quebra tudo. Use só em blocos específicos.

❌ **DOCX com `{{#if}}` ou `{{#each}}`** — Mustache não suporta. Use `{{#var}}` (truthy/loop) ou `{{^var}}` (negado).

❌ **Placeholder com espaço** (`{{ var }}`) — docxtemplater pode confundir. Sempre `{{var}}` sem espaço.

❌ **Mover/renomear arquivo seed após subir** — ID do template fica vinculado a R2 path original. Se mover, suba versão nova via UI.

❌ **Esquecer cache-bust** após upload novo de template HTML — o `templateAdapter` cacheia no browser. Force reload (Cmd+Shift+R) ou cleanup `caches.delete()`.

---

## Referências cruzadas

- **Schema técnico** (Firestore template doc): `js/services/templates.js → fetchTemplates / uploadTemplate`
- **Adapter de dados**: `js/services/templateAdapter.js`
- **Generators que detectam template**: `js/services/{roteiroGenerator,portalGenerator,roteiroBankGenerator}.js`
- **CF render**: `functions/index.js → renderTemplate` (Puppeteer + Handlebars + docxtemplater)
- **CF security**: `functions/index.js → _validateR2FileUrl + Puppeteer setRequestInterception allowlist`
- **Templates seed exemplo**: `templates/seeds/portal-default-html.html` e `templates/seeds/cotacoes-default-html.html`

---

**Última atualização**: 2026-05-28 v4.63.22.

---

## 14. Templates de Web Link (v4.63.22+)

Web Link é o **4º formato** do sistema (depois de HTML→PDF, DOCX, PPTX). Diferenças críticas:

| Aspecto | HTML→PDF (PDF) | Web Link |
|---|---|---|
| Render engine | Puppeteer server-side (CF) | Browser do cliente (zero server-side render) |
| Output | Arquivo `.pdf` download | URL pública compartilhável |
| CSS | `@page A4`, `print-color-adjust:exact` | Viewport responsivo, hover/click |
| Fontes | Apenas SSRF allowlist (Google Fonts) | **Livre** — qualquer CDN |
| `<script>` | NÃO (Puppeteer roda 1 vez, output é estático) | **SIM** — Leaflet, Alpine, custom JS |
| Tamanho | Limitado a ~5MB output | Limitado a 8MB upload |
| Servido por | Download blob | R2 direto OU portal-view-tpl.html (proxy) |

### 14.1 Os 2 modos: `full` vs `slots`

O documento do template no Firestore tem campo opcional `templateMode`:

**`full`** (default): Substituição total.
- Template HTML completo substitui `portal-view.html` ou `roteiro-view.html`.
- Designer escreve TUDO: layout, navegação, mapa Leaflet, carrousel, search.
- Recebe os dados via Handlebars + JS hooks (`window.PRIMETOUR.*`).
- Máxima customização, mas **perde features prontas** (mapa, carrousel padrão).

**`slots`** (v4.63.23+): Slots customizáveis.
- `portal-view.html` canônico continua renderizando layout principal.
- Template injeta apenas PARTES:
  - `customHeaderHtml` (faixa superior)
  - `customFooterHtml` (rodapé)
  - `customCss` (overrides de estilo)
  - `customMetaOg` (meta OG pra crawlers WhatsApp/social)
- Conservador, ideal pra branding diferente sem reescrever sistema.

### 14.2 SSRF / segurança no Web Link

**Diferença crítica** vs PDF: Web Link **NÃO passa por Puppeteer server-side**. O template é servido como HTML estático e **o browser do CLIENTE** que executa.

Implicações:
- ✅ Sem SSRF allowlist (servidor não fetch externamente quando serve HTML)
- ✅ Designer pode usar QUALQUER CDN (unpkg, jsdelivr, cdnjs, Leaflet CDN, FontAwesome, etc.)
- ✅ `<script type="module">`, async/await, fetch API — tudo funciona
- ⚠ **Mas**: como executa no browser do cliente, **XSS via dado mal-saneado** vira preocupação. Use `{{var}}` (escape automático Handlebars), evite `{{{var}}}` (raw, sem escape).
- ⚠ **Admin malicioso pode incluir scripts pra exfiltrar dados do cliente** (cookies do domínio primetour.github.io, etc.). Permission `templates_manage` deve ser restrita a master + curadores.

### 14.3 Variáveis Web-exclusive

Além de todos os placeholders dos formatos Cotações/Portal/Banco, Web Link tem:

| Path | Tipo | Required | Descrição |
|---|---|---|---|
| `webUrl` | string | sempre | URL canônica do link público |
| `previewUrl` | string | comum | URL com OG meta dinâmico (WhatsApp/social crawlers) |
| `token` | string | sempre | Token único do link |
| `webExports.headerText` | string | opcional | Faixa superior custom (Áreas → Exports → Web) |
| `webExports.footerText` | string | opcional | Texto rodapé custom |
| `createdBy.name` | string | comum | Nome do consultor que gerou |
| `createdBy.email` | string | opcional | Email do consultor |
| `createdAt` | date | sempre | Timestamp servidor |
| `views` | number | computed | Views acumuladas (incrementado por portal-view) |

### 14.4 JS Hooks (v4.63.22+)

Pra templates de modo `full` que QUEREM features do sistema (mapa, carrousel) sem reimplementar:

```html
<script>
  window.PRIMETOUR = window.PRIMETOUR || {};

  // Handler customizado pra clique em destino do menu
  window.PRIMETOUR.onDestinoClick = (destId) => {
    console.log('User clicou em', destId);
    // Sua logic aqui — scroll, modal, analytics, etc.
  };

  // Filtro de segmento aplicado
  window.PRIMETOUR.onSegmentFilter = (segmentKey) => {
    // Customize qual conteúdo aparece quando user filtra
  };

  // Click em pin do mapa Leaflet
  window.PRIMETOUR.onMapPinClick = (placeId, latlng) => {
    // Abrir popup custom, navegar pra outro slide, etc.
  };
</script>
```

Esses hooks ficam **disponíveis quando portal-view.html canônico está no path** (modo `slots`). Em modo `full`, designer implementa tudo do zero — hooks são opcionais.

### 14.5 Como criar um template Web Link

1. **Criar arquivo `.html`** com:
   - `<!DOCTYPE html>` + `<html lang="pt-BR">` + UTF-8
   - `<title>{{titulo}}</title>` (vai aparecer na aba do navegador)
   - Meta OG opcionais: `<meta property="og:image" content="...">` (pra WhatsApp)
   - CSS responsivo (`@media (max-width: 768px) { … }`)
   - Imports de fontes/libs SEM restrição (qualquer CDN)
   - Placeholders Handlebars
2. **Decidir o `templateMode`**:
   - `full`: você escreve TUDO. Mais trabalho mas total controle.
   - `slots`: você injeta só pedaços. Mais rápido, sistema continua funcionando.
3. **Upload via Biblioteca de Templates** → formato "Web Link"
4. **Atribuir à área** → Editor de Áreas → tab Templates → coluna "Web Link"
5. **Gerar Web Link** pelo Portal (ou Cotações futuro) → URL gerada usa seu template

### 14.6 Limitações conhecidas v4.63.22

- **Cotações** ainda não suporta web template (só Portal) — vem em v4.63.23+
- **Modo `slots`** ainda não está implementado em runtime — só schema. Modo `full` é o único funcional nesta release.
- Renderização Handlebars do template ocorre em `portal-view-tpl.html` (NEW v4.63.23) — esta release foundation **grava metadata, ainda não renderiza com template**. Aguarde v4.63.23+ pra cliente abrir URL e ver template ativo.
- Audit log `templates.render` (server-side) não dispara pra Web (o render é client-side).
- Compliance/LGPD: dados expostos via URL pública. Reveja antes de atribuir templates customizados em áreas com clientes sensíveis.

---
