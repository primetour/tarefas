# Auditoria de Schema — Envision (Travel Agent) vs `roteiros_bank`

> Gerado em 2026-05-26 · Baseado em **8 fixtures reais** (Peru, Itália, Grécia, África do Sul, Patagônia, Chapada, Japão, Austrália — 5 a 14 dias) capturadas via Chrome MCP em `POST /Services/SiteService.svc/GetItineraryDetails`.
>
> Fixtures completos em `docs/envision-samples/envision-fixtures-bundle-*.json`.

---

## 1. Schema canônico Envision (Itinerary)

Estrutura observada **consistente em 100% dos 8 fixtures** no top-level (25 campos sempre presentes). Variações estão nos sub-arrays (Products, Images, FareCategories) — alguns roteiros têm 0 produtos cadastrados.

### Top-level (25 campos, sempre presentes)

```
Itinerary {
  // Identidade
  Id                      number   PK Envision
  Name                    string   título completo
  Description             string   (legacy — geralmente "")
  NumberOfDays            number
  NumberOfNights          number
  Currency                string   ex: "USD", "EUR", "BRL"
  OriginalCurrency        string|null
  ExchangeRate            number   ex: 1 (se já está na moeda alvo)
  SupplierId              number
  SupplierAgreement       null|object
  LoginInformationId      number
  Url                     null
  GapReason               string
  SelectedDate            null

  // Editorial (rico)
  Globalization           object   ★ CONTEÚDO PRINCIPAL EDITORIAL

  // Estrutura
  DayByDay                Array    ★ 1 entry por dia
  Images                  Array    0-3 imagens (UUID.png, sem URL completa)
  Locations               null     (sempre — Locations reais estão dentro de cada Product)

  // Operacional (variável)
  Products                Array    0-17 (hotéis + serviços)
  ProductsSummaries       null     sempre
  FareCategories          Array    1-3 ("Opção 1", "Opção 2", ...)
  ProductFareCategories   Array    matriz produto × categoria × room
  AvailabilityDates       Array    sempre []

  // Metadata sistema
  ErrorLogs               Array    logs internos (ignorar)
  ExternalProperties      Array
}
```

### `Globalization` (★ campo editorial principal — sempre populado)

```
{
  Culture: "pt-BR"
  Name: string                  título (== Itinerary.Name)
  ShortDescription: string      (sempre vazio nos fixtures)
  Description: string (HTML)    parágrafo de capa
  Includes: string (HTML)       o que está incluído — organizado em seções:
                                  HOSPEDAGEM, TRASLADOS, PASSEIOS, ASSISTÊNCIA,
                                  AÉREO INTERNO, OUTROS
  GeneralInfo: string (HTML)    documentação extensa:
                                  passaporte, vistos, vacinas, moeda, fuso,
                                  clima, gorjetas, voltagem, gastronomia,
                                  telefonia, dicas. ~3-9KB de texto rico.
  CancellationPolicy: string (HTML)  política escalonada (ex: 29-20 dias = 50%,
                                       19-8 dias = 75%, 7-0 = 100%)
  FormOfPayment: string (HTML)       formas pagamento terrestre + aéreo + sinal
}
```

### `DayByDay[]` (1 entry por dia, sempre)

```
{
  Day: number              ordinal (1, 2, 3...)
  Name: string             cidade ou tema (ex: "Florença", "Lima")
  Description: HTML        narrativa do dia (200-800 chars)
  NightDescription: HTML   "noite em X" curto (~30 chars)
  Culture: "pt-BR"
}
```

### `Images[]` (0-3 imagens)

```
{
  UrlImage: string         ← FILENAME UUID (ex: "dd09ae23-baa4-...png")
                             NÃO é URL completa — precisa prefix com CDN
  UrlThumbnailImage: ""    (sempre vazio nos fixtures)
  Description: string
  FileType: null
}
```

⚠️ **Important**: imagens vêm como `UUID.png` sem URL completa. Precisa descobrir o base URL (provavelmente `https://api.travelagent.com.br/Files/...` ou `https://v2.travelagent.com.br/Files/...`). **Pendente investigar**.

### `Products[]` (0-17, variável)

Shape varia muito por tipo. Campos comuns:

