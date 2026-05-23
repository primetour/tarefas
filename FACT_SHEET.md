# Gestor PRIMETOUR — Fact Sheet Comercial

**Plataforma de Gestao Operacional e Inteligencia de Negocios para Turismo**

---

## 1. Visao Geral

O PRIMETOUR e uma plataforma SaaS proprietaria de gestao operacional desenvolvida especificamente para o setor de turismo corporativo e de luxo. Unifica em um unico ambiente gestao de tarefas, CRM de roteiros com IA generativa e web search, portal de conteudo para clientes, hub de marketing multicanal, calendario editorial, editor de artes, automacoes inteligentes, analytics de performance e compliance LGPD — eliminando a necessidade de 10 a 15 ferramentas separadas.

| Metrica | Valor |
|---------|-------|
| Linhas de codigo (JS) | ~110.000 |
| Modulos funcionais | 55 paginas / 62 servicos / 19 componentes |
| Cloud Functions | 17 (callLLM, sendCsatEmail, pruneOldAuditLogs, dailyBackup, dailySecurityDigest, weeklySecretsAudit, etc.) |
| Collections Firestore | 42+ |
| Permissoes RBAC | 50+ granulares em 12 grupos |
| Paginas publicas | 6 (portal, CSAT, roteiros, solicitacoes, landing pages, calendario de conteudo) |
| Provedores de IA | 6 (Gemini, Groq, OpenAI, Anthropic Claude, Azure, Local/Ollama) |
| Modelos de IA | 22+ (Gemini 2.5, Llama 4, GPT-4.1, Claude Opus 4.7, Sonnet 4.6, etc.) |
| Acoes IA executaveis | 60+ integradas a todos os modulos |
| Module Hints IA | 24 modulos com prompts customizaveis |
| Integracao externa | 10+ (Firebase, Salesforce MC, Meta, GA4, Figma, GitHub, Slack, EmailJS, Serper.dev, Cloudflare R2) |

---

## 2. Arquitetura Tecnica

| Camada | Tecnologia |
|--------|-----------|
| Frontend | Vanilla JS ES6+ Modules (zero-framework, zero-build) |
| Backend | Firebase (Auth + Firestore + Cloud Functions + Storage) |
| IA | Multi-provider SDK com fallback automatico (6 providers, 22+ modelos) |
| IA Data Guard | Anonimizacao PII (LGPD/GDPR), consent management, provider filtering |
| IA Web Search | Serper.dev + Google CSE integrados para pesquisa em tempo real |
| Automacao | GitHub Actions (syncs diarios GA4, Marketing Cloud, Meta) + AI Automations |
| Exports | jsPDF + AutoTable, SheetJS (XLSX), PptxGenJS |
| File Parser | PDF.js, Mammoth (DOCX), SheetJS — processamento client-side |
| Email | Cloud Function `sendCsatEmail` (proxy server-side EmailJS, secrets via Secret Manager) |
| Seguranca server-side | App Check (reCAPTCHA Enterprise), Firebase Secret Manager, audit_logs com TTL 90 dias |
| CDN/Imagens | Cloudflare R2 + Workers (proxy de imagens) |
| Hospedagem | Firebase Hosting / GitHub Pages / qualquer CDN estatico |

**Diferenciais de arquitetura:**
- Zero dependencia de framework (sem React/Vue/Angular) — sem lock-in, manutencao minima
- Modular por design — cada pagina e um modulo ES6 independente
- Custo operacional ultra-baixo — Firebase free tier cobre ate ~50k users/dia
- Tempo de carregamento < 1s (sem bundle, sem build, ES modules nativos)
- IA com fallback automatico entre providers (ex: Groq excede limite → Gemini assume)
- LGPD nativo — anonimizacao de PII antes de enviar dados para IA

---

## 3. Modulos Funcionais

### 3.1 Gestao de Tarefas e Projetos
- **Kanban Board** com drag-and-drop, swimlanes por status/responsavel
- **Lista de tarefas** com 7 filtros simultaneos (projeto, status, prioridade, responsavel, setor, tipo, area)
- **Timeline/Gantt** com visualizacao temporal e dependencias
- **Calendario interativo** (mes/semana/dia) com 3 modos de visualizacao
- **Subtarefas** com checklist e progresso percentual
- **Campos dinamicos** por tipo de tarefa (formularios customizaveis)
- **SLA e etapas** — tipos de tarefa com workflow pre-definido e alertas
- **Projetos** com membership, progresso automatico e vinculacao de tarefas
- **Workspaces** isolados com sistema de convites por email
- **Tarefas recorrentes** com templates configuráveis
- **Nudge automatico** para tarefas estagnadas (staleTaskNudge)
- **Resumo diario** automatico por email (dailySummary)

