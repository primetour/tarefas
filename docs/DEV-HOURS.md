# Sistema de Horas de Desenvolvimento

> **Última atualização:** v4.50.10 (23/05/2026) · 110 dias de calendário · ~829h 27min approved · ~R$ 124.439 · 7h 32min/dia médio · 216 releases + 17 phases (233 entradas aprovadas)
>
> _Sprint 23/05/2026 (banco fase 4 — hotfixes UX+visual)_: **v4.50.5 → v4.50.10** — **+2,20h / +R$ 327,75**, todas marcadas `module: 'banco-roteiros'` (entram na aba Foco em Produto):
> - **v4.50.5** (+0,36h): hotfix `doc.autoTable is not a function` — guard granular pra jspdf E plugin separadamente
> - **v4.50.6** (+0,46h): polling defensivo pós script.onload (race condition lib UMD anexar prototype)
> - **v4.50.7** (+0,18h): card com bloco meta de validade
> - **v4.50.8** (+0,13h): correção (validity.startDate/endDate em vez de createdAt)
> - **v4.50.9** (+0,32h): timezone YYYY-MM-DD voltava 1 dia em UTC-3 — bug clássico `new Date()` UTC midnight
> - **v4.50.10** (+0,75h): duplo toast por listeners empilhados — AbortController por render() + spinner inline em vez de toast.info
>
> 4 lições novas em CLAUDE.md §12 (a, b, c, d) + §12 (k, l). Padrão AbortController obrigatório em SPA com delegação.
>
> _Sprint 22/05/2026 noite (banco fase 3 + cleanup)_: **v4.50.2 → v4.50.4** — **+1,45h / +R$ 217,32**:
> - **v4.50.2** (+0,29h): hotfix filtro país (selects precisam de `id` não `name`)
> - **v4.50.3** (+1,01h): Banco — remover Importar PDF (sem função) + ícone Exportar PDF nos cards com layout idêntico ao Gerador (novo `roteiroBankGenerator.js` adapta schema bank→roteiro)
> - **v4.50.4** (+0,15h): sidebar cleanup — Dev Hours, Landing Pages, CMS/Site removidos do nav
>
> _Sprint 22/05/2026 noite (banco fase 2)_: **v4.50.1** complemento do Banco de Roteiros — **+2,94h / +R$ 441,00**. Demandas Renê pós-v4.50.0: CRUD inline pra coleções e categorias, thumb auto banco_imagens→Unsplash (Backfill rodado nos 2 PDFs), filtro país cascata, dashboard com 2 blocos novos (Banco + IA), ai_usage_logs em processRoteiroQueue + importRoteiroBankPdf.
>
> _Sprint 22/05/2026 tarde/noite — Roteiros IA + Banco_: **6 releases** (4.49.104→4.49.109 + **v4.50.0 minor**) — **+15,46h / +R$ 2.316,38**. Bloco focado em viabilidade financeira/operacional da IA (chunking 20+ dias, prompt caching, fila assíncrona 30 simultâneos) + lançamento do **Banco de Roteiros** (módulo novo de curadoria, import PDF via Claude Sonnet 4.5 multimodal, 2 PDFs Classic Collection seedados).
>
> - **4.49.105** (+0,64h): Ícones unicode → SVG em 6 pages
> - **4.49.106** (+0,23h): Defesa back sem confirm em roteiro vazio
> - **4.49.107** (+0,72h): Fix IA truncamento (max_tokens 8k→16k)
> - **4.49.108** (+2,40h): Chunking IA + prompt caching pra 20+ dias
> - **4.49.109** (+3,63h): Fila assíncrona Cloud Function (lease pattern, 30+ simultâneos)
> - **v4.50.0** (+7,84h): **Banco de Roteiros — módulo NOVO** (schema 14 seções, CF importRoteiroBankPdf multimodal Claude Sonnet 4.5, UI listing+editor, sidebar item, rules, seed 2 PDFs)
>
> _Sprint 22/05/2026 — Roteiros UX (completa)_: **18 releases** (4.49.86 → 4.49.103) — **+17,37h / +R$ 2.605,50**. Maior sprint single-day em volume de patches. Auditoria UX completa do Gerador de Roteiros após críticas iterativas do Renê:
>
> - **4.49.86-90** (+4,15h/R$ 622,50): Briefing absorvido em Cliente, fix add-dest, Viagem absorvida (15→14 seções), datalist contextual cidades-por-país, hotfix template literal.
> - **4.49.91-95** (+5,70h/R$ 855,00): Aéreo + Hotéis (flights[] schema + 4 exports), Aéreo no link público, fix 21 handlers + Imagens preview + Dicas auto-prefill, dashed→solid + progress overlay IA + agente v3, HOTFIX permission-denied no save.
> - **4.49.96-98** (+2,38h/R$ 357,00): Ícones SVG, fix overflow + identidade gold + filtros refeitos, audit contextual + filtros sempre visíveis + período custom. CLAUDE.md §10 nova regra: "olhar o TODO".
> - **4.49.99-103** (+5,14h/R$ 771,00): Período inline (sem popup), export unificado (só na aba), Valores por categoria (5 blocos + supplier + visibility + total/grouped), real-time + 4 exports, auto-save 5s + status workflow funcional (5 status com cores).
>
> _Auto-meta 20/05/2026_: 2 releases de documentação — **v4.49.46** (backfill CHANGELOG + dev_hours do sprint, +1,38h / R$ 207) e **v4.49.47** (double-check do CHANGELOG com 6 verificações + 1 fix de precisão, +0,65h / R$ 97,50).
>
> _Backfill 20/05/2026 (madrugada)_: **23 releases novas (4.49.23 → 4.49.45)** — sprint maratona Newsletter centrado no pipeline shadow mode do Classificador IA. **+35,62h ajustado / +R$ 5.343,00** vs snapshot anterior (v4.49.22). Subdividido em 2 blocos:
>
> - **Manhã/tarde (4.49.23-31)** — 13,09h / R$ 1.963,50. Quick wins na aba Conteúdo & Temas (sort, drill, expand), backfill claude-curado do `mc_performance.extracted` (cobertura 4 → 95+ cidades), enrich estendido pra ler `htmlText`, eixos duplos Comercial × Turismo (script `classify-content.js` novo), exports XLS+PDF+PPTX, modal "Ver arte" preview, backfill `imageUrls` legado (692/756 docs = 92%), CSP `img-src` libera SFMC CDNs iniciais.
>
> - **Noite/madrugada (4.49.32-45)** — 22,53h / R$ 3.379,50. Sprint principal: arrumação do legado (categorize-no-art, fix merge waves, CSP completo das 5 BUs SFMC, IA desacoplada do mc-sync), **rewrite do PDF Conteúdo & Temas seguindo padrão Produtividade** (8 gráficos nativos, sanitização total), agente-seed `nl-content-classifier` no IA Hub (Claude Haiku 4.5, DESATIVADO), **pipeline shadow mode completo** (script + workflow + dashboard com sparkline + cutover/rollback workflows + test harness 61 testes + security audit bank-grade 2 CRITICAL + 2 HIGH corrigidos + regression review pra não quebrar login).
>
> _Backfill 19/05/2026 (final do dia)_: 10 releases (4.49.13 → 4.49.22) — sprint denso de melhorias operacionais centradas no painel pessoal + harmonização de filtros + bug crítico do metaLinks. +24,86h / +R$ 3.729,00.
>
> _Backfill 18/05/2026_: 12 releases (4.48.1 → 4.49.8) — sprint denso de bugfixes + features pequenas (auth dedup, filtros, deep-links, RBAC granular, bulk import destinos). +18,45h / +R$ 2.767,50.
>
> Totais consideram apenas entradas com `status='approved'` — 11 entries em draft ficam de fora dos somatórios públicos.