```
{
  ProductType: 1 | 2       (1 = Service, 2 = Hotel)
  ProductId: number
  ProductName: string
  ProductSupplier: string
  OfflineProductId: number
  Day: number              dia do roteiro em que inicia
  NumberOfDays, NumberOfNights: number
  LocationId: number
  Location: string|object  pode ser string OU Location object
  Optional: boolean        se é opcional/upgrade
  Online: boolean
  MaxQuantity: number
  AirCiaCode: null|string
  Description: string
  HotelChainCode: null|string
  ProductFareCategories: Array (associação preço local)

  // Se ProductType = 2 (HOTEL):
  Hotel: {
    Address: { Street, Number, District, PostalCode, ... }
    Location: { Country, FullName, IATA, Latitude, Longitude, Name,
                NamePortuguese, NameSpanish, LocationType, ParentId, ... }
    Phone, Email, Rating, ...
  }

  // Se ProductType = 1 (SERVICE):
  Service: {
    Category: { Id, Name }   ex: "Mini Roteiro", "Passeio", "Transfer", "Ingresso", "Trem"
    Description: HTML
    AgeGroups, CancellationPolicy, ConsumableDays
    ...
  }
}
```

### `FareCategories[]` (1-3 "Opções")

```
{
  Id: number
  Name: string             ex: "Opção 1", "Opção 2", "Opção 3" (categorias comerciais)
  FareCategoryDates: []    sempre vazio nos fixtures
  EstimatedFaresTypes: []  sempre vazio
}
```

### `ProductFareCategories[]` (matriz produto × categoria × room)

```
{
  ItineraryProductId: number
  ItineraryFareCategoryId: number   FK pra FareCategories
  ItineraryFareCategoryDateId: null
  Room, RoomId, RoomTypeDescription
  Name, ServiceFareName
}
```

⚠️ **PREÇO NÃO ESTÁ AQUI**. Só associação produto↔categoria↔room. Preço real vem de `POST /Services/SiteService.svc/CalculateItineraryFareEstimate` (segundo endpoint, separado).

---

## 2. Schema atual `roteiros_bank` (nosso)

De `js/services/roteiroBank.js:59` (`emptyRoteiroBank()`):

```
{
  // Identidade
  title, subtitle, code, slug
  collectionLabel: 'Classic'
  status: 'draft'|'review'|'approved'|'archived'

  // Validade (controle de equipe)
  validity: { startDate, endDate, notes }

  // Editorial
  shortDescription, longDescription

  // Geo (alinhado a portal_destinations)
  geo: { continents[], countries[], cities[{city,country,continent,nights}], destinationIds[] }

  // Duração
  durationDays, durationNights

  // Dia a dia
  days: [{ dayNumber, city, title, narrative, overnightCity, flightLeg }]

  // Categorias de hospedagem + pricing (estilo Classic Collection PDF)
  categories: [{
    key, label,
    hotels: [{ city, name, roomType, nights, supplierUrl, notes }],
    pricing: [{ period: {start,end}, single, double, currency, notes }],
    notes
  }]

  // Includes / Excludes
  includes: { hospedagem[], traslados[], passeios[], assistencia[], aereoInterno[], trem[], outros[] }
  excludes: []

  // Pagamento
  payment: {
    terrestrial, aerial,
    deposit: { amount, currency, perPerson, notes },
    settlement
  }

  // Cancelamento (escalado)
  cancellation: [{ fromDays, multaPercent, notes }]

  // Documentação
  documentation: { passport, minors, visas[], vaccines }

  // Travel notes
  travelNotes: []

  // Imagens
  images: { hero, gallery[], overrides: {city_slug: url} }

  // Source
  source: { type, originalFile, importedAt, importedBy, llmTokens }

  // Curadoria
  tags: [], aiUsable: true

  // Auditoria
  createdAt/By, updatedAt/By, approvedAt/By
}
```

---

## 3. Matriz de mapeamento Envision → roteiros_bank