### 3.2 Roteiros de Viagem (Modulo Exclusivo)
- **Editor completo** com 14 secoes (v4.49.88+): Cliente e Briefing (Cliente + Viagem + Datas + Destinos fundidos), Dia a Dia, Aereo e Hoteis (v4.49.91+), Valores, Opcionais, Inclui/Nao Inclui, Pagamento, Cancelamento, Informacoes Importantes, Imagens, Dicas anexas, Avancado, Preview & Export, Observacoes IA
- **Criacao completa via IA** — Sonnet 4.5 dedicado (`roteiros-luxo-gen`) com web_search nativo restrito a `virtuoso.com`, `americanexpress.com`, `lhw.com`
- **Schema briefing unificado** (v4.49.86+) — `client.{preferences, restrictions, economicProfile, notes}` substituiu bloco `briefing` separado (-164 linhas)
- **Voos no schema** (v4.49.91+) — `flights[]` com cia/voo/origem/destino/saida/chegada. Renderiza em PDF (AEREO), PPTX (slide), DOCX, e link publico
- **Auto-prefill de dicas** (v4.49.93+) — ao digitar pais nos destinos, dicas do Portal correspondentes sao snapshot-adas em `embeddedTips[]`
- **Datalist contextual** (v4.49.89+) — autocomplete de cidades filtra pelas cidades do pais digitado
- **Imagens auto-preview** (v4.49.93+) — thumbs renderizadas via cascata banco R2 → Unsplash → Wikipedia (mesmo path do PDF)
- **Progress overlay** (v4.49.94+) — chamada IA leva 60-120s, overlay full-screen com timer, phases rotativas e barra animada
- **Narrativas sensoriais** — IA escreve 200+ palavras/dia com aromas, texturas, nomes reais de restaurantes
- **Rastreio de fontes** — `aiGeneration{ sources[], citations[], queries[], inputTokens, outputTokens }` registra trilha de auditoria
- **Hoteis reais** — IA usa apenas hoteis dos programas Virtuoso/FHR/LHW (zero alucinacao garantida via system prompt)
- **Precos protegidos** — IA nunca inventa valores, `pricing.perPerson/perCouple` ficam null
- **Filtros listagem refeitos** (v4.49.97-99) — pills periodo dourado, filtros avancados sempre visiveis, periodo custom com inputs date inline (sem popup, auto-aplica on change)
- **Icones SVG na listagem** (v4.49.96-97) — Heroicons + tooltip CSS dark (substituiu chars unicode confusos ✎ ⧉ ↓ ⊠ ✕)
- **Export unificado** (v4.49.100) — todos os formatos (PDF/DOCX/PPTX/Web Link) ficam apenas na aba dedicada Preview & Export. Botão do header removido (era duplicado). Icone na listagem leva o user pra essa aba via `&section=preview` no hash.
- **Valores por categoria** (v4.49.101-102) — 5 blocos (Aéreo/Hotéis/Traslados/Experiências/Serviços adicionais) com N items por bloco. Cada item: descrição + fornecedor + valor + notas + flags `visibleToClient`/`supplierVisibleToClient`. Toggle "Como o cliente vê" (Total único / Subtotais por categoria). Real-time recalc dos subtotais + footer (interno x visível) sem rerender (preserva foco). Helpers `_buildServicesRows` aplicados em PDF/PPTX/DOCX/link público. `supplier` e `notes` (operacionais) nunca aparecem em export.
- **Auto-save 5s** (v4.49.103) — `markDirty` debounce 5s (era 30s) + retry silent em erro (10s, 5x). Indicador atualiza dinamicamente "Salvo há X seg/min". `saveInProgress` evita race condition entre auto-save e click manual.
- **Status workflow funcional** (v4.49.103) — pipeline `Rascunho → Em revisão → Enviado → Aprovado → Arquivado` com dropdown no header (substituiu badge estático). Cada status tem cor própria (cinza/azul/dourado/verde/cinza). Transições via `updateRoteiroStatus` com audit log embutido. Approved triggera `maybeOfferTaskGeneration` (Sprint 4 — geração de tasks operacionais).
- **Export multi-formato** — PDF (jspdf+autotable), PPTX (pptxgenjs), DOCX (docx 8.5)
- **Web links publicos** com contador de visualizacoes (`roteiro-view.html` standalone, sem auth)
- **Tarefas operacionais auto** (Sprint 4) — quando aprovado, gera tasks vinculadas via `roteiroTasks.generateOperationalTasksForRoteiro`
- **Dashboard de KPIs** — taxa de conversao, valor medio, top destinos, evolucao mensal
- **Fila assincrona pra 30+ usuarios simultaneos** (v4.49.109) — Cloud Function background `processRoteiroQueue` com lease pattern (transaction), maxInstances=5, concurrency=1. Client cria doc na fila, escuta via `onSnapshot`. Capacidade ~100 geracoes/min steady. Anthropic Tier 1 (50 req/min) sobra.
- **Chunking IA pra 20+ dias** (v4.49.108) — roteiros >14 dias ou >5 destinos geram em fases (skeleton + days chunks de 10). Prompt caching do system prompt economiza ~60% input. Garante zero truncamento.

