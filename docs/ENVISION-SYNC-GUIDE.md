# Banco de Roteiros — Como atualizar via Envision

> **Doc operacional permanente.** Onde está documentado o procedimento
> de sincronização do Banco com a fonte da verdade (TravelAgent/Envision).
> Não deletar este arquivo — ele é o "como fazer" oficial e referência
> primária no módulo (link na UI).
>
> Sprint v4.59 · Última revisão 2026-05-26.

---

## 1. Por que precisamos disso

A **Envision (TravelAgent)** é o sistema de produtos da equipe operacional.
O **PRIMETOUR** consome a Envision como fonte da verdade e enriquece os
roteiros com camada de personalização pra consultor de vendas (briefing
de cliente, customização visual, export multiformato).

**Envision não oferece API REST pra roteiros** — só SOAP via `.svc` (e o
acesso é via Forms Authentication com cookie `.ASPXAUTH` HttpOnly, então
servidor externo não consegue chamar). Por isso o fluxo é **assistido**
e roda dentro do navegador autenticado.

---

## 2. Quando rodar

Re-sync recomendado:

| Trigger | Frequência |
|---|---|
| Mudança massiva no Envision (lote novo de produtos) | sob demanda |
| Atualização periódica defensiva | mensal |
| Antes de campanha grande de vendas | sob demanda |
| Bug detectado num roteiro específico | sob demanda (re-fetch só daquele) |

> ⚠ **Cada re-sync sobrescreve** os campos vindos do Envision (title,
> shortDescription, geo, days[], includes, services[], hotels enriquecidos,
> envisionRaw). Campos **PRIMETOUR-only** (curadoria editorial, tags
> manuais, overrides de imagem, pricing customizado) **NÃO** são tocados.

---

## 3. Quem pode rodar

- **Master / Admin do PRIMETOUR** com login Envision válido.
- O script roda em **Node.js (Admin SDK)** no terminal local (bypassa
  Firestore rules), então precisa do `firebase login` ativo no projeto
  `gestor-de-tarefas-primetour`.
- Sem permissão Envision → não dá pra rodar. Sem permissão Firestore →
  não persiste.

---

## 4. Procedimento passo a passo

### 4.1. Coletar o bundle Envision (no navegador autenticado)

1. Abrir o Chrome logado em https://v2.travelagent.com.br/
2. Ir pra **listagem de roteiros**, filtrar por **Ativos = Sim** (e
   qualquer outro filtro de coleção/região desejado).
3. Abrir DevTools → Console e colar o **bulk fetch script**:
   ```js
   // js/portal/dev-tools/envision-bulk.js (TODO: criar este arquivo)
   // Por enquanto, ver functions/import-envision-bundle.cjs §header
   ```
4. Aguardar todos os itinerários baixarem (5-15 min pra 236+ docs).
5. Salvar `window.__bulkResults` como JSON:
   ```js
   copy(JSON.stringify(window.__bulkResults));
   ```
6. Colar num arquivo em `docs/envision-samples/envision-full-bundle-{ts}.json`.

### 4.2. Rodar o adapter + import

```bash
cd functions
node import-envision-bundle.cjs --bundle ../docs/envision-samples/envision-full-bundle-XXXX.json --apply
```

Flags úteis:
- (sem `--apply`): dry-run, mostra qto seria criado/atualizado, não grava.
- `--apply`: persiste em produção.
- `--only-new`: cria apenas docs com `envision.id` ainda não conhecido.
- `--only-updated`: atualiza apenas docs cujo `Envision.UpdatedAt > localUpdatedAt`.

### 4.3. Backfill geo (apenas se rodou import novo)

Após import, se novos países/cidades apareceram, rodar:

```bash
node backfill-geo-codes.cjs --apply
```

Isso adiciona `countryCode`/`continentCode` ISO em qualquer doc novo
(adapter já preenche em tempo de import, esse comando é defensivo idempotente).

Se vier país NOVO que não está em `js/data/countries.js`, o backfill loga
`⚠ unresolved` — adicionar ao SSOT (alphabetic order no continente),
commit, re-rodar. Pra adicionar país:

```js
// js/data/countries.js — append no continente certo:
{ code: 'XX', pt: 'Nome PT', en: 'Name EN', continent: 'XX',
  aliases: ['variações vistas'] },
```

### 4.4. Validação E2E