Documento técnico do módulo `dev_hours`: arquitetura, conceitos, calibragem do fator IA, processo de log, dashboards e exportações.

---

## 1. Propósito

Rastrear de forma transparente e mensurável o **custo real de desenvolvimento** da plataforma PRIMETOUR. Cada release ou fase de trabalho vira uma entrada com:
- estimativa em horas humanas (sem IA)
- fator de assistência de IA aplicado
- horas reais cobradas (humanHours × fator)
- custo monetário a R$ 150/h
- breakdown por categoria (refinamento, desenvolvimento, testes, documentação, implantação)

Resultado: dashboard público (`dev-hours-view.html`) e PDF executivo, ambos sem necessidade de login — auditoria externa autorizada.

---

## 2. Modelo de dados

### Coleção `dev_hours`

Cada documento é uma **entrada** que pode ser de 2 tipos:

| Campo | Tipo | Descrição |
|---|---|---|
| `entryType` | `'release'` ou `'phase'` | Release = versão SemVer; Phase = bloco retroativo agregado |
| `releaseVersion` | string | Para releases (ex: `4.35.3`) |
| `releaseSlug` | string | Slug curto (ex: `20260509-system-feedback-module`) |
| `phaseLabel` | string | Para phases (ex: `Discovery & levantamento de requisitos`) |
| `title` | string | Título legível |
| `summary` | string | Descrição completa do trabalho (suporta `…` + Ver mais na UI) |
| `bucket` | string | `trivial` (0.25-0.5h) · `small` (0.5-1.5h) · `medium` (3-8h) · `large` (8-16h) · `mega` (16-80h) |
| `multiplierIds[]` | string[] | Lista de complicadores aplicados (vide §3) |
| `profile` | string | `feature` · `bugfix` · `phase` · etc — define ratios do breakdown |
| `humanEquivalentHours` | number | Estimativa **humana pura** em horas (após multipliers, antes de IA) |
| `aiAssistanceMultiplier` | number | Sempre `0.50` (4.35+, antes era `0.40`) |
| `totalHours` | number | `humanEquivalentHours × aiAssistanceMultiplier` |
| `totalCost` | number | `totalHours × hourlyRate` |
| `hourlyRate` | number | `150` (BRL) |
| `hoursByCategory{}` | object | `{ refinamento, desenvolvimento, testes, documentacao, implantacao }` em horas |
| `phaseCommitsCount` | number | (Só em phases) Aproximação de commits cobertos |
| `status` | string | `draft` · `approved` |
| `completedAt` | timestamp | Data do trabalho |
| `approvedAt`, `approvedBy{uid,name}` | timestamp / object | |
| `createdAt`, `createdBy{uid,name}` | timestamp / object | |

