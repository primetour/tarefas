# Plano — `portal_destinations` como Single Source of Truth de Geografia

> Sprint **v4.59** · Criado 2026-05-26 após Renê levantar problema arquitetural:
>
> *"continentes, países e cidades precisa estar linkado ao módulo de destinos, porque banco de roteiros vai cruzar com banco de imagens, portal de dicas e gerador de roteiros... no futuro vamos gerar roteiros que vão utilizar o banco como base de conhecimento pra IA..."*

---

## 1. Diagnóstico atual

### Inventário cross-module (medido via MCP)

| Coleção | Total | Cidades únicas | Países únicos | Forma de referência |
|---|---|---|---|---|
| `portal_destinations` | 61 docs | 61 | ~25 | **Doc canônico** (id + continent + country + city) |
| `roteiros_bank` | 236 docs | **369** | 53 | Array `geo.cities[].city` (string) + `geo.countries[]` (string) |
| `portal_images` | ~150 docs | 20 | 13 | Campos `country`/`city` (strings) |
| `portal_tips` | ~30 docs | 8 | 7 | Campos `country`/`city` (strings) |

### Cross-match Envision → portal_destinations

- **Match exato** (string igual): **19 de 384 pairs city-country** = **5%**
- **365 pairs unmatched** — incluindo cidades reais (Cusco, Bariloche, Nápoles, Thimphu) que ESTÃO ou DEVERIAM estar no SSOT mas não batem por:
  1. **Acento/case**: "Cusco" vs "Cuzco"
  2. **Idioma**: "Tokyo" vs "Tóquio"
  3. **Trecho**: "Coyhaique - Cerro Castillo" não é cidade atômica
  4. **Sub-localização**: "Cochrane (Explora Parque Nacional Patagonia)" — cidade + propriedade
  5. **País "?" desconhecido**: 52 docs sem country detectado

### Conclusão

**O sistema tem 5+ representações paralelas da mesma cidade.** Sem SSOT:
- Filtro "Tóquio" no Banco perde imagem cadastrada como "Tokyo"
- Dica de "Cidade do Cabo" não cruza com roteiro de "Cape Town"
- Agente IA recebe contexto incoerente ("Roma" no roteiro mas imagem só pra "Rome")
- Curador edita 1 destino e correção não propaga

---

## 2. Modelo SSOT proposto

### `portal_destinations` = Source of Truth canônico

```js
{
  id: 'dest-xyz123',
  continent: 'América do Sul',     // canonical pt-BR
  country: 'Argentina',             // canonical pt-BR (normalizado)
  city: 'Bariloche',                // canonical pt-BR
  countryEn: 'Argentina',           // pra match Envision/Unsplash
  cityEn: 'Bariloche',              // idem
  cityAliases: ['San Carlos de Bariloche'],   // outros nomes vistos
  iata: 'BRC',                      // pra match aéreo
  envisionLocationId: 12345,        // FK Envision quando criado/identificado
  countryCode: 'AR',                // ISO 3166-1 alpha-2
  source: 'manual' | 'envision-auto' | 'imported',
  reviewStatus: 'approved' | 'pending-review',  // novos auto-import → pending
  createdAt, updatedAt, createdBy, updatedBy,
}
```

### Outros módulos referenciam via `destinationIds[]` (FK)

```js
// roteiros_bank
{
  ...
  geo: {
    countries: ['Argentina'],                  // legado, deprecar gradualmente
    cities: [{ city: 'Bariloche', country: 'Argentina', ... }],  // legado
    destinationIds: ['dest-xyz123', 'dest-abc456'],   // NOVO — FK pra SSOT
  },
}

// portal_images
{
  ...
  city: 'Bariloche',          // legado retrocompat
  country: 'Argentina',
  destinationId: 'dest-xyz123',  // NOVO
}

// portal_tips
{
  ...
  destinationId: 'dest-xyz123',  // NOVO
}
```

**Princípio**: campos antigos (`city`, `country`) ficam como retrocompat. Reader prioriza `destinationId` se presente.

---

## 3. Plano de execução em fases

### Fase 1 — Normalização do adapter (foundation)

Antes de popular SSOT, garantir que adapter Envision extrai cidades **atômicas** (não trechos):