1. **Validar no app** (`https://primetour.github.io/tarefas/`):
   - Banco de Roteiros → contagem total bate?
   - Abrir 3-4 roteiros aleatórios. Hero carregou? Includes/Cancellation/
     Payment populados? Cidades certas?
2. **Audit Firestore** (Admin SDK):
   ```bash
   node inspect-bank-docs.cjs        # contagem + amostragem
   node audit-geography-ssot.cjs     # 100% match esperado
   ```
3. **Logs CF** se cron rodou:
   ```bash
   firebase functions:log --only roteiroBankValidityCron --lines 20
   ```

---

## 5. Troubleshooting

### "401 Unauthorized" ao buscar itinerário

Cookie `.ASPXAUTH` expirou. Refresh login no Chrome + repetir bulk fetch.

### Roteiro vem sem `geo.countries`

Envision deixou `Product.Location.Country=null`. Adapter já tenta inferir
de `cities[]`, mas se nenhuma cidade tem country, o doc fica com
`geo.countries=[]`. Curador precisa preencher manualmente no editor.

### Imagens não carregam ("403 R2 / 404 CDN")

Verificar CSP do `index.html` — `img-src` deve incluir o host do CDN.
Atualmente: `storage.googleapis.com`, `r2.dev`, `i.imgur.com`, etc.
Adicionar novo host no `<meta http-equiv="Content-Security-Policy">`.

### "permission-denied" ao rodar script

`firebase login` expirou ou projeto errado:
```bash
firebase login
firebase use gestor-de-tarefas-primetour
```

### Adapter falha em `parseIncludes` / `parseCancellation`

Envision mudou estrutura do HTML. Ver `js/services/envisionAdapter.js`
`parseIncludes()` e atualizar regex. Re-rodar `test-envision-adapter.cjs`
contra fixtures.

---

## 6. Arquitetura técnica

```
┌─────────────────┐
│ Envision SOAP   │ (cookie auth, HttpOnly, browser-only)
└────────┬────────┘
         │ XHR via DevTools / bulk script
         ▼
┌─────────────────┐
│ window.__bulkResults                                │
│ (saved as docs/envision-samples/*.json)             │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ functions/import-envision-bundle.cjs                │
│   ↓ apply envisionItineraryToBank()                 │
│   ↓ countries.js SSOT lookup → geo.countryCodes     │
│   ↓ saveRoteiroBank() (Admin SDK, bypassa rules)    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Firestore: roteiros_bank/                           │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ PRIMETOUR UI (Banco de Roteiros, Gerador IA)        │
└─────────────────┘
```

**Princípios** (CLAUDE.md §11.h):
- Envision = source of truth pros campos importados.
- PRIMETOUR sobrepõe via curadoria, NÃO substitui.
- Fallback explícito (HTML em `envisionRaw` preservado pra inspeção).
- Sem parser silencioso — campos não-mapeados ficam visíveis em audit.

---

## 7. Roadmap (não implementado)

- [ ] **Auto-sync incremental**: CF cron que detecta `Envision.UpdatedAt`
  e re-puxa só os itinerários mudados.
- [ ] **Diff visual**: UI mostra delta entre versão local vs Envision
  pré-aplicar (curador aprova).
- [ ] **Webhook Envision** (se disponibilizarem) — sub-segundo refresh.
- [ ] **Workflow `pending-review`** pra novos destinos auto-criados a
  partir do import (master aprova antes de aparecer em filtros).

---

## 8. Referência rápida — comandos

```bash
# Diretório de trabalho
cd "/Users/rene/Downloads/GESTOR DE TAREFAS PRIMETOUR/V11/functions"

# Auditoria sem mudar nada
node audit-geography-ssot.cjs
node inspect-bank-docs.cjs

# Import Envision (dry-run depois apply)
node import-envision-bundle.cjs --bundle ../docs/envision-samples/X.json
node import-envision-bundle.cjs --bundle ../docs/envision-samples/X.json --apply

# Backfill geo (idempotente)
node backfill-geo-codes.cjs
node backfill-geo-codes.cjs --apply

# Deploy + validação
firebase deploy --only firestore:rules
firebase deploy --only functions:roteiroBankValidityCron
firebase functions:log --only roteiroBankValidityCron --lines 20

# Confirmar versão no GH Pages
curl -s https://primetour.github.io/tarefas/js/version.js | grep patch
```

---

**Owner do doc**: René (atualizar quando ENV mudar de host/contrato).
**Última auditoria**: 2026-05-26 (v4.59.0 — SSOT geográfico introduzido).