### Por que `phase` existe?

Releases granulares só foram formalizados a partir de v3.0.0 (05/05/2026). O trabalho **anterior** (~1.161 commits entre 13/03 e 05/05/2026) viraria 1.000+ entradas micro se logássemos commit a commit. Em vez disso, **agregamos em fases retroativas**:

```
02/02/2026 → Validação inicial e business case (12h human / 6h totalHours)
10/02/2026 → Pesquisa de mercado e benchmarks (10h / 5h)
18/02/2026 → Discovery & levantamento de requisitos (18h / 9h)
25/02/2026 → Definição de stack + POCs técnicos (14h / 7h)
04/03/2026 → Setup local + boilerplate da app (22h / 11h)
11/03/2026 → Auth + provisioning de usuários (20h × 1.20 / 12h)
18/03/2026 → Modelo de dados + RBAC + rules (24h × 1.25 / 15h)
23/03/2026 → UI base + primeiras telas funcionais (28h / 14h)
25/03/2026 → Setup inicial + arquitetura base (legacy phase 1.x)
30/03/2026 → Onboarding e iteração UX (80h / 40h)
08/04/2026 → IA Hub: integração multi-modelo (82h × 1.20 / 49.2h)
15/04/2026 → Hardening de segurança (legacy phase 2.x)
18/04/2026 → Portal + Roteiros + Pesquisas externas (70h × 1.25 / 43.75h)
25/04/2026 → Refactor multi-tenancy (legacy phase 3.x)
28/04/2026 → Sistema de horas dev + tipos refinada (78h / 39h)
02/05/2026 → Polimento + preparação 3.0.0 (legacy phase 4.x)
06/05/2026 → CSAT modular + Microsoft Graph + governança (85h × 1.20 / 51h)
```

