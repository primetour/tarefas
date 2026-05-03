# Gestor PRIMETOUR — Migração GitHub Pages → Cloudflare Pages

> Status: pendente execução manual
> Tempo estimado: 30 min admin + 10 min DNS propagation
> Custo: zero (free tier suficiente: 500 builds/mês, 100k requests/dia)

## Por que migrar

GitHub Pages **não suporta response headers customizados** — não dá pra setar:
- `Strict-Transport-Security` (HSTS) → exigido por SOC 2
- `Content-Security-Policy` via response header (mais robusta que `<meta>`)
- `X-Frame-Options` (clickjacking)
- `Cross-Origin-Opener-Policy` (Spectre)
- Custom cache control fino

Cloudflare Pages suporta tudo via `_headers` + `_redirects` (já criados no repo).

**Bônus**: CDN global, Cloudflare WAF (DDoS), analytics, dev preview por PR, integration com Workers se precisar.

---

## Passo a Passo

### 1. Criar conta Cloudflare (se não tem)
- https://dash.cloudflare.com/sign-up
- Free tier suficiente

### 2. Conectar repositório
1. Dashboard Cloudflare → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
2. Authorize Cloudflare a acessar GitHub
3. Selecionar `primetour/tarefas`
4. **Setup builds**:
   - Production branch: `main`
   - Build command: *(deixa vazio — é site estático)*
   - Build output directory: `/` *(repo é root)*
   - Root directory: `/`
5. **Save and Deploy**

Aguarda build (~30s). Vai gerar URL `tarefas-XXX.pages.dev`.

### 3. Verificar headers funcionando
```bash
curl -I https://tarefas-XXX.pages.dev
# Procurar por:
# strict-transport-security: max-age=31536000; includeSubDomains; preload
# x-frame-options: SAMEORIGIN
# content-security-policy: default-src 'self'; ...
# x-content-type-options: nosniff
```

