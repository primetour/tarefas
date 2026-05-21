# Shadow Mode — Classificador IA de Newsletters

Playbook completo para ativar, monitorar, fazer cutover e reverter
o agente `nl-content-classifier` (Claude Haiku 4.5) que classifica
disparos de newsletter nos eixos Comercial × Turismo.

**Status atual**: shadow mode operacional. Cutover gated por concordância
≥ 90% em ambos eixos + revisão humana das divergências.

**Componentes 100% funcionais** (v4.49.42+):
- `scripts/classify-content-ai.js` — classifica em shadow (campos `ai*`)
- `scripts/promote-ai-to-prod.js` — cutover (ai → produção, com backup)
- `scripts/rollback-ai-classification.js` — reverte cutover
- `.github/workflows/classify-content-ai.yml` — cron diário 06:45 UTC
- `.github/workflows/promote-ai-to-prod.yml` — manual com confirmação
- `.github/workflows/rollback-ai-classification.yml` — manual com confirmação
- Dashboard NL → Conteúdo & Temas → bloco "Classificador IA — Shadow mode"
  com sparkline, KPIs, divergências, decisões humanas, painel admin

## Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│  IA Hub (Firestore: ai_agents)                              │
│  - Agente nl-content-classifier (single source of truth)    │
│  - systemPrompt, model, temperature, active flag            │
└─────────────────────┬───────────────────────────────────────┘
                      │ lido por
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  scripts/classify-content-ai.js                             │
│  - Lê agente do Firestore                                   │
│  - Se !active → exit 0 (kill switch soft)                   │
│  - Itera mc_performance, monta payload, chama Anthropic    │
│  - Grava extracted.aiCommercial/aiTourism/...               │
│  - Grava resumo em nl_ai_classifier_runs                    │
└─────────────────────┬───────────────────────────────────────┘
                      │ disparado por
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  .github/workflows/classify-content-ai.yml                  │
│  - Cron 06:45 UTC diário (15min após classify-content.js)  │
│  - workflow_dispatch com flags dry/force/limit/verbose     │
└─────────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────┐
│  Dashboard NL → Conteúdo & Temas → bloco Shadow mode IA    │
│  - Concordância % por eixo (vs regex)                       │
│  - Distribuição de confiança                                │
│  - Tabelas de divergências top                              │
│  - Playbook de cutover inline                               │
└─────────────────────────────────────────────────────────────┘
```

## Princípios

1. **Não-destrutivo**: o script NUNCA toca em `extracted.commercial` ou
   `extracted.tourism` (campos de produção, populados pelo regex de
   `classify-content.js`). Só grava em campos paralelos `extracted.ai*`.

2. **Kill switch soft**: pausar o agente no IA Hub (`active=false`)
   desliga o cron sem precisar mexer no workflow.

3. **Idempotente**: re-rodar não reclassifica docs já processados pela
   mesma versão de agente. Versão = hash de `model + systemPrompt`.
   Editar o prompt no IA Hub invalida e força reclassificação.

4. **Single source of truth**: o systemPrompt vive no Firestore (editável
   pelo IA Hub). Código não tem prompt hardcoded.

## Setup inicial

### 1. Configurar secrets

```bash
# No GitHub Secrets do repositório (Settings → Secrets and variables → Actions):
ANTHROPIC_API_KEY = sk-ant-...
FIREBASE_PROJECT_ID = gestor-de-tarefas-primetour
FIREBASE_CLIENT_EMAIL = <service-account email>
FIREBASE_PRIVATE_KEY = <PEM completo, com \n>
```

Os 3 secrets do Firebase já existem (usados por `mc-sync.yml`,
`enrich-content.yml`, etc.). Só o `ANTHROPIC_API_KEY` é novo.

### 2. Criar o agente no Firestore

Depois do deploy de v4.49.39+ chegar no GitHub Pages:

1. Logar como master
2. IA Hub → aba **Agentes**
3. Clicar **"Recriar agentes-seed"** (no painel de admin)
4. Confirmar que apareceu o card "Classificador de Newsletters"
   marcado como ⏸ pausado (cor laranja)

### 3. (Opcional) Teste manual antes do cron

No GitHub → Actions → workflow "Classify Newsletter Content via AI Agent" →
**Run workflow** com:
- `dry`: true (não grava)
- `limit`: 5
- `verbose`: true

Inspeciona o log. Se OK, rode sem dry + sem limit.

**Atenção**: enquanto o agente estiver `active=false` no IA Hub, o script
sai imediatamente. Pra rodar precisa ativar primeiro.

## Ativação (passo a passo)

### Etapa 1 — Ativar o agente no IA Hub
```
IA Hub → Agentes → Classificador de Newsletters → ▶ Ativar
```
Status do card vira ativo (sem chip laranja).

### Etapa 2 — Primeira corrida (manual)
```
GitHub Actions → Classify Newsletter Content via AI Agent → Run workflow
  dry: false
  limit: 50         # cauteloso na primeira
  verbose: true