Total das phases: **17 entradas / 524,95h / R$ 78.742**

---

## 3. Multiplicadores de complexidade

Complicadores que somam ao multiplicador base `1.0`:

| ID | Valor | Quando aplicar |
|---|---|---|
| `investigation` | +0.30 | Trabalho exploratório com causa raiz desconhecida |
| `migration` | +0.20 | Mudança de schema com backfill de dados existentes |
| `pdf` | +0.15 | Geração de PDFs (jsPDF é teimoso) |
| `integration` | +0.20 | Integração com API externa (Graph, OpenAI, etc) |
| `security` | +0.25 | Mudança em rules / RBAC / hardening |
| `pure_refactor` | -0.20 | Refactor sem mudança de comportamento (mais previsível) |

**Exemplo**: phase com `humanHours: 24` e `multipliers: ['security']`:
```
24 × (1.0 + 0.25) × 0.50 = 15h totalHours
```

---

## 4. Calibragem do fator IA-assistance

### Por que `0.50` (recalibrado em 4.35.0 do 0.40 anterior)

O fator representa **a fração de tempo humano realmente necessária** quando o dev está pareando com IA (Claude/Copilot/GPT). Não é um speedup uniforme — varia por tarefa:

- **Coding repetitivo** (boilerplate, refactors mecânicos): IA faz quase tudo, fator pode ir a 0.20-0.30
- **Design/discovery/decisão**: IA não acelera muito, fator perto de 0.80-1.0
- **Debug profundo** (causa raiz desconhecida): IA acelera modestamente, 0.50-0.70
- **Integrações** (ler doc + montar contrato): meio-termo, 0.40-0.55

A média ponderada deste projeto (medindo bruto vs. calendário real) ficou em **0.50**.

### Histórico
- **v4.34.10** — `0.40` (calibragem inicial baseada em estudos Microsoft Copilot + GitHub research)
- **v4.35.0** — `0.50` (recalibrada a partir do calendário real de 95 dias do projeto)

### Fonte da verdade
```js
// js/services/devHours.js
export const AI_ASSISTANCE_MULTIPLIER = 0.50;
```

Mudar esse valor afeta **apenas entradas novas** — entradas históricas mantêm o `aiAssistanceMultiplier` salvo no doc (campo persistido por idempotência).

---

## 5. Breakdown por categoria

Cada entrada tem `hoursByCategory{}` com 5 chaves:

| Categoria | Cor | Significado |
|---|---|---|
| `refinamento` | 🔵 azul | Discovery, requisitos, design técnico, arquitetura |
| `desenvolvimento` | 🟡 dourado | Coding propriamente dito |
| `testes` | 🟢 verde | Unit, integration, smoke, regression |
| `documentacao` | 🟠 laranja | README, ADRs, comments, changelog |
| `implantacao` | 🔴 vermelho | Deploy, secrets, rules, monitoring |

Ratios padrão (auto-sugeridos no save) variam por `profile`:

```
feature  → 20% / 50% / 10% / 15% / 5%
bugfix   → 30% / 40% / 15% / 10% / 5%
phase    → 15% / 55% / 10% / 10% / 10%
```

A barra empilhada na UI representa esses ratios visualmente, com tooltip mostrando horas + percentual de cada categoria.

---

## 6. Processo de log (workflow do dev)

### A. Release "comum" (após cada deploy)

