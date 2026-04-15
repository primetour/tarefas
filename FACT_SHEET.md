# PRIMETOUR — Fact Sheet Comercial

**Plataforma de Gestao Operacional e Inteligencia de Negocios para Turismo**

---

## 1. Visao Geral

O PRIMETOUR e uma plataforma SaaS proprietaria de gestao operacional desenvolvida especificamente para o setor de turismo corporativo e de luxo. Unifica em um unico ambiente gestao de tarefas, CRM de roteiros com IA generativa e web search, portal de conteudo para clientes, hub de marketing multicanal, calendario editorial, editor de artes, automacoes inteligentes, analytics de performance e compliance LGPD — eliminando a necessidade de 10 a 15 ferramentas separadas.

| Metrica | Valor |
|---------|-------|
| Linhas de codigo | ~69.000 |
| Modulos funcionais | 68 paginas / 45 servicos / 13 componentes |
| Collections Firestore | 42+ |
| Permissoes RBAC | 50+ granulares em 12 grupos |
| Paginas publicas | 5 (portal, CSAT, roteiros, solicitacoes, landing pages) |
| Provedores de IA | 6 (Gemini, Groq, OpenAI, Anthropic Claude, Azure, Local/Ollama) |
| Modelos de IA | 22+ (Gemini 2.5, Llama 4, GPT-4.1, Claude Opus 4.6, etc.) |
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
| Email | EmailJS + Cloud Functions |
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
- **Editor completo** com 11 secoes: Cliente, Viagem, Dia a Dia, Hoteis, Valores, Opcionais, Inclui/Nao Inclui, Pagamento, Cancelamento, Informacoes Importantes, Preview & Export
- **Criacao completa via IA** — prompt em texto livre gera roteiro comercial inteiro com narrativas imersivas
- **Web Search integrado** — IA pesquisa hoteis e experiencias via Serper.dev em fontes de turismo de luxo
- **Narrativas sensoriais** — IA escreve 200+ palavras/dia com aromas, texturas, nomes reais de restaurantes
- **Rastreio de fontes** — campo `aiSources` registra URLs consultadas pela IA (backoffice)
- **Hoteis reais** — IA usa apenas hoteis que existem (Four Seasons, Aman, Belmond, etc.)
- **Precos protegidos** — IA nunca inventa valores, todos os campos de preco retornam null
- **Perfil de cliente** detalhado (tipo, preferencias, restricoes, perfil economico)
- **Seletor de destinos** integrado ao Portal de Dicas
- **Export PDF profissional** — layout de apresentacao comercial com auto-save
- **Web links publicos** com contador de visualizacoes
- **Pipeline de vendas** (Rascunho → Em revisao → Enviado → Aprovado → Arquivado)
- **Dashboard de KPIs** — taxa de conversao, valor medio, top destinos, evolucao mensal
- **Fallback de provider** — se Groq excede limite, tenta Gemini automaticamente
- **Module Hints customizaveis** — ajuste fino do prompt de geracao via UI (Prompts por Modulo)

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
- **Calendario de Conteudo** — planejamento editorial com visualizacao Mes/Semana/Lista, 10 plataformas, 10 tipos de conteudo, workflow de 9 etapas (ideia → publicado), sugestao IA de conteudo semanal e captions
- **Newsletters (Salesforce Marketing Cloud)** — sync automatico de metricas: disparos, entregas, aberturas, cliques, bounces
- **Instagram (Meta API)** — seguidores, alcance, engajamento, top posts
- **Google Analytics 4** — sessoes, pageviews, fontes de trafego, dispositivos, paises, paginas mais visitadas
- **Landing Pages** — builder com 5 layouts (destino, campanha, experiencia, multi-destino), CMS por secoes, links publicos com tracking
- **Editor de Artes** — canvas Fabric.js com 8 tamanhos (Instagram, Stories, LinkedIn, WhatsApp, Email, A4), 6 tipos de layer, 14 filtros, 20+ fontes, multi-setor
- **Monitor de Noticias** — clipping e curadoria com busca web IA, diferencia noticias do mercado vs mencoes da Primetour, export XLSX/PDF