1. **`splitTrecho(locationName)`** — split por ` - `, ` / `, `→` retorna array de cidades atômicas
   - `"Coyhaique - Cerro Castillo"` → `['Coyhaique', 'Cerro Castillo']`
   - `"Ischia - Procida - Ischia"` → `['Ischia', 'Procida']` (dedup)
   - `"Cochrane (Explora Parque Nacional Patagonia)"` → `['Cochrane']` (strip parens)
2. **`cleanCityName(name)`** — strip parens, hifens órfãos, trim
3. Atualizar `deriveGeo()` pra usar split — `cities[]` vira lista de cidades atômicas
4. Re-importar 236 docs

**Esperado**: 369 cidades → ~150-200 cidades atômicas únicas

### Fase 2 — Resolver Country pros 52 docs sem

Estratégias (ordem):
1. Mapa hardcoded de cidades famosas: `"Riyad" → "Arábia Saudita"`, `"Tel Aviv" → "Israel"`, `"Petra" → "Jordânia"`, etc. ~30-50 entries cobrem 80%
2. IA backup: 1 chamada Sonnet pra inferir país dado cidade + título (custo trivial)
3. Aceitar gap residual pra curador completar manual

### Fase 3 — `portal_destinations` enriquecido + auto-populate

1. **Schema bump**: adicionar `countryEn`, `cityEn`, `cityAliases[]`, `iata`, `envisionLocationId`, `countryCode`, `source`, `reviewStatus`
2. **Migration** dos 61 docs existentes:
   - `source: 'manual'`, `reviewStatus: 'approved'`
   - Tentar preencher `countryEn`/`cityEn`/`iata` via Anthropic com cache (50 cidades = ~10s)
3. **Auto-populate dos novos** (180 cidades Envision após split):
   - Pra cada `{cityAtomic, country}` Envision não existente em SSOT
   - Cria doc em `portal_destinations` com `source: 'envision-auto'`, `reviewStatus: 'pending-review'`
   - Marca `envisionLocationId` se conhecido
4. **UI badge** em destinations: cards com `reviewStatus: 'pending-review'` ganham flag amarela "Auto-importado — revisar"

### Fase 4 — Adapter Envision resolve `destinationIds`

`envisionAdapter.js`:
1. Recebe `portal_destinations` list (passada via opts)
2. Pra cada cidade atômica do roteiro, faz match contra SSOT:
   - 1ª: `city` exato + `country` exato
   - 2ª: `cityEn` exato (caso Envision usa nome inglês)
   - 3ª: `cityAliases` contém
   - 4ª: fuzzy normalize (sem acento, lowercase)
   - Sem match → NÃO cria (fica pra Fase 3 auto-populate batch)
3. Resultado: `geo.destinationIds: ['dest-xyz', 'dest-abc']`

### Fase 5 — Migration retroativa cross-modules

1. **Migration script** (`functions/migrate-add-destinationIds.cjs`):
   - Itera `roteiros_bank` → resolve `destinationIds` retroativo
   - Itera `portal_images` → resolve `destinationId` retroativo
   - Itera `portal_tips` → resolve `destinationId` retroativo
2. Reporta resíduo (string sem match) pro curador
3. **NÃO deleta** campos antigos (`city`, `country`) — retrocompat

### Fase 6 — Readers prioritam FK + UI lookup

1. Helpers `js/services/destinations.js`:
   - `resolveDestinationId(city, country)` — usado em escrita nova
   - `fetchDestinationsByIds(ids)` — lookup batch
2. Banco de Roteiros render: se `destinationIds[]` populado, busca SSOT pra exibir cidades
3. Portal Images / Tips: idem
4. Gerador de Roteiros: picker de destinos usa SSOT direto (já usa hoje, só validar)

### Fase 7 — Cross-module discovery (opcional, futuro)

Quando `destinationIds` virar dominante:
- **Página Destinations** mostra contagem cruzada: "Bariloche — 8 roteiros · 12 imagens · 3 dicas"
- **Editor de roteiro**: badge "5 dicas de Tóquio disponíveis · ver"
- **Agente IA**: contexto rico ("usuário quer Tóquio. Banco tem 4 roteiros, 15 imagens, 3 dicas internas — use como base")

---

## 4. Decisões pendentes (críticas)

### D1. Pra cidades novas Envision: cria automático em SSOT OU pede revisão antes?

**Opção A — Auto-cria com `pending-review`** (recomendada):
- Não bloqueia import
- 180 cidades novas viram entries auto
- Curador revisa em batch (pode até ser bulk-approve por país)