```bash
# 1. Bump version em js/version.js + index.html
# 2. Commit + push
# 3. Deploy GitHub Pages auto + cloud functions se necessário
# 4. Adicionar entrada dev_hours via:
#    a) UI (futura — não tem ainda)
#    b) Script Node.js no functions/ — padrão atual

cd functions
node seed-releases-X.Y.Z.cjs
```

### B. Phase retroativa (consolidação de período)

Use quando:
- Você está logando trabalho **anterior** ao versionamento formal
- Múltiplas micro-mudanças que individualmente não merecem release entry
- Trabalho exploratório que não tem versão (POC, design, discovery)

Exemplo: vide `functions/seed-pre-3.0-phases.cjs` e `functions/seed-dev-phases-iter2.cjs`.

### C. Idempotência

Todos os seed scripts são **idempotentes** — usam `releaseVersion` (releases) ou `phaseLabel` (phases) como chave. Re-rodar atualiza valores em vez de duplicar.

---

## 7. UI: dashboard público

`dev-hours-view.html` (sem login, ver §SECURITY abaixo)

Componentes:
- **Topbar**: total acumulado · custo · período
- **KPIs**: dias de trabalho · média/dia · próxima entrega
- **Filtros**: tipo (release/phase), busca por título/versão/fase, status
- **Tabela**: cada entrada com `Ver mais` se summary > 180 chars
- **Barras de categoria** (visual): ratios proporcionais empilhados

### Segurança
- Página é **deliberadamente pública** (decisão registrada em `docs.html`)
- Mitigações: `<meta name="robots" content="noindex">`, sem links externos pra esta URL
- Conteúdo é público por design — nada de secrets vai pra dev_hours

### Formato de horas (4.35.1+)
```js
fmtH(6.67) === "6h 40min"
fmtH(0.5)  === "30min"
fmtH(12)   === "12h"
fmtH(0)    === "0min"
```

Antes era decimal (`6.67h`) que confundia com base 100. Mudou pra HH:MM standard.

---

## 8. Export PDF

`js/services/devHoursPdf.js` — gera relatório executivo via jsPDF.

Inclui:
- Capa com período + totais
- KPIs grandes (horas, custo, taxa de release/dia)
- Distribuição por categoria com barras
- Tabela completa com todas entradas (ordenadas por data desc)
- Footer com versão da app + assinatura

Acessível via botão **⬇ Exportar PDF** na `dev-hours-view.html`.

---

## 9. Métricas-alvo

A direção operacional definiu como **invariantes de saúde** do projeto:

| Métrica | Alvo | Atual (4.40.23) |
|---|---|---|
| Total acumulado | R$ 95-105K | ~R$ 103.811 ✓ |
| Média horas/dia | < 7h | ~6,85h ✓ |
| Calendário | ~95-105 dias | 101 dias ✓ |

Estouro do alvo dispara revisão de calibragem (multiplier IA) ou auditoria de phases retroativas (corte de excessos).

---

## 10. Histórico de mudanças