### 3.5 Inteligencia Artificial Generativa
- **6 provedores** configurados: Google Gemini (free), Groq (free), OpenAI, Anthropic Claude, Microsoft Azure, Local/Ollama
- **22+ modelos** disponiveis: Gemini 2.5 Flash/Pro, Llama 4 Scout/Maverick, GPT-4.1, Claude Opus 4.6/Sonnet 4.6, Qwen 3, etc.
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
- **CSAT** — pesquisas de satisfacao com envio por email (EmailJS + Cloud Functions), NPS Score, taxa de resposta, workflow (pending → sent → responded → expired)
- **Perfis de usuario** com bio, avatar, preferencias

### 3.7 Administracao e Compliance
- **RBAC granular** — 50+ permissoes em 12 grupos (sistema, workspace, tipos de tarefa, tarefas, projetos, dashboards, CSAT, metas, feedback, portal, roteiros, conteudo)
- **6 roles** hierarquicos: Master, Admin, Manager, Coordinator, Partner, Member
- **Auditoria completa** — log imutavel de todas as acoes do sistema
- **Setores e nucleos** — estrutura organizacional configuravel
- **Tipos de tarefa** — templates com campos customizados, SLA, categorias, variacoes
- **Configuracoes globais** — nome, notificacoes, migracoes de dados
- **Microsoft SSO** — auto-provisioning para @primetour.com.br
- **Reset de senha** seguro via Firebase Auth
- **LGPD nativo** — Data Guard com anonimizacao, consentimento, retencao de dados

### 3.8 Paginas Publicas (Sem Autenticacao)
- **Portal de Solicitacoes** (`solicitar.html`) — formulario publico para demandas externas
- **Resposta CSAT** (`csat-response.html`) — pesquisa de satisfacao via token
- **Visualizador de Dicas** (`portal-view.html`) — material de destino com branding
- **Visualizador de Roteiros** (`roteiro-view.html`) — roteiro completo para o cliente
- **Landing Pages** (`lp.html`) — paginas de campanha com metricas

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

| Indicador | Valor (abr/2026) | Valor anterior (abr/2026) | Delta |
|-----------|-------------------|---------------------------|-------|
| Linhas de codigo JS | ~69.000 | ~58.000 | +19% |
| Paginas/telas funcionais | 68 | 47 | +45% |
| Servicos backend | 45 | 24 | +88% |
| Componentes reutilizaveis | 13 | 10 | +30% |
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
| Integrações externas | 10+ APIs | 8+ | +25% |
| Paginas publicas | 5 | 5 | = |
| Tempo estimado de desenvolvimento | 3.500-5.500 horas | 2.500-4.000h | +40% |

---

## 6. Valoracao de Mercado (Atualizada — 13/04/2026)

### 6.1 Metodologia

A valoracao considera 4 abordagens complementares, atualizadas com o crescimento significativo da plataforma desde a avaliacao anterior (04/04/2026).

#### A) Custo de Reposicao (Cost-to-Recreate)

Premissas atualizadas:
- ~69.000 linhas de codigo funcional, testado e integrado (+19% vs anterior)
- Complexidade elevada: IA multi-provider com fallback, LGPD/Data Guard, web search, 60+ acoes executaveis, file parser multi-formato, automacoes programaveis
- 68 paginas funcionais (+45%) e 45 servicos (+88%)
- Taxa media: R$ 150-250/hora (Brasil) / $80-150/hora (internacional)
- Produtividade: 15-25 loc production-ready por hora

