# Fase 3 — Sugerir/Revisar com IA nos campos do form (CONCLUÍDA com mock)

> Data: 2026-05-18 · Commit: `99cbff5` · Decisão: Opção E aplicada (mock em staging)

## Objetivo
Reproduzir as features de IA do BTG Next.js (`/api/ai/sugerir` e `/api/ai/revisar`) dentro do form vanilla do Gestor, **usando a Cloud Function `callLLM` do Gestor** em vez do `@anthropic-ai/sdk` direto. Ganho: prompt caching (~70-90% economia), rate limit centralizado, cost cap diário, audit log em `ai_usage_logs`.

## Blocker e decisão

A Cloud Function `callLLM` tem **as mesmas 4 amarras** do `getR2UploadUrl`:
1. CORS aceita só `primetour.github.io` + `localhost:5000`
2. Deployada só no projeto produção (`gestor-de-tarefas-primetour`)
3. Auth cross-project incompatível
4. Functions exigem plano Blaze (staging é Spark)

Aplicada a mesma **Opção E** da Fase 2.1 — em staging usa **mocks** com textos plausíveis por campo. Em produção (`partners.primetour.com.br` etc.), plugado automaticamente baseado em hostname.

## Arquitetura

```
[Form pergunta "Descrição"]
   ↓
[Botão "Sugerir com IA"] (renderizado quando opts.aiField presente)
   ↓ click
[handler em bindFormEvents]
   ↓
[btg-ai.js: sugerir({ field, values })]
   ↓
  ┌─ isStaging() === true ────┐
  │  Retorna mock com delay   │
  │  600ms                    │
  └───────────────────────────┘
  ┌─ isStaging() === false ───┐
  │  buildSugerirPrompt()     │
  │  callLLM() via Functions  │
  │  cacheControl: ephemeral  │
  └───────────────────────────┘
   ↓
[confirm() se já há texto]
   ↓
[store.set(field, result.text)]
[triggerRerender()]
```

## Campos com IA
Os 6 do `AI_FIELDS`:
- `nome_da_oferta` (curto, atraente, até 90 chars)
- `descricao` (2-3 frases, 280 chars, tom sofisticado)
- `oferta_especial` (selo até 40 chars, ex: "KIDS FREE")
- `incluso_no_pacote` (4-7 itens, 1 por linha)
- `beneficios_marca` (3-5 benefícios da marca, 1 por linha)
- `condicoes_observacoes` (2-4 condições, 1 por linha)

## Detecção staging vs produção

`btg/shared/btg-ai.js:isStaging()`:
- `true` se hostname é `gestor-btg-lp-builder-staging.web.app`, `localhost` ou `127.0.0.1`.
- `false` em qualquer outro caso (produção).

## Pra plugar produção
1. Adicionar domínios finais ao CORS de `callLLM` em `functions/index.js`:
   ```js
   cors: [
     'https://primetour.github.io',
     'https://partners.primetour.com.br',
     'https://ultrablue.primetour.com.br',
     'https://operadora.primetour.com.br',
   ],
   ```
2. Redeploy: `firebase deploy --only functions:callLLM` (na conta de produção).
3. Em `btg-ai.js:callLLMReal()`, preencher `PROD_CONFIG` com a config Firebase do projeto produção (apiKey, etc. — análogo a btg-config.js mas pra prod).
4. Usuário precisa estar autenticado via Firebase Auth do projeto prod (SSO Microsoft existente).
5. Validar custos via `ai_usage_logs` no Firestore prod.

## Estilo dos mocks
Textos plausíveis e específicos por campo (não lorem ipsum), com indicador visual `(mock — staging)` na barra de status pro user saber que não foi IA real. Permite validar UX completa sem custo.

## Arquivos
| Path | Linhas | Função |
|---|---|---|
| `btg/shared/btg-ai-prompts.js` | ~110 | Port dos prompts pt-BR + `buildContextFromStore`. |
| `btg/shared/btg-ai.js` | ~140 | Cliente abstrato com mocks staging + chamada real prod. |
| `btg/shared/btg-ai.css` | ~80 | Estilos dos botões e barra de status. |
| `btg/shared/form/form-inputs.js` (mod) | +60 | Wrapper `btg-input-wrap` + handler `data-ai-action`. |
| `btg/shared/form/questions-by-type.js` (mod) | 6 linhas | `aiField` adicionado em 6 questions. |
