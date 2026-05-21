# Contributing — Gestor PRIMETOUR

> Convenções e workflow pra contribuir no codebase. Leia ARCHITECTURE.md antes pra contexto.

## Workflow de feature

```
1. Pull main: git checkout main && git pull
2. Branch: git checkout -b feat/short-description
3. Edit + test local (servidor estático em :8765)
4. Commit (Conventional Commits — ver abaixo)
5. Push: git push -u origin feat/short-description
6. PR no GitHub → review → merge
7. Deploy automático via GitHub Pages (~60s)
```

> ⚠ Sem CI/CD ainda — testes correm manualmente. Validar in-browser **antes** do PR.

## Convenções de código

### Naming

| O que | Padrão | Exemplo |
|---|---|---|
| Variáveis e funções | `camelCase` | `fetchUsers`, `userId` |
| Componentes (classes) | `PascalCase` | `class Header` |
| Constantes globais | `UPPER_SNAKE` | `ALLOWED_SSO_DOMAINS`, `CACHE_TTL` |
| Arquivos JS | `camelCase.js` ou `kebab-case.js` | `userResolver.js`, `task-modal.js` |
| Pastas | `lowercase` | `js/services/`, `js/util/` |
| Coleções Firestore | `snake_case_plural` | `users`, `audit_logs`, `csat_surveys` |
| Doc IDs Firestore | `auto` (Firebase) ou `pending_*` quando custom | — |

### Estrutura de arquivos

```
/* ─── PRIMETOUR — Module Name ─── */

import { ... } from '...';

// Constants
const CACHE_TTL = 5 * 60 * 1000;

// State (se aplicável)
let _state = null;

// Helpers privados (não exportados)
function _helperLocal() {}

// API pública
export async function publicFunction() {}
export const publicConst = ...;
```

### Comentários

- **Use comentários "por quê", não "o quê"**: o código mostra o que; explique decisões.
- **JSDoc em APIs públicas (services/util)**: tipo de params + return + side-effects.
- **Comentários inline em seções complexas**: lógica não óbvia precisa de 2-3 linhas explicando o motivo.

```js
// ❌ Ruim
function loadUsers() {
  // pega users
  const users = await getDocs(...);
}

// ✅ Bom
/**
 * Lista todos users (com cache TTL 5min).
 * Importante: snapshot global em initAuthObserver já mantém store.users
 * em tempo real — fetchUsers é fallback redundante quando o cache miss.
 */
async function fetchUsers({ active = false, force = false } = {}) {
  // ...
}
```

### Async/await consistente

- ✅ `async/await` em qualquer função que faz I/O
- ❌ Misturar `.then()` com `await` no mesmo bloco
- ✅ `Promise.all()` em loops paralelos (NUNCA `for + await`)
- ✅ `try/catch` com mensagens informativas (não engolir erros silenciosamente)

```js
// ❌ Ruim — N+1 sequencial
for (const id of ids) {
  const doc = await getDoc(...);
}

// ✅ Bom — paralelo
const docs = await Promise.all(ids.map(id => getDoc(...)));
```

### Error handling

- ✅ **Sempre informar contexto**: `logger.warn('[csat]', 'failed to send', err.message)`
- ✅ **Não engolir erros silenciosamente** — pelo menos `logger.warn`
- ✅ **Usuário final vê toast amigável**: `toast.error('Falha ao salvar tarefa.')`
- ❌ NUNCA: `try { ... } catch {}` sem log

### State management

- **Use `store.set/get/subscribe`** pra estado compartilhado
- **NUNCA** mute `store._state` direto (use sempre `store.set`)
- **Estados locais** (modal aberto, aba ativa) ficam em closures de páginas/components
- **Estado derivado** (filtros aplicados, etc) calcula on-render — não armazene

### Renderização

- **`innerHTML` com input de user → SEMPRE `escHtml()`**:
  ```js
  import { escHtml } from '../util/escape.js';
  container.innerHTML = `<div>${escHtml(user.name)}</div>`;
  ```
- **Re-render é OK** se o cálculo é barato — não otimize prematuramente
- **Cleanup de listeners** em destroy (`addEventListener` → guarde refs e `removeEventListener`)

### XSS protection

- **Tudo que vem de user input (name, description, etc)** → `escHtml()`
- **URLs em `href`/`src`** → `safeUrl()`
- **CSP no index.html** já bloqueia inline scripts + eval — não desabilitar
- **Audit periódico**: `grep "innerHTML" js/**/*.js | grep -v "esc"` mostra suspeitos