**Opção B — Cria só sob aprovação** (mais conservadora):
- Import gera lista de "novas cidades" pra curador APROVAR
- Mais trabalho mas zero lixo no SSOT

→ Recomendo **A** pra POC. Curador pode batch-approve rápido.

### D2. Pra 52 docs sem country: IA pra inferir OU deixa gap?

**Opção A — IA Sonnet** (custo ~$0.05 pra 52 calls): inferir país dado cidade + título
**Opção B — Mapa hardcoded** (cobre cidades famosas, ~70% provavelmente)
**Opção C — Deixa gap**: cards mostram "país não detectado", curador filtra e completa

→ Recomendo **B → A → C** (cascata). Mapa cobre maioria, IA pega resto, fica gap mínimo.

### D3. Schema: campos antigos (`city`, `country` em strings) — deletar quando?

**Opção A — Deletar IMEDIATAMENTE** quando `destinationId` resolve (limpo, mas migration única)
**Opção B — Manter forever como retrocompat** (dado redundante mas safe)
**Opção C — Deprecation cycle**: 90 dias com ambos, depois remove

→ Recomendo **B** (mais seguro). Storage trivial. Reader sempre prioriza `destinationId`.

### D4. Trechos no DayByDay (não cidade): tratamento?

`DayByDay[].Name` muitas vezes é `"Coyhaique - Cerro Castillo"` (dia de transição).

**Opção A — Day mostra ambas cidades** (origem + destino)
**Opção B — Cidade do day = última cidade do trecho** (onde pernoita)
**Opção C — Mantém string original**, só extrai cidades atômicas pra `geo.cities[]`

→ Recomendo **C**. Day narrative preserva contexto rico. Listagem/filtro usa `geo.cities[]` atômicas.

### D5. Continente: agora que tirei da UI Banco, mantém no schema SSOT?

Continente foi removido da UI/filtros do Banco (Renê: "não precisamos"). Mas `portal_destinations` USA continente (hierarquia continent → country → city).

**Opção A — Mantém em SSOT mas não exibe no Banco** (continent é "metadata interna")
**Opção B — Remove totalmente do schema** (mais limpo)

→ Recomendo **A**. Continente continua útil em outros lugares (filtro Portal de Dicas talvez, agrupamento de relatórios). Banco só não exibe.

### D6. Quem é "owner" do SSOT?

- Curador edita destinations manualmente? Ou só sistema/IA preenche?
- Quando Envision atualiza nome, sobrescreve ou pergunta?

→ Recomendo **curador é owner final**. Auto-import marca `pending-review`. Curador edita/aprova. Re-sync Envision NÃO sobrescreve campos editados (overlay pattern, como `editorialOverlay` que planejamos pra roteiros).

---

## 5. Tempo estimado por fase

| Fase | Esforço | Notas |
|---|---|---|
| F1 — Adapter normalize trechos | ~2h | Refactor + re-import |
| F2 — Resolver 52 sem country | ~3h | Mapa + IA backup |
| F3 — SSOT enriquecido | ~3h | Schema + auto-populate |
| F4 — Adapter resolve destinationId | ~2h | Add lookup |
| F5 — Migration cross-modules | ~3h | Script + reporting |
| F6 — Readers + UI | ~4h | Vários pontos |
| F7 — Discovery cross-module | ~6h | Opcional futuro |
| **Total core (F1-F6)** | **~17h** | sem F7 |

---

## 6. Riscos

| Risco | Mitigação |
|---|---|
| Auto-populate cria 180+ destinations lixo | `reviewStatus: pending-review` + batch approve UI |
| Match fuzzy sobrescreve destination errado | Match em 4 níveis com confidence; level 4 (fuzzy) só sugere, não cria |
| IA pra inferir país erra | Confidence < 0.8 vira pending-review |
| Migration cross-module quebra leituras | Migration on-read defensiva — campos antigos preservados |
| Curador overhead de aprovar 180 entries | UI batch: aprovar todos de "Argentina" de uma vez |

---

## 7. Próximo passo concreto

Renê responde D1-D6 → executo Fase 1 (normalização adapter + re-import). Posso entregar Fase 1 em ~2h, validar via MCP, depois decidir se sigo Fases 2-6 contínuo ou ataca outra prioridade.

Plano OK pra começar?