| Envision (campo) | Nosso (campo) | Status | Observação / ação |
|---|---|---|---|
| **`Id`** | (novo) `envisionId` | ➕ ADD | FK obrigatória, único, indexado |
| **`Name`** | `title` | ✅ Match | direto |
| **`Description`** (top) | — | ⏭️ Skip | legacy, geralmente vazio |
| **`NumberOfDays`** | `durationDays` | ✅ Match | renomear ou alias |
| **`NumberOfNights`** | `durationNights` | ✅ Match | renomear ou alias |
| **`Currency`** | (sub de category.pricing[].currency) | 🔄 Refactor | hoje pricing é per-category. Envision tem só 1 currency por itinerary. |
| **`OriginalCurrency`** | (novo) | ➕ ADD | pra controle de FX |
| **`ExchangeRate`** | (novo) | ➕ ADD | pra controle de FX |
| **`SupplierId`** | (novo) `envisionSupplierId` | ➕ ADD | metadata |
| **`LoginInformationId`** | (novo) `envisionLoginInformationId` | ➕ ADD | metadata |
| **`Url`** | (novo) `envisionUrl` | ➕ ADD | deep link (quando popularem) |
| **`Globalization.Name`** | `title` (mesmo) | ✅ Match | redundante — usar Envision.Name |
| **`Globalization.ShortDescription`** | `shortDescription` | ✅ Match | sempre vazio nos fixtures (campo Envision pouco usado) |
| **`Globalization.Description`** | `longDescription` | ✅ Match | HTML — renderer já precisa lidar com isso |
| **`Globalization.Includes`** | `includes.*` (bucketizado) | 🔄 **Refactor crítico** | Envision: UM HTML único organizado em seções. Nosso: 7 arrays separados (`hospedagem`, `traslados`, etc). **Decisão**: parser HTML que extrai seções? OU mudar nosso schema pra 1 string HTML? |
| **`Globalization.GeneralInfo`** | (espalhado em `documentation` + `travelNotes`) | 🔄 **Refactor crítico** | Envision: UM HTML único com tudo (passaporte/vistos/vacinas/fuso/clima/gorjetas/voltagem/etc). Nosso: estruturado em `documentation.passport/minors/visas/vaccines` + `travelNotes[]`. **Decisão**: extrair com regex/IA OU adotar 1 campo `generalInfo` HTML. |
| **`Globalization.CancellationPolicy`** | `cancellation[]` (escalonado) | 🔄 **Refactor crítico** | Envision: HTML escalonado em texto. Nosso: array `[{fromDays, multaPercent, notes}]`. **Decisão**: parser regex extrair degraus OU adotar HTML. |
| **`Globalization.FormOfPayment`** | `payment.terrestrial` + `payment.aerial` + `payment.deposit` | 🔄 **Refactor crítico** | Envision: HTML único. Nosso: estruturado. **Decisão**: parser ou adotar HTML. |
| **`DayByDay[].Day`** | `days[].dayNumber` | ✅ Match | direto |
| **`DayByDay[].Name`** | `days[].city` OU `days[].title` | ✅ Match | Envision usa `Name` pra cidade OU tema |
| **`DayByDay[].Description`** | `days[].narrative` | ✅ Match | HTML — nosso já aceita HTML? **Verificar renderer.** |
| **`DayByDay[].NightDescription`** | `days[].overnightCity` | ✅ Match | Envision tem HTML curto, nosso espera string da cidade — adapter pode strip tags |
| `days[].flightLeg` | (não em Envision) | 🔵 Local-only | preservar como overlay |
| **`Images[].UrlImage`** | `images.hero` + `images.gallery[]` | 🔄 Adapter | precisa **prefix CDN URL** + decidir hero vs gallery (heurística: 1ª = hero) |
| `images.overrides` (city) | (não em Envision) | 🔵 Local-only | preservar overlay |
| **`Products[]`** (variável) | `categories[].hotels[]` (per categoria) | 🔄 **Refactor crítico** | Envision: 1 array plano de Products com Day, Optional. Nosso: hotéis aninhados por categoria. **Decisão**: estrutura híbrida — Products bruto + view-derivada por categoria. |
| **`Products[].Hotel`** (object rico) | `categories[].hotels[].name` (string) | 🔄 Refactor | Envision tem objeto completo (Address, Location, Lat/Long, ChainCode). Vale capturar tudo. |
| **`Products[].Service`** (object rico) | (sem equivalente direto) | ➕ ADD | nosso `includes` é só bullet point. Envision tem serviço estruturado (Categoria, Description, CancellationPolicy). **Pode virar fonte mais rica**. |
| **`FareCategories[]`** | `categories[]` (label) | 🔄 Match parcial | Envision: "Opção 1/2/3". Nosso: chave nomeada ("luxo", "luxo-standard"). Decisão: importar como `categories[].label` direto. |
| **`ProductFareCategories[]`** | (matriz preço) — `categories[].pricing[]` | 🔄 Refactor | Envision não tem PREÇO aqui (só associação). **Precisa CalculateItineraryFareEstimate separado**. |
| **(preço real)** `CalculateItineraryFareEstimate` | `categories[].pricing[]` | 🔵 Endpoint separado | 2ª chamada obrigatória pra ter preços. Cache TTL curto (preços voláteis). |
| `AvailabilityDates[]` | `validity` | 🔄 Match | Envision sempre vazio nos fixtures — provavelmente vem populado em fares ativos. **Validar**. |
| `validity.notes` | (não em Envision) | 🔵 Local-only | preservar overlay |
| **`SupplierAgreement`** | (novo) | ➕ ADD opcional | metadata |
| **`GapReason`** | (novo) | ➕ ADD opcional | usado pra explicar quando algo está faltando |
| **`Locations`** (top) | `geo.cities/countries/continents` | 🔵 Derivada | sempre null no Envision top. Derivar de `Products[*].Location` + `DayByDay[*].Name`. |
| `geo.destinationIds` | — | 🔵 Local-only | resolver via matching cidade/país → portal_destinations |
| `code`, `slug` | — | 🔵 Local-only | gerar on-save (mesmo padrão atual) |
| `collectionLabel` | — | 🔵 Local-only | curador classifica |
| `status` | — | 🔵 Local-only | workflow nosso (draft/review/approved/archived) |
| `tags[]` | — | 🔵 Local-only | curador adiciona |
| `aiUsable` | — | 🔵 Local-only | flag nossa |
| `source` | — | 🔵 Local-only | substituir por novo `source: 'envision' \| 'manual'` |
| `documentation.{passport,visas,vaccines}` | (parte de `GeneralInfo`) | ⚠️ Deprecar OU parsear | 2 opções no §4 |
| `travelNotes[]` | (parte de `GeneralInfo`) | ⚠️ Deprecar OU parsear | idem |

