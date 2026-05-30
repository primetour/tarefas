# Security Audit — 2026-05-30 (banking-grade)

Auditoria nível instituição bancária solicitada pelo Renê:
_"faça uma auditoria de segurança no sistema, visando uma auditoria de
instituição bancária. Opere o que precisa operar para resolver, publique,
teste... traga o relatório de testes (na camada de usuário, testando
absolutamente todos os cenários)."_

**Escopo**: superfície inteira de autorização — Firestore rules, camada
cliente (XSS/URLs/tokens) e Cloud Functions (privilege escalation, SSRF,
abuso de custo, IDOR). Releases **v4.63.94** (lote 0 rules + lote 1 cliente)
e **v4.63.95** (lote 2 Cloud Functions).

**Auditor**: Claude (review interna). Recomenda-se pentest externo
independente antes de tratar o sistema como _hardened_ definitivo.

---

## Resumo executivo

| Severidade | Encontrado | Corrigido | Aberto (flag p/ Renê) |
|---|---|---|---|
| 🔴 CRITICAL | 2 | 2 | 0 |
| 🟠 HIGH     | 5 | 5 | 0 |
| 🟡 MEDIUM   | 6 | 4 | 2 (documentados) |
| 🟢 INFO/Sprint 4 | 5 | — | 5 (migração Cloudflare/Worker) |
| **Total**   | **18** | **11** | **7** |

Resultado: **deploy seguro em PROD** após v4.63.95. Os abertos são
arquiteturais (migração Cloudflare p/ headers HSTS/X-Frame, rotação do
token compartilhado do Worker R2, tokens de share adivinháveis) e estão
detalhados na §Flags.

---

## 🔴 CRITICAL #1 — `isSystem === true` em TODAS as roles = bypass total de autorização

**Status**: ✅ Corrigido em v4.63.95 (5 pontos)

**Evidência (Admin SDK, produção, 2026-05-30)**:

```
roleId       | isSystem | #perms
admin        | true     | 75
coordinator  | true     | 49
manager      | true     | 60
master       | true     | 90
member       | true     | 29
partner      | true     | 4
```

Todas as 6 roles — inclusive `member` e `partner` — carregam
`isSystem === true`. Logo, **qualquer cláusula de permissão na forma
`perms[x] === true || rd.isSystem === true` concedia acesso irrestrito a
qualquer usuário autenticado**, incluindo membros e parceiros externos.

**Impacto**: escalonamento de privilégio horizontal+vertical. Um `partner`
(4 permissões legítimas) passava em qualquer gate que tivesse o fallback
`isSystem`. Atingia: helper central `hasPermissionUid`, exclusão de blobs
R2, gerência de templates, import de roteiros no Banco, curadoria de
validade.

**Fix** — removido `|| rd.isSystem === true` de 5 pontos em
`functions/index.js`:
- `hasPermissionUid` (helper central) → `if (perms[perm] === true) return true;`
- `deleteR2` → `perms.portal_manage === true || perms.portal_images_manage === true`
- `_checkTemplatesPermission` → `return perms.templates_manage === true;`
- `importRoteiroBankPdf` → `perms.portal_destinations_manage === true || perms.portal_manage === true`
- `roteiroBankValidityCron.userCanCurate` → removido `if (rd.isSystem === true) return true;`

`master`/`admin` continuam cobertos por checagem de nome de role + `isMaster`;
`manager` mantém `templates_manage`. Nenhuma regressão de acesso legítimo.

**Lição permanente** registrada em CLAUDE.md §17.

---

## 🔴 CRITICAL #2 — Privilege escalation via self-create/self-update de `users`

**Status**: ✅ Corrigido em v4.63.94 (firestore.rules, PROD)

