# Fase 2.1 — Image Picker com Banco Curado (CONCLUÍDA)

> Data: 2026-05-18 · Branch: `feat/btg-migration` · Decisão de design: A1 + B1 + E

## Objetivo
Substituir o input `<input type="file">` direto por um picker visual que oferece **2 caminhos**: escolher do banco curado de imagens (reaproveitando `portal_images` do Portal de Dicas) ou upload novo. Resolve o item "Phase 2" da POC original (`imagem_url: null` no save).

## Decisões aplicadas
| Decisão | Escolha | Por quê |
|---|---|---|
| **A1** — Layout do picker | 2 abas separadas (`Banco curado` / `Upload novo`) | Pattern explícito tipo Notion/Slack |
| **B1** — Sample de imagens no staging | Claude escolhe 10-12 imagens já em `btg/assets/parceiros/` | Mais rápido que exportar de produção, suficiente pra validar UX |
| **E** — Upload R2 no staging | Desativado (aba mostra mensagem "Disponível em produção") | Evita upgrade pra Blaze; resolvido na Fase 5 (cutover) |
| Tags em imagem nova | Sem tag `btg` adicional | Banco unificado com Portal de Dicas |

## O que foi feito

| # | Item | Arquivo |
|---|---|---|
| 1 | Regra Firestore pra `portal_images_dev` (read+write em staging) | `firestore.rules` (bloco novo no fim) |
| 2 | Script de seed idempotente | `btg/_internal/seed-portal-images-dev.html` |
| 3 | Componente picker (JS + CSS) | `btg/shared/btg-image-picker.js` + `.css` |
| 4 | `inputImagem` reescrito (preview + botão "Trocar imagem") | `btg/shared/form/form-inputs.js` |
| 5 | Click handler `data-action="open-image-picker"` no `bindFormEvents` | `btg/shared/form/form-inputs.js` |
| 6 | Campos novos no store: `imagem_url`, `imagem_meta` | `btg/shared/form/form-store.js` |
| 7 | CSS pras classes `--filled`, `__preview-img`, `__change` | `btg/shared/btg-image-picker.css` (bloco final) |
| 8 | Import do CSS do picker + subscribe priorizando `imagem_url` | `btg/dashboard/nova-oferta/index.html` |
| 9 | Validador: trocar `fields: ['imagem_file']` → `['imagem_url']` | `btg/shared/form/questions-by-type.js` |
| 10 | `.gitignore`: adicionar `.firebase/` | `.gitignore` |

## Schema da coleção `portal_images_dev`

Mesma estrutura da coleção real `portal_images` (Portal de Dicas) — facilita troca futura:

```js
{
  assetCategory: 'hotel',         // 'hotel' | 'cruise' | 'train' | 'logo' | 'location'
  continent: 'oceania',
  country: 'Polinésia Francesa',
  city: 'Bora Bora',
  name: 'Four Seasons Bora Bora',
  placeName: 'Four Seasons Bora Bora',
  tags: ['hotel', 'resort', 'praia', 'lua-de-mel', 'four-seasons'],
  type: 'galeria',
  copyright: '',
  url: 'https://gestor-btg-lp-builder-staging.web.app/btg/assets/parceiros/four-seasons-bora-bora.jpg',
  path: 'hoteis/btg-seed/four-seasons-bora-bora.jpg',
  originalName: 'four-seasons-bora-bora.jpg',
  sizeMB: 0, width: 0, height: 0,
  uploadedAt: serverTimestamp(),
  uploadedBy: 'seed-script-btg',
}
```

## Fluxo do picker (usuário)

```
[Form pergunta "Envie a imagem"]
       ↓
[Botão "Escolher imagem"]   ← inputImagem retorna botão (não input file)
       ↓ click
[Modal abre, aba "Banco curado" por padrão]
       ↓
[Grid de 12 thumbnails + busca + filtro de país]
       ↓ click numa thumb
[store.set('imagem_url', img.url)]
[store.set('imagem_meta', { name, placeName, country, city })]
       ↓ re-render
[Form mostra preview da imagem + botão "Trocar imagem"]
       ↓ Avançar → Validador checa imagem_url (não vazio) → OK
       ↓ Salvar
[saveOferta grava em btg_ofertas_dev com imagem_url já preenchido]
       ↓
[Home Partners faz query → renderiza card com imagem]
```

## Blockers superados durante a implementação
1. **CORS da Cloud Function `getR2UploadUrl`**: aceita só `primetour.github.io` + `localhost:5000`. Solução: decisão E (upload desativado no staging).
2. **Falta de índice composto no Firestore** pra query da home (`tipo_cartao + oferta_destaque + status + createdAt`). Solução: 4 índices adicionados a `firestore.indexes.json` (commits `400fe89` e `9692e6e`).
3. **Validador de step usava `imagem_file`** (campo legado). Solução: trocar pra `imagem_url` (commit `25938ba`).
4. **`localStorage` antigo** carregava draft com `imagem_file` em formato incompatível. Solução: limpar localStorage manualmente (não automático — risco de perder draft real).

## O que NÃO foi feito (Fase 5+)
- Upload pro R2 real (precisa Cloud Function no staging com Blaze).
- Conversão WebP automática (lógica existe em `js/services/portal.js:632 convertToWebp`, mas só é útil quando upload real estiver ativo).
- UI de gerenciar banco curado (criar/editar/deletar entradas em `portal_images_dev`).

## Commits da Fase 2.1
| SHA | Mensagem curta |
|---|---|
| `58007ae` | feat(btg): regra Firestore + seed pra portal_images_dev |
| `e0a877a` | feat(btg): image picker com banco curado |
| `25938ba` | fix(btg): validar imagem_url em vez de imagem_file |

## Estado pós-Fase 2.1
- Branch `feat/btg-migration` com 8 commits totais.
- Staging em https://gestor-btg-lp-builder-staging.web.app/btg/.
- Ofertas com imagem renderizam corretamente nas 3 homes.
- Pronto pra Fase 2.2 (dedup slug + soft-delete).
