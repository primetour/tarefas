# Fase E — Lista e edição de ofertas (CONCLUÍDA)

> Data: 2026-05-18 · Commit: `ad8dcfa`

## Objetivo
Fechar o ciclo administrativo: até a Fase 2.3, o admin só podia **criar** ofertas. Faltava listar, filtrar, arquivar e editar.

## O que foi entregue

### Página de lista — `/btg/dashboard/ofertas/`

Tabela com:
- Thumbnail da imagem
- Nome + slug
- Marcas (badges coloridos por brand: navy/blue/dark-blue)
- Tipo (Feriado, Destino, Cruzeiro, etc.)
- Destino
- Status (badge Publicada/Arquivada)
- Data de criação
- Ações: **Editar** (link) e **Arquivar/Restaurar** (botão soft-delete)

Filtros:
- Busca livre (nome, destino, slug, descrição)
- Marca (Partners / Ultrablue / Operadora / Todas)
- Tipo (6 opções)
- Status (Apenas publicadas / arquivadas / todas)

Atalhos no header: **+ Nova oferta** e **⬆️ Importar**.

### Página de edição — `/btg/dashboard/ofertas/editar/?id=XXX`

Reusa **toda** a UI do form de nova-oferta (wizard, validação, image picker, IA), mas:
- Carrega a oferta por ID via `getOfertaById`.
- Pre-popula o store com os valores existentes.
- `tipo_oferta` é fixo (não pode trocar tipo de oferta existente — botão "Trocar tipo" vira "Voltar pra lista").
- Save chama `updateOferta(id, values)` em vez de `saveOferta(values)`.
- Após save → redireciona pra `/btg/dashboard/ofertas/`.
- Rascunho de edição usa key `btg-edit-draft-${id}` (não colide com rascunho de nova oferta).
- Confirma carregar rascunho se houver edição não salva pendente.

## Refactor importante

A lógica do form (~200 linhas inline) foi extraída pra módulo compartilhado:

```
btg/dashboard/_shared/form-app.js
  ↑                ↑
  │                │
  mount({mode:'create'})    mount({mode:'edit', ofertaId})
  ↑                          ↑
  nova-oferta/index.html    ofertas/editar/index.html
  (14 linhas)               (16 linhas)
```

Zero duplicação. Diferenças entre os modos são tratadas internamente no módulo via parâmetros.

## Estrutura final do dashboard

```
btg/dashboard/
├── _shared/
│   └── form-app.js          ← módulo compartilhado
├── nova-oferta/
│   └── index.html           ← mount({mode:'create'})
├── ofertas/
│   ├── index.html           ← lista + filtros + ações
│   └── editar/
│       └── index.html       ← mount({mode:'edit', ofertaId})
└── import/
    └── index.html           ← Fase 2.3 — drop Excel/DOCX
```

## URLs públicas (após deploy)

- `https://gestor-btg-lp-builder-staging.web.app/btg/dashboard/ofertas/` — lista
- `https://gestor-btg-lp-builder-staging.web.app/btg/dashboard/ofertas/editar/?id=XXX` — editar
- `https://gestor-btg-lp-builder-staging.web.app/btg/dashboard/nova-oferta/` — criar
- `https://gestor-btg-lp-builder-staging.web.app/btg/dashboard/import/` — importar

## Não entregue (fora do escopo da Fase E)

- **Bulk actions** (arquivar várias de uma vez) — pode entrar em sprint futura.
- **Paginação real** (`fetchOfertasPage` com cursor) — hoje carrega tudo. Pra 50+ ofertas vale otimizar.
- **Ordenação por coluna clicável** — hoje sempre desc por createdAt.
- **Export pra CSV** — útil pra backup mas não pedido.
- **Histórico de edições / undo** — auditoria já mora em `audit_logs` do Gestor; pra usar precisa adicionar logging no `updateOferta`.