### Resumo da matriz

- **✅ Match direto** (sem refactor): 12 campos
- **🔄 Refactor crítico**: 5 campos (Includes/GeneralInfo/Cancellation/Payment/Products)
- **➕ ADD novos campos**: 7 campos (envisionId, FX, supplier, etc)
- **🔵 Local-only** (preservar como overlay/derivada): 11 campos
- **⏭️ Skip / Deprecate**: 2 campos

---

## 4. Decisões pendentes (críticas — definem o adapter)

### D1. Includes / GeneralInfo / Cancellation / FormOfPayment — HTML único vs estruturado

**Opção A — Adotar HTML único** (alinha com Envision):
- Schema novo: `includes: string (HTML)`, `generalInfo: string (HTML)`, `cancellationPolicyHtml: string`, `paymentHtml: string`
- Renderer mostra HTML inline (sanitize com DOMPurify)
- ✅ Zero perda de dados Envision
- ✅ Adapter trivial (passa direto)
- ❌ Quebra retrocompat com schema atual (precisa migration)
- ❌ Curador edita HTML (workflow editorial mais difícil)

**Opção B — Adotar estruturado + parser HTML→struct** (mantém schema atual):
- Adapter parsea HTML do Envision em struct (regex/cheerio/IA)
- Mantém `includes.{hospedagem,traslados,...}`, `cancellation: [{fromDays, multaPercent}]`, `documentation.{passport,visas,...}`
- ✅ Mantém schema atual + workflow editorial estruturado
- ❌ Parser frágil — HTML do Envision varia entre roteiros
- ❌ Risco de perder informação no parse

**Opção C — Híbrido (recomendado)**:
- Mantém `includes.{...}` etc estruturado pra render bonito + editor estruturado
- ADICIONA `envisionRaw: { includes, generalInfo, cancellationPolicy, formOfPayment }` (strings HTML originais)
- Adapter NÃO parseia HTML — adapter só copia raw + tenta heurística simples (ex: detectar "29 dias" pra extrair multa)
- Renderer mostra: se há estruturado, usa estruturado; senão, mostra HTML raw fallback
- Curador VÊ o HTML raw + decide editorialmente preencher campos estruturados (overlay)
- ✅ Zero perda
- ✅ Sem parser frágil
- ✅ Curador agrega valor editorial em cima do bruto

→ **Renê decide A/B/C.**

### D2. Products: estrutura plana (Envision) vs aninhada por categoria (nosso)

**Opção A — Adotar shape Envision flat**:
- Schema: `products: [{ productType, day, hotel?, service?, fareAssociations[] }]`
- View deriva agrupamento por categoria a partir de `ProductFareCategories`
- ✅ Fiel ao Envision
- ❌ Render PDF Classic Collection (que usa "Sugestão Prime"/"Luxo Standard") fica derivado

**Opção B — Adapter agrupa por categoria pra nosso shape**:
- Adapter percorre `ProductFareCategories` → agrupa Products por `ItineraryFareCategoryId` → preenche `categories[].hotels[]`
- ✅ Mantém shape de render PDF atual
- ❌ Perde a noção de "produto opcional/upgrade" no shape (mas pode preservar como overlay)