### Logging

- **NUNCA** `console.log` em produção. Use `logger.*`:
  ```js
  import { logger } from '../util/logger.js';

  logger.debug('[scope]', 'mensagem', { meta }); // só dev
  logger.info('[scope]', 'evento');               // só dev
  logger.warn('[scope]', 'problema', err);        // sempre + audit
  logger.error('[scope]', 'erro crítico', err);   // sempre + audit
  ```

## Convenções de commit (Conventional Commits)

```
<type>(<scope>): <descrição curta>

<body opcional explicando o porquê>

<footer com refs/issues>
```

Tipos:
- `feat`: nova feature
- `fix`: bug fix
- `refactor`: mudança de código sem alterar comportamento
- `perf`: otimização de performance
- `docs`: só documentação
- `test`: só testes
- `chore`: manutenção (deps, build, etc)
- `security`: fix de segurança

Exemplos:
```
feat(squads): modal unificado de membros (atuais + adicionar)

PROBLEMA: o modal de Membros (◉) só mostrava membros atuais com botão
remover. Pra ADICIONAR tinha que usar botão separado "+ Convidar".
UX confusa — 2 modais pra um único conceito.

REFATOR — modal único com tabs:
1. Tab "Membros atuais" — botões remover (✕) + promover (⬆⬇)
2. Tab "+ Adicionar" — search inline + botão "+ Adicionar"
```

```
fix(audit): listener leak causando travamento do browser

ROOT CAUSE: wirePageSizePicker mantinha Set<callback> que ACUMULAVA
cada chamada. Cada renderPagination → +1 callback. Loop exponencial
ao mudar valor.

FIX: trocar Set por Map<scope, callback> singular.
```

## Convenções de testes

> **Status atual**: Sem coverage automática. Testar manualmente in-browser ANTES de cada PR.

### Smoke test mínimo antes de PR

1. Hard reload (`Cmd+Shift+R`) na rota afetada
2. Console limpo (sem errors em vermelho)
3. Network sem 4xx/5xx fora do esperado
4. Operação principal funciona end-to-end

### Testes de Firestore Rules

```bash
firebase emulators:exec --only firestore "node tests/firestore-rules.test.mjs"
```

Adicionar testes em `tests/` quando mexer em rules.

### Pendente: tests automatizados

- [ ] Vitest pra services (mock Firestore)
- [ ] Playwright pra E2E
- [ ] GitHub Actions pra CI
- [ ] Coverage threshold

Vide `docs/ARCHITECTURE.md` débitos técnicos.

## Cloud Functions

Cada nova function deve:

1. **Auth**: `requireAuth(request)` no início
2. **Rate limit**: `checkRateLimit(uid, key, max, window)` em ações que escalam
3. **Validar input**: `if (!param) throw new HttpsError('invalid-argument', '...')`
4. **Audit log** server-side em ações críticas
5. **Secrets via Secret Manager**: `defineSecret('XXX')` + `secrets: [XXX]` no manifest
6. **CORS explícito**: `cors: ['https://primetour.github.io', 'http://localhost:5000']`

Padrão de exemplo em `functions/index.js callLLM`.

## Scripts CI (`scripts/` + `.github/workflows/`)

Cada novo script de sync/automação batch deve seguir o padrão consolidado em
v4.49.41+ (referência: `scripts/classify-content-ai.js`):

1. **Auth Admin SDK dual**: detectar env vars CI (`FIREBASE_PROJECT_ID` +
   `FIREBASE_CLIENT_EMAIL`) → usa cert; senão usa ADC (`gcloud auth
   application-default login`) pra dev local
2. **Gate `IS_CLI`**: `const IS_CLI = require.main === module;` — quando
   o módulo é require'd por testes, NÃO inicializa Firebase nem roda
   `main`. Só exporta helpers puros
3. **Flags CLI consistentes**: `--dry`, `--force`, `--limit=N`, `--verbose`
4. **Kill switch via Firestore**: se o script depende de um agente IA,
   ler `ai_agents.<seedId>` e respeitar `agent.active === false` →
   `process.exit(0)` (pausa sem mexer no workflow)
5. **Cost cap diário**: se chama LLM externo, ler audit collection do dia,
   somar custo estimado, comparar com `agent.limits.maxCostPerDayUsd`,
   `exit 2` se estourou (operacional, não falha)
6. **Idempotência**: usar hash determinístico (model + prompt) como
   "versão"; skip docs já processados pela mesma versão