```

Inspeciona o log do step. Espera:
- ~50 classificações
- 0 erros (ou < 5%)
- Concordância com regex > 80% em ambos eixos

### Etapa 3 — Cron toma conta
A partir daqui o cron diário das 06:45 UTC processa os docs novos
automaticamente. Cada doc é classificado UMA vez (idempotente).

### Etapa 4 — Monitorar via dashboard
Newsletter → Conteúdo & Temas → bloco "🤖 Classificador IA — Shadow mode"

Acompanha por 1-2 semanas:
- Concordância Comercial deve estabilizar ≥ 90%
- Concordância Turismo idem
- Inspecionar as **divergências top** — entender se a IA está
  acertando ONDE o regex falha (caso comum) ou errando (raro)

## Cutover (substituir regex pela IA)

### Critérios pra promover (todos devem bater)

- [ ] Concordância em AMBOS eixos ≥ 90% por 2 corridas consecutivas
      (visível no sparkline do bloco shadow mode no dashboard)
- [ ] Divergências analisadas — clicar "IA certa" ou "regex certo" em
      pelo menos 80% das divergências top, e taxa de "IA certa" ≥ 70%
- [ ] Custo médio aceitável (consultar `nl_ai_classifier_runs.costUsd` —
      esperado < US$ 0,02 por corrida com cache hit ~95%)
- [ ] Renê aprovou explicitamente

### Como fazer o cutover (1ª vez)

**Via UI** (recomendado):
1. Dashboard NL → Conteúdo & Temas → bloco shadow mode → botão
   "⬆ Promover IA → Produção"
2. Abre a página do GitHub Actions
3. Clicar "Run workflow"
4. Inputs:
   - `dry`: **true** (1ª passagem — sempre dry primeiro)
   - `confidence`: `medium` (não promove docs com confiança `low`)
   - `eixo`: `both` (promove ambos eixos juntos)
   - `confirmar`: `PROMOVER` (literal, defesa contra clique acidental)
5. Inspecionar o log — confere quantos docs mudariam, amostra das mudanças
6. Repetir com `dry`: **false** se OK

**Via CLI** (alternativa):
```bash
cd scripts
ANTHROPIC_API_KEY=sk-ant-... \
FIREBASE_PROJECT_ID=... FIREBASE_CLIENT_EMAIL=... FIREBASE_PRIVATE_KEY=... \
node promote-ai-to-prod.js --dry --confidence=medium --only-eixo=both
# revisar output, depois rodar sem --dry
```

### O que o promote faz

Pra cada doc em `mc_performance` onde:
- `extracted.aiCommercial` e `aiTourism` existem
- `extracted.aiConfidence !== 'low'` (configurável via `--confidence=`)
- `extracted.commercialPromotedAt` NÃO existe (idempotente)

Grava:
- `extracted.commercialPrev` ← `extracted.commercial` (BACKUP do regex)
- `extracted.tourismPrev`    ← `extracted.tourism`
- `extracted.commercial`     ← `extracted.aiCommercial` (promoção)
- `extracted.tourism`        ← `extracted.aiTourism`
- `extracted.commercialSource` ← `'ai-' + aiAgentVersion`
- `extracted.commercialPromotedAt` ← ISO timestamp
- `extracted.promotedFromConfidence` ← `aiConfidence`

E grava 1 doc em `nl_classifier_promotions` com o resumo.

### Pós-cutover

Depois do primeiro cutover bem-sucedido:
1. Remover o step `Classify (commercial/tourism)` de `enrich-content.yml`
   (regex não roda mais — só a IA)
2. Renomear `classify-content.js` → `classify-content-legacy.js` (mantém pra rollback de emergência)
3. O bloco shadow mode no dashboard continua útil pra novos docs (o regex
   gravado em `commercialPrev` permite manter o KPI de concordância)

## Rollback (reverter cutover)

Se identificar regressão (categoria errada generalizada, dashboard
mostrando números esquisitos):

**Via UI**:
1. Dashboard NL → bloco shadow mode → botão "⏪ Reverter cutover"
2. Abre GitHub Actions → "Rollback AI Classification"
3. Inputs:
   - `dry`: **true** primeiro
   - `since`: vazio (reverter TODOS) OU ISO date pra reverter só recentes
   - `confirmar`: `REVERTER`
4. Inspecionar log → repetir com `dry: false`

**Via CLI**:
```bash
cd scripts
node rollback-ai-classification.js --dry
# revisar, depois sem --dry
```

### O que o rollback faz

Pra cada doc com `extracted.commercialPromotedAt`:
- `commercial` ← `commercialPrev` (restaura regex)
- `tourism`    ← `tourismPrev`
- apaga: `commercialPrev`, `tourismPrev`, `commercialPromotedAt`,
  `promotedFromConfidence`, `commercialSource`
- **mantém**: todos os campos `ai*` (shadow mode permanece — só a
  promoção foi revertida)

⚠️ **Aviso temporal**: se passou >24h desde o cutover, novos docs
podem ter sido classificados SÓ pela IA (sem regex no `commercialPrev`).
O rollback pula esses docs e loga `missingBackup`. Recomendado: se for
reverter depois de 24h, rodar o regex `classify-content.js` antes pra
ter um baseline.

## Cost cap automático

O script `classify-content-ai.js` checa o budget diário antes de rodar:
- Lê todos os runs do dia em `nl_ai_classifier_runs`
- Soma o custo estimado (com tabela de preços por modelo)
- Compara com `agent.limits.maxCostPerDayUsd` (default US$ 2)
- Se já estourou → exit 2 (operacional, não falha o workflow)

Pra aumentar o cap: IA Hub → editar agente → campo "Custo máximo diário".

## Custo estimado

Claude Haiku 4.5 (preço público em maio/2026):
- Input: $0.25 / 1M tokens
- Output: $1.25 / 1M tokens
- Cache read: $0.025 / 1M tokens (90% off do input)

Por doc:
- System prompt: ~7k tokens (cacheado após 1ª chamada)
- Payload usuário: ~1-2k tokens
- Output: ~150 tokens (JSON curto)

Primeira corrida (50 docs): ~$0.005 (custo de criação do cache)
Corridas subsequentes: cache hit em ~95% dos tokens de input
- 10 docs/dia × 30 dias = 300 chamadas/mês
- Custo: < $0.50/mês

O `maxCostPerDayUsd: 2` definido no agente é teto generoso. Cap real
está em escala de centavos.

## Troubleshooting

### "Agente nl-content-classifier não encontrado em ai_agents"
→ Você não rodou "Recriar agentes-seed" no IA Hub.

### Script sai com `⏸ Agente está PAUSADO no IA Hub`
→ Comportamento esperado quando `active=false`. Pra rodar, ative no Hub.

### Erro 429 Anthropic
→ Rate limit. O script faz 3 tentativas com backoff exponencial. Se
persistir, reduzir `concurrency` em `processInChunks(items, 3, ...)`
para 1 ou 2.

### Concordância < 70% persistente
→ Provável: prompt do agente precisa refinamento. Editar via IA Hub
(o hash muda → reclassifica histórico no próximo cron). Não editar
no código (a fonte é Firestore).

### Aumento súbito de erros de parse JSON
→ O LLM começou a retornar markdown ou texto extra. O parser `parseClaudeJson`
já lida com fences `\`\`\`json`. Se houver outro padrão, ajustar regex
de extração.

