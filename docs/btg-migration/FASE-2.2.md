# Fase 2.2 — Dedup, soft-delete e CRUD completo (CONCLUÍDA)

> Data: 2026-05-18 · Commits: `8bd3e82`

## Objetivo
Cobrir 4 lacunas funcionais da POC original no service de ofertas:
1. Dedup automático de slug (impede 2 ofertas com mesma URL).
2. Soft-delete (arquivar sem apagar do banco).
3. CRUD completo (faltavam `getOfertaById`, `updateOferta`).
4. Filtro de status no `listOfertas` (pra UI admin ver arquivadas).

## O que mudou

| Função | Antes | Agora |
|---|---|---|
| `saveOferta(values)` | Salvava com slug raw (colisão possível) | Garante slug único; retorna `{ id, slug, source }` |
| `listOfertas(filters)` | Filtrava só por `status='published'` (hardcoded) | Novo filter `status`: `'published'` (default), `'archived'`, `'all'` |
| `getOfertaById(id)` | ❌ não existia | ✅ retorna qualquer status (pra UI edição) |
| `updateOferta(id, values, opts)` | ❌ não existia | ✅ patch não-destrutivo; `opts.regenerateSlug` opcional |
| `archiveOferta(id)` | ❌ não existia | ✅ marca `status='archived'` |
| `restoreOferta(id)` | ❌ não existia | ✅ volta `status='published'` |

## Algoritmo de dedup

`findUniqueSlug(db, baseSlug, excludeId?)`:
1. Query `WHERE slug == baseSlug LIMIT 2`.
2. Se snap vazio → retorna baseSlug.
3. Se snap tem só o doc com `id === excludeId` (update regenerando) → retorna baseSlug.
4. Senão tenta `baseSlug-2`, `baseSlug-3`, ... até 100.
5. Fallback paranoid: `baseSlug-${Date.now()}`.

Funciona também no fallback localStorage via `findUniqueSlugLocal`.

## Sobre slug em update

`updateOferta(id, values)` por padrão **mantém o slug original**, mesmo que `nome_da_oferta` mude. Motivo: slug é URL pública — mudar quebra links. Pra regenerar explicitamente: `updateOferta(id, values, { regenerateSlug: true })`.

## Pra promover pra produção
- A coleção `btg_ofertas_dev` vira `btg_ofertas` (alterar constante `BTG_COLLECTION` em `btg-config.js`).
- As 4 índices compostos (commits `400fe89` e `9692e6e`) precisam ser recriados pra `btg_ofertas` (alterar `collectionGroup` em `firestore.indexes.json`).
- Regras Firestore: apertar `match /btg_ofertas/{docId}` exigindo SSO Microsoft + permissão `btg_offer_manage` (não usar `allow read, write: if true`).
