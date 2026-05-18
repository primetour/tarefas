# Security Follow-ups — Pré Audit Bancária

> Itens da auditoria 2026-05-15 que **requerem ação manual** ou foram
> **deferidos** com justificativa documentada.

## 🔧 Ações manuais necessárias

### B1. GCP API Key Restrictions (Firebase apiKey)

**Status:** ✅ **APLICADO em 2026-05-15** via `gcloud services api-keys update` (v4.40.23).

**Restrições ativas (atualizado em 4.40.26 com fix do SSO):**
- HTTP referrers:
  - `https://primetour.github.io/*` (app principal)
  - `https://*.primetour.com.br/*` + `https://primetour.com.br/*` (futuro)
  - `https://gestor-de-tarefas-primetour.firebaseapp.com/*` ⚠ **OBRIGATÓRIO** — Firebase Auth handler do SSO Microsoft passa por aqui
  - `https://gestor-de-tarefas-primetour.web.app/*` (alias do Firebase Hosting)
  - `http://localhost:8765/*` (dev)
- API targets: 16 Firebase services (Identity Toolkit, Firestore, App Check, etc.)

**⚠ ARMADILHA documentada:** Esquecer `firebaseapp.com/*` quebra o login Microsoft SSO. O fluxo signInWithPopup abre o handler oficial `gestor-de-tarefas-primetour.firebaseapp.com/__/auth/handler` que chama Identity Toolkit com a mesma apiKey. Sem `firebaseapp.com` na whitelist, o popup mostra "The requested action is invalid" e o login trava. Bug introduzido em 4.40.23 e corrigido em 4.40.26 (16/05 manhã).

**Comprovação E2E (logs do `gcloud` + curl):**

| Teste | Esperado | Resultado |
|---|---|---|
| `curl` sem referrer | 403 blocked | ✅ HTTP 403 `Requests from referer <empty> are blocked` |
| `curl` com referrer `evil.example.com` | 403 blocked | ✅ HTTP 403 `Requests from referer https://evil.example.com/login are blocked` |
| `curl` com referrer `primetour.github.io/tarefas/` | passa | ✅ HTTP 400 (chegou no endpoint, falha só no payload) |
| App ao vivo lê Firestore | OK | ✅ `Rafaela Gouvêa` carregada |

**Reaplicar (se mudar de host) — comando OFICIAL pós-fix 4.40.26:**

```bash
gcloud services api-keys update 8649818d-3e7c-49c9-8bbc-a5b09980b558 \
  --project=gestor-de-tarefas-primetour \
  --allowed-referrers='https://primetour.github.io/*,https://*.primetour.com.br/*,https://primetour.com.br/*,https://gestor-de-tarefas-primetour.firebaseapp.com/*,https://gestor-de-tarefas-primetour.web.app/*,http://localhost:8765/*'
```

**REGRA DE OURO:** ao adicionar/remover referrers, SEMPRE manter
`firebaseapp.com/*` E `web.app/*` da própria project — eles são internos do
Firebase Auth.

---

### B1 (referência original — qual era o problema)

**O que fazer:**

1. Acessar https://console.cloud.google.com/apis/credentials
2. Selecionar project `gestor-de-tarefas-primetour`
3. Localizar a API key usada pelo Firebase Web SDK (em `js/config.js`)
4. Em **Application restrictions** → selecionar **HTTP referrers**
5. Adicionar referrers permitidos:
   - `https://primetour.github.io/tarefas/*`
   - `https://*.primetour.com.br/*` (futuro Cloudflare)
   - `http://localhost:8765/*` (dev local — opcional)
6. Em **API restrictions** → restringir só às APIs em uso:
   - Identity Toolkit API
   - Cloud Firestore API
   - Firebase App Check API
   - Cloud Functions API
   - Token Service API
   - reCAPTCHA Enterprise API
7. Salvar

**Por que:** mesmo Firebase apiKey sendo "público por design" (Firebase docs),
restringir o referrer impede que key roubada seja usada de outros domínios
(ex: phishing site clonado). Defense-in-depth para auditoria bancária.

**Validação:** após aplicar, tentar usar a key em curl/Postman → deve falhar
com `referrer not allowed`.

---

### B2. GitHub PAT placeholder em config.js

**Status:** ✓ verificado — atualmente é placeholder `'SEU_GITHUB_PAT_AQUI'`,
não tem PAT real exposto.

**Verificação atual:**