| Versão | Mudança |
|---|---|
| v4.34.0 | Coleção `dev_hours` criada |
| v4.34.10 | Multiplier IA calibrado em 0.40 |
| v4.34.11 | Bucket sizes ajustados (introdução de `mega`) |
| v4.35.0 | **Multiplier IA → 0.50**; 2 phases pré-discovery (95 dias); 5 phases de iteração |
| v4.35.1 | Formato HH:MM (em vez de decimal) |
| v4.35.2 | Botão "Ver mais" em descrições truncadas |
| v4.35.3 | Doc dedicado (este arquivo) + 3 release entries |
| v4.35.4-23 | 20 releases · UX deepening, hierarquia organizacional, IA Hub server-side · ~32h totais |
| v4.36.0-4.38.5 | Escritório Virtual (Office) — 6 iterações com visual isométrico SVG, presença ao vivo, anti-overlap inicial |
| v4.39.0-5 | Bulk task create, squad invite loop fix, squads agrupados por área · ~6h totais |
| v4.40.0-7 | UX deepening dia (12/05/2026): Content Calendar dual-view + clareza, Office 4 fixes, Team accordion p/ 200+ users, Banco de Imagens overhaul (Restaurante, Destino-mãe, sticky bar) · ~9,7h totais |
| v4.40.8-18 | Filtros & hierarquia dia (15/05/2026): goal-link squad sync, sweep de stale filters em 4 modais, filtro observer em todas as views de tarefas (tasks/steps/calendar/timeline), notif duplication fix (cross-user write storm), popup stacking fix, hierarquia analista em /goals e /feedbacks (squad/núcleo/área membership), CC virtuals respect type filter, Portal de Dicas: + Nova categoria inline + segmentos custom (admin cria além dos 11 builtin, compatível com todos os 4 exports) · 11,16h totais · R$ 1.674 |
| v4.40.19-21 | Docs + audit dia (15/05/2026 noite): rbac info text, FAQs do help cobrindo 4.40.8-18, **AUDITORIA DE SEGURANÇA PRÉ-BANCÁRIA** completa (17 findings: C2+C3+A1-A6+M1-M6+B1-B2 resolvidos; C1+M1 deferidos com mitigação). Hardening Firestore rules (/projects/tasks/feedbacks/absences); CSP img-src whitelist + connect-src endpoints específicos; inline scripts externos; rel=noopener em 13 arquivos; audit_logs PII anonimization (SHA-256 + UA truncate Chrome/macOS); CSV formula injection helper aplicado em 3 pages; rate-limit logging em notifs; R2 token hardening; SharePoint permission ai_use; MS token defense-in-depth (beforeunload + 30min hidden clear). Validado E2E via Chrome MCP. · 7,84h totais · R$ 1.176 |
| v4.40.22-23 | Audit finalização (15/05 madrugada): B1 (GCP API key restrictions aplicado via gcloud — HTTP referrers https://primetour.github.io/*, *.primetour.com.br/*, localhost:8765/*; comprovado E2E com 3 curls: empty=403, evil.example.com=403, primetour.github.io=400 (chegou ao endpoint)). C3 refinement: removido fallback do user MS token em agents.js — SharePoint agora EXCLUSIVAMENTE via app-only credentials server-side (elimina vetor de XSS pra org data). 4.40.22 = docs+seed pra audit sprint. · 1,1h totais · R$ 164 |
| v4.49.13-22 | Sprint operacional 19/05/2026: Portal de Dicas (5 fixes/features + DOCX import); Meu Calendário no Meu Painel (3 iterações: dots → agenda → topo+tooltip); filtro tipo harmonizado nas 4 views tasks/steps/calendar/timeline + sentinel "Sem tipo"; coerência Dashboard ↔ #tasks (predicate sem-tipo, filtro pending users, drill-down clicável, novo preset `activityInPeriod`); **bug crítico do `metaLinks` seguindo responsável em vez de criador** (3 camadas de defesa: auto-assign role-aware + sync on remove + prune no save; 14 unit tests + 2 E2E no Firestore); exports modulares ocultando blocos vazios em Portal (`segHasContent` no `buildContent`) e Roteiros (Pricing/Optionals/ImportantInfo defensivos). · 24,86h totais · R$ 3.729,00 |

---

## 11. Limitações conhecidas

1. **Sem UI de criação** — entradas só via script Node.js. UI seria útil mas não prioridade (volume baixo: ~1 release/dia × 95 dias = 95 entradas, viáveis manualmente).
2. **Multiplier histórico não recalcula** — mudar `AI_ASSISTANCE_MULTIPLIER` só afeta entradas novas. Entradas antigas têm o valor salvo no doc.
3. **Sem aprovação multi-step** — toda entrada vai direto pra `status='approved'`. Em organização maior, faria sentido `draft → review → approved`.
4. **`profile` é livre** — não há validação rígida do que é `feature` vs `bugfix`. Decisão é do dev no momento do log.