| Cenario | Horas estimadas | Custo (BRL) | Custo (USD) |
|---------|----------------|-------------|-------------|
| Conservador (dev senior BR, 25 loc/h) | 2.760h | R$ 414.000 | $72.000 |
| Realista (equipe mista, 20 loc/h) | 3.450h | R$ 690.000 | $120.000 |
| Completo (equipe int'l, design+QA+AI) | 5.500h | R$ 1.375.000 | $240.000 |

**Custo de reposicao estimado: R$ 690.000 - R$ 1.375.000**

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

| Modulo | Valor anterior | Valor atualizado | Delta |
|--------|---------------|-----------------|-------|
| Core (tarefas, projetos, kanban, calendario, timeline, recorrentes) | R$ 120.000 | R$ 140.000 | +17% |
| RBAC + Auditoria + Users + SSO | R$ 60.000 | R$ 75.000 | +25% |
| Portal de Dicas (hub unificado, gerador, editor, banco imagens, dashboard) | R$ 100.000 | R$ 110.000 | +10% |
| Roteiros de Viagem (IA generativa, web search, narrativas, PDF, fontes, dashboard) | R$ 120.000 | R$ 200.000 | +67% |
| Hub Marketing (Newsletters, Meta, GA4, Landing Pages, CMS, Artes, News) | R$ 150.000 | R$ 170.000 | +13% |
| Calendario de Conteudo (10 plataformas, 9 etapas, sugestao IA) | — | R$ 80.000 | NOVO |
| IA Generativa (6 providers, 60+ acoes, 24 hints, skills, automacoes, web search, file parser) | R$ 80.000 | R$ 180.000 | +125% |
| Data Guard LGPD (anonimizacao, consent, retencao, provider filtering) | — | R$ 50.000 | NOVO |
| Gestao de Pessoas (equipe, metas, feedbacks, CSAT, capacidade) | R$ 70.000 | R$ 80.000 | +14% |
| Workspaces + Solicitacoes + Notificacoes + SLA Alerts | R$ 40.000 | R$ 50.000 | +25% |
| Paginas publicas (5 viewers/portais) | R$ 30.000 | R$ 35.000 | +17% |
| Automacoes (GitHub Actions, AI Automations, daily summary, nudge) | R$ 20.000 | R$ 45.000 | +125% |
| Design System (CSS, componentes, responsivo, dark theme) | R$ 30.000 | R$ 35.000 | +17% |
| **Total** | **R$ 820.000** | **R$ 1.250.000** | **+52%** |

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

| Cenario | Valor (BRL) | Valor (USD) | Variacao vs anterior |
|---------|-------------|-------------|---------------------|
| Piso (custo de reposicao conservador) | R$ 415.000 | $72.000 | +19% |
| Base (custo realista + IP) | R$ 750.000 | $130.000 | +25% |
| Medio (valoracao por modulo) | R$ 1.250.000 | $218.000 | +52% |
| Teto (estrategico + IA + dados + compliance) | R$ 1.800.000 | $315.000 | +50% |

### **Valor justo de mercado estimado: R$ 900.000 - R$ 1.400.000**

> **Evolucao**: De R$ 600k-900k (04/04) para R$ 900k-1.4M (13/04) — **aumento de 50-56%** em 9 dias, impulsionado principalmente por:
> 1. IA generativa de roteiros com web search (+67% no modulo)
> 2. Camada completa de IA (6 providers, 60+ acoes, 24 hints, automacoes, Data Guard) — modulo mais que dobrou (+125%)
> 3. Calendario de Conteudo completo (modulo novo: +R$ 80k)
> 4. LGPD Data Guard (modulo novo: +R$ 50k)
> 5. Automacoes IA programaveis (+125%)

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
| **Custo operacional** | Firebase free tier + static hosting = infraestrutura < R$ 250/mes para operacao completa |
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

*Documento atualizado em 13/04/2026 com base na analise completa do codebase V11.*
*~69.000 linhas de codigo | 68 modulos | 45 servicos | 42+ collections | 10+ integracoes | 6 provedores de IA | 22+ modelos | 60+ acoes IA | 24 module hints | LGPD nativo*
