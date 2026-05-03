# Gestor PRIMETOUR — Prompt Caching

> Atualizado: 2026-05-03
> Compliance/Eficiência: redução de custo IA de 47-90% no input

## O que é

**Prompt caching** é uma técnica suportada pelos provedores de LLM onde o **system prompt** (instruções fixas do agente) é armazenado em um cache do lado do provider. Em chamadas subsequentes que reutilizam o mesmo system prompt, o provider cobra apenas uma fração do custo normal — economia de 50% a 90% no input.

## Por que importa

Cenário típico de um agente PRIMETOUR:

```
SYSTEM PROMPT (estável, repetido):
  - Instruções gerais (1500 tokens)
  - Skills do agente (2000 tokens)
  - Knowledge SharePoint contextual (5000 tokens)
  TOTAL: ~8500 tokens repetidos a cada chamada

USER MESSAGE (variável):
  ~50 tokens

OUTPUT:
  ~500 tokens
```

Sem cache, paga-se input cheio em todas as chamadas — 8500 tokens × N chamadas.

Com cache, paga-se input cheio apenas na **primeira** chamada (cache write), e ~10-50% nas subsequentes (cache read).

## Como funciona em cada provider

### Anthropic Claude — Explícito (implementado)

```js
// functions/index.js — callAnthropic
const useCache = systemPrompt && systemPrompt.length >= 1024;
const systemField = useCache
  ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
  : systemPrompt;
```

**Custos**:
- Cache write: 1.25× preço normal (uma vez)
- Cache read: 0.1× preço normal (90% desconto)
- TTL: 5 minutos (default `ephemeral`), renova a cada hit

**Mínimo**: 1024 tokens (Sonnet/Opus) ou 2048 (Haiku). System prompts menores não cacheiam.

**Response inclui**:
- `usage.cache_creation_input_tokens` — tokens escritos no cache
- `usage.cache_read_input_tokens` — tokens lidos do cache

### OpenAI — Implícito (passive logging)

A partir de **gpt-4o-2024-12-17** (e gpt-4o-mini correspondente), OpenAI cacheia automaticamente prompts > 1024 tokens. Sem código necessário — funciona sozinho se a API key for usada.

**Custos**: 50% de desconto nos tokens cached.

**Response inclui**:
- `usage.prompt_tokens_details.cached_tokens` — quantos tokens vieram do cache

### Gemini — Não implementado

Context Caching da Gemini exige API explícita (`cachedContents.create()` + referência por nome). Mais complexo, vale apenas para knowledge base > 32k tokens. Fora de escopo no estado atual.

### Groq — Não suporta

Groq não tem feature de prompt caching.

## Schema de logs

Coleção `ai_usage_logs` (TTL 90 dias):

| Campo | Descrição |
|-------|-----------|
| `inputTokens` | Tokens de input não-cached |
| `outputTokens` | Tokens de output |
| `cacheCreationTokens` | Tokens escritos no cache (1ª chamada com novo system prompt) |
| `cacheReadTokens` | Tokens lidos do cache (chamadas subsequentes) |
| `tokensSaved` | Estimativa = `cacheReadTokens × 0.7` (70% economia média conservadora) |
| `cacheHit` | `true` se chamada usou cache (cacheReadTokens > 0) |

**Backward compat**: entries antigas sem esses campos continuam funcionando — código sempre lê com `Number(x.tokensSaved || 0)`.

## SIEM Digest diário

`dailySecurityDigest` agora reporta a economia de cache nas últimas 24h:

```
*PRIMETOUR · Security Digest 24h* (risk=0 | INFO)
> Logins: 12 | IP novo: 0 | Custo IA: $4.32 | Bulk deletes: 0
> 💾 Prompt Caching: 87 hits · 412.500 tokens economizados (~$1.24)
```

Stats salvos em `audit_logs/{id}.stats`:
- `aiCacheHits` — número de chamadas que usaram cache
- `aiTokensSaved` — soma total
- `aiSavingsUsd` — estimativa USD economizado

## Quando NÃO usar prompt caching

1. **System prompt curto** (< 1024 chars / tokens) — não atinge mínimo Anthropic, código pula automaticamente.
2. **System prompt mudando a cada chamada** — cache write 1.25× custaria mais que economia.
3. **Frequência baixa** (< 1 chamada / 5min com mesmo prompt) — TTL ephemeral expira antes de reuso.

Em casos 2-3, o sistema cobra cache write extra sem benefício. O código atual ativa cache pra **todo** system prompt ≥ 1024 chars — se virar problema, podemos adicionar flag `disableCache` no agente.

## Estimativa de economia

### Cenário 1: agente baixo volume (50 chamadas/mês)

```
System prompt: 8500 tokens
Provider: Anthropic Sonnet 4 ($3/1M input)

SEM CACHE:
  50 × 8500 × $3/1M = $1.28/mês

COM CACHE (1ª miss + 49 hits, mas TTL 5min, hit-rate ~30%):
  Write: 8500 × $3.75/1M × 35 = $1.12 (35 misses por TTL expiry)
  Read:  8500 × $0.30/1M × 15 = $0.04
  Total: $1.16/mês

ECONOMIA: 9% (modesta — TTL curto + baixa frequência)
```

### Cenário 2: agente alto volume (1000 chamadas/mês)

```
System prompt: 8500 tokens
1000 chamadas/mês = ~33/dia, alguns picos

SEM CACHE:
  1000 × 8500 × $3/1M = $25.50/mês

COM CACHE (~85% hit-rate):
  Write: 8500 × $3.75/1M × 150 = $4.78
  Read:  8500 × $0.30/1M × 850 = $2.17
  Total: $6.95/mês

ECONOMIA: 73% ($18.55/mês)
```

### Cenário 3: produção 10 agentes ativos

```
10 agentes × 500 chamadas/mês × 8500 tokens × $3/1M = $127.50/mês
Com cache (~70% hit médio): ~$45/mês
ECONOMIA: $82.50/mês ($990/ano)
```

## Configuração necessária

Apenas **configurar as API keys** dos provedores:

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY --project=gestor-de-tarefas-primetour
firebase functions:secrets:set OPENAI_API_KEY --project=gestor-de-tarefas-primetour
firebase deploy --only functions:callLLM
```

A partir desse ponto, **toda chamada via callLLM** com system prompt ≥ 1024 chars vai cachear automaticamente. Sem mudanças no código dos agentes.

## Auditoria

Pra ver economia em tempo real:

```js
// Console DevTools (auth user master/admin):
const fb = await import('./js/firebase.js');
const { collection, query, where, getDocs } =
  await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
const since = new Date(Date.now() - 24*3600000);
const snap = await getDocs(query(
  collection(fb.db, 'ai_usage_logs'),
  where('timestamp', '>=', since),
  where('cacheHit', '==', true)
));
let saved = 0;
snap.forEach(d => saved += d.data().tokensSaved || 0);
console.log('Tokens economizados últimas 24h:', saved, '(~$' + (saved/1e6 * 3).toFixed(4) + ')');
```

## Versionamento

- **v1.0** (2026-05-03): primeira versão. Anthropic cache_control + OpenAI passive logging + SIEM digest aggregation.
- Owner: Rene Castro

## Referências externas

- [Anthropic Prompt Caching Docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching)
- [OpenAI Prompt Caching Announcement](https://openai.com/index/api-prompt-caching/)
- [Gemini Context Caching](https://ai.google.dev/gemini-api/docs/caching)