### 3.2.1 Banco de Roteiros (v4.50.0+) — Curadoria PRIMETOUR
- **Modulo novo separado do Gerador** (#banco-roteiros) — roteiros curados da empresa (Classic Collection, Exclusive, Corporate) que servem como referencia manual pro consultor e base de conhecimento da IA (futuro v4.51+)
- **Import de PDF via Claude multimodal** — Cloud Function `importRoteiroBankPdf` envia PDF base64 como content block `type='document'` pro Sonnet 4.5. Extrai 14 secoes estruturadas em ~120s. Custo medio ~$0.15/PDF
- **Schema 14 secoes** — capa+identidade+validade+coleção, geografia (cidades multi-pais), dia-a-dia, categorias hospedagem com hotels+pricing por periodo, includes 7 buckets, excludes, pagamento, cancelamento escalado, documentacao+vistos por pais, notas viagem, imagens, source, tags
- **Validade pra controle de equipe** — `validity.endDate` dispara badge "Expirado" no card automaticamente (nao esconde)
- **Categorias estilo Classic Collection** — Sugestao Prime / Luxo / Luxo Standard / Luxo Moderado (defaults). User pode adicionar custom via `roteiro_bank_categories` collection
- **Alinhamento com Destinos** — `ensureDestination()` auto-vincula `portal_destinations` no save (cria se nao existe e user tem permissao)
- **Seed inicial 22/05/2026** — 2 PDFs Renê importados: China e Tibete (4 cidades, 3 cats), Peru Completo (6 cidades, 2 cats)
- **CRUD inline de categorias e coleções** (v4.50.1) — modal compacto no editor com edit/add/delete (defaults Classic/Exclusive/Corporate · Sugestão Prime/Luxo/Standard/Moderado bloqueados com 🔒). Sem listas hardcoded.
- **Thumb auto banco_imagens → Unsplash** (v4.50.1) — `resolveBankHero()` busca em portal_images por country+city, fallback Unsplash via CF com cache 90d. Listing aplica em background pra docs sem hero.
- **Filtro país cascata** (v4.50.1+hotfix v4.50.2) — select dinâmico de países sob continente ativo, reset auto.
- **Export PDF do banco** (v4.50.3, hotfix v4.50.5+v4.50.6) — ícone download em cada card, reusa pipeline visual do Gerador via `bankDocToRoteiroShape()`. Mesma capa, day-by-day, hotels, pricing, cancelamento, docs. Filename: `Banco-{titulo-slug}.pdf`. Hotfixes: guard granular do plugin jspdf-autotable + polling defensivo pós script.onload (race condition em libs UMD que estendem prototype).
- **Card mostra validade início + fim** (v4.50.7→v4.50.9) — bloco meta sempre visível com `validity.startDate` + `validity.endDate` do schema (não createdAt do doc). Fallback "Indefinida" quando vazio. Timezone-safe (parse manual de string ISO YYYY-MM-DD pra evitar `new Date()` UTC midnight bug).
- **AbortController por render() em SPA** (v4.50.10) — fix de listeners delegados duplicados (cada navegação ao banco adicionava +1 listener no container, multiplicando toasts/saves). Padrão obrigatório registrado em CLAUDE.md §12.k.
- **Logs IA Hub** (v4.50.1) — CFs processRoteiroQueue + importRoteiroBankPdf gravam `ai_usage_logs` com tokens + custo, auto-aparece nas abas Custos/Logs do aiHub.

### 3.3 Portal de Dicas (B2B Content Platform)
- **Hub unificado** com 3 abas internas: Gerar Material, Dicas Cadastradas, Importar Dicas
- **Gerador de materiais** personalizados por BU (Business Unit / marca)
- **Banco de imagens** com tagging, busca e organizacao por destino
- **Editor WYSIWYG** de dicas com versionamento
- **7 areas/marcas** configuradas (ICs, BTG Partners, BTG Ultrablue, Centurion, Lazer, Operadora, PTS Bradesco)
- **Export PDF/PPTX** com identidade visual por BU
- **Web links publicos** rastreaveis com termos de uso
- **Controle de validade** — alertas de dicas vencidas ou proximas do vencimento
- **Import em massa** via XLSX com mapeamento de campos
- **Dashboard analitico** — downloads, destinos mais acessados, uso por consultor

### 3.4 Hub de Marketing Multicanal
- **Calendario de Conteudo** — planejamento editorial com visualizacao Mes/Semana/Lista, 10 plataformas, 10 tipos de conteudo, workflow de 5 etapas (ideia → rascunho → revisao → aprovado → publicado), sugestao IA de conteudo semanal, geracao de descricao via IA, conversao direta de ideia em tarefa, pagina publica `calendario-conteudo.html` (read-only com filtros real-time)
- **Newsletters (Salesforce Marketing Cloud)** — sync automatico de metricas das 5 BUs (Primetour, BTG Partners, BTG Ultrablue, Centurion, PTS): disparos, entregas, aberturas, cliques, bounces. Aba "Conteudo & Temas" com enriquecimento deterministico (148 cidades + 51 paises + 50+ marcas hoteleiras), classificacao dupla Comercial × Turismo (4 × 9 categorias), modal "Ver arte" com preview, exports XLS/PDF/PPTX, classificador IA em shadow mode (Claude Haiku 4.5) com cutover/rollback gated por concordancia ≥90%
- **Instagram (Meta API)** — seguidores, alcance, engajamento, top posts
- **Google Analytics 4** — sessoes, pageviews, fontes de trafego, dispositivos, paises, paginas mais visitadas
- **Landing Pages** — builder com 5 layouts (destino, campanha, experiencia, multi-destino), CMS por secoes, links publicos com tracking
- **Editor de Artes** — canvas Fabric.js com 8 tamanhos (Instagram, Stories, LinkedIn, WhatsApp, Email, A4), 6 tipos de layer, 14 filtros, 20+ fontes, multi-setor
- **Monitor de Noticias** — clipping e curadoria com busca web IA, diferencia noticias do mercado vs mencoes da Primetour, export XLSX/PDF

### 3.5 Inteligencia Artificial Generativa
- **6 provedores** configurados: Google Gemini (free), Groq (free), OpenAI, Anthropic Claude, Microsoft Azure, Local/Ollama
- **22+ modelos** disponiveis: Gemini 2.5 Flash/Pro, Llama 4 Scout/Maverick, GPT-4.1, Claude Opus 4.7/Sonnet 4.6, Qwen 3, etc.
- **60+ acoes executaveis** — IA cria tarefas, roteiros, dicas, feedbacks, metas diretamente no sistema via blocos <<<ACTION>>>
- **24 module hints** — prompts customizaveis por modulo com UI de edicao, preview e reset (Firestore-backed com cache de 5 min)
- **Skills customizaveis** — admins criam prompts reutilizaveis por modulo
- **Knowledge Base** — documentacao customizada injetada no contexto da IA
- **Web Search** — Serper.dev + Google CSE para pesquisa em tempo real (noticias, hoteis, experiencias)
- **File Parser** — processamento client-side de PDF, DOCX, XLSX, CSV, TXT, JSON, imagens (ate 10MB)
- **Data Guard LGPD** — anonimizacao automatica de PII (email, CPF, telefone, passaporte), consent management com versionamento, politica de retencao configuravel, provider filtering por compliance
- **Automacoes IA** — 5 tipos (busca noticias, clipping, skills, relatorios, lembretes) com frequencia configuravel (manual a mensal)
- **Dashboard de custos** — monitoramento de tokens, custo estimado por provedor, uso por modulo
- **Fallback automatico** — se provider primario falha (limite de tokens, timeout), tenta proximo automaticamente
- **opts.provider/model/temperature/maxTokens** — override granular por chamada
- **Output estruturado** — texto, markdown, JSON, HTML

### 3.6 Gestao de Pessoas e Performance
- **Equipe** — disponibilidade mensal, calendario de ausencias (ferias, licenca, folga, atestado), visualizacao de capacidade
- **Metas por pilar** — KPIs com peso, avaliacao por gestor, progresso automatico, key results
- **Feedbacks** — registro estruturado (1:1, rotina, ad-hoc), dashboard, importacao, agendamento de ciclos, suporte audio/texto
- **CSAT** — pesquisas de satisfacao com envio por email via Cloud Function `sendCsatEmail` (proxy server-side EmailJS, secrets em Secret Manager), NPS Score, taxa de resposta, workflow (pending → sent → responded → expired)
- **Perfis de usuario** com bio, avatar, preferencias

### 3.7 Administracao e Compliance
- **RBAC granular** — 50+ permissoes em 12 grupos (sistema, workspace, tipos de tarefa, tarefas, projetos, dashboards, CSAT, metas, feedback, portal, roteiros, conteudo)
- **6 roles** hierarquicos: Master, Admin, Manager, Coordinator, Partner, Member
- **Auditoria completa** — log append-only de todas as acoes do sistema, com TTL de 90 dias (cron `pruneOldAuditLogs`); preserva `severity:critical`, `lgpd.*` e `security.*` mesmo apos retencao
- **App Check** ativo — reCAPTCHA Enterprise bloqueia uso do SDK fora do dominio autorizado
- **Backups diarios automaticos** — Cloud Function `dailyBackup` (cron 03:00 BRT), `dailySecurityDigest` (Slack 09:00 BRT), `weeklySecretsAudit` (cron domingo)
- **Setores e nucleos** — estrutura organizacional configuravel
- **Tipos de tarefa** — templates com campos customizados, SLA, categorias, variacoes
- **Configuracoes globais** — nome, notificacoes, migracoes de dados
- **Microsoft SSO** — auto-provisioning multi-dominio (@primetour.com.br, @primetravel.tur.br, @primetouroperator.com.br)
- **Reset de senha** seguro via Firebase Auth
- **LGPD nativo** — Data Guard com anonimizacao, consentimento, retencao de dados

### 3.8 Paginas Publicas (Sem Autenticacao Restrita)
- **Portal de Solicitacoes** (`solicitar.html`) — formulario publico para demandas externas
- **Resposta CSAT** (`csat-response.html`) — pesquisa de satisfacao via token
- **Visualizador de Dicas** (`portal-view.html`) — material de destino com branding
- **Visualizador de Roteiros** (`roteiro-view.html`) — roteiro completo para o cliente
- **Landing Pages** (`lp.html`) — paginas de campanha com metricas
- **Calendario de Conteudo** (`calendario-conteudo.html`) — visualizacao read-only do calendario editorial com filtros (conta, plataforma, categoria, busca) e atualizacao em tempo real (`onSnapshot`); exige login mas qualquer usuario autenticado acessa

---

## 4. Argumentos de Venda

### Para Agencias de Turismo (Segmento Primario)

**"Substitua 10-15 ferramentas por uma."**

| Ferramenta substituida | Custo mensal tipico (USD) |
|------------------------|--------------------------|
| Asana / Monday.com (tarefas) | $30-60/user |
| Canva Pro (artes) | $13/user |
| Salesforce CRM | $75-150/user |
| Mailchimp/HubSpot (marketing) | $50-300 |
| Google Workspace (docs/sheets) | $12/user |
| Power BI / Tableau (analytics) | $10-70/user |
| ChatGPT Teams / Claude Pro (IA) | $20-30/user |
| SurveyMonkey (CSAT) | $25-99 |
| Hootsuite / Buffer (social media) | $15-100 |
| Travefy / Tripbuilder (roteiros) | $25-49/user |
| Notion / Confluence (knowledge base) | $10-20/user |
| **Total estimado** | **$285-891/user/mes** |

**Proposta de valor central:**
1. **Modulo de Roteiros com IA generativa** — unica plataforma que gera roteiros comerciais completos via prompt livre, com web search em fontes luxury (Virtuoso, Conde Nast, etc.), narrativas sensoriais de 200+ palavras/dia, hoteis reais e export PDF profissional
2. **IA profundamente integrada** — nao e um chatbot generico; 60+ acoes executaveis criam tarefas, roteiros, dicas, feedbacks diretamente no sistema, com 24 modulos com prompts customizaveis
3. **6 provedores de IA sem lock-in** — troca de provedor com um clique, provedores gratuitos (Gemini, Groq, Ollama local) reduzem custo a zero, fallback automatico entre providers
4. **Multi-BU nativo** — uma unica instancia serve multiplas marcas/BUs com identidade visual propria
5. **LGPD nativo** — anonimizacao automatica de PII, consentimento versionado, opcao de IA local (Ollama) para dados sensiveis
6. **Calendario editorial completo** — 10 plataformas, workflow de 9 etapas, sugestao IA de conteudo semanal
7. **Portal publico integrado** — materiais de venda gerados internamente sao compartilhados com clientes via links rastreaveis
8. **Custo operacional near-zero** — Firebase free tier + static hosting = infraestrutura < $50/mes para ate 100 usuarios

### Para Empresas de Servicos (Segmento Secundario)

**"Task management com IA generativa e analytics de verdade."**

- Dashboard de produtividade com metricas reais (nao apenas contagem de tarefas)
- Pipeline de solicitacoes do portal publico ate a execucao
- RBAC enterprise-grade com 50+ permissoes e auditoria completa
- Feedbacks estruturados + Metas por KPI = gestao de performance integrada
- Integracao nativa com Figma, GitHub, Slack — conecta design, dev e operacoes
- IA que executa acoes (nao apenas sugere) — cria tarefas, atualiza projetos, gera relatorios
- Automacoes IA programaveis — busca noticias, monitora clipping, envia lembretes

---

## 5. Metricas de Complexidade

| Indicador | Valor (mai/2026) | Valor anterior (abr/2026) | Delta |
|-----------|-------------------|---------------------------|-------|
| Linhas de codigo JS (total) | ~110.000 | ~69.000 | +59% |
| Paginas/telas funcionais | 55 | 68 (contagem revista) | (consolidado) |
| Servicos backend | 62 | 45 | +38% |
| Componentes reutilizaveis | 19 | 13 | +46% |
| Cloud Functions | 17 | 8 (estimado) | +112% |
| Collections Firestore | 42+ | 55+ | (consolidado) |
| Permissoes RBAC | 50+ | 36 | +39% |
| Provedores de IA | 6 | 5 | +1 (Local/Ollama) |
| Modelos de IA | 22+ | ~12 | +83% |
| Acoes IA executaveis | 60+ | ~30 | +100% |
| Module Hints IA | 24 | 0 | NOVO |
| Automacoes IA | 5 tipos | 0 | NOVO |
| Data Guard LGPD | Completo | Parcial | NOVO |
| File Parser (client-side) | 7 formatos | 0 | NOVO |
| Web Search IA | Serper.dev + Google CSE | 0 | NOVO |
| Integracoes externas | 10+ APIs | 8+ | +25% |
| Paginas publicas | 6 | 5 | +1 (calendario) |
| Hardening de seguranca | Sprint 1+4+5 deployado (mai/2026) | parcial | NOVO |
| App Check | reCAPTCHA Enterprise ativo | 0 | NOVO |
| Audit log retention | TTL 90 dias com preservacao critical/lgpd/security | append-only sem TTL | NOVO |
| Tempo estimado de desenvolvimento | 4.500-7.000 horas | 3.500-5.500h | +28% |

### 5.1 Performance & Custo (wins de mai/2026)

| Otimizacao | Antes | Depois | Ganho |
|---|---|---|---|
| Heartbeat presence | 30s (2.880 writes/user/dia) | 2 min (720 writes/user/dia) | -75% writes |
| Cache `fetchUsers` | TTL 60s | TTL 5 min | -80% reads |
| Audit sampling em tasks | log em qualquer mudanca | skip em mudancas triviais | -40% audit writes |
| Lazy load `taskTypes` | carrega no boot | carrega on-demand | -50 reads/login |
| Paginacao configuravel | hardcoded | `js/components/pageSize.js` (10/20/50/100) | UX + custo |
| TTL audit_logs | sem expiracao | 90 dias com cron `pruneOldAuditLogs` | bounded storage |

---

## 6. Valoracao de Mercado (Atualizada — 04/05/2026)

### 6.1 Metodologia

A valoracao considera 4 abordagens complementares, atualizadas com o crescimento da plataforma desde a avaliacao anterior (13/04/2026). Os incrementos de maio/2026 sao majoritariamente de hardening (seguranca, performance, governanca) e expansao operacional (calendario publico, docs tecnicos formais), nao de novos modulos comerciais — mas elevam a maturidade enterprise da plataforma.

#### A) Custo de Reposicao (Cost-to-Recreate)

Premissas atualizadas:
- ~110.000 linhas de codigo JS (incluindo functions e ferramental), com ~80-90k de codigo de produto funcional, testado e integrado
- Complexidade elevada: IA multi-provider com fallback, LGPD/Data Guard, web search, 60+ acoes executaveis, file parser multi-formato, automacoes programaveis
- 55 paginas funcionais, 62 servicos, 19 componentes, 17 Cloud Functions
- Hardening enterprise: App Check (reCAPTCHA Enterprise), Secret Manager, audit_logs com TTL, backups diarios, security digest, secrets audit
- Taxa media: R$ 150-250/hora (Brasil) / $80-150/hora (internacional)
- Produtividade: 15-25 loc production-ready por hora

| Cenario | Horas estimadas | Custo (BRL) | Custo (USD) |
|---------|----------------|-------------|-------------|
| Conservador (dev senior BR, 25 loc/h em ~80k linhas produto) | 3.200h | R$ 480.000 | $84.000 |
| Realista (equipe mista, 20 loc/h + hardening + functions) | 4.500h | R$ 900.000 | $156.000 |
| Completo (equipe int'l, design+QA+AI+SecOps) | 7.000h | R$ 1.750.000 | $305.000 |

**Custo de reposicao estimado: R$ 900.000 - R$ 1.750.000**

> Nota: o cenario "Completo" agora inclui expertise em IA generativa (prompt engineering, multi-provider, Data Guard LGPD), que exige profissionais especializados com taxa mais alta.

#### B) Comparaveis de Mercado (SaaS Multiples)

| Produto | Funcionalidades | Preco/user/mes |
|---------|----------------|----------------|
| TravelPerk (gestao de viagens) | Viagens + expense | $39-99 |
| Travefy (roteiros) | Roteiros + CRM | $25-49 |
| Monday.com (tarefas + IA) | Kanban + timeline + AI | $24-48 |
| HubSpot Starter (marketing) | Email + CRM + analytics | $50-180 |
| Jasper AI (IA para marketing) | Conteudo + templates | $39-99/user |
| Hootsuite (social media) | Calendario + analytics | $99-249 |

O PRIMETOUR combina funcionalidades de TODOS esses em um unico sistema, com verticalizacao para turismo.

**Precificacao sugerida: R$ 129-249/user/mes** (reposicionado para refletir IA generativa integrada)

Para uma base de 50 usuarios:
- MRR: R$ 6.450 - R$ 12.450
- ARR: R$ 77.400 - R$ 149.400
- Valuation SaaS (5-8x ARR early-stage): **R$ 387.000 - R$ 1.195.200**

#### C) Valoracao por Modulo (Asset-Based)

| Modulo | Valor abr/2026 | Valor mai/2026 | Delta |
|--------|---------------|-----------------|-------|
| Core (tarefas, projetos, kanban, calendario, timeline, recorrentes) | R$ 140.000 | R$ 145.000 | +4% |
| RBAC + Auditoria + Users + SSO multi-dominio + App Check + Secret Manager + audit TTL | R$ 75.000 | R$ 120.000 | +60% |
| Portal de Dicas (hub unificado, gerador, editor, banco imagens, dashboard) | R$ 110.000 | R$ 110.000 | = |
| Roteiros de Viagem (IA generativa, web search, narrativas, PDF, fontes, dashboard) | R$ 200.000 | R$ 200.000 | = |
| Hub Marketing (Newsletters, Meta, GA4, Landing Pages, CMS, Artes, News) | R$ 170.000 | R$ 170.000 | = |
| Calendario de Conteudo (10 plataformas, 5 etapas, sugestao IA, conversao em tarefa, pagina publica read-only) | R$ 80.000 | R$ 95.000 | +19% |
| IA Generativa (6 providers, 60+ acoes, 24 hints, skills, automacoes, web search, file parser) | R$ 180.000 | R$ 180.000 | = |
| Data Guard LGPD (anonimizacao, consent, retencao, provider filtering) | R$ 50.000 | R$ 55.000 | +10% |
| Gestao de Pessoas (equipe, metas, feedbacks, CSAT via Cloud Function, capacidade) | R$ 80.000 | R$ 85.000 | +6% |
| Workspaces + Solicitacoes + Notificacoes + SLA Alerts | R$ 50.000 | R$ 50.000 | = |
| Paginas publicas (6 viewers/portais — incluindo calendario read-only com real-time) | R$ 35.000 | R$ 45.000 | +29% |
| Automacoes (GitHub Actions, AI Automations, daily summary, nudge, dailyBackup, dailySecurityDigest, weeklySecretsAudit, pruneOldAuditLogs) | R$ 45.000 | R$ 70.000 | +56% |
| Design System (CSS, componentes, responsivo, dark theme) | R$ 35.000 | R$ 35.000 | = |
| Documentacao tecnica formal (Onboarding, Architecture, Contributing, Performance, Security pentest) | — | R$ 30.000 | NOVO |
| **Total** | **R$ 1.250.000** | **R$ 1.390.000** | **+11%** |

#### D) Valor Estrategico (Strategic Value)

Fatores que amplificam o valor alem do codigo:

- **IP de IA vertical**: sistema de IA com 60+ acoes executaveis, 24 module hints, web search, Data Guard LGPD — nao e um wrapper de ChatGPT, e IA profundamente integrada ao dominio de turismo
- **Multi-provider com fallback**: zero dependencia de um unico vendor de IA, opcao local (Ollama) para dados sensiveis — diferencial critico pos-regulamentacao IA (AI Act, LGPD)
- **Integracao vertical completa**: substitui 10-15 ferramentas — custo de troca (switching cost) altissimo
- **Dados acumulados**: 42+ collections com dados historicos de operacao, analytics e inteligencia de mercado
- **Time-to-market**: pronto para uso imediato vs. 18-24 meses de desenvolvimento (aumento pela complexidade de IA)
- **Barreira de entrada tecnica**: IA multi-provider com Data Guard + 60 acoes + web search + file parser = 12-18 meses so para replicar a camada de IA
- **Compliance by design**: LGPD/GDPR nativo desde a arquitetura, nao como add-on — valor crescente com regulamentacao

---

### 6.2 Faixa de Valoracao Consolidada

| Cenario | Valor (BRL) | Valor (USD) | Variacao vs 13/04 |
|---------|-------------|-------------|---------------------|
| Piso (custo de reposicao conservador) | R$ 480.000 | $84.000 | +16% |
| Base (custo realista + IP + hardening) | R$ 900.000 | $156.000 | +20% |
| Medio (valoracao por modulo) | R$ 1.390.000 | $242.000 | +11% |
| Teto (estrategico + IA + dados + compliance + hardening enterprise) | R$ 2.000.000 | $350.000 | +11% |

### **Valor justo de mercado estimado: R$ 1.000.000 - R$ 1.550.000**

> **Evolucao mai/2026**: De R$ 900k-1.4M (13/04) para R$ 1.0M-1.55M (04/05) — **aumento de 11%** em 21 dias. Diferentemente da escalada de abril (que veio de novos modulos comerciais), os ganhos de maio sao de **maturidade enterprise**:
> 1. Hardening de seguranca: Sprint 1+4+5 deployado, App Check, Secret Manager para todas as keys, multi-dominio SSO
> 2. Governanca de dados: audit_logs com TTL 90d (compliance LGPD/SOX), backups diarios, secrets audit semanal
> 3. Performance wins: heartbeat -75% writes, audit sampling -40% writes, cache fetchUsers 5x mais longo
> 4. Pagina publica do calendario editorial (read-only com real-time)
> 5. Documentacao tecnica formal (Onboarding, Architecture, Contributing, Performance) + audit pentest 2026-05-03
> 6. Reducao de divida tecnica: helpers consolidados (escape.js, logger.js), CSAT migrado pra Cloud Function (eliminou secrets no client)

> **Nota sobre SaaS**: Esses valores consideram o software como ativo de propriedade intelectual (IP asset). Em um cenario de licenciamento SaaS para multiplas agencias, o valor potencial e significativamente maior:
> - Base conservadora: 30 agencias × 20 usuarios × R$ 149/user/mes = ARR R$ 1.07M
> - Valuation SaaS (5-8x ARR early-stage): **R$ 5.4M - R$ 8.6M**
> - Com metricas de crescimento comprovadas (MoM >10%): **R$ 10M+**

---

## 7. Diferencial Competitivo (Moat)

| Fator | Descricao |
|-------|-----------|
| **Vertical Lock** | Unica plataforma que combina task management + roteiros com IA + portal de conteudo por BU + calendario editorial |
| **IA Profunda** | 60+ acoes executaveis integradas, nao apenas chat — IA que EXECUTA, nao apenas sugere |
| **Multi-AI** | 6 provedores com fallback automatico + opcao local (Ollama) — zero vendor lock-in |
| **LGPD Nativo** | Data Guard com anonimizacao PII, consent management, provider filtering — compliance by design |
| **Web Search IA** | Roteiros enriquecidos com pesquisa real-time em fontes de turismo luxury via Serper.dev |
| **Zero-Framework** | Sem dependencia de React/Vue = sem breaking changes, sem migration debt, vida util de 10+ anos |
| **Multi-BU** | Identidade visual por marca em todos os exports — necessidade critica de operadoras multi-bandeira |
| **Custo operacional** | Firebase Spark (free tier) + GitHub Pages estatico + Cloudflare R2 — infra ainda dentro do free tier ate ~50 usuarios ativos diarios; migracao para Blaze ~$5-60/mes para volumes maiores |
| **24 Module Hints** | Cada modulo tem prompt IA customizavel pela UI — ajuste fino sem codigo |
| **Dados proprietarios** | 42+ collections com inteligencia operacional acumulada — impossivel de replicar |

---

## 8. Roadmap Sugerido (Expansao Comercial)

| Fase | Feature | Impacto no valor |
|------|---------|-----------------|
| 1 | App mobile (PWA) | +20% — acesso em campo para consultores |
| 2 | Modulo financeiro (comissoes, faturamento) | +30% — completa o ciclo operacional |
| 3 | White-label para revenda B2B | +50% — transforma em plataforma |
| 4 | API publica + Webhooks | +25% — ecossistema de integracoes |
| 5 | Multi-tenant com isolamento de dados | +40% — escala para SaaS multi-empresa |
| 6 | IA com voz (Whisper/STT) | +15% — input por voz para consultores em campo |
| 7 | Modulo de comissoes por roteiro aprovado | +20% — conecta vendas a compensacao |

---

*Documento atualizado em 04/05/2026 com base na analise completa do codebase V11 + sprints de hardening de seguranca de maio/2026.*
*~110.000 linhas JS | 55 paginas | 62 servicos | 19 componentes | 17 Cloud Functions | 42+ collections | 10+ integracoes | 6 provedores de IA | 22+ modelos | 60+ acoes IA | 24 module hints | LGPD nativo | App Check + Secret Manager | audit pentest 2026-05-03*