7. **Audit per-item em `ai_usage_logs`**: formato compatível com Cloud
   Function `callLLM` (mesmo dashboard de custos agrega ambos)
8. **Resumo da run em collection própria**: ex: `nl_ai_classifier_runs`,
   com stats + samples de divergência + custo total
9. **Exit codes semânticos**: 0=OK, 1=erro fatal, 2=budget estourado,
   3=erros parciais >20% (workflow distingue operacional de bug)
10. **Test harness mínimo** `<script>.test.js`: cobre funções puras
    (parsing, validação, filtros) — workflow CI roda **ANTES** da chamada
    externa real (falha rápido sem queimar tokens)

### Workflow GitHub Actions correspondente

Cada workflow novo deve ter:

1. **`permissions: contents: read`** explícito (least-privilege —
   GITHUB_TOKEN default herda write permissions perigosamente)
2. **`concurrency:` lock** (`group: <unique-id>`, `cancel-in-progress: false`)
   — previne 2 runs simultâneos
3. **Inputs como env vars, NÃO interpolação bash direta**:
   ```yaml
   env:
     INPUT_SINCE: ${{ github.event.inputs.since }}
   run: |
     set -euo pipefail
     # Allowlist validation antes de passar ao node:
     if [[ ! "$INPUT_SINCE" =~ ^[0-9]{4}-... ]]; then exit 1; fi
     node script.js --since="$INPUT_SINCE"
   ```
   ⚠ Interpolação `${{ github.event.inputs.X }}` direto em bash =
   **shell injection vulnerability** (exfiltração de secrets). Sempre
   passar via env + validar allowlist.
4. **Workflows destrutivos manuais** (promote/rollback/purge): exigir
   confirmação literal via input:
   ```yaml
   inputs:
     confirmar:
       description: 'Digite "PROMOVER" pra confirmar'
       required: true
       type: string
   ```
   E checar no primeiro step antes de qualquer ação.
5. **Smoke tests ANTES da chamada externa cara**: rodar `node *.test.js`
   antes de invocar Anthropic/OpenAI/etc. Falha rápido sem custo.

Workflow de referência: `.github/workflows/classify-content-ai.yml` +
`promote-ai-to-prod.yml` + `rollback-ai-classification.yml`.

## Padrões a evitar

| ❌ Anti-padrão | ✅ Em vez disso |
|---|---|
| `innerHTML` direto com input user | `escHtml(...)` |
| `console.log` em prod | `logger.debug/info/warn/error` |
| `for + await` em I/O | `Promise.all(...)` |
| `try { ... } catch {}` sem log | `try { ... } catch (e) { logger.warn(...) }` |
| Função > 200 linhas | Quebrar em sub-funções |
| Service tocando DOM | Service só I/O, component só UI |
| Duplicar helper em vários arquivos | Extrair pra `util/` |
| Hardcoded secret no client | Cloud Function + Secret Manager |
| `getDoc` em loop sem batch | `Promise.all` ou query |

## Cache busting

Mudanças em JS críticos: **bump `?v=...`** no `index.html`:

```html
<script type="module" src="js/app.js?v=20260504opt2"></script>
```

Convenção: `YYYYMMDDdescritor` (ex: `20260504sso`, `20260504audit`).

## Deploy seguro

1. **Front (GitHub Pages)**: `git push origin main` — propaga em ~60s
2. **Cloud Functions**: testar local primeiro com emulator se possível
   ```bash
   firebase deploy --only functions:nameOfFunction
   ```
3. **Firestore Rules**: revisar diff cuidadosamente
   ```bash
   firebase deploy --only firestore:rules
   ```
4. **Após qualquer deploy crítico**: hard reload + smoke test in-browser

> ⚠ **NUNCA** commitar secrets, .env, serviceAccount.json. `.gitignore` cobre, mas verificar antes de push.

## Referências rápidas

- [README.md](../README.md) — quickstart
- [docs/ARCHITECTURE.md](./ARCHITECTURE.md) — visão técnica
- [docs/PERFORMANCE.md](./PERFORMANCE.md) — custos + otimizações
- [DATA-MODEL.md](../DATA-MODEL.md) — schema Firestore
- [ACCESS-CONTROL.md](../ACCESS-CONTROL.md) — RBAC
- [SECURITY.md](../SECURITY.md) — threat model
- [INFRA.md](../INFRA.md) — infraestrutura prod

## Quem mantém

Time PRIMETOUR. Bugs críticos → ver `INCIDENT-RESPONSE.md`.
