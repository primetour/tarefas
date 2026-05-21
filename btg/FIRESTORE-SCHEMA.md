# Firestore — Schema das Ofertas BTG (Lab)

> Coleção: **`ofertas_btg_lab`** (separada de qualquer coleção de produção do gestor)

---

## 1. Estrutura do documento

```json
{
  "slug": "reveillon-pedras-do-patacho",
  "tipo_cartao": ["Partners", "Ultrablue"],
  "tipo_oferta": "Feriado",
  "concierge_subtipo": "",
  "oferta_destaque": "Sim",
  "destino_rota": "Pedras do Patacho, Alagoas",
  "nome_da_oferta": "Réveillon Pedras do Patacho",
  "descricao": "Resort à beira-mar com experiências privativas...",
  "oferta_especial": "ALL-INCLUSIVE",
  "nome_feriado": "Réveillon 2026",
  "duracao_noites": "5",
  "tipo_acomodacao": "Suíte Superior",
  "configuracao_hospedes": "2 adultos + 1 criança até 12 anos",
  "local_evento": "",
  "categoria_ingresso": "",
  "companhia_aerea": "",
  "classe_aerea": "",
  "nome_navio": "",
  "nacional_internacional": "Nacional",
  "estado_pais": "Alagoas",
  "preco_sob_consulta": false,
  "preco": "4460",
  "moeda": "R$",
  "parcelamento": "6",
  "contexto_do_preco": "Por pessoa em apto duplo",
  "taxas": "Taxas inclusas",
  "data_de_inicio": "2026-12-28",
  "data_final": "2027-01-02",
  "data_expiracao": "2026-11-30",
  "incluso_no_pacote": "Hospedagem com café da manhã\nTraslados privativos\nWelcome drink",
  "beneficios_marca": "Early check-in & late check-out\nUpgrade de categoria",
  "condicoes_observacoes": "Válido entre 28/12 e 02/01\nAntecedência mínima 14 dias",
  "imagem_url": "https://r2.primetour.com.br/btg/ofertas/abc123.jpg",
  "status": "published",
  "createdAt": "2026-05-15T12:00:00.000Z",
  "updatedAt": "2026-05-15T12:00:00.000Z"
}
```

---

## 2. Índices Firestore necessários

Compound indexes (criar em `firestore.indexes.json`):

```json
{
  "indexes": [
    {
      "collectionGroup": "ofertas_btg_lab",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "tipo_cartao", "arrayConfig": "CONTAINS" },
        { "fieldPath": "tipo_oferta", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "ofertas_btg_lab",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "tipo_cartao", "arrayConfig": "CONTAINS" },
        { "fieldPath": "oferta_destaque", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "ofertas_btg_lab",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "concierge_subtipo", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ]
}
```

---

## 3. Firestore Rules (a adicionar em `firestore.rules`)

```javascript
match /ofertas_btg_lab/{ofertaId} {
  // Leitura pública para ofertas publicadas
  allow read: if resource.data.status == 'published';

  // Escrita só pra usuários autenticados (gestor SSO)
  // No POC, pode ser mais aberto temporariamente
  allow create: if request.auth != null
    && request.resource.data.keys().hasAll(['slug', 'tipo_cartao', 'tipo_oferta', 'nome_da_oferta', 'status'])
    && request.resource.data.status in ['draft', 'published']
    && request.resource.data.tipo_cartao is list
    && request.resource.data.tipo_cartao.size() > 0;

  allow update: if request.auth != null
    && request.resource.data.updatedAt is string;

  allow delete: if false; // Soft delete via status = 'archived' (não implementado ainda)
}
```

---

## 4. Slug — geração e unicidade

O slug é gerado a partir de `nome_da_oferta`:
- Normaliza acentos (`NFD`)
- Lowercase
- Substitui espaços por `-`
- Remove caracteres especiais
- Limita a 80 chars

**Unicidade**: hoje não tem garantia. Para Phase 2:
- Antes de salvar, query `where('slug', '==', generated)` e adicionar sufixo `-2`, `-3`, etc., se já existir
- Ou usar `addDoc` (Firestore gera id único) e tratar slug como redirect

---

## 5. Migração de produção (quando aplicável)

Quando estiver pronto pra ir pra produção:
- Renomear coleção: `ofertas_btg_lab` → `ofertas_btg`
- Script de migração no `functions/migrate-from-wp.js` (ou similar)
- Atualizar Rules para usar a coleção final
- Atualizar `btg-ofertas-service.js` (`COLLECTION` constant)

Como temos só 2 ofertas de teste no WP atual (confirmado pelo usuário),
**não há necessidade de migração de dados** — o lab parte do zero.