### 4. Configurar custom domain
**Opção A — usar primetour.com.br/tarefas (recomendado)**:
1. Cloudflare Pages → seu projeto → **Custom domains** → **Set up a custom domain**
2. Inserir: `tarefas.primetour.com.br` (subdomain)
3. Cloudflare gera CNAME — adicionar no provedor DNS atual
4. (Alternativa) se DNS já está no Cloudflare: configuração automática
5. Aguardar SSL (~5 min, cert Let's Encrypt automático)

**Opção B — manter primetour.github.io**:
1. Configurar DNS do `primetour.github.io` apontando pro CF Pages — **não recomendado**, github.io tem regras próprias
2. Melhor: usar URL `tarefas.primetour.com.br` e atualizar referências

### 5. Atualizar referências no código
Onde aparece `primetour.github.io/tarefas`, substituir por `tarefas.primetour.com.br`:

```bash
# No repo:
grep -rln "primetour.github.io/tarefas" --include="*.js" --include="*.html" --include="*.md"
```

Arquivos típicos a atualizar:
- `index.html` (se houver hard-coded URLs)
- `agente.html` (links públicos)
- `lp.html`
- `js/services/notification.js` (links de notificação)
- `js/services/feedbackEmail.js` (links em email)
- `firebase.json` (CORS origins)
- `functions/index.js` (CORS allowlist)
- `THREAT-MODEL.md`, `INCIDENT-RESPONSE.md`, `security.txt`

### 6. Atualizar Firebase Auth authorized domains
1. https://console.firebase.google.com/project/gestor-de-tarefas-primetour/authentication/settings
2. **Authorized domains** → Add domain → `tarefas.primetour.com.br`
3. (Manter `primetour.github.io` por uns dias durante transição)

### 7. Atualizar Cloud Functions CORS
```js
// functions/index.js — em cada onCall:
cors: [
  'https://tarefas.primetour.com.br',  // ← novo
  'https://primetour.github.io',        // ← manter durante transição
  'http://localhost:5000',
],
```

Deploy: `firebase deploy --only functions`

### 8. Atualizar reCAPTCHA Enterprise allowed domains
1. https://console.cloud.google.com/security/recaptcha?project=gestor-de-tarefas-primetour
2. Edit key `6Lc38dUs...`
3. Domain list → Add: `tarefas.primetour.com.br`
4. Save

### 9. Atualizar Microsoft Azure AD redirect URIs
1. portal.azure.com → App registrations → seu app
2. Authentication → Redirect URIs
3. Add: `https://gestor-de-tarefas-primetour.firebaseapp.com/__/auth/handler` (já existe, só verifica)
4. Add Front-channel logout URL: `https://tarefas.primetour.com.br`

### 10. Setup HSTS preload (após confirmar funcionando ~7 dias)
1. Verificar HSTS está sendo enviado: https://hstspreload.org/?domain=tarefas.primetour.com.br
2. Site indica se está pronto para preload list
3. Submit → Chrome/Firefox/Safari incluem o domínio na lista de força HTTPS

**Cuidado**: HSTS preload é **irreversível por meses** após inclusão. Só faça depois de confirmar que tudo HTTPS funciona perfeito.

---

## Plano de rollback

Se der ruim em produção:
1. Cloudflare Pages → seu projeto → **Deployments** → escolher commit anterior → **Rollback to this deployment**
2. OU desativar projeto Cloudflare Pages — DNS volta automático pra GitHub Pages (se mantido)
3. Em emergência: deletar registro DNS pointing pro CF Pages, browser cai pro fallback

**Tempo de rollback**: < 2 min via dashboard

---

## Cleanup pós-migração (~30 dias depois)

Quando confirmar 100% migrado e funcionando:
1. **GitHub Pages**: Settings → Pages → desativar (ou manter como mirror)
2. Remover URL antiga das Authorized Domains do Firebase Auth
3. Remover URL antiga do CORS allowlist em Cloud Functions
4. Remover URL antiga do reCAPTCHA Enterprise
5. Atualizar documentação (`README.md`, `SECURITY.md`)

---

## Validação pós-migração (checklist)

- [ ] Site carrega em https://tarefas.primetour.com.br
- [ ] Login Microsoft SSO funciona
- [ ] App Check token gerado (DevTools console: `[App Check] enabled`)
- [ ] Firestore reads/writes OK
- [ ] Cloud Functions respondem (testa criar uma tarefa, abrir IA Hub)
- [ ] Headers presentes (curl -I)
- [ ] Cert SSL válido (Chrome 🔒 verde)
- [ ] Páginas públicas carregam (agente.html, lp.html, etc.)
- [ ] Backup automático ainda funciona (próximo dia 03h BRT)
- [ ] SIEM digest ainda funciona (próximo dia 09h BRT)

---

## Métricas pós-migração

Cloudflare Pages dashboard mostra:
- Requests/dia
- Bandwidth
- Cache hit rate
- Origin response time

Para comparar com GitHub Pages, snapshot atual:
```
GH Pages metrics (atual):
- ~10k pageviews/dia
- Sem WAF
- Sem analytics nativos
- Sem cache control
```

Cloudflare deveria dar:
- WAF gratuito (mitiga DDoS)
- Cache global em 300+ data centers
- Analytics nativo
- Email obfuscation
- Bot fight mode (desliga se conflitar com App Check)

---

## Suporte

Issues comuns:
- **404 em rotas SPA**: verificar `_redirects` está sendo lido (precisa estar na raiz do build output)
- **CORS errors**: confirmar Cloud Functions `cors:` array atualizado + redeploy
- **CSP bloqueando algo**: verificar console, adicionar domínio em `_headers`
- **HSTS não funcionando antes da preload**: normal, leva 1+ ano de browsing pra clientes terem cache HSTS

Docs Cloudflare Pages: https://developers.cloudflare.com/pages/

---

## Owner & versionamento

- **v1.0** (2026-05-02): primeira versão (Sprint 4)
- Owner: Rene Castro