## Schema de dados gravados

### Em cada doc `mc_performance` (campo `extracted`):
```js
{
  // ... campos existentes (commercial, tourism, cities, etc.) ...
  aiCommercial:        'sazonal' | 'promocao' | 'parceiro' | 'inspiracional',
  aiTourism:           'evento' | 'aereo' | ... | 'outros',
  aiConfidence:        'high' | 'medium' | 'low',
  aiReasoning:         string,    // 1-2 frases citando gatilho
  aiModel:             string,    // ex: 'claude-haiku-4-5'
  aiAgentVersion:      string,    // hash do (model + prompt)
  aiClassifiedAt:      ISO string,
  aiAgreesCommercial:  bool,      // aiCommercial === commercial
  aiAgreesTourism:     bool,      // aiTourism === tourism
}
```

### Em `nl_ai_classifier_runs` (1 doc por execução):
```js
{
  runAt:                  timestamp,
  agentId:                string,
  agentVersion:           string,
  model:                  string,
  classified:             number,
  errors:                 number,
  elapsedMs:              number,
  inputTokens:            number,
  cacheReadTokens:        number,
  outputTokens:           number,
  agreesCommercial:       number,
  agreesTourism:          number,
  agreesBoth:             number,
  concordanceCommercialPct: number,
  concordanceTourismPct:    number,
  concordanceBothPct:       number,
  commercialDist:         { sazonal, promocao, parceiro, inspiracional },
  tourismDist:            { evento, aereo, ... },
  confDist:               { high, medium, low },
  disagreementsCommercialSample: [{ subject, name, regex, ai, confidence, reasoning }],
  disagreementsTourismSample:    [{ ... }],
  triggeredBy:            string,  // 'github-actions:<runId>' | 'local'
}
```

Esta collection é a fonte pra qualquer dashboard de "evolução temporal
da concordância" no futuro.