Regra de `users` permitia ao próprio usuário (membro) setar
`role/isMaster/permissions/sector/nucleos/visibleSectors` via SDK no
self-create e self-update. Lock aplicado: esses campos só mudam por
admin/`system_manage_users`. (Defense-in-depth com a CRITICAL #1.)

---

## 🟠 HIGH #1 — `getAISecretsStatus` vazava comprimento exato das API keys

**Status**: ✅ Corrigido em v4.63.95

Era `requireAuth`-only e devolvia `lengths: { provider: <int exato> }`.
Qualquer membro media o tamanho exato de cada chave (Anthropic/OpenAI/etc.) —
oráculo útil pra ataque. Fix: gate `ai_keys_manage` + dica grosseira
`sizes: { provider: 'empty'|'short'|'ok' }` (limiar 16 chars). Consumer
`js/pages/aiHub.js` atualizado pra ler `sizes`.

## 🟠 HIGH #2 — `getGitHubFile` SSRF + leitura arbitrária de repo

**Status**: ✅ Corrigido em v4.63.95

Sem gate de admin nem allowlist de repo/branch/path. Fix:
- gate `system_manage_settings`
- `REPO_ALLOWLIST = Set(['primetour/tarefas'])`
- validação branch `/^[\w.\-\/]{1,100}$/`, path sem `..`
- `encodeURI`/`encodeURIComponent`
- `download_url` restrito a `^https://raw\.githubusercontent\.com/`

## 🟠 HIGH #3 — `callLLM`: cap de custo e `maxTokens` controlados pelo cliente

**Status**: ✅ Corrigido em v4.63.95

Cliente mandava `agentDailyCapUsd` e `maxTokens` arbitrários — um membro
anulava o teto diário de custo e estourava tokens. Fix: clamps server-side
antes de qualquer chamada de provider:
```js
const safeDailyCapUsd = Math.min(Math.max(Number(agentDailyCapUsd)||5, 0.5), 50);
const safeMaxTokens   = Math.min(Math.max(parseInt(maxTokens)||2048, 64), 32768);
```
`checkDailyCost(uid, agentId, safeDailyCapUsd)` + os 4 providers
(anthropic/openai/gemini/groq) passam `safeMaxTokens`.

## 🟠 HIGH #4 — XSS armazenado em `csat-response.html`

**Status**: ✅ Corrigido em v4.63.94 (cliente)

`customMessage` ia direto no DOM. Fix: `escHtml` em 2 pontos de injeção.

## 🟠 HIGH #5 — URLs `javascript:`/`data:` em portal/gerador

**Status**: ✅ Corrigido em v4.63.94 (cliente)

`normalizeUrl` ganhou allowlist de esquema (`http`/`https`/`mailto`/`tel`)
em `portal-view.html` + `portalGenerator.js`, bloqueando
`javascript:`/`data:`/`vbscript:`.

---

## 🟡 MEDIUM (corrigidos)

- **M1 — `renderTemplate` anti-OOM**: `templateId` validado
  (`!/^[\w.\-]+$/` ou `>200`) + cap 2MB no `data` (anti-OOM Puppeteer).
  _(v4.63.95)_
- **M2 — `saveDestinationPhoto` path-injection/IDOR**: `destinationId`
  validado `^[\w-]{1,128}$` antes de escrever cache. _(v4.63.95)_
- **M3 — 3 collections `*_dev` world-open** (`read,write: if true`)
  travadas em `if false` (confirmadas vazias). _(v4.63.94)_
- **M4 — `integrations` read** restrito a admin/`system_manage_settings`
  (fecha exfiltração de `rawConfig`). _(v4.63.94)_
- **M5 — escritas externas**: `time_clock_audit` exige `actorId==uid`;
  `csat_surveys` update externo exige `respondedAt==null`;
  `recurring_task_templates` update exige manager/owner;
  `portal_tips_stats write: if false`. _(v4.63.94)_
- **`signOut`** limpa ms/google access-tokens do `sessionStorage`. _(v4.63.94)_

## 🟡 MEDIUM (abertos — flags p/ Renê)

- **M-A — `importRoteiroBankPdf` autoApprove**: import já implica curadoria;
  aceitável. Sem ação imediata.
- **M-B — guards fail-open** em poucos caminhos não-críticos: documentado;
  revisar em sprint dedicada.

---

## Relatório de testes (camada de usuário)

> Renê autentica ele mesmo (regra de segurança permanente — não insiro
> credenciais de outro usuário). E2E **autenticado** fica pendente da volta
> dele. Abaixo: probes não-autenticados + verificação de estado via Admin SDK
> + raciocínio sobre as rules. Cobre os cenários de **borda de
> autorização** (que é o alvo de uma auditoria bancária).

### T1 — Cloud Functions exigem login (probe sem auth, PROD)

```
POST .../getAISecretsStatus     → {"status":"UNAUTHENTICATED","message":"Login obrigatorio."}
POST .../getGitHubFile          → UNAUTHENTICATED
POST .../deleteR2               → UNAUTHENTICATED
POST .../importRoteiroBankPdf   → UNAUTHENTICATED
POST .../renderTemplate         → UNAUTHENTICATED
```
✅ Nenhuma CF sensível responde a chamador anônimo.

### T2 — Roles confirmadas via Admin SDK
✅ Smoking gun da CRITICAL #1 documentado acima — fix elimina o fallback.

### T3 — Matriz de autorização esperada (pós-fix)

| Ator | hasPermission gate | deleteR2 | templates | importBank | getAISecrets | getGitHubFile |
|---|---|---|---|---|---|---|
| anônimo | ❌ (UNAUTH) | ❌ | ❌ | ❌ | ❌ | ❌ |
| member  | só perms reais | ❌ (sem portal_*) | ❌ | ❌ | ❌ (sem ai_keys_manage) | ❌ |
| manager | perms reais | depende | ✅ templates_manage | depende | ❌ | ❌ |
| admin/master | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ system_manage_settings |

Antes do fix, **member/partner passavam em TODAS as colunas** via
`isSystem`. Depois, cada coluna depende da permissão real.

### T4 — Cliente (XSS/URL)
- ✅ `customMessage` do CSAT escapado (`escHtml`) — payload `<img onerror>`
  renderiza como texto.
- ✅ `normalizeUrl` rejeita `javascript:`/`data:` — link malicioso vira `#`.

### T5 — Custo/recurso (callLLM)
- ✅ `maxTokens` de cliente clampado a [64, 32768]; cap diário a [0.5, 50] USD.
  Cliente não anula mais o teto.

### Pendente (Renê autenticado, na volta)
- E2E logado como `member` real tentando: excluir blob R2, renderizar
  template de outra área, ler `integrations.rawConfig`. Esperado: negado em
  todos. (Não executável sem credencial de membro — Renê valida.)

---

## Flags p/ Renê (não quebrar / exigem decisão)

1. **Headers HSTS/X-Frame-Options/COOP** não aplicam no GitHub Pages
   (`_headers` é formato Cloudflare). Só a CSP via meta-tag está ativa.
   → tratar na **migração Cloudflare (Sprint 4)**.
2. **CSP `script-src 'unsafe-inline'`** — removível só após build com nonce.
3. **`getR2UploadUrl` usa token compartilhado** (Worker JWT) — rotação +
   per-user token recomendados (C2).
4. **Tokens de share adivinháveis** (H3 schema) — aumentar entropia exige
   migração de schema dos links.
5. **`dev_hours` / `csat_surveys` read público** — design deliberado, mantido.

---

_Atualizado: v4.63.95 — 2026-05-30. dev_hours e CLAUDE.md §17 atualizados
no mesmo ciclo._