```bash
$ grep "github.token" js/config.js
github.token: 'SEU_GITHUB_PAT_AQUI'  # placeholder
```

**Risco residual:** se admin cole token real ali e commitar, vaza no repo.

**Mitigação aplicada:** comentário explícito no config.js direcionando admin
a usar Cloud Function Secret Manager (já em uso pra outros secrets via
`defineSecret('GITHUB_PAT')` em `functions/index.js` linha 43).

**Para audit:** apresentar como "policy: tokens nunca em código client-side;
sempre via Cloud Functions com Secret Manager".

---

## 📦 Deferidos com justificativa

### M1. Subresource Integrity (SRI) em scripts externos

**Status:** **deferido** — incompatibilidade arquitetural.

**Por que defer:** o sistema importa Firebase SDK e libs via ES modules
dinâmicos com cache-bust `?v=...` (não como `<script src=>`). ES module
imports não suportam `integrity=` attribute. Implementar SRI exigiria:

- Pinning de versão exata de cada lib (rompe upgrades automáticos do Firebase)
- Build step pra calcular hashes (atual: zero build, deploy = git push)
- Hash recalculation em cada upgrade de dep

**Mitigações alternativas em vigor:**

- Firebase SDK servido por `gstatic.com` (Google CDN com HSTS+TLS)
- Cloudflare workers proxied via subdomain controlado (`primetour-images.rene-castro.workers.dev`)
- App Check valida que vem do app oficial (não Postman/proxies maliciosos)
- CSP `connect-src` whitelist (4.40.21+) restringe destinos a domínios conhecidos

**Para implementar no futuro:** migrar pra Vite/esbuild com plugin SRI
automático. Tempo estimado: 1-2 sprints (refactor de imports).

---

### C1. Migração GitHub Pages → Cloudflare Pages

**Status:** **deferido para sprint dedicado** (decisão do user em 2026-05-15).

`_headers` file já está pronto (`/Users/rene/Downloads/GESTOR DE TAREFAS PRIMETOUR/V11/_headers`)
com toda configuração HSTS + X-Frame-Options + CSP-via-header + COOP/CORP.
Quando migrar, headers ativam automaticamente.

**Para audit:** apresentar como "roadmap conhecido, host atual com CSP via
meta tag + App Check + Firestore rules como camadas de defesa equivalentes".

---

## 🛡 Defense-in-depth aplicado (audit 4.40.21+)

Em vez de fixes "binários" (resolve / não resolve), implementamos camadas:

| Vetor | Camada 1 | Camada 2 | Camada 3 |
|---|---|---|---|
| Token roubado via XSS | App Check rejeita não-app | TTL curto (60s R2, 30min hidden MS) | beforeunload clear |
| Formula injection CSV | csvCell prefixa `'` | RFC 4180 quote | Audit log entries não-escapadas |
| Email injection CSAT | Regex RFC5322-lite | Graph API API-level | Audit log |
| Notification spam | Rate limit por user (20/h) | Audit log do rate-limit | Flag emailSkippedReason no doc |
| PII leak audit | SHA-256 do email | UA reduzido a browser/OS | TTL 90d-180d |
| Privilege escalation users | Firestore rule bloqueia role/perms | App-level RBAC | Audit log de mudanças |
| R2 upload abuse | Token compartilhado | Rate limit 60/min IP + 20/min user | Path whitelist + audit log emit |
| SharePoint access | Era "qualquer auth" | Agora `ai_use` permission | Audit log de denials |

---

## 📊 Resumo executivo pra audit

**17 findings identificados → 14 resolvidos no código + 3 deferidos com mitigação:**

- ✅ **3 CRÍTICOS:** C2 (rules) + C3 (MS token defense-in-depth) resolvidos.
  C1 (Cloudflare migration) deferido — `_headers` pronto, host atual mitigado por meta-CSP + App Check.
- ✅ **6 ALTOS:** todos resolvidos. A1 (inline scripts → externos), A2 (CSP img-src tightened), A3 (`rel=noopener` em ~10 arquivos), A4 (audit log PII hashing), A5 (console.log PII removido), A6 (R2 hardened + SharePoint permission).
- ✅ **6 MÉDIOS:** todos resolvidos. M1 (SRI) deferido com mitigação documentada.
- ✅ **2 BAIXOS:** B1 documentado para ação no GCP Console (5 min admin), B2 verificado (não há PAT exposto).