**Opção C — Híbrido**:
- Mantém `categories[]` agrupado (render PDF) + adiciona `envisionProducts: [...]` raw
- Adapter faz agrupamento heurístico
- Curador vê os 2 lados, ajusta agrupamento manual se quiser

→ **Renê decide A/B/C.**

### D3. Imagens: URL completa vs UUID + base prefix

Envision retorna `UrlImage: "dd09ae23-...png"` (UUID, não URL). Precisamos:
- Descobrir base URL via inspeção MCP (testar carregando `https://api.travelagent.com.br/Files/{uuid}` ou similar)
- Mirror pra R2 (CLAUDE.md §13.i banco como repositório) ou usar URL externa direta?

→ **Investigação técnica** (faço sozinho via MCP) + **decisão de mirror R2 sim/não** (Renê).

### D4. Currency: 1 por itinerary (Envision) vs 1 por pricing entry (nosso)

Envision: `Itinerary.Currency = "EUR"` (todos os preços nesta moeda).
Nosso: `categories[].pricing[].currency` — permite diferentes moedas por categoria.

Na prática: Envision é mais simples. Provavelmente nosso é over-engineered.

→ **Renê decide**: adotamos 1 currency por itinerary?

### D5. AvailabilityDates: campo populado em produção?

Sempre 0 nos 8 fixtures. **Hipóteses**:
- a) Campo só é populado em fares ativos (precisa chamar `CalculateItineraryFareEstimate`)
- b) Campo é deprecado no Envision
- c) Campo aparece em outros tipos de itinerary que não cobrimos

→ **Investigar** via 1-2 chamadas de teste na próxima sessão MCP.

### D6. Preços: cache TTL? Quem dispara o CalculateItineraryFareEstimate?

Preços não estão em `GetItineraryDetails`. Vêm via segundo endpoint. Decisões:
- Cache TTL curto (1h?) — preços mudam com câmbio + markup
- Disparar on-demand quando consultor abre roteiro? OU pré-popular cron?

→ **Renê decide UX**: aceitamos "carregando preços..." ao abrir? OU pré-populamos tudo?

---

## 5. Próximos passos (sequência sugerida)

1. **Renê responde D1-D6** (decisões de schema/UX). Pode marcar A/B/C em cada.
2. **Adapter v1** (`js/services/envisionAdapter.js`): pure function `envisionItineraryToBank(envisionJson, opts) → bankShape`. Sem dependência de auth/API — testado contra os 8 fixtures.
3. **Migration script** (`functions/migrate-bank-source-flag.cjs`): marca docs antigos com `source: 'manual'`.
4. **Schema bump em `emptyRoteiroBank()`**: adiciona campos novos (envisionId, envisionSupplierId, envisionRaw, etc).
5. **Testar adapter**: rodar `node test-envision-adapter.cjs` que carrega cada fixture, aplica adapter, valida shape, mostra diffs.
6. **Renê valida visualmente** 2-3 fixtures convertidos.
7. **Decisão**: começar import batch (Forms Auth via cookie copy-paste) OU primeiro testar `GetSession` (caminho C).

---

## 6. Apêndice — frequência de campos nos 8 fixtures

```
Id      Days  Globaliz  DayByDay  Images  Products  FareCat  PFC  AvDates  Name
762     9     ✓+gi      9         3       5         1        5    0        Peru by Relais Châteaux
1016    9     ✓+gi      9         0       0         1        3    0        Itália Florença Montalcino
757     9     ✓+gi      9         3       5         3        18   0        Grécia Atenas Santorini Mykonos
1132    11    ✓+gi      11        0       5         1        5    0        África do Sul família
766     5     ✓+gi      5         3       1         2        2    0        Patagônia Chilena
1323    5     ✓+gi      5         3       4         1        3    0        Chapada Diamantina
1017    13    ✓+gi      13        3       17        2        24   0        Japão multi-cidade
722     14    ✓+gi      14        3       9         2        14   0        Austrália multi-cidade
```

**Observações**:
- ✅ DayByDay + Globalization (Includes + GeneralInfo) sempre completos
- ⚠️ Images variam (0 ou 3 — alguns roteiros sem imagem cadastrada)
- ⚠️ Products variam (0 a 17) — alguns roteiros têm narrativa mas sem produtos cadastrados (Itália, África do Sul)
- ⚠️ AvailabilityDates SEMPRE 0 (precisa investigar)

---

_Doc gerado por Claude com base em 8 fixtures reais. Revisar com Renê antes de codar adapter._
